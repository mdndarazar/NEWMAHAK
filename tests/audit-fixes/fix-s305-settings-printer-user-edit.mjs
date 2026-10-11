// تست حضور-ساختار پچ «انتخاب کاربر برای چاپگر در صفحه‌ی تنظیمات نباید با ذخیره برگردد».
// باگ: mergeFreshPrinter همیشه نام چاپگر تازه‌ی دیسک را ترجیح می‌داد، پس ویرایش فیلد
// «چاپگر مخصوص لیبل/رسید» بعد از ذخیره به مقدار قبلی برمی‌گشت. پچ: ref لحظه‌ی بارگذاری
// + برنده‌بودن صفحه فقط وقتی کاربر مقدار را عوض کرده؛ ضد‌کهنگی قدیمی برای حالت
// «دست‌نخورده» حفظ شده. (سبک تست‌های audit-fixes؛ منطق زمان‌اجرا را اثبات نمی‌کند.)
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(p, 'utf8')
const settings = read('src/renderer/src/pages/Settings.tsx')
const receipt = read('src/shared/receipt.ts')

let passed = 0
let failed = 0
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` · دریافت ${JSON.stringify(actual)}`}`)
}

console.log('\n— Settings printer user-edit vs fresh anti-stomp (s305)')

check('ref لحظه‌ی بارگذاری برای هر دو چاپگر اعلان و در load پر می‌شود', [
  /const receiptPrinterAtLoad = useRef\(''\)/.test(settings),
  /const labelPrinterAtLoad = useRef\(''\)/.test(settings),
  /receiptPrinterAtLoad\.current = loadedReceipt\.printerName/.test(settings),
  /labelPrinterAtLoad\.current = loadedLabel\.printerName/.test(settings)
], [true, true, true, true])

check('هر دو مسیر در save موجود است: ویرایش کاربر برنده + ضد‌کهنگی برای دست‌نخورده', [
  /receipt\.printerName !== receiptPrinterAtLoad\.current/.test(settings),
  /label\.printerName !== labelPrinterAtLoad\.current/.test(settings),
  /mergeFreshPrinter\(receipt, \{ \.\.\.DEFAULT_RECEIPT_TEMPLATE, \.\.\.fresh\.receipt \}\)/.test(settings),
  /mergeFreshPrinter\(label, \{ \.\.\.DEFAULT_LABEL_TEMPLATE, \.\.\.fresh\.label \}\)/.test(settings)
], [true, true, true, true])

check('بعد از ذخیره‌ی موفق refها به‌روز می‌شوند (بعد از await، نه قبل)', [
  /receiptPrinterAtLoad\.current = receiptToSave\.printerName/.test(settings),
  /labelPrinterAtLoad\.current = labelToSave\.printerName/.test(settings),
  settings.indexOf('await call(CH.settingsSaveBundle') <
    settings.indexOf('receiptPrinterAtLoad.current = receiptToSave.printerName')
], [true, true, true])

check('خط payload ذخیره دقیقاً همان کلیدها/ترتیب قبلی است (قرارداد s168 سالم)', [
  (settings.match(/settingsSaveBundle, \{ receipt: receiptToSave, sale: saleToSave, shift, label: labelToSave, security, time, managerPassword: bundlePw \}\)/g) || []).length === 1
], [true])

check('ریست قالب رسید نام چاپگر را پاک نمی‌کند (رگرسیون شناسایی‌شده در دیف)', [
  /setReceipt\(\(p\) => \(\{ \.\.\.DEFAULT_RECEIPT_TEMPLATE, printerName: p\.printerName \}\)\)/.test(settings)
], [true])

check('خود mergeFreshPrinter دست‌نخورده است (ضد‌کهنگی انتخاب از پنجره‌ی چاپ سالم)', [
  /export function mergeFreshPrinter<T extends \{ printerName: string \}>\(pageTpl: T, freshTpl: T\): T/.test(receipt),
  /return \{ \.\.\.pageTpl, printerName: String\(freshTpl\?\.printerName \?\? ''\) \}/.test(receipt)
], [true, true])

console.log(`\n${failed ? '✗' : '✓'} ${passed} بررسی موفق${failed ? ` · ${failed} ناموفق` : ''}\n`)
process.exit(failed ? 1 : 0)
