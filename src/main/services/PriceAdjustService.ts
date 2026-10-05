import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { audit } from './AuditService'
import { BusinessError } from '../errors'
import { TX_OPTIONS } from '../db/tx'
import { assertPanelPassword } from './AuthService'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, isValidJalaliDate, jalaliAtClock, money, toClock, toJalaliDate } from '@shared/jalali'
import { AuditAction } from '@shared/enums'
import {
  PRICE_ADJUST_KIND_LABELS,
  PRICE_ADJUST_MODE_LABELS,
  PRICE_ADJUST_SCOPE_LABELS,
  PRICE_ADJUST_STATE_LABELS,
  PRICE_ADJUST_TARGET_LABELS,
  describeRule,
  nextPrice,
  normalizeAdjustState,
  type PriceAdjustKind,
  type PriceAdjustMode,
  type PriceAdjustRule,
  type PriceAdjustScope,
  type PriceAdjustState,
  type PriceAdjustTarget
} from '@shared/priceAdjust'
import type {
  ActiveDiscountInfo,
  PriceAdjustBatchRow,
  PriceAdjustDeleteInput,
  PriceAdjustDeleteResult,
  PriceAdjustEditInput,
  PriceAdjustEditResult,
  PriceAdjustInput,
  PriceAdjustLine,
  PriceAdjustPreview,
  PriceAdjustResult,
  PriceAdjustRevertResult
} from '@shared/types'
import { toNumberRial, toRial } from '@shared/money'

/**
 * ===========================================================================
 * بند ۴ — ماژول «تخفیف و افزایش/کاهش قیمت».
 *
 * مسئله‌ی مالک نرم‌افزار: «می‌خواهم ۵۰ هزار تومان یا ۱۰٪ به قیمت همه — یا یک
 * دسته، یا چند کالای خاص — اضافه/کم کنم، بدون این‌که تک‌تک کالاها را در پنل
 * کالا دستی ویرایش کنم.»
 *
 * سه تصمیم معماری این سرویس:
 *
 * ۱) **همیشه دو مرحله.** `preview()` هیچ چیزی را عوض نمی‌کند و دقیقاً می‌گوید
 *    کدام کالا از چه قیمتی به چه قیمتی می‌رود و چه چیزی لمس نمی‌شود. تغییر
 *    گروهی قیمت، برگشت‌ناپذیرترین کار روزانه‌ی یک فروشگاه است؛ «یک دکمه، یک
 *    کلیک، تمام» اینجا یک ضدالگو است.
 *
 * ۲) **قیمت قبلی هر کالا ذخیره می‌شود** (`PriceChangeItem`). پس «بازگردانی» یک
 *    دسته، عکس کردن فرمول نیست (که با رُند و کف قیمت هیچ‌وقت دقیق در‌نمی‌آید)،
 *    بلکه نوشتن *همان عدد قبلی* است. یک اشتباه تایپی («۵۰۰۰۰» جای «۵۰۰۰») با یک
 *    کلیک کامل برمی‌گردد.
 *
 * ۳) **محاسبه در `shared/priceAdjust.ts` است، نه اینجا.** renderer همان تابع را
 *    برای پیش‌نمایش زنده صدا می‌زند، پس عددی که مدیر می‌بیند و عددی که روی کالا
 *    می‌نشیند از یک جا می‌آیند.
 *
 * چیزی که این ماژول *عمداً* انجام نمی‌دهد: به فاکتورهای ثبت‌شده دست نمی‌زند.
 * قیمت روی هر فاکتور در `SaleInvoiceItem.unitPrice` سند خودش ثبت شده است و
 * گزارش‌های گذشته باید تا ابد همان عدد را نشان بدهند.
 * ===========================================================================
 */

type Client = Prisma.TransactionClient | typeof prisma

const clean = (v: unknown): string => String(v ?? '').trim()
const PRICE_ADJUST_READ_BATCH = 5000
/** زمان‌بند هم مثل دامنه‌ی تغییر قیمت، حق ندارد سند رسیده را بی‌صدا جا بگذارد. */
const PRICE_SCHEDULE_READ_BATCH = 200
/**
 * نشست ۱۷۶ · S176-D1 — قاعده‌ی پروژه (S99-2): هیچ فهرست شناسه‌ای بیش از ۵۰۰ عضو یکجا در
 * `in` نمی‌نشیند. تخفیف «همه‌ی کالاها» روی ۵۰۱+ کالا قبلاً بازگردانی، پایان خودکار و حذف
 * سابقه با برگرداندن قیمت را از سقف رد و rollback می‌کرد. همه‌ی خواندن/نوشتن‌ها دسته‌ای و
 * داخل همان تراکنش‌اند، پس اتمیک بودن عملیات عوض نمی‌شود.
 */
const PRICE_ADJUST_IN_CHUNK = 500

function chunksOf<T>(values: readonly T[], size = PRICE_ADJUST_IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

/** شناسه‌های واریانتی که هنوز وجود دارند (دسته‌ای؛ جای `findMany({ id: { in } })` بی‌سقف). */
async function aliveVariantIds(client: Client, ids: readonly number[]): Promise<Set<number>> {
  const alive = new Set<number>()
  for (const chunk of chunksOf([...new Set(ids)])) {
    const rows = await client.productVariant.findMany({ where: { id: { in: chunk } }, select: { id: true } })
    for (const r of rows) alive.add(r.id)
  }
  return alive
}

/** اگر دامنه `id: { in: [...] }` دارد، همان فهرست را برمی‌گرداند (برای دسته‌بندی). */
function idInOf(where: Prisma.ProductVariantWhereInput): number[] | null {
  const idCond = (where as any)?.id
  return idCond && typeof idCond === 'object' && Array.isArray(idCond.in) ? (idCond.in as number[]) : null
}

/** شمارش کالاهای دامنه؛ دامنه‌ی «کالاهای انتخابی» دسته‌ای شمرده می‌شود. */
async function countProductVariants(client: Client, where: Prisma.ProductVariantWhereInput): Promise<number> {
  const idIn = idInOf(where)
  if (!idIn || idIn.length <= PRICE_ADJUST_IN_CHUNK) return client.productVariant.count({ where })
  let n = 0
  for (const chunk of chunksOf([...new Set(idIn)])) n += await client.productVariant.count({ where: { ...where, id: { in: chunk } } })
  return n
}

const normalizeKind = (v: unknown): PriceAdjustKind =>
  v === 'INCREASE' ? 'INCREASE' : v === 'DECREASE' ? 'DECREASE' : 'DISCOUNT'
const normalizeMode = (v: unknown): PriceAdjustMode => (v === 'AMOUNT' ? 'AMOUNT' : 'PERCENT')
const normalizeScope = (v: unknown): PriceAdjustScope =>
  v === 'CATEGORY' ? 'CATEGORY' : v === 'VARIANTS' ? 'VARIANTS' : 'ALL'
const normalizeTarget = (v: unknown): PriceAdjustTarget => (v === 'PURCHASE' ? 'PURCHASE' : 'SALE')

/** نام کامل نمایشی یک واریانت (همان چیزی که در فاکتور و گزارش دیده می‌شود). */
function variantTitle(v: {
  size: string | null
  color: string | null
  product: { name: string } | null
}): string {
  return `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
}

/**
 * یک دسته + همه‌ی زیردسته‌هایش، در هر عمقی.
 *
 * چرا کپیِ منطق `ProductService` و نه import آن؟ چون آن تابع در ProductService
 * صادر نشده است و صادر کردنش یعنی دست‌زدن به فایلی که این نشست قرار نیست تغییری
 * در رفتارش بدهد. منطق کوتاه و بی‌حالت است و حلقه‌ی احتمالی `parentId` هم با
 * `seen` بی‌اثر می‌شود — عیناً مثل همان نسخه.
 */
async function categoryWithDescendants(rootId: number, client: Client = prisma): Promise<number[]> {
  const all = await client.category.findMany({ select: { id: true, parentId: true } })
  const childrenOf = new Map<number, number[]>()
  for (const c of all) {
    if (c.parentId == null) continue
    const list = childrenOf.get(c.parentId) ?? []
    list.push(c.id)
    childrenOf.set(c.parentId, list)
  }
  const out: number[] = []
  const seen = new Set<number>()
  const stack = [rootId]
  while (stack.length) {
    const id = stack.pop() as number
    if (seen.has(id)) continue
    seen.add(id)
    out.push(id)
    for (const child of childrenOf.get(id) ?? []) stack.push(child)
  }
  return out
}

/**
 * دامنه‌ی تغییر قیمت سند مدیریتی است، نه یک فهرست نمایشی. بنابراین هیچ
 * `take` ثابت و بی‌هشداری مجاز نیست؛ خواندن صفحه‌ای هم حافظه را کنترل می‌کند
 * و هم تضمین می‌کند کالاهای بعد از ۲۰٬۰۰۰ از عملیات جا نمانند.
 */
async function loadAllProductVariants(
  client: Client,
  where: Prisma.ProductVariantWhereInput,
  select: Prisma.ProductVariantSelect
): Promise<any[]> {
  // نشست ۱۷۶ · S176-D1 — دامنه‌ی «کالاهای انتخابی» (id in) با ۵۰۱+ شناسه دسته‌ای خوانده و به ترتیب id چیده می‌شود
  const idIn = idInOf(where)
  if (idIn && idIn.length > PRICE_ADJUST_IN_CHUNK) {
    const merged: any[] = []
    for (const chunk of chunksOf([...new Set(idIn)]))
      merged.push(...(await loadAllProductVariants(client, { ...where, id: { in: chunk } }, select)))
    return merged.sort((a, b) => a.id - b.id)
  }
  const rows: any[] = []
  for (let skip = 0; ; skip += PRICE_ADJUST_READ_BATCH) {
    const batch = await client.productVariant.findMany({
      where,
      select,
      orderBy: { id: 'asc' },
      skip,
      take: PRICE_ADJUST_READ_BATCH
    })
    rows.push(...batch)
    if (batch.length < PRICE_ADJUST_READ_BATCH) break
  }
  return rows
}

/**
 * نشست ۱۵۰ · بند ۴-۲۸(د) — سقف ستون‌های قیمت (Prisma Int، i32). تا مهاجرت BigInt
 * (خوشه‌ی M) هر قیمت/مبلغ/جمع اختلافی که در ستون Int می‌نشیند پیش از نوشتن با همین
 * سقف و پیام فارسی سنجیده می‌شود، نه خطای خام انگلیسی Prisma یا نوشتن بی‌سقف.
 */
export const PRICE_ADJUST_MAX = 2_147_483_647

const shown = (v: unknown): string => (typeof v === 'number' ? faDigits(String(v)) : String(v))

/**
 * نشست ۱۵۰ · S150-D1 — یک عدد صحیح قاعده، بدون گرد/clamp بی‌صدا.
 * خالی (undefined/null) فقط برای فیلدهای اختیاری (رُند، کف) مجاز است و مقدار پیش‌فرض
 * همیشگی را می‌گیرد؛ متن، NaN، اعشار، منفی و بیش از سقف ⇒ BusinessError فارسی.
 */
function ruleInt(
  raw: unknown,
  label: string,
  opts: { min: number; fallback?: number; unit?: string }
): number {
  if (raw == null && opts.fallback != null) return opts.fallback
  const unit = opts.unit ?? ''
  if (typeof raw !== 'number' || !Number.isFinite(raw))
    throw new BusinessError(
      `${label} باید عدد صحیح باشد؛ مقدار «${shown(raw)}» پذیرفته نیست (متن یا مقدار نامعتبر گرد یا تبدیل نمی‌شود). هیچ قیمتی تغییر نکرد.`
    )
  if (!Number.isInteger(raw))
    throw new BusinessError(
      `${label} باید عدد صحیح باشد؛ «${shown(raw)}»${unit} پذیرفته نیست (اعشار بی‌صدا به ${shown(Math.round(raw))} گرد نمی‌شود). هیچ قیمتی تغییر نکرد.`
    )
  if (raw < opts.min)
    throw new BusinessError(
      `${label} باید ${opts.min <= 0 ? 'صفر یا بیشتر' : `${faDigits(String(opts.min))} یا بیشتر`} باشد؛ «${shown(raw)}»${unit} پذیرفته نیست. هیچ قیمتی تغییر نکرد.`
    )
  if (raw > PRICE_ADJUST_MAX)
    throw new BusinessError(
      `${label} (${money(raw)}${unit}) از سقف مجاز ${money(PRICE_ADJUST_MAX)} ریال بیشتر است. هیچ قیمتی تغییر نکرد.`
    )
  return raw
}

/** ورودی خام ⇒ یک قاعده‌ی تمیز و معتبر (یا خطای فارسی). */
function ruleOf(input: PriceAdjustInput): PriceAdjustRule {
  const kind = normalizeKind(input?.kind)
  const mode = normalizeMode(input?.mode)
  const rawValue = input?.value as unknown
  // پیام قدیمی برای خالی/صفر/منفی حفظ شد (همان متنی که کاربر می‌شناسد)
  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && rawValue <= 0)
    throw new BusinessError(
      mode === 'PERCENT' ? 'درصد را وارد کنید (بزرگ‌تر از صفر).' : 'مبلغ را وارد کنید (بزرگ‌تر از صفر).'
    )
  const value = ruleInt(rawValue, mode === 'PERCENT' ? 'درصد تغییر' : 'مبلغ تغییر', {
    min: 1,
    unit: mode === 'PERCENT' ? '٪' : ' ریال'
  })
  if (mode === 'PERCENT' && value > 100) throw new BusinessError('درصد نمی‌تواند بیشتر از ۱۰۰ باشد.')
  return {
    kind,
    mode,
    value,
    round: ruleInt(input?.round, 'گام رُند قیمت نهایی (۱ = بدون رُند)', { min: 1, fallback: 1, unit: ' ریال' }),
    target: normalizeTarget(input?.target),
    minPrice: ruleInt(input?.minPrice, 'کف قیمت (کمترین قیمت مجاز)', { min: 0, fallback: 0, unit: ' ریال' })
  }
}

/**
 * نشست ۱۵۰ · S150-D2 — قیمت حاصل هر کالا پیش از نوشتن با سقف ستون سنجیده می‌شود؛
 * عبور ⇒ کل عملیات رد (داخل تراکنش ⇒ rollback کامل)، نه نوشتن بی‌سقف.
 */
function assertAdjustedPrice(newPrice: number, oldPrice: number, name: string): void {
  if (newPrice > PRICE_ADJUST_MAX)
    throw new BusinessError(
      `قیمت جدید «${name}» (${money(newPrice)} ریال، از ${money(oldPrice)} ریال) از سقف مجاز ${money(PRICE_ADJUST_MAX)} ریال ` +
        'بیشتر می‌شود؛ هیچ قیمتی تغییر نکرد. مقدار تغییر را کمتر کنید یا این کالا را از دامنه خارج کنید.'
    )
}

/** نشست ۱۵۰ · S150-D3 — جمع اختلاف دسته هم در ستون Int می‌نشیند. */
function assertDeltaTotal(deltaTotal: number): void {
  if (Math.abs(deltaTotal) > PRICE_ADJUST_MAX)
    throw new BusinessError(
      `جمع اختلاف قیمت این دسته (${money(Math.abs(deltaTotal))} ریال) از سقف مجاز ${money(PRICE_ADJUST_MAX)} ریال ` +
        'بیشتر است و تا مهاجرت ستون‌ها به BigInt قابل ثبت در سابقه نیست؛ هیچ قیمتی تغییر نکرد. ' +
        'دامنه را به چند دسته‌ی کوچک‌تر تقسیم کنید.'
    )
}

/** نشست ۱۵۰ · بند ۴-۳۹ — گیت main تغییر گروهی قیمت (بیرون از تراکنش). */
async function adjustGate(password: unknown, action: string): Promise<'MANAGER' | 'PANEL' | 'OPEN'> {
  return assertPanelPassword(PANEL_KEYS.priceAdjust, typeof password === 'string' ? password : null, action)
}
const gateNote = (scope: string): string => ` · تأیید قفل تغییر گروهی قیمت: ${scope}`

/** شرط `where` دامنه‌ی انتخاب کالاها (بدون هیچ نوشتنی). */
async function scopeWhere(
  input: PriceAdjustInput,
  client: Client = prisma
): Promise<{ where: Prisma.ProductVariantWhereInput; scope: PriceAdjustScope; categoryName: string | null }> {
  const scope = normalizeScope(input?.scope)
  // کالای حذف‌شده (سطل آشغال) هیچ‌وقت لمس نمی‌شود
  const base: Prisma.ProductVariantWhereInput = { isActive: true }

  if (scope === 'CATEGORY') {
    const categoryId = Number(input?.categoryId ?? 0)
    if (!Number.isInteger(categoryId) || categoryId <= 0)
      throw new BusinessError('دسته/زیردسته را انتخاب کنید.')
    const cat = await client.category.findUnique({ where: { id: categoryId }, select: { name: true } })
    if (!cat) throw new BusinessError('این دسته پیدا نشد؛ صفحه را تازه کنید.')
    const ids = await categoryWithDescendants(categoryId, client)
    return { where: { ...base, product: { categoryId: { in: ids } } }, scope, categoryName: cat.name }
  }

  if (scope === 'VARIANTS') {
    const ids = [...new Set((input?.variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
    if (!ids.length) throw new BusinessError('حداقل یک کالا را انتخاب کنید.')
    return { where: { ...base, id: { in: ids } }, scope, categoryName: null }
  }

  return { where: base, scope, categoryName: null }
}

/** متن خوانای کاری که انجام می‌شود («۱۰٪ افزایش قیمت فروش · همه‌ی کالاها»). */
function titleOf(rule: PriceAdjustRule, scope: PriceAdjustScope, categoryName: string | null, count: number): string {
  const scopeLabel =
    scope === 'CATEGORY'
      ? `دسته‌ی «${categoryName ?? '—'}» و زیردسته‌هایش`
      : scope === 'VARIANTS'
        ? `${faDigits(count)} کالای انتخاب‌شده`
        : 'همه‌ی کالاها'
  return `${describeRule(rule)} روی ${PRICE_ADJUST_TARGET_LABELS[rule.target ?? 'SALE']} · ${scopeLabel}`
}

/**
 * ===========================================================================
 * نشست دهم — مورد ۱: «زمان‌بندی خودکار».
 *
 * سه تصمیم معماری این بخش، و دلیل هر کدام:
 *
 * ۱) **زمان‌بندی روی همان جدول `PriceChangeBatch` می‌نشیند، نه یک جدول جدا.**
 *    یک دسته‌ی زمان‌بندی‌شده از روز اول یک ردیف در همان «سابقه‌ی تغییرهای قیمت»
 *    است (با وضعیت «زمان‌بندی‌شده — هنوز اعمال نشده»)، پس مدیر همه‌چیز را در یک
 *    جدول می‌بیند و «قرارِ فردا» هیچ‌وقت جایی پنهان نمی‌ماند.
 *
 * ۲) **قبل از رسیدن زمان شروع، هیچ قیمتی لمس نمی‌شود و هیچ `PriceChangeItem` ای
 *    ساخته نمی‌شود.** قیمت «قبل»ِ هر کالا باید همان لحظه‌ی واقعیِ شروع خوانده
 *    شود، نه لحظه‌ی ثبتِ قرار؛ وگرنه اگر بین ثبت و شروع، قیمت کالایی دستی عوض
 *    شود، بازگردانی، آن تغییر را بی‌صدا پاک می‌کرد.
 *
 * ۳) **دقت زمانی از یک «زمان‌بندِ خودتنظیم» می‌آید، نه از یک polling ثابت.**
 *    بعد از هر اجرا، نزدیک‌ترین «قرارِ بعدی» از دیتابیس پرسیده می‌شود و تایمر
 *    *دقیقاً* برای همان لحظه تنظیم می‌گردد (با سقف ۳۰ ثانیه، تا تغییر ساعت
 *    سیستم یا خواب و بیداری ویندوز هم از دست نرود). هنگام باز شدن برنامه هم یک
 *    بار اجرا می‌شود، پس قرارهایی که برنامه بسته بوده — حتی چند روز — همان
 *    ابتدای اجرای بعدی، با برچسب روشن، تسویه می‌شوند.
 * ===========================================================================
 */

/** یک جفت لحظه‌ی زمان‌بندی، تمیز و معتبر (یا خطای فارسی). */
interface ScheduleWindow {
  startAt: Date | null
  startJalali: string | null
  startTime: string | null
  endAt: Date | null
  endJalali: string | null
  endTime: string | null
}

const cleanDate = (v: unknown): string => String(v ?? '').trim()

/** 'HH:mm' تمیز برای ذخیره و نمایش (خالی/خراب ⇒ مقدار پیش‌فرض). */
function clockOf(raw: unknown, fallback: string): string {
  const d = jalaliAtClock('1400/01/01', String(raw ?? '') || fallback)
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * ورودی خام فرم ⇒ بازه‌ی زمان‌بندی.
 *
 * هر دو سر بازه اختیاری‌اند و خالی بودنشان *معنادار* است:
 *   • شروعِ خالی  = همین حالا (رفتار همیشگی برنامه).
 *   • پایانِ خالی = بی‌پایان، تا وقتی مدیر دستی «بازگردانی» بزند.
 * ساعتِ خالی برای شروع ۰۰:۰۰ و برای پایان ۲۳:۵۹ در نظر گرفته می‌شود، چون
 * «تخفیف تا پنج‌شنبه» در ذهن فروشنده یعنی «تا آخر پنج‌شنبه»، نه «تا بامداد آن».
 */
function scheduleOf(input: PriceAdjustInput, now = new Date()): ScheduleWindow {
  const startDate = cleanDate(input?.startDate)
  const endDate = cleanDate(input?.endDate)
  const out: ScheduleWindow = {
    startAt: null,
    startJalali: null,
    startTime: null,
    endAt: null,
    endJalali: null,
    endTime: null
  }

  if (startDate) {
    if (!isValidJalaliDate(startDate))
      throw new BusinessError('تاریخ شروع زمان‌بندی معتبر نیست (قالب درست: ۱۴۰۵/۰۶/۲۸).')
    const time = clockOf(input?.startTime, '00:00')
    out.startAt = jalaliAtClock(startDate, time)
    out.startJalali = startDate
    out.startTime = time
  }

  if (endDate) {
    if (!isValidJalaliDate(endDate))
      throw new BusinessError('تاریخ پایان زمان‌بندی معتبر نیست (قالب درست: ۱۴۰۵/۰۶/۲۸).')
    const time = clockOf(input?.endTime, '23:59')
    out.endAt = jalaliAtClock(endDate, time)
    out.endJalali = endDate
    out.endTime = time
  }

  if (out.endAt) {
    const startRef = out.startAt ?? now
    if (out.endAt.getTime() <= startRef.getTime())
      throw new BusinessError(
        'لحظه‌ی پایان باید بعد از لحظه‌ی شروع باشد. ' +
          (out.startAt
            ? `شروع: ${faDigits(out.startJalali ?? '')} ساعت ${faDigits(out.startTime ?? '')}`
            : 'چون تاریخ شروع خالی است، شروع «همین حالا» در نظر گرفته می‌شود.')
      )
  }
  return out
}

/** این دسته باید «برای آینده» ثبت شود (و هیچ قیمتی حالا عوض نشود)؟ */
function isFutureStart(win: ScheduleWindow, now = new Date()): boolean {
  // یک دقیقه رفت‌و‌آمد: «شروع همین دقیقه» یعنی همین حالا، نه یک قرار برای آینده
  return !!win.startAt && win.startAt.getTime() > now.getTime() + 60_000
}

/** برچسب یک‌خطی و خوانا از زمان‌بندی یک دسته (null = بدون زمان‌بندی). */
function scheduleLabelOf(b: {
  startAtJalali: string | null
  startAtTime: string | null
  endAtJalali: string | null
  endAtTime: string | null
}): string | null {
  const from = b.startAtJalali ? `از ${faDigits(b.startAtJalali)} ساعت ${faDigits(b.startAtTime ?? '00:00')}` : null
  const to = b.endAtJalali ? `تا ${faDigits(b.endAtJalali)} ساعت ${faDigits(b.endAtTime ?? '23:59')}` : null
  if (!from && !to) return null
  return [from, to].filter(Boolean).join(' ')
}

/** یک دسته‌ی ذخیره‌شده ⇒ همان قاعده‌ای که با آن ثبت شده بود. */
/**
 * نشست ۱۸۱ — ورودی می‌تواند مستقیم از دیتابیس بیاید (`bigint`) یا از فرم
 * (`number`). خروجی `PriceAdjustRule` عمداً `number` می‌ماند چون همان‌طور که
 * هست به محاسبه‌گر مشترک `src/shared/priceAdjust.ts` و به رابط کاربری می‌رود.
 *
 * ⚠️ `b.value` در حالت `AMOUNT` یک مبلغ ریالی است، پس تبدیلش از `toNumberRial`
 * می‌گذرد که خارج از محدوده‌ی امن خطا می‌دهد، نه اینکه بی‌صدا گرد کند.
 */
function ruleOfBatch(b: {
  kind: string
  mode: string
  value: number | bigint
  roundStep: number | bigint
  minPrice: number | bigint
  target: string
}): PriceAdjustRule {
  return {
    kind: normalizeKind(b.kind),
    mode: normalizeMode(b.mode),
    value: Math.max(0, toNumberRial(b.value)),
    round: Math.max(1, toNumberRial(b.roundStep)),
    target: normalizeTarget(b.target),
    minPrice: Math.max(0, toNumberRial(b.minPrice))
  }
}

/** فهرست کالاهای انتخابی یک دسته (فقط scope = VARIANTS). */
function variantIdsOfBatch(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return [...new Set(arr.map((n: unknown) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
  } catch {
    return []
  }
}

/**
 * دامنه‌ی یک دسته‌ی ذخیره‌شده ⇒ شرط `where`.
 * برای دسته‌ی زمان‌بندی‌شده لازم است: لحظه‌ی شروع، دامنه باید *دوباره* و روی
 * وضعیت همان لحظه‌ی انبار محاسبه شود (کالای جدیدی که بعد از ثبتِ قرار تعریف شده
 * باشد هم طبیعتاً داخل «همه‌ی کالاها» می‌افتد).
 */
async function scopeWhereOfBatch(
  b: { scope: string; categoryId: number | null; variantIdsJson: string | null },
  client: Client = prisma
): Promise<Prisma.ProductVariantWhereInput> {
  const base: Prisma.ProductVariantWhereInput = { isActive: true }
  const scope = normalizeScope(b.scope)
  if (scope === 'CATEGORY') {
    const categoryId = Number(b.categoryId ?? 0)
    if (!categoryId) throw new BusinessError('دسته‌ی این زمان‌بندی پیدا نشد (شاید دسته حذف شده است).')
    const ids = await categoryWithDescendants(categoryId, client)
    return { ...base, product: { categoryId: { in: ids } } }
  }
  if (scope === 'VARIANTS') {
    const ids = variantIdsOfBatch(b.variantIdsJson)
    if (!ids.length)
      throw new BusinessError('کالاهای این زمان‌بندی ثبت نشده‌اند؛ دسته را حذف کنید و دوباره بسازید.')
    return { ...base, id: { in: ids } }
  }
  return base
}

export const priceAdjustService = {
  /**
   * -------------------------------------------------------------------------
   * پیش‌نمایش: **هیچ چیزی را عوض نمی‌کند.**
   *
   * همه‌ی کالاهای دامنه برمی‌گردند، حتی آن‌هایی که لمس نمی‌شوند (با `skipReason`)،
   * چون «چرا قیمت این ۳ کالا عوض نشد؟» سوال بعدیِ قطعیِ مدیر است.
   * -------------------------------------------------------------------------
   */
  async preview(input: PriceAdjustInput): Promise<PriceAdjustPreview> {
    const rule = ruleOf(input)
    const { where, scope, categoryName } = await scopeWhere(input)
    const target = rule.target ?? 'SALE'

    const variants = await loadAllProductVariants(prisma, where, {
      id: true,
      code: true,
      barcode: true,
      size: true,
      color: true,
      salePrice: true,
      purchasePrice: true,
      product: { select: { name: true, category: { select: { name: true } } } }
    })

    const lines: PriceAdjustLine[] = []
    let oldTotal = 0
    let newTotal = 0
    let changedCount = 0
    let zeroPrice = 0
    let underFloor = 0

    for (const v of variants) {
      // 🔴 نشست ۱۸۱ — ریشه‌ی یک باگ واقعی: `v` این‌جا `any` است، پس typecheck ندید
      // که `oldPrice` بعد از مهاجرت `bigint` است. دو پیامد داشت:
      //   ۱) `newP === oldPrice` (number در برابر bigint) **همیشه false** ⇒ حتی
      //      کالایی که قیمتش عوض نشده بود بازنویسی و در سابقه ثبت می‌شد.
      //   ۲) `newP - oldPrice` با «Cannot mix BigInt» در زمان اجرا می‌ترکید.
      const oldPrice = toNumberRial(target === 'PURCHASE' ? v.purchasePrice : v.salePrice)
      const newP = nextPrice(oldPrice, rule)
      assertAdjustedPrice(newP, oldPrice, variantTitle(v))
      const delta = newP - oldPrice
      let skipReason: string | null = null
      if (delta === 0) {
        if (oldPrice <= 0) {
          zeroPrice++
          skipReason = 'قیمت این کالا صفر است؛ درصد روی صفر هم صفر می‌ماند.'
        } else if (rule.minPrice && oldPrice <= rule.minPrice) {
          underFloor++
          skipReason = `قیمت این کالا از کف تعیین‌شده (${money(rule.minPrice)} ریال) بیشتر نیست، پس لمس نشد.`
        } else {
          skipReason = 'تغییری حاصل نمی‌شود (مقدار بعد از رُند همان قیمت فعلی است).'
        }
      }
      oldTotal += oldPrice
      newTotal += newP
      if (delta !== 0) changedCount++
      lines.push({
        variantId: v.id,
        name: variantTitle(v),
        code: v.code,
        barcode: v.barcode,
        categoryName: v.product?.category?.name ?? 'بدون دسته',
        oldPrice,
        newPrice: newP,
        delta,
        percent: oldPrice > 0 ? Math.round((delta / oldPrice) * 1000) / 10 : 0,
        unchanged: delta === 0,
        skipReason
      })
    }

    assertDeltaTotal(newTotal - oldTotal)
    const warnings: string[] = []
    if (!variants.length)
      warnings.push('در این دامنه هیچ کالای فعالی پیدا نشد؛ انتخاب دسته یا فهرست کالاها را بررسی کنید.')
    if (zeroPrice)
      warnings.push(
        `${faDigits(zeroPrice)} کالا قیمتشان صفر است و لمس نمی‌شوند. برای این‌ها از حالت «مبلغ ثابت» استفاده کنید، نه درصد.`
      )
    if (underFloor)
      warnings.push(`${faDigits(underFloor)} کالا زیر «کف قیمت» بودند و دست‌نخورده می‌مانند.`)
    if (scope === 'ALL' && changedCount > 0)
      warnings.push(
        `این کار قیمت ${faDigits(changedCount)} کالا را همین حالا عوض می‌کند. اگر اشتباه شد، از تب «سابقه‌ی تغییرات» ` +
          'همین دسته را با یک کلیک به قیمت‌های قبلش برگردانید.'
      )

    return {
      title: titleOf(rule, scope, categoryName, variants.length),
      scopeLabel: PRICE_ADJUST_SCOPE_LABELS[scope],
      targetLabel: PRICE_ADJUST_TARGET_LABELS[target],
      lines,
      count: variants.length,
      changedCount,
      oldTotal,
      newTotal,
      deltaTotal: newTotal - oldTotal,
      warnings
    }
  },

  /**
   * -------------------------------------------------------------------------
   * اعمال واقعی.
   *
   * همه‌چیز در **یک تراکنش** است: یا هر سه چیز (قیمت‌های جدید + دسته‌ی سابقه +
   * ردیف‌های قیمت قبلی) ثبت می‌شوند، یا هیچ‌کدام. حالت نیمه‌کاره — که در آن
   * قیمت‌ها عوض شده باشند ولی سابقه‌ی بازگردانی نداشته باشیم — بدترین حالت
   * ممکن است و عمداً غیرقابل‌وقوع نگه داشته شده.
   *
   * قیمت‌ها دوباره *داخل* تراکنش خوانده می‌شوند، نه از پیش‌نمایش: بین دیدن
   * پیش‌نمایش و زدن دکمه ممکن است قیمت یک کالا در پنل کالاها عوض شده باشد و
   * نوشتن عددِ کهنه، همان تغییر را بی‌صدا پاک می‌کرد.
   * -------------------------------------------------------------------------
   */
  async apply(input: PriceAdjustInput): Promise<PriceAdjustResult> {
    const rule = ruleOf(input)
    const { where, scope, categoryName } = await scopeWhere(input)
    const target = rule.target ?? 'SALE'
    const note = clean(input?.note) || null
    // مورد ۱ — زمان‌بندی: هر دو سرِ بازه اختیاری‌اند (خالی = رفتار همیشگی)
    const now = new Date()
    const win = scheduleOf(input, now)
    const variantIds =
      normalizeScope(input?.scope) === 'VARIANTS'
        ? [...new Set((input?.variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
        : []
    // نشست ۱۵۰ · بند ۴-۳۹ — بعد از validation ورودی، پیش از هر نوشتن/تراکنش
    const gate = await adjustGate(input?.password, 'تغییر گروهی قیمت')

    /**
     * -----------------------------------------------------------------------
     * حالت «شروع در آینده»: فقط یک *قرار* ثبت می‌شود.
     *
     * عمداً هیچ قیمتی لمس نمی‌شود و هیچ ردیف `PriceChangeItem` ای ساخته
     * نمی‌گردد؛ قیمت «قبل»ِ هر کالا باید همان لحظه‌ی واقعیِ شروع خوانده شود
     * (دلیل کامل در توضیح بالای `scheduleOf`).
     * -----------------------------------------------------------------------
     */
    if (isFutureStart(win, now)) {
      const count = await countProductVariants(prisma, where)
      if (!count)
        throw new BusinessError(
          'در این دامنه هیچ کالای فعالی پیدا نشد؛ زمان‌بندی ثبت نشد. انتخاب دسته یا فهرست کالاها را بررسی کنید.'
        )
      const title = titleOf(rule, scope, categoryName, count)
      const batch = await prisma.priceChangeBatch.create({
        data: {
          kind: rule.kind,
          mode: rule.mode,
          value: rule.value,
          target,
          scope,
          categoryId: scope === 'CATEGORY' ? Number(input?.categoryId) : null,
          categoryName,
          roundStep: Math.max(1, Math.round(rule.round ?? 1)),
          minPrice: Math.max(0, Math.round(rule.minPrice ?? 0)),
          title,
          note,
          itemCount: 0,
          deltaTotal: 0,
          userId: input?.userId ?? null,
          at: now,
          atJalali: toJalaliDate(now),
          atTime: toClock(now),
          state: 'SCHEDULED',
          startAt: win.startAt,
          startAtJalali: win.startJalali,
          startAtTime: win.startTime,
          endAt: win.endAt,
          endAtJalali: win.endJalali,
          endAtTime: win.endTime,
          variantIdsJson: variantIds.length ? JSON.stringify(variantIds) : null
        }
      })
      await audit(prisma, {
        action: AuditAction.PRICE_BULK_ADJUST,
        entity: 'PriceChangeBatch',
        entityId: batch.id,
        userId: input?.userId ?? null,
        after: JSON.stringify({ batchId: batch.id, state: 'SCHEDULED', startAt: win.startAt, endAt: win.endAt }),
        note: `زمان‌بندی «${title}» ثبت شد — ${scheduleLabelOf({
          startAtJalali: win.startJalali,
          startAtTime: win.startTime,
          endAtJalali: win.endJalali,
          endAtTime: win.endTime
        })}${gateNote(gate)}`
      }).catch(() => undefined)

      // زمان‌بند را همان لحظه بیدار می‌کنیم تا تایمرش با این قرارِ تازه هم‌تراز شود
      wakeScheduler()

      return {
        batchId: batch.id,
        changedCount: 0,
        deltaTotal: 0,
        title,
        message:
          `زمان‌بندی ثبت شد: «${title}» دقیقاً در ${faDigits(win.startJalali ?? '')} ساعت ` +
          `${faDigits(win.startTime ?? '')} خودکار اعمال می‌شود` +
          (win.endAt
            ? ` و در ${faDigits(win.endJalali ?? '')} ساعت ${faDigits(win.endTime ?? '')} خودکار به قیمت‌های قبل برمی‌گردد.`
            : ' و تا وقتی خودتان «بازگردانی» نزنید باقی می‌ماند.') +
          `\nهمین حالا هیچ قیمتی عوض نشده است (${faDigits(count)} کالا در دامنه‌ی این قرار هستند). ` +
          'ردیفش با وضعیت «زمان‌بندی‌شده» در سابقه‌ی همین صفحه دیده می‌شود و تا لحظه‌ی شروع قابل ویرایش یا حذف است.'
      } satisfies PriceAdjustResult
    }

    return prisma.$transaction(async (tx) => {
      const variants = await loadAllProductVariants(tx, where, {
        id: true,
        code: true,
        size: true,
        color: true,
        salePrice: true,
        purchasePrice: true,
        product: { select: { name: true } }
      })
      if (!variants.length)
        throw new BusinessError('در این دامنه هیچ کالای فعالی پیدا نشد؛ هیچ قیمتی تغییر نکرد.')

      const changes: { variantId: number; name: string; code: string; oldPrice: number; newPrice: number }[] = []
      for (const v of variants) {
        // 🔴 نشست ۱۸۱ — ریشه‌ی یک باگ واقعی: `v` این‌جا `any` است، پس typecheck ندید
      // که `oldPrice` بعد از مهاجرت `bigint` است. دو پیامد داشت:
      //   ۱) `newP === oldPrice` (number در برابر bigint) **همیشه false** ⇒ حتی
      //      کالایی که قیمتش عوض نشده بود بازنویسی و در سابقه ثبت می‌شد.
      //   ۲) `newP - oldPrice` با «Cannot mix BigInt» در زمان اجرا می‌ترکید.
      const oldPrice = toNumberRial(target === 'PURCHASE' ? v.purchasePrice : v.salePrice)
        const newP = nextPrice(oldPrice, rule)
        if (newP === oldPrice) continue
        assertAdjustedPrice(newP, oldPrice, variantTitle(v))
        changes.push({ variantId: v.id, name: variantTitle(v), code: v.code, oldPrice, newPrice: newP })
      }

      if (!changes.length)
        throw new BusinessError(
          'با این مقدار، قیمت هیچ کالایی عوض نمی‌شود (مثلاً همه‌ی قیمت‌ها صفرند یا زیر کف قیمت). ' +
            'هیچ تغییری ثبت نشد.'
        )

      const at = new Date()
      const deltaTotal = changes.reduce((s, c) => s + (c.newPrice - c.oldPrice), 0)
      assertDeltaTotal(deltaTotal)
      const title = titleOf(rule, scope, categoryName, variants.length)

      const batch = await tx.priceChangeBatch.create({
        data: {
          kind: rule.kind,
          mode: rule.mode,
          value: rule.value,
          target,
          scope,
          categoryId: scope === 'CATEGORY' ? Number(input?.categoryId) : null,
          categoryName,
          roundStep: Math.max(1, Math.round(rule.round ?? 1)),
          minPrice: Math.max(0, Math.round(rule.minPrice ?? 0)),
          title,
          note,
          itemCount: changes.length,
          deltaTotal,
          userId: input?.userId ?? null,
          at,
          atJalali: toJalaliDate(at),
          atTime: toClock(at),
          /**
           * مورد ۱ — «الان اعمال شود ولی سر ساعت فلان خودکار برگردد» یک حالت
           * کاملاً معتبر است: شروع خالی/گذشته + پایانِ آینده. پس زمان پایان
           * همین‌جا ذخیره می‌شود و زمان‌بند سر همان لحظه برش می‌گرداند.
           */
          state: 'APPLIED',
          startAt: win.startAt ?? at,
          startAtJalali: win.startJalali,
          startAtTime: win.startTime,
          endAt: win.endAt,
          endAtJalali: win.endJalali,
          endAtTime: win.endTime,
          variantIdsJson: variantIds.length ? JSON.stringify(variantIds) : null
        }
      })

      for (const c of changes) {
        await tx.productVariant.update({
          where: { id: c.variantId },
          data: target === 'PURCHASE' ? { purchasePrice: c.newPrice } : { salePrice: c.newPrice }
        })
        await tx.priceChangeItem.create({
          data: {
            batchId: batch.id,
            variantId: c.variantId,
            name: c.name,
            code: c.code,
            oldPrice: c.oldPrice,
            newPrice: c.newPrice
          }
        })
      }

      await audit(tx, {
        action: AuditAction.PRICE_BULK_ADJUST,
        entity: 'PriceChangeBatch',
        entityId: batch.id,
        userId: input?.userId ?? null,
        after: JSON.stringify({ batchId: batch.id, itemCount: changes.length, deltaTotal, title }),
        note: title + (note ? ` · ${note}` : '') + gateNote(gate)
      })

      const sign = deltaTotal >= 0 ? '+' : '−'
      if (win.endAt) wakeScheduler()
      return {
        batchId: batch.id,
        changedCount: changes.length,
        deltaTotal,
        title,
        message:
          `${title} انجام شد: قیمت ${faDigits(changes.length)} کالا عوض شد ` +
          `(جمع اختلاف ${sign} ${money(Math.abs(deltaTotal))} ریال). ` +
          (win.endAt
            ? `این تغییر در ${faDigits(win.endJalali ?? '')} ساعت ${faDigits(win.endTime ?? '')} ` +
              'خودکار به قیمت‌های قبل برمی‌گردد (لازم نیست خودتان «بازگردانی» بزنید).'
            : 'اگر اشتباه بود، از تب «سابقه‌ی تغییرات» همین دسته را به قیمت‌های قبلش برگردانید.')
      } satisfies PriceAdjustResult
    }, TX_OPTIONS)
  },

  /** سابقه‌ی دسته‌های تغییر قیمت (جدیدترین اول). */
  async batches(filter: { take?: number; onlyRevertable?: boolean } = {}): Promise<PriceAdjustBatchRow[]> {
    const rows = await prisma.priceChangeBatch.findMany({
      where: filter?.onlyRevertable ? { revertedAt: null } : undefined,
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: Math.max(1, Math.min(2000, Math.round(Number(filter?.take) || 300)))
    })

    /**
     * هشدار «دسته‌ی جدیدتری روی همین کالاها اجرا شده».
     *
     * بازگردانی، قیمت را به مقدار *قبل از همین دسته* برمی‌گرداند. اگر بعدش
     * دسته‌ی دیگری هم روی همان کالا اجرا شده باشد، بازگردانی آن یکی را هم عملاً
     * پاک می‌کند. این را نمی‌شود ممنوع کرد (گاهی دقیقاً همین خواسته‌ی مدیر است)،
     * ولی *باید* گفته شود. یک کوئری گروهی، نه N کوئری.
     */
    const ids = rows.map((r) => r.id)
    const laterByBatch = new Map<number, number>()
    if (ids.length) {
      const items: { batchId: number; variantId: number }[] = []
      for (const chunk of chunksOf(ids))
        items.push(
          ...(await prisma.priceChangeItem.findMany({
            where: { batchId: { in: chunk } },
            select: { batchId: true, variantId: true }
          }))
        )
      const variantsOf = new Map<number, Set<number>>()
      for (const it of items) {
        const set = variantsOf.get(it.batchId) ?? new Set<number>()
        set.add(it.variantId)
        variantsOf.set(it.batchId, set)
      }
      const order = [...rows].sort((a, b) => a.id - b.id)
      for (let i = 0; i < order.length; i++) {
        const mine = variantsOf.get(order[i].id)
        if (!mine?.size) continue
        let overlap = 0
        for (let j = i + 1; j < order.length; j++) {
          // فقط دسته‌ای که *همین حالا در جریان* است می‌تواند روی این یکی سایه بیندازد
          if (normalizeAdjustState(order[j].state, order[j].revertedAt) !== 'APPLIED') continue
          const other = variantsOf.get(order[j].id)
          if (!other) continue
          for (const v of other) if (mine.has(v)) overlap++
        }
        if (overlap > 0) laterByBatch.set(order[i].id, overlap)
      }
    }

    return rows.map((r) => {
      /**
       * مورد ۱ — وضعیت هر ردیف. `reverted` عمداً برای *هر* حالتی که دیگر در
       * جریان نیست true است (بازگردانی دستی یا پایان خودکار)، تا جدول قدیمیِ
       * سابقه و دکمه‌ی «بازگردانی» مو‌به‌مو مثل قبل رفتار کنند.
       */
      const state = normalizeAdjustState(r.state, r.revertedAt)
      const scheduled = state === 'SCHEDULED'
      const reverted = state === 'REVERTED' || state === 'ENDED'
      const overlap = laterByBatch.get(r.id) ?? 0
      const scheduleLabel = scheduleLabelOf({
        startAtJalali: r.startAtJalali ?? null,
        startAtTime: r.startAtTime ?? null,
        endAtJalali: r.endAtJalali ?? null,
        endAtTime: r.endAtTime ?? null
      })
      const stateLabel =
        state === 'ENDED'
          ? `پایان خودکار طبق زمان‌بندی${r.revertedAtJalali ? ` — ${faDigits(r.revertedAtJalali)}` : ''}`
          : state === 'SCHEDULED'
            ? `زمان‌بندی‌شده — ${scheduleLabel ?? 'بدون زمان'} · هنوز هیچ قیمتی عوض نشده`
            : state === 'REVERTED'
              ? `بازگردانی شده${r.revertedAtJalali ? ` — ${faDigits(r.revertedAtJalali)}` : ''}`
              : r.autoStartedAt
                ? 'در جریان — شروع خودکار طبق زمان‌بندی'
                : PRICE_ADJUST_STATE_LABELS[state]
      return {
        id: r.id,
        kind: r.kind,
        kindLabel: PRICE_ADJUST_KIND_LABELS[r.kind as PriceAdjustKind] ?? r.kind,
        mode: r.mode,
        // نشست ۱۸۱: ستون‌های مالی BigInt شده‌اند؛ قرارداد DTO رابط کاربری number است.
        value: toNumberRial(r.value),
        target: r.target,
        targetLabel: PRICE_ADJUST_TARGET_LABELS[r.target as PriceAdjustTarget] ?? r.target,
        scope: r.scope,
        scopeLabel: PRICE_ADJUST_SCOPE_LABELS[r.scope as PriceAdjustScope] ?? r.scope,
        categoryName: r.categoryName ?? null,
        title: r.title || `${PRICE_ADJUST_KIND_LABELS[r.kind as PriceAdjustKind] ?? r.kind} ${r.value}`,
        note: r.note ?? null,
        itemCount: r.itemCount,
        deltaTotal: toNumberRial(r.deltaTotal),
        dateJalali: r.atJalali || toJalaliDate(r.at),
        time: r.atTime || toClock(r.at),
        reverted,
        revertedAtJalali: r.revertedAtJalali ?? null,
        // دسته‌ی زمان‌بندی‌شده هنوز قیمتی عوض نکرده، پس «بازگردانی» برایش بی‌معناست
        canRevert: !reverted && !scheduled,
        revertWarning: reverted
          ? null
          : overlap > 0
            ? `بعد از این دسته، تغییر قیمت دیگری هم روی ${faDigits(overlap)} مورد از همین کالاها اجرا شده است. ` +
              'بازگردانی این دسته، آن تغییرِ جدیدترها را هم روی همان کالاها بی‌اثر می‌کند.'
            : null,
        // ---- مورد ۱ و مورد ۲ ----
        state,
        stateLabel,
        startAtJalali: r.startAtJalali ?? null,
        startAtTime: r.startAtTime ?? null,
        endAtJalali: r.endAtJalali ?? null,
        endAtTime: r.endAtTime ?? null,
        scheduleLabel,
        scheduled,
        autoStarted: !!r.autoStartedAt,
        autoEnded: !!r.autoEndedAt,
        /**
         * ویرایش دامنه فقط برای دسته‌ای معنا دارد که یا هنوز شروع نشده
         * (زمان‌بندی‌شده) یا همین حالا در جریان است. دسته‌ی تمام‌شده، یک *سند
         * گذشته* است و دست‌کاری دامنه‌اش هیچ اثری روی قیمت امروز ندارد.
         */
        canEdit: state === 'SCHEDULED' || state === 'APPLIED',
        editCount: r.editCount ?? 0,
        editedAtJalali: r.editedAtJalali ?? null,
        variantIds: normalizeScope(r.scope) === 'VARIANTS' ? variantIdsOfBatch(r.variantIdsJson) : null
      } satisfies PriceAdjustBatchRow
    })
  },

  /** کالاهای یک دسته‌ی ثبت‌شده (برای دیدن جزئیات و خروجی اکسل). */
  async batchLines(input: { batchId?: number } = {}): Promise<PriceAdjustLine[]> {
    const batchId = Number(input?.batchId ?? 0)
    if (!batchId) throw new BusinessError('دسته‌ی تغییر قیمت مشخص نشده است.')
    const rows = await prisma.priceChangeItem.findMany({ where: { batchId }, orderBy: { id: 'asc' } })
    return rows.map((r) => ({
      variantId: r.variantId,
      name: r.name || 'کالای حذف‌شده',
      code: r.code ?? '—',
      barcode: '—',
      categoryName: '—',
      oldPrice: toNumberRial(r.oldPrice),
      newPrice: toNumberRial(r.newPrice),
      // نشست ۱۸۱: اختلاف روی bigint حساب می‌شود (بدون افت دقت) و بعد به قرارداد
      // number این ردیف تبدیل می‌شود. درصد ذاتاً اعشاری است، پس با number.
      delta: toNumberRial(toRial(r.newPrice) - toRial(r.oldPrice)),
      percent:
        toRial(r.oldPrice) > 0n
          ? Math.round(((toNumberRial(r.newPrice) - toNumberRial(r.oldPrice)) / toNumberRial(r.oldPrice)) * 1000) / 10
          : 0,
      unchanged: toRial(r.newPrice) === toRial(r.oldPrice),
      skipReason: null
    }))
  },

  /**
   * -------------------------------------------------------------------------
   * بازگردانی یک دسته به قیمت‌های *قبل از خودش*.
   *
   * قیمتِ قبلی از `PriceChangeItem` نوشته می‌شود، نه از عکس کردن فرمول: با رُند
   * و کف قیمت، عکس فرمول هیچ‌وقت دقیقاً به عدد اول برنمی‌گردد.
   *
   * کالایی که از آن زمان *همیشگی* حذف شده باشد، رد می‌شود و در پیام گفته
   * می‌شود — نه این‌که کل بازگردانی با خطا بایستد.
   * -------------------------------------------------------------------------
   */
  async revert(
    input: { batchId?: number; userId?: number | null; password?: string | null } = {}
  ): Promise<PriceAdjustRevertResult> {
    const batchId = Number(input?.batchId ?? 0)
    if (!batchId) throw new BusinessError('دسته‌ی تغییر قیمت مشخص نشده است.')
    const gate = await adjustGate(input?.password, 'بازگردانی تغییر گروهی قیمت')

    return prisma.$transaction(async (tx) => {
      const batch = await tx.priceChangeBatch.findUnique({ where: { id: batchId }, include: { items: true } })
      if (!batch) throw new BusinessError('این دسته‌ی تغییر قیمت پیدا نشد؛ صفحه را تازه کنید.')
      const state = normalizeAdjustState(batch.state, batch.revertedAt)
      if (state === 'ENDED')
        throw new BusinessError(
          `این دسته در ${faDigits(batch.revertedAtJalali ?? '')} طبق زمان‌بندی خودکار به پایان رسیده و قیمت‌ها ` +
            'همان موقع به حالت قبل برگشته‌اند؛ چیزی برای بازگردانی نمانده است.'
        )
      if (state === 'REVERTED' || batch.revertedAt)
        throw new BusinessError(
          `این دسته قبلاً (${faDigits(batch.revertedAtJalali ?? '')}) بازگردانی شده است و دوباره بازگردانی نمی‌شود.`
        )
      if (state === 'SCHEDULED')
        throw new BusinessError(
          'این دسته فقط *زمان‌بندی* شده و هنوز هیچ قیمتی را عوض نکرده است، پس بازگردانی معنا ندارد. ' +
            'اگر نمی‌خواهید اجرا شود، همین ردیف را از سابقه حذف کنید.'
        )
      if (!batch.items.length) throw new BusinessError('این دسته هیچ کالایی ندارد؛ چیزی برای بازگردانی نیست.')

      const aliveSet = await aliveVariantIds(
        tx,
        batch.items.map((i) => i.variantId)
      )

      let restored = 0
      let missing = 0
      let deltaTotal = 0
      for (const item of batch.items) {
        if (!aliveSet.has(item.variantId)) {
          missing++
          continue
        }
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: batch.target === 'PURCHASE' ? { purchasePrice: item.oldPrice } : { salePrice: item.oldPrice }
        })
        deltaTotal += toNumberRial(toRial(item.oldPrice) - toRial(item.newPrice))
        restored++
      }

      const at = new Date()
      await tx.priceChangeBatch.update({
        where: { id: batch.id },
        data: { revertedAt: at, revertedAtJalali: toJalaliDate(at), state: 'REVERTED' }
      })

      await audit(tx, {
        action: AuditAction.PRICE_BULK_REVERT,
        entity: 'PriceChangeBatch',
        entityId: batch.id,
        userId: input?.userId ?? null,
        before: JSON.stringify({ batchId: batch.id, title: batch.title }),
        after: JSON.stringify({ restored, missing, deltaTotal }),
        note: `بازگردانی «${batch.title}» — قیمت ${restored} کالا به مقدار قبلش برگشت${gateNote(gate)}`
      })

      return {
        batchId: batch.id,
        restoredCount: restored,
        deltaTotal,
        message:
          `«${batch.title}» بازگردانی شد: قیمت ${faDigits(restored)} کالا به مقدار قبلش برگشت.` +
          (missing
            ? ` ${faDigits(missing)} کالا از آن زمان به‌طور همیشگی حذف شده‌اند و قابل بازگردانی نبودند.`
            : '')
      } satisfies PriceAdjustRevertResult
    }, TX_OPTIONS)
  },

  /**
   * =========================================================================
   * مورد ۱ — «اجرای قرارهای رسیده».
   *
   * دو کار، به همین ترتیب (ترتیب مهم است):
   *   ۱) هر دسته‌ی `SCHEDULED` که لحظه‌ی شروعش رسیده ⇒ همین حالا اعمال شود.
   *   ۲) هر دسته‌ی `APPLIED` که لحظه‌ی پایانش رسیده ⇒ همین حالا به قیمت قبل
   *      برگردد.
   * چون مرحله‌ی ۱ قبل از ۲ اجرا می‌شود، دسته‌ای که برنامه چند روز بسته بوده و
   * *هم* شروع و *هم* پایانش گذشته، در همین یک اجرا هر دو رویدادش ثبت می‌شود و
   * قیمت‌ها سر جای درست خودشان می‌مانند.
   *
   * هیچ خطایی بیرون نمی‌رود: یک قرارِ خراب (مثلاً دسته‌ای که کالاهایش حذف شده‌اند)
   * نباید جلوی بقیه‌ی قرارها یا باز شدن برنامه را بگیرد. خطا در کنسول می‌ماند و
   * همان دسته با یادداشت در سابقه‌ی سیستم علامت می‌خورد.
   * =========================================================================
   */
  async runDueSchedules(now = new Date()): Promise<{ started: number; ended: number; failed: number }> {
    const starts = await processDueSchedulePhase('START', now, startScheduledBatch)
    const ends = await processDueSchedulePhase('END', now, endScheduledBatch)
    return {
      started: starts.processed,
      ended: ends.processed,
      failed: starts.failed + ends.failed
    }
  },

  /**
   * نزدیک‌ترین «قرارِ بعدی» (شروع یا پایان). null = هیچ قراری در آینده نیست.
   * فقط برای تنظیم دقیقِ تایمر است و هیچ چیزی را عوض نمی‌کند.
   */
  async nextDueAt(): Promise<Date | null> {
    const [nextStart, nextEnd] = await Promise.all([
      prisma.priceChangeBatch.findFirst({
        where: { state: 'SCHEDULED', startAt: { not: null } },
        orderBy: { startAt: 'asc' },
        select: { startAt: true }
      }),
      prisma.priceChangeBatch.findFirst({
        where: { state: 'APPLIED', endAt: { not: null } },
        orderBy: { endAt: 'asc' },
        select: { endAt: true }
      })
    ])
    const times = [nextStart?.startAt ?? null, nextEnd?.endAt ?? null].filter(Boolean) as Date[]
    if (!times.length) return null
    return times.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b))
  },

  /**
   * =========================================================================
   * مورد ۲ — ویرایش *دامنه‌ی* یک دسته‌ی ثبت‌شده.
   *
   * قاعده‌ی سه‌بخشی (و هر سه بخش لازم است):
   *   • کالایی که از دامنه **بیرون می‌رود** ⇒ قیمتش به «قبل از همین دسته»
   *     برمی‌گردد و ردیفش از دسته پاک می‌شود (دیگر عضو این دسته نیست).
   *   • کالایی که در دامنه **می‌ماند** ⇒ مطلقاً لمس نمی‌شود. نه دوباره تخفیف
   *     می‌خورد و نه قیمتش جابه‌جا می‌شود؛ این مهم‌ترین تضمین این عملیات است.
   *   • کالایی که **تازه وارد** دامنه می‌شود ⇒ با همان قاعده‌ی خودِ دسته (همان
   *     درصد/مبلغ، همان رُند، همان کف قیمت) قیمت می‌گیرد و قیمت قبلش ثبت
   *     می‌شود، پس بازگردانیِ بعدی برای او هم دقیق است.
   *
   * فرمول دسته عمداً قابل ویرایش نیست: «۱۵٪ که به ۲۰٪ تبدیل شود» یعنی یک کارِ
   * دیگر، و درست‌ترش این است که همین دسته بازگردانی و یک دسته‌ی جدید ثبت شود
   * (وگرنه سابقه دیگر سند نیست). آنچه کاربر خواسته بود — «دامنه را کم/زیاد
   * کنم» — دقیقاً همین متد است.
   * =========================================================================
   */
  async editBatch(input: PriceAdjustEditInput): Promise<PriceAdjustEditResult> {
    const batchId = Number(input?.batchId ?? 0)
    if (!batchId) throw new BusinessError('دسته‌ی تغییر قیمت مشخص نشده است.')
    const scope = normalizeScope(input?.scope)
    const gate = await adjustGate(input?.password, 'ویرایش دامنه‌ی تغییر گروهی قیمت')

    return prisma.$transaction(async (tx) => {
      const batch = await tx.priceChangeBatch.findUnique({ where: { id: batchId }, include: { items: true } })
      if (!batch) throw new BusinessError('این دسته‌ی تغییر قیمت پیدا نشد؛ صفحه را تازه کنید.')
      const state = normalizeAdjustState(batch.state, batch.revertedAt)
      if (state === 'REVERTED' || state === 'ENDED')
        throw new BusinessError(
          'این دسته دیگر در جریان نیست (بازگردانی شده یا زمان‌بندی‌اش تمام شده)، پس تغییر دامنه‌اش هیچ اثری ' +
            'روی قیمت امروز ندارد. برای کار جدید، یک تغییر قیمت تازه ثبت کنید.'
        )

      // ---- دامنه‌ی جدید ----
      const rule = ruleOfBatch(batch)
      const target = normalizeTarget(batch.target)
      let categoryName: string | null = null
      let where: Prisma.ProductVariantWhereInput = { isActive: true }
      let variantIds: number[] = []

      if (scope === 'CATEGORY') {
        const categoryId = Number(input?.categoryId ?? 0)
        if (!Number.isInteger(categoryId) || categoryId <= 0)
          throw new BusinessError('دسته/زیردسته‌ی جدید را انتخاب کنید.')
        const cat = await tx.category.findUnique({ where: { id: categoryId }, select: { name: true } })
        if (!cat) throw new BusinessError('این دسته پیدا نشد؛ صفحه را تازه کنید.')
        categoryName = cat.name
        const ids = await categoryWithDescendants(categoryId, tx)
        where = { isActive: true, product: { categoryId: { in: ids } } }
      } else if (scope === 'VARIANTS') {
        variantIds = [
          ...new Set((input?.variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))
        ]
        if (!variantIds.length) throw new BusinessError('حداقل یک کالا را برای دامنه‌ی جدید انتخاب کنید.')
        where = { isActive: true, id: { in: variantIds } }
      }

      const inScope = await loadAllProductVariants(tx, where, {
        id: true,
        code: true,
        size: true,
        color: true,
        salePrice: true,
        purchasePrice: true,
        product: { select: { name: true } }
      })
      const inScopeIds = new Set(inScope.map((v) => v.id))

      /**
       * دسته‌ی *زمان‌بندی‌شده* هنوز هیچ قیمتی عوض نکرده، پس ویرایشش فقط یک
       * به‌روزرسانی دامنه است و هیچ عدد قیمتی جابه‌جا نمی‌شود.
       */
      if (state === 'SCHEDULED') {
        if (!inScope.length)
          throw new BusinessError('دامنه‌ی جدید هیچ کالای فعالی ندارد؛ زمان‌بندی دست‌نخورده ماند.')
        const at = new Date()
        const title = titleOf(rule, scope, categoryName, inScope.length)
        await tx.priceChangeBatch.update({
          where: { id: batch.id },
          data: {
            scope,
            categoryId: scope === 'CATEGORY' ? Number(input?.categoryId) : null,
            categoryName,
            variantIdsJson: variantIds.length ? JSON.stringify(variantIds) : null,
            title,
            editedAt: at,
            editedAtJalali: toJalaliDate(at),
            editCount: { increment: 1 }
          }
        })
        await audit(tx, {
          action: AuditAction.PRICE_BATCH_EDIT,
          entity: 'PriceChangeBatch',
          entityId: batch.id,
          userId: input?.userId ?? null,
          before: JSON.stringify({ scope: batch.scope, categoryId: batch.categoryId }),
          after: JSON.stringify({ scope, categoryId: input?.categoryId ?? null, count: inScope.length }),
          note: `ویرایش دامنه‌ی زمان‌بندی «${batch.title}» ⇒ ${title}`
        })
        return {
          batchId: batch.id,
          removedCount: 0,
          addedCount: 0,
          keptCount: inScope.length,
          itemCount: 0,
          deltaTotal: 0,
          title,
          message:
            `دامنه‌ی این زمان‌بندی عوض شد: از این پس روی ${faDigits(inScope.length)} کالا اعمال می‌شود. ` +
            'چون هنوز شروع نشده، هیچ قیمتی جابه‌جا نشد.'
        } satisfies PriceAdjustEditResult
      }

      // ---- ۱) کالاهایی که از دامنه بیرون رفته‌اند: قیمت به «قبل از این دسته» ----
      const out = batch.items.filter((i) => !inScopeIds.has(i.variantId))
      const aliveSet = await aliveVariantIds(
        tx,
        out.map((i) => i.variantId)
      )
      let removedCount = 0
      for (const item of out) {
        if (aliveSet.has(item.variantId)) {
          await tx.productVariant.update({
            where: { id: item.variantId },
            data: target === 'PURCHASE' ? { purchasePrice: item.oldPrice } : { salePrice: item.oldPrice }
          })
          removedCount++
        }
        await tx.priceChangeItem.delete({ where: { id: item.id } })
      }

      // ---- ۲) کالاهای تازه‌وارد: همان قاعده، روی قیمت همین لحظه‌شان ----
      const known = new Set(batch.items.filter((i) => inScopeIds.has(i.variantId)).map((i) => i.variantId))
      let addedCount = 0
      for (const v of inScope) {
        if (known.has(v.id)) continue
        // 🔴 نشست ۱۸۱ — ریشه‌ی یک باگ واقعی: `v` این‌جا `any` است، پس typecheck ندید
      // که `oldPrice` بعد از مهاجرت `bigint` است. دو پیامد داشت:
      //   ۱) `newP === oldPrice` (number در برابر bigint) **همیشه false** ⇒ حتی
      //      کالایی که قیمتش عوض نشده بود بازنویسی و در سابقه ثبت می‌شد.
      //   ۲) `newP - oldPrice` با «Cannot mix BigInt» در زمان اجرا می‌ترکید.
      const oldPrice = toNumberRial(target === 'PURCHASE' ? v.purchasePrice : v.salePrice)
        const newP = nextPrice(oldPrice, rule)
        if (newP === oldPrice) continue
        assertAdjustedPrice(newP, oldPrice, variantTitle(v))
        await tx.productVariant.update({
          where: { id: v.id },
          data: target === 'PURCHASE' ? { purchasePrice: newP } : { salePrice: newP }
        })
        await tx.priceChangeItem.create({
          data: {
            batchId: batch.id,
            variantId: v.id,
            name: variantTitle(v),
            code: v.code,
            oldPrice,
            newPrice: newP
          }
        })
        addedCount++
      }

      // ---- ۳) جمع‌بندی دوباره‌ی خودِ دسته ----
      const items = await tx.priceChangeItem.findMany({ where: { batchId: batch.id } })
      const deltaTotal = items.reduce((sum, i) => sum + toNumberRial(toRial(i.newPrice) - toRial(i.oldPrice)), 0)
      assertDeltaTotal(deltaTotal)
      const at = new Date()
      const title = titleOf(rule, scope, categoryName, inScope.length)
      await tx.priceChangeBatch.update({
        where: { id: batch.id },
        data: {
          scope,
          categoryId: scope === 'CATEGORY' ? Number(input?.categoryId) : null,
          categoryName,
          variantIdsJson: variantIds.length ? JSON.stringify(variantIds) : null,
          title,
          itemCount: items.length,
          deltaTotal,
          editedAt: at,
          editedAtJalali: toJalaliDate(at),
          editCount: { increment: 1 }
        }
      })

      await audit(tx, {
        action: AuditAction.PRICE_BATCH_EDIT,
        entity: 'PriceChangeBatch',
        entityId: batch.id,
        userId: input?.userId ?? null,
        before: JSON.stringify({ scope: batch.scope, itemCount: batch.itemCount, deltaTotal: batch.deltaTotal }),
        after: JSON.stringify({ scope, itemCount: items.length, deltaTotal, removedCount, addedCount }),
        note:
          `ویرایش دامنه‌ی «${batch.title}» ⇒ ${title} — قیمت ${removedCount} کالا به حالت قبل برگشت و ` +
          `${addedCount} کالای جدید وارد این دسته شد` +
          gateNote(gate)
      })

      return {
        batchId: batch.id,
        removedCount,
        addedCount,
        keptCount: known.size,
        itemCount: items.length,
        deltaTotal,
        title,
        message:
          `دامنه‌ی این دسته عوض شد: «${title}».\n` +
          `• ${faDigits(removedCount)} کالا از دامنه بیرون رفت و قیمتشان به حالت قبل از این دسته برگشت.\n` +
          `• ${faDigits(addedCount)} کالا تازه وارد دامنه شد و با همان قاعده قیمت گرفت.\n` +
          `• ${faDigits(known.size)} کالا در دامنه ماند و دست‌نخورده باقی ماند.`
      } satisfies PriceAdjustEditResult
    }, TX_OPTIONS)
  },

  /**
   * =========================================================================
   * مورد ۲ — حذف یک یا چند ردیف سابقه.
   *
   * `restorePrices` پاسخِ همان پرسشی است که UI صریحاً از کاربر می‌پرسد:
   *   true  ⇒ اول قیمت کالاهای هر دسته به حالت قبل برمی‌گردد، بعد ردیف پاک
   *           می‌شود (پس «حذف» = بازگردانی + پاک کردن سند).
   *   false ⇒ قیمت‌ها *دست‌نخورده* می‌مانند و فقط ردیف سابقه پاک می‌شود.
   *
   * ⚠️ نکته‌ای که در UI هم نوشته شده: با انتخاب حالت دوم، قیمت فعلی کالاها همان
   * قیمت تخفیف‌خورده می‌ماند ولی *راه بازگشتش پاک می‌شود* (چون «قیمت قبل» فقط در
   * همین ردیف‌ها ذخیره شده بود). این یک هشدار است، نه یک منع: تصمیم مال مالک
   * نرم‌افزار است.
   * =========================================================================
   */
  async deleteBatches(input: PriceAdjustDeleteInput): Promise<PriceAdjustDeleteResult> {
    const ids = [...new Set((input?.batchIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))]
    if (!ids.length) throw new BusinessError('هیچ ردیفی از سابقه انتخاب نشده است.')
    const restore = input?.restorePrices === true
    const gate = await adjustGate(input?.password, 'حذف سابقه‌ی تغییر گروهی قیمت')

    return prisma.$transaction(async (tx) => {
      const batches: any[] = []
      for (const chunk of chunksOf(ids))
        batches.push(...(await tx.priceChangeBatch.findMany({ where: { id: { in: chunk } }, include: { items: true } })))
      if (!batches.length) throw new BusinessError('این ردیف‌ها پیدا نشدند؛ صفحه را تازه کنید.')

      let restoredCount = 0
      const restoredTitles: string[] = []
      if (restore) {
        // جدیدترین اول: اگر دو دسته روی یک کالا باشند، آخرین اثر اول برداشته شود
        const order = [...batches].sort((a, b) => b.id - a.id)
        for (const batch of order) {
          const state = normalizeAdjustState(batch.state, batch.revertedAt)
          // دسته‌ای که اصلاً در جریان نیست (زمان‌بندی‌شده / بازگردانی‌شده / تمام‌شده)
          // قیمتی برای برگرداندن ندارد و بی‌صدا رد می‌شود
          if (state !== 'APPLIED' || !batch.items.length) continue
          const aliveSet = await aliveVariantIds(
            tx,
            batch.items.map((i: any) => i.variantId)
          )
          for (const item of batch.items) {
            if (!aliveSet.has(item.variantId)) continue
            await tx.productVariant.update({
              where: { id: item.variantId },
              data:
                normalizeTarget(batch.target) === 'PURCHASE'
                  ? { purchasePrice: item.oldPrice }
                  : { salePrice: item.oldPrice }
            })
            restoredCount++
          }
          restoredTitles.push(batch.title)
        }
      }

      // ردیف‌های اقلام با onDelete: Cascade خودشان پاک می‌شوند
      for (const chunk of chunksOf(batches.map((b) => b.id)))
        await tx.priceChangeBatch.deleteMany({ where: { id: { in: chunk } } })

      await audit(tx, {
        action: AuditAction.PRICE_HISTORY_DELETE,
        entity: 'PriceChangeBatch',
        userId: input?.userId ?? null,
        before: JSON.stringify(batches.map((b) => ({ id: b.id, title: b.title, itemCount: b.itemCount }))),
        after: JSON.stringify({ deleted: batches.length, restorePrices: restore, restoredCount }),
        note:
          `حذف ${batches.length} ردیف از سابقه‌ی تغییر قیمت — ` +
          (restore ? `قیمت ${restoredCount} کالا هم به حالت قبل برگشت` : 'قیمت‌ها دست‌نخورده ماندند') +
          gateNote(gate)
      })

      return {
        deletedCount: batches.length,
        restoredCount,
        message:
          `${faDigits(batches.length)} ردیف از سابقه‌ی تغییر قیمت حذف شد.` +
          (restore
            ? ` قیمت ${faDigits(restoredCount)} کالا هم به حالت قبل از این دسته‌ها برگشت.`
            : ' قیمت کالاها دست‌نخورده ماند؛ فقط سند این تغییرها پاک شد (پس راه بازگردانی خودکارشان هم دیگر وجود ندارد).')
      } satisfies PriceAdjustDeleteResult
    }, TX_OPTIONS)
  },

  /**
   * =========================================================================
   * مورد ۱ (بخش دوم) — «این قیمت، نتیجه‌ی چه تخفیفی است؟»
   *
   * مسئله‌ی مالک نرم‌افزار: تخفیف گروهی واقعاً `salePrice` را پایین می‌آورد، پس
   * پنل فروش قیمت جدید را نشان می‌دهد — ولی مشتری هیچ‌جا نمی‌بیند که این قیمت
   * «۱۵٪ تخفیف‌خورده» است. تفاوت «تخفیف» و «کاهش قیمت» دقیقاً همین نمایش است.
   *
   * چطور بدون ذخیره‌ی هیچ داده‌ی جدیدی حساب می‌شود:
   *   • فقط دسته‌های `kind = DISCOUNT` که **همین حالا در جریان** (`APPLIED`) و
   *     روی «قیمت فروش» هستند در نظر گرفته می‌شوند. «کاهش قیمت» (DECREASE)
   *     عمداً شمرده نمی‌شود — چون معنایش همین است که تخفیفی نمایش داده نشود.
   *   • برای هر کالا، زنجیره از جدید به قدیم دنبال می‌شود: اگر قیمت فعلی کالا
   *     *دقیقاً* همان «قیمت جدید»ِ ثبت‌شده در آن دسته باشد، پس آن تخفیف هنوز
   *     روی کالا نشسته و «قیمت قبل»ش مبنا می‌شود؛ و همین‌طور عقب‌تر (پس دو تخفیف
   *     پشت‌سرهم هم درست جمع می‌شوند).
   *   • اگر جایی زنجیره نخواند (مثلاً بعدش قیمت را دستی عوض کرده‌اید)، هیچ
   *     تخفیفی نمایش داده نمی‌شود. این محافظه‌کاری عمدی است: بهتر است چیزی نگوییم
   *     تا این‌که به مشتری عددِ نادرست نشان بدهیم.
   * =========================================================================
   */
  async activeDiscounts(input: { variantIds?: number[] | null } = {}): Promise<ActiveDiscountInfo[]> {
    const wanted = [
      ...new Set((input?.variantIds ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0))
    ]

    const batches = await prisma.priceChangeBatch.findMany({
      where: { state: 'APPLIED', kind: 'DISCOUNT', target: 'SALE' },
      orderBy: { id: 'asc' },
      select: { id: true, title: true, mode: true, value: true, endAtJalali: true, endAtTime: true, endAt: true }
    })
    if (!batches.length) return []

    const items: any[] = []
    // نشست ۱۷۶ · S176-D1 — شناسه‌ی دسته‌ها و کالاهای درخواستی دسته‌ای (هر ترکیب جدا صفحه‌خوانی می‌شود)
    const wantedChunks: (number[] | null)[] = wanted.length ? chunksOf(wanted) : [null]
    for (const batchChunk of chunksOf(batches.map((b) => b.id))) {
      for (const wantedChunk of wantedChunks) {
        const itemWhere = {
          batchId: { in: batchChunk },
          ...(wantedChunk ? { variantId: { in: wantedChunk } } : {})
        }
        for (let skip = 0; ; skip += PRICE_ADJUST_READ_BATCH) {
          const batch = await prisma.priceChangeItem.findMany({
            where: itemWhere,
            select: { batchId: true, variantId: true, oldPrice: true, newPrice: true },
            orderBy: { id: 'asc' },
            skip,
            take: PRICE_ADJUST_READ_BATCH
          })
          items.push(...batch)
          if (batch.length < PRICE_ADJUST_READ_BATCH) break
        }
      }
    }
    if (!items.length) return []

    const variantIds = [...new Set(items.map((i) => i.variantId))]
    const variants: { id: number; salePrice: bigint }[] = []
    for (const chunk of chunksOf(variantIds))
      variants.push(
        ...(await prisma.productVariant.findMany({
          where: { id: { in: chunk }, isActive: true },
          select: { id: true, salePrice: true }
        }))
      )
    // نشست ۱۸۱: قیمت‌ها در نگاشت به number تبدیل می‌شوند تا بقیه‌ی این تابع
    // (که با number کار می‌کند) دست‌نخورده بماند.
    const priceOf = new Map(variants.map((v) => [v.id, toNumberRial(v.salePrice)]))

    // batchId ⇒ ردیف همان دسته (برای برچسب و زمان پایان)
    const batchById = new Map(batches.map((b) => [b.id, b]))
    // variantId ⇒ (batchId ⇒ item)
    const byVariant = new Map<number, Map<number, { oldPrice: number; newPrice: number }>>()
    for (const it of items) {
      const m = byVariant.get(it.variantId) ?? new Map()
      m.set(it.batchId, { oldPrice: toNumberRial(it.oldPrice), newPrice: toNumberRial(it.newPrice) })
      byVariant.set(it.variantId, m)
    }
    const newestFirst = [...batches].sort((a, b) => b.id - a.id)

    const out: ActiveDiscountInfo[] = []
    for (const [variantId, perBatch] of byVariant) {
      const salePrice = priceOf.get(variantId)
      if (salePrice == null) continue
      let base = salePrice
      const titles: string[] = []
      let endsAt: { at: Date | null; jalali: string | null; time: string | null } | null = null
      for (const b of newestFirst) {
        const it = perBatch.get(b.id)
        if (!it) continue
        if (it.newPrice !== base) continue // زنجیره خوانا نیست ⇒ همین‌جا بس
        base = it.oldPrice
        titles.push(b.title)
        if (b.endAt && (!endsAt?.at || b.endAt.getTime() < endsAt.at.getTime()))
          endsAt = { at: b.endAt, jalali: b.endAtJalali ?? null, time: b.endAtTime ?? null }
      }
      const discountAmount = base - salePrice
      if (discountAmount <= 0 || base <= 0) continue
      const discountPercent = Math.round((discountAmount / base) * 1000) / 10
      out.push({
        variantId,
        basePrice: base,
        salePrice,
        discountAmount,
        discountPercent,
        label: `${faDigits(String(discountPercent).replace(/\.0$/, ''))}٪ تخفیف · ${money(discountAmount)} ریال`,
        batchTitles: titles.reverse(),
        endsLabel: endsAt?.jalali ? `تا ${faDigits(endsAt.jalali)} ساعت ${faDigits(endsAt.time ?? '23:59')}` : null
      })
    }
    return out
  }
}

/**
 * ---------------------------------------------------------------------------
 * اعمال واقعیِ یک دسته‌ی زمان‌بندی‌شده، سر لحظه‌ی شروعش.
 *
 * منطقش عیناً همان `apply` است، با یک تفاوت مهم: قیمت‌ها *همین حالا* خوانده
 * می‌شوند، نه لحظه‌ی ثبت قرار. پس اگر بین دیروز و امروز قیمت کالایی دستی عوض
 * شده باشد، «قیمت قبل»ِ ثبت‌شده همان قیمت واقعی امروز است و بازگردانی، آن تغییر
 * دستی را بی‌صدا پاک نمی‌کند.
 * ---------------------------------------------------------------------------
 */
async function startScheduledBatch(batchId: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.priceChangeBatch.findUnique({ where: { id: batchId } })
    if (!batch) return 0
    if (normalizeAdjustState(batch.state, batch.revertedAt) !== 'SCHEDULED') return 0

    const rule = ruleOfBatch(batch)
    const target = normalizeTarget(batch.target)
    const where = await scopeWhereOfBatch(batch, tx)
    const variants = await loadAllProductVariants(tx, where, {
      id: true,
      code: true,
      size: true,
      color: true,
      salePrice: true,
      purchasePrice: true,
      product: { select: { name: true } }
    })

    let deltaTotal = 0
    let changed = 0
    for (const v of variants) {
      // 🔴 نشست ۱۸۱ — ریشه‌ی یک باگ واقعی: `v` این‌جا `any` است، پس typecheck ندید
      // که `oldPrice` بعد از مهاجرت `bigint` است. دو پیامد داشت:
      //   ۱) `newP === oldPrice` (number در برابر bigint) **همیشه false** ⇒ حتی
      //      کالایی که قیمتش عوض نشده بود بازنویسی و در سابقه ثبت می‌شد.
      //   ۲) `newP - oldPrice` با «Cannot mix BigInt» در زمان اجرا می‌ترکید.
      const oldPrice = toNumberRial(target === 'PURCHASE' ? v.purchasePrice : v.salePrice)
      const newP = nextPrice(oldPrice, rule)
      if (newP === oldPrice) continue
      assertAdjustedPrice(newP, oldPrice, variantTitle(v))
      await tx.productVariant.update({
        where: { id: v.id },
        data: target === 'PURCHASE' ? { purchasePrice: newP } : { salePrice: newP }
      })
      await tx.priceChangeItem.create({
        data: { batchId: batch.id, variantId: v.id, name: variantTitle(v), code: v.code, oldPrice, newPrice: newP }
      })
      deltaTotal += newP - oldPrice
      changed++
    }

    assertDeltaTotal(deltaTotal)
    const at = new Date()
    await tx.priceChangeBatch.update({
      where: { id: batch.id },
      data: { state: 'APPLIED', autoStartedAt: at, itemCount: changed, deltaTotal }
    })

    await audit(tx, {
      action: AuditAction.PRICE_SCHEDULE_START,
      entity: 'PriceChangeBatch',
      entityId: batch.id,
      userId: batch.userId ?? null,
      after: JSON.stringify({ batchId: batch.id, changed, deltaTotal }),
      note:
        `شروع خودکار طبق زمان‌بندی — «${batch.title}»: قیمت ${changed} کالا عوض شد` +
        (batch.endAtJalali ? ` · پایان خودکار: ${batch.endAtJalali} ساعت ${batch.endAtTime ?? ''}` : '') +
        (changed === 0 ? ' (با این مقدار قیمت هیچ کالایی عوض نشد)' : '')
    })
    return changed
  }, TX_OPTIONS)
}

/**
 * پایان خودکار: قیمت‌ها به مقدار *قبل از همین دسته* برمی‌گردند.
 * عیناً همان مکانیزم «بازگردانی» دستی است (نوشتن `oldPrice` ذخیره‌شده، نه عکس
 * کردن فرمول)، فقط با برچسب و لحظه‌ی خودش.
 */
async function endScheduledBatch(batchId: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.priceChangeBatch.findUnique({ where: { id: batchId }, include: { items: true } })
    if (!batch) return 0
    if (normalizeAdjustState(batch.state, batch.revertedAt) !== 'APPLIED') return 0

    const target = normalizeTarget(batch.target)
    const aliveSet = await aliveVariantIds(
      tx,
      batch.items.map((i) => i.variantId)
    )

    let restored = 0
    for (const item of batch.items) {
      if (!aliveSet.has(item.variantId)) continue
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: target === 'PURCHASE' ? { purchasePrice: item.oldPrice } : { salePrice: item.oldPrice }
      })
      restored++
    }

    const at = new Date()
    await tx.priceChangeBatch.update({
      where: { id: batch.id },
      data: {
        state: 'ENDED',
        autoEndedAt: at,
        // همان دو ستون همیشگی، تا جدول سابقه و منطق «قابل بازگردانی؟» مثل قبل بماند
        revertedAt: at,
        revertedAtJalali: toJalaliDate(at)
      }
    })

    await audit(tx, {
      action: AuditAction.PRICE_SCHEDULE_END,
      entity: 'PriceChangeBatch',
      entityId: batch.id,
      userId: batch.userId ?? null,
      after: JSON.stringify({ batchId: batch.id, restored }),
      note: `پایان خودکار طبق زمان‌بندی — «${batch.title}»: قیمت ${restored} کالا به مقدار قبلش برگشت`
    })
    return restored
  }, TX_OPTIONS)
}

/**
 * همه‌ی قرارهای رسیده را در صفحات keyset می‌خواند.
 *
 * `skip` اینجا عمداً استفاده نشده: هر قرارِ موفق بعد از خواندن صفحه وضعیتش
 * عوض می‌شود و skip کردن روی همان where می‌تواند قرار بعدی را رد کند. مکان‌نما
 * بر اساس `(startAt|endAt, id)` است؛ اگر علامت‌گذاری خطا هم شکست بخورد، آن
 * قرار فقط برای اجرای بعد می‌ماند و اجرای فعلی وارد حلقه‌ی بی‌نهایت نمی‌شود.
 */
async function processDueSchedulePhase(
  phase: 'START' | 'END',
  now: Date,
  run: (batchId: number) => Promise<number>
): Promise<{ processed: number; failed: number }> {
  const field = phase === 'START' ? 'startAt' : 'endAt'
  const state = phase === 'START' ? 'SCHEDULED' : 'APPLIED'
  let afterAt: Date | null = null
  let afterId = 0
  let processed = 0
  let failed = 0

  for (;;) {
    const where = {
      state,
      [field]: { not: null, lte: now },
      ...(afterAt
        ? {
            OR: [
              { [field]: { gt: afterAt } },
              { [field]: afterAt, id: { gt: afterId } }
            ]
          }
        : {})
    } as Prisma.PriceChangeBatchWhereInput

    const page = await prisma.priceChangeBatch.findMany({
      where,
      orderBy: phase === 'START' ? [{ startAt: 'asc' }, { id: 'asc' }] : [{ endAt: 'asc' }, { id: 'asc' }],
      select: { id: true, startAt: true, endAt: true },
      take: PRICE_SCHEDULE_READ_BATCH
    })
    if (!page.length) break

    const last = page[page.length - 1]
    const lastAt = (phase === 'START' ? last.startAt : last.endAt) as Date | null
    if (!lastAt) break
    afterAt = lastAt
    afterId = last.id

    for (const batch of page) {
      try {
        await run(batch.id)
        processed++
      } catch (e) {
        failed++
        console.error(
          `[priceAdjust] ${phase === 'START' ? 'scheduled start' : 'scheduled end'} failed`,
          batch.id,
          e
        )
        await markScheduleFailure(batch.id, e, phase)
      }
    }
  }

  return { processed, failed }
}

/**
 * یک قرارِ خراب نباید هر ۳۰ ثانیه دوباره تلاش و کنسول را پر کند و — مهم‌تر —
 * نباید بی‌صدا بماند. پس یادداشتش در سابقه‌ی سیستم ثبت و خودش «تمام‌شده» علامت
 * می‌خورد تا مدیر در جدول سابقه ببیندش.
 */
async function markScheduleFailure(batchId: number, error: unknown, phase: 'START' | 'END' = 'START'): Promise<void> {
  const message = String((error as any)?.message ?? error).split('\n')[0]
  try {
    const at = new Date()
    /**
     * نشست ۱۷۶ · S176-D2 — «پایان خودکار» ناموفق یعنی تراکنش rollback شده و قیمت‌ها هنوز همان
     * قیمت تخفیف‌خورده/تغییرکرده‌اند. قبلاً دسته «ENDED + revertedAt» می‌خورد: هم دروغ می‌گفت
     * («قیمت‌ها برگشته‌اند») و هم بازگردانی دستی و «حذف با برگرداندن قیمت» را برای همیشه می‌بست.
     * حالا دسته APPLIED (در جریان) می‌ماند، فقط endAt پاک می‌شود تا هر ۳۰ ثانیه دوباره تلاش نکند،
     * و یادداشت/Audit صریح می‌گوید قیمت‌ها برنگشته‌اند و باید دستی بازگردانی شود.
     */
    if (phase === 'END') {
      await prisma.priceChangeBatch.update({
        where: { id: batchId },
        data: {
          endAt: null,
          note: `پایان خودکار ناموفق بود و قیمت‌ها برنگشتند؛ از سابقه دستی «بازگردانی» کنید: ${message}`
        }
      })
      await audit(prisma, {
        action: AuditAction.PRICE_SCHEDULE_END,
        entity: 'PriceChangeBatch',
        entityId: batchId,
        note: `پایان خودکار تغییر قیمت ناموفق بود؛ دسته در جریان ماند و قیمت‌ها برنگشتند (بازگردانی دستی لازم است): ${message}`
      })
      return
    }
    await prisma.priceChangeBatch.update({
      where: { id: batchId },
      data: {
        state: 'ENDED',
        autoEndedAt: at,
        revertedAt: at,
        revertedAtJalali: toJalaliDate(at),
        note: `اجرای زمان‌بندی ناموفق بود: ${message}`
      }
    })
    await audit(prisma, {
      action: AuditAction.PRICE_SCHEDULE_END,
      entity: 'PriceChangeBatch',
      entityId: batchId,
      note: `اجرای زمان‌بندی تغییر قیمت ناموفق بود و کنار گذاشته شد: ${message}`
    })
  } catch (e) {
    console.error('[priceAdjust] marking schedule failure failed', e)
  }
}

/**
 * ===========================================================================
 * زمان‌بندِ خودتنظیم.
 *
 * یک بار در `main/index.ts` (هنگام باز شدن برنامه) صدا زده می‌شود:
 *   ۱) قرارهای عقب‌افتاده — حتی چند روزه — همان لحظه تسویه می‌شوند.
 *   ۲) بعد از هر اجرا، نزدیک‌ترین قرارِ بعدی پرسیده می‌شود و تایمر *دقیقاً* برای
 *      همان لحظه تنظیم می‌گردد؛ با سقف ۳۰ ثانیه تا تغییر ساعت سیستم، خواب و
 *      بیداری ویندوز، یا ثبت یک قرار جدید از UI هم از دست نرود.
 * ===========================================================================
 */
const MAX_SCHEDULER_GAP_MS = 30_000
let schedulerTimer: NodeJS.Timeout | null = null
let schedulerBusy = false

async function schedulerTick(): Promise<void> {
  if (schedulerBusy) return
  schedulerBusy = true
  try {
    const r = await priceAdjustService.runDueSchedules()
    if (r.started || r.ended)
      console.log(`[priceAdjust] زمان‌بندی: ${r.started} شروع خودکار · ${r.ended} پایان خودکار`)
  } catch (e) {
    console.error('[priceAdjust] scheduler tick failed', e)
  } finally {
    schedulerBusy = false
  }

  let delay = MAX_SCHEDULER_GAP_MS
  try {
    const next = await priceAdjustService.nextDueAt()
    if (next) delay = Math.min(delay, Math.max(1000, next.getTime() - Date.now()))
  } catch {
    /* نشدنِ خواندن = همان سقف ۳۰ ثانیه */
  }
  if (schedulerTimer) clearTimeout(schedulerTimer)
  schedulerTimer = setTimeout(() => void schedulerTick(), delay)
}

/** شروع زمان‌بند (یک بار، هنگام باز شدن برنامه). */
export function schedulePriceAdjust(): void {
  if (schedulerTimer) return
  schedulerTimer = setTimeout(() => void schedulerTick(), 1500)
}

/** ثبت یک قرار جدید از UI ⇒ تایمر همان لحظه با واقعیت هم‌تراز می‌شود. */
export function wakeScheduler(): void {
  if (!schedulerTimer) return
  clearTimeout(schedulerTimer)
  schedulerTimer = setTimeout(() => void schedulerTick(), 500)
}
