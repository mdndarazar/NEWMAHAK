/**
 * Scheduled custody expires at scheduled end + configured overtime, not at a
 * cutover. An active morning worker can witness/recover the old segment with
 * their own PIN and physical count; the absent former custodian and a manager
 * are not authentication dependencies.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s376-unattended-scheduled-recovery.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-unattended-s376-'))
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
const truthy = (label, value) => eq(label, !!value, true)
const minutes = (date) => date.getHours() * 60 + date.getMinutes()
const hm = (total) => {
  const minute = ((total % 1440) + 1440) % 1440
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

const manager = seed.user('مدیر S376')
const nightWorker = seed.user('مسئول شب S376')
const morningWitness = seed.user('شاهد صبح S376')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', morningWitness)
const now = new Date()
const startMinute = minutes(now) - 5
const endMinute = minutes(now) + 5
seed.setting(SETTING_KEYS.shiftConfig, {
  byTime: true,
  custodyMode: 'SINGLE_SHIFT',
  overtimeMaxMinutes: 30,
  templates: [{
    id: 's376-scheduled', name: 'شیفت زمان‌بندی‌شدهٔ S376', startTime: hm(startMinute), endTime: hm(endMinute),
    isActive: true, daysMask: 127, staffIds: [nightWorker, morningWitness], reminderRepeatMin: 15, allowMidDayHandover: true
  }]
})

await custodyService.setPin({ userId: manager, newPassword: 'Manager376!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager376!' })
for (const [id, temporary, permanent] of [[nightWorker, 'Night376!', 'Night3764!'], [morningWitness, 'Morning376!', 'Morning3764!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager376!', reason: 'راه‌اندازی آزمون شب' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: nightWorker, password: 'Night3764!', countedCash: 1000 })
const meta = seed.one('SELECT scheduledEndAt, rolloverAt FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)
const scheduledEnd = new Date(meta?.scheduledEndAt)
const persistedExpiry = new Date(meta?.rolloverAt)
eq('نشست canonical زمان پایان snapshot دارد', Number.isFinite(scheduledEnd.getTime()), true)
eq('انقضای scheduled برابر پایان برنامه + overtime پیکربندی‌شده است', persistedExpiry.getTime(), scheduledEnd.getTime() + 30 * 60_000)

const beforeExpiry = new Date(scheduledEnd.getTime() + 29 * 60_000)
eq('قبل از پایان overtime، rollover رخ نمی‌دهد', await custodyService.ensureRolledOver(beforeExpiry), null)
eq('قبل از پایان overtime، مسئول شب همچنان فعال است', (await custodyService.status()).custodian?.id, nightWorker)

const afterExpiry = new Date(scheduledEnd.getTime() + 31 * 60_000)
const rollover = await custodyService.ensureRolledOver(afterExpiry)
truthy('بعد از پایان overtime، پروندهٔ unattended ساخته می‌شود', rollover?.resolutionId > 0)
eq('state پس از rollover برای شروع روز تازه آزاد است', (await custodyService.status()).state, 'NO_SESSION')
const closedShift = seed.one('SELECT closedAt FROM "Shift" WHERE id=?', opened.shiftId)
eq('پایان مالی segment شب در لحظهٔ expiry می‌ماند، نه زمان کشف صبح', new Date(closedShift?.closedAt).getTime(), persistedExpiry.getTime())
const beforeRecovery = seed.one('SELECT nightExpectedCash, status FROM "CustodyResolution" WHERE id=?', rollover?.resolutionId)
eq('expected شب پیش از شمارش فیزیکی محفوظ است', Number(beforeRecovery?.nightExpectedCash), 1000)
eq('پرونده قبل از شاهد صبح باز است', beforeRecovery?.status, 'OPEN')
const rolloverEvent = seed.one('SELECT payloadJson FROM "CustodyEvent" WHERE resolutionId=? AND type=? ORDER BY id DESC LIMIT 1', rollover?.resolutionId, 'ROLLOVER_UNRESOLVED')
const rolloverPayload = JSON.parse(rolloverEvent?.payloadJson ?? '{}')
eq('audit rollover زمان مؤثر scheduled را نگه می‌دارد', rolloverPayload.effectiveAt, persistedExpiry.toISOString())
eq('audit rollover صریحاً scheduled overtime را از cutover جدا می‌کند', rolloverPayload.expiryKind, 'SCHEDULED_END_PLUS_OVERTIME')

const note = 'شمارش شاهد صبح پس از بازماندن شیفت شب انجام شد.'
const recovered = await custodyService.recoverUnattended({
  resolutionId: rollover?.resolutionId,
  userId: morningWitness,
  password: 'Morning3764!',
  countedCash: 930,
  note
})
truthy('شاهد صبح بدون PIN مدیر/مسئول قبلی CashSession شب را ثبت می‌کند', recovered.session?.id > 0)
const resolution = seed.one('SELECT status, nightExpectedCash, morningWitnessCountId, provisionalDifference, evidence, differenceAttribution, cashSessionId FROM "CustodyResolution" WHERE id=?', rollover?.resolutionId)
eq('پرونده پس از شمارش شاهد بسته می‌شود', resolution?.status, 'RESOLVED')
eq('snapshot expected شب پس از recovery تغییر نمی‌کند', Number(resolution?.nightExpectedCash), 1000)
eq('مغایرت شاهد صبح کنار پرونده می‌ماند', Number(resolution?.provisionalDifference), -70)
eq('نوع شاهد صبح صریح است', resolution?.evidence, 'MORNING_WITNESS')
eq('بدون مدیر، اختلاف به شخص جدید منتسب نمی‌شود', resolution?.differenceAttribution, 'UNASSIGNED')
const witnessCount = seed.one('SELECT shiftId, kind, countedCash, expectedCash, differenceCash, countedByUserId, authMethod, note FROM "CustodyCount" WHERE id=?', resolution?.morningWitnessCountId)
eq('شمارش witness به segment شب وصل است', witnessCount?.shiftId, opened.shiftId)
eq('نوع شمارش morning witness است', witnessCount?.kind, 'MORNING_WITNESS')
eq('شمارش فیزیکی صبح جدا از expected نگه داشته می‌شود', Number(witnessCount?.countedCash), 930)
eq('expected شب در evidence witness باقی می‌ماند', Number(witnessCount?.expectedCash), 1000)
eq('actor واقعی شمارش فقط شاهد PINدار است', witnessCount?.countedByUserId, morningWitness)
eq('روش احراز شاهد، PIN شخصی است', witnessCount?.authMethod, 'CUSTODY_PIN')
eq('یادداشت شاهد کنار شمارش می‌ماند', witnessCount?.note, note)
const session = seed.one('SELECT shiftId, expectedCash, countedTotal, cashDifference, closedBy, toDate FROM "CashSession" WHERE id=?', resolution?.cashSessionId)
eq('CashSession روی segment شب ثبت شده است', session?.shiftId, opened.shiftId)
eq('CashSession expected را حفظ می‌کند', Number(session?.expectedCash), 1000)
eq('CashSession شمارش شاهد را نگه می‌دارد', Number(session?.countedTotal), 930)
eq('CashSession اختلاف witness را نگه می‌دارد', Number(session?.cashDifference), -70)
eq('بستن مالی به نام شاهد صبح audit می‌شود', session?.closedBy, morningWitness)
eq('بازهٔ مالی شب در expiry خاتمه می‌یابد', new Date(session?.toDate).getTime(), persistedExpiry.getTime())
const event = seed.one('SELECT type, shiftId, resolutionId, actorUserId, actorKind, authMethod FROM "CustodyEvent" WHERE resolutionId=? ORDER BY id DESC LIMIT 1', rollover?.resolutionId)
eq('رویداد بازیابی اختصاصی ثبت می‌شود', event?.type, 'UNATTENDED_RECOVERED')
eq('رویداد به پرونده و segment شب وصل است', event?.shiftId, opened.shiftId)
eq('actor رویداد، شاهد صبح است', event?.actorUserId, morningWitness)
eq('actorKind شاهد صبح است', event?.actorKind, 'MORNING_WITNESS')
eq('رویداد نیز PIN شخصی را ثبت می‌کند', event?.authMethod, 'CUSTODY_PIN')
eq('recovery به‌تنهایی نشست AUTO صبح نمی‌سازد', Number(seed.one('SELECT COUNT(*) AS n FROM "Shift"').n), 1)

const morningOpen = await custodyService.open({ userId: morningWitness, password: 'Morning3764!', countedCash: 930 })
eq('مسئول صبح با PIN/شمارش خودش نشست تازه باز می‌کند', (await custodyService.status()).custodian?.id, morningWitness)
eq('نشست صبح از segment شب جدا است', morningOpen.shiftId > opened.shiftId, true)

// No active canonical assignment means this is deliberately an unscheduled
// segment, so only the persisted day-cutover fallback may govern its expiry.
await custodyService.finalClose({ password: 'Morning3764!', countedCash: 930, note: 'بستن آزمون صبح بدون فروش برای بررسی fallback' })
seed.setting(SETTING_KEYS.shiftConfig, { byTime: false, custodyMode: 'SINGLE_SHIFT', templates: [] })
const fallbackOpenedAt = new Date()
const unscheduled = await custodyService.open({ userId: morningWitness, password: 'Morning3764!', countedCash: 0 })
const unscheduledMeta = seed.one('SELECT templateId, scheduledEndAt, rolloverAt FROM "CustodyShiftMeta" WHERE shiftId=?', unscheduled.shiftId)
const expectedCutover = new Date(fallbackOpenedAt)
expectedCutover.setHours(5, 0, 0, 0)
if (expectedCutover <= fallbackOpenedAt) expectedCutover.setDate(expectedCutover.getDate() + 1)
eq('نشست بی‌برنامه template ندارد', unscheduledMeta?.templateId, null)
eq('نشست بی‌برنامه scheduled end ندارد', unscheduledMeta?.scheduledEndAt, null)
eq('فقط نشست بی‌برنامه از cutover fallback استفاده می‌کند', new Date(unscheduledMeta?.rolloverAt).getTime(), expectedCutover.getTime())

const source = readFileSync(new URL('../../src/renderer/src/components/CustodyChip.tsx', import.meta.url), 'utf8')
eq('UI بازیابی صبح PIN شاهد را به IPC رسمی می‌فرستد', source.includes('CH.custodyUnattendedRecover') && source.includes('userId: selectedUserId'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
