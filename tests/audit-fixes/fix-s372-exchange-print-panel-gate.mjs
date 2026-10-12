/**
 * S372 — چاپ سند تعویض می‌تواند بارکد اعتبار خرید بسازد؛ بنابراین `print:exchange`
 * نباید از IPC مستقیم و بدون باز شدن یکی از دو پنل مجاز قابل اجرا باشد.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s372-exchange-print-panel-gate.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s372-exchange-print-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 37201, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { printService } = await import('../../src/main/services/PrintService.ts')
const { notePanelUnlocked, clearPanelSessions } = await import('../../src/main/services/panelSession.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')

const db = harnessClient()
const seed = makeSeeder(db)
seed.setting(SETTING_KEYS.panelLocks, {
  [PANEL_KEYS.salesReturn]: true,
  [PANEL_KEYS.salesReports]: true
})
clearPanelSessions()
const originalPrint = printService.printExchange
let calls = 0
printService.printExchange = async (input) => ({ printed: true, returnId: input?.returnId, call: ++calls })
registerIpcHandlers()
const invoke = () => handlers.get(IPC.printExchange)({ sender }, { returnId: 77 })

let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}

try {
  console.log('--- ۱. invoke مستقیم پیش از ساخت/چاپ بارکد متوقف می‌شود ---')
  const locked = await invoke()
  yes('بدون نشست هیچ پنل، چاپ رد می‌شود', locked?.ok === false)
  yes('پیام فارسی کاربر را به باز کردن قفل راهنمایی می‌کند', String(locked?.error ?? '').includes('قفل همین بخش را باز کنید'))
  yes('سرویس چاپ اصلاً صدا زده نشد', calls === 0)

  console.log('--- ۲. پنل برگشت یا گزارشات، هر کدام به تنهایی مجوز چاپ‌اند ---')
  notePanelUnlocked(PANEL_KEYS.salesReturn, 'PANEL', sender.id)
  const returnPanel = await invoke()
  yes('نشست پنل برگشت اجازه چاپ می‌دهد', returnPanel?.ok === true && returnPanel?.data?.printed === true)
  yes('چاپ با پنل برگشت یک بار اجرا شد', calls === 1)

  clearPanelSessions(sender.id)
  notePanelUnlocked(PANEL_KEYS.salesReports, 'PANEL', sender.id)
  const reportsPanel = await invoke()
  yes('نشست پنل گزارشات اجازه چاپ مجدد می‌دهد', reportsPanel?.ok === true && reportsPanel?.data?.printed === true)
  yes('چاپ با پنل گزارشات بار دوم اجرا شد', calls === 2)
} finally {
  printService.printExchange = originalPrint
  clearPanelSessions()
}

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
