/**
 * ===========================================================================
 * نشست ۱۶۸ · S168-D2 — «تنظیمات کهنه در صفحه‌ی باز فروش» (ریسک باز S166-D7).
 *
 * باگ: پنل فروش (Pos.tsx ⇒ چک‌باکس «چاپ فاکتور») و هوک مشترک useAutoCentralWithdraw (پنل فروش، فاکتور عمده،
 * انبار مرکزی) برای عوض‌کردن یک سوییچ، کل sale *بارگذاری‌شده در لحظه‌ی بازشدن پنل* را با همان یک فیلد
 * عوض‌شده می‌فرستند. اگر در این فاصله مدیر در صفحه‌ی تنظیمات (پنجره‌ی دیگر) مثلاً نام صندوق‌دار یا مهلت کد
 * برگشت را عوض کرده باشد، سرور آن فیلدها را «تغییر مدیری» می‌بیند و درخواست را با پیام «تأیید مدیر لازم است»
 * رد می‌کند (fail-closed ولی گیج‌کننده: فروشنده رمز درست پنل را زده و باز رد می‌شود). اگر هم کسی رمز مدیر را
 * داشت، تنظیم تازه‌ی مدیر با مقدار کهنه بازنویسی می‌شد.
 * رفع (فقط UI + تابع خالص مشترک withFreshSale در src/shared/receipt.ts): پیش از ذخیره، sale تازه از سرور خوانده
 * و فقط همان یک فیلد عوض می‌شود. سرور و گیت‌هایش دست نخوردند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s168-pos-stale-sale-toggles.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s168-pos-'))
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
const receiptMod = await import('@shared/receipt')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = receiptMod
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}

const withFresh = receiptMod.withFreshSale
eq('تابع مشترک withFreshSale در @shared/receipt وجود دارد', typeof withFresh, 'function')
/** شبیه‌سازی toggle پنل فروش: قبل از رفع sale بارگذاری‌شده، بعد از رفع sale تازه‌ی سرور */
const posToggle = async (loadedSale, patch, panelPassword) => {
  let nextSale = { ...loadedSale, ...patch }
  if (typeof withFresh === 'function') nextSale = withFresh((await ipc(IPC.settingsBundle, {})).data.sale, patch)
  return ipc(IPC.settingsSaveBundle, { sale: nextSale, panelPassword })
}

const actor = seed.user('فروشنده‌ی نشست ۱۶۸-پنل')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
seed.setting(SETTING_KEYS.panelLocks, {})
await settingsService.bundle()

console.log('\n۱) تابع خالص: پیش‌فرض‌ها + sale تازه + فقط patch')
if (typeof withFresh === 'function') {
  const m = withFresh({ cashierName: 'سرور', printEnabled: true }, { printEnabled: false })
  eq('patch اعمال شد', m.printEnabled, false)
  eq('فیلد تازه‌ی سرور ماند', m.cashierName, 'سرور')
  eq('فیلد نبوده ⇒ پیش‌فرض', m.returnCodeDays, receiptMod.DEFAULT_SALE_DEFAULTS.returnCodeDays)
  eq('ورودی null ⇒ پیش‌فرض + patch', withFresh(null, { autoCentralWithdraw: true }).autoCentralWithdraw, true)
} else { bad++; console.log('  ✗ تابع نیست ⇒ بخش ۱ اجرا نشد') }

console.log('\n۲) پنل فروش باز ⇒ مدیر در تنظیمات نام صندوق‌دار را عوض می‌کند ⇒ فروشنده با رمز پنل چاپ را خاموش می‌کند')
const loaded = { ...(await settingsService.saleDefaults()) } // لحظه‌ی بازشدن پنل فروش
const r0 = await ipc(IPC.settingsSaveBundle, { sale: { ...loaded, cashierName: 'مدیر تازه ۱۶۸', returnCodeDays: 5 }, managerPassword: PW })
eq('پیش‌شرط: تنظیمات مدیر ذخیره شد', r0?.ok, true)
let r = await posToggle(loaded, { printEnabled: !loaded.printEnabled }, PW)
eq('خاموش‌کردن چاپ با رمز پنل پذیرفته شد', r?.ok, true)
if (!r?.ok) console.log('    پیام سرور: ' + String(r?.error).slice(0, 180))
let now = await settingsService.saleDefaults()
eq('چاپ عوض شد', now.printEnabled, !loaded.printEnabled)
eq('نام صندوق‌دار تازه‌ی مدیر بازنویسی نشد', now.cashierName, 'مدیر تازه ۱۶۸')
eq('مهلت کد برگشت تازه‌ی مدیر بازنویسی نشد', now.returnCodeDays, 5)

console.log('\n۳) همان سناریو برای «برداشت خودکار از انبار مرکزی» (useAutoCentralWithdraw)')
const loaded2 = { ...(await settingsService.saleDefaults()) }
await ipc(IPC.settingsSaveBundle, { sale: { ...loaded2, cashierName: 'مدیر تازه‌تر ۱۶۸' }, managerPassword: PW })
r = await posToggle(loaded2, { autoCentralWithdraw: !loaded2.autoCentralWithdraw }, PW)
eq('تغییر برداشت خودکار با رمز پنل پذیرفته شد', r?.ok, true)
if (!r?.ok) console.log('    پیام سرور: ' + String(r?.error).slice(0, 180))
now = await settingsService.saleDefaults()
eq('برداشت خودکار عوض شد', now.autoCentralWithdraw, !loaded2.autoCentralWithdraw)
eq('نام صندوق‌دار تازه‌تر ماند', now.cashierName, 'مدیر تازه‌تر ۱۶۸')

console.log('\n۴) گیت سرور دست‌نخورده: تغییر فیلد مدیری با رمز پنل (نه مدیر) و بی‌رمز همچنان رد')
const r4 = await ipc(IPC.settingsSaveBundle, { sale: { ...now, cashierName: 'جعلی' } })
eq('تغییر نام صندوق‌دار بی‌رمز رد شد', r4?.ok === false && /رمز/.test(String(r4?.error)), true)
const r5 = await posToggle(now, { printEnabled: !now.printEnabled }, undefined)
eq('عوض‌کردن چاپ بی‌رمز (قفل روشن) رد شد', r5?.ok === false && /رمز/.test(String(r5?.error)), true)

console.log('\n۵) UI: هر دو محل پیش از ذخیره sale تازه را می‌خوانند')
const pos = readFileSync(resolve('src/renderer/src/pages/Pos.tsx'), 'utf8')
const hook = readFileSync(resolve('src/renderer/src/hooks/useAutoCentralWithdraw.ts'), 'utf8')
const posBody = pos.slice(pos.indexOf('const togglePrintEnabled = useCallback('), pos.indexOf('const autoCentralBox = useAutoCentralWithdraw('))
eq('Pos.tsx: sale تازه خوانده می‌شود', /call<[^>]*>\(CH\.settingsBundle\)/.test(posBody), true)
eq('Pos.tsx: nextSale = withFreshSale(…, { printEnabled: next })', /const nextSale = withFreshSale\([^)]*\{ printEnabled: next \}\)/.test(posBody), true)
eq('useAutoCentralWithdraw: sale تازه خوانده می‌شود', /call<[^>]*>\(CH\.settingsBundle\)/.test(hook), true)
eq('useAutoCentralWithdraw: nextSale = withFreshSale(…, { autoCentralWithdraw: next })', /const nextSale = withFreshSale\([^)]*\{ autoCentralWithdraw: next \}\)/.test(hook), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
