/**
 * ممیزی A88-03 — نشت پرداختِ باطل‌شده (Payment.voidedAt) به محاسبه‌ها و گزارش‌ها.
 * deletePayment پرداخت را void می‌کند و recalcSettlement/فهرست اصلی آن را کنار می‌گذارند، ولی
 * چند خوانش فیلتر voidedAt نداشتند: هشدار اضافه‌دریافت addPayment، «وصول نسیه‌ی دوره‌ی قبل» در
 * پل تطبیق (accountingReport ⇒ priorPeriod/realCash) و دفتر رویداد (SalesLedger)، فهرست
 * creditList، بدهی مبدأ تعویض، و جمع تجمعی ShiftPaymentRow در CashboxService.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const tryDo = async (label, fn) => { try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} · خطا: ${String(e?.message ?? e).split('\n')[0]}`); return undefined } }
const findKey = (o, k, out = []) => { if (o && typeof o === 'object') for (const [kk, v] of Object.entries(o)) { if (kk === k) out.push(v); findKey(v, k, out) } return out }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a8803-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست نشت ابطال' }
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const p = seed.product('جین', seed.category('پوشاک'))
const v1 = seed.variant(p, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000').run()
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A })

// (۱) addPayment بعد از ابطال: فاکتور ۱٬۰۰۰٬۰۰۰ تمام‌نقد، پرداخت باطل، پرداخت درستِ ۱٬۰۰۰٬۰۰۰
const inv = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000000, destination: 'CASH' }] })
const pay1 = seed.rows('SELECT id FROM "Payment" WHERE invoiceId = ?', inv.id)[0]
await salesService.deletePayment({ id: pay1.id, userId: A, reason: 'مبلغ اشتباه', ...GATE })
const added = await tryDo('ثبت دوباره‌ی ۱٬۰۰۰٬۰۰۰ بعد از ابطال بدون هشدار اضافه‌دریافت', () => salesService.addPayment({ invoiceId: inv.id, methodId: cash, amount: 1000000, destination: 'CASH', userId: A }))
if (added) { ok++; console.log('  ✓ ثبت دوباره‌ی ۱٬۰۰۰٬۰۰۰ بعد از ابطال بدون هشدار اضافه‌دریافت') }
const lastPay = seed.rows('SELECT overpayAmount FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL', inv.id)
eq('پرداخت تازه اضافه‌دریافت ندارد (۰، نه ۱٬۰۰۰٬۰۰۰)', lastPay.map((r) => r.overpayAmount), [0])

// (۲) وصول نسیه‌ی دوره‌ی قبل که باطل شد: فاکتور نسیه‌ی سه روز قبل، وصول ۵۰۰٬۰۰۰ امروز، سپس ابطال
const old = await salesService.create({ userId: A, shiftId, lines: [{ variantId: v1, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [] })
const past = Date.now() - 3 * 86400_000
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(past, toJalaliDate(new Date(past)), old.id)
await salesService.addPayment({ invoiceId: old.id, methodId: cash, amount: 500000, destination: 'CASH', userId: A })
const oldPay = seed.rows('SELECT id FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL', old.id)[0]
const before = await salesService.reportRows({ fromJalali: today, toJalali: today })
const priorOf = (r) => [r?.totals?.priorSettlementTotal, r?.accounting?.credit?.settledPrior, r?.accounting?.cash?.priorCreditSettlements]
eq('پیش‌شرط: وصول ۵۰۰٬۰۰۰ در سه عدد گزارش (جمع/پل/نقد)', priorOf(before), [500000, 500000, 500000])
await salesService.deletePayment({ id: oldPay.id, userId: A, reason: 'وصول اشتباه ثبت شد', ...GATE })
const rep = await salesService.reportRows({ fromJalali: today, toJalali: today })
eq('بعد از ابطال وصول: جمع وصول نسیه / پل settledPrior / نقد priorCreditSettlements همه ۰', priorOf(rep), [0, 0, 0])
const led = await salesLedger.ledger({ fromJalali: today, toJalali: today })
eq('دفتر رویداد: ردیف «وصول نسیه» برای پرداخت باطل نمی‌آید', (led.rows ?? []).filter((r) => r.sourceKind === 'PAYMENT' && r.sourceId === oldPay.id).length, 0)
const cl = await tryDo('creditList', () => salesService.creditList({ fromJalali: today, toJalali: today }))
const clIds = findKey(cl, 'paymentId').concat(findKey(cl, 'id')).filter((x) => x === oldPay.id)
eq('creditList: وصول باطل‌شده در فهرست نیست', clIds.length, 0)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
