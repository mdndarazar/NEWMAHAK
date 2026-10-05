/**
 * ===========================================================================
 * نشست ۱۸۱ — نگهبانِ «هیچ پوشه‌ی تستی جا نماند»
 * ---------------------------------------------------------------------------
 * `tools/run-regression.sh` چند نشست پشت سر هم پوشه‌ی `tests/audit/` (۸۴ تست)
 * را اجرا نمی‌کرد، و هیچ‌کس متوجه نشد — چون خروجی اسکریپت با اطمینان
 * «رگرسیون کامل» می‌گفت. یک شکست واقعی در آن پوشه ماه‌ها می‌توانست پنهان بماند.
 *
 * این بررسی هر پوشه‌ای را که فایل تست دارد پیدا می‌کند و مطمئن می‌شود در
 * اسکریپت رگرسیون آمده است.
 *
 *     node tools/check-test-coverage.mjs
 * ===========================================================================
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const script = readFileSync(new URL('./run-regression.sh', import.meta.url), 'utf-8')

/** هر پوشه‌ای که مستقیماً فایل `*.mjs` تست دارد. */
const dirsWithTests = []
const walk = (dir) => {
  if (dir.includes('node_modules') || dir.includes('.git')) return
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  if (entries.some((e) => e.isFile() && e.name.endsWith('.mjs'))) dirsWithTests.push(dir)
  for (const e of entries) if (e.isDirectory()) walk(join(dir, e.name))
}
for (const root of ['test', 'tests']) if (existsSync(root)) walk(root)

/**
 * پوشه‌هایی که عمداً «تست اجرایی» نیستند و نباید در رگرسیون باشند:
 * زیرساخت هارنس و ماک‌های مشترک. هر پوشه‌ی دیگری باید اجرا شود.
 */
const INFRA = [join('test', 'harness'), join('tests', 'audit-fixes', 'support')]
const isInfrastructure = (dir) => INFRA.some((i) => dir === i || dir.startsWith(i + '/'))

const problems = []
for (const dir of dirsWithTests) {
  if (isInfrastructure(dir)) continue
  if (!script.includes(`"${dir}/*.mjs"`)) problems.push(dir)
}

console.log(`پوشه‌های دارای تست : ${dirsWithTests.length}`)
for (const d of dirsWithTests) {
  const n = readdirSync(d).filter((f) => f.endsWith('.mjs')).length
  const infra = isInfrastructure(d)
  const covered = script.includes(`"${d}/*.mjs"`)
  console.log(`  ${infra ? '—' : covered ? '✓' : '✗'} ${d}  (${n} فایل)${infra ? ' [زیرساخت، اجرا نمی‌شود]' : ''}`)
}

if (problems.length) {
  console.log(`\n✗ ${problems.length} پوشه در tools/run-regression.sh نیست:`)
  for (const p of problems) console.log(`  • ${p}`)
  process.exit(1)
}
console.log('\n✓ همه‌ی پوشه‌های تست در اسکریپت رگرسیون هستند')
