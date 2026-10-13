/**
 * A handover may begin a new responsible segment at the receiver's physically
 * counted amount even when it differs from the ledger.  The difference must
 * have a reason and remain attributable to the outgoing segment.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s375-handover-discrepancy-accountability.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-handover-difference-s375-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
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

const manager = seed.user('مدیر S375')
const giver = seed.user('مسئول پیشین S375')
const receiver = seed.user('تحویل‌گیرنده S375')
await custodyService.setPin({ userId: manager, newPassword: 'Manager375!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager375!' })
for (const [id, temporary, permanent] of [[giver, 'Giver375!', 'Giver3754!'], [receiver, 'Receiver375!', 'Receiver3754!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager375!', reason: 'راه‌اندازی آزمون تحویل' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: giver, password: 'Giver3754!', countedCash: 1000 })
const handover = await custodyService.handoverStart({ password: 'Giver3754!', countedCash: 1000, toUserId: receiver, idempotencyKey: 's375-giver-to-receiver' })

await rejects('تحویل با مغایرت، بدون دلیلِ پایدار رد می‌شود', 'HANDOVER_DIFFERENCE_REASON_REQUIRED', () => custodyService.handoverAccept({ handoverId: handover.id, password: 'Receiver3754!', countedCash: 920 }))
const frozen = await custodyService.status()
eq('اختلافِ بدون دلیل، فروش را باز نمی‌کند و state را فریز نگه می‌دارد', frozen.state, 'HANDOVER_RECOUNT')
eq('در freeze، مسئول segment قبلی فقط برای سابقه دیده می‌شود', frozen.custodian?.id, giver)
await rejects('بین شمارش کور و دلیل اختلاف، هیچ writer مالی fence نمی‌گیرد', 'HANDOVER_RECOUNT', () => custodyService.actorForFinancialOperation())
eq('شمارش فریز‌شده برای حسابرسی پاک نمی‌شود', seed.one('SELECT kind FROM "CustodyCount" WHERE handoverId=? ORDER BY id DESC LIMIT 1', handover.id)?.kind, 'HANDOVER_RECOUNT_DIFFERENCE_PENDING')

const reason = 'بیست هزار تومان کسری در شمارش مستقل هنگام تحویل ثبت شد.'
const accepted = await custodyService.handoverAccept({ handoverId: handover.id, password: 'Receiver3754!', countedCash: 920, differenceReason: reason })
eq('تحویل با دلیل، اختلاف واقعی را برمی‌گرداند', accepted.differenceCash, -80)
eq('مسئولیت عملیاتی به تحویل‌گیرنده منتقل می‌شود', (await custodyService.status()).custodian?.id, receiver)

const evidence = seed.one('SELECT shiftId, kind, countedCash, expectedCash, differenceCash, countedByUserId, note FROM "CustodyCount" WHERE handoverId=? ORDER BY id DESC LIMIT 1', handover.id)
eq('شمارش اختلاف روی segment مسئول پیشین ثبت می‌شود', evidence?.shiftId, opened.shiftId)
eq('نوع evidence مغایرتِ فریز‌شده را صریح می‌کند', evidence?.kind, 'HANDOVER_RECOUNT_DIFFERENCE_PENDING')
eq('ledger expected از شمارش فیزیکی جدا می‌ماند', Number(evidence?.expectedCash), 1000)
eq('شمارش فیزیکی تحویل‌گیرنده نگه داشته می‌شود', Number(evidence?.countedCash), 920)
eq('اختلاف در evidence ثبت می‌شود', Number(evidence?.differenceCash), -80)
eq('actor شمارش واقعاً تحویل‌گیرنده است', evidence?.countedByUserId, receiver)
eq('blind evidence بدون بازنویسی می‌ماند و دلیل در تصمیم handover ثبت می‌شود', evidence?.note, null)

const recorded = seed.one('SELECT fromShiftId, finalCustodianUserId, differenceCash, resolutionKind, resolutionReason, toShiftId FROM "CustodyHandover" WHERE id=?', handover.id)
eq('handover اختلاف را به‌عنوان نتیجهٔ جدا ثبت می‌کند', Number(recorded?.differenceCash), -80)
eq('نتیجهٔ تحویل، پذیرش با مغایرت است', recorded?.resolutionKind, 'RECEIVER_ACCEPTED_WITH_DIFFERENCE')
eq('دلیل در خود پروندهٔ تحویل نگهداری می‌شود', recorded?.resolutionReason, reason)
eq('مسئول نهایی همان تحویل‌گیرندهٔ PINدار است', recorded?.finalCustodianUserId, receiver)
eq('segment قبلی پایانِ همراه مغایرت می‌گیرد', seed.one('SELECT endKind FROM "CustodyShiftMeta" WHERE shiftId=?', opened.shiftId)?.endKind, 'HANDED_OVER_WITH_DIFFERENCE')
eq('segment جدید از شمارش واقعی آغاز می‌شود', Number(seed.one('SELECT amount FROM "CashMovement" WHERE shiftId=? AND type=?', accepted.shiftId, CashMovementType.OPENING_FLOAT)?.amount), 920)

const event = seed.one('SELECT type, shiftId, actorUserId, payloadJson FROM "CustodyEvent" WHERE handoverId=? ORDER BY id DESC LIMIT 1', handover.id)
eq('رویداد حسابرسی پذیرشِ با مغایرت را متمایز می‌کند', event?.type, 'HANDOVER_ACCEPT_WITH_DIFFERENCE')
eq('رویداد مغایرت به segment پیشین وصل می‌ماند', event?.shiftId, opened.shiftId)
eq('رویداد را شخصِ واقعیِ تحویل‌گیرنده امضا کرده است', event?.actorUserId, receiver)
const payload = JSON.parse(event?.payloadJson ?? '{}')
eq('رویداد اختلاف را به مسئولیت prior segment منتسب می‌کند', payload.differenceAttributedToUserId, giver)
eq('رویداد دلیل کامل را نگه می‌دارد', payload.differenceReason, reason)

// Cancellation is the only alternate exit from a durable blind-count freeze.
const cancelable = await custodyService.handoverStart({ password: 'Receiver3754!', countedCash: 920, toUserId: giver, idempotencyKey: 's375-cancel-frozen' })
await rejects('مغایرت دوم نیز پیش از دلیل در freeze می‌ماند', 'HANDOVER_DIFFERENCE_REASON_REQUIRED', () => custodyService.handoverAccept({ handoverId: cancelable.id, password: 'Giver3754!', countedCash: 850 }))
eq('لغوپذیر بودن freeze فروش را باز نمی‌کند', (await custodyService.status()).state, 'HANDOVER_RECOUNT')
await custodyService.handoverCancel({ handoverId: cancelable.id, password: 'Receiver3754!' })
eq('لغو با PIN تحویل‌دهنده مسئولیت را فقط به segment قبلی بازمی‌گرداند', (await custodyService.status()).custodian?.id, receiver)
eq('لغو evidence شمارشِ خروج را پاک نمی‌کند', Number(seed.one('SELECT COUNT(*) AS n FROM "CustodyCount" WHERE shiftId=? AND kind=?', accepted.shiftId, 'HANDOVER_OUT')?.n ?? 0), 1)
eq('شمارش blind پیش از لغو نیز قابل ممیزی می‌ماند', Number(seed.one('SELECT COUNT(*) AS n FROM "CustodyCount" WHERE handoverId=? AND kind=?', cancelable.id, 'HANDOVER_RECOUNT_DIFFERENCE_PENDING')?.n ?? 0), 1)
eq('لغو فریز رویداد متمایز append-only دارد', seed.one('SELECT type FROM "CustodyEvent" WHERE handoverId=? ORDER BY id DESC LIMIT 1', cancelable.id)?.type, 'HANDOVER_DIFFERENCE_FROZEN_CANCELED')

const custodyUi = readFileSync(new URL('../../src/renderer/src/components/CustodyChip.tsx', import.meta.url), 'utf8')
eq('UI دلیل مغایرت را به IPC رسمی می‌فرستد', custodyUi.includes('differenceReason: note.trim() || undefined'), true)
eq('UI اختلاف فریز‌شده را برای همان شمارش ادامه می‌دهد، نه بازگشایی فروش', custodyUi.includes('normalHandoverDifferencePending') && custodyUi.includes('ثبت دلیل و تکمیل تحویل'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
