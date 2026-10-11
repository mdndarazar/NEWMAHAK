// @ts-check
/**
 * ===========================================================================
 * نشست ۳۳۰ — list/detail عادی اعتبار، credential نیستند
 *
 * فهرست/جزئیات/دفتر مصرف/لاگ یادآوری باید برای پنل عادی فقط شناسهٔ امن بدهند.
 * تنها مسیر جداگانهٔ manager reveal می‌تواند یک کد را برگرداند؛ چاپ و PDF نیز
 * همان نشست واقعی مدیر را می‌خواهند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s330-credit-list-detail-redaction.mjs
 * ===========================================================================
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s330-credit-list-detail-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { clearPanelSessions, notePanelUnlocked } = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const now = Date.now()
const today = toJalaliDate(new Date(now))
const secret = 'CR-S330-REDEEMABLE-SECRET'
const creditId = seed.insert('StoreCredit', {
  code: secret,
  amount: 900_000,
  usedAmount: 250_000,
  usedCount: 1,
  status: 'PARTIALLY_USED',
  source: 'MANUAL',
  issuedAt: now,
  issuedAtJalali: today,
  issuedAtTime: '10:00:00',
  legacyCode: secret
})
seed.insert('StoreCreditRedemption', {
  creditId,
  code: secret,
  amount: 250_000,
  remainderAfter: 650_000,
  seq: 1,
  at: now,
  atJalali: today,
  atTime: '11:00:00',
  note: `مصرف با ${secret}`
})
seed.insert('CreditReminderLog', {
  creditId,
  code: secret,
  kind: 'UNUSED',
  status: 'LOGGED',
  phone: '09120000000',
  text: `کد اعتبار شما ${secret} است`,
  reason: `مربوط به ${secret}`,
  plannedAt: now,
  atJalali: today,
  atTime: '12:00:00'
})
seed.insert('AuditLog', {
  action: 'CREDIT_ISSUE_MANUAL',
  entity: 'StoreCredit',
  entityId: creditId,
  at: now,
  before: JSON.stringify({ code: secret, legacyCode: secret, amount: 0 }),
  after: JSON.stringify({ code: secret, amount: 900_000 }),
  note: `صدور ${secret}`
})

const hasSecret = (value) => JSON.stringify(value).includes(secret)
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}

console.log('--- ۱. list امن است و جست‌وجوی کد oracle نمی‌سازد ---')
const listWithoutProbe = await storeCreditService.list({ fromJalali: today, toJalali: today })
const listWithProbe = await storeCreditService.list({ fromJalali: today, toJalali: today, search: secret })
assert.equal(listWithoutProbe.length, listWithProbe.length, 'جست‌وجوی credential نباید شمارش/نتیجه را تغییر دهد')
const listRow = listWithProbe.find((row) => row.id === creditId)
assert.ok(listRow, 'اعتبار داخل بازه باید دیده شود')
assert.equal(Object.hasOwn(listRow, 'code'), false)
assert.equal(Object.hasOwn(listRow, 'legacyCode'), false)
assert.equal(listRow.publicReference, `اعتبار #${creditId}`)
assert.equal(hasSecret(listWithProbe), false)
console.log('  ✓ فهرست امن فقط شناسهٔ غیرقابل‌مصرف دارد')

console.log('--- ۲. detail و زیرردیف‌های آن credential را حمل نمی‌کنند ---')
const detail = await storeCreditService.detail({ id: creditId })
assert.equal(Object.hasOwn(detail.credit, 'code'), false)
assert.equal(Object.hasOwn(detail.credit, 'legacyCode'), false)
assert.equal(detail.credit.publicReference, `اعتبار #${creditId}`)
assert.equal(detail.redemptions[0]?.publicReference, `اعتبار #${creditId}`)
assert.equal(Object.hasOwn(detail.redemptions[0] ?? {}, 'code'), false)
assert.equal(detail.reminders[0]?.publicReference, `اعتبار #${creditId}`)
assert.equal(Object.hasOwn(detail.reminders[0] ?? {}, 'code'), false)
assert.equal(hasSecret(detail), false, 'پیامک، یادداشت و snapshot Audit هم نباید کد را نشت دهند')
console.log('  ✓ detail/timeline/reminder/redemption امن ماندند')

console.log('--- ۳. مسیر reveal باریک و فقط مدیر است ---')
clearPanelSessions()
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT' })) ?? '',
  /فقط نشست فعال مدیر|رمز دوم پنل/
)
notePanelUnlocked(PANEL_KEYS.creditManagement, 'PANEL')
assert.match(
  await errorOf(() => storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT' })) ?? '',
  /فقط نشست فعال مدیر|رمز دوم پنل/
)
notePanelUnlocked(PANEL_KEYS.creditManagement, 'MANAGER')
assert.deepEqual(
  await storeCreditService.revealManagerCode({ sourceId: creditId, sourceSubKind: 'STORE_CREDIT' }),
  { creditId, code: secret }
)
console.log('  ✓ فقط نشست واقعی مدیر از کانال reveal جدا یک کد می‌گیرد')
