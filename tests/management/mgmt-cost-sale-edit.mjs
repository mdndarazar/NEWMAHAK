/**
 * ویرایش فاکتور فروش: قلم تازه فی می‌گیرد؛ تخفیف فی لات را عوض نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-sale-edit.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sale-edit-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
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

const userId = seed.user('ویرایش')
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

let buyNo = 700
const buy = (qty, unit) => {
  const id = seed.insert('PurchaseInvoice', {
    invoiceNo: ++buyNo,
    issuedAtJalali: today,
    issuedAt: Date.now(),
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: id, variantId: v, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId: v,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: id,
    state: 'FINAL',
    createdAt: Date.now()
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock + ?, purchasePrice = ?, salePrice = ? WHERE id = ?').run(
    qty,
    unit,
    unit * 2,
    v
  )
  return id
}

const lotLeft = () => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) AS n FROM "PurchaseLot" WHERE variantId = ?').get(v).n)
const costCount = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleItemCost"').get().n)

buy(3, 1_000_000)
const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
const before = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از ویرایش سود واقعی ۱ میلیون', before.realProfit, 1_000_000)
eq('یک قلم فی قفل دارد', costCount(), 1)
eq('مانده لات ۲', lotLeft(), 2)

await salesService.update({
  id: sale.id,
  userId,
  shiftId,
  keepPayments: true,
  confirmOverpay: true,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 200_000, tax: 0 }]
})
await costEngine.run()
const afterDisc = await profitService.profit({ fromJalali: today, toJalali: today })
eq('ویرایش فقط تخفیف: هنوز یک فی قفل', costCount(), 1)
eq('هزینه FIFO همان ۱ میلیون ماند', afterDisc.fifoCost, 1_000_000)
eq('درآمد با تخفیف کم شد', afterDisc.revenue, 1_800_000)
eq('سود واقعی ۸۰۰ هزار', afterDisc.realProfit, 800_000)
eq('مانده لات عوض نشد', lotLeft(), 2)

await salesService.update({
  id: sale.id,
  userId,
  shiftId,
  keepPayments: true,
  confirmOverpay: true,
  lines: [{ variantId: v, qty: 2, unitPrice: 2_000_000, discount: 0, tax: 0 }]
})
await costEngine.run()
const afterQty = await profitService.profit({ fromJalali: today, toJalali: today })
eq('بعد از دو برابر کردن تعداد، یک فی قفل', costCount(), 1)
eq('هزینه FIFO دو میلیون', afterQty.fifoCost, 2_000_000)
eq('مانده لات ۱', lotLeft(), 1)
eq('قلم بدون فی صفر است', afterQty.missingCostRows, 0)

const item = sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)
await salesService.createReturn({
  invoiceId: Number(sale.id),
  userId,
  full: true,
  lines: [{ saleItemId: Number(item.id), qty: 2 }],
  refundMethod: 'CASH'
})
await costEngine.run()
eq('برگشت بعد از ویرایش لات را کامل کرد', lotLeft(), 3)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
