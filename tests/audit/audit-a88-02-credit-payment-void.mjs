/**
 * ممیزی A88-02 — ابطال/ویرایش ردیف پرداختِ «اعتبار خرید» (Payment.storeCreditId).
 * قبل از رفع: deletePayment فقط Payment را void می‌کرد؛ StoreCreditRedemption زنده می‌ماند و
 * usedAmount/usedCount اعتبار برنمی‌گشت ⇒ مشتری ۳۰۰٬۰۰۰ بدهکار می‌شد در حالی که اعتبارش
 * «مصرف‌شده» می‌ماند، مصرف باطل در عملکرد کارمند و گزارش حسابداری شمرده می‌شد، و سقف
 * بازپرداخت برگشت (paid − redeemed) ۳۰۰٬۰۰۰ کمتر از پول واقعاً دریافتی می‌شد.
 * updatePayment هم مبلغ/روش همین ردیف را بی‌ربط به دفتر اعتبار عوض می‌کرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, fn, re) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} · رد نشد`) }
  catch (e) { const m = String(e?.message ?? e); if (re.test(m)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} · پیام: ${m}`) } }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a8802-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست اعتبار' }
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const p = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(p, '32'); const v2 = seed.variant(p, '34')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A })
seed.insert('StoreCredit', { code: 'SC88', amount: 300000, source: 'MANUAL', status: 'ACTIVE', issuedAtJalali: today })
const inv = await salesService.create({ userId: B, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 700000, destination: 'CASH' }], storeCreditCode: 'SC88' })
const creditPay = seed.rows('SELECT id, amount FROM "Payment" WHERE invoiceId = ? AND storeCreditId IS NOT NULL', inv.id)[0]
const cashPay = seed.rows('SELECT id FROM "Payment" WHERE invoiceId = ? AND storeCreditId IS NULL', inv.id)[0]
const credit = () => seed.rows('SELECT usedAmount, usedCount, status FROM "StoreCredit" WHERE code = ?', 'SC88')[0]
eq('پیش‌شرط: مصرف ۳۰۰٬۰۰۰ ثبت شد', [creditPay?.amount, credit().usedAmount], [300000, 300000])

// ---- updatePayment روی ردیف اعتبار: تغییر مالی رد، توضیح مجاز ----
await rejects('ویرایش مبلغ ردیف اعتبار ۳۰۰٬۰۰۰ ⇒ ۵۰۰٬۰۰۰ رد می‌شود', () => salesService.updatePayment({ id: creditPay.id, amount: 500000, userId: A }), /اعتبار خرید/)
await rejects('تبدیل روش ردیف اعتبار به «نقدی» رد می‌شود', () => salesService.updatePayment({ id: creditPay.id, methodId: cash, destination: 'CASH', userId: A }), /اعتبار خرید/)
eq('بعد از ویرایش‌های ردشده مبلغ پرداخت و دفتر اعتبار دست‌نخورده', [seed.rows('SELECT amount FROM "Payment" WHERE id = ?', creditPay.id)[0].amount, credit().usedAmount], [300000, 300000])
await salesService.updatePayment({ id: creditPay.id, note: 'توضیح اصلاحی', userId: A })
eq('ویرایش فقط توضیح روی ردیف اعتبار مجاز است', seed.rows('SELECT note FROM "Payment" WHERE id = ?', creditPay.id)[0].note, 'توضیح اصلاحی')

// ---- deletePayment روی ردیف اعتبار: void + برگشت اتمیک همان مصرف ----
const res = await salesService.deletePayment({ id: creditPay.id, userId: A, reason: 'مشتری اعتبار را نخواست', ...GATE })
eq('باقی‌مانده‌ی فاکتور ۳۰۰٬۰۰۰', res.remaining, 300000)
const red = seed.rows('SELECT reversedAt, reversedReason FROM "StoreCreditRedemption" WHERE paymentId = ?', creditPay.id)[0]
eq('ردیف دفتر مصرف همان پرداخت reverse شد (نه حذف)', red?.reversedAt != null, true)
eq('اعتبار برگشت: usedAmount=۰، usedCount=۰، ACTIVE', [credit().usedAmount, credit().usedCount, credit().status], [0, 0, 'ACTIVE'])
const audits = seed.rows('SELECT note FROM "AuditLog" WHERE action = ? AND entity = ?', 'CREDIT_REACTIVATE', 'StoreCredit')
eq('Audit برگشت مصرف اعتبار ثبت شد', audits.length, 1)
const perf = await staffReportService.performance({})
eq('مصرف باطل در عملکرد کارمند ب شمرده نمی‌شود', perf.rows.find((r) => r.userId === B)?.storeCreditUsedTotal ?? 0, 0)
eq('پرداخت نقدی همان فاکتور دست‌نخورده', seed.rows('SELECT voidedAt FROM "Payment" WHERE id = ?', cashPay.id)[0].voidedAt, null)
await rejects('ابطال دوباره‌ی همان ردیف رد می‌شود', () => salesService.deletePayment({ id: creditPay.id, userId: A }), /قبلاً باطل/)
eq('ابطال دوباره اعتبار را دوباره برنگرداند', credit().usedAmount, 0)

// ---- اعتبار واقعاً قابل‌مصرف دوباره است و سقف بازپرداخت درست است ----
await salesService.addPayment({ invoiceId: inv.id, methodId: cash, amount: 300000, destination: 'CASH', userId: A })
const inv2 = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v2, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 700000, destination: 'CASH' }], storeCreditCode: 'SC88' })
eq('SC88 روی فاکتور تازه دوباره ۳۰۰٬۰۰۰ مصرف شد', seed.rows('SELECT amount FROM "Payment" WHERE invoiceId = ? AND storeCreditId IS NOT NULL', inv2.id)[0]?.amount, 300000)
const ret = await salesService.createReturn({ invoiceId: inv.id, full: true, refundMethod: 'CASH', refundAmount: 1000000, userId: A })
const refundRow = seed.rows('SELECT refundAmount FROM "SaleReturn" WHERE invoiceId = ?', inv.id)[0]
eq('برگشت کامل فاکتور تمام‌نقد: بازپرداخت نقدی ۱٬۰۰۰٬۰۰۰ (مصرف باطل از سقف کم نمی‌شود)', refundRow?.refundAmount, 1000000)

// ---- داده‌ی قدیمی: پرداخت اعتباری بدون ردیف دفتر مصرف ⇒ رد، نه void بی‌صدا ----
seed.insert('StoreCredit', { code: 'SC89', amount: 200000, source: 'MANUAL', status: 'ACTIVE', issuedAtJalali: today })
const inv3 = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v2, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 800000, destination: 'CASH' }], storeCreditCode: 'SC89' })
const p3 = seed.rows('SELECT id FROM "Payment" WHERE invoiceId = ? AND storeCreditId IS NOT NULL', inv3.id)[0]
sql.prepare('DELETE FROM "StoreCreditRedemption" WHERE paymentId = ?').run(p3.id)
await rejects('پرداخت اعتباری بی‌دفتر مصرف: ابطال با پیام فارسی رد می‌شود', () => salesService.deletePayment({ id: p3.id, userId: A, ...GATE }), /دفتر مصرف/)
eq('…و پرداخت باطل نشد (rollback)', seed.rows('SELECT voidedAt FROM "Payment" WHERE id = ?', p3.id)[0].voidedAt, null)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
