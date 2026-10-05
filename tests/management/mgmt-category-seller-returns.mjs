/**
 * فیلتر فروشنده روی تب دسته، برگشت فروشندهٔ دیگر را کم نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-category-seller-returns.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-catret-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { trendService } = await import('../../src/main/services/management/TrendService.ts')
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 360))
  }
}

const a = seed.user('الف')
const b = seed.user('ب')
const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: a,
  staffConfirmed: 1
})
const v = seed.variant(pA, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 2000000, purchasePrice = 1000000 WHERE id = ?').run(v)

await salesService.create({
  userId: a,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
const saleB = await salesService.create({
  userId: b,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
const itemB = sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(saleB.id)
await salesService.createReturn({
  invoiceId: Number(saleB.id),
  userId: b,
  full: true,
  lines: [{ saleItemId: Number(itemB.id), qty: 1 }],
  refundMethod: 'CASH'
})

const ofA = await trendService.category({ fromJalali: today, toJalali: today, userId: a })
const rowA = ofA.rows.find((r) => r.name === 'شلوار')
eq('فیلتر الف منفی نیست', (rowA?.amount ?? 0) > 0, true)
eq('فیلتر الف همان فروش الف است', rowA?.amount, 2_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
