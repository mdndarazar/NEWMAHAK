/**
 * ===========================================================================
 * نشست ۱۳۶ — خوشه E (قفل دوره) + هدف ضدسرقت مالک
 *
 * باگ بازتولیدشده:
 *   ۱) چهار mutation پرداخت (addPayment با تاریخ گذشته، updatePayment،
 *      deletePayment/ابطال، setChequeStatus) هیچ گیت «دوره‌ی بسته» نداشتند.
 *      مثال: صندوق دیروز با کسری ۳۰۰ ریال بسته شده؛ فروشنده امروز پرداخت ۳۰۰
 *      ریالیِ دیروز را «باطل» می‌کند ⇒ نقد مورد انتظارِ روزِ بسته ۳۰۰ کم می‌شود
 *      و کسری از گزارش بسته ناپدید می‌شود، بی رمز مدیر و بی دلیل.
 *   ۲) PeriodLockService.status تاریخ را فقط با پنجره‌ی ساعتی نشست می‌سنجید؛
 *      سند با تاریخ دستی گذشته روی ساعت ۱۲:۰۰ می‌نشیند، پس اگر صندوقِ آن روز
 *      ۱۴:۰۰ تا ۲۲:۰۰ بوده، روز بسته «باز» دیده می‌شد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s136-payment-period-lock.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s136-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { periodLockService } = await import('../../src/main/services/PeriodLockService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate, jalaliStartOfDay } = await import('@shared/jalali')

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

const lockProbe = []
for (const op of ['findUnique', 'upsert', 'update', 'create', 'updateMany', 'deleteMany']) {
  const orig = db.authLockout?.[op]
  if (typeof orig !== 'function') continue
  db.authLockout[op] = (...args) => { lockProbe.push({ op, depth: db.$harness.depth }); return orig.apply(db.authLockout, args) }
}

const PW = DEFAULT_MANAGER_PASSWORD
const WHY = 'اصلاح تست نشست ۱۳۶'
const userId = seed.user('فروشنده تست نشست ۱۳۶')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار جین', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const yesterday = toJalaliDate(new Date(Date.now() - 86400000))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const pay = (id) => seed.one('SELECT * FROM "Payment" WHERE id = ?', id)
const payCount = (invoiceId) => Number(seed.one('SELECT COUNT(*) AS n FROM "Payment" WHERE invoiceId = ?', invoiceId)?.n ?? 0)
const overrides = () => seed.rows(`SELECT * FROM "AuditLog" WHERE action = 'CLOSED_PERIOD_OVERRIDE' AND entity = 'Payment'`)

// ---------------- داده‌ی دیروز، قبل از بستن صندوق دیروز ----------------
const invY = await safe('فاکتور نسیه‌ی ۱٬۰۰۰ دیروز با پرداخت نقدی ۳۰۰', () =>
  salesService.create({ userId, shiftId, issuedAtJalali: yesterday, lines: [line(variant(1000), 1000)], payments: [{ methodId: cash, amount: 300, destination: 'CASH' }] }))
const payY = seed.one('SELECT id, paidAt FROM "Payment" WHERE invoiceId = ? ORDER BY id', invY?.id ?? -1)
truthy('پرداخت ۳۰۰ دیروز ثبت شد', !!payY?.id)
const chqY = await safe('چک ۲۰۰ روی همان فاکتور (در جریان)', () =>
  salesService.addPayment({ userId, invoiceId: invY.id, kind: 'CHEQUE', amount: 200, dueDateJalali: today, chequeNo: '136-1' }))
const chqYId = chqY?.payment?.id ?? seed.one(`SELECT id FROM "Payment" WHERE invoiceId = ? AND kind = 'CHEQUE' ORDER BY id DESC`, invY?.id ?? -1)?.id
// این چک «دیروز ساعت ۱۲» پاس شده بود (پیش از بستن صندوق دیروز)
const yNoon = new Date(jalaliStartOfDay(yesterday).getTime() + 12 * 3600_000)
sql.prepare(`UPDATE "Payment" SET chequeStatus = 'CLEARED', clearedAt = ?, clearedAtJalali = ?, destination = 'MANAGER' WHERE id = ?`)
  .run(yNoon.getTime(), yesterday, chqYId)
const chqToday = await safe('چک ۱۰۰ دوم (در جریان)', () =>
  salesService.addPayment({ userId, invoiceId: invY.id, kind: 'CHEQUE', amount: 100, dueDateJalali: today, chequeNo: '136-2' }))
const chqTodayId = chqToday?.payment?.id ?? seed.one(`SELECT id FROM "Payment" WHERE invoiceId = ? AND kind = 'CHEQUE' ORDER BY id DESC`, invY?.id ?? -1)?.id

// صندوق دیروز: فقط ۱۴:۰۰ تا ۲۲:۰۰ و بسته‌شده (شیفت بعدازظهر). ساعت ۱۲ داخل پنجره‌ی ساعتی نیست.
const yStart = jalaliStartOfDay(yesterday).getTime()
seed.insert('CashSession', {
  fromDate: yStart + 14 * 3600_000, toDate: yStart + 22 * 3600_000,
  dayJalali: yesterday, closedAt: yStart + 22 * 3600_000, createdAt: yStart + 22 * 3600_000
})

// ===========================================================================
console.log('\n۱) قفل دوره بر مبنای روز شمسی برای تاریخ گذشته')
const stNoon = await safe('وضعیت دیروز ساعت ۱۲', () => periodLockService.status({ at: yNoon }))
eq('روزِ دارای صندوق بسته، حتی بیرون از پنجره‌ی ساعتی، بسته دیده می‌شود', stNoon?.locked, true)
const stNow = await safe('وضعیت همین لحظه', () => periodLockService.status({ at: new Date() }))
eq('امروز (بدون صندوق بسته‌ی شامل این لحظه) باز می‌ماند', stNow?.locked, false)

console.log('\n۲) ثبت پرداخت با تاریخ روز بسته')
const n0 = payCount(invY?.id ?? -1)
await throwsWith('paidAtJalali دیروز بدون رمز/دلیل ⇒ پیام فارسی دوره‌ی بسته',
  () => salesService.addPayment({ userId, invoiceId: invY.id, amount: 50, methodId: cash, destination: 'CASH', paidAtJalali: yesterday }), 'دوره')
eq('هیچ پرداختی بی‌صدا ثبت نشد', payCount(invY?.id ?? -1), n0)
lockProbe.length = 0
await throwsWith('رمز غلط رد می‌شود',
  () => salesService.addPayment({ userId, invoiceId: invY.id, amount: 50, methodId: cash, destination: 'CASH', paidAtJalali: yesterday, managerPassword: 'غلط-۱۳۶', overrideReason: WHY }), 'رمز')
eq('سنجش رمز وسط تراکنش باز انجام نشد (ضد brute-force)', lockProbe.filter((p) => p.depth > 0).length, 0)
truthy('رمز واقعاً بیرون از تراکنش سنجیده شد', lockProbe.some((p) => p.depth === 0))
const okAdd = await safe('با رمز مدیر و دلیل', () =>
  salesService.addPayment({ userId, invoiceId: invY.id, amount: 50, methodId: cash, destination: 'CASH', paidAtJalali: yesterday, managerPassword: PW, overrideReason: WHY }))
truthy('با رمز و دلیل ثبت شد', !!okAdd)
truthy('Audit عبور از دوره‌ی بسته برای Payment ثبت شد', overrides().length >= 1)
const okNow = await safe('پرداخت امروز بدون تاریخ دستی', () =>
  salesService.addPayment({ userId, invoiceId: invY.id, amount: 10, methodId: cash, destination: 'CASH' }))
truthy('پرداخت امروز رمز نمی‌خواهد (رگرسیون)', !!okNow)

console.log('\n۳) ابطال پرداختِ روز بسته (پنهان‌کردن کسری صندوق بسته)')
await throwsWith('ابطال پرداخت ۳۰۰ دیروز بدون رمز ⇒ رد',
  () => salesService.deletePayment({ id: payY.id, userId, reason: 'اشتباه' }), 'دوره')
eq('پرداخت دیروز باطل نشد', pay(payY?.id ?? -1)?.voidedAt ?? null, null)

console.log('\n۴) ویرایش پرداخت')
await throwsWith('تغییر مبلغ پرداخت دیروز بدون رمز ⇒ رد',
  () => salesService.updatePayment({ id: payY.id, userId, amount: 100 }), 'دوره')
eq('مبلغ پرداخت دیروز دست‌نخورده', Number(pay(payY?.id ?? -1)?.amount ?? -1), 300)
const noteOnly = await safe('ویرایش فقط توضیح', () => salesService.updatePayment({ id: payY.id, userId, note: 'فقط توضیح' }))
truthy('ویرایش غیرمالی (توضیح) رمز نمی‌خواهد', !!noteOnly)
const todayPayId = okNow?.payment?.id
await throwsWith('انتقال تاریخ پرداخت امروز به روز بسته بدون رمز ⇒ رد',
  () => salesService.updatePayment({ id: todayPayId, userId, paidAtJalali: yesterday }), 'دوره')
eq('تاریخ پرداخت امروز عوض نشد', pay(todayPayId ?? -1)?.paidAtJalali, today)

console.log('\n۵) وضعیت چک')
await throwsWith('برگرداندن چکِ پاس‌شده‌ی دیروز به «در جریان» بدون رمز ⇒ رد',
  () => salesService.setChequeStatus({ id: chqYId, status: 'PENDING', userId }), 'رمز')
await throwsWith('همان برگشت با رمز ولی بدون دلیل دوره‌ی بسته ⇒ رد',
  () => salesService.setChequeStatus({ id: chqYId, status: 'PENDING', userId, managerPassword: PW }), 'دوره')
eq('چک دیروز همچنان پاس‌شده', pay(chqYId ?? -1)?.chequeStatus, 'CLEARED')
await throwsWith('پاس کردن چک با تاریخ پاس دیروز بدون رمز ⇒ رد',
  () => salesService.setChequeStatus({ id: chqTodayId, status: 'CLEARED', clearedAtJalali: yesterday, destination: 'MANAGER', userId }), 'رمز')
await throwsWith('پاس کردن با تاریخ دیروز با رمز ولی بدون دلیل ⇒ رد',
  () => salesService.setChequeStatus({ id: chqTodayId, status: 'CLEARED', clearedAtJalali: yesterday, destination: 'MANAGER', userId, managerPassword: PW }), 'دوره')
eq('چک دوم همچنان در جریان', pay(chqTodayId ?? -1)?.chequeStatus, 'PENDING')
await throwsWith('پاس کردن امروز بدون رمز ⇒ رد',
  () => salesService.setChequeStatus({ id: chqTodayId, status: 'CLEARED', destination: 'MANAGER', userId }), 'رمز')
const clrNow = await safe('پاس کردن امروز با رمز', () => salesService.setChequeStatus({ id: chqTodayId, status: 'CLEARED', destination: 'MANAGER', userId, managerPassword: PW }))
truthy('پاس کردن امروز با رمز انجام می‌شود', !!clrNow)
const revY = await safe('برگرداندن چک دیروز با رمز و دلیل', () =>
  salesService.setChequeStatus({ id: chqYId, status: 'PENDING', userId, managerPassword: PW, overrideReason: WHY }))
truthy('با رمز و دلیل انجام شد', !!revY)
const delY = await safe('ابطال پرداخت دیروز با رمز و دلیل', () =>
  salesService.deletePayment({ id: payY.id, userId, reason: 'اصلاح', managerPassword: PW, overrideReason: WHY }))
truthy('ابطال با رمز انجام شد و ردپا ماند', !!delY && overrides().length >= 3)

console.log('\n۶) شیفت صبحِ امروز بسته شده؛ شیفت بعدی امروز نباید قفل شود')
const now = Date.now()
seed.insert('CashSession', { fromDate: now - 5 * 3600_000, toDate: now - 2 * 3600_000, dayJalali: today, closedAt: now - 2 * 3600_000, createdAt: now - 2 * 3600_000 })
const st2 = await safe('وضعیت همین لحظه', () => periodLockService.status({ at: new Date() }))
eq('امروز همین لحظه باز است', st2?.locked, false)
const okLive = await safe('پرداخت زنده‌ی امروز', () => salesService.addPayment({ userId, invoiceId: invY.id, amount: 5, methodId: cash, destination: 'CASH' }))
truthy('پرداخت زنده‌ی امروز پس از بسته‌شدن شیفت صبح رد نمی‌شود', !!okLive)

console.log('\n۷) سیم‌کشی UI پنجره‌ی پرداخت‌ها (ساختاری)')
const modal = readFileSync(new URL('../../src/renderer/src/components/InvoicePaymentsModal.tsx', import.meta.url), 'utf8')
truthy('فیلدهای رمز مدیر/دلیل پس از پیام «دوره‌ی بسته» ظاهر می‌شوند', /noteLock\(/.test(modal) && modal.includes('setLockNeeded(true)'))
truthy('ثبت پرداخت رمز/دلیل را می‌فرستد', /CH\.salePaymentAdd[\s\S]{0,1200}\.\.\.lockFields\(\)/.test(modal))
truthy('ابطال پرداخت رمز/دلیل را می‌فرستد', /CH\.salePaymentDelete[\s\S]{0,400}\.\.\.lockFields\(\)/.test(modal))
truthy('تغییر وضعیت چک رمز/دلیل را می‌فرستد', /CH\.saleChequeStatus, \{[^}]*\.\.\.lockFields\(\) \}/.test(modal))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
