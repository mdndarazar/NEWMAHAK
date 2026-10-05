/**
 * بازبینی یازدهم · B4 — اصلاح فیِ فاکتور خرید بیرون از تراکنشِ فاکتور می‌چرخد؛ اگر
 * برنامه میانِ «آپدیت لات/مصرف» و محاسبهٔ دوبارهٔ قلم بسته شود، ردیف‌های مصرف فیِ تازه
 * دارند ولی `SaleItemCost.fifoCost` کهنه می‌ماند — و چون لات دیگر عوض‌شده نیست، اجرای
 * بعدی هیچ‌وقت درستش نمی‌کرد («عددِ نصفه برای همیشه»). حالا `repriceLocked` قلم‌های
 * هر لاتِ همان فاکتور را **همیشه** از نو می‌خواند، پس یک بار زدنِ دوبارهٔ همان اصلاح
 * (یا اجرای بعدیِ دفتر) نیمه‌کاره را تعمیر می‌کند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-reprice-idempotent.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-idem-'))
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

const userId = seed.user('نیمه‌کاره')
seed.category('کلاه')
const p = seed.product('کلاه آفتابی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'one')
sql.prepare('UPDATE "ProductVariant" SET stock = 2, salePrice = 3000000, purchasePrice = 1000000 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1601,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * DAY)),
  issuedAt: Date.now() - 10 * DAY,
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
  createdAt: Date.now() - 10 * DAY
})

const inv = seed.insert('SaleInvoice', {
  receiptNo: 921,
  issuedAtJalali: today,
  issuedAt: Date.now(),
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
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)
await costEngine.run()
const row = () => sql.prepare('SELECT fifoCost, revenue FROM "SaleItemCost" WHERE saleItemId = ?').get(item1)
eq('فرض: دو عدد با فی ۱م قفل شد', Number(row().fifoCost), 2_000_000)

/** فی فاکتور ۱٫۵ میلیون می‌شود و اصلاح اعمال می‌شود (مسیر درستِ قبلی). */
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1500000, lineTotal = 3000000 WHERE invoiceId = ? AND variantId = ?').run(buy, v)
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 3000000, grandTotal = 3000000 WHERE id = ?').run(buy)
await costEngine.repricePurchase(buy)
eq('اصلاح فی، قلمِ قفل‌شده را هم درست کرد', Number(row().fifoCost), 3_000_000)

/**
 * حالا «نیمه‌کاره» را می‌سازیم: لات و ردیف‌های مصرف روی ۲ میلیون‌اند (انگار آپدیت‌ها
 * انجام شده) ولی `fifoCost`ِ قلم روی ۳ میلیون مانده (انگار برنامه قبل از محاسبهٔ قلم
 * بسته شده). اصلاحِ قبلی هم روی همان ۲ میلیون تنظیم می‌کنیم تا «لات عوض نشده» شود —
 * یعنی دقیقاً همان حالتی که کدِ قدیمی هیچ‌وقت دوباره نگاهش نمی‌کرد.
 */
sql.prepare(`UPDATE "PurchaseLot" SET unitCost = 2000000 WHERE variantId = ?`).run(v)
sql.prepare(`UPDATE "CostConsumption" SET unitCost = 2000000 WHERE kind = 'SALE' AND saleItemId = ?`).run(item1)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 2000000, lineTotal = 4000000 WHERE invoiceId = ? AND variantId = ?').run(buy, v)
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 4000000, grandTotal = 4000000 WHERE id = ?').run(buy)
eq('وضعیت خراب ساخته شد: مصرف ۲ میلیونی ولی ردیفِ قلم ۳ میلیونی', [Number(row().fifoCost), Number(sql.prepare('SELECT SUM(unitCost * qty) s FROM "CostConsumption" WHERE kind = ? AND saleItemId = ?').get('SALE', item1).s)], [3_000_000, 4_000_000])

const out = await costEngine.repricePurchase(buy)
eq('اصلاحِ دوباره (بدون تغییرِ فی) هم قلم را هم‌خوان می‌کند', Number(row().fifoCost), 4_000_000)
eq('و تعدادِ قلم‌های لمس‌شده را گزارش می‌دهد', Number(out?.saleItems ?? 0) >= 1, true)

const st = await costEngine.status()
eq('و آخرین اصلاح در وضعیتِ دفتر ثبت شد', Number(st?.lastReprice?.saleItems ?? 0) >= 1, true)
eq('صفِ اصلاح فی بعد از موفقیت خالی است', Number(st?.repriceQueued ?? 0), 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
