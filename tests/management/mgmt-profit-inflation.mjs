/**
 * سود در تورم: خرید ۱م فروش ۲م، بعد خرید ۲م فروش ۴م.
 * سود واقعی از لات همان خرید است؛ فی کارت تاریخچه را عوض نمی‌کند.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-profit-inflation.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-profit-'))
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

const userId = seed.user('سود')
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

let buyNo = 400
const buy = (qty, unit) => {
  const id = seed.insert('PurchaseInvoice', {
    invoiceNo: ++buyNo,
    issuedAtJalali: today,
    issuedAt: Date.now(),
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', {
    invoiceId: id,
    variantId: v,
    qty,
    unitPrice: unit,
    lineTotal: qty * unit
  })
  seed.insert('StockMovement', {
    variantId: v,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: id,
    state: 'FINAL',
    createdAt: Date.now()
  })
  sql.prepare(
    'UPDATE "ProductVariant" SET stock = stock + ?, purchasePrice = ?, salePrice = ? WHERE id = ?'
  ).run(qty, unit, unit * 2, v)
  return id
}

buy(1, 1_000_000)
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})

buy(1, 2_000_000)
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 4_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 4_000_000, destination: 'CASH' }]
})

await costEngine.run()
const p = await profitService.profit({ fromJalali: today, toJalali: today })
const report = await (await import('../../src/main/services/SalesService.ts')).salesService.reportRows({
  fromJalali: today,
  toJalali: today,
  take: 1
})

console.log('\nسود تورم')
eq('درآمد ۶ میلیون (۲م + ۴م)', p.revenue, 6_000_000)
eq('هزینه واقعی ۳ میلیون (۱م + ۲م)', p.fifoCost, 3_000_000)
eq('سود واقعی ۳ میلیون', p.realProfit, 3_000_000)
eq('هزینه جایگزینی ۳ میلیون (آخرین خرید هر فروش)', p.replacementCost, 3_000_000)
eq('سود جایگزینی ۳ میلیون', p.replacementProfit, 3_000_000)
eq('دو قلم فروش قفل شده', p.lines.length, 2)
eq(
  'سود واقعی دو فروش ۱م و ۲م',
  p.lines.map((l) => l.realProfit).sort((a, b) => a - b),
  [1_000_000, 2_000_000]
)
eq('فروش خالص گزارش فروش دست‌نخورده است', p.netAccrualSales, report.accounting.invoice.netAccrualSales)

sql.prepare('UPDATE "ProductVariant" SET purchasePrice = 9000000 WHERE id = ?').run(v)
const p2 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('عوض کردن فی کارت، سود قفل‌شده را عوض نکرد', p2.realProfit, 3_000_000)
eq('سود جایگزینی قفل‌شده هم همان ماند', p2.replacementProfit, 3_000_000)

buy(5, 2_000_000)
await costEngine.run()
const p3 = await profitService.profit({ fromJalali: today, toJalali: today })
eq('۵ عدد مانده', p3.stock.qty, 5)
eq('مانده تمام‌شده ۱۰ میلیون', p3.stock.fifoValue, 10_000_000)
eq('ثروت کاغذی صفر چون فی جایگزینی = فی لات', p3.stock.paperWealth, 0)

const v2 = seed.variant(pA, '34')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v2)
const buy2 = (qty, unit) => {
  const id = seed.insert('PurchaseInvoice', {
    invoiceNo: ++buyNo,
    issuedAtJalali: today,
    issuedAt: Date.now(),
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: id, variantId: v2, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId: v2,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: id,
    state: 'FINAL',
    createdAt: Date.now()
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock + ?, purchasePrice = ?, salePrice = ? WHERE id = ?').run(
    qty,
    unit,
    unit * 2,
    v2
  )
}
buy2(2, 1_000_000)
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v2, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
buy2(2, 2_000_000)
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v2, qty: 1, unitPrice: 4_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 4_000_000, destination: 'CASH' }]
})
const p4 = await profitService.profit({ fromJalali: today, toJalali: today })
const cheapSold = p4.lines.filter((l) => l.variantId === v2)
eq('FIFO: فروش ۴میلیونی از لات ۱میلیونی است', cheapSold.some((l) => l.fifoCost === 1_000_000 && l.revenue === 4_000_000), true)
eq('همان فروش: جایگزینی ۲م (آخرین خرید)', cheapSold.some((l) => l.revenue === 4_000_000 && l.replacementCost === 2_000_000), true)
eq('سود واقعی آن فروش ۳م و جایگزینی ۲م', cheapSold.some((l) => l.revenue === 4_000_000 && l.realProfit === 3_000_000 && l.replacementProfit === 2_000_000), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
