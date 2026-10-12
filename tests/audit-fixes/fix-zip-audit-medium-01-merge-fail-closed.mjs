/**
 * ZIP-AUDIT-MEDIUM-01
 *
 * Merge must be atomic not only for writes but also for its source schema: a
 * migration/read failure used to be logged and then treated as empty source
 * tables, producing a deceptively successful partial financial import.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-medium-01-merge-fail-closed.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-medium-01-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'target.db')

const { harnessClient, PrismaClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { buildDatabase } = await import('../../test/harness/schema.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { mergeBackup } = await import('../../src/main/services/MergeService.ts')

const target = harnessClient()
const sourceFile = join(dir, 'source.db')
buildDatabase(sourceFile)
const source = new PrismaClient({ datasources: { db: { url: `file:${sourceFile}?connection_limit=1` } } })
const seed = makeSeeder(source)
seed.insert('CashMovement', {
  amount: 910_000,
  type: 'DEPOSIT',
  occurredAt: new Date('2026-10-12T08:00:00.000Z'),
  occurredAtJalali: '1405/07/20',
  description: 'نباید بعد از خطای migration وارد شود'
})
await source.$disconnect()

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

console.log('۱) migration ناموجود، merge را پیش از هر write رد می‌کند')
// harness Electron app.getAppPath() را از cwd می‌گیرد. در پوشه‌ی خالی هیچ
// migration directory نداریم؛ نسخه‌ی قبلی فقط log می‌کرد و سپس merge را ادامه می‌داد.
const root = process.cwd()
process.chdir(dir)
const failure = await messageOf(() => mergeBackup({ file: sourceFile, fileName: 'source.db' }))
process.chdir(root)
eq('خطای migration به caller برمی‌گردد', /به‌روزرسانی ساختار بکاپ ناموفق/.test(failure), true)
eq('گردش مالی منبع بعد از خطا وارد نشده است', await target.cashMovement.count(), 0)

console.log('۲) خطای خواندن جدول موجود، دیگر empty-list تلقی نمی‌شود')
const mergeSource = readFileSync(new URL('../../src/main/services/MergeService.ts', import.meta.url), 'utf8')
eq('readAll خطا را به BusinessError تبدیل می‌کند', /خواندن جدول.*از بکاپ ناموفق[\s\S]{0,150}BusinessError|BusinessError[\s\S]{0,180}خواندن جدول.*از بکاپ ناموفق/.test(mergeSource), true)
eq('fallback قدیمیِ log و return [] برای readAll وجود ندارد', /\[merge\] read failed[\s\S]{0,120}return \[\]/.test(mergeSource), false)
eq('migration fallback «ادامه با خواندن خام» حذف شده است', mergeSource.includes('ادامه با خواندن خام'), false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
