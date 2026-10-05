/**
 * بازبینی نهم · B6 + B11 — کارت «کسری/ضایعات» ناخالص بود: اگر کسی ۱۰ عدد اشتباهی
 * مثبت می‌زد و بعد ۱۰− می‌کرد تا درست شود، کارت ۱۰ عدد ضرر با بهای کامل نشان می‌داد.
 * حالا اصلاح‌های مثبتِ همان بازه کنارش می‌نشیند و «خالص» اعلام می‌شود. B11 هم همین‌جاست:
 * «انتقال از انبار مرکزی» جهتِ ورود است و شاخهٔ مرده‌اش باید حذف شده باشد (در نشست ۲۱۷
 * من برای CENTRAL_WITHDRAW شرط ساخته بودم در حالی که آنجا هیچ حرکتی نوشته نمی‌شود).
 *   node --import ./test/harness/register.mjs tests/management/mgmt-losses-net-adjust.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-losses-net-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
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
seed.category('پیچ و مهره')
const p = seed.product('پیچ ۸ سانتی')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '8cm')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 90000, purchasePrice = 500000 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 950,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 10_000_000,
  discountTotal: 0,
  grandTotal: 10_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 20, unitPrice: 500_000, lineTotal: 10_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 20,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 20 WHERE id = ?').run(v)
await costEngine.run()

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 5, unitPrice: 900_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 4_500_000, destination: 'CASH' }]
})
await costEngine.run()
const base = await profitService.profit({ fromJalali: today, toJalali: today })
eq('سود قبل از اصلاح‌ها', base.realProfit, 2_000_000)
eq('کارت ضرر فعلاً خالی است', base.losses?.moves, 0)

const mv = (delta, reason, extra = {}) =>
  seed.insert('StockMovement', {
    variantId: v,
    delta,
    reason,
    refType: 'Manual',
    refId: null,
    state: 'FINAL',
    createdAt: Date.now(),
    ...extra
  })

/** ۱۰ عدد کسری + ۲ عدد ضایعات، و ۱۰ عدد اصلاحِ مثبتِ همان تایپِ اشتباهی. */
mv(-10, 'ADJUSTMENT')
mv(-2, 'SHRINK')
mv(10, 'ADJUSTMENT')
/** ورود از انبار مرکزی: جهتِ ورود است و نباید در کارت ضرر جایی داشته باشد (B11). */
mv(3, 'CENTRAL_WITHDRAW')
sql.prepare('UPDATE "ProductVariant" SET stock = stock - 2 WHERE id = ?').run(v)
await costEngine.run()

const out = await profitService.profit({ fromJalali: today, toJalali: today })
const L = out.losses
eq('دو حرکت کسری شمرده شد (حرکتِ مثبت شمرده نشده)', L.moves, 2)
eq('تعداد کسری ناخالص ۱۲ عدد', L.qty, 12)
eq('بهای آن از لات FIFO همان حرکت‌ها (۱۲ × ۵۰۰ هزار)', L.cost, 6_000_000)
eq('اصلاحِ مثبت همان بازه خوانده شد', [L.gainMoves, L.gainQty], [1, 10])
eq('خالص = ۱۲ − ۱۰ (باگ B6: ۱۲ عدد ضرر اعلام می‌شد)', L.netQty, 2)
eq('بهای کسری دست‌نخورده ماند (برای سمتِ مثبت بها ساخته نمی‌شود)', L.cost, 6_000_000)
eq(
  'ردیفِ اصلاح دستی: کسری ۱۰، اصلاح ۱۰، خالص ۰',
  L.rows.find((r) => r.reason === 'ADJUSTMENT'),
  { reason: 'ADJUSTMENT', label: 'اصلاح دستی موجودی', moves: 1, qty: 10, cost: 5_000_000, gain: 10, net: 0 }
)
eq('ردیف ضایعات اصلاحی ندارد', L.rows.find((r) => r.reason === 'SHRINK')?.net, 2)
eq('«انتقال از انبار مرکزی» به‌عنوان عددِ جدا در نتیجه نیست (شاخهٔ مرده حذف شد)', ['centralMoves' in L, 'centralCost' in L], [false, false])
eq('عدد ۳ِ ورود مرکزی نه در کسری و نه در اصلاح شمرده شد', [L.qty, L.gainQty], [12, 10])
eq(
  'یادداشت کارت راه‌خواندن را توضیح می‌دهد',
  String(L.note || '').includes('انتقال از انبار مرکزی') && String(L.note || '').includes('اصلاح مثبت'),
  true
)
eq('سود واقعی به‌خاطر این کارت دست‌نخورده ماند (ضرر داخل سود نیست)', out.realProfit, base.realProfit)
eq('و درآمد هم همان ۴٫۵ میلیون است', out.revenue, 4_500_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
