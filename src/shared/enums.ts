export const StockReason = {
  SALE: 'SALE',
  /** موجودی اولیه‌ی واریانت در لحظه‌ی تعریف کالا (ورود از فرم کالا) */
  INITIAL: 'INITIAL',
  SALE_RETURN: 'SALE_RETURN',
  /** اثر جبرانیِ مستقلِ ابطال/اصلاح برگشت؛ سند اصلی دست‌نخورده می‌ماند. */
  RETURN_CORRECTION: 'RETURN_CORRECTION',
  PURCHASE: 'PURCHASE',
  ADJUSTMENT: 'ADJUSTMENT',
  STOCKTAKE: 'STOCKTAKE',
  /** اختلاف موجودی ناشی از «ویرایش فاکتور فروش» (delta، نه حذف و ساخت دوباره) */
  SALE_EDIT: 'SALE_EDIT',
  /** اختلاف موجودی ناشی از «ویرایش فاکتور خرید» */
  PURCHASE_EDIT: 'PURCHASE_EDIT',
  /**
   * انتقال از «انبار مرکزی» به انبار فروشگاه، در لحظه‌ی فروش و فقط وقتی
   * چک‌باکس «برداشت خودکار از انبار مرکزی» روشن باشد (مورد ۳).
   */
  CENTRAL_WITHDRAW: 'CENTRAL_WITHDRAW',
  /** خروج موجودی که از ژورنال WooCommerce آمده؛ هیچ فروش/درآمدی در MAHAK نمی‌سازد. */
  WOO_SYNC_OUT: 'WOO_SYNC_OUT',
  /** ورود موجودی که از ژورنال WooCommerce آمده؛ فقط موجودی را هم‌تراز می‌کند. */
  WOO_SYNC_IN: 'WOO_SYNC_IN',
  /** هم‌ترازسازی دستی/وصل دوباره با سایت؛ فقط اثر موجودی دارد. */
  WOO_SYNC_ADJUST: 'WOO_SYNC_ADJUST'
} as const
export type StockReason = (typeof StockReason)[keyof typeof StockReason]

/** PENDING = کسر موقت لحظه فروش · FINAL = قطعی‌شده با «تجمیع و انتقال» */
export const StockState = { PENDING: 'PENDING', FINAL: 'FINAL' } as const
export type StockState = (typeof StockState)[keyof typeof StockState]

export const SALE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  SETTLED: 'تسویه شده',
  PARTIALLY_RETURNED: 'برگشت جزئی',
  RETURNED: 'برگشت کامل',
  CANCELED: 'لغو شده'
}

/** وضعیت نمایشی ستون «وضعیت» گزارش فروش: فاکتور تجمیع‌شده = «انتقال یافته». */
export function saleStatusLabel(status: string, consolidated = false): string {
  if (consolidated && (status === 'SETTLED' || status === 'DRAFT')) return 'انتقال یافته'
  return SALE_STATUS_LABELS[status] ?? status
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  INTERNAL: 'داخلی',
  DELIVERY: 'بیرون‌بر / پیک',
  PHONE: 'تلفنی',
  WHOLESALE: 'عمده',
  /** سند تعویض کالا (بخش ۶): فاکتورِ اقلام جایگزین، گره‌خورده به یک برگشت از فروش */
  EXCHANGE: 'تعویض کالا'
}

export const SaleStatus = {
  DRAFT: 'DRAFT',
  SETTLED: 'SETTLED',
  PARTIALLY_RETURNED: 'PARTIALLY_RETURNED',
  RETURNED: 'RETURNED',
  CANCELED: 'CANCELED'
} as const

/** نوع سند فروش. WHOLESALE = فاکتور فروش عمده (صفحه SalesInvoice) در مقابل
 *  INTERNAL که فروش خرده‌ی پنل فروش (Pos) است. */
export const OrderType = {
  INTERNAL: 'INTERNAL',
  DELIVERY: 'DELIVERY',
  PHONE: 'PHONE',
  WHOLESALE: 'WHOLESALE',
  /**
   * «سند تعویض کالا» (بخش ۶).
   *
   * یک SaleInvoice کامل و واقعی است که *فقط* اقلام جایگزین را در خودش دارد و با
   * دو کلید به سند برگشت و فاکتور اصلی گره خورده است
   * (`exchangeReturnId` / `sourceInvoiceId`). دلیل انتخاب این معماری در
   * SalesService.createExchange توضیح داده شده.
   */
  EXCHANGE: 'EXCHANGE'
} as const
export type OrderType = (typeof OrderType)[keyof typeof OrderType]

/**
 * ---------------------------------------------------------------------------
 * بند ۶ — «کانال فروش»: فروش داخلی/تکی در مقابل فروش عمده.
 *
 * چرا یک لایه‌ی جدا روی `OrderType` و نه فیلتر مستقیم خودش؟ چون «فروش تکی» در
 * عمل یک نوع نیست، چهار نوع است: فروش حضوری پنل فروش (INTERNAL)، بیرون‌بر/پیک
 * (DELIVERY)، تلفنی (PHONE) و سند تعویض کالا (EXCHANGE — که همیشه در پنل فروش
 * خرده ساخته می‌شود). فقط WHOLESALE عمده است.
 *
 * اگر روزی نوع سفارش جدیدی اضافه شود، فقط همین دو آرایه عوض می‌شوند و هر پنجِ
 * بخش گزارش فروش خودکار درست می‌مانند (چک‌باکس‌های «همه / تکی / عمده»).
 * ---------------------------------------------------------------------------
 */
export const SaleChannel = { RETAIL: 'RETAIL', WHOLESALE: 'WHOLESALE' } as const
export type SaleChannel = (typeof SaleChannel)[keyof typeof SaleChannel]

export const SALE_CHANNEL_LABELS: Record<SaleChannel, string> = {
  RETAIL: 'فروش داخلی / تکی',
  WHOLESALE: 'فروش عمده'
}

/** نوع‌های سفارشی که «فروش تکی» شمرده می‌شوند. */
export const RETAIL_ORDER_TYPES: readonly string[] = [
  OrderType.INTERNAL,
  OrderType.DELIVERY,
  OrderType.PHONE,
  OrderType.EXCHANGE
]

/** نوع‌های سفارشی که «فروش عمده» شمرده می‌شوند. */
export const WHOLESALE_ORDER_TYPES: readonly string[] = [OrderType.WHOLESALE]

/** یک نوع سفارش ⇒ کانال فروشش. */
export function channelOfOrderType(orderType: string | null | undefined): SaleChannel {
  return WHOLESALE_ORDER_TYPES.includes(String(orderType ?? '')) ? SaleChannel.WHOLESALE : SaleChannel.RETAIL
}

/**
 * چک‌باکس‌های انتخاب‌شده ⇒ فهرست نوع‌های سفارش برای فیلتر.
 * `null` = «همه» (هیچ فیلتری اعمال نشود، مو‌به‌مو رفتار قبلی).
 * فهرست خالی هم `null` نیست: یعنی «هیچ‌کدام» و باید گزارش خالی برگردد، وگرنه
 * برداشتن هر دو تیک به‌اشتباه «همه» تفسیر می‌شد.
 */
export function orderTypesForChannels(channels?: readonly string[] | null): string[] | null {
  if (channels == null) return null
  const set = new Set(channels)
  if (set.has(SaleChannel.RETAIL) && set.has(SaleChannel.WHOLESALE)) return null
  const out: string[] = []
  if (set.has(SaleChannel.RETAIL)) out.push(...RETAIL_ORDER_TYPES)
  if (set.has(SaleChannel.WHOLESALE)) out.push(...WHOLESALE_ORDER_TYPES)
  return out
}

/** نوع تسویه‌ی فاکتور خرید (عیناً مقادیر PurchaseInvoice.settlementType) */
export const SettlementType = { CASH: 'CASH', CHEQUE: 'CHEQUE', ACCOUNT: 'ACCOUNT' } as const
export type SettlementType = (typeof SettlementType)[keyof typeof SettlementType]

export const SETTLEMENT_LABELS: Record<SettlementType, string> = {
  CASH: 'نقدی',
  CHEQUE: 'چک',
  ACCOUNT: 'حساب/نسیه'
}

/**
 * نوع «روش پرداخت» (ستون PaymentMethod.kind) — مبنای تفکیک دریافتی‌ها در گزارش.
 *
 * دو نوع آخر پول *نقد واقعی* نیستند و عمداً از جمع دریافتی‌ها بیرون می‌مانند
 * (بخش ۶ — جلوگیری از دزدی فروشنده):
 *   EXCHANGE_CREDIT = ارزش کالای برگشتی که داخل «سند تعویض» تسویه شده است.
 *   STORE_CREDIT    = «بارکد اعتبار خرید بعدی» که روی یک فاکتور جدید مصرف شده.
 * هر دو در `SaleInvoice.paidTotal` می‌نشینند (پس فاکتور «تسویه‌شده» است) ولی در
 * ستون‌های نقدی/کارت/اعتباری و در «خالص واقعی دریافتی» شمرده نمی‌شوند.
 */
export const PaymentKind = {
  CASH: 'CASH',
  CARD: 'CARD',
  CREDIT: 'CREDIT',
  CUSTOM: 'CUSTOM',
  EXCHANGE_CREDIT: 'EXCHANGE_CREDIT',
  STORE_CREDIT: 'STORE_CREDIT'
} as const

/** روش‌های پرداختی که پول واقعی نیستند (از «خالص دریافتی» کنار گذاشته می‌شوند). */
export const NON_CASH_PAYMENT_KINDS: readonly string[] = [
  PaymentKind.EXCHANGE_CREDIT,
  PaymentKind.STORE_CREDIT
]

/**
 * ---------------------------------------------------------------------------
 * نوع یک رکورد پرداختی روی فاکتور (فروش نسیه / اقساطی).
 *
 * CASH   = پولی که *دریافت شده* (نقدی، کارتخوان، …). همان لحظه در جمع
 *          پرداختی‌های فاکتور می‌نشیند و باقی‌مانده را کم می‌کند.
 * CHEQUE = چک. تا وقتی «پاس شد» علامت نخورده باشد، پول دریافت‌شده به‌حساب
 *          نمی‌آید (نه در باقی‌مانده‌ی فاکتور و نه در دریافتی‌های گزارش‌ها).
 * ---------------------------------------------------------------------------
 */
export const PaymentEntryKind = { CASH: 'CASH', CHEQUE: 'CHEQUE' } as const
export type PaymentEntryKind = (typeof PaymentEntryKind)[keyof typeof PaymentEntryKind]

/**
 * ===========================================================================
 * کار الف (جلسه ۳۶) — «مقصد پول»: پولی که *از مشتری* گرفته‌ایم کجا نشست؟
 *
 * فقط و فقط درباره‌ی پولِ ورودی است (چک پاس‌شده و پرداختی نسیه). هیچ ربطی به
 * «کارت‌به‌کارت مدیر» ندارد که پولِ *برگشتی به مشتری* است (CardTransferRequest).
 *
 *   CARD    = با کارتخوانِ فروشگاه آمد   ⇒ جزو «دریافتی کارت» و در مقایسه با
 *             گزارش کارتخوان دیده می‌شود.
 *   CASH    = نقد در صندوقِ فروشگاه آمد  ⇒ جزو «دریافتی نقد» و در «نقد مورد
 *             انتظار» بستن صندوق.
 *   MANAGER = به حساب شخصی مدیر ریخته شد. مشتری *واقعاً پرداخته*، پس بدهی‌اش کم
 *             و فاکتور تسویه می‌شود؛ ولی این پول نه به کارتخوان آمده و نه به
 *             صندوق. بنابراین در «دریافتی فروشگاه»، در «نقد/کارت مورد انتظار
 *             صندوق» و در مقایسه با کارتخوان **نمی‌آید** و در کسری/اضافی صندوق
 *             هیچ اثری ندارد؛ فقط یک ردیف جدا و توضیح‌دار در گزارش فروش و بستن
 *             صندوق می‌گیرد.
 *
 * ================= یک منبع حقیقت (تصمیم معماری این کار) =================
 * `Payment.destination` **تنها** مبنای تفکیک دریافتی‌ها است؛ `methodId` همان
 * «مشتری با چه ابزاری پرداخت کرد» می‌ماند. برای این‌که هرگز دو عدد متفاوت ساخته
 * نشود، در لحظه‌ی *نوشتن* اعتبارسنجی می‌شود:
 *   • روش پرداخت با kind = CASH ⇒ مقصد فقط CASH یا MANAGER
 *   • روش پرداخت با kind = CARD ⇒ مقصد فقط CARD یا MANAGER
 *   • روش پرداخت با kind = CREDIT/CUSTOM (بانک‌های تعریف‌شده‌ی فروشگاه) و چک ⇒
 *     هر سه مقصد مجاز است؛ این همان سوراخی است که تا امروز بی‌صدا به «سایر» و
 *     از آن‌جا به کارتخوان می‌رفت.
 * پس مقصد هیچ‌وقت با روش پرداخت در تناقض نیست و «مشتق کردن از روش پرداخت» و
 * «پرسیدن از کاربر» به یک عدد می‌رسند.
 *
 * ⚠️ `null` = داده‌ی قدیمی. هیچ حدسی زده نمی‌شود و فقط با برچسب «نامشخص» دیده
 * می‌شود (`PAYMENT_DESTINATION_UNKNOWN_LABEL`).
 * ===========================================================================
 */
export const PaymentDestination = { CARD: 'CARD', CASH: 'CASH', MANAGER: 'MANAGER' } as const
export type PaymentDestination = (typeof PaymentDestination)[keyof typeof PaymentDestination]

/** ترتیب نمایش سه گزینه در کادر اجباری (بدون پیش‌فرض). */
export const PAYMENT_DESTINATIONS: readonly PaymentDestination[] = [
  PaymentDestination.CARD,
  PaymentDestination.CASH,
  PaymentDestination.MANAGER
]

export const PAYMENT_DESTINATION_LABELS: Record<string, string> = {
  CARD: 'کارت (کارتخوان فروشگاه)',
  CASH: 'نقدی (صندوق فروشگاه)',
  MANAGER: 'حساب مدیر'
}

/** توضیح یک‌خطی هر گزینه — همان متنی که زیر دکمه‌های کادر نشان داده می‌شود. */
export const PAYMENT_DESTINATION_HINTS: Record<string, string> = {
  CARD: 'پول با کارتخوان فروشگاه آمده و در «دریافتی کارت» و مقایسه با کارتخوان می‌آید.',
  CASH: 'پول نقد در صندوق فروشگاه آمده و در «نقد مورد انتظار» بستن صندوق می‌آید.',
  MANAGER:
    'پول به حساب مدیر ریخته شده و به کارتخوان یا صندوق فروشگاه نیامده. بدهی مشتری کم و فاکتور تسویه می‌شود، ' +
    'ولی این مبلغ در دریافتی فروشگاه و در کسری/اضافی صندوق نمی‌آید.'
}

/** برچسب داده‌ی قدیمی (destination = null). هرگز به یک مقصد حدسی تبدیل نمی‌شود. */
export const PAYMENT_DESTINATION_UNKNOWN_LABEL = 'نامشخص (ثبت قبل از افزودن مقصد)'

/** متن ثابتِ ردیف «حساب مدیر» در گزارش فروش و بستن صندوق (یک جا، همه‌جا یکی). */
export const MANAGER_ACCOUNT_ROW_LABEL = 'دریافتی به حساب مدیر'
export const MANAGER_ACCOUNT_ROW_NOTE =
  'به صندوق و کارتخوان فروشگاه نیامده و در کسری/اضافی صندوق تأثیر ندارد'

/** ردیف «نامشخص» گزارش‌ها (داده‌ی قدیمی بدون مقصد). */
export const DESTINATION_UNKNOWN_ROW_LABEL = 'دریافتی با مقصد نامشخص'
export const DESTINATION_UNKNOWN_ROW_NOTE =
  'پرداختی/چکِ ثبت‌شده پیش از افزودن «مقصد پول»؛ برای این مبلغ هیچ حدسی زده نشده و در ' +
  'انتظار نقد و کارت صندوق نیامده است'

/** ورودی کاربر ⇒ مقصد معتبر، یا null اگر چیزی انتخاب نشده باشد. */
export function normalizePaymentDestination(value: unknown): PaymentDestination | null {
  const v = String(value ?? '').trim().toUpperCase()
  return v === PaymentDestination.CARD || v === PaymentDestination.CASH || v === PaymentDestination.MANAGER
    ? (v as PaymentDestination)
    : null
}

export function paymentDestinationLabel(value: unknown): string {
  const d = normalizePaymentDestination(value)
  return d ? PAYMENT_DESTINATION_LABELS[d] : PAYMENT_DESTINATION_UNKNOWN_LABEL
}

/**
 * مقصدهایی که با یک روش پرداخت سازگارند (منبع حقیقت یگانه).
 * چک و روش‌های CUSTOM/CREDIT محدودیتی ندارند؛ کارت فقط خودش یا مدیر.
 * نشست ۱۵۸ (Y15، بند ۴-۱۳، S158-D5): پول نقد فقط به کشوی فیزیکی می‌رود، هرگز مستقیماً «حساب مدیر».
 * اگر مدیر خودش نقد گرفت: اول «نقد در صندوق»، بعد «برداشت از صندوق» (رمز مدیر + دلیل).
 */
export function allowedDestinationsFor(methodKind: string | null | undefined): readonly PaymentDestination[] {
  if (methodKind === PaymentKind.CASH) return [PaymentDestination.CASH]
  if (methodKind === PaymentKind.CARD) return [PaymentDestination.CARD, PaymentDestination.MANAGER]
  return PAYMENT_DESTINATIONS
}

/** مقصد مجاز چک پس از پاس‌شدن؛ چک هرگز نقدِ کشو یا کارت‌خوان نیست. */
export function allowedChequeDestinations(): readonly PaymentDestination[] {
  return [PaymentDestination.MANAGER]
}

/** مقصدِ مشتق‌شده از روش پرداخت (پیشنهاد فرم؛ برای CUSTOM هیچ پیشنهادی نیست). */
export function destinationFromMethodKind(methodKind: string | null | undefined): PaymentDestination | null {
  if (methodKind === PaymentKind.CASH) return PaymentDestination.CASH
  if (methodKind === PaymentKind.CARD) return PaymentDestination.CARD
  return null
}

/** این مقصد پول «به فروشگاه» رسیده است؟ (MANAGER نه) */
export function destinationReachedStore(value: unknown): boolean {
  const d = normalizePaymentDestination(value)
  return d === PaymentDestination.CARD || d === PaymentDestination.CASH
}

/** کلید روش پرداخت مخصوص چک (در seed ساخته می‌شود و در فهرست‌ها نمایش داده نمی‌شود). */
export const CHEQUE_METHOD_KEY = 'CHEQUE'

/**
 * کلید روش پرداخت «ارزش کالای برگشتی» (سند تعویض — بخش ۶).
 * `isActive: false` است، پس در دکمه‌های پنل فروش ظاهر نمی‌شود.
 */
export const EXCHANGE_CREDIT_METHOD_KEY = 'EXCHANGE_CREDIT'

/** کلید روش پرداخت «بارکد اعتبار خرید بعدی» (مصرف اعتبار روی فاکتور جدید). */
export const STORE_CREDIT_METHOD_KEY = 'STORE_CREDIT'

/**
 * ---------------------------------------------------------------------------
 * «برگشت از فروش» در دو حالت (بخش ۶).
 *
 * RETURN   = برگشت ساده‌ی همیشگی (کالا برمی‌گردد، پول برمی‌گردد/می‌ماند).
 * EXCHANGE = تعویض کالا: همان برگشت، به‌علاوه‌ی یک «سند تعویض» (SaleInvoice با
 *            orderType = EXCHANGE) که اقلام جایگزین در آن است.
 * ⚠️ همه‌ی برگشت‌های قبلی `RETURN` می‌مانند (پیش‌فرض ستون)، پس هیچ داده‌ای
 * مهاجرت لازم ندارد و رفتار فعلی مو‌به‌مو حفظ می‌شود.
 * ---------------------------------------------------------------------------
 */
export const ReturnKind = { RETURN: 'RETURN', EXCHANGE: 'EXCHANGE' } as const
export type ReturnKind = (typeof ReturnKind)[keyof typeof ReturnKind]

/** روش بازپرداخت برگشت؛ برای داده‌های قدیمی مقدار تهی یعنی فرض محافظه‌کارانه. */
export const RefundMethod = {
  CASH: 'CASH',
  CARD: 'CARD',
  STORE_CREDIT: 'STORE_CREDIT',
  NONE: 'NONE',
  /**
   * جلسه ۱۷ · بند ۱ — «کارت‌به‌کارت توسط مدیر».
   * ⚠️ این مقدار هیچ ربطی به `CARD` ندارد و جایش را نمی‌گیرد: `CARD` یعنی تسویه‌ی
   * *فوری* با دستگاه کارت‌خوان فروشگاه و دست‌نخورده مانده است. این یکی یعنی «هیچ
   * پولی همین حالا جابه‌جا نشد؛ یک درخواست پرداخت در انتظار تایید مدیر ساخته شد».
   */
  CARD_TO_CARD: 'CARD_TO_CARD'
} as const
export type RefundMethod = (typeof RefundMethod)[keyof typeof RefundMethod]

/** تمام گردش‌های نقدی که باید در تطبیق صندوق قابل ردیابی باشند. */
export const CashMovementType = {
  CASH_IN: 'CASH_IN',
  CASH_OUT: 'CASH_OUT',
  RETURN_REFUND: 'RETURN_REFUND',
  EXCHANGE_REFUND: 'EXCHANGE_REFUND',
  OPENING_FLOAT: 'OPENING_FLOAT',
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL'
} as const
export type CashMovementType = (typeof CashMovementType)[keyof typeof CashMovementType]

export const RETURN_KIND_LABELS: Record<string, string> = {
  RETURN: 'برگشت از فروش',
  EXCHANGE: 'تعویض کالا'
}

/** چطور مابه‌التفاوت یک تعویض تسویه شد؟ */
export const ExchangeSettlement = {
  /** مشتری مابه‌التفاوت را نقد/کارت پرداخت کرد */
  CASH: 'CASH',
  /** ما به مشتری بدهکار شدیم ⇒ «بارکد اعتبار خرید بعدی» صادر شد */
  CREDIT: 'CREDIT',
  /**
   * جلسه ۱۴ · بند ۱۲ — دو حالت جدید: ما بدهکار شدیم و **پول برگرداندیم**.
   * قبلاً این دو حالت اصلاً وجود نداشتند، چون صدور اعتبار پیش‌فرض ضمنی بود و
   * مشتری هیچ‌وقت نمی‌توانست پولش را بگیرد.
   */
  CASH_REFUND: 'CASH_REFUND',
  CARD_REFUND: 'CARD_REFUND',
  /**
   * جلسه ۱۷ · بند ۱ — مابه‌التفاوت منفی، با «کارت‌به‌کارت توسط مدیر» تسویه
   * می‌شود: در لحظه‌ی تعویض هیچ پولی جابه‌جا نمی‌شود و یک درخواست پرداخت «در
   * انتظار پرداخت» ساخته می‌گردد.
   */
  CARD_TO_CARD: 'CARD_TO_CARD',
  /** نشست ۶۰ (بند ۴-۵) — کل مابه‌التفاوت منفی از بدهی فاکتور اصلی کم شد؛ پولی جابه‌جا نشد */
  DEBT_REDUCTION: 'DEBT_REDUCTION',
  /** مابه‌التفاوت صفر بود */
  NONE: 'NONE'
} as const
export type ExchangeSettlement = (typeof ExchangeSettlement)[keyof typeof ExchangeSettlement]

export const EXCHANGE_SETTLEMENT_LABELS: Record<string, string> = {
  CASH: 'مشتری مابه‌التفاوت را پرداخت کرد',
  CREDIT: 'بارکد اعتبار خرید بعدی صادر شد',
  CASH_REFUND: 'مابه‌التفاوت نقدی به مشتری برگشت (خروج از صندوق)',
  CARD_REFUND: 'مابه‌التفاوت به کارت مشتری برگشت',
  CARD_TO_CARD: 'کارت‌به‌کارت توسط مدیر (درخواست پرداخت ثبت شد)',
  /** نشست ۶۰ (بند ۴-۵) — مابه‌التفاوت به‌جای پول از بدهی فاکتور اصلی کم شد */
  DEBT_REDUCTION: 'مابه‌التفاوت از بدهی فاکتور اصلی کم شد (پولی جابه‌جا نشد)',
  NONE: 'مابه‌التفاوت صفر بود'
}

/**
 * برچسب روش بازپرداخت یک برگشت (بند ۱۱).
 * `null`/تهی = داده‌ی قدیمیِ قبل از این ستون ⇒ برچسب صریحِ «فرض‌شده».
 */
export const REFUND_METHOD_LABELS: Record<string, string> = {
  CASH: 'بازپرداخت نقدی',
  CARD: 'بازپرداخت کارتی',
  STORE_CREDIT: 'بارکد اعتبار خرید بعدی',
  CARD_TO_CARD: 'کارت‌به‌کارت توسط مدیر (در انتظار پرداخت)',
  NONE: 'بدون بازپرداخت (فقط کاهش بدهی)'
}

export const LEGACY_REFUND_LABEL = 'فرض‌شده از داده‌ی قدیمی'

export function refundMethodLabel(method?: string | null): string {
  if (!method) return LEGACY_REFUND_LABEL
  return REFUND_METHOD_LABELS[method] ?? method
}

/** برچسب‌های گردش نقدی صندوق (بند ۱۶). */
export const CASH_MOVEMENT_LABELS: Record<string, string> = {
  CASH_IN: 'واریز به صندوق',
  CASH_OUT: 'برداشت از صندوق',
  RETURN_REFUND: 'بازپرداخت نقدی برگشت از فروش',
  EXCHANGE_REFUND: 'بازپرداخت نقدی مابه‌التفاوت تعویض',
  OPENING_FLOAT: 'موجودی اول صندوق',
  DEPOSIT: 'واریز وسط شیفت',
  WITHDRAWAL: 'برداشت وسط شیفت'
}

/**
 * وضعیت یک «بارکد اعتبار خرید بعدی» (مدل StoreCredit).
 *
 * ⚠️ جلسه ۲۰ — ماژول «مدیریت اعتبار خرید» سه وضعیت *تازه* اضافه کرد و هیچ
 * وضعیت قبلی را لمس نکرد:
 *   • `PARTIALLY_USED` — مصرف بخشی (اعتبار «چندباره تا سقف مبلغ»).
 *   • `SUSPENDED` — معلق (موقتاً غیرفعال، بدون ابطال).
 *   • `DRAFT` — ساخته‌شده ولی صادر/چاپ‌نشده.
 * دو نام سند مرجع (`FULLY_USED` و `VOIDED`) عمداً مقدار جدید نگرفتند و همان
 * `USED` و `CANCELED` تاریخی‌اند؛ دلیلش (سازگاری دیتابیس و گزارش‌های موجود) در
 * `src/shared/credit.ts` و در HANDOFF توضیح داده شده است.
 */
export const StoreCreditStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PARTIALLY_USED: 'PARTIALLY_USED',
  USED: 'USED',
  EXPIRED: 'EXPIRED',
  CANCELED: 'CANCELED',
  SUSPENDED: 'SUSPENDED'
} as const
export type StoreCreditStatus = (typeof StoreCreditStatus)[keyof typeof StoreCreditStatus]

export const STORE_CREDIT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس (صادر نشده)',
  ACTIVE: 'مصرف‌نشده (معتبر)',
  PARTIALLY_USED: 'مصرف بخشی (باقی‌مانده دارد)',
  USED: 'مصرف شد',
  EXPIRED: 'منقضی شد',
  CANCELED: 'باطل شد',
  SUSPENDED: 'معلق (موقتاً غیرفعال)'
}

/** عملیات‌های ثبت‌شده در تاریخچه‌ی انبار مرکزی (مدل SecondaryStockLog). */
export const SecondaryStockAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  TRANSFER_IN: 'TRANSFER_IN',
  TRANSFER_OUT: 'TRANSFER_OUT',
  WITHDRAW: 'WITHDRAW',
  /**
   * بند ۸ — انتقال دستیِ مدیر از یک انبار این ماژول به «انبار فروشگاه»
   * (موجودی واقعی کالا در پنل کالاها). تنها اکشنی از این ماژول — کنار
   * WITHDRAW — که روی `ProductVariant.stock` اثر می‌گذارد.
   */
  TRANSFER_STORE: 'TRANSFER_STORE',
  /**
   * ================== جلسه ۴۷ — «از کدام انبار کسر شود؟» ==================
   * کسر موجودی یک قلمِ **فاکتور فروش عمده** مستقیم از ردیف‌های همین ماژول، طبق
   * «برنامه‌ی کسر»ی که خودِ کاربر در پنجره‌ی انتخاب انبار ساخته است.
   *
   * ⚠️ تفاوت صریحش با `WITHDRAW`: آن یکی خودکار است (تیک «برداشت خودکار») و
   * کالا را *به انبار فروشگاه منتقل* می‌کند و بعد از آنجا می‌فروشد. این یکی
   * هیچ انتقالی ندارد: کالا از همان انبار فروخته می‌شود و موجودی فروشگاه
   * مطلقاً دست نمی‌خورد.
   */
  SALE_WHOLESALE: 'SALE_WHOLESALE',
  /** برگشتِ همان کسر به همان انبار (برگشت از فروش / ویرایش / حذف فاکتور). */
  SALE_WHOLESALE_RESTORE: 'SALE_WHOLESALE_RESTORE'
} as const
export type SecondaryStockAction = (typeof SecondaryStockAction)[keyof typeof SecondaryStockAction]

export const SECONDARY_STOCK_ACTION_LABELS: Record<string, string> = {
  CREATE: 'ثبت ردیف',
  UPDATE: 'ویرایش',
  DELETE: 'حذف ردیف',
  TRANSFER_IN: 'ورود با انتقال',
  TRANSFER_OUT: 'خروج با انتقال',
  WITHDRAW: 'برداشت خودکار برای فروش',
  TRANSFER_STORE: 'انتقال به انبار فروشگاه',
  SALE_WHOLESALE: 'کسر برای فاکتور فروش عمده',
  SALE_WHOLESALE_RESTORE: 'برگشت کسر فاکتور فروش عمده'
}

/** وضعیت یک چک ثبت‌شده روی فاکتور. */
export const ChequeStatus = { PENDING: 'PENDING', CLEARED: 'CLEARED', BOUNCED: 'BOUNCED' } as const
export type ChequeStatus = (typeof ChequeStatus)[keyof typeof ChequeStatus]

export const CHEQUE_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در جریان (پاس نشده)',
  CLEARED: 'پاس شد',
  BOUNCED: 'برگشت خورد'
}

/** وضعیت تسویه‌ی یک فاکتور (از مقایسه‌ی جمع کل با جمع پرداختی‌های دریافت‌شده). */
export const SettlementState = { UNPAID: 'UNPAID', PARTIAL: 'PARTIAL', SETTLED: 'SETTLED' } as const
export type SettlementState = (typeof SettlementState)[keyof typeof SettlementState]

export const SETTLEMENT_STATE_LABELS: Record<SettlementState, string> = {
  UNPAID: 'پرداخت‌نشده',
  PARTIAL: 'نسیه (باقی‌مانده دارد)',
  SETTLED: 'تسویه‌شده'
}

/**
 * وضعیت تسویه‌ی یک فاکتور از روی اعدادش.
 * فاکتور بی‌مبلغ (جمع کل صفر) «تسویه‌شده» است تا در فهرست بی‌دلیل قرمز نشود.
 */
export function settlementStateOf(
  grandTotal: number | bigint | null | undefined,
  paidTotal: number | bigint | null | undefined
): SettlementState {
  /**
   * ⚠️ نشست ۱۸۱ — مقایسه روی `bigint` انجام می‌شود، نه `number`.
   *
   * این تابع فقط *مقایسه* می‌کند و هیچ حسابی نمی‌کند، پس هیچ دلیلی ندارد که
   * مبلغ را به `number` ببرد و بالای `MAX_SAFE_INTEGER` دقت را از دست بدهد.
   * مقایسه‌ی `bigint` با `bigint` همیشه دقیق است.
   *
   * (این فایل عمداً هیچ import ای ندارد تا مستقل اجرا شود، پس تبدیل درون‌خطی است.)
   */
  const asBig = (v: number | bigint | null | undefined): bigint =>
    typeof v === 'bigint' ? v : BigInt(Math.round(Number(v) || 0))
  const total = asBig(grandTotal)
  const paid = asBig(paidTotal)
  if (paid >= total) return SettlementState.SETTLED
  if (paid <= 0n) return SettlementState.UNPAID
  return SettlementState.PARTIAL
}

export const AuditAction = {
  /** جلسه ۱۷ · بند ۱ — ساخت «درخواست کارت‌به‌کارت» (هیچ پولی جابه‌جا نشده) */
  CARD_TRANSFER_REQUEST: 'CARD_TRANSFER_REQUEST',
  /** جلسه ۱۷ · بند ۱ — ثبت «پرداخت شد» روی یک درخواست کارت‌به‌کارت */
  CARD_TRANSFER_PAID: 'CARD_TRANSFER_PAID',
  /** جلسه ۱۷ · بند ۱ — رویداد اصلاحیِ جدید روی یک درخواست پرداخت‌شده */
  CARD_TRANSFER_ADJUST: 'CARD_TRANSFER_ADJUST',
  /**
   * جلسه ۴۰ · کار ب — ورود کالای *معلق* برگشتی به موجودی قابل‌فروش.
   * تنها دو مسیر این رویداد را می‌سازند و هر دو پشت قفل «پرداخت‌های مدیر»اند:
   * `cardTransfer:pay` و آزادسازی صریح در `cardTransfer:cancel`.
   */
  CARD_TRANSFER_RESTOCK: 'CARD_TRANSFER_RESTOCK',
  /** جلسه ۴۰ · کار ب — رد/لغو یک درخواست کارت‌به‌کارت (با دلیل اجباری) */
  CARD_TRANSFER_CANCEL: 'CARD_TRANSFER_CANCEL',
  /** جلسه ۱۷ · بند ۴ — ثبت یک جلسه‌ی شمارش فیزیکی انبار */
  STOCK_COUNT_SUBMIT: 'STOCK_COUNT_SUBMIT',
  /** جلسه ۱۷ · بند ۵ — تغییر تنظیمات یادآوری انبارگردانی */
  STOCKTAKE_SCHEDULE_UPDATE: 'STOCKTAKE_SCHEDULE_UPDATE',
  SALE_CREATE: 'SALE_CREATE',
  SALE_UPDATE: 'SALE_UPDATE',
  SALE_RETURN: 'SALE_RETURN',
  PURCHASE_CREATE: 'PURCHASE_CREATE',
  PURCHASE_UPDATE: 'PURCHASE_UPDATE',
  WHOLESALE_SALE_CREATE: 'WHOLESALE_SALE_CREATE',
  CUSTOMER_CREATE: 'CUSTOMER_CREATE',
  SUPPLIER_CREATE: 'SUPPLIER_CREATE',
  PRICE_EDIT: 'PRICE_EDIT',
  STOCK_ADJUST: 'STOCK_ADJUST',
  STOCK_INITIAL: 'STOCK_INITIAL',
  /** اتصال/قطع/وصل یا همگام‌سازی موجودی سایت WooCommerce (فقط موجودی). */
  WOO_SYNC_SETTINGS: 'WOO_SYNC_SETTINGS',
  WOO_LINK_CREATE: 'WOO_LINK_CREATE',
  WOO_LINK_PAUSE: 'WOO_LINK_PAUSE',
  WOO_LINK_RESUME: 'WOO_LINK_RESUME',
  WOO_LINK_UNLINK: 'WOO_LINK_UNLINK',
  WOO_SYNC_RUN: 'WOO_SYNC_RUN',
  DELETE: 'DELETE',
  /** نشست ۶۴ · بند ۴-۲۲ — ابطال سند مالی (سند می‌ماند، با مهر کی/کِی/چرا) */
  VOID: 'VOID',
  /** بازگردانی کالا از «سطل آشغال» */
  PRODUCT_RESTORE: 'PRODUCT_RESTORE',
  /** تغییر نام کالا یا تیک «نمایش آخرین نام در گزارش فروش» */
  PRODUCT_UPDATE: 'PRODUCT_UPDATE',
  /** تهیه‌ی بکاپ دستی (با انتخاب مسیر) */
  BACKUP_CREATE: 'BACKUP_CREATE',
  /** حذف فایل بکاپ از فهرست و دیسک (نشست ۲۰۶) */
  BACKUP_FORGET: 'BACKUP_FORGET',
  /** جایگزینی کامل داده با یک فایل بکاپ */
  BACKUP_RESTORE: 'BACKUP_RESTORE',
  /** ادغام یک فایل بکاپ با داده‌ی فعلی */
  BACKUP_MERGE: 'BACKUP_MERGE',
  /** آرشیو و پاک‌سازی داده‌ی قدیمی (سبک‌سازی) */
  DATA_ARCHIVE_PURGE: 'DATA_ARCHIVE_PURGE',
  CASH_CLOSE: 'CASH_CLOSE',
  CONSOLIDATE: 'CONSOLIDATE',
  SHIFT_OPEN: 'SHIFT_OPEN',
  SHIFT_CLOSE: 'SHIFT_CLOSE',
  /** نشست ۳۱۰ — اعلام اضافه‌کاری شیفت شب (دائم در حسابرسی، با دلیل و سقف) */
  SHIFT_OVERTIME: 'SHIFT_OVERTIME',
  SETTINGS_UPDATE: 'SETTINGS_UPDATE',
  /** برداشت خودکار کمبود موجودی از «انبار مرکزی» در لحظه‌ی فروش */
  CENTRAL_WITHDRAW: 'CENTRAL_WITHDRAW',
  /** ثبت یک پرداختی جدید روی فاکتور (پرداختی دوم، سوم، ... — فروش نسیه) */
  SALE_PAYMENT_ADD: 'SALE_PAYMENT_ADD',
  /** ویرایش یک پرداختی/چک ثبت‌شده */
  SALE_PAYMENT_UPDATE: 'SALE_PAYMENT_UPDATE',
  /** حذف یک پرداختی/چک ثبت‌شده */
  SALE_PAYMENT_DELETE: 'SALE_PAYMENT_DELETE',
  /** تغییر وضعیت یک چک (پاس شد / برگشت خورد / در جریان) */
  CHEQUE_STATUS: 'CHEQUE_STATUS',
  /** تعویض کالا: برگشت یک قلم + فروش قلم جایگزین در یک سند (بخش ۶) */
  SALE_EXCHANGE: 'SALE_EXCHANGE',
  /** صدور «بارکد اعتبار خرید بعدی» (ما به مشتری بدهکار شدیم) */
  STORE_CREDIT_ISSUE: 'STORE_CREDIT_ISSUE',
  /** مصرف یک «بارکد اعتبار خرید بعدی» روی یک فاکتور جدید */
  STORE_CREDIT_REDEEM: 'STORE_CREDIT_REDEEM',
  /** قفل موقت یک گیت رمز بعد از چند تلاش ناموفق پشت‌سرهم (بخش ۲) */
  AUTH_LOCKOUT: 'AUTH_LOCKOUT',
  /** بند ۱ — روشن/خاموش کردن قفل رمز دوم یک یا چند ماژول (با رمز مدیر) */
  PANEL_LOCKS_UPDATE: 'PANEL_LOCKS_UPDATE',
  /** بند ۴ — تغییر گروهی قیمت کالاها (تخفیف / افزایش / کاهش) */
  PRICE_BULK_ADJUST: 'PRICE_BULK_ADJUST',
  /** بند ۴ — بازگردانی یک تغییر گروهی قیمت به قیمت‌های قبلش */
  PRICE_BULK_REVERT: 'PRICE_BULK_REVERT',
  /** مورد ۱ (نشست دهم) — شروع خودکار یک تغییر قیمت طبق زمان‌بندی */
  PRICE_SCHEDULE_START: 'PRICE_SCHEDULE_START',
  /** مورد ۱ (نشست دهم) — پایان خودکار یک تغییر قیمت طبق زمان‌بندی */
  PRICE_SCHEDULE_END: 'PRICE_SCHEDULE_END',
  /** مورد ۲ (نشست دهم) — ویرایش دامنه‌ی یک دسته‌ی تغییر قیمت ثبت‌شده */
  PRICE_BATCH_EDIT: 'PRICE_BATCH_EDIT',
  /** مورد ۲ (نشست دهم) — حذف یک یا چند ردیف از سابقه‌ی تغییر قیمت */
  PRICE_HISTORY_DELETE: 'PRICE_HISTORY_DELETE',
  /** مورد ۷ (نشست دهم) — تعریف/تغییر/حذف «رمز سوم» یک پنل در یک شیفت */
  PANEL_SHIFT_PASSWORD: 'PANEL_SHIFT_PASSWORD',
  /** مورد ۴ (نشست دهم) — نمایش دوباره‌ی یک رمز دوم/سوم ذخیره‌شده */
  PANEL_PASSWORD_REVEAL: 'PANEL_PASSWORD_REVEAL',
  /** بند ۸ — انتقال موجودی از انبار مرکزی به انبار فروشگاه */
  SECONDARY_TO_STORE: 'SECONDARY_TO_STORE',
  /**
   * جلسه ۵۴ — ساخت کالا/واریانت *تازه* در انبار فروشگاه، هم‌زمان با انتقال از
   * انبار مرکزی. همیشه در کنار یک `SECONDARY_TO_STORE` ثبت می‌شود (هر دو در یک
   * تراکنش)، پس اگر این رویداد بی آن دیده شود یعنی چیزی غلط است.
   */
  SECONDARY_TO_STORE_NEW_PRODUCT: 'SECONDARY_TO_STORE_NEW_PRODUCT',
  /** تعریف/ویرایش/حذف یک انبار در ماژول انبار مرکزی (بخش ۵) */
  SECONDARY_WAREHOUSE: 'SECONDARY_WAREHOUSE',
  /** انتقال کالا بین دو انبار ماژول انبار مرکزی */
  SECONDARY_STOCK_TRANSFER: 'SECONDARY_STOCK_TRANSFER',
  /**
   * جلسه ۴۷ — «برنامه‌ی کسر»ی که کاربر در پنجره‌ی انتخاب انبار ساخت و روی یک
   * فاکتور فروش عمده اعمال شد (به‌تفکیک انبار، با پرچم منفی‌شدن‌ها).
   */
  SALE_STOCK_SOURCE: 'SALE_STOCK_SOURCE',
  /** جلسه ۴۷ — برگشت همان برنامه به انبارهای مبدأ (برگشت/ویرایش/حذف). */
  SALE_STOCK_SOURCE_RESTORE: 'SALE_STOCK_SOURCE_RESTORE',
  /**
   * ====================== جلسه ۱۴ ======================
   * هر یک از این‌ها یک «دربِ فرار» را می‌بندد و ردش را در AuditLog می‌گذارد.
   */
  /** بند ۱۶ — ثبت موجودی اول صندوق / برداشت / واریز وسط شیفت */
  CASH_MOVEMENT: 'CASH_MOVEMENT',
  /** بند ۱۱ — ثبت روش بازپرداخت یک برگشت (نقد/کارت/اعتبار/بدون بازپرداخت) */
  RETURN_REFUND: 'RETURN_REFUND',
  /** بند ۱۸ — عوض‌کردن دستیِ قیمت کالای جایگزین در تعویض (با گیت مدیر) */
  EXCHANGE_PRICE_OVERRIDE: 'EXCHANGE_PRICE_OVERRIDE',
  /**
   * نشست ۱۵۴ (S151-b، بند ۴-۲۶) — قیمت واحد فروش/ویرایش فاکتور متفاوت با قیمت مرجع
   * (کاهش با تایید مدیر یا گیت خاموش، افزایش بی‌رمز)؛ before = مرجع، after = واردشده.
   */
  SALE_PRICE_OVERRIDE: 'SALE_PRICE_OVERRIDE',
  /**
   * نشست ۱۵۶ (S151-c2، Y8، بند ۴-۴۵) — عوارض/حق سرویس دستیِ فاکتور عمده متفاوت با مبلغ خودکار
   * تنظیمات (کاهش فقط با رمز مدیر، افزایش بی‌رمز)؛ before = خودکار، after = واردشده.
   */
  SALE_CHARGE_OVERRIDE: 'SALE_CHARGE_OVERRIDE',
  /** بند ۱۸ — صدور اعتبار بالاتر از سقف تنظیمات (با گیت مدیر) */
  STORE_CREDIT_OVER_LIMIT: 'STORE_CREDIT_OVER_LIMIT',
  /** بند ۱۷ — ثبت/ویرایش/حذف در دوره‌ی بسته‌شده (تجمیع یا بستن صندوق) */
  CLOSED_PERIOD_OVERRIDE: 'CLOSED_PERIOD_OVERRIDE',
  /** بند ۷ — دیدن بخش هشدارهای ضدتقلب (چه کسی، چه بازه‌ای) */
  FRAUD_REVIEW: 'FRAUD_REVIEW',

  /**
   * ====================== جلسه ۲۰ — «مدیریت اعتبار خرید» ======================
   * §۱۰ سند مرجع: هر تغییر مهم روی یک اعتبار باید با نوع رویداد، زمان، کاربر،
   * مقدار قبل/بعد، دلیل و سند مرجع ثبت شود. همه‌ی این‌ها روی همان جدول
   * `AuditLog` می‌نشینند (سیستم لاگ موازی ساخته نشد)، و `Timeline` صفحه‌ی
   * جزئیات هر اعتبار دقیقاً از همین ردیف‌ها + جدول مصرف‌ها ساخته می‌شود.
   */
  /** صدور دستی یک اعتبار توسط مدیریت (source = MANUAL) */
  CREDIT_ISSUE_MANUAL: 'CREDIT_ISSUE_MANUAL',
  /** تولید گروهی (§۵) — یک ردیف برای کل دسته + یک ردیف صدور برای هر اعتبار */
  CREDIT_BULK_GENERATE: 'CREDIT_BULK_GENERATE',
  /** ابطال (تغییر وضعیت، نه حذف — §۱۱) */
  CREDIT_VOID: 'CREDIT_VOID',
  /** تعلیق موقت */
  CREDIT_SUSPEND: 'CREDIT_SUSPEND',
  /** فعال‌سازی مجدد (از تعلیق یا انقضا) */
  CREDIT_REACTIVATE: 'CREDIT_REACTIVATE',
  /** تغییر تاریخ انقضا (با دلیل اجباری) */
  CREDIT_EXPIRY_CHANGE: 'CREDIT_EXPIRY_CHANGE',
  /** تغییر مبلغ (با دلیل اجباری؛ روی اعتبار مصرف‌شده ممنوع) */
  CREDIT_AMOUNT_CHANGE: 'CREDIT_AMOUNT_CHANGE',
  /** تغییر دفعات مجاز مصرف */
  CREDIT_USES_CHANGE: 'CREDIT_USES_CHANGE',
  /** تغییر دارنده/اطلاعات گیرنده */
  CREDIT_HOLDER_CHANGE: 'CREDIT_HOLDER_CHANGE',
  /** تغییر محدودیت کالا/دسته/مشتری */
  CREDIT_RESTRICTION_CHANGE: 'CREDIT_RESTRICTION_CHANGE',
  /** حذف واقعی یک اعتبارِ بدون هیچ مصرف (§۱۱) */
  CREDIT_DELETE: 'CREDIT_DELETE',
  /** آرشیو (Soft Delete) یک اعتبارِ مصرف‌شده — سابقه‌ی حسابداری حفظ می‌شود */
  CREDIT_ARCHIVE: 'CREDIT_ARCHIVE',
  /** چاپ سند اعتبار (نسخه‌ی اول) */
  CREDIT_PRINT: 'CREDIT_PRINT',
  /** چاپ مجدد (روی کاغذ برچسب «نسخه‌ی مجدد» می‌خورد — §۱۳) */
  CREDIT_REPRINT: 'CREDIT_REPRINT',
  /** ثبت یک یادآوری در صف (بدون هیچ ارسال واقعی — §۱۴) */
  CREDIT_REMINDER_QUEUE: 'CREDIT_REMINDER_QUEUE',
  /** تغییر تنظیمات مرکزی اعتبار خرید (§۲۲) */
  CREDIT_SETTINGS_UPDATE: 'CREDIT_SETTINGS_UPDATE',
  /** تلاش ناموفق/مسدودشده‌ی مصرف (کد اشتباه، brute-force، محدودیت) — §۸ */
  CREDIT_REDEEM_BLOCKED: 'CREDIT_REDEEM_BLOCKED',
  /** عملیات متوقف‌شده به‌دلیل کمبود فضای کد (§۶) */
  CREDIT_CODE_SPACE_BLOCKED: 'CREDIT_CODE_SPACE_BLOCKED',

  // ---------------------------------------------------------------------------
  // پنل پیامکی — عمل‌های مدیریتی. تلاش‌های تک‌تکِ ارسال اینجا نمی‌آیند (جایشان
  // جدول `SmsAttempt` است)؛ اینجا فقط «تصمیم‌های آدم» ثبت می‌شود.
  // ---------------------------------------------------------------------------
  /** تغییر تنظیمات یک سرویس‌دهنده‌ی پیامک (کلید API هرگز در لاگ نمی‌آید) */
  SMS_PROVIDER_SAVE: 'SMS_PROVIDER_SAVE',
  /** تغییر سرویس‌دهنده‌ی فعال */
  SMS_PROVIDER_ACTIVATE: 'SMS_PROVIDER_ACTIVATE',
  /** تست اتصال به سرویس‌دهنده */
  SMS_PROVIDER_TEST: 'SMS_PROVIDER_TEST',
  /** ثبت/ویرایش قالب متن پیام */
  SMS_TEMPLATE_SAVE: 'SMS_TEMPLATE_SAVE',
  /** بازگرداندن یک قالب به متن پیش‌فرض */
  SMS_TEMPLATE_RESET: 'SMS_TEMPLATE_RESET',
  /** ثبت یک پیام در صف (دستی/انبوه/تست) */
  SMS_OUTBOX_ENQUEUE: 'SMS_OUTBOX_ENQUEUE',
  /** لغو دستی ارسال یک پیام ارسال‌نشده */
  SMS_OUTBOX_CANCEL: 'SMS_OUTBOX_CANCEL',
  /** برگرداندن یک پیام لغوشده به صف */
  SMS_OUTBOX_REQUEUE: 'SMS_OUTBOX_REQUEUE',
  /** تلاش مجدد دستی روی یک پیام ناموفق */
  SMS_OUTBOX_RETRY: 'SMS_OUTBOX_RETRY',
  /** لغو گروهی چند پیام با هم */
  SMS_OUTBOX_CANCEL_BULK: 'SMS_OUTBOX_CANCEL_BULK',
  /** تغییر تنظیمات پنل پیامکی (قیمت هر پیامک، امضای لغو، ارسال خودکار) */
  SMS_SETTINGS_UPDATE: 'SMS_SETTINGS_UPDATE',
  /** ثبت کمپین پیامک انبوه (مخاطب، هزینه، صف) */
  SMS_CAMPAIGN_CREATE: 'SMS_CAMPAIGN_CREATE',
  /** ثبت «لغو ۱۱» برای یک شماره */
  SMS_OPT_OUT_ADD: 'SMS_OPT_OUT_ADD',
  /** حذف یک شماره از فهرست لغو */
  SMS_OPT_OUT_REMOVE: 'SMS_OPT_OUT_REMOVE',
  /** اجرای زمان‌بند خودکار یادآوری اعتبار */
  SMS_AUTO_RUN: 'SMS_AUTO_RUN'
} as const

/** وضعیت یک روز در پنل «تجمیع و انتقال». */
export const ConsolidationDayState = {
  /** هیچ فروشی در آن روز ثبت نشده */
  EMPTY: 'EMPTY',
  /** فروش دارد و هنوز تجمیع نشده (کسر انبار قطعی نشده) */
  PENDING: 'PENDING',
  /** تجمیع شده؛ دوباره نباید کسر شود */
  DONE: 'DONE',
  /** بخشی تجمیع شده و بخشی نه (مثلاً فاکتور بعد از تجمیع ثبت شده) */
  PARTIAL: 'PARTIAL'
} as const
export type ConsolidationDayState = (typeof ConsolidationDayState)[keyof typeof ConsolidationDayState]

export const CONSOLIDATION_DAY_LABELS: Record<string, string> = {
  EMPTY: 'بدون فروش',
  PENDING: 'تجمیع نشده',
  DONE: 'تجمیع شده',
  PARTIAL: 'ناقص (فاکتور تجمیع‌نشده دارد)'
}

// ===========================================================================
// جلسه ۱۷ · بند ۱ — «درخواست‌های کارت‌به‌کارت»
// ===========================================================================

/** REQUEST = درخواست پرداخت · ADJUSTMENT = رویداد اصلاحیِ یک درخواست ثبت‌شده. */
export const CardTransferKind = {
  REQUEST: 'REQUEST',
  ADJUSTMENT: 'ADJUSTMENT'
} as const
export type CardTransferKind = (typeof CardTransferKind)[keyof typeof CardTransferKind]

export const CARD_TRANSFER_KIND_LABELS: Record<string, string> = {
  REQUEST: 'درخواست پرداخت',
  ADJUSTMENT: 'رویداد اصلاحی'
}

/**
 * وضعیت یک درخواست کارت‌به‌کارت.
 * `ADJUSTED` یعنی بعدها یک رویداد اصلاحیِ *جدید* روی این ردیف ثبت شده است؛
 * خودِ ردیف هیچ‌وقت ویرایش یا حذف نمی‌شود (اصل «سابقه از بین نمی‌رود»).
 */
export const CardTransferStatus = {
  PENDING: 'PENDING',
  PAID: 'PAID',
  ADJUSTED: 'ADJUSTED',
  /**
   * جلسه ۴۰ · کار ب — «رد/لغو شد».
   * مدیر پرداخت را رد کرده یا سند برگشت مرجع حذف/باطل شده است. رکورد **حذف
   * نمی‌شود** (قاعده‌ی ۲ بالای `CardTransferService`)؛ فقط برچسب و دلیل می‌گیرد.
   * ⚠️ لغو، به‌خودیِ‌خود کالای معلق را به موجودی قابل‌فروش برنمی‌گرداند: تکلیف
   * کالا یک تصمیم جداگانه و صریح است (`cancel({ releaseStock })`).
   */
  CANCELED: 'CANCELED'
} as const
export type CardTransferStatus = (typeof CardTransferStatus)[keyof typeof CardTransferStatus]

export const CARD_TRANSFER_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در انتظار پرداخت',
  PAID: 'پرداخت شد',
  ADJUSTED: 'اصلاح‌شده با رویداد بعدی',
  CANCELED: 'رد/لغو شد'
}

/** روش پرداختی که مدیر ثبت می‌کند (فعلاً فقط یک مقدار، ولی صریح ثبت می‌شود). */
export const CARD_TRANSFER_METHOD = 'MANAGER_CARD_TO_CARD'
export const CARD_TRANSFER_METHOD_LABELS: Record<string, string> = {
  MANAGER_CARD_TO_CARD: 'کارت‌به‌کارت توسط مدیر'
}

/** برچسب نوع عملیات مرجع یک درخواست کارت‌به‌کارت. */
export const CARD_TRANSFER_OPERATION_LABELS: Record<string, string> = {
  RETURN: 'برگشت از فروش',
  EXCHANGE: 'تعویض کالا'
}

// ===========================================================================
// جلسه ۱۷ · بند ۲ (زیرساخت) — نقش کارمندان
// همان سه مقداری که از اول در `prisma/schema.prisma` روی `User.role` نوشته شده
// بود؛ اینجا فقط برچسب فارسی و یک تابع پاک‌سازی برایشان اضافه می‌شود.
// ===========================================================================
export const STAFF_ROLES = ['MANAGER', 'CASHIER', 'STOCKKEEPER'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const STAFF_ROLE_LABELS: Record<string, string> = {
  MANAGER: 'مدیر',
  CASHIER: 'صندوق‌دار / فروشنده',
  STOCKKEEPER: 'انباردار'
}

/** ورودی ناشناس ⇒ یک نقش معتبر (پیش‌فرض: صندوق‌دار). */
export function normalizeStaffRole(raw: unknown): StaffRole {
  const v = String(raw ?? '').trim().toUpperCase()
  return (STAFF_ROLES as readonly string[]).includes(v) ? (v as StaffRole) : 'CASHIER'
}
