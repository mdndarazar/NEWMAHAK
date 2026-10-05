/**
 * نشست ۱۱۷ · خوشه G (+ بند ۴-۵۳ «وصول نسیه‌ی دوره‌ی قبل» و ۴-۴۶ «صفحه‌بندی واقعی، نه سقف بی‌صدا»)
 *
 * باگ: `salesService.creditList` (تب «نسیه» گزارشات فروش) فاکتورها را با
 * `take: filter.take ?? 3000` و پرداخت‌های «تسویه‌ی نسیه‌ی بازه‌های قبل» را با
 * `take: 2000` بی‌صدا می‌بُرید و جمع‌ها (باقی‌مانده‌ی بدهی، دریافت‌شده،
 * priorSettlementTotal) را از همان ردیف‌های بریده می‌ساخت. در ماه شلوغ، بدهی و
 * وصول نسیه‌ی قبلی کمتر از واقعیت نشان داده می‌شد و هیچ هشداری نبود؛ نوار
 * reportLimits هم ادعا می‌کرد «جمع‌ها روی کل بازه‌اند».
 * بعد از رفع (S117-2): همه‌ی فاکتورها/پرداخت‌های بازه خوانده می‌شوند؛ جمع‌ها روی
 * کل مجموعه؛ ردیف‌های نمایشی صفحه‌بندی واقعی (پیش‌فرض/سقف ۵٬۰۰۰) با page و
 * هشدار فارسی؛ `priorSettlementCount` واقعی.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s117-cl-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')

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

const DAY = 24 * 60 * 60 * 1000
const now = Date.now() - 60 * 1000
const today = toJalaliDate(new Date(now))
const oldAt = now - 40 * DAY
const oldJ = toJalaliDate(new Date(oldAt))

const { db: raw } = db.$harness
raw.exec('BEGIN')
// ۳٬۱۰۰ فاکتور نسیه‌ی امروز، هر کدام ۱۰۰٬۰۰۰ بدهی، ۱۰٬۰۰۰ پرداخت‌شده
const N = 3100
for (let i = 0; i < N; i++) {
  const inv = seed.insert('SaleInvoice', {
    grandTotal: 100_000,
    status: 'FINAL',
    receiptNo: 10_000 + i,
    issuedAt: now,
    issuedAtJalali: today
  })
  seed.insert('Payment', { invoiceId: inv, amount: 10_000, paidAt: now, paidAtJalali: today })
}
// ۲٬۱۰۰ پرداخت امروز بابت فاکتورهای ۴۰ روز قبل (وصول نسیه‌ی دوره‌ی قبل)، هر کدام ۵٬۰۰۰
const P = 2100
for (let i = 0; i < P; i++) {
  const inv = seed.insert('SaleInvoice', {
    grandTotal: 50_000,
    status: 'FINAL',
    receiptNo: 50_000 + i,
    issuedAt: oldAt,
    issuedAtJalali: oldJ
  })
  seed.insert('Payment', { invoiceId: inv, amount: 5_000, paidAt: now, paidAtJalali: today })
}
raw.exec('COMMIT')

const r = await salesService.creditList({ fromJalali: today, toJalali: today })
eq('تعداد فاکتور نسیه = کل بازه (۳٬۱۰۰)، نه ۳٬۰۰۰', r.totals.count, N)
eq('باقی‌مانده‌ی بدهی روی کل بازه = ۳٬۱۰۰ × ۹۰٬۰۰۰', r.totals.remainingTotal, N * 90_000)
eq('دریافت‌شده روی کل بازه = ۳٬۱۰۰ × ۱۰٬۰۰۰', r.totals.paidTotal, N * 10_000)
eq('وصول نسیه‌ی دوره‌ی قبل روی کل بازه = ۲٬۱۰۰ × ۵٬۰۰۰', r.totals.priorSettlementTotal, P * 5_000)
eq('تعداد وصول نسیه‌ی قبل = ۲٬۱۰۰، نه ۲٬۰۰۰', r.totals.priorSettlementCount, P)
eq('ردیف‌های وصول قبلی کامل (زیر سقف ۵٬۰۰۰)', r.priorSettlements.length, P)
eq('ردیف‌های فاکتور کامل (زیر سقف ۵٬۰۰۰)', r.rows.length, N)
eq('page.totalCount فاکتورها', r.page?.totalCount, N)
eq('page.truncated = false', r.page?.truncated, false)

// صفحه‌بندی واقعی: take=1000 ⇒ جمع‌ها همچنان کل بازه + هشدار فارسی
const p1 = await salesService.creditList({ fromJalali: today, toJalali: today, take: 1000 })
eq('صفحه‌ی اول ۱٬۰۰۰ ردیف', p1.rows.length, 1000)
eq('صفحه‌ی اول: جمع بدهی همچنان کل بازه', p1.totals.remainingTotal, N * 90_000)
eq('صفحه‌ی اول: truncated = true', p1.page?.truncated, true)
eq('صفحه‌ی اول: هشدار فارسی برش', (p1.warnings ?? []).some((w) => /نسیه/.test(w) && /۳٬۱۰۰|۳,۱۰۰|3100|۳۱۰۰/.test(w)), true)
const p4 = await salesService.creditList({ fromJalali: today, toJalali: today, take: 1000, skip: 3000 })
eq('صفحه‌ی چهارم: ۱۰۰ ردیف باقی‌مانده', p4.rows.length, 100)
eq('صفحه‌ی چهارم: ردیف‌ها تکراری نیستند', new Set([...p1.rows, ...p4.rows].map((x) => x.id)).size, 1100)

// سقف ۵٬۰۰۰ در هر صفحه
const big = await salesService.creditList({ fromJalali: today, toJalali: today, take: 999_999 })
eq('take بزرگ به سقف ۵٬۰۰۰ محدود می‌شود', big.page?.take, 5000)

// سقف اعلام‌شده در reportLimits با سرویس یکی است
const limits = readFileSync(resolve('src/main/services/reportLimits.ts'), 'utf8')
eq('REPORT_CAPS.credit = ۵٬۰۰۰', /credit:\s*5000/.test(limits), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
