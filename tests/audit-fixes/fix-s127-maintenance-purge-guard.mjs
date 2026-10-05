/**
 * نشست ۱۲۷ · خوشه G/H · آرشیو قدیمی، مهلت حذف و دفتر گردش انبار.
 *
 * باگ‌های baseline:
 *   ۱) archivePurge هر تاریخ معتبر، حتی تاریخ نزدیک، را می‌پذیرفت؛
 *   ۲) همان مسیر StockMovement را حذف و consolidationId دفتر را update می‌کرد؛
 *   ۳) UI این عملیات را به‌عنوان حذف ledger به کاربر می‌فروخت.
 *
 * قرارداد بعد از رفع:
 *   • حذف فیزیکی فقط برای cutoff حداقل ۷۳۰ روز قدیمی مجاز است؛
 *   • StockMovement append-only است: نه DELETE و نه UPDATE؛
 *   • preview/result/UI این حفاظت را صریح نشان می‌دهند.
 *
 * این تست قراردادی است و جای Prisma تولیدی، migration واقعی و Electron را نمی‌گیرد.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const service = readFileSync(resolve(root, 'src/main/services/MaintenanceService.ts'), 'utf8')
const types = readFileSync(resolve(root, 'src/shared/types.ts'), 'utf8')
const ui = readFileSync(resolve(root, 'src/renderer/src/pages/Settings.tsx'), 'utf8')
const purge = service.slice(service.indexOf('async archivePurge('))

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

check('مهلت حذف آرشیو دو ساله و سمت main تعریف شده است', /export const MAINTENANCE_RETENTION_DAYS = 730/.test(service))
check(
  'preview قبل از شمارش cutoff تازه را رد می‌کند',
  /async preview\([\s\S]{0,260}enforceMaintenanceCutoff\(input\?\.beforeJalali\)/.test(service)
)
check(
  'archivePurge هم مستقل از UI cutoff را enforce می‌کند',
  /async archivePurge\([\s\S]{0,900}enforceMaintenanceCutoff\(input\?\.beforeJalali\)/.test(service)
)
check('مسیر purge هیچ DELETE روی دفتر گردش ندارد', !/DELETE FROM "StockMovement"/.test(purge))
check('مسیر purge هیچ UPDATE روی دفتر گردش ندارد', !/UPDATE "StockMovement"/.test(purge))
check(
  'قرارداد نتیجه می‌گوید حرکت‌های انبار هرگز حذف نمی‌شوند',
  /هرگز حذف نمی‌شوند[\s\S]{0,80}stockMovements:\s*number/.test(types)
)
check(
  'رابط کاربر گزینه‌ی حذف حرکت انبار را وعده نمی‌دهد',
  !/حرکات انبار قدیمی هم پاک شوند/.test(ui) && /append-only|همیشه حفظ/.test(ui)
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
