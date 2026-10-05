/**
 * نشست ۱۳۱ · خوشه J — خروجی CSV امن و پایان‌دادن به چاپی که درایور پاسخ نمی‌دهد.
 *
 * روی baseline نشست ۱۳۰ باید دو شکاف را قرمز کند:
 *   ۱) سلول‌هایی که با =، +، - یا @ شروع می‌شوند مستقیم وارد CSV می‌شدند و
 *      در Excel می‌توانستند به‌عنوان فرمول اجرا شوند.
 *   ۲) اگر callback چاپگر هرگز برنمی‌گشت، Promise چاپ برای همیشه معلق می‌ماند.
 *
 * این تست از ماک Electron استفاده می‌کند و جای چاپگر واقعی را نمی‌گیرد.
 */
import { register } from 'node:module'
import { readFileSync } from 'node:fs'

register('./support/s129-hooks.mjs', import.meta.url)

const mock = await import('./support/s129-electron-mock.mjs')
const { exportTableFile } = await import(new URL('../../src/main/services/ExportService.ts', import.meta.url).href)
const { printHtml } = await import(new URL('../../src/main/print/printer.ts', import.meta.url).href)
const { toUserMessage } = await import(new URL('../../src/main/errors.ts', import.meta.url).href)

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

async function settleWithin(promise, ms = 500) {
  let timer
  const pending = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ status: 'pending' }), ms)
  })
  const done = promise.then(
    (value) => ({ status: 'resolved', value }),
    (error) => ({ status: 'rejected', error })
  )
  const out = await Promise.race([done, pending])
  clearTimeout(timer)
  return out
}

const userMessage = (res) => (res.status === 'rejected' ? toUserMessage(res.error) : '')

// ---- ۱) CSV: جلوگیری از Formula Injection ----
mock.reset()
const csv = await exportTableFile({
  fileName: 'گزارش-امن',
  format: 'csv',
  ask: false,
  reveal: false,
  headers: ['مقدار', 'عدد'],
  rows: [['=1+1', '+cmd', '-2+2', '@SUM(1,2)', 'سلام', -500]]
})
const csvText = readFileSync(csv.path, 'utf8')
check(
  'مقادیر خطرناک CSV با apostrophe خنثی می‌شوند و دیگر فرمول خام نیستند',
  csvText.includes("'=1+1") &&
    csvText.includes("'+cmd") &&
    csvText.includes("'-2+2") &&
    csvText.includes("\"'@SUM(1,2)\"")
)
check('عدد واقعی منفی در CSV دست‌نخورده می‌ماند', csvText.includes(',سلام,-500'))

// ---- ۲) چاپگری که callback را هرگز برنمی‌گرداند ----
mock.reset()
mock.state.printOutcome = 'hang'
const res = await settleWithin(printHtml('<p>رسید</p>', { silent: true, timeoutMs: 40 }))
const msg = userMessage(res)
check(
  'چاپ معلق در مهلت محدود با نتیجه‌ی نامعلوم reject می‌شود',
  res.status === 'rejected' && /معلوم نیست برگه چاپ شده باشد/.test(msg) && /مهلت|نتیجه/.test(msg)
)
check('بعد از پایان مهلت، پنجره‌ی مخفی چاپ نشت نمی‌کند', mock.state.windows.length > 0 && mock.state.windows.every((w) => w.isDestroyed()))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
