/**
 * نشست ۱۸۹ · باقی‌مانده‌های واقعی (بدون ویژگی سبز / بدون موارد بسته‌شدهٔ مالک):
 *   • چکِ سررسید امروز وسط روز معوق نیست
 *   • مبلغ تعویض پنل کارمند = کالای جایگزین
 *   • ساعت پرداخت داخل paidAt می‌نشیند
 *   • وصول با تاریخ قبل در جزئیات شیفت علامت می‌خورد
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s189-remaining-bugs.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s189-remain-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { calculateStaffPerformance } = await import('../../src/shared/accounting.ts')
const { toJalaliDate, jalaliAddDays } = await import('@shared/jalali')

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

const user = seed.user('کارمند باقی')
const product = seed.product('کالا', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 10000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: user })

console.log('\n۱) مبلغ تعویض = کالای جایگزین')
{
  const rows = calculateStaffPerformance(
    [],
    [{ kind: 'EXCHANGE', total: 1_000_000, exchangeTotal: 1_300_000, userId: 1, userName: 'الف' }],
    []
  )
  eq('exchangeTotal جایگزین است نه برگشتی', rows[0]?.exchangeTotal, 1_300_000)
}

console.log('\n۲) چک سررسید امروز معوق نیست؛ دیروز معوق است')
{
  const sale = await salesService.create({
    userId: user, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 10_000, discount: 0, tax: 0 }],
    payments: []
  })
  await salesService.addPayment({
    invoiceId: sale.id, amount: 4_000, kind: 'CHEQUE', dueDateJalali: today, userId: user
  })
  const sale2 = await salesService.create({
    userId: user, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 10_000, discount: 0, tax: 0 }],
    payments: []
  })
  await salesService.addPayment({
    invoiceId: sale2.id, amount: 3_000, kind: 'CHEQUE', dueDateJalali: yesterday, userId: user
  })
  const report = await salesService.reportRows({ fromJalali: today, toJalali: today })
  const ch = report.accounting?.cheques
  eq('سررسید امروز در آینده است', ch?.pendingFuture, 4_000)
  eq('سررسید دیروز معوق است', ch?.pendingPastDue, 3_000)
}

console.log('\n۳) ساعت پرداخت داخل paidAt')
{
  const sale = await salesService.create({
    userId: user, shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 10_000, discount: 0, tax: 0 }],
    payments: []
  })
  const pay = await salesService.addPayment({
    invoiceId: sale.id, methodId: cash, amount: 10_000, destination: 'CASH', userId: user,
    paidAtJalali: yesterday, paidAtTime: '19:30:00'
  })
  const row = sql.prepare('SELECT paidAt, paidAtTime, paidAtJalali FROM "Payment" WHERE id = ?').get(pay.payment.id)
  const d = new Date(Number(row.paidAt))
  eq('paidAtJalali دیروز', row.paidAtJalali, yesterday)
  eq('ساعت رشته ۱۹:۳۰', String(row.paidAtTime).slice(0, 5), '19:30')
  eq('ساعت Date هم ۱۹', d.getHours(), 19)
  eq('دقیقه Date هم ۳۰', d.getMinutes(), 30)
}

console.log('\n۴) علامت ثبت با تاریخ قبل در جزئیات شیفت')
{
  const detail = await cashboxService.shiftDetail({ shiftId })
  const back = (detail.shiftPayments ?? []).filter((r) => r.backdated)
  eq('حداقل یک وصول با تاریخ قبل', back.length > 0, true)
  eq('برچسب ثبت با تاریخ قبل', back.some((r) => String(r.label).includes('ثبت با تاریخ قبل')), true)
}

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
