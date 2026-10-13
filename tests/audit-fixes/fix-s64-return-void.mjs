/**
 * ===========================================================================
 * نشست ۶۳ — خوشه C / بند ۴-۲۲: «حذف» برگشت ساده = ابطال (void)، نه حذف فیزیکی.
 *
 * قبل: returnDelete سند برگشت و اقلامش را فیزیکی پاک می‌کرد (مدرک از بین
 * می‌رفت)، اعتبار خرید صادرشده از همان برگشت فعال و قابل خرج می‌ماند (تولید
 * اعتبار بی‌پشتوانه) و بازپرداخت نقدی از کشو (CashMovement) سر جایش می‌ماند
 * در حالی که سند برگشتش غیب شده بود.
 * بعد: سند با مهر voidedAt/voidedByUserId/voidReason می‌ماند و از همه‌ی
 * محاسبه‌ها بیرون می‌رود؛ اثرهای برگشت‌پذیر در همان تراکنش برمی‌گردند (انبار،
 * درخواست کارت‌به‌کارت در انتظار، اعتبار دست‌نخورده)؛ اثرهای برگشت‌ناپذیر
 * (پول واقعاً پرداخت‌شده، اعتبار خرج‌شده، مصرف اعتبار برگشت‌خورده) ⇒ rollback
 * کامل + ردیف «رسیدگی مدیر».
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s63-return-void.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s63v-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { setManagerCorrectionApprovalPassword } = await import('../../src/main/services/AuthService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { PANEL_KEYS, allLockedConfig } = await import('@shared/panels')

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

const userId = seed.user('مدیر تست ابطال')
const cat = seed.category('پوشاک')
const product = seed.product('کاپشن', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
/** بخش‌های تاریخی این تست اثرهای مالی را می‌سنجند؛ مدیر آگاهانه قفل عملیات را برای همان setup خاموش کرده است. */
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReturnCorrection]: false })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const stockOf = (v) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', v)?.stock ?? -1)
const retRow = (id) => seed.one('SELECT * FROM "SaleReturn" WHERE id = ?', id)
const itemsOf = (invoiceId) => seed.rows('SELECT id, variantId FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const twoItems = async (paid) => {
  const a = variant(600), b = variant(400)
  const inv = await salesService.create({ userId, shiftId, lines: [line(a, 600), line(b, 400)], payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : [] })
  return { inv, a, b, items: itemsOf(inv.id) }
}
const ret = (invoiceId, saleItemId, refundMethod = RefundMethod.NONE, refundAmount = undefined) =>
  salesService.createReturn({ invoiceId, full: false, lines: [{ saleItemId, qty: 1 }], refundMethod, refundAmount, userId })
const retId = (r) => r?.id ?? r?.returnId
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
const voidIt = (id, reason = 'ثبت اشتباه برگشت') => salesService.returnDelete({ id, userId, reason })

// ===========================================================================
console.log('\n۱) برگشت بدون بازپرداخت روی نسیه (کاهش بدهی) ⇒ ابطال')
const A = await safe('نسیه‌ی ۱٬۰۰۰', () => twoItems(0))
const stock0 = stockOf(A.a)
const rA = await safe('برگشت قلم ۶۰۰', () => ret(A.inv.id, A.items[0].id))
eq('بدهی بعد از برگشت ۴۰۰', await remainingOf(A.inv.id), 400)
eq('موجودی بعد از برگشت +۱', stockOf(A.a), stock0 + 1)
await throwsWith('ابطال بدون دلیل رد می‌شود', () => salesService.returnDelete({ id: retId(rA), userId }), 'دلیل')
truthy('سند بعد از رد، سالم و فعال مانده', !!retRow(retId(rA)) && retRow(retId(rA)).voidedAt == null)
const vA = await safe('ابطال با دلیل', () => voidIt(retId(rA)))
const rowA = retRow(retId(rA))
truthy('سند برگشت حذف فیزیکی نشد (مدرک ماند)', !!rowA)
truthy('مهر زمان ابطال', rowA?.voidedAt != null)
eq('مهر کاربر ابطال', Number(rowA?.voidedByUserId ?? 0), userId)
eq('دلیل ابطال ذخیره شد', rowA?.voidReason, 'ثبت اشتباه برگشت')
eq('اقلام سند برگشت هم ماندند', seed.rows('SELECT id FROM "SaleReturnItem" WHERE returnId = ?', retId(rA)).length, 1)
eq('بدهی به ۱٬۰۰۰ برگشت', await remainingOf(A.inv.id), 1000)
eq('موجودی به حالت قبل از برگشت', stockOf(A.a), stock0)
eq('وضعیت فاکتور دیگر «برگشت جزئی» نیست', seed.one('SELECT status FROM "SaleInvoice" WHERE id = ?', A.inv.id)?.status === 'PARTIALLY_RETURNED', false)
truthy('نتیجه‌ی ابطال voided=true دارد', vA?.voided === true)
const audA = seed.rows(`SELECT action, note FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? ORDER BY id DESC`, retId(rA))
truthy('Audit ابطال با دلیل', audA.some((x) => x.action === 'VOID' && String(x.note).includes('ثبت اشتباه برگشت')))
const list = await safe('فهرست برگشت‌ها', () => salesService.returnList({ fromJalali: today, toJalali: today }))
const listRows = Array.isArray(list) ? list : list?.rows ?? []
eq('سند باطل در فهرست برگشت‌های فعال نیست', listRows.some((r) => r.id === retId(rA)), false)
closed(await report())
await throwsWith('ابطال دوباره رد می‌شود', () => voidIt(retId(rA)), 'باطل')
await throwsWith('ویرایش سند باطل رد می‌شود', () => salesService.returnUpdate({ id: retId(rA), lines: [{ saleItemId: A.items[0].id, qty: 1 }], userId }), 'باطل')
const rA2 = await safe('همان قلم دوباره قابل برگشت است (سند باطل سقف را نمی‌خورد)', () => ret(A.inv.id, A.items[0].id))
truthy('برگشت دوباره ثبت شد', !!retId(rA2))
eq('بدهی دوباره ۴۰۰', await remainingOf(A.inv.id), 400)
closed(await report())

// ===========================================================================
console.log('\n۲) برگشت با اعتبار خرید دست‌نخورده ⇒ ابطال + ابطال اعتبار')
const B = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const rB = await safe('برگشت ۶۰۰ با اعتبار خرید', () => ret(B.inv.id, B.items[0].id, RefundMethod.STORE_CREDIT, 600))
const credB = seed.one('SELECT * FROM "StoreCredit" WHERE returnId = ?', retId(rB))
truthy('اعتبار ۶۰۰ صادر شده بود', Number(credB?.amount ?? 0) === 600)
await safe('ابطال', () => voidIt(retId(rB)))
const credB2 = seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', credB?.id ?? -1)
eq('اعتبار صادرشده از برگشت باطل شد', credB2?.status, 'CANCELED')
truthy('اعتبار مهر ابطال دارد', credB2?.voidedAt != null)
truthy('سند برگشت باطل شد', retRow(retId(rB))?.voidedAt != null)
closed(await report())

// ===========================================================================
console.log('\n۳) برگشت با اعتبار خرج‌شده ⇒ ابطال ناممکن، rollback کامل + رسیدگی مدیر')
const C = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const rC = await safe('برگشت ۶۰۰ با اعتبار', () => ret(C.inv.id, C.items[0].id, RefundMethod.STORE_CREDIT, 600))
const credC = seed.one('SELECT * FROM "StoreCredit" WHERE returnId = ?', retId(rC))
sql.prepare('UPDATE "StoreCredit" SET usedAmount = 200, status = ? WHERE id = ?').run('PARTIALLY_USED', credC.id)
const stockC = stockOf(C.a)
await throwsWith('ابطال رد می‌شود با توضیح فارسی', () => voidIt(retId(rC)), 'مصرف')
truthy('سند برگشت فعال ماند (rollback)', retRow(retId(rC))?.voidedAt == null)
eq('موجودی دست نخورد', stockOf(C.a), stockC)
eq('اعتبار دست نخورد', seed.one('SELECT status FROM "StoreCredit" WHERE id = ?', credC.id)?.status, 'PARTIALLY_USED')
const revC = seed.rows(`SELECT note FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND note LIKE '%رسیدگی مدیر%'`, retId(rC))
eq('یک ردیف «رسیدگی مدیر» ثبت شد (بیرون از تراکنش ردشده)', revC.length, 1)

// ===========================================================================
console.log('\n۴) برگشت با بازپرداخت نقدی (پول واقعاً از کشو رفته) ⇒ ابطال ناممکن')
const D = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const rD = await safe('برگشت ۴۰۰ با بازپرداخت نقدی', () => ret(D.inv.id, D.items[1].id, RefundMethod.CASH, 400))
const cmD = seed.rows(`SELECT id FROM "CashMovement" WHERE refType = 'SaleReturn' AND refId = ?`, retId(rD)).length
const before4 = await report()
await throwsWith('ابطال رد می‌شود (پول پرداخت‌شده)', () => voidIt(retId(rD)), 'نقد')
truthy('سند برگشت سر جایش ماند', !!retRow(retId(rD)) && retRow(retId(rD)).voidedAt == null)
eq('حرکت صندوق بازپرداخت دست نخورد', seed.rows(`SELECT id FROM "CashMovement" WHERE refType = 'SaleReturn' AND refId = ?`, retId(rD)).length, cmD)
closed(await report(), 'پل بعد از رد ابطال بسته است')
eq('گزارش عوض نشد (همان مانده‌ی بی‌توضیح)', (await report()).bridge.target, before4.bridge.target)

// ===========================================================================
console.log('\n۵) کارت‌به‌کارت در انتظار ⇒ ابطال + لغو درخواست')
const E = await safe('فاکتور پرداخت‌شده‌ی ۱٬۰۰۰', () => twoItems(1000))
const rE = await safe('برگشت ۴۰۰ کارت‌به‌کارت', () => ret(E.inv.id, E.items[1].id, RefundMethod.CARD_TO_CARD, 400))
await safe('ابطال', () => voidIt(retId(rE)))
eq('درخواست کارت‌به‌کارت لغو شد', seed.one('SELECT status FROM "CardTransferRequest" WHERE returnId = ?', retId(rE))?.status, 'CANCELED')
truthy('سند برگشت باطل شد', retRow(retId(rE))?.voidedAt != null)
closed(await report())

// ===========================================================================
console.log('\n۶) قفل عملیات ابطال: نصب تازه قفل است؛ فقط مدیر می‌تواند آگاهانه بازش کند')
/** حذف Setting = دقیقاً رفتار نصب تازه، نه تنظیمی که setup بالاتر آگاهانه باز کرده بود. */
sql.prepare('DELETE FROM "Setting" WHERE key = ?').run(SETTING_KEYS.panelLocks)
const F = await safe('فاکتور نسیه برای قفل پیش‌فرض', () => twoItems(0))
const rF = await safe('برگشت برای قفل پیش‌فرض', () => ret(F.inv.id, F.items[0].id))
await throwsWith(
  'نصب تازه: فراخوان مستقیمِ ویرایش بی‌رمز رد می‌شود',
  () => salesService.returnUpdate({ id: retId(rF), userId, lines: [{ saleItemId: F.items[0].id, qty: 1 }], overrideReason: 'تست قفل ویرایش' }),
  'تأیید مدیر'
)
truthy('رد گیت ویرایش، قلم برگشت را دست‌نخورده می‌گذارد', seed.rows('SELECT id FROM "SaleReturnItem" WHERE returnId = ?', retId(rF)).length === 1)
await safe('نصب تازه: رمز مدیر ویرایش را مجاز می‌کند', () =>
  salesService.returnUpdate({
    id: retId(rF), userId, lines: [{ saleItemId: F.items[0].id, qty: 1 }],
    panelPassword: DEFAULT_MANAGER_PASSWORD, managerPassword: DEFAULT_MANAGER_PASSWORD, overrideReason: 'تست قفل ویرایش'
  })
)
const updateAuditF = seed.one(`SELECT after FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'SALE_RETURN' ORDER BY id DESC`, retId(rF))
truthy('Audit ویرایش سطح MANAGER قفل عملیات را نگه می‌دارد', String(updateAuditF?.after ?? '').includes('"correctionAuthScope":"MANAGER"'))
await throwsWith(
  'نصب تازه: اصلاح جبرانی بی‌رمز رد می‌شود',
  () => salesService.returnReconcileVoid({ id: retId(rF), userId, reason: 'تست قفل اصلاح', cashRecovered: 0, cardRecovered: 0, creditOutcome: 'NONE' }),
  'تأیید مدیر'
)
await throwsWith('نصب تازه: فراخوان مستقیمِ ابطال بی‌رمز رد می‌شود', () => voidIt(retId(rF), 'ابطال پیش‌فرض قفل'), 'تأیید مدیر')
truthy('رد گیت، سند را باطل نمی‌کند', retRow(retId(rF))?.voidedAt == null)
const voidF = await safe('نصب تازه: رمز مدیر ابطال را مجاز می‌کند', () =>
  salesService.returnDelete({ id: retId(rF), userId, reason: 'ابطال پیش‌فرض قفل', panelPassword: DEFAULT_MANAGER_PASSWORD })
)
truthy('رمز مدیر، ابطال پیش‌فرض قفل‌شده را ثبت کرد', voidF?.voided === true && retRow(retId(rF))?.voidedAt != null)
const auditF = seed.one(`SELECT after FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'VOID' ORDER BY id DESC`, retId(rF))
truthy('Audit سطح MANAGER قفل عملیات را نگه می‌دارد', String(auditF?.after ?? '').includes('"correctionAuthScope":"MANAGER"'))

/** مدیر اگر آگاهانه قفل را خاموش کند، همان سیاست OPEN فقط برای این عمل اعمال می‌شود. */
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReturnCorrection]: false })
const G = await safe('فاکتور نسیه با قفل عملیاتِ عمداً خاموش', () => twoItems(0))
const rG = await safe('برگشت با قفل عملیاتِ عمداً خاموش', () => ret(G.inv.id, G.items[0].id))
await safe('قفلِ عمداً خاموش: ابطال روز جاری بی‌رمز انجام می‌شود', () => voidIt(retId(rG), 'ابطال با قفل عمداً خاموش'))
const auditG = seed.one(`SELECT after FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'VOID' ORDER BY id DESC`, retId(rG))
truthy('Audit سطح OPEN فقط پس از تنظیم صریح مدیر است', String(auditG?.after ?? '').includes('"correctionAuthScope":"OPEN"'))
/** ادامه‌ی سناریوهای مالی قدیمی هم صراحتاً همین حالت را می‌خواهند. */
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReturnCorrection]: false })

// ===========================================================================
console.log('\n۷) روز عملیاتی و تأیید هویت شخصی مدیر')
const H = await safe('فاکتور برای ابطال دیرهنگام', () => twoItems(0))
const rH = await safe('برگشت برای ابطال دیرهنگام', () => ret(H.inv.id, H.items[0].id))
const yesterdayAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
const yesterday = toJalaliDate(yesterdayAt)
sql.prepare('UPDATE "SaleReturn" SET returnedAt = ?, returnedAtJalali = ? WHERE id = ?').run(yesterdayAt.getTime(), yesterday, retId(rH))
await throwsWith('فروشنده روز بعد، حتی با رمز سراسری، مدیر شخصی ندارد ⇒ رد', () =>
  salesService.returnDelete({
    id: retId(rH),
    userId,
    reason: 'اصلاح دیرهنگام تستی',
    managerPassword: DEFAULT_MANAGER_PASSWORD
  }), 'مدیر تأییدکننده')
truthy('رد هویت دیرهنگام، سند را دست‌نخورده نگه می‌دارد', retRow(retId(rH))?.voidedAt == null)
await safe('تعریف رمز شخصی مدیر تست', () =>
  setManagerCorrectionApprovalPassword({ userId, password: '2468', actorUserId: userId })
)
await throwsWith('رمز شخصی غلط مدیر رد می‌شود', () =>
  salesService.returnDelete({
    id: retId(rH),
    userId,
    reason: 'اصلاح دیرهنگام تستی',
    approverUserId: userId,
    approverPassword: '0000'
  }), 'رمز شخصی')
const voidH = await safe('مدیر شخصی، ابطال دیرهنگام را تأیید می‌کند', () =>
  salesService.returnDelete({
    id: retId(rH),
    userId,
    reason: 'اصلاح دیرهنگام تستی',
    approverUserId: userId,
    approverPassword: '2468'
  })
)
truthy('ابطال دیرهنگام با هویت مدیر ثبت شد', voidH?.voided === true && voidH?.approvingManager?.userId === userId)
const auditH = seed.one(`SELECT after FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'VOID' ORDER BY id DESC`, retId(rH))
truthy('Audit ابطال دیرهنگام، مدیر تأییدکننده و روز عملیاتی را نگه می‌دارد',
  String(auditH?.after ?? '').includes('"approvingManager":{"userId":' + userId) && String(auditH?.after ?? '').includes('"sameOperationalDay":false'))

// ===========================================================================
console.log('\n۸) اصلاح جبرانی: سند مبدأ می‌ماند، اثرها در شیفت فعلی ثبت می‌شوند')
const I = await safe('فاکتور پرداخت‌شده برای دفتر جبرانی', () => twoItems(1000))
const rI = await safe('برگشت نقدی برای دفتر جبرانی', () => ret(I.inv.id, I.items[0].id, RefundMethod.CASH, 600))
eq('موجودی بعد از برگشت نقدی +۱', stockOf(I.a), 100)
const correctionI = await safe('ثبت بازیافت ناقص نقد و خروج جبرانی موجودی', () =>
  salesService.returnReconcileVoid({
    id: retId(rI),
    userId,
    reason: 'ثبت اشتباه بازپرداخت نقدی',
    cashRecovered: 400,
    cardRecovered: 0,
    creditOutcome: 'NONE'
  })
)
truthy('سند برگشت اصلی باطل/حذف نشد', retRow(retId(rI))?.voidedAt == null)
eq('موجودی با اثر جبرانی به قبل از برگشت برگشت', stockOf(I.a), 99)
eq('اصلاح جبرانی، کسری بازیافت‌نشده را پنهان نمی‌کند', correctionI?.unrecoveredAmount, 200)
eq('یک دفتر جبرانی مستقل ساخته شد', seed.rows('SELECT id FROM "ReturnCorrection" WHERE returnId = ?', retId(rI)).length, 1)
const correctionEffects = seed.rows('SELECT type FROM "ReturnCorrectionEffect" WHERE correctionId = ? ORDER BY id', correctionI?.id)
truthy('سه اثر مستقل انبار/نقد/مغایرت ثبت شد', correctionEffects.map((r) => r.type).join(',') === 'INVENTORY_OUT,CASH_RECOVERED,UNRECOVERED_REFUND')
truthy('اثر نقد بازیافتی در کشوی شیفت فعلی است', !!seed.one(`SELECT id FROM "CashMovement" WHERE refType = 'ReturnCorrection' AND refId = ? AND type = 'CASH_IN'`, correctionI?.id))
eq('وضعیت فاکتور پس از اثر جبرانی دوباره تسویه است', seed.one('SELECT status FROM "SaleInvoice" WHERE id = ?', I.inv.id)?.status, 'SETTLED')
await throwsWith('اصلاح جبرانی تکراری برای همان برگشت رد می‌شود', () =>
  salesService.returnReconcileVoid({
    id: retId(rI), userId, reason: 'تلاش تکراری اصلاح', cashRecovered: 0, cardRecovered: 0, creditOutcome: 'NONE'
  }), 'قبلاً اصلاح جبرانی')

// ===========================================================================
console.log('\n۹) اصلاح جبرانی دیرهنگام با مدیرِ مشخص')
const J = await safe('فاکتور نسیه برای اصلاح دیرهنگام', () => twoItems(0))
const rJ = await safe('برگشت نسیه برای اصلاح دیرهنگام', () => ret(J.inv.id, J.items[0].id))
sql.prepare('UPDATE "SaleReturn" SET returnedAt = ?, returnedAtJalali = ? WHERE id = ?').run(yesterdayAt.getTime(), yesterday, retId(rJ))
await throwsWith('اصلاح دیرهنگام بدون مدیر شخصی رد می‌شود', () =>
  salesService.returnReconcileVoid({ id: retId(rJ), userId, reason: 'اصلاح دیرهنگام جبرانی', cashRecovered: 0, cardRecovered: 0, creditOutcome: 'NONE' }),
  'مدیر تأییدکننده'
)
const correctionJ = await safe('اصلاح دیرهنگام با مدیر شخصی ثبت می‌شود', () =>
  salesService.returnReconcileVoid({
    id: retId(rJ), userId, reason: 'اصلاح دیرهنگام جبرانی', cashRecovered: 0, cardRecovered: 0, creditOutcome: 'NONE',
    approverUserId: userId, approverPassword: '2468'
  })
)
eq('هویت مدیر روی خود دفتر جبرانی ذخیره شد', seed.one('SELECT approvingManagerId FROM "ReturnCorrection" WHERE id = ?', correctionJ?.id)?.approvingManagerId, userId)

// ===========================================================================
console.log('\n۱۰) ساختاری')
const svc = src('src/main/services/SalesService.ts')
const delBody = (svc.match(/async returnDelete\([\s\S]*?\n  },\n/) ?? [''])[0]
const correctionBody = (svc.match(/async returnReconcileVoid\([\s\S]*?\n  },\n\n  \/\*\* خواندنی: دفتر اصلاح/) ?? [''])[0]
truthy('returnDelete دیگر saleReturn.delete ندارد', delBody.length > 0 && !delBody.includes('saleReturn.delete('))
truthy('returnDelete اقلام را پاک نمی‌کند', delBody.length > 0 && !delBody.includes('saleReturnItem.deleteMany'))
truthy('migration ستون‌های ابطال', existsSync(join(ROOT, 'prisma/migrations/20270927100000_sale_return_void/migration.sql')))
const ui = src('src/renderer/src/pages/SalesReturn.tsx')
truthy('صفحه‌ی برگشت دلیل ابطال را می‌فرستد', /saleReturnDelete,\s*\{[^}]*reason/.test(ui))
truthy('ابطال سمت سرور قفل اختصاصی خودش را پیش از تراکنش می‌سنجد', /assertPanelPassword\(\s*PANEL_KEYS\.salesReturnCorrection/.test(delBody))
eq('قفل اختصاصی اصلاح/ابطال در نصب تازه روشن است', allLockedConfig()[PANEL_KEYS.salesReturnCorrection], true)
truthy('ابطال دیرهنگام هویت شخصی مدیر را سمت سرور می‌سنجد', /verifyManagerCorrectionApproval\([\s\S]{0,500}approverUserId/.test(delBody))
truthy('رمز شخصی مدیر فقط هش‌شده در AuthService است', /purpose: 'MANAGER_RETURN_CORRECTION'/.test(src('src/main/services/AuthService.ts')))
truthy('migration دفتر جبرانی مستقل وجود دارد', existsSync(join(ROOT, 'prisma/migrations/20271018000000_return_correction_ledger/migration.sql')))
truthy('اصلاح جبرانی سند مبدأ را void/delete نمی‌کند', correctionBody.includes('returnCorrection.create') && !correctionBody.includes('saleReturn.delete(') && !correctionBody.includes('saleReturn.update('))
truthy('فرم تسویه‌ی واقعی اصلاح جبرانی در صفحه‌ی برگشت وجود دارد', /CH\.saleReturnCorrection/.test(ui) && /نقدی که واقعاً به کشوی فعلی برگشت/.test(ui))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
