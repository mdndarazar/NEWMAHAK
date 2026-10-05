/**
 * بازبینی یازدهم · B2 (بحرانی) — جنسی که فی ندارد (موجودیِ دستیِ پنل کالا بدون فاکتور
 * خرید) نباید با «سود = ۱۰۰٪» داخل سود بیاید. تا امروز لاتِ `NO_INVOICE` با فی صفر
 * برچسب `approx` می‌گرفت و یادداشتِ صفحه («N قلم فی صفر داشت و از سود کنار گذاشته شد»)
 * دروغ می‌شد. قاعدهٔ درست همان گاردِ موجود است: فی صفر ⇒ `UNKNOWN` ⇒ بیرون از سود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-zero-cost-lot-unknown.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-zero-fee-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
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

const userId = seed.user('بی‌فی')
seed.category('جوراب')
const p = seed.product('جوراب مردانه')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'free')
// موجودی اول از پنل کالا: فی کارت = ۰، بدون هیچ فاکتور خریدی.
sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 3000000, purchasePrice = 0 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: null,
  refId: null,
  state: 'FINAL',
  createdAt: Date.now() - 30 * DAY
})

const saleDay = Date.now() - 20 * DAY
const inv = seed.insert('SaleInvoice', {
  receiptNo: 901,
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
await costEngine.run()

const r = sql.prepare('SELECT qty, fifoCost, revenue, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('ردیف ساخته شد ولی با هزینهٔ صفر', [Number(r.qty), Number(r.fifoCost), Number(r.revenue)], [2, 0, 6_000_000])
eq('وضعیتش UNKNOWN است، نه APPROX (باگ: فی صفر «تقریبی» خوانده می‌شد)', r.costStatus, 'UNKNOWN')

const month = toJalaliDate(new Date(saleDay)).slice(0, 7)
const prof = await profitService.profit({ fromJalali: `${month}/01`, toJalali: `${month}/31` })
eq('این قلم از سود بیرون است، نه حاشیهٔ ۱۰۰٪ (باگ: ۶م سود می‌شد)', [prof.revenue, prof.realProfit], [0, 0])
eq('شمرندهٔ قلم‌های بی‌فی', prof.zeroCostCount, 1)
eq(
  'یادداشتِ «فی صفر کنار گذاشته شد» واقعاً می‌آید',
  (prof.notes ?? []).some((n) => String(n).includes('فی صفر')),
  true
)

/**
 * راستی‌آزماییِ «خود-ترمیمی»: ادیتِ دستیِ موجودی (آن ردیفِ بی‌فاکتور) برداشته می‌شود و
 * جایش فاکتور خریدِ **قدم‌تر از همان فروش** می‌آید؛ بعد از بازسازی قلم برمی‌گردد توی سود.
 */
sql.prepare('DELETE FROM "StockMovement" WHERE variantId = ? AND reason = ? AND refId IS NULL').run(v, 'PURCHASE')
const buyDay = Date.now() - 35 * DAY
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1490,
  issuedAtJalali: toJalaliDate(new Date(buyDay)),
  issuedAt: buyDay,
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
  createdAt: buyDay
})
await costEngine.rebuild()
const r2 = sql.prepare('SELECT fifoCost, costStatus FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('بعد از فاکتورِ تاریخ‌گذشته: فی از لاتِ ۱ میلیونی خوانده شد', Number(r2.fifoCost), 2_000_000)
eq(
  'دیگر UNKNOWN نیست (بدهی با فیِ همان فاکتور بسته شد) و به سود برگشته',
  r2.costStatus !== 'UNKNOWN',
  true
)
const prof2 = await profitService.profit({ fromJalali: `${month}/01`, toJalali: `${month}/31` })
eq('سود همان ۴ میلیون شد', [prof2.revenue, prof2.realProfit, prof2.zeroCostCount], [6_000_000, 4_000_000, 0])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
