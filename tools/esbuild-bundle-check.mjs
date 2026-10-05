// Bundle-level static check with the sandbox's esbuild (NOT a typecheck):
// resolves every relative/alias import and flags missing files and missing named exports.
/**
 * 🔴 نشست ۱۸۵ — مسیر esbuild دیگر به `/opt/sd-artifact` سخت‌کد نیست.
 *
 * آن مسیر مالِ یک سندباکس خاص بود و در هر محیط دیگری وجود ندارد؛ نتیجه‌اش
 * این بود که این بررسی در لاگ رگرسیون با `ERR_MODULE_NOT_FOUND` کرش می‌کرد و
 * کسی که لاگ را می‌خواند فکر می‌کرد بخشی از رگرسیون شکسته است.
 *
 * حالا اول esbuildِ خودِ پروژه امتحان می‌شود و اگر نبود، با پیام روشن
 * «رد شد» خارج می‌شویم — نه کرش.
 */
async function loadEsbuild() {
  const candidates = [
    new URL('../node_modules/esbuild/lib/main.js', import.meta.url).href,
    '/opt/sd-artifact/node_modules/esbuild/lib/main.js'
  ]
  for (const c of candidates) {
    try {
      return await import(c)
    } catch {
      /* مسیر بعدی */
    }
  }
  console.log('SKIPPED: esbuild در دسترس نیست (npm install اجرا نشده است) — این بررسی رد شد، نه شکست.')
  process.exit(0)
}
const { buildSync } = await loadEsbuild()
import { resolve } from 'node:path'
const root = process.argv[2] ?? '.'
const targets = [
  { name: 'main', entry: 'src/main/index.ts', platform: 'node', alias: { '@shared': 'src/shared', '@main': 'src/main' } },
  { name: 'preload', entry: 'src/preload/index.ts', platform: 'node', alias: { '@shared': 'src/shared' } },
  { name: 'renderer', entry: 'src/renderer/src/main.tsx', platform: 'browser', alias: { '@shared': 'src/shared', '@renderer': 'src/renderer/src' } }
]
let bad = 0
for (const t of targets) {
  const alias = Object.fromEntries(Object.entries(t.alias).map(([k, v]) => [k, resolve(root, v)]))
  try {
    const r = buildSync({
      absWorkingDir: resolve(root), entryPoints: [t.entry], bundle: true, write: false, platform: t.platform,
      format: 'esm', jsx: 'automatic', logLevel: 'silent', alias,
      external: ['electron', '@prisma/client', '.prisma/*', 'react', 'react-dom', 'react-dom/*', 'react/*', 'react-router-dom', 'bwip-js', 'jalaali-js', 'electron-updater', 'node:*', '*.css'],
      loader: { '.png': 'empty', '.svg': 'empty', '.ttf': 'empty', '.woff': 'empty', '.woff2': 'empty' }
    })
    console.log(`BUNDLE-OK ${t.name} (${r.outputFiles[0].contents.length} bytes, warnings: ${r.warnings.length})`)
    for (const w of r.warnings.slice(0, 10)) console.log('  warn: ' + w.text + (w.location ? ` @ ${w.location.file}:${w.location.line}` : ''))
  } catch (e) {
    bad++
    console.log(`BUNDLE-FAIL ${t.name}`)
    for (const er of (e.errors ?? []).slice(0, 15)) console.log('  ' + er.text + (er.location ? ` @ ${er.location.file}:${er.location.line}` : ''))
  }
}
process.exitCode = bad ? 1 : 0
