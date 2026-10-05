/**
 * سود تامین‌کننده از فاکتور خرید می‌آید؛ بدون نام = «فاقد نام تامین‌کننده».
 *     node --import ./test/harness/register.mjs tests/management/mgmt-profit-supplier.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sup-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { partyService } = await import('../../src/main/services/PartyService.ts')
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

const userId = seed.user('خرید')
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
const v1 = seed.variant(pA, '32')
const v2 = seed.variant(pA, '34')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v1)
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v2)

const s1 = await partyService.createSupplier({ name: 'ارکاجین' })
const s2 = await partyService.createSupplier({ name: 'علی محمدی' })
eq('اولین تامین‌کننده کد ۱', String(s1.code), '1')
eq('دومین تامین‌کننده کد ۲', String(s2.code), '2')

let buyNo = 10
const buy = (variantId, qty, unit, supplierId) => {
  const id = seed.insert('PurchaseInvoice', {
    invoiceNo: ++buyNo,
    issuedAtJalali: today,
    issuedAt: Date.now(),
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED',
    supplierId: supplierId ?? null
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: id, variantId, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId,
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
    variantId
  )
}

buy(v1, 1, 1_000_000, s1.id)
buy(v2, 1, 1_000_000, null)

await salesService.create({
  userId,
  shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }
  ],
  payments: [{ methodId: cash, amount: 4_000_000, destination: 'CASH' }]
})
await costEngine.run()
const p = await profitService.profit({ fromJalali: today, toJalali: today })
const named = p.bySupplier.find((r) => r.name === 'ارکاجین')
const none = p.bySupplier.find((r) => r.name === 'فاقد نام تامین‌کننده')
eq('سود ارکاجین ۱ میلیون', named?.realProfit, 1_000_000)
eq('بدون نام هم ۱ میلیون', none?.realProfit, 1_000_000)
eq('جمع دو سطل همان سود کل است', (named?.realProfit || 0) + (none?.realProfit || 0), p.realProfit)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
