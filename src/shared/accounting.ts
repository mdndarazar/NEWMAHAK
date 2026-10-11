/**
 * هسته‌ی محاسبات مالی ماهک POS.
 *
 * این فایل عمداً هیچ وابستگی به Prisma، Electron یا React ندارد. سرور،
 * گزارشگر، چاپ، خروجی فایل و بستن صندوق باید داده‌های خام خود را به این
 * توابع بدهند؛ فرمول مالی نباید در چند نقطه‌ی مختلف تکثیر شود.
 *
 * همه‌ی مبالغ ریال صحیح هستند. این لایه گرد کردن اعشاری انجام نمی‌دهد و
 * فقط ورودی‌ها را به عدد صحیح ریال تبدیل می‌کند.
 */

/**
 * نشست ۶۰ · بند ۴-۵/۴-۹ — بخش *بازپرداخت‌شده* (نقد/کارت/کارت‌به‌کارت/اعتبار) از
 * مابه‌التفاوت منفی یک تعویض = −exchangeDiff − debtReduction. تعویض قدیمی
 * (debtReduction = ۰) ⇒ دقیقاً همان −exchangeDiff قبلی.
 */
export function exchangeRefundPartOf(r: { exchangeDiff?: RialLike | null; debtReduction?: RialLike | null }): number {
  const r0 = (x: unknown): number => { const v = Math.round(Number(x ?? 0)); return Number.isFinite(v) ? v : 0 }
  const owed = Math.max(0, -r0(r.exchangeDiff))
  return Math.max(0, owed - Math.max(0, r0(r.debtReduction)))
}

export type Rial = number
export type PaymentKind = 'CASH' | 'CARD' | 'CREDIT' | 'CUSTOM' | 'OTHER' | 'EXCHANGE_CREDIT' | 'STORE_CREDIT'
export type PaymentEntryKind = 'CASH' | 'CHEQUE'
export type ChequeStatus = 'PENDING' | 'CLEARED' | 'BOUNCED'
export type ReturnKind = 'RETURN' | 'EXCHANGE'
export type RefundMethod = 'CASH' | 'CARD' | 'STORE_CREDIT' | 'NONE' | 'CARD_TO_CARD'

export interface Period {
  from?: Date | string | number | null
  to?: Date | string | number | null
}

/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف — چرا ورودی‌ها `RialLike` شدند
 * ---------------------------------------------------------------------------
 * بعد از مهاجرت ۸۳ ستون مالی به `BigInt`، ردیف‌های Prisma مقدار `bigint`
 * می‌دهند. دو راه وجود داشت:
 *
 *   الف) در هر صدازننده، تک‌تک فیلدها قبل از پاس دادن تبدیل شوند
 *        ⇒ صدها نقطه‌ی ویرایش دستی، و هر مورد جاافتاده یک خطای زمان اجرا.
 *   ب) *ورودی* این موتور هر دو شکل را بپذیرد و خودش یک بار نرمال کند.
 *
 * (ب) انتخاب شد. نکته‌ی مهم: این تغییر فقط روی **واسط‌های ورودی** است.
 * خروجی‌ها (`InvoiceTotals`، `ReturnTotals`، ...) همچنان `Rial = number`اند و
 * هیچ‌کدام از ~۱۱٬۵۰۰ خط محاسبه‌ی داخلی یک کاراکتر هم عوض نشد — چون همه‌شان
 * از `n()` عبور می‌کنند که تنها دروازه‌ی ورود عدد به این فایل است.
 * ===========================================================================
 */
export type RialLike = number | bigint

export interface InvoiceLine {
  qty?: RialLike
  unitPrice?: RialLike
  discount?: RialLike
  tax?: RialLike
}

export interface InvoiceInput {
  lines?: InvoiceLine[]
  goodsTotal?: RialLike
  discountTotal?: RialLike
  taxTotal?: RialLike
  serviceCharge?: RialLike
  deliveryFee?: RialLike
  issuedAt?: Date | string | number
}

export interface InvoiceTotals {
  grossGoods: Rial
  netGoods: Rial
  lineDiscounts: Rial
  invoiceDiscount: Rial
  discounts: Rial
  tax: Rial
  service: Rial
  delivery: Rial
  grandTotal: Rial
}

export interface ReturnEvent {
  id?: number | string
  kind?: ReturnKind | string
  total?: RialLike
  refundMethod?: RefundMethod | string | null
  refundAmount?: RialLike
  returnedAt?: Date | string | number
  exchangeTotal?: RialLike
  exchangeDiff?: RialLike
  exchangeSettlement?: string | null
  /** نشست ۶۰ (بند ۴-۵) — کاهش بدهی فاکتور اصلی از مابه‌التفاوت منفی تعویض */
  debtReduction?: RialLike | null
  sourceInvoiceId?: number | string | null
  /** درخواست کارت‌به‌کارت این سند لغو شده — تعهد پرداخت دیگر وجود ندارد */
  refundCanceled?: boolean
}

export interface ReturnTotals {
  simpleReturns: Rial
  exchangeReturned: Rial
  exchangeReplacement: Rial
  cashRefunds: Rial
  cardRefunds: Rial
  storeCreditIssued: Rial
  debtOnlyReturns: Rial
  exchangeDiffReceived: Rial
  exchangeCashRefunds: Rial
  exchangeCardRefunds: Rial
  exchangeStoreCreditIssued: Rial
  /**
   * جلسه ۱۷ · بند ۱ — برگشت‌هایی که تسویه‌شان «کارت‌به‌کارت توسط مدیر» است.
   * در لحظه‌ی برگشت هیچ پولی جابه‌جا نشده، پس نه نقد است، نه کارتِ کارت‌خوان، نه
   * اعتبار خرید: یک تعهد پرداخت *بیرون از جریان فروش*.
   */
  cardToCardPending: Rial
  /** همان، برای مابه‌التفاوت منفیِ تعویض */
  exchangeCardToCardPending: Rial
  count: number
}

export interface PaymentEvent {
  id?: number | string
  amount?: RialLike
  kind?: PaymentEntryKind | string
  methodKind?: PaymentKind | string | null
  paidAt?: Date | string | number
  clearedAt?: Date | string | number | null
  chequeStatus?: ChequeStatus | string | null
  /**
   * کار الف (جلسه ۳۶) — «مقصد پول»: CARD | CASH | MANAGER · null = داده‌ی قدیمی.
   * تنها مبنای سبدبندی این مبلغ است و از `receiptBucketOf()` رد می‌شود.
   */
  destination?: string | null
  dueDate?: Date | string | number | null
  invoiceIssuedAt?: Date | string | number | null
  invoiceId?: number | string | null
  invoiceReceiptNo?: number | string | null
}

export interface PaymentTotals {
  cash: Rial
  card: Rial
  credit: Rial
  other: Rial
  exchangeCredit: Rial
  storeCredit: Rial
  registeredCheques: Rial
  clearedCheques: Rial
  pendingCheques: Rial
  bouncedCheques: Rial
  currentPeriod: Rial
  priorPeriod: Rial
  /**
   * کار الف (جلسه ۳۶) — تفکیک «وصول نسیه‌ی بازه‌های قبل» بر اساس مقصد.
   * جمع سه‌تا = `priorPeriod`. فقط `priorPeriodCash` به «نقد مورد انتظار» بستن
   * صندوق می‌رود؛ `priorPeriodCard` پول کارتخوان است و `priorPeriodOther` بقیه.
   * (سهم مقصد‌مدیر اصلاً در `priorPeriod` شمرده نمی‌شود — به فروشگاه نرسیده.)
   */
  priorPeriodCash: Rial
  priorPeriodCard: Rial
  priorPeriodOther: Rial
  priorClearedCheques: Rial
  /**
   * نشست ۱۶۱ · Y19 (S161-D2) — دریافتیِ همین بازه بابت فاکتورهای بازه‌های قبل که به «حساب مدیر»
   * رفته / مقصدش «نامشخص» است. در `priorPeriod` نیستند (به صندوق نرسیده‌اند) ولی باید در پل ردیف
   * منفی بگیرند، وگرنه ردیف «دریافتی به حساب مدیر»/«نامشخص» پل را به همین اندازه باز می‌گذارد.
   * اختیاری تا سازندگان قدیمی این نوع نشکنند.
   */
  priorManagerAccount?: Rial
  priorDestinationUnknown?: Rial
  /**
   * ⚠️ کار الف (جلسه ۳۶) — معنای این عدد **دقیق** شد: فقط چکِ پاس‌شده‌ای که
   * مقصدش «نقد در صندوق فروشگاه» ثبت شده است. تا جلسه ۳۵ برابر کلِ
   * `clearedCheques` بود و همان مبلغ از راه سبد «سایر» به انتظار کارتخوان هم
   * اضافه می‌شد ⇒ هر چک پاس‌شده دو بار در انتظارهای صندوق شمرده می‌شد.
   */
  clearedCashCheques: Rial
  /** چکِ پاس‌شده‌ای که با کارتخوان فروشگاه وصول شده */
  clearedCardCheques: Rial
  /** چکِ پاس‌شده‌ای که پولش به حساب مدیر رفته (به فروشگاه نیامده) */
  clearedManagerCheques: Rial
  /** چکِ پاس‌شده‌ی قدیمی بدون مقصد — «نامشخص»، بدون هیچ حدسی */
  clearedUnknownCheques: Rial
  /**
   * کار الف — پرداختیِ *غیرچکیِ* نسیه که به حساب مدیر رفته، و پرداختی قدیمیِ
   * بی‌مقصد. `managerAccount` عمداً در هیچ انتظار صندوقی نمی‌آید.
   */
  managerAccount: Rial
  destinationUnknown: Rial
  /**
   * نشست ۱۸۵ · بند ۴-۲۴ — بخشی از `destinationUnknown` که احتمالاً پول کشو
   * بوده (روش نقد، بدون مقصد، داده‌ی پیش از migration مقصد). زیرمجموعه است،
   * نه ردیف جدا: با `destinationUnknown` جمع **نمی‌شود**.
   */
  unknownLikelyCash: Rial
  ignoredNonCash: Rial
  /**
   * نشست ۱ زنجیره رفع · B1 — جمع قدرمطلق `Payment`های منفیِ داده‌ی قدیمی
   * (بازپرداخت‌هایی که قبلاً به‌شکل پرداختی منفی ثبت شده‌اند). در هیچ سبد
   * دریافتی نمی‌آید؛ فقط برای شفافیت و یادداشت گزارش برمی‌گردد.
   */
  legacyNegativePayments: Rial
  /**
   * نشست ۵۸ · C4 — «دریافت پول اضافه»: جمع overpayAmount پرداخت‌های دریافت‌شده‌ی
   * همین بازه روی فاکتورهای همین بازه (وصول دوره‌ی قبل جداست). پول واقعاً آمده
   * ولی فروش نیست ⇒ در پل تطبیق با علامت منفی.
   */
  overpayReceived?: Rial
  /**
   * نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی: سهم اضافه‌دریافت (overpayAmount) از همان ردیف‌هایی که در
   * `priorPeriod` جمع شده‌اند (وصول فاکتور دوره‌ی قبل که بیش از بدهی بود). داخل `priorPeriod` است و هیچ
   * جمع/پل/انتظار صندوقی آن را نمی‌خواند؛ فقط برچسب «اضافه‌دریافت روی فاکتور دوره‌ی قبل (فروش نیست)».
   */
  priorPeriodOverpay?: Rial
}

export interface ChequeTotals {
  registered: Rial
  cleared: Rial
  pendingPastDue: Rial
  pendingFuture: Rial
  bounced: Rial
  pending: Rial
  pastDueCount: number
  futureCount: number
  /**
   * کار الف (جلسه ۳۶) — تفکیک `cleared` بر اساس «مقصد پول».
   * جمع چهارتا = `cleared`. `clearedToCash` تنها عددی است که به «نقد مورد
   * انتظار» بستن صندوق می‌رود؛ `clearedToCard` به انتظار کارتخوان؛
   * `clearedToManager` و `clearedUnknown` به هیچ‌کدام.
   */
  clearedToCash: Rial
  clearedToCard: Rial
  clearedToManager: Rial
  clearedUnknown: Rial
  warnings: string[]
}

export interface StoreCreditEvent {
  amount?: RialLike
  status?: string | null
  issuedAt?: Date | string | number | null
  usedAt?: Date | string | number | null
  expiresAt?: Date | string | number | null
  sourceId?: number | string | null
}

export interface StoreCreditTotals {
  issued: Rial
  used: Rial
  active: Rial
  /** ماندهٔ اعتبارهایی که تا پایان بازه منقضی شده‌اند (snapshot وضعیت). */
  expired: Rial
  /** ماندهٔ اعتبارهایی که تاریخ انقضایشان داخل خودِ بازهٔ انتخاب‌شده است. */
  expiredInRange?: Rial
  canceled: Rial
  usageCount: number
  issuedCount: number
  /** نشست ۶۱ — سهم اضافه‌دریافت (داخل issued) */
  issuedFromOverpay?: Rial
  /** نشست ۱۷۰ · S169-D4 — سهم سند‌دار (برگشت/تعویض واقعی، غیر باقی‌مانده) — فقط همین در پل کم می‌شود */
  issuedBacked?: Rial
  /** نشست ۱۷۰ · S169-D4 — اعتبار دستی/گروهی بی‌سند (returnId = null، غیر OVERPAY) */
  issuedUnbacked?: Rial
  issuedUnbackedCount?: number
  /** نشست ۱۷۰ · S169-D4 — «باقی‌مانده»ی مصرف جزئی اعتبار یک‌بارمصرف */
  issuedRemainder?: Rial
  issuedRemainderCount?: number
  /** نشست ۱۷۱ · S170-D3 — «باقی‌مانده»ی مصرف جزئی اعتبار اضافه‌دریافت (داخل issuedFromOverpay) */
  issuedOverpayRemainder?: Rial
  issuedOverpayRemainderCount?: number
  /**
   * گردش اعتبار ـ خاستگاه‌های متقابلاً مجزای صدور. برخلاف فیلدهای قدیمیِ
   * سازگاری، هر اعتبار صادرشده دقیقاً در یکی از این شش سبد قرار می‌گیرد.
   */
  issuedLifecycleReturn?: Rial
  issuedLifecycleExchange?: Rial
  issuedLifecycleManual?: Rial
  issuedLifecycleOverpay?: Rial
  issuedLifecycleRemainder?: Rial
  issuedLifecycleOther?: Rial
}

export interface AccrualInput {
  invoices?: InvoiceInput[]
  simpleReturns?: RialLike
  exchangeReturned?: RialLike
}

export interface AccrualStatement {
  grossSales: Rial
  discounts: Rial
  taxes: Rial
  serviceCharges: Rial
  deliveryFees: Rial
  simpleReturns: Rial
  exchangeReturned: Rial
  netAccrualSales: Rial
}

export interface CashStatementInput {
  payments?: PaymentTotals | Partial<PaymentTotals>
  returns?: ReturnTotals | Partial<ReturnTotals>
  priorCreditSettlements?: RialLike
  cashWithdrawals?: RialLike
  cashDeposits?: RialLike
}

export interface CashStatement {
  cashReceived: Rial
  cardReceived: Rial
  otherReceived: Rial
  /**
   * کار الف (جلسه ۳۶) — «دریافتی به حساب مدیر»: پولی که مشتری واقعاً پرداخته،
   * ولی به صندوق و کارتخوانِ فروشگاه نیامده. عمداً **در `netCashMovement` نیست**
   * و در هیچ انتظار صندوقی نمی‌آید؛ فقط یک ردیف جدا و توضیح‌دار می‌گیرد.
   */
  managerAccountReceived: Rial
  /** کار الف — دریافتیِ قدیمیِ بدون مقصد («نامشخص»)، بدون هیچ حدسی */
  destinationUnknownReceived: Rial
  clearedChequeReceived: Rial
  /** کار الف — تفکیک همان `clearedChequeReceived` بر اساس مقصد */
  clearedChequeToCash: Rial
  clearedChequeToCard: Rial
  clearedChequeToManager: Rial
  clearedChequeUnknown: Rial
  priorCreditSettlements: Rial
  cashRefundsForReturns: Rial
  cardRefundsForReturns: Rial
  cashRefundsForExchanges: Rial
  cardRefundsForExchanges: Rial
  cashWithdrawals: Rial
  cashDeposits: Rial
  netCashMovement: Rial
  /** نشست ۱۸۵ · بند ۴-۲۴ — زیرمجموعه‌ی «نامشخص» که احتمالاً پول کشو بوده */
  unknownLikelyCash: Rial
}

export interface CashCloseInput {
  openingFloat?: RialLike
  cashReceived?: RialLike
  /**
   * ⚠️ کار الف (جلسه ۳۶) — `priorCashSettlements` از این نسخه فقط **سهم نقدِ**
   * وصول نسیه‌ی بازه‌های قبل است. قبلاً کل وصولی (نقد + کارت + سایر) اینجا
   * می‌آمد، پس پولی که روی کارتخوان نشسته بود «نقد مورد انتظار» را بالا می‌برد.
   */
  /**
   * ⚠️ کار الف (جلسه ۳۶) — از این نسخه **فقط چکِ پاس‌شده‌ای که مقصدش «نقد در
   * صندوق فروشگاه» ثبت شده**. قبلاً کلِ چک‌های پاس‌شده اینجا می‌آمد، حتی چکی که
   * پولش با کارتخوان وصول شده یا به حساب مدیر رفته بود ⇒ «نقد مورد انتظار»
   * بی‌دلیل بالا می‌رفت و صندوق کسری نشان می‌داد.
   */
  clearedCashChequeAmount?: RialLike
  /**
   * کار الف — چکِ پاس‌شده‌ی **قدیمیِ** بدون مقصد ثبت‌شده.
   *
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — این مبلغ دیگر در انتظار نقد **نمی‌نشیند**؛
   * فقط در `unknownDestinationOutside` برمی‌گردد تا پنل بستن صندوق آن را با برچسب
   * «نامشخص» و هشدار صریح بیرون از نقد مورد انتظار نشان دهد. snapshot بستن‌های
   * قبلی (ستون‌های ذخیره‌شده‌ی CashSession) بازمحاسبه نمی‌شود.
   * برای داده‌ی تازه همیشه صفر است (مقصد اجباری است).
   */
  clearedUnknownChequeAmount?: RialLike
  /**
   * کار الف — «دریافتی به حساب مدیر» فقط برای *نمایش* به این تابع می‌آید و در
   * `expectedCash` هیچ نقشی ندارد. صریح نوشته شده تا کسی فردا وسوسه نشود آن را
   * به فرمول اضافه کند.
   */
  managerAccountReceived?: RialLike
  /** نشست ۱۶۴ · Y21 — فقط نمایشی (داخل cashReceived است)؛ در expectedCash جمع زده نمی‌شود */
  priorCashSettlements?: RialLike
  deposits?: RialLike
  cashReturnRefunds?: RialLike
  cashExchangeRefunds?: RialLike
  withdrawals?: RialLike
  countedCash?: RialLike
  /**
   * نشست ۱۸۵ · بند ۴-۲۴ — بخشی از دریافتی‌های «مقصد نامشخص» که احتمالاً نقد
   * بوده (روش نقد، بدون مقصد، از داده‌ی پیش از migration مقصد). داخل
   * `expectedCash` می‌ماند تا کسری دروغ ساخته نشود، ولی ستون جدای خودش را
   * دارد تا پنهان هم نباشد.
   */
  unknownLikelyCash?: RialLike
}

export interface CashCloseResult {
  openingFloat: Rial
  expectedCash: Rial
  countedCash: Rial
  cashDifference: Rial
  state: 'SHORTAGE' | 'OVERAGE' | 'MATCHED'
  requiresNote: boolean
  /**
   * کار الف — مبلغی که مشتری پرداخته ولی به صندوق/کارتخوان فروشگاه نرسیده.
   * همیشه برمی‌گردد (حتی صفر) و **هیچ‌وقت** در `expectedCash` یا
   * `cashDifference` نیست؛ فقط ردیف توضیح‌دار پنل را می‌سازد.
   */
  managerAccountReceived: Rial
  /**
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — همیشه ۰. فقط برای سازگاری فیلد نگه داشته شده؛
   * سهم «نامشخص» دیگر هرگز داخل `expectedCash` نمی‌نشیند.
   */
  unknownDestinationInExpected: Rial
  /**
   * نشست ۱۸۵ — همان «احتمالاً نقد» که داخل `expectedCash` حساب شده.
   * ستون جدا دارد تا مدیر ببیند چقدر از نقد مورد انتظار، از داده‌ی بی‌مقصدِ
   * قدیمی می‌آید و بتواند درباره‌اش تصمیم بگیرد.
   */
  unknownLikelyCashInExpected: Rial
  /**
   * نشست ۱۶۱ · Y18 — چکِ پاس‌شده‌ی قدیمی با مقصد نامشخص: سبد جدا، **بیرون** از
   * `expectedCash` و `cashDifference`، فقط برای ردیف و هشدار صریح پنل بستن صندوق.
   */
  unknownDestinationOutside: Rial
  /**
   * نشست ۱۶۴ · Y21 — سهم نقدِ وصول نسیه‌ی دوره‌های قبل که **داخل** `cashReceived`/چک نقدی است.
   * فقط نمایشی؛ در `expectedCash` دوباره جمع زده نمی‌شود.
   */
  priorCashSettlementsIncluded: Rial
}

export interface BridgeInput {
  realCash?: RialLike
  /**
   * کار الف (جلسه ۳۶) — «دریافتی به حساب مدیر».
   *
   * چرا پل تطبیق *باید* این ردیف را داشته باشد: پرداختِ مقصد‌مدیر بدهی مشتری را
   * کم می‌کند، پس `uncollectedCredit` به همان اندازه پایین می‌آید؛ ولی این پول
   * داخل `realCash` نیست (به فروشگاه نرسیده). بدون این ردیف، پل تطبیق دقیقاً به
   * اندازه‌ی همان مبلغ **باز** می‌ماند و گزارش هشدار «بدون توضیح» می‌داد.
   */
  managerAccountReceived?: RialLike
  /**
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ — «دریافتی با مقصد نامشخص» (چکِ پاس‌شده‌ی قدیمیِ بی‌مقصد).
   * مثل ردیف حساب مدیر: بدهی مشتری کم شده ولی این پول داخل `realCash` نیست.
   */
  destinationUnknownReceived?: RialLike
  /**
   * 🔴 نشست ۱۸۵ · بند ۴-۲۴ (تصمیم مالک) — بخشی از «نامشخص» که **احتمالاً نقد**
   * بوده: پرداختِ با روشِ نقد و بدون مقصد، از داده‌ی پیش از migration مقصد.
   *
   * سبد رسمی‌اش `unknown` است (پس در گزارش صادقانه دیده می‌شود)، ولی چون
   * آن روزها روش «نقد» فقط می‌توانست کشو باشد، همین مبلغ در `expectedCash`
   * می‌ماند تا شیفت‌های قدیمی **کسری دروغ** نشان ندهند.
   */
  unknownLikelyCash?: RialLike
  storeCreditIssued?: RialLike
  priorCreditSettlements?: RialLike
  priorClearedCheques?: RialLike
  /** نشست ۱۶۱ · Y19 — حساب مدیر / نامشخصِ فاکتورهای بازه‌های قبل (ردیف منفی) */
  priorManagerAccountReceived?: RialLike
  priorDestinationUnknownReceived?: RialLike
  storeCreditUsed?: RialLike
  uncollectedCredit?: RialLike
  /**
   * ⚠️ نشست ۵۹ — **منسوخ و بی‌اثر** (فقط برای سازگاری امضای فراخوان‌های قدیمی).
   * از نشست ۵۸ بدهی واحد (`remainingOf`) اثر برگشتِ کاهنده‌ی بدهی را از قبل در
   * `uncollectedCredit` آورده است؛ جمع دوباره‌ی آن با علامت + پل را دقیقاً به
   * اندازه‌ی همان برگشت باز می‌گذاشت. جایگزین: `priorDebtReturns` (فقط برگشت روی
   * فاکتورهای بیرون از بازه) با علامت −.
   */
  debtOnlyReturns?: RialLike
  /** نشست ۵۸ · C4 — اضافه‌دریافت این بازه (از aggregate واقعی، نه ردیف‌های صفحه) */
  overpayReceived?: RialLike
  /**
   * نشست ۵۹ · بند ۴-۵۴ — بازپرداخت‌های برگشت ساده‌ی این بازه، هر کدام یک ردیف
   * مستقل با علامت −. مبلغ = همان سهم «پس‌داده از پول دریافتی» که `remainingOf`
   * می‌بیند (min(total, refundAmount))، پس دقیقاً یک‌بار اعمال می‌شود.
   */
  cashRefunds?: RialLike
  cardRefunds?: RialLike
  /** کارت‌به‌کارت لغونشده (در انتظار یا پرداخت‌شده) — تعهد پرداخت مدیر */
  cardToCardRefunds?: RialLike
  /** نشست ۵۹ — همان سه سبد برای مابه‌التفاوت منفیِ تعویض (از SaleReturn، نه Payment منفی) */
  exchangeCashRefunds?: RialLike
  exchangeCardRefunds?: RialLike
  exchangeCardToCardRefunds?: RialLike
  /**
   * نشست ۵۹ — برگشت ساده‌ی این بازه روی فاکتورِ *بیرون از* بازه (فروش دوره‌ی قبل):
   * سهم کاهنده‌ی بدهی/ایجادکننده‌ی اضافه‌دریافت (total − بازپرداخت). فروش خالص این
   * بازه را کم کرده ولی در `uncollectedCredit` این بازه نیست.
   */
  priorDebtReturns?: RialLike
  netAccrualSales?: RialLike
}

export interface BridgeRow {
  key: string
  label: string
  amount: Rial
  sign: 1 | -1
  sourceIds: Array<number | string>
}

export interface ReconciliationBridge {
  rows: BridgeRow[]
  explainedTotal: Rial
  target: Rial
  unexplained: Rial
  balanced: boolean
}

/**
 * تنها دروازه‌ی ورود عدد به این موتور.
 *
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` عمداً از `toNumberRial` می‌گذرد و نه از
 * `Number(v)`. مسیر دوم *کار می‌کرد* ولی هر مبلغ بالای `MAX_SAFE_INTEGER` را
 * بی‌صدا گرد می‌کرد؛ یعنی همان چیزی که کل مهاجرت به BigInt برای حذفش انجام شد،
 * از پنجره برمی‌گشت. حالا در آن حالت خطا می‌دهد.
 */
const n = (value: unknown): number => {
  if (typeof value === 'bigint') {
    /**
     * ⚠️ نشست ۱۸۱ — این محافظ عمداً این‌جا **درون‌خطی** نوشته شده و از
     * `@shared/money` import نمی‌شود.
     *
     * دلیلش یک قاعده‌ی قدیمی و عمدی این فایل است: `accounting.ts` هیچ import ای
     * ندارد تا بتواند مستقیم با Node خام اجرا شود
     * (`test/accounting-session13.ts` دقیقاً همین کار را می‌کند). افزودن یک
     * import نسبیِ بدون پسوند، آن تست را با `ERR_MODULE_NOT_FOUND` شکست —
     * که در اولین اجرای مرحله ۴ همین اتفاق افتاد.
     *
     * رفتار دقیقاً همان `toNumberRial` است: بیرون از محدوده‌ی امن، خطا — نه
     * گرد کردن بی‌صدا.
     */
    if (value > 9007199254740991n || value < -9007199254740991n)
      throw new RangeError(`مبلغ ${value.toString()} از محدوده‌ی امن عدد جاوااسکریپت بیرون است`)
    return Number(value)
  }
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0
}
const dateOf = (value: unknown): Date | null => {
  if (value == null || value === '') return null
  const d = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}
const inPeriod = (value: unknown, period: Period): boolean => {
  const d = dateOf(value)
  if (!d) return false
  const from = dateOf(period.from)
  const to = dateOf(period.to)
  return (!from || d >= from) && (!to || d <= to)
}
const dayDelta = (a: Date, b: Date): number => Math.ceil((a.getTime() - b.getTime()) / 86400000)

/**
 * جمع فاکتور. goodsTotal در دیتابیس «جمع قیمت قبل از تخفیف» است.
 */
export function calculateInvoiceTotals(input: InvoiceInput = {}): InvoiceTotals {
  const lines = input.lines ?? []
  const grossGoods = lines.length
    ? lines.reduce((s, l) => s + n(l.qty || 1) * n(l.unitPrice), 0)
    : n(input.goodsTotal)
  const lineDiscounts = lines.reduce((s, l) => s + n(l.discount), 0)
  const totalDiscount = n(input.discountTotal)
  const invoiceDiscount = Math.max(0, totalDiscount - lineDiscounts)
  const discounts = lineDiscounts + invoiceDiscount
  const tax = lines.reduce((s, l) => s + n(l.tax), 0) + n(input.taxTotal)
  const service = n(input.serviceCharge)
  const delivery = n(input.deliveryFee)
  const netGoods = grossGoods - discounts
  return { grossGoods, netGoods, lineDiscounts, invoiceDiscount, discounts, tax, service, delivery,
    grandTotal: netGoods + tax + service + delivery }
}

export function calculateReturnTotals(events: ReturnEvent[] = [], period?: Period): ReturnTotals {
  const out: ReturnTotals = {
    simpleReturns: 0, exchangeReturned: 0, exchangeReplacement: 0, cashRefunds: 0,
    cardRefunds: 0, storeCreditIssued: 0, debtOnlyReturns: 0, exchangeDiffReceived: 0,
    exchangeCashRefunds: 0, exchangeCardRefunds: 0, exchangeStoreCreditIssued: 0,
    cardToCardPending: 0, exchangeCardToCardPending: 0, count: 0
  }
  for (const r of events) {
    if (period && !inPeriod(r.returnedAt, period)) continue
    const total = Math.max(0, n(r.total))
    const exchange = r.kind === 'EXCHANGE'
    out.count++
    if (exchange) {
      out.exchangeReturned += total
      out.exchangeReplacement += Math.max(0, n(r.exchangeTotal))
      const diff = n(r.exchangeDiff ?? n(r.exchangeTotal) - total)
      if (diff > 0) out.exchangeDiffReceived += diff
      if (diff < 0) {
        /* نشست ۱ زنجیره رفع · B1 — یک نگاشت واحد؛ `CASH_REFUND`/`CARD_REFUND`
           که نویسنده‌ی سند می‌نوشت دیگر به سبد «اعتبار خرید» نمی‌افتد. */
        const { bucket } = normalizeSettlement({ exchangeSettlement: r.exchangeSettlement, refundMethod: r.refundMethod })
        /* نشست ۶۰ (بند ۴-۵) — فقط بخش بازپرداخت‌شده؛ کاهش بدهی فاکتور اصلی پول نیست */
        const refunded = exchangeRefundPartOf({ exchangeDiff: diff, debtReduction: r.debtReduction })
        if (refunded <= 0) { /* فقط کاهش بدهی */ }
        else if (bucket === 'CASH_REFUND') out.exchangeCashRefunds += refunded
        else if (bucket === 'CARD_REFUND') out.exchangeCardRefunds += refunded
        /* جلسه ۱۷ · بند ۱ — کارت‌به‌کارت مدیر: نه نقد، نه کارت‌خوان، نه اعتبار خرید */
        else if (bucket === 'CARD_TO_CARD') {
          if (!r.refundCanceled) out.exchangeCardToCardPending += refunded
        }
        else out.exchangeStoreCreditIssued += refunded
      }
      continue
    }
    out.simpleReturns += total
    const amount = Math.min(total, Math.max(0, n(r.refundAmount || total)))
    if (r.refundMethod === 'CASH') out.cashRefunds += amount
    else if (r.refundMethod === 'CARD') out.cardRefunds += amount
    else if (r.refundMethod === 'STORE_CREDIT') { out.storeCreditIssued += amount }
    /* جلسه ۱۷ · بند ۱ — تعهد کارت‌به‌کارت؛ «کاهش بدهی» نیست، «پرداخت فوری» هم نیست */
    else if (r.refundMethod === 'CARD_TO_CARD') {
      if (!r.refundCanceled) out.cardToCardPending += amount
    }
    else out.debtOnlyReturns += total
  }
  return out
}

/**
 * تفکیک پرداختی‌ها در حافظه.
 *
 * ⚠️ کار الف (جلسه ۳۶) — این تابع هم مثل `accountingReport.paymentStatement`
 * از **همان** `receiptBucketOf()` رد می‌شود، وگرنه دو مسیر دو عدد می‌ساختند؛
 * همان چیزی که کل این کار برای رفعش است. سه تفاوت رفتاری با جلسه ۳۵:
 *   ۱) چکِ پاس‌شده دیگر یک‌جا در `clearedCashCheques` نمی‌نشیند؛ به مقصد خودش
 *      (`clearedCashCheques`/`clearedCardCheques`/`clearedManagerCheques`/
 *      `clearedUnknownCheques`) می‌رود. جمع چهارتا = `clearedCheques`.
 *   ۲) دریافتیِ مقصد‌مدیر سبد جدای `managerAccount` دارد و در `cash`/`card`/
 *      `other` و در `priorPeriod` نمی‌آید (به فروشگاه نرسیده).
 *   ۳) `priorPeriod` به `priorPeriodCash`/`Card`/`Other` تفکیک می‌شود، چون فقط
 *      سهم نقد به «نقد مورد انتظار» بستن صندوق می‌رود.
 */
export function calculatePaymentTotals(payments: PaymentEvent[] = [], period: Period = {}): PaymentTotals {
  const out: PaymentTotals = {
    cash: 0, card: 0, credit: 0, other: 0, exchangeCredit: 0, storeCredit: 0,
    registeredCheques: 0, clearedCheques: 0, pendingCheques: 0, bouncedCheques: 0,
    currentPeriod: 0, priorPeriod: 0, priorPeriodCash: 0, priorPeriodCard: 0, priorPeriodOther: 0,
    priorClearedCheques: 0, priorManagerAccount: 0, priorDestinationUnknown: 0,
    clearedCashCheques: 0, clearedCardCheques: 0, clearedManagerCheques: 0, clearedUnknownCheques: 0,
    managerAccount: 0, destinationUnknown: 0, unknownLikelyCash: 0, ignoredNonCash: 0, legacyNegativePayments: 0
  }
  for (const p of payments) {
    const raw = n(p.amount)
    /**
     * نشست ۱ زنجیره رفع · B1 — `Payment` با مبلغ منفی «دریافتی» نیست.
     * تا این نشست `Math.max(0, …)` آن را بی‌صدا صفر می‌کرد (پس اثرش گم می‌شد) و
     * مسیر SQL همان ردیف را از دریافتیِ نقد کم می‌کرد؛ در حالی که همان بازپرداخت
     * یک بار دیگر از سند برگشت/تعویض هم کم می‌شد ⇒ دو بار. تصمیم مالک (بند ۹):
     * بازپرداخت فقط در سند برگشت/تعویض ثبت می‌شود و `Payment` منفی هرگز.
     * این ردیف‌ها (داده‌ی قدیمی) اینجا کاملاً نادیده گرفته می‌شوند تا دریافتی
     * دروغ نگوید؛ شمارشش در `legacyNegativePayments` برمی‌گردد.
     */
    if (raw < 0) { out.legacyNegativePayments += -raw; continue }
    const amount = raw
    const cheque = p.kind === 'CHEQUE'
    if (cheque) {
      if (p.chequeStatus === 'BOUNCED') out.bouncedCheques += amount
      else if (p.chequeStatus === 'CLEARED' && inPeriod(p.clearedAt, period)) {
        out.clearedCheques += amount
        const bucket = receiptBucketOf({ isCheque: true, destination: p.destination ?? null, methodKind: p.methodKind ?? 'CUSTOM' })
        if (bucket === 'cash') out.clearedCashCheques += amount
        else if (bucket === 'card') out.clearedCardCheques += amount
        else if (bucket === 'managerAccount') out.clearedManagerCheques += amount
        else out.clearedUnknownCheques += amount
        /**
         * چکِ بازه‌های قبل که *در این بازه* پاس شد. پولی که به حساب مدیر رفته
         * «وصولِ صندوق» نیست، پس در این عدد و در `priorPeriod` نمی‌آید.
         */
        /** نشست ۱۶۱ · Y19 — سهم مدیر/نامشخصِ فاکتور قبلی فقط ردیف منفی جدای پل را می‌سازد */
        if (p.invoiceIssuedAt && !inPeriod(p.invoiceIssuedAt, period)) {
          if (bucket === 'managerAccount') out.priorManagerAccount = n(out.priorManagerAccount) + amount
          else if (bucket === 'unknown') out.priorDestinationUnknown = n(out.priorDestinationUnknown) + amount
        }
        /** نشست ۱۶۱ · Y18 — سهم «نامشخص» هم مثل حساب مدیر «وصولِ صندوق» نیست (بند ۴-۲۴) */
        if (p.invoiceIssuedAt && !inPeriod(p.invoiceIssuedAt, period) && bucket !== 'managerAccount' && bucket !== 'unknown') {
          out.priorClearedCheques += amount
          out.priorPeriod += amount
          if (bucket === 'cash') out.priorPeriodCash += amount
          else if (bucket === 'card') out.priorPeriodCard += amount
          else out.priorPeriodOther += amount
        }
      } else {
        out.registeredCheques += amount
        if (p.chequeStatus !== 'BOUNCED') out.pendingCheques += amount
      }
      continue
    }
    if (!inPeriod(p.paidAt, period)) continue
    const bucket = receiptBucketOf({ isCheque: false, destination: p.destination ?? null, methodKind: p.methodKind ?? 'OTHER' })
    if (bucket === 'exchangeCredit') { out.exchangeCredit += amount; out.ignoredNonCash += amount }
    else if (bucket === 'storeCredit') { out.storeCredit += amount; out.ignoredNonCash += amount }
    else if (bucket === 'cash') out.cash += amount
    else if (bucket === 'card') out.card += amount
    else if (bucket === 'credit') out.credit += amount
    else if (bucket === 'managerAccount') out.managerAccount += amount
    else if (bucket === 'unknown') {
      out.destinationUnknown += amount
      /**
       * 🔴 نشست ۱۸۵ · بند ۴-۲۴ (تصمیم مالک) — ستون کمکی «احتمالاً نقد».
       *
       * مبلغ در سبد «نامشخص» می‌ماند (صداقت: حدس زده نشد)، ولی چون پیش از
       * وجود ستون مقصد، روش «نقد» فقط می‌توانست کشو باشد، همین بخش جدا
       * شمرده می‌شود تا در `expectedCash` بماند و کسری دروغ ساخته نشود.
       */
      if (unknownLikelyBucketOf({ isCheque: false, destination: p.destination ?? null, methodKind: p.methodKind ?? 'OTHER' }) === 'cash')
        out.unknownLikelyCash = n(out.unknownLikelyCash) + amount
    } else out.other += amount
    // پولی که به حساب مدیر رفته نه «دریافتیِ این بازه» است و نه «وصول نسیه‌ی قبل»
    if (bucket === 'managerAccount') {
      /** نشست ۱۶۱ · Y19 — ولی اگر بابت فاکتور قبلی است، ردیف منفی جدای پل را می‌سازد */
      if (!(p.invoiceIssuedAt && inPeriod(p.invoiceIssuedAt, period))) out.priorManagerAccount = n(out.priorManagerAccount) + amount
      continue
    }
    if (p.invoiceIssuedAt && inPeriod(p.invoiceIssuedAt, period)) out.currentPeriod += amount
    else {
      out.priorPeriod += amount
      if (bucket === 'cash') out.priorPeriodCash += amount
      else if (bucket === 'card') out.priorPeriodCard += amount
      else out.priorPeriodOther += amount
    }
  }
  return out
}

export function calculateChequeTotals(payments: PaymentEvent[] = [], asOf: Date | string | number = new Date(), period?: Period): ChequeTotals {
  const at = dateOf(asOf) ?? new Date()
  const out: ChequeTotals = { registered: 0, cleared: 0, pendingPastDue: 0, pendingFuture: 0, bounced: 0, pending: 0,
    pastDueCount: 0, futureCount: 0,
    clearedToCash: 0, clearedToCard: 0, clearedToManager: 0, clearedUnknown: 0,
    warnings: [] }
  for (const p of payments.filter(x => x.kind === 'CHEQUE')) {
    const amount = Math.max(0, n(p.amount))
    if (period && inPeriod(p.paidAt, period)) out.registered += amount
    if (p.chequeStatus === 'BOUNCED') { out.bounced += amount; continue }
    if (p.chequeStatus === 'CLEARED') {
      if (!period || inPeriod(p.clearedAt, period)) {
        out.cleared += amount
        /**
         * کار الف — تفکیک مقصد با همان تابع خالصِ سبدبندی. جمع چهارتا دقیقاً
         * `cleared` است، پس هیچ مبلغی نه گم می‌شود و نه دو بار شمرده می‌شود.
         */
        switch (receiptBucketOf({ isCheque: true, destination: p.destination ?? null, methodKind: p.methodKind ?? 'CUSTOM' })) {
          case 'cash': out.clearedToCash += amount; break
          case 'card': out.clearedToCard += amount; break
          case 'managerAccount': out.clearedToManager += amount; break
          default: out.clearedUnknown += amount
        }
      }
      continue
    }
    out.pending += amount
    const due = dateOf(p.dueDate)
    if (due && due < at) { out.pendingPastDue += amount; out.pastDueCount++; out.warnings.push(`چک ${p.id ?? 'بدون شماره'} ${dayDelta(at, due)} روز تأخیر دارد`) }
    else { out.pendingFuture += amount; out.futureCount++ }
  }
  return out
}

export function calculateStoreCreditTotals(events: StoreCreditEvent[] = [], period?: Period, asOf: Date | string | number = new Date()): StoreCreditTotals {
  const at = dateOf(asOf) ?? new Date()
  const out: StoreCreditTotals = { issued: 0, used: 0, active: 0, expired: 0, expiredInRange: 0, canceled: 0, usageCount: 0, issuedCount: 0 }
  for (const e of events) {
    const amount = Math.max(0, n(e.amount))
    if (!period || inPeriod(e.issuedAt, period)) { out.issued += amount; out.issuedCount++ }
    if (period && inPeriod(e.usedAt, period)) { out.used += amount; out.usageCount++ }
    // این helper رویدادِ مصرف جزئی ندارد؛ برای ردیف‌های ساده، USED یعنی مانده‌ای
    // برای سوختن نیست. سرویس گزارش authoritative، amount − usedAmount را می‌سنجد.
    if (period && e.status !== 'CANCELED' && e.status !== 'USED' && inPeriod(e.expiresAt, period))
      out.expiredInRange! += amount
    if (e.status === 'ACTIVE') out.active += amount
    else if (e.status === 'EXPIRED') out.expired += amount
    else if (e.status === 'CANCELED') out.canceled += amount
  }
  return out
}

export function calculateAccrualStatement(input: AccrualInput = {}): AccrualStatement {
  let grossSales = 0, discounts = 0, taxes = 0, serviceCharges = 0, deliveryFees = 0
  for (const invoice of input.invoices ?? []) {
    const t = calculateInvoiceTotals(invoice)
    grossSales += t.grossGoods; discounts += t.discounts; taxes += t.tax
    serviceCharges += t.service; deliveryFees += t.delivery
  }
  const simpleReturns = n(input.simpleReturns)
  const exchangeReturned = n(input.exchangeReturned)
  return { grossSales, discounts, taxes, serviceCharges, deliveryFees, simpleReturns, exchangeReturned,
    netAccrualSales: grossSales - discounts + taxes + serviceCharges + deliveryFees - simpleReturns - exchangeReturned }
}

/**
 * ===========================================================================
 * کار الف (جلسه ۳۶) — **تنها تابعی** که تصمیم می‌گیرد یک مبلغ دریافتی در کدام
 * سبد بنشیند. گزارش فروش (`reportShape.ts`)، صورت‌های حسابداری
 * (`accountingReport.ts`)، جزئیات شیفت و بستن صندوق همه از همین تابع رد می‌شوند،
 * وگرنه دو عدد متفاوت ساخته می‌شود — همان چیزی که کل این کار برای رفعش است.
 *
 * ترتیب تصمیم (عمداً همین است):
 *   ۱) روش‌های «پول نقد نیست» (ارزش کالای تعویض / بارکد اعتبار) همیشه سبد خودشان
 *      را دارند و مقصد برایشان بی‌معناست.
 *   ۲) اگر مقصد ثبت شده باشد، **مقصد حرف آخر است** (منبع حقیقت یگانه).
 *   ۳) اگر مقصد ثبت نشده باشد (داده‌ی قدیمی):
 *      • چک ⇒ سبد `unknown` («نامشخص»). هیچ حدسی زده نمی‌شود و — مهم‌تر — دیگر
 *        بی‌صدا به سبد «سایر» و از آن‌جا به انتظار کارتخوان نمی‌رود.
 *      • غیرچک ⇒ دقیقاً همان رفتار قبلی از روی `kind` روش پرداخت، تا هیچ عدد
 *        گزارش قدیمی عوض نشود.
 * ===========================================================================
 */
export type ReceiptBucket = 'cash' | 'card' | 'credit' | 'other' | 'managerAccount' | 'unknown'
  | 'exchangeCredit' | 'storeCredit'

export function receiptBucketOf(input: {
  isCheque?: boolean
  destination?: string | null
  methodKind?: string | null
}): ReceiptBucket {
  const mk = input.methodKind ?? 'CUSTOM'
  if (mk === 'EXCHANGE_CREDIT') return 'exchangeCredit'
  if (mk === 'STORE_CREDIT') return 'storeCredit'
  const d = input.destination == null ? null : String(input.destination).toUpperCase()
  /**
   * چک طبق تصمیم مالک فقط به حساب مدیر/بانک می‌رود. مقصد CASH/CARD برای
   * داده‌ی قدیمی یا ورودی ناسازگار نباید به‌عنوان پول صندوق/کارت‌خوان معتبر شود.
   */
  if (input.isCheque) return d === 'MANAGER' ? 'managerAccount' : 'unknown'
  if (d === 'MANAGER') return 'managerAccount'
  if (d === 'CASH') return 'cash'
  if (d === 'CARD') return 'card'
  /**
   * 🔴 نشست ۱۸۵ · بند ۴-۲۴ — مقصد خالی **حدس زده نمی‌شود**؛ «نامشخص» است.
   *
   * تاریخچه‌ی این تصمیم مهم است چون دو بار عوض شد:
   *
   *   • تا نشست ۱۸۳: مقصد خالی از روی روش حدس زده می‌شد (نقد ⇒ سبد نقد).
   *   • نشست ۱۸۴: خواستم «نامشخص» کنم، ولی چون کلِ مبلغ از `expectedCash`
   *     بیرون می‌افتاد، شیفت‌های گذشته **کسری دروغ** نشان می‌دادند. پس
   *     برگرداندمش.
   *   • نشست ۱۸۵ (تصمیم مالک): هر دو نگرانی با هم حل می‌شوند —
   *     مبلغ در سبد «نامشخص» دیده می‌شود (صداقت بند ۴-۲۴) **و** یک ستون
   *     کمکی «احتمالاً نقد» می‌گوید کدام بخشش به‌احتمال زیاد پول کشو بوده،
   *     تا همان بخش در `expectedCash` بماند و کسری دروغ ساخته نشود.
   *
   * یعنی عدد دیگر پنهان یا حدسی جمع‌زده نمی‌شود، ولی کسی هم دنبال پولی که
   * واقعاً در کشو بوده نمی‌گردد.
   */
  if (mk === 'CASH' || mk === 'CARD') return 'unknown'
  if (mk === 'CREDIT') return 'credit'
  return 'other'
}

/**
 * 🔴 نشست ۱۸۵ · بند ۴-۲۴ — «این مبلغِ نامشخص، احتمالاً چه بوده؟»
 *
 * فقط یک **راهنما**ست، نه یک تصمیم حسابداری: سبد رسمی همچنان `unknown` است.
 * مبنای حدس، واقعیت تاریخی است: ستون `destination` از migration
 * `20270923100000_payment_destination` به بعد وجود دارد و پیش از آن روش
 * «نقد» فقط می‌توانست کشو باشد و «کارت» فقط کارت‌خوان فروشگاه.
 *
 * چک عمداً بیرون است: آن یکی واقعاً مبهم بود (می‌توانست به حساب مدیر برود).
 */
export function unknownLikelyBucketOf(input: {
  isCheque?: boolean
  destination?: string | null
  methodKind?: string | null
}): 'cash' | 'card' | null {
  if (input.destination != null) return null
  if (input.isCheque) return null
  const mk = input.methodKind ?? ''
  if (mk === 'CASH') return 'cash'
  if (mk === 'CARD') return 'card'
  return null
}

/**
 * ===========================================================================
 * نشست ۱ زنجیره رفع · خوشه B (B1) — «تسویه‌ی یک برگشت/تعویض» یک نگاشت واحد.
 *
 * باگی که این تابع رفعش می‌کند: نویسنده‌ی سند تعویض
 * (`SalesService.createExchange`) مقدارهای `CASH_REFUND` و `CARD_REFUND` را در
 * `SaleReturn.exchangeSettlement` می‌نوشت، ولی هر دو جمع‌زننده (این فایل و
 * `accountingReport.returnStatement`) فقط `CASH` و `CARD` را می‌شناختند. نتیجه:
 * هر تعویضی که پولش نقد به مشتری برگشته بود، در گزارش به سبد «اعتبار خرید
 * صادرشده» می‌افتاد — یعنی پولِ خارج‌شده از کشو به‌عنوان «بدهی ما به مشتری»
 * دیده می‌شد و خروج نقد از «وجه واقعی» کم نمی‌شد.
 *
 * حالا نویسنده، جمع‌زننده‌ی حافظه‌ای، جمع‌زننده‌ی SQL، دفتر رویداد و پل تطبیق همه
 * از همین تابع رد می‌شوند. اضافه‌کردن یک حالت جدید در آینده فقط اینجا انجام
 * می‌شود.
 *
 * `null`/ناشناخته ⇒ `STORE_CREDIT`: رفتار تاریخیِ داده‌ی قبل از جلسه ۱۴ (آن
 * زمان برای مابه‌التفاوت منفی *همیشه* بارکد اعتبار صادر می‌شد و ستون تسویه هنوز
 * وجود نداشت). پس هیچ عدد گزارش قدیمی با این رفع عوض نمی‌شود، و `legacy = true`
 * برمی‌گردد تا UI بتواند «فرض‌شده از داده‌ی قدیمی» را نشان دهد.
 * ===========================================================================
 */
export type SettlementBucket = 'CASH_REFUND' | 'CARD_REFUND' | 'CARD_TO_CARD' | 'STORE_CREDIT' | 'CUSTOMER_PAID' | 'NONE'

export function normalizeSettlement(input: {
  exchangeSettlement?: string | null
  refundMethod?: string | null
}): { bucket: SettlementBucket; legacy: boolean } {
  const raw = input.exchangeSettlement ?? input.refundMethod ?? null
  const v = raw == null ? null : String(raw).toUpperCase()
  switch (v) {
    case 'CASH':
    case 'CASH_REFUND':
      return { bucket: 'CASH_REFUND', legacy: false }
    case 'CARD':
    case 'CARD_REFUND':
      return { bucket: 'CARD_REFUND', legacy: false }
    case 'CARD_TO_CARD':
      return { bucket: 'CARD_TO_CARD', legacy: false }
    case 'CREDIT':
    case 'STORE_CREDIT':
      return { bucket: 'STORE_CREDIT', legacy: false }
    case 'NONE':
    // نشست ۶۰ (بند ۴-۵) — فقط کاهش بدهی؛ بخش بازپرداخت‌شده صفر است (exchangeRefundPartOf)
    case 'DEBT_REDUCTION':
      return { bucket: 'NONE', legacy: false }
    default:
      return { bucket: 'STORE_CREDIT', legacy: true }
  }
}

export function calculateCashStatement(input: CashStatementInput = {}): CashStatement {
  const p = input.payments ?? {}
  const r = input.returns ?? {}
  const cashReceived = n(p.cash), cardReceived = n(p.card), otherReceived = n(p.other)
  const clearedChequeReceived = n(p.clearedCheques)
  /**
   * ---------------------- کار الف (جلسه ۳۶): مقصد پول ----------------------
   * «دریافتی به حساب مدیر» = پرداختی نسیه‌ی مقصد‌مدیر + چکِ پاس‌شده‌ی مقصد‌مدیر.
   * این عدد از `netCashMovement` **بیرون** است: مشتری پرداخته و بدهی‌اش کم شده،
   * ولی هیچ ریالی از این پول به صندوق یا کارتخوانِ فروشگاه نرسیده. اگر داخلش
   * می‌آمد، «وجه واقعی» دروغ می‌گفت و بستن صندوق اضافه‌ی بی‌دلیل نشان می‌داد.
   *
   * «نامشخص» (داده‌ی قدیمیِ بی‌مقصد) هم به همین دلیل بیرون است: هیچ حدسی زده
   * نمی‌شود، فقط با برچسب خودش دیده می‌شود.
   */
  const clearedChequeToCash = n(p.clearedCashCheques)
  const clearedChequeToCard = n(p.clearedCardCheques)
  const clearedChequeToManager = n(p.clearedManagerCheques)
  const clearedChequeUnknown = n(p.clearedUnknownCheques)
  const managerAccountReceived = n(p.managerAccount) + clearedChequeToManager
  const destinationUnknownReceived = n(p.destinationUnknown) + clearedChequeUnknown
  const priorCreditSettlements = n(input.priorCreditSettlements ?? p.priorPeriod)
  const cashRefundsForReturns = n(r.cashRefunds), cardRefundsForReturns = n(r.cardRefunds)
  const cashRefundsForExchanges = n(r.exchangeCashRefunds), cardRefundsForExchanges = n(r.exchangeCardRefunds)
  const cashWithdrawals = n(input.cashWithdrawals), cashDeposits = n(input.cashDeposits)
  /**
   * ============== چکِ پاس‌شده در «وجه واقعی»: کدام سهم می‌آید؟ ==============
   * سهم مدیر **بیرون** می‌ماند (به فروشگاه نرسیده).
   * سهم «نامشخص» (داده‌ی قدیمی) تا نشست ۱۶۰ داخل بود؛ از نشست ۱۶۱ (Y18) بیرون است (پایین).
   */
  /**
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — سهم «نامشخص» دیگر داخل نیست: حدس «این پول به
   * صندوق رسیده» همان جمع‌زدن با نقد است که بند ۴-۲۴ صریحاً ممنوع کرده. ردیف جدای خودش را
   * (`destinationUnknownReceived`) در گزارش و پل تطبیق دارد. snapshot بستن‌های قبلی از
   * ستون‌های ذخیره‌شده خوانده می‌شود و عوض نمی‌شود.
   */
  const clearedChequeInflow = clearedChequeToCash + clearedChequeToCard
  return { cashReceived, cardReceived, otherReceived,
    managerAccountReceived, destinationUnknownReceived,
    // نشست ۱۸۵ · بند ۴-۲۴ — ستون کمکی «احتمالاً نقد» (زیرمجموعه‌ی نامشخص)
    unknownLikelyCash: n(p.unknownLikelyCash),
    clearedChequeReceived, clearedChequeToCash, clearedChequeToCard, clearedChequeToManager,
    clearedChequeUnknown, priorCreditSettlements,
    cashRefundsForReturns, cardRefundsForReturns, cashRefundsForExchanges, cardRefundsForExchanges,
    cashWithdrawals, cashDeposits,
    /**
     * نشست ۱۶۴ · Y21 · بند ۴-۵۳ و ۴-۴۹ (S163-D2) — `priorCreditSettlements` دیگر اینجا جمع زده
     * نمی‌شود: از رفع A1 به بعد `cashReceived/cardReceived/otherReceived` (totals.cash/card/other)
     * و `clearedChequeInflow` (چک پاس‌شده‌ی بازه بر اساس clearedAt) **از قبل** وصول فاکتورهای
     * دوره‌های قبل را دارند. جمع‌زدن دوباره‌اش هر وصول نسیه‌ی قدیمی را دو بار در «خالص وجه واقعی»
     * می‌نشاند. `priorCreditSettlements` فقط ردیف نمایشیِ «از این مقدار، وصول نسیه‌ی دوره‌ی قبل» است.
     */
    netCashMovement: cashReceived + cardReceived + otherReceived + clearedChequeInflow
      - cashRefundsForReturns - cardRefundsForReturns - cashRefundsForExchanges - cardRefundsForExchanges
      - cashWithdrawals + cashDeposits }
}

export function calculateCashClose(input: CashCloseInput = {}, threshold = 100000): CashCloseResult {
  const openingFloat = n(input.openingFloat), countedCash = n(input.countedCash)
  /**
   * نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — چک نامشخص **بیرون** از نقد مورد انتظار؛ فقط
   * در `unknownDestinationOutside` برمی‌گردد تا پنل ردیف و هشدار جدا نشان دهد.
   */
  const unknownDestinationOutside = n(input.clearedUnknownChequeAmount)
  const unknownDestinationInExpected = 0
  /**
   * نشست ۱۸۵ — این مبلغ عمداً **داخل** `expectedCash` می‌ماند.
   * سبدش «نامشخص» است (صداقت بند ۴-۲۴)، ولی چون واقعاً پول کشو بوده، بیرون
   * گذاشتنش یعنی ساختن کسری دروغ روی هر شیفت قدیمی.
   */
  const unknownLikelyCashInExpected = n(input.unknownLikelyCash)
  /**
   * ⚠️ کار الف — «دریافتی به حساب مدیر» در این فرمول **نیست** و نباید باشد:
   * آن پول داخل کشو نیست، پس نه کسری می‌سازد و نه اضافه.
   */
  /**
   * نشست ۱۶۴ · Y21 · بند ۴-۵۳ (S163-D2) — `priorCashSettlements` **در فرمول نیست**: `cashReceived`
   * (همه‌ی پرداخت‌های نقد کشوی بازه/نشست) و `clearedCashChequeAmount` (چک نقدیِ پاس‌شده بر اساس
   * clearedAt) از قبل وصول فاکتورهای دوره‌های قبل را دارند. تا نشست ۱۶۳ این مبلغ دوباره جمع می‌شد
   * ⇒ هر وصول نسیه‌ی قدیمی به همان اندازه «کسری کاذب» در بستن صندوق می‌ساخت. این ورودی فقط برای
   * نمایش «از نقد دریافتی، این مقدار وصول دوره‌ی قبل است» نگه داشته شده (`priorCashSettlementsIncluded`).
   */
  const expectedCash =
    openingFloat + n(input.cashReceived) + n(input.clearedCashChequeAmount) + unknownLikelyCashInExpected
    + n(input.deposits) - n(input.cashReturnRefunds)
    - n(input.cashExchangeRefunds) - n(input.withdrawals)
  const cashDifference = countedCash - expectedCash
  return { openingFloat, expectedCash, countedCash, cashDifference,
    state: cashDifference < 0 ? 'SHORTAGE' : cashDifference > 0 ? 'OVERAGE' : 'MATCHED',
    requiresNote: Math.abs(cashDifference) > Math.max(0, n(threshold)),
    managerAccountReceived: n(input.managerAccountReceived),
    unknownDestinationInExpected,
    unknownLikelyCashInExpected,
unknownDestinationOutside,
    priorCashSettlementsIncluded: n(input.priorCashSettlements) }
}

/**
 * نشست ۱۸۷ — پول فیزیکی که باید در صندوق + کارت‌خوان باشد.
 *
 * ⚠️ این عدد ارزش کالای برگشتی نیست. اگر فروشنده بابت برگشت/تعویض بارکد اعتبار
 * صادر کند و نقد را هم از کشو بدهد، کم کردن «ارزش برگشت» از این عدد کسری را
 * با گزارش هم‌خوان می‌کند و دزدی پنهان می‌ماند. فقط بازپرداخت نقد/کارت واقعی
 * از پول فیزیکی کم می‌شود؛ اعتبار صادرشده بدهی ماست، خروج نقد نیست.
 *
 * نشست ۲۰۳ · بند ۴-۵۳ — `priorSettlementTotal` **در فرمول نیست**. `receivedTotal`
 * (نقد + کارت + سایرِ رویداد paidAt) از قبل وصول نسیه‌ی فاکتورهای دوره‌ی قبل را
 * دارد؛ جمع دوباره همان ۷۰٬۰۰۰ را ۱۴۰٬۰۰۰ می‌کرد و کسری کاذب می‌ساخت. بستن صندوق
 * (`expectedCash`) از نشست ۱۶۴ همین را رعایت می‌کند. ورودی فقط برای سازگاری API
 * و ردیف برچسب‌دار «وصول نسیه‌ی دوره‌ی قبل» نگه داشته شده.
 */
export function physicalMoneyInDrawerAndCard(input: {
  receivedTotal?: RialLike
  priorSettlementTotal?: RialLike
  refundCashTotal?: RialLike
  refundCardTotal?: RialLike
} = {}): Rial {
  void input.priorSettlementTotal
  return n(input.receivedTotal) - n(input.refundCashTotal) - n(input.refundCardTotal)
}

/** مبلغ اعتبار صادرشده روی یک سند برگشت (صفر اگر تسویه اعتبار نبوده). */
export function returnCreditAmountOf(r: { refundMethod?: string | null; refundAmount?: RialLike } = {}): Rial {
  return r.refundMethod === 'STORE_CREDIT' ? Math.max(0, n(r.refundAmount)) : 0
}

export function calculateReconciliationBridge(input: BridgeInput = {}): ReconciliationBridge {
  const rows: BridgeRow[] = [
    { key: 'realCash', label: 'وجه واقعی این بازه', amount: n(input.realCash), sign: 1, sourceIds: [] },
    { key: 'managerAccountReceived', label: 'دریافتی به حساب مدیر', amount: n(input.managerAccountReceived), sign: 1, sourceIds: [] },
    /** نشست ۱۶۱ · Y18 · بند ۴-۲۴ — سبد جدای «نامشخص»، هرگز با نقد یا حساب مدیر جمع زده نمی‌شود */
    { key: 'destinationUnknownReceived', label: 'دریافتی با مقصد نامشخص (داده‌ی قدیمی)', amount: n(input.destinationUnknownReceived), sign: 1, sourceIds: [] },
    { key: 'storeCreditIssued', label: 'اعتبار خرید صادرشده', amount: n(input.storeCreditIssued), sign: -1, sourceIds: [] },
    { key: 'priorCreditSettlements', label: 'وصول نسیه‌ی بازه‌های قبل', amount: n(input.priorCreditSettlements), sign: -1, sourceIds: [] },
    { key: 'priorClearedCheques', label: 'پاس‌شدن چک‌های بازه‌های قبل', amount: n(input.priorClearedCheques), sign: -1, sourceIds: [] },
    /**
     * نشست ۱۶۱ · Y19 (S161-D2) — دریافتیِ حساب مدیر/نامشخص که بابت فاکتورهای بازه‌های قبل است:
     * در ردیف‌های + بالا آمده ولی فروش یا نسیه‌ی این بازه را کم نکرده ⇒ ردیف منفی مستقل، دقیقاً یک‌بار.
     */
    { key: 'priorManagerAccountReceived', label: 'دریافتی حساب مدیر بابت فاکتورهای بازه‌های قبل', amount: n(input.priorManagerAccountReceived), sign: -1, sourceIds: [] },
    { key: 'priorDestinationUnknownReceived', label: 'دریافتی با مقصد نامشخص بابت فاکتورهای بازه‌های قبل', amount: n(input.priorDestinationUnknownReceived), sign: -1, sourceIds: [] },
    { key: 'storeCreditUsed', label: 'مصرف اعتبار خرید', amount: n(input.storeCreditUsed), sign: 1, sourceIds: [] },
    { key: 'uncollectedCredit', label: 'نسیه‌ی وصول‌نشده‌ی این بازه', amount: n(input.uncollectedCredit), sign: 1, sourceIds: [] },
    /**
     * نشست ۵۹ — ردیف «برگشت کاهنده‌ی بدهی» با علامت + حذف شد (اثرش از نشست ۵۸ در
     * `uncollectedCredit` است). به‌جایش: بازپرداخت‌ها، هر کدام ردیف مستقل منفی
     * (بند ۴-۵۴)، و برگشت روی فاکتورهای دوره‌ی قبل.
     */
    { key: 'cashRefunds', label: 'بازپرداخت نقدی برگشت (خروج از کشو)', amount: n(input.cashRefunds), sign: -1, sourceIds: [] },
    { key: 'cardRefunds', label: 'بازپرداخت کارتی برگشت (کارت‌خوان)', amount: n(input.cardRefunds), sign: -1, sourceIds: [] },
    { key: 'cardToCardRefunds', label: 'بازپرداخت کارت‌به‌کارت برگشت (تعهد مدیر)', amount: n(input.cardToCardRefunds), sign: -1, sourceIds: [] },
    { key: 'exchangeCashRefunds', label: 'بازپرداخت نقدی مابه‌التفاوت تعویض (خروج از کشو)', amount: n(input.exchangeCashRefunds), sign: -1, sourceIds: [] },
    { key: 'exchangeCardRefunds', label: 'بازپرداخت کارتی مابه‌التفاوت تعویض', amount: n(input.exchangeCardRefunds), sign: -1, sourceIds: [] },
    { key: 'exchangeCardToCardRefunds', label: 'بازپرداخت کارت‌به‌کارت مابه‌التفاوت تعویض (تعهد مدیر)', amount: n(input.exchangeCardToCardRefunds), sign: -1, sourceIds: [] },
    { key: 'priorDebtReturns', label: 'برگشتِ این بازه روی فاکتورهای بازه‌های قبل (کاهش بدهی/بدون پول)', amount: n(input.priorDebtReturns), sign: -1, sourceIds: [] },
    /** نشست ۵۸ · C4 — پول اضافه‌ای که گرفته شد ولی فروش نیست (بند ۴-۳۵: هرگز بی‌صدا) */
    { key: 'overpayReceived', label: 'دریافت پول اضافه (بیشتر از بدهی)', amount: n(input.overpayReceived), sign: -1, sourceIds: [] }
  ]
  const explainedTotal = rows.reduce((s, r) => s + r.sign * r.amount, 0)
  const target = n(input.netAccrualSales)
  return { rows, explainedTotal, target, unexplained: target - explainedTotal, balanced: target === explainedTotal }
}

// ===========================================================================
// جلسه ۱۷ — تجمیع‌کننده‌های تازه.
//
// ⚠️ قاعده‌ی سختِ این فایل رعایت شده است: **هیچ فرمول مالی جدیدی اختراع نشده**.
// توابع زیر فقط همان توابع بالا را روی زیرمجموعه‌های داده صدا می‌زنند (گروه‌بندی
// بر اساس کارمند) یا مبلغ‌های *از قبل ثبت‌شده* را جمع می‌بندند.
// ===========================================================================

/** یک تراکنش کارت‌به‌کارتِ ثبت‌شده، در حدی که این لایه لازم دارد. */
export interface CardTransferEvent {
  id?: number | string
  kind?: string | null
  status?: string | null
  amount?: number
  paidAmount?: number | null
  createdAt?: Date | string | number | null
  paidAt?: Date | string | number | null
}

export interface CardTransferTotals {
  /** جمع مبلغ درخواست‌های «در انتظار پرداخت» */
  pendingAmount: Rial
  pendingCount: number
  /** جمع مبلغی که مدیر واقعاً پرداخت کرده است */
  paidAmount: Rial
  paidCount: number
  /** جمع رویدادهای اصلاحی (مثبت یا منفی، همان‌طور که ثبت شده‌اند) */
  adjustmentAmount: Rial
  adjustmentCount: number
  /** خروج وجه واقعی = پرداخت‌شده + اصلاح‌ها */
  netOutOfSalesFlow: Rial
}

/**
 * «جریان‌های مالی خارج از فروش» (بند ۱).
 * این مبلغ عمداً در هیچ‌کدام از `calculateAccrualStatement` یا
 * `calculateCashStatement` وارد نمی‌شود: نه فروش است، نه از کشوی صندوق خارج شده.
 */
export function calculateCardTransferTotals(
  events: CardTransferEvent[] = [],
  period?: Period
): CardTransferTotals {
  const out: CardTransferTotals = {
    pendingAmount: 0, pendingCount: 0, paidAmount: 0, paidCount: 0,
    adjustmentAmount: 0, adjustmentCount: 0, netOutOfSalesFlow: 0
  }
  for (const e of events) {
    const adjustment = e.kind === 'ADJUSTMENT'
    /**
     * نشست ۱۱۵ (S115-5) — رویداد اصلاحی «تفاضل» است و ردیف اصلی را `ADJUSTED`
     * می‌کند؛ پولِ پرداخت اولیه واقعاً رفته است. پس `ADJUSTED` دارای `paidAt`
     * همچنان «پرداخت‌شده» است (وگرنه ۱٬۰۰۰٬۰۰۰ + اصلاح ۲۰۰٬۰۰۰ فقط ۲۰۰٬۰۰۰ دیده
     * می‌شد). `ADJUSTED` بدون `paidAt` (اصلاح روی درخواستِ پرداخت‌نشده) نه در
     * انتظار است نه پرداخت‌شده؛ پول واقعی همان ردیف اصلاحی است.
     */
    const paid = e.status === 'PAID' || (e.status === 'ADJUSTED' && e.paidAt != null)
    const stamp = adjustment || paid ? (e.paidAt ?? e.createdAt) : e.createdAt
    if (period && !inPeriod(stamp, period)) continue
    if (adjustment) {
      out.adjustmentCount++
      out.adjustmentAmount += n(e.paidAmount ?? e.amount)
      continue
    }
    if (paid) {
      out.paidCount++
      out.paidAmount += n(e.paidAmount ?? e.amount)
      continue
    }
    if (e.status === 'PENDING') {
      out.pendingCount++
      out.pendingAmount += Math.max(0, n(e.amount))
    }
  }
  out.netOutOfSalesFlow = out.paidAmount + out.adjustmentAmount
  return out
}

/** یک فاکتور، همراه با کارمند ثبت‌کننده‌اش (برای تب «عملکرد کارمندان»). */
export interface StaffInvoiceEvent extends InvoiceInput {
  id?: number | string
  userId?: number | null
  userName?: string | null
}

/** یک برگشت/تعویض، همراه با کارمند ثبت‌کننده‌اش. */
export interface StaffReturnEvent extends ReturnEvent {
  userId?: number | null
  userName?: string | null
  /** مبلغ اعتبار خریدی که همین عملیات صادر کرده است (از StoreCredit) */
  // نشست ۱۸۱: مبلغ، پس `RialLike` (ردیف Prisma مستقیم پذیرفته می‌شود).
  storeCreditAmount?: RialLike | null
}

/** یک مصرف اعتبار خرید که در دفتر مصرف به کارمند ثبت‌کننده‌ی همان مصرف وصل است. */
export interface StaffCreditUseEvent {
  userId?: number | null
  userName?: string | null
  amount?: RialLike | null
}

export interface StaffPerformanceRow {
  userId: number | null
  userName: string
  /** جمع فروش = جمع `grandTotal` همان فاکتورها (فرمول calculateInvoiceTotals) */
  salesTotal: Rial
  invoiceCount: number
  /** جمع تخفیف داده‌شده (سطر + فاکتور)، عیناً از calculateInvoiceTotals */
  discountTotal: Rial
  /** میانگین درصد تخفیف = جمع تخفیف ÷ جمع قیمت قبل از تخفیف × ۱۰۰ */
  discountPercent: number
  grossGoods: Rial
  returnCount: number
  returnTotal: Rial
  exchangeCount: number
  exchangeTotal: Rial
  storeCreditCount: number
  storeCreditTotal: Rial
  /** تعداد و مبلغ اعتبار خریدی که این کارمند در فروش‌ها مصرف کرده است */
  storeCreditUsedCount: number
  storeCreditUsedTotal: Rial
  /** جمع تعهدهای کارت‌به‌کارتِ ثبت‌شده توسط همین کارمند */
  cardToCardTotal: Rial
}

const staffKeyOf = (userId?: number | null): string => (userId == null ? 'none' : String(userId))

/**
 * «عملکرد کارمندان» (بند ۲) — فقط گروه‌بندی و صدا زدن همان توابع بالا.
 * درصد تخفیف هم فرمول تازه نیست: همان نسبتِ `discounts / grossGoods` که
 * `calculateInvoiceTotals` از قبل می‌سازد.
 */
export function calculateStaffPerformance(
  invoices: StaffInvoiceEvent[] = [],
  returns: StaffReturnEvent[] = [],
  creditUses: StaffCreditUseEvent[] = []
): StaffPerformanceRow[] {
  const rows = new Map<string, StaffPerformanceRow>()
  const rowOf = (userId: number | null | undefined, userName?: string | null): StaffPerformanceRow => {
    const key = staffKeyOf(userId)
    let row = rows.get(key)
    if (!row) {
      row = {
        userId: userId == null ? null : Number(userId),
        userName: userName || (userId == null ? 'نامشخص (بدون کارمند ثبت‌شده)' : `کاربر ${userId}`),
        salesTotal: 0, invoiceCount: 0, discountTotal: 0, discountPercent: 0, grossGoods: 0,
        returnCount: 0, returnTotal: 0, exchangeCount: 0, exchangeTotal: 0,
        storeCreditCount: 0, storeCreditTotal: 0,
        storeCreditUsedCount: 0, storeCreditUsedTotal: 0,
        cardToCardTotal: 0
      }
      rows.set(key, row)
    }
    if (userName && !row.userName.startsWith(userName)) row.userName = userName
    return row
  }

  for (const inv of invoices) {
    const row = rowOf(inv.userId, inv.userName)
    const t = calculateInvoiceTotals(inv)
    row.invoiceCount++
    row.salesTotal += t.grandTotal
    row.discountTotal += t.discounts
    row.grossGoods += t.grossGoods
  }

  for (const r of returns) {
    const row = rowOf(r.userId, r.userName)
    // همان تفکیک kind که calculateReturnTotals می‌کند، ولی برای یک کارمند
    const one = calculateReturnTotals([r])
    if (r.kind === 'EXCHANGE') {
      row.exchangeCount += one.count
      /** نشست ۱۸۹ · ۱-۷ — «مبلغ تعویض» ارزش کالای *جایگزین* است، نه کالای برگشتی. */
      row.exchangeTotal += one.exchangeReplacement
    } else {
      row.returnCount += one.count
      row.returnTotal += one.simpleReturns
    }
    const credit = n(r.storeCreditAmount ?? 0) || one.storeCreditIssued + one.exchangeStoreCreditIssued
    if (credit > 0) {
      row.storeCreditCount++
      row.storeCreditTotal += credit
    }
    row.cardToCardTotal += one.cardToCardPending + one.exchangeCardToCardPending
  }

  for (const use of creditUses) {
    const row = rowOf(use.userId, use.userName)
    const amount = Math.max(0, n(use.amount ?? 0))
    row.storeCreditUsedCount++
    row.storeCreditUsedTotal += amount
  }

  for (const row of rows.values())
    row.discountPercent = row.grossGoods > 0 ? Math.round((row.discountTotal / row.grossGoods) * 1000) / 10 : 0

  return [...rows.values()].sort((a, b) => b.salesTotal - a.salesTotal)
}

/** درصد تخفیف یک فاکتور، با همان اجزای `calculateInvoiceTotals` (بند ۳). */
export function invoiceDiscountPercent(input: InvoiceInput = {}): number {
  const t = calculateInvoiceTotals(input)
  if (t.grossGoods <= 0) return 0
  return Math.round((t.discounts / t.grossGoods) * 1000) / 10
}

/** یک ردیف مغایرت موجودی (بند ۴) — کمّی است، نه مالی. */
export interface StockDiscrepancyInput {
  variantId: number
  name?: string
  code?: string | null
  /** موجودی سیستمی *همین حالا* */
  systemQty?: number
  /** آخرین عدد شمارش فیزیکی ثبت‌شده */
  countedQty?: number | null
  /** موجودی سیستمی در لحظه‌ی همان شمارش (snapshot) */
  systemQtyAtCount?: number | null
  /** افزایش موجودی ناشی از برگشت/تعویض‌های ثبت‌شده در بازه */
  returnedQty?: number
  /**
   * جلسه ۴۰ · کار ب — «معلق برگشتی» در لحظه‌ی همان شمارش (snapshot).
   * کالای برگشتی‌ای که بازپرداختش «کارت‌به‌کارت مدیر» است و مدیر هنوز پرداخت
   * نکرده: فیزیکی روی قفسه هست ولی در موجودی سیستمی نیست. پیش‌فرض صفر، پس
   * همه‌ی شمارش‌های قبلی مو‌به‌مو همان عددِ قبلی را می‌دهند.
   */
  pendingRestockQty?: number | null
  countedAtJalali?: string | null
}

export interface StockDiscrepancyRow extends StockDiscrepancyInput {
  /** شمارش − موجودی سیستمیِ همان لحظه (منفی = کالای کمتر روی قفسه) */
  diffAtCount: number
  /** شمارش − موجودی سیستمی امروز */
  diffNow: number
  /** شمارشی ثبت شده است؟ (بدون آن، مغایرت معنی ندارد) */
  hasCount: boolean
  needsReview: boolean
  /**
   * ---------------------- جلسه ۴۰ · کار ب ----------------------
   * هدف انبارگردانی: موجودی فیزیکیِ *مورد انتظار* = قابل‌فروش + معلق برگشتی.
   * پس کنار عددِ خام، همان عدد با احتساب معلق هم می‌آید و **قضاوت نهایی
   * (`needsReview`) روی همین یکی است** — وگرنه شلواری که با پرداخت‌نشدن مدیر
   * روی قفسه مانده، یک «اضافه»ی کاذب می‌ساخت و کاربر دنبال یک مغایرت ناموجود
   * می‌گشت.
   */
  pendingRestockQty: number
  /** موجودی سیستمیِ لحظه‌ی شمارش + معلق برگشتیِ همان لحظه */
  expectedPhysicalQty: number
  /** شمارش − موجودی فیزیکیِ مورد انتظار (مغایرت واقعی) */
  diffAtCountWithPending: number
  hasPending: boolean
}

/**
 * «مغایرت نیازمند بررسی» (بند ۴-ب).
 * فقط دو عدد را کنار هم می‌گذارد و تفاضل را برمی‌گرداند؛ هیچ قضاوتی نمی‌کند و
 * هیچ‌کس را متهم نمی‌کند.
 */
export function calculateStockDiscrepancies(rows: StockDiscrepancyInput[] = []): StockDiscrepancyRow[] {
  return rows.map((r) => {
    const hasCount = r.countedQty != null
    const counted = n(r.countedQty)
    const atCount = n(r.systemQtyAtCount ?? r.systemQty)
    const pending = Math.max(0, n(r.pendingRestockQty))
    const expectedPhysicalQty = atCount + pending
    const diffAtCount = hasCount ? counted - atCount : 0
    const diffNow = hasCount ? counted - n(r.systemQty) : 0
    /**
     * جلسه ۴۰ · کار ب — مغایرت *واقعی*: شمارش منهای موجودی فیزیکیِ مورد انتظار.
     * برای ردیف‌های بی‌معلق (یعنی همه‌ی داده‌ی قدیمی، `pending = 0`) این عدد
     * عیناً همان `diffAtCount` قبلی است ⇒ صفر تغییر در گزارش‌های گذشته.
     */
    const diffAtCountWithPending = hasCount ? counted - expectedPhysicalQty : 0
    return {
      ...r,
      systemQty: n(r.systemQty),
      returnedQty: n(r.returnedQty),
      pendingRestockQty: pending,
      expectedPhysicalQty,
      diffAtCount,
      diffAtCountWithPending,
      diffNow,
      hasCount,
      hasPending: pending > 0,
      needsReview: hasCount && diffAtCountWithPending !== 0
    }
  })
}
