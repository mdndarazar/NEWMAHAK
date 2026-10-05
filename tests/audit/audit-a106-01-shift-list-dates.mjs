/**
 * ممیزی نشست ۱۰۶ — ShiftService.list / ShiftService.overrides (count/truncated/هشدار نشست ۱۰۶) و تاریخ ورودی.
 * ادعای S106 (فهرست نشست با page/warnings، overrides با count) رفتاری سنجیده می‌شود.
 * A106-01 (P3): هر دو تاریخ را نمی‌سنجیدند: «از/تا» خالی ⇒ dayJalali بین '' و '' ⇒ فهرست شیفت نوار گزارش خالی
 *   و گزارش «نشست‌های override‌شده» (سیگنال کنترل داخلی) بی‌صدا «هیچ» به‌جای امروز؛ تاریخ نیمه‌تایپ/نامعتبر
 *   («۱۴۰۵/۱۳/۰۱»، «1405/0») هم بی‌صدا خالی. قاعده: خالی ⇒ امروز، نامعتبر ⇒ خطای فارسی.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return String(e?.message ?? e) } }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10601-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const T = Date.now()
// سه نشست پشت‌سرهم امروز؛ دومی نام override‌شده دارد
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T - 9 * 3600_000, closedAt: T - 6 * 3600_000, userId: A })
seed.insert('Shift', { name: 'شب', suggestedName: 'ظهر', nameOverridden: 1, overrideReason: 'جانشین', number: 2, dayJalali: today, openedAt: T - 6 * 3600_000, closedAt: T - 3 * 3600_000, userId: A })
seed.insert('Shift', { name: 'شب', number: 3, dayJalali: today, openedAt: T - 3 * 3600_000, userId: A })

console.log('— ادعای S106: page/truncated/هشدار روی آرایه')
const p = await shiftService.list({ fromJalali: today, toJalali: today, take: 2 })
eq('take=۲ از ۳: دو ردیف', p.length, 2)
eq('page.totalCount=۳ و truncated=true', [p.page?.totalCount, p.page?.truncated], [3, true])
eq('هشدار فارسی برش', (p.warnings ?? []).length, 1)
const full = await shiftService.list({ fromJalali: today, toJalali: today })
eq('بدون take: ۳ ردیف، بدون هشدار', [full.length, full.page?.truncated, (full.warnings ?? []).length], [3, false, 0])
const ov = await shiftService.overrides({ fromJalali: today, toJalali: today })
eq('overrides: ۱ ردیف با page.totalCount=۱', [ov.rows?.length, ov.page?.totalCount], [1, 1])

console.log('— A106-01: تاریخ خالی ⇒ امروز، نامعتبر ⇒ خطای فارسی')
const empty = await errOf(async () => { const r = await shiftService.list({ fromJalali: '', toJalali: '' }); if (r.length !== 3) throw new Error(`len ${r.length}`) })
eq('list با «از/تا» خالی = نشست‌های امروز (۳)', empty, null)
const emptyOv = await errOf(async () => { const r = await shiftService.overrides({ fromJalali: '', toJalali: '' }); if (r.rows?.length !== 1) throw new Error(`len ${r.rows?.length}`) })
eq('overrides با «از/تا» خالی = override امروز (۱)', emptyOv, null)
for (const bad of ['1405/13/01', '1405/0']) {
  const e1 = await errOf(() => shiftService.list({ fromJalali: bad, toJalali: today }))
  eq(`list «${bad}» ⇒ خطای فارسی`, !!e1 && /[\u0600-\u06FF]/.test(e1), true)
  const e2 = await errOf(() => shiftService.overrides({ fromJalali: today, toJalali: bad }))
  eq(`overrides «${bad}» ⇒ خطای فارسی`, !!e2 && /[\u0600-\u06FF]/.test(e2), true)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
