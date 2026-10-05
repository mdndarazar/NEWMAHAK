/**
 * نشست ۱۱۵ · خوشه E · بند ۴-۵۴ (+ ۴-۹ «اثر دقیقاً یک‌بار»)
 *
 * باگ ۱ (createdAt/paidAt): `cardTransferService.list/outOfSales` بازه را روی
 * `createdAt` فیلتر می‌کردند ولی `calculateCardTransferTotals` پرداخت را با `paidAt`
 * مهر می‌زند و بدون period صدا زده می‌شد. نتیجه: درخواستی که ماه قبل ثبت و امروز
 * پرداخت شده، در «خارج از فروش» امروز دیده نمی‌شد؛ و درخواستی که دیروز ثبت و امروز
 * پرداخت شده، در گزارش دیروز «پرداخت‌شده» شمرده می‌شد.
 * باگ ۲ (ADJUSTED): با ثبت رویداد اصلاحی، ردیف پرداخت‌شده‌ی اصلی `ADJUSTED` می‌شود
 * و `calculateCardTransferTotals` آن را دیگر پرداخت‌شده نمی‌شمرد؛ در حالی که مبلغ
 * اصلاحی «تفاضل» است (مثبت = بیشتر، منفی = برگشت). پس ۱٬۰۰۰٬۰۰۰ پرداخت + اصلاح
 * ۲۰۰٬۰۰۰ در جمع فقط ۲۰۰٬۰۰۰ دیده می‌شد.
 * بعد از رفع (S115-4/S115-5): هر رویداد با تاریخ خودش (پرداخت/اصلاح ← paidAt، در
 * انتظار ← createdAt)؛ where = ثبت‌شده یا پرداخت‌شده در بازه؛ ردیف ADJUSTED دارای
 * paidAt همچنان پرداخت‌شده است.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s115-ctd-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cardTransferService } = await import('../../src/main/services/CardTransferService.ts')
const { calculateCardTransferTotals } = await import('@shared/accounting')
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
// ظهر امروز به وقت تهران تقریبی: از «الان» یک ساعت عقب (همیشه همان روز شمسی نیست؛ پس از toJalaliDate خودِ مهرها استفاده می‌شود)
const now = Date.now() - 60 * 1000
const today = toJalaliDate(new Date(now))
const yAt = now - DAY
const yesterday = toJalaliDate(new Date(yAt))
const oldAt = now - 40 * DAY
const J = (t) => toJalaliDate(new Date(t))
const add = (v) => seed.insert('CardTransferRequest', { returnId: 1, createdAtJalali: J(v.createdAt), ...v })

const r1 = add({ createdAt: oldAt, status: 'PAID', amount: 700_000, paidAmount: 700_000, paidAt: now, paidAtJalali: today })
const r3 = add({ createdAt: yAt, status: 'PAID', amount: 300_000, paidAmount: 300_000, paidAt: now, paidAtJalali: today })
const r4 = add({ createdAt: now, status: 'ADJUSTED', amount: 1_000_000, paidAmount: 1_000_000, paidAt: now, paidAtJalali: today })
add({ createdAt: now, kind: 'ADJUSTMENT', status: 'PAID', amount: 200_000, paidAmount: 200_000, paidAt: now, paidAtJalali: today, adjustsRequestId: r4 })
add({ createdAt: now, status: 'PENDING', amount: 50_000 })

const t = await cardTransferService.outOfSales({ fromJalali: today, toJalali: today })
eq('امروز: پرداختِ درخواستِ ۴۰ روز قبل شمرده می‌شود', t.rows.some((r) => r.id === r1), true)
eq('امروز: پرداخت‌شده = ۷۰۰ + ۳۰۰ + ۱٬۰۰۰ هزار (اصلیِ اصلاح‌شده هم)', t.totals.paidAmount, 2_000_000)
eq('امروز: اصلاحی = ۲۰۰٬۰۰۰', t.totals.adjustmentAmount, 200_000)
eq('امروز: خالص خارج از فروش = ۲٬۲۰۰٬۰۰۰', t.totals.netOutOfSalesFlow, 2_200_000)
eq('امروز: در انتظار = ۵۰٬۰۰۰', t.totals.pendingAmount, 50_000)

const l = await cardTransferService.list({ fromJalali: today, toJalali: today })
eq('فهرست امروز: درخواست قدیمیِ امروز پرداخت‌شده دیده می‌شود', l.rows.some((r) => r.id === r1), true)
eq('فهرست امروز: جمع پرداخت‌شده با «خارج از فروش» یکی است', l.totals.paidAmount, t.totals.paidAmount)

if (yesterday !== today) {
  const y = await cardTransferService.outOfSales({ fromJalali: yesterday, toJalali: yesterday })
  eq('دیروز: پرداختِ امروز در گزارش دیروز «پرداخت‌شده» نیست', y.totals.paidAmount, 0)
  eq('دیروز: خالص دیروز صفر', y.totals.netOutOfSalesFlow, 0)
  const both = await cardTransferService.outOfSales({ fromJalali: yesterday, toJalali: today })
  eq('دیروز+امروز: هر پرداخت دقیقاً یک‌بار', both.totals.paidAmount, 2_000_000)
}

// تابع خالص مشترک: ADJUSTED بی‌پرداخت (اصلاح روی درخواستِ هنوز پرداخت‌نشده) نه در انتظار است نه پرداخت‌شده
const pure = calculateCardTransferTotals([
  { kind: 'REQUEST', status: 'ADJUSTED', amount: 90, paidAmount: null, createdAt: now, paidAt: null },
  { kind: 'REQUEST', status: 'ADJUSTED', amount: 10, paidAmount: 10, createdAt: now, paidAt: now }
])
eq('تابع مشترک: ADJUSTED پرداخت‌شده در جمع پرداخت، بی‌پرداخت بیرون', pure.paidAmount === 10 && pure.pendingAmount === 0, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
