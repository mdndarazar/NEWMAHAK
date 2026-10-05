/**
 * ممیزی نشست ۱۰۶ — دفتر رویداد (SalesLedger.ledger): count/truncated/sections نشست ۱۰۶ رفتاری.
 * A106-02 (P3): وقتی بخشی از دفتر به سقف ۴٬۰۰۰ می‌خورد، عنوان جدول صفحه «جمع اثر نقدی: X» را از جمع
 *   ردیف‌های *بریده* می‌ساخت و آن را جمع دفتر معرفی می‌کرد (۴٬۰۰۱ فروش نقدی ۱۰۰٬۰۰۰ ⇒ عنوان ۴۰۰٬۰۰۰٬۰۰۰ به‌جای
 *   ۴۰۰٬۱۰۰٬۰۰۰ بدون هیچ قیدی در خودِ عدد). رفع: helper خالص ledgerCashTitle — با برش، عدد صریحاً «جمع ردیف‌های
 *   نمایش‌داده‌شده، نه کل بازه» برچسب می‌خورد؛ جمع کامل فقط از خروجی کامل (fullRange) می‌آید.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10602-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
let ledgerCashTitle = null
try { ({ ledgerCashTitle } = await import('../../src/shared/reportExtraOutput.ts')) } catch {}
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = toJalaliDate(new Date())
const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const A = seed.user('فروشنده الف')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 60_000, userId: A })
const N = 4001
const insInv = sql.prepare('INSERT INTO "SaleInvoice" (receiptNo, status, orderType, grandTotal, paidTotal, goodsTotal, discountTotal, taxTotal, issuedAt, issuedAtJalali, userId, shiftId, deductInventory) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
const insPay = sql.prepare('INSERT INTO "Payment" (invoiceId, methodId, amount, kind, destination, paidAt, paidAtJalali, createdByUserId, createdShiftId) VALUES (?,?,?,?,?,?,?,?,?)')
sql.exec('BEGIN')
for (let i = 0; i < N; i++) {
  const at = T0 + 120_000 + i * 10
  const r = insInv.run(20000 + i, 'SETTLED', 'INTERNAL', 100000, 100000, 100000, 0, 0, at, today, A, S, 0)
  insPay.run(r.lastInsertRowid, cash, 100000, 'CASH', 'CASH', at, today, A, S)
}
sql.exec('COMMIT')
const led = await salesLedger.ledger({ fromJalali: today, toJalali: today })
eq('S106: sections.invoices.totalCount=۴٬۰۰۱ و truncated=true', [led.sections?.invoices?.totalCount, led.sections?.invoices?.truncated], [N, true])
eq('S106: فقط ۴٬۰۰۰ ردیف فروش نمایش', led.rows.filter((r) => r.eventType === 'SALE' || r.sourceKind === 'INVOICE').length, 4000)
eq('S106: هشدار فارسی با عدد واقعی', (led.warnings ?? []).some((w) => w.includes('۴۰۰۱') || w.includes('4001')), true)
const fullLed = await salesLedger.ledger({ fromJalali: today, toJalali: today, fullRange: true })
eq('fullRange: همه‌ی ۴٬۰۰۱ ردیف و بدون برش', [fullLed.rows.length, fullLed.sections?.invoices?.truncated], [N, false])
const shownSum = led.rows.reduce((s, r) => s + Number(r.cashEffect ?? 0), 0)
eq('پیش‌شرط: جمع ردیف‌های بریده ۴۰۰٬۰۰۰٬۰۰۰ ≠ جمع کامل ۴۰۰٬۱۰۰٬۰۰۰', [shownSum, fullLed.totals.netCash], [400_000_000, 400_100_000])

console.log('— A106-02: عنوان جمع اثر نقدی با برش')
eq('helper خالص ledgerCashTitle وجود دارد', typeof ledgerCashTitle, 'function')
if (typeof ledgerCashTitle === 'function') {
  const t = ledgerCashTitle(led)
  eq('عنوان بریده صریحاً «نمایش‌داده‌شده / نه کل بازه» می‌گوید', /نمایش‌داده‌شده/.test(t) && /کل بازه نیست/.test(t), true)
  const tf = ledgerCashTitle(fullLed)
  eq('بدون برش: عنوان همان «جمع اثر نقدی» بدون قید', /نمایش‌داده‌شده/.test(tf), false)
}
const ui = readFileSync(new URL('../../src/renderer/src/components/ReportExtraTables.tsx', import.meta.url), 'utf8')
eq('ReportExtraTables عنوان دفتر را از ledgerCashTitle می‌سازد', /ledgerCashTitle\(ledger\)/.test(ui), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
