/**
 * نشست ۱۳۵ · خوشه H · آرشیو شیفت‌های قدیمی
 *
 * باگ: پیش‌نمایش تعداد شیفت‌های قدیمی را می‌شمارد و purge واقعاً می‌تواند
 * آن‌ها را حذف کند، اما guard «چیزی برای پاک‌سازی نیست» این شمارنده را
 * نادیده می‌گرفت؛ بنابراین دیتابیسی که فقط شیفت‌های قدیمیِ بدون سند داشت،
 * بی‌دلیل با خطای «چیزی حذف نشد» متوقف می‌شد.
 *
 * این تست قراردادی است و جای اجرای Prisma واقعی روی کپی دیتابیس را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/MaintenanceService.ts'), 'utf8')
const start = service.indexOf('if (\n      !before.saleInvoices')
const guard = start >= 0 ? service.slice(start, service.indexOf('throw new BusinessError', start)) : ''

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

check('guard آرشیو، شمارنده‌ی شیفت‌های قدیمی را هم در نظر می‌گیرد', /!before\.shifts\b/.test(guard))
check(
  'preview تعداد شیفت‌های قدیمی را از همان cutoff می‌شمارد',
  /COUNT\(\*\) AS c FROM "Shift"[\s\S]{0,180}"dayJalali" <> ''[\s\S]{0,120}beforeJalali/.test(service)
)
check(
  'purge شیفت قدیمیِ بی‌سند را فقط بعد از جداکردن وابستگی‌ها حذف می‌کند',
  /DELETE FROM "Shift"[\s\S]{0,520}"dayJalali" <> ''[\s\S]{0,220}id NOT IN \(SELECT "shiftId" FROM "SaleInvoice"/.test(service)
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
