/**
 * ممیزی نشست ۱۱۸ — S118-1 (purgePreview انتخابی با invoiceIds داخل saleWhere).
 * ادعای S118-1 (انتخابِ بعد از صفحه‌ی اول حذف نمی‌شود) رفتاری تأیید شد.
 * A118-01 (P2، عملیات مخرب): پیش‌نمایش انتخابی شناسه‌ها را *با* بازه‌ی تاریخ فعلی AND می‌کرد، ولی purge و purgeStockPlan در
 *   حالت انتخابی فقط شناسه‌ها را می‌گیرند (بی‌تاریخ). در Settings انتخاب با تغییر «از/تا» پاک نمی‌شود ⇒ فاکتور ۱٬۰۰۰٬۰۰۰ دیروز
 *   را تیک بزن، تاریخ را به امروز عوض کن، «حذف انتخاب‌شده» ⇒ پیش‌نمایش «۰ فاکتور · جمع ۰» (ولی ۲ عدد «برگشت به انبار»)،
 *   و با تأیید همان فاکتور ۱٬۰۰۰٬۰۰۰ باطل می‌شود. پیش‌نمایش عملیات مخرب باید همان مجموعه‌ی خود عملیات را نشان دهد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11801-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const nowMs = Math.max(T0 + 1000, Date.now() - 60_000)
const y = { ms: T0 - 5 * 3600_000 }; y.j = toJalaliDate(new Date(y.ms))
const old = { ms: T0 - 4 * 86400_000 }; old.j = toJalaliDate(new Date(old.ms))
const p = seed.product('شلوار'); const v = seed.variant(p, '۳۲')
let no = 800
const inv = (t, total, qty) => {
  const id = seed.insert('SaleInvoice', { receiptNo: ++no, status: 'FINAL', orderType: 'IN_STORE', grandTotal: total, goodsTotal: total, paidTotal: total, issuedAt: t.ms, issuedAtJalali: t.j })
  seed.insert('SaleInvoiceItem', { invoiceId: id, variantId: v, qty, unitPrice: total / qty, lineTotal: total })
  return id
}
const Y = inv(y, 1_000_000, 2)
const O = inv(old, 400_000, 1)
const Tn = inv({ ms: nowMs, j: toJalaliDate(new Date(nowMs)) }, 250_000, 1)

// ادعای S118-1: انتخاب در همان بازه
const s1 = await salesService.purgePreview({ fromJalali: today, toJalali: today, invoiceIds: [Tn] })
eq('انتخاب در همان بازه: ۱ فاکتور ۲۵۰٬۰۰۰', [s1.rows.length, s1.totals?.grandTotal], [1, 250_000])

// A118-01: انتخاب دیروز و فاکتور ۴ روز پیش، ولی state تاریخ = امروز
const pv = await salesService.purgePreview({ fromJalali: today, toJalali: today, invoiceIds: [Y, O] })
eq('پیش‌نمایش همان ۲ فاکتوری را نشان می‌دهد که purge باطل می‌کند', pv.rows.map((r) => r.id).sort(), [Y, O].sort())
eq('جمع پیش‌نمایش = ۱٬۴۰۰٬۰۰۰', pv.totals?.grandTotal, 1_400_000)
eq('برگشت به انبار پیش‌نمایش = ۳ (هم‌مجموعه با ردیف‌ها)', pv.restoreQty, 3)
eq('فاکتور انتخاب‌نشده‌ی امروز در پیش‌نمایش انتخابی نیست', pv.rows.some((r) => r.id === Tn), false)
const res = await salesService.purge({ fromJalali: today, toJalali: today, invoiceIds: [Y, O], managerVerified: true, overrideReason: 'آزمون ممیزی' })
eq('purge همان ۲ فاکتور و همان جمع را باطل می‌کند (مرجع)', [res.voidedInvoices ?? res.deletedInvoices, res.grandTotal], [2, 1_400_000])
eq('یکی بودن عدد پیش‌نمایش و عملیات', pv.rows.length, res.voidedInvoices ?? res.deletedInvoices)
// غیرانتخابی دست‌نخورده
const r2 = await salesService.purgePreview({ fromJalali: today, toJalali: today })
eq('غیرانتخابی: فقط فاکتور امروز', r2.rows.map((r) => r.id), [Tn])
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
