// تست حضور-ساختار دو پچ نشست ۳۱۵.
//
// (الف) سرور: گیت دقیق رمز «مبدأ کسر» در فروش تکی — تا قبل از این نشست، اگر
// قفل «برداشت از انبار مرکزی» روشن بود، سرور برای *هر* برنامه‌ی کسرِ فروش تکی
// رمز می‌خواست؛ درحالی‌که UI (نشست ۳۱۳) برای مسیر «همه از انبار فروشگاه +
// منفی» رمز نمی‌گرفت ⇒ ثبت واقعی رد می‌شد (فاکتور ساخته نمی‌شد، انبار منفی
// نمی‌رفت — از دید فروشنده «نمایشی»). قرارداد مالک: کالای فیزیکیِ رسیده‌ای که
// انباردار هنوز سیستمی نکرده باید با رضایت دکمه‌ای فروشنده فروخته شود تا منفی
// (موجودی‌کافی‌نیست در این مسیر همیشه «هشدار» بوده، نه مانع)؛ رمز مدیر فقط
// برای مبدأ *غیر از انبار فروشگاه* لازم است — همان متنِ راهنمای داخل پنجره.
//
// (ب) دکمه‌ی «↺ پیش‌فرض»: متن‌دار شد (گزارش مالک: فلشِ کوچک پیدا/پسند نبود)؛
// جدول‌های هوک‌محور (گزارشات فروش، اقلام پنل فروش) با `data-rzkey` + رجیستری
// زنده‌ی هوک پوشش داده شدند؛ محل دکمه به کادر دید گیر می‌شود تا با بزرگ‌کردنِ
// بیش‌ازحدِ جدول هم پیدا بماند؛ هوک هم عرض جدول را کنار چیدمان دستی قفل می‌کند
// (همان فیکسِ جهش ۳۱۴، این‌بار برای جدول‌های هوک‌محور).
//
// (سبک تست‌های audit-fixes؛ منطق زمان‌اجرا را اثبات نمی‌کند.)
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(p, 'utf8')
const sales = read('src/main/services/SalesService.ts')
const hook = read('src/renderer/src/components/ResizableColumns.tsx')
const fab = read('src/renderer/src/lib/tableLayoutFab.ts')
const css = read('src/renderer/src/styles.css')

let passed = 0
let failed = 0
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` · دریافت ${JSON.stringify(actual)}`}`)
}

console.log('\n— نشست ۳۱۵: رمز فقط برای مبدأ خارجی + دکمه‌ی متن‌دار برگشت جدول روی همه‌ی جدول‌ها (s315)')

check('(الف) سرور: رمز فقط با مبدأ غیرفروشگاه در برنامه‌ی کسر فروش تکی', [
  /warehouseEntriesOf,/.test(sales),
  /const posPlanHasForeignSource = posPlanRequested && warehouseEntriesOf\(posRequestedPlan\)\.length > 0/.test(sales),
  /if \(posPlanHasForeignSource\)/.test(sales),
  !/if \(posPlanRequested\)\s*\n\s*await assertPanelPassword/.test(sales)
], [true, true, true, true])

check('(ب-۱) هوک: data-rzkey روی جدول + رجیستری زنده + API بیرونی', [
  /node\.setAttribute\('data-rzkey', key\)/.test(hook),
  /const liveHookCols = new Map</.test(hook),
  /export const getHookColsByKey/.test(hook),
  /liveHookCols\.set\(key, \{ reset, customized: \(\) => widthsRef\.current != null \}\)/.test(hook)
], [true, true, true, true])

check('(ب-۲) هوک: قفل عرض جدول کنار چیدمان دستی (ضد‌جهش برای جدول‌های گزارشات هم)', [
  /widths\.reduce\(\(a, w\) => a \+ Math\.max\(MIN_WIDTH, Math\.round\(w\)\), 0\)/.test(hook),
  /t\.style\.width = `\$\{sum\}px`/.test(hook),
  /t\.style\.removeProperty\('width'\)/.test(hook),
  /node\.style\.width = `\$\{sum\}px`/.test(hook)
], [true, true, true, true])

check('(ب-۳) فاب: متن‌دار + پوشش هوک‌محور + گیر به کادر دید', [
  /const BTN_TEXT = '↺ پیش‌فرض'/.test(fab),
  /getHookColsByKey\(hk\?\.reset\(\)\)/.test(fab) || /getHookColsByKey\(hk\)\?\.reset\(\)/.test(fab),
  /getHookColsByKey\(hk\)\?\.customized\(\)/.test(fab),
  /window\.innerHeight - 28/.test(fab),
  /window\.innerWidth - 120/.test(fab)
], [true, true, true, true, true])

check('(ب-۴) استایل دکمه‌ی متن‌دار', [
  /\.tbl-fab \{/.test(css),
  /background: #b91c1c/.test(css),
  /font-weight: 700/.test(css)
], [true, true, true])

console.log(`\nnok:${passed} ok:${passed + failed}`)
if (failed) {
  console.error('FAILED')
  process.exit(1)
}
