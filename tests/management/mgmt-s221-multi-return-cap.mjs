/**
 * بازبینی دوازدهم · B1 — دو برگشتِ یک قلم نباید بیشتر از خودِ ردیف درآمد برگردانند.
 *
 * `shopReturnRatio` هر برگشت را **جدا** تا ۱ سقف می‌کند؛ پس روی ردیفِ ۵عددی دو برگشتِ
 * ۳ و ۲ و ۱ عددی (جمعاً ۶) ۱٫۲ از درآمد کم می‌کرد: ردیفِ سود منفی، و چون سمتِ هزینه
 * استخرِ «برگشته به لات» داشت و کم می‌آورد، «برگشت ایرادی» هم دروغ اعلام می‌شد و
 * `returnCostKept` پولِ ضررِ ساختگی می‌گذاشت.
 * دوم: تب ABC مخرجِ نسبت را «کل خط» می‌گرفت (`meta.qty`) و تب سود «ردیفِ فروشگاه» —
 * در خطِ مختلطِ انبار مرکزی دو تب دو عددِ متفاوت می‌دادند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s221-multi-return-cap.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-ret-cap-'))
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

const userId = seed.user('چندبرگشت')
seed.category('پالتو')
const p = seed.product('کاپشن زنانه')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})

/** ─────────── صحنهٔ ۱: ردیفِ ۵عددی، سه برگشت (۳ + ۲ + ۱) ─────────── */
const v1 = seed.variant(p, '50')
sql.prepare('UPDATE "ProductVariant" SET stock = 5, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v1)
const buy1 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1901,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
  goodsTotal: 5_000_000,
  discountTotal: 0,
  grandTotal: 5_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy1, variantId: v1, qty: 5, unitPrice: 1_000_000, lineTotal: 5_000_000 })
seed.insert('StockMovement', {
  variantId: v1,
  delta: 5,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy1,
  state: 'FINAL',
  createdAt: Date.now() - 10 * DAY
})
await costEngine.run()

const inv1 = seed.insert('SaleInvoice', {
  receiptNo: 961,
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
const line1 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv1,
  variantId: v1,
  qty: 5,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 15_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv1, saleItemId: line1, variantId: v1, sourceKind: 'STORE', qty: 5 })
seed.insert('StockMovement', {
  variantId: v1,
  delta: -5,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv1,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v1)
await costEngine.run()

/** سه برگشت: ۳ عدد و ۲ عدد به قفسه برگشته، ۱ عدد برنگشته (کلِ ردیف + ۱ عددِ اضافه). */
const mkReturn = (qty, restock, no) => {
  const ret = seed.insert('SaleReturn', {
    invoiceId: inv1,
    total: qty * 3_000_000,
    refundMethod: 'CASH',
    refundAmount: qty * 3_000_000,
    returnedAtJalali: today,
    returnedAtTime: '12:00:00',
    userId,
    shiftId,
    kind: 'RETURN',
    restockPending: 0
  })
  seed.insert('SaleReturnItem', {
    returnId: ret,
    saleItemId: line1,
    variantId: v1,
    qty,
    unitPrice: 3_000_000,
    lineTotal: qty * 3_000_000,
    restockedQty: restock
  })
  if (restock > 0) {
    seed.insert('StockMovement', {
      variantId: v1,
      delta: restock,
      reason: 'SALE_RETURN',
      refType: 'SaleReturn',
      refId: ret,
      state: 'FINAL',
      createdAt: Date.now() + no
    })
    sql.prepare('UPDATE "ProductVariant" SET stock = ? WHERE id = ?').run(restock, v1)
  }
  return ret
}
mkReturn(3, 3, 1)
mkReturn(2, 2, 2)
mkReturn(1, 0, 3)
await costEngine.run()

const prof = await profitService.profit({ fromJalali: today, toJalali: today })
// `revenue` در این برگه «پس از برگشت» است؛ باگ دقیقاً همین‌جا ردیف را منفی می‌کرد.
eq('درآمدِ پس از برگشت صفر می‌ماند، نه منفی (باگ: −۳م)', prof.revenue, 0)
eq('برگشتِ برگردانده‌شده از کلِ ردیف بیشتر نمی‌شود (باگ: ۱۸م روی ردیفِ ۱۵م)', prof.returnRevenue, 15_000_000)
eq('و «برگشت ایرادی» دروغ ساخته نمی‌شود (باگ: ۱ قلمِ ایرادیِ ساختگی با ۱م فی نگه‌داشته)', [prof.nonRestockedReturns, prof.returnCostKept], [0, 0])
eq('هزینه هم تا آخر کم می‌شود (۵ عددِ برگشته به لات)', prof.fifoCost, 0)
eq('سودِ خالص صفر است، نه منفی (باگ: −۳م)', prof.realProfit, 0)
eq('تعدادِ برگشتی همان ۶ می‌ماند (بیانِ همان ناهنجاری در داده، بدونِ دست‌کاریِ پول)', prof.returnedQty, 6)

/** ─────────── صحنهٔ ۲ (دیروز): خطِ مختلط — ABC و تب سود یک عدد باید بدهند ───────────
 * روی «دیروز» نشسته تا سرجمع‌های صحنهٔ ۱ با آن قاطی نشود؛ تب ABC پنجره‌اش ثابتِ ۹۰ روز
 * است و هر دو صحنه را می‌خواند، ولی ردیفش «به ازای کالا» است ⇒ مقایسه سرجمع نمی‌شود. */
const yday = toJalaliDate(new Date(Date.now() - DAY))
const p2 = seed.product('پالتو مردانه')
const v2 = seed.variant(p2, '52')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v2)
const buy2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1902,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
  goodsTotal: 3_000_000,
  discountTotal: 0,
  grandTotal: 3_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy2, variantId: v2, qty: 3, unitPrice: 1_000_000, lineTotal: 3_000_000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 3,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy2,
  state: 'FINAL',
  createdAt: Date.now() - 10 * DAY
})
await costEngine.run()

const inv2 = seed.insert('SaleInvoice', {
  receiptNo: 962,
  issuedAtJalali: yday,
  issuedAt: Date.now() - DAY,
  userId,
  shiftId,
  goodsTotal: 15_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 15_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const line2 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv2,
  variantId: v2,
  qty: 5,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 15_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv2, saleItemId: line2, variantId: v2, sourceKind: 'STORE', qty: 3 })
seed.insert('SaleItemStockAllocation', { invoiceId: inv2, saleItemId: line2, variantId: v2, sourceKind: 'WAREHOUSE', qty: 2 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: -3,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv2,
  state: 'FINAL',
  createdAt: Date.now() - DAY
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v2)
await costEngine.run()

const ret2 = seed.insert('SaleReturn', {
  invoiceId: inv2,
  total: 6_000_000,
  refundMethod: 'CASH',
  refundAmount: 6_000_000,
  returnedAtJalali: yday,
  returnedAtTime: '12:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: ret2,
  saleItemId: line2,
  variantId: v2,
  qty: 2,
  unitPrice: 3_000_000,
  lineTotal: 6_000_000,
  restockedQty: 2
})
seed.insert('StockMovement', {
  variantId: v2,
  delta: 2,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: ret2,
  state: 'FINAL',
  createdAt: Date.now() - DAY + 5
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v2)
await costEngine.run()

const prof2 = await profitService.profit({ fromJalali: yday, toJalali: yday })
// ردیفِ فروشگاه ۳ عدد است (۹م درآمد، ۳م فی)؛ برگشتِ ۲ عدد = دو سومِ همان ردیف.
eq('تب سود در خطِ مختلط: ۹م − ۶م درآمدِ پس از برگشت و سودِ ۲م', [prof2.revenue, prof2.realProfit], [3_000_000, 2_000_000])
const abc2 = await stockInsightService.abc({}, { withCost: true })
const row2 = (abc2.profitRows ?? []).find((r) => r.productId === p2)
eq('ABCِ همان کالا دقیقاً همان سود را می‌گوید (باگ: مخرجِ «کل خط» ⇒ ۳٫۶م ≠ ۲م)', row2?.realProfit, 2_000_000)
const row1 = (abc2.profitRows ?? []).find((r) => r.productId === p)
eq('و ردیفِ ABCِ صحنهٔ ۱ هم مثلِ تب سود صفر است', row1?.realProfit, prof.realProfit)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
