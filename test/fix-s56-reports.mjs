/**
 * ===========================================================================
 * نشست ۱ زنجیره رفع — سوییت بازتولید «صورت‌های گزارش فروش».
 * خوشه A (اسکوپ رویداد) · خوشه B (تعویض و بازپرداخت) · خوشه D (اعتبار خرید)
 *
 *     node --import ./test/harness/register.mjs test/fix-s56-reports.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-reports-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { buildStatements } = await import('../src/main/services/accountingReport.ts')
const { saleWhere } = await import('../src/main/services/SalesService.ts')
const { jalaliStartOfDay, jalaliEndOfDay } = await import('../src/shared/jalali.ts')

const prisma = harnessClient()
const seed = makeSeeder(prisma)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}

const at = (jalali, h = 12) => new Date(jalaliStartOfDay(jalali).getTime() + h * 3600_000)
const report = async (fromJalali, toJalali) => {
  const filter = { fromJalali, toJalali }
  const where = saleWhere(filter)
  const { statements } = await buildStatements({
    where,
    from: jalaliStartOfDay(fromJalali),
    to: jalaliEndOfDay(toJalali),
    period: { fromJalali, toJalali, source: 'explicit' },
    filter
  })
  return statements
}

const cashMethod = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH' })

// ===========================================================================
console.log('\n— A1 — برگشتِ ماه بعد روی فاکتور ماه قبل باید در گزارش ماه برگشت دیده شود')
{
  const inv = seed.invoice({ grandTotal: 500_000 })
  seed.insert('SaleInvoice', {}) // بی‌ربط، برای اطمینان از اسکوپ
  prisma.$harness.db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?')
    .run(at('1405/01/31', 10).getTime(), '1405/01/31', inv.id)
  seed.insert('SaleReturn', {
    invoiceId: inv.id, total: 200_000, refundMethod: 'CASH', refundAmount: 200_000,
    returnedAt: at('1405/02/01', 12), returnedAtJalali: '1405/02/01', kind: 'RETURN'
  })
  const s = await report('1405/02/01', '1405/02/01')
  eq('برگشت ساده‌ی بازه', s.returns.simpleReturns, 200_000)
  eq('بازپرداخت نقدی بازه', s.returns.cashRefunds, 200_000)
}

// ===========================================================================
console.log('\n— A1/ب — وصول نسیه‌ی فاکتور بازه‌ی قبل باید در «وجه واقعی» همین بازه بیاید')
{
  const inv = seed.invoice({ grandTotal: 700_000 })
  prisma.$harness.db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?')
    .run(at('1405/01/20', 10).getTime(), '1405/01/20', inv.id)
  seed.insert('Payment', {
    invoiceId: inv.id, methodId: cashMethod, amount: 700_000, kind: 'CASH', destination: 'CASH',
    paidAt: at('1405/02/05', 13), paidAtJalali: '1405/02/05'
  })
  const s = await report('1405/02/05', '1405/02/05')
  eq('دریافتی نقد بازه', s.cash.cashReceived, 700_000)
  eq('وصول نسیه‌ی بازه‌های قبل', s.credit.settledPrior, 700_000)
  eq('نقدِ وصولِ بازه‌های قبل', s.credit.settledPriorCash, 700_000)
  eq('دریافتی همین بازه (فروش امروز نیست)', s.credit.settledCurrent, 0)
}

// ===========================================================================
console.log('\n— B1 — تعویض با بازپرداخت نقدی: نه اعتبار خرید، نه دو بار کم شدن')
{
  const inv = seed.invoice({ grandTotal: 1_000_000 })
  prisma.$harness.db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?')
    .run(at('1405/03/10', 10).getTime(), '1405/03/10', inv.id)
  // تعویض: کالای ۱٬۰۰۰٬۰۰۰ با کالای ۴۰۰٬۰۰۰ ⇒ ۶۰۰٬۰۰۰ به مشتری نقد برگشت
  seed.insert('SaleReturn', {
    invoiceId: inv.id, kind: 'EXCHANGE', total: 1_000_000, exchangeTotal: 400_000,
    exchangeDiff: -600_000, exchangeSettlement: 'CASH_REFUND',
    returnedAt: at('1405/03/10', 11), returnedAtJalali: '1405/03/10'
  })
  const s = await report('1405/03/10', '1405/03/10')
  eq('بازپرداخت نقدی تعویض', s.returns.exchangeCashRefunds, 600_000)
  eq('اعتبار خریدِ تعویض (نباید ساخته شود)', s.returns.exchangeStoreCreditIssued, 0)
  eq('خروج نقدِ تعویض در صورت وجه', s.cash.cashRefundsForExchanges, 600_000)
}

// ===========================================================================
console.log('\n— B1/ب — Payment منفیِ داده‌ی قدیمی نباید دریافتی نقد را کم کند')
{
  const inv = seed.invoice({ grandTotal: 1_000_000 })
  prisma.$harness.db.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?')
    .run(at('1405/04/10', 10).getTime(), '1405/04/10', inv.id)
  seed.insert('Payment', {
    invoiceId: inv.id, methodId: cashMethod, amount: 1_000_000, kind: 'CASH', destination: 'CASH',
    paidAt: at('1405/04/10', 10), paidAtJalali: '1405/04/10'
  })
  seed.insert('Payment', {
    invoiceId: inv.id, methodId: cashMethod, amount: -600_000, kind: 'CASH', destination: 'CASH',
    paidAt: at('1405/04/10', 11), paidAtJalali: '1405/04/10'
  })
  seed.insert('SaleReturn', {
    invoiceId: inv.id, kind: 'EXCHANGE', total: 1_000_000, exchangeTotal: 400_000,
    exchangeDiff: -600_000, exchangeSettlement: 'CASH_REFUND',
    returnedAt: at('1405/04/10', 11), returnedAtJalali: '1405/04/10'
  })
  const s = await report('1405/04/10', '1405/04/10')
  eq('دریافتی نقد (فقط دریافت واقعی)', s.cash.cashReceived, 1_000_000)
  eq('خروج نقد تعویض فقط یک بار', s.cash.cashRefundsForExchanges, 600_000)
  eq('وجه واقعی خالص', s.cash.netCashMovement, 400_000)
}

// ===========================================================================
console.log('\n— D1 — مصرف اعتبار خرید از رویدادهای مصرف، نه از مبلغ اولیه')
{
  const c1 = seed.insert('StoreCredit', {
    code: 'SC-1', amount: 1_000_000, status: 'PARTIALLY_USED', usedAmount: 300_000, usedCount: 1, multiUse: true, maxUses: 5,
    issuedAt: at('1405/05/01', 10), issuedAtJalali: '1405/05/01'
  })
  const c2 = seed.insert('StoreCredit', {
    code: 'SC-2', amount: 1_000_000, status: 'PARTIALLY_USED', usedAmount: 500_000, usedCount: 1, multiUse: true, maxUses: 5,
    issuedAt: at('1405/05/01', 10), issuedAtJalali: '1405/05/01'
  })
  seed.insert('StoreCreditRedemption', {
    creditId: c1, code: 'SC-1', amount: 300_000, remainderAfter: 700_000,
    at: at('1405/05/02', 10), atJalali: '1405/05/02'
  })
  seed.insert('StoreCreditRedemption', {
    creditId: c2, code: 'SC-2', amount: 500_000, remainderAfter: 500_000,
    at: at('1405/05/02', 11), atJalali: '1405/05/02'
  })
  const s = await report('1405/05/02', '1405/05/02')
  eq('مصرف اعتبار بازه', s.storeCredits.used, 800_000)
  eq('تعداد مصرف', s.storeCredits.usageCount, 2)
}

// ===========================================================================
console.log('\n— D2 — تعهد اعتبار: PARTIALLY_USED و SUSPENDED هم تعهدند (باقی‌مانده، نه مبلغ اولیه)')
{
  // «تعهد» عددی «تا این لحظه» است، نه بازه‌ای؛ پس اثر *افزودنِ* یک اعتبار سنجیده می‌شود.
  const before = (await report('1405/06/01', '1405/06/01')).storeCredits.active
  const c = seed.insert('StoreCredit', {
    code: 'SC-3', amount: 1_000_000, status: 'PARTIALLY_USED', usedAmount: 300_000, usedCount: 1, multiUse: true, maxUses: 5,
    issuedAt: at('1405/06/01', 10), issuedAtJalali: '1405/06/01'
  })
  seed.insert('StoreCreditRedemption', {
    creditId: c, code: 'SC-3', amount: 300_000, remainderAfter: 700_000,
    at: at('1405/06/01', 11), atJalali: '1405/06/01'
  })
  const s = await report('1405/06/01', '1405/06/01')
  eq('افزایش تعهد با اعتبار مصرف‌بخشیِ تازه (باقی‌مانده، نه مبلغ اولیه)', s.storeCredits.active - before, 700_000)

  // اعتبار معلق هم تعهد است (بدهی ما به مشتری سر جایش است)
  seed.insert('StoreCredit', {
    code: 'SC-4', amount: 250_000, status: 'SUSPENDED',
    issuedAt: at('1405/06/01', 10), issuedAtJalali: '1405/06/01',
    suspendedAt: at('1405/06/01', 12)
  })
  const s2 = await report('1405/06/01', '1405/06/01')
  eq('اعتبار معلق در تعهد می‌آید', s2.storeCredits.active - s.storeCredits.active, 250_000)

  // اعتبار کاملاً مصرف‌شده تعهد ندارد
  seed.insert('StoreCredit', {
    code: 'SC-5', amount: 400_000, status: 'USED', usedAmount: 400_000, usedCount: 1,
    issuedAt: at('1405/06/01', 10), issuedAtJalali: '1405/06/01'
  })
  const s3 = await report('1405/06/01', '1405/06/01')
  eq('اعتبار مصرف‌شده تعهد اضافه نمی‌کند', s3.storeCredits.active - s2.storeCredits.active, 0)
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
