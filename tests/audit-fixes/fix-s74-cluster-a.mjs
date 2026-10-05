/**
 * نشست ۷۴ · خوشه A
 *
 * چکِ پاس‌شده که تاریخ ثبت و تاریخ پاس‌شدنش هر دو در بازه‌ی گزارش هستند
 * فقط یک بار باید اثر نقدی داشته باشد: در رویداد CHEQUE_CLEARED، نه در ردیف
 * SALE و نه در هر دو. مقصدهای کارت/مدیر/نامشخص و بازپرداخت کارت هم نباید
 * به کشوی فیزیکی نسبت داده شوند.
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = readFileSync(resolve('src/main/services/SalesLedger.ts'), 'utf8')
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
eq('چک از اثر نقدی ردیف فروش جدا شده است', /if \(p\.kind === PaymentEntryKind\.CHEQUE\) return false/.test(source), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s74-cluster-a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)
const db = prisma.$harness.db
const day = '1405/03/01'
const at = (hour) => new Date(jalaliStartOfDay(day).getTime() + hour * 3_600_000)

const userId = seed.user('صندوقدار نشست ۷۴')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: day, userId })
const invoice = seed.invoice({ grandTotal: 500_000 })
db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, userId = ?, shiftId = ? WHERE id = ?')
  .run(at(10).getTime(), day, userId, shiftId, invoice.id)

const chequeMethod = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
const paymentId = seed.insert('Payment', {
  invoiceId: invoice.id,
  methodId: chequeMethod,
  amount: 500_000,
  kind: 'CHEQUE',
  chequeNo: 'S74',
  chequeStatus: 'CLEARED',
  destination: 'CASH',
  paidAt: at(11),
  paidAtJalali: day,
  clearedAt: at(12),
  clearedAtJalali: day,
  createdByUserId: userId,
  createdShiftId: shiftId,
  clearedShiftId: shiftId
})
seed.insert('PaymentChequeStatusHistory', {
  paymentId,
  status: 'CLEARED',
  clearedAt: at(12),
  clearedAtJalali: day,
  clearedShiftId: shiftId,
  userId,
  changedAt: at(12),
  changedAtJalali: day
})

const report = await salesLedger.ledger({ fromJalali: day, toJalali: day })
const sale = report.rows.filter((r) => r.eventType === 'SALE')
const cleared = report.rows.filter((r) => r.eventType === 'CHEQUE_CLEARED')

eq('یک ردیف فروش وجود دارد', sale.length, 1)
eq('ردیف فروش اثر نقدی چک ندارد', sale[0]?.cashEffect, 0)
eq('یک ردیف مستقل پاس‌چک وجود دارد', cleared.length, 1)
eq('چک به صندوق نسبت داده نمی‌شود', report.totals.netCash, 0)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
