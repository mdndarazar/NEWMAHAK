/**
 * B2 regression — برگشتِ انبار مرکزی نباید سود فروشگاه را تغییر دهد؛ برگشتِ معیوبِ
 * فروشگاهی درآمد را کم می‌کند ولی هزینه درجا می‌ماند؛ منشأ نامعلومِ برگشت مختلط
 * باید گزارش شود، نه اینکه به‌طور حدسی به سهم فروشگاه نسبت داده شود.
 * اجرای دستی: node --import ./test/harness/register.mjs tests/management/mgmt-b2-return-source.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-return-source-'))
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

const userId = seed.user('منشأ برگشت')
const categoryId = seed.category('کت')
const productId = seed.product('کت پشمی', categoryId)
const mixedVariantId = seed.variant(productId, 'M')
const storeVariantId = seed.variant(productId, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(mixedVariantId)
sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(storeVariantId)

const addPurchase = (invoiceNo, variantId, qty) => {
  const invoiceId = seed.insert('PurchaseInvoice', {
    invoiceNo,
    issuedAtJalali: today,
    issuedAt: new Date(Date.now() - 60_000),
    goodsTotal: qty * 1000000,
    discountTotal: 0,
    grandTotal: qty * 1000000,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId, variantId, qty, unitPrice: 1000000, lineTotal: qty * 1000000 })
  seed.insert('StockMovement', {
    variantId,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: invoiceId,
    state: 'FINAL',
    createdAt: new Date(Date.now() - 60_000)
  })
}
addPurchase(9811, mixedVariantId, 3)
addPurchase(9812, storeVariantId, 2)
await costEngine.run()

const invoiceId = seed.insert('SaleInvoice', {
  receiptNo: 9811,
  issuedAtJalali: today,
  issuedAt: new Date(),
  userId,
  goodsTotal: 21000000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 21000000,
  deductInventory: true,
  status: 'SETTLED'
})
const mixedItemId = seed.insert('SaleInvoiceItem', {
  invoiceId,
  variantId: mixedVariantId,
  qty: 5,
  unitPrice: 3000000,
  discount: 0,
  tax: 0,
  lineTotal: 15000000
})
const storeItemId = seed.insert('SaleInvoiceItem', {
  invoiceId,
  variantId: storeVariantId,
  qty: 2,
  unitPrice: 3000000,
  discount: 0,
  tax: 0,
  lineTotal: 6000000
})
const mixedStoreAllocationId = seed.insert('SaleItemStockAllocation', {
  invoiceId,
  saleItemId: mixedItemId,
  variantId: mixedVariantId,
  sourceKind: 'STORE',
  qty: 3
})
const mixedWarehouseAllocationId = seed.insert('SaleItemStockAllocation', {
  invoiceId,
  saleItemId: mixedItemId,
  variantId: mixedVariantId,
  sourceKind: 'WAREHOUSE',
  warehouseName: 'انبار مرکزی',
  qty: 2
})
const storeAllocationId = seed.insert('SaleItemStockAllocation', {
  invoiceId,
  saleItemId: storeItemId,
  variantId: storeVariantId,
  sourceKind: 'STORE',
  qty: 2
})
seed.insert('StockMovement', {
  variantId: mixedVariantId,
  delta: -3,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: invoiceId,
  state: 'FINAL',
  createdAt: new Date()
})
seed.insert('StockMovement', {
  variantId: storeVariantId,
  delta: -2,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: invoiceId,
  state: 'FINAL',
  createdAt: new Date()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id IN (?, ?)').run(mixedVariantId, storeVariantId)
await costEngine.run()

const addReturn = ({ time, saleItemId, variantId, qty = 1, restockedQty = 0 }) => {
  const returnId = seed.insert('SaleReturn', {
    invoiceId,
    total: qty * 3000000,
    refundMethod: 'CASH',
    refundAmount: qty * 3000000,
    returnedAtJalali: today,
    returnedAtTime: time,
    userId,
    kind: 'RETURN',
    restockPending: 0
  })
  seed.insert('SaleReturnItem', {
    returnId,
    saleItemId,
    variantId,
    qty,
    unitPrice: 3000000,
    lineTotal: qty * 3000000,
    restockedQty
  })
  return returnId
}

// کالای انبار مرکزی که واقعاً به انبار مرکزی برگشته: سند می‌گوید restocked است،
// اما برایش حرکتِ موجودی فروشگاه ساخته نمی‌شود.
const centralReturnId = addReturn({ time: '10:00:00', saleItemId: mixedItemId, variantId: mixedVariantId, restockedQty: 1 })
sql.prepare('UPDATE "SaleItemStockAllocation" SET restoredQty = 1 WHERE id = ?').run(mixedWarehouseAllocationId)

// در خط مختلط، این برگشت نه به موجودی برگشته و نه سندی دارد که STORE/WAREHOUSE را ثابت کند.
const ambiguousReturnId = addReturn({ time: '10:30:00', saleItemId: mixedItemId, variantId: mixedVariantId, restockedQty: 0 })

// همه‌ی واحدهای این خط از فروشگاه بوده‌اند؛ پس حتی برگشتِ معیوبِ بدون restock
// منشأ اثبات‌شده دارد: درآمد کم می‌شود ولی فیِ همان جنس در هزینه می‌ماند.
const defectiveStoreReturnId = addReturn({ time: '11:00:00', saleItemId: storeItemId, variantId: storeVariantId, restockedQty: 0 })

const beforeMixedRestock = await profitService.profit({ fromJalali: today, toJalali: today })
eq('برگشت مرکزی از درآمد فروشگاه چیزی کم نکرد', beforeMixedRestock.revenue, 12000000)
eq('برگشت مرکزی و برگشت مختلطِ نامعلوم فی را دست‌کاری نکردند', beforeMixedRestock.fifoCost, 5000000)
eq('فقط برگشتِ معیوبِ منشأ‌اثبات‌شده زیان فروشگاه را زیاد کرد', beforeMixedRestock.realProfit, 7000000)
eq('بهای کالای STOREِ معیوب در هزینه ماند', beforeMixedRestock.returnCostKept, 1000000)
eq('برگشت مختلطِ نامعلوم جداگانه گزارش شد', beforeMixedRestock.ambiguousReturnQty, 1)
eq('تعداد برگشتِ منشأنامعلوم هم گزارش شد', beforeMixedRestock.ambiguousReturns, 1)
eq('هشدار، حدس نزدنِ منشأ را روشن می‌کند', (beforeMixedRestock.notes ?? []).some((x) => String(x).includes('منشأ') && String(x).includes('قابل اثبات نیست')), true)
eq(
  'تعداد STORE از تعداد خامِ همهٔ برگشت‌ها جدا و قابل تطبیق ماند',
  [beforeMixedRestock.qty, beforeMixedRestock.returnedQty, beforeMixedRestock.totalReturnedQty],
  [4, 1, 3]
)

// برگشت STOREِ مختلط که حرکتش دقیقاً یک واحد افزایش موجودی فروشگاه را ثبت کرده.
// منبع این یک واحد معلوم است؛ فقط همان یک واحد از درآمد و FIFO کم می‌شود.
const storeRestockedReturnId = addReturn({ time: '11:30:00', saleItemId: mixedItemId, variantId: mixedVariantId, restockedQty: 1 })
sql.prepare('UPDATE "SaleItemStockAllocation" SET restoredQty = 1 WHERE id = ?').run(mixedStoreAllocationId)
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(mixedVariantId)
seed.insert('StockMovement', {
  variantId: mixedVariantId,
  delta: 1,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: storeRestockedReturnId,
  state: 'FINAL',
  createdAt: new Date()
})
await costEngine.run()

const afterMixedRestock = await profitService.profit({ fromJalali: today, toJalali: today })
eq('بازگشتِ STORE یک واحد دیگر از درآمد فروشگاه کم کرد', afterMixedRestock.revenue, 9000000)
eq('هزینه فقط به اندازه همان واحدِ به‌لات‌برگشته کم شد', afterMixedRestock.fifoCost, 4000000)
eq('سود مرکزی/مختلط/معیوب بدون تخصیص حدسی درست ماند', afterMixedRestock.realProfit, 5000000)
eq('ابهام باقی ماند تا تخصیص نادرست پنهان نشود', afterMixedRestock.ambiguousReturnQty, 1)
eq('جمع دسته همان سودِ سرجمع است', afterMixedRestock.byCategory.reduce((sum, row) => sum + row.realProfit, 0), 5000000)
eq('ردیف ماه همان سودِ سرجمع است', afterMixedRestock.months.reduce((sum, row) => sum + row.realProfit, 0), 5000000)
eq('تفکیک تامین‌کننده هم به همان سود می‌رسد', afterMixedRestock.bySupplier.reduce((sum, row) => sum + row.realProfit, 0), 5000000)

const abc = await stockInsightService.abc({}, { withCost: true })
eq('ABC سود همان قاعدهٔ تب سود را دارد', abc.profitRows?.[0]?.realProfit, afterMixedRestock.realProfit)
eq('ABC هم منشأ مبهم را در یادداشت نگه داشت', String(abc.note || '').includes('قابل اثبات نیست'), true)
const purchaseVsSale = await stockInsightService.purchaseVsSale({}, { withCost: true })
eq('خرید/فروش فقط هزینهٔ برگشت STOREِ واقعاً restock‌شده را کم کرد', purchaseVsSale.fifoSoldCost, 4000000)

// ارجاع‌های سندها را نگه می‌داریم تا حذف تصادفی از fixture آشکار شود.
eq('سندهای سه نوع برگشت ساخته شدند', [centralReturnId > 0, ambiguousReturnId > 0, defectiveStoreReturnId > 0], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
