/**
 * ممیزی نشست ۱۱۶ — تأیید رفتاری ProductService.movements (بدون ایراد در main).
 * edge caseهایی که fix-s115-stock-movements-full-ledger نداشت: createdAt یکسان (ترتیب قطعی با id)،
 * پیوستگی «موجودی پس از حرکت» در مرز صفحه با newerDeltaSum، صفحه‌ی آخر با هشدار، شناسه‌ی نامعتبر با پیام هدف، فیلتر کالا.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return String(e?.message ?? e) } }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s116v-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { productService } = await import('../../src/main/services/ProductService.ts')
const db = harnessClient(); const seed = makeSeeder(db)
const pid = seed.insert('Product', { name: 'جین' })
const vid = seed.insert('ProductVariant', { productId: pid, code: 'V1', barcode: 'B1', stock: 0 })
const other = seed.insert('ProductVariant', { productId: pid, code: 'V2', barcode: 'B2', stock: 0 })
const T = Date.now() - 3600_000
const deltas = [10, -1, -2, 5, -1, -1, 3, -4, -1, 2] // جمع ۱۰
deltas.forEach((d, i) => seed.insert('StockMovement', { variantId: vid, delta: d, reason: d > 0 ? 'PURCHASE' : 'SALE', state: i === 8 ? 'PENDING' : 'FINAL', createdAt: T }))
seed.insert('StockMovement', { variantId: other, delta: 99, reason: 'PURCHASE', state: 'FINAL', createdAt: T })
const stock = deltas.reduce((a, b) => a + b, 0)
const bal = (rows, newer) => { let after = stock - newer; return rows.map((r) => { const b = after; after -= r.delta; return b }) }
const all = await productService.movements({ variantId: vid })
const fullBal = bal(all, all.newerDeltaSum)
const seen = []; const chain = []; let lastWarn = null
for (let skip = 0; skip < 10; skip += 4) {
  const p = await productService.movements({ variantId: vid, take: 4, skip })
  seen.push(...p.map((r) => r.id)); chain.push(...bal(p, p.newerDeltaSum)); lastWarn = p.warnings
  eq(`skip=${skip}: جمع کل دفتر ورود ۲۰ · خروج ‎-۱۰ · موقت ۱`, [p.totals.inTotal, p.totals.outTotal, p.totals.pendingCount], [20, -10, 1])
}
eq('۱۰ حرکت یکتا با createdAt یکسان (ترتیب قطعی id)', [seen.length, new Set(seen).size], [10, 10])
eq('ترتیب صفحه‌ای = ترتیب یک‌جا', seen, all.map((r) => r.id))
eq('موجودی پس از حرکت در مرز صفحه‌ها پیوسته و برابر نمای یک‌جا', chain, fullBal)
eq('آخرین موجودی (قدیمی‌ترین حرکت) = ۱۰ (اولین خرید)', chain[chain.length - 1], 10)
eq('صفحه‌ی آخر هم هشدار دارد', (lastWarn ?? []).length > 0, true)
eq('حرکت کالای دیگر در دفتر نیست', all.some((r) => r.variantId === other), false)
const e = await errOf(() => productService.movements({ variantId: 0 }))
eq('شناسه‌ی نامعتبر ⇒ پیام هدف', !!e && e.includes('شناسه‌ی کالا برای گردش انبار معتبر نیست'), true)
eq('امضای قدیمی عددی کار می‌کند', (await productService.movements(vid)).length, 10)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
