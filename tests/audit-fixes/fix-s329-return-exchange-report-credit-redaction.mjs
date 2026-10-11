/**
 * ===========================================================================
 * نشست ۳۲۹ — redaction اعتبارِ گزارش برگشت و تعویض
 *
 * کد اعتبار خرید credential قابل‌مصرف است. گزارش‌های عادی، A4، Excel و IPCهای
 * گزارش فقط شناسهٔ امن و غیرقابل‌مصرف می‌گیرند. رکورد اصلی برای حسابداری و
 * چاپ سند در main حفظ می‌شود، اما هرگز از DTO گزارش نشت نمی‌کند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s329-return-exchange-report-credit-redaction.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s329-report-credit-redaction-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const source = (relative) => readFileSync(resolve(root, relative), 'utf8')
const reports = source('src/renderer/src/pages/SalesReports.tsx')
const types = source('src/shared/types.ts')
const sales = source('src/main/services/SalesService.ts')
const print = source('src/main/services/PrintService.ts')
const staff = source('src/main/services/StaffReportService.ts')
const ledger = source('src/main/services/SalesLedger.ts')

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
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}
const rowsOf = (value) => Array.isArray(value) ? value : (value?.rows ?? [])
const noRedeemableCode = (label, row) => {
  truthy(`${label}: فیلد کد قابل‌مصرف ندارد`, !Object.hasOwn(row ?? {}, 'storeCreditCode'))
  truthy(`${label}: شناسهٔ امن دارد`, /^اعتبار #\d+$/.test(String(row?.storeCreditReference ?? '')))
  truthy(`${label}: کد قابل‌مصرف در مقدارها نیست`, !Object.values(row ?? {}).some((value) => /^CR\d{4,}$/i.test(String(value ?? ''))))
}

console.log('\n۰) قرارداد و مسیرهای خروجیِ گزارش')
const exchangeType = types.slice(types.indexOf('export interface ExchangeReportRow'), types.indexOf('export interface ReturnListRow'))
const returnType = types.slice(types.indexOf('export interface ReturnListRow'), types.indexOf('export interface ShiftDetailFilter'))
const exchangeList = sales.slice(sales.indexOf('async exchangeList'), sales.indexOf('async exchangeGet'))
const returnList = sales.slice(sales.indexOf('async returnList'), sales.indexOf('async shiftDetail'))
truthy('ExchangeReportRow کد ندارد و شناسهٔ امن دارد', !/storeCreditCode/.test(exchangeType) && /storeCreditReference/.test(exchangeType))
truthy('ReturnListRow کد ندارد و شناسهٔ امن دارد', !/storeCreditCode/.test(returnType) && /storeCreditReference/.test(returnType))
truthy('exchangeList کد را به DTO گزارش نمی‌فرستد', !/storeCreditCode/.test(exchangeList) && /storeCreditReference/.test(exchangeList))
truthy('returnList کد را به DTO گزارش نمی‌فرستد', !/storeCreditCode/.test(returnList) && /storeCreditReference/.test(returnList))
truthy('جدول/A4/Excel گزارش فروش به فیلد امن وصل‌اند', !/storeCreditCode/.test(reports) && /storeCreditReference/.test(reports))
truthy('گزارش عملکرد و دفتر رویداد کد را نمی‌فرستند', !/storeCreditCode/.test(staff) && !/storeCreditCode/.test(ledger))
truthy('چاپ سند فقط در main کد را مستقیماً از رکورد اعتبار می‌خواند', /storeCreditCode: credit\?\.code \?\? null/.test(print) && !/row\.storeCreditCode/.test(print))

const userId = seed.user('مدیر تست گزارش امن اعتبار')
const categoryId = seed.category('پوشاک')
const productId = seed.product('کت', categoryId)
const cashId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3_600_000, userId })
let variantSeq = 0
const variant = (price) => {
  const id = seed.variant(productId, `سایز ${++variantSeq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const createPaidSale = async (price) => salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: variant(price), qty: 1, unitPrice: price, discount: 0, tax: 0 }],
  payments: [{ methodId: cashId, amount: price, destination: 'CASH' }]
})
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)

console.log('\n۱) گزارش برگشت: مبلغ و ردیابی می‌مانند، credential حذف است')
const returnSale = await safe('فروش برای برگشت', () => createPaidSale(1_000_000))
const creditReturn = returnSale
  ? await safe('برگشت با اعتبار خرید', () => salesService.createReturn({
      invoiceId: returnSale.id,
      full: false,
      lines: [{ saleItemId: itemsOf(returnSale.id)[0].id, qty: 1 }],
      refundMethod: RefundMethod.STORE_CREDIT,
      refundAmount: 1_000_000,
      userId,
      shiftId
    }))
  : null
const returnRows = await safe('فهرست گزارش برگشت', () => salesService.returnList({ fromJalali: today, toJalali: today }))
const returnRow = rowsOf(returnRows).find((r) => r.id === creditReturn?.id)
noRedeemableCode('گزارش برگشت', returnRow)
eq('گزارش برگشت مبلغ اعتبار را نگه می‌دارد', Number(returnRow?.refundAmount ?? 0), 1_000_000)
const persistedReturn = creditReturn ? seed.one('SELECT storeCreditCode, storeCreditId FROM "SaleReturn" WHERE id = ?', creditReturn.id) : null
eq('رکورد حسابداریِ برگشت همچنان کد را نگه می‌دارد', typeof persistedReturn?.storeCreditCode, 'string')
eq('شناسهٔ امن گزارش با شناسهٔ رکورد یکی است', returnRow?.storeCreditReference, persistedReturn?.storeCreditId ? `اعتبار #${persistedReturn.storeCreditId}` : null)

console.log('\n۲) گزارش تعویض و exchangeGet: مبلغ و ردیابی می‌مانند، credential حذف است')
const exchangeSale = await safe('فروش برای تعویض', () => createPaidSale(1_000_000))
const exchange = exchangeSale
  ? await safe('تعویض با اعتبار خرید', () => salesService.createExchange({
      invoiceId: exchangeSale.id,
      lines: [{ saleItemId: itemsOf(exchangeSale.id)[0].id, qty: 1 }],
      replacements: [{ variantId: variant(600_000), qty: 1, unitPrice: 600_000, discount: 0, tax: 0 }],
      refundMode: 'STORE_CREDIT',
      userId,
      shiftId
    }))
  : null
const exchangeRows = await safe('فهرست گزارش تعویض', () => salesService.exchangeList({ fromJalali: today, toJalali: today }))
const exchangeRow = rowsOf(exchangeRows).find((r) => r.returnId === exchange?.returnId)
noRedeemableCode('گزارش تعویض', exchangeRow)
eq('گزارش تعویض مبلغ اعتبار را نگه می‌دارد', Number(exchangeRow?.storeCreditAmount ?? 0), 400_000)
const exchangeDetail = exchange?.returnId ? await safe('جزئیات گزارش تعویض', () => salesService.exchangeGet({ id: exchange.returnId })) : null
noRedeemableCode('exchangeGet', exchangeDetail)
const persistedExchange = exchange?.returnId ? seed.one('SELECT storeCreditCode, storeCreditId FROM "SaleReturn" WHERE id = ?', exchange.returnId) : null
eq('رکورد حسابداریِ تعویض همچنان کد را نگه می‌دارد', typeof persistedExchange?.storeCreditCode, 'string')
eq('شناسهٔ امن تعویض با شناسهٔ رکورد یکی است', exchangeRow?.storeCreditReference, persistedExchange?.storeCreditId ? `اعتبار #${persistedExchange.storeCreditId}` : null)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
