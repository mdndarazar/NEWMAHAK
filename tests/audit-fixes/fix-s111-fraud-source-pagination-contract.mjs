import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const fraud = readFileSync(resolve(root, 'src/main/services/FraudService.ts'), 'utf8')
const extraTables = readFileSync(resolve(root, 'src/renderer/src/components/ReportExtraTables.tsx'), 'utf8')
const reports = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

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

check('قرارداد پرچم ضدتقلب تعداد واقعی منابع را دارد', /sourcesTotal: number/.test(fraud))
check('قرارداد پرچم ضدتقلب برش منابع را علامت می‌زند', /sourcesTruncated: boolean/.test(fraud))
check('سقف منابع ضدتقلب ثابت و صریح است', /const FRAUD_SOURCE_CAP = 200/.test(fraud))
check('خود سرویس منابع را با metadata برش می‌دهد', /sources: includeAllSources \? f\.sources : f\.sources\.slice\(0, FRAUD_SOURCE_CAP\)/.test(fraud))
check('برش قدیمی بی‌هشدار روی sources باقی نمانده', !/sources: [^\n]+\.slice\(0, 200\)\.map/.test(fraud))
check('تب ضدتقلب هشدار تعداد منابع نمایش‌داده‌شده را نشان می‌دهد', /نمایش \$\{faDigits\(g\.sources\?\.length/.test(extraTables))
check('چاپ و Excel از همان برچسب metadata استفاده می‌کنند', (reports.match(/fraudGroupLabel\(g/g) ?? []).length >= 2)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
