/**
 * نشست ۱۸۹ · اولویت ۱-۶ — ریز پرداخت جزئیات شیفت با کلید نشست است، نه پنجره‌ی ساعت.
 *
 * وصول نسیه در شیفت B با تاریخ گذشته‌نگرِ شیفت A باید در B دیده شود، نه در A.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s189-shift-payments-by-shift.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s189-shift-pay-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate, jalaliAddDays, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const yesterday = jalaliAddDays(today, -1)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}

const user = seed.user('کارمند ۱-۶')
const product = seed.product('کالای ۱-۶', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 10000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })

const shiftA = seed.insert('Shift', {
  name: 'صبح دیروز',
  number: 1,
  dayJalali: yesterday,
  openedAt: jalaliStartOfDay(yesterday).getTime(),
  closedAt: jalaliEndOfDay(yesterday).getTime(),
  userId: user
})
const shiftB = seed.insert('Shift', {
  name: 'صبح امروز',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: user
})

const sale = await salesService.create({
  userId: user,
  shiftId: shiftB,
  lines: [{ variantId, qty: 1, unitPrice: 10_000, discount: 0, tax: 0 }],
  payments: []
})

const pay = await salesService.addPayment({
  invoiceId: sale.id,
  methodId: cash,
  amount: 10_000,
  destination: 'CASH',
  userId: user,
  paidAtJalali: yesterday
})

const paymentId = pay.payment?.id ?? pay.id
const created = sql.prepare('SELECT createdShiftId, paidAtJalali FROM "Payment" WHERE id = ?').get(paymentId)
eq('createdShiftId = شیفت B', Number(created.createdShiftId), shiftB)
eq('paidAt تاریخ دیروز است', created.paidAtJalali, yesterday)

const detailA = await cashboxService.shiftDetail({ shiftId: shiftA })
const detailB = await cashboxService.shiftDetail({ shiftId: shiftB })
const idsA = (detailA.shiftPayments ?? []).map((r) => r.paymentId)
const idsB = (detailB.shiftPayments ?? []).map((r) => r.paymentId)

eq('جزئیات شیفت A این وصول را ندارد', idsA.includes(paymentId), false)
eq('جزئیات شیفت B این وصول را دارد', idsB.includes(paymentId), true)
eq('جمع دریافتی شیفت B', detailB.shiftPaymentTotals?.total, 10_000)
eq('جمع دریافتی شیفت A', detailA.shiftPaymentTotals?.total, 0)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
