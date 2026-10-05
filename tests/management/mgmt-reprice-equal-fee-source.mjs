/**
 * بازبینی B1 — قیمت مساوی، منبع مساوی نیست: بعد از فروش از P1، فاکتور P2 با همان
 * فی وارد می‌شود. اصلاح P1 باید فروشِ قفل‌شده به P1 را عوض کند و فروشِ بعدی از P2
 * را دست‌نخورده بگذارد؛ مقایسهٔ صرفِ مبلغ این دو منبع را اشتباه یکی می‌گیرد.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-reprice-equal-fee-source.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-equal-'))
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
const DAY = 86400_000

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

const userId = seed.user('منبع فی برابر')
const categoryId = seed.category('کفش')
const productId = seed.product('کفش چرمی')
const methodId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const variantId = seed.variant(productId, '41')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 5000000, purchasePrice = 0 WHERE id = ?').run(variantId)

const addPurchase = (invoiceNo, daysAgo, unitPrice) => {
  const invoiceId = seed.insert('PurchaseInvoice', {
    invoiceNo,
    issuedAtJalali: today,
    issuedAt: Date.now() - daysAgo * DAY,
    goodsTotal: unitPrice,
    discountTotal: 0,
    grandTotal: unitPrice,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', {
    invoiceId,
    variantId,
    qty: 1,
    unitPrice,
    lineTotal: unitPrice
  })
  seed.insert('StockMovement', {
    variantId,
    delta: 1,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: invoiceId,
    state: 'FINAL',
    createdAt: Date.now() - daysAgo * DAY
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1, purchasePrice = ? WHERE id = ?').run(unitPrice, variantId)
  return invoiceId
}

const p1 = addPurchase(760, 4, 1_000_000)
await costEngine.run()
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 5_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId, amount: 5_000_000, destination: 'CASH' }]
})
await costEngine.run()
const item1 = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" ORDER BY id DESC LIMIT 1').get().id)

// فاکتور دوم عمداً همان فی را دارد؛ مبلغ به‌تنهایی منبع را از P1/P2 جدا نمی‌کند.
const p2 = addPurchase(761, 1, 1_000_000)
await costEngine.run()
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 5_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId, amount: 5_000_000, destination: 'CASH' }]
})
await costEngine.run()
const item2 = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" ORDER BY id DESC LIMIT 1').get().id)

const costOf = (itemId) =>
  sql.prepare(
    'SELECT fifoCost, replacementCost, replacementSource, replacementPurchaseInvoiceId FROM "SaleItemCost" WHERE saleItemId = ?'
  ).get(itemId)
const compact = (itemId) => {
  const r = costOf(itemId)
  return r && {
    fifo: Number(r.fifoCost),
    replacement: Number(r.replacementCost),
    source: r.replacementSource,
    invoiceId: r.replacementPurchaseInvoiceId == null ? null : Number(r.replacementPurchaseInvoiceId)
  }
}

eq('فروش اول هم با مبلغ و هم با منبع به P1 متصل است', compact(item1), {
  fifo: 1_000_000,
  replacement: 1_000_000,
  source: 'PURCHASE_INVOICE',
  invoiceId: p1
})
eq('فروش دوم با همان مبلغ، ولی با منبع P2 ثبت شده است', compact(item2), {
  fifo: 1_000_000,
  replacement: 1_000_000,
  source: 'PURCHASE_INVOICE',
  invoiceId: p2
})

sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 1100000, grandTotal = 1100000 WHERE id = ?').run(p1)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 1100000, lineTotal = 1100000 WHERE invoiceId = ?').run(p1)
const repriced = await costEngine.repricePurchase(p1)

eq('اصلاح منبع P1 فقط یک ردیف جایگزینی را لمس می‌کند', repriced.replacementFixed, 1)
eq('به‌خاطر ردیف P2 هشدار stale کاذب ساخته نمی‌شود', repriced.replacementStale, 0)
eq('فروش اولِ منتسب به P1 اصلاح می‌شود', Number(costOf(item1).replacementCost), 1_100_000)
eq('فروش دومِ منتسب به P2، با وجود فی برابر، دست‌نخورده می‌ماند', Number(costOf(item2).replacementCost), 1_000_000)
eq('منبع فروش دوم نیز P2 باقی می‌ماند', Number(costOf(item2).replacementPurchaseInvoiceId), p2)
eq('FIFO فروش P2 هم با اصلاحِ P1 عوض نمی‌شود', Number(costOf(item2).fifoCost), 1_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
