/**
 * ===========================================================================
 * نشست ۱۷۰ · خوشه D · یادداشت باز S61 / S169-D4 — اعتبار بی‌سند و «باقی‌مانده» در پل تطبیق
 *
 * ردیف «اعتبار خرید صادرشده»ی پل = issued − issuedFromOverpay بود. ولی فقط اعتباری که
 * از یک برگشت/تعویض واقعی (returnId ≠ null) صادر شده، پشتش کاهشی در فروش خالص
 * (netAccrualSales) هست. سه نوع اعتبار دیگر هیچ اثری در فروش/وجه ندارند و پل را به
 * اندازه‌ی مبلغشان باز می‌گذاشتند:
 *   (۱) اعتبار دستی مدیر (issueManual، MANUAL، بی‌سند)
 *   (۲) صدور گروهی (bulkIssue) — MANUAL یا حتی EXCHANGE بی‌سند
 *   (۳) «باقی‌مانده»ی مصرف جزئی اعتبار یک‌بارمصرف (اعتبار جدید با returnId کپی‌شده)
 * انتظار: پل در همه‌ی سناریوها بسته؛ ردیف پل برای اعتبار برگشتی واقعی همچنان کم می‌شود؛
 * گزارش اعتبار بند ۴-۴۸ (issued) دست‌نخورده؛ مبلغ بی‌سند/باقی‌مانده پنهان نمی‌شود
 * (توضیح ردیف + یادداشت گزارش)؛ drill-down ردیف با همان predicate.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s170-bridge-unbacked-credit.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s170-'))
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
const issuedRow = (s) => (s?.bridge?.rows ?? []).find((r) => r.key === 'storeCreditIssued')
const drillSum = (s) => (issuedRow(s)?.sources ?? []).reduce((a, r) => a + Number(r.amount ?? 0), 0)
const creditByCode = (code) => seed.rows('SELECT * FROM "StoreCredit" WHERE code = ?', code)[0]
/** کد فقط fixture داخلی تست است؛ API صدور عمداً credential برنمی‌گرداند. */
const fixtureCode = (id) => seed.one('SELECT code FROM "StoreCredit" WHERE id = ?', id)?.code ?? null

// ---------------------------------------------------------------------------
console.log('\n۰) پایه: گزارش خالی امروز')
const s0 = await report()
closed(s0, 'پل خالی بسته است')

// ---------------------------------------------------------------------------
console.log('\n(الف) فقط یک اعتبار دستی مدیر ۵۰۰٬۰۰۰ امروز (issueManual با رمز مدیر)')
const m1 = await safe('صدور دستی', () => storeCreditService.issueManual({ amount: 500000, userId, managerPassword: PW }))
truthy('اعتبار دستی با DTO امن صادر شد', !!m1?.id && !('code' in m1))
const m1Code = fixtureCode(m1?.id)
const sA = await report()
closed(sA, 'پل بعد از اعتبار دستی بسته است')
eq('ردیف «اعتبار صادرشده»ی پل برای اعتبار بی‌سند تغییر نکرد', (rowsOf(sA).storeCreditIssued ?? 0) - (rowsOf(s0).storeCreditIssued ?? 0), 0)
eq('گزارش اعتبار (بند ۴-۴۸): صادرشده‌ی بازه همچنان شامل اعتبار دستی است', sA?.storeCredits?.issued - s0?.storeCredits?.issued, 500000)
truthy('مبلغ اعتبار بی‌سند پنهان نشد (در توضیح ردیف یا یادداشت گزارش آمده)',
  String(issuedRow(sA)?.hint ?? '').includes('500000') || (sA?.notes ?? []).some((x) => String(x).includes('500000')),
  `hint=${issuedRow(sA)?.hint} notes=${JSON.stringify(sA?.notes)}`)
eq('drill-down ردیف شامل اعتبار دستی نیست (همان predicate ردیف)', drillSum(sA), issuedRow(sA)?.amount ?? -1)

// ---------------------------------------------------------------------------
console.log('\n(ب) همان اعتبار دستی روی فاکتور امروز مصرف شود')
const invB = await safe('فروش ۱٬۰۰۰٬۰۰۰ = ۵۰۰٬۰۰۰ نقد + ۵۰۰٬۰۰۰ اعتبار', () => sale(1000000, 500000, { storeCreditCode: m1Code }))
eq('اعتبار کامل مصرف شد', Number(creditByCode(m1Code)?.usedAmount ?? 0), 500000)
const sB = await report()
closed(sB, 'پل بعد از مصرف اعتبار دستی بسته است')
eq('ردیف مصرف اعتبار +۵۰۰٬۰۰۰', (rowsOf(sB).storeCreditUsed ?? 0) - (rowsOf(sA).storeCreditUsed ?? 0), 500000)

// ---------------------------------------------------------------------------
console.log('\n(ب۲) صدور گروهی: دو اعتبار MANUAL و دو اعتبار EXCHANGE بی‌سند')
await safe('bulk MANUAL', () => storeCreditService.bulkIssue({ count: 2, amountEach: 100000, userId, managerPassword: PW }))
await safe('bulk EXCHANGE بی‌سند', () => storeCreditService.bulkIssue({ count: 2, amountEach: 70000, source: 'EXCHANGE', userId, managerPassword: PW }))
const sB2 = await report()
closed(sB2, 'پل بعد از صدور گروهی بسته است')
eq('گزارش اعتبار: صادرشده +۳۴۰٬۰۰۰', sB2?.storeCredits?.issued - sB?.storeCredits?.issued, 340000)
eq('ردیف پل تغییر نکرد', (rowsOf(sB2).storeCreditIssued ?? 0) - (rowsOf(sB).storeCreditIssued ?? 0), 0)

// ---------------------------------------------------------------------------
console.log('\n(ج) برگشت با اعتبار خرید + مصرف جزئی اعتبار یک‌بارمصرف در همان روز')
const invC = await safe('فروش نقدی ۱٬۰۰۰٬۰۰۰', () => sale(1000000, 1000000))
const sC0 = await report()
closed(sC0, 'پل پیش از برگشت بسته است')
await safe('برگشت کامل قلم با اعتبار خرید', () => salesService.createReturn({
  invoiceId: invC?.id, full: false, lines: [{ saleItemId: itemsOf(invC?.id)[0]?.id, qty: 1 }],
  refundMethod: RefundMethod.STORE_CREDIT, refundAmount: 1000000, userId, shiftId
}))
const rc = seed.rows('SELECT * FROM "StoreCredit" WHERE returnId IS NOT NULL ORDER BY id DESC')[0]
eq('اعتبار برگشتی ۱٬۰۰۰٬۰۰۰ صادر شد', Number(rc?.amount ?? 0), 1000000)
const sC1 = await report()
closed(sC1, 'پل بعد از برگشت با اعتبار بسته است')
eq('ردیف پل برای اعتبار برگشتی واقعی −۱٬۰۰۰٬۰۰۰ (سند‌دار همچنان کم می‌شود)',
  (rowsOf(sC1).storeCreditIssued ?? 0) - (rowsOf(sC0).storeCreditIssued ?? 0), -1000000)
eq('drill-down ردیف = مبلغ ردیف (فقط سند‌دار)', drillSum(sC1), issuedRow(sC1)?.amount ?? -1)
truthy('drill-down اعتبار برگشتی را دارد', (issuedRow(sC1)?.sources ?? []).some((r) => r.id === rc?.id))
await safe('مصرف جزئی ۴۰۰٬۰۰۰ از اعتبار یک‌بارمصرف', () => sale(400000, 0, { storeCreditCode: rc?.code }))
const parent = creditByCode(rc?.code)
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
truthy('هیچ بارکد جانشینی ساخته نشد', !parent?.remainderCreditId)
eq('باقی‌مانده روی همان بارکد ماند', Number(parent?.amount ?? 0) - Number(parent?.usedAmount ?? 0), 600000)
eq('و وضعیتش «مصرف جزئی» است', String(parent?.status ?? ''), 'PARTIALLY_USED')
const rem = null
const sC2 = await report()
closed(sC2, 'پل بعد از مصرف جزئی (باقی‌مانده) بسته است')
eq('ردیف پل برای باقی‌مانده تغییر نکرد', (rowsOf(sC2).storeCreditIssued ?? 0) - (rowsOf(sC1).storeCreditIssued ?? 0), 0)
truthy('drill-down هیچ سند تازه‌ای اضافه نکرد', (issuedRow(sC2)?.sources ?? []).length === (issuedRow(sC1)?.sources ?? []).length)
/**
 * نشست ۱۸۴ — «پنهان شدن» دیگر ممکن نیست: باقی‌مانده رکورد جدایی ندارد که
 * بشود جا انداختش. مانده‌ی همان بارکد همیشه `amount − usedAmount` است.
 */
eq('باقی‌مانده روی همان سند خواناست', Number(parent?.amount ?? 0) - Number(parent?.usedAmount ?? 0), 600000)

// ---------------------------------------------------------------------------
console.log('\n(ج۲) اعتبار برگشتی دو روز پیش، مصرف جزئی امروز')
const invD = await safe('فروش نقدی ۸۰۰٬۰۰۰', () => sale(800000, 800000))
await safe('برگشت با اعتبار ۸۰۰٬۰۰۰', () => salesService.createReturn({
  invoiceId: invD?.id, full: false, lines: [{ saleItemId: itemsOf(invD?.id)[0]?.id, qty: 1 }],
  refundMethod: RefundMethod.STORE_CREDIT, refundAmount: 800000, userId, shiftId
}))
const rd = seed.rows('SELECT * FROM "StoreCredit" WHERE returnId IS NOT NULL AND id <> ? ORDER BY id DESC', rc?.id ?? -1)[0]
const t2 = Date.now() - 86400000 * 2
const j2 = toJalaliDate(new Date(t2))
sql.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t2, j2, invD?.id)
sql.prepare('UPDATE "Payment" SET paidAt=?, paidAtJalali=?, createdAt=? WHERE invoiceId=?').run(t2, j2, t2, invD?.id)
sql.prepare('UPDATE "SaleReturn" SET returnedAt=?, returnedAtJalali=? WHERE invoiceId=?').run(t2, j2, invD?.id)
sql.prepare('UPDATE "StoreCredit" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t2, j2, rd?.id ?? -1)
const sD0 = await report()
closed(sD0, 'پل پس از انتقال سند به دو روز پیش بسته است')
await safe('مصرف جزئی ۳۰۰٬۰۰۰ امروز', () => sale(300000, 0, { storeCreditCode: rd?.code }))
const sD1 = await report()
closed(sD1, 'پل بعد از مصرف جزئی اعتبار قدیمی بسته است')
eq('ردیف مصرف +۳۰۰٬۰۰۰', (rowsOf(sD1).storeCreditUsed ?? 0) - (rowsOf(sD0).storeCreditUsed ?? 0), 300000)
eq('ردیف صادرشده‌ی پل تغییر نکرد', (rowsOf(sD1).storeCreditIssued ?? 0) - (rowsOf(sD0).storeCreditIssued ?? 0), 0)
// نشست ۱۸۴ — مصرف جزئی دیگر سند تازه‌ای نمی‌سازد، پس «صادرشده»ی بازه تکان نمی‌خورد.
eq('مصرف جزئی هیچ اعتبار تازه‌ای به «صادرشده»ی بازه اضافه نمی‌کند',
  (sD1?.storeCredits?.issued ?? 0) - (sD0?.storeCredits?.issued ?? 0), 0)

console.log(`\nنتیجه: ${ok} موفق، ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
