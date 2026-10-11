/**
 * بازبینی نهایی چاپ — قفل میان‌برهای سراسری Shell هنگام باز بودن modal.
 * اجرا: node tests/audit-fixes/fix-s226-shell-modal-hotkeys.mjs
 *
 * مشکل گزارش‌شده: Windows dialog چاپ اعتبار می‌تواند چند دقیقه باز بماند و F2/F3/F8/F9/F10/F11
 * در Shell صفحه را عوض کند؛ با unmount شدن میزبان، پیام unknown/failed چاپ گم می‌شود.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')
let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

const modal = read('src/renderer/src/components/Modal.tsx')
const shell = read('src/renderer/src/components/Shell.tsx')
const hotkeys = read('src/renderer/src/hooks/useHotkeys.ts')

console.log('\n— Shell hotkeys vs modal stack')
check('Modal یک helper لحظه‌ای برای بازبودن هر modal/confirm export می‌کند', [
  /const modalStack: symbol\[\] = \[\]/.test(modal),
  /export function isAnyModalOpen\(\): boolean \{\s*return modalStack\.length > 0\s*\}/.test(modal),
  /modalStack\.push\(id\)/.test(modal),
  /modalStack\.splice\(idx, 1\)/.test(modal)
], [true, true, true, true])

check('Shell helper را از همان Modal stack می‌خواند', [
  /import \{ isAnyModalOpen \} from '\.\/Modal'/.test(shell),
  /Object\.entries\(ROUTE_BY_SHORTCUT\)/.test(shell)
], [true, true])

const mapBlock = shell.slice(shell.indexOf('Object.entries(ROUTE_BY_SHORTCUT)'), shell.indexOf('useHotkeys(map)'))
check('هر handler ناوبری Shell قبل از nav وضعیت modal را در لحظه keydown چک می‌کند', [
  /if \(isAnyModalOpen\(\)\) return/.test(mapBlock),
  mapBlock.indexOf('if (isAnyModalOpen()) return') >= 0 && mapBlock.indexOf('if (isAnyModalOpen()) return') < mapBlock.indexOf('nav(r)'),
  /زمان render Shell/.test(mapBlock) || /Shell را\s*دوباره render نمی‌کند/.test(mapBlock)
], [true, true, true])

check('useHotkeys همچنان enabled عمومی را نگه داشته و تصمیم modal را به handler لحظه‌ای Shell واگذار می‌کند', [
  /export function useHotkeys\(map: Record<string, \(\) => void>, enabled = true\)/.test(hotkeys),
  /const fn = map\[combo\] \?\? map\[e\.key\]/.test(hotkeys),
  /fn\(\)/.test(hotkeys)
], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
