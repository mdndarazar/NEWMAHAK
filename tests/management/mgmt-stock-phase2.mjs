/**
 * فاز ۲: مانده از stock کالا، فروش کم می‌شود، خرید در برابر فروش از سرجمع.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-stock-phase2.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-mgmt2-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
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

const userId = seed.user('انبار')
const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1 })
const v32 = seed.variant(pA, '32')
const v50 = seed.variant(pA, '50')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000000, purchasePrice = 400000, size = ? WHERE id = ?').run('32', v32)
sql.prepare('UPDATE "ProductVariant" SET stock = 12, salePrice = 1000000, purchasePrice = 400000, size = ? WHERE id = ?').run('50', v50)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v32, qty: 2, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})

const stock = await stockInsightService.stock({ fromJalali: today, toJalali: today })
const row32 = stock.rows.find((r) => r.variantId === v32)
const row50 = stock.rows.find((r) => r.variantId === v50)
const abc = await stockInsightService.abc({ toJalali: today })
const size = await stockInsightService.sizeCurve({ toJalali: today })
const buy = await stockInsightService.purchaseVsSale({ fromJalali: today, toJalali: today })
const report = await salesService.reportRows({ fromJalali: today, toJalali: today, take: 1 })

console.log('\nمانده و ABC')
eq('مانده ۳۲ بعد از فروش ۲ از ۱۰', row32?.stock, 8)
eq('مانده ۵۰ دست‌نخورده ۱۲', row50?.stock, 12)
eq('فروش ۳۰روز سایز ۳۲', row32?.netSold30, 2)
eq('فروش ۳۰روز سایز ۵۰ صفر', row50?.netSold30, 0)
eq('ارزش جایگزینی ۳۲ = ۸×۴۰۰هزار', row32?.replacementValue, 3_200_000)
eq('ABC حداقل یک کالا', abc.rows.length >= 1, true)
eq('ABC کلاس دارد', ['A', 'B', 'C'].includes(abc.rows[0].cls), true)
eq('منحنی سایز مدل نیم‌بگ', size.products.some((p) => p.sizes['32'] || p.sizes['۳۲']), true)
eq('خرید در برابر فروش: فروش خالص = سرجمع', buy.netAccrualSales, report.accounting.invoice.netAccrualSales)
eq('بدون فاکتور خرید، خرید صفر', buy.purchaseTotal, 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
