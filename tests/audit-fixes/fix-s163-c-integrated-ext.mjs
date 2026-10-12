/**
 * ===========================================================================
 * نشست ۱۶۳ · خوشه C (P0) — گسترش تست یکپارچه (S163-D1).
 *
 * هندآف ۱۶۲ بند «نقطه‌ی شروع ۱۶۳ · ۲»: موارد باقی‌مانده‌ی خوشه‌ی C که تست یکپارچه‌ی ۱۶۲ نمی‌سنجید:
 *   (۱) گزارش بازه‌ی چندروزه (دیروز تا امروز) پس از Y20: پل بسته، ناخالص/تعداد/وجه واقعی = جمع دو روز،
 *       و جمع گروه‌های «روز → شیفت/نشست» = جمع کل (۴-۱۴)؛
 *   (۲) چک در جریان روی فاکتور برگشت‌خورده (۴-۵۲): برگشتی که بدهی را صفر کند ⇒ چک خودکار void با مهر
 *       actor/زمان/دلیل؛ برگشت جزئی ⇒ چک دست‌نخورده + علامت «این چک نیاز به بازبینی دارد» (پنجره‌ی
 *       پرداختی‌ها و تب چک) + ردیف Audit؛ ابطال برگشتی که چک را باطل کرده بود ⇒ چک برمی‌گردد (۴-۲۲)؛
 *   (۳) اضافه‌دریافت با overpayAsCredit روی فاکتور دوره‌ی قبل (۴-۳۵/۴-۳۷)؛
 *   (۴) بستن صندوق (CashboxService.expected) کنار پل: نقد مورد انتظار = oracle مستقل SQL
 *       (نقد کشو − بازپرداخت نقدی) و = وجه واقعی نقد پل − بازپرداخت‌های نقدی پل (۴-۴۹/۴-۵۳/۴-۵۴).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s163-c-integrated-ext.mjs
 *
 * نشست ۱۶۴: بند «م» (چک نقدی پاس‌شده‌ی دوره‌ی قبل، Y21) اضافه شد و فایل از tests/pending به tests/audit-fixes رفت.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-c-ext-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح کنترل‌شده برای آزمون چرخهٔ برگشت' }
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


const range2 = async () => salesService.reportRows({ fromJalali: yday, toJalali: today, withDrillDown: true, bridgeSourceTake: 2000, take: 5000 })
const sumBy = (arr, f) => (arr ?? []).reduce((s, x) => s + Number(f(x) ?? 0), 0)
/** oracle مستقل: نقد واقعاً واردشده به کشو در این نشست − بازپرداخت نقدی واقعاً خارج‌شده */
const drawerOracle = () => {
  const inflow = Number(seed.one(`SELECT COALESCE(SUM(p.amount),0) AS s FROM "Payment" p JOIN "PaymentMethod" m ON m.id = p.methodId
     WHERE p.voidedAt IS NULL AND p.createdShiftId = ? AND p.destination = 'CASH' AND COALESCE(p.kind,'CASH') = 'CASH' AND m.kind = 'CASH'`, shiftId)?.s ?? 0)
  const refunds = Number(seed.one(`SELECT COALESCE(SUM(refundAmount),0) AS s FROM "SaleReturn" WHERE voidedAt IS NULL AND shiftId = ? AND refundMethod = 'CASH'`, shiftId)?.s ?? 0)
  return inflow - refunds
}
const extInvariants = async (tag) => {
  const t = await invariants(tag)
  const y = await bridgeOf(yday)
  const m = await range2()
  const ma = m?.accounting
  eq(`[${tag}] پل دیروز تا امروز بسته${ma?.bridge?.unexplained ? ' · ' + brief(ma) : ''}`, ma?.bridge?.unexplained, 0)
  eq(`[${tag}] ناخالص دوروزه = دیروز + امروز`, Number(ma?.invoice?.grossSales ?? NaN), Number(y?.invoice?.grossSales ?? 0) + Number(t?.invoice?.grossSales ?? 0))
  eq(`[${tag}] تعداد فاکتور دوروزه = دیروز + امروز`, Number(ma?.invoice?.invoiceCount ?? NaN), Number(y?.invoice?.invoiceCount ?? 0) + Number(t?.invoice?.invoiceCount ?? 0))
  eq(`[${tag}] وجه واقعی دوروزه = دیروز + امروز`, Number(rowAmt(ma, 'realCash') ?? 0), Number(rowAmt(y, 'realCash') ?? 0) + Number(rowAmt(t, 'realCash') ?? 0))
  const groups = m?.groups ?? []
  const sessions = groups.flatMap((g) => g.sessions ?? [])
  eq(`[${tag}] جمع گروه‌های روز/شیفت = جمع کل (۴-۱۴)`, sumBy(groups, (g) => g.totals?.grandTotal), Number(m?.totals?.grandTotal ?? NaN))
  eq(`[${tag}] جمع نشست‌ها = جمع کل (۴-۱۴)`, sumBy(sessions, (s) => s.totals?.grandTotal), Number(m?.totals?.grandTotal ?? NaN))
  const byDay = new Map()
  for (const g of groups) byDay.set(g.dayJalali, (byDay.get(g.dayJalali) ?? 0) + Number(g.totals?.grandTotal ?? 0))
  eq(`[${tag}] جمع روزها = جمع کل (۴-۱۴)`, [...byDay.values()].reduce((a, b) => a + b, 0), Number(m?.totals?.grandTotal ?? NaN))
  const exp = await safe(`[${tag}] بستن صندوق (پیش‌نمایش)`, () => cashboxService.expected({ shiftId }))
  eq(`[${tag}] نقد مورد انتظار صندوق = oracle کشو`, Number(exp?.expectedCash ?? NaN), drawerOracle())
  return t
}

// ===========================================================================
console.log('\n۰) فروش‌های دیروز (خوشه C · ادامه)')
const I = await safe('ط: نسیه‌ی ۱٬۰۰۰ + چک در جریان ۱٬۰۰۰', () => yesterdaySale(0))
const J = await safe('ی: نسیه‌ی ۱٬۰۰۰ + چک در جریان ۱٬۰۰۰', () => yesterdaySale(0))
const K = await safe('ک: نسیه‌ی ۱٬۰۰۰', () => yesterdaySale(0))
const L = await safe('ل: نقدی ۱٬۰۰۰', () => yesterdaySale(1000))
/**
 * آرتیفکت هارنس (S163-D1): فروش «دیروز» امروز ساخته و به دیروز منتقل می‌شود، پس shiftId فاکتور و createdShiftId
 * پرداخت‌هایش نشست امروز می‌ماند و بستن صندوق امروز فروش دیروز را هم می‌شمرد. در واقعیت این‌ها مال نشست دیروزند.
 */
const yShift = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: yday, openedAt: Yat - HOUR, closedAt: Yat + HOUR, userId })
for (const x of [I, J, K, L]) {
  sql.prepare('UPDATE "SaleInvoice" SET shiftId = ? WHERE id = ?').run(yShift, x.inv.id)
  sql.prepare('UPDATE "Payment" SET createdShiftId = ? WHERE invoiceId = ?').run(yShift, x.inv.id)
}
const cheque = async (inv, amount) => {
  const r = await salesService.addPayment({ invoiceId: inv.id, kind: 'CHEQUE', amount, chequeNo: `C-${inv.id}`, bankName: 'ملت', dueDateJalali: today, userId })
  sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ?, createdAt = ?, createdShiftId = ? WHERE invoiceId = ? AND kind = \'CHEQUE\'').run(Yat, yday, Yat, yShift, inv.id)
  return r
}
await safe('چک ط', () => cheque(I.inv, 1000))
await safe('چک ی', () => cheque(J.inv, 1000))
const chq = (invoiceId) => seed.one('SELECT id, chequeStatus, voidedAt, voidedByUserId, voidReason FROM "Payment" WHERE invoiceId = ? AND kind = \'CHEQUE\' ORDER BY id DESC LIMIT 1', invoiceId)
{
  const y = await bridgeOf(yday)
  eq('ناخالص دیروز ۴٬۰۰۰', Number(y?.invoice?.grossSales ?? NaN), 4000)
  ydaySnap = ydayNumbers(y)
}
await extInvariants('پایه')

// ===========================================================================
console.log('\nط) برگشت کامل امروز روی نسیه‌ی دیروز با چک در جریان ⇒ بدهی صفر ⇒ چک خودکار باطل (۴-۵۲)')
const i1 = await safe('برگشت قلم ۶۰۰', () => ret(I.inv.id, I.items[0].id))
{
  const c = chq(I.inv.id)
  eq('پس از برگشت جزئی (بدهی ۴۰۰) چک هنوز باطل نیست', c?.voidedAt == null, true)
}
const i2 = await safe('برگشت قلم ۴۰۰', () => ret(I.inv.id, I.items[1].id))
eq('بدهی ۰ همه‌جا', await remainingEverywhere(I.inv.id, yday), [0, 0, 0])
{
  const c = chq(I.inv.id)
  eq('چک خودکار باطل شد (voidedAt)', c?.voidedAt != null, true)
  eq('مهر actor ابطال', Number(c?.voidedByUserId ?? 0), userId)
  eq('دلیل ابطال به بند ۴-۵۲ و سند برگشت اشاره دارد', /۴-۵۲/.test(String(c?.voidReason ?? '')) && String(c?.voidReason ?? '').includes('برگشت'), true)
  const aud = seed.one('SELECT COUNT(*) AS n FROM "AuditLog" WHERE entity = \'Payment\' AND entityId = ? AND action = \'VOID\'', c?.id)
  eq('ردیف Audit ابطال چک', Number(aud?.n ?? 0), 1)
  const v = await salesService.payments({ invoiceId: I.inv.id })
  eq('چک در جریان در پنجره‌ی پرداختی‌ها ۰', v?.pendingChequeTotal, 0)
}
await extInvariants('ط-۱')
await safe('ابطال برگشت ۴۰۰', () => salesService.returnDelete({
  id: i2?.id, userId, reason: 'برگشت اشتباه', ...GATE
}))
{
  const c = chq(I.inv.id)
  eq('ابطال برگشت ⇒ چک خودکار برگشت (۴-۲۲)', c?.voidedAt == null && c?.chequeStatus === 'PENDING', true)
  const v = await salesService.payments({ invoiceId: I.inv.id })
  eq('بدهی ۴۰۰ و چک در جریان ۱٬۰۰۰', [v?.remaining, v?.pendingChequeTotal], [400, 1000])
  eq('چک برگشته علامت «نیاز به بازبینی» دارد', v?.payments?.find((p) => p.kind === 'CHEQUE')?.chequeNeedsReview, true)
}
await extInvariants('ط-۲')

// ===========================================================================
console.log('\nی) برگشت جزئی امروز روی نسیه‌ی دیروز با چک در جریان ⇒ چک دست‌نخورده + علامت بازبینی (۴-۵۲)')
await safe('برگشت قلم ۶۰۰', () => ret(J.inv.id, J.items[0].id))
eq('بدهی ۴۰۰ همه‌جا', await remainingEverywhere(J.inv.id, yday), [400, 400, 400])
{
  const c = chq(J.inv.id)
  eq('چک باطل نشد و در جریان ماند', c?.voidedAt == null && c?.chequeStatus === 'PENDING', true)
  const v = await salesService.payments({ invoiceId: J.inv.id })
  const row = v?.payments?.find((p) => p.kind === 'CHEQUE')
  eq('پنجره‌ی پرداختی‌ها: چک نیاز به بازبینی', row?.chequeNeedsReview, true)
  eq('متن علامت «این چک نیاز به بازبینی دارد»', String(row?.chequeReviewNote ?? '').includes('این چک نیاز به بازبینی دارد'), true)
  eq('شمار چک‌های نیازمند بازبینی فاکتور ۱', v?.chequeReviewCount, 1)
  const list = await salesService.chequeList({ status: 'PENDING', fromJalali: yday, toJalali: today, dateMode: 'paid' })
  eq('تب چک: همان علامت', list?.find?.((p) => p.invoiceId === J.inv.id)?.chequeNeedsReview, true)
  const aud = seed.one('SELECT COUNT(*) AS n FROM "AuditLog" WHERE entity = \'Payment\' AND entityId = ? AND after LIKE \'%needsManagerReview%\'', c?.id)
  eq('ردیف Audit «رسیدگی مدیر» برای چک', Number(aud?.n ?? 0) >= 1, true)
}
{
  const v = await salesService.payments({ invoiceId: K.inv.id })
  eq('فاکتور بدون چک: شمار بازبینی ۰', v?.chequeReviewCount ?? 0, 0)
}
await extInvariants('ی')

// ===========================================================================
console.log('\nک) اضافه‌دریافت با تبدیل به اعتبار خرید روی نسیه‌ی دیروز (۴-۳۵/۴-۳۷)')
const pK = await safe('دریافت ۱٬۳۰۰ با تأیید و اعتبار', () => pay(K.inv.id, 1300, { confirmOverpay: true, overpayAsCredit: true }))
eq('اضافه‌دریافت ۳۰۰', pK?.overpayAmount, 300)
eq('بدهی ۰ همه‌جا', await remainingEverywhere(K.inv.id, yday), [0, 0, 0])
{
  const cr = seed.one('SELECT COALESCE(SUM(amount),0) AS s, COUNT(*) AS n FROM "StoreCredit" WHERE sourceInvoiceId = ? AND deletedAt IS NULL', K.inv.id)
  eq('یک اعتبار ۳۰۰ صادر شد', [Number(cr?.n ?? 0), Number(cr?.s ?? 0)], [1, 300])
  const t = await extInvariants('ک')
  // طراحی نشست ۶۱ (S61-2): اعتبار اضافه‌دریافت در ردیف پل «اعتبار صادرشده» نمی‌آید (داخل وصول/اضافه‌دریافت توضیح داده شده)
  eq('اعتبار صادرشده‌ی امروز ۳۰۰ و سهم اضافه‌دریافت ۳۰۰', [t?.storeCredits?.issued, t?.storeCredits?.issuedFromOverpay], [300, 300])
  eq('ردیف پل «اعتبار صادرشده» بدون سهم اضافه‌دریافت ۰ (S61-2)', Number(rowAmt(t, 'storeCreditIssued') ?? 0), 0)
}

// ===========================================================================
console.log('\nل) برگشت نقدی امروز روی نقدی دیروز ⇒ صندوق = oracle، پل بسته')
await safe('برگشت ۶۰۰ نقد', () => ret(L.inv.id, L.items[0].id, RefundMethod.CASH))
{
  const t = await extInvariants('ل')
  const exp = await cashboxService.expected({ shiftId })
  eq('نقد مورد انتظار = وجه واقعی نقد پل − بازپرداخت‌های نقدی پل', Number(exp?.expectedCash ?? NaN),
    Number(rowAmt(t, 'realCash') ?? 0) - Number(rowAmt(t, 'cashRefunds') ?? 0) - Number(rowAmt(t, 'exchangeCashRefunds') ?? 0))
}

// ===========================================================================
// نشست ۱۶۴ · Y21 (S164-D2) — دو مسیر دیگرِ وصول دوره‌ی قبل: کارتخوان و چک قدیمی بی‌مقصد
console.log('\nم) وصول کارتی امروز روی نسیه‌ی دیروز ⇒ انتظار کارتخوان دقیقاً یک‌بار؛ چک قدیمیِ «CASH» پاس‌شده ⇒ بیرون از نقد (Y21/Y18)')
const cardM = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const M = await safe('م: نسیه‌ی ۱٬۰۰۰ دیروز', () => yesterdaySale(0))
sql.prepare('UPDATE "SaleInvoice" SET shiftId = ? WHERE id = ?').run(yShift, M.inv.id)
/** فاکتور تازه‌ی دیروز عمداً عددهای دیروز را عوض می‌کند؛ snapshot مرجع Y20 همین‌جا تازه می‌شود */
ydaySnap = ydayNumbers(await bridgeOf(yday))
const before = async () => {
  const e = await cashboxService.expected({ shiftId })
  const t = await bridgeOf(today)
  return { cash: Number(e?.expectedCash ?? NaN), card: Number(e?.components?.cardExpected ?? NaN), net: Number(t?.cash?.netCashMovement ?? NaN) }
}
const b0 = await before()
await safe('وصول کارتی ۵۰۰', () => salesService.addPayment({ invoiceId: M.inv.id, amount: 500, methodId: cardM, destination: 'CARD', userId }))
{
  const b1 = await before()
  eq('انتظار کارتخوان دقیقاً ۵۰۰ بالا رفت (نه ۱٬۰۰۰)', b1.card - b0.card, 500)
  eq('نقد مورد انتظار با وصول کارتی تغییر نکرد', b1.cash - b0.cash, 0)
  eq('خالص وجه واقعی دقیقاً ۵۰۰ بالا رفت (نه ۱٬۰۰۰)', b1.net - b0.net, 500)
  await extInvariants('م-کارت')
}
await safe('چک م', () => cheque(M.inv, 500))
const chqM = chq(M.inv.id)
const b2 = await before()
/** مقصد «نقد» برای چک طبق ۴-۱۲ بسته است؛ داده‌ی قدیمی مستقیم ساخته می‌شود (receiptBucketOf ⇒ «نامشخص») */
sql.prepare('UPDATE "Payment" SET chequeStatus = \'CLEARED\', destination = \'CASH\', clearedAt = ?, clearedAtJalali = ?, clearedShiftId = ? WHERE id = ?')
  .run(Date.now(), today, shiftId, chqM?.id)
{
  const b3 = await before()
  const e = await cashboxService.expected({ shiftId })
  eq('چک قدیمی «CASH» پاس‌شده روی فاکتور دیروز: نقد مورد انتظار ۰ تغییر (بند ۴-۲۴)', b3.cash - b2.cash, 0)
  eq('همان چک: بیرون از نقد مورد انتظار با برچسب نامشخص', Number(e?.unknownDestinationOutside ?? 0) >= 500, true)
  eq('همان چک: خالص وجه واقعی ۰ تغییر', b3.net - b2.net, 0)
  const t = await bridgeOf(today)
  eq('[م-چک] پل امروز بسته', t?.bridge?.unexplained, 0)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
