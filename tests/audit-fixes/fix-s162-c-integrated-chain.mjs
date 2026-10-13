/**
 * ===========================================================================
 * نشست ۱۶۲ · خوشه C (P0) — تست یکپارچه‌ی کل زنجیره (S162-D2).
 *
 * هندآف: «خوشه C فقط با تست یکپارچه؛ اول تست pending که کل زنجیره را هم‌زمان بسنجد».
 * تست‌های واحد C1..C7 (fix-s57..s66، fix-s73) هر کدام یک حلقه را جدا می‌سنجند. این تست همه‌ی حلقه‌ها را
 * روی یک دیتابیس و در دو بازه (دیروز/امروز) با هم می‌سنجد، با معیار هدف مالک: «هر عدد با عدد دیگر بخواند».
 *
 * پس از هر گام:
 *   (۱) remaining یکسان در پنجره‌ی پرداختی‌ها، تب نسیه و ردیف گزارش فروش (C2)؛
 *   (۲) پل تطبیق امروز بسته (unexplained = ۰) و پل دیروز بسته و **عددهای دیروز دست‌نخورده** (۴-۱۸/۴-۲۷)؛
 *   (۳) overpay روی پرداخت‌ها = ردیف overpayReceived پل (C3/C4)؛
 *   (۴) بازپرداخت نقدی دقیقاً یک‌بار در پل (۴-۹/۴-۵۴).
 * سناریوها:
 *   الف) نسیه‌ی دیروز ۱٬۰۰۰ (۶۰۰+۴۰۰) پرداخت ۳۰۰ دیروز ⇒ امروز برگشت ۶۰۰ بی‌بازپرداخت ⇒ بدهی ۱۰۰ ⇒
 *        دریافت ۷۰۰ بی‌تأیید رد ⇒ با تأیید اضافه‌دریافت ۶۰۰ ⇒ ویرایش ۷۰۰→۵۰ ⇒ اضافه‌دریافت ۰، بدهی ۵۰.
 *   ب) نقدی دیروز ۱٬۰۰۰ ⇒ امروز برگشت ۶۰۰ با بازپرداخت نقد ⇒ ردیف cashRefunds ۶۰۰، ناخالص دیروز ثابت.
 *   ج) نسیه‌ی دیروز ۱٬۰۰۰ ⇒ امروز تعویض قلم ۶۰۰ با کالای ۲۰۰ ⇒ کاهش بدهی ۴۰۰ (نه خروج نقد) ⇒ ابطال گراف.
 *   د) برگشت کامل ⇒ برگشت دوباره رد؛ ابطال برگشت ⇒ بدهی برمی‌گردد و پل بسته می‌ماند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s162-c-integrated-chain.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-c-int-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست زنجیره' }
const { RefundMethod } = await import('@shared/enums')
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

const HOUR = 3_600_000
const userId = seed.user('مدیر تست یکپارچه‌ی C')
const cat = seed.category('پوشاک C')
const product = seed.product('شلوار C', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const Yat = Date.now() - 30 * HOUR
const yday = toJalaliDate(new Date(Yat))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - HOUR, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز C${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const payRows = (invoiceId) => seed.rows('SELECT id, amount, overpayAmount FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL ORDER BY id', invoiceId)
/**
 * اضافه‌دریافتِ پرداخت‌های امروز روی فاکتورهای *امروز*. اضافه‌دریافتِ وصولِ فاکتور دوره‌ی قبل طبق نشست ۵۸ · C4
 * داخل «وصول نسیه‌ی بازه‌های قبل» (کل مبلغ) از پل کم می‌شود، نه در ردیف overpayReceived (S162-D3).
 */
const overpayAll = () => Number(seed.one('SELECT COALESCE(SUM(p.overpayAmount),0) AS s FROM "Payment" p JOIN "SaleInvoice" i ON i.id = p.invoiceId WHERE p.voidedAt IS NULL AND p.paidAt >= ? AND i.issuedAt >= ?', Date.now() - 20 * HOUR, Date.now() - 20 * HOUR)?.s ?? 0)
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
/** فاکتور دو قلمی ۶۰۰+۴۰۰ که با همه‌ی پرداخت‌هایش به دیروز منتقل می‌شود (فروش دوره‌ی قبل) */
const yesterdaySale = async (paid) => {
  const a = variant(600), b = variant(400)
  const inv = await salesService.create({ userId, shiftId, lines: [line(a, 600), line(b, 400)], payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : [] })
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?').run(Yat, yday, Yat, inv.id)
  sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ?, createdAt = ? WHERE invoiceId = ?').run(Yat, yday, Yat, inv.id)
  return { inv, items: itemsOf(inv.id) }
}
const ret = (invoiceId, saleItemId, refundMethod = RefundMethod.NONE, refundAmount = undefined) =>
  salesService.createReturn({ invoiceId, full: false, lines: [{ saleItemId, qty: 1 }], refundMethod, refundAmount, userId })
const pay = (invoiceId, amount, extra = {}) => salesService.addPayment({ invoiceId, amount, methodId: cash, destination: 'CASH', userId, ...extra })
const bridgeOf = async (d) => (await salesService.reportRows({ fromJalali: d, toJalali: d, withDrillDown: true, bridgeSourceTake: 2000 })).accounting
const rowAmt = (acc, key) => acc?.bridge?.rows?.find((r) => r.key === key)?.amount ?? null
const brief = (acc) => JSON.stringify((acc?.bridge?.rows ?? []).filter((r) => r.amount).map((r) => [r.key, r.sign * r.amount]))
const remainingEverywhere = async (id, d) => {
  const view = await salesService.payments({ invoiceId: id })
  const credit = (await salesService.creditList({ fromJalali: d, toJalali: d, includeSettled: true })).rows.find((r) => r.id === id)
  const rep = (await salesService.reportRows({ fromJalali: d, toJalali: d })).rows.find((r) => r.id === id)
  return [view?.remaining ?? null, credit?.remaining ?? 0, rep?.remaining ?? null]
}
let ydaySnap = null
/** Y20 — نسیه‌ی وصول‌نشده‌ی دیروز «در پایان همان بازه» است و با رویداد امروز عوض نمی‌شود */
const ydayNumbers = (acc) => JSON.stringify({ gross: acc?.invoice?.grossSales, count: acc?.invoice?.invoiceCount, real: rowAmt(acc, 'realCash'), uncollected: rowAmt(acc, 'uncollectedCredit') })
const invariants = async (tag) => {
  const t = await bridgeOf(today)
  eq(`[${tag}] پل امروز بسته${t?.bridge?.unexplained ? ' · ' + brief(t) : ''}`, t?.bridge?.unexplained, 0)
  eq(`[${tag}] overpay پرداخت‌ها = ردیف overpayReceived پل`, overpayAll(), Number(rowAmt(t, 'overpayReceived') ?? 0))
  const y = await bridgeOf(yday)
  eq(`[${tag}] پل دیروز بسته${y?.bridge?.unexplained ? ' · ' + brief(y) : ''}`, y?.bridge?.unexplained, 0)
  if (ydaySnap) eq(`[${tag}] عددهای دیروز دست‌نخورده (۴-۱۸/۴-۲۷)`, ydayNumbers(y), ydaySnap)
  const ur = y?.bridge?.rows?.find((r) => r.key === 'uncollectedCredit')
  eq(`[${tag}] drill نسیه‌ی دیروز = عدد ردیف`, (ur?.sources ?? []).reduce((a, x) => a + Number(x.amount ?? 0), 0), Number(ur?.amount ?? 0))
  return t
}

// ===========================================================================
console.log('\n۰) فروش‌های دیروز')
const A = await safe('الف: نسیه‌ی ۱٬۰۰۰ با پرداخت ۳۰۰', () => yesterdaySale(300))
const B = await safe('ب: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
const C = await safe('ج: نسیه‌ی ۱٬۰۰۰', () => yesterdaySale(0))
const D = await safe('د: نسیه‌ی ۱٬۰۰۰', () => yesterdaySale(0))
const E = await safe('ه: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
const F = await safe('و: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
const G = await safe('ز: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
const H = await safe('ح: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
{
  const y = await bridgeOf(yday)
  eq('ناخالص دیروز ۸٬۰۰۰', Number(y?.invoice?.grossSales ?? NaN), 8000)
  ydaySnap = ydayNumbers(y)
}
await invariants('پایه')

// ===========================================================================
console.log('\nالف) برگشت ۶۰۰ بی‌بازپرداخت امروز روی نسیه‌ی دیروز ⇒ بدهی ۱۰۰ ⇒ اضافه‌دریافت ⇒ ویرایش')
await safe('برگشت ۶۰۰', () => ret(A.inv.id, A.items[0].id))
eq('بدهی ۱۰۰ همه‌جا (پرداختی‌ها/نسیه/گزارش دیروز)', await remainingEverywhere(A.inv.id, yday), [100, 100, 100])
{
  const t = await invariants('الف-۱')
  eq('ردیف «برگشت روی فاکتورهای بازه‌های قبل» ۶۰۰', rowAmt(t, 'priorDebtReturns'), 600)
}
await throwsWith('دریافت ۷۰۰ بدون تأیید اضافه‌دریافت رد', () => pay(A.inv.id, 700), 'بیشتر')
eq('پرداخت ردشده ثبت نشد', payRows(A.inv.id).length, 1)
const pA = await safe('دریافت ۷۰۰ با تأیید', () => pay(A.inv.id, 700, { confirmOverpay: true }))
eq('اضافه‌دریافت ۶۰۰', pA?.overpayAmount, 600)
eq('بدهی ۰ همه‌جا', await remainingEverywhere(A.inv.id, yday), [0, 0, 0])
{
  const t = await invariants('الف-۲')
  // S162-D3: اضافه‌دریافت ۶۰۰ روی فاکتور دیروز داخل «وصول نسیه‌ی دوره‌ی قبل» ۷۰۰ است (نشست ۵۸ · C4، بدون دوبار کسر)
  eq('ردیف overpayReceived امروز ۰ (اضافه‌دریافت فاکتور دیروز جدا کم نمی‌شود)', Number(rowAmt(t, 'overpayReceived') ?? 0), 0)
  eq('وصول نسیه‌ی دوره‌ی قبل ۷۰۰ (شامل ۶۰۰ اضافه)', rowAmt(t, 'priorCreditSettlements'), 700)
}
await safe('ویرایش ۷۰۰ ⇒ ۵۰', () => salesService.updatePayment({ id: pA?.payment?.id, amount: 50, userId, ...GATE }))
eq('اضافه‌دریافت بعد از ویرایش ۰', payRows(A.inv.id).reduce((s, p) => s + Number(p.overpayAmount ?? 0), 0), 0)
eq('بدهی ۵۰ همه‌جا', await remainingEverywhere(A.inv.id, yday), [50, 50, 50])
{
  const t = await invariants('الف-۳')
  eq('ردیف overpayReceived ۰', Number(rowAmt(t, 'overpayReceived') ?? 0), 0)
}

// ===========================================================================
console.log('\nب) برگشت ۶۰۰ با بازپرداخت نقدی امروز روی فاکتور نقدی دیروز')
await safe('برگشت نقدی', () => ret(B.inv.id, B.items[0].id, RefundMethod.CASH))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(B.inv.id, yday), [0, 0, 0])
{
  const t = await invariants('ب')
  eq('ردیف بازپرداخت نقدی برگشت ۶۰۰ (دقیقاً یک‌بار)', rowAmt(t, 'cashRefunds'), 600)
}

// ===========================================================================
console.log('\nج) تعویض امروز روی نسیه‌ی دیروز: قلم ۶۰۰ با کالای ۲۰۰ ⇒ کاهش بدهی ۴۰۰، نه خروج نقد')
const rep = variant(200)
const exC = await safe('تعویض', () => salesService.createExchange({ invoiceId: C.inv.id, lines: [{ saleItemId: C.items[0].id, qty: 1 }], replacements: [{ variantId: rep, qty: 1 }], refundMode: 'CASH', methodId: cash, userId, shiftId }))
eq('بدهی فاکتور اصلی ۶۰۰ همه‌جا', await remainingEverywhere(C.inv.id, yday), [600, 600, 600])
{
  const t = await invariants('ج-۱')
  eq('هیچ بازپرداخت نقدی مابه‌التفاوت (۴-۵)', Number(rowAmt(t, 'exchangeCashRefunds') ?? 0), 0)
}
await safe('ابطال گراف تعویض', () => salesService.returnDelete({
  id: exC?.returnId, userId, reason: 'تعویض اشتباه', ...GATE
}))
eq('بعد از ابطال بدهی ۱٬۰۰۰ همه‌جا', await remainingEverywhere(C.inv.id, yday), [1000, 1000, 1000])
await invariants('ج-۲')

// ===========================================================================
console.log('\nد) برگشت کامل ⇒ برگشت دوباره رد ⇒ ابطال یکی ⇒ بدهی برمی‌گردد')
const d1 = await safe('برگشت قلم ۶۰۰', () => ret(D.inv.id, D.items[0].id))
await safe('برگشت قلم ۴۰۰', () => ret(D.inv.id, D.items[1].id))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(D.inv.id, yday), [0, 0, 0])
await throwsWith('برگشت دوباره‌ی همان قلم رد', () => ret(D.inv.id, D.items[0].id), 'برگشت')
await invariants('د-۱')
await safe('ابطال برگشت ۶۰۰', () => salesService.returnDelete({
  id: d1?.id ?? d1?.returnId, userId, reason: 'برگشت اشتباه', ...GATE
}))
eq('بدهی ۶۰۰ همه‌جا', await remainingEverywhere(D.inv.id, yday), [600, 600, 600])
await invariants('د-۲')

// ===========================================================================
console.log('\nه) تعویض امروز روی فاکتور نقدی دیروز: قلم ۶۰۰ با کالای ۹۰۰ ⇒ مشتری ۳۰۰ نقد می‌دهد')
const exE = await safe('تعویض گران‌تر', () => salesService.createExchange({ invoiceId: E.inv.id, lines: [{ saleItemId: E.items[0].id, qty: 1 }], replacements: [{ variantId: variant(900), qty: 1 }], refundMode: 'CASH', methodId: cash, userId, shiftId }))
eq('بدهی فاکتور اصلی ۰ همه‌جا', await remainingEverywhere(E.inv.id, yday), [0, 0, 0])
{
  const t = await invariants('ه')
  eq('ناخالص امروز شامل سند تعویض ۹۰۰ (۴-۱۰)', Number(t?.invoice?.grossSales ?? NaN) >= 900, true)
}

console.log('\nو) برگشت امروز با اعتبار خرید روی فاکتور نقدی دیروز')
await safe('برگشت با اعتبار', () => ret(F.inv.id, F.items[0].id, RefundMethod.STORE_CREDIT))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(F.inv.id, yday), [0, 0, 0])
await invariants('و')

console.log('\nز) برگشت امروز با کارت‌به‌کارت روی فاکتور نقدی دیروز')
await safe('برگشت کارت‌به‌کارت', () => ret(G.inv.id, G.items[0].id, RefundMethod.CARD_TO_CARD))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(G.inv.id, yday), [0, 0, 0])
{
  const t = await invariants('ز')
  eq('ردیف بازپرداخت کارت‌به‌کارت ۶۰۰ (دقیقاً یک‌بار)', rowAmt(t, 'cardToCardRefunds'), 600)
}

console.log('\nح) تعویض امروز روی فاکتور نقدی دیروز: قلم ۶۰۰ با کالای ۲۰۰ ⇒ ۴۰۰ اعتبار خرید')
await safe('تعویض ارزان‌تر با اعتبار', () => salesService.createExchange({ invoiceId: H.inv.id, lines: [{ saleItemId: H.items[0].id, qty: 1 }], replacements: [{ variantId: variant(200), qty: 1 }], refundMode: 'STORE_CREDIT', methodId: cash, userId, shiftId }))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(H.inv.id, yday), [0, 0, 0])
await invariants('ح')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
