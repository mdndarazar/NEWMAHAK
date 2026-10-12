/**
 * نشست ۱۹۰ — ۱۴ مورد ممیزی (بدون موارد بسته‌شدهٔ مالک):
 *   ۱) قفل یکتای بستن صندوق
 *   ۲) تعویض با روش CUSTOM بدون مقصد رد می‌شود
 *   ۳) کارت‌به‌کارت بیشتر از مبلغ درخواست رد می‌شود
 *   ۵) گزارش کارمند برگشتِ فاکتور DRAFT را نمی‌شمارد
 *   ۶) رسید پرداخت باطل‌شده را چاپ نمی‌کند
 *   ۷) remainingOf / r0 روی BigInt بزرگ throw می‌کنند
 *  ۱۲) snapshot نام قلم بر نام زنده اولویت دارد
 *  ۱۱) baselining فقط با همه‌ی جدول‌های نشانه
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s190-audit14.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s190-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { cardTransferService, createCardTransferRequest } = await import('../../src/main/services/CardTransferService.ts')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { printService } = await import('../../src/main/services/PrintService.ts')
const { remainingOf } = await import('../../src/shared/credit.ts')
const { remainingOf: settleRemaining } = await import('../../src/shared/settlement.ts')
const { saleLineTitle, saleLineCode, reportLineTitle } = await import('../../src/shared/saleItemSnapshot.ts')
const { shouldBaseline } = await import('../../src/main/db/migrator.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}
const throws = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · خطا پرتاب نشد`)
  } catch (e) {
    const msg = String(e?.message ?? e)
    if (!needle || msg.includes(needle)) {
      ok++
      console.log(`  ✓ ${label}`)
    } else {
      bad++
      console.log(`  ✗ ${label} · پیام نامنتظر: ${msg.split('\n')[0]}`)
    }
  }
}

const user = seed.user('فروشنده ۱۹۰')
const product = seed.product('کالا زنده', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 80, salePrice = 10000, code = ? WHERE id = ?').run('LIVE-CODE', variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const custom = seed.insert('PaymentMethod', { key: 'CUSTOM1', label: 'سفارشی', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: user
})

console.log('\n۷) BigInt بدون Number() بی‌صدا')
{
  eq('remainingOf عدد معمولی', remainingOf({ amount: 1000, usedAmount: 250, status: 'ACTIVE' }), 750)
  await throws('remainingOf bigint بزرگ', () => {
    remainingOf({ amount: BigInt(Number.MAX_SAFE_INTEGER) + 5n, usedAmount: 0, status: 'ACTIVE' })
  })
  eq(
    'settlement remaining معمولی',
    settleRemaining({ grandTotal: 1000, received: 400, returnedValue: 0, refundFromReceived: 0 }).remaining,
    600
  )
  await throws('settlement bigint بزرگ', () => {
    settleRemaining({
      grandTotal: BigInt(Number.MAX_SAFE_INTEGER) + 3n,
      received: 0,
      returnedValue: 0,
      refundFromReceived: 0
    })
  })
}

console.log('\n۱۲) snapshot نام بر نام زنده')
{
  eq('snapshot موجود', saleLineTitle({ variantName: 'نام روز فروش' }, { product: { name: 'نام زنده' } }), 'نام روز فروش')
  eq('بدون snapshot', saleLineTitle({ variantName: null }, { product: { name: 'نام زنده' }, size: 'L' }), 'نام زنده سایز L')
  eq(
    'preferLive روی فیش اثر ندارد مگر صریح',
    saleLineTitle({ variantName: 'نام روز فروش' }, { product: { name: 'نام زنده', reportLiveName: true } }),
    'نام روز فروش'
  )
  eq(
    'گزارش با تیک روشن',
    reportLineTitle({ variantName: 'نام روز فروش' }, { product: { name: 'نام زنده', reportLiveName: true } }),
    'نام زنده'
  )
  eq(
    'گزارش با تیک خاموش',
    reportLineTitle({ variantName: 'نام روز فروش' }, { product: { name: 'نام زنده', reportLiveName: false } }),
    'نام روز فروش'
  )
  eq('کد snapshot', saleLineCode({ variantCode: 'SNAP' }, { code: 'LIVE' }), 'SNAP')
}

console.log('\n۱۱) baselining کامل')
{
  eq('فقط Product کافی نیست', shouldBaseline(new Set(['Product'])), false)
  eq(
    'هر سه نشانه',
    shouldBaseline(new Set(['SaleInvoice', 'ProductVariant', 'Product'])),
    true
  )
}

const payCash = (amount) => [{ methodId: cash, amount, destination: 'CASH' }]
const line = (price, extra = {}) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0, name: 'کالا', ...extra })

console.log('\n۱۲ب) snapshot فروش فقط از دیتابیس main ساخته می‌شود، نه payload قابل جعل')
{
  const sale = await salesService.create({
    userId: user,
    shiftId,
    // این دو مقدار renderer عمداً جعلی‌اند و نباید روی سند بنشینند.
    lines: [line(10_000, { name: 'نام جعلی رندرر', code: 'FORGED-CODE' })],
    payments: payCash(10_000)
  })
  const item = sql.prepare('SELECT variantName, variantCode FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)
  eq('variantName از نام/سایز موجودی لحظهٔ فروش ذخیره شد', item?.variantName, 'کالا زنده سایز سایز')
  eq('variantCode از موجودی لحظهٔ فروش ذخیره شد', item?.variantCode, 'LIVE-CODE')
  eq('نام payload جعلی روی سند ننشست', item?.variantName === 'نام جعلی رندرر', false)
  eq('کد payload جعلی روی سند ننشست', item?.variantCode === 'FORGED-CODE', false)
}

console.log('\n۲) تعویض CUSTOM بدون مقصد')
{
  const sale = await salesService.create({
    userId: user,
    shiftId,
    lines: [line(10_000)],
    payments: payCash(10_000)
  })
  const itemId = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)?.id)
  await throws(
    'CUSTOM بدون destination',
    () =>
      salesService.createExchange({
        invoiceId: sale.id,
        lines: [{ saleItemId: itemId, qty: 1 }],
        replacements: [{ variantId, qty: 2 }],
        methodId: custom,
        userId: user,
        shiftId
      }),
    'مقصد'
  )
}

console.log('\n۳) کارت‌به‌کارت مبلغ بیشتر')
{
  const invId = seed.invoice({ grandTotal: 10000 })
  const retId = seed.insert('SaleReturn', {
    invoiceId: typeof invId === 'object' ? invId.id : invId,
    total: 5000,
    returnedAt: Date.now(),
    returnedAtJalali: today,
    kind: 'RETURN'
  })
  const req = await createCardTransferRequest(db, { returnId: retId, amount: 5000, userId: user })
  await throws(
    'paid > amount',
    () =>
      cardTransferService.pay({
        id: Number(req.id),
        paidAmount: 5001,
        userId: user,
        managerPassword: PW
      }),
    'بیشتر'
  )
}

console.log('\n۶) رسید پرداخت باطل')
{
  const sale = await salesService.create({
    userId: user,
    shiftId,
    lines: [line(10_000)],
    payments: payCash(10_000)
  })
  const pay = sql.prepare('SELECT id FROM "Payment" WHERE invoiceId = ?').get(sale.id)
  sql.prepare('UPDATE "Payment" SET voidedAt = ? WHERE id = ?').run(Date.now(), pay.id)
  const data = await printService.receiptDataFor(sale.id)
  eq('پرداخت باطل در رسید نیست', data.payments.length, 0)
}

console.log('\n۵) گزارش کارمند DRAFT')
{
  const sale = await salesService.create({
    userId: user,
    shiftId,
    lines: [line(10_000)],
    payments: []
  })
  const itemId = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)?.id)
  await salesService.createReturn({
    invoiceId: sale.id,
    lines: [{ saleItemId: itemId, qty: 1 }],
    refundMethod: 'NONE',
    userId: user
  })
  sql.prepare('UPDATE "SaleInvoice" SET status = ? WHERE id = ?').run('DRAFT', sale.id)
  const perf = await staffReportService.performance({ fromJalali: today, toJalali: today, userId: user })
  const row = (perf.rows ?? []).find((r) => r.userId === user) ?? perf.rows?.[0]
  eq('برگشت فاکتور DRAFT در عملکرد نیست', row?.returnTotal ?? 0, 0)
}

console.log('\n۱) بستن دوباره بدون تأیید')
{
  await salesService.create({
    userId: user,
    shiftId,
    lines: [line(10_000)],
    payments: payCash(10_000)
  })
  await cashboxService.close({ shiftId, userId: user, countedCash: 0, closeShift: false, explicitShift: true })
  await throws('بستن تکراری بدون allowRepeatClose', () =>
    cashboxService.close({ shiftId, userId: user, countedCash: 0, closeShift: false, explicitShift: true })
  )
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
