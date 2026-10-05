/**
 * نشست ۶۶ — بند ۴-۲۲: ابطال پرداخت به‌جای حذف فیزیکی.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s66-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { returnReceiptHtml } = await import('../../src/main/print/templates.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const userId = seed.user('مدیر تست ابطال پرداخت')
const product = seed.product('کالای تست', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3_600_000, userId })
let ok = 0
let bad = 0
const eq = (label, got, want) => got === want ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`))
const truthy = (label, value) => value ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`))
const rejects = async (label, fn, text) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — رد نشد`) }
  catch (e) { String(e?.message ?? e).includes(text) ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)) }
}
const inv = await salesService.create({
  userId, shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})
const payment = seed.one('SELECT * FROM "Payment" WHERE invoiceId = ?', inv.id)
const result = await salesService.deletePayment({ id: payment.id, userId, reason: 'ثبت اشتباه پرداخت', managerPassword: PW, overrideReason: 'ثبت اشتباه پرداخت' })
const row = seed.one('SELECT * FROM "Payment" WHERE id = ?', payment.id)
eq('نتیجه ابطال را اعلام می‌کند', result.voided, true)
truthy('ردیف Payment حذف فیزیکی نشده', row)
truthy('مهر زمان ابطال ثبت شده', row?.voidedAt != null)
eq('کاربر ابطال ثبت شده', Number(row?.voidedByUserId), userId)
eq('دلیل ابطال ثبت شده', row?.voidReason, 'ثبت اشتباه پرداخت')
eq('بدهی پس از ابطال به کل فاکتور برگشت', result.remaining, 1000)
eq('پرداخت باطل‌شده در پنجره پرداخت‌ها نیست', (await salesService.payments({ invoiceId: inv.id })).payments.length, 0)
eq('Audit ابطال ثبت شده', seed.rows(`SELECT id FROM "AuditLog" WHERE entity = 'Payment' AND entityId = ? AND action = 'VOID'`, payment.id).length, 1)
await rejects('ابطال دوباره رد می‌شود', () => salesService.deletePayment({ id: payment.id, userId }), 'قبلاً باطل')
const html = returnReceiptHtml({
  returnId: 7, sourceReceiptNo: 1001, dateJalali: today, time: '12:00:00',
  items: [], total: 0, refundMethod: 'NONE', refundMethodLabel: 'بدون بازپرداخت',
  refundAmount: 0, restocked: false, restockedQty: 0, voidedAt: new Date(), voidReason: 'ثبت اشتباه برگشت'
})
truthy('رسید سند باطل را واضح چاپ می‌کند', html.includes('باطل') && html.includes('ثبت اشتباه برگشت'))
const svc = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
truthy('مسیر deletePayment دیگر حذف فیزیکی ندارد', !/async deletePayment[\s\S]{0,5000}payment\.delete\(/.test(svc))
console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
