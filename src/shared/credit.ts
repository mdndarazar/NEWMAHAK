/**
 * ===========================================================================
 * «مدیریت اعتبار خرید» — منطق خالص و مشترک (بدون دیتابیس، بدون Electron).
 *
 * چرا اینجا (shared) و نه داخل سرویس؟ چون دقیقاً همان قاعده‌هایی که Backend با
 * آن‌ها *تصمیم* می‌گیرد، باید در UI هم *نمایش* داده شوند (مثلاً «این اعتبار روی
 * کدام اقلام سبد قابل استفاده است؟»). اگر این منطق دو جا نوشته می‌شد، همان
 * کلاسیک‌ترین باگ ضدتقلب پیش می‌آمد: UI چیزی نشان بدهد که Backend قبولش ندارد،
 * یا بدتر — Backend چیزی را قبول کند که UI محدودش کرده بود.
 *
 * ⚠️ قاعده‌ی سختِ این فایل: هیچ تابعی اینجا چیزی را *تغییر* نمی‌دهد. همه‌چیز
 * ورودی می‌گیرد و تصمیم برمی‌گرداند. تنها مرجع اعمالِ تصمیم،
 * `src/main/services/StoreCreditService.ts` است (§۲۱ سند مرجع: «هیچ قانون
 * امنیتی نباید فقط به UI متکی باشد»). پس این فایل «منبع قاعده» است، نه
 * «نگهبان». نگهبان همیشه main است.
 *
 * تصمیم معماری (§۱ سند مرجع): اینجا هیچ مدل/جدول موازی‌ای تعریف نمی‌شود. همه‌ی
 * تایپ‌ها روی همان `StoreCredit` موجود کار می‌کنند و فیلدهای تازه همه
 * Nullable/Default‌دار هستند، پس رکوردهای قدیمی «اعتبار تعویض کالا» مو‌به‌مو
 * مثل قبل کار می‌کنند: `source = 'EXCHANGE'`، `maxUses = 1`، `multiUse = false`.
 * ===========================================================================
 */

import { toNumberRial } from './money'

// ---------------------------------------------------------------------------
// ۱) نوع اعتبار (§۲ سند مرجع)
// ---------------------------------------------------------------------------

/**
 * منبع صدور اعتبار.
 *
 * `EXCHANGE` = مسیر فعلی و دست‌نخورده‌ی «تعویض کالا» (پیش‌فرض ستون، پس هر رکورد
 * قدیمی خودکار همین است). `MANUAL` = اعتباری که مدیر مستقیم صادر کرده است.
 *
 * ⚠️ این یک «نوع رکورد» است، نه یک مدل جدا. کل تفاوت رفتاری‌شان در
 * `CreditTypeRules` (مدت اعتبار و دفعات مصرف پیش‌فرض) خلاصه می‌شود.
 */
/**
 * نشست ۶۱ (DECISIONS S61-1) — `OVERPAY` = اعتباری که از «مبلغ اضافه‌ی دریافتی»
 * یک پرداخت واقعی صادر شده (بند ۴-۳۵ مراحل ۲ و ۳، بند ۴-۵۵). پشتوانه‌اش پول
 * واقعاً دریافت‌شده است (بند ۴-۳۷)، پس نه «مدیریتی بدون فاکتور» است و نه «تعویض».
 */
export const CreditSource = { EXCHANGE: 'EXCHANGE', MANUAL: 'MANUAL', OVERPAY: 'OVERPAY' } as const
export type CreditSource = (typeof CreditSource)[keyof typeof CreditSource]

export const CREDIT_SOURCE_LABELS: Record<string, string> = {
  EXCHANGE: 'ناشی از تعویض کالا',
  MANUAL: 'صادرشده توسط مدیریت',
  OVERPAY: 'ناشی از اضافه‌دریافت (مبلغ بیشتر از بدهی)'
}

/**
 * برچسب «قاعده» با برچسب منشأ یکسان نیست: source ذخیره‌شده‌ی EXCHANGE برای
 * برگشت با اعتبار هم به‌دلایل سازگاری استفاده می‌شود. این نگاشت فقط در فرم
 * تنظیمات است و هیچ source یا دادهٔ تاریخی را تغییر نمی‌دهد.
 */
export const CREDIT_RULE_LABELS: Record<string, string> = {
  EXCHANGE: 'برگشت فروش / تعویض کالا / اضافه‌دریافت',
  MANUAL: 'صدور دستی / مدیریتی'
}

/** ورودی ناشناس ⇒ یک نوع معتبر. پیش‌فرض عمداً `EXCHANGE` است (سازگاری قدیم). */
export function normalizeCreditSource(raw: unknown): CreditSource {
  const k = String(raw ?? '').trim().toUpperCase()
  if (k === CreditSource.MANUAL) return CreditSource.MANUAL
  if (k === CreditSource.OVERPAY) return CreditSource.OVERPAY
  return CreditSource.EXCHANGE
}

/**
 * نشست ۱۸۷ — علت صدور یک بارکد، برای جملهٔ خط کنترل صندوق.
 * `source=EXCHANGE` برای برگشت ساده هم پیش‌فرض تاریخی است؛ پس returnId /
 * exchangeInvoiceId بر برچسب «تعویض» اولویت دارند.
 */
export type CreditIssueReason = 'RETURN' | 'EXCHANGE' | 'OVERPAY' | 'MANUAL' | 'OTHER'

export const CREDIT_ISSUE_REASON_LABELS: Record<CreditIssueReason, string> = {
  RETURN: 'برگشت از فروش',
  EXCHANGE: 'تعویض کالا',
  OVERPAY: 'اضافه‌دریافت',
  MANUAL: 'صدور مدیریتی',
  OTHER: 'صدور اعتبار'
}

export function creditIssueReasonOf(c: {
  exchangeInvoiceId?: number | null
  returnId?: number | null
  source?: string | null
} = {}): CreditIssueReason {
  if (c.exchangeInvoiceId != null) return 'EXCHANGE'
  if (c.returnId != null) return 'RETURN'
  const s = String(c.source ?? '').toUpperCase()
  if (s === 'OVERPAY') return 'OVERPAY'
  if (s === 'MANUAL') return 'MANUAL'
  return 'OTHER'
}

// ---------------------------------------------------------------------------
// ۲) کد اعتبار: الفبا، ظرفیت، یکتایی (§۶ سند مرجع)
// ---------------------------------------------------------------------------

/** الفبای کامل حروف بزرگ (بدون هیچ حذفی). */
const LETTERS_ALL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
/** الفبای کامل ارقام. */
const DIGITS_ALL = '0123456789'

/**
 * کاراکترهای «مشابه» که با هم اشتباه گرفته می‌شوند (§۶).
 * وقتی گزینه‌ی «حذف کاراکترهای مشابه» روشن باشد، این‌ها از الفبای *تولید* حذف
 * می‌شوند — نه از اعتبارسنجی. یعنی اگر کد قدیمی‌ای حرف O داشته باشد، هنوز
 * خوانده و مصرف می‌شود؛ فقط کد *جدید* دیگر O نمی‌گیرد.
 */
export const SIMILAR_CHARS = 'O0I1S5' as const

export const CreditCodeAlphabet = { ALNUM: 'ALNUM', ALPHA: 'ALPHA', NUM: 'NUM' } as const
export type CreditCodeAlphabet = (typeof CreditCodeAlphabet)[keyof typeof CreditCodeAlphabet]

export const CREDIT_ALPHABET_LABELS: Record<string, string> = {
  ALNUM: 'حروف بزرگ و عدد (A-Z و ۰-۹)',
  ALPHA: 'فقط حروف بزرگ (A-Z)',
  NUM: 'فقط عدد (۰-۹)'
}

export const MIN_CREDIT_CODE_LENGTH = 6
export const MAX_CREDIT_CODE_LENGTH = 20

/** الفبای *مؤثر* تولید کد، با احتساب گزینه‌ی حذف کاراکترهای مشابه. */
export function creditAlphabet(kind: string, excludeSimilar: boolean): string {
  const base =
    kind === CreditCodeAlphabet.ALPHA
      ? LETTERS_ALL
      : kind === CreditCodeAlphabet.NUM
        ? DIGITS_ALL
        : LETTERS_ALL + DIGITS_ALL
  if (!excludeSimilar) return base
  const drop = new Set(SIMILAR_CHARS.split(''))
  const out = base
    .split('')
    .filter((c) => !drop.has(c))
    .join('')
  // محافظت از خودمان: الفبای تک‌کاراکتری یعنی «هر کدی یکسان است»
  return out.length >= 2 ? out : base
}

/**
 * تعداد کدهای *ممکن* برای یک طول و یک الفبا.
 * با طول‌های بزرگ عدد از محدوده‌ی امن جاوااسکریپت رد می‌شود، پس سقف‌گذاری
 * می‌کنیم — هدف این محاسبه «آیا فضا کافی است؟» است، نه شمارش دقیق ستاره‌ها.
 */
export function codeCapacity(bodyLength: number, alphabetSize: number): number {
  const len = Math.max(0, Math.round(bodyLength))
  const size = Math.max(1, Math.round(alphabetSize))
  let out = 1
  for (let i = 0; i < len; i++) {
    out *= size
    if (out > Number.MAX_SAFE_INTEGER) return Number.MAX_SAFE_INTEGER
  }
  return out
}

export interface CodeSpaceRequest {
  /** چند کد لازم است (تولید گروهی = تعداد درخواستی · صدور تکی = ۱) */
  count: number
  /** طول کل کد (شامل پیشوندِ حرفیِ ثابت، اگر باشد) */
  length: number
  /** طول پیشوند ثابت (پیشوند فضای تصادفی را کم می‌کند) */
  prefixLength?: number
  alphabetSize: number
  /** چند کد با همین طول از قبل در دیتابیس هست */
  existing: number
  /**
   * ضریب ایمنی: فضای آزاد باید حداقل `count * ratio` باشد.
   * چرا؟ چون تولید تصادفی در فضای تقریباً پر، به «تصادم پشت تصادم» می‌افتد
   * (پارادوکس تولد). پیش‌فرض ۲۰ یعنی «حداکثر ۵٪ فضا پر شود».
   */
  ratio?: number
  /** گزینه‌ی «افزایش خودکار طول در صورت کمبود» روشن است؟ */
  autoGrow?: boolean
  maxLength?: number
}

export interface CodeSpaceAssessment {
  ok: boolean
  /** طولی که واقعاً باید استفاده شود (با autoGrow ممکن است بزرگ‌تر از درخواست باشد) */
  length: number
  /** طول درخواستیِ اولیه */
  requestedLength: number
  /** طول کد رشد کرد؟ (باید در UI و در لاگ دیده شود — §۶) */
  grown: boolean
  capacity: number
  free: number
  needed: number
  /** پیام فارسیِ آماده (خطا اگر ok=false، توضیح اگر رشد کرده باشد) */
  message: string | null
}

/**
 * «آیا فضای کدها برای این تعداد کافی است؟» — *قبل از* شروع عملیات (§۶).
 *
 * سه رفتار ممکن، هر سه صریح و قابل‌مشاهده:
 *   ۱) فضا کافی است ⇒ ok با همان طول درخواستی.
 *   ۲) فضا کافی نیست و «افزایش خودکار طول» روشن است ⇒ طول تا جایی بالا می‌رود
 *      که فضا کافی شود، و `grown` روشن برمی‌گردد تا هم در UI دیده شود و هم در
 *      AuditLog بنشیند (نه یک تغییر بی‌صدا).
 *   ۳) فضا کافی نیست و رشد خودکار خاموش است ⇒ ok=false با پیام فارسی که تعداد
 *      کدهای ممکن را می‌گوید و افزایش طول را پیشنهاد می‌دهد.
 *
 * هیچ‌وقت «silently fail» یا «overwrite» رخ نمی‌دهد: صدازننده موظف است روی
 * ok=false عملیات را متوقف کند.
 */
export function assessCodeSpace(req: CodeSpaceRequest): CodeSpaceAssessment {
  const needed = Math.max(1, Math.round(req.count) || 1)
  const ratio = Math.max(1, Math.round(req.ratio ?? 20))
  const maxLength = Math.min(MAX_CREDIT_CODE_LENGTH, Math.max(MIN_CREDIT_CODE_LENGTH, Math.round(req.maxLength ?? MAX_CREDIT_CODE_LENGTH)))
  const prefixLength = Math.max(0, Math.round(req.prefixLength ?? 0))
  const requestedLength = Math.min(maxLength, Math.max(MIN_CREDIT_CODE_LENGTH, Math.round(req.length) || MIN_CREDIT_CODE_LENGTH))
  const existing = Math.max(0, Math.round(req.existing) || 0)

  let length = requestedLength
  for (;;) {
    const capacity = codeCapacity(Math.max(1, length - prefixLength), req.alphabetSize)
    const free = Math.max(0, capacity - existing)
    const enough = free >= needed * ratio
    if (enough) {
      return {
        ok: true,
        length,
        requestedLength,
        grown: length > requestedLength,
        capacity,
        free,
        needed,
        message:
          length > requestedLength
            ? `طول کد از ${requestedLength} به ${length} کاراکتر افزایش یافت، چون با طول قبلی فضای کدهای یکتا برای ${needed} اعتبار کافی نبود (گزینه‌ی «افزایش خودکار طول» روشن است).`
            : null
      }
    }
    if (!req.autoGrow || length >= maxLength) {
      return {
        ok: false,
        length,
        requestedLength,
        grown: false,
        capacity,
        free,
        needed,
        message:
          `فضای کدهای ممکن برای این عملیات کافی نیست، پس عملیات انجام نشد.\n` +
          `با طول ${length} کاراکتر و این مجموعه‌ی کاراکتر، فقط ${capacity} کد ممکن است و ${existing} کد از قبل ساخته شده؛ ` +
          `یعنی حدود ${free} کد آزاد مانده در برابر ${needed} کد درخواستی.\n` +
          `راه‌حل: طول کد را در «تنظیمات اعتبار خرید» بیشتر کنید (یا گزینه‌ی «افزایش خودکار طول در صورت کمبود» را روشن کنید)، ` +
          `یا تعداد درخواستی را کم کنید.`
      }
    }
    length++
  }
}

/**
 * نرمال‌سازی کد اعتبار (ورودی دستی یا بارکدخوان).
 *
 * عیناً همان قاعده‌ی `normalizeReturnCode` کدِ فاکتور است (حروف بزرگ، فقط
 * A-Z0-9) تا رفتار اسکنر در هر دو یکی باشد؛ اینجا تکرار شده چون این فایل
 * shared است و باید در renderer هم قابل استفاده باشد.
 */
export function normalizeCreditCode(input: unknown): string {
  return String(input ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\u06F0-\u06F9]/g, (d) => String('\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'.indexOf(d)))
    .replace(/[\u0660-\u0669]/g, (d) => String('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'.indexOf(d)))
    .replace(/[^A-Z0-9]/g, '')
}

/**
 * پیشوند نمایشی (`CR-` / `EX-`) هیچ نقش امنیتی ندارد (§۲۲) — فقط برای این است
 * که کارمند با یک نگاه بفهمد این کاغذ «اعتبار مدیریتی» است یا «اعتبار تعویض».
 * پس فقط حروف/ارقام مجاز است و در بارکد هم همان کد کامل می‌نشیند.
 */
export function normalizeCreditPrefix(raw: unknown, fallback = ''): string {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4)
  return s || fallback
}

// ---------------------------------------------------------------------------
// ۳) وضعیت‌ها و Status Machine (§۱۱ سند مرجع)
// ---------------------------------------------------------------------------

/**
 * وضعیت‌های اعتبار.
 *
 * ⚠️ تصمیم معماری مهم (و آگاهانه): سند مرجع اسم‌های
 * `FULLY_USED` / `VOIDED` را پیشنهاد داده بود، ولی دو مقدار `USED` و `CANCELED`
 * از قبل در دیتابیسِ فروشگاه، در گزارش‌ها، در `STORE_CREDIT_STATUS_LABELS` و در
 * چند سرویس دیگر (SalesService، accountingReport، CashboxService) استفاده
 * می‌شوند. عوض کردن نامشان یعنی مهاجرت داده + ریسک شکستن کد سالم، بدون هیچ
 * سود عملی.
 *
 * پس: `FULLY_USED` **همان** `USED` است و `VOIDED` **همان** `CANCELED`
 * (alias صریح، نه یک مقدار جدید). دو وضعیت واقعاً تازه اضافه شده‌اند:
 * `PARTIALLY_USED` (مصرف بخشی — §۴) و `SUSPENDED` (معلق — §۱۱)، به‌علاوه‌ی
 * `DRAFT` برای اعتبار ساخته‌شده‌ی چاپ‌نشده. دلیل این تصمیم در HANDOFF هم نوشته
 * شده است.
 */
export const CreditStatus = {
  DRAFT: 'DRAFT',
  ACTIVE: 'ACTIVE',
  PARTIALLY_USED: 'PARTIALLY_USED',
  /** = FULLY_USED سند مرجع (نام تاریخی ستون، دست‌نخورده) */
  USED: 'USED',
  EXPIRED: 'EXPIRED',
  /** = VOIDED سند مرجع (نام تاریخی ستون، دست‌نخورده) */
  CANCELED: 'CANCELED',
  SUSPENDED: 'SUSPENDED'
} as const
export type CreditStatus = (typeof CreditStatus)[keyof typeof CreditStatus]

/** نام‌های سند مرجع، برای خوانایی کد جدید. مقدارشان عیناً همان بالاست. */
export const CREDIT_STATUS_ALIASES = {
  FULLY_USED: CreditStatus.USED,
  VOIDED: CreditStatus.CANCELED
} as const

export const CREDIT_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'پیش‌نویس (صادر نشده)',
  ACTIVE: 'مصرف‌نشده (معتبر)',
  PARTIALLY_USED: 'مصرف بخشی (باقی‌مانده دارد)',
  USED: 'مصرف شد',
  EXPIRED: 'منقضی شد',
  CANCELED: 'باطل شد',
  SUSPENDED: 'معلق (موقتاً غیرفعال)'
}

/** وضعیت‌هایی که *اجازه‌ی مصرف* می‌دهند (بقیه در هیچ شرایطی مصرف نمی‌شوند). */
export const REDEEMABLE_STATUSES: readonly string[] = [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED]

/**
 * Transition های مجاز.
 *
 * هیچ کاربری وضعیت را «انتخاب» نمی‌کند؛ هر تغییر وضعیت نتیجه‌ی یک *عملیات* است
 * (مصرف، ابطال، تعلیق، فعال‌سازی، انقضا) و `assertCreditTransition` جلوی هر
 * مسیر غیرمجاز را می‌گیرد — مثلاً «باطل ⇒ مصرف‌شده» یا «مصرف‌شده ⇒ فعال».
 */
export const CREDIT_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: [CreditStatus.ACTIVE, CreditStatus.CANCELED],
  ACTIVE: [
    CreditStatus.PARTIALLY_USED,
    CreditStatus.USED,
    CreditStatus.EXPIRED,
    CreditStatus.CANCELED,
    CreditStatus.SUSPENDED
  ],
  PARTIALLY_USED: [CreditStatus.USED, CreditStatus.EXPIRED, CreditStatus.CANCELED, CreditStatus.SUSPENDED],
  /** اعتبارِ مصرف‌شده فقط با ابطال (سند اشتباه) از این وضعیت خارج می‌شود */
  USED: [CreditStatus.CANCELED],
  /** منقضی ⇒ مدیر می‌تواند آگاهانه تمدید/فعال کند یا باطلش کند */
  EXPIRED: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.CANCELED],
  /** باطل، وضعیت پایانی است — «ابطال یعنی تغییر وضعیت، نه حذف» (§۱۱) */
  CANCELED: [],
  /** معلق ⇒ فقط برگشت به وضعیت قبلی یا ابطال */
  SUSPENDED: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.CANCELED, CreditStatus.EXPIRED]
}

/**
 * وضعیت‌های **پایانی**: از این‌ها هیچ خروجی‌ای نیست، حتی «به خودشان».
 *
 * جلسه ۳۵ · باگ واقعی که هارنس دیتابیس پیدا کرد: `canCreditTransition` با
 * `from === to ⇒ true` شروع می‌شد، پس `CANCELED ⇒ CANCELED` مجاز بود و
 * `voidCredit` روی یک اعتبارِ **از قبل باطل‌شده** دوباره اجرا می‌شد:
 * `voidedAt`/`voidedReason` رونویسی می‌شد (دلیل اصلی ابطال از روی رکورد پاک
 * می‌شد) و یک سند ابطال تازه هم در AuditLog می‌نشست. این دقیقاً خلاف §۱۱
 * («باطل، وضعیت پایانی است») و خلاف جدول `CREDIT_TRANSITIONS` است که برای
 * `CANCELED` آرایه‌ی خالی گذاشته بود.
 *
 * چرا خودِ `from === to` کلاً حذف نشد: مصرفِ *چندباره* عمداً
 * `PARTIALLY_USED ⇒ PARTIALLY_USED` می‌سازد و باید مجاز بماند.
 */
export const TERMINAL_CREDIT_STATUSES: readonly string[] = [CreditStatus.CANCELED]

export function isTerminalCreditStatus(status: string): boolean {
  return TERMINAL_CREDIT_STATUSES.includes(String(status))
}

export function canCreditTransition(from: string, to: string): boolean {
  if (from === to) return !isTerminalCreditStatus(from)
  return (CREDIT_TRANSITIONS[String(from)] ?? []).includes(String(to))
}

/** پیام فارسیِ یک Transition غیرمجاز (برای BusinessError سمت main). */
export function transitionError(from: string, to: string): string {
  return (
    `تغییر وضعیت این اعتبار از «${CREDIT_STATUS_LABELS[from] ?? from}» به «${CREDIT_STATUS_LABELS[to] ?? to}» مجاز نیست.\n` +
    'وضعیت اعتبار فقط نتیجه‌ی عملیات‌های مجاز (مصرف، ابطال، تعلیق، فعال‌سازی) است و مستقیم قابل انتخاب نیست.'
  )
}

// ---------------------------------------------------------------------------
// ۴) دفعات مصرف و مصرف بخشی (§۴ سند مرجع)
// ---------------------------------------------------------------------------

/**
 * حداقل چیزی که برای «آیا قابل مصرف است؟» لازم است.
 * عمداً یک ساختار تخت است تا هم رکورد Prisma و هم ردیف UI بتوانند نقشش را
 * بازی کنند (ساختاری typing).
 */
export interface CreditCore {
  /** نشست ۱۸۴ — باقی‌مانده روی همین بارکد بماند؟ (نبودنش = بله، رفتار پیش‌فرض) */
  carryRemainder?: boolean | null
  id?: number
  code?: string
  /** مبلغ *اولیه*ی اعتبار (ستون amount — هیچ‌وقت با مصرف کم نمی‌شود) */
  amount: number
  /** جمع مبلغ مصرف‌شده تا این لحظه */
  usedAmount?: number | null
  /** چند بار مصرف شده */
  usedCount?: number | null
  /** حداکثر دفعات مجاز (۱ = یک‌بارمصرف) */
  maxUses?: number | null
  /** «چندباره تا سقف مبلغ» فعال است؟ (§۴ — منطق کاملاً جدا از یک‌بارمصرف) */
  multiUse?: boolean | null
  status: string
  expiresAt?: Date | string | null
  source?: string | null
  customerId?: number | null
  /** ALL | CATEGORY | VARIANTS */
  restrictScope?: string | null
  restrictCategoryIdsJson?: string | null
  restrictVariantIdsJson?: string | null
  minPurchase?: number | null
  maxPerTransaction?: number | null
  customerLocked?: boolean | null
}

/** مبلغ باقی‌مانده‌ی یک اعتبار (هیچ‌وقت منفی نمی‌شود). */
export function remainingOf(c: CreditCore): number {
  const amount = Math.max(0, toNumberRial(c.amount ?? 0))
  const used = Math.max(0, toNumberRial(c.usedAmount ?? 0))
  return Math.max(0, amount - used)
}

/** دفعات باقی‌مانده‌ی مصرف. */
export function usesLeftOf(c: CreditCore): number {
  const max = Math.max(1, Math.round(Number(c.maxUses ?? 1) || 1))
  const used = Math.max(0, Math.round(Number(c.usedCount ?? 0) || 0))
  return Math.max(0, max - used)
}

/** اعتبار منقضی شده است؟ (مستقل از ستون وضعیت — ستون ممکن است عقب باشد) */
export function isExpiredAt(c: CreditCore, now: Date | number = Date.now()): boolean {
  if (!c.expiresAt) return false
  const t = c.expiresAt instanceof Date ? c.expiresAt.getTime() : new Date(c.expiresAt).getTime()
  if (!Number.isFinite(t)) return false
  const ref = now instanceof Date ? now.getTime() : now
  return t <= ref
}

/**
 * وضعیت *مؤثر* یک اعتبار برای نمایش: اگر تاریخش گذشته باشد «منقضی» است، حتی
 * اگر ستون وضعیت هنوز ACTIVE باشد. (همان رفتار `shapeStoreCredit` قبلی، ولی
 * حالا حالت مصرف بخشی را هم می‌فهمد.)
 */
export function effectiveStatus(c: CreditCore, now: Date | number = Date.now()): string {
  const raw = String(c.status ?? CreditStatus.ACTIVE)
  if (raw === CreditStatus.CANCELED || raw === CreditStatus.USED || raw === CreditStatus.SUSPENDED) return raw
  if (isExpiredAt(c, now)) return CreditStatus.EXPIRED
  return raw
}

/**
 * وضعیت بعدی، بعد از یک مصرف موفق — قلبِ سیاستِ مصرف اعتبار (§۴).
 *
 *   • کوپن تک‌مصرف واقعی (`multiUse = false` و `carryRemainder = false`): با
 *     نخستین مصرف، حتی جزئی، `USED` می‌شود.
 *   • اعتبار غیرچندباره با حفظ مانده: بارکد و مانده روی همان رکورد می‌مانند و
 *     تا صفرشدن مبلغ `PARTIALLY_USED` است؛ این مسیر کد جانشین صادر نمی‌کند.
 *   • چندباره (`multiUse = true`): تا وقتی هم مبلغ مانده و هم دفعه مانده،
 *     `PARTIALLY_USED` است؛ با تمام شدن هرکدام می‌بندد.
 */
export function statusAfterRedeem(c: CreditCore, applied: number): string {
  const amount = Math.max(0, Math.round(Number(c.amount) || 0))
  const usedAfter = Math.min(amount, Math.max(0, Math.round(Number(c.usedAmount ?? 0) || 0) + Math.max(0, Math.round(applied) || 0)))
  const countAfter = Math.max(0, Math.round(Number(c.usedCount ?? 0) || 0)) + 1
  const maxUses = Math.max(1, Math.round(Number(c.maxUses ?? 1) || 1))
  /**
   * 🔴 نشست ۱۸۴ · بند ۴-۶ — باقی‌مانده روی **همان** بارکد می‌ماند.
   *
   * تا امروز دو رفتار وجود داشت و هر دو مشکل داشتند:
   *   • یک‌بارمصرف ⇒ وضعیت فوراً `USED` و باقی‌مانده با یک **بارکد جدید** به
   *     مشتری داده می‌شد. پول نمی‌سوخت (خواسته‌ی مالک) ولی یک رکورد جانشین
   *     ساخته می‌شد — دقیقاً چیزی که پرامپت می‌گوید نباید باشد («بدون ساخت
   *     رکورد باقی‌مانده‌ی جدا؛ مصرف و مانده در ledger enforce شود»).
   *   • چندباره ⇒ درست بود ولی انتخابش دست مالک نبود.
   *
   * این دو خواسته با هم جمع می‌شوند: پول نسوزد **و** بارکد جانشین ساخته نشود.
   * یعنی باقی‌مانده روی همان سند باز بماند و از `usedAmount` کنترل شود.
   *
   * `carryRemainder === false` همان «کوپن واقعاً یک‌بارمصرف» است که مالک
   * خواسته بود: با یک مصرف — حتی جزئی — بسته می‌شود.
   */
  if (c.multiUse !== true) {
    if ((c as { carryRemainder?: boolean }).carryRemainder === false) return CreditStatus.USED
    if (usedAfter >= amount) return CreditStatus.USED
    return CreditStatus.PARTIALLY_USED
  }
  if (usedAfter >= amount) return CreditStatus.USED
  if (countAfter >= maxUses) return CreditStatus.USED
  return CreditStatus.PARTIALLY_USED
}

// ---------------------------------------------------------------------------
// ۵) محدودیت اعمال: کالا / دسته / مشتری / مبلغ (§۱۸ سند مرجع)
// ---------------------------------------------------------------------------

export const CreditRestrictScope = { ALL: 'ALL', CATEGORY: 'CATEGORY', VARIANTS: 'VARIANTS' } as const
export type CreditRestrictScope = (typeof CreditRestrictScope)[keyof typeof CreditRestrictScope]

export const CREDIT_SCOPE_LABELS: Record<string, string> = {
  ALL: 'قابل استفاده روی همه‌ی کالاها',
  CATEGORY: 'محدود به دسته‌بندی‌های انتخاب‌شده',
  VARIANTS: 'محدود به کالاهای انتخاب‌شده'
}

export function normalizeRestrictScope(raw: unknown): CreditRestrictScope {
  const v = String(raw ?? '').trim().toUpperCase()
  return v === CreditRestrictScope.CATEGORY || v === CreditRestrictScope.VARIANTS
    ? (v as CreditRestrictScope)
    : CreditRestrictScope.ALL
}

/** JSON ذخیره‌شده‌ی شناسه‌ها ⇒ آرایه‌ی عددیِ پاک (ورودی خراب = آرایه‌ی خالی). */
export function parseIdList(raw: unknown): number[] {
  let v: unknown = raw
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v)
    } catch {
      return []
    }
  }
  if (!Array.isArray(v)) return []
  const out: number[] = []
  for (const x of v) {
    const n = Math.round(Number(x))
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out
}

/** یک قلم سبد، از دید قواعد اعتبار (نه از دید فروش). */
export interface CreditCartLine {
  variantId: number
  /** دسته‌ی کالا (از دیتابیس خوانده می‌شود؛ UI هم همین را دارد) */
  categoryId?: number | null
  /** همه‌ی نیاکان دسته (تا محدودیت «دسته‌ی والد» زیرشاخه‌ها را هم بپوشاند) */
  categoryPath?: number[] | null
  name?: string
  qty?: number
  /** مبلغ خالص همان ردیف (بعد از تخفیف ردیف) */
  lineTotal: number
}

export interface CreditEligibility {
  /** جمع مبلغ اقلامی که این اعتبار می‌تواند پوشششان دهد */
  eligibleTotal: number
  /** شناسه‌ی واریانت اقلام قابل‌پوشش (برای علامت‌گذاری در UI پنل فروش) */
  eligibleVariantIds: number[]
  /** شناسه‌ی واریانت اقلامی که این اعتبار رویشان اعمال نمی‌شود */
  excludedVariantIds: number[]
  /** محدودیت اصلاً فعال است؟ (ALL = نه) */
  restricted: boolean
  scope: string
}

/**
 * «کدام اقلام سبد با این اعتبار قابل پوشش‌اند؟» (§۱۸)
 *
 * این تابع هم در UI پنل فروش استفاده می‌شود (برای نشان دادن اقلام قابل‌پوشش) و
 * هم در Backend (برای سقف مبلغ قابل جذب). چون یک تابع است، UI و Backend
 * هیچ‌وقت دو جواب متفاوت نمی‌دهند.
 */
export function evaluateEligibility(c: CreditCore, lines: readonly CreditCartLine[]): CreditEligibility {
  const scope = normalizeRestrictScope(c.restrictScope)
  const all = lines ?? []
  if (scope === CreditRestrictScope.ALL) {
    return {
      eligibleTotal: all.reduce((s, l) => s + Math.max(0, Math.round(Number(l.lineTotal || 0))), 0),
      eligibleVariantIds: all.map((l) => l.variantId),
      excludedVariantIds: [],
      restricted: false,
      scope
    }
  }

  const cats = new Set(parseIdList(c.restrictCategoryIdsJson))
  const variants = new Set(parseIdList(c.restrictVariantIdsJson))
  const eligible: number[] = []
  const excluded: number[] = []
  let total = 0

  for (const l of all) {
    let ok = false
    if (scope === CreditRestrictScope.VARIANTS) {
      ok = variants.has(l.variantId)
    } else {
      // دسته‌ی خود کالا یا هر یک از دسته‌های والدش
      const path = Array.isArray(l.categoryPath) && l.categoryPath.length ? l.categoryPath : l.categoryId != null ? [l.categoryId] : []
      ok = path.some((id) => cats.has(id))
    }
    if (ok) {
      eligible.push(l.variantId)
      total += Math.max(0, Math.round(Number(l.lineTotal || 0)))
    } else {
      excluded.push(l.variantId)
    }
  }

  return { eligibleTotal: total, eligibleVariantIds: eligible, excludedVariantIds: excluded, restricted: true, scope }
}

// ---------------------------------------------------------------------------
// ۶) «آیا و چقدر قابل مصرف است؟» — همه‌ی شرط‌ها *با هم* (§۴ و §۸)
// ---------------------------------------------------------------------------

export interface RedeemContext {
  now?: Date | number
  /** سقف مبلغی که این فاکتور می‌تواند جذب کند (باقی‌ماندهٔ فاکتور) */
  applicable: number
  /** جمع کل فاکتور (مبنای «حداقل مبلغ خرید») */
  invoiceTotal?: number
  /** اقلام سبد (برای محدودیت کالا/دسته). خالی = بدون بررسی اقلام */
  lines?: readonly CreditCartLine[]
  /** مشتری فاکتور (برای «محدود به مشتری خاص») */
  customerId?: number | null
  /** مبلغ درخواستی کاربر (خالی = حداکثر ممکن) */
  requested?: number | null
}

export interface RedeemDecision {
  ok: boolean
  /** مبلغی که واقعاً می‌تواند مصرف شود */
  applied: number
  /** دلیل فارسیِ رد شدن (فقط وقتی ok=false) */
  error: string | null
  /** توضیح‌های کمکی برای UI (مثلاً «فقط روی ۲ قلم از سبد قابل استفاده است») */
  notes: string[]
  remainingBefore: number
  usesLeft: number
  eligibility: CreditEligibility | null
}

/**
 * ⚠️ این تابع «همه‌ی شرط‌ها را با هم» چک می‌کند، نه یکی‌یکی (§۴ سند مرجع):
 * وضعیت، تاریخ انقضا، مبلغ باقی‌مانده، دفعات باقی‌مانده، محدودیت کالا/دسته،
 * حداقل مبلغ خرید، سقف هر تراکنش، و قفل مشتری.
 *
 * خروجی همیشه یک عدد قابل‌اتکا است (`applied`) که Backend دقیقاً همان را کم
 * می‌کند — پس هیچ مسیری نیست که UI عددی بفرستد و Backend بی‌بررسی بپذیرد.
 */
export function decideRedeem(c: CreditCore, ctx: RedeemContext): RedeemDecision {
  const now = ctx.now ?? Date.now()
  const notes: string[] = []
  const remaining = remainingOf(c)
  const usesLeft = usesLeftOf(c)
  const status = effectiveStatus(c, now)
  const fail = (error: string, eligibility: CreditEligibility | null = null): RedeemDecision => ({
    ok: false,
    applied: 0,
    error,
    notes,
    remainingBefore: remaining,
    usesLeft,
    eligibility
  })

  if (!REDEEMABLE_STATUSES.includes(status)) {
    if (status === CreditStatus.USED)
      return fail('این اعتبار کامل مصرف شده است و دوباره قابل استفاده نیست.')
    if (status === CreditStatus.EXPIRED)
      return fail('مهلت این اعتبار تمام شده است؛ برای تصمیم‌گیری با مدیر هماهنگ کنید.')
    if (status === CreditStatus.CANCELED) return fail('این اعتبار باطل شده است و قابل استفاده نیست.')
    if (status === CreditStatus.SUSPENDED)
      return fail('این اعتبار «معلق» است و تا فعال‌سازی دوباره توسط مدیر قابل استفاده نیست.')
    if (status === CreditStatus.DRAFT)
      return fail('این اعتبار هنوز پیش‌نویس است و صادر نشده، پس قابل استفاده نیست.')
    return fail('وضعیت این اعتبار اجازه‌ی مصرف نمی‌دهد.')
  }

  if (remaining <= 0) return fail('باقی‌مانده‌ی این اعتبار صفر است.')
  /**
   * `carryRemainder=true` برای اعتبار غیرچندباره یعنی «مانده روی *همین* سند
   * بماند» (تصمیم نشست ۱۸۴)، نه این‌که بعد از نخستین مصرف جزئی قفل شود.
   *
   * پیش از این استثنا، `statusAfterRedeem` درست `PARTIALLY_USED` می‌نوشت اما
   * همین گارد با `maxUses=1` مصرف دومِ مانده را رد می‌کرد؛ در نتیجه هم بارکد
   * جدیدی صادر نمی‌شد و هم پول مشتری عملاً گیر می‌کرد. در حالت
   * `carryRemainder=false` واقعاً کوپنِ تک‌مصرف است و سقف دفعات همچنان سخت
   * اعمال می‌شود. برای اعتبار چندباره نیز `maxUses` دقیقاً مثل قبل پابرجاست.
   */
  const usageLimitApplies = c.multiUse === true || c.carryRemainder === false
  if (usageLimitApplies && usesLeft <= 0)
    return fail(
      `دفعات مجاز مصرف این اعتبار تمام شده است (${Math.max(1, Math.round(Number(c.maxUses ?? 1)))} بار مجاز بود).`
    )

  // ---- قفل مشتری (§۱۸) ----
  if (c.customerLocked === true) {
    const owner = c.customerId ?? null
    if (owner == null) {
      notes.push('این اعتبار «محدود به مشتری خاص» علامت خورده ولی مشتری‌اش ثبت نشده است؛ محدودیت اعمال نشد.')
    } else if ((ctx.customerId ?? null) !== owner) {
      return fail('این اعتبار فقط برای مشتری/شرکتِ ثبت‌شده‌ی خودش قابل استفاده است.')
    }
  }

  // ---- حداقل مبلغ خرید (§۱۸) ----
  const minPurchase = Math.max(0, Math.round(Number(c.minPurchase ?? 0) || 0))
  const invoiceTotal = Math.max(0, Math.round(Number(ctx.invoiceTotal ?? ctx.applicable) || 0))
  if (minPurchase > 0 && invoiceTotal < minPurchase)
    return fail(
      `این اعتبار حداقل مبلغ خرید دارد: جمع فاکتور باید از ${minPurchase} ریال بیشتر باشد (جمع فعلی ${invoiceTotal} ریال).`
    )

  // ---- محدودیت کالا/دسته (§۱۸) ----
  const lines = ctx.lines ?? []
  let eligibility: CreditEligibility | null = null
  let cap = Math.max(0, Math.round(Number(ctx.applicable) || 0))
  if (lines.length) {
    eligibility = evaluateEligibility(c, lines)
    if (eligibility.restricted) {
      if (eligibility.eligibleTotal <= 0)
        return fail(
          'هیچ‌کدام از اقلام این فاکتور با محدودیت این اعتبار (کالا/دسته‌بندی) نمی‌خواند، پس این اعتبار روی این فاکتور قابل استفاده نیست.',
          eligibility
        )
      if (eligibility.eligibleTotal < cap) {
        cap = eligibility.eligibleTotal
        notes.push(
          `این اعتبار فقط روی ${eligibility.eligibleVariantIds.length} قلم از اقلام این فاکتور قابل استفاده است، پس حداکثر تا ${cap} ریال جذب می‌شود.`
        )
      }
    }
  }

  // ---- سقف هر تراکنش (§۱۸) ----
  const perTx = Math.max(0, Math.round(Number(c.maxPerTransaction ?? 0) || 0))
  if (perTx > 0 && perTx < cap) {
    cap = perTx
    notes.push(`سقف مصرف این اعتبار در هر تراکنش ${perTx} ریال است.`)
  }

  // ---- مبلغ درخواستی کاربر ----
  const requested = ctx.requested == null ? null : Math.max(0, Math.round(Number(ctx.requested) || 0))
  let applied = Math.min(remaining, cap)
  if (requested != null) {
    if (requested <= 0) return fail('مبلغ مصرف اعتبار باید بزرگ‌تر از صفر باشد.', eligibility)
    if (requested > applied)
      return fail(
        `مبلغ درخواستی ${requested} ریال بیشتر از سقف قابل‌مصرف این اعتبار روی این فاکتور (${applied} ریال) است.`,
        eligibility
      )
    applied = requested
  }

  if (applied <= 0)
    return fail(
      'این فاکتور باقی‌مانده‌ای برای جذب اعتبار ندارد، پس اعتبار روی آن خرج نمی‌شود و دست‌نخورده معتبر می‌ماند.',
      eligibility
    )

  return { ok: true, applied, error: null, notes, remainingBefore: remaining, usesLeft, eligibility }
}

// ---------------------------------------------------------------------------
// ۷) تنظیمات مرکزی اعتبار خرید (§۳ و §۲۲ سند مرجع)
// ---------------------------------------------------------------------------

/** قواعد پیش‌فرض *هر نوع* اعتبار (§۳ — جدا برای هر نوع، با امکان Override). */
export interface CreditTypeRules {
  /** مدت اعتبار پیش‌فرض به روز (۰ = بدون انقضا) */
  days: number
  /** دفعات مصرف پیش‌فرض (۱ = یک‌بارمصرف) */
  maxUses: number
  /** پیش‌فرض «چندباره تا سقف مبلغ» */
  multiUse: boolean
  /**
   * نشست ۱۸۳ — تکلیف **باقی‌مانده** وقتی اعتبار یک‌بارمصرف است
   * (`multiUse = false`) و مشتری کمتر از مبلغ کل خرج می‌کند.
   *
   *   `true`  (پیش‌فرض) ⇒ باقی‌مانده به شکل یک بارکد *جدید* به مشتری برمی‌گردد.
   *   `false`           ⇒ باقی‌مانده **می‌سوزد**؛ کارت با همان یک مصرف تمام است.
   *
   * چرا پیش‌فرض `true` است: رفتار تاریخی برنامه همین بوده و پول مشتری نباید
   * بی‌اطلاع او بسوزد. اعتبار ۱٬۰۰۰٬۰۰۰ که ۵۰۰٬۰۰۰ خرج شده، منطقاً ۵۰۰٬۰۰۰
   * باقی دارد. ولی بعضی فروشگاه‌ها سیاست «کوپن یک‌بارمصرف» دارند، پس این
   * انتخاب باید دستِ مالک باشد نه سخت‌کدشده.
   *
   * ⚠️ وقتی `multiUse = true` باشد این گزینه اصلاً معنا ندارد: باقی‌مانده روی
   * همان رکورد می‌ماند و بارکد جدیدی ساخته نمی‌شود.
   */
  carryRemainder: boolean
}

export interface CreditReminderSettings {
  /** خودِ فهرست/فیلتر یادآوری فعال است؟ (ارسال واقعی در این فاز وجود ندارد) */
  enabled: boolean
  /** «حداقل N روز از صدور گذشته و هنوز مصرف نشده» (§۱۴) */
  minDaysSinceIssue: number
  /** فاصله‌ی مجاز بین دو پیام به یک مشتری (روز) */
  minGapDays: number
  /** حداکثر تعداد یادآوری برای هر اعتبار */
  maxCount: number
  /** چند روز قبل از انقضا هم یادآوری در فهرست بیاید (۰ = خاموش) */
  beforeExpiryDays: number
  /** متن پیش‌فرض پیام (فقط ذخیره می‌شود؛ ارسالی وجود ندارد) */
  template: string
}

/** اندازه‌ی کاغذ سند اعتبار (§۱۳) — از همان تنظیمات قالب چاپ استفاده می‌شود. */
export const CreditPaper = { A4: 'A4', A5: 'A5', A6: 'A6', T80: 'T80', T58: 'T58', CUSTOM: 'CUSTOM' } as const
export type CreditPaper = (typeof CreditPaper)[keyof typeof CreditPaper]

export const CREDIT_PAPER_LABELS: Record<string, string> = {
  A4: 'A4 (۲۱۰×۲۹۷ میلی‌متر)',
  A5: 'A5 (۱۴۸×۲۱۰ میلی‌متر)',
  A6: 'A6 (۱۰۵×۱۴۸ میلی‌متر)',
  T80: 'رسید حرارتی ۸۰ میلی‌متر',
  T58: 'رسید حرارتی ۵۸ میلی‌متر',
  CUSTOM: 'اندازه‌ی سفارشی'
}

/** ابعاد میلی‌متری هر اندازه (رسید حرارتی: ارتفاع آزاد ⇒ auto). */
export function creditPaperSize(
  paper: string,
  customWidthMm = 100,
  customHeightMm = 150
): { widthMm: number; heightMm: number | null } {
  switch (paper) {
    case CreditPaper.A4:
      return { widthMm: 210, heightMm: 297 }
    case CreditPaper.A5:
      return { widthMm: 148, heightMm: 210 }
    case CreditPaper.A6:
      return { widthMm: 105, heightMm: 148 }
    case CreditPaper.T80:
      return { widthMm: 80, heightMm: null }
    case CreditPaper.T58:
      return { widthMm: 58, heightMm: null }
    default:
      return {
        widthMm: Math.min(400, Math.max(40, Math.round(customWidthMm) || 100)),
        heightMm: Math.min(600, Math.max(40, Math.round(customHeightMm) || 150))
      }
  }
}

export interface CreditSettings {
  // --- کد (§۶) ---
  codeLength: number
  codeAlphabet: CreditCodeAlphabet
  excludeSimilar: boolean
  /** «افزایش خودکار طول در صورت کمبود فضا» — رفتارش همیشه گزارش می‌شود */
  autoGrowLength: boolean
  /** پیشوند نمایشی هر نوع (بدون نقش امنیتی — §۲۲) */
  prefixManual: string
  prefixExchange: string

  // --- قواعد هر نوع (§۳) ---
  types: Record<string, CreditTypeRules>

  // --- تولید گروهی (§۵) ---
  bulkMaxCount: number
  /** ضریب ایمنی فضای کد (۲۰ = حداکثر ۵٪ فضا پر شود) */
  bulkCapacityRatio: number

  // --- بارکد (§۷) ---
  barcodeIncludeText: boolean
  barcodeHeightMm: number

  // --- چاپ (§۱۳) ---
  paper: CreditPaper
  customWidthMm: number
  customHeightMm: number
  /**
   * نشست ۳۱۷ · طرح کلاد (گزینه‌ی برنده) — سه عددِ جدیدِ چاپ سند اعتبار.
   * پیش‌فرض‌ها دقیقاً CSS تاریخی‌اند (font 11px، padding ‌۵mm ۴mm) تا بدون
   * هیچ اکشنی، خروجی بایت‌به‌بایت همان امروز بماند (`isLegacy` در
   * `@shared/creditPrint`). بازه‌ها: فونت ۶..۲۲px (یعنی ضریب حدود ۰٫۵ تا ۲)،
   * حاشیه ۰..۲۰mm (هنگام رندر نسبت به کاغذ هم clamp دوم می‌خورد).
   */
  printFontPx: number
  printMarginXMm: number
  printMarginYMm: number
  showRules: boolean
  showHolder: boolean
  showRemaining: boolean
  /** متن قوانین استفاده روی سند */
  rulesText: string

  // --- یادآوری (§۱۴) ---
  reminder: CreditReminderSettings

  // --- گزارش مالی (§۱۵) ---
  /** اعتبارهای صادرشده و مصرف‌نشده به‌عنوان «تعهد فروشگاه» گزارش شوند؟ */
  reportLiability: boolean
}

export const DEFAULT_CREDIT_TYPE_RULES: Record<string, CreditTypeRules> = {
  // §۳ سند مرجع: عادی/صادرشده = ۳۰ روز / ۱ بار · تعویض = ۷ روز / ۱ بار
  // نشست ۱۸۳: `carryRemainder: true` = همان رفتار تاریخی (باقی‌مانده نمی‌سوزد)
  MANUAL: { days: 30, maxUses: 1, multiUse: false, carryRemainder: true },
  EXCHANGE: { days: 7, maxUses: 1, multiUse: false, carryRemainder: true }
}

export const DEFAULT_CREDIT_REMINDER: CreditReminderSettings = {
  enabled: true,
  minDaysSinceIssue: 10,
  minGapDays: 7,
  maxCount: 3,
  beforeExpiryDays: 3,
  template:
    '{store_name}: {customer_name} عزیز، اعتبار خرید {credit_amount} ریالی شما با کد {credit_code} تا {expiry_date} معتبر است. باقی‌مانده: {remaining_amount} ریال.'
}

export const DEFAULT_CREDIT_SETTINGS: CreditSettings = {
  codeLength: 8,
  codeAlphabet: CreditCodeAlphabet.ALNUM,
  excludeSimilar: true,
  autoGrowLength: true,
  prefixManual: 'CR',
  prefixExchange: 'E',
  types: {
    MANUAL: { ...DEFAULT_CREDIT_TYPE_RULES.MANUAL },
    EXCHANGE: { ...DEFAULT_CREDIT_TYPE_RULES.EXCHANGE }
  },
  bulkMaxCount: 5000,
  bulkCapacityRatio: 20,
  barcodeIncludeText: true,
  barcodeHeightMm: 14,
  paper: CreditPaper.A6,
  customWidthMm: 100,
  customHeightMm: 150,
  // نشست ۳۱۷ — پیش‌فرض = CSS تاریخی («پیش‌فرض = امروز» بدون مهاجرت)
  printFontPx: 11,
  printMarginXMm: 4,
  printMarginYMm: 5,
  showRules: true,
  showHolder: true,
  showRemaining: true,
  rulesText:
    'این سند به‌جای پول نقد است و فقط در همین فروشگاه و تا تاریخ انقضا قابل استفاده است. مبلغ واقعی اعتبار همیشه از سیستم فروشگاه خوانده می‌شود.',
  reminder: { ...DEFAULT_CREDIT_REMINDER },
  reportLiability: true
}

const num = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const bool = (v: unknown, fallback: boolean): boolean => (v === undefined || v === null ? fallback : v !== false)

export function parseCreditTypeRules(raw: unknown, fallback: CreditTypeRules): CreditTypeRules {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    days: num(o.days, fallback.days, 0, 3650),
    maxUses: num(o.maxUses, fallback.maxUses, 1, 1000),
    multiUse: bool(o.multiUse, fallback.multiUse),
    // نشست ۱۸۳: نبودِ کلید در داده‌ی قدیمی ⇒ `true` (همان رفتار تاریخی، بدون رگرسیون)
    carryRemainder: bool(o.carryRemainder, fallback.carryRemainder)
  }
}

/**
 * خواندن ایمن تنظیمات اعتبار.
 * نبودن رکورد، JSON خراب، یا مقدار بی‌معنا ⇒ همان پیش‌فرض‌های محافظه‌کارانه.
 * (همان الگوی `parseAccountingPolicy` و `parsePanelLocks` بقیه‌ی برنامه.)
 */
export function parseCreditSettings(raw: unknown): CreditSettings {
  let parsed: unknown = raw
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      parsed = null
    }
  }
  const o = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
  const d = DEFAULT_CREDIT_SETTINGS
  const alphabetRaw = String(o.codeAlphabet ?? '').trim().toUpperCase()
  const paperRaw = String(o.paper ?? '').trim().toUpperCase()
  const typesRaw = (o.types && typeof o.types === 'object' ? o.types : {}) as Record<string, unknown>
  const reminderRaw = (o.reminder && typeof o.reminder === 'object' ? o.reminder : {}) as Record<string, unknown>

  const types: Record<string, CreditTypeRules> = {}
  for (const key of Object.keys(d.types)) types[key] = parseCreditTypeRules(typesRaw[key], d.types[key])
  // نوع‌های اضافه‌ی آینده (§۳: «و هر نوع دیگری که بعداً اضافه شود») حذف نمی‌شوند
  for (const key of Object.keys(typesRaw)) {
    if (types[key]) continue
    const clean = String(key).trim().toUpperCase().replace(/[^A-Z_]/g, '')
    if (clean) types[clean] = parseCreditTypeRules(typesRaw[key], DEFAULT_CREDIT_TYPE_RULES.MANUAL)
  }

  return {
    codeLength: num(o.codeLength, d.codeLength, MIN_CREDIT_CODE_LENGTH, MAX_CREDIT_CODE_LENGTH),
    codeAlphabet: (alphabetRaw === 'ALPHA' || alphabetRaw === 'NUM' ? alphabetRaw : 'ALNUM') as CreditCodeAlphabet,
    excludeSimilar: bool(o.excludeSimilar, d.excludeSimilar),
    autoGrowLength: bool(o.autoGrowLength, d.autoGrowLength),
    prefixManual: normalizeCreditPrefix(o.prefixManual, d.prefixManual),
    prefixExchange: normalizeCreditPrefix(o.prefixExchange, d.prefixExchange),
    types,
    bulkMaxCount: num(o.bulkMaxCount, d.bulkMaxCount, 1, 100000),
    bulkCapacityRatio: num(o.bulkCapacityRatio, d.bulkCapacityRatio, 1, 1000),
    barcodeIncludeText: bool(o.barcodeIncludeText, d.barcodeIncludeText),
    barcodeHeightMm: num(o.barcodeHeightMm, d.barcodeHeightMm, 5, 60),
    paper: (Object.prototype.hasOwnProperty.call(CreditPaper, paperRaw) ? paperRaw : d.paper) as CreditPaper,
    customWidthMm: num(o.customWidthMm, d.customWidthMm, 40, 400),
    customHeightMm: num(o.customHeightMm, d.customHeightMm, 40, 600),
    // نشست ۳۱۷ — نبودن کلید در JSON قدیمی ⇒ پیش‌فرضِ سازگار (= رندر امروز)
    printFontPx: num(o.printFontPx, d.printFontPx, 6, 22),
    printMarginXMm: num(o.printMarginXMm, d.printMarginXMm, 0, 20),
    printMarginYMm: num(o.printMarginYMm, d.printMarginYMm, 0, 20),
    showRules: bool(o.showRules, d.showRules),
    showHolder: bool(o.showHolder, d.showHolder),
    showRemaining: bool(o.showRemaining, d.showRemaining),
    rulesText: String(o.rulesText ?? d.rulesText),
    reminder: {
      enabled: bool(reminderRaw.enabled, d.reminder.enabled),
      minDaysSinceIssue: num(reminderRaw.minDaysSinceIssue, d.reminder.minDaysSinceIssue, 0, 3650),
      minGapDays: num(reminderRaw.minGapDays, d.reminder.minGapDays, 0, 365),
      maxCount: num(reminderRaw.maxCount, d.reminder.maxCount, 0, 100),
      beforeExpiryDays: num(reminderRaw.beforeExpiryDays, d.reminder.beforeExpiryDays, 0, 365),
      template: String(reminderRaw.template ?? d.reminder.template)
    },
    reportLiability: bool(o.reportLiability, d.reportLiability)
  }
}

/**
 * یک خط خلاصه‌ی فارسی از تنظیمات — برای ستون «توضیح» در AuditLog (§۱۰).
 * (همان نقشی که `describeDiscountPolicy` برای سیاست تخفیف دارد.)
 */
export function describeCreditSettings(s: CreditSettings): string {
  const types = Object.keys(s.types)
    .map((k) => {
      const r = s.types[k]
      return `${CREDIT_SOURCE_LABELS[k] ?? k}: ${r.days > 0 ? `${r.days} روز` : 'بدون انقضا'}/${r.maxUses} بار${r.multiUse ? ' (چندباره)' : ''}`
    })
    .join(' · ')
  return (
    `طول کد ${s.codeLength} · ${CREDIT_ALPHABET_LABELS[s.codeAlphabet] ?? s.codeAlphabet}` +
    `${s.excludeSimilar ? ' · بدون کاراکترهای مشابه' : ''}` +
    `${s.autoGrowLength ? ' · افزایش خودکار طول' : ''}` +
    ` · پیشوند ${s.prefixManual || '—'}/${s.prefixExchange || '—'} · ${types}` +
    ` · سقف تولید گروهی ${s.bulkMaxCount} · کاغذ ${CREDIT_PAPER_LABELS[s.paper] ?? s.paper}` +
    /**
     * نشست ۳۱۷ — فقط اگر کاربر چیزی را از پیش‌فرض چاپ دور کرده باشد در لاگ
     * می‌آید؛ یادداشت AuditLog مشتریانِ فعلی (همه روی پیش‌فرض) تغییر نمی‌کند.
     */
    (s.printFontPx !== DEFAULT_CREDIT_SETTINGS.printFontPx ||
    s.printMarginXMm !== DEFAULT_CREDIT_SETTINGS.printMarginXMm ||
    s.printMarginYMm !== DEFAULT_CREDIT_SETTINGS.printMarginYMm
      ? ` · چاپ سند: فونت ${s.printFontPx}px · حاشیه ${s.printMarginXMm}×${s.printMarginYMm}mm`
      : '') +
    ` · یادآوری ${s.reminder.enabled ? `روشن (حداقل ${s.reminder.minDaysSinceIssue} روز، فاصله ${s.reminder.minGapDays} روز، سقف ${s.reminder.maxCount})` : 'خاموش'}` +
    ` · گزارش تعهد ${s.reportLiability ? 'روشن' : 'خاموش'}`
  )
}

/** قواعد پیش‌فرض یک نوع (نوع ناشناس ⇒ قواعد نوع «صادرشده توسط مدیریت»). */
export function rulesForSource(settings: CreditSettings, source: string): CreditTypeRules {
  const key = String(source ?? '').toUpperCase()
  /**
   * نشست ۶۱ (S61-1) — اعتبار اضافه‌دریافت پول خودِ مشتری است، مثل مابه‌التفاوت
   * تعویض؛ پس تا وقتی مدیر قاعده‌ی جدایی برایش تعریف نکرده، قواعد «تعویض» را
   * می‌گیرد (نه قواعد سخاوتمندانه‌تر یا سخت‌گیرانه‌تر «مدیریتی»).
   */
  if (key === 'OVERPAY' && !settings.types.OVERPAY)
    return settings.types.EXCHANGE ?? DEFAULT_CREDIT_TYPE_RULES.EXCHANGE ?? DEFAULT_CREDIT_TYPE_RULES.MANUAL
  return settings.types[key] ?? settings.types.MANUAL ?? DEFAULT_CREDIT_TYPE_RULES.MANUAL
}

// ---------------------------------------------------------------------------
// ۸) یادآوری: منطق «باید بفرستد یا نه» (§۱۴ سند مرجع)
// ---------------------------------------------------------------------------

export const CreditReminderKind = {
  /** «صادر شده و مصرف نشده» */
  UNUSED: 'UNUSED',
  /** «نزدیک انقضا» */
  NEAR_EXPIRY: 'NEAR_EXPIRY'
} as const
export type CreditReminderKind = (typeof CreditReminderKind)[keyof typeof CreditReminderKind]

export const CREDIT_REMINDER_KIND_LABELS: Record<string, string> = {
  UNUSED: 'اعتبار مصرف‌نشده',
  NEAR_EXPIRY: 'نزدیک به انقضا'
}

/** وضعیت یک ردیف لاگ یادآوری. هیچ‌کدام «ارسال واقعی» نیست (§۱۴). */
export const CreditReminderStatus = {
  /** آماده‌ی ارسال (صف) — هنوز هیچ سرویسی وصل نیست */
  READY: 'READY',
  /** فرستنده‌ی فعلی فقط لاگ کرد (LogOnlyNotificationSender) */
  LOGGED: 'LOGGED',
  /** طبق قواعد ضد‌اسپم رد شد */
  SKIPPED: 'SKIPPED',
  /** مشتری Opt-out کرده است */
  OPTED_OUT: 'OPTED_OUT',
  /**
   * «پذیرفته شد، ولی هرگز واقعاً نرفت» — پیام در صف قطعی شکست خورد یا لغو شد.
   * سهمیه‌ی این یادآوری پس داده شده تا ضداسپم جلوی یادآوری بعدی را نگیرد.
   */
  UNDELIVERED: 'UNDELIVERED'
} as const

export const CREDIT_REMINDER_STATUS_LABELS: Record<string, string> = {
  READY: 'آماده‌ی ارسال',
  LOGGED: 'ثبت شد (بدون ارسال واقعی)',
  SKIPPED: 'رد شد (قواعد ضد‌اسپم)',
  OPTED_OUT: 'مشتری ارسال پیام را نمی‌خواهد',
  UNDELIVERED: 'پذیرفته شد ولی ارسال واقعی انجام نشد'
}

/** اطلاعات لازم برای تصمیم یادآوری — بدون نیاز به خود رکورد Prisma. */
export interface ReminderCandidate {
  id?: number
  code?: string
  status: string
  amount: number
  usedAmount?: number | null
  usedCount?: number | null
  maxUses?: number | null
  multiUse?: boolean | null
  expiresAt?: Date | string | null
  issuedAt: Date | string
  /** آخرین پیام ارسال/ثبت‌شده */
  lastReminderAt?: Date | string | null
  reminderCount?: number | null
  reminderOptOut?: boolean | null
  /** شماره تماس دارنده (بدون شماره، پیام قابل ارسال نیست) */
  phone?: string | null
}

export interface ReminderDecision {
  should: boolean
  kind: CreditReminderKind | null
  /** دلیل فارسی (چه «باید» و چه «نباید») — مستقیم در UI نشان داده می‌شود */
  reason: string
  daysSinceIssue: number
  daysToExpiry: number | null
  /**
   * کد ماشین‌خوانِ «چرا نباید» (وقتی `should` غلط است).
   *
   * 🔴 چرا لازم شد (بازبینی پنجم): تصمیم‌گیر یک پرچم داخلی `force` دارد که
   * برای «دکمه‌ی دستی مدیر» گذاشته شده بود، ولی وقتی می‌آمد همه‌ی دلیل‌ها را
   * با هم دور می‌زد — از جمله دلیل‌هایی که **هرگز** نباید دور بخورند: کد باطل،
   * مصرف‌شده، معلق، منقضی، بی‌شماره. با این کد، تماس‌کننده‌ی داخلی می‌تواند
   * فقط دلیل‌های زمان‌بندی/سهمیه را رد کند، نه «قابل ارسال نبودن» را.
   */
  code: 'DISABLED' | 'OPTOUT' | 'STATUS' | 'REMAINING' | 'NO_PHONE' | 'MAX_COUNT' | 'GAP' | 'NOT_DUE' | null
}

/**
 * دلیل‌هایی که `force` می‌تواند از آن‌ها بگذرد: فقط زمان‌بندی/سهمیه.
 * دلیل‌های دیگر یعنی «این کد اصلاً نباید پیام بگیرد».
 */
export const REMINDER_FORCEABLE_CODES: readonly ReminderDecision['code'][] = [
  'DISABLED',
  'MAX_COUNT',
  'GAP',
  'NOT_DUE'
]

export function isReminderForceable(code: unknown): boolean {
  return REMINDER_FORCEABLE_CODES.includes(String(code ?? '') as ReminderDecision['code'])
}

const DAY = 24 * 60 * 60 * 1000
const asTime = (v: Date | string | null | undefined): number | null => {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * «برای این اعتبار باید یادآوری برود یا نه؟» — کامل و همین حالا کار می‌کند،
 * حتی با این‌که هیچ پیامکی واقعاً ارسال نمی‌شود (§۱۴).
 *
 * ترتیب رد کردن‌ها عمدی است: اول چیزهایی که *اصلاً* پیام نمی‌خواهند (مصرف‌شده،
 * باطل، معلق، Opt-out، بی‌شماره)، بعد قواعد ضد‌اسپم (فاصله، سقف تعداد)، و آخر
 * شرط‌های مثبت («نزدیک انقضا» یا «N روز از صدور گذشته و مصرف نشده»).
 */
export function reminderDecision(
  c: ReminderCandidate,
  settings: CreditReminderSettings,
  nowInput: Date | number = Date.now()
): ReminderDecision {
  const now = nowInput instanceof Date ? nowInput.getTime() : nowInput
  const issued = asTime(c.issuedAt) ?? now
  const expires = asTime(c.expiresAt)
  const daysSinceIssue = Math.max(0, Math.floor((now - issued) / DAY))
  const daysToExpiry = expires == null ? null : Math.ceil((expires - now) / DAY)
  const no = (reason: string, code: ReminderDecision['code']): ReminderDecision => ({
    should: false,
    kind: null,
    reason,
    daysSinceIssue,
    daysToExpiry,
    code
  })

  if (!settings.enabled) return no('یادآوری در تنظیمات خاموش است.', 'DISABLED')
  if (c.reminderOptOut === true) return no('مشتری ارسال پیام را نمی‌خواهد (Opt-out).', 'OPTOUT')

  const status = effectiveStatus(
    {
      amount: c.amount,
      usedAmount: c.usedAmount,
      usedCount: c.usedCount,
      maxUses: c.maxUses,
      multiUse: c.multiUse,
      status: c.status,
      expiresAt: c.expiresAt ?? null
    },
    now
  )
  if (status === CreditStatus.USED) return no('این اعتبار کامل مصرف شده است.', 'STATUS')
  if (status === CreditStatus.CANCELED) return no('این اعتبار باطل شده است.', 'STATUS')
  if (status === CreditStatus.SUSPENDED) return no('این اعتبار معلق است.', 'STATUS')
  if (status === CreditStatus.EXPIRED) return no('مهلت این اعتبار تمام شده است.', 'STATUS')
  if (status === CreditStatus.DRAFT) return no('این اعتبار هنوز پیش‌نویس است.', 'STATUS')

  const remaining = remainingOf({ amount: c.amount, usedAmount: c.usedAmount, status: c.status })
  if (remaining <= 0) return no('باقی‌مانده‌ی این اعتبار صفر است.', 'REMAINING')
  if (!String(c.phone ?? '').trim()) return no('شماره تماسی برای دارنده‌ی این اعتبار ثبت نشده است.', 'NO_PHONE')

  const sent = Math.max(0, Math.round(Number(c.reminderCount ?? 0) || 0))
  if (settings.maxCount > 0 && sent >= settings.maxCount)
    return no(`سقف تعداد یادآوری (${settings.maxCount} بار) برای این اعتبار پر شده است.`, 'MAX_COUNT')

  const last = asTime(c.lastReminderAt)
  if (last != null && settings.minGapDays > 0) {
    const gap = Math.floor((now - last) / DAY)
    if (gap < settings.minGapDays)
      return no(
        `از آخرین پیام فقط ${gap} روز گذشته است؛ فاصله‌ی مجاز بین دو پیام ${settings.minGapDays} روز است.`,
        'GAP'
      )
  }

  // شرط‌های مثبت
  if (
    settings.beforeExpiryDays > 0 &&
    daysToExpiry != null &&
    daysToExpiry >= 0 &&
    daysToExpiry <= settings.beforeExpiryDays
  ) {
    return {
      should: true,
      kind: CreditReminderKind.NEAR_EXPIRY,
      reason: `تا انقضای این اعتبار ${daysToExpiry} روز مانده و هنوز باقی‌مانده دارد.`,
      daysSinceIssue,
      daysToExpiry,
      code: null
    }
  }
  if (daysSinceIssue >= settings.minDaysSinceIssue) {
    return {
      should: true,
      kind: CreditReminderKind.UNUSED,
      reason: `${daysSinceIssue} روز از صدور گذشته و هنوز ${remaining} ریال از این اعتبار مصرف نشده است.`,
      daysSinceIssue,
      daysToExpiry,
      code: null
    }
  }
  return no(
    `فقط ${daysSinceIssue} روز از صدور گذشته است؛ شرط یادآوری «حداقل ${settings.minDaysSinceIssue} روز» است.`,
    'NOT_DUE'
  )
}

/**
 * Placeholder های مجاز متن پیام (§۱۴).
 * ⚠️ همین فهرست، قرارداد «پنل پیامک» آینده است: وقتی آن پنل اضافه شد، فقط
 * پیاده‌سازی `NotificationSender` عوض می‌شود و ساختار داده/متن دست‌نخورده
 * می‌ماند.
 */
export const CREDIT_PLACEHOLDERS = [
  'customer_name',
  'credit_amount',
  'remaining_amount',
  'expiry_date',
  'credit_code',
  'store_name'
] as const
export type CreditPlaceholder = (typeof CREDIT_PLACEHOLDERS)[number]

/** جای‌گذاری Placeholder ها. کلید ناشناس دست‌نخورده می‌ماند (تا خطا پنهان نشود). */
export function fillPlaceholders(template: string, vars: Partial<Record<CreditPlaceholder, string>>): string {
  let out = String(template ?? '')
  for (const key of CREDIT_PLACEHOLDERS) {
    const value = vars[key]
    if (value === undefined) continue
    out = out.split(`{${key}}`).join(value)
  }
  return out
}

// ---------------------------------------------------------------------------
// ۹) جلسه ۲۹ — قواعدی که تا دیروز داخل سرویس main پخش بودند
//    (§۲/§۳/§۱۰/§۱۱/§۱۳/§۱۵/§۱۶/§۱۹)
// ---------------------------------------------------------------------------

/**
 * چرا این بخش اینجاست و نه در `creditUi.ts`؟
 *
 * قاعده‌ی جلسه ۲۷ («هر تصمیم تازه در لایه‌ی مشترک بنشیند، نه در JSX») درباره‌ی
 * *نمایش* بود. چیزهایی که این بخش دارد اما قاعده‌ی مالی/امنیتی‌اند — کدام
 * Transition مجاز است، کدام ردیف AuditLog حق حذف ندارد، کدام روز انقضا
 * معتبر است — و هدرِ `creditUi.ts` صریحاً می‌گوید آن فایل اجازه‌ی نگه‌داشتن
 * قاعده‌ی مالی/امنیتی ندارد. پس این‌ها در همین «منبع قاعده» می‌نشینند و سرویس
 * main تنها *اعمال‌کننده*شان است. تستشان در `test/credit-ui-logic-session29.ts`
 * واقعاً اجرا می‌شود.
 */

/** وضعیت‌هایی که *ستون* وضعیتشان ممکن است از تاریخ انقضا عقب مانده باشد. */
export const EXPIRABLE_STATUSES: readonly string[] = [
  CreditStatus.ACTIVE,
  CreditStatus.PARTIALLY_USED,
  CreditStatus.DRAFT
]

/**
 * §۲/§۱۱/§۱۵ — فیلتر وضعیت روی **وضعیت مؤثر**، نه ستون خام.
 *
 * باگ واقعی: یک اعتبار ACTIVEِ تاریخ‌گذشته در فهرست و داشبورد «مصرف‌نشده
 * (معتبر)» شمرده می‌شد، چون ستون `status` هنوز ACTIVE بود و `effectiveStatus`
 * فقط در *نمایش* اعمال می‌شد. این تابع همان تعریف را به یک قطعه‌ی `where`
 * تبدیل می‌کند تا فهرست، داشبورد و گزارش‌ها هر سه یک چیز بگویند.
 *
 * خروجی عمداً یک شیء ساده‌ی JSON است (قابل تست بدون دیتابیس) که سرویس داخل
 * `AND` می‌گذارد — پس `OR`ِ جست‌وجو را خراب نمی‌کند.
 */
export function creditStatusWhere(status: unknown, now: Date | number = Date.now()): Record<string, any> | null {
  const raw = String(status ?? '').trim().toUpperCase()
  if (!raw) return null
  const at = now instanceof Date ? now : new Date(now)
  if (raw === CreditStatus.EXPIRED)
    return {
      OR: [
        { status: CreditStatus.EXPIRED },
        { status: { in: [...EXPIRABLE_STATUSES] }, expiresAt: { lte: at } }
      ]
    }
  if (EXPIRABLE_STATUSES.includes(raw))
    return { status: raw, OR: [{ expiresAt: null }, { expiresAt: { gt: at } }] }
  return { status: raw }
}

/** یک سطل تفکیک وضعیت/نوع در داشبورد (§۱۵). */
export interface CreditStatusBucket {
  status: string
  count: number
  amount: number
  usedAmount: number
}

/**
 * §۲/§۱۵ — جابه‌جا کردن سطل‌ها: هر ردیفِ ACTIVE/PARTIALLY_USED/DRAFTِ
 * تاریخ‌گذشته از سطل خودش کم و به سطل EXPIRED اضافه می‌شود.
 *
 * `all` = groupBy روی کل بازه · `expiring` = همان groupBy با شرط
 * `expiresAt <= now`. جمع تعداد/مبلغ عوض نمی‌شود، فقط جای درستش را پیدا می‌کند.
 */
export function rollExpiredBuckets(
  all: CreditStatusBucket[],
  expiring: CreditStatusBucket[]
): CreditStatusBucket[] {
  const int = (v: unknown): number => {
    const n = Math.round(Number(v) || 0)
    return Number.isFinite(n) ? n : 0
  }
  const map = new Map<string, CreditStatusBucket>()
  const bucket = (status: string): CreditStatusBucket => {
    const key = String(status)
    const found = map.get(key)
    if (found) return found
    const fresh = { status: key, count: 0, amount: 0, usedAmount: 0 }
    map.set(key, fresh)
    return fresh
  }
  for (const row of all ?? []) {
    const b = bucket(String(row?.status ?? ''))
    b.count += int(row?.count)
    b.amount += int(row?.amount)
    b.usedAmount += int(row?.usedAmount)
  }
  for (const row of expiring ?? []) {
    const from = String(row?.status ?? '')
    if (!EXPIRABLE_STATUSES.includes(from)) continue
    const src = bucket(from)
    const dst = bucket(CreditStatus.EXPIRED)
    const count = Math.min(src.count, int(row?.count))
    const amount = Math.min(src.amount, int(row?.amount))
    const usedAmount = Math.min(src.usedAmount, int(row?.usedAmount))
    src.count -= count
    src.amount -= amount
    src.usedAmount -= usedAmount
    dst.count += count
    dst.amount += amount
    dst.usedAmount += usedAmount
  }
  const order = Object.keys(CREDIT_TRANSITIONS)
  return [...map.values()]
    .filter((b) => b.count > 0 || b.amount > 0)
    .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status))
}

/**
 * §۱۱ — Transition های مجاز *فقط* در عملیات «برگشت مصرف» (برگشت/ابطال/حذف فاکتور).
 *
 * چرا یک جدول جدا و نه `CREDIT_TRANSITIONS`؟ چون `USED ⇒ ACTIVE` در جدول
 * عادی ممنوع است (و باید ممنوع بماند: هیچ مدیری نباید یک اعتبار مصرف‌شده را
 * دستی «فعال» کند)، ولی وقتی *فاکتورِ مصرف* حذف/برگشت می‌شود، همان اعتبار
 * واقعاً باید برگردد. پس مجوز به خودِ عملیات داده می‌شود، نه به کاربر.
 *
 * دو استثنای عمدی:
 *   • `CANCELED` پایانی است — ابطال با برگشت فاکتور زنده نمی‌شود.
 *   • `SUSPENDED` دست مدیر است — مبلغ برمی‌گردد ولی تعلیق برداشته نمی‌شود.
 */
export const CREDIT_REVERSAL_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: [],
  ACTIVE: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.EXPIRED],
  PARTIALLY_USED: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.EXPIRED],
  USED: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.EXPIRED],
  EXPIRED: [CreditStatus.ACTIVE, CreditStatus.PARTIALLY_USED, CreditStatus.EXPIRED],
  SUSPENDED: [CreditStatus.SUSPENDED],
  CANCELED: []
}

export function canReverseTransition(from: string, to: string): boolean {
  if (from === to) return true
  return (CREDIT_REVERSAL_TRANSITIONS[String(from)] ?? []).includes(String(to))
}

export interface ReversalPlan {
  /** مبلغ مصرف‌شده‌ی بعد از برگشت */
  usedAmount: number
  /** دفعات مصرف بعد از برگشت */
  usedCount: number
  /** وضعیتی که *واقعاً* باید نوشته شود */
  status: string
  /** وضعیت پیشنهادیِ قبل از اعتبارسنجی Transition */
  proposed: string
  /** اگر Transition مجاز نبود: دلیل فارسی + وضعیت دست‌نخورده می‌ماند */
  blocked: string | null
}

/**
 * §۸ و §۱۱ — «برگشت یک مصرف» چه چیزی روی رکورد می‌نویسد.
 *
 * تا جلسه ۲۸، `reverseInvoiceRedemptions` وضعیت را **مستقیم** می‌نوشت و هیچ
 * اعتبارسنجی Transition نداشت (تنها استثنایش یک `if` دستی برای CANCELED بود).
 * حالا تصمیم یک‌جا گرفته می‌شود، قابل تست است، و اگر Transition مجاز نبود
 * وضعیت دست نمی‌خورد و دلیلش به AuditLog می‌رود (نه اینکه بی‌صدا رد شود).
 */
export function planRedemptionReversal(
  c: CreditCore,
  amount: unknown,
  now: Date | number = Date.now()
): ReversalPlan {
  const int = (v: unknown): number => {
    const n = Math.round(Number(v) || 0)
    return Number.isFinite(n) ? n : 0
  }
  const raw = String(c?.status ?? CreditStatus.ACTIVE)
  const usedAmount = Math.max(0, int(c?.usedAmount) - Math.max(0, int(amount)))
  const usedCount = Math.max(0, int(c?.usedCount) - 1)
  const proposed =
    usedCount <= 0
      ? isExpiredAt({ ...c, amount: int(c?.amount), status: raw }, now)
        ? CreditStatus.EXPIRED
        : CreditStatus.ACTIVE
      : CreditStatus.PARTIALLY_USED
  if (canReverseTransition(raw, proposed)) return { usedAmount, usedCount, status: proposed, proposed, blocked: null }
  return {
    usedAmount,
    usedCount,
    status: raw,
    proposed,
    blocked:
      `وضعیت «${CREDIT_STATUS_LABELS[raw] ?? raw}» با برگشت فاکتور عوض نمی‌شود؛ ` +
      `مبلغ و دفعات برگشت خورد ولی وضعیت همان «${CREDIT_STATUS_LABELS[raw] ?? raw}» ماند.`
  }
}

/**
 * §۱۹ — `source` بعد از صدور **تغییرناپذیر** است.
 *
 * ریسک واقعی که ممیزی جلسه ۲۷ پیدا کرد: قواعد (مدت/دفعات) در *لحظه‌ی صدور* از
 * نوع اعتبار خوانده و روی رکورد ذخیره می‌شوند. پس اگر بعداً `source` یک رکورد
 * MANUAL به EXCHANGE تغییر کند، رکورد با قواعد سخاوتمندانه‌ی MANUAL باقی
 * می‌ماند ولی خودش را «تعویض کالا» جا می‌زند — یعنی دور زدن §۳ بدون هیچ ردی.
 */
export function sourceChangeError(current: unknown, next: unknown): string | null {
  if (next === undefined || next === null || String(next).trim() === '') return null
  const from = normalizeCreditSource(current)
  const to = normalizeCreditSource(next)
  if (from === to) return null
  return (
    `نوع اعتبار («${CREDIT_SOURCE_LABELS[from] ?? from}») بعد از صدور قابل تغییر نیست. ` +
    'قواعد مدت و دفعات در همان لحظه‌ی صدور از روی نوع ذخیره شده‌اند، پس تغییر نوع یعنی دور زدن آن قواعد. ' +
    'اگر نوع اشتباه صادر شده، همین اعتبار را باطل کنید و اعتبار تازه‌ای با نوع درست صادر کنید.'
  )
}

/**
 * §۳ — مدت اعتبارِ مسیر تعویض/برگشت.
 *
 * مسیرهای تاریخی `SalesService` همیشه `defaults.returnCodeDays` (تنظیمات
 * «کد برگشت») را می‌فرستادند و همین ورودی، پیش‌فرض `types.EXCHANGE.days`
 * تنظیمات اعتبار را دور می‌زد — یعنی تنظیم صریحِ کاربر بی‌اثر بود.
 *
 * ترتیب اولویت (قطعی):
 *   ۱) مقدار صریح همان تراکنش (`input.creditDays`) — حتی `null` (بدون انقضا).
 *   ۲) تنظیمات اعتبار خرید، نوع EXCHANGE ⇒ `undefined` برمی‌گردد تا
 *      `resolveRules` خودش از تنظیمات بخواند (پس یک عدد در دو جا کپی نمی‌شود).
 *   ۳) فقط اگر تنظیمات اعتبار خوانده نشد: همان `returnCodeDays` قدیمی.
 */
export function exchangeCreditDays(input: {
  explicit?: number | null
  exchangeDays?: number | null
  returnCodeDays?: number | null
}): number | null | undefined {
  if (input.explicit !== undefined) return input.explicit
  // ⚠️ `null`/`undefined` یعنی «تنظیمات خوانده نشد»، نه «صفر روز» — و Number(null) صفر است
  const days = input.exchangeDays == null ? Number.NaN : Number(input.exchangeDays)
  if (Number.isFinite(days) && days >= 0) return undefined
  const legacy = Number(input.returnCodeDays)
  return Number.isFinite(legacy) && legacy > 0 ? Math.round(legacy) : undefined
}

/**
 * §۱۳ — «نسخه‌ی مجدد» برای `copies > 1`.
 *
 * باگ: `printCredit` همان یک HTML را N بار به چاپگر می‌داد و `markPrinted` را
 * *یک بار* صدا می‌زد. پس چاپ سه‌نسخه‌ای، سه کاغذِ «اصل» بیرون می‌داد و لاگ هم
 * یک نسخه ثبت می‌کرد. این تابع تصمیم می‌گیرد هر کاغذ چه شماره و چه برچسبی دارد.
 */
export interface CreditCopyPlan {
  /** چندمین کاغذ همین درخواست (از ۱) */
  copy: number
  /** شماره‌ی چاپ روی همان کاغذ */
  printCount: number
  /** برچسب «نسخه‌ی مجدد» بخورد؟ */
  reprint: boolean
}

export function creditCopyPlan(prevPrintCount: unknown, copies: unknown, max = 5): CreditCopyPlan[] {
  const prev = Math.max(0, Math.round(Number(prevPrintCount) || 0))
  const want = Math.min(Math.max(Math.round(Number(copies) || 1), 1), Math.max(1, Math.round(max)))
  const out: CreditCopyPlan[] = []
  // آستانه‌ی «نسخه‌ی مجدد» یک جا تعریف شده است (بخش ۹.۲) و همین‌جا هم از همان می‌آید.
  for (let i = 0; i < want; i++) out.push({ copy: i + 1, printCount: prev + i + 1, reprint: isCreditReprint(prev + i) })
  return out
}

/**
 * §۱۰ — کدام ردیف AuditLog حق حذف‌شدن در «سبک‌سازی» را ندارد.
 *
 * ممیزی: مسیر `MaintenanceService` می‌توانست کل تاریخ اعتبار را بدون رمز مدیر
 * پاک کند (`DELETE FROM AuditLog WHERE at < ?`) و Timeline صفحه‌ی جزئیات —
 * که تنها سند مالی این ماژول است — خالی شود. این تابع تعریف «سابقه‌ی
 * محافظت‌شده» است و هم در SQL پاک‌سازی، هم در پیش‌نمایش آن استفاده می‌شود تا
 * عددِ پیش‌نمایش با واقعیت یکی باشد.
 */
export const AUDIT_PROTECTED_ENTITIES: readonly string[] = [
  'StoreCredit',
  'StoreCreditBatch',
  'StoreCreditRedemption'
]

export function isProtectedAuditRow(entity: unknown, action: unknown): boolean {
  const e = String(entity ?? '').trim()
  if (AUDIT_PROTECTED_ENTITIES.includes(e)) return true
  const a = String(action ?? '').trim().toUpperCase()
  return a.startsWith('CREDIT_') || a.startsWith('STORE_CREDIT_')
}

/**
 * §۱۶ — «جست‌وجو» دقیقاً چه چیزهایی را هدف می‌گیرد.
 *
 * تا جلسه ۲۸ جست‌وجو فقط کد/نام/شرکت/تلفن/شناسه ملی/توضیح بود، ولی placeholder
 * فیلد جست‌وجوی UI شناسه‌ی اعتبار و شماره فاکتور/فیش را هم *وعده* می‌داد. این
 * تابع تصمیم می‌گیرد یک عبارت ورودی، کدام فیلدها را فعال می‌کند — پس هم سرویس
 * و هم متن placeholder از یک منبع می‌آیند و هیچ‌وقت از هم جدا نمی‌شوند.
 */
export interface CreditSearchPlan {
  /** عبارت خام (trim شده) */
  raw: string
  /** کد نرمال‌شده (لاتین، بزرگ، بی‌فاصله) — خالی یعنی «شبیه کد نیست» */
  code: string
  /** عددِ خالص: شناسه اعتبار / شماره مشتری / شماره فاکتور و فیش */
  numeric: number | null
  /** متن آزاد برای نام/شرکت/تلفن/شناسه ملی/توضیح */
  text: string
  /** فیلدهای هدف، به همان ترتیبی که در `where` می‌نشینند (برای تست و برای UI) */
  fields: string[]
}

export const CREDIT_SEARCH_FIELDS: readonly string[] = [
  'code',
  'legacyCode',
  'id',
  'customerId',
  'receiptNo',
  'customerName',
  'holderCompany',
  'holderPhone',
  'holderNationalId',
  'note'
]

export function creditSearchPlan(raw: unknown): CreditSearchPlan {
  const text = String(raw ?? '').trim()
  const code = normalizeCreditCode(text)
  const digits = code.replace(/[^0-9]/g, '')
  const numeric = digits.length > 0 && digits.length <= 15 && digits === code ? Number(digits) : null
  const fields: string[] = []
  if (code) fields.push('code', 'legacyCode')
  if (numeric != null && numeric > 0) fields.push('id', 'customerId', 'receiptNo')
  if (text) fields.push('customerName', 'holderCompany', 'holderPhone', 'holderNationalId', 'note')
  return { raw: text, code, numeric: numeric != null && numeric > 0 ? numeric : null, text, fields }
}

// ---------------------------------------------------------------------------
// ۹.۱) جلسه ۳۰ — قواعدی که مصرف‌کننده‌شان همین نشست به سرویس وصل شد
//      (§۶ صدور تکی · §۲/§۱۵ داشبورد و فیلتر · §۱۶ جست‌وجوی دومرحله‌ای ·
//       §۱۰ محافظت AuditLog در خودِ SQL · §۱۲ کامل بودن snapshot گیرنده)
// ---------------------------------------------------------------------------

/**
 * ادامه‌ی همان بخش ۹ است و با همان قاعده: قاعده‌ی مالی/امنیتی اینجا می‌نشیند و
 * سرویس main تنها اعمال‌کننده‌اش است. تفاوت جلسه ۳۰ با ۲۹ این است که آن نشست
 * *تصمیم* را نوشت و این نشست آن را در مسیر واقعی مصرف کرد؛ چیزهایی که برای
 * همان مصرف لازم شدند (و خودشان تصمیم‌اند) اینجا اضافه می‌شوند تا هیچ‌کدام در
 * سرویس یا JSX جا خوش نکنند. تستشان در `test/credit-ui-logic-session30.ts`.
 */

/**
 * §۶ — پیش‌سنجش فضای کد در *صدور تکی* کِی باید اجرا شود؟
 *
 * مسیر گروهی کدها را از قبل یک‌جا می‌سازد و همان‌جا `assertCodeSpace` را یک بار
 * صدا زده است؛ اگر `issueStoreCredit` برای هر ردیف دوباره پیش‌سنجش کند، هم
 * `COUNT(*)` بی‌دلیل تکرار می‌شود و هم ممکن است وسط یک دسته‌ی نیمه‌ساخته
 * عملیات را رد کند (یعنی همان «دسته‌ی نصفه»ای که جلسه ۲۹ حذفش کرد).
 * پس قاعده: کدِ آماده ⇒ بدون پیش‌سنجش.
 */
export function needsCodeSpaceCheck(presetCode: unknown): boolean {
  return String(presetCode ?? '').trim().length === 0
}

export interface CodeGrowth {
  grown: boolean
  from: number
  to: number
}

/**
 * §۶ — «افزایش خودکار طول کد» در صدور تکی هم باید *دیده* شود.
 *
 * مسیر گروهی رشد طول را در `StoreCreditBatch.lengthGrown` و AuditLog می‌نویسد؛
 * صدور تکی هیچ جایی برای نوشتنش ندارد جز note همان ردیف AuditLog صدور. این
 * تابع فقط «آیا رشدی رخ داد و از چند به چند» را تصمیم می‌گیرد تا متن لاگ در دو
 * مسیر از یک منبع بیاید.
 */
export function codeGrowthOf(requested: unknown, used: unknown): CodeGrowth {
  const from = Math.round(Number(requested) || 0)
  const to = Math.round(Number(used) || 0)
  if (!(from > 0) || !(to > 0)) return { grown: false, from: Math.max(0, from), to: Math.max(0, to) }
  return { grown: to > from, from, to }
}

/**
 * §۲/§۱۵ — یک قطعه‌ی `where` تازه **در `AND` می‌نشیند، نه در `OR`**.
 *
 * باگ واقعی که این تابع جلویش را می‌گیرد: `whereFromFilter` برای جست‌وجو یک
 * `where.OR` می‌سازد. اگر شرط «وضعیت مؤثر» (که خودش `OR` دارد) مستقیم روی
 * همان شیء ریخته شود، `OR`ِ جست‌وجو رونویسی می‌شود و فیلتر وضعیت عملاً به
 * «یا این وضعیت یا آن متن» تبدیل می‌گردد — یعنی ردیف‌هایی که نباید، برمی‌گردند.
 * پس هر شرط ترکیبی از این در رد می‌شود.
 */
export function withAndClause<T extends Record<string, any>>(
  where: T,
  clause: Record<string, any> | null | undefined
): T {
  if (!clause || Object.keys(clause).length === 0) return where
  const out: any = { ...(where ?? {}) }
  const prev = out.AND
  out.AND = Array.isArray(prev) ? [...prev, clause] : prev ? [prev, clause] : [clause]
  return out as T
}

/** ستون‌های فاکتوریِ `StoreCredit` که شماره فیش می‌تواند از آن‌ها بیاید (§۱۶). */
export const CREDIT_SEARCH_INVOICE_COLUMNS: readonly string[] = [
  'sourceInvoiceId',
  'exchangeInvoiceId',
  'usedInvoiceId'
]

/** نتیجه‌ی مرحله‌ی دومِ جست‌وجو (§۱۶) — idهایی که با کوئری کمکی پیدا شدند. */
export interface CreditSearchMatches {
  /** `StoreCredit.id`هایی که از دفتر مصرف (شماره فیش/فاکتور) پیدا شدند */
  creditIds?: unknown
  /** `SaleInvoice.id`هایی که شماره فیششان با عبارت خورد */
  invoiceIds?: unknown
}

/**
 * §۱۶ — از یک `CreditSearchPlan` (و idهای مرحله‌ی دوم) آرایه‌ی `OR` می‌سازد.
 *
 * چرا دومرحله‌ای: بین `StoreCredit` و `StoreCreditRedemption` هیچ relation
 * پریزمایی نیست (هر دو فقط ستون scalar دارند)، پس «شماره فاکتور/فیش» با یک
 * `where` تودرتو قابل بیان نیست. مرحله‌ی اول idها را می‌دهد و این تابع تصمیم
 * می‌گیرد آن idها به کدام ستون‌ها بخورند — تصمیمی که اگر در سرویس می‌ماند،
 * هیچ تستی جابه‌جا‌شدنش را نمی‌فهمید.
 *
 * ⚠️ `usedReceiptNo` مستقیم روی خودِ اعتبار است (snapshot لحظه‌ی مصرف)، پس
 * عبارت عددی بدون هیچ کوئری کمکی هم آن را می‌گیرد.
 */
export function creditSearchWhere(plan: CreditSearchPlan, matches: CreditSearchMatches = {}): Record<string, any>[] {
  const or: Record<string, any>[] = []
  if (!plan || !plan.raw) return or
  if (plan.code) or.push({ code: { contains: plan.code } }, { legacyCode: { contains: plan.code } })
  if (plan.numeric != null && plan.numeric > 0)
    or.push({ id: plan.numeric }, { customerId: plan.numeric }, { usedReceiptNo: plan.numeric })
  const creditIds = parseIdList(matches.creditIds)
  if (creditIds.length) or.push({ id: { in: creditIds } })
  const invoiceIds = parseIdList(matches.invoiceIds)
  if (invoiceIds.length) for (const col of CREDIT_SEARCH_INVOICE_COLUMNS) or.push({ [col]: { in: invoiceIds } })
  if (plan.text)
    or.push(
      { customerName: { contains: plan.text } },
      { holderCompany: { contains: plan.text } },
      { holderPhone: { contains: plan.text } },
      { holderNationalId: { contains: plan.text } },
      { note: { contains: plan.text } }
    )
  return or
}

/**
 * §۱۲ — کل «هویت دارنده» در یک snapshot.
 *
 * ممیزی جلسه ۲۷ پیدا کرد که `before`ِ «تغییر گیرنده» فقط ۵ فیلد را می‌نوشت، پس
 * عوض شدن شناسه ملی/آدرس/نماینده/توضیح/عدم‌تمایل به پیام **هیچ ردی** نداشت و
 * سند مالی این ماژول (Timeline) نمی‌توانست بگوید قبلش چه بود. یک فهرست، یک
 * تابع، و هر دو سرِ لاگ (`before`/`after`) از همان می‌آیند تا دوباره واگرا نشوند.
 */
export const HOLDER_AUDIT_FIELDS: readonly string[] = [
  'customerId',
  'customerName',
  'customerLocked',
  'holderCompany',
  'holderNationalId',
  'holderPhone',
  'holderAddress',
  'holderAgent',
  'holderNote',
  'reminderOptOut'
]

const HOLDER_BOOLEAN_FIELDS: readonly string[] = ['customerLocked', 'reminderOptOut']

/** برچسب فارسی هر فیلد دارنده — تا note همان AuditLog بگوید *چه چیزی* عوض شد (§۱۲). */
export const HOLDER_FIELD_LABELS: Record<string, string> = {
  customerId: 'مشتری',
  customerName: 'نام دارنده',
  customerLocked: 'قفل روی همان مشتری',
  holderCompany: 'شرکت/سازمان',
  holderNationalId: 'شناسه ملی',
  holderPhone: 'تلفن',
  holderAddress: 'آدرس',
  holderAgent: 'نماینده',
  holderNote: 'توضیح دارنده',
  reminderOptOut: 'عدم تمایل به یادآوری'
}

export function holderSnapshot(row: Record<string, any> | null | undefined): Record<string, any> {
  const src = (row ?? {}) as Record<string, any>
  const out: Record<string, any> = {}
  for (const f of HOLDER_AUDIT_FIELDS) out[f] = HOLDER_BOOLEAN_FIELDS.includes(f) ? src[f] === true : (src[f] ?? null)
  return out
}

/** پیشوندهای action که «سابقه‌ی اعتبار» شمرده می‌شوند (§۱۰). */
export const AUDIT_PROTECTED_ACTION_PREFIXES: readonly string[] = ['CREDIT_', 'STORE_CREDIT_']

export interface SqlFragment {
  sql: string
  params: unknown[]
}

/**
 * §۱۰ — همان `isProtectedAuditRow`، این بار به زبان SQL.
 *
 * چرا لازم شد: پاک‌سازی لاگ یک `DELETE ... WHERE at < ?` خام است و هیچ‌وقت از
 * JS رد نمی‌شود، پس تعریف «ردیف محافظت‌شده» باید *دو نسخه* داشته باشد. اگر آن
 * دو نسخه دستی نوشته شوند، روزی یکی‌شان عوض می‌شود و پیش‌نمایش با واقعیت
 * فرق می‌کند (کاربر می‌بیند ۱۰۰۰ ردیف پاک می‌شود و ۸۰۰ پاک می‌گردد یا بدتر،
 * برعکس). پس هر دو از همین دو ثابت (`AUDIT_PROTECTED_ENTITIES` و
 * `AUDIT_PROTECTED_ACTION_PREFIXES`) ساخته می‌شوند و سوییت جلسه ۳۰ خروجی این
 * SQL را روی یک SQLite واقعی با خروجی تابع JS مقایسه می‌کند.
 *
 * ⚠️ عمداً `LIKE 'CREDIT\_%'` استفاده نشده: در SQL کاراکتر `_` خودش wildcard
 * است و بدون `ESCAPE` یک action مثل `CREDITX...` را هم می‌گرفت. `SUBSTR` هم
 * سریع‌تر است و هم دقیقاً معنیِ `startsWith` را می‌دهد.
 */
export function auditProtectedSql(entityCol = '"entity"', actionCol = '"action"'): SqlFragment {
  const params: unknown[] = []
  const parts: string[] = []
  parts.push(`TRIM(${entityCol}) IN (${AUDIT_PROTECTED_ENTITIES.map(() => '?').join(', ')})`)
  params.push(...AUDIT_PROTECTED_ENTITIES)
  for (const prefix of AUDIT_PROTECTED_ACTION_PREFIXES) {
    parts.push(`UPPER(SUBSTR(TRIM(${actionCol}), 1, ${prefix.length})) = ?`)
    params.push(prefix)
  }
  return { sql: `(${parts.join(' OR ')})`, params }
}

/** همان شرط، نقیض‌شده: «این ردیف حق پاک‌شدن دارد» (§۱۰). */
export function auditPurgeableSql(entityCol = '"entity"', actionCol = '"action"'): SqlFragment {
  const p = auditProtectedSql(entityCol, actionCol)
  return { sql: `NOT ${p.sql}`, params: p.params }
}

// ---------------------------------------------------------------------------
// ۹.۲) جلسه ۳۳ — «نسخه‌ی مجدد» یک تصمیم است، نه یک مقایسه‌ی تکراری (§۱۳ · §۱۰)
//
// آستانه‌ی «این کاغذ نسخه‌ی مجدد است» در پنج نقطه دستی نوشته شده بود:
// `creditCopyPlan` (`prev + i >= 1`)، `PrintService` (`c.printCount >= 1`)،
// `markPrinted` (`next >= 2`)، شمارشِ `reprints` در `markPrintedMany`
// (`printCount >= 1`) و انتخاب عملِ AuditLog در همان تابع (`prev >= 1`).
// هر پنج‌تا یک چیز می‌گویند و هیچ تستی اجرایشان نمی‌کرد؛ اگر روزی یکی‌شان
// `>= 2` می‌شد، کاغذ برچسب «اصل» می‌گرفت ولی لاگش «چاپ مجدد» می‌ماند — و این
// دقیقاً همان سندی است که سرِ اختلاف با مشتری رو می‌شود.
//
// نام عمل به‌صورت *کلید* برگردانده می‌شود (نه مقدار `AuditAction`) چون این فایل
// عمداً به `shared/enums.ts` وابسته نیست؛ سرویس `AuditAction[key]` می‌زند و
// سوییت جلسه ۳۳ وجود هر دو کلید را در `enums.ts` واقعی می‌سنجد.
// ---------------------------------------------------------------------------

/** آستانه‌ی برچسب «نسخه‌ی مجدد»: از کاغذ *دوم* به بعد. */
export const CREDIT_REPRINT_AFTER = 1

/** با این شمارنده‌ی *قبلی*، کاغذ بعدی نسخه‌ی مجدد است؟ */
export function isCreditReprint(prevPrintCount: unknown): boolean {
  return Math.max(0, Math.round(Number(prevPrintCount) || 0)) >= CREDIT_REPRINT_AFTER
}

/** عملِ AuditLog همان چاپ — کلیدِ `AuditAction`، نه مقدارش. */
export function creditPrintAction(prevPrintCount: unknown): 'CREDIT_PRINT' | 'CREDIT_REPRINT' {
  return isCreditReprint(prevPrintCount) ? 'CREDIT_REPRINT' : 'CREDIT_PRINT'
}

/** چند تا از این شمارنده‌های قبلی، نسخه‌ی مجدد می‌شوند (لاگ چاپ گروهی). */
export function creditReprintCount(prevPrintCounts: unknown): number {
  if (!Array.isArray(prevPrintCounts)) return 0
  return prevPrintCounts.filter((n) => isCreditReprint(n)).length
}

// ---------------------------------------------------------------------------
// ۹.۳) جلسه ۳۴ — «یک کاغذ بیرون آمد» چه چیزی در دیتابیس و در AuditLog می‌نویسد
//
// بخش ۹.۲ آستانه‌ی «نسخه‌ی مجدد» را یکی کرد، ولی *بقیه‌ی* تصمیم‌های همین مسیر
// هنوز داخل `PrintService`/`StoreCreditService` گیر بودند و هارنس ۲۵ مجبور بود
// بندهای ۷ تا ۱۴ و ۱۷ را با regex روی متن سرویس بسنجد (STRUCTURAL) — یعنی
// جابه‌جا شدن یک کلید در شیء `after` یا عوض شدن موجودیت لاگ از `StoreCredit` به
// `StoreCreditBatch` هیچ‌وقت لو نمی‌رفت، چون این محیط نه Electron دارد نه Prisma.
//
// چیزهایی که اینجا آمدند و *چرا قاعده‌اند، نه نمایش*:
//   • «این چاپ باید شمرده شود یا نه» (`creditShouldMarkPrinted`) — پایه‌ی
//     ضدتقلبِ §۲۴: اگر خاموش بماند، از یک اعتبار بی‌نهایت «اصل» درمی‌آید.
//   • «ردیف لاگ روی خودِ اعتبار می‌نشیند یا روی دسته» (`creditPrintAudit` /
//     `creditBatchPrintAudit`) — §۱۰: Timeline جزئیاتِ هر اعتبار باید چاپ
//     گروهی را هم ببیند، وگرنه سندِ اختلاف با مشتری نصفه است.
//   • «لغو پنجره‌ی ذخیره = هیچ فایلی، هیچ شمارشی، هیچ لاگی»
//     (`creditPdfSaveOutcome` + `creditPdfMarkPlan`).
//
// این فایل عمداً به `shared/enums.ts` و به `jalali.ts` وابسته نیست: عملِ لاگ
// به‌صورت *کلید* برمی‌گردد و هر جا رقم فارسی لازم است، قالب‌گر (`fa`) تزریق
// می‌شود (همان الگوی `fillPlaceholders`).
// ---------------------------------------------------------------------------

export const CreditPrintChannel = { PRINT: 'PRINT', PDF: 'PDF' } as const
export type CreditPrintChannel = (typeof CreditPrintChannel)[keyof typeof CreditPrintChannel]

export const CREDIT_PRINT_CHANNELS: readonly CreditPrintChannel[] = [CreditPrintChannel.PRINT, CreditPrintChannel.PDF]

/** کانال ناشناس = کاغذ (رفتار تاریخی)، چون فقط PDF صریح فایل می‌سازد. */
export function creditPrintChannel(raw: unknown): CreditPrintChannel {
  return String(raw ?? '').trim().toUpperCase() === CreditPrintChannel.PDF ? CreditPrintChannel.PDF : CreditPrintChannel.PRINT
}

/** عنوان بلندِ همین کانال در متن لاگِ سند تکی. */
export const CREDIT_PRINT_CHANNEL_TITLES: Record<CreditPrintChannel, string> = {
  PRINT: 'چاپ سند اعتبار',
  PDF: 'خروجی PDF سند اعتبار'
}

/** عنوان کوتاه، برای متن‌های گروهی («چاپ گروهی…» / «خروجی PDF گروهی…»). */
export const CREDIT_PRINT_CHANNEL_LABELS: Record<CreditPrintChannel, string> = {
  PRINT: 'چاپ',
  PDF: 'خروجی PDF'
}

/** برچسبی که از کاغذ دوم به بعد در لاگ و روی صفحه دیده می‌شود. */
export const CREDIT_REPRINT_LABEL = 'نسخه‌ی مجدد'
export const CREDIT_REPRINT_NOTE = `(${CREDIT_REPRINT_LABEL})`

/**
 * `markPrinted` در هر سه مسیر (تکی، گروهی، PDF) **پیش‌فرض روشن** است و فقط
 * `false`ِ صریح خاموشش می‌کند. تا جلسه ۳۳ همین شرط سه بار دستی نوشته شده بود
 * (`input.markPrinted !== false` در دو مسیر و `input?.markPrinted === false` در
 * یکی) و هارنس فقط متنش را می‌دید.
 */
export function creditShouldMarkPrinted(flag: unknown): boolean {
  return flag !== false
}

/** خروجیِ «شمارنده دست نخورد» — یک شیء، نه دو صفرِ دستی در دو مسیر. */
export const CREDIT_MARK_PRINTED_NONE: { marked: number; reprints: number } = { marked: 0, reprints: 0 }

/** موجودیتِ AuditLog هر چاپ — هر دو، نام مدل *واقعی* Prisma هستند. */
export const CREDIT_PRINT_ENTITIES = { credit: 'StoreCredit', batch: 'StoreCreditBatch' } as const
export type CreditPrintScope = keyof typeof CREDIT_PRINT_ENTITIES

/** سند تکی ⇒ خودِ اعتبار · مسیر دسته‌ای بدون شمارش ⇒ دسته. */
export function creditPrintAuditEntity(scope: CreditPrintScope): string {
  return CREDIT_PRINT_ENTITIES[scope] ?? CREDIT_PRINT_ENTITIES.credit
}

export interface CreditAuditDescriptor {
  /** کلیدِ `AuditAction` (نه مقدارش) — سرویس `AuditAction[key]` می‌زند. */
  action: 'CREDIT_PRINT' | 'CREDIT_REPRINT'
  entity: string
  entityId: number | null
  before?: string
  after: string
  note: string
}

const intOrNull = (v: unknown): number | null => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n !== 0 ? n : null
}

/**
 * ردیف AuditLog **یک کاغذ روی خودِ اعتبار** (§۱۰ · §۱۳).
 *
 * `group: true` مسیر گروهی است: همان ردیف، به‌علاوه‌ی `batchId` در `after` و
 * متنِ «گروهی» — تا Timeline جزئیاتِ یک اعتبار بفهمد این کاغذ از دل یک دسته
 * بیرون آمده است.
 */
export function creditPrintAudit(
  input: {
    entityId: number | null
    code?: unknown
    prev: unknown
    channel?: unknown
    group?: boolean
    batchId?: number | null
    file?: string | null
  },
  fa: (v: string | number) => string = String
): CreditAuditDescriptor {
  const prev = Math.max(0, Math.round(Number(input.prev) || 0))
  const channel = creditPrintChannel(input.channel)
  const next = prev + 1
  const file = input.file ?? null
  const batchId = intOrNull(input.batchId)
  const after: Record<string, unknown> = { printCount: next, channel }
  if (input.group === true) after.batchId = batchId
  after.file = file
  return {
    action: creditPrintAction(prev),
    entity: CREDIT_PRINT_ENTITIES.credit,
    entityId: intOrNull(input.entityId),
    before: JSON.stringify({ printCount: prev }),
    after: JSON.stringify(after),
    note: creditPrintNote(input, fa)
  }
}

/** متنِ خوانای همان ردیف — تنها جایی که «نسخه‌ی چندم» نوشته می‌شود. */
export function creditPrintNote(
  input: { code?: unknown; prev: unknown; channel?: unknown; group?: boolean; batchId?: number | null; file?: string | null },
  fa: (v: string | number) => string = String
): string {
  const prev = Math.max(0, Math.round(Number(input.prev) || 0))
  const next = prev + 1
  const channel = creditPrintChannel(input.channel)
  const code = String(input.code ?? '')
  const reprint = isCreditReprint(prev)
  const batchId = intOrNull(input.batchId)
  if (input.group === true) {
    return (
      `${CREDIT_PRINT_CHANNEL_LABELS[channel]} گروهی سند اعتبار «${code}» — نسخه‌ی ${fa(next)}` +
      (reprint ? ` ${CREDIT_REPRINT_NOTE}` : '') +
      (batchId ? ` · دسته‌ی ${fa(batchId)}` : '')
    )
  }
  const what = CREDIT_PRINT_CHANNEL_TITLES[channel]
  return (
    (reprint ? `${what} «${code}» — نسخه‌ی ${fa(next)} ${CREDIT_REPRINT_NOTE}` : `${what} «${code}»`) +
    (input.file ? ` ⇒ ${input.file}` : '')
  )
}

/**
 * ردیف خلاصه روی **خودِ دسته** (یک ردیف، نه N ردیف) تا گزارش دسته‌ها هم قابل
 * پیگیری باشد. عملش همیشه `CREDIT_PRINT` است: «تولید گروهی اعتبار»
 * (`CREDIT_BULK_GENERATE`) عمل دیگری است و یک بار همین‌جا اشتباه نوشته شده بود.
 */
export function creditBatchPrintAudit(
  input: { batchId: number | null; count: unknown; reprints?: unknown; channel?: unknown; file?: string | null },
  fa: (v: string | number) => string = String
): CreditAuditDescriptor {
  const channel = creditPrintChannel(input.channel)
  const count = Math.max(0, Math.round(Number(input.count) || 0))
  const reprints = Math.max(0, Math.round(Number(input.reprints) || 0))
  const label = CREDIT_PRINT_CHANNEL_LABELS[channel]
  return {
    action: 'CREDIT_PRINT',
    entity: CREDIT_PRINT_ENTITIES.batch,
    entityId: intOrNull(input.batchId),
    after: JSON.stringify({ count, reprints, channel, file: input.file ?? null }),
    note:
      `${label} دسته‌ای ${fa(count)} سند اعتبار` +
      (reprints ? ` (${fa(reprints)} مورد نسخه‌ی مجدد)` : '')
  }
}

/**
 * PDFِ «بدون شمارش نسخه» (`markPrinted: false`): شمارنده دست نمی‌خورد، ولی
 * خودِ فایل باید در لاگ بماند (§۱۰) — و عملش هرگز `CREDIT_BULK_GENERATE` نیست.
 */
export function creditPdfAuditOnly(
  input: { single: boolean; id?: number | null; batchId?: number | null; count: unknown; file?: string | null },
  fa: (v: string | number) => string = String
): CreditAuditDescriptor {
  const count = Math.max(0, Math.round(Number(input.count) || 0))
  return {
    action: 'CREDIT_PRINT',
    entity: creditPrintAuditEntity(input.single ? 'credit' : 'batch'),
    entityId: intOrNull(input.single ? input.id : input.batchId),
    after: JSON.stringify({ pdf: true, count, file: input.file ?? null, markPrinted: false }),
    note: `${CREDIT_PRINT_CHANNEL_TITLES.PDF} (${fa(count)} سند) بدون شمارش نسخه ذخیره شد`
  }
}

/**
 * پنجره‌ی «ذخیره به‌عنوان»: Cancel یعنی **هیچ فایلی، هیچ شمارشی، هیچ لاگی**.
 * `dialog === null` یعنی مسیر بی‌پرسش (`ask: false`) و مسیر پیش‌فرض استفاده می‌شود.
 */
export function creditPdfSaveOutcome(
  dialog: { canceled?: boolean; filePath?: string | null } | null | undefined,
  fallback: string
): { saved: boolean; file: string | null } {
  if (dialog == null) return { saved: true, file: fallback }
  const file = String(dialog.filePath ?? '').trim()
  if (dialog.canceled === true || !file) return { saved: false, file: null }
  return { saved: true, file }
}

export type CreditMarkKind = 'single' | 'many' | 'auditOnly'

/** بعدِ ذخیره‌ی موفق PDF، کدام مسیرِ شمارش زده می‌شود. */
export function creditPdfMarkPlan(input: { single: boolean; markPrinted?: unknown }): {
  kind: CreditMarkKind
  channel: CreditPrintChannel
} {
  if (!creditShouldMarkPrinted(input.markPrinted)) return { kind: 'auditOnly', channel: CreditPrintChannel.PDF }
  return { kind: input.single ? 'single' : 'many', channel: CreditPrintChannel.PDF }
}

/**
 * چند بار باید رندر شود. جلسه ۲۴ برای PDF دسته‌ای **دو بار** کل دسته را
 * می‌خواند و می‌ساخت (یک بار برای HTML، یک بار فقط برای شمردن) — روی ۲۰۰۰ سند
 * یعنی دو برابر کارِ بی‌دلیل. عدد از همین‌جا می‌آید تا «یک بار» یک تصمیمِ
 * اجراشدنی باشد، نه یک عادتِ نوشتاری.
 */
export function creditPdfRenderPlan(single: boolean): { single: boolean; batchRenders: number } {
  return single ? { single: true, batchRenders: 0 } : { single: false, batchRenders: 1 }
}

/** خروجی مشترکِ چاپ گروهی: سقف‌خوردگی تا خودِ UI بالا می‌آید (§۲۱). */
export function creditPrintBatchResult(input: {
  ids: readonly number[]
  total: unknown
  capped: unknown
  marked?: { marked?: unknown; reprints?: unknown } | null
}): { ok: true; count: number; total: number; capped: boolean; marked: number; reprints: number } {
  const count = Array.isArray(input.ids) ? input.ids.length : 0
  const total = Math.max(0, Math.round(Number(input.total) || 0))
  return {
    ok: true,
    count,
    total: Math.max(total, count),
    capped: input.capped === true,
    marked: Math.max(0, Math.round(Number(input.marked?.marked) || 0)),
    reprints: Math.max(0, Math.round(Number(input.marked?.reprints) || 0))
  }
}

// ---------------------------------------------------------------------------
// ۹.۴) جلسه ۳۴ — هر نامی که این ماژول به Prisma می‌دهد، یک جا نوشته می‌شود
//
// ادامه‌ی مستقیم بندهای ۲۵ تا ۳۱ سوییت جلسه ۳۳: آنجا `where`ها با
// `prisma/schema.prisma` واقعی سنجیده شدند. اما `orderBy`، `select`، و کلیدهای
// `data` در `create`/`update` همچنان داخل سرویس تایپ می‌شدند و هیچ گزاره‌ای
// نمی‌دید. یک `orderBy: { issuedAt: 'asc' }` روی مدلی که ستونش `plannedAt`
// است، در Prisma یک خطای *زمان اجرا* است — و در این محیط هیچ‌وقت اجرا نمی‌شود.
//
// این بخش «تصمیم» تازه‌ای ندارد؛ **قرارداد** است: نام‌ها یک جا می‌نشینند و سوییت
// جلسه ۳۴ هر کدام را با مدل واقعیِ خودش در schema تطبیق می‌دهد.
// ---------------------------------------------------------------------------

/** ستون‌هایی که مسیر چاپ روی `StoreCredit` می‌نویسد. */
export const CREDIT_PRINT_WRITE_FIELDS: readonly string[] = ['printCount', 'lastPrintedAt']

/** حداقلِ داده‌ای که مسیر چاپ گروهی *قبل از* افزایش شمارنده لازم دارد. */
export const CREDIT_PRINT_SELECT = { id: true, code: true, printCount: true } as const

/** شمارنده‌ی یک ردیف: مقدار صریح (مسیر تکی، داخل تراکنش). */
export function creditPrintSetData(next: unknown, now: Date): { printCount: number; lastPrintedAt: Date } {
  return { printCount: Math.max(0, Math.round(Number(next) || 0)), lastPrintedAt: now }
}

/**
 * شمارنده‌ی N ردیف با `increment` (مسیر گروهی): خواندن-و-نوشتن نیست، پس دو
 * صندوقِ همزمان روی یک دسته هیچ نسخه‌ای را گم نمی‌کنند.
 */
export function creditPrintIncrementData(now: Date): { printCount: { increment: number }; lastPrintedAt: Date } {
  return { printCount: { increment: 1 }, lastPrintedAt: now }
}

/** `where` فهرستِ شناسه‌ها — همان یک شکل برای هر دو مسیر گروهی. */
export function creditIdsWhere(ids: readonly number[]): { id: { in: number[] } } {
  return { id: { in: [...ids] } } as { id: { in: number[] } }
}

/**
 * هر `orderBy`ِ این ماژول، با مدلی که رویش می‌نشیند.
 * ترتیب `id` عمدی است (نه `createdAt`): ردیف‌های همان لحظه هم ترتیب قطعی
 * داشته باشند، وگرنه صفحه‌بندی روی داده‌ی همزمان ردیف تکراری نشان می‌دهد.
 */
export const CREDIT_ORDER_BY = {
  codeLookup: { id: 'desc' },
  list: { id: 'desc' },
  batchRows: { id: 'asc' },
  batchList: { id: 'desc' },
  redemptions: { id: 'asc' },
  timeline: { id: 'asc' },
  reminderLogs: { id: 'desc' },
  reminderCandidates: { issuedAt: 'asc' }
} as const

/** همان کلیدها ⇒ نام مدل واقعیِ Prisma (سوییت با schema تطبیق می‌دهد). */
export const CREDIT_ORDER_BY_MODELS: Record<keyof typeof CREDIT_ORDER_BY, string> = {
  codeLookup: 'StoreCredit',
  list: 'StoreCredit',
  batchRows: 'StoreCredit',
  batchList: 'StoreCreditBatch',
  redemptions: 'StoreCreditRedemption',
  timeline: 'AuditLog',
  reminderLogs: 'CreditReminderLog',
  reminderCandidates: 'StoreCredit'
}

/** کلیدهای `data`ِ ثبت یک مصرف (§۴ · §۲۱) — دفتر مصرف روی همین نام‌ها بنا است. */
export const CREDIT_REDEMPTION_CREATE_FIELDS: readonly string[] = [
  'creditId',
  'code',
  'amount',
  'remainderAfter',
  'seq',
  'invoiceId',
  'receiptNo',
  'paymentId',
  'at',
  'atJalali',
  'atTime',
  'userId',
  'shiftId',
  'idempotencyKey',
  'note'
]

/** برگشتِ یک مصرف (§۸) — ردیف پاک نمی‌شود، علامت می‌خورد. */
export const CREDIT_REDEMPTION_REVERSE_FIELDS: readonly string[] = ['reversedAt', 'reversedReason']

/** ستون‌های دفتر مصرف که جست‌وجوی دومرحله‌ای §۱۶ رویشان می‌گردد. */
export const CREDIT_REDEMPTION_SEARCH_COLUMNS: readonly string[] = ['receiptNo', 'invoiceId']

/** ستون‌هایی که مسیرهای مصرف/برگشت در `where` صدا می‌زنند. */
export const CREDIT_REDEMPTION_KEY_COLUMNS: readonly string[] = ['idempotencyKey', 'creditId', 'invoiceId', 'reversedAt', 'paymentId']

/** کلیدهای `data`ِ ساختِ یک دسته‌ی تولید گروهی (§۵ · snapshot قواعد). */
export const CREDIT_BATCH_CREATE_FIELDS: readonly string[] = [
  'title',
  'source',
  'count',
  'amountEach',
  'totalAmount',
  'days',
  'maxUses',
  'multiUse',
  'codeLength',
  'prefix',
  'alphabet',
  'excludeSimilar',
  'lengthGrown',
  'restrictScope',
  'restrictCategoryIdsJson',
  'restrictVariantIdsJson',
  'minPurchase',
  'maxPerTransaction',
  'customerId',
  'customerName',
  'holderCompany',
  'userId',
  'createdAt',
  'createdAtJalali',
  'createdAtTime',
  'note'
]

/** بعدِ پایان تولید گروهی، فقط همین دو عدد روی دسته به‌روز می‌شوند. */
export const CREDIT_BATCH_TOTAL_FIELDS: readonly string[] = ['count', 'totalAmount']

/** کلیدهای `data`ِ یک ردیف لاگ یادآوری (§۱۴ — هیچ‌کدام «ارسال واقعی» نیست). */
export const CREDIT_REMINDER_LOG_CREATE_FIELDS: readonly string[] = [
  'creditId',
  'code',
  'kind',
  'status',
  'phone',
  'text',
  'placeholdersJson',
  'reason',
  'plannedAt',
  'sentAt',
  'atJalali',
  'atTime',
  'userId'
]

/** بعدِ ثبت یادآوری، این سه ستون روی خودِ اعتبار به‌روز می‌شوند. */
export const CREDIT_REMINDER_MARK_FIELDS: readonly string[] = ['reminderCount', 'lastReminderAt', 'lastReminderKind']

/** مدل‌هایی که این ماژول واقعاً صدا می‌زند (همه باید در schema باشند). */
export const CREDIT_PRISMA_MODELS: readonly string[] = [
  'StoreCredit',
  'StoreCreditRedemption',
  'StoreCreditBatch',
  'CreditReminderLog',
  'AuditLog'
]
