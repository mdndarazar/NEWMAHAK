/**
 * ZIP-AUDIT-HIGH-06
 *
 * Direct IPC payloads must never turn a backup id into a filesystem path.  A
 * path traversal previously let `resolve()` feed an arbitrary local file into
 * restore, and let `forget()` unlink files outside userData/backups.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-06-backup-path-confinement.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-06-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { DEFAULT_MANAGER_PASSWORD: PW, SETTING_KEYS } = await import('@shared/receipt')
const electron = await import('electron')
const db = harnessClient()
makeSeeder(db)
const { backupService } = await import('../../src/main/services/BackupService.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const messageOf = async (fn) => {
  try { await fn(); return 'NO_ERROR' }
  catch (error) { return String(error?.message ?? error) }
}

const userData = electron.app.getPath('userData')
const backupDir = join(userData, 'backups')
const importedDir = join(backupDir, 'imported')
mkdirSync(importedDir, { recursive: true })

// This file is deliberately one level above `backups`; it is not a backup.
const outside = join(userData, 'outside-sensitive.db')
writeFileSync(outside, 'must survive traversal payloads')

console.log('۱) شناسه‌ی traversal به restore resolve نمی‌شود')
const traversalResolve = await messageOf(() => backupService.resolve('../outside-sensitive.db'))
eq('resolve ../ را رد می‌کند', traversalResolve !== 'NO_ERROR', true)
eq('پیام، شناسه‌ی نامعتبر را روشن می‌گوید', /شناسه.*نامعتبر|قابل‌اعتماد/.test(traversalResolve), true)
eq('فایل بیرون از backups بعد از resolve باقی است', existsSync(outside), true)

console.log('۲) همان payload با رمز مدیر هم unlink نمی‌شود')
const traversalForget = await messageOf(() => backupService.forget({ id: '../outside-sensitive.db', managerPassword: PW }))
eq('forget ../ را قبل از unlink رد می‌کند', traversalForget !== 'NO_ERROR', true)
eq('فایل بیرونی بعد از forget باقی است', existsSync(outside), true)

console.log('۳) فایل‌های مشروع فهرست‌شده همچنان کار می‌کنند')
const autoId = 'shop-2026-10-12-12-00-00.db'
const autoFile = join(backupDir, autoId)
writeFileSync(autoFile, 'fixture-auto-backup')
eq('auto backup مجاز resolve می‌شود', await backupService.resolve(autoId), autoFile)

const importedId = 'imported-1760000000000-clean.sqlite3'
const importedFile = join(importedDir, importedId)
writeFileSync(importedFile, 'fixture-imported-backup')
await db.setting.upsert({
  where: { key: SETTING_KEYS.backupImports },
  update: { value: JSON.stringify([{ id: importedId, fileName: 'clean.sqlite3', size: 23, at: new Date().toISOString() }]) },
  create: { key: SETTING_KEYS.backupImports, value: JSON.stringify([{ id: importedId, fileName: 'clean.sqlite3', size: 23, at: new Date().toISOString() }]) }
})
eq('imported backup ثبت‌شده resolve می‌شود', await backupService.resolve(importedId), importedFile)
await backupService.forget({ id: importedId, managerPassword: PW })
eq('forget مشروع فقط فایل imported ثبت‌شده را حذف می‌کند', existsSync(importedFile), false)
eq('فایل بیرونی در حذف مشروع هم دست‌نخورده است', existsSync(outside), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
