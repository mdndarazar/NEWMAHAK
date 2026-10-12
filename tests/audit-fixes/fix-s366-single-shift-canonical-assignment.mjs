/**
 * Canonical single-shift mode is still schedule-owned: its chosen worker opens
 * the drawer, an unscheduled person cannot open independently, while a manager-
 * enabled mid-day replacement may be any active registered PIN holder.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s366-single-shift-canonical-assignment.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-single-canonical-s366-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0; let bad = 0
const eq = (label, got, want) => { if (got === want) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) } }
const rejects = async (label, code, work) => { try { await work(); eq(label, true, false) } catch (error) { eq(label, error?.code, code) } }
const hm = (minute) => `${String(Math.floor(((minute % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`
const manager = seed.user('مدیر S366'), planned = seed.user('مسئول تک‌شیفت S366'), replacement = seed.user('جایگزین ثبت‌شده S366')
const now = new Date(), minute = now.getHours() * 60 + now.getMinutes()
seed.setting(SETTING_KEYS.shiftConfig, { custodyMode: 'SINGLE_SHIFT', byTime: true, reminderEnabled: true, overrunGraceMinutes: 0, templates: [{ id: 's366-single', name: 'تک‌شیفت اصلی', startTime: hm(minute - 20), endTime: hm(minute + 80), isActive: true, daysMask: 1 << now.getDay(), staffIds: [planned], reminderRepeatMin: 15, allowMidDayHandover: true }] })
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
for (const [id, temp, perm] of [[planned, 'Plan366!', 'Plan3664!'], [replacement, 'Repl366!', 'Repl3664!']]) {
  await custodyService.setPin({ userId: id, newPassword: temp, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'راه‌اندازی تک‌شیفت' })
  await custodyService.setPin({ userId: id, currentPassword: temp, newPassword: perm })
}
await rejects('کارمند ثبت‌شده ولی بدون برنامهٔ تک‌شیفت نمی‌تواند مستقل صندوق را باز کند', 'NO_SCHEDULED_SHIFT', () => custodyService.open({ userId: replacement, password: 'Repl3664!', countedCash: 0 }))
const opened = await custodyService.open({ userId: planned, password: 'Plan3664!', countedCash: 0 })
eq('کارمند انتخاب‌شدهٔ تک‌شیفت canonical صندوق را باز می‌کند', seed.one('SELECT templateId FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.templateId, 's366-single')
const handover = await custodyService.handoverStart({ password: 'Plan3664!', countedCash: 0, toUserId: replacement, idempotencyKey: 's366-midday' })
eq('جایگزین ثبت‌شده در تک‌شیفت با اجازهٔ مدیر وارد pending می‌شود', handover.state, 'HANDOVER_PENDING')
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'Repl3664!', countedCash: 0 })
eq('جایگزین مستقل پس از شمارش صفر مسئول واقعی می‌شود', (await custodyService.status()).custodian?.id, replacement)
eq('جانشین تک‌شیفت همچنان snapshot قالب مبدأ را دارد', seed.one('SELECT templateId FROM "CustodyShiftMeta" WHERE shiftId=?', accepted.shiftId)?.templateId, 's366-single')
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
