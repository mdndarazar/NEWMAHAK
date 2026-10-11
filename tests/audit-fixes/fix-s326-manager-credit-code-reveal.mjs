// @ts-check
/**
 * فاز ۱ مسیر محرمانهٔ کد اعتبار:
 * - گزارش/ریزبین کد را حمل نمی‌کنند؛ افشا فقط یک IPC جداست.
 * - «رمز دوم پنل» و OPEN مجوز مدیر نیستند.
 * - source صدور و source مصرف هر دو به همان اعتبار resolve می‌شوند.
 * - افشا read-only و بدون ثبت کد در AuditLog تازه می‌ماند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s326-manager-credit-code-reveal.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s326-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const {
  clearPanelSessions,
  notePanelUnlocked,
  isManagerSessionUnlocked
} = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')

const db = harnessClient()
const sql = db.$harness.db
const seed = makeSeeder(db)
const secret = 'MGR-REVEAL-326-ONLY'
const creditId = seed.insert('StoreCredit', {
  code: secret,
  amount: 450_000,
  status: 'ACTIVE',
  source: 'MANUAL',
  issuedAt: Date.now(),
  issuedAtJalali: '1405/07/18'
})
const redemptionId = seed.insert('StoreCreditRedemption', {
  creditId,
  code: secret,
  amount: 200_000,
  remainderAfter: 250_000,
  seq: 1,
  at: Date.now(),
  atJalali: '1405/07/18',
  atTime: '10:00:00'
})

const counts = () => ({
  credits: Number(sql.prepare('SELECT COUNT(*) AS n FROM "StoreCredit"').get().n),
  redemptions: Number(sql.prepare('SELECT COUNT(*) AS n FROM "StoreCreditRedemption"').get().n),
  audit: Number(sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog"').get().n)
})
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}

console.log('--- ۱. فقط نشست واقعی مدیر مجاز است ---')
clearPanelSessions()
assert.equal(isManagerSessionUnlocked(), false)
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT_ISSUANCE' })) ?? '',
  /فقط نشست فعال مدیر|رمز دوم پنل/,
  'بدون نشست مدیر، مسیر افشا باید fail-closed باشد'
)

notePanelUnlocked(PANEL_KEYS.creditManagement, 'PANEL')
assert.equal(isManagerSessionUnlocked(), false, 'رمز دوم پنل، نشست مدیر نیست')
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT_ISSUANCE' })) ?? '',
  /فقط نشست فعال مدیر|رمز دوم پنل/,
  'scope=PANEL نباید بتواند کد را ببیند'
)
console.log('  ✓ بدون نشست یا با رمز دوم پنل، کد افشا نشد')

console.log('--- ۲. مدیر، source صدور و مصرف را جداگانه و فقط‌خواندنی می‌بیند ---')
clearPanelSessions()
notePanelUnlocked('هر-پنل', 'MANAGER')
assert.equal(isManagerSessionUnlocked(), true)
const before = counts()
const issued = await storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT_ISSUANCE' })
const redeemed = await storeCreditService.revealManagerCode({ sourceId: redemptionId, sourceSubKind: 'STORE_CREDIT_REDEMPTION' })
assert.deepEqual(issued, { creditId, code: secret }, 'source صدور باید کد همان اعتبار را برگرداند')
assert.deepEqual(redeemed, { creditId, code: secret }, 'source مصرف باید از redemption به اعتبار اصلی resolve شود')
assert.deepEqual(counts(), before, 'نمایش کد هیچ داده یا AuditLog تازه‌ای نمی‌نویسد')
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'FORGED_KIND' })) ?? '',
  /نوع سند اعتبار.*نامعتبر/,
  'subKind خارج از allowlist رد می‌شود'
)
console.log('  ✓ مدیر فقط یک کد resolved می‌گیرد؛ عملیات read-only ماند')

console.log('--- ۳. خروج نشست، افشا را دوباره می‌بندد ---')
clearPanelSessions()
assert.equal(isManagerSessionUnlocked(), false)
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: redemptionId, sourceSubKind: 'STORE_CREDIT_REDEMPTION' })) ?? '',
  /فقط نشست فعال مدیر|رمز دوم پنل/
)
console.log('  ✓ logout/clear session مسیر افشا را بست')

console.log('--- ۴. کانال اختصاصی است، نه الحاق به payload معمولی ---')
const ipc = readFileSync('src/main/ipc/index.ts', 'utf8')
const shared = readFileSync('src/shared/ipc.ts', 'utf8')
assert.match(shared, /creditManagerCodeReveal: 'credit:manager:code:reveal'/)
assert.match(ipc, /handle\(IPC\.creditManagerCodeReveal,[\s\S]{0,260}revealManagerCode/)
assert.match(ipc, /sourceId: p\?\.sourceId, sourceSubKind: p\?\.sourceSubKind/,
  'IPC فقط شناسه/نوع source را به مسیر محرمانه می‌دهد، نه report DTO را')
console.log('  ✓ افشای مدیر کانال جدا و باریک خودش را دارد')
