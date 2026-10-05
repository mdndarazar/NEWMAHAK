/**
 * نشست ۱۱۸ · خوشه G · دفتر تاریخچه‌ی انبار مرکزی
 *
 * باگ: تاریخچه با take:500 بی‌صدا بریده می‌شد و مدیر بخشی از ledger را نمی‌دید.
 * این تست قراردادی است؛ Prisma تولیدی و Electron واقعی در این محیط حاضر نیستند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/SecondaryStockService.ts'), 'utf8')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SecondaryStock.tsx'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')

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

const history = service.slice(service.indexOf('async history('), service.indexOf('\n  },', service.indexOf('async history(')))
check('تعداد کل با همان فیلتر محاسبه می‌شود', /secondaryStockLog\.count\(\{ where: effectiveWhere \}\)/.test(history))
check('تاریخچه skip/take و سقف ۵۰۰۰ دارد', /const skip =[\s\S]{0,180}const take =[\s\S]{0,160}5000/.test(history))
check('metadata صفحه و هشدار فارسی روی آرایه برمی‌گردد', /mapped\.page =[\s\S]{0,240}mapped\.warnings =/.test(history))
check('UI هشدار تاریخچه را نمایش می‌دهد', /historyWarnings\.map/.test(page))
check('UI دکمه‌های صفحه‌ی قبل و بعد دارد', /historyPage\.skip[\s\S]{0,420}صفحه‌ی قبل[\s\S]{0,420}صفحه‌ی بعد/.test(page))
check('قرارداد shared صفحه‌ی تاریخچه را دارد', /export interface SecondaryStockLogPage[\s\S]{0,260}totalCount/.test(types))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
