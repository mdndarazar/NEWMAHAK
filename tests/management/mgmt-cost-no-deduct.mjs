/**
 * فاکتور بدون کسر از موجودی، لات فروشگاه را مصرف نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-no-deduct.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-nodeduct-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('بدون‌کسر')
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
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 92,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 1000000, salePrice = 2000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  deductInventory: false,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
const h = await costEngine.health()
eq('لات فروشگاه هنوز ۱ است', h.mismatches.find((m) => m.variantId === v)?.lots ?? 1, 1)
eq('موجودی فروشگاه هنوز ۱ است', Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(v).stock), 1)
const p = await profitService.profit({ fromJalali: today, toJalali: today })
eq('فروش بدون کسر از سود فروشگاه بیرون است', p.realProfit, 0)
eq('درآمد سود صفر است', p.revenue, 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
