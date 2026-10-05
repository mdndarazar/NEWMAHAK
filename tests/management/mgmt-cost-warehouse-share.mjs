/**
 * سهم انبار فروشگاه از تخصیص قلم؛ حرکت ادغام «فقط سند تاریخی» لات را عوض نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-warehouse-share.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-whshare-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
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

const userId = seed.user('انبار')
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
  invoiceNo: 501,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 10_000_000,
  discountTotal: 0,
  grandTotal: 10_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 10, unitPrice: 1_000_000, lineTotal: 10_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 10,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 10, purchasePrice = 1000000, salePrice = 2000000 WHERE id = ?').run(v)

const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 3, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 6_000_000, destination: 'CASH' }]
})
const item = sql.prepare('SELECT id, invoiceId FROM "SaleInvoiceItem" WHERE variantId = ?').get(v)
sql.prepare('UPDATE "SaleInvoiceItem" SET qty = 10, lineTotal = 20000000 WHERE id = ?').run(item.id)
sql
  .prepare('UPDATE "SaleInvoice" SET goodsTotal = 20000000, grandTotal = 20000000, paidTotal = 20000000 WHERE id = ?')
  .run(item.invoiceId)
seed.insert('SaleItemStockAllocation', {
  invoiceId: item.invoiceId,
  saleItemId: item.id,
  variantId: v,
  sourceKind: 'STORE',
  warehouseName: '',
  qty: 3
})
seed.insert('SaleItemStockAllocation', {
  invoiceId: item.invoiceId,
  saleItemId: item.id,
  variantId: v,
  sourceKind: 'WAREHOUSE',
  warehouseName: 'مرکزی',
  qty: 7
})

await costEngine.run()
const lotLeft = Number(sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s)
eq('لات فقط سهم فروشگاه را کم کرده', lotLeft, 7)
const p = await profitService.profit({ fromJalali: today, toJalali: today })
eq('درآمد فقط سهم فروشگاه است', p.revenue, 6_000_000)
eq('سود واقعی فقط سهم فروشگاه است', p.realProfit, 3_000_000)
eq('یادداشت انبار مرکزی هست', (p.notes || []).some((n) => String(n).includes('انبار')), true)

const lotsBefore = sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s
const head = sql.prepare('SELECT MAX(id) AS id FROM "StockMovement"').get().id
seed.insert('StockMovement', {
  variantId: v,
  delta: 4,
  reason: 'PURCHASE',
  refType: 'Product',
  refId: pA,
  state: 'FINAL',
  note: 'ادغام کالا — فقط سند تاریخی (موجودی فعلی تغییر نکرد)',
  createdAt: Date.now()
})
await costEngine.run()
const lotsAfter = sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s
const st = await costEngine.status()
eq('حرکت تاریخی لات را عوض نکرد', Number(lotsAfter), Number(lotsBefore))
eq('شناسه آخرین حرکت جلو رفته', st.lastMovementId > head, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
