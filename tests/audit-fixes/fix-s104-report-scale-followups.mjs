import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const cashbox = readFileSync(resolve(root, 'src/main/services/CashboxService.ts'), 'utf8')
const pending = readFileSync(resolve(root, 'src/main/services/PendingRestockService.ts'), 'utf8')

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

check('پرداخت‌های جزئیات شیفت با readAll کامل خوانده می‌شوند', /const payments = await readAll/.test(cashbox))
check('سقف بی‌هشدار ۵۰۰۰ پرداخت حذف شده است', !/take:\s*5000/.test(cashbox))
check('IN پرداخت‌های فاکتور chunk شده است', /chunksOf\(invoiceIds\)/.test(cashbox))
// نشست ۱۸۰ (S180-D3): `readAll` حالا با پارامتر تایپ صریح صدا زده می‌شود
// (`readAll<PendingReturnRow>`)؛ معنای قرارداد «خواندن کامل بدون سقف» عوض نشده.
check('برگشت‌های معلق با readAll کامل خوانده می‌شوند', /return readAll(?:<\w+>)?\(\(page\) => client\.saleReturn\.findMany/.test(pending))
check('سقف بی‌هشدار ۵۰۰۰ برگشت حذف شده است', !/take:\s*5000/.test(pending))
check('IN درخواست کارت‌به‌کارت chunk شده است', /chunksOf\(returnIds\)/.test(pending))
check('IN کالاهای معلق chunk شده است', /chunksOf\(variantIds\)/.test(pending))
check('بازه‌ی شمسی سقف ۷۳۰ روزه ندارد', !/i < 730/.test(readFileSync(resolve(root, 'src/shared/jalali.ts'), 'utf8')))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
