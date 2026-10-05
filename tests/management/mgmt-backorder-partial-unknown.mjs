/**
 * بازبینی یازدهم · B3 — قلمی که «بدهی» دارد و فقط **یک عددش** با فاکتور پر شده نباید
 * از UNKNOWN به APPROX برگردد: تا وقتی حتی یک واحد بی‌فی است، نیمی از هزینه هنوز
 * مجهول است و نباید با «سود تقریبی» داخل عددِ سود بیاید. پر شدنِ بقیه، خودش برمی‌گرداندش.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-backorder-partial-unknown.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-bo-partial-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const DAY = 86400_000

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

const userId = seed.user('بدهی')
seed.category('شال')
const p = seed.product('شال گردن')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'yte')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 0 WHERE id = ?').run(v)

/** فروشِ ۳ عدد روی قفسهٔ خالی و بدون هیچ سندی: بدهیِ بی‌فی. */
const inv = seed.insert('SaleInvoice', {
  receiptNo: 911,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 9_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 9_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item1 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 3,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 9_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: item1, variantId: v, sourceKind: 'STORE', qty: 3 })
seed.insert('StockMovement', {
  variantId: v,
  delta: -3,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()
const row0 = sql.prepare('SELECT qty, fifoCost, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('فرضِ تست: بدهیِ کاملاً بی‌فی ⇒ UNKNOWN', [Number(row0.qty), Number(row0.fifoCost), row0.costStatus], [3, 0, 'UNKNOWN'])

/** یک عدد از بدهی با فاکتورِ ۱ میلیونی پر می‌شود — دو عدد هنوز بی‌فی است. */
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1501,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)
await costEngine.run()

const row1 = sql.prepare('SELECT fifoCost, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('یک واحد قیمت گرفت (هزینه ۱ میلیون شد)', Number(row1.fifoCost), 1_000_000)
eq('ولی قلم هنوز UNKNOWN است (باگ: APPROX می‌شد و ۸ میلیون سودِ نصفه‌قیمت داخل عدد می‌آمد)', row1.costStatus, 'UNKNOWN')
const prof1 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('تا وقتی نصفِ هزینه مجهول است، این قلم داخل سود نمی‌آید', [prof1.revenue, prof1.zeroCostCount], [0, 1])

/** دو عددِ باقی‌مانده هم فاکتور می‌آید ⇒ قلم برمی‌گردد توی سود. */
const buy2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1502,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy2, variantId: v, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy2,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()
const row2 = sql.prepare('SELECT fifoCost, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('همهٔ واحدها فی گرفتند', Number(row2.fifoCost), 3_000_000)
eq('وضعیت از UNKNOWN بیرون آمد', row2.costStatus !== 'UNKNOWN', true)
const prof2 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('و قلم به سود برگشت: درآمد ۹م، سود ۶م', [prof2.revenue, prof2.realProfit, prof2.zeroCostCount], [9_000_000, 6_000_000, 0])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
