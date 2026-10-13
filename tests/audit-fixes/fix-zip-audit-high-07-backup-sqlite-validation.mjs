/**
 * ZIP-AUDIT-HIGH-07
 *
 * A backup must be a healthy SQLite database with MAHAK's baseline tables.
 * The old preview summarized query errors as zeroes, so arbitrary non-SQLite
 * bytes could enter the import ledger and later reach restore.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-07-backup-sqlite-validation.mjs
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-07-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { DEFAULT_MANAGER_PASSWORD: PW, SETTING_KEYS } = await import('@shared/receipt')
const { summarizeBackup } = await import('../../src/main/services/MergeService.ts')
const { backupService } = await import('../../src/main/services/BackupService.ts')
const electron = await import('electron')
const db = harnessClient()
makeSeeder(db)
// PrismaClient های موقتیِ محصول در اجرای واقعی اتصال خودشان را می‌بندند؛ stub
// harness عمداً shared است، پس close آن را no-op می‌کنیم تا سه سناریو مستقل را
// روی همان fixture اجرا کنیم.
db.$disconnect = async () => {}

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
const badId = 'imported-1760000000007-not-a-database.db'
const badFile = join(importedDir, badId)
writeFileSync(badFile, 'This is not a SQLite database; it must never be restorable.')
await db.setting.upsert({
  where: { key: SETTING_KEYS.backupImports },
  update: { value: JSON.stringify([{ id: badId, fileName: 'not-a-database.db', size: 55, at: new Date().toISOString() }]) },
  create: { key: SETTING_KEYS.backupImports, value: JSON.stringify([{ id: badId, fileName: 'not-a-database.db', size: 55, at: new Date().toISOString() }]) }
})

console.log('۱) preview فایل غیر SQLite را به «خلاصه صفر» تبدیل نمی‌کند')
const previewError = await messageOf(() => summarizeBackup(badFile))
eq('summarize فایل متن را رد می‌کند', previewError !== 'NO_ERROR', true)
eq('خطا روشن می‌گوید بکاپ SQLite معتبر نیست', /SQLite.*معتبر/.test(previewError), true)

console.log('۲) restore از همان imported row پیش از هر replace متوقف می‌شود')
const beforeSafety = existsSync(backupDir) ? readdirSync(backupDir).filter((name) => name.startsWith('before-restore-')).length : 0
const restoreError = await messageOf(() => backupService.apply({ id: badId, mode: 'replace', managerPassword: PW }))
const afterSafety = existsSync(backupDir) ? readdirSync(backupDir).filter((name) => name.startsWith('before-restore-')).length : 0
eq('replace غیر SQLite رد می‌شود', restoreError !== 'NO_ERROR', true)
eq('رد restore همان پیام اعتبارسنجی است', /SQLite.*معتبر/.test(restoreError), true)
eq('قبل از رد، safety backup ساخته نشده است', afterSafety, beforeSafety)
eq('فایل imported فقط خوانده شد و همچنان برای حذف مدیر باقی است', existsSync(badFile), true)

console.log('۳) دیتابیس سالم برنامه همچنان preview می‌شود')
const goodSummary = await summarizeBackup(process.env.HARNESS_DB)
eq('SQLite سالم خلاصه برمی‌گرداند', typeof goodSummary?.invoiceCount, 'number')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
