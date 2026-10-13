/**
 * ===========================================================================
 * نشست ۵ زنجیره رفع (نشست ۶۰) — باقی خوشه B: تعویض روی فاکتور نسیه/نیمه‌پرداخت
 *
 *   ۴-۵  — مابه‌التفاوت منفی تعویض «به‌جای پول، کاهش بدهی» فاکتور اصلی؛ مسیر خروج نقد
 *          برای بخشی که مشتری هنوز بدهکار است باز نیست.
 *   ۴-۳۷ — اعتبار خرید فقط برای پولی که واقعاً دریافت شده.
 *   ۴-۹/۴-۵۴ — بخش بازپرداخت‌شده (اضافه بر بدهی) دقیقاً یک‌بار در پل/دفتر رویداد/صورت برگشت.
 *   پل تطبیق در همه‌ی سناریوها (از جمله فاکتور دوره‌ی قبل) بسته.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s60-exchange-debt.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s60-'))
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

const userId = seed.user('مدیر تست نشست ۶۰')
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
  d.retExCash = (after.returns?.exchangeCashRefunds ?? 0) - (before.returns?.exchangeCashRefunds ?? 0)
  d.retExCredit = (after.returns?.exchangeStoreCreditIssued ?? 0) - (before.returns?.exchangeStoreCreditIssued ?? 0)
  return { d, after, res }
}
const closed = (s) => eq('پل تطبیق بسته است (مانده‌ی بی‌توضیح)', s.bridge.unexplained, 0)
const back = (id) => {
  const t = Date.now() - 86400000 * 2
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t, toJalaliDate(new Date(t)), id)
  sql.prepare('UPDATE "Payment" SET paidAt=?, paidAtJalali=? WHERE invoiceId=?').run(t, toJalaliDate(new Date(t)), id)
}
const exch = async (paid, price, mode, method = cash) => {
  const inv = await twoItemSale(paid)
  const v = variant(price)
  const r = await salesService.createExchange({
    invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
    replacements: [{ variantId: v, qty: 1 }], refundMode: mode, methodId: method, userId, shiftId
  })
  return { inv, r }
}
const exDocOf = (sourceId) => seed.one('SELECT id, paidTotal, settledAt FROM "SaleInvoice" WHERE sourceInvoiceId = ? ORDER BY id DESC', sourceId)


const retOf = (sourceId) => seed.one('SELECT * FROM "SaleReturn" WHERE invoiceId = ? AND kind = \'EXCHANGE\' ORDER BY id DESC', sourceId)
const cashMoveOf = (retId) => Number(seed.one(`SELECT COALESCE(SUM(amount),0) AS s FROM "CashMovement" WHERE type = 'EXCHANGE_REFUND' AND refType = 'SaleReturn' AND refId = ?`, retId).s)
const creditCount = () => Number(seed.one('SELECT COUNT(*) AS c FROM "StoreCredit"').c)
const remainingOfInv = async (id) => (await creditRowOf(id))?.remaining ?? 0
const exchNoMode = async (paid, price) => {
  const inv = await twoItemSale(paid)
  const v = variant(price)
  const r = await salesService.createExchange({
    invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
    replacements: [{ variantId: v, qty: 1 }], methodId: cash, userId, shiftId
  })
  return { inv, r }
}
const exchangeCashEffect = async (retId) => {
  const led = await salesLedger.ledger({ fromJalali: today, toJalali: today })
  return led.rows.filter((r) => r.key === `EXP-${retId}` || r.key === `EXR-${retId}`).reduce((s, r) => s + r.cashEffect, 0)
}

// ===========================================================================
console.log('\n— ۱) نسیه‌ی پرداخت‌نشده ۱٬۰۰۰، تعویض ۶۰۰ ⇒ ۲۰۰ با انتخاب «نقد» (پیش‌فرض UI)')
{
  let src = null, res = null
  const { d, after } = await step('تعویض روی نسیه', async () => { const x = await exch(0, 200, 'CASH'); src = x.inv; res = x.r })
  const r = src ? retOf(src.id) : null
  eq('هیچ پولی از کشو خارج نشد (CashMovement بازپرداخت = ۰)', r ? cashMoveOf(r.id) : -1, 0)
  eq('کاهش بدهی فاکتور اصلی روی سند = ۴۰۰', Number(r?.debtReduction ?? -1), 400)
  eq('مبلغ بازپرداخت روی سند = ۰', Number(r?.refundAmount ?? -1), 0)
  eq('وضعیت تسویه = DEBT_REDUCTION', r?.exchangeSettlement, 'DEBT_REDUCTION')
  eq('نتیجه‌ی تعویض: cashRefunded = ۰', res?.cashRefunded, 0)
  eq('نتیجه‌ی تعویض: debtReduction = ۴۰۰', res?.debtReduction, 400)
  eq('باقی‌مانده‌ی بدهی فاکتور اصلی ۱٬۰۰۰ ⇒ ۶۰۰', src ? await remainingOfInv(src.id) : -1, 600)
  eq('ردیف بازپرداخت نقدی تعویض در پل تغییر نکرد', d.exchangeCashRefunds ?? 0, 0)
  eq('نسیه‌ی وصول‌نشده فقط ۶۰۰ بالا رفت (نه ۱٬۰۰۰)', d.uncollectedCredit ?? 0, 600)
  eq('دفتر رویداد: اثر نقدی تعویض = ۰', r ? await exchangeCashEffect(r.id) : -1, 0)
  eq('صورت برگشت: بازپرداخت نقدی تعویض = ۰', d.retExCash, 0)
  eq('صورت برگشت: اعتبار صادرشده‌ی تعویض = ۰ (کاهش بدهی اعتبار نیست)', d.retExCredit, 0)
  closed(after)
}
console.log('\n— ۲) همان سناریو بدون انتخاب روش (چیزی برای پرداخت نیست ⇒ نباید خطا بدهد)')
{
  let res = null
  const { after } = await step('بدون روش', async () => { res = (await exchNoMode(0, 200)).r })
  eq('تعویض ثبت شد', !!res, true)
  eq('debtReduction = ۴۰۰', res?.debtReduction, 400)
  closed(after)
}
console.log('\n— ۳) بند ۴-۳۷: روی نسیه‌ی پرداخت‌نشده «اعتبار خرید» صادر نمی‌شود، فقط بدهی کم می‌شود')
{
  const before = creditCount()
  let src = null
  const { after } = await step('اعتبار روی نسیه', async () => { src = (await exch(0, 200, 'STORE_CREDIT')).inv })
  eq('هیچ اعتبار خریدی صادر نشد', creditCount() - before, 0)
  eq('کاهش بدهی = ۴۰۰', Number(src ? retOf(src.id)?.debtReduction : -1), 400)
  closed(after)
}
console.log('\n— ۴) پرداخت ۷۰۰ (بدهی ۳۰۰)، تعویض ۶۰۰ ⇒ ۱۰۰ با نقد: ۳۰۰ کاهش بدهی + ۲۰۰ بازپرداخت نقدی')
{
  let src = null, res = null
  const { d, after } = await step('ترکیبی', async () => { const x = await exch(700, 100, 'CASH'); src = x.inv; res = x.r })
  const r = src ? retOf(src.id) : null
  eq('CashMovement بازپرداخت = ۲۰۰ (نه ۵۰۰)', r ? cashMoveOf(r.id) : -1, 200)
  eq('کاهش بدهی = ۳۰۰', Number(r?.debtReduction ?? -1), 300)
  eq('refundAmount = ۲۰۰', Number(r?.refundAmount ?? -1), 200)
  eq('نتیجه: cashRefunded = ۲۰۰', res?.cashRefunded, 200)
  eq('فاکتور اصلی تسویه شد (باقی‌مانده ۰)', src ? await remainingOfInv(src.id) : -1, 0)
  eq('ردیف پل «بازپرداخت نقدی مابه‌التفاوت تعویض» = ۲۰۰ (−)', d.exchangeCashRefunds, -200)
  eq('دفتر رویداد: اثر نقدی تعویض = −۲۰۰', r ? await exchangeCashEffect(r.id) : -1, -200)
  eq('صورت برگشت: بازپرداخت نقدی تعویض = ۲۰۰', d.retExCash, 200)
  closed(after)
}
console.log('\n— ۵) پرداخت ۷۰۰، تعویض ۶۰۰ ⇒ ۱۰۰ بدون انتخاب روش: فقط برای ۲۰۰ اضافه باید انتخاب کند')
{
  const inv = await twoItemSale(700)
  const v = variant(100)
  await throwsWith('انتخاب روش برای ۲۰۰ ریال اجباری است', () => salesService.createExchange({
    invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
    replacements: [{ variantId: v, qty: 1 }], methodId: cash, userId, shiftId
  }), '۲۰۰')
  last = null
}
console.log('\n— ۶) رگرسیون: فاکتور پرداخت‌شده‌ی ۱٬۰۰۰، تعویض ۶۰۰ ⇒ ۲۰۰ نقد ⇒ ۴۰۰ بازپرداخت، بدون کاهش بدهی')
{
  let src = null
  const { d, after } = await step('پرداخت‌شده', async () => { src = (await exch(1000, 200, 'CASH')).inv })
  const r = src ? retOf(src.id) : null
  eq('CashMovement = ۴۰۰', r ? cashMoveOf(r.id) : -1, 400)
  eq('debtReduction = ۰', Number(r?.debtReduction ?? -1), 0)
  eq('وضعیت = CASH_REFUND', r?.exchangeSettlement, 'CASH_REFUND')
  eq('پل: بازپرداخت نقدی تعویض ۴۰۰ (−)', d.exchangeCashRefunds, -400)
  closed(after)
}
console.log('\n— ۷) پرداخت ۷۰۰، تعویض ۶۰۰ ⇒ ۱۰۰ با اعتبار خرید: اعتبار فقط ۲۰۰ (پول دریافتی اضافه)')
{
  const before = creditCount()
  let src = null
  const { after } = await step('اعتبار ترکیبی', async () => { src = (await exch(700, 100, 'STORE_CREDIT')).inv })
  eq('یک اعتبار صادر شد', creditCount() - before, 1)
  eq('مبلغ اعتبار = ۲۰۰', Number(seed.one('SELECT amount FROM "StoreCredit" ORDER BY id DESC').amount), 200)
  eq('کاهش بدهی = ۳۰۰', Number(src ? retOf(src.id)?.debtReduction : -1), 300)
  closed(after)
}
console.log('\n— ۸) دو تعویض پشت‌سرهم روی یک نسیه‌ی پرداخت‌نشده')
{
  const inv = await twoItemSale(0)
  const it = itemsOf(inv.id)
  await safe('تعویض اول ۶۰۰ ⇒ ۲۰۰', () => salesService.createExchange({ invoiceId: inv.id, lines: [{ saleItemId: it[0].id, qty: 1 }], replacements: [{ variantId: variant(200), qty: 1 }], userId, shiftId }))
  await safe('تعویض دوم ۴۰۰ ⇒ ۱۰۰', () => salesService.createExchange({ invoiceId: inv.id, lines: [{ saleItemId: it[1].id, qty: 1 }], replacements: [{ variantId: variant(100), qty: 1 }], userId, shiftId }))
  eq('باقی‌مانده = ۳۰۰ (مشتری کالای ۲۰۰ + ۱۰۰ را دارد)', await remainingOfInv(inv.id), 300)
  last = null
  closed(await report())
}
console.log('\n— ۹) نسیه‌ی پرداخت‌نشده‌ی دو روز پیش، تعویض امروز ۶۰۰ ⇒ ۲۰۰ (پل گزارش امروز)')
{
  let src = null
  const { d, after } = await step('دوره‌ی قبل', async () => {
    const inv = await twoItemSale(0); back(inv.id); src = inv
    await salesService.createExchange({ invoiceId: inv.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }], replacements: [{ variantId: variant(200), qty: 1 }], refundMode: 'CASH', userId, shiftId })
  })
  eq('هیچ پولی از کشو خارج نشد', src ? cashMoveOf(retOf(src.id).id) : -1, 0)
  eq('ردیف «کاهش بدهی فاکتور دوره‌ی قبل» = ۴۰۰ (−)', d.priorDebtReturns, -400)
  closed(after)
}

console.log('\n— ۱۰) C6 (بند ۴-۲۲): سند برگشتِ تعویض حذف فیزیکی/ویرایش تکی نمی‌شود (گراف تعویض نیمه‌کاره نماند)')
{
  const { inv } = await exch(1000, 200, 'CASH')
  const r = retOf(inv.id)
  const exDoc = exDocOf(inv.id)
  const cmBefore = cashMoveOf(r.id)
  await throwsWith('حذف سند برگشتِ تعویض رد می‌شود', () => salesService.returnDelete({ id: r.id, userId }), 'تعویض')
  await throwsWith('ویرایش سند برگشتِ تعویض رد می‌شود', () => salesService.returnUpdate({ id: r.id, lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 0 }], userId }), 'تعویض')
  eq('سند برگشت تعویض سر جایش است', !!seed.one('SELECT id FROM "SaleReturn" WHERE id = ?', r.id), true)
  eq('سند تعویض سر جایش است', !!seed.one('SELECT id FROM "SaleInvoice" WHERE id = ?', exDoc.id), true)
  eq('بازپرداخت نقدی دست‌نخورده (۴۰۰)', cashMoveOf(r.id), cmBefore)
  // برگشت ساده همچنان «حذف‌شدنی» است؛ از نشست ۶۴ یعنی ابطال با دلیل (بند ۴-۲۲)
  const inv2 = await twoItemSale(1000)
  const simple = await ret(inv2.id, itemsOf(inv2.id)[0].id, RefundMethod.NONE)
  const del = await safe('ابطال مجاز برگشت ساده', () =>
    salesService.returnDelete({
      id: simple.id ?? simple.returnId,
      userId,
      reason: 'ثبت اشتباه',
      panelPassword: DEFAULT_MANAGER_PASSWORD
    })
  )
  eq('برگشت ساده باطل شد', del?.voided === true, true)
  last = null
  closed(await report())
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
