/**
 * حذف گزارشات فروش لات را دوباره پر نمی‌کند؛ بدهی دوخرید فی کل بدهی را عوض نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-report-delete.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-repdel-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
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

const userId = seed.user('حذف‌گزارش')
const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(pA, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 601,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2, purchasePrice = 1000000, salePrice = 2000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
eq(
  'بعد از فروش یک عدد، لات ۱ است',
  Number(sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s),
  1
)

const inv = sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get()
sql.prepare('DELETE FROM "Payment" WHERE invoiceId = ?').run(inv.id)
sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE invoiceId = ?').run(inv.id)
sql.prepare('DELETE FROM "SaleInvoice" WHERE id = ?').run(inv.id)
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'ADJUSTMENT',
  refType: 'SaleInvoice',
  refId: inv.id,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v)
await costEngine.run()
const lots = Number(sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s)
eq('حذف گزارش لات را دوباره پر نکرد', lots, 2)
eq('هنوز با موجودی می‌خواند', (await costEngine.health()).ok, true)

const v2 = seed.variant(pA, '34')
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v2)
seed.insert('StockMovement', {
  variantId: v2,
  delta: -5,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: null,
  state: 'FINAL',
  createdAt: Date.now() - 2000
})
sql.prepare('UPDATE "ProductVariant" SET stock = -5 WHERE id = ?').run(v2)
await costEngine.run()

const buyA = seed.insert('PurchaseInvoice', {
  invoiceNo: 602,
  issuedAtJalali: today,
  issuedAt: Date.now() - 1000,
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyA, variantId: v2, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyA,
  state: 'FINAL',
  createdAt: Date.now() - 1000
})
sql.prepare('UPDATE "ProductVariant" SET stock = -3 WHERE id = ?').run(v2)
await costEngine.run()

const buyB = seed.insert('PurchaseInvoice', {
  invoiceNo: 603,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 6_000_000,
  discountTotal: 0,
  grandTotal: 6_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyB, variantId: v2, qty: 3, unitPrice: 2_000_000, lineTotal: 6_000_000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 3,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyB,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v2)
await costEngine.run()

const cons = sql
  .prepare(
    `SELECT c.qty, c.unitCost FROM "CostConsumption" c
     JOIN "PurchaseLot" l ON l.id = c.lotId
     WHERE l.variantId = ? AND c.kind = 'SALE'`
  )
  .all(v2)
const fifo = cons.reduce((s, r) => s + Number(r.qty) * Number(r.unitCost), 0)
eq('بهای ۵ واحد بدهی = ۲×۱م + ۳×۲م', fifo, 8_000_000)
eq('بعد از دو خرید، لات با موجودی صفر می‌خواند', (await costEngine.health()).ok, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
