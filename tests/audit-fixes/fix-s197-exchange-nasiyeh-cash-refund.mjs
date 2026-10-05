/**
 * نشست ۱۹۷ — باگ بحرانی ممیزی کلاد:
 * برگشت کالای تعویضی روی فاکتور نسیه نباید نقد از کشو بدهد.
 * سقف = پول واقعی (نقد/کارت/چک پاس‌شده)، نه paidTotal و نه EXCHANGE_CREDIT.
 * اگر فاکتور اصلی نقد بوده، خروج نقد مجاز است.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s197-exchange-nasiyeh-cash-refund.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s197-ex-nasiyeh-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست ۱۹۷ تعویض-نسیه')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const refundSum = (type) => {
  const row = seed.one('SELECT COALESCE(SUM(amount), 0) AS t FROM "CashMovement" WHERE type = ?', type)
  return Number(row?.t ?? 0)
}

console.log('\n۰) قرارداد منبع: سقف برگشت از پول واقعی است نه paidTotal')
{
  const SALES = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
  truthy('cashLikeRefundableOf تعریف شده', /async function cashLikeRefundableOf/.test(SALES))
  truthy('runReturn سقف را از cashLikeRefundableOf می‌گیرد', /receivedOnInvoice = await cashLikeRefundableOf/.test(SALES))
}

const exchangeThenReturnCash = async (label, paid) => {
  const srcVar = variant(1_000_000)
  const sale = await safe(`${label}: فروش ${paid ? 'نقد' : 'نسیه'} ۱M`, () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: srcVar, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    payments: paid ? [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] : []
  }))
  if (!sale) return null
  const ex = await safe(`${label}: تعویض به ۶۰۰k`, () => salesService.createExchange({
    invoiceId: sale.id,
    lines: [{ saleItemId: itemsOf(sale.id)[0].id, qty: 1 }],
    replacements: [{ variantId: variant(600_000), qty: 1, unitPrice: 600_000, discount: 0, tax: 0 }],
    refundMode: paid ? 'STORE_CREDIT' : undefined,
    userId, shiftId
  }))
  if (!ex) return null
  eq(`${label}: سند تعویض ساخته شد`, typeof ex.exchangeInvoiceId, 'number')
  const retBefore = refundSum('RETURN_REFUND')
  const ret = await safe(`${label}: برگشت نقد کالای تعویضی`, () => salesService.createReturn({
    invoiceId: ex.exchangeInvoiceId,
    full: false,
    lines: [{ saleItemId: itemsOf(ex.exchangeInvoiceId)[0].id, qty: 1 }],
    refundMethod: RefundMethod.CASH,
    refundAmount: 600_000,
    userId, shiftId
  }))
  const row = ret ? seed.one('SELECT refundAmount, refundMethod FROM "SaleReturn" WHERE id = ?', ret.id) : null
  const cashOut = refundSum('RETURN_REFUND') - retBefore
  return { sale, ex, ret, row, cashOut }
}

console.log('\n۱) نسیه ۱M → تعویض ۶۰۰k → برگشت نقد ⇒ خروج صفر، روش NONE')
{
  const r = await exchangeThenReturnCash('نسیه', 0)
  if (r) {
    eq('خروج نقد صفر', r.cashOut, 0)
    eq('روش NONE شد', String(r.row?.refundMethod ?? ''), RefundMethod.NONE)
    eq('مبلغ بازپرداخت صفر', Number(r.row?.refundAmount ?? -1), 0)
  }
}

console.log('\n۲) نقد ۱M → تعویض ۶۰۰k → برگشت نقد ⇒ خروج ۶۰۰k مجاز است')
{
  const r = await exchangeThenReturnCash('نقد', 1_000_000)
  if (r) {
    eq('خروج نقد ۶۰۰k', r.cashOut, 600_000)
    eq('روش CASH ماند', String(r.row?.refundMethod ?? ''), RefundMethod.CASH)
    eq('مبلغ بازپرداخت ۶۰۰k', Number(r.row?.refundAmount ?? -1), 600_000)
  }
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
