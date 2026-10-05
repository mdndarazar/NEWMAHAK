/**
 * نشست ۱۱۳ · مقصد چک فقط حساب مدیر/بانک
 *
 * قاعده‌ی مالک: چک مقصد «نقد در کشو» یا «کارت‌خوان» ندارد؛ فقط حساب
 * مدیر/بانک مجاز است. داده‌ی قدیمی یا ورودی ناسازگار هم نباید بی‌صدا به
 * انتظار نقد/کارت‌خوان راه پیدا کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sales = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
const ledger = readFileSync(resolve('src/main/services/SalesLedger.ts'), 'utf8')
const enums = readFileSync(resolve('src/shared/enums.ts'), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq('تابع مقصد مجاز چک فقط MANAGER را برمی‌گرداند', /allowedChequeDestinations[\s\S]*return \[PaymentDestination\.MANAGER\]/.test(enums), true)
eq('گیت پاس‌شدن چک از مقصدهای مخصوص چک استفاده می‌کند', /context === 'CHEQUE_CLEAR' \? allowedChequeDestinations\(\)/.test(sales), true)
eq('ثبت اولیه‌ی روش چک به‌عنوان پرداخت عادی مسدود است', /m\.key === CHEQUE_METHOD_KEY[\s\S]*پرداخت اولیه‌ی فاکتور/.test(sales), true)
eq('addPayment مقصد صریح برای چک را بی‌صدا نادیده نمی‌گیرد', /isCheque && input\?\.destination != null[\s\S]*چک هنگام ثبت هنوز پول دریافت‌شده نیست/.test(sales), true)
eq('دفتر رویداد از receiptBucketOf مشترک استفاده می‌کند', /receiptBucketOf\(\{ isCheque: true/.test(ledger), true)

const { receiptBucketOf } = await import('../../src/shared/accounting.ts')
eq('چک با مقصد MANAGER در سبد حساب مدیر است', receiptBucketOf({ isCheque: true, destination: 'MANAGER', methodKind: 'CUSTOM' }), 'managerAccount')
eq('چک با مقصد CASH در سبد نامشخص است', receiptBucketOf({ isCheque: true, destination: 'CASH', methodKind: 'CUSTOM' }), 'unknown')
eq('چک با مقصد CARD در سبد نامشخص است', receiptBucketOf({ isCheque: true, destination: 'CARD', methodKind: 'CUSTOM' }), 'unknown')
eq('چک بدون مقصد در سبد نامشخص است', receiptBucketOf({ isCheque: true, destination: null, methodKind: 'CUSTOM' }), 'unknown')
eq('روش نقدی غیرچکی هنوز مقصد CASH را می‌پذیرد', receiptBucketOf({ isCheque: false, destination: 'CASH', methodKind: 'CASH' }), 'cash')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
