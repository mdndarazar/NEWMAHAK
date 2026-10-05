/**
 * ممیزی A85 — پاک‌سازی گزارش فروش بعد از تبدیل به void (S85).
 * A85-01 (P1): فاکتور باطل/لغوشده دوباره «پاک‌سازی» می‌شد و با restoreStock موجودی
 *   دوباره برمی‌گشت (فروش ۱ عدد ⇒ دو پاک‌سازی ⇒ موجودی +۲). چون S85 حذف فیزیکی را
 *   به void تبدیل کرد، سند دیگر ناپدید نمی‌شود و بار دوم هم پیدا می‌شود.
 * A85-02 (P1): قفل دوره فقط روی «از تاریخ» (یا امروز در پاک‌سازی انتخابی) سنجیده
 *   می‌شد ⇒ فاکتور دیروزِ صندوق‌بسته با انتخاب تکی بدون رمز/دلیل باطل می‌شد و نقد
 *   مورد انتظار روز بسته بی‌ردپا کم می‌شد.
 * A85-03 (P1): اعتبار خریدِ صادرشده از اضافه‌دریافت همان فاکتور (sourceInvoiceId)
 *   بعد از ابطال فاکتور و پرداختش فعال می‌ماند ⇒ کالا با اعتباری که پولش باطل شده.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a85-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const yesterday = toJalaliDate(new Date(Date.now() - 86400000))
const user = seed.user('کارمند')
const product = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(product, '۳۲'); const v2 = seed.variant(product, '۳۴'); const v3 = seed.variant(product, '۳۶')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const stock = (id) => seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id).stock
const sale = (v, extra = {}) => salesService.create({ userId: user, lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }], ...extra })
const attempt = async (fn) => { try { await fn(); return '' } catch (e) { return String(e.message) } }

// A85-01
const inv1 = await sale(v1)
eq('بعد از فروش موجودی ۹', stock(v1), 9)
await salesService.purge({ invoiceIds: [inv1.id], restoreStock: true, userId: user })
eq('پاک‌سازی اول موجودی را ۱۰ کرد', stock(v1), 10)
const again = await attempt(() => salesService.purge({ invoiceIds: [inv1.id], restoreStock: true, userId: user }))
eq('پاک‌سازی دوباره‌ی فاکتور باطل رد شد', again.length > 0, true)
eq('موجودی دوباره برنگشت (بدون کالای شبح)', stock(v1), 10)
const rangeAgain = await attempt(() => salesService.purge({ fromJalali: today, toJalali: today, restoreStock: true, userId: user }))
eq('پاک‌سازی بازه‌ای فقط فاکتور باطل ⇒ رد', rangeAgain.length > 0, true)
eq('بازه‌ای هم موجودی را دوباره اضافه نکرد', stock(v1), 10)

// A85-02
const inv2 = await sale(v2)
const yStart = jalaliStartOfDay(yesterday).getTime()
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(yStart + 12 * 3600_000, yesterday, inv2.id)
sql.prepare('UPDATE "Payment" SET paidAt = ?, createdAt = ? WHERE invoiceId = ?').run(yStart + 12 * 3600_000, yStart + 12 * 3600_000, inv2.id)
seed.insert('CashSession', { fromDate: yStart + 8 * 3600_000, toDate: yStart + 22 * 3600_000, dayJalali: yesterday, closedAt: yStart + 22 * 3600_000, createdAt: yStart + 22 * 3600_000 })
const locked = await attempt(() => salesService.purge({ invoiceIds: [inv2.id], restoreStock: false, userId: user }))
eq('ابطال انتخابی فاکتور روزِ بسته بدون رمز/دلیل رد شد', /دوره/.test(locked), true)
eq('فاکتور روز بسته باطل نشد', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', inv2.id).voidedAt, null)
eq('پرداخت روز بسته باطل نشد', seed.one('SELECT voidedAt FROM "Payment" WHERE invoiceId = ?', inv2.id).voidedAt, null)
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const okLocked = await attempt(() => salesService.purge({ invoiceIds: [inv2.id], restoreStock: false, userId: user, managerPassword: DEFAULT_MANAGER_PASSWORD, overrideReason: 'فاکتور آزمایشی دیروز' }))
eq('با رمز مدیر و دلیل، ابطال روز بسته انجام شد', okLocked, '')
eq('override دوره‌ی بسته در Audit ثبت شد', Number(seed.one(`SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = 'CLOSED_PERIOD_OVERRIDE'`).n) >= 1, true)

// A85-03
const inv3 = await sale(v3)
const cr = seed.insert('StoreCredit', { code: 'OVR-A85', amount: 300, source: 'OVERPAY', status: 'ACTIVE', sourceInvoiceId: inv3.id, issuedAtJalali: today })
await salesService.purge({ invoiceIds: [inv3.id], restoreStock: true, userId: user })
const c = seed.one('SELECT status, voidedAt FROM "StoreCredit" WHERE id = ?', cr)
eq('اعتبار اضافه‌دریافتِ فاکتور باطل‌شده هم باطل شد', c.voidedAt != null, true)
const cr2 = seed.insert('StoreCredit', { code: 'OVR-A85-2', amount: 300, usedAmount: 100, source: 'OVERPAY', status: 'ACTIVE', sourceInvoiceId: (await sale(v3)).id, issuedAtJalali: today })
const srcInv = seed.one('SELECT sourceInvoiceId AS id FROM "StoreCredit" WHERE id = ?', cr2).id
const used = await attempt(() => salesService.purge({ invoiceIds: [srcInv], restoreStock: true, userId: user }))
eq('اعتبار مصرف‌شده‌ی همان فاکتور ⇒ رد و ارجاع به رسیدگی مدیر', /مصرف/.test(used), true)
eq('فاکتور با اعتبار مصرف‌شده باطل نشد', seed.one('SELECT voidedAt FROM "SaleInvoice" WHERE id = ?', srcInv).voidedAt, null)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
