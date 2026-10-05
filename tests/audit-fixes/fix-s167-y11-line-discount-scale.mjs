/**
 * ===========================================================================
 * نشست ۱۶۷ · Y11 (S152-D3 بازنگری ⇒ S167-D2) — گرد تخفیف ردیف‌های کوتاه‌شده با سقف سیاست در POS.
 *
 * مسئله: وقتی جمع تخفیف ردیف‌ها از سقف سیاست (بند ۴-۲۶) بیشتر است، Pos.tsx هر ردیف را با
 * Math.round(l.discount × lineScale) کوتاه می‌کرد. جمع گردشده‌ها می‌توانست چند ریال از سقف بیشتر شود
 * (مثال: ۳۳۳/۳۳۳/۳۳۴ با سقف ۵۰۰ ⇒ ۱۶۷+۱۶۷+۱۶۷ = ۵۰۱) ⇒ سرور (درست) فروش را رد می‌کرد و فروشنده گیر می‌کرد؛
 * و «قابل پرداخت» صفحه (goods − lineDisc) با جمع تخفیف سند چند ریال فرق داشت.
 *
 * رفع: تابع مشترک scaleLineDiscounts در @shared/priceAdjust (کف + توزیع ریال‌های باقی‌مانده به بزرگ‌ترین
 * باقی‌مانده‌ها) ⇒ جمع دقیقاً برابر سقف، هیچ ردیفی بیش از خواسته‌ی خودش؛ Pos.tsx هم در عوارض و هم در سند
 * همین تابع را می‌خواند. سرور tolerance نمی‌گیرد (بند ۴-۲۶ دست‌نخورده).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s167-y11-line-discount-scale.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s167y11-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')
const priceAdjust = await import('@shared/priceAdjust')
const scale = priceAdjust.scaleLineDiscounts

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 110)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); return null }
}
const S = (xs) => xs.reduce((a, b) => a + b, 0)

console.log('\n۱) تابع مشترک scaleLineDiscounts')
truthy('scaleLineDiscounts در @shared/priceAdjust وجود دارد', typeof scale === 'function')
if (typeof scale === 'function') {
  eq('۳۳۳/۳۳۳/۳۳۴ با سقف ۵۰۰ ⇒ جمع دقیقاً ۵۰۰', S(scale([333, 333, 334], 500)), 500)
  eq('بدون کوتاه‌شدن ⇒ دست‌نخورده', scale([100, 250, 0], 1000), [100, 250, 0])
  eq('سقف صفر ⇒ همه صفر', scale([100, 200], 0), [0, 0])
  eq('ردیف بی‌تخفیف تخفیف نمی‌گیرد', scale([0, 7, 0, 7], 7)[0] + scale([0, 7, 0, 7], 7)[2], 0)
  let worst = 0, over = 0, notExact = 0
  let seedN = 12345
  const rnd = (k) => { seedN = (seedN * 1103515245 + 12345) % 2147483648; return seedN % k }
  for (let t = 0; t < 3000; t++) {
    const n = 1 + rnd(8)
    const d = Array.from({ length: n }, () => rnd(5000))
    const target = rnd(S(d) + 1)
    const r = scale(d, target)
    if (r.some((x, i) => x > d[i] || x < 0 || !Number.isInteger(x))) over++
    if (S(r) !== Math.min(target, S(d))) notExact++
    worst = Math.max(worst, ...r.map((x, i) => Math.abs(x - (S(d) > 0 ? (d[i] * Math.min(target, S(d))) / S(d) : 0))))
  }
  eq('۳۰۰۰ حالت تصادفی: هیچ ردیفی بیش از خواسته‌ی خودش/منفی/اعشاری', over, 0)
  eq('۳۰۰۰ حالت تصادفی: جمع همیشه دقیقاً = min(سقف، خواسته)', notExact, 0)
  truthy(`انحراف هر ردیف از سهم دقیق < ۱ ریال (بیشینه ${worst.toFixed(3)})`, worst < 1)
}

console.log('\n۲) سرور: فرمول قدیم Math.round رد می‌شد؛ توزیع تازه پذیرفته می‌شود (بدون tolerance سمت سرور)')
const actor = seed.user('فروشنده ۱۶۷')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const pid = seed.product('شلوار ۱۶۷', seed.category('پوشاک ۱۶۷'))
const va = seed.insert('ProductVariant', { productId: pid, code: 'Y11-A', barcode: 'BY11-A', salePrice: 1000, stock: 100 })
const vb = seed.insert('ProductVariant', { productId: pid, code: 'Y11-B', barcode: 'BY11-B', salePrice: 1000, stock: 100 })
const vc = seed.insert('ProductVariant', { productId: pid, code: 'Y11-C', barcode: 'BY11-C', salePrice: 500, stock: 100 })
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 20, maxAmount: 0 })
const wanted = [333, 333, 334]
const ceiling = priceAdjust.discountCeilingFor({ mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 20, maxAmount: 0 }, 2500)
eq('سقف ۲۰٪ روی ۲٬۵۰۰ = ۵۰۰', ceiling, 500)
const lineScale = ceiling / S(wanted)
const oldWay = wanted.map((d) => Math.round(d * lineScale))
eq('فرمول قدیم جمع ۵۰۱ می‌داد (بازتولید Y11)', S(oldWay), 501)
const mk = (discs) => ({
  userId: actor, shiftId, deductInventory: false, payments: [],
  lines: [
    { variantId: va, code: 'Y11-A', barcode: 'BY11-A', name: 'الف', qty: 1, unitPrice: 1000, discount: discs[0], tax: 0 },
    { variantId: vb, code: 'Y11-B', barcode: 'BY11-B', name: 'ب', qty: 1, unitPrice: 1000, discount: discs[1], tax: 0 },
    { variantId: vc, code: 'Y11-C', barcode: 'BY11-C', name: 'ج', qty: 1, unitPrice: 500, discount: discs[2], tax: 0 }
  ]
})
await rejects('سرور فرمول قدیم (۵۰۱) را رد می‌کند (بند ۴-۲۶، بدون tolerance)', () => salesService.create(mk(oldWay)), 'تخفیف')
if (typeof scale === 'function') {
  const newWay = scale(wanted, ceiling)
  const inv = await safe(`سرور توزیع تازه (${newWay.join('+')}) را می‌پذیرد`, () => salesService.create(mk(newWay)))
  const sum = Number(seed.one('SELECT COALESCE(SUM(discount),0) AS s FROM "SaleInvoiceItem" WHERE invoiceId = ?', Number(inv?.id))?.s ?? -1)
  eq('جمع تخفیف ردیف‌های سند = سقف = عدد صفحه', sum, 500)
} else { bad++; console.log('  ✗ سرور توزیع تازه — تابع وجود ندارد') }

console.log('\n۳) Pos.tsx همین تابع را در سند و عوارض می‌خواند')
const pos = readFileSync(resolve('src/renderer/src/pages/Pos.tsx'), 'utf8')
truthy('دیگر Math.round(l.discount * lineScale) / totals.lineScale در کد نیست', !/Math\.round\(l\.discount \* (totals\.)?lineScale\)/.test(pos))
truthy('scaleLineDiscounts از @shared/priceAdjust import شده', /import \{[^}]*scaleLineDiscounts[^}]*\} from '@shared\/priceAdjust'/.test(pos))
truthy('lineDiscountOf از نقشه‌ی مقیاس‌شده می‌خواند', /lineDiscountOf = useCallback\([\s\S]{0,300}scaledLineDisc/.test(pos))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
