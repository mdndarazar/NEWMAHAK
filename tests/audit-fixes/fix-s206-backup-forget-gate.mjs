/**
 * نشست ۲۰۶ — حذف فایل بکاپ و ذخیرهٔ تنظیمات بکاپ در main گیت دارند.
 *
 * قبل: backupForget و backupConfigSave بدون رمز، actor از payload رندرر.
 * فروشنده می‌توانست مدرک (بکاپ قبل از دستکاری) را پاک کند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s206-backup-forget-gate.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s206-backup-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

harnessClient()
makeSeeder(harnessClient())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const msgOf = async (fn) => {
  try { await fn(); return 'NO_ERROR' }
  catch (e) { return String(e?.message ?? e) }
}

const SRC = readFileSync(new URL('../../src/main/services/BackupService.ts', import.meta.url), 'utf8')
const IPC = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const UI = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')

console.log('\n۰) سیم‌کشی')
truthy('forget گیت strict تنظیمات دارد', /async forget[\s\S]{0,800}assertPanelPasswordStrict\(\s*PANEL_KEYS\.settings/.test(SRC))
truthy('saveConfig گیت strict دارد', /async saveConfig[\s\S]{0,900}assertPanelPasswordStrict\(\s*PANEL_KEYS\.settings/.test(SRC))
truthy('forget ردیف Audit می‌نویسد', /AuditAction\.BACKUP_FORGET/.test(SRC))
truthy('IPC forget actor نشست است', /backupForget[\s\S]{0,160}withOptionalSessionActor/.test(IPC))
truthy('IPC saveConfig actor نشست است', /backupConfigSave[\s\S]{0,180}withOptionalSessionActor/.test(IPC))
truthy('IPC createManual actor نشست است', /backupCreate[\s\S]{0,180}withOptionalSessionActor/.test(IPC))
truthy('IPC pickDir actor نشست است', /backupPickDir[\s\S]{0,180}withOptionalSessionActor/.test(IPC))
truthy('UI حذف رمز می‌فرستد', /backupForget[\s\S]{0,120}managerPassword: backupGatePw/.test(UI))
truthy('UI ذخیرهٔ تنظیمات رمز می‌فرستد', /backupConfigSave[\s\S]{0,200}managerPassword: backupGatePw/.test(UI))

const electron = await import('electron')
electron.ipcMain.handle = () => {}
const { backupService } = await import('../../src/main/services/BackupService.ts')

console.log('\n۱) حذف بدون رمز / رمز غلط')
const noPass = await msgOf(() => backupService.forget({ id: 'dummy-s206.db' }))
truthy(`بدون رمز رد می‌شود (${noPass.split('\n')[0]})`, /همیشه رمز می‌خواهد/.test(noPass) && /حذف فایل بکاپ/.test(noPass))
const wrong = await msgOf(() => backupService.forget({ id: 'dummy-s206.db', managerPassword: 'غلط' }))
truthy('رمز غلط رد می‌شود', wrong !== 'NO_ERROR' && !/پیدا نشد/.test(wrong))

console.log('\n۲) تنظیمات بدون رمز')
const cfgNo = await msgOf(() => backupService.saveConfig({ keep: 1 }))
truthy(`saveConfig بدون رمز رد می‌شود (${cfgNo.split('\n')[0]})`, /همیشه رمز می‌خواهد/.test(cfgNo) && /تنظیمات بکاپ/.test(cfgNo))

console.log('\n۳) با رمز مدیر')
const cfgOk = await backupService.saveConfig({ keep: 7, everyDays: 1, managerPassword: PW })
eq('با رمز keep=7 ذخیره شد', cfgOk?.keep, 7)

const userData = electron.app.getPath('userData')
const imported = join(userData, 'backups', 'imported')
mkdirSync(imported, { recursive: true })
const id = 'imported-s206-probe.db'
writeFileSync(join(imported, id), 'not-a-real-db')
const ledgerPath = join(userData, 'backups', 'imported-ledger.json')
writeFileSync(ledgerPath, JSON.stringify([{ id, fileName: id, size: 12, at: new Date().toISOString() }]))
await backupService.forget({ id, managerPassword: PW })
eq('فایل بعد از حذف با رمز روی دیسک نیست', existsSync(join(imported, id)), false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
