/**
 * نشست ۱۳۸ · خوشه E
 *
 * مسیر main نباید اعشار، NaN، Infinity یا مبلغ منفی را با Math.round به عدد
 * دیگری تبدیل کند. این تست create/update/addPayment را از همان ورودی IPC
 * شبیه‌سازی می‌کند و نبودن side-effect مالی را هم بعد از رفع بررسی می‌کند.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}
const rejectsWith = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · ورودی نامعتبر پذیرفته شد`)
  } catch (error) {
    const message = String(error?.message ?? error)
    eq(label, message.includes(needle), true)
  }
}

eq('validator سخت‌گیرانه برای اعداد مالی اضافه شده است', /assertSafeInteger|Number\.isSafeInteger/.test(source), true)
eq('validator قبل از محاسبه‌ی saleTotals اجرا می‌شود', /function validateSaleInput[\s\S]{0,1800}saleTotals/.test(source), false)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s138-financial-validation-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('فروشنده validation مالی')
const productId = seed.product('کالای validation', seed.category('پوشاک'))
const variantId = seed.variant(productId, 'سایز validation')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 100 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now(),
  userId,
  staffConfirmed: 1
})
const line = (overrides = {}) => ({
  variantId,
  code: 'VAL-1',
  barcode: 'VAL-1',
  name: 'کالای validation',
  qty: 1,
  unitPrice: 100,
  discount: 0,
  tax: 0,
  ...overrides
})
const saleInput = (overrides = {}) => ({
  userId,
  shiftId,
  deductInventory: false,
  lines: [line()],
  payments: [],
  ...overrides
})

const beforeInvoices = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleInvoice"').get().n)
const beforePayments = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "Payment"').get().n)

console.log('\n۱) ثبت فاکتور')
await rejectsWith('qty اعشاری در create رد می‌شود', () => salesService.create(saleInput({ lines: [line({ qty: 1.5 })] })), 'تعداد')
await rejectsWith('قیمت NaN در create رد می‌شود', () => salesService.create(saleInput({ lines: [line({ unitPrice: Number.NaN })] })), 'قیمت')
await rejectsWith('تخفیف منفی در create رد می‌شود', () => salesService.create(saleInput({ lines: [line({ discount: -1 })] })), 'تخفیف')
await rejectsWith('جمع کل منفی در create رد می‌شود', () => salesService.create(saleInput({ invoiceDiscount: 101 })), 'جمع کل')
await rejectsWith(
  'مبلغ پرداختی اعشاری در create رد می‌شود',
  () => salesService.create(saleInput({ payments: [{ methodId: cash, amount: 1.5, destination: 'CASH' }] })),
  'مبلغ پرداختی'
)
await rejectsWith(
  'مبلغ پرداختی منفی در create رد می‌شود',
  () => salesService.create(saleInput({ payments: [{ methodId: cash, amount: -10, destination: 'CASH' }] })),
  'مبلغ پرداختی'
)
eq('create نامعتبر هیچ فاکتوری نساخته است', beforeInvoices(), 0)
eq('create نامعتبر هیچ پرداختی نساخته است', beforePayments(), 0)

const valid = await salesService.create(saleInput())
const invoicesAfterValid = beforeInvoices()
const paymentsAfterValid = beforePayments()

console.log('\n۲) ویرایش فاکتور و پرداخت مرحله‌ای')
await rejectsWith(
  'qty اعشاری در update رد می‌شود',
  () => salesService.update({ ...saleInput(), id: valid.id, lines: [line({ qty: 1.25 })] }),
  'تعداد'
)
await rejectsWith(
  'مبلغ اعشاری در addPayment رد می‌شود',
  () => salesService.addPayment({ invoiceId: valid.id, userId, methodId: cash, amount: 1.25, destination: 'CASH' }),
  'مبلغ پرداختی'
)
eq('mutation نامعتبر بعد از فاکتور معتبر فاکتور تازه نساخته است', beforeInvoices(), invoicesAfterValid)
eq('mutation نامعتبر بعد از فاکتور معتبر پرداخت تازه نساخته است', beforePayments(), paymentsAfterValid)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
