/**
 * ===========================================================================
 * نشست ۱۶۱ · Y19 (یافته‌ی تازه‌ی حین Y18) · بند ۴-۲ / ۴-۱۲ / ۴-۲۴ و هدف «هر عدد با عدد دیگر بخواند»
 *
 * باگ: پولی که امروز بابت فاکتورِ بازه‌های قبل به «حساب مدیر» رفته (پرداخت مقصد‌مدیر یا چکِ پاس‌شده‌ی
 * مقصد‌مدیر) در ردیف «دریافتی به حساب مدیر» (+) پل تطبیق می‌آمد، ولی چون فاکتورش در این بازه نیست
 * هیچ اثری روی «نسیه‌ی وصول‌نشده‌ی این بازه» یا فروش خالص این بازه نداشت و هیچ ردیف منفی‌ای هم آن را
 * خنثی نمی‌کرد (عمداً از «وصول نسیه‌ی بازه‌های قبل» بیرون است چون به صندوق نرسیده) ⇒ پل دقیقاً به
 * اندازه‌ی همان مبلغ باز می‌ماند و هشدار «بدون توضیح» می‌داد. سبد «نامشخص» (Y18) همین رفتار را دارد.
 *
 * رفع (S161-D2): دو ردیف منفی مستقل در پل:
 *   priorManagerAccountReceived  «دریافتی حساب مدیر بابت فاکتورهای بازه‌های قبل»
 *   priorDestinationUnknownReceived «دریافتی با مقصد نامشخص بابت فاکتورهای بازه‌های قبل»
 * هیچ‌کدام وارد «وصول نسیه‌ی بازه‌های قبل»/نقد مورد انتظار نمی‌شوند (بند ۴-۱۳/۴-۲۴ حفظ است).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y19-prior-manager-bridge.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y19-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { ChequeStatus } = await import('@shared/enums')
const { calculateReconciliationBridge } = await import('@shared/accounting')
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
const rowOf = (bridge, key) => bridge.rows.find((r) => r.key === key)?.amount ?? null
const brief = (b) => JSON.stringify({ target: b.target, rows: b.rows.filter((r) => r.amount).map((r) => [r.key, r.sign * r.amount]) })

const userId = seed.user('مدیر تست Y19')
const cat = seed.category('پوشاک Y19')
const variant = seed.variant(seed.product('شلوار Y19', cat), 'آبی Y19')
sql.prepare('UPDATE "ProductVariant" SET stock = 10000 WHERE id = ?').run(variant)
const METHOD = {
  cash: seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 }),
  c2c: seed.insert('PaymentMethod', { key: 'C2C', label: 'کارت‌به‌کارت', kind: 'CARD', isActive: 1, sortOrder: 3 }),
  cheque: seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 9 })
}
const HOUR = 3_600_000
const TOTAL = 20_000_000
const shiftId = seed.insert('Shift', { name: 'نشست Y19', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - HOUR, userId })
const sale = (over = {}) => salesService.create({ userId, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: TOTAL, discount: 0, tax: 0 }], payments: [], ...over })
/** پرداخت داده‌ی تحت آزمون + همگام‌سازی paidTotal فاکتور مثل مسیر واقعی (recalcSettlement ⇒ receivedTotalOf) */
const pay = (invoiceId, row) => {
  const now = Date.now()
  seed.insert('Payment', {
    invoiceId, amount: row.amount, seq: row.seq, kind: row.kind ?? 'PAYMENT', methodId: row.methodId,
    paidAt: now, paidAtJalali: toJalaliDate(new Date(now)), destination: row.destination ?? null,
    createdShiftId: shiftId,
    ...(row.kind === 'CHEQUE' ? { chequeStatus: ChequeStatus.CLEARED, clearedAt: now, clearedAtJalali: toJalaliDate(new Date(now)), clearedShiftId: shiftId } : {})
  })
  sql.prepare('UPDATE "SaleInvoice" SET paidTotal = paidTotal + ? WHERE id = ?').run(row.amount, invoiceId)
}
const toYesterday = (id) => {
  const y = Date.now() - 30 * HOUR
  sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(y, toJalaliDate(new Date(y)), id)
}
const today = toJalaliDate(new Date())

console.log('\n۱) تابع مشترک پل')
{
  const b = calculateReconciliationBridge({ realCash: 0, managerAccountReceived: 7_000_000, priorManagerAccountReceived: 7_000_000,
    destinationUnknownReceived: 3_000_000, priorDestinationUnknownReceived: 3_000_000, netAccrualSales: 0 })
  eq('ردیف «دریافتی حساب مدیر بابت فاکتورهای بازه‌های قبل»', rowOf(b, 'priorManagerAccountReceived'), 7_000_000)
  eq('ردیف «دریافتی نامشخص بابت فاکتورهای بازه‌های قبل»', rowOf(b, 'priorDestinationUnknownReceived'), 3_000_000)
  eq('علامت منفی', b.rows.find((r) => r.key === 'priorManagerAccountReceived')?.sign ?? null, -1)
  eq('پل بسته', b.unexplained, 0)
}

console.log('\n۲) یکپارچه: فاکتور دیروز، امروز کارت‌به‌کارت مقصد مدیر + چک پاس‌شده‌ی مقصد مدیر')
{
  const inv = await sale()
  toYesterday(inv.id)
  pay(inv.id, { methodId: METHOD.c2c, amount: 4_000_000, seq: 1, destination: 'MANAGER' })
  pay(inv.id, { methodId: METHOD.cheque, amount: 6_000_000, seq: 2, kind: 'CHEQUE', destination: 'MANAGER' })
  const acc = (await salesService.reportRows({ fromJalali: today, toJalali: today })).accounting
  eq('دریافتی به حساب مدیر (کل)', rowOf(acc.bridge, 'managerAccountReceived'), 10_000_000)
  eq('ردیف منفی حساب مدیرِ فاکتورهای قبل', rowOf(acc.bridge, 'priorManagerAccountReceived'), 10_000_000)
  eq('وصول نسیه‌ی بازه‌های قبل سهم مدیر را ندارد (بند ۴-۱۳)', rowOf(acc.bridge, 'priorCreditSettlements'), 0)
  eq('پل تطبیق امروز بسته — ' + brief(acc.bridge), acc.bridge.unexplained, 0)
  const exp = await cashboxService.expected({ shiftId })
  eq('نقد مورد انتظار دست نخورد (پول مدیر در کشو نیست)', exp.expectedCash, 0)
}

console.log('\n۳) یکپارچه: همان روز، فاکتور امروز با نقد + مقصد مدیر (ردیف منفی نباید چیزی بسازد)')
{
  const inv = await sale()
  pay(inv.id, { methodId: METHOD.cash, amount: 2_000_000, seq: 1 })
  pay(inv.id, { methodId: METHOD.c2c, amount: 5_000_000, seq: 2, destination: 'MANAGER' })
  const acc = (await salesService.reportRows({ fromJalali: today, toJalali: today })).accounting
  eq('ردیف منفی فقط سهم فاکتورهای قبل (بدون تغییر)', rowOf(acc.bridge, 'priorManagerAccountReceived'), 10_000_000)
  eq('دریافتی به حساب مدیر (کل) = ۱۰ + ۵ میلیون', rowOf(acc.bridge, 'managerAccountReceived'), 15_000_000)
  eq('پل تطبیق امروز بسته — ' + brief(acc.bridge), acc.bridge.unexplained, 0)
}

console.log('\n۴) ریزجزئیات (drill) ردیف تازه به پرداخت‌های سازنده می‌رسد')
{
  const r = await salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceKey: 'priorManagerAccountReceived' })
  const row = r.accounting.bridge.rows.find((x) => x.key === 'priorManagerAccountReceived')
  const sum = (row?.sources ?? []).reduce((s, x) => s + Number(x.amount ?? 0), 0)
  eq('جمع اسناد drill = مبلغ ردیف', sum, 10_000_000)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
