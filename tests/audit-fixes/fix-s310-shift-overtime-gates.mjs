// نشست ۳۱۰: تست قبل/بعد فاز ۲ «اضافه‌کاری شیفت شب» — گیت‌های سروری declareOvertime.
/**
 * ===========================================================================
 * نشست ۳۱۰ · فاز ۲ · بند ۲ و ۳ (گیت‌های سروری اعلام اضافه‌کاری + یک‌بارگی اتمیک)
 *
 * قبل از رفع: هیچ مفهومی از «اضافه‌کاری شیفت شب» در کد وجود نداشت؛ نشستِ
 * بازِ دیروز فقط یک راه داشت: بستن با دلیل + رمز مدیر.
 *
 * انتظار بعد از رفع (طبق قواعد تأییدشده‌ی فاز ۲):
 *   • گیت‌های سروری: دلیل ≥۳ · byTime روشن · overtimeMaxMinutes ۱..۲۴۰ ·
 *     فقط نشستِ بازِ دیروز · کارمند همان نشست · قالب زمان‌بندی موجود ·
 *     خارج از بازه (ساعت رسمی) · قبل از «پایان بازه + سقف».
 *   • موفق: سه ستون overtime* روی ردیف + ردیف حسابرسی SHIFT_OVERTIME با
 *     actor = کارمند خود نشست (نه payload).
 *   • فقط یک‌بار: اعلامِ دوم با همان نشست اتمیک رد می‌شود (شرط
 *     overtimeUntil IS NULL در updateMany) و حسابرسی دومی هم نوشته نمی‌شود.
 *   • بدون رمز مدیر برای اعلام (قانون رأی‌گرفته‌ی فاز ۲ — قفل ساختاری).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s310-shift-overtime-gates.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s310-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliToday, jalaliAddDays, faDigits } = await import('@shared/jalali')
const { SETTING_KEYS, parseShiftConfig } = await import('@shared/receipt')

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const eq = (label, got, want) => (got === want ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`)))
const rejects = async (label, re, fn) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — خطا پرتاب نشد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (re.test(m)) { ok++; console.log(`  ✓ ${label}`) }
    else { bad++; console.log(`  ✗ ${label} — پیام دیگری آمده: ${m.slice(0, 120)}`) }
  }
}

/* ----------------------------- قفل‌های ساختاری --------------------------- */
{
  const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8')
  truthy('ساختاری: سه ستون overtime* در مدل Shift', /overtimeDeclaredAt\s+DateTime\?/.test(schema) && /overtimeUntil\s+DateTime\?/.test(schema) && /overtimeReason\s+String\?/.test(schema))
  const migration = readFileSync(resolve('prisma/migrations/20271017010000_shift_overtime/migration.sql'), 'utf8')
  truthy('ساختاری: migration جدید (نه ویرایش قدیمی) با ۳ ALTER', (migration.match(/ALTER TABLE "Shift" ADD COLUMN/g) ?? []).length === 3)
  const enums = readFileSync(resolve('src/shared/enums.ts'), 'utf8')
  truthy('ساختاری: AuditAction.SHIFT_OVERTIME ثبت شده', /SHIFT_OVERTIME: 'SHIFT_OVERTIME'/.test(enums))
  const ipcIdx = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
  truthy('ساختاری: handler اعلام اضافه‌کاری فقط دلیل را از payload می‌گیرد (بدون اختیار هویت)', /shiftOvertimeDeclare, async \(p\) => shiftService\.declareOvertime\(\{ reason: p\?\.reason \?\? null \}\)/.test(ipcIdx))
  const svc = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
  const otStart = svc.indexOf('async declareOvertime')
  // بدنه‌ی متد تا ابتدای متد عمومی بعدی (declareOvertime بعد از openSession نوشته شده — س78)
  const otBody = svc.slice(otStart, svc.indexOf('\n  async ', otStart + 30))
  truthy('قانون فاز ۲ (بدون رمز مدیر برای اعلام): هیچ گیت رمزی در declareOvertime نیست', !/assertManagerPassword|assertPanelPassword/.test(otBody))
  truthy('قفل اتمیک یک‌بارگی: updateMany با شرط overtimeUntil: null', /updateMany\(\{[\s\S]{0,200}closedAt: null, overtimeUntil: null/.test(otBody))
}

/* --------------------- پیکربندی پیش‌فرض/گیره‌ی parse --------------------- */
eq('پیش‌فرض خاموش: overtimeMaxMinutes = 0', parseShiftConfig(null).overtimeMaxMinutes, 0)
eq('گیره‌ی بالای محدوده ⇒ ۲۴۰', parseShiftConfig({ overtimeMaxMinutes: 999 }).overtimeMaxMinutes, 240)
eq('مقدار منفی/خراب ⇒ ۰', parseShiftConfig({ overtimeMaxMinutes: -7 }).overtimeMaxMinutes, 0)

/* ---------------------------- کمک‌تابع پنجره‌ی شبانه ---------------------- */
const today = jalaliToday()
const yesterday = jalaliAddDays(today, -1)
const hm = (totalMin) => {
  const m = ((totalMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
/**
 * قالب شبانه‌ای می‌سازد که پایان بازه‌اش دقیقاً shiftMin دقیقه از «همین لحظه»
 * بگذرد (منفی = در گذشته، مثبت = در آینده) — شبانه بودن (پایان ≤ شروع) باعث
 * می‌شود پایانِ محاسبه‌شده‌ی سرویس روزِ بعدِ dayJalali بیفتد و با «همین حالا»
 * (ساعت رسمی بدون افست) انطباق داشته باشد.
 */
const nightTemplate = (shiftMin) => {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const endMin = nowMin + shiftMin
  return { name: 'شیفت شب', startTime: hm(endMin + 60), endTime: hm(endMin) }
}
const setCfg = (tpl, cap) =>
  seed.setting(SETTING_KEYS.shiftConfig, { byTime: true, templates: [tpl], clockFormat: '24', overtimeMaxMinutes: cap })
const closeShift = (id) => db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), id)

/* --------------------------------- گیت‌ها --------------------------------- */
await rejects('دلیل کوتاه رد می‌شود (≥۳ نویسه)', /دلیل کوتاه و روشن|حداقل ۳ حرف/, () => shiftService.declareOvertime({ reason: 'اب' }))
await rejects('byTime خاموش رد می‌شود', /تعیین شیفت بر اساس ساعت/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))

setCfg(nightTemplate(-45), 0)
await rejects('سقف صفر (خاموش) رد می‌شود', /سقف اضافه‌کاری شیفت|غیرفعال است/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))

setCfg(nightTemplate(-45), 120)
await rejects('بدون هیچ نشست بازی رد می‌شود', /نشستی باز نیست/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))

const staff = seed.user('کارمند شیفت شب')
{
  const todayShift = seed.insert('Shift', { name: 'شیفت صبح', sessionSeq: 1, dayJalali: today, userId: staff, closedAt: null })
  await rejects('نشستِ امروزِ باز رد می‌شود (فقط نشست دیروز)', /فقط برای نشستِ بازِ دیروز/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))
  closeShift(todayShift)
}
{
  const noStaff = seed.insert('Shift', { name: 'شیفت شب', sessionSeq: 2, dayJalali: yesterday, userId: null, closedAt: null })
  await rejects('نشست بدون کارمند رد می‌شود', /کارمند این نشست هنوز تعیین نشده/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))
  closeShift(noStaff)
}
{
  setCfg(nightTemplate(+45), 120)
  const inside = seed.insert('Shift', { name: 'شیفت شب', sessionSeq: 3, dayJalali: yesterday, userId: staff, closedAt: null })
  await rejects('هنوز داخل بازه رد می‌شود', /هنوز داخل بازه‌ی همین شیفت/, () => shiftService.declareOvertime({ reason: 'اواخر کار' }))
  closeShift(inside)
}

/* --------------------------- مسیر موفق + یک‌بارگی ------------------------- */
setCfg(nightTemplate(-45), 120)
const shiftId = seed.insert('Shift', { name: 'شیفت شب', sessionSeq: 4, dayJalali: yesterday, userId: staff, closedAt: null })
{
  const res = await shiftService.declareOvertime({ reason: 'مشتری آخر شب دیر رسید' })
  truthy('اعلام موفق نتیجه‌ی until برمی‌گرداند', !!res?.untilLabel && typeof res.until === 'string')
  truthy('برچسب ساعت پایان فارسی است', faDigits(String(res.untilLabel)) === String(res.untilLabel) || /[۰-۹]/.test(String(res.untilLabel)))

  const row = seed.one('SELECT overtimeUntil AS u, overtimeDeclaredAt AS d, overtimeReason AS r FROM "Shift" WHERE id = ?', shiftId)
  truthy('overtimeUntil روی خود ردیف نشست نشست', row != null && row.u != null)
  truthy('overtimeDeclaredAt هم پر شد', row != null && row.d != null)
  eq('دلیل روی خودِ ردیف ذخیره شد', row?.r, 'مشتری آخر شب دیر رسید')

  const auditRow = seed.one('SELECT id, userId, action FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'SHIFT_OVERTIME')
  eq('ردیف حسابرسی SHIFT_OVERTIME ثبت شد', auditRow?.action, 'SHIFT_OVERTIME')
  truthy('actor حسابرسی = کارمند خودِ نشست (سروری، نه payload)', auditRow?.userId != null && Number(auditRow.userId) === Number(staff))

  await rejects('اعلام دوم رد می‌شود (یک‌بارگی اتمیک)', /فقط یک‌بار|قبلاً اعلام شده/, () => shiftService.declareOvertime({ reason: 'تلاش دوباره' }))
  eq('حسابرسی دومی نوشته نشد (هنوز یک ردیف)', seed.count('AuditLog', 'action = ?', 'SHIFT_OVERTIME'), 1)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
