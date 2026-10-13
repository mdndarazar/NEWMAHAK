/**
 * TERMINATED is operational, not merely a profile label. It atomically disables
 * a safe former worker, but cannot remove a live drawer custodian or a pending
 * handover recipient.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s367-terminated-staff-custody-guard.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-terminated-s367-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { staffService } = await import('../../src/main/services/StaffService.ts')
const { notePanelUnlocked, clearPanelSessions, runWithPanelSessionOwner } = await import('../../src/main/services/panelSession.ts')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0; let bad = 0
const eq = (label, got, want) => { if (got === want) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) } }
const rejects = async (label, code, work) => { try { await work(); eq(label, true, false) } catch (error) { eq(label, error?.code, code) } }
const manager = seed.user('مدیر S367'), giver = seed.user('مسئول فعال S367'), recipient = seed.user('گیرندهٔ pending S367'), former = seed.user('کارمند پایان‌یافته S367')
await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
for (const [id, temp, perm] of [[giver, 'Giver367!', 'Giver3674!'], [recipient, 'Recv367!', 'Recv3674!']]) {
  await custodyService.setPin({ userId: id, newPassword: temp, managerUserId: manager, managerPassword: 'مدیر123!', reason: 'راه‌اندازی' })
  await custodyService.setPin({ userId: id, currentPassword: temp, newPassword: perm })
}
const sessionOwner = 36701
await runWithPanelSessionOwner(sessionOwner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  const term = async (id, name) => staffService.saveComplete({ id, name, role: 'MANAGER', isActive: true, employmentStatus: 'TERMINATED', employmentEndJalali: '1405/07/30' })
  await term(former, 'کارمند پایان‌یافته S367')
  eq('پایان همکاریِ بدون مسئولیت باز کاربر را خودکار غیرفعال می‌کند', seed.one('SELECT isActive FROM "User" WHERE id=?', former)?.isActive, 0)

  await custodyService.open({ userId: giver, password: 'Giver3674!', countedCash: 0 })
  /** Active-custodian archive now has the approved secure recovery route, but
   * it cannot start without a durable reason. A generic old rejection code
   * would hide that required workflow from the caller. */
  await rejects('پایان همکاریِ مسئول فعال بدون دلیلِ بازیابی امن رد می‌شود', 'CUSTODIAN_ARCHIVE_REASON_REQUIRED', () => term(giver, 'مسئول فعال S367'))
  eq('مسئول فعال پس از رد همچنان فعال است', seed.one('SELECT isActive FROM "User" WHERE id=?', giver)?.isActive, 1)
  eq('ردِ بدون دلیل پروندهٔ recovery یا archive جعل نمی‌کند', seed.count('CustodyResolution', 'shiftId IN (SELECT id FROM "Shift" WHERE userId=?)', giver), 0)
  const handover = await custodyService.handoverStart({ password: 'Giver3674!', countedCash: 0, toUserId: recipient, idempotencyKey: 's367-pending' })
  await rejects('پایان همکاریِ گیرندهٔ pending رد می‌شود', 'PENDING_HANDOVER_RECIPIENT', () => term(recipient, 'گیرندهٔ pending S367'))
  eq('گیرندهٔ pending پس از رد همچنان فعال است', seed.one('SELECT isActive FROM "User" WHERE id=?', recipient)?.isActive, 1)
  await custodyService.handoverCancel({ handoverId: handover.id, password: 'Giver3674!' })
})
clearPanelSessions(sessionOwner)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
