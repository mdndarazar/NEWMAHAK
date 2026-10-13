/**
 * ZIP-AUDIT-MEDIUM-03
 *
 * The imported-backup ledger must not report a replace as applied before the
 * destructive copy has succeeded. A pre-copy marker turns any I/O failure
 * into a false success and can hide which database is actually live.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-medium-03-backup-replace-mark-after-copy.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/main/services/BackupService.ts', import.meta.url), 'utf8')
const start = source.indexOf("// ---------- جایگزینی کامل ----------")
const end = source.indexOf("return { mode: 'replace'", start)
const replace = source.slice(start, end)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

console.log('۱) ترتیب writeهای replace')
const copyAt = replace.indexOf('await copyFile(path, db)')
const connectAt = replace.indexOf('await prisma.$connect()')
const markAt = replace.indexOf("await this.markApplied(input.id, 'replace')")
eq('کپی واقعی بکاپ وجود دارد', copyAt >= 0, true)
eq('اتصال به DB جدید بعد از کپی است', connectAt > copyAt, true)
eq('markApplied فقط بعد از copy/connect است', markAt > connectAt, true)
eq('هیچ markApplied پیش از copy نیست', replace.slice(0, copyAt).includes("markApplied(input.id, 'replace')"), false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
