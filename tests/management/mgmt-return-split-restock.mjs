/**
 * بازبینی دهم · B1 (بحرانی) — دو برگشت روی **یک قلم**: یکی سالم و بازگشته به قفسه،
 * یکی ایرادیِ برنگشته. نشانهٔ «برگشته به لات» نباید برای کل قلم جمع بزند و به هر دو
 * برگشت سهم بدهد، وگرنه بهای جنسِ ایرادی هم از سود کم می‌شود و ضررش بی‌صدا پاک
 * می‌رود (سود بیشتر از واقع، بدون یادآوری). قاعده باید در سه تب یکی باشد: سود، ABC،
 * خرید/فروش — و ردیفِ تامین‌کننده هم با عددِ سرجمع بخواند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-return-split-restock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-return-split-'))
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
seed.category('پیراهن')
const p = seed.product('پیراهن مردانه')
const p2 = seed.product('پیراهن زنانه')
const sup = seed.insert('Supplier', { code: 'S1', name: 'بنکدار مرکزی' })
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

/** خرید ۲ عدد با فی ۱ میلیون. */
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1201,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  supplierId: sup,
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

/** یک قلم، تعداد ۲، فی ۳ میلیون (درآمد ۶م، هزینه ۲م، سود ۴م). */
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 2, unitPrice: 3_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 6_000_000, destination: 'CASH' }]
})
await costEngine.run()
const saleInv = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const line = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(saleInv).id)
const base = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از برگشت: ۶ میلیون درآمد و ۴ میلیون سود', [base.revenue, base.realProfit, base.qty], [6_000_000, 4_000_000, 2])

/** برگشت ۱: جنس به قفسه برگشته (حرکت SALE_RETURN ⇒ ردیف RETURN در دفتر). */
const ret1 = seed.insert('SaleReturn', {
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
  returnId: ret1,
  saleItemId: line,
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
  refId: ret1,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()

/** برگشت ۲: همان قلم، ایرادی — جنس برنگشته، فقط سند مالی. */
const ret2 = seed.insert('SaleReturn', {
  invoiceId: saleInv,
  total: 3_000_000,
  refundMethod: 'CASH',
  refundAmount: 3_000_000,
  returnedAtJalali: today,
  returnedAtTime: '12:30:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 1
})
seed.insert('SaleReturnItem', {
  returnId: ret2,
  saleItemId: line,
  variantId: v,
  qty: 1,
  unitPrice: 3_000_000,
  lineTotal: 3_000_000,
  restockedQty: 0
})
await costEngine.run()

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('درآمد خالص: هر دو برگشت از درآمد کم شد', after.revenue, 0)
// قاعده: خرج فقط به اندازهٔ جنسی کم می‌شود که به قفسه برگشته ⇒ ۲م − ۱م = ۱م می‌ماند
eq('سود واقعی = ۱ میلیون− (باگ B1: صفر می‌شد، یعنی هر دو برگشت از هزینه کم شد)', after.realProfit, -1_000_000)
eq('بهای نگه‌داشته‌شده = ۱ میلیون (همان فیِ جنسِ ایرادی)', after.returnCostKept, 1_000_000)
eq('یادآوری هم می‌آید: یک برگشتِ برنگشته', after.nonRestockedReturns, 1)
eq('سود جایگزینی هم همان ضرر را می‌بیند', after.replacementProfit, -1_000_000)
eq('تعداد خالص: دو فروش، دو برگشت ⇒ صفر', [after.qty, after.soldQty, after.returnedQty], [0, 2, 2])
eq('ردیفِ تامین‌کننده با عددِ سرجمع می‌خواند', after.bySupplier.map((s) => [s.name, s.realProfit, s.partyCount]), [['بنکدار مرکزی', -1_000_000, 1]])
eq('ردیفِ ماه هم همان ضرر و همان تعدادِ خالص را دارد', [after.months.length, after.months[0]?.realProfit, after.months[0]?.qty], [1, -1_000_000, 0])

const abc = await stockInsightService.abc({}, { withCost: true })
eq('ABC سود همان عدد تب سود است (نه ۰)', abc.profitRows?.[0]?.realProfit, -1_000_000)
const buyTab = await stockInsightService.purchaseVsSale({}, { withCost: true })
eq('خرید/فروش: بهای فروشِ رفته هم با همان قاعده خالص شد (۲م − ۱م)', buyTab.fifoSoldCost, 1_000_000)

/** راستی‌آزماییِ خودِ استخر: فقط یک ردیف RETURN در دفتر هست، پس سهمِ دومین برگشت صفر است. */
const retRows = sql.prepare(`SELECT saleItemId, qty, movementId FROM "CostConsumption" WHERE kind = 'RETURN'`).all()
eq('دفتر هزینه یک ردیف بازگشت دارد (نه دو)', retRows.length, 1)
eq('و همان یک ردیف به همان یک برگشت وصل است (movementId → refId)', Number(retRows[0].movementId), Number(sql.prepare(`SELECT id FROM "StockMovement" WHERE reason = 'SALE_RETURN'`).get().id))

/**
 * همان صحنه با ترتیبِ برعکس: برگشتِ ایرادی **قبل** از سالم ثبت شده. نشانهٔ «برگشته به
 * لات» نباید به ترتیبِ حلقه وابسته باشد — وگرنه پول درست می‌ماند ولی یادآوری به
 * برگشتِ اشتباه می‌چسبد (و در قلمِ دوم، نصفِ سهم جابه‌جا می‌شود).
 */
const v2 = seed.variant(p2, 'XL')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v2)
const buy2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1202,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  supplierId: sup,
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy2, variantId: v2, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', { variantId: v2, delta: 2, reason: 'PURCHASE', refType: 'PurchaseInvoice', refId: buy2, state: 'FINAL', createdAt: Date.now() })
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v2)
await costEngine.run()
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v2, qty: 2, unitPrice: 3_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 6_000_000, destination: 'CASH' }]
})
await costEngine.run()
const saleInv2 = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const line2 = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(saleInv2).id)
const mkReturn = (saleInv, line, variant, restocked, at) => {
  const r = seed.insert('SaleReturn', {
    invoiceId: saleInv,
    total: 3_000_000,
    refundMethod: 'CASH',
    refundAmount: 3_000_000,
    returnedAtJalali: today,
    returnedAtTime: at,
    userId,
    shiftId,
    kind: 'RETURN',
    restockPending: restocked ? 0 : 1
  })
  seed.insert('SaleReturnItem', {
    returnId: r,
    saleItemId: line,
    variantId: variant,
    qty: 1,
    unitPrice: 3_000_000,
    lineTotal: 3_000_000,
    restockedQty: restocked ? 1 : 0
  })
  if (restocked) {
    sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(variant)
    seed.insert('StockMovement', {
      variantId: variant,
      delta: 1,
      reason: 'SALE_RETURN',
      refType: 'SaleReturn',
      refId: r,
      state: 'FINAL',
      createdAt: Date.now()
    })
  }
  return r
}
mkReturn(saleInv2, line2, v2, false, '13:00:00')
mkReturn(saleInv2, line2, v2, true, '13:05:00')
await costEngine.run()
const both = await profitService.profit({ fromJalali: today, toJalali: today })
eq('دو صحنه کنار هم: درآمد صفر و سود −۲ میلیون (ترتیبِ برگشت فرق نمی‌کند)', [both.revenue, both.realProfit], [0, -2_000_000])
eq('یادآوری هم دوتا شد: دو برگشتِ برنگشته، ۲ میلیون خرجِ نگه‌داشته', [both.nonRestockedReturns, both.returnCostKept], [2, 2_000_000])
eq('تعداد خالص در هر دو حالت صفر است', [both.qty, both.soldQty, both.returnedQty], [0, 4, 4])
eq('ردیفِ تامین‌کننده هم −۲ میلیون', (both.bySupplier ?? []).map((s) => s.realProfit), [-2_000_000])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
