/**
 * نشست ۱۱۴ · خوشه A/G · بند ۴-۴۶ و ۴-۹
 *
 * باگ: `cashMovementService.list` ردیف‌ها را با سقف ۵۰۰ (حداکثر ۵۰۰۰) می‌خواند و
 * جمع‌های واریز/برداشت/بازپرداخت/موجودی اول را از *همان ردیف‌های بریده* حساب
 * می‌کرد. در بازه‌ی شلوغ، برداشت‌ها و بازپرداخت‌های نقدی بعد از ردیف ۵۰۰ بی‌صدا
 * از جمع حذف می‌شدند؛ یعنی دقیقاً همان خروجی‌هایی که دزدی را نشان می‌دهند.
 * فهرست گردش در پنل بستن صندوق هم بدون هیچ هشداری ناقص بود.
 *
 * بعد از رفع: جمع‌ها با groupBy روی کل بازه، ردیف‌ها با page/warnings فارسی.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s114-mv-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
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

const base = Date.now() - 60 * 60 * 1000
const add = (type, amount, i) =>
  seed.insert('CashMovement', { type, amount, occurredAt: base + i * 1000, occurredAtJalali: today })

let i = 0
add('OPENING_FLOAT', 1_000_000, i++)
for (let k = 0; k < 520; k++) add('DEPOSIT', 1_000, i++)
// ۳۰ برداشت و ۱۰ بازپرداخت نقدی *بعد از* ردیف ۵۰۰ — قبلاً بی‌صدا حذف می‌شدند
for (let k = 0; k < 30; k++) add('WITHDRAWAL', 50_000, i++)
for (let k = 0; k < 10; k++) add('RETURN_REFUND', 20_000, i++)
const total = i

const res = await cashMovementService.list({ fromJalali: today, toJalali: today })
eq('جمع موجودی اول روی کل بازه', res.totals.openingFloat, 1_000_000)
eq('جمع واریز روی کل بازه (۵۲۰ × ۱٬۰۰۰)', res.totals.deposits, 520_000)
eq('جمع برداشت بعد از ردیف ۵۰۰ هم شمرده می‌شود', res.totals.withdrawals, 1_500_000)
eq('جمع بازپرداخت نقدی بعد از ردیف ۵۰۰ هم شمرده می‌شود', res.totals.refunds, 200_000)
eq('totalCount واقعی گردش‌ها', res.page?.totalCount, total)
eq('با پیش‌فرض ۵۰۰ ردیف، برش صریح اعلام می‌شود', res.page?.truncated, true)
eq('هشدار فارسی برش گردش صندوق', /نمایش ۵۰۰ از ۵۶۱/.test((res.warnings ?? []).join(' ')), true)
eq('هشدار می‌گوید جمع‌ها روی کل بازه‌اند', /کل بازه/.test((res.warnings ?? []).join(' ')), true)

const all = await cashMovementService.list({ fromJalali: today, toJalali: today, take: 5000 })
eq('با take=5000 همه‌ی ردیف‌ها می‌آیند', all.rows.length, total)
eq('وقتی کامل است هشدار ندارد', (all.warnings ?? ['x']).length, 0)
eq('جمع‌ها به اندازه‌ی صفحه وابسته نیستند', JSON.stringify(all.totals), JSON.stringify(res.totals))

const p2 = await cashMovementService.list({ fromJalali: today, toJalali: today, skip: 500 })
eq('صفحه‌ی دوم ۶۱ ردیف دارد', p2.rows.length, 61)
eq('صفحه‌ی دوم برش ندارد', p2.page?.truncated, false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
