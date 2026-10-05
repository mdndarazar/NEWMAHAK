/**
 * نشست ۱۲۵ · خوشه G · مسیرهای مالی باقی‌مانده‌ی SalesService.
 *
 * قبل از این رفع، purge/return/exchange چند lookup مستقیمِ واریانت داشتند و
 * یک فاکتور/تعویضِ پرقلم با بیش از ۵۰۰ شناسه از سقف پارامتر SQLite عبور می‌کرد.
 * این تست سقف را عمداً روی ۵۰۰ می‌گذارد و مسیر واقعی lookup برگشت را اجرا می‌کند؛
 * علاوه بر آن، قرارداد ساختاری همه‌ی مسیرهای ثبت‌شده را کنترل می‌کند تا یک
 * lookup مستقیم تازه به SalesService برنگردد.
 *
 * این تست هارنس است و جای Prisma Client تولیدی، typecheck، IPC یا Electron
 * واقعی را نمی‌گیرد.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s125-sales-variant-in-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const originalVariantFindMany = db.productVariant.findMany
db.productVariant.findMany = async (args = {}) => {
  const ids = args?.where?.id?.in
  if (Array.isArray(ids) && ids.length > 500) throw new Error('HARNESS: سقف IN واریانت برابر ۵۰۰ است')
  return originalVariantFindMany(args)
}

const source = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
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

eq(
  'helper مشترک lookup واریانت، همه‌ی chunkها را جمع می‌کند',
  /for \(const chunk of reportIdChunks\(ids\)\)/.test(source),
  true
)
eq(
  'lookupهای مسیرهای purge/return/exchange از helper مشترک عبور می‌کنند',
  (source.match(/loadProductVariantsByIds\((?:prisma|tx),/g) ?? []).length >= 6,
  true
)
eq(
  'lookup مستقیم با variantIds در SalesService باقی نمانده است',
  /productVariant\.findMany\(\{\s*where:\s*\{\s*id:\s*\{\s*in:\s*variantIds/.test(source),
  false
)

const productId = seed.product('کالای پرقلم برگشت')
const variantIds = []
for (let i = 0; i < 501; i++) variantIds.push(seed.variant(productId, `سایز-${i + 1}`))

const invoice = seed.invoice({ grandTotal: 501, status: 'SETTLED' })
db.$harness.db
  .prepare('UPDATE "SaleInvoice" SET returnCode = ?, returnCodeExpiresAt = ?, issuedAtJalali = ? WHERE id = ?')
  .run('S125501', Date.now() + 7 * 24 * 60 * 60 * 1000, '1405/06/03', invoice.id)
for (const variantId of variantIds) seed.invoiceItem(invoice.id, { variantId, qty: 1, lineTotal: 1 })

let lookup = null
let lookupError = null
try {
  lookup = await salesService.findByReturnCode('S125-501')
} catch (error) {
  lookupError = error
}
eq('خواندن lookup برگشت برای ۵۰۱ واریانت crash نمی‌کند', lookupError, null)
eq('همه‌ی ۵۰۱ قلم در lookup برگشت باقی می‌مانند', lookup?.items?.length, 501)
eq('آخرین قلم فاکتور در lookup برگشت حذف نمی‌شود', lookup?.items?.some((item) => item.variantId === variantIds[500]), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
