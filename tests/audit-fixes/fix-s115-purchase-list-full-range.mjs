/**
 * نشست ۱۱۵ · خوشه G · بند ۴-۴۶ (و پیش‌نیاز ۴-۴۴ سود)
 *
 * باگ: `purchaseService.list` با `take: 500` ثابت بی‌صدا می‌برید و پنل «فاکتور
 * خرید» جمع «کالا/تخفیف/کل» را از همان ۵۰۰ ردیف بریده می‌ساخت؛ خرید بعد از ردیف
 * ۵۰۰ از جمع خرید بازه حذف می‌شد (سود/هزینه‌ی خرید کمتر از واقعی) و هیچ هشداری
 * دیده نمی‌شد.
 *
 * بعد از رفع: خروجی همچنان آرایه است (سازگاری)، ولی `page` (totalCount/truncated)،
 * `warnings` فارسی و `totals` روی کل بازه (aggregate با همان where) دارد؛
 * پیش‌فرض و سقف هر صفحه ۵٬۰۰۰ ردیف؛ `skip` برای صفحه‌ی بعد.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s115-pur-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { purchaseService } = await import('../../src/main/services/PurchaseService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
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

const sup = seed.insert('Supplier', { name: 'تامین‌کننده الف', code: 'S1' })
const sup2 = seed.insert('Supplier', { name: 'تامین‌کننده ب', code: 'S2' })
const base = Date.now() - 60 * 60 * 1000
// ۶۰۰۰ فاکتور خرید؛ ۱۰ فاکتور بزرگِ قدیمی‌تر (invoiceNo کوچک) پشت سقف ۵۰۰ می‌افتند
let no = 0
for (let k = 0; k < 10; k++)
  seed.insert('PurchaseInvoice', { invoiceNo: ++no, supplierId: sup2, issuedAt: base + no, issuedAtJalali: today, goodsTotal: 1_000_000, discountTotal: 100_000, grandTotal: 900_000, paidTotal: 900_000 })
for (let k = 0; k < 5990; k++)
  seed.insert('PurchaseInvoice', { invoiceNo: ++no, supplierId: sup, issuedAt: base + no, issuedAtJalali: today, goodsTotal: 10, discountTotal: 0, grandTotal: 10, paidTotal: 10 })

const from = new Date(base - 1000).toISOString()
const to = new Date(Date.now() + 1000).toISOString()

const r = await purchaseService.list({ from, to })
eq('خروجی همچنان آرایه است', Array.isArray(r), true)
eq('جمع کل روی کل بازه (۱۰×۹۰۰٬۰۰۰ + ۵۹۹۰×۱۰)', r.totals?.grandTotal, 9_000_000 + 59_900)
eq('جمع کالا روی کل بازه', r.totals?.goodsTotal, 10_000_000 + 59_900)
eq('جمع تخفیف روی کل بازه', r.totals?.discountTotal, 1_000_000)
eq('تعداد واقعی فاکتورها', r.totals?.count, 6000)
eq('totalCount واقعی', r.page?.totalCount, 6000)
eq('صفحه‌ی پیش‌فرض ۵٬۰۰۰ ردیف (بند ۴-۴۶)', r.length, 5000)
eq('برش صریح اعلام می‌شود', r.page?.truncated, true)
eq('هشدار فارسی «نمایش ۵٬۰۰۰ از ۶٬۰۰۰»', /نمایش ۵٬?۰۰۰ از ۶٬?۰۰۰/.test((r.warnings ?? []).join(' ')), true)

const cl = structuredClone(r)
eq('page/totals از structured clone (IPC الکترون) عبور می‌کند', cl.page?.totalCount === 6000 && cl.totals?.grandTotal === 9_059_900, true)

const p2 = await purchaseService.list({ from, to, skip: 5000 })
eq('صفحه‌ی دوم ۱٬۰۰۰ ردیف باقی‌مانده', p2.length, 1000)
eq('صفحه‌ی دوم شامل فاکتورهای بزرگ قدیمی است', p2.some((x) => x.grandTotal === 900_000), true)
eq('جمع صفحه‌ی دوم هم کل بازه است، نه جمع صفحه', p2.totals?.grandTotal, 9_059_900)

const big = await purchaseService.list({ from, to, take: 999_999 })
eq('take بزرگ‌تر از سقف به ۵٬۰۰۰ محدود می‌شود', big.length, 5000)

const f = await purchaseService.list({ from, to, supplierId: sup2 })
eq('فیلتر تامین‌کننده روی جمع هم اعمال می‌شود', f.totals?.grandTotal, 9_000_000)
eq('فیلتر کامل هشدار ندارد', (f.warnings ?? ['x']).length, 0)
eq('فیلتر کامل truncated=false', f.page?.truncated, false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
