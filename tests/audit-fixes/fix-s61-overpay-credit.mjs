/**
 * ===========================================================================
 * نشست ۶ زنجیره رفع (نشست ۶۱) — خوشه C: مراحل ۲ و ۳ فلوی اضافه‌دریافت
 *
 *   ۴-۳۵ — اضافه‌دریافت: (۱) هشدار (۲) «کد اعتبار برای مبلغ اضافه صادر بشود؟»
 *          (۳) بله ⇒ کد اعتبار (۴) نه ⇒ ردیف «دریافت پول اضافه». هرگز بی‌صدا.
 *   ۴-۵۵ — اضافه‌دریافتِ بعد از برگشت جزئی هم همان فلو (صدور بعدی از اضافه‌دریافت موجود).
 *   ۴-۳۷ — اعتبار فقط برای پولی که واقعاً دریافت شده (چکِ پاس‌نشده/مصرف اعتبار ⇒ رد).
 *   ۴-۳۲ — اعتبار هرگز نقد نمی‌شود؛ ضدسرقت: اعتبار صادرشده هیچ‌وقت از اضافه‌دریافت
 *          واقعی فاکتور بیشتر نمی‌ماند (حذف/ویرایش پرداخت پشتوانه ⇒ رد کامل + rollback).
 *   پل تطبیق در همه‌ی سناریوها (از جمله فاکتور دوره‌ی قبل) بسته و اضافه‌دریافت دو بار کم نمی‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s61-overpay-credit.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s61-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست ۶۱' }
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const creditShared = await import('@shared/credit')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

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

const userId = seed.user('مدیر تست نشست ۶۱')
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
const payRows = (invoiceId) => seed.rows('SELECT id, amount, overpayAmount FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL ORDER BY seq, id', invoiceId)
const overpaySum = (invoiceId) => payRows(invoiceId).reduce((s, p) => s + Number(p.overpayAmount ?? 0), 0)
const creditsOf = (invoiceId) => seed.rows('SELECT * FROM "StoreCredit" WHERE sourceInvoiceId = ? ORDER BY id', invoiceId)
const creditCount = () => Number(seed.one('SELECT COUNT(*) AS c FROM "StoreCredit"').c)
/** فاکتور دو قلمی ۶۰۰ + ۴۰۰ = ۱٬۰۰۰ با پرداخت اولیه‌ی دلخواه */
const twoItemSale = async (paid) => {
  const a = variant(600); const b = variant(400)
  return salesService.create({
    userId, shiftId,
    lines: [{ variantId: a, qty: 1, unitPrice: 600, discount: 0, tax: 0 }, { variantId: b, qty: 1, unitPrice: 400, discount: 0, tax: 0 }],
    payments: paid > 0 ? [{ methodId: cash, amount: paid, destination: 'CASH' }] : []
  })
}
const pay = (invoiceId, amount, extra = {}) =>
  salesService.addPayment({ invoiceId, amount, methodId: cash, destination: 'CASH', userId, ...extra })
const report = async () => {
  const filter = { fromJalali: today, toJalali: today }
  const { statements } = await buildStatements({
    where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today),
    period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter
  }, { withDrillDown: true })
  return statements
}
const rowsOf = (s) => Object.fromEntries(s.bridge.rows.map((r) => [r.key, r.sign * r.amount]))
const closed = (s, label = 'پل تطبیق بسته است (مانده‌ی بی‌توضیح)') => eq(label, s?.bridge?.unexplained, 0)
const back = (id) => {
  const t = Date.now() - 86400000 * 2
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=? WHERE id=?').run(t, toJalaliDate(new Date(t)), id)
  sql.prepare('UPDATE "Payment" SET paidAt=?, paidAtJalali=? WHERE invoiceId=?').run(t, toJalaliDate(new Date(t)), id)
}

// ---------------------------------------------------------------------------
console.log('\n۰) منبع تازه‌ی اعتبار «اضافه‌دریافت» (OVERPAY) در لایه‌ی مشترک')
eq('CreditSource.OVERPAY تعریف شده', creditShared.CreditSource?.OVERPAY, 'OVERPAY')
eq('normalizeCreditSource(OVERPAY) به EXCHANGE تبدیل نمی‌شود', creditShared.normalizeCreditSource('OVERPAY'), 'OVERPAY')
truthy('برچسب فارسی منبع OVERPAY وجود دارد', !!creditShared.CREDIT_SOURCE_LABELS?.OVERPAY)
eq('نوع اعتبار OVERPAY بعد از صدور به MANUAL قابل تغییر نیست', creditShared.sourceChangeError('OVERPAY', 'MANUAL') != null, true)

// ---------------------------------------------------------------------------
console.log('\n۱) نسیه‌ی ۱٬۰۰۰، دریافت ۱٬۳۰۰ با «بله، کد اعتبار صادر کن» (مراحل ۱ تا ۳)')
const base1 = await report()
const inv1 = await twoItemSale(0)
await throwsWith('بدون تأیید آگاهانه همچنان هشدار می‌دهد (مرحله ۱)', () => pay(inv1.id, 1300, { overpayAsCredit: true }), 'بیشتر است')
eq('هشدار هیچ اعتباری نساخت', creditsOf(inv1.id).length, 0)
const r1 = await safe('ثبت با confirmOverpay + overpayAsCredit', () => pay(inv1.id, 1300, { confirmOverpay: true, overpayAsCredit: true }))
eq('کل مبلغ پرداخت ثبت شد (پول واقعاً در کشو است)', Number(payRows(inv1.id)[0]?.amount ?? 0), 1300)
eq('اضافه‌دریافت ردیف پرداخت', overpaySum(inv1.id), 300)
const c1 = creditsOf(inv1.id)
eq('دقیقاً یک اعتبار صادر شد', c1.length, 1)
eq('مبلغ اعتبار = فقط مبلغ اضافه', Number(c1[0]?.amount ?? 0), 300)
eq('منبع اعتبار = OVERPAY', c1[0]?.source, 'OVERPAY')
truthy('نتیجه‌ی سرویس فقط مرجع امن اعتبار را برمی‌گرداند', r1?.overpayCredit?.publicReference === `اعتبار #${c1[0]?.id}` && !Object.hasOwn(r1?.overpayCredit ?? {}, 'code'))
eq('نتیجه‌ی سرویس مبلغ اعتبار را برمی‌گرداند', r1?.overpayCredit?.amount, 300)
truthy('نتیجه عبارت «غیرقابل نقد شدن» دارد (بند ۴-۳۲)', String(r1?.overpayCredit?.notice ?? '').includes('غیرقابل نقد شدن'))
const aud1 = seed.rows(`SELECT note FROM "AuditLog" WHERE entity = 'StoreCredit' AND entityId = ?`, c1[0]?.id ?? -1)
truthy('صدور در Audit با اشاره به اضافه‌دریافت ثبت شد', aud1.some((a) => String(a.note).includes('اضافه‌دریافت')))
const s1 = await report()
const d1 = rowsOf(s1), b1 = rowsOf(base1)
eq('وجه واقعی +۱٬۳۰۰', (d1.realCash ?? 0) - (b1.realCash ?? 0), 1300)
eq('فروش خالص +۱٬۰۰۰', s1.bridge.target - base1.bridge.target, 1000)
eq('اضافه‌دریافت فقط یک بار از پل کم شد (اعتبار صادرشده‌ی پل برای آن دوباره کم نشد)',
  ((d1.overpayReceived ?? 0) - (b1.overpayReceived ?? 0)) + ((d1.storeCreditIssued ?? 0) - (b1.storeCreditIssued ?? 0)), -300)
eq('گزارش اعتبار: صادرشده‌ی بازه شامل همین بارکد است (بند ۴-۴۸)', s1.storeCredits.issued - base1.storeCredits.issued, 300)
eq('گزارش اعتبار: سهم صادرشده از اضافه‌دریافت جدا دیده می‌شود', (s1.storeCredits.issuedFromOverpay ?? -1) - (base1.storeCredits.issuedFromOverpay ?? 0), 300)
closed(s1)
const overRow = s1.bridge.rows.find((r) => r.key === 'overpayReceived')
truthy('ردیف اضافه‌دریافت پل توضیح «تبدیل به اعتبار» دارد', String(overRow?.hint ?? '').includes('اعتبار'))

// ---------------------------------------------------------------------------
console.log('\n۲) مرحله ۴: «نه» ⇒ هیچ اعتباری، ردیف دریافت پول اضافه (رفتار قبلی حفظ شد)')
const before2 = creditCount()
const inv2 = await twoItemSale(0)
const r2 = await safe('ثبت با confirmOverpay بدون اعتبار', () => pay(inv2.id, 1200, { confirmOverpay: true }))
eq('اعتباری ساخته نشد', creditCount(), before2)
eq('overpayCredit در نتیجه خالی است', r2?.overpayCredit ?? null, null)
eq('اضافه‌دریافت ۲۰۰ روی پرداخت ماند', overpaySum(inv2.id), 200)
const s2 = await report()
eq('ردیف دریافت پول اضافه‌ی پل +۲۰۰ (منفی در پل)', (rowsOf(s2).overpayReceived ?? 0) - (rowsOf(s1).overpayReceived ?? 0), -200)
closed(s2)

// ---------------------------------------------------------------------------
console.log('\n۳) درخواست اعتبار بدون مبلغ اضافه، یا روی چک ⇒ رد صریح')
const inv3 = await twoItemSale(0)
await throwsWith('پرداخت کمتر از بدهی + overpayAsCredit ⇒ رد', () => pay(inv3.id, 400, { confirmOverpay: true, overpayAsCredit: true }), 'اضافه')
eq('پرداخت ردشده ثبت نشد (rollback)', payRows(inv3.id).length, 0)
await throwsWith('چک + overpayAsCredit ⇒ رد (چک هنوز پول نیست)', () =>
  salesService.addPayment({ invoiceId: inv3.id, amount: 1500, kind: 'CHEQUE', dueDateJalali: today, userId, confirmOverpay: true, overpayAsCredit: true }), 'چک')
eq('هیچ اعتباری برای فاکتور ۳ صادر نشد', creditsOf(inv3.id).length, 0)

// ---------------------------------------------------------------------------
console.log('\n۴) ضدسرقت: حذف/ویرایش پرداخت پشتوانه‌ی اعتبار ⇒ رد کامل و rollback')
const inv4 = await twoItemSale(0)
await safe('پرداخت اول ۵۰۰', () => pay(inv4.id, 500))
await safe('پرداخت دوم ۸۰۰ با اعتبار ۳۰۰', () => pay(inv4.id, 800, { confirmOverpay: true, overpayAsCredit: true }))
eq('اعتبار ۳۰۰ صادر شد', Number(creditsOf(inv4.id)[0]?.amount ?? 0), 300)
const [p41, p42] = payRows(inv4.id)
await throwsWith('حذف پرداخت ۵۰۰ (اضافه‌دریافت را صفر می‌کرد و اعتبار ۳۰۰ بی‌پشتوانه می‌ماند) ⇒ رد',
  () => salesService.deletePayment({ id: p41?.id, userId, ...GATE }), 'اعتبار')
eq('پرداخت ۵۰۰ سر جایش ماند', payRows(inv4.id).length, 2)
eq('اضافه‌دریافت همان ۳۰۰ ماند', overpaySum(inv4.id), 300)
await throwsWith('ویرایش پرداخت ۸۰۰ به ۶۰۰ ⇒ رد', () => salesService.updatePayment({ id: p42?.id, amount: 600, userId, ...GATE }), 'اعتبار')
eq('مبلغ پرداخت ۸۰۰ تغییر نکرد', Number(payRows(inv4.id)[1]?.amount ?? 0), 800)
await safe('ویرایش پرداخت ۸۰۰ به ۹۰۰ (اضافه‌دریافت بیشتر) مجاز است', () => salesService.updatePayment({ id: p42?.id, amount: 900, userId, ...GATE }))
eq('اضافه‌دریافت ۴۰۰ شد', overpaySum(inv4.id), 400)
// ابطال اعتبار ⇒ آزاد شدن پشتوانه
sql.prepare(`UPDATE "StoreCredit" SET status = 'CANCELED', voidedAt = ? WHERE sourceInvoiceId = ?`).run(Date.now(), inv4.id)
await safe('بعد از ابطال اعتبارِ مصرف‌نشده، حذف پرداخت ۵۰۰ مجاز است', () => salesService.deletePayment({ id: p41?.id, userId, reason: 'اصلاح تست ۶۱', ...GATE }))
eq('پرداخت ۵۰۰ حذف شد', payRows(inv4.id).length, 1)

// ---------------------------------------------------------------------------
console.log('\n۵) بند ۴-۵۵: اضافه‌دریافتِ ناشی از برگشت جزئی ⇒ همان فلو (صدور بعدی)')
const inv5 = await twoItemSale(1000)
const it5 = itemsOf(inv5.id)
await safe('برگشت قلم ۴۰۰ بدون بازپرداخت روی فاکتور پرداخت‌شده', () =>
  salesService.createReturn({ invoiceId: inv5.id, full: false, lines: [{ saleItemId: it5[1].id, qty: 1 }], refundMethod: RefundMethod.NONE, confirmOverpay: true, userId }))
eq('اضافه‌دریافت فاکتور بعد از برگشت', overpaySum(inv5.id), 400)
truthy('سرویس صدور اعتبار از اضافه‌دریافت موجود وجود دارد', typeof salesService.overpayCreditIssue === 'function')
await throwsWith('بیش از اضافه‌دریافت ⇒ رد', () => salesService.overpayCreditIssue({ invoiceId: inv5.id, amount: 500, userId }), 'اضافه')
const r5 = await safe('صدور ۴۰۰', () => salesService.overpayCreditIssue({ invoiceId: inv5.id, amount: 400, userId }))
eq('اعتبار ۴۰۰ صادر شد', Number(creditsOf(inv5.id)[0]?.amount ?? 0), 400)
truthy('نتیجه فقط مرجع امن دارد', r5?.publicReference === `اعتبار #${creditsOf(inv5.id)[0]?.id}` && !Object.hasOwn(r5 ?? {}, 'code'))
await throwsWith('صدور دوباره (چیزی نمانده) ⇒ رد', () => salesService.overpayCreditIssue({ invoiceId: inv5.id, amount: 1, userId }), 'اضافه')
eq('فقط یک اعتبار برای فاکتور ۵', creditsOf(inv5.id).length, 1)
closed(await report())

// ---------------------------------------------------------------------------
console.log('\n۶) وصول فاکتور دوره‌ی قبل با اضافه‌دریافت و اعتبار ⇒ پل بسته')
const inv6 = await twoItemSale(0)
back(inv6.id)
const b6 = await report()
await safe('دریافت ۱٬۲۰۰ روی نسیه‌ی دو روز پیش با اعتبار ۲۰۰', () => pay(inv6.id, 1200, { confirmOverpay: true, overpayAsCredit: true }))
eq('اعتبار ۲۰۰', Number(creditsOf(inv6.id)[0]?.amount ?? 0), 200)
const s6 = await report()
eq('فروش خالص امروز تغییر نکرد', s6.bridge.target - b6.bridge.target, 0)
closed(s6)

// ---------------------------------------------------------------------------
console.log('\n۷) drill-down ردیف «اعتبار صادرشده» پل با عدد خودش می‌خواند')
const s7 = await report()
const scRow = s7.bridge.rows.find((r) => r.key === 'storeCreditIssued')
const scSources = (scRow?.sources ?? []).reduce((s, x) => s + Number(x.amount ?? 0), 0)
eq('جمع اسناد drill-down = عدد ردیف', scSources, scRow?.amount ?? 0)

// ---------------------------------------------------------------------------
console.log('\n۸) جعل نوع: صدور دستی/گروهی با نوع OVERPAY ⇒ رد (وگرنه از ردیف اعتبار صادرشده‌ی پل پنهان می‌ماند)')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
// نشست ۱۴۳ · بند ۴-۲۹ — صدور دستی از این نشست رمز مدیر اجباری در main دارد.
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const n8 = creditCount()
await throwsWith('صدور گروهی با source=OVERPAY ⇒ رد', () =>
  storeCreditService.bulkIssue({ count: 2, amountEach: 1000, source: 'OVERPAY', userId }), 'اضافه‌دریافت')
const m8 = await safe('صدور تکی مدیریتی با source=OVERPAY', () => storeCreditService.issueManual({ amount: 1000, source: 'OVERPAY', userId, managerPassword: DEFAULT_MANAGER_PASSWORD }))
eq('صدور تکی حتی با source=OVERPAY همیشه MANUAL ثبت می‌شود', seed.one('SELECT source FROM "StoreCredit" ORDER BY id DESC LIMIT 1')?.source, 'MANUAL')
eq('هیچ اعتبار OVERPAY بی‌فاکتور ساخته نشد', Number(seed.one(`SELECT COUNT(*) AS c FROM "StoreCredit" WHERE source = 'OVERPAY' AND sourceInvoiceId IS NULL`).c), 0)
// ⚠️ یافته‌ی جدا (خوشه D، رفع نشده): اعتبار مدیریتیِ بدون فاکتور در ردیف «اعتبار صادرشده» پل کم
// می‌شود ولی هیچ فروشی پشتش نیست ⇒ پل به اندازه‌ی مبلغش باز می‌ماند. اینجا عمداً سنجیده نمی‌شود.

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
