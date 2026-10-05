/**
 * نشست ۱۱۹ · خوشه G · انبارگردانی
 *
 * باگ: فرم شمارش کالاها و سابقه‌ی جلسه‌ها سقف داشتند، اما تعداد کل و هشدار
 * نداشتند؛ بنابراین بخشی از کالاها/جلسه‌های مدرک ضدسرقت بی‌صدا دیده نمی‌شد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s119-stockcount-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const now = Date.now()
const productId = seed.product('کالای تست انبارگردانی')
for (let i = 0; i < 401; i++) seed.variant(productId, `سایز ${i + 1}`)
for (let i = 0; i < 205; i++) {
  seed.insert('StockCountSession', {
    countedAt: now + i,
    countedAtJalali: '1405/07/02',
    countedAtTime: '12:00:00'
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
const truthy = (label, value) => eq(label, !!value, true)

const variants = await stockCountService.variants({ take: 400 })
eq('کالاهای شمارش: صفحه‌ی اول ۴۰۰ ردیف دارد', variants.length, 400)
eq('کالاهای شمارش: totalCount واقعی ۴۰۱ است', variants.page?.totalCount, 401)
eq('کالاهای شمارش: برش صریح است', variants.page?.truncated, true)
truthy('کالاهای شمارش: هشدار فارسی دارد', (variants.warnings ?? []).some((w) => /نمایش/.test(w)))
const variantsLast = await stockCountService.variants({ take: 400, skip: 400 })
eq('کالاهای شمارش: صفحه‌ی آخر یک ردیف دارد', variantsLast.length, 1)
eq('کالاهای شمارش: صفحه‌ی آخر برش ندارد', variantsLast.page?.truncated, false)

const sessions = await stockCountService.list()
eq('سابقه‌ی شمارش: صفحه‌ی اول ۲۰۰ ردیف دارد', sessions.length, 200)
eq('سابقه‌ی شمارش: totalCount واقعی ۲۰۵ است', sessions.page?.totalCount, 205)
eq('سابقه‌ی شمارش: برش صریح است', sessions.page?.truncated, true)
truthy('سابقه‌ی شمارش: هشدار فارسی دارد', (sessions.warnings ?? []).some((w) => /نمایش/.test(w)))
const sessionsLast = await stockCountService.list({ take: 50, skip: 200 })
eq('سابقه‌ی شمارش: صفحه‌ی آخر پنج ردیف دارد', sessionsLast.length, 5)
eq('سابقه‌ی شمارش: صفحه‌ی آخر برش ندارد', sessionsLast.page?.truncated, false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
