/**
 * نشست ۱۹۹ — برگشت کالای جایگزین از سند تعویضِ نسیه، بدهی مادر را کم می‌کند.
 * نسیه ۱۰۰۰ (۶۰۰+۴۰۰) → تعویض ۶۰۰ با ۲۰۰ → برگشت همان ۲۰۰ (STORE_CREDIT→NONE)
 * ⇒ مانده مادر ۴۰۰، پل بسته.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s199-exchange-return-parent-debt.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s199-ex-parent-debt-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService, saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست ۱۹۹ بدهی مادر')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const remainingOf = async (id) => Number((await salesService.payments({ invoiceId: id })).remaining ?? -1)

const a = variant(600)
const b = variant(400)
const sale = await safe('فروش نسیه ۱۰۰۰', () => salesService.create({
  userId, shiftId,
  lines: [
    { variantId: a, qty: 1, unitPrice: 600, discount: 0, tax: 0 },
    { variantId: b, qty: 1, unitPrice: 400, discount: 0, tax: 0 }
  ],
  payments: []
}))
eq('مانده اول ۱۰۰۰', sale ? await remainingOf(sale.id) : -1, 1000)

const ex = await safe('تعویض ۶۰۰ با ۲۰۰', () => salesService.createExchange({
  invoiceId: sale.id,
  lines: [{ saleItemId: itemsOf(sale.id)[0].id, qty: 1 }],
  replacements: [{ variantId: variant(200), qty: 1, unitPrice: 200, discount: 0, tax: 0 }],
  refundMode: 'STORE_CREDIT',
  userId, shiftId
}))
eq('بعد از تعویض مانده ۶۰۰', sale ? await remainingOf(sale.id) : -1, 600)

const ret = await safe('برگشت کالای جایگزین ۲۰۰', () => salesService.createReturn({
  invoiceId: ex.exchangeInvoiceId,
  full: false,
  lines: [{ saleItemId: itemsOf(ex.exchangeInvoiceId)[0].id, qty: 1 }],
  refundMethod: RefundMethod.STORE_CREDIT,
  refundAmount: 200,
  userId, shiftId
}))
eq('روش NONE شد (نقدی در کار نبود)', String(seed.one('SELECT refundMethod FROM "SaleReturn" WHERE id = ?', ret?.id)?.refundMethod ?? ''), RefundMethod.NONE)
eq('مانده مادر ۴۰۰ (نه ۶۰۰)', sale ? await remainingOf(sale.id) : -1, 400)

const credit = await safe('فهرست نسیه', () => salesService.creditList({ fromJalali: today, toJalali: today, includeSettled: true }))
const row = (credit?.rows ?? []).find((r) => r.id === sale?.id)
eq('creditList مانده ۴۰۰', Number(row?.remaining ?? -1), 400)

const filter = { fromJalali: today, toJalali: today }
const { statements } = await buildStatements({
  where: saleWhere(filter),
  from: jalaliStartOfDay(today),
  to: jalaliEndOfDay(today),
  period: { fromJalali: today, toJalali: today, source: 'explicit' },
  filter
})
eq('پل تطبیق بسته است', statements.bridge.unexplained, 0)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
