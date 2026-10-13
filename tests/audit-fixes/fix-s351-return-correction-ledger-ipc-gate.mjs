/**
 * S351 — دفتر اصلاحات جبرانی یک history مالی حساس است.
 *
 * صفحهٔ گزارش فروش پشت ManagerGate قرار دارد، اما renderer قابل اعتماد نیست؛
 * این تست مرز واقعی Electron IPC را می‌سنجد: با فعال بودن قفل گزارش فروش،
 * invoke مستقیم یا پنجرهٔ دیگر نباید rows دفتر را بخواند. بازشدن همان پنل در
 * همان webContents، و logout همان پنجره، تنها مجوزهای مورد انتظار هستند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s351-return-correction-ledger-ipc-gate.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s351-correction-ledger-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })

const owner = 35101
const otherOwner = 35102
const sender = { id: owner, isDestroyed: () => false, once: () => {} }
const otherSender = { id: otherOwner, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { PANEL_KEYS } = await import('@shared/panels')
const { SETTING_KEYS } = await import('@shared/receipt')
const { clearPanelSessions, notePanelUnlocked, runWithPanelSessionOwner } = await import('../../src/main/services/panelSession.ts')

const db = harnessClient()
const seed = makeSeeder(db)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReports]: true })
clearPanelSessions()
registerIpcHandlers()

const invoke = (activeSender) => handlers.get(IPC.saleReturnCorrectionList)({ sender: activeSender }, {})
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const truthy = (label, value) => {
  if (value) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}

console.log('۱) گیت Main پیش از خواندن دفتر')
const locked = await invoke(sender)
eq('invoke مستقیم با پنل گزارش قفل‌شده رد می‌شود', locked?.ok, false)
truthy('خطا به باز کردن قفل همان بخش اشاره می‌کند', String(locked?.error ?? '').includes('قفل همین بخش'))

console.log('۲) فقط نشست گزارش همان پنجره اجازهٔ خواندن می‌دهد')
runWithPanelSessionOwner(owner, () => notePanelUnlocked(PANEL_KEYS.salesReports, 'PANEL'))
const opened = await invoke(sender)
eq('باز شدن پنل گزارش در همان webContents اجازه می‌دهد', opened?.ok, true)
eq('DTO دفتر فقط rows می‌دهد', Array.isArray(opened?.data?.rows), true)

const foreign = await invoke(otherSender)
eq('پنجرهٔ دیگر نشست پنجرهٔ اول را به ارث نمی‌برد', foreign?.ok, false)

console.log('۳) logout/clear همان window دسترسی خواندنی را فوراً می‌بندد')
clearPanelSessions(owner)
const afterLogout = await invoke(sender)
eq('پس از logout invoke دوباره رد می‌شود', afterLogout?.ok, false)

afterLogout?.error && truthy('پاسخ خطا امن و قابل‌فهم است', !/SQL|prisma|stack/i.test(String(afterLogout.error)))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
