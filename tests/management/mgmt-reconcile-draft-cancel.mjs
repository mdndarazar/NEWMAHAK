/**
 * بازبینی هشتم · B4 — «تازه‌متولد» باید قلمی باشد که واقعاً انبار را کم کرده.
 * فاکتور پیش‌نویس/معلقِ بی‌حرکت (DRAFT) و فاکتور لغو‌شده (CANCELED) نباید لات مصرف
 * کنند؛ ردیف هزینهٔ اشتباهِ ساخته‌شده هم باید در اجرای بعدی جمع بخورد.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-reconcile-draft-cancel.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-reconcile-draft-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
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
const cat = seed.category('پلیور')
const p = seed.product('پلیور یقه‌اسکی')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 5, salePrice = 900000, purchasePrice = 100000 WHERE id = ?').run(v)

// خرید ۵ عدد به ۱۰۰ هزار ⇒ یک لات با ۵ عدد
const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 301,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 500_000,
  discountTotal: 0,
  grandTotal: 500_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 5, unitPrice: 100_000, lineTotal: 500_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 5,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
await costEngine.run()
const lotSum = () => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) s FROM "PurchaseLot"').get().s)
eq('مجموع لات با موجودی می‌خواند (۵ عدد)', lotSum(), 5)

// ————— ۱) فاکتور پیش‌نویس (معلق) بدون هیچ حرکت انبار —————
const draft = seed.insert('SaleInvoice', {
  receiptNo: 4001,
  userId,
  shiftId,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  status: 'DRAFT',
  orderType: 'RETAIL',
  deductInventory: 1,
  goodsTotal: 1_800_000,
  taxTotal: 0,
  serviceCharge: 0,
  discountTotal: 0,
  deliveryFee: 0,
  grandTotal: 1_800_000,
  paidTotal: 0
})
const draftLine = seed.insert('SaleInvoiceItem', {
  invoiceId: draft,
  variantId: v,
  qty: 2,
  unitPrice: 900_000,
  lineTotal: 1_800_000
})
await costEngine.run()
eq(
  'پیش‌نویسِ بی‌حرکت هیچ ردیف هزینه‌ای نگرفت (باگ B4: ۲ عدد لات می‌خورد)',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = ?').get(draftLine).c),
  0
)
eq('هیچ لاتی بابت پیش‌نویس مصرف نشد', lotSum(), 5)

// ————— ۲) خوددرمانی: ردیف هزینه‌ای که نسخهٔ قبل اشتباه ساخته —————
const lotId = Number(sql.prepare('SELECT id FROM "PurchaseLot" ORDER BY id ASC LIMIT 1').get().id)
seed.insert('SaleItemCost', {
  saleItemId: draftLine,
  invoiceId: draft,
  variantId: v,
  qty: 2,
  fifoCost: 200_000,
  replacementCost: 200_000,
  revenue: 1_800_000,
  costStatus: 'EXACT'
})
seed.insert('CostConsumption', {
  movementId: 0,
  lotId,
  saleItemId: draftLine,
  qty: 2,
  unitCost: 100_000,
  kind: 'SALE'
})
sql.prepare('UPDATE "PurchaseLot" SET qtyLeft = qtyLeft - 2 WHERE id = ?').run(lotId)
eq('دادهٔ خرابِ ساخته‌شده: لات ۳ عدد مانده', lotSum(), 3)
await costEngine.run()
eq(
  'ردیف اشتباه حذف شد (بدون نشانگر OUTSIDE که بعداً جلوی قفل واقعی را بگیرد)',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = ?').get(draftLine).c),
  0
)
eq('مصرف اشتباه به لات برگشت', lotSum(), 5)

// ————— ۳) فاکتور قطعی که ابطال می‌شود: مصرف باید یک‌بار برگردد و دوباره قفل نشود —————
await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 900_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 900_000, destination: 'CASH' }]
})
await costEngine.run()
const invId = Number(sql.prepare('SELECT id FROM "SaleInvoice" WHERE status = ? ORDER BY id DESC LIMIT 1').get('SETTLED').id)
const soldLine = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id ASC LIMIT 1').get(invId).id)
eq('فروش قطعی یک عدد از لات خورد', lotSum(), 4)
eq('ردیف هزینهٔ فروش قطعی ساخته شد', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = ?').get(soldLine).c), 1)

// ابطال: حرکت جبرانی مثبت + موجودی کالا + تغییر وضعیت — همان سه کاری که مسیر ابطال
// در `InventoryService.increase` می‌کند (تا تست، دیتابیسِ نصفه‌نیمه نسازد).
sql.prepare('UPDATE "ProductVariant" SET stock = stock + 1 WHERE id = ?').run(v)
seed.insert('StockMovement', {
  variantId: v,
  delta: 1,
  reason: 'SALE',
  refType: 'SaleInvoice',
  refId: invId,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "SaleInvoice" SET status = ? WHERE id = ?').run('CANCELED', invId)
await costEngine.run()
eq('جنس ابطال‌شده به لات برگشت', lotSum(), 5)
eq(
  'و دوباره قفل نشد (باگ B4: قلمِ بی‌ردیفِ هزینه دوباره لات می‌خورد)',
  Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost" WHERE saleItemId = ? AND qty > 0').get(soldLine).c),
  0
)
eq('موجودی کالا هم با لات می‌خواند', Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(v).stock), 5)

const health = await costEngine.health()
eq('چراغ سلامت بعد از همه‌ی این مسیرها سبز است', health.ok, true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
