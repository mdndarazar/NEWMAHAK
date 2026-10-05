// نشست ۱۵۷: تست قبل/بعد Y13. قبل روی کپی دست‌نخورده‌ی zip ورودی ⇒ TESTLOG-s157y13-before.txt، بعد ⇒ TESTLOG-s157y13-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۷ · خوشه E/K · Y13 · کانال‌های جانبی تنظیمات (بند ۴-۲۹، ۴-۳۰، ۴-۳۹، بند ۵ «هر گیت در main»)
 *
 * قبل از رفع:
 *   ۱) IPC.settingsOfficialTimeSet (saveOfficialTime) افست ساعت رسمی را بی‌رمز می‌نوشت؛
 *      همان کلید officialTime که settings:set خام و saveBundle فقط با رمز مدیر می‌پذیرند.
 *   ۲) IPC.settingsShiftByTime (setShiftByTime) فیلد byTime کلید shiftConfig را بی‌رمز
 *      می‌نوشت و actor نداشت (userId رندرر پذیرفته می‌شد).
 *   ۳) IPC.stocktakeScheduleSet یادآوری انبارگردانی را بی‌گیت می‌نوشت (کلید
 *      stocktakeSchedule در RAW_SETTING_MANAGER_KEYS است) و userId رندرر را می‌پذیرفت.
 * انتظار بعد از رفع: S157-D1 تا S157-D4 در DECISIONS.md.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y13-settings-side-channels.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y13-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 110)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون تأیید پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
  return r
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 160)}`) }
  return r?.data
}
const settingRaw = (key) => seed.one('SELECT value FROM "Setting" WHERE key = ?', key)?.value ?? null
const lastAudit = (action) => seed.one('SELECT id, userId, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', action)
const auditCount = () => seed.count('AuditLog')

const actor = seed.user('مدیر نشست باز ۱۵۷')
const forged = seed.user('کارمند جعلی ۱۵۷')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })

console.log('\n۱) settingsOfficialTimeSet: تغییر افست بی‌رمز مدیر ⇒ رد، بدون نوشتن و بدون Audit')
const t0 = await settingsService.officialTime()
const next1 = (t0.offsetHours ?? 0) === 1 ? 2 : 1
let before = settingRaw(SETTING_KEYS.officialTime)
let a0 = auditCount()
await ipcRejects('افست تازه بی‌رمز', IPC.settingsOfficialTimeSet, { offsetHours: next1 }, 'رمز مدیر')
eq('کلید officialTime دست نخورد', settingRaw(SETTING_KEYS.officialTime), before)
eq('هیچ Audit تازه‌ای ساخته نشد', auditCount(), a0)
await ipcRejects('افست تازه با رمز غلط', IPC.settingsOfficialTimeSet, { offsetHours: next1, managerPassword: 'غلط-۱۵۷' }, 'رمز مدیر')
eq('کلید officialTime باز هم دست نخورد', settingRaw(SETTING_KEYS.officialTime), before)
const t1 = await ipcOk('افست تازه با رمز مدیر پذیرفته شد', IPC.settingsOfficialTimeSet, { offsetHours: next1, managerPassword: PW, userId: forged })
eq('افست ذخیره شد', (await settingsService.officialTime()).offsetHours, next1)
eq('Audit افست با actor نشست (نه userId رندرر)', lastAudit('SETTINGS_UPDATE')?.userId, actor)
await ipcOk('ذخیره‌ی بی‌تغییر همان افست بی‌رمز پذیرفته می‌شود (S155-D1)', IPC.settingsOfficialTimeSet, { offsetHours: next1 })
truthy('خروجی کانال همان پیکربندی است', t1 && t1.offsetHours === next1)

console.log('\n۲) settingsShiftByTime: تغییر سوییچ بی‌رمز مدیر ⇒ رد؛ actor از نشست')
const s0 = await settingsService.shiftConfig()
before = settingRaw(SETTING_KEYS.shiftConfig)
a0 = auditCount()
await ipcRejects('سوییچ byTime بی‌رمز', IPC.settingsShiftByTime, { byTime: !s0.byTime }, 'رمز مدیر')
eq('کلید shiftConfig دست نخورد', settingRaw(SETTING_KEYS.shiftConfig), before)
eq('هیچ Audit تازه‌ای ساخته نشد', auditCount(), a0)
await ipcOk('سوییچ byTime با رمز مدیر پذیرفته شد', IPC.settingsShiftByTime, { byTime: !s0.byTime, managerPassword: PW, userId: forged })
eq('byTime عوض شد', (await settingsService.shiftConfig()).byTime, !s0.byTime)
eq('قالب شیفت‌ها دست نخورد', JSON.stringify((await settingsService.shiftConfig()).templates), JSON.stringify(s0.templates))
eq('Audit سوییچ با actor نشست', lastAudit('SETTINGS_UPDATE')?.userId, actor)
await ipcOk('همان مقدار فعلی بی‌رمز پذیرفته می‌شود (بی‌تغییر)', IPC.settingsShiftByTime, { byTime: !s0.byTime })

console.log('\n۳) stocktakeScheduleSet: قفل پنل انبارگردانی روشن ⇒ رمز لازم؛ خاموش ⇒ آزاد؛ actor از نشست')
seed.setting(SETTING_KEYS.panelLocks, {})
const sched = { enabled: true, dates: ['1405/07/15'], everyDays: 30, startJalali: '1405/07/01' }
before = settingRaw(SETTING_KEYS.stocktakeSchedule)
a0 = auditCount()
await ipcRejects('یادآوری تازه بی‌رمز (قفل روشن)', IPC.stocktakeScheduleSet, { schedule: sched }, 'رمز')
eq('کلید stocktakeSchedule دست نخورد', settingRaw(SETTING_KEYS.stocktakeSchedule), before)
eq('هیچ Audit تازه‌ای ساخته نشد', auditCount(), a0)
await ipcOk('یادآوری با رمز مدیر پذیرفته شد', IPC.stocktakeScheduleSet, { schedule: sched, panelPassword: PW, userId: forged })
eq('Audit یادآوری با actor نشست', lastAudit('STOCKTAKE_SCHEDULE_UPDATE')?.userId, actor)
await ipcOk('همان یادآوری بی‌رمز (بی‌تغییر) پذیرفته می‌شود', IPC.stocktakeScheduleSet, { schedule: sched })
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.stocktake]: false })
await ipcOk('قفل پنل انبارگردانی خاموش ⇒ تغییر بی‌رمز مجاز (بند ۴-۳۹)', IPC.stocktakeScheduleSet, { schedule: { ...sched, everyDays: 20 } })
seed.setting(SETTING_KEYS.panelLocks, {})

console.log('\n۴) ساختاری: actor نشست در IPC و کادر رمز UI')
const read = (p) => readFileSync(resolve(p), 'utf8')
const ipcSrc = read('src/main/ipc/index.ts')
const lineOf = (n) => ipcSrc.split('\n').find((l) => l.includes(`handle(IPC.${n},`)) ?? ''
for (const n of ['settingsShiftByTime', 'settingsOfficialTimeSet', 'stocktakeScheduleSet'])
  truthy(`IPC.${n} ⇒ withOptionalSessionActor`, /withOptionalSessionActor\(p \?\? \{/.test(lineOf(n)))
const settingsPage = read('src/renderer/src/pages/Settings.tsx')
truthy('Settings: افست با managerPassword فرستاده می‌شود', /CH\.settingsOfficialTimeSet, \{[^}]*managerPassword/.test(settingsPage))
truthy('Settings: سوییچ شیفت با managerPassword فرستاده می‌شود', /CH\.settingsShiftByTime, \{[^}]*managerPassword/.test(settingsPage))
truthy('Stocktake: یادآوری با panelPassword فرستاده می‌شود', /CH\.stocktakeScheduleSet, \{[^}]*panelPassword/.test(read('src/renderer/src/pages/Stocktake.tsx')))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
