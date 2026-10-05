/**
 * فروش واردشده از ادغام بکاپ (حرکت فقط سند تاریخی) لات امروز را مصرف نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-merge.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-mergecost-'))
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

const userId = seed.user('ادغام')
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
  invoiceNo: 801,
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

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
eq(
  'بعد از فروش واقعی، لات ۹ است',
  Number(sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s),
  9
)

const imported = seed.insert('SaleInvoice', {
  receiptNo: 9099,
  userId,
  shiftId,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  status: 'SETTLED',
  orderType: 'INTERNAL',
  deductInventory: 1,
  goodsTotal: 10_000_000,
  taxTotal: 0,
  serviceCharge: 0,
  discountTotal: 0,
  deliveryFee: 0,
  grandTotal: 10_000_000,
  paidTotal: 10_000_000
})
const itemId = seed.insert('SaleInvoiceItem', {
  invoiceId: imported,
  variantId: v,
  qty: 5,
  unitPrice: 2_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 10_000_000
})
seed.insert('StockMovement', {
  variantId: v,
  delta: -5,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: imported,
  state: 'FINAL',
  note: 'ادغام بکاپ · فقط سند تاریخی (موجودی فعلی تغییر نکرد)',
  createdAt: Date.now()
})
await costEngine.run()
eq(
  'فروش تاریخی لات امروز را نخورد',
  Number(sql.prepare('SELECT SUM(qtyLeft) AS s FROM "PurchaseLot" WHERE variantId = ?').get(v).s),
  9
)
const cost = sql.prepare('SELECT costStatus, qty FROM "SaleItemCost" WHERE saleItemId = ?').get(itemId)
eq('قلم واردشده OUTSIDE است', cost?.costStatus, 'OUTSIDE')
const p = await profitService.profit({ fromJalali: today, toJalali: today })
eq('سود فقط فروش واقعی است', p.realProfit, 1_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
