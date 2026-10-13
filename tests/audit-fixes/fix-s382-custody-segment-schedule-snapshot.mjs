/**
 * Phase 3a — a custody segment captures the schedule policy that governed its
 * opening. Template/mode edits made afterwards plan future work only: they may
 * not relabel, re-expire, change reminder cadence, revoke mid-day permission,
 * or silently replace the eligible receiver roster for the live segment.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s382-custody-segment-schedule-snapshot.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-segment-snapshot-s382-'))
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
const hm = (minute) => `${String(Math.floor((((minute % 1440) + 1440) % 1440) / 60)).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`

const manager = seed.user('مدیر S382')
const giver = seed.user('مسئول اولیه S382')
const receiver = seed.user('جانشین S382')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', giver, receiver)

const now = new Date()
const nowMinute = now.getHours() * 60 + now.getMinutes()
const originalTemplate = {
  id: 'snapshot-s382', name: 'شیفت immutable اصلی', startTime: hm(nowMinute - 20), endTime: hm(nowMinute + 80),
  isActive: true, daysMask: 1 << now.getDay(), staffIds: [giver, receiver], reminderRepeatMin: 17, allowMidDayHandover: true
}
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true, custodyMode: 'MULTI_SHIFT', custodyModeConfigured: true,
  reminderEnabled: true, overrunGraceMinutes: 9, overtimeMaxMinutes: 33,
  templates: [originalTemplate]
})

await custodyService.setPin({ userId: manager, newPassword: 'Manager382!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager382!' })
for (const [id, temporary, permanent] of [[giver, 'GiverTemp382!', 'GiverFinal382!'], [receiver, 'ReceiverTemp382!', 'ReceiverFinal382!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager382!', reason: 'راه‌اندازی آزمون snapshot برنامه' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: giver, password: 'GiverFinal382!', countedCash: 1000 })
const initialMeta = seed.one('SELECT planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)
const initialSnapshot = JSON.parse(initialMeta?.scheduleSnapshotJson ?? '{}')
const initialStatus = await custodyService.status()
eq('افتتاح، snapshot versioned برنامه را ثبت می‌کند', initialSnapshot.title, 'شیفت immutable اصلی')
eq('snapshot پایان برنامه را ثبت می‌کند', initialSnapshot.scheduledEndAt != null, true)
eq('snapshot cadence یادآور را ثبت می‌کند', initialSnapshot.reminderRepeatMin, 17)
eq('snapshot اجازهٔ تحویل میان‌روز را ثبت می‌کند', initialSnapshot.allowMidDayHandover, true)
eq('snapshot roster مسئولان مجاز را ثبت می‌کند', initialSnapshot.staffIds.includes(receiver), true)
eq('snapshot overtime را ثبت می‌کند', initialSnapshot.overtimeMaxMinutes, 33)
eq('status نام schedule زنده را از snapshot می‌خواند', initialStatus.schedule?.title, 'شیفت immutable اصلی')
eq('status cadence زنده را از snapshot می‌خواند', initialStatus.reminder?.repeatMinutes, 17)

// This directly models a persisted Settings edit after the segment opened. The
// active segment must remain safe even if an import/older writer bypasses the
// Settings workflow's own freeze/resume guard.
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true, custodyMode: 'SINGLE_SHIFT', custodyModeConfigured: true,
  singleShiftCustodianUserId: giver, reminderEnabled: false, overrunGraceMinutes: 0, overtimeMaxMinutes: 0,
  templates: [{
    ...originalTemplate, name: 'نام و policy آینده', endTime: hm(nowMinute + 300), staffIds: [giver],
    reminderRepeatMin: 55, allowMidDayHandover: false
  }]
})

const afterEdit = await custodyService.status()
const afterEditMeta = seed.one('SELECT planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)
eq('rename template، نام segment فعال را عوض نمی‌کند', afterEdit.schedule?.title, 'شیفت immutable اصلی')
eq('template reminder edit، cadence فعال را عوض نمی‌کند', afterEdit.reminder?.repeatMinutes, 17)
eq('template end edit، پایان segment فعال را عوض نمی‌کند', String(afterEdit.schedule?.scheduledEndAt), String(initialStatus.schedule?.scheduledEndAt))
eq('template/mode edit، expiry persisted segment فعال را عوض نمی‌کند', String(afterEditMeta?.rolloverAt), String(initialMeta?.rolloverAt))
eq('config edit، snapshot evidence را بازنویسی نمی‌کند', afterEditMeta?.scheduleSnapshotJson, initialMeta?.scheduleSnapshotJson)
eq('mode edit، permission تحویل میان‌روز segment فعال را لغو نمی‌کند', afterEdit.schedule?.allowMidDayHandover, true)

const handover = await custodyService.handoverStart({ password: 'GiverFinal382!', countedCash: 1000, toUserId: receiver, idempotencyKey: 's382-same-template' })
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'ReceiverFinal382!', countedCash: 1000 })
const successor = seed.one('SELECT templateId, planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', accepted.shiftId)
const successorSnapshot = JSON.parse(successor?.scheduleSnapshotJson ?? '{}')
eq('mutated current roster نمی‌تواند receiver مجاز snapshot را رد کند', accepted.shiftId > opened.shiftId, true)
eq('تحویل میان‌روز همان template immutable را حفظ می‌کند', successor?.templateId, 'snapshot-s382')
eq('successor نام اولیه را حفظ می‌کند، نه rename آینده', successor?.planTitle, 'شیفت immutable اصلی')
eq('successor پایان اولیه را حفظ می‌کند', String(successor?.scheduledEndAt), String(initialMeta?.scheduledEndAt))
eq('successor expiry اولیه را با overtime snapshot حفظ می‌کند', String(successor?.rolloverAt), String(initialMeta?.rolloverAt))
eq('successor همان snapshot policy را بدون بازتولید از Settings حمل می‌کند', successor?.scheduleSnapshotJson, initialMeta?.scheduleSnapshotJson)
eq('successor roster immutable را نگه می‌دارد', successorSnapshot.staffIds.includes(receiver), true)
eq('successor policy اجازهٔ میان‌روز immutable را نگه می‌دارد', successorSnapshot.allowMidDayHandover, true)

const emergency = await custodyService.emergencyCover({
  userId: giver, password: 'GiverFinal382!', countedCash: 1000,
  reason: 'مسئول فعلی در دسترس نیست و کارمند PINدار باید پوشش فوری بدهد.'
})
const emergencyMeta = seed.one('SELECT planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', emergency.shiftId)
eq('Emergency Cover snapshot source را بازسازی از Settings نمی‌کند', emergencyMeta?.scheduleSnapshotJson, initialMeta?.scheduleSnapshotJson)
eq('Emergency Cover expiry اولیه را حفظ می‌کند', String(emergencyMeta?.rolloverAt), String(initialMeta?.rolloverAt))
eq('Emergency Cover label اولیه را حفظ می‌کند', emergencyMeta?.planTitle, 'شیفت immutable اصلی')
eq('Emergency Cover پایان اولیه را حفظ می‌کند', String(emergencyMeta?.scheduledEndAt), String(initialMeta?.scheduledEndAt))

const overridden = await custodyService.masterOverride({
  managerUserId: manager, managerPassword: '1111', countedCash: 1000,
  reason: 'مسئول فعلی در دسترس نیست و مدیر باید با شمارش فیزیکی مسئولیت را تحویل بگیرد.'
})
const overrideMeta = seed.one('SELECT planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', overridden.shiftId)
eq('Master Override snapshot source را بازسازی از Settings نمی‌کند', overrideMeta?.scheduleSnapshotJson, initialMeta?.scheduleSnapshotJson)
eq('Master Override expiry اولیه را حفظ می‌کند', String(overrideMeta?.rolloverAt), String(initialMeta?.rolloverAt))
eq('Master Override label اولیه را حفظ می‌کند', overrideMeta?.planTitle, 'شیفت immutable اصلی')
eq('Master Override پایان اولیه را حفظ می‌کند', String(overrideMeta?.scheduledEndAt), String(initialMeta?.scheduledEndAt))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
