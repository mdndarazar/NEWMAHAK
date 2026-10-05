/**
 * B1 — اصلاح فی فاکتور خرید باید «سود جایگزینی» فروش قفل‌شده را هم هم‌راستا کند،
 * نه فقط FIFO را. وگرنه صفحه سود «سود تورمی» منفیِ بی‌معنی نشان می‌دهد.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-reprice-replacement.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-repl-'))
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

const buyId = seed.insert('PurchaseInvoice', {
  invoiceNo: 88,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 100000,
  discountTotal: 0,
  grandTotal: 100000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyId, variantId: v, qty: 1, unitPrice: 100000, lineTotal: 100000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyId,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 100000, salePrice = 2000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()

const before = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از اصلاح: سود واقعی با فی ۱۰۰هزار', before.realProfit, 1_900_000)
eq('قبل از اصلاح: سود جایگزینی همان است (یک خرید، دو نگاه برابر)', before.replacementProfit, 1_900_000)
eq('قبل از اصلاح: تورم صفر', before.inflationOnSold, 0)

sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1000000, grandTotal = 1000000 WHERE id = ?').run(buyId)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1000000, lineTotal = 1000000 WHERE invoiceId = ?').run(buyId)
const r = await costEngine.repricePurchase(buyId)
eq('اصلاح فی یک لات را بازنویسی کرد', r.updated, 1)
eq('یک قلم فروش قفل‌شده لمس شد', r.saleItems, 1)
eq('یک قلم هم در جایگزینی هم‌راستا شد', r.replacementFixed, 1)
eq('هیچ قلمی بی‌هم‌راستایی ول نشد', r.replacementStale, 0)

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('بعد از اصلاح: سود واقعی ۱ میلیون شد', after.realProfit, 1_000_000)
eq('بعد از اصلاح: سود جایگزینی هم ۱ میلیون شد (باگ B1)', after.replacementProfit, 1_000_000)
eq('بعد از اصلاح: تورم منفیِ بی‌معنی ساخته نشد', after.inflationOnSold, 0)
eq('بعد از اصلاح: هزینه جایگزینی ۱ میلیون', after.replacementCost, 1_000_000)

const st = await costEngine.status()
eq('وضعیت دفتر، خلاصهٔ آخرین اصلاح فی را نگه می‌دارد', st.lastReprice?.replacementFixed, 1)
eq('هیچ یادآوری «دست‌نخورده» روی این داده لازم نیست', st.lastReprice?.replacementStale, 0)
const notes = (after.notes ?? []).join(' | ')
eq('وقتی همه‌چیز هم‌راستاست، یادآوری «بازسازی» روی صفحه نمی‌آید', notes.includes('بازسازی دفتر هزینه» یکدستش می‌کند'), false)

// ————— سناریوی دوم: ایمنی — فی جایگزینیِ لاتِ «آخری‌نبودن» نباید دست بخورد —————
// یک واریانت دیگر با دو فاکتور خرید: A (ارزان، قدیمی) و B (گراناتر، جدیدترین).
// قلم فروش با فی B قفل می‌شود. حالا A را گران کنیم: FIFO اصلاح می‌شود، ولی
// «آخرین فاکتور خرید» همچنان B است ⇒ فی جایگزینی باید همان ۱۵۰هزار بماند.
const pD = seed.product('کت')
const v2 = seed.variant(pD, '48')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 0 WHERE id = ?').run(v2)
const invA = seed.insert('PurchaseInvoice', {
  invoiceNo: 91,
  issuedAtJalali: today,
  issuedAt: Date.now() - 40 * 86400_000,
  goodsTotal: 100000,
  discountTotal: 0,
  grandTotal: 100000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: invA, variantId: v2, qty: 1, unitPrice: 100000, lineTotal: 100000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: invA,
  state: 'FINAL',
  createdAt: Date.now() - 40 * 86400_000
})
const invB = seed.insert('PurchaseInvoice', {
  invoiceNo: 92,
  issuedAtJalali: today,
  issuedAt: Date.now() - 10 * 86400_000,
  goodsTotal: 150000,
  discountTotal: 0,
  grandTotal: 150000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: invB, variantId: v2, qty: 1, unitPrice: 150000, lineTotal: 150000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: invB,
  state: 'FINAL',
  createdAt: Date.now() - 10 * 86400_000
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2, purchasePrice = 150000 WHERE id = ?').run(v2)
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v2, qty: 1, unitPrice: 3_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 3_000_000, destination: 'CASH' }]
})
await costEngine.run()
const c2Before = await db.$harness.db
  .prepare('SELECT fifoCost, replacementCost FROM "SaleItemCost" WHERE variantId = ?')
  .get(v2)
const v2Before = { fifo: Number(c2Before.fifoCost), repl: Number(c2Before.replacementCost) }
eq('قلم دوم با فی لاتِ قدیمی‌تر FIFO شده', v2Before.fifo, 100000)
eq('قلم دوم فی جایگزینی‌اش از آخرین فاکتور (B) است', v2Before.repl, 150000)

sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1000000, grandTotal = 1000000 WHERE id = ?').run(invA)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1000000, lineTotal = 1000000 WHERE invoiceId = ?').run(invA)
const r2 = await costEngine.repricePurchase(invA)
eq('FIFO قلم دوم اصلاح شد', r2.saleItems, 1)
eq('و عدد جایگزینی‌اش بازنویسی نشد (لاتِ B همچنان آخرین است)', r2.replacementFixed, 0)
const c2After = await db.$harness.db
  .prepare('SELECT fifoCost, replacementCost FROM "SaleItemCost" WHERE variantId = ?')
  .get(v2)
eq('fifoCost = ۱٫۰۰۰٫۰۰۰ شد', Number(c2After.fifoCost), 1000000)
eq('replacementCost دست‌نخورده ماند (۱۵۰٫۰۰۰)', Number(c2After.replacementCost), 150000)
const after2 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('تورم قلم دوم منفیِ ساختگی نشد (جایگزینی ۱۵۰هزار − فی‌فکت ۱میلیون = −۸۵۰هزارِ واقعی)', after2.inflationOnSold, -850000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
