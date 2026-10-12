/**
 * Auto-overtime custody recovery: no manager impersonation, immutable ledger
 * snapshots, and an incoming worker's own PIN/count starts the next drawer.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s368-custody-auto-overtime-timeout.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-timeout-s368-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0; let bad = 0
const eq = (label, got, want) => { if (got === want) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — دریافت ${String(got)}، انتظار ${String(want)}`) } }
const yes = (label, value) => eq(label, !!value, true)
const rejects = async (label, code, work) => { try { await work(); eq(label, true, false) } catch (error) { eq(label, error?.code, code) } }

const manager = seed.user('مدیر S368')
const night = seed.user('مسئول شب S368')
const morning = seed.user('تحویل‌گیرنده صبح S368')
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const minutes = (date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`
const template = {
  id: 's368-live-template', name: 'شیفت آزمون شب', startTime: minutes(new Date(now.getTime() - 5 * 60_000)), endTime: minutes(new Date(now.getTime() + 5 * 60_000)),
  isActive: true, daysMask: 127, staffIds: [night, morning], reminderRepeatMin: 15, allowMidDayHandover: true
}
seed.setting('shift.config', { byTime: true, custodyMode: 'MULTI_SHIFT', templates: [template], names: [template.name], overtimeMaxMinutes: 1 })

await custodyService.setPin({ userId: manager, newPassword: 'Manager368!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager368!' })
for (const [id, temporary, personal] of [[night, 'Night368!', 'Night3684!'], [morning, 'Morn368!', 'Morn3684!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager368!', reason: 'راه‌اندازی تست' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: personal })
}

/** Make a currently-open planned drawer look like an overnight segment whose
 * saved end is well beyond the one-minute cap. This tests the policy recovered
 * from durable metadata, not an in-process timer. */
async function expireActiveNight() {
  const active = await custodyService.status()
  const oldShiftId = active.activeShiftId
  // End one minute ago (after the actual open), but preserve an overnight
  // operational-day snapshot so this follows the non-declared hard-cap path.
  const openedAt = new Date(Date.now() - 4 * 60_000)
  const historicalEnd = new Date(Date.now() - 2 * 60_000)
  const priorOperationalDay = toJalaliDate(new Date(historicalEnd.getTime() - 24 * 60 * 60_000))
  await db.shift.update({ where: { id: oldShiftId }, data: { openedAt } })
  await db.cashMovement.updateMany({ where: { shiftId: oldShiftId }, data: { occurredAt: openedAt } })
  await db.custodyShiftMeta.update({ where: { shiftId: oldShiftId }, data: { scheduledEndAt: historicalEnd, operationalDay: priorOperationalDay } })
  const timedOut = await custodyService.status()
  return { oldShiftId, timedOut }
}

// Exact count: the accepted worker proceeds normally without a manager.
await custodyService.open({ userId: night, password: 'Night3684!', countedCash: 2_000_000 })
const exact = await expireActiveNight()
eq('سقف اضافه‌کاری نشست قبلی را بدون مدیر logically می‌بندد', exact.timedOut.state, 'NO_SESSION')
eq('وضعیت بازیابی، پروندهٔ timeout جداگانه می‌دهد', exact.timedOut.autoTimeouts.length, 1)
const exactResolution = seed.one('SELECT * FROM "CustodyResolution" WHERE shiftId=?', exact.oldShiftId)
eq('زمان policy cutoff پایدار ثبت می‌شود', !!exactResolution?.effectiveAt, true)
eq('زمان واقعی تشخیص/recovery ثبت می‌شود', !!exactResolution?.detectedAt, true)
eq('snapshot نقد، ماندهٔ افتتاحی ledger است نه شمارش ساختگی', Number(exactResolution?.nightExpectedCash), 2_000_000)
eq('snapshot کارت هم به‌صورت immutable ثبت می‌شود', Number(exactResolution?.expectedCard), 0)
eq('بستن auto نام کارمند شب را حذف نمی‌کند', seed.one('SELECT userId FROM "Shift" WHERE id=?', exact.oldShiftId)?.userId, night)
eq('بستن auto کارمند غایب را impersonate نمی‌کند', seed.one("SELECT userId FROM \"AuditLog\" WHERE action='SHIFT_CLOSE' AND entity='Shift' AND entityId=? ORDER BY id DESC", exact.oldShiftId)?.userId, null)
await rejects('بازکردن عادی قبل از شمارش تحویل‌گیرنده مسدود است', 'AUTO_TIMEOUT_ACCEPT_REQUIRED', () => custodyService.open({ userId: morning, password: 'Morn3684!', countedCash: 2_000_000 }))
const exactAccept = await custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: exactResolution.id, userId: morning, password: 'Morn3684!', countedCash: 2_000_000 })
eq('شمارش برابر بدون manager نشست جدید را باز می‌کند', exactAccept.differenceCash, 0)
eq('نشست جدید مسئول صبح را دارد', (await custodyService.status()).custodian?.id, morning)
eq('پروندهٔ شمارش برابر، اختلاف باز ندارد', seed.one('SELECT status FROM "CustodyResolution" WHERE id=?', exactResolution.id)?.status, 'RECEIVED_MATCHED')
await custodyService.finalClose({ password: 'Morn3684!', countedCash: 2_000_000, note: 'پایان چرخهٔ آزمون' })

// Difference: it remains evidence against the prior segment while actual cash
// becomes the new opening float and the fence permits normal financial work.
await custodyService.open({ userId: night, password: 'Night3684!', countedCash: 3_000_000 })
const different = await expireActiveNight()
const differenceResolution = seed.one('SELECT * FROM "CustodyResolution" WHERE shiftId=?', different.oldShiftId)
await rejects('مغایرت بدون توضیح رد می‌شود', 'AUTO_TIMEOUT_DIFFERENCE_NOTE_REQUIRED', () => custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: differenceResolution.id, userId: morning, password: 'Morn3684!', countedCash: 2_800_000 }))
const differenceAccept = await custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: differenceResolution.id, userId: morning, password: 'Morn3684!', countedCash: 2_800_000, note: 'کسری مشاهده‌شده هنگام تحویل صبح' })
eq('اختلاف مستقل با علامت درست ثبت می‌شود', differenceAccept.differenceCash, -200_000)
const savedDifference = seed.one('SELECT * FROM "CustodyResolution" WHERE id=?', differenceResolution.id)
eq('مغایرت پرونده را متوقف نمی‌کند اما رسمی نگه می‌دارد', savedDifference?.status, 'RECEIVED_DIFFERENCE')
eq('مغایرت به custodial segment قبلی نسبت داده می‌شود', savedDifference?.attributedToUserId, night)
eq('موجودی واقعی، افتتاحیهٔ نشست صبح می‌شود', Number(seed.one('SELECT amount FROM "CashMovement" WHERE shiftId=? ORDER BY id DESC', differenceAccept.shiftId)?.amount), 2_800_000)
const fence = await custodyService.actorForFinancialOperation()
eq('بعد از ثبت مغایرت فروش با نشست جدید ادامه دارد', fence?.expectedActorUserId, morning)
yes('رویداد سیستم policy cutoff را audit کرده است', seed.one("SELECT id FROM \"CustodyEvent\" WHERE type='AUTO_OVERTIME_TIMEOUT' AND shiftId=?", different.oldShiftId))
yes('رویداد پذیرش به پروندهٔ timeout وصل است', seed.one("SELECT id FROM \"CustodyEvent\" WHERE type='AUTO_OVERTIME_RECEIVER_ACCEPT' AND resolutionId=?", differenceResolution.id))

// A previous-day Shift from before custody had no CustodyShiftMeta in real
// installations. It must not strand the store waiting for a manager either.
await custodyService.finalClose({ password: 'Morn3684!', countedCash: 2_800_000, note: 'پایان چرخهٔ اختلاف آزمون' })
const legacy = await shiftService.createSession(db, { staffId: night, staffConfirmed: true, actorId: night, mode: 'MANUAL', note: 'نشست قدیمی پیش از حضانت' })
const legacyOpenedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000)
await db.shift.update({ where: { id: legacy.id }, data: { openedAt: legacyOpenedAt, dayJalali: toJalaliDate(legacyOpenedAt) } })
const recoveredLegacy = await custodyService.status()
eq('نشست جاماندهٔ بدون metadata حضانت هم بدون مدیر بازیابی می‌شود', recoveredLegacy.legacyStaleRecoveries.length, 1)
const legacyResolution = seed.one('SELECT * FROM "CustodyResolution" WHERE shiftId=?', legacy.id)
eq('بازیابی legacy زمان تشخیص را دارد ولی cutoff ساختگی ندارد', !!legacyResolution?.detectedAt && legacyResolution?.effectiveAt == null, true)
eq('نشست legacy بدون manager منطقی بسته می‌شود', !!seed.one('SELECT closedAt FROM "Shift" WHERE id=?', legacy.id)?.closedAt, true)
const legacyAccept = await custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: legacyResolution.id, userId: morning, password: 'Morn3684!', countedCash: 123_000, note: 'شمارش مستقلِ کشوی نشست جامانده' })
eq('تحویل‌گیرنده بدون manager نشست تازه را از legacy باز می‌کند', legacyAccept.countedCash, 123_000)
eq('مغایرت legacy به‌خاطر مالک شناخته‌شده به همان نشست قبلی منتسب است', seed.one('SELECT attributedToUserId FROM "CustodyResolution" WHERE id=?', legacyResolution.id)?.attributedToUserId, night)
yes('رویداد جداگانهٔ بازیابی legacy در audit مانده است', seed.one("SELECT id FROM \"CustodyEvent\" WHERE type='LEGACY_STALE_RECOVERY' AND resolutionId=?", legacyResolution.id))


// Manager master-key: a manager can take real custody despite the schedule; the
// selected manager is the owner, never an impersonated absent cashier.
await custodyService.finalClose({ password: 'Morn3684!', countedCash: 123_000, note: 'پایان بازیابی legacy' })
await custodyService.open({ userId: manager, managerOverride: true, managerPassword: '1111', countedCash: 456_000, note: 'پوشش اضطراری مدیر' })
const masterOpened = await custodyService.status()
eq('رمز اصلی مدیر، برنامهٔ عادی شیفت را دور می‌زند', masterOpened.custodian?.id, manager)
eq('مسئولیت override به نام خود مدیر ثبت می‌شود', seed.one('SELECT openAuth FROM "CustodyShiftMeta" WHERE shiftId=?', masterOpened.activeShiftId)?.openAuth, 'MANAGER_MASTER_OVERRIDE')
yes('رویداد override مدیر در audit حضانت باقی می‌ماند', seed.one(`SELECT id FROM \"CustodyEvent\" WHERE type='OPEN_MANAGER_OVERRIDE' AND actorUserId=?`, manager))
await custodyService.finalClose({ password: 'Manager368!', countedCash: 456_000, note: 'پایان پوشش مدیر' })

// A policy switch creates an independent recovery boundary without requiring
// the former worker to return. The receiver's count starts the next segment.
await custodyService.open({ userId: night, password: 'Night3684!', countedCash: 700_000 })
const policyOld = (await custodyService.status()).activeShiftId
await db.$transaction((tx) => custodyService.transitionCustodyModeInTx(tx, { from: 'MULTI_SHIFT', to: 'SINGLE_SHIFT', actorUserId: manager }))
await custodyService.ensurePendingAutoTimeoutSnapshots()
const policyStatus = await custodyService.status()
eq('تغییر حالت شیفت مسئول پیشین را بدون حضور او منطقی می‌بندد', policyStatus.state, 'NO_SESSION')
eq('تغییر حالت شیفت پروندهٔ شمارش تحویل‌گیرنده می‌سازد', policyStatus.policyTransitions.length, 1)
yes('بستن policy transition برای بخش قبلی audit شده است', seed.one(`SELECT id FROM \"CustodyEvent\" WHERE type='CUSTODY_MODE_TRANSITION' AND shiftId=?`, policyOld))
const policyResolution = seed.one('SELECT * FROM "CustodyResolution" WHERE shiftId=?', policyOld)
const policyAccept = await custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: policyResolution.id, userId: morning, password: 'Morn3684!', countedCash: 690_000, note: 'شمارش پس از تغییر سیاست' })
eq('اختلاف policy transition به بخش قبلی نسبت می‌ماند', policyAccept.differenceCash, -10_000)
eq('شمارش سیاست جدید افتتاحیهٔ مستقل مسئول بعدی می‌شود', (await custodyService.status()).custodian?.id, morning)
await custodyService.finalClose({ password: 'Morn3684!', countedCash: 690_000, note: 'پایان policy transition' })

// Deactivation recovery uses the same safe boundary and revokes the old PIN;
// no unavailable employee can leave an active drawer permanently locked.
await custodyService.open({ userId: night, password: 'Night3684!', countedCash: 800_000 })
const deactivationOld = (await custodyService.status()).activeShiftId
await db.$transaction((tx) => custodyService.releaseStaffForDeactivationInTx(tx, { userId: night, actorUserId: manager }))
await custodyService.ensurePendingAutoTimeoutSnapshots()
const deactivationResolution = seed.one('SELECT * FROM "CustodyResolution" WHERE shiftId=?', deactivationOld)
eq('غیرفعال‌سازی مسئول فعال صندوق را آزادِ بازیابی می‌کند', (await custodyService.status()).state, 'NO_SESSION')
eq('بستن برای غیرفعال‌سازی پروندهٔ جدا دارد', deactivationResolution?.evidence, 'STAFF_DEACTIVATION_EXPECTED')
const deactivationAccept = await custodyService.acceptAutomaticOvertimeTimeout({ resolutionId: deactivationResolution.id, userId: morning, password: 'Morn3684!', countedCash: 810_000, note: 'شمارش پس از غیرفعال‌سازی مسئول قبلی' })
eq('تحویل‌گیرنده پس از غیرفعال‌سازی با PIN خودش ادامه می‌دهد', deactivationAccept.countedCash, 810_000)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
