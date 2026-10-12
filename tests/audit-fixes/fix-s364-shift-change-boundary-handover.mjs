/**
 * The final 15 minutes are a shift-change handover, not a mid-day replacement:
 * source permission is irrelevant and the recipient's next-template snapshot is
 * carried into the new drawer segment.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s364-shift-change-boundary-handover.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-boundary-s364-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0; let bad = 0
const eq = (label, got, want) => { if (got === want) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) } }
const hm = (minute) => `${String(Math.floor(((minute % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((minute % 60) + 60) % 60).padStart(2, '0')}`

const manager = seed.user('مدیر S364')
const giver = seed.user('کارمند پایان شیفت S364')
const receiver = seed.user('کارمند شیفت بعد S364')
const now = new Date()
const minute = now.getHours() * 60 + now.getMinutes()
const endMinute = minute + 5 // within the documented fifteen-minute boundary
seed.setting(SETTING_KEYS.shiftConfig, {
  custodyMode: 'MULTI_SHIFT', byTime: true, reminderEnabled: true, overrunGraceMinutes: 0,
  templates: [
    { id: 's364-source', name: 'شیفت در حال پایان', startTime: hm(minute - 30), endTime: hm(endMinute), isActive: true, daysMask: 1 << now.getDay(), staffIds: [giver], reminderRepeatMin: 15, allowMidDayHandover: false },
    { id: 's364-next', name: 'شیفت بعدی', startTime: hm(endMinute), endTime: hm(endMinute + 120), isActive: true, daysMask: 1 << now.getDay(), staffIds: [receiver], reminderRepeatMin: 15, allowMidDayHandover: false }
  ]
})
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
for (const [id, temp, perm] of [[giver, 'Giver364!', 'Giver3644!'], [receiver, 'Recv364!', 'Recv3644!']]) {
  await custodyService.setPin({ userId: id, newPassword: temp, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'راه‌اندازی' })
  await custodyService.setPin({ userId: id, currentPassword: temp, newPassword: perm })
}
const opened = await custodyService.open({ userId: giver, password: 'Giver3644!', countedCash: 0 })
const handover = await custodyService.handoverStart({ password: 'Giver3644!', countedCash: 0, toUserId: receiver, idempotencyKey: 's364-boundary' })
eq('مرز پایانی با وجود بسته بودن مجوز mid-day شروع می‌شود', handover.state, 'HANDOVER_PENDING')
const watermark = JSON.parse(seed.one('SELECT ledgerWatermark FROM "CustodyHandover" WHERE id=?', handover.id)?.ledgerWatermark ?? '{}')
eq('watermark نوع shift-change را snapshot می‌کند', watermark.handoverKind, 'SHIFT_CHANGE')
eq('watermark قالب برنامهٔ گیرنده را snapshot می‌کند', watermark.incomingSchedule?.templateId, 's364-next')
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'Recv3644!', countedCash: 0 })
const incoming = seed.one('SELECT templateId, planTitle FROM "CustodyShiftMeta" WHERE shiftId=?', accepted.shiftId)
eq('segment جدید به قالب شیفت بعدی وصل است', incoming?.templateId, 's364-next')
eq('نام snapshot شیفت بعدی حفظ می‌شود', incoming?.planTitle, 'شیفت بعدی')
eq('segment مبدأ با تحویل بسته شده است', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'HANDED_OVER')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
