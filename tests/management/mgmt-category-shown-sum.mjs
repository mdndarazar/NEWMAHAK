/**
 * بازبینی نهم · B8 — بالای تب «دسته‌ها» دو عدد باید کنار هم باشند: «جمع ارزش اقلام
 * فاکتورها» (کنترلِ سند، باید با پرداخت فاکتور بخواند) و «جمع همین جدول» (بعد از
 * کم کردن برگشت‌ها و بعد از فیلتر دسته). قبلاً یکی نشان داده می‌شد و با ستون‌ها
 * نمی‌خواند. این تست ثابت می‌کند `lineSum` برای کنترلِ سند از فیلترِ دسته هم مستقل
 * می‌ماند و `shownSum` همان جمعِ ستون‌هاست.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-category-shown-sum.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-cat-shown-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { trendService } = await import('../../src/main/services/management/TrendService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
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
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`.slice(0, 320))
  }
}

const userId = seed.user('فی')
const catA = seed.category('کتانی')
const catB = seed.category('صندل')
const pA = seed.product('کتانی', catA)
const pB = seed.product('صندل تابستانه', catB)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const vA = seed.variant(pA, '41')
const vB = seed.variant(pB, '40')
for (const [id, price] of [
  [vA, 1_000_000],
  [vB, 1_500_000]
]) {
  sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = ?, purchasePrice = 400000 WHERE id = ?').run(price, id)
  const buy = seed.insert('PurchaseInvoice', {
    invoiceNo: 1000 + id,
    issuedAtJalali: today,
    issuedAt: Date.now(),
    goodsTotal: 4_000_000,
    discountTotal: 0,
    grandTotal: 4_000_000,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: id, qty: 10, unitPrice: 400_000, lineTotal: 4_000_000 })
  seed.insert('StockMovement', {
    variantId: id,
    delta: 10,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: buy,
    state: 'FINAL',
    createdAt: Date.now()
  })
}
await costEngine.run()

await salesService.create({
  userId,
  shiftId,
  lines: [
    { variantId: vA, qty: 2, unitPrice: 1_000_000, discount: 0, tax: 0 },
    { variantId: vB, qty: 2, unitPrice: 1_500_000, discount: 0, tax: 0 }
  ],
  payments: [{ methodId: cash, amount: 5_000_000, destination: 'CASH' }]
})
await costEngine.run()
const saleInv = Number(sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get().id)
const [lineA, lineB] = sql
  .prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id ASC')
  .all(saleInv)
  .map((r) => Number(r.id))

const all = await trendService.category({ fromJalali: today, toJalali: today })
eq('بدون برگشت: جمعِ جدول همان جمعِ اقلام است', [all.shownSum, all.lineSum, all.shownQty], [5_000_000, 5_000_000, 4])
eq('دو ردیف دسته (به نامِ دسته، نه کالا)', all.rows.map((r) => [r.name, r.amount, r.qty]), [['صندل', 3_000_000, 2], ['کتانی', 2_000_000, 2]])
eq('خواندن با پرداخت فاکتور', [all.reconcilable, all.payable, all.invoiceCount], [true, 5_000_000, 1])
eq('فیلتر دسته‌ای اعمال نشده', all.categoryFiltered, false)

/** برگشتِ یک عدد از کتانی ⇒ جدول کم می‌شود، کنترلِ سند نه. */
const ret = seed.insert('SaleReturn', {
  invoiceId: saleInv,
  total: 1_000_000,
  refundMethod: 'CASH',
  refundAmount: 1_000_000,
  returnedAtJalali: today,
  returnedAtTime: '13:00:00',
  userId,
  shiftId,
  kind: 'RETURN',
  restockPending: 0
})
seed.insert('SaleReturnItem', {
  returnId: ret,
  saleItemId: lineA,
  variantId: vA,
  qty: 1,
  unitPrice: 1_000_000,
  lineTotal: 1_000_000,
  restockedQty: 1
})
await costEngine.run()

const after = await trendService.category({ fromJalali: today, toJalali: today })
eq('جمعِ همین جدول ۴ میلیون شد (برگشت کم شد)', after.shownSum, 4_000_000)
eq('«جمع ارزش اقلام فاکتورها» دست‌نخورده ماند — همان کنترلِ سند', after.lineSum, 5_000_000)
eq('و همان کنترل هنوز با پرداخت فاکتور می‌خواند', [after.reconcilable, after.payable], [true, 5_000_000])
eq('تعداد هم در جدول کم شد', after.shownQty, 3)
eq('ردیفِ کتانی به ۱ میلیون رسید', after.rows.find((r) => r.name === 'کتانی')?.amount, 1_000_000)
eq('جمعِ ردیف‌ها با همان عدد می‌خواند', after.rows.reduce((s, r) => s + r.amount, 0), after.shownSum)

/** فیلتر دسته: ستون‌ها عوض می‌شوند، کنترلِ سند نه. */
const only = await trendService.category({ fromJalali: today, toJalali: today, categoryId: catA })
eq('با فیلتر دسته فقط همان دسته دیده می‌شود', only.rows.map((r) => [r.name, r.amount]), [['کتانی', 1_000_000]])
eq('و «جمع همین جدول» هم فیلتر می‌شود', only.shownSum, 1_000_000)
eq('«جمع ارزش اقلام» برای کنترلِ سند از فیلترِ دسته مستقل است', only.lineSum, 5_000_000)
eq('صفحه می‌فهمد فیلتر روی ستون اعمال شده', only.categoryFiltered, true)
eq('یادداشت هم همان را می‌گوید', String(only.note || '').includes('فیلتر دسته روی همین ستون‌ها اعمال شده'), true)
eq(
  'فروش خالص تعهدی از همان موتورِ گزارش فروش می‌آید و تغییر نکرده',
  [only.netAccrualSales, after.netAccrualSales],
  [5_000_000, 5_000_000]
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
