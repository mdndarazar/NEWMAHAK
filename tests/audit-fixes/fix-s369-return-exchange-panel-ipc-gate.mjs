/**
 * S369 — قفل صفحهٔ برگشت/تعویض باید روی mutationهای IPC هم اعمال شود.
 *
 * ManagerGate رندرر را نمی‌توان مرز امنیتی دانست: این تست invoke مستقیم دو
 * کانالِ پول/موجودی را با قفل روشن آزمایش می‌کند. خطای قفل باید پیش از هر
 * اعتبارسنجی سرویس یا جست‌وجوی فاکتور برگردد؛ پس payload جعلی هیچ اثری ندارد.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s369-return-exchange-panel-ipc-gate.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s369-return-panel-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 36901, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const { notePanelUnlocked, clearPanelSessions } = await import('../../src/main/services/panelSession.ts')

const db = harnessClient()
const seed = makeSeeder(db)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReturn]: true })
clearPanelSessions()
registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)

let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}

console.log('--- ۱. invoke مستقیم وقتی صفحه قفل است پیش از سرویس رد می‌شود ---')
for (const [name, channel] of [
  ['برگشت از فروش', IPC.saleReturn],
  ['تعویض کالا', IPC.saleExchangeCreate]
]) {
  const result = await invoke(channel, { invoiceId: 999_999, userId: 12345 })
  yes(`${name} با payload جعلی از قفل پنل عبور نمی‌کند`, result?.ok === false)
  yes(`${name} پیام فارسی باز کردن قفل صفحه دارد`, String(result?.error ?? '').includes('قفل همین بخش را باز کنید'))
  yes(`${name} پیش از اعتبارسنجی فاکتور متوقف می‌شود`, !String(result?.error ?? '').includes('فاکتور'))
}

console.log('--- ۲. نشست معتبر همان پنل از gate عبور می‌کند ---')
notePanelUnlocked(PANEL_KEYS.salesReturn, 'MANAGER', sender.id)
for (const [name, channel] of [
  ['برگشت از فروش', IPC.saleReturn],
  ['تعویض کالا', IPC.saleExchangeCreate]
]) {
  const result = await invoke(channel, { invoiceId: 999_999 })
  yes(`${name} پس از باز شدن قفل دیگر خطای gate پنل ندارد`, !String(result?.error ?? '').includes('قفل همین بخش را باز کنید'))
}

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
