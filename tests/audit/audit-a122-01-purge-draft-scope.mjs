/**
 * ممیزی A122-01 (P2، مخرب، AUDIT-D59) — دروازه‌ی DRAFT در پاک‌سازی (مشاهده‌ی باز A109، D53).
 * قبل: پیش‌نمایش از reportRows می‌خواند (S122: DRAFT و CANCELED بیرون) ولی purge و purgeStockPlan فقط
 *   CANCELED را کنار می‌گذاشتند ⇒ فاکتور DRAFT قدیمی بازه در پیش‌نمایش نبود (۱ فاکتور · ۱٬۰۰۰) ولی باطل می‌شد
 *   و قلم‌هایش (۲ عدد) در «برگشت به انبار» پیش‌نمایش می‌آمد و با restoreStock موجودی را ۲ عدد *بیشتر* می‌کرد
 *   (کالای شبح: پیش‌نویس هرگز فروش تکمیل‌شده نبود؛ کسری انبار پنهان می‌شد).
 * بعد: purge/purgeStockPlan همان دروازه‌ی REPORT_EXCLUDED_SALE_STATUSES گزارش را دارند؛ پیش‌نمایش = عملیات.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a12201-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const user = seed.user('کارمند')
const product = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(product, '۳۲'); const v2 = seed.variant(product, '۳۴')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const stock = (id) => seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id).stock
const attempt = async (fn) => { try { await fn(); return '' } catch (e) { return String(e.message) } }
const live = await salesService.create({ userId: user, lines: [{ variantId: v1, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
eq('فروش واقعی: موجودی v1 = ۹', stock(v1), 9)
// پیش‌نویس قدیمی (داده‌ی تاریخی؛ کد فعلی DRAFT نمی‌سازد) با قلم ۲ عدد v2 که هرگز از انبار کم نشده
const draft = seed.insert('SaleInvoice', { userId: user, receiptNo: 9001, status: 'DRAFT', orderType: 'IN_STORE', issuedAt: Date.now() - 60_000, issuedAtJalali: today, goodsTotal: 2000, grandTotal: 2000, paidTotal: 0, discountTotal: 0, deductInventory: 1 })
seed.insert('SaleInvoiceItem', { invoiceId: draft, variantId: v2, qty: 2, unitPrice: 1000, lineTotal: 2000 })

const prev = await salesService.purgePreview({ fromJalali: today, toJalali: today })
eq('پیش‌نمایش: فقط فاکتور واقعی (DRAFT نیست)', prev.rows.map((r) => r.id), [live.id])
eq('پیش‌نمایش: برگشت به انبار فقط v1 × ۱', prev.restoreLines.map((l) => [l.variantId, l.qty]), [[v1, 1]])
eq('پیش‌نمایش: restoreQty = ۱', prev.restoreQty, 1)

const selDraft = await attempt(() => salesService.purge({ invoiceIds: [draft], restoreStock: true, userId: user, managerVerified: true }))
eq('انتخابی: پیش‌نویس ⇒ رد با پیام «پیدا نشدند یا قبلاً باطل/لغو»', /پیدا نشدند/.test(selDraft), true)
eq('انتخابی: پیش‌نویس باطل نشد', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', draft).voidedAt, null)
eq('انتخابی: موجودی v2 دست‌نخورده ۱۰', stock(v2), 10)

const res = await attempt(() => salesService.purge({ fromJalali: today, toJalali: today, restoreStock: true, userId: user, managerVerified: true }))
eq('بازه‌ای: purge اجرا شد', res, '')
eq('بازه‌ای: فاکتور واقعی باطل شد', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', live.id).voidedAt != null, true)
eq('بازه‌ای: پیش‌نویس (خارج از پیش‌نمایش) باطل نشد', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', draft).voidedAt, null)
eq('بازه‌ای: موجودی v1 به ۱۰ برگشت', stock(v1), 10)
eq('بازه‌ای: v2 کالای شبح نگرفت (۱۰، نه ۱۲)', stock(v2), 10)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
