/**
 * Emergency cover is not a name-only legacy handover: the active cover worker
 * proves their own PIN, counts the physical drawer, gives a mandatory reason,
 * and becomes the next accountable custodian without a PIN from the absent
 * prior worker or a manager.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s377-emergency-cover-accountability.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-emergency-cover-s377-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { CashMovementType } = await import('@shared/enums')

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

const manager = seed.user('مدیر S377')
const absentCustodian = seed.user('مسئول غایب S377')
const cover = seed.user('پوشش‌دهنده S377')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', cover)
await custodyService.setPin({ userId: manager, newPassword: 'Manager377!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager377!' })
for (const [id, temporary, permanent] of [[absentCustodian, 'Absent377!', 'Absent3774!'], [cover, 'Cover377!', 'Cover3774!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager377!', reason: 'راه‌اندازی پوشش اضطراری' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: absentCustodian, password: 'Absent3774!', countedCash: 1000 })
await rejects('دلیل کوتاه حتی با PIN کارمند فعال رد می‌شود', 'EMERGENCY_REASON_REQUIRED', () => custodyService.emergencyCover({ userId: cover, password: 'Cover3774!', countedCash: 900, reason: 'کم' }))
eq('دلیل کوتاه هیچ مسئولیتی را تغییر نمی‌دهد', (await custodyService.status()).custodian?.id, absentCustodian)

const reason = 'مسئول قبلی محل را ترک کرده و صندوق باید فوراً پوشش داده شود.'
// Hold the server-only expected calculation after the freeze to prove that no
// financial writer can pass through the transition on the prior custodian.
const expectedPreview = await cashboxService.expected({ shiftId: opened.shiftId, countedCash: 900 })
const originalExpected = cashboxService.expected
let enteredFreeze = null
const entered = new Promise((resolve) => { enteredFreeze = resolve })
let releaseExpected = null
const release = new Promise((resolve) => { releaseExpected = resolve })
cashboxService.expected = async () => { enteredFreeze?.(); return release }
const emergencyPromise = custodyService.emergencyCover({ userId: cover, password: 'Cover3774!', countedCash: 900, reason })
await entered
await rejects('freeze پوشش اضطراری، writer مالیِ prior custodian را رد می‌کند', 'HANDOVER_RECOUNT', () => custodyService.actorForFinancialOperation())
releaseExpected?.(expectedPreview)
const emergency = await emergencyPromise
cashboxService.expected = originalExpected
eq('اختلاف emergency از شمارش واقعی پوشش‌دهنده می‌آید', emergency.differenceCash, -100)
eq('مسئولیت فعال فوراً به کارمند پوشش‌دهنده منتقل می‌شود', (await custodyService.status()).custodian?.id, cover)

const evidence = seed.one('SELECT shiftId, kind, countedCash, expectedCash, differenceCash, countedByUserId, authMethod, note FROM "CustodyCount" WHERE id=(SELECT outCountId FROM "CustodyHandover" WHERE id=?)', emergency.handoverId)
eq('شمارش emergency به segment مسئول قبلی وصل است', evidence?.shiftId, opened.shiftId)
eq('نوع evidence emergency صریح است', evidence?.kind, 'EMERGENCY_COVER_COUNT')
eq('expected ledger و physical count جدا ثبت می‌شوند', Number(evidence?.expectedCash), 1000)
eq('physical count متعلق به کارمند پوشش‌دهنده است', Number(evidence?.countedCash), 900)
eq('اختلاف روی prior segment ثبت است', Number(evidence?.differenceCash), -100)
eq('actor شمارش همان کارمند PINدار پوشش‌دهنده است', evidence?.countedByUserId, cover)
eq('روش احراز emergency PIN شخصی است', evidence?.authMethod, 'CUSTODY_PIN')
eq('دلیل اضطراری append-only کنار count می‌ماند', evidence?.note, reason)

const handover = seed.one('SELECT fromShiftId, fromUserId, selectedRecipientUserId, finalCustodianUserId, status, resolutionKind, resolutionReason, toShiftId, differenceCash FROM "CustodyHandover" WHERE id=?', emergency.handoverId)
eq('پرونده emergency prior shift را نگه می‌دارد', handover?.fromShiftId, opened.shiftId)
eq('مسئول قبلی فقط prior custodian است، نه actor emergency', handover?.fromUserId, absentCustodian)
eq('کارمند انتخاب‌شده برای cover همان PINدار واقعی است', handover?.selectedRecipientUserId, cover)
eq('نتیجه پرونده emergency کامل است', handover?.status, 'COMPLETED')
eq('نوع نتیجه emergency متمایز است', handover?.resolutionKind, 'EMERGENCY_COVER_COMPLETED')
eq('دلیل emergency در پرونده باقی می‌ماند', handover?.resolutionReason, reason)
eq('مسئول نهایی cover worker است', handover?.finalCustodianUserId, cover)
eq('اختلاف پرونده همان شمارش واقعی است', Number(handover?.differenceCash), -100)

eq('segment قبلی با endKind emergency بسته می‌شود', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'EMERGENCY_COVERED')
const incomingMeta = seed.one('SELECT custodianUserId, openAuth, countStatus FROM "CustodyShiftMeta" WHERE shiftId=?', emergency.shiftId)
eq('metadata segment جدید متعلق به cover worker است', incomingMeta?.custodianUserId, cover)
eq('راه احراز segment جدید emergency PIN است', incomingMeta?.openAuth, 'EMERGENCY_COVER_PIN')
eq('segment جدید شمارش‌شده شروع می‌شود', incomingMeta?.countStatus, 'COUNTED')
const incomingShift = seed.one('SELECT userId, openedVia FROM "Shift" WHERE id=?', emergency.shiftId)
eq('Shift جدید مسئول واقعی cover را دارد', incomingShift?.userId, cover)
eq('Shift جدید نوع emergency cover دارد', incomingShift?.openedVia, 'EMERGENCY_COVER')
eq('opening float segment جدید از شمارش واقعی cover است', Number(seed.one('SELECT amount FROM "CashMovement" WHERE shiftId=? AND type=?', emergency.shiftId, CashMovementType.OPENING_FLOAT)?.amount), 900)

const event = seed.one('SELECT type, shiftId, actorUserId, actorKind, authMethod, payloadJson FROM "CustodyEvent" WHERE handoverId=? ORDER BY id DESC LIMIT 1', emergency.handoverId)
eq('رویداد emergency تکمیل‌شده متمایز است', event?.type, 'EMERGENCY_COVER_COMPLETED')
eq('رویداد به segment prior متصل می‌ماند', event?.shiftId, opened.shiftId)
eq('actor رویداد cover worker است، نه مسئول غایب', event?.actorUserId, cover)
eq('actorKind emergency صریح است', event?.actorKind, 'EMERGENCY_COVER')
eq('PIN شخصی در رویداد ثبت می‌شود', event?.authMethod, 'CUSTODY_PIN')
const payload = JSON.parse(event?.payloadJson ?? '{}')
eq('audit prior custodian را بدون جعل actor نگه می‌دارد', payload.priorCustodianUserId, absentCustodian)
eq('audit دلیل emergency را نگه می‌دارد', payload.reason, reason)

const chip = readFileSync(new URL('../../src/renderer/src/components/CustodyChip.tsx', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
eq('UI فقط مسیر IPC رسمی emergency را صدا می‌زند', chip.includes('CH.custodyEmergencyCover') && chip.includes('PIN شخصی کارمند پوشش‌دهنده'), true)
eq('Main emergency را مستقیماً به سرویس PINدار می‌سپارد', ipc.includes('custodyService.emergencyCover(p ?? {})'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
