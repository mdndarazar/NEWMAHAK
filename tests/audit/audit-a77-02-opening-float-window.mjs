/**
 * ممیزی A77-02 — موجودی اول ثبت‌شده در لحظه‌ی بستن باید داخل همان پنجره‌ی بسته‌شده
 * بنشیند. قبلاً occurredAt = «الان» بود: بستن بازه‌ی دیروز امروز ⇒ (۱) موجودی اول در
 * بازه‌ی امروز ظاهر می‌شد (موجودی اول شبح)، (۲) بستن دوباره‌ی همان بازه آن را دوباره
 * ثبت می‌کرد، (۳) برای نشست بسته‌شده، رکورد بیرون پنجره بود ⇒ A69-01 دور زده می‌شد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a77b-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const attempt = async (fn) => { try { return { value: await fn() } } catch (e) { return { error: String(e?.message ?? e) } } }
const user = seed.user('کارمند')
const yesterday = toJalaliDate(new Date(Date.now() - 86_400_000))
const today = toJalaliDate(new Date())
const floats = (where = '1=1') => sql.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM "CashMovement" WHERE type='OPENING_FLOAT' AND ${where}`).get()

// بستن بازه‌ی دیروز (امروز انجام می‌شود) با موجودی اول ۵۰۰
await cashboxService.close({ fromJalali: yesterday, toJalali: yesterday, userId: user, openingFloat: 500, note: 'بستن دیروز', closeShift: false, explicitShift: true, shiftId: null })
eq('موجودی اول یک‌بار ثبت شد', floats().n, 1)
eq('موجودی اول داخل روز بسته‌شده (دیروز) نشست', floats(`occurredAtJalali='${yesterday}'`).s, 500)
const prevToday = await cashboxService.expected({ fromJalali: today, toJalali: today })
eq('بازه‌ی امروز موجودی اول شبح ندارد', prevToday?.openingFloat ?? prevToday?.cashClose?.openingFloat ?? 0, 0)
await cashboxService.close({ fromJalali: yesterday, toJalali: yesterday, userId: user, openingFloat: 500, note: 'بستن دوباره', allowRepeatClose: true, closeShift: false, explicitShift: true, shiftId: null })
eq('بستن دوباره‌ی همان بازه موجودی اول را دوباره ثبت نکرد', floats().n, 1)
const fake = await attempt(() => cashboxService.close({ fromJalali: yesterday, toJalali: yesterday, userId: user, openingFloat: 900, note: 'جعل', allowRepeatClose: true, closeShift: false, explicitShift: true, shiftId: null }))
eq('A69-01 روی بازه‌ی گذشته هم برقرار: موجودی اول جعلی رد شد', !!fake.error, true)

// نشست بسته‌شده‌ی دیروز، بستن صندوقش امروز
const opened = Date.now() - 30 * 3_600_000, closed = Date.now() - 20 * 3_600_000
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: yesterday, openedAt: opened, closedAt: closed, userId: user })
await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 300, note: 'نشست دیروز', closeShift: false })
const fake2 = await attempt(() => cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 800, note: 'جعل', allowRepeatClose: true, closeShift: false }))
eq('A69-01 روی نشست بسته‌شده: موجودی اول جعلی رد شد', !!fake2.error, true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
