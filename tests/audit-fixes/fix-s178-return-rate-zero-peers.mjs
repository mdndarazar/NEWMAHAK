/**
 * نشست ۱۷۸ (S178-D3) — مشاهده‌ی P3 ردیف ۸۹ AUDIT-PROGRESS («همتایان بدون برگشت در میانه‌ی baseline نمی‌آیند ⇒
 * baseline به بالا متمایل») با کد تطبیق داده شد و ایراد واقعی ضدسرقت است:
 *   • FraudService.review فقط کاربرانی را به detectReturnRateOutliers می‌داد که در بازه برگشت داشتند؛
 *   • detectReturnRateOutliers هم ردیف‌های returnTotal = 0 را از همتایان حذف می‌کرد.
 * مثال: سه فروشنده‌ی سالم با فروش ۱۰٬۰۰۰٬۰۰۰ و بدون برگشت، یک همتا با ۳۰٪ برگشت، و فروشنده‌ی الف با دو برگشت
 * ۲٬۷۵۰٬۰۰۰ روی فروش ۱۰٬۰۰۰٬۰۰۰ (۵۵٪). baseline الف = ۳۰٪ (فقط همتای برگشت‌دار) ⇒ آستانه ۶۰٪ ⇒ هیچ هشداری.
 * رفع: همتای دارای فروش هم‌دامنه با نرخ صفر در میانه می‌آید ⇒ میانه ۰ ⇒ آستانه‌ی کف ۲۵٪ ⇒ الف (۵۵٪) و همتای ۳۰٪ هشدار.
 * نامزد هشدار همچنان حداقل دو برگشت لازم دارد (فروشنده‌ی بی‌برگشت هرگز هشدار نمی‌گیرد).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s178rr-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService, detectReturnRateOutliers } = await import('../../src/main/services/FraudService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db

console.log('— ۱) helper خالص')
const pure = detectReturnRateOutliers([
  { userId: 1, returnTotal: 5_500_000, returnCount: 2, salesTotal: 10_000_000 },
  { userId: 2, returnTotal: 0, returnCount: 0, salesTotal: 10_000_000 },
  { userId: 3, returnTotal: 0, returnCount: 0, salesTotal: 10_000_000 },
  { userId: 4, returnTotal: 0, returnCount: 0, salesTotal: 10_000_000 },
  { userId: 5, returnTotal: 3_000_000, returnCount: 2, salesTotal: 10_000_000 }
])
eq('همتای بی‌برگشت در میانه می‌آید ⇒ الف (۵۵٪) و همتای ۳۰٪ هشدار', pure.map((x) => x.userId).sort(), [1, 5])
eq('baseline الف = میانه‌ی [۰،۰،۰،۳۰٪] = ۰ و آستانه = کف ۲۵٪', [pure.find((x) => x.userId === 1)?.baseline, pure.find((x) => x.userId === 1)?.threshold], [0, 0.25])
eq('فروشنده‌ی بی‌برگشت هرگز هشدار نمی‌گیرد', pure.some((x) => [2, 3, 4].includes(x.userId)), false)
const pureSingle = detectReturnRateOutliers([
  { userId: 1, returnTotal: 4_000_000, returnCount: 1, salesTotal: 10_000_000 },
  { userId: 2, returnTotal: 0, returnCount: 0, salesTotal: 10_000_000 }
])
eq('یک برگشت تنها (۴۰٪) کنار همتای ۰٪ هم هشدار نرخ نمی‌سازد', pureSingle.length, 0)
const pureOne = detectReturnRateOutliers([
  { userId: 1, returnTotal: 400, returnCount: 2, salesTotal: 1000 },
  { userId: 2, returnTotal: 100, returnCount: 2, salesTotal: 1000 }
])
eq('قرارداد قبلی fix-s89 (۴۰٪ در برابر ۱۰٪) حفظ شد', pureOne.map((x) => x.userId), [1])
const pureNoSalesPeer = detectReturnRateOutliers([
  { userId: 1, returnTotal: 300, returnCount: 2, salesTotal: 1000 },
  { userId: 2, returnTotal: 0, returnCount: 0, salesTotal: 0 }
])
eq('همتای بدون فروش و بدون برگشت نرخی ندارد و baseline نمی‌سازد (کف مطلق ۲۵٪ ⇒ ۳۰٪ هشدار)', [pureNoSalesPeer.map((x) => x.userId), pureNoSalesPeer[0]?.baseline], [[1], null])

console.log('\n— ۲) مسیر واقعی FraudService.review')
const today = toJalaliDate(new Date()); const now = Date.now()
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب'); const C = seed.user('فروشنده ج'); const D = seed.user('فروشنده د'); const E = seed.user('فروشنده ه')
const shift = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 7200_000, userId: A })
const shift2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 3600_000, userId: B })
let rno = 1
const inv = (userId, total, shiftId = shift) => seed.insert('SaleInvoice', { receiptNo: rno++, userId, shiftId, status: 'FINAL', grandTotal: total, paidTotal: total, issuedAt: now - 60_000, issuedAtJalali: today })
const ret = (invoiceId, userId, total, shiftId = shift) => seed.insert('SaleReturn', { invoiceId, userId, shiftId, total, returnedAt: now - 30_000, returnedAtJalali: today, kind: 'RETURN' })
const iA = inv(A, 10_000_000); inv(B, 10_000_000); inv(C, 10_000_000); inv(D, 10_000_000); const iE = inv(E, 10_000_000)
ret(iA, A, 2_750_000); ret(iA, A, 2_750_000)
ret(iE, E, 1_500_000); ret(iE, E, 1_500_000)
// فروش بزرگ بی‌برگشتِ شیفت دیگر: نباید در فیلتر شیفت صبح baseline بسازد
inv(B, 90_000_000, shift2)
const flag = (r) => r.flags.find((f) => f.key === 'returnRateByUser')
const day = await fraudService.review({ fromJalali: today, toJalali: today })
eq('بدون فیلتر: هشدار نرخ برگشت برای الف (۵۵٪) و ه (۳۰٪)', (flag(day)?.sources ?? []).map((s) => s.id).sort(), [A, E].sort())
eq('برچسب الف نسبت ۵۵٪', /۵۵٪/.test((flag(day)?.sources ?? []).find((s) => s.id === A)?.label ?? ''), true)
eq('مبلغ هشدار = جمع برگشت دو کاربر (۸٬۵۰۰٬۰۰۰)', flag(day)?.amount, 8_500_000)
const byShift = await fraudService.review({ fromJalali: today, toJalali: today, shiftId: shift })
eq('فیلتر شیفت صبح: همان دو هشدار (همتای بی‌برگشت همان شیفت در میانه)', (flag(byShift)?.sources ?? []).map((s) => s.id).sort(), [A, E].sort())
const onlyE = await fraudService.review({ fromJalali: today, toJalali: today, userId: E })
eq('فیلتر فقط کاربر ه: بدون همتا ⇒ کف ۲۵٪ ⇒ ۳۰٪ هشدار (رفتار قبلی حفظ)', (flag(onlyE)?.sources ?? []).map((s) => s.id), [E])
// کنترل منفی: وقتی همتایان واقعاً نرخ بالای مشابه دارند، ۵۵٪ عادی است
sql.prepare('DELETE FROM "SaleReturn"').run()
ret(iA, A, 2_750_000); ret(iA, A, 2_750_000)
for (const [u, i] of [[B, 2], [C, 3], [D, 4], [E, iE]]) { ret(i, u, 2_500_000); ret(i, u, 2_500_000) }
const high = await fraudService.review({ fromJalali: today, toJalali: today, shiftId: shift })
eq('کنترل: همه‌ی همتایان ۵۰٪ ⇒ الف ۵۵٪ زیر آستانه (۱۰۰٪) ⇒ بی‌هشدار', flag(high)?.count ?? 0, 0)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
