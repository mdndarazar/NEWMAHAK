/**
 * ممیزی نشست ۱۱۲ — cashEffect دفتر رویداد فقط کشوی فیزیکی (بند ۴-۴۹).
 * نشست ۱۱۲ فقط چک/بازپرداخت/تعویض را اصلاح کرد و تستش ردیف فروش بی‌پرداخت داشت (happy-path).
 * A112-01 (P2): ردیف «فروش» و «وصول نسیه‌ی دوره‌ی قبل» هر پرداخت غیرچک را نقد کشو می‌شمردند:
 *   کارت‌خوان، کارت‌به‌کارت/حساب مدیر و مقصد نامشخص هم cashEffect مثبت می‌گرفتند ⇒ «جمع اثر نقدی»
 *   دفتر بیشتر از پولی که باید در کشو باشد و مدیر با مقایسه‌ی دفتر و شمارش صندوق کسری کاذب می‌دید.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11201-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const day = '1405/03/12'; const prev = '1405/03/10'
const at = (d, h) => new Date(jalaliStartOfDay(d).getTime() + h * 3_600_000)
const U = seed.user('صندوقدار')
const sh = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: day, userId: U, openedAt: at(day, 8) })
const mCash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقد', kind: 'CASH' })
const mCard = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD' })
const mC2C = seed.insert('PaymentMethod', { key: 'C2C', label: 'کارت به کارت', kind: 'CUSTOM' })
const inv = seed.insert('SaleInvoice', { receiptNo: 11, userId: U, shiftId: sh, status: 'SETTLED', grandTotal: 1_500_000, paidTotal: 1_500_000, issuedAt: at(day, 10), issuedAtJalali: day })
const pay = (invoiceId, methodId, amount, destination, d, h) => seed.insert('Payment', { invoiceId, methodId, amount, kind: 'CASH', destination, paidAt: at(d, h), paidAtJalali: d, createdByUserId: U, createdShiftId: sh })
pay(inv, mCash, 600_000, 'CASH', day, 10)      // نقد کشو
pay(inv, mCard, 400_000, 'CARD', day, 10)      // کارت‌خوان
pay(inv, mC2C, 300_000, 'MANAGER', day, 10)    // کارت‌به‌کارت حساب مدیر
pay(inv, mC2C, 200_000, null, day, 10)         // مقصد نامشخص (داده‌ی قدیمی)
// نسیه‌ی دوره‌ی قبل: امروز ۲۵۰٬۰۰۰ نقد + ۱۵۰٬۰۰۰ کارت‌خوان
const old = seed.insert('SaleInvoice', { receiptNo: 5, userId: U, status: 'CREDIT', grandTotal: 1_000_000, paidTotal: 400_000, issuedAt: at(prev, 10), issuedAtJalali: prev })
pay(old, mCash, 250_000, 'CASH', day, 11)
pay(old, mCard, 150_000, 'CARD', day, 12)
const L = await salesLedger.ledger({ fromJalali: day, toJalali: day })
const sale = L.rows.find((r) => r.eventType === 'SALE' && r.receiptNo === 11)
eq('فروش: اثر نقدی فقط ۶۰۰٬۰۰۰ نقد کشو (کارت/مدیر/نامشخص صفر)', sale?.cashEffect ?? null, 600_000)
eq('فروش: توضیح اثر نقدی مبلغ غیرکشویی را جدا می‌گوید', /900[,٬]?000|۹۰۰٬۰۰۰/.test(sale?.cashNote ?? '') || (sale?.cashNote ?? '').includes('کشو'), true)
const prior = L.rows.filter((r) => r.eventType === 'CREDIT_SETTLEMENT')
eq('وصول دوره‌ی قبل: دو ردیف دیده می‌شود (مبلغ سند دست‌نخورده)', prior.map((r) => r.amount).sort(), [150_000, 250_000])
eq('وصول دوره‌ی قبل نقد: اثر نقدی ۲۵۰٬۰۰۰', prior.find((r) => r.amount === 250_000)?.cashEffect ?? null, 250_000)
eq('وصول دوره‌ی قبل کارت‌خوان: اثر نقدی صفر', prior.find((r) => r.amount === 150_000)?.cashEffect ?? null, 0)
eq('جمع اثر نقدی دفتر = پول واقعی کشو (۸۵۰٬۰۰۰)', L.totals.netCash, 850_000)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
