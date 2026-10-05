/**
 * B3 — موجودی منفی (بیش‌فروختگی) نباید با فیلتر «حداقل مانده» پنهان شود.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-stock-negative-visible.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-neg-stock-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('انبار')
const cat = seed.category('مردانه')
const pA = seed.product('پیراهن', cat)
const pB = seed.product('کراپ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const vNeg = seed.variant(pA, 'M')
const vLow = seed.variant(pB, 'S')
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 400000, purchasePrice = 100000, minStock = 0 WHERE id = ?').run(vNeg)
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 400000, purchasePrice = 100000, minStock = 0 WHERE id = ?').run(vLow)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vNeg, qty: 1, unitPrice: 400_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 400_000, destination: 'CASH' }]
})
// یک اصلاح موجودی/انبار شمارشی آن را منفی می‌کند (دادهٔ خراب انبار)
sql.prepare('UPDATE "ProductVariant" SET stock = -2 WHERE id = ?').run(vNeg)

const d0 = await stockInsightService.stock({ toJalali: today, minStock: 0 })
const r0 = (d0.rows ?? []).find((r) => r.variantId === vNeg)
eq('ردیف موجودی منفی در تب مانده دیده می‌شود (باگ B3)', !!r0, true)
eq('ماندهٔ منفی همان −۲ است', r0?.stock, -2)
eq('فلگ stockNegative فعال است تا قرمزِ UI کار کند', r0?.stockNegative, true)
eq('پوشش روز برای منفی صفر است نه عدد منفی', r0?.coverDays, 0)
eq('کالای سالمِ موجود (۳) هم هست', (d0.rows ?? []).some((r) => r.variantId === vLow), true)
eq('جمع مانده، منفی را هم کم می‌کند (۳ − ۲)', d0.totalQty, 1)
eq('کالای منفیِ در حال فروش در پیشنهاد سفارش هم می‌آید', (d0.reorder ?? []).some((x) => x.variantId === vNeg), true)

const d5 = await stockInsightService.stock({ toJalali: today, minStock: 5 })
eq('با کف ۵، ردیف سالمِ ۳ عددی حذف می‌شود', (d5.rows ?? []).some((r) => r.variantId === vLow), false)
eq('با کف ۵، ردیف منفی همچنان می‌ماند', (d5.rows ?? []).some((r) => r.variantId === vNeg), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
