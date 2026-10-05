/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۳ طرح چاپ — «resolver مشترک چاپگر» (بخش ۶.۲ طرح).
 *
 * چرا فایل جدا و نه داخل `printer.ts`؟ چون قرارداد پروژه این است که ترتیب
 * `printHtml` ← `listPrinters` ← `pdfFromHtml` در `printer.ts` دست‌نخورده بماند
 * و هیچ تابع تازه‌ای بین آن‌ها ننشیند (تست‌های ساختاری با `indexOf` بدنه را
 * می‌برند). هر چیز تازه در فایل جدید.
 *
 * قاعده‌ی طلایی: **هیچ fallback خودکاری نیست**. نام درخواستیِ renderer یا نام
 * ذخیره‌شده‌ی پروفایل باید *دقیقاً* در فهرست زنده‌ی چاپگرها باشد؛ وگرنه کار
 * متوقف می‌شود و پیام فارسی می‌آید — نه اینکه بی‌صدا روی چاپگر دیگری برود
 * (و مثلاً رسید فروش روی لیبل‌زن چاپ شود).
 *
 * تنها استثنا: نام خالی ⇒ چاپگر پیش‌فرض ویندوز (همان رفتار همیشگی برنامه)، که
 * نام آن هم صریح resolve می‌شود تا اندازه/موتور برای همان چاپگر حساب شود.
 * ===========================================================================
 */
import { BrowserWindow } from 'electron'
import { BusinessError } from '../errors'
import { faDigits } from '@shared/jalali'
import { guessPrinterKind, type PrinterKindGuess } from '@shared/printSpec'

/** پروفایل چاپ — همان نام‌گذاری بخش ۵.۵ طرح. */
export type PrintProfileKind = 'INVOICE' | 'WHOLESALE' | 'LABEL'

/**
 * نوع حدسی چاپگر. تعریف در `@shared/printSpec` است تا هم main و هم renderer
 * (متن‌های UI) از یک منبع بخوانند؛ اینجا فقط بازصادر می‌شود.
 */
export type { PrinterKindGuess }

export interface PrinterLite {
  name: string
  displayName: string
  isDefault: boolean
  kindGuess: PrinterKindGuess
}

/** چاپگر ذخیره‌شده در فهرست زنده نیست (حذف/خاموش/تغییر نام) یا نام جعلی آمده. */
export const printerNotFoundMessage = (name: string): string =>
  `چاپگر «${name}» روی این سیستم پیدا نشد (حذف، خاموش یا نام عوض‌شده) و هیچ برگه‌ای چاپ نشد. ` +
  'یکی از چاپگرهای موجود را انتخاب کنید.'

/** هیچ چاپگر پیش‌فرضی در ویندوز تنظیم نشده است. */
export const NO_DEFAULT_PRINTER_MESSAGE =
  'در ویندوز چاپگر پیش‌فرضی تنظیم نشده است؛ یک چاپگر را از تنظیمات انتخاب کنید.'

/** اصلاً چاپگری نصب نیست (ثبت فاکتور مستقل از چاپ است). */
export const NO_PRINTER_MESSAGE = 'هیچ چاپگری روی این سیستم نصب نیست؛ فاکتور ثبت شد ولی چاپ نشد.'

/** نام خالی/فاصله‌ها به‌عنوان «نام نیامده» فهمیده می‌شود. */
const cleanName = (v: unknown): string => String(v ?? '').trim()

/**
 * انتخاب چاپگر از فهرست زنده — تابع خالص (بدون Electron) تا مستقیم تست شود.
 *
 * ترتیب قواعد بخش ۶.۲ طرح:
 *   ۱) نام درخواستی renderer (اگر آمده باشد) باید در فهرست باشد.
 *   ۲) وگرنه نام ذخیره‌شده‌ی پروفایل.
 *   ۳) نام خالی ⇒ چاپگر پیش‌فرض ویندوز؛ نبودنش ⇒ خطای «پیش‌فرض تنظیم نشده».
 *   ۴) نامِ پیدا‌نشده ⇒ خطا؛ بدون هیچ fallback.
 *   ۵) خروجی همیشه نام صریح است (نه `undefined`).
 */
export function pickPrinter(
  printers: readonly PrinterLite[],
  requestedDeviceName?: unknown,
  savedName?: unknown
): { deviceName: string; viaWindowsDefault: boolean } {
  const requested = cleanName(requestedDeviceName)
  const saved = cleanName(savedName)
  const wanted = requested || saved
  if (wanted) {
    const hit = printers.find((p) => p.name === wanted)
    if (!hit) throw new BusinessError(printerNotFoundMessage(wanted))
    return { deviceName: hit.name, viaWindowsDefault: false }
  }
  const def = printers.find((p) => p.isDefault)
  if (!def) throw new BusinessError(printers.length ? NO_DEFAULT_PRINTER_MESSAGE : NO_PRINTER_MESSAGE)
  return { deviceName: def.name, viaWindowsDefault: true }
}

/**
 * فهرست کامل چاپگرها برای پنل تنظیمات و پنجره‌ی «با کدام چاپگر؟».
 * مثل `listPrinters` پنجره‌ی مخفی می‌سازد و در `finally` می‌بندد (قرارداد
 * پاک‌سازی نشست ۹۰).
 */
export async function listPrintersDetailed(): Promise<PrinterLite[]> {
  const win = new BrowserWindow({ show: false })
  try {
    const printers = await win.webContents.getPrintersAsync()
    return printers.map((p) => ({
      name: String(p.name ?? ''),
      displayName: String(p.displayName ?? p.name ?? ''),
      isDefault: p.isDefault === true,
      // فاز ۴ — حدس از روی نام/توضیح؛ فقط پیشنهاد، هیچ تصمیمی بر آن نیست (بخش ۷.۳).
      kindGuess: guessPrinterKind(`${p.displayName ?? ''} ${p.name ?? ''}`)
    }))
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

/**
 * resolve نام چاپگر برای یک کار چاپ. تنها نقطه‌ای که نام چاپگر را «تأیید» می‌کند
 * main است (قرارداد: اعتبارسنجی نام فقط در main).
 */
export async function resolvePrintTargetName(input: {
  requestedDeviceName?: unknown
  savedName?: unknown
}): Promise<{ deviceName: string; viaWindowsDefault: boolean }> {
  const printers = await listPrintersDetailed()
  return pickPrinter(printers, input.requestedDeviceName, input.savedName)
}

/** پیام «چاپگر پیدا نشد» برای نمایش در UI (بدون پرتاب خطا). */
export const printerNotFoundText = (name: string): string => printerNotFoundMessage(name)

/** تعداد چاپگرهای نصب‌شده به‌صورت متن فارسی (برای پیام‌ها). */
export const printersCountText = (n: number): string => `${faDigits(Math.max(0, Math.round(n)))} چاپگر`
