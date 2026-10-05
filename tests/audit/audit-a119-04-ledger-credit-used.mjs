/**
 * ممیزی نشست ۱۱۹ — A119-04 (P2): بخش ۶ «مصرف اعتبار» دفتر رویداد (SalesLedger.ledger).
 * قبل: از StoreCredit.usedAt و با مبلغ *اولیه*ی اعتبار می‌خواند (همان باگ D1 که aggregate و drill پل
 *   در A108-02 رفع کردند): مصرف ۳۰۰٬۰۰۰ از اعتبار ۱٬۰۰۰٬۰۰۰ ⇒ ۱٬۰۰۰٬۰۰۰؛ مصرف‌های قبلی اعتبار
 *   چندبارمصرف غایب؛ مصرف reversed دیده می‌شد؛ فیلتر شیفت/کارمند/کانال نداشت ⇒ دفتر ≠ پل.
 * بعد: از StoreCreditRedemption با همان redemptionWhere پل (storeCreditScopes).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11904-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const today = toJalaliDate(new Date(T0 + 3_600_000))
const Y = T0 - 86_400_000
const yday = toJalaliDate(new Date(Y + 3_600_000))
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const mSc = seed.insert('PaymentMethod', { key: 'STORE_CREDIT', label: 'اعتبار خرید', kind: 'STORE_CREDIT', isActive: 1, sortOrder: 2 })
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 60_000, userId: A })
const S2 = seed.insert('Shift', { name: 'عصر', number: 2, dayJalali: today, openedAt: T0 + 70_000, userId: B })
const inv = (no, at, j, grand, user, shift) => seed.insert('SaleInvoice', {
  receiptNo: no, status: 'SETTLED', orderType: 'INTERNAL', grandTotal: grand, paidTotal: grand, goodsTotal: grand,
  discountTotal: 0, taxTotal: 0, issuedAt: at, issuedAtJalali: j, userId: user, shiftId: shift, deductInventory: 0, settledAt: at
})
const i2 = inv(2, T0 + 110_000, today, 300_000, A, S)
const i4 = inv(4, T0 + 130_000, today, 200_000, B, S2)
const p2 = seed.insert('Payment', { invoiceId: i2, methodId: mSc, amount: 300_000, kind: 'CASH', destination: null, paidAt: T0 + 110_000, paidAtJalali: today, createdByUserId: A, createdShiftId: S })
const p4 = seed.insert('Payment', { invoiceId: i4, methodId: mSc, amount: 200_000, kind: 'CASH', destination: null, paidAt: T0 + 130_000, paidAtJalali: today, createdByUserId: B, createdShiftId: S2 })
// اعتبار چندبارمصرف ۱٬۰۰۰٬۰۰۰: دیروز ۱۰۰٬۰۰۰ + امروز ۳۰۰٬۰۰۰ (فاکتور ۲، الف/صبح)
const C1 = seed.insert('StoreCredit', { code: 'SC-1', amount: 1_000_000, source: 'MANUAL', usedAmount: 400_000, usedCount: 2, maxUses: 5, multiUse: 1, status: 'PARTIALLY_USED', issuedAt: Y + 1_000, issuedAtJalali: yday, usedAt: T0 + 110_000, usedAtJalali: today, usedInvoiceId: i2, usedReceiptNo: 2, userId: A, createdAt: Y + 1_000 })
seed.insert('StoreCreditRedemption', { creditId: C1, code: 'SC-1', amount: 100_000, remainderAfter: 900_000, seq: 1, at: Y + 2_000, atJalali: yday, userId: A })
seed.insert('StoreCreditRedemption', { creditId: C1, code: 'SC-1', amount: 300_000, remainderAfter: 600_000, seq: 2, invoiceId: i2, receiptNo: 2, paymentId: p2, at: T0 + 110_000, atJalali: today, userId: A, shiftId: S })
// اعتبار ۵۰۰٬۰۰۰: امروز ۲۰۰٬۰۰۰ (فاکتور ۴، ب/عصر) + یک مصرف ۵۰٬۰۰۰ که برگشت خورده (reversed)
const C2 = seed.insert('StoreCredit', { code: 'SC-2', amount: 500_000, source: 'MANUAL', usedAmount: 200_000, usedCount: 1, maxUses: 5, multiUse: 1, status: 'PARTIALLY_USED', issuedAt: Y + 1_000, issuedAtJalali: yday, usedAt: T0 + 140_000, usedAtJalali: today, usedInvoiceId: i4, usedReceiptNo: 4, userId: B, createdAt: Y + 1_000 })
seed.insert('StoreCreditRedemption', { creditId: C2, code: 'SC-2', amount: 200_000, remainderAfter: 300_000, seq: 1, invoiceId: i4, receiptNo: 4, paymentId: p4, at: T0 + 130_000, atJalali: today, userId: B, shiftId: S2 })
seed.insert('StoreCreditRedemption', { creditId: C2, code: 'SC-2', amount: 50_000, remainderAfter: 250_000, seq: 2, invoiceId: i4, receiptNo: 4, at: T0 + 140_000, atJalali: today, userId: B, shiftId: S2, reversedAt: new Date(T0 + 150_000), reversedReason: 'برگشت فاکتور' })

const used = (L) => L.rows.filter((r) => r.eventType === 'STORE_CREDIT_USED')
const amounts = (L) => used(L).map((r) => r.amount).sort((a, b) => a - b)
let L
try { L = await salesLedger.ledger({ fromJalali: today, toJalali: today }) } catch (e) { console.log('  ! خطا:', e.message); L = { rows: [], sections: {}, notes: [] } }
eq('امروز: هر مصرف با مبلغ خودش (۲۰۰٬۰۰۰ و ۳۰۰٬۰۰۰؛ نه مبلغ اولیه، نه reversed)', amounts(L), [200_000, 300_000])
eq('امروز: جمع مصرف = ۵۰۰٬۰۰۰', used(L).reduce((s, r) => s + r.amount, 0), 500_000)
eq('شمارنده‌ی بخش = ۲ مصرف (reversed بیرون)', L.sections?.storeCreditsUsed?.totalCount ?? null, 2)
const r300 = used(L).find((r) => r.amount === 300_000)
eq('مصرف ۳۰۰٬۰۰۰: کارمند از خود مصرف', r300?.userName ?? null, 'فروشنده الف')
eq('مصرف ۳۰۰٬۰۰۰: شیفت از خود مصرف', r300?.shiftName ?? null, 'صبح')
eq('مصرف ۳۰۰٬۰۰۰: فاکتور مقصد ۲', r300?.receiptNo ?? null, 2)
eq('مصرف ۳۰۰٬۰۰۰: اثر نقدی صفر', r300?.cashEffect ?? null, 0)
let L2
try { L2 = await salesLedger.ledger({ fromJalali: yday, toJalali: today }) } catch (e) { L2 = { rows: [] } }
eq('دیروز تا امروز: دو مصرف یک اعتبار هر دو دیده می‌شوند (۱۰۰٬۰۰۰ + ۳۰۰٬۰۰۰) + ۲۰۰٬۰۰۰', amounts(L2), [100_000, 200_000, 300_000])
eq('دو مصرف یک اعتبار کلید یکتا دارند', new Set(used(L2).map((r) => r.key)).size, used(L2).length)
for (const [label, f] of [['شیفت صبح', { shiftId: S }], ['شیفت عصر', { shiftId: S2 }], ['کارمند ب', { userId: B }]]) {
  let LL, R
  try { LL = await salesLedger.ledger({ fromJalali: today, toJalali: today, ...f }) } catch (e) { LL = { rows: [], notes: [] } }
  try { R = await salesService.reportRows({ fromJalali: today, toJalali: today, ...f }) } catch (e) { R = null }
  const bridge = R?.accounting?.bridge?.rows?.find((r) => r.key === 'storeCreditUsed')?.amount ?? null
  eq(`${label}: جمع مصرف دفتر = ردیف پل (${bridge})`, used(LL).reduce((s, r) => s + r.amount, 0), bridge)
  eq(`${label}: یادداشت «کل بازه» برای مصرف اعتبار نمی‌آید`, (LL.notes ?? []).some((x) => x.includes('مصرف اعتبار') && x.includes('کل بازه')), false)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
