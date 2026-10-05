/**
 * نشست ۱۲۰ · خوشه G · انبارگردانی
 *
 * باگ: گزارش مغایرت، شناسه‌ی همه‌ی کالاهای شمارش‌شده را در یک `IN` می‌فرستاد.
 * روی SQLite/Prisma با مجموعه‌ی بزرگ از سقف پارامتر عبور می‌کند و کل مدرک
 * انبارگردانی را با خطا می‌خواباند.
 *
 * تست: هارنس را طوری محدود می‌کنیم که هر `IN` بیشتر از ۵۰۰ شناسه را رد کند؛
 * گزارش ۵۰۱ کالا باید قبل از رفع fail و بعد از chunk شدن pass شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s120-stockcount-in-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const originalFindMany = db.productVariant.findMany
db.productVariant.findMany = async (args = {}) => {
  const ids = args?.where?.id?.in
  if (Array.isArray(ids) && ids.length > 500) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است')
  return originalFindMany(args)
}

const now = Date.now() - 60_000
const today = toJalaliDate(new Date(now))
const productId = seed.product('کالاهای شمارش بزرگ')
const sessionId = seed.insert('StockCountSession', { countedAt: now, countedAtJalali: today })
const variantIds = []
for (let i = 0; i < 501; i++) {
  const variantId = seed.variant(productId, String(i + 1))
  variantIds.push(variantId)
  seed.insert('StockCountItem', {
    sessionId,
    variantId,
    countedQty: 0,
    systemQty: 0,
    diffQty: 0
  })
}

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

let report = null
let error = null
try {
  report = await stockCountService.discrepancy({ fromJalali: today, toJalali: today })
} catch (e) {
  error = e
}

eq('گزارش مغایرت با ۵۰۱ کالا crash نمی‌کند', error, null)
eq('هر ۵۰۱ کالای شمارش‌شده در گزارش می‌ماند', report?.rows?.length, 501)
eq('شناسه‌ی آخرین کالا هم از chunk عبور می‌کند', report?.rows?.some((r) => r.variantId === variantIds[500]), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
