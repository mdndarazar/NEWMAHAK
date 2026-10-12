/**
 * ممیزی نشست ۱۰۸ — drill-down پل تطبیق (bridgeSources) با count/skip/take نشست ۱۰۸، رفتاری.
 * قاعده‌ی ثابت: «جدول، شمارنده و پل برای یک فیلتر یک عدد». اسناد سازنده‌ی هر ردیف پل باید دقیقاً همان
 * اسنادی باشند که عدد ردیف از آن‌ها ساخته شده: جمع مبلغ اسناد = عدد ردیف، و totalCount = تعداد اسناد.
 * A108-01 (P2): realCash / priorCreditSettlements / priorClearedCheques / overpayReceived:
 *   count روی where خام (با پرداخت اعتبار خرید و مقصد حساب مدیر) و فیلتر اعتبار بعد از skip/take در JS ⇒
 *   totalCount دروغ، صفحه‌های کم‌ردیف/خالی با «صفحه‌ی بعد»؛ دریافتی حساب مدیر در drill نقد واقعی
 *   (ردیف آن را ندارد)؛ چک پاس‌شده‌ی دوره‌ی قبل در «وصول نسیه‌ی دوره‌ی قبل» غایب (ردیف دارد).
 * A108-02 (P2): storeCreditUsed از StoreCredit.usedAt با مبلغ *اولیه* (همان باگ D1 که aggregate رفع کرد)؛
 *   storeCreditIssued بدون فیلتر مالک/هویت (A97-01) ⇒ با فیلتر کارمند اعتبار کارمند دیگر در drill.
 * نشست ۱۶۲ · S162-D1 — انتظارهای این تست به قاعده‌ی بند ۴-۲۴ (Y18) و Y19 به‌روز شد: چک پاس‌شده‌ی
 *   بی‌مقصد (سبد «نامشخص») دیگر نه در realCash است، نه در «وصول نسیه‌ی دوره‌ی قبل»/«پاس‌شدن چک‌های قبل»؛
 *   ردیف جدای destinationUnknownReceived (+) و ردیف‌های منفی priorManagerAccountReceived /
 *   priorDestinationUnknownReceived (Y19) دارد. قاعده‌ی ثابت تست (جمع drill = عدد ردیف) دست نخورد و
 *   حالا روی این سه ردیف تازه هم اعمال می‌شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10801-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const Y = T0 - 86_400_000
const yday = toJalaliDate(new Date(Y + 3_600_000))
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const mCash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const mSc = seed.insert('PaymentMethod', { key: 'STORE_CREDIT', label: 'اعتبار خرید', kind: 'STORE_CREDIT', isActive: 1, sortOrder: 2 })
const mC2c = seed.insert('PaymentMethod', { key: 'C2C', label: 'کارت‌به‌کارت', kind: 'CUSTOM', isActive: 1, sortOrder: 3 })
const mChq = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 4 })
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 60_000, userId: A })
const inv = (no, at, j, grand, paid, status = 'SETTLED') => seed.insert('SaleInvoice', {
  receiptNo: no, status, orderType: 'INTERNAL', grandTotal: grand, paidTotal: paid, goodsTotal: grand,
  discountTotal: 0, taxTotal: 0, issuedAt: at, issuedAtJalali: j, userId: A, shiftId: S, deductInventory: 0,
  settledAt: status === 'SETTLED' ? at : null
})
const pay = (o) => seed.insert('Payment', { createdByUserId: A, createdShiftId: S, kind: 'CASH', paidAtJalali: today, ...o })
// امروز: نقد ۱٬۰۰۰٬۰۰۰ | اعتبار خرید ۳۰۰٬۰۰۰ | حساب مدیر ۵۰۰٬۰۰۰
const i1 = inv(1, T0 + 100_000, today, 1_000_000, 1_000_000)
pay({ invoiceId: i1, methodId: mCash, amount: 1_000_000, destination: 'CASH', paidAt: T0 + 100_000 })
const i2 = inv(2, T0 + 110_000, today, 300_000, 300_000)
const pSc = pay({ invoiceId: i2, methodId: mSc, amount: 300_000, destination: null, paidAt: T0 + 110_000 })
const i3 = inv(3, T0 + 120_000, today, 500_000, 500_000)
pay({ invoiceId: i3, methodId: mC2c, amount: 500_000, destination: 'MANAGER', paidAt: T0 + 120_000 })
// دیروز (دوره‌ی قبل): وصول نقدی امروز ۲۰۰٬۰۰۰ | وصول به حساب مدیر ۱۵۰٬۰۰۰ | چک پاس‌شده‌ی امروز: مدیر ۷۰۰٬۰۰۰ و نامشخص ۴۰۰٬۰۰۰
const p1 = inv(11, Y + 3_600_000, yday, 5_000_000, 0, 'CREDIT')
pay({ invoiceId: p1, methodId: mCash, amount: 200_000, destination: 'CASH', paidAt: T0 + 200_000 })
pay({ invoiceId: p1, methodId: mC2c, amount: 150_000, destination: 'MANAGER', paidAt: T0 + 210_000 })
pay({ invoiceId: p1, methodId: mChq, amount: 700_000, kind: 'CHEQUE', chequeStatus: 'CLEARED', destination: 'MANAGER', paidAt: Y + 3_700_000, paidAtJalali: yday, clearedAt: T0 + 220_000, clearedShiftId: S, clearedByUserId: A })
pay({ invoiceId: p1, methodId: mChq, amount: 400_000, kind: 'CHEQUE', chequeStatus: 'CLEARED', destination: null, paidAt: Y + 3_800_000, paidAtJalali: yday, clearedAt: T0 + 230_000, clearedShiftId: S, clearedByUserId: A })
// اعتبار چندبارمصرف ۱٬۰۰۰٬۰۰۰: مصرف دیروز ۱۰۰٬۰۰۰ و امروز ۳۰۰٬۰۰۰ (روی فاکتور ۲)
const C1 = seed.insert('StoreCredit', { code: 'SC-1', amount: 1_000_000, source: 'MANUAL', usedAmount: 400_000, usedCount: 2, maxUses: 5, multiUse: 1, status: 'PARTIALLY_USED', issuedAt: Y + 1_000, issuedAtJalali: yday, usedAt: T0 + 110_000, usedAtJalali: today, usedInvoiceId: i2, userId: A, createdAt: Y + 1_000 })
seed.insert('StoreCreditRedemption', { creditId: C1, code: 'SC-1', amount: 100_000, remainderAfter: 900_000, seq: 1, at: Y + 2_000, atJalali: yday })
seed.insert('StoreCreditRedemption', { creditId: C1, code: 'SC-1', amount: 300_000, remainderAfter: 600_000, seq: 2, invoiceId: i2, receiptNo: 2, paymentId: pSc, at: T0 + 110_000, atJalali: today })
// اعتبار صادرشده‌ی امروز: یکی از الف (۲۵۰٬۰۰۰) و یکی از ب (۹۰۰٬۰۰۰)
// نشست ۱۷۰ · S169-D4 (DECISIONS S170-D1) — ردیف «اعتبار صادرشده»ی پل فقط اعتبار سند‌دار (returnId ≠ null)
// را می‌شمارد؛ اعتبار دستی بی‌سند دیگر در پل نیست. هدف این تست (مالکیت/drill همان where ردیف) است، پس
// fixture از MANUAL به اعتبارِ برگشتیِ سند‌دار تغییر کرد؛ اعداد و انتظارها دست نخوردند.
// سند برگشتِ مالک (بدون قلم/مبلغ، فقط برای نسبت‌دادن صدور به کارمند — مالک رویداد A97-01)
const rA = seed.insert('SaleReturn', { invoiceId: i1, total: 0, kind: 'RETURN', returnedAt: T0 + 300_000, returnedAtJalali: today, userId: A, shiftId: S })
const rB = seed.insert('SaleReturn', { invoiceId: i1, total: 0, kind: 'RETURN', returnedAt: T0 + 310_000, returnedAtJalali: today, userId: B, shiftId: S })
seed.insert('StoreCredit', { code: 'SC-A', amount: 250_000, source: 'EXCHANGE', returnId: rA, status: 'ACTIVE', issuedAt: T0 + 300_000, issuedAtJalali: today, userId: A, createdAt: T0 + 300_000 })
const SC_B = seed.insert('StoreCredit', { code: 'SC-B', amount: 900_000, source: 'EXCHANGE', returnId: rB, status: 'ACTIVE', issuedAt: T0 + 310_000, issuedAtJalali: today, userId: B, createdAt: T0 + 310_000 })

const KEYS = ['realCash', 'priorCreditSettlements', 'priorClearedCheques', 'storeCreditUsed', 'storeCreditIssued', 'overpayReceived', 'managerAccountReceived',
  // نشست ۱۶۲ · S162-D1 — ردیف‌های Y18/Y19
  'destinationUnknownReceived', 'priorManagerAccountReceived', 'priorDestinationUnknownReceived']
async function bridge(extra = {}) {
  const r = await salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceTake: 2000, ...extra })
  return r.accounting?.bridge?.rows ?? []
}
function check(rows, key, tag) {
  const row = rows.find((r) => r.key === key)
  if (!row) return
  const sum = (row.sources ?? []).reduce((s, x) => s + Number(x.amount ?? 0), 0)
  eq(`${tag}${key}: جمع اسناد drill = عدد ردیف (${Math.abs(row.amount)})`, sum, Math.abs(row.amount))
  eq(`${tag}${key}: totalCount = تعداد اسناد نمایش‌داده‌شده`, row.sourcesPage?.totalCount ?? (row.sources ?? []).length, (row.sources ?? []).length)
}
console.log('— بدون فیلتر')
const rows = await bridge()
eq('پیش‌شرط: ردیف‌های پل موجودند', KEYS.slice(0, 5).every((k) => rows.some((r) => r.key === k)), true)
const amt = (k) => Math.abs(rows.find((r) => r.key === k)?.amount ?? NaN)
/**
 * نشست ۱۶۲ · S162-D1 — قبلاً: realCash ۱٬۶۰۰٬۰۰۰ (با چک نامشخص ۴۰۰٬۰۰۰)، prior ۶۰۰٬۰۰۰، priorCheque ۴۰۰٬۰۰۰
 * (قاعده‌ی کهنه‌ی پیش از بند ۴-۲۴). حالا چک نامشخص فقط در ردیف خودش می‌آید.
 */
eq('پیش‌شرط اعداد پل: realCash ۱٬۲۰۰٬۰۰۰، prior ۲۰۰٬۰۰۰، priorCheque ۰، used ۳۰۰٬۰۰۰، issued ۱٬۱۵۰٬۰۰۰',
  ['realCash', 'priorCreditSettlements', 'priorClearedCheques', 'storeCreditUsed', 'storeCreditIssued'].map(amt),
  [1_200_000, 200_000, 0, 300_000, 1_150_000])
eq('پیش‌شرط ردیف‌های Y18/Y19 موجودند', KEYS.slice(7).every((k) => rows.some((r) => r.key === k)), true)
eq('Y18/Y19: مدیر ۱٬۳۵۰٬۰۰۰، نامشخص ۴۰۰٬۰۰۰، مدیرِ قبل ۸۵۰٬۰۰۰، نامشخصِ قبل ۴۰۰٬۰۰۰',
  ['managerAccountReceived', 'destinationUnknownReceived', 'priorManagerAccountReceived', 'priorDestinationUnknownReceived'].map(amt),
  [1_350_000, 400_000, 850_000, 400_000])
const sgn = (k) => rows.find((r) => r.key === k)?.sign
eq('علامت: نامشخص +، مدیرِ قبل −، نامشخصِ قبل −',
  ['destinationUnknownReceived', 'priorManagerAccountReceived', 'priorDestinationUnknownReceived'].map(sgn), [1, -1, -1])
const labels = (k) => (rows.find((r) => r.key === k)?.sources ?? []).map((s) => `${s.label}:${s.amount}`).sort()
eq('drill نامشخص فقط همان چک بی‌مقصد ۴۰۰٬۰۰۰', labels('destinationUnknownReceived'), ['فاکتور 11 · چک:400000'])
eq('drill نامشخصِ قبل فقط همان چک بی‌مقصد ۴۰۰٬۰۰۰', labels('priorDestinationUnknownReceived'), ['فاکتور 11 · چک:400000'])
eq('drill realCash چک ندارد (نه مدیر، نه نامشخص)', labels('realCash').some((l) => l.includes('چک')), false)
eq('drill مدیرِ قبل: چک مدیر ۷۰۰٬۰۰۰ + کارت‌به‌کارت ۱۵۰٬۰۰۰ (نه دریافتی فاکتور امروز)',
  labels('priorManagerAccountReceived'), ['فاکتور 11 · چک:700000', 'فاکتور 11 · کارت‌به‌کارت:150000'].sort())
for (const k of KEYS) check(rows, k, '')
console.log('— صفحه‌بندی: take=1 روی realCash')
let seen = 0, pages = 0, emptyWithNext = 0
for (let skip = 0; skip < 20 && pages < 10; ) {
  const rr = await salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceKey: 'realCash', bridgeSourceSkip: skip, bridgeSourceTake: 1 })
  const row = rr.accounting.bridge.rows.find((r) => r.key === 'realCash'); pages++
  seen += row.sources.length
  if (row.sources.length === 0 && row.sourcesPage?.truncated) emptyWithNext++
  if (!row.sourcesPage?.truncated) break
  skip += 1
}
eq('هیچ صفحه‌ی خالی با «صفحه‌ی بعد» نیست', emptyWithNext, 0)
// نشست ۱۶۲ · S162-D1 — چک نامشخص دیگر سند realCash نیست (بند ۴-۲۴)
eq('صفحه‌ها روی هم همان ۲ سند realCash (نقد، وصول نقد دوره‌ی قبل)', [seen, pages], [2, 2])
console.log('— فیلتر کارمند ب (A108-02 صدور)')
const rowsB = await bridge({ userId: B })
check(rowsB, 'storeCreditIssued', '[کارمند ب] ')
const iss = rowsB.find((r) => r.key === 'storeCreditIssued')
eq('[کارمند ب] drill صدور فقط شناسهٔ امن اعتبار ب است', (iss?.sources ?? []).map((s) => s.id), [SC_B])
eq('[کارمند ب] drill صدور credential اعتبار را در برچسب افشا نمی‌کند', (iss?.sources ?? []).some((s) => s.label.includes('SC-B')), false)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
