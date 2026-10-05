/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «راه‌انداز چاپ خام (RAW)».
 *
 * یک نقطه‌ی مشترک که سه کار را به هم می‌چسباند:
 *   HTML → بیت‌مپ ۱-بیتی (`raster`) → دستور دستگاه (`tspl`/`escpos`) → `sendRaw`
 *
 * دو دستگاه، دو مسیر:
 *   • لیبل‌زن TSC: هر **ردیف** یک تصویر و یک `PRINT` (بخش ۸.۲/۸.۳).
 *   • چاپگر رسید Axiom: کل رسید یک تصویر رستری + تغذیه + برش.
 *
 * ⚠️ پیش‌فرض هیچ کاربری عوض نمی‌شود: این ماژول فقط وقتی صدا زده می‌شود که
 * `printMethod` همان پروفایل صریحاً `RAW` باشد و **یک چاپ آزمایشی موفق RAW**
 * در همین اجرای برنامه ثبت شده باشد (`rawTrial`).
 * ===========================================================================
 */
import { faDigits } from '@shared/jalali'
import type { LabelSensorType } from '@shared/printSpec'
import type { PrintProfileKind } from '../target'
import { buildEscPos, escPosSummary, type EscPosOptions } from './escpos'
import { renderHtmlToMono } from './raster'
import { sendRaw } from './sendRaw'
import { buildTspl, tsplSummary, type TsplOptions } from './tspl'

export {
  assertRawMethodAllowed,
  isRawTrialOk,
  markRawTrialOk,
  resetRawTrial,
  RAW_TRIAL_REQUIRED_MESSAGE,
  type RawTrialProfile
} from './gate'

export interface RawJobResult {
  bytes: number
  widthBytes: number
  heightPx: number
  /** متن فارسی برای گزارش/پیام. */
  summary: string
}

export interface TsplPrintInput {
  html: string
  printerName: string
  widthMm: number
  heightMm: number
  dpi: number
  gapMm: number
  sensorType: LabelSensorType
  direction: number
  density: number
  speed: number
  copies?: number
  /** مبدأ TSPL برحسب نقطه (dot). مقدار مثبت offset در این مسیر اینجا اعمال می‌شود. */
  referenceX?: number
  referenceY?: number
  invertBits?: boolean
}

/** تبدیل offset میلی‌متری به نقطه‌ی چاپگر. مقدار منفی در TSPL REFERENCE مجاز نیست، پس صفر می‌شود. */
export function mmToPrinterDots(mm: unknown, dpi: unknown): number {
  const value = Number(mm)
  const dotsPerInch = Number(dpi) === 300 ? 300 : 203
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.max(0, Math.round((value * dotsPerInch) / 25.4))
}

function tsplOptionsFrom(input: Omit<TsplPrintInput, 'html' | 'printerName'>): TsplOptions {
  return {
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    gapMm: input.gapMm,
    sensorType: input.sensorType,
    direction: input.direction,
    density: input.density,
    speed: input.speed,
    copies: input.copies ?? 1,
    referenceX: input.referenceX,
    referenceY: input.referenceY,
    invertBits: input.invertBits
  }
}

/**
 * چاپ خام یک ردیف لیبل با TSPL.
 * `html` باید دقیقاً HTML همان ردیف باشد (عرض = عرض ردیف، ارتفاع = ارتفاع لیبل).
 */
export async function printTsplRow(input: TsplPrintInput): Promise<RawJobResult> {
  return printTsplRows({ ...input, htmlRows: [input.html] })
}

/**
 * چاپ خام چند ردیف لیبل در یک کار RAW.
 *
 * بازبینی مستقل فاز ۵ نشان داد ارسال جداگانه‌ی هر ردیف هم کند است و هم اگر
 * PowerShell/Spooler بین ردیف‌ها خطا بدهد خروجی نیمه‌کاره با خطای قطعی می‌ماند.
 * این تابع همه‌ی ردیف‌ها را اول به TSPL تبدیل می‌کند و سپس **یک‌بار** به spooler
 * می‌فرستد. اگر همان یک ارسال timeout شود، طبق قرارداد پروژه نتیجه نامعلوم است
 * (ممکن است بخشی از برگه‌ها چاپ شده باشد) و retry خودکار نداریم.
 */
export async function printTsplRows(input: Omit<TsplPrintInput, 'html'> & { htmlRows: readonly string[] }): Promise<RawJobResult> {
  const htmlRows = [...(input.htmlRows ?? [])].filter((h) => String(h ?? '').trim())
  if (!htmlRows.length) throw new Error('ردیفی برای چاپ RAW لیبل ساخته نشد.')

  const parts: Buffer[] = []
  let widthBytes = 0
  let heightPx = 0
  for (const html of htmlRows) {
    const bitmap = await renderHtmlToMono(html, {
      widthMm: input.widthMm,
      heightMm: input.heightMm,
      dpi: input.dpi,
      invert: false
    })
    widthBytes = Math.max(widthBytes, bitmap.widthBytes)
    heightPx = Math.max(heightPx, bitmap.heightPx)
    parts.push(buildTspl(bitmap, tsplOptionsFrom(input)))
  }

  const bytes = Buffer.concat(parts)
  const sent = await sendRaw(input.printerName, bytes)
  return {
    bytes: sent,
    widthBytes,
    heightPx,
    summary:
      `${faDigits(htmlRows.length)} ردیف · ` +
      tsplSummary({ widthMm: input.widthMm, heightMm: input.heightMm, widthBytes, heightPx })
  }
}

/** چاپ خام یک رسید/سند با ESC/POS (ارتفاع `'AUTO'` = اندازه‌گیری محتوا). */
export async function printEscPosDoc(input: {
  html: string
  printerName: string
  widthMm: number
  heightMm: number | 'AUTO'
  dpi: number
  cutMode?: 'FULL' | 'PARTIAL' | 'NONE'
  invertBits?: boolean
}): Promise<RawJobResult> {
  const bitmap = await renderHtmlToMono(input.html, {
    widthMm: input.widthMm,
    heightMm: input.heightMm,
    dpi: input.dpi,
    heightSafetyMm: 3,
    invert: false
  })
  const opts: EscPosOptions = { cutMode: input.cutMode ?? 'FULL', invertBits: input.invertBits }
  const bytes = buildEscPos(bitmap, opts)
  const sent = await sendRaw(input.printerName, bytes)
  return {
    bytes: sent,
    widthBytes: bitmap.widthBytes,
    heightPx: bitmap.heightPx,
    summary: escPosSummary({ widthBytes: bitmap.widthBytes, heightPx: bitmap.heightPx })
  }
}

/** متن فارسی نتیجه‌ی یک کار خام برای پیام UI. */
export function rawResultText(profile: PrintProfileKind, result: RawJobResult): string {
  const kind = profile === 'LABEL' ? 'لیبل' : 'رسید'
  return `${kind} با روش «دقیق (RAW)» به چاپگر فرستاده شد (${faDigits(result.bytes)} بایت؛ ${result.summary}).`
}
