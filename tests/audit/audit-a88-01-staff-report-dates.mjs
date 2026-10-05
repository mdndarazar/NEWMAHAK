/**
 * ممیزی A88-01 — StaffReportService.reportRange: خالی ⇒ امروز؛ نیمه‌تایپ‌شده/نامعتبر ⇒ خطای فارسی.
 * قبلاً fromJalali='' کل تاریخچه را می‌خواند، '1405/07/0' روز قبل و '1405/13/01' سال بعد.
 * بخش UI (StaffPerformancePanel): روی تاریخ نامعتبر fetch نمی‌شود و پاسخ کهنه با شماره‌ی درخواست کنار می‌رود
 * (رندر واقعی React اجرا نشد؛ فقط بررسی متن کد — شواهد ضعیف، صریحاً اعلام شده).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, fn, re) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} · رد نشد`) }
  catch (e) { const m = String(e?.message ?? e); if (re.test(m)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} · پیام: ${m}`) } }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a8801-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const p = seed.product('جین', seed.category('پوشاک')); const v1 = seed.variant(p, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A })
await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] })
const old = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] })
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ? WHERE id = ?').run(Date.now() - 3 * 86400_000, old.id)
const cnt = async (f) => (await staffReportService.performance(f)).rows.find((r) => r.userId === A)?.invoiceCount ?? 0
eq("fromJalali='' ⇒ امروز (۱ فاکتور، نه کل تاریخچه ۲)", await cnt({ fromJalali: '', toJalali: today }), 1)
eq("fromJalali='   ' و null ⇒ امروز", [await cnt({ fromJalali: '   ', toJalali: today }), await cnt({ fromJalali: null, toJalali: null })], [1, 1])
eq('تاریخ با ارقام فارسی پذیرفته می‌شود', await cnt({ fromJalali: today.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]), toJalali: today }), 1)
await rejects("'1405/07/0' (نیمه‌تایپ‌شده) ⇒ خطای فارسی", () => staffReportService.performance({ fromJalali: '1405/07/0', toJalali: today }), /معتبر نیست/)
await rejects("'1405/13/01' ⇒ خطای فارسی", () => staffReportService.performance({ fromJalali: today, toJalali: '1405/13/01' }), /معتبر نیست/)
await rejects('transactions هم همان گیت را دارد', () => staffReportService.transactions({ userId: A, fromJalali: '1405/7', toJalali: today }), /معتبر نیست/)
const ui = readFileSync(new URL('../../src/renderer/src/components/StaffPerformancePanel.tsx', import.meta.url), 'utf8')
eq('UI: شماره‌ی درخواست و کنار گذاشتن پاسخ کهنه (متن کد)', [/reqSeq/.test(ui), /seq !== reqSeq\.current\) return/.test(ui), /isValidJalaliDate\(fromJalali\)/.test(ui)], [true, true, true])
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
