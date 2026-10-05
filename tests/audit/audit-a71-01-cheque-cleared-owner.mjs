/**
 * ممیزی نشست ۷۱ · A71-01 — فیلتر «کارمند» برای پاس‌چک فقط مالک پاسِ فعلی.
 * مثال: چک ۹۰۰٬۰۰۰ را کارمند الف دیروز پاس کرد، برگشت خورد، امروز کارمند ب
 * دوباره پاس کرد. گزارش امروز: فقط ب ۹۰۰٬۰۰۰؛ الف صفر (قبل از رفع: هر دو ۹۰۰٬۰۰۰).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-audit-a71-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
let ok = 0, bad = 0
const eq = (l, g, w) => { if (g === w) { ok++; console.log(`  ✓ ${l}`) } else { bad++; console.log(`  ✗ ${l} · دریافت ${JSON.stringify(g)} · انتظار ${JSON.stringify(w)}`) } }

const userA = seed.user('کارمند الف'); const userB = seed.user('کارمند ب')
const product = seed.product('کالای چک', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 5, salePrice = 1000000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const shiftA = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3_600_000, userId: userA })
const sale = await salesService.create({ userId: userA, shiftId: shiftA, lines: [{ variantId, qty: 1, unitPrice: 1000000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 100000, destination: 'CASH' }] })
const pay = await salesService.addPayment({ invoiceId: sale.id, userId: userA, methodId: cheque, kind: 'CHEQUE', amount: 900000, chequeNo: 'A71', bankName: 'تست', dueDateJalali: today })
const pid = pay.payment.id
await salesService.setChequeStatus({ id: pid, userId: userA, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW })
await salesService.setChequeStatus({ id: pid, userId: userA, status: 'BOUNCED', managerPassword: PW })
sql.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), shiftA)
seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: Date.now(), userId: userB })
await salesService.setChequeStatus({ id: pid, userId: userB, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW })

const clearedOf = async (userId) => {
  const r = await salesLedger.ledger({ fromJalali: today, toJalali: today, userId })
  return r.rows.filter((x) => x.eventType === 'CHEQUE_CLEARED').reduce((s, x) => s + Number(x.amount ?? 0), 0)
}
eq('دفتر رویداد: پاس‌چک به کارمند ب (پاس فعلی)', await clearedOf(userB), 900000)
eq('دفتر رویداد: کارمند الف پاس فعلی ندارد (بدون دوباره‌شماری)', await clearedOf(userA), 0)
const all = await salesLedger.ledger({ fromJalali: today, toJalali: today })
eq('بدون فیلتر: فقط یک ردیف پاس‌چک', all.rows.filter((x) => x.eventType === 'CHEQUE_CLEARED').length, 1)
const cols = sql.prepare('PRAGMA table_info("Payment")').all().map((x) => x.name)
eq('ستون مالک پاس فعلی روی Payment هست', cols.includes('clearedByUserId'), true)
eq('clearedByUserId = کارمند ب', sql.prepare('SELECT clearedByUserId AS u FROM "Payment" WHERE id = ?').get(pid)?.u ?? null, userB)
await salesService.setChequeStatus({ id: pid, userId: userB, status: 'BOUNCED', managerPassword: PW })
eq('برگشت از «پاس شد» مالک را تهی می‌کند', sql.prepare('SELECT clearedByUserId AS u FROM "Payment" WHERE id = ?').get(pid)?.u ?? null, null)
eq('دفتر append-only چهار گذار دارد', sql.prepare('SELECT COUNT(*) AS n FROM "PaymentChequeStatusHistory" WHERE paymentId = ?').get(pid).n, 4)
console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
