/**
 * ===========================================================================
 * پلِ «یادآوری اعتبار» ← «صف پیامک».
 *
 * ماژول اعتبار (`StoreCreditService.queueReminder`) از روز اول پشت درزی نوشته
 * شده بود که خودش می‌گفت: «نمی‌دانم پیام چطور می‌رود؛ فقط
 * `notificationSender().send(phone, text)` را صدا می‌زنم.» این فایل همان
 * پیاده‌سازی واقعی است و **یک بار در بوت** با `setNotificationSender` تزریق
 * می‌شود.
 *
 * چرا تزریق از بیرون و نه import مستقیم: اگر ماژول اعتبار مستقیم ماژول پیامک
 * را import می‌کرد، یا برعکس، دو ماژول به هم قفل می‌شدند. اینجا هیچ‌کدام از دو
 * طرف، طرف دیگر را نمی‌شناسد؛ فقط بوت آن‌ها را به هم می‌دوزد.
 *
 * قاعده‌های رفتاری:
 *   • اینجا **ارسال واقعی** انجام نمی‌شود؛ فقط پیام در صف می‌نشیند. کارگر صف
 *     (هر ۲۰ ثانیه) می‌فرستد — پس قطعی اینترنت یعنی «بعداً می‌رود»، نه «گم شد».
 *     (بازبینی هفتم: این «بعداً» تا ۷۲ ساعت خودکار ادامه دارد؛ سقف ۵ تلاش برای
 *     شکست‌های موقتیِ محیط — اینترنت/اعتبار — مصرف نمی‌شود.)
 *   • `res.ok: true` یعنی «صف پذیرفت» (همان معنایی که سهمیه‌ی اعتبار انتظار
 *     دارد: تحویل به فرستنده). شکست واقعی، در پنل پیامک و با وضعیت قرمز
 *     دیده می‌شود و سهمیه‌ی اعتبار را مصرف نمی‌کند.
 *   • کلید یکتا: (روز + شماره + اثر انگشت متن). نتیجه:
 *       – دو بار کلیک در یک روز ⇒ یک پیام،
 *       – دو کد اعتبار متفاوت برای یک شماره ⇒ دو پیام،
 *       – یادآوری مجاز در روز دیگر (پس از پنجره‌ی ضداسپم) ⇒ می‌رود.
 * ===========================================================================
 */
import { enqueueSms, smsQueueService } from './SmsQueue'
import { prisma } from '../../db/client'
import { isSmsRequeueable, smsDedupeKey } from '@shared/sms'
import type { NotificationResult, NotificationSender } from '../NotificationSender'

/**
 * اثر انگشت کوتاه و پایدار از متن.
 *
 * ⚠️ این «امنیت» نیست؛ فقط یک شناسه‌ی یکتای محلی است تا دو متن متفاوت (دو کد
 * اعتبار مختلف) کلید یکتای یکسان نگیرند. هیچ متن پیامی در کلید نمی‌نشیند.
 */
function textFingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** کلید روز (به وقت محلی) — همان الگوی «یک بار در روز» که زمان‌بند استفاده می‌کند. */
function dayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export const smsNotificationSender: NotificationSender = {
  name: 'پنل پیامک',
  /**
   * آری، این فرستنده «زنده» است: پیام واقعاً از صف بیرون می‌رود — به شرطی که
   * در پنل پیامک یک سرویس‌دهنده‌ی فعال با کلید درست تنظیم شده باشد. اگر نشده
   * باشد، پیام در صف **منتظر می‌ماند** (نه اینکه دور ریخته شود) و پنل همان
   * هشدار زرد همیشگی را نشان می‌دهد.
   */
  live: true,

  async send(phone: string, text: string): Promise<NotificationResult> {
    return sendInternal(phone, text, null)
  },

  /**
   * با شناسه‌ی کد اعتبار. همین شناسه روی ردیف صف می‌نشیند تا اگر پیام هرگز
   * واقعاً نرفت، سهمیه‌ی یادآوری برگردد (نگاه کنید به `setSmsOutcomeHook`).
   */
  async sendReminder(input: { phone: string; text: string; creditId: number | null }): Promise<NotificationResult> {
    return sendInternal(input?.phone, input?.text, input?.creditId ?? null)
  }
}

async function sendInternal(
  phoneInput: unknown,
  textInput: unknown,
  creditId: number | null
): Promise<NotificationResult> {
  const phone = String(phoneInput ?? '').trim()
  const body = String(textInput ?? '').trim()
  if (!body) return { ok: false, externalId: null, detail: 'متن یادآوری خالی بود، پس چیزی در صف ننشست.' }

  const day = dayKey(new Date())
  const dedupeKey = smsDedupeKey({
    eventType: 'CREDIT_REMINDER',
    entityType: 'CreditReminder',
    entityId: `${day}|${textFingerprint(body)}`,
    templateCode: 'CREDIT_REMINDER',
    phone
  })
  const res = await enqueueSms({
    eventType: 'CREDIT_REMINDER',
    phone,
    body,
    priority: 3,
    relatedEntity: 'CreditReminder',
    /**
     * شناسه‌ی کد اعتبار روی ردیف صف می‌نشیند (اگر معلوم باشد). با همین است که
     * اگر پیام هرگز واقعاً نرفت، سهمیه‌ی یادآوری همان کد آزاد می‌شود.
     */
    relatedEntityId: creditId,
    dedupeKey
  })

  /**
   * 🔁 «تکراری» یعنی **پیام تازه‌ای ساخته نشد** — پس «موفق» نیست.
   *
   * چرا `ok: true` خطرناک بود: مصرف‌کننده (`queueReminder`) هر `ok: true` را
   * «تحویل‌شده» می‌شمارد و سهمیه‌ی یادآوری را یک بار مصرف می‌کند. با دو کلیک
   * پشت‌سرهم، یک پیامک ساخته می‌شد ولی **دو** بار از سهمیه کم می‌شد و
   * `lastReminderAt` جلو می‌رفت؛ یعنی سقف ۳ تایی با ۲ کلیک تمام می‌شد.
   */
  if (res.duplicate) {
    /**
     * 🔁 استثنای مهم: اگر همان پیام **قبلاً ساخته شده ولی هرگز نرفته**
     * (لغو دستی مدیر، یا شکست قطعی)، حق نداریم بگوییم «تکراری است» و پیام را
     * گم کنیم.
     *
     * چرا: مدیر پیام‌گیرِ صف را لغو می‌کند تا مثلاً بعد از قطعی اینترنت دوباره
     * بفرستد — و همین لحظه سهمیه‌ی یادآوری آزاد می‌شود. ولی «کلید یکتای روز»
     * جلوی ساخت پیام تازه را می‌گرفت و نتیجه‌اش این می‌شد: سهمیه آزاد، لاگ
     * «ثبت شد»، و **هیچ پیامکی که هرگز نرود**. اینجا همان ردیف لغو/ناموفق را
     * (که دقیقاً همین پیام است) به صف برمی‌گردانیم.
     *
     * ⚠️ فقط وضعیت‌های پایانیِ **ارسال‌نشده** (`CANCELED` / `FAILED_FINAL`)
     * برمی‌گردند. `SENT`، `PROCESSING` و `UNKNOWN` دست‌نخورده می‌مانند — وگرنه
     * ممکن بود مشتری دو پیام بگیرد.
     */
    const existing = await (prisma as any).smsOutbox
      .findUnique({ where: { dedupeKey } })
      .catch(() => null)
    if (existing?.id && isSmsRequeueable(existing.status)) {
      try {
        // `credit_bridge`: همین مسیر سهمیه را در `queueReminder` مصرف می‌کند،
        // پس گاردِ «یادآوریِ سهمیه‌آزادشده» عمداً برایش باز است.
        await smsQueueService.requeue(existing.id, { source: 'credit_bridge' })
        return {
          ok: true,
          externalId: String(existing.id),
          detail: 'همین یادآوری قبلاً ثبت شده بود ولی ارسال نشده بود؛ دوباره به صف برگشت.'
        }
      } catch {
        /* مسابقه: بین خواندن و برگرداندن، وضعیت عوض شد ⇒ همراستا با تکراری */
      }
    }
    return {
      ok: false,
      externalId: null,
      detail: 'همین یادآوری امروز قبلاً در صف ثبت شده بود؛ پیام تکراری ساخته نشد و سهمیه مصرف نشد.'
    }
  }
  if (res.skipped || !res.ok) {
    return { ok: false, externalId: null, detail: res.detail || 'ثبت در صف پیامک ناموفق بود.' }
  }
  return {
    ok: true,
    externalId: res.id == null ? null : String(res.id),
    detail: 'یادآوری در صف پیامک ثبت شد؛ کارگر صف کم‌کم می‌فرستد.'
  }
}
