// @ts-check
/**
 * پرداخت ترکیبیِ مثبت تعویض: دو Payment واقعی با جمع دقیق، بدون تغییر مسیر تک‌روش.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s345-exchange-positive-cash-card-split.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-s345-exchange-split-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const userId = seed.user('فروشنده تست تعویض ترکیبی')
const categoryId = seed.category('دسته تست تعویض ترکیبی')
const productId = seed.product('کالای تست تعویض ترکیبی', categoryId)
const cashMethod = seed.insert('PaymentMethod', { key: 'S345-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cardMethod = seed.insert('PaymentMethod', { key: 'S345-CARD', label: 'کارت', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'شیفت تست تعویض ترکیبی', number: 1, dayJalali: today, openedAt: Date.now(), userId })

let variantNo = 0
const variant = (price) => {
  const id = seed.variant(productId, `مدل ${++variantNo}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(20, price, id)
  return id
}
const originalVariant = variant(1_000)
const replacementVariant = variant(1_500)

const original = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: originalVariant, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cashMethod, amount: 1_000, destination: 'CASH' }]
})
const saleItemId = Number(seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', original.id).id)
const exchangeInput = (payments) => ({
  userId,
  shiftId,
  invoiceId: original.id,
  lines: [{ saleItemId, qty: 1 }],
  replacements: [{ variantId: replacementVariant, qty: 1 }],
  splitPayment: true,
  payments
})

console.log('--- ۱. جمعِ نادرست پیش از هر ثبت تعویض رد می‌شود ---')
await assert.rejects(
  () => salesService.createExchange(exchangeInput([
    { methodId: cashMethod, amount: 200, destination: 'CASH' },
    { methodId: cardMethod, amount: 200, destination: 'CARD' }
  ])),
  /جمع نقد و کارت.*۵۰۰/
)
assert.equal(seed.count('SaleReturn'), 0, 'رد شدن جمع نادرست هیچ برگشتی ایجاد نکرد')
console.log('  ✓ جمع کمتر از مابه‌التفاوت، اتمیک رد شد')

console.log('--- ۲. سهم دقیق نقد و کارت، دو ردیف مستقل می‌سازد ---')
const result = await salesService.createExchange(exchangeInput([
  { methodId: cashMethod, amount: 200, destination: 'CASH' },
  { methodId: cardMethod, amount: 300, destination: 'CARD' }
]))
assert.equal(result.diff, 500)
assert.equal(result.settlement, 'CASH')
const payments = seed.rows(
  `SELECT amount, destination, methodId FROM "Payment"
   WHERE invoiceId = ? AND destination IN ('CASH', 'CARD') ORDER BY seq`,
  result.exchangeInvoiceId
)
assert.deepEqual(payments.map((row) => [Number(row.amount), row.destination, Number(row.methodId)]), [
  [200, 'CASH', cashMethod],
  [300, 'CARD', cardMethod]
])
assert.equal(result.cashReceived, 200)
assert.equal(result.cardReceived, 300)
console.log('  ✓ دو Payment با روش/مقصد درست و جمع نقد/کارت نتیجه ثبت شد')

console.log('--- ۳. روش یا مقصد جابه‌جا، حتی با جمع درست رد می‌شود ---')
const invalidKinds = async () => {
  const second = await salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: variant(1_000), qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cashMethod, amount: 1_000, destination: 'CASH' }]
  })
  const secondItem = Number(seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', second.id).id)
  return salesService.createExchange({
    userId,
    shiftId,
    invoiceId: second.id,
    lines: [{ saleItemId: secondItem, qty: 1 }],
    replacements: [{ variantId: variant(1_500), qty: 1 }],
    splitPayment: true,
    payments: [
      { methodId: cashMethod, amount: 200, destination: 'CARD' },
      { methodId: cardMethod, amount: 300, destination: 'CARD' }
    ]
  })
}
await assert.rejects(invalidKinds, /نقدی.*صندوق/)
console.log('  ✓ قرارداد CASH/CARD و مقصدهای واقعی سمت سرور enforce شد')
