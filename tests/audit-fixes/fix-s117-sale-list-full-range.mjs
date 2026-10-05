/**
 * نشست ۱۱۷ · خوشه G (بند ۴-۴۶)
 *
 * باگ: `salesService.list` (فهرست فاکتورهای عمده در صفحه‌ی «فاکتور فروش») با
 * `take: filter.take ?? 500` بی‌صدا می‌بُرید و UI «n فاکتور عمده · جمع …» را از
 * همان ۵۰۰ ردیف می‌ساخت؛ در ماه شلوغ جمع فروش عمده کمتر از واقعیت و بدون هشدار.
 * بعد از رفع (S117-4): خروجی همچنان آرایه است (سازگار با UI قدیمی) ولی `page`،
 * `warnings` و `totals { count, grandTotal }` روی کل where دارد؛ سقف/پیش‌فرض صفحه
 * ۵٬۰۰۰ با skip؛ UI جمع را از totals می‌خواند.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s117-sl-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

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

const now = Date.now() - 60 * 1000
const today = toJalaliDate(new Date(now))
const { db: raw } = db.$harness
raw.exec('BEGIN')
const N = 620
for (let i = 0; i < N; i++)
  seed.insert('SaleInvoice', { grandTotal: 1_000, status: 'FINAL', orderType: 'WHOLESALE', receiptNo: 30_000 + i, issuedAt: now, issuedAtJalali: today })
raw.exec('COMMIT')

const payload = {
  from: jalaliStartOfDay(today).toISOString(),
  to: jalaliEndOfDay(today).toISOString(),
  orderType: 'WHOLESALE'
}
const r = await salesService.list(payload)
eq('خروجی همچنان آرایه است', Array.isArray(r), true)
eq('همه‌ی ۶۲۰ فاکتور (نه ۵۰۰)', r.length, N)
eq('totals.count = ۶۲۰', r.totals?.count, N)
eq('totals.grandTotal = ۶۲۰٬۰۰۰', r.totals?.grandTotal, N * 1_000)
eq('page.truncated = false', r.page?.truncated, false)

const p = await salesService.list({ ...payload, take: 100, skip: 600 })
eq('صفحه‌ی آخر ۲۰ ردیف', p.length, 20)
eq('صفحه‌ی آخر: جمع همچنان کل بازه', p.totals?.grandTotal, N * 1_000)
eq('صفحه‌ی آخر: truncated', p.page?.truncated, true)
eq('صفحه‌ی آخر: هشدار فارسی', (p.warnings ?? []).some((w) => /۶۲۰/.test(w)), true)
const big = await salesService.list({ ...payload, take: 999_999 })
eq('سقف صفحه ۵٬۰۰۰', big.page?.take, 5000)

const ui = readFileSync(resolve('src/renderer/src/pages/SalesInvoice.tsx'), 'utf8')
eq('UI جمع را از totals می‌خواند، نه از reduce روی صفحه', /listTotals/.test(ui) && !/money\(rows\.reduce\(\(s, r\) => s \+ r\.grandTotal, 0\)\)/.test(ui), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
