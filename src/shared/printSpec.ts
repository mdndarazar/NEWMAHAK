/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۰ طرح چاپ — «توابع خالصِ اندازه‌ی کاغذ».
 *
 * این فایل هیچ import ای از Electron/Prisma/دیتابیس ندارد (فقط `faDigits` برای
 * متن پیام)، پس هم در main و هم در تست‌های node مستقیم قابل استفاده است.
 *
 * قرارداد واحدها (طبق طرح):
 *   • `webContents.print` میکرون می‌گیرد ⇒ `pageSizeMicrons`.
 *   • CSS و اندازه‌گیری داخل صفحه با میلی‌متر کار می‌کند؛ ارتفاع محتوا در px
 *     (۹۶dpi کرومیوم) اندازه‌گیری می‌شود و باید به mm برگردد ⇒ `mmFromCssPx`.
 *
 * ⚠️ یک اصلاحِ آگاهانه نسبت به متن طرح (نسخه ۳):
 *   طرح کف ارتفاع را ۳۰mm نوشته بود، ولی خودش (بخش ۵.۴) preset های لیبل ۳۰×۲۰،
 *   ۴۰×۲۰ و ۵۰×۲۵ را هم دارد و پیش‌فرض لیبل فروشگاه ۵۰×۳۰ است. با کف ۳۰mm،
 *   انتخاب preset «۵۰×۲۵» یا «۴۰×۲۰» در زمان چاپ با BusinessError رد می‌شد —
 *   یعنی یک قابلیت اعلام‌شده‌ی خودِ طرح بی‌صدا از کار می‌افتاد. نسخه ۴ طرح هم
 *   مستقل به همین نتیجه رسیده بود (کف ۱۰mm). پس کف هر دو بُعد ۱۰mm است و پیام
 *   خطا هم از همین ثابت‌ها ساخته می‌شود تا متن و رفتار هرگز از هم جدا نشوند.
 * ===========================================================================
 */
import { faDigits } from './jalali'

/**
 * بازه‌ی مجاز اندازه‌ی کاغذ به میلی‌متر.
 * سقف عرض/ارتفاع با `pdfFromHtml` هم‌راستا است تا یک قالب نتواند از مسیر چاپ
 * عبور کند ولی در مسیر PDF رد شود.
 */
export const PAGE_SIZE_LIMITS = {
  minWidthMm: 10,
  maxWidthMm: 600,
  minHeightMm: 10,
  maxHeightMm: 2000
} as const

/** عرض/ارتفاع نامعتبر (NaN، خارج از بازه) ⇒ پیام فارسی روشن، نه چاپ با اندازه‌ی حدسی. */
export const PAGE_SIZE_LIMIT_MESSAGE =
  'اندازه‌ی کاغذ تنظیم‌شده نامعتبر است ' +
  `(عرض ${faDigits(PAGE_SIZE_LIMITS.minWidthMm)} تا ${faDigits(PAGE_SIZE_LIMITS.maxWidthMm)} ` +
  `و طول ${faDigits(PAGE_SIZE_LIMITS.minHeightMm)} تا ${faDigits(PAGE_SIZE_LIMITS.maxHeightMm)} میلی‌متر).`

/** اندازه‌گیری ارتفاع محتوا شکست خورد یا در مهلت تمام نشد (هنوز چیزی به چاپگر نرفته). */
export const MEASURE_HEIGHT_FAILED_MESSAGE =
  'اندازه‌گیری طول فاکتور انجام نشد و چیزی چاپ نشد؛ دوباره تلاش کنید.'

/** طول محاسبه‌شده‌ی محتوا از سقف مجاز کاغذ بیشتر است (برای رول پیوسته یعنی قالب خراب). */
export const CONTENT_TOO_TALL_MESSAGE =
  `طول محاسبه‌شده‌ی سند از سقف مجاز کاغذ (${faDigits(PAGE_SIZE_LIMITS.maxHeightMm)} میلی‌متر) ` +
  'بیشتر است و چیزی چاپ نشد؛ تعداد اقلام یا قالب چاپ را بررسی کنید.'

/** عرض/ارتفاع داده‌شده در بازه‌ی مجاز است؟ (عدد نامتناهی یا منفی ⇒ نامعتبر) */
export function pageSizeWithinLimits(widthMm: number, heightMm: number): boolean {
  return (
    Number.isFinite(widthMm) &&
    Number.isFinite(heightMm) &&
    widthMm >= PAGE_SIZE_LIMITS.minWidthMm &&
    widthMm <= PAGE_SIZE_LIMITS.maxWidthMm &&
    heightMm >= PAGE_SIZE_LIMITS.minHeightMm &&
    heightMm <= PAGE_SIZE_LIMITS.maxHeightMm
  )
}

/**
 * تبدیل میلی‌متر به میکرون — واحدِ ورودی `webContents.print`.
 * خروجی همیشه عدد صحیح است (Electron اعشار میکرون را معنا نمی‌کند).
 */
export function pageSizeMicrons(widthMm: number, heightMm: number): { width: number; height: number } {
  return { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) }
}

/**
 * تبدیل px صفحه (۹۶dpi قرارداد CSS) به میلی‌متر فیزیکی.
 * بدون گردکردن برمی‌گرداند تا صدازننده خودش سیاست گردکردنش را داشته باشد.
 */
export function mmFromCssPx(px: number): number {
  return (px * 25.4) / 96
}

/* ===========================================================================
 * نشست ۲۲۲ · فاز ۱ طرح چاپ — «اندازه‌ی کاغذ فاکتور».
 *
 * تا امروز عرض کاغذ فاکتور فقط یک عدد نمایشی در CSS بود (`paperWidthMm`) و
 * ارتفاع هیچ‌وقت به چاپگر اعلام نمی‌شد؛ نتیجه روی درایورهایی که کاغذ پیش‌فرض
 * A4 دارند «یک نوار باریک» بود. از این فاز، اندازه از همین توابع خالص ساخته
 * می‌شود: عرض فیزیکی کاغذ + ارتفاع ثابت یا اندازه‌گیری‌شده، حاشیه‌ها، و فونت
 * متناسب با عرض قابل‌چاپ.
 *
 * این بخش هیچ وابستگی Electron/DB ندارد؛ فقط ورودیِ ساختاری می‌گیرد تا هم main
 * و هم تست‌های node بتوانند مستقیم صدایش بزنند.
 * ======================================================================== */

/** preset های کاغذ فاکتور (جدول ۵.۴ طرح). «دلخواه» یعنی مقدارها از خود قالب می‌آید. */
export type ReceiptPaperPreset = 'THERMAL_80' | 'THERMAL_58' | 'FIXED_80x140' | 'A5' | 'A4' | 'CUSTOM'

/**
 * پروفایل چاپ فاکتور. `RETAIL` = فروش تکی، `WHOLESALE` = فاکتور عمده.
 * ⚠️ نام‌گذاری عیناً مطابق payload کانال `printInvoice` در طرح است (بخش ۶.۳)؛
 * `PrintProfileKind` در بخش ۵.۵ طرح `INVOICE` نام دارد که برای resolver فاز ۳ است.
 */
export type ReceiptProfile = 'RETAIL' | 'WHOLESALE'

/** اندازه‌ی نهایی صفحه‌ی یک سند چاپی (خروجی مشترک همه‌ی قالب‌های فاکتور). */
export interface PageSpec {
  /** عرض کاغذ فیزیکی به میلی‌متر */
  widthMm: number
  /** ارتفاع ثابت به میلی‌متر یا `'AUTO'` = اندازه‌گیری ارتفاع محتوا در main */
  heightMm: number | 'AUTO'
  marginXMm: number
  marginYMm: number
  /** عرض قابل‌چاپ (همان `paperWidthMm`) — مبنای عرض بارکد و متن‌های تمام‌عرض */
  contentWidthMm: number
  /** ضریب فونت (۱ برای ۷۲mm — یعنی مو‌به‌مو مثل قبل) */
  fontScale: number
  /** اندازه‌ی نهایی فونت بر حسب pt (تبدیل از px: ۱۲px = ۹pt) */
  fontPt: number
}

/**
 * کمینه/بیشینه‌ی ابعاد در قالب فاکتور.
 * ⚠️ این‌ها با `PAGE_SIZE_LIMITS` یکی نیستند و نباید قاطی شوند: آن‌ها سقفِ
 * «هر کار چاپی» است (لیبل هم از آن رد می‌شود)، این‌ها بازه‌ی مجازِ خود فاکتور در
 * جدول ۵.۲ طرح. clamp در `parseReceiptTemplate` انجام می‌شود.
 */
export const RECEIPT_SIZE_LIMITS = {
  minSheetWidthMm: 40,
  maxSheetWidthMm: 300,
  minSheetHeightMm: 40,
  maxSheetHeightMm: 2000,
  minPaperWidthMm: 30,
  maxPaperWidthMm: 290,
  minMarginMm: 0,
  maxMarginMm: 20,
  minSafetyMm: 0,
  maxSafetyMm: 10
} as const

const clampNumber = (v: number, min: number, max: number, fallback: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** جدول ۵.۴ — preset به (عرض کاغذ، ارتفاع، عرض قابل‌چاپ). `CUSTOM` ⇒ null. */
export function presetToSpec(
  key: ReceiptPaperPreset
): { sheetWidthMm: number; sheetHeightMm: number; paperWidthMm: number } | null {
  switch (key) {
    case 'THERMAL_80':
      return { sheetWidthMm: 80, sheetHeightMm: 0, paperWidthMm: 72 }
    case 'THERMAL_58':
      return { sheetWidthMm: 58, sheetHeightMm: 0, paperWidthMm: 48 }
    case 'FIXED_80x140':
      return { sheetWidthMm: 80, sheetHeightMm: 140, paperWidthMm: 72 }
    case 'A5':
      return { sheetWidthMm: 148, sheetHeightMm: 210, paperWidthMm: 136 }
    case 'A4':
      return { sheetWidthMm: 210, sheetHeightMm: 297, paperWidthMm: 194 }
    default:
      return null
  }
}

/** آیا رشته‌ی داده‌شده یک preset معتبر است؟ (مقدار خراب دیتابیس ⇒ مشتق می‌شود) */
export function isReceiptPaperPreset(v: unknown): v is ReceiptPaperPreset {
  return v === 'THERMAL_80' || v === 'THERMAL_58' || v === 'FIXED_80x140' || v === 'A5' || v === 'A4' || v === 'CUSTOM'
}

/**
 * ضریب فونت متناسب با عرض قابل‌چاپ: ۷۲mm ⇒ دقیقاً ۱ (رفتار فعلی فروشگاه)،
 * کاغذ ۵۸mm ⇒ ۰٫۸ و کاغذ پهن‌تر ⇒ بزرگ‌تر، با سقف ۱٫۶.
 */
export function receiptFontScale(paperWidthMm: number, autoFont: boolean): number {
  if (!autoFont) return 1
  const w = Number.isFinite(paperWidthMm) && paperWidthMm > 0 ? paperWidthMm : 72
  return Math.min(1.6, Math.max(0.8, w / 72))
}

/**
 * زیرمجموعه‌ی ساختاری `ReceiptTemplate` که اندازه‌ی صفحه از آن ساخته می‌شود.
 * عمداً به‌جای import کردن خود `ReceiptTemplate` (تا فایل خالص بماند و جهت
 * وابستگی receipt → printSpec یک‌طرفه بماند).
 */
export interface ReceiptPageFields {
  paperWidthMm: number
  sheetWidthMm: number
  sheetHeightMm: number
  marginXMm: number
  marginYMm: number
  autoFont: boolean
  fontSizePx: number
  wholesaleSeparate: boolean
  wholesaleSheetWidthMm: number
  wholesaleSheetHeightMm: number
  wholesalePaperWidthMm: number
}

/**
 * `PageSpec` نهایی فاکتور. پروفایل عمده فقط وقتی کاغذ جدا می‌گیرد که خودِ مدیر
 * `wholesaleSeparate` را روشن کرده باشد (پیش‌فرض خاموش ⇒ عمده = تکی).
 */
export function receiptPageSpec(t: ReceiptPageFields, profile: ReceiptProfile = 'RETAIL'): PageSpec {
  const wholesale = profile === 'WHOLESALE' && t.wholesaleSeparate === true
  const widthMm = clampNumber(
    wholesale ? t.wholesaleSheetWidthMm : t.sheetWidthMm,
    RECEIPT_SIZE_LIMITS.minSheetWidthMm,
    RECEIPT_SIZE_LIMITS.maxSheetWidthMm,
    80
  )
  const heightRaw = Number(wholesale ? t.wholesaleSheetHeightMm : t.sheetHeightMm)
  const heightMm = Number.isFinite(heightRaw) && heightRaw > 0 ? heightRaw : 'AUTO'
  const contentWidthMm = clampNumber(
    wholesale ? t.wholesalePaperWidthMm : t.paperWidthMm,
    RECEIPT_SIZE_LIMITS.minPaperWidthMm,
    RECEIPT_SIZE_LIMITS.maxPaperWidthMm,
    72
  )
  const fontScale = receiptFontScale(contentWidthMm, t.autoFont === true)
  const fontPt = Math.round(clampNumber(t.fontSizePx, 1, 200, 12) * 0.75 * fontScale * 10) / 10
  return {
    widthMm,
    heightMm,
    marginXMm: clampNumber(t.marginXMm, RECEIPT_SIZE_LIMITS.minMarginMm, RECEIPT_SIZE_LIMITS.maxMarginMm, 4),
    marginYMm: clampNumber(t.marginYMm, RECEIPT_SIZE_LIMITS.minMarginMm, RECEIPT_SIZE_LIMITS.maxMarginMm, 6),
    contentWidthMm,
    fontScale,
    fontPt
  }
}

/* ===========================================================================
 * نشست ۲۲۲ · فاز ۲ طرح چاپ — «لیبل: واحد چاپ یک ردیف است، نه یک لیبل».
 *
 * روی رول دوستونه، چاپ «یک لیبل» یعنی یک ردیف کامل با یک خانه‌ی خالی؛ وگرنه
 * چاپگر لیبل بعدی را یک خانه جلوتر می‌زند و لیبل‌ها ناهم‌تراز و نیمه‌مصرف
 * می‌شوند. پس چیدمان از همین‌جا (بدون Electron/DB) ساخته می‌شود:
 *   • `labelRowDims` — عرض ردیف = columns×w + (columns−1)×gapX، ارتفاع = h.
 *   • `labelRows`    — خانه‌های خالی (`null`) و «شروع از ستون».
 *   • ارتفاع خودِ ردیف در CSS عمداً `h − 0.05mm` است (فرضیه‌ی L3: گردکردن px
 *     روی ۳۰mm ≈ ۱۱۳٫۳۹px صفحه‌ی خالی می‌سازد).
 * ======================================================================== */

/** نوع سنسور رول. در Chromium فقط نمایشی است؛ در مسیر RAW (فاز ۵) به `GAP`/`BLINE` ترجمه می‌شود. */
export type LabelSensorType = 'GAP' | 'BLACKMARK' | 'CONTINUOUS'

/** موتور چاپ لیبل. پیش‌فرض کاربران فعلی `CHROMIUM` است و عوض نمی‌شود. */
export type LabelPrintMethod = 'CHROMIUM' | 'RAW'

/** بازه‌های مجاز فیلدهای «رول» در `LabelTemplate` (جدول ۵.۳ طرح). */
export const LABEL_ROLL_LIMITS = {
  minColumns: 1,
  maxColumns: 3,
  minGapMm: 0,
  maxGapMm: 20,
  minOffsetMm: -10,
  maxOffsetMm: 10,
  minDensity: 0,
  maxDensity: 15,
  minSpeed: 1,
  maxSpeed: 6,
  /** ارتفاع ردیف = ارتفاع لیبل منهای این مقدار (فرضیه‌ی L3 — صفحه‌ی خالی). */
  rowHeightTrimMm: 0.05
} as const

/**
 * زیرمجموعه‌ی ساختاری `LabelTemplate` که چیدمان رول از آن ساخته می‌شود.
 * عمداً به‌جای import کردن خود `LabelTemplate` تا این فایل خالص بماند
 * (جهت وابستگی receipt → printSpec یک‌طرفه است).
 */
export interface LabelRowFields {
  widthMm: number
  heightMm: number
  columns: number
  gapXMm: number
  offsetXMm: number
  offsetYMm: number
}

/** تعداد ستون‌های معتبر (عدد خراب ⇒ ۱). */
export function labelColumns(columns: unknown): number {
  const n = Number(columns)
  if (!Number.isFinite(n)) return LABEL_ROLL_LIMITS.minColumns
  return Math.min(LABEL_ROLL_LIMITS.maxColumns, Math.max(LABEL_ROLL_LIMITS.minColumns, Math.round(n)))
}

/**
 * ابعاد یک ردیف لیبل. `rowHeightMm` همان ارتفاع لیبل است؛ چیزی که *در CSS*
 * چاپ می‌شود `rowHeightMm − 0.05` است (تابع `labelRowCssHeightMm`).
 */
export function labelRowDims(t: LabelRowFields): { rowWidthMm: number; rowHeightMm: number } {
  const columns = labelColumns(t.columns)
  const w = clampNumber(t.widthMm, 10, 200, 50)
  const h = clampNumber(t.heightMm, 10, 200, 30)
  const gapX = clampNumber(t.gapXMm, LABEL_ROLL_LIMITS.minGapMm, LABEL_ROLL_LIMITS.maxGapMm, 2)
  // گردکردن ۰٫۰۱ میلی‌متری: از انباشت اعشار مضاعف در CSS و تست جلوگیری می‌کند.
  const rowWidthMm = Math.round((columns * w + (columns - 1) * gapX) * 100) / 100
  return { rowWidthMm, rowHeightMm: h }
}

/** ارتفاع CSS هر ردیف (h − 0.05) با گردکردن ۰٫۰۱mm. */
export function labelRowCssHeightMm(rowHeightMm: number): number {
  return Math.round((rowHeightMm - LABEL_ROLL_LIMITS.rowHeightTrimMm) * 100) / 100
}

/**
 * چیدن لیبل‌ها در ردیف‌ها.
 *
 *   • `startColumn` = «از کدام ستون شروع شود» برای رول نیمه‌مصرف؛ ابتدا
 *     `startColumn − 1` خانه‌ی خالی می‌گذارد.
 *   • ردیف آخر ناقص با `null` پر می‌شود (خانه‌ی خالی چاپ نمی‌شود و لیبل
 *     اضافه مصرف نمی‌کند).
 *   • بدون لیبل ⇒ هیچ ردیفی (نه یک ردیف تماماً خالی).
 *
 * مثال (columns=2): ۳ لیبل ⇒ [[۱,۲],[۳,خالی]] و با startColumn=2 ⇒
 * [[خالی,۱],[۲,۳]].
 */
export function labelRows<T>(items: readonly T[], columns: unknown, startColumn = 1): (T | null)[][] {
  const cols = labelColumns(columns)
  if (!items || items.length === 0) return []
  const start = Math.min(cols, Math.max(1, Math.round(Number(startColumn)) || 1))
  const padded: (T | null)[] = [...Array.from({ length: start - 1 }, () => null as T | null), ...items]
  const rows: (T | null)[][] = []
  for (let i = 0; i < padded.length; i += cols) {
    const row = padded.slice(i, i + cols)
    while (row.length < cols) row.push(null)
    rows.push(row)
  }
  return rows
}

/** آیا رشته‌ی داده‌شده یک نوع سنسور معتبر است؟ (مقدار خراب ⇒ `GAP`) */
export function isLabelSensorType(v: unknown): v is LabelSensorType {
  return v === 'GAP' || v === 'BLACKMARK' || v === 'CONTINUOUS'
}

/** آیا رشته‌ی داده‌شده یک موتور چاپ معتبر است؟ (مقدار خراب ⇒ `CHROMIUM`) */
export function isLabelPrintMethod(v: unknown): v is LabelPrintMethod {
  return v === 'CHROMIUM' || v === 'RAW'
}

/* ===========================================================================
 * نشست ۲۲۲ · فاز ۴ طرح چاپ — «حدس نوع چاپگر از روی نام» (بخش ۷.۳ طرح).
 *
 * ⚠️ این تابع فقط **پیشنهاد** می‌دهد؛ هیچ تصمیمی نمی‌گیرد. هیچ‌جا نباید بر اساس
 * آن چاپگر یا اندازه‌ی کاغذ عوض شود — فقط برچسب و یک نوار پیشنهاد در UI.
 * ورودی‌اش فقط نام/توضیح چاپگر است (هیچ پرسشی از سیستم‌عامل).
 * ======================================================================== */

/** نوع حدسی چاپگر؛ `PAGE` یعنی «کاغذ A4 یا چاپگر مجازی/بی‌ربط». */
export type PrinterKindGuess = 'RECEIPT' | 'LABEL' | 'PAGE' | 'UNKNOWN'

/** کلیدواژه‌های نام چاپگر لیبل (لیبل‌زن‌های رایج: TSC، Zebra، Godex، …). */
const LABEL_HINTS = ['tsc', 'ttp', 'tdp', 'label', 'لیبل', 'zebra', 'zdesigner', 'godex', 'gprinter']

/** کلیدواژه‌های نام چاپگر رسید حرارتی ۵۸/۸۰ میلی‌متری. */
const RECEIPT_HINTS = ['axiom', 'pos', 'receipt', 'thermal', 'حرارتی', 'xp-', '80mm', '58mm', 'r80', 'r58']

/** کلیدواژه‌های چاپگر مجازی/بی‌ربط (PDF، XPS، فکس، OneNote). */
const PAGE_HINTS = ['pdf', 'onenote', 'xps', 'fax', 'print to', 'مایکروسافت', 'فکس']

/**
 * حدس نوع چاپگر از نام آن. ترتیب بررسی مهم است: اول لیبل (چون نام بعضی
 * لیبل‌زن‌ها «thermal» هم دارد)، بعد رسید، بعد چاپگر مجازی/کاغذی، وگرنه نامعلوم.
 */
export function guessPrinterKind(name: string): PrinterKindGuess {
  const s = String(name ?? '').toLowerCase()
  if (!s.trim()) return 'UNKNOWN'
  if (LABEL_HINTS.some((k) => s.includes(k))) return 'LABEL'
  if (RECEIPT_HINTS.some((k) => s.includes(k))) return 'RECEIPT'
  if (PAGE_HINTS.some((k) => s.includes(k))) return 'PAGE'
  return 'UNKNOWN'
}

/**
 * پیشنهاد preset کاغذ بر اساس نوع حدسی چاپگر (نوار پیشنهاد بخش ۷.۱ طرح).
 * فقط متن و کلیدِ preset را برمی‌گرداند؛ **اعمالش فقط با تأیید کاربر است**.
 * برای لیبل `presetKey` تهی است چون اندازه‌ی لیبل preset جدا دارد.
 */
export function printerKindSuggestion(
  kind: PrinterKindGuess | undefined
): { presetKey: 'THERMAL_80' | null; text: string } | null {
  if (kind === 'RECEIPT')
    return {
      presetKey: 'THERMAL_80',
      text: 'به نظر می‌رسد این یک چاپگر رسید ۸۰ میلی‌متری است. کاغذ روی «رسید ۸۰ میلی‌متری» تنظیم شود؟'
    }
  if (kind === 'LABEL')
    return {
      presetKey: null,
      text: 'به نظر می‌رسد این یک چاپگر لیبل است؛ ابعاد رول را در بخش «پیشرفته» بررسی کنید.'
    }
  if (kind === 'PAGE')
    return { presetKey: null, text: 'این یک چاپگر کاغذی/مجازی است و برای رسید یا لیبل مناسب نیست.' }
  return null
}
