/**
 * نشست ۱۱۸ · خوشه G · پیش‌نمایش پاک‌سازی فاکتورهای انتخابی
 *
 * باگ: purgePreview با take ثابتِ reportRows صفحه‌ی اول را می‌گرفت و بعد
 * invoiceIds را روی همان صفحه فیلتر می‌کرد؛ فاکتور انتخاب‌شده‌ای که در صفحه‌ی
 * بعد بود در پیش‌نمایش دیده نمی‌شد و مدیر عدد ناقص می‌دید.
 *
 * این تست قراردادی است؛ Prisma تولیدی و Electron واقعی در این محیط حاضر نیستند.
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

const where = service.slice(service.indexOf('export function saleWhere('), service.indexOf('\n}\n\n/**', service.indexOf('export function saleWhere(')) + 2)
const preview = service.slice(service.indexOf('async purgePreview('), service.indexOf('async purge(', service.indexOf('async purgePreview(')))

check('فیلتر گزارش شناسه‌های فاکتور را پشتیبانی می‌کند', /invoiceIds\??:\s*number\[\]/.test(types) && /invoiceIds/.test(where))
check(
  'پیش‌نمایش انتخابی شناسه‌ها را قبل از صفحه‌بندی به reportRows می‌دهد',
  /reportRows\(\{[\s\S]{0,260}fromJalali,[\s\S]{0,260}toJalali,[\s\S]{0,260}invoiceIds:\s*ids/.test(preview)
)
check(
  'پیش‌نمایش انتخابی جمع را از همان ردیف‌های دقیق می‌سازد',
  /ids\.length \? sumTotals\(rows\) : res\.totals/.test(preview)
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
