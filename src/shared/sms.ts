/**
 * ===========================================================================
 * «پنل پیامکی» — منطق خالص و مشترک بین main و renderer.
 *
 * چرا این فایل جدا است: همه‌ی تصمیم‌های قابل‌سنجش (موتور متن، شمردن بخش‌های
 * پیام، فاصله‌ی تلاش مجدد، کلید جلوگیری از تکرار، اعتبار شماره) اینجا و
 * **بدون دیتابیس و بدون شبکه** نوشته شده‌اند تا با هارنس تست پروژه قابل
 * سنجش باشند. سرویس‌های main فقط این توابع را صدا می‌زنند.
 *
 * ⚠️ این ماژول به هیچ ماژول دیگری وابسته نیست: نه به فروش، نه به اعتبار، نه
 * به گزارش مدیریت. تنها چیزی که «می‌داند»، شکل یک پیام است.
 * ===========================================================================
 */
import { toLatinDigits } from '@shared/jalali'

// ---------------------------------------------------------------------------
// ۱) وضعیت‌های صف
// ---------------------------------------------------------------------------

/**
 * وضعیت یک ردیف صف پیام.
 *
 * `UNKNOWN` عمداً وجود دارد: بدترین حالتِ ارسال این است که سرویس‌دهنده پیام را
 * *پذیرفته باشد* ولی پاسخ به ما نرسیده باشد (timeout بعد از ارسال). آن‌وقت
 * «تلاش مجدد کور» یعنی پیام دوم به مشتری — پس به‌جایش UNKNOWN می‌نشیند و
 * تلاش خودکار **متوقف** می‌شود تا آدم تصمیم بگیرد.
 */
export const SmsOutboxStatus = {
  /** در صف، آماده‌ی ارسال (شامل زمان‌بندی‌شده‌ها) */
  PENDING: 'PENDING',
  /** همین حالا در دست یک کارگر است */
  PROCESSING: 'PROCESSING',
  /** واقعاً به سرویس‌دهنده سپرده شد */
  SENT: 'SENT',
  /** شکست خورد، ولی بعداً دوباره تلاش می‌شود */
  FAILED_RETRYABLE: 'FAILED_RETRYABLE',
  /** شکست قطعی (شماره‌ی نامعتبر، کلید اشتباه، سقف تلاش) */
  FAILED_FINAL: 'FAILED_FINAL',
  /** خودمان لغو کردیم — می‌شود برگرداند به صف */
  CANCELED: 'CANCELED',
  /** اصلاً نفرست: بی‌شماره، Opt-out، قالب ناشناس */
  SKIPPED: 'SKIPPED',
  /** نتیجه نامعلوم — نه تلاش خودکار، نه ادعای ارسال */
  UNKNOWN: 'UNKNOWN'
} as const
export type SmsOutboxStatus = (typeof SmsOutboxStatus)[keyof typeof SmsOutboxStatus]

export const SMS_STATUS_LABELS: Record<string, string> = {
  PENDING: 'در صف',
  PROCESSING: 'در حال ارسال',
  SENT: 'ارسال شد',
  FAILED_RETRYABLE: 'ناموفق — تلاش مجدد',
  FAILED_FINAL: 'ناموفق — قطعی',
  CANCELED: 'لغو شد',
  SKIPPED: 'ارسال نشد',
  UNKNOWN: 'نتیجه نامعلوم'
}

/** پیام‌هایی که هنوز «در جریان» اند (نه ارسال‌شده، نه پایانی). */
export const SMS_LIVE_STATUSES: readonly string[] = [
  SmsOutboxStatus.PENDING,
  SmsOutboxStatus.PROCESSING,
  SmsOutboxStatus.FAILED_RETRYABLE
]

/** پیام‌هایی که با اطمینان می‌دانیم ارسال نشده‌اند ⇒ لغوپذیر. */
export const SMS_CANCELABLE_STATUSES: readonly string[] = [
  SmsOutboxStatus.PENDING,
  SmsOutboxStatus.FAILED_RETRYABLE
]

/** نتیجه‌ای که «مالکش را نمی‌شناسیم» ⇒ تلاش خودکار ممنوع. */
export const SMS_RETRY_BLOCKED_STATUSES: readonly string[] = [
  SmsOutboxStatus.SENT,
  SmsOutboxStatus.UNKNOWN,
  SmsOutboxStatus.CANCELED,
  SmsOutboxStatus.SKIPPED,
  SmsOutboxStatus.FAILED_FINAL
]

export function isSmsCancelable(status: unknown): boolean {
  return SMS_CANCELABLE_STATUSES.includes(String(status ?? ''))
}

/** آیا از این وضعیت می‌شود به صف برگرداند؟ (همان دکمه‌ی «برگرداندن به صف») */
export function isSmsRequeueable(status: unknown): boolean {
  const s = String(status ?? '')
  return s === SmsOutboxStatus.CANCELED || s === SmsOutboxStatus.FAILED_FINAL
}

// ---------------------------------------------------------------------------
// ۲) نوع رویداد (چرا این پیام ساخته شد)
// ---------------------------------------------------------------------------

export const SmsEventType = {
  /** تشکر بعد از ثبت فاکتور — خرده و عمده */
  SALE_THANK_YOU: 'SALE_THANK_YOU',
  /** یادآوری اعتبار خرید (کد تاریخ‌دار) */
  CREDIT_REMINDER: 'CREDIT_REMINDER',
  /** یادآوری اعتبار خرید بدون تاریخ انقضا */
  CREDIT_REMINDER_NO_EXPIRY: 'CREDIT_REMINDER_NO_EXPIRY',
  /** پیامک انبوه تبلیغاتی */
  CAMPAIGN: 'CAMPAIGN',
  /** ارسال دستی از پنل */
  MANUAL: 'MANUAL',
  /** تست اتصال سرویس‌دهنده */
  TEST: 'TEST'
} as const
export type SmsEventType = (typeof SmsEventType)[keyof typeof SmsEventType]

export const SMS_EVENT_LABELS: Record<string, string> = {
  SALE_THANK_YOU: 'تشکر از خرید',
  SALE_THANK_YOU_WHOLESALE: 'تشکر از خرید عمده',
  CREDIT_REMINDER: 'یادآوری اعتبار',
  CREDIT_REMINDER_NO_EXPIRY: 'یادآوری اعتبار بدون تاریخ',
  CAMPAIGN: 'پیامک انبوه',
  MANUAL: 'ارسال دستی',
  TEST: 'تست اتصال'
}

export function smsEventLabel(eventType: unknown): string {
  const k = String(eventType ?? '')
  return SMS_EVENT_LABELS[k] ?? k ?? '—'
}

// ---------------------------------------------------------------------------
// ۳) سرویس‌دهنده‌ها
// ---------------------------------------------------------------------------

/**
 * سرویس‌دهنده‌های شناخته‌شده. هر کدام یک آداپتور جدا در
 * `src/main/services/sms/providers.ts` دارد.
 *
 * `LOG_ONLY` هیچ تماس شبکه‌ای ندارد و پیش‌فرض است: تا وقتی کاربر کلید واقعی
 * نگذاشته، هیچ پیامکی از این دستگاه بیرون نمی‌رود.
 */
export const SMS_PROVIDER_KEYS = ['LOG_ONLY', 'SMS_IR', 'KAVENEGAR'] as const
export type SmsProviderKey = (typeof SMS_PROVIDER_KEYS)[number]

export const SMS_PROVIDER_LABELS: Record<string, string> = {
  LOG_ONLY: 'آزمایشی (بدون ارسال واقعی)',
  SMS_IR: 'sms.ir',
  KAVENEGAR: 'کاوه‌نگار'
}

export function normalizeSmsProviderKey(raw: unknown): SmsProviderKey {
  const v = String(raw ?? '').trim().toUpperCase()
  return (SMS_PROVIDER_KEYS as readonly string[]).includes(v) ? (v as SmsProviderKey) : 'LOG_ONLY'
}

/** سرویس‌دهنده‌هایی که کلید API لازم دارند (برای پیام «تنظیم نشده»). */
export function smsProviderNeedsCredentials(key: unknown): boolean {
  return normalizeSmsProviderKey(key) !== 'LOG_ONLY'
}

// ---------------------------------------------------------------------------
// ۴) اعتبارسنجی شماره
// ---------------------------------------------------------------------------

/**
 * یکسان‌سازی شماره موبایل ایران.
 *
 * عمداً از `normalizePhone` پنل مشتریان جدا است ولی همان منطق را دارد: ورودی
 * می‌تواند «۰۹۱۲…»، «+۹۸۹۱۲…»، «۹۸۹۱۲…» یا با فاصله/خط تیره باشد.
 * خروجی همیشه `09XXXXXXXXX` است، و اگر شماره موبایل معتبر نباشد **رشته‌ی
 * خالی** برمی‌گردد (هیچ‌وقت شماره‌ی نیم‌بند تحویل سرویس‌دهنده نمی‌دهیم).
 */
export function normalizeSmsPhone(raw: unknown): string {
  let p = toLatinDigits(String(raw ?? '')).replace(/[^0-9+]/g, '').replace(/^\+/, '')
  if (p.startsWith('0098')) p = p.slice(4)
  else if (p.startsWith('98') && p.length > 10) p = p.slice(2)
  p = p.replace(/^0+/, '')
  const out = `0${p}`
  return /^09\d{9}$/.test(out) ? out : ''
}

export function isValidSmsPhone(raw: unknown): boolean {
  return normalizeSmsPhone(raw) !== ''
}

/** نمایش کوتاه شماره در فهرست‌ها (بدون حذف اطلاعات — فقط قالب‌بندی). */
export function formatSmsPhone(raw: unknown): string {
  const p = normalizeSmsPhone(raw) || toLatinDigits(String(raw ?? '')).trim()
  if (p.length === 11) return `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}`
  return p || '—'
}

// ---------------------------------------------------------------------------
// ۵) موتور متن و Placeholder ها
// ---------------------------------------------------------------------------

/**
 * متغیرهای مجاز. هر متغیری که اینجا نباشد، **خطا** می‌دهد و پیام وارد صف
 * نمی‌شود — تا «{نام_ناشناس}» عیناً به دست مشتری نرسد.
 */
export const SMS_PLACEHOLDERS = [
  'customer_name',
  'customer_phone',
  'store_name',
  'store_phone',
  'invoice_no',
  'invoice_date',
  'invoice_total',
  'paid_amount',
  'remaining_amount',
  'credit_code',
  'credit_amount',
  'credit_remaining',
  'credit_expiry',
  'campaign_text',
  'opt_out_note'
] as const
export type SmsPlaceholder = (typeof SMS_PLACEHOLDERS)[number]

export const SMS_PLACEHOLDER_LABELS: Record<string, string> = {
  customer_name: 'نام مشتری',
  customer_phone: 'شماره مشتری',
  store_name: 'نام فروشگاه',
  store_phone: 'تلفن فروشگاه',
  invoice_no: 'شماره فاکتور',
  invoice_date: 'تاریخ فاکتور',
  invoice_total: 'مبلغ کل فاکتور',
  paid_amount: 'مبلغ پرداختی',
  remaining_amount: 'مانده',
  credit_code: 'کد اعتبار',
  credit_amount: 'مبلغ اعتبار',
  credit_remaining: 'باقی‌مانده اعتبار',
  credit_expiry: 'تاریخ انقضای اعتبار',
  campaign_text: 'متن کمپین',
  opt_out_note: 'جمله‌ی لغو تبلیغات'
}

export interface SmsRenderResult {
  /** متن نهایی با مقادیر جای‌گذاری‌شده */
  text: string
  /** متغیرهایی که در متن بودند ولی مقدار نداشتند (خالی جای‌گذاری شدند) */
  missing: string[]
  /** متغیرهای ناشناخته (خارج از فهرست مجاز) — وجودشان یعنی متن نامعتبر */
  unknown: string[]
}

/**
 * الگوی متغیر: «{توکنِ بدون فاصله}».
 * عمداً محدود به حروف لاتین نیست (دلیلش بالای `smsPlaceholdersOf` آمده) و
 * عمداً فاصله را نمی‌پذیرد تا متن‌های عادیِ داخل آکولاد را قالب‌بندی نکند.
 */
const PLACEHOLDER_RE = /\{([^\s{}]+)\}/g

/**
 * جای‌گذاری متغیرها. کلید ناشناخته **دست‌نخورده** می‌ماند و در `unknown`
 * گزارش می‌شود تا هیچ‌وقت بی‌صدا پاک/خالی نشود.
 */
export function renderSmsTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined> = {}
): SmsRenderResult {
  const allowed = new Set<string>(SMS_PLACEHOLDERS as readonly string[])
  const missing: string[] = []
  const unknown: string[] = []
  const text = String(body ?? '').replace(PLACEHOLDER_RE, (whole, key: string) => {
    const k = String(key).toLowerCase()
    if (!allowed.has(k)) {
      if (!unknown.includes(k)) unknown.push(k)
      return whole
    }
    const raw = vars[k]
    if (raw == null || String(raw).trim() === '') {
      if (!missing.includes(k)) missing.push(k)
      return ''
    }
    return String(raw)
  })
  return { text: text.replace(/[ \t]{2,}/g, ' ').trim(), missing, unknown }
}

/**
 * متغیرهای به‌کاررفته در یک متن (برای پیش‌نمایش و اعتبارسنجی قالب).
 *
 * ⚠️ الگو **فقط ASCII نیست** و این عمدی است: کاربر فارسی‌زبان به‌راحتی
 * `{نام_مشتری}` می‌نویسد. اگر فقط حروف لاتین شناسایی می‌شد، آن متن «معتبر»
 * به‌نظر می‌رسید و عیناً با آکولاد برای مشتری ارسال می‌شد. حالا هر چیزی
 * که یک توکنِ بدون فاصله داخل آکولاد باشد شناسایی می‌شود و در فهرست
 * ناشناخته‌ها می‌افتد ⇒ ذخیره‌ی قالب رد می‌شود تا کاربر اصلاحش کند.
 * متن عادی داخل آکولاد (مثل «{تخفیف ویژه}») فاصله دارد و دست‌نخورده می‌ماند.
 */
export function smsPlaceholdersOf(body: string): string[] {
  const out: string[] = []
  const re = PLACEHOLDER_RE
  /** الگوی مشترک `g` است ⇒ `lastIndex` باید هر بار از صفر شروع کند. */
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(String(body ?? '')))) {
    const k = m[1].toLowerCase()
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/** قالب وقتی معتبر است که هیچ متغیر ناشناسی نداشته باشد و خالی نباشد. */
export function validateSmsBody(body: string): { ok: boolean; reason: string } {
  const text = String(body ?? '').trim()
  if (!text) return { ok: false, reason: 'متن پیام خالی است.' }
  const unknown = smsPlaceholdersOf(text).filter(
    (k) => !(SMS_PLACEHOLDERS as readonly string[]).includes(k)
  )
  if (unknown.length)
    return { ok: false, reason: `متغیر ناشناخته: ${unknown.map((k) => `{${k}}`).join(' ')}` }
  return { ok: true, reason: '' }
}

// ---------------------------------------------------------------------------
// ۶) شمردن بخش‌های پیام (و در نتیجه هزینه)
// ---------------------------------------------------------------------------

/** نویسه‌های مجاز GSM-7 (هر چیز دیگری ⇒ UCS-2 که گران‌تر است). */
const GSM7_RE =
  /^[A-Za-z0-9 @£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà\^{}\\[~\]|€\n\r]*$/

export type SmsEncoding = 'GSM7' | 'UCS2'

/** فارسی همیشه UCS-2 است ⇒ ۷۰ نویسه در پیام اول، ۶۷ در هر پیام بعدی. */
export function smsEncoding(text: string): SmsEncoding {
  return GSM7_RE.test(String(text ?? '')) ? 'GSM7' : 'UCS2'
}

export function smsSegments(text: string): number {
  const s = String(text ?? '')
  if (!s.length) return 0
  const gsm = smsEncoding(s) === 'GSM7'
  const single = gsm ? 160 : 70
  const multi = gsm ? 153 : 67
  return s.length <= single ? 1 : Math.ceil(s.length / multi)
}

/**
 * برآورد هزینه. قیمت هر پیامک را کاربر در تنظیمات وارد می‌کند (تومان)، چون
 * تعرفه‌ی سرویس‌دهنده‌ها عوض می‌شود و ما حدس نمی‌زنیم.
 */
export function smsCostEstimate(
  segments: number,
  recipients: number,
  pricePerSegmentToman: number
): { messages: number; toman: number } {
  const seg = Math.max(0, Math.round(Number(segments) || 0))
  const n = Math.max(0, Math.round(Number(recipients) || 0))
  const price = Math.max(0, Math.round(Number(pricePerSegmentToman) || 0))
  const messages = seg * n
  return { messages, toman: messages * price }
}

// ---------------------------------------------------------------------------
// ۷) سیاست تلاش مجدد
// ---------------------------------------------------------------------------

export const SMS_MAX_ATTEMPTS = 5

/**
 * فاصله‌ی قبل از تلاشِ بعدی، بر حسب «تعداد تلاش‌هایی که تا حالا شده».
 *
 *   ۰ تلاش کرده‌ایم ⇒ فوری (اولین تلاش)
 *   ۱ ⇒ ۱ دقیقه · ۲ ⇒ ۵ دقیقه · ۳ ⇒ ۱۵ دقیقه · ۴ و بیشتر ⇒ ۱ ساعت
 *
 * عمداً سقف‌دار است: «تأخیر مجاز، گم‌شدن هرگز» یعنی بی‌نهایت پشت‌سرهم تلاش
 * نکنیم، ولی پیام هم دور انداخته نشود.
 */
export const SMS_RETRY_BACKOFF_MS: readonly number[] = [
  0,
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000
]

export function smsBackoffMs(attemptsMade: number): number {
  const n = Math.max(0, Math.round(Number(attemptsMade) || 0))
  return SMS_RETRY_BACKOFF_MS[Math.min(n, SMS_RETRY_BACKOFF_MS.length - 1)]
}

// ---------------------------------------------------------------------------
// ۷-۲) شکستِ «منتظرِ شرایط» — بازبینی هفتم (SMS-R7-01)
// ---------------------------------------------------------------------------

/**
 * 🔴 چرا این ثابت‌ها وجود دارند: سقف ۵ تلاش (≈۸۱ دقیقه) برای خطاهای *قطعی*
 * درست است، ولی برای شکست‌هایی که خودشان می‌روند — قطعی اینترنت، تمام‌شدن
 * اعتبار حساب، «سرور بعداً تلاش کن» — معنی ندارد. قبلاً همان ۸۱ دقیقه سهمیه را
 * می‌سوزاند و پیام `FAILED_FINAL` می‌شد؛ یعنی بعد از شارژ حساب یا وصل‌شدن
 * اینترنت **خودکار نمی‌رفت** و برخلاف متنی بود که خودِ برنامه نشان می‌داد
 * («پس از شارژ حساب، خودکار ادامه می‌یابد»).
 *
 * قاعده‌ی جدید: آداپتور با پرچم `waiting` می‌گوید «من پیام را نپذیرفتم، ولی
 * مشکل موقتیِ محیط است» — این حالت:
 *   • سهمیه‌ی ۵ تلاش را **نمی‌سوزاند** (پیام به‌خاطر مشکل موقتی از دست نمی‌رود).
 *   • با فاصله‌ی **ثابت** یک ساعت دوباره تلاش می‌کند (نه backoff نماییِ سوزاننده).
 *   • تا سقف سنی **۷۲ ساعت** از `createdAt` ادامه می‌دهد؛ بعد از آن (اگر هنوز
 *     هیچ سرویس‌دهنده‌ای جواب نمی‌دهد) `FAILED_FINAL` می‌شود تا ردیف در صف
 *     برای همیشه نچرخد — ولی پیام پاک نمی‌شود و «تلاش مجدد» دستی همیشه هست.
 *
 * خطر «پیام دوم» ندارد: این پاسخ‌ها صریحاً می‌گویند پیام **پذیرفته نشد**
 * (`unknown` نیستند).
 */
export const SMS_WAITING_BACKOFF_MS = 60 * 60 * 1000

/**
 * سقف سنی «منتظرِ شرایط» — بعد از این، ردیف «ناموفق قطعی» می‌شود (نه گم).
 *
 * ⚠️ این سقف روی **طول دوره‌ی انتظار** است، نه عمر ردیف. `since` ورودیِ
 * `smsWaitingExpired` همان «لحظه‌ای است که انتظار شروع شد».
 *
 * 🔴 بازبینی هشتم (SMS-R8-01): تا امروز این لحظه `createdAt` بود. برای پیامِ
 * زمان‌بندی‌شده برای چند روز بعد (که UI اجازه می‌دهد) `createdAt` همان لحظه‌ی
 * ثبت است؛ پس اولین خطای موقتی — چند روز بعد، سرِ موعد — فوراً «کهنه» حساب
 * می‌شد و پیام در همان تلاش اول `FAILED_FINAL` می‌شد. حالا مرجع، اولین تلاشِ
 * نتیجه‌ی `WAITING` است (شروع واقعیِ انتظار) و اگر چنین تلاشی ثبت نشده باشد،
 * همین لحظه — یعنی انتظار تازه شروع شده و منقضی نیست.
 */
export const SMS_WAITING_MAX_AGE_MS = 72 * 60 * 60 * 1000

/** آیا دوره‌ی «منتظرِ شرایط» از سقف ۷۲ ساعت گذشته است؟ */
export function smsWaitingExpired(since: Date | number | null | undefined, now: Date | number = Date.now()): boolean {
  const t = since instanceof Date ? since.getTime() : Number(since ?? 0)
  const n = now instanceof Date ? now.getTime() : Number(now)
  if (!Number.isFinite(t) || t <= 0) return false
  return n - t > SMS_WAITING_MAX_AGE_MS
}

/** سقف عمرِ «قفل» یک کارگر؛ بعد از این، ردیفِ PROCESSING یتیم تلقی می‌شود. */
export const SMS_LOCK_TIMEOUT_MS = 5 * 60 * 1000

// ---------------------------------------------------------------------------
// ۸) کلید جلوگیری از تکرار
// ---------------------------------------------------------------------------

/** پاک‌سازی یک قطعه‌ی کلید تا `:` داخلش نباشد (جداکننده خراب نشود). */
function part(v: unknown): string {
  return String(v ?? '')
    .trim()
    .replace(/[\s:]+/g, '-')
    .slice(0, 64)
}

/**
 * کلید یکتای هر پیام: `eventType:entity:entityId:templateCode:phone[:period]`.
 *
 * ⚠️ چرا همیشه غیرخالی است: در SQLite ایندکس `UNIQUE` چند `NULL` را می‌پذیرد،
 * پس اگر ارسال دستی کلید نداشت، همان ایندکس جلوی دوبار کلیک را **نمی‌گرفت**.
 * پس همه‌ی مسیرها — دستی و انبوه هم — کلید می‌سازند.
 *
 * `period` برای پیام‌های تکرارشدنی است (یادآوری اعتبار) و **شمسی** است:
 * `۱۴۰۵/۰۷`. چون مرز «دوره» باید با ماه شمسی بخورد، نه میلادی.
 */
export function smsDedupeKey(input: {
  eventType: string
  entityType?: string | null
  entityId?: number | string | null
  templateCode?: string | null
  phone?: string | null
  period?: string | null
}): string {
  const bits = [
    part(input.eventType),
    part(input.entityType ?? '-'),
    part(input.entityId ?? '-'),
    part(input.templateCode ?? '-'),
    part(input.phone ?? '-')
  ]
  if (input.period) bits.push(part(input.period))
  return bits.join(':')
}

/** کلید دوره‌ی یک تاریخ شمسی: `۱۴۰۵/۰۷/۱۵` ⇒ `1405-07`. */
export function smsPeriodKey(jalaliYmd: unknown): string {
  const ymd = toLatinDigits(String(jalaliYmd ?? '')).replace(/[^0-9/]/g, '')
  const m = /^(\d{4})\/(\d{1,2})/.exec(ymd)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}` : ''
}

/** کلید وابستگی به تاریخ برای یادآوری‌ها (اعتبار + دوره). */
export function smsReminderKey(creditId: number, kind: string, jalaliToday: string): string {
  return smsDedupeKey({
    eventType: 'CREDIT_REMINDER',
    entityType: 'StoreCredit',
    entityId: creditId,
    templateCode: kind,
    phone: '-',
    period: smsPeriodKey(jalaliToday)
  })
}

// ---------------------------------------------------------------------------
// ۹) تنظیمات (روی جدول `Setting`، بدون migration)
// ---------------------------------------------------------------------------

/**
 * کلیدهای تنظیمات پنل پیامکی در جدول `Setting`.
 *
 * `pricePerSegment` تنها جایی است که «پول» وارد این ماژول می‌شود و صرفاً یک
 * **برآورد** برای نمایش است؛ هیچ محاسبهٔ مالی پروژه از آن استفاده نمی‌کند.
 */
export const SMS_SETTING_KEYS = {
  /** تنظیمات ارسال خودکار یادآوری اعتبار (زمان‌بند) */
  auto: 'sms.auto',
  /** قیمت هر بخش پیامک (تومان) — فقط برای برآورد هزینه در UI */
  pricePerSegment: 'sms.pricePerSegment',
  /**
   * کلید «تشکر از خرید» — **یک** کلید برای کل برنامه.
   *
   * چرا یک کلید و نه دو تا (یکی برای فروش تکی و یکی عمده): خودِ درخواست
   * «یک کلید سراسری» بود، و عملاً هم کسی نمی‌خواهد پیام تشکر عمده روشن باشد
   * و تکی خاموش؛ اگر نیاز شد، همان لحظه می‌شود برای هر نوع، متن را خاموش کرد
   * (قالبِ غیرفعال ⇒ هیچ پیامی برای آن نوع ساخته نمی‌شود).
   */
  thankYou: 'sms.thankYou',
  /** امضای انتهای پیام‌های تبلیغاتی (متن «لغو ۱۱» و مانند آن) */
  optOutNote: 'sms.optOutNote',
  /** نام و تلفن فروشگاه که در متن پیام‌ها می‌نشیند */
  storeSignature: 'sms.storeSignature',
  /**
   * آخرین روزی که زمان‌بند خودکار اجرا شده (`YYYY-MM-DD`).
   *
   * چرا در دیتابیس و نه در حافظه: اگر برنامه وسط روز دوباره باز شود، نباید
   * یک بار دیگر برای همه‌ی مشتری‌ها پیام برود. «هر روز یک بار» یک قاعده‌ی
   * داده‌ای است، نه یک حالت اجرایی.
   */
  autoLastRun: 'sms.auto.lastRun'
} as const

/**
 * پارسِ تاب‌آور یک کلید روشن/خاموشِ ساده (ورودی خراب ⇒ پیش‌فرض، نه خطا).
 *
 * چرا `JSON.parse`: مقدارها در جدول `Setting` متن‌اند و ممکن است از نسخه‌های
 * قدیمی «true»/«1»/`{"enabled":true}` باشند. همه‌شان باید یک معنا بدهند.
 */
export function parseSmsSwitch(raw: unknown, fallback = false): boolean {
  if (raw == null) return fallback
  if (typeof raw === 'boolean') return raw
  const text = String(raw).trim()
  if (!text) return fallback
  if (text === 'true' || text === '1') return true
  if (text === 'false' || text === '0') return false
  try {
    const obj = JSON.parse(text)
    if (typeof obj === 'boolean') return obj
    if (obj && typeof obj === 'object' && typeof (obj as any).enabled === 'boolean') return (obj as any).enabled
  } catch {
    /* پیش‌فرض */
  }
  return fallback
}

/**
 * پیش‌فرض «تشکر از خرید» = خاموش.
 *
 * چرا خاموش و نه روشن، در حالی که خودِ قابلیت درخواست کاربر بوده: هر پیامک
 * برای او پول خرج می‌کند و لحظه‌ی وصل‌کردن سرویس‌دهنده بدترین وقت برای کشف
 * «چرا صد پیام رفت؟» است. در عوض، پنل یک نوار زرد روشن با دکمه‌ی یک‌کلیکی
 * نشان می‌دهد تا روشن‌کردنش دو ثانیه باشد.
 */
export const DEFAULT_SMS_THANK_YOU = false

export interface SmsAutoSettings {
  /**
   * چک‌باکس «ارسال خودکار یادآوری».
   *
   * ⚠️ این **یک** تنظیم است، نه دو تا: همان چیزی که در ماژول اعتبار خرید
   * دیده می‌شود و همان که در پنل پیامکی. خاموش بودنش فقط ارسال *خودکار* را
   * می‌خواباند؛ دکمه‌ی «همین حالا بفرست» همیشه کار می‌کند.
   */
  enabled: boolean
  /** ساعت اجرای خودکار (۰ تا ۲۳) — به وقت محلی همان دستگاه */
  hour: number
  /** دقیقه‌ی اجرا (۰ تا ۵۹) */
  minute: number
  /** وقتی خاموش است، پنل نمی‌پرسد «الان بفرستم یا سر ساعت؟» */
  askOnEnable: boolean
}

export const SMS_AUTO_SCHEDULE_HOURS = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 21] as const

export const DEFAULT_SMS_AUTO: SmsAutoSettings = {
  enabled: false,
  hour: 10,
  minute: 0,
  askOnEnable: true
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

/** پارسِ تاب‌آور تنظیمات خودکار (ورودی خراب ⇒ پیش‌فرض، نه خطا). */
export function parseSmsAuto(raw: unknown): SmsAutoSettings {
  let obj: any = raw
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw)
    } catch {
      obj = null
    }
  }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_SMS_AUTO }
  return {
    enabled: obj.enabled === true,
    hour: clampInt(obj.hour, 0, 23, DEFAULT_SMS_AUTO.hour),
    minute: clampInt(obj.minute, 0, 59, DEFAULT_SMS_AUTO.minute),
    askOnEnable: obj.askOnEnable !== false
  }
}

/** `۱۴۰۵/۰۷/۱۵` یا `Date` ⇒ کلید روز برای «امروز اجرا شده؟» */
export function smsAutoDayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** آیا الان وقت اجرای خودکار است؟ (پنجره‌ی ۵ دقیقه‌ای تا دیرکردِ جزئی هم بگیرد) */
export const SMS_AUTO_CATCHUP_MINUTES = 180

/**
 * آیا وقت اجرای زمان‌بند رسیده است؟
 *
 * ⏱ **جبران عقب‌افتادگی**: قبلاً فقط پنجره‌ی ۵ دقیقه‌ای خودِ ساعت قبول بود؛
 * یعنی اگر برنامه سر آن ساعت باز نبود (POS ساعت ۱۰:۱۰ روشن می‌شود و یادآوری
 * برای ۱۰:۰۰ تنظیم شده) یا یک دور با خطای دیتابیس رد می‌شد، **کل آن روز**
 * یادآوری‌ها گم می‌شدند — با اینکه متنی که به کاربر نشان داده می‌شد
 * «چند دقیقه دیگر دوباره تلاش می‌شود» بود.
 *
 * حالا هر لحظه بعد از ساعتِ مقرر تا سقف `SMS_AUTO_CATCHUP_MINUTES` مجاز است؛
 * «یک بار در روز» را همان کلید `sms.auto.lastRun` تضمین می‌کند، پس این تغییر
 * پیام تکراری نمی‌سازد. سقف سه‌ساعته جلوی پیام ساعت ۲۲ برای یادآوری ۱۰ صبح
 * را می‌گیرد.
 */
export function isSmsAutoDue(
  settings: SmsAutoSettings,
  now: Date,
  minutesWindow = 5,
  catchupMinutes = SMS_AUTO_CATCHUP_MINUTES
): boolean {
  if (!settings.enabled) return false
  const target = settings.hour * 60 + settings.minute
  const cur = now.getHours() * 60 + now.getMinutes()
  const window = Math.max(1, minutesWindow, Math.max(0, catchupMinutes))
  return cur >= target && cur < target + window
}

/**
 * متنی که انتهای پیام‌های تبلیغاتی می‌آید. پیش‌فرض «لغو ۱۱» است چون در ایران
 * درج آن برای پیامک‌های تبلیغاتی/اطلاع‌رسانی الزامی است — ولی مقدارش تنظیم‌شدنی
 * است تا اگر مقررات عوض شد، کد عوض نشود.
 */
export const DEFAULT_SMS_OPT_OUT_NOTE = 'لغو ۱۱'

/**
 * کاربرد هر خط/سرویس‌دهنده.
 *
 * قاعده‌ی مقرراتی ایران: پیام **تبلیغاتی** باید از خط تبلیغاتی برود و پیام
 * **خدماتی/تراکنشی** (تشکر از خرید، یادآوری اعتبار) از خط خدماتی. اگر هر دو
 * را از یک خط بفرستید، خط تبلیغاتی برای پیام خدماتی جریمه/بلاک می‌شود و خط
 * خدماتی هم اجازه‌ی متن تبلیغاتی ندارد.
 *
 * `BOTH` یعنی «یکی برای همه» — همان رفتار قبل از افزودن این گزینه، برای کسی
 * که فقط یک خط دارد.
 */
export const SMS_LINE_PURPOSES = {
  SERVICE: 'SERVICE',
  ADS: 'ADS',
  BOTH: 'BOTH'
} as const
export type SmsLinePurpose = (typeof SMS_LINE_PURPOSES)[keyof typeof SMS_LINE_PURPOSES]

export const SMS_LINE_PURPOSE_LABELS: Record<string, string> = {
  SERVICE: 'خدماتی/تراکنشی',
  ADS: 'تبلیغاتی',
  BOTH: 'هر دو کاره (یک خط)'
}

export function normalizeSmsLinePurpose(raw: unknown): SmsLinePurpose {
  const v = String(raw ?? '').trim().toUpperCase()
  if (v === 'SERVICE' || v === 'TRANSACTIONAL' || v === 'خدماتی') return SMS_LINE_PURPOSES.SERVICE
  if (v === 'ADS' || v === 'ADVERTISING' || v === 'CAMPAIGN' || v === 'تبلیغاتی') return SMS_LINE_PURPOSES.ADS
  return SMS_LINE_PURPOSES.BOTH
}

/** این پیام از چه نوع خطی باید برود؟ */
export function smsLinePurposeForEvent(eventType: unknown): 'SERVICE' | 'ADS' {
  return smsNeedsOptOutNote(eventType) ? 'ADS' : 'SERVICE'
}

/** آیا این خط، این نوع پیام را می‌تواند بفرستد؟ */
export function smsLineMatchesPurpose(purpose: unknown, wanted: 'SERVICE' | 'ADS'): boolean {
  const p = normalizeSmsLinePurpose(purpose)
  return p === SMS_LINE_PURPOSES.BOTH || p === wanted
}

/**
 * انتخاب خط از میان خط‌های **فعال**: اول تطابق دقیق، بعد خط «هر دو کاره».
 *
 * ⚠️ اگر هیچ‌کدام نبود، `null` برمی‌گردد و پیام **در صف می‌ماند** — عمدی:
 * فرستادن پیام خدماتی از خط تبلیغاتی (یا برعکس) هم مقرراتی نیست و هم باعث
 * بلاک‌شدن خط کاربر می‌شود. «در صف بماند» بهتر از «بد بفرستد» است.
 */
export function pickSmsLine<T extends { id: number; purpose?: unknown }>(
  lines: readonly T[],
  wanted: 'SERVICE' | 'ADS'
): T | null {
  const list = Array.isArray(lines) ? lines : []
  const exact = list.find((l) => normalizeSmsLinePurpose(l?.purpose) === wanted)
  if (exact) return exact
  const both = list.find((l) => normalizeSmsLinePurpose(l?.purpose) === SMS_LINE_PURPOSES.BOTH)
  return both ?? null
}

/** فقط این رویدادها «تبلیغاتی» حساب می‌شوند و جمله‌ی لغو می‌گیرند. */
export function smsNeedsOptOutNote(eventType: unknown): boolean {
  return String(eventType ?? '') === SmsEventType.CAMPAIGN
}

/**
 * ===========================================================================
 * 🚫 گارد «برگرداندن دستی یادآوری اعتبار» — باگ اول بازبینی چهارم.
 *
 * برای یادآوریِ اعتبار، `CANCELED` و `FAILED_FINAL` یعنی «سهمیه‌ی یادآوری آزاد
 * شد» (هوک `setSmsOutcomeHook` در بوت همین کار را می‌کند). اگر کسی همان ردیف را
 * از پنل پیامک «به صف برگرداند» یا «تلاش مجدد» بزند، پیام می‌رود ولی سهمیه
 * دیگر مصرف نمی‌شود؛ نتیجه: فردا زمان‌بند همان یادآوری را **دوباره** می‌فرستد و
 * مشتری دو پیام می‌گیرد (و `reminderCount` با واقعیت نمی‌خواند).
 *
 * مسیر درست: دکمه‌ی «یادآوری» در پنل اعتبار — همان مسیر سهمیه را مصرف می‌کند و
 * اگر ردیف لغوشده مال همین امروز باشد، دقیقاً همان را به صف برمی‌گرداند.
 *
 * ⚠️ `UNKNOWN` عمداً آزاد است: در آن حالت هیچ سهمیه‌ای آزاد نشده و تصمیم با
 * آدم است (راهنمای «ممکن است رسیده باشد» در پنل).
 * ===========================================================================
 */
export function smsReminderManualResendBlocked(eventType: unknown, status: unknown): boolean {
  if (String(eventType ?? '') !== SmsEventType.CREDIT_REMINDER) return false
  const s = String(status ?? '')
  return s === SmsOutboxStatus.CANCELED || s === SmsOutboxStatus.FAILED_FINAL
}

/**
 * وضعیت‌هایی که «تکراری» شمرده می‌شوند وقتی کاربر همان پیام را همان لحظه
 * دوباره ثبت می‌کند (`SMS_MANUAL_DEDUPE_WINDOW_MS`).
 *
 * 🔴 چرا `CANCELED` و `FAILED_FINAL` اینجا **نیستند**: اگر ردیف لغو‌شده
 * «تکراری» حساب شود، کاربر پیام «ثبت شد» می‌بیند ولی هیچ پیامی هرگز نمی‌رود
 * (باگ سوم بازبینی). آن ردیف‌ها پیام‌های زنده نیستند؛ ثبت تازه باید یک پیام
 * تازه بسازد. `SKIPPED` هم همین‌طور (شماره‌ی لغوکرده/شماره‌ی نامعتبر).
 */
export const SMS_DUPLICATE_GUARD_STATUSES: readonly string[] = [
  SmsOutboxStatus.PENDING,
  SmsOutboxStatus.PROCESSING,
  SmsOutboxStatus.FAILED_RETRYABLE,
  SmsOutboxStatus.SENT,
  SmsOutboxStatus.UNKNOWN
]

/**
 * آیا متن از قبل جمله‌ی لغو را دارد؟ مقایسه «شامل‌بودن» است نه برابری، چون
 * کاربر می‌تواند جمله را وسط متن هم بنویسد.
 */
export function smsHasOptOutNote(body: unknown, note: unknown): boolean {
  const n = String(note ?? '').trim()
  if (!n) return true
  return String(body ?? '').includes(n)
}

/**
 * متن نهایی پیام تبلیغاتی = متن کاربر + جمله‌ی لغو (اگر از قبل نباشد).
 *
 * چرا اینجا و نه فقط در UI: شرط مقرراتی است. اگر فقط دکمه‌ی UI آن را اضافه
 * می‌کرد، هر مسیر دیگری (ایمپورت، اسکریپت، کمپین قدیمی) می‌توانست پیام
 * تبلیغاتی بدون جمله‌ی لغو بسازد.
 */
export function smsWithOptOutNote(body: unknown, note: unknown): string {
  const text = String(body ?? '').replace(/\s+$/g, '')
  const n = String(note ?? '').trim()
  if (!n || smsHasOptOutNote(text, n)) return text
  return text ? `${text}\n${n}` : n
}

/**
 * پارس فهرست شماره‌های چسبانده‌شده.
 *
 * ورودی واقعی کاربر همیشه تمیز نیست: با کاما، نقطه‌ویرگول، خط تازه، تب،
 * شماره‌ی فارسی و تکراری. این‌جا فقط *مرز* مشخص می‌شود و هیچ شماره‌ای حدس
 * زده نمی‌شود: هر توکن یا موبایل معتبر است یا در فهرست «نامعتبر» می‌افتد.
 */
export function parseSmsPhoneList(raw: unknown): {
  valid: string[]
  invalid: string[]
  duplicates: number
} {
  const tokens = toLatinDigits(String(raw ?? ''))
    .split(/[\s,;؛،|/\\]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)

  const valid: string[] = []
  const invalid: string[] = []
  const seen = new Set<string>()
  let duplicates = 0

  for (const t of tokens) {
    const phone = normalizeSmsPhone(t)
    if (!phone) {
      invalid.push(t)
      continue
    }
    if (seen.has(phone)) {
      duplicates++
      continue
    }
    seen.add(phone)
    valid.push(phone)
  }
  return { valid, invalid, duplicates }
}

/** منبع مخاطبان کمپین — برای نمایش و سابقه. */
export const SMS_AUDIENCE_SOURCES = {
  BANK: 'BANK',
  PASTE: 'PASTE',
  MIXED: 'MIXED'
} as const

export const SMS_AUDIENCE_LABELS: Record<string, string> = {
  BANK: 'دفترچه‌ی شماره‌های برنامه',
  PASTE: 'فهرست چسبانده‌شده',
  MIXED: 'دفترچه + فهرست'
}

/**
 * اولویت کمپین تبلیغاتی = ۷ (کم‌ترین). پیام تراکنشی (۳) و تشکر (۴) همیشه از
 * جلوی کمپین می‌پرند — «فاکتور مشتری نباید پشت ۱۰۰۰ پیام تبلیغاتی بماند».
 */
/**
 * ⏱ پنجره‌ی «دو بار کلیک ⇒ یک پیام» برای ارسال دستی.
 *
 * چرا عدد و چرا این‌قدر کوتاه: کاربر ممکن است عمداً همین متن را برای همین شماره
 * **بعداً** دوباره بفرستد (یادآوری تلفنی)، پس نمی‌شود کلید را برای همیشه یکتا
 * کرد. ولی دو کلیک پشت‌سرهم (یا دوباره فرستادن همان درخواست IPC) باید یک پیام
 * بسازد. ۹۰ ثانیه هم دوبار کلیک را می‌گیرد، هم مزاحم ارسال مجدد واقعی نمی‌شود.
 */
export const SMS_MANUAL_DEDUPE_WINDOW_MS = 90_000

export const SMS_CAMPAIGN_PRIORITY = 7

