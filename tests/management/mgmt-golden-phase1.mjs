/**
 * عدد طلایی فاز ۱: فروش خالص و نقد نمودار = همان تب سرجمع.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-golden-phase1.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-mgmt1-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { trendService } = await import('../../src/main/services/management/TrendService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 280))
  }
}

const userId = seed.user('مدیر گزارش')
const cat = seed.category('پوشاک')
const pA = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1 })
const vA = seed.variant(pA, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000000 WHERE id = ?').run(vA)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vA, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vA, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }]
})

const filter = { fromJalali: today, toJalali: today }
const report = await salesService.reportRows({ ...filter, take: 1 })
const acc = report.accounting
const snap = await trendService.snapshot(filter)
const trend = await trendService.trend({ ...filter, grain: 'day' })
const staff = await trendService.staff(filter)
const catRep = await trendService.category(filter)

console.log('\nعدد طلایی')
eq('snapshot.netAccrual = reportRows', snap.accounting.invoice.netAccrualSales, acc.invoice.netAccrualSales)
eq('snapshot.cash = reportRows', snap.accounting.cash.cashReceived, acc.cash.cashReceived)
eq('snapshot.card = reportRows', snap.accounting.cash.cardReceived, acc.cash.cardReceived)
eq('یک نقطهٔ روزانه', trend.points.length, 1)
eq('نقطه فروش خالص = سرجمع', trend.points[0].netAccrualSales, acc.invoice.netAccrualSales)
eq('نقطه نقد = سرجمع', trend.points[0].cashReceived, acc.cash.cashReceived)
eq('نقطه کارت = سرجمع', trend.points[0].cardReceived, acc.cash.cardReceived)
eq('تعداد فاکتور نقطه', trend.points[0].invoiceCount, acc.invoice.invoiceCount)
eq('دسته جمع اقلام = payable', catRep.reconcilable, true)
eq('فروشنده حداقل یک ردیف', staff.rows.length >= 1, true)
eq('فروش فروشنده از تب کارمند است نه خالص تعهدیِ قاطی‌شده', typeof staff.rows[0].salesTotal, 'number')

const cmp = await trendService.compare({ ...filter, mode: 'previous' })
eq('مقایسه بازه جاری همان امروز', cmp.a.accounting.invoice.netAccrualSales, acc.invoice.netAccrualSales)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
