/**
 * بازبینی یازدهم · B5 — «روز خواب» از دفتر حرکات انبار خوانده می‌شد، ولی بی‌اعتبار کردنِ
 * فاکتور فروش فقط `voidedAt` را پر می‌کند و هیچ حرکتِ برگشتی روی انبار نمی‌نویسد ⇒ یک
 * فروشِ لغوشده «آخرین فروش = دیروز» می‌ساخت و خوابِ کالای چندساله صفر می‌شد — درست خلافِ
 * چیزی که متنِ همان صفحه قول می‌داد. حالا «آخرین فروش» از فاکتورهای شمرده‌شده می‌آید.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-stock-sleep-voided-sale.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-sleep-void-'))
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
const today = toJalaliDate(new Date())
const DAY = 86400_000

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
const near = (label, got, want, tol = 1) => eq(label, got != null && Math.abs(got - want) <= tol, true)

const userId = seed.user('خواب')
seed.category('قاب موبایل')
const p = seed.product('قاب سیلیکونی')
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'A15')
sql.prepare('UPDATE "ProductVariant" SET stock = 5, salePrice = 200000, purchasePrice = 100000 WHERE id = ?').run(v)

/** فروشِ ۴۰۰ روز پیش — همان چیزی که باید «خواب» را از صفرِ دیروز نجات بدهد. */
const mkSale = (daysAgo, receiptNo) => {
  const at = Date.now() - daysAgo * DAY
  const inv = seed.insert('SaleInvoice', {
    receiptNo,
    issuedAtJalali: toJalaliDate(new Date(at)),
    issuedAt: at,
    userId,
    shiftId,
    goodsTotal: 200_000,
    discountTotal: 0,
    taxTotal: 0,
    grandTotal: 200_000,
    deductInventory: true,
    status: 'SETTLED'
  })
  const it = seed.insert('SaleInvoiceItem', {
    invoiceId: inv,
    variantId: v,
    qty: 1,
    unitPrice: 200_000,
    discount: 0,
    tax: 0,
    lineTotal: 200_000
  })
  seed.insert('StockMovement', {
    variantId: v,
    delta: -1,
    reason: 'SALE',
    refType: 'SaleInvoice',
    refId: inv,
    state: 'FINAL',
    createdAt: at
  })
  return { inv, it }
}
mkSale(400, 931)
/** و دیروز یک فروش ثبت شد و **بی‌اعتبار** گشت: حرکتش سرِ جایش است، سندش شمرده نمی‌شود. */
const yday = mkSale(1, 932)
sql.prepare('UPDATE "SaleInvoice" SET voidedAt = ? WHERE id = ?').run(Date.now(), yday.inv)

const rowOf = async () => {
  const st = await stockInsightService.stock({}, { withCost: false })
  return st.rows.find((x) => x.variantId === v)
}
const r1 = await rowOf()
near('فروشِ بی‌اعتبارشده خواب را صفر نمی‌کند (باگ: ۱ روز می‌شد)', r1?.sleepDays, 400)
eq('کالا «هرگز فروخته نشده» هم حساب نمی‌شود', r1?.neverSold, false)

/**
 * «پنجرهٔ ۳۰۰۰ فاکتورِ آخر»: فروشِ ۴۰۰ روزه باید بیرونِ پنجره بیفتد تا مرحلهٔ دومِ
 * کوئری (خواندنِ دقیقِ کالاهای خوابیده) واقعاً اجرا و سنجیده شود — یک فاکتورِ بی‌محتوا
 * با idِ بزرگ ساخته می‌شود تا کفِ پنجره جابه‌جا شود. عددِ خواب نباید عوض شود.
 */
const decoy = seed.insert('SaleInvoice', {
  receiptNo: 999001,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  userId,
  shiftId,
  goodsTotal: 0,
  discountTotal: 0,
  taxTotal: 0,
  grandTotal: 0,
  deductInventory: true,
  status: 'DRAFT'
})
sql.prepare('UPDATE "SaleInvoice" SET id = id + 4000 WHERE id = ?').run(decoy)
near('کالای خوابیده بیرونِ پنجرهٔ ۳۰۰۰ فاکتوره هم آخرین فروشش را پیدا می‌کند', (await rowOf())?.sleepDays, 400)

/** کنترلِ جهتِ مخالف: همان فاکتور از بی‌اعتباری برگردد ⇒ خواب باید به دیروز برسد. */
sql.prepare('UPDATE "SaleInvoice" SET voidedAt = NULL WHERE id = ?').run(yday.inv)
const r2 = await rowOf()
near('فروشِ معتبرِ دیروز خواب را یک روز می‌کند (کوئری تازه واقعاً کار می‌کند)', r2?.sleepDays, 1)

/** لغوِ کامل (status = CANCELED) هم مثل بی‌اعتبار است: حرکت دارد، شمارش ندارد. */
sql.prepare('UPDATE "SaleInvoice" SET status = ? WHERE id = ?').run('CANCELED', yday.inv)
const r3 = await rowOf()
near('فروشِ لغوشده هم خواب را صفر نمی‌کند', r3?.sleepDays, 400)
eq(
  'متنِ صفحه دیگر خلافِ واقع را قول نمی‌دهد',
  String((await stockInsightService.stock({}, { withCost: false })).note).includes('از فاکتورهای فروش'),
  true
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
