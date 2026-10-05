/**
 * B1/B2 regression — برگشتِ ابطال‌شده نباید سهم «بازگشته به لات» را برای برگشت تازه نگه دارد.
 * سناریو: فروش یک عدد، برگشتِ restock‌شده، ابطال آن، و ثبت دوبارهٔ همان برگشت.
 * اجرای دستی: node --import ./test/harness/register.mjs tests/management/mgmt-b1-voided-return-restock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-voided-return-restock-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { restockedReturnShares } = await import('../../src/main/services/management/returnShare.ts')
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

const userId = seed.user('ابطال برگشت')
const categoryId = seed.category('کفش')
const productId = seed.product('کفش چرمی', categoryId)
const variantId = seed.variant(productId, '۴۰')
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(variantId)

const purchaseId = seed.insert('PurchaseInvoice', {
  invoiceNo: 9901,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 1000000,
  discountTotal: 0,
  grandTotal: 1000000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: purchaseId, variantId, qty: 1, unitPrice: 1000000, lineTotal: 1000000 })
seed.insert('StockMovement', {
  variantId,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: purchaseId,
  state: 'FINAL',
  createdAt: new Date(Date.now() - 1000)
})

const invoiceId = seed.insert('SaleInvoice', {
  receiptNo: 9901,
  issuedAtJalali: today,
  issuedAt: new Date(),
  userId,
  goodsTotal: 3000000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 3000000,
  deductInventory: true,
  status: 'SETTLED'
})
const saleItemId = seed.insert('SaleInvoiceItem', {
  invoiceId,
  variantId,
  qty: 1,
  unitPrice: 3000000,
  discount: 0,
  tax: 0,
  lineTotal: 3000000
})
seed.insert('StockMovement', {
  variantId,
  delta: -1,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: invoiceId,
  state: 'FINAL',
  createdAt: new Date()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(variantId)
await costEngine.run()

const addReturn = (time) => {
  const returnId = seed.insert('SaleReturn', {
    invoiceId,
    total: 3000000,
    refundMethod: 'CASH',
    refundAmount: 3000000,
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
    qty: 1,
    unitPrice: 3000000,
    lineTotal: 3000000,
    restockedQty: 1
  })
  return returnId
}

const addReturnMovement = (returnId, delta, at = Date.now()) => {
  seed.insert('StockMovement', {
    variantId,
    delta,
    reason: 'SALE_RETURN',
    refType: 'SaleReturn',
    refId: returnId,
    state: 'FINAL',
    createdAt: new Date(at)
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock + ? WHERE id = ?').run(delta, variantId)
}

// برگشت اول واقعاً به لات برمی‌گردد؛ سپس باطل و با حرکت معکوس از موجودی خارج می‌شود.
const voidedReturnId = addReturn('10:00:00')
addReturnMovement(voidedReturnId, 1)
await costEngine.run()
sql.prepare('UPDATE "SaleReturn" SET voidedAt = ?, voidReason = ? WHERE id = ?').run(Date.now(), 'ابطال تستی', voidedReturnId)
addReturnMovement(voidedReturnId, -1)
await costEngine.run()

// برگشت تازه باید بتواند دوباره همان مصرفِ فروش را به لات برگرداند.
const activeReturnId = addReturn('11:00:00')
addReturnMovement(activeReturnId, 1)
await costEngine.run()

const shares = await restockedReturnShares(db, [saleItemId])
eq('سهمِ برگشتِ ابطال‌شده از استخر حذف شد', shares.byItem.get(saleItemId), 1)
eq('سهمِ فعال به همان برگشت تازه وصل است', shares.byReturn.get(`${saleItemId}:${activeReturnId}`), 1)
eq('برگشتِ باطل‌شده دیگر سهمِ فعال ندارد', shares.byReturn.has(`${saleItemId}:${voidedReturnId}`), false)

const activeRestock = sql
  .prepare(`
    SELECT cc.saleItemId AS saleItemId, sm.refId AS returnId, cc.qty AS qty
    FROM "CostConsumption" cc
    JOIN "StockMovement" sm ON sm.id = cc.movementId
    WHERE cc.kind = 'RETURN'
  `)
  .all()
  .find((row) => Number(row.returnId) === activeReturnId)
eq('دفتر هزینه، بازگشت تازه را به قلم فروش وصل کرد (نه به fallback بی‌ارجاع)', Number(activeRestock?.saleItemId), saleItemId)
eq('یک واحد از همان لات دوباره روی قفسه است', Number(sql.prepare('SELECT SUM(qtyLeft) AS q FROM "PurchaseLot"').get().q), 1)

const report = await profitService.profit({ fromJalali: today, toJalali: today })
eq('برگشت فعال درآمد را یک بار کم کرد', report.revenue, 0)
eq('هزینه نیز فقط یک بار کم شد', report.fifoCost, 0)
eq('ابطال برگشت، سود کاذب منفی یا مثبت باقی نگذاشت', report.realProfit, 0)
eq('فقط یک برگشت در تعداد فعال شمرده شد', report.returnedQty, 1)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
