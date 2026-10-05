/**
 * نشست ۲۰۴ — مابه‌التفاوت مثبت تعویض در دفتر رویداد دوبار شمرده نشود (بند ۴-۴۹).
 *
 * فروش ۱٬۰۰۰٬۰۰۰ نقد + تعویض با کالای ۱٬۴۰۰٬۰۰۰ و ۴۰۰٬۰۰۰ نقد مشتری:
 * جمع cashEffect باید ۱٬۴۰۰٬۰۰۰ باشد نه ۱٬۸۰۰٬۰۰۰.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s204-exchange-ledger-cash-once.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s204-ex-led-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

console.log('\n۰) سیم‌کشی')
const src = readFileSync(new URL('../../src/main/services/SalesLedger.ts', import.meta.url), 'utf8')
truthy('سند تعویض از ردیف SALE کنار گذاشته می‌شود', /NOT: \{ orderType: OrderType\.EXCHANGE \}/.test(src))

const userId = seed.user('فروشنده دفتر ۲۰۴')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)

console.log('\n۱) فروش ۱M نقد + تعویض با کالای ۱٫۴M و ۴۰۰k نقد')
const inv = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: variant(1_000_000), qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
await salesService.createExchange({
  invoiceId: inv.id,
  lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
  replacements: [{ variantId: variant(1_400_000), qty: 1 }],
  methodId: cash,
  userId,
  shiftId
})

const led = await salesLedger.ledger({ fromJalali: today, toJalali: today })
const saleRows = led.rows.filter((r) => r.eventType === 'SALE')
const expRows = led.rows.filter((r) => r.eventType === 'EXCHANGE_REPLACEMENT')
const saleCash = saleRows.reduce((s, r) => s + r.cashEffect, 0)
const expCash = expRows.reduce((s, r) => s + r.cashEffect, 0)
eq('یک ردیف SALE (فاکتور اصلی، نه سند تعویض)', saleRows.length, 1)
eq('اثر نقد SALE همان ۱٬۰۰۰٬۰۰۰ فاکتور اصلی است', saleCash, 1_000_000)
eq('یک ردیف کالای جایگزین', expRows.length, 1)
eq('اثر نقد تعویض ۴۰۰٬۰۰۰ است (یک‌بار)', expCash, 400_000)
eq('جمع نقد دفتر ۱٬۴۰۰٬۰۰۰ است نه ۱٬۸۰۰٬۰۰۰', led.totals.netCash, 1_400_000)
eq('خروج انبار دوبار شمرده نشد (اصلی −۱، برگشت +۱، جایگزین −۱)', led.totals.stockOut, 2)
eq('ورود انبار فقط کالای برگشتی', led.totals.stockIn, 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
