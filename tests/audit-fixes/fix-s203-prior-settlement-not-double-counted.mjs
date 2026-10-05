/**
 * نشست ۲۰۳ — وصول نسیه‌ی دوره‌ی قبل در «باید در صندوق و کارت‌خوان باشد» دوبار شمرده نشود.
 *
 * بند ۴-۵۳: ردیف برچسب‌دار «وصول نسیه‌ی دوره‌ی قبل» بماند؛ خودِ مبلغ از قبل داخل
 * receivedTotal / cashReceived است (مثل expectedCash نشست ۱۶۴).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s203-prior-settlement-not-double-counted.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s203-prior-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { physicalMoneyInDrawerAndCard } = await import('../../src/shared/accounting.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const now = Date.now()
const past = now - 10 * 86400_000
const pastJ = toJalaliDate(new Date(past))

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

console.log('\n۰) سیم‌کشی')
const src = readFileSync(new URL('../../src/shared/accounting.ts', import.meta.url), 'utf8')
const fn = src.slice(src.indexOf('export function physicalMoneyInDrawerAndCard'), src.indexOf('export function returnCreditAmountOf'))
truthy('فرمول priorSettlement را جمع نمی‌زند', !/\+ n\(input\.priorSettlementTotal\)/.test(fn))
truthy('ورودی prior برای سازگاری API مانده', /priorSettlementTotal\?:/.test(fn))
eq(
  'واحد: ۷۰٬۰۰۰ دریافت + ۷۰٬۰۰۰ prior ⇒ همان ۷۰٬۰۰۰',
  physicalMoneyInDrawerAndCard({ receivedTotal: 70_000, priorSettlementTotal: 70_000 }),
  70_000
)
eq(
  'واحد: برگشت نقد هنوز کم می‌شود',
  physicalMoneyInDrawerAndCard({ receivedTotal: 100_000, priorSettlementTotal: 70_000, refundCashTotal: 20_000 }),
  80_000
)

const userId = seed.user('فروشنده وصول ۲۰۳')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 3600_000, userId })
const customer = seed.customer('مشتری نسیه قدیمی')
const inv = seed.insert('SaleInvoice', {
  receiptNo: 2031,
  userId,
  status: 'FINAL',
  customerId: customer,
  grandTotal: 200_000,
  paidTotal: 0,
  issuedAt: past,
  issuedAtJalali: pastJ,
  orderType: 'IN_STORE'
})
seed.insert('Payment', {
  invoiceId: inv,
  methodId: cash,
  amount: 70_000,
  kind: 'CASH',
  destination: 'CASH',
  paidAt: now - 60_000,
  paidAtJalali: today,
  createdAt: now - 60_000
})

console.log('\n۱) گزارش امروز — وصول ۷۰٬۰۰۰ نسیه‌ی ۱۰ روز پیش')
const report = await salesService.reportRows({ fromJalali: today, toJalali: today })
const t = report?.totals ?? {}
eq('نقد دریافتی ۷۰٬۰۰۰ است', t.cashTotal, 70_000)
eq('وصول نسیه‌ی دوره‌ی قبل ۷۰٬۰۰۰ است (ردیف برچسب‌دار)', t.priorSettlementTotal, 70_000)
eq('receivedTotal همان ۷۰٬۰۰۰ است (prior داخلش است)', t.receivedTotal, 70_000)
const realCash = physicalMoneyInDrawerAndCard({
  receivedTotal: t.receivedTotal,
  priorSettlementTotal: t.priorSettlementTotal,
  refundCashTotal: t.refundCashTotal,
  refundCardTotal: t.refundCardTotal
})
eq('باید در صندوق ۷۰٬۰۰۰ باشد نه ۱۴۰٬۰۰۰', realCash, 70_000)
eq('پل تطبیق هم ۷۰٬۰۰۰ است', report?.accounting?.cash?.netCashMovement, 70_000)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
