export interface Money { amount: number } // ریال، عدد صحیح

export interface CartLine {
  variantId: number
  code: string
  barcode: string
  name: string
  qty: number
  unitPrice: number
  /**
   * تخفیف *این ردیف* به ریال — همان عددی که در سند ذخیره و در گزارش «جمع
   * تخفیف» شمرده می‌شود. حالت درصدی (پایین) هم در همین فیلد به مبلغ تبدیل
   * می‌شود، پس سمت main هیچ محاسبه‌ای عوض نشده است.
   */
  discount: number
  tax: number
  /**
   * دسته‌بندی کالای همین ردیف — برای محاسبه‌ی «عوارض و مالیات / حق سرویس بر
   * اساس دسته‌بندی» (src/shared/charges.ts). سمت main ذخیره نمی‌شود؛ فقط برای
   * محاسبه‌ی لحظه‌ای در همان صفحه لازم است.
   */
  categoryId?: number | null
  /**
   * موجودی فعلی همین کالا در انبار فروشگاه، در لحظه‌ی افزودن به سبد.
   * فقط برای هشدار زودهنگام در UI (کمبود موجودی / برداشت از انبار مرکزی).
   */
  stock?: number
  /**
   * حالت تخفیف ردیف (مورد ۵): 'AMOUNT' = مبلغ ریالی · 'PERCENT' = درصد.
   * فقط UI است؛ مقدار نهایی همیشه در `discount` (ریال) می‌نشیند.
   */
  discountMode?: 'AMOUNT' | 'PERCENT'
  /** عددی که کاربر در فیلد تخفیف ردیف تایپ کرده (ریال یا درصد، طبق حالت بالا) */
  discountValue?: number
}

import type { StockAllocationPlan } from './stockSource'

export interface CreateSaleInput {
  customerId?: number | null
  /**
   * شماره تلفن مشتری از پنل فروش (مورد ۶). اختیاری.
   * اگر مشتری‌ای با این شماره باشد همان انتخاب می‌شود، وگرنه با ثبت فاکتور
   * ساخته می‌شود. خالی = «مشتری عمومی» (همان رفتار فعلی).
   */
  customerPhone?: string | null
  /** نام مشتری (اختیاری، فقط برای وقتی مشتری تازه ساخته می‌شود) */
  customerName?: string | null
  /**
   * «مشتری راه دور» (مورد ۷): مهلت برگشت این فاکتور از تنظیم مستقل
   * `sale.returnCodeDaysRemote` حساب می‌شود، نه مهلت عادی.
   */
  remoteCustomer?: boolean
  userId?: number | null
  shiftId?: number | null
  /**
   * Only an IPC request hint. Main removes these fields, validates the selected
   * mode, then attaches non-forgeable custody evidence internally. They never
   * change the financial `userId` or `shiftId` above.
   */
  saleOperatorMode?: 'CUSTODIAN' | 'OPERATOR_PIN' | 'MANAGER_SESSION'
  saleOperatorUserId?: number | null
  saleOperatorPassword?: string | null
  orderType?: 'INTERNAL' | 'DELIVERY' | 'PHONE' | 'WHOLESALE'
  lines: CartLine[]
  invoiceDiscount?: number
  serviceCharge?: number
  /** مالیات و عوارض در سطح فاکتور (جدا از مالیات ردیف‌ها) */
  invoiceTax?: number
  deliveryFee?: number
  /**
   * ---- کار الف: مقصد پولِ پرداختیِ لحظه‌ی فروش ----
   * `destination` اختیاری است و اگر نیاید، سرور آن را از `kind` روش پرداخت
   * *مشتق* می‌کند (نقدی ⇒ CASH، کارت ⇒ CARD، و برای روش‌های CUSTOM/چک `null`
   * می‌ماند تا هیچ حدسی زده نشود). اگر بیاید، سمت سرور با همان
   * `assertDestination` اعتبارسنجی می‌شود؛ پس «روش نقدی با مقصد کارت» ساخته
   * نمی‌شود. تنها حالتی که پنل فروش صریح می‌فرستد، «به حساب مدیر» است.
   */
  payments: { methodId: number; amount: number; reference?: string; destination?: string | null }[]
  /** UI صریحِ نقد + کارت؛ فقط در این حالت گارد افزایشی split فعال می‌شود. */
  splitPayment?: boolean
  /** فقط همراه splitPayment: کمبود مبلغ آگاهانه به نسیه تبدیل شود. */
  allowPartial?: boolean
  note?: string
  /** تاریخ شمسی دلخواه (yyyy/MM/dd). خالی = امروز. */
  issuedAtJalali?: string
  /**
   * فروش عمده: false یعنی این فاکتور موجودی انبار را کم نکند.
   * پیش‌فرض true تا رفتار POS و کدهای قبلی تغییر نکند.
   */
  deductInventory?: boolean
  /** درصد تخفیف عمده که روی خود فاکتور ذخیره می‌شود (۰..۱۰۰) */
  wholesaleDiscountPercent?: number | null
  /** شماره میز / توضیح نوع سفارش برای چاپ روی رسید (اختیاری) */
  tableNo?: string | null
  /**
   * «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی فروشگاه» (مورد ۳).
   *
   * فقط وقتی `true` باشد (چک‌باکس پنل فروش روشن) کمبود هر قلم از انبار مرکزی
   * برداشته و به انبار فروشگاه منتقل می‌شود. پیش‌فرض/undefined = رفتار قبلی
   * دست‌نخورده (موجودی منفی + هشدار زرد).
   */
  autoCentralWithdraw?: boolean
  /**
   * ================== جلسه ۴۷ — «برنامه‌ی کسر موجودی» ==================
   * خروجی پنجره‌ی «از کدام انبار کسر شود؟» — **فقط فاکتور فروش عمده**.
   *
   * برای هر قلم، فهرست صریحِ `{ منبع، warehouseId، تعداد، منفی‌شده؟ }`.
   * `SalesService.create/update` همین را می‌گیرد و **داخل همان تراکنش دوباره
   * اعتبارسنجی می‌کند**؛ اگر موجودی بین پنجره و ثبت عوض شده باشد، خطای
   * `STOCK_PLAN_STALE` می‌دهد تا پنجره دوباره اجرا شود.
   *
   * ⚠️ نفرستادنش = رفتار مو‌به‌موی قبل (همه از انبار فروشگاه، و اگر تیک
   * «برداشت خودکار از انبار مرکزی» روشن باشد همان مسیر خودکار).
   * ⚠️ همراهِ `autoCentralWithdraw: true` رد می‌شود: دو مسیر هیچ‌وقت با هم
   * اجرا نمی‌شوند، وگرنه یک کمبود دو بار پوشش داده می‌شد.
   */
  stockPlan?: StockAllocationPlan | null
  /**
   * ================== جلسه ۵۲ · مرحله ۳ — قفل سمت سرور برای «فروش تکی» ==================
   * رمز مدیر (یا «رمز دوم اختصاصی» همان گزینه) برای فرستادن `stockPlan` از
   * **پنل فروش تکی**.
   *
   * چرا لازم شد: تا جلسه ۵۱ سرور `stockPlan` را برای هر نوعی جز `WHOLESALE`
   * بی‌قید رد می‌کرد. حالا که فروش تکی هم می‌تواند مبدأ کسر بفرستد، تنها قفل
   * ماندنِ `ManagerGate` رندرر کافی نیست: هر تماس IPC می‌توانست دورش بزند و
   * فروشنده بی اجازه از انبار مرکزی/شعبه کم کند. پس سرویس خودش
   * `assertPanelPassword(PANEL_KEYS.posCentralWithdrawToggle, …)` را صدا می‌زند —
   * مو‌به‌مو همان الگویی که جلسه ۴۰ برای `cardTransfer:pay` گذاشت.
   *
   * ⚠️ اگر مدیر قفل همین کلید را در «تنظیمات → قفل ماژول‌ها» خاموش کرده باشد،
   * `assertPanelPassword` بی رمز `OPEN` می‌دهد (همان سیاست موجود پروژه).
   * ⚠️ برای `WHOLESALE` بی‌اثر است: آن صفحه از قبل با
   *    `PANEL_KEYS.wholesaleInvoiceModule` قفل است و رفتارش دست‌نخورده می‌ماند.
   */
  panelPassword?: string | null
  /**
   * «بارکد اعتبار خرید بعدی» که فروشنده روی همین فاکتور اسکن/وارد کرده (بخش ۶).
   *
   * سمت main اعتبارسنجی می‌شود (وجود داشتن، مصرف‌نشده بودن، منقضی نبودن) و
   * مبلغش به‌عنوان یک پرداختیِ *غیرنقدی* (روش پرداخت STORE_CREDIT) روی فاکتور
   * می‌نشیند، پس از «قابل پرداخت» کم می‌شود ولی در «خالص واقعی دریافتی» گزارش
   * شمرده نمی‌شود. همان لحظه «مصرف‌شده» علامت می‌خورد (یک‌بار‌مصرف).
   */
  storeCreditCode?: string | null
  /**
   * جلسه ۲۱ · §۱۷ — **پرداخت ترکیبی**: چه مقدار از این اعتبار روی همین فاکتور
   * خرج شود (خالی = حداکثر ممکن، یعنی رفتار مو‌به‌موی قبل). بقیه‌ی فاکتور با
   * نقد/کارت تسویه می‌شود و باقی‌ماندهٔ اعتبار (طبق نوعش) یا روی همان رکورد
   * می‌ماند (چندباره) یا به یک اعتبار جدید می‌رود (یک‌بارمصرف).
   *
   * ⚠️ این عدد **پیشنهاد** است، نه دستور: سرویس main با `decideRedeem` سقف
   * واقعی را می‌سنجد و بیشتر از آن را قبول نمی‌کند (§۲۱).
   */
  storeCreditAmount?: number | null
  /**
   * جلسه ۲۱ · §۲۱ — کلید Idempotency همین درخواست. اگر ثبت فاکتور به‌خاطر
   * Timeout یا دوبار-کلیک دوبار برسد، مصرف اعتبار **دوبار کم نمی‌شود**.
   */
  storeCreditIdempotencyKey?: string | null
  /**
   * جلسه ۱۵ (بند ۱۷) — گیت مدیر برای ثبت/ویرایش در دوره‌ی بسته‌شده.
   * نشست ۶۲: همین رمز، صدور اعتبار اضافه‌دریافت بالاتر از سقف تنظیمات را هم باز می‌کند.
   */
  managerPassword?: string | null
  overrideReason?: string | null
  /**
   * نشست ۶۲ · بند ۴-۳۵ — «مبلغ دریافتی» بیشتر از جمع کل فاکتور. بدون این پرچم
   * سرور هشدار قابل‌تأیید («بله ثبت کن») برمی‌گرداند و هیچ چیز ثبت نمی‌شود.
   */
  confirmOverpay?: boolean
  /** نشست ۶۲ — مرحله ۲/۳: از مبلغ اضافه در همان تراکنش کد اعتبار OVERPAY صادر شود */
  overpayAsCredit?: boolean
}

/**
 * ویرایش یک فاکتور فروش ثبت‌شده.
 * `lines` و `payments` «حالت نهایی» فاکتور هستند، نه اختلاف؛ سرور خودش delta
 * موجودی را حساب می‌کند (بدون حذف و ساخت دوباره‌ی رکورد و بدون به‌هم‌ریختن
 * ردپای StockMovement).
 */
export interface UpdateSaleInput extends CreateSaleInput {
  id: number
  /**
   * تاریخچه‌ی پرداختی‌ها دست‌نخورده بماند؟ (فروش نسیه / اقساطی)
   *
   * true (چیزی که پنل فاکتور فروش عمده می‌فرستد) = ویرایش فقط اقلام و مبالغ
   * فاکتور را عوض می‌کند و پرداختی‌های ثبت‌شده — با تاریخ و ساعت خودشان — سر
   * جایشان می‌مانند؛ در پایان فقط «جمع پرداختی» و علامت «تسویه‌شده» بازمحاسبه
   * می‌شود. مدیریت پرداختی‌ها از پنجره‌ی «پرداختی‌ها / اقساط» انجام می‌گردد.
   *
   * نفرستادن `payments` هم همین معنا را دارد.
   */
  keepPayments?: boolean
}

/** یک ردیف فاکتور خرید در سمت renderer */
export interface PurchaseLine {
  variantId: number
  code: string
  barcode: string
  name: string
  qty: number
  unitPrice: number
  warehouseId?: number | null
}

export interface CreatePurchaseInput {
  /**
   * تایید آگاهانه‌ی کاربر برای رد کردن قواعد «نرم» (مثلاً قیمت منفی).
   * اصل طراحی: قاعده‌ی کسب‌وکار فقط هشدار می‌دهد؛ اگر کاربر تایید کرد، انجام می‌شود.
   */
  force?: boolean
  supplierId?: number | null
  settlementType?: 'CASH' | 'CHEQUE' | 'ACCOUNT'
  discountTotal?: number
  paidTotal?: number
  note?: string
  userId?: number | null
  /** تاریخ شمسی دلخواه (yyyy/MM/dd). خالی = امروز. */
  issuedAtJalali?: string
  lines: { variantId: number; warehouseId?: number | null; qty: number; unitPrice: number }[]
}

// ---------------------------------------------------------------------------
// فروش نسیه (اقساطی): پرداختی چندمرحله‌ای و چک
// ---------------------------------------------------------------------------

/** یک ردیف از تاریخچه‌ی پرداختی‌های یک فاکتور (نقدی یا چک). */
export interface InvoicePaymentRow {
  id: number
  /** شماره‌ی ترتیبی: ۱ = پرداختی اول، ۲ = پرداختی دوم، ... */
  seq: number
  /** CASH = پرداخت دریافت‌شده · CHEQUE = چک */
  kind: 'CASH' | 'CHEQUE'
  amount: number
  methodId: number
  methodLabel: string
  reference: string | null
  note: string | null
  /** تاریخ شمسی ثبت پرداختی */
  dateJalali: string
  /** ساعت ثبت پرداختی */
  time: string
  /** زمان واقعی ثبت در سیستم (ISO)، مستقل از تاریخ کسب‌وکاری پرداخت */
  createdAt: string | null
  /** کارمند واقعی ثبت‌کننده‌ی پرداخت */
  createdByUserId: number | null
  /** نشست بازِ لحظه‌ی ثبت پرداخت */
  createdShiftId: number | null
  /** نشست بازِ لحظه‌ی پاس‌شدن چک */
  clearedShiftId: number | null
  // ---- فقط برای چک ----
  chequeNo: string | null
  bankName: string | null
  /** سررسید چک (شمسی) */
  dueDateJalali: string | null
  /** PENDING | CLEARED | BOUNCED */
  chequeStatus: string | null
  chequeStatusLabel: string | null
  /** تاریخ شمسی «پاس شد» */
  clearedAtJalali: string | null
  /** روزهای مانده تا سررسید (منفی = گذشته). null = چک نیست یا سررسید ندارد. */
  dueInDays: number | null
  /** مبلغ این ردیف در «جمع پرداختی‌های دریافت‌شده» شمرده می‌شود؟ */
  counted: boolean
  /**
   * بخش ۸ — «مبلغ اضافه‌ی دریافتی»: چقدر از این پرداختی، بیشتر از باقی‌مانده‌ی
   * بدهی فاکتور در *همان لحظه* بوده است. ۰ = پرداختی عادی.
   */
  overpayAmount: number
  /** این ردیف، مصرف یک «بارکد اعتبار خرید بعدی» است؟ (پول نقد نیست) */
  isStoreCredit: boolean
  /**
   * ---------------- کار الف (جلسه ۳۶): «مقصد پول» ----------------
   * CARD | CASH | MANAGER · و `null` برای داده‌ی قدیمی («نامشخص»).
   */
  destination: string | null
  destinationLabel: string
  /** مقصد به فروشگاه رسیده است؟ (MANAGER و «نامشخص» ⇒ false) */
  reachedStore: boolean
  /** تاریخچه‌ی append-only وضعیت چک، از دفتر PaymentChequeStatusHistory */
  chequeHistoryText?: string | null
  /**
   * نشست ۱۶۴ · Y22 · بند ۴-۵۲ — چک در جریانی که فاکتورش بعد از ثبت چک برگشت خورده (بدهی صفر
   * نشده). چک دست‌نخورده می‌ماند ولی مدیر باید بازبینی‌اش کند.
   */
  chequeNeedsReview?: boolean
  chequeReviewNote?: string | null
}

/**
 * زنجیره‌ی فقط‌خواندنیِ «تسویه با اعتبار» که از گزارش فروش باز می‌شود.
 *
 * این قرارداد عمداً از InvoicePaymentsView جداست: فقط شناسه/مرجع امن اعتبار،
 * رویداد صدور، رویداد مصرف و مانده‌ی مالی را دارد. کد قابل‌مصرف، legacyCode،
 * اطلاعات دارنده (تلفن/نشانی/شناسه ملی/یادداشت) و reference آزادانه هرگز اینجا
 * نیستند. نمایش کد تنها مسیر مستقل و manager-authorized خودش را دارد.
 */
export interface CreditSettlementLineageRow {
  redemptionId: number | null
  paymentId: number | null
  paymentSeq: number | null
  amount: number
  redeemedAtJalali: string
  redeemedAtTime: string
  credit: {
    id: number
    publicReference: string
    issuedAtJalali: string
    expiresAtJalali: string | null
    sourceLabel: string
    status: string
    statusLabel: string
    remaining: number
  }
}

export interface CreditSettlementLineageView {
  invoiceId: number
  receiptNo: number
  totalAmount: number
  rows: CreditSettlementLineageRow[]
}

/** نمای کامل پرداختی‌های یک فاکتور (مودال «پرداختی‌ها / اقساط»). */
export interface InvoicePaymentsView {
  invoiceId: number
  receiptNo: number
  dateJalali: string
  time: string
  customerName: string
  orderTypeLabel: string
  grandTotal: number
  /** جمع پرداختی‌های دریافت‌شده (نقدی + چک پاس‌شده) */
  paidTotal: number
  /** باقی‌مانده = جمع کل − پرداختی‌های دریافت‌شده (هیچ‌وقت منفی نمایش داده نمی‌شود) */
  remaining: number
  /** جمع چک‌های در جریان (پاس‌نشده) — پول دریافت‌شده نیست */
  pendingChequeTotal: number
  /** نشست ۱۶۴ · Y22 — شمار چک‌های در جریانِ نیازمند بازبینی (بند ۴-۵۲) */
  chequeReviewCount?: number
  /** UNPAID | PARTIAL | SETTLED */
  settlementState: string
  settlementLabel: string
  settled: boolean
  settledAtJalali: string | null
  /** فاکتور در «تجمیع و انتقال» قطعی شده است؟ (فقط برای نمایش هشدار) */
  consolidated: boolean
  /** جمع «مبلغ اضافه‌ی دریافتی» همه‌ی پرداختی‌های این فاکتور (بخش ۸) */
  overpayTotal: number
  /**
   * نشست ۶۲ — اضافه‌دریافتِ *آزاد* برای صدور اعتبار (پول واقعی − اعتبارهای
   * OVERPAY قبلی). صفر ⇒ دکمه‌ی «صدور اعتبار از اضافه‌دریافت» پنهان است.
   */
  overpayCreditAvailable: number
  /** نشست ۶۲ — جمع اعتبارهای OVERPAY قبلاً صادرشده از این فاکتور */
  overpayCreditIssued: number
  /** جمع مبلغ «بارکد اعتبار» مصرف‌شده روی این فاکتور (پول نقد نیست) */
  storeCreditTotal: number
  payments: InvoicePaymentRow[]
}

/** ثبت یک پرداختی جدید روی فاکتور (پرداختی دوم، سوم، ...). */
export interface AddInvoicePaymentInput {
  invoiceId: number
  /** CASH (پیش‌فرض) یا CHEQUE */
  kind?: 'CASH' | 'CHEQUE'
  amount: number
  /** روش پرداخت؛ برای چک لازم نیست (روش «چک» خودکار انتخاب می‌شود) */
  methodId?: number | null
  reference?: string | null
  note?: string | null
  /** تاریخ شمسی پرداختی (خالی = همین حالا) */
  paidAtJalali?: string | null
  /**
   * ساعت پرداختی به قالب HH:mm یا HH:mm:ss (خالی = ساعت همین لحظه).
   * پیش‌فرض فرم «همین حالا» است، ولی مدیر می‌تواند دستی عوضش کند (بخش ۷).
   */
  paidAtTime?: string | null
  /**
   * بخش ۸ — تایید آگاهانه‌ی «مبلغ بیشتر از باقی‌مانده‌ی بدهی».
   * بدون این پرچم، سرور یک هشدار فارسی (قابل‌تایید، نه مسدودکننده) برمی‌گرداند؛
   * با `true` همان مبلغ کاملِ واردشده — بی‌قید‌و‌شرط — ثبت می‌شود.
   */
  confirmOverpay?: boolean
  /**
   * نشست ۶۱ · بند ۴-۳۵ مرحله ۲/۳ — «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟».
   * `true` ⇒ در همان تراکنش یک اعتبار OVERPAY به اندازه‌ی مبلغ اضافه صادر می‌شود.
   * خالی/false ⇒ مرحله ۴: فقط ردیف «دریافت پول اضافه» در گزارش.
   */
  overpayAsCredit?: boolean
  /** رمز مدیر، فقط اگر مبلغ اعتبار از سقف «صدور اعتبار» تنظیمات بیشتر باشد */
  managerPassword?: string | null
  // ---- چک ----
  chequeNo?: string | null
  bankName?: string | null
  /** سررسید چک به شمسی (yyyy/MM/dd) — برای چک الزامی است */
  dueDateJalali?: string | null
  /**
   * ---------------- کار الف (جلسه ۳۶): «مقصد پول» ----------------
   * CARD | CASH | MANAGER. برای هر پرداختیِ *دریافت‌شده* (kind = CASH)
   * **اجباری** است و پیش‌فرض ندارد. برای ثبت خودِ چک لازم نیست (چکِ در جریان
   * هنوز پولی نیست)؛ مقصدش لحظه‌ی «پاس شد» پرسیده می‌شود.
   */
  destination?: string | null
  userId?: number | null
  /**
   * کلید یکتای یک تلاش ثبت پرداخت. UI آن را تا پاسخ قطعی نگه می‌دارد تا retry یا
   * دوبارکلیک همان Payment قبلی را برگرداند، نه یک دریافت مالی تازه بسازد.
   */
  idempotencyKey?: string | null
}

/** ویرایش یک پرداختی/چک ثبت‌شده. */
export interface UpdateInvoicePaymentInput extends Partial<AddInvoicePaymentInput> {
  id: number
}

/** یک ردیف در فهرست سراسری چک‌ها (تب «چک‌ها»). */
export interface ChequeListRow extends InvoicePaymentRow {
  invoiceId: number
  receiptNo: number
  invoiceDateJalali: string
  customerName: string
  invoiceTotal: number
  invoiceRemaining: number
}

// ---------------------------------------------------------------------------
// رمز دوم اختصاصی پنل‌های قفل‌دار
// ---------------------------------------------------------------------------

/** وضعیت رمز دوم یک پنل (بدون هیچ اطلاعاتی از خود رمز). */
export interface PanelAuthState {
  key: string
  title: string
  /** رمز دوم برای این پنل تعریف و فعال است؟ */
  enabled: boolean
  /** آخرین تغییر رمز دوم (ISO) */
  changedAtIso: string | null
  /**
   * بند ۱ — قفل رمز این ماژول روشن است؟ (پیش‌فرض و در هر حالت مبهم: بله)
   * خاموش بودنش یعنی پنل بدون هیچ رمزی باز می‌شود.
   */
  lockEnabled: boolean
  /** قفل این پنل *قابل خاموش کردن نیست* (مثل خودِ پنل تنظیمات) */
  alwaysLocked: boolean
  /**
   * مورد ۴ (نشست دهم) — رمز دوم ذخیره‌شده *قابل نمایش دوباره* است؟
   *
   * برای رمزهایی که قبل از این نسخه ثبت شده‌اند false است (فقط هش دارند و هیچ
   * راهی برای بازیابی مقدارشان نیست)؛ با یک بار ثبت دوباره، true می‌شود.
   */
  recoverable: boolean
  /**
   * مورد ۷ (نشست دهم) — «رمز سوم» هر شیفت برای همین پنل.
   * فهرست، *همیشه* همه‌ی شیفت‌های تعریف‌شده در تنظیمات شیفت را دارد (حتی آن‌هایی
   * که رمزی برایشان تعریف نشده) تا جدول تنظیمات چیزی جا نیندازد.
   */
  shifts: PanelShiftAuthState[]
}

/**
 * ---------------------------------------------------------------------------
 * مورد ۷ — وضعیت «رمز سوم» یک ترکیب «پنل × شیفت».
 *
 * پیش‌فرض هر ترکیب، «تعریف‌نشده» است (`enabled: false`) — دقیقاً مثل رمز دوم.
 * ---------------------------------------------------------------------------
 */
export interface PanelShiftAuthState {
  /** شماره‌ی شیفت طبق تنظیمات شیفت (۱-based) */
  number: number
  /** نام شیفت در تنظیمات («شیفت صبح»، «شیفت شب»، …) */
  name: string
  /** بازه‌ی ساعتی همان شیفت («۰۸:۰۰ تا ۱۴:۰۰») — فقط نمایشی */
  windowLabel: string
  /** رمز سوم برای همین شیفت تعریف و فعال است؟ */
  enabled: boolean
  changedAtIso: string | null
  /** مقدار این رمز قابل نمایش دوباره است؟ (مورد ۴) */
  recoverable: boolean
  /** همین شیفت، شیفت جاریِ برنامه است؟ (فقط برای برچسب در تنظیمات) */
  isCurrent: boolean
}

/** خروجی «نمایش رمز ذخیره‌شده» (مورد ۴). */
export interface PanelPasswordReveal {
  panel: string
  panelTitle: string
  /** null = رمز سوم نیست، خودِ رمز دوم پنل است */
  shiftNumber: number | null
  shiftName: string | null
  /** مقدار رمز — فقط همین لحظه و فقط در پاسخ همین درخواست */
  password: string
  changedAtIso: string | null
}

/**
 * بند ۱ — وضعیت کامل «قفل ماژول‌ها» برای صفحه‌ی تنظیمات و برای `ManagerGate`.
 * `locks` همان نقشه‌ی `PanelLockConfig` است (کلید پنل → قفل روشن/خاموش).
 */
export interface PanelLockState {
  locks: Record<string, boolean>
  /** چند ماژول قفلشان خاموش است */
  openCount: number
  /** کلید پنل‌هایی که قفلشان قابل برداشتن نیست */
  alwaysLocked: string[]
}

/** نتیجه‌ی باز کردن یک پنل قفل‌دار. */
export interface PanelUnlockResult {
  ok: true
  /**
   * MANAGER = رمز مدیر بود (نشست مدیر کامل)
   * PANEL   = رمز دوم همان پنل (فقط همان یک پنل)
   * OPEN    = بند ۱: قفل این ماژول در تنظیمات خاموش است، پس بدون رمز باز شد
   *           (نشست مدیر هم نمی‌سازد)
   */
  scope: 'MANAGER' | 'PANEL' | 'OPEN'
  panel: string
  /** رمز مدیر هنوز همان رمز پیش‌فرض است؟ (فقط برای نمایش راهنما) */
  isDefault: boolean
}

/** ویرایش یک فاکتور خرید ثبت‌شده (اقلام = حالت نهایی، نه اختلاف). */
export interface UpdatePurchaseInput extends CreatePurchaseInput {
  id: number
}

/**
 * حالت متن روی لیبل چاپی:
 *   NAME       = فقط اسم کالا (پیش‌فرض)
 *   NAME_COLOR = اسم + سایز + رنگ
 *   NONE       = بدون اسم (فقط قیمت و بارکد) — مورد ۵
 */
export type LabelMode = 'NAME' | 'NAME_COLOR' | 'NONE'

/** یک لیبل آماده‌ی چاپ (پس از باز کردن «تعداد نسخه»). */
export interface PrintLabel {
  name: string
  code: string
  price: number
  barcodeDataUrl: string
}

export interface ReturnSaleInput {
  invoiceId: number
  full: boolean
  lines?: { saleItemId: number; qty: number }[]
  note?: string
  userId?: number | null
  /** تایید آگاهانه‌ی کاربر برای برگشت بیشتر از تعداد فروش. */
  force?: boolean
  /**
   * تایید آگاهانه برای برگشت قلمی که کالایش از فهرست کالاهای انبار حذف شده
   * است. بدون این پرچم، آن قلم برگشت نمی‌خورد و پیام هشدار داده می‌شود.
   */
  allowRemoved?: boolean
  /**
   * ------------------------ جلسه ۱۴ (بند ۱۱ سند مرجع) ------------------------
   * روش بازپرداخت این برگشت. **اجباری برای هر برگشت جدید**: تا وقتی سیستم نداند
   * پول از کشو بیرون رفت یا فقط طلب مشتری کم شد، «کسری واقعی» از «کسری کاذب»
   * قابل تفکیک نیست. تهی فرستادن ⇒ خطای فارسی، نه یک فرض ضمنی.
   */
  refundMethod?: 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | 'NONE' | null
  /** مبلغ بازپرداخت‌شده؛ خالی = کل مبلغ برگشت (برای CASH/CARD/STORE_CREDIT) */
  refundAmount?: number | null
  /**
   * بند ۴-۱۱ — مدیر می‌تواند با رمز و دلیل، مبلغ کاملِ بدون کسر تخفیف را
   * برگرداند. این پرچم فقط برای برگشت ساده است و هرگز سقف اعتبار خرید را دور
   * نمی‌زند.
   */
  managerFullRefund?: boolean
  /** شماره پیگیری/مرجع بازپرداخت کارتی */
  refundReference?: string | null
  refundNote?: string | null
  /** مهلت بارکد اعتبارِ صادرشده وقتی refundMethod = STORE_CREDIT */
  creditDays?: number | null
  /**
   * ------------------------ جلسه ۱۵ (بند ۱۷ سند مرجع) ------------------------
   * فقط وقتی لازم می‌شوند که تاریخ این سند در دوره‌ی بسته‌شده باشد (صندوق بسته
   * یا روزِ تجمیع‌شده). بدون این دو، ثبت در دوره‌ی بسته رد می‌شود.
   */
  managerPassword?: string | null
  overrideReason?: string | null
  /**
   * نشست ۱۸۹ · بند ۴-۳۵/۴-۵۵ — برگشت بدون بازپرداخت می‌تواند روی فاکتورِ
   * پرداخت‌شده اضافه‌دریافت بسازد. بدون این پرچم سرور هشدار قابل‌تأیید می‌دهد
   * (همان «بله ثبت کن» فروش/وصول).
   */
  confirmOverpay?: boolean
  /** صدور کد اعتبار OVERPAY از همان اضافه‌دریافتِ ساخته‌شده با این برگشت */
  overpayAsCredit?: boolean
  /** نشست ۳۱۹ — تأیید و رمز مدیر برای بازپرداخت با کارت‌خوان (کارت) */
  cardPosOverride?: CardPosOverrideInput | null
}

export interface CardPosOverrideInput {
  managerPassword: string
  reason: string
  acknowledgedNoReverse: true
}

// ---------------------------------------------------------------------------
// برگشت از فروش با «کد فاکتور»
// ---------------------------------------------------------------------------

/** وضعیت کالای یک قلم فاکتور از نگاه انبار، در لحظه‌ی برگشت. */
export type ReturnItemStock = 'OK' | 'REMOVED' | 'MISSING'

export interface ReturnLookupItem {
  saleItemId: number
  variantId: number
  code: string
  barcode: string
  name: string
  unit: string
  qty: number
  /** تعداد برگشت‌خورده‌ی قبلی همین قلم */
  returnedQty: number
  /** تعداد قابل برگشت (qty − returnedQty) */
  remainingQty: number
  unitPrice: number
  discount: number
  lineTotal: number
  /**
   * نشست ۲ زنجیره رفع · C1 — سهم واقعی این قلم (همه‌ی تعدادها) از پرداختیِ
   * مشتری: lineTotal منهای سهم تخفیف کل فاکتور به‌علاوه‌ی سهم مالیات/حق سرویس.
   * پیش‌نمایش برگشت با `returnValueOf` از `@shared/returnValue` روی همین عدد.
   */
  netLineValue: number
  /** موجودی فعلی کالا در انبار (برای نمایش) */
  stock: number
  /**
   * OK      = کالا در فهرست کالاهای انبار موجود و فعال است
   * REMOVED = کالا از فهرست کالاهای انبار حذف شده (غیرفعال شده)
   * MISSING = رکورد کالا در سیستم نیست (برگشت خودکار ممکن نیست)
   */
  stockState: ReturnItemStock
  warning?: string
}

export interface ReturnLookup {
  invoiceId: number
  receiptNo: number
  returnCode: string
  issuedAt: string
  issuedAtJalali: string
  issuedTime: string
  expiresAtJalali: string
  /** روزهای باقی‌مانده از اعتبار یک‌هفته‌ای کد */
  daysLeft: number
  expired: boolean
  customerName: string
  shiftName: string | null
  status: string
  statusLabel: string
  orderTypeLabel: string
  /** نشست ۱۵۸ (Y16) — orderType خام فاکتور */
  orderType: string
  /** نشست ۱۵۸ (Y16) — اسکوپ عوارض کالای جایگزین = کانال فاکتور اصلی (زنجیره‌ی تعویض دنبال می‌شود) */
  chargeScope: 'pos' | 'wholesale'
  goodsTotal: number
  discountTotal: number
  taxTotal: number
  serviceCharge: number
  deliveryFee: number
  grandTotal: number
  paidTotal: number
  paymentLabels: string
  deductInventory: boolean
  /** جمع مبلغ برگشت‌های قبلی همین فاکتور */
  returnedTotal: number
  items: ReturnLookupItem[]
  /** هشدارهای سطح فاکتور (مثلاً «۲ قلم از انبار حذف شده‌اند») */
  warnings: string[]
  /** نشست ۳۱۹ — پروفایل تسویه‌ی فاکتور مرجع (فقط‌خواندنی) */
  settlementProfile?: InvoiceSettlementProfile
}

/** ترکیب پرداختی فاکتور مرجع، از دید «پول واقعی» (F1). همه ریال، همه از سرور. */
export interface InvoiceSettlementProfile {
  /** کد قاعده‌ی غالب برای هدایت */
  kind: 'CREDIT_ONLY' | 'PAID_CASHLIKE' | 'MIXED' | 'STORE_CREDIT_FUNDED' | 'EXCHANGE_DOC'
  /** پول نقد/کارت/کارت‌به‌کارتِ واقعی فاکتور (همان cashLikeReceivedOf) */
  cashLikeReceived: number
  /** سقف فعلی خروج پول برای برگشت ساده (همان cashLikeRefundableOf بعد از بازپرداخت‌های قبلی) */
  cashLikeRefundableNow: number
  /** بدهی باقی‌مانده‌ی فعلی فاکتور (settlement.ts) */
  remainingDebt: number
  /** مصرف‌های کد اعتبار روی این فاکتور (برگشت‌نخورده) */
  creditRedemptions: Array<{
    creditId: number
    code: string // ماسک‌شده برای نمایش: ****-1234
    amount: number
    creditStatus: string // ACTIVE | USED | EXPIRED | CANCELED
  }>
  /** آیا این فاکتور سند تعویض است؟ (زنجیره‌ی sourceInvoiceId) */
  isExchangeDoc: boolean
  sourceReceiptNo: number | null
}

// ---------------------------------------------------------------------------
// ویرایش و حذف یک برگشت از فروش ثبت‌شده
// ---------------------------------------------------------------------------

/** یک قلم در فرم «ویرایش برگشت»: همه‌ی اقلام فاکتور، با تعداد فعلی این برگشت. */
export interface ReturnEditItem {
  saleItemId: number
  variantId: number
  code: string
  barcode: string
  name: string
  unit: string
  /** تعداد فروخته‌شده در فاکتور */
  soldQty: number
  /** تعدادی که در *بقیه‌ی* برگشت‌های همین فاکتور برگشته است */
  otherReturnedQty: number
  /** سقف مجاز برای این برگشت (soldQty − otherReturnedQty) */
  maxQty: number
  /** تعداد فعلی همین برگشت (۰ = این قلم در این برگشت نیست) */
  qty: number
  /** تعدادی که واقعاً به موجودی انبار برگشته بود */
  restockedQty: number
  unitPrice: number
  stock: number
  stockState: ReturnItemStock
}

export interface ReturnEditView {
  id: number
  invoiceId: number
  receiptNo: number
  returnCode: string | null
  invoiceDateJalali: string
  customerName: string
  returnedAtJalali: string
  time: string
  isFull: boolean
  total: number
  note: string
  /** فاکتور اصلی موجودی را کم کرده بود؟ (یعنی ویرایش روی انبار اثر دارد) */
  restocks: boolean
  items: ReturnEditItem[]
}

export interface UpdateReturnInput {
  id: number
  /** حالت *نهایی* برگشت (قلم‌های با تعداد صفر یعنی از برگشت خارج می‌شوند) */
  lines: { saleItemId: number; qty: number }[]
  note?: string | null
  userId?: number | null
  /** تایید آگاهانه برای تعداد بیشتر از قابل برگشت */
  force?: boolean
  /** تایید آگاهانه برای کالای حذف‌شده از انبار */
  allowRemoved?: boolean
  /**
   * جلسه ۱۵ (بند ۱۷) — دوره‌ی بسته.
   * نشست ۱۸۲/۲۰۱ — اثر مالی (بازپرداخت/اعتبار/کاهش بدهی) هم همین رمز + دلیل؛
   * سنجش رمز بیرون از تراکنش است.
   */
  /** رمز مدیر یا رمز دومِ قفل اختصاصی «اصلاح و ابطال برگشت/تعویض». */
  panelPassword?: string | null
  managerPassword?: string | null
  overrideReason?: string | null
}

// ---------------------------------------------------------------------------
// حذف گزارشات فروش یک بازه (پنل تنظیمات)
// ---------------------------------------------------------------------------

export interface SalesPurgeLine {
  variantId: number
  code: string
  name: string
  unit: string
  /** تعدادی که با انتخاب «بله» به موجودی انبار برمی‌گردد */
  qty: number
  /** موجودی فعلی همین کالا */
  stock: number
}

export interface SalesPurgePreview {
  fromJalali: string
  toJalali: string
  rows: SaleReportRow[]
  totals: SaleReportTotals
  /** صفحه‌ی واقعی فاکتورهای پیش‌نمایش؛ جمع‌ها مستقل از این صفحه‌اند. */
  page?: SaleReportPage
  /** هشدار صریح اگر پیش‌نمایش برای نمایش به سقف صفحه رسیده باشد. */
  warnings?: string[]
  /** تعداد برگشت‌های از فروشِ ثبت‌شده روی همین فاکتورها (هم حذف می‌شوند) */
  returnCount: number
  /** تعداد ردیف‌های کالا در فاکتورهای بازه */
  itemCount: number
  /** جمع تعدادی که در حالت «بله» به انبار برمی‌گردد */
  restoreQty: number
  restoreLines: SalesPurgeLine[]
}

// ---------------------------------------------------------------------------
// گزارش فروش
// ---------------------------------------------------------------------------

export interface SaleReportFilter {
  /** بازه‌ی شمسی yyyy/MM/dd (شامل هر دو سر) */
  fromJalali?: string
  toJalali?: string
  /** بازه‌ی ISO (اگر پاس داده شود، بر بازه‌ی شمسی اولویت دارد) */
  from?: string
  to?: string
  shiftId?: number | null
  shiftNumber?: number | null
  userId?: number | null
  customerId?: number | null
  status?: string | null
  orderType?: string | null
  receiptNo?: number | null
  returnCode?: string | null
  customerSearch?: string | null
  /** جستجوی کالا در فاکتورها (بارکد/کد/نام) */
  productSearch?: string | null
  /** فقط فاکتورهای تجمیع‌نشده (برای پنل تجمیع و انتقال) */
  onlyNotConsolidated?: boolean
  /** درخواست صریح بازهٔ کامل؛ گزارش عادیِ بی‌تاریخ همچنان «امروز» است. */
  fullRange?: boolean
  /** پیش‌نمایش/عملیات مدیریتی روی همین فاکتورهای مشخص، مستقل از صفحه‌ی گزارش */
  invoiceIds?: number[] | null
  /**
   * بند ۶ — کانال فروش: `['RETAIL']` · `['WHOLESALE']` · `['RETAIL','WHOLESALE']`.
   *
   *   • `undefined` یا `null` ⇒ «همه» (مو‌به‌مو رفتار نسخه‌های قبل).
   *   • آرایه‌ی *خالی* ⇒ «هیچ‌کدام» ⇒ گزارش عمداً خالی برمی‌گردد. اگر خالی هم
   *     «همه» تفسیر می‌شد، کاربری که هر دو تیک را برمی‌داشت به‌اشتباه کل فروش را
   *     می‌دید و گزارش دروغ می‌گفت.
   *
   * کنار `orderType` می‌نشیند و با آن ضرب می‌شود (AND)، پس اگر کاربر هم «نوع
   * سفارش: تلفنی» را انتخاب کرده باشد و هم تیک «عمده» را، نتیجه درست خالی است.
   */
  channels?: string[] | null
  take?: number
  /**
   * ---------------------- افزوده‌های جلسه ۱۵ ----------------------
   * سرور این دو را از جلسه ۱۴ می‌خواند ولی تایپ نداشتند و UI مجبور بود
   * `as any` بفرستد. اختیاری‌اند، پس هیچ صدازننده‌ی فعلی نمی‌شکند.
   */
  /** صفحه‌بندی واقعی جدول (جمع‌ها هیچ‌وقت از این صفحه حساب نمی‌شوند) */
  skip?: number
  /** اسناد سازنده‌ی ردیف‌های پل تطبیق هم خوانده شوند؟ (گزارش سنگین‌تر) */
  withDrillDown?: boolean
  /** کلید یک ردیف پل برای بارگذاری صفحه‌ی اسناد سازنده‌اش */
  bridgeSourceKey?: string | null
  /** جابه‌جایی صفحه‌ی اسناد سازنده‌ی پل */
  bridgeSourceSkip?: number
  /** تعداد اسناد سازنده در هر صفحه */
  bridgeSourceTake?: number
}

export interface SaleReportRow {
  id: number
  receiptNo: number
  dateJalali: string
  time: string
  customerName: string
  status: string
  statusLabel: string
  orderTypeLabel: string
  userName: string
  shiftId: number | null
  shiftNumber: number | null
  shiftName: string
  /** جلسه ۱۹ — شماره‌ی نشست زیر همان نام شیفت در همان روز */
  shiftSessionSeq?: number | null
  /** جلسه ۱۹ — نام نمایشی نشست: «شیفت شب — نشست ۲» */
  shiftSessionLabel?: string | null
  goodsTotal: number
  taxTotal: number
  serviceCharge: number
  discountTotal: number
  deliveryFee: number
  grandTotal: number
  cashTotal: number
  cardTotal: number
  creditTotal: number
  otherTotal: number
  receivedTotal: number
  returnedTotal: number
  returnCode: string | null
  consolidated: boolean
  deductInventory: boolean
  /** جمع پرداختی‌های *دریافت‌شده* (نقدی + چک پاس‌شده) — فروش نسیه */
  paidTotal: number
  /** باقی‌مانده = جمع کل − پرداختی‌های دریافت‌شده */
  remaining: number
  /** باقی‌مانده صفر است؟ (فاکتور تسویه‌شده) */
  settled: boolean
  /**
   * ------------------ تعویض کالا و اعتبار خرید (بخش ۶) ------------------
   * مبلغی که روی این فاکتور با «ارزش کالای برگشتی» تسویه شده (سند تعویض).
   * پول نقد نیست، پس در ستون‌های نقدی/کارت و در `receivedTotal` نمی‌آید.
   */
  exchangeCreditTotal: number
  /** مبلغ «بارکد اعتبار خرید بعدی» که روی این فاکتور مصرف شده (پول نقد نیست) */
  storeCreditTotal: number
  /** این فاکتور یک «سند تعویض» است؟ (orderType = EXCHANGE) */
  isExchange: boolean
  /** جمع «مبلغ اضافه‌ی دریافتی» پرداختی‌های این فاکتور (بخش ۸) */
  overpayTotal: number
  /**
   * ---------------------- افزوده‌های جلسه ۱۴ (بند ۲-۱ و ۲-۵) ----------------------
   * `returnedTotal` بالا از این نسخه فقط `kind=RETURN` *داخل بازه‌ی گزارش* است.
   * این چهار عدد تفکیک همان رویدادها را نگه می‌دارند تا هیچ‌کدام دوبار شمرده
   * نشوند و تعویض هرگز به‌جای برگشت ساده از فروش کم نشود.
   */
  /** ارزش کالای برگشتی داخل سندهای تعویض (kind=EXCHANGE) در بازه */
  exchangeReturnedTotal: number
  /** بازپرداخت نقدیِ واقعیِ برگشت‌های ساده‌ی این فاکتور در بازه */
  refundCashTotal: number
  /** بازپرداخت کارتیِ برگشت‌های ساده‌ی این فاکتور در بازه */
  refundCardTotal: number
  /** برگشتی که فقط بدهی مشتری را کم کرد (هیچ پولی از کشو بیرون نرفت) */
  refundDebtOnlyTotal: number
  /** برگشت‌های قدیمی این فاکتور که روش بازپرداخت ثبت‌نشده دارند */
  legacyRefundAssumed: boolean
  /**
   * ---------------------- کار الف (جلسه ۳۶): مقصد پول ----------------------
   * `managerAccountTotal` = دریافتیِ این فاکتور که به **حساب مدیر** رفته.
   *   مشتری پرداخته (بدهی کم و فاکتور تسویه می‌شود) ولی این پول به کارتخوان و
   *   صندوقِ فروشگاه نیامده، پس عمداً از `cashTotal`/`cardTotal` و از
   *   `receivedTotal` بیرون است و ردیف جدای خودش را دارد.
   *
   * `destinationUnknownTotal` = چکِ پاس‌شده‌ی **قدیمی** که مقصد ثبت‌نشده دارد.
   *   هیچ حدسی برایش زده نمی‌شود؛ فقط با برچسب «نامشخص» دیده می‌شود. برای
   *   دست‌نخوردن جمع‌های قبلی، همچنان داخل `receivedTotal` شمرده می‌شود ولی به
   *   نقد/کارت مورد انتظار صندوق اضافه نمی‌گردد.
   */
  managerAccountTotal: number
  destinationUnknownTotal: number
}

export interface SaleReportTotals {
  count: number
  goodsTotal: number
  taxTotal: number
  serviceTotal: number
  discountTotal: number
  deliveryTotal: number
  grandTotal: number
  cashTotal: number
  cardTotal: number
  creditTotal: number
  otherTotal: number
  receivedTotal: number
  returnedTotal: number
  /**
   * =========== جمع‌بندی تعویض و اعتبار خرید (بخش ۶) ===========
   * این چهار عدد عمداً از `receivedTotal` (نقد واقعی) بیرون‌اند تا گزارش
   * «خالص واقعی دریافتی» غیرقابل‌دستکاری بماند.
   */
  /** ارزش کالای برگشتی که داخل سندهای تعویض تسویه شده */
  exchangeCreditTotal: number
  /** مبلغ بارکدهای اعتبارِ *مصرف‌شده* روی فاکتورهای این بازه */
  storeCreditUsedTotal: number
  /** مبلغ بارکدهای اعتبارِ *صادرشده* در این بازه (بدهی ما به مشتری) */
  storeCreditIssuedTotal: number
  /** تعداد سندهای تعویض این بازه */
  exchangeCount: number
  /** جمع مابه‌التفاوت تعویض‌ها (مثبت = دریافتی از مشتری) */
  exchangeDiffTotal: number
  /** جمع «مبلغ اضافه‌ی دریافتی» (بخش ۸) */
  overpayTotal: number
  /**
   * ====== بند ۷ — دو عددی که «گزارش کامل و قابل‌کنترل» لازمش دارد ======
   *
   * `creditRemainingTotal` = جمع باقی‌ماندهٔ بدهی فاکتورهای *همین بازه*؛ پولی که
   *   فروش رفته ولی به صندوق نیامده. در ردیف گزارش با علامت منفی می‌آید.
   *
   * `priorSettlementTotal` = پولی که *در این بازه* بابت نسیه‌ی فاکتورهای
   *   بازه‌های *قبل* دریافت شده. پول واقعیِ امروز است ولی فروشِ امروز نیست، پس
   *   جداگانه و با علامت مثبت نشان داده می‌شود (و در `grandTotal` نیست).
   *
   * هر دو همیشه پر می‌شوند، حتی اگر صفر باشند — بند ۷ صریح می‌گوید ردیف‌های صفر
   * هم باید در گزارش دیده شوند.
   */
  creditRemainingTotal: number
  priorSettlementTotal: number
  /**
   * ---------------------- افزوده‌های جلسه ۱۴ ----------------------
   * تفکیک برگشت/تعویض روی سطح جمع‌ها، تا `returnedTotal` (که فقط
   * `kind=RETURN` است) هیچ‌وقت ارزش کالای تعویض را قاطی نکند.
   */
  exchangeReturnedTotal: number
  refundCashTotal: number
  refundCardTotal: number
  refundDebtOnlyTotal: number
  /**
   * نشست ۱۸۷ — اعتبار صادرشده *به‌جای* بازپرداخت نقدی:
   * برگشت ساده با روش STORE_CREDIT + مابه‌التفاوت تعویض با تسویه اعتبار.
   * این بدهی ما به مشتری است، نه فروش تازه و نه خروج نقد از کشو.
   */
  storeCreditRefundTotal: number
  /** تعداد ردیف‌هایی که برگشت قدیمیِ بدون روش بازپرداخت دارند */
  legacyRefundCount: number
  /**
   * ---------------------- کار الف (جلسه ۳۶): مقصد پول ----------------------
   * هر دو همیشه پر می‌شوند، حتی صفر (ردیف صفر هم باید در گزارش دیده شود).
   * `managerAccountTotal` در `receivedTotal` و در «نقد/کارت مورد انتظار صندوق»
   * **نیست**؛ `destinationUnknownTotal` فقط برچسب است و به انتظار صندوق اضافه
   * نمی‌شود.
   */
  managerAccountTotal: number
  destinationUnknownTotal: number
  /**
   * «خالص واقعی دریافتی» =
   *   نقد واقعی (نقدی + کارت + اعتباری + سایر)
   *   − مبلغ بارکدهای اعتبارِ صادرشده (پولی که به مشتری بدهکار شدیم)
   */
  netReceivedTotal: number
}

/**
 * یک «نشست» داخل گروه یک نام‌شیفت (جلسه ۱۹ · بند ۱).
 * جزئیات هر نشست جداگانه دیده می‌شود، ولی سرجمع گروه = مجموع همه‌ی نشست‌های
 * همان نام در همان روز.
 */
export interface SaleReportSessionGroup {
  key: string
  shiftId: number | null
  sessionSeq: number | null
  sessionLabel: string
  openedAt: string | null
  closedAt: string | null
  closed: boolean
  rows: SaleReportRow[]
  totals: SaleReportTotals
}

export interface SaleReportGroup {
  key: string
  title: string
  dayJalali: string
  shiftId: number | null
  shiftNumber: number | null
  shiftName: string
  openedAt: string | null
  closedAt: string | null
  closed: boolean
  rows: SaleReportRow[]
  totals: SaleReportTotals
  /** جلسه ۱۹ — ریز نشست‌های همین نام‌شیفت در همان روز (تجمیع بالا، جزئیات اینجا) */
  sessions?: SaleReportSessionGroup[]
}

/**
 * ===========================================================================
 * جلسه ۱۴ — هفت بلوک «صورت حساب» گزارش فروش.
 *
 * چرا یک شیء تازه و *افزایشی* کنار `SaleReportTotals` قدیمی، نه تغییر آن؟
 * چون هر عددی که پنل‌های فعلی (بستن صندوق، جزئیات شیفت، تجمیع، خروجی اکسل)
 * می‌خوانند باید مو‌به‌مو سر جایش بماند. این شیء فقط *اضافه* می‌شود و همه‌ی
 * اعدادش از `src/shared/accounting.ts` می‌آیند — هیچ فرمولی اینجا دوباره
 * نوشته نمی‌شود.
 *
 * قاعده‌ی «ردیف صفر هم دیده شود»: همه‌ی این فیلدها اجباری‌اند و همیشه پر
 * می‌شوند؛ صفر بودن یک عدد با نبودنش دو معنی کاملاً متفاوت دارد.
 * ===========================================================================
 */

/** بازه‌ی مؤثر گزارش و این‌که از کجا آمده (برای شفافیت روی UI). */
export interface SaleReportPeriod {
  fromJalali: string | null
  toJalali: string | null
  /** explicit = کاربر بازه داد · shift = از شیفت ساخته شد · rows = از خود ردیف‌ها · none = بدون بازه */
  /**
   * نشست ۱۸۴ — `'today'` تازه است: نبودِ تاریخ دیگر «کل تاریخچه» نیست،
   * «امروز» است (بند ۴-۲۳). UI می‌تواند با همین برچسب به کاربر بگوید
   * بازه از کجا آمده.
   */
  source: 'explicit' | 'shift' | 'rows' | 'today' | 'none'
}

/** بلوک ۱ — فاکتور (بر مبنای `SaleInvoice.issuedAt`). */
export interface SaleInvoiceBlock {
  grossSales: number
  discounts: number
  taxes: number
  serviceCharges: number
  deliveryFees: number
  simpleReturns: number
  exchangeReturned: number
  netAccrualSales: number
  invoiceCount: number
}

/** بلوک ۲ — نسیه (چهار عدد بند ۳-د). */
export interface SaleCreditBlock {
  /** نسیه‌ی ایجادشده توسط فاکتورهای همین بازه */
  created: number
  /** وصول نسیه‌ی فاکتورهای همین بازه، در همین بازه */
  settledCurrent: number
  /** وصول نسیه‌ی فاکتورهای بازه‌های *قبل*، در همین بازه (بر اساس paidAt) */
  settledPrior: number
  /**
   * ---------------- کار الف (جلسه ۳۶): سهم *نقدِ* همان وصولی ----------------
   * `settledPrior` کل وصولی است (نقد + کارت + سایر) و مستقیم به
   * `priorCashSettlements` بستن صندوق می‌رفت؛ یعنی پولی که روی کارتخوان نشسته
   * بود «نقد مورد انتظار» را بالا می‌برد و صندوق بی‌دلیل کسری نشان می‌داد.
   * از این نسخه بستن صندوق **فقط** این عدد را می‌خواند.
   */
  settledPriorCash: number
  /** سهم کارتخوانِ همان وصولی (به «انتظار کارتخوان» می‌رود، نه به نقد) */
  settledPriorCard: number
  /** بقیه‌ی همان وصولی (نه نقد، نه کارتخوان) */
  settledPriorOther: number
  /**
   * نشست ۱۶۷ · S162-D3 (S167-D1) — فقط نمایشی: چه مقدار از `settledPrior` اضافه‌دریافت (بیش از بدهی
   * فاکتور دوره‌ی قبل) بوده است. داخل همان `settledPrior` است و دوباره جمع/کم نمی‌شود. اختیاری برای سازگاری.
   */
  settledPriorOverpay?: number
  /**
   * خط کنترل سرجمع: هر وصول نسیه‌ی فاکتورِ بازه‌های قبل در همین بازه، با نام مشتری
   * اگر در فاکتور ثبت شده باشد. عدد `settledPrior` را عوض نمی‌کند.
   */
  settledPriorStories?: { paymentId: number; receiptNo: number; amount: number; text: string }[]
  /** اگر سقف خط کنترل پر شود؛ بقیه در تب نسیه است. فقط نمایشی. */
  settledPriorStoryHidden?: number
  /** باقی‌مانده‌ی بدهی همین فاکتورها در پایان بازه (فرمول بند ۲-۷) */
  remaining: number
  pendingCheques: number
  bouncedCheques: number
}

/** بلوک ۳ — برگشت و تعویض (کاملاً تفکیک‌شده، هرگز ادغام‌نشده). */
export interface SaleReturnBlock {
  simpleReturns: number
  cashRefunds: number
  cardRefunds: number
  storeCreditRefunds: number
  /** برگشتی که فقط بدهی مشتری را کم کرد (هیچ نقدی جابه‌جا نشد) */
  debtOnlyReturns: number
  exchangeReturned: number
  exchangeReplacement: number
  exchangeDiffReceived: number
  exchangeCashRefunds: number
  exchangeCardRefunds: number
  exchangeStoreCreditIssued: number
  returnCount: number
  exchangeCount: number
  /** تعداد برگشت‌های قدیمی که `refundMethod` ندارند و با فرض محافظه‌کارانه خوانده شدند */
  legacyAssumedCount: number
}

/** بلوک ۴ — چک (همیشه، حتی صفر). */
export interface SaleChequeBlock {
  registered: number
  cleared: number
  pendingFuture: number
  pendingPastDue: number
  bounced: number
  pastDueCount: number
  futureCount: number
  /** چک‌های بازه‌های قبل که در *همین* بازه پاس شدند (ردیف پل تطبیق) */
  priorCleared: number
  /**
   * -------------- کار الف (جلسه ۳۶): چکِ پاس‌شده به تفکیک مقصد --------------
   * جمع این چهار عدد = `cleared`. تا جلسه ۳۵ کل `cleared` هم به «انتظار نقد»
   * (`clearedCashChequeAmount`) و هم — از راه سبد «سایر» — به «انتظار کارتخوان»
   * اضافه می‌شد؛ یعنی دو بار. از این نسخه هر مبلغ فقط در سبد مقصد خودش است.
   */
  clearedToCash: number
  clearedToCard: number
  clearedToManager: number
  /** چکِ پاس‌شده‌ی قدیمی بدون مقصد — نه در نقد، نه در کارت، فقط «نامشخص» */
  clearedUnknown: number
  warnings: string[]
}

/** بلوک ۵ — اعتبار خرید (همیشه، حتی صفر). */
/** یک مصرف اعتبار در بازه — جملهٔ خط کنترل صندوق (نشست ۱۸۷). */
export interface StoreCreditUsageStory {
  /**
   * شرح امنِ مسیر اعتبار. کد قابل مصرف عمداً در قرارداد گزارش وجود ندارد؛
   * نمایش محرمانهٔ مدیر، اگر لازم شد، باید از کانال جدا و مجوزدار بیاید.
   */
  safeText: string
  amount: number
  issuedAtJalali: string
  usedAtJalali: string
  reason: 'RETURN' | 'EXCHANGE' | 'OVERPAY' | 'MANUAL' | 'OTHER'
}

export interface SaleStoreCreditBlock {
  issued: number
  /** نشست ۶۱ — سهم اعتبارهای صادرشده از اضافه‌دریافت (داخل issued؛ در پل زیر «دریافت پول اضافه») */
  issuedFromOverpay?: number
  /** نشست ۱۷۰ · S169-D4 — سهم سند‌دار (فقط همین در پل)، بی‌سند (دستی/گروهی) و باقی‌مانده؛ همه داخل issued */
  issuedBacked?: number
  issuedUnbacked?: number
  issuedRemainder?: number
  /** نشست ۱۷۱ · S170-D3 — باقی‌مانده‌ی اعتبار اضافه‌دریافت (داخل issuedFromOverpay) */
  issuedOverpayRemainder?: number
  /**
   * خاستگاه‌های متقابلاً مجزای اعتبار صادرشده؛ قرارداد کارت «گردش اعتبار» و
   * ریزبین مالی. هیچ‌یک کد قابل‌مصرف اعتبار را حمل نمی‌کند.
   */
  issuedLifecycleReturn?: number
  issuedLifecycleExchange?: number
  issuedLifecycleManual?: number
  issuedLifecycleOverpay?: number
  issuedLifecycleRemainder?: number
  issuedLifecycleOther?: number
  used: number
  active: number
  /** ماندهٔ منقضی تا پایان بازه (snapshot/حسابداری). */
  expired: number
  /** مانده‌ای که تاریخ انقضایش دقیقاً در بازهٔ انتخاب‌شده است. */
  expiredInRange?: number
  canceled: number
  issuedCount: number
  usageCount: number
  /** مصرف‌های همین بازه، برای بازشدن با + روی خط کنترل (سقف خواندن ۵۰۰۰). */
  usedStories?: StoreCreditUsageStory[]
}

/** بلوک ۶ — وجه واقعی (بر مبنای تاریخ دریافت واقعی). */
export interface SaleCashBlock {
  cashReceived: number
  cardReceived: number
  otherReceived: number
  /**
   * کار الف — دریافتی‌ای که به **حساب مدیر** رفته (چک پاس‌شده + پرداختی نسیه).
   * عمداً در `netCashMovement` و در هیچ‌کدام از انتظارهای صندوق نیست.
   */
  managerAccountReceived: number
  /** کار الف — دریافتیِ قدیمیِ بدون مقصد («نامشخص»)؛ بدون هیچ حدسی. */
  destinationUnknownReceived: number
  /**
   * نشست ۱۸۵ · بند ۴-۲۴ — زیرمجموعه‌ی `destinationUnknownReceived` که احتمالاً
   * پول کشو بوده (روش نقد، بدون مقصد، داده‌ی پیش از migration مقصد).
   * با آن جمع **نمی‌شود**؛ فقط می‌گوید چه بخشی از «نامشخص» در نقد مورد
   * انتظار لحاظ شده تا کسری دروغ ساخته نشود.
   */
  unknownLikelyCash: number
  clearedChequeReceived: number
  priorCreditSettlements: number
  cashRefundsForReturns: number
  cardRefundsForReturns: number
  cashRefundsForExchanges: number
  cardRefundsForExchanges: number
  cashWithdrawals: number
  cashDeposits: number
  netCashMovement: number
}

/** یک ردیف پل تطبیق + اسناد سازنده‌اش (drill-down). */
export interface SaleBridgeRow {
  key: string
  label: string
  amount: number
  sign: 1 | -1
  /** توضیح یک‌خطی «این عدد از کجا آمد» */
  hint: string
  /** اسناد سازنده‌ی همین عدد، برای بازشدن با کلیک */
  sources: SaleBridgeSource[]
  /** metadata واقعی صفحه‌ی اسناد سازنده؛ جمع‌ها هرگز از این صفحه حساب نمی‌شوند */
  sourcesPage?: SaleReportPage
  /** هشدار محدودیت یا خطای همین drill-down، جدا از هشدار کل گزارش */
  sourcesWarning?: string
}

export interface SaleBridgeSource {
  kind: 'INVOICE' | 'RETURN' | 'PAYMENT' | 'STORE_CREDIT' | 'CASH_MOVEMENT'
  /**
   * نوع صریح سند اعتبار؛ Financial Inspector نباید از متن label (که برای
   * مدیر و امنیت redacted شده) نوع منبع را حدس بزند.
   */
  subKind?: 'STORE_CREDIT_ISSUANCE' | 'STORE_CREDIT_REDEMPTION'
  id: number
  label: string
  amount: number
  dateJalali: string | null
  /** شناسه‌ای که UI با آن می‌تواند سند مبدأ را باز کند */
  invoiceId: number | null
  receiptNo: number | null
}

/**
 * تنها پاسخِ صریحِ افشای کد اعتبار برای مدیر. این type هرگز عضو گزارش، ریزبین،
 * چاپ یا export عمومی نیست و فقط از IPC مجوزدار `creditManagerCodeReveal` برمی‌گردد.
 */
export interface ManagerStoreCreditCodeReveal {
  creditId: number
  code: string
}

/**
 * ===========================================================================
 * ریزبین مالی گزارش فروش — قرارداد فقط‌خواندنی.
 *
 * `FINANCIAL_SOURCE_KEYS` ردیف‌های رسمی پل تطبیق‌اند. کلیدهای جزء در آرایهٔ
 * جدا نگه داشته می‌شوند: آن‌ها فرمول جدیدی نیستند، فقط اسنادِ همان اجزای رسمی
 * کاشی‌های کشو/پوز/سایر را با predicate سمت سرور نشان می‌دهند.
 * ===========================================================================
 */
export const FINANCIAL_SOURCE_KEYS = [
  'realCash',
  'managerAccountReceived',
  'destinationUnknownReceived',
  'storeCreditIssued',
  /** کل صدورِ چرخه، جدا از ردیفِ قدیمیِ فقط سنددارِ پل تطبیق. */
  'storeCreditIssuedAll',
  /** ریزِ امن چرخهٔ اعتبار؛ همه از همان صورت رسمی گزارش می‌آیند، نه جمع Renderer. */
  'storeCreditIssuedReturn',
  'storeCreditIssuedExchange',
  'storeCreditIssuedManual',
  'storeCreditIssuedOverpay',
  'storeCreditIssuedRemainder',
  'storeCreditIssuedOther',
  'storeCreditExpired',
  /** ماندهٔ اعتبارهایی که تاریخ انقضایشان داخل بازهٔ انتخاب‌شده است. */
  'storeCreditExpiredInRange',
  'storeCreditCanceled',
  'priorCreditSettlements',
  'priorClearedCheques',
  'priorManagerAccountReceived',
  'priorDestinationUnknownReceived',
  'storeCreditUsed',
  'uncollectedCredit',
  'cashRefunds',
  'cardRefunds',
  'cardToCardRefunds',
  'exchangeCashRefunds',
  'exchangeCardRefunds',
  'exchangeCardToCardRefunds',
  'priorDebtReturns',
  'overpayReceived'
] as const
export type FinancialSourceKey = (typeof FINANCIAL_SOURCE_KEYS)[number]

/**
 * اجزای قابل‌ردیابی کاشی‌ها. هر کدام فقط یک فیلتر خواندنی روی سندهای موجود است؛
 * مبلغ رسمی از صورت حسابداری ساخته‌شده می‌آید، نه از جمع Renderer.
 */
export const FINANCIAL_COMPONENT_KEYS = [
  'drawerCashReceived',
  'posCardReceived',
  'otherMethodReceived'
] as const
export type FinancialComponentKey = (typeof FINANCIAL_COMPONENT_KEYS)[number]
export type FinancialInspectorKey = FinancialSourceKey | FinancialComponentKey

export type FinancialSourceSort =
  | 'DATE_DESC'
  | 'DATE_ASC'
  | 'AMOUNT_DESC'
  | 'AMOUNT_ASC'
  | 'DOCUMENT_DESC'
  | 'DOCUMENT_ASC'

export interface FinancialSourceRequest {
  scope: SaleReportFilter
  key: FinancialInspectorKey
  skip?: number
  take?: number
  search?: string
  sort?: FinancialSourceSort
}

export interface FinancialSourceRow {
  /** subKind فقط metadata امنِ مسیر افشای مدیر است؛ کد اعتبار نیست. */
  ref: Pick<SaleBridgeSource, 'kind' | 'id' | 'subKind'>
  /** متن سرور، از همان سند سازنده؛ برای نمایش و جست‌وجوی امن. */
  documentLabel: string
  amount: number
  dateJalali: string | null
  invoiceId: number | null
  receiptNo: number | null
  /** اثر این سند در ردیف پل؛ منابع فعلی همگی سهم مثبت دارند و جهت در خود ردیف پل است. */
  effect: 'IN' | 'OUT' | 'NON_CASH' | 'BALANCE'
}

export interface FinancialSourceResult {
  key: FinancialInspectorKey
  label: string
  hint: string
  /** مبنای مبلغ رسمی؛ RANGE یعنی کل بازه و CURRENT_PAGE یعنی همان صفحهٔ گزارش اجراشده. */
  basis: 'RANGE' | 'CURRENT_PAGE'
  /** فقط برای CURRENT_PAGE: آیا صفحهٔ گزارش واقعاً همهٔ بازه را پوشش می‌دهد؟ */
  pageCoversRange: boolean
  /** مبلغ رسمی ردیف پل یا جزء کاشی، مستقل از صفحه/جست‌وجوی منابع. */
  totalAmount: number
  /** جمع اسناد منطبق با search جاری؛ هرگز جای مبلغ رسمی نمی‌نشیند. */
  sourceAmount: number
  totalCount: number
  filteredCount: number
  page: SaleReportPage
  sort: FinancialSourceSort
  search: string
  /** اگر false باشد UI نباید تیک هم‌خوانی سبز نمایش دهد. */
  reconciles: boolean
  difference: number
  sources: FinancialSourceRow[]
}

export interface FinancialSourceResponse {
  ok: boolean
  result?: FinancialSourceResult
  message?: string
}

export interface FinancialDocumentRequest {
  scope: SaleReportFilter
  key: FinancialInspectorKey
  ref: Pick<SaleBridgeSource, 'kind' | 'id'>
}

/** شناسنامهٔ فقط‌خواندنیِ سندی که عضویت آن در منبع مالی سمت سرور تأیید شده است. */
export interface FinancialDocumentDetail {
  /** subKind از source اثبات‌شدهٔ server می‌آید و فقط برای reveal جداگانهٔ مدیر است. */
  ref: Pick<SaleBridgeSource, 'kind' | 'id' | 'subKind'>
  title: string
  /** سهم همین سند در عدد مالی بازشده، نه لزوماً کل مبلغ سند. */
  sourceAmount: number
  documentAmount: number
  documentLabel: string
  occurredAt: { dateJalali: string | null; time: string | null }
  invoice: { id: number; receiptNo: number; issuedAtJalali: string | null } | null
  customer: { id: number | null; name: string }
  actor: { id: number | null; name: string }
  shift: { id: number | null; name: string | null }
  settlement: { method: string; methodLabel: string; reference: string | null; status: string | null }
  /**
   * فقط در شناسنامهٔ امنِ اعتبار: وضعیتِ مؤثر و تاریخ واقعی انقضا.
   * این بلوک هیچ‌گاه کد قابل‌مصرف را حمل نمی‌کند؛ reveal کد مسیر جداگانهٔ مدیر است.
   */
  creditValidity?: {
    status: string
    statusLabel: string
    expiresAtJalali: string | null
    issuedDays: number | null
    remaining: number
  }
  items: Array<{ name: string; code: string; qty: number; unitPrice: number; lineTotal: number }>
  note: string | null
  voided: boolean
}

export interface FinancialDocumentResponse {
  ok: boolean
  detail?: FinancialDocumentDetail
  message?: string
}

/** بلوک ۷ — پل تطبیق. */
export interface SaleBridgeBlock {
  rows: SaleBridgeRow[]
  explainedTotal: number
  target: number
  unexplained: number
  balanced: boolean
}

export interface SaleAccountingStatements {
  period: SaleReportPeriod
  invoice: SaleInvoiceBlock
  credit: SaleCreditBlock
  returns: SaleReturnBlock
  cheques: SaleChequeBlock
  storeCredits: SaleStoreCreditBlock
  cash: SaleCashBlock
  bridge: SaleBridgeBlock
  /**
   * جاهایی که یک فیلتر ذاتاً روی یک عدد قابل اعمال نبود.
   * قاعده‌ی سند: «به‌جای نادیده‌گرفتن بی‌صدای فیلتر، صریح بنویس قابل تفکیک نیست».
   */
  notes: string[]
}

/** صفحه‌بندی واقعیِ جدول (جمع‌ها هرگز از این ردیف‌ها حساب نمی‌شوند). */
export interface SaleReportPage {
  skip: number
  take: number
  /** تعداد کل ردیف‌های بازه (نه تعداد ردیف‌های این صفحه) */
  totalCount: number
  /** ردیف‌های نمایش‌داده‌شده کمتر از کل هستند؟ */
  truncated: boolean
  /** نشست ۱۷۳ · S173-D2 — خواندن اسناد drill پل با خطا روبه‌رو شد (فهرست خالی ≠ «بدون سند») */
  failed?: boolean
}

/**
 * خروجی صفحه‌بندی‌شده‌ی endpointهایی که برای سازگاری با پنل‌های قدیمی هنوز
 * آرایه برمی‌گردانند. این مقدار عمداً همچنان `Array.isArray(...) === true` است،
 * اما متادیتای صفحه را هم از دست نمی‌دهد.
 */
export type PagedRows<T> = T[] & {
  page: SaleReportPage
  warnings: string[]
}

export interface SaleReportResult {
  rows: SaleReportRow[]
  totals: SaleReportTotals
  /** گروه‌بندی روز → شیفت (برای چک‌باکس «جداسازی بر اساس شیفت») */
  groups: SaleReportGroup[]
  /**
   * ------------------------ افزوده‌های جلسه ۱۴ ------------------------
   * اختیاری‌اند تا هر کدی که امروز `SaleReportResult` می‌سازد بی‌تغییر بماند.
   */
  accounting?: SaleAccountingStatements
  page?: SaleReportPage
  /** هشدارهای غیرقابل‌نادیده‌گرفتن (برش صفحه‌بندی، فیلتر غیرقابل‌تفکیک، ...) */
  warnings?: string[]
}

/** یک ردیف در تب «جزئیات فروش» (سطر کالا به کالا) */
export interface SaleItemReportRow {
  invoiceId: number
  receiptNo: number
  dateJalali: string
  time: string
  shiftName: string
  code: string
  barcode: string
  name: string
  qty: number
  unitPrice: number
  discount: number
  tax: number
  lineTotal: number
  returnedQty: number
  /**
   * نشست ۱۹۴ · M-11 · بند ۴-۳۸ — ارزش ریالی همان برگشتیِ داخل بازه (نه unitPrice×تعداد).
   * از `SaleReturnItem.lineTotal` ذخیره‌شده می‌آید تا با سند برگشت یکی باشد.
   */
  returnedAmount: number
  /** `lineTotal − returnedAmount`؛ کمتر از صفر نمی‌شود. */
  netAmount: number
  /**
   * نشست ۱۹۴ · M-10 · بند ۴-۲۷ — یادآوری نارنجی: کالا در بازه‌ی *دیگر* برگشت
   * خورده. عدد `returnedQty`/`returnedAmount` این بازه را عوض نمی‌کند.
   */
  laterReturnNote?: string | null
  customerName: string
}

// ---------------------------------------------------------------------------
// شیفت و صندوق
// ---------------------------------------------------------------------------

export interface ShiftInfo {
  id: number
  name: string
  number: number
  dayJalali: string
  openedAt: string
  closedAt: string | null
  /** ساعت باز شدن شیفت (HH:mm:ss) — بخش ۳ */
  openedAtTime: string
  /** تاریخ و ساعت دقیق بسته شدن شیفت (null = هنوز باز است) — بخش ۳ */
  closedAtJalali: string | null
  closedAtTime: string | null
  closed: boolean
  userId: number | null
  userName: string | null
  invoiceCount: number
  grandTotal: number
  cashTotal: number
  cardTotal: number
  creditTotal: number
  /**
   * ------------------ کار الف (جلسه ۳۶): مقصد پول ------------------
   * `cardTotal` از این نسخه دیگر سبد «سایر» را بی‌صدا در خودش ندارد.
   * `managerAccountTotal` = دریافتی‌ای که به حساب مدیر رفته (نه صندوق، نه
   * کارتخوان) و `destinationUnknownTotal` = داده‌ی قدیمیِ بی‌مقصد.
   */
  managerAccountTotal: number
  destinationUnknownTotal: number
  otherTotal: number
  /** تنظیم «تعیین شیفت بر اساس ساعت» روشن است؟ (برای نمایش در پنل بستن صندوق) */
  byTime?: boolean
  /** بازه‌ی ساعتی همین شیفت طبق تنظیمات («۰۸:۰۰ تا ۱۴:۰۰») */
  windowLabel?: string | null
  /**
   * در حالت زمان‌بندی، ساعت جاری داخل بازه‌ی نام همین نشست نیست (فقط برچسب
   * اطلاعاتی؛ هیچ نشستی عوض یا ساخته نمی‌شود).
   */
  outsideWindow?: boolean

  // ===================== جلسه ۱۹ · مدل «نشست» =====================
  /** شماره‌ی نشست، مستقل برای هر نام‌شیفت در هر روز */
  sessionSeq?: number
  /** نام نمایشی دقیق نشست: «شیفت شب — نشست ۲» */
  sessionLabel?: string
  /** نام پیشنهادی سیستم بر اساس ساعت، در لحظه‌ی باز شدن این نشست */
  suggestedName?: string | null
  suggestedSlot?: number | null
  slotNumber?: number | null
  /** نام نهایی با پیشنهاد سیستم فرق داشت؟ */
  nameOverridden?: boolean
  /** دلیل اجباری override (هیچ‌وقت رونویسی نمی‌شود) */
  overrideReason?: string | null
  /** کارمند این نشست با کلیک صریح کاربر تأیید شده است؟ */
  staffConfirmed?: boolean
  /** AUTO | MANUAL | HANDOVER */
  openedVia?: string
  /**
   * بند ۳ — تا وقتی کارمند نشست تأیید نشده، UI باید هشدار غیرقابل‌نادیده‌گرفتن
   * نشان دهد. هیچ چیزی قفل نمی‌شود و فروش نمی‌خوابد.
   */
  staffPending?: boolean
  /** هشدار صریح main وقتی نشست از بیش از یک روز شمسی عبور کرده است */
  multiDayWarning?: string | null
}

/**
 * جلسه ۱۹ · بند ۲ — پیشنهاد سیستم برای نام شیفتِ یک نشست تازه (بر اساس ساعت).
 * این فقط یک *پیشنهاد* است: کاربر می‌تواند با ثبت دلیل، نام دیگری انتخاب کند.
 */
export interface ShiftSuggestion {
  byTime: boolean
  name: string
  slotNumber: number | null
  /** ساعت جاری داخل هیچ بازه‌ای نیست و این «نزدیک‌ترین شیفت» است */
  outside: boolean
  windowLabel: string | null
  dayJalali: string
  /** ساعت لحظه‌ی پیشنهاد، با افست «ساعت رسمی» اعمال‌شده (HH:mm) */
  clockNow: string
  templates: { number: number; name: string; startTime: string; endTime: string; windowLabel: string }[]
}

/**
 * نشستِ بازِ روزِ دیگر (جامانده) که از دید openShift پنهان می‌ماند؛ بستنش در
 * openSession دلیل و رمز مدیر می‌خواهد و مودال باید از قبل فیلدهایش را نشان دهد.
 */
export interface ShiftStaleOpen {
  id: number
  name: string
  sessionLabel: string
  dayJalali: string
  userId: number | null
  userName: string | null
}

/** داده‌ی فرم «باز کردن نشست / تعویض کارمند». */
export interface ShiftSessionForm {
  suggestion: ShiftSuggestion
  staff: { id: number; name: string; role: string }[]
  /** آخرین کارمند نشست قبلی — فقط پیش‌فرضِ highlight‌شده، بدون تأیید خودکار */
  defaultStaffId: number | null
  current: ShiftInfo | null
  /** نشست جامانده‌ی روزِ دیگر (در صورت وجود) — بستنش در مودال دلیل + رمز مدیر می‌خواهد */
  staleOpen: ShiftStaleOpen | null
  /** چرا ثبت فاکتور/پرداخت الان ممکن نیست (در صورت وجود مانع) — OVERTIME_ELIGIBLE از فاز اضافه‌کاری */
  blockReason: 'NONE' | 'STAFF_PENDING' | 'STALE_OPEN' | 'OVERTIME_ELIGIBLE'
  /**
   * نشست ۳۱۰ — چون blockReason === OVERTIME_ELIGIBLE: پیش‌نمایش کارت اعلام
   * اضافه‌کاری (ساعت پایان مجاز = پایان بازه + سقف تنظیمی، با ارقام فارسی).
   * سرور همه‌ی گیت‌ها را پوشیده ساخته است؛ modal فقط دلیل می‌گیرد و اعلام می‌کند.
   */
  overtimePreview: { untilLabel: string; capMinutes: number } | null
  guide: string
}

/**
 * وضعیت زنده‌ی نشست برای UI (کانال shift:status) — خواندنیِ خالص؛ برخلاف
 * shift:current هیچ خطایی پرتاب نمی‌کند و هیچ نشست AUTOای نمی‌سازد.
 */
export type ShiftGateState = 'OK' | 'STAFF_PENDING' | 'STALE' | 'NONE'
export interface ShiftStatusInfo {
  state: ShiftGateState
  shift?: ShiftInfo | null
  stale?: ShiftStaleOpen | null
  /**
   * نشست ۳۱۰ — وقتی state === 'STALE' ولی نشست بازِ دیروز واجد اضافه‌کاری است:
   * ساعت پایان مجاز (ارقام فارسی) تا پیام خطا/چیپ بتوانند جایگزین اعلام اضافه‌کاری
   * را هم نشان دهند. در بقیه‌ی حالت‌ها null/غایب است.
   */
  overtimeUntilLabel?: string | null
}

/** یک ردیف «انبار مرکزی» (مورد ۵) — کاملاً مستقل از موجودی فروشگاه. */
export interface SecondaryStockRow {
  id: number
  name: string
  code: string | null
  qty: number
  note: string | null
  createdAt: string
  updatedAt: string
  /** انباری که این ردیف در آن است (null = انبار پیش‌فرض «انبار مرکزی») */
  warehouseId: number | null
  /** نام همان انبار، آماده‌ی نمایش */
  warehouseName: string
  /** حد هشدار موجودی (۰ = بدون هشدار) */
  minQty: number
  /** qty کمتر از minQty است؟ (فقط نمایشی) */
  low: boolean
}

/** ورودی ثبت/ویرایش یک ردیف انبار مرکزی. */
export interface SecondaryStockInput {
  id?: number | null
  name: string
  code?: string | null
  qty?: number
  note?: string | null
  warehouseId?: number | null
  minQty?: number
  userId?: number | null
}

// ---------------------------------------------------------------------------
// انبار مرکزی: چند انبار / چند شعبه + تاریخچه + انتقال (بخش ۵)
// ---------------------------------------------------------------------------

/** یک «انبار / محل نگه‌داری» در ماژول انبار مرکزی. */
export interface SecondaryWarehouseRow {
  id: number
  name: string
  isDefault: boolean
  location: string | null
  note: string | null
  isActive: boolean
  sortOrder: number
  /** تعداد ردیف‌های کالای این انبار */
  itemCount: number
  /** جمع تعداد کالاهای این انبار */
  totalQty: number
  /** تعداد ردیف‌های زیر حد هشدار */
  lowCount: number
  createdAt: string
  updatedAt: string
}

export interface SecondaryWarehouseInput {
  id?: number | null
  name: string
  location?: string | null
  note?: string | null
  isActive?: boolean
  sortOrder?: number
  userId?: number | null
}

/** نتیجه‌ی حذف یک انبار (کالاهایش به انبار پیش‌فرض منتقل می‌شوند، حذف نمی‌شوند). */
export interface SecondaryWarehouseDeleteResult {
  id: number
  name: string
  /** تعداد ردیفی که به انبار پیش‌فرض منتقل شد */
  movedItems: number
  targetWarehouseName: string
}

/** انتقال کالا بین دو انبار ماژول انبار مرکزی. */
export interface SecondaryStockTransferInput {
  /** ردیف مبدأ */
  itemId: number
  /** انبار مقصد (null = انبار پیش‌فرض) */
  toWarehouseId?: number | null
  /** تعدادی که منتقل می‌شود (بیشتر از موجودی ردیف، فقط با تایید) */
  qty: number
  note?: string | null
  userId?: number | null
  /** تایید آگاهانه برای انتقال بیشتر از موجودی ردیف (اصل «هشدار، نه دیوار») */
  force?: boolean
}

export interface SecondaryStockTransferResult {
  qty: number
  name: string
  fromWarehouseName: string
  toWarehouseName: string
  fromRemaining: number
  toQty: number
}

/**
 * ---------------------------------------------------------------------------
 * بند ۸ — «انتقال به انبار فروشگاه».
 *
 * مقصد این انتقال، یک انبارِ دیگر از همین ماژول نیست: موجودی *واقعی* یک کالای
 * فروشگاه (`ProductVariant.stock`) است، همان عددی که پنل کالاها و پنل فروش
 * می‌بینند. پس کالای مقصد باید **صریح** انتخاب شود (`variantId`)، نه حدسی:
 * ماژول انبار مرکزی عمداً هیچ کلید خارجی‌ای به کالاهای فروشگاه ندارد و تطبیق
 * متنی (کد/بارکد/نام) فقط برای *پیشنهاد دادن* استفاده می‌شود، نه برای تصمیم
 * گرفتن. یک انتقال به کالای اشتباه، موجودی دو کالا را با هم غلط می‌کند.
 * ---------------------------------------------------------------------------
 */
export interface SecondaryToStoreInput {
  /** ردیف مبدأ در انبار مرکزی */
  itemId: number
  /** کالای مقصد در انبار فروشگاه (واریانت) — الزامی و صریح */
  variantId: number
  qty: number
  note?: string | null
  userId?: number | null
  /** تایید آگاهانه برای انتقال بیشتر از موجودی ردیف مبدأ */
  force?: boolean
  /**
   * نشست ۱۴۹ · S147-b — رمز قفل «انتقال به انبار فروشگاه» (`PANEL_KEYS.secondaryToStore`)؛
   * سرور خودش می‌سنجد (بند ۴-۳۹ و بند ۵). قفل خاموش ⇒ لازم نیست.
   */
  toStorePassword?: string | null
}

export interface SecondaryToStoreResult {
  qty: number
  /** نام ردیف انبار مرکزی */
  name: string
  fromWarehouseName: string
  /** موجودی باقی‌ماندهٔ ردیف مبدأ */
  fromRemaining: number
  /** نام کامل کالای فروشگاه (با سایز و رنگ) */
  variantName: string
  variantCode: string
  unit: string
  /** موجودی انبار فروشگاه پیش از انتقال (می‌تواند منفی باشد) */
  storeBefore: number
  /** موجودی انبار فروشگاه پس از انتقال */
  storeAfter: number
  /**
   * چند عدد از همین انتقال، صرف جبران «کسری قبلی» (موجودی منفی) شد.
   * مثال خود مالک نرم‌افزار: موجودی ۳−، انتقال ۱۰ عدد ⇒ `shortageCovered = 3`
   * و `storeAfter = 7`.
   */
  shortageCovered: number
}

/**
 * ===========================================================================
 * جلسه ۵۴ — «کالا در انبار فروشگاه نیست، همین‌جا بسازش».
 *
 * چرا یک قرارداد جدا و نه یک فیلد اختیاری روی `SecondaryToStoreInput`: مسیر
 * «انتقال به کالای موجود» باید مو‌به‌مو ثابت بماند (ورودی‌اش `variantId` اجباری
 * است و همان هم می‌ماند). این قرارداد ورودی‌های *ساخت کالا* را اضافه می‌کند و
 * کانال خودش را دارد.
 *
 * دو حالت:
 *   • `productId` خالی  ⇒ کالای کاملاً جدید (نام اجباری).
 *   • `productId` پر    ⇒ فقط یک **واریانت تازه** (مثلاً سایز دیگر) به همان
 *     کالای موجود اضافه می‌شود، پس کالای تکراری ساخته نمی‌شود.
 * ===========================================================================
 */
export interface SecondaryToStoreNewVariantInput {
  /** ردیف مبدأ در انبار مرکزی */
  itemId: number
  qty: number
  note?: string | null
  userId?: number | null
  /** تایید آگاهانه برای انتقال بیشتر از موجودی ردیف مبدأ */
  force?: boolean

  /** پر ⇒ افزودن واریانت تازه به این کالای موجود (بدون ساخت کالای تکراری) */
  productId?: number | null
  /** کالای جدید ⇒ اجباری. حالت واریانت ⇒ نادیده گرفته می‌شود (نام کالا همان است). */
  name?: string | null
  categoryId?: number | null
  /** پیش‌فرض «عدد» */
  unit?: string | null
  size?: string | null
  color?: string | null
  /** **اجباری و بزرگ‌تر از صفر** — هم در فرم و هم در سرور بررسی می‌شود. */
  salePrice: number
  purchasePrice?: number | null
  /** کد دلخواه (معمولاً کد ردیف انبار مرکزی). تکراری ⇒ خودکار با `nextCode` جا می‌افتد. */
  code?: string | null

  /**
   * رمز قفل «انتقال به انبار فروشگاه» (`PANEL_KEYS.secondaryToStore`).
   * قفل خاموش ⇒ لازم نیست (همان سیاست موجود «قفل ماژول‌ها»).
   */
  toStorePassword?: string | null
  /**
   * جلسه ۵۵ · کار ۱ — رمز قفل **مستقل** «ساخت کالای جدید هنگام انتقال»
   * (`PANEL_KEYS.secondaryToStoreNewProduct`).
   *
   * تا جلسه ۵۴ این فیلد `productsPassword` بود و رمز *پنل کالاها* را می‌خواست؛
   * یعنی انباردار برای ساخت یک کالای تازه، کل پنل کالاها (حذف، قیمت، ورود
   * موجودی) را هم باز می‌کرد. حالا کلید و رمزش مستقل است و پنل کالاها را باز
   * نمی‌کند.
   *
   * خالی بماند ⇒ سرور همان `toStorePassword` را برای این کلید هم امتحان می‌کند،
   * چون «رمز مدیر» طبق سیاست پروژه هر پنلی را باز می‌کند. پس کاربری که رمز مدیر
   * می‌زند یک فیلد پر می‌کند، و فقط اگر برای این قفل **رمز دوم اختصاصی** تعریف
   * شده باشد لازم است این فیلد را جدا پر کند.
   */
  newProductPassword?: string | null
}

/** کالای تازه‌ساخته‌شده در انبار فروشگاه (جلسه ۵۴). */
export interface CreatedStoreVariant {
  productId: number
  variantId: number
  productName: string
  /** نام کامل با سایز و رنگ (همان چیزی که در پیام موفقیت دیده می‌شود) */
  fullName: string
  code: string
  /** کد درخواستی کاربر تکراری بود و خودکار عوض شد؟ */
  codeReplaced: boolean
  /** کدی که کاربر خواسته بود (فقط برای پیام «کد ۱۰۱ تکراری بود ⇒ ۷۱۲») */
  requestedCode: string | null
  barcode: string
  salePrice: number
  purchasePrice: number
  unit: string
  /** کالای تازه ساخته شد یا فقط یک واریانت به کالای موجود اضافه شد؟ */
  createdProduct: boolean
}

export interface SecondaryToStoreNewVariantResult extends SecondaryToStoreResult {
  created: CreatedStoreVariant
}

/** یک کالای پیشنهادیِ فروشگاه برای یک ردیف انبار مرکزی (بند ۸). */
export interface StoreMatchCandidate {
  variantId: number
  name: string
  code: string
  barcode: string
  unit: string
  stock: number
  salePrice: number
  /** چرا پیشنهاد شد: «کد یکی است» / «بارکد یکی است» / «نام یکی است» / «شبیه است» */
  reason: string
  /** ۱ = قوی‌ترین تطبیق */
  rank: number
}

/** یک ردیف تاریخچه‌ی انبار مرکزی. */
export interface SecondaryStockLogRow {
  id: number
  itemId: number | null
  warehouseId: number | null
  warehouseName: string
  action: string
  actionLabel: string
  name: string
  code: string | null
  qtyBefore: number
  qtyAfter: number
  delta: number
  note: string | null
  dateJalali: string
  time: string
}

export interface SecondaryStockLogPage {
  skip: number
  take: number
  totalCount: number
  truncated: boolean
}

export type PagedSecondaryStockLogs = SecondaryStockLogRow[] & {
  page: SecondaryStockLogPage
  warnings: string[]
}

// ---------------------------------------------------------------------------
// تعویض کالا و «بارکد اعتبار خرید بعدی» (بخش ۶)
// ---------------------------------------------------------------------------

/** یک قلم *جایگزین* که مشتری به‌جای کالای برگشتی می‌برد. */
export interface ExchangeReplacementLine {
  variantId: number
  qty: number
  /** قیمت واحد؛ خالی = قیمت فروش ثبت‌شده‌ی خود کالا */
  unitPrice?: number | null
  /** تخفیف ریالی همین قلم */
  discount?: number
  /** عوارض/مالیات همین قلم */
  tax?: number
}

/**
 * ثبت یک «تعویض کالا»: برگشت چند قلم از فاکتور اصلی + فروش چند قلم جایگزین،
 * در یک تراکنش اتمیک.
 */
export interface ExchangeSaleInput {
  /** فاکتور اصلی مشتری */
  invoiceId: number
  /** اقلام برگشتی (همان ورودی برگشت از فروش) */
  lines: { saleItemId: number; qty: number }[]
  /** اقلام جایگزین */
  replacements: ExchangeReplacementLine[]
  note?: string | null
  userId?: number | null
  /** تایید برگشت بیشتر از تعداد قابل برگشت */
  force?: boolean
  /** تایید برگشت کالای حذف‌شده از انبار */
  allowRemoved?: boolean
  /** روش پرداخت مابه‌التفاوت (وقتی مشتری باید بپردازد) */
  methodId?: number | null
  /**
   * پرداخت ترکیبیِ مابه‌التفاوت مثبت تعویض. فقط CASH + CARD با مقصدهای متناظر
   * پذیرفته می‌شود؛ هر سهم Payment مستقل می‌سازد.
   */
  splitPayment?: boolean
  payments?: { methodId: number; amount: number; destination?: string | null }[]
  /**
   * مقصد پول مابه‌التفاوت مثبت. برای نقد/کارت از `kind` روش قابل استنتاج است؛
   * روش CUSTOM بدون این فیلد رد می‌شود (همان قاعده‌ی `addPayment`).
   */
  destination?: string | null
  /** تخفیف ریالی روی سند تعویض */
  invoiceDiscount?: number
  /** عوارض و مالیات سطح سند تعویض */
  invoiceTax?: number
  /** حق سرویس سند تعویض */
  serviceCharge?: number
  /** اعتبار بارکدِ صادرشده به روز (خالی = همان مهلت کد فاکتور فروش تکی) */
  creditDays?: number | null
  /** برداشت خودکار کمبود موجودی کالای جایگزین از انبار مرکزی */
  autoCentralWithdraw?: boolean
  /**
   * جلسه ۴۹ — «برگشت کامل فاکتور» (همان معنای `ReturnSaleInput.full`).
   * `createExchange` از جلسه‌های قبل `input.full` را می‌خواند و پنل تعویض هم
   * می‌فرستد؛ فقط تایپش جا افتاده بود و چون مسیر IPC از `withUser` با تایپ
   * `any` رد می‌شود، هیچ‌وقت خطا نمی‌داد. فقط *افزایشی*: هیچ مسیری تنگ‌تر نشد.
   */
  full?: boolean
  /**
   * ------------------------ جلسه ۱۴ (بند ۱۲ سند مرجع) ------------------------
   * وقتی مابه‌التفاوت **منفی** است (ما بدهکاریم) مشتری باید *انتخاب* کند:
   *   CASH         = بازپرداخت نقدی واقعی (پول از کشو بیرون می‌رود، CashMovement)
   *   CARD         = بازپرداخت کارتی
   *   STORE_CREDIT = صدور بارکد اعتبار خرید بعدی (رفتار قدیمی)
   * بدون این فیلد **خطا** داده می‌شود؛ صدور خودکار اعتبار دیگر پیش‌فرض ضمنی نیست.
   *
   * ------------------------ جلسه ۴۶ (رفعِ بدهیِ تایپ) ------------------------
   *   CARD_TO_CARD = بازپرداخت کارت‌به‌کارت **توسط مدیر** (جلسه ۱۷ · بند ۱)؛ یک
   *   `CardTransferRequest` با وضعیت PENDING ساخته می‌شود و — از جلسه ۴۰ — کالای
   *   برگشتی تا زدن «پرداخت شد» در پنل قفل‌دار به موجودی قابل‌فروش برنمی‌گردد
   *   (`deferRestock`). این مقدار **عمداً جدا** از `CARD` است، نه حالتی از آن.
   *
   * چرا تا حالا نبود: مسیر IPC از `withUser` با تایپ `any` رد می‌شود، پس `tsc`
   * خطا نمی‌داد؛ ولی `SalesService.createExchange` (فهرست معتبرها) و
   * `SalesReturn.tsx` (state) هر دو این مقدار را داشتند و تایپ، واقعیت را
   * نمی‌گفت. اضافه‌شدنش فقط یونیون را **گسترده** می‌کند (هیچ مصرف‌کننده‌ای
   * روی این یونیون `switch` جامع ندارد) ⇒ هیچ مسیر دیگری تنگ‌تر نمی‌شود.
   */
  refundMode?: 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | null
  /**
   * تایید مدیر برای «قیمت دستیِ کالای جایگزین» (بند ۱۸).
   * بدون این رمز، قیمت کالای جایگزین همیشه از `variant.salePrice` خوانده می‌شود.
   */
  managerPassword?: string | null
  /** جلسه ۱۵ (بند ۱۷) — دلیل اجباری وقتی سند در دوره‌ی بسته‌شده ثبت می‌شود */
  overrideReason?: string | null
  /** نشست ۳۱۹ — تأیید و رمز مدیر برای بازپرداخت با کارت‌خوان (کارت) */
  cardPosOverride?: CardPosOverrideInput | null
}

/** «بارکد اعتبار خرید بعدی» آماده‌ی نمایش/چاپ. */
export interface StoreCreditRow {
  id: number
  code: string
  amount: number
  status: string
  statusLabel: string
  issuedAtJalali: string
  issuedAtTime: string
  expiresAtJalali: string | null
  expired: boolean
  /** روزهای باقی‌مانده از اعتبار (null = بدون انقضا) */
  daysLeft: number | null
  customerName: string | null
  returnId: number | null
  exchangeInvoiceId: number | null
  exchangeReceiptNo: number | null
  sourceInvoiceId: number | null
  sourceReceiptNo: number | null
  usedAtJalali: string | null
  usedAtTime: string | null
  usedInvoiceId: number | null
  usedReceiptNo: number | null
  note: string | null

  /**
   * ---------------- جلسه ۲۱ · «مدیریت اعتبار خرید» ----------------
   * همه‌ی فیلدهای بالا با همان نام و معنا سر جایشان‌اند (پنل فروش و فاکتور عمده
   * روی آن‌ها بسته شده‌اند)؛ این‌ها فقط *اضافه* شده‌اند و از `shapeStoreCredit`
   * می‌آیند، پس هیچ مصرف‌کننده‌ی قبلی نمی‌شکند.
   */
  /** EXCHANGE (ناشی از تعویض) | MANUAL (صادرشده توسط مدیریت) */
  source: string
  sourceLabel: string
  /** جمع مبلغ مصرف‌شده تا این لحظه */
  usedAmount: number
  /** amount − usedAmount (هیچ‌وقت منفی) */
  remaining: number
  usedCount: number
  maxUses: number
  usesLeft: number
  multiUse: boolean
  /** «یک‌بارمصرف» / «چندباره تا پایان مبلغ» / «چندباره (تا N بار)» */
  usesLabel: string
  customerId: number | null
  customerLocked: boolean
  /** ALL | CATEGORY | VARIANTS */
  restrictScope: string
  restrictScopeLabel: string
  restrictCategoryIds: number[]
  restrictVariantIds: number[]
  minPurchase: number
  maxPerTransaction: number
  settingsOverride: boolean
  overrideReason: string | null
  issuedDays: number | null
  holderCompany: string | null
  holderNationalId: string | null
  holderPhone: string | null
  holderAddress: string | null
  holderAgent: string | null
  holderNote: string | null
  batchId: number | null
  prefix: string | null
  /** ≥۲ ⇒ روی سند برچسب «نسخه‌ی مجدد» می‌خورد (§۱۳) */
  printCount: number
  lastPrintedAtJalali: string | null
  reminderOptOut: boolean
  reminderCount: number
  lastReminderAtJalali: string | null
  lastReminderKind: string | null
  voidedAtJalali: string | null
  voidedReason: string | null
  suspendedAtJalali: string | null
  /** Soft Delete (اعتبارِ مصرف‌شده‌ی حذف‌شده — سابقه‌ی حسابداری حفظ شده) */
  archived: boolean
  archivedAtJalali: string | null
  /** کد اصلیِ یک رکورد تاریخیِ تکراری، قبل از بی‌تصادم شدن در migration جلسه ۲۰ */
  legacyCode: string | null
  remainderCreditId: number | null
  userId: number | null
}

/**
 * ردیف امن اعتبار برای گزارش، فهرست و جزئیات عادی.
 *
 * این DTO هرگز credential قابل‌مصرف یا legacyCode را حمل نمی‌کند. `publicReference`
 * فقط شناسهٔ غیرقابل‌مصرف برای ردیابی/چاپ/Excel است؛ افشای کد فقط از مسیر جدا و
 * server-authorized مدیر انجام می‌شود.
 */
export type StoreCreditSafeRow = Omit<StoreCreditRow, 'code' | 'legacyCode'> & {
  publicReference: string
}

/** نام سازگارِ قرارداد امن تب legacy «اعتبار خرید» گزارش فروش. */
export type StoreCreditReportRow = StoreCreditSafeRow

/** یک ردیف «دفتر مصرف» (§۴ و §۱۶) — هر مصرف، مبلغ و فاکتور و کاربر خودش را دارد. */
export interface CreditRedemptionRow {
  id: number
  creditId: number
  /** شناسهٔ امن اعتبار؛ کد قابل‌مصرف در دفتر عادی نیست. */
  publicReference: string
  amount: number
  remainderAfter: number
  seq: number
  invoiceId: number | null
  receiptNo: number | null
  paymentId: number | null
  atJalali: string
  atTime: string
  userId: number | null
  userName: string | null
  idempotencyKey: string | null
  /** فاکتور مرجع بعداً برگشت/باطل شد ⇒ این مصرف برگشت خورد */
  reversed: boolean
  reversedAtJalali: string | null
  reversedReason: string | null
  note: string | null
}

/** یک رویداد Timeline صفحه‌ی جزئیات اعتبار (§۱۶) — از همان AuditLog (§۱۰). */
export interface CreditTimelineEvent {
  id: number
  action: string
  actionLabel: string
  atJalali: string
  atTime: string
  userId: number | null
  userName: string | null
  /** JSON مقدار قبل (همان ستون AuditLog) */
  before: string | null
  /** JSON مقدار بعد */
  after: string | null
  note: string | null
}

/** یک ردیف لاگ یادآوری (§۱۴) — هیچ‌کدام «ارسال واقعی» نیست. */
export interface CreditReminderLogRow {
  id: number
  creditId: number
  /** شناسهٔ امن اعتبار؛ متن پیام هم نباید credential را نگه دارد. */
  publicReference: string
  kind: string
  kindLabel: string
  status: string
  statusLabel: string
  phone: string | null
  text: string
  reason: string | null
  atJalali: string
  atTime: string
  userId: number | null
  userName: string | null
}

/** یک نامزد یادآوری + دلیل فارسیِ «باید/نباید» (§۱۴). */
export interface CreditReminderCandidateRow {
  credit: StoreCreditSafeRow
  holderName: string | null
  phone: string | null
  should: boolean
  kind: string | null
  kindLabel: string | null
  reason: string
  daysSinceIssue: number
  daysToExpiry: number | null
}

/** یک دسته‌ی تولید گروهی (§۵) — مبنای چاپ دسته‌ای PDF. */
export interface CreditBatchRow {
  id: number
  title: string
  count: number
  amountEach: number
  totalAmount: number
  createdAtJalali: string
  createdAtTime: string
  /** طول کد به‌خاطر کمبود فضا خودکار زیاد شد؟ (§۶ — باید دیده شود) */
  lengthGrown: boolean
  source: string
  note: string | null
}

/** خروجی تولید گروهی — «تعداد واقعیِ ساخته‌شده»، نه عدد خوش‌بینانه (§۵ و §۲۴). */
export interface CreditBulkResult {
  batchId: number
  title: string
  requested: number
  created: number
  amountEach: number
  totalAmount: number
  codeLength: number
  lengthGrown: boolean
  lengthMessage: string | null
  warnings: string[]
  credits: StoreCreditSafeRow[]
}

/** صفحه‌ی جزئیات یک اعتبار (§۱۶). */
export interface CreditDetail {
  credit: StoreCreditSafeRow
  redemptions: CreditRedemptionRow[]
  reminders: CreditReminderLogRow[]
  /** صفحه‌ی واقعی لاگ یادآوری؛ آرایه‌ی reminders برای callerهای قدیمی حفظ شده است. */
  remindersPage?: SaleReportPage
  remindersWarnings?: string[]
  timeline: CreditTimelineEvent[]
  /** صفحه‌ی واقعی AuditLog؛ برش سند مالی هرگز بی‌صدا نیست. */
  timelinePage?: SaleReportPage
  timelineWarnings?: string[]
  issuedByName: string | null
  batch: CreditBatchRow | null
  /** اعتبار جدیدی که باقی‌مانده‌ی این اعتبار به آن رفت (مسیر یک‌بارمصرف) */
  remainderCredit: { id: number; publicReference: string; amount: number } | null
}

/** داشبورد اعتبار خرید (§۱۵). */
export interface CreditDashboard {
  issuedCount: number
  issuedTotal: number
  usedTotal: number
  remainingTotal: number
  activeCount: number
  /** ارزش ریالی اعتبارهای فعال (باقی‌مانده‌ی واقعی) */
  activeValue: number
  unusedCount: number
  fullyUsedCount: number
  expiredCount: number
  canceledCount: number
  suspendedCount: number
  draftCount: number
  nearExpiryCount: number
  todayCount: number
  /** تعهد فروشگاه: Σ(amount − usedAmount) روی اعتبارهای زنده (§۱۵) */
  liability: number
  liabilityReported: boolean
  byStatus: { status: string; statusLabel: string; count: number; amount: number; usedAmount: number }[]
  bySource: { source: string; sourceLabel: string; count: number; amount: number; usedAmount: number }[]
}

/** نتیجه‌ی ثبت یک تعویض کالا. */
export interface ExchangeSaleResult {
  returnId: number
  /** فاکتور اصلی */
  invoiceId: number
  receiptNo: number
  /** سند تعویض */
  exchangeInvoiceId: number
  exchangeReceiptNo: number
  exchangeReturnCode: string | null
  /** مبلغ کالاهای برگشتی */
  returnTotal: number
  /** مبلغ کالاهای جایگزین (جمع کل سند تعویض) */
  exchangeTotal: number
  /** مابه‌التفاوت: مثبت = مشتری می‌پردازد · منفی = ما بدهکاریم */
  diff: number
  /** CASH | CREDIT | NONE */
  settlement: string
  settlementLabel: string
  /** اعتبار صادرشده (فقط وقتی ما بدهکار شدیم)؛ کد فقط از reveal مدیر. */
  storeCredit: StoreCreditSafeRow | null
  /** تعدادی که به موجودی فروشگاه برگشت */
  restockedQty: number
  /** هشدارهای موجودی کالای جایگزین */
  stockWarnings: string[]
  /**
   * ---- جلسه ۵۰ · مرحله ۱-ب — ردیابی برداشت از انبار مرکزی ----
   * **افزایشی محض.** رفتار برداشت عوض نشده؛ فقط تا این نسخه *ثبت و برگردانده*
   * نمی‌شد. خالی بودنشان یعنی کالای جایگزین کاملاً از انبار فروشگاه کم شد
   * (همان معنای فاکتورهای قبل از جلسه ۵۰).
   */
  centralWithdrawals?: CentralWithdrawLine[]
  centralWithdrawnQty?: number
  /** جمع برداشت به تفکیک انبار — همان چیزی که در `SaleReturn.note` هم نشست */
  centralWithdrawSources?: { name: string; qty: number }[]
  /** جمله‌ی آماده‌ی نمایش («کمبود کالای جایگزین از انبار مرکزی برداشته شد: …») */
  centralWithdrawText?: string
  dateJalali: string
  time: string
}

/** یک ردیف در تب «تعویض کالا»ی گزارشات فروش — با جزئیات کامل، دقیق به ثانیه. */
export interface ExchangeReportRow {
  returnId: number
  /** فاکتور اصلی */
  invoiceId: number
  receiptNo: number
  invoiceDateJalali: string
  returnCode: string | null
  customerName: string
  /** تاریخ و ساعت *دقیق* ثبت تعویض */
  dateJalali: string
  time: string
  shiftName: string
  userName: string
  /** اقلام برگشتی */
  returnedItems: { name: string; code: string; qty: number; unitPrice: number; lineTotal: number }[]
  returnTotal: number
  /** اقلام جایگزین */
  replacementItems: { name: string; code: string; qty: number; unitPrice: number; lineTotal: number }[]
  exchangeTotal: number
  exchangeInvoiceId: number | null
  exchangeReceiptNo: number | null
  diff: number
  settlement: string
  settlementLabel: string
  /** مابه‌التفاوتی که واقعاً نقد دریافت شد (فقط مقصد CASH). */
  cashReceived: number
  /** مابه‌التفاوتی که واقعاً با کارت دریافت شد (فقط مقصد CARD). */
  cardReceived: number
  /** شناسهٔ امن اعتبارِ صادرشده روی همین تعویض؛ کد قابل‌مصرف در گزارش نیست. */
  storeCreditReference: string | null
  storeCreditAmount: number
  storeCreditStatus: string | null
  storeCreditStatusLabel: string | null
  note: string
}

/** یک قلم داخل یک سند برگشت (نمایش در فهرست برگشت‌ها). */
export interface ReturnListItem {
  name: string
  code: string
  qty: number
  unitPrice: number
  lineTotal: number
  removedFromStock: boolean
  restockedQty: number
}

/**
 * یک ردیف فهرست «برگشت از فروش» (خروجی `sale:return:list`).
 *
 * تا این نسخه این خروجی تایپ نداشت و پنل گزارشات آن را `any[]` می‌گرفت. برای
 * مورد ۵ (جزئیات یک شیفت) تایپ شد تا مودال جزئیات شیفت با تایپ درست کار کند.
 * هیچ فیلدی کم نشده است؛ فقط `kind` / `isExchange` اضافه شده‌اند.
 */
export interface ReturnListRow {
  id: number
  /** RETURN = برگشت ساده · EXCHANGE = برگشتی که سند تعویض دارد */
  kind: string
  isExchange: boolean
  receiptNo: number | null
  returnCode: string | null
  invoiceDateJalali: string
  customerName: string
  returnedAtJalali: string
  time: string
  isFull: boolean
  total: number
  hasRemovedItems: boolean
  note: string
  qty: number
  restockedQty: number
  items: ReturnListItem[]
  /**
   * ---------------------- افزوده‌های جلسه ۱۴ (بند ۱۰ و ۱۱) ----------------------
   * ستون‌هایی که مدیر برای کنترل یک برگشت لازم دارد و تا امروز نبودند.
   */
  /** CASH | CARD | STORE_CREDIT | NONE · null = داده‌ی قدیمی */
  refundMethod: string | null
  refundMethodLabel: string
  /** مبلغی که واقعاً بازپرداخت شد */
  refundAmount: number
  /** فقط این عدد از کشوی صندوق بیرون رفته است */
  cashRefundAmount: number
  refundedAtJalali: string | null
  refundReference: string | null
  refundNote: string | null
  /** برگشت قدیمی بدون روش بازپرداخت ⇒ برچسب «فرض‌شده از داده‌ی قدیمی» */
  legacyAssumed: boolean
  /** فروشنده‌ی فاکتور اصلی (چه کسی فروخت) */
  invoiceUserName: string
  /** کاربری که برگشت را ثبت کرد (چه کسی برگرداند) */
  returnUserName: string
  /** شناسهٔ امن اعتبارِ صادرشده برای این برگشت (اگر صادر شد)؛ کد قابل‌مصرف نیست. */
  storeCreditReference: string | null
  /** مابه‌التفاوت تعویض و نحوه‌ی تسویه‌اش */
  exchangeDiff: number
  exchangeSettlement: string | null
  exchangeSettlementLabel: string | null
  shiftId: number | null
}

export interface ExchangeReportResult {
  rows: ExchangeReportRow[]
  totals: {
    count: number
    returnTotal: number
    exchangeTotal: number
    diffTotal: number
    cashReceivedTotal: number
    cardReceivedTotal: number
    creditIssuedTotal: number
    creditUsedTotal: number
  }
  page?: SaleReportPage
  warnings?: string[]
}

// ---------------------------------------------------------------------------
// مورد ۵ — «جزئیات کامل یک جلسه/شیفت بسته‌شده» (ماژول بستن صندوق)
// ---------------------------------------------------------------------------

/** ورودی `shift:detail`: یا یک شیفت مشخص، یا یک رکورد بستن صندوق. */
export interface ShiftDetailFilter {
  shiftId?: number | null
  /** رکورد «بستن صندوق»؛ شیفت و بازه‌اش از همین رکورد خوانده می‌شود */
  cashSessionId?: number | null
  /** فقط برای رکوردهای «بازه‌ای» که به هیچ شیفتی وصل نیستند */
  fromJalali?: string
  toJalali?: string
}

/** خلاصه‌ی رکورد «بستن صندوق» همان شیفت (اگر جزئیات از روی آن باز شده باشد). */
export interface ShiftDetailSession {
  id: number
  dayJalali: string
  /** ساعت بستن صندوق (HH:mm) */
  toClock: string | null
  cashTotal: number
  cardTotal: number
  creditTotal: number
  grandTotal: number
  invoiceCount: number
  countedTotal: number | null
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۵۶ — «اختلاف» یعنی اختلافِ **کشو**، نه اختلاف با جمع فروش.
   *
   * قبلاً این عدد `countedTotal − (نقد + کارت + اعتباری)` بود؛ یعنی فروش کارتی
   * را از پول فیزیکی کشو کم می‌کرد. نقد ۱٬۰۰۰٬۰۰۰ + کارت ۲٬۰۰۰٬۰۰۰ با شمارش
   * درستِ ۱٬۰۰۰٬۰۰۰ ⇒ «کسری ۲٬۰۰۰٬۰۰۰» نمایش می‌داد. حالا از `cashDifference`
   * ذخیره‌شده می‌آید — همان عددی که خودِ بستن صندوق با `expectedCash` حساب کرده
   * و لیست سابقه هم از نشست ۱۴ از آن استفاده می‌کند.
   */
  diff: number | null
  /** بند ۴-۵۶ — پول فیزیکیِ مورد انتظار کشو (پایه + نقدِ واردشده − خروجی‌ها) */
  expectedCash: number | null
  /** بند ۴-۵۶ — جمع تسویه‌ی فاکتورها (نقد + کارت + اعتباری)، که پول کشو نیست */
  settledTotal: number
  /**
   * سابقه‌های قدیمی‌تر از نشست ۱۴ عدد `cashDifference` قابل‌اعتماد ندارند.
   * به‌جای نمایش عدد مشکوک، UI باید بگوید «برای این سابقه محاسبه‌پذیر نیست».
   */
  diffAvailable: boolean
  note: string
}

/**
 * جزئیات کامل یک شیفت: همان چیزی که گزارشات فروش برای یک بازه‌ی دلخواه نشان
 * می‌دهد، ولی *قفل‌شده* روی یک شیفت مشخص — برای بررسی عملکرد هر کارمند در هر
 * شیفت، جداگانه و دقیق.
 */
export interface ShiftDetailResult {
  /** `SHIFT` = قفل روی یک شیفت · `RANGE` = رکورد بستن صندوقِ بازه‌ای (بدون شیفت) */
  scope: 'SHIFT' | 'RANGE'
  /** یک خط توضیح آماده‌ی نمایش («شیفت ۲ · ۱۴۰۵/۰۶/۲۸ · ۰۸:۰۰ تا ۱۴:۱۲») */
  scopeLabel: string
  shift: ShiftInfo | null
  session: ShiftDetailSession | null
  /** فاکتورهای فروش همین شیفت + جمع‌بندی (همان شکل گزارشات فروش) */
  sales: SaleReportResult
  /** همه‌ی برگشت‌ها و تعویض‌های ثبت‌شده در همین شیفت */
  returns: ReturnListRow[]
  /** جمع مبلغ برگشت‌های همین شیفت */
  returnsTotal: number
  /** تعویض‌های همین شیفت، با اقلام جایگزین و نحوه‌ی تسویه‌ی مابه‌التفاوت */
  exchanges: ExchangeReportResult
  /** فاکتورهای نسیه‌ی همین شیفت (باقی‌ماندهٔ بدهی > ۰) */
  creditRows: SaleReportRow[]
  /** جمع باقی‌ماندهٔ نسیه‌ی همین شیفت */
  creditTotal: number
  /**
   * مورد ۶ (نشست دهم) — پرداختی‌هایی که *در این شیفت* دریافت شده‌اند، بدون توجه
   * به تاریخ فاکتور اصلی. همین بخش است که اختلاف «جمع فروش سیستم» با «جمع واقعی
   * کارتخوان/نقدی» را توضیح می‌دهد.
   */
  shiftPayments?: ShiftPaymentRow[]
  shiftPaymentTotals?: {
    count: number
    /** جمع همه‌ی پرداختی‌های دریافت‌شده در این شیفت */
    total: number
    /** فقط آن بخشی که بابت فاکتورهای *قدیمی‌تر* از این شیفت بوده */
    priorTotal: number
    priorCount: number
    /** چک‌های ثبت‌شده‌ی پاس‌نشده‌ی همین شیفت (پول واقعی نیستند) */
    pendingChequeTotal: number
    /**
     * ------------------ کار الف (جلسه ۳۶): تفکیک بر اساس مقصد ------------------
     * جمع این چهار عدد = `total`. `managerTotal` پولی است که به حساب مدیر رفته و
     * به صندوق/کارتخوان فروشگاه نیامده؛ `unknownTotal` داده‌ی قدیمیِ بی‌مقصد است.
     */
    cashTotal: number
    cardTotal: number
    managerTotal: number
    unknownTotal: number
  }
}

/**
 * ---------------------------------------------------------------------------
 * مورد ۶ / نشست ۱۸۹ · ۱-۶ — یک پرداختی که *نشست ثبت/پاس* آن همین شیفت است
 * (`createdShiftId` / `clearedShiftId`). پنجره‌ی ساعت فقط برای ردیف قدیمیِ بی‌ستون.
 *
 * فاکتورش می‌تواند مال همین شیفت، یا مال هفته‌ها و ماه‌ها قبل باشد
 * (`fromPriorInvoice: true`) — و همان حالت دوم، دقیقاً چیزی است که پنجره‌ی
 * جزئیات شیفت تا این نسخه نشان نمی‌داد.
 * ---------------------------------------------------------------------------
 */
export interface ShiftPaymentRow {
  paymentId: number
  invoiceId: number
  receiptNo: number
  customerName: string
  /** تاریخ و ساعت صدور فاکتور اصلی (ممکن است ماه‌ها قبل باشد) */
  invoiceDateJalali: string
  invoiceTime: string
  /** تاریخ و ساعت دریافت پول (داخل بازه‌ی همین شیفت) */
  paidAtJalali: string
  paidAtTime: string
  /** مبلغ دریافتی در همین شیفت */
  amount: number
  methodLabel: string
  /** CASH = پرداخت دریافت‌شده · CHEQUE = چک */
  kind: 'CASH' | 'CHEQUE'
  /** چکِ پاس‌نشده (پول واقعی نیست و در جمع دریافتی شمرده نمی‌شود) */
  pendingCheque: boolean
  /** شماره‌ی ترتیبی پرداختی روی همان فاکتور (۱ = پرداختی اول) */
  seq: number
  grandTotal: number
  /** باقی‌ماندهٔ بدهی فاکتور، *بعد از* همین پرداختی */
  remainingAfter: number
  /** فاکتور اصلی قبل از شروع این شیفت صادر شده است؟ */
  fromPriorInvoice: boolean
  /** بند ۴-۱۹ — paidAt روزی قبل از createdAt است */
  backdated?: boolean
  /** «تسویه‌ی نسیه‌ی ۱۴۰۵/۰۴» یا «پرداختی همین شیفت» */
  label: string
  note: string | null
  /** کار الف — CARD | CASH | MANAGER · null = داده‌ی قدیمی */
  destination: string | null
  destinationLabel: string
  /** پول به کارتخوان/صندوقِ فروشگاه رسید؟ (MANAGER و «نامشخص» ⇒ false) */
  reachedStore: boolean
  /**
   * کار الف — این ردیف با *تاریخ پاس شدن* چک به این شیفت افتاده (نه با تاریخ
   * ثبتش). گزارش فروش هم همین کار را می‌کند، پس دو پنل دیگر واگرا نمی‌شوند.
   */
  byClearedAt: boolean
}

// ---------------------------------------------------------------------------
// فروش نسیه: تب «نسیه» گزارشات فروش (بخش ۷)
// ---------------------------------------------------------------------------

/** یک فاکتور بدهکار (یا تسویه‌شده‌ی همان بازه) در تب «نسیه». */
export interface CreditInvoiceRow {
  id: number
  receiptNo: number
  dateJalali: string
  time: string
  /** «پنل فروش تکی» یا «فاکتور فروش عمده» یا … */
  orderTypeLabel: string
  customerName: string
  customerPhone: string | null
  grandTotal: number
  paidTotal: number
  remaining: number
  /** UNPAID | PARTIAL | SETTLED */
  settlementState: string
  settlementLabel: string
  settled: boolean
  settledAtJalali: string | null
  /** جمع چک‌های در جریان روی این فاکتور */
  pendingChequeTotal: number
  /** تعداد پرداختی‌های ثبت‌شده */
  paymentCount: number
  /** آخرین پرداختی */
  lastPaymentJalali: string | null
  lastPaymentTime: string | null
  /** بند ۴-۸ — پرداختی با تاریخ کسب‌وکار قدیمی‌تر از روز ثبت */
  lastPaymentBackdated?: boolean
  /** جمع «مبلغ اضافه‌ی دریافتی» این فاکتور (بخش ۸) */
  overpayTotal: number
  /** چند روز از صدور فاکتور گذشته (سن بدهی) */
  ageDays: number
  shiftName: string
  userName: string
}

/**
 * یک پرداختی که *در این بازه* دریافت شده ولی فاکتورش از *قبلِ* بازه است.
 *
 * دلیل وجودش (بخش ۷ بند ۴): وقتی نسیه‌ی ماه قبل در ماه جدید تسویه می‌شود، پول
 * کارتخوانِ ماه جدید از فروش ثبت‌شده‌ی ماه جدید بیشتر می‌شود. این فهرست همان
 * اختلاف را مو‌به‌مو توضیح می‌دهد.
 */
export interface CreditSettlementRow {
  paymentId: number
  invoiceId: number
  receiptNo: number
  customerName: string
  /** تاریخ/ساعت دریافت پول (داخل بازه‌ی گزارش) */
  paidAtJalali: string
  paidAtTime: string
  amount: number
  methodLabel: string
  kind: 'CASH' | 'CHEQUE'
  /** تاریخ فاکتور (قبل از بازه‌ی گزارش) */
  invoiceDateJalali: string
  /** «تسویه‌ی نسیه‌ی ماه قبل» یا «تسویه‌ی نسیه‌ی ۱۴۰۵/۰۴» */
  label: string
  /** فاکتور بعد از این پرداختی کامل تسویه شد؟ */
  settledInvoice: boolean
  overpayAmount: number
}

export interface CreditReportResult {
  rows: CreditInvoiceRow[]
  /** پرداختی‌های همین بازه بابت فاکتورهای بازه‌های قبل */
  priorSettlements: CreditSettlementRow[]
  totals: {
    count: number
    grandTotal: number
    paidTotal: number
    remainingTotal: number
    unpaidCount: number
    partialCount: number
    settledCount: number
    pendingChequeTotal: number
    overpayTotal: number
    /** جمع پرداختی‌های این بازه بابت نسیه‌ی بازه‌های قبل */
    priorSettlementTotal: number
    /** نشست ۱۱۷ — تعداد واقعی همان پرداختی‌ها روی کل بازه (نه فقط ردیف‌های نمایشی) */
    priorSettlementCount?: number
  }
  /** نشست ۱۱۷ — صفحه‌ی ردیف‌های فاکتور (جمع‌ها روی کل بازه‌اند) */
  page?: SaleReportPage
  /** نشست ۱۱۷ — صفحه‌ی ردیف‌های وصول نسیه‌ی دوره‌ی قبل */
  priorPage?: SaleReportPage
  /** هشدارهای فارسی برش نمایش */
  warnings?: string[]
}

// ---------------------------------------------------------------------------
// وضعیت «قفل موقت» یک گیت ورود رمز (بخش ۲)
// ---------------------------------------------------------------------------

export interface PanelGateStatus {
  gate: string
  gateTitle: string
  /** همین حالا قفل است؟ */
  locked: boolean
  /** ثانیه‌های باقی‌مانده از قفل (۰ = قفل نیست) */
  remainingSeconds: number
  lockedUntilIso: string | null
  /** تعداد رمز اشتباهِ پشت‌سرهم تا این لحظه */
  failCount: number
  /** چند تلاش ناموفق تا قفل شدن */
  maxAttempts: number
  /** مدت قفل به دقیقه */
  lockMinutes: number
  /** قفل موقت در تنظیمات فعال است؟ */
  enabled: boolean
}

/**
 * یک برداشت انجام‌شده از «انبار مرکزی» برای پوشش کمبود موجودی فروشگاه (مورد ۳).
 * فقط برای نمایش در هشدار زرد پنل فروش استفاده می‌شود.
 */
export interface CentralWithdrawLine {
  variantId: number
  /** نام کامل کالای فروشگاه */
  name: string
  unit: string
  /** کمبود موجودی همین کالا (تعداد درخواستی منهای موجودی فروشگاه) */
  shortage: number
  /** تعدادی که واقعاً از انبار مرکزی برداشته و به انبار فروشگاه منتقل شد */
  taken: number
  /** کمبود پوشش‌داده‌نشده (انبار مرکزی هم نداشت) */
  missing: number
  /**
   * ردیف‌های انبار مرکزی که از آن‌ها کسر شد.
   *
   * جلسه ۴۸ — `warehouseId` / `warehouseName` اضافه شد تا «از کدام انبار برداشته
   * شد» در نتیجه‌ی فروش هم قابل خواندن باشد، نه فقط در متن هشدار. طبق قاعده‌ی
   * نهایی مالک، برداشت خودکار فقط از **انبار مرکزی پیش‌فرض** است، پس
   * `warehouseId` همیشه `null` (ردیف‌های بی‌انبار) یا شناسه‌ی همان ردیف واقعیِ
   * `isDefault` است — هیچ‌وقت یک انبار شعبه.
   */
  sources: {
    id: number
    name: string
    taken: number
    remaining: number
    warehouseId: number | null
    warehouseName: string
  }[]
  /** نام انبار مبدأ برداشت خودکار (همیشه انبار مرکزی پیش‌فرض) */
  warehouseName: string
}

/** یک مشتری در «بانک شماره مشتریان» پنل تنظیمات (مورد ۶). */
export interface CustomerDirectoryRow {
  id: number
  code: string
  name: string
  phone: string | null
  address: string | null
  isDefault: boolean
  /** مشتری عمده (ثبت‌شده از پنل فاکتور فروش عمده) یا مشتری تکی (پنل فروش) */
  isWholesale: boolean
  createdAtJalali: string
  /** تعداد فاکتورهای ثبت‌شده به نام این مشتری */
  invoiceCount: number
  /**
   * جمع خرید *خالص* این مشتری از روی فاکتورهای ثبت‌شده (ریال).
   * نشست ۱۱۵ (S115-3): فقط فاکتورهای معتبر (نه DRAFT/CANCELED، نه باطل) منهای
   * برگشت‌های باطل‌نشده.
   */
  invoiceTotal: number
  /** نشست ۱۱۵ — جمع برگشت‌های باطل‌نشده‌ی این مشتری (ریال)؛ اختیاری برای سازگاری */
  returnedTotal?: number
  /** مبلغ خریدی که مدیر دستی برای این مشتری ثبت کرده است (ریال) */
  manualPurchaseTotal: number
  /** «جمع خرید» نمایشی = جمع فاکتورها + مبلغ دستی (ریال) */
  totalBought: number
  /** آخرین خرید (تاریخ شمسی) */
  lastBuyJalali: string | null
}

/** نوع مشتری برای فیلتر کردن فهرست‌ها (مورد ۶). */
export type CustomerKind = 'all' | 'retail' | 'wholesale'

/** فیلترهای «پنل مشتریان» تنظیمات (مورد ۳ و ۶). */
export interface CustomerDirectoryFilter {
  search?: string
  onlyWithPhone?: boolean
  /** all = همه · retail = فقط مشتری تکی · wholesale = فقط مشتری عمده */
  kind?: CustomerKind
  /** حداقل «جمع خرید» (ریال) — برای انتخاب مشتریان قرعه‌کشی */
  minTotal?: number
  take?: number
  /** نشست ۱۱۵ · بند ۴-۴۶ — شروع صفحه */
  skip?: number
}

/** ورودی ثبت/ویرایش دستی مشتری از پنل مشتریانِ تنظیمات (مورد ۳). */
export interface CustomerSaveInput {
  /** خالی = ثبت مشتری جدید */
  id?: number | null
  name?: string
  phone?: string | null
  address?: string | null
  /** true = مشتری عمده · false = مشتری تکی */
  isWholesale?: boolean
  /** مبلغ خرید دستی (ریال) */
  manualPurchaseTotal?: number
  userId?: number | null
}

/** نتیجه‌ی حذف یک مشتری (مورد ۳). */
export interface CustomerDeleteResult {
  /** حذف انجام شد؟ false = نیاز به تایید آگاهانه (`force`) دارد */
  deleted: boolean
  /** تعداد فاکتورهایی که به این مشتری وصل بودند */
  invoiceCount: number
  /** فاکتورهایی که با حذف مشتری به «مشتری عمومی» منتقل شدند */
  detachedInvoices: number
  name: string
  message: string
}

/**
 * پیش‌نمایش «حذف همیشگی» یک کالا از سطل آشغال (مورد ۸).
 * هیچ داده‌ای را تغییر نمی‌دهد؛ فقط می‌گوید چه سابقه‌ای به این کالا وصل است.
 */
export interface VariantPurgeLine {
  variantId: number
  code: string
  name: string
  stock: number
  /** تعداد ردیف فاکتورهای فروش که به این کالا اشاره می‌کنند */
  saleItems: number
  /** تعداد ردیف فاکتورهای خرید */
  purchaseItems: number
  /** تعداد ردیف برگشت از فروش */
  returnItems: number
  /** تعداد حرکات انبار؛ وجود هر حرکت حذف همیشگی را مسدود می‌کند */
  movements: number
  /** نشست ۱۷۸ (S178-D4) — مانع حذف همیشگی همین ردیف (فعال/مهلت ۷۳۰ روز/حرکت انبار)؛ null یعنی مانعی نیست */
  blockedReason?: string | null
}

export interface VariantPurgePreview {
  lines: VariantPurgeLine[]
  /** جمع ردیف‌های سابقه‌ای که «نام و کدشان» داخل خود ردیف نگه داشته می‌شود */
  historyRows: number
  /** جمع حرکات انباری که مانع حذف همیشگی‌اند */
  movements: number
  /** نشست ۱۷۸ (S178-D4) — پیش‌نمایش = عملیات: فقط وقتی true که purge همین انتخاب انجام‌شدنی باشد */
  canPurge?: boolean
  /** پیام‌های فارسی مانع حذف (همان شرط‌های purge) */
  blockers?: string[]
  /** یادداشت‌های غیرمانع (مثلاً شناسه‌ی پیدانشده) */
  notices?: string[]
}

export interface VariantPurgeResult {
  /** تعداد کالاهایی که واقعاً از دیتابیس پاک شدند */
  deleted: number
  /** ردیف‌های سابقه‌ای که نام/کد کالا داخلشان snapshot شد */
  snapshots: number
  /** برای سازگاری با caller قدیمی؛ پس از رفع همیشه صفر است چون ledger پاک نمی‌شود */
  movements: number
  /** آیا در این اجرا، کلید خارجی سطح دیتابیس هم برداشته شد (یک‌بار برای همیشه) */
  schemaAdjusted: boolean
  names: string[]
}

export interface CashCloseInput {
  shiftId?: number | null
  /** بستن صندوق روی بازه‌ی دلخواه (اگر شیفت مشخص نشده) */
  fromJalali?: string
  toJalali?: string
  userId?: number | null
  note?: string
  /** مبلغ شمرده‌شده‌ی صندوق (اختیاری، فقط برای سابقه) */
  countedTotal?: number
  /** با بستن صندوق، شیفت جاری هم بسته شود (پایان شیفت) */
  closeShift?: boolean
  /**
   * کاربر خودش یک شیفت مشخص را از فیلتر پنل انتخاب کرده است (مورد ۴).
   *
   * false/undefined = «شیفت جاری»؛ در حالت «تعیین شیفت بر اساس ساعت»، شیفت از
   * *ساعت لحظه‌ی بستن صندوق* تعیین می‌شود تا بستن صندوق ساعت ۱۶ هیچ‌وقت به نام
   * شیفت صبح ثبت نشود. true = همان شیفتِ انتخابیِ کاربر، بدون دخالت زمان‌بندی.
   */
  explicitShift?: boolean
  /**
   * ------------------------ جلسه ۱۴ (بند ۱۶ سند مرجع) ------------------------
   * موجودی اول صندوق در ابتدای شیفت. بدون این عدد «کسری واقعی» از نظر
   * حسابداری قابل تشخیص نیست: نمی‌دانیم صندوق با چند شروع شده است.
   * خالی = از `CashMovement(OPENING_FLOAT)` همان شیفت خوانده می‌شود.
   */
  openingFloat?: number | null
  /** پول نقد *شمرده‌شده‌ی* داخل کشو (فقط نقد فیزیکی، نه کارت/چک/اعتبار) */
  countedCash?: number | null
  /** آستانه‌ی اجبار یادداشت؛ خالی = مقدار تنظیمات (پیش‌فرض ۱۰۰٬۰۰۰ ریال) */
  differenceThreshold?: number | null
  /**
   * بند ۴-۴۷ — اجرای دوم بستن صندوق باید با تأیید صریح کاربر انجام شود.
   * این پرچم فقط اجازه‌ی ثبت snapshot مستقل و Audit تازه را می‌دهد؛
   * هیچ اثر نقدی یا انباری دوباره اعمال نمی‌شود.
   */
  allowRepeatClose?: boolean
}

// ---------------------------------------------------------------------------
// تجمیع و انتقال
// ---------------------------------------------------------------------------

export interface ConsolidationDay {
  dayJalali: string
  state: 'EMPTY' | 'PENDING' | 'DONE' | 'PARTIAL'
  stateLabel: string
  invoiceCount: number
  pendingInvoiceCount: number
  /** تعداد حرکات انبار موقت (PENDING) آن روز */
  pendingMovements: number
  goodsTotal: number
  grandTotal: number
  receivedTotal: number
  /** جمع تعداد کالاهایی که با تجمیع، قطعی (کسر نهایی) می‌شوند */
  pendingQty: number
  consolidationIds: number[]
  finalizedAtJalali: string | null
  /** بخش ۳ — ساعت قطعی‌شدن تجمیع (HH:MM). null = هنوز تجمیع نشده. */
  finalizedAtTime: string | null
  shiftCount: number
}

export interface ConsolidationDaysResult {
  days: ConsolidationDay[]
  pendingDays: string[]
  totals: {
    days: number
    pending: number
    done: number
    grandTotal: number
    pendingQty: number
  }
}

export interface DateRange { from: string; to: string } // ISO

export interface ApiResult<T> { ok: true; data: T } 
export type ApiError = { ok: false; error: string }


// ---------------------------------------------------------------------------
// بکاپ / بازگردانی / سبک‌سازی
// ---------------------------------------------------------------------------

/** یک فایل بکاپ قابل بازگردانی (خودکار روزانه یا واردشده توسط کاربر). */
export interface BackupEntry {
  /** شناسه‌ی پایدار (نام فایل داخل پوشه‌ی برنامه) */
  id: string
  /** نام فایل اصلی که کاربر انتخاب کرده */
  fileName: string
  /** مسیر کامل فایل روی دیسک */
  path: string
  /** حجم فایل به بایت */
  size: number
  /** تاریخ شمسی + ساعت ساخت/ورود فایل */
  atJalali: string
  at: string
  /** auto = بکاپ خودکار روزانه · imported = فایلی که کاربر آپلود کرده */
  source: 'auto' | 'imported'
  /** آخرین باری که همین فایل روی داده‌ی فعلی اعمال شد */
  appliedAt?: string | null
  appliedMode?: 'replace' | 'merge' | null
  /** خلاصه‌ی محتوای فایل (تعداد فاکتور/کالا/بازه‌ی تاریخ) اگر خوانده شده باشد */
  summary?: BackupSummary | null
  /** فایل روی دیسک هنوز وجود دارد؟ */
  missing?: boolean
}

export interface BackupSummary {
  invoiceCount: number
  itemCount: number
  productCount: number
  variantCount: number
  returnCount: number
  purchaseCount: number
  movementCount: number
  firstJalali: string | null
  lastJalali: string | null
  grandTotal: number
}

/** گزارش ادغام یک بکاپ با داده‌ی فعلی. */
export interface MergeReport {
  fileName: string
  /** تعداد رکوردهای *افزوده‌شده* به هر جدول */
  inserted: Record<string, number>
  /** رکوردهایی که با داده‌ی فعلی یکی شناخته شدند (دوباره ساخته نشدند) */
  matched: Record<string, number>
  /** شماره‌ی فیش/فاکتورهایی که به‌خاطر برخورد، شماره‌ی جدید گرفتند */
  renumbered: { invoices: number; purchases: number; firstReceiptNo: number | null; lastReceiptNo: number | null }
  /** هشدارهای فارسی (بارکد تکراری با نام متفاوت، کد تکراری و ...) */
  warnings: string[]
  ms: number
}

/** پیش‌نمایش «آرشیو و پاک‌سازی» یک بازه‌ی قدیمی. */
export interface MaintenancePreview {
  beforeJalali: string
  /** حداقل سن مجاز برای حذف فیزیکی اسناد */
  retentionDays: number
  /** تاریخ مرزی که cutoff باید برابر آن یا قدیمی‌تر باشد */
  minimumCutoffJalali: string
  saleInvoices: number
  saleItems: number
  saleReturns: number
  purchaseInvoices: number
  /** تعداد ردیف‌های قدیمی ledger که عمداً حفظ می‌شوند؛ هرگز حذف نمی‌شوند */
  stockMovements: number
  /** ردیف‌های لاگ که *واقعاً* پاک می‌شوند (سابقه‌ی محافظت‌شده در این عدد نیست) */
  auditLogs: number
  /**
   * بند ۸ · §۱۰ (جلسه ۳۱) — ردیف‌های لاگِ قدیمی که «سابقه‌ی محافظت‌شده»اند و
   * پاک نمی‌شوند (اعتبار خرید: `StoreCredit*` و actionهای `CREDIT_*`).
   * عمداً در پیش‌نمایش نشان داده می‌شود تا کاربر بداند چرا عدد حذف کمتر از
   * تعداد کل لاگ‌های آن بازه است.
   */
  auditLogsProtected: number
  cashSessions: number
  consolidations: number
  /** نشست ۱۷۸ (S178-D1) — تجمیع قدیمیِ وصل به دفتر گردش انبار که حذف نمی‌شود */
  consolidationsRetained: number
  shifts: number
  /** جمع کل فروشِ بازه‌ای که پاک می‌شود (برای دیدن اندازه‌ی کاری که می‌کنید) */
  grandTotal: number
}

export interface MaintenanceResult extends MaintenancePreview {
  backupPath: string | null
  /** حجم فایل دیتابیس قبل و بعد (بایت) */
  sizeBefore: number
  sizeAfter: number
  vacuumed: boolean
  /**
   * بند ۸ · §۱۰ (جلسه ۳۱) — پاک‌سازی لاگ واقعاً انجام شد؟
   * `false` یعنی یا کاربر تیکش را برداشته بود، یا رمز مدیر نیامد/غلط بود
   * (در این حالت `warnings` می‌گوید چرا). بقیه‌ی مراحل مستقل از این انجام شده‌اند.
   */
  auditPurged: boolean
  /** هشدارهای مرحله‌های ردشده (خالی = همه‌چیز طبق درخواست انجام شد) */
  warnings: string[]
}

/** وضعیت «وزن» دیتابیس برای پنل سبک‌سازی. */
export interface DbStats {
  file: string
  size: number
  freeBytes: number
  tables: { name: string; rows: number }[]
}

// ---------------------------------------------------------------------------
// بند ۴ — ماژول «تخفیف و افزایش/کاهش قیمت» (تغییر گروهی قیمت کالاها)
// ---------------------------------------------------------------------------

/**
 * یک درخواست تغییر گروهی قیمت.
 *
 * `scope` تعیین می‌کند کدام فیلدهای بعدی خوانده می‌شوند:
 *   ALL      ⇒ هیچ‌کدام (همه‌ی کالاهای فعال)
 *   CATEGORY ⇒ `categoryId` (خودِ دسته + همه‌ی زیردسته‌هایش، در هر عمقی)
 *   VARIANTS ⇒ `variantIds` (فقط همان کالاهای تیک‌خورده)
 */
export interface PriceAdjustInput {
  kind: 'DISCOUNT' | 'INCREASE' | 'DECREASE'
  mode: 'PERCENT' | 'AMOUNT'
  value: number
  scope: 'ALL' | 'CATEGORY' | 'VARIANTS'
  categoryId?: number | null
  variantIds?: number[] | null
  /** قیمت فروش (پیش‌فرض) یا قیمت خرید */
  target?: 'SALE' | 'PURCHASE'
  /** رُند کردن قیمت نهایی (۱ = بدون رُند) */
  round?: number
  /** کف قیمت؛ کالای زیر کف با «کاهش» لمس نمی‌شود */
  minPrice?: number
  /** توضیح آزاد مدیر («حراج پایان فصل») — روی سابقه ثبت می‌شود */
  note?: string | null
  userId?: number | null
  /** نشست ۱۵۰ · بند ۴-۳۹ — رمز مدیر یا رمز دوم پنل «تغییر قیمت گروهی» (گیت main؛ preview نادیده می‌گیرد) */
  password?: string | null
  // ------------------------------------------------------------------------
  // نشست دهم — مورد ۱: زمان‌بندی خودکار (هر چهار فیلد اختیاری).
  // خالی بودنشان = رفتار مو‌به‌موی قبل: همین حالا اعمال شود و تا «بازگردانی»
  // دستی بماند.
  // ------------------------------------------------------------------------
  /** تاریخ شمسی شروع (yyyy/MM/dd) — خالی = همین حالا */
  startDate?: string | null
  /** ساعت شروع (HH:mm) — خالی = ۰۰:۰۰ همان روز */
  startTime?: string | null
  /** تاریخ شمسی پایان — خالی = بی‌پایان */
  endDate?: string | null
  endTime?: string | null
}

/** یک کالا در پیش‌نمایش یا در سابقه‌ی یک تغییر گروهی. */
export interface PriceAdjustLine {
  variantId: number
  name: string
  code: string
  barcode: string
  categoryName: string
  oldPrice: number
  newPrice: number
  /** newPrice − oldPrice (منفی = ارزان‌تر شد) */
  delta: number
  /** درصد تغییر واقعی نسبت به قیمت قبلی (برای ستون راهنما) */
  percent: number
  /** این ردیف عملاً تغییری نمی‌کند (قیمت صفر، زیر کف، یا مقدار صفر) */
  unchanged: boolean
  /** اگر لمس نشد، دلیلش */
  skipReason?: string | null
}

export interface PriceAdjustPreview {
  /** متن خوانای همان کاری که قرار است انجام شود */
  title: string
  scopeLabel: string
  targetLabel: string
  /** همه‌ی کالاهای در دامنه (شامل ردیف‌های بی‌تغییر، تا مدیر بداند چه لمس نمی‌شود) */
  lines: PriceAdjustLine[]
  /** تعداد کالاهای در دامنه */
  count: number
  /** تعداد کالاهایی که واقعاً قیمتشان عوض می‌شود */
  changedCount: number
  oldTotal: number
  newTotal: number
  /** newTotal − oldTotal */
  deltaTotal: number
  /** هشدارهای فارسی (مثلاً «۳ کالا قیمتشان صفر است و لمس نمی‌شوند») */
  warnings: string[]
}

export interface PriceAdjustResult {
  batchId: number
  changedCount: number
  deltaTotal: number
  title: string
  /** متن پیام موفقیت، آماده‌ی نمایش */
  message: string
}

/** یک «دسته تغییر قیمت» ثبت‌شده (سابقه‌ی ماژول + مبنای بازگردانی). */
export interface PriceAdjustBatchRow {
  id: number
  kind: string
  kindLabel: string
  mode: string
  value: number
  target: string
  targetLabel: string
  scope: string
  scopeLabel: string
  categoryName: string | null
  title: string
  note: string | null
  /** تعداد کالاهایی که در این دسته قیمتشان عوض شد */
  itemCount: number
  deltaTotal: number
  dateJalali: string
  time: string
  /** این دسته قبلاً بازگردانی شده است؟ */
  reverted: boolean
  revertedAtJalali: string | null
  /**
   * بازگردانی همین حالا امکان‌پذیر است؟ (بازگردانی‌شده نیست و کالاهایش هنوز
   * هستند). اگر بعد از این دسته، دسته‌ی جدیدتری روی همان کالاها اجرا شده باشد،
   * `revertWarning` می‌گوید بازگردانی، آن تغییر جدیدتر را هم پاک می‌کند.
   */
  canRevert: boolean
  revertWarning: string | null

  // ------------------------------------------------------------------------
  // نشست دهم — مورد ۱ (زمان‌بندی) و مورد ۲ (ویرایش سابقه)
  // ------------------------------------------------------------------------
  /** SCHEDULED | APPLIED | ENDED | REVERTED */
  state: string
  /** برچسب فارسی همان وضعیت، آماده‌ی نمایش در ستون «وضعیت» */
  stateLabel: string
  /** زمان‌بندی شروع/پایان (null = بدون زمان‌بندی) */
  startAtJalali: string | null
  startAtTime: string | null
  endAtJalali: string | null
  endAtTime: string | null
  /** یک خط خوانا از کل زمان‌بندی («از ۱۴۰۵/۰۶/۲۸ ساعت ۰۸:۰۰ تا …») */
  scheduleLabel: string | null
  /** هنوز شروع نشده (قیمتی عوض نشده است) */
  scheduled: boolean
  /** زمان‌بند، شروعش را خودکار انجام داد */
  autoStarted: boolean
  /** زمان‌بند، پایانش را خودکار انجام داد */
  autoEnded: boolean
  /** دامنه‌ی این دسته قابل ویرایش است؟ (فقط زمان‌بندی‌شده یا در جریان) */
  canEdit: boolean
  /** چند بار دامنه‌اش ویرایش شده و آخرین بار کِی */
  editCount: number
  editedAtJalali: string | null
  /** کالاهای انتخابی (فقط برای دسته‌ی زمان‌بندی‌شده‌ی scope = VARIANTS) */
  variantIds: number[] | null
}

/**
 * ---------------------------------------------------------------------------
 * مورد ۲ — ویرایش دامنه‌ی یک دسته‌ی ثبت‌شده.
 *
 * فقط *دامنه* عوض می‌شود، نه فرمول: کالاهایی که از دامنه بیرون می‌افتند به
 * قیمت «قبل از همین دسته» برمی‌گردند و کالاهایی که تازه وارد دامنه می‌شوند با
 * همان قاعده‌ی خودِ دسته قیمت می‌گیرند. کالاهایی که در دامنه می‌مانند
 * **دست‌نخورده** می‌مانند (نه دوباره تخفیف می‌خورند، نه قیمتشان جابه‌جا می‌شود).
 * ---------------------------------------------------------------------------
 */
export interface PriceAdjustEditInput {
  batchId: number
  scope: 'ALL' | 'CATEGORY' | 'VARIANTS'
  categoryId?: number | null
  variantIds?: number[] | null
  userId?: number | null
  /** نشست ۱۵۰ · بند ۴-۳۹ — گیت main */
  password?: string | null
}

export interface PriceAdjustEditResult {
  batchId: number
  /** کالاهایی که از دامنه بیرون رفتند و قیمتشان به قبل برگشت */
  removedCount: number
  /** کالاهایی که تازه وارد دامنه شدند و قیمتشان عوض شد */
  addedCount: number
  /** کالاهایی که در دامنه ماندند و لمس نشدند */
  keptCount: number
  itemCount: number
  deltaTotal: number
  title: string
  message: string
}

/**
 * مورد ۲ — حذف یک یا چند ردیف سابقه.
 * `restorePrices` همان پرسش صریحِ خودِ کاربر است: «حذف سابقه، قیمت کالاها را هم
 * برمی‌گرداند یا فقط ردیف پاک شود؟»
 */
export interface PriceAdjustDeleteInput {
  batchIds: number[]
  /** true = اول قیمت‌ها به حالت قبل برگردند، بعد ردیف سابقه پاک شود */
  restorePrices: boolean
  userId?: number | null
  /** نشست ۱۵۰ · بند ۴-۳۹ — گیت main */
  password?: string | null
}

export interface PriceAdjustDeleteResult {
  deletedCount: number
  /** چند کالا قیمتشان به حالت قبل برگشت (۰ اگر فقط ردیف پاک شده باشد) */
  restoredCount: number
  message: string
}

/**
 * ---------------------------------------------------------------------------
 * مورد ۱ (بخش دوم) — «تخفیف گروهیِ در جریان» یک کالا، برای *نمایش* در پنل فروش.
 *
 * تفاوت «تخفیف» و «کاهش قیمت» از نظر مشتری فقط یک چیز است: مشتری باید ببیند
 * قیمت قبلی چه بود و چقدر تخفیف خورده. قیمت کالا واقعاً پایین آمده است
 * (`ProductVariant.salePrice`)، پس این رکورد هیچ عددی را عوض نمی‌کند و فقط
 * می‌گوید «این قیمت، نتیجه‌ی این تخفیف است».
 * ---------------------------------------------------------------------------
 */
export interface ActiveDiscountInfo {
  variantId: number
  /** قیمت قبل از تخفیف‌های در جریان (قیمت پایه) */
  basePrice: number
  /** قیمت فعلی کالا (همان چیزی که در فاکتور می‌نشیند) */
  salePrice: number
  /** basePrice − salePrice (همیشه مثبت) */
  discountAmount: number
  /** درصد تخفیف نسبت به قیمت پایه، یک رقم اعشار */
  discountPercent: number
  /** «۱۰٪ تخفیف» یا «۵۰٬۰۰۰ ریال تخفیف» (برچسب آماده‌ی نمایش) */
  label: string
  /** شرح دسته(های) تخفیفی که این قیمت را ساخته‌اند */
  batchTitles: string[]
  /** اگر زمان‌بندی پایان دارد: «تا ۱۴۰۵/۰۷/۰۱ ساعت ۲۳:۵۹» */
  endsLabel: string | null
}

export interface PriceAdjustRevertResult {
  batchId: number
  restoredCount: number
  deltaTotal: number
  message: string
}


// ---------------------------------------------------------------------------
// جلسه ۱۵ — دفتر رویداد (تب جزئیات فروش) و قفل دوره‌ی بسته‌شده
// ---------------------------------------------------------------------------

/**
 * یک «رویداد» در دفتر رویداد گزارشات فروش.
 *
 * سه ستون تصمیم‌ساز دارد که تا امروز هیچ جای گزارش نبودند:
 *   • `eventType` — این ردیف چه نوع رویدادی است (فروش، برگشت، تعویض، …)
 *   • `cashEffect` — اثر واقعی روی پول: + آمد · − رفت · ۰ هیچ پولی جابه‌جا نشد
 *   • `stockEffect` — اثر واقعی روی موجودی انبار: + برگشت · − خارج شد
 */
export interface SaleLedgerRow {
  /** کلید یکتای ردیف (نوع + شناسه) — فقط برای React */
  key: string
  eventType:
    | 'SALE'
    | 'RETURN'
    | 'EXCHANGE_RETURNED'
    | 'EXCHANGE_REPLACEMENT'
    | 'STORE_CREDIT_USED'
    | 'CREDIT_SETTLEMENT'
    | 'CHEQUE_CLEARED'
  eventLabel: string
  dateJalali: string
  time: string
  receiptNo: number | null
  /** عنوان خوانای سند مبدأ («فاکتور فروش ۱۲۳» / «سند تعویض ۴۵۶» / …) */
  documentLabel: string
  customerName: string
  userName: string
  shiftName: string
  /** مبلغ خودِ سند (تعهدی) */
  amount: number
  /** اثر روی پول واقعی؛ مثبت = ورود، منفی = خروج، صفر = بی‌اثر */
  cashEffect: number
  /** توضیح یک‌خطی «چرا این عدد اثر نقدی دارد یا ندارد» */
  cashNote: string
  /** اثر روی موجودی انبار (تعداد) */
  stockEffect: number
  invoiceId: number | null
  sourceId: number | null
  sourceKind: string
  note: string
}

export interface SaleLedgerResult {
  period: SaleReportPeriod
  rows: SaleLedgerRow[]
  /**
   * شمارش واقعی هر بخش پیش از سقف نمایشی. خود `rows` برای سازگاری قدیمی
   * همچنان فقط ردیف‌های قابل‌نمایش را دارد، اما این متادیتا دیگر اجازه نمی‌دهد
   * برش ۴۰۰۰تایی با «کل داده» اشتباه شود.
   */
  sections: {
    invoices: SaleReportPage
    returns: SaleReportPage
    priorSettlements: SaleReportPage
    clearedCheques: SaleReportPage
    storeCreditsUsed: SaleReportPage
  }
  totals: {
    count: number
    amount: number
    cashIn: number
    cashOut: number
    netCash: number
    stockIn: number
    stockOut: number
  }
  warnings: string[]
  notes: string[]
}

/**
 * وضعیت «قفل دوره» یک تاریخ (بند ۱۷).
 *
 * `locked` = این تاریخ در دوره‌ی بسته‌شده است (صندوق بسته یا روز تجمیع‌شده).
 * `enforced` = همان، *و* سیاست حسابداری قفل را روشن گذاشته ⇒ گیت مدیر لازم است.
 */
export interface PeriodLockStatus {
  dayJalali: string
  locked: boolean
  enforced: boolean
  policyOn: boolean
  /** تاریخ، روزی پیش از امروز است (ثبت با تاریخ گذشته) */
  backdated: boolean
  reasons: string[]
  cashSessionId: number | null
  consolidationId: number | null
}

/**
 * ===========================================================================
 * جلسه ۱۶ · بند ۵ — «هیچ گزارشی بی‌صدا ناقص نمی‌شود».
 *
 * برای هر مجموعه‌ی داده‌ی گزارش، سه عدد کنار هم: تعداد کل واقعیِ بازه (`total`،
 * با `count()` روی کل بازه و نه روی صفحه)، سقف خواندنِ همان مجموعه (`cap`)، و
 * این‌که آیا سقف خورده است (`truncated`). پنل با همین‌ها نوار قرمز
 * «نمایش N از M ردیف» را می‌سازد.
 * ===========================================================================
 */
export interface SaleReportLimitRow {
  /** کلید تب: invoices | items | returns | exchanges | cheques | storeCredits */
  key: string
  label: string
  /** تعداد کل واقعی ردیف‌های این مجموعه در همین بازه و با همین فیلترها */
  total: number
  /** سقف خواندن سرور برای همین مجموعه */
  cap: number
  truncated: boolean
  /** توضیح فارسی، آماده‌ی نمایش در نوار هشدار */
  note: string
}

export interface SaleReportLimits {
  fromJalali: string | null
  toJalali: string | null
  /** بازه از کجا آمد: انتخاب کاربر، شیفت، یا خودِ ردیف‌ها */
  periodSource: 'explicit' | 'shift' | 'rows' | 'today' | 'none'
  rows: SaleReportLimitRow[]
  warnings: string[]
}

/**
 * ===========================================================================
 * جلسه ۴۱ · کار ب — «کالای برگشتیِ در انتظار تأیید مدیر» روی سیم.
 *
 * تعریف، فرمول و متن‌ها همه در `src/shared/pendingRestock.ts` هستند و همان‌جا
 * می‌مانند (تنها منبع حقیقت). اینجا فقط **دوباره صادر** می‌شوند تا صفحه‌هایی که
 * عادت دارند تایپ پاسخ IPC را از `@shared/types` بگیرند، مجبور به ساختن یک شکل
 * موازی نشوند. یک `export type` خالص است، پس هیچ import زمان‌اجرایی به
 * `types.ts` اضافه نمی‌کند.
 *
 * پاسخ کانال `pendingRestock:summary` = `PendingRestockSummary`.
 * ===========================================================================
 */
export type { PendingRestockItem, PendingRestockSummary } from './pendingRestock'


/**
 * ===========================================================================
 * نشست ۳۱۸-۱ · نمای تشخیص پل تطبیق (طرح برنده «کامیلا») — DTOهای IPC.
 *
 *   • نشان (BridgeDiagFlag) فقط خواص نمایشی است؛ همیشه «TENTATIVE» و هرگز در
 *     حسابِ گزارش اثر ندارد. منطق ساختنش در src/shared/bridgeDiagnostics.ts است.
 *   • BridgeDiagRow ≈ SaleBridgeRow + flags و hasMoreSources — هیچ فیلد عددی
 *     گزارش را بازنویسی نمی‌کند (amount/sign/explainedTotal/unexplained همان‌اند).
 *   • BridgeDiagView خروجی سرویس «sale:report:bridgeDiag:open» است؛ یادداشت‌ها
 *     (فاز ۴) به‌صورت append-only از AuditLog می‌آیند.
 * ===========================================================================
 */

export interface BridgeDiagFlag {
  code:
    | 'sign'               // جهت علامت unexplained — راهنمای کلی بالای نما
    | 'largest'            // جزو بزرگ‌ترین ردیف‌های غیرصفر — پیشنهاد نقطه‌ی شروع
    | 'equals-unexplained' // مبلغ ردیف دقیقاً برابر |باقیمانده‌ی بی‌توضیح| است
    | 'date'               // تاریخ سند بیرون از بازه است / تاریخی ثبت نشده
  text: string
  certainty: 'TENTATIVE'
}

/** ردیف پل + نشان‌های تشخیصی (بدون هیچ تغییر عددی نسبت به گزارش پایه). */
export interface BridgeDiagRow extends SaleBridgeRow {
  flags: BridgeDiagFlag[]
}

/** یادداشت مدیر درباره‌ی نابرابری پل — append-only، متن خالص (فاز ۴). */
export interface BridgeDiagNote {
  id: number
  createdAtIso: string
  actorLabel: string
  text: string
}

/** خروجی کامل نمای تشخیصی پل برای یک scope. */
export interface BridgeDiagView {
  period: SaleReportPeriod
  /** لحظه‌ی محاسبه‌ی همین نما (برای بنر staleness در مودال). */
  computedAtIso: string
  bridge: {
    target: number
    explainedTotal: number
    unexplained: number
    balanced: boolean
  }
  /** راهنمای کلی بالای نما (جهت علامت و غیره). */
  guide: BridgeDiagFlag[]
  rows: BridgeDiagRow[]
  notes: BridgeDiagNote[]
  /** نشست ۳۱۹ — مظنونین اصلی پل تطبیق (حداکثر ۳ مظنون) */
  suspects?: BridgeSuspect[]
}

export type SuspectReason =
  | 'ROW_EQUALS_UNEXPLAINED' // ردیف = |باقیمانده|
  | 'SOURCE_EQUALS_UNEXPLAINED' // یک سند تکی = |باقیمانده| (قوی‌تر از ردیف)
  | 'SOURCE_OUT_OF_PERIOD' // flagSourceDate
  | 'CASH_OUT_ON_CREDIT' // سند خروج پول روی فاکتور با cashLike=0 (از documentDetail)
  | 'LARGEST_ROW'

export interface BridgeSuspect {
  rank: number // ۱ = قوی‌ترین
  rowKey: string
  rowLabel: string
  reasons: SuspectReason[]
  /** اسناد مظنون همین ردیف (اگر سند مشخص است)، با ارجاع برای documentDetail */
  documents: Array<{
    kind: SaleBridgeSource['kind']
    id: number
    amount: number
    dateJalali: string | null
    receiptNo: number | null
  }>
  certainty: 'TENTATIVE'
}

/** شناسنامه‌ی کامل سند — فقط خواندنی */
export interface BridgeDocDetail {
  ref: { kind: SaleBridgeSource['kind']; id: number }
  docType: 'SIMPLE_RETURN' | 'EXCHANGE' | 'CREDIT_PAYMENT' | 'STORE_CREDIT' | 'OVERPAY' | 'CASH_MOVEMENT' | 'INVOICE'
  docNo: string
  parent: {
    invoiceId: number
    receiptNo: number
    dateJalali: string
    settlementKind: InvoiceSettlementProfile['kind']
  } | null
  at: { dateJalali: string; time: string }
  actor: { userId: number | null; name: string }
  shift: { id: number | null; name: string | null }
  customer: { id: number | null; name: string }
  items: Array<{ name: string; code: string; qty: number; unitPrice: number; lineTotal: number }>
  settlement: {
    method: 'CASH' | 'CARD' | 'CARD_TO_CARD' | 'STORE_CREDIT' | 'NONE' | 'DEBT_CUT' | 'MIXED'
    methodLabel: string
    amount: number
    reference: string | null
    cardTransferStatus?: 'PENDING' | 'PAID' | 'CANCELED' | null
    storeCreditCodeMasked?: string | null
  }
  voided: boolean
}

export interface BridgeRootCause {
  narrative: string // «چه ثبت شده»
  accountingRoot: string // «چرا پل را باز کرد»
  lesson: string // «دفعه‌ی بعد کدام گزینه»
  lessonMethod?: string
  ruleId: string // برای تست و آمار آموزشی
}

export interface BridgeDocDetailResponse {
  ok: boolean
  message?: string
  detail?: BridgeDocDetail
  rootCause?: BridgeRootCause
}

/** منابع یک ردیف پل در نمای تشخیص + نشان تاریخِ بیرون‌بازه. */
export interface BridgeDiagRowSources {
  rowKey: string
  rowLabel: string
  sources: Array<SaleBridgeSource & { flags: BridgeDiagFlag[] }>
  totalCount: number | null
}

export interface BridgeDiagOpenResponse {
  ok: boolean
  view?: BridgeDiagView
  message?: string
}

export interface BridgeDiagSourcesResponse {
  ok: boolean
  result?: BridgeDiagRowSources
  message?: string
}

export interface BridgeDiagNotesResponse {
  ok: boolean
  notes?: BridgeDiagNote[]
  message?: string
}

export interface BridgeDiagNoteAddResponse {
  ok: boolean
  note?: BridgeDiagNote
  message?: string
}
