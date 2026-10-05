/**
 * گزارش مدیریت · B1 — ویرایشِ تعداد/حذفِ قلم پیش از نخستین اجرای دفتر هزینه.
 * بازتولید با سرویس واقعی فروش: SALE_EDITها پیش از اولین CostEngine.run ساخته می‌شوند.
 *   node --import ./test/harness/register.mjs tests/management/mgmt-cost-edit-before-run.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-edit-before-run-'))
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

const userId = seed.user('ویرایش پیش از دفتر')
seed.category('پوشاک')
const product = (name, size) => {
  const p = seed.product(name)
  const v = seed.variant(p, size)
  sql.prepare('UPDATE "ProductVariant" SET stock = 0, salePrice = 2000000, purchasePrice = 0 WHERE id = ?').run(v)
  return v
}
const vIncrease = product('افزایش', 'A')
const vDecrease = product('کاهش', 'B')
const vDelete = product('حذف', 'C')
const vKeep = product('باقی‌مانده', 'D')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: now - 3600_000,
  userId,
  staffConfirmed: 1
})

let purchaseNo = 900
const buy = (variantId, qty, unit, at = now) => {
  const id = seed.insert('PurchaseInvoice', {
    invoiceNo: ++purchaseNo,
    issuedAtJalali: toJalaliDate(new Date(at)),
    issuedAt: at,
    goodsTotal: qty * unit,
    discountTotal: 0,
    grandTotal: qty * unit,
    status: 'CONFIRMED'
  })
  seed.insert('PurchaseInvoiceItem', { invoiceId: id, variantId, qty, unitPrice: unit, lineTotal: qty * unit })
  seed.insert('StockMovement', {
    variantId,
    delta: qty,
    reason: 'PURCHASE',
    refType: 'PurchaseInvoice',
    refId: id,
    state: 'FINAL',
    createdAt: at
  })
  sql.prepare('UPDATE "ProductVariant" SET stock = stock + ?, purchasePrice = ? WHERE id = ?').run(qty, unit, variantId)
  return id
}

const line = (variantId, qty) => ({ variantId, qty, unitPrice: 2_000_000, discount: 0, tax: 0 })
const makeSale = async (lines, issuedAtJalali) => {
  const total = lines.reduce((sum, x) => sum + x.qty * x.unitPrice, 0)
  return salesService.create({
    userId,
    shiftId,
    lines,
    ...(issuedAtJalali ? { issuedAtJalali } : {}),
    payments: [{ methodId: cash, amount: total, destination: 'CASH' }]
  })
}
const editSale = async (sale, lines) =>
  salesService.update({
    id: sale.id,
    userId,
    shiftId,
    keepPayments: true,
    confirmOverpay: true,
    lines
  })

// افزایش: فروش پایه پیش از خرید بعدی است؛ واحدهای اضافه روز ویرایش از لات/خرید تازه‌اند.
buy(vIncrease, 1, 1_000_000, now - 3 * 86400_000)
const increased = await makeSale([line(vIncrease, 1)], toJalaliDate(new Date(now - 2 * 86400_000)))
const increaseLaterPurchase = buy(vIncrease, 2, 2_000_000, now - 86400_000)
await editSale(increased, [line(vIncrease, 3)])

// کاهش: از سه واحد فروخته‌شده، دو واحد پیش از اولین اجرای دفتر به قفسه برمی‌گردند.
buy(vDecrease, 3, 1_000_000, now - 3 * 86400_000)
const decreased = await makeSale([line(vDecrease, 3)])
buy(vDecrease, 2, 2_000_000, now - 86400_000)
await editSale(decreased, [line(vDecrease, 1)])

// حذف قلم: فاکتور هنوز یک قلم دیگر دارد تا سناریوی حذفِ کامل فاکتور را وارد نکنیم.
buy(vDelete, 1, 1_000_000, now - 3 * 86400_000)
buy(vKeep, 1, 1_000_000, now - 3 * 86400_000)
const deleted = await makeSale([line(vDelete, 1), line(vKeep, 1)])
await editSale(deleted, [line(vKeep, 1)])

eq('پیش از اجرای دفتر هنوز هیچ ردیف هزینه‌ای ساخته نشده', Number(sql.prepare('SELECT COUNT(*) c FROM "SaleItemCost"').get().c), 0)
await costEngine.run()

const costRows = sql.prepare('SELECT variantId, qty, fifoCost, replacementCost, replacementSource, revenue FROM "SaleItemCost" ORDER BY variantId').all()
const byVariant = new Map(costRows.map((r) => [Number(r.variantId), r]))
eq('افزایش: سه واحد و درآمد کامل فاکتور ثبت شد', [Number(byVariant.get(vIncrease)?.qty), Number(byVariant.get(vIncrease)?.revenue)], [3, 6_000_000])
eq('افزایش: FIFO از فی روز ویرایش برای دو واحد اضافه استفاده کرد', Number(byVariant.get(vIncrease)?.fifoCost), 5_000_000)
eq('افزایش: فی جایگزینی از خریدهای دو مقطع ساخته و به‌عنوان MIXED نگه داشته شد', [Number(byVariant.get(vIncrease)?.replacementCost), byVariant.get(vIncrease)?.replacementSource], [5_000_000, 'MIXED'])
eq('کاهش: فقط یک واحدِ باقی‌مانده هزینه دارد', [Number(byVariant.get(vDecrease)?.qty), Number(byVariant.get(vDecrease)?.fifoCost)], [1, 1_000_000])
eq('حذف: قلم حذف‌شده ردیف هزینه ندارد', byVariant.has(vDelete), false)
eq('قلمِ نگه‌داشته‌شده در همان فاکتور هزینه دارد', [Number(byVariant.get(vKeep)?.qty), Number(byVariant.get(vKeep)?.fifoCost)], [1, 1_000_000])
eq('لات افزایش: واحدهای فروخته‌شده دقیقاً از لات کم شده‌اند', Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vIncrease).n), 0)
eq('لات کاهش: دو واحد آزادشده در قفسه مانده‌اند', Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vDecrease).n), 4)
eq('لات قلم حذف‌شده کامل به قفسه برگشته', Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vDelete).n), 1)
eq('ماندهٔ قلمِ حذف‌نشده مصرف شده', Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vKeep).n), 0)
eq('تعدادِ موجودی فیزیکی با ماندهٔ لات‌ها یکی است', Number((await costEngine.health()).mismatchCount), 0)

const profitFrom = toJalaliDate(new Date(now - 3 * 86400_000))
const profit = await profitService.profit({ fromJalali: profitFrom, toJalali: today })
eq('درآمد خالص سه فاکتور بعد از حذف/تغییر تعداد درست است', profit.revenue, 10_000_000)
eq('FIFO و سود واقعی بر پایهٔ واحدهای واقعاً فروخته‌شده‌اند', [profit.fifoCost, profit.realProfit], [7_000_000, 3_000_000])
const editConsumption = Number(
  sql.prepare(`SELECT COALESCE(SUM(c.qty),0) n FROM "CostConsumption" c JOIN "StockMovement" m ON m.id = c.movementId WHERE c.kind = 'SALE' AND c.saleItemId IN (SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?) AND m.reason = 'SALE_EDIT'`).get(increased.id).n
)
eq('دو واحد افزایشی در مصرفِ همان SALE_EDIT ثبت شدند', editConsumption, 2)

const rebuilt = await costEngine.rebuild()
eq('بازسازی روی دیتابیس آزمایشگاهی کامل شد', rebuilt.rebuilt, true)
const rebuiltProfit = await profitService.profit({ fromJalali: profitFrom, toJalali: today })
eq('بازسازی همان درآمد و FIFO را ساخت', [rebuiltProfit.revenue, rebuiltProfit.fifoCost, rebuiltProfit.realProfit], [10_000_000, 7_000_000, 3_000_000])
eq('بازسازی همان ماندهٔ لات را ساخت', [vIncrease, vDecrease, vDelete, vKeep].map((v) => Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(v).n)), [0, 4, 1, 0])
eq('بازسازی هم مغایرتِ موجودی ندارد', Number((await costEngine.health()).mismatchCount), 0)

// اصلاح قیمت خریدِ سهم دوم باید ردیف MIXED را از تاریخ خودِ هر SALE/SALE_EDIT بازقیمت‌گذاری کند.
const increaseSaleItemId = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(increased.id).id)
sql.prepare('UPDATE "PurchaseInvoiceItem" SET unitPrice = ?, lineTotal = ? WHERE invoiceId = ? AND variantId = ?').run(
  3_000_000,
  6_000_000,
  increaseLaterPurchase,
  vIncrease
)
sql.prepare('UPDATE "PurchaseInvoice" SET goodsTotal = ?, grandTotal = ? WHERE id = ?').run(6_000_000, 6_000_000, increaseLaterPurchase)
const mixedReprice = await costEngine.repricePurchase(increaseLaterPurchase)
const mixedAfterReprice = sql.prepare('SELECT qty, fifoCost, replacementCost, replacementSource FROM "SaleItemCost" WHERE saleItemId = ?').get(increaseSaleItemId)
eq('اصلاح خرید سهم افزایشی، فی جایگزینی MIXED را خودکار به‌روز کرد', [
  Number(mixedAfterReprice?.replacementCost),
  mixedAfterReprice?.replacementSource,
  Number(mixedReprice.replacementFixed)
], [7_000_000, 'MIXED', 1])
eq('همان اصلاح، FIFO دو واحدِ لات دوم را هم بازقیمت‌گذاری کرد', Number(mixedAfterReprice?.fifoCost), 7_000_000)
const rebuiltAfterReprice = await costEngine.rebuild()
const mixedAfterRebuild = sql.prepare('SELECT qty, fifoCost, replacementCost, replacementSource FROM "SaleItemCost" WHERE saleItemId = ?').get(increaseSaleItemId)
eq('بازسازی پس از اصلاح خرید، نتیجهٔ ردیف MIXED را بازتولید کرد', [
  rebuiltAfterReprice.rebuilt,
  Number(mixedAfterRebuild?.fifoCost),
  Number(mixedAfterRebuild?.replacementCost),
  mixedAfterRebuild?.replacementSource
], [true, 7_000_000, 7_000_000, 'MIXED'])

// کنترلِ مکمل: اگر دفتر پیش از ویرایش اجرا شده باشد، کاهش تعداد هم باید فقط delta را برگرداند.
const vAfterRun = product('ویرایش پس از اجرا', 'E')
buy(vAfterRun, 3, 1_000_000, now - 2 * 86400_000)
const alreadyCosted = await makeSale([line(vAfterRun, 3)])
await costEngine.run()
await editSale(alreadyCosted, [line(vAfterRun, 1)])
await costEngine.run()
const afterRunItem = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(alreadyCosted.id).id)
const afterRunCost = sql.prepare('SELECT qty, fifoCost FROM "SaleItemCost" WHERE saleItemId = ?').get(afterRunItem)
eq('ویرایشِ پس از اجرای دفتر هم فقط یک واحد را نگه داشت', [Number(afterRunCost?.qty), Number(afterRunCost?.fifoCost)], [1, 1_000_000])
eq('دو واحدِ حذف‌شده با EDIT_ADJ آزاد شدند، نه برگشت مشتری', [
  Number(sql.prepare(`SELECT COALESCE(SUM(qty),0) n FROM "CostConsumption" WHERE saleItemId = ? AND kind = 'SALE'`).get(afterRunItem).n),
  Number(sql.prepare(`SELECT COALESCE(SUM(qty),0) n FROM "CostConsumption" WHERE saleItemId = ? AND kind = 'EDIT_ADJ'`).get(afterRunItem).n)
], [3, 2])
eq('لات و موجودیِ پس از کاهش همچنان هم‌خوان است', [
  Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vAfterRun).n),
  Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(vAfterRun).stock),
  Number((await costEngine.health()).mismatchCount)
], [2, 2, 0])
const rebuiltAfterDecrease = await costEngine.rebuild()
eq('بازسازیِ ویرایشِ پس از اجرا همان FIFO و لات را ساخت', [
  Number(sql.prepare('SELECT qty, fifoCost FROM "SaleItemCost" WHERE saleItemId = ?').get(afterRunItem)?.qty),
  Number(sql.prepare('SELECT qty, fifoCost FROM "SaleItemCost" WHERE saleItemId = ?').get(afterRunItem)?.fifoCost),
  Number(sql.prepare('SELECT COALESCE(SUM(qtyLeft),0) n FROM "PurchaseLot" WHERE variantId = ?').get(vAfterRun).n)
], [1, 1_000_000, 2])
eq('بازسازیِ ویرایشِ پس از اجرا هم سلامت موجودی دارد', Number(rebuiltAfterDecrease.mismatchCount), 0)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
