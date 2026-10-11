/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۰ طرح چاپ — «آزمایش‌گر چاپ» (ابزار تشخیص، بدون تغییر رفتار).
 *
 * مسئله: روی دستگاه مشتری، فاکتور ۸۰mm به‌شکل یک نوار باریک/خالی بیرون می‌آید و
 * لیبل‌زن ردیف‌های خالی می‌فرستد. تا وقتی معلوم نشود درایور چه اندازه‌ای را می‌پذیرد،
 * هیچ تنظیمی نباید عوض شود. این ماژول همان ابزار اندازه‌گیری است:
 *
 *   الف) بدون pageSize         — رفتار امروز برنامه (مبنای مقایسه)
 *   ب)  pageSize دقیق          — آیا درایور اندازه‌ی سفارشی را می‌پذیرد؟
 *   ج)  ارتفاع خودکار          — ارتفاع واقعی محتوا اندازه‌گیری و ارسال می‌شود
 *   د)  فقط شمارش صفحه (PDF)   — یک صفحه‌ی خالی اضافه ساخته می‌شود یا نه؟
 *   ه)  ردیف دوستونه‌ی لیبل      — آیا دو لیبل در یک صفحه بدون لیبل خالی می‌آید؟
 *
 * نکته‌ی مهم: این ماژول **هیچ چیزی از رفتار برنامه را عوض نمی‌کند**. تنها راهی که
 * به چاپ می‌رسد، کانال صریح `print:diagnose` است که کاربر از تنظیمات صدا می‌زند.
 *
 * عبارت‌های CSS اندازه‌ی صفحه فقط برای همان چیزی است که در فاز ۱/۲ خواهیم ساخت،
 * تا آزمون روی دستگاه واقعی همان ترکیب نهایی را بسنجد (وگرنه آزمون بی‌ارزش است).
 * ===========================================================================
 */
import { BusinessError } from '../errors'
import { barcodePng } from '../services/BarcodeService'
import { faDigits } from '@shared/jalali'
import { pdfFromHtml, printHtml } from './printer'
import { resolvePrintTargetName } from './target'
import { PAGE_SIZE_LIMITS } from '@shared/printSpec'
import { DIAGNOSE_MODES, diagnoseModeInfo, type DiagnoseMode } from '@shared/printDiagnose'

export type { DiagnoseMode }

/** عنوان فارسی حالت‌ها — از فایل مشترک `@shared/printDiagnose` می‌آید. */
export const DIAGNOSE_MODE_TITLES: Record<DiagnoseMode, string> = {
  A: diagnoseModeInfo('A').title,
  B: diagnoseModeInfo('B').title,
  C: diagnoseModeInfo('C').title,
  D: diagnoseModeInfo('D').title,
  E: diagnoseModeInfo('E').title
}

/** حالت را از ورودی کاربر می‌شناسد (کوچک/بزرگ فرقی ندارد). */
export function parseDiagnoseMode(raw: unknown): DiagnoseMode {
  const value = String(raw ?? 'A').trim().toUpperCase()
  const hit = DIAGNOSE_MODES.find((m) => m.mode === value)
  if (hit) return hit.mode
  throw new BusinessError('حالت آزمایشگر چاپ نامعتبر است؛ یکی از حالت‌های الف تا ه را انتخاب کنید.')
}

/**
 * تعداد صفحه‌ی یک PDF خروجی کرومیوم.
 *
 * ⚠️ تخمینی است: PDF کرومیوم برای هر صفحه یک آبجکت `<< /Type /Page … >>` و برای
 * فهرست‌شان `<< /Type /Pages … >>` می‌نویسد، پس فقط دومی باید کنار گذاشته شود.
 * این عدد تنها برای پاسخ به یک پرسش است: «آیا برای یک برگه، دو صفحه ساخته شد؟»
 * (فرضیه‌ی صفحه‌ی خالی L3). ابزار PDF بیرونی به پروژه اضافه نمی‌کنیم.
 */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString('latin1')
  const matches = text.match(/\/Type\s*\/Page(?![s])/g)
  return matches ? matches.length : 0
}

export interface DiagnoseSheetInput {
  mode: DiagnoseMode
  widthMm: number
  heightMm: number
  columns?: number
  gapXMm?: number
  /** اندازه‌ی صفحه در CSS هم نوشته شود؟ (فقط حالت‌هایی که ارتفاع ثابت است) */
  cssPageSize?: boolean
  printerName?: string
  /** متنِ «چه چیزی به چاپگر می‌رود» که روی خود برگه چاپ می‌شود */
  pageSizeLabel?: string
  barcodeDataUrl?: string
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const num = (v: unknown, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n))

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * خط‌کش افقی/عمودی با شماره‌ی هر ۱۰ میلی‌متر (ارقام فارسی، مثل بقیه‌ی چاپ‌ها).
 *
 * ⚠️ بازبینی مستقل (نشست ۲۲۲، باگ ۳): قبلاً همین تابع برای هر دو خط‌کش استفاده
 * می‌شد و همیشه `left:` می‌نوشت؛ پس خط‌کش عمودی عملاً وجود نداشت و تیک‌هایش روی
 * خط‌کش افقی می‌افتاد. حالا محور پارامتر است.
 */
function rulerTicks(lengthMm: number, axis: 'x' | 'y' = 'x', step = 10): string {
  const out: string[] = []
  for (let x = 0; x <= lengthMm + 0.001; x += step) {
    const at = Math.min(x, lengthMm)
    out.push(`<i style="${axis === 'y' ? 'top' : 'left'}:${round2(at)}mm">${faDigits(Math.round(at))}</i>`)
  }
  return out.join('')
}

/**
 * برگه‌ی تشخیص: کادر ۱ میلی‌متری روی لبه‌ی صفحه، خط‌کش افقی و عمودی، مستطیل
 * مرجع ۵۰×۲۰، متن نمونه، ارقام فارسی و لاتین، بارکد و سطر پارامترها.
 * در حالت چندستونه، هر خانه کادر و شماره‌ی ستون خودش را دارد (آزمون offset).
 */
export function buildDiagnosticSheetHtml(input: DiagnoseSheetInput): string {
  const mode = parseDiagnoseMode(input.mode)
  const columns = clamp(Math.round(num(input.columns, 1)) || 1, 1, 3)
  const gapX = clamp(num(input.gapXMm, 2), 0, 20)
  const widthMm = clamp(num(input.widthMm, 80), PAGE_SIZE_LIMITS.minWidthMm, PAGE_SIZE_LIMITS.maxWidthMm)
  const heightMm = clamp(num(input.heightMm, 140), PAGE_SIZE_LIMITS.minHeightMm, PAGE_SIZE_LIMITS.maxHeightMm)
  const cellW = columns > 1 ? (widthMm - (columns - 1) * gapX) / columns : widthMm
  /**
   * حالت «ج» ارتفاع ثابت ندارد: قرار است خودِ ارتفاع محتوا اندازه‌گیری شود
   * (بازبینی مستقل، باگ ۲). اگر برگه `height` ثابت داشته باشد، اندازه‌گیری
   * همان ارتفاع قالب را برمی‌گرداند و آزمایش بی‌معنا می‌شود.
   */
  const autoHeight = mode === 'C'
  /** صفحه‌ی کوتاه (لیبل ۳۰mm): متن‌های توضیحی حذف می‌شوند تا سطر پارامترها بریده نشود. */
  const compact = heightMm < 45
  const multi = columns > 1

  const rulerH = heightMm >= 60 ? 7 : 4
  const refW = Math.max(10, Math.min(50, cellW - 6))
  const refH = Math.max(4, Math.min(20, heightMm - rulerH - 12))
  const barcodeH = clamp(Math.min(12, heightMm / 4), 4, 14)
  const barcodeW = Math.max(20, Math.min(cellW - 6, 46))

  const pageSizeLabel = escapeHtml(input.pageSizeLabel ?? '—')
  const printerLabel = escapeHtml(input.printerName || 'پیش‌فرض ویندوز')

  const cellHtml = (columnNo: number | null): string => `
  <section class="cell">
    <div class="hd">برگه‌ی تشخیص چاپ — محک${columnNo ? ` · ستون ${faDigits(columnNo)}` : ''}</div>
    ${compact ? '' : '<div class="txt">این یک برگه‌ی آزمایشی است؛ با خط‌کش اندازه بگیرید.</div>'}
    <div class="digits">ارقام فارسی: ${faDigits('0123456789')} · ارقام لاتین: 0123456789</div>
    <div class="ref" style="width:${round2(refW)}mm;height:${round2(refH)}mm">
      مستطیل مرجع ${faDigits(round2(refW))}×${faDigits(round2(refH))} میلی‌متر
    </div>
    ${input.barcodeDataUrl ? `<img class="bc" style="width:${round2(barcodeW)}mm;height:${round2(barcodeH)}mm" src="${input.barcodeDataUrl}" alt="barcode" />` : ''}
    <div class="params">
      حالت: ${escapeHtml(DIAGNOSE_MODE_TITLES[mode])}<br />
      چاپگر: ${printerLabel}<br />
      اندازه‌ی ارسالی به چاپگر: ${pageSizeLabel}<br />
      موتور: Chromium (webContents.print)
    </div>
  </section>`

  const cells = multi
    ? Array.from({ length: columns }, (_v, i) => cellHtml(i + 1)).join('')
    : cellHtml(null)

  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  @page { ${input.cssPageSize && !autoHeight ? `size: ${round2(widthMm)}mm ${round2(heightMm)}mm;` : ''} margin: 0; }
  html, body { margin:0; padding:0; }
  .page { width:${round2(widthMm)}mm; ${autoHeight ? '' : `height:${round2(heightMm)}mm;`} box-sizing:border-box;
          border:${multi ? '0' : '1mm solid #000'}; position:relative; overflow:hidden; direction:rtl;
          font-family: Vazirmatn, Tahoma, sans-serif; font-size:9px; }
  .rh { position:absolute; top:0; inset-inline:0; height:${rulerH}mm; direction:ltr; }
  .rh i { position:absolute; top:0; height:2mm; border-left:0.15mm solid #000; font-style:normal;
          font-size:5px; padding-top:2.1mm; }
  .rv { position:absolute; inset-block:0; left:0; width:${rulerH}mm; direction:ltr; }
  .rv i { position:absolute; left:0; width:2mm; border-top:0.15mm solid #000; font-style:normal;
          font-size:5px; padding-left:2.1mm; }
  .content { ${
    autoHeight
      ? `position:relative; margin:${rulerH}mm 0 0 ${rulerH}mm;`
      : multi
        ? 'position:absolute; inset:0;'
        : `position:absolute; top:${rulerH}mm; left:${rulerH}mm; right:0; bottom:0;`
  }
             display:grid; ${multi ? `grid-template-columns:repeat(${columns}, ${round2(cellW)}mm); column-gap:${round2(gapX)}mm;` : ''}
             box-sizing:border-box; padding:${multi ? 0 : 1}mm; }
  .cell { box-sizing:border-box; ${
    multi
      ? // کادر خودِ خانه معیار جای لیبل فیزیکی است؛ فضای بالای خانه برای خط‌کش افقی
        `border:0.3mm solid #000; padding:${rulerH}mm 1mm 1mm;`
      : 'padding:1mm;'
  } overflow:hidden; }
  .hd { font-weight:700; margin-bottom:0.6mm; }
  .txt { margin-bottom:0.6mm; }
  .digits { margin-bottom:0.8mm; }
  .ref { border:0.3mm solid #000; box-sizing:border-box; display:flex; align-items:center;
         justify-content:center; text-align:center; font-weight:700; margin-bottom:0.8mm; }
  .bc { display:block; margin-bottom:0.8mm; }
  .params { border-top:0.2mm solid #000; padding-top:0.6mm; line-height:1.5; }
</style></head><body>
<div class="page" data-diagnose-sheet="1" data-mode="${mode}" data-columns="${columns}"
     data-page-size="${round2(widthMm)}x${autoHeight ? 'AUTO' : round2(heightMm)}">
  <div class="rh">${rulerTicks(widthMm)}</div>
  <div class="rv">${rulerTicks(heightMm, 'y')}</div>
  <div class="content">${cells}</div>
</div>
</body></html>`
}

export interface DiagnoseInput {
  mode?: unknown
  deviceName?: unknown
  widthMm?: unknown
  heightMm?: unknown
  columns?: unknown
  gapXMm?: unknown
  /** بی‌صدا روی چاپگر انتخاب‌شده؛ پیش‌فرض روشن (دیالوگ ویندوز اندازه‌ی ما را بازنویسی می‌کند) */
  silent?: unknown
}

export interface DiagnoseResult {
  mode: DiagnoseMode
  modeTitle: string
  printed: boolean
  /** اندازه‌ای که واقعاً به Electron داده شد (متن فارسی برای نمایش) */
  pageSizeLabel: string
  /** فقط حالت د: تعداد صفحه‌ی PDF خروجی */
  pages?: number
  /** فقط حالت د: تعداد صفحه‌ی مورد انتظار (یک برگه) */
  expectedPages?: number
  /** فقط حالت ج: ارتفاع واقعیِ اندازه‌گیری‌شده که به چاپگر اعلام شد (میلی‌متر) */
  measuredHeightMm?: number
}

/**
 * اجرای یک آزمایش. برای حالت «د» فقط PDF ساخته و شمرده می‌شود (هیچ چاپی).
 * هیچ‌جای مسیر چاپ عوض نمی‌شود؛ این تابع فقط صدا زده می‌شود اگر کاربر خودش
 * دکمه‌ی «آزمایشگر چاپ» را بزند.
 */
export async function runPrintDiagnose(input: DiagnoseInput = {}): Promise<DiagnoseResult> {
  const mode = parseDiagnoseMode(input.mode)
  const defaults = diagnoseModeInfo(mode).defaults
  const widthMm = clamp(num(input.widthMm, defaults.widthMm), PAGE_SIZE_LIMITS.minWidthMm, PAGE_SIZE_LIMITS.maxWidthMm)
  const heightMm = clamp(num(input.heightMm, defaults.heightMm), PAGE_SIZE_LIMITS.minHeightMm, PAGE_SIZE_LIMITS.maxHeightMm)
  const columns = clamp(Math.round(num(input.columns, defaults.columns)) || 1, 1, 3)
  const gapXMm = clamp(num(input.gapXMm, defaults.gapXMm), 0, 20)
  const requestedDeviceName = String(input.deviceName ?? '').trim()
  const targetDeviceName =
    mode === 'D'
      ? requestedDeviceName
      : (await resolvePrintTargetName({ requestedDeviceName: requestedDeviceName || undefined, savedName: '' })).deviceName
  const silent = input.silent !== false

  // بارکد عمداً اختیاری است: اگر تولیدش شکست خورد، برگه بدون بارکد هم برای
  // اندازه‌گیری کادر و خط‌کش کافی است و کل آزمایش نباید به‌خاطرش بایستد.
  let barcodeDataUrl: string | undefined
  try {
    barcodeDataUrl = await barcodePng('MAHAK-DIAGNOSE')
  } catch {
    barcodeDataUrl = undefined
  }

  const pageSizeLabel =
    mode === 'A'
      ? 'بدون pageSize (رفتار فعلی)'
      : mode === 'C'
        ? `${faDigits(widthMm)} میلی‌متر × ارتفاع اندازه‌گیری‌شده`
        : mode === 'D'
          ? `${faDigits(widthMm)}×${faDigits(heightMm)} میلی‌متر (فقط PDF)`
          : `${faDigits(widthMm)}×${faDigits(heightMm)} میلی‌متر`

  const html = buildDiagnosticSheetHtml({
    mode,
    widthMm,
    heightMm,
    columns,
    gapXMm,
    // در حالت الف عمداً هیچ اندازه‌ای در CSS نیست (رفتار امروز): فقط @page{margin:0}
    cssPageSize: mode !== 'A' && mode !== 'C',
    printerName: targetDeviceName,
    pageSizeLabel,
    barcodeDataUrl
  })

  if (mode === 'D') {
    const pdf = await pdfFromHtml(html, { widthMm, heightMm })
    return {
      mode,
      modeTitle: DIAGNOSE_MODE_TITLES[mode],
      printed: false,
      pageSizeLabel,
      pages: countPdfPages(pdf),
      expectedPages: 1
    }
  }

  const sent = await printHtml(html, {
    silent,
    deviceName: targetDeviceName,
    pageSize:
      mode === 'A'
        ? undefined
        : mode === 'C'
          ? { widthMm, heightMm: 'AUTO', heightSafetyMm: 3 }
          : { widthMm, heightMm }
  })

  /**
   * بازبینی مستقل (بند ۳ سبک/اختیاری) — در حالت «ج» عدد واقعیِ اندازه‌گیری‌شده
   * باید برگردد تا مالک آن را روی برگه/در docs ثبت کند، نه فقط عبارت «اندازه‌گیری‌شده».
   */
  const measured = sent?.pageSize
  const measuredHeightMm = measured ? Math.round((measured.height / 1000) * 10) / 10 : undefined
  return {
    mode,
    modeTitle: DIAGNOSE_MODE_TITLES[mode],
    printed: true,
    pageSizeLabel:
      mode === 'C' && measuredHeightMm != null
        ? `${faDigits(widthMm)}×${faDigits(measuredHeightMm)} میلی‌متر (ارتفاع اندازه‌گیری‌شده)`
        : pageSizeLabel,
    ...(mode === 'C' && measuredHeightMm != null ? { measuredHeightMm } : {})
  }
}
