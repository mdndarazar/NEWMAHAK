/**
 * بازبینی نهم · B4 — «بازسازی دفتر» اول همه‌چیز را پاک می‌کند و بعد از صفر می‌سازد؛
 * اگر حرکتِ خرابی وسط راه باشد، اجرا روی همان می‌ایستد و نتیجه «دفترِ خالی + همهٔ
 * فروش‌های بعد از آن بی‌فی» است. پس تا خطایِ زنده‌ای هست، پاک کردن انجام نمی‌شود.
 * خطاهای یتیم (حرکتی که دیگر نیست) قبل از شمارش پاک می‌شوند تا قفل برای همیشه نماند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-rebuild-guard.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-rebuild-guard-'))
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
seed.category('کیف')
const p = seed.product('کیف دوشی')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'عصر',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId,
  staffConfirmed: 1
})
const v = seed.variant(p, 'مگس‌پرخور')
sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 900000, purchasePrice = 400000 WHERE id = ?').run(v)

const buy = seed.insert('PurchaseInvoice', {
  invoiceNo: 900,
  issuedAtJalali: today,
  issuedAt: Date.now(),
  goodsTotal: 4_000_000,
  discountTotal: 0,
  grandTotal: 4_000_000,
  status: 'CONFIRMED'
})
seed.insert('PurchaseInvoiceItem', { invoiceId: buy, variantId: v, qty: 10, unitPrice: 400_000, lineTotal: 4_000_000 })
seed.insert('StockMovement', {
  variantId: v,
  delta: 10,
  reason: 'PURCHASE',
  refType: 'PurchaseInvoice',
  refId: buy,
  state: 'FINAL',
  createdAt: Date.now()
})
sql.prepare('UPDATE "ProductVariant" SET stock = 10 WHERE id = ?').run(v)
await costEngine.run()

await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 2, unitPrice: 900_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1_800_000, destination: 'CASH' }]
})
await costEngine.run()

const costRows = () => Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c)
const lotLeft = () => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) s FROM "PurchaseLot"').get().s)
const fifoSum = () => Number(sql.prepare('SELECT COALESCE(SUM(fifoCost),0) s FROM "SaleItemCost"').get().s)
eq('دفتر یک ردیف هزینه دارد و هشت عدد از لات مانده', [costRows(), lotLeft()], [1, 8])
const saleMoveId = Number(
  sql.prepare(`SELECT id FROM "StockMovement" WHERE reason = 'SALE' ORDER BY id DESC LIMIT 1`).get().id
)

// ————— حرکتِ خراب: خطایِ زنده روی یک حرکتِ موجود —————
seed.insert('CostEngineFailure', { movementId: saleMoveId, message: 'خطای آزمایشی (حرکت خراب)' })
const beforeCounts = [costRows(), lotLeft(), fifoSum()]
const r = await costEngine.rebuild()
eq('بازسازی رد شد', r.rebuilt, false)
eq('صفحه می‌فهمد چرا (پرچمِ رد + متنِ راه‌حل)', [r.refused, typeof r.refuseReason === 'string' && r.refuseReason.length > 20], [true, true])
eq('متن، تعداد حرکت‌های خراب را می‌گوید', r.refuseReason.includes('۱ حرکت'), true)
eq('و می‌گوید پاک کردن انجام **نمی‌شود**', r.refuseReason.includes('تا این‌ها درست نشوند بازسازی نمی‌کنیم'), true)
eq('هیچ‌چیز از دفتر پاک نشد — باگ B4: همه‌چیز صفر می‌شد', [costRows(), lotLeft(), fifoSum()], beforeCounts)
const st = await costEngine.status()
eq('بنر همان‌جا لیستِ حرکت‌ها را دارد تا مالک بداند کدام را درست کند', st.failures?.[0]?.movementId, saleMoveId)
eq('شمارش خطا در وضعیت دیده می‌شود', st.failCount, 1)

// ————— راه‌حل: خطا درست شد ⇒ بازسازی اجرا می‌شود —————
sql.prepare('DELETE FROM "CostEngineFailure" WHERE movementId = ?').run(saleMoveId)
const r2 = await costEngine.rebuild()
eq('بعد از درست‌شدن، بازسازی اجرا شد', [r2.rebuilt, r2.refused], [true, undefined])
eq('دفتر از صفر ساخته شد و همان عدد برگشت', [costRows(), lotLeft(), fifoSum()], beforeCounts)
eq('خطا هم پاک شد', (await costEngine.status()).failCount, 0)

// ————— خطای یتیم نباید قفلِ ابدی بسازد —————
seed.insert('CostEngineFailure', { movementId: 424242, message: 'حرکتی که دیگر وجود ندارد' })
const r3 = await costEngine.rebuild()
eq('خطای یتیم پاک می‌شود و بازسازی انجام می‌شود (قفلِ ابدی نه)', [r3.rebuilt, r3.refused], [true, undefined])
eq('و دیگر در وضعیت نیست', (await costEngine.status()).failCount, 0)
eq('دفتر هم همان‌طور مانده', costRows(), 1)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
