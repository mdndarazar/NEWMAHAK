// تست حضور-ساختار پچ «جهش ستون‌ها هنگام کشیدن + دکمه‌ی برگشت به پیش‌فرض».
//
// باگ «یهو بزرگ می‌شود / کوچک می‌شود و از کنترل خارج می‌شود»: کلاس `tbl` جدول
// را `w-full` نگه می‌دارد و colResize با `table-layout: fixed` فقط عرض سرستون‌ها
// را پیکسلی می‌نوشت. مرورگر برای پرکردن ۱۰۰٪ عرض، *همه‌ی* ستون‌ها را به‌نسبت
// بازتوزیع می‌کرد؛ پس ستونِ در حال کشیدن عدد ماوس را نمی‌گرفت و بقیه‌ی ستون‌ها
// همزمان می‌پریدند. فیکس: هنگام چیدمان دستی، عرض کل جدول هم روی جمع پیکسلی
// ستون‌ها قفل می‌شود (و هنگام ریست پاک می‌شود تا چیدمان خودکارِ w-full برگردد).
//
// قابلیت «↺ برگشت به پیش‌فرض»: tableLayoutFab برای هر جدولِ دارای چیدمان دستی
// (ستون یا ردیف) یک دکمه‌ی شنار روی گوشه‌ی جدول نشان می‌دهد (تزریقی داخل DOMِ
// React نیست)، ریستِ ستون و ردیف را با هم انجام می‌دهد، با مودال‌ها به‌درستی
// مخفی/آشکار می‌شود و جدول‌های هوک‌محور (ResizableColumns) را دور می‌زند.
//
// (سبک تست‌های audit-fixes؛ منطق زمان‌اجرا را اثبات نمی‌کند.)
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(p, 'utf8')
const col = read('src/renderer/src/lib/colResize.ts')
const row = read('src/renderer/src/lib/rowResize.ts')
const fab = read('src/renderer/src/lib/tableLayoutFab.ts')
const main = read('src/renderer/src/main.tsx')
const css = read('src/renderer/src/styles.css')

let passed = 0
let failed = 0
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` · دریافت ${JSON.stringify(actual)}`}`)
}

console.log('\n— جدول: رفع جهش کشیدن + دکمه‌ی برگشت به پیش‌فرض (s314)')

check('قفل عرض جدول هنگام چیدمان دستی + پاک شدنش هنگام ریست', [
  /table\.style\.width = `\$\{sum\}px`/.test(col),
  /table\.style\.removeProperty\('width'\)/.test(col),
  /table\.style\.width === `\$\{sum\}px`/.test(col)
], [true, true, true])

check('API ریست ستون برای فاب + دور زدن جدول‌های هوک‌محور', [
  /export function tableColsCustomized/.test(col),
  /export function resetTableCols/.test(col),
  /export const isHookManagedTable/.test(col),
  /saveWidths\(key, null\)/.test(col)
], [true, true, true, true])

check('API ریست ردیف برای فاب', [
  /export function tableRowsCustomized/.test(row),
  /export function resetTableRows/.test(row),
  /tr\[data-row-h\]/.test(row)
], [true, true, true])

check('فاب: شناورِ بیرون از DOM React، ریست دوتایی، مخفی‌شدن زیر مودال', [
  /document\.body\.appendChild\(btn\)/.test(fab),
  /resetTableCols\(table\)/.test(fab) && /resetTableRows\(table\)/.test(fab),
  /document\.elementFromPoint/.test(fab),
  // نشست ۳۱۵ — شکستِ عمدیِ قفل قدیمی: دورزدن جدول‌های هوک‌محور معکوس شد و
  // حالا با `data-rzkey` پوشش داده می‌شوند (قفل نو در s315)
  !/isHookManagedTable\(t\)/.test(fab),
  /className = 'tbl-fab'/.test(fab)
], [true, true, true, true, true])

check('اتصال در main.tsx (بعد از دو enable فعلی) + استایل فاب', [
  /import \{ enableTableLayoutFab \} from '\.\/lib\/tableLayoutFab'/.test(main),
  /enableColResize\(\)\s*\nenableRowResize\(\)[\s\S]*?enableTableLayoutFab\(\)/.test(main),
  /\.tbl-fab \{/.test(css)
], [true, true, true])

console.log(`\nnok:${passed} ok:${passed + failed}`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
