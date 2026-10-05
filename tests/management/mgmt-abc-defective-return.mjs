/**
 * بازبینی نهم · B5 — ABC سود باید همان قاعدهٔ تب سود را داشته باشد: برگشتی که
 * جنسش به قفسه برنگشته (ایرادی/در صف بازگشت) فقط از درآمد کم می‌شود، نه از هزینه.
 * قبلاً ABC هر دو طرف را با یک نسبت کم می‌کرد ⇒ همان کالا در دو تب دو عدد مختلف
 * داشت و کالای ضررده در ABC «سودآور» دیده می‌شد. این تست برابریِ دو تب را می‌بندد.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-abc-defective-return.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-abc-return-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
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
  invoiceNo: 601,
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

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 2, unitPrice: 3_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 6_000_000, destination: 'CASH' }]
})
await costEngine.run()
const saleInv = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const [lineA, lineB] = sql
  .prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id ASC LIMIT 2')
  .all(saleInv)
  .map((r) => Number(r.id))

const baseProfit = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از برگشت: هر دو تب ۴ میلیون سود می‌بینند', baseProfit.realProfit, 4_000_000)
const baseAbc = await stockInsightService.abc({}, { withCost: true })
eq('ABC هم همان ۴ میلیون را می‌گوید', baseAbc.profitRows?.[0]?.realProfit, 4_000_000)

/** برگشتِ ایرادی: فقط سند مالی، `restockedQty = 0`، هیچ حرکت انباری. */
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
  saleItemId: lineA,
  variantId: v,
  qty: 1,
  unitPrice: 3_000_000,
  lineTotal: 3_000_000,
  restockedQty: 0
})
await costEngine.run()

const p2 = await profitService.profit({ fromJalali: today, toJalali: today })
// قلم A: ۳م − ۱م سود؛ برگشتِ برنگشته ⇒ درآمد صفر، خرج ۱م می‌ماند ⇒ ۱م− ، قلم B: ۲م+ ⇒ ۱م
eq('تب سود: ضرر جنسِ برنگشته در سود ماند', p2.realProfit, 1_000_000)
const abc2 = await stockInsightService.abc({}, { withCost: true })
eq(
  'ABC سود همان عدد تب سود را می‌دهد (باگ B5: ۲م می‌شد، یعنی فی هم کم می‌شد)',
  abc2.profitRows?.[0]?.realProfit,
  p2.realProfit
)
eq(
  'توضیحِ قاعده در یادداشتِ تب موجودی هست',
  String(abc2.note || '').includes('برگشتی که جنسش به قفسه برنگشته'),
  true
)

/** حالا همان برگشت جنسش به قفسه برمی‌گردد ⇒ هزینه هم باید کم شود. */
sql.prepare('UPDATE "SaleReturnItem" SET restockedQty = 1 WHERE returnId = ? AND saleItemId = ?').run(retBad, lineA)
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: retBad,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()
const p3 = await profitService.profit({ fromJalali: today, toJalali: today })
const abc3 = await stockInsightService.abc({}, { withCost: true })
eq('بعد از بازگشت جنس به قفسه: تب سود ۲ میلیون', p3.realProfit, 2_000_000)
eq('و ABC هم‌اکنون همان ۲ میلیون را می‌گوید (نه عددِ قبلی)', abc3.profitRows?.[0]?.realProfit, 2_000_000)
eq('دو تب هنوز می‌خوانند', [abc3.profitRows?.length, p3.realProfit === abc3.profitRows?.[0]?.realProfit], [1, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
