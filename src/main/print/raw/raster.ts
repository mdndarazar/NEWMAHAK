/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «تبدیل تصویر به بیت‌مپ ۱-بیتی برای چاپگر خام».
 *
 * چرا ۱-بیتی؟ چون هم TSPL و هم ESC/POS با «هر پیکسل = یک بیت» کار می‌کنند
 * (سیاه/سفید). تصویر رنگی/خاکستری اینجا معنا ندارد و آستانه‌ی ثابت ۱۲۸
 * ساده‌ترین رفتار قابل‌پیش‌بینی است.
 *
 * ⚠️ دو نکته‌ی ظریف که در چاپگرها فرق می‌کنند و در `packMono` صریح شده‌اند:
 *   ۱) هر سطر باید به **مضرب ۸ پیکسل** گرد شود (عرض بایت‌محور)؛ بیت‌های اضافه
 *      صفر (سفید) می‌شوند.
 *   ۲) قطبیت بیت (سیاه = ۱ یا ۰) در دستگاه‌ها متفاوت است؛ `invert` پارامتر است
 *      و **حدس زده نمی‌شود** — آزمون سخت‌افزاری مالک تعیینش می‌کند (بخش ۱۲.۳).
 * ===========================================================================
 */

import { BrowserWindow } from 'electron'
import { loadPrintDocument } from '../printer'
import { measureContentHeightMm } from '../pageSize'

/** آستانه‌ی پیش‌فرض: روشنایی کمتر از این ⇒ سیاه. */
export const MONO_THRESHOLD = 128

export interface RgbaImage {
  /** بافر BGRA/RGBA خام (خروجی `NativeImage.toBitmap`). */
  data: Uint8Array
  width: number
  height: number
  /** ترتیب کانال‌ها؛ پیش‌فرض خروجی الکترون `bgra` است. */
  order?: 'bgra' | 'rgba'
}

export interface MonoBitmap {
  /** عرض تصویر به پیکسل (همیشه مضرب ۸). */
  widthPx: number
  heightPx: number
  /** تعداد بایت هر سطر (مضرب ۱، چون عرض پیکسلی مضرب ۸ است). */
  widthBytes: number
  /** داده‌ی پیوسته‌ی سطرها، از بالا به پایین، MSB-first. */
  data: Buffer
}

/** روشنایی تقریبی یک پیکسل (۰..۲۵۵) از ترتیب کانال داده‌شده. */
export function luminanceAt(img: RgbaImage, x: number, y: number, threshold: number): boolean {
  const idx = (y * img.width + x) * 4
  const order = img.order ?? 'bgra'
  const b = img.data[idx] ?? 255
  const g = img.data[idx + 1] ?? 255
  const r = order === 'bgra' ? (img.data[idx + 2] ?? 255) : (img.data[idx] ?? 255)
  const blue = order === 'bgra' ? b : (img.data[idx + 2] ?? 255)
  // وزن‌های استاندارد روشنایی (ITU-R BT.601)
  const lum = (r * 299 + g * 587 + blue * 114) / 1000
  return lum < threshold
}

/**
 * بسته‌بندی تصویر در بیت‌مپ ۱-بیتی مونوکروم.
 * `invert = true` یعنی بیت ۱ = سفید و بیت ۰ = سیاه (پیش‌فرض: ۱ = سیاه).
 */
export function packMono(img: RgbaImage, opts: { threshold?: number; invert?: boolean } = {}): MonoBitmap {
  const threshold = Number.isFinite(opts.threshold) ? Number(opts.threshold) : MONO_THRESHOLD
  const invert = opts.invert === true
  const widthPx = Math.max(8, Math.ceil(img.width / 8) * 8)
  const heightPx = Math.max(1, Math.round(img.height))
  const widthBytes = widthPx / 8
  /**
   * مقدار اولیه: پرِ سفید در همان قطبیت. این مهم است چون بیت‌های «پدینگ» سمت
   * راست (تا مضرب ۸) با همین مقدار می‌مانند؛ اگر در قطبیت معکوس صفر می‌شدند،
   * چاپگر یک نوار سیاه در کنار تصویر چاپ می‌کرد.
   */
  const data = Buffer.alloc(widthBytes * heightPx, invert ? 0xff : 0x00)
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < img.width; x++) {
      const black = luminanceAt(img, x, y, threshold)
      const bitOn = invert ? !black : black
      const byteIndex = y * widthBytes + (x >> 3)
      const bit = 7 - (x & 7)
      // هم set و هم clear: در قطبیت معکوس، پیکسل سیاه باید بیت ۰ بشود.
      if (bitOn) data[byteIndex] |= 1 << bit
      else data[byteIndex] &= ~(1 << bit) & 0xff
    }
  }
  return { widthPx, heightPx, widthBytes, data }
}

/** تبدیل میلی‌متر به پیکسل در DPI داده‌شده (چاپگر حرارتی). */
export function mmToPx(mm: number, dpi: number): number {
  return Math.round((Number(mm) || 0) * (Number(dpi) || 203) / 25.4)
}

/** تبدیل پیکسل به میلی‌متر (برای گزارش اندازه‌ی برگه در سمت چاپ خام). */
export function pxToMm(px: number, dpi: number): number {
  return Math.round(((Number(px) || 0) * 25.4 * 100) / (Number(dpi) || 203)) / 100
}

/* ---------------------------------------------------------------------------
 * بخش Electron: رندر HTML در پنجره‌ی مخفی و گرفتن تصویر.
 *
 * چرا zoom = dpi/96؟ چون قالب‌های ما با میلی‌متر نوشته شده‌اند و کرومیوم
 * میلی‌متر را با قرارداد ۹۶dpi به CSS px تبدیل می‌کند؛ با zoom برابر dpi/96،
 * هر CSS px به یک پیکسل دستگاه در dpi چاپگر تبدیل می‌شود (بخش ۸.۳ طرح).
 * ------------------------------------------------------------------------- */

export interface RenderMonoInput {
  /** عرض/ارتفاعی که باید رندر شود؛ `'AUTO'` = ارتفاع محتوا اندازه‌گیری شود. */
  widthMm: number
  heightMm: number | 'AUTO'
  /** حاشیه‌ی ایمنی هنگام اندازه‌گیری ارتفاع خودکار (mm). */
  heightSafetyMm?: number
  /** dpi چاپگر (TSC پیش‌فرض ۲۰۳). */
  dpi: number
  threshold?: number
  invert?: boolean
}

/**
 * HTML را در پنجره‌ی مخفی رندر و به بیت‌مپ ۱-بیتی تبدیل می‌کند.
 * پنجره و فایل موقت سند در هر حالت (موفق یا ناموفق) پاک می‌شوند.
 */
export async function renderHtmlToMono(html: string, input: RenderMonoInput): Promise<MonoBitmap> {
  const dpi = Number(input.dpi) > 0 ? Number(input.dpi) : 203
  const widthDev = Math.max(1, mmToPx(input.widthMm, dpi))
  const autoHeight = input.heightMm === 'AUTO'
  // ارتفاع اولیه‌ی پنجره در حالت خودکار بزرگ گرفته می‌شود تا محتوا بریده نشود.
  const initialHeightMm = autoHeight ? 400 : Number(input.heightMm)
  const heightDev = Math.max(1, mmToPx(initialHeightMm, dpi))
  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: widthDev,
    height: heightDev,
    webPreferences: { backgroundThrottling: false }
  })
  try {
    const doc = await loadPrintDocument(win, html)
    try {
      try {
        win.webContents.setZoomFactor(dpi / 96)
      } catch {
        /* پنجره‌ی بسیار قدیمی؛ بدون zoom هم ادامه می‌دهیم (آزمون سخت‌افزاری) */
      }
      /**
       * ارتفاع خودکار: پیش از گرفتن تصویر، ارتفاع واقعی محتوا با همان اسکریپت
       * اندازه‌گیری فاز ۰/۱ اندازه‌گیری می‌شود (نه حدس).
       */
      const captureHeightDev = autoHeight
        ? Math.max(
            1,
            mmToPx(await measureContentHeightMm(win, input.heightSafetyMm ?? 3, undefined), dpi)
          )
        : heightDev
      try {
        win.setContentSize(widthDev, captureHeightDev)
      } catch {
        /* اندازه‌ی پنجره تعیین‌کننده‌ی برش capturePage نیست */
      }
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: widthDev, height: captureHeightDev })
      const size = image.getSize()
      return packMono(
        { data: image.toBitmap(), width: size.width, height: size.height, order: 'bgra' },
        { threshold: input.threshold, invert: input.invert }
      )
    } finally {
      await doc.cleanup()
    }
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
