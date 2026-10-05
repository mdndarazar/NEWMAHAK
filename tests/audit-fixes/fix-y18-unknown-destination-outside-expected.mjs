/**
 * ===========================================================================
 * نشست ۱۶۰ · Y18 · بند ۴-۲۴ — پول با مقصد نامشخص (چکِ پاس‌شده‌ی قدیمیِ بی‌مقصد / مقصد CASH|CARD
 * قدیمی که S113 آن را «نامشخص» می‌داند) هرگز با نقد جمع زده نمی‌شود.
 *
 * قبل از رفع: calculateCashClose این مبلغ را با برچسب unknownDestinationInExpected **داخل**
 * expectedCash می‌گذاشت و calculateCashStatement/accountingReport آن را داخل «وجه واقعی»
 * (clearedChequeInflow / realCash) می‌شمرد ⇒ حدس «نقد رسیده به کشو»، خلاف بند ۴-۲۴.
 * بعد از رفع (S160-D4):
 *   • expectedCash و realCash این مبلغ را ندارند؛ سبد جدای «نامشخص» (unknownDestinationOutside) با
 *     ردیف و هشدار صریح؛ unknownDestinationInExpected همیشه ۰ (سازگاری فیلد).
 *   • پل تطبیق ردیف مستقل «دریافتی با مقصد نامشخص» (+) دارد و بسته می‌ماند؛ «پاس‌شدن چک‌های
 *     بازه‌های قبل» و «وصول نسیه‌ی بازه‌های قبل» سهم نامشخص را ندارند (مثل سهم حساب مدیر).
 *   • snapshot بستن‌های قبلی دست نمی‌خورد (ستون‌های ذخیره‌شده‌ی CashSession خوانده می‌شوند).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y18-unknown-destination-outside-expected.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y18-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { ChequeStatus, PaymentDestination } = await import('@shared/enums')
const { calculateCashClose, calculateCashStatement, calculatePaymentTotals, calculateReconciliationBridge } = await import('@shared/accounting')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v, detail) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)))

const userId = seed.user('مدیر تست Y18')
const cat = seed.category('پوشاک Y18')
const variant = seed.variant(seed.product('شلوار Y18', cat), 'مشکی Y18')
sql.prepare('UPDATE "ProductVariant" SET stock = 10000 WHERE id = ?').run(variant)
const METHOD = {
  cash: seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 }),
  card: seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 }),
  cheque: seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 9 })
}
const CHQ = 10_000_000
const TOTAL = 20_000_000
const HOUR = 3_600_000
let shiftSeq = 0
const makeShift = (name) => seed.insert('Shift', { name, number: ++shiftSeq, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - HOUR, userId })
const sale = (over = {}) => salesService.create({ userId, lines: [{ variantId: variant, qty: 1, unitPrice: TOTAL, discount: 0, tax: 0 }], payments: [], ...over })
/**
 * نشست ۱۶۱ (S161-D3) — در داده‌ی واقعی چکِ پاس‌شده داخل paidTotal فاکتور است (recalcSettlement ⇒
 * receivedTotalOf). نسخه‌ی ۱۶۰ این تست paidTotal را همگام نمی‌کرد و «نسیه‌ی وصول‌نشده» را به اندازه‌ی
 * همان چک بزرگ‌تر نشان می‌داد؛ «پل باز» گزارش‌شده در ۱۶۰ برای سناریوی ۲ از همین مصنوع هارنس بود.
 */
const legacyCheque = (invoiceId, shiftId, seq, destination = null, amount = CHQ) => {
  const now = Date.now()
  sql.prepare('UPDATE "SaleInvoice" SET paidTotal = paidTotal + ? WHERE id = ?').run(amount, invoiceId)
  return seed.insert('Payment', {
    invoiceId, methodId: METHOD.cheque, amount, kind: 'CHEQUE', seq, chequeStatus: ChequeStatus.CLEARED,
    paidAt: now, paidAtJalali: toJalaliDate(new Date(now)), clearedAt: now, clearedAtJalali: toJalaliDate(new Date(now)),
    destination, createdShiftId: shiftId, clearedShiftId: shiftId
  })
}
const rowOf = (bridge, key) => bridge.rows.find((r) => r.key === key)?.amount ?? null

console.log('\n۱) توابع مشترک (بدون دیتابیس)')
{
  const r = calculateCashClose({ openingFloat: 0, cashReceived: 2_000_000, clearedUnknownChequeAmount: CHQ, countedCash: 2_000_000 })
  eq('expectedCash فقط نقد فیزیکی', r.expectedCash, 2_000_000)
  eq('مغایرت صفر (چک نامشخص کسری/اضافه نساخت)', r.cashDifference, 0)
  eq('unknownDestinationInExpected همیشه صفر', r.unknownDestinationInExpected, 0)
  eq('سبد جدای نامشخص (unknownDestinationOutside)', r.unknownDestinationOutside, CHQ)
  const s = calculateCashStatement({ payments: { cash: 2_000_000, clearedCheques: CHQ, clearedUnknownCheques: CHQ } })
  eq('netCashMovement بدون سهم نامشخص', s.netCashMovement, 2_000_000)
  eq('destinationUnknownReceived جدا', s.destinationUnknownReceived, CHQ)
  const b = calculateReconciliationBridge({ realCash: 0, destinationUnknownReceived: CHQ, uncollectedCredit: 0, netAccrualSales: CHQ })
  eq('پل ردیف «دریافتی با مقصد نامشخص» دارد', rowOf(b, 'destinationUnknownReceived'), CHQ)
  eq('پل بسته', b.unexplained, 0)
  const from = new Date(Date.now() - HOUR), to = new Date(Date.now() + HOUR)
  const t = calculatePaymentTotals([
    { amount: CHQ, kind: 'CHEQUE', chequeStatus: 'CLEARED', clearedAt: new Date(), destination: null, invoiceIssuedAt: new Date(Date.now() - 48 * HOUR) }
  ], { from, to })
  eq('چک نامشخصِ فاکتور قبلی در priorClearedCheques نیست', t.priorClearedCheques, 0)
  eq('و در priorPeriod نیست', t.priorPeriod, 0)
  eq('ولی در clearedUnknownCheques هست', t.clearedUnknownCheques, CHQ)
}

console.log('\n۲) یکپارچه: نشست باز، فاکتور همین نشست، چک قدیمی بی‌مقصد + نقد')
{
  const shiftId = makeShift('نشست Y18-۱')
  const inv = await sale({ shiftId, payments: [{ methodId: METHOD.cash, amount: 2_000_000 }] })
  legacyCheque(inv.id, shiftId, 2, null)
  const report = await salesService.reportRows({ shiftId })
  const expected = await cashboxService.expected({ shiftId, countedCash: 2_000_000 })
  const acc = report.accounting
  eq('سبد نامشخص در گزارش', acc.cash.destinationUnknownReceived, CHQ)
  eq('نقد مورد انتظار فقط نقد فیزیکی', expected.expectedCash, 2_000_000)
  eq('صندوق MATCHED با شمارش ۲٬۰۰۰٬۰۰۰', expected.state, 'MATCHED')
  eq('unknownDestinationInExpected = ۰', expected.unknownDestinationInExpected, 0)
  eq('unknownDestinationOutside = مبلغ چک', expected.unknownDestinationOutside, CHQ)
  eq('وجه واقعی پل بدون سهم نامشخص', rowOf(acc.bridge, 'realCash'), 2_000_000)
  eq('ردیف پل «دریافتی با مقصد نامشخص»', rowOf(acc.bridge, 'destinationUnknownReceived'), CHQ)
  eq('پل تطبیق بسته', acc.bridge.unexplained, 0)
  truthy('هشدار فارسی صریح در پیش‌نمایش بستن صندوق', (expected.warnings ?? []).some((w) => String(w).includes('نامشخص') && String(w).includes('نقد مورد انتظار')), JSON.stringify(expected.warnings))
  const closed = await cashboxService.close({ shiftId, explicitShift: true, countedCash: 2_000_000, userId, note: 'Y18' })
  eq('بستن: expectedCash = پیش‌نمایش', closed.cashClose.expectedCash, expected.expectedCash)
  eq('بستن: ستون نامشخص رکورد', closed.session.destinationUnknownReceived, CHQ)
  eq('بستن: مغایرت صفر', closed.cashClose.cashDifference, 0)
}

console.log('\n۳) یکپارچه: چک قدیمی (مقصد CASH قدیمی ⇒ نامشخص) روی فاکتور دیروز، پاس‌شده امروز')
{
  const shiftId = makeShift('نشست Y18-۲')
  const inv = await sale({ shiftId })
  const yesterday = Date.now() - 30 * HOUR
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(yesterday, toJalaliDate(new Date(yesterday)), inv.id)
  legacyCheque(inv.id, shiftId, 1, 'CASH')
  const today = toJalaliDate(new Date())
  const report = await salesService.reportRows({ fromJalali: today, toJalali: today })
  const acc = report.accounting
  eq('priorClearedCheques بدون سهم نامشخص', rowOf(acc.bridge, 'priorClearedCheques'), 0)
  // بازه‌ی امروز چکِ سناریوی ۲ را هم دارد (همان روز) ⇒ کل «نامشخص» = دو چک
  eq('ردیف پل «دریافتی با مقصد نامشخص» (چک سناریوی ۲ + این چک)', rowOf(acc.bridge, 'destinationUnknownReceived'), 2 * CHQ)
  eq('ردیف منفی «نامشخصِ فاکتورهای قبل» (Y19) فقط همین چک', rowOf(acc.bridge, 'priorDestinationUnknownReceived'), CHQ)
  const expected = await cashboxService.expected({ shiftId })
  eq('نقد مورد انتظار صفر (چک نامشخص وصول نسیه‌ی نقدی حساب نشد)', expected.expectedCash, 0)
  truthy('پل تطبیق بازه‌ی امروز بسته', acc.bridge.unexplained === 0, JSON.stringify({ target: acc.bridge.target, explained: acc.bridge.explainedTotal, rows: acc.bridge.rows.filter((r) => r.amount).map((r) => [r.key, r.sign * r.amount]) }))
}

console.log('\n۴) ساختار UI')
{
  const ui = readFileSync(resolve('src/renderer/src/pages/CashClose.tsx'), 'utf8')
  truthy('CashClose ردیف «خارج از نقد مورد انتظار» را نشان می‌دهد', ui.includes('unknownDestinationOutside'))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
