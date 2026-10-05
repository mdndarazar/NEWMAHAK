import { toJalaliDate, toClock } from '@shared/jalali'
import { saleStatusLabel, ORDER_TYPE_LABELS, OrderType, PaymentKind, PaymentEntryKind, ChequeStatus, ReturnKind } from '@shared/enums'
import { calculateReturnTotals, receiptBucketOf, type Period, type ReturnEvent } from '@shared/accounting'
import { sessionLabelOf } from '@shared/receipt'
import { remainingOf, debtAdjustmentsOf } from '@shared/settlement'
import type { SaleReportRow, SaleReportTotals, SaleReportGroup, SaleReportSessionGroup } from '@shared/types'
import { toNumberRial } from '@shared/money'

/**
 * ---------------------------------------------------------------------------
 * توابع خالص «شکل دادن» به ردیف‌های گزارش فروش.
 *
 * چرا جدا؟ هم SalesService (گزارشات فروش)، هم CashboxService (بستن صندوق و
 * تجمیع) و هم ShiftService به یک محاسبه‌ی *یکسان* از جمع‌ها و ستون‌ها نیاز
 * دارند. اگر هرکدام خودش جمع می‌زد، عددهای «گزارش فروش» و «بستن صندوق» با هم
 * واگرا می‌شدند — دقیقاً چیزی که در کار روزانه‌ی شیفت‌ها فاجعه است.
 *
 * هیچ‌کدام از این توابع به prisma دست نمی‌زنند (تست‌پذیر و بدون وابستگی).
 *
 * ⚠️ جلسه ۱۴ — تقسیم کار با `src/shared/accounting.ts`:
 * این فایل «شکل ردیف جدول» را می‌سازد؛ هر جمع *مالی* از `accounting.ts` صدا
 * زده می‌شود (اینجا فرمول مالی جدیدی نوشته نمی‌شود). به‌خصوص تفکیک
 * برگشت/تعویض/بازپرداخت کاملاً به `calculateReturnTotals` واگذار شده است.
 * ---------------------------------------------------------------------------
 */

/**
 * تفکیک دریافتی‌ها بر اساس نوع روش پرداخت (بدون هم‌پوشانی).
 *
 * ⚠️ چکِ پاس‌نشده پول دریافت‌شده نیست: ردیف پرداختی با `kind = CHEQUE` تا وقتی
 * وضعیتش «پاس شد» نشده باشد در هیچ‌کدام از این جمع‌ها شمرده نمی‌شود، پس گزارش
 * فروش و بستن صندوق فقط پولی را نشان می‌دهند که واقعاً به صندوق آمده است.
 * پرداختی‌های قدیمی (`kind = CASH`، پیش‌فرض ستون) مثل قبل کامل شمرده می‌شوند.
 *
 * ⚠️ جلسه ۱۴ (بند ۲-۲): ردیف‌های پرداختی‌ای که به این تابع می‌رسند از قبل با
 * **تاریخ خودشان** فیلتر شده‌اند (`paidAt` برای پرداخت، `clearedAt` برای چکِ
 * پاس‌شده) — نه با تاریخ فاکتور مادر. پارامتر `period` همان فیلتر را به‌صورت
 * دفاع دوم در حافظه هم اعمال می‌کند تا اگر یک مسیرِ فراموش‌شده بدون `where`
 * صدا بزند، عدد گزارش بی‌صدا غلط نشود.
 */
function paymentHomeShift(p: any): number | null {
  const isCheque = (p?.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
  if (isCheque && p?.chequeStatus === ChequeStatus.CLEARED && p?.clearedShiftId != null)
    return Number(p.clearedShiftId)
  return p?.createdShiftId != null ? Number(p.createdShiftId) : null
}

function paymentSplit(payments: any[] = [], period?: Period | null, invoiceShiftId?: number | null) {
  let cash = 0
  let card = 0
  let credit = 0
  let other = 0
  /**
   * ---------------------- کار الف (جلسه ۳۶): مقصد پول ----------------------
   * `managerAccount` = پولی که مشتری پرداخته ولی به حساب مدیر رفته. بدهی مشتری
   *   را کم می‌کند (چون در `paidTotal` فاکتور هست) ولی در `receivedTotal` و در
   *   انتظارهای صندوق **نمی‌آید**.
   * `destinationUnknown` = چکِ پاس‌شده‌ی قدیمی بدون مقصد. تا جلسه ۳۵ بی‌صدا در
   *   سبد «سایر» می‌نشست و از آن‌جا به «انتظار کارتخوان» اضافه می‌شد؛ حالا سبد و
   *   برچسب خودش را دارد و هیچ حدسی برایش زده نمی‌شود. برای دست‌نخوردن جمع‌های
   *   قبلی همچنان داخل `receivedTotal` شمرده می‌شود.
   */
  let managerAccount = 0
  let destinationUnknown = 0
  /**
   * بخش ۶ — دو سبد «پول نقد نیست»:
   *   exchangeCredit = ارزش کالای برگشتی که داخل سند تعویض تسویه شده.
   *   storeCredit    = «بارکد اعتبار خرید بعدی» که روی این فاکتور مصرف شده.
   * هر دو در `paidTotal` فاکتور می‌نشینند (پس فاکتور تسویه‌شده است) ولی عمداً از
   * نقدی/کارت/اعتباری و از `receivedTotal` بیرون می‌مانند تا «خالص واقعی
   * دریافتی» گزارش دستکاری‌ناپذیر بماند.
   */
  let exchangeCredit = 0
  let storeCredit = 0
  let overpay = 0
  for (const p of payments) {
    const isCheque = (p?.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
    if (isCheque && p?.chequeStatus !== ChequeStatus.CLEARED) continue
    // دفاع دوم: رویداد با تاریخ *خودش* داخل بازه باشد
    if (period && !inRange(isCheque ? (p?.clearedAt ?? p?.paidAt) : p?.paidAt, period)) continue
    /**
     * بند ۱۴/۵۳ — وصول نشست ۲ روی فاکتور نشست ۱ زیر نشست فاکتور شمرده نشود.
     * آن پول با `createdShiftId`/`clearedShiftId` به نشست ثبت‌کننده می‌رود.
     */
    const home = paymentHomeShift(p)
    if (invoiceShiftId != null && home != null && home !== Number(invoiceShiftId)) continue
    const kind = p?.method?.kind ?? PaymentKind.CUSTOM
    const amount = toNumberRial(p?.amount ?? 0)
    overpay += Math.max(0, toNumberRial(p?.overpayAmount ?? 0))
    // تنها منبع حقیقتِ سبدبندی — `accounting.ts`
    switch (receiptBucketOf({ isCheque, destination: p?.destination ?? null, methodKind: kind })) {
      case 'exchangeCredit': exchangeCredit += amount; break
      case 'storeCredit': storeCredit += amount; break
      case 'cash': cash += amount; break
      case 'card': card += amount; break
      case 'credit': credit += amount; break
      case 'managerAccount': managerAccount += amount; break
      case 'unknown': destinationUnknown += amount; break
      default: other += amount
    }
  }
  return { cash, card, credit, other, managerAccount, destinationUnknown, exchangeCredit, storeCredit, overpay }
}

/** آیا این لحظه داخل بازه است؟ (هر دو سر شامل؛ بازه‌ی خالی = همه‌چیز) */
function inRange(value: unknown, period?: Period | null): boolean {
  if (!period || (period.from == null && period.to == null)) return true
  if (value == null) return false
  const t = new Date(value as any).getTime()
  if (Number.isNaN(t)) return false
  if (period.from != null && t < new Date(period.from as any).getTime()) return false
  if (period.to != null && t > new Date(period.to as any).getTime()) return false
  return true
}

/** برچسب روش‌های پرداخت یک فاکتور، برای چاپ روی رسید و ستون گزارش. */
export function paymentLabels(payments: any[] = []): string {
  return payments
    .map((p) => (p?.method?.label ? String(p.method.label) : 'پرداخت'))
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .join(' + ')
}

/**
 * جمع برگشت **ساده**ی یک فاکتور (بند ۲-۱ و ۲-۵).
 *
 * دو قاعده‌ی سخت:
 *   ۱) فقط `kind = RETURN`. تعویض (`kind = EXCHANGE`) هرگز از این عدد رد
 *      نمی‌شود، وگرنه ارزش کالای برگشتی تعویض دوبار از فروش تعهدی کم می‌شود.
 *   ۲) بر مبنای `returnedAt` خودِ برگشت، نه `issuedAt` فاکتور مادر. فاکتور ماه
 *      اول که ماه دوم برگشت خورد، اثر برگشتش در گزارش **ماه دوم** می‌افتد.
 *
 * ⚠️ رکوردهای قدیمی که `kind` ندارند (تهی) برگشت ساده حساب می‌شوند — همان
 * رفتار قبل از افزودن ستون `kind`، پس هیچ عددی برای داده‌ی قدیمی عوض نمی‌شود.
 */
export function returnedTotalOf(invoice: any, period?: Period | null): number {
  return (invoice?.returns ?? []).reduce((s: number, r: any) => {
    if ((r?.kind ?? ReturnKind.RETURN) !== ReturnKind.RETURN) return s
    if (period && !inRange(r?.returnedAt, period)) return s
    return s + toNumberRial(r?.total ?? 0)
  }, 0)
}

export interface ShapeSaleRowOptions {
  /** بازه‌ی گزارش؛ برگشت/پرداخت با تاریخ خودشان به این بازه محدود می‌شوند */
  period?: Period | null
  /**
   * جمع برگشت ساده‌ی **کل تاریخ** هر فاکتور (بدون فیلتر بازه).
   *
   * چرا جدا؟ چون `remaining` (باقی‌ماندهٔ بدهی) یک عدد «تا این لحظه» است، نه یک
   * عدد بازه‌ای: فاکتور نسیه‌ای که *بعد* از بازه‌ی گزارش کامل برگشت خورده،
   * امروز دیگر طلبی ندارد. اگر این عدد را با برگشت‌های فیلترشده حساب کنیم،
   * گزارشِ ماه اول برای همان فاکتور طلب دروغ نشان می‌دهد.
   */
  returnedAllTime?: Map<number, number>
  /**
   * نشست ۵۸ · C2 — برگشت + بازپرداخت «کل تاریخ» هر فاکتور. اگر داده شود، بدهی
   * ردیف با همان `remainingOf` واحد حساب می‌شود (نه فرمول محلی).
   */
  debtAllTime?: Map<number, { returnedValue: number; refundFromReceived: number }>
}

/**
 * یک فاکتور فروش → یک ردیف جدول گزارش (ستون‌های «سرجمع فروش»).
 * فاکتور باید با include { customer, user, shift, payments: { include: method },
 * returns } خوانده شده باشد.
 */
export function shapeSaleRow(inv: any, opts: ShapeSaleRowOptions = {}): SaleReportRow {
  const period = opts.period ?? null
  const issuedAt = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
  const split = paymentSplit(inv.payments, period, inv.shiftId ?? null)
  const consolidated = inv.consolidationId != null

  // تفکیک برگشت/تعویض/بازپرداخت — تنها منبع حقیقت: accounting.ts
  const returnTotals = calculateReturnTotals((inv.returns ?? []) as ReturnEvent[], period ?? undefined)

  // نشست ۱۸۱: این فایل با ردیف‌های `any` کار می‌کند، پس typecheck خطای BigInt را
  // نگرفت و باگ فقط در زمان اجرا (هارنس وفادار) بیرون آمد.
  const grandTotal = toNumberRial(inv.grandTotal ?? 0)
  const paidTotal = toNumberRial(inv.paidTotal ?? 0)
  /**
   * بند ۲-۷ — باقی‌ماندهٔ بدهی *همیشه* برگشت را کم می‌کند، وگرنه فاکتور نسیه‌ای
   * که کاملاً برگشت خورده هنوز طلب نشان می‌دهد.
   *   remaining = max(0, grandTotal − paidTotal − returnedTotal(kind=RETURN))
   * عددِ برگشت اینجا «کل تاریخ» است (نه بازه‌ای) — توضیحش در ShapeSaleRowOptions.
   */
  const returnedAllTime = opts.returnedAllTime?.get(inv.id) ?? returnedTotalOf(inv, null)
  /**
   * نشست ۵۸ · C2 — تنها فرمول بدهی: `remainingOf`. اگر نقشه‌ی کل‌تاریخ نیامده
   * باشد، از برگشت‌های include‌شده‌ی خود فاکتور (بدون فیلتر بازه) ساخته می‌شود.
   */
  const debtAdj =
    opts.debtAllTime?.get(inv.id) ??
    (opts.debtAllTime ? { returnedValue: 0, refundFromReceived: 0 } : null) ??
    (opts.returnedAllTime ? { returnedValue: returnedAllTime, refundFromReceived: 0 } : debtAdjustmentsOf(inv.returns ?? []))
  const debt = remainingOf({ grandTotal, received: paidTotal, ...debtAdj })

  return {
    id: inv.id,
    receiptNo: inv.receiptNo,
    dateJalali: inv.issuedAtJalali || toJalaliDate(issuedAt),
    time: toClock(issuedAt),
    customerName: inv.customer?.name ?? 'مشتری عمومی',
    status: inv.status,
    statusLabel: saleStatusLabel(inv.status, consolidated),
    orderTypeLabel: ORDER_TYPE_LABELS[inv.orderType] ?? inv.orderType ?? '—',
    userName: inv.user?.displayName ?? 'مدیر',
    shiftId: inv.shiftId ?? null,
    shiftNumber: inv.shift?.number ?? null,
    shiftName: inv.shift?.name ?? (inv.shiftId ? 'شیفت ' + inv.shiftId : 'بدون شیفت'),
    /**
     * جلسه ۱۹ — برچسب نشست: «شیفت شب — نشست ۲».
     * `shiftName` عمداً دست‌نخورده می‌ماند (سرجمع همان نام)، و این فیلد تازه
     * است که نشست‌ها را در گزارش بی‌ابهام از هم جدا می‌کند.
     */
    shiftSessionSeq: inv.shift?.sessionSeq ?? null,
    shiftSessionLabel: inv.shift?.name
      ? sessionLabelOf(inv.shift.name, inv.shift.sessionSeq ?? 1)
      : null,
    // نشست ۱۸۱: این پنج ستون هم BigInt شده‌اند. چون `inv` این‌جا `any` است،
    // typecheck ساکت بود و باگ تازه در `sumTotals` (جمعِ number با bigint) در
    // زمان اجرا بیرون می‌زد — دور از محل واقعی اشکال.
    goodsTotal: toNumberRial(inv.goodsTotal ?? 0),
    taxTotal: toNumberRial(inv.taxTotal ?? 0),
    serviceCharge: toNumberRial(inv.serviceCharge ?? 0),
    discountTotal: toNumberRial(inv.discountTotal ?? 0),
    deliveryFee: toNumberRial(inv.deliveryFee ?? 0),
    grandTotal,
    cashTotal: split.cash,
    cardTotal: split.card,
    creditTotal: split.credit,
    otherTotal: split.other,
    /**
     * کار الف — «دریافتی فروشگاه». `managerAccount` عمداً بیرون است (به فروشگاه
     * نرسیده). `destinationUnknown` داخل است تا جمع دریافتیِ ردیف‌های قدیمی
     * مو‌به‌مو همان عدد قبلی بماند.
     */
    receivedTotal: split.cash + split.card + split.credit + split.other + split.destinationUnknown,
    managerAccountTotal: split.managerAccount,
    destinationUnknownTotal: split.destinationUnknown,
    /** فقط برگشت ساده‌ی *داخل بازه* — تعویض اینجا نمی‌آید (بند ۲-۳) */
    returnedTotal: returnTotals.simpleReturns,
    returnCode: inv.returnCode ?? null,
    consolidated,
    deductInventory: inv.deductInventory !== false,
    // فروش نسیه: جمع پرداختی‌های دریافت‌شده و باقی‌مانده‌ی همین فاکتور
    paidTotal,
    remaining: debt.remaining,
    settled: debt.settled,
    // تعویض کالا و اعتبار خرید بعدی (بخش ۶) — جدا از پول نقد
    exchangeCreditTotal: split.exchangeCredit,
    storeCreditTotal: split.storeCredit,
    isExchange: inv.orderType === OrderType.EXCHANGE,
    overpayTotal: split.overpay,
    // ---- افزوده‌های جلسه ۱۴ ----
    exchangeReturnedTotal: returnTotals.exchangeReturned,
    refundCashTotal: returnTotals.cashRefunds,
    refundCardTotal: returnTotals.cardRefunds,
    refundDebtOnlyTotal: returnTotals.debtOnlyReturns,
    legacyRefundAssumed: (inv.returns ?? []).some(
      (r: any) => (r?.kind ?? ReturnKind.RETURN) === ReturnKind.RETURN && !r?.refundMethod
    )
  }
}

export function emptyTotals(): SaleReportTotals {
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
    creditTotal: 0,
    otherTotal: 0,
    receivedTotal: 0,
    returnedTotal: 0,
    exchangeCreditTotal: 0,
    storeCreditUsedTotal: 0,
    storeCreditIssuedTotal: 0,
    exchangeCount: 0,
    exchangeDiffTotal: 0,
    overpayTotal: 0,
    // بند ۷ — همیشه پر می‌شوند، حتی صفر (ردیف صفر هم باید در گزارش دیده شود)
    creditRemainingTotal: 0,
    priorSettlementTotal: 0,
    netReceivedTotal: 0,
    // ---- افزوده‌های جلسه ۱۴ ----
    exchangeReturnedTotal: 0,
    refundCashTotal: 0,
    refundCardTotal: 0,
    refundDebtOnlyTotal: 0,
    storeCreditRefundTotal: 0,
    legacyRefundCount: 0,
    // کار الف — همیشه پر می‌شوند، حتی صفر (ردیف صفر هم باید در گزارش دیده شود)
    managerAccountTotal: 0,
    destinationUnknownTotal: 0
  }
}

export function sumTotals(rows: SaleReportRow[]): SaleReportTotals {
  const t = emptyTotals()
  for (const r of rows) {
    t.count++
    t.goodsTotal += r.goodsTotal
    t.taxTotal += r.taxTotal
    t.serviceTotal += r.serviceCharge
    t.discountTotal += r.discountTotal
    t.deliveryTotal += r.deliveryFee
    t.grandTotal += r.grandTotal
    t.cashTotal += r.cashTotal
    t.cardTotal += r.cardTotal
    t.creditTotal += r.creditTotal
    t.otherTotal += r.otherTotal
    t.receivedTotal += r.receivedTotal
    t.returnedTotal += r.returnedTotal
    t.exchangeCreditTotal += r.exchangeCreditTotal
    t.storeCreditUsedTotal += r.storeCreditTotal
    t.overpayTotal += r.overpayTotal
    // بند ۷: باقی‌ماندهٔ بدهی همین بازه (نسیه‌ای که پولش به صندوق نیامده)
    t.creditRemainingTotal += Math.max(0, r.remaining)
    if (r.isExchange) t.exchangeCount++
    // ---- جلسه ۱۴ ----
    t.exchangeReturnedTotal += r.exchangeReturnedTotal
    t.refundCashTotal += r.refundCashTotal
    t.refundCardTotal += r.refundCardTotal
    t.refundDebtOnlyTotal += r.refundDebtOnlyTotal
    if (r.legacyRefundAssumed) t.legacyRefundCount++
    // ---- کار الف (جلسه ۳۶) ----
    t.managerAccountTotal += r.managerAccountTotal
    t.destinationUnknownTotal += r.destinationUnknownTotal
  }
  /**
   * «خالص واقعی دریافتی» = نقد واقعی منهای بارکدهای اعتبارِ *صادرشده*.
   * مبلغ صادرشده از جدول StoreCredit می‌آید (نه از فاکتورها)، پس `SalesService`
   * بعد از این تابع آن را پر و همین عدد را بازمحاسبه می‌کند.
   */
  t.netReceivedTotal = t.receivedTotal - t.storeCreditIssuedTotal
  return t
}

/**
 * گروه‌بندی «روز → نام شیفت → نشست‌ها» برای چک‌باکس «جداسازی بر اساس شیفت».
 *
 * ============================ جلسه ۱۹ · بند ۱ ============================
 * تا دیروز هر رکورد شیفت یک گروه بود. حالا که هر بار دست‌به‌دست شدن صندوق یک
 * «نشست» تازه می‌سازد، گروه اصلی روی **نام شیفت** بسته می‌شود:
 *   • `rows` و `totals` گروه = مجموع همه‌ی نشست‌های آن نام در همان روز (تجمیع،
 *     دقیقاً همان «مجموع شیفت X» که گزارش می‌خواهد).
 *   • `sessions` = ریز هر نشست با جمع‌های خودش، پس «شیفت شب — نشست ۱» و «شیفت
 *     شب — نشست ۲» جدا و بی‌ابهام دیده می‌شوند و هیچ‌کدام گم نمی‌شوند.
 *
 * ترتیب خروجی همان ترتیب کار واقعی فروشگاه است: روزها از قدیم به جدید و داخل
 * هر روز به ترتیب اولین نشست هر نام. فاکتورهای بدون شیفت در یک گروه «بدون
 * شیفت» جمع می‌شوند، نه این‌که گم شوند.
 */
/**
 * 🔴 نشست ۱۸۶ · بند ۴-۱۴ و ۴-۵۳ — نشستی که فقط «وصول نسیه» دارد هم ردیف می‌گیرد.
 *
 * گروه‌ها تا امروز فقط از **فاکتورهای همان بازه** ساخته می‌شدند. اگر نشستی
 * هیچ فروش تازه‌ای نداشت ولی ۷۰۰٬۰۰۰ وصول نسیه‌ی فاکتور قدیمی داشت:
 *   • عددها درست بودند (`cashTotal` و `realCash` همان ۷۰۰٬۰۰۰ را می‌گفتند)،
 *   • ولی **ردیف آن نشست اصلاً وجود نداشت** و جمع ردیف‌ها با جمع کل نمی‌خواند.
 *
 * مدیری که دنبال «این پول در کدام شیفت وارد شد» می‌گردد، هیچ سطری پیدا
 * نمی‌کرد. حالا `activeSessions` نشست‌هایی را می‌آورد که در بازه *فعالیت مالی*
 * داشته‌اند، حتی اگر فروشی نداشته باشند؛ گروهشان با جمعِ صفرِ فروش ساخته
 * می‌شود تا حداقل دیده شوند.
 */
export function groupByDayShift(
  rows: SaleReportRow[],
  shiftMeta: Map<number, any> = new Map(),
  activeSessions: {
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
): SaleReportGroup[] {
  const clock = (id: number | null, field: 'openedAt' | 'closedAt'): string | null => {
    const meta = id != null ? shiftMeta.get(id) : null
    const v = meta?.[field]
    return v ? toClock(new Date(v)) : null
  }
  const orderOf = (r: SaleReportRow): number => {
    const meta = r.shiftId != null ? shiftMeta.get(r.shiftId) : null
    const v = meta?.openedAt ? new Date(meta.openedAt).getTime() : NaN
    return Number.isFinite(v) ? v : (r.shiftId ?? 0)
  }

  const groups = new Map<string, SaleReportGroup & { sessions: SaleReportSessionGroup[]; order: number }>()
  const sessionsByKey = new Map<string, Map<string, SaleReportSessionGroup>>()

  for (const r of rows) {
    const named = r.shiftId != null
    const name = named ? r.shiftName : 'بدون شیفت'
    const key = `${r.dateJalali}#${named ? name : '—'}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        title: `${r.dateJalali} · ${name}`,
        dayJalali: r.dateJalali,
        // در تجمیع چند نشست، شناسه‌ی «یک» شیفت معنا ندارد ⇒ پایین‌تر تصحیح می‌شود
        shiftId: r.shiftId ?? null,
        shiftNumber: r.shiftNumber ?? null,
        shiftName: name,
        openedAt: null,
        closedAt: null,
        closed: false,
        rows: [],
        totals: emptyTotals(),
        sessions: [],
        order: orderOf(r)
      }
      groups.set(key, g)
      sessionsByKey.set(key, new Map())
    }
    g.rows.push(r)
    g.order = Math.min(g.order, orderOf(r))

    // ---- ریز نشست‌ها ----
    const sKey = `${key}#${r.shiftId ?? 0}`
    const bucket = sessionsByKey.get(key)!
    let sg = bucket.get(sKey)
    if (!sg) {
      sg = {
        key: sKey,
        shiftId: r.shiftId ?? null,
        sessionSeq: r.shiftSessionSeq ?? null,
        sessionLabel: named ? r.shiftSessionLabel || r.shiftName : 'بدون شیفت',
        openedAt: clock(r.shiftId ?? null, 'openedAt'),
        closedAt: clock(r.shiftId ?? null, 'closedAt'),
        closed: !!clock(r.shiftId ?? null, 'closedAt'),
        rows: [],
        totals: emptyTotals()
      }
      bucket.set(sKey, sg)
    }
    sg.rows.push(r)
  }

  /**
   * نشست ۱۸۶ — نشست‌های «فقط وصول» که هیچ ردیف فروشی نساخته‌اند.
   * عمداً *بعد از* حلقه‌ی ردیف‌ها اضافه می‌شوند تا اگر همان نشست فروش هم
   * داشته باشد، چیزی دوباره ساخته نشود.
   */
  for (const a of activeSessions) {
    const key = `${a.dayJalali}#${a.shiftName}`
    let g = groups.get(key)
    if (!g) {
      g = {
        key,
        title: `${a.dayJalali} · ${a.shiftName}`,
        dayJalali: a.dayJalali,
        shiftId: a.shiftId,
        shiftNumber: null,
        shiftName: a.shiftName,
        openedAt: null,
        closedAt: null,
        closed: false,
        rows: [],
        totals: sumTotals([]),
        sessions: [],
        order: (() => {
          const meta = shiftMeta.get(a.shiftId)
          const v = meta?.openedAt ? new Date(meta.openedAt).getTime() : NaN
          return Number.isFinite(v) ? v : a.shiftId
        })()
      } as SaleReportGroup & { sessions: SaleReportSessionGroup[]; order: number }
      groups.set(key, g)
      sessionsByKey.set(key, new Map())
    }
    const bucket = sessionsByKey.get(key)!
    /** همان کلید ردیف‌های فروش (`${key}#${shiftId}`) تا نشستِ فقط‌وصول تکراری ساخته نشود. */
    const sKey = `${key}#${a.shiftId}`
    if (!bucket.has(sKey))
      bucket.set(sKey, {
        key: `${key}#${sKey}`,
        shiftId: a.shiftId,
        sessionSeq: a.sessionSeq ?? null,
        sessionLabel: a.shiftName,
        openedAt: clock(a.shiftId, 'openedAt'),
        closedAt: clock(a.shiftId, 'closedAt'),
        closed: !!shiftMeta.get(a.shiftId)?.closedAt,
        rows: [],
        totals: sumTotals([])
      })
  }

  const extraOf = (shiftId: number | null) =>
    activeSessions.find((a) => a.shiftId === shiftId && (a.receivedTotal ?? 0) > 0)

  const applyExtra = (t: SaleReportTotals, extra: (typeof activeSessions)[number] | undefined) => {
    if (!extra) return t
    t.cashTotal += extra.cashTotal ?? 0
    t.cardTotal += extra.cardTotal ?? 0
    t.managerAccountTotal += extra.managerAccountTotal ?? 0
    t.destinationUnknownTotal += extra.destinationUnknownTotal ?? 0
    t.receivedTotal += extra.receivedTotal ?? 0
    t.priorSettlementTotal += extra.priorSettlementTotal ?? 0
    return t
  }

  const out: SaleReportGroup[] = []
  for (const [key, g] of groups) {
    g.rows.sort((a, b) => a.time.localeCompare(b.time) || a.receiptNo - b.receiptNo)
    g.totals = sumTotals(g.rows)

    const sessions = [...(sessionsByKey.get(key)?.values() ?? [])]
    for (const sg of sessions) {
      sg.rows.sort((a, b) => a.time.localeCompare(b.time) || a.receiptNo - b.receiptNo)
      sg.totals = sumTotals(sg.rows)
      /** وصول نسیه‌ی فاکتور نشست دیگر، حتی اگر این نشست خودش فروش هم داشته باشد. */
      applyExtra(sg.totals, extraOf(sg.shiftId))
    }
    if (!g.rows.length) {
      for (const sg of sessions) {
        g.totals.cashTotal += sg.totals.cashTotal
        g.totals.cardTotal += sg.totals.cardTotal
        g.totals.managerAccountTotal += sg.totals.managerAccountTotal
        g.totals.destinationUnknownTotal += sg.totals.destinationUnknownTotal
        g.totals.receivedTotal += sg.totals.receivedTotal
        g.totals.priorSettlementTotal += sg.totals.priorSettlementTotal
      }
    } else {
      for (const sg of sessions) applyExtra(g.totals, extraOf(sg.shiftId))
    }
    sessions.sort((a, b) => (a.sessionSeq ?? 0) - (b.sessionSeq ?? 0) || (a.shiftId ?? 0) - (b.shiftId ?? 0))
    g.sessions = sessions

    /**
     * ساعت شروع/پایان گروه = شروع اولین نشست و پایان آخرین نشست همان نام.
     * اگر آخرین نشست هنوز باز است، گروه هم «باز» شمرده می‌شود.
     */
    g.openedAt = sessions[0]?.openedAt ?? null
    const last = sessions[sessions.length - 1]
    g.closedAt = last?.closedAt ?? null
    g.closed = !!last?.closed
    if (sessions.length > 1) g.shiftId = null
    out.push(g)
  }

  out.sort(
    (a, b) =>
      a.dayJalali.localeCompare(b.dayJalali) ||
      ((a as any).order ?? 0) - ((b as any).order ?? 0) ||
      a.shiftName.localeCompare(b.shiftName)
  )
  return out
}
