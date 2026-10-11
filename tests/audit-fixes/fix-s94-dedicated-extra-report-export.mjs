import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')
const src = page
const section = page.slice(page.indexOf('const exportCsvNow'), page.indexOf('const printExchangeDoc'))
let ok = 0
let bad = 0
function check(label, actual) {
  if (actual) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

check('اعتبار خرید شاخه‌ی Excel مستقل دارد', /tab === ['"]storeCredits['"][\s\S]{0,2600}exportTable/.test(section))
check('ضدتقلب شاخه‌ی Excel مستقل دارد', /tab === ['"]fraud['"][\s\S]{0,2800}exportTable/.test(section))
check('اعتبار خرید از snapshot همان تب می‌خواند', /tab === ['"]storeCredits['"][\s\S]{0,2600}(output\.storeCreditRows|storeCredits|creditRows)/.test(section))
check('ضدتقلب از snapshot همان تب می‌خواند', /tab === ['"]fraud['"][\s\S]{0,2800}(output\.fraudGroups|fraud|fraudGroups)/.test(section))
check('ستون‌های اعتبار خرید مخصوص گزارش‌اند', /شناسه[^\n]*اعتبار[\s\S]{0,500}مصرف‌شده[\s\S]{0,300}(کانال|منبع)/.test(section) || (/STORE_CREDIT_OUTPUT_HEADERS/.test(section) && /STORE_CREDIT_OUTPUT_HEADERS\s*=\s*\['شناسه[^']*اعتبار'[^\n]*مصرف‌شده[^\n]*منبع'\]/.test(src)))
check('ستون‌های ضدتقلب مخصوص گزارش‌اند', /گروه[\s\S]{0,500}شدت[\s\S]{0,500}توضیح/.test(section))
check('fallback برگشت بعد از شاخه‌های مستقل است', section.indexOf('title: `گزارش برگشت از فروش') > section.indexOf("tab === 'fraud'"))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
