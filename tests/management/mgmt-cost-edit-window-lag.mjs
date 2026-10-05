/**
 * گزارش مدیریت · B2 — فاکتور ویرایش‌شده پیش از پنجرهٔ چرخشیِ reconcile.
 * با پنجرهٔ ۴تایی، ویرایش تخفیفِ فاکتور قدیمی باید در همان اجرای بعدی اعمال شود.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-cost-edit-window-lag.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-edit-window-lag-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const now = Date.now()

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

const userId = seed.user('پنجرهٔ ویرایش')
seed.category('پوشاک')
const p = seed.product('شلوار')
const v = seed.variant(p, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: now - 3600_000,
  userId,
  staffConfirmed: 1
})
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 990,
  issuedAtJalali: today,
  issuedAt: now - 86400_000,
  goodsTotal: 100_000_000,
  discountTotal: 0,
  grandTotal: 100_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 100, unitPrice: 1_000_000, lineTotal: 100_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 100,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: now - 86400_000
})
sql.prepare('UPDATE "ProductVariant" SET stock = 100 WHERE id = ?').run(v)

const sales = []
for (let i = 0; i < 30; i++) {
  sales.push(
    await salesService.create({
      userId,
      shiftId,
      lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
      payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
    })
  )
}

// دفتر را تا انتهای حرکت‌ها می‌آوریم اما reconcile را عمداً روی پنجرهٔ چهار قلمی می‌گذاریم.
sql.prepare('INSERT OR REPLACE INTO "Setting" (key, value) VALUES (?, ?)').run('mgmt.reconcilePage', '4')
const initialRun = await costEngine.run()
const before = await profitService.profit({ fromJalali: today, toJalali: today })
const oldCursor = await costEngine.status()
eq('سی فاکتور اولیه هزینه‌گذاری شدند', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 30)
eq('پنجرهٔ چرخشی کوچک است و پیش از ویرایش دو قطعه جلو رفته', [initialRun.reconcile?.cur, oldCursor.reconcile?.cur, oldCursor.reconcile?.span], [4, 8, 4])
eq('درآمد پیش از ویرایش ۶۰ میلیون است', before.revenue, 60_000_000)

// فاکتور اول بیرون از پنجرهٔ فعلی است؛ ویرایش تخفیف آیتم را بازسازی و شناسهٔ تازه می‌دهد.
const target = sales[0]
const oldItem = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(target.id).id)
await salesService.update({
  id: target.id,
  userId,
  shiftId,
  keepPayments: true,
  confirmOverpay: true,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 200_000, tax: 0 }]
})
const currentItem = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(target.id).id)
eq('ویرایش شناسهٔ تازه‌ای بیرون از پنجرهٔ جاری ساخته', currentItem > oldItem, true)
const postEditRun = await costEngine.run()
const row = sql.prepare('SELECT saleItemId, qty, revenue, fifoCost FROM "SaleItemCost" WHERE saleItemId = ?').get(currentItem)
const revenueAfterOneRun = Number(sql.prepare('SELECT COALESCE(SUM(revenue),0) n FROM "SaleItemCost"').get().n)
const status = postEditRun
eq('ویرایشِ خارج از پنجره در همان اجرا به قلم تازه وصل شد', row ? Number(row.saleItemId) : null, currentItem)
eq('همان اجرای دفتر درآمد را دقیقاً ۲۰۰هزار کم کرد', before.revenue - revenueAfterOneRun, 200_000)
eq('ردیف هزینه و FIFO تغییر نکردند', [Number(row?.qty), Number(row?.fifoCost)], [1, 1_000_000])
eq('ویرایشِ تخفیف لات را دوباره مصرف نکرد', Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(v).n), 70)
eq('دفتر حرکت‌ها عقب نیست و reconcile خطا/بودجه ندارد', [status.behind, status.reconcileError || '', status.reconcile?.budget], [0, '', false])
eq('مکان‌نمای پنجره حقیقتاً جلو رفته و هنوز دورِ کامل تمام نشده', [status.reconcile?.cur, status.reconcile?.maxId], [12, 31])

eq('تعداد ردیف‌های هزینه با سی فاکتور جاری برابر است', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 30)
const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('گزارش سود همان درآمدِ اصلاح‌شده را می‌خواند', after.revenue, revenueAfterOneRun)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
