/**
 * بازبینی نهم · B10 + «نرخ فروش» — اگر بازه با «تا تاریخِ» گذشته بسته شده باشد،
 * آخرین فروش/خرید هم باید تا همان لحظه خوانده شود. قبلاً فروش ۳۰/۹۰ روزه نسبت به
 * تاریخِ بسته بود ولی «آخرین فروش» نسبت به **امروز**، پس کالایی که بعد از آن تاریخ
 * فروخته شده «خواب ۰ روز» می‌خورد و هیچ‌وقت پیشنهاد حراج نمی‌گرفت.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-stock-assof-sellthrough.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-stock-asof-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const DAY = 86400_000
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: 1,
  staffConfirmed: 1
})
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cat = seed.category('لباس')
const p1 = seed.product('پالتو زمستانه', cat)
const p2 = seed.product('شال گردن', cat)
const v1 = seed.variant(p1, 'L')
const v2 = seed.variant(p2, 'یک‌سایز')

/** خریدِ ۱۰۰ روز پیش (برای اینکه «بدون فروش» هم سنجه شود) و خریدِ پالتو ۷۰ روز پیش. */
const mkBuy = (variantId, qty, daysAgo) => {
  const at = Date.now() - daysAgo * DAY
  const inv = seed.insert('PurchaseInvoice', {
    invoiceNo: 100 + variantId + daysAgo,
    issuedAtJalali: toJalaliDate(new Date(at)),
    issuedAt: at,
    goodsTotal: qty * 500_000,
    discountTotal: 0,
    grandTotal: qty * 500_000,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: inv, variantId, qty, unitPrice: 500_000, lineTotal: qty * 500_000 })
  seed.insert('StockMovement', {
    variantId,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: at
  })
  return inv
}
mkBuy(v1, 6, 80)
mkBuy(v2, 3, 100)
sql.prepare('UPDATE "ProductVariant" SET stock = 6, salePrice = 2000000, purchasePrice = 500000 WHERE id = ?').run(v1)
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 700000, purchasePrice = 500000 WHERE id = ?').run(v2)
await costEngine.run()

/** یک فروشِ ۷۰ روز پیش (فاکتور و حرکتش هم به همان تاریخ می‌روند). */
const mkSale = async (variantId, qty, daysAgo) => {
  await salesService.create({
    userId: 1,
    shiftId,
    lines: [{ variantId, qty, unitPrice: 2_000_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: qty * 2_000_000, destination: 'CASH' }]
  })
  await costEngine.run()
  const id = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
  const at = Date.now() - daysAgo * DAY
  if (daysAgo > 0) {
    sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(at, toJalaliDate(new Date(at)), id)
  }
  // «تبلی که ستون خواب را می‌خواند فقط حرکت FINAL را می‌بیند؛ در برنامهٔ واقعی هنگام
  // قطعی‌شدنِ سند همین حرکت FINAL می‌شود، هارنسِ تست آن را PENDING می‌گذارد.
  sql
    .prepare(`UPDATE "StockMovement" SET state = 'FINAL', createdAt = ? WHERE reason = 'SALE' AND refType = 'SaleInvoice' AND refId = ?`)
    .run(at, id)
  return id
}
await mkSale(v1, 1, 70)
// ماندهٔ پالتو: ۶ − ۱ = ۵ → بعد از فروشِ امروز ۴
sql.prepare('UPDATE "ProductVariant" SET stock = 5 WHERE id = ?').run(v1)
// شال گردن هرگز فروخته نشده و بعد از انبارگردانی موجودش صفر شده (دادهٔ دستِ ما)
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v2)

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

const yesterday = toJalaliDate(new Date(Date.now() - DAY))
const past = await stockInsightService.stock({ toJalali: yesterday }, { withCost: true })
const rowOf = (res, id) => res.rows.find((r) => Number(r.variantId) === id)
const rPast = rowOf(past, v1)
eq('بازهٔ بسته‌شده تشخیص داده می‌شود', [past.asOfPast, past.asOfDate], [true, yesterday])
eq('فروشِ امروز در فروش ۹۰ روزهٔ دیروز شمرده نشده', rPast.netSold90, 1)
eq('«خواب» هم تا همان تاریخ است — باگ B10: صفر می‌شد (فروشِ امروز مبناء بود)', rPast.sleepDays > 60, true)
eq('نرخ فروش ۹۰ روزه = رفته ÷ (رفته + مانده) = ۱ از ۶', rPast.sellThrough, 17)
eq('و برچسب حراج روی کالای خوابیده می‌آید', rPast.clearance, 'خوابیده — حراج')
eq('شمارشِ بالای تب هم همان را می‌گوید', past.clearanceCount, 1)
eq('برچسب توضیح می‌دهد پیشنهاد فقط یک علامت است', String(past.clearanceLabel || '').includes('قیمت را ما عوض نمی‌کنیم'), true)
eq('یادداشت می‌گوید موجودی ذاتاً «همین حالا» است', String(past.note || '').includes('موجودی ذاتاً'), true)

const rZero = rowOf(past, v2)
eq('ماندهٔ صفر: بهای جایگزینی صفر است، نه کوئریِ فی', [rZero.stock, rZero.replacementValue], [0, 0])
eq('برچسب «تقریبی» روی صفر معنی ندارد', rZero.approx, false)
eq('هرگز فروخته‌نشده علامت می‌خورد', rZero.neverSold, true)
eq('ولی با ماندهٔ صفر پیشنهاد حراج نمی‌دهد', rZero.clearance, null)

const now = await stockInsightService.stock({}, { withCost: true })
const rNow = rowOf(now, v1)
eq('تا قبل از ثبت فروشِ تازه، نمای «امروز» هم همان یک فروش را دارد', rNow.netSold90, 1)
eq('امروز هنوز فروشِ تازه‌ای ثبت نشده ⇒ همان عددها', [rNow.sleepDays > 60, rNow.sellThrough, rNow.clearance], [true, 17, 'خوابیده — حراج'])
eq('و «تا تاریخ» امروز یعنی بازه بسته نیست، ولی برچسب حراج به همین حالت ربطی ندارد', [now.asOfPast, now.clearanceCount], [false, 1])

/** حالا فروشِ امروز را ثبت می‌کنیم: نمای «دیروز» نباید تکان بخورد. */
await mkSale(v1, 1, 0)
sql.prepare('UPDATE "ProductVariant" SET stock = 4 WHERE id = ?').run(v1)
const past2 = await stockInsightService.stock({ toJalali: yesterday }, { withCost: true })
const now2 = await stockInsightService.stock({}, { withCost: true })
eq('نمای دیروز با فروشِ امروز عوض نشد (باگ B10: خواب صفر می‌شد)', [rowOf(past2, v1).netSold90, rowOf(past2, v1).sellThrough], [1, 20])
eq('و خوابِ دیروز همچنان بیش از ۶۰ روز است', rowOf(past2, v1).sleepDays > 60, true)
eq('نمای امروز هر دو فروش را می‌بیند', [rowOf(now2, v1).netSold90, rowOf(now2, v1).sellThrough], [2, 33])
eq('امروز دیگر کالای خوابیده محسوب نمی‌شود (نرخ فروش بالای ۲۵٪)', rowOf(now2, v1).clearance, null)
eq('خوابِ امروز صفر است، چون همین حالا فروخته شده', rowOf(now2, v1).sleepDays, 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
