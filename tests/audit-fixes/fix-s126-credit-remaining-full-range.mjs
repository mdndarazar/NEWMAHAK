/**
 * نشست ۱۲۶ · خوشه C/G · باقی‌مانده‌ی بدهی در صورت‌های حسابداری.
 *
 * باگ: `creditRemaining` با take=50,001 فقط ۵۰٬۰۰۰ فاکتور اول را وارد
 * «باقی‌مانده‌ی نسیه» می‌کرد و برای عدد ناقص هشدار می‌داد. هشدار، عدد مالی
 * ناقص را درست نمی‌کند؛ فاکتور ۵۰٬۰۰۱ام باید واقعاً در جمع باشد.
 *
 * قرارداد بعد از رفع: اسکن در صفحه‌های مرتب‌شده تا پایان ادامه پیدا می‌کند،
 * جمع بدهی و جمع ایجادشده کامل است و هیچ هشدار برشِ جعلی تولید نمی‌شود.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s126-credit-remaining-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { saleWhere } = await import('../../src/main/services/SalesService.ts')
const { buildStatements } = await import('../../src/main/services/accountingReport.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const raw = db.$harness.db
const now = Date.now()
const today = toJalaliDate(new Date(now))
const N = 50_001
const AMOUNT = 100_000

raw.exec('BEGIN')
for (let i = 0; i < N; i++) {
  seed.invoice({
    grandTotal: AMOUNT,
    status: 'FINAL',
    receiptNo: 100_000 + i
  })
}
raw.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ?, settledAt = NULL').run(now, today)
raw.exec('COMMIT')

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

const { statements, warnings } = await buildStatements({
  where: saleWhere({ fromJalali: today, toJalali: today }),
  from: jalaliStartOfDay(today),
  to: jalaliEndOfDay(today),
  period: { fromJalali: today, toJalali: today, source: 'explicit' },
  filter: { fromJalali: today, toJalali: today }
})

eq('باقی‌مانده‌ی بدهی شامل فاکتور ۵۰٬۰۰۱ام است', statements.credit.remaining, N * AMOUNT)
eq('جمع ایجادشده شامل همه‌ی فاکتورهاست', statements.credit.created, N * AMOUNT)
eq('اسکن کامل هشدار برش مالی ندارد', warnings.some((w) => /باقی‌ماندهٔ بدهی/.test(w)), false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
