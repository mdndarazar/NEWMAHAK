/**
 * بازبینی نهم · B1 — اصلاح فی یک فاکتور خریدِ **کهنه** باید فی جایگزینیِ فروش‌های
 * قفل‌شدهٔ همان فاکتور را هم درست کند، حتی اگر بعد از آن فروش، فاکتور خریدِ
 * تازه‌تری وجود داشته باشد. قبلاً قاعدهٔ «قبل/بعد» روی خروجیِ «آخرین فاکتور» سنجیده
 * می‌شد، پس با P2 وسطِ کار، `units` خالی می‌ماند: FIFO اصلاح می‌شد ولی جایگزینی روی
 * فیِ غلطِ قدیمی می‌مرد و «سود تورمی» منفیِ بی‌معنی می‌ساخت و صفحه هم چیزی نمی‌گفت.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-reprice-old-invoice-replacement.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-old-'))
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

const userId = seed.user('فی')
const cat = seed.category('پالتو')
const p = seed.product('پالتو کلاسیک')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '50')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 5000000, purchasePrice = 0 WHERE id = ?').run(v)

/** P1 — خریدِ کهنه با فی اشتباه (تایپ: ۱٫۰ میلیون، درست ۱٫۱ میلیون). */
const p1 = seed.insert('PurchaseInvoice', {
  invoiceNo: 700,
  issuedAtJalali: today,
  issuedAt: Date.now() - 30 * DAY,
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: p1, variantId: v, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: p1,
  state: 'FINAL',
  createdAt: Date.now() - 30 * DAY
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 1000000 WHERE id = ?').run(v)
await costEngine.run()

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 5_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 5_000_000, destination: 'CASH' }]
})
await costEngine.run()
const inv1 = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const item1 = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(inv1).id)

/** P2 — خریدِ تازه‌تر و گران‌تر؛ از این به بعد «قاعدهٔ امروز» = ۲٫۰ میلیون. */
const p2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 701,
  issuedAtJalali: today,
  issuedAt: Date.now() - DAY,
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: p2, variantId: v, qty: 1, unitPrice: 2_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: p2,
  state: 'FINAL',
  createdAt: Date.now() - DAY
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 2000000 WHERE id = ?').run(v)
await costEngine.run()

const costOf = (id) => {
  const r = sql.prepare('SELECT fifoCost, replacementCost FROM "SaleItemCost" WHERE saleItemId = ?').get(id)
  return r ? { fifo: Number(r.fifoCost), repl: Number(r.replacementCost) } : null
}
eq('قلمِ قفل‌شده فی جایگزینی‌اش از P1 (لحظهٔ قفل) است', costOf(item1), { fifo: 1_000_000, repl: 1_000_000 })

// ————— اصلاح فیِ همان فاکتور کهنه —————
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1100000, grandTotal = 1100000 WHERE id = ?').run(p1)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1100000, lineTotal = 1100000 WHERE invoiceId = ?').run(p1)
const r = await costEngine.repricePurchase(p1)
eq('یک لات بازنویسی شد', r.updated, 1)
eq('یک قلم فروش لمس شد', r.saleItems, 1)
eq('و همان قلم در جایگزینی هم هم‌راستا شد (باگ B1: صفر می‌شد)', r.replacementFixed, 1)
eq('هیچ قلمِ دست‌نخورده‌ای نماند، پس یاداورِ دروغ لازم نیست', r.replacementStale, 0)
eq('FIFO به ۱٫۱ میلیون رفت', costOf(item1).fifo, 1_100_000)
eq('جایگزینی هم به ۱٫۱ میلیون رفت (نه ۲ میلیون — قاعدهٔ «فی لحظهٔ قفل» می‌ماند)', costOf(item1).repl, 1_100_000)

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('سود واقعی', after.realProfit, 3_900_000)
eq('سود جایگزینی با همان اصلاح جابه‌جا شد', after.replacementProfit, 3_900_000)
eq('«سود تورمی» منفیِ بی‌معنی ساخته نشد (باگ: ۱٫۰م − ۱٫۱م = −۱۰۰هزار)', after.inflationOnSold, 0)

const st = await costEngine.status()
eq('یادآوریِ صفحه هم همین عدد را می‌گوید', st.lastReprice?.replacementFixed, 1)
eq('و «دست‌نخورده» صفر است', st.lastReprice?.replacementStale, 0)

// ————— ایمنی: قلمی که فی‌اش از فاکتورِ دیگری آمده نباید دست بخورد —————
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 5_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 5_000_000, destination: 'CASH' }]
})
await costEngine.run()
const inv2 = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const item2 = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(inv2).id)
eq('قلم دوم از لات P2 فی گرفته (هر دو نگاه ۲٫۰م)', costOf(item2), { fifo: 2_000_000, repl: 2_000_000 })
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1200000, grandTotal = 1200000 WHERE id = ?').run(p1)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1200000, lineTotal = 1200000 WHERE invoiceId = ?').run(p1)
const r2 = await costEngine.repricePurchase(p1)
// `fixed` یعنی «چند ردیف هم‌راستا شد» — همان قلمِ اول که منبعش P1 است جابه‌جا می‌شود؛
// قلمِ دوم در دو ادعای بعدی سنجیده می‌شود که دست‌نخورده مانده است.
eq('اصلاح دوبارهٔ P1 همان یک قلمِ منبع‌دار را جابه‌جا کرد', r2.replacementFixed, 1)
eq('و «شکایتِ» دست‌نخورده‌بودن هم نساخت (باگِ false-positive در شمارش stale)', r2.replacementStale, 0)
eq('جایگزینی قلم دوم همان ۲ میلیون ماند', costOf(item2).repl, 2_000_000)
eq('FIFO قلم هم دست‌نخورده ماند (از لات P2)', costOf(item2).fifo, 2_000_000)
eq('قلم اول به ۱٫۲ میلیون رفت (همان قاعده: منبعِ عدد همین فاکتور است)', costOf(item1).repl, 1_200_000)
eq('لاتِ P1 هم با همان فیِ جدید مانده تا قلمِ دوم دوباره مصرف نکند', costOf(item1).fifo, 1_200_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
