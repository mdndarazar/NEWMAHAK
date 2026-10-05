/**
 * بازبینی یازدهم · B10 (و کم‌اثر #2) — برگشتِ یک فاکتور که خودش بی‌اعتبار شده نباید
 * شمرده شود: «فروش» از `saleWhere` می‌آید که بی‌اعتبار/لغو را بیرون می‌گذارد، ولی سه‌جا
 * برگشت بدون این گارد خوانده می‌شد ⇒ یک فروشِ بی‌اعتبارشده دو بار از عدد کم می‌شد
 * (یکی با نبودنش، یکی با برگشتش). سه‌جا: تب سود (و ردیفِ تامین‌کننده)، «فروش خالص
 * ۳۰/۹۰ روزه»ی تب مانده، و بهای فروشِ تب خرید‌وفروش.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-voided-return-double.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-void-ret-'))
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

const userId = seed.user('بی‌اعتبار')
seed.category('کیف')
const p = seed.product('کیف دوشی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'k1')
sql.prepare('UPDATE "ProductVariant" SET stock = 4, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1801,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
  goodsTotal: 4_000_000,
  discountTotal: 0,
  grandTotal: 4_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 4, unitPrice: 1_000_000, lineTotal: 4_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 4,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now() - 10 * DAY
})

/** یک فاکتور ۴عددی (۱۲م درآمد، ۴م هزینه) که بعداً **بی‌اعتبار** می‌شود. */
const inv = seed.insert('SaleInvoice', {
  receiptNo: 951,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 12_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 12_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
const item1 = seed.insert('SaleInvoiceItem', {
  invoiceId: inv,
  variantId: v,
  qty: 4,
  unitPrice: 3_000_000,
  discount: 0,
  tax: 0,
  lineTotal: 12_000_000
})
seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: item1, variantId: v, sourceKind: 'STORE', qty: 4 })
seed.insert('StockMovement', {
  variantId: v,
  delta: -4,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: inv,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)
await costEngine.run()

/** برگشتِ ۲ عدد (سندِ برگشت معتبر است، فاکتورِ فروش بی‌اعتبار). */
const ret = seed.insert('SaleReturn', {
  invoiceId: inv,
  total: 6_000_000,
  refundMethod: 'CASH',
  refundAmount: 6_000_000,
  returnedAtJalali: today,
  returnedAtTime: '12:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: ret,
  saleItemId: item1,
  variantId: v,
  qty: 2,
  unitPrice: 3_000_000,
  lineTotal: 6_000_000,
  restockedQty: 2
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'SALE_RETURN',
  refType: 'SaleReturn',
  refId: ret,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()

/** حالا خودِ فاکتور فروش بی‌اعتبار می‌شود (حرکت‌ها سرِ جایشان می‌مانند — این رفتارِ SalesService است). */
sql.prepare('UPDATE "SaleInvoice" SET voidedAt = ? WHERE id = ?').run(Date.now(), inv)

// یک بار با بی‌اعتباری، یک بار با وضعیتِ لغو — هر دو باید یک عدد بدهند (گارد از saleWhere).
const prof = await profitService.profit({ fromJalali: today, toJalali: today })
eq('فاکتورِ بی‌اعتبار از درآمد رفته', prof.revenue, 0)
eq('و برگشتش نباید یک بار دیگر سود را منفی کند (باگ: −۲م سود و −۲م هزینه)', [prof.realProfit, prof.fifoCost], [0, 0])
eq('تعدادِ برگشت هم نباید شمرده شود', [prof.soldQty, prof.returnedQty], [0, 0])
eq('ردیفِ تامین‌کننده هم خالی است', (prof.bySupplier ?? []).reduce((a, s) => a + Number(s.realProfit || 0), 0), 0)

const buyTab = await stockInsightService.purchaseVsSale({}, { withCost: true })
eq('تب خرید‌وفروش: بهای فروشِ رفته صفر (باگ: −۲م می‌شد)', buyTab.fifoSoldCost, 0)

const st = await stockInsightService.stock({}, { withCost: false })
const vrow = st.rows.find((x) => x.variantId === v)
eq('تب مانده: فروش خالص ۹۰ روزه = صفر (بی‌اعتبار + برگشتِ بی‌اعتبار) — باگ: −۲', vrow?.netSold90, 0)
eq('و فروش خالص ۳۰ روزه هم منفی نمی‌شود', vrow?.netSold30, 0)

sql.prepare('UPDATE "SaleInvoice" SET voidedAt = NULL, status = ? WHERE id = ?').run('CANCELED', inv)
const prof2 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('با «لغو» هم همان صفرها می‌ماند (گاردِ وضعیت از همان saleWhere)', [prof2.revenue, prof2.realProfit, prof2.returnedQty], [0, 0, 0])
const st2 = await stockInsightService.stock({}, { withCost: false })
eq('تب مانده هم با «لغو» منفی نمی‌شود', st2.rows.find((x) => x.variantId === v)?.netSold90, 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
