/**
 * ===========================================================================
 * نشست ۳ زنجیره رفع (نشست ۵۸) — خوشه C، بخش دوم: C2 + C3 + C4 (یک PR)
 *
 *   C2 — یک تعریف واحد از «بدهی» (remainingOf): برگشت + بازپرداخت با هم
 *   C3 — یک recalcPaymentOverpay واحد برای ثبت/ویرایش/حذف پرداخت و برگشت
 *   C4 — ردیف «اضافه‌دریافت» با علامت منفی در پل تطبیق، از aggregate واقعی
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s58-remaining.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s58-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
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

const userId = seed.user('مدیر تست نشست ۵۸')
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
  salesService.createReturn({ invoiceId, full: false, lines: [{ saleItemId, qty: 1 }], refundMethod, refundAmount, userId })
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

// ===========================================================================
console.log('\n— C2/الف — مثال بک‌لاگ: فاکتور ۱٬۰۰۰، پرداخت ۳۰۰، برگشت ۶۰۰ (بدون بازپرداخت) ⇒ فقط ۱۰۰ بدهی')
{
  const inv = await twoItemSale(300)
  await ret(inv.id, itemsOf(inv.id)[0].id)
  await throwsWith('دریافت ۷۰۰ بدون تأیید اضافه‌دریافت', () => pay(inv.id, 700), 'بیشتر است')
  const view = await salesService.payments({ invoiceId: inv.id })
  eq('باقی‌مانده در پنجره‌ی پرداختی‌ها', view.remaining, 100)
  eq('وضعیت در پنجره‌ی پرداختی‌ها', view.settlementState, 'PARTIAL')
  const row = await creditRowOf(inv.id)
  eq('باقی‌مانده در تب نسیه', row?.remaining, 100)
  eq('وضعیت در تب نسیه', row?.settlementState, 'PARTIAL')
  const r = await safe('دریافت ۱۰۰', () => pay(inv.id, 100))
  eq('بعد از دریافت ۱۰۰: تسویه', r?.settled, true)
  eq('بعد از دریافت ۱۰۰: اضافه‌دریافت', r?.overpayAmount, 0)
  eq('settledAt فاکتور پر شد', invRow(inv.id).settledAt != null, true)
}

console.log('\n— C2/ب — بازپرداخت نقدی فقط تا مازاد واقعی پس از برگشت محدود می‌شود')
{
  // فاکتور ۱٬۰۰۰، پرداخت ۵۰۰، برگشت کالای ۶۰۰: پس از برگشت فقط ۱۰۰ اضافه
  // پرداخت مانده است. درخواست ۵۰۰ نباید ۵۰۰ از صندوق خارج کند یا بدهی پنهان
  // بسازد؛ قرارداد فعلی به همان ۱۰۰ امن محدودش می‌کند.
  const inv = await twoItemSale(500)
  const result = await safe('بازپرداخت نقدی با سقف تسویه', () => ret(inv.id, itemsOf(inv.id)[0].id, RefundMethod.CASH, 500))
  eq('بازپرداخت نقدی فقط مازاد واقعی است', result?.refundAmount, 100)
  eq('فاکتور پس از برگشت و بازپرداختِ سقف‌دار بدهی ندارد', (await salesService.payments({ invoiceId: inv.id })).remaining, 0)
}

console.log('\n— C2/ج — برگشت کامل فاکتور نسیه‌ی پرداخت‌نشده ⇒ تسویه، از تب نسیه بیرون')
{
  const inv = await twoItemSale(0)
  const it = itemsOf(inv.id)
  await ret(inv.id, it[0].id)
  await ret(inv.id, it[1].id)
  eq('settledAt بعد از برگشت کامل پر شد', invRow(inv.id).settledAt != null, true)
  const list = await salesService.creditList({ fromJalali: today, toJalali: today })
  eq('در فهرست بدهکاران نیست', list.rows.some((r) => r.id === inv.id), false)
  await throwsWith('برگشت دوباره بعد از برگشت کامل', () => ret(inv.id, it[0].id), 'قابل برگشت')
}

console.log('\n— C3/الف — ویرایش پرداخت ۲۵۰ ⇒ ۵۰: اضافه‌دریافت کاذب ۱۵۰ نمی‌ماند')
{
  const inv = await twoItemSale(900)
  const r = await pay(inv.id, 250, { confirmOverpay: true })
  eq('اضافه‌دریافت لحظه‌ی ثبت', r.overpayAmount, 150)
  await salesService.updatePayment({
    id: r.payment.id,
    amount: 50,
    userId,
    managerPassword: DEFAULT_MANAGER_PASSWORD,
    overrideReason: 'اصلاح امن تستی پرداخت'
  })
  eq('اضافه‌دریافت بعد از ویرایش به ۵۰', overpaySum(inv.id), 0)
  eq('باقی‌مانده بعد از ویرایش', (await salesService.payments({ invoiceId: inv.id })).remaining, 50)
}

console.log('\n— C3/ب — حذف پرداخت اول ⇒ اضافه‌دریافت پرداخت دوم بازسازی می‌شود')
{
  const inv = await twoItemSale(900)
  const r = await pay(inv.id, 250, { confirmOverpay: true })
  const first = payRows(inv.id)[0]
  await salesService.deletePayment({
    id: first.id,
    userId,
    managerPassword: DEFAULT_MANAGER_PASSWORD,
    reason: 'ابطال امن تستی پرداخت',
    overrideReason: 'ابطال امن تستی پرداخت'
  })
  eq('اضافه‌دریافت بعد از حذف پرداخت ۹۰۰', overpaySum(inv.id), 0)
  eq('اضافه‌دریافت پرداخت ۲۵۰', Number(payRows(inv.id).find((p) => p.id === r.payment.id)?.overpayAmount), 0)
}

console.log('\n— C3/ج — برگشت «بدون بازپرداخت» روی فاکتور تسویه‌شده ⇒ اضافه‌دریافت بی‌صدا نمی‌ماند')
{
  const inv = await twoItemSale(1000)
  await salesService.createReturn({
    invoiceId: inv.id,
    full: false,
    lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
    refundMethod: RefundMethod.NONE,
    userId,
    confirmOverpay: true
  })
  eq('جمع اضافه‌دریافت روی پرداخت‌ها', overpaySum(inv.id), 600)
  eq('overpayTotal پنجره‌ی پرداختی‌ها', (await salesService.payments({ invoiceId: inv.id })).overpayTotal, 600)
}

console.log('\n— C4 — پل تطبیق: ردیف اضافه‌دریافت با علامت منفی، و پل بسته')
{
  // همه‌ی فاکتورهای این فایل امروزند؛ پل روی کل روز باید بسته شود
  const s = await report()
  const row = s.bridge.rows.find((r) => r.key === 'overpayReceived')
  eq('ردیف overpayReceived وجود دارد', !!row, true)
  eq('علامت ردیف', row?.sign, -1)
  const expected = seed.one('SELECT COALESCE(SUM(overpayAmount),0) AS s FROM "Payment" WHERE amount > 0').s
  eq('مبلغ ردیف = جمع واقعی اضافه‌دریافت‌ها', row?.amount, Number(expected))
  // نشست ۵۹ — بررسی «⚠️ ناتمام» نشست ۵۸ فعال و شمرده شد: ردیف‌های بازپرداخت (بند ۴-۵۴) اضافه و
  // ردیف غلط debtOnlyReturns(+) حذف شد، پس پل کل روز این فایل باید دقیقاً بسته شود.
  eq('پل تطبیق کل روز بسته است (مانده‌ی بی‌توضیح)', s.bridge.unexplained, 0)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
