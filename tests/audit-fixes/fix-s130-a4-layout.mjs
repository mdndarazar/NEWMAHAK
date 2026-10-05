/**
 * نشست ۱۳۰ · خوشه J · چیدمان PDF گزارش A4
 *
 * قبل از رفع: عرض body برابر ۲۱۰mm + padding بود و scrollWidth از صفحه‌ی A4
 * بزرگ‌تر می‌شد؛ در گزارش RTL ستون سمت چپ از لبه بیرون می‌زد.
 * بعد از رفع: body با box-sizing:border-box در همان عرض کاغذ می‌ماند.
 *
 * این تست Chromium واقعی را صدا می‌زند؛ Electron/پرینتر واقعی را ادعا نمی‌کند.
 */
import { chromium } from '/opt/sd-artifact/node_modules/playwright/index.mjs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const { reportHtml } = await import(new URL('../../src/main/print/templates.ts', import.meta.url).href)

let ok = 0
let bad = 0
const check = (label, actual, expected = true) => {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d])
const money = (n) => fa(Math.round(n).toLocaleString('en-US')).replace(/,/g, '٬')
const headers = ['شماره فیش', 'تاریخ', 'ساعت', 'شیفت', 'کد', 'نام کالا', 'تعداد', 'قیمت واحد', 'تخفیف', 'جمع', 'برگشتی']
const rows = Array.from({ length: 150 }, (_, i) => [
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
const html = reportHtml(
  'گزارش جزئیات فروش',
  headers,
  rows,
  ['جمع', '', '', '', '', '', fa(150), '', '', money(367500000), ''],
  'بازه: ۱۴۰۳/۰۷/۰۱ تا ۱۴۰۳/۰۷/۳۰'
)

const browser = await chromium.launch({
  headless: true,
  executablePath: '/ms-playwright/chromium-1208/chrome-linux64/chrome'
})
const page = await browser.newPage({ viewport: { width: 794, height: 1123 } })
await page.setContent(html, { waitUntil: 'load' })
const metrics = await page.evaluate(() => ({
  bodyWidth: document.body.getBoundingClientRect().width,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth
}))
check('بدنه‌ی گزارش از عرض واقعی A4 بیرون نمی‌زند', metrics.bodyWidth <= metrics.clientWidth + 1)
check('گزارش A4 افقی اسکرول افقی پنهان ندارد', metrics.scrollWidth <= metrics.clientWidth + 1)

const dir = mkdtempSync(join(tmpdir(), 'mahak-s130-'))
const pdfPath = join(dir, 'report.pdf')
try {
  const pdf = await page.pdf({
    width: '210mm',
    height: '297mm',
    printBackground: true,
    preferCSSPageSize: true,
    margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' }
  })
  writeFileSync(pdfPath, pdf)
  const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' })
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] ?? 0)
  check('گزارش ۱۵۰ ردیفی به PDF چهارصفحه‌ای A4 تبدیل می‌شود', pages === 4)

  const textPath = join(dir, 'report.txt')
  execFileSync('pdftotext', ['-layout', pdfPath, textPath])
  const text = readFileSync(textPath, 'utf8')
  const pageTexts = text.split('\f').filter((part) => part.trim())
  check('سرستون در هر چهار صفحه تکرار می‌شود', pageTexts.length === 4 && pageTexts.every((part) => part.includes('شماره فیش')))
  check('آخرین فیش و ردیف جمع در PDF باقی می‌مانند', text.includes('۱۰۰۱۴۹') && text.includes('۳۶۷٬۵۰۰٬۰۰۰'))
} finally {
  await browser.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
