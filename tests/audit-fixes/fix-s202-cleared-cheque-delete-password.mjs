/**
 * نشست ۲۰۲ — ابطال/ویرایش مالی چکِ پاس‌شده همان گیت رمز پاس/برگشت را دارد.
 * بدون این، دکمه‌ی «حذف» گیت نشست ۲۰۰ را دور می‌زد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s202-cleared-cheque-delete-password.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s202-chq-del-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) {
      bad++
      console.log(`  ✗ ${label} — پیام «${m.split('\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}
const remainingOf = async (id) => Number((await salesService.payments({ invoiceId: id })).remaining ?? -1)
const pay = (id) => sql.prepare('SELECT chequeStatus, voidedAt, amount FROM "Payment" WHERE id = ?').get(id)

console.log('\n۰) سیم‌کشی')
const svc = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const delStart = svc.indexOf('async deletePayment(')
const delTx = svc.indexOf('prisma.$transaction', delStart)
truthy(
  'ابطال چک پاس‌شده قبل از تراکنش گیت strict دارد',
  /assertPanelPasswordStrict\(\s*PANEL_KEYS\.salesCredit/.test(svc.slice(delStart, delTx))
)
const modal = readFileSync(new URL('../../src/renderer/src/components/InvoicePaymentsModal.tsx', import.meta.url), 'utf8')
truthy('UI ابطال چک پاس‌شده رمز می‌خواهد', /isClearedCheque/.test(modal) && /managerPassword: isClearedCheque \? pw/.test(modal))

const userId = seed.user('فروشنده چک ۲۰۲')
const product = seed.product('کالای چک ۲۰۲', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })

const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 100, destination: 'CASH' }]
})
const pendingPay = await salesService.addPayment({
  invoiceId: sale.id, userId, methodId: cheque, kind: 'CHEQUE', amount: 200, chequeNo: 'P202', bankName: 'تست', dueDateJalali: today
})
const clearedPay = await salesService.addPayment({
  invoiceId: sale.id, userId, methodId: cheque, kind: 'CHEQUE', amount: 700, chequeNo: 'C202', bankName: 'تست', dueDateJalali: today
})
await salesService.setChequeStatus({
  id: clearedPay.payment.id, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW
})
eq('مانده بعد از پاس ۷۰۰ صفر نیست — نقد ۱۰۰ + چک ۷۰۰ از ۱۰۰۰', await remainingOf(sale.id), 200)

console.log('\n۱) چک در جریان بدون رمز باطل می‌شود (رگرسیون)')
await salesService.deletePayment({ id: pendingPay.payment.id, userId, reason: 'ثبت اشتباه' })
eq('چک در جریان باطل شد', pay(pendingPay.payment.id)?.voidedAt != null, true)
eq('مانده بعد از ابطال در جریان همان ۲۰۰ است', await remainingOf(sale.id), 200)

console.log('\n۲) چک پاس‌شده بدون رمز / رمز غلط')
await rejects(
  'ابطال چک پاس‌شده بدون رمز رد می‌شود',
  () => salesService.deletePayment({ id: clearedPay.payment.id, userId, reason: 'ثبت اشتباه' }),
  'رمز'
)
eq('چک پاس‌شده باطل نشد', pay(clearedPay.payment.id)?.voidedAt ?? null, null)
eq('مانده بدون ابطال همان ۲۰۰ ماند', await remainingOf(sale.id), 200)
await rejects(
  'ویرایش مبلغ چک پاس‌شده بدون رمز رد می‌شود',
  () => salesService.updatePayment({ id: clearedPay.payment.id, userId, amount: 70 }),
  'رمز'
)
eq('مبلغ چک پاس‌شده عوض نشد', Number(pay(clearedPay.payment.id)?.amount), 700)

console.log('\n۳) با رمز')
await salesService.updatePayment({
  id: clearedPay.payment.id, userId, amount: 500, managerPassword: PW
})
eq('با رمز مبلغ چک پاس‌شده ۵۰۰ شد', Number(pay(clearedPay.payment.id)?.amount), 500)
eq('مانده بعد از ویرایش ۴۰۰ است', await remainingOf(sale.id), 400)
await salesService.deletePayment({
  id: clearedPay.payment.id, userId, reason: 'ثبت اشتباه', managerPassword: PW
})
eq('با رمز چک پاس‌شده باطل شد', pay(clearedPay.payment.id)?.voidedAt != null, true)
eq('مانده بعد از ابطال ۹۰۰ است', await remainingOf(sale.id), 900)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
