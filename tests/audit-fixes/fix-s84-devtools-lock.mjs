/**
 * نشست ۸۴ · خوشه H · تصمیم مالک ۴-۳۶
 *
 * در build نهایی DevTools باید کاملاً بسته باشد: devTools:false روی BrowserWindow
 * اصلی و منوی سفارشی بدون toggleDevTools/reload. اجرای واقعی Electron در این
 * محیط ممکن نیست، پس این تست ایستا (روی متن سورس) است و صریحاً همین را اعلام می‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s84-devtools-lock.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const src = readFileSync(resolve('src/main/index.ts'), 'utf8')
const menuBlock = src.match(/function productionMenuTemplate[\s\S]*?\n\}/)?.[0] ?? ''

eq('پرچم DevTools فقط در حالت غیر packaged روشن است', /DEVTOOLS_ALLOWED\s*=\s*!app\.isPackaged/.test(src), true)
eq('پنجره‌ی اصلی devTools را به همان پرچم می‌بندد', /webPreferences:\s*\{[\s\S]*?devTools:\s*DEVTOOLS_ALLOWED/.test(src), true)
eq('منوی سفارشی در build نهایی نصب می‌شود', /Menu\.setApplicationMenu\(Menu\.buildFromTemplate\(productionMenuTemplate\(\)\)\)/.test(src), true)
eq('منو قبل از ساخت پنجره نصب می‌شود', /installApplicationMenu\(\)\s*\n\s*createWindow\(\)/.test(src), true)
eq('منوی نهایی گزینه‌ی DevTools ندارد', /toggleDevTools|forceReload|'reload'/.test(menuBlock), false)
eq('منوی نهایی خالی نیست (کپی/چسباندن کار کند)', /role:\s*'paste'/.test(menuBlock), true)
eq('هیچ openDevTools صریحی در main نیست', /openDevTools\(/.test(src), false)
console.log('  ⓘ تست ایستا است؛ اجرای واقعی Electron: اجرا نشد، دلیل: Electron/npm در محیط نیست.')

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
