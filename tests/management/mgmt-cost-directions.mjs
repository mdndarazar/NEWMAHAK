/**
 * جهت دفتر هزینه: برگشت به همان لات، ابطال برگشت کم می‌کند، ویرایش خرید کم می‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-directions.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-cost-dir-'))
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('جهت')
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

let buyNo = 500
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

const lotLeft = () =>
  Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) AS n FROM "PurchaseLot" WHERE variantId = ?').get(v).n)

buy(2, 1_000_000)
const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
eq('بعد از فروش ۱ از ۲، مانده لات ۱', lotLeft(), 1)

const item = sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)
const ret = await salesService.createReturn({
  invoiceId: Number(sale.id),
  userId,
  full: true,
  lines: [{ saleItemId: Number(item.id), qty: 1 }],
  refundMethod: 'CASH'
})
await costEngine.run()
eq('برگشت جنس را به لات برگرداند', lotLeft(), 2)

const st1 = await costEngine.status()
await costEngine.run()
const st2 = await costEngine.status()
eq('اجرای دوباره lastMovementId را جلو نمی‌برد بی‌حرکت', st2.lastMovementId, st1.lastMovementId)
eq('اجرای دوباره لات اضافه نساخت', lotLeft(), 2)

if (typeof salesService.deleteReturn === 'function' || typeof salesService.voidReturn === 'function') {
  const fn = salesService.deleteReturn || salesService.voidReturn
  await fn.call(salesService, { id: ret.id ?? ret.returnId ?? ret, userId, managerPassword: '1111' }).catch(async () => {
    await salesService.deleteReturn?.({ id: ret.id, userId })
  })
} else {
  seed.insert('StockMovement', {
    variantId: v,
    delta: -1,
    reason: 'SALE_RETURN',
    refType: 'SaleReturn',
    refId: ret.id ?? ret.returnId ?? 0,
    state: 'FINAL',
    createdAt: Date.now()
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock - 1 WHERE id = ?').run(v)
}
await costEngine.run()
eq('ابطال برگشت دوباره از لات کم کرد', lotLeft(), 1)

const pid = buy(5, 1_000_000)
await costEngine.run()
const beforeEdit = lotLeft()
seed.insert('StockMovement', {
  variantId: v,
  delta: -2,
  reason: 'PURCHASE_EDIT',
  refType: 'PurchaseInvoice',
  refId: pid,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = stock - 2 WHERE id = ?').run(v)
await costEngine.run()
eq('کم کردن فاکتور خرید از لات همان خرید کم کرد', lotLeft(), beforeEdit - 2)

const h = await costEngine.health()
eq('چراغ سلامت: مانده لات = موجودی کالا', h.ok, true)

const a = await costEngine.run()
const b = await costEngine.run()
eq('قفل: اجرای پشت‌سرهم هر دو تمام می‌شوند', a.busy === true && b.busy === true, false)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
