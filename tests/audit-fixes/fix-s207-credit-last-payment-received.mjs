/**
 * نشست ۲۰۷ — ستون «آخرین پرداختی» تب نسیه چکِ پاس‌نشده را نشان ندهد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s207-credit-last-payment-received.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s207-last-pay-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliAddDays } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const yday = jalaliAddDays(today, -1)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

console.log('\n۰) سیم‌کشی')
const src = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('async creditList('), src.indexOf('async creditList(') + 12_000)
truthy('آخرین پرداختی از پرداخت‌های دریافت‌شده است', /receivedPays[\s\S]{0,80}isReceivedPayment/.test(body))

const userId = seed.user('فروشنده نسیه ۲۰۷')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000 WHERE id = ?').run(variantId)

console.log('\n۱) نقد دیروز + چک در جریان امروز')
const inv = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: []
})
await salesService.addPayment({
  invoiceId: inv.id, userId, methodId: cash, amount: 200, destination: 'CASH', paidAtJalali: yday
})
await salesService.addPayment({
  invoiceId: inv.id, userId, methodId: cheque, kind: 'CHEQUE', amount: 700,
  chequeNo: 'L207', bankName: 'تست', dueDateJalali: today
})

const list = await salesService.creditList({ fromJalali: today, toJalali: today })
const row = (list?.rows ?? []).find((r) => r.id === inv.id)
eq('فاکتور در تب نسیه هست', !!row, true)
eq('آخرین پرداختی تاریخ نقد است نه چک', row?.lastPaymentJalali, yday)
eq('چک در جریان در جمع چکِ در جریان است', Number(row?.pendingChequeTotal ?? -1), 700)
eq('باقی‌مانده ۸۰۰ است (چک ننشسته)', Number(row?.remaining ?? -1), 800)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
