import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { inventoryService } from './InventoryService'
import { audit } from './AuditService'
import { assertPanelPassword } from './AuthService'
import { assertPriceInteger, createVariantInTx } from './ProductService'
import { TX_OPTIONS } from '../db/tx'
import { BusinessError } from '../errors'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, jalaliEndOfDay, jalaliStartOfDay, money, toClock, toJalaliDate } from '@shared/jalali'
import { AuditAction, SecondaryStockAction, SECONDARY_STOCK_ACTION_LABELS } from '@shared/enums'
import { toNumberRial } from '@shared/money'
import type {
  SecondaryStockInput,
  SecondaryStockRow,
  SecondaryStockLogRow,
  PagedSecondaryStockLogs,
  SecondaryStockTransferInput,
  SecondaryStockTransferResult,
  SecondaryWarehouseDeleteResult,
  SecondaryWarehouseInput,
  SecondaryWarehouseRow,
  CentralWithdrawLine,
  SecondaryToStoreInput,
  SecondaryToStoreResult,
  SecondaryToStoreNewVariantInput,
  SecondaryToStoreNewVariantResult,
  StoreMatchCandidate
} from '@shared/types'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * ===========================================================================
 * «انبار مرکزی» (انبار ذخیره) — مورد ۵ + مورد ۳
 *
 * (نام قبلی این پنل «انبار جانبی» بود؛ فقط *نام* عوض شده و رفتارش همان است.)
 *
 * یک فهرست مستقل و ساده است:
 *   • مدل خودش را دارد (`SecondaryStockItem`) و هیچ relation ای با Product /
 *     ProductVariant / SaleInvoice ندارد.
 *   • فاکتور خرید، برگشت از فروش، تجمیع و انتقال و گزارش‌ها هیچ‌وقت به آن
 *     دست نمی‌زنند.
 *
 * تنها استثنا (مورد ۳ — و فقط با تیک صریح کاربر):
 *   اگر در پنل فروش تکی / فاکتور فروش عمده چک‌باکس «برداشت خودکار از انبار
 *   مرکزی هنگام کمبود موجودی» روشن باشد، `coverShortage()` کمبود هر قلم را از
 *   این فهرست برمی‌دارد و به انبار فروشگاه منتقل می‌کند. تیک که خاموش باشد،
 *   این تابع اصلاً صدا زده نمی‌شود و رفتار قبلی (موجودی منفی + هشدار زرد)
 *   مو‌به‌مو دست‌نخورده می‌ماند.
 *
 * ⚠️ جلسه ۴۸ · **تغییر رفتار** — دامنه‌ی `coverShortage` محدود شد:
 *   حالا فقط **انبار مرکزی پیش‌فرض** (`warehouseId = NULL`، و ردیف واقعیِ
 *   `isDefault` اگر وجود داشته باشد) منبع برداشت خودکار است. قبلاً بی هیچ
 *   فیلتری از *هر* انباری که تطبیق می‌خورد برمی‌داشت، یعنی موجودی یک شعبه
 *   می‌توانست بی‌خبر خالی شود. اثرش روی هر سه صدازننده است: ثبت فاکتور، ویرایش
 *   فاکتور و سند تعویض. باقی‌ماندهٔ پوشش‌داده‌نشده مثل همیشه موجودی فروشگاه را
 *   منفی می‌کند و هشدار می‌گیرد (این قسمت عوض نشد).
 * ===========================================================================
 */

const clean = (v: unknown): string => String(v ?? '').trim()

/** lookup واریانت‌های برداشت خودکار هم باید زیر سقف پارامتر SQLite بماند. */
const VARIANT_IN_CHUNK = 500

function variantIdChunks(ids: Iterable<number>): number[][] {
  const unique = [...new Set([...ids].map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  const chunks: number[][] = []
  for (let i = 0; i < unique.length; i += VARIANT_IN_CHUNK) chunks.push(unique.slice(i, i + VARIANT_IN_CHUNK))
  return chunks
}

/** نام انبار پیش‌فرض ماژول (ردیف‌های بدون انبار به همین تعلق دارند — بخش ۵). */
export const DEFAULT_SECONDARY_WAREHOUSE_NAME = 'انبار مرکزی'

/**
 * ---------------------------------------------------------------------------
 * بخش ۵ — «چند انبار / چند شعبه».
 *
 * شرط قطعی و بدون استثنا: `warehouseId = NULL` همان **انبار پیش‌فرض** است.
 * پس همه‌ی ردیف‌های نسخه‌های قبل، بدون هیچ مهاجرتی سر جای خودشان می‌مانند و
 * ماژول مو‌به‌مو مثل قبل کار می‌کند. انبار پیش‌فرض یک ردیف *مجازی* با شناسه‌ی
 * صفر است (اگر ردیف واقعی با `isDefault` هم وجود داشته باشد، همان استفاده
 * می‌شود)، پس هیچ ردیف اجباری‌ای در دیتابیس ساخته نمی‌شود.
 *
 * استقلال از انبار فروشگاه هم دست‌نخورده است: انتقال بین انبارها فقط عددهای
 * همین ماژول را جابه‌جا می‌کند و به `ProductVariant.stock` دست نمی‌زند. تنها
 * استثنا همان `coverShortage` است که فقط با تیک صریح `autoCentralWithdraw`
 * صدا زده می‌شود.
 * ---------------------------------------------------------------------------
 */
/** شناسه‌ی صفر / خالی / ناشناس ⇒ انبار پیش‌فرض (`null`). */
const warehouseIdOf = (raw: unknown): number | null => {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * ---------------------------------------------------------------------------
 * نشست ۱۴۸ · S147-a · بند ۳، ۴-۴۲ و ۴-۲۸(د) — ورودی‌های عددی انبار مرکزی.
 *
 * تا نشست ۱۴۷ این ماژول عددها را بی‌صدا تبدیل می‌کرد (Math.round / Math.trunc /
 * Math.abs و «شناسه‌ی نامعتبر ⇒ انبار پیش‌فرض»): ۲٫۶ ⇒ ۳، ‎-۲ ⇒ ۲، متن «7» ⇒ ۷،
 * ۲٫۹ ⇒ ۲ عدد به موجودی واقعی فروشگاه. کالاها تکی‌اند و کمیت فقط عدد صحیح است و
 * سابقه‌ی انبار append-only؛ پس به‌جای تبدیل، کل عملیات با پیام فارسی رد می‌شود و
 * هیچ موجودی‌ای جابه‌جا نمی‌شود.
 *
 * سقف: ستون‌های انبار مرکزی (و ProductVariant.stock) از نوع Prisma Int هستند و سقف
 * واقعی Int با Prisma تولیدی هنوز قطعی نشده (گام ۰-ج)؛ سقف ۳۲ بیتی در هر دو حالت
 * خطای خام انگلیسی را حذف می‌کند و برای فروشگاه پوشاک محدودکننده نیست (S147-D2).
 * `warehouseIdOf` بالا فقط برای فیلترهای خواندنی (history) و حذف انبار می‌ماند.
 * ---------------------------------------------------------------------------
 */
export const CENTRAL_QTY_MAX = 2_147_483_647

function assertCentralInt(
  value: unknown,
  label: string,
  opts: { positive?: boolean; allowNegative?: boolean; unit?: string } = {}
): number {
  const ok =
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    Math.abs(value) <= CENTRAL_QTY_MAX &&
    (opts.allowNegative === true || value >= 0) &&
    (opts.positive !== true || value > 0)
  if (!ok) {
    const range = opts.positive ? 'بزرگ‌تر از صفر' : opts.allowNegative ? '(مثبت، صفر یا منفی)' : 'صفر یا بیشتر'
    const unit = opts.unit ?? 'عدد'
    throw new BusinessError(
      `${label} باید عدد صحیح ${range} باشد (سقف مجاز: ${opts.allowNegative ? 'مثبت یا منفی ' : ''}` +
        `${money(CENTRAL_QTY_MAX)}${unit ? ' ' + unit : ''})؛ مقدار «${String(value)}» پذیرفته نیست ` +
        '(اعشار، متن یا عدد خیلی بزرگ گرد یا تبدیل نمی‌شود). هیچ موجودی‌ای جابه‌جا نشد.'
    )
  }
  return value as number
}

/** شناسه‌ی اجباری: خالی/صفر ⇒ همان پیام قدیمی «انتخاب کنید»، هر مقدار نامعتبر دیگر ⇒ رد صریح. */
function requiredCentralId(raw: unknown, missingMessage: string, label: string): number {
  if (raw === undefined || raw === null || raw === 0) throw new BusinessError(missingMessage)
  return assertCentralInt(raw, label, { positive: true, unit: '' })
}

/**
 * انبار مقصد/ردیف در ثبت و انتقال: فقط null/undefined/۰ (= انبار پیش‌فرض) یا عدد
 * صحیح مثبت. قبلاً ۲٫۵ یا متن بی‌صدا «انبار پیش‌فرض» می‌شد و موجودی جای دیگری می‌رفت.
 */
function strictWarehouseId(raw: unknown, label: string): number | null {
  if (raw === undefined || raw === null || raw === 0) return null
  return assertCentralInt(raw, label, { positive: true, unit: '' })
}

/** موجودی حاصل (قبل ± تعداد) هم باید در سقف ستون Int بماند، وگرنه Prisma خطای خام می‌دهد. */
function assertCentralResult(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value) > CENTRAL_QTY_MAX)
    throw new BusinessError(
      `${what} به ${faDigits(String(value))} عدد می‌رسد که از سقف مجاز (مثبت یا منفی ${money(CENTRAL_QTY_MAX)} عدد) ` +
        'بیرون است؛ تعداد را کم کنید. هیچ موجودی‌ای جابه‌جا نشد.'
    )
  return value
}

/** سنجش مشترک ورودی «انتقال به انبار فروشگاه» — پیش از تراکنش در toStore و دوباره در toStoreWithin. */
function toStoreArgs(input: SecondaryToStoreInput): { itemId: number; variantId: number; qty: number } {
  const itemId = requiredCentralId(input?.itemId, 'ردیف مبدأ در انبار مرکزی مشخص نیست.', 'شناسه‌ی ردیف مبدأ در انبار مرکزی')
  const variantId = requiredCentralId(
    input?.variantId,
    'کالای مقصد در انبار فروشگاه را انتخاب کنید.',
    'شناسه‌ی کالای مقصد در انبار فروشگاه'
  )
  const qty = assertCentralInt(input?.qty, 'تعداد انتقال', { positive: true })
  return { itemId, variantId, qty }
}

/** ردیف مجازی انبار پیش‌فرض (ردیف‌های بدون انبار). */
function defaultWarehouseRow(agg: { itemCount: number; totalQty: number; lowCount: number }): SecondaryWarehouseRow {
  const now = new Date().toISOString()
  return {
    id: 0,
    name: DEFAULT_SECONDARY_WAREHOUSE_NAME,
    isDefault: true,
    location: null,
    note: 'انبار پیش‌فرض ماژول؛ هر ردیفی که انبار مشخصی نداشته باشد در همین‌جا شمرده می‌شود و قابل حذف نیست.',
    isActive: true,
    sortOrder: -1,
    itemCount: agg.itemCount,
    totalQty: agg.totalQty,
    lowCount: agg.lowCount,
    createdAt: now,
    updatedAt: now
  }
}

/** ثبت یک سطر در سابقه‌ی انبار مرکزی (هیچ‌وقت خطا پرتاب نمی‌کند). */
async function logStock(
  client: Client,
  input: {
    itemId?: number | null
    warehouseId?: number | null
    warehouseName?: string | null
    action: string
    name: string
    code?: string | null
    qtyBefore?: number
    qtyAfter?: number
    note?: string | null
    userId?: number | null
  }
): Promise<void> {
  try {
    const at = new Date()
    const before = Math.round(input.qtyBefore ?? 0)
    const after = Math.round(input.qtyAfter ?? 0)
    await client.secondaryStockLog.create({
      data: {
        itemId: input.itemId ?? null,
        warehouseId: input.warehouseId ?? null,
        warehouseName: input.warehouseName ?? DEFAULT_SECONDARY_WAREHOUSE_NAME,
        action: input.action,
        name: input.name,
        code: input.code ?? null,
        qtyBefore: before,
        qtyAfter: after,
        delta: after - before,
        note: input.note ?? null,
        userId: input.userId ?? null,
        at,
        atJalali: toJalaliDate(at),
        atTime: toClock(at)
      }
    })
  } catch (err) {
    // سابقه یک «دفتر کمکی» است؛ نبودنش نباید جلوی کار اصلی را بگیرد
    console.error('[secondaryStock:log]', err)
  }
}

function shapeLog(row: any): SecondaryStockLogRow {
  return {
    id: row.id,
    itemId: row.itemId ?? null,
    warehouseId: row.warehouseId ?? null,
    warehouseName: row.warehouseName || DEFAULT_SECONDARY_WAREHOUSE_NAME,
    action: row.action,
    actionLabel: SECONDARY_STOCK_ACTION_LABELS[row.action] ?? row.action,
    name: row.name,
    code: row.code ?? null,
    qtyBefore: row.qtyBefore ?? 0,
    qtyAfter: row.qtyAfter ?? 0,
    delta: row.delta ?? 0,
    note: row.note ?? null,
    dateJalali: row.atJalali || (row.at ? toJalaliDate(row.at) : ''),
    time: row.atTime || (row.at ? toClock(row.at) : '')
  }
}

function shape(row: any): SecondaryStockRow {
  const qty = Math.round(row.qty ?? 0)
  const minQty = Math.max(0, Math.round(row.minQty ?? 0))
  return {
    id: row.id,
    name: row.name,
    code: row.code ?? null,
    qty,
    note: row.note ?? null,
    createdAt: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
    updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
    // بخش ۵: انبار این ردیف (null = انبار پیش‌فرض)
    warehouseId: row.warehouseId ?? null,
    warehouseName: row.warehouse?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME,
    minQty,
    low: minQty > 0 && qty < minQty
  }
}

/** نرمال‌سازی برای تطبیق نام/کد: ارقام فارسی → لاتین، فاصله‌های اضافه حذف. */
function key(v: unknown): string {
  return String(v ?? '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'.indexOf(d)))
    .replace(/[\u064A]/g, '\u06CC')
    .replace(/[\u0643]/g, '\u06A9')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** نام کامل نمایشی یک واریانت فروشگاه (همان چیزی که در فاکتور دیده می‌شود). */
export function variantTitle(v: { size: string | null; color: string | null; product: { name: string } | null }): string {
  return `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
}

/**
 * ---------------------------------------------------------------------------
 * جلسه ۴۷ — رتبه‌ی تطبیق یک ردیف انبار مرکزی با یک کالای فروشگاه.
 *
 * این تابع **تنها پیاده‌سازی تطبیق متنی در کل برنامه** است: هم `matchRows`
 * (مسیر تیک «برداشت خودکار») و هم `StockAllocationService` (مسیر «از کدام انبار
 * کسر شود؟») از همین یکی استفاده می‌کنند. اگر فردا قاعده‌ی تطبیق عوض شود، هر دو
 * مسیر با هم عوض می‌شوند و هیچ‌وقت دو جواب متفاوت نمی‌دهند.
 *
 * ۰ = تطبیق نخورد. عددِ کمتر = تطبیق قوی‌تر.
 * ---------------------------------------------------------------------------
 */
export function matchRank(
  r: { name: string; code: string | null },
  v: { code: string; barcode: string | null; size: string | null; color: string | null; product: { name: string } | null }
): number {
  const c = key(r.code)
  const n = key(r.name)
  const byCode = key(v.code)
  const byBarcode = key(v.barcode)
  const full = key(variantTitle(v))
  const base = key(v.product?.name)
  if (c && byCode && c === byCode) return 1
  if (c && byBarcode && c === byBarcode) return 2
  if (n && full && n === full) return 3
  if (n && base && n === base) return 4
  return 0
}

/** توضیح فارسیِ «چرا این ردیف همین کالا شمرده شد» (برای نمایش در پنجره). */
export const MATCH_REASON_LABELS: Record<number, string> = {
  1: 'کد ردیف = کد کالا',
  2: 'کد ردیف = بارکد کالا',
  3: 'نام ردیف = نام کامل کالا',
  4: 'نام ردیف = نام پایه‌ی کالا'
}

/**
 * ردیف‌های انبار مرکزی که «همین کالا» شمرده می‌شوند.
 *
 * چون انبار مرکزی عمداً هیچ کلید خارجی‌ای به کالاهای فروشگاه ندارد (و نباید
 * داشته باشد)، تطبیق متنی و به همین ترتیب اولویت انجام می‌شود:
 *   ۱) کد ردیف = کد کالا  ۲) کد ردیف = بارکد کالا
 *   ۳) نام ردیف = نام کامل کالا (با سایز و رنگ)  ۴) نام ردیف = نام پایه‌ی کالا
 * بین ردیف‌های همتراز، آن‌که موجودی بیشتری دارد اول خالی می‌شود.
 */
function matchRows(
  rows: { id: number; name: string; code: string | null; qty: number }[],
  v: { code: string; barcode: string | null; size: string | null; color: string | null; product: { name: string } | null }
) {
  return rows
    .map((r) => ({ row: r, rank: matchRank(r, v) }))
    .filter((x) => x.rank > 0 && x.row.qty > 0)
    .sort((a, b) => a.rank - b.rank || b.row.qty - a.row.qty || a.row.id - b.row.id)
    .map((x) => x.row)
}

/**
 * ===========================================================================
 * جلسه ۵۴ — *بدنه‌ی* «انتقال به انبار فروشگاه»، با تراکنشِ **بیرونی**.
 *
 * چرا استخراج شد: مسیر تازه‌ی «ساخت کالای جدید هنگام انتقال» باید ساخت کالا و
 * همین انتقال را در **یک** تراکنش انجام دهد. کپی کردن این بدنه یعنی دو منطق
 * واگرا (و دقیقاً همان‌جایی که موجودی و سابقه غلط می‌شود). پس بدنه یک تابع
 * ماژولی شد که `tx` می‌گیرد، و `secondaryStockService.toStore` فقط همان را
 * داخل تراکنش خودش صدا می‌زند — پس رفتار مسیر قدیمی مو‌به‌مو ثابت است.
 *
 * ⚠️ قاعده‌ی ۶ README: همه‌ی خواندن/نوشتن‌ها با همین `tx` انجام می‌شوند
 * (`inventoryService.increase` و `audit` هم `tx` می‌گیرند)، وگرنه SQLite با
 * خودش بن‌بست می‌سازد.
 * ===========================================================================
 */
async function toStoreWithin(
  tx: Prisma.TransactionClient,
  input: SecondaryToStoreInput,
  /** نشست ۱۴۹ · S147-b — نتیجه‌ی گیت سمت سرور (MANAGER/PANEL/OPEN) برای ثبت در note AuditLog */
  gateScope?: string
): Promise<SecondaryToStoreResult> {
  // نشست ۱۴۸ · S147-a — بدون Math.trunc: ۲٫۹ دیگر بی‌صدا ۲ عدد به موجودی واقعی فروشگاه اضافه نمی‌کند.
  const { itemId, variantId, qty } = toStoreArgs(input)

  const src = await tx.secondaryStockItem.findUnique({ where: { id: itemId }, include: { warehouse: true } })
  if (!src) throw new BusinessError('ردیف مبدأ پیدا نشد (ممکن است حذف شده باشد).')

  const variant = await tx.productVariant.findUnique({
    where: { id: variantId },
    include: { product: { select: { name: true } } }
  })
  if (!variant) throw new BusinessError('کالای مقصد پیدا نشد.')
  if (variant.isActive === false)
    throw new BusinessError('کالای مقصد حذف شده است؛ ابتدا آن را از سطل آشغال پنل کالاها برگردانید.')

  if (qty > src.qty && !input.force)
    throw new BusinessError(
      `موجودی ردیف «${src.name}» در انبار مرکزی ${faDigits(src.qty)} عدد است و شما ${faDigits(qty)} عدد انتقال داده‌اید. ` +
        'اگر عمدی است، تیک تأیید انتقال بیشتر از موجودی را بزنید (موجودی مبدأ منفی می‌شود).'
    )

  const fromWarehouseName = src.warehouse?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME
  const variantName = [variant.product?.name ?? '', variant.size ?? '', variant.color ?? '']
    .filter((p) => String(p).trim().length > 0)
    .join(' - ')
  const fromBefore = src.qty
  // S147-a — هر دو حاصل پیش از اولین نوشتن در سقف ستون Int سنجیده می‌شوند
  const fromRemaining = assertCentralResult(
    fromBefore - qty,
    `موجودی باقی‌مانده‌ی «${src.name}» در «${fromWarehouseName}»`
  )
  const storeBefore = variant.stock
  const storeAfter = assertCentralResult(
    storeBefore + qty,
    `موجودی کالای «${variantName || variant.code}» در انبار فروشگاه`
  )
  await tx.secondaryStockItem.update({ where: { id: itemId }, data: { qty: fromRemaining } })

  await inventoryService.increase([{ variantId, qty }], { reason: 'CENTRAL_WITHDRAW', userId: input.userId ?? null }, tx)
  const shortageCovered = storeBefore < 0 ? Math.min(qty, -storeBefore) : 0

  const noteText =
    clean(input.note) ||
    `انتقال ${faDigits(qty)} عدد از «${fromWarehouseName}» به انبار فروشگاه (کالا: ${variantName || variant.code})` +
      (shortageCovered > 0 ? ` — ${faDigits(shortageCovered)} عدد جبران کسری قبلی` : '')

  const now = new Date()
  await tx.secondaryStockLog.create({
    data: {
      itemId,
      warehouseId: src.warehouseId ?? null,
      warehouseName: fromWarehouseName,
      action: SecondaryStockAction.TRANSFER_STORE,
      name: src.name,
      code: src.code ?? null,
      qtyBefore: fromBefore,
      qtyAfter: fromRemaining,
      delta: fromRemaining - fromBefore,
      note: noteText,
      userId: input.userId ?? null,
      atJalali: toJalaliDate(now),
      atTime: toClock(now)
    }
  })

  /**
   * ⚠️ رفع باگ جلسه‌ی قبل: این فراخوانی بدون کلاینت تراکنش و با کلید ناموجودِ
   * `summary` نوشته شده بود. امضای واقعی `audit(client, AuditInput)` است و
   * قاعده‌ی ۶ پروژه می‌گوید داخل تراکنش *باید* همان `tx` پاس داده شود، وگرنه
   * SQLite با خودش بن‌بست می‌سازد و «Transaction already closed» می‌دهد.
   */
  await audit(tx, {
    action: AuditAction.SECONDARY_TO_STORE,
    entity: 'SecondaryStockItem',
    entityId: itemId,
    userId: input.userId ?? null,
    after: JSON.stringify({ itemId, variantId, qty, storeBefore, storeAfter, shortageCovered }),
    note:
      `${SECONDARY_STOCK_ACTION_LABELS[SecondaryStockAction.TRANSFER_STORE]}: ${noteText}` +
      (gateScope ? ` · تأیید قفل انتقال به انبار فروشگاه: ${gateScope}` : '')
  })

  return {
    qty,
    name: src.name,
    fromWarehouseName,
    fromRemaining,
    variantName: variantName || variant.code,
    variantCode: variant.code,
    unit: 'عدد',
    storeBefore,
    storeAfter,
    shortageCovered
  } as SecondaryToStoreResult
}

export const secondaryStockService = {
  /** فهرست ردیف‌ها (با جستجوی ساده روی نام/کد/توضیح). */
  async list(params: { search?: string; take?: number } = {}): Promise<SecondaryStockRow[]> {
    const search = clean(params.search)
    const rows = await prisma.secondaryStockItem.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search } },
              { code: { contains: search } },
              { note: { contains: search } }
            ]
          }
        : undefined,
      include: { warehouse: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: params.take ?? 1000
    })
    return rows.map(shape)
  },

  /**
   * ثبت ردیف جدید یا ویرایش ردیف موجود.
   * تنها قاعده: نام خالی نباشد. تعداد منفی هم پذیرفته می‌شود (این فهرست دستِ
   * خودتان است و هیچ قاعده‌ی سخت‌گیرانه‌ای رویش نیست).
   */
  async upsert(input: SecondaryStockInput): Promise<SecondaryStockRow> {
    const name = clean(input?.name)
    if (!name) throw new BusinessError('نام کالای انبار مرکزی را وارد کنید.')
    /**
     * نشست ۱۴۸ · S147-a — شناسه‌ی ویرایش: خالی/صفر ⇒ ثبت تازه؛ هر مقدار دیگر باید
     * عدد صحیح مثبتِ یک ردیف موجود باشد (قبلاً ۱٫۵ مستقیم به Prisma می‌رسید).
     */
    const rawId = input?.id
    const id =
      rawId === undefined || rawId === null || rawId === 0
        ? null
        : assertCentralInt(rawId, 'شناسه‌ی ردیف انبار مرکزی', { positive: true, unit: '' })
    const prev = id ? await prisma.secondaryStockItem.findUnique({ where: { id } }) : null
    if (id && !prev) throw new BusinessError('ردیف انبار مرکزی پیدا نشد (ممکن است حذف شده باشد)؛ صفحه را تازه کنید.')
    /**
     * بخش ۵: `warehouseId` و `minQty` هم ذخیره می‌شوند (قبلاً در `data` نبودند و
     * بی‌صدا دور ریخته می‌شدند). `warehouseId = null` = انبار پیش‌فرض.
     *
     * نشست ۱۴۸ · S147-a — بدون Math.round و بدون «نامعتبر ⇒ ۰/انبار پیش‌فرض»:
     * تعداد عدد صحیح (منفی طبق طراحی ماژول مجاز)، حد هشدار عدد صحیح ≥ ۰، انبار
     * null/۰ یا عدد صحیح مثبت. فیلدی که در ویرایش فرستاده نشده ⇒ همان مقدار قبلی
     * (قبلاً موجودی ردیف بی‌صدا صفر می‌شد ⇒ کسری کاذب انبارگردانی؛ S147-D3، S148-D2)؛
     * در ثبت تازه ⇒ ۰ / انبار پیش‌فرض.
     */
    const qty =
      input?.qty === undefined || input?.qty === null
        ? (prev?.qty ?? 0)
        : assertCentralInt(input.qty, `تعداد «${name}» در انبار مرکزی`, { allowNegative: true })
    const minQty =
      input?.minQty === undefined || input?.minQty === null
        ? (prev?.minQty ?? 0)
        : assertCentralInt(input.minQty, `حد هشدار موجودی «${name}»`)
    const warehouseId =
      input?.warehouseId === undefined
        ? (prev?.warehouseId ?? null)
        : strictWarehouseId(input.warehouseId, `شناسه‌ی انبار ردیف «${name}»`)
    if (warehouseId && !(await prisma.secondaryWarehouse.findUnique({ where: { id: warehouseId } })))
      throw new BusinessError('انبار انتخاب‌شده برای این ردیف پیدا نشد (ممکن است حذف شده باشد)؛ صفحه را تازه کنید.')
    const data = {
      name,
      code: clean(input?.code) || null,
      qty,
      note: clean(input?.note) || null,
      warehouseId,
      minQty
    }
    const saved = id
      ? await prisma.secondaryStockItem.update({ where: { id }, data })
      : await prisma.secondaryStockItem.create({ data })
    // با include خوانده می‌شود تا نام انبار هم در خروجی باشد (بخش ۵)
    const row =
      (await prisma.secondaryStockItem.findUnique({ where: { id: saved.id }, include: { warehouse: true } })) ?? saved
    await audit(prisma, {
      action: id ? 'SECONDARY_STOCK_UPDATE' : 'SECONDARY_STOCK_CREATE',
      entity: 'SecondaryStockItem',
      entityId: row.id,
      userId: input?.userId ?? null,
      after: JSON.stringify(data),
      note: 'انبار مرکزی'
    })
    await logStock(prisma, {
      itemId: row.id,
      warehouseId: data.warehouseId,
      warehouseName: (row as any).warehouse?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME,
      action: id ? SecondaryStockAction.UPDATE : SecondaryStockAction.CREATE,
      name: data.name,
      code: data.code,
      qtyBefore: prev?.qty ?? 0,
      qtyAfter: data.qty,
      userId: input?.userId ?? null,
      note: id ? 'ویرایش ردیف' : 'ثبت ردیف جدید'
    })
    return shape(row)
  },

  /** حذف ردیف‌های انتخابی. اینجا حذف واقعی است (این جدول سابقه‌ی مالی ندارد). */
  async remove(input: { ids?: number[]; userId?: number | null } = {}): Promise<number> {
    const ids = (input?.ids ?? []).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
    if (!ids.length) throw new BusinessError('برای حذف، حداقل یک ردیف را انتخاب کنید.')
    /**
     * نشست ۱۷۷ · S176-D3 — قبلاً همه‌ی شناسه‌ها بی‌سقف در id in (قاعده‌ی سقف IN ۵۰۰، S99-2). UI امروز
     * «انتخاب همه» ندارد، ولی main نباید به UI تکیه کند. حالا دسته‌های ۵۰۰تایی یکتا و صعودی داخل یک
     * تراکنش (همه یا هیچ). Audit و دفتر انبار مرکزی مثل قبل بعد از حذف.
     */
    const uniq = [...new Set(ids)].sort((a, b) => a - b)
    const idChunks: number[][] = []
    for (let i = 0; i < uniq.length; i += 500) idChunks.push(uniq.slice(i, i + 500))
    const { before, count } = await prisma.$transaction(async (tx) => {
      const before: any[] = []
      let count = 0
      for (const chunk of idChunks) {
        before.push(...(await tx.secondaryStockItem.findMany({ where: { id: { in: chunk } } })))
        count += (await tx.secondaryStockItem.deleteMany({ where: { id: { in: chunk } } })).count
      }
      return { before, count }
    }, TX_OPTIONS)
    const res = { count }
    await audit(prisma, {
      action: 'SECONDARY_STOCK_DELETE',
      entity: 'SecondaryStockItem',
      userId: input?.userId ?? null,
      before: JSON.stringify(before.map((r) => ({ id: r.id, name: r.name, qty: r.qty }))),
      after: JSON.stringify(ids),
      note: `${res.count} ردیف از انبار مرکزی حذف شد`
    })
    for (const r of before)
      await logStock(prisma, {
        itemId: r.id,
        warehouseId: r.warehouseId ?? null,
        action: SecondaryStockAction.DELETE,
        name: r.name,
        code: r.code,
        qtyBefore: r.qty,
        qtyAfter: 0,
        userId: input?.userId ?? null,
        note: 'حذف ردیف از انبار مرکزی'
      })
    return res.count
  },

  /**
   * =========================================================================
   * بخش ۵ — انبارها (چند شعبه).
   * =========================================================================
   */
  /** فهرست انبارها + جمع‌های هر انبار. ردیف اول همیشه «انبار پیش‌فرض» است. */
  async warehouseList(params: { includeInactive?: boolean } = {}): Promise<SecondaryWarehouseRow[]> {
    const [houses, items] = await Promise.all([
      prisma.secondaryWarehouse.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      prisma.secondaryStockItem.findMany({ select: { warehouseId: true, qty: true, minQty: true } })
    ])

    const blank = () => ({ itemCount: 0, totalQty: 0, lowCount: 0 })
    const agg = new Map<number, ReturnType<typeof blank>>()
    const nullAgg = blank()
    for (const it of items) {
      const key = it.warehouseId ?? null
      const bucket = key == null ? nullAgg : (agg.get(key) ?? blank())
      bucket.itemCount += 1
      bucket.totalQty += Math.round(it.qty ?? 0)
      const min = Math.max(0, Math.round(it.minQty ?? 0))
      if (min > 0 && Math.round(it.qty ?? 0) < min) bucket.lowCount += 1
      if (key != null) agg.set(key, bucket)
    }

    /**
     * انبار پیش‌فرض: اگر ردیف واقعیِ `isDefault` وجود داشته باشد، جمع ردیف‌های
     * بدون انبار به همان اضافه می‌شود (چون طبق قرارداد، «بدون انبار» یعنی همان
     * انبار پیش‌فرض)؛ وگرنه ردیف مجازیِ شناسه‌صفر برگردانده می‌شود.
     */
    const realDefault = houses.find((h) => h.isDefault)
    const rows: SecondaryWarehouseRow[] = []
    if (!realDefault) rows.push(defaultWarehouseRow(nullAgg))

    for (const h of houses) {
      if (!params.includeInactive && !h.isActive && !h.isDefault) continue
      const a = agg.get(h.id) ?? blank()
      const extra = h.isDefault ? nullAgg : blank()
      rows.push({
        id: h.id,
        name: h.name,
        isDefault: h.isDefault,
        location: h.location ?? null,
        note: h.note ?? null,
        isActive: h.isActive,
        sortOrder: h.sortOrder,
        itemCount: a.itemCount + extra.itemCount,
        totalQty: a.totalQty + extra.totalQty,
        lowCount: a.lowCount + extra.lowCount,
        createdAt: h.createdAt.toISOString(),
        updatedAt: h.updatedAt.toISOString()
      })
    }
    return rows
  },

  /** ثبت یا ویرایش یک انبار. نام یکتاست (خطای فارسی می‌دهد، نه خطای خام Prisma). */
  async warehouseUpsert(input: SecondaryWarehouseInput): Promise<SecondaryWarehouseRow> {
    const name = clean(input?.name)
    if (!name) throw new BusinessError('نام انبار را وارد کنید.')
    const id = warehouseIdOf(input?.id)
    const twin = await prisma.secondaryWarehouse.findFirst({ where: { name } })
    if (twin && twin.id !== id) throw new BusinessError(`انباری با نام «${name}» از قبل هست؛ یک نام دیگر بگذارید.`)

    const data = {
      name,
      location: clean(input?.location) || null,
      note: clean(input?.note) || null,
      isActive: input?.isActive !== false,
      sortOrder: Math.round(Number(input?.sortOrder ?? 0)) || 0
    }
    const saved = id
      ? await prisma.secondaryWarehouse.update({ where: { id }, data })
      : await prisma.secondaryWarehouse.create({ data })

    await audit(prisma, {
      action: id ? 'SECONDARY_WAREHOUSE_UPDATE' : 'SECONDARY_WAREHOUSE_CREATE',
      entity: 'SecondaryWarehouse',
      entityId: saved.id,
      userId: input?.userId ?? null,
      after: JSON.stringify(data),
      note: `انبار «${name}»`
    })
    const list = await this.warehouseList({ includeInactive: true })
    return list.find((w) => w.id === saved.id) ?? {
      ...defaultWarehouseRow({ itemCount: 0, totalQty: 0, lowCount: 0 }),
      id: saved.id,
      name,
      isDefault: saved.isDefault
    }
  },

  /**
   * حذف یک انبار. ردیف‌های کالایش **پاک نمی‌شوند**؛ به انبار پیش‌فرض منتقل
   * می‌گردند (`warehouseId = null`) — اصل «سابقه و موجودی هیچ‌وقت بی‌صدا حذف
   * نمی‌شود». انبار پیش‌فرض قابل حذف نیست.
   */
  async warehouseRemove(input: { id?: number; userId?: number | null } = {}): Promise<SecondaryWarehouseDeleteResult> {
    const id = warehouseIdOf(input?.id)
    if (!id) throw new BusinessError('انبار پیش‌فرض قابل حذف نیست؛ ردیف‌های بدون انبار همیشه به همین تعلق دارند.')
    const house = await prisma.secondaryWarehouse.findUnique({ where: { id } })
    if (!house) throw new BusinessError('این انبار پیدا نشد؛ صفحه را تازه کنید.')
    if (house.isDefault) throw new BusinessError(`«${house.name}» انبار پیش‌فرض است و قابل حذف نیست.`)

    const items = await prisma.secondaryStockItem.findMany({ where: { warehouseId: id } })
    const moved = await prisma.secondaryStockItem.updateMany({ where: { warehouseId: id }, data: { warehouseId: null } })
    await prisma.secondaryWarehouse.delete({ where: { id } })

    for (const it of items)
      await logStock(prisma, {
        itemId: it.id,
        warehouseId: null,
        warehouseName: DEFAULT_SECONDARY_WAREHOUSE_NAME,
        action: SecondaryStockAction.TRANSFER_IN,
        name: it.name,
        code: it.code,
        qtyBefore: it.qty,
        qtyAfter: it.qty,
        userId: input?.userId ?? null,
        note: `با حذف انبار «${house.name}» به انبار پیش‌فرض منتقل شد`
      })

    await audit(prisma, {
      action: 'SECONDARY_WAREHOUSE_DELETE',
      entity: 'SecondaryWarehouse',
      entityId: id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ id, name: house.name, items: items.length }),
      note: `انبار «${house.name}» حذف شد و ${moved.count} ردیف به انبار پیش‌فرض منتقل گردید`
    })

    return {
      id,
      name: house.name,
      movedItems: moved.count,
      targetWarehouseName: DEFAULT_SECONDARY_WAREHOUSE_NAME
    }
  },

  /**
   * انتقال موجودی یک ردیف به انبار دیگر.
   *
   * قاعده‌ی «هشدار، نه دیوار»: انتقال بیشتر از موجودی ردیف فقط با تایید آگاهانه
   * (`force`) انجام می‌شود، مثل مسیر برگشت از فروش.
   * در انبار مقصد، ردیفِ همنام/همکد پیدا و تعدادش زیاد می‌شود؛ اگر نبود، یک
   * ردیف تازه ساخته می‌شود. انبار فروشگاه در این مسیر مطلقاً لمس نمی‌شود.
   */
  async transfer(input: SecondaryStockTransferInput): Promise<SecondaryStockTransferResult> {
    // نشست ۱۴۹ · S147-a — بدون Math.round و بدون «مقصد نامعتبر ⇒ انبار پیش‌فرض»
    const itemId = requiredCentralId(input?.itemId, 'ردیف مبدأ انتقال را انتخاب کنید.', 'شناسه‌ی ردیف مبدأ انتقال')
    const qty = assertCentralInt(input?.qty, 'تعداد انتقال', { positive: true })
    const toId = strictWarehouseId(input?.toWarehouseId, 'شناسه‌ی انبار مقصد انتقال')

    return prisma.$transaction(async (tx) => {
      const src = await tx.secondaryStockItem.findUnique({ where: { id: itemId }, include: { warehouse: true } })
      if (!src) throw new BusinessError('این ردیف پیدا نشد؛ صفحه را تازه کنید.')
      const fromId = src.warehouseId ?? null
      if (fromId === toId) throw new BusinessError('انبار مبدأ و مقصد یکی است؛ یک انبار دیگر را انتخاب کنید.')

      const toHouse = toId ? await tx.secondaryWarehouse.findUnique({ where: { id: toId } }) : null
      if (toId && !toHouse) throw new BusinessError('انبار مقصد پیدا نشد؛ صفحه را تازه کنید.')
      const fromName = src.warehouse?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME
      const toName = toHouse?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME

      if (qty > src.qty && input?.force !== true)
        throw new BusinessError(
          `تعداد انتقال «${src.name}» (${faDigits(qty)}) از موجودی همین ردیف در «${fromName}» ` +
            `(${faDigits(src.qty)}) بیشتر است و موجودی مبدأ منفی می‌شود. ` +
            'اگر آگاهانه می‌خواهید همین را ثبت کنید، تایید کنید تا انجام شود.'
        )

      // مقصد: ردیف همنام/همکد همان انبار، وگرنه یک ردیف تازه
      const twin = await tx.secondaryStockItem.findFirst({
        where: {
          warehouseId: toId,
          name: src.name,
          code: src.code ?? null,
          id: { not: src.id }
        },
        orderBy: { id: 'asc' }
      })

      // S147-a / S148-D4 — هر دو حاصل پیش از اولین نوشتن در سقف ستون Int سنجیده می‌شوند
      const srcAfter = assertCentralResult(src.qty - qty, `موجودی باقی‌مانده‌ی «${src.name}» در «${fromName}»`)
      const destBefore = twin?.qty ?? 0
      const destAfter = assertCentralResult(destBefore + qty, `موجودی «${src.name}» در «${toName}»`)
      await tx.secondaryStockItem.update({ where: { id: src.id }, data: { qty: srcAfter } })

      const dest = twin
        ? await tx.secondaryStockItem.update({ where: { id: twin.id }, data: { qty: destAfter } })
        : await tx.secondaryStockItem.create({
            data: {
              name: src.name,
              code: src.code ?? null,
              qty,
              note: src.note ?? null,
              warehouseId: toId,
              minQty: src.minQty ?? 0
            }
          })

      const note = `انتقال ${faDigits(qty)} عدد «${src.name}» از «${fromName}» به «${toName}»` +
        (clean(input?.note) ? ` · ${clean(input?.note)}` : '')

      await logStock(tx, {
        itemId: src.id,
        warehouseId: fromId,
        warehouseName: fromName,
        action: SecondaryStockAction.TRANSFER_OUT,
        name: src.name,
        code: src.code,
        qtyBefore: src.qty,
        qtyAfter: srcAfter,
        userId: input?.userId ?? null,
        note
      })
      await logStock(tx, {
        itemId: dest.id,
        warehouseId: toId,
        warehouseName: toName,
        action: SecondaryStockAction.TRANSFER_IN,
        name: src.name,
        code: src.code,
        qtyBefore: destBefore,
        qtyAfter: destAfter,
        userId: input?.userId ?? null,
        note
      })
      await audit(tx, {
        action: 'SECONDARY_STOCK_TRANSFER',
        entity: 'SecondaryStockItem',
        entityId: src.id,
        userId: input?.userId ?? null,
        after: JSON.stringify({ itemId: src.id, qty, fromId, toId }),
        note
      })

      return {
        qty,
        name: src.name,
        fromWarehouseName: fromName,
        toWarehouseName: toName,
        fromRemaining: srcAfter,
        toQty: destAfter
      }
    })
  },

  /** تاریخچه‌ی تغییرات و انتقالات (فیلتر اختیاری: ردیف، انبار، بازه‌ی تاریخ). */
  async history(
    params: {
      itemId?: number | null
      warehouseId?: number | null
      onlyTransfers?: boolean
      fromJalali?: string
      toJalali?: string
      take?: number
      skip?: number
    } = {}
  ): Promise<PagedSecondaryStockLogs> {
    const where: any = {}
    const itemId = Number(params?.itemId ?? 0)
    if (itemId > 0) where.itemId = itemId
    if (params?.warehouseId !== undefined && params?.warehouseId !== null)
      where.warehouseId = warehouseIdOf(params.warehouseId)
    if (params?.onlyTransfers)
      where.action = { in: [SecondaryStockAction.TRANSFER_IN, SecondaryStockAction.TRANSFER_OUT] }
    if (params?.fromJalali || params?.toJalali) {
      const from = params.fromJalali ? jalaliStartOfDay(params.fromJalali) : undefined
      const to = params.toJalali ? jalaliEndOfDay(params.toJalali) : undefined
      where.at = { gte: from, lte: to }
    }
    const effectiveWhere = Object.keys(where).length ? where : undefined
    const totalCount = await prisma.secondaryStockLog.count({ where: effectiveWhere })
    const skip = Math.max(0, Math.round(Number(params?.skip ?? 0) || 0))
    const take = Math.min(5000, Math.max(1, Math.round(Number(params?.take ?? 5000) || 5000)))
    const rows = await prisma.secondaryStockLog.findMany({
      where: effectiveWhere,
      orderBy: { id: 'desc' },
      skip,
      take
    })
    const mapped = rows.map(shapeLog) as PagedSecondaryStockLogs
    mapped.page = { skip, take, totalCount, truncated: totalCount > skip + mapped.length }
    mapped.warnings = mapped.page.truncated
      ? [`نمایش ${faDigits(mapped.length)} از ${faDigits(totalCount)} ردیف؛ صفحه‌ی بعد را بگیرید تا سابقه‌ی کامل دیده شود.`]
      : []
    return mapped
  },

  /**
   * =========================================================================
   * مورد ۳ — «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی فروشگاه»
   *
   * فقط از `SalesService` و فقط وقتی چک‌باکس پنل فروش روشن باشد صدا زده می‌شود.
   * کاری که می‌کند:
   *   ۱) کمبود هر کالا = تعداد درخواستی − موجودی فعلی انبار فروشگاه.
   *   ۲) ردیف‌های متناظر در انبار مرکزی پیدا و به‌ترتیب اولویت خالی می‌شوند
   *      (هیچ‌وقت انبار مرکزی منفی نمی‌شود؛ هر چه دارد برداشته می‌شود و بس).
   *   ۳) همان تعداد با `inventoryService.increase` و دلیل `CENTRAL_WITHDRAW` به
   *      انبار فروشگاه *منتقل* می‌شود. پس دفتر `StockMovement` راستگو می‌ماند و
   *      بعد از کسر خودِ فروش، موجودی روی صفر می‌نشیند نه منفی.
   *   ۴) فهرست هشدارهای فارسی برای کادر زرد پنل فروش برمی‌گردد.
   *
   * ⚠️ قاعده‌ی ۶ README: کلاینت تراکنش اجباری است و همه‌ی خواندن/نوشتن‌ها با
   * همان `client` انجام می‌شوند (وگرنه SQLite با خودش بن‌بست می‌سازد).
   * هیچ‌وقت خطا پرتاب نمی‌کند: اگر تطبیقی پیدا نشد یا انبار مرکزی خالی بود،
   * فقط هشدار می‌دهد و فروش مثل قبل ادامه پیدا می‌کند.
   * =========================================================================
   */
  /**
   * -------------------------------------------------------------------------
   * مورد ۸ — «انتقال به انبار فروشگاه».
   *
   * تا امروز «انتقال» فقط بین انبارهای همین ماژول (۱، ۲، ...) کار می‌کرد.
   * اینجا مقصد، انبار فروشگاه است؛ یعنی همان `ProductVariant.stock` که ماژول
   * کالا مدیریتش می‌کند.
   *
   * چرا `variantId` اجباری است؟ این ماژول عمداً هیچ relation ای با کالاهای
   * فروشگاه ندارد، پس حدس‌زدن کالا از روی نام/کد می‌تواند موجودی دو کالا را
   * خراب کند. تطبیق متنی فقط برای *پیشنهاد* دادن است (`storeCandidates`) و
   * انتخاب نهایی دست کاربر است.
   *
   * موجودی منفی: افزایش همیشه جبری است، پس ۳- به‌اضافه ۱۰ می‌شود ۷ (سه عدد
   * صرف جبران کسری قبلی می‌شود). همان عدد در `shortageCovered` برمی‌گردد تا در
   * پیام و سابقه هم دیده شود.
   * -------------------------------------------------------------------------
   */
  async toStore(input: SecondaryToStoreInput): Promise<SecondaryToStoreResult> {
    // نشست ۱۴۹ · S147-a — سنجش سخت پیش از تراکنش (بدون Math.trunc)؛ toStoreWithin دوباره می‌سنجد
    toStoreArgs(input)
    /**
     * نشست ۱۴۹ · S147-b · بند ۴-۳۹ و بند ۵ — «انتقال از انبار مرکزی به انبار فروشگاه» موجودی
     * واقعی فروشگاه را زیاد می‌کند (می‌تواند کسری انبارگردانی را بپوشاند)، پس گیت سمت سرور دارد؛
     * تا نشست ۱۴۸ فقط ManagerGate رندرر آن را می‌بست. مثل toStoreNewVariant بیرون از
     * $transaction (verifyPanel روی AuthLockout می‌نویسد و SQLite تک‌نویسنده است). قفل خاموش ⇒ OPEN.
     */
    const scope = await assertPanelPassword(
      PANEL_KEYS.secondaryToStore,
      input?.toStorePassword ?? null,
      'انتقال از انبار مرکزی به انبار فروشگاه'
    )

    return prisma.$transaction(async (tx) => toStoreWithin(tx, input, scope))
  },

  /**
   * =========================================================================
   * جلسه ۵۴ — «کالا در انبار فروشگاه نیست ⇒ همین‌جا بسازش و منتقل کن».
   *
   * چرا یک متد و یک کانال *تازه* و نه یک فیلد اختیاری روی `toStore`: مسیر
   * «انتقال به کالای موجود» پرکاربردترین مسیر روزمره است و باید مو‌به‌مو ثابت
   * بماند. این متد بدنه‌ی همان انتقال (`toStoreWithin`) را **بی هیچ کپی‌برداری**
   * به کار می‌برد، فقط قبلش کالا/واریانت را می‌سازد.
   *
   * اتمیک بودن (خواسته‌ی ۳): ساخت کالا و جابه‌جایی موجودی در **یک** تراکنش‌اند،
   * پس هر خطایی وسط کار ⇒ هیچ کالایی ساخته نمی‌شود و هیچ عددی جابه‌جا نمی‌گردد.
   * واریانت با موجودی **صفر** ساخته می‌شود و پر شدنش فقط از مسیر
   * `inventoryService.increase` با دلیل `CENTRAL_WITHDRAW` است (همان چیزی که
   * `toStoreWithin` می‌کند)، پس دفتر `StockMovement` راستگو می‌ماند.
   *
   * ------------------------------ قفل (دو کلید) ------------------------------
   * این مسیر هم موجودی *واقعی* فروشگاه را زیاد می‌کند و هم یک کالای تازه
   * می‌سازد، پس **دو** کلید سنجیده می‌شوند: `secondaryToStore` و
   * `secondaryToStoreNewProduct`.
   *
   * ⚠️ جلسه ۵۵ · کار ۱ — کلید دوم عوض شد. تا جلسه ۵۴ اینجا `PANEL_KEYS.products`
   * سنجیده می‌شد، و همین یعنی انباردار برای ساخت یک کالای تازه باید رمز پنل
   * کالاها را می‌گرفت و در عمل *حذف کالا، تغییر قیمت و ورود موجودی* هم برایش باز
   * می‌شد. حالا `PANEL_KEYS.secondaryToStoreNewProduct` **جای** آن را گرفته:
   * یک قفل مستقل که مدیر می‌تواند رمز دومش را به انباردار بدهد بی آن‌که پنل
   * کالاها باز شود. خودِ پنل کالاها و قفلش یک خط هم عوض نشده‌اند و این مسیر دیگر
   * هیچ سراغی از `products` نمی‌گیرد. قفل `secondaryToStore` مثل قبل باقی است.
   *
   * ⚠️ مکانیزم فعلی (`assertPanelPassword`) هر بار **یک** کلید را می‌سنجد و
   * «چند رمز با هم» ندارد. ساده‌ترین راه امن، بی ساختن هیچ مکانیزم جدیدی:
   * همان تابع **دو بار** صدا زده می‌شود. و چون طبق سیاست پروژه «رمز مدیر هر
   * پنلی را باز می‌کند»، اگر کاربر فقط یک رمز بدهد (`newProductPassword` خالی)،
   * همان رمز برای کلید دوم هم امتحان می‌شود — پس کاربر با رمز مدیر یک فیلد پر
   * می‌کند و تنها وقتی لازم است دو فیلد پر کند که برای قفل «ساخت کالای جدید
   * هنگام انتقال» **رمز دوم اختصاصی** تعریف شده باشد. قفل خاموش ⇒
   * `assertPanelPassword` بی رمز `OPEN` می‌دهد (همان سیاست موجود «قفل
   * ماژول‌ها»، سیاست تازه‌ای اختراع نمی‌شود).
   *
   * ⚠️ هر دو تأیید **بیرون از `$transaction`** انجام می‌شوند — دقیقاً الگوی
   * `CardTransferService.pay` و `SalesService.create`: `verifyPanel` با کلاینت
   * سراسری روی `AuthLockout` می‌نویسد و SQLite تک‌نویسنده است.
   * =========================================================================
   */
  async toStoreNewVariant(input: SecondaryToStoreNewVariantInput): Promise<SecondaryToStoreNewVariantResult> {
    /**
     * نشست ۱۴۹ · S147-a — بدون Math.trunc/Math.round و همه پیش از assertPanelPassword:
     * قیمت ۱٬۲۰۰٬۰۰۰٫۵ دیگر بی‌صدا ۱٬۲۰۰٬۰۰۱ ریال نمی‌شود و قیمت خرید نامعتبر رمز را مصرف نمی‌کند.
     */
    const itemId = requiredCentralId(input?.itemId, 'ردیف مبدأ در انبار مرکزی مشخص نیست.', 'شناسه‌ی ردیف مبدأ در انبار مرکزی')
    const qty = assertCentralInt(input?.qty, 'تعداد انتقال', { positive: true })
    if (input.salePrice == null || Number(input.salePrice) <= 0)
      throw new BusinessError('قیمت فروش کالای جدید اجباری است و باید عددی بزرگ‌تر از صفر باشد.')
    const salePrice = assertPriceInteger(input.salePrice, 'قیمت فروش کالای جدید', { positive: true })
    const rawPurchase = input.purchasePrice ?? 0
    if (Number(rawPurchase) < 0) throw new BusinessError('قیمت خرید نمی‌تواند منفی باشد.')
    const purchasePrice = assertPriceInteger(rawPurchase, 'قیمت خرید کالای جدید')
    const productId = Number(input.productId ?? 0) > 0 ? Number(input.productId) : null
    if (productId == null && !clean(input.name)) throw new BusinessError('نام کالای جدید را وارد کنید.')

    // ---- دو قفل، هر دو پیش از باز شدن تراکنش (الگوی جلسه ۴۰ و ۵۲) ----
    const toStoreScope = await assertPanelPassword(
      PANEL_KEYS.secondaryToStore,
      input.toStorePassword ?? null,
      'انتقال از انبار مرکزی به انبار فروشگاه'
    )
    const newProductScope = await assertPanelPassword(
      PANEL_KEYS.secondaryToStoreNewProduct,
      // رمز مدیر هر پنلی را باز می‌کند، پس فیلد دوم فقط برای «رمز دوم اختصاصی همین قفل» لازم است
      clean(input.newProductPassword) ? input.newProductPassword : (input.toStorePassword ?? null),
      'ساخت کالای جدید در انبار فروشگاه هنگام انتقال از انبار مرکزی'
    )

    return prisma.$transaction(async (tx) => {
      // ۱) اول کالا/واریانت با موجودی صفر (قواعد کد و بارکد از خود ProductService)
      const created = await createVariantInTx(tx, {
        productId,
        name: input.name,
        categoryId: input.categoryId,
        unit: input.unit,
        size: input.size,
        color: input.color,
        salePrice,
        purchasePrice,
        code: input.code,
        note: `ساخته‌شده هنگام انتقال از انبار مرکزی به انبار فروشگاه`
      })

      // ۲) بعد عیناً همان منطق انتقال (کسر ردیف، increase، سابقه، AuditLog)
      const moved = await toStoreWithin(tx, {
        itemId,
        variantId: created.variantId,
        qty,
        note: input.note ?? null,
        userId: input.userId ?? null,
        force: input.force
      })

      // ۳) یک ردپای جدا برای «کالای تازه ساخته شد» (کنار همان SECONDARY_TO_STORE)
      await audit(tx, {
        action: AuditAction.SECONDARY_TO_STORE_NEW_PRODUCT,
        entity: 'ProductVariant',
        entityId: created.variantId,
        userId: input.userId ?? null,
        after: JSON.stringify({
          itemId,
          productId: created.productId,
          variantId: created.variantId,
          createdProduct: created.createdProduct,
          code: created.code,
          requestedCode: created.requestedCode,
          codeReplaced: created.codeReplaced,
          barcode: created.barcode,
          salePrice: created.salePrice,
          purchasePrice: created.purchasePrice,
          qty
        }),
        note:
          `${created.createdProduct ? 'کالای جدید' : 'واریانت جدید'} «${created.fullName}» (کد ${created.code}) ` +
          `هنگام انتقال ${faDigits(qty)} عدد از انبار مرکزی ساخته شد · ` +
          `تأیید قفل انتقال: ${toStoreScope} · تأیید قفل ساخت کالای جدید: ${newProductScope}` +
          (created.codeReplaced ? ` · کد درخواستی «${created.requestedCode}» تکراری بود و جایگزین شد` : '')
      })

      return { ...moved, created } as SecondaryToStoreNewVariantResult
    }, TX_OPTIONS)
  },

  /**
   * پیشنهاد کالای فروشگاه برای یک ردیف انبار مرکزی (فقط پیشنهاد، بدون هیچ
   * تغییری). ترتیب: بارکد یکی → کد یکی → نام یکی → نام شبیه.
   */
  async storeCandidates(params: { itemId?: number; search?: string; take?: number } = {}): Promise<StoreMatchCandidate[]> {
    let needleName = clean(params.search)
    let needleCode = ''
    if (params.itemId) {
      const src = await prisma.secondaryStockItem.findUnique({ where: { id: Number(params.itemId) } })
      if (src) {
        needleName = needleName || clean(src.name)
        needleCode = clean(src.code)
      }
    }
    const take = Math.min(Math.max(Number(params.take) || 25, 1), 100)
    const or: any[] = []
    if (needleCode) or.push({ code: needleCode }, { barcode: needleCode })
    if (needleName) or.push({ product: { name: { contains: needleName } } }, { code: { contains: needleName } })
    if (or.length === 0) return []

    const rows = await prisma.productVariant.findMany({
      where: { isActive: true, OR: or },
      include: { product: { select: { name: true } } },
      take
    })

    const out: StoreMatchCandidate[] = rows.map((v) => {
      const pname = clean(v.product?.name)
      const full = [pname, v.size ?? '', v.color ?? ''].filter((p) => String(p).trim().length > 0).join(' - ')
      let reason = 'شبیه است'
      let rank = 4
      if (needleCode && v.barcode === needleCode) {
        reason = 'بارکد یکی است'
        rank = 1
      } else if (needleCode && v.code === needleCode) {
        reason = 'کد یکی است'
        rank = 2
      } else if (needleName && pname === needleName) {
        reason = 'نام یکی است'
        rank = 3
      }
      return {
        variantId: v.id,
        name: full || v.code,
        code: v.code,
        barcode: v.barcode,
        unit: 'عدد',
        stock: v.stock,
        salePrice: toNumberRial(v.salePrice), // نشست ۱۸۱: BigInt ⇒ number برای قرارداد UI
        reason,
        rank
      }
    })
    out.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'fa'))
    return out
  },

  async coverShortage(
    client: Client,
    lines: { variantId: number; qty: number }[],
    opts: { userId?: number | null; refType?: string; note?: string } = {}
  ): Promise<{ warnings: string[]; taken: CentralWithdrawLine[]; totalTaken: number }> {
    /**
     * نشست ۱۴۹ · S147-a — بدون Math.abs(Math.round): ‎-۲ دیگر ۲ برداشت نمی‌کند و ۱٫۵ دیگر ۲ نمی‌شود.
     * هر سه caller (create/update/createExchange) ورودی صحیح و مثبت می‌دهند، پس برای ورودی معتبر
     * رفتار عوض نمی‌شود؛ ورودی نامعتبر ⇒ BusinessError و rollback کل تراکنش سند (defense-in-depth).
     * qty = ۰ مثل قبل نادیده گرفته می‌شود.
     */
    const need = new Map<number, number>()
    for (const l of lines ?? []) {
      const qty = assertCentralInt(l?.qty, 'تعداد قلم برای برداشت خودکار از انبار مرکزی')
      if (qty === 0) continue
      const variantId = assertCentralInt(l?.variantId, 'شناسه‌ی کالای قلم برای برداشت خودکار از انبار مرکزی', {
        positive: true,
        unit: ''
      })
      need.set(variantId, assertCentralResult((need.get(variantId) ?? 0) + qty, 'جمع تعداد اقلام یک کالا برای برداشت خودکار'))
    }
    if (!need.size) return { warnings: [], taken: [], totalTaken: 0 }

    const variants: any[] = []
    for (const ids of variantIdChunks(need.keys())) {
      variants.push(
        ...(await client.productVariant.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            code: true,
            barcode: true,
            stock: true,
            size: true,
            color: true,
            product: { select: { name: true, unit: true } }
          }
        }))
      )
    }

    const shortages = variants
      .map((v) => ({ v, shortage: (need.get(v.id) ?? 0) - v.stock }))
      .filter((x) => x.shortage > 0)
    if (!shortages.length) return { warnings: [], taken: [], totalTaken: 0 }

    /**
     * =====================================================================
     * جلسه ۴۸ · مرحله ۱ — **تغییر رفتار**: برداشت خودکار فقط از انبار مرکزی.
     *
     * تا جلسه ۴۷ این تابع کل `SecondaryStockItem` را بی هیچ فیلتری می‌خواند،
     * یعنی تیکِ «برداشت خودکار از انبار مرکزی» در عمل «از هر انباری که پیدا
     * شود» بود و موجودی یک شعبه‌ی دیگر می‌توانست بی‌خبر خالی شود.
     *
     * قاعده‌ی نهایی مالک: کمبود **فقط از انبار مرکزی پیش‌فرض** برداشته می‌شود.
     * «انبار مرکزی پیش‌فرض» طبق قرارداد ثابت بخش ۵ همان ردیف‌های
     * `warehouseId = NULL` است؛ و اگر ردیف واقعیِ `isDefault` هم وجود داشته
     * باشد، ردیف‌های وصل به آن هم همان انبارند (عیناً همان تصمیمی که
     * `warehouseList` و `StockAllocationService.preview` می‌گیرند — پس سه‌جا
     * یک تعریف دارند، نه سه تعریف).
     *
     * هر انبار دیگری (شعبه، اجاره‌ای، …) **دست نمی‌خورد**. اگر کالا فقط آن‌جا
     * باشد، باقی‌مانده مثل رفتار همیشگی روی موجودی فروشگاه منفی می‌رود و هشدار
     * نشان داده می‌شود — و هشدار **صریحاً می‌گوید** کالا در کدام انبارها هست و
     * چرا از آن‌ها برداشته نشد، تا کاربر گیج نشود.
     * =====================================================================
     */
    const houses = await client.secondaryWarehouse.findMany({
      select: { id: true, name: true, isDefault: true, location: true }
    })
    const realDefault = houses.find((h) => h.isDefault) ?? null
    const centralName = realDefault?.name ?? DEFAULT_SECONDARY_WAREHOUSE_NAME
    /** شناسه‌های «انبار مرکزی پیش‌فرض» — `null` همیشه، و ردیف واقعیِ isDefault اگر باشد. */
    const centralIds: (number | null)[] = [null, ...(realDefault ? [realDefault.id] : [])]
    const isCentral = (warehouseId: number | null): boolean => centralIds.includes(warehouseId ?? null)
    const nameOfWarehouse = (warehouseId: number | null): string =>
      warehouseId == null ? centralName : (houses.find((h) => h.id === warehouseId)?.name ?? `انبار ${warehouseId}`)

    // یک بار خواندن کل فهرست: کوچک است و تطبیق متنی در JS دقیق‌تر و ساده‌تر است.
    // `warehouseId` هم خوانده می‌شود، چون مبنای همان فیلتر بالاست.
    const rows = await client.secondaryStockItem.findMany({
      select: { id: true, name: true, code: true, qty: true, warehouseId: true },
      orderBy: { id: 'asc' }
    })
    // نسخه‌ی کاری، تا چند قلم از یک ردیف مشترک دو بار یک موجودی را برندارند
    const live = new Map(rows.map((r) => [r.id, { ...r }]))

    const taken: CentralWithdrawLine[] = []
    const warnings: string[] = []

    for (const { v, shortage } of shortages) {
      const unit = v.product?.unit ?? 'عدد'
      const title = variantTitle(v)
      /** همه‌ی ردیف‌های تطبیق‌خورده (هر انباری) — برای هشدارِ «کجا هست ولی برداشته نشد». */
      const allMatched = matchRows([...live.values()], v)
      /** فقط انبار مرکزی پیش‌فرض: تنها چیزی که برداشت خودکار به آن دست می‌زند. */
      const candidates = allMatched.filter((c) => isCentral(live.get(c.id)?.warehouseId ?? null))

      let remaining = shortage
      const sources: CentralWithdrawLine['sources'] = []
      for (const c of candidates) {
        if (remaining <= 0) break
        const row = live.get(c.id)
        if (!row || row.qty <= 0) continue
        const take = Math.min(remaining, row.qty)
        row.qty -= take
        remaining -= take
        await client.secondaryStockItem.update({ where: { id: row.id }, data: { qty: row.qty } })
        sources.push({
          id: row.id,
          name: row.name,
          taken: take,
          remaining: row.qty,
          warehouseId: row.warehouseId ?? null,
          warehouseName: nameOfWarehouse(row.warehouseId ?? null)
        })
      }

      /**
       * انبارهایی که همین کالا را با موجودی مثبت دارند ولی **مرکزی نیستند**.
       * فقط برای متن هشدار است و هیچ عددی را عوض نمی‌کند.
       */
      const elsewhere = new Map<string, number>()
      for (const c of allMatched) {
        const row = live.get(c.id)
        if (!row || row.qty <= 0) continue
        if (isCentral(row.warehouseId ?? null)) continue
        const label = nameOfWarehouse(row.warehouseId ?? null)
        elsewhere.set(label, (elsewhere.get(label) ?? 0) + row.qty)
      }
      const elsewhereNote = elsewhere.size
        ? ` این کالا در ${[...elsewhere.entries()]
            .map(([label, qty]) => `«${label}» (${faDigits(qty)} ${unit})`)
            .join(' و ')} موجود است، ولی «برداشت خودکار» فقط از «${centralName}» برمی‌دارد و به انبارهای دیگر ` +
          'دست نمی‌زند. برای برداشت از آن انبارها، تیک را خاموش کنید و انبار مبدأ را خودتان انتخاب کنید.'
        : ''

      const got = shortage - remaining
      if (got > 0) {
        await inventoryService.increase(
          [{ variantId: v.id, qty: got }],
          {
            reason: 'CENTRAL_WITHDRAW',
            refType: opts.refType ?? 'SecondaryStockItem',
            userId: opts.userId ?? null,
            note: opts.note ?? `برداشت خودکار ${got} ${unit} از «${centralName}» برای «${title}»`
          },
          client as Prisma.TransactionClient
        )
        taken.push({
          variantId: v.id,
          name: title,
          unit,
          shortage,
          taken: got,
          missing: remaining,
          sources,
          warehouseName: centralName
        })
        warnings.push(
          `«${title}»: موجودی انبار فروشگاه ${faDigits(shortage)} ${unit} کم بود و ${faDigits(got)} ${unit} ` +
            `به‌صورت خودکار از «${centralName}» کسر شد (${sources
              .map(
                (sc) =>
                  `${sc.warehouseName} → ${sc.name}: ${faDigits(sc.taken)} ${unit} برداشته شد، ` +
                  `${faDigits(sc.remaining)} باقی ماند`
              )
              .join(' · ')}).` +
            (remaining > 0
              ? ` ⚠️ ${faDigits(remaining)} ${unit} در «${centralName}» هم نبود، پس همین مقدار روی موجودی فروشگاه منفی ثبت می‌شود.` +
                elsewhereNote
              : '')
        )
      } else {
        warnings.push(
          `«${title}»: کمبود ${faDigits(shortage)} ${unit} است ولی ردیف متناظری با موجودی مثبت در «${centralName}» ` +
            `پیدا نشد (تطبیق بر اساس کد، بارکد یا نام کالا انجام می‌شود)، پس مثل قبل موجودی فروشگاه منفی ثبت می‌شود.` +
            elsewhereNote
        )
      }
    }

    const totalTaken = taken.reduce((sum, t) => sum + t.taken, 0)
    if (totalTaken > 0)
      await audit(client, {
        action: AuditAction.CENTRAL_WITHDRAW,
        entity: 'SecondaryStockItem',
        userId: opts.userId ?? null,
        after: JSON.stringify(taken),
        note: `برداشت خودکار ${totalTaken} عدد از «${centralName}» (انبار مرکزی پیش‌فرض) برای پوشش کمبود موجودی فروشگاه`
      })

    return { warnings, taken, totalTaken }
  }
}
