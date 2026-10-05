/**
 * نشست ۱۲۱ · خروجی گزارش صفحه‌بندی‌شده
 *
 * باگ: چاپ A4 و Excel ردیف‌های صفحه‌ی جاری را می‌بردند، اما متادیتای صفحه
 * را روی خروجی نمی‌نوشتند؛ فایل ناقص از نظر کاربر شبیه خروجی کامل بود.
 *
 * این تست قراردادی است و وجود npm/Prisma/Electron را ادعا نمی‌کند.
 */
/**
 * مسیر تاریخی نگه داشته شده تا اجرای دستیِ نام قدیمی هم همان قرارداد تازه را
 * اجرا کند. تست canonical نشست ۱۳۴ در فایل S133 است.
 */
import './fix-s133-report-export-full-range.mjs'
// نشست ۱۷۱ · S171-D3 — نتیجه‌ی تست canonical حفظ شود (exitCode=1 نباید به ۰ تبدیل شود)
process.exit(process.exitCode ?? 0)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

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

check('متن خروجی، page.truncated را بررسی می‌کند', /if \(page\?\.truncated\)/.test(page))
check('هشدار خروجی تعداد نمایش‌داده‌شده و کل را اعلام می‌کند', /نمایش \$\{faDigits\(rowsShown\)\} از \$\{faDigits\(page\.totalCount\)\}/.test(page))
check('هشدار می‌گوید جمع ردیف‌های فایل فقط صفحه‌ی جاری است', /جمع مبلغ ردیف‌های فایل فقط همین صفحه است/.test(page))
check('هشدار دفتر رویداد را از sections هم عبور می‌دهد', /ledger\?\.sections/.test(page) && /section\?\.\s*truncated/.test(page))
check('برش منابع ضدتقلب در خروجی اعلام می‌شود', /sourcesTruncated/.test(page) && /مبلغ هشدار بر اساس کل اسناد است/.test(page))
check('چاپ A4 از متادیتای خروجی هشدار‌دار استفاده می‌کند', (page.match(/meta: outputMetaText/g) ?? []).length >= 9)
check('Excel از متادیتای خروجی هشدار‌دار استفاده می‌کند', /const meta = outputMetaText/.test(page))
check('مسیر قدیمیِ خروجی بدون هشدار باقی نمانده است', !/meta:\s*metaText/.test(page))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
