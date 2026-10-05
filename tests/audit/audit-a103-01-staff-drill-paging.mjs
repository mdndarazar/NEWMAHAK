/**
 * ممیزی نشست ۱۰۳ — StaffReportService.transactions (skip/take/pages) و StaffPerformancePanel (دکمه‌های صفحه)
 * A103-01 (P2): یک skip مشترک برای چهار مجموعه با اندازه‌های متفاوت + هشدار پیش از خواندن ردیف‌ها:
 *   ۶۰۰ فاکتور و ۳ برگشت ⇒ صفحه‌ی ۲ (skip=۵۰۰): فاکتورهای ۵۰۱..۶۰۰ بدون هیچ هشداری («۱۰۰ ردیف» گویی همه‌ی فاکتورهاست)
 *   و جدول برگشت خالی با متن «برگشت یا تعویضی در این بازه برای این کارمند نیست» در حالی که ۳ برگشت هست.
 * مشکوک‌های رد‌شده (با کد فعلی): «۵۰۰ از ۶۰۰ در صفحه‌ی آخر» (truncated در صفحه‌ی آخر false است؛ هشداری ساخته نمی‌شود)،
 *   openDrill پاسخ کهنه و drillSkip (A88-01: load() درخواست‌ها را شماره می‌زند، drill را null و skip بعدی را ۰ می‌کند).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const yes = (label, v) => eq(label, Boolean(v), true)
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10301-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { toJalaliDate } = await import('@shared/jalali')
let staffSectionNotice = null
try { ({ staffSectionNotice } = await import('../../src/shared/staffTransactionsPaging.ts')) } catch { /* کد قدیم: helper نیست */ }

const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now(); const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, userId: A })
let firstInv = null
for (let k = 1; k <= 600; k++) {
  const id = seed.insert('SaleInvoice', { receiptNo: k, userId: A, shiftId: S, orderType: 'IN_STORE', status: 'SETTLED', issuedAt: now - 3600_000, issuedAtJalali: today, goodsTotal: 1000, discountTotal: 0, grandTotal: 1000, paidTotal: 1000 })
  firstInv ??= id
}
for (let k = 0; k < 3; k++) seed.insert('SaleReturn', { invoiceId: firstInv, userId: A, shiftId: S, total: 1000, kind: 'RETURN', returnedAt: now - 1000, returnedAtJalali: today })
const f = { fromJalali: today, toJalali: today, userId: A, take: 500 }

const p1 = await staffReportService.transactions({ ...f, skip: 0 })
eq('صفحه‌ی ۱: ۵۰۰ فاکتور', p1.invoices.length, 500)
yes('صفحه‌ی ۱: هشدار برش فاکتورها با بازه‌ی واقعی «۱ تا ۵۰۰ از ۶۰۰»', p1.warnings.some((w) => w.includes('فاکتور') && w.includes('۱ تا ۵۰۰') && w.includes('۶۰۰')))
eq('صفحه‌ی ۱: برگشت‌ها کامل (۳) و بدون هشدار برگشت', [p1.returns.length, p1.warnings.some((w) => w.includes('برگشت'))], [3, false])

const p2 = await staffReportService.transactions({ ...f, skip: 500 })
eq('صفحه‌ی ۲: ۱۰۰ فاکتور', p2.invoices.length, 100)
eq('صفحه‌ی ۲: truncated فاکتورها false (صفحه‌ی آخر)', p2.pages.invoices.truncated, false)
yes('صفحه‌ی ۲: فاکتورها «۵۰۱ تا ۶۰۰ از ۶۰۰» اعلام می‌شود (نه سکوت)', p2.warnings.some((w) => w.includes('فاکتور') && w.includes('۵۰۱ تا ۶۰۰')))
eq('صفحه‌ی ۲: هیچ هشداری «۵۰۰ از ۶۰۰» نمی‌گوید', p2.warnings.some((w) => w.includes('۵۰۰ از ۶۰۰')), false)
yes('صفحه‌ی ۲: جدول خالی برگشت توضیح دارد (۳ برگشت در صفحه‌های قبل)', p2.warnings.some((w) => w.includes('برگشت') && w.includes('۳')))

console.log('— helper خالص (متن خالی جدول در UI)')
if (!staffSectionNotice) { bad += 4; console.log('  ✗ staffSectionNotice وجود ندارد') }
else {
  const fa = (v) => Number(v).toLocaleString('fa-IR')
  const n1 = staffSectionNotice('برگشت‌ها و تعویض‌ها', { skip: 500, take: 500, totalCount: 3, truncated: false }, 0, fa)
  yes('خالی ولی total>0 ⇒ emptyText صریح', n1.emptyText && n1.emptyText.includes('۳'))
  const n2 = staffSectionNotice('برگشت‌ها و تعویض‌ها', { skip: 0, take: 500, totalCount: 0, truncated: false }, 0, fa)
  eq('واقعاً خالی ⇒ نه هشدار نه emptyText', [n2.warning, n2.emptyText], [null, null])
  const n3 = staffSectionNotice('فاکتورهای فروش', { skip: 0, take: 500, totalCount: 40, truncated: false }, 40, fa)
  eq('یک‌صفحه‌ای کامل ⇒ بدون هشدار', n3.warning, null)
  const n4 = staffSectionNotice('فاکتورهای فروش', { skip: 1000, take: 500, totalCount: 1700, truncated: true }, 500, fa)
  yes('وسط ⇒ «۱٬۰۰۱ تا ۱٬۵۰۰ از ۱٬۷۰۰» + صفحه‌ی بعد', n4.warning && n4.warning.includes('۱٬۰۰۱ تا ۱٬۵۰۰') && n4.warning.includes('صفحه‌ی بعد'))
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
