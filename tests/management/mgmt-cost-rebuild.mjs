/**
 * بازسازی دفتر هزینه فقط جدول‌های خودش را از نو می‌سازد.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-rebuild.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-rebuild-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 280))
  }
}

const userId = seed.user('بازسازی')
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
  invoiceNo: 1,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buyId, variantId: v, qty: 2, unitPrice: 1_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 2,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buyId,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2, purchasePrice = 1000000, salePrice = 2000000 WHERE id = ?').run(v)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()
const snap = () => ({
  lots: Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) AS n FROM "PurchaseLot"').get().n),
  costs: Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleItemCost"').get().n),
  fifo: Number(sql.prepare('SELECT COALESCE(SUM(fifoCost),0) AS n FROM "SaleItemCost"').get().n)
})
const a = snap()
eq('قبل از بازسازی مانده لات ۱', a.lots, 1)
eq('یک فی قفل', a.costs, 1)

const rebuilt = await costEngine.rebuild()
eq('بازسازی تمام شد', rebuilt.rebuilt, true)
const b = snap()
eq('بعد از بازسازی مانده لات همان است', b.lots, a.lots)
eq('تعداد فی قفل همان است', b.costs, a.costs)
eq('جمع FIFO همان است', b.fifo, a.fifo)
const h = await costEngine.health()
eq('سلامت بعد از بازسازی', h.ok, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
