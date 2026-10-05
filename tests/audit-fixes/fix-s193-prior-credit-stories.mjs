/**
 * ===========================================================================
 * نشست ۱۹۳ — خط کنترل سرجمع برای وصول نسیه‌ی بازه‌های قبل (فقط نمایشی).
 *
 * مالک: وصول ثبت‌شده در گزارش بماند؛ اگر نام مشتری در فرم هست «نسیه ۵۰۰٬۰۰۰
 * علی محمدی پرداخت کرد» دیده شود؛ نام خالی چیزی نشان ندهد؛ روز شلوغ با +/−.
 * جمع‌ها و مسیر پول عوض نشود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s193-prior-credit-stories.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s193-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { OrderType } = await import('@shared/enums')
const { toJalaliDate, money } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => { if (v) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) } }
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\\n')[0]}`)
    return null
  }
}

const HOUR = 3_600_000
const userId = seed.user('مدیر تست ۱۹۳')
const cat = seed.category('پوشاک ۱۹۳')
const product = seed.product('شلوار ۱۹۳', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const Yat = Date.now() - 30 * HOUR
const yday = toJalaliDate(new Date(Yat))
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - HOUR, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const line = (variantId, price) => ({ variantId, qty: 1, unitPrice: price, discount: 0, tax: 0 })
const backdate = (invoiceId) => {
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = CASE WHEN settledAt IS NULL THEN NULL ELSE ? END WHERE id = ?').run(Yat, yday, Yat, invoiceId)
  sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ?, createdAt = ? WHERE invoiceId = ?').run(Yat, yday, Yat, invoiceId)
}
const accOf = async (d) => (await salesService.reportRows({ fromJalali: d, toJalali: d })).accounting
const numbers = (acc) => JSON.stringify({
  unexplained: acc?.bridge?.unexplained,
  cash: acc?.cash?.netCashMovement,
  settledPrior: acc?.credit?.settledPrior,
  settledPriorCash: acc?.credit?.settledPriorCash,
  goods: acc?.invoices?.grossSales
})

console.log('\\n۱) نسیه‌ی دیروز با نام مشتری ⇒ امروز ۵۰۰٬۰۰۰ وصول ⇒ داستان نام‌دار، عدد عوض نشود')
const namedId = seed.customer('علی محمدی', '09121111111')
const namedVar = variant(500000)
const namedInv = await safe('فروش دیروز نام‌دار', () =>
  salesService.create({
    userId,
    shiftId,
    customerId: namedId,
    lines: [line(namedVar, 500000)],
    payments: []
  })
)
if (namedInv) backdate(namedInv.id)
const payNamed = await safe('وصول ۵۰۰٬۰۰۰ نام‌دار', () =>
  salesService.addPayment({ invoiceId: namedInv.id, amount: 500000, methodId: cash, destination: 'CASH', userId })
)
let t = await accOf(today)
eq('settledPrior = ۵۰۰٬۰۰۰ (بدون تغییر عدد)', t?.credit?.settledPrior, 500000)
eq('پل امروز بسته', t?.bridge?.unexplained, 0)
eq('یک داستان وصول', t?.credit?.settledPriorStories?.length, 1)
eq('مبلغ داستان', t?.credit?.settledPriorStories?.[0]?.amount, 500000)
eq('شناسه پرداخت داستان', t?.credit?.settledPriorStories?.[0]?.paymentId, payNamed?.payment?.id)
const namedText = String(t?.credit?.settledPriorStories?.[0]?.text ?? '')
truthy('متن «علی محمدی پرداخت کرد»', namedText.includes('علی محمدی') && namedText.includes('پرداخت کرد'))
truthy('مبلغ فارسی در متن', namedText.includes(money(500000)))
truthy('نام خالی/عمومی در داستان نام‌دار نیست', !namedText.includes('مشتری عمومی'))
const snap1 = numbers(t)

console.log('\\n۲) نسیه‌ی دیروز بدون نام ⇒ داستان بدون نام، «پرداخت شد»')
const anonVar = variant(200000)
const anonInv = await safe('فروش دیروز بی‌نام', () =>
  salesService.create({ userId, shiftId, lines: [line(anonVar, 200000)], payments: [] })
)
if (anonInv) backdate(anonInv.id)
await safe('وصول ۲۰۰٬۰۰۰ بی‌نام', () =>
  salesService.addPayment({ invoiceId: anonInv.id, amount: 200000, methodId: cash, destination: 'CASH', userId })
)
t = await accOf(today)
eq('settledPrior = ۷۰۰٬۰۰۰', t?.credit?.settledPrior, 700000)
eq('دو داستان', t?.credit?.settledPriorStories?.length, 2)
const anonStory = (t?.credit?.settledPriorStories ?? []).find((s) => s.amount === 200000)
truthy('داستان بی‌نام پیدا شد', !!anonStory)
const anonText = String(anonStory?.text ?? '')
truthy('بی‌نام: «پرداخت شد» نه «پرداخت کرد»', anonText.includes('پرداخت شد') && !anonText.includes('پرداخت کرد'))
truthy('بی‌نام: نام عمومی نشان داده نشد', !anonText.includes('مشتری عمومی') && !anonText.includes('علی محمدی'))
truthy('بی‌نام: مبلغ هست', anonText.includes(money(200000)))

console.log('\\n۳) فروش نقدی همین بازه در فهرست وصول نسیه نمی‌آید')
const todayVar = variant(100000)
await safe('فروش نقد امروز', () =>
  salesService.create({
    userId,
    shiftId,
    customerId: namedId,
    lines: [line(todayVar, 100000)],
    payments: [{ methodId: cash, amount: 100000, destination: 'CASH' }]
  })
)
t = await accOf(today)
eq('هنوز دو داستان وصول (فروش امروز اضافه نشد)', t?.credit?.settledPriorStories?.length, 2)
eq('settledPrior هنوز ۷۰۰٬۰۰۰', t?.credit?.settledPrior, 700000)
eq('پل بسته ماند', t?.bridge?.unexplained, 0)
const snap2 = numbers(t)
truthy('عددهای پول غیر از فروش امروز پایدار ماندند (settledPrior همان)', JSON.parse(snap2).settledPrior === 700000)

console.log('\\n۴) کنترل: snapshot عددهای وصول با داستان عوض نشده')
eq('settledPrior در snapshot اول ۵۰۰٬۰۰۰ بود', JSON.parse(snap1).settledPrior, 500000)
eq('unexplained اول ۰', JSON.parse(snap1).unexplained, 0)

console.log('\\n۵) فاکتور عمده با نام مشتری همان خط کنترل را می‌گیرد (خرد/عمده فرقی ندارد)')
const wholeId = seed.customer('فروشگاه رضایی', '09123333333')
const wholeVar = variant(300000)
const wholeInv = await safe('فروش عمده دیروز', () =>
  salesService.create({
    userId,
    shiftId,
    customerId: wholeId,
    orderType: OrderType.WHOLESALE,
    lines: [line(wholeVar, 300000)],
    payments: []
  })
)
if (wholeInv) backdate(wholeInv.id)
await safe('وصول ۳۰۰٬۰۰۰ عمده', () =>
  salesService.addPayment({ invoiceId: wholeInv.id, amount: 300000, methodId: cash, destination: 'CASH', userId })
)
t = await accOf(today)
eq('settledPrior با عمده = ۱٬۰۰۰٬۰۰۰', t?.credit?.settledPrior, 1000000)
eq('سه داستان (خرد نام‌دار + خرد بی‌نام + عمده)', t?.credit?.settledPriorStories?.length, 3)
const wholeStory = (t?.credit?.settledPriorStories ?? []).find((s) => s.amount === 300000)
truthy('داستان عمده پیدا شد', !!wholeStory)
const wholeText = String(wholeStory?.text ?? '')
truthy('عمده: «فروشگاه رضایی پرداخت کرد»', wholeText.includes('فروشگاه رضایی') && wholeText.includes('پرداخت کرد'))
truthy('عمده: مبلغ فارسی', wholeText.includes(money(300000)))
eq('پل بعد از عمده هم بسته', t?.bridge?.unexplained, 0)

const onlyRetail = await salesService.reportRows({ fromJalali: today, toJalali: today, channels: ['RETAIL'] })
eq('فقط خرد: settledPrior بدون فاکتور عمده', onlyRetail.accounting?.credit?.settledPrior, 700000)
eq('فقط خرد: دو داستان', onlyRetail.accounting?.credit?.settledPriorStories?.length, 2)
truthy('فقط خرد: داستان عمده نیست', !(onlyRetail.accounting?.credit?.settledPriorStories ?? []).some((s) => s.amount === 300000))

const onlyWhole = await salesService.reportRows({ fromJalali: today, toJalali: today, channels: ['WHOLESALE'] })
eq('فقط عمده: settledPrior = ۳۰۰٬۰۰۰', onlyWhole.accounting?.credit?.settledPrior, 300000)
eq('فقط عمده: یک داستان', onlyWhole.accounting?.credit?.settledPriorStories?.length, 1)
truthy('فقط عمده: همان فروشگاه رضایی', String(onlyWhole.accounting?.credit?.settledPriorStories?.[0]?.text ?? '').includes('فروشگاه رضایی'))

console.log(`\\nنتیجه: ${ok} موفق، ${bad} ناموفق`)
if (bad) process.exit(1)
