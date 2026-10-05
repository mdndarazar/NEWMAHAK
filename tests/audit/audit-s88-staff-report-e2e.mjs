/**
 * ممیزی نشست ۸۸ — اجرای واقعی StaffReportService روی هارنس (تست fix-s88 فقط regex بود).
 * شواهد: performance/transactions/outOfShift با برگشت موجود crash نمی‌کنند (relation جعلی
 * SaleReturn.user/shift حذف شده)، مصرف اعتبار به کارمندِ مصرف‌کننده نسبت داده می‌شود،
 * و بدون تاریخ فقط «امروز» خوانده می‌شود. A88-01 فقط به‌صورت ⓘ شاهد چاپ می‌شود (هنوز رفع نشده).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s88e2e-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const p = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(p, '32'); const v2 = seed.variant(p, '34')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A })
const invA = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 2, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 2000000, destination: 'CASH' }] })
seed.insert('StoreCredit', { code: 'SC88', amount: 300000, source: 'MANUAL', status: 'ACTIVE', issuedAtJalali: today })
await salesService.create({ userId: B, shiftId, lines: [{ variantId: v2, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 700000, destination: 'CASH' }], storeCreditCode: 'SC88' })
const items = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', invA.id)
await salesService.createReturn({ invoiceId: invA.id, full: false, lines: [{ saleItemId: items[0].id, qty: 1 }], refundMethod: RefundMethod.CASH, refundAmount: 1000000, userId: A })
const old = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] })
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ? WHERE id = ?').run(Date.now() - 3 * 86400_000, old.id)
const perf = await staffReportService.performance({})
const rowA = perf.rows.find((r) => r.userId === A); const rowB = perf.rows.find((r) => r.userId === B)
eq('performance با برگشت موجود crash نمی‌کند و دو ردیف دارد', perf.rows.length, 2)
eq('بدون تاریخ فقط امروز: فاکتور سه روز قبل الف شمرده نشد', rowA?.invoiceCount, 1)
eq('فروش امروز الف ۲٬۰۰۰٬۰۰۰', rowA?.salesTotal, 2000000)
eq('برگشت الف ۱٬۰۰۰٬۰۰۰', rowA?.returnTotal, 1000000)
eq('مصرف اعتبار ۳۰۰٬۰۰۰ فقط به کارمند ب (مصرف‌کننده)', [rowB?.storeCreditUsedCount, rowB?.storeCreditUsedTotal], [1, 300000])
eq('کارمند الف مصرف اعتبار ندارد', rowA?.storeCreditUsedTotal, 0)
const trB = await staffReportService.transactions({ userId: B })
eq('ریز تراکنش ب: یک مصرف اعتبار با کد SC88', trB.creditRedemptions.map((r) => [r.code, r.amount]), [['SC88', 300000]])
const trA = await staffReportService.transactions({ userId: A })
eq('نام شیفت برگشت از lookup اسکالر shiftId', trA.returns.map((r) => r.shiftName), ['صبح'])
seed.setting('shift.config', { byTime: true, templates: [{ name: 'صبح', startTime: '00:00', endTime: '00:01' }] })
const out = await staffReportService.outOfShift({})
eq('outOfShift با برگشت crash نمی‌کند (۲ فروش امروز + ۱ برگشت)', out.rows.length, 3)
eq('نام کارمند برگشت در outOfShift از lookup اسکالر userId', out.rows.filter((r) => r.kind === 'RETURN').map((r) => r.userName), ['فروشنده الف'])
const blank = await staffReportService.performance({ fromJalali: '', toJalali: today })
eq("A88-01 رفع‌شده: fromJalali='' ⇒ امروز (۱ فاکتور الف، نه ۲)", blank.rows.find((r) => r.userId === A)?.invoiceCount, 1)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
