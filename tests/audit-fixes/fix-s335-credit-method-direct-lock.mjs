// @ts-check
/**
 * PaymentKind.CREDIT «نسیه» است، نه پرداخت پول: تمام ورودی‌های عمومی باید آن را
 * رد کنند و تنها فروش نسیه با مبلغ پرداختی کمتر/صفر باقی بماند.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s335-credit-method-direct-lock.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s335-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('قفل اعتبار تست')
const categoryId = seed.category('کالای تست')
const productId = seed.product('کفش تست', categoryId)
const variantId = seed.variant(productId, '۴۰')
sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(10, 1_000, variantId)
const cashMethod = seed.insert('PaymentMethod', { key: 'S335-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const creditMethod = seed.insert('PaymentMethod', { key: 'S335-CREDIT', label: 'اعتباری قدیمی', kind: 'CREDIT', isActive: 1, sortOrder: 2 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'شیفت تست', number: 1, dayJalali: today, openedAt: Date.now(), userId })
const line = { variantId, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}

console.log('--- ۱. روش CREDIT پرداخت اولیه نمی‌سازد ---')
const invoicesBefore = seed.count('SaleInvoice')
const createError = await errorOf(() => salesService.create({
  userId, shiftId, lines: [line], payments: [{ methodId: creditMethod, amount: 1_000, destination: 'CASH' }]
}))
assert.match(createError ?? '', /اعتباری|اعتبار خرید|نسیه/, 'پرداخت اولیه با روش CREDIT باید پیش از ثبت رد شود')
assert.equal(seed.count('SaleInvoice'), invoicesBefore, 'فاکتور نیمه‌کاره با روش CREDIT ساخته نشد')
console.log('  ✓ ایجاد فروش مستقیم با CREDIT بسته است')

const cashSale = await salesService.create({
  userId, shiftId, lines: [line], payments: [{ methodId: cashMethod, amount: 1_000, destination: 'CASH' }]
})
const cashPayment = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ? ORDER BY id', cashSale.id)

console.log('--- ۲. add/update Payment نیز CREDIT را رد می‌کنند ---')
const countBefore = seed.count('Payment', 'invoiceId = ?', cashSale.id)
const addError = await errorOf(() => salesService.addPayment({
  userId, invoiceId: cashSale.id, amount: 100, methodId: creditMethod, destination: 'CASH'
}))
assert.match(addError ?? '', /اعتباری|اعتبار خرید|نسیه/)
assert.equal(seed.count('Payment', 'invoiceId = ?', cashSale.id), countBefore, 'رد شدن addPayment هیچ رکوردی ننوشت')
const updateError = await errorOf(() => salesService.updatePayment({
  id: cashPayment.id,
  userId,
  methodId: creditMethod,
  destination: 'CASH',
  managerPassword: DEFAULT_MANAGER_PASSWORD,
  overrideReason: 'تست قفل CREDIT'
}))
assert.match(updateError ?? '', /اعتباری|اعتبار خرید|نسیه/)
assert.equal(seed.one('SELECT methodId FROM "Payment" WHERE id = ?', cashPayment.id).methodId, cashMethod,
  'رد شدن updatePayment روش پرداخت سالم را عوض نکرد')
console.log('  ✓ mutationهای پرداخت نیز fail-closed ماندند')

console.log('--- ۳. UI روش CREDIT را انتخاب‌پذیر نشان نمی‌دهد ---')
const service = readFileSync('src/main/services/SalesService.ts', 'utf8')
const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
const wholesale = readFileSync('src/renderer/src/pages/SalesInvoice.tsx', 'utf8')
const payments = readFileSync('src/renderer/src/components/InvoicePaymentsModal.tsx', 'utf8')
assert.match(service, /kind === PaymentKind\.CREDIT/)
assert.match(pos, /directPaymentMethods/)
assert.match(wholesale, /\['CREDIT', 'STORE_CREDIT', 'EXCHANGE_CREDIT'\]/)
assert.match(payments, /isDirectPaymentMethod/)
console.log('  ✓ UI فقط روش‌های وصول مستقیم را پیشنهاد می‌دهد')

console.log('\nنتیجه: CREDIT در تمام مسیرهای عادی فروش/پرداخت قفل است.')
