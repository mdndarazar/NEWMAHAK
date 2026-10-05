/**
 * ===========================================================================
 * صف پیام‌ها و کارگرِ ارسال.
 *
 * چهار قاعده‌ی سخت این فایل:
 *
 *   ۱) **هیچ تماس شبکه‌ای داخل تراکنش مالی نمی‌شود.** صف کاملاً بیرون از
 *      مسیر فروش/برگشت/اعتبار زندگی می‌کند و تنها از راه صف به آن‌ها وصل است.
 *   ۲) **یک پیام خراب، صف را متوقف نمی‌کند.** هر خطای پیش‌بینی‌نشده در یک ردیف
 *      گرفته می‌شود و بقیه سر جایشان می‌مانند.
 *   ۳) **بدون سرویس‌دهنده‌ی فعال، هیچ تلاشی مصرف نمی‌شود.** اگر کسی سرویس‌دهنده
 *      را تنظیم نکرده باشد، پیام‌ها در `PENDING` می‌مانند و شمارنده‌ی تلاش
 *      بالا نمی‌رود — نه اینکه پنج بار بیهوده تلاش و بعد «ناموفق قطعی» شوند.
 *   ۴) **نتیجه‌ی نامعلوم، تلاش کور نمی‌شود.** timeout بعد از ارسال ⇒ `UNKNOWN`.
 *      این تنها حالتی است که «تلاش مجدد» می‌تواند پیام دوم به مشتری بدهد.
 *   ۵) **شکستِ «منتظرِ شرایط» سهمیه‌ی تلاش را نمی‌سوزاند** (بازبینی هفتم،
 *      SMS-R7-01). قطعی اینترنت، تمام‌شدن اعتبار حساب و «سرور بعداً تلاش کن»
 *      مشکلِ *محیط* است، نه پیام. قبلاً همان سقف ۵ تلاش (≈۸۱ دقیقه) برایشان
 *      اعمال می‌شد و پیام `FAILED_FINAL` می‌شد ⇒ بعد از شارژ/وصل‌شدن اینترنت
 *      خودکار نمی‌رفت. حالا با فاصله‌ی ثابت یک ساعت و تا سقف ۷۲ ساعت ادامه
 *      می‌دهد. (خطر پیام دوم ندارد: این پاسخ‌ها صریحاً «نپذیرفتم» هستند.)
 * ===========================================================================
 */
import { randomUUID } from 'node:crypto'
import { prisma } from '../../db/client'
import { BusinessError } from '../../errors'
import { audit } from '../AuditService'
import { AuditAction } from '@shared/enums'
import {
  SmsOutboxStatus,
  SMS_MAX_ATTEMPTS,
  smsBackoffMs,
  smsSegments,
  normalizeSmsPhone,
  isSmsCancelable,
  isSmsRequeueable,
  SMS_LOCK_TIMEOUT_MS,
  smsNeedsOptOutNote,
  smsWithOptOutNote,
  smsLinePurposeForEvent,
  pickSmsLine,
  SmsEventType,
  SMS_CANCELABLE_STATUSES,
  SMS_LIVE_STATUSES,
  SMS_SETTING_KEYS,
  DEFAULT_SMS_OPT_OUT_NOTE,
  smsReminderManualResendBlocked,
  SMS_WAITING_BACKOFF_MS,
  smsWaitingExpired
} from '@shared/sms'
import { getSmsProvider } from './providers'
import { activeLines, secretsOf } from './SmsCredentials'

/**
 * جمله‌ی لغو از **تنظیمات** خوانده می‌شود، نه از یک ثابت در کد.
 *
 * چرا اینجا و نه در `SmsService`: صف لایه‌ی پایین است و نباید به سرویس
 * وابسته شود (وگرنه حلقه‌ی import می‌سازیم). خواندن یک کلید از `Setting` هم
 * ارزان است و هم این تابع را در همه‌ی مسیرها (کمپین، ایمپورت، اسکریپت) معتبر
 * نگه می‌دارد.
 *
 * ⚠️ `client` اختیاری است و از `enqueueSms` می‌آید: وقتی کمپین داخل یک
 * تراکنش ثبت می‌شود، خواندن‌ها هم باید از همان کلاینتِ تراکنش بروند. با
 * `prisma` سراسری، آن کوئری‌ها اتصال دیگری می‌خواهند و روی SQLite (قفل
 * نویسنده) می‌توانند تا پایان تراکنش بلاک بمانند — یعنی ثبت کمپین ۱۰۰۰ نفره
 * روی نصب واقعی گیر کند. پیش‌فرض همان `prisma` است، پس مسیرهای عادی عوض
 * نمی‌شوند.
 */
async function readOptOutNote(client: any = prisma): Promise<string> {
  try {
    const row = await (client as any).setting.findUnique({ where: { key: SMS_SETTING_KEYS.optOutNote } })
    const value = String(row?.value ?? '').trim()
    return value || DEFAULT_SMS_OPT_OUT_NOTE
  } catch {
    return DEFAULT_SMS_OPT_OUT_NOTE
  }
}

/**
 * نشانه‌ی «پیام تحویل آداپتور شد».
 *
 * 🔴 چرا لازم است: بدون این نشانه نمی‌فهمیدیم پیام **قبل** از تماس با
 * سرویس‌دهنده شکسته (پس با خیال راحت دوباره تلاش می‌شود) یا **بعد** از پذیرش
 * سرویس‌دهنده و در ثبت نتیجه (پس ارسال دوباره = پیام دوباره برای مشتری).
 * این نشانه پیش از `provider.send` نوشته و بعد از آن بازنویسی می‌شود.
 */
const SENDING_MARKER = 'SENDING'

/**
 * ===========================================================================
 * هوک «سرانجامِ پیام» — تنها راهی که ماژول‌های دیگر می‌فهمند پیام واقعاً چه شد.
 *
 * چرا لازم است: سهمیه‌ی یادآوری اعتبار در لحظه‌ی **پذیرش** مصرف می‌شود، ولی
 * پیام هنوز در صف است و ممکن است هرگز نرود (قطعی اینترنت، خطای قطعی، لغو توسط
 * مدیر). آن‌وقت سهمیه سوخته و ضداسپم جلوی یادآوری بعدی را می‌گیرد — همان
 * «گم‌شدن»ی که قرار بود هرگز رخ ندهد.
 *
 * قاعده‌ها:
 *   • شکست این هوک **هرگز** نباید صف را بیندازد (کاملاً fire-and-forget).
 *   • پیامک ماژول اعتبار را import نمی‌کند؛ بوت این دو را به هم می‌دوزد.
 * ===========================================================================
 */
export interface SmsOutcomeEvent {
  outboxId: number
  eventType: string
  phone: string
  relatedEntity: string | null
  relatedEntityId: number | null
  /** SENT | FAILED_FINAL | CANCELED | UNKNOWN */
  outcome: 'SENT' | 'FAILED_FINAL' | 'CANCELED' | 'UNKNOWN'
  detail: string
}

let outcomeHook: ((e: SmsOutcomeEvent) => void | Promise<void>) | null = null

export function setSmsOutcomeHook(fn: ((e: SmsOutcomeEvent) => void | Promise<void>) | null): void {
  outcomeHook = fn ?? null
}

function emitOutcome(row: any, outcome: SmsOutcomeEvent['outcome'], detail: string): void {
  if (!outcomeHook) return
  const event: SmsOutcomeEvent = {
    outboxId: Math.round(Number(row?.id ?? 0)),
    eventType: String(row?.eventType ?? ''),
    phone: String(row?.phoneSnapshot ?? ''),
    relatedEntity: row?.relatedEntity ?? null,
    relatedEntityId: row?.relatedEntityId == null ? null : Math.round(Number(row.relatedEntityId)),
    outcome,
    detail
  }
  Promise.resolve()
    .then(async () => {
      /**
       * 🛡️ لایه‌ی دفاعی (باگ دوم بازبینی چهارم): «سهمیه آزاد شد» فقط وقتی خبر
       * داده می‌شود که ردیف، **آخرین یادآوریِ همان کد اعتبار** باشد.
       *
       * چرا: در ماژول اعتبار، این خبر یعنی «جدیدترین یادآوریِ پذیرفته‌شده را
       * آزاد کن». اگر رویدادِ قدیمی (مثلاً لغوِ دیروز) دیرتر برسد در حالی که
       * یادآوری تازه‌ای واقعاً تحویل شده، آزادکردن سهمیه یعنی یادآوری تکراری
       * فردا. حالا چنین رویدادی بی‌اثر می‌شود.
       */
      if (event.outcome !== 'CANCELED' && event.outcome !== 'FAILED_FINAL') return
      if (event.eventType !== SmsEventType.CREDIT_REMINDER || event.relatedEntityId == null) return
      const latest = await (prisma as any).smsOutbox
        .findFirst({
          where: { eventType: SmsEventType.CREDIT_REMINDER, relatedEntityId: event.relatedEntityId },
          orderBy: { id: 'desc' },
          select: { id: true }
        })
        .catch(() => null)
      if (latest?.id != null && Math.round(Number(latest.id)) !== event.outboxId) {
        console.info('[sms:outcome] رویداد کهنه نادیده گرفته شد', JSON.stringify({ ...event, latest: latest.id }))
        return
      }
      await outcomeHook?.(event)
    })
    .catch((e) => console.error('[sms:outcome] failed', e))
}

/** شناسه‌ی این اجرا — برای تشخیص «قفلِ مالِ خودم» از «قفلِ یتیم». */
const WORKER_ID = `main-${process.pid}-${randomUUID().slice(0, 8)}`

/** چند پیام در هر دور. عمداً کم: SQLite تک‌نویسنده است و مسیر فروش مهم‌تر است. */
const BATCH = 5

/** فاصله‌ی دورهای کارگر. */
const TICK_MS = 20_000

export interface SmsEnqueueInput {
  eventType: string
  phone: unknown
  body: string
  templateCode?: string | null
  templateId?: number | null
  customerId?: number | null
  customerName?: string | null
  variables?: Record<string, unknown> | null
  relatedEntity?: string | null
  relatedEntityId?: number | null
  /** کمپین تبلیغاتی (برای «لغو گروهی» و سابقه) */
  campaignId?: number | null
  dedupeKey: string
  priority?: number
  /** زمان‌بندی دلخواه. null = در اولین فرصت. */
  scheduledAt?: Date | null
  createdByUserId?: number | null
}

export interface SmsEnqueueResult {
  ok: boolean
  id: number | null
  /** پیام تکراری بود و ساخته نشد */
  duplicate: boolean
  /** ساخته نشد چون شماره معتبر نبود */
  skipped: boolean
  detail: string
}

/**
 * ثبت یک پیام در صف.
 *
 * ⚠️ این تابع **هرگز throw نمی‌کند** و همیشه یک نتیجه‌ی قابل‌فهم برمی‌گرداند.
 * دلیلش همان قرارداد ماژول است: اگر پیامک نتواند ساخته شود، کار اصلی
 * (فروش، ثبت یادآوری) باید بی‌هیچ اختلالی تمام شود.
 */
export interface SmsEnqueueOptions {
  /**
   * کلاینتی که نوشتن با آن انجام می‌شود. برای «ثبت اتمیک کمپین» لازم است:
   * کمپین و ردیف‌های صفش باید در **یک تراکنش** نوشته شوند تا خطای وسط راه
   * کمپین نیمه‌کاره نسازد.
   */
  client?: any
  /**
   * خطای واقعی بالا برود (برای داخل تراکنش). پیش‌فرض `false` است چون قاعده‌ی
   * این ماژول همیشه این بوده که «هیچ خطایی به کاربرِ مشغولِ فروش نرسد»؛
   * ولی کمپین نمی‌تواند بی‌صدا ناقص بماند، پس آن‌جا strict می‌شود.
   */
  strict?: boolean
}

export async function enqueueSms(
  input: SmsEnqueueInput,
  opts: SmsEnqueueOptions = {}
): Promise<SmsEnqueueResult> {
  const db: any = opts.client ?? (prisma as any)
  try {
    const phone = normalizeSmsPhone(input?.phone)
    if (!phone) {
      return {
        ok: false,
        id: null,
        duplicate: false,
        skipped: true,
        detail: 'شماره‌ی موبایل معتبری برای این پیام ثبت نشده بود، پس چیزی در صف ننشست.'
      }
    }
    let body = String(input?.body ?? '')
    if (!body.trim()) {
      return { ok: false, id: null, duplicate: false, skipped: true, detail: 'متن پیام خالی بود.' }
    }

    /**
     * ================= قفل‌های مقرراتی پیام تبلیغاتی =================
     *
     * این دو خط عمداً **اینجا** هستند، نه فقط در UI:
     *   ۱) شماره‌ای که «لغو ۱۱» کرده باشد، هیچ‌وقت پیام تبلیغاتی نمی‌گیرد —
     *      حتی اگر از مسیر دیگری (ایمپورت، اسکریپت، کمپین قدیمی) بیاید.
     *   ۲) جمله‌ی لغو اگر در متن نباشد **چسبانده می‌شود**. مقدارش از تنظیمات
     *      می‌آید (`sms.optOutNote`) تا اگر مقررات عوض شد، فقط همان تنظیم
     *      عوض شود و کد دست نخورد.
     */
    if (smsNeedsOptOutNote(input.eventType)) {
      /** همان دلیلِ `readOptOutNote`: داخل تراکنش، با کلاینت خودِ تراکنش. */
      const opt = await db.smsOptOut.findUnique({ where: { phone } }).catch(() => null)
      if (opt) {
        return {
          ok: false,
          id: null,
          duplicate: false,
          skipped: true,
          detail: 'این شماره پیامک تبلیغاتی را لغو کرده است («لغو ۱۱»)، پس چیزی برایش ارسال نشد.'
        }
      }
      const note = await readOptOutNote(db)
      body = smsWithOptOutNote(body, note)
    }

    const dedupeKey = String(input?.dedupeKey ?? '').trim()
    if (!dedupeKey)
      return { ok: false, id: null, duplicate: false, skipped: true, detail: 'کلید یکتای پیام ساخته نشد.' }

    const scheduledAt = input?.scheduledAt ? new Date(input.scheduledAt) : null
    const row = await db.smsOutbox.create({
      data: {
        dedupeKey,
        eventType: String(input.eventType),
        templateId: input?.templateId ?? null,
        customerId: input?.customerId ?? null,
        phoneSnapshot: phone,
        customerNameSnapshot: input?.customerName ?? null,
        bodySnapshot: body,
        variablesJson: input?.variables ? JSON.stringify(input.variables) : null,
        relatedEntity: input?.relatedEntity ?? null,
        relatedEntityId: input?.relatedEntityId ?? null,
        campaignId: input?.campaignId ?? null,
        status: SmsOutboxStatus.PENDING,
        priority: Math.round(Number(input?.priority ?? 5)) || 5,
        maxAttempts: SMS_MAX_ATTEMPTS,
        segments: smsSegments(body),
        scheduledAt,
        nextAttemptAt: scheduledAt ?? new Date(),
        createdByUserId: input?.createdByUserId ?? null
      }
    })

    return {
      ok: true,
      id: row.id,
      duplicate: false,
      skipped: false,
      detail: scheduledAt ? 'پیام برای زمان تعیین‌شده در صف ثبت شد.' : 'پیام در صف ثبت شد.'
    }
  } catch (e: any) {
    // تکراری: کلید یکتا جلویش را گرفت — همان هدف، فقط با گزارش درست
    if (String(e?.code ?? '') === 'P2002' || /UNIQUE constraint failed/i.test(String(e?.message ?? ''))) {
      return { ok: false, id: null, duplicate: true, skipped: false, detail: 'این پیام قبلاً در صف ثبت شده است.' }
    }
    // داخل تراکنش کمپین، «بی‌صدا رد شدن» یعنی کمپین ناقص ⇒ باید بشکند
    if (opts.strict) throw e
    // هیچ خطایی از ساخت پیام نباید به کاربرِ مشغولِ فروش برسد
    console.error('[sms:enqueue] failed', e)
    return { ok: false, id: null, duplicate: false, skipped: true, detail: 'ثبت پیام در صف ناموفق بود.' }
  }
}

/** ردیف‌های «الان باید بروند»: موعدشان رسیده و زمان‌بندی‌شان نگذشته. */
async function pickDue(limit: number, now: Date, eventFilter?: Record<string, unknown>): Promise<any[]> {
  return (prisma as any).smsOutbox.findMany({
    where: {
      ...(eventFilter ?? {}),
      OR: [{ status: SmsOutboxStatus.PENDING }, { status: SmsOutboxStatus.FAILED_RETRYABLE }],
      AND: [
        { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
        { OR: [{ scheduledAt: null }, { scheduledAt: { lte: now } }] }
      ]
    },
    orderBy: [{ priority: 'asc' }, { id: 'asc' }],
    take: limit
  })
}

/**
 * قفل خوش‌بینانه: فقط اگر هنوز همان وضعیت را دارد می‌گیریمش.
 * `updateMany` با شرط، در SQLite تعداد ردیف‌های واقعاً تغییرکرده را می‌دهد، پس
 * دو کارگر هم‌زمان یک پیام را دوبار برنمی‌دارند.
 */
async function lockOne(id: number, now: Date): Promise<boolean> {
  const res = await (prisma as any).smsOutbox.updateMany({
    where: {
      id,
      status: { in: [SmsOutboxStatus.PENDING, SmsOutboxStatus.FAILED_RETRYABLE] }
    },
    data: { status: SmsOutboxStatus.PROCESSING, lockedAt: now, lockedBy: WORKER_ID }
  })
  return (res?.count ?? 0) > 0
}

/**
 * «قفل‌های یتیم»: ردیفی که در حال ارسال بوده و برنامه بسته/کرش شده.
 *
 * 🔴 دو حالت را **جدا** می‌کنیم، وگرنه «بازیابی» خودش باعث ارسال دوباره می‌شود:
 *   • نشانه‌ی `SENDING` مانده ⇒ پیام تحویل سرویس‌دهنده شده بوده و ممکن است
 *     رسیده باشد ⇒ `UNKNOWN` (تلاش خودکار ممنوع، تصمیم دستی).
 *   • بدون نشانه ⇒ هنوز به سرویس‌دهنده نرسیده بودیم ⇒ `PENDING` و دوباره می‌رود.
 */
export async function recoverStale(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SMS_LOCK_TIMEOUT_MS)
  const stale = await (prisma as any).smsOutbox
    .findMany({
      where: { status: SmsOutboxStatus.PROCESSING, lockedAt: { lt: cutoff } },
      select: { id: true, providerStatus: true }
    })
    .catch(() => null)
  const rows: any[] = Array.isArray(stale) ? stale : []
  if (!rows.length) return 0

  const inFlight = rows.filter((r) => String(r?.providerStatus ?? '') === SENDING_MARKER).map((r) => r.id)
  const neverStarted = rows.filter((r) => String(r?.providerStatus ?? '') !== SENDING_MARKER).map((r) => r.id)

  let count = 0
  if (inFlight.length) {
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { id: { in: inFlight }, status: SmsOutboxStatus.PROCESSING },
      data: {
        status: SmsOutboxStatus.UNKNOWN,
        lockedAt: null,
        lockedBy: null,
        nextAttemptAt: null,
        lastErrorCode: 'RESULT_NOT_RECORDED',
        lastErrorMessage: 'برنامه وسط ارسال بسته شد؛ نمی‌دانیم پیام رسیده یا نه.'
      }
    })
    count += res?.count ?? 0
  }
  if (neverStarted.length) {
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { id: { in: neverStarted }, status: SmsOutboxStatus.PROCESSING },
      data: { status: SmsOutboxStatus.PENDING, lockedAt: null, lockedBy: null, nextAttemptAt: now }
    })
    count += res?.count ?? 0
  }
  return count
}

async function recordAttempt(input: {
  outboxId: number
  attemptNo: number
  startedAt: Date
  result: string
  httpStatus?: number | null
  providerMessageId?: string | null
  errorCode?: string | null
  errorMessage?: string | null
}): Promise<void> {
  try {
    await (prisma as any).smsAttempt.create({
      data: {
        outboxId: input.outboxId,
        attemptNo: input.attemptNo,
        startedAt: input.startedAt,
        finishedAt: new Date(),
        result: input.result,
        httpStatus: input.httpStatus ?? null,
        providerMessageId: input.providerMessageId ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null
      }
    })
  } catch (e) {
    console.error('[sms:attempt] failed', e)
  }
}

/**
 * `variablesJson` همیشه JSON معتبر نیست (رکورد قدیمی/دست‌کاری دستی). اگر
 * خراب بود `null` برمی‌گردد تا آداپتور به‌جای «ارسال الگوییِ ناقص»، متن کامل را
 * بفرستد — پیام نباید به‌خاطر یک ستون خراب گم شود.
 */
function parseVariables(raw: unknown): Record<string, unknown> | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** ارسال یک ردیف قفل‌شده و ثبت نتیجه‌اش. */
async function processOne(
  row: any,
  providerCfg: { id: number | null; providerKey: string },
  now: Date
): Promise<void> {
  /**
   * 🔒 قفل «لغو ۱۱» — **بار دوم، درست قبل از ارسال**.
   *
   * تا امروز این بررسی فقط موقع ورود به صف انجام می‌شد. ولی کمپین ۱۰۰۰ نفره
   * می‌تواند ساعت‌ها در صف بماند و آدم‌ها در همین فاصله «لغو ۱۱» می‌کنند؛
   * فرستادن پیام تبلیغاتی برای آن‌ها هم تخلف مقرراتی است و هم شکایت ۱۹۵ را
   * دنبال دارد. پس این‌جا دوباره می‌پرسیم و ردیف را «لغوشده» می‌کنیم — بدون
   * مصرف هیچ تلاشی.
   */
  if (smsNeedsOptOutNote(row.eventType)) {
    const phone = String(row.phoneSnapshot ?? '')
    // پرس‌وجو میلی‌ثانیه‌ها قبل از ارسال انجام می‌شود، نه در ابتدای دور صف؛
    // هر دور حداکثر ۵ ردیف برمی‌دارد، پس هزینه‌اش ناچیز است.
    let optRow: unknown = null
    try {
      optRow = await (prisma as any).smsOptOut.findUnique({ where: { phone } })
    } catch (e) {
      /**
       * 🔒 «شکست بسته» (fail-closed): اگر نتوانستیم بپرسیم «این شماره لغو کرده
       * یا نه؟»، جواب امن «نمی‌دانم» است، نه «نه». پیام در صف می‌ماند و یک
       * دقیقه بعد دوباره بررسی می‌شود؛ ارسال تبلیغ برای شماره‌ای که لغو کرده
       * هم تخلف است و هم برگشت‌ناپذیر.
       */
      console.error('[sms:optout] read failed', e)
      await (prisma as any).smsOutbox
        .updateMany({
          where: { id: row.id, status: SmsOutboxStatus.PROCESSING },
          data: {
            status: SmsOutboxStatus.PENDING,
            lockedAt: null,
            lockedBy: null,
            nextAttemptAt: new Date(now.getTime() + 60_000)
          }
        })
        .catch(() => undefined)
      return
    }
    const opted = Boolean(optRow)
    if (opted) {
      await (prisma as any).smsOutbox.update({
        where: { id: row.id },
        data: {
          status: SmsOutboxStatus.CANCELED,
          lockedAt: null,
          lockedBy: null,
          nextAttemptAt: null,
          lastErrorCode: 'OPT_OUT',
          lastErrorMessage: 'این شماره «لغو ۱۱» کرده است، پس پیام تبلیغاتی برایش ارسال نشد.'
        }
      })
      return
    }
  }

  const provider = getSmsProvider(providerCfg.providerKey)
  const cfg = await secretsOf(providerCfg.id)

  const attemptsMade = Math.max(0, Math.round(Number(row.attemptCount ?? 0)))
  const maxAttempts = Math.max(1, Math.round(Number(row.maxAttempts ?? SMS_MAX_ATTEMPTS)))

  /**
   * ⏱ «شروع تلاش» را **قبل** از تماس با سرویس‌دهنده ثبت می‌کنیم.
   *
   * فایده‌ی اول: اگر برنامه وسط `fetch` بمیرد، هنگام بیدار شدن می‌فهمیم این
   * ردیف تحویلِ سرویس‌دهنده شده بوده ⇒ `UNKNOWN`، نه `PENDING` (وگرنه پیام
   * دوباره می‌رفت).
   * فایده‌ی دوم: شمارنده‌ی تلاش صادقانه بالا می‌رود، حتی اگر ثبتِ *نتیجه*
   * ناموفق باشد.
   */
  const started = await (prisma as any).smsOutbox.updateMany({
    where: { id: row.id, status: SmsOutboxStatus.PROCESSING },
    data: { attemptCount: attemptsMade + 1, lastAttemptAt: now, providerStatus: SENDING_MARKER }
  })
  // اگر قفل از دست رفته باشد (لغو هم‌زمان/کارگر دیگر)، این ردیف مال ما نیست.
  if (!(started?.count ?? 0)) return

  /**
   * ✋ «الگو یا متن؟» — تصمیمِ صاحب فروشگاه، نه پیش‌فرض پنهان.
   *
   * اگر روی این خط `patternId` پر باشد، پیام‌های خدماتی با **الگوی تأییدشده**
   * می‌رفتند و متنِ ویرایش‌شده‌ی کاربر (مثلاً تشکری که خودش نوشته) هیچ‌وقت
   * ارسال نمی‌شد، بی‌آنکه جایی گفته شود. حالا اگر `patternForService` خاموش
   * باشد، متن کامل می‌رود.
   */
  const usesPattern = smsLinePurposeForEvent(row.eventType) === 'SERVICE' && cfg.patternForService !== false

  let res
  try {
    res = await provider.send(cfg, {
      phone: String(row.phoneSnapshot ?? ''),
      text: String(row.bodySnapshot ?? ''),
      patternId: usesPattern ? (cfg.patternId ?? null) : null,
      senderNumber: cfg.senderNumber ?? null,
      idempotencyKey: String(row.dedupeKey ?? ''),
      // متغیرهای قالب برای «ارسال الگویی» — اگر خراب/خالی باشد، ارسال متن‌کامل می‌شود
      variables: parseVariables(row.variablesJson)
    })
  } catch (e: any) {
    // خطای غیرمنتظره‌ی آداپتور: صف نباید بیفتد، پیام نباید دور برود
    res = {
      accepted: false,
      providerMessageId: null,
      retryable: true,
      errorCode: 'ADAPTER_THREW',
      errorMessage: String(e?.message ?? e).slice(0, 200),
      detail: 'خطای غیرمنتظره در ارتباط با سرویس‌دهنده.'
    }
  }

  const nextCount = attemptsMade + 1
  const base = {
    /**
     * کدام خط این پیام را برداشت. با خط خدماتی/تبلیغاتیِ جدا، «از کدام خط رفت؟»
     * یک سؤال واقعی است (هم برای سابقه، هم برای اینکه معلوم شود مسیریابی
     * درست کار کرده). قبلاً این ستون هیچ‌وقت پر نمی‌شد.
     */
    providerConfigId: providerCfg.id ?? null,
    attemptCount: nextCount,
    lastAttemptAt: new Date(),
    lockedAt: null,
    lockedBy: null,
    lastErrorCode: res.errorCode ?? null,
    lastErrorMessage: res.errorMessage ?? null,
    providerStatus: res.detail ?? null
  }

  if (res.accepted) {
    await (prisma as any).smsOutbox.update({
      where: { id: row.id },
      data: {
        ...base,
        status: SmsOutboxStatus.SENT,
        sentAt: new Date(),
        providerMessageId: res.providerMessageId ?? null,
        lastErrorCode: null,
        lastErrorMessage: null,
        nextAttemptAt: null
      }
    })
    emitOutcome(row, 'SENT', 'پیام به سرویس‌دهنده سپرده شد.')
    await recordAttempt({
      outboxId: row.id,
      attemptNo: nextCount,
      startedAt: now,
      result: 'OK',
      httpStatus: res.httpStatus ?? null,
      providerMessageId: res.providerMessageId ?? null
    })
    return
  }

  // --- شکست ---------------------------------------------------------------
  const unknown = res.unknown === true
  const exhausted = nextCount >= maxAttempts

  /**
   * 🔴 «منتظرِ شرایط» (بازبینی هفتم، SMS-R7-01).
   *
   * آداپتور می‌گوید پیام را **نپذیرفتم** ولی مشکل موقتیِ محیط است (اینترنت،
   * اعتبار حساب، ۴۰۹، ۴۲۹، ۵۰۳). رفتار درست:
   *   • سهمیه‌ی ۵ تلاش مصرف نمی‌شود (وگرنه ۸۱ دقیقه قطعی اینترنت، پیام را
   *     برای همیشه `FAILED_FINAL` می‌کرد و بعد از وصل‌شدن هم خودکار نمی‌رفت).
   *   • با فاصله‌ی **ثابت** یک ساعت دوباره تلاش می‌شود (backoff نمایی اینجا
   *     بی‌معنی است؛ منتظرِ یک رخداد بیرونی هستیم، نه عقب‌نشینی از فشار).
   *   • تا ۷۲ ساعت از **شروعِ انتظار**؛ بعد از آن `FAILED_FINAL` می‌شود تا ردیف
   *     برای همیشه در صف نچرخد. پیام پاک نمی‌شود و «تلاش مجدد» دستی هست.
   *
   * 🔴 «شروع انتظار» کجاست؟ (بازبینی هشتم، SMS-R8-01)
   * تا پیش از این، سن از `createdAt` شمرده می‌شد. برای پیامی که برای چند روز
   * بعد **زمان‌بندی** شده (یا چند روز `PENDING` مانده چون خطی فعال نبوده)،
   * `createdAt` همان روزِ ثبت است؛ پس اولین خطای موقتی سرِ موعد، فوراً «کهنه»
   * حساب می‌شد و پیام در همان تلاش اول قطعی می‌شد — بی‌آنکه حتی یک بار فرصت
   * واقعی برای تلاش دوباره گرفته باشد. حالا مرجع، **اولین تلاشِ `WAITING`**
   * است؛ اگر چنین تلاشی ثبت نشده باشد، همین لحظه شروعِ انتظار است (و منقضی
   * نیست). نتیجه: سقف ۷۲ ساعت به «دوره‌ی انتظار» می‌چسبد، نه به عمر ردیف.
   *
   * ⚠️ این حالت `unknown` نیست: پاسخِ سرویس‌دهنده صریح است، پس خطر «پیام دوم
   * به همان مشتری» ندارد.
   */
  const waiting = res.waiting === true
  let waitingSince: Date | number = now.getTime()
  if (waiting) {
    /**
     * اولین تلاشی که نتیجه‌اش `WAITING` بوده = لحظه‌ای که انتظار شروع شده.
     * خواندنِ ناموفق این تاریخچه، رفتار قبلی را برنمی‌گرداند (محافظه‌کارانه:
     * انتظار تازه شروع شده) — چون هزینه‌ی اشتباه این‌طرف، فقط چند ساعت تلاش
     * بیشتر است، ولی آن‌طرف، «گم‌شدن» پیام است.
     */
    const firstWait = await (prisma as any).smsAttempt
      .findFirst({
        where: { outboxId: row.id, result: 'WAITING' },
        orderBy: { id: 'asc' },
        select: { startedAt: true }
      })
      .catch(() => null)
    const t = firstWait?.startedAt ? new Date(firstWait.startedAt).getTime() : 0
    if (Number.isFinite(t) && t > 0) waitingSince = t
  }
  const waitingExpired = waiting && smsWaitingExpired(waitingSince, now)
  /** «منتظرِ شرایط»ِ منقضی‌شده دیگر منتظر نمی‌ماند: قطعی می‌شود (ولی پاک نمی‌شود). */
  const stillWaiting = waiting && !waitingExpired
  const status = unknown
    ? SmsOutboxStatus.UNKNOWN
    : waiting
      ? // «منتظرِ شرایط»: تا سقف سنی در صف می‌ماند، بعد از آن قطعی می‌شود
        stillWaiting
        ? SmsOutboxStatus.FAILED_RETRYABLE
        : SmsOutboxStatus.FAILED_FINAL
      : res.retryable && !exhausted
        ? SmsOutboxStatus.FAILED_RETRYABLE
        : SmsOutboxStatus.FAILED_FINAL

  /** در حالت انتظار، بودجه‌ی تلاش دست‌نخورده می‌ماند (شمارنده پس نوشته می‌شود). */
  const budgetBurned = !stillWaiting
  const waitBackoff = stillWaiting ? SMS_WAITING_BACKOFF_MS : smsBackoffMs(nextCount)

  await (prisma as any).smsOutbox.update({
    where: { id: row.id },
    data: {
      ...base,
      attemptCount: budgetBurned ? nextCount : attemptsMade,
      status,
      nextAttemptAt: status === SmsOutboxStatus.FAILED_RETRYABLE ? new Date(Date.now() + waitBackoff) : null
    }
  })

  if (status === SmsOutboxStatus.FAILED_FINAL)
    emitOutcome(row, 'FAILED_FINAL', String(res.detail ?? 'ارسال قطعی ناموفق بود.'))
  await recordAttempt({
    outboxId: row.id,
    attemptNo: nextCount,
    startedAt: now,
    result: unknown ? 'UNKNOWN' : stillWaiting ? 'WAITING' : res.retryable ? 'RETRYABLE' : 'FINAL',
    httpStatus: res.httpStatus ?? null,
    errorCode: res.errorCode ?? null,
    errorMessage: res.errorMessage ?? null
  })
}

/**
 * یک دور کامل: بازیابی قفل‌های یتیم، برداشتن موعدها، و ارسال.
 *
 * خروجی برای تست و برای داشبورد است: چه چیزی و چرا نرفت.
 */
export async function runSmsQueueOnce(): Promise<{
  recovered: number
  picked: number
  sent: number
  failed: number
  /** تبلیغاتی‌هایی که همین لحظه معلوم شد شماره‌شان «لغو ۱۱» کرده و نرفتند */
  skipped: number
  blocked: string
}> {
  const out = { recovered: 0, picked: 0, sent: 0, failed: 0, skipped: 0, blocked: '' }
  try {
    out.recovered = await recoverStale()
  } catch (e) {
    console.error('[sms:recover] failed', e)
  }

  try {
    /**
     * خطِ هر پیام **جدا** انتخاب می‌شود، نه یکی برای همه:
     * پیام تبلیغاتی از خط تبلیغاتی و پیام خدماتی (تشکر/یادآوری) از خط خدماتی
     * می‌رود. اگر فقط یک خط «هر دو کاره» فعال باشد، همان جواب می‌دهد — یعنی
     * رفتار کسی که یک خط دارد عوض نمی‌شود.
     */
    const lines = await activeLines()
    if (!lines.length) {
      // قاعده‌ی ۳: بدون سرویس‌دهنده، هیچ تلاشی مصرف نمی‌شود.
      out.blocked = 'هیچ سرویس‌دهنده‌ی پیامکی فعال نشده است، پس پیام‌ها در صف منتظر می‌مانند.'
      return out
    }

    const now = new Date()
    /**
     * 🔴 گرسنگی صف: اگر فقط خط تبلیغاتی فعال باشد، پیام‌های خدماتی همیشه اول
     * صف هستند و `take` را پر می‌کنند؛ حاصلش این است که کمپین — که خطش فعال
     * است — هیچ‌وقت نمی‌رسد. پس از همان اول فقط سراغ پیام‌هایی می‌رویم که خط
     * مناسبشان فعال است.
     */
    const canService = Boolean(pickSmsLine(lines, 'SERVICE'))
    const canAds = Boolean(pickSmsLine(lines, 'ADS'))
    const eventFilter = !canAds
      ? { eventType: { not: SmsEventType.CAMPAIGN } }
      : !canService
        ? { eventType: SmsEventType.CAMPAIGN }
        : undefined
    /**
     * ⚠️ فیلتر بالا باعث می‌شود پیام‌های بی‌خط دیگر وارد دور نشوند؛ پس هشدار
     * «خط مناسب فعال نیست» را باید همین‌جا (با یک شمارش ارزان) بسازیم، وگرنه
     * مدیر هیچ‌وقت نمی‌فهمد چرا چیزی نمی‌رود.
     */
    const liveWaiting = async (wanted: 'SERVICE' | 'ADS'): Promise<number> =>
      (await (prisma as any).smsOutbox
        .count({
          where: {
            status: { in: [...SMS_LIVE_STATUSES] },
            eventType: wanted === 'ADS' ? SmsEventType.CAMPAIGN : { not: SmsEventType.CAMPAIGN }
          }
        })
        .catch(() => 0)) ?? 0

    if (!canAds && (await liveWaiting('ADS')) > 0)
      out.blocked = 'هیچ خط تبلیغاتی فعالی ندارید؛ پیام‌های انبوه در صف می‌مانند تا خط تبلیغاتی را فعال کنید.'
    if (!canService && (await liveWaiting('SERVICE')) > 0)
      out.blocked = 'هیچ خط خدماتی فعالی ندارید؛ پیام‌های تشکر و یادآوری در صف می‌مانند تا خط خدماتی را فعال کنید.'

    const rows = await pickDue(BATCH, now, eventFilter)
    out.picked = rows.length

    for (const row of rows) {
      const wanted = smsLinePurposeForEvent(row.eventType)
      const line = pickSmsLine(lines, wanted)
      if (!line) {
        /**
         * خط مناسبِ این نوع پیام فعال نیست. پیام **دست‌نخورده در صف می‌ماند**
         * و هیچ تلاشی هم مصرف نمی‌شود — فرستادن پیام خدماتی از خط تبلیغاتی
         * (یا برعکس) هم مقرراتی نیست و هم خط کاربر را به‌خطر می‌اندازد.
         */
        out.blocked =
          wanted === 'ADS'
            ? 'هیچ خط تبلیغاتی فعالی ندارید؛ پیام‌های انبوه در صف می‌مانند تا خط تبلیغاتی را فعال کنید.'
            : 'هیچ خط خدماتی فعالی ندارید؛ پیام‌های تشکر و یادآوری در صف می‌مانند تا خط خدماتی را فعال کنید.'
        continue
      }
      const claimed = await lockOne(row.id, now)
      if (!claimed) continue
      try {
        await processOne(row, { id: line.id, providerKey: line.providerKey }, now)
        const after = await (prisma as any).smsOutbox
          .findUnique({ where: { id: row.id }, select: { status: true } })
          .catch(() => null)
        if (after?.status === SmsOutboxStatus.SENT) out.sent++
        else if (after?.status === SmsOutboxStatus.CANCELED) out.skipped++
        else out.failed++
      } catch (e) {
        // پیام در PROCESSING گیر نکند
        console.error('[sms:process] failed', e)
        const cur = await (prisma as any).smsOutbox
          .findUnique({
            where: { id: row.id },
            select: { status: true, providerStatus: true, attemptCount: true }
          })
          .catch(() => null)
        /**
         * 🔴 تفکیک «نرفته» از «رفت ولی نتیجه ثبت نشد»:
         * نشانه‌ی `SENDING` یعنی `provider.send` صدا زده شده و پیام ممکن است
         * واقعاً رسیده باشد. تلاش خودکار روی چنین ردیفی = پیام دوباره برای
         * مشتری، پس `UNKNOWN` می‌شود و تصمیمش با آدم است (دکمه‌ی «تلاش مجدد»).
         */
        const inFlight = String(cur?.providerStatus ?? '') === SENDING_MARKER
        await (prisma as any).smsOutbox
          .updateMany({
            where: { id: row.id, status: SmsOutboxStatus.PROCESSING },
            data: inFlight
              ? {
                  status: SmsOutboxStatus.UNKNOWN,
                  lockedAt: null,
                  lockedBy: null,
                  nextAttemptAt: null,
                  lastErrorCode: 'RESULT_NOT_RECORDED',
                  lastErrorMessage:
                    'پیام به سرویس‌دهنده سپرده شد ولی ثبت نتیجه ناموفق بود؛ وضعیت نامعلوم است.'
                }
              : { status: SmsOutboxStatus.FAILED_RETRYABLE, lockedAt: null, lockedBy: null, nextAttemptAt: new Date() }
          })
          .catch(() => undefined)
        /**
         * سابقه‌ی تلاش هم ثبت می‌شود: «چند بار تلاش شد؟» سؤال واقعی مدیر است و
         * ردیفی که در «نامعلوم» می‌نشیند باید بگوید چرا.
         */
        await recordAttempt({
          outboxId: row.id,
          attemptNo: Math.max(1, Math.round(Number(cur?.attemptCount ?? 1)) || 1),
          startedAt: now,
          result: inFlight ? 'UNKNOWN' : 'RETRYABLE',
          errorCode: inFlight ? 'RESULT_NOT_RECORDED' : 'PROCESS_FAILED',
          errorMessage: String((e as any)?.message ?? e).slice(0, 200)
        })
        out.failed++
      }
    }
  } catch (e) {
    console.error('[sms:run] failed', e)
    out.blocked = 'اجرای صف با خطا متوقف شد.'
  }
  return out
}

// ---------------------------------------------------------------------------
// کارگر دوره‌ای
// ---------------------------------------------------------------------------

let timer: NodeJS.Timeout | null = null
let running = false

function scheduleSmsQueue(intervalMs = TICK_MS): void {
  if (timer) return
  timer = setInterval(() => {
    if (running) return
    running = true
    runSmsQueueOnce()
      .catch((e) => console.error('[sms:tick] failed', e))
      .finally(() => {
        running = false
      })
  }, Math.max(5_000, intervalMs))
  // تایمر نباید جلوی بسته‌شدن برنامه را بگیرد
  ;(timer as any).unref?.()
}

export function startSmsQueue(intervalMs?: number): void {
  scheduleSmsQueue(intervalMs)
}

export function stopSmsQueue(): void {
  if (timer) clearInterval(timer)
  timer = null
}

// ---------------------------------------------------------------------------
// عملیات دستی روی یک پیام
// ---------------------------------------------------------------------------

async function loadOutbox(idInput: number): Promise<any> {
  const id = Math.round(Number(idInput))
  if (!Number.isFinite(id) || id <= 0) throw new BusinessError('شناسه‌ی پیام نامعتبر است.')
  const row = await (prisma as any).smsOutbox.findUnique({ where: { id } })
  if (!row) throw new BusinessError('این پیام در صف پیدا نشد.')
  return row
}

export const smsQueueService = {
  /**
   * اطلاعات سبک یک پیام — لایه‌ی IPC از همین می‌فهمد «برگرداندن به صف» برای
   * این ردیف عملیات حساس است یا روزمره (پیام کمپین ⇒ قفل `smsDanger`).
   */
  async meta(idInput: number): Promise<{ id: number; eventType: string; status: string; isCampaign: boolean }> {
    const row = await loadOutbox(idInput)
    const eventType = String(row.eventType ?? '')
    return {
      id: row.id,
      eventType,
      status: String(row.status ?? ''),
      isCampaign: eventType === SmsEventType.CAMPAIGN
    }
  },

  /** لغو یک پیامِ **ارسال‌نشده**. لغو ≠ حذف: رکورد می‌ماند و دلیلش ثبت می‌شود. */
  async cancel(idInput: number, input: { reason?: string; userId?: number | null } = {}) {
    const row = await loadOutbox(idInput)
    if (!isSmsCancelable(row.status)) {
      throw new BusinessError(
        row.status === SmsOutboxStatus.SENT
          ? 'این پیام قبلاً ارسال شده است و لغو نمی‌شود.'
          : `این پیام در وضعیت «${row.status}» است و قابل لغو نیست.`
      )
    }
    const now = new Date()
    /**
     * 🔒 نوشتن **شرطی**، نه بی‌شرط.
     *
     * حالتی که این را لازم می‌کند: همان لحظه‌ای که کاربر «لغو» می‌زند، کارگر
     * صف پیام را برداشته و فرستاده است. با `update({where:{id}})` وضعیت SENT
     * به CANCELED نوشته می‌شد و «برگرداندن به صف» («لغو ⇒ برگشت‌پذیر») همان
     * پیام را **بار دوم** به مشتری می‌فرستاد. حالا اگر وضعیت عوض شده باشد،
     * به کاربر می‌گوییم «دیر شد» و دست به ردیف نمی‌زنیم.
     */
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { id: row.id, status: { in: [...SMS_CANCELABLE_STATUSES] } },
      data: {
        status: SmsOutboxStatus.CANCELED,
        canceledAt: now,
        canceledByUserId: input?.userId ?? null,
        cancelReason: String(input?.reason ?? '').trim() || null,
        nextAttemptAt: null,
        lockedAt: null,
        lockedBy: null
      }
    })
    if (!(res?.count ?? 0)) {
      const fresh = await loadOutbox(row.id).catch(() => null)
      throw new BusinessError(
        String(fresh?.status ?? '') === SmsOutboxStatus.SENT
          ? 'این پیام همین حالا ارسال شد و دیگر لغو نمی‌شود.'
          : 'این پیام همین حالا در حال ارسال است و لغو نشد.'
      )
    }
    const next = await loadOutbox(row.id)
    emitOutcome(row, 'CANCELED', String(input?.reason ?? '').trim() || 'لغو دستی توسط مدیر.')
    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_CANCEL,
      entity: 'SmsOutbox',
      entityId: row.id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ status: row.status }),
      after: JSON.stringify({ status: next.status }),
      note: `لغو ارسال پیام ${row.eventType} به شماره ***${String(row.phoneSnapshot ?? '').slice(-4)}`
    })
    return next
  },

  /** لغو گروهی — با تأیید صریح کاربر در UI. */
  async cancelBulk(idsInput: unknown, input: { reason?: string; userId?: number | null } = {}) {
    const ids = Array.isArray(idsInput)
      ? idsInput.map((n) => Math.round(Number(n))).filter((n) => n > 0).slice(0, 500)
      : []
    if (!ids.length) throw new BusinessError('هیچ پیامی انتخاب نشده است.')
    const now = new Date()
    /**
     * 🔴 گزارش «لغو گروهی» فقط برای ردیف‌هایی که **همین فراخوانی** لغوشان کرد.
     *
     * باگ دوم بازبینی چهارم: UI همه‌ی idهای فهرست را می‌فرستد و همین‌جا با
     * `findMany({ status: CANCELED })` روی همان idها دوباره `CANCELED` منتشر
     * می‌شد — حتی برای ردیفی که **دیروز** لغو شده بود. آن رویداد تکراری در
     * ماژول اعتبار «جدیدترین یادآوریِ LOGGED» را آزاد می‌کرد؛ یعنی سهمیه‌ی
     * یادآوریِ **واقعاً تحویل‌شده** برمی‌گشت و فردا یادآوری سوم می‌رفت.
     *
     * پس اول می‌خوانیم چه چیزی واقعاً لغوپذیر است، بعد همان‌ها را می‌لغویم و
     * فقط برای همان‌ها خبر می‌دهیم.
     */
    const cancelable = await (prisma as any).smsOutbox
      .findMany({
        where: { id: { in: ids }, status: { in: [SmsOutboxStatus.PENDING, SmsOutboxStatus.FAILED_RETRYABLE] } }
      })
      .catch(() => [])
    const cancelableRows: any[] = Array.isArray(cancelable) ? cancelable : []
    const res = cancelableRows.length
      ? await (prisma as any).smsOutbox.updateMany({
          where: {
            id: { in: cancelableRows.map((r) => r.id) },
            status: { in: [SmsOutboxStatus.PENDING, SmsOutboxStatus.FAILED_RETRYABLE] }
          },
          data: {
            status: SmsOutboxStatus.CANCELED,
            canceledAt: now,
            canceledByUserId: input?.userId ?? null,
            cancelReason: String(input?.reason ?? '').trim() || null,
            nextAttemptAt: null,
            lockedAt: null,
            lockedBy: null
          }
        })
      : { count: 0 }
    if (res?.count) {
      // فقط ردیف‌هایی که همین حالا از «زنده» به «لغو» رفتند خبر می‌گیرند.
      const stillCanceled = await (prisma as any).smsOutbox
        .findMany({
          where: { id: { in: cancelableRows.map((r) => r.id) }, status: SmsOutboxStatus.CANCELED }
        })
        .catch(() => [])
      for (const row of stillCanceled ?? [])
        emitOutcome(row, 'CANCELED', String(input?.reason ?? '').trim() || 'لغو گروهی توسط مدیر.')
    }
    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_CANCEL_BULK,
      entity: 'SmsOutbox',
      entityId: null,
      userId: input?.userId ?? null,
      after: JSON.stringify({ requested: ids.length, canceled: res?.count ?? 0 }),
      note: `لغو گروهی ${res?.count ?? 0} پیام ارسال‌نشده`
    })
    return { requested: ids.length, canceled: res?.count ?? 0 }
  },

  /**
   * برگرداندن یک پیام لغوشده/ناموفق‌قطعی به صف (جبران لغو اشتباهی).
   *
   * 🚫 **یادآوری اعتبار، فقط از راه پل.** اگر این ردیف یادآوریِ اعتبار باشد و
   * سهمیه‌اش آزاد شده باشد (لغو/ناموفقِ قطعی)، برگرداندنش از مسیرهای دستی
   * یعنی «پیام می‌رود ولی سهمیه مصرف نمی‌شود» ⇒ فردا یادآوری تکراری برای همان
   * مشتری (باگ اول بازبینی چهارم). تنها مسیری که سهمیه را درست مصرف می‌کند
   * `source: 'credit_bridge'` است: پلِ ماژول اعتبار از همین استفاده می‌کند و
   * خودش در `queueReminder` سهمیه را می‌شمارد.
   */
  async requeue(idInput: number, input: { userId?: number | null; source?: 'panel' | 'credit_bridge' } = {}) {
    const row = await loadOutbox(idInput)
    if (!isSmsRequeueable(row.status)) {
      throw new BusinessError(`این پیام در وضعیت «${row.status}» است و به صف برنمی‌گردد.`)
    }
    if (input?.source !== 'credit_bridge' && smsReminderManualResendBlocked(row.eventType, row.status)) {
      throw new BusinessError(
        'این یادآوری اعتبار لغو/ناموفق شده و سهمیه‌اش آزاد شده است؛ برگرداندن دستی آن، یادآوری تکراری می‌سازد. ' +
          'برای فرستادن دوباره، در پنل اعتبار خرید روی «یادآوری» همان کد بزنید.'
      )
    }
    /** همان داستان «لغو»: نوشتن شرطی تا با کارگر صف مسابقه ندهیم. */
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { id: row.id, status: { in: [SmsOutboxStatus.CANCELED, SmsOutboxStatus.FAILED_FINAL] } },
      data: {
        status: SmsOutboxStatus.PENDING,
        nextAttemptAt: new Date(),
        canceledAt: null,
        canceledByUserId: null,
        cancelReason: null,
        attemptCount: 0,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    })
    if (!(res?.count ?? 0)) throw new BusinessError('وضعیت این پیام عوض شده است؛ دوباره فهرست را باز کنید.')
    const next = await loadOutbox(row.id)
    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_REQUEUE,
      entity: 'SmsOutbox',
      entityId: row.id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ status: row.status }),
      after: JSON.stringify({ status: next.status }),
      note: `برگرداندن پیام ${row.eventType} به صف`
    })
    return next
  },

  /** «الان تلاش کن» روی یک پیام ناموفق. */
  async retryNow(idInput: number, input: { userId?: number | null } = {}) {
    const row = await loadOutbox(idInput)
    if (row.status === SmsOutboxStatus.SENT) throw new BusinessError('این پیام قبلاً ارسال شده است.')
    if (row.status === SmsOutboxStatus.PROCESSING) throw new BusinessError('این پیام همین حالا در حال ارسال است.')
    /** همان گارد «برگرداندن به صف» — یادآوریِ سهمیه‌آزادشده از اینجا نمی‌رود. */
    if (smsReminderManualResendBlocked(row.eventType, row.status)) {
      throw new BusinessError(
        'این یادآوری اعتبار لغو/ناموفق شده و سهمیه‌اش آزاد شده است؛ «تلاش مجدد» اینجا یادآوری تکراری می‌سازد. ' +
          'برای فرستادن دوباره، در پنل اعتبار خرید روی «یادآوری» همان کد بزنید.'
      )
    }
    /**
     * «تلاش مجدد» روی ردیفِ در حال ارسال نباید بنویسد — وگرنه کارگرِ در حال
     * کار همان پیام را دوباره برمی‌دارد و مشتری دو پیام می‌گیرد. فقط
     * وضعیت‌هایی که «مالک ندارند» پذیرفته می‌شوند.
     */
    const allowed = [
      SmsOutboxStatus.PENDING,
      SmsOutboxStatus.FAILED_RETRYABLE,
      SmsOutboxStatus.FAILED_FINAL,
      SmsOutboxStatus.CANCELED,
      SmsOutboxStatus.UNKNOWN
    ]
    const res = await (prisma as any).smsOutbox.updateMany({
      where: { id: row.id, status: { in: allowed } },
      data: {
        status: SmsOutboxStatus.PENDING,
        nextAttemptAt: new Date(),
        scheduledAt: null,
        lockedAt: null,
        lockedBy: null
      }
    })
    if (!(res?.count ?? 0))
      throw new BusinessError('وضعیت این پیام عوض شده است؛ یک بار فهرست را تازه کنید.')
    const next = await loadOutbox(row.id)
    await audit(prisma, {
      action: AuditAction.SMS_OUTBOX_RETRY,
      entity: 'SmsOutbox',
      entityId: row.id,
      userId: input?.userId ?? null,
      before: JSON.stringify({ status: row.status }),
      after: JSON.stringify({ status: next.status }),
      note: `تلاش مجدد دستی روی پیام ${row.eventType}`
    })
    return next
  }
}
