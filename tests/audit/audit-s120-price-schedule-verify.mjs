/**
 * ممیزی نشست ۱۲۰ — تأیید رفتاری S120-1 (runDueSchedules keyset).
 * fix-s120 فقط دسته‌های بی‌کالا (itemCount صفر) داشت: هیچ قیمتی عوض نمی‌شد و مسیر شکست/مرز صفحه
 * با زمان‌های متفاوت سنجیده نمی‌شد. اینجا: ۲۰۵ دسته‌ی واقعی (هر کدام یک کالا) با ۱۰۰ زمان یکسان و
 * ۱۰۵ زمان متفاوت، ۳ دسته که شروع و پایانشان هر دو رسیده، و یک دسته‌ی خراب وسط صفحه‌ی اول.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s120v-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')
const db = harnessClient(); const seed = makeSeeder(db)
const now = new Date('2026-09-24T08:00:00.000Z')
const same = new Date(now.getTime() - 3_600_000)
const P = seed.product('شلوار جین')
const vids = []
for (let i = 0; i < 205; i++) vids.push(seed.variant(P, `سایز ${i}`))
const batch = (i, o) => seed.insert('PriceChangeBatch', {
  kind: 'DISCOUNT', mode: 'PERCENT', value: 10, target: 'SALE', scope: 'VARIANTS', roundStep: 1, minPrice: 0,
  title: `زمان‌بندی ${i}`, state: 'SCHEDULED', itemCount: 0, deltaTotal: 0, at: same, ...o
})
const ids = []
for (let i = 0; i < 205; i++) {
  const startAt = i < 100 ? same : new Date(same.getTime() + (i - 99) * 1_000)
  const endAt = i === 0 || i === 150 || i === 204 ? new Date(now.getTime() - 1_000) : null
  ids.push(batch(i, { startAt, endAt, variantIdsJson: JSON.stringify([vids[i]]) }))
}
// دسته‌ی خراب (کالا ندارد) با همان زمان مشترک صفحه‌ی اول
const broken = batch('خراب', { startAt: same, variantIdsJson: '[]' })
// دسته‌ی آینده نباید اجرا شود
const future = batch('آینده', { startAt: new Date(now.getTime() + 60_000), variantIdsJson: JSON.stringify([vids[5]]) })

let r
try { r = await priceAdjustService.runDueSchedules(now) } catch (e) { console.log('  ! خطا', e.message); r = {} }
eq('۲۰۵ شروع واقعی + هیچ‌کدام جا نماند', r.started, 205)
eq('۳ پایان رسیده (شروع و پایان در یک نوبت)', r.ended, 3)
eq('دسته‌ی خراب یک شکست ثبت‌شده، بقیه ادامه دادند', r.failed, 1)
const price = (v) => seed.one('SELECT salePrice FROM ProductVariant WHERE id = ?', v).salePrice
const discounted = vids.filter((v, i) => ![0, 150, 204].includes(i) && price(v) === 900_000).length
eq('۲۰۲ کالا قیمت ۹۰۰٬۰۰۰ گرفتند', discounted, 202)
eq('سه کالای پایان‌یافته به ۱٬۰۰۰٬۰۰۰ برگشتند', [0, 150, 204].map((i) => price(vids[i])), [1_000_000, 1_000_000, 1_000_000])
eq('۲۰۵ ردیف PriceChangeItem (سند بازگردانی کامل)', seed.count('PriceChangeItem'), 205)
eq('دسته‌ی آینده دست‌نخورده (SCHEDULED)', seed.one('SELECT state FROM PriceChangeBatch WHERE id = ?', future).state, 'SCHEDULED')
eq('دسته‌ی خراب از چرخه بیرون رفت (دیگر SCHEDULED نیست)', seed.one('SELECT state FROM PriceChangeBatch WHERE id = ?', broken).state !== 'SCHEDULED', true)
eq('هیچ شروع رسیده‌ای باقی نماند', seed.count('PriceChangeBatch', 'state = ? AND startAt <= ?', 'SCHEDULED', now.getTime()), 0)
let r2
try { r2 = await priceAdjustService.runDueSchedules(now) } catch (e) { r2 = {} }
eq('اجرای دوباره: هیچ اثر تکراری (۰/۰/۰)', [r2.started, r2.ended, r2.failed], [0, 0, 0])
eq('اجرای دوباره قیمت را دوباره تخفیف نزد', price(vids[1]), 900_000)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
