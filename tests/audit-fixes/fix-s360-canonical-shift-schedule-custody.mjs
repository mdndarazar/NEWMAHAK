/**
 * Shift Settings canonical schedule -> custody:
 * - the schedule is read from shift.config, not silently copied from ShiftPlan;
 * - an authenticated scheduled worker opens an actual drawer session;
 * - per-template mid-day handover defaults closed and, when enabled, carries
 *   the same template identity through the receiving segment.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s360-canonical-shift-schedule-custody.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-canonical-shift-s360-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, code, work) => {
  try { await work(); eq(label, true, false) }
  catch (error) { eq(label, error?.code, code) }
}
const hm = (minute) => `${String(Math.floor(((minute % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`

const manager = seed.user('مدیر S360', { role: 'MANAGER' })
const giver = seed.user('تحویل‌دهنده S360', { role: 'CASHIER' })
const receiver = seed.user('تحویل‌گیرنده S360', { role: 'CASHIER' })
const now = new Date()
const nowMinute = now.getHours() * 60 + now.getMinutes()
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true,
  custodyMode: 'MULTI_SHIFT',
  reminderEnabled: true,
  overrunGraceMinutes: 0,
  templates: [{
    id: 'canonical-s360', name: 'شیفت canonical', startTime: hm(nowMinute - 20), endTime: hm(nowMinute + 80),
    isActive: true, daysMask: 1 << now.getDay(), staffIds: [giver, receiver], reminderRepeatMin: 15, allowMidDayHandover: false
  }]
})
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
for (const [id, temporary, permanent] of [[giver, 'Giver123!', 'Giver1234!'], [receiver, 'Recv123!', 'Recv1234!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'تعریف اولیه' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: giver, password: 'Giver1234!', countedCash: 0 })
const openingMeta = seed.one('SELECT templateId, planId, scheduledEndAt FROM "CustodyShiftMeta" WHERE shiftId = ?', opened.shiftId)
eq('افتتاح حضانت از template canonical شناسه می‌گیرد', openingMeta?.templateId, 'canonical-s360')
eq('افتتاح canonical به ShiftPlan قدیمی وصل نمی‌شود', openingMeta?.planId, null)
eq('برنامه canonical زمان پایان snapshot دارد', openingMeta?.scheduledEndAt != null, true)
eq('کارمند زمان‌بندی‌شده بدون PIN مسئول نمی‌شود؛ پس از PIN نشست واقعی باز شده است', (await custodyService.status()).custodian?.id, giver)
await rejects('تحویل میان‌روز پیش‌فرض قالب canonical بسته است', 'MIDDAY_HANDOVER_DISABLED', () => custodyService.handoverStart({ password: 'Giver1234!', countedCash: 0, toUserId: receiver, idempotencyKey: 's360-off' }))

seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true,
  custodyMode: 'MULTI_SHIFT',
  reminderEnabled: true,
  overrunGraceMinutes: 0,
  templates: [{
    id: 'canonical-s360', name: 'شیفت canonical', startTime: hm(nowMinute - 20), endTime: hm(nowMinute + 80),
    isActive: true, daysMask: 1 << now.getDay(), staffIds: [giver, receiver], reminderRepeatMin: 15, allowMidDayHandover: true
  }]
})
const handover = await custodyService.handoverStart({ password: 'Giver1234!', countedCash: 0, toUserId: receiver, idempotencyKey: 's360-on' })
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'Recv1234!' })
const receivingMeta = seed.one('SELECT templateId, planId, scheduledEndAt FROM "CustodyShiftMeta" WHERE shiftId = ?', accepted.shiftId)
eq('تحویل مجاز با PIN مستقل گیرنده پذیرفته می‌شود', accepted.shiftId > opened.shiftId, true)
eq('segment گیرنده template identity شیفت قبلی را به ارث می‌برد', receivingMeta?.templateId, 'canonical-s360')
eq('segment گیرنده ShiftPlan جدید نمی‌سازد', receivingMeta?.planId, null)
eq('segment گیرنده پایان برنامه را بازطبقه‌بندی نمی‌کند', String(receivingMeta?.scheduledEndAt), String(openingMeta?.scheduledEndAt))
const timeline = await custodyService.report({ managerUserId: manager, managerPassword: 'مدیر123!' })
const history = timeline.segments.find((segment) => segment.shiftId === accepted.shiftId)
eq('تاریخچه custody همان template snapshot را می‌خواند', history?.templateId, 'canonical-s360')
eq('تاریخچه نام شیفت را از snapshot ذخیره‌شده می‌خواند', history?.scheduleTitleSnapshot, 'شیفت canonical')
eq('تاریخچه segment گیرنده را با نام واقعی شخص نشان می‌دهد', history?.custodianName, 'تحویل‌گیرنده S360')
eq('handover history هر دو طرف تحویل را نگه می‌دارد', timeline.handovers[0]?.fromUser, 'تحویل‌دهنده S360')
eq('handover history دریافت‌کنندهٔ نهایی را نگه می‌دارد', timeline.handovers[0]?.finalCustodian, 'تحویل‌گیرنده S360')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
