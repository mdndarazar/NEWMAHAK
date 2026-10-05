/**
 * نشست ۱۱۵/۱۱۶ · خوشه G · بند ۴-۴۶ و مدرک ضدسرقت انبار
 *
 * باگ: productService.movements با take: 300 ثابت بی‌صدا می‌برید و جمع ورود/
 * خروج و PENDING را از همان صفحه می‌ساخت. بعد از رفع، جمع‌ها روی کل دفتر،
 * page/warnings و newerDeltaSum روی پاسخ آرایه‌ای قرار می‌گیرند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s115-mov-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { productService } = await import('../../src/main/services/ProductService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
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

const pid = seed.insert('Product', { name: 'جین آبی' })
const vid = seed.insert('ProductVariant', { productId: pid, code: 'V1', barcode: 'B1', stock: 0 })
const other = seed.insert('ProductVariant', { productId: pid, code: 'V2', barcode: 'B2', stock: 0 })
const t0 = Date.now() - 10 * 24 * 60 * 60 * 1000
let i = 0
const mv = (variantId, delta, state = 'FINAL', reason = 'PURCHASE') =>
  seed.insert('StockMovement', { variantId, delta, reason, state, createdAt: t0 + i++ * 1000 })

mv(vid, 6000)
for (let k = 0; k < 50; k++) mv(vid, -1, 'PENDING', 'SALE')
for (let k = 0; k < 5949; k++) mv(vid, -1, 'FINAL', 'SALE')
mv(other, 999)
const N = 6000
const safe = async (arg) => {
  try {
    return await productService.movements(arg)
  } catch (e) {
    console.log(`  ! خطا: ${e.message}`)
    return Object.assign([], { page: undefined })
  }
}

const r = await safe({ variantId: vid })
eq('خروجی همچنان آرایه است', Array.isArray(r), true)
eq('جمع ورود روی کل دفتر', r.totals?.inTotal, 6000)
eq('جمع خروج روی کل دفتر', r.totals?.outTotal, -5999)
eq('حرکات موقت روی کل دفتر', r.totals?.pendingCount, 50)
eq('جمع خالص دفتر', r.totals?.net, 1)
eq('totalCount واقعی', r.page?.totalCount, N)
eq('صفحه‌ی پیش‌فرض ۵٬۰۰۰', r.length, 5000)
eq('برش صریح', r.page?.truncated, true)
eq('هشدار فارسی «نمایش ۵٬۰۰۰ از ۶٬۰۰۰»', /نمایش ۵٬?۰۰۰ از ۶٬?۰۰۰/.test((r.warnings ?? []).join(' ')), true)
eq('صفحه‌ی اول newerDeltaSum = ۰', r.newerDeltaSum, 0)
const p2 = await safe({ variantId: vid, skip: 5000 })
eq('صفحه‌ی دوم ۱٬۰۰۰ ردیف', p2.length, 1000)
eq('صفحه‌ی دوم newerDeltaSum = جمع ۵٬۰۰۰ حرکت جدیدتر', p2.newerDeltaSum, -5000)
eq('کالای دیگر در جمع نیست', p2.totals?.inTotal, 6000)
const legacy = await safe(vid)
eq('امضای قدیمی فقط variantId عددی', legacy.page?.totalCount, N)
eq('structured clone page/totals را نگه می‌دارد', structuredClone(r).totals?.pendingCount, 50)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
