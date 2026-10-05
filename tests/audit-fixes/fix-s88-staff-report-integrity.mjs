/**
 * نشست ۸۸ · خوشه I
 *
 * دو خطای مستقلِ تب عملکرد کارمندان:
 * ۱) SaleReturn در Prisma فقط userId/shiftId اسکالر دارد، اما سرویس relation
 *    user/shift را select می‌کرد و در Prisma Client واقعی crash می‌شد.
 * ۲) مصرف اعتبار در دفتر StoreCreditRedemption با کارمندِ مصرف‌کننده وارد
 *    عملکرد/ریز تراکنش‌ها نمی‌شد.
 *
 * این تست منطق shared را اجرا می‌کند و قراردادهای main/renderer را ساختاری
 * کنترل می‌کند. اجرای Prisma Client تولیدی و React/Electron واقعی در محیط
 * موجود نیست.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (p) => readFileSync(resolve(root, p), 'utf8')
const service = read('src/main/services/StaffReportService.ts')
const panel = read('src/renderer/src/components/StaffPerformancePanel.tsx')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

const { calculateStaffPerformance } = await import('@shared/accounting')
const rows = calculateStaffPerformance(
  [],
  [],
  [
    { userId: 7, userName: 'فروشنده ۷', amount: 120000 },
    { userId: 7, userName: 'فروشنده ۷', amount: 80000 }
  ]
)

eq('مصرف اعتبار به کارمند مصرف‌کننده نسبت داده می‌شود', rows[0]?.userId ?? null, 7)
eq('تعداد مصرف اعتبار دو ردیف دفتر است', rows[0]?.storeCreditUsedCount ?? null, 2)
eq('مبلغ مصرف اعتبار از amount دفتر جمع می‌شود', rows[0]?.storeCreditUsedTotal ?? null, 200000)
eq('مصرف اعتبار کارمند ردیف عملکرد را می‌سازد حتی بدون فروش/برگشت', rows.length, 1)

eq('بازه‌ی پیش‌فرض StaffReportService امروز است', /const reportRange[\s\S]{0,180}jalaliToday\(\)/.test(service), true)
eq('SaleReturn با relation user select نمی‌شود', /saleReturn\.findMany[\s\S]{0,900}user:\s*\{\s*select/.test(service), false)
eq('SaleReturn با relation shift select نمی‌شود', /saleReturn\.findMany[\s\S]{0,900}shift:\s*\{\s*select/.test(service), false)
// نشست ۱۸۰ (S180-D4): helperهای null-safe `userOf`/`shiftOf` جایگزین `map.get` شدند؛
// معنای قرارداد (خواندن از lookup اسکالر، نه relation پریزمایی) دست‌نخورده است.
eq('نام کاربر برگشت از lookup اسکالر خوانده می‌شود', /returnMaps\.(users\.get|userOf)\(r\.userId\)/.test(service), true)
eq('نام شیفت برگشت از lookup اسکالر خوانده می‌شود', /returnMaps\.(shifts\.get|shiftOf)\(r\.shiftId\)/.test(service), true)
eq('ریز مصرف اعتبار از main برمی‌گردد', /creditRedemptions/.test(service), true)
eq('پنل ستون تعداد مصرف اعتبار دارد', /تعداد مصرف اعتبار/.test(panel), true)
eq('پنل ستون مبلغ مصرف اعتبار دارد', /جمع مصرف اعتبار/.test(panel), true)
eq('پنل ریز مصرف اعتبار را نمایش می‌دهد', /مصرف اعتبار خرید \(\{faDigits\(drill\.data\.creditRedemptions\.length\)/.test(panel), true)

console.log('  ⓘ محدودیت: Prisma Client تولیدی، typecheck و React/Electron واقعی اجرا نشدند.')
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
