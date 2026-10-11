// @ts-check
/** فاز ۶ — ترتیب بصری POS فقط با flex order عوض می‌شود؛ state/settle/gate تکرار نمی‌شود. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const pos = readFileSync('src/renderer/src/pages/Pos.tsx', 'utf8')
const toggle = pos.indexOf('panel={PANEL_KEYS.posPrintToggle}')
const creditControl = pos.indexOf('/* ---------- بخش ۷: فروش نسیه و پرداخت جزئی ---------- */')
const central = pos.indexOf('panel={PANEL_KEYS.posCentralWithdrawToggle}')
console.log('--- چیدمان کنترل پرداخت POS ---')
assert.ok(toggle >= 0 && creditControl >= 0 && central >= 0)
assert.equal((pos.match(/panel=\{PANEL_KEYS\.posPrintToggle\}/g) ?? []).length, 1)
assert.equal((pos.match(/panel=\{PANEL_KEYS\.posCentralWithdrawToggle\}/g) ?? []).length, 1)
assert.match(pos, /order-1 bg-white rounded shadow p-3 space-y-2/)
assert.match(pos.slice(creditControl, creditControl + 500), /order-2/)
assert.match(pos, /order-3 space-y-2/)
assert.match(pos, /!splitPayment && <div className="grid grid-cols-2 gap-2">/)
// فاز ۷ کنترل پرداخت ترکیبی را بی‌آن‌که دکمه‌های روش عادی را تکرار کند، داخل همان بخش افزود.
const order4 = pos.indexOf('order-4 bg-white rounded shadow p-3 space-y-2')
const order5 = pos.indexOf('className="order-5"')
assert.ok(order4 >= 0 && order4 < central, 'جزئیات انبار/عوارض باید بعد از بلوک پرداخت قرار گیرد')
assert.ok(order5 >= 0 && order5 < toggle, 'چاپ باید بعد از بلوک پرداخت قرار گیرد')
assert.equal((pos.match(/onClick=\{\(\) => void settle\(m\.key\)\}/g) ?? []).length, 1, 'دکمه‌های settle نباید کپی شوند')
console.log('✓ انتخاب روش پرداخت با order بصری بعد از جمع/تخفیف است؛ انبار/چاپ بعدترند و settle فقط یک‌بار mount است.')
