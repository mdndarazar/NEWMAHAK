/**
 * بازبینی یازدهم · B1 (بحرانی) — فی جایگزینیِ یک قلمِ فروخته‌شده باید «آخرین فاکتور خرید
 * **تا تاریخ همان فروش**» باشد، نه آخرین فاکتورِ لحظه‌ای که دفتر به قلم رسید.
 * صحنهٔ گزارش: خرید با فی ۱م → فروش (تب سود باز نشد) → خریدِ گران‌تر → حالا دفتر به
 * این قلم می‌رسد و جایگزینی را با فیِ **امروز** می‌بندد؛ «سود تورمی» ماه‌های گذشته با
 * هر بار رسیدن دفتر عوض می‌شود. مسیرِ قابل‌تکرارِ همین در این برنامه «ویرایشِ یک قلمِ
 * قدیمی» است: ردیفِ یَتیم با ردیفِ تازه جفت نمی‌شود (سهمِ فروشگاه عوض شده) ⇒ قلم از نو
 * قفل می‌شود و فیِ جایگزینی‌اش فیِ امروز می‌نشیند، نه فیِ روزِ خودش.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-replacement-asof-lock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-asof-lock-'))
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

const userId = seed.user('تورم')
seed.category('کاپشن')
const p = seed.product('کاپشن زمستانه')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

/** خرید ۲ عدد با فی ۱ میلیون — ۴۰ روز پیش. */
const mkBuy = (qty, unit, daysAgo) => {
  const at = Date.now() - daysAgo * DAY
  const inv = seed.insert('PurchaseInvoice', {
    invoiceNo: 1400 + daysAgo,
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
mkBuy(2, 1_000_000, 40)
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v)
await costEngine.run()

/** فروشِ ۲۰ روز پیش (تب سود باز نشده): ۲ عدد × ۳ میلیون. */
const saleDay = Date.now() - 20 * DAY
const inv = seed.insert('SaleInvoice', {
  receiptNo: 881,
  issuedAtJalali: toJalaliDate(new Date(saleDay)),
  issuedAt: saleDay,
  userId,
  shiftId,
  goodsTotal: 6_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 6_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item1 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 2,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 6_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: item1, variantId: v, sourceKind: 'STORE', qty: 2 })
seed.insert('StockMovement', {
  variantId: v,
  delta: -2,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv,
  state: 'FINAL',
  createdAt: saleDay
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)

/** بعد از آن فروش، خریدِ تازه با فی ۲ میلیون (۵ روز پیش) — «امروز» شده ۲م. */
mkBuy(3, 2_000_000, 5)
sql.prepare('UPDATE "ProductVariant" SET stock = 3 WHERE id = ?').run(v)
await costEngine.run()

const row = () =>
  sql.prepare('SELECT qty, revenue, fifoCost, replacementCost, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
const r = row()
eq('قلم قفل شد (۲ عدد، درآمد ۶م)', [Number(r.qty), Number(r.revenue)], [2, 6_000_000])
eq('FIFO همان لاتِ ۱ میلیونی', Number(r.fifoCost), 2_000_000)
eq(
  'جایگزینی = آخرین خرید **تا تاریخ همان فروش** (۱م)، نه فیِ امروز (باگ: ۴م)',
  Number(r.replacementCost),
  2_000_000
)
const month = toJalaliDate(new Date(saleDay)).slice(0, 7)
const prof = await profitService.profit({ fromJalali: `${month}/01`, toJalali: `${month}/31` })
eq('سود واقعی همان ماه', prof.realProfit, 4_000_000)
eq('سود جایگزینی هم همان (باگ: ۲م می‌شد)', prof.replacementProfit, 4_000_000)
eq('«سود تورمی» این ماه صفر است: گران‌شدن بعد از فروش، تورمِ آن فروش نیست', prof.inflationOnSold, 0)

/** با «بازسازی دفتر» عددِ تاریخچه نباید جابه‌جا شود — همین، idempotent بودنِ دفتر است. */
const before = row()
await costEngine.rebuild()
const after = row()
eq(
  'بازسازی همان عدد را داد (باگ: جایگزینی ۴م و تورم ۲م می‌شد)',
  [Number(after.replacementCost), Number(after.fifoCost), Number(after.revenue)],
  [Number(before.replacementCost), Number(before.fifoCost), Number(before.revenue)]
)
eq('و وضعیتِ قلم هم دست‌نخورده ماند', after.costStatus, before.costStatus)

/** قاعدهٔ مالک دست‌نخورده: فروشِ **همین امروز** با فیِ امروز (=۲م) قفل می‌شود. */
const inv2 = seed.insert('SaleInvoice', {
  receiptNo: 882,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 4_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 4_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item2 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv2,
  variantId: v,
  qty: 1,
  unitPrice: 4_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 4_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv2, saleItemId: item2, variantId: v, sourceKind: 'STORE', qty: 1 })
seed.insert('StockMovement', {
  variantId: v,
  delta: -1,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv2,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v)
await costEngine.run()
const r2 = sql
  .prepare('SELECT qty, replacementCost, fifoCost FROM "SaleItemCost" WHERE saleItemId = ?')
  .get(item2)
eq('فروشِ امروز: جایگزینی با فیِ امروز (۲م) و FIFO از لاتِ خودش', [Number(r2.replacementCost), Number(r2.fifoCost)], [2_000_000, 2_000_000])

/**
 * قلبِ تست: همان فاکتورِ ۲۰ روز پیش ویرایش می‌شود و سهمِ فروشگاه عوض می‌کند (۲ → ۱ عدد)
 * ⇒ جفت‌شدنِ یتیم ناممکن است ⇒ دفتر قلم را از نو قفل می‌کند. فیِ جایگزینی باید فیِ
 * «روزِ همان فروش» (۱م) باشد؛ کدِ قدیمی فیِ امروز (۲م) را می‌گذاشت و «سود تورمی» یک
 * ماهِ گذشته را از +۱م به −۱م عوض می‌کرد — فقط به این دلیل که دفتر دیر رسید.
 */
sql.prepare('UPDATE "SaleItemStockAllocation" SET qty = 1 WHERE saleItemId = ? AND sourceKind = ?').run(item1, 'STORE')
sql.prepare('UPDATE "SaleInvoiceItem" SET qty = 1, unitPrice = 3000000, lineTotal = 3000000 WHERE id = ?').run(item1)
sql.prepare('UPDATE "SaleInvoice" SET goodsTotal = 3000000, grandTotal = 3000000 WHERE id = ?').run(inv)
sql.prepare(`DELETE FROM "SaleItemCost" WHERE saleItemId = ?`).run(item1)
sql.prepare(`DELETE FROM "CostConsumption" WHERE saleItemId = ? AND kind = 'SALE'`).run(item1)
await costEngine.run()
const r3 = sql.prepare('SELECT qty, revenue, fifoCost, replacementCost FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('قلم از نو با سهمِ تازه بسته شد (۱ عدد، درآمد ۳م)', [Number(r3.qty), Number(r3.revenue)], [1, 3_000_000])
eq('و فیِ لاتِ واقعیِ همان واحد (۲م) مصرف شد', Number(r3.fifoCost), 2_000_000)
eq(
  'جایگزینی = فیِ روزِ همان فروش: ۱م (باگ: ۲م — یعنی تورمِ امروز به ماهِ گذشته منتسب شد)',
  Number(r3.replacementCost),
  1_000_000
)
const prof3 = await profitService.profit({ fromJalali: `${month}/01`, toJalali: `${month}/31` })
eq('«سود تورمی» همان ماه: −۱ میلیون (باگ: +۱ میلیون)', prof3.inflationOnSold, -1_000_000)
eq('سود واقعی ۱م و سود جایگزینی ۲م — هر دو با قفلِ روزِ خودشان', [prof3.realProfit, prof3.replacementProfit], [1_000_000, 2_000_000])

/** ارزشِ *ماندهٔ* قفسه همچنان «امروز» است: دو عددِ مانده (ستونِ موجودی) × فیِ امروز. */
const st = await stockInsightService.stock({}, { withCost: true })
const vrow = st.rows.find((x) => x.variantId === v)
eq('ارزش جایگزینیِ مانده با فیِ امروز (نه فیِ روزِ فروش)', vrow?.replacementValue, 4_000_000)
eq('و جمعِ «روی صفحه» با ردیف‌های خودش می‌خواند (B9)', st.totalReplacement, st.rows.reduce((a, b) => a + (b.replacementValue ?? 0), 0))

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
