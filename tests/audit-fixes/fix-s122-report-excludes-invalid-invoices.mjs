/**
 * نشست ۱۲۲ · خوشه G · گزارش فروش فقط سندهای معتبر را می‌شمارد.
 *
 * باگ: `saleWhere` فقط `voidedAt: null` داشت. داده‌ی قدیمی یا مسیر دیگری که
 * وضعیت را CANCELED/DRAFT کرده ولی مهر void نداشته، وارد فهرست فاکتورهای عمده
 * و جمع گزارش می‌شد. همین سوراخ در `reportInvoiceRelationWhere` باعث می‌شد
 * برگشتِ متصل به چنین فاکتوری هم در تب برگشت/تعویض دیده شود.
 *
 * این تست باید روی baseline نشست ۱۲۱ قبل از رفع fail کند و بعد از رفع سبز شود.
 * هارنس SQLite جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s122-invalid-invoices-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const {
  salesService,
  saleWhere,
  reportInvoiceRelationWhere
} = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const now = Date.now() - 60_000
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

const invoice = (receiptNo, status, extra = {}) =>
  seed.insert('SaleInvoice', {
    receiptNo,
    status,
    orderType: 'WHOLESALE',
    grandTotal: 1_000,
    paidTotal: 1_000,
    issuedAt: now,
    issuedAtJalali: today,
    ...extra
  })

const validId = invoice(60_001, 'SETTLED')
const canceledId = invoice(60_002, 'CANCELED')
const draftId = invoice(60_003, 'DRAFT')
const canceledReturnId = seed.insert('SaleReturn', {
  invoiceId: canceledId,
  total: 1_000,
  returnedAt: now,
  returnedAtJalali: today,
  kind: 'RETURN'
})

const filter = {
  from: jalaliStartOfDay(today).toISOString(),
  to: jalaliEndOfDay(today).toISOString(),
  orderType: 'WHOLESALE'
}
const rows = await salesService.list(filter)
eq('فهرست فقط فاکتور معتبر را دارد', rows.length, 1)
eq('فاکتور معتبر باقی مانده است', rows[0]?.id, validId)
eq('جمع کل فقط فاکتور معتبر است', rows.totals?.grandTotal, 1_000)
eq('تعداد کل فقط فاکتور معتبر است', rows.totals?.count, 1)

const where = saleWhere({})
eq('فیلتر پیش‌فرض فاکتور باطل را حذف می‌کند', where.status?.notIn?.includes('CANCELED'), true)
eq('فیلتر پیش‌فرض پیش‌نویس را حذف می‌کند', where.status?.notIn?.includes('DRAFT'), true)

const relation = reportInvoiceRelationWhere({})
eq('فیلتر رابطه‌ای مهر void را نگه می‌دارد', relation.voidedAt, null)
eq('فیلتر رابطه‌ای فاکتور لغوشده را حذف می‌کند', relation.status?.notIn?.includes('CANCELED'), true)
eq('فیلتر رابطه‌ای پیش‌نویس را حذف می‌کند', relation.status?.notIn?.includes('DRAFT'), true)

const returns = await salesService.returnList({
  fromJalali: today,
  toJalali: today,
  channels: ['WHOLESALE'],
  includeExchanges: true
})
eq('برگشت فاکتور لغوشده در تب برگشت دیده نمی‌شود', returns.some((r) => r.id === canceledReturnId), false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
