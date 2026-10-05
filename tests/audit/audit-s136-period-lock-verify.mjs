/**
 * ممیزی نشست ۱۳۶ (S136-1..3) — قفل دوره روی پرداخت‌ها، رفتاری.
 * AUDIT-S136-01: قاعده‌ی «روز شمسی» S136-1 برای هر لحظه‌ی گذشته اعمال می‌شد، حتی لحظه‌ی واقعیِ داخل
 *   نشستِ هنوز باز (شیفت شب که از نیمه‌شب گذشته) ⇒ ابطال/ویرایش پرداخت ۲۱:۰۰ دیشبِ همان نشست باز
 *   رمز مدیر می‌خواست، در حالی که هیچ صندوق بسته‌ای آن لحظه را نشمرده است.
 * AUDIT-S136-02: لحظه‌های گیت از خوانش بیرون از تراکنش (pre) ساخته می‌شدند و داخل تراکنش با ردیف فعلی
 *   دوباره سنجیده نمی‌شدند ⇒ تغییر هم‌زمان پرداخت/چک به روز بسته، ابطال/برگشت را بی‌رمز عبور می‌داد.
 * AUDIT-S136-03: پنجره‌ی پرداخت‌ها تاریخ پیش‌فرض را هنگام باز شدن ثابت می‌کرد و همیشه می‌فرستاد ⇒ پنجره‌ای
 *   که از نیمه‌شب گذشته پرداختِ «همین حالا» را روی ساعت ۱۲ دیروز (داخل صندوق بسته‌ی صبح) می‌نشاند.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s136a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { periodLockService } = await import(join(root, 'src/main/services/PeriodLockService.ts'))
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 400) } } }
const LOCK_RE = /دوره|همین حالا عوض شد|تغییر کرد/
const H = 3600_000
const today = jalaliToday()
const tStart = jalaliStartOfDay(today).getTime()
const yStart = tStart - 24 * H
const yesterday = toJalaliDate(new Date(yStart + 12 * H))
const userId = seed.user('فروشنده شب ۱۳۶')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
// صندوق صبح دیروز ۸ تا ۱۴ بسته شده؛ شیفت شب از ۲۰ دیروز باز است و هنوز بسته نشده.
seed.insert('CashSession', { fromDate: yStart + 8 * H, toDate: yStart + 14 * H, dayJalali: yesterday, closedAt: yStart + 14 * H, createdAt: yStart + 14 * H })
const nightShift = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: yesterday, openedAt: yStart + 20 * H, userId })
const inv = seed.insert('SaleInvoice', { receiptNo: 13601, status: 'FINAL', grandTotal: 1000000, paidTotal: 0, goodsTotal: 1000000, issuedAt: yStart + 21 * H, issuedAtJalali: yesterday, shiftId: nightShift, userId })
const addPay = (at, amount, extra = {}) => seed.insert('Payment', { invoiceId: inv, methodId: cash, amount, seq: 1 + seed.count('Payment', 'invoiceId = ?', inv), paidAt: at, paidAtJalali: toJalaliDate(new Date(at)), destination: 'CASH', createdShiftId: nightShift, createdByUserId: userId, createdAt: at, ...extra })
const pay = (id) => seed.one('SELECT * FROM "Payment" WHERE id = ?', id)

console.log('\n— ۱) لحظه‌ی واقعیِ داخل شیفت شبِ باز (دیشب ۲۱:۰۰)')
{
  const st21 = await safe(() => periodLockService.status({ at: new Date(yStart + 21 * H) }))
  eq('دیشب ۲۱:۰۰ (داخل نشست باز، بیرون از صندوق بسته‌ی ۸ تا ۱۴) باز است', st21?.locked, false)
  const st12 = await safe(() => periodLockService.status({ at: new Date(yStart + 12 * H) }))
  eq('دیروز ۱۲:۰۰ (تاریخ دستی، داخل صندوق بسته) بسته می‌ماند', st12?.locked, true)
  const st13 = await safe(() => periodLockService.status({ at: new Date(yStart + 13 * H + 30 * 60000) }))
  eq('دیروز ۱۳:۳۰ بسته می‌ماند', st13?.locked, true)
  const p21 = addPay(yStart + 21 * H, 300000)
  const r = await safe(() => salesService.deletePayment({ id: p21, userId, reason: 'اشتباه ثبت شد', managerPassword: PW, overrideReason: 'اصلاح تست ۱۳۶' }))
  eq('ابطال پرداخت ۳۰۰٬۰۰۰ دیشب ۲۱:۰۰ همان شیفت باز با رمز پرداخت انجام می‌شود', r?.__error ?? 'ok', 'ok')
  eq('پرداخت واقعاً باطل شد', pay(p21)?.voidedAt != null, true)
  const p22 = addPay(yStart + 22 * H, 200000)
  const u = await safe(() => salesService.updatePayment({ id: p22, userId, amount: 150000, managerPassword: PW, overrideReason: 'اصلاح تست ۱۳۶' }))
  eq('ویرایش مبلغ پرداخت ۲۲:۰۰ همان شیفت باز با رمز پرداخت', u?.__error ?? 'ok', 'ok')
  eq('مبلغ ۲۰۰٬۰۰۰ ⇒ ۱۵۰٬۰۰۰', Number(pay(p22)?.amount), 150000)
  // ثبت با تاریخ دستیِ دیروز (۱۲:۰۰، داخل صندوق بسته) هنوز رمز می‌خواهد
  const a = await safe(() => salesService.addPayment({ userId, invoiceId: inv, amount: 50000, methodId: cash, destination: 'CASH', paidAtJalali: yesterday }))
  eq('ثبت با تاریخ دستیِ دیروز بدون رمز همچنان رد می‌شود', LOCK_RE.test(a?.__error ?? ''), true)
  // پرداخت ۱۳:۰۰ دیروز (داخل صندوق بسته) هنوز گیت دارد
  const p13 = addPay(yStart + 13 * H, 100000)
  const d13 = await safe(() => salesService.deletePayment({ id: p13, userId, reason: 'اشتباه' }))
  eq('ابطال پرداخت ۱۳:۰۰ دیروز (صندوق بسته) بدون رمز رد می‌شود', LOCK_RE.test(d13?.__error ?? ''), true)
  eq('پرداخت ۱۳:۰۰ باطل نشد', pay(p13)?.voidedAt ?? null, null)
}

console.log('\n— ۲) تغییر هم‌زمان بین سنجش بیرون از تراکنش و خود تراکنش')
const origTx = db.$transaction
let hook = null
db.$transaction = async (...args) => { if (hook) { const h = hook; hook = null; h() } return origTx.apply(db, args) }
{
  // ابطال: پرداخت امروز (باز) در لحظه‌ی آخر به دیروز ۱۳:۰۰ (صندوق بسته) منتقل می‌شود
  const pNow = addPay(Date.now() - 60000, 400000)
  hook = () => sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ? WHERE id = ?').run(yStart + 13 * H, yesterday, pNow)
  const r = await safe(() => salesService.deletePayment({ id: pNow, userId, reason: 'اشتباه', managerPassword: PW, overrideReason: 'اصلاح تست ۱۳۶' }))
  eq('ابطال پرداختی که همین حالا به روز بسته رفت بدون رمز دوره رد می‌شود', LOCK_RE.test(r?.__error ?? ''), true)
  eq('پرداخت ۴۰۰٬۰۰۰ باطل نشد', pay(pNow)?.voidedAt ?? null, null)

  // ویرایش مبلغ: همان سناریو
  const pNow2 = addPay(Date.now() - 60000, 500000)
  hook = () => sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ? WHERE id = ?').run(yStart + 13 * H, yesterday, pNow2)
  const u = await safe(() => salesService.updatePayment({ id: pNow2, userId, amount: 100000, managerPassword: PW, overrideReason: 'اصلاح تست ۱۳۶' }))
  eq('ویرایش مبلغ پرداختی که همین حالا به روز بسته رفت بدون رمز دوره رد می‌شود', LOCK_RE.test(u?.__error ?? ''), true)
  eq('مبلغ ۵۰۰٬۰۰۰ دست‌نخورده', Number(pay(pNow2)?.amount), 500000)

  // چک: در جریان هنگام سنجش؛ هم‌زمان در صندوق بسته‌ی دیروز پاس شده
  const chq = addPay(Date.now() - 60000, 700000, { kind: 'CHEQUE', chequeStatus: 'PENDING', destination: null, dueDateJalali: today, chequeNo: 'R136' })
  hook = () => sql.prepare(`UPDATE "Payment" SET chequeStatus = 'CLEARED', clearedAt = ?, clearedAtJalali = ?, destination = 'MANAGER' WHERE id = ?`).run(yStart + 13 * H, yesterday, chq)
  const c = await safe(() => salesService.setChequeStatus({ id: chq, userId, status: 'BOUNCED', managerPassword: PW }))
  eq('برگشت‌زدن چکی که همین حالا در روز بسته پاس شد بدون رمز رد می‌شود', LOCK_RE.test(c?.__error ?? ''), true)
  eq('چک ۷۰۰٬۰۰۰ همچنان پاس‌شده', pay(chq)?.chequeStatus, 'CLEARED')

  // با رمز و دلیلِ همین درخواست، همان تغییر هم‌زمان پذیرفته می‌شود (رمز پیش از تراکنش سنجیده شد)
  const pNow3 = addPay(yStart + 13 * H + 60000, 90000)
  hook = null
  const ok3 = await safe(() => salesService.deletePayment({ id: pNow3, userId, reason: 'اشتباه', managerPassword: PW, overrideReason: 'اصلاح ۱۳۶' }))
  eq('ابطال روز بسته با رمز و دلیل انجام می‌شود (رگرسیون)', ok3?.__error ?? 'ok', 'ok')
}
db.$transaction = origTx

console.log('\n— ۳) پنجره‌ی پرداخت‌ها: تاریخ پیش‌فرضِ کهنه بعد از نیمه‌شب')
{
  let helper = null
  try { helper = await import(join(root, 'src/shared/paymentDateUi.ts')) } catch { helper = null }
  eq('helper خالص paymentMomentFields وجود دارد', typeof helper?.paymentMomentFields, 'function')
  const f = helper?.paymentMomentFields
  eq('بدون دست‌زدن به تاریخ/ساعت ⇒ هیچ تاریخی فرستاده نمی‌شود (سرور = همین لحظه)',
    f ? f({ paidAtJalali: yesterday, paidAtTime: '23:59', dateTouched: false, timeTouched: false }) : null, {})
  eq('تاریخ دستیِ انتخاب‌شده ⇒ همان تاریخ فرستاده می‌شود',
    f ? f({ paidAtJalali: yesterday, paidAtTime: '19:00', dateTouched: true, timeTouched: true }) : null, { paidAtJalali: yesterday, paidAtTime: '19:00' })
  eq('فقط تاریخ دستی ⇒ ساعت کهنه‌ی پیش‌فرض فرستاده نمی‌شود',
    f ? f({ paidAtJalali: yesterday, paidAtTime: '23:59', dateTouched: true, timeTouched: false }) : null, { paidAtJalali: yesterday, paidAtTime: null })
  const src = readFileSync(join(root, 'src/renderer/src/components/InvoicePaymentsModal.tsx'), 'utf8')
  eq('پنجره از helper استفاده می‌کند', /\.\.\.paymentMomentFields\(/.test(src), true)
  eq('پنجره دیگر paidAtJalali خام را همیشه نمی‌فرستد', /^\s*paidAtJalali,\s*$/m.test(src), false)
  // اثر سرور: بدون تاریخ ⇒ لحظه‌ی واقعی و داخل نشست باز (نشست امروزِ همین کارمند)
  seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - H, userId })
  const inv2 = seed.insert('SaleInvoice', { receiptNo: 13602, status: 'FINAL', grandTotal: 1000000, paidTotal: 0, goodsTotal: 1000000, issuedAt: Date.now() - H, issuedAtJalali: today, userId })
  const r = await safe(() => salesService.addPayment({ userId, invoiceId: inv2, amount: 60000, methodId: cash, destination: 'CASH' }))
  const p = r?.payment?.id ? pay(r.payment.id) : null
  eq('پرداخت بدون تاریخ ⇒ paidAtJalali امروز', p?.paidAtJalali, today)
  eq('paidAt همین لحظه است، نه ساعت ۱۲ دیروز', p ? Math.abs(Number(p.paidAt) - Date.now()) < 60000 : false, true)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
