/**
 * ممیزی نشست ۷۳ · A73-01/02/03 — override «مبلغ کامل بدون کسر تخفیف» (بند ۴-۱۱).
 *
 * مثال خود بند ۴-۱۱: دو کالای ۱٬۰۰۰٬۰۰۰ با ۱۰٪ تخفیف کل فاکتور، مشتری ۱٬۸۰۰٬۰۰۰ پرداخته.
 *  • برگشت عادی یک کالا = ۹۰۰٬۰۰۰.
 *  • مدیر با رمز و دلیل ⇒ ۱٬۰۰۰٬۰۰۰ نقد (مجاز، کمتر از پول دریافتی).
 *  • A73-02: بعد از آن، مانده‌ی بدهی مشتری نباید «۱۰۰٬۰۰۰ بدهکار» شود (بدهی کاذب).
 *  • A73-01: برگشت کالای دوم با override ⇒ ۱٬۰۰۰٬۰۰۰ درخواست، ولی فقط ۸۰۰٬۰۰۰ از پول
 *    مشتری مانده ⇒ رد (قبل از رفع: ۲٬۰۰۰٬۰۰۰ از کشو بیرون می‌رفت در برابر ۱٬۸۰۰٬۰۰۰ دریافتی).
 *  • A73-01: فاکتور نسیه‌ی پرداخت‌نشده + override نقدی ⇒ بازپرداخت تا پولِ واقعاً
 *    دریافت‌شده محدود می‌شود؛ پس صفر است و سند بدهی پنهان یا خروج نقد نمی‌سازد (S194).
 *  • A73-03: دلیل مدیر عیناً در Audit بنشیند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'mahak-audit-a73-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
let ok = 0, bad = 0
const eq = (l, g, w) => { if (g === w) { ok++; console.log(`  ✓ ${l} = ${JSON.stringify(w)}`) } else { bad++; console.log(`  ✗ ${l} · دریافت ${JSON.stringify(g)} · انتظار ${JSON.stringify(w)}`) } }
const attempt = async (fn) => { try { return { value: await fn() } } catch (e) { return { error: e } } }

const userId = seed.user('مدیر ممیزی ۷۳')
const product = seed.product('شلوار جین', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 3_600_000, userId })
const shiftId = Number(seed.one('SELECT id FROM "Shift" LIMIT 1').id)
const v1 = seed.variant(product, 'سایز ۳۰'); const v2 = seed.variant(product, 'سایز ۳۲')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000000').run()
const items = (id) => seed.all ? null : null
const itemIds = (invoiceId) => sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id').all(invoiceId).map((r) => Number(r.id))
const drawerOut = () => Number(sql.prepare(`SELECT COALESCE(SUM(amount),0) AS n FROM "CashMovement" WHERE type <> 'OPENING_FLOAT'`).get().n)

const inv = await salesService.create({
  userId, shiftId,
  lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }, { variantId: v2, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }],
  invoiceDiscount: 200000, discountTotal: 200000, orderDiscount: 200000,
  payments: [{ methodId: cash, amount: 1800000, destination: 'CASH' }]
})
const g = sql.prepare('SELECT grandTotal, paidTotal FROM "SaleInvoice" WHERE id = ?').get(inv.id)
eq('پیش‌شرط: جمع فاکتور ۱٬۸۰۰٬۰۰۰', Number(g.grandTotal), 1800000)
const [i1, i2] = itemIds(inv.id)
const pw = { managerFullRefund: true, managerPassword: DEFAULT_MANAGER_PASSWORD, overrideReason: 'رضایت مشتری طبق دستور مالک', userId }

const r1 = await salesService.createReturn({ invoiceId: inv.id, full: false, lines: [{ saleItemId: i1, qty: 1 }], refundMethod: RefundMethod.CASH, ...pw })
eq('override کالای اول: ۱٬۰۰۰٬۰۰۰ نقد', Number(r1.refundAmount), 1000000)
const audit = sql.prepare(`SELECT note FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? AND action = 'RETURN_REFUND' ORDER BY id DESC LIMIT 1`).get(r1.id)
eq('A73-03: دلیل مدیر در Audit', String(audit?.note ?? '').includes('رضایت مشتری طبق دستور مالک'), true)
const debt1 = await salesService.payments({ invoiceId: inv.id })
const rem1 = Number(debt1?.remaining)
eq('A73-02: بعد از override، مشتری بدهکار نمی‌شود (مانده ۰)', rem1, 0)

const r2 = await attempt(() => salesService.createReturn({ invoiceId: inv.id, full: false, lines: [{ saleItemId: i2, qty: 1 }], refundMethod: RefundMethod.CASH, ...pw }))
eq('A73-01: override دوم بیش از پول باقی‌مانده‌ی مشتری رد شد', !!r2.error, true)
eq('A73-01: پیام فارسی توضیح می‌دهد override فقط کسر تخفیف را برمی‌دارد', /کسر تخفیف/.test(String(r2.error?.message ?? '')), true)
eq('A73-01: کل خروج نقد از کشو تا اینجا ۱٬۰۰۰٬۰۰۰ (≤ ۱٬۸۰۰٬۰۰۰ دریافتی)', Math.abs(drawerOut()), 1000000)

// فاکتور نسیه‌ی کاملاً پرداخت‌نشده
const credit = await salesService.create({ userId, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 100000, tax: 0 }], payments: [] })
const [c1] = itemIds(credit.id)
const before = drawerOut()
const r3 = await attempt(() => salesService.createReturn({ invoiceId: credit.id, full: false, lines: [{ saleItemId: c1, qty: 1 }], refundMethod: RefundMethod.CASH, ...pw }))
eq('A73-01: override نقدی روی نسیه‌ی پرداخت‌نشده ثبت شد اما ردِ پولی نساخت', !!r3.error, false)
eq('A73-01: بازپرداخت نقدی فقط تا پول واقعاً دریافت‌شده سقف شد', Number(r3.value?.refundAmount ?? -1), 0)
eq('A73-01: هیچ پولی از کشو خارج نشد', drawerOut(), before)
console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
