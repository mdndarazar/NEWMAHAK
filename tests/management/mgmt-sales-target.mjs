/**
 * هدف ماهانه روی فروش خالص تعهدی است، نه سود.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-sales-target.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-target-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { targetService } = await import('../../src/main/services/management/TargetService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { monthStart } = await import('@shared/jalaliBuckets')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const month = today.slice(0, 7)

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

const userId = seed.user('هدف')
const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(pA, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 2000000, purchasePrice = 1000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})

const report = await salesService.reportRows({ fromJalali: monthStart(today), toJalali: today, take: 1 })
const net = report.accounting.invoice.netAccrualSales

const empty = await targetService.get({ toJalali: today })
eq('بدون هدف، مبلغ صفر است', empty.target, 0)
eq('پیشرفت همان فروش خالص گزارش فروش است', empty.netAccrualSales, net)
eq('درصد بدون هدف تهی است', empty.pct, null)

await targetService.set({ monthJalali: month, amount: 4_000_000 })
const filled = await targetService.get({ toJalali: today })
eq('هدف ۴ میلیون ثبت شد', filled.target, 4_000_000)
eq('فروش خالص بعد از ثبت هدف عوض نشد', filled.netAccrualSales, net)
eq('درصد ۵۰ است', filled.pct, 0.5)
eq('مانده تا هدف ۲ میلیون', filled.remaining, 2_000_000)

const again = await salesService.reportRows({ fromJalali: monthStart(today), toJalali: today, take: 1 })
eq('reportRows فروش دست‌نخورده است', again.accounting.invoice.netAccrualSales, net)

let err = null
try {
  await targetService.set({ monthJalali: month, amount: -1 })
} catch (e) {
  err = e.message
}
eq('هدف منفی رد می‌شود', /صحیح/.test(String(err)), true)

const fa = await targetService.set({ monthJalali: month, amount: '۵۰۰۰۰۰۰۰۰' })
eq('رقم فارسی هدف را صفر نمی‌کند', fa.target, 500_000_000)
let badAmt = null
try {
  await targetService.set({ monthJalali: month, amount: '12.5' })
} catch (e) {
  badAmt = e.message
}
eq('اعشار هدف را بی‌صدا صفر نمی‌کند', /صحیح|ریال/.test(String(badAmt)), true)
const still = await targetService.get({ toJalali: today })
eq('مبلغ نامعتبر هدف قبلی را پاک نکرد', still.target, 500_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
