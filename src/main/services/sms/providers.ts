/**
 * ===========================================================================
 * آداپتورهای سرویس‌دهنده‌ی پیامک.
 *
 * قاعده‌ی این فایل:
 *   • هیچ آداپتوری منطق فروش/اعتبار/گزارش را نمی‌شناسد. ورودی‌اش «شماره + متن»
 *     است و خروجی‌اش یک نتیجه‌ی **استاندارد** که صف می‌فهمد.
 *   • هیچ آداپتوری داخل تراکنش مالی صدا زده نمی‌شود. صف همیشه بیرون از
 *     تراکنش کار می‌کند.
 *   • خطاها **نرمال‌سازی** می‌شوند: `retryable` تنها چیزی است که صف می‌بیند،
 *     نه متن خام سرویس‌دهنده.
 *
 * وضعیت امروز: سه آداپتور کامل‌اند — `LOG_ONLY` (بدون تماس شبکه) و دو
 * سرویس‌دهنده‌ی واقعی:
 *
 *   • sms.ir     → POST https://api.sms.ir/v1/send/bulk   (هدر X-API-KEY)
 *                  الگو: POST https://api.sms.ir/v1/send/verify
 *   • کاوه‌نگار   → GET  https://api.kavenegar.com/v1/{KEY}/sms/send.json
 *                  الگو: GET  .../verify/lookup.json
 *
 * هر دو آدرس، قرارداد رسمی خودِ سرویس‌دهنده است (مستندات sms.ir/rest-api و
 * apidocs.sms.ir و کلاینت‌های رسمی کاوه‌نگار). آدرس حدسی جایی نوشته نشده.
 * کاربر می‌تواند `baseUrl` را هم دستی عوض کند (پروکسی/داخل‌شبکه).
 *
 * ⚠️ سه نکته‌ی امنیتی/عملیاتی که عمدی است:
 *   ۱) اگر پیش‌نیازها کامل نباشند **هیچ تماس شبکه‌ای** انجام نمی‌شود.
 *   ۲) «مهلت» (timeout) نتیجه‌اش «نامعلوم» است نه «شکست» — ممکن است پیام
 *      پذیرفته شده باشد و باید از ارسال دوباره به مشتری پرهیز کرد.
 *   ۳) خطای «دست‌نیافتن به شبکه» (DNS/اتصال) **تلاش مجدد** می‌گیرد تا شرط
 *      «تأخیر مجاز، گم‌شدن هرگز» رعایت شود.
 * ===========================================================================
 */
import { normalizeSmsProviderKey, type SmsProviderKey } from '@shared/sms'

/** نتیجه‌ی استاندارد یک ارسال — تنها چیزی که صف می‌بیند. */
export interface SmsSendResult {
  /** سرویس‌دهنده پیام را **پذیرفت** (نه اینکه به گوشی رسیده باشد) */
  accepted: boolean
  providerMessageId: string | null
  /** شکست موقت ⇒ تلاش مجدد مجاز */
  retryable: boolean
  /**
   * نتیجه **نامعلوم**: ممکن است سرویس‌دهنده پیام را پذیرفته باشد ولی پاسخش
   * به ما نرسیده باشد (timeout بعد از ارسال). صف با این پرچم تلاش خودکار را
   * متوقف می‌کند تا پیام دوم به مشتری نرود.
   */
  unknown?: boolean
  /**
   * 🔴 حالت «منتظرِ شرایط» (بازبینی هفتم): سرویس‌دهنده پیام را **نپذیرفت**، ولی
   * دلیلش موقتیِ محیط است (قطعی اینترنت، کمبود اعتبار، «سرور بعداً تلاش کن»،
   * محدودیت نرخ، سرویس در دسترس نیست). این حالت `unknown` **نیست** (پس خطر
   * پیام دوم ندارد) و صف نباید سهمیه‌ی ۵ تلاش را برایش بسوزاند؛ باید با فاصله‌ی
   * ثابت دوباره تلاش کند تا مشکل محیطی برطرف شود.
   */
  waiting?: boolean
  httpStatus?: number | null
  errorCode?: string | null
  errorMessage?: string | null
  /** توضیح فارسیِ آماده‌ی نمایش — متن خام سرویس‌دهنده اینجا نمی‌آید */
  detail: string
}

export interface SmsSendRequest {
  phone: string
  text: string
  /** شناسه‌ی «پترن» تأییدشده (اگر سرویس‌دهنده پترن بخواهد) */
  patternId?: string | null
  senderNumber?: string | null
  /** همان `dedupeKey` صف — اگر سرویس‌دهنده idempotency داشته باشد به او می‌رود */
  idempotencyKey?: string | null
  /**
   * متغیرهای قالب (برای ارسال «الگویی»). ترتیب کلیدها = ترتیب جای‌گذارها در
   * قالب؛ کاوه‌نگار آن‌ها را به token/token2/token3 و sms.ir به پارامترهای
   * هم‌نام نگاشت می‌کند.
   */
  variables?: Record<string, unknown> | null
}

export interface SmsProviderSettings {
  baseUrl?: string | null
  senderNumber?: string | null
  patternId?: string | null
  /**
   * آیا پیام‌های خدماتی با همین `patternId` بروند؟ پیش‌فرض `true` (رفتار قبلی).
   *
   * صاحب فروشگاه می‌تواند خاموشش کند تا **متنِ ویرایش‌شده‌ی خودش** برود — با
   * الگو، متن دلخواه نادیده می‌رفت و کسی هم نمی‌گفت.
   */
  patternForService?: boolean | null
  /** رازِ باز‌شده — فقط در همین لحظه در حافظه است، هرگز لاگ/ذخیره نمی‌شود */
  secrets?: { apiKey?: string | null; username?: string | null; password?: string | null } | null
}

export interface SmsProvider {
  readonly key: SmsProviderKey
  readonly title: string
  /** آیا با این آداپتور، پیام واقعاً از دستگاه بیرون می‌رود؟ */
  readonly live: boolean
  /** پیش‌نیازهای اجباری قبل از ارسال (برای پیام «تنظیم نشده» در UI) */
  missingRequirements(cfg: SmsProviderSettings): string[]
  /** تست واقعی اتصال (کلید/اعتبار) — هرگز throw نمی‌کند */
  probe?(cfg: SmsProviderSettings): Promise<{ ok: boolean; detail: string }>
  send(cfg: SmsProviderSettings, req: SmsSendRequest): Promise<SmsSendResult>
}

const TIMEOUT_MS = 15_000

/** `fetch` با مهلت اجباری — بدون timeout، یک سرویس‌دهنده‌ی کند کارگر را قفل می‌کند. */
export async function fetchWithTimeout(
  url: string,
  init: Record<string, unknown>,
  timeoutMs = TIMEOUT_MS
): Promise<{ ok: boolean; status: number; body: any; text: string }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...(init as any), signal: ctl.signal })
    const text = await res.text()
    let body: any = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { ok: res.ok, status: res.status, body, text: text.slice(0, 500) }
  } finally {
    clearTimeout(timer)
  }
}

// ---------------------------------------------------------------------------
// ۰) طبقه‌بندی خطا — قلب «تلاش مجاز / گم‌شدن هرگز»
// ---------------------------------------------------------------------------

/** نتیجه‌ی «تنظیم نشده» — بدون تماس شبکه. */
function notConfigured(missing: string[]): SmsSendResult {
  return {
    accepted: false,
    providerMessageId: null,
    retryable: false,
    errorCode: 'PROVIDER_NOT_CONFIGURED',
    errorMessage: 'PROVIDER_NOT_CONFIGURED',
    detail:
      `سرویس‌دهنده هنوز کامل تنظیم نشده است (${missing.join(' · ')}). پیام ارسال نشد؛ ` +
      'پس از تکمیل تنظیمات، از «برگرداندن به صف» دوباره بفرستید.'
  }
}

/**
 * شکست سطح HTTP.
 *
 *   ۴۰۲ (Payment Required) = حساب شارژ ندارد          ⇒ موقتی
 *   ۴۰۸ (Request Timeout)  = جواب دیر شد              ⇒ موقتی
 *   ۴۲۹ (نرخ) / ۵۰۳ (سرویس موقتاً در دسترس نیست)      ⇒ موقتی
 *   ۵۰۰/۵۰۲/۵۰۴ و سایر ۵xx                            ⇒ **نامعلوم** (بدون تلاش خودکار)
 *   بقیه‌ی ۴xx             = درخواست/کلید/شماره اشکال دارد ⇒ قطعی
 *
 * ۴۰۲ عمداً اضافه شده: «شارژ کن و دوباره بفرست» یعنی تأخیر، نه گم‌شدن.
 *
 * 🔴 بازبینی ششم (SMS-R6-02): تا امروز ۵xx «قابل تلاش مجدد» بود. ولی ۵۰۰/۵۰۲
 * /۵۰۴ یعنی درخواست به سرور **رسیده** و ممکن است پذیرفته شده باشد؛ تلاش خودکار
 * برای همان ردیف = پیام دوم به همان مشتری — دقیقاً همان چیزی که قاعده‌ی
 * `UNKNOWN` (بند ۴) منع کرده. حالا این‌ها `unknown` می‌شوند: خودکار دوباره
 * نمی‌رود، ولی کاربر با «تلاش مجدد» دستی می‌تواند بفرستد. فقط ۵۰۳ و ۴۲۹
 * (که پاسخِ صریح «نفرستادم» هستند) موقتی می‌مانند.
 */
function httpFailure(status: number, detail: string, code = 'PROVIDER_HTTP'): SmsSendResult {
  const ambiguous = status >= 500 && status !== 503
  const transient = !ambiguous && (status === 402 || status === 408 || status === 429 || status === 503)
  return {
    accepted: false,
    providerMessageId: null,
    retryable: transient,
    /** موقتیِ محیطی ⇒ سهمیه نسوزد (بازبینی هفتم) */
    ...(transient ? { waiting: true } : {}),
    ...(ambiguous ? { unknown: true } : {}),
    httpStatus: status,
    errorCode: code,
    errorMessage: code,
    detail: ambiguous
      ? `${detail} نتیجه نامعلوم است؛ برای اینکه پیام دوم به همان مشتری نرود، خودکار دوباره فرستاده نمی‌شود.`
      : detail
  }
}

/**
 * خطای شبکه/مهلت. این تابع مرزِ «تلاش مجدد» و «نامعلوم» است:
 *
 *   • خطاهای پیش از ارسال (DNS، اتصال رد شد، مهلت اتصال) ⇒ قطعاً چیزی
 *     نرفته ⇒ تلاش مجدد.
 *   • مهلتِ پاسخ / قطع وسط راه ⇒ نمی‌دانیم ⇒ «نامعلوم» تا پیام دوم نرود.
 */
function classifyFetchError(e: any): SmsSendResult {
  const name = String(e?.name ?? '')
  const code = String(e?.cause?.code ?? e?.code ?? '')
  const beforeSend = [
    'ECONNREFUSED',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ECONNABORTED',
    'UND_ERR_CONNECT_TIMEOUT'
  ].includes(code)

  if (beforeSend) {
    return {
      accepted: false,
      providerMessageId: null,
      retryable: true,
      /**
       * 🔴 قطعی اینترنت/نبودِ DNS یعنی «پیام نرفت» و مشکل محیطی است؛ صف نباید
       * سهمیه‌ی ۵ تلاش را بسوزاند (بازبینی هفتم) — وگرنه قطعیِ دو ساعته، پیام
       * را تا ابد `FAILED_FINAL` می‌کرد.
       */
      waiting: true,
      errorCode: 'PROVIDER_UNREACHABLE',
      errorMessage: 'PROVIDER_UNREACHABLE',
      detail: 'ارتباط با سرویس‌دهنده برقرار نشد. پیام در صف می‌ماند و تا ۷۲ ساعت خودکار دوباره تلاش می‌شود.'
    }
  }

  // مهلت، یا قطعِ وسط راه، یا هر خطای ناشناخته‌ی دیگر.
  const timedOut = name === 'AbortError' || code === 'ABORT_ERR'
  return {
    accepted: false,
    providerMessageId: null,
    retryable: false,
    unknown: true,
    errorCode: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK',
    errorMessage: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_NETWORK',
    detail:
      'پاسخی از سرویس‌دهنده نرسید؛ ممکن است پیام پذیرفته شده باشد. برای جلوگیری از ارسال دوباره، ' +
      'وضعیت «نامعلوم» ثبت شد. از «سابقه» می‌توانید مطمئن شوید و در صورت نیاز «برگرداندن به صف» بزنید.'
  }
}

/** شماره‌ای که سرویس‌دهنده به‌عنوان خط/سرشماره می‌شناسد. */
function senderOf(cfg: SmsProviderSettings): string {
  return String(cfg.senderNumber ?? '').trim()
}

/**
 * متغیرهای الگو به ترتیب. اگر متغیری نباشد، ارسال «متن‌کامل» انجام می‌شود
 * (نه الگویی) — عمدی: پیام بدون پارامتر نباید با الگو به سرویس‌دهنده برود.
 */
function patternValues(req: SmsSendRequest): string[] {
  const vars = req.variables
  if (!vars || typeof vars !== 'object') return []
  return Object.values(vars)
    .map((v) => (v == null ? '' : String(v)))
    .filter((v) => v.length > 0)
}

function usePattern(req: SmsSendRequest): string | null {
  const id = String(req.patternId ?? '').trim()
  if (!id) return null
  return patternValues(req).length > 0 ? id : null
}

// ---------------------------------------------------------------------------
// ۱) آزمایشی — بدون تماس شبکه
// ---------------------------------------------------------------------------

/**
 * هیچ تماس شبکه‌ای ندارد؛ فقط در کنسول اصلی ثبت می‌کند.
 *
 * ⚠️ متن پیام و شماره **چاپ نمی‌شوند** (فقط طول متن و دنباله‌ی شماره)، چون
 * با ارسال واقعی این لاگ‌ها می‌توانند محتوای خصوصی مشتری را روی دیسک بگذارند.
 */
export const logOnlyProvider: SmsProvider = {
  key: 'LOG_ONLY',
  title: 'آزمایشی (بدون ارسال واقعی)',
  live: false,
  missingRequirements: () => [],
  async send(_cfg, req) {
    const len = String(req.text ?? '').length
    const tail = String(req.phone ?? '').slice(-4) || '----'
    console.info(`[sms:log-only] پیام ${len} نویسه‌ای برای شماره‌ی ***${tail} ثبت شد (ارسالی انجام نشد)`)
    return {
      accepted: true,
      providerMessageId: null,
      retryable: false,
      detail:
        'پیام در صف ثبت و پردازش شد، ولی ارسال واقعی انجام نشد (سرویس‌دهنده روی حالت آزمایشی است).'
    }
  }
}

// ---------------------------------------------------------------------------
// ۲) sms.ir  —  https://api.sms.ir/v1
// ---------------------------------------------------------------------------

const SMS_IR_BASE = 'https://api.sms.ir/v1'

function smsIrBase(cfg: SmsProviderSettings): string {
  return String(cfg.baseUrl || SMS_IR_BASE).trim().replace(/\/+$/, '')
}

function smsIrMissing(cfg: SmsProviderSettings): string[] {
  const miss: string[] = []
  if (!cfg.secrets?.apiKey) miss.push('کلید API')
  if (!senderOf(cfg)) miss.push('سرشماره (lineNumber)')
  return miss
}

function smsIrHeaders(cfg: SmsProviderSettings): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'x-api-key': String(cfg.secrets?.apiKey ?? '').trim()
  }
}

/** `lineNumber` طبق مستندات عددی است؛ اگر کاربر رشته‌ی غیرعددی بدهد، همان می‌رود. */
function smsIrLine(cfg: SmsProviderSettings): number | string {
  const raw = senderOf(cfg)
  const n = Number(raw)
  return Number.isFinite(n) && String(n) === raw ? n : raw
}

function smsIrFailure(res: { ok: boolean; status: number; body: any }, what: string): SmsSendResult {
  if (!res.ok) {
    const auth = res.status === 401 || res.status === 403
    return httpFailure(
      res.status,
      auth
        ? 'کلید API پذیرفته نشد. کلید را از پنل sms.ir دوباره بگیرید و اینجا ذخیره کنید.'
        : `sms.ir درخواست را نپذیرفت (کد ${res.status}).`,
      auth ? 'PROVIDER_AUTH' : 'PROVIDER_HTTP'
    )
  }
  const code = Number(res.body?.status ?? 0)
  /**
   * 🔴 کد وضعیت ۱۰۲ = «اعتبار کافی نیست» — طبق جدول رسمی `sms.ir/rest-api`.
   * این خطا قطعی نیست: کاربر شارژ می‌کند و پیام باید **خودکار** ادامه پیدا کند
   * (قبلاً همه‌ی خطاهای بدنه‌ای «قطعی» می‌شدند و پیام بی‌دلیل FAILED_FINAL
   * می‌خورد؛ یعنی بعد از شارژ هم نمی‌رفت).
   */
  const creditShort = code === 102
  return {
    accepted: false,
    providerMessageId: null,
    retryable: creditShort,
    ...(creditShort ? { waiting: true } : {}),
    httpStatus: res.status,
    errorCode: `SMS_IR_${code || 'ERROR'}`,
    errorMessage: `SMS_IR_${code || 'ERROR'}`,
    detail: creditShort
      ? 'اعتبار حساب sms.ir کافی نیست. پیام در صف می‌ماند؛ پس از شارژ حساب، تا ۷۲ ساعت خودکار ادامه می‌یابد.'
      : `sms.ir «${what}» را نپذیرفت: ${String(res.body?.message ?? '').slice(0, 120) || 'دلیل نامعلوم'}`
  }
}

export const smsIrProvider: SmsProvider = {
  key: 'SMS_IR',
  title: 'sms.ir',
  live: true,
  missingRequirements: smsIrMissing,

  async probe(cfg) {
    const missing = smsIrMissing(cfg)
    if (missing.length) return { ok: false, detail: `این موارد تنظیم نشده‌اند: ${missing.join(' · ')}` }
    try {
      const res = await fetchWithTimeout(`${smsIrBase(cfg)}/credit`, {
        method: 'GET',
        headers: smsIrHeaders(cfg)
      })
      if (!res.ok) {
        const auth = res.status === 401 || res.status === 403
        return {
          ok: false,
          detail: auth
            ? 'کلید API پذیرفته نشد.'
            : `sms.ir به درخواست اعتبار پاسخ درست نداد (کد ${res.status}).`
        }
      }
      if (Number(res.body?.status ?? 0) !== 1) {
        return { ok: false, detail: `sms.ir پاسخ داد: ${String(res.body?.message ?? 'دلیل نامعلوم').slice(0, 120)}` }
      }
      const credit = res.body?.data
      return {
        ok: true,
        detail: credit == null ? 'اتصال به sms.ir برقرار است.' : `اتصال برقرار است · اعتبار حساب: ${credit} ریال`
      }
    } catch (e) {
      return { ok: false, detail: classifyFetchError(e).detail }
    }
  },

  async send(cfg, req) {
    const missing = smsIrMissing(cfg)
    if (missing.length) return notConfigured(missing)

    const patternId = usePattern(req)
    const values = patternValues(req)
    const url = patternId ? `${smsIrBase(cfg)}/send/verify` : `${smsIrBase(cfg)}/send/bulk`
    const payload = patternId
      ? {
          mobile: req.phone,
          templateId: Number(patternId),
          parameters: Object.entries(req.variables ?? {})
            .map(([name, value]) => ({ name, value: value == null ? '' : String(value) }))
        }
      : {
          lineNumber: smsIrLine(cfg),
          messageText: req.text,
          mobiles: [req.phone],
          sendDateTime: null
        }

    let res
    try {
      res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: smsIrHeaders(cfg),
        body: JSON.stringify(payload)
      })
    } catch (e) {
      return classifyFetchError(e)
    }

    if (res.ok && Number(res.body?.status ?? 0) === 1) {
      const data = res.body?.data ?? {}
      const id = data.batchId ?? data.packetId ?? data.messageId ?? null
      return {
        accepted: true,
        providerMessageId: id == null ? null : String(id),
        retryable: false,
        httpStatus: res.status,
        detail: patternId
          ? `پیام الگویی (${values.length} پارامتر) به sms.ir سپرده شد.`
          : 'پیام به sms.ir سپرده شد.'
      }
    }
    return smsIrFailure(res, patternId ? 'ارسال الگویی' : 'ارسال پیام')
  }
}

// ---------------------------------------------------------------------------
// ۳) کاوه‌نگار  —  https://api.kavenegar.com/v1/{API-KEY}
// ---------------------------------------------------------------------------

const KAVENEGAR_BASE = 'https://api.kavenegar.com/v1'

function kavenegarBase(cfg: SmsProviderSettings): string {
  return String(cfg.baseUrl || KAVENEGAR_BASE).trim().replace(/\/+$/, '')
}

function kavenegarKey(cfg: SmsProviderSettings): string {
  return String(cfg.secrets?.apiKey ?? '').trim()
}

function kavenegarMissing(cfg: SmsProviderSettings): string[] {
  const miss: string[] = []
  if (!kavenegarKey(cfg)) miss.push('کلید API')
  if (!senderOf(cfg)) miss.push('سرشماره (sender)')
  return miss
}

function kavenegarUrl(cfg: SmsProviderSettings, path: string, params: Record<string, string>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) q.set(k, v)
  const query = q.toString()
  return `${kavenegarBase(cfg)}/${encodeURIComponent(kavenegarKey(cfg))}/${path}${query ? `?${query}` : ''}`
}

/**
 * طبقه‌بندی وضعیت کاوه‌نگار. توجه: کاوه‌نگار حتی برای خطا هم HTTP 200 می‌دهد و
 * خطا در `return.status` می‌آید؛ پس همین عدد مرجع است، نه کد HTTP.
 *
 * 🔴 اصلاح مهم (بازبینی پنجم + مستندات رسمی `kavenegar.com/rest.html`):
 * کد «اعتبار حساب کافی نیست» **۴۱۸** است، نه ۴۰۲. قبلاً ۴۱۸ «قطعی» حساب
 * می‌شد؛ یعنی فروشگاهی که شارژش تمام می‌شد، پیام‌ها را `FAILED_FINAL` می‌دید و
 * بعد از شارژ هم **خودکار ادامه نمی‌داد** — همان «گم‌شدن»ی که کاربر گفته هرگز
 * نباید بشود. ۴۰۹ («سرور قادر به پاسخگوئی نیست، بعداً تلاش کنید») هم موقتی است.
 *
 *   ۴۰۹ = سرور پاسخگو نیست       ⇒ موقتی
 *   ۴۱۸ = اعتبار حساب کافی نیست  ⇒ موقتی (شارژ می‌کند و خودش می‌رود)
 *   ۴۰۲ = «عملیات ناموفق بود» (معنای مستندش عام است) ⇒ محتاطانه موقتی
 *   ۵xx = اشکال سرویس‌دهنده       ⇒ موقتی
 *   بقیه (۴۱۱ شماره‌ی نامعتبر، ۴۲۴ الگوی تأییدنشده، ۴۰۱ حساب غیرفعال، ۴۰۳ کلید) ⇒ قطعی
 */
function kavenegarRetryable(status: number): boolean {
  return status === 402 || status === 409 || status === 418 || status >= 500
}

function kavenegarSource(status: number): 'SMS_PROVIDER_AUTH' | 'SMS_PROVIDER_REJECTED' | 'SMS_PROVIDER_TEMP' {
  if (status === 401 || status === 403) return 'SMS_PROVIDER_AUTH'
  return kavenegarRetryable(status) ? 'SMS_PROVIDER_TEMP' : 'SMS_PROVIDER_REJECTED'
}

function kavenegarResult(body: any, httpStatus: number | null, what: string): SmsSendResult {
  const status = Number(body?.return?.status ?? 0)
  const message = String(body?.return?.message ?? '').slice(0, 120)

  if (status === 200) {
    const entry = Array.isArray(body?.entries) ? body.entries[0] : body?.entries
    const id = entry?.messageid ?? null
    return {
      accepted: true,
      providerMessageId: id == null ? null : String(id),
      retryable: false,
      httpStatus,
      detail: `${what} به کاوه‌نگار سپرده شد.`
    }
  }

  const source = kavenegarSource(status)
  const detail =
    status === 418
      ? 'اعتبار حساب کاوه‌نگار کافی نیست. پیام در صف می‌ماند؛ پس از شارژ حساب، تا ۷۲ ساعت خودکار ادامه می‌یابد.'
      : status === 409
        ? 'سرور کاوه‌نگار الان پاسخگو نیست. پیام در صف می‌ماند و تا ۷۲ ساعت خودکار دوباره تلاش می‌شود.'
        : status === 402
          ? 'کاوه‌نگار درخواست را ناموفق اعلام کرد (کد ۴۰۲). پیام در صف می‌ماند و تا ۷۲ ساعت دوباره تلاش می‌شود.'
          : status === 401 || status === 403
            ? 'کلید API کاوه‌نگار پذیرفته نشد. کلید را دوباره بررسی و ذخیره کنید.'
            : `کاوه‌نگار «${what}» را نپذیرفت${message ? `: ${message}` : ''}.`

  const retryable = kavenegarRetryable(status)
  return {
    accepted: false,
    providerMessageId: null,
    retryable,
    /**
     * 🔴 کدهای موقتیِ کاوه‌نگار (۴۱۸ کمبود اعتبار، ۴۰۹ سرور پاسخگو نیست،
     * ۴۰۲، ۵xx) «منتظرِ شرایط»اند: صف سهمیه‌ی ۵ تلاش را برایشان نمی‌سوزاند.
     */
    ...(retryable ? { waiting: true } : {}),
    httpStatus,
    errorCode: source,
    errorMessage: source,
    detail
  }
}

export const kavenegarProvider: SmsProvider = {
  key: 'KAVENEGAR',
  title: 'کاوه‌نگار',
  live: true,
  missingRequirements: kavenegarMissing,

  async probe(cfg) {
    const missing = kavenegarMissing(cfg)
    if (missing.length) return { ok: false, detail: `این موارد تنظیم نشده‌اند: ${missing.join(' · ')}` }
    try {
      const res = await fetchWithTimeout(kavenegarUrl(cfg, 'account/info.json', {}), {
        method: 'GET',
        headers: { Accept: 'application/json' }
      })
      if (!res.ok) {
        return { ok: false, detail: `کاوه‌نگار پاسخ درستی به درخواست اطلاعات حساب نداد (کد ${res.status}).` }
      }
      const status = Number(res.body?.return?.status ?? 0)
      if (status !== 200) {
        const auth = status === 401 || status === 403
        return {
          ok: false,
          detail: auth
            ? 'کلید API کاوه‌نگار پذیرفته نشد.'
            : `کاوه‌نگار پاسخ داد: ${String(res.body?.return?.message ?? 'دلیل نامعلوم').slice(0, 120)}`
        }
      }
      const credit = res.body?.entries?.remaincredit ?? res.body?.entries?.credit
      return {
        ok: true,
        detail: credit == null ? 'اتصال به کاوه‌نگار برقرار است.' : `اتصال برقرار است · اعتبار باقی‌مانده: ${credit} ریال`
      }
    } catch (e) {
      return { ok: false, detail: classifyFetchError(e).detail }
    }
  },

  async send(cfg, req) {
    const missing = kavenegarMissing(cfg)
    if (missing.length) return notConfigured(missing)

    const patternId = usePattern(req)
    const values = patternValues(req)

    let url: string
    let what: string
    if (patternId) {
      const params: Record<string, string> = { receptor: req.phone, template: patternId }
      params.token = values[0] ?? ''
      if (values[1] != null) params.token2 = values[1]
      if (values[2] != null) params.token3 = values[2]
      url = kavenegarUrl(cfg, 'verify/lookup.json', params)
      what = 'ارسال الگویی'
    } else {
      url = kavenegarUrl(cfg, 'sms/send.json', {
        receptor: req.phone,
        message: req.text,
        sender: senderOf(cfg)
      })
      what = 'ارسال پیام'
    }

    let res
    try {
      res = await fetchWithTimeout(url, { method: 'GET', headers: { Accept: 'application/json' } })
    } catch (e) {
      return classifyFetchError(e)
    }

    /**
     * 🔴 بازبینی ششم (SMS-R6-01): مرجعِ خطای کاوه‌نگار **بدنه** است، نه کد HTTP.
     *
     * خودِ کاوه‌نگار (مثل SDK رسمی‌اش) برای خطاهای منطقی — ۴۱۸ کمبود اعتبار،
     * ۴۰۹ سرور پاسخگو نیست، ۴۰۱/۴۰۳ کلید… — هم کد HTTP هم‌ارز می‌دهد و هم
     * بدنه‌ی JSON با `return.status`. قبلاً هر پاسخ غیرِ ۲۰۰ (جز ۴۰۰/۴۰۱/۴۰۳)
     * به `httpFailure` می‌رفت و همان‌جا ۴۱۸/۴۰۹ **قطعی** حساب می‌شد ⇒ فروشگاهی
     * که شارژش تمام شده بود پیام را `FAILED_FINAL` می‌دید و بعد از شارژ هم
     * خودکار نمی‌رفت؛ یعنی رفع بازبینی پنجم فقط در مسیر HTTP 200 کار می‌کرد.
     *
     * قاعده: هر وقت بدنه `return.status` داشت، همان مرجع است؛ `httpFailure`
     * فقط برای بدنه‌ی ناخوانا (پروکسی/HTML/پاسخ خالی) می‌ماند.
     */
    const bodyStatus = Number(res.body?.return?.status ?? 0)
    if (!res.ok && !(bodyStatus > 0)) {
      return httpFailure(res.status, `کاوه‌نگار درخواست را نپذیرفت (کد ${res.status}).`)
    }
    return kavenegarResult(res.body, res.status, what)
  }
}

// ---------------------------------------------------------------------------
// ۴) رجیستری
// ---------------------------------------------------------------------------

const REGISTRY: Record<SmsProviderKey, SmsProvider> = {
  LOG_ONLY: logOnlyProvider,
  SMS_IR: smsIrProvider,
  KAVENEGAR: kavenegarProvider
}

export function getSmsProvider(key: unknown): SmsProvider {
  return REGISTRY[normalizeSmsProviderKey(key)]
}

export function listSmsProviders(): SmsProvider[] {
  return Object.values(REGISTRY)
}
