/**
 * ممیزی نشست ۱۰۹ — پیش‌نمایش پاک‌سازی (purgePreview: page/warnings نشست ۱۰۹) رفتاری.
 * ادعای S109: با ۲۰٬۰۰۲ فاکتور، page.totalCount=۲۰٬۰۰۲، truncated و هشدار فارسی؛ جمع‌ها کل بازه.
 * A109-01 (P3): پیش‌نمایش تاریخ را نمی‌سنجید در حالی که purge همان ورودی را رد می‌کند:
 *   «۱۴۰۵/۱۳/۰۱» ⇒ پیش‌نمایش بی‌صدا «۰ فاکتور» (مدیر فکر می‌کند بازه خالی است)؛ '' ⇒ پیش‌نمایش داده‌ی امروز
 *   با برچسب بازه‌ی خالی، ولی purge('') خطا؛ بازه‌ی معکوس ⇒ پیش‌نمایش خالی. پیش‌نمایشِ عملیات مخرب باید
 *   دقیقاً همان قبول/رد خود عملیات را داشته باشد (بدون پیش‌فرض «امروز» برای ورودی خالی، هم‌الگوی A107-01).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10901-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date()); const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const A = seed.user('الف')
const N = 20002
const ins = sql.prepare('INSERT INTO "SaleInvoice" (receiptNo, status, orderType, grandTotal, paidTotal, goodsTotal, discountTotal, taxTotal, issuedAt, issuedAtJalali, userId, deductInventory) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
sql.exec('BEGIN'); for (let i = 0; i < N; i++) ins.run(1 + i, 'SETTLED', 'INTERNAL', 1000, 1000, 1000, 0, 0, T0 + 100_000 + i, today, A, 0); sql.exec('COMMIT')
const p = await salesService.purgePreview({ fromJalali: today, toJalali: today })
eq('S109: ۲۰٬۰۰۰ ردیف، totalCount ۲۰٬۰۰۲، truncated', [p.rows.length, p.page?.totalCount, p.page?.truncated], [20000, N, true])
eq('S109: هشدار برش فارسی با عدد واقعی', (p.warnings ?? []).some((w) => w.includes(String(N))), true)
eq('S109: جمع‌ها کل بازه (count ۲۰٬۰۰۲)', p.totals.count, N)
const sel = await salesService.purgePreview({ fromJalali: today, toJalali: today, invoiceIds: [1, 2, 3] })
eq('S109: انتخابی ⇒ ۳ ردیف و بدون هشدار برش', [sel.rows.length, sel.warnings], [3, []])
const err = async (f) => { try { await f(); return null } catch (e) { return String(e?.message ?? e) } }
const fa = (m) => !!m && /[\u0600-\u06FF]/.test(m)
const pBad = await err(() => salesService.purgePreview({ fromJalali: '1405/13/01', toJalali: '1405/13/01' }))
const xBad = await err(() => salesService.purge({ fromJalali: '1405/13/01', toJalali: '1405/13/01', managerVerified: true }))
eq('purge تاریخ نامعتبر را رد می‌کند (مرجع)', fa(xBad), true)
eq('پیش‌نمایش تاریخ نامعتبر ⇒ خطای فارسی (نه «۰ فاکتور» بی‌صدا)', fa(pBad), true)
const pEmpty = await err(() => salesService.purgePreview({ fromJalali: '', toJalali: '' }))
eq("پیش‌نمایش '' ⇒ خطای فارسی (purge هم رد می‌کند)", fa(pEmpty), true)
const pRev = await err(() => salesService.purgePreview({ fromJalali: today, toJalali: '1400/01/01' }))
eq('پیش‌نمایش بازه‌ی معکوس ⇒ خطای فارسی', fa(pRev), true)
const und = await salesService.purgePreview({})
eq('بدون تاریخ (undefined) ⇒ همان پیش‌فرض قبلی امروز', und.fromJalali, today)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
