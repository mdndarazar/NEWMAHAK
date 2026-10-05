/**
 * بازبینی دوازدهم · B2 — تب «سایز» فیلترِ دسته را **می‌خواند**؛ ادعای «بی‌اثر» در UI غلط بود.
 *
 * `sizeCurve(filter)` خودِ `stock(filter, { withCost: false })` را صدا می‌زند و `stock()`
 * `categoryId` را (با زیردسته‌ها) اعمال می‌کند. نشستِ قبل «size» را در `CAT_INERT_TABS`
 * گذاشتم ⇒ جعبهٔ دسته خاکستری می‌شد و انتخابِ کاربر بی‌صدا دور ریخته می‌شد، درحالی‌که
 * راهنمای همان صفحه می‌گفت «فیلتر دسته روی سایز اثر دارد». این تست دو نیم را به هم
 * می‌دوزد: رفتارِ سرویس (دو دسته، دو عددِ متفاوت) و فهرستِ UI.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-s221-size-category.mjs
 */
import { mkdtempSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-size-cat-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockInsightService } = await import('../../src/main/services/management/StockInsightService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
void toJalaliDate
const today = toJalaliDate(new Date())

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

const catA = seed.category('کاپشن')
const catB = seed.category('کفش')
const pA = seed.product('کاپشن ورزشی', catA)
const pB = seed.product('کفش اداری', catB)
const vA = seed.variant(pA, 'L')
const vB = seed.variant(pB, '42')
sql.prepare('UPDATE "ProductVariant" SET stock = 7 WHERE id = ?').run(vA)
sql.prepare('UPDATE "ProductVariant" SET stock = 11 WHERE id = ?').run(vB)
seed.insert('ProductVariant', { productId: pA, code: 'A2', barcode: 'A2', salePrice: 500_000, size: 'XL', stock: 3 })
void today

const all = await stockInsightService.sizeCurve({})
const onlyA = await stockInsightService.sizeCurve({ categoryId: catA })
const onlyB = await stockInsightService.sizeCurve({ categoryId: catB })

const names = (r) => (r.products ?? []).map((x) => x.name).sort()
eq('بدون فیلتر: هر دو کالا در منحنی سایز هستند', names(all), ['کاپشن ورزشی', 'کفش اداری'])
eq('با دستهٔ «کاپشن»: فقط کاپشن (سرویس واقعاً فیلتر می‌کند)', names(onlyA), ['کاپشن ورزشی'])
eq('با دستهٔ «کفش»: فقط کفش', names(onlyB), ['کفش اداری'])
const totStock = (r) => (r.products ?? []).reduce((s, p) => s + Number(p.totalStock || 0), 0)
eq('جمعِ ماندهٔ فیلترشده با جمعِ کل فرق دارد (یعنی عددِ دیگری است، نه همان عددِ همه‌دسته‌ها)', [totStock(onlyA), totStock(onlyB), totStock(all)], [10, 11, 21])

// نیمهٔ دوم: UI باید همین را بگوید — «سایز» در فهرستِ تب‌های بی‌اثر نباشد.
const ui = readFileSync(new URL('../../src/renderer/src/pages/ManagementReports.tsx', import.meta.url), 'utf-8')
const listLine = (ui.match(/const CAT_INERT_TABS = \[[^\]]*\]/) ?? [''])[0]
eq('فهرستِ «بی‌اثر» در UI دیگر «size» را ندارد (باگ: داشت و انتخابِ کاربر را بی‌صدا دور می‌ریخت)', listLine.includes("'size'"), false)
eq('و تب‌های واقعاً بی‌اثر سرِ جایشان‌اند', ['trend', 'buy', 'heat'].every((t) => listLine.includes(`'${t}'`)), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
