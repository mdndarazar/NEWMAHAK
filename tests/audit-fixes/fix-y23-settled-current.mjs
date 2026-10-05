/**
 * ===========================================================================
 * نشست ۱۶۵ · Y23 — «وصول همین دوره» (accounting.credit.settledCurrent) و چکِ پاس‌شده‌ی فاکتور دوره‌ی قبل.
 *
 * فرضیه‌ی هندآف ۱۶۴: در accountingReport.paymentStatement داریم
 *   currentPeriod = cash + card + credit + other − priorPeriod
 * ولی priorPeriod سهم چکِ پاس‌شده‌ی دوره‌ی قبل (priorClearedCheques) را هم دارد در حالی که cash/card/other
 * هیچ چکی ندارند ⇒ اگر روزی چکی به سبد cash/card/other برود، settledCurrent به اندازه‌ی آن چک کم نشان داده می‌شود.
 *
 * بخش (۱) قطعی می‌کند که با قاعده‌ی فعلی receiptBucketOf (چک ⇒ فقط managerAccount یا unknown) اثر امروز صفر است.
 * بخش (۲) سناریوی یکپارچه: وصول همین دوره = فقط پول واقعی فاکتورهای همین دوره؛ هیچ چک دوره‌ی قبل (مقصد مدیر،
 *   بی‌مقصد، یا «CASH» قدیمی) نه در settledCurrent و نه در settledPrior/سهم نقد نمی‌نشیند.
 * آزمون جهش (TESTLOG-s165-mutation.txt): اگر receiptBucketOf برای چک CASH سبد 'cash' بدهد، فرمول قدیمی
 *   settledCurrent را ۱٬۰۰۰ کم نشان می‌داد (FAIL)؛ فرمول اصلاح‌شده (S165-D1) همچنان ۵۰۰ می‌دهد (PASS).
 *
 *     node --import ./test/harness/register.mjs tests/pending/fix-y23-settled-current.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y23-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { receiptBucketOf } = await import('@shared/accounting')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const MUTANT = process.env.Y23_MUTANT === '1'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

// ---------------------------------------------------------------------------
console.log('\n۱) قاعده‌ی سبد چک (بند ۴-۱۲ / ۴-۲۴)')
if (MUTANT) console.log('  (حالت جهش: فقط بخش ۲ معنا دارد)')
else for (const d of ['CASH', 'CARD', 'MANAGER', null, 'cash', 'OTHER', ''])
  eq(`چک با مقصد ${JSON.stringify(d)} ⇒ فقط حساب مدیر یا نامشخص`,
    ['managerAccount', 'unknown'].includes(receiptBucketOf({ isCheque: true, destination: d, methodKind: 'CASH' })), true)

// ---------------------------------------------------------------------------
const HOUR = 3_600_000
const userId = seed.user('مدیر Y23')
const cat = seed.category('پوشاک Y23')
const product = seed.product('پیراهن Y23', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const Yat = Date.now() - 30 * HOUR
const yday = toJalaliDate(new Date(Yat))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - HOUR, userId })
const yShift = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: yday, openedAt: Yat - HOUR, closedAt: Yat + HOUR, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز Y${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const yesterdaySale = async (price) => {
  const inv = await salesService.create({ userId, shiftId, lines: [line(variant(price), price)], payments: [] })
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, shiftId = ? WHERE id = ?').run(Yat, yday, yShift, inv.id)
  return inv
}
const chequeClearedToday = async (inv, amount, destination) => {
  await salesService.addPayment({ invoiceId: inv.id, kind: 'CHEQUE', amount, chequeNo: `Y23-${inv.id}`, bankName: 'ملت', dueDateJalali: today, userId })
  const c = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ? AND kind = \'CHEQUE\' ORDER BY id DESC LIMIT 1', inv.id)
  /** چک دیروز ثبت شده و امروز پاس شده؛ مقصد «CASH»/null فقط داده‌ی قدیمی است (مسیر عادی فقط MANAGER می‌پذیرد) */
  sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ?, createdAt = ?, createdShiftId = ?, chequeStatus = \'CLEARED\', destination = ?, clearedAt = ?, clearedAtJalali = ?, clearedShiftId = ? WHERE id = ?')
    .run(Yat, yday, Yat, yShift, destination, Date.now(), today, shiftId, c?.id)
}

console.log('\n۲) گزارش امروز: وصول همین دوره در حضور چک‌های پاس‌شده‌ی دوره‌ی قبل')
const A = await safe('فاکتور دیروز الف', () => yesterdaySale(1000))
const B = await safe('فاکتور دیروز ب', () => yesterdaySale(1000))
const C = await safe('فاکتور دیروز ج', () => yesterdaySale(1000))
const D = await safe('فاکتور دیروز د', () => yesterdaySale(1000))
await safe('چک الف (مدیر)', () => chequeClearedToday(A, 1000, 'MANAGER'))
await safe('چک ب (بی‌مقصد)', () => chequeClearedToday(B, 1000, null))
await safe('چک ج (CASH قدیمی)', () => chequeClearedToday(C, 1000, 'CASH'))
await safe('وصول نقدی ۳۰۰ فاکتور د', () => salesService.addPayment({ invoiceId: D.id, amount: 300, methodId: cash, destination: 'CASH', userId }))
await safe('فروش نقدی امروز ۵۰۰', () => salesService.create({ userId, shiftId, lines: [line(variant(500), 500)], payments: [{ methodId: cash, amount: 500, destination: 'CASH' }] }))

const rep = await safe('گزارش امروز', () => salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceTake: 2000 }))
const cr = rep?.accounting?.credit
eq('وصول همین دوره = فقط فروش نقدی امروز', Number(cr?.settledCurrent ?? NaN), 500)
/** در حالت جهش چک CASH عمداً «نقد» حساب می‌شود، پس ۱٬۳۰۰ معنای درستِ همان قاعده‌ی جهش‌یافته است */
eq('وصول نسیه‌ی دوره‌ی قبل = فقط نقد ۳۰۰ (هیچ چکی)', Number(cr?.settledPrior ?? NaN), MUTANT ? 1300 : 300)
eq('سهم نقدِ وصول دوره‌ی قبل', Number(cr?.settledPriorCash ?? NaN), MUTANT ? 1300 : 300)
if (!MUTANT) eq('پل امروز بسته', rep?.accounting?.bridge?.unexplained, 0)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
