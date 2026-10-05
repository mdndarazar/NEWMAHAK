/**
 * نشست ۹۱ · خوشه F
 *
 * باگ: نوار گزارش فیلترهای شماره فیش/مشتری/کالا/شیفت را می‌ساخت، اما تب‌های
 * برگشت، تعویض و نسیه فقط تاریخ و کانال را به main می‌فرستادند؛ بنابراین جدول
 * روی صفحه چیزی غیر از چیزی را که مدیر فیلتر کرده بود نشان می‌داد.
 *
 * تست ساختاری است؛ Prisma Client تولیدی و React/Electron واقعی در محیط حاضر
 * نیستند. قبل از رفع، قرارداد payload و where مشترک وجود نداشت و بعد از رفع
 * هر سه تب همان فیلتر کامل را می‌فرستند و main روی سند فاکتور اعمال می‌کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const page = read('src/renderer/src/pages/SalesReports.tsx')
const service = read('src/main/services/SalesService.ts')

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

const oldReturnsCall = /CH\.saleReturnList,\s*\{\s*fromJalali:\s*filters\.fromJalali[\s\S]{0,180}channels:\s*f\.channels/
const oldExchangeCall = /CH\.saleExchangeList,\s*\{\s*fromJalali:\s*filters\.fromJalali[\s\S]{0,120}channels:\s*f\.channels/
const oldCreditCall = /CH\.saleCreditList,\s*\{\s*fromJalali:\s*filters\.fromJalali[\s\S]{0,160}channels:\s*f\.channels/
check('قبل: payload برگشت فیلترهای کامل را نداشت', oldReturnsCall.test(page), false)
check('قبل: payload تعویض فیلترهای کامل را نداشت', oldExchangeCall.test(page), false)
check('قبل: payload نسیه فیلترهای کامل را نداشت', oldCreditCall.test(page), false)

const tabCalls = [
  page.slice(page.indexOf('CH.saleReturnList'), page.indexOf('CH.saleReturnList') + 500),
  page.slice(page.indexOf('CH.saleExchangeList'), page.indexOf('CH.saleExchangeList') + 300),
  page.slice(page.indexOf('CH.saleCreditList'), page.indexOf('CH.saleCreditList') + 500)
]
check('بعد: هر سه تب همان فیلتر استاندارد `f` را می‌فرستند', tabCalls.every((body) => /\.\.\.f/.test(body)))
check('بعد: helper فیلتر سند وابسته در main وجود دارد', /export function reportInvoiceRelationWhere/.test(service))
check('بعد: شماره فیش روی فاکتور وابسته اعمال می‌شود', /reportInvoiceRelationWhere[\s\S]{0,700}receiptNo: f\.receiptNo/.test(service))
check('بعد: مشتری روی فاکتور وابسته اعمال می‌شود', /reportInvoiceRelationWhere[\s\S]{0,900}customer: f\.customerSearch/.test(service))
check('بعد: جستجوی کالا روی قلم فاکتور اعمال می‌شود', /reportInvoiceRelationWhere[\s\S]{0,1300}variantName: \{ contains: ps \}/.test(service))
check('بعد: تب نسیه helper فیلتر سند را مصرف می‌کند', /async creditList[\s\S]{0,1800}reportInvoiceRelationWhere\(filter\)/.test(service))
check('بعد: تب برگشت helper فیلتر سند را مصرف می‌کند', (/async returnList[\s\S]{0,1600}reportInvoice(?:Relation|Identity)Where\(filter\)/.test(service) || (/async returnList[\s\S]{0,2200}returnReportScopeWhere\(filter\)/.test(service) && /export async function returnReportScopeWhere[\s\S]{0,1600}reportInvoiceIdentityWhere\(filter\)/.test(service))))
check('بعد: تب تعویض helper فیلتر سند را مصرف می‌کند', (/async exchangeList[\s\S]{0,1600}reportInvoice(?:Relation|Identity)Where\(filter\)/.test(service) || (/async exchangeList[\s\S]{0,2600}returnReportScopeWhere\(filter\)/.test(service) && /export async function returnReportScopeWhere[\s\S]{0,1600}reportInvoiceIdentityWhere\(filter\)/.test(service))))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
