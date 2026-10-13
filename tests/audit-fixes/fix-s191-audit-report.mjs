/**
 * نشست ۱۹۱ — ایرادهای بحرانی گزارش ممیزی (بدون ۴-۲۴ / رمز دوم‌سوم / قابلیت سبز):
 *   ۱) بازپرداخت نقدی پس از برگشت فقط تا مازاد پول واقعی انجام می‌شود (S194)
 *   ۴) مانده بدهی remainingOf (برگشت را کم می‌کند)
 *   ۶) وصول نشست دیگر زیر فاکتور نشست اول شمرده نمی‌شود
 *   خرید: قیمت منفی حتی با force رد می‌شود
 *   برداشت صندوق بدون دلیل رد می‌شود
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s191-audit-report.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s191-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { purchaseService } = await import('../../src/main/services/PurchaseService.ts')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
const { remainingOf } = await import('../../src/shared/settlement.ts')
const { shapeSaleRow, groupByDayShift } = await import('../../src/main/services/reportShape.ts')
const { nextReceiptNo } = await import('../../src/main/services/receiptNo.ts')
const { toJalaliDate } = await import('@shared/jalali')

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

const user = seed.user('کارمند ۱۹۱')
const product = seed.product('کالا', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 80, salePrice = 1000000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: user
})

console.log('\n۴) remainingOf برگشت را از مانده کم می‌کند')
{
  const d = remainingOf({
    grandTotal: 1_000_000,
    received: 300_000,
    returnedValue: 600_000,
    refundFromReceived: 0
  })
  eq('مانده ۱۰۰ نه ۷۰۰', d.remaining, 100_000)
}

console.log('\n۱) نقد روی نسیه: فقط از مازاد واقعی پس از برگشت خارج می‌شود')
{
  const sale = await salesService.create({
    userId: user,
    shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0, name: 'کالا' }],
    payments: [{ methodId: cash, amount: 300_000, destination: 'CASH' }]
  })
  const itemId = Number(sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(sale.id)?.id)
  const returned = await salesService.createReturn({
    invoiceId: sale.id,
    lines: [{ saleItemId: itemId, qty: 1 }],
    refundMethod: 'CASH',
    refundAmount: 200_000,
    // پس از برگشت کامل، ۳۰۰ ریال پرداخت واقعی اضافه می‌ماند؛ تأیید آن ردیف
    // اضافه‌دریافتِ باقی‌مانده را شفاف نگه می‌دارد، نه اینکه بدهی پنهان بسازد.
    confirmOverpay: true,
    userId: user
  })
  eq('بازپرداخت نقدی در سقف مازاد واقعی ثبت شد', Number(returned.refundAmount), 200_000)
  eq('پس از بازپرداخت هنوز بدهی پنهان ساخته نشد', Number((await salesService.payments({ invoiceId: sale.id })).remaining), 0)
}

console.log('\n۶) وصول نشست دیگر زیر فاکتور نشست اول نیست')
{
  const row = shapeSaleRow({
    id: 1,
    receiptNo: 1,
    issuedAt: new Date(),
    issuedAtJalali: today,
    grandTotal: 700_000,
    paidTotal: 700_000,
    goodsTotal: 700_000,
    taxTotal: 0,
    serviceCharge: 0,
    discountTotal: 0,
    deliveryFee: 0,
    status: 'SETTLED',
    shiftId: 1,
    shift: { name: 'صبح', number: 1, sessionSeq: 1 },
    payments: [
      {
        amount: 700_000,
        kind: 'CASH',
        destination: 'CASH',
        createdShiftId: 2,
        method: { kind: 'CASH' },
        paidAt: new Date()
      }
    ],
    returns: []
  })
  eq('cashTotal نشست فاکتور صفر است', row.cashTotal, 0)

  const own = shapeSaleRow({
    id: 2,
    receiptNo: 2,
    issuedAt: new Date(),
    issuedAtJalali: today,
    grandTotal: 100_000,
    paidTotal: 100_000,
    goodsTotal: 100_000,
    taxTotal: 0,
    serviceCharge: 0,
    discountTotal: 0,
    deliveryFee: 0,
    status: 'SETTLED',
    shiftId: 2,
    shift: { name: 'عصر', number: 2, sessionSeq: 1 },
    payments: [
      {
        amount: 100_000,
        kind: 'CASH',
        destination: 'CASH',
        createdShiftId: 2,
        method: { kind: 'CASH' },
        paidAt: new Date()
      }
    ],
    returns: []
  })
  const groups = groupByDayShift([row, own], new Map(), [
    {
      shiftId: 2,
      dayJalali: today,
      shiftName: 'عصر',
      cashTotal: 700_000,
      receivedTotal: 700_000,
      priorSettlementTotal: 700_000
    }
  ])
  const morning = groups.find((g) => g.shiftName === 'صبح')
  const evening = groups.find((g) => g.shiftName === 'عصر')
  eq('نشست صبح بدون وصول نشست بعد', morning?.totals.cashTotal ?? -1, 0)
  eq('نشست عصر فروش خودش + وصول فاکتور قبل', evening?.totals.cashTotal ?? -1, 800_000)
}

console.log('\nخرید قیمت منفی')
{
  await throws(
    'force قیمت منفی را باز نمی‌کند',
    () =>
      purchaseService.create({
        lines: [{ variantId, qty: 1, unitPrice: -1000 }],
        force: true,
        panelPassword: null
      }),
    'منفی'
  )
}

console.log('\nبرداشت بدون دلیل')
{
  await throws(
    'برداشت بدون توضیح',
    () => cashMovementService.add({ amount: 1000, type: 'WITHDRAWAL', userId: user, description: '' }),
    'دلیل'
  )
}

console.log('\nشماره فیش فقط‌افزایشی')
{
  const a = await nextReceiptNo(db)
  const b = await nextReceiptNo(db)
  eq('شماره دوم بزرگ‌تر است', b > a, true)
  sql.prepare('DELETE FROM "SaleInvoice"').run()
  const c = await nextReceiptNo(db)
  eq('بعد از حذف فاکتور شماره عقب نمی‌رود', c > b, true)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
