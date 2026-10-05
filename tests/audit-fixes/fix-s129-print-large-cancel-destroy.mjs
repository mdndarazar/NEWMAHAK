/**
 * نشست ۱۲۹ · خوشه J — چاپ A4 بزرگ، لغو/خطای چاپ، و ازبین‌رفتن پنجره‌ی مخفی.
 *
 * باگ‌ها (روی snapshot نشست ۱۲۸):
 *   ۱) سند چاپی همیشه با data URL بار می‌شد؛ Electron URL بلندتر از ۲٬۰۹۷٬۱۵۲
 *      کاراکتر را با ERR_INVALID_URL رد می‌کند ⇒ چاپ A4 گزارش ۳٬۰۰۰ ردیفی و PDF
 *      دسته‌ی ۵۰۰ اعتباری همیشه شکست می‌خورد، با پیام کلی و بی‌علت.
 *   ۲) لغو دیالوگ چاپ / چاپگر نامعتبر / نبود چاپگر ⇒ پیام کلی «چیزی ذخیره نشد،
 *      برنامه را ببندید و باز کنید» به‌جای علت فارسی.
 *   ۳) از کار افتادن renderer یا بسته‌شدن پنجره پیش از callback ⇒ Promise برای
 *      همیشه معلق (صفحه‌ی فروش بعد از فاکتور ثبت‌شده «در حال ثبت» می‌ماند).
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s129-print-large-cancel-destroy.mjs
 * این تست با ماک کنترل‌پذیر Electron (tests/audit-fixes/support) اجرا می‌شود و
 * جای چاپ واقعی Electron/چاپگر را نمی‌گیرد.
 */
import { register } from 'node:module'
import { randomBytes } from 'node:crypto'
import { readdirSync } from 'node:fs'

register('./support/s129-hooks.mjs', import.meta.url)

const mock = await import('./support/s129-electron-mock.mjs')
const { printHtml, pdfFromHtml } = await import(new URL('../../src/main/print/printer.ts', import.meta.url).href)
const { reportHtml, creditBatchHtml } = await import(new URL('../../src/main/print/templates.ts', import.meta.url).href)
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

const GENERIC = 'انجام این عملیات ممکن نشد'
const PERSIAN = /[\u0600-\u06FF]/

/** نتیجه‌ی Promise یا «معلق» اگر در مهلت کوتاه تمام نشد. */
async function settleWithin(promise, ms = 400) {
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

const tempLeftovers = () => readdirSync(mock.state.tempRoot).filter((n) => n.startsWith('mahak-print-'))
const userMessage = (res) => (res.status === 'rejected' ? toUserMessage(res.error) : '')

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
const money = (n) => fa(Math.round(n).toLocaleString('en-US')).replace(/,/g, '٬')
const headers = ['شماره فیش', 'تاریخ', 'ساعت', 'شیفت', 'کد', 'نام کالا', 'تعداد', 'قیمت واحد', 'تخفیف', 'جمع', 'برگشتی']
const rows = Array.from({ length: 3000 }, (_, i) => [
  fa(100000 + i),
  fa('1403/07/01'),
  fa('12:34'),
  'شیفت صبح — نشست ۱',
  fa('JN-' + (1000 + i)),
  'شلوار جین مردانه راسته سایز ۳۲ - آبی تیره',
  fa(1),
  money(2450000),
  money(0),
  money(2450000),
  fa(0)
])
const bigReport = reportHtml('گزارش جزئیات فروش', headers, rows, ['جمع', '', '', '', '', '', fa(3000), '', '', money(7350000000), ''], 'بازه: ۱۴۰۳/۰۷/۰۱ تا ۱۴۰۳/۰۷/۳۰')
const bigUrlChars = ('data:text/html;charset=utf-8,' + encodeURIComponent(bigReport)).length
console.log(`  (طول data URL گزارش ۳٬۰۰۰ ردیفی: ${bigUrlChars} کاراکتر؛ سقف کرومیوم ${mock.CHROMIUM_MAX_URL_CHARS})`)

// ---- ۱) چاپ A4 بزرگ ----
mock.reset()
let res = await settleWithin(printHtml(bigReport, { silent: false }), 3000)
check('چاپ A4 گزارش ۳٬۰۰۰ ردیفی شکست نمی‌خورد (سقف طول URL کرومیوم دور زده شد)', res.status === 'resolved')
const bigLoad = mock.state.loads.at(-1)
check(
  'سند بزرگ کامل به پنجره‌ی چاپ رسید (آخرین فیش و ردیف جمع در HTML بارشده هست)',
  !!bigLoad && bigLoad.html === bigReport && bigLoad.html.includes(fa(102999)) && bigLoad.html.includes(money(7350000000))
)
check('سند بزرگ از فایل موقت خوانده شد و بعد از چاپ هیچ فایل موقتی باقی نماند', bigLoad?.via === 'file' && tempLeftovers().length === 0)
check('پنجره‌ی مخفی چاپ بعد از کار نابود شد', mock.state.windows.every((w) => w.isDestroyed()))

// ---- ۲) رسید کوچک مثل قبل ----
mock.reset()
res = await settleWithin(printHtml('<p>رسید ۱۰۲۴</p>', { silent: true }))
const smallLoad = mock.state.loads.at(-1)
check('رسید کوچک همچنان با data URL و بدون فایل موقت چاپ می‌شود', res.status === 'resolved' && smallLoad?.via === 'url' && tempLeftovers().length === 0)

// ---- ۳) پاک‌شدن فایل موقت حتی با شکست چاپ ----
mock.reset()
mock.state.printOutcome = 'failed'
res = await settleWithin(printHtml(bigReport, { silent: false }), 3000)
check(
  'سند بزرگ با شکست چاپ هم فایل موقتش پاک می‌شود و خطا فارسی با پاسخ سیستم چاپ است',
  res.status === 'rejected' && mock.state.loads.at(-1)?.via === 'file' && tempLeftovers().length === 0 && /چاپ انجام نشد/.test(userMessage(res)) && userMessage(res).includes('failed')
)

// ---- ۴) لغو و خطاهای چاپگر ----
mock.reset()
mock.state.printOutcome = 'canceled'
res = await settleWithin(printHtml('<p>گزارش</p>', { silent: false }))
check('لغو دیالوگ چاپ reject می‌شود (هیچ صدازننده‌ای آن را چاپ موفق حساب نمی‌کند)', res.status === 'rejected')
const cancelMsg = userMessage(res)
check('پیام لغو فارسی و دقیق است، نه پیام کلی «چیزی ذخیره نشد/برنامه را ببندید»', /لغو/.test(cancelMsg) && !cancelMsg.includes(GENERIC))

mock.reset()
mock.state.printOutcome = 'invalid-device'
res = await settleWithin(printHtml('<p>رسید</p>', { silent: true, deviceName: 'XP-80C' }))
const devMsg = userMessage(res)
check('چاپگر نامعتبر: پیام فارسی با نام همان چاپگر', res.status === 'rejected' && devMsg.includes('XP-80C') && PERSIAN.test(devMsg) && !devMsg.includes(GENERIC))

mock.reset()
mock.state.printOutcome = 'no-printers'
res = await settleWithin(printHtml('<p>رسید</p>', { silent: true }))
const noneMsg = userMessage(res)
check('نبود هیچ چاپگر: پیام فارسی صریح', res.status === 'rejected' && /هیچ چاپگری/.test(noneMsg))

// ---- ۵) ازبین‌رفتن پنجره پیش از callback ----
mock.reset()
mock.state.printOutcome = 'crash'
res = await settleWithin(printHtml('<p>رسید فروش</p>', { silent: true }))
check('از کار افتادن renderer وسط چاپ: Promise معلق نمی‌ماند', res.status === 'rejected')
check('پیام «نتیجه‌ی چاپ نامعلوم» فارسی است و به بررسی خروجی چاپگر ارجاع می‌دهد', /معلوم نیست برگه چاپ شده باشد/.test(userMessage(res)))
check('بعد از از کار افتادن، پنجره‌ی مخفی نابود شده (نشت پنجره نیست)', mock.state.windows.length > 0 && mock.state.windows.every((w) => w.isDestroyed()))

mock.reset()
mock.state.printOutcome = 'close'
res = await settleWithin(printHtml('<p>رسید فروش</p>', { silent: true }))
check('بسته‌شدن پنجره وسط چاپ: Promise معلق نمی‌ماند و خطای Object has been destroyed نمی‌سازد', res.status === 'rejected' && /معلوم نیست برگه چاپ شده باشد/.test(userMessage(res)))

// ---- ۶) PDF دسته‌ی بزرگ اعتبار ----
const barcode = 'data:image/png;base64,' + randomBytes(1100).toString('base64')
const doc = (i) => ({
  code: 'SC' + String(100000 + i), amount: 1500000, usedAmount: 0, remaining: 1500000, sourceLabel: 'برگشت کالا', statusLabel: 'فعال',
  issuedJalali: '1403/07/01', issuedTime: '12:30', expiresJalali: '1403/10/01', usesLabel: 'چندبارمصرف', maxUses: 3, usedCount: 0,
  restrictLabel: null, minPurchase: 0, maxPerTransaction: 0, holderName: 'مشتری عمومی', barcodeDataUrl: barcode, shopName: 'فروشگاه جین',
  rulesText: 'این سند فقط برای خرید کالا از همین فروشگاه معتبر است.', showRules: true, showHolder: true, showRemaining: true,
  reprint: false, printCount: 1, linkedReceiptNo: 1200 + i, note: null
})
const batch = creditBatchHtml(Array.from({ length: 500 }, (_, i) => doc(i)), {}, { widthMm: 210, heightMm: 297 }, 4)
mock.reset()
res = await settleWithin(pdfFromHtml(batch, { widthMm: 210, heightMm: 297 }), 3000)
check(
  'PDF دسته‌ی ۵۰۰ اعتباری ساخته می‌شود و آخرین سند در آن هست',
  res.status === 'resolved' && Buffer.isBuffer(res.value) && res.value.toString('utf8').includes('SC100499') && tempLeftovers().length === 0
)

mock.reset()
mock.state.pdfOutcome = 'crash'
res = await settleWithin(pdfFromHtml('<p>سند</p>', { widthMm: 105, heightMm: 148 }))
check('PDF: از کار افتادن پنجره Promise را معلق نمی‌گذارد و پیام فارسی «فایلی ذخیره نشد» می‌دهد', res.status === 'rejected' && /هیچ فایلی ذخیره نشد/.test(userMessage(res)))

mock.reset()
mock.state.pdfOutcome = 'reject'
res = await settleWithin(pdfFromHtml('<p>سند</p>', { widthMm: 105, heightMm: 148 }))
check('PDF: خطای printToPDF پیام فارسی با علت می‌دهد، نه پیام کلی', res.status === 'rejected' && /ساخت PDF انجام نشد/.test(userMessage(res)))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
