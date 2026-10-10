/**
 * ===========================================================================
 * نشست ۱۸۷ — اعتبار صادرشده بابت برگشت/تعویض در گزارش فروش
 *
 * مالک خواست این مبلغ «در مبلغ کل فروش بیاید، مثل کسی که پول داده و کد گرفته».
 * آن قیاس غلط است: آن مسیر صدور اعتبار بابت *اضافه‌دریافت نقد* است (پول تازه
 * وارد شده). این‌جا کالا برگشته و پول فروش اصلی از قبل در `goodsTotal` است.
 * افزودن اعتبار به فروش کل = دوباره‌شماری.
 *
 * باید در گزارش *دیده* شود (بلوک ۳، تب اعتبار، ستون بارکد برگشت، خط کنترل).
 * نباید از «باید در صندوق باشد» کم شود: اگر کم شود، فروشنده‌ای که نقد داده و
 * در سیستم اعتبار زده، کسری‌اش با گزارش یکی می‌شود و دزدی پنهان می‌ماند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s187-return-credit-in-report.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s187-credit-report-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { physicalMoneyInDrawerAndCard, returnCreditAmountOf } = await import('../../src/shared/accounting.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const reports = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}`) }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

console.log('\n۰) فرمول پول فیزیکی — ارزش برگشت نقد را کم نمی‌کند')
eq('فروش نقد ۱M بدون برگشت', physicalMoneyInDrawerAndCard({ receivedTotal: 1_000_000 }), 1_000_000)
eq('برگشت نقد ۱M از کشو کم می‌شود', physicalMoneyInDrawerAndCard({
  receivedTotal: 1_000_000, refundCashTotal: 1_000_000
}), 0)
eq('برگشت کارتی از مجموع صندوق+کارت کم می‌شود', physicalMoneyInDrawerAndCard({
  receivedTotal: 1_000_000, refundCardTotal: 400_000
}), 600_000)
eq('اعتبار صادرشده خروج نقد نیست (اگر به‌اشتباه در refundCash بیاید تست رفتاری می‌گیرد)', physicalMoneyInDrawerAndCard({
  receivedTotal: 1_000_000, refundCashTotal: 0, refundCardTotal: 0
}), 1_000_000)
eq('مبلغ اعتبار فقط روی STORE_CREDIT', returnCreditAmountOf({ refundMethod: 'STORE_CREDIT', refundAmount: 750_000 }), 750_000)
eq('بازپرداخت نقد مبلغ اعتبار صفر', returnCreditAmountOf({ refundMethod: 'CASH', refundAmount: 750_000 }), 0)

console.log('\n۱) قرارداد UI — دیده می‌شود، به فروش کل اضافه نمی‌شود')
truthy('کنترل صندوق از physicalMoneyInDrawerAndCard است', /physicalMoneyInDrawerAndCard\(/.test(reports))
truthy('فرمول قدیمی (received − returnedTotal) حذف شده', !/receivedTotal \+ t\.priorSettlementTotal - t\.returnedTotal/.test(reports))
truthy('تب برگشت شناسهٔ امن اعتبار دارد', /'شناسهٔ امن اعتبار'/.test(reports) && /'مبلغ اعتبار'/.test(reports))
truthy('چاپ و Excel برگشت از RETURN_HEADERS است', /title: `گزارش برگشت از فروش — \$\{meta\}`,[\s\S]{0,260}headers: RETURN_HEADERS/.test(reports))
truthy('هشدار دزدی نقد+اعتبار روی خط کنترل هست', /اگر فروشنده نقد هم داده، کشو باید به همین اندازه کسری نشان بدهد/.test(reports))
truthy('زیر خالص می‌گوید صندوق جدا از فروش کالاست', /خالص فروش کالا است، موجودی صندوق نیست/.test(reports))
truthy('مصرف بارکد روی خط کنترل کسری نیست', /فروش این بازه با بارکد اعتبار خرید تسویه شده/.test(reports))
truthy('خط کنترل بارکدها را با + باز می‌کند', /\+ نمایش/.test(reports) && /creditStoriesOpen/.test(reports))
truthy('خط کنترل بارکدها را با − جمع می‌کند', /− جمع شدن/.test(reports))
truthy('سقف ۱۲تایی پنهان‌کاری روی خط کنترل نیست', !/فقط ۱۲/.test(reports))
const accountingSrc = readFileSync(resolve(root, 'src/main/services/accountingReport.ts'), 'utf8')
truthy('سقف خواندن بارکد کنترل حداقل ۱۰۰ است', /USAGE_STORY_CAP = 5000/.test(accountingSrc))
truthy('مبلغ کل فروش از اعتبار صادرشده جمع نمی‌شود', !/goodsTotal\s*\+\s*[^\n]*storeCredit/.test(reports))

const userId = seed.user('مدیر تست نشست ۱۸۷ اعتبار گزارش')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const sale = (price) => salesService.create({
  userId, shiftId,
  lines: [{ variantId: variant(price), qty: 1, unitPrice: price, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: price, destination: 'CASH' }]
})
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const reportOf = () => salesService.reportRows({ fromJalali: today, toJalali: today })
const physicalOf = (t) => physicalMoneyInDrawerAndCard({
  receivedTotal: t.receivedTotal,
  priorSettlementTotal: t.priorSettlementTotal,
  refundCashTotal: t.refundCashTotal,
  refundCardTotal: t.refundCardTotal
})

console.log('\n۲) برگشت با اعتبار — در گزارش دیده می‌شود، فروش کل دوبرابر نمی‌شود، کشو کم نمی‌شود')
const creditSale = await safe('فروش ۱M نقد (مسیر اعتبار)', () => sale(1_000_000))
const creditRet = creditSale
  ? await safe('برگشت کامل با اعتبار خرید', () => salesService.createReturn({
      invoiceId: creditSale.id, full: false,
      lines: [{ saleItemId: itemsOf(creditSale.id)[0].id, qty: 1 }],
      refundMethod: RefundMethod.STORE_CREDIT, refundAmount: 1_000_000, userId, shiftId
    }))
  : null
const rCredit = await safe('گزارش بعد از برگشت اعتباری', () => reportOf())
if (rCredit?.totals) {
  const t = rCredit.totals
  eq('فروش کالا همان ۱M است (اعتبار فروش تازه نیست)', t.goodsTotal, 1_000_000)
  eq('جمع کل فروش همان ۱M است', t.grandTotal, 1_000_000)
  eq('ارزش برگشت ۱M جدا دیده می‌شود', t.returnedTotal, 1_000_000)
  eq('بازپرداخت نقد صفر است', t.refundCashTotal, 0)
  eq('اعتبار صادرشده بابت برگشت ۱M', t.storeCreditRefundTotal, 1_000_000)
  eq('پول فیزیکی کشو همان ۱M مانده', physicalOf(t), 1_000_000)
  eq('issued کل حداقل همان ۱M برگشتی است', t.storeCreditIssuedTotal >= 1_000_000, true)
}
const listCredit = await safe('فهرست برگشت بعد از اعتبار', () => salesService.returnList({ fromJalali: today, toJalali: today }))
const listRows = Array.isArray(listCredit) ? listCredit : (listCredit?.rows ?? [])
const creditRow = listRows[0]
truthy('فهرست برگشت شناسهٔ امن اعتبار دارد', !!creditRow?.storeCreditReference)
truthy('فهرست برگشت کد قابل‌مصرف ندارد', !Object.hasOwn(creditRow ?? {}, 'storeCreditCode'))
eq('مبلغ اعتبار ردیف برگشت ۱M', returnCreditAmountOf(creditRow ?? {}), 1_000_000)
eq('خروج نقد ردیف برگشت صفر', creditRow?.cashRefundAmount ?? 0, 0)

console.log('\n۳) برگشت نقدی — از کشو کم می‌شود (کنترل ضدسرقت)')
const cashSale = await safe('فروش ۱M نقد (مسیر نقد)', () => sale(1_000_000))
if (cashSale) {
  await safe('برگشت کامل نقدی', () => salesService.createReturn({
    invoiceId: cashSale.id, full: false,
    lines: [{ saleItemId: itemsOf(cashSale.id)[0].id, qty: 1 }],
    refundMethod: RefundMethod.CASH, refundAmount: 1_000_000, userId, shiftId
  }))
}
const rBoth = await safe('گزارش بعد از برگشت نقدی دوم', () => reportOf())
if (rBoth?.totals) {
  const t = rBoth.totals
  eq('دو فروش = ۲M کالا', t.goodsTotal, 2_000_000)
  eq('بازپرداخت نقد فقط مسیر نقد = ۱M', t.refundCashTotal, 1_000_000)
  eq('اعتبار صادرشده برگشتی همان ۱M اول است', t.storeCreditRefundTotal, 1_000_000)
  eq('پول فیزیکی = ۲M دریافتی − ۱M نقد برگشتی = ۱M', physicalOf(t), 1_000_000)
}

console.log('\n۴) ماه بعد: خرج بارکد — کشو عوض نمی‌شود، کسری نیست')
// دریافت مستقیم رکورد اصلی فقط برای آماده‌سازیِ مصرف بعدی این آزمون است؛
// در قرارداد گزارش، کد قابل‌مصرف عمداً وجود ندارد.
const code = creditRet ? seed.one('SELECT storeCreditCode FROM "SaleReturn" WHERE id = ?', creditRet.id)?.storeCreditCode : null
const redeemSale = code
  ? await safe('فروش ۱M فقط با بارکد اعتبار', () => salesService.create({
      userId, shiftId,
      lines: [{ variantId: variant(1_000_000), qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
      payments: [],
      storeCreditCode: code
    }))
  : null
const rRedeem = await safe('گزارش بعد از مصرف اعتبار', () => reportOf())
if (rRedeem?.totals) {
  const t = rRedeem.totals
  eq('فروش کالا +۱M بابت کالایی که واقعاً رفته', t.goodsTotal, 3_000_000)
  eq('مصرف اعتبار ۱M', t.storeCreditUsedTotal, 1_000_000)
  eq('پول فیزیکی کشو بعد از خرج بارکد همان ۱M است (کسری نیست)', physicalOf(t), 1_000_000)
  eq('مصرف اعتبار داخل دریافتی نقد نیست', t.receivedTotal, 2_000_000)
  const stories = rRedeem.accounting?.storeCredits?.usedStories ?? []
  const story = stories[0]
  truthy('جملهٔ کنترل امن برای اعتبار مصرف‌شده هست', !!story?.safeText)
  truthy('جمله تاریخ صدور را دارد', !!story?.issuedAtJalali && story.issuedAtJalali !== '—' && /در تاریخ/.test(String(story?.safeText ?? '')))
  truthy('جمله می‌گوید بابت برگشت از فروش بوده', /برگشت از فروش/.test(String(story?.safeText ?? '')))
  truthy('جمله می‌گوید مصرف شد', /مصرف شد/.test(String(story?.safeText ?? '')))
  truthy('داستان کنترل کد قابل‌مصرف ندارد', !Object.hasOwn(story ?? {}, 'code') && !Object.hasOwn(story ?? {}, 'text'))
  eq('علت صدور RETURN است نه تعویض', story?.reason, 'RETURN')
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
