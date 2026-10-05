/**
 * بازبینی هشتم · B5 — «آخرین فاکتور خرید» باید با **تاریخ خودِ فاکتور** سنجیده شود،
 * نه با لحظه‌ای که فاکتور در برنامه تایپ شده. فاکتورِ عقب‌افتاده (هفته پیش، امروز ثبت
 * شده) نباید فیِ امروزِ مغازه را جا بیندازد. ترتیب مصرف FIFO عمداً دست نخورده است.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-replacement-invoice-date.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-repl-invdate-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { profitService } = await import('../../src/main/services/management/ProfitService.ts')
const { costEngine } = await import('../../src/main/services/management/CostEngine.ts')
const { lastPurchaseUnit } = await import('../../src/main/services/management/replacement.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const d = (back) => toJalaliDate(new Date(Date.now() - back * 86400_000))
const NOW = Date.now()
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

const userId = seed.user('فی')
const cat = seed.category('شال')
const p = seed.product('شال نخی')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: NOW - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '_ONE')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 3000000, purchasePrice = 0 WHERE id = ?').run(v)

// فاکتور «به‌روز»: تاریخ ۵ روز پیش — *زمان‌بندی درست* ثبت شده (۵ روز پیش وارد شد)، فی ۲ میلیون
const newInv = seed.insert('PurchaseInvoice', {
  invoiceNo: 601,
  issuedAtJalali: d(5),
  issuedAt: NOW - 5 * DAY,
  goodsTotal: 2_000_000,
  discountTotal: 0,
  grandTotal: 2_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: newInv, variantId: v, qty: 1, unitPrice: 2_000_000, lineTotal: 2_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: newInv,
  state: 'FINAL',
  createdAt: NOW - 5 * DAY
})

// فاکتور عقب‌افتاده: تاریخ ۲۰ روز پیش، ولی **امروز** تایپ شده ⇒ lotDate (زمان ثبت) از همه تازه‌تر است
const lateInv = seed.insert('PurchaseInvoice', {
  invoiceNo: 602,
  issuedAtJalali: d(20),
  issuedAt: NOW - 20 * DAY,
  goodsTotal: 1_000_000,
  discountTotal: 0,
  grandTotal: 1_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: lateInv, variantId: v, qty: 1, unitPrice: 1_000_000, lineTotal: 1_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: lateInv,
  state: 'FINAL',
  createdAt: NOW
})
sql.prepare('UPDATE "ProductVariant" SET stock = 2, purchasePrice = 1000000 WHERE id = ?').run(v)
await costEngine.run()

const unit = await lastPurchaseUnit(v)
eq('فی جایگزینی = فی فاکتورِ تازه‌تر به تاریخ (۲ میلیون)، نه فاکتورِ دیر‌ثبت‌شده', Number(unit.unit), 2_000_000)

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 3_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 3_000_000, destination: 'CASH' }]
})
await costEngine.run()
const pr = await profitService.profit({ fromJalali: today, toJalali: today })
eq('FIFO از قدیمی‌ترین لاتِ *ورودی* خورد (۲ میلیون) — ترتیب مصرف تغییر نکرده', pr.fifoCost, 2_000_000)
eq('سود واقعی ۱ میلیون', pr.realProfit, 1_000_000)
eq('هزینه جایگزینی ۲ میلیون (باگ B5: ۱ میلیون می‌شد)', pr.replacementCost, 2_000_000)
eq('سود جایگزینی ۱ میلیون — نه ۲ میلیونِ خوش‌بینانه', pr.replacementProfit, 1_000_000)
eq('تورمِ ساختگیِ منفی ساخته نشد', pr.inflationOnSold, 0)
eq('ارزش جایگزینی ماندهٔ انبار هم با همان قاعده = ۲ میلیون', pr.stock.replacementValue, 2_000_000)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
