import { CreditSource, creditIssueReasonOf, CREDIT_ISSUE_REASON_LABELS } from '@shared/credit'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import {
  calculateAccrualStatement,
  calculateCashStatement,
  calculateReconciliationBridge,
  normalizeSettlement,
  receiptBucketOf,
  unknownLikelyBucketOf,
  type ChequeTotals,
  type PaymentTotals,
  type ReturnTotals,
  type StoreCreditTotals
} from '@shared/accounting'
import {
  PaymentKind,
  PaymentEntryKind,
  ChequeStatus,
  ReturnKind,
  RefundMethod,
  StoreCreditStatus,
  CashMovementType,
  orderTypesForChannels
} from '@shared/enums'
import { toJalaliDate, toClock, money, faDigits, jalaliStartOfDay } from '@shared/jalali'
import { remainingOf, isSimpleReturn, refundFromReceivedOf, exchangeRefundPartOf, exchangeDebtReductionOf } from '@shared/settlement'
import { debtAdjustmentsByInvoice, adjustmentsOrEmpty } from './invoiceDebt'
import { creditIdsForReportScope } from './creditReportScope'
import { bridgeDrillPager } from '@shared/reportExtraOutput'
import { eventInvoiceContextWhere, paymentEventOwnerWhere, resolveReportEventShiftIds, resolveReportPeriod, returnEventOwnerWhere, reportEventInvoiceStatusWhere, financialStatementInvoiceWhere, excludedStatusStatementWarning, saleWhere } from './SalesService'
import type {
  SaleAccountingStatements,
  SaleBridgeRow,
  SaleBridgeSource,
  SaleReportFilter,
  SaleReportPeriod,
  SaleReportPage,
  StoreCreditUsageStory
} from '@shared/types'
import { toNumberRial } from '@shared/money'

/**
 * ===========================================================================
 * جلسه ۱۴ — سازنده‌ی هفت «صورت» گزارش فروش، تماماً با aggregate/groupBy.
 *
 * ================== چرا این فایل اصلاً وجود دارد؟ ==================
 * باگ بند ۲-۵ سند مرجع: `reportRows` ردیف‌ها را با `take` می‌خواند و جمع‌ها را
 * از همان ردیف‌های *برش‌خورده* حساب می‌کرد. برای گزارش ماهانه‌ی یک فروشگاه
 * شلوغ، جمع‌ها بی‌هیچ هشداری غلط می‌شدند — دقیقاً همان‌جایی که کسری واقعی
 * می‌تواند لای «برشِ نامرئی» گم شود.
 *
 * قاعده‌ی این فایل: **هیچ عددی از ردیف‌های صفحه‌بندی‌شده حساب نمی‌شود.** هر جمع
 * یا با `aggregate`/`groupBy` روی کل بازه گرفته می‌شود، یا با یک اسکن *بسته* که
 * سقفش را صریحاً به‌عنوان هشدار برمی‌گرداند.
 *
 * ================== چرا `invoice: <where>` و نه فهرست شناسه؟ ==================
 * فیلترهای کانال/شیفت/فروشنده/مشتری همان `SaleInvoiceWhereInput` گزارش‌اند و از
 * طریق relation به پرداخت و برگشت پاس می‌شوند. اگر فهرست شناسه می‌ساختیم، برای
 * ده‌ها هزار فاکتور یا SQLite را می‌شکست یا خودش یک سقفِ نامرئی دیگر می‌شد.
 * `StoreCredit` تنها جدولی است که relation ندارد (همه‌ی کلیدهایش scalar است)؛
 * تفکیک‌ناپذیریِ آن در `notes` صریح اعلام می‌شود، بی‌صدا نادیده گرفته نمی‌شود.
 *
 * ================== فرمول‌ها کجا هستند؟ ==================
 * اینجا **هیچ فرمول مالی نوشته نشده**. این فایل فقط داده‌ی خام را جمع می‌کند و
 * به `src/shared/accounting.ts` می‌دهد. `netAccrualSales`, `netCashMovement` و
 * پل تطبیق همه از همان فایل برمی‌گردند.
 * ===========================================================================
 */

/** اندازه‌ی هر صفحه‌ی اسکنِ بدهی؛ سقف مالی نیست و تا پایان مجموعه تکرار می‌شود. */
const UNSETTLED_SCAN_PAGE_SIZE = 5_000
/** سقف امنِ فهرست شناسه برای جداول بدون relation (StoreCredit). */
const ID_LIST_CAP = 20_000

export interface StatementScope {
  /** همان where گزارش (فیلترهای کانال/شیفت/فروشنده/مشتری/وضعیت) */
  where: Prisma.SaleInvoiceWhereInput
  /** بازه‌ی مؤثر؛ `from`/`to` می‌توانند null باشند (بدون بازه) */
  from: Date | null
  to: Date | null
  period: SaleReportPeriod
  filter: SaleReportFilter
  /** شناسه‌های واقعی نشست برای `shiftNumber`؛ شماره در هر روز تکرار می‌شود. */
  eventShiftIds?: readonly number[] | null
  /** گردش نقدی خارج از فروش (برداشت/واریز) — از CashMovement */
  withdrawals?: number
  deposits?: number
}

/**
 * اسکوپ فقط‌خواندنیِ ریزبین مالی. این helper همان تاریخ مؤثر، دروازهٔ وضعیت و
 * مالک رویدادِ `buildStatements` را نگه می‌دارد تا هیچ سندی بیرون از معنای عدد
 * گزارش به مدیر نمایش داده نشود. حرکت‌های خارج از فروش برای خواندن منابع پل
 * لازم نیستند و صفر هستند؛ SalesService هنگام ساخت خود گزارش مقدار واقعی را
 * تزریق می‌کند.
 */
export async function resolveAccountingReadScope(filter: SaleReportFilter): Promise<StatementScope> {
  const where = saleWhere(filter)
  const period = await resolveReportPeriod(filter, where)
  const gatedScope: StatementScope = {
    where: financialStatementInvoiceWhere(where, filter),
    from: period.from,
    to: period.to,
    period: {
      fromJalali: period.from ? toJalaliDate(period.from) : null,
      toJalali: period.to ? toJalaliDate(period.to) : null,
      source: period.source
    },
    filter,
    withdrawals: 0,
    deposits: 0
  }
  return { ...gatedScope, eventShiftIds: await resolveReportEventShiftIds(filter) }
}

/**
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` عمداً اضافه شد و عمداً از `toNumberRial` می‌گذرد.
 *
 * مسیر قدیمی (`Number(v)`) روی `bigint` هم *کار می‌کرد*، ولی هر مبلغ بالاتر از
 * `Number.MAX_SAFE_INTEGER` را **بی‌صدا** گرد می‌کرد — یعنی همان رفتاری که کل
 * مهاجرت به BigInt برای حذفش انجام شد، از پنجره برمی‌گشت. `toNumberRial` در آن
 * حالت خطا می‌دهد تا عدد غلط روی گزارش ننشیند.
 */
const n = (v: unknown): number =>
  typeof v === 'bigint' ? toNumberRial(v) : Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0

/**
 * ===========================================================================
 * نشست ۱ زنجیره رفع · خوشه A (A1) — «اسکوپ رویداد» از «اسکوپ فاکتور» جدا شد.
 *
 * باگی که این دو تابع رفعش می‌کنند: `scope.where` همان `saleWhere()` گزارش است و
 * داخلش `issuedAt: { gte, lte }` نشسته. همین `where` عیناً به کوئری *رویدادها*
 * پاس می‌شد (`invoice: scope.where` برای پرداخت، برگشت، تعویض و چک). نتیجه:
 * رویدادی که تاریخ خودش در بازه بود ولی فاکتورش قبل از بازه صادر شده بود،
 * کاملاً حذف می‌شد:
 *
 *   • فاکتور ۵۰۰٬۰۰۰ در ۱۴۰۵/۰۱/۳۱ و برگشت ۲۰۰٬۰۰۰ در ۱۴۰۵/۰۲/۰۱ ⇒ گزارش
 *     اردیبهشت برگشت را ۰ نشان می‌داد (درست: ۲۰۰٬۰۰۰).
 *   • وصول نقدی ۷۰۰٬۰۰۰ بابت فاکتور فروردین ⇒ «دریافتی نقد» ۰ بود، در حالی که
 *     همان مبلغ از راه کوئری `prior` در «وصول نسیه‌ی بازه‌های قبل» شمرده می‌شد:
 *     دو عدد ناسازگار از یک پول، و کسری کاذب در بستن صندوق.
 *
 * قاعده‌ی تازه: **هر رویداد فقط با تاریخ خودش اسکوپ می‌شود** (`paidAt`,
 * `clearedAt`, `returnedAt`)؛ فیلترهای غیرتاریخیِ کاربر (شیفت، فروشنده، مشتری،
 * کانال، وضعیت، …) کامل حفظ می‌شوند. صورت *تعهدی* دست‌نخورده روی `issuedAt`
 * می‌ماند، چون «فروش این بازه» تعریفش همان است.
 * ===========================================================================
 */
function stripIssuedAt(where: Prisma.SaleInvoiceWhereInput): Prisma.SaleInvoiceWhereInput {
  const { issuedAt: _dropped, ...rest } = where as Record<string, unknown>
  return rest as Prisma.SaleInvoiceWhereInput
}

/** همان `where` گزارش، بدون قید تاریخ صدور — مبنای همه‌ی کوئری‌های رویداد. */
function eventWhere(scope: StatementScope): Prisma.SaleInvoiceWhereInput {
  return eventInvoiceContextWhere(scope.filter)
}

function paymentScopeWhere(
  scope: StatementScope,
  phase: 'created' | 'cleared'
): Prisma.PaymentWhereInput {
  return paymentEventOwnerWhere(scope.filter, phase, scope.eventShiftIds ?? null)
}

/**
 * ممیزی A99-03 (AUDIT-D28) — فاکتور مرجع برگشت/تعویض در پل: همان eventWhere، ولی «وضعیت» نوار با
 * دروازه‌ی DRAFT/CANCELED (reportEventInvoiceStatusWhere)، هم‌معنای تب برگشت/تعویض. قبلاً با وضعیت
 * «لغو شده» برگشتِ فاکتور لغوشده در پل شمرده می‌شد و تب خالی بود.
 */
function returnInvoiceWhere(scope: StatementScope): Prisma.SaleInvoiceWhereInput {
  return { ...eventWhere(scope), status: reportEventInvoiceStatusWhere(scope.filter.status) }
}

function returnScopeWhere(scope: StatementScope): Prisma.SaleReturnWhereInput {
  return returnEventOwnerWhere(scope.filter, scope.eventShiftIds ?? null)
}

function paymentEventWindowWhere(
  scope: StatementScope,
  range: { gte?: Date; lte?: Date } | undefined
): Prisma.PaymentWhereInput {
  const created = paymentScopeWhere(scope, 'created')
  const cleared = paymentScopeWhere(scope, 'cleared')
  if (!range) return created
  const hasOwner = Object.keys(created).length > 0 || Object.keys(cleared).length > 0
  /**
   * نشست ۲۱۳ · بند ۴-۲ — فیلتر نشست: مالک رویداد ستون نشست است، نه تاریخ کسب‌وکاری.
   * فروش/وصول با `paidAt` دیروز که در شیفت امروز ثبت شده (`createdShiftId` همین
   * نشست) قبلاً با AND روی `paidAt` از نقد مورد انتظار غیب می‌شد و صندوق
   * بی‌کسری بسته می‌شد. الگوی `shiftPaymentsOf`: ردیف با ستون نشست، بدون قید
   * تاریخ؛ ردیف قدیمیِ بدون ستون هنوز با پنجره‌ی زمانی.
   * گزارش روزانه (بدون shiftId) همچنان با paidAt/clearedAt است.
   */
  const shiftOwned =
    scope.filter.shiftId != null ||
    (scope.filter.shiftNumber != null && String(scope.filter.shiftNumber) !== '')
  if (shiftOwned) {
    return {
      OR: [
        created,
        { AND: [{ createdShiftId: null }, { paidAt: range }] },
        {
          AND: [{ kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.CLEARED }, cleared]
        },
        {
          AND: [
            { kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.CLEARED, clearedShiftId: null },
            { clearedAt: range }
          ]
        }
      ]
    }
  }
  return {
    OR: hasOwner
      ? [{ AND: [{ paidAt: range }, created] }, { AND: [{ kind: PaymentEntryKind.CHEQUE, clearedAt: range }, cleared] }]
      : [{ paidAt: range }, { kind: PaymentEntryKind.CHEQUE, clearedAt: range }]
  }
}

/** بازه به شکل فیلتر Prisma؛ `undefined` = بدون قید. */
function dateRange(from: Date | null, to: Date | null): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

/** آیا کاربر فیلتری گذاشته که ذاتاً به فاکتور گره خورده است؟ */
function hasInvoiceScopedFilter(f: SaleReportFilter): boolean {
  return !!(
    f.shiftId != null ||
    f.shiftNumber != null ||
    f.userId != null ||
    f.customerId != null ||
    f.customerSearch ||
    f.status ||
    f.orderType ||
    f.productSearch ||
    orderTypesForChannels(f.channels ?? null) != null
  )
}

/**
 * ---------------------------------------------------------------------------
 * تفکیک پرداخت‌ها با `groupBy` — بدون هیچ سقفی.
 *
 * دو تاریخ، نه یکی: پرداخت نقدی با `paidAt` خودش شمرده می‌شود و چکِ پاس‌شده با
 * `clearedAt` خودش. این همان چیزی است که مالک خواسته: «نسیه‌ای که ماه بعد وصول
 * شد باید در گزارش ماه بعد بیاید، نه ماه صدور».
 *
 * `priorPeriod` = پولی که در این بازه دریافت شد ولی فاکتورش *قبل* از بازه صادر
 * شده بود. یک کوئری جداگانه با `invoice.issuedAt < from` می‌گیردش، چون گروه‌بندی
 * روی تاریخ فاکتور در `groupBy` ممکن نیست.
 * ---------------------------------------------------------------------------
 */
async function paymentStatement(
  scope: StatementScope,
  notes: string[]
): Promise<{ totals: PaymentTotals; cheques: ChequeTotals }> {
  const range = dateRange(scope.from, scope.to)
  /** A1 — رویداد با تاریخ خودش، نه با تاریخ صدور فاکتور. */
  const invWhere = eventWhere(scope)
  /**
   * B1 — `Payment` منفی (بازپرداخت‌های داده‌ی قدیمی) از *همه‌ی* جمع‌های دریافتی
   * بیرون است. اگر داخل می‌ماند، `_sum.amount` همان بازپرداخت را از دریافتیِ نقد
   * کم می‌کرد و سند برگشت/تعویض یک بار دیگر هم کمش می‌کرد ⇒ دو بار.
   */
  const positive = { amount: { gt: 0 } }

  /**
   * کار الف (جلسه ۳۶) — `destination` هم کلید گروه‌بندی شد. بدون آن، تفکیک
   * «کارت / نقد / حساب مدیر» فقط با یک اسکن ردیف‌به‌ردیف ممکن بود و قاعده‌ی سختِ
   * این فایل («هیچ عددی از ردیف‌های صفحه‌بندی‌شده حساب نمی‌شود») می‌شکست.
   */
  const rows = await prisma.payment.groupBy({
    by: ['methodId', 'kind', 'chequeStatus', 'destination'],
    where: { invoice: invWhere, voidedAt: null, ...positive, ...paymentEventWindowWhere(scope, range) },
    _sum: { amount: true, overpayAmount: true }
  })

  /** همان ردیف‌های منفیِ کنارگذاشته‌شده، صریح و قابل نمایش — نه بی‌صدا. */
  const legacyNegative = await prisma.payment.aggregate({
    where: { invoice: invWhere, voidedAt: null, amount: { lt: 0 }, ...paymentEventWindowWhere(scope, range) },
    _sum: { amount: true },
    _count: { _all: true }
  })

  const methodIds = [...new Set(rows.map((r) => r.methodId))]
  const methods = methodIds.length
    ? await prisma.paymentMethod.findMany({ where: { id: { in: methodIds } }, select: { id: true, kind: true } })
    : []
  const kindOf = new Map(methods.map((m) => [m.id, m.kind ?? PaymentKind.CUSTOM]))

  const totals: PaymentTotals = {
    cash: 0, card: 0, credit: 0, other: 0, exchangeCredit: 0, storeCredit: 0,
    registeredCheques: 0, clearedCheques: 0, pendingCheques: 0, bouncedCheques: 0,
    currentPeriod: 0, priorPeriod: 0, priorPeriodCash: 0, priorPeriodCard: 0, priorPeriodOther: 0,
    priorClearedCheques: 0, priorManagerAccount: 0, priorDestinationUnknown: 0,
    // نشست ۱۸۵ · بند ۴-۲۴ — زیرمجموعه‌ی «نامشخص» که احتمالاً پول کشو بوده
    unknownLikelyCash: 0,
    clearedCashCheques: 0, clearedCardCheques: 0, clearedManagerCheques: 0, clearedUnknownCheques: 0,
    managerAccount: 0, destinationUnknown: 0, ignoredNonCash: 0, legacyNegativePayments: 0,
    overpayReceived: 0, priorPeriodOverpay: 0
  }
  totals.legacyNegativePayments = Math.abs(n(legacyNegative._sum.amount))
  if (totals.legacyNegativePayments > 0)
    notes.push(
      `${n(legacyNegative._count?._all)} پرداختیِ منفیِ داده‌ی قدیمی (جمعاً ${totals.legacyNegativePayments} ریال) ` +
        'در «دریافتی» شمرده نشد. این ردیف‌ها بازپرداخت‌اند و از سند برگشت/تعویض خودشان خوانده می‌شوند؛ ' +
        'اگر در «دریافتی» می‌ماندند، هر بازپرداخت دو بار از صندوق کم می‌شد.'
    )

  for (const r of rows) {
    const amount = n(r._sum.amount)
    /**
     * نشست ۵۸ · C4 — اضافه‌دریافت از همین aggregate (نه ردیف صفحه). چکِ
     * پاس‌نشده و مصرف اعتبار پول واقعی نیستند و recalcPaymentOverpay برایشان صفر
     * می‌نویسد؛ این شرط فقط محافظ داده‌ی قدیمی است.
     */
    const isRealMoney = r.kind === PaymentEntryKind.CHEQUE
      ? r.chequeStatus === ChequeStatus.CLEARED
      : !['exchangeCredit', 'storeCredit'].includes(
          receiptBucketOf({ isCheque: false, destination: r.destination, methodKind: kindOf.get(r.methodId) ?? PaymentKind.CUSTOM })
        )
    if (isRealMoney) totals.overpayReceived = n(totals.overpayReceived) + Math.max(0, n(r._sum.overpayAmount))
    if (r.kind === PaymentEntryKind.CHEQUE) {
      if (r.chequeStatus === ChequeStatus.BOUNCED) totals.bouncedCheques += amount
      else if (r.chequeStatus === ChequeStatus.CLEARED) {
        totals.clearedCheques += amount
        /**
         * کار الف — تفکیک چکِ پاس‌شده بر اساس مقصد. تا جلسه ۳۵ کل این مبلغ در
         * `clearedCashCheques` می‌نشست، یعنی «فرض می‌کنیم نقد آمده» — حتی برای
         * چکی که پولش به حساب مدیر رفته بود.
         */
        switch (receiptBucketOf({ isCheque: true, destination: r.destination, methodKind: PaymentKind.CUSTOM })) {
          case 'cash': totals.clearedCashCheques += amount; break
          case 'card': totals.clearedCardCheques += amount; break
          case 'managerAccount': totals.clearedManagerCheques += amount; break
          default: totals.clearedUnknownCheques += amount
        }
      } else totals.pendingCheques += amount
      totals.registeredCheques += amount
      continue
    }
    const mk = kindOf.get(r.methodId) ?? PaymentKind.CUSTOM
    switch (receiptBucketOf({ isCheque: false, destination: r.destination, methodKind: mk })) {
      case 'exchangeCredit': totals.exchangeCredit += amount; totals.ignoredNonCash += amount; break
      case 'storeCredit': totals.storeCredit += amount; totals.ignoredNonCash += amount; break
      case 'cash': totals.cash += amount; break
      case 'card': totals.card += amount; break
      case 'credit': totals.credit += amount; break
      case 'managerAccount': totals.managerAccount += amount; break
      /**
       * 🔴 نشست ۱۸۵ — سبد «نامشخص» شاخه‌ی خودش را نداشت و در `other` می‌افتاد.
       *
       * این یک ناسازگاری از-قبل-موجود بین دو پیاده‌سازی بود: همین محاسبه در
       * `calculatePaymentTotals` (فایل `shared/accounting.ts`) شاخه‌ی
       * `destinationUnknown` را داشت، ولی این حلقه‌ی موازی نداشت. تا وقتی تنها
       * منبعِ «نامشخص» چکِ بی‌مقصد بود کسی متوجه نشد، چون چک بالاتر جدا
       * شمرده می‌شود. با تصمیم بند ۴-۲۴ (پرداخت بی‌مقصد هم «نامشخص» است)
       * این شکاف بی‌صدا عدد را در ستون اشتباه می‌نشاند.
       */
      case 'unknown':
        totals.destinationUnknown += amount
        // ستون کمکی «احتمالاً نقد» تا نقد مورد انتظار کسری دروغ نسازد (بند ۴-۲۴)
        if (unknownLikelyBucketOf({ isCheque: false, destination: r.destination, methodKind: mk }) === 'cash')
          totals.unknownLikelyCash = n(totals.unknownLikelyCash) + amount
        break
      default: totals.other += amount
    }
  }

  // وصول نسیه‌ی بازه‌های قبل (بند ۳-د-۴) — پول واقعیِ این بازه، فروشِ این بازه نه.
  if (scope.from) {
    const prior = await prisma.payment.groupBy({
      by: ['methodId', 'kind', 'chequeStatus', 'destination'],
      where: {
        invoice: { ...invWhere, issuedAt: { lt: scope.from } },
        // ممیزی A88-03 — پرداخت باطل‌شده «وصول نسیه‌ی دوره‌ی قبل» نیست
        voidedAt: null,
        ...positive,
        /**
         * نشست ۱۹۴ · M-2 — `paymentEventWindowWhere` خودش فاز created و cleared
         * را جدا می‌کند. شرط created سطح‌بالا چکی را که در شیفت ۱ ثبت و در شیفت ۲
         * پاس شده از «وصول نسیه‌ی دوره‌ی قبل» حذف می‌کرد، در حالی که groupBy اصلی
         * همان را درست می‌شمرد.
         */
        ...paymentEventWindowWhere(scope, range)
      },
      _sum: { amount: true, overpayAmount: true }
    })
    const priorMethodIds = [...new Set(prior.map((r) => r.methodId))]
    const priorMethods = priorMethodIds.length
      ? await prisma.paymentMethod.findMany({ where: { id: { in: priorMethodIds } }, select: { id: true, kind: true } })
      : []
    const priorKindOf = new Map(priorMethods.map((m) => [m.id, m.kind ?? PaymentKind.CUSTOM]))
    for (const r of prior) {
      const amount = n(r._sum.amount)
      /**
       * نشست ۵۸ · C4 — اضافه‌دریافتِ وصولِ فاکتور دوره‌ی قبل، داخل «وصول نسیه‌ی
       * بازه‌های قبل» (کل مبلغ) از پل کم شده؛ پس از ردیف اضافه‌دریافت بیرون می‌رود
       * تا دو بار کم نشود. همان شرط «پول واقعی» بالا.
       */
      const priorBucket = r.kind === PaymentEntryKind.CHEQUE ? null
        : receiptBucketOf({ isCheque: false, destination: r.destination, methodKind: priorKindOf.get(r.methodId) ?? PaymentKind.CUSTOM })
      const priorReal = r.kind === PaymentEntryKind.CHEQUE
        ? r.chequeStatus === ChequeStatus.CLEARED
        : priorBucket !== 'exchangeCredit' && priorBucket !== 'storeCredit'
      if (priorReal) totals.overpayReceived = n(totals.overpayReceived) - Math.max(0, n(r._sum.overpayAmount))
      /**
       * ⚠️ کار الف (جلسه ۳۶) — `priorPeriod` مستقیم به `priorCashSettlements`
       * بستن صندوق می‌رود، یعنی به «نقد مورد انتظار». پس دریافتیِ مقصد‌مدیر
       * حتماً باید از این عدد بیرون بماند، وگرنه همان باگی که این کار رفعش
       * می‌کند از در پشتی برمی‌گردد: پولی که به صندوق نیامده، انتظار صندوق را
       * بالا می‌برد و صندوق کسری نشان می‌دهد.
       */
      if (r.kind === PaymentEntryKind.CHEQUE) {
        // فقط چکی که *در این بازه* پاس شده، پول واقعی است
        if (r.chequeStatus === ChequeStatus.CLEARED) {
          const bucket = receiptBucketOf({ isCheque: true, destination: r.destination, methodKind: PaymentKind.CUSTOM })
          /** نشست ۱۶۱ · Y18 · بند ۴-۲۴ — «نامشخص» هم مثل حساب مدیر وصولِ صندوق نیست */
          /** نشست ۱۶۱ · Y19 — ولی ردیف منفی جدای پل را می‌سازند */
          if (bucket === 'managerAccount') { totals.priorManagerAccount = n(totals.priorManagerAccount) + amount; continue }
          if (bucket === 'unknown') { totals.priorDestinationUnknown = n(totals.priorDestinationUnknown) + amount; continue }
          totals.priorClearedCheques += amount
          totals.priorPeriod += amount
          /** نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی؛ سهم اضافه‌دریافتِ همین مبلغ */
          totals.priorPeriodOverpay = n(totals.priorPeriodOverpay) + Math.max(0, n(r._sum.overpayAmount))
          if (bucket === 'cash') totals.priorPeriodCash += amount
          else if (bucket === 'card') totals.priorPeriodCard += amount
          else totals.priorPeriodOther += amount
        }
        continue
      }
      const mk = priorKindOf.get(r.methodId) ?? PaymentKind.CUSTOM
      const bucket = receiptBucketOf({ isCheque: false, destination: r.destination, methodKind: mk })
      // مصرف اعتبار خرید پول نقد نیست و در «وصول نسیه» شمرده نمی‌شود
      if (bucket === 'storeCredit' || bucket === 'exchangeCredit') continue
      // پولی که به حساب مدیر رفته هم «وصول به صندوق» نیست
      // نشست ۱۶۱ · Y19 — ولی ردیف منفی جدای پل را می‌سازد
      if (bucket === 'managerAccount') { totals.priorManagerAccount = n(totals.priorManagerAccount) + amount; continue }
      totals.priorPeriod += amount
      /** نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی؛ سهم اضافه‌دریافتِ همین مبلغ (هیچ جمعی آن را نمی‌خواند) */
      totals.priorPeriodOverpay = n(totals.priorPeriodOverpay) + Math.max(0, n(r._sum.overpayAmount))
      if (bucket === 'cash') totals.priorPeriodCash += amount
      else if (bucket === 'card') totals.priorPeriodCard += amount
      else totals.priorPeriodOther += amount
    }
  }
  /**
   * کار الف — «دریافتیِ همین بازه». مقصد‌مدیر و «نامشخص» در این عدد نمی‌آیند:
   * `currentPeriod` مبنای دریافتیِ *فروشگاه* است و پولی که به حساب مدیر رفته به
   * فروشگاه نرسیده. (ردیف جدای خودش را در گزارش دارد.)
   */
  /**
   * نشست ۱۶۵ · Y23 · S165-D1 — cash/card/credit/other بالا هیچ چکی ندارند (چک فقط در سبدهای چک می‌نشیند)،
   * پس سهم چکِ پاس‌شده‌ی دوره‌ی قبل (priorClearedCheques) نباید از آن‌ها کم شود؛ وگرنه «وصول همین دوره» به
   * اندازه‌ی آن چک کم نشان داده می‌شد. با قاعده‌ی فعلی receiptBucketOf این سهم همیشه ۰ است (اثر امروز صفر)،
   * ولی فرمول دیگر به آن قاعده وابسته نیست. تست: tests/audit-fixes/fix-y23-settled-current.mjs
   */
  totals.currentPeriod = totals.cash + totals.card + totals.credit + totals.other - (totals.priorPeriod - totals.priorClearedCheques)

  // ---- بلوک چک: چهار وضعیت، همیشه، حتی صفر (بند ۳-ه) ----
  const at = scope.to ?? new Date()
  /**
   * نشست ۱۸۹ · ۱-۷ — سررسید «امروز» وسط روز معوق نیست.
   * `dueDate` اغلب ابتدای همان روز شمسی (۰۰:۰۰) یا ظهر است؛ مقایسه‌ی `lt: now`
   * چکِ سررسید امروز را از صبح «معوق» نشان می‌داد.
   */
  const dueCutoff = jalaliStartOfDay(toJalaliDate(at))
  const cheques: ChequeTotals = {
    registered: 0, cleared: 0, pendingPastDue: 0, pendingFuture: 0, bounced: 0, pending: 0,
    pastDueCount: 0, futureCount: 0,
    clearedToCash: 0, clearedToCard: 0, clearedToManager: 0, clearedUnknown: 0,
    warnings: []
  }
  // ثبت‌شده در بازه (اثر نقدی صفر) — بر اساس paidAt خود چک
  const registered = await prisma.payment.aggregate({
    where: { invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, ...positive, ...paymentScopeWhere(scope, 'created'), ...(range ? { paidAt: range } : {}) },
    _sum: { amount: true }
  })
  cheques.registered = n(registered._sum.amount)
  // پاس‌شده در بازه — بر اساس clearedAt، نه issuedAt فاکتور
  const cleared = await prisma.payment.aggregate({
    where: {
      invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.CLEARED, ...positive,
      ...paymentScopeWhere(scope, 'cleared'),
      ...(range ? { clearedAt: range } : {})
    },
    _sum: { amount: true }
  })
  cheques.cleared = n(cleared._sum.amount)
  /**
   * ============== کار الف (جلسه ۳۶): چکِ پاس‌شده به تفکیک مقصد ==============
   * عمداً یک `groupBy` جدا با **همان `where`ِ بالا** (یعنی `clearedAt` در بازه)،
   * نه از `rows`ِ ابتدای تابع: آن کوئری `OR: [paidAt, clearedAt]` است و برای
   * چکی که پاس‌شدنش بیرون بازه افتاده عدد دیگری می‌دهد. چون این چهار عدد باید
   * **دقیقاً** `cheques.cleared` را بسازند، منبعشان هم باید همان باشد.
   */
  const clearedByDest = await prisma.payment.groupBy({
    by: ['destination'],
    where: {
      invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.CLEARED, ...positive,
      ...paymentScopeWhere(scope, 'cleared'),
      ...(range ? { clearedAt: range } : {})
    },
    _sum: { amount: true }
  })
  for (const r of clearedByDest) {
    const amount = n(r._sum.amount)
    switch (receiptBucketOf({ isCheque: true, destination: r.destination, methodKind: PaymentKind.CUSTOM })) {
      case 'cash': cheques.clearedToCash += amount; break
      case 'card': cheques.clearedToCard += amount; break
      case 'managerAccount': cheques.clearedToManager += amount; break
      default: cheques.clearedUnknown += amount
    }
  }
  // برگشت‌خورده (اثر نقدی صفر، هشدار قرمز)
  const bounced = await prisma.payment.aggregate({
    where: { invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.BOUNCED, ...positive, ...paymentScopeWhere(scope, 'created'), ...(range ? { paidAt: range } : {}) },
    _sum: { amount: true }
  })
  cheques.bounced = n(bounced._sum.amount)
  // در جریان: سررسیدگذشته و سررسیدنرسیده، جدا — «در جریان» بازه‌ای نیست، «تا این لحظه» است
  const pastDue = await prisma.payment.aggregate({
    where: { invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.PENDING, ...positive, ...paymentScopeWhere(scope, 'created'), dueDate: { lt: dueCutoff } },
    _sum: { amount: true }, _count: { _all: true }
  })
  const future = await prisma.payment.aggregate({
    where: {
      invoice: invWhere, voidedAt: null, kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.PENDING, ...positive,
      ...paymentScopeWhere(scope, 'created'),
      OR: [{ dueDate: { gte: dueCutoff } }, { dueDate: null }]
    },
    _sum: { amount: true }, _count: { _all: true }
  })
  cheques.pendingPastDue = n(pastDue._sum.amount)
  cheques.pastDueCount = n(pastDue._count?._all)
  cheques.pendingFuture = n(future._sum.amount)
  cheques.futureCount = n(future._count?._all)
  cheques.pending = cheques.pendingPastDue + cheques.pendingFuture
  if (cheques.pendingPastDue > 0)
    cheques.warnings.push(`${cheques.pastDueCount} چک در جریان سررسیدشان گذشته است و هنوز پاس نشده‌اند.`)
  if (cheques.bounced > 0) cheques.warnings.push('در این بازه چک برگشتی ثبت شده است.')

  return { totals, cheques }
}

/**
 * ---------------------------------------------------------------------------
 * تفکیک برگشت و تعویض با `groupBy` — بر مبنای `returnedAt`، نه تاریخ فاکتور.
 *
 * برگشت ساده و تعویض دو سبد کاملاً جدا دارند (بند ۲-۳). تعویض هرگز به‌عنوان
 * «برگشت ساده» از `netAccrualSales` کم نمی‌شود.
 *
 * برگشت‌های قدیمی `refundMethod` ندارند. **فرضِ محافظه‌کارانه و مستند:** آن‌ها
 * «کاهنده‌ی بدهی» (`debtOnlyReturns`) شمرده می‌شوند، نه خروج وجه نقد — چون
 * ادعای «پول از کشو بیرون رفت» بدون سند، کسری کاذب می‌سازد. تعدادشان در
 * `legacyAssumedCount` برمی‌گردد و UI برچسب «فرض‌شده از داده‌ی قدیمی» می‌زند.
 * ---------------------------------------------------------------------------
 */
async function returnStatement(scope: StatementScope): Promise<ReturnTotals & { legacyAssumedCount: number; returnCount: number; exchangeCount: number }> {
  const range = dateRange(scope.from, scope.to)
  const rows = await prisma.saleReturn.groupBy({
    by: ['kind', 'refundMethod', 'exchangeSettlement'],
    /** A1 — برگشت با `returnedAt` خودش اسکوپ می‌شود، نه با تاریخ صدور فاکتور. */
    where: { invoice: returnInvoiceWhere(scope), ...returnScopeWhere(scope), voidedAt: null, ...(range ? { returnedAt: range } : {}) },
    _sum: { total: true, refundAmount: true, exchangeTotal: true, exchangeDiff: true, debtReduction: true },
    _count: { _all: true }
  })

  const out = {
    simpleReturns: 0, exchangeReturned: 0, exchangeReplacement: 0, cashRefunds: 0,
    cardRefunds: 0, storeCreditIssued: 0, debtOnlyReturns: 0, exchangeDiffReceived: 0,
    exchangeCashRefunds: 0, exchangeCardRefunds: 0, exchangeStoreCreditIssued: 0,
    /* جلسه ۲۴ — این دو عضوِ `ReturnTotals` از جلسه ۱۷ جا افتاده بود و build را می‌شکست.
       تفکیک عیناً مثل `calculateReturnTotals` در `src/shared/accounting.ts`: کارت‌به‌کارت
       مدیر نه نقد است، نه کارتِ کارت‌خوان، نه اعتبار خرید — یک تعهد پرداخت. */
    cardToCardPending: 0, exchangeCardToCardPending: 0,
    count: 0, legacyAssumedCount: 0, returnCount: 0, exchangeCount: 0
  }

  for (const r of rows) {
    const total = Math.max(0, n(r._sum.total))
    const count = n(r._count?._all)
    out.count += count
    if (r.kind === ReturnKind.EXCHANGE) {
      out.exchangeCount += count
      out.exchangeReturned += total
      out.exchangeReplacement += Math.max(0, n(r._sum.exchangeTotal))
      const diff = n(r._sum.exchangeDiff)
      if (diff > 0) out.exchangeDiffReceived += diff
      if (diff < 0) {
        /**
         * B1 — همان نگاشت واحدِ `@shared/accounting`. تا این نشست فقط `CASH` و
         * `CARD` شناخته می‌شدند، ولی نویسنده‌ی سند `CASH_REFUND`/`CARD_REFUND`
         * می‌نوشت ⇒ هر بازپرداخت نقدیِ تعویض در سبد «اعتبار خرید» می‌نشست.
         */
        const { bucket, legacy } = normalizeSettlement({
          exchangeSettlement: r.exchangeSettlement,
          refundMethod: r.refundMethod
        })
        /**
         * نشست ۶۰ (بند ۴-۵) — فقط بخش *بازپرداخت‌شده*؛ سهم «کاهش بدهی فاکتور اصلی»
         * پول نیست و در هیچ سبد بازپرداختی نمی‌نشیند (در باقی‌مانده‌ی بدهی دیده می‌شود).
         * همه‌ی ردیف‌های یک گروه تسویه‌ی منفی دارند، پس جمع گروهی مجاز است.
         */
        const refunded = exchangeRefundPartOf({ exchangeDiff: diff, debtReduction: n((r._sum as any).debtReduction) })
        if (refunded <= 0) { /* فقط کاهش بدهی */ }
        else if (bucket === 'CASH_REFUND') out.exchangeCashRefunds += refunded
        else if (bucket === 'CARD_REFUND') out.exchangeCardRefunds += refunded
        else if (bucket === 'CARD_TO_CARD') out.exchangeCardToCardPending += refunded
        else out.exchangeStoreCreditIssued += refunded
        if (legacy) out.legacyAssumedCount += count
      }
      continue
    }
    out.returnCount += count
    out.simpleReturns += total
    const refunded = Math.min(total, Math.max(0, n(r._sum.refundAmount) || total))
    if (r.refundMethod === RefundMethod.CASH) out.cashRefunds += refunded
    else if (r.refundMethod === RefundMethod.CARD) out.cardRefunds += refunded
    else if (r.refundMethod === RefundMethod.STORE_CREDIT) out.storeCreditIssued += refunded
    else if (r.refundMethod === RefundMethod.CARD_TO_CARD) out.cardToCardPending += refunded
    else {
      // NONE یا تهی (داده‌ی قدیمی) ⇒ فقط بدهی مشتری کم شد
      out.debtOnlyReturns += total
      if (r.refundMethod == null) out.legacyAssumedCount += count
    }
  }
  /**
   * نشست ۱۸۸ · بازبینی ۱۸۶ مورد ۶ — درخواست کارت‌به‌کارتِ لغوشده هنوز در
   * SaleReturn.refundMethod می‌ماند. پل (`returnBridgeItems`) آن را حذف می‌کند
   * ولی این بلوک نه ⇒ «در انتظار ۱M» دروغ در برابر پل ۰.
   */
  const c2cRets = await prisma.saleReturn.findMany({
    where: {
      invoice: returnInvoiceWhere(scope),
      ...returnScopeWhere(scope),
      voidedAt: null,
      ...(range ? { returnedAt: range } : {}),
      OR: [{ refundMethod: RefundMethod.CARD_TO_CARD }, { exchangeSettlement: 'CARD_TO_CARD' }]
    },
    select: { id: true, kind: true, refundAmount: true, exchangeDiff: true, debtReduction: true, total: true }
  })
  if (c2cRets.length) {
    const canceled = new Set<number>()
    for (let i = 0; i < c2cRets.length; i += 500) {
      const reqs = await (prisma as any).cardTransferRequest.findMany({
        where: { returnId: { in: c2cRets.slice(i, i + 500).map((r) => r.id) }, status: { not: 'PENDING' } },
        select: { returnId: true }
      })
      for (const q of reqs) canceled.add(Number(q.returnId))
    }
    for (const r of c2cRets) {
      if (!canceled.has(r.id)) continue
      const refunded =
        r.kind === ReturnKind.EXCHANGE
          ? exchangeRefundPartOf({ exchangeDiff: n(r.exchangeDiff), debtReduction: n(r.debtReduction) })
          : Math.min(Math.max(0, n(r.total)), Math.max(0, n(r.refundAmount) || n(r.total)))
      if (r.kind === ReturnKind.EXCHANGE) out.exchangeCardToCardPending = Math.max(0, out.exchangeCardToCardPending - refunded)
      else out.cardToCardPending = Math.max(0, out.cardToCardPending - refunded)
    }
  }
  return out
}

/**
 * ---------------------------------------------------------------------------
 * اعتبار خرید. تنها جدولی که relation به فاکتور ندارد (همه scalar است).
 *
 * اگر کاربر فیلتر فاکتوری گذاشته باشد، فهرست شناسه‌ی فاکتورهای بازه ساخته و
 * `sourceInvoiceId`/`exchangeInvoiceId`/`usedInvoiceId` با آن محدود می‌شوند.
 * اگر فهرست از سقف امن بگذرد، *عدد کل بازه* برمی‌گردد و در `notes` صریح نوشته
 * می‌شود «قابل تفکیک نیست» — قاعده‌ی بند ۹.
 * ---------------------------------------------------------------------------
 */
/**
 * نشست ۶۴ · بند ۴-۲۲ — اعتبارهایی که به‌خاطر **ابطال سند برگشتِ مادرشان** باطل
 * شده‌اند. سند برگشت باطل از همه‌ی محاسبه‌ها بیرون است؛ اعتبارِ صادرشده از آن هم
 * «هرگز معتبر صادر نشده» حساب می‌شود، وگرنه ردیف «اعتبار صادرشده» پل را باز
 * می‌گذارد (برگشت رفته ولی اعتبارش کم می‌شود). ابطال دستی یک اعتبار (خوشه D) عمداً
 * اینجا نیست: آن اعتبار واقعاً صادر شده بود.
 */
async function creditIdsOfVoidedReturns(range: { gte?: Date; lte?: Date } | null | undefined): Promise<number[]> {
  const creds = await prisma.storeCredit.findMany({
    where: { status: 'CANCELED', returnId: { not: null }, ...(range ? { issuedAt: range } : {}) },
    select: { id: true, returnId: true }
  })
  if (!creds.length) return []
  const retIds = [...new Set(creds.map((c: any) => Number(c.returnId)))]
  const voided = new Set<number>()
  for (let i = 0; i < retIds.length; i += 500) {
    const rows = await prisma.saleReturn.findMany({
      where: { id: { in: retIds.slice(i, i + 500) }, voidedAt: { not: null } },
      select: { id: true }
    })
    for (const r of rows) voided.add(r.id)
  }
  return creds.filter((c: any) => voided.has(Number(c.returnId))).map((c: any) => c.id)
}

/**
 * نشست ۱۷۴ · S173-D3 — سقف IN گزارش‌ها (۵۰۰، همان REPORT_IN_CHUNK سرویس فروش/کارمند).
 * هیچ فهرست شناسه‌ای بلندتر از این مستقیم در `in` نمی‌نشیند؛ مصرف‌کننده‌ها روی دسته‌های جدا
 * (`idChunkWheres`) جمع/شمارش/خواندن می‌کنند.
 */
const CREDIT_IN_CHUNK = 500
/**
 * سقف خواندن ریز بارکد برای خط کنترل. روز ۱۰۰تایی کامل می‌آید؛ با +/− روی صفحه
 * باز و جمع می‌شود. اگر بازه‌ی سال از این بیشتر شد، بقیه تب اعتبار است نه پنهان‌کاری ۱۲تایی.
 */
const USAGE_STORY_CAP = 5000

/**
 * where پایه + (اگر فهرست شناسه داده شد) یک where برای هر دسته‌ی ۵۰۰تایی.
 * ids = null ⇒ بی‌قید شناسه (همان where پایه)؛ ids = [] ⇒ هیچ where (هیچ ردیفی منطبق نیست).
 * دسته‌ها از یک Set یکتا ساخته می‌شوند، پس جمع روی دسته‌ها هیچ ردیفی را دوبار نمی‌شمارد.
 */
export function idChunkWheres(base: any, ids: number[] | null): any[] {
  if (ids == null) return [base]
  const uniq = [...new Set(ids)]
  const out: any[] = []
  for (let i = 0; i < uniq.length; i += CREDIT_IN_CHUNK)
    out.push({ AND: [base, { id: { in: uniq.slice(i, i + CREDIT_IN_CHUNK) } }] })
  return out
}

/** aggregate روی دسته‌های شناسه: جمع فیلدهای _sum و _count._all، مثل یک aggregate واحد. */
async function aggregateByIdChunks(
  model: 'storeCredit' | 'storeCreditRedemption',
  base: any,
  ids: number[] | null,
  sumFields: string[]
): Promise<{ sum: Record<string, number>; count: number }> {
  const sum: Record<string, number> = Object.fromEntries(sumFields.map((f) => [f, 0]))
  let count = 0
  for (const where of idChunkWheres(base, ids)) {
    const agg: any = await (prisma as any)[model].aggregate({
      where,
      _sum: Object.fromEntries(sumFields.map((f) => [f, true])),
      _count: { _all: true }
    })
    for (const f of sumFields) sum[f] += n(agg?._sum?.[f])
    count += n(agg?._count?._all)
  }
  return { sum, count }
}

/**
 * شناسه‌ی ردیف‌های منطبق (سبک: id + ستون‌های مرتب‌سازی) روی دسته‌های شناسه، یکتا و مرتب با
 * `sort`. مصرف‌کننده صفحه را از همین آرایه می‌بُرد و فقط شناسه‌های صفحه را دسته‌ای می‌خواند
 * (الگوی S172-D3/S173-D1).
 */
export async function liteRowsByIdChunks<T extends { id: number }>(
  model: 'storeCredit' | 'storeCreditRedemption',
  base: any,
  ids: number[] | null,
  select: Record<string, true>,
  sort: (a: T, b: T) => number
): Promise<T[]> {
  const seen = new Set<number>()
  const out: T[] = []
  for (const where of idChunkWheres(base, ids)) {
    const part: T[] = await (prisma as any)[model].findMany({ where, select: { id: true, ...select } })
    for (const r of part) if (!seen.has(Number(r.id))) { seen.add(Number(r.id)); out.push(r) }
  }
  return out.sort(sort)
}

/** خواندن کامل ردیف‌ها برای شناسه‌های یک صفحه، دسته‌ای و به ترتیب همان آرایه‌ی ورودی. */
export async function rowsForIdsInOrder(
  model: 'storeCredit' | 'storeCreditRedemption',
  ids: number[],
  select?: Record<string, true>
): Promise<any[]> {
  const byId = new Map<number, any>()
  for (let i = 0; i < ids.length; i += CREDIT_IN_CHUNK) {
    const part: any[] = await (prisma as any)[model].findMany({
      where: { id: { in: ids.slice(i, i + CREDIT_IN_CHUNK) } },
      ...(select ? { select: { id: true, ...select } } : {})
    })
    for (const r of part) byId.set(Number(r.id), r)
  }
  return ids.map((id) => byId.get(id)).filter((r) => r != null)
}

/**
 * ممیزی A108-02 — predicateهای «اعتبار صادرشده» و «مصرف اعتبار» یک‌جا، تا ردیف پل (aggregate) و
 * اسناد سازنده‌ی همان ردیف (drill-down) از یک where بخوانند: «یک فیلتر، یک عدد».
 *
 * نشست ۱۷۴ · S173-D3 — قبلاً با فیلتر فاکتوری تا ۲۰٬۰۰۰ شناسه‌ی فاکتور مستقیم در OR سه‌تایی
 * `in` (scoped) و `invoiceId in` (redemptionWhere) و تا ۲۰٬۰۰۰ شناسه‌ی اعتبار در issuedScoped
 * می‌نشست ⇒ با ۵۰۱+ فاکتور یک کارمند، پل با خطا می‌افتاد و drill/دفتر مصرف اعتبار خوانده نمی‌شد.
 * حالا شناسه‌ها دسته‌به‌دسته (۵۰۰تایی) به شناسه‌ی *خود* اعتبار/مصرف حل می‌شوند و where ها
 * «پایه» (بی‌فهرست) برمی‌گردند؛ فهرست‌ها در scopedIds / issuedIds / redemptionIds:
 *   null = بی‌قید (بدون فیلتر فاکتوری، یا عبور از سقف امن با یادداشت صریح)،
 *   [] = هیچ ردیف منطبق، آرایه = فقط همین شناسه‌ها (مصرف‌کننده با idChunkWheres جمع می‌زند).
 * ⚠️ هر مصرف‌کننده‌ی تازه *باید* فهرست را هم اعمال کند؛ where پایه به‌تنهایی کل بازه است.
 */
export async function storeCreditScopes(scope: StatementScope, notes: string[]) {
  const range = dateRange(scope.from, scope.to)
  let invoiceIds: number[] | null = null

  if (hasInvoiceScopedFilter(scope.filter)) {
    const acc: number[] = []
    for (let skip = 0; ; skip += ID_LIST_CAP) {
      const ids = await prisma.saleInvoice.findMany({
        where: scope.where, select: { id: true }, skip, take: ID_LIST_CAP
      })
      for (const r of ids) acc.push(r.id)
      if (ids.length < ID_LIST_CAP) break
    }
    invoiceIds = acc
  }

  /** اعتبارهای مرتبط با فاکتورهای فیلتر (source/exchange/used) — دسته‌ای، یکتا */
  let scopedIds: number[] | null = null
  /** مصرف‌های زنده‌ی بازه روی فاکتورهای فیلتر — دسته‌ای، یکتا */
  let redemptionIds: number[] | null = null
  const redemptionBase: any = { reversedAt: null, ...(range ? { at: range } : {}) }
  if (invoiceIds) {
    const sc = new Set<number>()
    const rd = new Set<number>()
    for (let i = 0; i < invoiceIds.length; i += CREDIT_IN_CHUNK) {
      const part = invoiceIds.slice(i, i + CREDIT_IN_CHUNK)
      const creds = await prisma.storeCredit.findMany({
        where: {
          OR: [
            { sourceInvoiceId: { in: part } },
            { exchangeInvoiceId: { in: part } },
            { usedInvoiceId: { in: part } }
          ]
        },
        select: { id: true }
      })
      for (const c of creds) sc.add(Number(c.id))
      const reds = await prisma.storeCreditRedemption.findMany({
        where: { ...redemptionBase, invoiceId: { in: part } },
        select: { id: true }
      })
      for (const r of reds) rd.add(Number(r.id))
    }
    scopedIds = [...sc].sort((a, b) => b - a)
    redemptionIds = [...rd].sort((a, b) => b - a)
  }

  /**
   * نشست ۱۷۵ · S174-D5 — قبلاً این فهرست بی‌سقف در `id notIn` می‌نشست (issuedWhere، issuedOverpay،
   * baseWhere تابع creditIdsForReportScope) ⇒ با ۵۰۱+ اعتبارِ برگشت باطل‌شده در یک بازه، از سقف IN
   * گزارش‌ها (۵۰۰) رد می‌شد و کل پل/drill صادرشده با خطا می‌افتاد. حالا هیچ where ای فهرست باطل را
   * ندارد؛ باطل‌ها در JS از issuedIds کنار گذاشته می‌شوند (پایین) و issuedIds همیشه آرایه‌ی صریح است
   * وقتی باطلی در بازه هست. بدون اعتبار باطل در بازه، مسیر قبلی دست‌نخورده است.
   */
  const voidedCreditIds = await creditIdsOfVoidedReturns(range)
  const voidedSet = new Set<number>(voidedCreditIds.map((x) => Number(x)))
  /**
   * ممیزی A97-01 — «صادرشده» یک رویداد است: مالکش سند برگشت/تعویض (یا صادرکننده و
   * نشست باز لحظه‌ی ثبت)، هویت روی فاکتورهای مرتبط؛ همان helper تب اعتبار. قبلاً
   * از مسیر فاکتور (source/exchange و حتی usedInvoiceId) با بازه‌ی *صدور فاکتور*
   * می‌شمرد ⇒ اعتبار برگشتِ شیفت شب روی فاکتور صبح در پل صبح، و تب ≠ پل.
   */
  let issuedIds: number[] | null = scopedIds
  if (hasInvoiceScopedFilter(scope.filter)) {
    const f = scope.filter
    let ids = await creditIdsForReportScope(
      {
        orderType: f.orderType ?? null,
        channels: f.channels ?? null,
        receiptNo: f.receiptNo ?? null,
        customerSearch: f.customerSearch ?? null,
        customerId: f.customerId ?? null,
        productSearch: f.productSearch ?? null,
        invoiceStatus: f.status ?? null,
        userId: f.userId ?? null,
        shiftId: f.shiftId ?? null,
        shiftNumber: f.shiftNumber ?? null
      },
      { ...(range ? { issuedAt: range } : {}) },
      { overCap: 'return' }
    )
    /** S174-D5 — کنار گذاشتن باطل‌ها پیش از سنجش سقف (همان معنای notIn قبلی) */
    if (ids && voidedSet.size) ids = ids.filter((id) => !voidedSet.has(Number(id)))
    if (ids) {
      issuedIds = [...new Set(ids)].sort((a, b) => b - a)
    }
  }
  const issuedWhere: any = { ...(range ? { issuedAt: range } : {}) }
  /**
   * S174-D5 — اگر باطلی در بازه هست: issuedIds = شناسه‌های صادرشده‌ی بازه (یا فهرست فیلتر) منهای
   * باطل‌ها، به‌صورت آرایه‌ی صریح؛ مصرف‌کننده‌ها (aggregateByIdChunks / liteRowsByIdChunks) روی
   * دسته‌های ۵۰۰تایی جمع می‌زنند. خواندن بی‌فیلتر فقط where پایه‌ی بازه است (بدون هیچ فهرستی).
   */
  if (voidedSet.size) {
    if (issuedIds == null) {
      const all: Array<{ id: number }> = await prisma.storeCredit.findMany({ where: issuedWhere, select: { id: true } })
      issuedIds = all.map((r) => Number(r.id))
    }
    issuedIds = [...new Set(issuedIds.filter((id) => !voidedSet.has(Number(id))))].sort((a, b) => b - a)
  }
  const redemptionWhere: any = redemptionBase
  return {
    range, invoiceIds, scopedIds, issuedIds, issuedWhere,
    redemptionWhere, redemptionIds
  }
}

/**
 * نشست ۱۷۰ · خوشه D · S169-D4 (یادداشت باز S61) — تفکیک اعتبارهای صادرشده‌ی بازه برای پل تطبیق.
 *
 * فقط اعتباری که از یک سند برگشت/تعویض واقعی صادر شده (returnId ≠ null) پشتش کاهشی در فروش
 * خالص (netAccrualSales) هست و باید در ردیف «اعتبار خرید صادرشده»ی پل کم شود. سه نوع دیگر
 * هیچ اثری در فروش یا وجه ندارند و قبلاً پل را به اندازه‌ی مبلغشان باز می‌گذاشتند:
 *   ۱) اعتبار دستی مدیر (issueManual — بی‌سند؛ سرور returnId را از payload حذف می‌کند)
 *   ۲) صدور گروهی (bulkIssue — MANUAL یا EXCHANGE بی‌سند)
 *   ۳) «باقی‌مانده»ی مصرف جزئی اعتبار یک‌بارمصرف: اعتبار جدیدی که returnId اعتبار اصلی را
 *      کپی می‌کند؛ ادامه‌ی همان بدهی است و اعتبار اصلی قبلاً (در بازه‌ی صدور خودش) کم شده.
 * OVERPAY جدا در ردیف «دریافت پول اضافه» است (S61-2) و اینجا نمی‌آید.
 * گزارش اعتبار (بند ۴-۴۸، issued) دست نمی‌خورد؛ این تفکیک فقط برای پل و نمایش است.
 */
async function storeCreditBridgeSplit(issuedWhere: any, issuedIds: number[] | null): Promise<{
  backedIds: number[]
  backed: number
  unbacked: number
  unbackedCount: number
  remainder: number
  remainderCount: number
  overpayRemainder: number
  overpayRemainderCount: number
  /** شناسه‌های سبدهای مانعةالجمع کارت گردش اعتبار، به ترتیب پایدار id نزولی. */
  lifecycleIds: {
    return: number[]
    exchange: number[]
    manual: number[]
    overpay: number[]
    remainder: number[]
    other: number[]
  }
  lifecycle: {
    return: number
    exchange: number
    manual: number
    overpay: number
    remainder: number
    other: number
  }
}> {
  /**
   * نشست ۱۷۱ · S170-D3 — ردیف‌های OVERPAY هم خوانده می‌شوند، فقط برای جدا کردن «باقی‌مانده»ی
   * مصرف جزئی اعتبار اضافه‌دریافت (source=OVERPAY کپی‌شده از والد، issuedAt=روز مصرف) از
   * اعتبار اضافه‌دریافتِ تازه. OVERPAY هرگز وارد backed/unbacked/remainder نمی‌شود (S61-2).
   */
  /** نشست ۱۷۴ · S173-D3 — روی دسته‌های شناسه (issuedIds) و یکتا، به ترتیب id نزولی */
  const rows = await liteRowsByIdChunks<{
    id: number
    amount: any
    returnId: number | null
    exchangeInvoiceId: number | null
    source: string
  }>(
    'storeCredit', { ...issuedWhere }, issuedIds,
    { amount: true, returnId: true, exchangeInvoiceId: true, source: true },
    (a, b) => Number(b.id) - Number(a.id)
  )
  const remainderIds = new Set<number>()
  const ids = rows.map((r) => r.id)
  for (let i = 0; i < ids.length; i += 500) {
    const parents: Array<{ remainderCreditId: number | null }> = await prisma.storeCredit.findMany({
      where: { remainderCreditId: { in: ids.slice(i, i + 500) } },
      select: { remainderCreditId: true }
    })
    for (const p of parents) if (p.remainderCreditId != null) remainderIds.add(Number(p.remainderCreditId))
  }
  const out = {
    backedIds: [] as number[], backed: 0, unbacked: 0, unbackedCount: 0, remainder: 0, remainderCount: 0,
    overpayRemainder: 0, overpayRemainderCount: 0,
    lifecycleIds: {
      return: [] as number[], exchange: [] as number[], manual: [] as number[],
      overpay: [] as number[], remainder: [] as number[], other: [] as number[]
    },
    lifecycle: { return: 0, exchange: 0, manual: 0, overpay: 0, remainder: 0, other: 0 }
  }
  for (const r of rows) {
    const amount = n(r.amount)

    /**
     * کارت گردش نباید یک صدور را دوبار نشان دهد. «باقی‌مانده» همیشه اول تشخیص
     * داده می‌شود، بعد خاستگاه صدور با اولویت اضافه‌دریافت، تعویض، برگشت، دستی
     * و در پایان نامشخص تعیین می‌گردد. این ترتیب با تعریف مورد توافق گزارش یکی
     * است و به جمع issued دقیقاً reconcile می‌شود.
     */
    const lifecycleKey = remainderIds.has(r.id)
      ? 'remainder'
      : r.source === CreditSource.OVERPAY
        ? 'overpay'
        : r.exchangeInvoiceId != null
          ? 'exchange'
          : r.returnId != null
            ? 'return'
            : r.source === CreditSource.MANUAL
              ? 'manual'
              : 'other'
    out.lifecycleIds[lifecycleKey].push(r.id)
    out.lifecycle[lifecycleKey] += amount

    // این بخش، رفتار پیشینِ پل تطبیق را بدون تغییر نگه می‌دارد.
    if (r.source === CreditSource.OVERPAY) {
      if (remainderIds.has(r.id)) { out.overpayRemainder += amount; out.overpayRemainderCount++ }
      continue
    }
    if (remainderIds.has(r.id)) { out.remainder += amount; out.remainderCount++ }
    else if (r.returnId != null) { out.backed += amount; out.backedIds.push(r.id) }
    else { out.unbacked += amount; out.unbackedCount++ }
  }
  return out
}

async function storeCreditUsageStories(
  redemptionWhere: any,
  redemptionIds: number[] | null
): Promise<StoreCreditUsageStory[]> {
  let rows: any[]
  if (redemptionIds) {
    rows = await rowsForIdsInOrder('storeCreditRedemption', redemptionIds.slice(0, USAGE_STORY_CAP))
  } else {
    rows = await prisma.storeCreditRedemption.findMany({
      where: redemptionWhere,
      orderBy: { id: 'desc' },
      take: USAGE_STORY_CAP
    })
  }
  const creditIds = [...new Set(rows.map((r) => Number(r.creditId)).filter((id) => Number.isFinite(id) && id > 0))]
  const credits = new Map<number, any>()
  for (let i = 0; i < creditIds.length; i += CREDIT_IN_CHUNK) {
    const part = await prisma.storeCredit.findMany({ where: { id: { in: creditIds.slice(i, i + CREDIT_IN_CHUNK) } } })
    for (const c of part) credits.set(Number(c.id), c)
  }
  const stories: StoreCreditUsageStory[] = []
  for (const r of rows) {
    const credit = credits.get(Number(r.creditId))
    const reason = creditIssueReasonOf(credit ?? {})
    const issuedAtJalali = String(credit?.issuedAtJalali ?? '') || (credit?.issuedAt ? toJalaliDate(credit.issuedAt) : '—')
    const usedAtJalali = String(r.atJalali ?? '') || (r.at ? toJalaliDate(r.at) : '—')
    const amount = n(r.amount)
    /**
     * کد اعتبار ممکن است پس از برگشت/ابطالِ فاکتور مصرف دوباره فعال شود؛ پس
     * گزارش عمومی هرگز آن را حمل نمی‌کند. مشاهدهٔ محرمانهٔ مدیر باید از کانال
     * مجوزدارِ جدا انجام شود، نه از متن داستان یا HTML این گزارش.
     */
    stories.push({
      amount,
      issuedAtJalali,
      usedAtJalali,
      reason,
      safeText:
        `اعتبار خرید در تاریخ ${faDigits(issuedAtJalali)} به مشتری بابت ${CREDIT_ISSUE_REASON_LABELS[reason]} ` +
        `داده شد و در تاریخ ${faDigits(usedAtJalali)} مصرف شد (${money(amount)} ریال).`
    })
  }
  return stories
}

async function storeCreditStatement(
  scope: StatementScope,
  notes: string[]
): Promise<StoreCreditTotals & { usedStories: StoreCreditUsageStory[] }> {
  const { range, scopedIds, issuedIds, issuedWhere, redemptionWhere, redemptionIds } =
    await storeCreditScopes(scope, notes)
  /** نشست ۱۷۴ · S173-D3 — همه‌ی جمع‌ها روی دسته‌های ۵۰۰تایی شناسه (نه یک IN بلند) */
  const issued = await aggregateByIdChunks('storeCredit', issuedWhere, issuedIds, ['amount'])
  /**
   * نشست ۶۱ (S61-2) — سهم «اعتبار از اضافه‌دریافت» از صادرشده‌ی همین بازه. در گزارش
   * اعتبار (بند ۴-۴۸) جزو صادرشده می‌ماند، ولی در پل تطبیق از ردیف «اعتبار
   * صادرشده» بیرون می‌رود: پولش واقعاً دریافت شده و کل مبلغ اضافه همین حالا در
   * ردیف «دریافت پول اضافه» از پل کم شده است؛ کسر دوباره پل را باز می‌گذاشت.
   */
  const issuedOverpay = await aggregateByIdChunks(
    'storeCredit',
    { ...issuedWhere, source: CreditSource.OVERPAY },
    issuedIds,
    ['amount']
  )

  /**
   * =========================================================================
   * نشست ۱ زنجیره رفع · خوشه D (D1) — «مصرف اعتبار» از دفتر مصرف، نه از مبلغ
   * اولیه‌ی اعتبار.
   *
   * باگ قبلی: این عدد `SUM(StoreCredit.amount)` روی رکوردهایی بود که `usedAt`
   * در بازه داشتند. دو خرابیِ قطعی:
   *   ۱) مصرف *بخشی* را کل مبلغ می‌شمرد — دو اعتبار ۱٬۰۰۰٬۰۰۰ با مصرف ۳۰۰٬۰۰۰ و
   *      ۵۰۰٬۰۰۰ ⇒ ۱٬۵۰۰٬۰۰۰ به‌جای ۸۰۰٬۰۰۰.
   *   ۲) اعتبار چندبارمصرف فقط «آخرین مصرف» را در `usedAt` دارد، پس مصرف‌های
   *      قبلی‌اش اصلاً دیده نمی‌شدند (مصرف جزئیِ ۴۰٬۰۰۰ ⇒ صفر).
   * حالا هر ردیف `StoreCreditRedemption` یک رویداد مستقل است، با تاریخ خودش
   * (`at`) و مبلغ خودش، و مصرف‌های `reversed` کنار گذاشته می‌شوند (وگرنه
   * برگشتِ یک مصرف، همان مصرف را همچنان پول‌شده نشان می‌داد).
   * =========================================================================
   */
  const used = await aggregateByIdChunks('storeCreditRedemption', redemptionWhere, redemptionIds, ['amount'])

  /**
   * D2 — «تعهد اعتبار» = باقی‌ماندهٔ اعتبارهای زنده، نه مبلغ اولیه‌شان.
   * سه وضعیت زنده‌اند: ACTIVE، PARTIALLY_USED (باقی‌مانده دارد) و SUSPENDED
   * (معلق است، ولی بدهی ما به مشتری سر جایش است). قبلاً فقط ACTIVE شمرده می‌شد،
   * پس اعتبار ۱٬۰۰۰٬۰۰۰ با مصرف ۳۰۰٬۰۰۰ تعهدش «صفر» دیده می‌شد — یعنی ۷۰۰٬۰۰۰
   * بدهی واقعی به مشتری از ترازنامه غیب می‌شد.
   */
  /**
   * 🔴 نشست ۱۸۶ · بند ۴-۴۸ — «منقضی» از روی **تاریخ** حساب می‌شود، نه ستون وضعیت.
   *
   * ریشه‌ی باگ: هیچ مسیری در برنامه وضعیت `EXPIRED` را در دیتابیس نمی‌نویسد؛
   * انقضا فقط در لحظه‌ی *مصرف* محاسبه می‌شود (`creditStateOf`). ولی این دو
   * تابع روی `status` خام فیلتر می‌کردند. نتیجه:
   *
   *   اعتبار ۱٬۰۰۰٬۰۰۰ با مصرف ۳۰۰٬۰۰۰ که **دیروز منقضی شده** ⇒
   *   «تعهد فعال ۷۰۰٬۰۰۰» و «منقضی ۰».
   *
   * یعنی ستون «منقضی» همیشه صفر می‌ماند و تعهد فروشگاه بیشتر از واقع گزارش
   * می‌شود — مدیر فکر می‌کند ۷۰۰٬۰۰۰ بدهکار است در حالی که آن پول دیگر
   * قابل خرج نیست.
   *
   * مبنای «الان» عمداً `scope.to` است (نه `new Date()`): گزارش یک بازه‌ی
   * گذشته باید وضعیت *همان زمان* را بگوید، نه امروز را.
   */
  const asOf = (range && scope.to) || new Date()
  const notExpired = { OR: [{ expiresAt: null }, { expiresAt: { gt: asOf } }] }
  const isExpired = { expiresAt: { not: null, lte: asOf } }

  const liveSum = async (statuses: string[]) => {
    const agg = await aggregateByIdChunks(
      'storeCredit',
      {
        status: { in: statuses },
        ...notExpired,
        ...(range && scope.to ? { issuedAt: { lte: scope.to } } : {})
      },
      scopedIds,
      ['amount', 'usedAmount']
    )
    return Math.max(0, agg.sum.amount - agg.sum.usedAmount)
  }
  /**
   * «منقضی» = باقی‌ماندهٔ اعتبارهایی که تاریخشان گذشته و هنوز باطل نشده‌اند.
   * باقی‌مانده (نه مبلغ کل) چون بخشِ خرج‌شده‌اش واقعاً خرج شده و سوخته نیست.
   * وضعیت ذخیره‌شده‌ی `EXPIRED` هم برای داده‌ی احتمالیِ قدیمی نگه داشته شد.
   */
  const expiredSum = async () => {
    const agg = await aggregateByIdChunks(
      'storeCredit',
      {
        OR: [
          {
            status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED, StoreCreditStatus.SUSPENDED] },
            ...isExpired
          },
          { status: StoreCreditStatus.EXPIRED }
        ],
        ...(range && scope.to ? { issuedAt: { lte: scope.to } } : {})
      },
      scopedIds,
      ['amount', 'usedAmount']
    )
    return Math.max(0, agg.sum.amount - agg.sum.usedAmount)
  }
  /**
   * «منقضی‌شده در بازه» یک رویدادِ تاریخ‌محور است، نه snapshot پایان بازه:
   * فقط ماندهٔ اعتبارهای دارای expiresAt در دو سرِ شاملِ بازه شمرده می‌شود.
   * بنابراین اعتباری که سال قبل منقضی شده، در گزارش ماه جاری دوباره ظاهر نمی‌شود.
   */
  const expiredInRangeSum = async () => {
    if (!range) return 0
    const agg = await aggregateByIdChunks(
      'storeCredit',
      {
        OR: [
          {
            status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED, StoreCreditStatus.SUSPENDED] },
            expiresAt: range
          },
          { status: StoreCreditStatus.EXPIRED, expiresAt: range }
        ]
      },
      scopedIds,
      ['amount', 'usedAmount']
    )
    return Math.max(0, agg.sum.amount - agg.sum.usedAmount)
  }
  const statusSum = async (status: string) =>
    (
      await aggregateByIdChunks(
        'storeCredit',
        { status, ...(range && scope.to ? { issuedAt: { lte: scope.to } } : {}) },
        scopedIds,
        ['amount']
      )
    ).sum.amount

  /** نشست ۱۷۰ · S169-D4 — سهم سند‌دار (پل) / بی‌سند / باقی‌مانده از صادرشده‌ی همین بازه */
  const split = await storeCreditBridgeSplit(issuedWhere, issuedIds)

  const usedStories = await storeCreditUsageStories(redemptionWhere, redemptionIds)
  if (used.count > usedStories.length) {
    notes.push(
      `خط کنترل اعتبار: ${faDigits(usedStories.length)} از ${faDigits(used.count)} مصرف در این پاسخ آمده؛ بقیه در تب اعتبار خرید است (سقف ${faDigits(USAGE_STORY_CAP)}).`
    )
  }

  return {
    issued: issued.sum.amount,
    issuedFromOverpay: issuedOverpay.sum.amount,
    issuedBacked: split.backed,
    issuedUnbacked: split.unbacked,
    issuedUnbackedCount: split.unbackedCount,
    issuedRemainder: split.remainder,
    issuedRemainderCount: split.remainderCount,
    /** نشست ۱۷۱ · S170-D3 — باقی‌مانده‌ی اعتبار اضافه‌دریافت (داخل issuedFromOverpay) */
    issuedOverpayRemainder: split.overpayRemainder,
    issuedOverpayRemainderCount: split.overpayRemainderCount,
    /** سبدهای مانعةالجمع کارت گردش اعتبار؛ جمع شش‌تایی = issued. */
    issuedLifecycleReturn: split.lifecycle.return,
    issuedLifecycleExchange: split.lifecycle.exchange,
    issuedLifecycleManual: split.lifecycle.manual,
    issuedLifecycleOverpay: split.lifecycle.overpay,
    issuedLifecycleRemainder: split.lifecycle.remainder,
    issuedLifecycleOther: split.lifecycle.other,
    issuedCount: issued.count,
    used: used.sum.amount,
    usageCount: used.count,
    usedStories,
    active: await liveSum([
      StoreCreditStatus.ACTIVE,
      StoreCreditStatus.PARTIALLY_USED,
      StoreCreditStatus.SUSPENDED
    ]),
    // snapshot تعهد/انقضای پایان بازه، برای خواندن حسابداری تاریخی حفظ می‌شود.
    expired: await expiredSum(),
    // کارت دوره‌ای فقط این رویداد را نشان می‌دهد: expiresAt داخل بازهٔ انتخاب‌شده.
    expiredInRange: await expiredInRangeSum(),
    canceled: await statusSum(StoreCreditStatus.CANCELED)
  }
}

/**
 * «باقی‌ماندهٔ بدهی فاکتورهای همین بازه، در پایان بازه» (بند ۲-۷ + ۳-د-۲).
 *
 * فرمول درست: `Σ max(0, grandTotal − paidTotal − returnedTotal(kind=RETURN))`.
 * `max(0, …)` روی **هر فاکتور جداگانه** لازم است، پس با aggregate خالص نمی‌شود:
 * یک فاکتورِ بیش‌ازحد برگشت‌خورده نباید بدهیِ منفی به جمع تزریق کند. راه‌حل: فقط
 * فاکتورهای **تسویه‌نشده** اسکن می‌شوند (زیرمجموعه‌ی کوچکی از کل)، اما این
 * اسکن سقف مالی ندارد: داده در صفحه‌های ثابت و مرتب‌شده بر اساس شناسه خوانده
 * می‌شود تا فاکتور پنجاه‌هزارویکم هم از «باقی‌مانده‌ی بدهی» حذف نشود.
 */
/**
 * نشست ۱۶۲ · Y20 · خوشه C «پل گزارش تاریخی» · بند ۴-۱۸/۴-۲۷ (S162-D4)
 *
 * باگ: docblock بالا «بدهی *در پایان بازه*» می‌گفت ولی پیاده‌سازی وضعیت *زنده* را می‌خواند
 * (settledAt فعلی، paidTotal فعلی، همه‌ی برگشت‌ها تا امروز). نتیجه: گزارش دیروز که امروز دوباره گرفته
 * شود، با هر وصول/برگشت/تعویضِ امروز روی فاکتور دیروز «نسیه‌ی وصول‌نشده»‌اش عوض می‌شد، در حالی که
 * ناخالص و وجه واقعی دیروز (درست) ثابت می‌ماندند ⇒ پل تطبیق دیروز دقیقاً به اندازه‌ی رویداد امروز باز
 * می‌ماند و گزارش دوره‌ی بسته عوض می‌شد.
 * رفع: اگر پایان بازه در گذشته است، بدهی هر فاکتور «در همان لحظه» حساب می‌شود با همان فرمول واحد
 * `remainingOf` و همان زمان رویدادی که ستون‌های دیگر گزارش می‌خوانند: پرداخت غیرچک با paidAt،
 * چک پاس‌شده با clearedAt، برگشت با returnedAt. پرداخت/برگشت باطل‌شده مثل بقیه‌ی گزارش هرگز حساب
 * نمی‌شود. اگر پایان بازه اکنون یا آینده است (گزارش «امروز») رفتار قبلی عیناً حفظ است.
 */
function pastPeriodEnd(scope: StatementScope): Date | null {
  if (!scope.to) return null
  const t = scope.to instanceof Date ? scope.to.getTime() : new Date(scope.to as any).getTime()
  return Number.isFinite(t) && t < Date.now() ? new Date(t) : null
}

/** where فاکتورهایی که ممکن است در پایان بازه بدهی داشته باشند (تسویه‌نشده، یا تسویه‌شده بعد از پایان بازه) */
function unsettledAtWhere(scope: StatementScope, asOf: Date | null): Prisma.SaleInvoiceWhereInput {
  if (!asOf) return { ...scope.where, settledAt: null }
  return { AND: [scope.where, { OR: [{ settledAt: null }, { settledAt: { gt: asOf } }] }] }
}

const msOf = (d: unknown): number | null => {
  if (d == null) return null
  const t = d instanceof Date ? d.getTime() : new Date(d as any).getTime()
  return Number.isFinite(t) ? t : null
}

/** بدهی هر فاکتور (با remainingOf واحد) در لحظه‌ی asOf، یا وضعیت فعلی اگر asOf = null. */
async function remainingByInvoice(
  list: { id: number; grandTotal: unknown; paidTotal: unknown }[],
  asOf: Date | null
): Promise<Map<number, { remaining: number; received: number }>> {
  const out = new Map<number, { remaining: number; received: number }>()
  if (!list.length) return out
  const ids = list.map((r) => r.id)
  const adj = await debtAdjustmentsByInvoice(prisma, ids, asOf)
  const receivedAsOf = new Map<number, number>()
  if (asOf) {
    const cut = asOf.getTime()
    for (let i = 0; i < ids.length; i += 500) {
      const pays = await prisma.payment.findMany({
        where: { invoiceId: { in: ids.slice(i, i + 500) }, voidedAt: null },
        select: { invoiceId: true, amount: true, kind: true, chequeStatus: true, paidAt: true, clearedAt: true, createdAt: true }
      })
      for (const p of pays as any[]) {
        const amt = Math.max(0, n(p.amount))
        if (!amt) continue
        let at: number | null
        if (p.kind === PaymentEntryKind.CHEQUE) {
          if (p.chequeStatus !== ChequeStatus.CLEARED) continue
          at = msOf(p.clearedAt) ?? msOf(p.paidAt) ?? msOf(p.createdAt)
        } else at = msOf(p.paidAt) ?? msOf(p.createdAt)
        if (at == null || at > cut) continue
        receivedAsOf.set(p.invoiceId, (receivedAsOf.get(p.invoiceId) ?? 0) + amt)
      }
    }
  }
  for (const inv of list) {
    const received = asOf ? receivedAsOf.get(inv.id) ?? 0 : n(inv.paidTotal)
    const remaining = remainingOf({ grandTotal: n(inv.grandTotal), received, ...adjustmentsOrEmpty(adj, inv.id) }).remaining
    out.set(inv.id, { remaining, received })
  }
  return out
}

async function creditRemaining(scope: StatementScope, warnings: string[]): Promise<{ remaining: number; created: number }> {
  let remaining = 0
  let created = 0
  let skip = 0
  const asOf = pastPeriodEnd(scope)

  for (;;) {
    const list = await prisma.saleInvoice.findMany({
      where: unsettledAtWhere(scope, asOf),
      select: { id: true, grandTotal: true, paidTotal: true },
      orderBy: { id: 'asc' },
      skip,
      take: UNSETTLED_SCAN_PAGE_SIZE
    })
    if (!list.length) break

    // نشست ۵۸ · C2 — بدهی هر فاکتور با همان `remainingOf` واحد (برگشت + بازپرداخت)
    // نشست ۱۶۲ · Y20 — «در پایان بازه» اگر بازه گذشته است
    const rem = await remainingByInvoice(list, asOf)
    for (const inv of list) {
      const r = rem.get(inv.id)
      created += Math.max(0, n(inv.grandTotal) - n(r?.received ?? 0))
      remaining += n(r?.remaining ?? 0)
    }

    skip += list.length
    if (list.length < UNSETTLED_SCAN_PAGE_SIZE) break
  }
  return { remaining, created }
}

/**
 * ===========================================================================
 * نشست ۵۹ · خوشه B/C · بند ۴-۵۴ — اجزای برگشتِ پل تطبیق، از *یک* پیش‌شرط واحد.
 *
 * هم عدد ردیف‌ها و هم drill-down هر ردیف از همین تابع می‌آیند (خوشه F: «source
 * هر سبد دقیقاً با predicate همان سبد»). هر برگشت ساده‌ی این بازه دقیقاً در یک
 * سبد برای «بازپرداخت» و حداکثر در یک سبد برای «کاهش بدهی دوره‌ی قبل» می‌نشیند:
 *
 *   refund  = refundFromReceivedOf(r)   ← همان عددی که remainingOf می‌بیند
 *   CASH ⇒ cashRefunds · CARD ⇒ cardRefunds · CARD_TO_CARD (لغونشده) ⇒ cardToCardRefunds
 *   STORE_CREDIT ⇒ هیچ‌کدام (در ردیف storeCreditIssued از خودِ جدول اعتبار آمده)
 *   اگر فاکتور بیرون از scope.where است (فروش دوره‌ی قبل):
 *       priorDebtReturns += total − refund
 *
 * بدون سقف بی‌صدا: کل برگشت‌های بازه خوانده می‌شود (شناسه‌ها در دسته‌های ۵۰۰تایی).
 * ===========================================================================
 */
export interface ReturnBridgeItem {
  id: number
  invoiceId: number
  receiptNo: number | null
  dateJalali: string | null
  /** RETURN = برگشت ساده · EXCHANGE = کالای برگشتیِ تعویض */
  kind: 'RETURN' | 'EXCHANGE'
  total: number
  /** برگشت ساده: سهم پس‌داده از پول دریافتی · تعویض: مابه‌التفاوتی که ما پس دادیم */
  refund: number
  /** CASH | CARD | CARD_TO_CARD | STORE_CREDIT | NONE */
  method: string
  inScope: boolean
  /** نشست ۶۰ — فقط تعویض: کاهش بدهی فاکتور اصلی (بخش پول‌نشده‌ی مابه‌التفاوت منفی) */
  debtCut?: number
}
async function returnBridgeItems(scope: StatementScope): Promise<ReturnBridgeItem[]> {
  const range = dateRange(scope.from, scope.to)
  const rets = await prisma.saleReturn.findMany({
    where: { invoice: returnInvoiceWhere(scope), ...returnScopeWhere(scope), voidedAt: null, ...(range ? { returnedAt: range } : {}) },
    select: {
      id: true, invoiceId: true, kind: true, total: true, refundMethod: true, refundAmount: true,
      exchangeDiff: true, exchangeSettlement: true, debtReduction: true,
      returnedAtJalali: true, invoice: { select: { receiptNo: true } }
    },
    orderBy: { id: 'asc' }
  })
  if (!rets.length) return []
  const c2c = rets
    .filter((r: any) => r.refundMethod === RefundMethod.CARD_TO_CARD || r.exchangeSettlement === 'CARD_TO_CARD')
    .map((r: any) => r.id)
  const canceled = new Set<number>()
  for (let i = 0; i < c2c.length; i += 500) {
    const reqs = await (prisma as any).cardTransferRequest.findMany({
      where: { returnId: { in: c2c.slice(i, i + 500) }, status: 'CANCELED' },
      select: { returnId: true }
    })
    for (const q of reqs) canceled.add(q.returnId)
  }
  /** نشست ۶۰ — تعویضِ دارای کاهش بدهی هم باید بداند فاکتور اصلی‌اش در scope هست یا نه */
  const simpleInv = [...new Set(rets
    .filter((r: any) => isSimpleReturn(r) || exchangeDebtReductionOf(r) > 0)
    .map((r: any) => r.invoiceId as number))]
  const inScope = new Set<number>()
  for (let i = 0; i < simpleInv.length; i += 500) {
    const rows = await prisma.saleInvoice.findMany({
      where: { AND: [scope.where, { id: { in: simpleInv.slice(i, i + 500) } }] },
      select: { id: true }
    })
    for (const r of rows) inScope.add(r.id)
  }
  const BUCKET_TO_METHOD: Record<string, string> = {
    CASH_REFUND: 'CASH', CARD_REFUND: 'CARD', CARD_TO_CARD: 'CARD_TO_CARD', STORE_CREDIT: 'STORE_CREDIT'
  }
  return rets.map((r: any) => {
    const base = {
      id: r.id, invoiceId: r.invoiceId, receiptNo: r.invoice?.receiptNo ?? null,
      dateJalali: r.returnedAtJalali ?? null, total: Math.max(0, n(r.total))
    }
    if (isSimpleReturn(r))
      return {
        ...base, kind: 'RETURN' as const,
        refund: refundFromReceivedOf({ ...r, refundCanceled: canceled.has(r.id) }),
        method: String(r.refundMethod ?? 'NONE').toUpperCase(),
        inScope: inScope.has(r.invoiceId)
      }
    const diff = n(r.exchangeDiff)
    const { bucket } = normalizeSettlement({ exchangeSettlement: r.exchangeSettlement, refundMethod: r.refundMethod })
    const method = diff < 0 ? BUCKET_TO_METHOD[bucket] ?? 'NONE' : 'NONE'
    /** نشست ۶۰ (بند ۴-۵) — فقط بخش بازپرداخت‌شده؛ کاهش بدهی جداست */
    const refundPart = exchangeRefundPartOf(r)
    const refund = diff < 0 && !(method === 'CARD_TO_CARD' && canceled.has(r.id)) ? refundPart : 0
    const debtCut = exchangeDebtReductionOf(r)
    /**
     * سند تعویض یک فاکتور تازه در همین بازه است؛ ولی «کاهش بدهی» روی فاکتور
     * *اصلی* می‌نشیند: اگر آن فاکتور بیرون از scope باشد (فروش دوره‌ی قبل)، این
     * کاهش در باقی‌مانده‌ی بدهی این بازه دیده نمی‌شود ⇒ ردیف priorDebtReturns.
     */
    return {
      ...base, kind: 'EXCHANGE' as const, refund, method,
      inScope: debtCut > 0 ? inScope.has(r.invoiceId) : true,
      debtCut
    }
  })
}

export const RETURN_BRIDGE_KEYS = [
  'cashRefunds', 'cardRefunds', 'cardToCardRefunds',
  'exchangeCashRefunds', 'exchangeCardRefunds', 'exchangeCardToCardRefunds',
  'priorDebtReturns'
] as const
export type ReturnBridgeKey = (typeof RETURN_BRIDGE_KEYS)[number]

/** سهم یک سند در یک ردیف پل (۰ = در این ردیف نیست). هر ریال دقیقاً یک ردیف. */
export function returnBridgeShare(it: ReturnBridgeItem, key: ReturnBridgeKey): number {
  if (key === 'priorDebtReturns') {
    if (it.inScope) return 0
    if (it.kind === 'RETURN') return Math.max(0, it.total - it.refund)
    // نشست ۶۰ (بند ۴-۵) — کاهش بدهی فاکتور دوره‌ی قبل از مابه‌التفاوت تعویض
    return Math.max(0, n(it.debtCut))
  }
  if (it.refund <= 0) return 0
  const wantKind = key.startsWith('exchange') ? 'EXCHANGE' : 'RETURN'
  if (it.kind !== wantKind) return 0
  const k = key.replace(/^exchange/, '').replace(/^./, (c) => c.toLowerCase())
  if (k === 'cashRefunds') return it.method === 'CASH' ? it.refund : 0
  if (k === 'cardRefunds') return it.method === 'CARD' ? it.refund : 0
  if (k === 'cardToCardRefunds') return it.method === 'CARD_TO_CARD' ? it.refund : 0
  return 0
}

function sumReturnBridge(items: ReturnBridgeItem[]): Record<ReturnBridgeKey, number> {
  const out = Object.fromEntries(RETURN_BRIDGE_KEYS.map((k) => [k, 0])) as Record<ReturnBridgeKey, number>
  for (const it of items) for (const k of RETURN_BRIDGE_KEYS) out[k] += returnBridgeShare(it, k)
  return out
}

/** جمع فاکتورها با aggregate — مستقل از صفحه‌بندی. */
async function invoiceAggregate(scope: StatementScope) {
  const res = await prisma.saleInvoice.aggregate({
    where: scope.where,
    _sum: {
      goodsTotal: true, taxTotal: true, serviceCharge: true,
      discountTotal: true, deliveryFee: true, grandTotal: true, paidTotal: true
    },
    _count: { _all: true }
  })
  return {
    goodsTotal: n(res._sum.goodsTotal),
    taxTotal: n(res._sum.taxTotal),
    serviceCharge: n(res._sum.serviceCharge),
    discountTotal: n(res._sum.discountTotal),
    deliveryFee: n(res._sum.deliveryFee),
    grandTotal: n(res._sum.grandTotal),
    paidTotal: n(res._sum.paidTotal),
    count: n(res._count?._all)
  }
}

/**
 * اسناد سازنده‌ی یک ردیف پل تطبیق.
 *
 * نشست ۱۰۸: سقف قبلی ۲۰۰ ردیف بی‌صدا بود. حالا هر شاخه count واقعی و metadata
 * صفحه برمی‌گرداند؛ جمع‌های پل همچنان از aggregate می‌آیند و هرگز از این صفحه
 * محاسبه نمی‌شوند.
 */
async function bridgeSources(
  scope: StatementScope,
  key: string,
  requestedSkip = 0,
  requestedTake = 200
): Promise<{ sources: SaleBridgeSource[]; page: SaleReportPage }> {
  const range = dateRange(scope.from, scope.to)
  const out: SaleBridgeSource[] = []
  const skip = Math.max(0, Math.round(Number(requestedSkip) || 0))
  const take = Math.min(Math.max(Math.round(Number(requestedTake) || 200), 1), 2_000)
  const makePage = (totalCount: number): SaleReportPage => ({
    skip,
    take,
    totalCount: Math.max(0, totalCount),
    truncated: skip + out.length < Math.max(0, totalCount)
  })
  /**
   * ممیزی A108-01 — اسناد پرداختیِ یک ردیف پل با **همان** قاعده‌ی aggregate آن ردیف انتخاب می‌شوند
   * (receiptBucketOf روی روش/مقصد، وضعیت چک)، و count/skip/take روی مجموعه‌ی منطبق نهایی اعمال
   * می‌شود. قبلاً count روی where خام بود و ردیف اعتبار خرید بعد از skip/take در JS حذف می‌شد ⇒
   * totalCount دروغ و صفحه‌ی خالی با «صفحه‌ی بعد»؛ مقصد حساب مدیر هم در «وجه واقعی» می‌آمد.
   * فقط ستون‌های سبک برای کل مجموعه خوانده می‌شود (مثل برگشت/نسیه، S108-3)، جزئیات فقط برای صفحه.
   */
  type PayLite = { id: number; kind: string; chequeStatus: string | null; destination: string | null; methodId: number; amount: any; overpayAmount: any }
  const PAY_LITE = { id: true, kind: true, chequeStatus: true, destination: true, methodId: true, amount: true, overpayAmount: true } as const
  const bucketOfPay = async (list: PayLite[]) => {
    const ids = [...new Set(list.map((r) => r.methodId))]
    const methods = ids.length
      ? await prisma.paymentMethod.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true } })
      : []
    const kindOf = new Map(methods.map((m) => [m.id, m.kind ?? PaymentKind.CUSTOM]))
    return (r: PayLite) =>
      receiptBucketOf({
        isCheque: r.kind === PaymentEntryKind.CHEQUE,
        destination: r.destination,
        methodKind: r.kind === PaymentEntryKind.CHEQUE ? PaymentKind.CUSTOM : (kindOf.get(r.methodId) ?? PaymentKind.CUSTOM)
      })
  }
  const paymentDrill = async (
    wheres: any[],
    share: (r: PayLite, bucket: string) => number,
    label: (r: any, amount: number) => string
  ) => {
    const seen = new Set<number>()
    const lite: PayLite[] = []
    for (const w of wheres) {
      const part = (await prisma.payment.findMany({ where: w, select: PAY_LITE, orderBy: { id: 'desc' } })) as PayLite[]
      for (const r of part) if (!seen.has(r.id)) { seen.add(r.id); lite.push(r) }
    }
    const bucket = await bucketOfPay(lite)
    const matching = lite
      .map((r) => ({ r, amt: share(r, bucket(r)) }))
      .filter((x) => x.amt > 0)
      .sort((x, y) => y.r.id - x.r.id)
    const pageRows = matching.slice(skip, skip + take)
    const amountOf = new Map(pageRows.map((x) => [x.r.id, x.amt]))
    /**
     * نشست ۱۷۳ · S173-D1 — take تا ۲٬۰۰۰ مجاز است؛ `id in pageRows` برای صفحه‌ی بزرگ از سقف IN
     * گزارش‌ها (۵۰۰، REPORT_IN_CHUNK) رد می‌شد، خطا در catch همین تابع بلعیده می‌شد و drill ردیف
     * «وجه واقعی» با ۶۰۰ پرداخت «۰ سند» نشان می‌داد. شناسه‌های صفحه در دسته‌های ۵۰۰تایی خوانده و
     * دوباره به ترتیب id نزولی چیده می‌شوند؛ شمارش و جمع‌ها دست نمی‌خورند.
     */
    const pageIds = pageRows.map((x) => x.r.id)
    const full: any[] = []
    for (let i = 0; i < pageIds.length; i += 500)
      full.push(
        ...(await prisma.payment.findMany({
          where: { id: { in: pageIds.slice(i, i + 500) } },
          include: { invoice: { select: { receiptNo: true } }, method: { select: { label: true, kind: true } } },
          orderBy: { id: 'desc' }
        }))
      )
    full.sort((a, b) => Number(b.id) - Number(a.id))
    for (const r of full) {
      const amt = amountOf.get(r.id) ?? 0
      out.push({
        kind: 'PAYMENT', id: r.id, amount: amt,
        label: label(r, amt),
        dateJalali: r.kind === PaymentEntryKind.CHEQUE && r.clearedAt
          ? toJalaliDate(r.clearedAt)
          : r.paidAtJalali ?? (r.paidAt ? toJalaliDate(r.paidAt) : null),
        invoiceId: r.invoiceId, receiptNo: r.invoice?.receiptNo ?? null
      })
    }
    return { sources: out, page: makePage(matching.length) }
  }
  const payLabel = (r: any) =>
    `فاکتور ${r.invoice?.receiptNo ?? '—'} · ${r.kind === PaymentEntryKind.CHEQUE ? `چک${r.chequeNo ? ` ${r.chequeNo}` : ''}` : (r.method?.label ?? 'پرداخت')}`
  const isCredit = (b: string) => b === 'storeCredit' || b === 'exchangeCredit'
  /** همان شرط «پول واقعی» اضافه‌دریافت در paymentStatement */
  const isRealMoney = (r: PayLite, b: string) =>
    r.kind === PaymentEntryKind.CHEQUE ? r.chequeStatus === ChequeStatus.CLEARED : !isCredit(b)
  try {
    /**
     * ریزهای چرخهٔ اعتبار از همان مجموعهٔ issued / scoped صورت حسابداری خوانده
     * می‌شوند. برچسب‌ها deliberately فاقد کد یا بخشی از کد اعتبار هستند؛ بازکردن
     * سند تنها metadata امن می‌دهد و reveal کد مسیر جداگانهٔ مدیر است.
     */
    if (key === 'storeCreditIssuedAll') {
      const { issuedWhere, issuedIds } = await storeCreditScopes(scope, [])
      const all = await liteRowsByIdChunks<{ id: number }>(
        'storeCredit', issuedWhere, issuedIds, {}, (a, b) => Number(b.id) - Number(a.id)
      )
      const rows = await rowsForIdsInOrder('storeCredit', all.slice(skip, skip + take).map((row) => row.id))
      for (const r of rows) {
        out.push({
          kind: 'STORE_CREDIT', subKind: 'STORE_CREDIT_ISSUANCE', id: Number(r.id), amount: n(r.amount),
          label: 'اعتبار خرید صادرشده' + (r.customerName ? ` · ${r.customerName}` : ''),
          dateJalali: r.issuedAtJalali || toJalaliDate(r.issuedAt),
          invoiceId: r.exchangeInvoiceId ?? r.sourceInvoiceId ?? null, receiptNo: null
        })
      }
      return { sources: out, page: makePage(all.length) }
    }

    const lifecycleIssueKeys = {
      storeCreditIssuedReturn: 'return',
      storeCreditIssuedExchange: 'exchange',
      storeCreditIssuedManual: 'manual',
      storeCreditIssuedOverpay: 'overpay',
      storeCreditIssuedRemainder: 'remainder',
      storeCreditIssuedOther: 'other'
    } as const
    const lifecycleBucket = lifecycleIssueKeys[key as keyof typeof lifecycleIssueKeys]
    if (lifecycleBucket) {
      const { issuedWhere, issuedIds } = await storeCreditScopes(scope, [])
      const split = await storeCreditBridgeSplit(issuedWhere, issuedIds)
      const ids = split.lifecycleIds[lifecycleBucket]
      const rows = await rowsForIdsInOrder('storeCredit', ids.slice(skip, skip + take))
      const labels: Record<typeof lifecycleBucket, string> = {
        return: 'صدور اعتبار بابت برگشت',
        exchange: 'صدور اعتبار بابت تعویض',
        manual: 'صدور دستی اعتبار',
        overpay: 'صدور اعتبار بابت اضافه‌دریافت',
        remainder: 'اعتبار باقی‌ماندهٔ مصرف جزئی',
        other: 'صدور اعتبار با خاستگاه ثبت‌نشده'
      }
      for (const r of rows) {
        out.push({
          kind: 'STORE_CREDIT', subKind: 'STORE_CREDIT_ISSUANCE', id: Number(r.id), amount: n(r.amount),
          label: labels[lifecycleBucket] + (r.customerName ? ` · ${r.customerName}` : ''),
          dateJalali: r.issuedAtJalali || toJalaliDate(r.issuedAt),
          invoiceId: r.exchangeInvoiceId ?? r.sourceInvoiceId ?? null, receiptNo: null
        })
      }
      return { sources: out, page: makePage(ids.length) }
    }

    if (key === 'storeCreditExpired' || key === 'storeCreditExpiredInRange' || key === 'storeCreditCanceled') {
      const { range: creditRange, scopedIds } = await storeCreditScopes(scope, [])
      const asOf = (creditRange && scope.to) || new Date()
      const issuedBeforeEnd = creditRange && scope.to ? { issuedAt: { lte: scope.to } } : {}
      const isExpired = { expiresAt: { not: null, lte: asOf } }
      const isExpiredKey = key === 'storeCreditExpired'
      const isExpiredInRangeKey = key === 'storeCreditExpiredInRange'
      const statusWhere: any = isExpiredKey
        ? {
            OR: [
              {
                status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED, StoreCreditStatus.SUSPENDED] },
                ...isExpired
              },
              { status: StoreCreditStatus.EXPIRED }
            ],
            ...issuedBeforeEnd
          }
        : isExpiredInRangeKey
          ? creditRange
            ? {
                OR: [
                  {
                    status: { in: [StoreCreditStatus.ACTIVE, StoreCreditStatus.PARTIALLY_USED, StoreCreditStatus.SUSPENDED] },
                    expiresAt: creditRange
                  },
                  { status: StoreCreditStatus.EXPIRED, expiresAt: creditRange }
                ]
              }
            : { id: { in: [] } }
          : { status: StoreCreditStatus.CANCELED, ...issuedBeforeEnd }
      const all = await liteRowsByIdChunks<{
        id: number
        amount: any
        usedAmount: any
        issuedAt: Date
        issuedAtJalali: string | null
        expiresAt: Date | null
        expiresAtJalali: string | null
        customerName: string | null
        exchangeInvoiceId: number | null
        sourceInvoiceId: number | null
      }>(
        'storeCredit', statusWhere, scopedIds,
        { amount: true, usedAmount: true, issuedAt: true, issuedAtJalali: true, expiresAt: true, expiresAtJalali: true, customerName: true, exchangeInvoiceId: true, sourceInvoiceId: true },
        (a, b) => Number(b.id) - Number(a.id)
      )
      const rows = all.slice(skip, skip + take)
      for (const r of rows) {
        /** انقضا در صورت رسمی فقط ماندهٔ خرج‌نشده است، اما ابطال مبلغ اولیه را می‌سنجد. */
        const isExpiryRow = isExpiredKey || isExpiredInRangeKey
        const amount = isExpiryRow ? Math.max(0, n(r.amount) - n(r.usedAmount)) : n(r.amount)
        out.push({
          kind: 'STORE_CREDIT', subKind: 'STORE_CREDIT_ISSUANCE', id: r.id, amount,
          label:
            (isExpiredInRangeKey ? 'اعتبار منقضی‌شده در بازه' : isExpiredKey ? 'اعتبار منقضی‌شده' : 'اعتبار لغوشده') +
            (r.customerName ? ` · ${r.customerName}` : ''),
          // کارت دوره‌ای باید تاریخ خودِ انقضا را نشان دهد، نه تاریخ صدور اعتبار.
          dateJalali: isExpiredInRangeKey
            ? (r.expiresAtJalali || (r.expiresAt ? toJalaliDate(r.expiresAt) : '—'))
            : (r.issuedAtJalali || toJalaliDate(r.issuedAt)),
          invoiceId: r.exchangeInvoiceId ?? r.sourceInvoiceId ?? null, receiptNo: null
        })
      }
      return { sources: out, page: makePage(all.length) }
    }

    if (key === 'storeCreditIssued') {
      // نشست ۶۱ — اعتبار اضافه‌دریافت در ردیف overpayReceived است.
      // ممیزی A108-02 — همان where ردیف (مالک رویداد/هویت A97-01)، نه کل بازه.
      const { issuedWhere, issuedIds } = await storeCreditScopes(scope, [])
      /**
       * نشست ۱۷۰ · S169-D4 — همان predicate ردیف: فقط اعتبار سند‌دار (returnId ≠ null) و غیر
       * «باقی‌مانده»؛ اعتبار دستی/گروهی بی‌سند و باقی‌مانده در ردیف پل نیستند، پس اینجا هم نه.
       */
      const { backedIds } = await storeCreditBridgeSplit(issuedWhere, issuedIds)
      /**
       * نشست ۱۷۲ · S172-D3 — backedIds سقف ندارد (بازه‌ی بزرگ ⇒ ۵۰۱+ اعتبار سند‌دار) و
       * `id in backedIds` از سقف IN گزارش‌ها (۵۰۰، REPORT_IN_CHUNK) رد می‌شد؛ خطا در catch همین
       * تابع بلعیده می‌شد و drill ردیفِ ۵۲۱٬۰۰۰ ریالی «۰ سند» نشان می‌داد. backedIds از قبل
       * به ترتیب id نزولی است (orderBy همان تابع)؛ پس شمارش = طول آرایه، صفحه = برش همان
       * آرایه، و فقط شناسه‌های صفحه (حداکثر take) در دسته‌های ۵۰۰تایی خوانده می‌شوند.
       */
      const totalCount = backedIds.length
      const pageIds = backedIds.slice(skip, skip + take)
      const rows: any[] = []
      for (let i = 0; i < pageIds.length; i += 500)
        rows.push(...(await prisma.storeCredit.findMany({ where: { id: { in: pageIds.slice(i, i + 500) } } })))
      rows.sort((a, b) => Number(b.id) - Number(a.id))
      for (const r of rows)
        out.push({
          kind: 'STORE_CREDIT', subKind: 'STORE_CREDIT_ISSUANCE', id: r.id, amount: n(r.amount),
          label: 'اعتبار خرید صادرشده' + (r.customerName ? ` · ${r.customerName}` : ''),
          dateJalali: r.issuedAtJalali || toJalaliDate(r.issuedAt),
          invoiceId: r.exchangeInvoiceId ?? r.sourceInvoiceId ?? null, receiptNo: null
        })
      return { sources: out, page: makePage(totalCount) }
    } else if (key === 'storeCreditUsed') {
      /**
       * ممیزی A108-02 — ردیف پل از دفتر مصرف (StoreCreditRedemption، D1) است: هر مصرف یک سند با مبلغ
       * خودش. قبلاً drill از StoreCredit.usedAt با مبلغ *اولیه*‌ی اعتبار می‌خواند (مصرف ۳۰۰٬۰۰۰ از
       * اعتبار ۱٬۰۰۰٬۰۰۰ ⇒ ۱٬۰۰۰٬۰۰۰) و مصرف‌های قبلی اعتبار چندبارمصرف غایب بودند.
       */
      /**
       * نشست ۱۷۴ · S173-D3 — با فیلتر فاکتوری، redemptionIds (یکتا، id نزولی) از دسته‌های ۵۰۰تایی
       * فاکتور حل شده؛ شمارش = طول آرایه، صفحه = برش همان آرایه، و فقط شناسه‌های صفحه دسته‌ای
       * خوانده می‌شوند (الگوی S172-D3). بدون فیلتر، همان count/findMany قبلی.
       */
      const { redemptionWhere, redemptionIds } = await storeCreditScopes(scope, [])
      let totalCount: number
      let rows: any[]
      if (redemptionIds) {
        totalCount = redemptionIds.length
        rows = await rowsForIdsInOrder('storeCreditRedemption', redemptionIds.slice(skip, skip + take))
      } else {
        totalCount = await prisma.storeCreditRedemption.count({ where: redemptionWhere })
        rows = await prisma.storeCreditRedemption.findMany({
          where: redemptionWhere, orderBy: { id: 'desc' }, skip, take
        })
      }
      for (const r of rows)
        out.push({
          kind: 'STORE_CREDIT', subKind: 'STORE_CREDIT_REDEMPTION', id: r.id, amount: n(r.amount),
          label: `مصرف اعتبار خرید (نوبت ${r.seq})` + (r.receiptNo ? ` روی فاکتور ${r.receiptNo}` : ''),
          dateJalali: r.atJalali || toJalaliDate(r.at), invoiceId: r.invoiceId ?? null, receiptNo: r.receiptNo ?? null
        })
      return { sources: out, page: makePage(totalCount) }
    } else if (
      key === 'priorCreditSettlements' || key === 'priorClearedCheques' ||
      key === 'priorManagerAccountReceived' || key === 'priorDestinationUnknownReceived'
    ) {
      if (!scope.from) return { sources: out, page: makePage(0) }
      const isChequeKey = key === 'priorClearedCheques'
      /** نشست ۱۶۱ · Y19 — همان where گروه‌بندی prior؛ فقط سبد مدیر / نامشخص */
      const wantPriorManager = key === 'priorManagerAccountReceived'
      const wantPriorUnknown = key === 'priorDestinationUnknownReceived'
      // همان where گروه‌بندی prior در paymentStatement
      const where: any = {
        invoice: { ...eventWhere(scope), issuedAt: { lt: scope.from } },
        voidedAt: null,
        amount: { gt: 0 },
        ...paymentEventWindowWhere(scope, range)
      }
      return await paymentDrill(
        [where],
        (r, b) => {
          const clearedCheque = r.kind === PaymentEntryKind.CHEQUE && r.chequeStatus === ChequeStatus.CLEARED
          if (wantPriorManager)
            return b === 'managerAccount' && (r.kind !== PaymentEntryKind.CHEQUE || clearedCheque) ? n(r.amount) : 0
          if (wantPriorUnknown) return clearedCheque && b === 'unknown' ? n(r.amount) : 0
          if (r.kind === PaymentEntryKind.CHEQUE)
            return r.chequeStatus === ChequeStatus.CLEARED && b !== 'managerAccount' && b !== 'unknown' ? n(r.amount) : 0
          if (isChequeKey) return 0
          return isCredit(b) || b === 'managerAccount' ? 0 : n(r.amount)
        },
        payLabel
      )
    } else if (key === 'drawerCashReceived' || key === 'posCardReceived' || key === 'otherMethodReceived') {
      /**
       * ریزِ فقط‌خواندنیِ اجزای کاشی‌ها. این سه کلید فرمول تازه نیستند؛ تنها
       * همان پرداخت‌های `paymentStatement` را با bucket دقیق جدا می‌کنند تا
       * تاریخچهٔ کشو/پوز هیچ‌وقت با realCash مخلوط نشود. برخلاف realCash، چک
       * پاس‌شده در این سه جزء نمی‌آید، چون cashReceived/cardReceived/otherReceived
       * در صورت وجه واقعی نیز فقط پرداخت غیرچکی‌اند.
       *
       * `paymentEventWindowWhere` عمداً همان predicate aggregate است؛ استفاده از
       * paidAt ساده در گزارش شیفت، وصول ثبت‌شده در شیفت را پنهان می‌کرد.
       */
      const events: any = {
        invoice: eventWhere(scope),
        voidedAt: null,
        amount: { gt: 0 },
        ...paymentEventWindowWhere(scope, range)
      }
      const wanted = key === 'drawerCashReceived' ? 'cash'
        : key === 'posCardReceived' ? 'card'
          : 'other'
      return await paymentDrill(
        [events],
        (r, bucket) => r.kind !== PaymentEntryKind.CHEQUE && bucket === wanted ? n(r.amount) : 0,
        payLabel
      )
    } else if (key === 'realCash' || key === 'managerAccountReceived' || key === 'destinationUnknownReceived') {
      /**
       * realCash = نقد + کارت + سایر (پرداخت غیرچک، رویداد paidAt) + چک پاس‌شده‌ی بازه به سبد
       * نقد/کارت (رویداد clearedAt). managerAccountReceived = سبد حساب مدیر از هر دو.
       * نشست ۱۶۱ · Y18 — destinationUnknownReceived = چک پاس‌شده‌ی سبد «نامشخص» (بیرون از realCash).
       */
      const nonCheque: any = {
        invoice: eventWhere(scope), voidedAt: null, amount: { gt: 0 },
        kind: { not: PaymentEntryKind.CHEQUE },
        ...paymentScopeWhere(scope, 'created'),
        ...(range ? { paidAt: range } : {})
      }
      const cleared: any = {
        invoice: eventWhere(scope), voidedAt: null, amount: { gt: 0 },
        kind: PaymentEntryKind.CHEQUE, chequeStatus: ChequeStatus.CLEARED,
        ...paymentScopeWhere(scope, 'cleared'),
        ...(range ? { clearedAt: range } : {})
      }
      const wantManager = key === 'managerAccountReceived'
      const wantUnknown = key === 'destinationUnknownReceived'
      return await paymentDrill(
        [nonCheque, cleared],
        (r, b) => {
          if (wantManager) return b === 'managerAccount' ? n(r.amount) : 0
          if (wantUnknown) return b === 'unknown' ? n(r.amount) : 0
          if (r.kind === PaymentEntryKind.CHEQUE) return b === 'managerAccount' || b === 'unknown' ? 0 : n(r.amount)
          return b === 'cash' || b === 'card' || b === 'other' ? n(r.amount) : 0
        },
        payLabel
      )
    } else if ((RETURN_BRIDGE_KEYS as readonly string[]).includes(key)) {
      // نشست ۵۹ — همان پیش‌شرط ردیف اصلی (returnBridgeItems + returnBridgeShare)
      const items = await returnBridgeItems(scope)
      const LBL: Record<string, string> = { CASH: 'نقدی', CARD: 'کارتی', CARD_TO_CARD: 'کارت‌به‌کارت', STORE_CREDIT: 'اعتبار خرید', NONE: 'بدون بازپرداخت' }
      const matching = items.filter((it) => returnBridgeShare(it, key as ReturnBridgeKey) > 0)
      for (const it of matching.slice(skip, skip + take)) {
        const amt = returnBridgeShare(it, key as ReturnBridgeKey)
        out.push({
          kind: 'RETURN', id: it.id, amount: amt,
          label: `${it.kind === 'EXCHANGE' ? 'تعویض' : 'برگشت'} سند ${it.id} · فاکتور ${it.receiptNo ?? '—'} · ${LBL[it.method] ?? it.method}`,
          dateJalali: it.dateJalali, invoiceId: it.invoiceId, receiptNo: it.receiptNo
        })
      }
      return { sources: out, page: makePage(matching.length) }
    } else if (key === 'uncollectedCredit') {
      // نشست ۱۶۲ · Y20 — همان where و همان «بدهی در پایان بازه»ی ردیف (creditRemaining)
      const asOf = pastPeriodEnd(scope)
      const rows = await prisma.saleInvoice.findMany({
        where: unsettledAtWhere(scope, asOf),
        select: { id: true, receiptNo: true, grandTotal: true, paidTotal: true, issuedAtJalali: true },
        orderBy: { id: 'desc' }
      })
      // نشست ۵۸ · C2 — همان بدهی واحد (برگشت + بازپرداخت)، نه grandTotal − paidTotal
      const remMap = await remainingByInvoice(rows, asOf)
      const matching = rows.filter((r) => n(remMap.get(r.id)?.remaining ?? 0) > 0)
      for (const r of matching.slice(skip, skip + take)) {
        const rem = n(remMap.get(r.id)?.remaining ?? 0)
        out.push({
          kind: 'INVOICE', id: r.id, amount: rem, label: `فاکتور ${r.receiptNo} (نسیه‌ی وصول‌نشده)`,
          dateJalali: r.issuedAtJalali, invoiceId: r.id, receiptNo: r.receiptNo
        })
      }
      return { sources: out, page: makePage(matching.length) }
    } else if (key === 'overpayReceived') {
      // نشست ۵۸ · C4 — اسناد سازنده‌ی ردیف «دریافت پول اضافه»؛ A108-01: همان شرط «پول واقعی» ردیف
      const where: any = {
        invoice: scope.from ? { ...eventWhere(scope), issuedAt: { gte: scope.from } } : eventWhere(scope),
        voidedAt: null,
        overpayAmount: { gt: 0 }, amount: { gt: 0 },
        ...paymentEventWindowWhere(scope, range)
      }
      return await paymentDrill(
        [where],
        (r, b) => (isRealMoney(r, b) ? Math.max(0, n(r.overpayAmount)) : 0),
        (r) => `اضافه‌دریافت ${payLabel(r)} (کل پرداختی ${n(r.amount)} ریال)`
      )
    }
  } catch (e) {
    // نبودن drill-down نباید کل گزارش را از کار بیندازد
    console.error('[accounting] bridge sources failed', key, e)
    /**
     * نشست ۱۷۳ · S173-D2 — قبلاً خطا بی‌صدا به «۰ سند، totalCount ۰» تبدیل می‌شد و ردیف پل
     * «بی‌مدرک» به نظر می‌رسید. حالا صفحه صریحاً failed است و buildStatements هشدار فارسی
     * با مبلغ ردیف می‌سازد؛ هیچ سند نیمه‌خوانده‌ای هم نشان داده نمی‌شود.
     */
    out.length = 0
    return { sources: out, page: { ...makePage(0), failed: true } }
  }
  return { sources: out, page: makePage(out.length) }
}

/**
 * درگاه فقط‌خواندنیِ منابع یک ردیف پل برای ریزبین مالی. از همان تابع داخلی
 * استفاده می‌شود تا predicate/تقسیم مبلغِ aggregate و source-list هرگز دو بار
 * نوشته نشود. اعتبارسنجی دسترسی و ورودی IPC عمداً در سرویس بالادست می‌ماند.
 */
export async function readBridgeSources(
  scope: StatementScope,
  key: string,
  skip = 0,
  take = 200
): Promise<{ sources: SaleBridgeSource[]; page: SaleReportPage }> {
  return bridgeSources(scope, key, skip, take)
}

/**
 * اجزای قابل‌ردیابی کاشی‌ها از همان source builder داخلی می‌آیند. این wrapper
 * فقط مرز نام‌گذاری است؛ هیچ عدد یا predicate تازه‌ای نمی‌سازد.
 */
export async function readFinancialComponentSources(
  scope: StatementScope,
  key: 'drawerCashReceived' | 'posCardReceived' | 'otherMethodReceived',
  skip = 0,
  take = 200
): Promise<{ sources: SaleBridgeSource[]; page: SaleReportPage }> {
  return bridgeSources(scope, key, skip, take)
}

/** نام خالی / «مشتری عمومی» در خط کنترل وصول نسیه نشان داده نمی‌شود. */
function personalCustomerName(name: string | null | undefined): string | null {
  const n = String(name ?? '').trim()
  if (!n || n === 'مشتری عمومی' || n === 'عمومی') return null
  return n
}

/**
 * آیا این پرداخت داخل عدد `settledPrior` است؟ همان قاعده‌ی `paymentStatement`
 * (چکِ پاس‌نشده، مصرف اعتبار، مقصد مدیر بیرون‌اند). خط کنترل فقط نمایش است.
 */
function countsInSettledPrior(p: {
  kind?: string | null
  chequeStatus?: string | null
  destination?: string | null
  method?: { kind?: string | null } | null
}): boolean {
  if (p.kind === PaymentEntryKind.CHEQUE) {
    if (p.chequeStatus !== ChequeStatus.CLEARED) return false
    const bucket = receiptBucketOf({
      isCheque: true,
      destination: p.destination,
      methodKind: PaymentKind.CUSTOM
    })
    return bucket !== 'managerAccount' && bucket !== 'unknown'
  }
  const mk = p.method?.kind ?? PaymentKind.CUSTOM
  const bucket = receiptBucketOf({ isCheque: false, destination: p.destination, methodKind: mk })
  return bucket !== 'storeCredit' && bucket !== 'exchangeCredit' && bucket !== 'managerAccount'
}

function priorCreditStoryText(p: {
  amount: number
  receiptNo: number
  customerName: string | null
  methodLabel: string
  when: string
}): string {
  const amt = money(p.amount)
  const rec = faDigits(p.receiptNo)
  const named = personalCustomerName(p.customerName)
  if (named) {
    return `نسیه ${amt} — ${named} پرداخت کرد (فیش ${rec} · ${p.methodLabel} · ${p.when})`
  }
  return `نسیه ${amt} — فیش ${rec} پرداخت شد (${p.methodLabel} · ${p.when})`
}

/**
 * خط کنترل سرجمع: هر وصول نسیه‌ی فاکتورِ بازه‌های قبل در همین بازه.
 * عدد `settledPrior` را عوض نمی‌کند؛ سقف همان USAGE_STORY_CAP است (+/− در UI).
 */
async function priorCreditSettlementStories(scope: StatementScope): Promise<{
  stories: { paymentId: number; receiptNo: number; amount: number; text: string }[]
  hidden: number
}> {
  if (!scope.from) return { stories: [], hidden: 0 }
  const range = dateRange(scope.from, scope.to)
  const rows = await prisma.payment.findMany({
    where: {
      invoice: { ...eventWhere(scope), issuedAt: { lt: scope.from } },
      voidedAt: null,
      amount: { gt: 0 },
      ...paymentEventWindowWhere(scope, range)
    },
    include: {
      method: { select: { kind: true, label: true } },
      invoice: { select: { receiptNo: true, customer: { select: { name: true } } } }
    },
    orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
    take: USAGE_STORY_CAP + 1
  })
  const counted = rows.filter((p) => countsInSettledPrior(p))
  const hidden = Math.max(0, counted.length - USAGE_STORY_CAP)
  const stories = counted.slice(0, USAGE_STORY_CAP).map((p) => {
    const paidAt = p.paidAt instanceof Date ? p.paidAt : new Date(p.paidAt)
    const when = `${p.paidAtJalali || toJalaliDate(paidAt)} ${p.paidAtTime || toClock(paidAt, false)}`
    const amount = toNumberRial(p.amount)
    const receiptNo = p.invoice?.receiptNo ?? 0
    return {
      paymentId: p.id,
      receiptNo,
      amount,
      text: priorCreditStoryText({
        amount,
        receiptNo,
        customerName: p.invoice?.customer?.name ?? null,
        methodLabel: p.method?.label ?? 'پرداخت',
        when
      })
    }
  })
  return { stories, hidden }
}

/**
 * ===========================================================================
 * هفت صورت گزارش، یک‌جا.
 * `withDrillDown = false` (پیش‌فرض) فقط عددها را می‌سازد؛ اسناد سازنده‌ی پل
 * تطبیق فقط وقتی خواسته شود خوانده می‌شوند تا گزارش سبک بماند.
 * ===========================================================================
 */
export async function buildStatements(
  scope: StatementScope,
  opts: {
    withDrillDown?: boolean
    bridgeSourceKey?: string | null
    bridgeSourceSkip?: number
    bridgeSourceTake?: number
  } = {}
): Promise<{ statements: SaleAccountingStatements; warnings: string[] }> {
  const warnings: string[] = []
  const notes: string[] = []
  /** نشست ۱۷۱ · S171-D2 — وضعیت صریح لغو شده/پیش‌نویس: رویداد مالی نیست؛ مبلغش در هشدار صریح */
  const excludedWarning = await excludedStatusStatementWarning(scope.where, scope.filter)
  if (excludedWarning) warnings.push(excludedWarning)
  const gatedScope = { ...scope, where: financialStatementInvoiceWhere(scope.where, scope.filter) }
  const resolvedScope =
    gatedScope.eventShiftIds !== undefined
      ? gatedScope
      : { ...gatedScope, eventShiftIds: await resolveReportEventShiftIds(scope.filter) }

  const [inv, pay, ret, credit, retItems] = await Promise.all([
    invoiceAggregate(resolvedScope),
    paymentStatement(resolvedScope, notes),
    returnStatement(resolvedScope),
    creditRemaining(resolvedScope, warnings),
    returnBridgeItems(resolvedScope)
  ])
  const retBridge = sumReturnBridge(retItems)
  const [sc, priorStories] = await Promise.all([
    storeCreditStatement(resolvedScope, notes),
    priorCreditSettlementStories(resolvedScope)
  ])

  // ---- صورت تعهدی (بند ۳-ب) — تعویض به‌عنوان برگشت ساده کم نمی‌شود ----
  const accrual = calculateAccrualStatement({
    invoices: [
      {
        goodsTotal: inv.goodsTotal,
        discountTotal: inv.discountTotal,
        taxTotal: inv.taxTotal,
        serviceCharge: inv.serviceCharge,
        deliveryFee: inv.deliveryFee
      }
    ],
    simpleReturns: ret.simpleReturns,
    /**
     * نشست ۵۹ · تصمیم قطعی مالک بند ۴-۱۰ (DECISIONS S59-3): تعویض = برگشت + فروش
     * جدید. سند تعویض (کالای جایگزین) خودش یک فاکتور همین بازه است و در ناخالص
     * آمده؛ پس کالای برگشتیِ تعویض باید با برچسب «از تعویض» کم شود، وگرنه همان
     * کالا دو بار فروش حساب می‌شد (مثال مالک: ۱٬۰۰۰٬۰۰۰ + ۱٬۳۰۰٬۰۰۰ − ۱٬۰۰۰٬۰۰۰ = ۱٬۳۰۰٬۰۰۰).
     * قبلاً اینجا عمداً صفر بود و پل برای هر تعویض به اندازه‌ی کالای برگشتی باز می‌ماند.
     */
    exchangeReturned: ret.exchangeReturned
  })

  // ---- صورت وجه واقعی (بند ۳-ج) ----
  /**
   * ---- صورت وجه واقعی: تفکیک چک از `pay.cheques` می‌آید، نه از `pay.totals` ----
   * کار الف — `pay.cheques.*` با `clearedAt` فیلتر شده و جمعشان عیناً
   * `cheques.cleared` است؛ `pay.totals.cleared*` از کوئری `OR: [paidAt, clearedAt]`
   * می‌آید و برای چکی که خارج از بازه پاس شده عدد دیگری می‌دهد. پس مبنای «وجه
   * واقعی» همان چیزی است که بلوک چک نشان می‌دهد و این دو هیچ‌وقت واگرا نمی‌شوند.
   */
  const cash = calculateCashStatement({
    payments: {
      ...pay.totals,
      clearedCheques: pay.cheques.cleared,
      clearedCashCheques: pay.cheques.clearedToCash,
      clearedCardCheques: pay.cheques.clearedToCard,
      clearedManagerCheques: pay.cheques.clearedToManager,
      clearedUnknownCheques: pay.cheques.clearedUnknown
    },
    returns: ret,
    priorCreditSettlements: pay.totals.priorPeriod,
    cashWithdrawals: scope.withdrawals ?? 0,
    cashDeposits: scope.deposits ?? 0
  })

  // ---- پل تطبیق (بند ۳-ز) ----
  /**
   * کار الف — «وجه واقعی» فقط پولی است که به فروشگاه رسیده: سهم مقصد‌مدیر بیرون
   * است. نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4): سهم «نامشخص» (داده‌ی قدیمی) هم دیگر داخل
   * نیست و ردیف جدای `destinationUnknownReceived` دارد. همان تصمیم `netCashMovement`.
   */
  const realCash =
    cash.cashReceived + cash.cardReceived + cash.otherReceived +
    cash.clearedChequeToCash + cash.clearedChequeToCard
  const bridgeRaw = calculateReconciliationBridge({
    realCash,
    /**
     * کار الف — بدون این ردیف پل تطبیق به اندازه‌ی همین مبلغ باز می‌ماند: بدهی
     * مشتری کم شده (پس `uncollectedCredit` پایین آمده) ولی پول به فروشگاه نرسیده.
     */
    managerAccountReceived: cash.managerAccountReceived,
    /** نشست ۱۶۱ · Y18 · بند ۴-۲۴ — سبد «نامشخص» ردیف مستقل؛ بدون آن پل به همین اندازه باز می‌ماند */
    destinationUnknownReceived: cash.destinationUnknownReceived,
    /** نشست ۶۱ (S61-2) — اعتبار اضافه‌دریافت در ردیف «دریافت پول اضافه» توضیح داده شده است */
    /**
     * نشست ۱۷۰ · S169-D4 — فقط اعتبار سند‌دار (برگشت/تعویض واقعی) که فروش خالص را کم کرده.
     * اعتبار دستی/گروهی بی‌سند و «باقی‌مانده»ی مصرف جزئی نه فروش را تغییر داده‌اند نه وجه را؛
     * کسرشان پل را به اندازه‌ی مبلغشان باز می‌گذاشت. مبلغشان در توضیح همین ردیف و یادداشت گزارش می‌آید.
     */
    storeCreditIssued: Math.max(0, n(sc.issuedBacked)),
    priorCreditSettlements: pay.totals.priorPeriod,
    priorClearedCheques: pay.totals.priorClearedCheques,
    /** نشست ۱۶۱ · Y19 (S161-D2) */
    priorManagerAccountReceived: n(pay.totals.priorManagerAccount),
    priorDestinationUnknownReceived: n(pay.totals.priorDestinationUnknown),
    storeCreditUsed: sc.used,
    uncollectedCredit: credit.remaining,
    /** نشست ۵۹ — بازپرداخت‌ها ردیف مستقل منفی؛ debtOnlyReturns دیگر در پل نیست */
    cashRefunds: retBridge.cashRefunds,
    cardRefunds: retBridge.cardRefunds,
    cardToCardRefunds: retBridge.cardToCardRefunds,
    exchangeCashRefunds: retBridge.exchangeCashRefunds,
    exchangeCardRefunds: retBridge.exchangeCardRefunds,
    exchangeCardToCardRefunds: retBridge.exchangeCardToCardRefunds,
    priorDebtReturns: retBridge.priorDebtReturns,
    overpayReceived: Math.max(0, n(pay.totals.overpayReceived)),
    netAccrualSales: accrual.netAccrualSales
  })

  /** نشست ۱۷۱ · S170-D3 */
  const overpayRemainder = Math.max(0, n(sc.issuedOverpayRemainder))
  const overpayFresh = Math.max(0, n(sc.issuedFromOverpay) - overpayRemainder)
  const HINTS: Record<string, string> = {
    realCash:
      'نقد + کارت + سایر + چکِ پاس‌شده‌ی این بازه (پولی که واقعاً به فروشگاه رسید). ' +
      'دریافتیِ «حساب مدیر» در این عدد نیست، چون به صندوق و کارتخوان فروشگاه نیامده.',
    managerAccountReceived:
      'پولی که مشتری پرداخته ولی به حساب مدیر رفته: بدهی مشتری کم شد، اما این مبلغ به صندوق و ' +
      'کارتخوان فروشگاه نیامده و در کسری/اضافی صندوق تأثیر ندارد.',
    destinationUnknownReceived:
      'چکِ پاس‌شده‌ی قدیمی که مقصد پولش ثبت نشده (بند ۴-۲۴): بدهی مشتری کم شد ولی معلوم نیست ' +
      'پول به کشو، کارتخوان یا حساب مدیر رفته؛ پس نه در وجه واقعی و نه در نقد مورد انتظار صندوق ' +
      'حساب شده است. مدیر باید مقصد واقعی را بررسی کند.',
    storeCreditIssued:
      'بدهی ما به مشتری؛ پول نرسید ولی کالا رفت — لینک به سند تعویض/برگشت' +
      /** نشست ۱۷۰ · S169-D4 — سهم بیرون از پل پنهان نمی‌شود */
      (n(sc.issuedUnbacked) > 0
        ? ` · ${n(sc.issuedUnbacked)} ریال اعتبار بی‌سند (دستی/گروهی مدیر، ${n(sc.issuedUnbackedCount)} بارکد) در این بازه صادر شد: ` +
          'فروش و وجه را تغییر نداده، پس در این ردیف کم نمی‌شود؛ مصرفش در ردیف «مصرف اعتبار خرید» می‌آید'
        : '') +
      (n(sc.issuedRemainder) > 0
        ? ` · ${n(sc.issuedRemainder)} ریال «باقی‌مانده»ی مصرف جزئی اعتبار یک‌بارمصرف (${n(sc.issuedRemainderCount)} بارکد): ` +
          'ادامه‌ی همان بدهی قبلی است، نه اعتبار تازه؛ در این ردیف دوباره کم نمی‌شود'
        : ''),
    priorCreditSettlements:
      'پولِ این بازه بابت فروشِ بازه‌های قبل — فروش امروز نیست' +
      /** نشست ۱۶۷ · S162-D3 (S167-D1) — برچسب جدای اضافه‌دریافت؛ عدد ردیف دست نمی‌خورد */
      (n(pay.totals.priorPeriodOverpay) > 0
        ? ` · شامل ${n(pay.totals.priorPeriodOverpay)} ریال اضافه‌دریافت روی فاکتورهای دوره‌ی قبل (فروش نیست؛ ` +
          'پول بیش از بدهی فاکتور گرفته شده — لینک به پرداختی‌های دارای «مبلغ اضافه‌ی دریافتی»)'
        : ''),
    priorClearedCheques: 'چکِ بازه‌های قبل که امروز پاس شد — فروش امروز نیست',
    priorManagerAccountReceived:
      'بخشی از «دریافتی به حساب مدیر» که بابت فاکتورهای بازه‌های قبل است: فروش و نسیه‌ی این بازه را ' +
      'تغییر نداده، پس اینجا خنثی می‌شود. به صندوق نرسیده و در وصول نسیه‌ی نقدی هم نیست.',
    priorDestinationUnknownReceived:
      'بخشی از «دریافتی با مقصد نامشخص» (چک پاس‌شده‌ی قدیمی بی‌مقصد) که بابت فاکتورهای بازه‌های قبل است؛ ' +
      'فروش این بازه نیست و در نقد مورد انتظار هم حساب نشده است.',
    storeCreditUsed: 'کالا خارج شد ولی وجه جدیدی نرسید (مصرف اعتبارِ قبلاً صادرشده)',
    uncollectedCredit: 'فروشِ این بازه که پولش هنوز نرسیده (نسیه)',
    cashRefunds: 'پولی که بابت برگشت ساده از کشو به مشتری پس داده شد — لینک به سند برگشت',
    cardRefunds: 'بازپرداخت برگشت ساده از طریق کارت‌خوان فروشگاه — لینک به سند برگشت',
    cardToCardRefunds: 'بازپرداختی که مدیر باید (یا کرده) کارت‌به‌کارت کند؛ درخواست لغوشده اینجا نیست',
    exchangeCashRefunds: 'مابه‌التفاوت تعویض که نقد از کشو به مشتری پس داده شد — لینک به سند تعویض',
    exchangeCardRefunds: 'مابه‌التفاوت تعویض که با کارت‌خوان به مشتری پس داده شد — لینک به سند تعویض',
    exchangeCardToCardRefunds: 'مابه‌التفاوت تعویض که مدیر باید (یا کرده) کارت‌به‌کارت کند',
    priorDebtReturns:
      'برگشتی که امروز روی فاکتورِ دوره‌ی قبل ثبت شد و پولی پس داده نشد: فروش خالص این بازه را ' +
      'کم کرد ولی بدهی‌اش جزو نسیه‌ی این بازه نبود',
    overpayReceived:
      'پولی که بیشتر از بدهی فاکتور گرفته شد (اضافه‌دریافت): وارد صندوق شده ولی فروش نیست — ' +
      'لینک به پرداختی‌های دارای «مبلغ اضافه‌ی دریافتی»' +
      /**
       * نشست ۱۷۱ · S170-D3 — فقط اعتبار اضافه‌دریافتِ *تازه* «تبدیل‌شده از همین اضافه‌دریافت» است؛
       * باقی‌مانده‌ی مصرف جزئی اعتبار اضافه‌دریافت قبلی جدا نام برده می‌شود (عدد پل دست نمی‌خورد).
       */
      (overpayFresh > 0
        ? ` · ${overpayFresh} ریال از آن به کد اعتبار خرید تبدیل شد (غیرقابل نقد شدن)؛ ` +
          'این اعتبارها در ردیف «اعتبار خرید صادرشده» دوباره کم نمی‌شوند'
        : ' · بخشی که به کد اعتبار خرید تبدیل شود هم همین‌جا می‌ماند (نه در ردیف اعتبار صادرشده)') +
      (overpayRemainder > 0
        ? ` · ${overpayRemainder} ریال «باقی‌مانده»ی مصرف جزئی اعتبار اضافه‌دریافت قبلی (${n(sc.issuedOverpayRemainderCount)} بارکد) ` +
          'در این بازه صادر شد: اضافه‌دریافت این بازه نیست و پولی وارد نشده؛ ادامه‌ی همان اعتبار قبلی است و در پل دوباره کم نمی‌شود'
        : '')
  }

  const rows: SaleBridgeRow[] = []
  for (const r of bridgeRaw.rows) {
    const shouldLoadSources =
      opts.withDrillDown === true && (!opts.bridgeSourceKey || opts.bridgeSourceKey === r.key)
    const drill = shouldLoadSources
      ? await bridgeSources(
          resolvedScope,
          r.key,
          opts.bridgeSourceSkip ?? 0,
          opts.bridgeSourceTake ?? 200
        )
      : null
    rows.push({
      key: r.key, label: r.label, amount: r.amount, sign: r.sign,
      hint: HINTS[r.key] ?? '',
      sources: drill?.sources ?? [],
      sourcesPage: drill?.page,
      // ممیزی A108-03 — صفحه‌ی آخر هم «بخشی از اسناد» است (bridgeDrillPager مشترک با UI)
      // نشست ۱۷۳ · S173-D2 — خطای خواندن drill هشدار صریح می‌گیرد، نه «۰ سند» بی‌صدا
      sourcesWarning: drill
        ? drill.page.failed
          ? `اسناد سازنده‌ی این ردیف خوانده نشد (خطا در خواندن پایگاه داده). عدد ردیف (${money(r.amount)} ریال) ` +
            'از جمع اصلی گزارش است و معتبر می‌ماند؛ فهرست خالی به معنی «بدون سند» نیست. ' +
            'گزارش را دوباره باز کنید یا صفحه‌ی کوچک‌تری انتخاب کنید.'
          : (bridgeDrillPager(drill.page, drill.sources.length).warning ?? undefined)
        : undefined
    })
  }

  if (!bridgeRaw.balanced)
    warnings.push(
      `پل تطبیق بسته نشد: ${Math.abs(bridgeRaw.unexplained)} ریال بدون توضیح مانده است. ` +
        'روی ردیف‌های پل کلیک کنید تا اسناد سازنده‌ی هر عدد باز شود.'
    )
  /** نشست ۱۷۰ · S169-D4 — یادداشت ارجاعی: سهم اعتبار صادرشده‌ی بازه که عمداً در پل نیست */
  if (n(sc.issuedUnbacked) > 0)
    notes.push(
      `${n(sc.issuedUnbacked)} ریال اعتبار خرید بی‌سند (صدور دستی/گروهی مدیر، ${n(sc.issuedUnbackedCount)} بارکد) در این بازه صادر شد. ` +
        'این مبلغ جزو «اعتبار صادرشده»ی گزارش اعتبار است، ولی چون فروش یا پولی پشتش نیست در پل تطبیق کم نمی‌شود؛ ' +
        'برای ضدسرقت، فهرست اعتبارهای دستی را در تب اعتبار خرید بررسی کنید.'
    )
  if (n(sc.issuedRemainder) > 0)
    notes.push(
      `${n(sc.issuedRemainder)} ریال از اعتبار صادرشده‌ی این بازه «باقی‌مانده»ی مصرف جزئی اعتبار یک‌بارمصرف است ` +
        `(${n(sc.issuedRemainderCount)} بارکد)؛ ادامه‌ی بدهی قبلی است و در پل تطبیق دوباره کم نمی‌شود.`
    )
  /** نشست ۱۷۱ · S170-D3 */
  if (overpayRemainder > 0)
    notes.push(
      `${overpayRemainder} ریال از اعتبار صادرشده‌ی این بازه «باقی‌مانده»ی مصرف جزئی اعتبار اضافه‌دریافت قبلی است ` +
        `(${n(sc.issuedOverpayRemainderCount)} بارکد)؛ اضافه‌دریافت این بازه نیست و در پل تطبیق دوباره کم نمی‌شود.`
    )
  if (ret.legacyAssumedCount > 0)
    notes.push(
      `${ret.legacyAssumedCount} برگشت قدیمی روش بازپرداخت ثبت‌شده ندارد و با فرض «فقط بدهی مشتری کم شد» ` +
        'خوانده شده است (برچسب: فرض‌شده از داده‌ی قدیمی).'
    )

  const statements: SaleAccountingStatements = {
    period: scope.period,
    invoice: {
      grossSales: accrual.grossSales,
      discounts: accrual.discounts,
      taxes: accrual.taxes,
      serviceCharges: accrual.serviceCharges,
      deliveryFees: accrual.deliveryFees,
      simpleReturns: accrual.simpleReturns,
      exchangeReturned: ret.exchangeReturned,
      netAccrualSales: accrual.netAccrualSales,
      invoiceCount: inv.count
    },
    credit: {
      created: credit.created,
      settledCurrent: Math.max(0, pay.totals.currentPeriod),
      settledPrior: pay.totals.priorPeriod,
      /**
       * کار الف (جلسه ۳۶) — تفکیک همان وصولی بر اساس مقصد. بستن صندوق فقط
       * `settledPriorCash` را در «نقد مورد انتظار» می‌گذارد؛ سهم کارتخوان و
       * «سایر» جدا می‌مانند. جمع سه‌تا = `settledPrior`.
       */
      settledPriorCash: pay.totals.priorPeriodCash,
      settledPriorCard: pay.totals.priorPeriodCard,
      settledPriorOther: pay.totals.priorPeriodOther,
      /** نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی، داخل settledPrior */
      settledPriorOverpay: n(pay.totals.priorPeriodOverpay),
      settledPriorStories: priorStories.stories,
      settledPriorStoryHidden: priorStories.hidden,
      remaining: credit.remaining,
      pendingCheques: pay.cheques.pending,
      bouncedCheques: pay.cheques.bounced
    },
    returns: {
      simpleReturns: ret.simpleReturns,
      cashRefunds: ret.cashRefunds,
      cardRefunds: ret.cardRefunds,
      storeCreditRefunds: ret.storeCreditIssued,
      debtOnlyReturns: ret.debtOnlyReturns,
      exchangeReturned: ret.exchangeReturned,
      exchangeReplacement: ret.exchangeReplacement,
      exchangeDiffReceived: ret.exchangeDiffReceived,
      exchangeCashRefunds: ret.exchangeCashRefunds,
      exchangeCardRefunds: ret.exchangeCardRefunds,
      exchangeStoreCreditIssued: ret.exchangeStoreCreditIssued,
      returnCount: ret.returnCount,
      exchangeCount: ret.exchangeCount,
      legacyAssumedCount: ret.legacyAssumedCount
    },
    cheques: {
      registered: pay.cheques.registered,
      cleared: pay.cheques.cleared,
      pendingFuture: pay.cheques.pendingFuture,
      pendingPastDue: pay.cheques.pendingPastDue,
      bounced: pay.cheques.bounced,
      pastDueCount: pay.cheques.pastDueCount,
      futureCount: pay.cheques.futureCount,
      priorCleared: pay.totals.priorClearedCheques,
      // ---- کار الف (جلسه ۳۶): مقصد چکِ پاس‌شده ----
      clearedToCash: pay.cheques.clearedToCash,
      clearedToCard: pay.cheques.clearedToCard,
      clearedToManager: pay.cheques.clearedToManager,
      clearedUnknown: pay.cheques.clearedUnknown,
      warnings: pay.cheques.warnings
    },
    storeCredits: {
      issued: sc.issued, used: sc.used, active: sc.active,
      /** نشست ۶۱ — سهم اعتبارهای صادرشده از اضافه‌دریافت (داخل issued) */
      issuedFromOverpay: sc.issuedFromOverpay,
      /** نشست ۱۷۰ · S169-D4 — تفکیک صادرشده (همه داخل issued) */
      issuedBacked: sc.issuedBacked, issuedUnbacked: sc.issuedUnbacked, issuedRemainder: sc.issuedRemainder,
      /** نشست ۱۷۱ · S170-D3 — داخل issuedFromOverpay */
      issuedOverpayRemainder: sc.issuedOverpayRemainder,
      /** خاستگاه‌های مانعةالجمع؛ هر عدد فقط از صورت حسابداری main آمده است. */
      issuedLifecycleReturn: sc.issuedLifecycleReturn,
      issuedLifecycleExchange: sc.issuedLifecycleExchange,
      issuedLifecycleManual: sc.issuedLifecycleManual,
      issuedLifecycleOverpay: sc.issuedLifecycleOverpay,
      issuedLifecycleRemainder: sc.issuedLifecycleRemainder,
      issuedLifecycleOther: sc.issuedLifecycleOther,
      expired: sc.expired,
      expiredInRange: sc.expiredInRange,
      canceled: sc.canceled,
      issuedCount: sc.issuedCount, usageCount: sc.usageCount,
      usedStories: sc.usedStories ?? []
    },
    cash,
    bridge: {
      rows,
      explainedTotal: bridgeRaw.explainedTotal,
      target: bridgeRaw.target,
      unexplained: bridgeRaw.unexplained,
      balanced: bridgeRaw.balanced
    },
    notes
  }

  return { statements, warnings }
}

/** گردش نقدی خارج از فروش یک بازه/شیفت (برداشت، واریز، موجودی اول). */
export async function cashMovementTotals(input: {
  shiftId?: number | null
  userId?: number | null
  from?: Date | null
  to?: Date | null
}): Promise<{ openingFloat: number; withdrawals: number; deposits: number; refunds: number }> {
  const where: Prisma.CashMovementWhereInput = {
    ...(input.shiftId != null ? { shiftId: input.shiftId } : {}),
    ...(input.userId != null ? { userId: input.userId } : {}),
    ...(input.from != null || input.to != null ? { occurredAt: dateRange(input.from ?? null, input.to ?? null) } : {})
  }
  const rows = await prisma.cashMovement.groupBy({ by: ['type'], where, _sum: { amount: true } })
  const by = new Map(rows.map((r) => [r.type, n(r._sum.amount)]))
  return {
    openingFloat: by.get(CashMovementType.OPENING_FLOAT) ?? 0,
    withdrawals: (by.get(CashMovementType.WITHDRAWAL) ?? 0) + (by.get(CashMovementType.CASH_OUT) ?? 0),
    deposits: (by.get(CashMovementType.DEPOSIT) ?? 0) + (by.get(CashMovementType.CASH_IN) ?? 0),
    refunds: (by.get(CashMovementType.RETURN_REFUND) ?? 0) + (by.get(CashMovementType.EXCHANGE_REFUND) ?? 0)
  }
}
