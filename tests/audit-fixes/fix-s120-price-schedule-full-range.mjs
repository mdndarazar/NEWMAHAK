/**
 * نشست ۱۲۰ · خوشه G · زمان‌بندی تغییر قیمت
 *
 * باگ: زمان‌بند شروع‌ها و پایان‌های رسیده را با take:200 می‌خواند؛ مورد ۲۰۱ام
 * تا اجرای بعدی جا می‌ماند و اگر برنامه بسته بماند، قیمت/سند گزارش‌شده با
 * واقعیت یکی نیست.
 *
 * این تست با هارنس SQLite خودِ سرویس را اجرا می‌کند: ۲۰۱ شروع و ۲۰۱ پایان
 * رسیده باید در یک نوبت پردازش شوند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s120-schedule-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const now = new Date('2026-09-24T08:00:00.000Z')
const due = new Date(now.getTime() - 1_000)

for (let i = 0; i < 201; i++) {
  seed.insert('PriceChangeBatch', {
    kind: 'DISCOUNT',
    mode: 'PERCENT',
    value: 1,
    target: 'SALE',
    scope: 'ALL',
    title: `شروع رسیده ${i + 1}`,
    state: 'SCHEDULED',
    startAt: due,
    itemCount: 0,
    deltaTotal: 0,
    at: due
  })
}

for (let i = 0; i < 201; i++) {
  seed.insert('PriceChangeBatch', {
    kind: 'DISCOUNT',
    mode: 'PERCENT',
    value: 1,
    target: 'SALE',
    scope: 'ALL',
    title: `پایان رسیده ${i + 1}`,
    state: 'APPLIED',
    endAt: due,
    itemCount: 0,
    deltaTotal: 0,
    at: due
  })
}

const result = await priceAdjustService.runDueSchedules(now)
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

eq('همه‌ی ۲۰۱ شروع رسیده در همان نوبت اجرا شدند', result.started, 201)
eq('همه‌ی ۲۰۱ پایان رسیده در همان نوبت اجرا شدند', result.ended, 201)
eq('هیچ زمان‌بندی‌ای به‌خاطر برش جا نماند', result.failed, 0)
eq('مورد شروع رسیده‌ی باقی‌مانده صفر است', seed.count('PriceChangeBatch', 'state = ?', 'SCHEDULED'), 0)
eq('مورد پایان رسیده‌ی باقی‌مانده صفر است', seed.count('PriceChangeBatch', 'state = ? AND endAt <= ?', 'APPLIED', now.getTime()), 0)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
