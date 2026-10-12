/**
 * S370 — `sale:get` برای ویرایش فاکتور به renderer می‌رود، اما نباید به یک
 * مسیر افشای بارکدِ قابل‌مصرف اعتبار تبدیل شود.
 *
 * هم پرداختِ مصرف اعتبار (`reference`/`note`) و هم اعتبار صادرشده روی برگشت
 * در پاسخ خام وجود دارند؛ این تست DTO واقعی IPC را با یک کد ساخته‌شده در DB
 * می‌خواند و ثابت می‌کند credential و شناسهٔ داخلی به renderer نمی‌رسند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s370-sale-get-credit-redaction.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s370-sale-get-redact-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 37001, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { RefundMethod } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('فروشنده ۳۷۰')
const categoryId = seed.category('پوشاک')
const productId = seed.product('پیراهن تستی', categoryId)
const variantId = seed.variant(productId, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 40, salePrice = 1000 WHERE id = ?').run(variantId)
const cashMethodId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 60_000, userId
})

let ok = 0
const yes = (label, value) => {
  assert.equal(!!value, true, label)
  ok++
  console.log(`  ✓ ${label}`)
}
const line = { variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }

console.log('--- ۱. پرداختِ اعتبار، بارکد را در reference/note نگه می‌دارد ---')
const issued = await storeCreditService.issueManual({ amount: 1000, userId, managerPassword: PW })
const paymentCreditCode = String(sql.prepare('SELECT code FROM "StoreCredit" WHERE id = ?').get(issued.id)?.code ?? '')
yes('fixture یک کد اعتبار واقعی دارد', paymentCreditCode.length > 0)
const creditSale = await salesService.create({
  userId,
  shiftId,
  lines: [line],
  payments: [],
  storeCreditCode: paymentCreditCode,
  storeCreditIdempotencyKey: 'sale-get-redaction-370'
})
const rawPayment = sql.prepare('SELECT reference, note, storeCreditId FROM "Payment" WHERE invoiceId = ?').get(creditSale.id)
yes('رکورد داخلی عمداً بارکد را در reference نگه می‌دارد', String(rawPayment?.reference ?? '') === paymentCreditCode)
yes('رکورد داخلی به اعتبار وصل است', Number(rawPayment?.storeCreditId) === Number(issued.id))

console.log('--- ۲. اعتبار صادرشده در برگشت نیز در مدل اصلی باقی می‌ماند ---')
const cashSale = await salesService.create({
  userId,
  shiftId,
  lines: [line],
  payments: [{ methodId: cashMethodId, amount: 1000, destination: 'CASH' }]
})
const sourceItem = sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?').get(cashSale.id)
await salesService.createReturn({
  invoiceId: cashSale.id,
  userId,
  full: false,
  lines: [{ saleItemId: Number(sourceItem.id), qty: 1 }],
  refundMethod: RefundMethod.STORE_CREDIT
})
const rawReturn = sql.prepare('SELECT storeCreditCode, storeCreditId FROM "SaleReturn" WHERE invoiceId = ?').get(cashSale.id)
const returnCreditCode = String(rawReturn?.storeCreditCode ?? '')
yes('رکورد برگشت داخلی بارکد واقعی دارد', returnCreditCode.length > 0)

console.log('--- ۳. همان sale:get عمومی فقط DTO امن می‌دهد ---')
registerIpcHandlers()
const invoke = (id) => handlers.get(IPC.saleGet)({ sender }, { id })
const paymentView = await invoke(creditSale.id)
const shownPayment = paymentView?.data?.payments?.[0]
yes('IPC sale:get برای پرداخت اعتبار موفق است', paymentView?.ok === true)
yes('reference بارکد از پرداخت حذف شده است', !('reference' in shownPayment))
yes('note حاوی بارکد از پرداخت حذف شده است', !('note' in shownPayment))
yes('شناسهٔ داخلی اعتبار از پرداخت حذف شده است', !('storeCreditId' in shownPayment))
yes('DTO فقط نشانگر امن پرداخت اعتباری دارد', shownPayment?.storeCreditApplied === true)

const returnView = await invoke(cashSale.id)
const shownReturn = returnView?.data?.returns?.[0]
yes('IPC sale:get برای فاکتور برگشتی موفق است', returnView?.ok === true)
yes('بارکد اعتبار صادرشده در برگشت حذف شده است', !('storeCreditCode' in shownReturn))
yes('شناسهٔ اعتبار صادرشده در برگشت حذف شده است', !('storeCreditId' in shownReturn))
yes('DTO فقط نشانگر امن صدور اعتبار دارد', shownReturn?.storeCreditIssued === true)
yes('هیچ credential قابل‌مصرفی در view پرداخت نیست', !Object.values(shownPayment ?? {}).some((v) => String(v).includes(paymentCreditCode)))
yes('هیچ credential قابل‌مصرفی در view برگشت نیست', !Object.values(shownReturn ?? {}).some((v) => String(v).includes(returnCreditCode)))

console.log(`\nنتیجه: ${ok} موفق · ۰ ناموفق`)
