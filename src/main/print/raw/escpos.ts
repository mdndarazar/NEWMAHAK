/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «سازنده‌ی دستور ESC/POS برای چاپگر رسید (Axiom)».
 *
 * ترتیب (بخش ۸.۳ طرح):
 *   ESC @ (شروع) → GS v 0 (چاپ رستری) → تغذیه → برش (GS V) طبق `cutMode`
 *
 * ⚠️ عرض رستری به تعداد نقطه‌های هد بستگی دارد (۷۲mm در ۲۰۳dpi ≈ ۵۷۶ نقطه)
 * و از خود بیت‌مپ گرفته می‌شود؛ عرض مدل دقیق دستگاه یکی از پرسش‌های مالک است
 * (بخش ۱۲.۳) و اگر هد عرض دیگری داشته باشد، همان جا دیده و اصلاح می‌شود.
 * ===========================================================================
 */
import { faDigits } from '@shared/jalali'
import type { MonoBitmap } from './raster'

export interface EscPosOptions {
  /** تعداد سطر تغذیه بعد از تصویر (پیش‌فرض ۴). */
  feedLines?: number
  /** نوع برش: FULL (پیش‌فرض) · PARTIAL · NONE. */
  cutMode?: 'FULL' | 'PARTIAL' | 'NONE'
  /** معکوس‌کردن بیت‌ها (قطبیت دستگاه). */
  invertBits?: boolean
}

const ESC = 0x1b
const GS = 0x1d

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** بایت‌های مقدمه‌ی `GS v 0` برای یک تصویر با ابعاد داده‌شده. */
export function escPosRasterHeader(widthBytes: number, heightPx: number): Buffer {
  const w = clampInt(widthBytes, 1, 0xffff, 1)
  const h = clampInt(heightPx, 1, 0xffff, 1)
  return Buffer.from([GS, 0x76, 0x30, 0x00, w & 0xff, (w >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff])
}

/** ترتیب دستورها به‌صورت متن (برای تست و چشم انسان). */
export function escPosCommandNames(opts: EscPosOptions = {}): string[] {
  const cut = opts.cutMode ?? 'FULL'
  const names = ['ESC @ (init)', 'GS v 0 (raster)']
  if (clampInt(opts.feedLines, 0, 20, 4) > 0) names.push('ESC d n (feed)')
  if (cut === 'FULL') names.push('GS V 0 (full cut)')
  else if (cut === 'PARTIAL') names.push('GS V 66 (partial cut)')
  return names
}

/** کار کامل ESC/POS: مقدمه + داده‌ی رستری + تغذیه + برش. */
export function buildEscPos(bitmap: MonoBitmap, opts: EscPosOptions = {}): Buffer {
  const feed = clampInt(opts.feedLines, 0, 20, 4)
  const cut = opts.cutMode ?? 'FULL'
  const data = opts.invertBits ? invertBits(bitmap.data) : bitmap.data
  const parts: Buffer[] = [
    Buffer.from([ESC, 0x40]), // ESC @ — مقداردهی اولیه
    escPosRasterHeader(bitmap.widthBytes, bitmap.heightPx),
    data
  ]
  if (feed > 0) parts.push(Buffer.from([ESC, 0x64, feed])) // ESC d n — تغذیه و خط‌گذاری
  if (cut === 'FULL') parts.push(Buffer.from([GS, 0x56, 0x00]))
  else if (cut === 'PARTIAL') parts.push(Buffer.from([GS, 0x56, 66]))
  return Buffer.concat(parts)
}

function invertBits(data: Buffer): Buffer {
  const out = Buffer.alloc(data.length)
  for (let i = 0; i < data.length; i++) out[i] = ~data[i] & 0xff
  return out
}

/** متن فارسی خلاصه‌ی کار برای گزارش/پیام. */
export function escPosSummary(input: { widthBytes: number; heightPx: number }): string {
  return (
    `ESC/POS · عرض ${faDigits(input.widthBytes)} بایت (${faDigits(input.widthBytes * 8)} نقطه) · ` +
    `ارتفاع ${faDigits(input.heightPx)} سطر`
  )
}
