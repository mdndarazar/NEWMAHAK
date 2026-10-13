/**
 * Custody hardening P0:
 * - a financial request cannot silently create a bootstrap/default owner;
 * - the expected-cash IPC boundary exposes only the active custody segment;
 * - expected cash stays hidden while a receiver performs a blind handover.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s381-custody-no-implicit-owner-and-expected-gate.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-hardening-s381-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')

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

const manager = seed.user('مدیر S381', { role: 'MANAGER' })
const giver = seed.user('صندوقدار S381', { role: 'CASHIER' })
const receiver = seed.user('تحویل‌گیرنده S381', { role: 'CASHIER' })

await custodyService.setPin({ userId: manager, newPassword: 'Manager381!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager381!' })

const shiftsBefore = Number(seed.one('SELECT COUNT(*) AS n FROM "Shift"')?.n ?? 0)
const profilesBefore = Number(seed.one('SELECT COUNT(*) AS n FROM "StaffProfile" WHERE kind=?', 'BOOTSTRAP_OWNER')?.n ?? 0)
await rejects('فروش بدون مسئول فعال، مالک/شیفت ساختگی نمی‌سازد', 'CUSTODY_AUTH_REQUIRED', () => custodyService.actorForFinancialOperation())
eq('رد فروش بدون مسئول، Shift جدید نمی‌سازد', Number(seed.one('SELECT COUNT(*) AS n FROM "Shift"')?.n ?? 0), shiftsBefore)
eq('رد فروش بدون مسئول، پروفایل bootstrap ساختگی نمی‌سازد', Number(seed.one('SELECT COUNT(*) AS n FROM "StaffProfile" WHERE kind=?', 'BOOTSTRAP_OWNER')?.n ?? 0), profilesBefore)
await rejects('expectedCash بدون مسئول فعال خوانده نمی‌شود', 'CUSTODY_EXPECTED_AUTH_REQUIRED', () => custodyService.assertExpectedCashRead({ shiftId: 1 }))

for (const [id, temporary, permanent] of [[giver, 'Giver381!', 'Giver3814!'], [receiver, 'Receiver381!', 'Receiver3814!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager381!', reason: 'راه‌اندازی آزمون سخت‌سازی حضانت' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const opened = await custodyService.open({ userId: giver, password: 'Giver3814!', countedCash: 1000 })
const approved = await custodyService.assertExpectedCashRead({ shiftId: opened.shiftId })
eq('expectedCash فقط segment فعال را می‌پذیرد', approved?.shiftId, opened.shiftId)
await rejects('expectedCash شیفت تاریخی/غیر فعال را رد می‌کند', 'CUSTODY_EXPECTED_SCOPE', () => custodyService.assertExpectedCashRead({ shiftId: opened.shiftId + 1 }))

await custodyService.handoverStart({ password: 'Giver3814!', countedCash: 1000, toUserId: receiver, idempotencyKey: 's381-handover' })
await rejects('expectedCash در طول شمارش کور تحویل پنهان است', 'CUSTODY_EXPECTED_HIDDEN_DURING_HANDOVER', () => custodyService.assertExpectedCashRead({ shiftId: opened.shiftId }))

const custodySource = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const ipcSource = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
eq('مسیر default-owner از سرویس حذف شده است', custodySource.includes('openDefaultOwnerSession'), false)
eq('مرز IPC پیش از CashboxService گیت expected را فرا می‌خواند', ipcSource.includes('await custodyService.assertExpectedCashRead(p ?? {})'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
