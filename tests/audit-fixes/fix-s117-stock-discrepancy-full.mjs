/**
 * نشست ۱۱۷ · خوشه G (بند ۳ «انبارگردانی ماهانه ... باید با گزارش قابل‌کشف باشد» + ۴-۴۶)
 *
 * باگ: `stockCountService.discrepancy` برای «آخرین شمارش هر کالا» ردیف‌های
 * StockCountItem بازه را با `take: 20_000` (id نزولی) می‌خواند. با چند انبارگردانی
 * ماهانه‌ی بزرگ، ردیف‌های قدیمی‌تر بریده می‌شدند و کالایی که فقط در شمارش‌های
 * قدیمی‌تر شمرده شده بود (مثلاً کسری ۵ عددی) بی‌صدا از جدول مغایرت حذف می‌شد —
 * یعنی مدرک ضدسرقت پنهان می‌شد.
 * بعد از رفع (S117-5): کل ردیف‌های شمارش بازه در دسته‌های ثابت خوانده می‌شوند؛
 * همان قاعده‌ی «جدیدترین شمارش هر کالا» بدون برش.
 * این تست با هارنس SQLite اجرا می‌شود و جای Prisma تولیدی را نمی‌گیرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s117-sd-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
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

const now = Date.now() - 60 * 1000
const today = toJalaliDate(new Date(now))
const p = seed.product('شلوار جین')
const vx = seed.variant(p, '۳۲')
const vy = seed.variant(p, '۳۴')
db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 10 WHERE id = ?').run(vx)

const { db: raw } = db.$harness
raw.exec('BEGIN')
const oldSession = seed.insert('StockCountSession', { countedAt: now - 1000, countedAtJalali: today })
seed.insert('StockCountItem', { sessionId: oldSession, variantId: vx, countedQty: 5, systemQty: 10, diffQty: -5 })
const newSession = seed.insert('StockCountSession', { countedAt: now, countedAtJalali: today })
for (let i = 0; i < 20_010; i++)
  seed.insert('StockCountItem', { sessionId: newSession, variantId: vy, countedQty: 0, systemQty: 0, diffQty: 0 })
raw.exec('COMMIT')

const r = await stockCountService.discrepancy({ fromJalali: today, toJalali: today })
const rowX = r.rows.find((x) => x.variantId === vx)
eq('کالای شمرده‌شده در شمارش قدیمی‌تر از جدول مغایرت حذف نمی‌شود', !!rowX, true)
eq('عدد شمرده‌شده‌ی همان شمارش (۵)', rowX?.countedQty, 5)
eq('موجودی سیستمی لحظه‌ی شمارش (۱۰)', rowX?.systemQtyAtCount, 10)
const rowY = r.rows.filter((x) => x.variantId === vy)
eq('کالای تکراری فقط یک ردیف (جدیدترین شمارش)', rowY.length, 1)

const mism = await stockCountService.discrepancy({ fromJalali: today, toJalali: today, onlyMismatched: true })
eq('فیلتر «فقط مغایرت‌دار» کسری ۵ عددی را نشان می‌دهد', mism.rows.some((x) => x.variantId === vx), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
