/**
 * برگشت در فیلتر فروشنده از فاکتور اصلی کم می‌شود، نه از ثبت‌کنندهٔ برگشت.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-profit-filter-returns.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-ret-filter-'))
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 280))
  }
}

const seller = seed.user('فروشنده')
const clerk = seed.user('ثبت‌برگشت')
const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: seller,
  staffConfirmed: 1
})
const v = seed.variant(pA, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)

const buyId = seed.insert('PurchaseInvoice', {
  invoiceNo: 9,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyId, variantId: v, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyId,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 1000000, salePrice = 2000000 WHERE id = ?').run(v)

const sale = await salesService.create({
  userId: seller,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
const item = sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)
await salesService.createReturn({
  invoiceId: Number(sale.id),
  userId: clerk,
  full: true,
  lines: [{ saleItemId: Number(item.id), qty: 1 }],
  refundMethod: 'CASH'
})
await costEngine.run()

const all = await profitService.profit({ fromJalali: today, toJalali: today })
const ofSeller = await profitService.profit({ fromJalali: today, toJalali: today, userId: seller })
const ofClerk = await profitService.profit({ fromJalali: today, toJalali: today, userId: clerk })

eq('بدون فیلتر درآمد خالص صفر (فروش − برگشت)', all.revenue, 0)
eq('فروشنده: برگشت از فاکتور خودش کم شد', ofSeller.revenue, 0)
eq('ثبت‌کنندهٔ برگشت فروش نداشته', ofClerk.revenue, 0)
eq('ثبت‌کنندهٔ برگشت درآمد منفی ندارد', ofClerk.revenue >= 0, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
