/**
 * بازبینی دهم · B5 — جاروی «ویرایشِ فاکتور» حالا سقفِ هر دور دارد (زمان و تعداد) و بعد از
 * مهلک پنجره‌اش نصف می‌شود. دو چیز باید ثابت بماند: (۱) تمام‌نشدنِ دور **خطا نیست** و چراغ
 * قرمز نمی‌کند؛ (۲) چیزی گم نمی‌شود — قلم‌های نرسیده در دورِ بعدی همان فیِ قفل‌شده را
 * می‌گیرند، نه فیِ امروز. اندازهٔ پنجرهٔ نصف‌شده هم از مکان‌نما خوانده می‌شود و بعد از
 * تمام‌شدنِ چرخه به پیش‌فرض برمی‌گردد.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-reconcile-budget.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-rec-budget-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
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
seed.category('سوییشرت')
const p = seed.product('سوییشرت')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 12, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)
const sup = seed.insert('Supplier', { code: 'S9', name: 'پخش مرکزی' })
const buyInv = seed.insert('PurchaseInvoice', {
  invoiceNo: 1500,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 40 * DAY)),
  issuedAt: Date.now() - 40 * DAY,
  supplierId: sup,
  goodsTotal: 12_000_000,
  discountTotal: 0,
  grandTotal: 12_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyInv, variantId: v, qty: 12, unitPrice: 1_000_000, lineTotal: 12_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 12,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyInv,
  state: 'FINAL',
  createdAt: Date.now() - 40 * DAY
})

/** دوازده فاکتور تک‌قلمی ⇒ ردیف‌های هزینهٔ id ۱..۱۲. */
for (let i = 0; i < 12; i++) {
  const inv = seed.insert('SaleInvoice', {
    receiptNo: 900 + i,
    issuedAtJalali: today,
    issuedAt: Date.now() - i * 1000,
    userId,
    shiftId,
    goodsTotal: 3_000_000,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 3_000_000,
    deductInventory: true,
    status: 'SETTLED'
  })
  seed.insert('SaleInvoiceItem', {
    invoiceId: inv,
    variantId: v,
    qty: 1,
    unitPrice: 3_000_000,
    discount: 0,
    tax: 0,
    lineTotal: 3_000_000
  })
  seed.insert('StockMovement', {
    variantId: v,
    delta: -1,
    reason: 'SALE',
    refType: 'SaleInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: Date.now() - i * 1000
  })
}
await costEngine.run()
const rowCount = () => Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c)
eq('دفتر برای هر ۱۲ قلم ردیف هزینه ساخت', rowCount(), 12)
const consumption = () =>
  Number(sql.prepare(`SELECT COALESCE(SUM(qty),0) s FROM "CostConsumption" WHERE kind = 'SALE'`).get().s)
eq('۱۲ عدد از لات رفته', consumption(), 12)
const healed = (itemId) =>
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = ?').get(itemId).c) === 1

/**
 * «ویرایش» دو فاکتور: قلمِ کهنه می‌رود و قلمِ تازه با همان تعداد می‌آید ⇒ ردیفِ هزینه
 * یتیم می‌ماند. خریدِ تازه با فی ۹ میلیون هم اضافه می‌شود: اگر قلمی اشتباه از نو قفل
 * شود، فوراً در فیِ ردیفش می‌بینیم (باید ۱ میلیون بماند).
 */
const editInvoice = (itemId) => {
  const it = sql
    .prepare('SELECT invoiceId, variantId, qty, unitPrice, lineTotal FROM "SaleInvoiceItem" WHERE id = ?')
    .get(itemId)
  sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE id = ?').run(itemId)
  return seed.insert('SaleInvoiceItem', {
    invoiceId: it.invoiceId,
    variantId: it.variantId,
    qty: it.qty,
    unitPrice: it.unitPrice,
    discount: 0,
    tax: 0,
    lineTotal: it.lineTotal
  })
}
const new2 = editInvoice(2)
const new11 = editInvoice(11)
const lateBuy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1501,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  supplierId: sup,
  goodsTotal: 36_000_000,
  discountTotal: 0,
  grandTotal: 36_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: lateBuy, variantId: v, qty: 4, unitPrice: 9_000_000, lineTotal: 36_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 4,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: lateBuy,
  state: 'FINAL',
  createdAt: Date.now()
})

/**
 * فاز ۱ — مهلکِ هر دور. سقفِ *زمانی* در تست نوسان دارد، پس همین‌جا با سقفِ تعدادی
 * (یک فاکتور در دور) همان مسیرِ کد سنجیده می‌شود؛ هر دو همان پرچم را می‌گذارند.
 */
seed.insert('Setting', { key: 'mgmt.reconcileBudgetItems', value: '1' })
await costEngine.run()
const st1 = await costEngine.status()
eq('دور با سقفش ایستاد و همین را روی مکان‌نما می‌نویسد', st1.reconcile?.budget, true)
eq('فقط یک فاکتور در همین دور وصل شد؛ آن یکی به دورِ بعد موکول شد', [healed(new2), healed(new11)], [true, false])
eq('وایستادنِ وسطِ دور خطا نیست — چراغ قرمز نمی‌شود', st1.reconcileError || '', '')
eq(
  'تا جایی که رسیده فیِ کهنه را نگه داشته (هیچ ردیفی با فیِ ۹ میلیونیِ امروز بسته نشد)',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE fifoCost <> 1000000').get().c),
  0
)
sql.prepare('DELETE FROM "Setting" WHERE key = ?').run('mgmt.reconcileBudgetItems')
await costEngine.run()
eq('بعد از برداشتنِ سقف، یتیمِ مانده در دورِ بعدی وصل شد', [healed(new2), healed(new11)], [true, true])
eq('هیچ ردیفِ اضافه‌ای ساخته نشد', rowCount(), 12)
eq('مصرفِ لات دوباره تکرار نشد', consumption(), 12)
eq(
  'یتیمی نمانده (ردیفِ کهنه جابه‌جا شد، نه کپی)',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId NOT IN (SELECT id FROM "SaleInvoiceItem")').get().c),
  0
)
const st1b = await costEngine.status()
eq('چرخه که تمام شد، پرچمِ «نیمه‌کاره» پاک می‌شود', st1b.reconcile?.budget, false)

/** فاز ۲ — پنجرهٔ نصف‌شده از مکان‌نما خوانده می‌شود و بعد از پایانِ چرخه به پیش‌فرض برمی‌گردد. */
const new3 = editInvoice(3)
const new9 = editInvoice(9)
sql.prepare(`UPDATE "Setting" SET value = ? WHERE key = 'mgmt.reconcileCursor'`).run(
  JSON.stringify({ cur: 0, maxId: 16, span: 6 })
)
await costEngine.run()
eq('با پنجرهٔ ۶تایی، فقط یتیمِ داخلِ پنجره وصل شد', [healed(new3), healed(new9)], [true, false])
const st2 = await costEngine.status()
eq('مکان‌نما وسطِ چرخه است و همان پنجرهٔ کوچک را نگه داشته', [st2.reconcile?.cur, st2.reconcile?.span], [6, 6])
await costEngine.run()
eq('در دورِ بعدی یتیمِ ماندگار هم وصل شد', healed(new9), true)
// پنجرهٔ ۶تایی هنوز وسطِ چرخه است (قلم‌ها تا شناسهٔ ۱۶ رفته‌اند) — یک دور دیگر تا سرِ چرخه.
await costEngine.run()
const st3 = await costEngine.status()
eq('چرخه که تمام شد، پنجره به پیش‌فرض برمی‌گردد', [st3.reconcile?.cur, st3.reconcile?.span], [0, 4000])
eq('و باز هم خطایی نماند', st3.reconcileError || '', '')
eq('جمعاً دوازده ردیف، دوازده مصرف', [rowCount(), consumption()], [12, 12])

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
