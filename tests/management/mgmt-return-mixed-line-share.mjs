/**
 * بازبینی یازدهم · B7 — خطی که نیمی‌اش از انبار فروشگاه و نیمی‌اش از انبار مرکزی رفته،
 * ردیفِ هزینه‌اش فقط سهمِ فروشگاه است (۳ از ۵). برگشتِ ۲ عدد باید ۲/۳ِ همان ردیف را کم
 * کند، نه ۲/۵ِ کل خط؛ وگرنه درآمد و هزینه کمتر از واقع کم می‌شود و واحدها دوباره شمرده
 * می‌مانند (سودِ بالاتر از واقع، بدون هیچ علامتی). در خطِ تک‌منبعی هیچ عددی عوض نمی‌شود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-return-mixed-line-share.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-mixed-share-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
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

const userId = seed.user('مختلط')
seed.category('پالتو')
const p = seed.product('پالتو مردانه')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
void cash
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '52')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

/** خرید ۳ عدد با فی ۱ میلیون. */
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1701,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
  goodsTotal: 3_000_000,
  discountTotal: 0,
  grandTotal: 3_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 3, unitPrice: 1_000_000, lineTotal: 3_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 3,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now() - 10 * DAY
})
await costEngine.run()

/** فروشِ ۵ عدد که فقط ۳ تایش از انبار فروشگاه رفته: ردیفِ هزینه = ۳ × ۳م = ۹م درآمد، ۳م هزینه. */
const inv = seed.insert('SaleInvoice', {
  receiptNo: 941,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 15_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 15_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item1 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 5,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 15_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: item1, variantId: v, sourceKind: 'STORE', qty: 3 })
seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: item1, variantId: v, sourceKind: 'WAREHOUSE', qty: 2 })
seed.insert('StockMovement', {
  variantId: v,
  delta: -3,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)
await costEngine.run()
const base = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از برگشت: سهمِ فروشگاه در سود (۹م درآمد، ۶م سود)', [base.revenue, base.realProfit, base.qty], [9_000_000, 6_000_000, 3])

/** برگشتِ ۲ عدد از همان خط، که هر دو به قفسه برگشته‌اند. */
const ret = seed.insert('SaleReturn', {
  invoiceId: inv,
  total: 6_000_000,
  refundMethod: 'CASH',
  refundAmount: 6_000_000,
  returnedAtJalali: today,
  returnedAtTime: '12:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: ret,
  saleItemId: item1,
  variantId: v,
  qty: 2,
  unitPrice: 3_000_000,
  lineTotal: 6_000_000,
  restockedQty: 2
})
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 2 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: ret,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()

const after = await profitService.profit({ fromJalali: today, toJalali: today })
/**
 * دو عدد از سه عددِ سهمِ فروشگاه برگشته ⇒ ۲/۳: درآمد ۹م → ۳م و هزینه ۳م → ۱م.
 * با مخرجِ «کل خط» (باگ) درآمد ۵٫۴م و سود ۴٫۲م می‌شد، یعنی دو سومِ یک قلمِ برگشتی
 * هنوز داخل سود حساب می‌ماند.
 */
eq('درآمد خالص = یک‌سومِ ردیف', after.revenue, 3_000_000)
eq('بهای تمام‌شده هم یک‌سوم شد', after.fifoCost, 1_000_000)
eq('سود واقعی = سودِ یک عددِ مانده', after.realProfit, 2_000_000)
eq('تعداد خالصِ فروشگاه: سه فروش، دو برگشت', [after.soldQty, after.returnedQty, after.qty], [3, 2, 1])
eq('ردیفِ ماه هم همان عدد را دارد', [after.months.length, after.months[0]?.revenue, after.months[0]?.realProfit], [1, 3_000_000, 2_000_000])

const buyTab = await stockInsightService.purchaseVsSale({}, { withCost: true })
eq('خرید/فروش: بهای فروشِ رفته هم با مخرجِ ردیف خالص شد (۳م − ۲م)', buyTab.fifoSoldCost, 1_000_000)

/** خطِ تک‌منبعی (همه از فروشگاه) نباید ذره‌ای تکان بخورد: نسبت‌ها همان می‌مانند. */
const v2 = seed.variant(p, '54')
sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v2)
const buy2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1702,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy2, variantId: v2, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', { variantId: v2, delta: 2, reason: 'PURCHASE', refType: 'PurchaseInvoice', refId: buy2, state: 'FINAL', createdAt: Date.now() })
const inv2 = seed.insert('SaleInvoice', {
  receiptNo: 942,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 6_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 6_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item2 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv2,
  variantId: v2,
  qty: 2,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 6_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv2, saleItemId: item2, variantId: v2, sourceKind: 'STORE', qty: 2 })
seed.insert('StockMovement', { variantId: v2, delta: -2, reason: 'SALE', refType: 'SaleInvoice', refId: inv2, state: 'FINAL', createdAt: Date.now() })
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v2)
await costEngine.run()
const ret2 = seed.insert('SaleReturn', {
  invoiceId: inv2,
  total: 3_000_000,
  refundMethod: 'CASH',
  refundAmount: 3_000_000,
  returnedAtJalali: today,
  returnedAtTime: '12:30:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: ret2,
  saleItemId: item2,
  variantId: v2,
  qty: 1,
  unitPrice: 3_000_000,
  lineTotal: 3_000_000,
  restockedQty: 1
})
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(v2)
seed.insert('StockMovement', { variantId: v2, delta: 1, reason: 'SALE_RETURN', refType: 'SaleReturn', refId: ret2, state: 'FINAL', createdAt: Date.now() })
await costEngine.run()
const solo = await profitService.profit({ fromJalali: today, toJalali: today })
eq('دو قلم با هم: ۳م + ۳م درآمد (قلمِ دوم نصفِ خودش برگشته)', solo.revenue, 6_000_000)
eq('و ۲م + ۲م سود', solo.realProfit, 4_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
