/**
 * نشست ۱۲۶ · خوشه G/H · حذف فیزیکی کالا و دفتر گردش انبار.
 *
 * باگ: حذف همیشگی هر کالای soft-deleted بدون مهلت دو ساله مجاز بود و
 * `StockMovement.deleteMany` کل دفتر گردش آن کالا را پاک می‌کرد؛ این با بند
 * «ledger append-only» و کشف مغایرت‌های قدیمی ناسازگار است.
 *
 * قرارداد بعد از رفع: مهلت ۷۳۰ روز سمت main enforce می‌شود، وجود حرکت انبار
 * حذف را fail-closed می‌کند، و UI دیگر وعده‌ی پاک‌شدن ledger را نمی‌دهد.
 * این تست قراردادی است و جای Prisma/Electron تولیدی را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/VariantPurgeService.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')
const ui = readFileSync(resolve(root, 'src/renderer/src/pages/Products.tsx'), 'utf8')

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

check('مهلت دو ساله در main ثابت و enforce شده است', /VARIANT_PURGE_RETENTION_DAYS = 730/.test(service) && /tooRecent/.test(service))
check('کالای بدون deletedAt یا تازه حذف‌شده رد می‌شود', /!deletedAt \|\| deletedAt > cutoff/.test(service))
check('دفتر گردش قبل از purge داخل تراکنش count می‌شود', /tx\.stockMovement\.count\(\{ where: \{ variantId: \{ in: (targets|chunk) \} \} \}\)/.test(service))
check('هیچ مسیر حذف فیزیکی StockMovement باقی نمانده است', !/stockMovement\.deleteMany/.test(service))
check('نتیجه‌ی سازگار قدیمی movements را صفر و ledger را نگه‌داشته اعلام می‌کند', /movements: 0/.test(service) && /دفتر گردش انبار دست‌نخورده ماند/.test(service))
check('قرارداد پیش‌نمایش می‌گوید حرکت انبار مانع حذف است', /وجود هر حرکت حذف همیشگی را مسدود می‌کند/.test(types))
check('رابط کاربر دیگر نمی‌گوید حرکت انبار پاک می‌شود', !/حرکت انبار .*پاک شد|حرکت انبار .*پاک می‌شود|حرکت انبار برای همیشه پاک می‌گردد/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
