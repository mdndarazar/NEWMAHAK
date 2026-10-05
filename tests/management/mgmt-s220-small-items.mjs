/**
 * بازبینی یازدهم · سه موردِ کم‌اثر که رفعشان بی‌خطر بود:
 * 1) «موارد کم‌اثر»: فاکتور خریدی که برای یک واریانت چند لات با فیِ متفاوت ساخته، فی
 *    «امروز» را به ترتیبِ ثبتِ خطوط گره می‌زد (اولین لات). حالا میانگینِ وزن‌دار است —
 *    همان کاری که `unitCostFromPurchase` برای خودِ لات می‌کند، پس «امروزِ» دو جای صفحه
 *    با هم نمی‌جنگد.
 * 2) نقطهٔ ضعف #2: «دقت فی» فقط با *تعدادِ قلم* گرفته می‌شد؛ یک قلمِ گرانِ تقریبی می‌تواند
 *    درصدِ قلم‌ها را دست‌نخورده بگذارد ولی بیشترِ پول را نامطمئن کند ⇒ `exactPctRial`.
 * 3) B11: جعبهٔ «دسته» روی تب‌هایی که فیلتر را نمی‌خوانند فعال/هایلایت می‌ماند؛ تستِ
 *    بستنِ فهرستِ UI به سرویس‌ها (اگر روزی `sizeCurve` دسته‌فیلتر شد، همین‌جا می‌گوید
 *    فهرستِ `CAT_INERT_TABS` را هم به‌روز کن).
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s220-small-items.mjs
 */
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-small-220-'))
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

const userId = seed.user('کم‌اثر')
const cat = seed.category('سرآشیزه')
const p = seed.product('قاب گوشی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})

/* ---------- 1) میانگینِ وزن‌دار به‌جای «اولین لات» ---------- */
const vA = seed.variant(p, 'order-1')
const vB = seed.variant(p, 'order-2')
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1901,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 8_000_000,
  discountTotal: 0,
  grandTotal: 8_000_000,
  status: 'CONFIRMED'
})
for (const vv of [vA, vB]) {
  seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: vv, qty: 2, unitPrice: 2_000_000, lineTotal: 4_000_000 })
  sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 5000000, purchasePrice = 2000000 WHERE id = ?').run(vv)
}
// دو لاتِ هم‌فاکتور با فی‌های مختلف — فقط ترتیبِ درج‌شان فرق می‌کند.
const lot = (variantId, unit) =>
  seed.insert('PurchaseLot', { variantId, qtyIn: 1, qtyLeft: 1, unitCost: unit, lotDate: Date.now() - 2 * DAY, source: 'PURCHASE', purchaseInvoiceId: buy, approx: 0 })
lot(vA, 3_000_000)
lot(vA, 1_000_000)
lot(vB, 1_000_000)
lot(vB, 3_000_000)
const st = await stockInsightService.stock({}, { withCost: true })
const stA = st.rows.find((x) => x.variantId === vA)
const stB = st.rows.find((x) => x.variantId === vB)
eq('واریانت A (لاتِ گران‌تر اول درج شده): فیِ امروز = میانگین', stA?.replacementValue, 4_000_000)
eq('واریانت B (ترتیبِ برعکس): همان عدد', stB?.replacementValue, 4_000_000)
eq('پس «امروز» به ترتیبِ خطوطِ فاکتور گره خورده نیست', [stA?.replacementValue, stB?.replacementValue], [4_000_000, 4_000_000])

/* ---------- 2) دقتِ فی به ریال ---------- */
const pC = seed.product('چراغ قوه')
const pD = seed.product('ژنراتور')
const vC = seed.variant(pC, 'cheap')
const vD = seed.variant(pD, 'dear')
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 1500000, purchasePrice = 1000000 WHERE id = ?').run(vC)
const buyC = seed.insert('PurchaseInvoice', {
  invoiceNo: 1902,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 5 * DAY)),
  issuedAt: Date.now() - 5 * DAY,
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyC, variantId: vC, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', { variantId: vC, delta: 1, reason: 'PURCHASE', refType: 'PurchaseInvoice', refId: buyC, state: 'FINAL', createdAt: Date.now() - 5 * DAY })
// ژنراتور: موجودیِ دستیِ پنل کالا (بی‌فاکتور) ⇒ فی از کارتِ کالا، با برچسب تقریبی.
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 11000000, purchasePrice = 2000000 WHERE id = ?').run(vD)
seed.insert('StockMovement', { variantId: vD, delta: 1, reason: 'PURCHASE', refType: null, refId: null, state: 'FINAL', createdAt: Date.now() - 4 * DAY })

const inv2 = seed.insert('SaleInvoice', {
  receiptNo: 961,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 12_500_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 12_500_000,
  deductInventory: true,
  status: 'SETTLED'
})
for (const [vv, price] of [
  [vC, 1_500_000],
  [vD, 11_000_000]
]) {
  const it = seed.insert('SaleInvoiceItem', {
    invoiceId: inv2,
    variantId: vv,
    qty: 1,
    unitPrice: price,
    discount: 0,
    tax: 0,
    lineTotal: price
  })
  seed.insert('SaleItemStockAllocation', { invoiceId: inv2, saleItemId: it, variantId: vv, sourceKind: 'STORE', qty: 1 })
  seed.insert('StockMovement', { variantId: vv, delta: -1, reason: 'SALE', refType: 'SaleInvoice', refId: inv2, state: 'FINAL', createdAt: Date.now() })
}
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id IN (?, ?)').run(vC, vD)
await costEngine.run()
const prof = await profitService.profit({ fromJalali: today, toJalali: today })
const stat = sql
  .prepare('SELECT saleItemId, costStatus FROM "SaleItemCost" ORDER BY id ASC')
  .all()
  .map((r) => r.costStatus)
  .sort()
eq('یک قلم EXACT و یک قلم APPROX', stat, ['APPROX', 'EXACT'])
eq('درصدِ تعدادِ قلم‌ها: نصف', Math.round(prof.exactPct * 1000) / 1000, 0.5)
eq('درصدِ ریالی (بیشترِ پول از قلمِ تقریبی است) — باگ: این عدد نبود', Math.round(prof.exactPctRial * 1000) / 1000, 0.12)

/* ---------- 3) B11: فهرستِ تب‌های بی‌اثر در UI ---------- */
const ui = readFileSync(new URL('../../src/renderer/src/pages/ManagementReports.tsx', import.meta.url), 'utf-8')
const listLine = (ui.match(/const CAT_INERT_TABS = \[[^\]]*\]/) ?? [''])[0]
// بازبینی دوازدهم (B2) — «سایز» این‌جا اشتباهِ خودِ من بود: `sizeCurve` همان
// `stock(filter)` را صدا می‌زند و `stock()` دسته را اعمال می‌کند، پس تب بی‌اثر نیست؛
// فهرستِ UI باید درستِ زنجیرهٔ صدا زدن را بگوید. تستِ رفتاریِ تازه:
// tests/management/mgmt-s221-size-category.mjs
for (const t of ['trend', 'mix', 'compare', 'staff', 'heat', 'buy']) {
  eq(`فهرستِ «دسته در این تب بی‌اثر است» «${t}» را دارد`, listLine.includes(`'${t}'`), true)
}
eq('«سایز» بی‌اثر نیست (فیلترِ دسته را می‌خواند) — باگِ نشستِ قبل', listLine.includes(`'size'`), false)
eq('و تب‌های دسته‌بندی/سود/ABC/مانده در این فهرست نیستند (فیلترشان کار می‌کند)', ['profit', 'category', 'abc', 'stock'].every((t) => !listLine.includes(`'${t}'`)), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
