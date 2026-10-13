/**
 * اعتبارسنجی canonical Shift Settings در Main:
 * - overlap، روزِ خالی و کارمند غیرفعال رد می‌شوند؛
 * - تنظیم معتبر، mode/staff/reminder/handover policy را همان‌گونه ذخیره می‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s361-canonical-shift-schedule-validation.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-shift-schedule-s361-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, work) => {
  try { await work(); eq(label, true, false) }
  catch { eq(label, true, true) }
}

const active = seed.user('صندوقدار فعال S361')
const inactive = seed.user('صندوقدار غیرفعال S361')
db.$harness.db.prepare('UPDATE "User" SET role = ?, isActive = ? WHERE id = ?').run('CASHIER', 1, active)
db.$harness.db.prepare('UPDATE "User" SET role = ?, isActive = ? WHERE id = ?').run('CASHIER', 0, inactive)
const base = (templates) => ({ byTime: true, custodyMode: 'MULTI_SHIFT', reminderEnabled: true, overrunGraceMinutes: 45, templates })
const tpl = (id, name, startTime, endTime, staffIds = [active]) => ({ id, name, startTime, endTime, isActive: true, daysMask: 127, staffIds, reminderRepeatMin: 20, allowMidDayHandover: false })

await rejects('بازه‌های هم‌پوشان در Main رد می‌شوند', () => settingsService.saveBundle({
  shift: base([tpl('s361-a', 'صبح', '08:00', '14:00'), tpl('s361-b', 'ظهر', '12:00', '18:00')]), managerPassword: '1111'
}))
eq('overlap تنظیمی در کلید shift.config ذخیره نمی‌شود', seed.one('SELECT value FROM "Setting" WHERE key = ?', SETTING_KEYS.shiftConfig), undefined)
await rejects('شیفت فعال بدون روز در Main رد می‌شود', () => settingsService.saveBundle({
  shift: base([{ ...tpl('s361-days', 'بدون روز', '08:00', '14:00'), daysMask: 0 }]), managerPassword: '1111'
}))
await rejects('کارمند غیرفعال برای شیفت canonical رد می‌شود', () => settingsService.saveBundle({
  shift: base([tpl('s361-off', 'کارمند غیرفعال', '08:00', '14:00', [inactive])]), managerPassword: '1111'
}))

const saved = await settingsService.saveBundle({
  shift: base([
    { ...tpl('s361-morning', 'صبح', '08:00', '14:00'), allowMidDayHandover: true },
    tpl('s361-night', 'شب', '14:00', '20:00')
  ]), managerPassword: '1111'
})
eq('mode چندشیفت canonical ذخیره می‌شود', saved.shift.custodyMode, 'MULTI_SHIFT')
eq('policy تحویل میان‌روز هر قالب حفظ می‌شود', saved.shift.templates[0].allowMidDayHandover, true)
eq('کارکنان برنامه‌ریزی‌شده حفظ می‌شوند', saved.shift.templates[0].staffIds[0], active)
eq('کلید canonical shift config واقعاً نوشته شد', seed.one('SELECT value FROM "Setting" WHERE key = ?', SETTING_KEYS.shiftConfig) != null, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
