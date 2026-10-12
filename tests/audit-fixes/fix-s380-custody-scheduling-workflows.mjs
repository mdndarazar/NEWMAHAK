/**
 * Phase 7 — the explicit custody scheduling workflow is the only writer for
 * the policy that decides who may open a drawer.  It reconciles legacy/new
 * config in one transaction and freezes/resumes an active responsibility
 * segment without replacing its custodian or history.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s380-custody-scheduling-workflows.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-scheduling-s380-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { parseShiftConfig } = await import('../../src/shared/receipt.ts')

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

const manager = seed.user('مدیر S380')
const dailyCustodian = seed.user('مسئول روزانه S380')
const multiCustodian = seed.user('مسئول چندشیفت S380')
db.$harness.db.prepare('UPDATE "User" SET role=? WHERE id IN (?,?)').run('CASHIER', dailyCustodian, multiCustodian)

await custodyService.setPin({ userId: manager, newPassword: 'Manager380!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager380!' })
for (const [id, temporary, permanent] of [[dailyCustodian, 'DailyTemp380!', 'DailyFinal380!'], [multiCustodian, 'MultiTemp380!', 'MultiFinal380!']]) {
  await custodyService.setPin({ userId: id, newPassword: temporary, managerUserId: manager, managerPassword: 'Manager380!', reason: 'راه‌اندازی آزمون گردش‌کار برنامه‌ریزی حضانت' })
  await custodyService.setPin({ userId: id, currentPassword: temporary, newPassword: permanent })
}

const initial = parseShiftConfig(await settingsService.shiftConfig())
const single = await settingsService.saveCustodySchedulingWorkflow({
  shift: { ...initial, custodyMode: 'SINGLE_SHIFT', custodyModeConfigured: true, singleShiftCustodianUserId: dailyCustodian },
  reason: 'ثبت اولیه مسئول اصلی روزانه'
})
eq('گردش‌کار تک‌شیفت explicitly configured می‌شود', single.custodyModeConfigured, true)
eq('مسئول اصلی روزانه ذخیره می‌شود', single.singleShiftCustodianUserId, dailyCustodian)
const singleStatus = await custodyService.status()
eq('status فقط primary تک‌شیفت را به UI اعلام می‌کند', singleStatus.schedulingPolicy?.singleShiftCustodianUserId, dailyCustodian)
await rejects('کارمند دیگر در تک‌شیفت نمی‌تواند فقط با PIN صندوق را بگیرد', 'NOT_DAILY_CUSTODIAN', () => custodyService.open({ userId: multiCustodian, password: 'MultiFinal380!', countedCash: 1000 }))
const opened = await custodyService.open({ userId: dailyCustodian, password: 'DailyFinal380!', countedCash: 1000 })
const preSwitch = await custodyService.status()
eq('پیش از تغییر، مسئولیت روزانه واقعاً باز است', preSwitch.custodian?.id, dailyCustodian)

const multi = parseShiftConfig(single)
multi.custodyMode = 'MULTI_SHIFT'
multi.custodyModeConfigured = true
multi.singleShiftCustodianUserId = null
multi.templates = multi.templates.map((template, index) => ({ ...template, staffIds: index === 0 ? [multiCustodian] : [] }))
const savedMulti = await settingsService.saveCustodySchedulingWorkflow({
  shift: multi,
  reason: 'تغییر رسمی برنامه از مسئول روزانه به کارکنان مستقل هر شیفت'
})
eq('گردش‌کار چندشیفت ذخیره می‌شود', savedMulti.custodyMode, 'MULTI_SHIFT')
eq('چندشیفت primary تک‌شیفت را نگه نمی‌دارد', savedMulti.singleShiftCustodianUserId, null)
const afterSwitch = await custodyService.status()
eq('تغییر حالت مسئولیت باز را دوباره ACTIVE می‌کند', afterSwitch.state, 'ACTIVE')
eq('تغییر حالت مسئول segment قبلی را عوض نمی‌کند', afterSwitch.activeShiftId, opened.shiftId)
eq('تغییر حالت custodian prior را عوض نمی‌کند', afterSwitch.custodian?.id, dailyCustodian)
eq('freeze/resume دو epoch برای fence نویسنده‌های قبلی ثبت می‌کند', Number(afterSwitch.epoch) >= Number(preSwitch.epoch) + 2, true)
eq('رویداد freeze تغییر روش append-only است', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? AND type=?', opened.shiftId, 'CUSTODY_MODE_SWITCH_FREEZE')?.type, 'CUSTODY_MODE_SWITCH_FREEZE')
eq('رویداد commit تغییر روش append-only است', seed.one('SELECT type FROM "CustodyEvent" WHERE shiftId=? AND type=?', opened.shiftId, 'CUSTODY_MODE_SWITCH_COMMITTED')?.type, 'CUSTODY_MODE_SWITCH_COMMITTED')
eq('دلیل تغییر روش در evidence رویداد حفظ می‌شود', String(seed.one('SELECT payloadJson FROM "CustodyEvent" WHERE shiftId=? AND type=?', opened.shiftId, 'CUSTODY_MODE_SWITCH_COMMITTED')?.payloadJson ?? '').includes('تغییر رسمی برنامه'), true)
const shiftRow = seed.one('SELECT value FROM "Setting" WHERE key=?', 'shift.config')
const custodyRow = seed.one('SELECT value FROM "Setting" WHERE key=?', 'custody.config')
eq('منبع جدید mode، workflow-complete را ثبت می‌کند', JSON.parse(shiftRow?.value ?? '{}').custodyModeConfigured, true)
eq('دو config در همان workflow روی MULTI_SHIFT همگام‌اند', JSON.parse(custodyRow?.value ?? '{}').mode, 'MULTI_SHIFT')

await rejects('saveBundle نمی‌تواند mode را دور از freeze workflow عوض کند', 'CUSTODY_SCHEDULING_WORKFLOW_REQUIRED', () => settingsService.saveBundle({
  shift: { ...savedMulti, custodyMode: 'SINGLE_SHIFT', singleShiftCustodianUserId: dailyCustodian },
  managerPassword: '1111'
}))
await rejects('مسیر قدیمی custody config نمی‌تواند mode را مستقل عوض کند', 'CUSTODY_MODE_WORKFLOW_REQUIRED', () => custodyService.setConfig({
  config: { enabled: true, mode: 'SINGLE_SHIFT' }, managerUserId: manager, managerPassword: 'Manager380!'
}))

const settingsSource = readFileSync(new URL('../../src/main/services/SettingsService.ts', import.meta.url), 'utf8')
const custodySource = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const uiSource = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
eq('Main workflow writes both config sources inside a transaction', settingsSource.includes('saveCustodySchedulingWorkflow') && settingsSource.includes('SETTING_KEYS.custodyConfig') && settingsSource.includes('CUSTODY_MODE_SWITCH_FREEZE'), true)
eq('Main opening enforces the distinct single daily custodian rule', custodySource.includes('NOT_DAILY_CUSTODIAN') && custodySource.includes('effectiveCustodyMode'), true)
eq('Settings UI exposes separate named workflows, not the old multi checkbox copy', uiSource.includes('تک‌شیفت: یک مسئول اصلی روزانه') && uiSource.includes('چندشیفت: کارکنان مستقل هر شیفت') && uiSource.includes('ثبت گردش‌کار حضانت'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
