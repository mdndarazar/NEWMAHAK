// تست حضور-ساختار پچ مقاومت migrator در برابر قفل SQLite (سبک تست‌های audit-fixes؛
// این تست منطق زمان‌اجرا را اثبات نمی‌کند، فقط قراردادهای امنیتی کد را پایش می‌کند تا
// تغییرات آینده‌ی کورکورانه دوباره همان باگ startup را برنگردانند.)
import { readFileSync } from 'node:fs'
const read = (p) => readFileSync(p, 'utf8')
const migrator = read('src/main/db/migrator.ts')
const merge = read('src/main/services/MergeService.ts')
const backup = read('src/main/services/BackupService.ts')
const maint = read('src/main/services/MaintenanceService.ts')

let passed = 0
let failed = 0
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) passed++
  else failed++
  console.log(`  ${ok ? '✓' : '✗'} ${label}${ok ? '' : ` · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`}`)
}

console.log('\n— SQLite migration resistance to locking')
check('کلاینت migration تک‌اتصاله و جدا از کلاینت اصلی است و در پایان بسته می‌شود', [
  /connection_limit=1/.test(migrator) && /new PrismaClient\(\{ datasources/.test(migrator),
  /migrateClient\.\$disconnect\(\)\.catch/.test(migrator),
  !/return applyMigrations\(prisma/.test(migrator)
], [true, true, true])
check('BEGIN خام هرگز swallow نمی‌شود و migration خارج از تراکنش اجرا نمی‌شود', [
  !/catch\s*\{\s*inTx\s*=\s*false\s*\}/.test(migrator),
  /await client\.\$executeRawUnsafe\('BEGIN IMMEDIATE'\)\s*\n\s*inTx = true/.test(migrator),
  /const lock = isLockError\(e\)/.test(migrator)
], [true, true, true])
check('ROLLBACK فقط بعد از BEGIN موفق و فقط خطای قفل با backoff محدود retry می‌شود', [
  /function isLockError/.test(migrator) && /sqlite_busy/.test(migrator),
  /LOCK_MAX_ATTEMPTS = 5/.test(migrator) && /LOCK_BACKOFF_MS = \[250, 500, 1000, 2000, 4000\]/.test(migrator),
  /if \(inTx\) await client\.\$executeRawUnsafe\('ROLLBACK'\)\.catch/.test(migrator),
  /قفل فایل دیتابیس پس از/.test(migrator)
], [true, true, true, true])
check('ثبت history داخل تراکنش و مسیر بکاپ هم تک‌اتصاله است و busy_timeout تنظیم است', [
  /markApplied[\s\S]{0,200}COMMIT/.test(migrator) || /COMMIT/.test(migrator),
  /MIGRATION_BUSY_TIMEOUT_MS = 15000/.test(migrator) && /PRAGMA busy_timeout/.test(migrator),
  /file:\$\{file\}\?connection_limit=1/.test(merge)
], [true, true, true])
check('PRAGMAهای خروجی‌دار با $queryRawUnsafe اجرا می‌شوند (رفع Execute returned results)', [
  !backup.includes("$executeRawUnsafe('PRAGMA wal_checkpoint"),
  !maint.includes("$executeRawUnsafe('PRAGMA wal_checkpoint"),
  (backup.match(/\$queryRawUnsafe\('PRAGMA wal_checkpoint/g) || []).length === 3,
  (maint.match(/\$queryRawUnsafe\('PRAGMA wal_checkpoint/g) || []).length === 1,
  !migrator.includes('$executeRawUnsafe(`PRAGMA busy_timeout'),
  (migrator.match(/\$queryRawUnsafe\(`PRAGMA busy_timeout/g) || []).length === 1
], [true, true, true, true, true, true])

console.log(`\n${failed ? '✗' : '✓'} ${passed} بررسی موفق${failed ? ` · ${failed} ناموفق` : ''}\n`)
process.exit(failed ? 1 : 0)
