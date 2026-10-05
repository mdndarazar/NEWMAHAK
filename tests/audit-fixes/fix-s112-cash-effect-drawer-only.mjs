/**
 * نشست ۱۱۲ · cashEffect فقط کشوی فیزیکی
 *
 * باگ: دفتر رویداد چکِ پاس‌شده را بدون توجه به destination نقد فرض می‌کرد؛
 * بازپرداخت کارت و کارت‌به‌کارت هم در بعضی مسیرها از cashEffect کم می‌شد.
 * قاعده‌ی مالک: چک فقط به حساب مدیر/بانک می‌رود؛ بنابراین هیچ چکی اثر
 * فیزیکی صندوق ندارد. بازپرداخت نقدی تنها خروج واقعی این سناریو است.
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

eq('مقصد چک در query دفتر خوانده می‌شود', /destination: true/.test(source), true)
eq('اثر نقدی چک از receiptBucketOf مشترک عبور می‌کند', /receiptBucketOf\(\{ isCheque: true/.test(source), true)
eq('بازپرداخت کارت اثر نقدی صندوق ندارد', /function cashRefundEffect[\s\S]*method === RefundMethod\.CASH \? -n\(amount\) : 0/.test(source), true)
eq('تعویض کارت‌به‌کارت/کارت اثر نقدی را صفر نگه می‌دارد', /function exchangeCashEffect[\s\S]*settlement === ExchangeSettlement\.CASH_REFUND/.test(source), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s112-cash-effect-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)
const day = '1405/03/12'
const at = (hour) => new Date(jalaliStartOfDay(day).getTime() + hour * 3_600_000)
const userId = seed.user('صندوقدار نشست ۱۱۲')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: day, userId })
const invoice = seed.invoice({ grandTotal: 900_000 })
prisma.$harness.db
  .prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, userId = ?, shiftId = ? WHERE id = ?')
  .run(at(9).getTime(), day, userId, shiftId, invoice.id)

const chequeMethod = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
const addClearedCheque = (amount, destination, no, hour) => {
  const paymentId = seed.insert('Payment', {
    invoiceId: invoice.id,
    methodId: chequeMethod,
    amount,
    kind: 'CHEQUE',
    chequeNo: no,
    chequeStatus: 'CLEARED',
    destination,
    paidAt: at(hour - 1),
    paidAtJalali: day,
    clearedAt: at(hour),
    clearedAtJalali: day,
    createdByUserId: userId,
    createdShiftId: shiftId,
    clearedShiftId: shiftId
  })
  seed.insert('PaymentChequeStatusHistory', {
    paymentId,
    status: 'CLEARED',
    clearedAt: at(hour),
    clearedAtJalali: day,
    clearedShiftId: shiftId,
    userId,
    changedAt: at(hour),
    changedAtJalali: day
  })
}

addClearedCheque(100_000, 'CASH', 'S112-CASH', 11)
addClearedCheque(200_000, 'CARD', 'S112-CARD', 12)
addClearedCheque(300_000, 'MANAGER', 'S112-MANAGER', 13)
addClearedCheque(400_000, null, 'S112-UNKNOWN', 14)

seed.insert('SaleReturn', {
  invoiceId: invoice.id,
  total: 50_000,
  refundMethod: 'CASH',
  refundAmount: 50_000,
  returnedAt: at(15),
  returnedAtJalali: day,
  returnedAtTime: '15:00:00',
  userId,
  shiftId,
  kind: 'RETURN'
})
seed.insert('SaleReturn', {
  invoiceId: invoice.id,
  total: 60_000,
  refundMethod: 'CARD',
  refundAmount: 60_000,
  returnedAt: at(16),
  returnedAtJalali: day,
  returnedAtTime: '16:00:00',
  userId,
  shiftId,
  kind: 'RETURN'
})

const report = await salesLedger.ledger({ fromJalali: day, toJalali: day })
const cleared = report.rows.filter((r) => r.eventType === 'CHEQUE_CLEARED')
const returns = report.rows.filter((r) => r.eventType === 'RETURN')

eq('چهار ردیف مستقل پاس‌چک دیده می‌شود', cleared.length, 4)
eq('هیچ مقصد چکی اثر صندوق ندارد', cleared.reduce((s, r) => s + r.cashEffect, 0), 0)
eq('چک با مقصد CASH هم به صندوق نسبت داده نمی‌شود', cleared.find((r) => r.amount === 100_000)?.cashEffect ?? null, 0)
eq('چک با مقصد نامشخص حدس زده نمی‌شود', cleared.find((r) => r.amount === 400_000)?.cashEffect ?? null, 0)
eq('بازپرداخت نقدی از صندوق کم می‌شود', returns.find((r) => r.cashEffect < 0)?.cashEffect ?? null, -50_000)
eq('بازپرداخت کارت از صندوق کم نمی‌شود', returns.find((r) => r.documentLabel.includes('برگشت') && r.cashEffect === 0)?.cashEffect ?? null, 0)
eq('خالص cashEffect فقط پول فیزیکی را نشان می‌دهد', report.totals.netCash, -50_000)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
