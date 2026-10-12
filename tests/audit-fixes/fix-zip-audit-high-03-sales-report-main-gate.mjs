/**
 * ZIP-AUDIT-HIGH-03
 *
 * The sales-report ManagerGate in the renderer is not an authorization
 * boundary. Both aggregate and row endpoints must reject a direct IPC invoke
 * from a sender that has not unlocked the reports panel, then work only for
 * that sender after the server-side panel session is opened.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-03-sales-report-main-gate.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-03-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const owner = 90303
const sender = { id: owner, isDestroyed: () => false, once: () => {} }

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

const invoke = (channel) => handlers.get(channel)({ sender }, {})
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`)
  }
}

console.log('۱) دو endpoint مالی بدون نشست پنل Reports از IPC رد می‌شوند')
for (const channel of [IPC.saleReportSummary, IPC.saleReportRows]) {
  const response = await invoke(channel)
  eq(`${channel} بدون نشست گزارش رد می‌شود`, response?.ok, false)
}

console.log('۲) بازشدن سروریِ همان پنل فقط برای همان sender خواندن را ممکن می‌کند')
runWithPanelSessionOwner(owner, () => notePanelUnlocked(PANEL_KEYS.salesReports, 'PANEL'))
for (const channel of [IPC.saleReportSummary, IPC.saleReportRows]) {
  const response = await invoke(channel)
  eq(`${channel} با نشست گزارش خوانده می‌شود`, response?.ok, true)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
