/**
 * ===========================================================================
 * نشست ۴ زنجیره رفع (نشست ۵۹) — خوشه B + بقیه‌ی خوشه C (پل تطبیق)
 *
 *   B/۴-۵۴ — بازپرداخت نقدی/کارتی/کارت‌به‌کارت برگشت و تعویض: هر کدام ردیف مستقل منفی
 *   C      — ردیف غلط «برگشت کاهنده‌ی بدهی (+)» حذف؛ برگشت روی فاکتور دوره‌ی قبل (−)
 *   ۴-۱۰   — تعویض = برگشت + فروش جدید در صورت تعهدی (کالای برگشتی تعویض کم می‌شود)
 *   B/۴-۹  — Payment منفی برای بازپرداخت تعویض ساخته نمی‌شود؛ paidTotal سند تعویض درست؛
 *            ترمیم idempotent داده‌ی قدیمی با Audit؛ دفتر رویداد دوبار از نقد کم نمی‌کند
 *   B/D    — سقف بازپرداخت همه‌ی روش‌ها (کارت‌به‌کارت در انتظار/پرداخت‌شده هم) و سقف اعتبار (۴-۳۷)
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s59-bridge-exchange.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s59-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const salesMod = await import('../../src/main/services/SalesService.ts')
const { salesService, saleWhere } = salesMod
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const throwsWith = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

const userId = seed.user('مدیر تست نشست ۵۹')
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
const invRow = (id) => seed.one('SELECT paidTotal, settledAt FROM "SaleInvoice" WHERE id = ?', id)
const payRows = (invoiceId) => seed.rows('SELECT id, amount, overpayAmount FROM "Payment" WHERE invoiceId = ? ORDER BY seq, id', invoiceId)
const overpaySum = (invoiceId) => payRows(invoiceId).reduce((s, p) => s + Number(p.overpayAmount ?? 0), 0)
/** فاکتور دو قلمی ۶۰۰ + ۴۰۰ = ۱٬۰۰۰ با پرداخت اولیه‌ی دلخواه (نسیه) */
const twoItemSale = async (paid) => {
  const a = variant(600); const b = variant(400)
  return salesService.create({
    userId, shiftId,
    lines: [{ variantId: a, qty: 1, unitPrice: 600, discount: 0, tax: 0 }, { variantId: b, qty: 1, unitPrice: 400, discount: 0, tax: 0 }],
    payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : []
  })
}
const ret = (invoiceId, saleItemId, refundMethod = RefundMethod.NONE, refundAmount = undefined) =>
  salesService.createReturn({ invoiceId, full: false, lines: [{ saleItemId, qty: 1 }], refundMethod, refundAmount, confirmOverpay: true, userId })
const pay = (invoiceId, amount, extra = {}) =>
  salesService.addPayment({ invoiceId, amount, methodId: cash, destination: 'CASH', userId, ...extra })
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  })
  return statements
}
const creditRowOf = async (id) => (await salesService.creditList({ fromJalali: today, toJalali: today, includeSettled: true })).rows.find((r) => r.id === id)


const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارت', kind: 'CARD', isActive: 1, sortOrder: 2 })
const rowsOf = (s) => Object.fromEntries(s.bridge.rows.map((r) => [r.key, r.sign * r.amount]))
let last = null
/** اجرای یک سناریو و برگرداندن تغییر ردیف‌های پل/صورت تعهدی نسبت به قبل از آن */
const step = async (label, fn) => {
  const before = last ?? (await report())
  let res = null
  try { res = await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`) }
  const after = await report()
  last = after
  const b = rowsOf(before), a = rowsOf(after)
  const d = {}
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) d[k] = (a[k] ?? 0) - (b[k] ?? 0)
  d.target = after.bridge.target - before.bridge.target
  d.gross = after.invoice.grossSales - before.invoice.grossSales
  d.exchangeReturned = after.invoice.exchangeReturned - before.invoice.exchangeReturned
  return { d, after, res }
}
const closed = (s) => eq('پل تطبیق بسته است (مانده‌ی بی‌توضیح)', s.bridge.unexplained, 0)
const back = (id) => {
  const t = Date.now() - 86400000 * 2
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t, toJalaliDate(new Date(t)), id)
  sql.prepare('UPDATE "Payment" SET paidAt=?, paidAtJalali=? WHERE invoiceId=?').run(t, toJalaliDate(new Date(t)), id)
}
const exch = async (paid, price, mode, method = cash, extra = {}) => {
  const inv = await twoItemSale(paid)
  const v = variant(price)
  const r = await salesService.createExchange({
    invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
    replacements: [{ variantId: v, qty: 1 }], refundMode: mode, methodId: method, userId, shiftId,
    ...extra
  })
  return { inv, r }
}
const exDocOf = (sourceId) => seed.one('SELECT id, paidTotal, settledAt FROM "SaleInvoice" WHERE sourceInvoiceId = ? ORDER BY id DESC', sourceId)

// ===========================================================================
console.log('\n— ۱) برگشت با بازپرداخت نقدی ۶۰۰ روی فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ (مثال handoff)')
{
  const { d, after } = await step('برگشت نقدی', async () => { const inv = await twoItemSale(1000); await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.CASH, 600) })
  eq('ردیف «بازپرداخت نقدی برگشت» = ۶۰۰ (علامت −)', d.cashRefunds, -600)
  closed(after)
}
console.log('\n— ۲) برگشت با کارت‌به‌کارت ۶۰۰')
{
  const { d, after } = await step('کارت‌به‌کارت', async () => { const inv = await twoItemSale(1000); await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.CARD_TO_CARD, 600) })
  eq('ردیف «بازپرداخت کارت‌به‌کارت برگشت» = ۶۰۰ (−)', d.cardToCardRefunds, -600)
  closed(after)
}
console.log('\n— ۳) برگشت بدون بازپرداخت روی فاکتور نسیه‌ی پرداخت‌نشده (کاهش بدهی) — دوبار شمرده نشود')
{
  const { d, after } = await step('کاهش بدهی', async () => { const inv = await twoItemSale(0); await ret(inv.id, itemsOf(inv.id)[0].id) })
  eq('ردیف قدیمی «برگشت کاهنده‌ی بدهی (+)» دیگر در پل نیست', after.bridge.rows.some((r) => r.key === 'debtOnlyReturns'), false)
  eq('نسیه‌ی وصول‌نشده فقط ۴۰۰ بالا رفت', d.uncollectedCredit, 400)
  closed(after)
}
console.log('\n— ۴) پرداخت ۵۰۰ + برگشت ۶۰۰ با بازپرداخت نقدی ۵۰۰: تا بدهی مانده، نقد از صندوق خارج نمی‌شود')
{
  const inv = await twoItemSale(500)
  const r4 = await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.CASH, 500)
  const row4 = seed.one('SELECT refundAmount, refundMethod FROM "SaleReturn" WHERE id = ?', r4.id)
  eq('خروج نقد فقط ۱۰۰ (پول ۵۰۰ − کالای مانده ۴۰۰)', Number(row4?.refundAmount ?? -1), 100)
  eq('روش نقد ماند', String(row4?.refundMethod ?? ''), RefundMethod.CASH)
  last = null
}
console.log('\n— ۵) برگشت امروز روی فاکتور پرداخت‌شده‌ی دو روز پیش، بدون بازپرداخت')
{
  const { d, after } = await step('دوره‌ی قبل', async () => { const inv = await twoItemSale(1000); back(inv.id); await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.NONE) })
  eq('ردیف «برگشت روی فاکتور دوره‌ی قبل» = ۶۰۰ (−)', d.priorDebtReturns, -600)
  closed(after)
}
console.log('\n— ۶) برگشت امروز روی فاکتور دو روز پیش با بازپرداخت نقدی ۶۰۰')
{
  const { d, after } = await step('دوره‌ی قبل نقدی', async () => { const inv = await twoItemSale(1000); back(inv.id); await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.CASH, 600) })
  eq('بازپرداخت نقدی = ۶۰۰', d.cashRefunds, -600)
  eq('ردیف دوره‌ی قبل صفر ماند (بازپرداخت دوبار شمرده نشد)', d.priorDebtReturns ?? 0, 0)
  closed(after)
}
console.log('\n— ۷) مثال مالک بند ۴-۱۰: فاکتور ۱٬۰۰۰٬۰۰۰، تعویض با کالای ۱٬۳۰۰٬۰۰۰')
{
  const { d, after } = await step('تعویض ۴-۱۰', async () => {
    const a = variant(1_000_000)
    const inv = await salesService.create({ userId, shiftId, lines: [{ variantId: a, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
    const v = variant(1_300_000)
    await salesService.createExchange({ invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }], replacements: [{ variantId: v, qty: 1 }], methodId: cash, userId, shiftId })
  })
  eq('ناخالص گزارش ۲٬۳۰۰٬۰۰۰', d.gross, 2_300_000)
  eq('برگشتی «از تعویض» ۱٬۰۰۰٬۰۰۰', d.exchangeReturned, 1_000_000)
  eq('خالص ۱٬۳۰۰٬۰۰۰', d.target, 1_300_000)
  closed(after)
}
console.log('\n— ۸) تعویض ۶۰۰ ⇒ ۲۰۰ با بازپرداخت نقدی ۴۰۰ (Payment منفی نه)')
{
  let src = null
  const { d, after } = await step('تعویض نقدی', async () => { src = (await exch(1000, 200, 'CASH')).inv })
  const doc = exDocOf(src.id)
  eq('هیچ Payment منفی روی سند تعویض ساخته نشد', seed.one('SELECT COUNT(*) AS c FROM "Payment" WHERE invoiceId = ? AND amount < 0', doc.id).c, 0)
  eq('paidTotal سند تعویض = ۲۰۰ (ارزش کالای برگشتی)', Number(doc.paidTotal), 200)
  eq('سند تعویض تسویه‌شده است', doc.settledAt != null, true)
  eq('CashMovement بازپرداخت تعویض = ۴۰۰', Number(seed.one(`SELECT COALESCE(SUM(amount),0) AS s FROM "CashMovement" WHERE type = 'EXCHANGE_REFUND' AND refType = 'SaleReturn' AND refId = (SELECT id FROM "SaleReturn" WHERE exchangeInvoiceId = ?)`, doc.id).s), 400)
  eq('ردیف «بازپرداخت نقدی مابه‌التفاوت تعویض» = ۴۰۰ (−)', d.exchangeCashRefunds, -400)
  eq('نسیه‌ی کاذب ساخته نشد', d.uncollectedCredit ?? 0, 0)
  closed(after)
  const led = await salesLedger.ledger({ fromJalali: today, toJalali: today })
  const exRows = led.rows.filter((r) => r.invoiceId === doc.id)
  eq('دفتر رویداد: اثر نقدی سند تعویض دقیقاً −۴۰۰ (نه −۸۰۰)', exRows.reduce((s, r) => s + r.cashEffect, 0), -400)
}
console.log('\n— ۹) تعویض با بازپرداخت کارتی ۴۰۰ با override مدیر')
{
  const { d, after } = await step('تعویض کارتیِ تأییدشده', async () => {
    await exch(1000, 200, 'CARD', card, {
      cardPosOverride: {
        managerPassword: DEFAULT_MANAGER_PASSWORD,
        reason: 'تست ثبت استثنایی بازپرداخت پوز در تعویض',
        acknowledgedNoReverse: true
      }
    })
  })
  eq('ردیف «بازپرداخت کارتی مابه‌التفاوت تعویض» = ۴۰۰ (−)', d.exchangeCardRefunds, -400)
  closed(after)
}
console.log('\n— ۱۰) تعویض با کارت‌به‌کارت ۴۰۰')
{
  const { d, after } = await step('تعویض کارت‌به‌کارت', async () => { await exch(1000, 200, 'CARD_TO_CARD') })
  eq('ردیف «کارت‌به‌کارت مابه‌التفاوت تعویض» = ۴۰۰ (−)', d.exchangeCardToCardRefunds, -400)
  closed(after)
}
console.log('\n— ۱۱) تعویض ۶۰۰ ⇒ ۹۰۰ روی فاکتور نسیه‌ی پرداخت‌نشده (مشتری ۳۰۰ می‌دهد)')
{
  const { d, after } = await step('تعویض نسیه', async () => { await exch(0, 900) })
  eq('خالص +۱٬۳۰۰ (۱٬۰۰۰ + ۹۰۰ − ۶۰۰)', d.target, 1300)
  closed(after)
}
console.log('\n— ۱۲) کارت‌به‌کارت هم تا وقتی بدهی مانده باشد از صندوق خارج نمی‌شود')
{
  const inv = await twoItemSale(500)
  const it = itemsOf(inv.id)
  const r12 = await ret(inv.id, it[0].id, RefundMethod.CARD_TO_CARD, 500)
  const row12 = seed.one('SELECT refundAmount, refundMethod FROM "SaleReturn" WHERE id = ?', r12.id)
  eq('کارت‌به‌کارت فقط ۱۰۰', Number(row12?.refundAmount ?? -1), 100)
  last = null
}
console.log('\n— ۱۳) بند ۴-۳۷: اعتبار خرید برای فاکتور نسیه‌ی پرداخت‌نشده صادر نمی‌شود')
{
  const inv = await twoItemSale(0)
  const r13a = await ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.STORE_CREDIT, 600)
  eq('نسیهٔ صفرپرداخت: اعتبار صادر نشد (NONE)', seed.one('SELECT refundMethod FROM "SaleReturn" WHERE id = ?', r13a.id).refundMethod, RefundMethod.NONE)
  const inv2 = await twoItemSale(300)
  const r13b = await ret(inv2.id, itemsOf(inv2.id)[0].id, RefundMethod.STORE_CREDIT, 600)
  eq('نسیهٔ ۳۰۰: هنوز بدهی ⇒ اعتبار صادر نشد', seed.one('SELECT refundMethod FROM "SaleReturn" WHERE id = ?', r13b.id).refundMethod, RefundMethod.NONE)
  eq('و مبلغ اعتبار صفر', Number(seed.one('SELECT refundAmount FROM "SaleReturn" WHERE id = ?', r13b.id).refundAmount ?? -1), 0)
  const inv3 = await twoItemSale(1000)
  const ok3 = await safe('ولی روی فاکتور تسویه‌شده، اعتبار تا سقف پول دریافتی مجاز است', () =>
    ret(inv3.id, itemsOf(inv3.id)[0].id, RefundMethod.STORE_CREDIT, 300)
  )
  eq('برگشت با اعتبار ۳۰۰ ثبت شد', !!ok3, true)
  last = null
}
console.log('\n— ۱۴) ترمیم داده‌ی قدیمی: Payment منفی روی سند تعویض قدیمی')
{
  const { inv } = await exch(1000, 200, 'CASH')
  const doc = exDocOf(inv.id)
  // شبیه‌سازی داده‌ی قبل از نشست ۵۹: پرداختی منفی −۴۰۰ و paidTotal = −۲۰۰
  seed.insert('Payment', { invoiceId: doc.id, methodId: cash, amount: -400, kind: 'CASH', seq: 9, paidAt: Date.now(), paidAtJalali: today, overpayAmount: 0 })
  sql.prepare('UPDATE "SaleInvoice" SET paidTotal = -200, settledAt = NULL WHERE id = ?').run(doc.id)
  const fn = salesMod.repairLegacyNegativePayments
  eq('تابع ترمیم وجود دارد', typeof fn, 'function')
  if (typeof fn === 'function') {
    const r1 = await fn()
    eq('یک سند ترمیم شد', r1.fixed, 1)
    eq('paidTotal سند = ۲۰۰', Number(exDocOf(inv.id).paidTotal), 200)
    eq('سند دوباره تسویه‌شده', exDocOf(inv.id).settledAt != null, true)
    eq('ردیف منفی حذف نشد (سند مالی پاک نمی‌شود)', seed.one('SELECT COUNT(*) AS c FROM "Payment" WHERE invoiceId = ? AND amount < 0', doc.id).c, 1)
    eq('Audit ترمیم ثبت شد', seed.one(`SELECT COUNT(*) AS c FROM "AuditLog" WHERE entity = 'SaleInvoice' AND entityId = ? AND note LIKE '%ترمیم خودکار%'`, doc.id).c >= 1, true)
    const r2 = await fn()
    eq('اجرای دوم هیچ تغییری نمی‌دهد (idempotent)', r2.fixed, 0)
  }
  const s = await report()
  closed(s)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
