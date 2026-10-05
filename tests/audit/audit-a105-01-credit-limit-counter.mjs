/**
 * ممیزی نشست ۱۰۵ — reportLimits، ردیف «نسیه».
 * A105-01 (P2): شمارنده‌ی سقف نسیه = saleInvoice.count({...saleWhere(filter)}) یعنی همه‌ی فاکتورهای بازه (حتی
 *   تسویه‌شده)، ولی جدول تب (SalesService.creditList) فقط فاکتورهای دارای مانده را می‌آورد (مگر includeSettled)،
 *   بازه را همیشه از تاریخ می‌گیرد و «وضعیت» نوار را نمی‌خواند ⇒ ۶٬۰۰۰ فاکتور نقدی بی‌نسیه ⇒ نوار قرمز کاذب
 *   «نسیه: نمایش ۵٬۰۰۰ از ۶٬۰۰۰» روی همه‌ی تب‌ها. معیار: برای یک فیلتر، شمارنده = creditList(f).page.totalCount.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10501-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { reportLimitsService } = await import('../../src/main/services/reportLimits.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const p = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(p, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A })
const line = [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }]
// ۳ فاکتور تسویه‌شده با پرداخت نقدی (createdByUserId، voidedAt=null) + ۱ فاکتور نسیه
for (let i = 0; i < 3; i++)
  await salesService.create({ userId: A, shiftId, lines: line, payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] })
await salesService.create({ userId: A, shiftId, lines: line, payments: [] })
const payRows = seed.rows('SELECT createdByUserId, voidedAt FROM "Payment"')
eq('پیش‌شرط: ۳ پرداخت نقدی با ثبت‌کننده و بدون ابطال', payRows.filter((r) => r.createdByUserId === A && r.voidedAt == null).length, 3)

const counter = async (f) => (await reportLimitsService.limits(f))?.rows?.find((r) => r.key === 'credit')?.total
const table = async (f) => (await salesService.creditList(f))?.page?.totalCount
const base = { fromJalali: today, toJalali: today }
for (const [label, f] of [
  ['بدون فیلتر (امروز)', {}],
  ['بازه‌ی صریح امروز', base],
  ['وضعیت «تسویه شده»', { ...base, status: 'SETTLED' }],
  ['فقط shiftId', { shiftId }],
  ['includeSettled=true', { ...base, includeSettled: true }]
]) {
  const t = await table(f)
  eq(`«${label}»: شمارنده‌ی نسیه = جدول تب (${t})`, await counter(f), t)
}
eq('جدول پیش‌فرض فقط ۱ فاکتور نسیه دارد', await table(base), 1)
eq('با includeSettled جدول ۴ فاکتور', await table({ ...base, includeSettled: true }), 4)

// UI: چک‌باکس «تسویه‌شده‌ها» باید به شمارنده هم برسد، وگرنه با تیک روشن شمارنده ۱ و جدول ۴ است
const ui = readFileSync(new URL('../../src/renderer/src/pages/SalesReports.tsx', import.meta.url), 'utf8')
const limCall = ui.match(/call<any>\(CH\.saleReportLimits,\s*\{[^}]*\}/)?.[0] ?? ''
eq('SalesReports: includeSettled به CH.saleReportLimits فرستاده می‌شود', /includeSettled/.test(limCall), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
