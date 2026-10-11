// syntax-only parse of TS/TSX files with the sandbox's esbuild (not the project's dependency; no typecheck)
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
const { transformSync } = await loadEsbuild()
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function findTsFiles(dir) {
  let list = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'out' || e.name === 'dist') continue
    const p = join(dir, e.name)
    if (e.isDirectory()) list = list.concat(findTsFiles(p))
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx') || e.name.endsWith('.js')) list.push(p)
  }
  return list
}

const targetFiles = process.argv.length > 2 ? process.argv.slice(2) : findTsFiles('src')

let ok = 0, bad = 0
for (const f of targetFiles) {
  const loader = f.endsWith('.tsx') ? 'tsx' : f.endsWith('.ts') ? 'ts' : 'js'
  try { transformSync(readFileSync(f, 'utf8'), { loader, format: 'esm', jsx: 'preserve' }); ok++; console.log('PARSE-OK ' + f) }
  catch (e) { bad++; console.log('PARSE-FAIL ' + f + '\n' + String(e.message).split('\n').slice(0, 6).join('\n')) }
}
console.log(`esbuild syntax: ${ok} OK · ${bad} FAIL`)
process.exitCode = bad ? 1 : 0
