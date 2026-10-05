/**
 * ممیزی نشست ۱۱۳ — سیاست مقصد چک (بند ۴-۱۲) با اجرای واقعی سرویس (تست fix-s113 فقط regex/helper بود).
 * پاس‌شدن فقط با حساب مدیر؛ CASH/CARD/خالی رد با پیام فارسی؛ addPayment چک با مقصد صریح رد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s113-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const U = seed.user('مدیر')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, userId: U, openedAt: T0 + 60_000 })
const mCh = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
const inv = seed.insert('SaleInvoice', { receiptNo: 1, userId: U, status: 'CREDIT', grandTotal: 1_000_000, paidTotal: 0, issuedAt: T0 + 120_000, issuedAtJalali: today })
const ch = seed.insert('Payment', { invoiceId: inv, methodId: mCh, amount: 500_000, kind: 'CHEQUE', chequeNo: 'X1', chequeStatus: 'PENDING', paidAt: T0 + 130_000, paidAtJalali: today, createdByUserId: U })
const err = async (f) => { try { await f(); return null } catch (e) { return String(e?.message ?? e) } }
const fa = (m) => !!m && /[\u0600-\u06FF]/.test(m)
eq('پاس با مقصد CASH ⇒ رد فارسی', fa(await err(() => salesService.setChequeStatus({ id: ch, status: 'CLEARED', destination: 'CASH', userId: U, managerPassword: PW }))), true)
eq('پاس با مقصد CARD ⇒ رد فارسی', fa(await err(() => salesService.setChequeStatus({ id: ch, status: 'CLEARED', destination: 'CARD', userId: U, managerPassword: PW }))), true)
eq('پاس بدون مقصد ⇒ رد (پیش‌فرض بی‌صدا ندارد)', fa(await err(() => salesService.setChequeStatus({ id: ch, status: 'CLEARED', userId: U, managerPassword: PW }))), true)
eq('رد شده‌ها وضعیت را عوض نکردند', seed.one('SELECT chequeStatus, destination FROM "Payment" WHERE id=?', ch), { chequeStatus: 'PENDING', destination: null })
eq('پاس با حساب مدیر ⇒ موفق', await err(() => salesService.setChequeStatus({ id: ch, status: 'CLEARED', destination: 'MANAGER', userId: U, managerPassword: PW })), null)
eq('مقصد MANAGER ثبت شد', seed.one('SELECT chequeStatus, destination FROM "Payment" WHERE id=?', ch), { chequeStatus: 'CLEARED', destination: 'MANAGER' })
const addErr = await err(() => salesService.addPayment({ invoiceId: inv, kind: 'CHEQUE', amount: 100_000, chequeNo: 'X2', dueDateJalali: today, destination: 'CASH', userId: U }))
eq('addPayment چک با مقصد صریح ⇒ رد فارسی به علت مقصد', fa(addErr) && addErr.includes('مقصد'), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
