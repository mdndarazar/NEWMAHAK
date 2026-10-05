/**
 * فیش وصول نسیه — چاپ بعد از commit، پیش‌فرض خاموش، بدون دست زدن به مسیر پول.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s196-debt-payment-receipt.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s196-debt-receipt-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { printService } = await import('../../src/main/services/PrintService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { parseSaleDefaults, SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { readPaymentAddSnapshot, debtReceiptSettled } = await import('../../src/shared/debtReceipt.ts')
const { OrderType } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

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
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست ۱۹۶ فیش نسیه')
const cat = seed.category('پوشاک ۱۹۶')
const productId = seed.product('کت ۱۹۶', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(productId, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = ? WHERE id = ?').run(price, id)
  return id
}

const ROOT = join(import.meta.dirname, '../..')
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

console.log('\n۱) پیش‌فرض تیک خاموش است و داده‌ی قدیمی false می‌خواند')
{
  eq('parseSaleDefaults بدون کلید', parseSaleDefaults({ cashierName: 'x' }).debtPaymentReceiptPrint, false)
  eq('parseSaleDefaults تهی', parseSaleDefaults(null).debtPaymentReceiptPrint, false)
}

console.log('\n۲) ثبت پرداخت بدون تیک چاپ: remaining و Audit همان مسیر امروز')
{
  const vid = variant(300_000)
  const inv = await safe('فروش نسیه ۳۰۰ با ۱۰۰ نقد', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: vid, qty: 1, unitPrice: 300_000, discount: 0, tax: 0, name: 'کت' }],
    payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
  }))
  const payCount0 = seed.count('Payment', 'invoiceId = ?', inv.id)
  const pay = await safe('قسط دوم ۸۰', () => salesService.addPayment({
    invoiceId: inv.id, amount: 80_000, methodId: cash, destination: 'CASH', userId
  }))
  eq('باقی‌مانده بعد از قسط دوم', pay?.remaining, 120_000)
  eq('یک ردیف پرداخت تازه', seed.count('Payment', 'invoiceId = ?', inv.id), payCount0 + 1)
  const audit = seed.one(
    `SELECT after FROM "AuditLog" WHERE action = 'SALE_PAYMENT_ADD' AND entityId = ? ORDER BY id DESC LIMIT 1`,
    pay.payment.id
  )
  const snap = readPaymentAddSnapshot(audit?.after)
  eq('snapshot remaining همان settle', snap?.remaining, 120_000)
  eq('snapshot amount', snap?.amount, 80_000)

  const data = await printService.debtPaymentDataFor(pay.payment.id, { shopName: 'فروشگاه تست' })
  eq('فیش remainingSource=SNAPSHOT', data.remainingSource, 'SNAPSHOT')
  eq('فیش remainingAfter', data.remainingAfter, 120_000)
  eq('فیش settled نیست', data.settled, false)
  inv._id = inv.id
  inv._firstAdd = pay.payment.id
  globalThis.__s196 = { invId: inv.id, firstAddId: pay.payment.id, vid }
}

console.log('\n۳) دو پرداخت پشت‌سرهم: فیش اول بعد از دومی همان عدد اول را دارد')
{
  const { invId, firstAddId } = globalThis.__s196
  const pay2 = await safe('قسط سوم ۵۰', () => salesService.addPayment({
    invoiceId: invId, amount: 50_000, methodId: cash, destination: 'CASH', userId
  }))
  eq('باقی‌مانده بعد از قسط سوم', pay2?.remaining, 70_000)
  const first = await printService.debtPaymentDataFor(firstAddId, { shopName: 'فروشگاه تست' })
  const second = await printService.debtPaymentDataFor(pay2.payment.id, { shopName: 'فروشگاه تست' })
  eq('فیش اول هنوز ۱۲۰', first.remainingAfter, 120_000)
  eq('فیش دوم ۷۰', second.remainingAfter, 70_000)
}

console.log('\n۴) تسویه: remaining=0 و HTML «تسویه شد»')
{
  const { invId } = globalThis.__s196
  const last = await safe('تسویه ۷۰', () => salesService.addPayment({
    invoiceId: invId, amount: 70_000, methodId: cash, destination: 'CASH', userId
  }))
  eq('remaining صفر', last?.remaining, 0)
  const data = await printService.debtPaymentDataFor(last.payment.id, { shopName: 'فروشگاه تست' })
  eq('settled', data.settled, true)
  const html = await printService.debtPaymentHtml(last.payment.id)
  truthy('HTML تسویه شد', html.includes('تسویه شد'))
  truthy('HTML مقصد پول ندارد', !html.includes('حساب مدیر') && !html.includes('مقصد'))
}

console.log('\n۵) چک: تسویه نشود و متن در جریان بیاید')
{
  const vid = variant(200_000)
  const inv = await safe('فروش برای چک', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: vid, qty: 1, unitPrice: 200_000, discount: 0, tax: 0, name: 'کت چک' }],
    payments: [{ methodId: cash, amount: 50_000, destination: 'CASH' }]
  }))
  const chq = await safe('ثبت چک', () => salesService.addPayment({
    invoiceId: inv.id, kind: 'CHEQUE', amount: 150_000, dueDateJalali: today, chequeNo: '123', bankName: 'ملت', userId
  }))
  eq('چک remaining را کم نکرد', chq?.remaining, 150_000)
  const data = await printService.debtPaymentDataFor(chq.payment.id, { shopName: 'فروشگاه تست' })
  eq('چک settled=false', data.settled, false)
  eq('helper settled برای چک', debtReceiptSettled('CHEQUE', 0), false)
  const html = await printService.debtPaymentHtml(chq.payment.id)
  truthy('متن در جریان', html.includes('تا پاس شدن از باقی‌مانده کم نمی‌شود'))
  truthy('چک تسویه شد ندارد', !html.includes('تسویه شد'))
}

console.log('\n۶) مشتری بی‌نام: خط مشتری در HTML نیست')
{
  const vid = variant(100_000)
  const inv = await safe('فروش بی‌نام', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: vid, qty: 1, unitPrice: 100_000, discount: 0, tax: 0, name: 'کت' }],
    payments: [{ methodId: cash, amount: 40_000, destination: 'CASH' }]
  }))
  const pay = await safe('قسط بی‌نام', () => salesService.addPayment({
    invoiceId: inv.id, amount: 30_000, methodId: cash, destination: 'CASH', userId
  }))
  const data = await printService.debtPaymentDataFor(pay.payment.id, { shopName: 'فروشگاه تست' })
  eq('customerName خالی', data.customerName, null)
  const html = await printService.debtPaymentHtml(pay.payment.id)
  truthy('بدون برچسب مشتری عمومی', !html.includes('مشتری عمومی'))
}

console.log('\n۷) عمده و خرد یکسان')
{
  const vid = variant(80_000)
  const inv = await safe('فروش عمده', () => salesService.create({
    userId, shiftId, orderType: OrderType.WHOLESALE,
    lines: [{ variantId: vid, qty: 1, unitPrice: 80_000, discount: 0, tax: 0, name: 'کت عمده' }],
    payments: [{ methodId: cash, amount: 20_000, destination: 'CASH' }]
  }))
  const pay = await safe('قسط عمده', () => salesService.addPayment({
    invoiceId: inv.id, amount: 20_000, methodId: cash, destination: 'CASH', userId
  }))
  const data = await printService.debtPaymentDataFor(pay.payment.id, { shopName: 'فروشگاه تست' })
  eq('عمده remaining', data.remainingAfter, 40_000)
  eq('عمده SNAPSHOT', data.remainingSource, 'SNAPSHOT')
}

console.log('\n۸) تنظیمات: بی‌رمز رد؛ با رمز مدیر Audit')
{
  const cur = await settingsService.saleDefaults()
  eq('تیک پیش‌فرض خاموش', cur.debtPaymentReceiptPrint, false)
  let threw = false
  try {
    await settingsService.saveBundle({ sale: { ...cur, debtPaymentReceiptPrint: true } })
  } catch (e) {
    threw = /رمز|مدیر/.test(String(e?.message ?? e))
  }
  truthy('بی‌رمز رد شد', threw)
  eq('بعد از رد هنوز خاموش', (await settingsService.saleDefaults()).debtPaymentReceiptPrint, false)
  await safe('روشن با رمز مدیر', () =>
    settingsService.saveBundle({ sale: { ...cur, debtPaymentReceiptPrint: true }, managerPassword: PW, userId })
  )
  eq('تیک روشن شد', (await settingsService.saleDefaults()).debtPaymentReceiptPrint, true)
  const note = seed.one(`SELECT note FROM "AuditLog" WHERE action = 'SETTINGS_UPDATE' ORDER BY id DESC LIMIT 1`)?.note
  truthy('یادداشت فیش وصول روشن', String(note).includes('فیش وصول نسیه روشن شد'))
}

console.log('\n۹) منبع: چاپ پشت تیک است و SalesService چاپ را import نمی‌کند')
{
  const modal = read('src/renderer/src/components/InvoicePaymentsModal.tsx')
  truthy('چاپ فقط اگر تیک', /if\s*\(\s*!debtReceiptPrint/.test(modal) && /CH\.printDebtPayment/.test(modal))
  truthy('چاپ بعد از finally پرداخت', /if \(debtReceiptPrint && printedPaymentId\)/.test(modal))
  const sales = read('src/main/services/SalesService.ts')
  truthy(
    'SalesService چاپ ندارد',
    !sales.includes('printDebtPayment') && !sales.includes('printHtml') && !sales.includes("from './PrintService'")
  )
  const printSrc = read('src/main/services/PrintService.ts')
  truthy('printInvoice به تیک فیش وصل نیست', !/debtPaymentReceiptPrint/.test(printSrc.split('async printInvoice')[1]?.slice(0, 1500) ?? ''))
  truthy('کامنت قرارداد remaining در addPayment', sales.includes('قرارداد فیش وصول نسیه'))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
