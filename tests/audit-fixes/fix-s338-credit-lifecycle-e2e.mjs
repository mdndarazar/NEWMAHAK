// @ts-check
/**
 * ماتریس واقعی چرخهٔ اعتبار خرید:
 * - صدور دستی مدیر، برگشت از فروش و تعویض کالا
 * - چندباره، یک‌بارمصرفِ بسته‌شونده و یک‌بارمصرف با ماندهٔ قابل‌مصرف
 * - انقضا/تمدید، تعلیق/فعال‌سازی و برگشت کاملِ فاکتورِ پرداخت‌شده با اعتبار
 *
 * کدهای قابل‌مصرف عمداً فقط از fixture داخلی خوانده می‌شوند؛ هیچ پاسخ عادی
 * سرویس نباید آن‌ها را برگرداند.
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s338-credit-lifecycle-e2e.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s338-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { financialInspectorService } = await import('../../src/main/services/financialInspectorService.ts')
const { DEFAULT_CREDIT_SETTINGS } = await import('../../src/shared/credit.ts')
const { RefundMethod } = await import('../../src/shared/enums.ts')
const { DEFAULT_MANAGER_PASSWORD, SETTING_KEYS } = await import('../../src/shared/receipt.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { toJalaliDate } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
/** فقط برای سنجش ریزبین read-only؛ هیچ نشست یا credential تولید نمی‌کنیم. */
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesReports]: false })
/**
 * تنظیم مدیر: «ناشی از تعویض/برگشت = ۰ روز» باید در هر دو مسیر واقعاً
 * به expiresAt=null برسد؛ نه این‌که fallback تاریخیِ returnCodeDays (۷ روز)
 * بی‌صدا روی یکی از مسیرها اعمال شود.
 */
const noExpiryExchangeRules = structuredClone(DEFAULT_CREDIT_SETTINGS)
noExpiryExchangeRules.types.EXCHANGE.days = 0
seed.creditSettings(noExpiryExchangeRules)
const userId = seed.user('مدیر تست چرخه اعتبار ۳۳۸')
const categoryId = seed.category('دسته چرخه اعتبار')
const productId = seed.product('کالای چرخه اعتبار', categoryId)
const cashMethod = seed.insert('PaymentMethod', { key: 'S338-CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'شیفت چرخه اعتبار', number: 1, dayJalali: today, openedAt: Date.now(), userId })
let variantSeq = 0
const variant = (price) => {
  const id = seed.variant(productId, `چرخه-${++variantSeq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = ?, salePrice = ? WHERE id = ?').run(100, price, id)
  return id
}
const credit = (id) => seed.one('SELECT * FROM "StoreCredit" WHERE id = ?', id)
const creditCode = (id) => seed.one('SELECT code FROM "StoreCredit" WHERE id = ?', id)?.code ?? null
const latestCredit = (where, ...params) => seed.one(`SELECT * FROM "StoreCredit" WHERE ${where} ORDER BY id DESC LIMIT 1`, ...params)
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const noCode = (row) => row && !Object.hasOwn(row, 'code') && !!row.id && !!row.publicReference
const errorOf = async (fn) => {
  try { await fn(); return null } catch (error) { return String(error?.message ?? error) }
}
const saleWithCredit = async (amount, code) => {
  const v = variant(amount)
  return salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: amount, discount: 0, tax: 0 }],
    payments: [],
    storeCreditCode: code,
    storeCreditIdempotencyKey: `s338-credit-${Date.now()}-${Math.random()}`
  })
}
const cashSale = async (amount) => {
  const v = variant(amount)
  return salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: amount, discount: 0, tax: 0 }],
    payments: [{ methodId: cashMethod, amount, destination: 'CASH' }]
  })
}
const fullyReturn = async (invoiceId, amount, refundMethod = RefundMethod.STORE_CREDIT) =>
  salesService.createReturn({
    invoiceId,
    full: false,
    lines: [{ saleItemId: itemsOf(invoiceId)[0].id, qty: 1 }],
    refundMethod,
    refundAmount: amount,
    userId,
    shiftId
  })

console.log('--- ۱. صدور دستی مدیر + چندباره تا سقف مبلغ ---')
const multiSafe = await storeCreditService.issueManual({
  amount: 1_000,
  multiUse: true,
  maxUses: 3,
  userId,
  managerPassword: DEFAULT_MANAGER_PASSWORD
})
assert.ok(noCode(multiSafe), 'صدور دستی فقط DTO امن برمی‌گرداند')
const multiCode = creditCode(multiSafe.id)
assert.ok(multiCode, 'fixture کد واقعی را دارد')
for (const amount of [400, 300]) await saleWithCredit(amount, multiCode)
let row = credit(multiSafe.id)
assert.equal(Number(row.usedAmount), 700)
assert.equal(Number(row.usedCount), 2)
assert.equal(row.status, 'PARTIALLY_USED')
await saleWithCredit(300, multiCode)
row = credit(multiSafe.id)
assert.equal(Number(row.usedAmount), 1_000)
assert.equal(Number(row.usedCount), 3)
assert.equal(row.status, 'USED')
console.log('  ✓ اعتبار چندباره در سه خرید، مبلغ/دفعات/وضعیت را درست نگه داشت')

console.log('--- ۲. یک‌بارمصرف بسته‌شونده و یک‌بارمصرف با مانده ---')
const burnSafe = await storeCreditService.issueManual({
  amount: 1_000,
  multiUse: false,
  carryRemainder: false,
  userId,
  managerPassword: DEFAULT_MANAGER_PASSWORD
})
const burnCode = creditCode(burnSafe.id)
await saleWithCredit(400, burnCode)
row = credit(burnSafe.id)
assert.equal(row.status, 'USED', 'کوپن یک‌بارمصرفِ بدون حفظ مانده بعد از مصرف جزئی بسته است')
assert.equal(Number(row.usedAmount), 400, 'سابقه مبلغ واقعی حفظ می‌شود')
assert.match(await errorOf(() => saleWithCredit(100, burnCode)) ?? '', /کامل مصرف شده|تمام شده/)

const carrySafe = await storeCreditService.issueManual({
  amount: 1_000,
  multiUse: false,
  carryRemainder: true,
  userId,
  managerPassword: DEFAULT_MANAGER_PASSWORD
})
const carryCode = creditCode(carrySafe.id)
await saleWithCredit(400, carryCode)
row = credit(carrySafe.id)
assert.equal(row.status, 'PARTIALLY_USED')
assert.equal(Number(row.usedAmount), 400)
await saleWithCredit(600, carryCode)
row = credit(carrySafe.id)
assert.equal(row.status, 'USED')
assert.equal(Number(row.usedAmount), 1_000)
console.log('  ✓ هر دو سیاست یک‌بارمصرف (بستن یا نگه‌داشتن مانده) اعمال شدند')

console.log('--- ۳. انقضا، تمدید/فعال‌سازی و تعلیق/فعال‌سازی ---')
const expiringSafe = await storeCreditService.issueManual({ amount: 500, days: 1, userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
const expiringCode = creditCode(expiringSafe.id)
sql.prepare('UPDATE "StoreCredit" SET expiresAt = ?, expiresAtJalali = ? WHERE id = ?')
  .run(Date.now() - 86_400_000, '۱۴۰۰/۰۱/۰۱', expiringSafe.id)
/**
 * ریزبین باید وضعیت مؤثر را نشان دهد، نه ستون خامِ ACTIVE؛ در غیر این صورت
 * مدیر روی کارت «منقضی» کلیک می‌کند ولی در شناسنامهٔ همان سند ACTIVE می‌بیند.
 */
const expiredSources = await financialInspectorService.sources({
  scope: { fromJalali: today, toJalali: today },
  key: 'storeCreditExpired'
})
const expiredSource = expiredSources.result?.sources.find((source) => source.ref.id === expiringSafe.id)
assert.ok(expiredSource, 'اعتبار تاریخ‌گذشته در ریزبین همان کارت منقضی دیده می‌شود')
const expiredDetail = await financialInspectorService.document({
  scope: { fromJalali: today, toJalali: today },
  key: 'storeCreditExpired',
  ref: expiredSource.ref
})
assert.equal(expiredDetail.detail?.creditValidity?.status, 'EXPIRED')
assert.equal(expiredDetail.detail?.creditValidity?.statusLabel, 'منقضی شد')
assert.equal(expiredDetail.detail?.creditValidity?.expiresAtJalali, '۱۴۰۰/۰۱/۰۱')
assert.equal(expiredDetail.detail?.creditValidity?.remaining, 500)
assert.equal(Object.hasOwn(expiredDetail.detail?.creditValidity ?? {}, 'code'), false, 'جزئیات انقضا هم کد قابل‌مصرف ندارد')

/** S343: کارت بازه‌ای نباید اعتبار منقضیِ سال‌های قبل را دوباره به بازهٔ امروز نسبت دهد. */
const expiresInRangeSafe = await storeCreditService.issueManual({ amount: 800, multiUse: true, maxUses: 2, userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
sql.prepare('UPDATE "StoreCredit" SET expiresAt = ?, expiresAtJalali = ?, usedAmount = ?, status = ? WHERE id = ?')
  .run(Date.now(), today, 300, 'PARTIALLY_USED', expiresInRangeSafe.id)
const rangeExpiredSources = await financialInspectorService.sources({
  scope: { fromJalali: today, toJalali: today },
  key: 'storeCreditExpiredInRange'
})
assert.equal(rangeExpiredSources.result?.totalAmount, 500, 'کارت بازه فقط ماندهٔ ۸۰۰−۳۰۰ با expiresAt امروز را می‌شمارد')
assert.ok(rangeExpiredSources.result?.sources.some((source) => source.ref.id === expiresInRangeSafe.id), 'سند با تاریخ انقضای داخل بازه دیده می‌شود')
assert.equal(rangeExpiredSources.result?.sources.some((source) => source.ref.id === expiringSafe.id), false, 'سند منقضیِ سال قبل در کارت بازهٔ امروز تکرار نمی‌شود')
assert.match(await errorOf(() => saleWithCredit(500, expiringCode)) ?? '', /تمام شده|مهلت/)
assert.match(
  await errorOf(() => storeCreditService.reactivate({
    id: expiringSafe.id,
    reason: 'تلاش بدون تمدید',
    userId,
    managerPassword: DEFAULT_MANAGER_PASSWORD
  })) ?? '',
  /تمدید/
)
const reactivated = await storeCreditService.reactivate({
  id: expiringSafe.id,
  extendDays: 7,
  reason: 'تمدید اعتبار منقضی در تست چرخه',
  userId,
  managerPassword: DEFAULT_MANAGER_PASSWORD
})
assert.ok(noCode(reactivated))
row = credit(expiringSafe.id)
assert.equal(row.status, 'ACTIVE')
assert.ok(Number(new Date(row.expiresAt).getTime()) > Date.now())
await storeCreditService.suspend({ id: expiringSafe.id, reason: 'توقف موقت تست', userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
assert.match(await errorOf(() => saleWithCredit(500, expiringCode)) ?? '', /معلق/)
await storeCreditService.reactivate({ id: expiringSafe.id, reason: 'رفع توقف موقت تست', userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
await saleWithCredit(500, expiringCode)
assert.equal(credit(expiringSafe.id).status, 'USED')
console.log('  ✓ انقضا بدون تمدید رد شد؛ تمدید و تعلیق/فعال‌سازی قابل استفاده ماندند')

console.log('--- ۴. مصرف کامل ← برگشت کامل ← فعال‌شدن همان اعتبار، دو بار پیاپی ---')
const reversibleSafe = await storeCreditService.issueManual({ amount: 1_000, userId, managerPassword: DEFAULT_MANAGER_PASSWORD })
const reversibleCode = creditCode(reversibleSafe.id)
for (let round = 1; round <= 2; round++) {
  const sale = await saleWithCredit(1_000, reversibleCode)
  assert.equal(credit(reversibleSafe.id).status, 'USED', `دور ${round}: اعتبار مصرف شد`)
  const returned = await fullyReturn(sale.id, 1_000)
  assert.equal(returned.fullyReturned, true)
  assert.equal(returned.reversedCreditRedemptions, 1, `دور ${round}: دفتر مصرف برگشت خورد`)
  assert.equal(returned.overpayAmount, 0, `دور ${round}: مصرف اعتبار، اضافه‌دریافت نقدی جعلی نساخت`)
  assert.equal(returned.overpayCredit, null, `دور ${round}: کد جایگزینِ اضافه‌دریافت صادر نشد`)
  row = credit(reversibleSafe.id)
  assert.equal(row.status, 'ACTIVE', `دور ${round}: همان اعتبار دوباره فعال شد`)
  assert.equal(Number(row.usedAmount), 0)
  assert.equal(Number(row.usedCount), 0)
}
console.log('  ✓ اعتبار مصرف‌شده با برگشت کامل فاکتور، دو بار پیاپی درست احیا شد (بدون کد جدید یا دوباره‌شماری)')

console.log('--- ۵. صدور از برگشت فروش و مصرف آن ---')
const returnSourceSale = await cashSale(900)
const returnResult = await fullyReturn(returnSourceSale.id, 900)
assert.equal(Object.hasOwn(returnResult, 'storeCreditCode'), false, 'پاسخ عادی برگشت، کد قابل‌مصرف ندارد')
assert.ok(noCode(returnResult.storeCredit), 'اعتبار برگشت فقط به‌شکل DTO امن برمی‌گردد')
const returnCredit = latestCredit('returnId = ?', returnResult.id)
assert.ok(returnCredit?.id, 'برگشت نقدیِ واقعی اعتبار جدید ساخت')
assert.equal(Number(returnCredit.amount), 900)
assert.equal(returnCredit.status, 'ACTIVE')
assert.equal(returnCredit.expiresAt, null, 'تنظیم ۰ روزِ تعویض، اعتبار صادرشده از برگشت را بدون انقضا ساخت')
assert.equal(returnCredit.issuedDays, null, 'اسنپ‌شات مدتِ اعتبار برگشت هم «بدون انقضا» ثبت شد')
await saleWithCredit(900, returnCredit.code)
assert.equal(credit(returnCredit.id).status, 'USED')
console.log('  ✓ اعتبار صادرشده از برگشت فروش قابل مصرف و تسویه‌کننده است')

console.log('--- ۶. صدور از تعویض کالا و مصرف آن ---')
const exchangeSourceSale = await cashSale(1_000)
const replacement = variant(600)
const exchange = await salesService.createExchange({
  invoiceId: exchangeSourceSale.id,
  lines: [{ saleItemId: itemsOf(exchangeSourceSale.id)[0].id, qty: 1 }],
  replacements: [{ variantId: replacement, qty: 1 }],
  refundMode: RefundMethod.STORE_CREDIT,
  userId,
  shiftId
})
assert.equal(Object.hasOwn(exchange, 'storeCreditCode'), false, 'پاسخ عادی تعویض، کد قابل‌مصرف ندارد')
assert.ok(noCode(exchange.storeCredit), 'اعتبار تعویض فقط به‌شکل DTO امن برمی‌گردد')
const exchangeCredit = latestCredit('exchangeInvoiceId = ?', exchange.exchangeInvoiceId)
assert.ok(exchangeCredit?.id, 'مابه‌التفاوت تعویض اعتبار ساخت')
assert.equal(Number(exchangeCredit.amount), 400)
assert.equal(exchangeCredit.status, 'ACTIVE')
assert.equal(exchangeCredit.expiresAt, null, 'تنظیم ۰ روزِ تعویض، اعتبار مابه‌التفاوت تعویض را هم بدون انقضا ساخت')
assert.equal(exchangeCredit.issuedDays, null, 'اسنپ‌شات مدتِ اعتبار تعویض هم «بدون انقضا» ثبت شد')
await saleWithCredit(400, exchangeCredit.code)
assert.equal(credit(exchangeCredit.id).status, 'USED')
console.log('  ✓ اعتبار مابه‌التفاوت تعویض قابل مصرف و تسویه‌کننده است')

console.log('\nنتیجه: تمام مسیرهای صدور/مصرف/برگشت/فعال‌سازی اعتبار به‌صورت end-to-end پاس شدند.')
