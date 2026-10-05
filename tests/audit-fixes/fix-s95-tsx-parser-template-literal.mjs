/**
 * نشست ۹۵ · هارنس
 *
 * باگ: ابزار پارس TSX درون `${...}` را فقط وقتی می‌دید که بعد از مصرف `$`
 * دوباره همان نویسه را بررسی کند؛ بنابراین template literalهای واقعی را
 * رشته‌ی باز تشخیص می‌داد و برای کد سالم false positive می‌ساخت.
 *
 * تست قبل/بعد: یک فایل TSX کوچک با template literal تو‌در‌تو باید بدون خطای
 * نحوی از ابزار عبور کند. این تست فقط هارنس را می‌سنجد، نه typecheck را.
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s95-'))
const source = join(dir, 'sample.tsx')
writeFileSync(
  source,
  [
    'const label = `گزارش ${String(1405)} — ${`مبلغ ${1_800_000}`} — ${/"/g.test(\'"\')}`',
    'const App = () => <section title={`فیش ${label}`}>{label}</section>',
    'void App'
  ].join('\n'),
  'utf8'
)

const tool = resolve('tools/tsx-parse-check.mjs')
try {
  const output = execFileSync(process.execPath, [tool, source], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (!output.includes('همه‌ی 1 فایل نحواً سالم‌اند.')) {
    console.error(output)
    process.exit(1)
  }
  console.log('✓ template literalهای تو‌در‌تو false positive نمی‌سازند')

  const report = resolve('src/renderer/src/pages/SalesReports.tsx')
  const reportOutput = execFileSync(process.execPath, [tool, report], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (!reportOutput.includes('PASS  ') || !reportOutput.includes('SalesReports.tsx')) {
    console.error(reportOutput)
    process.exit(1)
  }
  console.log('✓ صفحه‌ی گزارش فروش بدون خطای نحوی پارس می‌شود')
} catch (error) {
  console.error(error.stdout ?? '')
  console.error(error.stderr ?? '')
  process.exit(1)
}
