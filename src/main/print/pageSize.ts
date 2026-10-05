/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۰ طرح چاپ — اندازه‌گیری ارتفاع محتوا روی پنجره‌ی مخفی چاپ.
 *
 * چرا لازم است؟ رول حرارتی ارتفاع ثابت ندارد؛ اگر ارتفاع صفحه را به چاپگر
 * ندهیم، اندازه‌ی صفحه از پیش‌فرض درایور می‌آید و روی بعضی درایورها یعنی «یک
 * صفحه‌ی A4 برای یک فاکتور ده‌خطی» یا برش وسط محتوا. پس ارتفاع واقعی همان
 * چیزی که رندر شده اندازه‌گیری می‌شود و به‌عنوان `pageSize` به Electron می‌رود.
 *
 * دو قاعده‌ی سخت:
 *   ۱) اندازه‌گیری **قبل از** ارسال کار به چاپگر انجام می‌شود؛ پس هر شکست آن
 *      «قطعاً چیزی چاپ نشد» است (BusinessError)، نه «نتیجه نامعلوم». هیچ‌وقت با
 *      ارتفاع حدسی ادامه نمی‌دهیم.
 *   ۲) فونت و تصاویر (لوگو/بارکد data URL) باید قبل از اندازه‌گیری حاضر باشند،
 *      وگرنه ارتفاع کمتر از واقعیت خوانده می‌شود و خط آخر بریده می‌شود.
 * ===========================================================================
 */
import type { BrowserWindow } from 'electron'
import { BusinessError } from '../errors'
import {
  CONTENT_TOO_TALL_MESSAGE,
  MEASURE_HEIGHT_FAILED_MESSAGE,
  PAGE_SIZE_LIMITS,
  mmFromCssPx
} from '@shared/printSpec'

/**
 * مهلت اندازه‌گیری. مستقل از مهلت چاپ است: اینجا هیچ کاری به چاپگر نرفته، پس
 * اعلام شکست کاملاً بی‌خطر است.
 */
export const MEASURE_TIMEOUT_MS = 30_000

/**
 * اندازه‌گیری داخل خود صفحه اجرا می‌شود (isolated world نیست؛ فقط خواندن عدد).
 * `Math.ceil` می‌کند تا هیچ پیکسل نیمه‌بریده‌ای از قلم نیفتد.
 *
 * ⚠️ بازبینی مستقل (نشست ۲۲۲، باگ ۱ بحرانی) — «کف ارتفاع viewport»:
 * `documentElement.scrollHeight` هیچ‌وقت از ارتفاع پنجره کمتر نیست، و پنجره‌ی
 * مخفی چاپ اندازه‌ی پیش‌فرض (۸۰۰×۶۰۰) دارد. پس یک فاکتور ۲۰ میلی‌متری هم با
 * همان ۶۰۰ پیکسل (≈۱۶۲mm) اندازه گرفته می‌شد و «ارتفاع خودکار» عملاً بی‌معنا
 * بود. حالا:
 *   • مبنای اندازه، خودِ `body` است (بدون کفِ viewport)؛
 *   • `documentElement.scrollHeight` فقط وقتی به حساب می‌آید که واقعاً از
 *     viewport سرریز کرده باشد (`scrollHeight > clientHeight`)، چون در آن صورت
 *     دیگر عددش ارتفاع واقعی محتواست نه کف پنجره.
 */
export const MEASURE_SCRIPT = `(async () => {
  try { await document.fonts.ready } catch (e) {}
  try {
    const imgs = Array.from(document.images || [])
    await Promise.all(imgs.map((img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve())))
  } catch (e) {}
  const de = document.documentElement
  const b = document.body
  const overflowsViewport = !!(de && de.scrollHeight > de.clientHeight)
  const h = Math.max(
    b ? b.scrollHeight : 0,
    b ? b.offsetHeight : 0,
    b && b.getBoundingClientRect ? Math.ceil(b.getBoundingClientRect().height) : 0,
    overflowsViewport ? de.scrollHeight : 0
  )
  return Math.ceil(h)
})()`

/**
 * ارتفاع واقعی محتوای بارگذاری‌شده در `win` را به میلی‌متر برمی‌گرداند
 * (`heightSafetyMm` = حاشیه‌ی ایمنی پایین برای فاصله‌ی کاتر).
 *
 * خطاها همه به BusinessError فارسی تبدیل می‌شوند؛ هیچ‌وقت «عدد حدسی» برنمی‌گردد.
 * اگر ارتفاع محاسبه‌شده بزرگ‌تر از viewport باشد، کفِ پنجره مشکل‌ساز نیست؛ برای
 * اسناد کوتاه هم دیگر ارتفاع پنجره به‌جای محتوا اندازه گرفته نمی‌شود (باگ ۱
 * بازبینی مستقل).
 */
export async function measureContentHeightMm(
  win: BrowserWindow,
  heightSafetyMm = 3,
  timeoutMs?: number
): Promise<number> {
  const waitMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.round(timeoutMs as number)) : MEASURE_TIMEOUT_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let px: unknown
  try {
    const measured = win.webContents.executeJavaScript(MEASURE_SCRIPT, true)
    // اگر مهلت برد، این Promise بعداً reject می‌شود؛ هندلر خالی تا «unhandled rejection» نشود.
    measured.catch(() => {})
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('MEASURE_TIMEOUT')), waitMs)
    })
    px = await Promise.race([measured, timeout])
  } catch {
    throw new BusinessError(MEASURE_HEIGHT_FAILED_MESSAGE)
  } finally {
    if (timer) clearTimeout(timer)
  }

  const n = Number(px)
  if (!Number.isFinite(n) || n <= 0) throw new BusinessError(MEASURE_HEIGHT_FAILED_MESSAGE)

  const safety = Number.isFinite(heightSafetyMm) ? Math.max(0, Number(heightSafetyMm)) : 0
  // مطابق طرح: سقفِ ۰٫۱ میلی‌متری، بعد حاشیه‌ی ایمنی
  const heightMm = Math.ceil(mmFromCssPx(n) * 10) / 10 + safety
  if (heightMm > PAGE_SIZE_LIMITS.maxHeightMm) throw new BusinessError(CONTENT_TOO_TALL_MESSAGE)
  return heightMm
}
