/**
 * نشست ۱۲۹ · خوشه J — ذخیره‌ی خروجی Excel/CSV/PDF: همه یا هیچ، پیام فارسی با علت،
 * و والد زنده‌ی دیالوگ «ذخیره به‌عنوان».
 *
 * باگ‌ها (روی snapshot نشست ۱۲۸):
 *   ۱) فایل مستقیم روی مقصد نوشته می‌شد: شکست وسط نوشتن (پر شدن دیسک) یک CSV
 *      نیمه‌کاره روی همان نام می‌گذاشت که در اکسل بی‌هشدار و «کامل‌نما» باز
 *      می‌شود، و فایل قبلی هم از دست می‌رفت.
 *   ۲) فایل باز در اکسل (EBUSY/EPERM) ⇒ پیام کلی و بی‌علت «انجام این عملیات
 *      ممکن نشد».
 *   ۳) والد دیالوگ: وقتی پنجره‌ی اصلی focus نداشت، اولین پنجره‌ی فهرست (که
 *      می‌تواند پنجره‌ی مخفی چاپ باشد) والد دیالوگ ذخیره می‌شد.
 *   ۴) PDF سند اعتبار از همان نوشتن مستقیم و انتخاب والد استفاده می‌کرد.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s129-export-write-safety.mjs
 * ماک Electron/fs در tests/audit-fixes/support است؛ جای Save dialog واقعی ویندوز
 * و قفل واقعی اکسل را نمی‌گیرد.
 */
import { register } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

register('./support/s129-hooks.mjs', import.meta.url)

const mock = await import('./support/s129-electron-mock.mjs')
const { exportTableFile } = await import(new URL('../../src/main/services/ExportService.ts', import.meta.url).href)
const { toUserMessage } = await import(new URL('../../src/main/errors.ts', import.meta.url).href)
const printServiceSrc = readFileSync(new URL('../../src/main/services/PrintService.ts', import.meta.url), 'utf8')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual === true) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const GENERIC = 'انجام این عملیات ممکن نشد'
const input = (extra = {}) => ({
  fileName: 'گزارش-جزئیات-فروش',
  sheetName: 'جزئیات فروش',
  title: 'گزارش جزئیات فروش — بازه‌ی ۱۴۰۳/۰۷/۰۱ تا ۱۴۰۳/۰۷/۳۰',
  headers: ['شماره فیش', 'نام کالا', 'جمع'],
  rows: Array.from({ length: 400 }, (_, i) => [100000 + i, 'شلوار جین مردانه', 2450000]),
  totals: ['جمع', '', 980000000],
  ...extra
})
const freshDir = () => mkdtempSync(join(tmpdir(), 's129-export-'))
const tempFiles = (dir) => readdirSync(dir).filter((n) => n.endsWith('.tmp'))
async function attempt(promise) {
  try {
    return { ok: true, value: await promise }
  } catch (error) {
    return { ok: false, error, message: toUserMessage(error) }
  }
}

// ---- ۱) مسیر موفق ----
mock.reset()
globalThis.__s129fs = {}
let dir = freshDir()
let target = join(dir, 'report.xlsx')
mock.state.dialogResult = { canceled: false, filePath: target }
let r = await attempt(exportTableFile(input()))
check(
  'خروجی موفق: فایل xlsx کامل روی مسیر انتخابی، بدون فایل موقت باقی‌مانده',
  r.ok && r.value.path === target && readFileSync(target).subarray(0, 2).toString() === 'PK' && tempFiles(dir).length === 0
)
check('پس از ذخیره‌ی موفق، پوشه‌ی همان فایل نشان داده شد', mock.state.revealed.at(-1) === target)

// ---- ۲) فایل باز در اکسل ----
mock.reset()
dir = freshDir()
target = join(dir, 'report.xlsx')
writeFileSync(target, 'OLD-REPORT')
globalThis.__s129fs = { lockedTarget: target, lockCode: 'EBUSY' }
mock.state.dialogResult = { canceled: false, filePath: target }
r = await attempt(exportTableFile(input()))
check('فایل باز در اکسل: خطای فارسی با نام فایل و علت «باز است»، نه پیام کلی', !r.ok && r.message.includes('report.xlsx') && /باز است/.test(r.message) && !r.message.includes(GENERIC))
check('فایل باز در اکسل: فایل قبلی دست‌نخورده و هیچ فایل موقتی نماند', readFileSync(target, 'utf8') === 'OLD-REPORT' && tempFiles(dir).length === 0)

// ---- ۳) پر شدن دیسک وسط نوشتن CSV ----
mock.reset()
dir = freshDir()
target = join(dir, 'report.csv')
writeFileSync(target, 'OLD-CSV')
globalThis.__s129fs = { partialThen: 'ENOSPC' }
mock.state.dialogResult = { canceled: false, filePath: target }
r = await attempt(exportTableFile(input({ format: 'csv' })))
check('پر شدن دیسک: خطای فارسی «فضای خالی دیسک کافی نیست»', !r.ok && /فضای خالی دیسک/.test(r.message))
check('پر شدن دیسک: هیچ CSV نیمه‌کاره‌ای روی مقصد نماند و فایل قبلی سالم است', readFileSync(target, 'utf8') === 'OLD-CSV' && tempFiles(dir).length === 0)

// ---- ۴) قفل کوتاه آنتی‌ویروس هنگام جایگزینی ----
mock.reset()
dir = freshDir()
target = join(dir, 'report.xlsx')
globalThis.__s129fs = { renameFailuresLeft: 2, renameFailCode: 'EPERM' }
mock.state.dialogResult = { canceled: false, filePath: target }
r = await attempt(exportTableFile(input()))
check('قفل کوتاه (دو بار EPERM) با تلاش دوباره رد می‌شود و فایل کامل ذخیره می‌شود', r.ok && existsSync(target) && tempFiles(dir).length === 0)

// ---- ۵) لغو دیالوگ ذخیره ----
mock.reset()
dir = freshDir()
globalThis.__s129fs = {}
mock.state.dialogResult = { canceled: true, filePath: undefined }
r = await attempt(exportTableFile(input()))
check('لغو دیالوگ ذخیره: canceled=true و هیچ فایلی ساخته نشد', r.ok && r.value.canceled === true && r.value.path === null && readdirSync(dir).length === 0)

// ---- ۶) والد دیالوگ ----
mock.reset()
globalThis.__s129fs = {}
const hiddenPrint = new mock.BrowserWindow({ show: false })
const mainWin = new mock.BrowserWindow({ show: true })
mock.state.focused = null
mock.state.allWindows = [hiddenPrint, mainWin]
mock.state.dialogResult = { canceled: true, filePath: undefined }
await attempt(exportTableFile(input()))
check('بدون focus، پنجره‌ی مخفی چاپ والد دیالوگ ذخیره نمی‌شود؛ پنجره‌ی اصلی دیده‌شدنی انتخاب می‌شود', mock.state.dialogCalls.at(-1)?.parent === mainWin)

mock.reset()
const onlyHidden = new mock.BrowserWindow({ show: false })
mock.state.allWindows = [onlyHidden]
mock.state.dialogResult = { canceled: true, filePath: undefined }
await attempt(exportTableFile(input()))
check('وقتی فقط پنجره‌ی مخفی هست، دیالوگ بدون والد باز می‌شود', mock.state.dialogCalls.at(-1)?.parent === null)

// ---- ۷) PDF سند اعتبار از همان مسیر امن ----
const pdfBody = printServiceSrc.slice(printServiceSrc.indexOf('async creditPdf('), printServiceSrc.indexOf('async labelTemplateFor('))
check('PDF اعتبار با ذخیره‌ی «همه یا هیچ» نوشته می‌شود (writeFileAtomic)', /await writeFileAtomic\(file, pdf\)/.test(pdfBody) && !/await writeFile\(file, pdf\)/.test(pdfBody))
check('PDF اعتبار والد دیالوگ را از dialogParentWindow می‌گیرد', /dialogParentWindow\(\)/.test(pdfBody) && !/getAllWindows\(\)\[0\]/.test(pdfBody))
check(
  'شمارنده‌ی چاپ PDF فقط بعد از ذخیره‌ی کامل و مستقل از خطای نمایش پوشه ثبت می‌شود',
  pdfBody.indexOf('writeFileAtomic(file, pdf)') > 0 &&
    pdfBody.indexOf('writeFileAtomic(file, pdf)') < pdfBody.indexOf('storeCreditService.markPrinted') && /try \{\s*shell\.showItemInFolder\(file\)/.test(pdfBody)
)

globalThis.__s129fs = {}
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
