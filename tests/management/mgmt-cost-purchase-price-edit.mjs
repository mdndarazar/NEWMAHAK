/**
 * اصلاح قیمت فاکتور خرید، سود فروش گذشته را خودکار درست می‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-purchase-price-edit.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-'))
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

const userId = seed.user('فی')
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

const buyId = seed.insert('PurchaseInvoice', {
  invoiceNo: 88,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 100000,
  discountTotal: 0,
  grandTotal: 100000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyId, variantId: v, qty: 1, unitPrice: 100000, lineTotal: 100000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyId,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 1, purchasePrice = 100000, salePrice = 2000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
const before = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از اصلاح فی، سود با فی غلط ۱٫۹ میلیون است', before.realProfit, 1_900_000)

sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1000000, grandTotal = 1000000 WHERE id = ?').run(buyId)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1000000, lineTotal = 1000000 WHERE invoiceId = ?').run(buyId)
await costEngine.repricePurchase(buyId)
const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('بعد از اصلاح فی، سود فروش گذشته ۱ میلیون شد', after.realProfit, 1_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
