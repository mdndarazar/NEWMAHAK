/**
 * نشست ۱۱۸ · خوشه G · تغییر گروهی قیمت
 *
 * باگ: preview/apply و اجرای زمان‌بندی‌شده‌ی تغییر قیمت با take:20000 و
 * activeDiscounts با take:40000، کالاهای بیشتر را بی‌صدا از دامنه حذف می‌کردند.
 * این برای تغییر قیمت مدیریتی قابل قبول نیست: یا کل دامنه اجرا می‌شود یا عملیات
 * باید صریحاً خطا/هشدار بدهد.
 *
 * این تست قراردادی است؛ Prisma تولیدی در این محیط حاضر نیست.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/PriceAdjustService.ts'), 'utf8')

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

check('خواندن دامنه‌ی واریانت‌ها helper صفحه‌ای دارد', /function loadAllProductVariants[\s\S]{0,1200}take:\s*PRICE_ADJUST_READ_BATCH/.test(service))
check('پیش‌نمایش دیگر take ثابت ۲۰۰۰۰ ندارد', !/orderBy: \[\{ id: 'asc' \}\],[\s\S]{0,80}take: 20000/.test(service.slice(service.indexOf('async preview('), service.indexOf('async apply('))))
check('اعمال واقعی از helper کامل دامنه استفاده می‌کند', /const variants = await loadAllProductVariants\(tx, where/.test(service))
check('اجرای زمان‌بندی‌شده هم از helper کامل دامنه استفاده می‌کند', /const variants = await loadAllProductVariants\(tx, where/.test(service.slice(service.indexOf('async function startScheduledBatch('))))
check('activeDiscounts ردیف‌های قیمت را صفحه‌ای می‌خواند', /PRICE_ADJUST_READ_BATCH[\s\S]{0,500}priceChangeItem\.findMany/.test(service))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
