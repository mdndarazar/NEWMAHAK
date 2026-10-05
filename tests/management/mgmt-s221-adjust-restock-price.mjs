/**
 * بازبینی دوازدهم · B3-lite — «کسریِ دستی را با اصلاحِ مثبت جبران کردی»: فیِ همان لاتِ
 * جبرانی باید بهایِ جنسی باشد که واقعاً از قفسه رفته، نه فیِ آخرین خریدِ آن لحظه.
 *
 * قبلاً ورودِ بدون‌فاکتور همیشه با `lastPurchaseUnit` لات می‌ساخت؛ اگر بین کسری و جبران
 * یک فاکتورِ تازه با فیِ دیگری آمده باشد، همان جنس با فیِ تازه روی قفسه می‌نشست و ارزشِ
 * موجودی (و سودِ جایگزینیِ بعدی) کج می‌شد. عمداً فقط در حالتِ **بدون‌ابهام** از مصرفِ
 * حرکتِ منفی قیمت گرفته می‌شود؛ با دو کسریِ هم‌تعداد در پنجره، حدس زدن خودش باگ است ⇒
 * رفتارِ قبلی می‌ماند (این هم در تست بسته شده).
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s221-adjust-restock-price.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-adj-price-'))
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
const HOUR = 3600_000

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
const n = (v) => Number(typeof v === 'bigint' ? Number(v) : v)

const userId = seed.user('اصلاح')
void userId
const p = seed.product('چراغ قوه')
const v = seed.variant(p, 'c1')
sql.prepare('UPDATE "ProductVariant" SET stock = 4, salePrice = 4000000, purchasePrice = 1000000 WHERE id = ?').run(v)

/** خریدِ اول: ۴ عدد × ۱ میلیون (۱۰ روز پیش). */
const buy1 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1951,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 10 * 86400_000)),
  issuedAt: Date.now() - 10 * 86400_000,
  goodsTotal: 4_000_000,
  discountTotal: 0,
  grandTotal: 4_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy1, variantId: v, qty: 4, unitPrice: 1_000_000, lineTotal: 4_000_000 })
const t0 = Date.now() - 3 * HOUR
seed.insert('StockMovement', {
  variantId: v,
  delta: 4,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy1,
  state: 'FINAL',
  createdAt: t0
})
/** تایپِ اشتباه: ۲ عدد کسریِ دستی (فیِ مصرف = ۱م). */
seed.insert('StockMovement', { variantId: v, delta: -2, reason: 'ADJUSTMENT', state: 'FINAL', createdAt: t0 + HOUR })
await costEngine.run()
/** بعد از کسری، خریدِ تازه با فیِ ۵م می‌آید — «آخرین فی» حالا ۵م است. */
const buy2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1952,
  issuedAtJalali: today,
  issuedAt: Date.now() - HOUR / 2,
  goodsTotal: 10_000_000,
  discountTotal: 0,
  grandTotal: 10_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy2, variantId: v, qty: 2, unitPrice: 5_000_000, lineTotal: 10_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy2,
  state: 'FINAL',
  createdAt: Date.now() - HOUR / 2
})
await costEngine.run()

/** جبران: همان ۲ عدد را ۲+ می‌کنیم (حرکتِ بدون فاکتور). */
seed.insert('StockMovement', { variantId: v, delta: 2, reason: 'ADJUSTMENT', state: 'FINAL', createdAt: Date.now() })
sql.prepare('UPDATE "ProductVariant" SET stock = 6 WHERE id = ?').run(v)
await costEngine.run()

const lots = await db.purchaseLot.findMany({ where: { variantId: v }, orderBy: { id: 'asc' } })
const back = lots.filter((l) => String(l.source) === 'NO_INVOICE')
eq('یک لاتِ جبرانی ساخته شد', back.length, 1)
eq('فیِ همان لات = فیِ جنسی که از قفسه رفته بود، نه آخرین خرید (باگ: ۵م)', n(back[0]?.unitCost), 1_000_000)
eq('تعدادش هم همان جاست', n(back[0]?.qtyIn), 2)
const value = lots.reduce((s, l) => s + n(l.unitCost) * n(l.qtyLeft), 0)
eq('ارزشِ موجودیِ دفتر: ۲×۱م (باقیِ لات اول) + ۲×۵م (خرید تازه) + ۲×۱م (جبران) = ۱۴م', value, 14_000_000)

/** ابهام: دو کسریِ هم‌تعداد در پنجره ⇒ حدس نمی‌زنیم، به رفتارِ قبل برمی‌گردیم. */
seed.insert('StockMovement', { variantId: v, delta: -2, reason: 'ADJUSTMENT', state: 'FINAL', createdAt: Date.now() - 10 * 60_000 })
seed.insert('StockMovement', { variantId: v, delta: 2, reason: 'ADJUSTMENT', state: 'FINAL', createdAt: Date.now() + 60_000 })
sql.prepare('UPDATE "ProductVariant" SET stock = 6 WHERE id = ?').run(v)
await costEngine.run()
const lots2 = await db.purchaseLot.findMany({ where: { variantId: v }, orderBy: { id: 'asc' } })
const back2 = lots2.filter((l) => String(l.source) === 'NO_INVOICE')
eq('لاتِ دوم ساخته می‌شود', back2.length, 2)
eq('با ابهام، فی از «آخرین خرید» می‌آید (۵م) — قاعدهٔ حدسی نداریم', n(back2[1]?.unitCost), 5_000_000)

/** دلیلِ دیگر (STOCKTAKE) هم همین قاعده را دارد. */
const p2 = seed.product('پنکه')
const v2 = seed.variant(p2, 'c2')
sql.prepare('UPDATE "ProductVariant" SET stock = 3, salePrice = 4000000, purchasePrice = 1000000 WHERE id = ?').run(v2)
const buy3 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1953,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 5 * 86400_000)),
  issuedAt: Date.now() - 5 * 86400_000,
  goodsTotal: 3_000_000,
  discountTotal: 0,
  grandTotal: 3_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy3, variantId: v2, qty: 3, unitPrice: 1_000_000, lineTotal: 3_000_000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 3,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy3,
  state: 'FINAL',
  createdAt: Date.now() - 5 * 86400_000
})
seed.insert('StockMovement', { variantId: v2, delta: -1, reason: 'STOCKTAKE', state: 'FINAL', createdAt: Date.now() - 2 * HOUR })
await costEngine.run()
const buy4 = seed.insert('PurchaseInvoice', {
  invoiceNo: 1954,
  issuedAtJalali: today,
  issuedAt: Date.now() - HOUR,
  goodsTotal: 8_000_000,
  discountTotal: 0,
  grandTotal: 8_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy4, variantId: v2, qty: 1, unitPrice: 8_000_000, lineTotal: 8_000_000 })
seed.insert('StockMovement', {
  variantId: v2,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy4,
  state: 'FINAL',
  createdAt: Date.now() - HOUR
})
await costEngine.run()
seed.insert('StockMovement', { variantId: v2, delta: 1, reason: 'STOCKTAKE', state: 'FINAL', createdAt: Date.now() })
await costEngine.run()
const back3 = (await db.purchaseLot.findMany({ where: { variantId: v2, source: 'NO_INVOICE' } })) || []
eq('انبارگردانی هم همین‌طور: فیِ ۱مِ همان کسری، نه ۸مِ خریدِ تازه (باگ: ۸م)', n(back3[0]?.unitCost), 1_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
