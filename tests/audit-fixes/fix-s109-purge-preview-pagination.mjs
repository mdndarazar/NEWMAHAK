/**
 * نشست ۱۰۹ · خوشه G
 *
 * باگ: sale:purge:preview گزارش فاکتورها را با take:20000 می‌خواند اما
 * قرارداد پیش‌نمایش هیچ totalCount/truncated/warning نداشت؛ در بازه‌ی بزرگ
 * بخشی از موارد برای مدیر نامرئی می‌ماند.
 *
 * این تست قراردادی است؛ Prisma تولیدی و Electron واقعی در این محیط حاضر نیستند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')
const settings = readFileSync(resolve(root, 'src/renderer/src/pages/Settings.tsx'), 'utf8')

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

const preview = service.slice(service.indexOf('async purgePreview('), service.indexOf('async purge(', service.indexOf('async purgePreview(')))

check('پیش‌نمایش از metadata گزارش صفحه استفاده می‌کند', /page: res\.page/.test(preview))
check('هشدار برش پیش‌نمایش به caller می‌رسد', /warnings: ids\.length \? \[\] : res\.warnings/.test(preview))
check('قرارداد shared صفحه‌ی پیش‌نمایش را دارد', /interface SalesPurgePreview[\s\S]{0,300}page\?: SaleReportPage/.test(types))
check('قرارداد shared هشدار پیش‌نمایش را دارد', /interface SalesPurgePreview[\s\S]{0,380}warnings\?: string\[\]/.test(types))
check('UI هشدار پیش‌نمایش را واقعاً نمایش می‌دهد', /purge\.warnings\?\.length[\s\S]{0,260}purge\.warnings\.join/.test(settings))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
