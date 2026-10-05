/**
 * ممیزی نشست ۱۱۷ — S117-5: StockCountService.discrepancy (تب «مغایرت» انبارگردانی).
 * تأیید رفتاری ادعاهای S117-5: ستون createdAt برای برگشت‌های بازه (نه «at») و خواندن دسته‌ای ۵٬۰۰۰تایی (fix-s117 با ۲۰٬۰۱۰ ردیف).
 * A117-04 (P2): «آخرین شمارش هر کالا» با id نزولی ردیف شمارش انتخاب می‌شد، نه با تاریخ شمارش (countedAt). submit تاریخ گذشته
 *   (dateJalali) را می‌پذیرد، پس شمارشِ دیرتر-ثبت‌شده‌ی قدیمی‌تر برنده می‌شد. مثال: شمارش ۳ روز پیش شلوار X: شمرده ۵، سیستم ۱۰
 *   (کسری ۵). بعد یک شمارش با تاریخ ۱۰ روز پیش (کاغذی، دیر وارد شده) X را ۱۰ از ۱۰ ثبت می‌کند ⇒ جدول مغایرت X را «۱۰، بدون مغایرت»
 *   نشان می‌داد و کسری ۵ عددیِ جدیدترین شمارش حتی با «فقط مغایرت‌دار» پنهان بود؛ فهرست جلسه‌ها (countedAt نزولی) شمارش ۳ روز
 *   پیش را جدیدترین نشان می‌داد (دو قاعده‌ی متفاوت برای «آخرین»).
 * A117-05 (P3، گیت main): تاریخ نامعتبر («۱۴۰۵/۱۳/۰۱») در jalaliRange بی‌صدا حذف می‌شد ⇒ بازه‌ی یک‌طرفه/کل تاریخچه؛
 *   بازه‌ی معکوس ⇒ جدول خالی «بدون شمارش» بی‌هیچ خطا.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11704-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const at = (t) => ({ ms: t, j: toJalaliDate(new Date(t)) })
const d3 = at(T0 - 3 * 86400_000 + 3600_000), d10 = at(T0 - 10 * 86400_000 + 3600_000), d20 = at(T0 - 20 * 86400_000)
const p = seed.product('شلوار جین')
const vx = seed.variant(p, '۳۲'), vy = seed.variant(p, '۳۴')
db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 10 WHERE id IN (?, ?)').run(vx, vy)
// ترتیب ثبت: اول شمارش ۳ روز پیش (کسری ۵)، بعد شمارش گذشته‌نگر ۱۰ روز پیش (۱۰ از ۱۰)
const sNew = seed.insert('StockCountSession', { countedAt: d3.ms, countedAtJalali: d3.j, createdAt: d3.ms })
seed.insert('StockCountItem', { sessionId: sNew, variantId: vx, countedQty: 5, systemQty: 10, diffQty: -5 })
const sBack = seed.insert('StockCountSession', { countedAt: d10.ms, countedAtJalali: d10.j, createdAt: Date.now() - 1000 })
seed.insert('StockCountItem', { sessionId: sBack, variantId: vx, countedQty: 10, systemQty: 10, diffQty: 0 })
// هم‌تاریخ: دو جلسه با countedAt یکسان روی vy ⇒ جلسه‌ی بعدی (id بزرگ‌تر) برنده
const tie = at(T0 - 5 * 86400_000)
const sT1 = seed.insert('StockCountSession', { countedAt: tie.ms, countedAtJalali: tie.j })
seed.insert('StockCountItem', { sessionId: sT1, variantId: vy, countedQty: 7, systemQty: 10, diffQty: -3 })
const sT2 = seed.insert('StockCountSession', { countedAt: tie.ms, countedAtJalali: tie.j })
seed.insert('StockCountItem', { sessionId: sT2, variantId: vy, countedQty: 9, systemQty: 10, diffQty: -1 })
// برگشت‌ها: یکی داخل بازه (۳ روز پیش)، یکی بیرون (۲۰ روز پیش) و یک ابطال برگشت (منفی) داخل بازه
seed.insert('StockMovement', { variantId: vx, delta: 2, reason: 'SALE_RETURN', createdAt: d3.ms })
seed.insert('StockMovement', { variantId: vx, delta: 1, reason: 'SALE_RETURN', createdAt: d3.ms })
seed.insert('StockMovement', { variantId: vx, delta: -1, reason: 'SALE_RETURN', createdAt: d3.ms })
seed.insert('StockMovement', { variantId: vx, delta: 4, reason: 'SALE_RETURN', createdAt: d20.ms })

const from = toJalaliDate(new Date(T0 - 15 * 86400_000))
let r = null
try { r = await stockCountService.discrepancy({ fromJalali: from, toJalali: today }) } catch (e) { console.log('  (خطا) ' + e.message) }
const rx = r?.rows.find((x) => x.variantId === vx)
eq('X: جدیدترین شمارش به تاریخ شمارش (۳ روز پیش) ⇒ شمرده ۵', rx?.countedQty, 5)
eq('X: تاریخ شمارش نمایش‌داده‌شده = ۳ روز پیش', rx?.countedAtJalali, d3.j)
eq('X: کسری ۵ نیازمند بازبینی', [rx?.diffAtCount, rx?.needsReview], [-5, true])
const ry = r?.rows.find((x) => x.variantId === vy)
eq('هم‌تاریخ: جلسه‌ی بعدی (id بزرگ‌تر) ⇒ ۹', ry?.countedQty, 9)
eq('برگشت بازه با createdAt (۲+۱−۱؛ برگشت ۲۰ روز پیش بیرون)', rx?.returnedQty, 2)
let m = null
try { m = await stockCountService.discrepancy({ fromJalali: from, toJalali: today, onlyMismatched: true }) } catch {}
eq('«فقط مغایرت‌دار» کسری X را نشان می‌دهد', !!m?.rows.some((x) => x.variantId === vx), true)
const sessions = await stockCountService.list({ fromJalali: from, toJalali: today })
const sRows = Array.isArray(sessions) ? sessions : sessions.rows
eq('هم‌قاعده با فهرست جلسه‌ها (جدیدترین = ۳ روز پیش)', sRows?.[0]?.countedAtJalali, d3.j)

// بی‌تاریخ: همان «آخرین شمارش کل تاریخچه» (رفتار قبلی حفظ)
const all = await stockCountService.discrepancy({})
eq('بی‌تاریخ ⇒ بدون قید (آخرین شمارش کل تاریخچه)', all.rows.find((x) => x.variantId === vx)?.countedQty, 5)
const blank = await stockCountService.discrepancy({ fromJalali: '', toJalali: '' })
eq("'' ⇒ مثل بی‌تاریخ", blank.rows.find((x) => x.variantId === vx)?.countedQty, 5)

const errOf = async (f) => { try { await stockCountService.discrepancy(f); return null } catch (e) { return String(e.message) } }
const e1 = await errOf({ fromJalali: '1405/13/01', toJalali: today })
eq('تاریخ نامعتبر ⇒ خطای فارسی هدف', /«از تاریخ» گزارش مغایرت انبارگردانی معتبر نیست/.test(e1 ?? ''), true)
const e2 = await errOf({ fromJalali: from, toJalali: 'abc' })
eq('«تا» نامعتبر ⇒ خطای فارسی هدف', /«تا تاریخ» گزارش مغایرت انبارگردانی معتبر نیست/.test(e2 ?? ''), true)
const e3 = await errOf({ fromJalali: today, toJalali: from })
eq('بازه‌ی معکوس ⇒ خطای فارسی هدف', /بازه‌ی گزارش مغایرت انبارگردانی معکوس است/.test(e3 ?? ''), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
