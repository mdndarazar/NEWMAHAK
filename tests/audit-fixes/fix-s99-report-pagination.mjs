/**
 * نشست ۹۹ · خوشه G
 *
 * باگ: چهار endpoint گزارش هنوز سقف `take` را بی‌صدا اعمال می‌کردند؛ مدیر
 * نمی‌فهمید ردیف‌های بعدی وجود دارند و بعضی `IN`های ساخته‌شده از صفحه‌ی بزرگ
 * می‌توانستند از سقف امن SQLite عبور کنند.
 *
 * این تست قرارداد کد را کنترل می‌کند. اجرای Prisma تولیدی و Electron واقعی
 * در محیط این پروژه در دسترس نیست، پس این تست جای آن دو را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')

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
const bodyOf = (name, next) => {
  const start = service.indexOf(name)
  const end = service.indexOf(next, start)
  return service.slice(start, end < 0 ? service.length : end)
}

check('بعد: سقف IN گزارش‌ها ۵۰۰ شناسه است', /REPORT_IN_CHUNK = 500/.test(service))
check('بعد: helper صفحه‌بندی متادیتای صفحه می‌سازد', /function reportPage\(/.test(service))
check('بعد: ردیف‌های آرایه‌ای متادیتای صفحه را حفظ می‌کنند', /function attachReportPage[\s\S]{0,500}Object\.assign/.test(service))

const items = bodyOf('async reportItems(', '  /** «سرجمع فروش»')
check('جزئیات فروش totalCount واقعی دارد', /prisma\.saleInvoice\.count\(\{ where \}\)/.test(items))
check('جزئیات فروش skip/take صفحه را اعمال می‌کند', /skip: page\.skip[\s\S]{0,80}take: page\.take/.test(items))
check('جزئیات فروش خروجی صفحه‌بندی‌شده دارد', /return attachReportPage\(out, page(?:, invoices\.length, 'فاکتور')?\)/.test(items))
check('جزئیات فروش lookupهای بزرگ را تکه می‌کند', /for \(const ids of reportIdChunks\(variantIds\)\)/.test(items))

const exchanges = bodyOf('async exchangeList(', '  /** یک تعویض ثبت‌شده')
check('تب تعویض totalCount واقعی دارد', /prisma\.saleReturn\.count\(\{ where \}\)/.test(exchanges))
check('تب تعویض metadata صفحه دارد', /return \{ rows, totals, page/.test(exchanges))
check('تب تعویض شناسه‌های relation را تکه می‌کند', /for \(const ids of reportIdChunks\(exchangeIds\)\)/.test(exchanges))

const returns = bodyOf('async returnList(', '  // =========================================================================\n  // ویرایش')
check('تب برگشت totalCount واقعی دارد', /prisma\.saleReturn\.count\(\{ where \}\)/.test(returns))
check('تب برگشت آرایه‌ی سازگار با page برمی‌گرداند', /Promise<PagedRows<ReturnListRow>>/.test(returns) && /return attachReportPage\(rows, page\)/.test(returns))

const cheques = bodyOf('async chequeList(', '  // =========================================================================\n  // حذف گزارشات')
check('تب چک totalCount واقعی دارد', /prisma\.payment\.count\(\{ where \}\)/.test(cheques))
check('تب چک skip/take صفحه را اعمال می‌کند', /skip: page\.skip[\s\S]{0,80}take: page\.take/.test(cheques))
check('تب چک آرایه‌ی سازگار با page برمی‌گرداند', /Promise<PagedRows<ChequeListRow>>/.test(cheques) && /return attachReportPage\(out, page\)/.test(cheques))
check('قرارداد shared نوع PagedRows را دارد', /export type PagedRows<T> = T\[\] &/.test(types))
check('قرارداد تعویض metadata اختیاری دارد', /interface ExchangeReportResult[\s\S]{0,500}page\?: SaleReportPage/.test(types))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
