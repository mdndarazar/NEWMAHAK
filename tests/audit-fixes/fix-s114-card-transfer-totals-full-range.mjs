/**
 * نشست ۱۱۴ · خوشه G/E · بند ۴-۴۶، ۴-۵۴
 *
 * باگ: `cardTransferService.list` (سقف ۵۰۰، حداکثر ۲۰۰۰) و `outOfSales` (سقف
 * ثابت ۵۰۰۰) جمع «در انتظار/پرداخت‌شده/اصلاحی/خالص» کارت‌به‌کارت مدیر را از
 * همان ردیف‌های بریده حساب می‌کردند؛ بازپرداخت کارت‌به‌کارت بعد از سقف بی‌صدا
 * از جمع حذف می‌شد و هیچ هشداری دیده نمی‌شد.
 *
 * بعد از رفع: جمع‌ها روی کل بازه (خواندن صفحه‌ای کامل)، فهرست با page/warnings.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s114-ctc-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cardTransferService } = await import('../../src/main/services/CardTransferService.ts')
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

const now = Date.now() - 30 * 60 * 1000
let i = 0
const add = (v) => seed.insert('CardTransferRequest', { returnId: 1, createdAt: now + i++, createdAtJalali: today, ...v })
// پرداخت‌شده‌ها قدیمی‌ترند؛ ترتیب نزولی آن‌ها را پشت سقف ۵۰۰/۵۰۰۰ می‌برد
for (let k = 0; k < 20; k++) add({ status: 'PAID', amount: 1_000, paidAmount: 1_000, paidAt: now + i })
for (let k = 0; k < 5100; k++) add({ status: 'PENDING', amount: 10 })
const total = i

const range = { fromJalali: today, toJalali: today }
const list = await cardTransferService.list(range)
eq('فهرست: جمع در انتظار روی کل بازه (۵۱۰۰ × ۱۰)', list.totals.pendingAmount, 51_000)
eq('فهرست: تعداد در انتظار روی کل بازه', list.totals.pendingCount, 5100)
eq('فهرست: پرداخت‌شده‌های قدیمی‌تر هم در جمع‌اند', list.totals.paidAmount, 20_000)
eq('فهرست: totalCount واقعی', list.page?.totalCount, total)
eq('فهرست: برش صریح اعلام می‌شود', list.page?.truncated, true)
eq('فهرست: هشدار فارسی «نمایش ۵۰۰ از ۵۱۲۰»', /نمایش ۵۰۰ از ۵۱۲۰/.test((list.warnings ?? []).join(' ')), true)

const out = await cardTransferService.outOfSales(range)
eq('خارج از فروش: پرداخت‌شده‌ی بعد از ردیف ۵۰۰۰ شمرده می‌شود', out.totals.paidAmount, 20_000)
eq('خارج از فروش: خالص جریان روی کل بازه', out.totals.netOutOfSalesFlow, 20_000)
eq('خارج از فروش: totalCount واقعی', out.page?.totalCount, total)
eq('خارج از فروش: هشدار برش صریح', (out.warnings ?? []).length > 0, true)

const filtered = await cardTransferService.list({ ...range, status: 'PAID' })
eq('فیلتر وضعیت روی جمع و شمارش هم اعمال می‌شود', filtered.page?.totalCount === 20 && filtered.totals.pendingCount === 0, true)
eq('فیلتر کامل هشدار ندارد', (filtered.warnings ?? ['x']).length, 0)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
