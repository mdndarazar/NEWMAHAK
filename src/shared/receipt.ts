/**
 * ---------------------------------------------------------------------------
 * تنظیمات قابل‌شخصی‌سازی «قالب فاکتور چاپی» + پیش‌فرض‌های فروش و شیفت.
 *
 * چرا اینجا (shared)؟ هم main (برای ساخت HTML چاپ) و هم renderer (برای پنل
 * تنظیمات و پیش‌نمایش) به یک تعریف واحد نیاز دارند. ذخیره‌سازی روی جدول
 * `Setting` انجام می‌شود (کلید/مقدار JSON) تا برای هر فیلد تنظیمات یک
 * migration جدید لازم نباشد.
 *
 * قاعده: چیدمان کلی رسید ثابت است (مطابق رسید فعلی فروشگاه) و تنظیمات فقط
 * «روشن/خاموش کردن فیلدها» و «متن‌ها» را عوض می‌کند، نه ساختار را.
 * ---------------------------------------------------------------------------
 */
// نشست ۲۲۲ · فاز ۱ — نوع preset کاغذ و بازه‌های مجاز از همان منبع حقیقتِ اندازه
import {
  isLabelPrintMethod,
  isLabelSensorType,
  isReceiptPaperPreset,
  LABEL_ROLL_LIMITS,
  presetToSpec,
  RECEIPT_SIZE_LIMITS,
  type LabelPrintMethod,
  type LabelSensorType,
  type ReceiptPaperPreset
} from './printSpec'

/** کلیدهای جدول Setting. یک‌جا، تا در main و renderer یکسان بمانند. */
export const SETTING_KEYS = {
  receiptTemplate: 'receipt.template',
  saleDefaults: 'sale.defaults',
  shiftConfig: 'shift.config',
  /** رمز مدیریتی پنل تنظیمات / کالاها / فاکتور خرید (هش‌شده، هرگز خام) */
  managerAuth: 'manager.auth',
  /**
   * «رمز دوم اختصاصی» هر پنل قفل‌دار (هش‌شده، هرگز خام).
   *
   * یک JSON از نوع { [کلید پنل]: { salt, hash, enabled, changedAt } }. تا وقتی
   * کلید یک پنل اینجا نباشد (یا enabled خاموش باشد)، رفتار همان قبل است: فقط
   * رمز مدیر آن پنل را باز می‌کند. رمز مدیر همیشه و بی‌استثنا همه را باز می‌کند.
   */
  panelAuth: 'panel.auth',
  /**
   * ⚠️ کلیدهای قدیمیِ عوارض/حق سرویس (بدون تفکیک پنل).
   * دیگر خوانده نمی‌شوند مگر یک بار در لحظه‌ی مهاجرت به کلیدهای اسکوپ‌دار
   * (`charges.tax.pos` / `charges.tax.wholesale` / …) در SettingsService.
   */
  taxCharge: 'charges.tax',
  serviceChargeByCategory: 'charges.service',
  /** فهرست بکاپ‌های وارد/آپلود‌شده (تاریخ، حجم، حالت اعمال) */
  backupImports: 'backup.imports',
  /**
   * تنظیمات «چاپ لیبل» (مورد ۵ و ۸) — کاملاً مستقل از قالب و چاپگر فاکتور:
   * چاپگر لیبل‌زن، ابعاد لیبل، و این‌که اسم کالا روی لیبل چاپ شود یا نه.
   */
  labelTemplate: 'label.template',
  /** تنظیمات بکاپ خودکار (مورد ۶): مسیر ذخیره‌سازی + بازه‌ی زمانی + تعداد نسخه */
  backupConfig: 'backup.config',
  /**
   * تنظیمات امنیتی «قفل موقت بعد از رمز اشتباه» (بخش ۲).
   * فقط از پنل تنظیمات → «رمز و امنیت» قابل تغییر است (که خودش قفل مدیر دارد).
   */
  securityConfig: 'security.config',
  /**
   * بند ۱ — «قفل ماژول‌ها»: برای هر پنل قفل‌دار، قفل رمز دوم روشن است یا خاموش.
   * شکل مقدار و همه‌ی قواعدش در `src/shared/panels.ts` توضیح داده شده
   * (`parsePanelLocks` / `isPanelLockEnabled`).
   *
   * ⚠️ پیش‌فرض مطلق: هر کلیدی که اینجا نباشد **قفل** است. پس نبودن این رکورد
   * (نصب تازه، یا پاک شدن دستی‌اش) یعنی «همه‌چیز قفل»، نه برعکس.
   */
  panelLocks: 'panel.locks',
  /**
   * بند ۳ — سیاست تخفیف پنل فروش: تخفیف آزاد است، فقط یک تخفیف ثابتِ
   * تعیین‌شده‌ی مدیر مجاز است، یا کاملاً غیرفعال. فقط از ماژول «تخفیف و
   * افزایش/کاهش قیمت» قابل تغییر است (که خودش قفل رمز دارد).
   */
  discountPolicy: 'sale.discountPolicy',
  /**
   * ====================== جلسه ۱۴ ======================
   * سیاست حسابداری صندوق و اعتبار خرید. شکل مقدار:
   *   {
   *     cashDifferenceThreshold: number   // بند ۴ — آستانه‌ی اجبار یادداشت (ریال)
   *     storeCreditLimit: number          // بند ۱۸ — سقف صدور اعتبار بدون گیت مدیر
   *     requireManagerForPriceOverride: boolean
   *     lockClosedPeriods: boolean        // بند ۱۷ — قفل دوره‌ی بسته‌شده
   *   }
   * نبودن این رکورد ⇒ مقادیر پیش‌فرض `DEFAULT_ACCOUNTING_POLICY` (محافظه‌کارانه).
   */
  stocktakeSchedule: 'stocktake.schedule',
  /** لاگ بستن هشدار نسیه/چک سررسیدشده (شیفت و زمان) — پول جابه‌جا نمی‌کند */
  debtReminderLog: 'debtReminder.log',
  accountingPolicy: 'accounting.policy',
  /**
   * جلسه ۱۷ · بند ۲ — «کارمند فعالِ پشت سیستم».
   *
   * تب «عملکرد کارمندان» بر پایه‌ی `userId` روی فاکتور/برگشت/تعویض کار می‌کند،
   * ولی تا این نسخه هیچ‌جای برنامه این `userId` را پر نمی‌کرد (همه‌ی رکوردها
   * `userId = null` می‌گرفتند و گزارش فقط یک ردیف «نامشخص» می‌داد). این کلید
   * شماره‌ی کارمندی را نگه می‌دارد که همین حالا پشت سیستم است و لایه‌ی IPC آن را
   * روی سندهای تازه می‌نشاند.
   *
   * ⚠️ این یک سازوکار *ورود کاربر* یا قفل جدید نیست و هیچ چیزی را مسدود نمی‌کند:
   * فقط یک برچسب «چه کسی ثبت کرد» است. خالی بودنش رفتار قبلی را عیناً برمی‌گرداند.
   */
  activeStaff: 'staff.active',
  /**
   * جلسه ۱۹ · بند ۹ — «تاریخ و ساعت رسمی».
   *
   * فقط یک افست دستی (به ساعت) که مدیر می‌تواند خودش تنظیم کند تا اگر روزی
   * قانون ساعت رسمی کشور عوض شد (تغییر ساعت فصلی، یا هر دلیل مشابه)، بدون
   * نیاز به توسعه‌ی نرم‌افزاری جدید، همه‌ی محاسبات ساعتی (تشخیص شیفت و
   * گزارش‌های زمانی) یک ساعت جلو/عقب بروند. پیش‌فرض صفر ⇒ رفتار مو‌به‌موی قبل.
   */
  officialTime: 'time.official',
  /**
   * جلسه ۲۰ · §۲۲ — تنظیمات مرکزی «اعتبار خرید».
   *
   * طول کد، مجموعه‌ی کاراکتر، پیشوند نمایشی، مدت اعتبار و دفعات مصرفِ پیش‌فرضِ
   * **هر نوع** (MANUAL / EXCHANGE)، قواعد تولید گروهی، تنظیمات بارکد و اندازه‌ی
   * چاپ سند اعتبار، و محدودیت‌های ارسال یادآوری.
   *
   * شکل مقدار و همه‌ی پیش‌فرض‌ها در `src/shared/credit.ts` است
   * (`CreditSettings` / `DEFAULT_CREDIT_SETTINGS` / `parseCreditSettings`) تا
   * main و renderer یک منبع حقیقت داشته باشند. نبودن این رکورد ⇒ دقیقاً همان
   * پیش‌فرض‌ها، یعنی رفتار تاریخیِ اعتبار تعویض (۱ بار مصرف، پیشوند `E`).
   *
   * ⚠️ این کلید **جایگزین** تنظیمات چاپ نیست: اندازه‌ی کاغذ سند اعتبار از همین
   * کلید خوانده می‌شود ولی نام چاپگر، لوگو، نام/تلفن فروشگاه و بقیه‌ی هویت چاپ
   * همان `receipt.template` است (§۱۳ — سیستم تنظیمات چاپ جدا ساخته نشد).
   */
  creditSettings: 'credit.settings',
  /** ماژول اختیاری حضانت صندوق/نشست کارکنان؛ پیش‌فرض خاموش تا رفتار قدیمی دست‌نخورده بماند. */
  custodyConfig: 'custody.config'
} as const

export type CustodyMode = 'SINGLE_SHIFT' | 'MULTI_SHIFT'
export interface CustodyConfig {
  enabled: boolean
  mode: CustodyMode
  onboardingDismissedAt: string | null
  onboardingDismissedBy: number | null
  reminderEnabled: boolean
  dayCutoverMinute: number
  overrunGraceMinutes: number
  continueMaxMinutes: number
}

export const DEFAULT_CUSTODY_CONFIG: CustodyConfig = {
  enabled: false,
  mode: 'SINGLE_SHIFT',
  onboardingDismissedAt: null,
  onboardingDismissedBy: null,
  reminderEnabled: true,
  dayCutoverMinute: 300,
  overrunGraceMinutes: 60,
  continueMaxMinutes: 240
}

export function parseCustodyConfig(raw: unknown): CustodyConfig {
  let value: unknown = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = null
    }
  }
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const whole = (input: unknown, fallback: number, min: number, max: number) => {
    const n = Math.round(Number(input))
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback
  }
  return {
    enabled: o.enabled === true,
    mode: o.mode === 'MULTI_SHIFT' ? 'MULTI_SHIFT' : 'SINGLE_SHIFT',
    onboardingDismissedAt: typeof o.onboardingDismissedAt === 'string' ? o.onboardingDismissedAt : null,
    onboardingDismissedBy: whole(o.onboardingDismissedBy, 0, 1, Number.MAX_SAFE_INTEGER) || null,
    reminderEnabled: o.reminderEnabled !== false,
    dayCutoverMinute: whole(o.dayCutoverMinute, DEFAULT_CUSTODY_CONFIG.dayCutoverMinute, 0, 1439),
    overrunGraceMinutes: whole(o.overrunGraceMinutes, DEFAULT_CUSTODY_CONFIG.overrunGraceMinutes, 0, 720),
    continueMaxMinutes: whole(o.continueMaxMinutes, DEFAULT_CUSTODY_CONFIG.continueMaxMinutes, 0, 720)
  }
}

/**
 * ---------------------------------------------------------------------------
 * پیش‌فرض‌های سیاست حسابداری (جلسه ۱۴).
 *
 * هر سه پیش‌فرض عمداً **سخت‌گیرانه** انتخاب شده‌اند: نصب تازه یا پاک‌شدن دستی
 * این رکورد باید به «امن‌تر» منتهی شود، نه به «بازتر». آستانه‌ی ۱۰۰٬۰۰۰ ریال
 * همان عددی است که سند مرجع خواسته.
 * ---------------------------------------------------------------------------
 */
export interface AccountingPolicy {
  /** قدرمطلق مغایرت صندوق بالاتر از این ⇒ نوشتن یادداشت اجباری */
  cashDifferenceThreshold: number
  /** صدور اعتبار خرید بالاتر از این ⇒ گیت مدیر اجباری (۰ = بدون سقف) */
  storeCreditLimit: number
  /** قیمت دستیِ کالای جایگزین در تعویض، گیت مدیر لازم دارد؟ */
  requireManagerForPriceOverride: boolean
  /** ثبت/ویرایش در دوره‌ی «تجمیع‌شده» یا «صندوق‌بسته» گیت مدیر لازم دارد؟ */
  lockClosedPeriods: boolean
  /**
   * جلسه ۱۷ · بند ۳ — «آستانه‌ی درصد تخفیف غیرعادی».
   * فاکتوری که درصد تخفیفش از این عدد بالاتر باشد در فهرست «تخفیف‌های غیرعادی»
   * گزارشات فروش دیده می‌شود. ⚠️ این آستانه **هیچ چیزی را مسدود نمی‌کند** و هیچ
   * قفل تجاری‌ای نیست؛ فقط یک فیلترِ دیدنی است (اصل «هشدار، نه دیوار»).
   * ۰ = خاموش (هیچ فاکتوری غیرعادی حساب نمی‌شود).
   */
  abnormalDiscountPercent: number
}

export const DEFAULT_ACCOUNTING_POLICY: AccountingPolicy = {
  cashDifferenceThreshold: 100_000,
  storeCreditLimit: 20_000_000,
  requireManagerForPriceOverride: true,
  lockClosedPeriods: true,
  abnormalDiscountPercent: 30
}

export function parseAccountingPolicy(raw: unknown): AccountingPolicy {
  let parsed: unknown = raw
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const num = (v: unknown, fallback: number) => {
    const x = Math.round(Number(v))
    return Number.isFinite(x) && x >= 0 ? x : fallback
  }
  return {
    cashDifferenceThreshold: num(o.cashDifferenceThreshold, DEFAULT_ACCOUNTING_POLICY.cashDifferenceThreshold),
    storeCreditLimit: num(o.storeCreditLimit, DEFAULT_ACCOUNTING_POLICY.storeCreditLimit),
    requireManagerForPriceOverride:
      o.requireManagerForPriceOverride == null
        ? DEFAULT_ACCOUNTING_POLICY.requireManagerForPriceOverride
        : o.requireManagerForPriceOverride !== false,
    lockClosedPeriods:
      o.lockClosedPeriods == null ? DEFAULT_ACCOUNTING_POLICY.lockClosedPeriods : o.lockClosedPeriods !== false,
    // بند ۳ — درصد است، پس بین ۰ و ۱۰۰ کلمپ می‌شود
    abnormalDiscountPercent: Math.min(
      100,
      num(o.abnormalDiscountPercent, DEFAULT_ACCOUNTING_POLICY.abnormalDiscountPercent)
    )
  }
}

/**
 * رمز مدیریتی پیش‌فرض (قابل تغییر از داخل پنل تنظیمات).
 *
 * ⚠️ فقط روی نصب *تازه* اثر دارد: اگر روی این سیستم قبلاً رمز ست شده باشد
 * (کلید `manager.auth` در جدول Setting)، همان رمز فعلی معتبر می‌ماند و این
 * مقدار نادیده گرفته می‌شود.
 */
export const DEFAULT_MANAGER_PASSWORD = '1111'

/**
 * رمزهای پیش‌فرضِ *نسخه‌های قبلی* برنامه.
 *
 * چرا لازم است؟ رمز پیش‌فرض بار اولی که استفاده می‌شود هش و در جدول `Setting`
 * ذخیره می‌گردد (با پرچم `isDefault: true` یعنی «کاربر خودش رمز نگذاشته»).
 * پس عوض کردن مقدار `DEFAULT_MANAGER_PASSWORD` در کد، روی سیستمی که از قبل
 * رمز پیش‌فرضِ قدیمی را ذخیره کرده هیچ اثری نداشت و همان رمز قدیمی کار می‌کرد —
 * همان باگی که «رمز پیش‌فرض عوض نشد» را می‌ساخت.
 *
 * راه‌حل: اگر رکورد ذخیره‌شده هنوز «پیش‌فرض» باشد و هشش با یکی از این رمزهای
 * قدیمی بخواند، همان لحظه به رمز پیش‌فرض جدید چرخانده می‌شود.
 * ⚠️ رمزی که *خودِ کاربر* از پنل تنظیمات گذاشته باشد `isDefault: false` است و
 * هیچ‌وقت لمس نمی‌شود.
 */
export const LEGACY_DEFAULT_MANAGER_PASSWORDS: readonly string[] = ['13431374']

export interface ReceiptTemplate {
  /** سرصفحه */
  shopName: string
  phone: string
  website: string

  /** روشن/خاموش کردن فیلدها (چیدمان ثابت می‌ماند) */
  showDateTime: boolean
  showReceiptNo: boolean
  showOrderType: boolean
  showTable: boolean
  showCustomer: boolean
  showCashier: boolean
  showRowNumber: boolean
  showUnitPrice: boolean
  showGoodsTotal: boolean
  showServiceCharge: boolean
  showDiscount: boolean
  showTax: boolean
  showPayable: boolean
  /** مبلغ پرداختی مشتری روی فاکتور چاپی */
  showPaid: boolean
  /** مانده‌حساب (جمع کل منهای پرداختی) روی فاکتور چاپی */
  showRemaining: boolean
  showPaymentMethod: boolean
  showReturnCode: boolean
  showReturnBarcode: boolean
  /**
   * «نمایش مهلت برگشت روی فاکتور» (مورد ۷).
   * خاموش = هیچ چیزی از بلوک برگشت از فروش روی رسید چاپ نمی‌شود: نه کد فاکتور،
   * نه بارکدش، نه تاریخ مهلت. منطق داخلی (تولید و اعتبارسنجی کد) دست‌نخورده
   * می‌ماند، پس اگر بعداً روشنش کنید فاکتورهای همان بازه هم قابل برگشت‌اند.
   */
  showReturnDeadline: boolean
  showPhone: boolean
  showWebsite: boolean

  /** برچسب‌ها (قابل تغییر) */
  receiptNoLabel: string
  tableLabel: string
  customerLabel: string
  goodsTotalLabel: string
  serviceChargeLabel: string
  discountLabel: string
  taxLabel: string
  payableLabel: string
  paidLabel: string
  remainingLabel: string
  paymentLabel: string
  returnCodeLabel: string

  /** پیام‌های پایانی رسید */
  footerLine1: string
  footerLine2: string
  footerLine3: string

  /** چاپ */
  paperWidthMm: number
  fontSizePx: number
  copies: number
  autoPrint: boolean
  printerName: string

  /**
   * =====================================================================
   * نشست ۲۲۲ · فاز ۱ طرح چاپ — فیلدهای «اندازه‌ی کاغذ فاکتور» (بخش ۵.۲ طرح).
   *
   * همه تخت‌اند (محدودیت `merge`) و روی همین کلید `receipt.template` می‌نشینند؛
   * هیچ کلید تنظیمات جدیدی ساخته نشد. مهاجرت تنبل است: قالب قدیمی که این فیلدها
   * را ندارد، هنگام parse مقدار پیش‌فرض/مشتق می‌گیرد و ظاهرش مو‌به‌مو مثل قبل
   * می‌ماند (۷۲mm ⇒ کاغذ ۸۰mm، ضریب فونت ۱ ⇒ همان ۱۲px).
   * ===================================================================== */

  /**
   * «هر بار بپرس با کدام چاپگر» — مستقل از `autoPrint` (آن یعنی «بعد از فروش
   * خودکار چاپ شود»). پیش‌فرض `false` تا رفتار فعلی (چاپ بی‌صدا) حفظ شود.
   */
  askEachTime: boolean
  /** preset کاغذ؛ اگر غایب باشد از `paperWidthMm` مشتق می‌شود (جدول ۵.۴). */
  paperPreset: ReceiptPaperPreset
  /** عرض فیزیکی کاغذ که به چاپگر اعلام می‌شود (۴۰ تا ۳۰۰) */
  sheetWidthMm: number
  /** ارتفاع ثابت کاغذ؛ `0` = طول خودکار (رول پیوسته با کاتر) */
  sheetHeightMm: number
  /** حاشیه‌ی چپ/راست — همان `padding` قدیمی `body` (پیش‌فرض ۴mm) */
  marginXMm: number
  /** حاشیه‌ی بالا/پایین — همان `padding` قدیمی `body` (پیش‌فرض ۶mm) */
  marginYMm: number
  /** فونت متناسب با عرض قابل‌چاپ؛ برای ۷۲mm دقیقاً ضریب ۱ (بدون تغییر ظاهر) */
  autoFont: boolean
  /** حاشیه‌ی ایمنی پایین در حالت «ارتفاع خودکار» (۰ تا ۱۰ میلی‌متر) */
  heightSafetyMm: number
  /** موتور چاپ این پروفایل (فاز ۵ برای RAW؛ پیش‌فرض CHROMIUM) */
  printMethod: 'CHROMIUM' | 'RAW'
  /** DPI چاپگر برای مسیر RAW (۲۰۳ یا ۳۰۰) */
  rawDpi: number
  /** معکوس‌کردن قطبیت بیت‌های تصویر در مسیر RAW (برای دستگاه‌هایی که سفید/مشکی را برعکس می‌گیرند) */
  rawInvert: boolean
  /** برش بعد از هر کار در مسیر RAW (ESC/POS) */
  cutMode: 'FULL' | 'PARTIAL' | 'NONE'
  /** در حالت «بپرس»، دیالوگ خود ویندوز به‌جای پنجره‌ی انتخاب برنامه */
  useSystemDialog: boolean
  /** فاکتور عمده کاغذ/چاپگر جدا دارد؟ (پیش‌فرض خاموش ⇒ عمده = تکی) */
  wholesaleSeparate: boolean
  wholesalePrinterName: string
  wholesaleSheetWidthMm: number
  wholesaleSheetHeightMm: number
  /** عرض قابل‌چاپ فاکتور عمده (پیش‌نهاد A5: ۱۹۰) */
  wholesalePaperWidthMm: number

  /**
   * بند ۷ (جلسه ۳۱) — §۱۳: لوگوی سند اعتبار.
   *
   * تا جلسه ۳۰ این قالب هیچ فیلد لوگویی نداشت و `creditDocBody` صریحاً نوشته
   * بود «این قالب لوگو ندارد». لوگو یک بار در تنظیمات لیبل آپلود می‌شود
   * (`LabelTemplate.logoDataUrl`، مشترک همه‌ی قالب‌ها)، پس `logoDataUrl` اینجا
   * معمولاً **خالی** می‌ماند و `SettingsService.receiptTemplate()` آن را از
   * همان لوگوی لیبل پر می‌کند؛ مقدار غیرخالی یعنی کاربر برای رسید/سند یک
   * لوگوی متفاوت خواسته است.
   *
   * ⚠️ پیش‌فرض `showLogo` خاموش است تا رسیدهای فعلی فروشگاه مو‌به‌مو مثل قبل
   * چاپ شوند؛ تیکش در تنظیمات ← قالب رسید است.
   */
  showLogo: boolean
  logoHeightMm: number
  logoDataUrl: string
}

/** پیش‌فرض‌ها مطابق رسید فعلی فروشگاه. */
export const DEFAULT_RECEIPT_TEMPLATE: ReceiptTemplate = {
  shopName: 'فروشگاه',
  phone: '',
  website: '',

  showDateTime: true,
  showReceiptNo: true,
  showOrderType: true,
  showTable: true,
  showCustomer: true,
  showCashier: false,
  showRowNumber: true,
  showUnitPrice: false,
  showGoodsTotal: true,
  showServiceCharge: true,
  showDiscount: true,
  showTax: true,
  showPayable: true,
  showPaid: true,
  showRemaining: true,
  showPaymentMethod: true,
  showReturnCode: true,
  showReturnBarcode: true,
  showReturnDeadline: true,
  showPhone: true,
  showWebsite: false,

  receiptNoLabel: 'شماره',
  tableLabel: 'میز',
  customerLabel: 'اشتراک',
  goodsTotalLabel: 'جمع کل',
  serviceChargeLabel: 'حق سرویس',
  discountLabel: 'تخفیف',
  taxLabel: 'مالیات و عوارض',
  payableLabel: 'قابل پرداخت',
  paidLabel: 'مبلغ پرداختی',
  remainingLabel: 'مانده حساب',
  paymentLabel: 'نحوه پرداخت',
  returnCodeLabel: 'کد فاکتور (برگشت از فروش)',

  footerLine1: 'کیفیت هنر ماست',
  footerLine2: '',
  footerLine3: '',

  paperWidthMm: 72,
  fontSizePx: 12,
  copies: 1,
  autoPrint: true,
  printerName: '',

  /**
   * نشست ۲۲۲ · فاز ۱ — پیش‌فرض‌ها مطابق جدول ۵.۲/۵.۴ طرح: کاغذ ۸۰ با عرض
   * قابل‌چاپ ۷۲ (یعنی محتوای امروزِ فروشگاه، چون `padding` ۴mm هر طرف همیشه
   * مجموع را ۸۰mm می‌کرد) و طول خودکار.
   */
  askEachTime: false,
  paperPreset: 'THERMAL_80',
  sheetWidthMm: 80,
  sheetHeightMm: 0,
  marginXMm: 4,
  marginYMm: 6,
  autoFont: true,
  heightSafetyMm: 3,
  printMethod: 'CHROMIUM',
  rawDpi: 203,
  rawInvert: false,
  cutMode: 'FULL',
  useSystemDialog: false,
  wholesaleSeparate: false,
  wholesalePrinterName: '',
  wholesaleSheetWidthMm: 210,
  wholesaleSheetHeightMm: 0,
  wholesalePaperWidthMm: 190,

  // بند ۷ (جلسه ۳۱) — پیش‌فرض خاموش؛ ارتفاع همان پیش‌فرض لیبل (۱۰mm سند بزرگ‌تر است)
  showLogo: false,
  logoHeightMm: 10,
  logoDataUrl: ''
}

/** پیش‌فرض‌های فروش تکی + قواعد کد فاکتور. */
export interface SaleDefaults {
  /**
   * ⚠️ منسوخ (legacy) — «درصد حق سرویس سراسری» نسخه‌ی قبلی.
   * حق سرویس حالا فقط از سیستم دسته‌بندی‌محور `charges.service.pos` /
   * `charges.service.wholesale` می‌آید. این فیلد فقط برای مهاجرت یک‌باره‌ی
   * مقدار قدیمی نگه داشته شده و در هیچ محاسبه‌ای استفاده نمی‌شود.
   */
  serviceChargePercent: number
  /** ⚠️ منسوخ (legacy) — «درصد مالیات سراسری» نسخه‌ی قبلی. مثل بالا، فقط مهاجرت. */
  taxPercent: number
  /** اعتبار کد فاکتور (برگشت از فروش) بر حسب روز — حالت عادی */
  returnCodeDays: number
  /**
   * اعتبار کد فاکتور برای «مشتری راه دور» (مورد ۷).
   * مستقل از حالت عادی است و فقط وقتی استفاده می‌شود که کارمند در پنل فروش
   * چک‌باکس «مشتری راه دور» را زده باشد. پیش‌فرض ۱۴ روز (دو برابر حالت عادی):
   * ارسال و برگشت مرسوله معمولاً بیشتر از یک هفته طول می‌کشد.
   */
  returnCodeDaysRemote: number
  /** طول کد رندوم فاکتور */
  returnCodeLength: number
  /** نام فروشنده‌ی نمایشی روی رسید */
  cashierName: string
  /**
   * ---------------------------------------------------------------------------
   * «کد فاکتور» فاکتور فروش عمده (مورد ۷) — همان قواعد فروش تکی، ولی مستقل.
   *
   * قبلاً کد فاکتور و مهلت برگشت فقط برای فروش تکی/خرده ساخته می‌شد
   * (`orderType !== WHOLESALE`). حالا فاکتور فروش عمده هم دقیقاً همان مسیر را
   * دارد: کد رندوم + بارکد روی رسید + اعتبار زمانی، ولی با اعداد *مستقل* خودش،
   * چون مهلت برگشت عمده معمولاً با خرده یکی نیست.
   *
   * `wholesaleReturnCode` خاموش = رفتار نسخه‌ی قبل (فاکتور عمده بدون کد).
   * ---------------------------------------------------------------------------
   */
  wholesaleReturnCode: boolean
  /** مهلت برگشت فاکتور عمده — حالت عادی (روز) */
  wholesaleReturnCodeDays: number
  /** مهلت برگشت فاکتور عمده — «مشتری راه دور» (روز) */
  wholesaleReturnCodeDaysRemote: number
  /** طول کد رندوم فاکتور عمده (کاراکتر) */
  wholesaleReturnCodeLength: number
  /**
   * ---------------------------------------------------------------------------
   * «چاپ فاکتور در پنل فروش تکی» (مورد ۳) — کلید اصلی چاپ.
   *
   * روشن (پیش‌فرض) = همان رفتار فعلی: چاپ خودکار طبق `receipt.autoPrint` و
   * دکمه‌ی «چاپ فاکتور» برای چاپ دستی.
   * خاموش = *هیچ* فاکتوری چاپ نمی‌شود، نه خودکار و نه دستی. ثبت فاکتور و ثبتش
   * در گزارشات فروش مطلقاً دست‌نخورده می‌ماند؛ این گزینه فقط جلوی «چاپ» را
   * می‌گیرد.
   * ---------------------------------------------------------------------------
   */
  printEnabled: boolean
  /**
   * «برداشت خودکار از انبار مرکزی هنگام کمبود موجودی فروشگاه».
   *
   * پیش‌فرض خاموش، و تا وقتی خاموش است رفتار برنامه *مو‌به‌مو* همان قبل است:
   * کمبود موجودی فقط هشدار می‌دهد و موجودی انبار فروشگاه منفی می‌شود.
   *
   * روشن که باشد، در لحظه‌ی ثبت فاکتور (پنل فروش تکی و فاکتور فروش عمده) کمبود
   * هر قلم از «انبار مرکزی» برداشته و به انبار فروشگاه منتقل می‌شود؛ پس موجودی
   * منفی نمی‌رود و یک هشدار زرد می‌گوید چه چیزی از انبار مرکزی کسر شد.
   *
   * اینجا (پیش‌فرض‌های فروش) ذخیره می‌شود تا تیک چک‌باکس با بستن برنامه پاک نشود.
   */
  autoCentralWithdraw: boolean
  /**
   * بعد از ثبت وصول نسیه، فیش پرداخت برای مشتری چاپ شود.
   * پیش‌فرض خاموش = رفتار امروز (فقط ثبت پرداخت، بدون چاپ اضافه).
   * روشن بودن این تیک مسیر پول را عوض نمی‌کند؛ چاپ بعد از commit است.
   */
  debtPaymentReceiptPrint: boolean
  /**
   * فعال‌بودن پرداخت ترکیبی «اعتبار خرید + نقد/کارت» در POS.
   * پیش‌فرض روشن است تا فروشگاه‌های موجود دقیقاً همان رفتار قبلی را نگه دارند.
   * خاموش = اعتبار همچنان کامل مصرف می‌شود، ولی درخواست مبلغِ دلخواهِ مصرف
   * پذیرفته نمی‌شود؛ main نیز این مرز را مستقل از UI اعمال می‌کند.
   */
  splitStoreCreditPayment: boolean
}

export const DEFAULT_SALE_DEFAULTS: SaleDefaults = {
  serviceChargePercent: 0,
  taxPercent: 0,
  returnCodeDays: 7,
  returnCodeDaysRemote: 14,
  returnCodeLength: 6,
  cashierName: 'مدیر',
  // مورد ۷: فاکتور فروش عمده هم مثل فروش تکی کد برگشت می‌گیرد
  wholesaleReturnCode: true,
  wholesaleReturnCodeDays: 7,
  wholesaleReturnCodeDaysRemote: 14,
  wholesaleReturnCodeLength: 6,
  // مورد ۳: پیش‌فرض = همان رفتار فعلی (فاکتور چاپ می‌شود)
  printEnabled: true,
  autoCentralWithdraw: false,
  debtPaymentReceiptPrint: false,
  // پرداخت ترکیبی پیشاپیش وجود داشته است؛ پیش‌فرض روشن مانع تغییر رفتار فروشگاه‌های قبلی است.
  splitStoreCreditPayment: true
}

/**
 * نشست ۱۶۸ (S168-D2، ریسک باز S166-D7 «تنظیمات کهنه در صفحه‌ی باز فروش») — sale برای عوض‌کردن *یک* سوییچ
 * پنل فروش (چاپ فاکتور / برداشت خودکار از انبار مرکزی): پیش‌فرض‌ها + sale *تازه‌ی سرور* + فقط همان patch.
 * قبلاً sale لحظه‌ی بازشدن پنل فرستاده می‌شد؛ اگر مدیر در این فاصله نام صندوق‌دار/مهلت کد برگشت را عوض کرده بود،
 * سرور آن را تغییر مدیری می‌دید و درخواست با رمز درست پنل هم رد می‌شد (یا با رمز مدیر تنظیم تازه بازنویسی می‌شد).
 */
export function withFreshSale(
  freshSale: Partial<SaleDefaults> | null | undefined,
  patch: Partial<SaleDefaults>
): SaleDefaults {
  return { ...DEFAULT_SALE_DEFAULTS, ...(freshSale ?? {}), ...patch }
}

/**
 * نشست ۱۶۸ (S168-D1، ریسک باز S166-D7) — ادغام «دو سوییچ پنل فروش» پیش از ذخیره‌ی کلی تنظیمات.
 *
 * صفحه‌ی تنظیمات `printEnabled` و `autoCentralWithdraw` را نمایش/ویرایش نمی‌کند (این دو فقط در پنل فروش و
 * با رمز پنل خودشان عوض می‌شوند) ولی کل `sale` را می‌فرستد. اگر بعد از بازشدن صفحه این دو از پنل فروش عوض
 * شده باشند، مقدار کهنه‌ی صفحه یا بی‌صدا برمی‌گشت (همراه رمز مدیر) یا ذخیره‌ی بی‌ربط را به رمز پنل گیر می‌داد.
 * این تابع خالص است: بقیه‌ی فیلدهای صفحه دست‌نخورده، فقط این دو از مقدار تازه‌ی سرور. سرور تغییری نکرده.
 */
export function mergeFreshPosToggles(pageSale: SaleDefaults, freshSale: SaleDefaults): SaleDefaults {
  return {
    ...pageSale,
    printEnabled: freshSale.printEnabled,
    autoCentralWithdraw: freshSale.autoCentralWithdraw
  }
}

/**
 * نشست ۲۲۲ · فاز ۳ (بخش ۶.۴ طرح) — همان نقش `mergeFreshPosToggles` ولی برای
 * «نام چاپگر».
 *
 * چرا لازم است؟ مدیر می‌تواند فرم تنظیمات را باز گذاشته باشد و در پنجره‌ی
 * «با کدام چاپگر؟» تیک «ذخیره به‌عنوان پیش‌فرض» را بزند (که در main فقط نام
 * چاپگر را می‌نویسد). اگر ذخیره‌ی بعدیِ فرم نامِ کهنه‌ی خودش را بفرستد، آن
 * انتخاب بی‌صدا برمی‌گردد. پس هنگام ذخیره، نام چاپگر از نسخه‌ی *تازه‌ی*
 * دیتابیس برداشته می‌شود و بقیه‌ی فیلدها از فرم می‌آید.
 */
export function mergeFreshPrinter<T extends { printerName: string }>(pageTpl: T, freshTpl: T): T {
  return { ...pageTpl, printerName: String(freshTpl?.printerName ?? '') }
}

/**
 * ===========================================================================
 * تنظیمات «چاپ لیبل» (مورد ۵ و ۸) — مستقل از تنظیمات چاپ فاکتور.
 *
 * لیبل روی یک دستگاه برچسب‌زنِ جداگانه چاپ می‌شود، پس چاپگرش هم جداست و ابعاد
 * کاغذش هم هیچ ربطی به عرض رسید حرارتی ندارد. پیش‌فرض = همان لیبل رایج
 * ۵ سانتی‌متر طول × ۳ سانتی‌متر عرض، با نام کالا و قیمت و بارکد (مطابق نمونه‌ی
 * چسبان فروشگاه).
 *
 * `showName: false` یعنی لیبل بدون اسم چاپ شود (فقط قیمت و بارکد).
 * `autoPrint: true` یعنی مستقیم روی چاپگر لیبل چاپ شود، بدون پنجره‌ی چاپ ویندوز.
 * ===========================================================================
 */
/**
 * «طرح» یک لیبل: هر چیزی که *ظاهر* لیبل را می‌سازد.
 *
 * چرا جدا از `LabelTemplate`؟ چون هر «قالب آماده» (Template) تنظیمات مخصوص
 * خودش را دارد و کاربر می‌تواند هر قالب را جدا شخصی‌سازی کند؛ ولی چاپگر لیبل،
 * تیک «چاپ بی‌درنگ» و فایل لوگو مشترک همه‌ی قالب‌ها هستند و داخل طرح نمی‌آیند.
 */
export interface LabelDesign {
  /** طول لیبل به میلی‌متر (۵۰ = ۵ سانتی‌متر) */
  widthMm: number
  /** عرض لیبل به میلی‌متر (۳۰ = ۳ سانتی‌متر) */
  heightMm: number
  /** حاشیه‌ی داخلی لیبل (میلی‌متر) */
  gapMm: number
  /** اسم کالا روی لیبل چاپ شود؟ (خاموش = لیبل بدون اسم) */
  showName: boolean
  /** قیمت فروش روی لیبل چاپ شود؟ */
  showPrice: boolean
  /** کد کالا روی لیبل چاپ شود؟ */
  showCode: boolean
  /** ارقام بارکد زیر خطوط بارکد چاپ شوند؟ */
  showBarcodeText: boolean
  /** نام برند/فروشگاه روی لیبل چاپ شود؟ (مطابق نمونه‌ی چسبان فروشگاه) */
  showBrand: boolean
  /** متن برند. خالی = همان «نام فروشگاه» قالب رسید استفاده می‌شود. */
  brandName: string
  brandFontPx: number
  /** برند بالای لیبل چاپ شود یا پایینش */
  brandPosition: 'TOP' | 'BOTTOM'
  /** لوگوی تصویری فروشگاه روی لیبل چاپ شود؟ */
  showLogo: boolean
  /** ارتفاع لوگو روی لیبل (میلی‌متر) */
  logoHeightMm: number
  nameFontPx: number
  priceFontPx: number
  /** ارتفاع تصویر بارکد (میلی‌متر) */
  barcodeHeightMm: number
  /** چیدمان متن‌ها: وسط‌چین یا راست‌چین */
  align: 'CENTER' | 'RIGHT'
}

/**
 * ===========================================================================
 * تنظیمات «چاپ لیبل» (مورد ۵ و ۸) — مستقل از تنظیمات چاپ فاکتور.
 *
 * لیبل روی یک دستگاه برچسب‌زنِ جداگانه چاپ می‌شود، پس چاپگرش هم جداست و ابعاد
 * کاغذش هم هیچ ربطی به عرض رسید حرارتی ندارد. پیش‌فرض = همان لیبل رایج
 * ۵ سانتی‌متر طول × ۳ سانتی‌متر عرض، با نام کالا و قیمت و بارکد (مطابق نمونه‌ی
 * چسبان فروشگاه).
 *
 * `showName: false` یعنی لیبل بدون اسم چاپ شود (فقط قیمت و بارکد).
 * `autoPrint: true` یعنی مستقیم روی چاپگر لیبل چاپ شود، بدون پنجره‌ی چاپ ویندوز.
 *
 * قالب‌های آماده (`activeTemplate` + `presets`):
 *   مقدارهای *فعال* لیبل همان فیلدهای تخت این آبجکت‌اند (پس هیچ‌جای کد چاپ عوض
 *   نشده)، و `presets` تنظیمات ذخیره‌شده‌ی هر قالب را نگه می‌دارد. با عوض کردن
 *   قالب در پنل تنظیمات، مقدارهای فعلی داخل قالب قبلی ذخیره و مقدارهای قالب
 *   جدید بار می‌شوند — پس شخصی‌سازی هر قالب گم نمی‌شود.
 * ===========================================================================
 */
export interface LabelTemplate extends LabelDesign {
  /** چاپگر مخصوص لیبل (خالی = چاپگر پیش‌فرض ویندوز). جدا از چاپگر فاکتور. */
  printerName: string
  /**
   * چاپ بی‌درنگ روی چاپگر لیبل (بدون پنجره‌ی چاپ ویندوز).
   * ⚠️ نشست ۲۲۲ · فاز ۲ — این فیلد حالا *مشتق* است: همیشه `!askEachTime`.
   * برای سازگاری با کد و داده‌ی قبلی نگه داشته شده و در `parseLabelTemplate`
   * از `askEachTime` ساخته می‌شود.
   */
  autoPrint: boolean
  /**
   * «هر بار بپرس با کدام چاپگر؟» — منبع حقیقت دیالوگ چاپ لیبل (جدول ۵.۳ طرح).
   * غایب در داده‌ی قدیمی ⇒ `!autoPrint` (کاربر قدیمی که پنجره می‌دید همان را می‌بیند).
   */
  askEachTime: boolean
  /**
   * ===== فیلدهای «رول» (فاز ۲) =====
   * ستون/فاصله/جابه‌جایی خاصیت *رول فیزیکی* است، پس اینجا (روی `LabelTemplate`)
   * می‌ماند و با عوض‌کردن قالب طراحی تغییر نمی‌کند.
   */
  /** تعداد لیبل کنار هم روی رول (۱ تا ۳). کاربر فروشگاه: ۲ */
  columns: number
  /** فاصله‌ی افقی بین ستون‌ها (میلی‌متر) */
  gapXMm: number
  /** فاصله‌ی عمودی بین ردیف‌ها (میلی‌متر) — برای `GAP` در مسیر RAW */
  gapYMm: number
  /** جابه‌جایی افقی چاپ (میلی‌متر) */
  offsetXMm: number
  /** جابه‌جایی عمودی چاپ (میلی‌متر) */
  offsetYMm: number
  /** نوع سنسور رول (در Chromium فقط نمایشی؛ در RAW به `GAP`/`BLINE` ترجمه می‌شود) */
  sensorType: LabelSensorType
  /** موتور چاپ لیبل — پیش‌فرض کاربران فعلی دست‌نخورده: CHROMIUM */
  printMethod: LabelPrintMethod
  /** دقت چاپگر در مسیر RAW */
  rawDpi: number
  /** چگالی چاپ (RAW) */
  density: number
  /** سرعت چاپ (RAW) */
  speed: number
  /** جهت چاپ (RAW) */
  direction: number
  /** معکوس‌کردن قطبیت بیت‌های تصویر در مسیر RAW (برای دستگاه‌هایی که سفید/مشکی را برعکس می‌گیرند) */
  rawInvert: boolean
  /** پنجره‌ی چاپ ویندوز باز شود؟ (مثل فاکتور) */
  useSystemDialog: boolean
  /** لوگوی فروشگاه به‌صورت dataURL (آپلود از پنل تنظیمات) — مشترک همه‌ی قالب‌ها */
  logoDataUrl: string
  /** کلید قالب فعال (یکی از LABEL_PRESETS) */
  activeTemplate: string
  /** تنظیمات ذخیره‌شده‌ی هر قالب: کلید قالب → طرح همان قالب */
  presets: Record<string, LabelDesign>
}

/** طرح پایه‌ی لیبل = همان لیبل فعلی فروشگاه (اسم + بارکد + قیمت). */
export const DEFAULT_LABEL_DESIGN: LabelDesign = {
  widthMm: 50,
  heightMm: 30,
  gapMm: 2,
  showName: true,
  showPrice: true,
  showCode: false,
  showBarcodeText: true,
  showBrand: false,
  brandName: '',
  brandFontPx: 10,
  brandPosition: 'TOP',
  showLogo: false,
  logoHeightMm: 7,
  nameFontPx: 9,
  priceFontPx: 10,
  barcodeHeightMm: 13,
  align: 'CENTER'
}

/**
 * پیش‌فرض‌های «رول» (فاز ۲). `autoPrint:false` + `askEachTime:true` یعنی رفتار
 * امروزِ فروشگاه مو‌به‌مو حفظ می‌شود: هر بار پنجره‌ی انتخاب/چاپ.
 * رول دوستونه و ۵۰×۳۰ فقط *پیشنهاد* است؛ تا وقتی مدیر عوضش نکند، کاربرِ فعلی
 * تک‌ستونه و همان ابعاد قبلی را می‌بیند (columns پیش‌فرض ۱).
 */
export const DEFAULT_LABEL_TEMPLATE: LabelTemplate = {
  ...DEFAULT_LABEL_DESIGN,
  printerName: '',
  autoPrint: false,
  askEachTime: true,
  columns: 1,
  gapXMm: 2,
  gapYMm: 2,
  offsetXMm: 0,
  offsetYMm: 0,
  sensorType: 'GAP',
  printMethod: 'CHROMIUM',
  rawDpi: 203,
  density: 8,
  speed: 4,
  direction: 0,
  rawInvert: false,
  useSystemDialog: false,
  logoDataUrl: '',
  activeTemplate: 'CLASSIC',
  presets: {}
}

/**
 * preset های «اندازه‌ی لیبل» (جدول ۵.۴ طرح).
 * ⚠️ جدا از `LABEL_PRESETS` است: آن یکی *طرح* لیبل را عوض می‌کند (کلاسیک/برند/…)،
 * این یکی فقط `widthMm`/`heightMm` را ست می‌کند.
 */
export const LABEL_SIZE_PRESETS: readonly { key: string; title: string; widthMm: number; heightMm: number }[] = [
  { key: '30x20', title: '۳۰×۲۰', widthMm: 30, heightMm: 20 },
  { key: '38x25', title: '۳۸×۲۵', widthMm: 38, heightMm: 25 },
  { key: '40x20', title: '۴۰×۲۰', widthMm: 40, heightMm: 20 },
  { key: '40x30', title: '۴۰×۳۰', widthMm: 40, heightMm: 30 },
  { key: '50x25', title: '۵۰×۲۵', widthMm: 50, heightMm: 25 },
  { key: '50x30', title: '۵۰×۳۰ (پیش‌فرض)', widthMm: 50, heightMm: 30 },
  { key: '60x40', title: '۶۰×۴۰', widthMm: 60, heightMm: 40 },
  { key: '100x50', title: '۱۰۰×۵۰', widthMm: 100, heightMm: 50 }
]

/** کلید preset اندازه‌ی لیبل که با این ابعاد می‌خواند (برای انتخاب دکمه در UI) یا `CUSTOM`. */
export function labelSizePresetKey(widthMm: number, heightMm: number): string {
  const hit = LABEL_SIZE_PRESETS.find((p) => p.widthMm === Math.round(widthMm) && p.heightMm === Math.round(heightMm))
  return hit ? hit.key : 'CUSTOM'
}

export interface LabelPreset {
  key: string
  title: string
  /** یک خط توضیح که کاربر بفهمد این قالب چه شکلی چاپ می‌شود */
  desc: string
  /** تفاوت‌های این قالب با طرح پایه */
  design: Partial<LabelDesign>
}

/**
 * قالب‌های آماده‌ی چاپ لیبل.
 *
 * هر قالب فقط یک «نقطه‌ی شروع» است: بعد از انتخابش، همه‌ی گزینه‌های لیبل
 * (ابعاد، فونت، نمایش اسم/قیمت/بارکد/برند/لوگو) طبق سلیقه‌ی خودتان قابل تغییر
 * است و همان‌جا برای همان قالب ذخیره می‌شود.
 */
export const LABEL_PRESETS: readonly LabelPreset[] = [
  {
    key: 'CLASSIC',
    title: 'کلاسیک (اسم + بارکد + قیمت)',
    desc: 'همان لیبل فعلی فروشگاه: نام کالا بالا، بارکد وسط، قیمت پایین.',
    design: {}
  },
  {
    key: 'BRAND',
    title: 'برند بالای لیبل',
    desc: 'نام برند/فروشگاه بالای لیبل چاپ می‌شود و زیرش نام کالا، بارکد و قیمت.',
    design: { showBrand: true, brandPosition: 'TOP', brandFontPx: 11, nameFontPx: 8, barcodeHeightMm: 11 }
  },
  {
    key: 'BRAND_LOGO',
    title: 'لوگو و برند',
    desc: 'لوگوی تصویری فروشگاه + نام برند بالای لیبل، بعد بارکد و قیمت.',
    design: {
      showBrand: true,
      showLogo: true,
      brandPosition: 'TOP',
      brandFontPx: 10,
      logoHeightMm: 7,
      nameFontPx: 8,
      barcodeHeightMm: 10
    }
  },
  {
    key: 'NO_NAME',
    title: 'بدون اسم (بارکد درشت + قیمت)',
    desc: 'لیبل کوچک و ساده: فقط بارکد بزرگ و قیمت، بدون نام کالا.',
    design: { showName: false, showBrand: false, barcodeHeightMm: 17, priceFontPx: 11 }
  },
  {
    key: 'PRICE_BIG',
    title: 'قیمت درشت',
    desc: 'قیمت با فونت بزرگ و نام کالا ریز — مناسب ویترین.',
    design: { nameFontPx: 8, priceFontPx: 15, barcodeHeightMm: 10 }
  },
  {
    key: 'FULL',
    title: 'کامل (برند + اسم + کد + بارکد + قیمت)',
    desc: 'همه‌ی اطلاعات روی یک لیبل؛ برای لیبل‌های بزرگ‌تر مناسب است.',
    design: {
      showBrand: true,
      brandFontPx: 9,
      showCode: true,
      nameFontPx: 8,
      priceFontPx: 10,
      barcodeHeightMm: 9
    }
  }
]

export const LABEL_PRESET_KEYS: readonly string[] = LABEL_PRESETS.map((p) => p.key)

/** یک قالب آماده با کلیدش (کلید ناشناس = قالب کلاسیک). */
export function labelPresetOf(key: string): LabelPreset {
  return LABEL_PRESETS.find((p) => p.key === key) ?? LABEL_PRESETS[0]
}

/** طرح *پیش‌فرض کارخانه‌ای* یک قالب (بدون شخصی‌سازی کاربر). */
export function labelPresetDesign(key: string): LabelDesign {
  return { ...DEFAULT_LABEL_DESIGN, ...labelPresetOf(key).design }
}

/** اصلاح مقدارهای بی‌معنا در یک طرح لیبل (ابعاد صفر یا منفی، فونت خارج از بازه). */
export function clampLabelDesign(raw: Partial<LabelDesign> | null | undefined, base: LabelDesign): LabelDesign {
  const d: LabelDesign = { ...base }
  const src: any = raw ?? {}
  const num = (v: unknown, fallback: number) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : fallback
  }
  const bool = (v: unknown, fallback: boolean) => (v === undefined || v === null ? fallback : Boolean(v))

  d.widthMm = Math.min(200, Math.max(10, num(src.widthMm, base.widthMm) || DEFAULT_LABEL_DESIGN.widthMm))
  d.heightMm = Math.min(200, Math.max(10, num(src.heightMm, base.heightMm) || DEFAULT_LABEL_DESIGN.heightMm))
  d.gapMm = Math.min(20, Math.max(0, num(src.gapMm, base.gapMm)))
  d.showName = bool(src.showName, base.showName)
  d.showPrice = bool(src.showPrice, base.showPrice)
  d.showCode = bool(src.showCode, base.showCode)
  d.showBarcodeText = bool(src.showBarcodeText, base.showBarcodeText)
  d.showBrand = bool(src.showBrand, base.showBrand)
  d.brandName = String(src.brandName ?? base.brandName ?? '')
  d.brandFontPx = Math.min(28, Math.max(5, num(src.brandFontPx, base.brandFontPx) || DEFAULT_LABEL_DESIGN.brandFontPx))
  d.brandPosition = (src.brandPosition ?? base.brandPosition) === 'BOTTOM' ? 'BOTTOM' : 'TOP'
  d.showLogo = bool(src.showLogo, base.showLogo)
  d.logoHeightMm = Math.min(60, Math.max(2, num(src.logoHeightMm, base.logoHeightMm) || DEFAULT_LABEL_DESIGN.logoHeightMm))
  d.nameFontPx = Math.min(24, Math.max(5, num(src.nameFontPx, base.nameFontPx) || DEFAULT_LABEL_DESIGN.nameFontPx))
  d.priceFontPx = Math.min(24, Math.max(5, num(src.priceFontPx, base.priceFontPx) || DEFAULT_LABEL_DESIGN.priceFontPx))
  d.barcodeHeightMm = Math.min(
    Math.max(4, d.heightMm - 4),
    Math.max(4, num(src.barcodeHeightMm, base.barcodeHeightMm) || DEFAULT_LABEL_DESIGN.barcodeHeightMm)
  )
  d.align = (src.align ?? base.align) === 'RIGHT' ? 'RIGHT' : 'CENTER'
  return d
}

/** فقط بخش «طرح» یک تنظیمات لیبل (برای ذخیره کردنش داخل presets). */
export function labelDesignOf(t: LabelTemplate): LabelDesign {
  return clampLabelDesign(t as unknown as Partial<LabelDesign>, DEFAULT_LABEL_DESIGN)
}

/**
 * عوض کردن «قالب فعال».
 *
 * طرح فعلی داخل قالب قبلی ذخیره می‌شود و طرح قالب جدید بار می‌گردد: اگر کاربر
 * قبلاً همان قالب را شخصی‌سازی کرده باشد، همان مقدارهای خودش برمی‌گردد، وگرنه
 * پیش‌فرض کارخانه‌ای آن قالب. چاپگر، تیک چاپ بی‌درنگ و فایل لوگو دست‌نخورده
 * می‌مانند (مشترک همه‌ی قالب‌ها هستند).
 */
export function applyLabelPreset(current: LabelTemplate, key: string): LabelTemplate {
  const nextKey = LABEL_PRESET_KEYS.includes(key) ? key : LABEL_PRESETS[0].key
  const presets = { ...(current.presets ?? {}) }
  presets[current.activeTemplate || LABEL_PRESETS[0].key] = labelDesignOf(current)
  const design = presets[nextKey] ? clampLabelDesign(presets[nextKey], labelPresetDesign(nextKey)) : labelPresetDesign(nextKey)
  return {
    ...current,
    ...design,
    activeTemplate: nextKey,
    presets
  }
}

/** بازگرداندن قالب فعال به پیش‌فرض کارخانه‌ای خودش (شخصی‌سازی‌اش پاک می‌شود). */
export function resetLabelPreset(current: LabelTemplate): LabelTemplate {
  const key = LABEL_PRESET_KEYS.includes(current.activeTemplate) ? current.activeTemplate : LABEL_PRESETS[0].key
  const presets = { ...(current.presets ?? {}) }
  delete presets[key]
  return { ...current, ...labelPresetDesign(key), activeTemplate: key, presets }
}

/**
 * متن برندی که واقعاً روی لیبل چاپ می‌شود.
 * خالی بودن `brandName` یعنی «همان نام فروشگاه قالب رسید» — پس کاربر لازم نیست
 * نام فروشگاهش را دو جا بنویسد.
 */
export function resolveLabelBrand(label: Pick<LabelTemplate, 'brandName'>, shopName?: string | null): string {
  const own = String(label?.brandName ?? '').trim()
  if (own) return own
  return String(shopName ?? '').trim()
}

/**
 * ===========================================================================
 * تنظیمات بکاپ خودکار (مورد ۶).
 *
 * `autoDir` خالی = همان پوشه‌ی داخلی برنامه (رفتار فعلی و دست‌نخورده).
 * `everyDays` = هر چند روز یک‌بار بکاپ کامل گرفته شود (۱ = روزانه، ۰ = خاموش).
 * `lastAutoAt` = لحظه‌ی آخرین بکاپ خودکار؛ مبنای «هر چند روز یک‌بار».
 * ===========================================================================
 */
export interface BackupConfig {
  /** مسیر پوشه‌ی بکاپ خودکار (خالی = پوشه‌ی داخلی برنامه) */
  autoDir: string
  /** بازه‌ی بکاپ خودکار به روز (۰ = بکاپ خودکار خاموش) */
  everyDays: number
  /** چند نسخه‌ی آخر نگه داشته شود */
  keep: number
  /** آخرین بکاپ خودکار (ISO) — خودکار نوشته می‌شود */
  lastAutoAt: string
}

export const DEFAULT_BACKUP_CONFIG: BackupConfig = {
  autoDir: '',
  everyDays: 1,
  keep: 30,
  lastAutoAt: ''
}

/**
 * ---------------------------------------------------------------------------
 * تنظیمات شیفت — دو حالت.
 *
 * حالت پیش‌فرض (`byTime: false`، همان رفتار قبلی و دست‌نخورده):
 *   هر بار صندوق بسته شود و فروش جدیدی شروع شود، شیفت *بعدی* همان روز خودکار
 *   باز می‌شود (شماره = آخرین شماره + ۱)، حتی اگر روزی ۱۰ بار تکرار شود.
 *   نام هر شیفت از همین `templates` (به ترتیب شماره) خوانده می‌شود.
 *
 * حالت زمان‌بندی ثابت (`byTime: true`):
 *   شیفت از «ساعتِ لحظه‌ی فروش» تعیین می‌شود، نه از تعداد بار بستن صندوق. اگر
 *   شیفت اول ۰۸:۰۰ تا ۱۴:۰۰ باشد و صندوق ساعت ۱۰ بسته شود، فاکتور ساعت ۱۱ هم
 *   به همان یک رکورد شیفت اول همان روز می‌چسبد.
 * ---------------------------------------------------------------------------
 */
export interface ShiftTemplate {
  /**
   * شناسهٔ پایدار قالب؛ نام و ساعت قابل ویرایش‌اند، اما این شناسه برای اتصال
   * برنامه‌ریزی و snapshotهای تاریخیِ بعدی هرگز از روی جایگاه آرایه ساخته نمی‌شود.
   */
  id: string
  name: string
  /** ساعت شروع به قالب HH:mm (فقط ساعت روز، بدون تاریخ) */
  startTime: string
  /** ساعت پایان به قالب HH:mm. اگر ≤ شروع باشد، شیفت شبانه (گذر از نیمه‌شب) است. */
  endTime: string
  /** این قالب در تشخیص/برنامه‌ریزی جدید فعال است؟ سابقه‌های قبلی دست‌نخورده‌اند. */
  isActive: boolean
  /** بیت‌های روزهای هفته (۱..۱۲۷)، برای برنامهٔ حضانت. */
  daysMask: number
  /** کارکنان برنامه‌ریزی‌شده؛ برنامه هرگز به‌تنهایی مسئولیت مالی ایجاد نمی‌کند. */
  staffIds: number[]
  /** فاصلهٔ یادآوریِ پایان برنامه، در دقیقه. */
  reminderRepeatMin: number
  /** تحویل میان‌روز این قالب فقط با انتخاب صریح مدیر مجاز می‌شود. */
  allowMidDayHandover: boolean
}

/**
 * جلسه ۱۹ · بند ۷ — فرمت *نمایشی* فیلدهای ساعت شروع/پایان شیفت‌ها.
 *   '12' = ۱۲ساعته با AM/PM (همان رفتار قبلی، پیش‌فرض)
 *   '24' = ۲۴ساعته (مثل ۱۸:۰۰ برای ۶ عصر)
 * ⚠️ فقط نمایش فرم تنظیمات است: مقدار ذخیره‌شده همیشه همان 'HH:mm' ۲۴ساعته
 * می‌ماند و هیچ اثری روی هیچ محاسبه‌ای ندارد.
 */
export type ShiftClockFormat = '12' | '24'

export interface ShiftConfig {
  /**
   * نام شیفت‌ها به ترتیب شماره. برای سازگاری با داده‌ی ذخیره‌شده‌ی قبلی نگه
   * داشته شده و همیشه از `templates` هم‌ترازش می‌شود.
   */
  names: string[]
  /** «تعیین شیفت بر اساس ساعت» — پیش‌فرض خاموش */
  byTime: boolean
  /** منبع mode عملیاتی حضانت پس از تصمیم صریح مدیر. تا وقتی false است، نصبِ
   * قدیمی با custody.config پیشین خودش رفتار می‌کند و هیچ تبدیل خاموشی رخ نمی‌دهد. */
  custodyMode: 'SINGLE_SHIFT' | 'MULTI_SHIFT'
  custodyModeConfigured: boolean
  /** در تک‌شیفت دقیقاً یک مسئول اصلی روزانه مشخص می‌شود؛ در چندشیفت نادیده
   * گرفته می‌شود و کارکنان هر template مستقل‌اند. */
  singleShiftCustodianUserId: number | null
  /** یادآوری پایان برنامه‌های canonical روشن است؟ */
  reminderEnabled: boolean
  /** مهلت هشدار بعد از پایان برنامه، دقیقه. */
  overrunGraceMinutes: number
  /** شیفت‌های تعریف‌شده‌ی دستی (نام + ساعت شروع/پایان + برنامه) */
  templates: ShiftTemplate[]
  /** بند ۷ — فرمت نمایش ساعت در فرم تنظیمات شیفت (فقط نمایشی) */
  clockFormat: ShiftClockFormat
  /**
   * نشست ۳۱۰ — سقف اضافه‌کاری شیفت شب به دقیقه؛ ۰ = خاموش (پیش‌فرض).
   * کارمند همان نشستِ بازِ دیروز می‌تواند تا «پایان بازه + این سقف» اعلام کند؛
   * حداکثر مقدار مجاز ۲۴۰ دقیقه (سقف پیشنهادی ۱۲۰). تغییرش رمز مدیر می‌خواهد.
   */
  overtimeMaxMinutes: number
}

export const DEFAULT_SHIFT_TEMPLATES: ShiftTemplate[] = [
  { id: 'template-default-1', name: 'شیفت اول', startTime: '08:00', endTime: '14:00', isActive: true, daysMask: 127, staffIds: [], reminderRepeatMin: 15, allowMidDayHandover: false },
  { id: 'template-default-2', name: 'شیفت دوم', startTime: '14:00', endTime: '20:00', isActive: true, daysMask: 127, staffIds: [], reminderRepeatMin: 15, allowMidDayHandover: false },
  { id: 'template-default-3', name: 'شیفت سوم', startTime: '20:00', endTime: '00:00', isActive: true, daysMask: 127, staffIds: [], reminderRepeatMin: 15, allowMidDayHandover: false }
]

/** A user-created template gets an opaque identity once, in the UI. Parsing
 * never calls this generator, so merely reading an old configuration cannot
 * change its identity. */
export function createShiftTemplateId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.()
  if (randomUuid) return `template-${randomUuid}`
  // Electron/modern browsers have randomUUID; this conservative fallback only
  // protects old test/runtime environments from producing a positional id.
  return `template-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export const DEFAULT_SHIFT_CONFIG: ShiftConfig = {
  names: DEFAULT_SHIFT_TEMPLATES.map((t) => t.name),
  byTime: false,
  // نصب/دادهٔ قدیمی تا بازبینی صریح مدیر، از custody.config پیشین می‌خواند.
  custodyMode: 'SINGLE_SHIFT',
  custodyModeConfigured: false,
  singleShiftCustodianUserId: null,
  reminderEnabled: true,
  overrunGraceMinutes: 60,
  templates: DEFAULT_SHIFT_TEMPLATES.map((t) => ({ ...t, staffIds: [...t.staffIds] })),
  // پیش‌فرض = همان چیزی که تا امروز بود: ۱۲ساعته با AM/PM
  clockFormat: '12',
  // نشست ۳۱۰ — پیش‌فرض صفر یعنی اضافه‌کاری خاموش است (حالت جدید opt-in)
  overtimeMaxMinutes: 0
}

/** نشست ۳۱۰ — سقف مطلق اضافه‌کاری که تنظیمات می‌تواند بگیرد (دقیقه). */
export const SHIFT_OVERTIME_ABSOLUTE_MAX = 240

/** '۸:۵' / '8:5' / '0800' → 'HH:mm' (ورودی خراب = مقدار پیش‌فرض داده‌شده). */
export function normalizeTime(raw: unknown, fallback = '00:00'): string {
  const s = String(raw ?? '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'.indexOf(d)))
    .replace(/[^0-9:]/g, '')
    .trim()
  if (!s) return fallback
  let h = 0
  let m = 0
  if (s.includes(':')) {
    const [a, b] = s.split(':')
    h = Number(a)
    m = Number(b)
  } else if (s.length <= 2) {
    h = Number(s)
  } else {
    h = Number(s.slice(0, s.length - 2))
    m = Number(s.slice(-2))
  }
  if (!Number.isFinite(h)) h = 0
  if (!Number.isFinite(m)) m = 0
  h = Math.min(23, Math.max(0, Math.trunc(h)))
  m = Math.min(59, Math.max(0, Math.trunc(m)))
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

/** 'HH:mm' → دقیقه از نیمه‌شب. */
export function minutesOfTime(t: string): number {
  const [h, m] = normalizeTime(t).split(':').map(Number)
  return h * 60 + m
}

/** IDs are opaque, bounded and portable through JSON/SQLite. */
function shiftTemplateIdOrNull(value: unknown): string | null {
  const id = String(value ?? '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/.test(id) ? id : null
}

/**
 * Existing installations stored name/time only. Give each legacy row a stable
 * synthetic id based on its original normalized shape, rather than array order
 * alone or a random value regenerated at every read. The first normal Settings
 * save writes this id back into `shift.config`.
 */
function legacyShiftTemplateId(index: number, name: string, startTime: string, endTime: string, salt = 0): string {
  const source = `${index}\u001f${name}\u001f${startTime}\u001f${endTime}\u001f${salt}`
  let hash = 2166136261
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `legacy-template-${(hash >>> 0).toString(36)}`
}

/** ادغام ایمن JSON ذخیره‌شده با پیش‌فرض‌ها (نبودن یا خرابی مقدار = پیش‌فرض). */
function merge<T extends object>(defaults: T, raw: unknown): T {
  if (raw == null) return { ...defaults }
  let obj: any = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return { ...defaults }
    }
  }
  if (!obj || typeof obj !== 'object') return { ...defaults }
  const out: any = { ...defaults }
  for (const key of Object.keys(defaults as any)) {
    const v = obj[key]
    if (v === undefined || v === null) continue
    const d = (defaults as any)[key]
    if (typeof d === 'number') {
      const n = Number(v)
      if (Number.isFinite(n)) out[key] = n
      continue
    }
    if (typeof d === 'boolean') {
      out[key] = Boolean(v)
      continue
    }
    if (Array.isArray(d)) {
      if (Array.isArray(v) && v.length) out[key] = v.map((x) => String(x))
      continue
    }
    out[key] = String(v)
  }
  return out as T
}

/**
 * ===========================================================================
 * تنظیمات امنیتی — «قفل موقت بعد از ورود رمز اشتباه» (بخش ۲).
 *
 * رفتار: اگر روی یک «گیتِ» ورود رمز (صفحه‌ی رمز مدیر، یا هر پنل قفل‌دار) رمز
 * `maxAttempts` بار پشت‌سرهم اشتباه وارد شود، همان گیت به مدت `lockMinutes`
 * دقیقه قفل می‌شود و تا پایان آن مدت **حتی رمز درست هم پذیرفته نمی‌شود**.
 *
 * شمارنده و لحظه‌ی پایان قفل در جدول `AuthLockout` دیتابیس ذخیره می‌شوند، نه در
 * حافظه؛ پس بستن و باز کردن برنامه قفل را دور نمی‌زند.
 *
 * `lockoutEnabled: false` = رفتار نسخه‌های قبل، بدون هیچ قفلی.
 * ===========================================================================
 */
export interface SecurityConfig {
  /** قفل موقت فعال است؟ (پیش‌فرض روشن) */
  lockoutEnabled: boolean
  /** چند رمز اشتباه پشت‌سرهم ⇒ قفل (پیش‌فرض ۳) */
  maxAttempts: number
  /** مدت قفل به دقیقه (پیش‌فرض ۱۰) */
  lockMinutes: number
  /**
   * بند ۴-۴۰ — قفل خودکار بعد از بی‌کاری، به دقیقه.
   * پیش‌فرض ۵. همان عدد در renderer (خروج نشست مدیر) و `panelSession` (سرور) خوانده می‌شود.
   */
  idleLockMinutes: number
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  lockoutEnabled: true,
  maxAttempts: 3,
  lockMinutes: 10,
  idleLockMinutes: 5
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** خواندن ایمن تنظیمات امنیتی (عدد بی‌معنا ⇒ همان پیش‌فرض). */
export const parseSecurityConfig = (raw: unknown): SecurityConfig => {
  const merged = merge(DEFAULT_SECURITY_CONFIG, raw)
  return {
    lockoutEnabled: merged.lockoutEnabled !== false,
    maxAttempts: clampInt(merged.maxAttempts, 1, 20, DEFAULT_SECURITY_CONFIG.maxAttempts),
    lockMinutes: clampInt(merged.lockMinutes, 1, 1440, DEFAULT_SECURITY_CONFIG.lockMinutes),
    idleLockMinutes: clampInt(merged.idleLockMinutes, 1, 1440, DEFAULT_SECURITY_CONFIG.idleLockMinutes)
  }
}

/**
 * JSON خامِ ذخیره‌شده (رشته یا شیء) — برای تشخیص «فیلد غایب» در مهاجرت تنبل.
 * `merge` تفاوت «غایب» و «پیش‌فرض» را از دست می‌دهد، پس مشتق‌سازی‌ها به این
 * نیاز دارند.
 */
function rawObjectOf(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null
  let obj: unknown = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      return null
    }
  }
  return obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null
}

/** عدد میلی‌متری: خراب/نامتناهی ⇒ پیش‌فرض · خارج بازه ⇒ clamp · یک رقم اعشار. */
const clampMm = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(Math.max(n, min), max) * 10) / 10
}

/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۱ — خواندن ایمن «قالب فاکتور» (بخش ۵.۲ و ۵.۴ طرح).
 *
 * سه کار:
 *   ۱) `merge` مقدارهای غایب/خراب را با پیش‌فرض پر می‌کند (مثل قبل).
 *   ۲) بازه‌ها clamp می‌شوند تا مقدار خرابِ دیتابیس یا renderer اندازه‌ی
 *      غیرمجاز کاغذ نسازد (کف/سقف در `RECEIPT_SIZE_LIMITS`).
 *   ۳) مهاجرت تنبل: قالب قدیمی که `paperPreset`/`sheetWidthMm` ندارد از روی
 *      `paperWidthMm` مشتق می‌شود (۷۲ ⇒ کاغذ ۸۰ و ۴۸ ⇒ کاغذ ۵۸، مطابق بخش ۱۳
 *      طرح)، پس **ظاهر رسید فعلی فروشگاه مو‌به‌مو حفظ می‌شود** و هیچ rewrite ای
 *      روی دیتابیس لازم نیست.
 *
 * `parse(parse(x)) === parse(x)`: خروجی این تابع وقتی ذخیره و دوباره خوانده شود
 * عوض نمی‌شود، چون بعد از parse همه‌ی فیلدها صریح‌اند.
 * ===========================================================================
 */
export const parseReceiptTemplate = (raw: unknown): ReceiptTemplate => {
  const D = DEFAULT_RECEIPT_TEMPLATE
  const merged = merge(D, raw)
  const obj = rawObjectOf(raw)
  const given = (k: string): boolean => !!obj && obj[k] !== undefined && obj[k] !== null

  const paperWidthMm = clampInt(
    merged.paperWidthMm,
    RECEIPT_SIZE_LIMITS.minPaperWidthMm,
    RECEIPT_SIZE_LIMITS.maxPaperWidthMm,
    D.paperWidthMm
  )
  /** مشتق‌سازی از عرض قابل‌چاپ: ۵۲ و کمتر ⇒ ۵۸ · ۷۶ و کمتر ⇒ ۸۰ · بقیه ⇒ دلخواه */
  const derivedPreset: ReceiptPaperPreset =
    paperWidthMm <= 52 ? 'THERMAL_58' : paperWidthMm <= 76 ? 'THERMAL_80' : 'CUSTOM'
  const paperPreset: ReceiptPaperPreset =
    given('paperPreset') && isReceiptPaperPreset(merged.paperPreset) ? merged.paperPreset : derivedPreset
  const presetSpec = presetToSpec(paperPreset)

  const marginXMm = clampMm(merged.marginXMm, RECEIPT_SIZE_LIMITS.minMarginMm, RECEIPT_SIZE_LIMITS.maxMarginMm, D.marginXMm)
  const marginYMm = clampMm(merged.marginYMm, RECEIPT_SIZE_LIMITS.minMarginMm, RECEIPT_SIZE_LIMITS.maxMarginMm, D.marginYMm)

  /**
   * «دلخواه» ⇒ حفظ ظاهر قبلی: در قالب قدیمی `body` عرض `paperWidthMm` داشت و
   * `padding` هم بیرون از آن اضافه می‌شد، پس عرض کل کاغذ = قابل‌چاپ + ۲×حاشیه.
   */
  const derivedSheetWidth = presetSpec ? presetSpec.sheetWidthMm : paperWidthMm + marginXMm * 2
  const sheetWidthMm = given('sheetWidthMm')
    ? clampInt(merged.sheetWidthMm, RECEIPT_SIZE_LIMITS.minSheetWidthMm, RECEIPT_SIZE_LIMITS.maxSheetWidthMm, D.sheetWidthMm)
    : clampInt(derivedSheetWidth, RECEIPT_SIZE_LIMITS.minSheetWidthMm, RECEIPT_SIZE_LIMITS.maxSheetWidthMm, D.sheetWidthMm)

  const heightSource = given('sheetHeightMm') ? merged.sheetHeightMm : presetSpec ? presetSpec.sheetHeightMm : 0
  const heightNum = Number(heightSource)
  const sheetHeightMm =
    !Number.isFinite(heightNum) || heightNum <= 0
      ? 0
      : clampInt(heightNum, RECEIPT_SIZE_LIMITS.minSheetHeightMm, RECEIPT_SIZE_LIMITS.maxSheetHeightMm, 0)

  const wholesaleHeightNum = Number(merged.wholesaleSheetHeightMm)
  return {
    ...merged,
    paperWidthMm,
    paperPreset,
    sheetWidthMm,
    sheetHeightMm,
    marginXMm,
    marginYMm,
    // پیش‌فرض روشن؛ فقط `false` صریح خاموشش می‌کند
    autoFont: merged.autoFont !== false,
    heightSafetyMm: clampMm(merged.heightSafetyMm, RECEIPT_SIZE_LIMITS.minSafetyMm, RECEIPT_SIZE_LIMITS.maxSafetyMm, D.heightSafetyMm),
    // فقط دو مقدار مجاز؛ هر چیز دیگر ⇒ رفتار امروز (موتور Chromium)
    printMethod: merged.printMethod === 'RAW' ? 'RAW' : 'CHROMIUM',
    rawDpi: Number(merged.rawDpi) === 300 ? 300 : 203,
    rawInvert: merged.rawInvert === true,
    cutMode: merged.cutMode === 'PARTIAL' || merged.cutMode === 'NONE' ? merged.cutMode : 'FULL',
    useSystemDialog: merged.useSystemDialog === true,
    askEachTime: merged.askEachTime === true,
    wholesaleSeparate: merged.wholesaleSeparate === true,
    wholesaleSheetWidthMm: clampInt(
      merged.wholesaleSheetWidthMm,
      RECEIPT_SIZE_LIMITS.minSheetWidthMm,
      RECEIPT_SIZE_LIMITS.maxSheetWidthMm,
      D.wholesaleSheetWidthMm
    ),
    wholesaleSheetHeightMm:
      !Number.isFinite(wholesaleHeightNum) || wholesaleHeightNum <= 0
        ? 0
        : clampInt(
            wholesaleHeightNum,
            RECEIPT_SIZE_LIMITS.minSheetHeightMm,
            RECEIPT_SIZE_LIMITS.maxSheetHeightMm,
            0
          ),
    wholesalePaperWidthMm: clampInt(
      merged.wholesalePaperWidthMm,
      RECEIPT_SIZE_LIMITS.minPaperWidthMm,
      RECEIPT_SIZE_LIMITS.maxPaperWidthMm,
      D.wholesalePaperWidthMm
    )
  }
}
export const parseSaleDefaults = (raw: unknown): SaleDefaults => {
  const parsed = merge(DEFAULT_SALE_DEFAULTS, raw)
  // تنها false صریح این feature flag را می‌بندد؛ داده‌ی قدیمی/خراب رفتار پیشین (روشن) را دارد.
  return { ...parsed, splitStoreCreditPayment: parsed.splitStoreCreditPayment !== false }
}
/**
 * خواندن ایمن تنظیمات چاپ لیبل.
 *
 * سه کار انجام می‌دهد:
 *   ۱) مقدارهای بی‌معنا را اصلاح می‌کند (ابعاد صفر/منفی، فونت خارج از بازه).
 *   ۲) داده‌ی *نسخه‌ی قبلی* (که فقط فیلدهای تخت داشت) بدون هیچ تغییری خوانده
 *      می‌شود و به قالب «کلاسیک» نسبت داده می‌شود، پس لیبل فعلی فروشگاه
 *      مو‌به‌مو مثل قبل چاپ می‌گردد.
 *   ۳) `presets` (تنظیمات ذخیره‌شده‌ی هر قالب) را جدا و ایمن پارس می‌کند.
 */
export const parseLabelTemplate = (raw: unknown): LabelTemplate => {
  let obj: any = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      obj = null
    }
  }
  if (!obj || typeof obj !== 'object') obj = {}

  // `presets` یک آبجکت تودرتو است و از مسیر merge (که فقط مقدارهای ساده را
  // می‌فهمد) رد نمی‌شود؛ پس کنار گذاشته و جدا پارس می‌شود.
  const { presets: _ignored, ...flatDefaults } = DEFAULT_LABEL_TEMPLATE
  const flat = merge(flatDefaults as Omit<LabelTemplate, 'presets'>, obj)

  const activeTemplate = LABEL_PRESET_KEYS.includes(String(flat.activeTemplate))
    ? String(flat.activeTemplate)
    : LABEL_PRESETS[0].key

  const design = clampLabelDesign(flat as Partial<LabelDesign>, labelPresetDesign(activeTemplate))

  const presets: Record<string, LabelDesign> = {}
  const rawPresets = obj.presets
  if (rawPresets && typeof rawPresets === 'object') {
    for (const key of LABEL_PRESET_KEYS) {
      const one = (rawPresets as any)[key]
      if (one && typeof one === 'object') presets[key] = clampLabelDesign(one, labelPresetDesign(key))
    }
  }

  /**
   * ===== فیلدهای «رول» (نشست ۲۲۲ · فاز ۲) =====
   *
   * ۱) `askEachTime` منبع حقیقت است و `autoPrint` از آن مشتق می‌شود:
   *    داده‌ی قدیمی `askEachTime` ندارد ⇒ `!autoPrint` (رفتار قبلی حفظ می‌شود)،
   *    و ذخیره‌ی مجدد همیشه `autoPrint = !askEachTime` می‌نویسد.
   * ۲) عددهای خراب با `clamp` به بازه‌ی جدول ۵.۳ برمی‌گردند — نه خطا، نه مقدار حدسی.
   * ۳) هر فیلد جدید **به‌صراحت** در return می‌آید (گارد قدیمی: فراموش‌شدن فیلد تازه
   *    در return انتهایی باعث می‌شد تنظیمات بی‌صدا از بین برود).
   */
  const rawAsk = (obj as any)?.askEachTime
  const askEachTime = rawAsk === undefined || rawAsk === null ? !Boolean(flat.autoPrint) : Boolean(rawAsk)
  const numIn = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.round(n)))
  }

  return {
    ...design,
    printerName: String(flat.printerName ?? ''),
    autoPrint: !askEachTime,
    askEachTime,
    columns: numIn(flat.columns, LABEL_ROLL_LIMITS.minColumns, LABEL_ROLL_LIMITS.maxColumns, DEFAULT_LABEL_TEMPLATE.columns),
    gapXMm: numIn(flat.gapXMm, LABEL_ROLL_LIMITS.minGapMm, LABEL_ROLL_LIMITS.maxGapMm, DEFAULT_LABEL_TEMPLATE.gapXMm),
    gapYMm: numIn(flat.gapYMm, LABEL_ROLL_LIMITS.minGapMm, LABEL_ROLL_LIMITS.maxGapMm, DEFAULT_LABEL_TEMPLATE.gapYMm),
    offsetXMm: numIn(flat.offsetXMm, LABEL_ROLL_LIMITS.minOffsetMm, LABEL_ROLL_LIMITS.maxOffsetMm, DEFAULT_LABEL_TEMPLATE.offsetXMm),
    offsetYMm: numIn(flat.offsetYMm, LABEL_ROLL_LIMITS.minOffsetMm, LABEL_ROLL_LIMITS.maxOffsetMm, DEFAULT_LABEL_TEMPLATE.offsetYMm),
    sensorType: isLabelSensorType(flat.sensorType) ? flat.sensorType : DEFAULT_LABEL_TEMPLATE.sensorType,
    printMethod: isLabelPrintMethod(flat.printMethod) ? flat.printMethod : DEFAULT_LABEL_TEMPLATE.printMethod,
    rawDpi: Number(flat.rawDpi) === 300 ? 300 : 203,
    density: numIn(flat.density, LABEL_ROLL_LIMITS.minDensity, LABEL_ROLL_LIMITS.maxDensity, DEFAULT_LABEL_TEMPLATE.density),
    speed: numIn(flat.speed, LABEL_ROLL_LIMITS.minSpeed, LABEL_ROLL_LIMITS.maxSpeed, DEFAULT_LABEL_TEMPLATE.speed),
    direction: Number(flat.direction) === 1 ? 1 : 0,
    rawInvert: Boolean(flat.rawInvert),
    useSystemDialog: Boolean(flat.useSystemDialog),
    logoDataUrl: String(flat.logoDataUrl ?? ''),
    activeTemplate,
    presets
  }
}
/** تنظیمات بکاپ خودکار، با محدود کردن بازه و تعداد نسخه به مقدار معقول. */
export const parseBackupConfig = (raw: unknown): BackupConfig => {
  const c = merge(DEFAULT_BACKUP_CONFIG, raw)
  c.everyDays = Math.min(365, Math.max(0, Math.round(c.everyDays) || 0))
  c.keep = Math.min(500, Math.max(1, Math.round(c.keep) || DEFAULT_BACKUP_CONFIG.keep))
  c.autoDir = String(c.autoDir ?? '').trim()
  return c
}
/**
 * خواندن ایمن تنظیمات شیفت.
 * داده‌ی ذخیره‌شده‌ی نسخه‌ی قبلی فقط `names` داشت؛ همان‌ها به `templates` با
 * ساعت پیش‌فرض تبدیل می‌شوند تا هیچ تنظیمی گم نشود و حالت پیش‌فرض (خودکار)
 * دقیقاً مثل قبل کار کند.
 */
export const parseShiftConfig = (raw: unknown): ShiftConfig => {
  let obj: any = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      obj = null
    }
  }
  if (!obj || typeof obj !== 'object') obj = {}

  const names: string[] = Array.isArray(obj.names) ? obj.names.map((n: unknown) => String(n ?? '').trim()) : []

  let templates: ShiftTemplate[] = []
  const usedTemplateIds = new Set<string>()
  const idFor = (candidate: unknown, index: number, name: string, startTime: string, endTime: string, defaultId?: string) => {
    const supplied = shiftTemplateIdOrNull(candidate)
    if (supplied && !usedTemplateIds.has(supplied)) {
      usedTemplateIds.add(supplied)
      return supplied
    }
    const preferred = defaultId && !usedTemplateIds.has(defaultId) ? defaultId : null
    if (preferred) {
      usedTemplateIds.add(preferred)
      return preferred
    }
    let salt = 0
    let legacy = legacyShiftTemplateId(index, name, startTime, endTime, salt)
    while (usedTemplateIds.has(legacy)) legacy = legacyShiftTemplateId(index, name, startTime, endTime, ++salt)
    usedTemplateIds.add(legacy)
    return legacy
  }
  if (Array.isArray(obj.templates)) {
    templates = obj.templates
      .map((t: any, i: number) => {
        const fallback = DEFAULT_SHIFT_TEMPLATES[i] ?? DEFAULT_SHIFT_TEMPLATES[DEFAULT_SHIFT_TEMPLATES.length - 1]
        const name = String(t?.name ?? names[i] ?? '').trim() || 'شیفت ' + (i + 1)
        const startTime = normalizeTime(t?.startTime, fallback.startTime)
        const endTime = normalizeTime(t?.endTime, fallback.endTime)
        const staffIds = [...new Set(Array.isArray(t?.staffIds) ? t.staffIds.map((id: unknown) => Math.round(Number(id))).filter((id: number) => Number.isSafeInteger(id) && id > 0) : [])]
        return {
          id: idFor(t?.id, i, name, startTime, endTime),
          name,
          startTime,
          endTime,
          isActive: t?.isActive !== false,
          // نبودنِ فیلد legacy = همه‌روز؛ صفرِ صریح باید برای اعتبارسنجی سرور
          // باقی بماند تا مدیر نتواند شیفتِ بی‌روز ذخیره کند.
          daysMask: t?.daysMask == null ? 127 : Math.min(127, Math.max(0, Math.round(Number(t.daysMask)) || 0)),
          staffIds,
          reminderRepeatMin: Math.min(60, Math.max(5, Math.round(Number(t?.reminderRepeatMin)) || 15)),
          allowMidDayHandover: t?.allowMidDayHandover === true
        }
      })
      .slice(0, 24)
  }
  if (!templates.length) {
    // مهاجرت از داده‌ی قدیمی: فقط نام‌ها بود. نبودنِ کاملِ داده همان پیش‌فرضِ
    // شناسه‌دار را می‌گیرد؛ نام‌های قدیمی synthetic id پایدار می‌گیرند.
    const base = names.length ? names : DEFAULT_SHIFT_CONFIG.names
    templates = base.map((n, i) => {
      const fallback = DEFAULT_SHIFT_TEMPLATES[i] ?? { id: undefined, startTime: '00:00', endTime: '00:00' }
      const name = n || 'شیفت ' + (i + 1)
      const startTime = fallback.startTime
      const endTime = fallback.endTime
      return {
        id: idFor(undefined, i, name, startTime, endTime, names.length ? undefined : fallback.id),
        name,
        startTime,
        endTime,
        isActive: true,
        daysMask: 127,
        staffIds: [],
        reminderRepeatMin: 15,
        allowMidDayHandover: false
      }
    })
  }

  const singleShiftCustodianUserId = Math.round(Number(obj.singleShiftCustodianUserId))
  return {
    byTime: Boolean(obj.byTime),
    custodyMode: obj.custodyMode === 'MULTI_SHIFT' ? 'MULTI_SHIFT' : 'SINGLE_SHIFT',
    // Absence is intentional legacy compatibility—not an implied conversion.
    custodyModeConfigured: obj.custodyModeConfigured === true,
    singleShiftCustodianUserId:
      Number.isSafeInteger(singleShiftCustodianUserId) && singleShiftCustodianUserId > 0
        ? singleShiftCustodianUserId
        : null,
    reminderEnabled: obj.reminderEnabled !== false,
    overrunGraceMinutes: Math.min(1440, Math.max(0, Math.round(Number(obj.overrunGraceMinutes)) || 60)),
    templates,
    names: templates.map((t) => t.name),
    // بند ۷: هر مقدار ناشناخته ⇒ '12' (رفتار قبلی)، پس تنظیم قدیمی هم امن است
    clockFormat: String(obj.clockFormat ?? '') === '24' ? '24' : '12',
    // نشست ۳۱۰: نامشخص/خراب ⇒ ۰ (خاموش) — همیشه عدد صحیح در محدوده‌ی ۰..۲۴۰
    overtimeMaxMinutes: Math.min(
      240,
      Math.max(0, Math.trunc(Number(obj.overtimeMaxMinutes)) || 0)
    )
  }
}

/** نام شیفت شماره‌ی n (۱-based) طبق تنظیمات؛ خارج از محدوده = «شیفت n». */
export function shiftNameOf(cfg: Pick<ShiftConfig, 'names'>, num: number): string {
  return cfg.names[num - 1] || 'شیفت ' + num
}

/** یک شیفت زمان‌بندی‌شده که ساعت جاری داخل بازه‌اش افتاده است. */
export interface ShiftSlot {
  /** شماره‌ی شیفت (۱-based، همان ترتیب فهرست تنظیمات) */
  number: number
  name: string
  startTime: string
  endTime: string
  /**
   * ۰ = شیفت به همان روزِ ساعت جاری تعلق دارد.
   * ‎-۱ = شیفت شبانه‌ای که دیشب شروع شده (پس روزِ شیفت، «دیروز» است).
   */
  dayOffset: 0 | -1
  /** شیفت از نیمه‌شب رد می‌شود؟ */
  overnight: boolean
  /**
   * ساعت مورد بررسی *داخل* بازه‌ی هیچ شیفتی نبود و این «نزدیک‌ترین شیفت» است
   * (خروجی `resolveShiftSlot`، نه `findShiftSlot`).
   */
  outside?: boolean
  /** فاصله‌ی ساعت مورد بررسی تا بازه‌ی این شیفت، به دقیقه (۰ = داخل بازه) */
  distanceMinutes?: number
}

/**
 * شیفتِ متناظر با یک لحظه‌ی مشخص، طبق بازه‌های تعریف‌شده.
 *
 * بازه‌ها به‌صورت [شروع، پایان) در نظر گرفته می‌شوند، پس ۱۴:۰۰ دقیقاً شروع شیفت
 * دوم است نه پایان شیفت اول. اگر پایان ≤ شروع باشد (مثل ۲۰:۰۰ تا ۰۲:۰۰ یا
 * ۲۰:۰۰ تا ۰۰:۰۰) شیفت شبانه است و از نیمه‌شب رد می‌شود.
 * اگر ساعت جاری در هیچ بازه‌ای نباشد، `null` برمی‌گردد و صدازننده به رفتار
 * پیش‌فرض (خودکار) برمی‌گردد — یعنی هیچ فروشی به‌خاطر بازه‌ی جا‌افتاده زمین
 * نمی‌ماند.
 */
export function findShiftSlot(cfg: ShiftConfig, at: Date = new Date()): ShiftSlot | null {
  const now = at.getHours() * 60 + at.getMinutes()
  const list = cfg.templates ?? []
  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    const start = minutesOfTime(t.startTime)
    const rawEnd = minutesOfTime(t.endTime)
    const overnight = rawEnd <= start
    const base = {
      number: i + 1,
      name: t.name || 'شیفت ' + (i + 1),
      startTime: normalizeTime(t.startTime),
      endTime: normalizeTime(t.endTime),
      overnight
    }
    if (!overnight) {
      if (now >= start && now < rawEnd) return { ...base, dayOffset: 0 }
      continue
    }
    // شبانه: [شروع، ۲۴:۰۰) امروز  یا  [۰۰:۰۰، پایان) که به دیشب تعلق دارد
    if (now >= start) return { ...base, dayOffset: 0 }
    if (now < rawEnd) return { ...base, dayOffset: -1 }
  }
  return null
}

/** برچسب خوانای بازه‌ی یک شیفت («۰۸:۰۰ تا ۱۴:۰۰»). */
export function shiftWindowLabel(t: Pick<ShiftTemplate, 'startTime' | 'endTime'>): string {
  return `${normalizeTime(t.startTime)} تا ${normalizeTime(t.endTime)}`
}

/** فاصله‌ی دو ساعت روی دایره‌ی ۲۴ ساعته (دقیقه). */
function circularGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1440
  return Math.min(d, 1440 - d)
}

/**
 * ---------------------------------------------------------------------------
 * شیفتِ متناظر با یک لحظه، *با تضمین خروجی* (وقتی حداقل یک شیفت تعریف شده باشد).
 *
 * `findShiftSlot` اگر ساعت در هیچ بازه‌ای نباشد `null` می‌دهد و صدازننده به
 * شماره‌گذاری خودکار (۱، ۲، ۳، …) برمی‌گشت. نتیجه‌اش این بود که با روشن بودن
 * «تعیین شیفت بر اساس ساعت»، بستنِ صندوق در ساعتی که بین بازه‌ها جا افتاده،
 * باز هم یک شماره‌ی جدید (مثلاً «شیفت ۷») می‌ساخت — دقیقاً همان چیزی که نباید
 * می‌شد.
 *
 * پس این تابع در آن حالت «نزدیک‌ترین شیفت» را برمی‌گرداند و با `outside: true`
 * علامتش می‌زند تا UI بتواند شفاف بگوید «خارج از بازه‌های تعریف‌شده». معیار
 * نزدیکی، کمترین فاصله تا *شروع یا پایان* بازه روی دایره‌ی ۲۴ ساعته است و در
 * تساوی، شیفت با شماره‌ی کوچک‌تر برنده می‌شود (پایدار و قابل‌پیش‌بینی).
 * ---------------------------------------------------------------------------
 */
export function resolveShiftSlot(cfg: ShiftConfig, at: Date = new Date()): ShiftSlot | null {
  const inside = findShiftSlot(cfg, at)
  if (inside) return { ...inside, outside: false, distanceMinutes: 0 }

  const list = cfg.templates ?? []
  if (!list.length) return null

  const now = at.getHours() * 60 + at.getMinutes()
  let best: ShiftSlot | null = null
  let bestGap = Number.POSITIVE_INFINITY

  for (let i = 0; i < list.length; i++) {
    const t = list[i]
    const start = minutesOfTime(t.startTime)
    const rawEnd = minutesOfTime(t.endTime)
    const overnight = rawEnd <= start
    const gap = Math.min(circularGap(now, start), circularGap(now, rawEnd))
    if (gap < bestGap) {
      bestGap = gap
      best = {
        number: i + 1,
        name: t.name || 'شیفت ' + (i + 1),
        startTime: normalizeTime(t.startTime),
        endTime: normalizeTime(t.endTime),
        overnight,
        // شیفت شبانه‌ای که *پایانش* به ما نزدیک‌تر است، دیشب شروع شده بوده
        dayOffset: overnight && circularGap(now, rawEnd) < circularGap(now, start) ? -1 : 0,
        outside: true,
        distanceMinutes: gap
      }
    }
  }
  return best
}

// ===========================================================================
// جلسه ۱۹ — «نشست شیفت» (Session) و «تاریخ و ساعت رسمی»
//
// چرا نشست؟ چون تا دیروز هر بازه‌ی ساعتی فقط *یک رکورد ثابت* در روز داشت که با
// هر بار برگشتن به همان بازه بازنویسی/بازباز می‌شد. نتیجه‌اش سه اشتباه واقعی بود:
// تحویل زودهنگام، وقفه و بازگشت، و جایگزین موقت (سهم کارمند اول پاک می‌شد).
// حالا هر بار که صندوق دست‌به‌دست می‌شود یک «نشست» تازه ساخته می‌شود و هیچ نشستی
// هیچ‌وقت رونویسی یا حذف نمی‌شود.
// ===========================================================================

/** ارقام فارسی برای برچسب‌های نمایشی همین فایل (بدون وابستگی به jalali.ts). */
const faNum = (n: number | string): string =>
  String(n).replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

/**
 * قالب دقیق نام نمایشی یک نشست: «شیفت شب — نشست ۲».
 *
 * عمداً با « — نشست n» ساخته می‌شود تا با نام‌های رسمی شیفت در تنظیمات (مثل
 * «شیفت ۲») قاطی نشود. نشست شماره‌ی ۱ هم همین قالب را می‌گیرد، چون در گزارش‌ها
 * باید بی‌ابهام معلوم باشد که داریم یک *نشست* را می‌بینیم نه سرجمع آن نام.
 */
export function sessionLabelOf(name: string, seq: number): string {
  const n = Math.max(1, Math.round(Number(seq) || 1))
  return `${name || 'شیفت'} — نشست ${faNum(n)}`
}

/**
 * پیدا کردن قالب (بازه‌ی ساعتی) یک نام شیفت از تنظیمات.
 * خروجی `number` همان ترتیب ۱-based جدول «شیفت‌های روز» است.
 * نام ناشناخته (مثلاً شیفتی که مدیر بعداً حذفش کرده) ⇒ null، و هیچ‌جا کرش
 * نمی‌کند: صدازننده‌ها باید با null هم کار کنند.
 */
export function findShiftTemplate(
  cfg: Pick<ShiftConfig, 'templates'>,
  name: string | null | undefined
): { template: ShiftTemplate; number: number } | null {
  const target = String(name ?? '').trim()
  if (!target) return null
  const list = cfg.templates ?? []
  for (let i = 0; i < list.length; i++) {
    if ((list[i].name || 'شیفت ' + (i + 1)).trim() === target) return { template: list[i], number: i + 1 }
  }
  return null
}

/**
 * آیا یک ساعت (Date) داخل بازه‌ی همین قالب شیفت است؟
 * بازه [شروع، پایان) است و شیفت شبانه (پایان ≤ شروع) از نیمه‌شب رد می‌شود.
 */
export function isWithinTemplate(t: Pick<ShiftTemplate, 'startTime' | 'endTime'>, at: Date): boolean {
  const now = at.getHours() * 60 + at.getMinutes()
  const start = minutesOfTime(t.startTime)
  const rawEnd = minutesOfTime(t.endTime)
  if (rawEnd <= start) return now >= start || now < rawEnd
  return now >= start && now < rawEnd
}

/**
 * ---------------------------------------------------------------------------
 * بند ۹ — تنظیمات «تاریخ و ساعت رسمی».
 *
 * فقط یک عدد: افست دستی به ساعت. هدفش «آماده بودن برای تغییرات آینده»ی قانون
 * ساعت رسمی کشور است، بدون بازنویسی منطق شیفت. صفر = رفتار مو‌به‌موی قبل.
 * ---------------------------------------------------------------------------
 */
export interface OfficialTimeConfig {
  /** افست دستی ساعت رسمی کشور، به ساعت (می‌تواند منفی یا نیم‌ساعتی باشد) */
  offsetHours: number
}

export const DEFAULT_OFFICIAL_TIME_CONFIG: OfficialTimeConfig = { offsetHours: 0 }

export const parseOfficialTimeConfig = (raw: unknown): OfficialTimeConfig => {
  let obj: any = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      obj = null
    }
  }
  if (!obj || typeof obj !== 'object') obj = {}
  let h = Number(obj.offsetHours)
  if (!Number.isFinite(h)) h = 0
  // سقف معقول و امن: بیشتر از ±۱۲ ساعت هیچ معنای «ساعت رسمی»ای ندارد
  h = Math.max(-12, Math.min(12, Math.round(h * 60) / 60))
  return { offsetHours: h }
}

/** همان لحظه، با افست «ساعت رسمی» اعمال‌شده. افست صفر ⇒ خودِ همان Date. */
export function applyOfficialOffset(at: Date, cfg: Pick<OfficialTimeConfig, 'offsetHours'>): Date {
  const minutes = Math.round((Number(cfg?.offsetHours) || 0) * 60)
  if (!minutes) return at
  return new Date(at.getTime() + minutes * 60_000)
}

/**
 * بند ۷ — نمایش یک ساعت ذخیره‌شده‌ی 'HH:mm' طبق سلیقه‌ی مدیر.
 * ⚠️ فقط برچسب نمایشی است؛ مقدار ذخیره‌شده هیچ‌وقت عوض نمی‌شود.
 */
export function formatClockForDisplay(hhmm: string, fmt: ShiftClockFormat): string {
  const v = normalizeTime(hhmm)
  const [hRaw, m] = v.split(':')
  const h = Number(hRaw)
  if (fmt === '24') return v
  const suffix = h < 12 ? 'قبل‌از‌ظهر (AM)' : 'بعدازظهر (PM)'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${String(h12).padStart(2, '0')}:${m} ${suffix}`
}

// ===========================================================================
// جلسه ۱۷ · بند ۵ — تنظیمات «یادآوری انبارگردانی فیزیکی»
// ===========================================================================

export interface StocktakeSchedule {
  /** یادآوری روشن است؟ */
  enabled: boolean
  /** تاریخ‌های مشخص شمسی (مثل ۱۴۰۵/۰۷/۰۱) */
  dates: string[]
  /** بازه‌ی تکرارشونده به روز (۰ = بدون تکرار) */
  everyDays: number
  /** تاریخ شمسی مبنای شمارش بازه‌ی تکرارشونده (خالی = آخرین شمارش ثبت‌شده) */
  startJalali: string
  /** آخرین تاریخی که مدیر یادآوری‌اش را «دیدم» کرده است */
  dismissedJalali: string
}

export const DEFAULT_STOCKTAKE_SCHEDULE: StocktakeSchedule = {
  enabled: false,
  dates: [],
  everyDays: 0,
  startJalali: '',
  dismissedJalali: ''
}

/** فقط الگوی ۴-۲-۲ رقمی شمسی پذیرفته می‌شود؛ ورودی خراب بی‌صدا حذف می‌گردد. */
const JALALI_DATE_RE = /^\d{4}\/\d{2}\/\d{2}$/

export function parseStocktakeSchedule(raw: unknown): StocktakeSchedule {
  let parsed: unknown = raw
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const dates = Array.isArray(o.dates)
    ? [...new Set(o.dates.map((d) => String(d ?? '').trim()).filter((d) => JALALI_DATE_RE.test(d)))].sort()
    : []
  const every = Math.round(Number(o.everyDays))
  const start = String(o.startJalali ?? '').trim()
  const dismissed = String(o.dismissedJalali ?? '').trim()
  return {
    enabled: o.enabled === true,
    dates,
    everyDays: Number.isFinite(every) && every > 0 ? Math.min(every, 3650) : 0,
    startJalali: JALALI_DATE_RE.test(start) ? start : '',
    dismissedJalali: JALALI_DATE_RE.test(dismissed) ? dismissed : ''
  }
}
