/**
 * بازبینی مدیریت · برگشت‌های متعددِ یک قلم در تب دسته نباید هرکدام جدا تا کل خط سقف بخورند.
 * مقدار برگشتیِ خام همچنان دیده می‌شود تا برگشتِ بیش‌ازفروش پنهان نشود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-category-multi-return-cap.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-cat-multi-ret-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { trendService } = await import('../../src/main/services/management/TrendService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 360))
  }
}

const userId = seed.user('چندبرگشت دسته')
const categoryId = seed.category('کاپشن')
const productId = seed.product('کاپشن کوتاه', categoryId)
const methodId = seed.insert('PaymentMethod', {
  key: 'CASH',
  label: 'نقدی',
  kind: 'CASH',
  isActive: 1,
  sortOrder: 1
})
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const variantId = seed.variant(productId, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000000, purchasePrice = 0 WHERE id = ?').run(variantId)

const sale = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 3, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId, amount: 3_000_000, destination: 'CASH' }]
})
const saleItemId = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id).id)

/** دادهٔ خراب/قدیمی: دو سند برگشتِ ۲تایی روی همان ردیفِ ۳تایی (جمع برگشت ۴). */
for (const [index, qty] of [2, 2].entries()) {
  const returnId = seed.insert('SaleReturn', {
    invoiceId: Number(sale.id),
    total: qty * 1_000_000,
    refundMethod: 'CASH',
    refundAmount: qty * 1_000_000,
    returnedAtJalali: today,
    returnedAtTime: `13:0${index}:00`,
    userId,
    shiftId,
    kind: 'RETURN',
    restockPending: 0
  })
  seed.insert('SaleReturnItem', {
    returnId,
    saleItemId,
    variantId,
    qty,
    unitPrice: 1_000_000,
    lineTotal: qty * 1_000_000,
    restockedQty: 0
  })
}

const result = await trendService.category({ fromJalali: today, toJalali: today })
const row = result.rows.find((r) => r.name === 'کاپشن')
eq('جمع درآمد دسته از ۳ میلیون پایین‌تر از صفر نمی‌رود', row?.amount, 0)
eq('جمع همین جدول با ردیف دسته هم‌خوان است', result.shownSum, 0)
eq('تعداد خامِ برگشت حفظ می‌شود و ناهنجاری پنهان نمی‌شود', [row?.qty, result.shownQty], [-1, -1])
eq('کنترل پرداخت فاکتور همچنان از برگشت مستقل و قابل تطبیق است', result.reconcilable, true)

eq('ردیف دسته هنوز همان دسته است', row?.categoryId, categoryId)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
