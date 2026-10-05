/**
 * ممیزی نشست ۶۹ · A69-01 — موجودی اول ثبت‌شده نباید در لحظه‌ی بستن/پیش‌نمایش
 * با عدد دستی جایگزین شود (راه پنهان کردن کسری). + A69-02: اتمیک بودن واقعی
 * بستن صندوق وقتی نوشتن Audit شکست می‌خورد (تست edge که نشست ۶۹ نداشت).
 *
 * مثال عددی: موجودی اول ثبت‌شده ۵۰۰، فروش نقد ۱٬۰۰۰ ⇒ نقد مورد انتظار ۱٬۵۰۰.
 * فروشنده ۳۰۰ برمی‌دارد و ۱٬۲۰۰ می‌شمارد. اگر موجودی اول را در فرم بستن ۲۰۰ بزند،
 * قبل از رفع ⇒ انتظار ۱٬۲۰۰ و «تطبیق کامل» (دزدی پنهان). بعد از رفع ⇒ رد با پیام فارسی.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-audit-a69-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const attempt = async (fn) => { try { return { value: await fn() } } catch (e) { return { error: e } } }

const user = seed.user('کارمند ممیزی ۶۹')
const product = seed.product('کالای ممیزی ۶۹', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 60_000, userId: user })
await salesService.create({
  userId: user, shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})

// --- A69-02: شکست Audit ⇒ هیچ CashSession/موجودی اولی باقی نماند ---
sql.exec(`CREATE TRIGGER audit_fail BEFORE INSERT ON "AuditLog" WHEN NEW.action = 'CASH_CLOSE' BEGIN SELECT RAISE(ABORT, 'audit down'); END`)
const failed = await attempt(() => cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, countedCash: 1500, closeShift: false }))
eq('A69-02: بستن با شکست Audit خطا داد', !!failed.error, true)
eq('A69-02: CashSession نیمه‌کاره نماند', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 0)
eq('A69-02: موجودی اول هم rollback شد', sql.prepare(`SELECT COUNT(*) AS n FROM "CashMovement" WHERE type = 'OPENING_FLOAT'`).get().n, 0)
sql.exec('DROP TRIGGER audit_fail')

// بستن اول: موجودی اول ۵۰۰ ثبت می‌شود و تطبیق کامل
const first = await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, countedCash: 1500, closeShift: false })
eq('بستن اول: انتظار ۱٬۵۰۰', first.session.expectedCash, 1500)
eq('موجودی اول ۵۰۰ یک‌بار ثبت شد', sql.prepare(`SELECT SUM(amount) AS s FROM "CashMovement" WHERE type = 'OPENING_FLOAT'`).get().s, 500)

// --- A69-01: فروشنده ۳۰۰ برداشته؛ موجودی اول را ۲۰۰ می‌زند ---
const prev = await attempt(() => cashboxService.expected({ shiftId, countedCash: 1200, openingFloat: 200 }))
eq('A69-01: پیش‌نمایش با موجودی اول جعلی رد شد', !!prev.error, true)
eq('A69-01: پیام پیش‌نمایش فارسی و با مبلغ ثبت‌شده', /موجودی اول[\s\S]*۵۰۰/.test(String(prev.error?.message ?? '')), true)
const tamper = await attempt(() => cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 200, countedCash: 1200, allowRepeatClose: true, closeShift: false }))
eq('A69-01: بستن با موجودی اول جعلی رد شد', !!tamper.error, true)
eq('A69-01: سند بستن جعلی ساخته نشد', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 1)
const zero = await attempt(() => cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 0, countedCash: 1000, allowRepeatClose: true, closeShift: false }))
eq('A69-01: صفر کردن موجودی اول هم رد شد', !!zero.error, true)

// همان عدد ثبت‌شده یا خالی ⇒ کسری واقعی ۳۰۰ دیده می‌شود
const honest = await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, countedCash: 1200, allowRepeatClose: true, closeShift: false })
eq('با عدد ثبت‌شده: انتظار ۱٬۵۰۰', honest.session.expectedCash, 1500)
eq('با عدد ثبت‌شده: کسری ۳۰۰ دیده می‌شود', honest.session.cashDifference, -300)
const blank = await cashboxService.expected({ shiftId, countedCash: 1200 })
eq('بدون ورودی: از رکورد ثبت‌شده خوانده می‌شود', blank.components?.openingFloat ?? blank.openingFloat, 500)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
