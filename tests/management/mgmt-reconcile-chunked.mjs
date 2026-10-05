/**
 * بازبینی نهم · B3 — جاروی «ردیفِ گم‌شده/جابه‌جا شدهٔ فاکتور ویرایش‌شده» باید پنجره‌ای
 * و با مکان‌نما باشد، نه هر بار روی کل SaleItemCost و SaleInvoiceItem. مکان‌نما در
 * `Setting` می‌نشیند تا هر فراخوانی ارزان بماند و در پایان همان چرخش صفر شود تا چیزی
 * گم نشود. مهم‌ترین قاعده‌ای که نباید بشکند: «فاکتور ویرایش‌شده فی قفل‌شده‌اش را
 * نگه می‌دارد» — حتی اگر قلمِ کهنه و قلمِ تازه در دو پنجرهٔ متفاوت بیفتند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-reconcile-chunked.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reconcile-chunk-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
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
const cat = seed.category('کاپشن')
const p = seed.product('کاپشن مردانه')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '42')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 1500000, purchasePrice = 600000 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 800,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 30_000_000,
  discountTotal: 0,
  grandTotal: 30_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 20, unitPrice: 1_500_000, lineTotal: 30_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 20,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 20 WHERE id = ?').run(v)
await costEngine.run()

// ————— شش فاکتور تک‌قلمی ⇒ قلم‌ها شماره ۱ تا ۶ —————
for (let i = 0; i < 6; i++) {
  await salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
  })
}
await costEngine.run()
eq('شش ردیف هزینه قفل شد', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 6)

// پنجره‌ها را روی ۲ می‌گذاریم تا رفتار چرخشی دیده شود
// کوچک‌ترین پنجرهٔ مجاز ۴ است (کفِ امن برای اینکه هر اجرا یک کوئریِ بی‌خود نشود)
sql.prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)').run('mgmt.reconcilePage', '4')

/** ردیف هزینهٔ قلم ۱ و ۶ را پاک می‌کنیم: یکی داخلِ اولین پنجره، یکی بیرون از آن. */
const invIds = sql.prepare('SELECT id, invoiceId FROM "SaleInvoiceItem" ORDER BY id ASC').all().map((r) => Number(r.id))
eq('شمارهٔ قلم‌ها ۱ تا ۶ است', invIds, [1, 2, 3, 4, 5, 6])
sql.prepare('DELETE FROM "SaleItemCost" WHERE saleItemId IN (1, 6)').run()
eq('دو ردیف کم شد', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 4)

await costEngine.run()
let st = await costEngine.status()
eq(
  'پنجرهٔ اول (۰،۴]: همان یکی که داخلِ بازه بود ترمیم شد',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = 1').get().c),
  1
)
eq(
  'قلم ۶ هنوز نوبتش نشده (پنجره‌ای کار می‌کند، نه «همه یا هیچ») — باگ B3: همان دور اول همه جارو می‌شد',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = 6').get().c),
  0
)
eq('مکان‌نما جل رفته و در دیتابیس مانده است', [st.reconcile?.cur, st.reconcile?.span], [4, 4])
eq('سقفِ جدول هم در وضعیت نوشته شده تا آمارِ گم‌شده دروغ نباشد', st.reconcile?.maxId, 6)

await costEngine.run()
st = await costEngine.status()
eq('دور دوم: قلم ۶ ترمیم شد', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = 6').get().c), 1)
eq('چرخه کامل شد ⇒ مکان‌نما صفر می‌شود تا دورِ بعدی از اول بگردد', st.reconcile?.cur, 0)
eq('ردیف‌های هزینه سر جایشان‌اند', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 6)

// ————— ویرایشِ فاکتور: قلمِ کهنه حذف و قلمِ تازه با شمارهٔ دور اضافه می‌شود —————
for (let i = 0; i < 5; i++) {
  await salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
  })
}
await costEngine.run()
// قلم ۷ مالِ فاکتور ۷ است؛ قلمِ تازه هم باید همان‌جا اضافه شود (ویرایشِ واقعی همین کار را می‌کند)
const inv7 = Number(sql.prepare('SELECT invoiceId FROM "SaleInvoiceItem" WHERE id = 7').get().invoiceId)
const before = sql.prepare('SELECT fifoCost, replacementCost FROM "SaleItemCost" WHERE saleItemId = 7').get()
const saleQtyBefore = Number(sql.prepare(`SELECT COUNT(*) c FROM "CostConsumption" WHERE kind = 'SALE'`).get().c)

const fresh = seed.insert('SaleInvoiceItem', {
  invoiceId: inv7,
  variantId: v,
  qty: 1,
  unitPrice: 2_000_000,
  lineTotal: 2_000_000
})
sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE id = 7').run()
const farId = Number(fresh)
console.log(`  (قلمِ تازه شماره ${farId} — بیرونِ پنجرهٔ شمارهٔ ۷)`)

const win = async (n) => {
  for (let i = 0; i < n; i++) await costEngine.run()
}
await win(1) // مکان‌نما از دورِ قبل روی ۴ است ⇒ پنجرهٔ (4,8] ⇒ یتیمِ شماره ۷ داخلِ پنجره، قلمِ تازه ۱۲ بیرونِ آن
st = await costEngine.status()
eq('پنجره همین که یتیم را دید، وصلش کرد (جارو عقب نمی‌افتد)', st.reconcile?.cur, 8)
const nowRow = sql.prepare('SELECT saleItemId FROM "SaleItemCost" WHERE saleItemId = ?').get(farId)
const afterRow = sql.prepare('SELECT fifoCost, replacementCost FROM "SaleItemCost" WHERE saleItemId = ?').get(farId)
eq(
  'با اینکه قلمِ تازه در پنجرهٔ دیگری بود، وصل شد (بازخوانیِ کاملِ فاکتور — وگرنه فی از لاتِ امروز گرفته می‌شد)',
  nowRow ? Number(nowRow.saleItemId) : null,
  farId
)
eq(
  'و فی قفل‌شده دست‌نخورده ماند',
  [Number(afterRow.fifoCost), Number(afterRow.replacementCost)],
  [Number(before.fifoCost), Number(before.replacementCost)]
)
eq('تعداد لایه‌های مصرفی فروش تغییر نکرد', Number(sql.prepare(`SELECT COUNT(*) c FROM "CostConsumption" WHERE kind = 'SALE'`).get().c), saleQtyBefore)
eq('ردیفِ بی‌صاحب پاک شد', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = 7').get().c), 0)
await win(1) // (8,12] ⇒ انتها ⇒ مکان‌نما صفر
st = await costEngine.status()
eq('چرخه بسته شد ⇒ دورِ ادوارِ بعدی از اول می‌گردد و چیزی گم نمی‌شود', st.reconcile?.cur, 0)
eq('شمارشِ ردیف‌های هزینه با تعداد قلم‌های فروش می‌خواند', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), Number(sql.prepare('SELECT COUNT(*) c FROM "SaleInvoiceItem"').get().c))

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
