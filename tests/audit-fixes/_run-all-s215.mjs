/**
 * رانر نشست ۲۱۵ — اجرای تست‌های audit-fixes و audit و ثبت نتیجه.
 *     node tests/audit-fixes/_run-all-s215.mjs
 */
import { spawn } from 'node:child_process'
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const dirs = ['tests/audit-fixes', 'tests/audit']
const files = []
for (const d of dirs) {
  for (const f of readdirSync(join(root, d)).sort()) {
    if (!f.endsWith('.mjs')) continue
    if (f.startsWith('_')) continue
    files.push(join(d, f))
  }
}

const results = []
const runOne = (file) => new Promise((resolve) => {
  const child = spawn('node', ['--import', './test/harness/register.mjs', file], {
    cwd: root,
    env: { ...process.env, HARNESS_BIGINT: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let out = ''
  const take = (s) => { out += s; if (out.length > 8000) out = out.slice(-8000) }
  child.stdout.on('data', (b) => take(String(b)))
  child.stderr.on('data', (b) => take(String(b)))
  const t = setTimeout(() => { child.kill('SIGKILL'); resolve({ file, ok: false, ms: 90_000, tail: 'TIMEOUT' }) }, 90_000)
  const t0 = Date.now()
  child.on('close', (code) => {
    clearTimeout(t)
    resolve({ file, ok: code === 0, ms: Date.now() - t0, tail: out.trim().split('\n').slice(-3).join(' | ') })
  })
})

console.log(`اجرای ${files.length} فایل…`)
let pass = 0
let fail = 0
let i = 0
for (const f of files) {
  i++
  const r = await runOne(f)
  results.push(r)
  if (r.ok) pass++
  else fail++
  const mark = r.ok ? '✓' : '✗'
  console.log(`${mark} [${i}/${files.length}] ${f} ${r.ms}ms`)
}

mkdirSync(join(root, '_تحویل'), { recursive: true })
const summary = {
  total: files.length, pass, fail,
  failed: results.filter((x) => !x.ok).map((x) => ({ file: x.file, ms: x.ms, tail: x.tail })),
  slow: results.filter((x) => x.ok).sort((a, b) => b.ms - a.ms).slice(0, 10)
}
writeFileSync(join(root, '_تحویل/نتیجه-رگرسیون-نشست۲۱۵.json'), JSON.stringify(summary, null, 2))
console.log(`\nجمع: ${pass} سبز · ${fail} قرمز از ${files.length}`)
process.exitCode = 0
