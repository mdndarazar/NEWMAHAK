/**
 * نشست ۲۰۰ — تغییر وضعیت چک (پاس / برگشت / در جریان) حتی در دوره‌ی باز رمز می‌خواهد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s200-cheque-status-password.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s200-cheque-pw-'))
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

console.log('\n۰) سیم‌کشی منبع')
const svc = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const fnStart = svc.indexOf('async setChequeStatus(')
const txStart = svc.indexOf('prisma.$transaction', fnStart)
const body = fnStart >= 0 && txStart > fnStart ? svc.slice(fnStart, txStart) : ''
truthy('گیت strict پنل نسیه در setChequeStatus هست', /assertPanelPasswordStrict\(\s*PANEL_KEYS\.salesCredit/.test(body))
truthy('گیت بیرون از تراکنش است', fnStart >= 0 && txStart > fnStart && /assertPanelPasswordStrict\(/.test(body))
const modal = readFileSync(new URL('../../src/renderer/src/components/InvoicePaymentsModal.tsx', import.meta.url), 'utf8')
truthy('UI رمز را با وضعیت چک می‌فرستد', /CH\.saleChequeStatus, \{[^}]*managerPassword: pw/.test(modal))
truthy('مودال پاس شدن فیلد رمز دارد', /رمز مدیر \/ دوم \/ سوم نسیه/.test(modal) && modal.includes('PasswordField'))
truthy('برگشت/در جریان بدون رمز، گیت را نشان می‌دهد', /setChequeGate\(true\)/.test(modal) && /chequeGate && !lockNeeded/.test(modal))

const userId = seed.user('فروشنده چک ۲۰۰')
const product = seed.product('کالای چک ۲۰۰', seed.category('پوشاک'))
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
const pay = await salesService.addPayment({
  invoiceId: sale.id,
  userId,
  methodId: cheque,
  kind: 'CHEQUE',
  amount: 900,
  chequeNo: 'S200',
  bankName: 'تست',
  dueDateJalali: today
})
const chqId = pay.payment.id
const row = () => sql.prepare('SELECT chequeStatus, destination FROM "Payment" WHERE id = ?').get(chqId)

console.log('\n۱) دوره‌ی باز — بدون رمز / رمز غلط')
eq('مانده قبل از پاس ۹۰۰ است', await remainingOf(sale.id), 900)
await rejects(
  'پاس بدون رمز رد می‌شود',
  () => salesService.setChequeStatus({ id: chqId, userId, status: 'CLEARED', destination: 'MANAGER' }),
  'رمز'
)
eq('وضعیت بدون رمز عوض نشد', row()?.chequeStatus, 'PENDING')
eq('مانده بدون رمز همان ۹۰۰ ماند', await remainingOf(sale.id), 900)
await rejects(
  'پاس با رمز غلط رد می‌شود',
  () => salesService.setChequeStatus({ id: chqId, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: '0000' }),
  'رمز'
)
eq('وضعیت با رمز غلط عوض نشد', row()?.chequeStatus, 'PENDING')

console.log('\n۲) دوره‌ی باز — با رمز مدیر')
await salesService.setChequeStatus({ id: chqId, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW })
eq('با رمز، چک پاس شد', row()?.chequeStatus, 'CLEARED')
eq('مانده بعد از پاس صفر است', await remainingOf(sale.id), 0)

await rejects(
  'برگشت به در جریان بدون رمز رد می‌شود',
  () => salesService.setChequeStatus({ id: chqId, userId, status: 'PENDING' }),
  'رمز'
)
eq('برگشت بدون رمز انجام نشد', row()?.chequeStatus, 'CLEARED')

await salesService.setChequeStatus({ id: chqId, userId, status: 'BOUNCED', managerPassword: PW })
eq('با رمز، چک برگشت خورد', row()?.chequeStatus, 'BOUNCED')
eq('مانده بعد از برگشت دوباره ۹۰۰ است', await remainingOf(sale.id), 900)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
