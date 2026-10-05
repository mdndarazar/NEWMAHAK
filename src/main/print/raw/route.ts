/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «انتخاب موتور چاپ: Chromium یا خام (RAW)».
 *
 * چرا یک نقطه‌ی مشترک؟ تا هیچ مسیر چاپی خودش تصمیم نگیرد و هیچ‌جا «fallback
 * خودکار» نداشته باشیم:
 *
 *   • `printMethod = CHROMIUM` (پیش‌فرض همه‌ی کاربران فعلی) ⇒ **مو‌به‌مو** همان
 *     `printHtml` امروز، با همان `pageSize` و همان گزینه‌ها. هیچ تغییری در رفتار.
 *   • `printMethod = RAW` ⇒ رندر به بیت‌مپ + دستور ESC/POS + ارسال خام.
 *
 * ⚠️ دو قرارداد دست‌نخورده:
 *   ۱) روی CHROMIUM هیچ اندازه‌گیری/تبدیلی اضافه نمی‌شود (سازگاری کامل).
 *   ۲) اگر RAW باطل شود (چاپگر نبود، اسکریپت مسدود شد، …) هرگز بی‌صدا به
 *      Chromium برنمی‌گردیم؛ خطای فارسی بالا می‌رود و کاربر تصمیم می‌گیرد —
 *      چون دو بار چاپ‌شدن یک برگه بدتر از یک خطای روشن است.
 * ===========================================================================
 */
import { BusinessError } from '../../errors'
import { printHtml, type PrintPageSizeOption } from '../printer'
import { printEscPosDoc } from './index'

export interface PrintDocRouteInput {
  /** `printMethod` قالب رسید/لیبل (تنها منبع تصمیم). */
  method: unknown
  html: string
  deviceName: string
  silent?: boolean
  /** فقط مسیر Chromium؛ برای دیالوگ ویندوز چند نسخه در یک job چاپ می‌شود. */
  copies?: number
  pageSize: PrintPageSizeOption
  /** فقط برای RAW؛ DPI واقعی دستگاه (پیش‌فرض ۲۰۳). */
  rawDpi?: number
  /** فقط برای RAW؛ اگر دستگاه سفید/مشکی را برعکس گرفت، true می‌شود. */
  rawInvert?: boolean
  /** فقط برای RAW؛ پیش‌فرض `FULL`. */
  cutMode?: 'FULL' | 'PARTIAL' | 'NONE'
}

export interface PrintDocRouteResult {
  engine: 'CHROMIUM' | 'RAW'
  bytes?: number
  summary?: string
}

/** آیا این قالب باید خام چاپ شود؟ (فقط مقدار صریح `RAW`) */
export const isRawMethod = (method: unknown): boolean => method === 'RAW'

/** RAW مسیر دیالوگ ویندوز Electron ندارد؛ نباید silent:false را بی‌صدا نادیده بگیرد. */
export function assertRawNotDialog(silent: unknown): void {
  if (silent === false)
    throw new BusinessError(
      'چاپ خام (RAW) با دیالوگ ویندوز سازگار نیست؛ هیچ برگه‌ای چاپ نشد. برای انتخاب چاپگر، دیالوگ داخلی برنامه را استفاده کنید یا روش چاپ را روی Chromium بگذارید.'
    )
}

export async function printMaybeRaw(input: PrintDocRouteInput): Promise<PrintDocRouteResult> {
  if (!isRawMethod(input.method)) {
    await printHtml(input.html, {
      silent: input.silent ?? true,
      deviceName: input.deviceName,
      copies: input.copies,
      pageSize: input.pageSize
    })
    return { engine: 'CHROMIUM' }
  }
  assertRawNotDialog(input.silent)
  const result = await printEscPosDoc({
    html: input.html,
    printerName: input.deviceName,
    widthMm: input.pageSize.widthMm,
    heightMm: input.pageSize.heightMm,
    dpi: Number(input.rawDpi) === 300 ? 300 : 203,
    cutMode: input.cutMode,
    invertBits: input.rawInvert === true
  })
  return { engine: 'RAW', bytes: result.bytes, summary: result.summary }
}
