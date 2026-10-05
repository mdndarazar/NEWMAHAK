/**
 * نشست ۸۶ · خوشه J · هم‌ترازی خروجی تب تعویض و رسید برگشت.
 *
 * این تست ساختاری است و فقط قرارداد ستون‌ها را می‌سنجد؛ اجرای Electron/React
 * واقعی و چاپگر در این محیط در دسترس نیست.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const reports = read('src/renderer/src/pages/SalesReports.tsx')
const templates = read('src/main/print/templates.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq(
  'جمع تعویض بعد از جمع جایگزین، سلول مبدأ برداشت را خالی نگه می‌دارد',
  /<td>\{money\(t\.exchangeTotal\)\}<\/td>\s*<td><\/td>\s*<td>\{money\(t\.diffTotal\)\}/.test(reports),
  true
)
eq('خروجی رسید برگشت ستون ارزش کالای برگشتی دارد', /ارزش کالای برگشتی/.test(templates), true)
eq('خروجی رسید برگشت ستون نحوه‌ی تسویه دارد', /نحوه‌ی تسویه/.test(templates), true)
eq('خروجی رسید برگشت ستون پول واقعی خارج‌شده از کشو دارد', /پول واقعاً خارج‌شده از کشو/.test(templates), true)
eq(
  'اثر نقدی چاپی فقط برای روش CASH از refundAmount می‌آید',
  /d\.refundMethod === 'CASH' \? d\.refundAmount : 0/.test(templates),
  true
)

console.log('  ⓘ تست ساختاری است؛ اجرای Electron/React واقعی و چاپگر: اجرا نشد، دلیل: npm/Electron در محیط نیست.')
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
