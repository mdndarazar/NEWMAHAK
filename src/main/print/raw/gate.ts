/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «دروازه‌ی روشن‌کردن مسیر دقیق (RAW)».
 *
 * چرا فایل جداست؟ چون `SettingsService` (که همه‌جای برنامه import می‌شود) فقط
 * باید همین منطق سبک را بگیرد؛ نه گراف سنگین رندر/ارسال خام (electron +
 * BrowserWindow + child_process). پس این ماژول **هیچ import سنگینی ندارد**.
 *
 * قاعده (بخش ۷.۱ طرح): گذر از CHROMIUM به RAW فقط بعد از یک «چاپ آزمایشی RAW»
 * موفق **در همین اجرای برنامه** مجاز است. با بستن برنامه باطل می‌شود تا کسی با
 * یک آزمون قدیمی، RAW را روی دستگاهی که عوض شده روشن نکند.
 * ===========================================================================
 */
import { BusinessError } from '../../errors'

export type RawTrialProfile = 'INVOICE' | 'WHOLESALE' | 'LABEL'

const rawTrialOk: Record<RawTrialProfile, boolean> = { INVOICE: false, WHOLESALE: false, LABEL: false }

/** ثبت موفقیت یک چاپ آزمایشی RAW (فقط از مسیر `printTestPage`). */
export function markRawTrialOk(profile: RawTrialProfile): void {
  rawTrialOk[profile] = true
}

/** آیا برای این پروفایل، RAW آزمایش‌شده و موفق است؟ */
export function isRawTrialOk(profile: RawTrialProfile): boolean {
  return rawTrialOk[profile] === true
}

/** فقط برای تست‌ها: پاک‌کردن وضعیت آزمون. */
export function resetRawTrial(): void {
  rawTrialOk.INVOICE = false
  rawTrialOk.WHOLESALE = false
  rawTrialOk.LABEL = false
}

/** پیام فارسی وقتی کاربر می‌خواهد RAW را بی‌آزمون روشن کند. */
export const RAW_TRIAL_REQUIRED_MESSAGE =
  'برای روشن‌کردن «دقیق (RAW)» اول یک «چاپ آزمایشی» با همین روش بگیرید تا درستی آن روی این دستگاه تأیید شود.'

/**
 * دروازه‌ی تغییر روش چاپ به RAW.
 *
 * ⚠️ چرا `prevMethod` هم می‌آید؟ چون تنظیمات **کل** قالب را دوباره ذخیره می‌کند؛
 * اگر فقط «مقدار بعدی RAW است» را چک کنیم، قالبِ از قبل RAW ذخیره‌شده بعد از هر
 * ری‌استارت برنامه در هر ذخیره‌ی بی‌ربط گیر می‌کرد. پس فقط *تغییر* به RAW آزمون
 * می‌خواهد.
 */
export function assertRawMethodAllowed(profile: RawTrialProfile, nextMethod: unknown, prevMethod: unknown): void {
  if (nextMethod !== 'RAW') return
  if (prevMethod === 'RAW') return
  if (isRawTrialOk(profile)) return
  throw new BusinessError(RAW_TRIAL_REQUIRED_MESSAGE)
}
