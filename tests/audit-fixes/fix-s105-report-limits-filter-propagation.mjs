/**
 * نشست ۱۰۵ · خوشه G
 *
 * باگ: sale:report:limits فقط کانال/فروشنده را روی برگشت، تعویض و چک
 * می‌شمرد و تعداد اعتبار خرید را بدون فیلتر فاکتور مادر می‌گرفت. نوار قرمز
 * بنابراین می‌توانست برای همان فیلترهای روی جدول، تعداد دروغ نشان دهد.
 *
 * این تست قراردادی است؛ Prisma تولیدی و Electron واقعی در این محیط حاضر نیستند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/reportLimits.ts'), 'utf8')

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

// ممیزی A99-03/A99-04 — شمارنده حالا where خودِ جدول‌ها را از SalesService می‌گیرد (نه بازسازی موازی)
check('helper دامنه‌ی مشترک برگشت/تعویض و چک از SalesService وارد شده', /returnReportScopeWhere/.test(service) && /chequeReportWhere/.test(service))
check('نوع سفارش و کانال: همان helper جدول (orderTypeWhere داخل returnReportScopeWhere/chequeReportWhere)', /const returnScope = await returnReportScopeWhere\(filter\)/.test(service))
check('where مشترک چک ساخته می‌شود', /const chequeWhere = await chequeReportWhere\(/.test(service))
check('برگشت و تعویض همان دامنه‌ی جدول را مصرف می‌کنند', /\.\.\.returnScope,[\s\S]{0,200}kind: ReturnKind\.RETURN/.test(service) && /\{ \.\.\.returnScope, kind: ReturnKind\.EXCHANGE \}/.test(service))
check('چک همان where جدول را مصرف می‌کند', /prisma\.payment\.count\(\{ where: chequeWhere \}\)/.test(service))
check('اعتبار legacy از totalCount سرویس واقعی استفاده می‌کند', /storeCreditService[\s\S]{0,500}result\.page\.totalCount/.test(service))
check(
  // نشست ۱۸۰ (S180-D13): `page` در CreditReportResult اختیاری است، پس خوانش
  // با `?.` و fallback به rows.length انجام می‌شود؛ پنجره‌ی regex هم برای
  // یادداشت توضیحی بازتر شد. معنای قرارداد (مصرف همان کانال) عوض نشده.
  // ممیزی A105-01 — شمارنده‌ی نسیه همان creditList جدول است؛ دروازه‌ی DRAFT/CANCELED داخل creditList
  'شمارش نسیه همان کانال جدول (creditList با دروازه‌ی لغوشده/پیش‌نویس) را مصرف می‌کند',
  /salesService[\s\S]{0,40}\.creditList\(\{[\s\S]{0,700}result\.page\??\.totalCount/.test(service)
)
check('سقف اعتبار در همان ردیف شمارش‌شده اعلام می‌شود', /row\('storeCredits', 'اعتبار خرید', creditList/.test(service))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
