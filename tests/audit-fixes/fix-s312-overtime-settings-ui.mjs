// نشست ۳۱۲: تست قبل/بعد فاز ۲ «اضافه‌کاری شیفت شب» — تنظیمات، مودال و جریان UI.
/**
 * ===========================================================================
 * نشست ۳۱۲ · فاز ۲ · بند ۶ و ۷ (تنظیم سقف با رمز مدیر + کارت مودال + blockReason)
 *
 *   • `setShiftOvertimeMax`: گیت رمز مدیر همیشگی (تغییر واقعی مقدار)، محدوده‌ی
 *     ۰..۲۴۰ سروری، ذخیره‌ی فوری + حسابرسی SETTINGS_UPDATE؛ saveBundle با
 *     parseShiftConfig بازهم نمی‌تواند مقدار نامعتبر بنویسد.
 *   • sessionForm: وقتی اضافه‌کاری ممکن است blockReason = OVERTIME_ELIGIBLE با
 *     پیش‌نمایشِ ساعت پایان/سقف؛ بعد از اعلام موفق → NONE (نشست جاری است).
 *   • قفل‌های ساختاری UI: کارت اضافه‌کاری در مودال (دلیل اجباری + فقط یک‌بار +
 *     بدون رمز مدیر)، فاروردی‌کردن سقف در Settings (ذخیره‌ی فوری با همان فیلد
 *     رمز سوییچ)، و اشاره‌ی پیام SESSION_REQUIRED به جایگزین اضافه‌کاری.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s312-overtime-settings-ui.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s312-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliToday, jalaliAddDays, faDigits } = await import('@shared/jalali')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

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

/* ---------------------------- تنظیم «سقف اضافه‌کاری» ---------------------- */
{
  await rejects('تغییر سقف بدون رمز مدیر ممنوع است', /رمز مدیر/, () => settingsService.setShiftOvertimeMax({ minutes: 120 }))
  await rejects('مقدار بیرون از محدوده‌ی ۰..۲۴۰ رد می‌شود (حتی با رمز)', /۰ تا ۲۴۰|۰..۲۴۰/, () =>
    settingsService.setShiftOvertimeMax({ minutes: 500, managerPassword: PW })
  )
  const next = await settingsService.setShiftOvertimeMax({ minutes: 120, managerPassword: PW })
  eq('ذخیره‌ی فوری با رمز مدیر موفق', next.overtimeMaxMinutes, 120)
  const stored = seed.one('SELECT value FROM "Setting" WHERE key = ?', SETTING_KEYS.shiftConfig)
  truthy('مقدار واقعاً در Setting ذخیره شد', stored != null && String(stored.value).includes('"overtimeMaxMinutes":120'))
  const auditRow = seed.one('SELECT id FROM "AuditLog" WHERE action = ? AND entity = ?', 'SETTINGS_UPDATE', 'Setting')
  truthy('تغییر سقف در حسابرسی نشست', auditRow != null)
}

/* ------------------------------ فرم نشست ------------------------------- */
const staff = seed.user('کارمند شیفت شب')
const shiftId = seed.insert('Shift', { name: 'شیفت شب', sessionSeq: 1, dayJalali: yesterday, userId: staff, closedAt: null })
{
  // byTime + قالب شبانه + سقف: فقط با همین‌ها کارت می‌آید
  seed.setting(SETTING_KEYS.shiftConfig, {
    byTime: true,
    templates: [nightTemplate(-45)],
    clockFormat: '24',
    overtimeMaxMinutes: 120
  })
  const form = await shiftService.sessionForm()
  eq('blockReason مودال ⇒ OVERTIME_ELIGIBLE', form.blockReason, 'OVERTIME_ELIGIBLE')
  truthy('پیش‌نمایش: ساعت پایان فارسی دارد', !!form.overtimePreview?.untilLabel && /[۰-۹]/.test(String(form.overtimePreview.untilLabel)))
  eq('پیش‌نمایش: سقف ۱۲۰ دقیقه', form.overtimePreview?.capMinutes, 120)
  truthy('staleOpen همزمان حاضر است (گزینه‌ی بستن هم باقی)', !!form.staleOpen)

  await shiftService.declareOvertime({ reason: 'دیر شدن مشتری آخر' })
  const after = await shiftService.sessionForm()
  // بعد از اعلام، نشستِ دیروز «جاری» است: کارت دیگر نمی‌آید و ریز نشست جاری پر است
  eq('بعد از اعلام blockReason ⇒ NONE', after.blockReason, 'NONE')
  eq('کارت پیش‌نمایش پایین آمد', after.overtimePreview, null)
  truthy('نشست جاری همان نشست دیروز است', after.current?.id === shiftId && after.current?.userId === staff)

  const st = await shiftService.status()
  eq('status در پنجره‌ی اضافه‌کاری ⇒ OK', st.state, 'OK')
  eq('overtimeUntilLabel در حالت OK نیست', st.overtimeUntilLabel ?? null, null)
}

/* --------------------------- قفل‌های ساختاری UI -------------------------- */
{
  const modal = readFileSync(resolve('src/renderer/src/components/ShiftSessionModal.tsx'), 'utf8')
  truthy('قفل: کارت اضافه‌کاری در مودال موجود است', /اضافه‌کاری شیفت شب/.test(modal) && /CH\.shiftOvertimeDeclare/.test(modal))
  truthy('قفل: دکمه‌ی اعلام فقط با دلیل ≥۳ فعال است', /overtimeReason\.trim\(\)\.length < 3/.test(modal))
  truthy('قفل: متن کارت «فقط یک‌بار» و دائمی‌بودن حسابرسی را می‌گوید', /فقط یک‌بار/.test(modal) && /حسابرسی می‌ماند/.test(modal))
  const settings = readFileSync(resolve('src/renderer/src/pages/Settings.tsx'), 'utf8')
  truthy('قفل: مسیر ذخیره‌ی فوری سقف در Settings موجود است', /CH\.settingsShiftOvertimeMax/.test(settings) && /saveOvertimeMax/.test(settings))
  truthy('قفل: همان فیلد رمز سوییچ برای سقف هم استفاده می‌شود', /managerPassword: byTimePw/.test(settings))
  const ipcIdx = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
  truthy('قفل: پیام STALE به جایگزین اضافه‌کاری اشاره می‌کند (overtimeUntilLabel)', /st\.overtimeUntilLabel[\s\S]{0,300}اضافه‌کاری» اعلام کند/.test(ipcIdx))
  truthy('قفل: کانال تنظیم سقف ثبت شده', /settingsShiftOvertimeMax, async \(p\) => settingsService\.setShiftOvertimeMax/.test(ipcIdx))
  const ipcShared = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
  truthy("قفل: هر دو کانال جدید در رجیستری مشترک‌اند", /shiftOvertimeDeclare: 'shift:overtime:declare'/.test(ipcShared) && /settingsShiftOvertimeMax: 'settings:shift:overtimeMax'/.test(ipcShared))
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
