/**
 * بازبینی هشتم · B2 — برگشتی که جنسش به انبار برنگشته (ایرادی / در صف بازگشت به انبار)
 * نباید هزینهٔ قلم را از سودِ فروخته‌شده کم کند؛ جنس رفته، پس خرج سر جایش می‌ماند
 * و ضرورش در سود دیده می‌شود. برگشتِ بازگشته به قفسه مثل قبل هر دو طرف را کم می‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-return-no-restock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-return-restock-'))
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('فی')
const cat = seed.category('کفش')
const p = seed.product('کفش چرم')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '40')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 501,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v)
await costEngine.run()

const lotSum = () => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) s FROM "PurchaseLot"').get().s)

// ————— دو فروش: یکی برمی‌گردد و به قفسه می‌نشیند، یکی ایرادی است و برنمی‌گردد —————
await salesService.create({
  userId,
  shiftId,
  lines: [
    { variantId: v, qty: 1, unitPrice: 3_000_000, discount: 0, tax: 0 },
    { variantId: v, qty: 1, unitPrice: 3_000_000, discount: 0, tax: 0 }
  ],
  payments: [{ methodId: cash, amount: 6_000_000, destination: 'CASH' }]
})
await costEngine.run()
const saleInv = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const [lineA, lineB] = sql
  .prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id ASC LIMIT 2')
  .all(saleInv)
  .map((r) => Number(r.id))
const base = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از برگشت: درآمد ۶ میلیون و سود ۴ میلیون', [base.revenue, base.realProfit], [6_000_000, 4_000_000])
eq('قبل از برگشت: دو عدد از لات رفته', lotSum(), 0)

/** برگشتِ جنس‌برگشته: سند + حرکت SALE_RETURN (موجودی و لات باید جلو بیاید). */
const retOk = seed.insert('SaleReturn', {
  invoiceId: saleInv,
  total: 3_000_000,
  refundMethod: 'CASH',
  refundAmount: 3_000_000,
  returnedAtJalali: today,
  returnedAtTime: '11:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: retOk,
  saleItemId: lineA,
  variantId: v,
  qty: 1,
  unitPrice: 3_000_000,
  lineTotal: 3_000_000,
  restockedQty: 1
})
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: retOk,
  state: 'FINAL',
  createdAt: Date.now()
})

/** برگشتِ ایرادی: فقط سند مالی — `restockedQty = 0` و هیچ حرکت انباری. */
const retBad = seed.insert('SaleReturn', {
  invoiceId: saleInv,
  total: 3_000_000,
  refundMethod: 'CASH',
  refundAmount: 3_000_000,
  returnedAtJalali: today,
  returnedAtTime: '12:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 1
})
seed.insert('SaleReturnItem', {
  returnId: retBad,
  saleItemId: lineB,
  variantId: v,
  qty: 1,
  unitPrice: 3_000_000,
  lineTotal: 3_000_000,
  restockedQty: 0
})
await costEngine.run()

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('درآمد خالص: هر دو برگشت از درآمد کم شد', after.revenue, 0)
// قلم A: فروش ۳م − فی ۱م = ۲م سود، برگشت کامل ⇒ ۰
// قلم B: فروش ۳م − فی ۱م = ۲م سود، برگشتِ بدون بازگشت ⇒ درآمد صفر، خرج ۱م می‌ماند ⇒ ۱م−
eq('سود واقعی: ضرر جنسِ برنگشته در سود ماند (باگ B2: صفر می‌شد)', after.realProfit, -1_000_000)
eq('بهای نگه‌داشته‌شده = ۱ میلیون (همان فی لات قلم B)', after.returnCostKept, 1_000_000)
eq('یک قلم برگشتِ برنگشته به انبار شمرده شد', after.nonRestockedReturns, 1)
eq('لایهٔ دسته هم همان عدد را می‌دهد', after.byCategory.reduce((s, c) => s + c.realProfit, 0), -1_000_000)
const notes = (after.notes ?? []).join(' | ')
eq('صفحه توضیح می‌دهد که چرا هزینه کم نشده', notes.includes('برگشت جنسش به انبار برنگشته'), true)
eq('جنسِ برگشته به لات برگشت ولی جنسِ برنگشته نه', lotSum(), 1)
eq('موجودی کالا با لات می‌خواند', Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(v).stock), 1)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
