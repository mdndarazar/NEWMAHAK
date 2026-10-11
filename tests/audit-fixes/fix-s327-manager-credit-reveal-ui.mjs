// @ts-check
/**
 * فاز ۲ مسیر UI افشای مدیر در ریزبین مالی.
 * metadata امنِ subKind باید تا شناسنامه برسد، اما کد فقط با click صریح و
 * نشست مدیر درخواست شود؛ پاسخ معمولیِ source/detail هیچ‌وقت آن را ندارد.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s327-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { financialInspectorService: svc } = await import('../../src/main/services/financialInspectorService.ts')
const { clearPanelSessions } = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { SETTING_KEYS } = await import('../../src/shared/receipt.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const day = '1405/07/18'
const at = (hours) => new Date(jalaliStartOfDay(day).getTime() + hours * 3_600_000)
const secret = 'UI-REVEAL-327-SECRET'
const creditId = seed.insert('StoreCredit', {
  code: secret,
  amount: 725_000,
  status: 'ACTIVE',
  source: 'MANUAL',
  issuedAt: at(9),
  issuedAtJalali: day,
  createdAt: at(9),
  updatedAt: at(9)
})
const redemptionId = seed.insert('StoreCreditRedemption', {
  creditId,
  code: secret,
  amount: 200_000,
  remainderAfter: 525_000,
  seq: 1,
  at: at(11),
  atJalali: day,
  atTime: '11:00:00'
})

clearPanelSessions()
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReports]: false })
const scope = { fromJalali: day, toJalali: day }

console.log('--- ۱. DTO معمول ریزبین فقط discriminator امن دارد ---')
const used = await svc.sources({ scope, key: 'storeCreditUsed' })
const usedSource = used.result?.sources.find((row) => row.ref.id === redemptionId)
assert.equal(usedSource?.ref.kind, 'STORE_CREDIT')
assert.equal(usedSource?.ref.subKind, 'STORE_CREDIT_REDEMPTION')
assert.doesNotMatch(JSON.stringify(used), new RegExp(secret), 'source مصرف نیز نباید کد را حمل کند')
console.log('  ✓ subKind برای مسیر امن وجود دارد، اما کد در source DTO نیست')

console.log('--- ۲. شناسنامهٔ عادی نیز فقط subKind server-authenticated می‌گیرد ---')
const doc = await svc.document({ scope, key: 'storeCreditUsed', ref: usedSource?.ref })
assert.equal(doc.detail?.ref.kind, 'STORE_CREDIT')
assert.equal(doc.detail?.ref.subKind, 'STORE_CREDIT_REDEMPTION')
assert.doesNotMatch(JSON.stringify(doc), new RegExp(secret), 'detail عادی نباید کد را حمل کند')
console.log('  ✓ detail امن ماند و metadata لازم را از source اثبات‌شده گرفت')

console.log('--- ۳. UI فقط در نشست مدیر، click صریح را به کانال جدا می‌فرستد ---')
const ui = readFileSync('src/renderer/src/components/cash/FinancialInspector.tsx', 'utf8')
assert.match(ui, /useManagerSession\(\)/, 'UI باید scope مدیر را از session بگیرد')
assert.match(ui, /if \(!isManager\)[\s\S]{0,180}?نمایش کد فقط برای مدیر/, 'renderer نباید بدون session مدیر درخواست reveal کند')
assert.match(ui, /CH\.creditManagerCodeReveal/, 'کد فقط از channel اختصاصی درخواست می‌شود')
assert.match(ui, /sourceId: pane\.detail\.ref\.id,[\s\S]{0,90}?sourceSubKind: pane\.detail\.ref\.subKind/)
assert.match(ui, /if \(!isManager\)[\s\S]{0,220}?setRevealedCreditCode\(null\)/,
  'با خروج مدیر، کد آشکارشده باید از state پاک شود')
assert.match(ui, /print:hidden/, 'نمایش ریزبین در مسیر چاپ گزارش نیست')
console.log('  ✓ UI کد را فقط به‌صورت مدیر/درخواست جدا نشان می‌دهد و با خروج پاک می‌کند')
