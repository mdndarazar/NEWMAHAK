/**
 * ===========================================================================
 * نشست ۱۴۲ · خوشه E — validation عددی mutationهای باقی‌مانده‌ی Payment
 *
 * S138 فقط create/update/addPayment(مبلغ) را سخت کرد. این تست رفتار واقعی
 * سرویس را روی harness SQLite برای کانال‌های باقی‌مانده می‌سنجد:
 *   ۱) updatePayment: مبلغ اعشاری با Math.round بی‌صدا به عدد دیگری تبدیل
 *      می‌شد (۳۰۰٫۴ ⇒ ۳۰۰) و مبلغ خارج از سقف امن (1e20) پذیرفته می‌شد؛
 *      شناسه‌ی پرداخت و روش پرداخت هم بی‌سنجش به Prisma می‌رسید.
 *   ۲) deletePayment / setChequeStatus: شناسه‌ی اعشاری بدون پیام روشن.
 *   ۳) overpayCreditIssue: مبلغ اعتبار اعشاری (۱۰۰٫۴) بی‌صدا به ۱۰۰ گرد
 *      می‌شد و کد اعتبار خرید صادر می‌کرد.
 *   ۴) addPayment: methodId اعشاری/منفی/ناموجود بی‌سنجش پذیرفته می‌شد.
 * هر ورودی نامعتبر باید با پیام فارسی و «پیش از هر side-effect» رد شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s142-payment-mutation-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s142-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست ۱۴۲' }

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} ${extra}`) }
}
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — ورودی نامعتبر پذیرفته شد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    const persian = /[\u0600-\u06FF]/.test(m)
    if (!m.startsWith('HARNESS:') && persian && (!needle || m.includes(needle))) {
      ok++
      console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`)
    } else {
      bad++
      console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`)
    }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}

const userId = seed.user('فروشنده تست نشست ۱۴۲')
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
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const payRow = (id) => seed.one('SELECT * FROM "Payment" WHERE id = ?', id)
const payCount = (invoiceId) => seed.count('Payment', 'invoiceId = ?', invoiceId)
const auditCount = (action) => seed.count('AuditLog', 'action = ?', action)
const creditCount = () => seed.count('StoreCredit')

// ------------------------- داده‌ی پایه -------------------------
const inv1 = await safe('فاکتور ۱٬۰۰۰ با پرداخت نقدی ۳۰۰', () =>
  salesService.create({ userId, shiftId, lines: [line(variant(1000), 1000)], payments: [{ methodId: cash, amount: 300, destination: 'CASH' }] }))
const p1 = seed.one('SELECT id, amount, methodId FROM "Payment" WHERE invoiceId = ? ORDER BY id', inv1?.id ?? -1)
truthy('پرداخت ۳۰۰ ثبت شد', p1?.amount === 300)
const chq = await safe('چک ۲۰۰ در جریان روی همان فاکتور', () =>
  salesService.addPayment({ userId, invoiceId: inv1.id, kind: 'CHEQUE', amount: 200, dueDateJalali: today, chequeNo: '142-1' }))
const chqId = chq?.payment?.id ?? seed.one(`SELECT id FROM "Payment" WHERE invoiceId = ? AND kind = 'CHEQUE'`, inv1?.id ?? -1)?.id
truthy('چک ثبت شد', !!chqId)

const inv2 = await safe('فاکتور ۱٬۰۰۰ تسویه‌شده', () =>
  salesService.create({ userId, shiftId, lines: [line(variant(1000), 1000)], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] }))
await safe('اضافه‌دریافت آگاهانه‌ی ۵۰۰ روی فاکتور تسویه‌شده', () =>
  salesService.addPayment({ userId, invoiceId: inv2.id, amount: 500, methodId: cash, destination: 'CASH', confirmOverpay: true }))
truthy('اضافه‌دریافت ۵۰۰ ثبت شد', seed.one('SELECT SUM(overpayAmount) AS s FROM "Payment" WHERE invoiceId = ?', inv2?.id ?? -1)?.s === 500)

// ===========================================================================
console.log('\n۱) updatePayment — مبلغ اعشاری/خارج از سقف/متن، شناسه و روش پرداخت')
const updAudit0 = auditCount('SALE_PAYMENT_UPDATE')
await rejects('مبلغ ۳۰۰٫۴ رد می‌شود (نه گرد به ۳۰۰)', () => salesService.updatePayment({ id: p1.id, userId, amount: 300.4 }), 'عدد صحیح')
await rejects('مبلغ ۳۵۰٫۶ رد می‌شود (نه گرد به ۳۵۱)', () => salesService.updatePayment({ id: p1.id, userId, amount: 350.6 }), 'عدد صحیح')
await rejects('مبلغ 1e20 (خارج از سقف امن) رد می‌شود', () => salesService.updatePayment({ id: p1.id, userId, amount: 1e20 }), 'عدد صحیح')
await rejects('مبلغ متنی «۳۵۰» رد می‌شود', () => salesService.updatePayment({ id: p1.id, userId, amount: '350' }), 'عدد صحیح')
await rejects('مبلغ منفی رد می‌شود', () => salesService.updatePayment({ id: p1.id, userId, amount: -50 }), 'عدد صحیح')
await rejects('شناسه‌ی اعشاری پرداخت رد می‌شود', () => salesService.updatePayment({ id: p1.id + 0.5, userId, amount: 350 }), 'عدد صحیح')
await rejects('روش پرداخت اعشاری رد می‌شود', () => salesService.updatePayment({ id: p1.id, userId, methodId: cash + 0.5, destination: 'CASH' }), 'عدد صحیح')
await rejects('روش پرداخت ناموجود با پیام فارسی رد می‌شود', () => salesService.updatePayment({ id: p1.id, userId, methodId: 987654, destination: 'CASH', ...GATE }), 'روش پرداخت')
eq('مبلغ پرداخت بعد از ورودی‌های نامعتبر دست‌نخورده ماند', payRow(p1.id)?.amount, 300)
eq('روش پرداخت دست‌نخورده ماند', payRow(p1.id)?.methodId, cash)
eq('هیچ Audit ویرایشی برای ورودی نامعتبر ثبت نشد', auditCount('SALE_PAYMENT_UPDATE'), updAudit0)
const okUpd = await safe('ویرایش معتبر مبلغ به ۳۵۰', () => salesService.updatePayment({ id: p1.id, userId, amount: 350, ...GATE }))
truthy('ویرایش معتبر همچنان کار می‌کند (رگرسیون)', !!okUpd && payRow(p1.id)?.amount === 350)

console.log('\n۲) deletePayment / setChequeStatus — شناسه‌ی نامعتبر')
await rejects('ابطال با شناسه‌ی اعشاری رد می‌شود', () => salesService.deletePayment({ id: p1.id + 0.5, userId, reason: 'تست' }), 'عدد صحیح')
await rejects('ابطال با شناسه‌ی منفی رد می‌شود', () => salesService.deletePayment({ id: -3, userId, reason: 'تست' }), 'عدد صحیح')
eq('پرداخت باطل نشد', payRow(p1.id)?.voidedAt ?? null, null)
await rejects('وضعیت چک با شناسه‌ی اعشاری رد می‌شود', () => salesService.setChequeStatus({ id: chqId + 0.5, userId, status: 'CLEARED', destination: 'MANAGER' }), 'عدد صحیح')
eq('چک همچنان در جریان است', payRow(chqId)?.chequeStatus, 'PENDING')

console.log('\n۳) overpayCreditIssue — مبلغ اعتبار اعشاری و شناسه‌ی فاکتور')
const credit0 = creditCount()
await rejects('مبلغ اعتبار ۱۰۰٫۴ رد می‌شود (نه گرد به ۱۰۰)', () => salesService.overpayCreditIssue({ invoiceId: inv2.id, amount: 100.4, userId }), 'عدد صحیح')
await rejects('مبلغ اعتبار منفی رد می‌شود', () => salesService.overpayCreditIssue({ invoiceId: inv2.id, amount: -100, userId }), 'عدد صحیح')
await rejects('شناسه‌ی فاکتور اعشاری رد می‌شود', () => salesService.overpayCreditIssue({ invoiceId: inv2.id + 0.5, userId }), 'عدد صحیح')
eq('هیچ کد اعتبار خریدی برای ورودی نامعتبر صادر نشد', creditCount(), credit0)
const okCredit = await safe('صدور معتبر اعتبار ۱۰۰ از اضافه‌دریافت', () => salesService.overpayCreditIssue({ invoiceId: inv2.id, amount: 100, userId }))
truthy('صدور معتبر همچنان کار می‌کند (رگرسیون)', okCredit?.amount === 100 && creditCount() === credit0 + 1)

console.log('\n۴) addPayment — methodId نامعتبر')
const n0 = payCount(inv1.id)
await rejects('methodId اعشاری رد می‌شود', () => salesService.addPayment({ userId, invoiceId: inv1.id, amount: 10, methodId: cash + 0.5, destination: 'CASH' }), 'عدد صحیح')
await rejects('methodId منفی رد می‌شود', () => salesService.addPayment({ userId, invoiceId: inv1.id, amount: 10, methodId: -3, destination: 'CASH' }), 'عدد صحیح')
await rejects('methodId ناموجود با پیام فارسی رد می‌شود', () => salesService.addPayment({ userId, invoiceId: inv1.id, amount: 10, methodId: 987654, destination: 'CASH' }), 'روش پرداخت')
eq('هیچ پرداختی برای methodId نامعتبر ثبت نشد', payCount(inv1.id), n0)
const okAdd = await safe('پرداخت معتبر ۱۰ با روش نقدی', () => salesService.addPayment({ userId, invoiceId: inv1.id, amount: 10, methodId: cash, destination: 'CASH' }))
truthy('پرداخت معتبر همچنان ثبت می‌شود (رگرسیون)', !!okAdd && payCount(inv1.id) === n0 + 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
