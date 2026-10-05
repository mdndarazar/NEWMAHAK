/**
 * نشست ۱۲۹ · قلاب resolve مخصوص تست‌های چاپ/خروجی.
 *
 * - `electron` ⇒ ماک کنترل‌پذیر همین پوشه (نه stub حداقلی هارنس)، تا رفتار مستند
 *   Electron/کرومیوم (سقف طول URL، callback چاپ، رویدادهای ازبین‌رفتن پنجره،
 *   دیالوگ ذخیره) قابل بازتولید باشد.
 * - `node:fs/promises` فقط وقتی از ExportService خوانده شود ⇒ ماک خطای قفل/پر شدن
 *   دیسک. هیچ فایل محصولی برای تست تغییر نمی‌کند.
 * این قلاب جایگزین اجرای واقعی Electron نیست و چنین ادعایی هم نمی‌کند.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export async function resolve(specifier, context, next) {
  if (specifier === 'electron')
    return { url: pathToFileURL(join(HERE, 's129-electron-mock.mjs')).href, shortCircuit: true }
  if (
    (specifier === 'node:fs/promises' || specifier === 'fs/promises') &&
    context.parentURL &&
    /\/src\/main\/services\/ExportService\.ts$/.test(context.parentURL)
  )
    return { url: pathToFileURL(join(HERE, 's129-fs-mock.mjs')).href, shortCircuit: true }
  return next(specifier, context)
}
