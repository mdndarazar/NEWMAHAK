/*
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۰ — «baseline پل تطبیق».
 *
 * این فایل تا آخر همه‌ی فازها باید سبز بماند؛ قرمز شدنش یعنی کسی معادله،
 * توضیح ردیف‌ها (HINTS)، بلوک ورودی‌ها/هشدار یا خروجی گزارش را بدون کامیت
 * مستندِ بازتولید golden عوض کرده و همه‌ی فازهای بعدی متوقف می‌شوند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s318-0-bridge-baseline.mjs
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bridgeTextSlices, canon, collectFixtures, sha256hex } from './_lib-bridge-golden-s318.mjs'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const readJson = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'))

let ok = 0
let bad = 0
const check = (label, actual) => {
  if (actual) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) }
}

// ---- ۱) گارد هش سه برش مبغوه ----------------------------------------------
const baseline = readJson('tests/audit-fixes/golden/bridge-baseline-s318.json')
const slicesNow = bridgeTextSlices()
for (const k of ['equation', 'hints', 'bridgeInputBlock'])
  check(`هش «${k}» با baseline ثابت است`, sha256hex(slicesNow[k]) === baseline.sha256?.[k])

// ---- ۲) سه فیکسچر golden --------------------------------------------
const golden = readJson('tests/audit-fixes/golden/bridge-summary-s318.json')
const now = JSON.parse(canon({ fixtures: await collectFixtures() })).fixtures

check('فیکسچر «پل بسته» با golden برابر است', canon(now.closed) === canon(golden.fixtures?.closed))
check('فیکسچر «unexplained>0» با golden برابر است', canon(now.posInvoice) === canon(golden.fixtures?.posInvoice))
check('فیکسچر «unexplained<0» با golden برابر است', canon(now.overpay) === canon(golden.fixtures?.overpay))

// ---- ۳) پایداری ساختاری خود فیکسچرها (طراحی آن‌ها چکامتع هست) -------------
check('پل بسته از دید کد واقعاً بسته است', now.closed.bridge.balanced === true && now.closed.bridge.unexplained === 0)
check('فیکسچر پرداختِ پس‌تاریخ‌شده ⇒ unexplained مثبت برابر مبلغ فاکتور', now.posInvoice.bridge.unexplained === 100_000 && !now.posInvoice.bridge.balanced)
check('فیکسچر اضافه‌دریافتِ داده‌ی قدیمی ⇒ unexplained منفی', now.overpay.bridge.unexplained === -50_000 && !now.overpay.bridge.balanced)
check('18 ردیف در هر سه فیکسچر', [now.closed, now.posInvoice, now.overpay].every((f) => f.bridge.rows.length === 18))

console.log(`\nنتیجه: ${ok} قبول، ${bad} رد`)
if (bad > 0) process.exit(1)
