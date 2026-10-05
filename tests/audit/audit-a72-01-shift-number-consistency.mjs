/**
 * ممیزی A72-01 — فیلتر shiftNumber باید برای فاکتور و رویداد (وصول/برگشت/پاس‌چک)
 * یک معنا داشته باشد: نشست‌های هم‌شماره در روزهای مختلف، شیفت شب عبوری از
 * نیمه‌شب، بازه‌ی خالی، صفر/نامعتبر، و تناقض shiftId + shiftNumber.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a72-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')
const prisma = harnessClient()
const seed = makeSeeder(prisma)
const db = prisma.$harness.db
const at = (j, h) => new Date(jalaliStartOfDay(j).getTime() + h * 3_600_000)
const D1 = '1405/03/01', D2 = '1405/03/02'
const u = seed.user('کارمند')
const s2d1 = seed.insert('Shift', { name: 'صبح', number: 2, dayJalali: D1, userId: u })
const s2d2 = seed.insert('Shift', { name: 'صبح', number: 2, dayJalali: D2, userId: u })
const s3night = seed.insert('Shift', { name: 'شب', number: 3, dayJalali: D1, userId: u })
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقد', kind: 'CASH' })
const sale = (shift, when, jal, amount) => {
  const inv = seed.invoice({ grandTotal: amount })
  db.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=?, userId=?, shiftId=? WHERE id=?').run(when.getTime(), jal, u, shift, inv.id)
  seed.insert('Payment', { invoiceId: inv.id, methodId: cash, amount, kind: 'CASH', paidAt: when, paidAtJalali: jal, createdByUserId: u, createdShiftId: shift })
  return inv
}
// نسیه‌ی روز قبل که در نشست‌ها وصول می‌شود
const old = seed.invoice({ grandTotal: 5_000_000 })
db.prepare('UPDATE "SaleInvoice" SET issuedAt=?, issuedAtJalali=?, userId=? WHERE id=?').run(at('1405/02/20', 10).getTime(), '1405/02/20', u, old.id)
const settle = (shift, when, jal, amount) => seed.insert('Payment', { invoiceId: old.id, methodId: cash, amount, kind: 'CASH', paidAt: when, paidAtJalali: jal, createdByUserId: u, createdShiftId: shift })
sale(s2d1, at(D1, 9), D1, 100_000); settle(s2d1, at(D1, 9.5), D1, 10_000)
sale(s2d2, at(D2, 9), D2, 200_000); settle(s2d2, at(D2, 9.5), D2, 20_000)
// شیفت شب: فروش و وصول ساعت ۰۰:۳۰ روز بعد، با نشست روز اول
sale(s3night, at(D2, 0.5), D2, 300_000); settle(s3night, at(D2, 0.5), D2, 30_000)

const sum = (rep, type) => rep.rows.filter((r) => r.eventType === type).reduce((s, r) => s + r.amount, 0)
const both = async (f) => { const r = await salesLedger.ledger(f); return [sum(r, 'SALE'), sum(r, 'CREDIT_SETTLEMENT')] }

eq('هم‌شماره در دو روز: هر دو روز در فاکتور و وصول', await both({ fromJalali: D1, toJalali: D2, shiftNumber: 2 }), [300_000, 30_000])
eq('هم‌شماره، فقط روز دوم', await both({ fromJalali: D2, toJalali: D2, shiftNumber: 2 }), [200_000, 20_000])
eq('شیفت شب، روز اول: رویداد بعد از نیمه‌شب با تاریخ خودش بیرون است (فاکتور و وصول هم‌سو)', await both({ fromJalali: D1, toJalali: D1, shiftNumber: 3 }), [0, 0])
eq('شیفت شب، روز دوم: فاکتور و وصول ۰۰:۳۰ هر دو داخل', await both({ fromJalali: D2, toJalali: D2, shiftNumber: 3 }), [300_000, 30_000])
eq('شماره‌ی بی‌نشست: همه صفر', await both({ fromJalali: D1, toJalali: D2, shiftNumber: 9 }), [0, 0])
eq('تناقض shiftId(نشست ۲) + shiftNumber=3: فاکتور و رویداد هر دو صفر', await both({ fromJalali: D1, toJalali: D2, shiftId: s2d1, shiftNumber: 3 }), [0, 0])
eq('shiftId + shiftNumber هم‌خوان: همان نشست', await both({ fromJalali: D1, toJalali: D2, shiftId: s2d1, shiftNumber: 2 }), [100_000, 10_000])
let zeroErr = null
try { await salesLedger.ledger({ fromJalali: D1, toJalali: D2, shiftNumber: 0 }) } catch (e) { zeroErr = String(e.message) }
eq('shiftNumber=0 رد می‌شود (نه فاکتور بی‌فیلتر + رویداد خالی)', zeroErr != null && /نشست/.test(zeroErr), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
