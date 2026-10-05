/**
 * ممیزی A121-02 (P3، UI) — چاپ حرارتی «سرجمع فروش» در حالت «فقط صفحه‌ی جاری».
 * قبل: meta حرارتی در حالت صفحه = outputMetaText ⇒ روی کاغذ «این چاپ فقط صفحه‌ی جاری است؛ نمایش ۱ از ۳ فاکتور ·
 *   جمع مبلغ ردیف‌های فایل فقط همین صفحه است» می‌آمد، در حالی که همه‌ی خطوط حرارتی از report.totals (جمع *کل بازه*)
 *   خوانده می‌شوند و هیچ ردیفی ندارند ⇒ مدیر جمع درست کل بازه (۶٬۰۰۰٬۰۰۰) را «جمع یک صفحه» می‌خواند.
 * بعد: حرارتی همیشه برچسب «خلاصه و جمع‌ها بر اساس کل فیلترشده» می‌گیرد.
 * بخش رفتاری: reportRows با take=۱ جمع کل بازه را برمی‌گرداند (مبنای ادعای بالا).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a12102-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now(); const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, userId: A })
const I = (o) => seed.insert('SaleInvoice', { userId: A, shiftId: S, orderType: 'IN_STORE', issuedAt: now - 3600_000 + o.receiptNo, issuedAtJalali: today, discountTotal: 0, ...o, goodsTotal: o.grandTotal })
I({ receiptNo: 1, status: 'SETTLED', grandTotal: 1_000_000, paidTotal: 1_000_000 })
I({ receiptNo: 2, status: 'SETTLED', grandTotal: 2_000_000, paidTotal: 2_000_000 })
I({ receiptNo: 3, status: 'SETTLED', grandTotal: 3_000_000, paidTotal: 3_000_000 })
const rep = await salesService.reportRows({ fromJalali: today, toJalali: today, take: 1, skip: 2 })
eq('صفحه‌ی آخر: ۱ ردیف', rep?.rows?.length, 1)
eq('صفحه‌ی آخر: truncated=false، skip=۲', [rep?.page?.truncated, rep?.page?.skip], [false, 2])
eq('totals (منبع خطوط حرارتی) = کل بازه: ۳ فاکتور', rep?.totals?.count, 3)
eq('totals (منبع خطوط حرارتی) = کل بازه: ۶٬۰۰۰٬۰۰۰', rep?.totals?.grandTotal, 6_000_000)

const page = readFileSync(join(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')
const start = page.indexOf('const printThermal = async () => {')
const block = page.slice(start, page.indexOf('lines:', start))
eq('حرارتی: meta هرگز outputMetaText (هشدار صفحه) نیست', /outputMetaText/.test(block), false)
eq('حرارتی: برچسب صریح «جمع‌ها بر اساس کل فیلترشده»', /meta: `\$\{metaText\} · خلاصه و جمع‌ها بر اساس کل فیلترشده`/.test(block), true)
eq('حرارتی: خطوط از report.totals (t) خوانده می‌شوند', /const t = report\.totals/.test(page) && /value: faDigits\(t\.count\)/.test(page.slice(start, start + 1500)), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
