/**
 * B2 — کالایی که موجودی‌اش تمام شده و تند می‌فروشد باید در «پیشنهاد سفارش» بیاید.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-stock-reorder-zero.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reorder-'))
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
const cat = seed.category('زنانه')
const pA = seed.product('مانتو', cat)
const pB = seed.product('شال', cat)
const pC = seed.product('کاپشن', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const vSoldOut = seed.variant(pA, '38')
const vDead = seed.variant(pB, 'یک‌سایز')
const vPlenty = seed.variant(pC, 'L')
for (const [id, stock] of [
  [vSoldOut, 5],
  [vDead, 1],
  [vPlenty, 100]
]) {
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = 500000, purchasePrice = 100000 WHERE id = ?').run(stock, id)
}

// ۵ تا از مانتو فروش می‌رود → موجودی صفر، ولی فروش ۳۰روزه > ۰
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vSoldOut, qty: 5, unitPrice: 500_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_500_000, destination: 'CASH' }]
})
// یکی از کاپشن → موجودی زیاد، پوشش روز بالا
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vPlenty, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }]
})

const data = await stockInsightService.stock({ toJalali: today })
const inReorder = (id) => (data.reorder ?? []).some((r) => r.variantId === id)
const rowOf = (id) => (data.rows ?? []).find((r) => r.variantId === id)

eq('ماندهٔ مانتو صفر شده', rowOf(vSoldOut)?.stock, 0)
eq('کالای تمام‌شدهٔ پرفروش در پیشنهاد سفارش هست (باگ B2)', inReorder(vSoldOut), true)
eq('پوشش روزش صفر است، نه نامشخص', rowOf(vSoldOut)?.coverDays, 0)
eq('کالای راکد با موجودی یک، بدون فروش، وارد پیشنهاد نمی‌شود', inReorder(vDead), false)
eq('کالای پرموجود با پوشش بالا وارد پیشنهاد نمی‌شود', inReorder(vPlenty), false)
eq('جمع تعداد مانده درست است (۰ + ۱ + ۹۹)', data.totalQty, 100)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
