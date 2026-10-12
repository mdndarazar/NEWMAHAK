/**
 * S373 — `credit:markPrinted` فقط یک شمارنده نیست: برای سند قابل‌مصرف اعتبار
 * رکورد Audit چاپ/چاپ‌مجدد می‌سازد. invoke مستقیم نباید بتواند آن را جعل کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s373-credit-mark-printed-manager-gate.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s373-credit-print-gate-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 37301, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { notePanelUnlocked, clearPanelSessions } = await import('../../src/main/services/panelSession.ts')
const { IPC } = await import('@shared/ipc')
const { PANEL_KEYS } = await import('@shared/panels')
const { jalaliToday } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const creditId = seed.insert('StoreCredit', {
  code: 'S373-PRINT-CREDENTIAL', amount: 1000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now(), issuedAtJalali: jalaliToday()
})
clearPanelSessions()
registerIpcHandlers()
const invoke = () => handlers.get(IPC.creditMarkPrinted)({ sender }, { id: creditId, userId: 999_999 })
const printCount = () => Number(seed.one('SELECT printCount FROM "StoreCredit" WHERE id = ?', creditId)?.printCount ?? -1)
const auditCount = () => seed.count('AuditLog', "entity = 'StoreCredit' AND entityId = ? AND action IN ('CREDIT_PRINT', 'CREDIT_REPRINT')", creditId)

let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}

try {
  console.log('--- ۱. بدون نشست مدیر، جعل چاپ رد و بی‌اثر است ---')
  const locked = await invoke()
  yes('invoke مستقیم رد می‌شود', locked?.ok === false)
  yes('پیام فقط نشست مدیر را می‌پذیرد', String(locked?.error ?? '').includes('نشست فعال مدیر'))
  yes('رد شدن شمارنده را تغییر نمی‌دهد', printCount() === 0)
  yes('رد شدن Audit چاپ جعلی نمی‌سازد', auditCount() === 0)

  console.log('--- ۲. نشست واقعی مدیر مسیر legacy را با actor امن عبور می‌دهد ---')
  notePanelUnlocked(PANEL_KEYS.creditManagement, 'MANAGER', sender.id)
  const allowed = await invoke()
  yes('پس از نشست مدیر، markPrinted مجاز است', allowed?.ok === true)
  yes('شمارنده یک‌بار بالا می‌رود', printCount() === 1)
  yes('Audit چاپ ثبت می‌شود', auditCount() === 1)
  yes('actor جعلی payload در Audit ذخیره نمی‌شود', seed.one('SELECT userId FROM "AuditLog" WHERE entity = ? AND entityId = ? ORDER BY id DESC LIMIT 1', 'StoreCredit', creditId)?.userId == null)
} finally {
  clearPanelSessions()
}

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
