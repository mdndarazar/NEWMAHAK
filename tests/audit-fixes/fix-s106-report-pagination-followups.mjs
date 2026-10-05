/**
 * نشست ۱۰۶ · خوشه G
 *
 * این تست قراردادی است و فقط تضمین می‌کند برش‌های باقی‌مانده‌ی دفتر رویداد و
 * فهرست نشست‌ها شمارش/هشدار قابل‌مصرف دارند؛ اجرای Prisma واقعی در این محیط
 * موجود نیست.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const ledger = readFileSync(resolve(root, 'src/main/services/SalesLedger.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')
const shifts = readFileSync(resolve(root, 'src/main/services/ShiftService.ts'), 'utf8')

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

check('دفتر رویداد متادیتای بخش‌ها را قرارداد می‌دهد', /sections:\s*\{/.test(types) && /invoices:\s*SaleReportPage/.test(types))
check('فاکتورهای دفتر count واقعی دارند', /prisma\.saleInvoice\.count\(\{ where \}\)/.test(ledger))
check('برگشت‌های دفتر count واقعی دارند', /prisma\.saleReturn\.count\(\{ where: returnWhere \}\)/.test(ledger))
check('وصول نسیه هشدار برش فارسی دارد', /وصول نسیه‌ی بازه‌های قبل پیدا شد/.test(ledger))
check('چک و مصرف اعتبار هر دو متادیتای truncated دارند', /clearedChequePage[\s\S]{0,500}truncated/.test(ledger) && /storeCreditsUsedPage[\s\S]{0,500}truncated/.test(ledger))
check('فهرست نشست‌ها totalCount و warnings را روی آرایه نگه می‌دارد', /Promise<[^>]*PagedRows<ShiftInfo>>/.test(shifts) && /out\.page =/.test(shifts) && /out\.warnings =/.test(shifts))
check('فهرست overrideها count و هشدار برش دارد', /prisma\.shift\.count\(\{ where \}\)/.test(shifts) && /page: \{ skip: 0, take, totalCount, truncated \}/.test(shifts))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
