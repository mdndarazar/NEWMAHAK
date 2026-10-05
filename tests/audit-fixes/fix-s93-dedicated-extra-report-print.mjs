/**
 * نشست ۹۳ · خوشه J
 *
 * باگ: چاپ A4 فقط برای چک و دفتر رویداد شاخه‌ی مستقل داشت. تب‌های اعتبار خرید
 * قدیمی و ضدتقلب به شاخه‌ی پیش‌فرض برگشت می‌افتادند و برگه‌ی برگشت چاپ می‌شد.
 *
 * این تست ابتدا عمداً روی نسخه‌ی نشست ۹۲ باید شکست بخورد، سپس بعد از اصلاح هر
 * دو تب باید شاخه و داده‌ی چاپ مستقل داشته باشند. اجرای Electron/چاپگر واقعی
 * در این تست ادعا نمی‌شود.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

const storeCreditBranch = /tab === ['"]storeCredits['"][\s\S]{0,1800}CH\.printA4/
const fraudBranch = /tab === ['"]fraud['"][\s\S]{0,2200}CH\.printA4/
const storeCreditUsesOwnData = /tab === ['"]storeCredits['"][\s\S]{0,1800}storeCredits/
const fraudUsesOwnData = /tab === ['"]fraud['"][\s\S]{0,2200}fraud/
const fallbackReturnBranch = /title:\s*['"]گزارش برگشت از فروش['"][\s\S]{0,700}RETURN_HEADERS/

check('بعد: اعتبار خرید شاخه‌ی چاپ مستقل دارد', storeCreditBranch.test(page))
check('بعد: ضدتقلب شاخه‌ی چاپ مستقل دارد', fraudBranch.test(page))
check('بعد: چاپ اعتبار خرید از داده‌ی همان تب می‌خواند', storeCreditUsesOwnData.test(page))
check('بعد: چاپ ضدتقلب از داده‌ی همان تب می‌خواند', fraudUsesOwnData.test(page))
check('بعد: شاخه‌ی برگشت همچنان برای تب برگشت باقی است', fallbackReturnBranch.test(page))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
