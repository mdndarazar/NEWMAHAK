/**
 * ===========================================================================
 * نشست ۱۶۶ · S166-D4/D5 — گیت سمت main برای چک‌باکس «چاپ فاکتور» (ریسک باز «posPrintToggle فقط UI»، S155-D2).
 *
 * قبل از رفع: قفل posPrintToggle فقط در UI بود؛ settings:saveBundle با sale که فقط printEnabled عوض شده
 * بی‌هیچ رمزی ذخیره می‌شد ⇒ فروشنده با دور زدن صفحه چاپ رسید را خاموش می‌کرد. بی‌رسید، مشتری نمی‌تواند
 * مبلغ ثبت‌شده را با مبلغ پرداختی‌اش مقایسه کند (کم‌ثبتی با تخفیف داخل بازه‌ی مجاز پنهان می‌ماند) — هدف ضدسرقت.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s166-print-toggle-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s166-print-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// sender معتبر لازم است تا آزمون گیت ضدتقلبِ خاموش/روشن‌کردن رسید را بسنجد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15106, isDestroyed: () => false, once: () => {} }

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
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 200)}`) }
  return r?.data
}
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 110)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون رمز پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
}
const settingRaw = (key) => seed.one('SELECT value FROM "Setting" WHERE key = ?', key)?.value ?? null
const lastAudit = () => seed.one('SELECT id, userId, note FROM "AuditLog" WHERE action = \'SETTINGS_UPDATE\' ORDER BY id DESC LIMIT 1')
const auditCount = () => seed.count('AuditLog', "action = 'SETTINGS_UPDATE'")

const actor = seed.user('فروشنده‌ی نشست ۱۶۶-چاپ')
const forged = seed.user('کارمند جعلی ۱۶۶-چاپ')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
seed.setting(SETTING_KEYS.panelLocks, {})
await settingsService.bundle() // مهاجرت تنبل تنظیمات عوارض (Audit جدا) پیش از شمارش

console.log('\n۱) قفل posPrintToggle روشن (پیش‌فرض): خاموش‌کردن چاپ بی‌رمز / رمز غلط ⇒ رد، بدون نوشتن و بدون Audit')
let cur = await settingsService.saleDefaults()
eq('پیش‌شرط: چاپ روشن است', cur.printEnabled, true)
let before = settingRaw(SETTING_KEYS.saleDefaults)
let a0 = auditCount()
await ipcRejects('خاموش‌کردن چاپ بی‌رمز', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: false } }, 'رمز')
await ipcRejects('خاموش‌کردن چاپ با رمز غلط', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: false }, panelPassword: 'wrong-166' }, 'رمز')
eq('saleDefaults دست‌نخورده', settingRaw(SETTING_KEYS.saleDefaults), before)
eq('چاپ هنوز روشن است', (await settingsService.saleDefaults()).printEnabled, true)
eq('هیچ Audit تازه‌ای ثبت نشد', auditCount(), a0)

console.log('\n۲) با رمز مدیر ⇒ پذیرفته، Audit با actor نشست و یادداشت صریح «چاپ فاکتور خاموش شد»')
await ipcOk('خاموش‌کردن چاپ با رمز مدیر (panelPassword)', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: false }, panelPassword: PW, userId: forged })
eq('چاپ خاموش شد', (await settingsService.saleDefaults()).printEnabled, false)
eq('یک Audit تازه', auditCount(), a0 + 1)
eq('Audit با actor نشست', lastAudit()?.userId, actor)
eq('یادداشت Audit: «چاپ فاکتور خاموش شد»', /چاپ فاکتور خاموش شد/.test(String(lastAudit()?.note)), true)

console.log('\n۳) روشن‌کردن دوباره هم رمز می‌خواهد (هر تغییر = همان قفل)؛ با managerPassword هم باز می‌شود')
cur = await settingsService.saleDefaults()
await ipcRejects('روشن‌کردن چاپ بی‌رمز', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: true } }, 'رمز')
await ipcOk('روشن‌کردن چاپ با managerPassword', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: true }, managerPassword: PW })
eq('چاپ روشن شد', (await settingsService.saleDefaults()).printEnabled, true)
eq('یادداشت Audit: «چاپ فاکتور روشن شد»', /چاپ فاکتور روشن شد/.test(String(lastAudit()?.note)), true)

console.log('\n۴) sale بی‌تغییر ⇒ بی‌رمز پذیرفته (ذخیره‌ی بی‌اثر گیت نمی‌خورد)')
await ipcOk('sale بی‌تغییر بی‌رمز', IPC.settingsSaveBundle, { sale: await settingsService.saleDefaults() })

console.log('\n۵) قفل posPrintToggle خاموش ⇒ بی‌رمز مجاز (بند ۴-۳۹)')
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.posPrintToggle]: false })
cur = await settingsService.saleDefaults()
await ipcOk('خاموش‌کردن چاپ بی‌رمز با قفل خاموش', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: false } })
eq('چاپ خاموش شد', (await settingsService.saleDefaults()).printEnabled, false)
seed.setting(SETTING_KEYS.panelLocks, {})

console.log('\n۶) UI: Pos.tsx رمز چاپ را می‌گیرد و panelPassword می‌فرستد')
const ui = readFileSync(resolve('src/renderer/src/pages/Pos.tsx'), 'utf8')
eq('togglePrintEnabled ⇒ settingsSaveBundle با panelPassword', /CH\.settingsSaveBundle, \{ sale: nextSale, panelPassword: printNeedPw \? printPw : undefined \}/.test(ui), true)
eq('کادر رمز کنار چک‌باکس چاپ', /<PasswordField[\s\S]{0,160}value=\{printPw\}/.test(ui), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
