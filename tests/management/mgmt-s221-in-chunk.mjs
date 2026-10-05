/**
 * بازبینی دوازدهم · B5 — فهرست‌های `in` بی‌سقف در تب‌های مدیریتی.
 *
 * SQLite برای هر Statement سقفِ پارامتر دارد (~۳۲هزار). سرویس‌های مدیریتی چند پرس‌وجو
 * با `where: { saleItemId: { in: itemIds } }` داشتند که طولش به اندازهٔ فروشِ پنجره است
 * (روی شعبهٔ پرفروشِ یک ماهِ شلوغ = ده‌هاهزار id) ⇒ خودِ کوئری خطا می‌دهد و تب می‌ترکد.
 * `findByIds` تکه‌تکه می‌خواند؛ این تست هم خودِ helper (تعدادِ صدا زدن + نبودِ تکرار/
 * ردیفِ جاافتاده) و هم یک تبِ واقعی با ۵۲۰ قلم را می‌سنجد، و در آخر اسکنِ سورس که آن
 * الگوها دوباره برنگردند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s221-in-chunk.mjs
 */
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-in-chunk-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { findByIds, IN_CHUNK } = await import('../../src/main/services/management/inChunk.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { toJalaliDate } = await import('@shared/jalali')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

/* ───────────── 1) خودِ helper ───────────── */
const rows = []
for (let i = 1; i <= 1200; i++) rows.push({ id: i, v: i * 2 })
let calls = 0
const fake = {
  thing: {
    findMany: async (a) => {
      calls++
      const ids = a.where.id.in
      if (ids.length > IN_CHUNK) throw new Error(`HARNESS-TEST: فهرستِ in تکه‌تکه نشد (${ids.length})`)
      let out = rows.filter((r) => ids.includes(r.id))
      if (a.take) out = out.slice(0, a.take)
      return out
    }
  }
}
calls = 0
const all = await findByIds(fake, 'thing', 'id', rows.map((r) => r.id).concat(rows.map((r) => r.id)).concat([0, -5, null, undefined, NaN]))
eq('۱۲۰۰ id در ۳ تکه خوانده می‌شود', calls, 3)
eq('تکراری ردیف نمی‌آید و هیچ‌کدام جا نمی‌ماند', all.length, 1200)
eq('id صفر/منفی/NaN/تکراری قبل از کوئری حذف می‌شود', all[0].v, 2)
eq('idِ آخر هم درست است', all[1199].v, 2400)
eq('فهرستِ خالی هیچ کوئری‌ای نمی‌زند', (await findByIds(fake, 'thing', 'id', [])), [])
calls = 0
eq('take رعایت می‌شود', (await findByIds(fake, 'thing', 'id', rows.map((r) => r.id), { take: 700 })).length, 700)
eq('با take، تکه‌های اضافه هم خوانده نمی‌شوند', calls <= 2, true)

/* ───────────── 2) تب سود با ۵۲۰ قلم (بیش از یک تکه) ───────────── */
const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const N = 520
const userId = seed.user('تکه‌ای')
const p = seed.product('قرطاسی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const variants = []
for (let i = 0; i < N; i++) variants.push(seed.variant(p, `k${i}`))
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 1990,
  issuedAtJalali: toJalaliDate(new Date(Date.now() - 3 * 86400_000)),
  issuedAt: Date.now() - 3 * 86400_000,
  goodsTotal: N * 700_000,
  discountTotal: 0,
  grandTotal: N * 700_000,
  status: 'CONFIRMED'
})
for (const v of variants) {
  sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 1000000, purchasePrice = 700000 WHERE id = ?').run(v)
  seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 1, unitPrice: 700_000, lineTotal: 700_000 })
  seed.insert('StockMovement', {
    variantId: v,
    delta: 1,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: buy,
    state: 'FINAL',
    createdAt: Date.now() - 3 * 86400_000
  })
}
await costEngine.run()

const inv = seed.insert('SaleInvoice', {
  receiptNo: 990,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: N * 1_000_000,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: N * 1_000_000,
  deductInventory: true,
  status: 'SETTLED'
})
for (const v of variants) {
  const it = seed.insert('SaleInvoiceItem', {
    invoiceId: inv,
    variantId: v,
    qty: 1,
    unitPrice: 1_000_000,
    discount: 0,
    tax: 0,
    lineTotal: 1_000_000
  })
  seed.insert('SaleItemStockAllocation', { invoiceId: inv, saleItemId: it, variantId: v, sourceKind: 'STORE', qty: 1 })
  seed.insert('StockMovement', {
    variantId: v,
    delta: -1,
    reason: 'SALE',
    refType: 'SaleInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: Date.now()
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = 0 WHERE id = ?').run(v)
}
await costEngine.run()
const prof = await profitService.profit({ fromJalali: today, toJalali: today })
eq(`فروشِ ۵۲۰ قلم (بیش از یک تکه) سرِ جایش است: درآمد ${N}م`, prof.revenue, N * 1_000_000)
eq('تعداد هم ۵۲۰ است (ردیفی از قلم‌ها در تکه‌تکه‌کردن گم نشده)', prof.soldQty, N)
eq('سود = ۵۲۰ × (۱م − ۷۰۰هزار)', prof.realProfit, N * 300_000)

/* ───────────── 3) اسکنِ سورس: الگوهای بی‌سقف برنگردند ───────────── */
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf-8')
const profSrc = read('../../src/main/services/management/ProfitService.ts')
const stockSrc = read('../../src/main/services/management/StockInsightService.ts')
const trendSrc = read('../../src/main/services/management/TrendService.ts')
eq('تب سود دیگر `saleItemId: { in: itemIds }` خام ندارد', profSrc.includes('saleItemId: { in: itemIds }'), false)
eq('تب سود `findByIds` را صدا می‌زند', (profSrc.match(/findByIds\(/g) || []).length >= 5, true)
eq('تب ABC/مانده هم همین‌طور', stockSrc.includes('saleItemId: { in: itemIds }'), false)
eq('تب خرید‌وفروش: `invoiceId: { in: ids }` خام نمانده', stockSrc.includes('invoiceId: { in: ids }'), false)
eq('سرویس‌ها helper را ایمپورت کرده‌اند', [profSrc, stockSrc, trendSrc].every((s) => s.includes("from './inChunk'")), true)
eq('هرجا که فهرست تکه‌تکه می‌شود هنوز سقفِ ۴۰۰تاییِ `returnShare` پابرجاست', read('../../src/main/services/management/returnShare.ts').includes('CHUNK = 400'), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
