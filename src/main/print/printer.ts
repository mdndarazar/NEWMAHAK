import { app, BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BusinessError } from '../errors'
// نشست ۲۲۲ · فاز ۰ طرح چاپ — اندازه‌ی صفحه‌ی فیزیکی کار و اندازه‌گیری ارتفاع محتوا
import { measureContentHeightMm } from './pageSize'
import { PAGE_SIZE_LIMIT_MESSAGE, pageSizeMicrons, pageSizeWithinLimits } from '@shared/printSpec'

/**
 * ===========================================================================
 * نشست ۱۲۹ · خوشه J — مسیر مشترک «بارگذاری سند چاپی» و «نتیجه‌ی چاپ».
 *
 * سه باگ این فایل در یک رفع بسته شدند، چون هر سه روی همان پنجره‌ی مخفی چاپ‌اند:
 *
 *   ۱) سقف طول URL: Electron هر URL بلندتر از `url::kMaxURLChars` کرومیوم
 *      (۲٬۰۹۷٬۱۵۲ کاراکتر) را با ERR_INVALID_URL رد می‌کند. سند چاپی قبلاً همیشه
 *      به‌صورت data URL (با encodeURIComponent که متن فارسی را حدود سه برابر
 *      می‌کند) بار می‌شد؛ پس چاپ A4 گزارش جزئیات فروش از حدود ۲٬۶۰۰ ردیف و چاپ/PDF
 *      گروهی اعتبار از حدود ۴۵۰ سند به بالا همیشه شکست می‌خورد و کاربر فقط پیام
 *      کلی «انجام این عملیات ممکن نشد» می‌دید. حالا سند کوچک عیناً مثل قبل با data
 *      URL بار می‌شود و سند بزرگ از یک فایل موقت خصوصی (mode 0600) که بعد از
 *      چاپ/شکست همیشه پاک می‌شود.
 *   ۲) لغو/خطای چاپ: پاسخ‌های انگلیسی سیستم چاپ («canceled»، «Invalid deviceName
 *      provided»، ...) به پیام کلی و گمراه‌کننده‌ی «چیزی ذخیره نشد، برنامه را
 *      ببندید» تبدیل می‌شد. حالا پیام فارسی دقیق با علت ساخته می‌شود. لغو همچنان
 *      reject می‌شود تا هیچ صدازننده‌ای (مثلاً شمارنده‌ی چاپ سند اعتبار) آن را
 *      چاپ موفق حساب نکند.
 *   ۳) از بین رفتن پنجره: اگر پنجره‌ی مخفی پیش از callback بسته شود یا
 *      renderer آن از کار بیفتد، callback چاپ هرگز صدا نمی‌خورد و Promise برای
 *      همیشه معلق می‌ماند (در صفحه‌ی فروش یعنی قفل‌ماندن «در حال ثبت» بعد از
 *      فاکتورِ ثبت‌شده). حالا همین رویدادها Promise را با پیام «نتیجه نامعلوم»
 *      می‌بندند. عمداً timeout گذاشته نشد: اعلام «ناموفق» برای چاپی که شاید
 *      انجام شده، کاغذ تکراری و شمارنده‌ی نادرست می‌سازد (DECISIONS · S129-2).
 * ===========================================================================
 */

/** سقف طول URL در کرومیوم (`url::kMaxURLChars`)؛ بالاتر از آن loadURL رد می‌شود. */
export const CHROMIUM_MAX_URL_CHARS = 2 * 1024 * 1024
/** data URL فقط تا این طول استفاده می‌شود (حاشیه‌ی امن زیر سقف کرومیوم). */
export const PRINT_DATA_URL_MAX_CHARS = 1_900_000

const HTML_DATA_URL_PREFIX = 'data:text/html;charset=utf-8,'

/** اگر درایور چاپ callback ندهد، UI نباید تا ابد در وضعیت «در حال چاپ» بماند. */
export const PRINT_CALLBACK_TIMEOUT_MS = 30_000
/**
 * ممیزی AUDIT-S129-01 (نشت S131-2): چاپ با دیالوگ سیستم (`silent: false`) callback را
 * فقط بعد از انتخاب کاربر در دیالوگ و spool می‌دهد. مهلت ۳۰ ثانیه‌ای وسط دیالوگِ باز
 * پنجره را نابود می‌کرد و «ناموفق/نامعلوم» اعلام می‌شد در حالی که کاربر هنوز در حال
 * انتخاب چاپگر بود (و شاید بعداً کاغذ بیرون می‌آمد). برای این مسیر مهلت طولانی است.
 */
export const PRINT_DIALOG_TIMEOUT_MS = 10 * 60_000

/**
 * ممیزی AUDIT-S129-01 — خطای «نتیجه‌ی چاپ نامعلوم» (پنجره پیش از callback از بین رفت یا
 * چاپگر در مهلت پاسخ نداد). شاید کاغذ بیرون آمده باشد؛ صدازننده‌ای که شمارنده‌ی چاپ
 * دارد (سند اعتبار) باید آن را احتیاطاً «چاپ‌شده» بشمارد تا نسخه‌ی بعدی «اصل» دوم نشود.
 * لغو یا رد صریح سیستم چاپ از این نوع نیست (قطعاً چیزی چاپ نشده).
 */
export class PrintOutcomeUnknownError extends BusinessError {
  readonly printOutcomeUnknown = true
  constructor(message: string) {
    super(message)
    this.name = 'BusinessError'
  }
}

/** لغو صریح کاربر در دیالوگ چاپ: قطعاً چاپی انجام نشده و باید در UI بی‌صدا باشد. */
export class PrintCancelledError extends BusinessError {
  readonly printCancelled = true
  constructor(message = 'چاپ لغو شد و هیچ برگه‌ای چاپ نشد.') {
    super(message)
    this.name = 'BusinessError'
  }
}

/** آیا خطای چاپ «نتیجه‌ی نامعلوم» است (نه لغو/رد قطعی)؟ */
export function isPrintOutcomeUnknown(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { printOutcomeUnknown?: unknown }).printOutcomeUnknown === true
}

/** آیا خطا لغو صریح چاپ توسط کاربر است؟ */
export function isPrintCancelled(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { printCancelled?: unknown }).printCancelled === true
}

/** data URL سند، یا `null` اگر برای مسیر data URL بزرگ یا غیرقابل‌کدگذاری باشد. */
export function htmlDataUrlOrNull(html: string): string | null {
  let url: string
  try {
    url = HTML_DATA_URL_PREFIX + encodeURIComponent(html)
  } catch {
    // نیم‌جفت UTF-16 (مثلاً شکلک ناقص در نام کالا): مسیر فایل موقت آن را تحمل می‌کند
    return null
  }
  return url.length <= PRINT_DATA_URL_MAX_CHARS ? url : null
}

function printTempRoot(): string {
  try {
    return app.getPath('temp')
  } catch {
    return tmpdir()
  }
}

function errorCodeOf(err: unknown): string {
  const e = err as { code?: unknown; errno?: unknown } | null
  if (e && typeof e.code === 'string' && e.code) return e.code
  if (e && typeof e.errno === 'number') return String(e.errno)
  return ''
}

interface LoadedPrintDocument {
  via: 'data-url' | 'temp-file'
  cleanup: () => Promise<void>
}

async function loadOrExplain(load: () => Promise<unknown>): Promise<void> {
  try {
    await load()
  } catch (err) {
    const code = errorCodeOf(err)
    throw new BusinessError(
      `سند چاپی آماده نشد و چیزی به چاپگر فرستاده نشد${code ? ` (کد خطا: ${code})` : ''}؛ یک بار دیگر تلاش کنید.`
    )
  }
}

/**
 * سند را در پنجره‌ی مخفی بار می‌کند. خروجی `cleanup` باید بعد از پایان کار (موفق
 * یا ناموفق) صدا زده شود تا فایل موقت سند بزرگ روی دیسک باقی نماند.
 */
export async function loadPrintDocument(win: BrowserWindow, html: string): Promise<LoadedPrintDocument> {
  const url = htmlDataUrlOrNull(html)
  if (url) {
    await loadOrExplain(() => win.loadURL(url))
    return { via: 'data-url', cleanup: async () => {} }
  }

  let dir: string
  try {
    dir = await mkdtemp(join(printTempRoot(), 'mahak-print-'))
  } catch (err) {
    const code = errorCodeOf(err)
    throw new BusinessError(
      'سند چاپی بزرگ است و باید موقتاً روی دیسک نوشته شود، ولی پوشه‌ی موقت سیستم قابل نوشتن نبود' +
        `${code ? ` (کد خطا: ${code})` : ''}؛ چیزی به چاپگر فرستاده نشد.`
    )
  }
  const cleanup = async (): Promise<void> => {
    try {
      await rm(dir, { recursive: true, force: true })
    } catch (e) {
      console.error('[print] temp document cleanup failed', e)
    }
  }
  try {
    const file = join(dir, 'document.html')
    try {
      await writeFile(file, html, { encoding: 'utf8', mode: 0o600 })
    } catch (err) {
      const code = errorCodeOf(err)
      throw new BusinessError(
        `سند چاپی بزرگ روی دیسک موقت نوشته نشد${code ? ` (کد خطا: ${code})` : ''}؛ چیزی به چاپگر فرستاده نشد.`
      )
    }
    await loadOrExplain(() => win.loadFile(file))
  } catch (err) {
    await cleanup()
    throw err
  }
  return { via: 'temp-file', cleanup }
}

/** پیام فارسی برای پاسخ ناموفق `webContents.print`. */
export function printFailureMessage(reason: unknown, deviceName?: string): string {
  const raw = String(reason ?? '').trim()
  const lower = raw.toLowerCase()
  if (lower.includes('cancel')) return 'چاپ لغو شد و هیچ برگه‌ای چاپ نشد.'
  if (lower.includes('invalid devicename') || lower.includes('invalid device name'))
    return (
      `چاپگر «${deviceName || 'انتخاب‌شده'}» روی این سیستم پیدا نشد و هیچ برگه‌ای چاپ نشد؛ ` +
      'نام چاپگر را در تنظیمات چاپ بررسی کنید.'
    )
  if (lower.includes('no printers') || lower.includes('enumerate printers'))
    return 'هیچ چاپگری روی این سیستم در دسترس نیست و هیچ برگه‌ای چاپ نشد؛ چاپگر را نصب یا روشن کنید.'
  return (
    `چاپ انجام نشد${raw ? ` (پاسخ سیستم چاپ: «${raw}»)` : ''}؛ ` +
    'اتصال و روشن‌بودن چاپگر را بررسی کنید و دوباره چاپ کنید.'
  )
}

const RENDER_GONE_LABELS: Record<string, string> = {
  crashed: 'از کار افتادن',
  oom: 'کمبود حافظه',
  killed: 'بسته‌شدن اجباری',
  'abnormal-exit': 'خروج غیرعادی',
  'launch-failed': 'اجرا نشدن',
  'integrity-failure': 'خطای یکپارچگی',
  'clean-exit': 'بسته‌شدن'
}

/** پیام فارسی وقتی پنجره‌ی مخفی پیش از اعلام نتیجه از بین برود. */
export function printWindowLostMessage(reason?: string | null, kind: 'print' | 'pdf' = 'print'): string {
  const why = reason ? ` (علت: ${RENDER_GONE_LABELS[reason] ?? reason})` : ''
  if (kind === 'pdf')
    return `پنجره‌ی ساخت PDF پیش از پایان کار بسته شد یا از کار افتاد${why}؛ هیچ فایلی ذخیره نشد. دوباره تلاش کنید.`
  return (
    `پنجره‌ی چاپ پیش از اعلام نتیجه بسته شد یا از کار افتاد${why}؛ معلوم نیست برگه چاپ شده باشد. ` +
    'خروجی چاپگر را نگاه کنید و فقط اگر برگه‌ای بیرون نیامده، دوباره چاپ کنید.'
  )
}

/** پیام محافظه‌کارانه‌ی timeout: نتیجه نامعلوم است، پس چاپ موفق فرض نمی‌شود. */
export function printTimeoutMessage(timeoutMs: number, kind: 'print' | 'pdf' = 'print'): string {
  const seconds = Math.max(1, Math.round(timeoutMs / 1000))
  if (kind === 'pdf')
    return (
      `ساخت PDF طی ${seconds} ثانیه نتیجه نداد؛ هیچ فایلی ذخیره نشد. ` +
      'ممکن است برنامه‌ی چاپ یا پنجره‌ی سند گیر کرده باشد؛ دوباره تلاش کنید.'
    )
  return (
    `چاپگر طی ${seconds} ثانیه نتیجه نداد؛ معلوم نیست برگه چاپ شده باشد. ` +
    'برای جلوگیری از چاپ تکراری، خروجی چاپگر را بررسی کنید و بعد دوباره تصمیم بگیرید.'
  )
}

/**
 * یک کار روی پنجره‌ی مخفی را با رویدادهای «از بین رفتن پنجره» مسابقه می‌دهد تا
 * Promise هیچ‌وقت معلق نماند. فقط اولین نتیجه اعمال می‌شود. timeout نتیجه را
 * «موفق» حساب نمی‌کند؛ این مهم است چون چاپگر ممکن است بعد از گیرکردن، کاغذ را
 * با تأخیر بیرون بدهد و retry خودکار/بی‌خبر باعث چاپ تکراری شود.
 */
function guardWindowJob<T>(
  win: BrowserWindow,
  kind: 'print' | 'pdf',
  start: (ok: (value: T) => void, fail: (err: Error) => void) => void,
  timeoutMs: number = PRINT_CALLBACK_TIMEOUT_MS
): Promise<T> {
  const wc = win.webContents
  const waitMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.round(timeoutMs)) : PRINT_CALLBACK_TIMEOUT_MS
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const detach = (): void => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      try {
        wc.removeListener('render-process-gone', onGone)
        wc.removeListener('destroyed', onLost)
      } catch {
        /* webContents از بین رفته است */
      }
      try {
        win.removeListener('closed', onLost)
      } catch {
        /* پنجره از بین رفته است */
      }
    }
    const settle = (err: Error | null, value?: T): void => {
      if (settled) return
      settled = true
      detach()
      if (err) reject(err)
      else resolve(value as T)
    }
    // چاپ: نتیجه نامعلوم (شاید کاغذ بیرون آمده) · PDF: قطعاً هیچ فایلی ذخیره نشده
    const lost = (msg: string): Error => (kind === 'print' ? new PrintOutcomeUnknownError(msg) : new BusinessError(msg))
    const onGone = (_event: unknown, details?: { reason?: string }): void =>
      settle(lost(printWindowLostMessage(details?.reason ?? null, kind)))
    const onLost = (): void => settle(lost(printWindowLostMessage(null, kind)))
    const onTimeout = (): void => settle(lost(printTimeoutMessage(waitMs, kind)))
    wc.once('render-process-gone', onGone)
    wc.once('destroyed', onLost)
    win.once('closed', onLost)
    timer = setTimeout(onTimeout, waitMs)
    try {
      start(
        (value) => settle(null, value),
        (err) => settle(err)
      )
    } catch (err) {
      settle(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function runPrintJob(
  win: BrowserWindow,
  options: Electron.WebContentsPrintOptions,
  deviceName?: string,
  timeoutMs?: number
): Promise<void> {
  // بی‌صدا ⇒ ۳۰ ثانیه · با دیالوگ ⇒ ۱۰ دقیقه (AUDIT-S129-01)؛ مقدار صریح تست همیشه برنده است
  const waitMs = timeoutMs ?? (options.silent ? PRINT_CALLBACK_TIMEOUT_MS : PRINT_DIALOG_TIMEOUT_MS)
  return guardWindowJob<void>(win, 'print', (ok, fail) => {
    const failure = (reason: unknown): BusinessError => {
      const raw = String(reason ?? '').toLowerCase()
      if (raw.includes('cancel')) return new PrintCancelledError(printFailureMessage(reason, deviceName))
      return new BusinessError(printFailureMessage(reason, deviceName))
    }
    try {
      win.webContents.print(options, (success, reason) => (success ? ok(undefined) : fail(failure(reason))))
    } catch (err) {
      // نسخه‌های قدیمی‌تر Electron نام چاپگر نامعتبر را هم‌زمان throw می‌کنند
      fail(failure((err as Error)?.message ?? err))
    }
  }, waitMs)
}

/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۰ طرح چاپ — «اندازه‌ی کاغذِ این کار چقدر است؟»
 *
 * تا امروز هیچ اندازه‌ای به `webContents.print` داده نمی‌شد، پس اندازه‌ی صفحه از
 * پیش‌فرض درایور می‌آمد (فاکتور ۸۰mm روی صفحه‌ی A4 ⇒ نوار باریک، و لیبل ۵۰×۳۰
 * روی stock بزرگ‌تر ⇒ ردیف‌های خالی). این آرگومان اختیاری اضافه شد تا مسیر
 * فاکتور/لیبل بتواند اندازه‌ی دقیق خودش را اعلام کند.
 *
 * ⚠️ سازگاری کامل با گذشته: `pageSize` اختیاری است. هر فراخوانی‌ای که آن را
 * نفرستد (همه‌ی فراخوانی‌های امروزِ برنامه) **مو‌به‌مو** مثل قبل کار می‌کند و
 * هیچ اندازه‌گیری‌ای انجام نمی‌شود.
 * ===========================================================================
 */
export interface PrintPageSizeOption {
  /** عرض کاغذ فیزیکی به میلی‌متر */
  widthMm: number
  /** ارتفاع ثابت به میلی‌متر، یا `'AUTO'` = اندازه‌گیری ارتفاع محتوا */
  heightMm: number | 'AUTO'
  /** حاشیه‌ی ایمنی پایین (فقط در حالت `'AUTO'`) — پیش‌فرض ۳ میلی‌متر */
  heightSafetyMm?: number
}

export interface PrintHtmlOptions {
  silent?: boolean
  deviceName?: string
  landscape?: boolean
  timeoutMs?: number
  /** تعداد نسخه در یک job (به‌ویژه برای دیالوگ ویندوز تا چند پنجره پشت‌سرهم باز نشود). */
  copies?: number
  /** اندازه‌ی صفحه‌ی ارسالی به چاپگر (میکرون). نبود ⇒ رفتار قبلی */
  pageSize?: PrintPageSizeOption
}

/**
 * اندازه‌ی نهایی کاغذ را از تنظیم پروفایل می‌سازد؛ `null` یعنی «مثل قبل، بدون
 * اعلام اندازه». در حالت `'AUTO'` ارتفاع واقعی محتوا اندازه‌گیری می‌شود و هر
 * شکست، BusinessError فارسی است — چون هنوز چیزی به چاپگر نرفته، نتیجه قطعی است.
 */
async function resolvePrintPageSize(
  win: BrowserWindow,
  requested: PrintPageSizeOption | undefined,
  timeoutMs?: number
): Promise<{ width: number; height: number } | null> {
  if (!requested) return null
  const widthMm = Number(requested.widthMm)
  const heightMm =
    requested.heightMm === 'AUTO'
      ? await measureContentHeightMm(win, requested.heightSafetyMm ?? 3, timeoutMs)
      : Number(requested.heightMm)
  if (!pageSizeWithinLimits(widthMm, heightMm)) throw new BusinessError(PAGE_SIZE_LIMIT_MESSAGE)
  return pageSizeMicrons(widthMm, heightMm)
}

/**
 * چاپ HTML در یک پنجره مخفی.
 * silent=true برای فیش حرارتی (بدون دیالوگ)، deviceName از تنظیمات می‌آید.
 *
 * خروجی: اندازه‌ی واقعی صفحه‌ای که به Electron داده شد (میکرون) یا `null` اگر
 * اندازه‌ای اعلام نشده باشد. برگرداندن این عدد برای «آزمایش‌گر چاپ» لازم است تا
 * مقدار اندازه‌گیری‌شده‌ی حالت «ج» روی خودِ برگه و در `docs/print-diagnosis.md`
 * قابل ثبت باشد (بازبینی مستقل، بند ۳ سبک/اختیاری).
 */
export async function printHtml(html: string, opts: PrintHtmlOptions = {}): Promise<{ pageSize: { width: number; height: number } | null }> {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  let doc: LoadedPrintDocument | null = null
  try {
    doc = await loadPrintDocument(win, html)
    const pageSize = await resolvePrintPageSize(win, opts.pageSize, opts.timeoutMs)
    const copies = Math.min(99, Math.max(1, Math.round(Number(opts.copies ?? 1)) || 1))
    await runPrintJob(
      win,
      {
        silent: opts.silent ?? false,
        printBackground: true,
        deviceName: opts.deviceName,
        landscape: opts.landscape ?? false,
        margins: { marginType: 'none' },
        ...(copies > 1 ? { copies } : {}),
        ...(pageSize ? { pageSize } : {})
      },
      opts.deviceName,
      opts.timeoutMs
    )
    return { pageSize }
  } finally {
    if (!win.isDestroyed()) win.destroy()
    if (doc) await doc.cleanup()
  }
}

export async function listPrinters(): Promise<string[]> {
  const win = new BrowserWindow({ show: false })
  try {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => p.name)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * ===========================================================================
 * جلسه ۲۱ · §۵ و §۱۳ — ساخت PDF از همان HTML چاپ.
 *
 * چرا لازم شد؟ چون «چاپ گروهی هزاران اعتبار» نباید هزاران Job جدا به پرینتر
 * بفرستد؛ باید **یک فایل چندصفحه‌ای** باشد. `printToPDF` الکترون همان موتور
 * رندری را استفاده می‌کند که چاپ می‌کند، پس فایل PDF مو‌به‌مو همان چیزی است که
 * چاپ می‌شود — نه یک تولیدکننده‌ی PDF دوم با چیدمان متفاوت.
 *
 * ابعاد به اینچ داده می‌شود (قرارداد خود Electron) و از میلی‌متر تبدیل می‌گردد.
 * ارتفاع آزاد (رسید حرارتی) با یک ارتفاع بزرگ و `preferCSSPageSize` مدیریت
 * می‌شود تا `@page` خودِ HTML حرف آخر را بزند.
 *
 * نشست ۱۲۹: سند بزرگ (دسته‌ی چند صد اعتباری) از همان مسیر فایل موقت بار می‌شود،
 * از بین رفتن پنجره Promise را معلق نمی‌گذارد، و finally روی پنجره‌ی ازبین‌رفته
 * خطای «Object has been destroyed» نمی‌سازد که علت واقعی را بپوشاند.
 * ===========================================================================
 */
export async function pdfFromHtml(
  html: string,
  opts: { widthMm?: number; heightMm?: number | null; landscape?: boolean; timeoutMs?: number } = {}
): Promise<Buffer> {
  const MM_PER_INCH = 25.4
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: false } })
  let doc: LoadedPrintDocument | null = null
  try {
    doc = await loadPrintDocument(win, html)
    const widthMm = Math.min(600, Math.max(30, Math.round(opts.widthMm ?? 210)))
    const heightMm = opts.heightMm == null ? null : Math.min(2000, Math.max(30, Math.round(opts.heightMm)))
    return await guardWindowJob<Buffer>(win, 'pdf', (ok, fail) => {
      win.webContents
        .printToPDF({
          printBackground: true,
          landscape: opts.landscape ?? false,
          preferCSSPageSize: true,
          margins: { marginType: 'none' },
          pageSize: { width: widthMm / MM_PER_INCH, height: (heightMm ?? 1200) / MM_PER_INCH }
        })
        .then(ok, (err: unknown) => {
          const code = errorCodeOf(err)
          const detail = code || String((err as Error)?.message ?? '').slice(0, 120)
          fail(new BusinessError(`ساخت PDF انجام نشد و هیچ فایلی ذخیره نشد${detail ? ` (علت: ${detail})` : ''}؛ دوباره تلاش کنید.`))
        })
    }, opts.timeoutMs)
  } finally {
    if (!win.isDestroyed()) win.destroy()
    if (doc) await doc.cleanup()
  }
}
