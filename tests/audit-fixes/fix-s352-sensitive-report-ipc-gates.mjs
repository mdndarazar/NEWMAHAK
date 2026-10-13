/**
 * S352 — دادهٔ مالیِ صرفاً خواندنی هم باید UI → IPC → Main-session boundary
 * داشته باشد. این تست با event معتبر Electron، invoke مستقیمِ کانال‌های گزارش
 * حساس و scope جداگانهٔ تب نسیه را بررسی می‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s352-sensitive-report-ipc-gates.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s352-report-gates-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const owner = 35201
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
seed.setting(SETTING_KEYS.panelLocks, {
  [PANEL_KEYS.salesReports]: true,
  [PANEL_KEYS.salesCredit]: true
})
clearPanelSessions()
registerIpcHandlers()

const invoke = (channel, payload = {}) => handlers.get(channel)({ sender }, payload)
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

console.log('۱) کانال‌های گزارش حساس بدون پنل Reports رد می‌شوند')
const reports = [
  IPC.saleReturnCorrectionList,
  IPC.saleChequeList,
  IPC.saleExchangeList,
  IPC.saleFraudReview,
  IPC.saleReceiptGaps,
  IPC.saleReportItems,
  IPC.saleReportLedger,
  IPC.saleReportLimits,
  IPC.salePeriodLock
]
for (const channel of reports) {
  const response = await invoke(channel)
  eq(`${channel} بدون نشست گزارش`, response?.ok, false)
}
const creditLocked = await invoke(IPC.saleCreditList)
eq('فهرست بدهکاران بدون scope مستقل نسیه رد می‌شود', creditLocked?.ok, false)

console.log('۲) scope گزارش فقط خواندن‌های Reports را باز می‌کند')
runWithPanelSessionOwner(owner, () => notePanelUnlocked(PANEL_KEYS.salesReports, 'PANEL'))
const reportOpen = await invoke(IPC.saleReturnCorrectionList)
eq('دفتر اصلاحات با scope گزارش خوانده می‌شود', reportOpen?.ok, true)
const creditStillLocked = await invoke(IPC.saleCreditList)
eq('scope گزارش، scope نسیه نیست', creditStillLocked?.ok, false)

console.log('۳) scope نسیه مستقل است و logout همه‌چیز را می‌بندد')
runWithPanelSessionOwner(owner, () => notePanelUnlocked(PANEL_KEYS.salesCredit, 'PANEL'))
const creditOpen = await invoke(IPC.saleCreditList)
eq('فهرست بدهکاران با scope نسیه خوانده می‌شود', creditOpen?.ok, true)
clearPanelSessions(owner)
const afterLogout = await invoke(IPC.saleFraudReview)
eq('logout دسترسی گزارش حساس را فوراً می‌بندد', afterLogout?.ok, false)

console.log('۴) ساختار handlerها به Main gate متصل است')
const source = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
for (const key of ['saleChequeList', 'saleExchangeList', 'saleFraudReview', 'saleReceiptGaps', 'saleReportItems', 'saleReportLedger', 'saleReportLimits', 'salePeriodLock']) {
  const re = new RegExp(`handle\\(IPC\\.${key},[\\s\\S]{0,280}assertSalesReportsRead\\(`)
  truthy(`IPC.${key} پیش از سرویس گیت Reports دارد`, re.test(source))
}
truthy('IPC.saleCreditList پیش از سرویس گیت نسیه دارد', /handle\(IPC\.saleCreditList,[\s\S]{0,260}assertSalesCreditRead\(/.test(source))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
