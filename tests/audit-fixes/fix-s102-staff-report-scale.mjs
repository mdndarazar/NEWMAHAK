/**
 * نشست ۱۰۲ · خوشه G
 *
 * گزارش عملکرد کارمندان و هشدار خارج از شیفت، گزارش تجمیعی/هشداری هستند؛
 * برش ثابت ۲۰٬۰۰۰ ردیف در این مسیرها عدد مالی یا هشدار ضدتقلب را ناقص می‌کرد.
 * این تست تضمین می‌کند سقف حذف شده و lookupهای شناسه‌ای هنوز در دسته‌های امن
 * اجرا می‌شوند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/StaffReportService.ts'), 'utf8')

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
const bodyOf = (name, next) => {
  const start = service.indexOf(name)
  const end = service.indexOf(next, start)
  return service.slice(start, end < 0 ? service.length : end)
}

const performance = bodyOf('async performance(', '  /**\n   * بند ۲ — ریز')
const abnormal = bodyOf('async abnormalDiscounts(', '  /**\n   * بند ۶ —')
const outOfShift = bodyOf('async outOfShift(', '  /**\n   *')

check('lookupهای IN با chunk برابر ۵۰۰ محافظت شده‌اند', /REPORT_IN_CHUNK = 500/.test(service) && /chunksOf\(/.test(service))
check('performance فاکتورها را بی‌صدا روی ۲۰٬۰۰۰ نمی‌بُرد', !/take:\s*20_000/.test(performance))
check('performance برگشت‌ها را بی‌صدا روی ۲۰٬۰۰۰ نمی‌بُرد', !/take:\s*20_000/.test(performance))
check('performance مصرف اعتبار را بی‌صدا روی ۲۰٬۰۰۰ نمی‌بُرد', !/take:\s*20_000/.test(performance))
check('lookup اعتبارهای برگشتی chunk شده است', /chunksOf\(creditIds\)/.test(performance))
check('lookup کاربرهای مصرف اعتبار chunk شده است', /chunksOf\(redemptionUserIds\)/.test(performance))
check('تخفیف غیرعادی همه‌ی فاکتورهای واجد شرط را می‌خواند', !/take:\s*20_000/.test(abnormal))
check('خارج از شیفت همه‌ی فاکتورهای بازه را می‌خواند', !/take:\s*20_000/.test(outOfShift))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
