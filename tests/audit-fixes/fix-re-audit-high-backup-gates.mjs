/**
 * RE-AUDIT-HIGH-03 — مسیر خام settings:set نباید backup.config را دورِ گیت
 * رسمی تغییر دهد و backup فوری/خروجی کامل نیز باید پیش از هر I/O یا cleanup
 * رمز strict تنظیمات بخواهد.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-re-audit-high-backup-gates.mjs
 */
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-re-audit-backup-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 40303, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { backupService } = await import('../../src/main/services/BackupService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { DEFAULT_MANAGER_PASSWORD: PW, SETTING_KEYS } = await import('@shared/receipt')
const db = harnessClient()
registerIpcHandlers()
const ipc = (channel, payload) => handlers.get(channel)({ sender }, payload)

let ok = 0
let bad = 0
const check = (label, value, detail = '') => {
  if (value) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const messageOf = async (fn) => {
  try {
    await fn()
    return ''
  } catch (e) {
    return String(e?.message ?? e)
  }
}

console.log('\n۱) RE-AUDIT-HIGH-03: settings:set خام')
const rawConfig = JSON.stringify({ autoDir: join(DIR, 'attacker-dir'), everyDays: 0, keep: 1 })
const rawResult = await ipc(IPC.settingsSet, { key: SETTING_KEYS.backupConfig, value: rawConfig })
check('backup.config از allowlist خام حذف شد و IPC بی‌رمز رد شد', rawResult?.ok === false && /مجاز نیست/.test(String(rawResult?.error ?? '')))
check('تنظیمات بکاپ با raw IPC تغییر نکرد', (await db.setting.findUnique({ where: { key: SETTING_KEYS.backupConfig } })) == null)

console.log('\n۲) خروجی/چرخش بکاپ پیش از هر I/O رمز strict می‌خواهد')
const targetDir = join(DIR, 'authorized-backups')
await backupService.saveConfig({ autoDir: targetDir, everyDays: 0, keep: 1, managerPassword: PW })
const protectedOldBackup = join(targetDir, 'shop-before-gate.db')
writeFileSync(protectedOldBackup, 'audit-evidence')
const nowNoPass = await messageOf(() => backupService.runNow())
check('backupNow بی‌رمز رد شد', /همیشه رمز می‌خواهد/.test(nowNoPass) && /بکاپ فوری/.test(nowNoPass))
check('رد backupNow بی‌رمز هیچ cleanupی روی نسخه‌ی قدیمی انجام نداد', existsSync(protectedOldBackup))
const manualNoPass = await messageOf(() => backupService.createManual())
check('خروجی کامل در مسیر دلخواه نیز بی‌رمز رد شد', /همیشه رمز می‌خواهد/.test(manualNoPass) && /فایل بکاپ کامل/.test(manualNoPass))

console.log('\n۳) مسیر رسمیِ رمزدار همچنان تنظیمات را می‌پذیرد')
const official = await backupService.saveConfig({ autoDir: targetDir, everyDays: 2, keep: 7, managerPassword: PW })
check('saveConfig رسمی با رمز مدیر کار می‌کند', official.autoDir === targetDir && official.everyDays === 2 && official.keep === 7)
check('backup.imports کم‌خطر نیز از raw IPC حذف شد', !(await ipc(IPC.settingsSet, { key: SETTING_KEYS.backupImports, value: '[]' }))?.ok)

console.log(`\nنتیجه RE-AUDIT-HIGH-03: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
