/**
 * نشست ۷۱ · خوشه A
 *
 * تاریخ یک رویداد به‌تنهایی کافی نیست: فیلتر فروشنده/نشست هم باید روی صاحب
 * واقعی همان رویداد اعمال شود، نه روی فاکتور مادر.
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const ledgerSource = readFileSync(resolve('src/main/services/SalesLedger.ts'), 'utf8')
const salesSource = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq('فیلتر پرداخت از createdShiftId/createdByUserId استفاده می‌کند', /paymentEventOwnerWhere\(filter, 'created'/.test(ledgerSource), true)
eq('فیلتر پاس‌چک از clearedShiftId استفاده می‌کند', /paymentEventOwnerWhere\(filter, 'cleared'/.test(ledgerSource), true)
eq('فیلتر برگشت روی userId/shiftId خود سند است', /returnEventOwnerWhere\(filter/.test(ledgerSource), true)
eq('فیلتر رابطه‌ی فاکتور مالک رویداد را حذف می‌کند', /eventInvoiceContextWhere/.test(salesSource), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s71-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)
const db = prisma.$harness.db
const at = (jalali, hour) => new Date(jalaliStartOfDay(jalali).getTime() + hour * 3_600_000)
const day = '1405/02/01'

const invoiceUser = seed.user('فروشنده فاکتور')
const eventUser = seed.user('ثبت‌کننده رویداد')
const invoiceShift = seed.insert('Shift', { name: 'شب مادر', number: 1, dayJalali: '1405/01/31', userId: invoiceUser })
const eventShift = seed.insert('Shift', { name: 'صبح رویداد', number: 2, dayJalali: day, userId: eventUser })
const inv = seed.invoice({ grandTotal: 1_000_000 })
db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, userId = ?, shiftId = ? WHERE id = ?')
  .run(at('1405/01/31', 10).getTime(), '1405/01/31', invoiceUser, invoiceShift, inv.id)

const cashMethod = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقد', kind: 'CASH' })
seed.insert('Payment', {
  invoiceId: inv.id,
  methodId: cashMethod,
  amount: 300_000,
  kind: 'CASH',
  paidAt: at(day, 11),
  paidAtJalali: day,
  createdByUserId: eventUser,
  createdShiftId: eventShift
})
seed.insert('SaleReturn', {
  invoiceId: inv.id,
  total: 200_000,
  refundMethod: 'CASH',
  refundAmount: 200_000,
  returnedAt: at(day, 12),
  returnedAtJalali: day,
  returnedAtTime: '12:00:00',
  userId: eventUser,
  shiftId: eventShift,
  kind: 'RETURN'
})

const chequeMethod = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
const chequeId = seed.insert('Payment', {
  invoiceId: inv.id,
  methodId: chequeMethod,
  amount: 500_000,
  kind: 'CHEQUE',
  chequeNo: 'S71',
  chequeStatus: 'CLEARED',
  paidAt: at('1405/01/31', 10),
  paidAtJalali: '1405/01/31',
  clearedAt: at(day, 13),
  clearedAtJalali: day,
  createdByUserId: invoiceUser,
  createdShiftId: invoiceShift,
  clearedShiftId: eventShift
})
seed.insert('PaymentChequeStatusHistory', {
  paymentId: chequeId,
  status: 'CLEARED',
  clearedAt: at(day, 13),
  clearedAtJalali: day,
  clearedShiftId: eventShift,
  userId: eventUser,
  changedAt: at(day, 13),
  changedAtJalali: day
})

const report = await salesLedger.ledger({
  fromJalali: day,
  toJalali: day,
  shiftId: eventShift,
  userId: eventUser
})
const credit = report.rows.find((r) => r.eventType === 'CREDIT_SETTLEMENT')
const returned = report.rows.find((r) => r.eventType === 'RETURN')
const cleared = report.rows.find((r) => r.eventType === 'CHEQUE_CLEARED')

eq('وصول فاکتور قدیمی با نشست ثبت واقعی دیده می‌شود', credit?.amount ?? 0, 300_000)
eq('برگشت با نشست ثبت واقعی دیده می‌شود', returned?.amount ?? 0, 200_000)
eq('پاس‌چک با نشست تسویه و دفتر history دیده می‌شود', cleared?.amount ?? 0, 500_000)
eq('نام نشست پاس‌چک از clearedShiftId می‌آید', cleared?.shiftName ?? '', 'صبح رویداد')
eq('نام کاربر پاس‌چک از history می‌آید', cleared?.userName ?? '', 'ثبت‌کننده رویداد')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
