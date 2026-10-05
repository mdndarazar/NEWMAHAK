/**
 * نشست ۲۱۴ · M1 — ویرایش برگشت هم بند ۴-۵۲ را روی چک در جریان اجرا می‌کند.
 * صفر بدهی ⇒ void چک PENDING؛ جزئی ⇒ بازبینی. Cash/اعتبار/کارت را لمس نمی‌کند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s214-return-update-cheque-policy.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s214-m1-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

const src = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const start = src.indexOf('async returnUpdate(input: UpdateReturnInput)')
const end = src.indexOf('async returnDelete', start)
const body = start >= 0 && end > start ? src.slice(start, end) : ''

console.log('\n۰) سیم‌کشی')
truthy('returnUpdate remainingBeforeEdit می‌گیرد', body.includes('remainingBeforeEdit'))
truthy('returnUpdate chequePolicyAfterReturn را صدا می‌زند', body.includes('chequePolicyAfterReturn') && body.includes('remainingBefore: remainingBeforeEdit'))
truthy('سیاست چک CashMovement نمی‌سازد', !/CashMovement/.test(body.slice(body.indexOf('chequePolicyAfterReturn'))))

const userId = seed.user('فروشنده برگشت ۲۱۴')
const product = seed.product('کالای برگشت ۲۱۴', seed.category('پوشاک'))
const v1 = seed.variant(product, 'الف')
const v2 = seed.variant(product, 'ب')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 600 WHERE id = ?').run(v1)
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 400 WHERE id = ?').run(v2)
seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })

const saleOf = async () => salesService.create({
  userId, shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 600, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 400, discount: 0, tax: 0 }
  ],
  payments: []
})
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const chqOf = (invoiceId) => sql.prepare(
  'SELECT id, chequeStatus, voidedAt, voidReason FROM "Payment" WHERE invoiceId = ? AND kind = \'CHEQUE\' ORDER BY id DESC LIMIT 1'
).get(invoiceId)

console.log('\nM1) ویرایش برگشت جزئی→کامل ⇒ چک در جریان باطل می‌شود')
const sale = await saleOf()
await salesService.addPayment({
  invoiceId: sale.id, kind: 'CHEQUE', amount: 1000, chequeNo: `C-${sale.id}`, bankName: 'ملت', dueDateJalali: today, userId
})
const items = itemsOf(sale.id)
const ret = await salesService.createReturn({
  invoiceId: sale.id, full: false,
  lines: [{ saleItemId: items[0].id, qty: 1 }],
  refundMethod: 'NONE', userId
})
const retId = ret.id ?? ret.returnId
eq('بعد از برگشت جزئی چک باطل نیست', chqOf(sale.id)?.voidedAt == null, true)

await salesService.returnUpdate({
  id: retId,
  lines: [{ saleItemId: items[0].id, qty: 1 }, { saleItemId: items[1].id, qty: 1 }],
  userId, managerPassword: PW, overrideReason: 'اصلاح برگشت نشست ۲۱۴'
})
const afterFull = chqOf(sale.id)
eq('ویرایش به برگشت کامل چک را باطل کرد', afterFull?.voidedAt != null, true)
truthy('دلیل ابطال به بند ۴-۵۲ اشاره دارد', /۴-۵۲/.test(String(afterFull?.voidReason ?? '')))

console.log('\nM1-جزئی) ویرایش برگشت که بدهی را صفر نکند ⇒ چک در جریان می‌ماند + بازبینی')
const sale2 = await saleOf()
await salesService.addPayment({
  invoiceId: sale2.id, kind: 'CHEQUE', amount: 1000, chequeNo: `C-${sale2.id}`, bankName: 'ملت', dueDateJalali: today, userId
})
const items2 = itemsOf(sale2.id)
const ret2 = await salesService.createReturn({
  invoiceId: sale2.id, full: false,
  lines: [{ saleItemId: items2[0].id, qty: 1 }],
  refundMethod: 'NONE', userId
})
const ret2Id = ret2.id ?? ret2.returnId
await salesService.returnUpdate({
  id: ret2Id,
  lines: [{ saleItemId: items2[0].id, qty: 1 }],
  userId, managerPassword: PW, overrideReason: 'توضیح همان برگشت جزئی'
})
const still = chqOf(sale2.id)
eq('چک جزئی باطل نشد', still?.voidedAt == null && still?.chequeStatus === 'PENDING', true)
const v = await salesService.payments({ invoiceId: sale2.id })
eq('علامت بازبینی بعد از ویرایش جزئی', v?.payments?.find((p) => p.kind === 'CHEQUE')?.chequeNeedsReview, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
