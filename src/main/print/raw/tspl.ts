/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «سازنده‌ی دستور TSPL برای لیبل‌زن TSC».
 *
 * ترتیب دستورها دقیقاً مطابق بخش ۸.۳ طرح است:
 *   SIZE → GAP/BLINE → DIRECTION → DENSITY → SPEED → REFERENCE → CLS → BITMAP → PRINT
 *
 * ⚠️ سه مجهولی که **حدس زده نمی‌شوند** (بخش ۱۲.۳ طرح) و اینجا فقط پارامترند:
 *   ۱) `sizeWidthMm`: آیا `SIZE` عرض کل ردیف دوستونه است یا عرض یک لیبل؟
 *      (پیش‌فرض طبق طرح: عرض ردیف — چون صفحه‌ی رستری همان عرض را دارد.)
 *   ۲) قطبیت بیت: با `invertBits` کنترل می‌شود (پیش‌فرض: بیت ۱ = سیاه).
 *   ۳) `direction`: از تنظیمات قالب (`LabelTemplate.direction`) می‌آید.
 * نتیجه‌ی هر سه فقط با «چاپ آزمایشی» روی دستگاه قطعی می‌شود و در گزارش فاز ۵
 * به‌عنوان آزمون سخت‌افزاری مالک ثبت شده است.
 * ===========================================================================
 */
import { faDigits } from '@shared/jalali'
import type { LabelSensorType } from '@shared/printSpec'
import type { MonoBitmap } from './raster'

export interface TsplOptions {
  /** عرض/ارتفاع لیبل یا ردیف به میلی‌متر (همان چیزی که به SIZE می‌رود). */
  widthMm: number
  heightMm: number
  /** فاصله‌ی بین لیبل‌ها؛ فقط برای سنسور GAP معنا دارد. */
  gapMm?: number
  /** نوع سنسور رول: GAP (پیش‌فرض)، BLACKMARK (BLINE)، CONTINUOUS (GAP 0,0). */
  sensorType?: LabelSensorType
  /** ۰ تا ۳ مطابق TSPL. از `LabelTemplate.direction` می‌آید. */
  direction?: number
  /** ۰ تا ۱۵؛ `LabelTemplate.density` (پیش‌فرض ۸). */
  density?: number
  /** ۱ تا ۶؛ `LabelTemplate.speed` (پیش‌فرض ۴). */
  speed?: number
  /** مبدأ تصویر (پیش‌فرض ۰،۰). */
  referenceX?: number
  referenceY?: number
  /** تعداد نسخه؛ پیش‌فرض ۱. */
  copies?: number
  /** قطبیت: اگر دستگاه برعکس چاپ کرد، true می‌شود (آزمون مالک). */
  invertBits?: boolean
}

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const mm2 = (v: unknown, fallback: number): string => {
  const n = Number(v)
  const safe = Number.isFinite(n) && n > 0 ? n : fallback
  return String(Math.round(safe * 100) / 100)
}

/** سطرهای متنی دستور (بدون داده‌ی بیت‌مپ) — برای تست و برای چشم انسان خوانا. */
export function tsplCommandLines(bitmap: MonoBitmap, opts: TsplOptions): string[] {
  const sensor = opts.sensorType ?? 'GAP'
  const gap = clampInt(opts.gapMm, 0, 20, 2)
  const direction = clampInt(opts.direction, 0, 3, 0)
  const density = clampInt(opts.density, 0, 15, 8)
  const speed = clampInt(opts.speed, 1, 6, 4)
  const refX = clampInt(opts.referenceX, 0, 999, 0)
  const refY = clampInt(opts.referenceY, 0, 999, 0)
  const copies = clampInt(opts.copies, 1, 99, 1)
  const lines: string[] = []
  lines.push(`SIZE ${mm2(opts.widthMm, 50)} mm,${mm2(opts.heightMm, 30)} mm`)
  if (sensor === 'BLACKMARK') lines.push(`BLINE ${gap} mm,0 mm`)
  else if (sensor === 'CONTINUOUS') lines.push('GAP 0 mm,0 mm')
  else lines.push(`GAP ${gap} mm,0 mm`)
  lines.push(`DIRECTION ${direction}`)
  lines.push(`DENSITY ${density}`)
  lines.push(`SPEED ${speed}`)
  lines.push(`REFERENCE ${refX},${refY}`)
  lines.push('CLS')
  lines.push(`BITMAP 0,0,${bitmap.widthBytes},${bitmap.heightPx},0,`)
  lines.push(`PRINT ${copies},1`)
  return lines
}

/**
 * بایت‌های کامل یک کار TSPL: دستورها (ASCII) + داده‌ی خام بیت‌مپ بعد از
 * `BITMAP …` و قبل از `PRINT`. داده عمداً باینری است (نه Base64).
 */
export function buildTspl(bitmap: MonoBitmap, opts: TsplOptions): Buffer {
  const lines = tsplCommandLines(bitmap, opts)
  const data = opts.invertBits ? invertMono(bitmap) : bitmap.data
  const head: Buffer[] = []
  for (const line of lines) {
    head.push(Buffer.from(line + '\r\n', 'latin1'))
    if (line.startsWith('BITMAP')) head.push(data)
  }
  return Buffer.concat(head)
}

/** معکوس‌کردن بیت‌های بیت‌مپ (برای دستگاه‌هایی که قطبیتشان برعکس است). */
export function invertMono(bitmap: MonoBitmap): Buffer {
  const out = Buffer.alloc(bitmap.data.length)
  for (let i = 0; i < bitmap.data.length; i++) out[i] = ~bitmap.data[i] & 0xff
  return out
}

/** متن فارسی خلاصه‌ی کار برای گزارش/پیام (ارقام فارسی، مثل بقیه‌ی چاپ‌ها). */
export function tsplSummary(input: { widthMm: number; heightMm: number; widthBytes: number; heightPx: number }): string {
  return (
    `TSPL · ${faDigits(Math.round(input.widthMm))}×${faDigits(Math.round(input.heightMm))} میلی‌متر · ` +
    `${faDigits(input.widthBytes)} بایت عرض × ${faDigits(input.heightPx)} سطر`
  )
}
