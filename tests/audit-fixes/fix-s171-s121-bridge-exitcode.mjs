/**
 * نشست ۱۷۱ · مشاهده‌ی باز AUDIT-PROGRESS ردیف ۱۳۴ (P3، فقط تست‌ها) · S171-D3
 *
 * fix-s121-report-export-page-warning.mjs پل تاریخی به fix-s133 است و بعد از import همیشه
 * `process.exit(0)` می‌زد. تا وقتی fix-s133 با `process.exit(1)` خارج می‌شود شکست دیده می‌شود،
 * ولی اگر روزی به `process.exitCode = 1` تغییر کند، پل همیشه سبز می‌شد (تست دروغ).
 * این تست پل را کنار یک fix-s133 ساختگی که فقط exitCode=1 می‌گذارد اجرا می‌کند؛ انتظار: خروج ≠ ۰.
 * و کنار ساختگیِ سبز: خروج ۰.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s171-s121-bridge-exitcode.mjs
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const bridge = readFileSync(resolve(root, 'tests/audit-fixes/fix-s121-report-export-page-warning.mjs'), 'utf8')
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} · دریافت ${got} · انتظار ${want}`) }
}
const runWith = (fakeBody) => {
  const dir = mkdtempSync(join(tmpdir(), 'mahak-s171-bridge-'))
  writeFileSync(join(dir, 'fix-s121-report-export-page-warning.mjs'), bridge)
  writeFileSync(join(dir, 'fix-s133-report-export-full-range.mjs'), fakeBody)
  const r = spawnSync(process.execPath, [join(dir, 'fix-s121-report-export-page-warning.mjs')], { cwd: root, encoding: 'utf8' })
  return r.status
}
eq('پل با fix-s133 ساختگی که فقط process.exitCode = 1 می‌گذارد ⇒ شکست (خروج ۱)', runWith('process.exitCode = 1\n'), 1)
eq('پل با fix-s133 ساختگی که process.exit(1) می‌زند ⇒ شکست (خروج ۱)', runWith('process.exit(1)\n'), 1)
eq('پل با fix-s133 ساختگیِ سبز ⇒ خروج ۰', runWith('console.log("ok")\n'), 0)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
