/**
 * Handover v2 safety contract:
 * - pending handover keeps the outgoing authenticated custodian as the writer;
 * - an intervening cash writer is included in the receiver's fresh watermark;
 * - a non-zero recount without an auditable reason cannot transfer custody.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s363-pending-handover-recount.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-handover-recount-s363-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
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

const manager = seed.user('مدیر S363')
const giver = seed.user('تحویل‌دهنده S363')
const receiver = seed.user('تحویل‌گیرنده S363')
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
for (const [id, temporary, permanent] of [[giver, 'Giver363!', 'Giver3634!'], [receiver, 'Recv363!', 'Recv3634!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'راه‌اندازی آزمون شمارش' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}
const opened = await custodyService.open({ userId: giver, password: 'Giver3634!', countedCash: 0 })
const handover = await custodyService.handoverStart({ password: 'Giver3634!', countedCash: 0, toUserId: receiver, idempotencyKey: 's363-handover' })
eq('تحویل وارد وضعیت pending شد', handover.state, 'HANDOVER_PENDING')

const fence = await custodyService.actorForFinancialOperation()
eq('pending همچنان fence مسئول قبلی را می‌دهد', fence?.expectedActorUserId, giver)
eq('pending همان نشست خروجی را نگه می‌دارد', fence?.expectedShiftId, opened.shiftId)
await cashMovementService.add({ type: CashMovementType.DEPOSIT, amount: 100, description: 'فروش/گردش هنگام انتظار تحویل', userId: giver, custodyFence: fence })
eq('گردش مالی در انتظار تحویل روی نشست خروجی ثبت شد', seed.one('SELECT shiftId FROM "CashMovement" ORDER BY id DESC LIMIT 1')?.shiftId, opened.shiftId)

await rejects('پذیرش با شمارش دارای مغایرت و بدون دلیل رد می‌شود', 'HANDOVER_DIFFERENCE_REASON_REQUIRED', () => custodyService.handoverAccept({ handoverId: handover.id, password: 'Recv3634!', countedCash: 0 }))
eq('رد شمارش، فروش را قفل نمی‌کند و pending می‌ماند', (await custodyService.status()).state, 'HANDOVER_PENDING')
eq('شمارش ردشده در سابقه append-only ثبت شد', seed.one('SELECT kind FROM "CustodyCount" WHERE handoverId=? ORDER BY id DESC LIMIT 1', handover.id)?.kind, 'HANDOVER_RECOUNT_REJECTED')
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'Recv3634!', countedCash: 100 })
eq('پذیرش با اختلاف صفر انجام می‌شود', accepted.differenceCash, 0)
eq('پذیرش مسئول را به گیرنده منتقل می‌کند', (await custodyService.status()).custodian?.id, receiver)
eq('موجودی آغازین segment گیرنده از شمارش تازه می‌آید', Number(seed.one('SELECT amount FROM "CashMovement" WHERE shiftId=? AND type=?', accepted.shiftId, CashMovementType.OPENING_FLOAT)?.amount), 100)
eq('شمارش پذیرفته‌شدهٔ گیرنده در سابقه می‌ماند', seed.one('SELECT kind FROM "CustodyCount" WHERE handoverId=? ORDER BY id DESC LIMIT 1', handover.id)?.kind, 'HANDOVER_RECOUNT')
const watermark = JSON.parse(seed.one('SELECT ledgerWatermark FROM "CustodyHandover" WHERE id=?', handover.id)?.ledgerWatermark ?? '{}')
eq('watermark نهایی فقط بعد از شمارش صفر-diff پذیرفته است', watermark.accepted, true)
eq('watermark نهایی نقد انتظاری تازه را نگه می‌دارد', watermark.expectedCash, 100)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
