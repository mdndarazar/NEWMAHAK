// @ts-check
/** چک‌باکس چاپ POS باید درست بالای کنترل «فروش نسیه / پرداخت جزئی» باشد. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
const toggle = pos.indexOf('panel={PANEL_KEYS.posPrintToggle}')
const creditControl = pos.indexOf('/* ---------- بخش ۷: فروش نسیه و پرداخت جزئی ---------- */')
const central = pos.indexOf('panel={PANEL_KEYS.posCentralWithdrawToggle}')

console.log('--- چیدمان کنترل چاپ POS ---')
assert.ok(toggle >= 0, 'کنترل چاپ باید وجود داشته باشد')
assert.ok(creditControl >= 0, 'کنترل نسیه/پرداخت جزئی باید وجود داشته باشد')
assert.ok(toggle < creditControl, 'کنترل چاپ باید پیش از کنترل نسیه باشد')
assert.ok(central < toggle, 'کنترل چاپ باید از محل قدیمی کنار برداشت مرکزی جابه‌جا شده باشد')
assert.equal((pos.match(/panel=\{PANEL_KEYS\.posPrintToggle\}/g) ?? []).length, 1, 'کنترل چاپ نباید دو بار mount شود')
assert.match(pos.slice(toggle, creditControl), /printEnabled/)
assert.match(pos.slice(toggle, creditControl), /togglePrintEnabled/)
console.log('✓ چک‌باکس چاپ دقیقاً پیش از کنترل فروش نسیه/پرداخت جزئی و فقط یک‌بار رندر می‌شود.')
