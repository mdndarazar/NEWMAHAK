/**
 * Custody v2 foundation characterization:
 * - feature flag defaults off and legacy rows remain untouched;
 * - personal credentials are salted/temporary-on-manager-reset;
 * - opening, atomic handover/cancel, final close/disposition and unresolved
 *   rollover preserve one accountable Shift and never create CashSession early.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s346-custody-foundation.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-s346-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { custodyPlanService } = await import('../../src/main/services/CustodyPlanService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`)
  }
}
const truthy = (label, value) => eq(label, !!value, true)

const manager = seed.user('مدیر', { role: 'MANAGER' })
const a = seed.user('صندوقدار الف', { role: 'CASHIER' })
const b = seed.user('صندوقدار ب', { role: 'CASHIER' })

const pristineStatus = await custodyService.status()
eq('feature flag پیش‌فرض خاموش است', pristineStatus.enabled, false)
eq('پیکربندی پیش‌فرض تک‌شیفت است', pristineStatus.config.mode, 'SINGLE_SHIFT')
try {
  await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: 'رمز-نادرست' })
  eq('تعریف نخستین رمز مدیر بدون رمز موجود رد می‌شود', true, false)
} catch {
  eq('تعریف نخستین رمز مدیر بدون رمز موجود رد می‌شود', true, true)
}
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })

await custodyService.setPin({ userId: a, newPassword: 'A123456', managerUserId: manager, managerPassword: 'مدیر123!', reason: 'تعریف اولیه' })
try {
  await custodyService.open({ userId: a, password: 'A123456', countedCash: 1000 })
  eq('رمز موقت نباید صندوق باز کند', true, false)
} catch (error) {
  eq('رمز موقت فقط تغییر رمز را می‌خواهد', error?.code, 'PIN_MUST_CHANGE')
}
await custodyService.setPin({ userId: a, currentPassword: 'A123456', newPassword: 'A123457!' })
await custodyService.setPin({ userId: b, newPassword: 'B123456', managerUserId: manager, managerPassword: 'مدیر123!', reason: 'تعریف اولیه' })
await custodyService.setPin({ userId: b, currentPassword: 'B123456', newPassword: 'B123457!' })
const now = new Date()
try {
  await custodyService.setConfig({ config: { enabled: true, mode: 'MULTI_SHIFT', overrunGraceMinutes: 0 }, managerUserId: manager, managerPassword: 'مدیر123!' })
  eq('چندشیفت بدون برنامهٔ دارای کارمند رد می‌شود', true, false)
} catch (error) {
  eq('چندشیفت بدون برنامهٔ دارای کارمند رد می‌شود', error?.code, 'CUSTODY_MULTI_SHIFT_NEEDS_PLAN')
}
await custodyPlanService.save({ title: 'برنامه آزمایشی', startMinute: now.getHours() * 60, durationMinutes: 120, daysMask: 1 << now.getDay(), staffIds: [a], managerUserId: manager, managerPassword: 'مدیر123!' })
await custodyService.setConfig({ config: { enabled: true, mode: 'MULTI_SHIFT', overrunGraceMinutes: 0 }, managerUserId: manager, managerPassword: 'مدیر123!' })

const opened = await custodyService.open({ userId: a, password: 'A123457!', countedCash: 1000 })
eq('افتتاح حضانت نشست مشخص می‌سازد', opened.countStatus, 'COUNTED')
eq('یک Shift باز وجود دارد', db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift" WHERE closedAt IS NULL').get().n, 1)
eq('برنامهٔ اختیاری فقط به نشست واقعی الصاق می‌شود', (await custodyService.status()).schedule?.title, 'برنامه آزمایشی')

const firstFence = await custodyService.actorForFinancialOperation()
const handover = await custodyService.handoverStart({ password: 'A123457!', countedCash: 1000, toUserId: b, idempotencyKey: 's346-a-b' })
eq('شروع تحویل تنها قفل جدید فروش است', handover.state, 'HANDOVER_PENDING')
try {
  await db.$transaction((tx) => custodyService.assertFenceInTx(tx, firstFence))
  eq('fence قدیمی پس از شروع تحویل رد می‌شود', true, false)
} catch (error) {
  eq('fence قدیمی پس از شروع تحویل رد می‌شود', error?.code, 'CUSTODY_STALE')
}
eq('تحویل CashSession نمی‌سازد', db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 0)
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'B123457!', countedCash: 1000 })
truthy('پذیرش تحویل Shift جدید می‌سازد', accepted.shiftId > opened.shiftId)
eq('پس از تحویل فقط یک Shift باز است', db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift" WHERE closedAt IS NULL').get().n, 1)
eq('Shift جدید به گیرنده منتسب است', db.$harness.db.prepare('SELECT userId FROM "Shift" WHERE id=?').get(accepted.shiftId).userId, b)

const canceled = await custodyService.handoverStart({ password: 'B123457!', countedCash: 1000, toUserId: a, idempotencyKey: 's346-b-a' })
await custodyService.handoverCancel({ handoverId: canceled.id, password: 'B123457!' })
eq('لغو تحویل Shift جدید نمی‌سازد', db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n, 2)
eq('لغو، مسئولیت را به تحویل‌دهنده برمی‌گرداند', (await custodyService.status()).custodian.id, b)

const final = await custodyService.finalClose({
  password: 'B123457!',
  countedCash: 1000,
  note: 'بستن بدون فروش برای آزمون حضانت',
  dispositions: [{ kind: 'TO_MANAGER', amount: 1000, recipientUserId: manager }]
})
truthy('بستن نهایی CashSession می‌سازد', final.session.id > 0)
eq('جمع disposition دقیقاً شمارش است', Number(db.$harness.db.prepare('SELECT SUM(amount) AS n FROM "CustodyDisposition" WHERE cashSessionId=?').get(final.session.id).n), 1000)
const disposition = db.$harness.db.prepare('SELECT id, confirmStatus FROM "CustodyDisposition" WHERE cashSessionId=?').get(final.session.id)
eq('تحویل به مدیر ابتدا در انتظار تأیید مدیر می‌ماند', disposition.confirmStatus, 'CLAIMED')
await custodyService.confirmDisposition({ dispositionId: disposition.id, userId: manager, password: 'مدیر123!' })
eq('مدیر منتخب با PIN خودش تحویل را تأیید می‌کند', db.$harness.db.prepare('SELECT confirmStatus FROM "CustodyDisposition" WHERE id=?').get(disposition.id).confirmStatus, 'CONFIRMED')
await custodyService.reverseDisposition({ dispositionId: disposition.id, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'اصلاح مستند محل نگهداری نقد پس از ثبت نهایی' })
eq('برگشت disposition تاریخچه را پاک نمی‌کند', db.$harness.db.prepare('SELECT confirmStatus FROM "CustodyDisposition" WHERE id=?').get(disposition.id).confirmStatus, 'REVERSED')
eq('بستن نهایی state را NO_SESSION می‌کند', (await custodyService.status()).state, 'NO_SESSION')

const reopened = await custodyService.open({ userId: a, password: 'A123457!', countedCash: 700 })
db.$harness.db.prepare('UPDATE "CustodyShiftMeta" SET rolloverAt=? WHERE shiftId=?').run(Date.now() - 1_000, reopened.shiftId)
const rollover = await custodyService.ensureRolledOver()
truthy('rollover پرونده unresolved می‌سازد', rollover?.resolutionId > 0)
eq('rollover CashSession جدید نمی‌سازد', db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 1)
eq('rollover فروش را با state مسدود نمی‌کند', (await custodyService.status()).state, 'NO_SESSION')
await custodyService.open({ userId: b, password: 'B123457!', countedCash: 700 })
const resolved = await custodyService.resolveUnresolved({
  resolutionId: rollover.resolutionId,
  managerUserId: manager,
  managerPassword: 'مدیر123!',
  countedCash: 700,
  reason: 'شمارش صبح و تعیین تکلیف مستند نشست شب بازمانده',
  attribution: 'UNASSIGNED'
})
truthy('حل unresolved CashSession شب را ثبت می‌کند', resolved.session.id > final.session.id)
eq('حل شب، نشست صبح فعال را نمی‌بندد', (await custodyService.status()).custodian.id, b)
const report = await custodyService.report({ managerUserId: manager, managerPassword: 'مدیر123!' })
truthy('گزارش مدیر، ردپای تحویل و شمارش را برمی‌گرداند', report.counts.length >= 3 && report.handovers.length >= 2)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
