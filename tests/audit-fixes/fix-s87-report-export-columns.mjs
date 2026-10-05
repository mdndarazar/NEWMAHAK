/**
 * نشست ۸۷ · خوشه J · قرارداد ستون‌های چاپ/Excel برگشت و جمع Excel تعویض.
 *
 * تست ساختاری است؛ اجرای Electron، ساخت فایل xlsx واقعی و چاپگر در این محیط
 * در دسترس نیستند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const reports = read('src/renderer/src/pages/SalesReports.tsx')

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

eq('سرستون برگشت ارزش کالای برگشتی را دارد', /'ارزش کالای برگشتی'/.test(reports), true)
eq('سرستون برگشت روش تسویه را دارد', /'نحوه‌ی تسویه'/.test(reports), true)
eq('سرستون برگشت خروج واقعی نقد از کشو را دارد', /'پول واقعاً خارج‌شده از کشو'/.test(reports), true)
eq(
  'چاپ برگشت از همان قرارداد کامل ستون‌ها استفاده می‌کند',
  /title: `گزارش برگشت از فروش — \$\{meta\}`,[\s\S]{0,260}headers: RETURN_HEADERS/.test(reports),
  true
)
eq(
  'Excel برگشت مقدار نقدی را فقط از cashRefundAmount می‌گیرد',
  /r\.cashRefundAmount \?\? 0/.test(reports),
  true
)
eq(
  'جمع Excel تعویض برای مبدأ برداشت سلول خالی دارد',
  /money\(output\.exchangeTotals\.exchangeTotal\),\s*''\s*,\s*money\(output\.exchangeTotals\.diffTotal\)/.test(reports),
  true
)
eq(
  'جمع Excel برگشت ارزش و خروج واقعی نقد را جمع می‌زند',
  /returns\.reduce\(\(s, r\) => s \+ r\.total, 0\)[\s\S]{0,180}returns\.reduce\(\(s, r\) => s \+ \(r\.cashRefundAmount \?\? 0\), 0\)/.test(reports),
  true
)

console.log('  ⓘ تست ساختاری است؛ اجرای Electron، تولید xlsx واقعی و چاپگر: اجرا نشد.')
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
