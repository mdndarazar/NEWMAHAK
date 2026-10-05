import { app, dialog, shell, BrowserWindow } from 'electron'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { BusinessError } from '../errors'
import { toJalaliDate } from '@shared/jalali'
import { buildXlsx, type CellValue } from './xlsx'

/**
 * ---------------------------------------------------------------------------
 * «خروجی اکسل» هر جدول گزارش.
 *
 * نسخه‌ی قبلی یک فایل CSV می‌ساخت و بی‌سؤال در پوشه‌ی داخلی برنامه می‌گذاشت؛
 * نتیجه‌اش این بود که اکسل فایل را به‌هم‌ریخته (همه در یک ستون) باز می‌کرد و
 * کاربر هم نمی‌دانست فایل کجا رفته. حالا:
 *
 *   ۱) قبل از ساخت فایل، پنجره‌ی «ذخیره به‌عنوان» ویندوز باز می‌شود و کاربر
 *      خودش مسیر و نام فایل را انتخاب می‌کند (Cancel = هیچ فایلی ساخته نمی‌شود).
 *   ۲) فایل یک xlsx واقعی و استاندارد است (src/main/services/xlsx.ts): ستون‌بندی
 *      درست، سرستون ثابت و فیلتردار، برگه‌ی راست‌به‌چپ و مبالغ به‌صورت عدد
 *      واقعی با قالب ۱٬۰۰۰ (قابل جمع زدن در اکسل).
 *   ۳) اگر کاربر در همان پنجره پسوند csv را انتخاب کند، CSV با BOM ساخته
 *      می‌شود (مسیر قدیمی، برای وقتی که فایل باید در برنامه‌ی دیگری باز شود).
 * ---------------------------------------------------------------------------
 */
/**
 * اکسل در CSV حتی سلولِ نقل‌قول‌شده‌ای را که با `=`, `+`, `-` یا `@` شروع
 * شود می‌تواند فرمول بداند. این مسیر فقط برای CSV است؛ عددهای واقعی را متن
 * نمی‌کنیم تا مبلغ منفیِ عددی همچنان عدد بماند. مقدار متنی مشکوک با apostrophe
 * شروع می‌شود تا در اکسل به‌صورت متن نمایش داده شود، نه دستور.
 */
const CSV_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/

function csvCell(v: unknown): string {
  const raw = v == null ? '' : String(v)
  const s = typeof v === 'string' && CSV_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export interface ExportInput {
  fileName: string
  headers: string[]
  rows: CellValue[][]
  totals?: CellValue[]
  /** نام برگه‌ی اکسل (پیش‌فرض: از fileName) */
  sheetName?: string
  /** یک خط عنوان بالای جدول (مثلاً بازه‌ی تاریخ گزارش) */
  title?: string
  /** پرسیدن مسیر ذخیره از کاربر. پیش‌فرض: بله */
  ask?: boolean
  /** قالب پیش‌فرض پنجره‌ی ذخیره */
  format?: 'xlsx' | 'csv'
  /** بعد از ذخیره، فایل در پوشه‌اش نشان داده شود (پیش‌فرض: بله) */
  reveal?: boolean
}

export interface ExportResult {
  /** کاربر پنجره‌ی ذخیره را بست ⇒ هیچ فایلی ساخته نشد */
  canceled: boolean
  path: string | null
  rows: number
  format: 'xlsx' | 'csv'
}

function stampedName(fileName: string, ext: string): string {
  const stamp = toJalaliDate(new Date()).replace(/\//g, '-')
  const safe = String(fileName || 'report').replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}-${stamp}.${ext}`
}

/** پوشه‌ی پیش‌فرض پنجره‌ی ذخیره: «اسناد» کاربر، و اگر نبود پوشه‌ی خودِ برنامه. */
function documentsDir(): string {
  try {
    return app.getPath('documents')
  } catch {
    return app.getPath('userData')
  }
}

function csvBuffer(input: ExportInput): Buffer {
  const lines: string[] = []
  if (input.title?.trim()) lines.push(csvCell(input.title.trim()))
  lines.push(input.headers.map(csvCell).join(','))
  for (const r of input.rows ?? []) lines.push(r.map(csvCell).join(','))
  if (input.totals?.length) lines.push(input.totals.map(csvCell).join(','))
  // BOM تا اکسل فارسی را درست بخواند
  return Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8')
}

/**
 * ---------------------------------------------------------------------------
 * نشست ۱۲۹ · خوشه J — ذخیره‌ی «همه یا هیچ» و پیام فارسی خطای نوشتن.
 *
 * قبلاً فایل مستقیم روی مسیر نهایی نوشته می‌شد:
 *   • اگر نوشتن وسط کار می‌شکست (پر شدن دیسک، جدا شدن فلش)، یک فایل نیمه‌کاره
 *     روی همان نام می‌ماند؛ CSV نیمه‌کاره در اکسل بدون هیچ هشداری باز می‌شود و
 *     ردیف‌های جاافتاده شبیه «گزارش کامل» دیده می‌شوند؛ فایل قبلی هم از بین رفته بود.
 *   • اگر فایل در اکسل باز بود (EBUSY/EPERM ویندوز)، پیام خام انگلیسی به پیام
 *     کلیِ بی‌علت «انجام این عملیات ممکن نشد» تبدیل می‌شد.
 * حالا داده اول در یک فایل موقت کنار مقصد نوشته و بعد با rename جایگزین می‌شود؛
 * هر شکستی فایل موقت را پاک می‌کند و فایل قبلی مقصد را دست‌نخورده می‌گذارد.
 * ---------------------------------------------------------------------------
 */
const LOCK_CODES = new Set(['EBUSY', 'EPERM', 'EACCES'])
/** قفل کوتاه آنتی‌ویروس ویندوز روی فایل تازه‌نوشته‌شده؛ چند تلاش کوتاه، نه انتظار طولانی. */
const RENAME_RETRY_DELAYS_MS = [50, 100, 200, 400, 800]

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** پیام فارسی خطای نوشتن فایل خروجی، همراه نام فایل و علت. */
export function exportWriteErrorMessage(err: unknown, target: string): string {
  const code = String((err as { code?: unknown } | null)?.code ?? '')
  const name = basename(target)
  const kept = 'هیچ فایل نیمه‌کاره‌ای ساخته نشد و فایل قبلی با همین نام (اگر بود) دست‌نخورده ماند.'
  if (LOCK_CODES.has(code))
    return (
      `فایل «${name}» ذخیره نشد: این فایل در برنامه‌ی دیگری (مثلاً اکسل) باز است یا اجازه‌ی نوشتن در این پوشه وجود ندارد. ` +
      `فایل را ببندید یا نام/پوشه‌ی دیگری انتخاب کنید و دوباره خروجی بگیرید. ${kept}`
    )
  if (code === 'ENOSPC') return `فایل «${name}» ذخیره نشد: فضای خالی دیسک کافی نیست. ${kept}`
  if (code === 'EROFS') return `فایل «${name}» ذخیره نشد: این دیسک یا پوشه فقط‌خواندنی است. ${kept}`
  if (code === 'ENOENT' || code === 'ENOTDIR')
    return `فایل «${name}» ذخیره نشد: پوشه‌ی انتخاب‌شده پیدا نشد (شاید فلش یا درایو جدا شده است). ${kept}`
  if (code === 'EISDIR') return `فایل «${name}» ذخیره نشد: با این نام یک پوشه وجود دارد؛ نام دیگری انتخاب کنید. ${kept}`
  if (code === 'ENAMETOOLONG') return `فایل «${name}» ذخیره نشد: نام یا مسیر فایل بیش از حد طولانی است. ${kept}`
  return `فایل «${name}» ذخیره نشد (کد خطای سیستم: ${code || 'نامشخص'}). ${kept}`
}

/**
 * نوشتن «همه یا هیچ»: یا کل داده در مسیر نهایی می‌نشیند، یا مسیر نهایی دست‌نخورده
 * می‌ماند و خطای فارسی با علت برمی‌گردد. برای PDF سند اعتبار هم استفاده می‌شود.
 */
export async function writeFileAtomic(target: string, data: Buffer | Uint8Array): Promise<void> {
  const temp = join(dirname(target), `.${basename(target)}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`)
  try {
    await writeFile(temp, data, { flag: 'wx' })
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temp, target)
        break
      } catch (err) {
        const code = String((err as { code?: unknown } | null)?.code ?? '')
        if (!LOCK_CODES.has(code) || attempt >= RENAME_RETRY_DELAYS_MS.length) throw err
        await sleep(RENAME_RETRY_DELAYS_MS[attempt])
      }
    }
  } catch (err) {
    await rm(temp, { force: true }).catch(() => {})
    throw new BusinessError(exportWriteErrorMessage(err, target))
  }
}

/**
 * پنجره‌ی والد «ذخیره به‌عنوان»: فقط پنجره‌ی زنده و دیده‌شدنی. پنجره‌های مخفی چاپ
 * (`show: false`) هم در `getAllWindows` هستند؛ اگر والد دیالوگ شوند، دیالوگ به
 * پنجره‌ای نامرئی می‌چسبد و با بسته‌شدن آن پنجره بعد از چاپ، بی‌صدا «لغو» می‌شود.
 * نبودن پنجره‌ی مناسب ⇒ دیالوگ بدون والد (همچنان نمایش داده می‌شود).
 */
export function dialogParentWindow(): BrowserWindow | null {
  const usable = (w: BrowserWindow | null | undefined): w is BrowserWindow =>
    !!w && !w.isDestroyed() && w.isVisible()
  const focused = BrowserWindow.getFocusedWindow()
  if (usable(focused)) return focused
  return BrowserWindow.getAllWindows().find(usable) ?? null
}

/**
 * ساخت فایل خروجی. مسیر را از کاربر می‌پرسد (مگر `ask: false`).
 * خروجی `canceled: true` یعنی کاربر منصرف شد — و این یک خطا نیست.
 */
export async function exportTableFile(input: ExportInput): Promise<ExportResult> {
  if (!input?.headers?.length) throw new BusinessError('ستونی برای خروجی گرفتن مشخص نشده است.')

  const preferred: 'xlsx' | 'csv' = input.format === 'csv' ? 'csv' : 'xlsx'
  const rowCount = (input.rows ?? []).length
  let target: string

  if (input.ask === false) {
    const dir = join(app.getPath('userData'), 'exports')
    await mkdir(dir, { recursive: true })
    target = join(dir, stampedName(input.fileName, preferred))
  } else {
    const win = dialogParentWindow()
    const defaultPath = join(documentsDir(), stampedName(input.fileName, preferred))
    const xlsxFilter = { name: 'کارپوشه‌ی اکسل', extensions: ['xlsx'] }
    const csvFilter = { name: 'فایل متنی CSV', extensions: ['csv'] }
    const options = {
      title: 'فایل خروجی کجا ذخیره شود؟',
      defaultPath,
      buttonLabel: 'ذخیره',
      filters: preferred === 'csv' ? [csvFilter, xlsxFilter] : [xlsxFilter, csvFilter]
    }
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (res.canceled || !res.filePath) return { canceled: true, path: null, rows: rowCount, format: preferred }
    target = res.filePath
  }

  /**
   * اگر کاربر در Save dialog پسوند را ننویسد، Electron در همه‌ی محیط‌ها
   * تضمین نمی‌کند که پسوند فیلتر انتخاب‌شده را خودش اضافه کند. قبل از این
   * اصلاح، انتخاب CSV با نام «گزارش» به‌صورت بی‌صدا به «گزارش.xlsx» تبدیل
   * می‌شد: محتوای CSV نبود، اما کاربر هم دلیلی برای شک‌کردن نداشت.
   *
   * پسوند صریح کاربر اولویت دارد؛ در نبود پسوند، همان قالب انتخاب‌شده را
   * اضافه می‌کنیم. این مسیر روی xlsx موجود هم همان رفتار قبلی را نگه می‌دارد.
   */
  const hasCsvExtension = /\.csv$/i.test(target)
  const hasXlsxExtension = /\.xlsx$/i.test(target)
  const format: 'xlsx' | 'csv' = hasCsvExtension ? 'csv' : hasXlsxExtension ? 'xlsx' : preferred
  if (!hasCsvExtension && !hasXlsxExtension) target = `${target}.${format}`

  const data = format === 'csv' ? csvBuffer(input) : buildXlsx({
    name: input.sheetName || input.fileName,
    title: input.title,
    headers: input.headers,
    rows: input.rows ?? [],
    totals: input.totals
  })

  await writeFileAtomic(target, data)
  if (input.reveal !== false) {
    try {
      shell.showItemInFolder(target)
    } catch {
      /* نشان دادن پوشه اگر نشد، خروجی را خراب نمی‌کند */
    }
  }
  return { canceled: false, path: target, rows: rowCount, format }
}

/** سازگاری با مسیر قدیمی (کانال system:exportCsv). */
export const exportCsv = exportTableFile
