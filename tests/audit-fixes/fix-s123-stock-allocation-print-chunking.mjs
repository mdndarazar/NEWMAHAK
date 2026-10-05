/**
 * نشست ۱۲۳ · خوشه G · مقیاس تخصیص موجودی و چاپ.
 *
 * باگ: چند مسیر، شناسه‌های واریانت/فاکتور را مستقیم داخل یک `IN` می‌فرستادند.
 * روی SQLite/Prisma با فهرست بزرگ، ثبت عمده، خلاصه‌ی مبدأ روی رسید یا export
 * می‌توانست با سقف پارامتر crash کند و مدرک انبار/چاپ را ناقص بگذارد.
 *
 * این تست هارنس را عمداً روی سقف ۵۰۰ شناسه محدود می‌کند. قبل از رفع باید
 * مسیر preview و خلاصه‌ی رسید شکست بخورد؛ بعد از رفع همه‌ی lookupها باید
 * بدون برش و بدون خطا کامل شوند. تست Electron/چاپگر واقعی جداگانه هنوز لازم است.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s123-stock-print-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockAllocationService } = await import('../../src/main/services/StockAllocationService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const originalVariantFindMany = db.productVariant.findMany
const originalAllocationFindMany = db.saleItemStockAllocation.findMany
let largestVariantIn = 0
let largestInvoiceIn = 0

db.productVariant.findMany = async (args = {}) => {
  const ids = args?.where?.id?.in
  if (Array.isArray(ids)) {
    largestVariantIn = Math.max(largestVariantIn, ids.length)
    if (ids.length > 500) throw new Error('HARNESS: سقف IN واریانت برابر ۵۰۰ است')
  }
  return originalVariantFindMany(args)
}

db.saleItemStockAllocation.findMany = async (args = {}) => {
  const ids = args?.where?.invoiceId?.in
  if (Array.isArray(ids)) {
    largestInvoiceIn = Math.max(largestInvoiceIn, ids.length)
    if (ids.length > 500) throw new Error('HARNESS: سقف IN فاکتور برابر ۵۰۰ است')
  }
  return originalAllocationFindMany(args)
}

const productId = seed.product('کالاهای تخصیص بزرگ')
const variantIds = []
for (let i = 0; i < 501; i++) variantIds.push(seed.variant(productId, `سایز ${i + 1}`))

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

let preview = null
let previewError = null
try {
  preview = await stockAllocationService.preview({
    lines: variantIds.map((variantId) => ({ variantId, qty: 1 }))
  })
} catch (error) {
  previewError = error
}
eq('پیش‌نمایش ۵۰۱ واریانت crash نمی‌کند', previewError, null)
eq('هر ۵۰۱ واریانت در پیش‌نمایش می‌ماند', preview?.lines?.length, 501)
eq('آخرین واریانت از chunk دوم خوانده می‌شود', preview?.lines?.some((row) => row.variantId === variantIds[500]), true)

const invoice = seed.invoice({ receiptNo: 123_501 })
for (const variantId of variantIds) {
  const saleItemId = seed.invoiceItem(invoice.id, { variantId, qty: 1, lineTotal: 1_000 })
  seed.insert('SaleItemStockAllocation', {
    invoiceId: invoice.id,
    saleItemId,
    variantId,
    sourceKind: 'STORE',
    qty: 1,
    balanceAfter: 0
  })
}

let summary = null
let summaryError = null
try {
  summary = await stockAllocationService.summaryOf(invoice.id)
} catch (error) {
  summaryError = error
}
eq('خلاصه‌ی مبدأ رسید با ۵۰۱ واریانت crash نمی‌کند', summaryError, null)
eq('همه‌ی ۵۰۱ ردیف در خلاصه‌ی مبدأ باقی می‌مانند', summary?.groups?.[0]?.rows?.length, 501)

let manyInvoiceSummary = null
let manyInvoiceError = null
try {
  manyInvoiceSummary = await stockAllocationService.summaryForInvoices(
    Array.from({ length: 501 }, (_, i) => 700_000 + i)
  )
} catch (error) {
  manyInvoiceError = error
}
eq('خلاصه‌ی export با ۵۰۱ شناسه‌ی فاکتور crash نمی‌کند', manyInvoiceError, null)
eq('export برای فاکتورهای بدون تخصیص خروجی جعلی نمی‌سازد', Object.keys(manyInvoiceSummary ?? {}).length, 0)
eq('هیچ lookup واریانت بیش از ۵۰۰ شناسه ندارد', largestVariantIn <= 500, true)
eq('هیچ lookup فاکتور بیش از ۵۰۰ شناسه ندارد', largestInvoiceIn <= 500, true)

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const printSource = readFileSync(resolve(root, 'src/main/services/PrintService.ts'), 'utf8')
eq('چاپ helper مشترک chunk واریانت دارد', /PRINT_VARIANT_IN_CHUNK\s*=\s*500/.test(printSource), true)
eq(
  'چاپ helper را برای رسید فروش و برگشت مصرف می‌کند',
  (printSource.match(/loadPrintVariantsByIds\(variantIds\)/g) ?? []).length >= 2,
  true
)
eq('چاپ دیگر IN مستقیمِ کل variantIds ندارد', !/where:\s*\{\s*id:\s*\{\s*in:\s*variantIds/.test(printSource), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
