/**
 * بازبینی هشتم · B1 — اصلاح فی فاکتور خرید باید «فی جایگزینی» فروش‌هایی را هم درست کند
 * که از لاتِ *همان فاکتور* مصرف نشده‌اند ولی فی جایگزینی‌شان از همان فاکتور آمده بود.
 * (ادعای گزارش با سناریوی زیر تأیید شد: ردیف‌ها نه درست می‌شدند و نه در «stale» شمرده.)
 *     node --import ./test/harness/register.mjs tests/management/mgmt-reprice-cross-lot.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reprice-crosslot-'))
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
const dayAgo = toJalaliDate(new Date(Date.now() - 30 * 86400_000))

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
const cat = seed.category('کاپشن')
const p = seed.product('کاپشن چرم')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, '50')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)

// ————— خرید اول: ۱۰ عدد به ۱ میلیون (قدیمی‌ترین لات ⇒ FIFO از همین می‌خورد) —————
const p1 = seed.insert('PurchaseInvoice', {
  invoiceNo: 201,
  issuedAtJalali: dayAgo,
  issuedAt: Date.now() - 30 * 86400_000,
  goodsTotal: 10_000_000,
  discountTotal: 0,
  grandTotal: 10_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: p1, variantId: v, qty: 10, unitPrice: 1_000_000, lineTotal: 10_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 10,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: p1,
  state: 'FINAL',
  createdAt: Date.now() - 30 * 86400_000
})

// ————— خرید دوم: ۱۰ عدد با فیِ *اشتباه* ۲۰ میلیون — «آخرین فاکتور خرید» همین است —————
const p2 = seed.insert('PurchaseInvoice', {
  invoiceNo: 202,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 200_000_000,
  discountTotal: 0,
  grandTotal: 200_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: p2, variantId: v, qty: 10, unitPrice: 20_000_000, lineTotal: 200_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 10,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: p2,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 20, purchasePrice = 20000000 WHERE id = ?').run(v)
await costEngine.run()

// ————— فروش ۱ عدد به ۲ میلیون: FIFO از P1، ولی فی جایگزینی از P2 قفل می‌شود —————
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 2_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 2_000_000, destination: 'CASH' }]
})
await costEngine.run()

const before = await profitService.profit({ fromJalali: today, toJalali: today })
eq('قبل از اصلاح: سود واقعی از لات P1 (درآمد ۲م − فی ۱م)', before.realProfit, 1_000_000)
eq('قبل از اصلاح: فی جایگزینی از P2 نشسته (۲۰م) ⇒ سود جایگزینی ۱۸م−', before.replacementProfit, -18_000_000)
eq('قبل از اصلاح: تورمِ فروش رفته ۱۹ میلیون نشان داده می‌شود', before.inflationOnSold, 19_000_000)

// ————— اصلاح فی فاکتور P2 به ۲ میلیون — جایی که باگ B1 دیده می‌شد —————
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = 20000000, grandTotal = 20000000 WHERE id = ?').run(p2)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = 2000000, lineTotal = 20000000 WHERE invoiceId = ?').run(p2)
const r = await costEngine.repricePurchase(p2)
eq('لات‌های P2 بازنویسی شد', r.updated, 1)
eq('هیچ فروشی از لات P2 مصرف نکرده بود، ولی قلم لمس شد (دامنه بازتر از لات‌ها)', r.saleItems, 1)
eq('سود جایگزینی همان قلم هم‌راستا شد — نه اینکه ول شود', r.replacementFixed, 1)
eq('بی‌هم‌راستایی باقی نمانده', r.replacementStale, 0)

const after = await profitService.profit({ fromJalali: today, toJalali: today })
eq('بعد از اصلاح: سود جایگزینی صفر شد — فی جایگزینی = فی فروش (باگ B1: ۱۸م− می‌ماند)', after.replacementProfit, 0)
eq('بعد از اصلاح: سود واقعی دست‌نخورده (فقط جایگزینی)', after.realProfit, 1_000_000)
eq('بعد از اصلاح: تورم همان ۱ میلیونِ واقعی است، نه ۱۹ میلیون', after.inflationOnSold, 1_000_000)
eq('بعد از اصلاح: هزینه جایگزینی ۲ میلیون', after.replacementCost, 2_000_000)
const notes = (after.notes ?? []).join(' | ')
eq('هیچ یادآوری «بازسازی» روی این داده لازم نیست', notes.includes('یکدستش می‌کند'), false)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
