/**
 * ===========================================================================
 * نشست ۱۷۰ · خوشه D · S170-D3 — «باقی‌مانده»ی اعتبار اضافه‌دریافت (OVERPAY) در توضیح پل
 *
 * اعتبار OVERPAY یک‌بارمصرف که در روز قبل صادر شده، امروز جزئی مصرف می‌شود ⇒ سرویس یک
 * اعتبار «باقی‌مانده» با همان source=OVERPAY و issuedAt=امروز می‌سازد. عدد پل درست است (OVERPAY
 * از ردیف اعتبار صادرشده بیرون است) ولی توضیح ردیف «دریافت پول اضافه» امروز می‌گفت
 * «X ریال از آن به کد اعتبار خرید تبدیل شد» در حالی که امروز هیچ اضافه‌دریافتی نبوده ⇒ متن
 * گمراه‌کننده (عدد با عدد نمی‌خواند). انتظار: توضیح فقط اعتبار OVERPAY *تازه* را بگوید و
 * باقی‌مانده را جدا («باقی‌مانده‌ی ...») نام ببرد؛ پل بسته؛ گزارش اعتبار ۴-۴۸ دست‌نخورده.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s170b-overpay-remainder-hint.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s170b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const PW = DEFAULT_MANAGER_PASSWORD

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const truthy = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} ${extra}`) }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

const userId = seed.user('مدیر تست نشست ۱۷۰')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار جین', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id, qty, lineTotal FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const sale = (price, paid, extra = {}) => salesService.create({
  userId, shiftId,
  lines: [{ variantId: variant(price), qty: 1, unitPrice: price, discount: 0, tax: 0 }],
  payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : [],
  ...extra
})
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  }, { withDrillDown: true, bridgeSourceKey: 'storeCreditIssued' })
  return statements
}
const rowsOf = (s) => Object.fromEntries((s?.bridge?.rows ?? []).map((r) => [r.key, r.sign * r.amount]))
const closed = (s, label = 'پل تطبیق بسته است (مانده‌ی بی‌توضیح)') => eq(label, s?.bridge?.unexplained, 0)
const creditByCode = (code) => seed.rows('SELECT * FROM "StoreCredit" WHERE code = ?', code)[0]
const overRow = (s) => (s?.bridge?.rows ?? []).find((r) => r.key === 'overpayReceived')

console.log('\n۱) دو روز پیش: نسیه‌ی ۱٬۰۰۰٬۰۰۰ با دریافت ۱٬۳۰۰٬۰۰۰ و اعتبار ۳۰۰٬۰۰۰ از اضافه‌دریافت')
const inv = await safe('فروش نسیه', () => sale(1000000, 0))
await safe('دریافت ۱٬۳۰۰٬۰۰۰ با اعتبار', () => salesService.addPayment({ invoiceId: inv?.id, amount: 1300000, methodId: cash, destination: 'CASH', userId, confirmOverpay: true, overpayAsCredit: true }))
const oc = seed.rows(`SELECT * FROM "StoreCredit" WHERE source = 'OVERPAY' ORDER BY id`)[0]
eq('اعتبار اضافه‌دریافت ۳۰۰٬۰۰۰', Number(oc?.amount ?? 0), 300000)
const t2 = Date.now() - 86400000 * 2
const j2 = toJalaliDate(new Date(t2))
sql.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t2, j2, inv?.id)
sql.prepare('UPDATE "Payment" SET paidAt=?, paidAtJalali=?, createdAt=? WHERE invoiceId=?').run(t2, j2, t2, inv?.id)
sql.prepare('UPDATE "StoreCredit" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t2, j2, oc?.id ?? -1)
const s0 = await report()
closed(s0, 'پل امروز پیش از مصرف بسته است')
eq('امروز اضافه‌دریافتی نیست', rowsOf(s0).overpayReceived ?? 0, 0)

console.log('\n۲) امروز: مصرف جزئی ۱۰۰٬۰۰۰ از اعتبار اضافه‌دریافت ⇒ باقی‌مانده‌ی ۲۰۰٬۰۰۰ (OVERPAY)')
await safe('فروش ۱۰۰٬۰۰۰ با اعتبار', () => sale(100000, 0, { storeCreditCode: oc?.code }))
const parent = creditByCode(oc?.code)
/**
 * 🔴 به‌روزرسانی نشست ۱۸۴ · بند ۴-۶ — رفتاری که این‌جا قفل شده بود عوض شد.
 *
 * تا نشست ۱۸۳، باقی‌مانده‌ی اعتبار یک‌بارمصرف با یک **بارکد جدید** به مشتری
 * داده می‌شد. پول نمی‌سوخت، ولی یک رکورد جانشین ساخته می‌شد که پرامپت
 * صریحاً منعش کرده: «بدون ساخت رکورد باقی‌مانده‌ی جدا؛ مصرف و مانده در
 * ledger enforce شود».
 *
 * حالا باقی‌مانده روی **همان** بارکد می‌ماند (`PARTIALLY_USED`) و از
 * `amount − usedAmount` خوانده می‌شود. هم پول مشتری حفظ می‌شود، هم رکورد
 * جانشینی در کار نیست.
 */
eq('هیچ بارکد جانشینی ساخته نشد', parent?.remainderCreditId ?? null, null)
eq('باقی‌مانده ۲۰۰٬۰۰۰ روی همان بارکد ماند', Number(parent?.amount ?? 0) - Number(parent?.usedAmount ?? 0), 200000)
eq('و منبعش همان OVERPAY باقی ماند', parent?.source, 'OVERPAY')
const s1 = await report()
closed(s1, 'پل بعد از مصرف جزئی بسته است')
eq('ردیف «دریافت پول اضافه»ی امروز همچنان صفر', rowsOf(s1).overpayReceived ?? 0, 0)
eq('ردیف اعتبار صادرشده‌ی پل تغییر نکرد', (rowsOf(s1).storeCreditIssued ?? 0) - (rowsOf(s0).storeCreditIssued ?? 0), 0)
const hint = String(overRow(s1)?.hint ?? '')
truthy('توضیح «دریافت پول اضافه» ادعا نمی‌کند امروز ۲۰۰٬۰۰۰ از اضافه‌دریافت به اعتبار تبدیل شد',
  !hint.includes('200000 ریال از آن به کد اعتبار'), `hint=${hint}`)
/**
 * 🔴 به‌روزرسانی نشست ۱۸۴ · بند ۴-۶ — مفهوم «اعتبارِ باقی‌مانده» دیگر وجود ندارد.
 *
 * این بخش‌ها نگران این بودند که باقی‌مانده‌ی اعتبارِ اضافه‌دریافت، به‌شکل یک
 * رکورد تازه در گزارش «صادرشده‌ی امروز» دوباره شمرده شود یا پنهان بماند.
 *
 * حالا اصلاً رکورد تازه‌ای ساخته نمی‌شود: باقی‌مانده روی همان بارکد می‌ماند.
 * پس نه دوباره شمرده می‌شود و نه می‌تواند پنهان بماند — خطر به‌جای «کنترل
 * شدن»، **حذف** شده. انتظارها به همین واقعیت به‌روز شدند.
 */
eq('هیچ اعتبار تازه‌ای امروز صادر نشد (باقی‌مانده روی همان سند ماند)',
  (s1?.storeCredits?.issued ?? 0) - (s0?.storeCredits?.issued ?? 0), 0)
eq('و «باقی‌مانده‌ی اعتبار اضافه‌دریافت» دیگر مفهوم ندارد ⇒ صفر',
  s1?.storeCredits?.issuedOverpayRemainder ?? 0, 0)

console.log('\n۳) همان روز: یک اضافه‌دریافت تازه‌ی ۵۰٬۰۰۰ با اعتبار ⇒ توضیح فقط ۵۰٬۰۰۰ تازه را «تبدیل‌شده» بگوید')
const inv3 = await safe('فروش نسیه‌ی ۴۰۰٬۰۰۰', () => sale(400000, 0))
await safe('دریافت ۴۵۰٬۰۰۰ با اعتبار', () => salesService.addPayment({ invoiceId: inv3?.id, amount: 450000, methodId: cash, destination: 'CASH', userId, confirmOverpay: true, overpayAsCredit: true }))
const s2 = await report()
closed(s2, 'پل با اضافه‌دریافت تازه + باقی‌مانده بسته است')
eq('ردیف «دریافت پول اضافه» = ۵۰٬۰۰۰', rowsOf(s2).overpayReceived ?? 0, -50000)
const hint2 = String(overRow(s2)?.hint ?? '')
truthy('توضیح، ۵۰٬۰۰۰ تازه را تبدیل‌شده می‌گوید', /(^|[^0-9])50000 ریال از آن به کد اعتبار/.test(hint2), `hint=${hint2}`)
truthy('توضیح، ۲۵۰٬۰۰۰ (تازه + باقی‌مانده) را تبدیل‌شده نمی‌گوید', !hint2.includes('250000 ریال از آن'), `hint=${hint2}`)
eq('storeCredits.issuedFromOverpay = فقط اعتبار تازه‌ی امروز (۵۰٬۰۰۰)', s2?.storeCredits?.issuedFromOverpay, 50000)
eq('و «باقی‌مانده» دیگر رکوردی ندارد ⇒ صفر', s2?.storeCredits?.issuedOverpayRemainder ?? 0, 0)
eq('OVERPAY وارد «بی‌سند» نمی‌شود (S61-2)', s2?.storeCredits?.issuedUnbacked ?? 0, 0)
eq('باقی‌مانده‌ی OVERPAY وارد «باقی‌مانده»ی اعتبار برگشتی نمی‌شود', s2?.storeCredits?.issuedRemainder ?? 0, 0)
truthy('توضیح ردیف «اعتبار خرید صادرشده» اعتبار اضافه‌دریافت را «بی‌سند/باقی‌مانده» نمی‌خواند',
  !/بی‌سند|باقی‌مانده/.test(String((s2?.bridge?.rows ?? []).find((r) => r.key === 'storeCreditIssued')?.hint ?? '')))

console.log(`\nنتیجه: ${ok} موفق، ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
