/**
 * PUR-002 — تخفیف و مبلغ پرداختی خرید، مثل قیمت/تعداد ردیف، فقط ریالِ صحیحِ
 * نامنفی هستند. مقدار اعشاری، متن یا خارج از safe-integer نباید حتی پیش از گیت
 * رمز یک سند/حرکت موجودی نیمه‌کاره بسازد.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-pur-002-purchase-total-integers.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-pur002-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { purchaseService } = await import('../../src/main/services/PurchaseService.ts')
const { SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const db = harnessClient()
const seed = makeSeeder(db)

let ok = 0
let bad = 0
const check = (label, value, detail = '') => {
  if (value) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const rejects = async (call) => {
  try {
    await call()
    return null
  } catch (e) {
    return String(e?.message ?? e)
  }
}

seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.purchase]: false })
const product = seed.product('کالای آزمون PUR-002', seed.category('دسته PUR-002'))
const variantId = seed.insert('ProductVariant', {
  productId: product,
  code: 'PUR-002',
  barcode: 'PUR-002',
  salePrice: 2_000_000,
  purchasePrice: 0,
  stock: 0
})
const base = (extra = {}) => ({
  settlementType: 'CASH',
  lines: [{ variantId, qty: 2, unitPrice: 1_000_000 }],
  ...extra
})
const invoiceCount = () => seed.count('PurchaseInvoice')
const stock = () => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', variantId)?.stock)

const beforeCount = invoiceCount()
let error = await rejects(() => purchaseService.create(base({ discountTotal: 0.5 })))
check('create: تخفیف اعشاری رد شد', /تخفیف.*عدد صحیح/.test(error ?? ''))
check('create: تخفیف اعشاری هیچ فاکتور/موجودی نساخت', invoiceCount() === beforeCount && stock() === 0)

error = await rejects(() => purchaseService.create(base({ paidTotal: '900000' })))
check('create: مبلغ پرداختی متنی رد شد', /مبلغ پرداخت.*عدد صحیح/.test(error ?? ''))
check('create: مبلغ پرداختی متنی هیچ فاکتور/موجودی نساخت', invoiceCount() === beforeCount && stock() === 0)

error = await rejects(() => purchaseService.create(base({ discountTotal: Number.MAX_SAFE_INTEGER + 1 })))
check('create: تخفیف خارج از safe-integer رد شد', /تخفیف.*عدد صحیح/.test(error ?? ''))

const invoice = await purchaseService.create(base({ discountTotal: 100_000, paidTotal: 900_000 }))
const invoiceId = Number(invoice.id)
let stored = await db.purchaseInvoice.findUnique({ where: { id: invoiceId } })
check('create: مبلغ‌های صحیح ثبت شدند', stored?.goodsTotal === 2_000_000 && stored?.discountTotal === 100_000 && stored?.grandTotal === 1_900_000 && stored?.paidTotal === 900_000)
check('create: موجودی فقط در مسیر صحیح افزایش یافت', stock() === 2)

error = await rejects(() => purchaseService.update({ ...base({ id: invoiceId, discountTotal: 10.25, paidTotal: 1_000_000 }) }))
check('update: تخفیف اعشاری رد شد', /تخفیف.*عدد صحیح/.test(error ?? ''))
stored = await db.purchaseInvoice.findUnique({ where: { id: invoiceId } })
check('update: رد تخفیف اعشاری سند و موجودی را دست‌نخورده گذاشت', stored?.discountTotal === 100_000 && stored?.paidTotal === 900_000 && stock() === 2)

error = await rejects(() => purchaseService.update({ ...base({ id: invoiceId, discountTotal: 0, paidTotal: 1.5 }) }))
check('update: مبلغ پرداختی اعشاری رد شد', /مبلغ پرداخت.*عدد صحیح/.test(error ?? ''))
stored = await db.purchaseInvoice.findUnique({ where: { id: invoiceId } })
check('update: رد مبلغ اعشاری نیز سند را دست‌نخورده گذاشت', stored?.discountTotal === 100_000 && stored?.paidTotal === 900_000 && stock() === 2)

console.log(`\nنتیجه PUR-002: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
