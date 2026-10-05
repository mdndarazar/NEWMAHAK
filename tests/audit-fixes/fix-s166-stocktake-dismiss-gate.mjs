/**
 * ===========================================================================
 * نشست ۱۶۶ · S166-D1/D2 — گیت سمت main برای «امروز دیدم» یادآوری انبارگردانی
 * (ریسک باز «dismiss یادآوری انبارگردانی بی‌رمز»، هندآف ۱۶۵ بند ۲-۱).
 *
 * قبل از رفع:
 *   ۱) IPC.stocktakeDismiss بی‌هیچ رمز و بی‌هیچ ردی یادآوری انبارگردانی امروز را می‌خواباند ⇒ فروشنده
 *      می‌توانست نشان «وقت انبارگردانی رسیده» را پیش از دیدن مدیر پنهان کند (کنترل ضدسرقت بند ۳).
 *   ۲) کانال جانبی: IPC.stocktakeScheduleSet با همان برنامه و فقط dismissedJalali=امروز بی‌رمز پذیرفته
 *      می‌شد (Y13 عمداً dismissedJalali را از مقایسه بیرون گذاشته بود) ⇒ همان خواباندن از راه دیگر.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s166-stocktake-dismiss-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s166-dismiss-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
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
const dismissedNow = async () => (await ipc(IPC.stocktakeDue, undefined))?.data?.dismissed
const dueNow = async () => (await ipc(IPC.stocktakeDue, undefined))?.data?.due
const lastAudit = () => seed.one('SELECT id, userId, note FROM "AuditLog" WHERE action = \'STOCKTAKE_SCHEDULE_UPDATE\' ORDER BY id DESC LIMIT 1')
const auditCount = () => seed.count('AuditLog', "action = 'STOCKTAKE_SCHEDULE_UPDATE'")

const actor = seed.user('فروشنده‌ی نشست ۱۶۶')
const forged = seed.user('کارمند جعلی ۱۶۶')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })

// برنامه‌ای که امروز موعد دارد (تاریخ گذشته، بدون هیچ شمارش ثبت‌شده) و قفل پنل انبارگردانی روشن (پیش‌فرض)
seed.setting(SETTING_KEYS.panelLocks, {})
const sched = { enabled: true, dates: ['1400/01/01'], everyDays: 0, startJalali: '', dismissedJalali: '' }
seed.setting(SETTING_KEYS.stocktakeSchedule, sched)
eq('پیش‌شرط: امروز موعد انبارگردانی است', await dueNow(), true)
eq('پیش‌شرط: یادآوری خوابانده نشده', await dismissedNow(), false)

console.log('\n۱) «امروز دیدم» بی‌رمز / با رمز غلط ⇒ رد، یادآوری بیدار می‌ماند، بدون Audit')
let a0 = auditCount()
await ipcRejects('خواباندن بی‌رمز', IPC.stocktakeDismiss, undefined, 'رمز')
await ipcRejects('خواباندن با رمز غلط', IPC.stocktakeDismiss, { panelPassword: 'wrong-166' }, 'رمز')
eq('یادآوری هنوز بیدار است', await dismissedNow(), false)
eq('هیچ Audit تازه‌ای ثبت نشد', auditCount(), a0)

console.log('\n۲) کانال جانبی stocktakeScheduleSet: همان برنامه + dismissedJalali=امروز بی‌رمز ⇒ خواباندن نباید رخ دهد')
await ipc(IPC.stocktakeScheduleSet, { schedule: { ...sched, dismissedJalali: jalaliToday() } })
eq('یادآوری از راه stocktakeScheduleSet خوابانده نشد', await dismissedNow(), false)
await ipc(IPC.stocktakeScheduleSet, { schedule: { ...sched, dismissedJalali: jalaliToday() }, panelPassword: PW })
eq('حتی با رمز، stocktakeScheduleSet dismissedJalali را نمی‌نویسد (فقط کانال مستقل با Audit)', await dismissedNow(), false)

console.log('\n۳) با رمز مدیر ⇒ خوابانده و Audit با actor نشست (نه userId رندرر)')
a0 = auditCount()
await ipcOk('خواباندن با رمز مدیر', IPC.stocktakeDismiss, { panelPassword: PW, userId: forged })
eq('یادآوری امروز خوابانده شد', await dismissedNow(), true)
eq('یک Audit تازه', auditCount(), a0 + 1)
eq('Audit با actor نشست', lastAudit()?.userId, actor)
eq('یادداشت Audit فارسی و صریح', /یادآوری انبارگردانی امروز/.test(String(lastAudit()?.note)), true)

console.log('\n۴) تغییر واقعی برنامه با رمز، dismissedJalali امروز را پاک نمی‌کند (کانال‌ها مستقل)')
await ipcOk('ذخیره‌ی برنامه با رمز (dismissedJalali خالی در payload)', IPC.stocktakeScheduleSet, { schedule: { ...sched, everyDays: 30 }, panelPassword: PW })
eq('خواباندن امروز باقی ماند', await dismissedNow(), true)

console.log('\n۵) قفل پنل انبارگردانی خاموش ⇒ خواباندن بی‌رمز مجاز (بند ۴-۳۹) ولی باز هم Audit')
seed.setting(SETTING_KEYS.stocktakeSchedule, sched)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.stocktake]: false })
a0 = auditCount()
await ipcOk('خواباندن بی‌رمز با قفل خاموش', IPC.stocktakeDismiss, undefined)
eq('خوابانده شد', await dismissedNow(), true)
eq('Audit ثبت شد', auditCount(), a0 + 1)
seed.setting(SETTING_KEYS.panelLocks, {})

console.log('\n۶) UI: دکمه‌ی «امروز دیدم» رمز می‌گیرد و panelPassword می‌فرستد')
const ui = readFileSync(resolve('src/renderer/src/components/StocktakeReminderBadge.tsx'), 'utf8')
eq('call(CH.stocktakeDismiss, { panelPassword })', /call\(CH\.stocktakeDismiss, \{ panelPassword/.test(ui), true)
eq('کادر رمز در بنر (PasswordField)', /<PasswordField[\s\S]{0,120}value=\{pw\}/.test(ui), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
