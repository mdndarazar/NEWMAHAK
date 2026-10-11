/**
 * ===========================================================================
 * ریزبین مالی گزارش فروش — منابع فقط‌خواندنی.
 *
 * این سرویس هیچ عدد مالی نمی‌سازد و هیچ رکوردی نمی‌نویسد. مبلغ رسمی هر ردیف
 * از reportRows/buildStatements می‌آید و فهرست اسناد از همان `bridgeSources`
 * authoritative خوانده می‌شود. جست‌وجو، sort و صفحه‌بندی در main انجام می‌شود؛
 * renderer فقط صفحهٔ درخواست‌شده را می‌بیند.
 * ===========================================================================
 */
import { BusinessError } from '../errors'
import { salesService } from './SalesService'
import { readBridgeSources, readFinancialComponentSources, resolveAccountingReadScope } from './accountingReport'
import { assertPanelUnlocked } from './panelSession'
import { PANEL_KEYS } from '@shared/panels'
import {
  FINANCIAL_COMPONENT_KEYS,
  FINANCIAL_SOURCE_KEYS,
  type FinancialComponentKey,
  type FinancialDocumentDetail,
  type FinancialDocumentRequest,
  type FinancialDocumentResponse,
  type FinancialInspectorKey,
  type FinancialSourceKey,
  type FinancialSourceRequest,
  type FinancialSourceResponse,
  type FinancialSourceResult,
  type FinancialSourceRow,
  type FinancialSourceSort,
  type SaleBridgeSource,
  type SaleReportFilter
} from '@shared/types'
import { prisma } from '../db/client'
import { toJalaliDate, toLatinDigits } from '@shared/jalali'
import { toNumberRial } from '@shared/money'
import { CREDIT_STATUS_LABELS, effectiveStatus, remainingOf } from '@shared/credit'

const PANEL = PANEL_KEYS.salesReports
const MAX_TAKE = 200
const SOURCE_READ_CHUNK = 2_000
/**
 * برای search/sort دقیق، مجموعهٔ منبع یک بار در main خوانده می‌شود. بیشتر از
 * این سقف صریحاً خطا می‌گیرد تا هرگز یک صفحهٔ ناقص به‌عنوان «همهٔ اسناد» نمایش
 * داده نشود. endpoint موجود bridge diagnostics همچنان برای بررسی‌های بسیار
 * بزرگ قابل استفاده است؛ فاز بعدی می‌تواند index-native این مسیر را بهینه کند.
 */
const MAX_SEARCHABLE_SOURCES = 20_000

const SOURCE_SORTS: readonly FinancialSourceSort[] = [
  'DATE_DESC', 'DATE_ASC', 'AMOUNT_DESC', 'AMOUNT_ASC', 'DOCUMENT_DESC', 'DOCUMENT_ASC'
]

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  return input as Record<string, unknown>
}

function cleanedText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text.slice(0, max) : undefined
}

function cleanedPositiveInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n <= 0) throw new BusinessError('شناسهٔ فیلتر مالی نامعتبر است.')
  return n
}

function cleanedJalaliDate(value: unknown): string | undefined {
  const raw = cleanedText(value, 10)
  if (raw === undefined) return undefined
  // همان پذیرش ارقام فارسی/لاتین jalaliStartOfDay؛ payload ریزبین نباید از خود گزارش سخت‌گیرتر باشد.
  const text = toLatinDigits(raw)
  if (!/^\d{4}\/\d{2}\/\d{2}$/.test(text)) throw new BusinessError('تاریخ شمسی ریزبین مالی نامعتبر است.')
  return text
}

function cleanedIsoDate(value: unknown): string | undefined {
  const text = cleanedText(value, 40)
  if (text === undefined) return undefined
  if (Number.isNaN(new Date(text).getTime())) throw new BusinessError('تاریخ ریزبین مالی نامعتبر است.')
  return text
}

/** allowlist فیلترهای گزارش؛ take/skip/drill از payload خارجی قبول نمی‌شوند. */
export function cleanFinancialScope(raw: unknown): SaleReportFilter {
  const input = asRecord(raw)
  const scope: SaleReportFilter = {}
  for (const key of ['status', 'orderType', 'returnCode', 'customerSearch', 'productSearch'] as const) {
    const text = cleanedText(input[key])
    if (text !== undefined) (scope as Record<string, unknown>)[key] = text
  }
  const fromJalali = cleanedJalaliDate(input.fromJalali)
  const toJalali = cleanedJalaliDate(input.toJalali)
  const from = cleanedIsoDate(input.from)
  const to = cleanedIsoDate(input.to)
  if (fromJalali) scope.fromJalali = fromJalali
  if (toJalali) scope.toJalali = toJalali
  if (from) scope.from = from
  if (to) scope.to = to
  for (const key of ['shiftId', 'shiftNumber', 'userId', 'customerId', 'receiptNo'] as const) {
    const n = cleanedPositiveInt(input[key])
    if (n !== undefined) (scope as Record<string, unknown>)[key] = n
  }
  if (input.fullRange === true) scope.fullRange = true
  if (input.onlyNotConsolidated === true) scope.onlyNotConsolidated = true

  if (Array.isArray(input.channels)) {
    const allowed = new Set(['RETAIL', 'WHOLESALE'])
    const channels = [...new Set(input.channels.filter((v): v is string => typeof v === 'string' && allowed.has(v)))].slice(0, 2)
    // آرایهٔ خالی معنادار است: «هیچ کانالی»؛ آن را به null تبدیل نکن.
    scope.channels = channels
  }
  if (Array.isArray(input.invoiceIds)) {
    if (input.invoiceIds.length > 20_000) throw new BusinessError('تعداد فاکتورهای انتخاب‌شده برای ریزبین مالی بیش از حد مجاز است.')
    scope.invoiceIds = [...new Set(input.invoiceIds.map(cleanedPositiveInt).filter((id): id is number => id !== undefined))]
  }
  return scope
}

function cleanKey(value: unknown): FinancialInspectorKey {
  const key = String(value ?? '') as FinancialInspectorKey
  const allowed = [...FINANCIAL_SOURCE_KEYS, ...FINANCIAL_COMPONENT_KEYS] as readonly string[]
  if (!allowed.includes(key)) throw new BusinessError('دستهٔ ریز مبلغ مالی نامعتبر است.')
  return key
}

function isComponentKey(key: FinancialInspectorKey): key is FinancialComponentKey {
  return (FINANCIAL_COMPONENT_KEYS as readonly string[]).includes(key)
}

function cleanTake(value: unknown): number {
  const n = Number(value ?? 50)
  if (!Number.isFinite(n)) throw new BusinessError('اندازهٔ صفحهٔ منابع مالی نامعتبر است.')
  return Math.max(1, Math.min(MAX_TAKE, Math.round(n) || 50))
}

function cleanSkip(value: unknown): number {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n < 0) throw new BusinessError('شمارهٔ صفحهٔ منابع مالی نامعتبر است.')
  return Math.max(0, Math.round(n))
}

function cleanSort(value: unknown): FinancialSourceSort {
  const sort = String(value ?? 'DATE_DESC') as FinancialSourceSort
  if (!(SOURCE_SORTS as readonly string[]).includes(sort)) throw new BusinessError('ترتیب منابع مالی نامعتبر است.')
  return sort
}

function cleanSearch(value: unknown): string {
  if (value == null) return ''
  if (typeof value !== 'string') throw new BusinessError('عبارت جست‌وجوی منابع مالی نامعتبر است.')
  return value.trim().slice(0, 80)
}

function effectOf(source: SaleBridgeSource, key: FinancialInspectorKey): FinancialSourceRow['effect'] {
  // جهت از «ردیف مالی» می‌آید، نه صرفاً نوع جدول: priorDebtReturns یک SaleReturn
  // است اما خروج وجه نیست؛ و StoreCreditIssued/Used هر دو غیرنقدی‌اند.
  if (key === 'uncollectedCredit' || key === 'priorDebtReturns') return 'BALANCE'
  if (
    key === 'storeCreditIssued' || key === 'storeCreditUsed' ||
    key.startsWith('storeCreditIssued') || key === 'storeCreditExpired' || key === 'storeCreditExpiredInRange' || key === 'storeCreditCanceled' ||
    source.kind === 'STORE_CREDIT'
  ) return 'NON_CASH'
  if (key.includes('Refund') || source.kind === 'RETURN') return 'OUT'
  return 'IN'
}

function sortRows(rows: FinancialSourceRow[], sort: FinancialSourceSort): FinancialSourceRow[] {
  const direction = sort.endsWith('_ASC') ? 1 : -1
  const compareText = (a: string, b: string) => a.localeCompare(b, 'fa', { numeric: true })
  return [...rows].sort((a, b) => {
    let base = 0
    if (sort.startsWith('DATE')) base = compareText(a.dateJalali ?? '', b.dateJalali ?? '')
    else if (sort.startsWith('AMOUNT')) base = a.amount - b.amount
    else base = compareText(a.documentLabel, b.documentLabel)
    if (base !== 0) return direction * base
    // ترتیب پایدار و قطعی، حتی برای تاریخ/مبلغ برابر.
    return direction * (a.ref.id - b.ref.id)
  })
}

async function allSources(scope: SaleReportFilter, key: FinancialInspectorKey): Promise<SaleBridgeSource[]> {
  const readScope = await resolveAccountingReadScope(scope)
  const read = (skip: number, take: number) =>
    isComponentKey(key)
      ? readFinancialComponentSources(readScope, key, skip, take)
      : readBridgeSources(readScope, key, skip, take)
  const first = await read(0, SOURCE_READ_CHUNK)
  if (first.page.failed) throw new BusinessError('اسناد سازندهٔ این عدد خوانده نشدند؛ فهرست خالی به معنی «بدون سند» نیست.')
  if (first.page.totalCount > MAX_SEARCHABLE_SOURCES)
    throw new BusinessError(
      `برای این عدد ${first.page.totalCount.toLocaleString('fa-IR')} سند وجود دارد؛ جست‌وجوی کاملِ ریزبین برای جلوگیری از نمایش ناقص انجام نشد. ` +
      'بازه یا فیلتر را محدود کنید یا از نمای تشخیص پل برای مرور صفحه‌ای استفاده کنید.'
    )

  const rows = [...first.sources]
  for (let skip = rows.length; skip < first.page.totalCount; skip += SOURCE_READ_CHUNK) {
    const next = await read(skip, SOURCE_READ_CHUNK)
    if (next.page.failed) throw new BusinessError('خواندن یکی از صفحه‌های منابع مالی ناموفق بود؛ هیچ نتیجهٔ ناقصی نمایش داده نمی‌شود.')
    rows.push(...next.sources)
  }
  // اگر داده میان دو query تغییر کرد، ادامه دادن ناامن است؛ نتیجه باید دوباره ساخته شود.
  if (rows.length !== first.page.totalCount)
    throw new BusinessError('منابع مالی هم‌زمان تغییر کردند؛ ریزبین را دوباره باز کنید تا فهرست یکپارچه ساخته شود.')
  return rows
}

function n(value: unknown): number {
  if (typeof value === 'bigint') return toNumberRial(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

function itemsOf(invoice: any): FinancialDocumentDetail['items'] {
  return Array.isArray(invoice?.items)
    ? invoice.items.map((item: any) => ({
        name: String(item.variantName || `کالای #${item.variantId}`),
        code: String(item.variantCode || '—'),
        qty: Number(item.qty || 0),
        unitPrice: n(item.unitPrice),
        lineTotal: n(item.lineTotal)
      }))
    : []
}

function invoiceContext(invoice: any): Pick<FinancialDocumentDetail, 'invoice' | 'customer' | 'actor' | 'shift' | 'items'> {
  return {
    invoice: invoice
      ? { id: Number(invoice.id), receiptNo: Number(invoice.receiptNo), issuedAtJalali: invoice.issuedAtJalali || null }
      : null,
    customer: { id: invoice?.customer?.id ?? null, name: invoice?.customer?.name || 'مشتری عمومی' },
    actor: { id: invoice?.userId ?? null, name: invoice?.user?.displayName || (invoice?.userId ? `کاربر #${invoice.userId}` : 'نامشخص') },
    shift: { id: invoice?.shiftId ?? null, name: invoice?.shift?.name ?? null },
    items: itemsOf(invoice)
  }
}

async function actorAndShift(userId: number | null | undefined, shiftId: number | null | undefined) {
  const [user, shift] = await Promise.all([
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true } }) : null,
    shiftId ? prisma.shift.findUnique({ where: { id: shiftId }, select: { id: true, name: true } }) : null
  ])
  return {
    actor: { id: userId ?? null, name: user?.displayName || (userId ? `کاربر #${userId}` : 'نامشخص') },
    shift: { id: shiftId ?? null, name: shift?.name ?? null }
  }
}

async function documentForSource(source: SaleBridgeSource): Promise<FinancialDocumentDetail> {
  const base = {
    /** فقط discriminator امن؛ کد قابل‌مصرف هرگز در detail عادی نمی‌آید. */
    ref: { kind: source.kind, id: source.id, subKind: source.subKind },
    sourceAmount: n(source.amount),
    documentLabel: source.label
  } as const

  if (source.kind === 'PAYMENT') {
    const payment: any = await prisma.payment.findUnique({
      where: { id: source.id },
      include: {
        method: { select: { label: true, kind: true } },
        invoice: { include: { customer: true, user: true, shift: true, items: true } }
      }
    })
    if (!payment) throw new BusinessError('پرداخت منبع دیگر وجود ندارد.')
    const context = invoiceContext(payment.invoice)
    const paymentActor = await actorAndShift(payment.createdByUserId, payment.createdShiftId)
    return {
      ...base,
      title: payment.kind === 'CHEQUE' ? 'شناسنامهٔ چک/پرداخت پاس‌شده' : 'شناسنامهٔ پرداخت',
      documentAmount: n(payment.amount),
      occurredAt: {
        dateJalali: payment.kind === 'CHEQUE' && payment.clearedAt ? toJalaliDate(payment.clearedAt) : payment.paidAtJalali || toJalaliDate(payment.paidAt),
        time: payment.paidAtTime || null
      },
      ...context,
      actor: paymentActor.actor.id != null ? paymentActor.actor : context.actor,
      shift: paymentActor.shift.id != null ? paymentActor.shift : context.shift,
      settlement: {
        method: String(payment.kind || payment.method?.kind || 'PAYMENT'),
        methodLabel: payment.kind === 'CHEQUE' ? 'چک پاس‌شده' : String(payment.method?.label || 'پرداخت'),
        reference: payment.reference ?? payment.chequeNo ?? null,
        status: payment.kind === 'CHEQUE' ? payment.chequeStatus ?? null : null
      },
      note: payment.note ?? null,
      voided: payment.voidedAt != null
    }
  }

  if (source.kind === 'RETURN') {
    const ret: any = await prisma.saleReturn.findUnique({
      where: { id: source.id },
      include: { invoice: { include: { customer: true, user: true, shift: true, items: true } }, items: true }
    })
    if (!ret) throw new BusinessError('سند برگشت/تعویض منبع دیگر وجود ندارد.')
    const sourceInvoiceContext = invoiceContext(ret.invoice)
    const own = await actorAndShift(ret.userId, ret.shiftId)
    const method = String(ret.refundMethod || ret.exchangeSettlement || 'NONE')
    const labels: Record<string, string> = {
      CASH: 'بازپرداخت نقدی', CARD: 'بازپرداخت کارتی (پوز)', CARD_TO_CARD: 'کارت‌به‌کارت مدیر',
      STORE_CREDIT: 'اعتبار خرید', CREDIT: 'اعتبار خرید', DEBT_REDUCTION: 'کاهش بدهی', NONE: 'بدون بازپرداخت'
    }
    return {
      ...base,
      title: ret.kind === 'EXCHANGE' ? 'شناسنامهٔ تعویض' : 'شناسنامهٔ برگشت از فروش',
      documentAmount: n(ret.refundAmount || ret.exchangeDiff || ret.total),
      occurredAt: { dateJalali: ret.returnedAtJalali || null, time: ret.returnedAtTime || null },
      ...sourceInvoiceContext,
      actor: own.actor,
      shift: own.shift,
      items: Array.isArray(ret.items)
        ? ret.items.map((item: any) => ({
            name: String(item.variantName || `کالای برگشتی #${item.variantId}`),
            code: String(item.variantCode || '—'),
            qty: Number(item.qty || 0),
            unitPrice: n(item.unitPrice),
            lineTotal: n(item.lineTotal)
          }))
        : [],
      settlement: {
        method,
        methodLabel: labels[method] || method,
        reference: ret.refundReference ?? null,
        status: ret.voidedAt
          ? 'VOIDED'
          : ret.refundMethod === 'CARD_TO_CARD' && !ret.refundedAt
            ? 'PENDING_MANAGER_PAYMENT'
            : ret.refundMethod && ret.refundAmount
              ? 'REFUNDED'
              : null
      },
      note: ret.refundNote ?? ret.note ?? null,
      voided: ret.voidedAt != null
    }
  }

  if (source.kind === 'INVOICE') {
    const invoice: any = await prisma.saleInvoice.findUnique({
      where: { id: source.id }, include: { customer: true, user: true, shift: true, items: true }
    })
    if (!invoice) throw new BusinessError('فاکتور منبع دیگر وجود ندارد.')
    return {
      ...base,
      title: 'شناسنامهٔ فاکتور فروش',
      documentAmount: n(invoice.grandTotal),
      occurredAt: { dateJalali: invoice.issuedAtJalali || null, time: null },
      ...invoiceContext(invoice),
      settlement: { method: 'INVOICE', methodLabel: 'فروش/بدهی فاکتور', reference: null, status: invoice.status ?? null },
      note: invoice.note ?? null,
      voided: invoice.voidedAt != null
    }
  }

  if (source.kind === 'STORE_CREDIT') {
    /**
     * نوع id از metadata صریح source می‌آید، نه از label انسانی. label باید بدون
     * کد اعتبار هم امن و قابل تغییر بماند؛ حدس‌زدن از متن، redaction را شکننده
     * و بازکردن سند را ناامن می‌کرد.
     */
    if (source.subKind !== 'STORE_CREDIT_REDEMPTION' && source.subKind !== 'STORE_CREDIT_ISSUANCE')
      throw new BusinessError('نوع سند اعتبار برای نمایش امن مشخص نیست.')
    const isRedemption = source.subKind === 'STORE_CREDIT_REDEMPTION'
    if (isRedemption) {
      const redemption: any = await (prisma as any).storeCreditRedemption.findUnique({ where: { id: source.id } })
      if (!redemption) throw new BusinessError('مصرف اعتبار منبع دیگر وجود ندارد.')
      const invoice: any = redemption.invoiceId
        ? await prisma.saleInvoice.findUnique({ where: { id: redemption.invoiceId }, include: { customer: true, user: true, shift: true, items: true } })
        : null
      const own = await actorAndShift(redemption.userId, redemption.shiftId)
      return {
        ...base,
        title: 'شناسنامهٔ مصرف اعتبار خرید',
        documentAmount: n(redemption.amount),
        occurredAt: { dateJalali: redemption.atJalali || (redemption.at ? toJalaliDate(redemption.at) : null), time: redemption.atTime || null },
        ...invoiceContext(invoice),
        actor: own.actor,
        shift: own.shift,
        settlement: { method: 'STORE_CREDIT', methodLabel: 'مصرف اعتبار خرید', reference: null, status: redemption.reversedAt ? 'REVERSED' : 'ACTIVE' },
        note: redemption.note ?? null,
        voided: redemption.reversedAt != null
      }
    }
    const credit: any = await prisma.storeCredit.findUnique({ where: { id: source.id } })
    if (!credit) throw new BusinessError('اعتبار خرید منبع دیگر وجود ندارد.')
    /**
     * خاستگاه را از scalarهای خود اعتبار حل می‌کنیم، نه از label. این هم سند
     * برگشت/تعویض را در شناسنامهٔ امن قابل ردیابی می‌کند و هم هیچ credentialی
     * به DTO معمول گزارش اضافه نمی‌کند.
     */
    const originReturn: any = credit.returnId
      ? await prisma.saleReturn.findUnique({ where: { id: credit.returnId }, select: { id: true, invoiceId: true, kind: true } })
      : null
    const remainderParent: any = await prisma.storeCredit.findFirst({
      where: { remainderCreditId: credit.id }, select: { id: true }
    })
    const originInvoiceId = credit.exchangeInvoiceId ?? originReturn?.invoiceId ?? credit.sourceInvoiceId ?? null
    const invoice: any = originInvoiceId
      ? await prisma.saleInvoice.findUnique({ where: { id: originInvoiceId }, include: { customer: true, user: true, shift: true, items: true } })
      : null
    const own = await actorAndShift(credit.userId, null)
    const origin = remainderParent
      ? { label: 'اعتبار باقی‌ماندهٔ مصرف جزئی', reference: `اعتبار قبلی #${remainderParent.id}` }
      : credit.source === 'OVERPAY'
        ? { label: 'اعتبار ناشی از اضافه‌دریافت', reference: invoice ? `فاکتور ${invoice.receiptNo}` : null }
        : credit.exchangeInvoiceId != null
          ? { label: 'اعتبار صادرشده از تعویض', reference: invoice ? `فاکتور ${invoice.receiptNo}` : null }
          : originReturn
            ? { label: originReturn.kind === 'EXCHANGE' ? 'اعتبار صادرشده از تعویض' : 'اعتبار صادرشده از برگشت', reference: `سند برگشت #${originReturn.id}` }
            : credit.source === 'MANUAL'
              ? { label: 'اعتبار دستی/مدیریتی', reference: null }
              : { label: 'اعتبار خرید', reference: null }
    /**
     * `status` خامِ رکورد با گذشت زمان خودکار rewrite نمی‌شود؛ بنابراین اعتبار
     * صادرشده از تعویض ممکن است ستون ACTIVE داشته باشد ولی تاریخ انقضایش گذشته
     * باشد. شناسنامهٔ ریزبین باید همان وضعیت مؤثری را نشان دهد که گزارش «منقضی»
     * با آن محاسبه شده است؛ نمایش ACTIVE در چنین سندی مدیر را به اشتباه می‌انداخت.
     */
    const expiresAt = credit.expiresAt ? new Date(credit.expiresAt) : null
    const creditStatus = effectiveStatus({
      amount: n(credit.amount),
      usedAmount: n(credit.usedAmount),
      usedCount: n(credit.usedCount),
      maxUses: n(credit.maxUses),
      multiUse: credit.multiUse === true,
      status: String(credit.status ?? 'ACTIVE'),
      expiresAt
    })
    const creditRemaining = remainingOf({ amount: n(credit.amount), usedAmount: n(credit.usedAmount) })
    return {
      ...base,
      title: 'شناسنامهٔ اعتبار خرید',
      documentAmount: n(credit.amount),
      occurredAt: { dateJalali: credit.issuedAtJalali || (credit.issuedAt ? toJalaliDate(credit.issuedAt) : null), time: credit.issuedAtTime || null },
      ...invoiceContext(invoice),
      actor: own.actor,
      shift: { id: null, name: null },
      settlement: { method: 'STORE_CREDIT', methodLabel: origin.label, reference: origin.reference, status: creditStatus },
      creditValidity: {
        status: creditStatus,
        statusLabel: CREDIT_STATUS_LABELS[creditStatus] ?? creditStatus,
        expiresAtJalali: credit.expiresAtJalali ?? (expiresAt ? toJalaliDate(expiresAt) : null),
        issuedDays: credit.issuedDays == null ? null : n(credit.issuedDays),
        remaining: creditRemaining
      },
      note: credit.note ?? null,
      voided: credit.voidedAt != null || credit.deletedAt != null
    }
  }

  const movement: any = await prisma.cashMovement.findUnique({ where: { id: source.id } })
  if (!movement) throw new BusinessError('گردش نقدی منبع دیگر وجود ندارد.')
  const own = await actorAndShift(movement.userId, movement.shiftId)
  return {
    ...base,
    title: 'شناسنامهٔ گردش نقدی',
    documentAmount: n(movement.amount),
    occurredAt: { dateJalali: movement.occurredAtJalali || (movement.occurredAt ? toJalaliDate(movement.occurredAt) : null), time: movement.occurredAtTime || null },
    invoice: null,
    customer: { id: null, name: '—' },
    actor: own.actor,
    shift: own.shift,
    settlement: { method: String(movement.type || 'CASH_MOVEMENT'), methodLabel: 'گردش نقدی خارج از فروش', reference: movement.refId == null ? null : `${movement.refType || 'REF'} #${movement.refId}`, status: null },
    items: [],
    note: movement.description ?? null,
    voided: false
  }
}

type OfficialFinancialAmount = {
  label: string
  hint: string
  totalAmount: number
  basis: FinancialSourceResult['basis']
  pageCoversRange: boolean
}

/** مبلغ رسمی جزء کاشی همیشه از صورت حسابداری گزارش می‌آید، نه از جمع سندهای UI. */
function officialAmountOf(report: any, key: FinancialInspectorKey): OfficialFinancialAmount | null {
  if (key === 'drawerCashReceived') {
    return {
      label: 'دریافت‌های نقدی ثبت‌شده',
      hint: 'پرداخت‌های نقدی غیرچکیِ ثبت‌شده در همین بازه.',
      totalAmount: n(report?.accounting?.cash?.cashReceived),
      basis: 'RANGE',
      pageCoversRange: true
    }
  }
  if (key === 'posCardReceived') {
    return {
      label: 'دریافت‌های کارت‌خوان فروشگاه',
      hint: 'پرداخت‌های کارتی غیرچکیِ ثبت‌شده در همین بازه؛ کارت‌به‌کارت و حساب مدیر در این مبلغ نیستند.',
      totalAmount: n(report?.accounting?.cash?.cardReceived),
      basis: 'RANGE',
      pageCoversRange: true
    }
  }
  if (key === 'otherMethodReceived') {
    return {
      label: 'پرداخت با سایر روش‌ها',
      hint: 'پرداخت‌هایی که در ثبت فعلی نه نقدی‌اند، نه کارت‌خوان، نه اعتباری و نه حساب مدیر.',
      totalAmount: n(report?.accounting?.cash?.otherReceived),
      basis: 'RANGE',
      pageCoversRange: true
    }
  }

  /**
   * کارت گردش اعتبار یک ردیف پل جدید نمی‌سازد. مبلغ هر سبد مستقیماً از
   * `storeCredits` گزارش authoritative می‌آید و bridgeSources همان predicate
   * را برای سندها به‌کار می‌گیرد؛ بنابراین Renderer هرگز دسته‌ها را جمع نمی‌زند.
   */
  const lifecycle = report?.accounting?.storeCredits
  const lifecycleAmounts: Partial<Record<FinancialInspectorKey, { label: string; hint: string; amount: unknown }>> = {
    storeCreditIssuedAll: {
      label: 'کل اعتبار خرید صادرشده',
      hint: 'تمام اعتبارهای صادرشده در بازهٔ گزارش، پیش از تفکیک خاستگاه.',
      amount: lifecycle?.issued
    },
    storeCreditIssuedReturn: {
      label: 'اعتبار صادرشده بابت برگشت',
      hint: 'اعتبارهای صادرشده از برگشت فروش در بازهٔ گزارش.',
      amount: lifecycle?.issuedLifecycleReturn
    },
    storeCreditIssuedExchange: {
      label: 'اعتبار صادرشده بابت تعویض',
      hint: 'اعتبارهای صادرشده از سند تعویض در بازهٔ گزارش.',
      amount: lifecycle?.issuedLifecycleExchange
    },
    storeCreditIssuedManual: {
      label: 'اعتبار دستی/مدیریتی صادرشده',
      hint: 'اعتبارهای دستی ثبت‌شده توسط کاربر مجاز در بازهٔ گزارش.',
      amount: lifecycle?.issuedLifecycleManual
    },
    storeCreditIssuedOverpay: {
      label: 'اعتبار صادرشده از اضافه‌دریافت',
      hint: 'اعتبارهای جدید ناشی از اضافه‌دریافت؛ باقی‌ماندهٔ مصرف جزئی جداست.',
      amount: lifecycle?.issuedLifecycleOverpay
    },
    storeCreditIssuedRemainder: {
      label: 'اعتبار باقی‌ماندهٔ مصرف جزئی',
      hint: 'اعتبارهای تازه‌ای که فقط برای باقی‌ماندهٔ اعتبار قبلی ساخته شده‌اند.',
      amount: lifecycle?.issuedLifecycleRemainder
    },
    storeCreditIssuedOther: {
      label: 'اعتبار با خاستگاه ثبت‌نشده',
      hint: 'صدورهایی که خاستگاهشان در دادهٔ تاریخی برگشت، تعویض، دستی یا اضافه‌دریافت ثبت نشده است.',
      amount: lifecycle?.issuedLifecycleOther
    },
    storeCreditExpired: {
      label: 'ماندهٔ اعتبارهای منقضی تا پایان بازه',
      hint: 'snapshot باقی‌ماندهٔ اعتبارهایی که تا پایان بازه منقضی شده‌اند.',
      amount: lifecycle?.expired
    },
    storeCreditExpiredInRange: {
      label: 'ماندهٔ اعتبارهای منقضی‌شده در بازه',
      hint: 'فقط باقی‌ماندهٔ اعتبارهایی که تاریخ انقضایشان داخل بازهٔ انتخاب‌شده است.',
      amount: lifecycle?.expiredInRange ?? lifecycle?.expired
    },
    storeCreditCanceled: {
      label: 'اعتبارهای لغوشده',
      hint: 'مبلغ اولیهٔ اعتبارهای لغوشده تا پایان بازه.',
      amount: lifecycle?.canceled
    }
  }
  const lifecycleOfficial = lifecycleAmounts[key]
  if (lifecycleOfficial) {
    return {
      label: lifecycleOfficial.label,
      hint: lifecycleOfficial.hint,
      totalAmount: n(lifecycleOfficial.amount),
      basis: 'RANGE',
      pageCoversRange: true
    }
  }

  const row = report?.accounting?.bridge?.rows?.find((candidate: any) => candidate?.key === key)
  if (!row) return null
  return {
    label: String(row.label ?? key),
    hint: String(row.hint ?? ''),
    totalAmount: n(row.amount),
    basis: 'RANGE',
    pageCoversRange: true
  }
}

export const financialInspectorService = {
  async sources(raw: unknown): Promise<FinancialSourceResponse> {
    await assertPanelUnlocked(PANEL, 'دیدن منابع ریزبین مالی گزارش فروش')
    const request = asRecord(raw) as Partial<FinancialSourceRequest>
    const scope = cleanFinancialScope(request.scope)
    const key = cleanKey(request.key)
    const skip = cleanSkip(request.skip)
    const take = cleanTake(request.take)
    const sort = cleanSort(request.sort)
    const search = cleanSearch(request.search)

    /** مبلغ/عنوان فقط از گزارش authoritative گرفته می‌شود؛ هیچ aggregate تازه‌ای نداریم. */
    const report: any = await salesService.reportRows({ ...scope, take: 1, skip: 0 })
    const official = officialAmountOf(report, key)
    if (!official) throw new BusinessError('این ریز مبلغ مالی در گزارش انتخاب‌شده وجود ندارد.')

    const all = await allSources(scope, key)
    const query = search.toLocaleLowerCase('fa')
    const filtered = query
      ? all.filter((source) => `${source.label} ${source.id} ${source.receiptNo ?? ''} ${source.invoiceId ?? ''}`.toLocaleLowerCase('fa').includes(query))
      : all
    const rows = sortRows(
      filtered.map((source): FinancialSourceRow => ({
        ref: { kind: source.kind, id: source.id, subKind: source.subKind },
        documentLabel: source.label,
        amount: source.amount,
        dateJalali: source.dateJalali,
        invoiceId: source.invoiceId,
        receiptNo: source.receiptNo,
        effect: effectOf(source, key)
      })),
      sort
    )
    const pageRows = rows.slice(skip, skip + take)
    const sourceAmount = filtered.reduce((sum, source) => sum + Number(source.amount || 0), 0)
    const totalAmount = official.totalAmount
    const difference = totalAmount - sourceAmount
    const result: FinancialSourceResult = {
      key,
      label: official.label,
      hint: official.hint,
      basis: official.basis,
      pageCoversRange: official.pageCoversRange,
      totalAmount,
      sourceAmount,
      totalCount: all.length,
      filteredCount: rows.length,
      page: { skip, take, totalCount: rows.length, truncated: skip + pageRows.length < rows.length },
      sort,
      search,
      reconciles: !search && difference === 0,
      difference,
      sources: pageRows
    }
    return { ok: true, result }
  },

  /**
   * L3: قبل از خواندن جزئیات، عضویت ref در همان ردیف و همان scope دوباره سمت
   * server اثبات می‌شود. بنابراین ارسال مستقیم یک id دلخواه از Renderer راه
   * دسترسی به سند مالی خارج از گزارش نیست.
   */
  async document(raw: unknown): Promise<FinancialDocumentResponse> {
    await assertPanelUnlocked(PANEL, 'دیدن شناسنامهٔ سند در ریزبین مالی')
    const request = asRecord(raw) as Partial<FinancialDocumentRequest>
    const scope = cleanFinancialScope(request.scope)
    const key = cleanKey(request.key)
    const ref = asRecord(request.ref)
    const id = cleanedPositiveInt(ref.id)
    const kind = cleanedText(ref.kind, 40)
    if (!id || !kind) throw new BusinessError('مرجع سند مالی نامعتبر است.')

    const source = (await allSources(scope, key)).find((candidate) => candidate.id === id && candidate.kind === kind)
    if (!source) throw new BusinessError('این سند عضو عدد مالی انتخاب‌شده در بازهٔ جاری نیست.')
    return { ok: true, detail: await documentForSource(source) }
  }
}
