/**
 * ممیزی A91-01 — نشست ۹۱ فیلتر shiftId/userId را هم روی خودِ سند برگشت/تعویض (byShift/userId)
 * و هم روی فاکتور مرجع (reportInvoiceRelationWhere) اعمال کرد ⇒ اشتراک دو مالک. برگشتی که در
 * شیفت شب روی فاکتورِ شیفت صبح (یا دیروز) ثبت شد، نه در گزارش شیفت شب می‌آمد نه شیفت صبح؛
 * همین در شمارنده‌ی reportLimits. پول بازپرداخت از کشوی شیفت شب خارج شده ولی سندش پنهان بود.
 * قاعده‌ی مرجع: دفتر رویداد (returnEventOwnerWhere) مالک رویداد = scalarهای خودِ SaleReturn.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9101-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { reportLimitsService } = await import('../../src/main/services/reportLimits.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date()); const now = Date.now()
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 7200_000, userId: A })
const s2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 3600_000, userId: B })
const inv = seed.insert('SaleInvoice', { receiptNo: 501, userId: A, shiftId: s1, status: 'FINAL', grandTotal: 1_000_000, paidTotal: 1_000_000, issuedAt: now - 5000_000, issuedAtJalali: today, orderType: 'IN_STORE' })
const ret = seed.insert('SaleReturn', { invoiceId: inv, userId: B, shiftId: s2, total: 400_000, returnedAt: now - 60_000, returnedAtJalali: today, kind: 'RETURN' })
const exc = seed.insert('SaleReturn', { invoiceId: inv, userId: B, shiftId: s2, total: 300_000, returnedAt: now - 30_000, returnedAtJalali: today, kind: 'EXCHANGE' })
const ids = (r) => (r?.rows ?? r ?? []).map((x) => x.id ?? x.returnId).filter(Boolean).sort()
const base = { fromJalali: today, toJalali: today }
const r2 = await salesService.returnList({ ...base, shiftId: s2 })
eq('تب برگشت با فیلتر شیفت شب: برگشت ۴۰۰٬۰۰۰ ثبت‌شده در شیفت شب دیده می‌شود', ids(r2), [ret])
const r1 = await salesService.returnList({ ...base, shiftId: s1 })
eq('تب برگشت با فیلتر شیفت صبح: برگشتِ شیفت شب نمی‌آید (یک‌بار، در شیفت ثبت)', ids(r1), [])
const rB = await salesService.returnList({ ...base, userId: B })
eq('تب برگشت با فیلتر کارمند ب (ثبت‌کننده): دیده می‌شود', ids(rB), [ret])
const e2 = await salesService.exchangeList({ ...base, shiftId: s2 })
eq('تب تعویض با فیلتر شیفت شب: تعویض ثبت‌شده در شیفت شب دیده می‌شود', (e2?.rows ?? []).length, 1)
const eB = await salesService.exchangeList({ ...base, userId: B })
eq('تب تعویض با فیلتر کارمند ب: دیده می‌شود', (eB?.rows ?? []).length, 1)
const eA = await salesService.exchangeList({ ...base, userId: A })
eq('تب تعویض با فیلتر کارمند الف (فقط فروشنده‌ی فاکتور): نمی‌آید، هم‌معنا با تب برگشت', (eA?.rows ?? []).length, 0)
const lim = await reportLimitsService.limits({ ...base, shiftId: s2 })
eq('شمارنده‌ی سقف با فیلتر شیفت شب: ۱ برگشت و ۱ تعویض (هم‌سان با جدول)', ['returns','exchanges'].map((k) => lim?.rows?.find((r) => r.key === k)?.total), [1, 1])
// S340: kind در schema اجباری است؛ جدول و شمارنده با تیک «تعویض‌ها را هم نشان بده»
// باید از یک دامنه استفاده کنند و هیچ null جعلی به Prisma نفرستند.
const rWithExchanges = await salesService.returnList({ ...base, shiftId: s2, includeExchanges: true })
const limWithExchanges = await reportLimitsService.limits({ ...base, shiftId: s2, includeExchanges: true })
eq('S340: تیک تعویض‌ها جدول برگشت را از ۱ به ۲ سند می‌رساند', ids(rWithExchanges), [ret, exc])
eq('S340: شمارنده با همان تیک دقیقاً ۲ سند (RETURN + EXCHANGE) است', limWithExchanges?.rows?.find((r) => r.key === 'returns')?.total, 2)
const rNo = await salesService.returnList({ ...base, shiftId: s2, receiptNo: 501 })
eq('فیلتر شماره فیش همچنان روی فاکتور مرجع کار می‌کند', ids(rNo), [ret])
const rNo2 = await salesService.returnList({ ...base, shiftId: s2, receiptNo: 999 })
eq('فیش دیگر ⇒ خالی', ids(rNo2), [])
// A91-03 — نوع سفارش نوار فیلتر: جدول و شمارنده باید یکسان فیلتر کنند (فاکتور IN_STORE است)
const rPhone = await salesService.returnList({ ...base, orderType: 'PHONE' })
const limPhone = await reportLimitsService.limits({ ...base, orderType: 'PHONE' })
eq('A91-03: نوع سفارش «تلفنی» ⇒ برگشتِ فاکتور حضوری در جدول نمی‌آید', ids(rPhone), [])
eq('A91-03: جدول برگشت = شمارنده‌ی سقف با همان نوع سفارش', ids(rPhone).length, limPhone?.rows?.find((r) => r.key === 'returns')?.total)
const ePhone = await salesService.exchangeList({ ...base, orderType: 'PHONE' })
eq('A91-03: تب تعویض هم نوع سفارش را اعمال می‌کند', (ePhone?.rows ?? []).length, 0)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
