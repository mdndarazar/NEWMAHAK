/**
 * نشست ۷۲ · خوشه A
 *
 * شماره‌ی نشست در هر روز تکرار می‌شود. این تست ثابت می‌کند که فیلتر
 * shiftNumber برای پرداخت، برگشت و پاس‌چک به نشست واقعی رویداد resolve می‌شود،
 * نه به شیفت فاکتور مادر و نه به یک شماره‌ی سراسریِ اشتباه.
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const salesSource = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
const ledgerSource = readFileSync(resolve('src/main/services/SalesLedger.ts'), 'utf8')
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

eq('شماره نشست قبل از مالکیت رویداد resolve می‌شود', /resolveReportEventShiftIds/.test(salesSource), true)
eq('دفتر رویداد resolver را مصرف می‌کند', /resolveReportEventShiftIds\(filter\)/.test(ledgerSource), true)
eq('مالک برگشت می‌تواند با شناسه‌های resolve‌شده فیلتر شود', /returnEventOwnerWhere\(filter, eventShiftIds\)/.test(ledgerSource), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s72-'))
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
const otherDay = '1405/02/02'

const invoiceUser = seed.user('فروشنده فاکتور')
const eventUser = seed.user('ثبت‌کننده رویداد')
const otherUser = seed.user('رویداد روز دیگر')
const invoiceShift = seed.insert('Shift', { name: 'شب مادر', number: 1, dayJalali: '1405/01/31', userId: invoiceUser })
const eventShift = seed.insert('Shift', { name: 'صبح هدف', number: 2, dayJalali: day, userId: eventUser })
const otherShift = seed.insert('Shift', { name: 'صبح روز دیگر', number: 2, dayJalali: otherDay, userId: otherUser })
const unrelatedShift = seed.insert('Shift', { name: 'شب نامرتبط', number: 3, dayJalali: day, userId: otherUser })
const inv = seed.invoice({ grandTotal: 2_000_000 })
db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, userId = ?, shiftId = ? WHERE id = ?')
  .run(at('1405/01/31', 10).getTime(), '1405/01/31', invoiceUser, invoiceShift, inv.id)

const cashMethod = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقد', kind: 'CASH' })
seed.insert('Payment', {
  invoiceId: inv.id, methodId: cashMethod, amount: 300_000, kind: 'CASH',
  paidAt: at(day, 11), paidAtJalali: day, createdByUserId: eventUser, createdShiftId: eventShift
})
seed.insert('Payment', {
  invoiceId: inv.id, methodId: cashMethod, amount: 400_000, kind: 'CASH',
  paidAt: at(day, 12), paidAtJalali: day, createdByUserId: otherUser, createdShiftId: unrelatedShift
})
seed.insert('Payment', {
  invoiceId: inv.id, methodId: cashMethod, amount: 500_000, kind: 'CASH',
  paidAt: at(otherDay, 11), paidAtJalali: otherDay, createdByUserId: otherUser, createdShiftId: otherShift
})
seed.insert('SaleReturn', {
  invoiceId: inv.id, total: 200_000, refundMethod: 'NONE', refundAmount: 0,
  returnedAt: at(day, 13), returnedAtJalali: day, returnedAtTime: '13:00:00',
  userId: eventUser, shiftId: eventShift, kind: 'RETURN'
})
seed.insert('SaleReturn', {
  invoiceId: inv.id, total: 900_000, refundMethod: 'NONE', refundAmount: 0,
  returnedAt: at(day, 14), returnedAtJalali: day, returnedAtTime: '14:00:00',
  userId: otherUser, shiftId: unrelatedShift, kind: 'RETURN'
})

const chequeMethod = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
const chequeId = seed.insert('Payment', {
  invoiceId: inv.id, methodId: chequeMethod, amount: 600_000, kind: 'CHEQUE',
  chequeNo: 'S72', chequeStatus: 'CLEARED', paidAt: at('1405/01/31', 10),
  paidAtJalali: '1405/01/31', clearedAt: at(day, 15), clearedAtJalali: day,
  createdByUserId: invoiceUser, createdShiftId: invoiceShift, clearedShiftId: eventShift
})
seed.insert('PaymentChequeStatusHistory', {
  paymentId: chequeId, status: 'CLEARED', clearedAt: at(day, 15),
  clearedAtJalali: day, clearedShiftId: eventShift, userId: eventUser,
  changedAt: at(day, 15), changedAtJalali: day
})

const report = await salesLedger.ledger({ fromJalali: day, toJalali: day, shiftNumber: 2 })
const settlements = report.rows.filter((r) => r.eventType === 'CREDIT_SETTLEMENT')
const returned = report.rows.filter((r) => r.eventType === 'RETURN')
const cleared = report.rows.filter((r) => r.eventType === 'CHEQUE_CLEARED')

eq('شماره نشست فقط وصول همان نشست/روز را می‌آورد', settlements.reduce((s, r) => s + r.amount, 0), 300_000)
eq('شماره نشست فقط برگشت همان نشست/روز را می‌آورد', returned.reduce((s, r) => s + r.amount, 0), 200_000)
eq('شماره نشست فقط پاس‌چک همان نشست/روز را می‌آورد', cleared.reduce((s, r) => s + r.amount, 0), 600_000)
eq('پاس‌چک نشست هدف حذف نشده است', cleared.length, 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
