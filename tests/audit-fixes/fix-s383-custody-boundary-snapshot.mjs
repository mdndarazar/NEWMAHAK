/**
 * Phase 3a boundary continuity: a shift-change handover records the incoming
 * template policy when the giver starts the handover. Settings edits while the
 * PIN/count acceptance is pending must not rewrite the receiver's new segment.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s383-custody-boundary-snapshot.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-boundary-snapshot-s383-'))
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

const manager = seed.user('مدیر S383')
const giver = seed.user('تحویل‌دهنده S383')
const receiver = seed.user('تحویل‌گیرنده S383')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', giver, receiver)

const now = new Date()
const minute = now.getHours() * 60 + now.getMinutes()
const outgoing = {
  id: 'outgoing-s383', name: 'شیفت خروجی S383', startTime: hm(minute - 20), endTime: hm(minute + 10),
  isActive: true, daysMask: 1 << now.getDay(), staffIds: [giver], reminderRepeatMin: 15, allowMidDayHandover: false
}
const incoming = {
  id: 'incoming-s383', name: 'شیفت ورودی ثبت‌شده', startTime: hm(minute + 10), endTime: hm(minute + 100),
  isActive: true, daysMask: 1 << now.getDay(), staffIds: [receiver], reminderRepeatMin: 19, allowMidDayHandover: true
}
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true, custodyMode: 'MULTI_SHIFT', custodyModeConfigured: true,
  reminderEnabled: true, overrunGraceMinutes: 6, overtimeMaxMinutes: 27,
  templates: [outgoing, incoming]
})

await custodyService.setPin({ userId: manager, newPassword: 'Manager383!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager383!' })
for (const [id, temporary, permanent] of [[giver, 'GiverTemp383!', 'GiverFinal383!'], [receiver, 'ReceiverTemp383!', 'ReceiverFinal383!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager383!', reason: 'راه‌اندازی آزمون boundary snapshot' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: giver, password: 'GiverFinal383!', countedCash: 500 })
const started = await custodyService.handoverStart({ password: 'GiverFinal383!', countedCash: 500, toUserId: receiver, idempotencyKey: 's383-boundary' })
const watermark = JSON.parse(seed.one('SELECT ledgerWatermark FROM "CustodyHandover" WHERE id=?', started.id)?.ledgerWatermark ?? '{}')
const captured = JSON.parse(watermark?.incomingSchedule?.scheduleSnapshotJson ?? '{}')
eq('handover مرزی kind صریح SHIFT_CHANGE دارد', watermark.handoverKind, 'SHIFT_CHANGE')
eq('watermark نام برنامهٔ ورودی را پیش از پذیرش ذخیره می‌کند', captured.title, 'شیفت ورودی ثبت‌شده')
eq('watermark cadence برنامهٔ ورودی را پیش از پذیرش ذخیره می‌کند', captured.reminderRepeatMin, 19)
eq('watermark overtime برنامهٔ ورودی را پیش از پذیرش ذخیره می‌کند', captured.overtimeMaxMinutes, 27)
eq('watermark roster برنامهٔ ورودی را پیش از پذیرش ذخیره می‌کند', captured.staffIds.includes(receiver), true)

// These are future-policy edits after the giver's boundary handover is already
// durably pending. They must not replace the incoming snapshot in its watermark.
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true, custodyMode: 'SINGLE_SHIFT', custodyModeConfigured: true,
  singleShiftCustodianUserId: giver, reminderEnabled: false, overrunGraceMinutes: 0, overtimeMaxMinutes: 0,
  templates: [{
    ...incoming, name: 'شیفت ورودیِ تغییر یافته', endTime: hm(minute + 300), staffIds: [giver],
    reminderRepeatMin: 59, allowMidDayHandover: false
  }]
})

const accepted = await custodyService.handoverAccept({ handoverId: started.id, password: 'ReceiverFinal383!', countedCash: 500 })
const received = seed.one('SELECT templateId, planTitle, scheduledEndAt, rolloverAt, scheduleSnapshotJson FROM "CustodyShiftMeta" WHERE shiftId=?', accepted.shiftId)
const receivedSnapshot = JSON.parse(received?.scheduleSnapshotJson ?? '{}')
eq('segment گیرنده identity template captureشده را می‌گیرد', received?.templateId, 'incoming-s383')
eq('rename بعدی، label segment گیرنده را عوض نمی‌کند', received?.planTitle, 'شیفت ورودی ثبت‌شده')
eq('snapshot segment گیرنده دقیقاً همان watermark captureشده است', received?.scheduleSnapshotJson, watermark.incomingSchedule.scheduleSnapshotJson)
eq('cadence جدید Settings جای cadence watermark را نمی‌گیرد', receivedSnapshot.reminderRepeatMin, 19)
eq('overtime جدید Settings جای overtime watermark را نمی‌گیرد', receivedSnapshot.overtimeMaxMinutes, 27)
eq('roster جدید Settings جای roster watermark را نمی‌گیرد', receivedSnapshot.staffIds.includes(receiver), true)
eq('اجازهٔ میان‌روز جدید Settings جای policy watermark را نمی‌گیرد', receivedSnapshot.allowMidDayHandover, true)
eq('پایان segment گیرنده همان پایان captureشده است', new Date(received?.scheduledEndAt).toISOString(), captured.scheduledEndAt)
eq('expiry segment گیرنده از overtime captureشده محاسبه می‌شود', new Date(received?.rolloverAt).getTime(), new Date(captured.scheduledEndAt).getTime() + 27 * 60_000)
eq('مسئولیت واقعی فقط پس از PIN/count گیرنده منتقل شده است', (await custodyService.status()).custodian?.id, receiver)
eq('segment خروجی واقعا خاتمه یافته است', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'HANDED_OVER')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
