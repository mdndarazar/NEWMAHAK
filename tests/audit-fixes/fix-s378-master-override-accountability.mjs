/**
 * Master Override is a distinct, manager-owned custody transition. It cannot
 * borrow the normal emergency-cover PIN route or the historical shift-name
 * override report: the Main service must validate a selected active manager,
 * the shared manager password, a physical count, and a mandatory reason.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s378-master-override-accountability.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-master-override-s378-'))
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

const manager = seed.user('مدیر منتخب S378')
const absentCustodian = seed.user('مسئول غایب S378')
const cashier = seed.user('صندوقدار S378')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', absentCustodian)
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id=?').run('CASHIER', cashier)

/** The manager's first custody PIN bootstraps through the established shared
 * manager password. Master Override itself later uses that shared password,
 * never this personal PIN as its approval credential. */
await custodyService.setPin({ userId: manager, newPassword: 'Manager378!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager378!' })
for (const [id, temporary, permanent] of [[absentCustodian, 'Absent378!', 'Absent3784!'], [cashier, 'Cashier378!', 'Cashier3784!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager378!', reason: 'راه‌اندازی آزمون Master Override' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: absentCustodian, password: 'Absent3784!', countedCash: 1000 })
await rejects('کارمند غیرمدیر حتی با رمز مشترک مدیر نمی‌تواند Master Override شود', 'MASTER_OVERRIDE_MANAGER_INVALID', () => custodyService.masterOverride({ managerUserId: cashier, managerPassword: '1111', countedCash: 900, reason: 'مسئول قبلی غایب است و مدیر باید مسئولیت را تحویل بگیرد.' }))
await rejects('دلیل کوتاه Master Override پذیرفته نمی‌شود', 'MASTER_OVERRIDE_REASON_REQUIRED', () => custodyService.masterOverride({ managerUserId: manager, managerPassword: '1111', countedCash: 900, reason: 'کم' }))
eq('درخواست ردشده مسئولیت فعال را تغییر نمی‌دهد', (await custodyService.status()).custodian?.id, absentCustodian)

const reason = 'مسئول قبلی غایب است و مدیر منتخب باید مسئولیت صندوق را فوراً تحویل بگیرد.'
/** A calculation failure occurs after the durable short freeze. It must restore
 * the prior segment and leave append-only abort evidence, so the same manager
 * can retry the operation instead of stranding the drawer. */
const originalExpected = cashboxService.expected
cashboxService.expected = async () => { throw new Error('expected calculation intentionally failed') }
try {
  await custodyService.masterOverride({ managerUserId: manager, managerPassword: '1111', countedCash: 900, reason })
  eq('failure پس از freeze باید خطا دهد', true, false)
} catch {
  eq('failure پس از freeze خطای محاسبه را برمی‌گرداند', true, true)
} finally {
  cashboxService.expected = originalExpected
}
const afterAbort = await custodyService.status()
eq('abort، prior segment را دوباره فعال می‌کند', afterAbort.state, 'ACTIVE')
eq('abort، prior custodian را حفظ می‌کند', afterAbort.custodian?.id, absentCustodian)
eq('abort، رویداد مستقل و append-only دارد', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? ORDER BY id DESC LIMIT 1', opened.shiftId)?.type, 'MASTER_OVERRIDE_ABORTED')

const expectedPreview = await cashboxService.expected({ shiftId: opened.shiftId, countedCash: 900 })
let enteredFreeze = null
const entered = new Promise((resolve) => { enteredFreeze = resolve })
let releaseExpected = null
const release = new Promise((resolve) => { releaseExpected = resolve })
cashboxService.expected = async () => { enteredFreeze?.(); return release }
let override
try {
  const overridePromise = custodyService.masterOverride({ managerUserId: manager, managerPassword: '1111', countedCash: 900, reason })
  await entered
  await rejects('freeze Master Override، writer مالی prior custodian را رد می‌کند', 'HANDOVER_RECOUNT', () => custodyService.actorForFinancialOperation())
  const pending = await custodyService.status()
  eq('freeze وضعیت اختصاصی Master Override را نگه می‌دارد', pending.pendingHandover?.status, 'MASTER_OVERRIDE_RECOUNT')
  eq('freeze مدیر واقعی را به‌عنوان مسئول بعدی نگه می‌دارد', pending.pendingHandover?.selectedRecipientUserId, manager)
  releaseExpected?.(expectedPreview)
  override = await overridePromise
} finally {
  cashboxService.expected = originalExpected
}

eq('اختلاف Master Override از شمارش واقعی مدیر می‌آید', override.differenceCash, -100)
eq('مسئولیت فعال به مدیر منتخب منتقل می‌شود', (await custodyService.status()).custodian?.id, manager)

const evidence = seed.one('SELECT shiftId, kind, countedCash, expectedCash, differenceCash, countedByUserId, authMethod, note FROM "CustodyCount" WHERE id=(SELECT outCountId FROM "CustodyHandover" WHERE id=?)', override.handoverId)
eq('شمارش Override به segment مسئول قبلی وصل است', evidence?.shiftId, opened.shiftId)
eq('نوع evidence Override صریح است', evidence?.kind, 'MASTER_OVERRIDE_COUNT')
eq('expected ledger جدا از physical count ثبت می‌شود', Number(evidence?.expectedCash), 1000)
eq('physical count همان شمارش مدیر است', Number(evidence?.countedCash), 900)
eq('اختلاف روی prior segment ثبت است', Number(evidence?.differenceCash), -100)
eq('actor شمارش مدیر منتخب است', evidence?.countedByUserId, manager)
eq('روش احراز evidence رمز مشترک مدیر است', evidence?.authMethod, 'MANAGER_SHARED_PASSWORD')
eq('دلیل Override append-only کنار count می‌ماند', evidence?.note, reason)

const handover = seed.one('SELECT fromShiftId, fromUserId, selectedRecipientUserId, managerApproverUserId, finalCustodianUserId, status, resolutionKind, resolutionReason, toShiftId, differenceCash FROM "CustodyHandover" WHERE id=?', override.handoverId)
eq('پرونده Override prior shift را نگه می‌دارد', handover?.fromShiftId, opened.shiftId)
eq('مسئول قبلی تنها evidence prior custodian است', handover?.fromUserId, absentCustodian)
eq('مدیر انتخاب‌شده در پرونده با هویت واقعی ثبت است', handover?.selectedRecipientUserId, manager)
eq('مدیر انتخاب‌شده به‌عنوان approver استثنا هم ثبت می‌شود', handover?.managerApproverUserId, manager)
eq('پرونده Override کامل می‌شود', handover?.status, 'COMPLETED')
eq('نوع نتیجه Override متمایز است', handover?.resolutionKind, 'MASTER_OVERRIDE_COMPLETED')
eq('دلیل Override در پرونده باقی می‌ماند', handover?.resolutionReason, reason)
eq('مسئول نهایی مدیر منتخب است', handover?.finalCustodianUserId, manager)
eq('اختلاف پرونده از شمارش واقعی است', Number(handover?.differenceCash), -100)

eq('segment قبلی با endKind Override بسته می‌شود', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'MASTER_OVERRIDDEN')
const incomingMeta = seed.one('SELECT custodianUserId, openAuth, countStatus FROM "CustodyShiftMeta" WHERE shiftId=?', override.shiftId)
eq('metadata segment جدید متعلق به مدیر منتخب است', incomingMeta?.custodianUserId, manager)
eq('راه احراز segment جدید رمز مشترک مدیر است', incomingMeta?.openAuth, 'MASTER_OVERRIDE_MANAGER_PASSWORD')
eq('segment جدید شمارش‌شده شروع می‌شود', incomingMeta?.countStatus, 'COUNTED')
const incomingShift = seed.one('SELECT userId, openedVia FROM "Shift" WHERE id=?', override.shiftId)
eq('Shift جدید مدیر واقعی را دارد', incomingShift?.userId, manager)
eq('Shift جدید نوع Master Override دارد', incomingShift?.openedVia, 'MASTER_OVERRIDE')
eq('opening float segment جدید از شمارش واقعی مدیر است', Number(seed.one('SELECT amount FROM "CashMovement" WHERE shiftId=? AND type=?', override.shiftId, CashMovementType.OPENING_FLOAT)?.amount), 900)

const event = seed.one('SELECT type, shiftId, actorUserId, actorKind, authMethod, payloadJson FROM "CustodyEvent" WHERE handoverId=? ORDER BY id DESC LIMIT 1', override.handoverId)
eq('رویداد Override تکمیل‌شده متمایز است', event?.type, 'MASTER_OVERRIDE_COMPLETED')
eq('رویداد به segment prior متصل می‌ماند', event?.shiftId, opened.shiftId)
eq('actor رویداد مدیر منتخب است', event?.actorUserId, manager)
eq('actorKind Override صریح است', event?.actorKind, 'MASTER_OVERRIDE_MANAGER')
eq('رمز مشترک مدیر در audit ثبت می‌شود', event?.authMethod, 'MANAGER_SHARED_PASSWORD')
const payload = JSON.parse(event?.payloadJson ?? '{}')
eq('audit prior custodian را بدون جعل actor نگه می‌دارد', payload.priorCustodianUserId, absentCustodian)
eq('audit دلیل Override را نگه می‌دارد', payload.reason, reason)

const chip = readFileSync(new URL('../../src/renderer/src/components/CustodyChip.tsx', import.meta.url), 'utf8')
const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
eq('UI مسیر IPC مستقل Override و رمز مشترک مدیر را نشان می‌دهد', chip.includes('CH.custodyMasterOverride') && chip.includes('رمز مشترک مدیر'), true)
eq('Main Override را به سرویس اختصاصی می‌سپارد', ipc.includes('custodyService.masterOverride(p ?? {})'), true)
eq('سرویس از primitive رمز مشترک مدیر استفاده می‌کند، نه PIN اصلاح شخصی', service.includes("assertManagerPassword(String(input.managerPassword ?? ''), 'Master Override صندوق')") && !service.includes('verifyManagerCorrectionApproval'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
