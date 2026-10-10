// نشست ۳۱۱: تست قبل/بعد فاز ۲ «اضافه‌کاری شیفت شب» — تداوم نشست در پنجره‌ی اضافه‌کاری.
/**
 * ===========================================================================
 * نشست ۳۱۱ · فاز ۲ · بند ۴ و ۵ (نشستِ اضافه‌کاری «جاری» می‌ماند + خط‌قرمزها)
 *
 * بعد از اعلام اضافه‌کاری، نشستِ بازِ دیروز تا overtimeUntil «جاری» است:
 *   • openShift/currentId/currentStaffId همان نشست را برمی‌گردانند (فروش‌ها به
 *     کارمند همان نشست نسبت داده می‌شوند؛ AUTO تازه‌ای ساخته نمی‌شود)؛
 *   • shift:status ⇒ OK (نه STALE) تا چیپ/بنر به حالت عادی برگردند؛
 *   • دروازه‌ی با SessionActor (مثل س307) بدون خطای SESSION_REQUIRED می‌گذرد؛
 *   • نشستِ دومِ هم‌زمان همچنان ممنوع است: openSession روی همان نشست همان
 *     gates جامانده (دلیل + رمز مدیر) را می‌خواهد (خط‌قرمز ۵).
 *
 * وقتی overtimeUntil بگذرد: رفتار مرحله‌ی ۱ برمی‌گردد (STALE / جامانده /
 * گیت‌یاب خطا با نشان بازکردن نشست تازه).
 *
 * خط‌قرمز گزارش‌ها (قفل ساختاری): فروشِ پنجره‌ی اضافه‌کاری همچنان در
 * outOfShift گزارش کارمند و multiDayWarning دیده شود — این بخش‌ها عمداً
 * دست‌نخورده‌اند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s311-shift-overtime-continuity.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s311-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliToday, jalaliAddDays } = await import('@shared/jalali')
const { SETTING_KEYS } = await import('@shared/receipt')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const eq = (label, got, want) => (got === want ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`)))
const rejects = async (label, re, fn) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — خطا پرتاب نشد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (re.test(m)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${m.slice(0, 110)}`) }
  }
}

const today = jalaliToday()
const yesterday = jalaliAddDays(today, -1)
const hm = (totalMin) => {
  const m = ((totalMin % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const nightTemplate = (shiftMin) => {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes()
  const endMin = nowMin + shiftMin
  return { name: 'شیفت شب', startTime: hm(endMin + 60), endTime: hm(endMin) }
}

/* ------------- آماده‌سازی: نشست بازِ دیروز + اعلام اضافه‌کاری ------------- */
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true,
  templates: [nightTemplate(-45)],
  clockFormat: '24',
  overtimeMaxMinutes: 120
})
const staff = seed.user('کارمند شیفت شب')
const shiftId = seed.insert('Shift', { name: 'شیفت شب', sessionSeq: 1, dayJalali: yesterday, userId: staff, closedAt: null })
await shiftService.declareOvertime({ reason: 'کار شب‌کشی تمام نشده' })

/* ---------------------- در طول پنجره‌ی اضافه‌کاری ------------------------- */
{
  const before = seed.count('Shift')
  const open = await shiftService.openShift()
  eq('openShift در پنجره‌ی اضافه‌کاری همان نشست دیروز را می‌دهد', open?.id, shiftId)
  eq('currentStaffId همان کارمند است', await shiftService.currentStaffId(), staff)
  eq('currentId همان نشست است (بدون AUTO تازه)', await shiftService.currentId(), shiftId)
  eq('هیچ نشست جدیدی ساخته نشد', seed.count('Shift'), before)

  const st = await shiftService.status()
  eq('shift:status ⇒ OK (نه STALE)', st.state, 'OK')
  truthy('شیفتِ برگشتی از status همان نشست است', st.shift?.id === shiftId)

  const r = await ipc(IPC.saleCreate, {})
  eq('دروازه‌ی با withSessionActor (مثل س307) SESSION_REQUIRED نیست', r.code, undefined)
  truthy('فروش در پنجره‌ی اضافه‌کاری بیرون از گیت نشست رد نمی‌شود', !/نشست بازِ کارمند لازم است|SESSION_REQUIRED/.test(String(r.error)))

  await rejects(
    'نشستِ دوم هم‌زمان ممنوع است (همان گیت جامانده با دلیل)',
    /هنوز باز است و بسته نشده/,
    () => shiftService.openSession({ staffId: staff, name: 'شیفت شب' })
  )
  eq('تلاش ناموفق openSession چیزی نساخت/نبست', seed.count('Shift'), before)
  const stillOpen = seed.one('SELECT closedAt AS c FROM "Shift" WHERE id = ?', shiftId)
  eq('نشست اضافه‌کاری همچنان باز است', stillOpen?.c, null)
}

/* ------------------ پس از اتمام پنجره: بازگشت به رفتار مرحله‌ای ------------------ */
{
  db.$harness.db.prepare('UPDATE "Shift" SET overtimeUntil = ? WHERE id = ?').run(Date.now() - 60_000, shiftId)
  const st = await shiftService.status()
  eq('پس از اتمام سقف ⇒ دوباره STALE', st.state, 'STALE')
  eq('openShift دیگر نشست را برنمی‌گرداند', await shiftService.openShift(), null)
  eq('currentStaffId باطل شد', await shiftService.currentStaffId(), null)
  await rejects(
    'الگوی مرحله‌ی ۱: اعلام اضافه‌کاری دیگر ممکن نیست',
    /فقط یک‌بار|قبلاً اعلام شده/,
    () => shiftService.declareOvertime({ reason: 'تلاش بعد از انقضا' })
  )
  const r = await ipc(IPC.saleCreate, {})
  eq('فروش دوباره SESSION_REQUIRED می‌شود', r.code, 'SESSION_REQUIRED')
  truthy('پیام «هنوز باز و پولش شمرده نشده» برگشت', /هنوز باز و پولش شمرده نشده/.test(String(r.error)))
}

/* -------------------- خط‌قرمز گزارش‌ها (قفل ساختاری) ---------------------- */
{
  const staffReport = readFileSync(resolve('src/main/services/StaffReportService.ts'), 'utf8')
  truthy('خط‌قرمز ۵: outOfShift هیچ استثنای اضافه‌کاری نگرفته است', !/overtime/i.test(staffReport))
  truthy('خط‌قرمز ۵: outOfShift فقط با byTime معنا دارد (همان قفل قبلی)', /if \(!shift\.byTime\)/.test(staffReport))
  const svc = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
  truthy('خط‌قرمز ۵: هشدار چندروزه‌ی نشست (multiDayWarning) دست‌نخورده', /multiDayWarning =|این نشست بیش از یک روز شمسی/.test(svc))
  truthy('قفل: شاخه‌ی اضافه‌کاری در openShift بعد از چک قالب آمده', svc.indexOf('isWithinTemplate(found.template, now)) return open') < svc.indexOf('open.overtimeUntil && now <='))
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
