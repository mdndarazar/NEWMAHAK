/**
 * نشست ۱۰۷ · خوشه G/F
 *
 * چاپ گروهی اعتبار نباید تعداد صفحه‌ی خوانده‌شده را به‌عنوان تعداد واقعی دسته
 * گزارش کند. برای دسته‌ی بزرگ، idهای قابل‌رندر فقط تا یک سند بیشتر از سقف
 * گرفته می‌شوند، اما `requested` از `page.totalCount` می‌آید.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/PrintService.ts'), 'utf8')

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

check('سقف مشترک چاپ از creditPrint وارد می‌شود', /CREDIT_PRINT_MAX_DOCS/.test(service))
check('مسیر batch از page.totalCount استفاده می‌کند', /const requested = listed\.page\.totalCount/.test(service))
check('خواندن دسته فقط یک سند بیشتر از سقف است', /take: CREDIT_PRINT_MAX_DOCS \+ 1/.test(service))
check('تعداد واقعی بالاتر از سقف capped می‌شود', /capped: requested > CREDIT_PRINT_MAX_DOCS/.test(service))
check('فهرست قدیمی با take:5000 حذف شده است', !/storeCreditService\.list\(\{ batchId: input\?\.batchId \?\? null, take: 5000 \}\)/.test(service))
check('idهای صریح همچنان با همان cap امن پردازش می‌شوند', /if \(explicit\.length\)[\s\S]{0,220}applyCreditPrintCap\(explicit\)/.test(service))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
