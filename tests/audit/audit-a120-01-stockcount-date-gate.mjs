/**
 * ممیزی نشست ۱۲۰ — A120-01 (P2، گیت main): تاریخ ثبت شمارش (StockCountService.submit).
 * نشست ۱۲۰ submit را برای chunk بازنویسی کرد ولی تاریخ را نسنجید: jalaliToDateTime «۱۴۰۵/۱۳/۰۱» را
 * بی‌صدا ۱۴۰۶/۰۱/۰۲ می‌گیرد و تاریخ آینده هم پذیرفته می‌شود. چون مغایرت «آخرین شمارش» را با بیشترین
 * countedAt انتخاب می‌کند (D52)، یک شمارش آینده‌دار همه‌ی شمارش‌های واقعی بعدی را تا آن روز پنهان می‌کند
 * (کسری واقعی ۵ عدد ⇒ «بدون مغایرت»). UI فقط قالب را می‌سنجد، main هیچ.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a12001-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const today = toJalaliDate(new Date(T0 + 3_600_000))
const tomorrow2 = toJalaliDate(new Date(T0 + 2 * 86_400_000 + 3_600_000))
const yday = toJalaliDate(new Date(T0 - 86_400_000 + 3_600_000))
const P = seed.product('جین'); const V = seed.variant(P, '32')
db.$harness.db.prepare('UPDATE ProductVariant SET stock = 10 WHERE id = ?').run(V)
await db.stockCountSession.count()
const sessions = () => seed.count('StockCountSession')
const tryErr = async (p) => { try { await stockCountService.submit(p); return null } catch (e) { return String(e.message) } }

const e1 = await tryErr({ dateJalali: '۱۴۰۵/۱۳/۰۱', items: [{ variantId: V, countedQty: 10 }] })
eq('«۱۴۰۵/۱۳/۰۱» با پیام هدف رد می‌شود', /تاریخ شمارش معتبر نیست/.test(e1 ?? ''), true)
eq('«۱۴۰۵/۱۳/۰۱»: هیچ جلسه‌ای ساخته نشد', sessions(), 0)
const e2 = await tryErr({ dateJalali: '1405/06/40', items: [{ variantId: V, countedQty: 10 }] })
eq('«۱۴۰۵/۰۶/۴۰» با پیام هدف رد می‌شود', /تاریخ شمارش معتبر نیست/.test(e2 ?? ''), true)
const e3 = await tryErr({ dateJalali: tomorrow2, items: [{ variantId: V, countedQty: 10 }] })
eq('تاریخ آینده (پس‌فردا) با پیام هدف رد می‌شود', /تاریخ شمارش .*بعد از امروز/.test(e3 ?? ''), true)
eq('بعد از سه ورودی نامعتبر هنوز هیچ جلسه‌ای نیست', sessions(), 0)
// ورودی معتبر
eq('دیروز (گذشته‌نگر) پذیرفته می‌شود', await tryErr({ dateJalali: yday, items: [{ variantId: V, countedQty: 10 }] }), null)
eq('امروز پذیرفته می‌شود (شمارش واقعی: کسری ۵)', await tryErr({ dateJalali: today, items: [{ variantId: V, countedQty: 5 }] }), null)
eq('بدون تاریخ = الان پذیرفته می‌شود', await tryErr({ items: [{ variantId: V, countedQty: 5 }] }), null)
eq('فقط سه جلسه‌ی معتبر ثبت شد', sessions(), 3)
let d = null
try { d = await stockCountService.discrepancy({}) } catch (e) { d = null }
const rows = Array.isArray(d) ? d : (d?.rows ?? d?.items ?? [])
const row = rows.find((r) => Number(r.variantId) === V)
eq('مغایرت: آخرین شمارش واقعی (۵ از ۱۰) دیده می‌شود، نه شمارش آینده‌دار', row ? Number(row.countedQty ?? row.lastCountedQty) : null, 5)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
