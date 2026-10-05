/**
 * نشست ۱۹۲ — بند ۴-۱۶: گزارش شماره‌های جاافتاده / باطل‌شده.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s192-receipt-gaps.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s192-gaps-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { receiptGapReport } = await import('../../src/main/services/receiptNo.ts')
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

const user = seed.user('کارمند فیش')
const product = seed.product('کالا', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 80, salePrice = 100000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3600_000,
  userId: user
})

const mk = () =>
  salesService.create({
    userId: user,
    shiftId,
    lines: [{ variantId, qty: 1, unitPrice: 100_000, discount: 0, tax: 0, name: 'کالا' }],
    payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
  })

const a = await mk()
const b = await mk()
const c = await mk()

console.log('\n۴-۱۶) سه فاکتور زنده')
{
  const r = await receiptGapReport(db)
  eq('شمارنده حداقل ۳', r.seq >= 3, true)
  eq('زنده ۳', r.liveCount, 3)
  eq('باطل ۰', r.voidedCount, 0)
  eq('گم ۰', r.missingCount, 0)
  eq('بدون بازه', r.ranges.length, 0)
}

console.log('\n۴-۱۶) ابطال وسط')
sql.prepare('UPDATE "SaleInvoice" SET voidedAt = ?, status = ? WHERE id = ?').run(Date.now(), 'CANCELED', b.id)
{
  const r = await receiptGapReport(db)
  eq('زنده ۲', r.liveCount, 2)
  eq('باطل ۱', r.voidedCount, 1)
  const voided = r.ranges.filter((x) => x.reason === 'voided')
  eq('یک بازه ابطال', voided.length, 1)
  eq('شماره باطل همان فیش وسط', voided[0]?.from === b.receiptNo && voided[0]?.to === b.receiptNo, true)
}

console.log('\n۴-۱۶) حذف فیزیکی اول')
sql.prepare('DELETE FROM "Payment" WHERE invoiceId = ?').run(a.id)
sql.prepare('DELETE FROM "SaleInvoiceItem" WHERE invoiceId = ?').run(a.id)
sql.prepare('DELETE FROM "SaleInvoice" WHERE id = ?').run(a.id)
{
  const r = await receiptGapReport(db)
  eq('گم ۱', r.missingCount, 1)
  const miss = r.ranges.filter((x) => x.reason === 'missing')
  eq('یک بازه بدون ردیف', miss.length, 1)
  eq('شماره گم همان فیش اول', miss[0]?.from === a.receiptNo && miss[0]?.to === a.receiptNo, true)
  eq('فیش سوم هنوز زنده است', r.liveCount, 1)
}

void c
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
