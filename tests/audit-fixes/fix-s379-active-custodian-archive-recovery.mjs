/**
 * Archiving an active custodian must never create a permanent drawer lock.
 * The manager-session Staff flow freezes writers, preserves the expected ledger
 * amount in an unresolved recovery case, archives the worker and disables the
 * old PIN. A different active worker later witnesses the physical count; a
 * reactivated worker needs a newly issued temporary PIN.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s379-active-custodian-archive-recovery.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-archive-recovery-s379-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { staffService } = await import('../../src/main/services/StaffService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { runWithPanelSessionOwner, notePanelUnlocked, clearPanelSessions } = await import('../../src/main/services/panelSession.ts')

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

const manager = seed.user('مدیر S379')
const custodian = seed.user('مسئول آرشیوشونده S379')
const witness = seed.user('شاهد بازیابی S379')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', custodian)
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', witness)
await custodyService.setPin({ userId: manager, newPassword: 'Manager379!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager379!' })
for (const [id, temporary, permanent] of [[custodian, 'Custodian379!', 'Custodian3794!'], [witness, 'Witness379!', 'Witness3794!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager379!', reason: 'راه‌اندازی آزمون آرشیو حضانت' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: custodian, password: 'Custodian3794!', countedCash: 1000 })
// Historical assignment is intentionally retained when the worker is archived.
db.$harness.db.prepare('INSERT INTO "ShiftPlan" (title,startMinute,durationMinutes,crossesMidnight,daysMask,isActive,sortOrder,reminderRepeatMin,version,updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)').run('برنامه سابق S379', 0, 480, 0, 127, 1, 1, 15, 1, new Date().toISOString())
const planId = seed.one('SELECT id FROM "ShiftPlan" ORDER BY id DESC LIMIT 1')?.id
if (planId) db.$harness.db.prepare('INSERT INTO "ShiftPlanStaff" (planId,userId) VALUES (?,?)').run(planId, custodian)

const archiveReason = 'پایان همکاری فوری ثبت شده و صندوق باید با پروندهٔ شمارش بازیابی ایمن شود.'
const owner = 37901
/** A failed expected calculation must restore the active drawer, leave a
 * durable abort event and allow the exact same archive request to retry. */
const originalExpected = cashboxService.expected
cashboxService.expected = async () => { throw new Error('expected calculation intentionally failed') }
try {
  await runWithPanelSessionOwner(owner, async () => {
    notePanelUnlocked('settings', 'MANAGER')
    await staffService.saveComplete({ id: custodian, name: 'مسئول آرشیوشونده S379', role: 'CASHIER', isActive: false, employmentStatus: 'TERMINATED', employmentEndJalali: '1405/07/30', custodyArchiveReason: archiveReason })
  })
  eq('failure آرشیو باید خطا دهد', true, false)
} catch {
  eq('failure آرشیو خطای محاسبه را برمی‌گرداند', true, true)
} finally {
  cashboxService.expected = originalExpected
  clearPanelSessions(owner)
}
eq('abort آرشیو state prior را دوباره active می‌کند', (await custodyService.status()).state, 'ACTIVE')
eq('abort آرشیو کارمند را فعال نگه می‌دارد', seed.one('SELECT isActive FROM "User" WHERE id=?', custodian)?.isActive, 1)
eq('abort آرشیو evidence را پاک نمی‌کند', seed.one('SELECT status FROM "CustodyResolution" WHERE shiftId=?', opened.shiftId)?.status, 'ARCHIVE_ABORTED')
eq('abort آرشیو رویداد مستقل دارد', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? ORDER BY id DESC LIMIT 1', opened.shiftId)?.type, 'CUSTODIAN_ARCHIVE_ABORTED')

const expectedPreview = await cashboxService.expected({ shiftId: opened.shiftId })
let enteredFreeze = null
const entered = new Promise((resolve) => { enteredFreeze = resolve })
let releaseExpected = null
const release = new Promise((resolve) => { releaseExpected = resolve })
cashboxService.expected = async () => { enteredFreeze?.(); return release }
let archived
try {
  await runWithPanelSessionOwner(owner, async () => {
    notePanelUnlocked('settings', 'MANAGER')
    const archivePromise = staffService.saveComplete({
      id: custodian,
      name: 'مسئول آرشیوشونده S379',
      role: 'CASHIER',
      isActive: false,
      employmentStatus: 'TERMINATED',
      employmentEndJalali: '1405/07/30',
      custodyArchiveReason: archiveReason
    })
    await entered
    await rejects('freeze آرشیو، writer مالیِ مسئول قبلی را رد می‌کند', 'CUSTODIAN_ARCHIVE_FREEZE', () => custodyService.actorForFinancialOperation())
    const frozen = await custodyService.status()
    eq('freeze آرشیو مسئول را در state اختصاصی نگه می‌دارد', frozen.state, 'CUSTODIAN_ARCHIVE_FREEZE')
    eq('freeze هنوز مسئول prior را روی segment باز نگه می‌دارد', frozen.custodian?.id, custodian)
    releaseExpected?.(expectedPreview)
    archived = await archivePromise
  })
} finally {
  cashboxService.expected = originalExpected
}
clearPanelSessions(owner)

eq('آرشیو کارمند را غیرفعال می‌کند', seed.one('SELECT isActive FROM "User" WHERE id=?', custodian)?.isActive, 0)
eq('state پس از آرشیو قفل دائمی نمی‌شود و برای بازکردن مسئول تازه آزاد است', (await custodyService.status()).state, 'NO_SESSION')
eq('segment پیشین با endKind آرشیو حل‌نشده بسته می‌شود', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'CUSTODIAN_ARCHIVED_UNRESOLVED')
const resolution = seed.one('SELECT id,status,evidence,nightExpectedCash,decisionReason FROM "CustodyResolution" WHERE shiftId=?', opened.shiftId)
eq('پروندهٔ بازیابی باز ساخته می‌شود', resolution?.status, 'OPEN')
eq('نوع پروندهٔ بازیابی آرشیو صریح است', resolution?.evidence, 'CUSTODIAN_ARCHIVED')
eq('expected ledger پیش از آرشیو حفظ می‌شود', Number(resolution?.nightExpectedCash), 1000)
eq('دلیل آرشیو در evidence پایدار می‌ماند', resolution?.decisionReason, archiveReason)
eq('کارمند آرشیوشده از roster عملیاتی server-side حذف می‌شود', (await custodyService.staffList()).some((row) => row.id === custodian), false)
eq('تاریخچهٔ assignment قدیمی پاک نمی‌شود', seed.one('SELECT userId FROM "ShiftPlanStaff" WHERE planId=? AND userId=?', planId, custodian)?.userId, custodian)
await rejects('PIN قدیمی پس از آرشیو هرگز authenticate نمی‌شود', 'INACTIVE', () => custodyService.verifyPin(custodian, 'Custodian3794!'))
const credentialAfterArchive = seed.one('SELECT status,mustChange,setKind FROM "CustodyCredential" WHERE userId=? AND purpose=?', custodian, 'CUSTODY_PIN')
eq('credential قدیمی disabled می‌شود', credentialAfterArchive?.status, 'DISABLED')
eq('credential قدیمی برای PIN تازه marked می‌شود', credentialAfterArchive?.mustChange, 1)
eq('نوع credential archive صریح است', credentialAfterArchive?.setKind, 'ARCHIVED')

eq('رویداد freeze آرشیو append-only است', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? AND type=?', opened.shiftId, 'CUSTODIAN_ARCHIVE_FREEZE')?.type, 'CUSTODIAN_ARCHIVE_FREEZE')
eq('رویداد تکمیل آرشیو append-only است', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? AND type=?', opened.shiftId, 'CUSTODIAN_ARCHIVED_UNRESOLVED')?.type, 'CUSTODIAN_ARCHIVED_UNRESOLVED')

const recovered = await custodyService.recoverUnattended({ resolutionId: resolution.id, userId: witness, password: 'Witness3794!', countedCash: 900, note: 'شاهد حاضر صندوق را پس از آرشیو شمارش کرد.' })
eq('بازیابی شاهد فقط پروندهٔ قبلی را می‌بندد', (await custodyService.status()).state, 'NO_SESSION')
eq('پروندهٔ آرشیو با شمارش شاهد resolved می‌شود', seed.one('SELECT status,evidence FROM "CustodyResolution" WHERE id=?', resolution.id)?.status, 'RESOLVED')
eq('evidence پس از بازیابی نوع آرشیو را حفظ می‌کند', seed.one('SELECT evidence FROM "CustodyResolution" WHERE id=?', resolution.id)?.evidence, 'CUSTODIAN_ARCHIVED_RECOVERED')
const count = seed.one('SELECT kind,countedCash,expectedCash,differenceCash,countedByUserId,authMethod FROM "CustodyCount" WHERE id=(SELECT morningWitnessCountId FROM "CustodyResolution" WHERE id=?)', resolution.id)
eq('count بازیابی آرشیو متمایز است', count?.kind, 'ARCHIVED_CUSTODIAN_WITNESS')
eq('count فیزیکی شاهد ثبت می‌شود', Number(count?.countedCash), 900)
eq('expected prior segment حفظ می‌شود', Number(count?.expectedCash), 1000)
eq('difference به prior segment می‌ماند', Number(count?.differenceCash), -100)
eq('شاهد واقعی actor شمارش است', count?.countedByUserId, witness)
eq('شاهد با PIN خودش احراز شده است', count?.authMethod, 'CUSTODY_PIN')
eq('meta بازیابی آرشیو صریح است', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'CUSTODIAN_ARCHIVED_RECOVERED')
eq('رویداد بازیابی آرشیو متمایز است', seed.one('SELECT type FROM "CustodyEvent" WHERE resolutionId=? ORDER BY id DESC LIMIT 1', resolution.id)?.type, 'CUSTODIAN_ARCHIVE_RECOVERED')

await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  const reactivated = await staffService.saveComplete({ id: custodian, name: 'مسئول آرشیوشونده S379', role: 'CASHIER', isActive: true })
  eq('پاسخ reactivation، PIN موقت تازه را الزامی می‌داند', reactivated.requiresTemporaryCustodyPin, true)
})
clearPanelSessions(owner)
eq('فعال‌سازی دوباره isActive را روشن می‌کند', seed.one('SELECT isActive FROM "User" WHERE id=?', custodian)?.isActive, 1)
eq('فعال‌سازی دوباره وضعیت پایان همکاری را active می‌کند', seed.one('SELECT employmentStatus FROM "StaffProfile" WHERE userId=?', custodian)?.employmentStatus, 'ACTIVE')
eq('فعال‌سازی دوباره تاریخ پایان را پاک می‌کند', seed.one('SELECT employmentEndJalali FROM "StaffProfile" WHERE userId=?', custodian)?.employmentEndJalali, null)
eq('PIN قدیمی حتی پس از reactivation قابل استفاده نیست', (await custodyService.staffList()).find((row) => row.id === custodian)?.hasCustodyPin, false)
await rejects('PIN قدیمی پس از reactivation به‌عنوان PIN تعریف‌نشده رد می‌شود', 'PIN_NOT_SET', () => custodyService.verifyPin(custodian, 'Custodian3794!'))
eq('رویداد نیاز به PIN موقت تازه ثبت می‌شود', seed.one('SELECT type FROM "CustodyEvent" WHERE type=? ORDER BY id DESC LIMIT 1', 'CUSTODIAN_REACTIVATED_PIN_REQUIRED')?.type, 'CUSTODIAN_REACTIVATED_PIN_REQUIRED')

await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  await custodyService.setPin({ userId: custodian, newPassword: 'FreshTemp379!', reason: 'صدور PIN موقت پس از فعال‌سازی دوباره', managerSession: true })
})
clearPanelSessions(owner)
eq('مدیر PIN موقت تازه صادر می‌کند', (await custodyService.staffList()).find((row) => row.id === custodian)?.hasCustodyPin, true)
eq('PIN موقت تازه باید پیش از عملیات شخصی‌سازی شود', (await custodyService.staffList()).find((row) => row.id === custodian)?.mustChangePin, true)
await rejects('PIN موقت تازه هنوز مسئولیت مالی ایجاد نمی‌کند', 'PIN_MUST_CHANGE', () => custodyService.verifyPin(custodian, 'FreshTemp379!'))

const staffServiceSource = readFileSync(new URL('../../src/main/services/StaffService.ts', import.meta.url), 'utf8')
const custodySource = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const settingsSource = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
eq('دلیل archive و مسیر recovery در Main وجود دارند', staffServiceSource.includes('custodyArchiveReason') && custodySource.includes('archiveActiveCustodian'), true)
eq('فهرست عملیاتی Main archived users را filter می‌کند', /user\.findMany\(\{ where: \{ isActive: true \}/.test(custodySource), true)
eq('UI هشدار archive و راهنمای PIN تازه دارد', settingsSource.includes('دلیل آرشیو مسئول فعال صندوق') && settingsSource.includes('PIN قبلی عمداً باطل مانده است'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
