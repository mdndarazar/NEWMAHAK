// @ts-check
/**
 * پرداخت ترکیبی اعتبار باید feature flag پایدار، مدیر-محور و مهم‌تر از UI داشته باشد.
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s337-split-credit-feature-flag.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s337-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { DEFAULT_MANAGER_PASSWORD, parseSaleDefaults } = await import('../../src/shared/receipt.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر تست فلگ پرداخت ترکیبی')
const categoryId = seed.category('دسته تست')
const productId = seed.product('کالای تست', categoryId)
const variantId = seed.variant(productId, 'تک')
sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(10, 1_000, variantId)
const cashMethod = seed.insert('PaymentMethod', { key: 'S337-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'شیفت تست', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now(), userId
})
const sale = () => ({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cashMethod, amount: 1_000, destination: 'CASH' }]
})
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}

console.log('--- ۱. پیش‌فرض سازگار است و false صریح پایدار می‌ماند ---')
assert.equal(parseSaleDefaults(null).splitStoreCreditPayment, true, 'دادهٔ قدیمی باید رفتار فعلی (روشن) را نگه دارد')
assert.equal(parseSaleDefaults({ splitStoreCreditPayment: false }).splitStoreCreditPayment, false)
const current = await settingsService.saleDefaults()
assert.equal(current.splitStoreCreditPayment, true)
await settingsService.saveBundle({
  sale: { ...current, splitStoreCreditPayment: false },
  managerPassword: DEFAULT_MANAGER_PASSWORD,
  userId
})
assert.equal((await settingsService.saleDefaults()).splitStoreCreditPayment, false, 'تنظیم مدیر ذخیره شد')
console.log('  ✓ feature flag پیش‌فرض روشن و قابل تغییر مدیر است')

console.log('--- ۲. main مقدار دلخواه را با فلگ خاموش، پیش از ایجاد سند رد می‌کند ---')
const before = seed.count('SaleInvoice')
const rejected = await errorOf(() => salesService.create({ ...sale(), storeCreditAmount: 400 }))
assert.match(rejected ?? '', /پرداخت ترکیبی اعتبار خرید.*خاموش/)
assert.equal(seed.count('SaleInvoice'), before, 'درخواست دورزنندهٔ UI هیچ فاکتوری ایجاد نکرد')
const ordinary = await salesService.create(sale())
assert.ok(ordinary.id > 0, 'فروش عادی بدون مبلغ دلخواه اعتبار دست‌نخورده ماند')
console.log('  ✓ گیت server-side است و فروش معمولی را تغییر نمی‌دهد')

console.log('--- ۳. renderer مقدار درخواست را هنگام خاموشی null می‌فرستد ---')
const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
const settings = readFileSync('src/renderer/src/pages/Settings.tsx', 'utf8')
const service = readFileSync('src/main/services/SalesService.ts', 'utf8')
assert.match(pos, /const splitStoreCreditPayment = settings\.sale\.splitStoreCreditPayment !== false/)
assert.match(pos, /requestedInput: effectiveCreditRequested/)
assert.match(pos, /storeCreditAmount: creditCode\.trim\(\) \? \(effectiveCreditRequested == null \? null : creditApplied\) : null/)
assert.match(settings, /splitStoreCreditPayment/)
assert.match(service, /input\.storeCreditAmount != null && defaults\.splitStoreCreditPayment === false/)
assert.match(service, /idempotencyKey:\s*String\(input\.storeCreditIdempotencyKey/)
assert.match(service, /assertSafeInteger\(value, label, 0\)/)
console.log('  ✓ UI، اعتبارسنجی server و idempotency همگی متصل‌اند')

console.log('\nنتیجه: پرداخت ترکیبی اعتبار با feature flag مدیر کنترل و سمت server محافظت می‌شود.')
