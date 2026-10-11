/**
 * نشست ۱۰۰ · خوشه G
 *
 * قرارداد فهرست اعتبار باید مثل چهار endpoint گزارش، تعداد کل و هشدار برش را
 * برگرداند؛ آرایه بودن پاسخ برای callerهای قدیمی حفظ می‌شود.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/StoreCreditService.ts'), 'utf8')
const table = readFileSync(resolve(root, 'src/renderer/src/components/ReportExtraTables.tsx'), 'utf8')

let ok = 0
let bad = 0
const check = (label, actual, expected = true) => {
  if (actual === expected) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}`)
  }
}

check('فهرست اعتبار قرارداد امن PagedRows دارد', /async list\(filter: ListFilter = \{\}\): Promise<PagedRows<StoreCreditReportRow>>/.test(service))
check('تعداد کل با count واقعی محاسبه می‌شود', /page\.totalCount = await prisma\.storeCredit\.count\(\{ where \}\)/.test(service))
check('صفحه با skip و take واقعی خوانده می‌شود', /take: page\.take[\s\S]{0,80}skip: page\.skip/.test(service))
check('پاسخ همچنان آرایه‌ی قابل مصرف برای callerهای قدیمی است', /return Object\.assign\(rows, \{ page, warnings \}\) as PagedRows/.test(service))
check('برش بی‌صدا هشدار فارسی می‌دهد', /نمایش \$\{faDigits\(rows\.length\)\} از \$\{faDigits\(page\.totalCount\)\}/.test(service))
check('تیک باقی‌مانده قبل از صفحه‌بندی اعمال می‌شود', /remainingIds\.slice\(page\.skip, page\.skip \+ page\.take\)/.test(service))
check('تب legacy هشدار صفحه را نشان می‌دهد', /storeCredits\?\.page\?\.truncated/.test(table))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
