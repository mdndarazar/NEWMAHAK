/**
 * ===========================================================================
 * نشست ۱۶۸ · S168-D1 — ذخیره‌ی کهنه‌ی صفحه‌ی تنظیمات روی «چاپ فاکتور» و «برداشت خودکار از انبار مرکزی»
 * (ریسک باز S166-D7، نکته‌ی تازه‌ی هندآف ۱۶۷).
 *
 * باگ: صفحه‌ی تنظیمات printEnabled/autoCentralWithdraw را نمایش/ویرایش نمی‌کند ولی در save() کل sale
 * بارگذاری‌شده (لحظه‌ی بازشدن صفحه) را به settings:saveBundle می‌فرستد. اگر بعد از بازشدن تنظیمات، از پنل فروش
 * (با رمز پنل) چاپ خاموش یا برداشت خودکار عوض شده باشد:
 *   (الف) با تغییر یک فیلد مدیری (مثلاً نام صندوق‌دار) + رمز مدیر ⇒ مقدار کهنه بی‌صدا برمی‌گردد
 *         (تصمیم آگاهانه‌ی کسی که با رمز چاپ را خاموش کرده، بدون هیچ ردی از «چرا» برگشت می‌خورد).
 *   (ب) بدون فیلد مدیری (مثلاً فقط قالب رسید) ⇒ سرور رمز پنل posPrintToggle/posCentralWithdrawToggle
 *       می‌خواهد و ذخیره‌ی بی‌ربط گیج‌کننده رد می‌شود.
 * رفع (فقط UI + یک تابع خالص مشترک): پیش از ذخیره، تنظیمات تازه خوانده و این دو فیلد از مقدار تازه‌ی سرور
 * برداشته می‌شوند (mergeFreshPosToggles در src/shared/receipt.ts). سرور و گیت‌هایش دست نخوردند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s168-settings-stale-pos-toggles.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s168-stale-'))
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
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW, DEFAULT_SALE_DEFAULTS } = receiptMod
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
  return r
}

const merge = receiptMod.mergeFreshPosToggles
eq('تابع مشترک mergeFreshPosToggles در @shared/receipt وجود دارد', typeof merge, 'function')
/** شبیه‌سازی دقیق save() صفحه‌ی تنظیمات: sale صفحه + (بعد از رفع) دو فیلد تازه‌ی سرور */
const pageSave = async (pageSale, extra) => {
  let sale = pageSale
  if (typeof merge === 'function') {
    const fresh = (await ipc(IPC.settingsBundle, {})).data
    sale = merge(pageSale, { ...DEFAULT_SALE_DEFAULTS, ...fresh.sale })
  }
  return ipc(IPC.settingsSaveBundle, { sale, ...extra })
}

const actor = seed.user('فروشنده‌ی نشست ۱۶۸')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
seed.setting(SETTING_KEYS.panelLocks, {})
await settingsService.bundle()

console.log('\n۱) تابع خالص: فقط printEnabled و autoCentralWithdraw از سرور؛ بقیه‌ی فیلدهای صفحه دست‌نخورده')
if (typeof merge === 'function') {
  const page = { ...DEFAULT_SALE_DEFAULTS, cashierName: 'صفحه', printEnabled: true, autoCentralWithdraw: false, returnCodeDays: 9 }
  const fresh = { ...DEFAULT_SALE_DEFAULTS, cashierName: 'سرور', printEnabled: false, autoCentralWithdraw: true, returnCodeDays: 3 }
  const m = merge(page, fresh)
  eq('printEnabled از سرور', m.printEnabled, false)
  eq('autoCentralWithdraw از سرور', m.autoCentralWithdraw, true)
  eq('cashierName از صفحه', m.cashierName, 'صفحه')
  eq('returnCodeDays از صفحه', m.returnCodeDays, 9)
  eq('ورودی صفحه mutate نشد', page.printEnabled, true)
} else { bad++; console.log('  ✗ تابع نیست ⇒ بخش ۱ اجرا نشد') }

console.log('\n۲) (الف) صفحه‌ی تنظیمات باز ⇒ POS چاپ را با رمز خاموش ⇒ تنظیمات با تغییر نام صندوق‌دار + رمز مدیر ذخیره')
const stale = { ...(await settingsService.saleDefaults()) } // لحظه‌ی بازشدن صفحه
eq('پیش‌شرط: چاپ روشن', stale.printEnabled, true)
await ipcOk('POS: خاموش‌کردن چاپ با رمز پنل', IPC.settingsSaveBundle, { sale: { ...stale, printEnabled: false }, panelPassword: PW })
await ipcOk('POS: روشن‌کردن برداشت خودکار با رمز پنل', IPC.settingsSaveBundle, { sale: { ...(await settingsService.saleDefaults()), autoCentralWithdraw: true }, panelPassword: PW })
let r = await pageSave({ ...stale, cashierName: 'صندوق‌دار ۱۶۸' }, { managerPassword: PW })
eq('ذخیره‌ی تنظیمات پذیرفته شد', r?.ok, true)
let now = await settingsService.saleDefaults()
eq('نام صندوق‌دار ذخیره شد', now.cashierName, 'صندوق‌دار ۱۶۸')
eq('چاپ خاموش ماند (مقدار کهنه برنگشت)', now.printEnabled, false)
eq('برداشت خودکار روشن ماند (مقدار کهنه برنگشت)', now.autoCentralWithdraw, true)

console.log('\n۳) (ب) صفحه‌ی کهنه، فقط قالب رسید عوض شده، بی‌رمز ⇒ نباید به رمز پنل چاپ/برداشت گیر کند')
const stale2 = { ...(await settingsService.saleDefaults()) } // لحظه‌ی بازشدن صفحه (مستقل از نتیجه‌ی بخش ۲)
const wantPrint = !stale2.printEnabled
const wantAuto = !stale2.autoCentralWithdraw
await ipcOk('POS: عوض‌کردن چاپ با رمز پنل', IPC.settingsSaveBundle, { sale: { ...stale2, printEnabled: wantPrint }, panelPassword: PW })
await ipcOk('POS: عوض‌کردن برداشت خودکار با رمز پنل', IPC.settingsSaveBundle, { sale: { ...(await settingsService.saleDefaults()), autoCentralWithdraw: wantAuto }, panelPassword: PW })
const b = (await ipc(IPC.settingsBundle, {})).data
r = await pageSave(stale2, { receipt: { ...b.receipt, footerLine3: 'پاورقی نشست ۱۶۸' } })
eq('ذخیره‌ی بی‌رمز قالب رسید پذیرفته شد', r?.ok, true)
if (!r?.ok) console.log('    پیام سرور: ' + String(r?.error).slice(0, 160))
now = await settingsService.saleDefaults()
eq('چاپ همان مقدار POS ماند', now.printEnabled, wantPrint)
eq('برداشت خودکار همان مقدار POS ماند', now.autoCentralWithdraw, wantAuto)

console.log('\n۴) گیت سرور دست‌نخورده: تغییر واقعی چاپ از این کانال بی‌رمز هنوز رد می‌شود')
const r4 = await ipc(IPC.settingsSaveBundle, { sale: { ...now, printEnabled: !now.printEnabled } })
eq('رد با پیام فارسی رمز', r4?.ok === false && /رمز/.test(String(r4?.error)), true)

console.log('\n۵) UI: Settings.tsx پیش از ذخیره تنظیمات تازه را می‌خواند و این دو فیلد را از سرور می‌گیرد')
const ui = readFileSync(resolve('src/renderer/src/pages/Settings.tsx'), 'utf8')
const saveBody = ui.slice(ui.indexOf('const save = async () => {'), ui.indexOf('const saveSecurity = async'))
eq('save() تنظیمات تازه را می‌خواند', /call<[^>]*>\(CH\.settingsBundle\)/.test(saveBody), true)
eq('save() از mergeFreshPosToggles استفاده می‌کند', /mergeFreshPosToggles\(/.test(saveBody), true)
/**
 * نشست ۲۲۲ (فاز ۳ چاپ): قالب رسید/لیبل پیش از ارسال با `mergeFreshPrinter` ادغام
 * می‌شوند تا نام چاپگرِ کهنه‌ی فرم، انتخاب تازه‌ی پنجره‌ی چاپگر را برنگرداند. پس
 * همان بررسیِ دقیق به نام‌های تازه‌ی متغیرها به‌روز شد — کلیدها، ترتیب و سخت‌گیری
 * عوض نشده و هیچ شرطی حذف/سست نشده است.
 */
eq('sale ادغام‌شده فرستاده می‌شود', /CH\.settingsSaveBundle, \{ receipt: receiptToSave, sale: saleToSave, shift, label: labelToSave, security, time, managerPassword: bundlePw \}/.test(saveBody), true)
eq('state صفحه هم به‌روز می‌شود', /setSale\(saleToSave\)/.test(saveBody), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
