import { createHash } from 'node:crypto'
import { prisma } from '../db/client'
import { createCardTransferRequest } from './CardTransferService'
import { inventoryService } from './InventoryService'
import { audit, auditOrThrow } from './AuditService'
import { shiftService } from './ShiftService'
import { custodyService } from './CustodyService'
import { generateReturnCode, normalizeReturnCode, returnCodeExpiry, DAY_MS } from './ReturnCodeService'
import { shapeSaleRow, sumTotals, groupByDayShift, paymentLabels, returnedTotalOf } from './reportShape'
import { buildStatements, cashMovementTotals } from './accountingReport'
import { recordCashMovement } from './CashMovementService'
import {
  assertManagerPassword,
  assertPanelPassword,
  assertPanelPasswordStrict,
  verifyManagerCorrectionApproval
} from './AuthService'
import { wholesaleDiscountCeilingFor } from '@shared/priceAdjust'
import { PANEL_KEYS } from '@shared/panels'
import { periodLockService } from './PeriodLockService'
import { settingsService } from './SettingsService'
import { findCustomerByPhone, normalizePhone } from './PartyService'
import { secondaryStockService } from './SecondaryStockService'
import { stockAllocationService } from './StockAllocationService'
import {
  normalizePlan,
  planHasNegative,
  storeLinesOf,
  warehouseEntriesOf,
  /** جلسه ۵۰ · مرحله ۱-ب — ردیابی برداشت انبار مرکزی در سند تعویض */
  buildCentralWithdrawNote,
  centralWithdrawGroups,
  centralWithdrawSentence,
  centralWithdrawShortLine,
  centralWithdrawTotal
} from '@shared/stockSource'
import {
  issueStoreCredit,
  readCreditSettings,
  redeemStoreCredit,
  nonCashMethodId,
  shapeStoreCredit,
  storeCreditService,
  guardCreditCode,
  reverseInvoiceRedemptions
} from './StoreCreditService'
import {
  exchangeCreditDays,
  CreditSource,
  CreditStatus,
  creditIssueReasonOf,
  CREDIT_ISSUE_REASON_LABELS,
  effectiveStatus,
  CREDIT_STATUS_LABELS,
  remainingOf as creditRemainingOf
} from '@shared/credit'
/** نشست ۶۱ — تشخیص «پول واقعی» برای پشتوانه‌ی اعتبار اضافه‌دریافت (همان نگاشت پل تطبیق) */
import { receiptBucketOf } from '@shared/accounting'
import { allocateLineNet, returnValueOf, returnListPriceOf, mergeReturnTargets, isReturnableStatus } from '@shared/returnValue'
import { remainingOf, exchangeRefundPartOf, refundFromReceivedOf } from '@shared/settlement'
import { nextReceiptNo } from './receiptNo'
import { saleLineTitle, saleLineCode, reportLineTitle } from '@shared/saleItemSnapshot'
import { debtAdjustmentsByInvoice, adjustmentsOrEmpty, invoiceRemaining, recalcPaymentOverpay } from './invoiceDebt'
import { pendingStockNote, pendingQtyOfItems } from '@shared/pendingRestock'
import { pendingRestockService } from './PendingRestockService'
import { BusinessError } from '../errors'
import { reportDayInput } from './reportDate'
import { TX_OPTIONS } from '../db/tx'
import {
  SaleStatus,
  StockState,
  OrderType,
  AuditAction,
  saleStatusLabel,
  ORDER_TYPE_LABELS,
  PaymentEntryKind,
  ChequeStatus,
  CHEQUE_STATUS_LABELS,
  CHEQUE_METHOD_KEY,
  settlementStateOf,
  SETTLEMENT_STATE_LABELS,
  ReturnKind,
  RefundMethod,
  refundMethodLabel,
  /** جلسه ۴۰ · کار ب — لغو درخواست کارت‌به‌کارت وقتی سند برگشت مرجع حذف می‌شود */
  CardTransferKind,
  CardTransferStatus,
  CashMovementType,
  ExchangeSettlement,
  EXCHANGE_SETTLEMENT_LABELS,
  RETURN_KIND_LABELS,
  StoreCreditStatus,
  EXCHANGE_CREDIT_METHOD_KEY,
  PaymentKind,
  NON_CASH_PAYMENT_KINDS,
  PaymentDestination,
  PAYMENT_DESTINATION_LABELS,
  allowedDestinationsFor,
  allowedChequeDestinations,
  /** کار الف — مشتق کردن مقصد از `kind` روش پرداخت (پرداختی لحظه‌ی فروش) */
  destinationFromMethodKind,
  destinationReachedStore,
  normalizePaymentDestination,
  paymentDestinationLabel,
  orderTypesForChannels
} from '@shared/enums'
import {
  toJalaliDate,
  jalaliToDateTime,
  isValidJalaliDate,
  faDigits,
  toClock,
  toLatinDigits,
  jalaliStartOfDay,
  jalaliEndOfDay,
  jalaliToday,
  jalaliAtClock,
  money
} from '@shared/jalali'
import { SETTING_KEYS, parseSaleDefaults } from '@shared/receipt'
import { discountCeilingFor, fixedDiscountFor } from '@shared/priceAdjust'
import { computeCharges, type ChargeBreakdown } from '@shared/charges'
import { toNumberRial, toRial } from '@shared/money'
import type {
  CreateSaleInput,
  ReturnSaleInput,
  UpdateSaleInput,
  UpdateReturnInput,
  ReturnEditView,
  ReturnEditItem,
  SalesPurgePreview,
  SalesPurgeLine,
  CartLine,
  SaleReportFilter,
  SaleReportResult,
  SaleItemReportRow,
  ReturnLookup,
  ReturnLookupItem,
  ReturnItemStock,
  InvoiceSettlementProfile,
  InvoicePaymentRow,
  InvoicePaymentsView,
  CreditSettlementLineageView,
  AddInvoicePaymentInput,
  UpdateInvoicePaymentInput,
  ChequeListRow,
  ExchangeSaleInput,
  ExchangeSaleResult,
  ExchangeReportRow,
  ExchangeReportResult,
  CreditInvoiceRow,
  CreditSettlementRow,
  CreditReportResult,
  ReturnListRow,
  StoreCreditSafeRow,
  SaleAccountingStatements,
  PagedRows,
  SaleReportPage
} from '@shared/types'
import type { Prisma } from '@prisma/client'

/** هر `IN` گزارش حداکثر ۵۰۰ شناسه داشته باشد؛ سقف امن برای SQLite و Prisma. */
const REPORT_IN_CHUNK = 500

/** مرز خروجیِ جریان فروش: credential فقط در main می‌ماند، نه پاسخ IPC/POS. */
function shapeStoreCreditSafe(row: any): StoreCreditSafeRow {
  const shaped = shapeStoreCredit(row)
  const { code: _redeemableCode, legacyCode: _legacyCode, ...safe } = shaped
  return { ...safe, publicReference: `اعتبار #${safe.id}` }
}

/** نتیجهٔ صدور از اضافه‌دریافت هم credential ندارد؛ مدل DB همچنان کامل است. */
function shapeOverpayCreditSafe(row: OverpayCreditResult | null): OverpayCreditSafeResult | null {
  if (!row) return null
  const { code: _redeemableCode, ...safe } = row
  return { ...safe, publicReference: `اعتبار #${safe.id}` }
}

/**
 * جزئیات فاکتور (`sale:get`) برای فرم ویرایش لازم است، اما Payment مصرفِ اعتبار
 * همواره reference/note را با بارکدِ قابل‌مصرف ذخیره می‌کند. همان بارکد نباید
 * از یک خوانش عمومی فاکتور به renderer برسد.
 */
function shapeSaleGetPaymentSafe(payment: any): any {
  const isStoreCredit = payment?.storeCreditId != null || payment?.method?.kind === PaymentKind.STORE_CREDIT
  if (!isStoreCredit) return payment
  const { storeCreditId: _creditId, reference: _creditCode, note: _creditNote, ...safe } = payment
  return { ...safe, storeCreditApplied: true }
}

/** کدِ اعتبار صادرشده در برگشت هم credential است، نه جزئیات استاندارد فاکتور. */
function shapeSaleGetReturnSafe(ret: any): any {
  const issuedStoreCredit = ret?.storeCreditId != null || !!ret?.storeCreditCode
  const { storeCreditId: _creditId, storeCreditCode: _creditCode, ...safe } = ret
  return issuedStoreCredit ? { ...safe, storeCreditIssued: true } : safe
}

function reportIdChunks(ids: Iterable<number>): number[][] {
  const unique = [...new Set([...ids].map(Number).filter((id) => Number.isFinite(id)))]
  const chunks: number[][] = []
  for (let i = 0; i < unique.length; i += REPORT_IN_CHUNK) chunks.push(unique.slice(i, i + REPORT_IN_CHUNK))
  return chunks
}

/** گزارش فروش فقط سندهای واقعی را می‌بیند؛ پیش‌نویس و لغوشده مدرک فروش نیستند. */
export const REPORT_EXCLUDED_SALE_STATUSES = [SaleStatus.DRAFT, SaleStatus.CANCELED]

function reportPage(rawTake: unknown, rawSkip: unknown, defaultTake: number, totalCount: number): SaleReportPage {
  const parsedTake = Math.round(Number(rawTake ?? defaultTake))
  const parsedSkip = Math.round(Number(rawSkip ?? 0))
  const take = Math.min(Math.max(Number.isFinite(parsedTake) ? parsedTake : defaultTake, 1), 20_000)
  const skip = Math.max(Number.isFinite(parsedSkip) ? parsedSkip : 0, 0)
  return { skip, take, totalCount, truncated: totalCount > skip + 0 }
}

/**
 * ممیزی A99-02 — `shownUnits` واحدِ همان `totalCount` است. در «جزئیات فروش» صفحه بر حسب
 * *فاکتور* بریده می‌شود ولی ردیف‌ها *قلم*اند؛ قبلاً truncated با شمار قلم حساب می‌شد ⇒
 * ۳ فاکتور × ۲ قلم با take=۲ ⇒ «۴ ≥ ۳» ⇒ truncated=false و برش بی‌صدا.
 */
function attachReportPage<T>(rows: T[], page: SaleReportPage, shownUnits: number = rows.length, noun = 'ردیف'): PagedRows<T> {
  page.truncated = page.totalCount > page.skip + shownUnits
  const warnings = pageWarning(page, shownUnits, noun)
  return Object.assign(rows, { page, warnings }) as PagedRows<T>
}

/**
 * نشست ۱۱۷ (S117-2) — تب «نسیه»: سقف ردیف نمایشی هر صفحه (بند ۴-۴۶) و اندازه‌ی
 * دسته‌ی خواندن. جمع‌ها همیشه روی کل بازه‌اند؛ این دو عدد هیچ ردیفی را از جمع حذف نمی‌کنند.
 */
export const CREDIT_PAGE_MAX = 5000
/** نشست ۱۱۷ (S117-4) — سقف ردیف هر صفحه‌ی `list` (فهرست فاکتورها)؛ جمع‌ها روی کل بازه. */
export const SALE_LIST_PAGE_MAX = 5000
const CREDIT_READ_BATCH = 2000
/** ممیزی A99-01 — اندازه‌ی دسته‌ی خواندن برای جمع کل تب تعویض وقتی صفحه کل مجموعه نیست. */
const EXCHANGE_TOTALS_BATCH = 1000

function pageWarning(page: SaleReportPage, rowCount: number, noun = 'ردیف'): string[] {
  return page.truncated
    ? [`نمایش ${faDigits(rowCount)} از ${faDigits(page.totalCount)} ${noun}؛ برای دیدن همه‌ی ردیف‌ها صفحه‌ی بعد را بگیرید.`]
    : []
}

/** یک تغییر موجودی: مثبت = باید کم شود، منفی = باید برگردد. */
type Delta = { variantId: number; qty: number }

/**
 * فهرست شناسه‌ی فاکتورهای انتخاب‌شده (مورد ۱): فقط عددهای درست، بدون تکرار.
 * خروجی خالی یعنی «انتخابی وجود ندارد» و مسیر همان حذف بازه‌ای قبلی است.
 */
function normalizeInvoiceIds(ids?: number[] | null): number[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0))]
}

type Client = Prisma.TransactionClient | typeof prisma

/** A renderer payload can never create this token. IPC attaches it only after
 * verifying either the operator's own custody PIN or the bound manager session.
 * The financial custodian remains `CreateSaleInput.userId` / `shiftId`; this is
 * strictly separate operational evidence. */
export type VerifiedCustodySaleOperator = {
  custodyShiftId: number
  custodianUserId: number
  operatorKind: 'CUSTODIAN_SESSION' | 'OPERATOR_PIN' | 'MANAGER_SESSION'
  operatorUserId: number | null
  authMethod: 'CUSTODY_SESSION' | 'CUSTODY_PIN' | 'MANAGER_SESSION'
}
const VERIFIED_CUSTODY_SALE_OPERATOR = Symbol('verifiedCustodySaleOperator')

export function attachVerifiedCustodySaleOperator<T extends Record<string, any>>(
  input: T,
  operator: VerifiedCustodySaleOperator
): T {
  const enriched = { ...input }
  Object.defineProperty(enriched, VERIFIED_CUSTODY_SALE_OPERATOR, {
    value: Object.freeze({ ...operator }),
    enumerable: false,
    configurable: false,
    writable: false
  })
  return enriched
}

function verifiedCustodySaleOperatorOf(input: unknown): VerifiedCustodySaleOperator | null {
  const candidate = input && typeof input === 'object' ? (input as any)[VERIFIED_CUSTODY_SALE_OPERATOR] : null
  if (!candidate || typeof candidate !== 'object') return null
  const validId = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0
  const kinds = new Set(['CUSTODIAN_SESSION', 'OPERATOR_PIN', 'MANAGER_SESSION'])
  const methods = new Set(['CUSTODY_SESSION', 'CUSTODY_PIN', 'MANAGER_SESSION'])
  if (!validId(candidate.custodyShiftId) || !validId(candidate.custodianUserId) || !kinds.has(candidate.operatorKind) || !methods.has(candidate.authMethod))
    return null
  if (candidate.operatorKind === 'MANAGER_SESSION') {
    if (candidate.operatorUserId != null || candidate.authMethod !== 'MANAGER_SESSION') return null
  } else if (!validId(candidate.operatorUserId)) return null
  return {
    custodyShiftId: Number(candidate.custodyShiftId),
    custodianUserId: Number(candidate.custodianUserId),
    operatorKind: candidate.operatorKind,
    operatorUserId: candidate.operatorUserId == null ? null : Number(candidate.operatorUserId),
    authMethod: candidate.authMethod
  } as VerifiedCustodySaleOperator
}

/**
 * lookup واریانت‌های سندهای مالی را همیشه به دسته‌های کوچک تقسیم می‌کند.
 *
 * این helper عمداً کنار `reportIdChunks` است تا مسیرهای ثبت/برگشت/تعویض/
 * پاک‌سازی از سقف پارامتر SQLite مستقل نباشند. حذف بخشی از شناسه‌ها برای
 * گزارش مالی یا کنترل موجودی قابل قبول نیست؛ نتیجه‌ی همه‌ی chunkها جمع می‌شود.
 */
async function loadProductVariantsByIds(
  client: Client,
  ids: Iterable<number>,
  select: Record<string, unknown>
): Promise<any[]> {
  const rows: any[] = []
  for (const chunk of reportIdChunks(ids)) {
    rows.push(
      ...(await client.productVariant.findMany({
        where: { id: { in: chunk } },
        select
      } as any))
    )
  }
  return rows
}

/**
 * ===========================================================================
 * include استاندارد گزارش‌های فروش — **با فیلتر تاریخِ خودِ رویداد** (بند ۲-۱ و ۲-۲).
 *
 * ================== باگی که این تابع رفعش می‌کند ==================
 * تا جلسه ۱۳ این یک ثابت بود:
 *     payments: { include: { method: true } }        // بدون فیلتر paidAt
 *     returns:  { select: { id: true, total: true } } // بدون kind، بدون returnedAt
 * یعنی گزارش ماه اول، پرداختیِ دو ماه بعد و برگشتِ ماه بعد را هم به‌عنوان رویداد
 * «ماه اول» می‌شمرد — دقیقاً نقطه‌ی مقابل خواسته‌ی مالک. بدتر: چون `kind` در
 * `select` نبود، فیلتر `kind !== 'RETURN'` که در `reportShape` نوشته شده بود
 * روی داده‌ای اجرا می‌شد که آن فیلد را نداشت ⇒ **کد مرده**.
 *
 * ================== قاعده‌ی جدید: هر رویداد با تاریخ خودش ==================
 *   فروش/تخفیف/مالیات/سرویس/پیک ← `SaleInvoice.issuedAt`   (در `saleWhere`)
 *   پرداخت نسیه                 ← `Payment.paidAt`
 *   پاس‌شدن چک                   ← `Payment.clearedAt`
 *   برگشت و بازپرداختش          ← `SaleReturn.returnedAt`
 *
 * چکِ پاس‌شده با `OR` اضافه می‌شود چون `paidAt` آن روزِ گرفتن چک است و
 * `clearedAt` روزِ واقعیِ رسیدن پول؛ برای «وجه واقعی» دومی درست است.
 *
 * `null` = بدون بازه ⇒ مو‌به‌مو رفتار قدیمی (کل تاریخچه)، برای مسیرهایی مثل
 * `list()` که یک فاکتور مشخص را با همه‌ی پرداختی‌هایش می‌خواهند.
 * ===========================================================================
 */
type ReportPeriod = { from: Date | null; to: Date | null }

/** ستون‌هایی از `SaleReturn` که ردیف گزارش و تفکیک برگشت/تعویض لازم دارند. */
const RETURN_SELECT = {
  id: true,
  total: true,
  kind: true,
  returnedAt: true,
  returnedAtJalali: true,
  refundMethod: true,
  refundAmount: true,
  refundedAt: true,
  legacyAssumption: true,
  exchangeTotal: true,
  exchangeDiff: true,
  exchangeSettlement: true,
  /** نشست ۶۰ — کاهش بدهی فاکتور اصلی از مابه‌التفاوت منفی تعویض */
  debtReduction: true,
  storeCreditId: true
} as const

function reportInclude(period?: ReportPeriod | null) {
  const from = period?.from ?? null
  const to = period?.to ?? null
  const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : null
  return {
    customer: true,
    user: true,
    shift: true,
    payments: {
      include: { method: true },
      where: range
        ? { voidedAt: null, OR: [{ paidAt: range }, { kind: PaymentEntryKind.CHEQUE, clearedAt: range }] }
        : { voidedAt: null }
    },
    // نشست ۶۴ · بند ۴-۲۲ — برگشت باطل‌شده در هیچ گزارشی نیست
    returns: { select: RETURN_SELECT, where: range ? { returnedAt: range, voidedAt: null } : { voidedAt: null } }
  }
}

/** همان include، بدون هیچ فیلتر تاریخی (سازگاری کامل با مسیرهای قبلی). */
const REPORT_INCLUDE = reportInclude(null)

/** کارت‌به‌کارت لغوشده روی ردیف فاکتور دیگر «در انتظار» شمرده نشود. */
async function annotateRefundCanceled<T extends { returns?: any[] }>(invoices: T[]): Promise<T[]> {
  const ids: number[] = []
  for (const inv of invoices) {
    for (const r of inv.returns ?? []) if (r?.id != null) ids.push(Number(r.id))
  }
  if (!ids.length) return invoices
  const canceled = new Set<number>()
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await (prisma as any).cardTransferRequest.findMany({
      where: { returnId: { in: ids.slice(i, i + 500) }, status: 'CANCELED' },
      select: { returnId: true }
    })
    for (const q of rows) if (q.returnId != null) canceled.add(Number(q.returnId))
  }
  for (const inv of invoices) {
    for (const r of inv.returns ?? []) {
      if (r && canceled.has(Number(r.id))) r.refundCanceled = true
    }
  }
  return invoices
}

/** جمع تعداد هر واریانت در یک فاکتور (چند ردیف از یک کالا با هم جمع می‌شوند). */
function qtyByVariant(lines: { variantId: number; qty: number }[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const l of lines) m.set(l.variantId, (m.get(l.variantId) ?? 0) + Math.round(l.qty))
  return m
}

/**
 * اختلاف موجودی بین حالت قبل و بعد.
 * مثبت = این تعداد باید *بیشتر* از انبار کم شود · منفی = این تعداد باید برگردد.
 * اگر پرچم کسر موجودی خاموش باشد، آن سمت معادله صفر در نظر گرفته می‌شود، پس
 * روشن/خاموش کردنش در ویرایش هم درست و کامل جبران می‌گردد.
 */
function stockDeltas(
  before: { variantId: number; qty: number }[],
  beforeDeducts: boolean,
  after: { variantId: number; qty: number }[],
  afterDeducts: boolean
): { decrease: Delta[]; increase: Delta[] } {
  const old = beforeDeducts ? qtyByVariant(before) : new Map<number, number>()
  const next = afterDeducts ? qtyByVariant(after) : new Map<number, number>()
  const decrease: Delta[] = []
  const increase: Delta[] = []
  for (const variantId of new Set([...old.keys(), ...next.keys()])) {
    const delta = (next.get(variantId) ?? 0) - (old.get(variantId) ?? 0)
    if (delta > 0) decrease.push({ variantId, qty: delta })
    else if (delta < 0) increase.push({ variantId, qty: -delta })
  }
  return { decrease, increase }
}

/**
 * جمع‌های فاکتور فروش؛ یک منبع واحد برای create و update تا از هم واگرا نشوند.
 * مالیات و عوارض دو منبع دارد: مالیات ردیف‌ها + مالیات سطح فاکتور (پنل فروش
 * تکی درصد مالیات و حق سرویس را روی کل فاکتور می‌گیرد، مثل رسید فروشگاه).
 */
function saleTotals(input: CreateSaleInput) {
  const goodsTotal = input.lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
  const lineDiscounts = input.lines.reduce((s, l) => s + l.discount, 0)
  const taxTotal = input.lines.reduce((s, l) => s + l.tax, 0) + Math.round(input.invoiceTax ?? 0)
  const discountTotal = lineDiscounts + (input.invoiceDiscount ?? 0)
  const serviceCharge = input.serviceCharge ?? 0
  const deliveryFee = input.deliveryFee ?? 0
  const grandTotal = goodsTotal - discountTotal + taxTotal + serviceCharge + deliveryFee
  const paidTotal = (input.payments ?? []).reduce((s, p) => s + p.amount, 0)
  return { goodsTotal, taxTotal, discountTotal, serviceCharge, deliveryFee, grandTotal, paidTotal }
}

/** ردیف‌های آماده‌ی درج در SaleInvoiceItem. */

/**
 * نشست ۲۱۰ · بند ۴-۳۴ — snapshot نام/کد از دیتابیس همین تراکنش است، نه payload رندرر.
 * مقدار `l.name` / `l.code` نادیده گرفته می‌شود تا رسید و جستجو قابل جعل نباشد.
 */
async function saleItemRows(client: Client, lines: CartLine[]) {
  const variants = await loadProductVariantsByIds(
    client,
    lines.map((l) => l.variantId),
    { id: true, code: true, size: true, color: true, product: { select: { name: true } } }
  )
  const map = new Map(variants.map((v) => [Number(v.id), v]))
  return lines.map((l) => {
    const v = map.get(l.variantId)
    const title = v
      ? `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`.trim()
      : ''
    return {
      variantId: l.variantId,
      qty: Math.round(l.qty),
      unitPrice: Math.round(l.unitPrice),
      discount: Math.round(l.discount),
      tax: Math.round(l.tax),
      lineTotal: Math.round(l.unitPrice * l.qty - l.discount + l.tax),
      variantName: title || null,
      variantCode: String(v?.code ?? '').trim() || null
    }
  })
}

/**
 * ردیفِ فاکتور در ویرایش، عمداً با delete/create جایگزین می‌شود: شناسه‌ی قدیمی
 * ممکن است در دفترِ مبدأِ انبار یا سند برگشت سابقه داشته باشد و soft-delete کردنش
 * به همه‌ی خواندن‌های گزارش و آن ارجاع‌ها سرایت می‌کند. این snapshot کاملِ همان
 * ردیفِ حذف‌شونده است؛ مبلغ‌ها به رشته‌ی ده‌دهیِ lossless می‌روند تا BigInt واقعی
 * هرگز تاریخچه را گرد نکند یا باعث از دست‌رفتن آن نشود.
 */
function invoiceItemRevisionRows(items: any[]) {
  return items.map((i) => ({
    id: Number(i.id),
    invoiceId: Number(i.invoiceId),
    variantId: Number(i.variantId),
    variantName: i.variantName ?? null,
    variantCode: i.variantCode ?? null,
    qty: Number(i.qty),
    unitPrice: toRial(i.unitPrice).toString(),
    discount: toRial(i.discount).toString(),
    tax: toRial(i.tax).toString(),
    lineTotal: toRial(i.lineTotal).toString()
  }))
}

/** همان اصل برای ردیفِ برگشت: saleItemId و مقدارِ واقعیِ restock باید باقی بماند. */
function returnItemRevisionRows(items: any[]) {
  return items.map((i) => ({
    id: Number(i.id),
    returnId: Number(i.returnId),
    saleItemId: Number(i.saleItemId),
    variantId: Number(i.variantId),
    variantName: i.variantName ?? null,
    variantCode: i.variantCode ?? null,
    qty: Number(i.qty),
    unitPrice: toRial(i.unitPrice).toString(),
    lineTotal: toRial(i.lineTotal).toString(),
    removedFromStock: !!i.removedFromStock,
    restockedQty: Number(i.restockedQty)
  }))
}

function assertSafeInteger(value: unknown, label: string, min: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    throw new BusinessError(
      `${label} باید ${min > 0 ? 'عدد صحیح بزرگ‌تر از صفر' : 'عدد صحیح غیرمنفی'} باشد؛ ` +
        'اعشار، منفی، NaN، بی‌نهایت یا عدد خارج از سقف امن پذیرفته نیست.'
    )
  return value
}

/**
 * ورودی‌های برگشت و تعویض از پنجره‌ی renderer می‌آیند و نباید قبل از
 * اعتبارسنجی با Math.round/Number «اصلاح» شوند. گردکردن اینجا یک حفره‌ی
 * مالی است: qty=1.9 می‌توانست بی‌صدا به ۲ تبدیل شود و مبلغ/موجودی را عوض کند.
 */
function validateReturnLines(lines: unknown, label: string, allowZero = false): void {
  if (!Array.isArray(lines)) throw new BusinessError(`${label} معتبر نیست؛ فهرست اقلام را دوباره انتخاب کنید.`)
  for (const line of lines) {
    if (!line || typeof line !== 'object')
      throw new BusinessError(`${label} شامل یک ردیف نامعتبر است؛ آن ردیف را حذف و دوباره انتخاب کنید.`)
    const row = line as any
    assertSafeInteger(row.saleItemId, 'شناسه قلم فاکتور', 1)
    assertSafeInteger(row.qty, 'تعداد برگشتی', allowZero ? 0 : 1)
  }
}

function validateReturnMutation(input: ReturnSaleInput): void {
  assertSafeInteger(input?.invoiceId, 'شناسه فاکتور', 1)
  if (!input?.full) validateReturnLines(input?.lines, 'فهرست اقلام برگشتی')
  else if (input?.lines != null) validateReturnLines(input.lines, 'فهرست اقلام برگشتی')
  if (input?.refundAmount != null) assertSafeInteger(input.refundAmount, 'مبلغ بازپرداخت', 0)
  if (input?.creditDays != null) assertSafeInteger(input.creditDays, 'مهلت اعتبار خرید', 0)
}

function validateReturnUpdateMutation(input: UpdateReturnInput): void {
  assertSafeInteger(input?.id, 'شناسه برگشت', 1)
  validateReturnLines(input?.lines, 'فهرست اقلام برگشتی', true)
}

/**
 * نشست ۲۰۱ — تشخیص «اثر مالی» ویرایش برگشت (بازپرداخت انجام‌شده / اعتبار /
 * کاهش بدهی). یک‌بار بیرون از تراکنش برای سنجش رمز، یک‌بار داخل برای هم‌زمانی.
 */
function returnUpdateFinancialGate(
  ret: { refundAmount?: unknown; refundMethod?: string | null },
  /** فقط مرجع امن؛ کد قابل‌مصرف نباید حتی در پیام gate یا Audit راه پیدا کند. */
  settledCredit: { id: number } | null,
  relatedTransfer: { status: string } | null
) {
  const refundedAmount = toNumberRial(ret.refundAmount ?? 0)
  const transferPending = relatedTransfer?.status === CardTransferStatus.PENDING
  const moneyLeftTill = !transferPending && refundedAmount > 0
  const hasMoneyEffect = moneyLeftTill || !!settledCredit
  const debtOnly = !hasMoneyEffect && (ret.refundMethod == null || ret.refundMethod === RefundMethod.NONE)
  const what: string[] = []
  if (moneyLeftTill) what.push(`بازپرداخت ${money(refundedAmount)} ریال`)
  if (settledCredit) what.push(`اعتبار خرید #${settledCredit.id}`)
  if (debtOnly) what.push('کاهش بدهی فاکتور')
  return {
    refundedAmount,
    transferPending,
    moneyLeftTill,
    hasMoneyEffect,
    debtOnly,
    needsGate: hasMoneyEffect || debtOnly,
    what
  }
}

function validateExchangeMutation(input: ExchangeSaleInput): void {
  assertSafeInteger(input?.invoiceId, 'شناسه فاکتور اصلی', 1)
  validateReturnLines(input?.lines, 'فهرست اقلام برگشتی')
  if (!Array.isArray(input?.replacements))
    throw new BusinessError('فهرست اقلام جایگزین معتبر نیست؛ کالاها را دوباره انتخاب کنید.')
  for (const replacement of input.replacements) {
    if (!replacement || typeof replacement !== 'object')
      throw new BusinessError('فهرست اقلام جایگزین شامل یک ردیف نامعتبر است.')
    const row = replacement as any
    assertSafeInteger(row.variantId, 'شناسه کالای جایگزین', 1)
    assertSafeInteger(row.qty, 'تعداد کالای جایگزین', 1)
    if (row.unitPrice != null) assertSafeInteger(row.unitPrice, 'قیمت دستی کالای جایگزین', 0)
    if (row.discount != null) assertSafeInteger(row.discount, 'تخفیف کالای جایگزین', 0)
    if (row.tax != null) assertSafeInteger(row.tax, 'مالیات کالای جایگزین', 0)
  }
  for (const [field, label] of [
    ['methodId', 'شناسه روش پرداخت'],
    ['invoiceDiscount', 'تخفیف فاکتور تعویض'],
    ['invoiceTax', 'مالیات فاکتور تعویض'],
    ['serviceCharge', 'حق سرویس فاکتور تعویض'],
    ['creditDays', 'مهلت اعتبار خرید']
  ] as const) {
    const value = (input as any)[field]
    if (value != null) assertSafeInteger(value, label, field === 'methodId' ? 1 : 0)
  }
  if (input.payments != null) {
    if (!Array.isArray(input.payments)) throw new BusinessError('فهرست پرداخت ترکیبی تعویض معتبر نیست.')
    for (const payment of input.payments) {
      assertSafeInteger(payment?.methodId, 'شناسه روش پرداخت ترکیبی تعویض', 1)
      assertSafeInteger(payment?.amount, 'مبلغ سهم پرداخت ترکیبی تعویض', 1)
    }
  }
}

/** اعتبارسنجی مشترک ورودی ثبت و ویرایش (فقط پیام‌های فارسی). */
function validateSaleInput(input: CreateSaleInput): void {
  if (!Array.isArray(input?.lines) || !input.lines.length) throw new BusinessError('فاکتور بدون قلم قابل ثبت نیست')
  for (const line of input.lines) {
    if (!line || typeof line !== 'object')
      throw new BusinessError('یکی از ردیف‌ها کالای معتبری ندارد؛ آن ردیف را حذف و دوباره انتخاب کنید')
    assertSafeInteger(line.variantId, 'شناسه کالا', 1)
    assertSafeInteger(line.qty, 'تعداد هر قلم', 1)
    assertSafeInteger(line.unitPrice, 'قیمت واحد هر قلم', 0)
    assertSafeInteger(line.discount, 'تخفیف هر قلم', 0)
    assertSafeInteger(line.tax, 'مالیات هر قلم', 0)
    assertSafeInteger(line.unitPrice * line.qty - line.discount + line.tax, 'مبلغ نهایی هر قلم', 0)
  }
  for (const [field, label] of [
    ['invoiceDiscount', 'تخفیف کل فاکتور'],
    ['invoiceTax', 'مالیات کل فاکتور'],
    ['serviceCharge', 'حق سرویس'],
    ['deliveryFee', 'هزینه ارسال'],
    ['storeCreditAmount', 'مبلغ مصرف اعتبار']
  ] as const) {
    const value = (input as any)[field]
    if (value != null) assertSafeInteger(value, label, 0)
  }
  if (input.wholesaleDiscountPercent != null) {
    assertSafeInteger(input.wholesaleDiscountPercent, 'درصد تخفیف عمده', 0)
    if (input.wholesaleDiscountPercent > 100)
      throw new BusinessError('درصد تخفیف عمده باید بین صفر تا صد باشد؛ مقدار بالاتر از سقف مجاز رد شد.')
  }
  if (input.payments != null) {
    if (!Array.isArray(input.payments)) throw new BusinessError('فهرست پرداختی‌های فاکتور معتبر نیست.')
    for (const payment of input.payments) {
      assertSafeInteger(payment?.methodId, 'شناسه روش پرداخت', 1)
      assertSafeInteger(payment?.amount, 'مبلغ پرداختی', 1)
    }
  }
  if (input.issuedAtJalali && !isValidJalaliDate(input.issuedAtJalali))
    throw new BusinessError('تاریخ فاکتور معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
  /**
   * نشست ۲۱۳ · MED-2 — کانال فروش از مسیر ثبت/ویرایش فاکتور فقط همین چهارتاست.
   * EXCHANGE فقط از createExchange می‌آید تا snapshot کانال (۴-۲۱) جعل نشود.
   */
  if (input.orderType != null) {
    const allowed = [OrderType.INTERNAL, OrderType.DELIVERY, OrderType.PHONE, OrderType.WHOLESALE]
    if (!allowed.includes(input.orderType as (typeof allowed)[number]))
      throw new BusinessError(
        'نوع فروش نامعتبر است. فقط فروش داخلی، پیک، تلفنی یا عمده از این مسیر ثبت می‌شود؛ سند تعویض فقط از پنل تعویض ساخته می‌شود.'
      )
  }
  const totals = saleTotals(input)
  for (const [value, label] of [
    [totals.goodsTotal, 'جمع کالای فاکتور'],
    [totals.taxTotal, 'مالیات فاکتور'],
    [totals.discountTotal, 'تخفیف فاکتور'],
    [totals.serviceCharge, 'حق سرویس فاکتور'],
    [totals.deliveryFee, 'هزینه ارسال فاکتور'],
    [totals.paidTotal, 'جمع پرداختی فاکتور'],
    [totals.grandTotal, 'جمع کل فاکتور']
  ] as const)
    assertSafeInteger(value, label, 0)
}



/**
 * ---------------------------------------------------------------------------
 * «فیلد مشتری» پنل فروش (مورد ۶).
 *
 * شماره تلفن، شناسه‌ی واقعی مشتری در فروشگاه است:
 *   • اگر مشتری‌ای با همین شماره وجود داشته باشد، همان انتخاب می‌شود (و اگر
 *     اسمی وارد شده باشد و مشتری قبلاً بی‌نام ثبت شده بود، اسمش تکمیل می‌گردد).
 *   • اگر نبود، همان لحظه‌ی ثبت فاکتور ساخته می‌شود (کد = بزرگ‌ترین کد + ۱).
 *   • اگر شماره خالی باشد، هیچ چیزی ساخته نمی‌شود و فاکتور مثل قبل برای
 *     «مشتری عمومی» ثبت می‌شود — رفتار فعلی دست‌نخورده می‌ماند.
 *
 * همه‌جا با همان `tx` کار می‌کند تا داخل تراکنش ثبت فاکتور بن‌بست نسازد.
 * ---------------------------------------------------------------------------
 */
async function resolveCustomer(
  client: Client,
  input: { customerId?: number | null; customerPhone?: string | null; customerName?: string | null }
): Promise<number | null> {
  if (input.customerId) return input.customerId
  const phone = normalizePhone(input.customerPhone)
  const name = String(input.customerName ?? '').trim()
  if (!phone) return null

  /**
   * مورد ۳ — هیچ‌وقت رکورد مشتری تکراری ساخته نمی‌شود.
   * همان مشتری با همین شماره (حتی با قالب متفاوت: ۰۹۱۲…/۹۸۹۱۲…/۹۱۲…) پیدا و
   * فاکتور به *همان* رکورد وصل می‌شود؛ پس «تعداد فاکتور» او در پنل مشتریان
   * خودکار از ۱ به ۲ می‌رود، حتی اگر خرید بعدی ۱۲ ماه بعد باشد.
   */
  const existing = await findCustomerByPhone(client, phone)
  if (existing) {
    // اسم بهتر از «مشتری» بی‌نام: اگر کاربر این بار اسم داد، تکمیلش می‌کنیم
    if (name && name !== existing.name && (!existing.name || existing.name === phone))
      await client.customer.update({ where: { id: existing.id }, data: { name } })
    return existing.id
  }

  const rows = await client.customer.findMany({ select: { code: true } })
  const max = rows.reduce((m, r) => {
    const n = Number(r.code)
    return Number.isFinite(n) && n > m ? n : m
  }, 1000)
  const created = await client.customer.create({
    data: { code: String(max + 1), name: name || phone, phone }
  })
  await audit(client, {
    action: 'CUSTOMER_CREATE',
    entity: 'Customer',
    entityId: created.id,
    after: JSON.stringify({ code: created.code, name: created.name, phone }),
    note: 'مشتری جدید از فیلد شماره تلفن پنل فروش ساخته شد'
  })
  return created.id
}

/** پیش‌فرض‌های فروش (طول و اعتبار کد فاکتور) با همان کلاینت جاری. */
async function saleDefaultsWith(client: Client) {
  try {
    const row = await client.setting.findUnique({ where: { key: SETTING_KEYS.saleDefaults } })
    return parseSaleDefaults(row?.value)
  } catch {
    return parseSaleDefaults(null)
  }
}

/** ساخت where فیلترهای گزارش فروش از یک ورودی واحد. */
/**
 * ---------------------------------------------------------------------------
 * بند ۶ — شرط `orderType` با احتساب «کانال فروش» (تکی / عمده).
 *
 * سه حالت، و هر سه معنای متفاوتی دارند:
 *   • `channels` داده نشده (یا هر دو تیک خورده) ⇒ `null` از
 *     `orderTypesForChannels` ⇒ هیچ فیلتری اضافه نمی‌شود و رفتار مو‌به‌مو همان
 *     نسخه‌های قبل است.
 *   • فهرست خالی (کاربر هر دو تیک را برداشته) ⇒ `{ in: [] }` ⇒ گزارش عمداً
 *     خالی برمی‌گردد. اگر «همه» تفسیر می‌شد، گزارش دروغ می‌گفت.
 *   • یک کانال ⇒ همان نوع‌های سفارش.
 *
 * فیلتر «نوع سفارش» خودِ کاربر هم با این شرط **ضرب** می‌شود (AND): اگر کسی هم
 * «تلفنی» را انتخاب کرده باشد و هم فقط تیک «عمده» را، نتیجه درست خالی است.
 * ---------------------------------------------------------------------------
 */
function orderTypeWhere(f: SaleReportFilter): Prisma.SaleInvoiceWhereInput['orderType'] {
  const types = orderTypesForChannels(f.channels ?? null)
  const picked = f.orderType ?? null
  if (types == null) return picked ?? undefined
  if (!types.length) return { in: [] }
  if (picked) return types.includes(picked) ? picked : { in: [] }
  return { in: types }
}

/**
 * بند ۶ — همان شرط، برای کوئری‌هایی که *از سمت برگشت/تعویض/نسیه* به فاکتور نگاه
 * می‌کنند. `undefined` = بدون فیلتر (همان رفتار قبلی).
 */
/**
 * جلسه ۱۶ — `export` شد (یک خط از رفتارش عوض نشده) تا شمارنده‌ی بند ۵
 * (`reportLimits.ts`) *دقیقاً* همان فیلتر تکی/عمده‌ی جدول‌ها را بشمارد. اگر این
 * فیلتر دوباره جایی نوشته می‌شد، «تعداد کل» نوار قرمز با ردیف‌های جدول واگرا
 * می‌شد و هشدار، خودش دروغ می‌گفت.
 */
export function channelOrderTypeFilter(channels?: readonly string[] | null): { in: string[] } | undefined {
  const types = orderTypesForChannels(channels ?? null)
  return types == null ? undefined : { in: types }
}

/**
 * جلسه ۱۵ — `export` شد (رفتارش یک خط هم عوض نشده) تا «دفتر رویداد»
 * (`SalesLedger.ts`) دقیقاً همان `where` گزارش را مصرف کند. اگر فیلترها دوباره
 * جایی نوشته می‌شدند، تب جزئیات می‌توانست با تب سرجمع واگرا شود.
 */
export function saleWhere(f: SaleReportFilter): Prisma.SaleInvoiceWhereInput {
  const explicitFrom = f.from ? new Date(f.from) : f.fromJalali ? jalaliStartOfDay(f.fromJalali) : undefined
  const explicitTo = f.to ? new Date(f.to) : f.toJalali ? jalaliEndOfDay(f.toJalali) : undefined
  /**
   * 🔴 نشست ۱۸۶ · بند ۴-۲۳ — «امروز» فقط در متادیتا نبود، حالا در خودِ کوئری هم هست.
   *
   * در نشست ۱۸۴ `resolveReportPeriod` را درست کردم تا نبودِ تاریخ را «امروز»
   * بفهمد، ولی این تابع — که ردیف‌ها و `totalCount` را می‌سازد — هیچ قید
   * `issuedAt` نمی‌گذاشت. نتیجه‌ی عجیب: متای گزارش می‌گفت «امروز» ولی
   * ردیف‌ها و شمارنده **کل تاریخچه** بودند.
   *
   * بازبینی درست گفت که کاربر عادی نمی‌بیند (UI همیشه تاریخ صریح می‌فرستد)،
   * ولی دو چیز را خراب می‌کرد: هر صدازننده‌ی مستقیم IPC کل تاریخچه را
   * می‌گرفت، و عدد `totalCount` با بازه‌ی اعلام‌شده نمی‌خواند.
   *
   * ⚠️ `fullRange` و فیلتر شیفت عمداً استثنا هستند: اولی صراحتاً کل بازه را
   * می‌خواهد (خروجی اکسل، پل تطبیق) و دومی بازه‌اش را از خودِ شیفت می‌گیرد.
   */
  const wantsFullRange = (f as { fullRange?: boolean }).fullRange === true
  const scopedByShift = f.shiftId != null && String(f.shiftId) !== ''
  const noExplicitDate = !explicitFrom && !explicitTo
  const todayJalali = noExplicitDate && !wantsFullRange && !scopedByShift ? jalaliToday() : null
  const from = todayJalali ? jalaliStartOfDay(todayJalali) : explicitFrom
  const to = todayJalali ? jalaliEndOfDay(todayJalali) : explicitTo
  const ps = f.productSearch?.trim() || null
  return {
    /**
     * نشست ۶۵ · بند ۴-۲۲ (S65-2) — فاکتور باطل (فعلاً فقط سند تعویضِ ابطال‌شده با
     * کل گرافش) در هیچ گزارشی نیست؛ ردیف، اقلام و شماره فیشش برای سابقه می‌ماند.
     */
    voidedAt: null,
    issuedAt: from || to ? { gte: from, lte: to } : undefined,
    shiftId: f.shiftId ?? undefined,
    shift: reportShiftNumber(f) != null ? { number: reportShiftNumber(f)! } : undefined,
    userId: f.userId ?? undefined,
    customerId: f.customerId ?? undefined,
    id: f.invoiceIds?.length ? { in: f.invoiceIds } : undefined,
    /**
     * وضعیت صریح برای مسیرهای مدیریتی حفظ می‌شود؛ در گزارش عادی، سندی که
     * هنوز پیش‌نویس است یا لغو شده، نباید در جمع فروش/فهرست فاکتورها بنشیند.
     * `voidedAt: null` به‌تنهایی برای داده‌های قدیمی کافی نیست، چون ممکن است
     * وضعیت CANCELED ثبت شده باشد ولی مهر void آن مسیر قدیمی خالی مانده باشد.
     */
    status: f.status ?? { notIn: REPORT_EXCLUDED_SALE_STATUSES },
    orderType: orderTypeWhere(f),
    receiptNo: f.receiptNo ?? undefined,
    returnCode: f.returnCode ? normalizeReturnCode(f.returnCode) : undefined,
    consolidationId: f.onlyNotConsolidated ? null : undefined,
    customer: f.customerSearch ? { name: { contains: f.customerSearch } } : undefined,
    items: ps
      ? {
          some: {
            OR: [
              { variant: { barcode: { contains: ps } } },
              { variant: { code: { contains: ps } } },
              { variant: { product: { name: { contains: ps } } } },
              { variantName: { contains: ps } },
              { variantCode: { contains: ps } }
            ]
          }
        }
      : undefined
  }
}

/**
 * فیلترهایی که تب‌های برگشت/تعویض/نسیه از سمت سند وابسته به فاکتور اعمال می‌کنند.
 * این تابع عمداً همان جستجوی `saleWhere` را مصرف نمی‌کند، چون بازه‌ی زمانیِ این
 * تب‌ها تاریخ رویداد خودشان است، نه تاریخ صدور فاکتور.
 */
export function reportInvoiceRelationWhere(
  f: Pick<SaleReportFilter, 'receiptNo' | 'customerSearch' | 'productSearch' | 'userId' | 'shiftId'>
): Prisma.SaleInvoiceWhereInput {
  const ps = f.productSearch?.trim() || null
  return {
    /** همان دروازه‌ی گزارش برای برگشت/تعویض/چک/نسیه‌ی متصل به فاکتور. */
    voidedAt: null,
    status: { notIn: REPORT_EXCLUDED_SALE_STATUSES },
    receiptNo: f.receiptNo ?? undefined,
    userId: f.userId ?? undefined,
    shiftId: f.shiftId ?? undefined,
    customer: f.customerSearch ? { name: { contains: f.customerSearch } } : undefined,
    items: ps
      ? {
          some: {
            OR: [
              { variant: { barcode: { contains: ps } } },
              { variant: { code: { contains: ps } } },
              { variant: { product: { name: { contains: ps } } } },
              { variantName: { contains: ps } },
              { variantCode: { contains: ps } }
            ]
          }
        }
      : undefined
  }
}

/**
 * ممیزی A91-01 — فیلتر «هویتی» فاکتور مرجع برای تب‌های رویدادیِ برگشت/تعویض:
 * شماره فیش، مشتری، کالا و دروازه‌ی void/وضعیت روی فاکتور؛ ولی مالک (کارمند/شیفت)
 * روی خودِ سند برگشت (همان قاعده‌ی `returnEventOwnerWhere` دفتر رویداد). قبلاً هر دو
 * مالک با هم AND می‌شدند ⇒ برگشتی که در شیفت شب روی فاکتور شیفت صبح ثبت شد در
 * گزارش هیچ‌کدام از دو شیفت نمی‌آمد، در حالی که پولش از کشوی شیفت شب خارج شده بود.
 */
export function reportInvoiceIdentityWhere(
  f: Pick<SaleReportFilter, 'receiptNo' | 'customerSearch' | 'productSearch'>
): Prisma.SaleInvoiceWhereInput {
  const { userId: _u, shiftId: _s, ...rest } = reportInvoiceRelationWhere(f) as Record<string, unknown>
  return rest as Prisma.SaleInvoiceWhereInput
}

/**
 * فیلتر مشترک رویدادهای گزارش: تاریخ صدور فاکتور از آن حذف می‌شود تا هر
 * رویداد با timestamp خودش (paidAt/clearedAt/returnedAt) اسکوپ شود.
 */
export function eventSaleWhere(f: SaleReportFilter): Prisma.SaleInvoiceWhereInput {
  const where = saleWhere(f)
  const { issuedAt: _issuedAt, ...rest } = where as Record<string, unknown>
  return rest as Prisma.SaleInvoiceWhereInput
}

/**
 * مالکیت رویداد از مالکیت فاکتور جداست. برای پرداخت/برگشتِ یک فاکتور قدیمی،
 * `userId` و `shiftId` فاکتور نباید رویدادِ امروز را حذف کنند؛ این دو فیلتر
 * روی خودِ رکورد رویداد اعمال می‌شوند.
 */
export function eventInvoiceContextWhere(f: SaleReportFilter): Prisma.SaleInvoiceWhereInput {
  const where = eventSaleWhere(f)
  const { shiftId: _shiftId, shift: _shift, userId: _userId, ...rest } = where as Record<string, unknown>
  /** نشست ۱۷۱ · S171-D2 — فقط دفتر رویداد و صورت‌های مالی این تابع را مصرف می‌کنند */
  return financialStatementInvoiceWhere(rest as Prisma.SaleInvoiceWhereInput, f)
}

export type PaymentEventPhase = 'created' | 'cleared'

/**
 * شماره‌ی نشست در یک روز تکرارپذیر است و نباید مستقیماً روی Payment/SaleReturn
 * اعمال شود. این resolver شناسه‌های واقعی نشست‌های دارای آن شماره را پیدا می‌کند؛
 * بازه‌ی زمانی خود رویداد در کوئری جداگانه اعمال می‌شود و جلوی قاطی‌شدن نشست‌های
 * هم‌شماره‌ی روزهای دیگر را می‌گیرد.
 */
/**
 * ممیزی A72-01 — شماره‌ی نشست گزارش فقط یک عدد صحیح مثبت است. قبلاً `saleWhere`
 * با شرط truthy (صفر = بی‌فیلتر) و مالکِ رویداد با `!= null` (صفر = هیچ رویدادی)
 * می‌خواندش ⇒ فاکتورها بی‌فیلتر و پرداخت/برگشت خالی در یک گزارش. ورودی نامعتبر
 * رد می‌شود تا گزارش بی‌صدا گسترده یا تهی نشود.
 */
/**
 * نشست ۱۸۰ (S180-D10، گام ۰ خوشه M) — پارامتر `Pick<SaleReportFilter,
 * 'shiftNumber'>` بود (فقط `number | null`)، ولی بدنه‌اش عمداً `as unknown` و
 * `Number(raw)` می‌زند چون فیلترهای واقعیِ IPC رشته هم می‌فرستند و یکی از
 * صداکننده‌ها دقیقاً `string | number | null` می‌داد (TS2345). امضا با رفتار
 * واقعی هم‌تراز شد؛ منطق اعتبارسنجی و پیام خطای فارسی دست‌نخورده است.
 */
export function reportShiftNumber(f: { shiftNumber?: string | number | null }): number | null {
  const raw = f.shiftNumber as unknown
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('شماره‌ی نشست گزارش نامعتبر است؛ یک عدد صحیح مثبت وارد کنید.')
  return n
}

export async function resolveReportEventShiftIds(f: SaleReportFilter): Promise<number[] | null> {
  const number = reportShiftNumber(f)
  if (number == null) return null
  /**
   * ممیزی A72-01 — اگر `shiftId` و `shiftNumber` هر دو آمده باشند، فاکتورها با
   * AND هر دو فیلتر می‌شوند؛ رویدادها هم باید همان اشتراک را ببینند (قبلاً
   * shiftNumber نادیده گرفته می‌شد ⇒ فاکتور صفر ولی پرداخت/برگشت نشست دیده می‌شد).
   */
  const rows = await prisma.shift.findMany({
    where: { number, ...(f.shiftId != null ? { id: Number(f.shiftId) } : {}) },
    select: { id: true }
  })
  return rows.map((row) => row.id)
}

/** فیلتر مالک پرداخت: ثبت عادی از نشست/کاربر ثبت‌کننده، پاس‌چک از نشست/دفتر پاس. */
export function paymentEventOwnerWhere(
  f: SaleReportFilter,
  phase: PaymentEventPhase,
  resolvedShiftIds: readonly number[] | null = null
): Prisma.PaymentWhereInput {
  const out: Prisma.PaymentWhereInput = {}
  if (phase === 'created') {
    if (f.userId != null) out.createdByUserId = Number(f.userId)
    if (reportShiftNumber(f) != null) out.createdShiftId = { in: [...(resolvedShiftIds ?? [])] }
    else if (f.shiftId != null) out.createdShiftId = Number(f.shiftId)
  } else {
    if (reportShiftNumber(f) != null) out.clearedShiftId = { in: [...(resolvedShiftIds ?? [])] }
    else if (f.shiftId != null) out.clearedShiftId = Number(f.shiftId)
    if (f.userId != null) {
      /**
       * ممیزی A71-01 — قبلاً `history.some(CLEARED, userId)` بود: چکی که کارمند الف
       * پاس کرده، برگشت خورده و کارمند ب دوباره پاس کرده، در گزارش هر دو شمرده
       * می‌شد. مالک فقط «پاس فعلی» است (`clearedByUserId`). ردیف قدیمیِ بی‌ستون
       * (null) فقط از *آخرین* گذار دفتر قابل استنتاج است و migration آن را پر
       * کرده؛ fallback زیر فقط برای ردیفی است که هیچ‌وقت از setChequeStatus رد نشده.
       */
      const uid = Number(f.userId)
      out.AND = [
        {
          OR: [
            { clearedByUserId: uid },
            {
              clearedByUserId: null,
              chequeStatusHistory: { some: { status: ChequeStatus.CLEARED, userId: uid } },
              NOT: { chequeStatusHistory: { some: { status: ChequeStatus.CLEARED, userId: { not: uid } } } }
            }
          ]
        }
      ]
    }
  }
  return out
}

/** فیلتر مالک برگشت/تعویض، روی scalarهای خودِ SaleReturn اعمال می‌شود. */
export function returnEventOwnerWhere(
  f: SaleReportFilter,
  resolvedShiftIds: readonly number[] | null = null
): Prisma.SaleReturnWhereInput {
  const out: Prisma.SaleReturnWhereInput = {}
  if (f.userId != null) out.userId = Number(f.userId)
  if (reportShiftNumber(f) != null) out.shiftId = { in: [...(resolvedShiftIds ?? [])] }
  else if (f.shiftId != null) out.shiftId = Number(f.shiftId)
  return out
}

/**
 * ممیزی A99-03 (AUDIT-D28) — «وضعیت» نوار گزارش همیشه وضعیت *فاکتور مرجع* است (نه وضعیت سند
 * رویداد)؛ دروازه‌ی DRAFT/CANCELED در تب‌های رویدادی همیشه برقرار است: انتخاب «لغو شده» یا
 * «پیش‌نویس» یعنی هیچ رویداد گزارشی (همان قاعده‌ی creditReportScope در AUDIT-D27).
 */
export function reportEventInvoiceStatusWhere(status: unknown): Prisma.SaleInvoiceWhereInput['status'] {
  const s = String(status ?? '').trim()
  if (!s) return { notIn: REPORT_EXCLUDED_SALE_STATUSES }
  if ((REPORT_EXCLUDED_SALE_STATUSES as string[]).includes(s)) return { in: [] }
  return s
}

/**
 * نشست ۱۷۱ · مشاهده‌ی باز AUDIT-PROGRESS ردیف ۱۲۲ (P3) · S171-D2 — وضعیت صریح «لغو شده/پیش‌نویس».
 * فهرست فاکتورها (مسیر مدیریتی) این فاکتورها را نشان می‌دهد، ولی صورت‌های مالی (پل تطبیق، بلوک چک،
 * دفتر رویداد) آن‌ها را رویداد مالی نمی‌شمارند؛ هم‌معنای تب‌های نسیه/چک/برگشت (D28) و مسیر پیش‌فرض
 * (S122-1): «یک فیلتر، یک عدد». قبلاً پل با status=CANCELED وجه/نسیه/چک فاکتور لغوشده را می‌شمرد،
 * تب‌ها ۰ بودند و پل ۱٬۵۰۰٬۰۰۰ مانده‌ی بی‌توضیح داشت. مبلغ ثبت‌شده‌ی این فاکتورها پنهان نمی‌شود:
 * excludedStatusStatementWarning آن را در هشدار گزارش و دفتر می‌نویسد.
 */
export function isReportExcludedSaleStatus(status: unknown): boolean {
  const s = String(status ?? '').trim()
  return !!s && (REPORT_EXCLUDED_SALE_STATUSES as string[]).includes(s)
}

export function financialStatementInvoiceWhere(
  where: Prisma.SaleInvoiceWhereInput,
  f: Pick<SaleReportFilter, 'status'> | null | undefined
): Prisma.SaleInvoiceWhereInput {
  return isReportExcludedSaleStatus(f?.status) ? { ...where, status: { in: [] } } : where
}

export async function excludedStatusStatementWarning(
  where: Prisma.SaleInvoiceWhereInput,
  f: Pick<SaleReportFilter, 'status'> | null | undefined
): Promise<string | null> {
  if (!isReportExcludedSaleStatus(f?.status)) return null
  const [inv, pay] = await Promise.all([
    prisma.saleInvoice.aggregate({ where, _sum: { grandTotal: true }, _count: { _all: true } }),
    prisma.payment.aggregate({ where: { voidedAt: null, invoice: where }, _sum: { amount: true }, _count: { _all: true } })
  ])
  const count = Number(inv._count?._all ?? 0)
  if (count <= 0) return null
  const label = String(f?.status) === SaleStatus.CANCELED ? 'لغو شده' : 'پیش‌نویس'
  const grand = Number(inv._sum?.grandTotal ?? 0)
  const paid = Number(pay._sum?.amount ?? 0)
  return (
    `وضعیت «${label}» انتخاب شده: ${count} فاکتور لغوشده/پیش‌نویس به جمع ${grand} ریال` +
    (paid > 0 ? ` با ${paid} ریال پرداخت/چک ثبت‌شده (${Number(pay._count?._all ?? 0)} ردیف)` : '') +
    ' فقط در فهرست فاکتورها دیده می‌شود و در صورت‌های مالی (پل تطبیق، بلوک چک، دفتر رویداد، نقد مورد انتظار صندوق) ' +
    'حساب نمی‌شود، چون فاکتور لغوشده/پیش‌نویس رویداد مالی نیست (همان قاعده‌ی تب‌های نسیه/چک/برگشت). ' +
    (paid > 0 ? 'اگر این پول واقعاً دریافت شده، مدیر باید سند را بررسی و تعیین تکلیف کند.' : '')
  ).trim()
}

export interface ReturnReportScopeFilter {
  fromJalali?: string | null
  toJalali?: string | null
  channels?: string[] | null
  receiptNo?: number | null
  customerSearch?: string | null
  productSearch?: string | null
  orderType?: string | null
  status?: string | null
  userId?: number | null
  shiftId?: number | null
  shiftNumber?: number | string | null
}

/**
 * ممیزی A99-03 (AUDIT-D28) — دامنه‌ی مشترک تب برگشت، تب تعویض و شمارنده‌ی سقف؛ هم‌معنای پل تطبیق
 * (returnStatement): «یک فیلتر، یک عدد».
 *   • تاریخ صریح ⇒ returnedAtJalali در بازه، حتی با shiftId (پل هم هر دو قید را می‌زند؛ AUDIT-D22).
 *   • فقط shiftId بدون تاریخ ⇒ کل نشست (شیفت شب عبوری از نیمه‌شب یک ردیف است، بند ۴-۱۴).
 *   • هیچ‌کدام ⇒ فقط امروز (بند ۴-۲۳).
 *   • مالک (کارمند/شیفت/شماره‌ی نشست) روی خودِ سند برگشت (returnEventOwnerWhere، اشتراک shiftId∩shiftNumber).
 *   • هویت، نوع سفارش × کانال و «وضعیت» نوار روی فاکتور مرجع.
 * قبلاً با shiftId بازه‌ی صریح کنار گذاشته می‌شد، shiftNumber و وضعیت نوار اعمال نمی‌شد.
 */
export async function returnReportScopeWhere(filter: ReturnReportScopeFilter): Promise<Prisma.SaleReturnWhereInput> {
  const explicitFrom = filter.fromJalali || filter.toJalali || null
  const byShiftOnly = !explicitFrom && filter.shiftId != null
  const from = filter.fromJalali || filter.toJalali || jalaliToday()
  const to = filter.toJalali || filter.fromJalali || jalaliToday()
  const shiftIds = await resolveReportEventShiftIds(filter as SaleReportFilter)
  const channelFilter = channelOrderTypeFilter(filter.channels)
  const pickedOrderType = orderTypeWhere({ orderType: filter.orderType ?? null, channels: filter.channels ?? null } as SaleReportFilter)
  return {
    voidedAt: null,
    ...(byShiftOnly ? {} : { returnedAtJalali: { gte: from, lte: to } }),
    ...returnEventOwnerWhere(filter as SaleReportFilter, shiftIds),
    invoice: {
      ...reportInvoiceIdentityWhere(filter),
      status: reportEventInvoiceStatusWhere(filter.status),
      // ممیزی A91-03 — «نوع سفارش» نوار فیلتر هم، ضرب در کانال
      ...(pickedOrderType !== undefined ? { orderType: pickedOrderType } : channelFilter ? { orderType: channelFilter } : {})
    }
  }
}

const CHEQUE_STATUSES: readonly string[] = [ChequeStatus.PENDING, ChequeStatus.CLEARED, ChequeStatus.BOUNCED]

/**
 * ممیزی A99-04 (AUDIT-D29) — دامنه‌ی مشترک تب چک و شمارنده‌ی سقف چک. `status` اگر یکی از
 * وضعیت‌های چک باشد وضعیت چک است (مسیرهای قدیمی)؛ وگرنه «وضعیت» نوار = وضعیت فاکتور مادر.
 * قبلاً شمارنده مالک را روی فاکتور مادر و تاریخ را همیشه روی سررسید می‌زد (A96-01 فقط جدول را
 * اصلاح کرد) و تب چک وضعیت نوار را بی‌صدا نادیده می‌گرفت.
 */
export async function chequeReportWhere(filter: {
  status?: string | null
  fromJalali?: string | null
  toJalali?: string | null
  channels?: string[] | null
  shiftId?: number | null
  shiftNumber?: number | string | null
  userId?: number | null
  orderType?: string | null
  receiptNo?: number | null
  customerSearch?: string | null
  productSearch?: string | null
  dateMode?: 'due' | 'paid' | 'cleared' | null
}): Promise<Prisma.PaymentWhereInput> {
  const rawStatus = String(filter?.status ?? '').trim()
  const upper = rawStatus.toUpperCase()
  const chequeStatus = CHEQUE_STATUSES.includes(upper) ? upper : null
  const invoiceStatus = chequeStatus ? null : rawStatus || null
  const where: Prisma.PaymentWhereInput = { kind: PaymentEntryKind.CHEQUE, voidedAt: null }
  if (chequeStatus) where.chequeStatus = chequeStatus
  const mode = filter?.dateMode ?? 'due'
  const field = mode === 'paid' ? 'paidAt' : mode === 'cleared' ? 'clearedAt' : 'dueDate'
  if (filter?.fromJalali && isValidJalaliDate(filter.fromJalali))
    (where as any)[field] = { ...((where as any)[field] ?? {}), gte: jalaliStartOfDay(filter.fromJalali) }
  if (filter?.toJalali && isValidJalaliDate(filter.toJalali))
    (where as any)[field] = { ...((where as any)[field] ?? {}), lte: jalaliEndOfDay(filter.toJalali) }
  const chequeShiftIds = await resolveReportEventShiftIds(filter as SaleReportFilter)
  Object.assign(
    where,
    paymentEventOwnerWhere(filter as SaleReportFilter, mode === 'cleared' ? 'cleared' : 'created', chequeShiftIds)
  )
  const invoiceOrderType = orderTypeWhere(filter as SaleReportFilter)
  where.invoice = {
    ...reportInvoiceIdentityWhere(filter),
    status: reportEventInvoiceStatusWhere(invoiceStatus),
    ...(invoiceOrderType !== undefined ? { orderType: invoiceOrderType } : {})
  }
  return where
}

/**
 * ===========================================================================
 * بازه‌ی مؤثر گزارش — بند ۲-۴ سند مرجع.
 *
 * ================== باگی که این تابع رفعش می‌کند ==================
 * تا جلسه ۱۳ کل بلوک محاسبه‌ی `storeCreditIssuedTotal` / `exchangeDiffTotal` /
 * `priorSettlementTotal` داخل `if (from && to)` بود. وقتی گزارش با `shiftId`
 * گرفته می‌شد — **دقیقاً همان مسیری که «بستن صندوق» استفاده می‌کند** — این سه
 * عدد بی‌صدا صفر می‌ماندند. یعنی بستن صندوق هیچ‌وقت اعتبار صادرشده را نمی‌دید.
 *
 * ================== قاعده‌ی جدید: بازه همیشه resolve می‌شود ==================
 *   ۱) بازه‌ی صریح کاربر (ISO یا شمسی)            ⇒ source = 'explicit'
 *   ۲) `shiftId` ⇒ از `shift.openedAt` تا `shift.closedAt ?? now` ⇒ 'shift'
 *   ۳) هیچ‌کدام ⇒ از کمینه/بیشینه‌ی `issuedAt` خودِ ردیف‌های نتیجه ⇒ 'rows'
 *   ۴) نتیجه‌ی خالی ⇒ 'none' (و اعداد بازه‌ای درست و صفر می‌مانند)
 *
 * هیچ عددی دیگر به‌خاطر «نبودِ بازه‌ی صریح» صفر نمی‌شود.
 * ===========================================================================
 */
export async function resolveReportPeriod(
  filter: SaleReportFilter,
  where: Prisma.SaleInvoiceWhereInput
): Promise<{ from: Date | null; to: Date | null; source: 'explicit' | 'shift' | 'rows' | 'today' | 'none' }> {
  const from = filter.from ? new Date(filter.from) : filter.fromJalali ? jalaliStartOfDay(filter.fromJalali) : null
  const to = filter.to ? new Date(filter.to) : filter.toJalali ? jalaliEndOfDay(filter.toJalali) : null
  if (from || to) return { from, to, source: 'explicit' }

  if (filter.shiftId != null) {
    const shift = await prisma.shift.findUnique({
      where: { id: filter.shiftId },
      select: { openedAt: true, closedAt: true }
    })
    if (shift?.openedAt) return { from: shift.openedAt, to: shift.closedAt ?? new Date(), source: 'shift' }
  }

  // آخرین راه: بازه را از خودِ ردیف‌های نتیجه بساز (نه از «امروز»).
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۲۳ — نبودِ تاریخ یعنی «امروز»، نه «کل تاریخچه».
   *
   * قبلاً بازه از `min(issuedAt)` تا `max(issuedAt)` کل دیتابیس ساخته می‌شد.
   * یعنی باز کردن گزارش بدون فیلتر، همه‌ی فروش تاریخِ فروشگاه را می‌آورد:
   * کند، و بدتر از کند — عددهایی که مدیر آن‌ها را «امروز» می‌خواند.
   *
   * بعضی endpointها (`creditList`، `returnList`) از قبل درست «امروز» را
   * می‌گذاشتند، پس رفتار برنامه یکدست هم نبود.
   *
   * ⚠️ `fullRange` عمداً استثنا می‌ماند: گزارش‌هایی که صراحتاً کل بازه را
   * می‌خواهند (خروجی اکسل، پل تطبیق) همان رفتار قبلی را دارند.
   */
  if ((filter as { fullRange?: boolean }).fullRange === true) {
    const bounds = await prisma.saleInvoice.aggregate({ where, _min: { issuedAt: true }, _max: { issuedAt: true } })
    if (bounds._min.issuedAt && bounds._max.issuedAt)
      return { from: bounds._min.issuedAt, to: bounds._max.issuedAt, source: 'rows' }
    return { from: null, to: null, source: 'none' }
  }
  const today = jalaliToday()
  return { from: jalaliStartOfDay(today), to: jalaliEndOfDay(today), source: 'today' }
}

/**
 * وضعیت فاکتور را از روی *جمع همه‌ی برگشت‌های باقی‌مانده* بازمحاسبه می‌کند.
 * بعد از ویرایش یا حذف یک برگشت لازم است: اگر همه‌ی برگشت‌ها پاک شوند فاکتور
 * دوباره «تسویه شده» می‌شود، وگرنه «برگشت جزئی» یا «برگشت کامل».
 * وضعیت‌های دیگر (پیش‌نویس/لغو‌شده) دست‌نخورده می‌مانند.
 */
async function refreshInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: number): Promise<string | null> {
  const inv = await tx.saleInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      items: { select: { id: true, qty: true } },
      returns: {
        where: { voidedAt: null },
        select: {
          items: { select: { saleItemId: true, qty: true } },
          corrections: { where: { status: 'POSTED' }, select: { id: true } }
        }
      }
    }
  })
  if (!inv) return null
  if (inv.status !== SaleStatus.SETTLED && inv.status !== SaleStatus.RETURNED && inv.status !== SaleStatus.PARTIALLY_RETURNED)
    return inv.status

  const returnedByItem = new Map<number, number>()
  for (const r of inv.returns) {
    // ردیف جبرانی جدید، اثر کالای این برگشت را در شیفت اصلاح‌کننده معکوس کرده است.
    if (r.corrections.length) continue
    for (const it of r.items) returnedByItem.set(it.saleItemId, (returnedByItem.get(it.saleItemId) ?? 0) + it.qty)
  }

  const soldQty = inv.items.reduce((s, i) => s + i.qty, 0)
  const returnedQty = inv.items.reduce((s, i) => s + Math.min(i.qty, returnedByItem.get(i.id) ?? 0), 0)
  const status =
    returnedQty <= 0 ? SaleStatus.SETTLED : returnedQty >= soldQty ? SaleStatus.RETURNED : SaleStatus.PARTIALLY_RETURNED
  if (status !== inv.status) await tx.saleInvoice.update({ where: { id: inv.id }, data: { status } })
  return status
}

/**
 * ===========================================================================
 * فروش نسیه (اقساطی): پرداختی چندمرحله‌ای و چک.
 *
 * مدل داده عمداً همان جدول `Payment` است، نه یک جدول جدید: هر پرداختی یک ردیف
 * با تاریخ و ساعت خودش (`paidAt` / `paidAtJalali` / `paidAtTime`) و شماره‌ی
 * ترتیبی (`seq`). پس همه‌ی مسیرهای موجود — گزارش فروش، بستن صندوق، حذف
 * فاکتور، سبک‌سازی، ادغام بکاپ — بدون هیچ تغییری این پرداختی‌ها را می‌بینند.
 *
 * چک (`kind = CHEQUE`) تا وقتی «پاس» نشده باشد پول دریافت‌شده نیست:
 *   • در `SaleInvoice.paidTotal` شمرده نمی‌شود (پس باقی‌مانده کم نمی‌شود)،
 *   • و در دریافتی‌های گزارش فروش/صندوق هم شمرده نمی‌شود (reportShape).
 * لحظه‌ای که کاربر «پاس شد» را بزند، مبلغش مثل یک پرداخت نقدی اضافه می‌گردد و
 * اگر باقی‌مانده صفر شود، فاکتور خودکار «تسویه‌شده» علامت می‌خورد.
 * ===========================================================================
 */

/** آیا این ردیف پرداختی، پول *دریافت‌شده* است؟ (چکِ پاس‌نشده = نه) */
function isReceivedPayment(p: { kind?: string | null; chequeStatus?: string | null }): boolean {
  if ((p.kind ?? PaymentEntryKind.CASH) !== PaymentEntryKind.CHEQUE) return true
  return p.chequeStatus === ChequeStatus.CLEARED
}

/**
 * اثرانگشتِ immutable درخواست پرداخت. خودِ کلید در UI برای retry نگه داشته
 * می‌شود؛ این hash جلوی reuse تصادفی/مخرب همان کلید برای فاکتور یا مبلغ دیگر را
 * می‌گیرد، بدون آنکه رمز مدیر را در دیتابیس یا Audit ذخیره کند.
 */
function paymentAddFingerprint(input: AddInvoicePaymentInput, invoiceId: number, amount: number, isCheque: boolean): string {
  const stable = JSON.stringify([
    invoiceId,
    amount,
    isCheque ? PaymentEntryKind.CHEQUE : PaymentEntryKind.CASH,
    isCheque ? null : input.methodId ?? null,
    input.destination ?? null,
    input.reference ?? null,
    input.note ?? null,
    input.paidAtJalali ?? null,
    input.paidAtTime ?? null,
    isCheque ? input.chequeNo ?? null : null,
    isCheque ? input.bankName ?? null : null,
    isCheque ? input.dueDateJalali ?? null : null,
    input.confirmOverpay === true,
    input.overpayAsCredit === true,
    input.userId ?? null
  ])
  return createHash('sha256').update(stable).digest('hex')
}

/**
 * پاسخ retry برای پرداختی که پیش‌تر commit شده است. settlement با منبع حقیقت
 * فعلی بازسازی می‌شود (نه از payload retry) تا پاسخِ timeout هرگز ردیف مالی
 * دوم نسازد یا مبلغی را از ورودی تکراری باور نکند.
 */
async function replayPaymentAdd(idempotencyKey: string, fingerprint: string): Promise<any | null> {
  return prisma.$transaction(async (tx) => {
    const prior: any = await (tx.payment as any).findUnique({
      where: { idempotencyKey },
      include: { method: true }
    })
    if (!prior) return null
    if (prior.idempotencyFingerprint !== fingerprint)
      throw new BusinessError('این کلید ثبت پرداخت قبلاً برای درخواست متفاوت استفاده شده است؛ درخواست تازه را با کلید جدید ثبت کنید.')
    const settle = await recalcSettlement(tx, Number(prior.invoiceId))
    return {
      payment: shapePaymentRow(prior),
      ...settle,
      receiptNo: null,
      overpaid: settle.paidTotal > settle.grandTotal,
      overpayAmount: Math.max(0, toNumberRial(prior.overpayAmount ?? 0)),
      remainingBefore: null,
      destination: prior.destination ?? null,
      overpayCredit: null,
      replayed: true
    }
  }, TX_OPTIONS)
}

/** جمع پرداختی‌های دریافت‌شده از یک فهرست ردیف پرداختی. */
// نشست ۱۸۱: `amount` از دیتابیس BigInt می‌آید؛ جمع‌های داخل تابع از تبدیل عبور می‌کنند.
function receivedTotalOf(payments: { amount: number | bigint; kind?: string | null; chequeStatus?: string | null }[]): number {
  /**
   * نشست ۵۹ · خوشه B (DECISIONS S59-4) — `Payment` منفی (بازپرداخت تعویضِ داده‌ی
   * قدیمی) «دریافتی» نیست و در paidTotal نمی‌آید. بازپرداخت فقط از خودِ سند
   * تعویض (`SaleReturn.exchangeDiff/exchangeSettlement`) و `CashMovement` خوانده
   * می‌شود. قبلاً: سند تعویض ۲۰۰ با ارزش کالای ۲۰۰ و بازپرداخت نقدی ۴۰۰ ⇒
   * paidTotal = −۲۰۰ و «۴۰۰ نسیه‌ی وصول‌نشده»ی کاذب در گزارش و پل.
   */
  return payments.reduce(
    (sum, p) => sum + (isReceivedPayment(p) ? Math.max(0, toNumberRial(p.amount)) : 0),
    0
  )
}

/**
 * نشست ۱۸۸ · بازبینی ۱۸۶ مورد ۱ — پول *نقدشدنی* روی فاکتور.
 * `netReceived` مصرف اعتبار و ارزش کالای تعویض را هم «دریافت» می‌شمارد
 * (هر دو ردیف Payment با kind=CASH اند). برگشت ساده همین کسر را دارد؛
 * تعویض نداشت ⇒ فاکتورِ پرداخت‌شده با بارکد، با refundMode=CASH نقد می‌شد
 * (نقض ۴-۳۲ و ۴-۳۷ / S59-5).
 */
async function cashLikeReceivedOf(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  netReceived: number
): Promise<number> {
  const redeemed = await tx.storeCreditRedemption.aggregate({
    where: { invoiceId, reversedAt: null },
    _sum: { amount: true }
  })
  const exPays = await tx.payment.findMany({
    where: { invoiceId, voidedAt: null },
    select: { amount: true, storeCreditId: true, method: { select: { kind: true } } }
  })
  let exchangeCredit = 0
  let storeCreditPay = 0
  for (const p of exPays) {
    const k = String(p.method?.kind ?? '')
    const amt = toNumberRial(p.amount)
    if (k === PaymentKind.EXCHANGE_CREDIT) exchangeCredit += amt
    if (k === PaymentKind.STORE_CREDIT || p.storeCreditId != null) storeCreditPay += amt
  }
  const creditNonCash = Math.max(toNumberRial(redeemed._sum.amount ?? 0), storeCreditPay)
  return Math.max(0, netReceived - creditNonCash - exchangeCredit)
}

/**
 * نشست ۱۹۷ · باگ بحرانی ممیزی — سقف بازپرداخت نقدی/کارتی/اعتبارِ برگشت ساده.
 *
 * `paidTotal` سند تعویض با Paymentِ `EXCHANGE_CREDIT` پر می‌شود (ارزش کالای
 * برگشتی، نه پول). اگر سقف از `paidTotal` خوانده شود، برگشت کالای تعویضی روی
 * فاکتور نسیه نقد از کشو می‌دهد. سقف = پول واقعی همین فاکتور، به‌علاوه‌ی سهم
 * باقی‌مانده‌ی فاکتور اصلی در زنجیره‌ی `sourceInvoiceId` (نقد اصلی ⇒ خروج نقد
 * مجاز؛ نسیه ⇒ صفر).
 */
async function cashLikeRefundableOf(
  tx: Prisma.TransactionClient,
  invoice: { id: number; paidTotal: unknown; sourceInvoiceId?: number | null },
  previouslyRefunded: number
): Promise<number> {
  const paidNow = toNumberRial(invoice.paidTotal)
  const cashLike = await cashLikeReceivedOf(tx, invoice.id, paidNow)
  let cap = Math.max(0, cashLike - Math.max(0, Math.round(previouslyRefunded)))

  let parentId = invoice.sourceInvoiceId == null ? null : Number(invoice.sourceInvoiceId)
  const seen = new Set<number>([invoice.id])
  while (parentId != null && !seen.has(parentId) && seen.size < 50) {
    seen.add(parentId)
    const parent = await tx.saleInvoice.findUnique({
      where: { id: parentId },
      select: { id: true, paidTotal: true, sourceInvoiceId: true }
    })
    if (!parent) break
    const parentCash = await cashLikeReceivedOf(tx, parent.id, toNumberRial(parent.paidTotal))
    const parentAdj = adjustmentsOrEmpty(await debtAdjustmentsByInvoice(tx, [parent.id]), parent.id)
    const parentRefunded = Math.max(0, Math.round(parentAdj.refundFromReceived ?? 0))
    const parentEx = await exchangeRefundsAlreadyPaid(tx, parent.id, 0)
    cap += Math.max(0, parentCash - parentRefunded - parentEx)
    parentId = parent.sourceInvoiceId == null ? null : Number(parent.sourceInvoiceId)
  }
  return cap
}

async function exchangeRefundsAlreadyPaid(
  tx: Prisma.TransactionClient,
  sourceId: number,
  exceptId: number
): Promise<number> {
  const prevEx = await tx.saleReturn.findMany({
    where: { invoiceId: sourceId, kind: ReturnKind.EXCHANGE, id: { not: exceptId }, voidedAt: null },
    select: { id: true, exchangeDiff: true, debtReduction: true, refundMethod: true, exchangeSettlement: true }
  })
  if (!prevEx.length) return 0
  const canceled = new Set<number>()
  const reqs = await (tx as any).cardTransferRequest.findMany({
    where: { returnId: { in: prevEx.map((r) => r.id) }, status: 'CANCELED' },
    select: { returnId: true }
  })
  for (const q of reqs) if (q.returnId != null) canceled.add(Number(q.returnId))
  return prevEx.reduce((t, r) => {
    if (canceled.has(r.id)) {
      const m = String(r.refundMethod ?? r.exchangeSettlement ?? '')
      if (m.includes('CARD_TO_CARD')) return t
    }
    return t + exchangeRefundPartOf(r)
  }, 0)
}

async function assertExchangeCashLikeRefund(
  tx: Prisma.TransactionClient,
  input: { sourceId: number; netReceived: number; owed: number; backId: number }
): Promise<void> {
  const prevExRefunds = await exchangeRefundsAlreadyPaid(tx, input.sourceId, input.backId)
  const cashLike = await cashLikeReceivedOf(tx, input.sourceId, input.netReceived)
  const cashRefundable = Math.max(0, cashLike - prevExRefunds)
  if (input.owed > cashRefundable)
    throw new BusinessError(
      `بازپرداخت نقدی/کارتی ${money(input.owed)} ریال در این تعویض ممکن نیست: از پول واقعی این فاکتور فقط ` +
        `${money(cashRefundable)} ریال قابل پس‌دادن است (مصرف اعتبار خرید و ارزش کالای تعویض نقد نیستند و نقد نمی‌شوند).\\n` +
        'روش «بارکد اعتبار خرید بعدی» را انتخاب کنید.'
    )
}

/** جمع چک‌های در جریان (ثبت‌شده ولی پاس‌نشده). */
function pendingChequeTotalOf(
  payments: { amount: number | bigint; kind?: string | null; chequeStatus?: string | null }[]
): number {
  return payments.reduce(
    (sum, p) =>
      (p.kind ?? '') === PaymentEntryKind.CHEQUE && p.chequeStatus === ChequeStatus.PENDING
        ? sum + toNumberRial(p.amount)
        : sum,
    0
  )
}

/**
 * ===========================================================================
 * نشست ۱۶۴ · Y22 · بند ۴-۵۲ (S163-D3) — چک در جریان روی فاکتوری که برگشت خورده.
 *
 *   • برگشتی که بدهی فاکتور را **صفر** کند (remaining ≤ ۰ بعد از recalcSettlement، در حالی که
 *     قبل از همین برگشت > ۰ بود) ⇒ هر چک در جریانِ باطل‌نشده‌ی همان فاکتور خودکار void می‌شود:
 *     voidedAt، voidedByUserId = actor، voidReason با ارجاع به بند ۴-۵۲ و شماره‌ی سند برگشت،
 *     و یک ردیف Audit VOID روی Payment. بدون این، چک بعداً پاس می‌شد و کل مبلغش اضافه‌دریافت
 *     بی‌پشتوانه می‌ساخت (مشتری هم کالا را پس داده بود و هم پول چک را داده بود).
 *   • برگشت جزئی (بدهی هنوز باقی است) ⇒ چک دست‌نخورده + Audit با needsManagerReview=true.
 *     علامت «این چک نیاز به بازبینی دارد» در زمان خواندن از خودِ داده مشتق می‌شود (چک PENDING و
 *     باطل‌نشده + برگشت باطل‌نشده‌ی بعد از ثبت چک روی همان فاکتور) تا داده‌ی قدیمی هم علامت بگیرد.
 *   • ابطال همان برگشت (returnDelete) ⇒ چکی که به‌خاطر همان سند خودکار باطل شده بود، طبق ۴-۲۲
 *     خودکار برمی‌گردد (restoreChequesAfterReturnVoid).
 * ===========================================================================
 */
const chequeAutoVoidMarker = (returnId: number) => `(بند ۴-۵۲): برگشت سند ${faDigits(returnId)} `

async function chequePolicyAfterReturn(
  tx: Prisma.TransactionClient,
  ctx: { invoiceId: number; receiptNo: number; returnId: number; remainingBefore: number; remainingAfter: number; userId: number | null }
): Promise<{ voided: number[]; flagged: number[] }> {
  const cheques = await tx.payment.findMany({
    where: { invoiceId: ctx.invoiceId, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.PENDING },
    select: { id: true, amount: true, seq: true, chequeNo: true }
  })
  if (!cheques.length) return { voided: [], flagged: [] }
  const receipt = faDigits(ctx.receiptNo)
  if (ctx.remainingBefore > 0 && ctx.remainingAfter <= 0) {
    const voidedAt = new Date()
    const reason = `ابطال خودکار ${chequeAutoVoidMarker(ctx.returnId)}بدهی فاکتور ${receipt} را صفر کرد`
    for (const c of cheques) {
      await tx.payment.update({
        where: { id: c.id },
        data: { voidedAt, voidedByUserId: ctx.userId ?? null, voidReason: reason }
      })
      await audit(tx, {
        action: AuditAction.VOID,
        entity: 'Payment',
        entityId: c.id,
        userId: ctx.userId ?? null,
        before: JSON.stringify({ invoiceId: ctx.invoiceId, amount: c.amount, seq: c.seq, chequeNo: c.chequeNo, chequeStatus: ChequeStatus.PENDING }),
        after: JSON.stringify({ voidedAt, voidedByUserId: ctx.userId ?? null, voidReason: reason, returnId: ctx.returnId }),
        note:
          `چک ${c.chequeNo ? `شماره ${c.chequeNo} ` : ''}به مبلغ ${money(toNumberRial(c.amount))} ریال روی فاکتور ${receipt} خودکار باطل شد: ` +
          `برگشت سند ${faDigits(ctx.returnId)} بدهی این فاکتور را صفر کرد (بند ۴-۵۲). چک فیزیکی را به مشتری پس بدهید یا نزد مدیر نگه دارید؛ نباید به بانک برود.`
      })
    }
    return { voided: cheques.map((c) => c.id), flagged: [] }
  }
  for (const c of cheques) {
    await audit(tx, {
      action: AuditAction.CHEQUE_STATUS,
      entity: 'Payment',
      entityId: c.id,
      userId: ctx.userId ?? null,
      after: JSON.stringify({ needsManagerReview: true, returnId: ctx.returnId, remaining: ctx.remainingAfter, chequeAmount: c.amount }),
      note:
        `⚠️ رسیدگی مدیر · این چک نیاز به بازبینی دارد: فاکتور ${receipt} بعد از ثبت چک برگشت جزئی خورد (سند ${faDigits(ctx.returnId)}). ` +
        `مبلغ چک ${money(toNumberRial(c.amount))} ریال، بدهی باقی‌مانده ${money(Math.max(0, ctx.remainingAfter))} ریال (بند ۴-۵۲).`
    })
  }
  return { voided: [], flagged: cheques.map((c) => c.id) }
}

/** نشست ۱۶۴ · Y22 · بند ۴-۲۲ — ابطال برگشت ⇒ چکی که همین سند خودکار باطل کرده بود برمی‌گردد */
async function restoreChequesAfterReturnVoid(
  tx: Prisma.TransactionClient,
  ctx: { invoiceId: number; receiptNo: number; returnId: number; userId: number | null; reason: string }
): Promise<number[]> {
  const rows = await tx.payment.findMany({
    where: {
      invoiceId: ctx.invoiceId,
      kind: PaymentEntryKind.CHEQUE,
      chequeStatus: ChequeStatus.PENDING,
      NOT: { voidedAt: null },
      voidReason: { contains: chequeAutoVoidMarker(ctx.returnId) }
    },
    select: { id: true, amount: true, chequeNo: true, voidedAt: true, voidReason: true, voidedByUserId: true }
  })
  for (const c of rows) {
    await tx.payment.update({ where: { id: c.id }, data: { voidedAt: null, voidedByUserId: null, voidReason: null } })
    await audit(tx, {
      action: AuditAction.VOID,
      entity: 'Payment',
      entityId: c.id,
      userId: ctx.userId ?? null,
      before: JSON.stringify({ voidedAt: c.voidedAt, voidedByUserId: c.voidedByUserId, voidReason: c.voidReason }),
      after: JSON.stringify({ voidedAt: null, restoredBecauseReturnVoided: ctx.returnId }),
      note:
        `چک ${c.chequeNo ? `شماره ${c.chequeNo} ` : ''}به مبلغ ${money(toNumberRial(c.amount))} ریال روی فاکتور ${faDigits(ctx.receiptNo)} دوباره «در جریان» شد، ` +
        `چون سند برگشت ${faDigits(ctx.returnId)} که آن را خودکار باطل کرده بود ابطال شد (بند ۴-۲۲) · دلیل: ${ctx.reason}. ` +
        'اگر چک فیزیکی به مشتری پس داده شده، آن را دستی باطل کنید.'
    })
  }
  return rows.map((r) => r.id)
}

/**
 * نشست ۱۶۴ · Y22 — علامت مشتقِ «نیاز به بازبینی» برای چک‌های در جریان: برگشت باطل‌نشده‌ای که
 * بعد از ثبت چک روی همان فاکتور ثبت شده. خروجی: شناسه‌ی پرداخت ⇒ متن هشدار.
 */
async function chequeReviewNotes(
  client: any,
  payments: { id: number; invoiceId: number; kind?: string | null; chequeStatus?: string | null; voidedAt?: any; createdAt?: any; amount?: number | null }[]
): Promise<Map<number, string>> {
  const out = new Map<number, string>()
  const pend = payments.filter(
    (p) => (p.kind ?? '') === PaymentEntryKind.CHEQUE && (p.chequeStatus ?? ChequeStatus.PENDING) === ChequeStatus.PENDING && p.voidedAt == null
  )
  if (!pend.length) return out
  const invoiceIds = [...new Set(pend.map((p) => p.invoiceId))]
  const rets: { id: number; invoiceId: number; returnedAt: any }[] = []
  for (let i = 0; i < invoiceIds.length; i += 500)
    rets.push(
      ...(await client.saleReturn.findMany({
        where: { invoiceId: { in: invoiceIds.slice(i, i + 500) }, voidedAt: null },
        select: { id: true, invoiceId: true, returnedAt: true }
      }))
    )
  for (const p of pend) {
    const created = p.createdAt ? new Date(p.createdAt).getTime() : 0
    const hits = rets.filter((r) => r.invoiceId === p.invoiceId && new Date(r.returnedAt).getTime() >= created)
    if (!hits.length) continue
    out.set(
      p.id,
      `⚠️ این چک نیاز به بازبینی دارد: فاکتورش بعد از ثبت چک برگشت خورده (سند برگشت ${hits.map((h) => faDigits(h.id)).join('، ')}). ` +
        'مبلغ چک را با بدهی باقی‌مانده‌ی فاکتور تطبیق دهید و پیش از خواباندن به حساب با مشتری تصمیم بگیرید (بند ۴-۵۲).'
    )
  }
  return out
}

/** روش پرداخت مخصوص چک؛ اگر نبود، همان لحظه ساخته می‌شود (در فهرست‌ها دیده نمی‌شود). */
async function chequeMethodId(client: Client): Promise<number> {
  const existing = await client.paymentMethod.findUnique({ where: { key: CHEQUE_METHOD_KEY } })
  if (existing) return existing.id
  const created = await client.paymentMethod.create({
    data: { key: CHEQUE_METHOD_KEY, label: 'چک', kind: 'CUSTOM', isActive: false, sortOrder: 90 }
  })
  return created.id
}

/**
 * ردیف‌های پرداختی لحظه‌ی *ثبت* فاکتور.
 * تاریخ و ساعت هر پرداختی همان لحظه‌ی صدور فاکتور است (اگر تاریخ فاکتور را دستی
 * عقب برده باشید، پرداختی اول هم به همان تاریخ ثبت می‌شود — همان‌طور که در سند
 * کاغذی هست).
 */
async function currentPaymentShiftId(tx: Prisma.TransactionClient, userId?: number | null, custodyFence?: any): Promise<number> {
  const open = custodyFence ? await shiftService.shiftForNow(tx, { custodyFence }) : await shiftService.openShift(tx)
  if (!open)
    throw new BusinessError('برای ثبت یا تسویه‌ی پرداخت، ابتدا یک نشست بازِ کارمند لازم است.')
  if (userId != null && open.userId != null && Number(open.userId) !== Number(userId))
    throw new BusinessError('کارمند نشست باز با ثبت‌کننده‌ی پرداخت یکسان نیست؛ نشست درست را باز کنید.')
  return open.id
}

async function initialPaymentRows(
  tx: Prisma.TransactionClient,
  input: CreateSaleInput,
  issuedAt: Date,
  opts: { shiftId?: number | null; createdAt?: Date } = {}
) {
  const dateJalali = toJalaliDate(issuedAt)
  const time = toClock(issuedAt)
  const createdAt = opts.createdAt ?? new Date()
  const rows = input.payments ?? []
  if (!rows.length) return []
  /**
   * ===================== کار الف — مقصد پولِ پرداختیِ لحظه‌ی فروش =====================
   * تا جلسه ۳۸ این تابع هیچ مقصدی نمی‌نوشت، پس پرداختی لحظه‌ی فروش `null`
   * می‌ماند و در پنجره‌ی اقساط برچسب «نامشخص» می‌خورد — دقیقاً همان داده‌ی
   * ناقصی که کار الف برای رفعش است، ولی این بار *تازه* تولید می‌شد.
   *
   * راه‌حل همان چیزی است که پرامپ خواسته («مقصد را از روش پرداخت مشتق کن»):
   *   • `kind` همه‌ی روش‌های استفاده‌شده **یک‌جا** خوانده می‌شود (یک کوئری، نه
   *     یکی per-row، تا تراکنش فروش کند نشود).
   *   • مقصد از همان `destinationFromMethodKind` می‌آید که جای دیگری هم مبناست:
   *     روش نقدی ⇒ CASH · روش کارت ⇒ CARD · CUSTOM/چک ⇒ `null` (هیچ حدسی نه).
   *   • اگر پنل صریح مقصدی فرستاد (تنها حالت واقعی: «به حساب مدیر»)، از همان
   *     `assertDestination` رد می‌شود؛ پس ردیف متناقض ساخته نمی‌شود و پیام خطا
   *     همان پیام فارسی همیشگی است.
   * جمع‌های گزارش با این تغییر عوض نمی‌شوند: تا امروز پرداختیِ نقدیِ لحظه‌ی فروش
   * از راه `kind` روش پرداخت در سبد «نقد» می‌نشست و حالا از راه مقصدِ صریح در
   * همان سبد می‌نشیند (`receiptBucketOf` برای هر دو یک عدد می‌دهد).
   * ==================================================================================
   */
  const methodIds = Array.from(new Set(rows.map((p) => p.methodId)))
  const methods = await tx.paymentMethod.findMany({
    where: { id: { in: methodIds } },
    select: { id: true, kind: true, key: true }
  })
  if (methods.some((m) => m.key === CHEQUE_METHOD_KEY))
    throw new BusinessError(
      'چک را نمی‌توان در پرداخت اولیه‌ی فاکتور ثبت کرد؛ چک باید با شماره، سررسید و وضعیت «در جریان» از بخش پرداختی‌ها ثبت شود.'
    )
  /** AUDIT-S142-02 (AUDIT-D73) — پرداخت اولیه‌ی فروش هم روش سیستمی اعتبار را بی‌کد نمی‌پذیرد */
  for (const m of methods) assertNotCreditMethodKind(m.kind)
  const kindOf = new Map(methods.map((m) => [m.id, m.kind ?? null]))
  return rows.map((p, i) => {
    const kind = kindOf.get(p.methodId) ?? null
    const destination =
      p.destination == null || p.destination === ''
        ? destinationFromMethodKind(kind)
        : assertDestination(p.destination, kind, 'PAYMENT')
    return {
      methodId: p.methodId,
      amount: toNumberRial(p.amount),
      reference: p.reference,
      kind: PaymentEntryKind.CASH,
      destination,
      seq: i + 1,
      paidAt: issuedAt,
      paidAtJalali: dateJalali,
      paidAtTime: time,
      createdAt,
      createdByUserId: input.userId ?? null,
      createdShiftId: opts.shiftId ?? null
    }
  })
}

/**
 * بازمحاسبه‌ی «جمع پرداختی‌های دریافت‌شده» و علامت «تسویه‌شده» یک فاکتور.
 *
 * تنها منبع حقیقت، ردیف‌های جدول Payment است؛ پس این تابع بعد از هر تغییری در
 * پرداختی‌ها (افزودن، ویرایش، حذف، پاس شدن چک) و بعد از ویرایش مبالغ فاکتور
 * صدا زده می‌شود و `paidTotal` / `settledAt` را هم‌خوان می‌کند.
 */
/**
 * ===========================================================================
 * نشست ۶۰ · خوشه C / C6 (بند ۴-۲۲، DECISIONS S60-2) — سند برگشتِ تعویض جدا از
 * گرافش نه حذف می‌شود نه ویرایش.
 *
 * قبلاً returnDelete سند برگشت تعویض را فیزیکی پاک می‌کرد ولی سند تعویض (فاکتور
 * جایگزین)، پرداخت «ارزش کالای برگشتی»، بازپرداخت نقدی (CashMovement)، اعتبار
 * صادرشده و کاهش بدهی فاکتور اصلی سر جایشان می‌ماندند ⇒ پل تطبیق باز می‌شد (مثال
 * تست: ۲۰۰ ریال مانده‌ی بی‌توضیح) و مدرک تعویض از بین می‌رفت. returnUpdate هم فقط
 * total را عوض می‌کرد و exchangeDiff/سند تعویض/اعتبار را دست نمی‌زد.
 *
 * تا وقتی «ابطال اتمیک کل گراف تعویض» (void با مهر کی/کِی/چرا) ساخته شود، هر دو
 * مسیر برای kind = EXCHANGE کاملاً بسته‌اند؛ راه اصلاح: برگشت از فروش روی خودِ
 * «سند تعویض» (که یک فاکتور عادی است) — آن مسیر همه‌ی اثرهای مالی را درست می‌سازد.
 * ===========================================================================
 */
function assertNotExchangeReturn(ret: { id: number; kind?: string | null; exchangeReceiptNo?: number | null }, what: 'ویرایش') {
  if ((ret.kind ?? 'RETURN') !== ReturnKind.EXCHANGE) return
  /**
   * نشست ۶۵ (S65-1) — «حذف» سند تعویض دیگر مسدود نیست: returnDelete کل گراف تعویض را
   * اتمیک باطل می‌کند. ویرایش تکی همچنان بسته است؛ راه اصلاح = ابطال کل تعویض + ثبت دوباره.
   */
  throw new BusinessError(
    `${what} این سند ممکن نیست: این برگشت بخشی از یک «تعویض کالا» است` +
      (ret.exchangeReceiptNo ? ` (سند تعویض ${faDigits(ret.exchangeReceiptNo)})` : '') +
      '.\n' +
      `${what} تکیِ آن، سند تعویض، پرداخت‌ها، بازپرداخت صندوق و اعتبار وابسته را ناهماهنگ می‌گذارد و مغایرت پول می‌سازد.\n` +
      'برای اصلاح، کل تعویض را «ابطال» کنید (سند برگشت، سند تعویض، اعتبار و اثر انبار با هم و با دلیل باطل می‌شوند) ' +
      'و تعویض درست را دوباره ثبت کنید؛ یا روی خودِ «سند تعویض» برگشت از فروش ثبت کنید.'
  )
}

/**
 * نشست ۶۴ · بند ۴-۲۲ — سند برگشتِ باطل‌شده فقط مدرک است: نه ویرایش، نه ابطال
 * دوباره، نه نمایش در فرم ویرایش.
 */
function assertReturnNotVoided(
  ret: { id: number; voidedAt?: Date | string | number | null; voidReason?: string | null },
  what: 'حذف' | 'ویرایش' | 'ابطال' | 'نمایش برای ویرایش'
) {
  if (ret.voidedAt == null) return
  const at = ret.voidedAt instanceof Date ? ret.voidedAt : new Date(ret.voidedAt as any)
  throw new BusinessError(
    `${what} این سند ممکن نیست: برگشت ${faDigits(ret.id)} قبلاً باطل شده است` +
      (Number.isFinite(at.getTime()) ? ` (${toJalaliDate(at)})` : '') +
      (ret.voidReason ? ` · دلیل ابطال: ${ret.voidReason}` : '') +
      '.\nسند باطل فقط برای سابقه نگه داشته می‌شود و در هیچ محاسبه‌ای نیست؛ اگر برگشت واقعاً انجام شده، یک برگشت تازه ثبت کنید.'
  )
}

async function recalcSettlement(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  /**
   * نشست ۶۱ (S61-3) — اگر بعد از این تغییر، اعتبار صادرشده از اضافه‌دریافت
   * بی‌پشتوانه بماند: `throw` (پیش‌فرض) ⇒ کل عملیات rollback با پیام فارسی ·
   * `flag` ⇒ عملیات انجام می‌شود (واقعیت بیرونی مثل برگشت خوردن چک را نمی‌شود رد
   * کرد) ولی یک ردیف «نیاز به رسیدگی مدیر» در Audit ثبت و در نتیجه برگردانده می‌شود.
   */
  opts: { overpayCreditShortfall?: 'throw' | 'flag'; userId?: number | null } = {}
): Promise<{
  /** نشست ۶۱ — اعتبار اضافه‌دریافتِ بی‌پشتوانه (فقط در حالت flag ممکن است > ۰ باشد) */
  overpayCreditShortfall: number
  grandTotal: number
  paidTotal: number
  remaining: number
  /** جمع برگشت ساده‌ی (kind=RETURN) همین فاکتور، تا این لحظه */
  returnedTotal: number
  /** نشست ۵۸ — بخشی از پول دریافتی که با برگشت پس داده شد */
  refundFromReceived: number
  /** نشست ۵۸ — اضافه‌دریافت فعلی فاکتور (= Σ overpayAmount ردیف‌ها) */
  overpaid: number
  overpayTotal: number
  overpayChanges: { id: number; before: number; after: number }[]
  settlementState: 'UNPAID' | 'PARTIAL' | 'SETTLED'
  pendingChequeTotal: number
  settled: boolean
  settledAtJalali: string | null
}> {
  const inv = await tx.saleInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, grandTotal: true, settledAt: true, settledAtJalali: true }
  })
  if (!inv) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد.')

  const rows = await tx.payment.findMany({
    where: { invoiceId, voidedAt: null },
    select: { amount: true, kind: true, chequeStatus: true }
  })
  const paidTotal = receivedTotalOf(rows)
  const pending = pendingChequeTotalOf(rows)
  const grandTotal = toNumberRial(inv.grandTotal) // نشست ۱۸۱: BigInt ⇒ number
  /**
   * ---------------- نشست ۵۸ · C2 — بدهی واحد (remainingOf) ----------------
   * قبلاً: `max(0, grandTotal − paidTotal − returnedTotal)` اینجا و
   * `max(0, grandTotal − paidTotal)` در addPayment/creditList/payments ⇒ دو
   * تعریف متناقض و گیت اضافه‌دریافت کور. و هیچ‌کدام بازپرداخت از پول دریافتی را
   * حساب نمی‌کرد (فاکتور ۱٬۰۰۰، پرداخت ۵۰۰، برگشت ۶۰۰ با بازپرداخت نقدی ۵۰۰ ⇒
   * «تسویه‌شده» با ۴۰۰ بدهی پنهان). حالا تنها فرمول `remainingOf` است.
   * تعویض (kind = EXCHANGE) مثل قبل بدهی فاکتور اصلی را کم نمی‌کند.
   */
  const debt = await invoiceRemaining(tx, invoiceId, grandTotal, paidTotal)
  const returnedTotal = debt.returnedValue
  const settled = debt.settled
  // C3 — اضافه‌دریافت هر ردیف پرداخت از وضعیت *فعلی* فاکتور بازسازی می‌شود
  const overpay = await recalcPaymentOverpay(tx, invoiceId, {
    payable: debt.payable,
    refundFromReceived: debt.refundFromReceived
  })
  /**
   * نشست ۶۱ · بند ۴-۳۵/۴-۳۷ (S61-3) — ضدسرقت: اعتبار صادرشده از اضافه‌دریافت
   * هیچ‌وقت نباید از اضافه‌دریافت *واقعی فعلی* فاکتور بیشتر بماند. مثال: فاکتور
   * ۱٬۰۰۰، پرداخت ۵۰۰ و ۸۰۰ (۳۰۰ اضافه ⇒ اعتبار ۳۰۰)؛ حذف پرداخت ۵۰۰ اضافه‌دریافت را
   * صفر می‌کند و بدون این گیت مشتری ۳۰۰ اعتبار بی‌پشتوانه + ۲۰۰ بدهی داشت.
   */
  const overpayCreditShortfall = await checkOverpayCreditBacking(tx, invoiceId, opts)

  // تاریخ تسویه فقط *یک بار* ثبت می‌شود و با پرداختی‌های بعدی جابه‌جا نمی‌شود؛
  // اگر فاکتور از حالت تسویه خارج شود (حذف یک پرداختی یا برگشت خوردن چک) پاک
  // می‌گردد تا فهرست فاکتورها هیچ‌وقت وضعیت اشتباه نشان ندهد.
  let settledAtJalali = inv.settledAtJalali ?? null
  if (settled && !inv.settledAt) {
    const now = new Date()
    settledAtJalali = toJalaliDate(now)
    await tx.saleInvoice.update({
      where: { id: invoiceId },
      data: { paidTotal, settledAt: now, settledAtJalali }
    })
  } else if (!settled && inv.settledAt) {
    settledAtJalali = null
    await tx.saleInvoice.update({
      where: { id: invoiceId },
      data: { paidTotal, settledAt: null, settledAtJalali: null }
    })
  } else {
    await tx.saleInvoice.update({ where: { id: invoiceId }, data: { paidTotal } })
  }

  return {
    overpayCreditShortfall,
    grandTotal,
    paidTotal,
    /** نشست ۵۸ · C2 — بدهی واحد: برگشت و بازپرداخت با هم */
    remaining: debt.remaining,
    returnedTotal,
    refundFromReceived: debt.refundFromReceived,
    overpaid: debt.overpaid,
    overpayTotal: overpay.total,
    overpayChanges: overpay.changes,
    settlementState: debt.state,
    pendingChequeTotal: pending,
    settled,
    settledAtJalali
  }
}

/**
 * ===========================================================================
 * نشست ۵۹ · خوشه B (DECISIONS S59-4) — ترمیم یک‌باره و idempotent داده‌ی قدیمی:
 * هر فاکتوری (در عمل سند تعویض) که `Payment` منفی دارد، با قاعده‌ی جدید
 * (پرداخت منفی دریافتی نیست) دوباره تسویه‌سنجی می‌شود. ردیف منفی **حذف نمی‌شود**
 * (سند مالی هرگز پاک نمی‌شود، بند ۴-۲۲)؛ فقط دیگر در paidTotal شمرده نمی‌شود.
 * هر فاکتوری که عددش عوض شود با قبل/بعد در Audit ثبت می‌گردد. اجرای دوم هیچ
 * تغییری نمی‌دهد. در شروع برنامه (بعد از seed) صدا زده می‌شود.
 * ===========================================================================
 */
export async function repairLegacyNegativePayments(
  userId: number | null = null
): Promise<{ checked: number; fixed: number }> {
  const neg = await prisma.payment.findMany({ where: { amount: { lt: 0 } }, select: { invoiceId: true } })
  const ids = [...new Set(neg.map((p: any) => p.invoiceId as number))]
  let fixed = 0
  for (const id of ids) {
    await prisma.$transaction(async (tx) => {
      const before = await tx.saleInvoice.findUnique({
        where: { id },
        select: { paidTotal: true, settledAt: true, receiptNo: true }
      })
      if (!before) return
      const settle = await recalcSettlement(tx, id)
      const changed =
        toNumberRial(before.paidTotal) !== settle.paidTotal || !!before.settledAt !== settle.settled
      if (!changed) return
      fixed++
      await audit(tx, {
        action: AuditAction.SALE_PAYMENT_UPDATE,
        entity: 'SaleInvoice',
        entityId: id,
        userId,
        before: JSON.stringify({ paidTotal: before.paidTotal, settled: !!before.settledAt }),
        after: JSON.stringify({ paidTotal: settle.paidTotal, settled: settle.settled, remaining: settle.remaining }),
        note:
          `ترمیم خودکار سند ${faDigits(before.receiptNo)}: پرداختیِ منفیِ قدیمی (بازپرداخت تعویض) دیگر دریافتی ` +
          `حساب نمی‌شود · جمع دریافتی ${money(toNumberRial(before.paidTotal))} ⇐ ${money(settle.paidTotal)} ریال`
      })
    }, TX_OPTIONS)
  }
  return { checked: ids.length, fixed }
}

/**
 * نشست ۵۸ · C3 — هر تغییر خودکار اضافه‌دریافت (بازسازی بعد از ویرایش/حذف
 * پرداخت یا برگشت) با قبل/بعد در Audit ثبت می‌شود؛ هیچ عددی بی‌صدا عوض نمی‌شود.
 */
async function auditOverpayChanges(
  tx: Prisma.TransactionClient,
  settle: { overpayChanges?: { id: number; before: number; after: number }[]; overpaid?: number },
  ctx: { invoiceId: number; receiptNo: number | string; userId?: number | null; why: string }
): Promise<void> {
  const changes = settle.overpayChanges ?? []
  if (!changes.length) return
  await audit(tx, {
    action: AuditAction.SALE_PAYMENT_UPDATE,
    entity: 'SaleInvoice',
    entityId: ctx.invoiceId,
    userId: ctx.userId ?? null,
    before: JSON.stringify(changes.map((c) => ({ paymentId: c.id, overpayAmount: c.before }))),
    after: JSON.stringify(changes.map((c) => ({ paymentId: c.id, overpayAmount: c.after }))),
    note:
      `بازسازی خودکار «مبلغ اضافه‌ی دریافتی» فاکتور ${faDigits(ctx.receiptNo)} بعد از ${ctx.why}: ` +
      changes.map((c) => `پرداختی ${faDigits(c.id)}: ${money(c.before)} ⇐ ${money(c.after)} ریال`).join(' · ') +
      ` · اضافه‌دریافت فعلی فاکتور ${money(settle.overpaid ?? 0)} ریال`
  })
}

/**
 * ===========================================================================
 * نشست ۶۱ · خوشه C · بند ۴-۳۵ (مراحل ۲ و ۳) و ۴-۵۵ — اعتبار خرید از «مبلغ
 * اضافه‌ی دریافتی» (DECISIONS S61-1 تا S61-5).
 *
 * پشتوانه = اضافه‌دریافتِ ردیف‌های «پول واقعی» (نقد/کارت/حساب مدیر/چکِ پاس‌شده؛
 * نه مصرف اعتبار، نه چکِ در جریان) — بند ۴-۳۷.
 * تعهد = مبلغ اعتبارهای OVERPAY همان فاکتور؛ اعتبار باطل/حذف‌شده فقط به اندازه‌ی
 * بخشی که قبلاً مصرف شده (آن بخش واقعاً کالا شده و برنمی‌گردد).
 * ===========================================================================
 */
async function overpayCreditBacking(
  tx: Prisma.TransactionClient,
  invoiceId: number
): Promise<{ realOverpay: number; committed: number; available: number; creditIds: number[] }> {
  const credits = await tx.storeCredit.findMany({
    where: { sourceInvoiceId: invoiceId, source: CreditSource.OVERPAY },
    select: { id: true, amount: true, usedAmount: true, status: true, voidedAt: true, deletedAt: true }
  })
  let committed = 0
  const creditIds: number[] = []
  for (const c of credits as any[]) {
    const dead = c.status === StoreCreditStatus.CANCELED || !!c.voidedAt || !!c.deletedAt
    const part = dead ? Math.max(0, toNumberRial(c.usedAmount ?? 0)) : Math.max(0, toNumberRial(c.amount))
    committed += part
    if (part > 0) creditIds.push(Number(c.id))
  }
  const pays = await tx.payment.findMany({
    // ممیزی A88-03 — اضافه‌دریافتِ پرداخت باطل دیگر «اضافه‌دریافت واقعی» نیست
    where: { invoiceId, overpayAmount: { gt: 0 }, voidedAt: null },
    select: { overpayAmount: true, kind: true, chequeStatus: true, destination: true, methodId: true }
  })
  const methodIds = [...new Set((pays as any[]).map((p) => p.methodId))]
  const methods = methodIds.length
    ? await tx.paymentMethod.findMany({ where: { id: { in: methodIds } }, select: { id: true, kind: true } })
    : []
  const kindOf = new Map((methods as any[]).map((m) => [m.id, m.kind ?? PaymentKind.CUSTOM]))
  let realOverpay = 0
  for (const p of pays as any[]) {
    const isCheque = (p.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
    if (isCheque && p.chequeStatus !== ChequeStatus.CLEARED) continue
    const bucket = receiptBucketOf({ isCheque, destination: p.destination, methodKind: kindOf.get(p.methodId) ?? PaymentKind.CUSTOM })
    if (bucket === 'exchangeCredit' || bucket === 'storeCredit') continue
    realOverpay += Math.max(0, toNumberRial(p.overpayAmount ?? 0))
  }
  return { realOverpay, committed, available: Math.max(0, realOverpay - committed), creditIds }
}

async function checkOverpayCreditBacking(
  tx: Prisma.TransactionClient,
  invoiceId: number,
  opts: { overpayCreditShortfall?: 'throw' | 'flag'; userId?: number | null }
): Promise<number> {
  const b = await overpayCreditBacking(tx, invoiceId)
  const shortfall = Math.max(0, b.committed - b.realOverpay)
  if (shortfall <= 0) return 0
  const inv = await tx.saleInvoice.findUnique({ where: { id: invoiceId }, select: { receiptNo: true } })
  const receipt = faDigits(inv?.receiptNo ?? invoiceId)
  const references = b.creditIds.map((id) => `اعتبار #${id}`).join('، ')
  if ((opts.overpayCreditShortfall ?? 'throw') === 'throw')
    throw new BusinessError(
      `این عملیات انجام نشد: از «مبلغ اضافه‌ی دریافتی» فاکتور ${receipt} قبلاً ${money(b.committed)} ریال ` +
        `اعتبار خرید صادر شده (${references})، ولی بعد از این تغییر اضافه‌دریافت واقعی فاکتور فقط ` +
        `${money(b.realOverpay)} ریال می‌ماند؛ یعنی ${money(shortfall)} ریال اعتبار بی‌پشتوانه می‌شد.\n` +
        'اگر آن اعتبار هنوز مصرف نشده، اول در «مدیریت اعتبار خرید» باطلش کنید و بعد دوباره تلاش کنید؛ ' +
        'اگر مصرف شده، با مدیر هماهنگ کنید.'
    )
  await audit(tx, {
    action: AuditAction.SALE_PAYMENT_UPDATE,
    entity: 'SaleInvoice',
    entityId: invoiceId,
    userId: opts.userId ?? null,
    after: JSON.stringify({
      needsManagerReview: true,
      overpayCreditCommitted: b.committed,
      realOverpay: b.realOverpay,
      shortfall,
      creditIds: b.creditIds
    }),
    note:
      `⚠️ نیاز به رسیدگی مدیر: اعتبار خرید صادرشده از اضافه‌دریافت فاکتور ${receipt} (${references}) ` +
      `${money(shortfall)} ریال از اضافه‌دریافت واقعی فعلی بیشتر است (تعهد ${money(b.committed)} · ` +
      `اضافه‌دریافت واقعی ${money(b.realOverpay)} ریال). اعتبار را باطل/اصلاح یا مابه‌التفاوت را از مشتری وصول کنید.`
  })
  return shortfall
}

/** متن ثابت روی رسید/نتیجه‌ی هر اعتبار اضافه‌دریافت (بند ۴-۳۲). */
const OVERPAY_CREDIT_NOTICE = 'این اعتبار خرید غیرقابل نقد شدن است و فقط برای خرید کالا مصرف می‌شود.'

/**
 * نشست ۶۲ (S62-2) — سنجش رمز مدیرِ «اعتبار اضافه‌دریافت بالاتر از سقف» **قبل از**
 * باز شدن تراکنش (همان الگوی `assertPanelPassword` در `create`). رمز خالی ⇒ false
 * (اگر مبلغ از سقف بالاتر باشد، `issueOverpayCreditTx` با پیام «رمز مدیر را وارد
 * کنید» رد می‌کند و چیزی نوشته نمی‌شود). رمز غلط ⇒ همین‌جا رد، بدون هیچ نوشتن
 * مالی. رمز درست ⇒ true و ثبت موفقیت گیت بیرون از تراکنش.
 */
async function preverifyOverpayManager(
  input: { managerPassword?: string | null } | null | undefined,
  action: string
): Promise<boolean> {
  const pass = String(input?.managerPassword ?? '')
  if (!pass) return false
  await assertManagerPassword(pass, action)
  return true
}

/**
 * ===========================================================================
 * نشست ۱۵۴ · S151-b · بند ۴-۲۶ (بازه‌ی تخفیف سمت سرور، بی‌دورزدن با رمز) و
 * requireManagerForPriceOverride (قیمت دستی در فروش و ویرایش فاکتور).
 *
 * قبلاً `create/update` هر `unitPrice` و هر تخفیفی را می‌پذیرفتند ⇒ کالای
 * ۱٬۰۰۰٬۰۰۰ ریالی بی‌رمز و بی‌Audit با ۳۰۰٬۰۰۰ ثبت می‌شد و بازه‌ی تخفیف فقط در UI
 * بود. این helper **بیرون از تراکنش** (نوشتن AuthLockout وسط تراکنش = بن‌بست
 * SQLite) و به این ترتیب کار می‌کند تا فاکتوری که به‌هرحال رد می‌شود یک تلاش
 * رمز مصرف نکند:
 *   ۱) قیمت مرجع هر ردیف: در ویرایش کمترین unitPrice همان کالا در فاکتور اصلی
 *      (source=INVOICE)، وگرنه salePrice فعلی کالا (source=CATALOG). کالای
 *      ناموجود بی‌مرجع ⇒ رد (S153-D2).
 *   ۲) بازه‌ی تخفیف (فقط غیرعمده): کاهش قیمت زیر مرجع هم تخفیف حساب می‌شود
 *      (S152-D4). عبور از بازه = رد کامل، حتی با رمز مدیر.
 *   ۳) رمز مدیر فقط اگر کاهش زیر مرجع هست و گیت روشن است.
 * افزایش قیمت رمز نمی‌خواهد ولی مثل کاهش در Audit می‌نشیند (writeSalePriceOverrideAudit).
 * ===========================================================================
 */
interface SalePriceOverride {
  variantId: number
  code: string
  qty: number
  refPrice: number
  enteredPrice: number
  source: 'INVOICE' | 'CATALOG'
}

interface SalePricingCheck {
  /** رمز مدیر همین درخواست سنجیده و پذیرفته شد (برای preverify بعدی، فقط یک بار) */
  managerApproved: boolean
  /** گیت requireManagerForPriceOverride در لحظه‌ی سنجش روشن بود */
  gateOn: boolean
  overrides: SalePriceOverride[]
}

const discountRejectTail = ' این محدودیت را مدیر در «سیاست تخفیف» تعیین کرده و با رمز مدیر هم باز نمی‌شود.'

async function preverifySalePolicy(
  input: CreateSaleInput,
  ctx: { orderType: string; originalItems?: { variantId: number; unitPrice: number; qty?: number | null }[] | null }
): Promise<SalePricingCheck> {
  // ---------- ۱) مرجع‌ها ----------
  const invoiceRef = new Map<number, number>()
  /**
   * نشست ۱۶۵ · S153-D6 · S165-D2 — مرجع فاکتور اصلی فقط برای **همان تعداد** معتبر است.
   * قبلاً قیمتی که مدیر برای یک عدد تأیید کرده بود، در ویرایش برای هر تعداد دلخواه بی‌رمز می‌ماند
   * (مثلاً ۱ عدد با تأیید مدیر ۳۰۰٬۰۰۰ ⇒ ویرایش به ۱۰ عدد ۳۰۰٬۰۰۰ بی‌رمز). حالا تعداد اضافه بر فاکتور اصلی
   * با قیمت فعلی کالا (CATALOG) سنجیده می‌شود.
   */
  const invoiceQty = new Map<number, number>()
  for (const it of ctx.originalItems ?? []) {
    const price = Math.round(Number(it.unitPrice))
    const prev = invoiceRef.get(it.variantId)
    if (prev == null || price < prev) invoiceRef.set(it.variantId, price)
    const q = it.qty == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.round(Number(it.qty)))
    invoiceQty.set(it.variantId, (invoiceQty.get(it.variantId) ?? 0) + q)
  }
  const ids = [...new Set(input.lines.map((l) => l.variantId))]
  const variants = new Map<number, { code: string; salePrice: number }>()
  for (const v of await loadProductVariantsByIds(prisma, ids, { id: true, code: true, salePrice: true }))
    variants.set(Number(v.id), { code: String(v.code ?? ''), salePrice: Math.round(Number(v.salePrice ?? 0)) })

  const overrides: SalePriceOverride[] = []
  let reduction = 0
  let base = 0
  let goods = 0
  const noRef = (l: { code?: string; variantId: number }) =>
    new BusinessError(
      `کالا پیدا نشد؛ قیمت مرجع وجود ندارد (کد ${l.code || faDigits(l.variantId)}). ` +
        'بدون قیمت مرجع، کم‌ثبتی قیمت قابل سنجش نیست؛ کالا را دوباره از فهرست انتخاب کنید.'
    )
  for (const l of input.lines) {
    const variant = variants.get(l.variantId)
    const fromInvoice = invoiceRef.get(l.variantId)
    if (fromInvoice == null && !variant) throw noRef(l)
    const unit = l.unitPrice
    goods += unit * l.qty
    /** S165-D2 — سهم تحت پوشش فاکتور اصلی (مرجع INVOICE) و مازاد آن (مرجع CATALOG) */
    const covered = fromInvoice == null ? 0 : Math.min(l.qty, invoiceQty.get(l.variantId) ?? 0)
    if (fromInvoice != null) invoiceQty.set(l.variantId, (invoiceQty.get(l.variantId) ?? 0) - covered)
    const excess = l.qty - covered
    if (excess > 0 && !variant)
      throw new BusinessError(
        `تعداد کالای کد ${l.code || faDigits(l.variantId)} در ویرایش از فاکتور اصلی بیشتر شده ` +
          `(${faDigits(excess)} عدد اضافه) ولی این کالا دیگر در فهرست نیست و قیمت مرجعی برای عددهای اضافه وجود ندارد. ` +
          'تعداد را به همان مقدار فاکتور اصلی برگردانید.'
      )
    const portions: { qty: number; ref: number; source: 'INVOICE' | 'CATALOG' }[] = []
    if (covered > 0) portions.push({ qty: covered, ref: fromInvoice!, source: 'INVOICE' })
    if (excess > 0) portions.push({ qty: excess, ref: variant!.salePrice, source: 'CATALOG' })
    for (const p of portions) {
      reduction += Math.max(0, p.ref - unit) * p.qty
      base += Math.max(unit, p.ref) * p.qty
      if (unit !== p.ref)
        overrides.push({
          variantId: l.variantId,
          code: variant?.code || l.code || String(l.variantId),
          qty: p.qty,
          refPrice: p.ref,
          enteredPrice: unit,
          source: p.source
        })
    }
  }

  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۲۶ — فاکتور عمده هم گیت سرور دارد.
   *
   * سیاست تخفیفِ پنل فروش عمداً روی عمده اعمال نمی‌شود (قیمت عمده ذاتاً
   * پایین‌تر است و سقف درصدیِ پنل خرده‌فروشی آن‌جا معنا ندارد). ولی نتیجه‌اش
   * این شده بود که ماژول عمده **هیچ** گیت سروری نداشت:
   *
   *   `sale:create` با `orderType=WHOLESALE`، کالا ۱٬۰۰۰٬۰۰۰ و
   *   `invoiceDiscount=۹۰۰٬۰۰۰` ⇒ بدون هیچ رمزی ثبت می‌شد.
   *
   * خودِ `DECISIONS.md` (S151-D4) این را به‌عنوان «ریسک باقی‌مانده» ثبت کرده
   * بود: «گیت سرور ماژول عمده و قفل posDiscount هنوز فقط در UI هستند».
   *
   * راه‌حل: به‌جای تحمیل سقف درصدیِ خرده‌فروشی، تخفیف روی عمده **تأیید**
   * می‌خواهد — رمز پنل فاکتور عمده (که رمز دوم/سوم هم می‌پذیرد). یعنی
   * انعطاف قیمت عمده حفظ می‌شود ولی هیچ تخفیفی بی‌رد نمی‌ماند.
   */
  /**
   * 🔴 نشست ۱۸۵ · بند ۴-۲۶ — سقف تخفیف فاکتور عمده، **رد کامل** (نه گیت رمز).
   *
   * پیاده‌سازی نشست ۱۸۴ دو ایراد داشت که بازبینی مستقل هر دو را گرفت:
   *   • رمز اصلاً به این تابع نمی‌رسید (`ctx` فقط `orderType` داشت)، پس با
   *     قفل روشن هر تخفیفی بالای آستانه رد می‌شد — حتی با رمز درست.
   *   • با قفل خاموش، `assertPanelPassword` مقدار `OPEN` می‌داد و **هیچ**
   *     گیتی نبود؛ یعنی سناریوی تخفیف ۹۰٪ همچنان باز بود.
   *
   * و مستقل از آن دو باگ، بند ۴-۲۶ می‌گوید عبور از بازه یعنی **رد**، نه
   * چیزی که با رمز مدیر دور زده شود. پس حالا دقیقاً مثل پنل خرده‌فروشی یک
   * سقف است — با این تفاوت که بازه‌اش جداست و مدیر خودش تنظیمش می‌کند
   * (`wholesaleMaxPercent` / `wholesaleMaxAmount`، پیش‌فرض بی‌سقف).
   */
  if (ctx.orderType === OrderType.WHOLESALE) {
    const wholesaleDiscount =
      input.lines.reduce((s, l) => s + Math.max(0, Math.round(l.discount ?? 0)), 0) +
      Math.max(0, Math.round(input.invoiceDiscount ?? 0)) +
      overrides.filter((o) => o.enteredPrice < o.refPrice).reduce((s, o) => s + (o.refPrice - o.enteredPrice) * o.qty, 0)
    if (wholesaleDiscount > 0) {
      const wholesaleBase = input.lines.reduce(
        (s, l) => s + Math.max(0, Math.round(l.unitPrice ?? 0)) * Math.max(0, Math.round(l.qty ?? 0)),
        0
      )
      const wPolicy = await settingsService.discountPolicy()
      const wCeiling = wholesaleDiscountCeilingFor(wPolicy, wholesaleBase)
      if (wholesaleDiscount > wCeiling)
        throw new BusinessError(
          `جمع تخفیف این فاکتور عمده ${money(wholesaleDiscount)} ریال است و از سقف مجاز ${money(wCeiling)} ریال بیشتر است ` +
            `(سقف عمده: ${faDigits(wPolicy.wholesaleMaxPercent)}٪ از ${money(wholesaleBase)} ریال` +
            `${wPolicy.wholesaleMaxAmount > 0 ? ` و حداکثر ${money(wPolicy.wholesaleMaxAmount)} ریال` : ''}).\n` +
            'این سقف با رمز مدیر هم دور زده نمی‌شود؛ برای تغییرش به «تنظیمات ← سیاست تخفیف ← سقف تخفیف فاکتور عمده» بروید.'
        )
    }
  }

  // ---------- ۲) بازه‌ی تخفیف (خالص، بدون نوشتن) ----------
  if (ctx.orderType !== OrderType.WHOLESALE) {
    const policy = await settingsService.discountPolicy()
    const lineDisc = input.lines.reduce((s, l) => s + l.discount, 0)
    const inv = Math.round(input.invoiceDiscount ?? 0)
    const parts =
      `تخفیف ردیف ${money(lineDisc)} ریال، تخفیف کل فاکتور ${money(inv)} ریال` +
      ` و کاهش قیمت زیر قیمت مرجع ${money(reduction)} ریال`
    if (policy.mode === 'OFF') {
      if (lineDisc + inv + reduction > 0)
        throw new BusinessError(`تخفیف در پنل فروش غیرفعال است (سیاست تخفیف: غیرفعال)؛ ${parts} پذیرفته نیست.` + discountRejectTail)
    } else if (policy.mode === 'FIXED') {
      if (lineDisc > 0 || reduction > 0)
        throw new BusinessError(
          `سیاست تخفیف «فقط تخفیف ثابت مدیر» است؛ تخفیف ردیف یا کاهش قیمت کالا مجاز نیست (${parts}).` + discountRejectTail
        )
      const fixed = policy.allowInvoice ? fixedDiscountFor(policy, goods) : 0
      if (inv !== 0 && inv !== fixed)
        throw new BusinessError(
          `سیاست تخفیف «فقط تخفیف ثابت مدیر» است؛ تخفیف کل فاکتور فقط صفر یا دقیقاً ${money(fixed)} ریال` +
            `${policy.fixedMode === 'PERCENT' ? ` (${faDigits(policy.fixedValue)}٪ از ${money(goods)} ریال)` : ''} مجاز است، ` +
            `نه ${money(inv)} ریال.` + discountRejectTail
        )
    } else {
      if (!policy.allowLine && (lineDisc > 0 || reduction > 0))
        throw new BusinessError(`تخفیف روی خودِ کالا (ردیف یا کاهش قیمت) در سیاست تخفیف بسته است (${parts}).` + discountRejectTail)
      if (!policy.allowInvoice && inv > 0)
        throw new BusinessError(`تخفیف کل فاکتور در سیاست تخفیف بسته است؛ تخفیف ${money(inv)} ریال پذیرفته نیست.` + discountRejectTail)
      const total = lineDisc + inv + reduction
      const ceiling = discountCeilingFor(policy, base)
      if (total > ceiling)
        throw new BusinessError(
          `جمع تخفیف این فاکتور ${money(total)} ریال است (${parts}) و از سقف مجاز ${money(ceiling)} ریال بیشتر است ` +
            `(سقف: ${faDigits(policy.maxPercent)}٪ از ${money(base)} ریال` +
            `${policy.maxAmount > 0 ? ` و حداکثر ${money(policy.maxAmount)} ریال` : ''}).` + discountRejectTail
        )
    }
  }

  // ---------- ۳) رمز مدیر (آخر از همه) ----------
  const gateOn = (await settingsService.accountingPolicy()).requireManagerForPriceOverride !== false
  const decreases = overrides.filter((o) => o.enteredPrice < o.refPrice)
  let managerApproved = false
  if (decreases.length && gateOn) {
    await assertManagerPassword(
      (input as any).managerPassword ?? null,
      'قیمت کمتر از قیمت مرجع (' +
        decreases
          .map((o) => `کد ${o.code}: واردشده ${money(o.enteredPrice)} ریال، مرجع ${money(o.refPrice)} ریال`)
          .join(' · ') +
        ')'
    )
    managerApproved = true
  }
  return { managerApproved, gateOn, overrides }
}

/** Audit SALE_PRICE_OVERRIDE داخل همان تراکنش ثبت/ویرایش فاکتور (قالب EXCHANGE_PRICE_OVERRIDE). */
async function writeSalePriceOverrideAudit(
  tx: Prisma.TransactionClient,
  input: { invoiceId: number; receiptNo: number; userId: number | null; what: string; check: SalePricingCheck }
): Promise<void> {
  const { overrides, managerApproved } = input.check
  if (!overrides.length) return
  const modeOf = (o: SalePriceOverride) =>
    o.enteredPrice > o.refPrice ? 'افزایش، بدون رمز' : managerApproved ? 'کاهش با تایید رمز مدیر' : 'کاهش، گیت خاموش'
  await audit(tx, {
    action: AuditAction.SALE_PRICE_OVERRIDE,
    entity: 'SaleInvoice',
    entityId: input.invoiceId,
    userId: input.userId,
    before: JSON.stringify(
      overrides.map((o) => ({ variantId: o.variantId, code: o.code, qty: o.qty, price: o.refPrice, source: o.source }))
    ),
    after: JSON.stringify(overrides.map((o) => ({ variantId: o.variantId, code: o.code, qty: o.qty, price: o.enteredPrice }))),
    note:
      `قیمت دستی در ${input.what} فیش ${faDigits(input.receiptNo)}: ` +
      overrides
        .map(
          (o) =>
            `کد ${o.code}: مرجع ${money(o.refPrice)} ← واردشده ${money(o.enteredPrice)} ریال (${modeOf(o)}${o.source === 'INVOICE' ? '، مرجع فاکتور اصلی' : ''})`
        )
        .join(' · ')
  })
}

/**
 * ===========================================================================
 * نشست ۱۵۶ (S151-c2، Y8، بند ۴-۴۵) — بازمحاسبه‌ی عوارض/حق سرویس در main.
 *
 * قبلاً tax ردیف‌ها، invoiceTax و serviceCharge همان‌طور که رندرر فرستاده بود ثبت می‌شد
 * (عوارض ۰ برای کالای ۱۰٪ یا categoryId جعلی = مسیر دوم کم‌ثبتی). حالا مبلغ خودکار با
 * همان تابع مشترک `computeCharges` و از روی تنظیمات همین اسکوپ + دسته‌ی واقعی کالا در
 * دیتابیس حساب و با عدد رندرر مقایسه می‌شود:
 *   - مبنای درصد = مبلغ ردیف بعد از تخفیف ردیف و سهم نسبی تخفیف کل فاکتور (همان فرمول
 *     Pos.tsx و SalesInvoice.tsx)؛ تحمل گرد = ۱ ریال برای هر ردیف (S156-D3).
 *   - خرده (pos): عوارض فقط روی ردیف‌ها، invoiceTax = ۰، هر ردیف و حق سرویس باید با
 *     مبلغ خودکار بخواند؛ UI راه دستی ندارد ⇒ هر اختلاف رد کامل، با رمز مدیر هم باز نمی‌شود.
 *   - عمده (wholesale): عوارض فقط در سطح فاکتور (tax ردیف = ۰). مبلغ دستیِ کمتر از خودکار
 *     = کم‌ثبتی ⇒ رمز مدیر؛ بیشتر ⇒ بی‌رمز؛ هر دو با Audit SALE_CHARGE_OVERRIDE.
 *   - ویرایش: اگر عوارض و حق سرویس دقیقاً همان مقدار ذخیره‌شده‌ی خودِ فاکتور باشد، سند
 *     تاریخی با نرخ روز بازمحاسبه نمی‌شود (S156-D4).
 * بیرون از تراکنش (رمز مدیر روی AuthLockout می‌نویسد).
 * ===========================================================================
 */
/**
 * نشست ۱۵۸ (Y16) — بدنه‌ی محاسبه‌ی خودکار عوارض/حق سرویس، جداشده از preverifySaleCharges
 * بدون تغییر رفتار فروش تا تعویض (preverifyExchangeCharges) هم دقیقاً همان عدد را بسازد.
 * تنظیمات همین اسکوپ + دسته‌ی واقعی کالا در دیتابیس؛ مبنای درصد = مبلغ ردیف بعد از تخفیف
 * ردیف و سهم نسبی تخفیف کل فاکتور (همان فرمول Pos.tsx / SalesInvoice.tsx / SalesReturn.tsx).
 */
async function autoSaleCharges(
  lines: { variantId: number; unitPrice: number; qty: number; discount: number }[],
  invoiceDiscount: number | null | undefined,
  scope: 'pos' | 'wholesale'
): Promise<ChargeBreakdown> {
  const [taxCfg, serviceCfg] = await Promise.all([
    settingsService.charge('tax', scope),
    settingsService.charge('service', scope)
  ])
  const categories = (await prisma.category.findMany({ select: { id: true, parentId: true } } as any)).map((c: any) => ({
    id: Number(c.id),
    parentId: c.parentId == null ? null : Number(c.parentId)
  }))
  const variantRows = await loadProductVariantsByIds(prisma, new Set(lines.map((l) => l.variantId)), {
    id: true,
    productId: true
  })
  const productIds = [...new Set(variantRows.map((v) => Number(v.productId)).filter(Boolean))]
  const catOfProduct = new Map<number, number | null>()
  for (const chunk of reportIdChunks(productIds))
    for (const p of await prisma.product.findMany({ where: { id: { in: chunk } }, select: { id: true, categoryId: true } } as any))
      catOfProduct.set(Number((p as any).id), (p as any).categoryId == null ? null : Number((p as any).categoryId))
  const catOfVariant = new Map<number, number | null>()
  for (const v of variantRows) catOfVariant.set(Number(v.id), catOfProduct.get(Number(v.productId)) ?? null)

  const afterLine = lines.map((l) => l.unitPrice * l.qty - l.discount)
  const base = afterLine.reduce((s, n) => s + Math.max(0, n), 0)
  const invDisc = Math.max(0, Math.round(Number(invoiceDiscount ?? 0)))
  const share = base > 0 ? Math.min(1, invDisc / base) : 0
  return computeCharges(
    taxCfg,
    serviceCfg,
    categories,
    lines.map((l, i) => ({
      categoryId: catOfVariant.get(l.variantId) ?? null,
      lineNet: Math.max(0, Math.round(afterLine[i] * (1 - share))),
      qty: l.qty
    }))
  )
}

/**
 * ===========================================================================
 * نشست ۱۵۸ (Y16، S158-D2) — عوارض/حق سرویس کالای جایگزین تعویض از تنظیمات، نه از IPC.
 * تعویض = برگشت + فروش تازه (بند ۴-۱۰)؛ کانال = کانال فاکتور اصلی (بند ۴-۲۱).
 *   - خرده: tax هر ردیف اگر فرستاده شده باید ±۱ ریال با خودکار بخواند، وگرنه خودکار؛
 *     invoiceTax غیرصفر ⇒ رد.
 *   - عمده: tax ردیف غیرصفر ⇒ رد؛ invoiceTax فرستاده‌شده ±تعداد ردیف، وگرنه خودکار.
 *   - serviceCharge فرستاده‌شده ±تعداد ردیف، وگرنه خودکار.
 * هر اختلاف ⇒ رد فارسی با مبلغ و واحد؛ با رمز مدیر هم باز نمی‌شود (صفحه‌ی تعویض راه دستی ندارد).
 * خروجی همان عددهایی است که داخل تراکنش ثبت می‌شود (نه ورودی خام).
 * ===========================================================================
 */
async function preverifyExchangeCharges(
  lines: { variantId: number; name: string; unitPrice: number; qty: number; discount: number; tax: number | null }[],
  sent: { invoiceDiscount?: number | null; invoiceTax?: number | null; serviceCharge?: number | null },
  scope: 'pos' | 'wholesale'
): Promise<{ taxPerLine: number[]; invoiceTax: number; serviceCharge: number }> {
  const auto = await autoSaleCharges(lines, sent.invoiceDiscount, scope)
  const tol = Math.max(1, lines.length)
  const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t
  const who = scope === 'pos' ? 'تعویض فاکتور خرده (پنل فروش)' : 'تعویض فاکتور عمده'
  const tail =
    ' مبلغ عوارض و حق سرویس کالای جایگزین را برنامه از «تنظیمات عوارض/حق سرویس» همان کانال فاکتور اصلی و دسته‌ی کالا' +
    ' حساب می‌کند؛ در تعویض عوارض دستی ممکن نیست و با رمز مدیر هم باز نمی‌شود. صفحه را تازه کنید و دوباره ثبت کنید.'
  const sentInvoiceTax = sent.invoiceTax == null ? null : Math.round(Number(sent.invoiceTax))
  const sentService = sent.serviceCharge == null ? null : Math.round(Number(sent.serviceCharge))

  let taxPerLine: number[]
  let invoiceTax: number
  if (scope === 'pos') {
    if (sentInvoiceTax != null && sentInvoiceTax !== 0)
      throw new BusinessError(
        `در ${who} عوارض فقط روی ردیف کالا ثبت می‌شود؛ عوارض سطح فاکتور ${money(sentInvoiceTax)} ریال پذیرفته نیست.` + tail
      )
    taxPerLine = lines.map((l, i) => {
      if (l.tax == null) return auto.taxPerLine[i]
      const t = Math.round(Number(l.tax))
      if (!near(t, auto.taxPerLine[i], 1))
        throw new BusinessError(
          `عوارض و مالیات کالای جایگزین «${l.name || faDigits(l.variantId)}» باید ${money(auto.taxPerLine[i])} ریال باشد، ` +
            `نه ${money(t)} ریال (${who}).` + tail
        )
      return t
    })
    invoiceTax = 0
  } else {
    const lineTaxSum = lines.reduce((s, l) => s + Math.round(Number(l.tax ?? 0)), 0)
    if (lineTaxSum !== 0)
      throw new BusinessError(
        `در ${who} عوارض فقط در سطح فاکتور ثبت می‌شود؛ عوارض روی ردیف کالای جایگزین (${money(lineTaxSum)} ریال) پذیرفته نیست.` + tail
      )
    taxPerLine = lines.map(() => 0)
    if (sentInvoiceTax != null && !near(sentInvoiceTax, auto.taxTotal, tol))
      throw new BusinessError(
        `عوارض و مالیات سند تعویض باید ${money(auto.taxTotal)} ریال باشد، نه ${money(sentInvoiceTax)} ریال (${who}).` + tail
      )
    invoiceTax = sentInvoiceTax ?? auto.taxTotal
  }
  if (sentService != null && !near(sentService, auto.serviceTotal, tol))
    throw new BusinessError(
      `حق سرویس سند تعویض باید ${money(auto.serviceTotal)} ریال باشد، نه ${money(sentService)} ریال (${who}).` + tail
    )
  const serviceCharge = sentService ?? auto.serviceTotal
  return { taxPerLine, invoiceTax, serviceCharge }
}

/**
 * نشست ۱۵۸ (Y14/Y16، بند ۴-۲۱) — کانال واقعی یک فاکتور برای قیمت‌گذاری کالای جایگزین:
 * اگر خودش سند تعویض است، زنجیره‌ی sourceInvoiceId تا اولین فاکتور غیرتعویضی دنبال می‌شود.
 * WHOLESALE ⇒ عمده؛ بقیه ⇒ خرده.
 */
async function exchangeChannelOf(client: Client, invoiceId: number): Promise<'pos' | 'wholesale'> {
  let id: number | null = invoiceId
  const seen = new Set<number>()
  while (id != null && !seen.has(id) && seen.size < 50) {
    seen.add(id)
    const inv: any = await client.saleInvoice.findUnique({
      where: { id },
      select: { orderType: true, sourceInvoiceId: true }
    } as any)
    if (!inv) return 'pos'
    if (inv.orderType !== OrderType.EXCHANGE) return inv.orderType === OrderType.WHOLESALE ? 'wholesale' : 'pos'
    id = inv.sourceInvoiceId == null ? null : Number(inv.sourceInvoiceId)
  }
  return 'pos'
}

interface SaleChargeCheck {
  managerApproved: boolean
  override: null | { autoTax: number; autoService: number; tax: number; service: number; scope: 'pos' | 'wholesale' }
}

async function preverifySaleCharges(
  input: CreateSaleInput,
  ctx: {
    orderType: string
    existing?: { taxTotal: number; serviceCharge: number; historicalBasisUnchanged?: boolean } | null
    alreadyVerified?: boolean
  }
): Promise<SaleChargeCheck> {
  const scope: 'pos' | 'wholesale' = ctx.orderType === OrderType.WHOLESALE ? 'wholesale' : 'pos'
  const lines = input.lines ?? []
  const lineTaxes = lines.map((l) => Math.round(Number(l.tax ?? 0)))
  const invoiceTax = Math.round(Number(input.invoiceTax ?? 0))
  const service = Math.round(Number(input.serviceCharge ?? 0))
  const tax = lineTaxes.reduce((s, n) => s + n, 0) + invoiceTax

  const auto = await autoSaleCharges(lines, input.invoiceDiscount, scope)
  const tol = Math.max(1, lines.length)
  const near = (a: number, b: number, t: number) => Math.abs(a - b) <= t

  // ---------- ویرایش بدون تغییر عوارض ⇒ سند تاریخی دست‌نخورده ----------
  // فقط «همان» سبد/تخفیف/کانالِ سند می‌تواند نرخ تاریخی را نگه دارد. مقایسه‌ی
  // صرف جمع عوارض یک میان‌بر ناامن بود: با تعویض کالا به دسته‌ی مشمول مالیات
  // و فرستادن صفر قبلی، بازمحاسبه کاملاً دور زده می‌شد.
  if (
    ctx.existing?.historicalBasisUnchanged === true &&
    tax === Math.round(Number(ctx.existing.taxTotal ?? 0)) &&
    service === Math.round(Number(ctx.existing.serviceCharge ?? 0))
  )
    return { managerApproved: false, override: null }

  const who = scope === 'pos' ? 'پنل فروش (خرده)' : 'فاکتور فروش عمده'
  const tail =
    ' مبلغ عوارض و حق سرویس را برنامه از «تنظیمات عوارض/حق سرویس» همین پنل و دسته‌ی کالا حساب می‌کند؛' +
    ' صفحه را تازه کنید تا تنظیمات جدید خوانده شود و دوباره ثبت کنید.'

  if (scope === 'pos') {
    if (invoiceTax !== 0)
      throw new BusinessError(
        `در ${who} عوارض فقط روی ردیف کالا ثبت می‌شود؛ عوارض سطح فاکتور ${money(invoiceTax)} ریال پذیرفته نیست.` + tail
      )
    lines.forEach((l, i) => {
      if (!near(lineTaxes[i], auto.taxPerLine[i], 1))
        throw new BusinessError(
          `عوارض و مالیات کالای «${l.name || l.code || faDigits(l.variantId)}» باید ${money(auto.taxPerLine[i])} ریال باشد، ` +
            `نه ${money(lineTaxes[i])} ریال. در ${who} عوارض دستی ممکن نیست و با رمز مدیر هم باز نمی‌شود.` + tail
        )
    })
    if (!near(service, auto.serviceTotal, tol))
      throw new BusinessError(
        `حق سرویس این فاکتور باید ${money(auto.serviceTotal)} ریال باشد، نه ${money(service)} ریال. ` +
          `در ${who} حق سرویس دستی ممکن نیست و با رمز مدیر هم باز نمی‌شود.` + tail
      )
    return { managerApproved: false, override: null }
  }

  // ---------- عمده ----------
  const lineTaxSum = lineTaxes.reduce((s, n) => s + n, 0)
  if (lineTaxSum !== 0)
    throw new BusinessError(
      `در ${who} عوارض فقط در سطح فاکتور ثبت می‌شود؛ عوارض روی ردیف کالا (${money(lineTaxSum)} ریال) پذیرفته نیست.` + tail
    )
  const taxOk = near(tax, auto.taxTotal, tol)
  const serviceOk = near(service, auto.serviceTotal, tol)
  if (taxOk && serviceOk) return { managerApproved: false, override: null }
  const decreases: string[] = []
  if (!taxOk && tax < auto.taxTotal) decreases.push(`عوارض و مالیات ${money(tax)} ریال به‌جای ${money(auto.taxTotal)} ریال`)
  if (!serviceOk && service < auto.serviceTotal)
    decreases.push(`حق سرویس ${money(service)} ریال به‌جای ${money(auto.serviceTotal)} ریال`)
  let managerApproved = false
  if (decreases.length && !ctx.alreadyVerified) {
    await assertManagerPassword(
      (input as any).managerPassword ?? null,
      `کمتر از مبلغ خودکار در ${who} (${decreases.join(' · ')})`
    )
    managerApproved = true
  }
  return {
    managerApproved,
    override: { autoTax: auto.taxTotal, autoService: auto.serviceTotal, tax, service, scope }
  }
}

/** Audit SALE_CHARGE_OVERRIDE داخل همان تراکنش ثبت/ویرایش فاکتور عمده. */
async function writeSaleChargeOverrideAudit(
  tx: Prisma.TransactionClient,
  input: { invoiceId: number; receiptNo: number; userId: number | null; what: string; check: SaleChargeCheck; approved: boolean }
): Promise<void> {
  const o = input.check.override
  if (!o) return
  const mode = (entered: number, autoV: number) =>
    entered > autoV ? 'افزایش، بدون رمز' : entered < autoV ? (input.approved ? 'کاهش با تایید رمز مدیر' : 'کاهش') : 'بدون تغییر'
  await audit(tx, {
    action: AuditAction.SALE_CHARGE_OVERRIDE,
    entity: 'SaleInvoice',
    entityId: input.invoiceId,
    userId: input.userId,
    before: JSON.stringify({ tax: o.autoTax, service: o.autoService, source: 'AUTO', scope: o.scope }),
    after: JSON.stringify({ tax: o.tax, service: o.service }),
    note:
      `عوارض/حق سرویس دستی در ${input.what} فیش ${faDigits(input.receiptNo)}: ` +
      `عوارض خودکار ${money(o.autoTax)} ← واردشده ${money(o.tax)} ریال (${mode(o.tax, o.autoTax)}) · ` +
      `حق سرویس خودکار ${money(o.autoService)} ← واردشده ${money(o.service)} ریال (${mode(o.service, o.autoService)})`
  })
}

/** خام و فقط در main: برای ساخت/چاپ همان سند اعتبار، نه پاسخ IPC. */
export interface OverpayCreditResult {
  id: number
  code: string
  amount: number
  expiresAtJalali: string | null
  notice: string
  invoiceId: number
  receiptNo: number
}

/** پاسخ امن عملیات فروش برای اعتبار اضافه‌دریافت. */
export type OverpayCreditSafeResult = Omit<OverpayCreditResult, 'code'> & { publicReference: string }

async function issueOverpayCreditTx(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: number
    amount: number
    paymentId?: number | null
    paymentSeq?: number | null
    userId?: number | null
    /**
     * نشست ۶۲ (S62-2) — رمز مدیر *قبل از* تراکنش با `preverifyOverpayManager`
     * سنجیده می‌شود؛ اینجا فقط نتیجه‌اش می‌رسد. دلیل: `assertManagerPassword`
     * روی AuthLockout با کلاینت سراسری می‌نویسد و نوشتن وسط تراکنش باز روی
     * SQLite تک‌نویسنده همان بن‌بست شناخته‌شده است.
     */
    managerApproved?: boolean
    /**
     * نشست ۳۱۶ — وقتی اعتبار از مسیر «برگشت» صادر می‌شود، شناسه‌ی سند برگشت
     * این‌جا سوار می‌شود تا (۱) رسید برگشت آن را ببیند و (۲) ابطال سند برگشت
     * اعتبار را هم خودکار باطل کند (تا امروز تصویرِ دوم سوراخ پول می‌ساخت).
     */
    returnId?: number | null
  }
): Promise<OverpayCreditResult> {
  const amount = Math.round(Number(input.amount))
  if (!Number.isFinite(amount) || amount <= 0)
    throw new BusinessError('مبلغ اعتبار از اضافه‌دریافت باید عدد صحیح بزرگ‌تر از صفر (ریال) باشد.')
  const inv = await tx.saleInvoice.findUnique({
    where: { id: input.invoiceId },
    select: { id: true, receiptNo: true, customerId: true, status: true, customer: { select: { name: true } } }
  })
  if (!inv) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد.')
  if (inv.status === SaleStatus.DRAFT || inv.status === SaleStatus.CANCELED)
    throw new BusinessError('روی فاکتور پیش‌نویس یا لغوشده اعتبار خرید صادر نمی‌شود.')
  const b = await overpayCreditBacking(tx, inv.id)
  if (amount > b.available)
    throw new BusinessError(
      `صدور اعتبار ${money(amount)} ریالی ممکن نیست: اضافه‌دریافتِ آزاد فاکتور ${faDigits(inv.receiptNo)} ` +
        `${money(b.available)} ریال است (اضافه‌دریافت واقعی ${money(b.realOverpay)} ریال` +
        (b.committed > 0 ? `، قبلاً ${money(b.committed)} ریال اعتبار از آن صادر شده` : '') +
        ').\nاعتبار خرید فقط از پولی صادر می‌شود که واقعاً بیشتر از بدهی دریافت شده است.'
    )
  /** همان سقف بند ۱۸ مسیر تعویض: بالاتر از سقف تنظیمات فقط با رمز مدیر (S61-4) */
  const policy = await settingsService.accountingPolicy()
  if (policy.storeCreditLimit > 0 && amount > policy.storeCreditLimit) {
    if (input.managerApproved !== true)
      throw new BusinessError(
        `«صدور اعتبار ${money(amount)} ریالی از اضافه‌دریافت (بالاتر از سقف ${money(policy.storeCreditLimit)} ریال)» ` +
          'تایید مدیر لازم دارد. رمز مدیر را وارد کنید.'
      )
    await audit(tx, {
      action: AuditAction.STORE_CREDIT_OVER_LIMIT,
      entity: 'SaleInvoice',
      entityId: inv.id,
      userId: input.userId ?? null,
      after: JSON.stringify({ amount, limit: policy.storeCreditLimit, source: CreditSource.OVERPAY }),
      note: `صدور اعتبار اضافه‌دریافت بالاتر از سقف، با تایید مدیر · ${money(amount)} ریال (سقف ${money(policy.storeCreditLimit)})`
    })
  }
  const defaults = await saleDefaultsWith(tx)
  const now = new Date()
  const credit = await issueStoreCredit(tx, {
    amount,
    source: CreditSource.OVERPAY,
    sourceInvoiceId: inv.id,
    // نشست ۳۱۶ — لینک به سند برگشت وقتی اعتبار از آن مسیر صادر شده
    returnId: input.returnId ?? null,
    customerId: inv.customerId ?? null,
    customerName: (inv as any).customer?.name ?? null,
    days: exchangeCreditDays({
      explicit: undefined,
      exchangeDays: (await readCreditSettings(tx)).types.EXCHANGE.days,
      returnCodeDays: defaults.returnCodeDays
    }),
    length: defaults.returnCodeLength,
    note:
      `اعتبار از مبلغ اضافه‌ی دریافتی (اضافه‌دریافت) · فاکتور ${faDigits(inv.receiptNo)}` +
      (input.paymentSeq ? ` · پرداختی ${faDigits(input.paymentSeq)}` : '') +
      ' · غیرقابل نقد شدن',
    userId: input.userId ?? null,
    issuedAt: now
  })
  await audit(tx, {
    action: AuditAction.STORE_CREDIT_ISSUE,
    entity: 'StoreCredit',
    entityId: credit.id,
    userId: input.userId ?? null,
    after: JSON.stringify({
      creditId: credit.id, amount, source: CreditSource.OVERPAY, invoiceId: inv.id, receiptNo: inv.receiptNo,
      paymentId: input.paymentId ?? null, realOverpay: b.realOverpay, committedBefore: b.committed
    }),
    note:
      `صدور اعتبار #${credit.id} به مبلغ ${money(amount)} ریال از اضافه‌دریافت فاکتور ${faDigits(inv.receiptNo)}` +
      (input.paymentSeq ? ` (پرداختی ${faDigits(input.paymentSeq)})` : '') +
      ` · پشتوانه: پول واقعاً دریافت‌شده · آزاد قبل از صدور ${money(b.available)} ریال · غیرقابل نقد شدن`
  })
  return {
    id: credit.id,
    code: credit.code,
    amount,
    expiresAtJalali: credit.expiresAtJalali ?? null,
    notice: OVERPAY_CREDIT_NOTICE,
    invoiceId: inv.id,
    receiptNo: inv.receiptNo
  }
}

/** اختلاف روز بین «امروز» و یک تاریخ (مثبت = آینده، منفی = گذشته). */
function daysUntil(target: Date | null | undefined): number | null {
  if (!target) return null
  const t = target instanceof Date ? target : new Date(target)
  if (Number.isNaN(t.getTime())) return null
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return Math.round((startOfDay(t) - startOfDay(new Date())) / DAY_MS)
}

/** یک رکورد Payment → ردیف نمایشی تاریخچه‌ی پرداختی‌ها. */
function shapePaymentRow(p: any): InvoicePaymentRow {
  const paidAt = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)
  const kind = (p.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE ? 'CHEQUE' : 'CASH'
  const status = kind === 'CHEQUE' ? (p.chequeStatus ?? ChequeStatus.PENDING) : null
  /**
   * Paymentهای تسویه با اعتبار ممکن است در داده‌های تاریخی reference/noteای
   * داشته باشند که کد قابل‌مصرف را تکرار کرده است. نمای استاندارد پرداختی‌ها
   * برای کاربر عادی یک مسیر گزارش است، نه مسیر reveal؛ پس پیش از ساخت DTO آن
   * دو متن redacted می‌شوند. افشای مدیر فقط از IPC اختصاصی اعتبار انجام می‌شود.
   */
  const isStoreCredit = (p.method?.kind ?? '') === 'STORE_CREDIT' || p.storeCreditId != null
  const chequeHistoryText =
    Array.isArray(p.chequeStatusHistory) && p.chequeStatusHistory.length
      ? p.chequeStatusHistory
          .map((h: any) => {
            const hStatus = CHEQUE_STATUS_LABELS[String(h.status ?? '')] ?? String(h.status ?? 'وضعیت نامشخص')
            const hDate =
              h.clearedAtJalali ??
              h.changedAtJalali ??
              (h.changedAt ? toJalaliDate(new Date(h.changedAt)) : '—')
            return `${hStatus} در ${hDate}`
          })
          .join(' ← ')
      : null
  return {
    id: p.id,
    seq: p.seq ?? 1,
    kind,
    amount: toNumberRial(p.amount),
    methodId: p.methodId,
    methodLabel: isStoreCredit ? 'تسویه با اعتبار خرید' : (p.method?.label ?? (kind === 'CHEQUE' ? 'چک' : 'پرداخت')),
    reference: isStoreCredit ? null : (p.reference ?? null),
    note: isStoreCredit ? null : (p.note ?? null),
    dateJalali: p.paidAtJalali || toJalaliDate(paidAt),
    time: p.paidAtTime || toClock(paidAt),
    chequeNo: p.chequeNo ?? null,
    bankName: p.bankName ?? null,
    dueDateJalali: p.dueDateJalali ?? (p.dueDate ? toJalaliDate(new Date(p.dueDate)) : null),
    chequeStatus: status,
    chequeStatusLabel: status ? (CHEQUE_STATUS_LABELS[status] ?? status) : null,
    clearedAtJalali: p.clearedAtJalali ?? (p.clearedAt ? toJalaliDate(new Date(p.clearedAt)) : null),
    dueInDays: kind === 'CHEQUE' ? daysUntil(p.dueDate) : null,
    counted: isReceivedPayment(p),
    createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
    createdByUserId: p.createdByUserId ?? null,
    createdShiftId: p.createdShiftId ?? null,
    clearedShiftId: p.clearedShiftId ?? null,
    // بخش ۸: «مبلغ اضافه‌ی دریافتی» همان لحظه‌ی ثبت حساب و روی همین رکورد ذخیره شده
    overpayAmount: Math.max(0, toNumberRial(p.overpayAmount ?? 0)),
    // بخش ۶: این ردیف مصرف اعتبار خرید است؟ (پول نقد نیست؛ کد هرگز در DTO نیست)
    isStoreCredit,
    // ---- کار الف (جلسه ۳۶): مقصد پول ----
    destination: normalizePaymentDestination(p.destination),
    destinationLabel: paymentDestinationLabel(p.destination),
    reachedStore: destinationReachedStore(p.destination),
    chequeHistoryText
  }
}

/**
 * ===========================================================================
 * کار الف (جلسه ۳۶) — اعتبارسنجی «مقصد پول» در لحظه‌ی نوشتن.
 *
 * تنها جایی که مقصد وارد دیتابیس می‌شود همین تابع است، پس قاعده‌ی «یک منبع
 * حقیقت» شکستنی نیست:
 *   • مقصد **اجباری** است و پیش‌فرض ندارد (نه در UI و نه در سرور).
 *   • با `kind` روش پرداخت سازگار است: روش نقدی ⇒ فقط نقد در صندوق (نشست ۱۵۹، Y15، بند ۴-۱۳)، روش کارت ⇒
 *     کارت یا حساب مدیر. پس هرگز یک ردیف با «روش = نقدی، مقصد = کارت» ساخته
 *     نمی‌شود که دو گزارش دو عدد متفاوت بدهند.
 *   • چک مسیر جدا دارد و فقط به حساب مدیر/بانک می‌رود؛ روش‌های CUSTOM/CREDIT
 *     غیرچکی هر سه مقصد را می‌پذیرند.
 * ===========================================================================
 */
function assertDestination(
  raw: unknown,
  methodKind: string | null | undefined,
  context: 'CHEQUE_CLEAR' | 'PAYMENT'
): PaymentDestination {
  const chosen = normalizePaymentDestination(raw)
  const allowed = context === 'CHEQUE_CLEAR' ? allowedChequeDestinations() : allowedDestinationsFor(methodKind)
  if (!chosen)
    throw new BusinessError(
      (context === 'CHEQUE_CLEAR'
        ? 'برای «پاس شد» زدن این چک، مقصد پول را انتخاب کنید: '
        : 'برای ثبت این پرداختی، مقصد پول را انتخاب کنید: ') +
        allowed.map((d) => `«${PAYMENT_DESTINATION_LABELS[d]}»`).join(' یا ') +
        '.\nاین کادر پیش‌فرض ندارد، چون اگر اشتباه ثبت شود هنگام بستن صندوق کسری یا اضافه‌ی بی‌دلیل ساخته می‌شود.'
    )
  // نشست ۱۵۸ (Y15، بند ۴-۱۳) — پیام راه درست برای نقدِ دریافتی مدیر
  if (context === 'PAYMENT' && methodKind === PaymentKind.CASH && chosen === PaymentDestination.MANAGER)
    throw new BusinessError(
      `پول نقد نمی‌تواند مستقیماً به «${PAYMENT_DESTINATION_LABELS[PaymentDestination.MANAGER]}» برود؛ مقصد پول نقد فقط ` +
        `«${PAYMENT_DESTINATION_LABELS[PaymentDestination.CASH]}» است. اگر مدیر خودش پول نقد را گرفته، اول آن را با مقصد ` +
        `«${PAYMENT_DESTINATION_LABELS[PaymentDestination.CASH]}» ثبت کنید و سپس با «برداشت از صندوق» (رمز مدیر و دلیل اجباری) ` +
        'از صندوق خارج کنید تا نقد مورد انتظار کشو و کسری/اضافی درست بماند.'
    )
  if (!allowed.includes(chosen))
    throw new BusinessError(
      `مقصد «${PAYMENT_DESTINATION_LABELS[chosen]}» با روش پرداخت انتخاب‌شده سازگار نیست. ` +
        `برای این روش پرداخت فقط ${allowed.map((d) => `«${PAYMENT_DESTINATION_LABELS[d]}»`).join(' یا ')} ممکن است.`
    )
  return chosen
}

/** `kind` روش پرداخت یک شناسه (برای اعتبارسنجی مقصد). */
async function methodKindOf(tx: Prisma.TransactionClient, methodId: number): Promise<string | null> {
  const m = await tx.paymentMethod.findUnique({ where: { id: methodId }, select: { kind: true } })
  return m?.kind ?? null
}

/**
 * نشست ۱۴۲ (S142) — روش پرداختِ ارسالی renderer باید واقعاً وجود داشته باشد.
 * قبلاً شناسه‌ی ناموجود بی‌سنجش روی Payment می‌نشست (در Prisma واقعی خطای فنی
 * کلید خارجی، در harness ردیف یتیم) و سبد دریافتی گزارش را نامعلوم می‌کرد.
 */
async function assertPaymentMethodExists(tx: Prisma.TransactionClient, methodId: number): Promise<void> {
  const m = await tx.paymentMethod.findUnique({ where: { id: methodId }, select: { id: true, kind: true, key: true } })
  if (!m)
    throw new BusinessError(
      `روش پرداخت انتخاب‌شده (شناسه ${faDigits(methodId)}) پیدا نشد؛ فهرست روش‌های پرداخت را تازه کنید و دوباره انتخاب کنید.`
    )
  /**
   * AUDIT-S142-04 (AUDIT-D74) — روش سیستمی «چک» (kind=CUSTOM) فقط از فرم ثبت چک (kind=CHEQUE، با سررسید و
   * چرخه‌ی پاس) ساخته می‌شود. قبلاً از مسیر عمومی پذیرفته می‌شد و چون CUSTOM همه‌ی مقصدها را مجاز می‌داند:
   * «چک ۵۰۰٬۰۰۰ · نقد در کشو» (خلاف بند ۴-۱۲) یا ویرایش نقدی ۵۰۰٬۰۰۰ به «چک · حساب مدیر» (نقد از انتظار کشو محو).
   * همان قاعده‌ی initialPaymentRows.
   */
  if (m.key === CHEQUE_METHOD_KEY)
    throw new BusinessError(
      'چک فقط از فرم «ثبت چک» (با شماره، سررسید و وضعیت «در جریان») ثبت می‌شود و مقصدش بعد از پاس‌شدن فقط حساب مدیر/بانک است؛ ' +
        'روش «چک» را نمی‌توان برای پرداخت نقدی/کارتی انتخاب کرد یا پرداخت موجود را به آن تغییر داد. هیچ تغییری ذخیره نشد.'
    )
  /**
   * AUDIT-S142-01 (AUDIT-D73) — روش‌های سیستمی اعتبار (STORE_CREDIT / EXCHANGE_CREDIT) پول واقعی نیستند
   * و فقط از مسیر دفتر اعتبار (کد اعتبار در فروش، سند تعویض) ساخته می‌شوند. قبلاً addPayment با همین
   * methodId بی‌کد اعتبار نسیه را تسویه می‌کرد و updatePayment پرداخت نقدی را به اعتبار می‌برد
   * (نقد از «نقد مورد انتظار» کشو محو می‌شد).
   */
  assertNotCreditMethodKind(m.kind)
}

/** AUDIT-S142-01/02 + S335 — پیام واحد رد روش‌های غیرقابل‌ثبت مستقیم در مسیرهای پرداخت عمومی. */
const CREDIT_METHOD_DIRECT_BLOCKED =
  'روش «اعتباری» و اعتبار خرید، پرداختِ مستقیم نیستند: فروش نسیه با ثبت مبلغ کمتر/صفر ساخته می‌شود و ' +
  'مصرف اعتبار خرید فقط با کد اعتبار از پنل فروش ثبت می‌شود. ارزش کالای برگشتی هم فقط از خود سند تعویض ثبت می‌شود. ' +
  'یک روش نقدی، کارتی یا سفارشیِ مجاز انتخاب کنید؛ هیچ تغییری ذخیره نشد.'

/**
 * `PaymentKind.CREDIT` روشِ «فروش نسیه» است، نه پول دریافتی. اگر از راه
 * payments وارد می‌شد، بدون نقد/کارت، فاکتور را تسویه‌شده نشان می‌داد و کنترل
 * صندوق را دور می‌زد. نسیه فقط با پرداختِ کم‌تر از مبلغ فاکتور ثبت می‌شود.
 * دو روش سیستمی دیگر هم فقط از ledger خودشان مجازند.
 */
function assertNotCreditMethodKind(kind: string | null | undefined): void {
  if (kind === PaymentKind.CREDIT || (kind != null && NON_CASH_PAYMENT_KINDS.includes(kind)))
    throw new BusinessError(CREDIT_METHOD_DIRECT_BLOCKED)
}

/** تاریخ شمسی ورودی کاربر → Date (با پیام فارسی روشن در صورت خرابی). */
/**
 * ===========================================================================
 * نشست ۱۳۶ (DECISIONS S136-2) — قفل دوره‌ی بسته برای mutationهای Payment.
 *
 * ثبت پرداخت با تاریخ گذشته، ویرایش مالی پرداخت، ابطال پرداخت و تغییر وضعیت
 * چک، نقد/وجه واقعیِ همان روزی را عوض می‌کنند که پرداخت به آن تعلق دارد. اگر
 * آن روز بسته شده باشد، بدون گیت یعنی کسری صندوقِ بسته را می‌شد با ابطال یک
 * پرداختِ همان روز پنهان کرد. حالا همان الگوی فاکتور/برگشت: رمز مدیر + دلیل
 * بیرون از تراکنش (preverify)، و Audit `CLOSED_PERIOD_OVERRIDE` داخل تراکنش.
 * ===========================================================================
 */
type PaymentPeriodGate = { managerPassword?: string | null; overrideReason?: string | null }

function paymentPeriodMoments(dates: Array<Date | string | number | null | undefined>): Date[] {
  const seen = new Set<number>()
  const out: Date[] = []
  for (const d of dates) {
    if (d == null) continue
    const at = d instanceof Date ? d : new Date(d as any)
    const t = at.getTime()
    if (!Number.isFinite(t) || seen.has(t)) continue
    seen.add(t)
    out.push(at)
  }
  return out
}

async function preverifyPaymentPeriods(moments: Date[], what: string, gate: PaymentPeriodGate): Promise<boolean> {
  let verified = false
  for (const at of moments) {
    const ok = await periodLockService.preverify({
      at,
      what,
      managerPassword: gate.managerPassword ?? null,
      overrideReason: gate.overrideReason ?? null,
      alreadyVerified: verified
    })
    if (ok) verified = true
  }
  return verified
}

async function assertPaymentPeriodsOpen(
  tx: Prisma.TransactionClient,
  moments: Date[],
  ctx: PaymentPeriodGate & {
    what: string
    entityId?: number | null
    userId?: number | null
    managerVerified: boolean
    before?: unknown
    after?: unknown
  }
): Promise<void> {
  for (const at of moments)
    await periodLockService.assertOpen(tx, {
      at,
      what: ctx.what,
      entity: 'Payment',
      entityId: ctx.entityId ?? 0,
      managerPassword: ctx.managerPassword ?? null,
      overrideReason: ctx.overrideReason ?? null,
      userId: ctx.userId ?? null,
      before: ctx.before,
      after: ctx.after,
      managerVerified: ctx.managerVerified
    })
}

/**
 * نشست ۲۱۱ — ویرایش/ابطال مالی پرداخت غیرچک در شیفت باز هم رمز می‌خواهد.
 * بدون این گیت فروشنده نقد را به کارت تبدیل یا مبلغ را کم می‌کند و صندوق
 * بی‌کسری بسته می‌شود. گیت چک پاس‌شده (نشست ۲۰۲) جداست؛ چک در جریان رمز
 * نمی‌خواهد (رگرسیون ۲۰۲). بیرون از تراکنش (SQLite تک‌نویسنده).
 */
async function assertOpenShiftPaymentMutationPassword(
  input: { managerPassword?: string | null; overrideReason?: string | null; reason?: string | null },
  action: string,
  opts: { requireReason: boolean }
): Promise<void> {
  await assertPanelPasswordStrict(PANEL_KEYS.salesCredit, input.managerPassword ?? null, action)
  if (!opts.requireReason) return
  const why = String(input.overrideReason ?? input.reason ?? '').trim()
  if (why.length < 3)
    throw new BusinessError(`برای ${action}، دلیل (حداقل ۳ نویسه) اجباری است.`)
}

/**
 * ممیزی AUDIT-S136-02 (AUDIT-D66) — لحظه‌های گیت از خوانش بیرون از تراکنش ساخته
 * می‌شوند؛ اگر پرداخت/چک هم‌زمان (پنجره‌ی دیگر) به روز بسته رفته باشد، همان
 * لحظه‌های کهنه گیت را بی‌رمز عبور می‌دادند. داخل تراکنش، لحظه‌های ردیف فعلی هم
 * به مجموعه اضافه می‌شوند؛ لحظه‌ی تازه‌ی قفل بدون رمزِ پیش‌تأییدشده با پیام
 * «همین حالا عوض شد» رد می‌شود (assertOpen).
 */
function paymentRowMoments(row: any): Array<Date | null> {
  if (!row) return []
  const isCheque = (row.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
  return [row.paidAt ?? null, isCheque && row.chequeStatus === ChequeStatus.CLEARED ? row.clearedAt ?? null : null]
}

function parseJalaliOrThrow(value: string, label: string): Date {
  if (!isValidJalaliDate(value)) throw new BusinessError(`${label} معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)`)
  return jalaliToDateTime(value)
}

/**
 * نقشه‌ی «چه کالایی و چه تعدادی» با حذف گزارشات یک بازه باید به انبار برگردد.
 *
 * حساب درست: تعداد فروخته‌شده منهای تعدادی که قبلاً با «برگشت از فروش» به انبار
 * برگشته است (وگرنه آن کالاها دو بار به موجودی اضافه می‌شدند). فاکتورهای
 * «بدون کسر از موجودی» هم اصلاً شمرده نمی‌شوند، چون انبار را کم نکرده بودند.
 */
async function purgeStockPlan(
  fromJalali: string,
  toJalali: string,
  invoiceIds?: number[] | null
): Promise<{ plan: SalesPurgeLine[]; returnCount: number; itemCount: number }> {
  const from = jalaliStartOfDay(fromJalali)
  const to = jalaliEndOfDay(toJalali)
  /**
   * حذف تکی/چندتایی (مورد ۱): اگر فهرست فاکتورهای انتخاب‌شده داده شود، نقشه‌ی
   * بازگشت موجودی *فقط* برای همان فاکتورها ساخته می‌شود؛ بازه‌ی تاریخی نقشی
   * ندارد. منطق محاسبه مو‌به‌مو همان قبل است.
   */
  /**
   * ممیزی A85-01 — از S85 پاک‌سازی void است و سند باطل در دیتابیس می‌ماند؛
   * فاکتور باطل/لغوشده نباید دوباره در نقشه‌ی بازگشت موجودی بیاید، وگرنه هر
   * پاک‌سازی تکراری همان کالا را یک بار دیگر به انبار برمی‌گرداند.
   * نشست ۱۷۵ · S175-D2 — فهرست انتخابی در دسته‌های ۵۰۰تایی (سقف IN، S99-2)؛ جمع نقشه جمع‌پذیر است.
   */
  const planGate = {
    voidedAt: null,
    /** ممیزی A122-01 (AUDIT-D59) — همان دروازه‌ی گزارش/پیش‌نمایش: DRAFT هم نه (کالای شبح). */
    status: { notIn: REPORT_EXCLUDED_SALE_STATUSES }
  }
  const planSelect = {
    id: true,
    deductInventory: true,
    items: { select: { variantId: true, qty: true } },
    returns: { where: { voidedAt: null }, select: { id: true, items: { select: { variantId: true, restockedQty: true } } } }
  } as const
  const invoices: any[] = []
  if (invoiceIds?.length) {
    for (const ids of reportIdChunks(invoiceIds))
      invoices.push(...(await prisma.saleInvoice.findMany({ where: { id: { in: ids }, ...planGate }, select: planSelect })))
  } else {
    invoices.push(
      ...(await prisma.saleInvoice.findMany({ where: { issuedAt: { gte: from, lte: to }, ...planGate }, select: planSelect }))
    )
  }

  const net = new Map<number, number>()
  let returnCount = 0
  let itemCount = 0
  for (const inv of invoices) {
    for (const it of inv.items) {
      itemCount++
      if (inv.deductInventory) net.set(it.variantId, (net.get(it.variantId) ?? 0) + it.qty)
    }
    for (const r of inv.returns) {
      returnCount++
      for (const it of r.items) {
        if (it.restockedQty > 0) net.set(it.variantId, (net.get(it.variantId) ?? 0) - it.restockedQty)
      }
    }
  }

  const ids = [...net.entries()].filter(([, qty]) => qty > 0).map(([variantId]) => variantId)
  const variants = await loadProductVariantsByIds(prisma, ids, {
    id: true,
    code: true,
    size: true,
    color: true,
    stock: true,
    product: { select: { name: true, unit: true } }
  })
  const vmap = new Map(variants.map((v) => [v.id, v]))

  const plan: SalesPurgeLine[] = ids.map((variantId) => {
    const v = vmap.get(variantId)
    return {
      variantId,
      code: v?.code ?? '—',
      name: v
        ? `${v.product?.name ?? ''}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
        : 'کالای حذف‌شده از سیستم',
      unit: v?.product?.unit ?? 'عدد',
      qty: net.get(variantId) ?? 0,
      stock: v?.stock ?? 0
    }
  })
  plan.sort((a, b) => b.qty - a.qty)
  return { plan, returnCount, itemCount }
}

/**
 * ===========================================================================
 * جلسه ۱۴ · بند ۱۱ — «روش بازپرداخت» یک برگشت.
 *
 * ================== چرا این تصمیم اجباری است؟ ==================
 * این تنها چیزی است که **کسری واقعی صندوق** را از **کسری کاذب** تفکیک می‌کند:
 *   • برگشت از فاکتور نقدی        ⇒ پول از کشو بیرون می‌رود (کسری واقعی نیست، خرجِ سند است)
 *   • برگشت از فاکتور نسیه‌ی پرداخت‌نشده ⇒ فقط طلب کم می‌شود، هیچ نقدی جابه‌جا نمی‌شود
 * در گزارش قبلی این دو از هم تفکیک‌ناپذیر بودند، پس هر کسری‌ای قابل انکار بود.
 *
 * ================== قواعد سخت ==================
 *   ۱) ثبت برگشت جدید **بدون** `refundMethod` مجاز نیست — خطای فارسی، نه فرض ضمنی.
 *   ۲) `CASH` بیشتر از «پولی که مشتری واقعاً برای این فاکتور داده» مجاز نیست؛
 *      وگرنه می‌شد از یک فاکتور نسیه‌ی پرداخت‌نشده پول نقد از کشو بیرون کشید.
 *   ۳) مبلغ بازپرداخت از مبلغ خودِ برگشت بیشتر نمی‌شود.
 *   ۴) داده‌ی قدیمی دست‌نخورده می‌ماند (`refundMethod = null`) و در گزارش برچسب
 *      «فرض‌شده از داده‌ی قدیمی» می‌گیرد. جعل تاریخ ممنوع.
 * ===========================================================================
 */
function resolveRefund(input: {
  method?: string | null
  requested?: number | null
  returnTotal: number
  /** مبلغ کاملِ بدون کسر تخفیف، فقط بعد از تایید مدیر */
  fullAmount?: number | null
  /** ممیزی A73-01 — دیگر هیچ مسیری true نمی‌فرستد؛ سقف پول دریافتی همیشه برقرار است */
  allowReceivedOverflow?: boolean
  /** فقط برای متن پیام خطا: درخواست override مدیر (بند ۴-۱۱) بوده است */
  fullRefundOverride?: boolean
  /** پولی که واقعاً بابت این فاکتور دریافت شده بود (سقف بازپرداخت نقدی/کارتی) */
  receivedOnInvoice: number
  /** نشست ۵۹ — سقف صدور اعتبار خرید (بند ۴-۳۷)؛ نبودنش = همان receivedOnInvoice */
  receivedForCredit?: number
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۳۷ — بدهیِ باقی‌مانده‌ی همین فاکتور *بعد از* اعمال ارزش
   * این برگشت به‌عنوان کاهش بدهی (نه پیش از برگشت). اگر هنوز بزرگ‌تر از صفر
   * باشد، اعتبار خرید صادر نمی‌شود.
   */
  remainingDebt?: number
  /**
   * نشست ۱۹۴ · بند ۴-۴/۴-۳۷ — سقف خروج نقد/کارت/اعتبار تا جایی که فاکتور دوباره
   * بدهکار نشود: max(0, پول دریافتی − مانده‌ی کالا بعد از برگشت). خالی = همان
   * `receivedOnInvoice` (رفتار قبلیِ صدازننده‌ی قدیمی).
   */
  maxKeepSettled?: number
  receiptNo: number | string
}): { method: string; amount: number; note: string } {
  const method = String(input.method ?? '').toUpperCase()
  /**
   * جلسه ۱۷ · بند ۱ — `CARD_TO_CARD` به فهرست اضافه شد و **هیچ کدام از سه روش
   * قبلی را تغییر نداد**: `CARD` همان تسویه‌ی فوری با کارت‌خوان فروشگاه است.
   */
  const valid: readonly string[] = [
    RefundMethod.CASH,
    RefundMethod.CARD,
    RefundMethod.STORE_CREDIT,
    RefundMethod.CARD_TO_CARD,
    RefundMethod.NONE
  ]
  if (!valid.includes(method))
    throw new BusinessError(
      'برای ثبت برگشت باید «روش بازپرداخت» را صریح انتخاب کنید:\n' +
        '• بازپرداخت نقدی (پول از صندوق بیرون می‌رود)\n' +
        '• بازپرداخت کارتی\n' +
        '• صدور بارکد اعتبار خرید بعدی\n' +
        '• کارت‌به‌کارت توسط مدیر (پرداخت فوری انجام نمی‌شود؛ درخواست پرداخت ثبت می‌گردد)\n' +
        '• بدون بازپرداخت (فقط بدهی مشتری کم می‌شود)\n' +
        'بدون این انتخاب، سیستم نمی‌داند چقدر از صندوق خارج شده و کسری واقعی از کسری کاذب قابل تفکیک نیست.'
    )

  if (method === RefundMethod.NONE) return { method, amount: 0, note: 'بدون بازپرداخت؛ فقط بدهی مشتری کم شد.' }

  const cap = Math.max(0, Math.round(input.fullAmount ?? input.returnTotal))
  const asked = input.requested == null ? cap : Math.max(0, Math.round(Number(input.requested) || 0))
  const keepCap =
    input.maxKeepSettled == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.round(input.maxKeepSettled))
  const payableNow = Math.min(
    cap,
    Number.isFinite(keepCap) ? keepCap : cap,
    Math.max(0, Math.round(input.receivedOnInvoice))
  )
  /**
   * درخواست صریحِ بیشتر از ارزش رسمیِ *همین اقلام برگشتی* نباید مثل گذشته
   * بی‌صدا کوچک شود. «cap» بعد از محاسبه‌ی خط‌های واقعی (و فقط در صورت تایید
   * مدیر، قیمت کامل مجاز) ساخته شده است؛ پس منبع حقیقتِ این سقف است.
   *
   * عمداً فقط cap سنجیده می‌شود، نه keepCap/پولِ قابل‌خروج: آن دو برای
   * تسویه‌ی هوشمندِ نسیه و بازپرداخت‌های قبلی‌اند و کاهشِ آن‌ها نباید درخواست
   * کوچک‌ترِ معتبر را رد کند یا رفتار settled موجود را تغییر دهد.
   */
  if (input.requested != null && asked > cap)
    throw new BusinessError(
      `بازپرداخت یا اعتبارِ درخواستی ${money(asked)} ریال برای فاکتور ${faDigits(input.receiptNo)} ممکن نیست: ` +
        `ارزش رسمی اقلام انتخاب‌شده برای برگشت فقط ${money(cap)} ریال است.\n` +
        'مبلغی تا همین ارزش وارد کنید؛ سقف پول دریافتی و تسویه‌ی بدهی جداگانه و طبق وضعیت فاکتور اعمال می‌شود.'
    )
  /**
   * نشست ۲۰۸ — override بند ۴-۱۱ یا کامل است یا رد می‌شود؛ بی‌صدا به سهم
   * تخفیف‌خورده تقلیل داده نمی‌شود.
   */
  if (input.fullRefundOverride && asked > payableNow)
    throw new BusinessError(
      `بازپرداخت مبلغ کاملِ بدون کسر تخفیف (${money(asked)} ریال) از فاکتور ${faDigits(input.receiptNo)} ممکن نیست: ` +
        `از پول واقعاً دریافت‌شده فقط ${money(payableNow)} ریال مانده است.\\n` +
        'تایید مدیر فقط کسر تخفیف را برمی‌دارد؛ بیشتر از پولی که واقعاً دریافت شده از صندوق/کارت پرداخت نمی‌شود.'
    )
  const amount = Math.min(asked, cap, keepCap)
  if (amount <= 0)
    throw new BusinessError('مبلغ بازپرداخت باید بزرگ‌تر از صفر باشد، یا روش «بدون بازپرداخت» را انتخاب کنید.')

  if (
    (method === RefundMethod.CASH || method === RefundMethod.CARD || method === RefundMethod.CARD_TO_CARD) &&
    !input.allowReceivedOverflow &&
    amount > input.receivedOnInvoice
  )
    throw new BusinessError(
      `بازپرداخت ${money(amount)} ریال از فاکتور ${faDigits(input.receiptNo)} ممکن نیست: ` +
        `مشتری تا الان فقط ${money(input.receivedOnInvoice)} ریال بابت این فاکتور پرداخت کرده است.\n` +
        (input.fullRefundOverride
          ? 'تایید مدیر فقط کسر تخفیف را برمی‌دارد؛ بیشتر از پولی که واقعاً دریافت شده از صندوق/کارت پرداخت نمی‌شود.\n'
          : '') +
        'برای فاکتور نسیه‌ی پرداخت‌نشده، روش «بدون بازپرداخت» درست است (طلب مشتری کم می‌شود، پولی از صندوق بیرون نمی‌رود).'
    )

  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۳۷ — فاکتوری که هنوز بدهی دارد، اعتبار خرید نمی‌گیرد.
   *
   * تا امروز فقط سقف «پول دریافتی» سنجیده می‌شد، نه وضعیت بدهی. سناریو:
   * فاکتور ۱٬۰۰۰٬۰۰۰، پرداخت ۳۰۰٬۰۰۰، برگشت قلم ۲۰۰٬۰۰۰ با روش اعتبار ⇒
   * `creditCap = ۳۰۰٬۰۰۰` پس شرط قبلی رد نمی‌کرد و یک کد اعتبار ۲۰۰٬۰۰۰ صادر
   * می‌شد، در حالی که مشتری هنوز ۷۰۰٬۰۰۰ بدهکار بود. یعنی فروشگاه هم طلبکار
   * می‌ماند و هم یک سند قابل خرج به همان مشتری می‌داد.
   *
   * قاعده‌ی مالک: در این حالت برگشت فقط باید بدهی را کم کند.
   */
  const remainingDebt = Math.max(0, Math.round(input.remainingDebt ?? 0))
  if (method === RefundMethod.STORE_CREDIT && remainingDebt > 0)
    throw new BusinessError(
      `فاکتور ${faDigits(input.receiptNo)} هنوز ${money(remainingDebt)} ریال بدهی دارد، پس اعتبار خرید برایش صادر نمی‌شود.\n` +
        'روش «بدون بازپرداخت» را انتخاب کنید تا همین برگشت از بدهی مشتری کم شود. ' +
        'اگر بعد از صفر شدن بدهی چیزی اضافه ماند، آن‌وقت می‌شود اعتبار صادر کرد.'
    )
  /**
   * بند ۴/۵ — فاکتور نسیه‌ی بدهکار: بازپرداخت نقد/کارت از کشو خارج نمی‌شود.
   * مثال: فاکتور ۱٬۰۰۰٬۰۰۰، پرداخت ۳۰۰٬۰۰۰، برگشت ۲۰۰٬۰۰۰ نقدی ⇒ مشتری هنوز
   * ۷۰۰٬۰۰۰ بدهکار است و ۲۰۰٬۰۰۰ نباید از کشو برود. همان قاعده‌ی اعتبار خرید.
   */
  if (
    remainingDebt > 0 &&
    (method === RefundMethod.CASH || method === RefundMethod.CARD || method === RefundMethod.CARD_TO_CARD)
  )
    throw new BusinessError(
      `فاکتور ${faDigits(input.receiptNo)} هنوز ${money(remainingDebt)} ریال بدهی دارد، پس بازپرداخت نقدی/کارتی از صندوق خارج نمی‌شود.\n` +
        'روش «بدون بازپرداخت» را انتخاب کنید تا همین برگشت از بدهی مشتری کم شود. ' +
        'وقتی بدهی صفر شد، اگر پولی اضافه ماند می‌توان بازپرداخت نقدی ثبت کرد.'
    )

  const creditCap = Math.max(0, Math.round(input.receivedForCredit ?? input.receivedOnInvoice))
  if (method === RefundMethod.STORE_CREDIT && amount > creditCap)
    throw new BusinessError(
      `صدور اعتبار خرید ${money(amount)} ریالی برای فاکتور ${faDigits(input.receiptNo)} ممکن نیست: ` +
        `از پول دریافتی این فاکتور فقط ${money(creditCap)} ریال قابل تبدیل به اعتبار است ` +
        '(اعتبار خرید فقط برای کالایی صادر می‌شود که پولش واقعاً دریافت شده).\n' +
        'برای مابقی، روش «بدون بازپرداخت» را انتخاب کنید تا فقط بدهی مشتری کم شود.'
    )

  return {
    method,
    amount,
    note:
      method === RefundMethod.CASH
        ? `${money(amount)} ریال نقد از صندوق پرداخت شد.`
        : method === RefundMethod.CARD
          ? `${money(amount)} ریال به کارت مشتری برگشت.`
          : method === RefundMethod.CARD_TO_CARD
            ? `${money(amount)} ریال «کارت‌به‌کارت توسط مدیر» — پرداخت فوری انجام نشد و یک درخواست پرداخت با وضعیت «در انتظار پرداخت» ثبت گردید.`
            : `${money(amount)} ریال بارکد اعتبار خرید بعدی صادر شد.`
  }
}

/**
 * ===========================================================================
 * هسته‌ی «برگشت از فروش» — مشترک بین برگشت ساده و تعویض کالا (بخش ۶).
 *
 * چرا یک تابع مشترک؟ چون تعویض کالا *همان برگشت* است به‌علاوه‌ی یک سند فروش
 * جدید. اگر منطق برگشت (تعداد قابل برگشت، کالای حذف‌شده، برگشت موجودی، وضعیت
 * فاکتور) دو جا نوشته می‌شد، با اولین اصلاح از هم واگرا می‌شدند و «برگشت» و
 * «تعویض» دو رفتار متفاوت پیدا می‌کردند — همان چیزی که در حساب فروشگاه فاجعه
 * است. پس تعویض هم مو‌به‌مو از همین مسیر رد می‌شود و فقط `kind` آن EXCHANGE است.
 *
 * ⚠️ همیشه با `tx` صدا زده می‌شود (قاعده‌ی ۶ README).
 * ===========================================================================
 */
async function runReturn(
  tx: Prisma.TransactionClient,
  input: ReturnSaleInput,
  opts: {
    kind?: string
    /**
     * روش بازپرداخت را همین‌جا اعمال کن؟
     *   true  = مسیر برگشت ساده (`createReturn`) ⇒ `refundMethod` اجباری است.
     *   false = مسیر تعویض (`createExchange`) ⇒ تسویه‌ی مابه‌التفاوت *بعد از*
     *           ساخته‌شدن سند تعویض انجام می‌شود، چون تا آن لحظه اصلاً معلوم
     *           نیست ما بدهکاریم یا مشتری.
     */
    applyRefund?: boolean
    /**
     * ================== جلسه ۴۰ · کار ب ==================
     * «کالای برگشتی را همین حالا به موجودی قابل‌فروش اضافه نکن».
     *
     * مسیر برگشت ساده خودش تشخیص می‌دهد (`refund.method === CARD_TO_CARD`)، پس
     * این گزینه فقط برای مسیر **تعویض** لازم است: آنجا `applyRefund = false`
     * است و روش تسویه *بعد از* ساخته‌شدن سند تعویض معلوم می‌شود، در حالی که
     * کالا همان لحظه‌ی `runReturn` باید معلق بماند. `createExchange` این را از
     * `input.refundMode` می‌فرستد و اگر بعداً معلوم شد مابه‌التفاوت به نفع
     * مشتری نبوده (پس هیچ پرداخت مدیری وجود ندارد)، همان‌جا و در همان تراکنش
     * کالا را آزاد می‌کند.
     */
    deferRestock?: boolean
    /** نشست ۷۳ — رمز مدیر پیش از تراکنش برای مبلغ کاملِ بدون تخفیف تایید شده است */
    fullRefundOverride?: boolean
    /** نشست ۱۸۹ — رمز سقف اعتبار اضافه‌دریافت، بیرون از تراکنش سنجیده شده */
    overpayManagerApproved?: boolean
  } = {}
) {
    const now = new Date()
    const invoice = await tx.saleInvoice.findUnique({
      where: { id: input.invoiceId },
      include: { items: true, returns: { where: { voidedAt: null }, include: { items: true } } }
    })
    if (!invoice) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد.')
    /** نشست ۱۶۴ · Y22 · بند ۴-۵۲ — بدهی فاکتور *پیش از* این برگشت (برای تشخیص «این برگشت بدهی را صفر کرد») */
    const debtBefore = await invoiceRemaining(
      tx,
      invoice.id,
      toNumberRial(invoice.grandTotal),
      receivedTotalOf(
        (await tx.payment.findMany({
          where: { invoiceId: invoice.id, voidedAt: null },
          select: { amount: true, kind: true, chequeStatus: true }
        })) as any[]
      )
    )
    const remainingBeforeReturn = debtBefore.remaining
    /**
     * نشست ۲ زنجیره رفع · C7 (بند ۴-۲۰) — برگشت روی فاکتور لغوشده یا پیش‌نویس
     * کاملاً ممنوع است؛ این دیوار مستقل از UI در main است.
     */
    if (!isReturnableStatus(invoice.status))
      throw new BusinessError(
        `فاکتور شماره ${faDigits(invoice.receiptNo)} ` +
          (invoice.status === 'CANCELED' ? 'لغو شده است' : 'هنوز پیش‌نویس است و نهایی نشده') +
          '؛ روی آن هیچ برگشت یا تعویضی ثبت نمی‌شود.'
      )

    const returnedByItem = new Map<number, number>()
    for (const r of invoice.returns)
      for (const it of r.items) returnedByItem.set(it.saleItemId, (returnedByItem.get(it.saleItemId) ?? 0) + it.qty)

    /**
     * نشست ۲ زنجیره رفع · C5 — ردیف‌های تکراری یک `saleItemId` *قبل* از
     * اعتبارسنجی تجمیع می‌شوند تا سقف «تعداد قابل برگشت» روی جمع‌شان سنجیده شود.
     */
    const targets = mergeReturnTargets(
      input.full
        ? invoice.items.map((i) => ({
            saleItemId: i.id,
            qty: Math.max(0, i.qty - (returnedByItem.get(i.id) ?? 0))
          }))
        : (input.lines ?? [])
    )
    /** نشست ۲ · C1 (بند ۴-۱۱/۱۷) — سهم واقعی هر قلم از پرداختیِ مشتری */
    const lineNet = allocateLineNet(invoice)

    if (!targets.length)
      throw new BusinessError(
        input.full
          ? 'همه‌ی اقلام این فاکتور قبلاً برگشت خورده‌اند؛ چیزی برای برگشت نمانده است.'
          : 'برای برگشت، تعداد حداقل یک قلم را بزرگ‌تر از صفر بگذارید.'
      )

    const variantIds = [...new Set(targets.map((t) => invoice.items.find((i) => i.id === t.saleItemId)?.variantId ?? 0))]
    const variants = await loadProductVariantsByIds(tx, variantIds.filter(Boolean), {
      id: true,
      isActive: true,
      size: true,
      color: true,
      product: { select: { name: true, isActive: true } }
    })
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const nameOf = (variantId: number) => {
      const v = vmap.get(variantId)
      if (!v) return 'کالای حذف‌شده از سیستم'
      return `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
    }

    const blockedRemoved: string[] = []
    const blockedMissing: string[] = []

    const items = targets.map((t) => {
      const src = invoice.items.find((i) => i.id === t.saleItemId)
      if (!src) throw new BusinessError('یکی از اقلام انتخاب‌شده در این فاکتور نیست؛ صفحه را تازه کنید.')
      const qty = t.qty
      const remaining = Math.max(0, src.qty - (returnedByItem.get(src.id) ?? 0))

      /**
       * ============ بند ۱۸ — `force` روی *تعداد برگشتی* حذف شد ============
       * قبلاً این یک «هشدار» بود: با `force = true` می‌شد بیشتر از تعداد
       * فروخته‌شده را برگشت زد. مسیر سوءاستفاده‌اش دقیقاً روشن است:
       *     برگشت بیشتر ⇒ مابه‌التفاوت منفی‌تر ⇒ اعتبار خرید بزرگ‌تر
       * و در گزارش هیچ چیز غیرعادی دیده نمی‌شد. حالا **دیوار** است، بدون استثنا.
       *
       * ⚠️ `force` خودش حذف نشده و همان معنای منطقی‌اش را دارد: «کالای حذف‌شده
       * از انبار هم برگشت بخورد» (کنار `allowRemoved`). آن استثنا منطقی است،
       * این یکی نبود.
       */
      if (qty > remaining)
        throw new BusinessError(
          `تعداد برگشتی «${nameOf(src.variantId)}» (${faDigits(qty)}) از تعداد قابل برگشت (${faDigits(remaining)}) بیشتر است.\n` +
            'برگشت بیشتر از باقی‌ماندهٔ قابل‌برگشت در هیچ حالتی مجاز نیست (حتی با تایید مدیر). ' +
            'اگر تعداد فاکتور اصلی اشتباه ثبت شده، اول خودِ فاکتور را اصلاح کنید.'
        )

      const v = vmap.get(src.variantId)
      const removed = !!v && (!v.isActive || v.product?.isActive === false)
      if (!v) blockedMissing.push(nameOf(src.variantId))
      else if (removed && !input.allowRemoved) blockedRemoved.push(nameOf(src.variantId))

      return {
        saleItemId: src.id,
        variantId: src.variantId,
        qty,
        unitPrice: src.unitPrice,
        // C1 — نه `unitPrice × qty` خام: سهم تجمعی از snapshot فاکتور
        lineTotal: returnValueOf(lineNet.get(src.id) ?? 0, src.qty, returnedByItem.get(src.id) ?? 0, qty),
        removedFromStock: removed,
        exists: !!v
      }
    })

    if (blockedMissing.length)
      throw new BusinessError(
        'این کالا از موجودی انبار حذف شده است و رکوردی از آن در سیستم نمانده، پس برگشت خودکارش ممکن نیست:\n' +
          blockedMissing.map((n) => `• ${n}`).join('\n') +
          '\nاین قلم را از فهرست برگشت بردارید و موجودی را دستی (از پنل کالاها) اصلاح کنید.'
      )
    if (blockedRemoved.length)
      throw new BusinessError(
        'این کالا از موجودی انبار حذف شده است:\n' +
          blockedRemoved.map((n) => `• ${n}`).join('\n') +
          '\nبرگشت خودکار انجام نشد. اگر آگاهانه می‌خواهید برگشت ثبت شود و موجودی همین کالا برگردد، ' +
          'گزینه‌ی «رسیدگی دستی: کالای حذف‌شده هم برگشت بخورد» را تایید کنید.'
      )

    const hasRemovedItems = items.some((i) => i.removedFromStock)
    /**
     * نشست ۲۰۸ · بند ۴-۱۱ — override مدیر باید ارزش برگشت را هم به قیمت کامل
     * (بدون کسر تخفیف) ببرد. اگر فقط سقف بازپرداخت عوض شود، `maxKeepSettled`
     * همان سهم ۹۰۰٬۰۰۰ را نگه می‌دارد و ۱٬۰۰۰٬۰۰۰ بی‌صدا ۹۰۰٬۰۰۰ می‌شود.
     */
    if (opts.fullRefundOverride) {
      for (const item of items) {
        const src = invoice.items.find((candidate) => candidate.id === item.saleItemId)
        if (!src) continue
        item.lineTotal = returnListPriceOf(
          toNumberRial(src.unitPrice),
          toNumberRial(src.tax),
          src.qty,
          item.qty
        )
      }
    }
    const returnTotal = items.reduce((s, i) => s + i.lineTotal, 0)

    /**
     * ------------------- بند ۱۱ — روش بازپرداخت (اجباری) -------------------
     * سقف بازپرداخت نقدی/کارتی = پولی که واقعاً بابت این فاکتور دریافت شده منهای
     * بازپرداخت‌های قبلیِ همین فاکتور. بدون این کسر، دو برگشت جزئی پشت‌سرهم
     * می‌توانستند بیشتر از پولِ دریافتی از کشو بیرون بکشند.
     */
    let refund: { method: string; amount: number; note: string } | null = null
    if (opts.applyRefund) {
      /**
       * نشست ۵۹ · خوشه B/D (DECISIONS S59-5) — «بازپرداخت‌های قبلی» حالا همان
       * refundFromReceived واحدِ `remainingOf` است: نقد + کارت + **کارت‌به‌کارت
       * لغونشده (در انتظار یا پرداخت‌شده)** + اعتبار خرید. قبلاً فقط CASH/CARD کم
       * می‌شد ⇒ دو بازپرداخت کارت‌به‌کارت ۱٬۰۰۰ روی فاکتور ۱٬۰۰۰ هر دو پذیرفته می‌شد.
       */
      const prevAdj = adjustmentsOrEmpty(await debtAdjustmentsByInvoice(tx, [invoice.id]), invoice.id)
      const previouslyRefunded = Math.max(0, Math.round(prevAdj.refundFromReceived ?? 0))
      const redeemedOnInvoice = await tx.storeCreditRedemption.aggregate({
        where: { invoiceId: invoice.id, reversedAt: null },
        _sum: { amount: true }
      })
      const redeemedAmt = Math.max(0, toNumberRial(redeemedOnInvoice._sum.amount ?? 0))
      /**
       * پرداخت اعتبار خرید، پولِ قابل‌برگشت از صندوق نیست: در برگشت کامل، همان
       * دفتر مصرف معکوس و خود اعتبار دوباره فعال می‌شود. بنابراین هم گیتِ
       * «اضافه‌دریافت» و هم تشخیصِ بدهیِ بعد از برگشت باید فقط پول واقعی را
       * ببینند. در غیر این صورت، برگشت کاملِ یک فروش ۱۰۰٪ اعتباری به اشتباه
       * درخواست تأیید «اضافه‌دریافت» می‌کرد، با این که هیچ پولی از صندوق خارج
       * نشده و اعتبار همان لحظه قرار است بازگردد.
       */
      const cashLikeReceived = await cashLikeReceivedOf(tx, invoice.id, debtBefore.received)
      /**
       * نشست ۱۹۷ — سقف خروج = پول واقعی (نقد/کارت/چک پاس‌شده)، نه `paidTotal`
       * و نه `EXCHANGE_CREDIT`. اعتبار خرج‌شده دوباره اعتبار می‌شود، نقد نه.
       */
      const receivedOnInvoice = await cashLikeRefundableOf(tx, invoice, previouslyRefunded)
      const fullRefundAmount = opts.fullRefundOverride
        ? items.reduce((sum, item) => {
            const src = invoice.items.find((candidate) => candidate.id === item.saleItemId)
            // نشست ۱۸۱: قیمت/مالیات از دیتابیس BigInt‌اند؛ محاسبه‌گر با number کار می‌کند.
            return sum + (src ? returnListPriceOf(toNumberRial(src.unitPrice), toNumberRial(src.tax), src.qty, item.qty) : 0)
          }, 0)
        : null
      /**
       * نشست ۱۹۴ · بند ۴-۴/۴-۳۷ — بدهی و سقف خروج نقد را با وضعیت *بعد از*
       * این برگشت می‌سنجیم (نه remainingBeforeReturn). مثال ممیزی: فاکتور
       * ۱٬۰۰۰٬۰۰۰، پرداخت ۹۰۰٬۰۰۰، برگشت ۵۰۰٬۰۰۰ ⇒ بعد از برگشت بدهی ۰ و
       * ۴۰۰٬۰۰۰ اضافه است؛ سقف بازپرداخت نقد/کارت/اعتبار همان ۴۰۰٬۰۰۰ است.
       * اگر بعد از برگشت هنوز بدهی بماند، نقد انتخاب‌شده خودکار کاهش بدهی
       * می‌شود (بند ۴-۴) نه خطای «اول NONE انتخاب کن».
       */
      /**
       * برای فاکتور عادی، `cashLikeReceived` و `receivedOnInvoice` یک معنا دارند.
       * اما فاکتور تعویض، ارزش کالای برگشتی را با `EXCHANGE_CREDIT` نشان می‌دهد؛
       * پول واقعی ممکن است روی فاکتور مادر باشد. `cashLikeRefundableOf` همان
       * پول را با کسر بازپرداخت/اعتبارهای پیشینِ زنجیره به دست می‌آورد.
       *
       * اگر فقط `cashLikeReceived` این سند را به `remainingOf` بدهیم، برگشت
       * کالای جایگزین روی فروش نقدیِ مادر، با وجود سقف معتبر lineage، به اشتباه
       * «فقط کاهش بدهی» دیده و به NONE تبدیل می‌شود. برای *تصمیم بازپرداخت همین
       * برگشت*، پول قابل‌برگشت زنجیره منبع درست است؛ محاسبهٔ واقعی بدهی/گزارش
       * پایین‌تر همچنان از دفتر همان سند و `recalcSettlement` می‌آید.
       */
      const refundDecisionReceived = Math.max(cashLikeReceived, receivedOnInvoice)
      const afterNone = remainingOf({
        grandTotal: toNumberRial(invoice.grandTotal),
        received: refundDecisionReceived,
        returnedValue: debtBefore.returnedValue + returnTotal,
        refundFromReceived: debtBefore.refundFromReceived
      })
      const askedMethod = String(input.refundMethod ?? '').toUpperCase()
      const refundingAsked = (
        [
          RefundMethod.CASH,
          RefundMethod.CARD,
          RefundMethod.STORE_CREDIT,
          RefundMethod.CARD_TO_CARD
        ] as string[]
      ).includes(askedMethod)
      /**
       * بند ۴-۴: بعد از برگشت هنوز بدهی ⇒ نقد نمی‌دهیم.
       * نشست ۱۹۷: سند تعویض با EXCHANGE_CREDIT «تسویه‌شده» دیده می‌شود و
       * afterNone.overpaid > ۰ است، ولی پول واقعی صفر است — همان کاهش بدهی.
       */
      const debtOnly = refundingAsked && (afterNone.overpaid <= 0 || receivedOnInvoice <= 0)
      refund = resolveRefund({
        method: debtOnly ? RefundMethod.NONE : (input.refundMethod ?? null),
        requested: debtOnly ? null : (input.refundAmount ?? null),
        returnTotal,
        fullAmount: fullRefundAmount,
        /**
         * ممیزی A73-01 — override مدیر فقط «کسر تخفیف» را برمی‌دارد، نه سقف پول
         * دریافتی را. قبلاً نسیه‌ی پرداخت‌نشده‌ی ۱٬۰۰۰٬۰۰۰ با override، ۱٬۰۰۰٬۰۰۰ نقد
         * از کشو بیرون می‌داد (خلاف بند ۴-۴) و دو override روی فاکتور ۱٬۸۰۰٬۰۰۰ریالی
         * ۲٬۰۰۰٬۰۰۰ خارج می‌کرد. خروج نقد/کارت هرگز از پول واقعاً دریافت‌شده بیشتر نیست.
         */
        allowReceivedOverflow: false,
        fullRefundOverride: !!opts.fullRefundOverride,
        receivedOnInvoice,
        /** بند ۴-۳۷ — اعتبار خرید تا سقف پول واقعی + اعتبار خرج‌شده (EXCHANGE_CREDIT نه) */
        receivedForCredit: receivedOnInvoice + redeemedAmt,
        remainingDebt: afterNone.remaining,
        maxKeepSettled: afterNone.overpaid,
        receiptNo: invoice.receiptNo
      })
      if (debtOnly) {
        refund = {
          ...refund,
          note:
            afterNone.remaining > 0
              ? `روش بازپرداخت به «بدون بازپرداخت» تبدیل شد: فاکتور بعد از این برگشت هنوز ${money(afterNone.remaining)} ریال بدهی دارد، پس پولی از صندوق خارج نشد و فقط بدهی کم شد.`
              : 'روش بازپرداخت به «بدون بازپرداخت» تبدیل شد: مبلغ برگشت با بدهی تسویه شد و پولی برای خروج از صندوق نماند.'
        }
      }
    }
    /**
     * نشست ۱۸۹ · بند ۴-۳۵/۴-۵۵ — برگشت ساده می‌تواند اضافه‌دریافت بسازد
     * (مثال: فاکتور ۱٬۰۰۰٬۰۰۰ با دو قلم ۵۰۰٬۰۰۰، پرداخت ۹۰۰٬۰۰۰، برگشت یک قلم
     * بدون بازپرداخت ⇒ ۴۰۰٬۰۰۰ اضافه). قبلاً recalcSettlement همان را بی‌صدا
     * روی overpayAmount می‌نوشت. حالا همان فلو فروش/وصول: هشدار «بله ثبت کن»،
     * بعد سؤال صدور کد، وگرنه ردیف «دریافت پول اضافه». تعویض از این گیت جداست
     * (`applyRefund: false`) چون تسویه‌اش بعد از سند تعویض است.
     */
    let returnOverpayIncrease = 0
    if (opts.applyRefund) {
      const thisRefund = refundFromReceivedOf({
        kind: ReturnKind.RETURN,
        total: returnTotal,
        refundMethod: refund?.method ?? input.refundMethod ?? null,
        refundAmount: refund?.amount ?? 0
      })
      /**
       * اضافه‌دریافت برگشت را در همه‌ی نوع فاکتورها با پول واقعی بسنج؛ نه
       * EXCHANGE_CREDIT و نه STORE_CREDIT نقد نیستند. اعتبار مصرف‌شده در برگشت
       * کامل از طریق `reverseInvoiceRedemptions` برمی‌گردد، نه با ساختن یک
       * اضافه‌دریافت یا الزام تایید مدیر.
       */
      const overpayReceived = await cashLikeReceivedOf(tx, invoice.id, debtBefore.received)
      const after = remainingOf({
        grandTotal: toNumberRial(invoice.grandTotal),
        received: overpayReceived,
        returnedValue: debtBefore.returnedValue + returnTotal,
        refundFromReceived: debtBefore.refundFromReceived + thisRefund
      })
      const beforeOverpay = remainingOf({
        grandTotal: toNumberRial(invoice.grandTotal),
        received: overpayReceived,
        returnedValue: debtBefore.returnedValue,
        refundFromReceived: debtBefore.refundFromReceived
      })
      returnOverpayIncrease = Math.max(0, after.overpaid - beforeOverpay.overpaid)
      if (returnOverpayIncrease > 0 && input.confirmOverpay !== true)
        throw new BusinessError(
          `با این برگشت، ${money(returnOverpayIncrease)} ریال اضافه‌دریافت روی فاکتور ${faDigits(invoice.receiptNo)} ساخته می‌شود ` +
            `(پول دریافت‌شده ${money(after.netReceived)} ریال از مانده‌ی کالا ${money(after.payable)} ریال بیشتر می‌ماند).\\n` +
            'اگر آگاهانه می‌خواهید همین مبلغ کامل ثبت شود، «بله ثبت کن» را بزنید؛ مبلغ اضافه به‌صورت جدا ' +
            '(ردیف «دریافت پول اضافه») در گزارش فاکتور نمایش داده می‌شود، یا می‌توانید از آن کد اعتبار خرید صادر کنید.'
        )
      if (input.overpayAsCredit === true && returnOverpayIncrease <= 0)
        throw new BusinessError(
          'با این برگشت مبلغ اضافه‌ای برای صدور اعتبار خرید ساخته نمی‌شود؛ یا بازپرداخت همان اضافه را پوشش داده یا فاکتور هنوز بدهکار است.'
        )
    }
    // آیا موجودی واقعاً برمی‌گردد؟ فقط اگر فاکتور اصلی موجودی را کم کرده بود
    // (تقارن با فاکتور: فاکتور «بدون کسر از موجودی» انبار را پر نمی‌کند).
    const restock = invoice.deductInventory

    /**
     * ================== جلسه ۴۰ · کار ب — معلق ماندن کالا ==================
     * اگر بازپرداخت «کارت‌به‌کارت توسط مدیر» است، هیچ پولی همین حالا به مشتری
     * نرسیده؛ پس کالا هم همین حالا «قابل فروش» نمی‌شود. `restockedQty = 0`
     * ثبت می‌شود، هیچ `inventoryService.increase` نمی‌خورد، و پرچم
     * `restockPending` روی سند برگشت می‌نشیند. تنها نقطه‌ی آزادسازی،
     * `CardTransferService.pay` (پشت قفل «پرداخت‌های مدیر») است.
     *
     * ⚠️ فقط و فقط همین یک حالت. بازپرداخت نقدی/کارتیِ سر صندوق، اعتبار خرید،
     * «بدون بازپرداخت» و تعویضِ بدون پرداخت مدیر مو‌به‌مو مثل قبل همان لحظه به
     * انبار برمی‌گردند.
     *
     * ⚠️ فاکتور «بدون کسر از موجودی» هیچ‌وقت معلق نمی‌شود: آنجا `restock` از
     * ابتدا false است و کالایی در کار نیست که برگردد (وگرنه انبارگردانی یک
     * کسری کاذب می‌ساخت).
     */
    const deferRestock =
      restock && (opts.deferRestock === true || refund?.method === RefundMethod.CARD_TO_CARD)
    const restockNow = restock && !deferRestock

    const ret = await tx.saleReturn.create({
      data: {
        invoiceId: invoice.id,
        isFull: !!input.full,
        total: returnTotal,
        returnedAt: now,
        returnedAtJalali: toJalaliDate(now),
        // بخش ۳ و ۶: ساعت دقیق ثبت برگشت (HH:mm:ss). گزارش «تعویض کالا» جزئیات
        // را «دقیق به ثانیه» می‌خواهد و تاریخ شمسی تنها کافی نیست.
        returnedAtTime: toClock(now),
        /** RETURN = برگشت ساده · EXCHANGE = این برگشت، پایه‌ی یک سند تعویض است */
        kind: opts.kind ?? ReturnKind.RETURN,
        userId: input.userId ?? null,
        shiftId: await shiftService.currentId(tx, input.userId ?? null, (input as any).custodyFence ?? null),
        hasRemovedItems,
        note: input.note,
        /**
         * بند ۱۱ — روش بازپرداخت روی خودِ سند برگشت می‌نشیند (نه در یک جدول
         * جانبی)، پس هر گزارش و هر رسیدی که این برگشت را می‌خواند، بی‌هیچ
         * join اضافه‌ای می‌داند چقدر از صندوق خارج شده است.
         */
        ...(refund
          ? {
              refundMethod: refund.method,
              refundAmount: refund.amount,
              refundedAt: now,
              refundedAtJalali: toJalaliDate(now),
              refundedAtTime: toClock(now),
              refundReference: input.refundReference ?? null,
              refundNote: input.refundNote ?? refund.note
            }
          : {}),
        /**
         * جلسه ۴۰ · کار ب — پرچم «کالا معلق است». منبع حقیقتِ *تعداد* همان
         * `restockedQty` پایین است؛ این ستون فقط می‌گوید «صفر بودنش به‌معنای
         * انتظارِ تأیید مدیر است، نه به‌معنای فاکتور بدون کسر موجودی».
         */
        restockPending: deferRestock,
        items: {
          create: items.map((i) => ({
            saleItemId: i.saleItemId,
            variantId: i.variantId,
            qty: i.qty,
            unitPrice: i.unitPrice,
            lineTotal: i.lineTotal,
            removedFromStock: i.removedFromStock,
            restockedQty: restockNow ? i.qty : 0
          }))
        }
      },
      include: { items: true }
    })

    /**
     * =====================================================================
     * جلسه ۴۷ — کالای برگشتی به **همان انباری** برمی‌گردد که از آن کم شده بود.
     *
     * منبع حقیقت، دفتر `SaleItemStockAllocation` است و ترتیب برگشت LIFO:
     * آخرین انباری که کاربر آگاهانه انتخابش کرده، اول پر می‌شود.
     *
     * ⚠️ فاکتورِ بی‌دفتر (هر فاکتور قبل از این نسخه، و هر فروش تکی) ⇒
     * `storeLines` عیناً همان اقلام برگشتی است و این بلوک مو‌به‌مو مثل قبل
     * رفتار می‌کند. هیچ عددی عوض نمی‌شود.
     * =====================================================================
     */
    let restoreSplit: Awaited<ReturnType<typeof stockAllocationService.reverseForSaleItems>> | null = null
    if (restockNow) {
      restoreSplit = await stockAllocationService.reverseForSaleItems(tx, {
        invoiceId: invoice.id,
        receiptNo: invoice.receiptNo,
        targets: items.map((i) => ({ saleItemId: i.saleItemId, variantId: i.variantId, qty: i.qty })),
        userId: input.userId ?? null,
        reason: `برگشت از فروش فاکتور ${faDigits(invoice.receiptNo)}`
      })
      if (restoreSplit.storeLines.length)
        await inventoryService.increase(
          restoreSplit.storeLines,
          {
            reason: 'SALE_RETURN',
            refType: 'SaleReturn',
            refId: ret.id,
            userId: input.userId ?? null,
            note: `برگشت از فروش فاکتور ${faDigits(invoice.receiptNo)}`
          },
          tx
        )
    }

    /**
     * ================== ردِ نقدیِ بازپرداخت ==================
     * فقط `CASH` یک `CashMovement(RETURN_REFUND)` می‌سازد: تنها همین حالت پول
     * را از *کشو* بیرون می‌برد و باید در `expectedCash` بستن صندوق کم شود.
     * کارت از کشو کم نمی‌کند (اثرش روی کارتخوان است) و اعتبار خرید هم پول نقد
     * نیست — هر سه در گزارش جدا نمایش داده می‌شوند، ولی فقط یکی از کشو کم می‌کند.
     */
    let refundCredit: any = null
    if (refund && (refund.amount > 0 || opts.fullRefundOverride)) {
      if (refund.method === RefundMethod.CASH) {
        await recordCashMovement(tx, {
          amount: refund.amount,
          type: CashMovementType.RETURN_REFUND,
          shiftId: ret.shiftId ?? null,
          userId: input.userId ?? null,
          description: `بازپرداخت نقدی برگشت سند ${ret.id} · فاکتور ${faDigits(invoice.receiptNo)}`,
          refType: 'SaleReturn',
          refId: ret.id,
          occurredAt: now
        })
      } else if (refund.method === RefundMethod.STORE_CREDIT) {
        // بارکد اعتبار خرید بعدی، به‌جای پول نقد. اثر نقدی صفر، بدهی ما ثبت‌شده.
        const defaults = await saleDefaultsWith(tx)
        refundCredit = await issueStoreCredit(tx, {
          amount: refund.amount,
          returnId: ret.id,
          sourceInvoiceId: invoice.id,
          customerId: invoice.customerId ?? null,
          /**
           * بند ۹ (جلسه ۳۰) · §۳ — مدت اعتبارِ مسیر تعویض/برگشت.
           * تا دیروز همیشه `returnCodeDays` (تنظیمات «کد برگشت») فرستاده می‌شد و
           * همین ورودی، پیش‌فرض `types.EXCHANGE.days` تنظیمات اعتبار را دور می‌زد —
           * یعنی تنظیم صریح کاربر بی‌اثر بود. `undefined` یعنی «خودت از تنظیمات بخوان».
           */
          days: exchangeCreditDays({
            explicit: input.creditDays,
            exchangeDays: (await readCreditSettings(tx)).types.EXCHANGE.days,
            returnCodeDays: defaults.returnCodeDays
          }),
          length: defaults.returnCodeLength,
          note: `بازپرداخت برگشت از فروش · فاکتور ${faDigits(invoice.receiptNo)}`,
          userId: input.userId ?? null,
          issuedAt: now
        })
        await tx.saleReturn.update({
          where: { id: ret.id },
          data: { storeCreditId: refundCredit.id, storeCreditCode: refundCredit.code }
        })
      }

      await audit(tx, {
        action: AuditAction.RETURN_REFUND,
        entity: 'SaleReturn',
        entityId: ret.id,
        userId: input.userId ?? null,
        after: JSON.stringify({
          receiptNo: invoice.receiptNo,
          returnTotal,
          refundMethod: refund.method,
          refundAmount: refund.amount,
          storeCreditId: refundCredit?.id ?? null,
          cashLeftDrawer: refund.method === RefundMethod.CASH,
          fullAmountOverride: !!opts.fullRefundOverride
        }),
        note: opts.fullRefundOverride
          ? `override مدیر: مبلغ کاملِ بدون کسر تخفیف برای برگشت سند ${ret.id}: ${refund.note}` +
            ` · دلیل مدیر: ${String((input as any).overrideReason ?? '').trim() || '—'}`
          : `روش بازپرداخت برگشت سند ${ret.id}: ${refund.note}`
      })
    }

    // ---- وضعیت فاکتور بر اساس جمع کل برگشت‌ها ----
    for (const i of items) returnedByItem.set(i.saleItemId, (returnedByItem.get(i.saleItemId) ?? 0) + i.qty)
    const soldQty = invoice.items.reduce((s, i) => s + i.qty, 0)
    const returnedQty = invoice.items.reduce((s, i) => s + Math.min(i.qty, returnedByItem.get(i.id) ?? 0), 0)
    const fullyReturned = returnedQty >= soldQty
    await tx.saleInvoice.update({
      where: { id: invoice.id },
      data: { status: fullyReturned ? SaleStatus.RETURNED : SaleStatus.PARTIALLY_RETURNED }
    })
    /**
     * اعتبار مصرف‌شده فقط وقتی برمی‌گردد که کل فاکتور واقعاً برگشت خورده باشد.
     * برگشت جزئی نباید دفتر مصرف را دست‌کاری کند. این call داخل همان تراکنش
     * است تا وضعیت فاکتور، سند برگشت و برگشت اعتبار اتمیک بمانند.
     */
    const reversedCreditRedemptions = fullyReturned
      ? await reverseInvoiceRedemptions(tx, {
          invoiceId: invoice.id,
          reason: `برگشت کامل فاکتور ${faDigits(invoice.receiptNo)}`,
          userId: input.userId ?? null
        })
      : 0

    await audit(tx, {
      action: AuditAction.SALE_RETURN,
      entity: 'SaleReturn',
      entityId: ret.id,
      userId: input.userId ?? null,
      after: JSON.stringify({
        receiptNo: invoice.receiptNo,
        returnCode: invoice.returnCode,
        total: ret.total,
        items: items.map((i) => ({ variantId: i.variantId, qty: i.qty, removed: i.removedFromStock })),
        restocked: restockNow,
        restockPending: deferRestock,
        fullyReturned,
        /** جلسه ۴۷ — چه مقدار به انبارهای مبدأ (نه انبار فروشگاه) برگشت */
        restoredToWarehouses: restoreSplit?.warehouseQty ?? 0
      }),
      note: deferRestock
        ? 'کالای برگشتی به موجودی قابل‌فروش اضافه نشد و در انتظار پرداخت مدیر است ' +
          '(فیزیکی در فروشگاه، بیرون از موجودی قابل‌فروش)'
        : restockNow
          ? hasRemovedItems
            ? 'برگشت موجودی به انبار (شامل کالای حذف‌شده، با تایید دستی کاربر)'
            : 'برگشت موجودی به انبار'
          : 'فاکتور بدون کسر موجودی بود؛ حرکت انبار ثبت نشد'
    })

    /**
     * نشست ۵۸ · C2/C3 — برگشت بدهی و اضافه‌دریافت را عوض می‌کند؛ پس همین‌جا و در
     * همین تراکنش بازمحاسبه می‌شود (قبلاً settledAt بعد از برگشت کامل نسیه پر
     * نمی‌شد و برگشت «بدون بازپرداخت» روی فاکتور تسویه‌شده اضافه‌دریافت بی‌صدا
     * می‌ساخت).
     */
    const settleAfter = await recalcSettlement(tx, invoice.id)
    if (invoice.orderType === OrderType.EXCHANGE && invoice.sourceInvoiceId != null) {
      await recalcSettlement(tx, Number(invoice.sourceInvoiceId))
    }
    await auditOverpayChanges(tx, settleAfter, {
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      userId: input.userId ?? null,
      why: `ثبت برگشت ${faDigits(ret.id)}`
    })
    let overpayCredit: Awaited<ReturnType<typeof issueOverpayCreditTx>> | null = null
    if (opts.applyRefund && input.overpayAsCredit === true && returnOverpayIncrease > 0) {
      const backing = await overpayCreditBacking(tx, invoice.id)
      const creditAmt = Math.min(backing.available, returnOverpayIncrease)
      if (creditAmt > 0)
        overpayCredit = await issueOverpayCreditTx(tx, {
          invoiceId: invoice.id,
          amount: creditAmt,
          userId: input.userId ?? null,
          managerApproved: opts.overpayManagerApproved,
          // نشست ۳۱۶ — لینک به سند برگشت: رسید برگشت اعتبار را ببیند و void سند، اعتبار را هم باطل کند
          returnId: ret.id
        })
    }
    /** نشست ۱۶۴ · Y22 · بند ۴-۵۲ — چک در جریان: صفر شدن بدهی ⇒ void خودکار؛ جزئی ⇒ علامت بازبینی */
    const chequePolicy = await chequePolicyAfterReturn(tx, {
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      returnId: ret.id,
      remainingBefore: remainingBeforeReturn,
      remainingAfter: settleAfter.remaining,
      userId: input.userId ?? null
    })

    return {
      id: ret.id,
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      total: ret.total,
      restocked: restockNow,
      /** نشست ۵۸ — بدهی و اضافه‌دریافت فاکتور بعد از این برگشت */
      invoiceRemaining: settleAfter.remaining,
      invoiceOverpaid: settleAfter.overpaid,
      /** نشست ۱۸۹ — مبلغ اضافه‌ی ساخته‌شده با همین برگشت (۰ = فلو لازم نبود) */
      overpayAmount: returnOverpayIncrease,
      overpayCredit,
      /** نشست ۱۶۴ · Y22 — چک‌های خودکار باطل‌شده / نیازمند بازبینی (بند ۴-۵۲) */
      chequesAutoVoided: chequePolicy.voided,
      chequesNeedReview: chequePolicy.flagged,
      restockedQty: restockNow ? items.reduce((s, i) => s + i.qty, 0) : 0,
      /** ---- جلسه ۴۰ · کار ب ---- */
      restockPending: deferRestock,
      pendingRestockQty: deferRestock ? items.reduce((s, i) => s + i.qty, 0) : 0,
      /** جلسه ۴۷ — تعداد و شرح برگشتِ کالا به انبارهای مبدأ (۰ = فقط فروشگاه) */
      restoredToWarehouses: restoreSplit?.warehouseQty ?? 0,
      warehouseRestoreLines: restoreSplit?.warehouseLines ?? [],
      warehouseRestoreNotes: restoreSplit?.notes ?? [],
      hasRemovedItems,
      fullyReturned,
      status: fullyReturned ? SaleStatus.RETURNED : SaleStatus.PARTIALLY_RETURNED,
      items: ret.items,
      returnedAtJalali: ret.returnedAtJalali,
      returnedAtTime: ret.returnedAtTime,
      /** بند ۱۱ — روش و مبلغ بازپرداخت این برگشت (برای رسید چاپی و پنل) */
      refundMethod: refund?.method ?? null,
      refundAmount: refund?.amount ?? 0,
      reversedCreditRedemptions,
      refundNote: refund?.note ?? null,
      storeCreditCode: refundCredit?.code ?? null,
      storeCredit: refundCredit ? shapeStoreCredit(refundCredit) : null,
      /** ---- فقط برای مسیر تعویض کالا (createExchange)، روی سیم نمی‌رود ---- */
      returnRecord: ret,
      invoice,
      returnedLines: items
    }
}

/**
 * ممیزی A88-02 — پیام رد ویرایش مالیِ ردیف مصرف اعتبار خرید (مبلغ/روش/مقصد/تاریخ).
 */
function creditPaymentEditBlockedMessage(amount: number): string {
  return (
    `این پرداختی مصرف اعتبار خرید است (${money(amount)} ریال) و مبلغ، روش، مقصد یا تاریخش قابل ویرایش نیست؛ ` +
    'مبلغ آن را دفتر مصرف اعتبار تعیین می‌کند و اعتبار خرید هرگز به نقد تبدیل نمی‌شود. ' +
    'اگر اشتباه ثبت شده، همین پرداختی را باطل کنید تا اعتبار به مشتری برگردد و سپس پرداخت درست را ثبت کنید. هیچ تغییری ذخیره نشد.'
  )
}

export const salesService = {
  /**
   * ثبت فاکتور فروش (POS و فاکتور فروش عمده).
   * کل عملیات (فاکتور + اقلام + پرداخت‌ها + کسر انبار + کد فاکتور) در یک تراکنش
   * اتمیک انجام می‌شود: یا همه ثبت می‌شود یا هیچ. کسر انبار با state=PENDING
   * ثبت می‌شود و در «تجمیع و انتقال» به FINAL تبدیل می‌شود.
   *
   * دو چیز به‌صورت خودکار اضافه می‌شود:
   *   • shiftId — شیفت باز همان روز (اگر باز نباشد، خودکار باز می‌شود). پس
   *     گزارش فروش به تفکیک شیفت بدون هیچ کار اضافه‌ای ممکن است.
   *   • returnCode — کد کوتاه رندوم برای فروش تکی (غیر عمده) با اعتبار یک
   *     هفته، که روی رسید (متن + بارکد) چاپ و در «برگشت از فروش» استفاده می‌شود.
   *
   * فروش عمده — deductInventory:
   *   true (پیش‌فرض، رفتار POS)  → کسر موجودی از طریق InventoryService.
   *   false                      → مرحله‌ی کسر موجودی کاملاً skip می‌شود.
   */
  async create(input: CreateSaleInput) {
    validateSaleInput(input)
    const verifiedOperator = verifiedCustodySaleOperatorOf(input)
    /** Do not rely solely on IPC: a future Main-side caller must not turn an
     * active custody drawer into a no-evidence sale by omitting the fence. */
    const custodyGoverned = await custodyService.isGoverned()
    if (custodyGoverned && !verifiedOperator)
      throw new BusinessError('هویت اپراتور فروش از مسیر امن تأیید نشده است؛ صفحه را تازه کنید و دوباره تلاش کنید.', 'CUSTODY_OPERATOR_EVIDENCE_REQUIRED')

    /** گارد افزایشی پرداخت ترکیبی: مسیرهای قدیمی بدون splitPayment دست‌نخورده‌اند. */
    if (input.splitPayment === true) {
      const rows = input.payments ?? []
      if (rows.length !== 2 || rows.some((row) => !row || row.amount <= 0))
        throw new BusinessError('پرداخت ترکیبی باید دقیقاً دو سهم مثبتِ نقد و کارت داشته باشد.')
      const ids = [...new Set(rows.map((row) => row.methodId))]
      const methods = await prisma.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true } })
      const kinds = new Map(methods.map((method) => [method.id, method.kind]))
      const cash = rows.filter((row) => kinds.get(row.methodId) === PaymentKind.CASH && row.destination === PaymentDestination.CASH)
      const card = rows.filter((row) => kinds.get(row.methodId) === PaymentKind.CARD && row.destination === PaymentDestination.CARD)
      if (cash.length !== 1 || card.length !== 1)
        throw new BusinessError('پرداخت ترکیبی فقط یک سهم نقدی با مقصد صندوق و یک سهم کارتی با مقصد کارت‌خوان می‌پذیرد.')
      const totals = saleTotals(input)
      if (totals.paidTotal < totals.grandTotal && input.allowPartial !== true)
        throw new BusinessError('جمع نقد و کارت از مبلغ فاکتور کمتر است. برای ثبت نسیه/پرداخت جزئی باید آن گزینه را صریح انتخاب کنید.')
    }

    /**
     * جلسه ۲۱ · §۸ — «قفل موقت ورود کد اعتبار» *قبل از* باز کردن تراکنش.
     *
     * دو دلیل که این خط حتماً باید همین‌جا باشد و نه داخل `$transaction`:
     *   ۱) `guardCreditCode` با کلاینت سراسری روی `AuthLockout` می‌نویسد؛ نوشتن
     *      وسط تراکنشِ باز روی SQLite تک‌نویسنده = همان بن‌بست آشنا.
     *   ۲) سطح حمله‌ی واقعیِ brute-force همین «جست‌وجوی کد» است، نه ثبت فاکتور.
     * کد اشتباه ⇒ همین‌جا با پیام فارسی (و شمارش تلاش باقی‌مانده) رد می‌شود و
     * هیچ فاکتوری ثبت نمی‌شود.
     */
    if (String(input.storeCreditCode ?? '').trim())
      await guardCreditCode(String(input.storeCreditCode), input.userId ?? null)

    const deductInventory = input.deductInventory !== false
    const issuedAt = input.issuedAtJalali ? jalaliToDateTime(input.issuedAtJalali) : new Date()
    const orderType = input.orderType ?? OrderType.INTERNAL
    const wholesaleDiscountPercent =
      input.wholesaleDiscountPercent == null
        ? null
        : Math.min(Math.max(Math.round(input.wholesaleDiscountPercent), 0), 100)

    /**
     * نشست ۱۵۴ (S151-b) — مرجع قیمت، بازه‌ی تخفیف و رمز مدیرِ قیمت دستی، بیرون از
     * تراکنش و پیش از هر رمز دیگر؛ رمز مدیر همین درخواست فقط یک بار سنجیده می‌شود.
     */
    const pricing = await preverifySalePolicy(input, { orderType })

    /**
     * =====================================================================
     * جلسه ۵۲ · مرحله ۳ — قفل **سمت سرور** برای «مبدأ کسر» در پنل فروش تکی.
     *
     * تا جلسه ۵۱ فرستادن `stockPlan` از هر نوعی جز `WHOLESALE` بی‌قید رد می‌شد،
     * پس اصلاً قفلی لازم نبود. حالا که فروش تکی (`INTERNAL`) هم می‌تواند مبدأ
     * بفرستد، قفلِ رندرر (`<ManagerGate panel={PANEL_KEYS.posCentralWithdrawToggle}>`)
     * تنها خط دفاع نیست: یک تماس IPC می‌توانست دورش بزند و فروشنده بی اجازه از
     * انبار مرکزی/شعبه کم کند. پس **خودِ سرویس** تأیید می‌گیرد، مو‌به‌مو با همان
     * الگویی که جلسه ۴۰ برای `cardTransfer:pay` گذاشت.
     *
     * ⚠️ چرا *اینجا* و نه داخل تراکنش: `assertPanelPassword` ⇒ `verifyPanel` ⇒
     * `readLock/writeLock` روی `AuthLockout` با کلاینت سراسری می‌نویسد و SQLite
     * تک‌نویسنده است. نوشتن وسط تراکنشِ باز همان بن‌بست آشنای AuditService است.
     * پس نقطه‌ی درست، *قبل* از `$transaction` است — و مزیت دیگرش این است که رمز
     * اشتباه هیچ رکوردی نمی‌نویسد و هیچ موجودی‌ای را عوض نمی‌کند.
     *
     * ⚠️ کلید تازه‌ای ساخته نشد (قانون بالای `shared/panels.ts`): همان
     * `posCentralWithdrawToggle` استفاده می‌شود تا «برداشت خودکار» و «انتخاب مبدأ
     * کسر» در فروش تکی **یک قفل واحد** داشته باشند، همان‌طور که مالک خواست.
     *
     * ⚠️ قفل خاموش ⇒ `assertPanelPassword` بی رمز `OPEN` می‌دهد (سیاست موجود
     * «قفل ماژول‌ها»، اینجا سیاست تازه‌ای اختراع نمی‌شود).
     *
     * نشست ۳۱۵ — دقیق‌سازی گیت رمز (هم‌راستا با رندرر و با متنِ خودِ راهنمای
     * پنجره): رمز مدیر فقط وقتی لازم است که برنامه‌ی کسر مبدأی **غیر از انبار
     * فروشگاه** داشته باشد (`warehouseEntriesOf`). برنامه‌ی «همه از انبار
     * فروشگاه» — یعنی همان سناریوی رایج «کالا فیزیکی آمده ولی انباردار موجودی
     * سیستم را عقب انداخته» — با رضایت دکمه‌ایِ فروشنده تا منفی ثبت می‌شود؛
     * «موجودی کافی نیست» در این مسیر همیشه هشدار بوده، نه مانع. قبلاً رمز برای
     * *هر* برنامه‌ی کسر در فروش تکی لازم بود و ثبتِ واقعیِ فروش بی‌رمز رد
     * می‌شد (فاکتور ساخته نمی‌شد و انبار منفی نمی‌رفت — درحالی‌که UI دیگر
     * برای مسیر فروشگاهی رمز نمی‌خواست و کاربر با بن‌بست مواجه می‌شد).
     * خط دفاع سرویسیِ انتخاب انبار *دیگر* دست‌نخورده باقی می‌ماند.
     * =====================================================================
     */
    const posRequestedPlan =
      deductInventory && orderType === OrderType.INTERNAL ? normalizePlan((input as any).stockPlan) : null
    const posPlanRequested = posRequestedPlan != null
    const posPlanHasForeignSource = posPlanRequested && warehouseEntriesOf(posRequestedPlan).length > 0
    if (posPlanHasForeignSource)
      await assertPanelPassword(
        PANEL_KEYS.posCentralWithdrawToggle,
        input.panelPassword ?? null,
        'انتخاب انبار مبدأ کسر در پنل فروش تکی'
      )

    /**
     * نشست ۶۲ (S62-1/S62-2) — رمز مدیرِ «اعتبار اضافه‌دریافت بالاتر از سقف»،
     * مثل بالا *قبل از* تراکنش (نوشتن AuthLockout وسط تراکنش = بن‌بست SQLite).
     */
    /**
     * نشست ۶۳ (S63-2) — رمز مدیرِ «دوره‌ی بسته» هم قبل از تراکنش (همان دلیل بالا).
     */
    /** نشست ۱۵۶ (S151-c2، Y8) — عوارض/حق سرویس با تنظیمات main؛ رمز مدیر همین درخواست یک بار */
    const chargeCheck = await preverifySaleCharges(input, { orderType, alreadyVerified: pricing.managerApproved })
    const chargeApproved = pricing.managerApproved || chargeCheck.managerApproved
    const periodApproved = await periodLockService.preverify({
      at: issuedAt,
      what: 'ثبت فاکتور فروش',
      managerPassword: (input as any).managerPassword ?? null,
      overrideReason: (input as any).overrideReason ?? null,
      alreadyVerified: chargeApproved
    })
    const overpayManagerApproved =
      input.overpayAsCredit === true
        ? periodApproved ||
          chargeApproved ||
          (await preverifyOverpayManager(input, 'صدور اعتبار از اضافه‌دریافت فروش (بالاتر از سقف اعتبار)'))
        : false

    return prisma.$transaction(async (tx) => {
      /**
       * بند ۱۷ — قفل دوره‌ی بسته‌شده. ثبت فاکتور با تاریخ گذشته‌ای که صندوقش
       * بسته یا روزش تجمیع شده، فقط با رمز مدیر + دلیل، و با AuditLog کامل.
       */
      await periodLockService.assertOpen(tx, {
        at: issuedAt,
        what: 'ثبت فاکتور فروش',
        entity: 'SaleInvoice',
        managerVerified: periodApproved,
        managerPassword: (input as any).managerPassword ?? null,
        overrideReason: (input as any).overrideReason ?? null,
        userId: input.userId ?? null,
        after: { issuedAtJalali: input.issuedAtJalali ?? null, orderType }
      })
      const t = saleTotals(input)
      const defaults = await saleDefaultsWith(tx)
      /**
       * feature flag پرداخت ترکیبی: UI فقط راهنماست. درخواست IPC با مبلغِ دلخواه
       * اعتبار وقتی مدیر این قابلیت را بسته باشد، پیش از ساخت هر سند رد می‌شود.
       * `null` همان مصرف کاملِ سازگار با داده/رفتار قدیمی است.
       */
      if (input.storeCreditAmount != null && defaults.splitStoreCreditPayment === false)
        throw new BusinessError(
          'پرداخت ترکیبی اعتبار خرید در تنظیمات فروش خاموش است؛ مبلغ دلخواهِ مصرف اعتبار قابل ثبت نیست.'
        )

      /**
       * =====================================================================
       * نشست ۶۲ · بند ۴-۳۵ (S62-1) — اضافه‌دریافت «در فروش معمولی».
       *
       * باگ: فاکتور عمده «مبلغ دریافتی» را بی‌سقف می‌فرستد و این مسیر ۱٬۳۰۰ را
       * روی فاکتور ۱٬۰۰۰ بی‌هیچ هشدار و با overpayAmount = ۰ ثبت می‌کرد ⇒ ۳۰۰
       * ریال در پل تطبیق «بی‌توضیح» می‌ماند و هیچ ردی از پول اضافه نبود (خلاف
       * صریح «اضافه‌دریافت بی‌صدا کاملاً ممنوع»). حالا دقیقاً همان فلوی
       * `addPayment`: (۱) هشدار قابل‌تأیید «بله ثبت کن» · (۲/۳) `overpayAsCredit`
       * ⇒ کد اعتبار OVERPAY در همان تراکنش · (۴) فقط ردیف «دریافت پول اضافه».
       * main مستقل از UI می‌سنجد (پنل فروش تکی سقف دارد، ولی IPC را دور نمی‌زند).
       * =====================================================================
       */
      const saleOverpay = Math.max(0, Math.round(t.paidTotal) - Math.round(t.grandTotal))
      if (saleOverpay > 0 && input.confirmOverpay !== true)
        throw new BusinessError(
          `مبلغ دریافتی (${money(t.paidTotal)} ریال) از جمع کل این فاکتور (${money(t.grandTotal)} ریال) ` +
            `${money(saleOverpay)} ریال بیشتر است.\n` +
            'اگر آگاهانه می‌خواهید همین مبلغ کامل ثبت شود، «بله ثبت کن» را بزنید؛ مبلغ اضافه به‌صورت جدا ' +
            '(ردیف «دریافت پول اضافه») در گزارش فاکتور و گزارشات فروش نمایش داده می‌شود.'
        )
      if (input.overpayAsCredit === true && saleOverpay <= 0)
        throw new BusinessError(
          `مبلغ دریافتی (${money(t.paidTotal)} ریال) از جمع کل فاکتور (${money(t.grandTotal)} ریال) بیشتر نیست، ` +
            'پس مبلغ اضافه‌ای برای صدور اعتبار خرید وجود ندارد.'
        )

      /**
       * ---------------------------------------------------------------------
       * کمبود موجودی (مورد ۳) — دو حالت.
       *
       * الف) چک‌باکس «برداشت خودکار از انبار مرکزی» *خاموش* (پیش‌فرض):
       *      رفتار مو‌به‌مو همان قبل — فقط هشدار جمع می‌شود، فاکتور صادر و چاپ
       *      می‌گردد و موجودی همان کالا در انبار فروشگاه منفی می‌رود. انبار
       *      مرکزی مطلقاً لمس نمی‌شود.
       *
       * ب) چک‌باکس *روشن*:
       *      اول کمبود هر قلم از انبار مرکزی برداشته و به انبار فروشگاه منتقل
       *      می‌شود، بعد `checkAvailability` اجرا می‌شود. پس هشدار «موجودی منفی
       *      شد» فقط برای همان مقداری می‌آید که انبار مرکزی هم نداشته است، و
       *      هشدار زرد «از انبار مرکزی کسر شد» بالای آن می‌نشیند.
       * ---------------------------------------------------------------------
       */
      /**
       * ---------------------------------------------------------------------
       * جلسه ۴۷ · ج) «برنامه‌ی کسر» — پنجره‌ی «از کدام انبار کسر شود؟».
       *
       * فقط **فاکتور فروش عمده** این برنامه را می‌فرستد و فقط وقتی تیک
       * «برداشت خودکار از انبار مرکزی» *خاموش* باشد. با برنامه:
       *   • تیک خودکار (`coverShortage`) اصلاً صدا زده نمی‌شود — دو مسیر هرگز
       *     با هم اجرا نمی‌شوند، وگرنه یک کمبود دو بار پوشش داده می‌شد.
       *   • هشدار موجودی فقط برای **سهم انبار فروشگاه** حساب می‌شود، چون سهم
       *     انبارها اصلاً از `ProductVariant.stock` کم نمی‌شود.
       *   • خودِ اعمال، *بعد از* ساخته‌شدن فاکتور و داخل همین تراکنش است (چون
       *     دفتر مبدأ به `saleItemId` نیاز دارد) و همان‌جا دوباره اعتبارسنجی
       *     می‌شود.
       * ---------------------------------------------------------------------
       */
      const stockPlan = deductInventory ? normalizePlan((input as any).stockPlan) : null
      /**
       * جلسه ۵۲ · مرحله ۳ — دو نوع سند اجازه‌ی «مبدأ کسر» دارند و نه بیشتر:
       *   • `WHOLESALE` — فاکتور فروش عمده (جلسه ۴۷ تا ۵۱)، دست‌نخورده.
       *   • `INTERNAL`  — پنل فروش تکی، **و فقط با تأیید قفل** که همین بالا، قبل
       *     از باز شدن تراکنش، گرفته شده است (`posPlanRequested`).
       * تعویض (`EXCHANGE`)، بیرون‌بر و تلفنی مثل قبل رد می‌شوند: قاعده‌ی مالک
       * می‌گوید تعویض از تیک اثر می‌گیرد و پنجره‌ی سؤال ندارد.
       */
      if (stockPlan && !(orderType === OrderType.WHOLESALE || (orderType === OrderType.INTERNAL && posPlanRequested)))
        throw new BusinessError(
          'انتخاب انبار مبدأ فقط برای «فاکتور فروش عمده» و «پنل فروش تکی» (با تأیید مدیر) است. ' +
            'تعویض کالا و سفارش بیرون‌بر/تلفنی مثل قبل از انبار فروشگاه کسر می‌کنند.'
        )
      if (stockPlan && input.autoCentralWithdraw === true)
        throw new BusinessError(
          'تیک «برداشت خودکار از انبار مرکزی» روشن است، پس انتخاب انبار مبدأ معنا ندارد. ' +
            'یا تیک را خاموش کنید (سؤال پرسیده می‌شود) یا انتخاب انبار را نفرستید (رفتار خودکار).'
        )

      const central =
        !stockPlan && deductInventory && input.autoCentralWithdraw === true
          ? await secondaryStockService.coverShortage(
              tx,
              input.lines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
              {
                userId: input.userId ?? null,
                note:
                  (orderType === OrderType.WHOLESALE ? 'فاکتور فروش عمده' : 'پنل فروش تکی') +
                  ' · برداشت خودکار کمبود از انبار مرکزی'
              }
            )
          : { warnings: [] as string[], taken: [], totalTaken: 0 }

      /** سهمی از فاکتور که واقعاً از انبار فروشگاه کم می‌شود. */
      const storeShare = stockPlan
        ? storeLinesOf(stockPlan)
        : input.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }))

      const stockWarnings = deductInventory
        ? [...central.warnings, ...(storeShare.length ? await inventoryService.checkAvailability(storeShare, tx) : [])]
        : []

      // شیفت جاری (خودکار). فروش عمده هم به شیفت روز گره می‌خورد تا گزارش
      // «سرجمع فروش» هیچ فاکتوری را بی‌شیفت جا نگذارد.
      /**
       * نشست ۱۵۶ (Y12، بند ۴-۲، S156-D7) — شیفت فاکتور فقط شیفت باز لحظه‌ی ثبت است. قبلاً
       * shiftId ارسالی رندرر/IPC بی‌سنجش پذیرفته می‌شد و فروش امروز به شیفت دیگری (مثلاً شیفت
       * بسته‌ی همکار) نسبت داده می‌شد. UI هرگز shiftId نمی‌فرستد؛ عدد متفاوت ⇒ رد، نه نادیده‌گرفتن بی‌صدا.
       */
      const shiftId = await shiftService.currentId(tx, input.userId ?? null, (input as any).custodyFence ?? null)
      if (input.shiftId != null && Number(input.shiftId) !== shiftId)
        throw new BusinessError(
          `شیفت ارسالی (شماره‌ی داخلی ${faDigits(Number(input.shiftId))}) با شیفت باز لحظه‌ی ثبت ` +
            `(${shiftId == null ? 'بدون شیفت باز' : 'شماره‌ی داخلی ' + faDigits(shiftId)}) فرق دارد؛ ` +
            'فروش همیشه به شیفت بازِ همین لحظه نسبت داده می‌شود. صفحه را تازه کنید و دوباره ثبت کنید.'
        )
      /** A custody writer must carry a Main-verified operator record.  Direct
       * service callers cannot manufacture the non-enumerable verification
       * token, and renderer fields never reach this point as evidence. */
      const custodyFence = (input as any).custodyFence
      if (custodyGoverned && !custodyFence)
        throw new BusinessError('فروش حضانت‌دار باید با fence همان مسئول فعال ثبت شود؛ صفحه را تازه کنید و دوباره تلاش کنید.', 'CUSTODY_OPERATOR_EVIDENCE_REQUIRED')
      if (custodyFence && !verifiedOperator)
        throw new BusinessError('هویت اپراتور فروش از مسیر امن تأیید نشده است؛ صفحه را تازه کنید و دوباره تلاش کنید.', 'CUSTODY_OPERATOR_EVIDENCE_REQUIRED')
      if (verifiedOperator && (
        shiftId == null ||
        Number(input.userId) !== verifiedOperator.custodianUserId ||
        shiftId !== verifiedOperator.custodyShiftId
      ))
        throw new BusinessError('شاهد اپراتور با مسئولیت فعلی صندوق هم‌خوان نیست؛ فروش ثبت نشد.', 'CUSTODY_OPERATOR_STALE')

      /**
       * -------------------------------------------------------------------
       * «کد فاکتور» و مهلت برگشت — فروش تکی و فاکتور فروش عمده (مورد ۷).
       *
       * قبلاً کد فقط برای فروش تکی ساخته می‌شد. حالا فاکتور فروش عمده هم دقیقاً
       * همان مسیر را دارد (کد رندوم + بارکد روی رسید + اعتبار زمانی)، ولی با
       * *اعداد مستقل خودش* در تنظیمات:
       *     wholesaleReturnCode · wholesaleReturnCodeDays ·
       *     wholesaleReturnCodeDaysRemote · wholesaleReturnCodeLength
       * پس تغییر مهلت برگشت خرده هیچ اثری روی عمده ندارد و برعکس. اگر
       * `wholesaleReturnCode` خاموش شود، فاکتور عمده مثل نسخه‌ی قبل بدون کد ثبت
       * می‌شود.
       *
       * «مشتری راه دور» در هر دو پنل یک مهلت مستقل و بلندتر دارد (پیش‌فرض ۱۴ روز).
       * -------------------------------------------------------------------
       */
      const isWholesale = orderType === OrderType.WHOLESALE
      const withCode = isWholesale ? defaults.wholesaleReturnCode !== false : true
      const remoteCustomer = input.remoteCustomer === true
      const returnDays = isWholesale
        ? remoteCustomer
          ? defaults.wholesaleReturnCodeDaysRemote
          : defaults.wholesaleReturnCodeDays
        : remoteCustomer
          ? defaults.returnCodeDaysRemote
          : defaults.returnCodeDays
      const codeLength = isWholesale ? defaults.wholesaleReturnCodeLength : defaults.returnCodeLength
      const generated = withCode
        ? await generateReturnCode(tx, {
            length: codeLength,
            days: returnDays,
            issuedAt
          })
        : null

      // مشتری: شناسه‌ی صریح، یا پیدا/ساختن با شماره تلفن (مورد ۶)
      const customerId = await resolveCustomer(tx, input)

      const invoice = await tx.saleInvoice.create({
        data: {
          receiptNo: await nextReceiptNo(tx),
          customerId,
          userId: input.userId ?? null,
          shiftId,
          issuedAt,
          issuedAtJalali: toJalaliDate(issuedAt),
          status: SaleStatus.SETTLED,
          orderType,
          deductInventory,
          wholesaleDiscountPercent,
          tableNo: input.tableNo?.trim() || null,
          returnCode: generated?.code ?? null,
          returnCodeExpiresAt: generated?.expiresAt ?? null,
          goodsTotal: t.goodsTotal,
          taxTotal: t.taxTotal,
          serviceCharge: t.serviceCharge,
          discountTotal: t.discountTotal,
          deliveryFee: t.deliveryFee,
          grandTotal: t.grandTotal,
          paidTotal: t.paidTotal,
          /**
           * «تسویه‌شده» فقط وقتی همان لحظه‌ی صدور کامل پرداخت شده باشد.
           * فاکتور نسیه (پرداختی جزئی) با settledAt خالی ثبت می‌شود و در فهرست
           * «فاکتورهای عمده» به‌عنوان تسویه‌نشده با باقی‌مانده دیده می‌شود.
           */
          settledAt: t.paidTotal >= t.grandTotal ? issuedAt : null,
          settledAtJalali: t.paidTotal >= t.grandTotal ? toJalaliDate(issuedAt) : null,
          note: input.note,
          items: { create: await saleItemRows(tx, input.lines) },
          // پرداختی اول، با تاریخ و ساعت خودش (شماره‌ی ترتیبی ۱)
          payments: { create: await initialPaymentRows(tx, input, issuedAt, { shiftId }) }
        },
        include: { items: true, payments: { include: { method: true } }, customer: true, shift: true }
      })

      if (verifiedOperator) {
        await (tx as any).custodySaleEvidence.create({
          data: {
            invoiceId: invoice.id,
            custodyShiftId: verifiedOperator.custodyShiftId,
            custodianUserId: verifiedOperator.custodianUserId,
            operatorKind: verifiedOperator.operatorKind,
            operatorUserId: verifiedOperator.operatorUserId,
            authMethod: verifiedOperator.authMethod
          }
        })
      }

      /** نشست ۱۵۴ (S151-b) — قیمت دستی (کاهش یا افزایش) در AuditLog، داخل همین تراکنش */
      await writeSalePriceOverrideAudit(tx, {
        invoiceId: invoice.id,
        receiptNo: invoice.receiptNo,
        userId: input.userId ?? null,
        what: 'ثبت فاکتور فروش',
        check: pricing
      })
      await writeSaleChargeOverrideAudit(tx, {
        invoiceId: invoice.id,
        receiptNo: invoice.receiptNo,
        userId: input.userId ?? null,
        what: 'ثبت فاکتور فروش',
        check: chargeCheck,
        approved: chargeApproved
      })

      /**
       * کسر انبار فقط وقتی فاکتور «با کسر از موجودی» است.
       *
       * جلسه ۴۷ — با «برنامه‌ی کسر»، اول خودِ برنامه اعمال و دوباره اعتبارسنجی
       * می‌شود (سهم انبارها مستقیم از ردیف‌های همان انبار) و بعد **فقط سهم
       * انبار فروشگاه** از همان مسیر همیشگیِ `inventoryService.decrease`
       * (با همان `reason: 'SALE'` و `state: PENDING`) کم می‌گردد. بی برنامه،
       * این بلوک مو‌به‌مو همان کد قبل است.
       */
      let allocation: Awaited<ReturnType<typeof stockAllocationService.applyPlan>> | null = null
      if (deductInventory) {
        if (stockPlan) {
          allocation = await stockAllocationService.applyPlan(tx, {
            plan: stockPlan,
            invoiceId: invoice.id,
            receiptNo: invoice.receiptNo,
            items: invoice.items.map((i) => ({ id: i.id, variantId: i.variantId, qty: i.qty })),
            userId: input.userId ?? null,
            what: 'ثبت فاکتور فروش عمده'
          })
          stockWarnings.push(...allocation.warnings)
        }
        const decreaseLines = allocation ? allocation.storeLines : storeShare
        if (decreaseLines.length)
          await inventoryService.decrease(
            decreaseLines,
            {
              reason: 'SALE',
              refType: 'SaleInvoice',
              refId: invoice.id,
              state: StockState.PENDING,
              userId: input.userId ?? null
            },
            tx
          )
      }

      await audit(tx, {
        action: orderType === OrderType.WHOLESALE ? AuditAction.WHOLESALE_SALE_CREATE : AuditAction.SALE_CREATE,
        entity: 'SaleInvoice',
        entityId: invoice.id,
        userId: input.userId ?? null,
        after: JSON.stringify({
          receiptNo: invoice.receiptNo,
          orderType,
          customerId: invoice.customerId,
          issuedAtJalali: invoice.issuedAtJalali,
          shiftId,
          returnCode: invoice.returnCode,
          lines: invoice.items.length,
          goodsTotal: t.goodsTotal,
          discountTotal: t.discountTotal,
          grandTotal: t.grandTotal,
          paidTotal: t.paidTotal,
          deductInventory,
          wholesaleDiscountPercent,
          custodyOperator: verifiedOperator
            ? { kind: verifiedOperator.operatorKind, userId: verifiedOperator.operatorUserId, authMethod: verifiedOperator.authMethod }
            : null
        }),
        note:
          (deductInventory ? 'با کسر از موجودی انبار' : 'بدون کسر از موجودی انبار') +
          (central.totalTaken > 0 ? ` · ${central.totalTaken} عدد از انبار مرکزی برداشته شد` : '') +
          // جلسه ۴۷ — مبدأ کسر، به تفکیک انبار (خالی = فقط انبار فروشگاه)
          (allocation ? ` · مبدأ کسر: ${allocation.summaryLines.join(' | ')}` : '') +
          (stockWarnings.length ? ' · با کمبود موجودی' : '') +
          (remoteCustomer ? ' · مشتری راه دور' : '') +
          // نشست ۶۲ — اضافه‌دریافت هیچ‌وقت بی‌ردّ نیست
          (saleOverpay > 0
            ? ` · دریافت پول اضافه ${money(saleOverpay)} ریال (با تأیید آگاهانه` +
              (input.overpayAsCredit === true ? '، تبدیل به اعتبار خرید غیرقابل نقد شدن)' : ')')
            : '')
      })

      /**
       * -------------------------------------------------------------------
       * بخش ۶ — مصرف «بارکد اعتبار خرید بعدی» روی همین فاکتور.
       *
       * چرا *بعد از* ساخت فاکتور و داخل همان تراکنش؟ چون رکورد اعتبار باید به
       * شناسه و شماره فیش همین فاکتور گره بخورد (ردیابی «کجا خرج شد؟»)، و چون
       * اگر اعتبار نامعتبر باشد باید *کل* فاکتور برگردد نه این‌که فاکتوری بدون
       * آن پرداختی ثبت شود. اعتبارسنجی (وجود، مصرف‌نشده، منقضی‌نشده) و
       * علامت‌زدن یک‌بارمصرف داخل `redeemStoreCredit` است.
       *
       * سقف جذب = باقی‌ماندهٔ همین فاکتور. اگر اعتبار بیشتر بود، مابقی به‌صورت
       * یک بارکد جدید به مشتری برمی‌گردد (سوخت نمی‌شود).
       * -------------------------------------------------------------------
       */
      let storeCredit: StoreCreditSafeRow | null = null
      let storeCreditRemainder: StoreCreditSafeRow | null = null
      let storeCreditApplied = 0
      let settledPaidTotal = t.paidTotal
      const creditCode = String(input.storeCreditCode ?? '').trim()
      if (creditCode) {
        const redeemed = await redeemStoreCredit(tx, {
          code: creditCode,
          invoiceId: invoice.id,
          receiptNo: invoice.receiptNo,
          applicable: Math.max(0, t.grandTotal - t.paidTotal),
          // جلسه ۲۱ — مبنای «حداقل مبلغ خرید» جمع کل فاکتور است، نه باقی‌مانده‌اش (§۱۸)
          invoiceTotal: t.grandTotal,
          /**
           * پرداخت ترکیبی (§۱۷): اگر فروشنده مبلغ مشخصی خواسته باشد، همان
           * می‌رود — ولی سقف واقعی را `decideRedeem` تعیین می‌کند، نه UI.
           */
          requested: input.storeCreditAmount == null ? null : Math.max(0, Math.round(Number(input.storeCreditAmount) || 0)),
          /** §۲۱ — همان درخواست دوبار برسد، دوبار کم نمی‌شود */
          idempotencyKey:
            String(input.storeCreditIdempotencyKey ?? '').trim() || `sale:${invoice.id}:${normalizeReturnCode(creditCode)}`,
          customerId,
          customerName: invoice.customer?.name ?? null,
          userId: input.userId ?? null,
          shiftId: invoice.shiftId ?? null,
          usedAt: issuedAt,
          seq: (input.payments ?? []).length + 1
        })
        storeCreditApplied = redeemed.applied
        storeCredit = shapeStoreCreditSafe(redeemed.credit)
        storeCreditRemainder = redeemed.remainder ? shapeStoreCreditSafe(redeemed.remainder) : null
        // پرداختی جدید اضافه شد ⇒ جمع پرداختی و علامت «تسویه‌شده» بازمحاسبه می‌شوند
        const settle = await recalcSettlement(tx, invoice.id)
        settledPaidTotal = settle.paidTotal
      }

      /**
       * نشست ۶۲ (S62-1) — مبلغ اضافه روی ردیف(های) پرداخت همان تابع واحد
       * `recalcPaymentOverpay` (از راه recalcSettlement) نوشته می‌شود تا پل و
       * گزارش فاکتور همان عددی را ببینند که addPayment می‌نویسد. سپس اگر
       * فروشنده «کد اعتبار صادر شود» را زده بود، در همین تراکنش صادر می‌شود
       * (خطا ⇒ کل فاکتور rollback، هیچ نیمه‌ثبتی).
       */
      let overpayCredit: OverpayCreditResult | null = null
      if (saleOverpay > 0) {
        const settle = await recalcSettlement(tx, invoice.id, { userId: input.userId ?? null })
        settledPaidTotal = settle.paidTotal
        if (input.overpayAsCredit === true) {
          const firstPay = invoice.payments.slice().sort((a: any, b: any) => (a.seq ?? 0) - (b.seq ?? 0))[0] as any
          overpayCredit = await issueOverpayCreditTx(tx, {
            invoiceId: invoice.id,
            amount: settle.overpayTotal,
            paymentId: invoice.payments.length === 1 ? firstPay?.id ?? null : null,
            paymentSeq: invoice.payments.length === 1 ? firstPay?.seq ?? null : null,
            userId: input.userId ?? null,
            managerApproved: overpayManagerApproved
          })
        }
      }

      /**
       * هشدارهای موجودی همراه خود فاکتور برمی‌گردند تا پنل فروش همان کادر زرد
       * همیشگی را نشان دهد — ولی فاکتور ثبت‌شده است و چاپ هم می‌شود.
       */
      return {
        ...invoice,
        paidTotal: settledPaidTotal,
        /** بخش ۶: اعتبار مصرف‌شده روی همین فاکتور (پول نقد نیست) */
        storeCredit,
        storeCreditApplied,
        storeCreditRemainder,
        stockWarnings,
        /** جزئیات برداشت از انبار مرکزی (خالی = هیچ برداشتی انجام نشده) */
        centralWithdrawals: central.taken,
        centralWithdrawnQty: central.totalTaken,
        /**
         * جلسه ۴۷ — «خلاصه‌ی کسری‌ها»ی همین فاکتور (بند ۳). `null` یعنی برنامه‌ی
         * کسر نفرستاده شده و مثل قبل همه از انبار فروشگاه کم شده است.
         */
        stockSources: allocation
          ? {
              groups: allocation.groups,
              lines: allocation.summaryLines,
              warehouseTakenQty: allocation.warehouseTakenQty,
              hasNegative: planHasNegative(allocation.plan)
            }
          : null,
        returnCodeDays: returnDays,
        remoteCustomer,
        /** باقی‌مانده‌ی همین لحظه (فروش نسیه) — پنل فروش عمده نمایشش می‌دهد */
        remaining: Math.max(0, t.grandTotal - settledPaidTotal),
        settled: settledPaidTotal >= t.grandTotal,
        /** نشست ۶۲ — مبلغ اضافه‌ی دریافتی همین فاکتور (۰ = عادی) */
        overpayAmount: saleOverpay,
        /** Operator evidence is intentionally separate from `userId`: the latter
         * remains the physical drawer custodian for all financial reports. */
        custodyOperator: verifiedOperator
          ? { kind: verifiedOperator.operatorKind, userId: verifiedOperator.operatorUserId, authMethod: verifiedOperator.authMethod }
          : null,
        /** نشست ۶۲ — مرجع امنِ اعتبار صادرشده از مبلغ اضافه (null = مرحله ۴) */
        overpayCredit: shapeOverpayCreditSafe(overpayCredit)
      }
    }, TX_OPTIONS)
  },

  /**
   * ---------------------------------------------------------------------
   * ویرایش یک فاکتور فروش ثبت‌شده (هم عمده و هم POS).
   *
   * `input.lines` / `input.payments` حالت *نهایی* فاکتور هستند. رکورد فاکتور
   * سر جای خودش می‌ماند (شماره فیش و کد فاکتور عوض نمی‌شوند) و فقط اقلام و
   * پرداخت‌هایش بازنویسی می‌شوند.
   *
   * موجودی: delta محاسبه می‌شود، نه «حذف کل و ساخت از صفر».
   * ---------------------------------------------------------------------
   */
  async update(input: UpdateSaleInput) {
    validateSaleInput(input)
    if (!input.id) throw new BusinessError('فاکتوری برای ویرایش مشخص نشده است')

    /**
     * نشست ۶۳ (S63-2) — تاریخ فاکتور بیرون از تراکنش خوانده می‌شود تا رمز مدیرِ
     * «دوره‌ی بسته» و رمز «اعتبار اضافه‌دریافت بالاتر از سقف» هر دو **قبل از**
     * تراکنش سنجیده شوند (نوشتن AuthLockout وسط تراکنش = قفل SQLite).
     */
    const pre = await prisma.saleInvoice.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        issuedAt: true,
        issuedAtJalali: true,
        receiptNo: true,
        orderType: true,
        // سند لغو یا پیش‌نویس مدرک فروش قابل‌ویرایش نیست: ویرایش آن می‌توانست پس از
        // باطل‌شدن همهٔ پرداخت‌ها، پرداخت تازه‌ای بسازد و paidTotal را دوباره پر کند.
        status: true,
        voidedAt: true,
        // نشست ۱۵۶ (S151-c2) — عوارض/حق سرویس ذخیره‌شده برای «ویرایش بدون تغییر عوارض»
        taxTotal: true,
        serviceCharge: true,
        discountTotal: true,
        // نشست ۱۶۵ (S165-D2) — qty: مرجع فاکتور اصلی فقط برای همان تعداد
        items: { select: { variantId: true, unitPrice: true, qty: true, discount: true, tax: true } }
      }
    })
    /**
     * نشست ۱۵۴ (S151-b) — فاکتور ناموجود پیش از هر رمز رد می‌شود (هیچ تلاش رمزی
     * مصرف نمی‌شود). مرجع قیمت ویرایش = کمترین قیمت همان کالا در فاکتور اصلی؛
     * سیاست تخفیف با orderType نهایی (ورودی یا همان فاکتور) سنجیده می‌شود.
     */
    if (!pre) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد. لیست فاکتورها را تازه کنید.')
    if (pre.status === SaleStatus.CANCELED || pre.status === SaleStatus.DRAFT || pre.voidedAt != null)
      throw new BusinessError('فاکتور لغوشده یا پیش‌نویس قابل ویرایش نیست؛ هیچ کالا یا پرداختی تغییر نکرد.')
    const orderTypeForUpdate = input.orderType ?? pre.orderType
    const pricing = await preverifySalePolicy(input, {
      orderType: orderTypeForUpdate,
      // نشست ۱۸۱: `unitPrice` حالا BigInt است؛ سیاست‌سنج با number کار می‌کند.
      originalItems: pre.items.map((i) => ({ ...i, unitPrice: toNumberRial(i.unitPrice) }))
    })
    /**
     * نرخ تاریخی فقط برای ویرایش واقعاً بی‌تغییر حفظ می‌شود. signature شامل
     * tax هم هست تا جابه‌جایی عوارض میان ردیف‌ها با جمع یکسان، مسیر را باز نکند.
     */
    const signature = (line: { variantId: number; qty: unknown; unitPrice: unknown; discount?: unknown; tax?: unknown }) =>
      [line.variantId, Math.round(Number(line.qty)), Math.round(Number(line.unitPrice)), Math.round(Number(line.discount ?? 0)), Math.round(Number(line.tax ?? 0))].join(':')
    const priorLineDiscount = pre.items.reduce((sum, item) => sum + toNumberRial(item.discount), 0)
    const priorInvoiceDiscount = Math.max(0, toNumberRial(pre.discountTotal) - priorLineDiscount)
    const historicalBasisUnchanged =
      orderTypeForUpdate === pre.orderType &&
      Math.round(Number(input.invoiceDiscount ?? 0)) === priorInvoiceDiscount &&
      (input.lines ?? []).length === pre.items.length &&
      [...(input.lines ?? [])].map(signature).sort().join('|') ===
        pre.items
          .map((item) =>
            signature({
              variantId: item.variantId,
              qty: item.qty,
              unitPrice: toNumberRial(item.unitPrice),
              discount: toNumberRial(item.discount),
              tax: toNumberRial(item.tax)
            })
          )
          .sort()
          .join('|')
    /** نشست ۱۵۶ (S151-c2، Y8) — فقط سبد واقعاً یکسان نرخ تاریخی را نگه می‌دارد. */
    const chargeCheck = await preverifySaleCharges(input, {
      orderType: orderTypeForUpdate,
      existing: {
        taxTotal: toNumberRial(pre.taxTotal),
        serviceCharge: toNumberRial(pre.serviceCharge),
        historicalBasisUnchanged
      },
      alreadyVerified: pricing.managerApproved
    })
    const chargeApproved = pricing.managerApproved || chargeCheck.managerApproved
    const periodApproved = await periodLockService.preverify({
      at: pre.issuedAt,
      what: `ویرایش فاکتور ${faDigits(pre.receiptNo)}`,
      managerPassword: (input as any).managerPassword ?? null,
      overrideReason: (input as any).overrideReason ?? null,
      alreadyVerified: chargeApproved
    })
    const destJalali = input.issuedAtJalali ? String(input.issuedAtJalali).trim() : ''
    const destAt = destJalali ? jalaliToDateTime(destJalali) : pre.issuedAt
    const destPeriodApproved =
      destJalali && destJalali !== String(pre.issuedAtJalali ?? '')
        ? await periodLockService.preverify({
            at: destAt,
            what: `انتقال فاکتور ${faDigits(pre.receiptNo)} به تاریخ ${destJalali}`,
            managerPassword: (input as any).managerPassword ?? null,
            overrideReason: (input as any).overrideReason ?? null
          })
        : periodApproved
    const overpayManagerApproved =
      input.overpayAsCredit === true
        ? periodApproved ||
          chargeApproved ||
          (await preverifyOverpayManager(input, 'صدور اعتبار از اضافه‌دریافت ویرایش فاکتور (بالاتر از سقف اعتبار)'))
        : false

    /**
     * نشست ۲۱۴ · C1 — بازنویسی پرداخت از ویرایش اقلام گیت نشست ۲۱۱/۲۰۲ را دور می‌زد.
     * UI همیشه keepPayments می‌فرستد؛ IPC با `payments` نقد را به کارت تبدیل یا
     * باطل می‌کرد و صندوق بی‌کسری بسته می‌شد. تغییر پرداخت فقط از پنجرهٔ پرداختی‌ها.
     */
    if (input.keepPayments !== true && input.payments != null) {
      const livePays = await prisma.payment.count({ where: { invoiceId: input.id, voidedAt: null } })
      if (livePays > 0)
        throw new BusinessError(
          'تغییر یا ابطال پرداخت‌های این فاکتور از ویرایش اقلام ممکن نیست. از پنجرهٔ «پرداختی‌ها» استفاده کنید ' +
            '(همان گیت رمز ویرایش/ابطال پرداخت). هیچ تغییری ذخیره نشد.'
        )
    }

    return prisma.$transaction(async (tx) => {
      const current = await tx.saleInvoice.findUnique({
        where: { id: input.id },
        include: {
          items: true,
          /** نشست ۲۰۵ — پرداخت باطل‌شده اضافه‌دریافت زنده نیست؛ در prevOverpay نیاید. */
          payments: { where: { voidedAt: null } },
          returns: { where: { voidedAt: null }, select: { id: true } }
        }
      })
      if (!current) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد. لیست فاکتورها را تازه کنید.')
      // بررسی دوباره داخل تراکنش، فاصلهٔ بین preflight و نوشتن را هم fail-closed می‌کند.
      if (current.status === SaleStatus.CANCELED || current.status === SaleStatus.DRAFT || current.voidedAt != null)
        throw new BusinessError('فاکتور لغوشده یا پیش‌نویس قابل ویرایش نیست؛ هیچ کالا یا پرداختی تغییر نکرد.')

      // بند ۱۷ — ویرایش فاکتوری که تاریخش در دوره‌ی بسته‌شده است
      await periodLockService.assertOpen(tx, {
        at: current.issuedAt,
        what: `ویرایش فاکتور ${faDigits(current.receiptNo)}`,
        entity: 'SaleInvoice',
        entityId: current.id,
        managerVerified: periodApproved,
        managerPassword: (input as any).managerPassword ?? null,
        overrideReason: (input as any).overrideReason ?? null,
        userId: input.userId ?? null,
        before: { receiptNo: current.receiptNo, grandTotal: current.grandTotal, issuedAt: current.issuedAt }
      })
      if (destJalali && destJalali !== String(current.issuedAtJalali ?? '')) {
        await periodLockService.assertOpen(tx, {
          at: destAt,
          what: `انتقال فاکتور ${faDigits(current.receiptNo)} به تاریخ ${destJalali}`,
          entity: 'SaleInvoice',
          entityId: current.id,
          managerVerified: destPeriodApproved,
          managerPassword: (input as any).managerPassword ?? null,
          overrideReason: (input as any).overrideReason ?? null,
          userId: input.userId ?? null,
          before: { receiptNo: current.receiptNo, issuedAtJalali: current.issuedAtJalali },
          after: { issuedAtJalali: destJalali }
        })
      }

      // قواعد کسب‌وکار: دو حالتی که ویرایش، سابقه‌ی مالی/انباری را بی‌معنا می‌کند.
      if (current.returns.length)
        throw new BusinessError(
          `فاکتور شماره ${faDigits(current.receiptNo)} برگشت از فروش دارد و ویرایش اقلامش موجودی و سابقه‌ی برگشت را ناهم‌خوان می‌کند. ` +
            'برای اصلاح، یک فاکتور جدید ثبت کنید.'
        )
      if (current.consolidationId)
        throw new BusinessError(
          `فاکتور شماره ${faDigits(current.receiptNo)} در «تجمیع و انتقال» قطعی شده و جمع‌های آن بازه بسته شده است، پس قابل ویرایش نیست. ` +
            'برای اصلاح، یک فاکتور جدید در بازه‌ی جاری ثبت کنید.'
        )

      const deductInventory = input.deductInventory ?? current.deductInventory
      const orderType = input.orderType ?? current.orderType
      const issuedAt = input.issuedAtJalali ? jalaliToDateTime(input.issuedAtJalali) : current.issuedAt
      const wholesaleDiscountPercent =
        input.wholesaleDiscountPercent == null
          ? null
          : Math.min(Math.max(Math.round(input.wholesaleDiscountPercent), 0), 100)

      /**
       * =====================================================================
       * جلسه ۴۷ — ویرایش فاکتوری که «دفتر مبدأ کسر» دارد.
       *
       * دو مسیر کاملاً جدا، و مرزشان یک شرط ساده است: «این فاکتور ردیفی در
       * `SaleItemStockAllocation` دارد؟»
       *
       *   • ندارد (هر فاکتور قبل از این نسخه، و هر فاکتور پنل فروش تکی) ⇒
       *     مسیر تاریخیِ delta، **مو‌به‌مو دست‌نخورده**.
       *   • دارد ⇒ delta بی‌معنا است، چون اختلافِ «۲ عدد» نمی‌گوید از کدام انبار.
       *     پس کل مبدأهای قبلی **به همان انبارها برگردانده** می‌شود و برنامه‌ی
       *     تازه‌ی کاربر از نو اعمال می‌گردد. عمداً هیچ حدسی زده نمی‌شود: اگر
       *     پنجره‌ی انتخاب انبار اجرا نشده باشد، ویرایش **رد** می‌شود.
       * =====================================================================
       */
      const editPlan = deductInventory ? normalizePlan((input as any).stockPlan) : null
      if (editPlan && orderType !== OrderType.WHOLESALE)
        throw new BusinessError('انتخاب انبار مبدأ فقط برای «فاکتور فروش عمده» است.')
      if (editPlan && input.autoCentralWithdraw === true)
        throw new BusinessError(
          'تیک «برداشت خودکار از انبار مرکزی» روشن است، پس انتخاب انبار مبدأ معنا ندارد.'
        )
      const hadAllocations = await stockAllocationService.hasAllocations(tx, current.id)
      /**
       * =====================================================================
       * جلسه ۵۲ · بند ۰ — گپی که جلسه ۵۱ صریحاً برای همین نشست باز گذاشت.
       *
       * مسیر دفتر‌دار «برگشت کامل مبدأهای قبلی ← اعمال برنامه‌ی تازه» است، ولی
       * برگشت فقط وقتی اتفاق می‌افتد که فاکتور **دفتر مبدأ** داشته باشد
       * (`reverted` پایین‌تر: `allocationPath && hadAllocations`) و
       * `increase = reverted?.storeLines ?? []`. پس برای فاکتورِ **بی‌دفتر**
       * (هر فاکتور قبل از جلسه ۴۷) فرستادن `stockPlan` یعنی:
       *   کسرِ قبلی هیچ‌وقت برنمی‌گشت + برنامه‌ی تازه از نو کسر می‌کرد ⇒ **کسر دوباره**.
       *
       * چرا «رد» و نه «لحاظ کردن `delta.increase`»: مقدارِ delta فقط *اختلاف
       * تعداد* را می‌داند و **نمی‌داند کسرِ قبلی از کدام انبار بوده** (دفتری نبوده
       * که بگوید). پس هر برگشتی حدس است و حدس روی موجودی انبار ممنوع. رابط کاربری
       * از جلسه ۵۱ همین کار را می‌کند (`stockPathFor(...).legacyEdit` ⇒ منو قفل و
       * برنامه فرستاده نمی‌شود)؛ این خط همان قاعده را **سمت سرور** هم می‌گذارد تا
       * یک تماس مستقیم IPC نتواند دورش بزند. ویرایش این فاکتورها مثل قبل، با
       * مسیر تاریخیِ delta، کار می‌کند — فقط بی انتخاب انبار.
       * =====================================================================
       */
      if (editPlan && !hadAllocations)
        throw new BusinessError(
          `فاکتور شماره ${faDigits(current.receiptNo)} قبلاً **بدون** دفتر «مبدأ کسر» ثبت شده است ` +
            '(فاکتورهای قبل از این نسخه)، پس معلوم نیست کسر قبلی از کدام انبار بوده و برگشتش ممکن نیست. ' +
            'انتخاب انبار مبدأ برای این فاکتور پذیرفته نمی‌شود؛ ویرایشش را بدون انتخاب انبار ذخیره کنید ' +
            '(موجودی مثل قبل، از انبار فروشگاه، اصلاح می‌شود).'
        )
      const allocationPath = hadAllocations || !!editPlan
      if (hadAllocations && deductInventory && !editPlan)
        throw new BusinessError(
          `فاکتور شماره ${faDigits(current.receiptNo)} موجودی‌اش را از انبارهای مشخصی کم کرده است، پس ویرایشش بدون ` +
            'تعیین مبدأ کسر ممکن نیست. پنجره‌ی «از کدام انبار کسر شود؟» را کامل کنید و دوباره ذخیره بزنید.'
        )

      /**
       * برگشتِ کاملِ مبدأهای قبلی — *قبل از* بازنویسی اقلام، تا دفتر مبدأ با
       * `saleItemId` های واقعی خوانده شود. سهم انبارها همان‌جا به انبارهایش
       * برمی‌گردد و سهم فروشگاه برمی‌گردد تا پایین با `increase` اضافه شود.
       */
      const reverted = allocationPath && hadAllocations
        ? await stockAllocationService.reverseWholeInvoice(tx, {
            invoiceId: current.id,
            receiptNo: current.receiptNo,
            userId: input.userId ?? current.userId ?? null,
            reason: `ویرایش فاکتور فروش عمده ${faDigits(current.receiptNo)} · برگشت مبدأهای قبلی`
          })
        : null
      if (hadAllocations) await stockAllocationService.dropAllocations(tx, [current.id])

      const delta = stockDeltas(current.items, current.deductInventory, input.lines, deductInventory)
      /**
       * مسیر دفتر‌دار: «کسر» = سهم فروشگاه در برنامه‌ی تازه · «برگشت» = سهم
       * فروشگاه در مبدأهای قبلی. مسیر تاریخی: عیناً همان delta قبل.
       */
      const decrease = allocationPath ? (editPlan ? storeLinesOf(editPlan) : []) : delta.decrease
      const increase = allocationPath ? (reverted?.storeLines ?? []) : delta.increase

      /**
       * کمبود موجودی فقط هشدار است (مورد ۳)، و فقط برای مقداری که *اضافه* می‌شود.
       * اگر چک‌باکس «برداشت خودکار از انبار مرکزی» روشن باشد، همان‌طور که در
       * ثبت فاکتور عمل می‌کنیم، اول کمبودِ همین اختلاف از انبار مرکزی برداشته
       * می‌شود. خاموش که باشد (پیش‌فرض)، مسیر دقیقاً همان قبل است.
       */
      const centralEdit =
        !allocationPath && deductInventory && decrease.length && input.autoCentralWithdraw === true
          ? await secondaryStockService.coverShortage(tx, decrease, {
              userId: input.userId ?? null,
              note: 'ویرایش فاکتور فروش · برداشت خودکار کمبود از انبار مرکزی'
            })
          : { warnings: [] as string[], taken: [], totalTaken: 0 }

      const stockWarnings: string[] = decrease.length
        ? [...centralEdit.warnings, ...(await inventoryService.checkAvailability(decrease, tx))]
        : [...centralEdit.warnings]

      const before = {
        receiptNo: current.receiptNo,
        issuedAtJalali: current.issuedAtJalali,
        customerId: current.customerId,
        orderType: current.orderType,
        deductInventory: current.deductInventory,
        wholesaleDiscountPercent: current.wholesaleDiscountPercent,
        goodsTotal: current.goodsTotal,
        discountTotal: current.discountTotal,
        grandTotal: current.grandTotal,
        paidTotal: current.paidTotal,
        /** snapshot کامل ردیف‌ها؛ برای خواندن timeline فاکتور هم قابل بازسازی است. */
        items: invoiceItemRevisionRows(current.items),
        payments: current.payments.map((p) => ({ methodId: p.methodId, amount: p.amount }))
      }

      /**
       * -------------------------------------------------------------------
       * تاریخچه‌ی پرداختی‌ها در ویرایش (فروش نسیه).
       *
       * ویرایش فاکتور *فقط اقلام* را بازنویسی می‌کند. پرداختی‌ها (پرداختی اول،
       * دوم، … و چک‌ها) تاریخچه‌ی مالی‌اند و با ویرایش اقلام پاک نمی‌شوند —
       * وگرنه تاریخ و ساعت هر قسط از بین می‌رفت.
       *
       * `keepPayments: true` (همان چیزی که پنل فاکتور فروش عمده می‌فرستد) یا
       * نفرستادن `payments` ⇒ پرداختی‌ها دست‌نخورده می‌مانند و در پایان فقط
       * `paidTotal` و علامت «تسویه‌شده» بازمحاسبه می‌شوند.
       * در غیر این صورت رفتار همان قبل است: پرداختی‌ها با مقدار ارسالی بازنویسی
       * می‌شوند.
       * -------------------------------------------------------------------
       */
      const keepPayments = input.keepPayments === true || input.payments == null

      /**
       * اقلامِ زنده برای سازگاری با حواله‌های انبار و `SaleReturnItem.saleItemId`
       * همچنان replace می‌شوند، اما حذف حتی یک ردیف بدون سندِ قابل‌پرس‌وجو مجاز
       * نیست. `auditOrThrow` برخلاف audit عادی fail-closed است: اگر snapshot
       * نوشته نشود، کل تراکنش rollback می‌شود و delete هرگز commit نمی‌شود.
       *
       * entity + entityId روی AuditLog ایندکس دارد؛ پس این یک دفتر append-only
       * و مستقل از نمایش عمومیِ timeline است، نه JSON پراکنده در یادداشت فاکتور.
       */
      const replacementItems = await saleItemRows(tx, input.lines)
      await auditOrThrow(tx, {
        action: AuditAction.SALE_UPDATE,
        entity: 'SaleInvoiceItemRevision',
        entityId: current.id,
        userId: input.userId ?? current.userId ?? null,
        before: JSON.stringify({
          version: 1,
          invoiceId: current.id,
          receiptNo: current.receiptNo,
          rows: invoiceItemRevisionRows(current.items)
        }),
        after: JSON.stringify({
          version: 1,
          invoiceId: current.id,
          receiptNo: current.receiptNo,
          /** ردیف‌های جایگزینِ validated/snapshotted، نه payload خام renderer. */
          rows: replacementItems
        }),
        note: `revision اقلام فاکتور ${faDigits(current.receiptNo)} · snapshot پیش از جایگزینی ردیف‌ها`
      })

      // اقلام بازنویسی می‌شوند؛ خودِ فاکتور (و شماره فیشش) نه.
      await tx.saleInvoiceItem.deleteMany({ where: { invoiceId: current.id } })
      /**
       * 🔴 نشست ۱۸۲ · بند ۴-۲۲ — پرداختی هیچ‌وقت *فیزیکی* حذف نمی‌شود.
       *
       * این خط `payment.deleteMany` می‌زد: ردیف‌های پرداخت کاملاً از دیتابیس
       * پاک می‌شدند. رابط کاربری همیشه `keepPayments: true` می‌فرستد، پس در
       * عمل دیده نمی‌شد — ولی از راه IPC مستقیم در دسترس بود و نتیجه‌اش نابودی
       * مدرک است: مبلغ، روش، مقصد، شیفت و کارمندِ هر پرداخت بی‌هیچ ردی محو
       * می‌شد. بند ۴-۲۲ صریح است: «ابطال، نه حذف».
       *
       * حالا همان ردیف‌ها با `voidedAt` باطل می‌شوند. بقیه‌ی برنامه از قبل
       * `voidedAt: null` را در فیلترهایش دارد، پس رفتار محاسباتی همان است —
       * فقط مدرک می‌ماند.
       */
      if (!keepPayments) {
        const doomed = await tx.payment.findMany({
          where: { invoiceId: current.id, voidedAt: null },
          select: { id: true, amount: true, methodId: true, seq: true }
        })
        if (doomed.length) {
          await tx.payment.updateMany({
            where: { invoiceId: current.id, voidedAt: null },
            data: {
              voidedAt: new Date(),
              voidedByUserId: input.userId ?? null,
              voidReason: 'بازنویسی پرداخت‌ها در ویرایش فاکتور'
            }
          })
          await audit(tx, {
            action: AuditAction.SALE_PAYMENT_DELETE,
            entity: 'Payment',
            entityId: current.id,
            userId: input.userId ?? null,
            before: JSON.stringify(doomed.map((d) => ({ id: d.id, amount: toNumberRial(d.amount), seq: d.seq }))),
            after: JSON.stringify({ voided: doomed.length }),
            note:
              `${faDigits(doomed.length)} پرداخت فاکتور ${faDigits(current.receiptNo)} در ویرایش بازنویسی شد. ` +
              'ردیف‌ها باطل شدند (نه حذف) تا مبلغ، روش و کارمندِ هر پرداخت در سابقه بماند.'
          })
        }
      }

      /**
       * مورد ۷ — فاکتور عمده‌ای که *قبل از* این نسخه ثبت شده و کد برگشت ندارد:
       * با ویرایش، یک کد معتبر می‌گیرد تا رسید چاپی‌اش هم مثل بقیه کد و مهلت
       * برگشت داشته باشد. فاکتوری که از قبل کد دارد مطلقاً دست نمی‌خورد (کد و
       * تاریخ اعتبارش عوض نمی‌شود).
       */
      const editDefaults = await saleDefaultsWith(tx)
      const backfillCode =
        !current.returnCode && orderType === OrderType.WHOLESALE && editDefaults.wholesaleReturnCode !== false
          ? await generateReturnCode(tx, {
              length: editDefaults.wholesaleReturnCodeLength,
              days:
                input.remoteCustomer === true
                  ? editDefaults.wholesaleReturnCodeDaysRemote
                  : editDefaults.wholesaleReturnCodeDays,
              issuedAt
            })
          : null

      const t = saleTotals(input)
      const invoice = await tx.saleInvoice.update({
        where: { id: current.id },
        data: {
          customerId: (await resolveCustomer(tx, input)) ?? null,
          issuedAt,
          issuedAtJalali: toJalaliDate(issuedAt),
          orderType,
          ...(backfillCode ? { returnCode: backfillCode.code, returnCodeExpiresAt: backfillCode.expiresAt } : {}),
          deductInventory,
          wholesaleDiscountPercent,
          tableNo: input.tableNo?.trim() || current.tableNo,
          goodsTotal: t.goodsTotal,
          taxTotal: t.taxTotal,
          serviceCharge: t.serviceCharge,
          discountTotal: t.discountTotal,
          deliveryFee: t.deliveryFee,
          grandTotal: t.grandTotal,
          ...(keepPayments ? {} : { paidTotal: t.paidTotal }),
          note: input.note ?? null,
          items: { create: replacementItems },
          ...(keepPayments
            ? {}
            : {
                payments: {
                  create: await initialPaymentRows(tx, input, issuedAt, {
                    shiftId: await currentPaymentShiftId(tx, input.userId ?? null, (input as any).custodyFence ?? null)
                  })
                }
              })
        },
        include: { items: true }
      })

      /** نشست ۱۵۴ (S151-b) — قیمت دستی ویرایش (نسبت به فاکتور اصلی) در AuditLog، داخل همین تراکنش */
      await writeSalePriceOverrideAudit(tx, {
        invoiceId: invoice.id,
        receiptNo: current.receiptNo,
        userId: input.userId ?? null,
        what: 'ویرایش فاکتور',
        check: pricing
      })
      await writeSaleChargeOverrideAudit(tx, {
        invoiceId: invoice.id,
        receiptNo: current.receiptNo,
        userId: input.userId ?? null,
        what: 'ویرایش فاکتور',
        check: chargeCheck,
        approved: chargeApproved
      })

      /**
       * جلسه ۴۷ — دفتر مبدأ تازه، روی اقلامِ تازه‌ی همین فاکتور. اینجا هم دوباره
       * اعتبارسنجی می‌شود، پس ویرایشی که موجودی انبارها بینش عوض شده باشد با
       * خطای `STOCK_PLAN_STALE` رد می‌گردد و هیچ چیزی نصفه نمی‌ماند.
       */
      let allocationEdit: Awaited<ReturnType<typeof stockAllocationService.applyPlan>> | null = null
      if (deductInventory && editPlan) {
        allocationEdit = await stockAllocationService.applyPlan(tx, {
          plan: editPlan,
          invoiceId: current.id,
          receiptNo: current.receiptNo,
          items: invoice.items.map((i) => ({ id: i.id, variantId: i.variantId, qty: i.qty })),
          userId: input.userId ?? current.userId ?? null,
          what: 'ویرایش فاکتور فروش عمده'
        })
        stockWarnings.push(...allocationEdit.warnings)
      }

      // اعمال اختلاف موجودی — همیشه از طریق InventoryService و با همان tx.
      const ctx = {
        refType: 'SaleInvoice',
        refId: current.id,
        state: StockState.PENDING,
        userId: input.userId ?? current.userId ?? null,
        note: `اصلاح فاکتور فروش ${faDigits(current.receiptNo)}`
      }
      if (decrease.length) await inventoryService.decrease(decrease, { ...ctx, reason: 'SALE_EDIT' }, tx)
      if (increase.length) await inventoryService.increase(increase, { ...ctx, reason: 'SALE_EDIT' }, tx)

      /**
       * جمع پرداختی‌ها و «تسویه‌شده» همیشه از ردیف‌های واقعی Payment بازمحاسبه
       * می‌شوند: هم وقتی پرداختی‌ها دست‌نخورده مانده‌اند و جمع کل فاکتور عوض شده،
       * هم وقتی بازنویسی شده‌اند.
       */
      const settle = await recalcSettlement(tx, current.id, { userId: input.userId ?? null })

      /**
       * =====================================================================
       * نشست ۶۳ · بند ۴-۳۵ (DECISIONS S63-1) — اضافه‌دریافتِ ساخته‌شده با ویرایش.
       *
       * باگ: ویرایشی که پرداخت صریح بیشتر از جمع می‌فرستاد (payments) یا اقلام
       * را زیر پرداختیِ ثبت‌شده می‌برد (keepPayments؛ مثلاً ۱٬۰۰۰ پرداخت‌شده ⇒
       * ۷۰۰) بی‌هیچ هشداری ۳۰۰ ریال اضافه‌دریافت می‌ساخت. حالا همان فلوی
       * چهارمرحله‌ای ثبت فاکتور/قسط: فقط *افزایش* اضافه‌دریافت نسبت به قبل از
       * ویرایش سنجیده می‌شود (ویرایشی که اضافه‌دریافت را زیاد نمی‌کند مثل قبل
       * بی‌سؤال انجام می‌شود). رد ⇒ کل ویرایش (اقلام، انبار، پرداخت‌ها) rollback.
       * =====================================================================
       */
      const prevOverpay = current.payments
        .filter((p: any) => p.voidedAt == null)
        .reduce((sum: number, p: any) => sum + Math.max(0, toNumberRial(p.overpayAmount ?? 0)), 0)
      const overpayIncrease = Math.max(0, Math.round(settle.overpayTotal) - prevOverpay)
      if (overpayIncrease > 0 && input.confirmOverpay !== true)
        throw new BusinessError(
          `بعد از این ویرایش، جمع دریافتی فاکتور ${faDigits(current.receiptNo)} (${money(settle.paidTotal)} ریال) ` +
            `از جمع تازه‌ی فاکتور (${money(settle.grandTotal)} ریال) بیشتر می‌شود: ${money(overpayIncrease)} ریال ` +
            'اضافه‌دریافت تازه.\n' +
            'اگر آگاهانه می‌خواهید ویرایش با همین مبالغ ثبت شود، «بله ثبت کن» را بزنید؛ مبلغ اضافه به‌صورت جدا ' +
            '(ردیف «دریافت پول اضافه») در گزارش فاکتور و گزارشات فروش نمایش داده می‌شود.'
        )
      if (input.overpayAsCredit === true && overpayIncrease <= 0)
        throw new BusinessError(
          'این ویرایش مبلغ اضافه‌ی دریافتی تازه‌ای نمی‌سازد، پس اعتبار خریدی از آن صادر نمی‌شود. ' +
            'برای اضافه‌دریافتِ قبلی از «پرداختی‌ها / اقساط» ⇐ «صدور اعتبار از اضافه‌دریافت» استفاده کنید.'
        )
      let overpayCredit: OverpayCreditResult | null = null
      if (input.overpayAsCredit === true && overpayIncrease > 0)
        overpayCredit = await issueOverpayCreditTx(tx, {
          invoiceId: current.id,
          amount: overpayIncrease,
          userId: input.userId ?? current.userId ?? null,
          managerApproved: overpayManagerApproved
        })

      const overpayNote =
        overpayIncrease > 0
          ? ` · دریافت پول اضافه (با تایید فروشنده): ${money(overpayIncrease)} ریال` +
            (overpayCredit ? ` ⇐ اعتبار #${overpayCredit.id} صادر شد (غیرقابل نقد شدن)` : '')
          : ''
      await audit(tx, {
        action: AuditAction.SALE_UPDATE,
        entity: 'SaleInvoice',
        entityId: current.id,
        userId: input.userId ?? current.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify({
          receiptNo: invoice.receiptNo,
          issuedAtJalali: invoice.issuedAtJalali,
          customerId: invoice.customerId,
          orderType,
          deductInventory,
          wholesaleDiscountPercent,
          goodsTotal: t.goodsTotal,
          discountTotal: t.discountTotal,
          grandTotal: t.grandTotal,
          paidTotal: settle.paidTotal,
          remaining: settle.remaining,
          settled: settle.settled,
          items: invoiceItemRevisionRows(invoice.items),
          stockDelta: { decrease, increase },
          /** جلسه ۴۷ — مبدأ کسرِ تازه و مبدأهایی که برگشت خوردند */
          stockSources: allocationEdit ? allocationEdit.plan.lines : null,
          revertedWarehouseQty: reverted?.warehouseQty ?? 0
        }),
        note: deductInventory
          ? `ویرایش فاکتور · اختلاف موجودی اعمال شد (کسر ${decrease.length} قلم، برگشت ${increase.length} قلم)` +
            (keepPayments ? ' · تاریخچه‌ی پرداختی‌ها دست‌نخورده ماند' : '') +
            overpayNote +
            (centralEdit.totalTaken > 0 ? ` · ${centralEdit.totalTaken} عدد از انبار مرکزی برداشته شد` : '') +
            (reverted && reverted.warehouseQty > 0
              ? ` · ${faDigits(reverted.warehouseQty)} عدد به انبارهای مبدأ قبلی برگشت`
              : '') +
            (allocationEdit ? ` · مبدأ کسر تازه: ${allocationEdit.summaryLines.join(' | ')}` : '') +
            (stockWarnings.length ? ' · با کمبود موجودی' : '')
          : 'ویرایش فاکتور بدون کسر از موجودی انبار' + overpayNote
      })

      return {
        ...invoice,
        paidTotal: settle.paidTotal,
        stockWarnings,
        centralWithdrawals: centralEdit.taken,
        centralWithdrawnQty: centralEdit.totalTaken,
        /** جلسه ۴۷ — خلاصه‌ی کسری‌های تازه (null = مثل قبل، فقط انبار فروشگاه) */
        stockSources: allocationEdit
          ? {
              groups: allocationEdit.groups,
              lines: allocationEdit.summaryLines,
              warehouseTakenQty: allocationEdit.warehouseTakenQty,
              hasNegative: planHasNegative(allocationEdit.plan)
            }
          : null,
        revertedWarehouseQty: reverted?.warehouseQty ?? 0,
        remaining: settle.remaining,
        settled: settle.settled,
        keptPayments: keepPayments,
        /** نشست ۶۳ — افزایش اضافه‌دریافت با همین ویرایش (۰ = عادی) */
        overpayAmount: overpayIncrease,
        /** نشست ۶۳ — مرجع امنِ اعتبار صادرشده از آن (null = مرحله ۴) */
        overpayCredit: shapeOverpayCreditSafe(overpayCredit)
      }
    }, TX_OPTIONS)
  },

  async get(id: number) {
    const invoice = await prisma.saleInvoice.findUnique({
      where: { id },
      include: {
        items: { include: { variant: { include: { product: true } } } },
        payments: { where: { voidedAt: null }, include: { method: true } },
        customer: true,
        user: true,
        shift: true,
        returns: { where: { voidedAt: null }, include: { items: true } }
      }
    })
    if (!invoice) return null
    return {
      ...invoice,
      payments: (invoice.payments ?? []).map(shapeSaleGetPaymentSafe),
      returns: (invoice.returns ?? []).map(shapeSaleGetReturnSafe)
    }
  },

  async list(filter: {
    from?: string
    to?: string
    fromJalali?: string
    toJalali?: string
    userId?: number
    shiftId?: number
    status?: string
    orderType?: string
    receiptNo?: number
    returnCode?: string
    customerSearch?: string
    barcode?: string
    onlyNotConsolidated?: boolean
    take?: number
    skip?: number
  }) {
    const where = saleWhere(filter as SaleReportFilter)
    if (filter.barcode) where.items = { some: { variant: { barcode: filter.barcode } } }
    /**
     * نشست ۱۱۷ (S117-4) — قبلاً `take: filter.take ?? 500` بی‌صدا و UI جمع فروش عمده
     * را از همان ۵۰۰ ردیف می‌ساخت. حالا جمع/تعداد روی کل where (aggregate) و ردیف‌ها
     * صفحه‌بندی واقعی (پیش‌فرض/سقف ۵٬۰۰۰) با page و هشدار فارسی؛ خروجی همچنان آرایه.
     */
    const skip = Math.max(0, Math.round(Number(filter.skip ?? 0) || 0))
    const take = Math.min(
      SALE_LIST_PAGE_MAX,
      Math.max(1, Math.round(Number(filter.take ?? SALE_LIST_PAGE_MAX) || SALE_LIST_PAGE_MAX))
    )
    const [agg, rows] = await Promise.all([
      prisma.saleInvoice.aggregate({ where, _count: { _all: true }, _sum: { grandTotal: true } }),
      prisma.saleInvoice.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: [{ receiptNo: 'desc' }, { id: 'desc' }],
        skip,
        take
      })
    ])
    const totalCount = Number((agg as any)._count?._all ?? 0)
    const page: SaleReportPage = { skip, take, totalCount, truncated: totalCount > skip + rows.length || skip > 0 }
    const warnings = page.truncated
      ? [
          `نمایش ردیف ${faDigits(rows.length ? skip + 1 : 0)} تا ${faDigits(skip + rows.length)} از ${faDigits(
            totalCount
          )} فاکتور؛ جمع کل روی همه‌ی فاکتورهای بازه حساب شده است. برای دیدن بقیه صفحه‌ی بعد/قبل را بگیرید.`
        ]
      : []
    return Object.assign(rows, {
      page,
      warnings,
      totals: { count: totalCount, grandTotal: Math.round(Number((agg as any)._sum?.grandTotal ?? 0)) }
    })
  },

  // =========================================================================
  // گزارشات فروش
  // =========================================================================

  /**
   * «سرجمع فروش»: ردیف‌های آماده‌ی جدول + جمع کل + گروه‌بندی روز/شیفت.
   *
   * همه‌ی فاکتورهای فروش (پنل فروش تکی و فاکتور عمده) از همین‌جا می‌آیند، پس
   * هر فاکتوری که در پنل فروش تکی زده شود، بی‌هیچ کار اضافه‌ای در گزارش دیده
   * می‌شود. فیلتر بازه‌ی تاریخ شمسی هم پشتیبانی می‌شود تا گزارش ماهانه/سالانه
   * با همان پنل گرفته شود.
   */
  async reportRows(filter: SaleReportFilter = {}): Promise<SaleReportResult> {
    const where = saleWhere(filter)
    const warnings: string[] = []

    // ---- بازه‌ی مؤثر: همیشه resolve می‌شود (بند ۲-۴) ----
    const period = await resolveReportPeriod(filter, where)

    /**
     * ==================== صفحه‌بندی واقعی (بند ۲-۵) ====================
     * ردیف‌های *جدول* صفحه‌بندی می‌شوند؛ جمع‌های *کل* هرگز از این ردیف‌ها حساب
     * نمی‌شوند. `totalCount` با `count()` روی کل بازه گرفته می‌شود تا نوار
     * «نمایش N از M» هیچ‌وقت دروغ نگوید.
     */
    const take = Math.min(Math.max(Math.round(Number(filter.take ?? 500) || 500), 1), 20_000)
    const skip = Math.max(0, Math.round(Number((filter as any).skip ?? 0) || 0))
    const totalCount = await prisma.saleInvoice.count({ where })

    const invoices = await prisma.saleInvoice.findMany({
      where,
      include: reportInclude(period),
      orderBy: [{ issuedAt: 'asc' }, { receiptNo: 'asc' }],
      skip,
      take
    })

    /**
     * جمع برگشت ساده‌ی **کل تاریخ** فاکتورهای همین صفحه.
     * لازم است چون `remaining` (باقی‌ماندهٔ بدهی) یک عدد «تا این لحظه» است، نه
     * بازه‌ای: فاکتوری که *بعد* از بازه‌ی گزارش کامل برگشت خورده، امروز طلبی
     * ندارد. اگر با برگشت‌های فیلترشده حساب می‌شد، گزارش طلبِ دروغ می‌داد.
     */
    const pageIds = invoices.map((i) => i.id)
    /** نشست ۵۸ · C2 — برگشت و بازپرداخت «کل تاریخ» هر فاکتور، برای بدهی واحد */
    const debtAllTime = await debtAdjustmentsByInvoice(prisma, pageIds)
    const returnedAllTime = new Map<number, number>()
    for (const [id, a] of debtAllTime) returnedAllTime.set(id, a.returnedValue)

    await annotateRefundCanceled(invoices)
    const rows = invoices.map((inv) => shapeSaleRow(inv, { period, returnedAllTime, debtAllTime }))
    const shiftMeta = new Map<number, any>()
    for (const inv of invoices) if (inv.shiftId && inv.shift) shiftMeta.set(inv.shiftId, inv.shift)

    /**
     * ==================== جمع‌ها: از aggregate، نه از ردیف‌ها ====================
     * `sumTotals(rows)` فقط جمع «همین صفحه» است و برای نوار پایین جدول *کافی
     * نیست*. پس بعدش با اعداد دقیقِ `buildStatements` (که با aggregate/groupBy
     * روی کل بازه حساب شده‌اند) بازنویسی می‌شود.
     */
    const totals = sumTotals(rows)

    // گردش نقدی خارج از فروش (برداشت/واریز) — مبنای «وجه واقعی» و بستن صندوق
    let movements = { openingFloat: 0, withdrawals: 0, deposits: 0, refunds: 0 }
    try {
      movements = await cashMovementTotals({
        shiftId: filter.shiftId ?? null,
        userId: filter.userId ?? null,
        from: period.from,
        to: period.to
      })
    } catch (e) {
      // جدول CashMovement تازه اضافه شده؛ نبودش نباید گزارش را بخواباند
      console.error('[sales] cash movement totals failed', e)
      warnings.push('گردش نقدی (برداشت/واریز) خوانده نشد؛ اعداد «وجه واقعی» بدون آن حساب شده‌اند.')
    }

    let accounting: SaleAccountingStatements | undefined
    try {
      const built = await buildStatements(
        {
          where,
          from: period.from,
          to: period.to,
          filter,
          withdrawals: movements.withdrawals,
          deposits: movements.deposits,
          period: {
            fromJalali: period.from ? toJalaliDate(period.from) : null,
            toJalali: period.to ? toJalaliDate(period.to) : null,
            source: period.source
          }
        },
        {
          withDrillDown: (filter as any).withDrillDown === true,
          bridgeSourceKey: (filter as any).bridgeSourceKey ?? null,
          bridgeSourceSkip: (filter as any).bridgeSourceSkip ?? 0,
          bridgeSourceTake: (filter as any).bridgeSourceTake ?? 200
        }
      )
      accounting = built.statements
      warnings.push(...built.warnings)

      // ---- جمع‌های قدیمی را با عددهای *دقیقِ کل بازه* هم‌خوان می‌کنیم ----
      const a = built.statements
      totals.count = a.invoice.invoiceCount
      totals.goodsTotal = a.invoice.grossSales
      totals.taxTotal = a.invoice.taxes
      totals.serviceTotal = a.invoice.serviceCharges
      totals.discountTotal = a.invoice.discounts
      totals.deliveryTotal = a.invoice.deliveryFees
      totals.grandTotal =
        a.invoice.grossSales - a.invoice.discounts + a.invoice.taxes + a.invoice.serviceCharges + a.invoice.deliveryFees
      totals.cashTotal = a.cash.cashReceived
      totals.cardTotal = a.cash.cardReceived
      totals.otherTotal = a.cash.otherReceived
      /**
       * ---------------- کار الف (جلسه ۳۶): مقصد پول در جمع‌های بازه ----------------
       * این دو عدد هم مثل بقیه‌ی جمع‌ها از `buildStatements` (aggregate روی کل
       * بازه) می‌آیند، نه از ردیف‌های صفحه‌بندی‌شده. باگی که با همین دو خط بسته
       * می‌شود: تا جلسه ۳۵ ستون «کارت» هر ردیف در `SalesReports.tsx` از خود ردیف
       * می‌آمد (که چکِ پاس‌شده در سبد «سایر» داخلش بود) ولی جمع پایین جدول از
       * `a.cash.otherReceived` رونویسی می‌شد (که چک در آن نبود) ⇒ ستون و جمعِ
       * همان ستون یک عدد نمی‌دادند.
       */
      totals.managerAccountTotal = a.cash.managerAccountReceived
      totals.destinationUnknownTotal = a.cash.destinationUnknownReceived
      /**
       * «دریافتی فروشگاه»: سهم حساب مدیر **بیرون** است (به صندوق و کارتخوان
       * نرسیده) و سهم «نامشخصِ» داده‌ی قدیمی **داخل** می‌ماند تا هیچ عدد گزارش
       * قبلی عوض نشود.
       */
      totals.receivedTotal =
        a.cash.cashReceived + a.cash.cardReceived + a.cash.otherReceived +
        a.cash.destinationUnknownReceived + totals.creditTotal
      totals.returnedTotal = a.returns.simpleReturns
      totals.exchangeReturnedTotal = a.returns.exchangeReturned
      totals.refundCashTotal = a.returns.cashRefunds + a.returns.exchangeCashRefunds
      totals.refundCardTotal = a.returns.cardRefunds + a.returns.exchangeCardRefunds
      totals.refundDebtOnlyTotal = a.returns.debtOnlyReturns
      totals.storeCreditRefundTotal = a.returns.storeCreditRefunds + a.returns.exchangeStoreCreditIssued
      totals.exchangeCount = a.returns.exchangeCount
      totals.exchangeDiffTotal = a.returns.exchangeDiffReceived - a.returns.exchangeCashRefunds
        - a.returns.exchangeCardRefunds - a.returns.exchangeStoreCreditIssued
      totals.storeCreditIssuedTotal = a.storeCredits.issued
      totals.storeCreditUsedTotal = a.storeCredits.used
      totals.creditRemainingTotal = a.credit.remaining
      totals.priorSettlementTotal = a.credit.settledPrior
      totals.netReceivedTotal = totals.receivedTotal - totals.storeCreditIssuedTotal
      totals.legacyRefundCount = a.returns.legacyAssumedCount
    } catch (e) {
      // گزارش باید حتی اگر یک صورت نساخته شد، ردیف‌هایش را نشان بدهد
      console.error('[sales] accounting statements failed', e)
      warnings.push(
        'صورت‌های حسابداری (تعهدی / وجه واقعی / پل تطبیق) ساخته نشدند و جمع‌های پایین صفحه فقط ' +
          'روی ردیف‌های همین صفحه هستند. بازه را کوچک‌تر کنید یا با پشتیبانی تماس بگیرید.'
      )
    }

    /**
     * 🔴 نشست ۱۸۶ · بند ۴-۱۴ و ۴-۵۳ — نشست‌هایی که در این بازه **فعالیت مالی**
     * داشته‌اند، حتی اگر فروش تازه‌ای نداشته باشند.
     *
     * سناریوی گزارش: فاکتور ۷۰۰٬۰۰۰ در نشست ۱ ثبت شده و پولش در نشست ۲ وصول
     * می‌شود. نشست ۲ هیچ فروشی ندارد، پس در گروه‌بندی *اصلاً ردیفی نداشت* —
     * در حالی که `cashTotal` و `realCash` همان ۷۰۰٬۰۰۰ را نشان می‌دادند.
     * جمع ردیف‌ها با جمع کل نمی‌خواند و مدیر نمی‌فهمید پول کجا وارد شد.
     *
     * مبنا `createdShiftId` است (نشستِ *ثبت* پرداخت)، همان چیزی که بقیه‌ی
     * گزارش‌ها از نشست ۶۷/۶۸ استفاده می‌کنند.
     */
    const activeSessions: {
      shiftId: number
      dayJalali: string
      shiftName: string
      sessionSeq?: number | null
      cashTotal?: number
      cardTotal?: number
      managerAccountTotal?: number
      destinationUnknownTotal?: number
      receivedTotal?: number
      priorSettlementTotal?: number
    }[] = []
    try {
      const period = await resolveReportPeriod(filter, where)
      if (period.from || period.to) {
        const paidShiftIds = await prisma.payment.findMany({
          where: {
            voidedAt: null,
            createdShiftId: { not: null },
            paidAt: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) }
          },
          select: { createdShiftId: true },
          distinct: ['createdShiftId']
        })
        const ids = [...new Set(paidShiftIds.map((r) => r.createdShiftId).filter((x): x is number => x != null))]
        if (ids.length) {
          const shifts: { id: number; name: string; dayJalali: string; sessionSeq: number | null; openedAt: Date; closedAt: Date | null }[] = []
          const pays: any[] = []
          for (const part of reportIdChunks(ids)) {
            shifts.push(
              ...(await prisma.shift.findMany({
                where: { id: { in: part } },
                select: { id: true, name: true, dayJalali: true, sessionSeq: true, openedAt: true, closedAt: true }
              }))
            )
            pays.push(
              ...(await prisma.payment.findMany({
                where: {
                  voidedAt: null,
                  createdShiftId: { in: part },
                  paidAt: { ...(period.from ? { gte: period.from } : {}), ...(period.to ? { lte: period.to } : {}) }
                },
                select: {
                  createdShiftId: true,
                  clearedShiftId: true,
                  amount: true,
                  kind: true,
                  chequeStatus: true,
                  destination: true,
                  method: { select: { kind: true } },
                  invoice: { select: { shiftId: true } }
                }
              }))
            )
          }
          const moneyByShift = new Map<number, { cash: number; card: number; manager: number; unknown: number; received: number }>()
          for (const p of pays) {
            const sid = p.createdShiftId
            if (sid == null) continue
            /** فقط وصول فاکتورِ نشست دیگر؛ پرداخت خودِ فاکتورهای این نشست روی ردیف‌شان است. */
            const invShift = p.invoice?.shiftId ?? null
            if (invShift != null && Number(invShift) === Number(sid)) continue
            const isCheque = (p.kind ?? '') === PaymentEntryKind.CHEQUE
            if (isCheque && p.chequeStatus !== ChequeStatus.CLEARED) continue
            const bucket = receiptBucketOf({
              isCheque,
              destination: p.destination ?? null,
              methodKind: p.method?.kind ?? 'CUSTOM'
            })
            if (bucket === 'storeCredit' || bucket === 'exchangeCredit') continue
            const amt = toNumberRial(p.amount)
            const cur = moneyByShift.get(sid) ?? { cash: 0, card: 0, manager: 0, unknown: 0, received: 0 }
            if (bucket === 'cash') cur.cash += amt
            else if (bucket === 'card') cur.card += amt
            else if (bucket === 'managerAccount') cur.manager += amt
            else if (bucket === 'unknown') cur.unknown += amt
            cur.received += amt
            moneyByShift.set(sid, cur)
          }
          for (const sh of shifts) {
            if (!shiftMeta.has(sh.id)) shiftMeta.set(sh.id, sh)
            const m = moneyByShift.get(sh.id)
            if (!m || m.received <= 0) continue
            activeSessions.push({
              shiftId: sh.id,
              dayJalali: sh.dayJalali || toJalaliDate(sh.openedAt),
              shiftName: sh.name,
              sessionSeq: sh.sessionSeq ?? null,
              cashTotal: m?.cash ?? 0,
              cardTotal: m?.card ?? 0,
              managerAccountTotal: m?.manager ?? 0,
              destinationUnknownTotal: m?.unknown ?? 0,
              receivedTotal: m?.received ?? 0,
              priorSettlementTotal: m?.received ?? 0
            })
          }
        }
      }
    } catch (e) {
      // گروه‌بندی یک «کمک» است؛ خطایش نباید کل گزارش را بخواباند.
      console.error('[report] activeSessions lookup failed', e)
    }

    const truncated = totalCount > skip + rows.length
    if (truncated)
      warnings.push(
        `نمایش ${rows.length} از ${totalCount} ردیف — جمع‌های پایین صفحه روی کل ${totalCount} ردیف بازه حساب شده‌اند، ` +
          'نه فقط ردیف‌های دیده‌شده.'
      )

    return {
      rows: [...rows].sort((a, b) => b.receiptNo - a.receiptNo),
      totals,
      /**
       * ⚠️ گروه‌های «روز → شیفت» از ردیف‌های *همین صفحه* ساخته می‌شوند. برای
       * بازه‌ی بزرگ باید بازه را کوچک‌تر کرد یا `take` را بالا برد؛ هشدار برش
       * بالا همین را می‌گوید. جمع کل بازه هیچ‌وقت از این گروه‌ها خوانده نمی‌شود.
       */
      groups: groupByDayShift(rows, shiftMeta, activeSessions),
      accounting,
      page: { skip, take, totalCount, truncated },
      warnings
    }
  },

  /** همان گزارش، ولی فقط گروه‌های «روز → شیفت» (برای نمایش تفکیک‌شده). */
  async reportByShift(filter: SaleReportFilter = {}) {
    const res = await this.reportRows(filter)
    return { groups: res.groups, totals: res.totals }
  },

  /** «جزئیات فروش»: هر ردیف = یک قلم فروخته‌شده. */
  async reportItems(filter: SaleReportFilter = {}): Promise<PagedRows<SaleItemReportRow>> {
    const where = saleWhere(filter)
    /**
     * نشست ۱۸۴ · بند ۴-۲۷ — بازه‌ی خودِ *رویدادِ برگشت*.
     * ستون «برگشتی» باید فقط برگشت‌هایی را بشمارد که در همین بازه رخ داده‌اند،
     * نه همه‌ی تاریخ. `resolveReportPeriod` همان بازه‌ای را می‌دهد که بقیه‌ی
     * گزارش با آن ساخته می‌شود (و از این نشست، نبودِ تاریخ یعنی «امروز»).
     */
    const itemPeriod = await resolveReportPeriod(filter, where)
    const returnedAtRange =
      itemPeriod.from || itemPeriod.to
        ? {
            ...(itemPeriod.from ? { gte: itemPeriod.from } : {}),
            ...(itemPeriod.to ? { lte: itemPeriod.to } : {})
          }
        : null
    const totalCount = await prisma.saleInvoice.count({ where })
    const page = reportPage(filter.take, filter.skip, 3000, totalCount)
    const invoices = await prisma.saleInvoice.findMany({
      where,
      include: { customer: true, shift: true, items: true },
      orderBy: [{ issuedAt: 'asc' }, { receiptNo: 'asc' }],
      skip: page.skip,
      take: page.take
    })
    const itemIds = invoices.flatMap((i) => i.items.map((it) => it.id))
    const variantIds = [...new Set(invoices.flatMap((i) => i.items.map((it) => it.variantId)))]

    // واریانت‌ها جدا خوانده می‌شوند (نه با include تودرتو) تا اگر کالایی حذف
    // شده باشد، کل گزارش با خطای رابطه‌ی ناقص از کار نیفتد.
    const variants: any[] = []
    for (const ids of reportIdChunks(variantIds)) {
      variants.push(
        ...(await prisma.productVariant.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            code: true,
            barcode: true,
            size: true,
            color: true,
            product: { select: { name: true, reportLiveName: true } }
          }
        }))
      )
    }
    const vmap = new Map(variants.map((v) => [v.id, v]))

    const rQty = new Map<number, number>()
    const rAmt = new Map<number, number>()
    const laterJalali = new Map<number, string[]>()
    for (const ids of reportIdChunks(itemIds)) {
      /**
       * 🔴 نشست ۱۸۴ · بند ۴-۲۷ — ستون «برگشتی» به همان بازه‌ی گزارش محدود است.
       *
       * قبلاً قید `returnedAt` نبود، پس برگشتِ *هر زمانی* در گزارش *هر بازه‌ای*
       * شمرده می‌شد: فروش فروردین با برگشت اردیبهشت، در گزارش فروردین هم
       * «برگشتی ۱» نشان می‌داد. یعنی گزارش یک ماه با گذشتِ زمان عوض می‌شد و
       * دو بار گرفتنِ همان گزارش دو جواب می‌داد.
       */
      const returned = await prisma.saleReturnItem.groupBy({
        by: ['saleItemId'],
        // نشست ۶۴ — اقلام برگشت باطل‌شده «برگشتی» نیستند
        where: {
          saleItemId: { in: ids },
          return: { voidedAt: null, ...(returnedAtRange ? { returnedAt: returnedAtRange } : {}) }
        },
        _sum: { qty: true, lineTotal: true }
      })
      for (const row of returned) {
        rQty.set(row.saleItemId, row._sum.qty ?? 0)
        rAmt.set(row.saleItemId, toNumberRial(row._sum.lineTotal ?? 0))
      }
      /**
       * نشست ۱۹۴ · M-10 — برگشتِ *بعد از* پایان بازه در ستون این بازه نمی‌آید،
       * ولی یک یادآوری نارنجی می‌گوید کالا بعداً برگشت خورده (بند ۴-۲۷).
       */
      if (itemPeriod.to) {
        const later = await prisma.saleReturnItem.findMany({
          where: {
            saleItemId: { in: ids },
            return: { voidedAt: null, returnedAt: { gt: itemPeriod.to } }
          },
          select: { saleItemId: true, return: { select: { returnedAtJalali: true } } }
        })
        for (const row of later) {
          const day = String(row.return?.returnedAtJalali ?? '').trim()
          if (!day) continue
          const list = laterJalali.get(row.saleItemId) ?? []
          list.push(day)
          laterJalali.set(row.saleItemId, list)
        }
      }
    }

    const laterNoteOf = (saleItemId: number): string | null => {
      const days = laterJalali.get(saleItemId)
      if (!days?.length) return null
      const months = [...new Set(days.map((d) => d.slice(0, 7)).filter((m) => m.length >= 7))]
      if (!months.length) return null
      return `این کالا در ${months.map((m) => faDigits(m)).join(' و ')} برگشت خورده`
    }

    const out: SaleItemReportRow[] = []
    for (const inv of invoices) {
      const issuedAt = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
      for (const it of inv.items) {
        const v = vmap.get(it.variantId)
        const lineTotal = toNumberRial(it.lineTotal)
        const returnedAmount = rAmt.get(it.id) ?? 0
        out.push({
          invoiceId: inv.id,
          receiptNo: inv.receiptNo,
          dateJalali: inv.issuedAtJalali || toJalaliDate(issuedAt),
          time: toClock(issuedAt),
          shiftName: inv.shift?.name ?? 'بدون شیفت',
          code: saleLineCode(it, v),
          barcode: v?.barcode ?? '—',
          name: reportLineTitle(it, v),
          qty: it.qty,
          // نشست ۱۸۱: قرارداد این DTO (که از IPC به رابط کاربری می‌رود) number است.
          unitPrice: toNumberRial(it.unitPrice),
          discount: toNumberRial(it.discount),
          tax: toNumberRial(it.tax),
          lineTotal,
          returnedQty: rQty.get(it.id) ?? 0,
          returnedAmount,
          netAmount: Math.max(0, lineTotal - returnedAmount),
          laterReturnNote: laterNoteOf(it.id),
          customerName: inv.customer?.name ?? 'مشتری عمومی'
        })
      }
    }
    // ممیزی A99-02 — صفحه بر حسب فاکتور بریده می‌شود؛ truncated هم با شمار فاکتور
    return attachReportPage(out, page, invoices.length, 'فاکتور')
  },

  /** «سرجمع فروش» به شکل قدیمی (سازگاری با CashboxService و کدهای قبلی). */
  async summary(filter: SaleReportFilter = {}) {
    const res = await this.reportRows(filter)
    return {
      count: res.totals.count,
      goodsTotal: res.totals.goodsTotal,
      taxTotal: res.totals.taxTotal,
      serviceTotal: res.totals.serviceTotal,
      discountTotal: res.totals.discountTotal,
      deliveryTotal: res.totals.deliveryTotal,
      grandTotal: res.totals.grandTotal,
      cashTotal: res.totals.cashTotal,
      /**
       * ⚠️ کار الف (جلسه ۳۶) — «سایر» دیگر بی‌صدا در «کارت» جمع نمی‌شود.
       * باگی که این خط داشت: چک با روش `CHEQUE` (kind = CUSTOM) در سبد «سایر»
       * می‌نشست و از همین‌جا به «انتظار کارتخوان» اضافه می‌شد، در حالی که همان
       * مبلغ از راه `clearedCashChequeAmount` در «انتظار نقد» هم شمرده شده بود ⇒
       * هر چک پاس‌شده دو بار در انتظارهای صندوق می‌آمد و مالک کسری/اضافه‌ی
       * بی‌دلیل می‌دید. حالا هر سبد عدد خودش را دارد و صدازننده (بستن صندوق و
       * جزئیات شیفت) خودش تصمیم می‌گیرد کدام را کنار هم بگذارد.
       */
      cardTotal: res.totals.cardTotal,
      otherTotal: res.totals.otherTotal,
      managerAccountTotal: res.totals.managerAccountTotal,
      destinationUnknownTotal: res.totals.destinationUnknownTotal,
      creditTotal: res.totals.creditTotal,
      returnedTotal: res.totals.returnedTotal,
      rows: res.rows,
      groups: res.groups
    }
  },

  // =========================================================================
  // برگشت از فروش
  // =========================================================================

  /**
   * پیدا کردن فاکتور فروش تکی با «کد فاکتور» (تایپ‌شده یا اسکن‌شده).
   *
   * قواعد:
   *   • فقط کدهای *معتبر* (منقضی‌نشده) به فاکتور اشاره می‌کنند. اگر کد منقضی
   *     شده باشد، پیام روشن با تاریخ انقضا داده می‌شود (چون همان کد ممکن است
   *     بعداً برای فاکتور دیگری تولید شود).
   *   • اگر ورودی کاملاً عددی باشد، به‌عنوان «شماره فیش» هم امتحان می‌شود تا
   *     کاربر بتواند شماره‌ی روی رسید را هم وارد کند.
   *   • وضعیت انباری هر قلم مشخص می‌شود: کالای حذف‌شده از انبار با پیام
   *     «این کالا از موجودی انبار حذف شده است» علامت می‌خورد.
   */
  async findByReturnCode(rawCode: string): Promise<ReturnLookup> {
    const code = normalizeReturnCode(rawCode)
    if (!code) throw new BusinessError('کد فاکتور را وارد کنید یا بارکد روی رسید را اسکن کنید.')

    const now = new Date()
    let invoice = await prisma.saleInvoice.findFirst({
      where: { returnCode: code, returnCodeExpiresAt: { gt: now } },
      orderBy: { issuedAt: 'desc' },
      include: {
        items: true,
        customer: true,
        shift: true,
        payments: { where: { voidedAt: null }, include: { method: true } },
        returns: { where: { voidedAt: null }, include: { items: true } }
      }
    })

    // ورودی عددی: احتمالاً شماره فیش روی رسید است
    if (!invoice && /^[0-9]+$/.test(code)) {
      invoice = await prisma.saleInvoice.findFirst({
        where: { receiptNo: Number(code) },
        include: {
          items: true,
          customer: true,
          shift: true,
          payments: { include: { method: true } },
          returns: { where: { voidedAt: null }, include: { items: true } }
        }
      })
    }

    if (!invoice) {
      const expired = await prisma.saleInvoice.findFirst({
        where: { returnCode: code },
        orderBy: { issuedAt: 'desc' },
        select: { receiptNo: true, issuedAtJalali: true, returnCodeExpiresAt: true }
      })
      if (expired) {
        throw new BusinessError(
          `اعتبار کد «${code}» تمام شده است. این کد برای فاکتور شماره ${faDigits(expired.receiptNo)} ` +
            `(تاریخ ${faDigits(expired.issuedAtJalali)}) صادر شده بود و اعتبارش ` +
            `${faDigits(toJalaliDate(expired.returnCodeExpiresAt ?? new Date()))} به پایان رسیده است. ` +
            'برای برگشت این فاکتور از «گزارشات فروش» شماره فیش را پیدا کنید.'
        )
      }
      throw new BusinessError(
        `فاکتوری با کد «${code}» پیدا نشد. کد را دوباره وارد کنید یا بارکد روی رسید را اسکن کنید.`
      )
    }

    // ---- وضعیت انباری اقلام (بدون include تودرتو، تا کالای حذف‌شده گزارش را نخواباند) ----
    const variantIds = [...new Set(invoice.items.map((i) => i.variantId))]
    const variants = await loadProductVariantsByIds(prisma, variantIds, {
      id: true,
      code: true,
      barcode: true,
      size: true,
      color: true,
      stock: true,
      isActive: true,
      product: { select: { name: true, unit: true, isActive: true } }
    })
    const vmap = new Map(variants.map((v) => [v.id, v]))

    const returnedByItem = new Map<number, number>()
    for (const r of invoice.returns)
      for (const it of r.items) returnedByItem.set(it.saleItemId, (returnedByItem.get(it.saleItemId) ?? 0) + it.qty)

    const warnings: string[] = []
    /** نشست ۲ · C1 — صفحه‌ی برگشت با همین عدد و `returnValueOf` پیش‌نمایش می‌دهد */
    const lookupLineNet = allocateLineNet(invoice)
    const items: ReturnLookupItem[] = invoice.items.map((it) => {
      const v = vmap.get(it.variantId)
      const removed = !!v && (!v.isActive || v.product?.isActive === false)
      const stockState: ReturnItemStock = !v ? 'MISSING' : removed ? 'REMOVED' : 'OK'
      const returnedQty = returnedByItem.get(it.id) ?? 0
      const name = saleLineTitle(it, v, 'کالای حذف‌شده از سیستم')
      const warning =
        stockState === 'REMOVED'
          ? 'این کالا از موجودی انبار حذف شده است'
          : stockState === 'MISSING'
            ? 'این کالا از موجودی انبار حذف شده است و رکوردی از آن در سیستم نمانده؛ برگشت خودکارش ممکن نیست'
            : undefined
      if (warning) warnings.push(`«${name}»: ${warning}`)
      return {
        saleItemId: it.id,
        variantId: it.variantId,
        code: v?.code ?? '—',
        barcode: v?.barcode ?? '—',
        name,
        unit: v?.product?.unit ?? 'عدد',
        qty: it.qty,
        returnedQty,
        remainingQty: Math.max(0, it.qty - returnedQty),
        // نشست ۱۸۱: ستون‌های مالی BigInt شده‌اند؛ قرارداد DTO رابط کاربری number است.
        unitPrice: toNumberRial(it.unitPrice),
        discount: toNumberRial(it.discount),
        lineTotal: toNumberRial(it.lineTotal),
        netLineValue: lookupLineNet.get(it.id) ?? 0,
        stock: v?.stock ?? 0,
        stockState,
        warning
      }
    })

    const issuedAt = invoice.issuedAt instanceof Date ? invoice.issuedAt : new Date(invoice.issuedAt)
    const expiresAt = invoice.returnCodeExpiresAt ?? returnCodeExpiry(issuedAt, 7)
    const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS))

    // نشست ۳۱۹ — پروفایل تسویه‌ی فاکتور مرجع (فقط‌خواندنی)
    const paidNow = toNumberRial(invoice.paidTotal)
    const grandNow = toNumberRial(invoice.grandTotal)
    const cashLike = await cashLikeReceivedOf(prisma, invoice.id, paidNow)
    const prevAdj = adjustmentsOrEmpty(await debtAdjustmentsByInvoice(prisma, [invoice.id]), invoice.id)
    const previouslyRefunded = Math.max(0, Math.round(prevAdj.refundFromReceived ?? 0))
    const cashLikeRefundableNow = await cashLikeRefundableOf(prisma, invoice, previouslyRefunded)
    const remResult = await invoiceRemaining(prisma, invoice.id, grandNow, paidNow)
    const remainingDebt = remResult.remaining

    const rawRedemptions = await prisma.storeCreditRedemption.findMany({
      where: { invoiceId: invoice.id, reversedAt: null },
      select: { creditId: true, code: true, amount: true }
    })
    let credits: Array<{ id: number; status: string }> = []
    if (rawRedemptions.length > 0) {
      credits = await prisma.storeCredit.findMany({
        where: { id: { in: rawRedemptions.map((r) => r.creditId) } },
        select: { id: true, status: true }
      })
    }
    const creditStatusMap = new Map(credits.map((c) => [c.id, String(c.status)]))

    const maskCredit = (c: string) => {
      const s = String(c ?? '').trim()
      if (!s) return '—'
      if (s.length <= 4) return '****'
      return '****-' + s.slice(-4)
    }

    const creditRedemptions = rawRedemptions.map((r) => ({
      creditId: r.creditId,
      code: maskCredit(r.code),
      amount: toNumberRial(r.amount),
      creditStatus: creditStatusMap.get(r.creditId) ?? 'USED'
    }))

    const isExchangeDoc = invoice.sourceInvoiceId != null || invoice.orderType === OrderType.EXCHANGE
    let sourceReceiptNo: number | null = null
    if (invoice.sourceInvoiceId != null) {
      const parent = await prisma.saleInvoice.findUnique({
        where: { id: invoice.sourceInvoiceId },
        select: { receiptNo: true }
      })
      sourceReceiptNo = parent?.receiptNo ?? null
    }

    let profileKind: InvoiceSettlementProfile['kind'] = 'PAID_CASHLIKE'
    if (isExchangeDoc) {
      profileKind = 'EXCHANGE_DOC'
    } else if (creditRedemptions.length > 0) {
      profileKind = 'STORE_CREDIT_FUNDED'
    } else if (cashLike === 0) {
      profileKind = 'CREDIT_ONLY'
    } else if (remainingDebt > 0 && cashLike > 0) {
      profileKind = 'MIXED'
    } else {
      profileKind = 'PAID_CASHLIKE'
    }

    const settlementProfile: InvoiceSettlementProfile = {
      kind: profileKind,
      cashLikeReceived: cashLike,
      cashLikeRefundableNow,
      remainingDebt,
      creditRedemptions,
      isExchangeDoc,
      sourceReceiptNo
    }

    return {
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      returnCode: invoice.returnCode ?? code,
      issuedAt: issuedAt.toISOString(),
      issuedAtJalali: invoice.issuedAtJalali || toJalaliDate(issuedAt),
      issuedTime: toClock(issuedAt),
      expiresAtJalali: toJalaliDate(expiresAt),
      daysLeft,
      expired: expiresAt.getTime() <= now.getTime(),
      customerName: invoice.customer?.name ?? 'مشتری عمومی',
      shiftName: invoice.shift?.name ?? null,
      status: invoice.status,
      statusLabel: saleStatusLabel(invoice.status, invoice.consolidationId != null),
      orderTypeLabel: ORDER_TYPE_LABELS[invoice.orderType] ?? invoice.orderType,
      // نشست ۱۵۸ (Y16) — کانال فاکتور برای عوارض کالای جایگزین در صفحه‌ی تعویض
      orderType: invoice.orderType,
      chargeScope: await exchangeChannelOf(prisma, Number(invoice.id)),
      goodsTotal: toNumberRial(invoice.goodsTotal),
      discountTotal: toNumberRial(invoice.discountTotal),
      taxTotal: toNumberRial(invoice.taxTotal),
      serviceCharge: toNumberRial(invoice.serviceCharge),
      deliveryFee: toNumberRial(invoice.deliveryFee),
      grandTotal: toNumberRial(invoice.grandTotal),
      paidTotal: toNumberRial(invoice.paidTotal),
      paymentLabels: paymentLabels(invoice.payments),
      deductInventory: invoice.deductInventory,
      returnedTotal: returnedTotalOf(invoice),
      items,
      warnings: [...new Set(warnings)],
      settlementProfile
    }
  },

  /**
   * برگشت جزئی یا کلی. موجودی برگشتی فوراً و به‌صورت FINAL به انبار برمی‌گردد.
   *
   * قواعد:
   *   • تعداد قابل برگشت هر قلم = تعداد فروش − برگشت‌های قبلی. بیشتر از آن فقط
   *     با تایید آگاهانه‌ی کاربر (`force`) ثبت می‌شود (اصل «هشدار، نه دیوار»).
   *   • اگر کالای یک قلم از فهرست کالاهای انبار حذف شده باشد، پیش‌فرض این است
   *     که برگشت نخورد و پیام «این کالا از موجودی انبار حذف شده است» نمایش
   *     داده شود. با تایید صریح (`allowRemoved`) برگشت ثبت می‌شود و اگر رکورد
   *     کالا موجود باشد موجودی هم برمی‌گردد. کالایی که رکوردش کاملاً از سیستم
   *     رفته باشد، در هیچ حالتی برگشت خودکار نمی‌خورد.
   *   • وضعیت فاکتور بر اساس *جمع* برگشت‌ها به‌روز می‌شود: همه‌ی اقلام برگشته
   *     ⇒ RETURNED، وگرنه PARTIALLY_RETURNED.
   */
  async createReturn(input: ReturnSaleInput) {
    validateReturnMutation(input)
    const fullRefundOverride = input.managerFullRefund === true
    if (fullRefundOverride) {
      if (String(input.overrideReason ?? '').trim().length < 3)
        throw new BusinessError('برای بازپرداخت مبلغ کاملِ بدون کسر تخفیف، دلیل مدیر (حداقل ۳ نویسه) اجباری است.')
      // نشست ۱۸۳ — رمز دوم/سوم پنل «برگشت از فروش» هم پذیرفته می‌شود
    // نشست ۱۸۴ — پول واقعی از کشو خارج می‌شود؛ «همیشه رمز» حتی با قفل خاموش.
    await assertPanelPasswordStrict(PANEL_KEYS.salesReturn, input.managerPassword, 'بازپرداخت مبلغ کاملِ بدون کسر تخفیف')
    }
    // نشست ۳۱۹ — گیت قفل کارت‌خوان: بازپرداخت با کارت‌خوان نیاز به تأیید مدیر دارد
    if (input.refundMethod === RefundMethod.CARD) {
      const o = input.cardPosOverride
      if (!o || !o.acknowledgedNoReverse || !String(o.reason ?? '').trim()) {
        throw new BusinessError(
          'بازپرداخت با کارت‌خوان قفل است: دستگاه‌های پوز بانکی امکان واریز برگشت وجه به کارت را ندارند.\n' +
            'از «کارت‌به‌کارت (تعهد مدیر)» استفاده کنید یا مدیر با ثبت رمز و دلیل آن را تأیید کند.'
        )
      }
      await assertManagerPassword(o.managerPassword, 'بازپرداخت کارتی (کارت‌خوان) برگشت')
    }
    // نشست ۶۳ (S63-2) — رمز مدیر دوره‌ی بسته قبل از تراکنش
    const periodApproved = await periodLockService.preverify({
      at: new Date(),
      what: 'ثبت برگشت از فروش',
      managerPassword: (input as any).managerPassword ?? null,
      overrideReason: (input as any).overrideReason ?? null
    })
    const overpayManagerApproved =
      input.overpayAsCredit === true
        ? await preverifyOverpayManager(input, 'صدور اعتبار از اضافه‌دریافت برگشت (بالاتر از سقف اعتبار)')
        : false
    return prisma.$transaction(async (tx) => {
      /**
       * بند ۱۷ — برگشت *همین حالا* ثبت می‌شود، پس تاریخِ بررسی «امروز» است: اگر
       * صندوق امروز قبلاً بسته شده باشد، این برگشت اعداد آن صندوق را عوض می‌کند
       * و بدون گیت مدیر نباید ثبت شود.
       */
      await periodLockService.assertOpen(tx, {
        at: new Date(),
        what: 'ثبت برگشت از فروش',
        entity: 'SaleReturn',
        managerVerified: periodApproved,
        managerPassword: (input as any).managerPassword ?? null,
        overrideReason: (input as any).overrideReason ?? null,
        userId: input.userId ?? null,
        after: { invoiceId: input.invoiceId, refundMethod: input.refundMethod ?? null }
      })
      // فیلدهای کمکیِ مسیر تعویض (رکوردهای خام) روی سیم IPC نمی‌روند
      // بند ۱۱ — مسیر برگشت ساده همیشه روش بازپرداخت را اجباری می‌کند
      const full = await runReturn(tx, input, { applyRefund: true, fullRefundOverride, overpayManagerApproved })
      // دادهٔ خام فقط برای ادامهٔ تراکنش است؛ پاسخ استاندارد هیچ credential ندارد.
      const {
        returnRecord: _rec,
        invoice: _inv,
        returnedLines: _lines,
        storeCreditCode: _storeCreditCode,
        storeCredit: rawStoreCredit,
        overpayCredit: rawOverpayCredit,
        ...res
      } = full

      /**
       * ---------------- جلسه ۱۷ · بند ۱ — «کارت‌به‌کارت توسط مدیر» ----------------
       * هیچ پرداختی، هیچ `CashMovement` و هیچ اعتبار خریدی ساخته نمی‌شود؛ فقط یک
       * «درخواست پرداخت» با وضعیت «در انتظار پرداخت» که به همین سند برگشت، فاکتور
       * اصلی، شیفت و کارمند ثبت‌کننده وصل است. بدون این سند مرجع، سرویس
       * `CardTransferService` اجازه‌ی ساخت درخواست نمی‌دهد.
       */
      let cardTransfer: any = null
      if (full.refundMethod === RefundMethod.CARD_TO_CARD) {
        const rec: any = _rec
        const inv: any = _inv
        const shift = rec?.shiftId
          ? await tx.shift.findUnique({ where: { id: rec.shiftId }, select: { name: true } })
          : null
        const who = input.userId
          ? await tx.user.findUnique({ where: { id: input.userId }, select: { displayName: true, username: true } })
          : null
        cardTransfer = await createCardTransferRequest(tx, {
          returnId: rec.id,
          operationKind: 'RETURN',
          amount: full.refundAmount ?? 0,
          sourceInvoiceId: inv?.id ?? null,
          sourceReceiptNo: inv?.receiptNo ?? null,
          invoiceTotal: inv?.grandTotal ?? 0,
          returnTotal: rec?.total ?? 0,
          items: (_lines ?? []).map((l: any) => ({
            name: l.name ?? 'کالا',
            qty: l.qty,
            unitPrice: l.unitPrice
          })),
          /**
           * جلسه ۴۰ · کار ب — `stockNote` باید *وضعیت واقعی* را بگوید. در این
           * مسیر (کارت‌به‌کارت مدیر) کالا **به انبار نرفته** و معلق است؛ متن
           * قبلی («برگشت N عدد به انبار») از این نسخه دروغ می‌شد.
           * بعد از `pay` همین ستون به‌روز می‌شود.
           */
          stockNote: full.restockPending
            ? pendingStockNote(full.pendingRestockQty ?? 0, faDigits)
            : full.restocked
              ? `برگشت ${faDigits(full.restockedQty ?? 0)} عدد به انبار`
              : 'بدون برگشت به انبار (فاکتور بدون کسر موجودی)',
          userId: input.userId ?? null,
          userName: who?.displayName ?? who?.username ?? null,
          shiftId: rec?.shiftId ?? null,
          shiftName: shift?.name ?? null,
          note: 'ثبت‌شده از پنل برگشت از فروش'
        })
        await tx.auditLog.create({
          data: {
            action: AuditAction.CARD_TRANSFER_REQUEST,
            entity: 'CardTransferRequest',
            entityId: cardTransfer.id,
            userId: input.userId ?? null,
            after: JSON.stringify({
              returnId: rec.id,
              receiptNo: inv?.receiptNo ?? null,
              amount: cardTransfer.amount
            }),
            note:
              `درخواست کارت‌به‌کارت ${money(cardTransfer.amount)} ریال ثبت شد (در انتظار پرداخت مدیر) · ` +
              'هیچ پولی در این لحظه جابه‌جا نشد و این مبلغ در سرجمع فروش نمی‌آید' +
              (full.restockPending
                ? ` · ${faDigits(full.pendingRestockQty ?? 0)} قلم کالای برگشتی تا زدن «پرداخت شد» در موجودی قابل‌فروش نمی‌نشیند`
                : '') +
              '.'
          }
        })
      }
      return {
        ...res,
        /** فقط مرجع امنِ اعتبار صادرشده برای برگشت. */
        storeCredit: rawStoreCredit ? shapeStoreCreditSafe(rawStoreCredit) : null,
        storeCreditReference: rawStoreCredit ? `اعتبار #${rawStoreCredit.id}` : null,
        overpayCredit: shapeOverpayCreditSafe(rawOverpayCredit),
        cardTransfer
      }
    }, TX_OPTIONS)
  },

  // =========================================================================
  // تعویض کالا (بخش ۶)
  // =========================================================================

  /**
   * -------------------------------------------------------------------------
   * ثبت یک «تعویض کالا»: برگشت چند قلم + فروش چند قلم جایگزین، اتمیک.
   *
   * ================== معماری (تصمیمِ نشست قبل، پیاده‌شده اینجا) ==================
   * تعویض = **یک `SaleInvoice` جدید با `orderType = EXCHANGE`** که *فقط* اقلام
   * جایگزین را دارد و با دو کلید به سند برگشت و فاکتور اصلی گره خورده است
   * (`exchangeReturnId` / `sourceInvoiceId`) — نه گسترش `SaleReturn` با «قلم
   * جایگزین».
   *
   * چرا؟ قلم جایگزین یک **فروش واقعی** است و باید از همه‌ی مسیرهای موجود رد شود:
   * کسر موجودی `InventoryService`، شماره فیش، کد فاکتور و مهلت برگشت، «جزئیات
   * فروش»، تجمیع و انتقال، و چاپ. اگر داخل `SaleReturn` می‌رفت، هر شش مسیر باید
   * دوباره نوشته می‌شدند و دو حساب موازی پیدا می‌کردیم.
   *
   * ================== تسویه‌ی مابه‌التفاوت ==================
   * مابه‌التفاوت = جمع اقلام جایگزین − جمع اقلام برگشتی.
   *
   *   • ارزش کالای برگشتی همیشه به‌صورت یک پرداختیِ **غیرنقدی** با روش پرداخت
   *     `EXCHANGE_CREDIT` روی سند تعویض می‌نشیند (تا سقف جمع همان سند).
   *   • مثبت (مشتری بدهکار) ⇒ مابه‌التفاوت را نقد/کارت می‌پردازد ⇒ یک پرداختی
   *     واقعی با `methodId`. settlement = CASH.
   *   • منفی (ما بدهکار) ⇒ **بارکد اعتبار خرید بعدی** به مبلغ اختلاف صادر و روی
   *     سند تعویض چاپ می‌شود. settlement = CREDIT. هیچ پولی از صندوق بیرون
   *     نمی‌رود.
   *   • صفر ⇒ settlement = NONE.
   *
   * هر دو روش `EXCHANGE_CREDIT` و `STORE_CREDIT` در `paidTotal` می‌نشینند (پس
   * سند «تسویه‌شده» است) ولی `reportShape.paymentSplit` عمداً آن‌ها را از
   * نقدی/کارت و از «خالص واقعی دریافتی» بیرون می‌گذارد ⇒ فروشنده نمی‌تواند با
   * تعویض‌های صوری، پول نقد صندوق را جابه‌جا کند.
   * -------------------------------------------------------------------------
   */
  async createExchange(input: ExchangeSaleInput): Promise<ExchangeSaleResult> {
    validateExchangeMutation(input)
    if (!input?.invoiceId) throw new BusinessError('فاکتور اصلی مشتری برای تعویض مشخص نشده است.')
    const replacements = (input.replacements ?? []).filter((r) => r?.variantId && r.qty > 0)
    if (!replacements.length)
      throw new BusinessError('برای تعویض، حداقل یک «کالای جایگزین» با تعداد بزرگ‌تر از صفر انتخاب کنید.')
    if (!input.full && !(input.lines ?? []).some((l) => l.qty > 0))
      throw new BusinessError('برای تعویض، تعداد حداقل یک «کالای برگشتی» را بزرگ‌تر از صفر بگذارید.')

    /**
     * ---------------- بند ۱۲ — انتخاب اجباری، نه پیش‌فرض ضمنی ----------------
     * `refundMode` اگر فرستاده شده باشد باید معتبر باشد. اجباری بودنش *بعد* از
     * محاسبه‌ی مابه‌التفاوت بررسی می‌شود (فقط وقتی منفی است)، چون در تعویضِ با
     * مابه‌التفاوت مثبت یا صفر، انتخابی برای کردن وجود ندارد و مجبور کردن کاربر
     * به یک انتخاب بی‌معنی، UI را بی‌دلیل سنگین می‌کند.
     */
    const refundMode = input.refundMode == null ? null : String(input.refundMode).toUpperCase()
    // جلسه ۱۷ · بند ۱ — گزینه‌ی چهارم، کاملاً جدا از `CARD` (کارت‌خوان فروشگاه)
    if (refundMode && !['CASH', 'CARD', 'STORE_CREDIT', 'CARD_TO_CARD'].includes(refundMode))
      throw new BusinessError(
        'روش بازپرداخت مابه‌التفاوت نامعتبر است (نقد / کارت / اعتبار خرید / کارت‌به‌کارت توسط مدیر).'
      )

    // نشست ۳۱۹ — گیت قفل کارت‌خوان برای تعویض
    if (refundMode === 'CARD') {
      const o = input.cardPosOverride
      if (!o || !o.acknowledgedNoReverse || !String(o.reason ?? '').trim()) {
        throw new BusinessError(
          'بازپرداخت با کارت‌خوان قفل است: دستگاه‌های پوز بانکی امکان واریز برگشت وجه به کارت را ندارند.\n' +
            'از «کارت‌به‌کارت (تعهد مدیر)» استفاده کنید یا مدیر با ثبت رمز و دلیل آن را تأیید کند.'
        )
      }
      await assertManagerPassword(o.managerPassword, 'بازپرداخت کارتی (کارت‌خوان) تعویض')
    }

    /**
     * ---------------- بند ۱۸ — قیمت دستیِ کالای جایگزین ----------------
     * حفره‌ی واقعی: `unitPrice` هر عددی (حتی صفر) که فروشنده می‌فرستاد پذیرفته
     * می‌شد. یعنی می‌شد کالای برگشتیِ ۳ میلیونی را با کالایی که قیمت واقعی‌اش ۱
     * میلیون است ولی روی صفر گذاشته شده تعویض کرد و ۳ میلیون اعتبار گرفت —
     * بدون این‌که در گزارش چیز غیرعادی دیده شود.
     *
     * حالا: قیمت **همیشه** از `variant.salePrice` می‌آید. اگر ردیفی `unitPrice`
     * صریح فرستاده باشد که با قیمت واقعی فرق دارد، تا وقتی رمز مدیر تایید نشود
     * حتی یک رکورد هم نوشته نمی‌شود. تایید مدیر *قبل* از شروع تراکنش گرفته
     * می‌شود تا یک تراکنش نیمه‌کاره‌ی رول‌بک‌شده جا نماند.
     */
    const policy = await settingsService.accountingPolicy()
    /**
     * نشست ۱۵۸ (Y14 + Y16 + Y17، S158-D1..D4) — کالای جایگزین همان گیت‌های فروش را می‌گیرد،
     * پیش از تراکنش (رمز مدیر روی AuthLockout می‌نویسد):
     *   Y17: قبلاً «حضور unitPrice» رمز می‌خواست (UI همیشه قیمت می‌فرستد ⇒ هر تعویض عادی رمز
     *        می‌خواست، خلاف بند ۴-۳۱؛ افزایش هم رمز می‌خواست، خلاف S151-D3). حالا فقط کاهش زیر
     *        قیمت واقعی کالا رمز مدیر می‌خواهد (preverifySalePolicy، گیت requireManagerForPriceOverride).
     *   Y14: بازه‌ی سیاست تخفیف (بند ۴-۲۶) روی تخفیف قلم، تخفیف کل سند و کاهش قیمت، برای کانال
     *        غیرعمده؛ عبور = رد، با رمز مدیر هم باز نمی‌شود.
     *   Y16: عوارض/حق سرویس از تنظیمات کانال فاکتور اصلی (preverifyExchangeCharges).
     * کانال = orderType فاکتور اصلی (زنجیره‌ی تعویض دنبال می‌شود، بند ۴-۲۱). اگر یکی از
     * کالاهای جایگزین پیدا نشود، پیش‌سنجی انجام نمی‌شود تا همان پیام قدیمی داخل تراکنش بیاید.
     */
    const exchangeScope = await exchangeChannelOf(prisma, Number(input.invoiceId))
    const preVariantIds = [...new Set(replacements.map((r) => Number(r.variantId)))]
    const preVariants = new Map<number, { code: string; salePrice: number }>()
    for (const v of await loadProductVariantsByIds(prisma, preVariantIds, { id: true, code: true, salePrice: true }))
      preVariants.set(Number(v.id), { code: String(v.code ?? ''), salePrice: Math.round(Number(v.salePrice ?? 0)) })
    let exchangeManagerVerified = false
    let exchangePricing: SalePricingCheck | null = null
    let exchangeCharges: { taxPerLine: number[]; invoiceTax: number; serviceCharge: number } | null = null
    if (preVariantIds.every((id) => preVariants.has(id))) {
      const preLines = replacements.map((r) => {
        const v = preVariants.get(Number(r.variantId))!
        return {
          variantId: Number(r.variantId),
          code: v.code,
          barcode: '',
          name: v.code,
          qty: r.qty,
          unitPrice: r.unitPrice == null ? v.salePrice : Math.round(Number(r.unitPrice)),
          discount: Math.round(Number(r.discount ?? 0)),
          tax: r.tax == null ? null : Math.round(Number(r.tax))
        }
      })
      exchangeCharges = await preverifyExchangeCharges(
        preLines,
        { invoiceDiscount: input.invoiceDiscount, invoiceTax: input.invoiceTax, serviceCharge: input.serviceCharge },
        exchangeScope
      )
      // نشست ۱۵۸ (S158-D6) — تخفیف بیش از مبلغ قلم/سند همان پیام اختصاصی S141 داخل تراکنش را بگیرد
      const overDiscount =
        preLines.some((l) => l.discount > l.unitPrice * l.qty) ||
        Math.round(Number(input.invoiceDiscount ?? 0)) > preLines.reduce((s, l) => s + l.unitPrice * l.qty - l.discount, 0)
      if (!overDiscount) exchangePricing = await preverifySalePolicy(
        {
          lines: preLines.map((l) => ({ ...l, tax: 0 })),
          invoiceDiscount: input.invoiceDiscount ?? 0,
          managerPassword: input.managerPassword ?? null
        } as any,
        { orderType: exchangeScope === 'wholesale' ? OrderType.WHOLESALE : OrderType.INTERNAL }
      )
      if (exchangePricing?.managerApproved) exchangeManagerVerified = true
    }
    /**
     * نشست ۶۳ (S63-2/S63-3) — هر رمز مدیری که این تعویض لازم دارد (دوره‌ی بسته،
     * اعتبار بالاتر از سقف) **قبل از** تراکنش و فقط یک بار سنجیده می‌شود؛ داخل
     * تراکنش فقط نتیجه (`exchangeManagerVerified`) خوانده می‌شود. قبلاً سقف اعتبار
     * `assertManagerPassword` را وسط تراکنش باز صدا می‌زد (نوشتن AuthLockout با
     * کلاینت سراسری = قفل SQLite؛ رمز اشتباه با rollback شمرده نمی‌شد).
     */
    const exchangePeriodApproved = await periodLockService.preverify({
      at: new Date(),
      what: 'ثبت تعویض کالا',
      managerPassword: input.managerPassword ?? null,
      overrideReason: (input as any).overrideReason ?? null,
      alreadyVerified: exchangeManagerVerified
    })
    if (exchangePeriodApproved) exchangeManagerVerified = true
    if (!exchangeManagerVerified && String(input.managerPassword ?? ''))
      exchangeManagerVerified = await preverifyOverpayManager(input, 'تایید مدیر در تعویض کالا (سقف اعتبار خرید)')

    return prisma.$transaction(async (tx) => {
      // بند ۱۷ — تعویض هم یک سند مالی است و در دوره‌ی بسته گیت مدیر می‌خواهد
      await periodLockService.assertOpen(tx, {
        at: new Date(),
        what: 'ثبت تعویض کالا',
        entity: 'SaleReturn',
        managerVerified: exchangePeriodApproved,
        managerPassword: input.managerPassword ?? null,
        overrideReason: (input as any).overrideReason ?? null,
        userId: input.userId ?? null,
        after: { invoiceId: input.invoiceId, refundMode: refundMode ?? null }
      })

      /**
       * جلسه ۵۰ · مرحله ۱-ب — همین متن پایه، *بعد از* ساخته شدن سند، با تگ
       * «برداشت از انبار» دوباره نوشته می‌شود (پایین‌تر). یک‌جا نگه داشته شده تا
       * هر دو نقطه مو‌به‌مو یک رشته را مبنا بگیرند و سابقه از توضیح کاربر جدا
       * نشود.
       */
      const returnNote = input.note ? `تعویض کالا · ${input.note}` : 'تعویض کالا'

      // ---------- ۱) برگشت اقلام، از همان هسته‌ی مشترک برگشت از فروش ----------
      const back = await runReturn(
        tx,
        {
          invoiceId: input.invoiceId,
          full: false,
          lines: input.lines ?? [],
          note: returnNote,
          userId: input.userId ?? null,
          force: input.force,
          allowRemoved: input.allowRemoved
        } as ReturnSaleInput,
        // تسویه‌ی مابه‌التفاوت بعد از ساخته‌شدن سند تعویض انجام می‌شود، نه اینجا
        {
          kind: ReturnKind.EXCHANGE,
          applyRefund: false,
          /**
           * جلسه ۴۰ · کار ب — اگر *قصد* تسویه «کارت‌به‌کارت مدیر» است، کالای
           * برگشتی از همین لحظه معلق می‌ماند. مابه‌التفاوت هنوز حساب نشده، پس
           * ممکن است آخر معلوم شود پرداخت مدیری در کار نیست (مابه‌التفاوت صفر
           * یا به نفع فروشگاه)؛ در آن حالت پایین‌تر، در همین تراکنش، کالا آزاد
           * می‌شود. محافظه‌کارانه‌ترین ترتیب همین است: اول معلق، بعد آزادسازیِ
           * آگاهانه — نه برعکس.
           */
          deferRestock: refundMode === 'CARD_TO_CARD'
        }
      )
      const source = back.invoice
      const returnTotal = toNumberRial(back.total)
      const now = new Date()

      // ---------- ۲) قیمت اقلام جایگزین ----------
      const variantIds = [...new Set(replacements.map((r) => Number(r.variantId)))]
      const variants = await loadProductVariantsByIds(tx, variantIds, {
        id: true,
        code: true,
        salePrice: true,
        stock: true,
        size: true,
        color: true,
        isActive: true,
        product: { select: { name: true, unit: true, isActive: true } }
      })
      const vmap = new Map(variants.map((v) => [v.id, v]))
      const missing = variantIds.filter((id) => !vmap.has(id))
      if (missing.length)
        throw new BusinessError(
          'یکی از «کالاهای جایگزین» در انبار پیدا نشد (ممکن است حذف شده باشد). آن ردیف را حذف و کالا را دوباره انتخاب کنید.'
        )

      /** بند ۱۸ — ردیف‌هایی که قیمتشان دستی عوض شده، برای AuditLog */
      const priceOverrides: { variantId: number; name: string; realPrice: number; enteredPrice: number }[] = []

      // نشست ۱۵۸ (Y16) — پیش‌سنجی بیرون از تراکنش باید انجام شده باشد (همه‌ی کالاها پیدا شده بودند)
      if (!exchangeCharges)
        throw new BusinessError(
          'یکی از «کالاهای جایگزین» در انبار پیدا نشد (ممکن است حذف شده باشد). آن ردیف را حذف و کالا را دوباره انتخاب کنید.'
        )
      const repCharges = exchangeCharges

      const repLines: CartLine[] = replacements.map((r, idx) => {
        const v = vmap.get(Number(r.variantId))!
        const name = `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
        /**
         * بند ۱۸ — پیش‌فرض **همیشه** قیمت واقعی کالا است. قیمت دستی فقط با گیت
         * مدیرِ بالا از این نقطه رد می‌شود و رد کاملش (قیمت واقعی + قیمت
         * واردشده + کاربر) در AuditLog می‌نشیند.
         */
        const realPrice = toNumberRial(v.salePrice ?? 0)
        const entered = r.unitPrice == null ? null : r.unitPrice
        const unitPrice = entered == null ? realPrice : entered
        if (entered != null && entered !== realPrice)
          priceOverrides.push({ variantId: v.id, name, realPrice, enteredPrice: entered })
        return {
          variantId: v.id,
          code: v.code,
          barcode: '',
          name,
          qty: r.qty,
          unitPrice,
          discount: r.discount ?? 0,
          // نشست ۱۵۸ (Y16) — عوارض ردیف از خروجی preverifyExchangeCharges، نه ورودی IPC
          tax: repCharges.taxPerLine[idx] ?? 0
        } as CartLine
      })

      /**
       * کسر موجودی سند تعویض، *متقارن با فاکتور اصلی*: اگر فاکتور اصلی موجودی را
       * کم نکرده بود (فاکتور عمده‌ی «بدون کسر از موجودی»)، برگشتش هم موجودی را
       * برنگردانده، پس قلم جایگزین هم نباید انبار را کم کند — وگرنه انبار با یک
       * تعویض ساده بی‌دلیل منفی می‌شد.
       */
      const deductInventory = source.deductInventory !== false

      const central =
        deductInventory && input.autoCentralWithdraw === true
          ? await secondaryStockService.coverShortage(
              tx,
              repLines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
              { userId: input.userId ?? null, note: 'سند تعویض کالا · برداشت خودکار کمبود از انبار مرکزی' }
            )
          : { warnings: [] as string[], taken: [], totalTaken: 0 }

      const stockWarnings = deductInventory
        ? [
            ...central.warnings,
            ...(await inventoryService.checkAvailability(
              repLines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
              tx
            ))
          ]
        : []

      // ---------- ۳) جمع‌های سند تعویض ----------
      const exTotals = saleTotals({
        lines: repLines,
        invoiceDiscount: input.invoiceDiscount ?? 0,
        // نشست ۱۵۸ (Y16) — عوارض سطح فاکتور و حق سرویس از تنظیمات کانال فاکتور اصلی
        invoiceTax: repCharges.invoiceTax,
        serviceCharge: repCharges.serviceCharge,
        payments: []
      } as CreateSaleInput)
      /**
       * ممیزی S141 (AUDIT-S141-01، AUDIT-D71) — validateExchangeMutation تخفیف را فقط «≥۰» می‌سنجید.
       * تخفیف قلم بیش از مبلغ همان قلم (یا تخفیف کل بیش از جمع سند) سند تعویض منفی و
       * مابه‌التفاوتی بزرگ‌تر از ارزش کالای برگشتی می‌ساخت ⇒ بازپرداخت نقد/اعتبار اضافه.
       * همان قید validateSaleInput: هر قلم و جمع سند غیرمنفی (قیمت واقعی فقط اینجا معلوم است؛
       * پرتاب داخل تراکنش همه‌چیز را rollback می‌کند).
       */
      for (const l of repLines) {
        const lineGross = l.unitPrice * l.qty + l.tax
        if (l.unitPrice * l.qty - l.discount + l.tax < 0)
          throw new BusinessError(
            `تخفیف کالای جایگزین «${l.name}» (${money(l.discount)} ریال) از مبلغ همان قلم (${money(lineGross)} ریال) بیشتر است؛ ` +
              'تعویض ثبت نشد. تخفیف را حداکثر به اندازه‌ی مبلغ قلم بگذارید.'
          )
      }
      if (exTotals.grandTotal < 0)
        throw new BusinessError(
          `جمع سند تعویض پس از تخفیف ${money(exTotals.discountTotal)} ریال منفی می‌شود (${money(exTotals.grandTotal)} ریال)؛ ` +
            'تعویض ثبت نشد. تخفیف کل نباید از جمع کالای جایگزین بیشتر باشد.'
        )
      assertSafeInteger(exTotals.grandTotal, 'جمع سند تعویض', 0)
      const exchangeTotal = exTotals.grandTotal
      const diff = exchangeTotal - returnTotal

      // ---------- ۴) سند تعویض (SaleInvoice با orderType = EXCHANGE) ----------
      const defaults = await saleDefaultsWith(tx)
      const generated = await generateReturnCode(tx, {
        length: defaults.returnCodeLength,
        days: defaults.returnCodeDays,
        issuedAt: now
      })
      const shiftId = await shiftService.currentId(tx, input.userId ?? null, (input as any).custodyFence ?? null)

      const exchangeInvoice = await tx.saleInvoice.create({
        data: {
          receiptNo: await nextReceiptNo(tx),
          customerId: source.customerId ?? null,
          userId: input.userId ?? null,
          shiftId,
          issuedAt: now,
          issuedAtJalali: toJalaliDate(now),
          status: SaleStatus.SETTLED,
          orderType: OrderType.EXCHANGE,
          deductInventory,
          returnCode: generated.code,
          returnCodeExpiresAt: generated.expiresAt,
          goodsTotal: exTotals.goodsTotal,
          taxTotal: exTotals.taxTotal,
          serviceCharge: exTotals.serviceCharge,
          discountTotal: exTotals.discountTotal,
          deliveryFee: 0,
          grandTotal: exchangeTotal,
          paidTotal: 0,
          // گره‌های معماری: این سند از کدام برگشت و کدام فاکتور اصلی آمده است
          exchangeReturnId: back.id,
          sourceInvoiceId: source.id,
          note: `سند تعویض کالا · فاکتور اصلی ${faDigits(source.receiptNo)}` + (input.note ? ` · ${input.note}` : ''),
          items: { create: await saleItemRows(tx, repLines) }
        },
        include: { items: true, customer: true, shift: true }
      })

      if (deductInventory) {
        await inventoryService.decrease(
          repLines.map((l) => ({ variantId: l.variantId, qty: l.qty })),
          {
            reason: 'SALE',
            refType: 'SaleInvoice',
            refId: exchangeInvoice.id,
            state: StockState.PENDING,
            userId: input.userId ?? null,
            note: `سند تعویض کالا ${faDigits(exchangeInvoice.receiptNo)}`
          },
          tx
        )
      }

      // ---------- ۵) تسویه‌ی مابه‌التفاوت ----------
      let seq = 0

      /** ارزش کالای برگشتی، تا سقف جمع سند تعویض (پول نقد نیست). */
      const exchangeCreditApplied = Math.min(returnTotal, exchangeTotal)
      if (exchangeCreditApplied > 0) {
        await tx.payment.create({
          data: {
            invoiceId: exchangeInvoice.id,
            methodId: await nonCashMethodId(tx, EXCHANGE_CREDIT_METHOD_KEY),
            amount: exchangeCreditApplied,
            kind: PaymentEntryKind.CASH,
            seq: ++seq,
            paidAt: now,
            paidAtJalali: toJalaliDate(now),
            paidAtTime: toClock(now),
            createdAt: now,
            createdByUserId: input.userId ?? null,
            createdShiftId: shiftId,
            note: `ارزش کالای برگشتی فاکتور ${faDigits(source.receiptNo)} (پول نقد نیست)`
          }
        })
      }

      let cashReceived = 0
      /** نشست ۱۸۲ · بند ۴-۴۹ — مابه‌التفاوتی که با کارت‌خوان گرفته شد (پول هست، کشو نیست) */
      let cardReceived = 0
      /** مابه‌التفاوتی که *ما* به مشتری برگرداندیم (بند ۱۲) */
      let cashRefunded = 0
      /** جلسه ۱۷ · بند ۱ — مبلغی که قرار است مدیر کارت‌به‌کارت کند (هنوز پرداخت نشده) */
      let cardToCard = 0
      let settlement: string = ExchangeSettlement.NONE
      let credit: any = null
      /** نشست ۶۰ (بند ۴-۵) — بخشی از مابه‌التفاوت منفی که از بدهی فاکتور اصلی کم شد */
      let debtCut = 0

      if (diff > 0) {
        /**
         * پرداخت ترکیبی مثبت فقط نقد + کارت است: دو Payment واقعی، دو مقصد
         * واقعی و جمع دقیق مابه‌التفاوت. مسیر تک‌روش پایین عمداً دست‌نخورده است.
         */
        if (input.splitPayment === true) {
          const rows = input.payments ?? []
          if (rows.length !== 2 || rows.some((row) => !row || row.amount <= 0))
            throw new BusinessError('پرداخت ترکیبی مابه‌التفاوت تعویض باید دقیقاً دو سهم مثبت نقد و کارت داشته باشد.')
          const sum = rows.reduce((total, row) => total + row.amount, 0)
          if (!Number.isSafeInteger(sum) || sum !== diff)
            throw new BusinessError(`جمع نقد و کارت مابه‌التفاوت باید دقیقاً ${money(diff)} ریال باشد.`)
          const methodIds = [...new Set(rows.map((row) => row.methodId))]
          const methodRows = await tx.paymentMethod.findMany({
            where: { id: { in: methodIds }, isActive: true },
            select: { id: true, kind: true }
          })
          const kindById = new Map(methodRows.map((method) => [method.id, method.kind]))
          const cashRows = rows.filter((row) => kindById.get(row.methodId) === PaymentKind.CASH && row.destination === PaymentDestination.CASH)
          const cardRows = rows.filter((row) => kindById.get(row.methodId) === PaymentKind.CARD && row.destination === PaymentDestination.CARD)
          if (cashRows.length !== 1 || cardRows.length !== 1)
            throw new BusinessError('پرداخت ترکیبی مابه‌التفاوت فقط یک سهم نقدی با مقصد صندوق و یک سهم کارتی با مقصد کارت‌خوان می‌پذیرد.')
          for (const row of [cashRows[0], cardRows[0]]) {
            const destination = assertDestination(row.destination, kindById.get(row.methodId), 'PAYMENT')
            await tx.payment.create({
              data: {
                invoiceId: exchangeInvoice.id,
                methodId: row.methodId,
                amount: row.amount,
                kind: PaymentEntryKind.CASH,
                destination,
                seq: ++seq,
                paidAt: now,
                paidAtJalali: toJalaliDate(now),
                paidAtTime: toClock(now),
                createdAt: now,
                createdByUserId: input.userId ?? null,
                createdShiftId: shiftId,
                note: `مابه‌التفاوت تعویض کالا (دریافت ${destination === PaymentDestination.CARD ? 'کارت‌خوان' : 'نقدی'})`
              }
            })
          }
          cashReceived = cashRows[0].amount
          cardReceived = cardRows[0].amount
        } else {
          // مشتری مابه‌التفاوت را با یک روش پرداخت می‌کند (رفتار قدیمی)
          const methodRow = input.methodId
            ? await tx.paymentMethod.findUnique({ where: { id: Number(input.methodId) }, select: { id: true, kind: true, key: true } })
            : await tx.paymentMethod.findFirst({
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' },
                select: { id: true, kind: true, key: true }
              })
          const methodId = methodRow?.id
          if (!methodId)
            throw new BusinessError('روش پرداخت پیدا نشد؛ از پنل تنظیمات یک روش پرداخت فعال کنید.')
          await assertPaymentMethodExists(tx, methodId)

          /** مقصد پول مثل addPayment، اجباری و سازگار با kind است. */
          const destination = assertDestination(
            input.destination ?? destinationFromMethodKind(methodRow?.kind ?? null),
            methodRow?.kind,
            'PAYMENT'
          )
          await tx.payment.create({
            data: {
              invoiceId: exchangeInvoice.id,
              methodId,
              amount: diff,
              kind: PaymentEntryKind.CASH,
              destination,
              seq: ++seq,
              paidAt: now,
              paidAtJalali: toJalaliDate(now),
              paidAtTime: toClock(now),
              createdAt: now,
              createdByUserId: input.userId ?? null,
              createdShiftId: shiftId,
              note: `مابه‌التفاوت تعویض کالا (دریافت از مشتری${destination === PaymentDestination.CARD ? ' — کارت‌خوان' : ''})`
            }
          })
          if (destination === PaymentDestination.CARD) cardReceived = diff
          else cashReceived = diff
        }
        settlement = ExchangeSettlement.CASH
      } else if (diff < 0) {
        /**
         * ============== بند ۱۲ — ما بدهکار شدیم: انتخاب، نه پیش‌فرض ==============
         * رفتار قبلی: *همیشه و بدون پرسیدن* `issueStoreCredit`. یعنی مشتری هیچ‌وقت
         * نمی‌توانست پول نقدش را بگیرد و سیستم هم هیچ‌وقت نمی‌دانست پولی از کشو
         * بیرون رفته یا نه. حالا `refundMode` اجباری است:
         *
         *   CASH         ⇒ فقط `CashMovement(EXCHANGE_REFUND)` + ثبت روی سند تعویض
         *   CARD         ⇒ فقط ثبت روی سند تعویض (اثرش روی کارتخوان است)
         *   (نشست ۵۹: `Payment` منفی دیگر ساخته نمی‌شود — پاراگراف ⚠️ زیر منسوخ است)
         *   STORE_CREDIT ⇒ رفتار قدیمی (بارکد اعتبار)
         *
         * ⚠️ [منسوخ از نشست ۵۹، بند ۴-۹ مالک] تصمیم معماری قدیمی: **`Payment` با مبلغ منفی**، نه یک مدل
         * جدید `Refund`. دلیلش این است که کل برنامه (بستن صندوق، جزئیات شیفت،
         * تاریخچه‌ی پرداختی‌ها، حذف فاکتور، ادغام بکاپ) از قبل جدول `Payment` را
         * می‌خواند؛ یک مدل موازی یعنی همان شش مسیر باید دوباره نوشته شوند و دو
         * حساب موازی پیدا کنیم. علامتِ منفی، جهت را بی‌ابهام نگه می‌دارد و
         * `CashMovement` رد مستقل و قابل‌تطبیقش را می‌سازد.
         */
        /**
         * ============ نشست ۶۰ · خوشه B (بند ۴-۵ و ۴-۳۷، DECISIONS S60-1) ============
         * قبلاً کل مابه‌التفاوت منفی همیشه پول/اعتبار می‌شد، حتی وقتی مشتری هنوز
         * بابت همین فاکتور بدهکار بود. مثال: نسیه‌ی پرداخت‌نشده‌ی ۱٬۰۰۰، تعویض ۶۰۰ ⇒ ۲۰۰
         * ⇒ ۴۰۰ ریال نقد از کشو به مشتری‌ای داده می‌شد که هیچ پولی نداده بود (و بدهی
         * ۱٬۰۰۰ هم دست‌نخورده می‌ماند).
         *
         * حالا: اول از بدهی فعلی فاکتور اصلی (فرمول واحد remainingOf) کم می‌شود
         * (`debtCut`)؛ فقط مازادش (`owed`) ــ که پولی است که مشتری واقعاً اضافه
         * داده ــ با روش انتخابی (نقد/کارت/کارت‌به‌کارت/اعتبار) پس داده می‌شود.
         * کاهش بدهی هیچ پولی جابه‌جا نمی‌کند ⇒ نه CashMovement، نه اعتبار.
         */
        const owedTotal = -diff
        const srcRows = await tx.payment.findMany({
          // ممیزی A88-03 — بدهی فاکتور مبدأ بدون پرداخت‌های باطل
          where: { invoiceId: source.id, voidedAt: null },
          select: { amount: true, kind: true, chequeStatus: true }
        })
        const srcDebt = await invoiceRemaining(tx, source.id, toNumberRial(source.grandTotal), receivedTotalOf(srcRows))
        debtCut = Math.min(owedTotal, Math.max(0, srcDebt.remaining))
        const owed = owedTotal - debtCut
        if (owed > 0) {
          /**
           * سقف ایمنی: بازپرداخت از پول *دریافتی* بیشتر نمی‌شود (پول دریافتی خالص
           * منهای بازپرداخت‌های قبلیِ تعویض‌های همین فاکتور). در عمل با debtCut
           * بالا همیشه برقرار است؛ اگر داده‌ی خراب آن را بشکند، رد کامل با پیام.
           */
          const prevExRefunds = await exchangeRefundsAlreadyPaid(tx, source.id, back.id)
          const refundable = Math.max(0, srcDebt.netReceived - prevExRefunds)
          if (owed > refundable)
            throw new BusinessError(
              `بازپرداخت ${money(owed)} ریال در این تعویض ممکن نیست: از پول دریافتی این فاکتور فقط ` +
                `${money(refundable)} ریال قابل پس‌دادن است (دریافتی خالص ${money(srcDebt.netReceived)} ریال، ` +
                `بازپرداخت تعویض‌های قبلی ${money(prevExRefunds)} ریال). با مدیر هماهنگ کنید.`
            )
        }
        if (owed > 0 && !refundMode)
          throw new BusinessError(
            (debtCut > 0
              ? `از مابه‌التفاوت ${money(owedTotal)} ریالی این تعویض، ${money(debtCut)} ریال از بدهی فاکتور اصلی کم شد ` +
                `و ${money(owed)} ریال باقی مانده که ما به مشتری بدهکاریم.\n`
              : `در این تعویض ما ${money(owed)} ریال به مشتری بدهکار می‌شویم.\n`) +
              'باید صریح انتخاب کنید که این مبلغ چطور تسویه شود:\n' +
              '• بازپرداخت نقدی (پول از صندوق بیرون می‌رود)\n' +
              '• بازپرداخت کارتی\n' +
              '• صدور بارکد اعتبار خرید بعدی\n' +
              '• کارت‌به‌کارت توسط مدیر (پرداخت فوری انجام نمی‌شود؛ درخواست پرداخت ثبت می‌گردد)\n' +
              'این انتخاب پیش‌فرض ندارد، چون هر سه اثر مالی کاملاً متفاوتی روی صندوق دارند.'
          )

        if (owed <= 0) {
          // کل مابه‌التفاوت صرف کاهش بدهی شد؛ روش انتخابی (اگر فرستاده شده) بی‌اثر است
          settlement = ExchangeSettlement.DEBT_REDUCTION
        } else if (refundMode === 'CASH' || refundMode === 'CARD') {
          /**
           * نشست ۵۹ · خوشه B (بند ۴-۹، DECISIONS S59-4) — بازپرداخت هرگز `Payment`
           * منفی نیست. قبلاً یک پرداختی منفی روی سند تعویض ساخته می‌شد که هم
           * paidTotal سند را منفی می‌کرد (نسیه‌ی کاذب) و هم در دفتر رویداد کنار
           * ردیف تعویض دوباره از نقد کم می‌شد. حالا: اثر فقط در خودِ سند تعویض
           * (exchangeDiff + exchangeSettlement + refundMethod/refundAmount) و برای
           * نقد در `CashMovement(EXCHANGE_REFUND)` — دقیقاً یک‌بار.
           */
          await assertExchangeCashLikeRefund(tx, {
            sourceId: source.id,
            netReceived: srcDebt.netReceived,
            owed,
            backId: back.id
          })
          if (refundMode === 'CASH') {
            await recordCashMovement(tx, {
              amount: owed,
              type: CashMovementType.EXCHANGE_REFUND,
              shiftId,
              userId: input.userId ?? null,
              description: `بازپرداخت نقدی مابه‌التفاوت تعویض · سند ${faDigits(exchangeInvoice.receiptNo)}`,
              refType: 'SaleReturn',
              refId: back.id,
              occurredAt: now
            })
          }
          cashRefunded = owed
          settlement = refundMode === 'CASH' ? 'CASH_REFUND' : 'CARD_REFUND'
        } else if (refundMode === 'CARD_TO_CARD') {
          /**
           * جلسه ۱۷ · بند ۱ — هیچ `Payment` و هیچ `CashMovement` ساخته نمی‌شود.
           * پول در این لحظه جابه‌جا نشده است؛ فقط یک تعهد ثبت می‌گردد که مدیر
           * بعداً در تب «درخواست‌های کارت‌به‌کارت» تاییدش می‌کند.
           */
          await assertExchangeCashLikeRefund(tx, {
            sourceId: source.id,
            netReceived: srcDebt.netReceived,
            owed,
            backId: back.id
          })
          cardToCard = owed
          settlement = ExchangeSettlement.CARD_TO_CARD
        } else {
          /**
           * بند ۱۸ — سقف مبلغی روی صدور اعتبار. بالاتر از سقف تنظیمات، حتی اگر
           * مابه‌التفاوت کاملاً درست باشد، بدون تایید مدیر صادر نمی‌شود: مبلغ
           * بزرگ روی یک بارکدِ قابل‌انتقال، بزرگ‌ترین ریسک همین ماژول است.
           */
          if (policy.storeCreditLimit > 0 && owed > policy.storeCreditLimit) {
            // نشست ۶۳ (S63-3) — رمز قبل از تراکنش سنجیده شده؛ اینجا فقط نتیجه
            if (!exchangeManagerVerified)
              throw new BusinessError(
                `«صدور اعتبار ${money(owed)} ریالی (بالاتر از سقف ${money(policy.storeCreditLimit)} ریال)» ` +
                  'تایید مدیر لازم دارد. رمز مدیر را وارد کنید.'
              )
            await audit(tx, {
              action: AuditAction.STORE_CREDIT_OVER_LIMIT,
              entity: 'SaleReturn',
              entityId: back.id,
              userId: input.userId ?? null,
              after: JSON.stringify({ amount: owed, limit: policy.storeCreditLimit, exchangeInvoiceId: exchangeInvoice.id }),
              note: `صدور اعتبار بالاتر از سقف، با تایید مدیر · ${money(owed)} ریال (سقف ${money(policy.storeCreditLimit)})`
            })
          }
          credit = await issueStoreCredit(tx, {
            amount: owed,
            returnId: back.id,
            exchangeInvoiceId: exchangeInvoice.id,
            sourceInvoiceId: source.id,
            customerId: source.customerId ?? null,
            customerName: exchangeInvoice.customer?.name ?? null,
            /**
           * بند ۹ (جلسه ۳۰) · §۳ — مدت اعتبارِ مسیر تعویض/برگشت.
           * تا دیروز همیشه `returnCodeDays` (تنظیمات «کد برگشت») فرستاده می‌شد و
           * همین ورودی، پیش‌فرض `types.EXCHANGE.days` تنظیمات اعتبار را دور می‌زد —
           * یعنی تنظیم صریح کاربر بی‌اثر بود. `undefined` یعنی «خودت از تنظیمات بخوان».
           */
          days: exchangeCreditDays({
            explicit: input.creditDays,
            exchangeDays: (await readCreditSettings(tx)).types.EXCHANGE.days,
            returnCodeDays: defaults.returnCodeDays
          }),
            length: defaults.returnCodeLength,
            note: `مابه‌التفاوت تعویض کالا · سند تعویض ${faDigits(exchangeInvoice.receiptNo)}`,
            userId: input.userId ?? null,
            issuedAt: now
          })
          settlement = ExchangeSettlement.CREDIT
        }
      }

      /** بند ۱۸ — قیمت دستی، با قیمت واقعی و قیمت واردشده، در AuditLog */
      if (priceOverrides.length) {
        await audit(tx, {
          action: AuditAction.EXCHANGE_PRICE_OVERRIDE,
          entity: 'SaleInvoice',
          entityId: exchangeInvoice.id,
          userId: input.userId ?? null,
          before: JSON.stringify(priceOverrides.map((o) => ({ variantId: o.variantId, name: o.name, price: o.realPrice }))),
          after: JSON.stringify(priceOverrides.map((o) => ({ variantId: o.variantId, name: o.name, price: o.enteredPrice }))),
          // نشست ۱۵۸ (Y17) — حالت هر ردیف، نه «با تایید مدیر» ثابت
          note:
            'قیمت دستی کالای جایگزین: ' +
            priceOverrides
              .map(
                (o) =>
                  `${o.name}: قیمت واقعی ${money(o.realPrice)} ← واردشده ${money(o.enteredPrice)} ریال (` +
                  (o.enteredPrice > o.realPrice
                    ? 'افزایش، بدون رمز'
                    : exchangePricing?.managerApproved
                      ? 'کاهش با تایید رمز مدیر'
                      : 'کاهش، گیت خاموش') +
                  ')'
              )
              .join(' · ')
        })
      }

      const settle = await recalcSettlement(tx, exchangeInvoice.id)

      // ---------- ۶) گره‌زدن سند برگشت به سند تعویض ----------
      await tx.saleReturn.update({
        where: { id: back.id },
        data: {
          exchangeInvoiceId: exchangeInvoice.id,
          exchangeReceiptNo: exchangeInvoice.receiptNo,
          exchangeTotal,
          exchangeDiff: diff,
          exchangeSettlement: settlement,
          debtReduction: debtCut,
          storeCreditId: credit?.id ?? null,
          storeCreditCode: credit?.code ?? null,
          /**
           * بند ۱۱/۱۲ — روش بازپرداخت روی خودِ سند تعویض هم ثبت می‌شود، پس
           * `accountingReport` می‌تواند بازپرداخت نقدیِ تعویض را با یک groupBy
           * از بازپرداخت کارتی و از صدور اعتبار تفکیک کند.
           */
          ...(cardToCard > 0
            ? {
                refundMethod: RefundMethod.CARD_TO_CARD,
                refundAmount: cardToCard,
                refundNote: 'کارت‌به‌کارت توسط مدیر · در انتظار پرداخت'
              }
            : cashRefunded > 0
            ? {
                refundMethod: refundMode === 'CASH' ? RefundMethod.CASH : RefundMethod.CARD,
                refundAmount: cashRefunded,
                refundedAt: now,
                refundedAtJalali: toJalaliDate(now),
                refundedAtTime: toClock(now),
                refundNote: 'بازپرداخت مابه‌التفاوت تعویض'
              }
            : credit
              ? { refundMethod: RefundMethod.STORE_CREDIT, refundAmount: credit.amount ?? 0 }
              : { refundMethod: RefundMethod.NONE, refundAmount: 0 })
        }
      })

      /**
       * نشست ۶۰ (بند ۴-۵) — کاهش بدهی روی فاکتور اصلی همان لحظه اعمال می‌شود:
       * تسویه/اضافه‌دریافت فاکتور اصلی با فرمول واحد دوباره سنجیده و در Audit ثبت می‌شود.
       */
      let sourceSettle: any = null
      if (debtCut > 0) {
        sourceSettle = await recalcSettlement(tx, source.id)
        await audit(tx, {
          action: AuditAction.SALE_EXCHANGE,
          entity: 'SaleInvoice',
          entityId: source.id,
          userId: input.userId ?? null,
          after: JSON.stringify({ returnId: back.id, debtReduction: debtCut, remaining: sourceSettle.remaining }),
          note:
            `کاهش بدهی فاکتور ${faDigits(source.receiptNo)} به مبلغ ${money(debtCut)} ریال از مابه‌التفاوت تعویض ` +
            `(سند تعویض ${faDigits(exchangeInvoice.receiptNo)}) · هیچ پولی از صندوق خارج نشد · ` +
            `باقی‌مانده‌ی بدهی ${money(sourceSettle.remaining)} ریال`
        })
      }

      /**
       * ================== جلسه ۴۰ · کار ب — آزادسازی آگاهانه ==================
       * کالای برگشتی وقتی معلق شد که کاربر «کارت‌به‌کارت مدیر» را انتخاب کرده
       * بود. اگر مابه‌التفاوت آخر صفر یا به نفع فروشگاه درآمد، هیچ پرداخت مدیری
       * وجود ندارد و هیچ‌کس نیست که «پرداخت شد» بزند ⇒ کالا باید همین حالا و در
       * همین تراکنش آزاد شود، وگرنه برای همیشه معلق می‌ماند.
       *
       * این مسیر تأیید مدیر نمی‌خواهد و نباید بخواهد: قاعده‌ی «فقط با تأیید
       * مدیر» مخصوص حالتی است که پولی به مشتری بدهکاریم. اینجا بدهی‌ای نیست و
       * رفتار عیناً همان رفتار همیشگیِ تعویضِ بدون پرداخت مدیر است.
       */
      let releasedPending = 0
      if (back.restockPending && cardToCard <= 0) {
        const rel = await pendingRestockService.releaseReturnStock(tx, {
          returnId: back.id,
          userId: input.userId ?? null,
          reason:
            'تعویض کالا بدون پرداخت مدیر (مابه‌التفاوت به نفع مشتری نبود) ⇒ کالای برگشتی همان لحظه به انبار برگشت'
        })
        releasedPending = rel.releasedQty
      }

      /**
       * جلسه ۱۷ · بند ۱ — درخواست کارت‌به‌کارت سند تعویض، *بعد از* گره‌خوردن سند
       * برگشت به سند تعویض ساخته می‌شود تا هر دو مرجع (فاکتور اصلی و سند تعویض)
       * روی درخواست ثبت شوند.
       */
      let cardTransfer: any = null
      if (cardToCard > 0) {
        const who = input.userId
          ? await tx.user.findUnique({ where: { id: input.userId }, select: { displayName: true, username: true } })
          : null
        const shiftRow = shiftId ? await tx.shift.findUnique({ where: { id: shiftId }, select: { name: true } }) : null
        cardTransfer = await createCardTransferRequest(tx, {
          returnId: back.id,
          operationKind: 'EXCHANGE',
          amount: cardToCard,
          sourceInvoiceId: source.id,
          sourceReceiptNo: source.receiptNo,
          exchangeInvoiceId: exchangeInvoice.id,
          exchangeReceiptNo: exchangeInvoice.receiptNo,
          invoiceTotal: toNumberRial(source.grandTotal),
          returnTotal,
          items: [
            ...back.returnedLines.map((l: any) => ({
              name: `برگشتی: ${l.name ?? 'کالا'}`,
              qty: l.qty,
              unitPrice: l.unitPrice
            })),
            ...repLines.map((l) => ({ name: `جایگزین: ${l.name}`, qty: l.qty, unitPrice: l.unitPrice }))
          ],
          /**
           * جلسه ۴۰ · کار ب — متن باید همان چیزی باشد که واقعاً اتفاق افتاده:
           * کالای جایگزین **همان لحظه** از انبار کم شد (این تغییر نکرده و نباید
           * بکند)، ولی کالای برگشتی معلق است و منتظر پرداخت مدیر.
           */
          stockNote: !deductInventory
            ? 'فاکتور بدون کسر موجودی بود؛ حرکت انبار ثبت نشد'
            : back.restockPending
              ? `کالای جایگزین همان لحظه از انبار کم شد · ${pendingStockNote(back.pendingRestockQty ?? 0, faDigits)}`
              : `کالای برگشتی به انبار برگشت (${faDigits(back.restockedQty ?? 0)} عدد) و کالای جایگزین از انبار کم شد`,
          userId: input.userId ?? null,
          userName: who?.displayName ?? who?.username ?? null,
          shiftId,
          shiftName: shiftRow?.name ?? null,
          note: 'ثبت‌شده از پنل تعویض کالا'
        })
        await tx.auditLog.create({
          data: {
            action: AuditAction.CARD_TRANSFER_REQUEST,
            entity: 'CardTransferRequest',
            entityId: cardTransfer.id,
            userId: input.userId ?? null,
            after: JSON.stringify({
              returnId: back.id,
              exchangeReceiptNo: exchangeInvoice.receiptNo,
              amount: cardToCard
            }),
            note:
              `درخواست کارت‌به‌کارت ${money(cardToCard)} ریال برای مابه‌التفاوت تعویض ثبت شد ` +
              '(در انتظار پرداخت مدیر) · هیچ پولی در این لحظه جابه‌جا نشد.'
          }
        })
      }

      /**
       * -------------------------------------------------------------------
       * جلسه ۵۰ · مرحله ۱-ب — «از کدام انبار برداشته شد» قابل‌ردیابی می‌شود.
       *
       * ⚠️ رفتار برداشت **هیچ تغییری نکرد**: `coverShortage` همان‌جای قبلی
       * (بالاتر، قبل از ساخته‌شدن سند) و با همان شرط صدا زده می‌شود. اینجا فقط
       * *ثبت و نمایش* اضافه می‌شود — و عمداً همین‌جاست، چون `back.id` و
       * `exchangeInvoice` تا این لحظه ساخته شده‌اند.
       *
       * پایدارسازی بی هیچ migration: نام انبار و تعداد با یک **تگ ثابت** به
       * `SaleReturn.note` می‌رود. `exchangeList` از قبل `note` هر ردیف را در
       * گزارش تعویض برمی‌گرداند، پس ستون گزارش بی ستون تازه‌ای در دیتابیس
       * داده‌دار می‌شود و اگر بعداً بین انبار مرکزی و فروشگاه مغایرتی دیده شد،
       * همین ردیف می‌گوید چه مقدار، از کدام انبار، روی کدام سند جابه‌جا شده.
       * -------------------------------------------------------------------
       */
      const centralGroups = centralWithdrawGroups(central.taken)
      const centralSentence = centralWithdrawSentence(centralGroups, faDigits)
      if (centralGroups.length) {
        await tx.saleReturn.update({
          where: { id: back.id },
          data: { note: buildCentralWithdrawNote(returnNote, centralGroups, faDigits) }
        })
      }

      await audit(tx, {
        action: AuditAction.SALE_EXCHANGE,
        entity: 'SaleReturn',
        entityId: back.id,
        userId: input.userId ?? null,
        after: JSON.stringify({
          sourceReceiptNo: source.receiptNo,
          exchangeReceiptNo: exchangeInvoice.receiptNo,
          returnTotal,
          exchangeTotal,
          diff,
          settlement,
          storeCreditId: credit?.id ?? null,
          returnedItems: back.returnedLines.map((i: any) => ({ variantId: i.variantId, qty: i.qty })),
          replacementItems: repLines.map((l) => ({ variantId: l.variantId, qty: l.qty, unitPrice: l.unitPrice })),
          /** جلسه ۵۰ · مرحله ۱-ب — برداشت از انبار مرکزی، به تفکیک انبار */
          centralWithdrawals: centralGroups,
          centralWithdrawnQty: centralWithdrawTotal(centralGroups)
        }),
        note:
          `تعویض کالا روی فاکتور ${faDigits(source.receiptNo)} · سند تعویض ${faDigits(exchangeInvoice.receiptNo)} · ` +
          `کالای برگشتی ${money(returnTotal)} ریال، کالای جایگزین ${money(exchangeTotal)} ریال · ` +
          (diff > 0
            ? `${money(diff)} ریال از مشتری دریافت شد`
            : diff < 0
              ? (debtCut > 0 ? `${money(debtCut)} ریال از بدهی فاکتور اصلی کم شد` : '') +
                (debtCut > 0 && -diff - debtCut > 0 ? ' و ' : '') +
                (-diff - debtCut > 0
                  ? credit
                    ? `${money(-diff - debtCut)} ریال اعتبار #${credit.id} صادر شد`
                    : cardToCard > 0
                      ? `${money(cardToCard)} ریال کارت‌به‌کارت مدیر (در انتظار)`
                      : `${money(cashRefunded)} ریال ${refundMode === 'CARD' ? 'به کارت مشتری' : 'نقد از صندوق'} برگشت`
                  : '')
              : 'مابه‌التفاوت صفر بود') +
          (stockWarnings.length ? ' · با کمبود موجودی کالای جایگزین' : '') +
          // جلسه ۵۰ · مرحله ۱-ب — همان جمله‌ای که پنل و گزارش نشان می‌دهند
          (centralSentence ? ` · ${centralSentence}` : '')
      })

      return {
        returnId: back.id,
        invoiceId: source.id,
        receiptNo: source.receiptNo,
        exchangeInvoiceId: exchangeInvoice.id,
        exchangeReceiptNo: exchangeInvoice.receiptNo,
        exchangeReturnCode: exchangeInvoice.returnCode ?? null,
        returnTotal,
        exchangeTotal,
        diff,
        settlement,
        settlementLabel: EXCHANGE_SETTLEMENT_LABELS[settlement] ?? settlement,
        /** کد در نتیجهٔ عادی تعویض نیست؛ فقط مرجع امن برای ردیابی برمی‌گردد. */
        storeCredit: credit ? shapeStoreCreditSafe(credit) : null,
        restockedQty: back.restockedQty ?? 0,
        /** ---- جلسه ۴۰ · کار ب ---- */
        restockPending: back.restockPending === true && releasedPending === 0,
        pendingRestockQty: releasedPending > 0 ? 0 : (back.pendingRestockQty ?? 0),
        stockWarnings,
        /**
         * ---- جلسه ۵۰ · مرحله ۱-ب ----
         * تا این نسخه نتیجه‌ی تعویض **هیچ‌وقت** `central` را برنمی‌گرداند
         * (برخلاف `create` که از قبل همین دو فیلد را دارد)، پس پنل نمی‌توانست
         * بگوید کالای جایگزین از کجا آمده. حالا می‌تواند.
         */
        centralWithdrawals: central.taken,
        centralWithdrawnQty: central.totalTaken,
        /** جمع برداشت به تفکیک انبار + جمله‌ی آماده‌ی نمایش (همان متن سابقه) */
        centralWithdrawSources: centralGroups,
        centralWithdrawText: centralSentence,
        dateJalali: toJalaliDate(now),
        time: toClock(now),
        // اضافه‌های کمکی برای پنل (خارج از قرارداد تایپ، ولی بی‌ضرر)
        cashReceived,
        /** نشست ۱۸۲ · بند ۴-۴۹ — مابه‌التفاوتی که با کارت‌خوان گرفته شد (پول هست، کشو نیست) */
        cardReceived,
        /** بند ۱۲ — مبلغی که به مشتری برگشت (نقدی یا کارتی) */
        cashRefunded,
        /** جلسه ۱۷ · بند ۱ — تعهد کارت‌به‌کارت و شناسه‌ی درخواست ساخته‌شده */
        cardToCard,
        cardTransfer,
        refundMode: refundMode ?? null,
        exchangeCreditApplied,
        /** نشست ۶۰ (بند ۴-۵) — کاهش بدهی فاکتور اصلی و باقی‌مانده‌ی جدیدش */
        debtReduction: debtCut,
        sourceRemaining: sourceSettle ? sourceSettle.remaining : null,
        paidTotal: settle.paidTotal,
        settled: settle.settled
      } as ExchangeSaleResult
    }, TX_OPTIONS)
  },

  /**
   * تب «تعویض کالا»ی گزارشات فروش — جزئیات کامل و *دقیق به ثانیه*.
   *
   * هر ردیف همه‌ی چیزی را دارد که مدیر برای کنترل یک تعویض لازم دارد: لحظه‌ی
   * ثبت (تاریخ شمسی + ساعت با ثانیه)، کالای برگشتی، کالای جایگزین،
   * مابه‌التفاوت، و این‌که مابه‌التفاوت *چطور* تسویه شد (نقد دریافت شد، یا بارکد
   * اعتبار صادر گردید و وضعیت فعلی همان بارکد چیست).
   */
  async exchangeList(
    filter: {
      fromJalali?: string
      toJalali?: string
      take?: number
      skip?: number
      channels?: string[] | null
      receiptNo?: number | null
      customerSearch?: string | null
      productSearch?: string | null
      orderType?: string | null
      userId?: number | null
      /** ممیزی A99-03 — «وضعیت» نوار = وضعیت فاکتور مرجع؛ شماره‌ی نشست روی سند تعویض */
      status?: string | null
      shiftNumber?: number | string | null
      /**
       * مورد ۵ — قفل کردن گزارش روی *یک شیفت مشخص* (جزئیات یک شیفت بسته‌شده).
       * ممیزی A99-03: بدون تاریخ صریح = کل نشست؛ با تاریخ صریح هر دو قید (هم‌معنای پل). نبودنش = مو‌به‌مو همان رفتار قبلی (فیلتر بازه‌ی تاریخ).
       */
      shiftId?: number | null
      /**
       * نشست ۱۱۷ (S117-3) — فقط همین یک سند تعویض (مسیر داخلی `exchangeGet`).
       * قبلاً کل روز با `take: 2000` خوانده و در حافظه جستجو می‌شد.
       */
      returnId?: number | null
    } = {}
  ): Promise<ExchangeReportResult> {
    const onlyReturnId = Number(filter.returnId ?? 0) > 0 ? Math.round(Number(filter.returnId)) : null
    // ممیزی A99-03 — دامنه‌ی مشترک با تب برگشت، شمارنده‌ی سقف و پل تطبیق
    const where: Prisma.SaleReturnWhereInput = {
      ...(await returnReportScopeWhere(filter)),
      kind: ReturnKind.EXCHANGE,
      ...(onlyReturnId ? { id: onlyReturnId } : {})
    }
    const totalCount = await prisma.saleReturn.count({ where })
    const page = reportPage(filter.take, filter.skip, 1000, totalCount)
    const loadReturns = (skip: number, take: number) =>
      prisma.saleReturn.findMany({
      where,
      include: {
        items: true,
        invoice: {
          select: {
            id: true,
            receiptNo: true,
            returnCode: true,
            issuedAtJalali: true,
            customer: { select: { name: true } }
          }
        }
      },
      orderBy: { id: 'desc' },
      skip,
      take
    })

    type ExchangeReturnRecord = Awaited<ReturnType<typeof loadReturns>>[number]
    const shapeRows = async (returns: ExchangeReturnRecord[]): Promise<ExchangeReportRow[]> => {
      const exchangeIds = returns.map((r) => r.exchangeInvoiceId).filter((n): n is number => !!n)
      /**
       * نشست ۱۸۰ (S180-D8، گام ۰ خوشه M) — این آرایه `any[]` بود، پس `exMap`
       * هم `any` می‌داد و همه‌ی `reduce`/`map`های پایین‌دست زیر `noImplicitAny`
       * خطای TS7006 می‌گرفتند (پارامترهای `it`/`s`/`p`). تایپ دقیقاً از همان
       * `include` کوئری زیر ساخته شده؛ هیچ تغییر زمان‌اجرا.
       */
      type ExchangeInvoiceRecord = Prisma.SaleInvoiceGetPayload<{
        include: {
          items: true
          user: true
          shift: true
          payments: { include: { method: true } }
        }
      }>
      const exchangeInvoices: ExchangeInvoiceRecord[] = []
      for (const ids of reportIdChunks(exchangeIds)) {
        exchangeInvoices.push(
          ...(await prisma.saleInvoice.findMany({
            where: { id: { in: ids } },
            include: { items: true, user: true, shift: true, payments: { where: { voidedAt: null }, include: { method: true } } }
          }))
        )
      }
      const exMap = new Map(exchangeInvoices.map((i) => [i.id, i]))

      const credits: any[] = []
      for (const ids of reportIdChunks(returns.map((r) => r.id))) {
        credits.push(...(await prisma.storeCredit.findMany({ where: { returnId: { in: ids } } })))
      }
      const creditMap = new Map(credits.map((c) => [c.returnId ?? 0, c]))

      // نام کالاها یک‌جا (بدون include تودرتو، تا کالای حذف‌شده گزارش را نخواباند)
      const variantIds = [
        ...new Set([
          ...returns.flatMap((r) => r.items.map((i) => i.variantId)),
          ...exchangeInvoices.flatMap((i) => i.items.map((it) => it.variantId))
        ])
      ]
      const variants: any[] = []
      for (const ids of reportIdChunks(variantIds)) {
        variants.push(
          ...(await prisma.productVariant.findMany({
            where: { id: { in: ids } },
            select: {
              id: true,
              code: true,
              size: true,
              color: true,
              product: { select: { name: true, reportLiveName: true } }
            }
          }))
        )
      }
      const vmap = new Map(variants.map((v) => [v.id, v]))
      const titleOf = (variantId: number, snapName?: string | null) =>
        reportLineTitle({ variantName: snapName }, vmap.get(variantId))

      const rows: ExchangeReportRow[] = returns.map((r) => {
        const ex = r.exchangeInvoiceId ? exMap.get(r.exchangeInvoiceId) : null
        const credit = creditMap.get(r.id) ?? null
        const returnedAt = r.returnedAt instanceof Date ? r.returnedAt : new Date(r.returnedAt)
        /**
         * «نقد دریافتی» فقط پرداختی‌های *واقعی* سند تعویض است: ردیف‌های
         * EXCHANGE_CREDIT و STORE_CREDIT عمداً بیرون می‌مانند، وگرنه مابه‌التفاوتی
         * که هیچ‌وقت دریافت نشده، در گزارش «دریافتی» دیده می‌شد.
         */
        /**
         * گزارش تعویض نباید دریافت کارت را «نقد» بنامد. همان destination ذخیره‌شده
         * روی Payment منبع حقیقت است؛ EXCHANGE_CREDIT/STORE_CREDIT و چکِ پاس‌نشده
         * اساساً پول دریافتی نیستند.
         */
        const received = (ex?.payments ?? []).reduce(
          (sum, p) => {
            const kind = p.method?.kind ?? ''
            if (kind === PaymentKind.EXCHANGE_CREDIT || kind === PaymentKind.STORE_CREDIT) return sum
            if ((p.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE && p.chequeStatus !== ChequeStatus.CLEARED)
              return sum
            const amount = toNumberRial(p.amount)
            if (p.destination === PaymentDestination.CARD) sum.card += amount
            else sum.cash += amount
            return sum
          },
          { cash: 0, card: 0 }
        )
        const settlement = r.exchangeSettlement ?? ExchangeSettlement.NONE
        const creditRow = credit ? shapeStoreCredit(credit) : null
        return {
          returnId: r.id,
          invoiceId: r.invoiceId,
          receiptNo: r.invoice?.receiptNo ?? 0,
          invoiceDateJalali: r.invoice?.issuedAtJalali ?? '—',
          returnCode: r.invoice?.returnCode ?? null,
          customerName: r.invoice?.customer?.name ?? 'مشتری عمومی',
          dateJalali: r.returnedAtJalali,
          // «دقیق به ثانیه»: ستون ذخیره‌شده، و برای برگشت‌های قدیمی از خود لحظه
          time: r.returnedAtTime || toClock(returnedAt),
          shiftName: ex?.shift?.name ?? 'بدون شیفت',
          userName: ex?.user?.displayName ?? 'مدیر',
          returnedItems: r.items.map((i) => ({
            name: titleOf(i.variantId, i.variantName),
            code: i.variantCode ?? vmap.get(i.variantId)?.code ?? '—',
            qty: i.qty,
            unitPrice: toNumberRial(i.unitPrice),
            lineTotal: toNumberRial(i.lineTotal)
          })),
          returnTotal: toNumberRial(r.total),
          replacementItems: (ex?.items ?? []).map((it) => ({
            name: titleOf(it.variantId, it.variantName),
            code: it.variantCode ?? vmap.get(it.variantId)?.code ?? '—',
            qty: it.qty,
            unitPrice: toNumberRial(it.unitPrice),
            lineTotal: toNumberRial(it.lineTotal)
          })),
          exchangeTotal: toNumberRial(r.exchangeTotal ?? ex?.grandTotal ?? 0),
          exchangeInvoiceId: r.exchangeInvoiceId ?? null,
          exchangeReceiptNo: r.exchangeReceiptNo ?? ex?.receiptNo ?? null,
          diff: toNumberRial(r.exchangeDiff ?? 0),
          settlement,
          settlementLabel: EXCHANGE_SETTLEMENT_LABELS[settlement] ?? settlement,
          cashReceived: received.cash,
          cardReceived: received.card,
          /** کد قابل‌مصرف فقط برای چاپ/مسیر مجوزدار است؛ گزارش شناسهٔ امن دارد. */
          storeCreditReference: creditRow || r.storeCreditId ? `اعتبار #${creditRow?.id ?? r.storeCreditId}` : null,
          storeCreditAmount: creditRow?.amount ?? 0,
          storeCreditStatus: creditRow?.status ?? null,
          storeCreditStatusLabel: creditRow?.statusLabel ?? null,
          note: r.note ?? ''
        }
      })
      return rows
    }
    const totalsOf = (rows: ExchangeReportRow[]) => ({
      count: rows.length,
      returnTotal: rows.reduce((s, r) => s + r.returnTotal, 0),
      exchangeTotal: rows.reduce((s, r) => s + r.exchangeTotal, 0),
      diffTotal: rows.reduce((s, r) => s + r.diff, 0),
      cashReceivedTotal: rows.reduce((s, r) => s + r.cashReceived, 0),
      cardReceivedTotal: rows.reduce((s, r) => s + r.cardReceived, 0),
      creditIssuedTotal: rows.reduce((s, r) => s + r.storeCreditAmount, 0),
      creditUsedTotal: rows.reduce(
        (s, r) => s + (r.storeCreditStatus === StoreCreditStatus.USED ? r.storeCreditAmount : 0),
        0
      )
    })

    const rows = await shapeRows(await loadReturns(page.skip, page.take))
    /**
     * ممیزی A99-01 — reportPage پیش از خواندن ردیف‌ها truncated را `totalCount > skip` می‌گذارد؛
     * بدون بازمحاسبه هر صفحه‌ی غیرخالی «بریده» بود ⇒ هشدار کاذب «فقط صفحه‌ی جاری؛ نمایش ۲ از ۲»
     * روی چاپ/Excel صفحه (همان قاعده‌ی attachReportPage).
     */
    page.truncated = page.totalCount > page.skip + rows.length
    /**
     * ممیزی A99-01 — جمع‌های نوار تب تعویض (تعداد، برگشتی، جایگزین، مابه‌التفاوت، نقد، اعتبار) روی
     * صفحه به‌عنوان جمع بازه نمایش داده می‌شوند؛ پس وقتی صفحه کل مجموعه نیست، روی کل مجموعه‌ی
     * همان where (دسته‌به‌دسته، همان محاسبه‌ی ردیف) حساب می‌شوند، نه فقط ردیف‌های این صفحه.
     */
    let totals = totalsOf(rows)
    if (rows.length < totalCount) {
      const sum = { ...totalsOf([]) }
      for (let skip = 0; skip < totalCount; skip += EXCHANGE_TOTALS_BATCH) {
        const batch = await shapeRows(await loadReturns(skip, EXCHANGE_TOTALS_BATCH))
        if (!batch.length) break
        const t = totalsOf(batch)
        for (const key of Object.keys(sum) as (keyof typeof sum)[]) sum[key] += t[key]
      }
      totals = sum
    }
    return { rows, totals, page, warnings: pageWarning(page, rows.length) }
  },

  /** یک تعویض ثبت‌شده با همه‌ی جزئیاتش (برای چاپ دوباره یا نمایش ریز). */
  async exchangeGet(input: { id?: number } = {}): Promise<ExchangeReportRow> {
    const id = Number(input?.id ?? 0)
    if (!id) throw new BusinessError('سند تعویضی مشخص نشده است.')
    const ret = await prisma.saleReturn.findUnique({ where: { id }, select: { returnedAtJalali: true, kind: true, voidedAt: true } })
    if (!ret || ret.kind !== ReturnKind.EXCHANGE || ret.voidedAt != null)
      throw new BusinessError('این سند، تعویض کالا نیست یا حذف شده است.')
    const res = await this.exchangeList({
      fromJalali: ret.returnedAtJalali,
      toJalali: ret.returnedAtJalali,
      returnId: id,
      take: 1
    })
    const row = res.rows.find((r) => r.returnId === id)
    if (!row) throw new BusinessError('جزئیات این تعویض پیدا نشد؛ فهرست را تازه کنید.')
    return row
  },

  // =========================================================================
  // تب «نسیه» گزارشات فروش (بخش ۷)
  // =========================================================================

  /**
   * -------------------------------------------------------------------------
   * فهرست فاکتورهای نسیه (تسویه‌نشده / جزئی) از **هر دو منبع** — پنل فروش تکی و
   * فاکتور فروش عمده — به‌علاوه‌ی «تسویه‌ی نسیه‌ی بازه‌های قبل».
   *
   * آن بخش دوم (`priorSettlements`) مهم‌ترین عدد این تب است و یک سوال واقعی
   * حسابداری را جواب می‌دهد: «چرا پول کارتخوان این ماه از فروش ثبت‌شده‌ی این ماه
   * بیشتر است؟» — چون بخشی از آن، تسویه‌ی نسیه‌ی ماه‌های قبل است. اینجا مو‌به‌مو
   * فهرست می‌شود (کدام فاکتور، از کدام ماه، چه مبلغ، چه روزی).
   * -------------------------------------------------------------------------
   */
  async creditList(
    filter: {
      fromJalali?: string
      toJalali?: string
      /** فاکتورهای تسویه‌شده‌ی همین بازه هم نمایش داده شوند؟ (پیش‌فرض: نه) */
      includeSettled?: boolean
      orderType?: string
      customerSearch?: string
      receiptNo?: number | null
      productSearch?: string | null
      userId?: number | null
      shiftId?: number | null
      take?: number
      /** نشست ۱۱۷ — صفحه‌بندی واقعی ردیف‌های نمایشی (جمع‌ها همیشه روی کل بازه) */
      skip?: number
      /** صفحه‌بندی مستقل وصول نسیه‌ی دوره‌های قبل برای خروجی کامل */
      priorSkip?: number
      priorTake?: number
      /** بند ۶ — کانال فروش (تکی / عمده) */
      channels?: string[] | null
      /** ممیزی A117-01 — «وضعیت» نوار (وضعیت فاکتور) و شماره‌ی نشست */
      status?: string | null
      shiftNumber?: number | string | null
    } = {}
  ): Promise<CreditReportResult> {
    const invoiceFilter = reportInvoiceRelationWhere(filter)
    /**
     * ممیزی A117-01 (AUDIT-D49) — دامنه‌ی تب نسیه هم‌معنای گزارش/پل تطبیق (AUDIT-D22/D28):
     *   • تاریخ صریح ⇒ همان بازه (با shiftId هر دو قید)؛ '' ⇒ پیش‌فرض؛ نامعتبر ⇒ خطای فارسی.
     *   • فقط shiftId ⇒ کل نشست (openedAt..closedAt یا الان، همان resolveReportPeriod): فاکتورهای نشست بی‌قید
     *     تاریخ صدور و «وصول دوره‌ی قبل» = پرداخت داخل پنجره‌ی نشست روی فاکتورِ قبل از openedAt.
     *   • هیچ‌کدام ⇒ امروز.
     * قبلاً '' ⇒ سال −۱۰۰۱۰۰ (تب خالی بی‌صدا) و فقط shiftId ⇒ فقط امروز (فاکتور قبل از نیمه‌شب شیفت شب غایب،
     * وصول همان فاکتور «دوره‌ی قبل» ⇒ تب ≠ پل).
     */
    const fromInput = reportDayInput(filter.fromJalali, 'از تاریخ', 'تب نسیه')
    const toInput = reportDayInput(filter.toJalali, 'تا تاریخ', 'تب نسیه')
    let from: Date
    let to: Date
    let byShiftOnly = false
    if (fromInput || toInput) {
      from = jalaliStartOfDay((fromInput ?? toInput)!)
      to = jalaliEndOfDay((toInput ?? fromInput)!)
    } else {
      const shift =
        filter.shiftId != null
          ? await prisma.shift.findUnique({ where: { id: Number(filter.shiftId) }, select: { openedAt: true, closedAt: true } })
          : null
      if (shift?.openedAt) {
        byShiftOnly = true
        from = shift.openedAt instanceof Date ? shift.openedAt : new Date(shift.openedAt as any)
        to = shift.closedAt ? (shift.closedAt instanceof Date ? shift.closedAt : new Date(shift.closedAt as any)) : new Date()
      } else {
        from = jalaliStartOfDay(jalaliToday())
        to = jalaliEndOfDay(jalaliToday())
      }
    }
    const creditShiftNumber = reportShiftNumber(filter)
    const creditInvoiceStatus = reportEventInvoiceStatusWhere(filter.status)
    /**
     * نشست ۱۱۷ (S117-2) — قبلاً `take: filter.take ?? 3000` بی‌صدا فاکتورها را
     * می‌بُرید و جمع بدهی/دریافتی از همان ردیف‌های بریده ساخته می‌شد. حالا کل
     * بازه در دسته‌های ثابت خوانده می‌شود؛ جمع‌ها روی کل مجموعه‌اند و فقط
     * ردیف‌های *نمایشی* صفحه‌بندی واقعی (skip/take، سقف ۵٬۰۰۰) با هشدار دارند.
     */
    const pageSkip = Math.max(0, Math.round(Number(filter.skip ?? 0) || 0))
    const pageTake = Math.min(
      CREDIT_PAGE_MAX,
      Math.max(1, Math.round(Number(filter.take ?? CREDIT_PAGE_MAX) || CREDIT_PAGE_MAX))
    )
    /** نشست ۱۸۰ (S180-D8) — همان الگو: `any[]` باعث TS7006 روی reduceهای پایین‌دست می‌شد. */
    type CreditInvoiceRecord = Prisma.SaleInvoiceGetPayload<{
      include: {
        customer: true
        user: true
        shift: true
        payments: { include: { method: true } }
      }
    }>
    const invoices: CreditInvoiceRecord[] = []
    for (let batchSkip = 0; ; batchSkip += CREDIT_READ_BATCH) {
      const batch = await prisma.saleInvoice.findMany({
      where: {
        // ممیزی A117-01 — فقط shiftId: کل نشست (shiftId خودش قید است)، بدون قید تاریخ صدور
        ...(byShiftOnly ? {} : { issuedAt: { gte: from, lte: to } }),
        // بند ۶ — «نوع سفارش» انتخابی کاربر و کانال تکی/عمده با هم ضرب می‌شوند
        orderType: orderTypeWhere({ orderType: filter.orderType ?? null, channels: filter.channels ?? null }),
        ...invoiceFilter,
        // ممیزی A117-01 — شماره‌ی نشست روی فاکتور (همان saleWhere) و «وضعیت» نوار با دروازه‌ی DRAFT/CANCELED
        ...(creditShiftNumber != null ? { shift: { number: creditShiftNumber } } : {}),
        status: creditInvoiceStatus
      },
      include: {
        customer: true,
        user: true,
        shift: true,
        payments: { where: { voidedAt: null }, include: { method: true }, orderBy: [{ seq: 'asc' }, { id: 'asc' }] }
      },
      orderBy: [{ issuedAt: 'asc' }, { receiptNo: 'asc' }, { id: 'asc' }],
      skip: batchSkip,
      take: CREDIT_READ_BATCH
    })
      invoices.push(...batch)
      if (batch.length < CREDIT_READ_BATCH) break
    }

    const rows: CreditInvoiceRow[] = []
    // نشست ۵۸ · C2 — بدهی واحد: برگشت و بازپرداخت همه‌ی فاکتورهای فهرست یک‌جا
    const debtAdj = await debtAdjustmentsByInvoice(prisma, invoices.map((i) => i.id))
    for (const inv of invoices) {
      const grandTotal = toNumberRial(inv.grandTotal) // نشست ۱۸۱: BigInt ⇒ number
      const paidTotal = receivedTotalOf(inv.payments as any[])
      const debt = remainingOf({ grandTotal, received: paidTotal, ...adjustmentsOrEmpty(debtAdj, inv.id) })
      const remaining = debt.remaining
      const state = debt.state
      const settled = state === 'SETTLED'
      // پیش‌فرض تب «نسیه» = فقط بدهکارها؛ فاکتور بی‌مبلغ هیچ‌وقت «نسیه» نیست
      if (settled && filter.includeSettled !== true) continue
      const issuedAt = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
      /**
       * نشست ۲۰۷ — «آخرین پرداختی» فقط پولِ *دریافت‌شده* است.
       * چکِ در جریان remaining را کم نمی‌کند؛ نشان‌دادنش به‌جای نقدِ واقعی
       * مدیر را گمراه می‌کرد (بند ۴-۱۹ / L2).
       */
      const receivedPays = (inv.payments as any[]).filter((p) => isReceivedPayment(p))
      const last = receivedPays.length
        ? receivedPays.reduce((a: any, b: any) => {
            const ta = new Date(a.paidAt ?? 0).getTime()
            const tb = new Date(b.paidAt ?? 0).getTime()
            return tb >= ta ? b : a
          })
        : null
      const lastCreatedJalali = last?.createdAt
        ? toJalaliDate(last.createdAt instanceof Date ? last.createdAt : new Date(last.createdAt))
        : null
      rows.push({
        id: inv.id,
        receiptNo: inv.receiptNo,
        dateJalali: inv.issuedAtJalali || toJalaliDate(issuedAt),
        time: toClock(issuedAt),
        orderTypeLabel: ORDER_TYPE_LABELS[inv.orderType] ?? inv.orderType,
        customerName: inv.customer?.name ?? 'مشتری عمومی',
        customerPhone: inv.customer?.phone ?? null,
        grandTotal,
        paidTotal,
        remaining,
        settlementState: state,
        settlementLabel: SETTLEMENT_STATE_LABELS[state],
        settled,
        settledAtJalali: inv.settledAtJalali ?? null,
        pendingChequeTotal: pendingChequeTotalOf(inv.payments as any[]),
        paymentCount: inv.payments.length,
        lastPaymentJalali: last?.paidAtJalali ?? null,
        lastPaymentTime: last?.paidAtTime ?? null,
        lastPaymentBackdated: !!(last?.paidAtJalali && lastCreatedJalali && last.paidAtJalali < lastCreatedJalali),
        overpayTotal: inv.payments.reduce((s, p) => s + Math.max(0, toNumberRial(p.overpayAmount ?? 0)), 0),
        ageDays: Math.max(0, Math.round((Date.now() - issuedAt.getTime()) / DAY_MS)),
        shiftName: inv.shift?.name ?? 'بدون شیفت',
        userName: inv.user?.displayName ?? 'مدیر'
      })
    }

    /**
     * «تسویه‌ی نسیه‌ی ماه قبل»: پرداختی‌هایی که *داخل این بازه* دریافت شده‌اند
     * ولی فاکتورشان از *قبلِ* بازه است. چکِ پاس‌نشده شمرده نمی‌شود (پول واقعی
     * نیست) و مصرف بارکد اعتبار هم شمرده نمی‌شود (پول نقد نیست).
     */
    // نشست ۱۱۷ (S117-2) — قبلاً `take: 2000` بی‌صدا؛ حالا کل بازه در دسته‌های ثابت
    const priorPayments: any[] = []
    const priorShiftIds = await resolveReportEventShiftIds(filter as SaleReportFilter)
    for (let batchSkip = 0; ; batchSkip += CREDIT_READ_BATCH) {
      const batch = await prisma.payment.findMany({
      // ممیزی A88-03 — وصول باطل‌شده در فهرست وصول نسیه‌ی دوره‌ی قبل نمی‌آید
      /**
       * ممیزی A91-02 — این بخش هیچ فیلتری جز تاریخ نداشت؛ با فیلتر شیفت/کارمند/فیش/مشتری/
       * کالا/کانال، وصول بقیه هم در تب نسیه می‌نشست و با پل تطبیق نمی‌خواند. مالک = ثبت‌کننده
       * و شیفتِ لحظه‌ی دریافت (بند ۴-۲ و ۴-۵۳، همان paymentEventOwnerWhere)، هویت روی فاکتور.
       */
      where: {
        paidAt: { gte: from, lte: to },
        voidedAt: null,
        ...paymentEventOwnerWhere(filter as SaleReportFilter, 'created', priorShiftIds),
        invoice: {
          ...reportInvoiceIdentityWhere(filter),
          // ممیزی A117-01 — «وضعیت» نوار روی فاکتور مرجع وصول (هم‌معنای پل تطبیق)
          status: creditInvoiceStatus,
          orderType: orderTypeWhere({ orderType: filter.orderType ?? null, channels: filter.channels ?? null }),
          issuedAt: { lt: from }
        }
      },
      include: {
        method: true,
        invoice: {
          select: {
            id: true,
            receiptNo: true,
            issuedAtJalali: true,
            grandTotal: true,
            paidTotal: true,
            settledAtJalali: true,
            customer: { select: { name: true } }
          }
        }
      },
      orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
      skip: batchSkip,
      take: CREDIT_READ_BATCH
    })
      priorPayments.push(...batch)
      if (batch.length < CREDIT_READ_BATCH) break
    }

    const priorSettlements: CreditSettlementRow[] = priorPayments
      .filter((p) => isReceivedPayment(p) && (p.method?.kind ?? '') !== PaymentKind.STORE_CREDIT)
      .map((p) => {
        const paidAt = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)
        const invoiceDay = p.invoice?.issuedAtJalali ?? '—'
        // «۱۴۰۵/۰۴» یعنی ماه فاکتور؛ برای گزارش ماهانه خواناترین برچسب است
        const month = invoiceDay.slice(0, 7)
        return {
          paymentId: p.id,
          invoiceId: p.invoiceId,
          receiptNo: p.invoice?.receiptNo ?? 0,
          customerName: p.invoice?.customer?.name ?? 'مشتری عمومی',
          paidAtJalali: p.paidAtJalali || toJalaliDate(paidAt),
          paidAtTime: p.paidAtTime || toClock(paidAt),
          amount: toNumberRial(p.amount),
          methodLabel: p.method?.label ?? 'پرداخت',
          kind: (p.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE ? 'CHEQUE' : 'CASH',
          invoiceDateJalali: invoiceDay,
          label: `تسویه‌ی نسیه‌ی ${faDigits(month)}`,
          settledInvoice: toNumberRial(p.invoice?.paidTotal ?? 0) >= toNumberRial(p.invoice?.grandTotal ?? 0),
          overpayAmount: Math.max(0, toNumberRial(p.overpayAmount ?? 0))
        }
      })

    const page: SaleReportPage = {
      skip: pageSkip,
      take: pageTake,
      totalCount: rows.length,
      truncated: pageSkip > 0 || rows.length > pageSkip + pageTake
    }
    const priorSkip = Math.max(0, Math.round(Number(filter.priorSkip ?? 0) || 0))
    const priorTake = Math.min(
      CREDIT_PAGE_MAX,
      Math.max(1, Math.round(Number(filter.priorTake ?? CREDIT_PAGE_MAX) || CREDIT_PAGE_MAX))
    )
    const priorPage: SaleReportPage = {
      skip: priorSkip,
      take: priorTake,
      totalCount: priorSettlements.length,
      truncated: priorSettlements.length > priorSkip + priorTake
    }
    const warnings: string[] = []
    if (page.truncated)
      warnings.push(
        `«نسیه»: نمایش ردیف ${faDigits(Math.min(rows.length, pageSkip + 1))} تا ${faDigits(
          Math.min(rows.length, pageSkip + pageTake)
        )} از ${faDigits(rows.length)} فاکتور؛ جمع‌های بدهی و دریافتی روی کل بازه حساب شده‌اند. برای دیدن بقیه صفحه‌ی بعد را بگیرید.`
      )
    if (priorPage.truncated)
      warnings.push(
        `«وصول نسیه‌ی دوره‌ی قبل»: نمایش ${faDigits(Math.min(priorSettlements.length, priorSkip + priorTake) - priorSkip)} از ${faDigits(
          priorSettlements.length
        )} پرداختی؛ جمع ${faDigits(priorSettlements.reduce((s, r) => s + r.amount, 0))} ریال روی کل بازه است. برای دیدن صفحه‌ی بعد اقدام کنید.`
      )

    return {
      rows: rows.slice(pageSkip, pageSkip + pageTake),
      priorSettlements: priorSettlements.slice(priorSkip, priorSkip + priorTake),
      page,
      priorPage,
      warnings,
      totals: {
        count: rows.length,
        grandTotal: rows.reduce((s, r) => s + r.grandTotal, 0),
        paidTotal: rows.reduce((s, r) => s + r.paidTotal, 0),
        remainingTotal: rows.reduce((s, r) => s + r.remaining, 0),
        unpaidCount: rows.filter((r) => r.settlementState === 'UNPAID').length,
        partialCount: rows.filter((r) => r.settlementState === 'PARTIAL').length,
        settledCount: rows.filter((r) => r.settled).length,
        pendingChequeTotal: rows.reduce((s, r) => s + r.pendingChequeTotal, 0),
        overpayTotal: rows.reduce((s, r) => s + r.overpayTotal, 0),
        priorSettlementTotal: priorSettlements.reduce((s, r) => s + r.amount, 0),
        priorSettlementCount: priorSettlements.length
      }
    }
  },

  /** فهرست برگشت‌های ثبت‌شده در یک بازه (تب «برگشت از فروش» گزارشات). */
  /**
   * -------------------------------------------------------------------------
   * تب «برگشت از فروش» — بند ۱۰ و ۱۱ سند مرجع.
   *
   * ================== دو چیزی که عوض شد ==================
   * ۱) **فیلتر `kind`.** تا امروز این فهرست `kind` نداشت، پس تب «برگشت از فروش»
   *    تعویض‌ها را هم نشان می‌داد و عددهایش با تب «تعویض کالا» هم‌پوشانی داشت.
   *    حالا پیش‌فرض فقط `kind = RETURN` است؛ تعویض‌ها فقط با تیک صریح
   *    `includeExchanges` (پیش‌فرضِ **خاموش**) دیده می‌شوند.
   * ۲) **ستون‌های بازپرداخت.** نحوه‌ی تسویه، مبلغِ نقدیِ واقعاً برگشت‌داده‌شده،
   *    فروشنده‌ی فاکتور اصلی و کاربر ثبت‌کننده‌ی برگشت. تا امروز هیچ‌کدام در این
   *    فهرست نبودند، پس «چه کسی فروخت و چه کسی برگرداند» قابل بررسی نبود.
   * -------------------------------------------------------------------------
   */
  async returnList(
    filter: {
      fromJalali?: string
      toJalali?: string
      take?: number
      skip?: number
      channels?: string[] | null
      receiptNo?: number | null
      customerSearch?: string | null
      productSearch?: string | null
      orderType?: string | null
      /** مورد ۵ — همان قاعده‌ی `exchangeList`: قفل روی یک شیفت مشخص. */
      shiftId?: number | null
      /** بند ۱۰ — تعویض‌ها هم نشان داده شوند؟ پیش‌فرض: خیر */
      includeExchanges?: boolean
      /** فقط همین نوع؛ خالی = طبق `includeExchanges` */
      kind?: string | null
      userId?: number | null
      /** ممیزی A99-03 — «وضعیت» نوار = وضعیت فاکتور مرجع؛ شماره‌ی نشست روی سند برگشت */
      status?: string | null
      shiftNumber?: number | string | null
    } = {}
  ): Promise<PagedRows<ReturnListRow>> {
    /**
     * بند ۱۰ — پیش‌فرض فقط برگشت ساده. `includeExchanges` تیکِ خاموش‌به‌پیش‌فرض
     * پنل است؛ `kind` صریح (از تب تعویض) بر آن اولویت دارد.
     */
    const kindFilter = filter.kind
      ? { kind: filter.kind }
      : filter.includeExchanges === true
        ? {}
        /**
         * ستون kind در schema فعلی NOT NULL و پیش‌فرضش RETURN است. فرستادن
         * `kind: null` با `as any` فقط TypeScript را ساکت می‌کند و Prisma واقعی
         * آن را ورودی نامعتبر می‌داند؛ نتیجه‌اش در UI جدول خالی بود، نه نبودن
         * برگشت ساده. داده‌ی نوع ناشناخته عمداً اینجا «برگشت ساده» حدس زده
         * نمی‌شود؛ باید جداگانه بررسی شود.
         */
        : { kind: ReturnKind.RETURN }
    // ممیزی A99-03 — دامنه‌ی مشترک با تب تعویض، شمارنده‌ی سقف و پل تطبیق
    const where: Prisma.SaleReturnWhereInput = {
      ...(await returnReportScopeWhere(filter)),
      ...kindFilter
    }
    const totalCount = await prisma.saleReturn.count({ where })
    const page = reportPage(filter.take, filter.skip, 500, totalCount)
    const returns = await prisma.saleReturn.findMany({
      where,
      include: {
        items: true,
        invoice: {
          select: {
            receiptNo: true,
            returnCode: true,
            issuedAtJalali: true,
            customer: { select: { name: true } },
            // بند ۱۰ — «فروشنده‌ی فاکتور اصلی»؛ ستونی که تا امروز نبود
            user: { select: { displayName: true } }
          }
        }
      },
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take
    })

    // «کاربر ثبت‌کننده‌ی برگشت» — `SaleReturn.userId` عمداً scalar است (بدون
    // relation، تا مدل User دست‌نخورده بماند)، پس با یک رفت‌وبرگشت جدا خوانده می‌شود.
    const returnUserIds = [...new Set(returns.map((r) => r.userId).filter((n): n is number => !!n))]
    const returnUsers: any[] = []
    for (const ids of reportIdChunks(returnUserIds)) {
      returnUsers.push(
        ...(await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } }))
      )
    }
    const umap = new Map(returnUsers.map((u) => [u.id, u.displayName]))
    const variantIds = [...new Set(returns.flatMap((r) => r.items.map((i) => i.variantId)))]
    const variants: any[] = []
    for (const ids of reportIdChunks(variantIds)) {
      variants.push(
        ...(await prisma.productVariant.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            code: true,
            size: true,
            color: true,
            product: { select: { name: true, reportLiveName: true } }
          }
        }))
      )
    }
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const rows = returns.map((r) => ({
      id: r.id,
      /** RETURN = برگشت ساده · EXCHANGE = برگشتی که سند تعویض دارد (مورد ۵) */
      kind: r.kind,
      isExchange: r.kind === ReturnKind.EXCHANGE,
      receiptNo: r.invoice?.receiptNo ?? null,
      returnCode: r.invoice?.returnCode ?? null,
      invoiceDateJalali: r.invoice?.issuedAtJalali ?? '—',
      customerName: r.invoice?.customer?.name ?? 'مشتری عمومی',
      returnedAtJalali: r.returnedAtJalali,
      time: toClock(r.returnedAt instanceof Date ? r.returnedAt : new Date(r.returnedAt)),
      isFull: r.isFull,
      total: toNumberRial(r.total),
      hasRemovedItems: r.hasRemovedItems,
      note: r.note ?? '',
      qty: r.items.reduce((s, i) => s + i.qty, 0),
      restockedQty: r.items.reduce((s, i) => s + i.restockedQty, 0),
      /**
       * ---- جلسه ۴۰ · کار ب — «در انتظار تأیید مدیر» (فقط خواندنی) ----
       * تب برگشت/تعویض گزارشات فروش با همین دو عدد ستون و نشان می‌سازد؛ هیچ
       * دکمه‌ی تأیید/بازگشت به انباری بیرون از پنل قفل‌دار ساخته نمی‌شود.
       */
      restockPending: r.restockPending === true,
      pendingRestockQty: r.restockPending === true ? pendingQtyOfItems(r.items) : 0,
      // ---------------- افزوده‌های جلسه ۱۴ (بند ۱۰ و ۱۱) ----------------
      refundMethod: r.refundMethod ?? null,
      refundMethodLabel: refundMethodLabel(r.refundMethod),
      refundAmount: toNumberRial(r.refundAmount),
      /**
       * ⚠️ تنها همین عدد از *کشوی صندوق* بیرون رفته است. کارت روی کارتخوان اثر
       * دارد و اعتبار خرید پول نقد نیست؛ اگر هر سه را یک ستون نشان می‌دادیم،
       * دقیقاً همان قاطی‌شدنی می‌شد که این ماژول برای رفعش نوشته شده.
       */
      cashRefundAmount: r.refundMethod === RefundMethod.CASH ? toNumberRial(r.refundAmount) : 0,
      refundedAtJalali: r.refundedAtJalali ?? null,
      refundReference: r.refundReference ?? null,
      refundNote: r.refundNote ?? null,
      legacyAssumed: !r.refundMethod,
      invoiceUserName: r.invoice?.user?.displayName ?? 'مدیر',
      returnUserName: (r.userId != null ? umap.get(r.userId) : null) ?? 'مدیر',
      /** کد اعتبار از DTO گزارش برگشت حذف است؛ id فقط ردیابی غیرقابل‌مصرف است. */
      storeCreditReference: r.storeCreditId ? `اعتبار #${r.storeCreditId}` : null,
      exchangeDiff: toNumberRial(r.exchangeDiff ?? 0),
      exchangeSettlement: r.exchangeSettlement ?? null,
      exchangeSettlementLabel: r.exchangeSettlement
        ? (EXCHANGE_SETTLEMENT_LABELS[r.exchangeSettlement] ?? r.exchangeSettlement)
        : null,
      shiftId: r.shiftId ?? null,
      items: r.items.map((i) => {
        const v = vmap.get(i.variantId)
        return {
          name: reportLineTitle(i, v),
          code: saleLineCode(i, v),
          qty: i.qty,
          unitPrice: toNumberRial(i.unitPrice),
          lineTotal: toNumberRial(i.lineTotal),
          removedFromStock: i.removedFromStock,
          restockedQty: i.restockedQty
        }
      })
    }))
    return attachReportPage(rows, page)
  }
,

  // =========================================================================
  // ویرایش و حذف یک برگشت از فروش ثبت‌شده
  //
  // اصل کار: خودِ برگشت جای خودش می‌ماند و فقط *اختلاف* موجودی اعمال می‌شود
  // (مثل ویرایش فاکتور). هیچ حرکت انباری پاک نمی‌شود؛ برای برگشتِ اثر، یک حرکت
  // جدید در جهت مخالف ثبت می‌گردد تا سابقه‌ی انبار کامل و قابل ردیابی بماند.
  // =========================================================================

  /** یک برگشت ثبت‌شده + همه‌ی اقلام فاکتورش (برای فرم ویرایش). */
  async returnGet(id: number): Promise<ReturnEditView> {
    const ret = await prisma.saleReturn.findUnique({
      where: { id },
      include: {
        items: true,
        invoice: {
          include: {
            items: true,
            customer: true,
            returns: { where: { voidedAt: null }, include: { items: true } }
          }
        }
      }
    })
    if (!ret) throw new BusinessError('این برگشت از فروش پیدا نشد؛ ممکن است حذف شده باشد. فهرست را تازه کنید.')
    assertReturnNotVoided(ret as any, 'نمایش برای ویرایش')
    const invoice = ret.invoice
    if (!invoice) throw new BusinessError('فاکتور این برگشت پیدا نشد؛ فهرست را تازه کنید.')

    // تعداد برگشت‌خورده در *بقیه‌ی* برگشت‌ها (سقف ویرایش همین برگشت را می‌سازد)
    const otherByItem = new Map<number, number>()
    for (const r of invoice.returns) {
      if (r.id === ret.id) continue
      for (const it of r.items) otherByItem.set(it.saleItemId, (otherByItem.get(it.saleItemId) ?? 0) + it.qty)
    }
    const inThisReturn = new Map<number, { qty: number; restockedQty: number }>()
    for (const it of ret.items) inThisReturn.set(it.saleItemId, { qty: it.qty, restockedQty: it.restockedQty })

    const variantIds = [...new Set(invoice.items.map((i) => i.variantId))]
    const variants = await loadProductVariantsByIds(prisma, variantIds, {
      id: true,
      code: true,
      barcode: true,
      size: true,
      color: true,
      stock: true,
      isActive: true,
      product: { select: { name: true, unit: true, isActive: true } }
    })
    const vmap = new Map(variants.map((v) => [v.id, v]))

    const items: ReturnEditItem[] = invoice.items.map((it) => {
      const v = vmap.get(it.variantId)
      const removed = !!v && (!v.isActive || v.product?.isActive === false)
      const stockState: ReturnItemStock = !v ? 'MISSING' : removed ? 'REMOVED' : 'OK'
      const other = otherByItem.get(it.id) ?? 0
      const current = inThisReturn.get(it.id)
      return {
        saleItemId: it.id,
        variantId: it.variantId,
        code: saleLineCode(it, v),
        barcode: v?.barcode ?? '—',
        name: saleLineTitle(it, v, 'کالای حذف‌شده از سیستم'),
        unit: v?.product?.unit ?? 'عدد',
        soldQty: it.qty,
        otherReturnedQty: other,
        maxQty: Math.max(0, it.qty - other),
        qty: current?.qty ?? 0,
        restockedQty: current?.restockedQty ?? 0,
        unitPrice: toNumberRial(it.unitPrice),
        stock: v?.stock ?? 0,
        stockState
      }
    })

    const returnedAt = ret.returnedAt instanceof Date ? ret.returnedAt : new Date(ret.returnedAt)
    return {
      id: ret.id,
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      returnCode: invoice.returnCode ?? null,
      invoiceDateJalali: invoice.issuedAtJalali,
      customerName: invoice.customer?.name ?? 'مشتری عمومی',
      returnedAtJalali: ret.returnedAtJalali,
      time: toClock(returnedAt),
      isFull: ret.isFull,
      total: toNumberRial(ret.total),
      note: ret.note ?? '',
      /** موجودی فقط وقتی برمی‌گردد که فاکتور اصلی موجودی را کم کرده بود */
      restocks: invoice.deductInventory,
      items
    }
  },

  /**
   * ویرایش تعداد/اقلام یک برگشت ثبت‌شده.
   * `lines` حالت *نهایی* برگشت است. اختلاف موجودی (نسبت به آنچه قبلاً برگشته
   * بود) فوراً و به‌صورت قطعی روی انبار اعمال می‌شود: بیشتر شدن تعداد ⇒ ورود
   * کالا، کمتر شدن ⇒ خروج همان مقدار.
   */
  async returnUpdate(input: UpdateReturnInput) {
    validateReturnUpdateMutation(input)
    if (!input?.id) throw new BusinessError('برگشتی برای ویرایش مشخص نشده است.')
    // نشست ۶۳ (S63-2) — تاریخ سند بیرون از تراکنش خوانده و رمز دوره‌ی بسته همان‌جا سنجیده می‌شود
    const pre = await prisma.saleReturn.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        returnedAt: true,
        refundAmount: true,
        refundMethod: true,
        voidedAt: true,
        voidReason: true,
        kind: true,
        exchangeReceiptNo: true
      }
    })
    if (!pre) throw new BusinessError('این برگشت از فروش پیدا نشد؛ ممکن است حذف شده باشد. فهرست را تازه کنید.')
    assertReturnNotVoided(pre as any, 'ویرایش')
    assertNotExchangeReturn(pre as any, 'ویرایش')

    /**
     * اصلاح هر برگشت، حتی موردِ بدون بازپرداخت، می‌تواند موجودی و بدهی فاکتور
     * را عوض کند. پس قفل عملیاتیِ مستقل از خودِ صفحه باید *همیشه* و پیش از
     * تراکنش سنجیده شود. نصب تازه این قفل را روشن می‌سازد؛ رمز دوم اختصاصی
     * همان عمل یا رمز مدیر کافی است و credential هرگز به renderer برنمی‌گردد.
     */
    const correctionAuthScope = await assertPanelPassword(
      PANEL_KEYS.salesReturnCorrection,
      input.panelPassword ?? input.managerPassword ?? null,
      `ویرایش برگشت از فروش ${faDigits(pre.id)}`
    )

    const periodApproved = pre
      ? await periodLockService.preverify({
          at: pre.returnedAt,
          what: `ویرایش سند برگشت ${faDigits(pre.id)}`,
          managerPassword: (input as any).managerPassword ?? null,
          overrideReason: (input as any).overrideReason ?? null
        })
      : false

    /**
     * نشست ۲۰۱ — رمز/دلیل اثر مالی *بیرون* از تراکنش. قبلاً `assertPanelPassword`
     * وسط `$transaction` صدا می‌شد ⇒ نوشتن AuthLockout با کلاینت سراسری قفل
     * SQLite می‌ساخت و شمارنده‌ی رمز اشتباه با rollback پاک می‌شد.
     */
    const preCredit = pre
      ? await prisma.storeCredit.findFirst({
          where: { returnId: pre.id, voidedAt: null },
          select: { id: true, amount: true }
        })
      : null
    const preTransfer = pre
      ? await prisma.cardTransferRequest.findFirst({
          where: { returnId: pre.id, status: { not: CardTransferStatus.CANCELED } },
          select: { id: true, status: true, amount: true }
        })
      : null
    const preGate = pre ? returnUpdateFinancialGate(pre, preCredit, preTransfer) : null
    /**
     * قفل جدیدِ اصلاح/ابطال در حالت عادی authorization کافی است. اگر مدیر
     * صراحتاً آن قفل را خاموش کرده باشد، اثر مالی همچنان گیت قدیمیِ خودِ پنل
     * برگشت را می‌خواهد؛ خاموش‌شدن یک قفل نباید بی‌صدا حفاظت پول را کم کند.
     */
    let moneyGateVerified = correctionAuthScope !== 'OPEN'
    if (preGate?.needsGate) {
      const reason = String((input as any).overrideReason ?? '').trim()
      if (reason.length < 3)
        throw new BusinessError(
          `این برگشت اثر مالی دارد (${preGate.what.join(' · ')}). برای ویرایشش باید «دلیل» بنویسید تا در سابقه بماند.`
        )
      if (!moneyGateVerified)
        await assertPanelPassword(
          PANEL_KEYS.salesReturn,
          input.managerPassword ?? null,
          `ویرایش سند برگشت ${faDigits(pre.id)} که ${preGate.what.join(' و ')} دارد`
        )
      moneyGateVerified = true
    }

    try {
    return await prisma.$transaction(async (tx) => {
      const ret = await tx.saleReturn.findUnique({
        where: { id: input.id },
        include: { items: true, invoice: { include: { items: true, returns: { where: { voidedAt: null }, include: { items: true } } } } }
      })
      if (!ret) throw new BusinessError('این برگشت از فروش پیدا نشد؛ ممکن است حذف شده باشد. فهرست را تازه کنید.')
      assertReturnNotVoided(ret as any, 'ویرایش')
      // نشست ۶۰ · C6 — برگشتِ تعویض جدا از گرافش ویرایش نمی‌شود
      assertNotExchangeReturn(ret as any, 'ویرایش')
      const invoice = ret.invoice
      if (!invoice) throw new BusinessError('فاکتور این برگشت پیدا نشد؛ فهرست را تازه کنید.')
      /** نشست ۲۱۴ · M1 — بدهی پیش از ویرایش، برای قاعدهٔ چک بند ۴-۵۲ (مثل ثبت برگشت). */
      const remainingBeforeEdit = (
        await invoiceRemaining(
          tx,
          invoice.id,
          toNumberRial(invoice.grandTotal),
          receivedTotalOf(
            (await tx.payment.findMany({
              where: { invoiceId: invoice.id, voidedAt: null },
              select: { amount: true, kind: true, chequeStatus: true }
            })) as any[]
          )
        )
      ).remaining

      // بند ۱۷ — ویرایش برگشتی که تاریخش در دوره‌ی بسته‌شده است
      await periodLockService.assertOpen(tx, {
        at: ret.returnedAt,
        what: `ویرایش سند برگشت ${faDigits(ret.id)}`,
        entity: 'SaleReturn',
        entityId: ret.id,
        managerVerified: periodApproved,
        managerPassword: (input as any).managerPassword ?? null,
        overrideReason: (input as any).overrideReason ?? null,
        userId: input.userId ?? null,
        before: { total: ret.total, returnedAtJalali: ret.returnedAtJalali, refundMethod: ret.refundMethod }
      })

      /**
       * ===================================================================
       * 🔴 نشست ۱۸۲ · بند ۴-۱۵ و ۴-۲۲ — ویرایش برگشتِ *تسویه‌شده*
       * -------------------------------------------------------------------
       * تا امروز این تابع در دوره‌ی باز هیچ رمزی نمی‌خواست، `total` و اقلام
       * را عوض می‌کرد و انبار را اصلاح می‌کرد — ولی `refundAmount`، اعتبار
       * صادرشده و درخواست کارت‌به‌کارت را **اصلاً** دست نمی‌زد.
       *
       * سناریوی دزدی: برگشت دو قلم ۹۰۰٬۰۰۰ با بازپرداخت نقدی ۹۰۰٬۰۰۰ ثبت
       * می‌شود. بعد همان برگشت به یک قلم (۴۵۰٬۰۰۰) ویرایش می‌شود. یک کالا به
       * قفسه برمی‌گردد، ولی خروج ۹۰۰٬۰۰۰ از کشو همچنان «موجه» دیده می‌شود.
       * یعنی ۴۵۰٬۰۰۰ اختلاف، بدون هیچ ردی.
       *
       * دو قاعده گذاشته شد:
       *   ۱) اگر برگشت اثر مالی دارد (بازپرداخت، اعتبار، کارت‌به‌کارت)، ویرایش
       *      **رمز مدیر و دلیل** می‌خواهد.
       *   ۲) ارزش جدید برگشت هرگز نباید از پولی که قبلاً برگشته کمتر شود.
       *      اصلاحِ خودکارِ CashMovement/اعتبار/کارت‌به‌کارت عمداً انجام
       *      *نمی‌شود* — آن مسیر پرریسک است و می‌تواند بی‌صدا پول دوم بسازد.
       *      به‌جایش کاربر به مسیر درست هدایت می‌شود: سند را باطل کن (که
       *      اثرهای مالی را به‌درستی برمی‌گرداند) و برگشت تازه ثبت کن.
       * ===================================================================
       */
      const settledCredit = await tx.storeCredit.findFirst({
        where: { returnId: ret.id, voidedAt: null },
        select: { id: true, amount: true }
      })
      const relatedTransfer = await tx.cardTransferRequest.findFirst({
        where: { returnId: ret.id, status: { not: CardTransferStatus.CANCELED } },
        select: { id: true, status: true, amount: true }
      })
      /**
       * ⚠️ تمایز ظریفی که اول از قلم افتاد و تست `acceptance-db-session40`
       * گرفتش: **کارت‌به‌کارتِ در انتظار یعنی هنوز هیچ پولی خارج نشده.**
       *
       * `refundAmount` برای کارت‌به‌کارت همان لحظه‌ی ثبتِ *درخواست* پر می‌شود،
       * نه لحظه‌ی پرداخت. پس `refundAmount > 0` به‌تنهایی دلیل خروج پول نیست.
       * اگر این را جدا نکنیم، اصلاح یک برگشتِ پرداخت‌نشده بی‌دلیل قفل می‌شود.
       */
      const { refundedAmount, transferPending, hasMoneyEffect, needsGate, what } =
        returnUpdateFinancialGate(ret, settledCredit, relatedTransfer)

      if (needsGate) {
        const reason = String((input as any).overrideReason ?? '').trim()
        if (reason.length < 3)
          throw new BusinessError(
            `این برگشت اثر مالی دارد (${what.join(' · ')}). برای ویرایشش باید «دلیل» بنویسید تا در سابقه بماند.`
          )
        /**
         * نشست ۲۰۱ — رمز را دوباره داخل تراکنش نمی‌سنجیم (AuthLockout). اگر
         * بیرون قفل لازم نبود و اینجا هم‌زمان اثر مالی پیدا شد، بدون نوشتن
         * قفل SQLite از کاربر رمز می‌خواهیم.
         */
        if (!moneyGateVerified)
          throw new BusinessError(
            `این برگشت اثر مالی دارد (${what.join(' · ')}). برای ویرایشش باید رمز مدیر (یا رمز دوم/سوم برگشت) و «دلیل» را وارد کنید.`
          )
      }

      const otherByItem = new Map<number, number>()
      for (const r of invoice.returns) {
        if (r.id === ret.id) continue
        for (const it of r.items) otherByItem.set(it.saleItemId, (otherByItem.get(it.saleItemId) ?? 0) + it.qty)
      }

      // نشست ۲ · C5 — تجمیع ردیف‌های تکراری قبل از سنجش سقف
      const targets = mergeReturnTargets(
        input.lines.map((l) => ({ saleItemId: l.saleItemId, qty: l.qty }))
      )
      /** نشست ۲ · C1 — سهم واقعی هر قلم از پرداختی مشتری (snapshot فاکتور) */
      const lineNet = allocateLineNet(invoice)

      if (!targets.length)
        throw new BusinessError(
          'برای این برگشت هیچ قلمی با تعداد بزرگ‌تر از صفر نمانده است. ' +
            'اگر می‌خواهید کل این برگشت باطل شود، از دکمه‌ی «حذف» استفاده کنید تا موجودی هم درست برگردد.'
        )

      const variantIds = [...new Set(invoice.items.map((i) => i.variantId))]
      const variants = await loadProductVariantsByIds(tx, variantIds, {
        id: true,
        isActive: true,
        size: true,
        color: true,
        product: { select: { name: true, isActive: true } }
      })
      const vmap = new Map(variants.map((v) => [v.id, v]))
      const nameOf = (variantId: number) => {
        const v = vmap.get(variantId)
        if (!v) return 'کالای حذف‌شده از سیستم'
        return `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
      }

      /**
       * ================== جلسه ۴۰ · کار ب — درِ پشتیِ بسته‌شده ==================
       * این مسیر تا دیروز `restockedQty = qty` می‌نوشت و *اختلاف* را به انبار
       * می‌داد. روی یک برگشتِ معلق (کارت‌به‌کارت مدیر، پرداخت‌نشده) معنی‌اش این
       * بود: فروشنده با «ویرایش برگشت» — بدون هیچ رمزی — کالای معلق را به
       * موجودی قابل‌فروش برمی‌گرداند. یعنی همان قفلی که برای `pay` گذاشته شد از
       * یک درِ دیگر دور می‌خورد.
       *
       * پس در حالت معلق، ویرایش **تعداد و مبلغ سند را عوض می‌کند ولی هیچ حرکت
       * انباری نمی‌سازد**: اقلام جدید هم `restockedQty = 0` می‌گیرند و کالا معلق
       * می‌ماند. تنها نقطه‌ی آزادسازی، همان پنل قفل‌دار مدیر است.
       *
       * ⚠️ هم‌زمان جلوی «دو بار اضافه شدن» را هم می‌گیرد: چون `oldRestock` برای
       * سند معلق صفر است و `newRestock` هم صفر می‌شود، `increase`/`decrease` هر
       * دو خالی می‌مانند.
       */
      const pendingRestock = ret.restockPending === true
      const restock = invoice.deductInventory && !pendingRestock
      const rows: {
        saleItemId: number
        variantId: number
        qty: number
        unitPrice: number
        lineTotal: number
        removedFromStock: boolean
      }[] = []
      const blockedMissing: string[] = []
      const blockedRemoved: string[] = []

      for (const t of targets) {
        const src = invoice.items.find((i) => i.id === t.saleItemId)
        if (!src)
          throw new BusinessError('یکی از اقلام انتخاب‌شده در این فاکتور نیست؛ صفحه را تازه کنید و دوباره تلاش کنید.')
        const allowed = Math.max(0, src.qty - (otherByItem.get(src.id) ?? 0))
        /**
         * بند ۱۸ — همان دیوارِ `runReturn`، اینجا هم. اگر فقط مسیر *ثبت* بسته
         * می‌شد، فروشنده می‌توانست یک برگشت کوچک ثبت کند و بعد با «ویرایش
         * برگشت» تعدادش را بالا ببرد — همان حفره، یک در عقب‌تر.
         */
        if (t.qty > allowed)
          throw new BusinessError(
            `تعداد برگشتی «${nameOf(src.variantId)}» (${faDigits(t.qty)}) از تعداد قابل برگشت (${faDigits(allowed)}) بیشتر است.\n` +
              'برگشت بیشتر از باقی‌ماندهٔ قابل‌برگشت در هیچ حالتی مجاز نیست (حتی با تایید مدیر).'
          )
        const v = vmap.get(src.variantId)
        const removed = !!v && (!v.isActive || v.product?.isActive === false)
        if (!v) blockedMissing.push(nameOf(src.variantId))
        else if (removed && !input.allowRemoved) blockedRemoved.push(nameOf(src.variantId))
        rows.push({
          saleItemId: src.id,
          variantId: src.variantId,
          qty: t.qty,
          unitPrice: toNumberRial(src.unitPrice),
          lineTotal: returnValueOf(lineNet.get(src.id) ?? 0, src.qty, otherByItem.get(src.id) ?? 0, t.qty),
          removedFromStock: removed
        })
      }

      if (blockedMissing.length)
        throw new BusinessError(
          'این کالا از موجودی انبار حذف شده است و رکوردی از آن در سیستم نمانده، پس اصلاح خودکار موجودی‌اش ممکن نیست:\n' +
            blockedMissing.map((n) => `• ${n}`).join('\n') +
            '\nتعداد این قلم را صفر بگذارید و موجودی را دستی (از پنل کالاها) اصلاح کنید.'
        )
      if (blockedRemoved.length)
        throw new BusinessError(
          'این کالا از موجودی انبار حذف شده است:\n' +
            blockedRemoved.map((n) => `• ${n}`).join('\n') +
            '\nبرای اصلاح خودکار موجودی همین کالا، گزینه‌ی «رسیدگی دستی: کالای حذف‌شده هم برگشت بخورد» را تایید کنید.'
        )

      // ---- اختلاف موجودی: آنچه قبلاً برگشته بود در مقابل آنچه الان می‌ماند ----
      const oldRestock = new Map<number, number>()
      for (const it of ret.items) oldRestock.set(it.variantId, (oldRestock.get(it.variantId) ?? 0) + it.restockedQty)
      const newRestock = new Map<number, number>()
      if (restock) for (const r of rows) newRestock.set(r.variantId, (newRestock.get(r.variantId) ?? 0) + r.qty)

      const increase: { variantId: number; qty: number }[] = []
      const decrease: { variantId: number; qty: number }[] = []
      for (const variantId of new Set([...oldRestock.keys(), ...newRestock.keys()])) {
        const delta = (newRestock.get(variantId) ?? 0) - (oldRestock.get(variantId) ?? 0)
        if (delta > 0) increase.push({ variantId, qty: delta })
        else if (delta < 0) decrease.push({ variantId, qty: -delta })
      }

      const before = {
        total: ret.total,
        isFull: ret.isFull,
        note: ret.note,
        /** snapshot کامل ردیف‌های قبلی، شامل پیوند saleItemId و اثر واقعی انبار. */
        items: returnItemRevisionRows(ret.items)
      }

      const total = rows.reduce((s, r) => s + r.lineTotal, 0)
      const soldQtyAll = invoice.items.reduce((s, i) => s + i.qty, 0)
      const returnedHere = rows.reduce((s, r) => s + r.qty, 0)
      const otherReturned = [...otherByItem.values()].reduce((s, q) => s + q, 0)

      /**
       * نشست ۱۸۲ — قاعده‌ی ۲ بالا. اگر ارزش جدید از بازپرداختِ انجام‌شده کمتر
       * باشد، تفاوتش پولی است که از کشو رفته ولی دیگر پشتوانه‌ی کالایی ندارد.
       */
      /**
       * 🔴 نشست ۱۸۲ — درخواست کارت‌به‌کارتِ در انتظار باید با ارزش جدید هم‌گام شود.
       *
       * بدون این، سناریو چنین می‌شد: برگشت ۱۵٬۰۰۰٬۰۰۰ با درخواست کارت‌به‌کارت
       * ثبت می‌شود، بعد به ۵٬۰۰۰٬۰۰۰ ویرایش می‌شود، ولی درخواست هنوز
       * ۱۵٬۰۰۰٬۰۰۰ است — و مدیر سه برابر ارزش کالای برگشتی را کارت‌به‌کارت
       * می‌کند. چون هنوز پرداخت نشده، هم‌گام کردنش بی‌خطر و درست است.
       */
      if (relatedTransfer && transferPending && toNumberRial(relatedTransfer.amount) !== total) {
        const wasAmount = toNumberRial(relatedTransfer.amount)
        await tx.cardTransferRequest.update({
          where: { id: relatedTransfer.id },
          data: { amount: total, returnTotal: total }
        })
        await tx.saleReturn.update({ where: { id: ret.id }, data: { refundAmount: total } })
        await audit(tx, {
          action: AuditAction.CARD_TRANSFER_ADJUST,
          entity: 'CardTransferRequest',
          entityId: relatedTransfer.id,
          userId: input.userId ?? null,
          before: JSON.stringify({ amount: wasAmount }),
          after: JSON.stringify({ amount: total }),
          note:
            `مبلغ درخواست کارت‌به‌کارت با ویرایش سند برگشت ${faDigits(ret.id)} هم‌گام شد ` +
            `(${money(wasAmount)} ⇐ ${money(total)} ریال). درخواست هنوز پرداخت نشده بود.`
        })
      }

      if (hasMoneyEffect && total < refundedAmount)
        throw new BusinessError(
          `ارزش جدید این برگشت (${money(total)} ریال) از بازپرداختِ انجام‌شده (${money(refundedAmount)} ریال) کمتر است؛ ` +
            `${money(refundedAmount - total)} ریال پولِ بی‌پشتوانه می‌ماند. ` +
            'برای کم کردن اقلام، اول همین سند را «باطل» کنید (تا بازپرداخت و اعتبارش برگردد) و بعد برگشت تازه ثبت کنید.'
        )

      /**
       * `SaleReturnItem.saleItemId` پیوند مستقیم به قلمِ فروش و مبنای سقف برگشت
       * و تخصیص انبار است؛ بنابراین تغییر آن به soft-delete پرخطر است. پیش از
       * replace، snapshot کامل و fail-closed در دفتر append-only AuditLog ثبت
       * می‌شود. شکستِ ثبت یعنی rollback کل تغییر، نه حذفِ بی‌مدرک.
       */
      const replacementReturnItems = rows.map((r) => ({
        saleItemId: r.saleItemId,
        variantId: r.variantId,
        qty: r.qty,
        unitPrice: r.unitPrice,
        lineTotal: r.lineTotal,
        removedFromStock: r.removedFromStock,
        restockedQty: restock ? r.qty : 0
      }))
      await auditOrThrow(tx, {
        action: AuditAction.SALE_RETURN,
        entity: 'SaleReturnItemRevision',
        entityId: ret.id,
        userId: input.userId ?? ret.userId ?? null,
        before: JSON.stringify({
          version: 1,
          returnId: ret.id,
          invoiceId: invoice.id,
          receiptNo: invoice.receiptNo,
          rows: returnItemRevisionRows(ret.items)
        }),
        after: JSON.stringify({
          version: 1,
          returnId: ret.id,
          invoiceId: invoice.id,
          receiptNo: invoice.receiptNo,
          rows: replacementReturnItems
        }),
        note: `revision اقلام برگشت ${faDigits(ret.id)} · snapshot پیش از جایگزینی ردیف‌ها`
      })

      await tx.saleReturnItem.deleteMany({ where: { returnId: ret.id } })
      const updatedReturn = await tx.saleReturn.update({
        where: { id: ret.id },
        data: {
          total,
          isFull: returnedHere + otherReturned >= soldQtyAll,
          hasRemovedItems: rows.some((r) => r.removedFromStock),
          note: input.note === undefined ? ret.note : input.note?.trim() || null,
          items: { create: replacementReturnItems }
        },
        include: { items: true }
      })

      const ctx = {
        reason: 'SALE_RETURN' as const,
        refType: 'SaleReturn',
        refId: ret.id,
        userId: input.userId ?? ret.userId ?? null,
        note: `اصلاح برگشت از فروش فاکتور ${faDigits(invoice.receiptNo)}`
      }
      if (increase.length) await inventoryService.increase(increase, ctx, tx)
      if (decrease.length) await inventoryService.decrease(decrease, ctx, tx)

      const status = await refreshInvoiceStatus(tx, invoice.id)
      // نشست ۵۸ · C2/C3 — مبلغ برگشت عوض شد ⇒ بدهی و اضافه‌دریافت در همین تراکنش
      const settleAfter = await recalcSettlement(tx, invoice.id)
      await auditOverpayChanges(tx, settleAfter, {
        invoiceId: invoice.id, receiptNo: invoice.receiptNo, userId: input.userId ?? null,
        why: `ویرایش برگشت ${faDigits(ret.id)}`
      })
      /**
       * نشست ۲۱۴ · M1 — ویرایش برگشت هم باید چک در جریان را با بند ۴-۵۲ بسنجد.
       * توافق §۵ CashMovement/اعتبار/کارت‌به‌کارت را لمس نمی‌کند؛ فقط همان سیاست چک ثبت برگشت.
       */
      await chequePolicyAfterReturn(tx, {
        invoiceId: invoice.id,
        receiptNo: invoice.receiptNo,
        returnId: ret.id,
        remainingBefore: remainingBeforeEdit,
        remainingAfter: settleAfter.remaining,
        userId: input.userId ?? null
      })

      await audit(tx, {
        action: AuditAction.SALE_RETURN,
        entity: 'SaleReturn',
        entityId: ret.id,
        userId: input.userId ?? ret.userId ?? null,
        before: JSON.stringify(before),
        after: JSON.stringify({
          receiptNo: invoice.receiptNo,
          total,
          /** شناسه‌های تازه هم در timeline سند می‌مانند؛ snapshot revision شناسه‌های قبلی را دارد. */
          items: returnItemRevisionRows(updatedReturn.items),
          stockDelta: { increase, decrease },
          invoiceStatus: status,
          correctionAuthScope
        }),
        note: pendingRestock
          ? 'ویرایش برگشت از فروش · کالای این برگشت «در انتظار پرداخت مدیر» است، پس هیچ حرکت انباری ' +
            'ثبت نشد و کالا همچنان بیرون از موجودی قابل‌فروش است'
          : restock
            ? `ویرایش برگشت از فروش · اختلاف موجودی اعمال شد (ورود ${increase.length} قلم، خروج ${decrease.length} قلم)`
            : 'ویرایش برگشت از فروش (فاکتور بدون کسر موجودی بود، انبار تغییر نکرد)'
      })

      return {
        id: ret.id,
        invoiceId: invoice.id,
        receiptNo: invoice.receiptNo,
        total,
        qty: returnedHere,
        restocked: restock,
        increasedQty: increase.reduce((s, i) => s + i.qty, 0),
        decreasedQty: decrease.reduce((s, i) => s + i.qty, 0),
        status
      }
    }, TX_OPTIONS)
    } catch (e) {
      if (e instanceof BusinessError && String(e.message).includes('از بازپرداختِ انجام‌شده')) {
        await audit(prisma as any, {
          action: AuditAction.SALE_RETURN,
          entity: 'SaleReturn',
          entityId: input.id,
          userId: input.userId ?? null,
          after: JSON.stringify({ needsManagerReview: true, editBlocked: true }),
          note:
            `⚠️ نیاز به رسیدگی مدیر: ویرایش سند برگشت ${faDigits(input.id)} انجام نشد ` +
            `(ارزش جدید از بازپرداخت انجام‌شده کمتر است) و هیچ چیزی تغییر نکرد. ` +
            `علت رد: ${String(e.message).split('\n')[0]}`
        })
      }
      throw e
    }
  },

  /**
   * حذف یک برگشت ثبت‌شده. اثر آن روی موجودی انبار کامل برگردانده می‌شود:
   * هر تعدادی که با این برگشت به انبار آمده بود، با یک حرکت جدید از انبار خارج
   * می‌گردد (موجودی به حالت قبل از آن برگشت برمی‌گردد) و وضعیت فاکتور هم
   * بازمحاسبه می‌شود.
   *
   * نشست ۶۴ · خوشه C / بند ۴-۲۲ — «حذف» برگشت ساده = **ابطال (void)**، نه حذف فیزیکی.
   *
   * سند و اقلامش به‌عنوان مدرک می‌مانند (voidedAt / voidedByUserId / voidReason) و از
   * همه‌ی محاسبه‌ها بیرون می‌روند. اثرهای برگشت‌پذیر در **همان تراکنش** برمی‌گردند:
   * موجودی انبار (حرکت مخالف، سابقه پاک نمی‌شود)، درخواست کارت‌به‌کارتِ در انتظار
   * (CANCELED)، اعتبار خرید دست‌نخورده (CANCELED با مهر ابطال)، وضعیت و بدهی فاکتور.
   * اثرهای برگشت‌ناپذیر — پولی که واقعاً پرداخت شده (نقد از کشو، کارت‌خوان،
   * کارت‌به‌کارتِ پرداخت‌شده)، اعتباری که خرج شده، مصرف اعتباری که با برگشت کامل
   * آزاد شده — ⇒ هیچ چیزی نوشته نمی‌شود (rollback کامل) و یک ردیف «رسیدگی مدیر»
   * بیرون از تراکنش ردشده در Audit می‌نشیند.
   * دلیل ابطال اجباری است. سند تعویض همچنان مسدود است (S60-2) تا ابطال کل گراف ساخته شود.
   */
  async returnDelete(input: {
    id: number
    userId?: number | null
    /** نشست ۶۴ — دلیل ابطال (اجباری) */
    reason?: string | null
    /** رمز اختیاری قفل «اصلاح و ابطال برگشت/تعویض» در روز جاری. */
    panelPassword?: string | null
    /** بند ۱۷ — سازگاری با مسیر قدیمیِ رمز سراسری (برای عملیات دیگر) */
    managerPassword?: string | null
    overrideReason?: string | null
    /** مدیر شخصیِ تأییدکننده برای اصلاح دیرهنگام یا دوره‌ی بسته. */
    approverUserId?: number | null
    approverPassword?: string | null
  }) {
    if (!input?.id) throw new BusinessError('برگشتی برای ابطال مشخص نشده است.')
    // نشست ۶۳ (S63-2) — رمز دوره‌ی بسته بیرون از تراکنش؛ نشست ۶۴ — اول گاردهای بی‌هزینه
    const pre = await prisma.saleReturn.findUnique({
      where: { id: input.id },
      select: {
        id: true,
        returnedAt: true,
        returnedAtJalali: true,
        voidedAt: true,
        voidReason: true,
        kind: true,
        exchangeReceiptNo: true
      }
    })
    if (!pre) throw new BusinessError('این برگشت از فروش پیدا نشد؛ فهرست را تازه کنید.')
    assertReturnNotVoided(pre as any, 'ابطال')
    /** نشست ۶۵ (S65-1) — برگشتِ تعویض = ابطال اتمیک کل گراف تعویض (نه مسدود) */
    const preIsExchange = (pre.kind ?? 'RETURN') === ReturnKind.EXCHANGE
    const reason = String(input.reason ?? '').trim()
    if (reason.length < 3)
      throw new BusinessError(
        (preIsExchange
          ? `برای ابطال این تعویض کالا${pre.exchangeReceiptNo ? ` (سند تعویض ${faDigits(pre.exchangeReceiptNo)})` : ''}، نوشتن دلیل اجباری است (حداقل ۳ حرف).\n` +
            'سند برگشت و سند تعویض حذف نمی‌شوند؛ هر دو با مهر «باطل» و همین دلیل برای همیشه در سابقه می‌مانند.'
          : 'برای ابطال سند برگشت، نوشتن دلیل اجباری است (حداقل ۳ حرف).\n' +
            'سند حذف نمی‌شود؛ با مهر «باطل» و همین دلیل برای همیشه در سابقه می‌ماند.')
      )
    /**
     * قفل مستقل عملیاتِ ابطال، جدا از قفل صفحه‌ی برگشت است و در نصب تازه روشن
     * می‌ماند؛ بنابراین IPC مستقیم هم بدون رمز مدیر/دومِ همین عمل رد می‌شود.
     * فقط مدیر می‌تواند آگاهانه آن را در تنظیمات خاموش کند. گیت سخت دوره‌ی بسته
     * پایین‌تر مستقل می‌ماند.
     */
    const correctionAuthScope = await assertPanelPassword(
      PANEL_KEYS.salesReturnCorrection,
      input.panelPassword ?? input.managerPassword ?? null,
      preIsExchange ? 'ابطال تعویض کالا' : 'ابطال برگشت از فروش'
    )

    /**
     * روز عملیاتی از نشست بازِ سرور خوانده می‌شود؛ اگر نشستی باز نباشد فقط
     * تاریخ سرور معتبر است. هرگز ساعت/تاریخ renderer ملاک نیست. پس فروشنده
     * فقط همان روز عملیاتی می‌تواند ابطال کند؛ هر روز بعد یا دوره‌ی بسته،
     * حتماً هویتِ یک مدیر مشخص را می‌خواهد.
     */
    const operationalShift = await shiftService.shiftForNow()
    const operationalDayJalali = operationalShift?.dayJalali || jalaliToday()
    const sameOperationalDay = pre.returnedAtJalali === operationalDayJalali
    const periodState = await periodLockService.status({ at: pre.returnedAt })
    const requiresNamedManager = !sameOperationalDay || periodState.enforced
    const managerApproval = requiresNamedManager
      ? await verifyManagerCorrectionApproval({
          managerUserId: input.approverUserId,
          password: input.approverPassword,
          action:
            !sameOperationalDay
              ? `ابطال دیرهنگام سند برگشت ${faDigits(pre.id)}`
              : `ابطال سند برگشت ${faDigits(pre.id)} در دوره‌ی بسته‌شده`
        })
      : null
    const periodApproved = await periodLockService.preverify({
      at: pre.returnedAt,
      what: `ابطال سند برگشت ${faDigits(pre.id)}`,
      managerPassword: input.managerPassword ?? null,
      overrideReason: input.overrideReason ?? reason,
      alreadyVerified: managerApproval != null
    })

    /**
     * از این نقطه به بعد هر ردِ کسب‌وکاری = «ابطال ناممکن» ⇒ ردیف رسیدگی مدیر
     *
     * نشست ۱۸۰ (S180-D9، گام ۰ خوشه M): مقدار `effects` داخل callback تراکنش
     * نوشته می‌شود، پس control-flow analysis در `catch` همچنان `'validate'`
     * می‌بیند و مقایسه را «بی‌معنا» اعلام می‌کرد (TS2367). این یک false-positive
     * تایپی است، نه باگ زمان‌اجرا؛ `stageOf()` فقط narrowing را باز می‌کند.
     * (قرینه‌اش `reviewCtx` است که همان‌جا با cast دستی حل شده بود.)
     */
    type VoidStage = 'validate' | 'effects'
    let stage: VoidStage = 'validate'
    const stageOf = (): VoidStage => stage
    let reviewCtx: { invoiceId: number; receiptNo: number | null; total: number } | null = null
    try {
      return await prisma.$transaction(async (tx) => {
        const ret = await tx.saleReturn.findUnique({
          where: { id: input.id },
          include: { items: true, invoice: { select: { id: true, receiptNo: true, deductInventory: true, status: true } } }
        })
        if (!ret) throw new BusinessError('این برگشت از فروش پیدا نشد؛ فهرست را تازه کنید.')
        assertReturnNotVoided(ret as any, 'ابطال')
        /**
         * نشست ۶۵ (S65-1) — برگشتِ تعویض جدا از گرافش باطل نمی‌شود: همین‌جا کل گراف
         * (سند برگشت + سند تعویض + اعتبار + درخواست کارت‌به‌کارت + انبار دو طرف +
         * کاهش بدهی فاکتور اصلی) در همین تراکنش باطل/برگردانده می‌شود.
         */
        const isExchange = (ret.kind ?? 'RETURN') === ReturnKind.EXCHANGE

        // بند ۱۷ — ابطال سندِ یک دوره‌ی بسته‌شده: گیت مدیر + دلیل + AuditLog
        await periodLockService.assertOpen(tx, {
          at: ret.returnedAt,
          what: `ابطال سند برگشت ${faDigits(ret.id)}`,
          entity: 'SaleReturn',
          entityId: ret.id,
          managerVerified: periodApproved,
          managerPassword: input.managerPassword ?? null,
          overrideReason: input.overrideReason ?? reason,
          approvedByUserId: managerApproval?.userId ?? null,
          approvedByLabel: managerApproval?.displayName ?? null,
          userId: input.userId ?? null,
          before: { total: ret.total, returnedAtJalali: ret.returnedAtJalali, invoiceId: ret.invoiceId }
        })

        stage = 'effects'
        reviewCtx = { invoiceId: ret.invoiceId, receiptNo: ret.invoice?.receiptNo ?? null, total: toNumberRial(ret.total) }
        const receipt = faDigits(ret.invoice?.receiptNo ?? 0)
        const refundAmt = Math.round(Number(ret.refundAmount ?? 0))

        // ---- ۰-الف) نشست ۶۵ — گراف تعویض: سند تعویض و گاردهای برگشت‌ناپذیرش ----
        let exInv: any = null
        if (isExchange) {
          exInv = ret.exchangeInvoiceId
            ? await tx.saleInvoice.findUnique({
                where: { id: ret.exchangeInvoiceId },
                include: { items: true, payments: { include: { method: { select: { key: true, label: true } } } } }
              })
            : null
          if (!exInv)
            throw new BusinessError(
              `ابطال تعویض (سند برگشت ${faDigits(ret.id)}) ممکن نیست: «سند تعویض» مرتبط پیدا نشد (داده ناقص است). ` +
                'موضوع برای رسیدگی مدیر ثبت شد.'
            )
          if (exInv.voidedAt != null)
            throw new BusinessError(`ابطال این تعویض ممکن نیست: سند تعویض ${faDigits(exInv.receiptNo)} قبلاً باطل شده است.`)
          const liveReturnsOnEx = await tx.saleReturn.count({ where: { invoiceId: exInv.id, voidedAt: null } })
          if (liveReturnsOnEx > 0)
            throw new BusinessError(
              `ابطال تعویض ممکن نیست: روی خودِ سند تعویض ${faDigits(exInv.receiptNo)}، ${faDigits(liveReturnsOnEx)} برگشت از فروش ` +
                'ثبت شده است (کالای جایگزین هم برگشت خورده).\n' +
                'اول آن برگشت(ها) را باطل کنید، بعد تعویض را. موضوع برای رسیدگی مدیر ثبت شد.'
            )
          /** مابه‌التفاوتی که مشتری واقعاً پرداخته (هر پرداختی غیر از «ارزش کالای برگشتی») */
          const realPaid = (exInv.payments ?? []).filter(
            (p: any) => Number(p.amount ?? 0) > 0 && p.method?.key !== EXCHANGE_CREDIT_METHOD_KEY
          )
          if (realPaid.length) {
            const amt = realPaid.reduce((t: number, p: any) => t + Math.round(Number(p.amount ?? 0)), 0)
            throw new BusinessError(
              `ابطال تعویض ممکن نیست: ${money(amt)} ریال مابه‌التفاوت روی سند تعویض ${faDigits(exInv.receiptNo)} از مشتری دریافت شده است ` +
                `(${[...new Set(realPaid.map((p: any) => p.method?.label ?? 'پرداخت'))].join('، ')}).\n` +
                'این پول واقعاً به فروشگاه رسیده و با ابطال سند به مشتری برنمی‌گردد؛ ابطال فقط اضافه‌ی صندوق را پنهان می‌کرد. ' +
                'موضوع برای رسیدگی مدیر ثبت شد.'
            )
          }
        }
        /** برچسب سند در پیام‌ها: برگشت ساده یا تعویض */
        const docLabel = isExchange
          ? `تعویض (سند برگشت ${faDigits(ret.id)}، سند تعویض ${faDigits(exInv?.receiptNo ?? 0)})`
          : `سند برگشت ${faDigits(ret.id)}`

        // ---- ۰) اثرهای برگشت‌ناپذیر ⇒ رد کامل ----
        const cashOut = await tx.cashMovement.findMany({
          where: { refType: 'SaleReturn', refId: ret.id },
          select: { id: true, amount: true }
        })
        if (cashOut.length || (ret.refundMethod === RefundMethod.CASH && refundAmt > 0)) {
          const amt = cashOut.reduce((t: number, c: any) => t + Math.abs(Number(c.amount ?? 0)), 0) || refundAmt
          throw new BusinessError(
            `ابطال ${docLabel} ممکن نیست: ${money(amt)} ریال بازپرداخت نقد از کشو به مشتری داده شده است.\n` +
              'این پول واقعاً رفته و با ابطال سند برنمی‌گردد؛ ابطال فقط مغایرت صندوق را پنهان می‌کرد. موضوع برای رسیدگی مدیر ثبت شد.'
          )
        }
        if (ret.refundMethod === RefundMethod.CARD && refundAmt > 0)
          throw new BusinessError(
            `ابطال ${docLabel} ممکن نیست: ${money(refundAmt)} ریال با کارت‌خوان به مشتری بازپرداخت شده است ` +
              '(نه نقد و نه اعتبار؛ پول واقعاً رفته). موضوع برای رسیدگی مدیر ثبت شد.'
          )
        const paidTransfer = await tx.cardTransferRequest.findFirst({
          where: { returnId: ret.id, kind: CardTransferKind.REQUEST, status: CardTransferStatus.PAID }
        })
        if (paidTransfer)
          throw new BusinessError(
            `ابطال ${docLabel} ممکن نیست: بازپرداخت کارت‌به‌کارت ${money(Number(paidTransfer.amount ?? 0))} ریال ` +
              'قبلاً توسط مدیر پرداخت شده است (پول واقعاً رفته). موضوع برای رسیدگی مدیر ثبت شد.'
          )
        const credits = await tx.storeCredit.findMany({ where: { returnId: ret.id } })
        for (const c of credits) {
          const used = toNumberRial(c.usedAmount ?? 0)
          const liveUses = await tx.storeCreditRedemption.count({ where: { creditId: c.id, reversedAt: null } })
          if (used > 0 || Number(c.usedCount ?? 0) > 0 || liveUses > 0)
            throw new BusinessError(
              `ابطال ${docLabel} ممکن نیست: اعتبار خرید #${c.id} که از همین برگشت صادر شده، ` +
                `${money(used)} ریال مصرف شده است (مصرف اعتبار قابل برگرداندن نیست).\n` +
                'ابطال سند، اعتبار خرج‌شده را بی‌پشتوانه می‌گذاشت. موضوع برای رسیدگی مدیر ثبت شد.'
            )
        }
        if (ret.invoice?.status === SaleStatus.RETURNED) {
          const reversedUses = await tx.storeCreditRedemption.count({ where: { invoiceId: ret.invoiceId, reversedAt: { not: null } } })
          if (reversedUses > 0)
            throw new BusinessError(
              `ابطال ${docLabel} ممکن نیست: با برگشت کامل فاکتور ${receipt}، مصرف اعتبار خرید آن فاکتور ` +
                'به اعتبار مشتری برگشت خورده است و ابطال خودکار آن ممکن نیست (اعتبار آزادشده ممکن است دوباره خرج شده باشد). ' +
                'موضوع برای رسیدگی مدیر ثبت شد.'
            )
        }

        /** جلسه ۴۰ · کار ب — کالای این برگشت معلق بود؟ (برای متن‌ها و AuditLog) */
        const wasPending = ret.restockPending === true
        const reverse = new Map<number, number>()
        for (const it of ret.items) {
          if (it.restockedQty > 0) reverse.set(it.variantId, (reverse.get(it.variantId) ?? 0) + it.restockedQty)
        }
        const snapshot = {
          id: ret.id,
          invoiceId: ret.invoiceId,
          receiptNo: ret.invoice?.receiptNo ?? null,
          returnedAtJalali: ret.returnedAtJalali,
          total: ret.total,
          isFull: ret.isFull,
          refundMethod: ret.refundMethod ?? null,
          refundAmount: refundAmt,
          note: ret.note,
          items: ret.items.map((i) => ({
            saleItemId: i.saleItemId,
            variantId: i.variantId,
            qty: i.qty,
            unitPrice: i.unitPrice,
            restockedQty: i.restockedQty
          }))
        }

        // ---- ۱) برگشتِ اثر انباری (حرکت جدید در جهت مخالف؛ سابقه پاک نمی‌شود) ----
        const changes = [...reverse.entries()].map(([variantId, qty]) => ({ variantId, qty }))
        if (changes.length) {
          await inventoryService.decrease(
            changes,
            {
              reason: 'SALE_RETURN',
              refType: 'SaleReturn',
              refId: ret.id,
              userId: input.userId ?? ret.userId ?? null,
              note: `ابطال برگشت از فروش فاکتور ${receipt} · موجودی به حالت قبل برگشت · دلیل: ${reason}`
            },
            tx
          )
        }

        // ---- ۲) درخواست کارت‌به‌کارتِ در انتظار ⇒ لغو (رکورد می‌ماند) ----
        const pendingReq = await tx.cardTransferRequest.findFirst({
          where: { returnId: ret.id, kind: CardTransferKind.REQUEST, status: CardTransferStatus.PENDING }
        })
        if (pendingReq) {
          await tx.cardTransferRequest.update({
            where: { id: pendingReq.id },
            data: {
              status: CardTransferStatus.CANCELED,
              canceledAt: new Date(),
              cancelReason: `سند برگشت مرجع (${faDigits(ret.id)}) باطل شد · ${reason}`,
              stockNote: wasPending
                ? 'سند برگشت باطل شد · کالای معلق هیچ‌وقت به موجودی قابل‌فروش اضافه نشده بود'
                : pendingReq.stockNote
            }
          })
          await tx.auditLog.create({
            data: {
              action: AuditAction.CARD_TRANSFER_CANCEL,
              entity: 'CardTransferRequest',
              entityId: pendingReq.id,
              userId: input.userId ?? null,
              after: JSON.stringify({ returnId: ret.id, amount: pendingReq.amount, wasPendingStock: wasPending }),
              note:
                `درخواست کارت‌به‌کارت ${faDigits(pendingReq.id)} با ابطال سند برگشت مرجع لغو شد` +
                (wasPending ? ' · کالای معلق هیچ‌وقت وارد موجودی قابل‌فروش نشد' : '')
            }
          })
        }

        // ---- ۳) اعتبار خرید دست‌نخورده‌ی همین برگشت ⇒ ابطال (نه حذف) ----
        const now = new Date()
        /**
         * پاسخ و Audit فقط شناسه‌ی داخلیِ قابل‌نمایش دارند؛ code یک credential
         * قابل‌مصرف است و حتی برای عملیات ابطال نیز به UI/لاگ عادی برنمی‌گردد.
         */
        const canceledCreditRefs: string[] = []
        for (const c of credits) {
          if (c.status === StoreCreditStatus.CANCELED) continue
          await tx.storeCredit.update({
            where: { id: c.id },
            data: { status: StoreCreditStatus.CANCELED, voidedAt: now, voidedReason: `ابطال سند برگشت ${faDigits(ret.id)} · ${reason}` }
          })
          canceledCreditRefs.push(`اعتبار #${c.id}`)
          await audit(tx, {
            action: AuditAction.CREDIT_VOID,
            entity: 'StoreCredit',
            entityId: c.id,
            userId: input.userId ?? null,
            before: JSON.stringify({ status: c.status, amount: c.amount }),
            after: JSON.stringify({ status: StoreCreditStatus.CANCELED, returnId: ret.id }),
            note: `ابطال اعتبار #${c.id} (${money(Number(c.amount ?? 0))} ریال) چون سند برگشت ${faDigits(ret.id)} باطل شد · دلیل: ${reason}`
          })
        }

        // ---- ۴) مهر ابطال روی خود سند (سند و اقلامش می‌مانند) ----
        await tx.saleReturn.update({
          where: { id: ret.id },
          data: { voidedAt: now, voidedByUserId: input.userId ?? null, voidReason: reason, ...(wasPending ? { restockPending: false } : {}) }
        })

        // ---- ۴-ب) نشست ۶۵ — سند تعویض (فاکتور جایگزین): انبار معکوس + مهر ابطال ----
        let exReversedQty = 0
        if (isExchange && exInv) {
          if (exInv.deductInventory !== false) {
            const back = new Map<number, number>()
            for (const it of exInv.items ?? []) {
              const q = Math.round(Number(it.qty ?? 0))
              if (q > 0) back.set(it.variantId, (back.get(it.variantId) ?? 0) + q)
            }
            const incr = [...back.entries()].map(([variantId, qty]) => ({ variantId, qty }))
            if (incr.length) {
              // S65-4 — حرکت تازه‌ی مثبت با همان reason فروش (فروش خالص این سند = صفر)؛ سابقه‌ی کسر اولیه پاک نمی‌شود
              await inventoryService.increase(
                incr,
                {
                  reason: 'SALE',
                  refType: 'SaleInvoice',
                  refId: exInv.id,
                  userId: input.userId ?? ret.userId ?? null,
                  note: `ابطال سند تعویض ${faDigits(exInv.receiptNo)} · کالای جایگزین به موجودی برگشت · دلیل: ${reason}`
                },
                tx
              )
              exReversedQty = incr.reduce((t, c) => t + c.qty, 0)
            }
          }
          await tx.saleInvoice.update({
            where: { id: exInv.id },
            data: {
              voidedAt: now,
              voidedByUserId: input.userId ?? null,
              voidReason: reason,
              status: SaleStatus.CANCELED
            }
          })
          /** بند ۲۲ — پرداخت «ارزش کالای برگشتی» روی سند باطل زنده نماند. */
          await tx.payment.updateMany({
            where: { invoiceId: exInv.id, voidedAt: null },
            data: {
              voidedAt: now,
              voidedByUserId: input.userId ?? null,
              voidReason: reason
            }
          })
          await audit(tx, {
            action: AuditAction.VOID,
            entity: 'SaleInvoice',
            entityId: exInv.id,
            userId: input.userId ?? null,
            before: JSON.stringify({
              receiptNo: exInv.receiptNo, status: exInv.status, grandTotal: exInv.grandTotal,
              exchangeReturnId: ret.id, sourceInvoiceId: exInv.sourceInvoiceId,
              items: (exInv.items ?? []).map((i: any) => ({ variantId: i.variantId, qty: i.qty, unitPrice: i.unitPrice })),
              payments: (exInv.payments ?? []).map((p: any) => ({ id: p.id, amount: p.amount, method: p.method?.key ?? null }))
            }),
            after: JSON.stringify({ voidedAt: now.toISOString(), voidedByUserId: input.userId ?? null, reason, status: SaleStatus.CANCELED }),
            note:
              `ابطال سند تعویض ${faDigits(exInv.receiptNo)} (${money(Math.round(Number(exInv.grandTotal ?? 0)))} ریال) همراه با کل گراف تعویض ` +
              `فاکتور ${receipt} · دلیل: ${reason}` +
              (exReversedQty ? ` · ${faDigits(exReversedQty)} عدد کالای جایگزین به موجودی برگشت` : '') +
              ' · شماره فیش سند باطل برای همیشه رزرو می‌ماند'
          })
        }

        /** نشست ۱۶۴ · Y22 · بند ۴-۲۲ — چکی که همین سند خودکار باطل کرده بود برمی‌گردد */
        await restoreChequesAfterReturnVoid(tx, {
          invoiceId: ret.invoiceId,
          receiptNo: ret.invoice?.receiptNo ?? 0,
          returnId: ret.id,
          userId: input.userId ?? null,
          reason
        })
        // ---- ۵) وضعیت، بدهی و اضافه‌دریافت فاکتور بدون این سند ----
        const status = await refreshInvoiceStatus(tx, ret.invoiceId)
        const settleAfter = await recalcSettlement(tx, ret.invoiceId, { userId: input.userId ?? null })
        await auditOverpayChanges(tx, settleAfter, {
          invoiceId: ret.invoiceId, receiptNo: ret.invoice?.receiptNo ?? 0, userId: input.userId ?? null,
          why: `ابطال برگشت ${faDigits(ret.id)}`
        })
        /** نشست ۶۵ (بند ۴-۵ معکوس) — کاهش بدهیِ تعویض با ابطالش برمی‌گردد */
        const debtRestored = isExchange ? Math.max(0, Math.round(Number(ret.debtReduction ?? 0))) : 0
        if (debtRestored > 0) {
          await audit(tx, {
            action: AuditAction.VOID,
            entity: 'SaleInvoice',
            entityId: ret.invoiceId,
            userId: input.userId ?? null,
            after: JSON.stringify({ returnId: ret.id, debtRestored, remaining: settleAfter?.remaining ?? null }),
            note:
              `ابطال تعویض ⇒ کاهش بدهی ${money(debtRestored)} ریالی فاکتور ${receipt} برگشت خورد ` +
              `(هیچ پولی جابه‌جا نشد) · باقی‌مانده‌ی بدهی: ${money(Math.round(Number(settleAfter?.remaining ?? 0)))} ریال · دلیل: ${reason}`
          })
        }

        await audit(tx, {
          action: AuditAction.VOID,
          entity: 'SaleReturn',
          entityId: ret.id,
          userId: input.userId ?? ret.userId ?? null,
          before: JSON.stringify(snapshot),
          after: JSON.stringify({
            voidedAt: now.toISOString(),
            voidedByUserId: input.userId ?? null,
            reason,
            canceledCreditRefs,
            status,
            correctionAuthScope,
            operationalDayJalali,
            sameOperationalDay,
            approvingManager: managerApproval
              ? { userId: managerApproval.userId, displayName: managerApproval.displayName }
              : null
          }),
          note:
            (isExchange
              ? `ابطال تعویض کالا: سند برگشت ${faDigits(ret.id)} و سند تعویض ${faDigits(exInv?.receiptNo ?? 0)} فاکتور ${receipt} (${money(ret.total)} ریال) · دلیل: ${reason}`
              : `ابطال سند برگشت ${faDigits(ret.id)} فاکتور ${receipt} (${money(ret.total)} ریال) · دلیل: ${reason}`) +
            (debtRestored > 0 ? ` · کاهش بدهی ${money(debtRestored)} ریالی فاکتور اصلی برگشت خورد` : '') +
            (changes.length
              ? ` · ${faDigits(changes.reduce((s, c) => s + c.qty, 0))} عدد از موجودی انبار برگشت خورد`
              : wasPending
                ? ' · کالایش «در انتظار پرداخت مدیر» بود و هیچ‌وقت به موجودی اضافه نشده بود'
                : '') +
            (canceledCreditRefs.length ? ` · اعتبار باطل‌شده: ${canceledCreditRefs.join('، ')}` : '') +
            (pendingReq ? ` · درخواست کارت‌به‌کارت ${faDigits(pendingReq.id)} لغو شد` : '') +
            ` · وضعیت فاکتور: ${status ?? '—'}` +
            (managerApproval
              ? ` · تأیید دیرهنگام/دوره‌بسته توسط مدیر «${managerApproval.displayName}» (#${faDigits(managerApproval.userId)})`
              : '')
        })

        return {
          id: ret.id,
          invoiceId: ret.invoiceId,
          receiptNo: ret.invoice?.receiptNo ?? null,
          total: ret.total,
          reversedQty: changes.reduce((s, c) => s + c.qty, 0),
          status,
          voided: true as const,
          voidedAt: now,
          reason,
          canceledCreditRefs,
          /** نشست ۶۵ — ابطال گراف تعویض */
          exchangeVoided: isExchange,
          exchangeInvoiceId: exInv?.id ?? null,
          exchangeReceiptNo: exInv?.receiptNo ?? null,
          exchangeReversedQty: exReversedQty,
          debtRestored,
          approvingManager: managerApproval
            ? { userId: managerApproval.userId, displayName: managerApproval.displayName }
            : null
        }
      }, TX_OPTIONS)
    } catch (e) {
      if (stageOf() === 'effects' && e instanceof BusinessError) {
        const ctx = reviewCtx as { invoiceId: number; receiptNo: number | null; total: number } | null
        // بیرون از تراکنش ردشده — این ردیف باید بماند (بند ۴-۲۲: «مورد رسیدگی مدیر»)
        await audit(prisma as any, {
          action: AuditAction.VOID,
          entity: 'SaleReturn',
          entityId: input.id,
          userId: input.userId ?? null,
          after: JSON.stringify({ needsManagerReview: true, voidBlocked: true, reason, invoiceId: ctx?.invoiceId ?? null }),
          note:
            (preIsExchange
              ? `⚠️ نیاز به رسیدگی مدیر: درخواست ابطال تعویض کالا (سند برگشت ${faDigits(input.id)}` +
                (pre.exchangeReceiptNo ? `، سند تعویض ${faDigits(pre.exchangeReceiptNo)}` : '') + ')'
              : `⚠️ نیاز به رسیدگی مدیر: درخواست ابطال سند برگشت ${faDigits(input.id)}`) +
            (ctx?.receiptNo ? ` (فاکتور ${faDigits(ctx.receiptNo)}، ${money(ctx.total)} ریال)` : '') +
            ` انجام نشد و هیچ چیزی تغییر نکرد. دلیل درخواست: ${reason} · علت رد: ${String(e.message).split('\n')[0]}`
        })
      }
      throw e
    }
  },

  /**
   * دفتر جبرانیِ ابطال برگشتِ تسویه‌شده.
   *
   * برخلاف `returnDelete` قدیمی، این مسیر SaleReturn/StoreCredit/حرکت نقدی
   * اولیه را پاک یا باطل نمی‌کند. اثرهای جبرانی با زمان/کاربر/شیفت فعلی ایجاد
   * می‌شوند؛ بنابراین گزارش شیفت مبدأ حقیقت تاریخی خود را حفظ می‌کند و صندوق
   * و شمارش موجودیِ شیفت اصلاح‌کننده اثر واقعیِ امروز را می‌بینند.
   *
   * برای تعویض، هر دو سمت موجودی (کالای برگشتی و کالای جایگزین) و همچنین هر
   * پرداخت/بازیافت نقد و کارت با effect جدا ثبت می‌شود؛ بنابراین تعویض هرگز
   * برگشت ساده فرض نمی‌شود.
   */
  async returnReconcileVoid(input: {
    id?: number | null
    userId?: number | null
    reason?: string | null
    panelPassword?: string | null
    approverUserId?: number | null
    approverPassword?: string | null
    /** آنچه واقعاً از مشتری به صندوق فعلی برگشته است. */
    cashRecovered?: number | null
    /** آنچه واقعاً به کارت/بانک برگشته است (دفتر مستقل، نه پول کشو). */
    cardRecovered?: number | null
    cardReference?: string | null
    /** فقط تعویضِ مثبت: آنچه واقعاً امروز به مشتری پس داده شده است. */
    cashPaidOut?: number | null
    cardPaidOut?: number | null
    cardPayoutReference?: string | null
    /** NONE | CANCELED_UNUSED | REMAINS_ACTIVE | CONSUMED */
    creditOutcome?: string | null
    note?: string | null
  }) {
    const id = Math.round(Number(input?.id ?? 0))
    if (!Number.isSafeInteger(id) || id <= 0) throw new BusinessError('برگشتی برای اصلاح جبرانی مشخص نشده است.')
    const reason = String(input?.reason ?? '').trim()
    if (reason.length < 3) throw new BusinessError('برای اصلاح جبرانی، نوشتن دلیل اجباری است (حداقل ۳ حرف).')
    const toSafeNonnegativeAmount = (value: unknown, label: string): number => {
      if (value == null || value === '') return 0
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
        throw new BusinessError(`${label} باید عدد صحیحِ صفر یا بزرگ‌تر باشد.`)
      return value
    }
    const cashRecovered = toSafeNonnegativeAmount(input?.cashRecovered, 'مبلغ نقدِ بازیافتی')
    const cardRecovered = toSafeNonnegativeAmount(input?.cardRecovered, 'مبلغ کارت/بانکِ بازیافتی')
    const cashPaidOut = toSafeNonnegativeAmount(input?.cashPaidOut, 'مبلغ نقدِ پرداختیِ جبرانی')
    const cardPaidOut = toSafeNonnegativeAmount(input?.cardPaidOut, 'مبلغ کارت/بانکِ پرداختیِ جبرانی')
    const cardReference = String(input?.cardReference ?? '').trim()
    const cardPayoutReference = String(input?.cardPayoutReference ?? '').trim()
    if (cardRecovered > 0 && cardReference.length < 3)
      throw new BusinessError('برای مبلغ بازیافتی کارت/بانک، شماره پیگیری یا توضیح قابل‌ردیابی بنویسید (حداقل ۳ نویسه).')
    if (cardPaidOut > 0 && cardPayoutReference.length < 3)
      throw new BusinessError('برای مبلغ پرداختی کارت/بانک، شماره پیگیری یا توضیح قابل‌ردیابی بنویسید (حداقل ۳ نویسه).')

    const pre = await prisma.saleReturn.findUnique({
      where: { id },
      select: {
        id: true,
        kind: true,
        voidedAt: true,
        returnedAt: true,
        returnedAtJalali: true,
        userId: true,
        shiftId: true,
        exchangeReceiptNo: true
      }
    })
    if (!pre) throw new BusinessError('این برگشت از فروش پیدا نشد؛ فهرست را تازه کنید.')
    assertReturnNotVoided(pre as any, 'ابطال')
    /** مقدار ناآشنا هرگز برگشت ساده یا تعویض فرض نمی‌شود. */
    if (pre.kind !== ReturnKind.RETURN && pre.kind !== ReturnKind.EXCHANGE)
      throw new BusinessError(
        `نوع سند ${String(pre.kind ?? 'نامشخص')} برای اصلاح جبرانی شناخته‌شده نیست` +
          (pre.exchangeReceiptNo ? ` (سند تعویض ${faDigits(pre.exchangeReceiptNo)})` : '') +
          '. برای جلوگیری از اثر مالی نادرست، رسیدگی دستی مدیر لازم است.'
      )

    const correctionAuthScope = await assertPanelPassword(
      PANEL_KEYS.salesReturnCorrection,
      input?.panelPassword ?? null,
      'اصلاح/ابطال جبرانی برگشت از فروش'
    )
    /** نشست باز مرجع قطعی کاربر/شیفتِ جبران است؛ renderer نمی‌تواند آن را جعل کند. */
    const operationalShift = await shiftService.shiftForNow()
    if (!operationalShift?.id || !operationalShift.userId)
      throw new BusinessError('برای ثبت اصلاح جبرانی باید یک نشست باز با کارمند مشخص وجود داشته باشد؛ ابتدا نشست/کارمند فعلی را تعیین کنید.')
    const correctingUserId = Number(operationalShift.userId)
    const correctingShiftId = Number(operationalShift.id)
    const operationalDayJalali = operationalShift.dayJalali || jalaliToday()
    const sameOperationalDay = pre.returnedAtJalali === operationalDayJalali
    const periodState = await periodLockService.status({ at: pre.returnedAt })
    const managerApproval = !sameOperationalDay || periodState.enforced
      ? await verifyManagerCorrectionApproval({
          managerUserId: input?.approverUserId,
          password: input?.approverPassword,
          action:
            !sameOperationalDay
              ? `اصلاح دیرهنگام برگشت ${faDigits(pre.id)}`
              : `اصلاح برگشت ${faDigits(pre.id)} در دوره‌ی بسته‌شده`
        })
      : null
    const periodApproved = await periodLockService.preverify({
      at: pre.returnedAt,
      what: `اصلاح جبرانی برگشت ${faDigits(pre.id)}`,
      overrideReason: reason,
      alreadyVerified: managerApproval != null
    })

    return prisma.$transaction(async (tx) => {
      const ret = await tx.saleReturn.findUnique({
        where: { id },
        include: {
          items: true,
          invoice: { select: { id: true, receiptNo: true } }
        }
      })
      if (!ret) throw new BusinessError('این برگشت از فروش پیدا نشد؛ فهرست را تازه کنید.')
      assertReturnNotVoided(ret as any, 'ابطال')
      const isExchange = ret.kind === ReturnKind.EXCHANGE
      if (!isExchange && ret.kind !== ReturnKind.RETURN)
        throw new BusinessError('نوع این سند دیگر شناخته‌شده نیست؛ اصلاح جبرانی انجام نشد.')
      const exchangeInvoice = isExchange
        ? ret.exchangeInvoiceId
          ? await tx.saleInvoice.findUnique({ where: { id: ret.exchangeInvoiceId }, include: { items: true } })
          : null
        : null
      if (isExchange && !exchangeInvoice)
        throw new BusinessError('سند تعویض جایگزین پیدا نشد؛ موجودی یا پرداخت را حدس نمی‌زنیم و اصلاح جبرانی انجام نشد.')
      /**
       * فقط گرافِ دقیقِ همین تعویض قابل جبران است. شناسه‌ی تنها کافی نیست؛
       * رکورد نیمه‌باطل/پیوندِ دست‌خورده/فاکتور جایگزین دیگری می‌تواند دوباره
       * موجودی را تغییر دهد، پس اینجا عمداً fail-closed است.
       */
      if (
        isExchange &&
        (exchangeInvoice!.voidedAt != null ||
          exchangeInvoice!.orderType !== OrderType.EXCHANGE ||
          Number(exchangeInvoice!.exchangeReturnId ?? 0) !== ret.id ||
          Number(exchangeInvoice!.sourceInvoiceId ?? 0) !== ret.invoiceId ||
          (ret.exchangeReceiptNo != null && Number(ret.exchangeReceiptNo) !== Number(exchangeInvoice!.receiptNo)))
      )
        throw new BusinessError('پیوند سند جایگزین این تعویض کامل و فعال نیست؛ برای جلوگیری از دوباره‌کاری انبار یا پول، اصلاح جبرانی انجام نشد و رسیدگی دستی مدیر لازم است.')
      if (isExchange) {
        const activeReturnsOnReplacement = await tx.saleReturn.count({ where: { invoiceId: exchangeInvoice!.id, voidedAt: null } })
        if (activeReturnsOnReplacement > 0)
          throw new BusinessError(
            `روی سند جایگزین تعویض ${faDigits(exchangeInvoice!.receiptNo)}، ${faDigits(activeReturnsOnReplacement)} برگشت فعال ثبت شده است؛ ` +
              'ابتدا سرنوشت آن برگشت‌ها را روشن کنید. اصلاح جبرانی این گراف اکنون موجودی را حدس نمی‌زند.'
          )
      }
      const existing = await (tx as any).returnCorrection.findUnique({ where: { returnId: ret.id }, select: { id: true } })
      if (existing)
        throw new BusinessError(`برای برگشت ${faDigits(ret.id)} قبلاً اصلاح جبرانی شماره ${faDigits(existing.id)} ثبت شده است؛ ثبت دوباره ممنوع است.`)

      await periodLockService.assertOpen(tx, {
        at: ret.returnedAt,
        what: `اصلاح جبرانی برگشت ${faDigits(ret.id)}`,
        entity: 'SaleReturn',
        entityId: ret.id,
        managerVerified: periodApproved,
        overrideReason: reason,
        approvedByUserId: managerApproval?.userId ?? null,
        approvedByLabel: managerApproval?.displayName ?? null,
        userId: correctingUserId,
        before: { total: ret.total, returnedAtJalali: ret.returnedAtJalali, invoiceId: ret.invoiceId }
      })

      const now = new Date()
      const refundAmount = Math.max(0, toNumberRial(ret.refundAmount ?? 0))
      let originalCashOrCardOut = 0
      let originalCashOrCardIn = 0
      /** درخواست معلق پول هنوز جابه‌جا نشده است؛ با اصلاح گراف باید صریحاً لغو شود. */
      let pendingCardTransfer: { id: number; amount: number | bigint } | null = null
      const refundMethod = String(ret.refundMethod ?? '')
      /**
       * درخواست کارت‌به‌کارت یک تعهد/جریان جداست: PENDING هنوز پرداخت نشده و
       * PAID/ADJUSTED فقط به اندازه‌ی پرداخت خالصِ واقعی قابل بازیافت است.
       */
      const actualCardToCardPaid = async (): Promise<number> => {
        const requests = await tx.cardTransferRequest.findMany({
          where: { returnId: ret.id, kind: CardTransferKind.REQUEST },
          orderBy: { id: 'asc' },
          take: 2,
          select: { id: true, status: true, amount: true, paidAmount: true, paidAt: true }
        })
        if (!requests.length)
          throw new BusinessError('برای کارت‌به‌کارتِ این سند، درخواست مرجع پیدا نشد؛ مبلغ را صفر فرض نمی‌کنیم و رسیدگی دستی مدیر لازم است.')
        if (requests.length > 1)
          throw new BusinessError('برای کارت‌به‌کارت این سند بیش از یک درخواست مرجع پیدا شد؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
        const request = requests[0]
        if (request.status === CardTransferStatus.PENDING) {
          if (request.paidAt != null || request.paidAmount != null)
            throw new BusinessError('درخواست کارت‌به‌کارت این سند هم‌زمان «در انتظار» و دارای پرداخت ثبت‌شده است؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
          pendingCardTransfer = { id: request.id, amount: request.amount }
          return 0
        }
        if (request.status === CardTransferStatus.CANCELED) {
          if (request.paidAt != null || request.paidAmount != null)
            throw new BusinessError('درخواست کارت‌به‌کارت لغوشده‌ی این سند پرداخت ثبت‌شده هم دارد؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
          return 0
        }
        if (
          (request.status !== CardTransferStatus.PAID && request.status !== CardTransferStatus.ADJUSTED) ||
          request.paidAt == null
        )
          throw new BusinessError('وضعیت پرداخت کارت‌به‌کارت این سند قابل‌تطبیق نیست؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
        const adjustments = await tx.cardTransferRequest.findMany({
          where: { adjustsRequestId: request.id, kind: CardTransferKind.ADJUSTMENT },
          select: { amount: true, paidAmount: true, status: true, paidAt: true }
        })
        if (adjustments.some((row) => row.status !== CardTransferStatus.PAID || row.paidAt == null))
          throw new BusinessError('یکی از اصلاح‌های کارت‌به‌کارت این سند وضعیت پرداخت معتبر ندارد؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
        const paidNet =
          toNumberRial(request.paidAmount ?? request.amount) +
          adjustments.reduce((sum, row) => sum + toNumberRial(row.paidAmount ?? row.amount), 0)
        if (!Number.isSafeInteger(paidNet) || paidNet < 0)
          throw new BusinessError('جمع پرداخت کارت‌به‌کارت این سند معتبر نیست؛ مبلغ بازیافتی حدس زده نمی‌شود و رسیدگی دستی مدیر لازم است.')
        return paidNet
      }
      if (isExchange) {
        const exchangeDiff = toNumberRial(ret.exchangeDiff ?? 0)
        const exchangeSettlement = String(ret.exchangeSettlement ?? '')
        const exchangeRefund = exchangeRefundPartOf({ exchangeDiff, debtReduction: ret.debtReduction ?? 0 })
        const knownExchangeSettlements = [
          ExchangeSettlement.CASH,
          ExchangeSettlement.CREDIT,
          ExchangeSettlement.CASH_REFUND,
          ExchangeSettlement.CARD_REFUND,
          ExchangeSettlement.CARD_TO_CARD,
          ExchangeSettlement.DEBT_REDUCTION,
          ExchangeSettlement.NONE
        ]
        if (!knownExchangeSettlements.includes(exchangeSettlement as any))
          throw new BusinessError('روش تسویه‌ی این تعویض شناخته‌شده نیست؛ هیچ مبلغی را صفر فرض نمی‌کنیم و رسیدگی دستی مدیر لازم است.')
        if (exchangeDiff > 0) {
          // مشتری در تعویض مابه‌التفاوت داده بود؛ اصلاح امروز فقط به اندازه‌ی همان مبلغ می‌تواند پرداخت معکوس ثبت کند.
          if (exchangeSettlement !== ExchangeSettlement.CASH)
            throw new BusinessError('مابه‌التفاوت مثبت این تعویض با روش نامعتبر ثبت شده است؛ پرداخت جبرانی حدس زده نمی‌شود.')
          originalCashOrCardIn = exchangeDiff
        } else if (exchangeRefund > 0) {
          if (exchangeSettlement === ExchangeSettlement.CASH_REFUND || exchangeSettlement === ExchangeSettlement.CARD_REFUND) {
            originalCashOrCardOut = exchangeRefund
          } else if (exchangeSettlement === ExchangeSettlement.CARD_TO_CARD) {
            originalCashOrCardOut = await actualCardToCardPaid()
          } else if (exchangeSettlement !== ExchangeSettlement.CREDIT)
            throw new BusinessError('مابه‌التفاوت منفی این تعویض با روش تسویه‌ی ناسازگار ثبت شده است؛ اصلاح جبرانی انجام نشد.')
        }
      } else {
        const knownRefundMethods = [RefundMethod.NONE, RefundMethod.CASH, RefundMethod.CARD, RefundMethod.STORE_CREDIT, RefundMethod.CARD_TO_CARD]
        if (!knownRefundMethods.includes(refundMethod as RefundMethod))
          throw new BusinessError(
            refundMethod
              ? 'روش بازپرداخت این برگشت برای اصلاح جبرانی شناخته‌شده نیست؛ برای جلوگیری از مخفی‌شدن پول، رسیدگی دستی مدیر لازم است.'
              : 'روش بازپرداخت این برگشت قدیمی ثبت نشده است؛ مبلغ آن را صفر فرض نمی‌کنیم. ابتدا رسیدگی دستی و تکمیل تسویه لازم است.'
          )
        if (refundMethod === RefundMethod.CASH || refundMethod === RefundMethod.CARD) originalCashOrCardOut = refundAmount
        if (refundMethod === RefundMethod.CARD_TO_CARD) originalCashOrCardOut = await actualCardToCardPaid()
      }
      if (cashRecovered + cardRecovered > originalCashOrCardOut)
        throw new BusinessError(
          `جمع مبلغ بازیافتی (${money(cashRecovered + cardRecovered)} ریال) از بازپرداخت واقعی این سند (${money(originalCashOrCardOut)} ریال) بیشتر است.`
        )
      if (cashPaidOut + cardPaidOut > originalCashOrCardIn)
        throw new BusinessError(
          `جمع مبلغ پرداختیِ جبرانی (${money(cashPaidOut + cardPaidOut)} ریال) از مابه‌التفاوتی که مشتری در تعویض داده بود (${money(originalCashOrCardIn)} ریال) بیشتر است.`
        )
      if (!isExchange && (cashPaidOut > 0 || cardPaidOut > 0))
        throw new BusinessError('پرداخت جبرانی فقط برای تعویضِ دارای مابه‌التفاوت مثبت مجاز است؛ برای برگشت ساده فقط مبلغ بازیافتی را ثبت کنید.')

      const credit = ret.storeCreditId
        ? await tx.storeCredit.findUnique({
            where: { id: ret.storeCreditId },
            select: { id: true, amount: true, usedAmount: true, status: true, voidedAt: true }
          })
        : null
      const creditAmount = credit ? Math.max(0, toNumberRial(credit.amount)) : 0
      const creditUsed = credit ? Math.max(0, toNumberRial(credit.usedAmount)) : 0
      const creditRemaining = Math.max(0, creditAmount - creditUsed)
      const creditOutcome = String(input?.creditOutcome ?? (credit ? '' : 'NONE')).trim().toUpperCase()
      const allowedCreditOutcomes = credit ? ['CANCELED_UNUSED', 'REMAINS_ACTIVE', 'CONSUMED'] : ['NONE']
      if (!allowedCreditOutcomes.includes(creditOutcome))
        throw new BusinessError(credit ? 'وضعیت اعتبار صادرشده را دقیقاً انتخاب کنید: لغو نشده/باقی می‌ماند/مصرف شده.' : 'این برگشت اعتبار خرید صادرشده ندارد؛ وضعیت اعتبار باید «ندارد» باشد.')
      if (creditOutcome === 'CANCELED_UNUSED' && (creditUsed > 0 || creditRemaining <= 0))
        throw new BusinessError('اعتبار فقط وقتی «لغوِ مصرف‌نشده» می‌شود که هیچ مصرفی نداشته باشد و مانده‌ی مثبت داشته باشد.')
      if (creditOutcome === 'CONSUMED' && creditRemaining > 0)
        throw new BusinessError('این اعتبار بخشی مانده دارد؛ وضعیت «مصرف‌شده» فقط برای اعتباری پذیرفته است که کاملاً مصرف شده باشد. وضعیت «باقی می‌ماند» را ثبت کنید.')
      if (creditOutcome === 'REMAINS_ACTIVE' && creditRemaining <= 0)
        throw new BusinessError('اعتبارِ مانده‌دار وجود ندارد؛ وضعیت «مصرف‌شده» را انتخاب کنید.')

      const unrecoveredRefundAmount = Math.max(0, originalCashOrCardOut - cashRecovered - cardRecovered)
      const unpaidExchangePayoutAmount = Math.max(0, originalCashOrCardIn - cashPaidOut - cardPaidOut)
      /** یک عددِ قابل گزارش برای مغایرت باز؛ نوع اثر مشخص می‌کند «بازیافت نشده» است یا «به مشتری پرداخت نشده». */
      const unrecoveredAmount = unrecoveredRefundAmount + unpaidExchangePayoutAmount
      const originalSnapshot = {
        returnId: ret.id,
        invoiceId: ret.invoiceId,
        receiptNo: ret.invoice?.receiptNo ?? null,
        returnedAtJalali: ret.returnedAtJalali,
        total: toNumberRial(ret.total),
        refundMethod: ret.refundMethod ?? null,
        refundAmount,
        kind: ret.kind,
        exchangeInvoiceId: ret.exchangeInvoiceId ?? null,
        exchangeReceiptNo: ret.exchangeReceiptNo ?? null,
        exchangeDiff: isExchange ? toNumberRial(ret.exchangeDiff ?? 0) : 0,
        exchangeSettlement: isExchange ? ret.exchangeSettlement ?? null : null,
        originalUserId: ret.userId ?? null,
        originalShiftId: ret.shiftId ?? null,
        credit: credit ? { id: credit.id, amount: creditAmount, usedAmount: creditUsed, status: credit.status } : null
      }
      const reconciliation = {
        cashRecovered,
        cardRecovered,
        cardReference: cardRecovered > 0 ? cardReference : null,
        cashPaidOut,
        cardPaidOut,
        cardPayoutReference: cardPaidOut > 0 ? cardPayoutReference : null,
        originalCashOrCardOut,
        originalCashOrCardIn,
        unrecoveredRefundAmount,
        unpaidExchangePayoutAmount,
        unrecoveredAmount,
        creditOutcome,
        creditAmount,
        creditUsed,
        creditRemaining,
        note: String(input?.note ?? '').trim() || null
      }
      const correction = await (tx as any).returnCorrection.create({
        data: {
          returnId: ret.id,
          reason,
          originalUserId: ret.userId ?? null,
          originalShiftId: ret.shiftId ?? null,
          correctingUserId,
          correctingShiftId,
          approvingManagerId: managerApproval?.userId ?? null,
          originalDayJalali: ret.returnedAtJalali,
          operationalDayJalali,
          originalSnapshotJson: JSON.stringify(originalSnapshot),
          reconciliationJson: JSON.stringify(reconciliation),
          cashRecovered,
          cardRecovered,
          cashPaidOut,
          cardPaidOut,
          unrecoveredAmount,
          creditOutcome,
          creditAffectedAmount: creditAmount,
          createdAt: now,
          createdAtJalali: toJalaliDate(now),
          createdAtTime: toClock(now)
        }
      })

      const effectRows: any[] = []
      /**
       * درخواست کارت‌به‌کارتِ معلق «پول پرداخت‌شده» نیست، اما تعهد باز است.
       * اگر با اصلاح سند زنده بماند، مدیر بعداً برای معامله‌ای که برگردانده
       * شده پول می‌پردازد؛ پس آن را با دلیلِ خودِ اثر جبرانی لغو و ثبت می‌کنیم.
       */
      if (pendingCardTransfer) {
        await tx.cardTransferRequest.update({
          where: { id: pendingCardTransfer.id },
          data: {
            status: CardTransferStatus.CANCELED,
            canceledAt: now,
            cancelReason: `اصلاح جبرانی ${isExchange ? 'تعویض' : 'برگشت'} ${faDigits(ret.id)} · اصلاح ${faDigits(correction.id)} · ${reason}`
          }
        })
        const pendingAmount = Math.max(0, toNumberRial(pendingCardTransfer.amount))
        effectRows.push({
          correctionId: correction.id,
          type: 'CARD_TO_CARD_CANCELED',
          amount: pendingAmount,
          referenceType: 'CardTransferRequest',
          referenceId: pendingCardTransfer.id,
          detailsJson: JSON.stringify({ returnId: ret.id, exchangeInvoiceId: exchangeInvoice?.id ?? null, statusBefore: CardTransferStatus.PENDING }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
        await audit(tx, {
          action: AuditAction.CARD_TRANSFER_CANCEL,
          entity: 'CardTransferRequest',
          entityId: pendingCardTransfer.id,
          userId: correctingUserId,
          after: JSON.stringify({ returnId: ret.id, correctionId: correction.id, amount: pendingAmount, status: CardTransferStatus.CANCELED }),
          note: `درخواست کارت‌به‌کارت ${faDigits(pendingCardTransfer.id)} با اصلاح جبرانی ${isExchange ? 'تعویض' : 'برگشت'} ${faDigits(ret.id)} لغو شد · دلیل: ${reason}`
        })
      }
      const stockLines = ret.items
        .filter((item: any) => Number(item.restockedQty ?? 0) > 0)
        .map((item: any) => ({ variantId: Number(item.variantId), qty: Number(item.restockedQty) }))
      if (stockLines.length) {
        await inventoryService.decrease(
          stockLines,
          {
            reason: 'RETURN_CORRECTION',
            refType: 'ReturnCorrection',
            refId: correction.id,
            userId: correctingUserId,
            note: `اصلاح جبرانی برگشت ${faDigits(ret.id)} · فاکتور ${faDigits(ret.invoice?.receiptNo ?? 0)} · ${reason}`
          },
          tx
        )
        for (const item of ret.items) {
          const qty = Number(item.restockedQty ?? 0)
          if (qty > 0)
            effectRows.push({
              correctionId: correction.id,
              type: 'INVENTORY_OUT',
              qty,
              variantId: item.variantId,
              referenceType: 'SaleReturnItem',
              referenceId: item.id,
              detailsJson: JSON.stringify({ returnId: ret.id }),
              occurredAt: now,
              occurredAtJalali: toJalaliDate(now),
              occurredAtTime: toClock(now),
              shiftId: correctingShiftId,
              userId: correctingUserId
            })
        }
      }
      /** تعویض دو جهت موجودی دارد: کالای اولیه از انبار خارج و کالای جایگزین به انبار فعلی برمی‌گردد. */
      if (isExchange && exchangeInvoice?.deductInventory) {
        const replacementLines = exchangeInvoice.items
          .filter((item: any) => Number(item.qty ?? 0) > 0)
          .map((item: any) => ({ variantId: Number(item.variantId), qty: Number(item.qty) }))
        if (replacementLines.length) {
          await inventoryService.increase(
            replacementLines,
            {
              reason: 'RETURN_CORRECTION',
              refType: 'ReturnCorrection',
              refId: correction.id,
              userId: correctingUserId,
              note: `بازگشت جبرانی کالای جایگزینِ تعویض ${faDigits(ret.id)} · سند ${faDigits(exchangeInvoice.receiptNo)} · ${reason}`
            },
            tx
          )
          for (const item of exchangeInvoice.items) {
            const qty = Number(item.qty ?? 0)
            if (qty > 0)
              effectRows.push({
                correctionId: correction.id,
                type: 'EXCHANGE_REPLACEMENT_IN',
                qty,
                variantId: item.variantId,
                referenceType: 'SaleInvoiceItem',
                referenceId: item.id,
                detailsJson: JSON.stringify({ returnId: ret.id, exchangeInvoiceId: exchangeInvoice.id }),
                occurredAt: now,
                occurredAtJalali: toJalaliDate(now),
                occurredAtTime: toClock(now),
                shiftId: correctingShiftId,
                userId: correctingUserId
              })
          }
        }
      }
      if (cashRecovered > 0) {
        const movement = await recordCashMovement(tx, {
          amount: cashRecovered,
          type: CashMovementType.CASH_IN,
          shiftId: correctingShiftId,
          userId: correctingUserId,
          description: `بازیافت نقدِ اصلاح برگشت ${faDigits(ret.id)} · اصلاح ${faDigits(correction.id)} · ${reason}`,
          refType: 'ReturnCorrection',
          refId: correction.id,
          occurredAt: now
        })
        effectRows.push({
          correctionId: correction.id,
          type: 'CASH_RECOVERED',
          amount: cashRecovered,
          cashMovementId: movement.id,
          referenceType: 'CashMovement',
          referenceId: movement.id,
          detailsJson: JSON.stringify({ returnId: ret.id }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      }
      if (cashPaidOut > 0) {
        const movement = await recordCashMovement(tx, {
          amount: cashPaidOut,
          type: CashMovementType.CASH_OUT,
          shiftId: correctingShiftId,
          userId: correctingUserId,
          description: `پرداخت نقدِ جبرانیِ ابطال تعویض ${faDigits(ret.id)} · اصلاح ${faDigits(correction.id)} · ${reason}`,
          refType: 'ReturnCorrection',
          refId: correction.id,
          occurredAt: now
        })
        effectRows.push({
          correctionId: correction.id,
          type: 'CASH_PAID_OUT',
          amount: cashPaidOut,
          cashMovementId: movement.id,
          referenceType: 'CashMovement',
          referenceId: movement.id,
          detailsJson: JSON.stringify({ returnId: ret.id, exchangeInvoiceId: exchangeInvoice?.id ?? null }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      }
      if (cardRecovered > 0)
        effectRows.push({
          correctionId: correction.id,
          type: 'CARD_RECOVERED',
          amount: cardRecovered,
          detailsJson: JSON.stringify({ returnId: ret.id, cardReference }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      if (cardPaidOut > 0)
        effectRows.push({
          correctionId: correction.id,
          type: 'CARD_PAID_OUT',
          amount: cardPaidOut,
          detailsJson: JSON.stringify({ returnId: ret.id, exchangeInvoiceId: exchangeInvoice?.id ?? null, cardPayoutReference }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      if (unrecoveredRefundAmount > 0)
        effectRows.push({
          correctionId: correction.id,
          type: 'UNRECOVERED_REFUND',
          amount: unrecoveredRefundAmount,
          detailsJson: JSON.stringify({ returnId: ret.id, originalCashOrCardOut }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      if (unpaidExchangePayoutAmount > 0)
        effectRows.push({
          correctionId: correction.id,
          type: 'UNPAID_EXCHANGE_PAYOUT',
          amount: unpaidExchangePayoutAmount,
          detailsJson: JSON.stringify({ returnId: ret.id, originalCashOrCardIn }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      if (credit) {
        if (creditOutcome === 'CANCELED_UNUSED') {
          await tx.storeCredit.update({
            where: { id: credit.id },
            data: {
              status: StoreCreditStatus.CANCELED,
              voidedAt: now,
              voidedReason: `اصلاح جبرانی برگشت ${faDigits(ret.id)} · اصلاح ${faDigits(correction.id)} · ${reason}`
            }
          })
        }
        effectRows.push({
          correctionId: correction.id,
          type: `CREDIT_${creditOutcome}`,
          amount: creditOutcome === 'CANCELED_UNUSED' ? creditRemaining : creditAmount,
          referenceType: 'StoreCredit',
          referenceId: credit.id,
          detailsJson: JSON.stringify({ creditStatusBefore: credit.status, usedAmount: creditUsed, remainingAmount: creditRemaining }),
          occurredAt: now,
          occurredAtJalali: toJalaliDate(now),
          occurredAtTime: toClock(now),
          shiftId: correctingShiftId,
          userId: correctingUserId
        })
      }
      if (effectRows.length) await (tx as any).returnCorrectionEffect.createMany({ data: effectRows })

      const status = await refreshInvoiceStatus(tx, ret.invoiceId)
      const settleAfter = await recalcSettlement(tx, ret.invoiceId, { userId: correctingUserId, overpayCreditShortfall: 'flag' })
      await auditOverpayChanges(tx, settleAfter, {
        invoiceId: ret.invoiceId,
        receiptNo: ret.invoice?.receiptNo ?? 0,
        userId: correctingUserId,
        why: `اصلاح جبرانی برگشت ${faDigits(ret.id)}`
      })
      await audit(tx, {
        action: AuditAction.VOID,
        entity: 'ReturnCorrection',
        entityId: correction.id,
        userId: correctingUserId,
        before: JSON.stringify(originalSnapshot),
        after: JSON.stringify({
          returnId: ret.id,
          correctionId: correction.id,
          correctionAuthScope,
          operationalDayJalali,
          sameOperationalDay,
          correctingUserId,
          correctingShiftId,
          approvingManager: managerApproval,
          reconciliation,
          effectCount: effectRows.length,
          invoiceStatus: status,
          invoiceRemaining: settleAfter.remaining
        }),
        note:
          `اصلاح جبرانی ${isExchange ? 'تعویض' : 'برگشت'} ${faDigits(ret.id)} (فاکتور ${faDigits(ret.invoice?.receiptNo ?? 0)}) ثبت شد` +
          ` · شیفت اصلاح ${faDigits(correctingShiftId)} / کاربر ${faDigits(correctingUserId)}` +
          (cashPaidOut || cardPaidOut ? ` · پرداخت جبرانی به مشتری: ${money(cashPaidOut + cardPaidOut)} ریال` : '') +
          (managerApproval ? ` · تأیید مدیر «${managerApproval.displayName}» (#${faDigits(managerApproval.userId)})` : '') +
          ` · دلیل: ${reason}` +
          (unrecoveredAmount ? ` · مغایرت بازیافت‌نشده: ${money(unrecoveredAmount)} ریال` : '')
      })
      return {
        id: correction.id,
        returnId: ret.id,
        invoiceId: ret.invoiceId,
        receiptNo: ret.invoice?.receiptNo ?? null,
        status: 'POSTED' as const,
        cashRecovered,
        cardRecovered,
        cashPaidOut,
        cardPaidOut,
        unrecoveredAmount,
        creditOutcome,
        correctedShiftId: correctingShiftId,
        correctingUserId,
        approvingManager: managerApproval,
        effects: effectRows.map((row) => ({ type: row.type, amount: row.amount ?? 0, qty: row.qty ?? 0 }))
      }
    }, TX_OPTIONS)
  },

  /** خواندنی: دفتر اصلاح‌های جبرانی برای گزارش و پیگیری مغایرت. */
  async returnCorrectionList(input: { fromJalali?: string | null; toJalali?: string | null } = {}) {
    const from = String(input.fromJalali ?? '').trim() || jalaliToday()
    const to = String(input.toJalali ?? '').trim() || from
    if (!isValidJalaliDate(from) || !isValidJalaliDate(to) || from > to)
      throw new BusinessError('بازه‌ی گزارش اصلاحات جبرانی معتبر نیست.')
    const rows = await (prisma as any).returnCorrection.findMany({
      where: { createdAt: { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) } },
      include: { effects: { orderBy: { id: 'asc' } }, return: { select: { invoiceId: true, returnedAtJalali: true, total: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    })
    const userIds = [...new Set(rows.flatMap((row: any) => [row.originalUserId, row.correctingUserId, row.approvingManagerId]).filter(Boolean))]
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, displayName: true } })
      : []
    const userName = new Map(users.map((u: any) => [u.id, u.displayName]))
    return {
      rows: rows.map((row: any) => ({
        id: row.id,
        returnId: row.returnId,
        invoiceId: row.return?.invoiceId ?? null,
        originalDayJalali: row.originalDayJalali,
        operationalDayJalali: row.operationalDayJalali,
        createdAtJalali: row.createdAtJalali,
        createdAtTime: row.createdAtTime,
        reason: row.reason,
        cashRecovered: toNumberRial(row.cashRecovered),
        cardRecovered: toNumberRial(row.cardRecovered),
        cashPaidOut: toNumberRial(row.cashPaidOut ?? 0),
        cardPaidOut: toNumberRial(row.cardPaidOut ?? 0),
        unrecoveredAmount: toNumberRial(row.unrecoveredAmount),
        creditOutcome: row.creditOutcome,
        originalUser: row.originalUserId ? userName.get(row.originalUserId) ?? `کاربر #${row.originalUserId}` : 'نامشخص',
        correctingUser: userName.get(row.correctingUserId) ?? `کاربر #${row.correctingUserId}`,
        approvingManager: row.approvingManagerId ? userName.get(row.approvingManagerId) ?? `مدیر #${row.approvingManagerId}` : null,
        originalShiftId: row.originalShiftId,
        correctingShiftId: row.correctingShiftId,
        effects: row.effects.map((effect: any) => ({
          type: effect.type,
          amount: toNumberRial(effect.amount),
          qty: effect.qty,
          variantId: effect.variantId,
          detailsJson: effect.detailsJson
        }))
      }))
    }
  },

  // =========================================================================
  // فروش نسیه (اقساطی): پرداختی چندمرحله‌ای و چک
  // =========================================================================

  /**
   * تاریخچه‌ی کامل پرداختی‌های یک فاکتور + باقی‌مانده و وضعیت تسویه.
   * همین خروجی، پنجره‌ی «پرداختی‌ها / اقساط» را می‌سازد.
   */
  async payments(input: { invoiceId?: number } = {}): Promise<InvoicePaymentsView> {
    const invoiceId = Number(input?.invoiceId ?? 0)
    if (!invoiceId) throw new BusinessError('فاکتوری برای نمایش پرداختی‌ها مشخص نشده است.')
    const inv = await prisma.saleInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        customer: true,
        payments: { where: { voidedAt: null }, include: { method: true }, orderBy: [{ seq: 'asc' }, { id: 'asc' }] }
      }
    })
    if (!inv) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد. فهرست فاکتورها را تازه کنید.')

    const issuedAt = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
    /** نشست ۱۶۴ · Y22 · بند ۴-۵۲ — علامت «این چک نیاز به بازبینی دارد» */
    const reviewNotes = await chequeReviewNotes(prisma, inv.payments as any[])
    const rows = inv.payments.map((p: any) => {
      const row = shapePaymentRow(p)
      const note = reviewNotes.get(p.id)
      return note ? { ...row, chequeNeedsReview: true, chequeReviewNote: note } : row
    })
    const paidTotal = receivedTotalOf(inv.payments as any[])
    const grandTotal = toNumberRial(inv.grandTotal) // نشست ۱۸۱: BigInt ⇒ number
    // نشست ۵۸ · C2 — بدهی واحد (برگشت + بازپرداخت)
    const debt = await invoiceRemaining(prisma, inv.id, grandTotal, paidTotal)
    const state = debt.state
    const overpayBacking = await overpayCreditBacking(prisma as any, inv.id)

    return {
      invoiceId: inv.id,
      receiptNo: inv.receiptNo,
      dateJalali: inv.issuedAtJalali || toJalaliDate(issuedAt),
      time: toClock(issuedAt),
      customerName: inv.customer?.name ?? 'مشتری عمومی',
      orderTypeLabel: ORDER_TYPE_LABELS[inv.orderType] ?? inv.orderType,
      grandTotal,
      paidTotal,
      remaining: debt.remaining,
      pendingChequeTotal: pendingChequeTotalOf(inv.payments as any[]),
      chequeReviewCount: reviewNotes.size,
      settlementState: state,
      settlementLabel: SETTLEMENT_STATE_LABELS[state],
      settled: state === 'SETTLED',
      settledAtJalali: inv.settledAtJalali ?? null,
      consolidated: inv.consolidationId != null,
      // بخش ۸ و ۶: جمع مبلغ اضافه‌ی دریافتی و جمع اعتبار مصرف‌شده روی این فاکتور
      overpayTotal: rows.reduce((sum, r) => sum + r.overpayAmount, 0),
      /**
       * نشست ۶۲ — دکمه‌ی «صدور اعتبار از اضافه‌دریافت» (بند ۴-۵۵). همان
       * پشتوانه‌ای که سرور موقع صدور می‌سنجد (پول واقعی − اعتبارهای قبلی)، تا
       * دکمه هیچ‌وقت مبلغی پیشنهاد ندهد که سرور ردش کند.
       */
      overpayCreditAvailable: overpayBacking.available,
      overpayCreditIssued: overpayBacking.committed,
      storeCreditTotal: rows.reduce((sum, r) => sum + (r.isStoreCredit ? r.amount : 0), 0),
      payments: rows
    }
  },

  /**
   * زنجیره‌ی امنِ تسویه با اعتبار خرید، فقط برای کلیک از گزارش فروش.
   *
   * این یک DTO مالی/audit است، نه `StoreCredit.detail`: هیچ code/legacyCode،
   * مشخصات دارنده، note، reference آزادانه یا payload لاگ را بازنمی‌گرداند.
   * دفتر `StoreCreditRedemption` منبع اصلی است؛ Paymentهای تاریخی که دفتر ندارند
   * فقط با همان شناسهٔ داخلی و مرجع امن به‌عنوان fallback نشان داده می‌شوند.
   */
  async creditSettlementLineage(input: { invoiceId?: number } = {}): Promise<CreditSettlementLineageView> {
    const invoiceId = assertSafeInteger(input?.invoiceId, 'شناسه فاکتور', 1)
    const invoice = await prisma.saleInvoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, receiptNo: true }
    })
    if (!invoice) throw new BusinessError('فاکتور برای نمایش زنجیرهٔ اعتبار پیدا نشد؛ گزارش را تازه کنید.')

    const [redemptions, creditPayments] = await Promise.all([
      prisma.storeCreditRedemption.findMany({
        where: { invoiceId: invoice.id, reversedAt: null },
        select: { id: true, creditId: true, paymentId: true, amount: true, at: true, atJalali: true, atTime: true }
      }),
      prisma.payment.findMany({
        where: { invoiceId: invoice.id, voidedAt: null, storeCreditId: { not: null } },
        select: { id: true, seq: true, storeCreditId: true, amount: true, paidAt: true, paidAtJalali: true, paidAtTime: true }
      })
    ])
    const creditIds = [...new Set([
      ...redemptions.map((row) => Number(row.creditId)).filter((id) => Number.isSafeInteger(id) && id > 0),
      ...creditPayments.map((row) => Number(row.storeCreditId)).filter((id) => Number.isSafeInteger(id) && id > 0)
    ])]
    const credits = creditIds.length
      ? await prisma.storeCredit.findMany({
          where: { id: { in: creditIds } },
          select: {
            id: true,
            amount: true,
            usedAmount: true,
            usedCount: true,
            maxUses: true,
            multiUse: true,
            status: true,
            expiresAt: true,
            expiresAtJalali: true,
            issuedAt: true,
            issuedAtJalali: true,
            source: true,
            returnId: true,
            exchangeInvoiceId: true
          }
        })
      : []
    const creditById = new Map(credits.map((row) => [Number(row.id), row]))
    const paymentById = new Map(creditPayments.map((row) => [Number(row.id), row]))
    const creditDto = (credit: any) => {
      const status = effectiveStatus({
        amount: toNumberRial(credit.amount),
        usedAmount: toNumberRial(credit.usedAmount),
        usedCount: Number(credit.usedCount ?? 0),
        maxUses: Number(credit.maxUses ?? 1),
        multiUse: credit.multiUse === true,
        status: String(credit.status ?? 'ACTIVE'),
        expiresAt: credit.expiresAt ?? null
      })
      const expiresAt = credit.expiresAt ? new Date(credit.expiresAt) : null
      const issuedAt = credit.issuedAt ? new Date(credit.issuedAt) : new Date()
      return {
        id: Number(credit.id),
        publicReference: `اعتبار #${Number(credit.id)}`,
        issuedAtJalali: credit.issuedAtJalali || toJalaliDate(issuedAt),
        expiresAtJalali: credit.expiresAtJalali ?? (expiresAt ? toJalaliDate(expiresAt) : null),
        sourceLabel: CREDIT_ISSUE_REASON_LABELS[creditIssueReasonOf(credit)],
        status,
        statusLabel: CREDIT_STATUS_LABELS[status] ?? status,
        remaining: creditRemainingOf({ amount: toNumberRial(credit.amount), usedAmount: toNumberRial(credit.usedAmount) })
      }
    }
    const rows: CreditSettlementLineageView['rows'] = []
    const paymentIdsInLedger = new Set<number>()
    for (const redemption of redemptions) {
      const credit = creditById.get(Number(redemption.creditId))
      if (!credit) continue // اعتبار حذف دائمیِ legacy؛ هیچ داده‌ی جایگزین حدسی نساز.
      const payment = redemption.paymentId == null ? null : paymentById.get(Number(redemption.paymentId)) ?? null
      if (payment) paymentIdsInLedger.add(Number(payment.id))
      const at = redemption.at instanceof Date ? redemption.at : new Date(redemption.at)
      rows.push({
        redemptionId: Number(redemption.id),
        paymentId: payment ? Number(payment.id) : (redemption.paymentId == null ? null : Number(redemption.paymentId)),
        paymentSeq: payment ? Number(payment.seq ?? 1) : null,
        amount: toNumberRial(redemption.amount),
        redeemedAtJalali: redemption.atJalali || toJalaliDate(at),
        redeemedAtTime: redemption.atTime || toClock(at),
        credit: creditDto(credit)
      })
    }
    /** دادهٔ قدیمیِ Payment.storeCreditId که دفتر redemption ندارد؛ فقط ردیف امن fallback. */
    for (const payment of creditPayments) {
      if (paymentIdsInLedger.has(Number(payment.id))) continue
      const credit = payment.storeCreditId == null ? null : creditById.get(Number(payment.storeCreditId))
      if (!credit) continue
      const at = payment.paidAt instanceof Date ? payment.paidAt : new Date(payment.paidAt)
      rows.push({
        redemptionId: null,
        paymentId: Number(payment.id),
        paymentSeq: Number(payment.seq ?? 1),
        amount: toNumberRial(payment.amount),
        redeemedAtJalali: payment.paidAtJalali || toJalaliDate(at),
        redeemedAtTime: payment.paidAtTime || toClock(at),
        credit: creditDto(credit)
      })
    }
    rows.sort((a, b) => `${a.redeemedAtJalali} ${a.redeemedAtTime}`.localeCompare(`${b.redeemedAtJalali} ${b.redeemedAtTime}`) || (a.paymentId ?? 0) - (b.paymentId ?? 0))
    return {
      invoiceId: invoice.id,
      receiptNo: invoice.receiptNo,
      totalAmount: rows.reduce((sum, row) => sum + row.amount, 0),
      rows
    }
  },

  /**
   * -------------------------------------------------------------------------
   * ثبت یک پرداختی جدید روی فاکتور (پرداختی دوم، سوم، ...).
   *
   * مثال کار روزانه: فاکتور ۲۰ میلیونی با پرداختی اول ۵ میلیون صادر شده؛ یک ماه
   * بعد مشتری ۶ میلیون می‌آورد. کاربر از فهرست «فاکتورهای عمده» همان فاکتور را
   * باز می‌کند و همین‌جا ۶ میلیون را ثبت می‌کند: یک رکورد جدید با تاریخ و ساعت
   * *همان لحظه* ساخته می‌شود و باقی‌مانده ۹ میلیون می‌شود.
   *
   * نوع «چک»: مبلغ چک، سررسید، شماره چک و بانک ثبت می‌شود و وضعیتش «در جریان»
   * است — پس باقی‌مانده‌ی فاکتور را کم نمی‌کند تا روزی که چک پاس شود.
   *
   * ⚠️ فاکتوری که در «تجمیع و انتقال» قطعی شده هم می‌تواند پرداختی جدید بگیرد:
   * تجمیع، *کسر انبار* را قطعی می‌کند و به دریافت پول مشتری کاری ندارد.
   * -------------------------------------------------------------------------
   */
  async addPayment(input: AddInvoicePaymentInput) {
    const invoiceId = assertSafeInteger(input?.invoiceId, 'شناسه فاکتور', 1)
    const amount = assertSafeInteger(input?.amount, 'مبلغ پرداختی', 1)
    const isCheque = input?.kind === 'CHEQUE'
    const idempotencyKey = String(input?.idempotencyKey ?? '').trim() || null
    if (idempotencyKey && idempotencyKey.length > 200)
      throw new BusinessError('کلید تکرارنشدن ثبت پرداخت بیش از ۲۰۰ نویسه است؛ درخواست را با کلید کوتاه تازه تکرار کنید.')
    const idempotencyFingerprint = idempotencyKey ? paymentAddFingerprint(input, invoiceId, amount, isCheque) : null
    /**
     * قبل از هر گیتِ رمز/دوره، retry را برگردان: تراکنش اول ممکن است commit شده
     * باشد ولی پاسخ در مسیر IPC از بین رفته باشد. تکرار نباید نه پول دوم بسازد و
     * نه حتی شمارنده‌ی تلاش رمز مدیر را بی‌دلیل تغییر دهد.
     */
    if (idempotencyKey && idempotencyFingerprint) {
      const replay = await replayPaymentAdd(idempotencyKey, idempotencyFingerprint)
      if (replay) return replay
    }
    /** نشست ۱۴۲ (S142) — methodId اعشاری/منفی دیگر بی‌سنجش به Prisma نمی‌رسد */
    if (!isCheque && input?.methodId != null) assertSafeInteger(input.methodId, 'شناسه روش پرداخت', 1)

    if (isCheque && !input?.dueDateJalali)
      throw new BusinessError('برای ثبت چک، تاریخ سررسید (موعد) چک را وارد کنید.')
    if (isCheque && input?.destination != null && String(input.destination).trim() !== '')
      throw new BusinessError(
        'چک هنگام ثبت هنوز پول دریافت‌شده نیست و مقصد نقد/کارت ندارد؛ پس از پاس‌شدن فقط به حساب مدیر/بانک نسبت داده می‌شود.'
      )

    /** نشست ۶۲ (S62-2) — رمز سقف اعتبار، بیرون از تراکنش */
    const overpayManagerApproved =
      input?.overpayAsCredit === true
        ? await preverifyOverpayManager(input, 'صدور اعتبار از اضافه‌دریافت (بالاتر از سقف اعتبار)')
        : false

    /** نشست ۱۳۶ (S136-2) — پرداخت با تاریخ روزِ بسته، رمز مدیر + دلیل (بیرون از تراکنش) */
    const periodGate: PaymentPeriodGate = {
      managerPassword: (input as any)?.managerPassword ?? null,
      overrideReason: (input as any)?.overrideReason ?? null
    }
    const addMoments = paymentPeriodMoments([
      input?.paidAtJalali ? parseJalaliOrThrow(String(input.paidAtJalali), 'تاریخ پرداختی') : null
    ])
    const addWhat = 'ثبت پرداختی با تاریخ دوره‌ی بسته'
    const addPeriodApproved = await preverifyPaymentPeriods(addMoments, addWhat, periodGate)

    try {
      return await prisma.$transaction(async (tx) => {
      const inv = await tx.saleInvoice.findUnique({
        where: { id: invoiceId },
        select: { id: true, receiptNo: true, grandTotal: true, status: true, voidedAt: true }
      })
      if (!inv) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد.')
      /**
       * نشست ۲۱۲ — پرداخت روی فاکتور لغو/باطل/پیش‌نویس نقد صندوق را بی‌توضیح
       * زیاد می‌کند و کسری فروشنده را پنهان می‌کند. همان دیوار برگشت (بند ۴-۲۰).
       */
      if (inv.voidedAt != null || !isReturnableStatus(inv.status))
        throw new BusinessError(
          `فاکتور شماره ${faDigits(inv.receiptNo)} ` +
            (inv.voidedAt != null || inv.status === SaleStatus.CANCELED
              ? 'لغو یا باطل شده است'
              : 'هنوز پیش‌نویس است و نهایی نشده') +
            '؛ روی آن پرداختی ثبت نمی‌شود.'
        )
      await assertPaymentPeriodsOpen(tx, addMoments, {
        ...periodGate,
        what: addWhat,
        entityId: 0,
        userId: input.userId ?? null,
        managerVerified: addPeriodApproved,
        before: { invoiceId, receiptNo: inv.receiptNo },
        after: { amount, kind: isCheque ? 'CHEQUE' : 'CASH', paidAtJalali: input?.paidAtJalali ?? null }
      })

      // لحظه‌ی ثبت پرداختی: پیش‌فرض «همین حالا»؛ تاریخ دستی هم پذیرفته می‌شود
      // (مثلاً پولی که دیروز گرفته شده و امروز ثبت می‌گردد).
      const now = new Date()
      const createdShiftId = await currentPaymentShiftId(tx, input.userId ?? null, (input as any).custodyFence ?? null)
      /**
       * نشست ۱۸۹ · ۱-۷ · بند ۴-۵۱ — ساعت پرداخت داخل خودِ `paidAt` می‌نشیند،
       * نه فقط رشته‌ی جدا. قبلاً با تاریخ دستی، `paidAt` ظهر/الان می‌شد و ساعت
       * فقط در `paidAtTime` می‌ماند.
       */
      const rawPaidTime = toLatinDigits(String(input?.paidAtTime ?? '')).trim()
      const paidAt = input?.paidAtJalali
        ? jalaliAtClock(String(input.paidAtJalali), rawPaidTime || null)
        : now

      const last = await tx.payment.findFirst({
        where: { invoiceId },
        orderBy: { seq: 'desc' },
        select: { seq: true }
      })
      const seq = (last?.seq ?? 0) + 1

      const methodId = isCheque
        ? await chequeMethodId(tx)
        : Number(input?.methodId ?? 0) || (await tx.paymentMethod.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }))?.id

      if (!methodId) throw new BusinessError('روش پرداخت پیدا نشد؛ از پنل تنظیمات یک روش پرداخت فعال کنید.')
      if (!isCheque) await assertPaymentMethodExists(tx, methodId)

      /**
       * ================= کار الف (جلسه ۳۶): مقصد پول =================
       * برای هر پرداختیِ *دریافت‌شده* اجباری و بدون پیش‌فرض است.
       *
       * چکِ تازه‌ثبت‌شده استثناست و عمداً مقصد نمی‌گیرد: چکِ «در جریان» هنوز پولی
       * نیست، پس هنوز جایی ننشسته. مقصدش دقیقاً لحظه‌ی «پاس شد» پرسیده می‌شود
       * (`setChequeStatus`) و اگر از «پاس شد» برگردد پاک می‌گردد.
       */
      const destination = isCheque
        ? null
        : assertDestination(input?.destination, await methodKindOf(tx, methodId), 'PAYMENT')

      const dueDate = isCheque ? parseJalaliOrThrow(String(input.dueDateJalali), 'تاریخ سررسید چک') : null

      const paidAtTime = toClock(paidAt)

      /**
       * ===================== بخش ۸ — «مبلغ اضافه‌ی دریافتی» =====================
       * اگر مبلغ واردشده از باقی‌ماندهٔ بدهی *در همین لحظه* بیشتر باشد:
       *   ۱) بدون تایید آگاهانه، یک هشدار فارسی برمی‌گردد (دو دکمه‌ی «بله ثبت
       *      کن / انصراف» در UI) — دیوار نیست، هشدار است.
       *   ۲) با تایید (`confirmOverpay`)، **کل مبلغ واردشده** ثبت می‌شود، نه
       *      سقف بدهی؛ و مقدار اضافه همان لحظه حساب و روی همان رکورد در
       *      `overpayAmount` ذخیره می‌گردد تا گزارش فاکتور جدا نمایشش دهد.
       *
       * چرا ذخیره و نه محاسبه‌ی لحظه‌ی نمایش؟ چون «باقی‌ماندهٔ قبل از این
       * پرداختی» بعداً با ویرایش مبالغ فاکتور یا حذف پرداختی‌های دیگر عوض می‌شود
       * و عدد بازمحاسبه‌شده دیگر حقیقت آن روز نیست.
       *
       * چک استثناست: چکِ ثبت‌شده تا پاس نشدن پول دریافت‌شده نیست، پس «اضافه
       * دریافتی» هم معنا ندارد.
       */
      const priorRows = await tx.payment.findMany({
        // ممیزی A88-03 — پرداخت باطل «دریافت‌شده تا الان» نیست (قبلاً هشدار اضافه‌دریافت کاذب می‌داد)
        where: { invoiceId, voidedAt: null },
        select: { amount: true, kind: true, chequeStatus: true }
      })
      const grandTotalNow = toNumberRial(inv.grandTotal ?? 0)
      /**
       * نشست ۵۸ · C2 — همان بدهی واحد `remainingOf`، نه `grandTotal − paid`.
       * مثال بک‌لاگ: فاکتور ۱٬۰۰۰، پرداخت ۳۰۰، برگشت ۶۰۰ ⇒ فقط ۱۰۰ بدون هشدار.
       */
      const debtBefore = await invoiceRemaining(tx, invoiceId, grandTotalNow, receivedTotalOf(priorRows))
      const remainingBefore = debtBefore.remaining
      const overpayAmount = isCheque ? 0 : Math.max(0, amount - remainingBefore)
      if (overpayAmount > 0 && input?.confirmOverpay !== true)
        throw new BusinessError(
          `مبلغ واردشده (${money(amount)} ریال) از باقی‌ماندهٔ بدهی این فاکتور (${money(remainingBefore)} ریال) ` +
            `${money(overpayAmount)} ریال بیشتر است.\n` +
            `فاکتور شماره ${faDigits(inv.receiptNo)} · جمع کل ${money(grandTotalNow)} ریال` +
            (debtBefore.returnedValue > 0
              ? ` · برگشت‌خورده ${money(debtBefore.returnedValue)} ریال` +
                (debtBefore.refundFromReceived > 0 ? ` (بازپرداخت‌شده ${money(debtBefore.refundFromReceived)} ریال)` : '')
              : '') +
            ` · دریافت‌شده تا الان ${money(debtBefore.received)} ریال.\n` +
            'اگر آگاهانه می‌خواهید همین مبلغ کامل ثبت شود، «بله ثبت کن» را بزنید؛ مبلغ اضافه به‌صورت جدا در گزارش ' +
            'فاکتور نمایش داده می‌شود.'
        )

      /**
       * نشست ۶۱ · بند ۴-۳۵ مرحله ۲/۳ — «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟ بله».
       * فقط برای پول واقعی و فقط وقتی واقعاً مبلغ اضافه‌ای هست؛ هر درخواست دیگر
       * صریح رد می‌شود (نه نادیده‌گرفتن بی‌صدا).
       */
      const wantsOverpayCredit = input?.overpayAsCredit === true
      if (wantsOverpayCredit) {
        if (isCheque)
          throw new BusinessError(
            'برای چک نمی‌توان کد اعتبار اضافه‌دریافت صادر کرد: چک تا «پاس شد» پول دریافت‌شده نیست. ' +
              'بعد از پاس شدن چک، از بخش پرداخت‌های فاکتور «صدور اعتبار از اضافه‌دریافت» را بزنید.'
          )
        if (overpayAmount <= 0)
          throw new BusinessError(
            `این پرداخت (${money(amount)} ریال) از باقی‌ماندهٔ بدهی (${money(remainingBefore)} ریال) بیشتر نیست، ` +
              'پس مبلغ اضافه‌ای برای صدور اعتبار خرید وجود ندارد.'
          )
        const bucket = receiptBucketOf({ isCheque: false, destination, methodKind: await methodKindOf(tx, methodId) })
        if (bucket === 'exchangeCredit' || bucket === 'storeCredit')
          throw new BusinessError('مصرف اعتبار خرید پول واقعی نیست؛ از مبلغ اضافه‌ی آن اعتبار تازه صادر نمی‌شود.')
      }

      const created = await tx.payment.create({
        data: {
          invoiceId,
          methodId,
          amount,
          reference: input?.reference?.trim() || null,
          note: input?.note?.trim() || null,
          kind: isCheque ? PaymentEntryKind.CHEQUE : PaymentEntryKind.CASH,
          seq,
          idempotencyKey,
          idempotencyFingerprint,
          paidAt,
          createdAt: now,
          createdByUserId: input.userId ?? null,
          createdShiftId,
          paidAtJalali: toJalaliDate(paidAt),
          paidAtTime,
          // بخش ۸: مقدار اضافه، *در لحظه‌ی ثبت* حساب و ذخیره می‌شود
          overpayAmount,
          chequeNo: isCheque ? input?.chequeNo?.trim() || null : null,
          bankName: isCheque ? input?.bankName?.trim() || null : null,
          dueDate,
          dueDateJalali: dueDate ? toJalaliDate(dueDate) : null,
          chequeStatus: isCheque ? ChequeStatus.PENDING : null,
          // کار الف — مقصد پول (چکِ در جریان: null تا لحظه‌ی «پاس شد»)
          destination
        },
        include: { method: true }
      })

      const settle = await recalcSettlement(tx, invoiceId)

      /** نشست ۶۱ — مرحله ۳: صدور کد اعتبار در همان تراکنش (خطا ⇒ پرداخت هم ثبت نمی‌شود) */
      let overpayCredit: OverpayCreditResult | null = null
      if (wantsOverpayCredit) {
        const row = await tx.payment.findUnique({ where: { id: created.id }, select: { overpayAmount: true } })
        overpayCredit = await issueOverpayCreditTx(tx, {
          invoiceId,
          amount: Math.max(0, toNumberRial(row?.overpayAmount ?? overpayAmount)),
          paymentId: created.id,
          paymentSeq: seq,
          userId: input?.userId ?? null,
          managerApproved: overpayManagerApproved
        })
      }

      await audit(tx, {
        action: AuditAction.SALE_PAYMENT_ADD,
        entity: 'Payment',
        entityId: created.id,
        userId: input?.userId ?? null,
        after: JSON.stringify({
          invoiceId,
          receiptNo: inv.receiptNo,
          seq,
          kind: created.kind,
          amount,
          chequeNo: created.chequeNo,
          dueDateJalali: created.dueDateJalali,
          // کار الف — مقصد پول در سند حسابرسی
          destination,
          paidTotal: settle.paidTotal,
          // قرارداد فیش وصول نسیه: remaining همین پرداخت؛ فیش از همین JSON می‌خواند.
          remaining: settle.remaining
        }),
        note:
          (isCheque
            ? `ثبت چک ${money(amount)} ریال (سررسید ${faDigits(created.dueDateJalali ?? '—')}) روی فاکتور ${faDigits(inv.receiptNo)}`
            : `ثبت پرداختی ${faDigits(seq)} به مبلغ ${money(amount)} ریال روی فاکتور ${faDigits(inv.receiptNo)}` +
              ` · مقصد پول: ${paymentDestinationLabel(destination)}` +
              (destination === PaymentDestination.MANAGER
                ? ' (به صندوق و کارتخوان فروشگاه نیامده و در کسری/اضافی صندوق تأثیر ندارد)'
                : '')) +
          ` · باقی‌مانده ${money(settle.remaining)} ریال` +
          (settle.settled ? ' · فاکتور تسویه شد' : '')
      })

      return {
        payment: shapePaymentRow(created),
        ...settle,
        receiptNo: inv.receiptNo,
        /** پرداختی از باقی‌مانده بیشتر بود؟ (اضافه‌پرداخت — فقط هشدار) */
        overpaid: settle.paidTotal > settle.grandTotal,
        /** بخش ۸: مبلغ اضافه‌ی همین پرداختی (۰ = پرداختی عادی) */
        overpayAmount,
        remainingBefore,
        /** کار الف: مقصد ثبت‌شده‌ی پول (برای پیام تأیید پنل) */
        destination,
        /** نشست ۶۱ — مرجع امنِ اعتبار صادرشده از مبلغ اضافه (null = مرحله ۴: فقط ردیف دریافت پول اضافه) */
        overpayCredit: shapeOverpayCreditSafe(overpayCredit)
      }
      }, TX_OPTIONS)
    } catch (error: any) {
      /**
       * دو درخواستِ هم‌کلید ممکن است پیش از commit اول هم‌زمان وارد شوند. UNIQUE
       * دیتابیس دومی را می‌گیرد؛ حالا همان ردیف commit‌شده را برگردان، نه خطای
       * فنی و نه پرداخت دوم. تصادم seq با کلید متفاوت عمداً replay نمی‌شود.
       */
      if ((error?.code === 'P2002' || /unique constraint/i.test(String(error?.message ?? ''))) && idempotencyKey && idempotencyFingerprint) {
        const replay = await replayPaymentAdd(idempotencyKey, idempotencyFingerprint)
        if (replay) return replay
      }
      throw error
    }
  },

  /**
   * نشست ۶۱ · بند ۴-۵۵ — صدور اعتبار خرید از اضافه‌دریافتِ *موجود* یک فاکتور
   * (مثلاً اضافه‌دریافتی که بعد از برگشت جزئی پیدا شد، یا چکی که بعداً پاس شد).
   * همان فلو و همان سقف: فقط تا «اضافه‌دریافت واقعی − اعتبارهای قبلی».
   * `amount` خالی = کل مبلغ آزاد.
   */
  async overpayCreditIssue(input: {
    invoiceId?: number
    amount?: number | null
    userId?: number | null
    managerPassword?: string | null
  }): Promise<OverpayCreditSafeResult & { available: number }> {
    if (input?.invoiceId == null) throw new BusinessError('فاکتوری برای صدور اعتبار اضافه‌دریافت مشخص نشده است.')
    const invoiceId = assertSafeInteger(input.invoiceId, 'شناسه فاکتور', 1)
    /**
     * نشست ۱۴۲ (S142) — مبلغ اعتبار ورودی renderer دیگر با Math.round «اصلاح»
     * نمی‌شود (۱۰۰٫۴ ⇒ ۱۰۰)؛ خالی = کل مبلغ آزاد، هر مقدار دیگر باید عدد صحیح
     * مثبت امن باشد و پیش از تراکنش رد شود.
     */
    const requestedAmount =
      input?.amount == null || String(input.amount).trim() === ''
        ? null
        : assertSafeInteger(input.amount, 'مبلغ اعتبار اضافه‌دریافت', 1)
    /** نشست ۶۲ (S62-2) — رمز سقف اعتبار، بیرون از تراکنش */
    const managerApproved = await preverifyOverpayManager(input, 'صدور اعتبار از اضافه‌دریافت (بالاتر از سقف اعتبار)')
    return prisma.$transaction(async (tx) => {
      // اضافه‌دریافت از وضعیت فعلی فاکتور بازسازی می‌شود تا عدد کهنه پشتوانه نشود
      const settle = await recalcSettlement(tx, invoiceId, { userId: input?.userId ?? null })
      const inv = await tx.saleInvoice.findUnique({ where: { id: invoiceId }, select: { receiptNo: true } })
      await auditOverpayChanges(tx, settle, {
        invoiceId, receiptNo: inv?.receiptNo ?? 0, userId: input?.userId ?? null, why: 'درخواست صدور اعتبار اضافه‌دریافت'
      })
      const b = await overpayCreditBacking(tx, invoiceId)
      const amount = requestedAmount == null ? b.available : requestedAmount
      if (!(b.available > 0) && requestedAmount == null)
        throw new BusinessError(
          `فاکتور ${faDigits(inv?.receiptNo ?? invoiceId)} مبلغ اضافه‌ی دریافتیِ آزاد ندارد ` +
            `(اضافه‌دریافت واقعی ${money(b.realOverpay)} ریال، اعتبار صادرشده ${money(b.committed)} ریال).`
        )
      const res = await issueOverpayCreditTx(tx, {
        invoiceId, amount, userId: input?.userId ?? null, managerApproved
      })
      return { ...shapeOverpayCreditSafe(res)!, available: Math.max(0, b.available - res.amount) }
    }, TX_OPTIONS)
  },

  /**
   * ویرایش یک پرداختی/چک ثبت‌شده (مبلغ، تاریخ، مشخصات چک، توضیح).
   * فقط فیلدهای فرستاده‌شده عوض می‌شوند و بعدش باقی‌مانده و وضعیت تسویه
   * بازمحاسبه می‌گردد.
   */
  async updatePayment(input: UpdateInvoicePaymentInput) {
    if (input?.id == null) throw new BusinessError('پرداختی مشخص نشده است.')
    /**
     * نشست ۱۴۲ (S142) — شناسه، مبلغ و روش پرداخت پیش از هر lookup/side-effect
     * سخت سنجیده می‌شوند. قبلاً مبلغ با Math.round بی‌صدا عوض می‌شد
     * (۳۵۰٫۶ ⇒ ۳۵۱)، 1e20 و متن «۳۵۰» پذیرفته می‌شد و methodId ناموجود روی
     * پرداخت می‌نشست.
     */
    const id = assertSafeInteger(input.id, 'شناسه پرداختی', 1)
    if (input.amount != null) assertSafeInteger(input.amount, 'مبلغ پرداختی', 1)
    if (input.methodId != null) assertSafeInteger(input.methodId, 'شناسه روش پرداخت', 1)

    /**
     * نشست ۱۳۶ (S136-2) — فقط ویرایشِ *مالی* (مبلغ، روش، مقصد، تاریخ) گیت دوره‌ی
     * بسته می‌گیرد؛ اصلاح توضیح/شماره چک/سررسید عدد هیچ روزی را عوض نمی‌کند.
     * هم روز فعلی پرداخت (و روز پاس‌شدن چک) و هم روز مقصدِ تاریخ جدید سنجیده می‌شوند.
     */
    const pre = await prisma.payment.findUnique({
      where: { id },
      select: { amount: true, methodId: true, destination: true, paidAt: true, paidAtJalali: true, kind: true, chequeStatus: true, clearedAt: true, storeCreditId: true }
    })
    const periodGate: PaymentPeriodGate = {
      managerPassword: (input as any)?.managerPassword ?? null,
      overrideReason: (input as any)?.overrideReason ?? null
    }
    let updMoments: Date[] = []
    let needsOpenShiftPaymentPassword = false
    if (pre) {
      const preIsCheque = (pre.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
      const newPaidAt = input.paidAtJalali ? parseJalaliOrThrow(String(input.paidAtJalali), 'تاریخ پرداختی') : null
      const paidAtChanged = !!newPaidAt && toJalaliDate(newPaidAt) !== (pre.paidAtJalali ?? toJalaliDate(new Date(pre.paidAt as any)))
      const amountChanged = input.amount != null && input.amount !== Math.round(Number(pre.amount ?? 0))
      const methodChanged = !preIsCheque && input.methodId != null && Number(input.methodId) !== Number(pre.methodId)
      const destinationChanged = input.destination !== undefined && (input.destination ?? null) !== (pre.destination ?? null)
      /**
       * ممیزی A88-02 — ردیفِ مصرف اعتبار خرید را دفتر مصرف اعتبار (StoreCreditRedemption)
       * تعریف می‌کند؛ ویرایش مبلغ/روش/مقصد/تاریخ آن را از دفتر اعتبار جدا می‌کرد (مثلاً
       * ۳۰۰٬۰۰۰ اعتبار ⇒ ۵۰۰٬۰۰۰ «نقدی در کشو» = تبدیل اعتبار به نقد، خلاف بند ۴-۳۲).
       */
      if (pre.storeCreditId != null && (paidAtChanged || amountChanged || methodChanged || destinationChanged))
        throw new BusinessError(creditPaymentEditBlockedMessage(Math.round(Number(pre.amount ?? 0))))
      /**
       * نشست ۲۰۲ — ویرایش مالی چکِ پاس‌شده بدهی را عوض می‌کند؛ همان گیت strict
       * پاس/برگشت چک، بیرون از تراکنش. توضیح/شماره چک رمز نمی‌خواهد.
       */
      if (
        preIsCheque &&
        pre.chequeStatus === ChequeStatus.CLEARED &&
        (amountChanged || destinationChanged || paidAtChanged)
      )
        await assertPanelPasswordStrict(
          PANEL_KEYS.salesCredit,
          (input as any)?.managerPassword ?? null,
          'ویرایش چک پاس‌شده'
        )
      /**
       * نشست ۲۱۱ — پرداخت نقد/کارت: مبلغ، روش، مقصد یا تاریخ بدون رمز همان
       * دزدی صندوق است. بعد از گیت دوره‌ی بسته اجرا می‌شود تا پیام «دوره»
       * برای روز بسته بماند.
       */
      else if (!preIsCheque && (amountChanged || methodChanged || destinationChanged || paidAtChanged))
        needsOpenShiftPaymentPassword = true
      if (paidAtChanged || amountChanged || methodChanged || destinationChanged)
        updMoments = paymentPeriodMoments([
          pre.paidAt,
          preIsCheque && pre.chequeStatus === ChequeStatus.CLEARED ? pre.clearedAt : null,
          paidAtChanged ? newPaidAt : null
        ])
    }
    /** AUDIT-S136-02 — همان سنجش «ویرایش مالی» روی ردیف فعلی داخل تراکنش */
    const updFinancialOn = (row: any): boolean => {
      const rowIsCheque = (row.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
      const np = input.paidAtJalali ? parseJalaliOrThrow(String(input.paidAtJalali), 'تاریخ پرداختی') : null
      return (
        (!!np && toJalaliDate(np) !== (row.paidAtJalali ?? toJalaliDate(new Date(row.paidAt as any)))) ||
        (input.amount != null && input.amount !== Math.round(Number(row.amount ?? 0))) ||
        (!rowIsCheque && input.methodId != null && Number(input.methodId) !== Number(row.methodId)) ||
        (input.destination !== undefined && (input.destination ?? null) !== (row.destination ?? null))
      )
    }
    const updWhat = 'ویرایش مالی پرداختیِ دوره‌ی بسته'
    const updPeriodApproved = await preverifyPaymentPeriods(updMoments, updWhat, periodGate)
    if (needsOpenShiftPaymentPassword)
      await assertOpenShiftPaymentMutationPassword(input as any, 'ویرایش مالی پرداخت', { requireReason: true })

    return prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id }, include: { invoice: { select: { receiptNo: true } } } })
      if (!current) throw new BusinessError('این پرداختی پیدا نشد؛ فهرست را تازه کنید.')
      if (current.voidedAt) throw new BusinessError('این پرداختی قبلاً باطل شده است و قابل ویرایش نیست.')
      await assertPaymentPeriodsOpen(
        tx,
        updMoments.length || updFinancialOn(current)
          ? paymentPeriodMoments([
              ...updMoments,
              ...paymentRowMoments(current),
              input.paidAtJalali &&
              toLatinDigits(String(input.paidAtJalali)).trim() !==
                (current.paidAtJalali ?? toJalaliDate(new Date(current.paidAt as any)))
                ? parseJalaliOrThrow(String(input.paidAtJalali), 'تاریخ پرداختی')
                : null
            ])
          : [],
        {
        ...periodGate,
        what: updWhat,
        entityId: id,
        userId: input?.userId ?? null,
        managerVerified: updPeriodApproved,
        before: { amount: current.amount, paidAtJalali: current.paidAtJalali, destination: current.destination ?? null },
        after: { amount: input.amount ?? null, paidAtJalali: input.paidAtJalali ?? null, destination: input.destination ?? null }
      })

      const isCheque = (current.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
      /**
       * AUDIT-S142-01 (AUDIT-D73) — هم‌قاعده با A88-02، روی ردیف فعلی داخل تراکنش (D66): ردیفی که روشش
       * سیستمی اعتبار است (مصرف اعتبار خرید، یا «ارزش کالای برگشتی» سند تعویض که storeCreditId ندارد و از
       * گیت A88-02 رد می‌شد) ویرایش مالی نمی‌پذیرد. مثال قبل: ردیف ۵۰۰٬۰۰۰ EXCHANGE_CREDIT ⇒ ۹۰۰٬۰۰۰ «نقد در کشو».
       */
      if (updFinancialOn(current)) {
        const currentKind = await methodKindOf(tx, current.methodId)
        if (current.storeCreditId != null || currentKind === PaymentKind.STORE_CREDIT)
          throw new BusinessError(creditPaymentEditBlockedMessage(Math.round(Number(current.amount ?? 0))))
        if (currentKind === PaymentKind.EXCHANGE_CREDIT)
          throw new BusinessError(
            `این پرداختی ارزش کالای برگشتی سند تعویض است (${money(Math.round(Number(current.amount ?? 0)))} ریال) و مبلغ، روش، مقصد یا تاریخش قابل ویرایش نیست؛ ` +
              'این مبلغ پول نقد نیست و سند تعویض آن را تعیین می‌کند. برای اصلاح، سند تعویض را ابطال کنید. هیچ تغییری ذخیره نشد.'
          )
      }
      const data: any = {}

      // نشست ۱۴۲ — مبلغ و روش پرداخت بالاتر با assertSafeInteger سنجیده شده‌اند؛ اینجا گرد نمی‌شوند
      if (input.amount != null) data.amount = input.amount
      if (input.methodId != null && !isCheque) {
        await assertPaymentMethodExists(tx, input.methodId)
        data.methodId = input.methodId
      }
      /**
       * ============ کار الف (جلسه ۳۶): ویرایش «مقصد پول» ============
       * دو قاعده:
       *   ۱) اگر روش پرداخت عوض شود، مقصدِ فعلی ممکن است دیگر سازگار نباشد
       *      (مثلاً روش از «کارت» به «نقدی» برود ولی مقصد «کارت» بماند). پس
       *      هرجا روش عوض می‌شود، مقصد با روشِ *جدید* اعتبارسنجی می‌گردد.
       *   ۲) مقصدِ یک ردیف موجود هیچ‌وقت بی‌صدا پاک نمی‌شود؛ فقط با ارسال صریح
       *      یک مقصد معتبر عوض می‌شود.
       * روی چکِ پاس‌نشده مقصد معنا ندارد و رد می‌شود.
       */
      const wantsDestination = input.destination !== undefined
      const nextMethodId = data.methodId ?? current.methodId
      if (wantsDestination || data.methodId != null) {
        if (isCheque && current.chequeStatus !== ChequeStatus.CLEARED) {
          if (wantsDestination)
            throw new BusinessError(
              'چکِ پاس‌نشده هنوز پولی دریافت نکرده، پس مقصد پول ندارد. مقصد لحظه‌ی «پاس شد» پرسیده می‌شود.'
            )
        } else {
          const kindNow = await methodKindOf(tx, nextMethodId)
          const raw = wantsDestination ? input.destination : current.destination
          /**
           * ردیف *قدیمیِ* بی‌مقصد را یک ویرایشِ بی‌ربط (مثلاً اصلاح توضیح) مجبور
           * نمی‌کنیم مقصد بگیرد؛ فقط اگر روش پرداختش عوض شد، مقصد لازم می‌شود.
           */
          if (raw != null || data.methodId != null) data.destination = assertDestination(raw, kindNow, 'PAYMENT')
        }
      }
      if (input.reference !== undefined) data.reference = String(input.reference ?? '').trim() || null
      if (input.note !== undefined) data.note = String(input.note ?? '').trim() || null
      if (input.paidAtJalali) {
        const paidAt = parseJalaliOrThrow(String(input.paidAtJalali), 'تاریخ پرداختی')
        data.paidAt = paidAt
        data.paidAtJalali = toJalaliDate(paidAt)
      }
      if (isCheque) {
        if (input.chequeNo !== undefined) data.chequeNo = String(input.chequeNo ?? '').trim() || null
        if (input.bankName !== undefined) data.bankName = String(input.bankName ?? '').trim() || null
        if (input.dueDateJalali) {
          const dueDate = parseJalaliOrThrow(String(input.dueDateJalali), 'تاریخ سررسید چک')
          data.dueDate = dueDate
          data.dueDateJalali = toJalaliDate(dueDate)
        }
      }

      if (!Object.keys(data).length) throw new BusinessError('چیزی برای تغییر فرستاده نشده است.')

      await tx.payment.update({ where: { id }, data })
      const settle = await recalcSettlement(tx, current.invoiceId)
      // نشست ۵۸ · C3 — ردیف را *بعد از* بازسازی اضافه‌دریافت می‌خوانیم تا عدد پنل درست باشد
      const updated = await tx.payment.findUnique({ where: { id }, include: { method: true } })
      await auditOverpayChanges(tx, settle, {
        invoiceId: current.invoiceId, receiptNo: current.invoice?.receiptNo ?? 0, userId: input?.userId ?? null,
        why: `ویرایش پرداختی ${faDigits(current.seq ?? 1)}`
      })

      await audit(tx, {
        action: AuditAction.SALE_PAYMENT_UPDATE,
        entity: 'Payment',
        entityId: id,
        userId: input?.userId ?? null,
        before: JSON.stringify({
          amount: current.amount,
          methodId: current.methodId,
          paidAtJalali: current.paidAtJalali,
          chequeNo: current.chequeNo,
          dueDateJalali: current.dueDateJalali,
          // کار الف — مقصد قبلی، برای این‌که تغییرش در سند حسابرسی پیدا باشد
          destination: current.destination ?? null
        }),
        after: JSON.stringify({ ...data, paidTotal: settle.paidTotal, remaining: settle.remaining }),
        note:
          `ویرایش پرداختی ${faDigits(current.seq ?? 1)} فاکتور ${faDigits(current.invoice?.receiptNo ?? 0)}` +
          (data.destination && data.destination !== current.destination
            ? ` · مقصد پول: ${paymentDestinationLabel(current.destination)} ⇒ ${paymentDestinationLabel(data.destination)}`
            : '') +
          ` · باقی‌مانده ${money(settle.remaining)} ریال`
      })

      return { payment: shapePaymentRow(updated), ...settle }
    }, TX_OPTIONS)
  },

  /**
   * حذف یک پرداختی/چک ثبت‌شده (اشتباه ثبت شده بود).
   * بعد از حذف، باقی‌مانده و علامت «تسویه‌شده» بازمحاسبه می‌شوند — پس اگر فاکتور
   * قبلاً تسویه‌شده بود، دوباره «نسیه» علامت می‌خورد.
   */
  async deletePayment(
    input: {
      id?: number
      userId?: number | null
      reason?: string | null
      managerPassword?: string | null
      overrideReason?: string | null
    } = {}
  ) {
    if (input?.id == null) throw new BusinessError('پرداختی مشخص نشده است.')
    /** نشست ۱۴۲ (S142) — شناسه‌ی اعشاری/منفی با پیام روشن رد می‌شود، نه «پیدا نشد» */
    const id = assertSafeInteger(input.id, 'شناسه پرداختی', 1)

    /**
     * نشست ۱۳۶ (S136-2) — ابطال پرداختِ روز بسته نقد مورد انتظار همان روز را کم
     * می‌کند و می‌تواند کسری صندوق بسته را پنهان کند ⇒ رمز مدیر + دلیل.
     */
    const pre = await prisma.payment.findUnique({
      where: { id },
      select: { paidAt: true, kind: true, chequeStatus: true, clearedAt: true, voidedAt: true }
    })
    /**
     * نشست ۲۰۲ — ابطال چکِ پاس‌شده همان اثر «برگشت از پاس» را روی بدهی دارد.
     * بدون این گیت، گیت نشست ۲۰۰ با دکمه‌ی حذف دور زده می‌شد. بیرون از تراکنش.
     */
    if (
      pre &&
      (pre.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE &&
      pre.chequeStatus === ChequeStatus.CLEARED
    )
      await assertPanelPasswordStrict(
        PANEL_KEYS.salesCredit,
        input.managerPassword ?? null,
        'ابطال چک پاس‌شده'
      )
    const periodGate: PaymentPeriodGate = { managerPassword: input.managerPassword ?? null, overrideReason: input.overrideReason ?? null }
    const delMoments = pre
      ? paymentPeriodMoments([
          pre.paidAt,
          (pre.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE && pre.chequeStatus === ChequeStatus.CLEARED
            ? pre.clearedAt
            : null
        ])
      : []
    const delWhat = 'ابطال پرداختیِ دوره‌ی بسته'
    const delPeriodApproved = await preverifyPaymentPeriods(delMoments, delWhat, periodGate)
    /**
     * نشست ۲۱۱ — ابطال پرداخت نقد/کارت بدون رمز کشو را خالی می‌کند.
     * بعد از گیت دوره‌ی بسته تا پیام «دوره» برای روز بسته بماند.
     * چک در جریان رمز نمی‌خواهد (رگرسیون ۲۰۲).
     */
    if (pre && !pre.voidedAt && (pre.kind ?? PaymentEntryKind.CASH) !== PaymentEntryKind.CHEQUE)
      await assertOpenShiftPaymentMutationPassword(input, 'ابطال پرداخت', { requireReason: true })

    return prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id }, include: { invoice: { select: { receiptNo: true } } } })
      if (!current) throw new BusinessError('این پرداختی پیدا نشد؛ ممکن است قبلاً حذف شده باشد.')
      if (current.voidedAt) throw new BusinessError(`پرداختی ${faDigits(current.seq ?? 1)} قبلاً باطل شده است و دوباره قابل ابطال نیست.`)
      await assertPaymentPeriodsOpen(tx, paymentPeriodMoments([...delMoments, ...paymentRowMoments(current)]), {
        ...periodGate,
        what: delWhat,
        entityId: id,
        userId: input.userId ?? null,
        managerVerified: delPeriodApproved,
        before: { invoiceId: current.invoiceId, amount: current.amount, paidAtJalali: current.paidAtJalali },
        after: { voided: true, reason: input.reason ?? null }
      })

      /**
       * AUDIT-S142-03 (AUDIT-D73) — «ارزش کالای برگشتی» (EXCHANGE_CREDIT) جزء گراف سند تعویض است (S60-2 / بند ۴-۲۲)
       * و پول نقد نیست. ابطال جدایش فاکتور تعویض ۵۰۰٬۰۰۰ را بدهکار می‌کرد در حالی که ارزش کالای برگشتی هنوز
       * «برگشت» شمرده می‌شد (بدهی کاذب ۵۰۰٬۰۰۰ برای کالایی که با کالای برگشتی تسویه شده). اصلاح فقط با ابطال سند تعویض.
       */
      if ((await methodKindOf(tx, current.methodId)) === PaymentKind.EXCHANGE_CREDIT)
        throw new BusinessError(
          `پرداختی ${faDigits(current.seq ?? 1)} (${money(Math.round(Number(current.amount ?? 0)))} ریال) ارزش کالای برگشتی سند تعویض است و جدا باطل نمی‌شود؛ ` +
            'این مبلغ پول نقد نیست و ابطال جدایش بدهی کاذب می‌سازد. برای اصلاح، سند تعویض را ابطال کنید. هیچ تغییری ذخیره نشد.'
        )

      const reason = String(input.reason ?? '').trim() || `ابطال پرداختی ${faDigits(current.seq ?? 1)}`
      const voidedAt = new Date()

      /**
       * ممیزی A88-02 — ابطال ردیفِ مصرف اعتبار خرید باید همان مصرف را در دفتر اعتبار
       * برگرداند (usedAmount/usedCount/وضعیت با planRedemptionReversal + Audit)، در همین
       * تراکنش. قبلاً فقط Payment باطل می‌شد ⇒ مشتری بدهکار و اعتبارش «مصرف‌شده»،
       * و سقف بازپرداخت برگشت (دریافتی − مصرف اعتبار) به‌اندازه‌ی مصرف باطل کم می‌شد.
       * نبودِ ردیف دفتر مصرف (داده‌ی خراب/قدیمی) ⇒ رد کامل، نه ابطال نیمه‌کاره.
       */
      let reversedCredit = 0
      if (current.storeCreditId != null) {
        let reds = await tx.storeCreditRedemption.findMany({
          where: { paymentId: id, reversedAt: null },
          select: { id: true }
        })
        if (!reds.length) {
          // داده‌ی قبل از ستون paymentId: فقط وقتی دقیقاً یک مصرفِ هم‌اعتبار/هم‌مبلغِ بی‌پرداخت روی همین فاکتور هست
          const legacy = await tx.storeCreditRedemption.findMany({
            where: { invoiceId: current.invoiceId, creditId: current.storeCreditId, paymentId: null, reversedAt: null, amount: current.amount },
            select: { id: true }
          })
          if (legacy.length === 1) reds = legacy
        }
        if (!reds.length)
          throw new BusinessError(
            `پرداختی ${faDigits(current.seq ?? 1)} (${money(Math.round(Number(current.amount ?? 0)))} ریال) مصرف اعتبار خرید است، ` +
              'ولی ردیف متناظرش در دفتر مصرف اعتبار پیدا نشد (یا قبلاً برگشت خورده). ' +
              'ابطال انجام نشد تا دفتر اعتبار و پرداخت‌های فاکتور از هم جدا نشوند؛ موضوع را به مدیر اطلاع دهید.'
          )
        reversedCredit = await reverseInvoiceRedemptions(tx, {
          invoiceId: current.invoiceId,
          redemptionIds: reds.map((r: any) => r.id),
          reason: `ابطال پرداختی ${faDigits(current.seq ?? 1)} فاکتور ${faDigits(current.invoice?.receiptNo ?? 0)} · ${reason}`,
          userId: input.userId ?? null
        })
      }

      await tx.payment.update({
        where: { id },
        data: { voidedAt, voidedByUserId: input.userId ?? null, voidReason: reason }
      })
      const settle = await recalcSettlement(tx, current.invoiceId)
      await auditOverpayChanges(tx, settle, {
        invoiceId: current.invoiceId, receiptNo: current.invoice?.receiptNo ?? 0, userId: input?.userId ?? null,
        why: `ابطال پرداختی ${faDigits(current.seq ?? 1)}`
      })

      await audit(tx, {
        action: AuditAction.SALE_PAYMENT_DELETE,
        entity: 'Payment',
        entityId: id,
        userId: input?.userId ?? null,
        before: JSON.stringify({
          invoiceId: current.invoiceId,
          receiptNo: current.invoice?.receiptNo ?? null,
          seq: current.seq,
          kind: current.kind,
          amount: current.amount,
          chequeNo: current.chequeNo,
          /**
           * کار الف — مقصدی که با حذف ردیف پاک شد. حذف پرداختی دقیقاً مثل
           * برگشتن چک از «پاس شد» عمل می‌کند: مقصد هم با خودِ ردیف می‌رود و
           * چیزی برای «حدس زدن» باقی نمی‌ماند.
           */
          destination: current.destination ?? null
        }),
        note:
          `ابطال پرداختی ${faDigits(current.seq ?? 1)} فاکتور ${faDigits(current.invoice?.receiptNo ?? 0)}` +
          (current.destination ? ` · مقصد ثبت‌شده «${paymentDestinationLabel(current.destination)}» هم پاک شد` : '') +
          (reversedCredit ? ' · مصرف اعتبار خرید همین پرداخت برگشت خورد (اعتبار دوباره قابل مصرف)' : '') +
          ` · دلیل: ${reason}` +
          ` · باقی‌مانده ${money(settle.remaining)} ریال`
      })
      await audit(tx, {
        action: AuditAction.VOID,
        entity: 'Payment',
        entityId: id,
        userId: input.userId ?? null,
        before: JSON.stringify({ invoiceId: current.invoiceId, amount: current.amount, seq: current.seq }),
        after: JSON.stringify({ voidedAt, voidedByUserId: input.userId ?? null, voidReason: reason }),
        note: `پرداختی ${faDigits(current.seq ?? 1)} باطل شد · دلیل: ${reason}`
      })

      return { id, invoiceId: current.invoiceId, voided: true, voidedAt, reason, reversedCreditRedemptions: reversedCredit, ...settle }
    }, TX_OPTIONS)
  },

  /**
   * -------------------------------------------------------------------------
   * تغییر وضعیت یک چک: «پاس شد» / «برگشت خورد» / «در جریان».
   *
   * لحظه‌ای که چک پاس می‌شود، مبلغش *مثل یک پرداخت نقدی* به جمع پرداختی‌های
   * فاکتور اضافه می‌گردد، باقی‌مانده به‌روز می‌شود، و اگر باقی‌مانده صفر شد
   * فاکتور خودکار «تسویه‌شده» علامت می‌خورد. برگشت زدنِ همین کار (پاس شد →
   * در جریان) هم پشتیبانی می‌شود و همه‌چیز دقیقاً برمی‌گردد.
   * -------------------------------------------------------------------------
   */
  async setChequeStatus(
    input: {
      id?: number
      status?: string
      clearedAtJalali?: string | null
      /**
       * کار الف (جلسه ۳۶) — «مقصد پول» چکِ پاس‌شده: CARD | CASH | MANAGER.
       * برای `status = CLEARED` **اجباری** است و پیش‌فرض ندارد. برای برگشتن به
       * «در جریان»/«برگشت خورد» نادیده گرفته و مقصد ثبت‌شده پاک می‌شود.
       */
      destination?: string | null
      userId?: number | null
      /** نشست ۲۰۰ — همیشه لازم (حتی دوره‌ی باز). نشست ۱۳۶ — همان رمز + دلیل برای دوره‌ی بسته */
      managerPassword?: string | null
      overrideReason?: string | null
    } = {}
  ) {
    if (input?.id == null) throw new BusinessError('چکی برای تغییر وضعیت مشخص نشده است.')
    /** نشست ۱۴۲ (S142) — شناسه‌ی اعشاری/منفی چک با پیام روشن رد می‌شود */
    const id = assertSafeInteger(input.id, 'شناسه چک', 1)
    const status = String(input?.status ?? '').toUpperCase()
    if (status !== ChequeStatus.PENDING && status !== ChequeStatus.CLEARED && status !== ChequeStatus.BOUNCED)
      throw new BusinessError('وضعیت چک معتبر نیست (پاس شد / برگشت خورد / در جریان).')

    /**
     * نشست ۲۰۰ — پاس/برگشت چک بدهی مشتری را عوض می‌کند. در دوره‌ی باز هم
     * بدون رمز ممنوع است (خوشه E / «حذف بدهی = گیت strict»). رمز مدیر یا
     * رمز دوم/سوم پنل نسیه؛ بیرون از تراکنش تا AuthLockout قفل SQLite نسازد.
     */
    await assertPanelPasswordStrict(
      PANEL_KEYS.salesCredit,
      input.managerPassword ?? null,
      'تغییر وضعیت چک'
    )

    /**
     * نشست ۱۳۶ (S136-2) — وجه چک در روز «پاس شدن» می‌نشیند. برگرداندن چکی که در
     * روز بسته پاس شده، یا پاس کردن با تاریخ دستیِ روز بسته، عدد آن روز را عوض
     * می‌کند ⇒ رمز مدیر + دلیل (بیرون از تراکنش) و Audit عبور از دوره‌ی بسته.
     */
    const manualClearedAt =
      status === ChequeStatus.CLEARED && input?.clearedAtJalali
        ? parseJalaliOrThrow(String(input.clearedAtJalali), 'تاریخ پاس شدن چک')
        : null
    const impliedClearedAt =
      status === ChequeStatus.CLEARED && !manualClearedAt ? new Date() : null
    const pre = await prisma.payment.findUnique({ where: { id }, select: { chequeStatus: true, clearedAt: true } })
    const chqMoments = paymentPeriodMoments([
      pre?.chequeStatus === ChequeStatus.CLEARED ? pre.clearedAt : null,
      manualClearedAt ?? impliedClearedAt
    ])
    const periodGate: PaymentPeriodGate = { managerPassword: input.managerPassword ?? null, overrideReason: input.overrideReason ?? null }
    const chqWhat = 'تغییر وضعیت چکِ دوره‌ی بسته'
    const chqPeriodApproved = await preverifyPaymentPeriods(chqMoments, chqWhat, periodGate)

    return prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id }, include: { invoice: { select: { receiptNo: true } } } })
      if (!current) throw new BusinessError('این چک پیدا نشد؛ فهرست را تازه کنید.')
      if (current.voidedAt) throw new BusinessError('این چک قبلاً باطل شده است و قابل تغییر نیست.')
      if ((current.kind ?? PaymentEntryKind.CASH) !== PaymentEntryKind.CHEQUE)
        throw new BusinessError('این ردیف چک نیست؛ فقط وضعیت چک قابل تغییر است.')
      await assertPaymentPeriodsOpen(tx, paymentPeriodMoments([...chqMoments, ...paymentRowMoments(current).slice(1)]), {
        ...periodGate,
        what: chqWhat,
        entityId: id,
        userId: input?.userId ?? null,
        managerVerified: chqPeriodApproved,
        before: { chequeStatus: current.chequeStatus, clearedAtJalali: current.clearedAtJalali ?? null },
        after: { chequeStatus: status, clearedAtJalali: input?.clearedAtJalali ?? null }
      })

      const cleared = status === ChequeStatus.CLEARED
      const clearedAt = cleared ? manualClearedAt ?? new Date() : null

      /**
       * ================= کار الف (جلسه ۳۶): مقصد پولِ چک =================
       * «پاس شد» ⇒ مقصد اجباری و فقط حساب مدیر/بانک. چک هرگز پولِ نقدِ کشو
       * یا دریافتیِ کارت‌خوان نیست.
       *
       * برگشتن از «پاس شد» به «در جریان» یا «برگشت خورد» ⇒ مقصد **پاک** می‌شود
       * (`null`). این عمدی و مهم است: بار بعد که چک پاس شود، دوباره پرسیده
       * می‌شود و مقصدِ کهنه بی‌صدا روی پول تازه نمی‌نشیند.
       */
      const destination = cleared
        ? assertDestination(input?.destination, await methodKindOf(tx, current.methodId), 'CHEQUE_CLEAR')
        : null
      const clearedShiftId = cleared ? await currentPaymentShiftId(tx, input.userId ?? null, (input as any).custodyFence ?? null) : null

      const updated = await tx.payment.update({
        where: { id },
        data: {
          chequeStatus: status,
          clearedAt,
          clearedAtJalali: clearedAt ? toJalaliDate(clearedAt) : null,
          clearedShiftId,
          // ممیزی A71-01 — مالک پاسِ *فعلی*؛ فیلتر کارمند گزارش روی همین است
          clearedByUserId: cleared ? input?.userId ?? null : null,
          destination
        },
        include: { method: true }
      })
      /**
       * نشست ۶۹ — وضعیت فعلی Payment برای query سریع باقی می‌ماند، اما
       * تاریخچه‌ی گذارها append-only است. بنابراین CLEARED → BOUNCED →
       * CLEARED مقدار clearedAt/destination قبلی را از بین نمی‌برد.
       */
      await tx.paymentChequeStatusHistory.create({
        data: {
          paymentId: id,
          status,
          destination,
          clearedAt,
          clearedAtJalali: clearedAt ? toJalaliDate(clearedAt) : null,
          clearedShiftId,
          userId: input?.userId ?? null,
          changedAt: new Date(),
          changedAtJalali: toJalaliDate(new Date())
        }
      })
      /**
       * نشست ۶۱ (S61-3) — برگشت خوردن چک یک واقعیت بیرونی است و رد نمی‌شود؛ اگر
       * اعتبار اضافه‌دریافتی را بی‌پشتوانه کند، «نیاز به رسیدگی مدیر» ثبت می‌شود.
       */
      const settle = await recalcSettlement(tx, current.invoiceId, {
        overpayCreditShortfall: 'flag', userId: input?.userId ?? null
      })
      await auditOverpayChanges(tx, settle, {
        invoiceId: current.invoiceId, receiptNo: current.invoice?.receiptNo ?? 0, userId: (input as any)?.userId ?? null,
        why: 'تغییر وضعیت چک'
      })

      await audit(tx, {
        action: AuditAction.CHEQUE_STATUS,
        entity: 'Payment',
        entityId: id,
        userId: input?.userId ?? null,
        before: JSON.stringify({ chequeStatus: current.chequeStatus, destination: current.destination ?? null }),
        after: JSON.stringify({
          chequeStatus: status,
          // کار الف — مقصد پول در سند حسابرسی (و پاک شدنش با برگشت از «پاس شد»)
          destination,
          paidTotal: settle.paidTotal,
          remaining: settle.remaining
        }),
        note:
          `چک ${money(current.amount)} ریال فاکتور ${faDigits(current.invoice?.receiptNo ?? 0)}: ` +
          `${CHEQUE_STATUS_LABELS[status] ?? status}` +
          (cleared
            ? ` · مقصد پول: ${paymentDestinationLabel(destination)}` +
              (destination === PaymentDestination.MANAGER
                ? ' (به صندوق و کارتخوان فروشگاه نیامده و در کسری/اضافی صندوق تأثیر ندارد)'
                : '') +
              ` · مبلغ چک به پرداختی‌های فاکتور اضافه شد · باقی‌مانده ${money(settle.remaining)} ریال`
            : current.destination
              ? ' · مقصد پولِ ثبت‌شده پاک شد (بار بعد که پاس شود دوباره پرسیده می‌شود)'
              : '') +
          (cleared && settle.settled ? ' · فاکتور تسویه شد' : '')
      })

      return {
        cheque: shapePaymentRow(updated),
        ...settle,
        receiptNo: current.invoice?.receiptNo ?? null,
        /** کار الف: مقصد ثبت‌شده (null = از «پاس شد» برگشت و مقصد پاک شد) */
        destination
      }
    }, TX_OPTIONS)
  },

  /**
   * فهرست چک‌های ثبت‌شده (تب «چک‌ها» پنل فاکتورهای عمده).
   *
   * `status`: PENDING (در جریان) · CLEARED (پاس‌شده) · BOUNCED · ALL/خالی = همه.
   * بازه‌ی تاریخ روی *سررسید* چک اعمال می‌شود، چون سوال روزانه‌ی فروشگاه این است
   * که «این هفته چه چکی موعدش می‌رسد».
   */
  async chequeList(
    filter: {
      status?: string
      fromJalali?: string
      toJalali?: string
      take?: number
      skip?: number
      /**
       * ---------------------- جلسه ۱۵ (بند ۹ سند مرجع) ----------------------
       * فیلترهای تکی/عمده، شیفت و فروشنده تا امروز روی فهرست چک اعمال نمی‌شدند؛
       * یعنی تب چک با بلوک چکِ سرجمع می‌توانست واگرا شود. حالا از *فاکتور مادر*
       * همان چک اعمال می‌شوند.
       */
      channels?: string[] | null
      shiftId?: number | null
      shiftNumber?: number | null
      userId?: number | null
      /** فیلترهای مشترک نوار گزارش روی فاکتور مادر چک اعمال می‌شوند. */
      orderType?: string | null
      receiptNo?: number | null
      customerSearch?: string | null
      productSearch?: string | null
      /**
       * بازه‌ی تاریخ روی کدام تاریخ بنشیند؟
       *   due     = سررسید (رفتار قبلی، پیش‌فرض دست‌نخورده)
       *   paid    = تاریخ ثبت چک  · cleared = تاریخ پاس‌شدن
       * قاعده‌ی بند ۲-۲: هر عدد با تاریخ خودش گزارش می‌شود.
       */
      dateMode?: 'due' | 'paid' | 'cleared' | null
    } = {}
  ): Promise<PagedRows<ChequeListRow>> {
    /**
     * خوشه F / ممیزی A96-01 (AUDIT-D24) / A99-04 (AUDIT-D29) — مالک روی خودِ رویداد چک
     * (ثبت ⇒ created*، «تاریخ پاس‌شدن» ⇒ cleared*)، هویت/نوع سفارش/«وضعیت» نوار روی فاکتور مادر.
     * همان where را شمارنده‌ی سقف (reportLimits) مصرف می‌کند.
     */
    const where = await chequeReportWhere(filter)
    const totalCount = await prisma.payment.count({ where })
    const page = reportPage(filter?.take, filter?.skip, 500, totalCount)
    const rows = await prisma.payment.findMany({
      where,
      include: {
        method: true,
        chequeStatusHistory: {
          orderBy: { id: 'asc' },
          select: {
            status: true,
            clearedAtJalali: true,
            changedAt: true,
            changedAtJalali: true
          }
        },
        invoice: {
          select: {
            id: true,
            receiptNo: true,
            issuedAtJalali: true,
            grandTotal: true,
            paidTotal: true,
            customer: { select: { name: true } }
          }
        }
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
      skip: page.skip,
      take: page.take
    })

    // نشست ۵۸ · C2 — «مانده‌ی فاکتور» چک هم از بدهی واحد می‌آید
    const debtAdj = await debtAdjustmentsByInvoice(prisma, rows.map((p) => p.invoiceId))
    /** نشست ۱۶۴ · Y22 · بند ۴-۵۲ — همان علامت بازبینی پنجره‌ی پرداختی‌ها */
    const reviewNotes = await chequeReviewNotes(prisma, rows as any[])
    const out = rows.map((p) => {
      const inv = p.invoice
      const grandTotal = toNumberRial(inv?.grandTotal ?? 0)
      const paidTotal = toNumberRial(inv?.paidTotal ?? 0)
      const debt = remainingOf({ grandTotal, received: paidTotal, ...adjustmentsOrEmpty(debtAdj, p.invoiceId) })
      return {
        ...shapePaymentRow(p),
        invoiceId: p.invoiceId,
        receiptNo: inv?.receiptNo ?? 0,
        invoiceDateJalali: inv?.issuedAtJalali ?? '—',
        customerName: inv?.customer?.name ?? 'مشتری عمومی',
        invoiceTotal: grandTotal,
        invoiceRemaining: debt.remaining,
        ...(reviewNotes.has(p.id) ? { chequeNeedsReview: true, chequeReviewNote: reviewNotes.get(p.id) } : {})
      }
    })
    return attachReportPage(out, page)
  },

  // =========================================================================
  // حذف گزارشات فروش یک بازه (پنل تنظیمات) با بازگشت اختیاری موجودی
  // =========================================================================

  /**
   * پیش‌نمایش: چه چیزی حذف می‌شود و در حالت «بله» چه تعدادی به انبار برمی‌گردد.
   *
   * `invoiceIds` (مورد ۱): فقط همان فاکتورهای تیک‌خورده‌ی جدول در نظر گرفته
   * می‌شوند — همان اعداد و همان جدول، ولی محدود به انتخاب کاربر.
   */
  async purgePreview(filter: {
    fromJalali?: string
    toJalali?: string
    invoiceIds?: number[] | null
  }): Promise<SalesPurgePreview> {
    const ids = normalizeInvoiceIds(filter.invoiceIds)
    let fromJalali = filter.fromJalali ?? jalaliToday()
    let toJalali = filter.toJalali ?? fromJalali
    /**
     * ممیزی A118-01 (AUDIT-D53) — در حالت انتخابی purge و purgeStockPlan فقط شناسه‌ها را می‌گیرند (بی‌تاریخ)، پس پیش‌نمایش
     * هم نباید بازه‌ی «از/تا»ی فعلی را روی شناسه‌ها AND کند (فاکتور دیروزِ تیک‌خورده با تاریخ امروز ⇒ «۰ فاکتور · جمع ۰» ولی
     * باطل می‌شد). بازه‌ی خواندن = دامنه‌ی تاریخ خود فاکتورهای انتخاب‌شده؛ ردیف‌ها با invoiceIds محدود می‌مانند.
     */
    if (ids.length) {
      let minAt: number | null = null
      let maxAt: number | null = null
      for (let i = 0; i < ids.length; i += 500) {
        const span = await prisma.saleInvoice.aggregate({
          where: { id: { in: ids.slice(i, i + 500) } },
          _min: { issuedAt: true },
          _max: { issuedAt: true }
        })
        const lo = span._min?.issuedAt ? new Date(span._min.issuedAt as any).getTime() : NaN
        const hi = span._max?.issuedAt ? new Date(span._max.issuedAt as any).getTime() : NaN
        if (Number.isFinite(lo)) minAt = minAt == null ? lo : Math.min(minAt, lo)
        if (Number.isFinite(hi)) maxAt = maxAt == null ? hi : Math.max(maxAt, hi)
      }
      if (minAt != null && maxAt != null) {
        fromJalali = toJalaliDate(new Date(minAt))
        toJalali = toJalaliDate(new Date(maxAt))
      }
    }
    /**
     * ممیزی A109-01 — پیش‌نمایش عملیات مخرب همان قبول/رد خود purge را دارد: تاریخ خالی/نامعتبر یا
     * بازه‌ی معکوس ⇒ همان خطای فارسی purge (نه «۰ فاکتور» بی‌صدا یا داده‌ی امروز با برچسب خالی).
     */
    if (!ids.length) {
      if (!isValidJalaliDate(fromJalali) || !isValidJalaliDate(toJalali))
        throw new BusinessError('بازه‌ی تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
      if (jalaliEndOfDay(toJalali) < jalaliStartOfDay(fromJalali))
        throw new BusinessError('«از تاریخ» باید قبل از «تا تاریخ» باشد.')
    }
    const res = await this.reportRows({
      fromJalali,
      toJalali,
      ...(ids.length ? { invoiceIds: ids, take: ids.length } : { take: 20000 })
    })
    const rows = res.rows
    const stock = await purgeStockPlan(fromJalali, toJalali, ids.length ? ids : null)
    return {
      fromJalali,
      toJalali,
      rows,
      totals: ids.length ? sumTotals(rows) : res.totals,
      page: res.page,
      warnings: ids.length ? [] : res.warnings,
      returnCount: stock.returnCount,
      itemCount: stock.itemCount,
      restoreQty: stock.plan.reduce((s, p) => s + p.qty, 0),
      restoreLines: stock.plan
    }
  },

  /**
   * حذف واقعی گزارشات فروش بازه.
   *
   * `restoreStock: true`  ⇒ هر کالایی که در فاکتورهای حذف‌شده فروخته شده بود، به
   *                         اندازه‌ی همان تعداد به موجودی انبار برمی‌گردد
   *                         (تعدادی که قبلاً با «برگشت از فروش» برگشته بوده،
   *                         دوباره شمرده نمی‌شود).
   * `restoreStock: false` ⇒ فقط داده‌ی گزارش پاک می‌شود و انبار دست‌نخورده
   *                         می‌ماند.
   */
  async purge(input: {
    fromJalali?: string
    toJalali?: string
    restoreStock?: boolean
    /** مورد ۱: فقط همین فاکتورها حذف شوند (خالی = کل بازه‌ی تاریخی، مثل قبل) */
    invoiceIds?: number[] | null
    userId?: number | null
    /** پاک‌سازی همیشه رمز مدیر می‌خواهد؛ actor از IPC و نشست باز می‌آید. */
    managerPassword?: string | null
    /** اگر بازه بسته باشد، دلیل اصلاحی اجباری است. */
    overrideReason?: string | null
    /** IPC رمز مدیر را بیرون از تراکنش سنجیده است. */
    managerVerified?: boolean
  }) {
    const fromJalali = input.fromJalali ?? jalaliToday()
    const toJalali = input.toJalali ?? fromJalali
    const picked = normalizeInvoiceIds(input.invoiceIds)
    const selective = picked.length > 0

    if (!selective) {
      if (!isValidJalaliDate(fromJalali) || !isValidJalaliDate(toJalali))
        throw new BusinessError('بازه‌ی تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
      const fromCheck = jalaliStartOfDay(fromJalali)
      const toCheck = jalaliEndOfDay(toJalali)
      if (toCheck < fromCheck) throw new BusinessError('«از تاریخ» باید قبل از «تا تاریخ» باشد.')
    }

    const from = jalaliStartOfDay(fromJalali)
    const to = jalaliEndOfDay(toJalali)

    /**
     * بند ۴-۲۹ و قفل دوره: پیش‌سنجش بیرون از transaction انجام می‌شود تا
     * AuthLockout هیچ‌وقت وسط تراکنش نوشته نشود. خود assertOpen دوباره داخل
     * تراکنش وضعیت دوره را می‌سنجد و اگر بین دو مرحله بسته شده باشد، عملیات را
     * fail-closed متوقف می‌کند.
     */
    const periodApproved = await periodLockService.preverify({
      at: from,
      what: 'پاک‌سازی گزارشات فروش',
      managerPassword: input.managerPassword,
      overrideReason: input.overrideReason,
      alreadyVerified: input.managerVerified === true
    })

    /** ممیزی A85-01 — فقط سند زنده؛ فاکتور باطل/لغوشده دوباره باطل نمی‌شود و موجودی‌اش دوباره برنمی‌گردد. */
    /**
     * نشست ۱۷۵ · S175-D2 — در ابطال انتخابی، `id in picked` بی‌سقف بود (انتخاب ۵۰۱+ ردیف ⇒ عبور از
     * سقف IN ۵۰۰، S99-2). حالا دسته‌های ۵۰۰تایی و ترتیب id صعودی (همان ترتیب پیش‌فرض قبلی).
     */
    const purgeInvoiceSelect = { id: true, receiptNo: true, grandTotal: true, issuedAt: true } as const
    const purgeInvoiceGate = {
      voidedAt: null,
      /**
       * ممیزی A122-01 (AUDIT-D59، D53) — پیش‌نمایش از reportRows می‌خواند که DRAFT و CANCELED را کنار می‌گذارد؛
       * قبلاً اینجا فقط CANCELED ⇒ پیش‌نویس قدیمی بی‌آنکه دیده شود باطل و قلمش با restoreStock کالای شبح می‌شد.
       */
      status: { notIn: REPORT_EXCLUDED_SALE_STATUSES }
    }
    const invoices: Array<{ id: number; receiptNo: number; grandTotal: number; issuedAt: Date }> = []
    if (selective) {
      for (const ids of reportIdChunks(picked))
        invoices.push(
          ...((await prisma.saleInvoice.findMany({
            where: { id: { in: ids }, ...purgeInvoiceGate },
            select: purgeInvoiceSelect
          })) as any[])
        )
      invoices.sort((a, b) => a.id - b.id)
    } else {
      invoices.push(
        ...((await prisma.saleInvoice.findMany({
          where: { issuedAt: { gte: from, lte: to }, ...purgeInvoiceGate },
          select: purgeInvoiceSelect
        })) as any[])
      )
    }
    if (!invoices.length)
      throw new BusinessError(
        selective
          ? 'فاکتورهای انتخاب‌شده پیدا نشدند یا قبلاً باطل/لغو شده‌اند؛ ابطال دوباره انجام نمی‌شود و موجودی دوباره برنمی‌گردد. «نمایش گزارشات این بازه» را دوباره بزنید.'
          : `در بازه‌ی ${faDigits(fromJalali)} تا ${faDigits(toJalali)} هیچ فاکتور فروش زنده‌ای نیست (فاکتورهای باطل/لغوشده دوباره ابطال نمی‌شوند)، پس چیزی برای پاک‌سازی وجود ندارد.`
      )
    if (selective && invoices.length !== picked.length)
      throw new BusinessError(
        `${faDigits(picked.length - invoices.length)} فاکتور از ${faDigits(picked.length)} فاکتور انتخاب‌شده پیدا نشد یا قبلاً باطل/لغو شده است؛ ` +
          'فهرست را دوباره بارگذاری کنید تا فقط فاکتورهای زنده انتخاب شوند.'
      )

    /**
     * ممیزی A85-02 — قفل دوره باید روی *هر روزی* که این ابطال عددش را عوض می‌کند
     * سنجیده شود: روز صدور هر فاکتور، روز هر پرداخت زنده و روز هر برگشت زنده.
     * قبلاً فقط «از تاریخ» (و در ابطال انتخابی: امروز) سنجیده می‌شد ⇒ فاکتور روزِ
     * صندوق‌بسته بدون رمز/دلیل باطل و نقد مورد انتظار آن روز بی‌ردپا کم می‌شد.
     */
    const targetIds = invoices.map((i) => i.id)
    const touchedAt: Date[] = invoices.map((i) => new Date(i.issuedAt as any))
    for (let i = 0; i < targetIds.length; i += 500) {
      const chunk = targetIds.slice(i, i + 500)
      const [pays, rets] = await Promise.all([
        prisma.payment.findMany({ where: { invoiceId: { in: chunk }, voidedAt: null }, select: { paidAt: true, clearedAt: true } }),
        prisma.saleReturn.findMany({ where: { invoiceId: { in: chunk }, voidedAt: null }, select: { returnedAt: true } })
      ])
      for (const p of pays) {
        touchedAt.push(new Date(p.paidAt as any))
        if (p.clearedAt) touchedAt.push(new Date(p.clearedAt as any))
      }
      for (const r of rets) touchedAt.push(new Date(r.returnedAt as any))
    }
    const touchedDays = new Map<string, Date>()
    for (const d of touchedAt) {
      if (Number.isNaN(d.getTime())) continue
      const key = toJalaliDate(d)
      if (!touchedDays.has(key)) touchedDays.set(key, d)
    }
    const lockedDays: Date[] = []
    for (const d of touchedDays.values()) {
      const st = await periodLockService.status({ at: d })
      if (st.enforced) lockedDays.push(d)
    }
    const lockAt = lockedDays[0] ?? from
    const lockedApproved = lockedDays.length
      ? await periodLockService.preverify({
          at: lockAt,
          what: 'پاک‌سازی گزارشات فروش',
          managerPassword: input.managerPassword,
          overrideReason: input.overrideReason,
          alreadyVerified: periodApproved || input.managerVerified === true
        })
      : false

    const invoiceIds = invoices.map((i) => i.id)
    const restore = input.restoreStock === true
    const stock = await purgeStockPlan(fromJalali, toJalali, selective ? invoiceIds : null)
    // نشست ۱۸۱: `i.grandTotal` حالا BigInt است و `number + bigint` می‌ترکد.
    const grandTotal = invoices.reduce((s, i) => s + toNumberRial(i.grandTotal), 0)

    const result = await prisma.$transaction(
      async (tx) => {
        await periodLockService.assertOpen(tx, {
          at: from,
          what: 'پاک‌سازی گزارشات فروش',
          entity: 'SaleInvoice',
          entityId: 0,
          managerPassword: input.managerPassword,
          overrideReason: input.overrideReason,
          userId: input.userId ?? null,
          before: { fromJalali, toJalali, invoiceIds },
          after: { restoreStock: restore, selective },
          managerVerified: periodApproved || lockedApproved
        })
        // ممیزی A85-02 — هر روز بسته‌ی لمس‌شده جدا سنجیده و در Audit ثبت می‌شود.
        for (const d of lockedDays) {
          if (toJalaliDate(d) === toJalaliDate(from)) continue
          await periodLockService.assertOpen(tx, {
            at: d,
            what: 'پاک‌سازی گزارشات فروش',
            entity: 'SaleInvoice',
            entityId: 0,
            managerPassword: input.managerPassword,
            overrideReason: input.overrideReason,
            userId: input.userId ?? null,
            before: { fromJalali, toJalali, invoiceIds },
            after: { restoreStock: restore, selective },
            managerVerified: lockedApproved
          })
        }

        /**
         * نشست ۱۷۵ · S175-D2 — همه‌ی `in` های این تراکنش روی invoiceIds/returnIds بی‌سقف بودند (ابطال
         * بازه‌ی ۵۰۱+ فاکتوری ⇒ عبور از سقف IN ۵۰۰، S99-2). حالا هر خواندن/نوشتن در دسته‌های ۵۰۰تایی
         * (reportIdChunks، یکتا) و داخل همین تراکنش؛ نتیجه‌ها جمع/یکتا می‌شوند. اتمیک بودن دست نخورده.
         */
        const invoiceChunks = reportIdChunks(invoiceIds)
        const returnIds: number[] = []
        for (const ids of invoiceChunks)
          returnIds.push(
            ...(await tx.saleReturn.findMany({ where: { invoiceId: { in: ids } }, select: { id: true } })).map((r) => r.id)
          )
        returnIds.sort((a, b) => a - b)

        /**
         * ۱) بازگشت موجودی (اگر کاربر «بله» را انتخاب کرده باشد).
         *
         * جلسه ۴۷ — فاکتوری که «دفتر مبدأ کسر» دارد، کالایش به **همان انبارها**
         * برمی‌گردد، نه به انبار فروشگاه. پس نقشه‌ی بازگشتِ فروشگاه به همان
         * اندازه کم می‌شود، وگرنه یک کالا دو بار برمی‌گشت (یک بار انبار مرکزی،
         * یک بار انبار فروشگاه).
         *
         * ⚠️ فاکتورهای بی‌دفتر (همه‌ی فاکتورهای قبلی) ⇒ `warehouseQty = 0` و
         * نقشه‌ی فروشگاه عیناً همان نقشه‌ی قبل می‌ماند.
         */
        let warehouseRestored = 0
        const storePlan = new Map(stock.plan.map((p) => [p.variantId, p.qty]))
        if (restore) {
          for (const id of invoiceIds) {
            const rev = await stockAllocationService.reverseWholeInvoice(tx, {
              invoiceId: id,
              receiptNo: invoices.find((i) => i.id === id)?.receiptNo ?? null,
              userId: input.userId ?? null,
              reason: 'حذف گزارش فروش · برگشت مبدأهای کسر به انبارها'
            })
            warehouseRestored += rev.warehouseQty
            for (const w of rev.warehouseLines) {
              const left = (storePlan.get(w.variantId) ?? 0) - w.qty
              storePlan.set(w.variantId, Math.max(0, left))
            }
          }
        }
        const storeRestoreLines = [...storePlan.entries()]
          .filter(([, qty]) => qty > 0)
          .map(([variantId, qty]) => ({ variantId, qty }))

        if (restore && storeRestoreLines.length) {
          await inventoryService.increase(
            storeRestoreLines,
            {
              reason: 'ADJUSTMENT',
              refType: 'Manual',
              userId: input.userId ?? null,
              note: `بازگشت موجودی به‌خاطر حذف گزارشات فروش ${fromJalali} تا ${toJalali}`
            },
            tx
          )
        }

        /**
         * ۱٫۵) §۸ — **برگشت مصرف اعتبار خرید، قبل از حذف فاکتور و پرداختی.**
         *
         * باگ واقعی و مالیِ جلسه‌های ۲۰ تا ۲۷ همین‌جا بود: این مسیر فاکتور و
         * پرداختی را حذف می‌کرد ولی `reverseInvoiceRedemptions` را صدا نمی‌زد،
         * پس اعتبار خریدِ مشتری «مصرف‌شده» می‌ماند در حالی که فاکتورِ مصرفش
         * دیگر وجود نداشت — یعنی پول مشتری بی‌سند سوخته بود و هیچ گزارشی هم
         * نشانش نمی‌داد. (مسیر «برگشت کامل فاکتور» از جلسه ۲۱ درست بود؛ فقط
         * همین مسیرِ حذف گزارشات از قلم افتاده بود.)
         *
         * ترتیب عمداً *قبل از* حذف است: تابع برگشت، خودِ ردیف‌های دفتر مصرف را
         * می‌خواند و باقی‌مانده/دفعات اعتبار را برمی‌گرداند. اگر بعد از حذف
         * صدا زده می‌شد، هیچ چیزی برای پیدا کردن نمی‌ماند. همه‌اش هم داخل همین
         * تراکنش است، پس یا هر دو (برگشت اعتبار + حذف فاکتور) انجام می‌شود یا
         * هیچ‌کدام.
         *
         * ردیف دفتر مصرف حذف نمی‌شود و فقط `reversedAt`/دلیل می‌خورد — سابقه‌ی
         * حسابداری اعتبار کامل می‌ماند، دقیقاً مثل مسیر برگشت کامل فاکتور.
         */
        const redeemedRows: Array<{ invoiceId: number | null }> = []
        for (const ids of invoiceChunks)
          redeemedRows.push(
            ...(await tx.storeCreditRedemption.findMany({
              where: { invoiceId: { in: ids }, reversedAt: null },
              select: { invoiceId: true }
            }))
          )
        const creditInvoiceIds = [
          ...new Set(
            redeemedRows
              .map((r) => r.invoiceId)
              .filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
          )
        ]
        let reversedCreditRedemptions = 0
        for (const id of creditInvoiceIds) {
          const receiptNo = invoices.find((i) => i.id === id)?.receiptNo ?? null
          reversedCreditRedemptions += await reverseInvoiceRedemptions(tx, {
            invoiceId: id,
            reason: receiptNo
              ? `حذف گزارش فروش — فاکتور ${faDigits(receiptNo)} حذف شد، پس مصرف اعتبار برگشت خورد`
              : 'حذف گزارش فروش — فاکتور مرجع حذف شد، پس مصرف اعتبار برگشت خورد',
            userId: input.userId ?? null
          })
        }

        /**
         * ۲) سندها حذف فیزیکی نمی‌شوند. پاک‌سازی گزارش فقط آن‌ها را void می‌کند؛
         * اقلام، پرداخت‌ها، برگشت‌ها، تخصیص مبدأ و دفتر انبار برای حسابرسی
         * می‌مانند. اگر اعتبارِ صادرشده از همین برگشت قبلاً مصرف شده باشد،
         * عملیات متوقف می‌شود تا تعهد مشتری بی‌صدا نابود نشود.
         */
        /**
         * ممیزی A85-03 — اعتبارِ صادرشده از اضافه‌دریافت/تعویضِ همین فاکتورها هم
         * پشتوانه‌اش (پرداخت) باطل می‌شود؛ اگر فعال بماند، کالا با اعتباری بی‌پول
         * خارج می‌شود. پس همان قاعده‌ی «مصرف‌شده ⇒ رد، وگرنه void» برای آن‌ها هم.
         */
        // نشست ۱۸۱: `usedAmount` از دیتابیس BigInt می‌آید و این نگاشت فقط نگهش می‌دارد.
        const returnCreditMap = new Map<number, { id: number; usedAmount: number | bigint }>()
        const collectCredits = (rows: Array<{ id: number; usedAmount: number | bigint }>) => {
          for (const c of rows) returnCreditMap.set(c.id, c)
        }
        for (const ids of reportIdChunks(returnIds))
          collectCredits(
            await tx.storeCredit.findMany({ where: { voidedAt: null, returnId: { in: ids } }, select: { id: true, usedAmount: true } })
          )
        for (const ids of invoiceChunks)
          collectCredits(
            await tx.storeCredit.findMany({
              where: { voidedAt: null, OR: [{ sourceInvoiceId: { in: ids } }, { exchangeInvoiceId: { in: ids } }] },
              select: { id: true, usedAmount: true }
            })
          )
        /** ترتیب id صعودی ⇒ پیام «اعتبار مصرف‌شده» همان اعتبار قبلی (کوچک‌ترین شناسه) را نام می‌برد */
        const returnCredits = [...returnCreditMap.values()].sort((a, b) => a.id - b.id)
        const usedReturnCredit = returnCredits.find((c) => toRial(c.usedAmount) > 0n)
        if (usedReturnCredit)
          throw new BusinessError(
            `پاک‌سازی انجام نشد: اعتبار خرید شماره ${faDigits(usedReturnCredit.id)} قبلاً مصرف شده است؛ ` +
              'ابتدا رسیدگی مدیر انجام شود تا سابقه‌ی مالی پنهان نشود.'
          )

        const voidedAt = new Date()
        const voidReason = selective
          ? `ابطال گزارش فروش انتخاب‌شده با تایید مدیر · ${input.overrideReason ?? 'بدون دلیل ثبت‌شده'}`
          : `ابطال گزارش فروش بازه ${fromJalali} تا ${toJalali} با تایید مدیر · ${
              input.overrideReason ?? 'بدون دلیل ثبت‌شده'
            }`
        for (const ids of reportIdChunks(returnCredits.map((c) => c.id)))
          await tx.storeCredit.updateMany({
            where: { id: { in: ids }, voidedAt: null },
            data: { status: StoreCreditStatus.CANCELED, voidedAt, voidedReason: voidReason }
          })
        for (const ids of reportIdChunks(returnIds))
          await tx.saleReturn.updateMany({
            where: { id: { in: ids }, voidedAt: null },
            data: { voidedAt, voidedByUserId: input.userId ?? null, voidReason }
          })
        for (const ids of invoiceChunks)
          await tx.payment.updateMany({
            where: { invoiceId: { in: ids }, voidedAt: null },
            data: { voidedAt, voidedByUserId: input.userId ?? null, voidReason }
          })
        const voided = { count: 0 }
        for (const ids of invoiceChunks)
          voided.count += (
            await tx.saleInvoice.updateMany({
              where: { id: { in: ids }, voidedAt: null },
              data: { voidedAt, voidedByUserId: input.userId ?? null, voidReason, status: SaleStatus.CANCELED }
            })
          ).count

        await audit(tx, {
          action: AuditAction.VOID,
          entity: 'SaleInvoice',
          userId: input.userId ?? null,
          before: JSON.stringify({
            fromJalali,
            toJalali,
            invoiceCount: voided.count,
            receiptNumbers: invoices.slice(0, 200).map((i) => i.receiptNo),
            returnCount: returnIds.length,
            grandTotal
          }),
          after: JSON.stringify({
            restoreStock: restore,
            restoredQty: restore ? stock.plan.reduce((s, p) => s + p.qty, 0) : 0,
            restoredVariants: restore ? stock.plan.length : 0,
            /** جلسه ۴۷ — چه مقدار به انبارهای مبدأ برگشت (به‌جای انبار فروشگاه) */
            restoredToWarehouses: warehouseRestored,
            /* §۸ — چند مصرف اعتبار برگشت خورد (۰ = هیچ فاکتوری اعتبار مصرف نکرده بود) */
            reversedCreditRedemptions
          }),
          note:
            (selective
              ? `ابطال ${voided.count} فاکتور فروش انتخاب‌شده`
              : `ابطال گزارشات فروش بازه (${fromJalali} تا ${toJalali})`) +
            (restore ? ' · با بازگشت موجودی به انبار' : ' · بدون تغییر موجودی انبار')
        })

        return {
          deletedInvoices: 0,
          voidedInvoices: voided.count,
          deletedReturns: 0,
          voidedReturns: returnIds.length,
          reversedCreditRedemptions,
          restoredToWarehouses: warehouseRestored
        }
      },
      { timeout: 120000, maxWait: 15000 }
    )

    return {
      fromJalali,
      toJalali,
      ...result,
      selective,
      receiptNumbers: invoices.map((i) => i.receiptNo),
      restoreStock: restore,
      restoredQty: restore ? stock.plan.reduce((s, p) => s + p.qty, 0) : 0,
      restoredVariants: restore ? stock.plan.length : 0,
      grandTotal
    }
  }
}
