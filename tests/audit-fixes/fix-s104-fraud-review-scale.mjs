/**
 * نشست ۱۰۴ · خوشه G
 *
 * گزارش ضدتقلب یک گزارش تجمیعی است؛ سقف ثابت روی `cashSession.findMany`
 * می‌تواند تعداد و مبلغ کسری صندوق را دروغین کند. این تست عمداً ۵۰۱ کسری
 * می‌سازد تا سقف قبلی ۵۰۰ را آشکار کند.
 *
 * قبل از اصلاح:
 *   node --import ./test/harness/register.mjs tests/audit-fixes/fix-s104-fraud-review-scale.mjs
 *   ⇒ انتظاراً ۵۰۰ به‌جای ۵۰۱ و شکست
 *
 * بعد از اصلاح:
 *   همان دستور ⇒ PASS
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s104-fraud-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

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

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { toJalaliDate } = await import('@shared/jalali')
const { fraudService } = await import('../../src/main/services/FraudService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
for (let i = 0; i < 501; i++) {
  seed.insert('CashSession', {
    dayJalali: today,
    reportVersion: 'session14',
    closedAt: new Date(),
    countedTotal: 0,
    cashDifference: -1,
    expectedCash: 1
  })
}

const result = await fraudService.review({ fromJalali: today, toJalali: today })
const flag = result.flags.find((item) => item.key === 'cashShortage')
eq('ضدتقلب تمام کسری‌های صندوق را می‌شمارد', flag?.count ?? null, 501)
eq('جمع مبلغ کسری هم از همه‌ی ردیف‌ها ساخته می‌شود', flag?.amount ?? null, 501)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
