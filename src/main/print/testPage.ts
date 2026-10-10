/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۴ طرح چاپ — «برگه‌ی چاپ آزمایشی کاربرپسند» (بخش ۷.۴ طرح).
 *
 * چرا این فایل وقتی `diagnose.ts` هم برگه‌ی آزمایشی می‌سازد؟ چون آن یکی ابزار
 * تشخیص فاز ۰ بود (پنج حالت الف تا ه با اسکریپت و صفحه‌ی تنظیمات دستی) و این
 * یکی برگه‌ی *روزمره*ی «چاپ آزمایشی» است که تکنسین از تب تنظیمات می‌زند:
 *
 *   • کادر ۱ میلی‌متری روی لبه‌ی صفحه — اگر کادر ناقص چاپ شد، همان‌جا معلوم می‌شود
 *     که درایور کاغذ را کوچک‌تر گرفته یا محتوا روی درز افتاده است.
 *   • خط‌کش افقی و عمودی با شماره‌ی هر ۱۰ میلی‌متر (ارقام فارسی).
 *   • مستطیل مرجع با ابعاد نوشته‌شده (پیش‌فرض ۵۰×۲۰mm) برای اندازه‌گیری با خط‌کش
 *     و مقایسه با عدد مورد انتظار: خطای مجاز ≤ ۱mm.
 *   • یک جمله‌ی فارسی، ارقام فارسی و لاتین، بارکد Code128.
 *   • سطر پارامترها: نام چاپگر، اندازه‌ی صفحه‌ی ارسالی و موتور.
 *   • برای رول چندستونه: هر خانه کادر و شماره‌ی ستون خودش را دارد تا جابه‌جایی
 *     (offset/gap) دیده شود.
 *
 * ⚠️ این ماژول هیچ چیزی از منطق فروش/چاپ عوض نمی‌کند؛ فقط وقتی صدایش می‌زنیم که
 * کاربر خودش دکمه‌ی «چاپ آزمایشی» را بزند. مسیر چاپ همان `printHtml` است تا
 * آزمون، *همان* مسیری را بسنجد که فاکتور و لیبل واقعی از آن می‌روند.
 * ===========================================================================
 */
import { faDigits } from '@shared/jalali'
import {
  PAGE_SIZE_LIMITS,
  labelColumns,
  labelRowDims,
  receiptPageSpec,
  type LabelPrintMethod,
  type LabelSensorType
} from '@shared/printSpec'
import { barcodePng } from '../services/BarcodeService'
import { settingsService } from '../services/SettingsService'
import { printHtml } from './printer'
import { resolvePrintTargetName, type PrintProfileKind } from './target'
// نشست ۲۲۲ · فاز ۵ — چاپ آزمایشی «دقیق (RAW)»: همان برگه، از مسیر خام
import { assertRawNotDialog, isRawMethod } from './raw/route'
import { markRawTrialOk } from './raw/gate'
import { mmToPrinterDots, printEscPosDoc, printTsplRow } from './raw'

/** اندازه‌ی مستطیل مرجع مطابق طرح (بخش ۷.۴). */
export const TEST_REF_WIDTH_MM = 50
export const TEST_REF_HEIGHT_MM = 20

export interface TestPageSpec {
  /** نام صریح چاپگر (خروجی resolver) — روی خود برگه چاپ می‌شود. */
  deviceName: string
  /** اندازه‌ای که به Electron داده می‌شود. */
  widthMm: number
  heightMm: number | 'AUTO'
  /** عرض قابل‌چاپ (مبنای اندازه‌ی کادر خانه‌ها). */
  contentWidthMm: number
  /** برای لیبل: تعداد ستون رول؛ برای رسید: ۱. */
  columns: number
  /** فاصله‌ی افقی بین لیبل‌ها (فقط لیبل). */
  gapXMm: number
  /** متن فارسی کاغذ فعلی برای سطر پارامترها (مثلاً «رسید ۸۰ میلی‌متری»). */
  presetLabel: string
  /** موتور فعلی (فاز ۴ همیشه CHROMIUM است؛ فاز ۵ مقدار RAW را می‌آورد). */
  method?: LabelPrintMethod
  /** تصویر بارکد آماده (اختیاری؛ نبودش برگه را بی‌بارکد می‌سازد). */
  barcodeHtml?: string
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
 * تیک‌های یک خط‌کش با شماره‌ی هر ۱۰ میلی‌متر.
 * `axis` تعیین می‌کند تیک‌ها با `left` چیده شوند (خط‌کش افقی) یا با `top`
 * (خط‌کش عمودی) — درس فاز ۰: با `left`ِ ثابت، خط‌کش عمودی روی خط‌کش افقی می‌افتد.
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
 * HTML برگه‌ی آزمایشی. تابع خالص است (فقط رشته می‌سازد) تا مستقیم تست شود؛
 * چاپش کار `runPrintTestPage` است.
 */
export function buildTestPageHtml(profile: PrintProfileKind, spec: TestPageSpec): string {
  const columns = profile === 'LABEL' ? clamp(Math.round(num(spec.columns, 1)) || 1, 1, 3) : 1
  const gapX = clamp(num(spec.gapXMm, 2), 0, 20)
  const widthMm = clamp(
    num(spec.widthMm, 80),
    PAGE_SIZE_LIMITS.minWidthMm,
    PAGE_SIZE_LIMITS.maxWidthMm
  )
  const autoHeight = spec.heightMm === 'AUTO'
  const heightMm = autoHeight
    ? 0
    : clamp(num(spec.heightMm, 140), PAGE_SIZE_LIMITS.minHeightMm, PAGE_SIZE_LIMITS.maxHeightMm)
  const contentWidthMm = clamp(num(spec.contentWidthMm, widthMm - 8), 10, widthMm)
  const multi = columns > 1
  /** لیبل ۳۰mm کوتاه است؛ متن‌های توضیحی حذف می‌شوند تا سطر پارامترها بریده نشود. */
  const compact = !autoHeight && heightMm < 45
  /** طول خط‌کش عمودی: ارتفاع ثابت، یا ۱۴۰mm اسمی وقتی ارتفاع اندازه‌گیری می‌شود. */
  const rulerLenMm = autoHeight ? 140 : heightMm
  const rulerThick = rulerLenMm >= 60 ? 7 : 4
  const cellW = multi ? (widthMm - (columns - 1) * gapX) / columns : widthMm
  const refW = Math.max(10, Math.min(TEST_REF_WIDTH_MM, cellW - rulerThick - 8))
  const refH = Math.max(4, Math.min(TEST_REF_HEIGHT_MM, rulerLenMm - rulerThick - 14))
  const barcodeH = clamp(Math.min(12, rulerLenMm / 4), 4, 14)
  const barcodeW = Math.max(18, Math.min(cellW - rulerThick - 6, 46))
  const method = spec.method === 'RAW' ? 'RAW (دستور خام)' : 'Chromium'
  const printerLabel = escapeHtml(spec.deviceName || 'پیش‌فرض ویندوز')
  const presetLabel = escapeHtml(spec.presetLabel || '—')
  const sizeLabel = `${faDigits(round2(widthMm))}×${
    autoHeight ? 'ارتفاع اندازه‌گیری‌شده' : faDigits(round2(heightMm))
  } میلی‌متر`
  const title = profile === 'LABEL' ? 'برگه‌ی آزمایشی لیبل — محک' : 'برگه‌ی آزمایشی فاکتور — محک'

  const cellHtml = (columnNo: number | null): string => `
  <section class="cell">
    <div class="hd">${title}${columnNo ? ` · ستون ${faDigits(columnNo)}` : ''}</div>
    ${compact ? '' : '<div class="txt">این برگه برای سنجش اندازه با خط‌کش است؛ اگر کادر لبه ناقص است، جهت برش/offset را نشان می‌دهد.</div>'}
    <div class="digits">ارقام فارسی: ${faDigits('0123456789')} · ارقام لاتین: 0123456789</div>
    <div class="ref" style="width:${round2(refW)}mm;height:${round2(refH)}mm">
      مستطیل مرجع ${faDigits(round2(refW))}×${faDigits(round2(refH))} میلی‌متر
    </div>
    ${
      spec.method === 'RAW'
        ? `<div class="chk">${Array.from({ length: 8 }, (_v, i) => `<i class="${i % 2 ? '' : 'on'}"></i>`).join('')}</div>`
        : ''
    }
    ${spec.barcodeHtml ? `<img class="bc" style="width:${round2(barcodeW)}mm;height:${round2(barcodeH)}mm" src="${spec.barcodeHtml}" alt="barcode" />` : ''}
    <div class="params">
      کاغذ: ${presetLabel}<br />
      چاپگر: ${printerLabel}<br />
      اندازه‌ی ارسالی: ${sizeLabel}${multi ? ` · عرض ردیف ${faDigits(round2(widthMm))} میلی‌متر` : ''}<br />
      موتور: ${escapeHtml(method)}
    </div>
  </section>`

  const cells = multi
    ? Array.from({ length: columns }, (_v, i) => cellHtml(i + 1)).join('')
    : cellHtml(null)

  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<title>${title}</title>
<style>
  @page { ${autoHeight ? '' : `size: ${round2(widthMm)}mm ${round2(heightMm)}mm;`} margin: 0; }
  html, body { margin:0; padding:0; height:auto; }
  .page { width:${round2(widthMm)}mm; ${autoHeight ? '' : `height:${round2(heightMm)}mm;`} box-sizing:border-box;
          border:1mm solid #000; position:relative; overflow:hidden; direction:rtl;
          font-family: Vazirmatn, Tahoma, sans-serif; font-size:9px; color:#000; background:#fff; }
  .rh { position:absolute; top:0; inset-inline:0; height:${rulerThick}mm; direction:ltr; }
  .rh i { position:absolute; top:0; height:2mm; border-left:0.15mm solid #000; font-style:normal;
          font-size:5px; padding-top:2.1mm; }
  .rv { position:absolute; inset-block:0; left:0; width:${rulerThick}mm; direction:ltr; }
  .rv i { position:absolute; left:0; width:2mm; border-top:0.15mm solid #000; font-style:normal;
          font-size:5px; padding-left:2.1mm; }
  .content { ${
    autoHeight
      ? `position:relative; margin:${rulerThick}mm 0 0 ${rulerThick}mm;`
      : multi
        ? 'position:absolute; inset:0;'
        : `position:absolute; top:${rulerThick}mm; left:${rulerThick}mm; right:0; bottom:0;`
  }
             display:grid; ${multi ? `grid-template-columns:repeat(${columns}, ${round2(cellW)}mm); column-gap:${round2(gapX)}mm;` : ''}
             box-sizing:border-box; padding:${multi ? 0 : 1}mm; }
  .cell { box-sizing:border-box; ${
    // در حالت چندستونه، کادر هر خانه معیار جای لیبل فیزیکی است؛ فضای بالای خانه
    // برای خط‌کش افقی خالی می‌ماند تا تیک‌ها روی محتوا نیفتند.
    multi ? `border:0.3mm solid #000; padding:${rulerThick}mm 1mm 1mm;` : 'padding:1mm;'
  } overflow:hidden; }
  .hd { font-weight:700; margin-bottom:0.6mm; }
  .txt { margin-bottom:0.6mm; }
  .digits { margin-bottom:0.8mm; }
  .ref { border:0.3mm solid #000; box-sizing:border-box; display:flex; align-items:center;
         justify-content:center; text-align:center; font-weight:700; margin-bottom:0.8mm; }
  .bc { display:block; margin-bottom:0.8mm; }
  /* الگوی شطرنجی (فقط برگه‌ی RAW): ۱) قطبیت بیت‌ها ۲) جهت چاپ را نشان می‌دهد. */
  .chk { display:flex; width:16mm; height:4mm; margin-bottom:0.8mm; border:0.2mm solid #000; }
  .chk i { flex:1 1 auto; box-sizing:border-box; }
  .chk i.on { background:#000; }
  .params { border-top:0.2mm solid #000; padding-top:0.6mm; line-height:1.5; }
</style></head><body>
<div class="page" data-test-sheet="1" data-profile="${escapeHtml(profile)}" data-columns="${columns}"
     data-page-size="${round2(widthMm)}x${autoHeight ? 'AUTO' : round2(heightMm)}"
     data-content-width="${round2(contentWidthMm)}mm">
  <div class="rh">${rulerTicks(widthMm)}</div>
  <div class="rv">${rulerTicks(rulerLenMm, 'y')}</div>
  <div class="content">${cells}</div>
</div>
</body></html>`
}

/** نتیجه‌ی یک چاپ آزمایشی (برای نمایش پیام فارسی در تنظیمات). */
export interface TestPageResult {
  printed: boolean
  deviceName: string
  viaWindowsDefault: boolean
  pageSizeLabel: string
  method: LabelPrintMethod
  /** برای آزمایش RAW: آیا دروازه‌ی «دقیق (RAW)» با این آزمایش باز شد؟ */
  rawTrialOpened?: boolean
}

export interface TestPageInput {
  profile?: unknown
  /** نام چاپگری که همین حالا در فرم تنظیمات انتخاب شده (main اعتبارسنجی می‌کند). */
  deviceName?: unknown
  /** اجبار دیالوگ ویندوز؛ به‌طور پیش‌فرض از `useSystemDialog` همان پروفایل می‌آید. */
  silent?: unknown
  /**
   * روش آزمایش: `CHROMIUM` (پیش‌فرض) یا `RAW`. آزمایش RAW همان برگه را از مسیر
   * خام می‌فرستد و در صورت موفقیت، «دروازه‌ی روشن‌کردن RAW» را برای همین اجرا باز
   * می‌کند (`assertRawMethodAllowed`) — بخش ۷.۱ طرح.
   */
  method?: unknown
}

const parseProfile = (raw: unknown): PrintProfileKind => {
  const v = String(raw ?? '').trim().toUpperCase()
  if (v === 'LABEL') return 'LABEL'
  if (v === 'WHOLESALE') return 'WHOLESALE'
  return 'INVOICE'
}

/**
 * ساخت `TestPageSpec` از تنظیمات *ذخیره‌شده* (چون کانال هیچ قالب از renderer
 * نمی‌گیرد؛ دلیلش قرارداد «فقط main اعتبارسنجی می‌کند» و جلوگیری از ذخیره‌ی
 * کهنه است). اگر مدیر در فرم تغییری داده و ذخیره نکرده، برگه با تنظیمات
 * ذخیره‌شده چاپ می‌شود و UI همین را می‌گوید.
 */
export async function testPageSpecFor(
  profile: PrintProfileKind,
  deviceName: string
): Promise<TestPageSpec> {
  if (profile === 'LABEL') {
    const tpl = await settingsService.labelTemplate()
    const dims = labelRowDims(tpl)
    return {
      deviceName,
      widthMm: dims.rowWidthMm,
      heightMm: dims.rowHeightMm,
      // عرض قابل‌چاپ هر خانه، خودِ عرض لیبل است (LabelTemplate فیلد paperWidthMm ندارد).
      contentWidthMm: tpl.widthMm,
      columns: labelColumns(tpl.columns),
      gapXMm: tpl.gapXMm,
      presetLabel: `لیبل ${faDigits(round2(tpl.widthMm))}×${faDigits(round2(tpl.heightMm))} میلی‌متر`,
      method: tpl.printMethod
    }
  }
  const tpl = await settingsService.receiptTemplate()
  const spec = receiptPageSpec(tpl, profile === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL')
  return {
    deviceName,
    widthMm: spec.widthMm,
    heightMm: spec.heightMm,
    contentWidthMm: spec.contentWidthMm,
    columns: 1,
    gapXMm: 0,
    presetLabel:
      profile === 'WHOLESALE' && tpl.wholesaleSeparate
        ? `فاکتور عمده — کاغذ ${faDigits(round2(spec.widthMm))} میلی‌متری`
        : `فاکتور ${faDigits(round2(spec.widthMm))} میلی‌متری`,
    method: tpl.printMethod
  }
}

/**
 * چاپ آزمایشی.
 *
 * ترتیب کار عیناً مثل مسیر واقعی است: خواندن تنظیمات ذخیره‌شده ← resolve نام
 * چاپگر با فهرست زنده (بدون fallback) ← ساخت برگه ← `printHtml` با `pageSize`.
 * پس اگر این برگه درست بیاید، مسیر واقعی هم درست است.
 */
export async function runPrintTestPage(input: TestPageInput = {}): Promise<TestPageResult> {
  const profile = parseProfile(input.profile)
  /**
   * نام چاپگر، سیاست دیالوگ و روش ذخیره‌شده از همان پروفایل می‌آید. سه شاخه‌ی
   * صریح (به‌جای یک سه‌تایی روی اجتماع دو نوع) تا هم تایپ‌ها امن بمانند و هم در
   * پروفایل عمده، «کاغذ جدا» واقعاً تصمیم بگیرد.
   */
  let savedName: string
  let useSystemDialog: boolean
  let savedMethod: LabelPrintMethod
  /** پارامترهای خام لیبل (فقط شاخه‌ی RAW لازم دارد). */
  let rawLabel: {
    dpi: number
    gapMm: number
    sensorType: LabelSensorType
    direction: number
    density: number
    speed: number
    referenceX: number
    referenceY: number
    invertBits: boolean
  } | null = null
  /** پارامترهای خام رسید/فاکتور (ESC/POS). */
  let rawReceipt: { dpi: number; cutMode: 'FULL' | 'PARTIAL' | 'NONE'; invertBits: boolean } | null = null
  if (profile === 'LABEL') {
    const tpl = await settingsService.labelTemplate()
    savedName = tpl.printerName
    useSystemDialog = tpl.useSystemDialog === true
    savedMethod = tpl.printMethod
    rawLabel = {
      dpi: tpl.rawDpi,
      gapMm: tpl.gapYMm,
      sensorType: tpl.sensorType,
      direction: tpl.direction,
      density: tpl.density,
      speed: tpl.speed,
      referenceX: mmToPrinterDots(tpl.offsetXMm, tpl.rawDpi),
      referenceY: mmToPrinterDots(tpl.offsetYMm, tpl.rawDpi),
      invertBits: tpl.rawInvert
    }
  } else {
    const tpl = await settingsService.receiptTemplate()
    savedName =
      profile === 'WHOLESALE' && tpl.wholesaleSeparate === true ? tpl.wholesalePrinterName : tpl.printerName
    useSystemDialog = tpl.useSystemDialog === true
    savedMethod = tpl.printMethod
    rawReceipt = { dpi: tpl.rawDpi, cutMode: tpl.cutMode, invertBits: tpl.rawInvert }
  }
  const { deviceName, viaWindowsDefault } = await resolvePrintTargetName({
    requestedDeviceName: input.deviceName,
    savedName
  })

  /**
   * روش آزمایش: صریح از ورودی، وگرنه همان روش **ذخیره‌شده‌ی قالب**. آزمایش با RAW
   * همیشه مجاز است — این آزمون همان چیزی است که دروازه‌ی RAW را باز می‌کند
   * (بخش ۷.۱ طرح)؛ پس هیچ‌وقت به‌خاطر روش ذخیره‌شده‌ی CHROMIUM رد نمی‌شود.
   */
  const method: LabelPrintMethod = isRawMethod(input.method)
    ? 'RAW'
    : input.method == null && isRawMethod(savedMethod)
      ? 'RAW'
      : 'CHROMIUM'

  // بارکد اختیاری است: اگر تولیدش شکست بخورد، برگه برای اندازه‌گیری بی‌بارکد هم
  // کار می‌کند و چاپ آزمایشی نباید به‌خاطرش بایستد.
  let barcodeHtml: string | undefined
  try {
    barcodeHtml = await barcodePng('MAHAK-TEST', { scale: 2, height: 10, includetext: true })
  } catch {
    barcodeHtml = undefined
  }

  const spec = await testPageSpecFor(profile, deviceName)
  const html = buildTestPageHtml(profile, { ...spec, method, barcodeHtml })
  /** `useSystemDialog` همان پروفایل تعیین می‌کند دیالوگ ویندوز بیاید یا چاپ بی‌صدا باشد. */
  const silent = input.silent == null ? !useSystemDialog : input.silent !== false

  if (method === 'RAW') {
    assertRawNotDialog(silent)
    /**
     * برگه‌ی آزمایشی RAW (بخش ۸.۳). برای لیبل هر **ردیف** یک کار TSPL و برای رسید
     * یک کار ESC/POS فرستاده می‌شود. ⚠️ عرض `SIZE` روی لیبل، عرض کل ردیف گرفته
     * شده؛ اینکه دستگاه عرض «یک لیبل» می‌خواهد یا «ردیف»، یکی از سه مجهولی است که
     * فقط با همین برگه روی دستگاه قطعی می‌شود (گزارش آزمون سخت‌افزاری مالک).
     */
    if (profile === 'LABEL' && rawLabel) {
      await printTsplRow({
        html,
        printerName: deviceName,
        widthMm: spec.widthMm,
        heightMm: Number(spec.heightMm === 'AUTO' ? TEST_REF_HEIGHT_MM + 10 : spec.heightMm),
        dpi: rawLabel.dpi,
        gapMm: rawLabel.gapMm,
        sensorType: rawLabel.sensorType,
        direction: rawLabel.direction,
        density: rawLabel.density,
        speed: rawLabel.speed,
        referenceX: rawLabel.referenceX,
        referenceY: rawLabel.referenceY,
        invertBits: rawLabel.invertBits
      })
    } else {
      await printEscPosDoc({
        html,
        printerName: deviceName,
        widthMm: spec.widthMm,
        heightMm: spec.heightMm,
        dpi: rawReceipt?.dpi ?? 203,
        cutMode: rawReceipt?.cutMode,
        invertBits: rawReceipt?.invertBits === true
      })
    }
    /**
     * فقط بعد از **موفقیت** ارسال خام: دروازه‌ی همین اجرا باز می‌شود.
     *
     * ⚠️ رسید تکی و عمده **یک کلید تنظیمات مشترک** دارند (`receipt.template` و
     * یک فیلد `printMethod`)، پس آزمون هرکدام باید دروازه‌ی دیگری را هم باز کند؛
     * وگرنه تکنسین روی کارت «عمده» آزمون می‌گیرد و ذخیره‌ی فاکتور تکی رد می‌شود.
     */
    if (profile === 'LABEL') markRawTrialOk('LABEL')
    else {
      markRawTrialOk('INVOICE')
      markRawTrialOk('WHOLESALE')
    }
  } else {
    await printHtml(html, {
      deviceName,
      silent,
      pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: 3 }
    })
  }

  return {
    printed: true,
    deviceName,
    viaWindowsDefault,
    pageSizeLabel: `${faDigits(round2(spec.widthMm))}×${
      spec.heightMm === 'AUTO' ? 'ارتفاع اندازه‌گیری‌شده' : faDigits(round2(spec.heightMm))
    } میلی‌متر`,
    method,
    rawTrialOpened: method === 'RAW'
  }
}
