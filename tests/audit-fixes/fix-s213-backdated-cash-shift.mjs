/**
 * نشست ۲۱۳ · CRIT-1 — فروش/وصول نقدی با تاریخ قبل باید در نقد مورد انتظار
 * شیفتِ لحظه‌ی ثبت باشد، نه غیب شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s213-backdated-cash-shift.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s213-backdate-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const yesterday = toJalaliDate(new Date(Date.now() - 86400000))
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

const src = readFileSync(resolve(root, 'src/main/services/accountingReport.ts'), 'utf8')
const fnStart = src.indexOf('function paymentEventWindowWhere')
const fnBody = fnStart >= 0 ? src.slice(fnStart, fnStart + 1600) : ''

console.log('\\n۰) سیم‌کشی')
truthy('فیلتر نشست پرداخت را فقط با ستون نشست می‌گیرد', /shiftOwned/.test(fnBody) || /createdShiftId: null/.test(fnBody))

const userId = seed.user('فروشنده تاریخ قبل ۲۱۳')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(v)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)

console.log('\\n۱) فروش نقدی با تاریخ دیروز در نشست امروز')
const nasiyeh = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: []
})
eq('نسیه بدون پرداخت نقد صندوق را عوض نمی‌کند', await exp(), 0)
await salesService.create({
  userId,
  shiftId,
  issuedAtJalali: yesterday,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})
eq('فروش نقدی backdated در نقد مورد انتظار همین نشست', await exp(), 1000)

console.log('\\n۲) وصول نسیه با تاریخ دیروز')
await salesService.addPayment({
  invoiceId: nasiyeh.id,
  methodId: cash,
  amount: 1000,
  destination: 'CASH',
  paidAtJalali: yesterday,
  userId
})
eq('وصول backdated هم در همین نشست', await exp(), 2000)

console.log('\\n۳) بستن صندوق با شمارش ۰ کسری نشان دهد')
const closed = await cashboxService.close({ shiftId, countedCash: 0, userId })
eq('بستن با شمارش ۰ کسری ۲۰۰۰ است', Number(closed.cashClose?.cashDifference ?? closed.difference ?? closed.diff), -2000)
eq('expected و close یک عدد می‌دهند', Number(closed.cashClose?.expectedCash), 2000)

console.log(`\\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
