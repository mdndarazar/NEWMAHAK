/**
 * ===========================================================================
 * نشست ۶۵ — خوشه C / بند ۴-۲۲: ابطال اتمیک کل گراف تعویض (DECISIONS S65-1 تا S65-6).
 *
 * قبل: سند برگشتِ تعویض اصلاً قابل ابطال نبود (S60-2، مسدود موقت) ⇒ تعویضِ اشتباه
 * هیچ راه اصلاحی جز «برگشت روی سند تعویض» نداشت که خودش ناخالص/برگشتی کاذب می‌ساخت.
 * بعد: ابطال با دلیل اجباری، در یک تراکنش: سند برگشت تعویض + سند تعویض (فاکتور
 * جایگزین) هر دو با مهر voidedAt/voidedByUserId/voidReason می‌مانند و از همه‌ی
 * گزارش‌ها بیرون می‌روند؛ انبار هر دو طرف با حرکت معکوس برمی‌گردد؛ اعتبار دست‌نخورده
 * و درخواست کارت‌به‌کارت در انتظار باطل/لغو؛ کاهش بدهی فاکتور اصلی برمی‌گردد.
 * برگشت‌ناپذیرها (بازپرداخت نقد/کارت، مابه‌التفاوت دریافتی، اعتبار خرج‌شده،
 * برگشت روی خودِ سند تعویض) ⇒ rollback کامل + ردیف «رسیدگی مدیر».
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s65-exchange-void.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s65-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { cardTransferService } = await import('../../src/main/services/CardTransferService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW, SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const ROOT = new URL('../../', import.meta.url).pathname
const src = (p) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const truthy = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} ${extra}`) }
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

const userId = seed.user('مدیر تست ابطال تعویض')
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
const stockOf = (v) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', v)?.stock ?? -1)
const retRow = (id) => seed.one('SELECT * FROM "SaleReturn" WHERE id = ?', id)
const invRow = (id) => seed.one('SELECT * FROM "SaleInvoice" WHERE id = ?', id)
const itemsOf = (invoiceId) => seed.rows('SELECT id, variantId FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const twoItems = async (paid) => {
  const a = variant(600), b = variant(400)
  const inv = await salesService.create({ userId, shiftId, lines: [line(a, 600), line(b, 400)], payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : [] })
  return { inv, a, b, items: itemsOf(inv.id) }
}
const exchange = (invoiceId, saleItemId, repVariant, refundMode) =>
  salesService.createExchange({ invoiceId, lines: [{ saleItemId, qty: 1 }], replacements: [{ variantId: repVariant, qty: 1 }], refundMode, methodId: cash, userId, shiftId })
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  })
  return statements
}
const closed = (s, label = 'پل تطبیق بسته است (مانده‌ی بی‌توضیح)') => eq(label, s?.bridge?.unexplained, 0)
const remainingOf = async (id) => (await salesService.payments({ invoiceId: id })).remaining
const voidIt = (id, reason = 'تعویض اشتباه ثبت شد') => salesService.returnDelete({ id, userId, reason })
const reviewRows = (retId) => seed.rows(`SELECT note FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND note LIKE '%رسیدگی مدیر%'`, retId).length
const grossOf = (s) => Number(s?.invoice?.grossSales ?? NaN)
const countOf = (s) => Number(s?.invoice?.invoiceCount ?? NaN)

// ===========================================================================
console.log('\n۰) نصب تازه: ابطال تعویض هم با قفل پیش‌فرض اصلاح/ابطال محافظت می‌شود')
const lockedSeed = await safe('فاکتور برای قفل پیش‌فرض تعویض', () => twoItems(0))
const lockedExchange = await safe('تعویض برای قفل پیش‌فرض', () => exchange(lockedSeed.inv.id, lockedSeed.items[0].id, variant(200), 'CASH'))
await throwsWith(
  'ابطال تعویض بدون رمز در نصب تازه رد می‌شود',
  () => salesService.returnDelete({ id: lockedExchange?.returnId, userId, reason: 'تست قفل پیش‌فرض تعویض' }),
  'تأیید مدیر'
)
truthy('رد گیت، گراف تعویض را دست‌نخورده می‌گذارد', retRow(lockedExchange?.returnId ?? -1)?.voidedAt == null && invRow(lockedExchange?.exchangeInvoiceId ?? -1)?.voidedAt == null)
const lockedVoid = await safe('رمز مدیر ابطال تعویض را مجاز می‌کند', () =>
  salesService.returnDelete({
    id: lockedExchange?.returnId,
    userId,
    reason: 'تست قفل پیش‌فرض تعویض',
    panelPassword: PW
  })
)
truthy('ابطال تعویض با رمز، هر دو سند را باطل می‌کند', lockedVoid?.voided === true && lockedVoid?.exchangeVoided === true)
/** باقی تست، اثرهای مالی را جداگانه می‌سنجد؛ مدیر عمداً قفل را برای setup آن‌ها خاموش کرده است. */
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReturnCorrection]: false })

// ===========================================================================
console.log('\n۱) نسیه‌ی پرداخت‌نشده ۱٬۰۰۰، تعویض قلم ۶۰۰ با کالای ۲۰۰ ⇒ ۴۰۰ کاهش بدهی ⇒ ابطال کل گراف')
const A = await safe('نسیه‌ی ۱٬۰۰۰', () => twoItems(0))
const repA = variant(200)
const stockRetA0 = stockOf(A.a), stockRepA0 = stockOf(repA)
const s0 = await report()
const exA = await safe('تعویض', () => exchange(A.inv.id, A.items[0].id, repA, 'CASH'))
eq('بعد از تعویض بدهی ۶۰۰', await remainingOf(A.inv.id), 600)
const retA = exA?.returnId, exInvA = exA?.exchangeInvoiceId
await throwsWith('ابطال بدون دلیل رد می‌شود', () => salesService.returnDelete({ id: retA, userId }), 'دلیل')
truthy('بعد از رد، سند برگشت تعویض فعال ماند', retRow(retA)?.voidedAt == null)
const vA = await safe('ابطال گراف تعویض با دلیل', () => voidIt(retA))
truthy('نتیجه voided=true و exchangeVoided=true', vA?.voided === true && vA?.exchangeVoided === true)
truthy('سند برگشت تعویض حذف فیزیکی نشد و مهر ابطال دارد', !!retRow(retA) && retRow(retA).voidedAt != null)
truthy('سند تعویض (فاکتور جایگزین) حذف فیزیکی نشد', !!invRow(exInvA))
truthy('سند تعویض مهر ابطال دارد', invRow(exInvA)?.voidedAt != null)
eq('کاربر ابطال روی سند تعویض', Number(invRow(exInvA)?.voidedByUserId ?? 0), userId)
eq('دلیل ابطال روی سند تعویض', invRow(exInvA)?.voidReason, 'تعویض اشتباه ثبت شد')
eq('وضعیت سند تعویض «لغو»', invRow(exInvA)?.status, 'CANCELED')
eq('اقلام سند تعویض ماندند', itemsOf(exInvA).length, 1)
eq('بدهی فاکتور اصلی به ۱٬۰۰۰ برگشت (کاهش بدهی تعویض لغو شد)', await remainingOf(A.inv.id), 1000)
eq('موجودی کالای برگشتی به قبل برگشت', stockOf(A.a), stockRetA0)
eq('موجودی کالای جایگزین به قبل برگشت', stockOf(repA), stockRepA0)
eq('وضعیت فاکتور اصلی دیگر «برگشت جزئی» نیست', invRow(A.inv.id)?.status === 'PARTIALLY_RETURNED', false)
const sA = await report()
closed(sA)
eq('ناخالص گزارش امروز = قبل از تعویض (سند تعویض باطل بیرون است)', grossOf(sA), grossOf(s0))
eq('تعداد فاکتورهای گزارش = قبل از تعویض', countOf(sA), countOf(s0))
eq('برگشتیِ «از تعویض» گزارش = قبل از تعویض', Number(sA?.invoice?.exchangeReturned ?? NaN), Number(s0?.invoice?.exchangeReturned ?? NaN))
const exList = await safe('فهرست تعویض‌ها', () => salesService.exchangeList({ fromJalali: today, toJalali: today }))
eq('تعویض باطل در تب تعویض نیست', (exList?.rows ?? []).some((r) => r.id === retA || r.returnId === retA), false)
const rows = await safe('فهرست فروش', () => salesService.reportRows({ fromJalali: today, toJalali: today }))
eq('سند تعویض باطل در فهرست فروش نیست', (rows?.rows ?? []).some((r) => r.id === exInvA), false)
const audA = seed.rows(`SELECT action, note FROM "AuditLog" WHERE entity = 'SaleInvoice' AND entityId = ? AND action = 'VOID'`, exInvA)
truthy('Audit ابطال سند تعویض با دلیل', audA.some((x) => String(x.note).includes('تعویض اشتباه ثبت شد')))
truthy('Audit ابطال سند برگشت تعویض', seed.rows(`SELECT id FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'VOID'`, retA).length >= 1)
truthy('Audit برگشت بدهی فاکتور اصلی', seed.rows(`SELECT note FROM "AuditLog" WHERE entity = 'SaleInvoice' AND entityId = ?`, A.inv.id).some((x) => String(x.note).includes('ابطال') && String(x.note).includes('بدهی')))
const next = await safe('فاکتور بعدی', () => salesService.create({ userId, shiftId, lines: [line(variant(100), 100)], payments: [{ methodId: cash, amount: 100, destination: 'CASH' }] }))
truthy('شماره فیش سند تعویض باطل دوباره استفاده نشد', Number(next?.receiptNo ?? 0) > Number(invRow(exInvA)?.receiptNo ?? 0))
await throwsWith('ابطال دوباره رد می‌شود', () => voidIt(retA), 'باطل')
await throwsWith('برگشت روی سند تعویض باطل رد می‌شود', () => salesService.createReturn({ invoiceId: exInvA, full: true, lines: [], refundMethod: 'NONE', userId }))
const again = await safe('همان قلم دوباره قابل تعویض است', () => exchange(A.inv.id, A.items[0].id, variant(200), 'CASH'))
truthy('تعویض دوباره ثبت شد', !!again?.returnId)
eq('بدهی دوباره ۶۰۰', await remainingOf(A.inv.id), 600)
closed(await report())

// ===========================================================================
console.log('\n۲) فاکتور پرداخت‌شده، تعویض ۶۰۰ ⇒ ۲۰۰ با اعتبار خرید دست‌نخورده ⇒ ابطال + ابطال اعتبار')
const B = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const exB = await safe('تعویض با اعتبار', () => exchange(B.inv.id, B.items[0].id, variant(200), 'STORE_CREDIT'))
const credB = seed.one('SELECT * FROM "StoreCredit" WHERE returnId = ?', exB?.returnId ?? -1)
eq('اعتبار ۴۰۰ صادر شده بود', Number(credB?.amount ?? 0), 400)
const vB = await safe('ابطال', () => voidIt(exB?.returnId))
eq('اعتبار باطل شد', seed.one('SELECT status FROM "StoreCredit" WHERE id = ?', credB?.id ?? -1)?.status, 'CANCELED')
truthy('نتیجه فقط مرجع امن اعتبار باطل‌شده را نام می‌برد', (vB?.canceledCreditRefs ?? []).includes(`اعتبار #${credB?.id}`))
truthy('نتیجه ابطال کد قابل‌مصرف اعتبار را افشا نمی‌کند', !JSON.stringify(vB).includes(String(credB?.code ?? '---')))
truthy('سند تعویض باطل شد', invRow(exB?.exchangeInvoiceId ?? -1)?.voidedAt != null)
eq('باقی‌مانده‌ی فاکتور اصلی صفر', await remainingOf(B.inv.id), 0)
closed(await report())

// ===========================================================================
console.log('\n۳) اعتبار تعویض خرج شده ⇒ ابطال ناممکن، rollback کامل + رسیدگی مدیر')
const C = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const repC = variant(200)
const exC = await safe('تعویض با اعتبار', () => exchange(C.inv.id, C.items[0].id, repC, 'STORE_CREDIT'))
const credC = seed.one('SELECT * FROM "StoreCredit" WHERE returnId = ?', exC?.returnId ?? -1)
sql.prepare('UPDATE "StoreCredit" SET usedAmount = 100, status = ? WHERE id = ?').run('PARTIALLY_USED', credC?.id ?? -1)
const stC = stockOf(repC)
await throwsWith('ابطال رد می‌شود', () => voidIt(exC?.returnId), 'مصرف')
truthy('سند برگشت تعویض فعال ماند', retRow(exC?.returnId ?? -1)?.voidedAt == null)
truthy('سند تعویض فعال ماند', invRow(exC?.exchangeInvoiceId ?? -1)?.voidedAt == null && invRow(exC?.exchangeInvoiceId ?? -1)?.status !== 'CANCELED')
eq('موجودی کالای جایگزین دست نخورد', stockOf(repC), stC)
eq('یک ردیف «رسیدگی مدیر»', reviewRows(exC?.returnId ?? -1), 1)

// ===========================================================================
console.log('\n۴) بازپرداخت نقدی مابه‌التفاوت (پول از کشو رفته) ⇒ ابطال ناممکن')
const D = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const exD = await safe('تعویض با بازپرداخت نقدی ۴۰۰', () => exchange(D.inv.id, D.items[0].id, variant(200), 'CASH'))
await throwsWith('ابطال رد می‌شود (نقد)', () => voidIt(exD?.returnId), 'نقد')
truthy('سند تعویض فعال ماند', invRow(exD?.exchangeInvoiceId ?? -1)?.voidedAt == null)
eq('ردیف «رسیدگی مدیر»', reviewRows(exD?.returnId ?? -1), 1)
closed(await report())

// ===========================================================================
console.log('\n۵) مابه‌التفاوت از مشتری دریافت شده (کالای ۹۰۰ به‌جای ۶۰۰) ⇒ ابطال ناممکن')
const E = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const exE = await safe('تعویض با دریافت ۳۰۰', () => exchange(E.inv.id, E.items[0].id, variant(900), undefined))
eq('مابه‌التفاوت دریافتی ۳۰۰', Number(exE?.diff ?? 0), 300)
await throwsWith('ابطال رد می‌شود (پول دریافتی)', () => voidIt(exE?.returnId), 'دریافت')
truthy('سند تعویض فعال ماند', invRow(exE?.exchangeInvoiceId ?? -1)?.voidedAt == null)
eq('ردیف «رسیدگی مدیر»', reviewRows(exE?.returnId ?? -1), 1)

// ===========================================================================
console.log('\n۶) روی خودِ سند تعویض برگشت ثبت شده ⇒ ابطال ناممکن')
const F = await safe('نسیه‌ی ۱٬۰۰۰', () => twoItems(0))
const exF = await safe('تعویض ۶۰۰ با ۲۰۰', () => exchange(F.inv.id, F.items[0].id, variant(200), 'CASH'))
const exItems = itemsOf(exF?.exchangeInvoiceId ?? -1)
await safe('برگشت کالای جایگزین از سند تعویض', () => salesService.createReturn({ invoiceId: exF.exchangeInvoiceId, full: false, lines: [{ saleItemId: exItems[0].id, qty: 1 }], refundMethod: 'STORE_CREDIT', refundAmount: 200, userId }))
await throwsWith('ابطال رد می‌شود (برگشت روی سند تعویض)', () => voidIt(exF?.returnId), 'سند تعویض')
truthy('سند تعویض فعال ماند', invRow(exF?.exchangeInvoiceId ?? -1)?.voidedAt == null)
await throwsWith('اصلاح جبرانی هم روی گراف دارای برگشت بعدی رد می‌شود', () =>
  salesService.returnReconcileVoid({
    id: exF?.returnId, userId, reason: 'تلاش اصلاح با برگشت جایگزین',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  }),
  'برگشت فعال'
)

// ===========================================================================
console.log('\n۷) کارت‌به‌کارت در انتظار ⇒ ابطال + لغو درخواست، کالای معلق وارد موجودی نمی‌شود')
const G = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const repG = variant(200)
const stRetG = stockOf(G.a), stRepG = stockOf(repG)
const exG = await safe('تعویض کارت‌به‌کارت ۴۰۰', () => exchange(G.inv.id, G.items[0].id, repG, 'CARD_TO_CARD'))
eq('درخواست در انتظار', seed.one('SELECT status FROM "CardTransferRequest" WHERE returnId = ?', exG?.returnId ?? -1)?.status, 'PENDING')
await safe('ابطال', () => voidIt(exG?.returnId))
eq('درخواست کارت‌به‌کارت لغو شد', seed.one('SELECT status FROM "CardTransferRequest" WHERE returnId = ?', exG?.returnId ?? -1)?.status, 'CANCELED')
eq('موجودی کالای برگشتی (معلق بود) دست‌نخورده', stockOf(G.a), stRetG)
eq('موجودی کالای جایگزین برگشت', stockOf(repG), stRepG)
truthy('سند تعویض باطل شد', invRow(exG?.exchangeInvoiceId ?? -1)?.voidedAt != null)
closed(await report())

// ===========================================================================
console.log('\n۸) ویرایش سند برگشت تعویض همچنان بسته است (فقط ابطال کل گراف)')
const H = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const exH = await safe('تعویض با اعتبار', () => exchange(H.inv.id, H.items[0].id, variant(200), 'STORE_CREDIT'))
await throwsWith('ویرایش رد می‌شود و راه ابطال را می‌گوید', () => salesService.returnUpdate({ id: exH?.returnId, lines: [{ saleItemId: H.items[0].id, qty: 0 }], userId }), 'ابطال')

// ===========================================================================
console.log('\n۹) اصلاح جبرانی تعویض: دو جهت انبار + پرداخت فعلی')
const repE = itemsOf(exE?.exchangeInvoiceId ?? -1)[0]?.variantId
truthy('کالای جایگزین تعویض پیدا شد', Number.isFinite(repE))
eq('کالای برگشتی پس از تعویض داخل انبار است', stockOf(E.a), 100)
eq('کالای جایگزین پس از تعویض خارج از انبار است', stockOf(repE), 99)
const corrE = await safe('ثبت پرداخت نقدی جبرانیِ ناقص برای تعویض مثبت', () =>
  salesService.returnReconcileVoid({
    id: exE?.returnId,
    userId,
    reason: 'اصلاح تعویض با مابه‌التفاوت دریافتی',
    cashRecovered: 0,
    cardRecovered: 0,
    cashPaidOut: 200,
    cardPaidOut: 0,
    creditOutcome: 'NONE'
  })
)
truthy('سند برگشت تعویض سر جای خود ماند', retRow(exE?.returnId ?? -1)?.voidedAt == null)
truthy('سند جایگزین تعویض سر جای خود ماند', invRow(exE?.exchangeInvoiceId ?? -1)?.voidedAt == null)
eq('اثر جبرانی، کالای برگشتی را از انبار فعلی خارج کرد', stockOf(E.a), 99)
eq('اثر جبرانی، کالای جایگزین را به انبار فعلی برگرداند', stockOf(repE), 100)
eq('بخش پرداخت‌نشده به مشتری به‌عنوان مغایرت ماند', corrE?.unrecoveredAmount, 100)
truthy('پرداخت نقدی جبرانی روی کشوی فعلی ثبت شد', !!seed.one(`SELECT id FROM "CashMovement" WHERE refType = 'ReturnCorrection' AND refId = ? AND type = 'CASH_OUT'`, corrE?.id))
const corrETypes = seed.rows('SELECT type FROM "ReturnCorrectionEffect" WHERE correctionId = ? ORDER BY id', corrE?.id).map((x) => x.type)
truthy('دفتر تعویض هر دو جهت انبار و پول/مغایرت را جدا دارد', corrETypes.join(',') === 'INVENTORY_OUT,EXCHANGE_REPLACEMENT_IN,CASH_PAID_OUT,UNPAID_EXCHANGE_PAYOUT')
await throwsWith('اصلاح جبرانی تعویض دوباره ثبت نمی‌شود', () =>
  salesService.returnReconcileVoid({ id: exE?.returnId, userId, reason: 'تلاش دوباره تعویض', cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE' }),
  'قبلاً اصلاح جبرانی'
)

// ===========================================================================
console.log('\n۱۰) اصلاح جبرانی تعویض با کاهش بدهی: بدهی مبدأ دوباره قابل‌مطالبه است')
const J = await safe('فاکتور نسیه‌ی ۱٬۰۰۰ برای اصلاح کاهش بدهی', () => twoItems(0))
const repJ = variant(200)
const exJ = await safe('تعویض ۶۰۰ با ۲۰۰ که ۴۰۰ از بدهی کم می‌کند', () => exchange(J.inv.id, J.items[0].id, repJ, 'CASH'))
eq('پس از تعویض، بدهی مبدأ ۶۰۰ است', await remainingOf(J.inv.id), 600)
const corrJ = await safe('اصلاح جبرانی تعویضِ کاهش‌دهنده‌ی بدهی', () =>
  salesService.returnReconcileVoid({
    id: exJ?.returnId,
    userId,
    reason: 'اصلاح تعویض کاهنده‌ی بدهی',
    cashRecovered: 0,
    cardRecovered: 0,
    cashPaidOut: 0,
    cardPaidOut: 0,
    creditOutcome: 'NONE'
  })
)
truthy('اصلاح تعویضِ کاهش‌دهنده‌ی بدهی ثبت شد', !!corrJ?.id)
eq('اصلاح، بدهی ۴۰۰ ریالیِ حذف‌شده را در گزارش بدهی مبدأ برگرداند', await remainingOf(J.inv.id), 1000)
eq('کالای برگشتی از موجودی فعلی خارج شد', stockOf(J.a), 99)
eq('کالای جایگزین به موجودی فعلی برگشت', stockOf(repJ), 100)

// ===========================================================================
console.log('\n۱۱) اصلاح جبرانی تعویضِ مثبت با پرداخت کارت: رد مستقل کارت/بانک')
const K = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ برای پرداخت کارتی جبرانی', () => twoItems(1000))
const repK = variant(900)
const exK = await safe('تعویض ۶۰۰ با ۹۰۰', () => exchange(K.inv.id, K.items[0].id, repK, 'CASH'))
await throwsWith('پرداخت کارتیِ بی‌مرجع رد می‌شود', () =>
  salesService.returnReconcileVoid({
    id: exK?.returnId, userId, reason: 'اصلاح کارت بدون مرجع',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 300, creditOutcome: 'NONE'
  }),
  'شماره پیگیری'
)
const corrK = await safe('پرداخت کارتی جبرانی با مرجع', () =>
  salesService.returnReconcileVoid({
    id: exK?.returnId, userId, reason: 'اصلاح کارت با مرجع',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 300,
    cardPayoutReference: 'POS-EX-300', creditOutcome: 'NONE'
  })
)
eq('پرداخت کارتی جبرانی مغایرت باز ندارد', corrK?.unrecoveredAmount, 0)
const cardPayoutEffect = seed.one(`SELECT detailsJson FROM "ReturnCorrectionEffect" WHERE correctionId = ? AND type = 'CARD_PAID_OUT'`, corrK?.id)
truthy('دفتر کارت، مرجع پرداخت جبرانی را نگه می‌دارد', String(cardPayoutEffect?.detailsJson ?? '').includes('POS-EX-300'))
eq('پرداخت کارت، گردش نقدیِ کشو نمی‌سازد', seed.rows(`SELECT id FROM "CashMovement" WHERE refType = 'ReturnCorrection' AND refId = ?`, corrK?.id).length, 0)

// ===========================================================================
console.log('\n۱۲) اصلاح جبرانی تعویض کارت‌به‌کارتِ معلق: تعهد پرداخت لغو می‌شود')
const L = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ برای کارت‌به‌کارت معلق', () => twoItems(1000))
const repL = variant(200)
const exL = await safe('تعویض ۶۰۰ با ۲۰۰ کارت‌به‌کارت', () => exchange(L.inv.id, L.items[0].id, repL, 'CARD_TO_CARD'))
const pendingL = seed.one('SELECT id, status FROM "CardTransferRequest" WHERE returnId = ?', exL?.returnId ?? -1)
eq('درخواست کارت‌به‌کارت تعویض قبل از اصلاح معلق است', pendingL?.status, 'PENDING')
const corrL = await safe('اصلاح جبرانی کارت‌به‌کارت معلق', () =>
  salesService.returnReconcileVoid({
    id: exL?.returnId, userId, reason: 'اصلاح تعویض کارت به کارت معلق',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  })
)
eq('اصلاح جبرانی، درخواست پرداخت معلق را لغو کرد', seed.one('SELECT status FROM "CardTransferRequest" WHERE id = ?', pendingL?.id)?.status, 'CANCELED')
truthy('دفتر، لغو تعهد کارت‌به‌کارت را اثر مستقل نگه می‌دارد', !!seed.one(`SELECT id FROM "ReturnCorrectionEffect" WHERE correctionId = ? AND type = 'CARD_TO_CARD_CANCELED'`, corrL?.id))
eq('کالای جایگزینِ تعویض معلق به موجودی برگشت', stockOf(repL), 100)

// ===========================================================================
console.log('\n۱۳) کارت‌به‌کارتِ ناقص: سقف بازیافت فقط پرداخت واقعی است')
const M = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ برای کارت‌به‌کارت ناقص', () => twoItems(1000))
const repM = variant(200)
const exM = await safe('تعویض ۶۰۰ با ۲۰۰ کارت‌به‌کارت', () => exchange(M.inv.id, M.items[0].id, repM, 'CARD_TO_CARD'))
const reqM = seed.one('SELECT id FROM "CardTransferRequest" WHERE returnId = ?', exM?.returnId ?? -1)
await safe('ثبت پرداخت واقعیِ ناقص ۲۰۰', () => cardTransferService.pay({ id: reqM?.id, paidAmount: 200, userId, managerPassword: PW }))
await safe('ثبت اصلاح منفی ۵۰ برای پرداخت کارت‌به‌کارت', () => cardTransferService.adjust({ id: reqM?.id, amount: -50, reason: 'بخشی از پرداخت برگشت خورد', userId, managerPassword: PW }))
await throwsWith('بازیافت بیشتر از خالص پرداخت واقعیِ کارت‌به‌کارت رد می‌شود', () =>
  salesService.returnReconcileVoid({
    id: exM?.returnId, userId, reason: 'تلاش بازیافت بیشتر از پرداخت واقعی',
    cashRecovered: 200, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  }),
  'بیشتر است'
)
const corrM = await safe('اصلاح با بازیافت برابر خالص پرداخت واقعی', () =>
  salesService.returnReconcileVoid({
    id: exM?.returnId, userId, reason: 'اصلاح کارت به کارت پرداخت ناقص',
    cashRecovered: 150, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  })
)
eq('بازیافت ناقصِ واقعی، مغایرت باز ندارد', corrM?.unrecoveredAmount, 0)
eq('کالای برگشتیِ آزادشده با اصلاح دوباره از موجودی خارج شد', stockOf(M.a), 99)
eq('کالای جایگزینِ تعویض ناقص به موجودی برگشت', stockOf(repM), 100)

// ===========================================================================
console.log('\n۱۴) پیوند کارت‌به‌کارت خراب: چند درخواست مرجع ⇒ رد fail-closed')
const N = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ برای پیوند کارت‌به‌کارت خراب', () => twoItems(1000))
const repN = variant(200)
const exN = await safe('تعویض کارت‌به‌کارت برای آزمون پیوند خراب', () => exchange(N.inv.id, N.items[0].id, repN, 'CARD_TO_CARD'))
seed.insert('CardTransferRequest', { returnId: exN?.returnId, kind: 'REQUEST', status: 'CANCELED', amount: 400 })
await throwsWith('چند درخواست کارت‌به‌کارت برای یک تعویض، اصلاح را متوقف می‌کند', () =>
  salesService.returnReconcileVoid({
    id: exN?.returnId, userId, reason: 'اصلاح با پیوند کارت خراب',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  }),
  'بیش از یک درخواست'
)
eq('رد fail-closed، موجودی کالای جایگزین را دوباره تغییر نمی‌دهد', stockOf(repN), 99)

// ===========================================================================
console.log('\n۱۵) وضعیت کارت‌به‌کارت متناقض: لغوشده با پرداخت ⇒ رد fail-closed')
const O = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰ برای وضعیت کارت متناقض', () => twoItems(1000))
const repO = variant(200)
const exO = await safe('تعویض کارت‌به‌کارت برای وضعیت متناقض', () => exchange(O.inv.id, O.items[0].id, repO, 'CARD_TO_CARD'))
const reqO = seed.one('SELECT id FROM "CardTransferRequest" WHERE returnId = ?', exO?.returnId ?? -1)
sql.prepare(`UPDATE "CardTransferRequest" SET status = 'CANCELED', paidAmount = 50, paidAt = ? WHERE id = ?`).run(Date.now(), reqO?.id)
await throwsWith('درخواست لغوشده با مبلغ پرداخت‌شده، اصلاح را متوقف می‌کند', () =>
  salesService.returnReconcileVoid({
    id: exO?.returnId, userId, reason: 'اصلاح با وضعیت کارت متناقض',
    cashRecovered: 0, cardRecovered: 0, cashPaidOut: 0, cardPaidOut: 0, creditOutcome: 'NONE'
  }),
  'لغوشده'
)
eq('رد وضعیت متناقض، موجودی کالای جایگزین را دست‌نخورده نگه می‌دارد', stockOf(repO), 99)

// ===========================================================================
console.log('\n۱۶) ساختاری')
truthy('migration ستون‌های ابطال فاکتور', existsSync(join(ROOT, 'prisma/migrations/20270928100000_sale_invoice_void/migration.sql')))
const invModel = (src('prisma/schema.prisma').match(/model SaleInvoice \{[\s\S]*?\n\}/) ?? [''])[0]
truthy('schema: SaleInvoice.voidedAt/voidedByUserId/voidReason', /voidedAt\s+DateTime\?/.test(invModel) && /voidedByUserId\s+Int\?/.test(invModel) && /voidReason\s+String\?/.test(invModel))
const svc = src('src/main/services/SalesService.ts')
// نشست ۱۸۶: بلوک «بازه‌ی پیش‌فرض امروز» به ابتدای تابع اضافه شد، پس فاصله بیشتر شد.
// آنچه سنجیده می‌شود همان است: `voidedAt: null` داخل همین تابع.
truthy('saleWhere فاکتور باطل را بیرون می‌گذارد', /export function saleWhere[\s\S]{0,2600}voidedAt: null/.test(svc))
const staff = src('src/main/services/StaffReportService.ts')
eq('گزارش کارمندان: هر ۴ کوئری فاکتور voidedAt: null دارد', (staff.match(/saleInvoice\.findMany\(\{\s*where: \{[^\n]*voidedAt: null/g) ?? []).length, 4)
truthy('جزئیات شیفت فاکتور باطل را نمی‌شمارد', /saleInvoice\.findMany\(\{\s*where: \{ shiftId, voidedAt: null \}/.test(src('src/main/services/ShiftService.ts')))
const ui = src('src/renderer/src/pages/SalesReports.tsx')
truthy('تب تعویض گزارش دکمه‌ی ابطال با دلیل دارد', /saleReturnDelete,\s*\{[^}]*reason/.test(ui) && ui.includes('exchangeVoided') && ui.includes('onVoid'))
truthy('تعویض، اصلاح جبرانیِ جدا و فرم تسویه‌ی دوطرفه دارد', ui.includes('onCorrection') && ui.includes('cashPaidOut') && svc.includes('CARD_PAID_OUT'))
truthy('migration پرداخت جبرانی تعویض وجود دارد', existsSync(join(ROOT, 'prisma/migrations/20271018100000_exchange_correction_settlement/migration.sql')))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
