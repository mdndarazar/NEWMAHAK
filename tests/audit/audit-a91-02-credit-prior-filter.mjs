/**
 * ممیزی A91-02 — نشست ۹۱ ادعا کرد تب نسیه «کل فیلتر استاندارد» را مصرف می‌کند، ولی فقط فهرست
 * فاکتورها فیلتر شد؛ بخش «وصول نسیه‌ی دوره‌ی قبل» (priorSettlements و priorSettlementTotal)
 * هیچ فیلتری جز تاریخ نداشت ⇒ با فیلتر شیفت شب، وصول ۵۰۰٬۰۰۰ شیفت صبح هم در تب نسیه‌ی شیفت
 * شب می‌نشست و با عدد پل تطبیق (accounting.credit.settledPrior، مالک = شیفت دریافت، بند ۴-۵۳) نمی‌خواند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9102-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date()); const now = Date.now()
const past = now - 5 * 86400_000; const pastJ = toJalaliDate(new Date(past))
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 7200_000, userId: A })
const s2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 3600_000, userId: B })
const c1 = seed.customer('مشتری یک'); const c2 = seed.customer('مشتری دو')
const oldInv = (no, cust) => seed.insert('SaleInvoice', { receiptNo: no, userId: A, status: 'FINAL', customerId: cust, grandTotal: 1_000_000, paidTotal: 0, issuedAt: past, issuedAtJalali: pastJ, orderType: 'IN_STORE' })
const i1 = oldInv(701, c1); const i2 = oldInv(702, c2)
const pay = (invoiceId, shiftId, userId, amount) => seed.insert('Payment', { invoiceId, methodId: cash, amount, kind: 'CASH', destination: 'CASH', paidAt: now - 60_000, paidAtJalali: today, createdAt: now - 60_000, createdShiftId: shiftId, createdByUserId: userId })
pay(i1, s1, A, 500_000); pay(i2, s2, B, 200_000)
const base = { fromJalali: today, toJalali: today }
const cl2 = await salesService.creditList({ ...base, shiftId: s2 })
const rep2 = await salesService.reportRows({ ...base, shiftId: s2 })
eq('فیلتر شیفت شب: وصول نسیه‌ی دوره‌ی قبل فقط ۲۰۰٬۰۰۰ همان شیفت', cl2?.totals?.priorSettlementTotal, 200_000)
eq('تب نسیه = پل تطبیق (settledPrior) برای همان فیلتر', cl2?.totals?.priorSettlementTotal, rep2?.accounting?.credit?.settledPrior)
const clB = await salesService.creditList({ ...base, userId: A })
eq('فیلتر کارمند الف: فقط وصولی که الف ثبت کرده (۵۰۰٬۰۰۰)', clB?.totals?.priorSettlementTotal, 500_000)
const clR = await salesService.creditList({ ...base, receiptNo: 702 })
eq('فیلتر شماره فیش ۷۰۲: فقط وصول همان فاکتور', (clR?.priorSettlements ?? []).map((r) => r.receiptNo), [702])
const clC = await salesService.creditList({ ...base, customerSearch: 'یک' })
eq('فیلتر مشتری: فقط وصول «مشتری یک»', (clC?.priorSettlements ?? []).map((r) => r.receiptNo), [701])
const all = await salesService.creditList(base)
eq('بدون فیلتر: هر دو وصول (۷۰۰٬۰۰۰)', all?.totals?.priorSettlementTotal, 700_000)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
