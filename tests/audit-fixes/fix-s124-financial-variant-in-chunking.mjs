/**
 * نشست ۱۲۴ · خوشه G · lookupهای واریانت خارج از چاپ/تخصیص.
 *
 * دو مسیر روی تعداد اقلامِ یک سندِ بزرگ، همه‌ی شناسه‌ها را در یک IN می‌فرستادند:
 * ۱) گیت هشدار موجودی که قبل از ثبت فروش اجرا می‌شود؛
 * ۲) خواندن اقلام فاکتور از دیتابیس برای enforce کردن محدودیت اعتبار خرید.
 *
 * این تست سقف SQLite/Prisma را عمداً روی ۵۰۰ شناسه می‌گذارد. قبل از رفع هر دو
 * مسیر crash می‌کنند؛ بعد از رفع باید همه‌ی ۵۰۱ قلم را بدون حدس یا برش برگردانند.
 * تست IPC/Prisma تولیدی و race چندپردازه‌ای همچنان جداگانه لازم است.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s124-financial-in-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { inventoryService } = await import('../../src/main/services/InventoryService.ts')
const { linesForInvoice } = await import('../../src/main/services/StoreCreditService.ts')
const { secondaryStockService } = await import('../../src/main/services/SecondaryStockService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const originalVariantFindMany = db.productVariant.findMany
db.productVariant.findMany = async (args = {}) => {
  const ids = args?.where?.id?.in
  if (Array.isArray(ids) && ids.length > 500) throw new Error('HARNESS: سقف IN واریانت برابر ۵۰۰ است')
  return originalVariantFindMany(args)
}

const productId = seed.product('کالاهای مالی بزرگ')
const variantIds = []
for (let i = 0; i < 501; i++) variantIds.push(seed.variant(productId, `ردیف-${i + 1}`))

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

let availability = null
let availabilityError = null
try {
  availability = await inventoryService.checkAvailability(variantIds.map((variantId) => ({ variantId, qty: 1 })))
} catch (error) {
  availabilityError = error
}
eq('گیت موجودی برای ۵۰۱ واریانت crash نمی‌کند', availabilityError, null)
eq(
  'هشدار کمبود برای آخرین واریانت هم حفظ می‌شود',
  availability?.some((text) => text.includes('ردیف-501')),
  true
)

const invoice = seed.invoice({ grandTotal: 501 })
for (const variantId of variantIds) seed.invoiceItem(invoice.id, { variantId, qty: 1, lineTotal: 1 })

let lines = null
let linesError = null
try {
  lines = await linesForInvoice(db, invoice.id)
} catch (error) {
  linesError = error
}
eq('خواندن اقلام فاکتور برای ۵۰۱ واریانت crash نمی‌کند', linesError, null)
eq('همه‌ی ۵۰۱ قلم برای enforce اعتبار باقی می‌مانند', lines?.length, 501)
eq('آخرین قلم هم در محدودیت اعتبار حاضر است', lines?.some((line) => line.variantId === variantIds[500]), true)

let central = null
let centralError = null
try {
  central = await secondaryStockService.coverShortage(
    db,
    variantIds.map((variantId) => ({ variantId, qty: 1 }))
  )
} catch (error) {
  centralError = error
}
eq('برداشت خودکار انبار مرکزی برای ۵۰۱ واریانت crash نمی‌کند', centralError, null)
eq('هشدار برداشت خودکار برای آخرین واریانت هم حفظ می‌شود', central?.warnings?.some((text) => text.includes('ردیف-501')), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
