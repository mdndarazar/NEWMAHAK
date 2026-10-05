/**
 * ===========================================================================
 * «فرستنده‌ی پیام» — یک اینترفیس انتزاعی، بدون هیچ اتصال واقعی (§۱۴ سند مرجع).
 *
 * وضعیت امروز: هیچ سرویس SMS در این نرم‌افزار وصل نیست و در این فاز هم وصل
 * نمی‌شود. ولی چون به‌زودی یک «پنل پیامک» جداگانه اضافه می‌شود، منطق یادآوری
 * اعتبار خرید از همین حالا پشت یک اینترفیس نوشته شده است:
 *
 *   • `StoreCreditService.queueReminder` هیچ‌وقت نمی‌داند پیام چطور می‌رود؛ فقط
 *     `notificationSender().send(phone, text)` را صدا می‌زند.
 *   • پیاده‌سازی فعلی (`logOnlyNotificationSender`) **فقط در کنسول لاگ می‌کند** و
 *     ردیف `CreditReminderLog` با وضعیت «ثبت شد (بدون ارسال واقعی)» می‌ماند.
 *   • وقتی پنل پیامک آمد، *فقط* `setNotificationSender(...)` یک بار در بوت صدا
 *     زده می‌شود. هیچ ساختار داده، هیچ متن، و هیچ خطی از منطق «باید بفرستد یا
 *     نه» عوض نمی‌شود.
 *
 * ⚠️ قاعده‌ی سخت: این فایل **هرگز** نباید به شبکه/API خارجی وصل شود. اتصال
 * واقعی، کار پنل پیامک است و آن پنل باید پیاده‌سازی خودش را تزریق کند.
 * ===========================================================================
 */

export interface NotificationResult {
  /** پیام «پردازش» شد؟ (در پیاده‌سازی فعلی یعنی «لاگ شد»، نه «ارسال شد») */
  ok: boolean
  /** شناسه‌ی پیام در سرویس بیرونی — در این فاز همیشه null */
  externalId: string | null
  /** توضیح فارسیِ آماده برای نمایش در UI */
  detail: string
}

export interface NotificationSender {
  /** نام پیاده‌سازی (در UI نشان داده می‌شود تا کاربر بداند واقعاً ارسالی هست یا نه) */
  readonly name: string
  /** ارسال واقعی وجود دارد؟ UI روی همین `false` جمله‌ی «آماده‌ی ارسال» را می‌گوید */
  readonly live: boolean
  send(phone: string, text: string): Promise<NotificationResult>
  /**
   * همان `send`، با «شناسه‌ی موضوع» (مثلاً کد اعتبار).
   *
   * چرا لازم است: سهمیه‌ی یادآوری وقتی مصرف می‌شود که پیام **پذیرفته** شود، ولی
   * پیام می‌تواند بعداً در صف شکست بخورد. برای «آزادکردن» همان سهمیه، ماژول
   * پیامک باید بداند این ردیف به کدام اعتبار مربوط است. اختیاری است: هر
   * پیاده‌سازی‌ای که این را نفهمد، همان `send` را دارد.
   */
  sendReminder?(input: { phone: string; text: string; creditId: number | null }): Promise<NotificationResult>
}

/**
 * پیاده‌سازی پیش‌فرض و تنها پیاده‌سازی این فاز: فقط لاگ.
 * هیچ تماس شبکه‌ای، هیچ کلید API، هیچ وابستگی بیرونی.
 */
export const logOnlyNotificationSender: NotificationSender = {
  name: 'ثبت در سابقه (بدون ارسال واقعی)',
  live: false,
  async send(phone: string, text: string): Promise<NotificationResult> {
    const clean = String(phone ?? '').trim()
    if (!clean) {
      return {
        ok: false,
        externalId: null,
        detail: 'شماره تماسی ثبت نشده بود، پس پیامی در صف قرار نگرفت.'
      }
    }
    console.info('[notify:log-only]', clean, '=>', String(text ?? '').slice(0, 200))
    return {
      ok: true,
      externalId: null,
      detail:
        'متن پیام ساخته و در سابقه ثبت شد، ولی ارسال واقعی انجام نشد ' +
        '(سرویس پیامک در این نسخه وصل نیست؛ با اضافه شدن «پنل پیامک» همین ردیف‌ها ارسال می‌شوند).'
    }
  }
}

let current: NotificationSender = logOnlyNotificationSender

/** تنها نقطه‌ی تعویض پیاده‌سازی (کار «پنل پیامک» آینده). */
export function setNotificationSender(sender: NotificationSender): void {
  current = sender ?? logOnlyNotificationSender
}

/** فرستنده‌ی فعال. سرویس‌ها همیشه از همین تابع می‌گیرند، نه از یک متغیر مستقیم. */
export function notificationSender(): NotificationSender {
  return current
}
