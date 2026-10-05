/**
 * فروش قبل از خرید، بدهی لات می‌سازد و خرید بعدی آن را صاف می‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-cost-backorder.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-back-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
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

const cat = seed.category('شلوار')
const pA = seed.product('نیم‌بگ', cat)
const v = seed.variant(pA, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)

seed.insert('StockMovement', {
  variantId: v,
  delta: -3,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: null,
  state: 'FINAL',
  createdAt: Date.now() - 1000
})
sql.prepare('UPDATE "ProductVariant" SET stock = -3 WHERE id = ?').run(v)
await costEngine.run()
const mid = await costEngine.health()
eq('بعد از فروش منفی، جمع لات با موجودی یکی است', mid.ok, true)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 93,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 10_000_000,
  discountTotal: 0,
  grandTotal: 10_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 10, unitPrice: 1_000_000, lineTotal: 10_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 10,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 7 WHERE id = ?').run(v)
await costEngine.run()
const h = await costEngine.health()
eq('بعد از خرید، لات با موجودی ۷ می‌خواند', h.ok, true)
eq('مانده لات ۷ است نه ۱۰', h.mismatches.find((m) => m.variantId === v)?.lots ?? 7, 7)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
