import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const reports = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')
const extraTables = readFileSync(resolve(root, 'src/renderer/src/components/ReportExtraTables.tsx'), 'utf8')

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

check('نمایش تب ضدتقلب آرایه‌ی flags سرویس را می‌خواند', /pick\(fraud, 'flags', 'groups', 'sections', 'rows'\)/.test(extraTables))
check('چاپ A4 ضدتقلب از snapshot گروه‌های flags می‌خواند', /fraudOutputRows\(output\.fraudGroups, \(g\) => fraudGroupLabel\(g\)\)/.test(reports))  // ممیزی A94-02: helper مشترک
check('خروجی Excel ضدتقلب از snapshot گروه‌های flags می‌خواند', /fraudOutputRows\(output\.fraudGroups, \(g\) => fraudGroupLabel\(g, ''\)\)/.test(reports))  // ممیزی A94-02
check('نمایش ردیف‌های منبع را از sources هم می‌سازد', /Array\.isArray\(g\.sources\) \? g\.sources/.test(extraTables))
check('چاپ و Excel ردیف‌های source را از دست نمی‌دهند', /Array\.isArray\(g\?\.sources\) \? g\.sources/.test(readFileSync('src/shared/reportExtraOutput.ts', 'utf8')) && (reports.match(/fraudOutputRows\(output\.fraudGroups/g) ?? []).length >= 2)  // ممیزی A94-02
check('برچسب شرح برای label منبع وجود دارد', /label: 'شرح'/.test(extraTables))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
