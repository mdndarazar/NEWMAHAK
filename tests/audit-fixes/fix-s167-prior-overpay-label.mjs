/**
 * ===========================================================================
 * نشست ۱۶۷ · S162-D3 (نمایشی، بدون تغییر هیچ عدد) — برچسب جدای «اضافه‌دریافت روی فاکتور دوره‌ی قبل».
 *
 * مسئله: پرداخت امروز روی فاکتور دیروز با اضافه‌دریافت ۶۰۰ کلاً داخل «وصول نسیه‌ی دوره‌ی قبل» (۷۰۰) می‌نشیند
 * (طراحی نشست ۵۸ · C4؛ پل بسته است). ولی در گزارش امروز هیچ جا گفته نمی‌شد که ۶۰۰ از این ۷۰۰ اضافه‌دریافت
 * است و فروش نیست ⇒ مدیر نمی‌بیند فروشنده امروز پولِ بیش از بدهی گرفته است.
 *
 * رفع (S167-D1): totals.priorPeriodOverpay (فقط ردیف‌هایی که در priorPeriod جمع می‌شوند) ⇒
 *   statements.credit.settledPriorOverpay ⇒ hint پل priorCreditSettlements پسوند «شامل X ریال اضافه‌دریافت …»
 *   ⇒ ردیف sign=0 در بلوک ۶ (AccountingBlocks.tsx). هیچ عدد پل/صندوق نباید عوض شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s167-prior-overpay-label.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s167-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => { if (v) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) } }
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

const HOUR = 3_600_000
const userId = seed.user('مدیر تست ۱۶۷')
const cat = seed.category('پوشاک ۱۶۷')
const product = seed.product('شلوار ۱۶۷', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const Yat = Date.now() - 30 * HOUR
const yday = toJalaliDate(new Date(Yat))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - HOUR, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const yesterdaySale = async (paid) => {
  const a = variant(600), b = variant(400)
  const inv = await salesService.create({ userId, shiftId, lines: [line(a, 600), line(b, 400)], payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : [] })
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?').run(Yat, yday, Yat, inv.id)
  sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ?, createdAt = ? WHERE invoiceId = ?').run(Yat, yday, Yat, inv.id)
  return { inv, items: itemsOf(inv.id) }
}
const pay = (invoiceId, amount, extra = {}) => salesService.addPayment({ invoiceId, amount, methodId: cash, destination: 'CASH', userId, ...extra })
const accOf = async (d) => (await salesService.reportRows({ fromJalali: d, toJalali: d })).accounting
const row = (acc, key) => acc?.bridge?.rows?.find((r) => r.key === key)
const amt = (acc, key) => Number(row(acc, key)?.amount ?? 0)
const numbers = (acc) => JSON.stringify({
  bridge: (acc?.bridge?.rows ?? []).map((r) => [r.key, r.sign * r.amount]),
  unexplained: acc?.bridge?.unexplained,
  cash: acc?.cash?.netCashMovement,
  settledPrior: acc?.credit?.settledPrior,
  settledPriorCash: acc?.credit?.settledPriorCash
})

// ===========================================================================
console.log('\n۱) نسیه‌ی دیروز ۱٬۰۰۰ (۳۰۰ پرداخت دیروز) ⇒ برگشت ۶۰۰ امروز ⇒ بدهی ۱۰۰ ⇒ دریافت ۷۰۰ با تأیید (اضافه‌دریافت ۶۰۰)')
const A = await safe('فروش دیروز', () => yesterdaySale(300))
await safe('برگشت ۶۰۰', () => salesService.createReturn({ invoiceId: A.inv.id, full: false, lines: [{ saleItemId: A.items[0].id, qty: 1 }], refundMethod: RefundMethod.NONE, userId }))
const pA = await safe('دریافت ۷۰۰ با تأیید', () => pay(A.inv.id, 700, { confirmOverpay: true }))
eq('اضافه‌دریافت روی پرداخت', pA?.overpayAmount, 600)
let t = await accOf(today)
// عددهای پل همان طراحی ۵۸ · C4 باقی می‌مانند (S162-D3)
eq('پل امروز بسته', t?.bridge?.unexplained, 0)
eq('وصول نسیه‌ی دوره‌ی قبل ۷۰۰ (بدون تغییر عدد)', amt(t, 'priorCreditSettlements'), 700)
eq('ردیف overpayReceived امروز ۰ (بدون دوبار کسر)', amt(t, 'overpayReceived'), 0)
// رفع
eq('statements.credit.settledPriorOverpay = ۶۰۰', t?.credit?.settledPriorOverpay, 600)
const hint = String(row(t, 'priorCreditSettlements')?.hint ?? '')
truthy('hint پل «وصول نسیه‌ی دوره‌ی قبل» مبلغ ۶۰۰ اضافه‌دریافت را صریح می‌گوید', hint.includes('600') && hint.includes('اضافه‌دریافت'))
truthy('hint صریحاً «فروش نیست»', hint.includes('فروش نیست'))
const snap1 = numbers(t)

console.log('\n۲) کنترل: اضافه‌دریافت روی فاکتور *امروز* در این عدد نمی‌آید (ردیف overpayReceived خودش را دارد)')
const v = variant(500)
const invT = await safe('فروش امروز ۵۰۰ نسیه', () => salesService.create({ userId, shiftId, lines: [line(v, 500)], payments: [] }))
await safe('دریافت ۸۰۰ با تأیید', () => pay(invT.id, 800, { confirmOverpay: true }))
t = await accOf(today)
eq('پل امروز بسته', t?.bridge?.unexplained, 0)
eq('overpayReceived امروز ۳۰۰', amt(t, 'overpayReceived'), 300)
eq('settledPriorOverpay هنوز ۶۰۰', t?.credit?.settledPriorOverpay, 600)

console.log('\n۳) کنترل: وصول دوره‌ی قبل *بدون* اضافه‌دریافت ⇒ پسوند hint ظاهر نمی‌شود')
const B = await safe('نسیه‌ی دیروز دیگر', () => yesterdaySale(0))
const acc0 = await (async () => {
  // جدا: فقط این فاکتور در دیتابیس تازه نیست؛ پس فقط تغییر عدد را می‌سنجیم
  await pay(B.inv.id, 200)
  return accOf(today)
})()
eq('settledPriorOverpay بدون تغییر ۶۰۰ (وصول ۲۰۰ اضافه ندارد)', acc0?.credit?.settledPriorOverpay, 600)
eq('وصول دوره‌ی قبل ۹۰۰', amt(acc0, 'priorCreditSettlements'), 900)

console.log('\n۴) ابطال پرداخت اضافه‌دار ⇒ برچسب هم صفر می‌شود و پسوند hint حذف')
await safe('ابطال پرداخت ۷۰۰', async () => {
  const fn = salesService.voidPayment ?? salesService.deletePayment ?? salesService.paymentDelete
  if (!fn) throw new Error('تابع ابطال پرداخت پیدا نشد')
  return fn.call(salesService, {
    id: pA?.payment?.id,
    userId,
    reason: 'تست ابطال',
    managerPassword: PW,
    overrideReason: 'ابطال کنترل‌شده برای آزمون برچسب اضافه‌دریافت'
  })
})
t = await accOf(today)
eq('پل امروز بسته', t?.bridge?.unexplained, 0)
eq('settledPriorOverpay = ۰', t?.credit?.settledPriorOverpay, 0)
truthy('hint بدون پسوند اضافه‌دریافت', !String(row(t, 'priorCreditSettlements')?.hint ?? '').includes('اضافه‌دریافت'))

console.log('\n۵) UI: بلوک ۶ ردیف نمایشی sign=0 دارد و در خالص جمع نمی‌شود')
const ui = readFileSync(new URL('../../src/renderer/src/components/AccountingBlocks.tsx', import.meta.url), 'utf8')
const uiLine = ui.split('\n').find((l) => l.includes('settledPriorOverpay')) ?? ''
truthy('ردیف settledPriorOverpay در AccountingBlocks.tsx', uiLine.length > 0)
truthy('ردیف با sign={0} (فقط نمایشی)', uiLine.includes('sign={0}'))
truthy('برچسب «فروش نیست»', uiLine.includes('فروش نیست'))

console.log('\nSNAPSHOT-NUMBERS (باید قبل/بعد از رفع یکسان باشد): ' + snap1)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
