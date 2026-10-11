/*
 * نشست ۳۱۸ • فاز ۰ — بازتولید دو golden فقط با دستور:
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/_regen-bridge-golden-s318.mjs
 *
 * هر گاه یکی از سه برش متنِ مبغوه _عمداً_ عوض شود (اصلاح مستند + مرورشده)
 * یا خروجی گزارش به دلیل تغییر آگاهانه در منطق فروش جابه‌جا شود، این را
 * دوباره اجرا کنید و تغییر را در همان کامیت توضیح دهید — گارد فازهای بعدی
 * fix-s318-0 به همین دو فایل قفل است.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { bridgeTextSlices, canon, collectFixtures, sha256hex } from './_lib-bridge-golden-s318.mjs'

const dir = resolve('tests/audit-fixes/golden')
mkdirSync(dir, { recursive: true })

const slices = bridgeTextSlices()
const baseline = {
  note: 'نشست ۳۱۸ · فاز ۰ — هش سه برش مبغوه (معادله، HINTS و بلوک ورودی‌های پل+هشدار). تغییر هر یک ⇒ تست fix-s318-0 قرمز.',
  sha256: Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, sha256hex(v)])),
  sliceLens: Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, v.length]))
}
writeFileSync(join(dir, 'bridge-baseline-s318.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf8')

const fixtures = await collectFixtures()
const summary = {
  note: 'نشست ۳۱۸ · فاز ۰ — خروجی reportRows (period + bridge + warnings) روی سه فیکسچر روز-ثابت: پل بسته / unexplained>0 / unexplained<0.',
  fixtures
}
writeFileSync(join(dir, 'bridge-summary-s318.json'), JSON.stringify(JSON.parse(canon(summary)), null, 2) + '\n', 'utf8')

function join(a, b) { return a.endsWith('/') ? a + b : `${a}/${b}` }
console.log('golden دو فایل به‌روز شد:')
console.log('  tests/audit-fixes/golden/bridge-baseline-s318.json')
console.log('  tests/audit-fixes/golden/bridge-summary-s318.json')
for (const [name, fx] of Object.entries(fixtures))
  console.log(`  · ${name}: balanced=${fx.bridge.balanced} unexplained=${fx.bridge.unexplained} target=${fx.bridge.target}`)
