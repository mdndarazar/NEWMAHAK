import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { inventoryService } from './InventoryService'
import { audit, auditOrThrow } from './AuditService'
import { salesService } from './SalesService'
import { shiftService } from './ShiftService'
import { BusinessError } from '../errors'
import { TX_OPTIONS } from '../db/tx'
import {
  AuditAction,
  ConsolidationDayState,
  CONSOLIDATION_DAY_LABELS,
  CashMovementType,
  ChequeStatus,
  PaymentEntryKind,
  normalizePaymentDestination,
  paymentDestinationLabel,
  destinationReachedStore
} from '@shared/enums'
import { calculateCashClose, receiptBucketOf } from '@shared/accounting'
import { cashMovementTotals } from './accountingReport'
import { cashMovementService, recordCashMovement } from './CashMovementService'
import { settingsService } from './SettingsService'
import { money } from '@shared/jalali'
import {
  jalaliToday,
  jalaliStartOfDay,
  jalaliEndOfDay,
  jalaliDaysBetween,
  toJalaliDate,
  toClock,
  faDigits,
  isValidJalaliDate,
  toLatinDigits
} from '@shared/jalali'
import type {
  CashCloseInput,
  SaleReportFilter,
  ConsolidationDay,
  ConsolidationDaysResult,
  ShiftDetailFilter,
  ShiftDetailResult,
  ShiftPaymentRow
} from '@shared/types'
import { reportDayInput, destructiveDayInput, destructiveRangeInput } from './reportDate'
import { toNumberRial, toRial } from '@shared/money'
import { remainingOf } from '@shared/settlement'
import { debtAdjustmentsByInvoice, adjustmentsOrEmpty } from './invoiceDebt'

/** بازه‌ی ISO از ورودی شمسی یا ISO (یک منبع واحد برای همه‌ی متدها). */
function resolveRange(range: { from?: string; to?: string; fromJalali?: string; toJalali?: string }) {
  const fromJalali = range.fromJalali ?? (range.from ? toJalaliDate(new Date(range.from)) : jalaliToday())
  const toJalali = range.toJalali ?? (range.to ? toJalaliDate(new Date(range.to)) : fromJalali)
  const from = range.from ? new Date(range.from) : jalaliStartOfDay(fromJalali)
  const to = range.to ? new Date(range.to) : jalaliEndOfDay(toJalali)
  return { from, to, fromJalali, toJalali }
}

function consolidationDayOf(raw: string | null | undefined, label: string, fallback: string): string {
  const clean = toLatinDigits(String(raw ?? '')).trim()
  if (!clean) return fallback
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» تجمیع با تأخیر معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.`
    )
  return clean
}

function assertNonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new BusinessError(
      `${label} باید عدد صحیح غیرمنفی باشد؛ اعشار، منفی، NaN، بی‌نهایت یا عدد خارج از سقف امن پذیرفته نیست.`
    )
  return value
}

function assertPositiveSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0)
    throw new BusinessError(
      `${label} باید عدد صحیح بزرگ‌تر از صفر باشد؛ اعشار، منفی، NaN، بی‌نهایت یا عدد خارج از سقف امن پذیرفته نیست.`
    )
  return value
}

/** قفل یکتای اولین بستن صندوق؛ بستن دوباره با تأیید این ردیف را نمی‌سازد. */
async function claimCashCloseGuard(tx: Prisma.TransactionClient, key: string): Promise<void> {
  await tx.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS "CashCloseGuard" ("key" TEXT NOT NULL PRIMARY KEY, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`
  )
  try {
    await tx.$executeRawUnsafe(`INSERT INTO "CashCloseGuard" ("key") VALUES (?)`, key)
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (e?.code === 'P2002' || /UNIQUE|unique constraint|constraint failed/i.test(msg))
      throw new BusinessError(
        'این نشست/بازه هم‌زمان توسط درخواست دیگری بسته شد. اگر مطمئن هستید، بستن دوباره را تأیید کنید؛ اثر خالص نقد و انبار دوباره اعمال نمی‌شود.'
      )
    throw e
  }
}

function validateCashCloseInput(input: Partial<CashCloseInput> & { from?: string; to?: string }): void {
  if (input.shiftId != null) assertPositiveSafeInteger(input.shiftId, 'شناسه نشست')
  if (input.userId != null) assertPositiveSafeInteger(input.userId, 'شناسه کاربر')
  if (input.openingFloat != null) assertNonNegativeSafeInteger(input.openingFloat, 'موجودی اول صندوق')
  if (input.countedCash != null) assertNonNegativeSafeInteger(input.countedCash, 'شمارش نقدی صندوق')
  if (input.countedTotal != null) assertNonNegativeSafeInteger(input.countedTotal, 'شمارش قدیمی صندوق')
  if (input.differenceThreshold != null)
    assertNonNegativeSafeInteger(input.differenceThreshold, 'آستانه مغایرت صندوق')
}

/**
 * ممیزی A69-01 — موجودی اولِ *ثبت‌شده* در لحظه‌ی بستن/پیش‌نمایش قابل جایگزینی نیست.
 * قبلاً عدد فرم بستن بی‌صدا جای رکورد CashMovement(OPENING_FLOAT) می‌نشست: موجودی
 * اول ۵۰۰ + فروش نقد ۱٬۰۰۰ و شمارش ۱٬۲۰۰ (۳۰۰ کسری واقعی) با زدن «۲۰۰» در فرم
 * «تطبیق کامل» می‌شد. اصلاح موجودی اول فقط با واریز/برداشت سابقه‌دار ممکن است.
 */
function assertRecordedOpeningFloat(recorded: number, raw: unknown): number {
  const asked = assertNonNegativeSafeInteger(raw, 'موجودی اول صندوق')
  const rec = Math.round(Number(recorded) || 0)
  if (rec > 0 && asked !== rec)
    throw new BusinessError(
      `موجودی اول این نشست قبلاً ${money(rec)} ریال ثبت شده است و در فرم بستن صندوق ${money(asked)} ریال وارد شده. ` +
        'عدد ثبت‌شده در بستن صندوق عوض نمی‌شود؛ اگر واقعاً اشتباه ثبت شده، از «گردش صندوق» یک واریز یا برداشت با توضیح ثبت کنید ' +
        'یا فیلد موجودی اول را خالی بگذارید تا همان عدد ثبت‌شده استفاده شود.'
    )
  return asked
}

async function cashHandoverWarning(
  shift: { id: number; openedAt: Date } | null,
  openingFloat: number
): Promise<string | null> {
  if (!shift) return null
  /**
   * ممیزی AUDIT-S139-02 (AUDIT-D69) — «نشست قبلی» = نشستِ (Shift) شمرده‌شده‌ای که درست پیش از این
   * نشست شروع شده، و از آن، **آخرین** بستن (D47: بستن دوباره شمارش اصلاحی است، حتی اگر بعد از
   * باز شدن نشست تازه انجام شده باشد). قبلاً ملاک closedAt ردیف CashSession ≤ شروع نشست بود ⇒
   * بستن دوباره‌ی نشست قبلی بعد از تحویل نادیده می‌ماند (هشدار کاذب یا مغایرت پنهان) و بستن
   * بازه‌ای بی‌نشست جای نشست قبلی را می‌گرفت. خوانش با take:1 (قبلاً کل جدول بی‌سقف).
   */
  const prior = (await prisma.cashSession.findFirst({
    where: {
      countedTotal: { not: null },
      closedAt: { not: null },
      shiftId: { not: null },
      fromDate: { lt: new Date(shift.openedAt) }
    },
    orderBy: [{ fromDate: 'desc' }, { closedAt: 'desc' }, { id: 'desc' }],
    select: { id: true, shiftId: true, countedTotal: true, closedAt: true }
  })) as any
  if (!prior || prior.countedTotal == null || Number(prior.countedTotal) === openingFloat) return null
  return (
    `⚠ اختلاف شمارش نقد تحویل: نشست قبلی ${money(Number(prior.countedTotal))} ریال شمرده شده، ` +
    `اما موجودی اول این نشست ${money(openingFloat)} ریال ثبت شده است؛ علت را در یادداشت بستن صندوق ثبت کنید.`
  )
}

/**
 * ===========================================================================
 * مورد ۶ — «پرداختی‌های نسیه‌ی دریافت‌شده در این شیفت».
 *
 * مسئله‌ی واقعی مالک فروشگاه: پنجره‌ی «جزئیات شیفت» تا این نسخه فقط *بدهیِ تازه*
 * را نشان می‌داد (فاکتورهایی که در همین شیفت نسیه صادر شده‌اند). ولی پولی که
 * فروشنده در همین شیفت بابت یک فاکتور نسیه‌ی *هفته‌ها یا ماه‌ها قبل* گرفته، هم
 * در کشوی صندوق و هم روی دستگاه کارتخوان هست و هیچ‌جای این پنجره دیده نمی‌شد.
 * نتیجه: «جمع فروش سیستم» با «جمع واقعی کارتخوان/نقدی» نمی‌خواند و دلیلش پیدا
 * نبود.
 *
 * منطق، عمداً ساده و بی‌استثنا: **هر رکورد `Payment` که لحظه‌ی دریافتش داخل
 * بازه‌ی زمانی همین شیفت باشد** — بدون توجه به تاریخ فاکتور اصلی.
 *
 * سه تصمیم که ارزش توضیح دارند:
 *   ۱) «بازه‌ی شیفت» = از `openedAt` تا `closedAt` (و برای شیفت باز، تا همین
 *      لحظه). برای رکوردهای بازه‌ای بدون شیفت، همان بازه‌ی خودِ رکورد.
 *   ۲) `remainingAfter` (باقی‌ماندهٔ بدهی *بعد از* همین پرداختی) با جمع‌زدن
 *      پرداختی‌های همان فاکتور به ترتیب زمان حساب می‌شود، نه با کسر ساده از
 *      `paidTotal`؛ وگرنه برای فاکتوری با چند پرداختی، هر سه ردیف یک عدد
 *      می‌گرفتند.
 *   ۳) **چکِ پاس‌نشده پول نیست.** در فهرست دیده می‌شود (چون سند دارد) ولی نه در
 *      جمع دریافتی می‌آید و نه باقی‌مانده‌ی بدهی را کم می‌کند — همان قاعده‌ای که
 *      بقیه‌ی برنامه با چک دارد.
 * ===========================================================================
 */

/** این پرداختی «پول واقعیِ دریافت‌شده» است؟ (چک تا پاس نشود، نه) */
const isReceived = (p: { kind: string | null; chequeStatus: string | null }): boolean =>
  (p.kind ?? 'CASH') !== 'CHEQUE' || p.chequeStatus === 'CLEARED'

const CASHBOX_READ_PAGE = 2000
const CASHBOX_IN_CHUNK = 500

async function readAll<T>(readPage: (page: { skip: number; take: number }) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = []
  let skip = 0
  while (true) {
    const page = await readPage({ skip, take: CASHBOX_READ_PAGE })
    rows.push(...page)
    if (page.length < CASHBOX_READ_PAGE) return rows
    skip += page.length
  }
}

/**
 * نشست ۱۱۴ · بند ۴-۴۶ — سابقه‌ی بستن صندوق و تجمیع قبلاً با `take: 200` ثابت و
 * بی‌صدا بریده می‌شدند. حالا تا ۵٬۰۰۰ ردیف یک‌جا، totalCount واقعی و هشدار
 * فارسی هنگام برش، با همان قرارداد PagedRows گزارش‌ها (آرایه + page + warnings)
 * تا مصرف‌کننده‌های فعلی آرایه نشکنند.
 */
const HISTORY_PAGE_MAX = 5000

function historyPage(rawTake: unknown, rawSkip: unknown, totalCount: number) {
  const t = Math.round(Number(rawTake ?? HISTORY_PAGE_MAX))
  const k = Math.round(Number(rawSkip ?? 0))
  const take = Math.min(Math.max(Number.isFinite(t) ? t : HISTORY_PAGE_MAX, 1), HISTORY_PAGE_MAX)
  const skip = Math.max(Number.isFinite(k) ? k : 0, 0)
  return { skip, take, totalCount, truncated: false }
}

function attachHistoryPage<T>(
  rows: T[],
  page: { skip: number; take: number; totalCount: number; truncated: boolean },
  what: string
): T[] & { page: typeof page; warnings: string[] } {
  page.truncated = page.totalCount > page.skip + rows.length
  const hidden = page.totalCount - rows.length
  const warnings = hidden > 0
    ? [
        `نمایش ${faDigits(rows.length)} از ${faDigits(page.totalCount)} ${what} (از ردیف ${faDigits(page.skip + 1)})؛ ` +
          'بقیه‌ی ردیف‌ها در صفحه‌ی دیگرند یا بازه را کوچک‌تر کنید تا هیچ ردیفی دیده‌نشده نماند.'
      ]
    : []
  return Object.assign(rows, { page, warnings })
}

function chunksOf<T>(values: T[], size = CASHBOX_IN_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

function emptyConsolidationRetrySummary() {
  return {
    count: 0,
    goodsTotal: 0,
    taxTotal: 0,
    serviceTotal: 0,
    discountTotal: 0,
    deliveryTotal: 0,
    grandTotal: 0,
    cashTotal: 0,
    cardTotal: 0,
    otherTotal: 0,
    creditTotal: 0,
    destinationUnknownTotal: 0,
    returnedTotal: 0,
    rows: undefined,
    groups: undefined
  }
}

/**
 * نشست ۱۸۹ · ۱-۵ — جمع پول همان فاکتورهایی که داخل تراکنش قفل/وصل می‌شوند،
 * نه summary بیرونی که ممکن است بین خواندن و نوشتن عوض شود.
 */
async function snapshotConsolidationFromInvoices(tx: Prisma.TransactionClient, invoiceIds: number[]) {
  let goodsTotal = 0
  let taxTotal = 0
  let serviceTotal = 0
  let discountTotal = 0
  let deliveryTotal = 0
  let grandTotal = 0
  let receivedTotal = 0
  let returnedTotal = 0
  for (const ids of chunksOf(invoiceIds)) {
    const agg = await tx.saleInvoice.aggregate({
      where: { id: { in: ids } },
      _sum: {
        goodsTotal: true,
        taxTotal: true,
        serviceCharge: true,
        discountTotal: true,
        deliveryFee: true,
        grandTotal: true,
        paidTotal: true
      }
    })
    const sum = agg._sum ?? {}
    goodsTotal += toNumberRial(sum.goodsTotal ?? 0)
    taxTotal += toNumberRial(sum.taxTotal ?? 0)
    serviceTotal += toNumberRial(sum.serviceCharge ?? 0)
    discountTotal += toNumberRial(sum.discountTotal ?? 0)
    deliveryTotal += toNumberRial(sum.deliveryFee ?? 0)
    grandTotal += toNumberRial(sum.grandTotal ?? 0)
    receivedTotal += toNumberRial(sum.paidTotal ?? 0)
  }
  for (const ids of chunksOf(invoiceIds)) {
    const ret = await tx.saleReturn.aggregate({
      where: { invoiceId: { in: ids }, voidedAt: null },
      _sum: { total: true }
    })
    returnedTotal += toNumberRial(ret._sum?.total ?? 0)
  }
  return {
    goodsTotal,
    taxTotal,
    serviceTotal,
    discountTotal,
    deliveryTotal,
    grandTotal,
    receivedTotal,
    returnedTotal,
    count: invoiceIds.length
  }
}

async function shiftPaymentsOf(
  from: Date,
  to: Date,
  shiftId?: number | null
): Promise<{ rows: ShiftPaymentRow[]; totals: NonNullable<ShiftDetailResult['shiftPaymentTotals']> }> {
  const empty = {
    rows: [] as ShiftPaymentRow[],
    totals: {
      count: 0, total: 0, priorTotal: 0, priorCount: 0, pendingChequeTotal: 0,
      cashTotal: 0, cardTotal: 0, managerTotal: 0, unknownTotal: 0
    }
  }
  if (!(from instanceof Date) || !(to instanceof Date) || !(from.getTime() <= to.getTime())) return empty

  /**
   * =========== کار الف (جلسه ۳۶) + نشست ۱۸۹ · ۱-۶ ===========
   * گزارش فروش مالک رویداد را از `createdShiftId` / `clearedShiftId` می‌خواند.
   * جزئیات شیفت تا امروز همان پول را با پنجره‌ی `paidAt`/`clearedAt` می‌گرفت.
   *
   * سناریو: وصول نسیه در شیفت B با تاریخ گذشته‌نگرِ شیفت A ⇒ گزارش اصلی در B،
   * جزئیات شیفت در A (یا هیچ‌کدام). دو پنل برای یک پول دو جواب.
   *
   * قاعده: کلید همیشه نشست. ردیف قدیمیِ بی‌ستون (`createdShiftId` خالی) هنوز
   * با همان پنجره‌ی زمانی می‌آید تا داده‌ی تاریخی غیب نشود.
   *
   * چکی که در A ثبت و در B پاس شده: در A با createdShiftId، در B با
   * clearedShiftId (پرچم `byClearedAt`). یک ردیف در هر فراخوانی.
   */
  const byShift = shiftId != null && Number.isSafeInteger(shiftId) && shiftId > 0
  const payments = await readAll((page) => prisma.payment.findMany({
    where: {
      // نشست ۶۵ (S65-2) — پرداخت‌های سند باطل (فقط «ارزش کالای برگشتی» تعویض) بیرون
      invoice: { voidedAt: null },
      voidedAt: null,
      OR: byShift
        ? [
            { createdShiftId: shiftId },
            { createdShiftId: null, paidAt: { gte: from, lte: to } },
            {
              kind: PaymentEntryKind.CHEQUE,
              chequeStatus: ChequeStatus.CLEARED,
              clearedShiftId: shiftId
            },
            {
              kind: PaymentEntryKind.CHEQUE,
              chequeStatus: ChequeStatus.CLEARED,
              clearedShiftId: null,
              clearedAt: { gte: from, lte: to }
            }
          ]
        : [
            { paidAt: { gte: from, lte: to } },
            {
              kind: PaymentEntryKind.CHEQUE,
              chequeStatus: ChequeStatus.CLEARED,
              clearedAt: { gte: from, lte: to }
            }
          ]
    },
    include: { method: true, invoice: { include: { customer: true } } },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    ...page
  }))
  if (!payments.length) return empty

  /**
   * همه‌ی پرداختی‌های فاکتورهای درگیر، برای حساب کردن «باقی‌مانده بعد از همین
   * پرداختی». ترتیب زمانی، و در زمانِ برابر ترتیب شناسه — همان ترتیبی که
   * تاریخچه‌ی پرداختی‌های فاکتور در بقیه‌ی برنامه نشان می‌دهد.
   */
  const invoiceIds = [...new Set(payments.map((p) => p.invoiceId))]
  const all = invoiceIds.length
    ? (
        await Promise.all(
          chunksOf(invoiceIds).map((ids) =>
            prisma.payment.findMany({
              // ممیزی A88-03 — جمع تجمعی دریافتی‌ها بدون پرداخت‌های باطل
              where: { invoiceId: { in: ids }, voidedAt: null },
              select: { id: true, invoiceId: true, amount: true, kind: true, chequeStatus: true, paidAt: true },
              orderBy: [{ paidAt: 'asc' }, { id: 'asc' }]
            })
          )
        )
      ).flat()
    : []

  const debtByInvoice = invoiceIds.length ? await debtAdjustmentsByInvoice(prisma, invoiceIds) : new Map()

  /** paymentId ⇒ جمع دریافتی‌های همان فاکتور تا و شاملِ همین پرداختی */
  const cumulative = new Map<number, number>()
  const running = new Map<number, number>()
  for (const p of all) {
    const before = running.get(p.invoiceId) ?? 0
    // نشست ۱۸۱: مبالغ از دیتابیس BigInt‌اند؛ `Math.round`/`Math.max` روی BigInt
    // کار نمی‌کنند، پس تبدیل صریح در همین مرز انجام می‌شود.
    const now = before + (isReceived(p) ? Math.max(0, toNumberRial(p.amount)) : 0)
    running.set(p.invoiceId, now)
    cumulative.set(p.id, now)
  }

  const rows: ShiftPaymentRow[] = []
  for (const p of payments) {
    const inv = p.invoice
    if (!inv) continue
    const grandTotal = Math.max(0, toNumberRial(inv.grandTotal))
    const received = cumulative.get(p.id) ?? 0
    const pendingCheque = !isReceived(p)
    /**
     * این ردیف با *تاریخ پاس شدن* به این شیفت افتاده، نه با تاریخ ثبتش؟
     * (چکِ پاس‌شده‌ای که `paidAt` آن بیرون بازه است — همان ناسازگاری رفع‌شده)
     */
    const paidAtMs = (p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)).getTime()
    const isClearedCheque =
      (p.kind ?? 'CASH') === PaymentEntryKind.CHEQUE && p.chequeStatus === ChequeStatus.CLEARED
    const byClearedAt = byShift
      ? isClearedCheque && p.clearedShiftId === shiftId && p.createdShiftId !== shiftId
      : isClearedCheque && (paidAtMs < from.getTime() || paidAtMs > to.getTime())
    const fromPriorInvoice = inv.issuedAt.getTime() < from.getTime()
    const invoiceDateJalali = inv.issuedAtJalali || toJalaliDate(inv.issuedAt)
    const createdAt = p.createdAt instanceof Date ? p.createdAt : p.createdAt ? new Date(p.createdAt) : null
    const paidAtDate = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)
    const createdJalali = createdAt ? toJalaliDate(createdAt) : ''
    const paidJalali = p.paidAtJalali || toJalaliDate(paidAtDate)
    const backdated = !!(createdAt && Number.isFinite(createdAt.getTime()) && paidAtDate.getTime() + 60_000 < createdAt.getTime())
    const adj = adjustmentsOrEmpty(debtByInvoice, inv.id)
    rows.push({
      paymentId: p.id,
      invoiceId: inv.id,
      receiptNo: inv.receiptNo,
      customerName: inv.customer?.name ?? 'مشتری عمومی',
      invoiceDateJalali,
      invoiceTime: toClock(inv.issuedAt, false),
      paidAtJalali: p.paidAtJalali || toJalaliDate(p.paidAt),
      paidAtTime: p.paidAtTime || toClock(p.paidAt, false),
      amount: Math.max(0, toNumberRial(p.amount)),
      methodLabel: p.method?.label ?? '—',
      kind: (p.kind ?? 'CASH') === 'CHEQUE' ? 'CHEQUE' : 'CASH',
      pendingCheque,
      seq: Math.max(1, Math.round(p.seq ?? 1)),
      grandTotal,
      remainingAfter: remainingOf({
        grandTotal,
        received,
        returnedValue: adj.returnedValue,
        refundFromReceived: adj.refundFromReceived
      }).remaining,
      fromPriorInvoice,
      backdated,
      label:
        (fromPriorInvoice
          ? `تسویه‌ی نسیه‌ی فاکتور ${faDigits(inv.receiptNo)} — صادرشده ${faDigits(invoiceDateJalali)}`
          : 'پرداختی فاکتور همین شیفت') + (backdated ? ' · ثبت با تاریخ قبل' : ''),
      note: p.note ?? null,
      // ---- کار الف (جلسه ۳۶): مقصد پول، همان برچسبی که همه‌جای برنامه می‌بیند ----
      destination: normalizePaymentDestination(p.destination),
      destinationLabel: paymentDestinationLabel(p.destination),
      reachedStore: destinationReachedStore(p.destination),
      byClearedAt
    })
  }

  /**
   * ---- کار الف (جلسه ۳۶): تفکیک دریافتیِ شیفت بر اساس مقصد پول ----
   * سبدبندی از همان تابع خالصِ `receiptBucketOf` رد می‌شود، پس این پنل هیچ‌وقت
   * با گزارش فروش و بستن صندوق واگرا نمی‌شود. جمع چهار سبد = `total`.
   * `managerTotal` پولی است که به حساب مدیر رفته و به صندوق/کارتخوان فروشگاه
   * نیامده. `unknownTotal` سبدِ «نه نقد، نه کارت، نه مدیر» است: داده‌ی قدیمیِ
   * بی‌مقصد (که هیچ حدسی برایش زده نمی‌شود) و هر روش پرداخت غیرنقدی/غیرکارتی.
   * عمداً همین چهار سبد است تا جمعشان *همیشه* برابر `total` باشد و هیچ ریالی
   * لای دسته‌بندی گم نشود.
   */
  const methodKindById = new Map(payments.map((p) => [p.id, p.method?.kind ?? null]))
  const totals = {
    count: rows.length,
    total: rows.filter((r) => !r.pendingCheque).reduce((sum, r) => sum + r.amount, 0),
    priorTotal: rows.filter((r) => r.fromPriorInvoice && !r.pendingCheque).reduce((sum, r) => sum + r.amount, 0),
    priorCount: rows.filter((r) => r.fromPriorInvoice).length,
    pendingChequeTotal: rows.filter((r) => r.pendingCheque).reduce((sum, r) => sum + r.amount, 0),
    cashTotal: 0,
    cardTotal: 0,
    managerTotal: 0,
    unknownTotal: 0
  }
  for (const r of rows) {
    if (r.pendingCheque) continue
    const bucket = receiptBucketOf({
      isCheque: r.kind === 'CHEQUE',
      destination: r.destination,
      methodKind: methodKindById.get(r.paymentId) ?? null
    })
    if (bucket === 'cash') totals.cashTotal += r.amount
    else if (bucket === 'card') totals.cardTotal += r.amount
    else if (bucket === 'managerAccount') totals.managerTotal += r.amount
    else totals.unknownTotal += r.amount
  }
  return { rows, totals }
}

/**
 * نشست ۲۱۱ — پرداخت‌های ویرایش/ابطال‌شده در همین پنجرهٔ بستن صندوق.
 * فقط نمایشی است و در `expectedCash` جمع نمی‌شود؛ مدیر ببیند چرا نقد کم شده.
 */
async function paymentMutationsInWindow(from: Date, to: Date) {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: [AuditAction.SALE_PAYMENT_UPDATE, AuditAction.SALE_PAYMENT_DELETE] },
      at: { gte: from, lte: to }
    },
    orderBy: { id: 'asc' },
    take: 500
  })
  const parse = (raw: unknown): unknown => {
    if (raw && typeof raw === 'object') return raw
    try {
      return JSON.parse(String(raw ?? '{}'))
    } catch {
      return {}
    }
  }
  const amountOf = (raw: unknown): number => {
    const v = parse(raw)
    if (Array.isArray(v))
      return v.reduce((s, x) => s + (Math.round(Number((x as { amount?: unknown })?.amount ?? 0)) || 0), 0)
    if (v && typeof v === 'object') return Math.round(Number((v as { amount?: unknown }).amount ?? 0)) || 0
    return 0
  }
  const destOf = (raw: unknown): string | null => {
    const v = parse(raw)
    if (Array.isArray(v)) return ((v[0] as { destination?: string | null })?.destination ?? null) as string | null
    if (v && typeof v === 'object') return ((v as { destination?: string | null }).destination ?? null) as string | null
    return null
  }
  return rows.map((a) => {
    const amountBefore = amountOf(a.before)
    const amountAfter = a.action === AuditAction.SALE_PAYMENT_DELETE ? 0 : amountOf(a.after) || amountBefore
    return {
      id: a.id,
      action: a.action,
      note: a.note ?? '',
      amountBefore,
      amountAfter,
      destinationBefore: destOf(a.before),
      destinationAfter: destOf(a.after) ?? destOf(a.before),
      atJalali: a.at ? toJalaliDate(a.at) : null,
      time: a.at ? toClock(a.at, false) : null
    }
  })
}

/**
 * ===========================================================================
 * کار الف (جلسه ۳۶) — اجزای شفافِ «نقد مورد انتظار»، یک جا برای هر دو مسیر.
 *
 * چرا یک تابع مشترک؟ چون `close()` و `expected()` دو نسخه‌ی جدا از همین نگاشت
 * داشتند و اگر یکی به‌روز می‌شد و دیگری نه، پیش‌نمایش با عددِ ثبت‌شده فرق می‌کرد.
 *
 * قاعده‌ی خواندن این بلوک: فقط ردیف‌هایی که `inExpected: true` دارند در فرمول
 * `expectedCash` هستند. بقیه (کارت، حساب مدیر) عمداً *فقط نمایشی*اند تا معلوم
 * باشد پول کجا رفته و هیچ مبلغی «بی‌توضیح» نماند.
 * ===========================================================================
 */
function cashCloseComponents(input: {
  openingFloat: number
  acc: { cash: any; cheques: any; credit: any; returns: any } | null
  fallbackCash: number
  deposits: number
  withdrawals: number
}) {
  const acc = input.acc
  return {
    openingFloat: input.openingFloat,
    cashReceived: acc?.cash.cashReceived ?? input.fallbackCash,
    /** نشست ۱۸۵ · بند ۴-۲۴ — سبد «نامشخص»ی که احتمالاً پول کشو بوده */
    unknownLikelyCash: acc?.cash.unknownLikelyCash ?? 0,
    /** چکِ پاس‌شده‌ای که پولش نقد به صندوق آمد — تنها سهمی که در انتظار نقد است */
    clearedCashCheques: acc?.cheques.clearedToCash ?? 0,
    /** چکِ پاس‌شده‌ی قدیمیِ بی‌مقصد؛ در انتظار نقد می‌آید ولی با برچسب «نامشخص» */
    clearedUnknownCheques: acc?.cheques.clearedUnknown ?? 0,
    /** چکی که با کارتخوان وصول شد — در انتظار *کارت* است، نه نقد */
    clearedCardCheques: acc?.cheques.clearedToCard ?? 0,
    /** چکی که به حساب مدیر رفت — در هیچ انتظاری نیست */
    clearedManagerCheques: acc?.cheques.clearedToManager ?? 0,
    /** کل چکِ پاس‌شده‌ی بازه (جمع چهار ردیف بالا) — فقط برای نمایش و تطبیق */
    clearedChequesAll: acc?.cheques.cleared ?? 0,
    /** وصول نسیه‌ی بازه‌های قبل، فقط سهم نقد — نشست ۱۶۴ · Y21: داخل cashReceived است، فقط نمایشی */
    priorCreditSettlements: acc?.credit.settledPriorCash ?? 0,
    priorCreditSettlementsCard: acc?.credit.settledPriorCard ?? 0,
    priorCreditSettlementsOther: acc?.credit.settledPriorOther ?? 0,
    priorCreditSettlementsAll: acc?.credit.settledPrior ?? 0,
    deposits: input.deposits,
    cashReturnRefunds: acc?.returns.cashRefunds ?? 0,
    cashExchangeRefunds: acc?.returns.exchangeCashRefunds ?? 0,
    withdrawals: input.withdrawals,
    /** ---- دو ردیفِ صرفاً توضیحی: در `expectedCash` نیستند ---- */
    managerAccountReceived: acc?.cash.managerAccountReceived ?? 0,
    destinationUnknownReceived: acc?.cash.destinationUnknownReceived ?? 0,
    /** «انتظار کارتخوان» = دریافتی کارت + چکی که با کارتخوان وصول شد + سهم کارتِ وصولی قبل */
    /**
     * نشست ۱۶۴ · Y21 — `cardReceived` و `clearedToCard` از قبل وصول دوره‌ی قبل را دارند؛
     * `settledPriorCard` دیگر جدا جمع زده نمی‌شود (همان دوبارشماریِ نقد، سمت کارتخوان).
     */
    cardExpected:
      (acc?.cash.cardReceived ?? 0) + (acc?.cheques.clearedToCard ?? 0)
  }
}

/**
 * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — چکِ پاس‌شده‌ی قدیمی با مقصد نامشخص بیرون از «نقد
 * مورد انتظار» است؛ پیش‌نمایش و ثبت نهایی هر دو همین یک متن هشدار را برمی‌گردانند تا مبلغ
 * بی‌صدا گم نشود.
 */
function unknownDestinationWarning(amount: number): string | null {
  if (!(amount > 0)) return null
  return (
    `${money(amount)} ریال چک پاس‌شده‌ی قدیمی با مقصد نامشخص در نقد مورد انتظار حساب نشده است (بند ۴-۲۴)؛ ` +
    'اگر وجهش واقعاً در کشو است، اضافه‌ی صندوق به همین اندازه طبیعی است و باید در یادداشت توضیح داده شود.'
  )
}

export const cashboxService = {
  /** «بستن صندوق»: جمع دریافتی نقد/کارت/اعتباری یک بازه یا شیفت. */
  async summary(range: SaleReportFilter & { fromJalali?: string; toJalali?: string }) {
    return salesService.summary(range)
  },

  /**
   * ==================== بستن صندوق (پایان شیفت) ====================
   * جمع دریافتی‌های شیفت/بازه در یک رکورد CashSession ثبت می‌شود و — اگر
   * کاربر بخواهد — همان شیفت هم بسته می‌شود (پایان شیفت).
   *
   * ⚠️ بستن صندوق هیچ چیزی از انبار کم نمی‌کند. کسر نهایی انبار فقط با
   * «تجمیع و انتقال» انجام می‌شود؛ این تفکیک عمدی است تا شیفت‌ها بتوانند
   * صندوقشان را ببندند ولی کسر انبار روز، یک‌جا و در پایان روز قطعی شود.
   * ==================================================================
   */
  async close(
    input: CashCloseInput & {
      from?: string
      to?: string
      /** Internal server-only custody hook; never comes from renderer IPC. */
      afterCloseInTx?: (tx: Prisma.TransactionClient, session: any, closedShiftRow: any | null) => Promise<void>
      custodyEffectiveTo?: Date
      /** An unattended, already-closed custody segment is reconciled by the
       * PIN-authenticated morning witness, not by its absent former owner.
       * IPC strips this internal-only marker before reaching this service. */
      internalCustodyRecovery?: boolean
    }
  ) {
    /** Legacy IPC receives this marker only when custody is enabled. */
    if ((input as any).custodyFence)
      throw new BusinessError('در حالت حضانت صندوق، بستن نهایی فقط از مسیر رسمی حضانت انجام می‌شود.', 'CUSTODY_LEGACY_PATH')
    validateCashCloseInput(input)
    /**
     * ==================== مورد ۴: شیفتِ درست هنگام بستن صندوق ====================
     * باگ قبلی: شیفت این‌جا از «شیفت بازِ امروز» گرفته می‌شد (یا از شناسه‌ای که
     * پنل، لحظه‌ی *باز شدن صفحه* خوانده بود). اگر شیفت صبح (۰۸–۱۴) بسته نشده
     * بود، بستن صندوق ساعت ۱۶ — که داخل بازه‌ی «شیفت ظهر» (۱۴–۲۰) است — با نام
     * «شیفت صبح» ثبت می‌شد.
     *
     * حالا وقتی «تعیین شیفت بر اساس ساعت» روشن باشد، شیفت از *ساعت همین لحظه*
     * تعیین می‌شود؛ مگر این‌که کاربر صریحاً یک شیفت مشخص را از فیلتر بالای پنل
     * انتخاب کرده باشد (`explicitShift`) که در آن صورت انتخاب خودش محترم است.
     * ==========================================================================
     */
    const byTime = await shiftService.byTimeEnabled(prisma)
    const scheduled = byTime && !input.explicitShift ? await shiftService.shiftForNow(prisma, { userId: input.userId ?? null }) : null
    const shift =
      scheduled ??
      (input.shiftId
        ? await prisma.shift.findUnique({ where: { id: input.shiftId } })
        : await shiftService.openShift(prisma))

    // `shiftId` از renderer می‌آید؛ actor از نشست باز main. پیش از هر محاسبه، ایجاد
    // CashSession یا بستن اختیاری Shift، باید روشن باشد که این نشست مال همان actor
    // است. این guard برای حالت `closeShift: false` هم لازم است، چون آن حالت فقط
    // snapshot صندوق می‌سازد و به `closeInTx` نمی‌رسد.
    if (shift && !input.internalCustodyRecovery) shiftService.assertClosingActor(shift, input.userId, 'بستن صندوق')

    // بازه: اگر شیفت مشخص است، بازه‌ی خود شیفت؛ وگرنه بازه‌ی انتخابی کاربر.
    // ممیزی A114-02 — بی‌نشست، '' یا نامعتبر یا معکوس ⇒ خطای فارسی (نه کل تاریخچه با jalaliStartOfDay(''))
    if (!shift) input = destructiveRangeInput(input, 'بستن صندوق')
    const range = resolveRange(input as any)
    /**
     * بند ۴-۴۷ — بستن دوباره بی‌صدا ممنوع است.
     *
     * CashSession یک snapshot حسابرسی است و اجرای دوم در صورت تأیید مجاز
     * می‌ماند، اما نباید با یک کلیک/درخواست تکراری ثبت شود. این گیت را در
     * main می‌گذاریم، نه فقط در renderer، تا درخواست مستقیم IPC هم همان
     * هشدار را ببیند.
     */
    const priorCloseWhere = shift
      ? { shiftId: shift.id }
      : {
          OR: [
            { dayJalali: { gte: range.fromJalali, lte: range.toJalali } },
            { fromDate: { gte: range.from, lte: range.to } }
          ]
        }
    const priorClose = await prisma.cashSession.findFirst({
      where: priorCloseWhere,
      orderBy: { id: 'desc' },
      select: { id: true, closedAt: true, createdAt: true }
    })
    if (priorClose && !input.allowRepeatClose)
      throw new BusinessError(
        `این ${shift ? 'نشست' : 'بازه'} قبلاً در ${
          priorClose.closedAt ? toJalaliDate(priorClose.closedAt) : toJalaliDate(priorClose.createdAt)
        } بسته/تجمیع شده است. اگر مطمئن هستید، بستن دوباره را تأیید کنید؛ اثر خالص نقد و انبار دوباره اعمال نمی‌شود.`
      )
    const filter: SaleReportFilter = shift
      ? { shiftId: shift.id }
      : { fromJalali: range.fromJalali, toJalali: range.toJalali }

    /**
     * =========================================================================
     * جلسه ۱۴ · بند ۱۱ و ۱۵ و ۱۶ — بستن صندوق روی `accounting.ts`، نه روی
     * `salesService.summary` قدیمی.
     *
     * ================== باگی که این بازنویسی رفعش می‌کند ==================
     * فرمول قبلیِ پنل (`boxTotal` در `CashClose.tsx`) این بود:
     *     نقد + کارت + سایر + اعتباری  ⟷  مقایسه با پول شمرده‌شده
     * این از نظر حسابداری **غلط** است: کارت روی کارتخوان است، نسیه اصلاً نیامده،
     * اعتبار خرید پول نیست، و ارزش کالای تعویض هم پول نیست. هیچ‌کدام داخل کشو
     * نیستند. پس «اختلاف» آن پنل هیچ‌وقت کسری واقعی را نشان نمی‌داد.
     *
     * ================== فرمول درست (بند ۴ سند مرجع) ==================
     *   expectedCash = openingFloat
     *                + cashReceived            (فقط نقد فیزیکی)
     *                + clearedCashChequeAmount (چکی که در این بازه پاس شد)
     *                (وصول نسیه‌ی بازه‌های قبل داخل cashReceived است و جدا جمع زده نمی‌شود — نشست ۱۶۴ · Y21)
     *                + deposits
     *                − cashReturnRefunds
     *                − cashExchangeRefunds
     *                − withdrawals
     *   cashDifference = countedCash − expectedCash
     *
     * کارت، چکِ در جریان، نسیه، اعتبار خرید و ارزش کالای تعویض **هرگز** به «پول
     * نقد داخل کشو» اضافه نمی‌شوند. خودِ فرمول در `accounting.ts` است؛ اینجا
     * فقط داده‌اش جمع می‌شود.
     * =========================================================================
     */
    const report = await salesService.reportRows(filter)
    const s = {
      count: report.totals.count,
      goodsTotal: report.totals.goodsTotal,
      taxTotal: report.totals.taxTotal,
      serviceTotal: report.totals.serviceTotal,
      discountTotal: report.totals.discountTotal,
      deliveryTotal: report.totals.deliveryTotal,
      grandTotal: report.totals.grandTotal,
      cashTotal: report.totals.cashTotal,
      /**
       * ⚠️ کار الف (جلسه ۳۶) — «سایر» دیگر بی‌صدا در «کارت» جمع نمی‌شود.
       * چکِ پاس‌شده در سبد «سایر» می‌نشست و از همین‌جا به «انتظار کارتخوان» اضافه
       * می‌شد، در حالی که همان مبلغ از راه `clearedCashChequeAmount` در «انتظار
       * نقد» هم شمرده شده بود ⇒ هر چک پاس‌شده **دو بار** در انتظارهای صندوق
       * می‌آمد و مالک هنگام بستن صندوق کسری/اضافه‌ی بی‌دلیل می‌دید.
       */
      cardTotal: report.totals.cardTotal,
      otherTotal: report.totals.otherTotal,
      /** دریافتیِ حساب مدیر و «نامشخص» — ردیف جدا، هرگز لای نقد/کارت */
      managerAccountTotal: report.totals.managerAccountTotal,
      destinationUnknownTotal: report.totals.destinationUnknownTotal,
      creditTotal: report.totals.creditTotal,
      returnedTotal: report.totals.returnedTotal,
      rows: report.rows,
      groups: report.groups
    }
    const acc = report.accounting ?? null

    if (!s.count && !input.note)
      throw new BusinessError(
        'در این بازه هیچ فاکتور فروشی ثبت نشده است، پس صندوقی برای بستن وجود ندارد. ' +
          'اگر آگاهانه می‌خواهید یک بستن صندوق خالی ثبت شود، در فیلد یادداشت دلیلش را بنویسید.'
      )

    // ---- گردش نقدی خارج از فروش: موجودی اول، برداشت، واریز (بند ۱۶) ----
    const movements = await cashMovementTotals({
      shiftId: shift?.id ?? null,
      from: shift?.openedAt ?? range.from,
      to: shift?.closedAt ?? range.to
    })
    const paymentMutations = await paymentMutationsInWindow(
      shift?.openedAt ?? range.from,
      shift?.closedAt ?? range.to
    )
    /**
     * موجودی اول: اگر کاربر عددی داد، همان ثبت می‌شود (و اگر رکوردی نبود، یک
     * `CashMovement(OPENING_FLOAT)` واقعی ساخته می‌شود تا سابقه‌اش گم نشود).
     * وگرنه از رکورد موجودِ همان شیفت خوانده می‌شود.
     */
    let openingFloat = movements.openingFloat
    let openingFloatToRecord: number | null = null
    if (input.openingFloat != null) {
      const asked = assertRecordedOpeningFloat(movements.openingFloat, input.openingFloat)
      if (asked > 0 && movements.openingFloat === 0) {
        openingFloatToRecord = asked
      }
      openingFloat = asked
    }

    const policy = await settingsService.accountingPolicy()
    const threshold =
      input.differenceThreshold != null
        ? assertNonNegativeSafeInteger(input.differenceThreshold, 'آستانه مغایرت صندوق')
        : policy.cashDifferenceThreshold

    /**
     * `countedCash` (نقد فیزیکیِ شمرده‌شده) فیلد درست این محاسبه است.
     * `countedTotal` قدیمی برای سازگاری پذیرفته می‌شود، ولی معنایش در پنل قبلی
     * «جمع همه‌چیز» بود؛ پس اگر هر دو آمدند، `countedCash` برنده است.
     */
    const countedCash =
      input.countedCash != null
        ? assertNonNegativeSafeInteger(input.countedCash, 'شمارش نقدی صندوق')
        : input.countedTotal != null
          ? assertNonNegativeSafeInteger(input.countedTotal, 'شمارش قدیمی صندوق')
          : null
    const handoverWarning = await cashHandoverWarning(shift, openingFloat)

    /**
     * =============== کار الف (جلسه ۳۶): ورودی‌های «نقد مورد انتظار» ===============
     * سه تغییر، هر سه رفعِ یک باگ واقعی:
     *   ۱) `clearedCashChequeAmount` دیگر **کلِ** چک‌های پاس‌شده نیست، فقط سهمی که
     *      مقصدش «نقد در صندوق فروشگاه» ثبت شده. قبلاً چکی که با کارتخوان وصول
     *      شده یا به حساب مدیر رفته بود هم انتظار نقد را بالا می‌برد.
     *   ۲) چکِ پاس‌شده‌ی **قدیمیِ** بی‌مقصد از راه `clearedUnknownChequeAmount`
     *      می‌آید. نشست ۱۶۱ · Y18 (بند ۴-۲۴، S160-D4): دیگر در انتظار نقد نمی‌نشیند؛
     *      فقط `unknownDestinationOutside` + هشدار صریح. برای داده‌ی تازه صفر است.
     *   ۳) `priorCashSettlements` فقط **سهم نقدِ** وصول نسیه‌ی بازه‌های قبل است.
     *      قبلاً کل وصولی (نقد + کارت + سایر) اینجا می‌آمد، پس پولی که روی
     *      کارتخوان نشسته بود «نقد مورد انتظار» را بالا می‌برد.
     *      نشست ۱۶۴ · Y21 (S163-D2): این مبلغ داخل `cashReceived` است؛ فقط نمایشی پاس می‌شود و
     *      `calculateCashClose` دیگر آن را به نقد مورد انتظار اضافه نمی‌کند (دوبارشماری).
     * و `managerAccountReceived` فقط برای *نمایش* پاس می‌شود؛ در فرمول هیچ نقشی
     * ندارد و نباید داشته باشد (آن پول داخل کشو نیست).
     */
    const closeResult = calculateCashClose(
      {
        openingFloat,
        // فقط نقد فیزیکی — کارت/سایر عمداً بیرون‌اند
        cashReceived: acc?.cash.cashReceived ?? s.cashTotal,
        /**
         * نشست ۱۸۵ · بند ۴-۲۴ — «احتمالاً نقد» از داده‌ی بی‌مقصدِ قدیمی.
         * سبدش «نامشخص» است ولی داخل نقد مورد انتظار می‌ماند تا کسری دروغ
         * ساخته نشود (ستون جدای خودش در خروجی هست).
         */
        unknownLikelyCash: acc?.cash.unknownLikelyCash ?? 0,
        clearedCashChequeAmount: acc?.cheques.clearedToCash ?? 0,
        clearedUnknownChequeAmount: acc?.cheques.clearedUnknown ?? 0,
        managerAccountReceived: acc?.cash.managerAccountReceived ?? 0,
        priorCashSettlements: acc?.credit.settledPriorCash ?? 0,
        deposits: movements.deposits,
        cashReturnRefunds: acc?.returns.cashRefunds ?? 0,
        cashExchangeRefunds: acc?.returns.exchangeCashRefunds ?? 0,
        withdrawals: movements.withdrawals,
        countedCash: countedCash ?? 0
      },
      threshold
    )

    /**
     * بند ۴ — اگر مغایرت از آستانه گذشت، یادداشت **اجباری** است. بدون این
     * اجبار، کسری‌های تکراری بی‌توضیح می‌ماندند و هدف کل ماژول از دست می‌رفت.
     */
    if (countedCash != null && closeResult.requiresNote && !String(input.note ?? '').trim())
      throw new BusinessError(
        `مغایرت صندوق ${money(Math.abs(closeResult.cashDifference))} ریال است ` +
          `(${closeResult.state === 'SHORTAGE' ? 'کسری' : 'اضافه'}) و از آستانه‌ی ${money(threshold)} ریال گذشته.\n` +
          'قبل از ثبت، در فیلد یادداشت دلیلش را بنویسید. این یادداشت در سابقه می‌ماند.'
      )

    /**
     * نشست ۶۹ — snapshot بستن صندوق و Audit باید یک واحد اتمیک باشند.
     * اگر نوشتن Audit شکست خورد، رکورد CashSession نیمه‌کاره باقی نمی‌ماند.
     *
     * نشست ۱۸۹ · ۱-۵ — بستن شیفت هم داخل همین تراکنش است (نه بعد از commit).
     * اگر Audit/بستن نشست شکست بخورد، سند صندوق هم rollback می‌شود تا
     * «صندوق بسته، شیفت باز» ساخته نشود.
     */
    const wantsShiftClose = input.closeShift !== false
    const { session, closedShiftRow } = await prisma.$transaction(async (tx) => {
      /**
       * این بررسی باید داخل همان تراکنشی باشد که snapshot را می‌سازد.
       * بررسی بیرونی فقط برای هشدار سریع UI است و به‌تنهایی جلوی race دو
       * پنجره را نمی‌گیرد: هر دو caller ممکن است بیرون transaction «هیچ
       * سابقه‌ای نیست» ببینند. در این نقطه، SQLite/Prisma نوشتن‌ها را
       * سریالی می‌کند و caller دوم بعد از commit اول دوباره همین شرط را
       * می‌خواند؛ بنابراین بدون تأیید، snapshot دوم ساخته نمی‌شود.
       *
       * نشست ۱۹۰ — لایه‌ی UNIQUE روی `CashCloseGuard`: دو BEGIN هم‌زمان ممکن است
       * هر دو `findFirst` را خالی ببینند. INSERT با کلید یکتا دومی را fail-closed می‌کند.
       */
      if (!input.allowRepeatClose) {
        const concurrentPrior = await tx.cashSession.findFirst({
          where: priorCloseWhere,
          orderBy: { id: 'desc' },
          select: { id: true, closedAt: true, createdAt: true }
        })
        if (concurrentPrior)
          throw new BusinessError(
            `این ${shift ? 'نشست' : 'بازه'} هم‌زمان توسط درخواست دیگری بسته شد. اگر مطمئن هستید، بستن دوباره را تأیید کنید؛ اثر خالص نقد و انبار دوباره اعمال نمی‌شود.`
          )
        await claimCashCloseGuard(
          tx,
          shift ? `shift:${shift.id}` : `range:${range.fromJalali}:${range.toJalali}`
        )
      }
      if (openingFloatToRecord != null) {
        /**
         * ممیزی A77-02 — موجودی اول داخل همان پنجره‌ی بسته‌شده ثبت می‌شود (شروع نشست
         * یا شروع بازه)، نه «الان»؛ وگرنه در بازه‌ی امروز شبح می‌شد، بستن دوباره آن را
         * دوباره ثبت می‌کرد و A69-01 روی پنجره‌ی گذشته دور زده می‌شد.
         */
        const already = await tx.cashMovement.findFirst({
          where: shift
            ? { shiftId: shift.id, type: CashMovementType.OPENING_FLOAT }
            : { shiftId: null, type: CashMovementType.OPENING_FLOAT, occurredAt: { gte: range.from, lte: range.to } },
          select: { id: true }
        })
        if (!already)
          await recordCashMovement(tx, {
            amount: openingFloatToRecord,
            type: CashMovementType.OPENING_FLOAT,
            shiftId: shift?.id ?? null,
            userId: input.userId ?? null,
            description: 'موجودی اول صندوق، ثبت‌شده در لحظه‌ی بستن صندوق',
            occurredAt: shift ? shift.openedAt ?? range.from : range.from
          })
      }
      const session = await tx.cashSession.create({
      data: {
        shiftId: shift?.id ?? null,
        fromDate: shift?.openedAt ?? range.from,
        toDate: input.custodyEffectiveTo ?? new Date(),
        dayJalali: shift?.dayJalali || range.fromJalali,
        cashTotal: s.cashTotal,
        cardTotal: s.cardTotal,
        creditTotal: s.creditTotal,
        /**
         * کار الف — این ستون از قبل وجود داشت ولی همیشه صفر نوشته می‌شد، چون
         * «سایر» داخل `cardTotal` قاطی بود. حالا هر سبد ستون خودش را دارد.
         */
        otherTotal: s.otherTotal,
        /** ---- کار الف: دو ستون تازه، هر دو فقط اطلاعاتی و بیرون از فرمول کسری ---- */
        managerAccountReceived: acc?.cash.managerAccountReceived ?? 0,
        destinationUnknownReceived: acc?.cash.destinationUnknownReceived ?? 0,
        grandTotal: s.grandTotal,
        invoiceCount: s.count,
        countedTotal: countedCash,
        /**
         * ---- بند ۱۵ — فیلدهای تفصیلیِ جلسه ۱۴، واقعاً پر می‌شوند ----
         * تا امروز این ستون‌ها وجود داشتند ولی هیچ‌وقت نوشته نمی‌شدند، پس پنل
         * بستن صندوق نمی‌توانست هیچ‌کدام را نشان بدهد.
         */
        openingFloat,
        cashSales: acc?.cash.cashReceived ?? s.cashTotal,
        cardSales: acc?.cash.cardReceived ?? 0,
        otherSales: acc?.cash.otherReceived ?? 0,
        clearedChequeSales: acc?.cheques.cleared ?? 0,
        /**
         * این دو ستون «سابقه‌ی کل رویداد» را نگه می‌دارند (کل چکِ پاس‌شده و کل
         * وصولی)، نه ورودی فرمول نقد. تفکیک مقصدشان در `accountingSnapshotJson`
         * کامل ذخیره می‌شود، پس هیچ عددی از سابقه گم نمی‌شود.
         */
        priorCreditSettlements: acc?.credit.settledPrior ?? 0,
        cashReturnRefunds: acc?.returns.cashRefunds ?? 0,
        cardReturnRefunds: acc?.returns.cardRefunds ?? 0,
        cashExchangeRefunds: acc?.returns.exchangeCashRefunds ?? 0,
        storeCreditIssued: acc?.storeCredits.issued ?? 0,
        storeCreditUsed: acc?.storeCredits.used ?? 0,
        pendingCheques: acc?.cheques.pendingFuture ?? 0,
        bouncedCheques: acc?.cheques.bounced ?? 0,
        withdrawals: movements.withdrawals,
        deposits: movements.deposits,
        expectedCash: closeResult.expectedCash,
        cashDifference: countedCash == null ? 0 : closeResult.cashDifference,
        /**
         * snapshot کامل صورت‌ها. چرا ذخیره می‌شود؟ چون اگر ماه بعد یک فاکتور با
         * تاریخ گذشته ثبت شود، اعداد *بازمحاسبه‌شده* عوض می‌شوند ولی صندوق آن روز
         * با همین اعداد بسته شده بود. بدون snapshot، سابقه‌ی صندوق قابل دفاع نیست.
         */
        accountingSnapshotJson: acc ? JSON.stringify(acc) : null,
        reportVersion: 'session14',
        closedAt: new Date(),
        closedBy: input.userId ?? null,
        note: input.note
      }
      })

      /**
       * ممیزی A69-02 — `audit` عمداً fail-open است؛ با آن، شکست نوشتن Audit
       * بی‌صدا رد می‌شد و CashSession بی‌سابقه commit می‌شد (خلاف S69-3).
       * بستن صندوق سند مالی است ⇒ fail-closed: یا هر دو، یا هیچ‌کدام.
       */
      await auditOrThrow(tx, {
      action: AuditAction.CASH_CLOSE,
      entity: 'CashSession',
      entityId: session.id,
      userId: input.userId ?? null,
      after: JSON.stringify({
        ...s,
        rows: undefined,
        groups: undefined,
        shiftId: shift?.id ?? null,
        openingFloat,
        expectedCash: closeResult.expectedCash,
        countedCash,
        cashDifference: countedCash == null ? null : closeResult.cashDifference,
        state: closeResult.state,
        withdrawals: movements.withdrawals,
        deposits: movements.deposits
      }),
      note:
        (shift ? `بستن صندوق ${shift.name}` : 'بستن صندوق بازه‌ای') +
        (countedCash == null
          ? ' · پول نقد شمرده نشد'
          : ` · انتظاری ${money(closeResult.expectedCash)} · شمرده‌شده ${money(countedCash)} · ` +
            `${closeResult.state === 'SHORTAGE' ? 'کسری' : closeResult.state === 'OVERAGE' ? 'اضافه' : 'تطبیق کامل'} ` +
            `${money(Math.abs(closeResult.cashDifference))} ریال`)
      })
      let closedShiftRow: Awaited<ReturnType<typeof shiftService.closeInTx>> | null = null
      if (shift && wantsShiftClose) {
        const liveShift = await tx.shift.findUnique({ where: { id: shift.id } })
        if (liveShift && !liveShift.closedAt) {
          closedShiftRow = await shiftService.closeInTx(tx, {
            shiftId: shift.id,
            userId: input.userId ?? null,
            note: input.note
          })
        }
      }
      if (input.afterCloseInTx) await input.afterCloseInTx(tx, session, closedShiftRow)
      return { session, closedShiftRow }
    }, TX_OPTIONS)

    const closedShift = closedShiftRow
      ? await shiftService.info(closedShiftRow.id)
      : shift
        ? await shiftService.info(shift.id)
        : null

    return {
      session,
      shift: closedShift,
      summary: { ...s, rows: undefined, groups: undefined },
      shiftClosed: !!closedShiftRow,
      /** ---- افزوده‌های جلسه ۱۴: همه‌چیزِ لازم برای نمایش شفافِ فرمول ---- */
      cashClose: {
        ...closeResult,
        countedProvided: countedCash != null,
        threshold,
        handoverWarning,
        paymentMutations,
        components: cashCloseComponents({
          openingFloat,
          acc,
          fallbackCash: s.cashTotal,
          deposits: movements.deposits,
          withdrawals: movements.withdrawals
        })
      },
      accounting: acc,
      warnings: [
        ...(report.warnings ?? []),
        ...(handoverWarning ? [handoverWarning] : []),
        ...(unknownDestinationWarning(closeResult.unknownDestinationOutside) ? [unknownDestinationWarning(closeResult.unknownDestinationOutside)!] : [])
      ]
    }
  },

  /**
   * ---- بند ۱۶ — پیش‌نمایشِ «انتظاری» *قبل* از زدن دکمه‌ی نهایی بستن صندوق ----
   * پنل باید فرمول را شفاف نشان بدهد، نه این‌که کاربر بعد از ثبت بفهمد چه شد.
   * این متد فقط می‌خواند و هیچ چیزی ثبت نمی‌کند.
   */
  async expected(
    input: { shiftId?: number | null; fromJalali?: string; toJalali?: string; countedCash?: number | null; openingFloat?: number | null } = {}
  ) {
    validateCashCloseInput(input)
    // ممیزی A114-02 — پیش‌نمایش = ثبت: بی‌نشست، تاریخ ''/نامعتبر/معکوس ⇒ همان خطای فارسی close
    if (input.shiftId == null) input = destructiveRangeInput(input, 'بستن صندوق')
    const range = resolveRange(input as any)
    const selectedShift =
      input.shiftId != null
        ? await prisma.shift.findUnique({ where: { id: input.shiftId }, select: { id: true, openedAt: true, closedAt: true } })
        : null
    const filter: SaleReportFilter =
      input.shiftId != null ? { shiftId: input.shiftId } : { fromJalali: range.fromJalali, toJalali: range.toJalali }
    const report = await salesService.reportRows(filter)
    const acc = report.accounting ?? null
    /**
     * ممیزی A92-01 — پنجره‌ی گردش نقدی نشست = openedAt..closedAt (همان close() و همان
     * resolveReportPeriod فروش)، نه «امروز» پیش‌فرض resolveRange. قبلاً برای شیفت شب عبوری از
     * نیمه‌شب موجودی اول و برداشت دیروز از پیش‌نمایش حذف می‌شد و پیش‌نمایش ≠ ثبت نهایی بود.
     */
    const window =
      selectedShift?.openedAt != null
        ? { from: selectedShift.openedAt, to: selectedShift.closedAt ?? range.to }
        : { from: range.from, to: range.to }
    const paymentMutations = await paymentMutationsInWindow(window.from, window.to)
    const movements = await cashMovementTotals({
      shiftId: input.shiftId ?? null,
      from: window.from,
      to: window.to
    })
    const policy = await settingsService.accountingPolicy()
    const openingFloat =
      input.openingFloat != null
        ? assertRecordedOpeningFloat(movements.openingFloat, input.openingFloat)
        : movements.openingFloat
    const handoverWarning = await cashHandoverWarning(selectedShift, openingFloat)

    const components = cashCloseComponents({
      openingFloat,
      acc,
      fallbackCash: report.totals.cashTotal,
      deposits: movements.deposits,
      withdrawals: movements.withdrawals
    })
    /**
     * ⚠️ پیش‌نمایش و ثبتِ نهایی **باید** یک عدد بدهند، وگرنه کاربر عددی را تأیید
     * می‌کند که ثبت‌شده با آن فرق دارد. پس هر دو از همان `cashCloseComponents`
     * بالا و با همان نگاشتِ ورودی‌ها رد می‌شوند.
     */
    const result = calculateCashClose(
      {
        openingFloat,
        cashReceived: components.cashReceived,
        unknownLikelyCash: components.unknownLikelyCash,
        clearedCashChequeAmount: components.clearedCashCheques,
        clearedUnknownChequeAmount: components.clearedUnknownCheques,
        managerAccountReceived: components.managerAccountReceived,
        priorCashSettlements: components.priorCreditSettlements,
        deposits: components.deposits,
        cashReturnRefunds: components.cashReturnRefunds,
        cashExchangeRefunds: components.cashExchangeRefunds,
        withdrawals: components.withdrawals,
        countedCash: input.countedCash == null ? 0 : assertNonNegativeSafeInteger(input.countedCash, 'شمارش نقدی صندوق')
      },
      policy.cashDifferenceThreshold
    )
    // ممیزی A92-01 — فهرست همان پنجره‌ی جمع‌ها: با نشست، کل نشست (بدون قید «امروز»)
    const mv = await cashMovementService.list(
      input.shiftId != null
        ? { shiftId: input.shiftId, take: HISTORY_PAGE_MAX }
        : { fromJalali: range.fromJalali, toJalali: range.toJalali, take: HISTORY_PAGE_MAX }
    )
    return {
      ...result,
      countedProvided: input.countedCash != null,
      threshold: policy.cashDifferenceThreshold,
      components,
      paymentMutations,
      movements: mv.rows,
      /** نشست ۱۱۴ — metadata صفحه‌ی فهرست گردش؛ هشدار برش به warnings اضافه می‌شود */
      movementsPage: mv.page,
      accounting: acc,
      handoverWarning,
      warnings: [
        ...(report.warnings ?? []),
        ...(mv.warnings ?? []),
        ...(handoverWarning ? [handoverWarning] : []),
        ...(unknownDestinationWarning(result.unknownDestinationOutside) ? [unknownDestinationWarning(result.unknownDestinationOutside)!] : [])
      ]
    }
  },

  /** سابقه‌ی بستن صندوق یک بازه. */
  async sessions(range: { fromJalali?: string; toJalali?: string; take?: number; skip?: number } = {}) {
    // ممیزی A114-01 — '' ⇒ امروز (نه jalaliStartOfDay('') و فهرست خالی بی‌صدا)، نامعتبر ⇒ خطای فارسی
    range = {
      ...range,
      fromJalali: reportDayInput(range?.fromJalali, 'از تاریخ', 'سابقه‌ی بستن صندوق'),
      toJalali: reportDayInput(range?.toJalali, 'تا تاریخ', 'سابقه‌ی بستن صندوق')
    }
    const r = resolveRange(range)
    const where = { OR: [{ dayJalali: { gte: r.fromJalali, lte: r.toJalali } }, { closedAt: { gte: r.from, lte: r.to } }] }
    const page = historyPage(range.take, range.skip, await prisma.cashSession.count({ where }))
    const rows = await prisma.cashSession.findMany({
      where,
      include: { shift: true },
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take
    })
    return attachHistoryPage(rows.map((c) => ({
      id: c.id,
      dayJalali: c.dayJalali || toJalaliDate(c.closedAt ?? c.createdAt),
      shiftName: c.shift?.name ?? 'بازه‌ای',
      shiftNumber: c.shift?.number ?? null,
      /**
       * مورد ۵ — سه فیلد *افزوده* (هیچ فیلدی کم نشده است) تا پنل بستن صندوق
       * بتواند روی هر ردیف سابقه، «جزئیات همان شیفت» را باز کند:
       *   • shiftId — شیفت همین رکورد (null = بستن صندوقِ بازه‌ای بدون شیفت)
       *   • fromJalali / toJalali — بازه‌ی همان رکورد، برای رکوردهای بی‌شیفت
       */
      shiftId: c.shiftId ?? null,
      fromJalali: toJalaliDate(c.fromDate),
      toJalali: toJalaliDate(c.toDate),
      invoiceCount: c.invoiceCount,
      cashTotal: c.cashTotal,
      cardTotal: c.cardTotal,
      /**
       * ---- کار الف (جلسه ۳۶): سه ستون تازه در سابقه ----
       * `otherTotal` از قبل وجود داشت ولی همیشه صفر نوشته می‌شد (سبد «سایر» لای
       * `cardTotal` قاطی بود). دو ردیف بعدی صرفاً توضیحی‌اند و در کسری/اضافی
       * صندوق نقشی ندارند. رکوردهای قدیمی برای هر سه صفر می‌مانند و هیچ عددی از
       * سابقه‌ی گذشته عوض نمی‌شود.
       */
      otherTotal: c.otherTotal,
      managerAccountReceived: c.reportVersion === 'session14' ? c.managerAccountReceived : null,
      destinationUnknownReceived: c.reportVersion === 'session14' ? c.destinationUnknownReceived : null,
      creditTotal: c.creditTotal,
      grandTotal: c.grandTotal,
      countedTotal: c.countedTotal,
      /**
       * ---------------- جلسه ۱۴ — اختلافِ درست در سابقه ----------------
       * فرمول قبلی این بود: `countedTotal − (نقد + کارت + اعتباری)`.
       * یعنی پول شمرده‌شده‌ی کشو را با مبلغی مقایسه می‌کرد که کارت و نسیه هم
       * داخلش بود — پس هر ردیف سابقه یک «اختلاف» بزرگِ دروغ نشان می‌داد.
       *
       * حالا: رکوردهای جلسه ۱۴ (`reportVersion = 'session14'`) عدد ذخیره‌شده‌ی
       * `cashDifference` خودشان را می‌دهند که با `expectedCash` درست حساب شده.
       * رکوردهای **قدیمی** آن ستون را ندارند؛ برای آن‌ها `null` برمی‌گردد و
       * پنل «—» نشان می‌دهد، نه یک عدد ساختگی. جعل تاریخ ممنوع.
       */
      expectedCash: c.reportVersion === 'session14' ? c.expectedCash : null,
      openingFloat: c.reportVersion === 'session14' ? c.openingFloat : null,
      withdrawals: c.reportVersion === 'session14' ? c.withdrawals : null,
      deposits: c.reportVersion === 'session14' ? c.deposits : null,
      diff: c.reportVersion === 'session14' && c.countedTotal != null ? c.cashDifference : null,
      /** رکورد قدیمی است و اختلاف نقدی‌اش قابل بازمحاسبه نیست */
      legacyRecord: c.reportVersion !== 'session14',
      closedAtJalali: c.closedAt ? toJalaliDate(c.closedAt) : null,
      /**
       * بخش ۳ — «ساعت بستن صندوق» (HH:MM). از همان `closedAt` رکورد خوانده
       * می‌شود، پس هیچ فیلد جدیدی در دیتابیس لازم نیست. اگر رکورد قدیمی
       * `closedAt` نداشته باشد، از `createdAt` خوانده می‌شود و اگر هیچ‌کدام
       * نبود `null` می‌ماند (جدول «—» نشان می‌دهد).
       */
      toClock: c.closedAt ? toClock(c.closedAt, false) : c.createdAt ? toClock(c.createdAt, false) : null,
      note: c.note ?? ''
    })), page, 'رکورد بستن صندوق')
  },

  /**
   * ==================== مورد ۵ — جزئیات کامل یک شیفت ====================
   * «هر ردیف سابقه‌ی بستن صندوق → جزئیات همان شیفت»: همان چیزی که گزارشات فروش
   * برای یک بازه‌ی دلخواه نشان می‌دهد، ولی **قفل‌شده روی یک شیفت مشخص** تا
   * عملکرد هر کارمند در هر شیفت جداگانه و دقیق قابل بررسی باشد:
   *
   *   • همه‌ی فاکتورهای فروش آن شیفت، با مبلغ و تفکیک نوع تسویه (نقدی/کارت/
   *     اعتباری) و جمع‌بندی کامل — از همان `salesService.reportRows`.
   *   • همه‌ی برگشت‌ها و تعویض‌های *همان شیفت* — از همان `returnList` /
   *     `exchangeList` گزارشات، فقط با فیلتر شیفت به‌جای فیلتر بازه‌ی تاریخ.
   *   • هر مبلغ نسیه‌ی ثبت‌شده در همان شیفت = فاکتورهایی که باقی‌ماندهٔ بدهی
   *     دارند (`remaining > 0`)، با همان عددی که تب «نسیه» نشان می‌دهد.
   *
   * ⚠️ این متد **فقط می‌خواند**: هیچ چیزی ثبت، تغییر یا حذف نمی‌کند و هیچ‌کدام از
   * محاسبه‌های موجود بازنویسی نشده‌اند — همان سرویس‌های همیشگی با فیلتر شیفت صدا
   * زده می‌شوند، پس عددهای این پنجره هیچ‌وقت با گزارشات فروش واگرا نمی‌شوند.
   *
   * رکوردهای «بستن صندوق بازه‌ای» (بدون شیفت) هم پشتیبانی می‌شوند: در آن حالت
   * بازه‌ی خود رکورد جای شیفت را می‌گیرد (`scope = 'RANGE'`).
   * ======================================================================
   */
  async shiftDetail(input: ShiftDetailFilter = {}): Promise<ShiftDetailResult> {
    const session = input.cashSessionId
      ? await prisma.cashSession.findUnique({ where: { id: input.cashSessionId }, include: { shift: true } })
      : null
    if (input.cashSessionId && !session) throw new BusinessError('این رکورد بستن صندوق پیدا نشد (شاید حذف شده است).')

    const shiftId = input.shiftId ?? session?.shiftId ?? null
    const shift = shiftId ? await shiftService.info(shiftId) : null
    if (shiftId && !shift) throw new BusinessError('این شیفت پیدا نشد (شاید با «حذف گزارشات» پاک شده است).')

    // بازه، فقط برای رکوردهای بی‌شیفت لازم است
    const range = resolveRange({
      fromJalali: input.fromJalali ?? (session ? toJalaliDate(session.fromDate) : undefined),
      toJalali: input.toJalali ?? (session ? toJalaliDate(session.toDate) : undefined)
    })
    const byShift = shiftId != null
    const scopeFilter = byShift
      ? { shiftId: shiftId as number }
      : { fromJalali: range.fromJalali, toJalali: range.toJalali }

    const sales = await salesService.reportRows(scopeFilter as SaleReportFilter)
    const returns = await salesService.returnList(scopeFilter)
    const exchanges = await salesService.exchangeList(scopeFilter)

    const creditRows = sales.rows.filter((r) => r.remaining > 0)

    /**
     * مورد ۶ — بازه‌ی زمانی واقعیِ همین شیفت. شیفتِ بازه‌ای (بدون شیفت) از بازه‌ی
     * خودِ رکورد بستن صندوق استفاده می‌کند، و شیفتِ باز تا همین لحظه.
     */
    const paymentsWindow = shift
      ? { from: new Date(shift.openedAt), to: shift.closedAt ? new Date(shift.closedAt) : new Date() }
      : { from: range.from, to: range.to }
    const shiftPayments = await shiftPaymentsOf(paymentsWindow.from, paymentsWindow.to, shiftId)

    const scopeLabel = shift
      ? `${shift.name} · ${faDigits(shift.dayJalali)} · شروع ${faDigits(shift.openedAtTime || '—')}` +
        (shift.closedAtTime ? ` · پایان ${faDigits(shift.closedAtTime)}` : ' · (شیفت باز است)') +
        (shift.userName ? ` · کاربر ${shift.userName}` : '')
      : `بستن صندوق بازه‌ای · ${faDigits(range.fromJalali)} تا ${faDigits(range.toJalali)}`

    return {
      scope: byShift ? 'SHIFT' : 'RANGE',
      scopeLabel,
      shift,
      session: session
        ? {
            id: session.id,
            dayJalali: session.dayJalali || toJalaliDate(session.closedAt ?? session.createdAt),
            toClock: session.closedAt
              ? toClock(session.closedAt, false)
              : session.createdAt
                ? toClock(session.createdAt, false)
                : null,
            // نشست ۱۸۱: ستون‌های صندوق BigInt شده‌اند؛ قرارداد این DTO (که از IPC
            // به رابط کاربری می‌رود) `number` است، پس تبدیل صریح در همین مرز.
            cashTotal: toNumberRial(session.cashTotal),
            cardTotal: toNumberRial(session.cardTotal),
            creditTotal: toNumberRial(session.creditTotal),
            grandTotal: toNumberRial(session.grandTotal),
            invoiceCount: session.invoiceCount,
            countedTotal: session.countedTotal == null ? null : toNumberRial(session.countedTotal),
            /**
             * 🔴 نشست ۱۸۴ · بند ۴-۵۶ — همان اصلاحی که در لیست سابقه انجام شده
             * بود ولی این‌جا جا مانده بود.
             *
             * فرمول قبلی `countedTotal − (نقد + کارت + اعتباری)` بود: فروش
             * کارتی را از پول فیزیکی کشو کم می‌کرد. نقد ۱٬۰۰۰٬۰۰۰ + کارت
             * ۲٬۰۰۰٬۰۰۰ با شمارش درستِ ۱٬۰۰۰٬۰۰۰ ⇒ «کسری ۲٬۰۰۰٬۰۰۰» به مدیر
             * نشان می‌داد. یک کسری کاملاً دروغ، روی صفحه‌ای که مدیر با آن
             * تصمیم می‌گیرد.
             *
             * حالا از `cashDifference` ذخیره‌شده می‌آید — همان عددی که خودِ
             * بستن صندوق با `expectedCash` حساب کرده.
             */
            diff:
              session.reportVersion === 'session14' && session.countedTotal != null
                ? toNumberRial(session.cashDifference)
                : null,
            diffAvailable: session.reportVersion === 'session14' && session.countedTotal != null,
            /** بند ۴-۵۶ — دو عدد جدا، تا مدیر «پول کشو» و «جمع فروش» را قاطی نکند */
            expectedCash: session.reportVersion === 'session14' ? toNumberRial(session.expectedCash) : null,
            settledTotal: toNumberRial(
              toRial(session.cashTotal) +
                toRial(session.cardTotal) +
                toRial(session.creditTotal) +
                toRial(session.otherTotal) +
                toRial(session.managerAccountReceived)
            ),
            note: session.note ?? ''
          }
        : null,
      sales,
      returns,
      // نشست ۱۸۱: `r.total` از ردیف Prisma می‌آید و حالا BigInt است.
      returnsTotal: returns.reduce((sum, r) => sum + toNumberRial(r.total ?? 0), 0),
      exchanges,
      creditRows,
      creditTotal: creditRows.reduce((sum, r) => sum + Math.max(0, r.remaining), 0),
      // مورد ۶ — پرداختی‌های دریافت‌شده در همین شیفت (حتی بابت فاکتورهای قدیمی)
      shiftPayments: shiftPayments.rows,
      shiftPaymentTotals: shiftPayments.totals
    }
  },

  /** پیش‌نمایش «تجمیع و انتقال» بدون هیچ تغییری در داده. */
  preview(range: SaleReportFilter) {
    return salesService.summary({ ...range, onlyNotConsolidated: true })
  },

  /**
   * ==================== تجمیع و انتقال (بستن حساب روز) ====================
   * منطق کلیدی:
   * ۱) در طول روز، هر فروش موجودی را فوراً کم می‌کند اما حرکت انبار با
   *    state = PENDING ثبت می‌شود (قابل بازبینی/اصلاح در همان روز).
   * ۲) با زدن این عملیات، حرکات PENDING *همان فاکتورها* به FINAL تبدیل
   *    می‌شوند و به این رکورد Consolidation گره می‌خورند => کسر انبار قطعی.
   * ۳) بعد از این نقطه، تنها راه بازگشت موجودی «برگشت از فروش» است که خودش
   *    یک حرکت مثبت جدید و FINAL می‌سازد (اصل عدم حذف سابقه).
   * ۴) فاکتورهای بازه به این تجمیع لینک می‌شوند تا **دوباره تجمیع نشوند** —
   *    همین لینک، تضمین «هر روز فقط یک بار کسر می‌شود» است.
   * ======================================================================
   */
  async finalize(range: SaleReportFilter & { dayJalali?: string; userId?: number | null }) {
    // ممیزی A114-02 — تجمیع کسر انبار را قطعی می‌کند: '' / نامعتبر / معکوس ⇒ خطای فارسی، نه کل تاریخچه یا سال بعد
    range = destructiveRangeInput(range, 'تجمیع')
    const dayJalali0 = destructiveDayInput(range.dayJalali, 'روز تجمیع', 'تجمیع')
    range = { ...range, dayJalali: dayJalali0 }
    const r = resolveRange(range as any)
    const dayJalali = range.dayJalali ?? (r.fromJalali === r.toJalali ? r.fromJalali : null)

    // فقط فاکتورهای تجمیع‌نشده‌ی بازه (فاکتورهای تجمیع‌شده دست‌نخورده می‌مانند)
    const invoices = await prisma.saleInvoice.findMany({
      where: { issuedAt: { gte: r.from, lte: r.to }, consolidationId: null, voidedAt: null },
      select: { id: true }
    })
    const initialInvoiceIds = invoices.map((i) => i.id)
    const priorConsolidation =
      !initialInvoiceIds.length
        ? await prisma.consolidation.findFirst({
            where: dayJalali ? { dayJalali } : { fromDate: r.from, toDate: r.to }
          })
        : null
    if (!initialInvoiceIds.length && !priorConsolidation)
      throw new BusinessError(
        r.fromJalali === r.toJalali
          ? `فروش تجمیع‌نشده‌ای برای ${faDigits(r.fromJalali)} پیدا نشد؛ این روز قبلاً تجمیع شده یا فروشی نداشته است.`
          : `در بازه‌ی ${faDigits(r.fromJalali)} تا ${faDigits(r.toJalali)} فاکتور تجمیع‌نشده‌ای نیست.`
      )

    /**
     * نشست ۱۸۹ · ۱-۵ — retry بدون فاکتور تازه، همان سند قبلی را برمی‌گرداند.
     * سند خالی و Audit جدا برای double-click ساخته نمی‌شود.
     */
    if (!initialInvoiceIds.length && priorConsolidation)
      return {
        consolidation: priorConsolidation,
        finalizedMovements: 0,
        invoiceCount: 0,
        dayJalali,
        retryNoOp: true,
        summary: emptyConsolidationRetrySummary()
      }

    return prisma.$transaction(async (tx) => {
      /**
       * نشست ۱۸۹ · ۱-۵ — مجموعه فاکتور و عدد تجمیع هر دو داخل همین تراکنش.
       * اگر اجرای قبلی بین query بیرونی و این نقطه فاکتورها را گرفته باشد،
       * سند خالی تازه ساخته نمی‌شود؛ همان تجمیع قبلی برمی‌گردد.
       */
      const liveInvoices = await tx.saleInvoice.findMany({
        where: { issuedAt: { gte: r.from, lte: r.to }, consolidationId: null, voidedAt: null },
        select: { id: true }
      })
      const invoiceIds = liveInvoices.map((i) => i.id)
      if (!invoiceIds.length) {
        const prior = await tx.consolidation.findFirst({
          where: dayJalali ? { dayJalali } : { fromDate: r.from, toDate: r.to },
          orderBy: { id: 'desc' }
        })
        if (!prior)
          throw new BusinessError(
            r.fromJalali === r.toJalali
              ? `فروش تجمیع‌نشده‌ای برای ${faDigits(r.fromJalali)} پیدا نشد؛ این روز قبلاً تجمیع شده یا فروشی نداشته است.`
              : `در بازه‌ی ${faDigits(r.fromJalali)} تا ${faDigits(r.toJalali)} فاکتور تجمیع‌نشده‌ای نیست.`
          )
        return {
          consolidation: prior,
          finalizedMovements: 0,
          invoiceCount: 0,
          dayJalali,
          retryNoOp: true,
          summary: emptyConsolidationRetrySummary()
        }
      }

      const snap = await snapshotConsolidationFromInvoices(tx, invoiceIds)
      const consolidation = await tx.consolidation.create({
        data: {
          fromDate: r.from,
          toDate: r.to,
          dayJalali,
          shiftId: range.shiftId ?? null,
          goodsTotal: snap.goodsTotal,
          taxTotal: snap.taxTotal,
          serviceTotal: snap.serviceTotal,
          discountTotal: snap.discountTotal,
          deliveryTotal: snap.deliveryTotal,
          grandTotal: snap.grandTotal,
          receivedTotal: snap.receivedTotal,
          returnedTotal: snap.returnedTotal,
          invoiceCount: invoiceIds.length,
          finalizedAt: new Date()
        }
      })

      /**
       * نشست ۱۷۵ · S175-D3 — invoiceIds همه‌ی فاکتورهای تجمیع‌نشده‌ی بازه است (بی‌سقف)؛ `id in` یکجا از
       * سقف IN ۵۰۰ (S99-2) رد می‌شد. حالا دسته‌های ۵۰۰تایی داخل همین تراکنش.
       */
      for (const ids of chunksOf(invoiceIds))
        await tx.saleInvoice.updateMany({
          where: { id: { in: ids } },
          data: { consolidationId: consolidation.id }
        })

      // مهر نهایی روی کسر انبار — دقیقاً روی حرکات همین فاکتورها.
      // ⚠️ tx پاس داده می‌شود (قاعده‌ی ۶ README).
      const finalized = await inventoryService.finalizePendingForInvoices(consolidation.id, invoiceIds, tx)
      await tx.consolidation.update({ where: { id: consolidation.id }, data: { movementCount: finalized } })

      await audit(tx, {
        action: AuditAction.CONSOLIDATE,
        entity: 'Consolidation',
        entityId: consolidation.id,
        userId: range.userId ?? null,
        after: JSON.stringify({
          ...snap,
          dayJalali,
          invoiceCount: invoiceIds.length,
          finalizedMovements: finalized
        }),
        note: dayJalali ? `تجمیع و انتقال روز ${dayJalali}` : 'تجمیع و انتقال بازه‌ای'
      })

      return {
        consolidation,
        finalizedMovements: finalized,
        invoiceCount: invoiceIds.length,
        dayJalali,
        summary: {
          ...emptyConsolidationRetrySummary(),
          ...snap,
          rows: undefined,
          groups: undefined
        }
      }
    }, TX_OPTIONS)
  },

  /**
   * ==================== تجمیع با تأخیر: وضعیت روزهای یک بازه ====================
   * اگر شیفت آخر یادش برود تجمیع بزند، روزهای بعد باید بشود همان روز را تجمیع
   * کرد. این متد برای هر روز بازه می‌گوید:
   *   • چند فاکتور دارد و چند تای آن هنوز تجمیع نشده است،
   *   • چند حرکت انبار موقت (PENDING) دارد و با تجمیع، چه تعدادی قطعی می‌شود،
   *   • قبلاً تجمیع شده یا نه (DONE / PENDING / PARTIAL / EMPTY).
   *
   * روزی که DONE است دیگر دوباره کسر نمی‌شود: هم فاکتورهایش consolidationId
   * دارند و هم حرکاتش FINAL شده‌اند.
   * ==========================================================================
   */
  async days(range: { fromJalali?: string; toJalali?: string }): Promise<ConsolidationDaysResult> {
    // ممیزی A104-01 — خالی ⇒ امروز (۴-۲۳)، نامعتبر ⇒ خطای فارسی (نه «Invalid Jalaali year» یا سال بعد بی‌صدا)
    const today = jalaliToday()
    const fromJalali = consolidationDayOf(range?.fromJalali, 'از تاریخ', today)
    const r = resolveRange({ fromJalali, toJalali: consolidationDayOf(range?.toJalali, 'تا تاریخ', fromJalali) })
    const dayList = jalaliDaysBetween(r.fromJalali, r.toJalali)
    if (!dayList.length) throw new BusinessError('بازه‌ی تاریخ معتبر نیست؛ «از تاریخ» باید قبل از «تا تاریخ» باشد.')

    const invoices = await prisma.saleInvoice.findMany({
      // نشست ۶۵ (S65-2) — سند تعویضِ باطل در جمع روزهای تجمیع نیست
      where: { issuedAt: { gte: r.from, lte: r.to }, voidedAt: null },
      select: {
        id: true,
        issuedAtJalali: true,
        issuedAt: true,
        goodsTotal: true,
        grandTotal: true,
        paidTotal: true,
        consolidationId: true,
        shiftId: true
      }
    })
    const consolidations = await prisma.consolidation.findMany({
      where: {
        OR: [
          { dayJalali: { in: dayList } },
          { fromDate: { gte: r.from, lte: r.to } }
        ]
      },
      select: { id: true, dayJalali: true, fromDate: true, finalizedAt: true }
    })

    const byDay = new Map<string, ConsolidationDay>()
    for (const day of dayList) {
      byDay.set(day, {
        dayJalali: day,
        state: ConsolidationDayState.EMPTY,
        stateLabel: CONSOLIDATION_DAY_LABELS.EMPTY,
        invoiceCount: 0,
        pendingInvoiceCount: 0,
        pendingMovements: 0,
        goodsTotal: 0,
        grandTotal: 0,
        receivedTotal: 0,
        pendingQty: 0,
        consolidationIds: [],
        finalizedAtJalali: null,
        /** بخش ۳ — ساعت قطعی‌شدن تجمیع همان روز (HH:MM) */
        finalizedAtTime: null,
        shiftCount: 0
      })
    }

    const shiftsByDay = new Map<string, Set<number>>()
    const pendingIdsByDay = new Map<string, number[]>()

    for (const inv of invoices) {
      const day = inv.issuedAtJalali || toJalaliDate(inv.issuedAt)
      const d = byDay.get(day)
      if (!d) continue
      d.invoiceCount++
      // نشست ۱۸۱: `+=` روی number و bigint استثنا می‌دهد.
      d.goodsTotal += toNumberRial(inv.goodsTotal)
      d.grandTotal += toNumberRial(inv.grandTotal)
      d.receivedTotal += toNumberRial(inv.paidTotal)
      if (inv.consolidationId == null) {
        d.pendingInvoiceCount++
        const list = pendingIdsByDay.get(day) ?? []
        list.push(inv.id)
        pendingIdsByDay.set(day, list)
      } else if (!d.consolidationIds.includes(inv.consolidationId)) {
        d.consolidationIds.push(inv.consolidationId)
      }
      if (inv.shiftId) {
        const set = shiftsByDay.get(day) ?? new Set<number>()
        set.add(inv.shiftId)
        shiftsByDay.set(day, set)
      }
    }

    for (const c of consolidations) {
      const day = c.dayJalali || toJalaliDate(c.fromDate)
      const d = byDay.get(day)
      if (!d) continue
      if (!d.consolidationIds.includes(c.id)) d.consolidationIds.push(c.id)
      if (c.finalizedAt) {
        d.finalizedAtJalali = toJalaliDate(c.finalizedAt)
        // بخش ۳: ساعت هم کنار تاریخ می‌آید
        d.finalizedAtTime = toClock(c.finalizedAt, false)
      }
    }

    for (const [day, ids] of pendingIdsByDay) {
      const d = byDay.get(day)
      if (!d) continue
      const p = await inventoryService.pendingSummaryForInvoices(ids)
      d.pendingMovements = p.movements
      d.pendingQty = p.qty
    }

    for (const d of byDay.values()) {
      d.shiftCount = shiftsByDay.get(d.dayJalali)?.size ?? 0
      if (!d.invoiceCount) d.state = ConsolidationDayState.EMPTY
      else if (!d.pendingInvoiceCount) d.state = ConsolidationDayState.DONE
      else if (d.consolidationIds.length) d.state = ConsolidationDayState.PARTIAL
      else d.state = ConsolidationDayState.PENDING
      d.stateLabel = CONSOLIDATION_DAY_LABELS[d.state] ?? d.state
    }

    const days = [...byDay.values()]
    const pendingDays = days.filter((d) => d.pendingInvoiceCount > 0).map((d) => d.dayJalali)
    return {
      days,
      pendingDays,
      totals: {
        days: days.length,
        pending: pendingDays.length,
        done: days.filter((d) => d.state === ConsolidationDayState.DONE).length,
        grandTotal: days.reduce((s, d) => s + d.grandTotal, 0),
        pendingQty: days.reduce((s, d) => s + d.pendingQty, 0)
      }
    }
  },

  /**
   * تجمیع چند روز عقب‌افتاده، هر روز به‌صورت یک رکورد جدا.
   * روزهایی که فاکتور تجمیع‌نشده ندارند بی‌صدا رد می‌شوند (و در خروجی گزارش
   * می‌شوند)، پس زدن دوباره‌ی این دکمه هیچ‌وقت موجودی را دوبار کم نمی‌کند.
   */
  async finalizeDays(input: { days: string[]; userId?: number | null }) {
    const days = [...new Set((input.days ?? []).filter(Boolean))].sort()
    if (!days.length) throw new BusinessError('هیچ روزی برای تجمیع انتخاب نشده است.')

    const done: {
      dayJalali: string
      consolidationId: number
      invoiceCount: number
      finalizedMovements: number
      grandTotal: number
    }[] = []
    const skipped: string[] = []

    for (const day of days) {
      try {
        const res = await this.finalize({ fromJalali: day, toJalali: day, dayJalali: day, userId: input.userId ?? null })
        done.push({
          dayJalali: day,
          consolidationId: res.consolidation.id,
          invoiceCount: res.invoiceCount,
          finalizedMovements: res.finalizedMovements,
          grandTotal: res.summary.grandTotal
        })
      } catch (e: any) {
        // «فروش تجمیع‌نشده‌ای نیست» یک خطا نیست؛ یعنی این روز از قبل بسته است.
        skipped.push(day)
        console.warn('[consolidation] skipped day', day, e?.message ?? e)
      }
    }

    return {
      done,
      skipped,
      invoiceCount: done.reduce((s, d) => s + d.invoiceCount, 0),
      finalizedMovements: done.reduce((s, d) => s + d.finalizedMovements, 0),
      grandTotal: done.reduce((s, d) => s + d.grandTotal, 0)
    }
  },

  /** سابقه‌ی تجمیع‌های ثبت‌شده. */
  async list(range: { fromJalali?: string; toJalali?: string; take?: number; skip?: number } = {}) {
    // ممیزی A114-01 — '' ⇒ امروز (نه jalaliStartOfDay('') و فهرست خالی بی‌صدا)، نامعتبر ⇒ خطای فارسی
    range = {
      ...range,
      fromJalali: reportDayInput(range?.fromJalali, 'از تاریخ', 'سابقه‌ی تجمیع'),
      toJalali: reportDayInput(range?.toJalali, 'تا تاریخ', 'سابقه‌ی تجمیع')
    }
    const r = resolveRange(range)
    const where = { OR: [{ dayJalali: { gte: r.fromJalali, lte: r.toJalali } }, { fromDate: { gte: r.from, lte: r.to } }] }
    const page = historyPage(range.take, range.skip, await prisma.consolidation.count({ where }))
    const rows = await prisma.consolidation.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take
    })
    return attachHistoryPage(rows.map((c) => ({
      id: c.id,
      dayJalali: c.dayJalali || toJalaliDate(c.fromDate),
      fromJalali: toJalaliDate(c.fromDate),
      toJalali: toJalaliDate(c.toDate),
      invoiceCount: c.invoiceCount,
      movementCount: c.movementCount,
      goodsTotal: c.goodsTotal,
      grandTotal: c.grandTotal,
      receivedTotal: c.receivedTotal,
      discountTotal: c.discountTotal,
      taxTotal: c.taxTotal,
      serviceTotal: c.serviceTotal,
      deliveryTotal: c.deliveryTotal,
      finalizedAtJalali: c.finalizedAt ? toJalaliDate(c.finalizedAt) : null,
      /** بخش ۳ — ساعت قطعی‌شدن تجمیع (HH:MM)، از همان `finalizedAt`. */
      finalizedAtTime: c.finalizedAt ? toClock(c.finalizedAt, false) : null
    })), page, 'رکورد تجمیع')
  }
}
