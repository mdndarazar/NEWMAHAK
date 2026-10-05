/**
 * نشست ۲۰۹ — چاپ A4 / اکسل تب‌های غیربرگشت نباید گزارش برگشت بدهد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s209-print-not-return-fallback.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

let ok = 0
let bad = 0
const truthy = (label, cond) => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}

const printBlock = page.slice(page.indexOf('const printA4 = async'), page.indexOf('const printThermal = async'))
const excelBlock = page.slice(page.indexOf('const exportCsvNow = async'), page.indexOf('const exportSettlements'))

console.log('\nچاپ A4')
truthy('برگشت فقط با tab === returns چاپ می‌شود', /else if \(tab === 'returns'\)/.test(printBlock))
truthy('شاخهٔ پیش‌فرض دیگر عنوان برگشت ندارد', !/else \{\s*await call\(CH\.printA4, \{\s*title: 'گزارش برگشت از فروش'/.test(printBlock))
truthy('تب بدون شاخه پیام می‌دهد و برمی‌گردد', /برای این تب چاپ A4/.test(printBlock) && /return/.test(printBlock))

console.log('\nاکسل')
truthy('برگشت فقط با tab === returns صادر می‌شود', /else if \(tab === 'returns'\)/.test(excelBlock))
truthy('تب بدون شاخه اکسل برگشت نمی‌سازد', /برای این تب خروجی اکسل/.test(excelBlock))

console.log('\nنوار پایین')
truthy(
  'نوار چاپ برای کارمند / خارج از شیفت / کارت‌به‌کارت پنهان است',
  /tab !== 'cardTransfers' && tab !== 'staff' && tab !== 'outOfShift'/.test(page)
)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
