/**
 * رقم فارسی و روز/ماه بدون صفر در فیلتر مدیریت همان بازهٔ لاتین است.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-date-normalize.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-mgmt-date-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { trendService } = await import('../../src/main/services/management/TrendService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { normalizeJalaliYmd } = await import('../../src/shared/jalaliBuckets.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const FA = '۰۱۲۳۴۵۶۷۸۹'
const toFa = (s) => String(s).replace(/\d/g, (d) => FA[Number(d)])
const unpad = (s) => String(s).replace(/\/0(\d)/g, '/$1')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 360))
  }
}

const userId = seed.user('مدیر تاریخ')
const cat = seed.category('پوشاک')
const pA = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const vA = seed.variant(pA, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000000 WHERE id = ?').run(vA)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: vA, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})

const latin = await trendService.snapshot({ fromJalali: today, toJalali: today })
const fa = await trendService.snapshot({ fromJalali: toFa(today), toJalali: toFa(today) })
const padless = unpad(today)
const unpaddedSnap = await trendService.snapshot({ fromJalali: padless, toJalali: padless })

console.log('\nنرمال تاریخ فیلتر مدیریت')
eq('normalize فارسی', normalizeJalaliYmd(toFa(today)), today)
eq('normalize بدون صفر', normalizeJalaliYmd(padless), today)
eq('فروش خالص رقم فارسی = لاتین', fa.accounting.invoice.netAccrualSales, latin.accounting.invoice.netAccrualSales)
eq('تعداد فاکتور رقم فارسی', fa.accounting.invoice.invoiceCount, latin.accounting.invoice.invoiceCount)
eq('فروش خالص بدون صفر = لاتین', unpaddedSnap.accounting.invoice.netAccrualSales, latin.accounting.invoice.netAccrualSales)

const profitFa = await profitService.profit({ fromJalali: toFa(today), toJalali: toFa(today) })
eq('سود بازهٔ فارسی نرمال شد', profitFa.fromJalali, today)
eq('سود تا فارسی نرمال شد', profitFa.toJalali, today)

let threw = false
try {
  await trendService.snapshot({ fromJalali: 'نه-تاریخ', toJalali: today })
} catch {
  threw = true
}
eq('تاریخ نامعتبر رد می‌شود', threw, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
