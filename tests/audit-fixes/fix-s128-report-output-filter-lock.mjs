/**
 * نشست ۱۲۸ · خوشه F/J

 * باگ: فیلتر فرم تغییر می‌کرد، اما داده‌ی جدول هنوز از اجرای قبلی بود و
 * چاپ/Excel عنوانِ فیلتر تازه را روی همان داده‌ی قدیمی می‌گذاشتند. نتیجه یک
 * سند مالی با عنوان درست و بدنه‌ی غلط بود.

 * قرارداد بعد از رفع:
 *   • snapshot فیلترِ آخرین اجرای موفق جدا از فرم زنده نگه داشته شود؛
 *   • کلید خروجی تب/فیلتر/گزینه‌های مؤثر را شامل شود؛
 *   • تا وقتی فرم با آخرین اجرای موفق یکی نیست، چاپ و Excel قفل باشند؛
 *   • عنوان خروجی از snapshot اجرا بیاید، نه از فرم تغییرکرده.

 * این تست ساختاری است و جای رندر واقعی React/Electron را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

check('snapshot فیلتر آخرین اجرای موفق نگه داشته می‌شود', /appliedFilters/.test(page))
check('کلید خروجی تب و گزینه‌های مؤثر را شامل می‌شود', /reportDataKey[\s\S]{0,900}includeExchanges[\s\S]{0,300}includeSettled[\s\S]{0,300}chequeDateMode/.test(page))
check('بارگذاری موفق کلید اجرا را ثبت می‌کند', /setLoadedReportKey\(/.test(page))
check('خروجی وقتی فیلتر اجرا نشده تغییر کرده قفل می‌شود', /outputDirty[\s\S]{0,180}disabled=\{busy \|\| outputDirty\}/.test(page))
check('هشدار فارسیِ اجرای دوباره‌ی گزارش وجود دارد', /فیلتر گزارش تغییر کرده[\s\S]{0,140}تهیه گزارش/.test(page))
check('بازه‌ی عنوان از snapshot اجرا می‌آید', /const rangeText = `از \$\{appliedFilters\.fromJalali\} تا \$\{appliedFilters\.toJalali\}`/.test(page))
check('تغییر مبنای تاریخ چک گزارش را تازه می‌کند', /\}, \[tab, creditOpen, includeSettled, channelsKey, chequeDateMode\]\)/.test(page))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
