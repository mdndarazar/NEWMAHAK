/**
 * بازبینی دهم · B2 (بحرانی) — ویرایشِ یک قلم که **سهمش از انبار فروشگاه با تعدادِ کلش فرق
 * دارد** (۳ از فروشگاه، ۲ از انبار مرکزی) نباید فیِ قفل‌شده را عوض کند. `SaleItemCost.qty`
 * همان سهمِ فروشگاه است (۳) ولی `SaleInvoiceItem.qty` کل قلم (۵)؛ تطبیقِ «یتیم ↔ قلمِ تازه»
 * با تعدادِ کل هیچ‌وقت جفت نمی‌شد ⇒ قلم از نو قفل می‌شد و فیِ جایگزینی از لاتِ امروز
 * (۲ میلیون) گرفته می‌شد. پس تطبیق با سهمِ فروشگاه سنجیده می‌شود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-cost-edit-warehouse-share.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-edit-share-'))
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

const userId = seed.user('فی')
seed.category('کاپشن')
const p = seed.product('کاپشن')
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
const v = seed.variant(p, 'XL')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

const mkBuy = (qty, unit, daysAgo) => {
  const at = Date.now() - daysAgo * DAY
  const inv = seed.insert('PurchaseInvoice', {
    invoiceNo: 1300 + daysAgo,
    issuedAtJalali: toJalaliDate(new Date(at)),
    issuedAt: at,
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: inv, variantId: v, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId: v,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: at
  })
  return inv
}
mkBuy(3, 1_000_000, 30)
await costEngine.run()

/** فاکتور فروش: ۵ عدد، که فقط ۳ تایش از انبار فروشگاه رفته (۲ تای دیگر از انبار مرکزی). */
const inv = seed.insert('SaleInvoice', {
  receiptNo: 777,
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

const rowOf = (itemId) => sql.prepare('SELECT saleItemId, qty, revenue, fifoCost, replacementCost FROM "SaleItemCost" WHERE saleItemId = ?').get(itemId)
const r1 = rowOf(item1)
eq('ردیف هزینه با سهمِ فروشگاه قفل شد (۳ عدد، نه ۵)', Number(r1.qty), 3)
eq('درآمد هم سهمِ همان ۳ عدد است', Number(r1.revenue), 9_000_000)
eq('FIFO و جایگزینی هر دو ۳ میلیون (همه‌چیز با فی ۱م لحظهٔ قفل)', [Number(r1.fifoCost), Number(r1.replacementCost)], [3_000_000, 3_000_000])
const lotLeft = () => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) s FROM "PurchaseLot"').get().s)
eq('لاتِ ۳عددی کامل رفته', lotLeft(), 0)

/** خریدِ تازه با فی ۲ میلیون — از این به بعد «قاعدهٔ امروز» ۲ میلیون است. */
mkBuy(4, 2_000_000, 1)
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 4 WHERE id = ?').run(v)
await costEngine.run()
eq('ویرایشِ خریدِ تازه فیِ قلمِ قفل‌شده را تکان نداد', Number(rowOf(item1).replacementCost), 3_000_000)

/** ویرایشِ همان فاکتور فروش، فقط تخفیف: ردیفِ کهنه می‌رود و ردیفِ تازه با همان تعداد می‌آید. */
const lotLeftBeforeEdit = lotLeft()
sql.prepare('UPDATE "SaleInvoice" SET discountTotal = 1000000, grandTotal = 14000000 WHERE id = ?').run(inv)
const item2 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 5,
  unitPrice: 3_000_000,
  discount: 1_000_000,
  tax: 0,
  lineTotal: 15_000_000
})
sql.prepare('UPDATE "SaleItemStockAllocation" SET saleItemId = ? WHERE saleItemId = ?').run(item2, item1)
sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE id = ?').run(item1)
await costEngine.run()

const r2 = rowOf(item2)
eq('یتیم به قلمِ تازه وصل شد (ردیفِ هزینه از نو ساخته نشد)', r2 ? Number(r2.saleItemId) : null, item2)
eq('سهمِ فروشگاه دست‌نخورده ماند', Number(r2.qty), 3)
eq('درآمد با تخفیفِ تازه هم‌خوان شد (۱۴م × ۳/۵)', Number(r2.revenue), 8_400_000)
eq('FIFOِ قفل‌شده عوض نشد', Number(r2.fifoCost), 3_000_000)
eq('جایگزینی هم همان ۳ میلیون ماند (باگ B2: ۶ میلیون می‌شد)', Number(r2.replacementCost), 3_000_000)
eq('هیچ لاتِ تازه‌ای مصرف نشد (جارو فقط وصل می‌کند، مصرف را تکرار نمی‌کند)', lotLeft(), lotLeftBeforeEdit)

const prof = await profitService.profit({ fromJalali: today, toJalali: today })
eq('تب سود: سود واقعی ۵٫۴ میلیون', prof.realProfit, 5_400_000)
eq('سود جایگزینی هم ۵٫۴ میلیون (باگ: ۲٫۴ میلیون)', prof.replacementProfit, 5_400_000)
eq('«سود تورمی» این قلم صفر است (دو نگاه به یک فیِ قفل‌شده)', prof.inflationOnSold, 0)

/** اگر سهمِ فروشگاه واقعاً عوض شود، قلم باید از نو قفل شود (تطبیقِ اجباری نداریم). */
sql.prepare('UPDATE "SaleItemStockAllocation" SET qty = 4 WHERE saleItemId = ? AND sourceKind = ?').run(item2, 'STORE')
sql.prepare('UPDATE "SaleItemStockAllocation" SET qty = 1 WHERE saleItemId = ? AND sourceKind = ?').run(item2, 'WAREHOUSE')
sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE id = ?').run(item2)
const item3 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 5,
  unitPrice: 3_000_000,
  discount: 1_000_000,
  tax: 0,
  lineTotal: 15_000_000
})
sql.prepare('UPDATE "SaleItemStockAllocation" SET saleItemId = ? WHERE saleItemId = ?').run(item3, item2)
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ? WHERE id = ?').run(Date.now(), inv)
await costEngine.run()
const r3 = rowOf(item3)
eq('سهمِ عوض‌شده ⇒ ردیف از نو قفل شد (تعدادِ جدید ۴)', Number(r3.qty), 4)
eq(
  'چهار عدد واقعاً از قفسه رفته (سه تای بازگشتی + یکی از لاتِ تازه)',
  Number(
    sql
      .prepare(`SELECT COALESCE(SUM(qty),0) s FROM "CostConsumption" WHERE saleItemId = ? AND kind = 'SALE'`)
      .get(item3).s
  ),
  4
)
// سه واحدِ برگشتی سرِ جایشان برگشتند (همان فی ۱م) و واحدِ تازه از لاتِ ۲ میلیونی خورد.
eq('و فیِ واحدِ اضافه از لاتِ خودش خوانده شد، نه از فیِ کهنه', Number(r3.fifoCost), 5_000_000)
eq('جایگزینی هم با قاعدهٔ امروز: ۴ × ۲ میلیون', Number(r3.replacementCost), 8_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
