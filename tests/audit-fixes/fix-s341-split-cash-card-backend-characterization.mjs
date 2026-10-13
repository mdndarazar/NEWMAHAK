// @ts-check
/**
 * فاز ۰ — ثبت رفتار واقعی backend برای پرداخت چندردیفه.
 *
 * این تست نشان می‌دهد هسته از CASH + CARD مستقل پشتیبانی می‌کند، اما در baseline
 * فعلی کمبود مبلغ بدون allowPartial و retry یکسان بدون idempotency فاکتور پذیرفته
 * می‌شوند. این‌ها assertionهای characterization هستند، نه رفتار مطلوب فاز ۷.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-s341-split-cash-card-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('مدیر تست پرداخت نقد و کارت')
const categoryId = seed.category('دسته پرداخت ترکیبی')
const productId = seed.product('کالای پرداخت ترکیبی', categoryId)
const variantId = seed.variant(productId, 'تک')
sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(20, 1_000, variantId)
const cashMethod = seed.insert('PaymentMethod', { key: 'S341-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cardMethod = seed.insert('PaymentMethod', { key: 'S341-CARD', label: 'کارت', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', {
  name: 'شیفت تست پرداخت ترکیبی', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now(), userId
})

const input = (payments) => ({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }],
  payments
})

console.log('--- ۱. CASH + CARD دو Payment مستقل و مقصد مستقل می‌سازند ---')
const settled = await salesService.create(input([
  { methodId: cashMethod, amount: 400, destination: 'CASH' },
  { methodId: cardMethod, amount: 600, destination: 'CARD' }
]))
const rows = seed.rows('SELECT amount, destination, methodId FROM "Payment" WHERE invoiceId = ? ORDER BY id', settled.id)
assert.deepEqual(rows.map((p) => [Number(p.amount), p.destination, Number(p.methodId)]), [
  [400, 'CASH', cashMethod],
  [600, 'CARD', cardMethod]
])
console.log('  ✓ هسته از تقسیم واقعی نقد + کارت پشتیبانی می‌کند')

console.log('--- ۲. baseline فعلی کمبود مبلغ را بدون پرچم صریح نسیه می‌پذیرد ---')
const partial = await salesService.create(input([
  { methodId: cashMethod, amount: 400, destination: 'CASH' },
  { methodId: cardMethod, amount: 500, destination: 'CARD' }
]))
const partialInvoice = seed.one('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?', partial.id)
const partialReceived = seed.one('SELECT COALESCE(SUM(amount), 0) AS total FROM "Payment" WHERE invoiceId = ?', partial.id)
assert.equal(Number(partialInvoice?.grandTotal), 1_000)
assert.equal(Number(partialReceived?.total), 900)
console.log('  ✓ characterization: کسری ۱۰۰ بدون allowPartial صریح ثبت شد (فاز ۷ باید تصمیم مالک را اعمال کند)')

console.log('--- ۳. درخواست split صریح، کمبود و مقصد/روش نادرست را سمت server رد می‌کند ---')
await assert.rejects(
  () => salesService.create({ ...input([{ methodId: cashMethod, amount: 400, destination: 'CASH' }, { methodId: cardMethod, amount: 500, destination: 'CARD' }]), splitPayment: true }),
  /کمتر است|نسیه/
)
await assert.rejects(
  () => salesService.create({ ...input([{ methodId: cashMethod, amount: 400, destination: 'CARD' }, { methodId: cardMethod, amount: 600, destination: 'CARD' }]), splitPayment: true }),
  /نقدی.*صندوق/
)
console.log('  ✓ گارد split فقط مسیر جدید را سخت‌گیر می‌کند؛ فروش قدیمی تغییر نکرد')

console.log('--- ۴. baseline فعلی retry یکسان را فاکتور جدید می‌داند ---')
const sameRequest = input([
  { methodId: cashMethod, amount: 500, destination: 'CASH' },
  { methodId: cardMethod, amount: 500, destination: 'CARD' }
])
const before = seed.count('SaleInvoice')
await salesService.create(sameRequest)
await salesService.create(sameRequest)
assert.equal(seed.count('SaleInvoice'), before + 2, 'بدون clientRequestId، دو ارسال یکسان دو فاکتور می‌سازند')
console.log('  ✓ characterization: idempotency سطح فاکتور هنوز وجود ندارد')

console.log('\nنتیجه: backend آمادهٔ payments[] است؛ فاز ۷ باید فقط UI و گاردهای تصمیم‌گرفته‌شده را بیفزاید.')
