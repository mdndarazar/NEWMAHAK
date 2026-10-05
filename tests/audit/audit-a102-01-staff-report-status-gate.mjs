/**
 * ممیزی نشست ۱۰۲ — StaffReportService (حذف سقف ۲۰٬۰۰۰ و chunk شناسه‌ها)
 * ادعای S102 (هیچ ردیفی بعد از ۵۰۰ شناسه گم نمی‌شود) با اجرای واقعی سنجیده شد: ۶۰۰ کارمند ⇒ ۶۰۰ ردیف با نام.
 * A102-01 (P3): فاکتور DRAFT/CANCELED بدون voidedAt (داده‌ی قدیمی؛ مسیر ابطال امروز voidedAt می‌زند) در
 *   عملکرد کارمند، ریزتراکنش، تخفیف غیرعادی و هشدار خارج از شیفت شمرده می‌شد ⇒ فروش فروشنده‌ی الف ۶٬۰۰۰٬۰۰۰
 *   به‌جای ۱٬۰۰۰٬۰۰۰، ناهمسان با گزارش فروش (saleWhere، نشست ۱۲۲ و REPORT_EXCLUDED_SALE_STATUSES).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10201-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now(); const today = toJalaliDate(new Date())
const A = seed.user('فروشنده الف')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, userId: A })
const I = (o) => seed.insert('SaleInvoice', { userId: A, shiftId: S, orderType: 'IN_STORE', issuedAt: now - 3600_000, issuedAtJalali: today, discountTotal: 0, ...o, goodsTotal: o.grandTotal + (o.discountTotal ?? 0) })
I({ receiptNo: 1, status: 'SETTLED', grandTotal: 1_000_000, paidTotal: 1_000_000 })
I({ receiptNo: 2, status: 'CANCELED', grandTotal: 5_000_000, paidTotal: 0, discountTotal: 2_000_000 })
I({ receiptNo: 3, status: 'DRAFT', grandTotal: 700_000, paidTotal: 0, discountTotal: 300_000 })
const f = { fromJalali: today, toJalali: today }
const perf = await staffReportService.performance(f)
const rowA = (Array.isArray(perf) ? perf : perf?.rows ?? []).find((r) => r.userId === A)
eq('عملکرد: فروش الف = ۱٬۰۰۰٬۰۰۰ (بدون CANCELED/DRAFT)', rowA?.salesTotal, 1_000_000)
eq('عملکرد: تعداد فاکتور ۱', rowA?.invoiceCount, 1)
const rep = await salesService.reportRows({ ...f, userId: A })
const repTotal = (rep?.rows ?? []).reduce((s, r) => s + Number(r.grandTotal ?? 0), 0)
eq('هم‌سنجی با گزارش فروش همان کارمند', rowA?.salesTotal, repTotal)
const tx = await staffReportService.transactions({ ...f, userId: A })
eq('ریزتراکنش: فقط فیش ۱', (tx?.invoices ?? []).map((i) => i.receiptNo), [1])
eq('ریزتراکنش: page.invoices.totalCount = ۱', tx?.pages?.invoices?.totalCount, 1)
const ab = await staffReportService.abnormalDiscounts({ ...f, threshold: 5 })
eq('تخفیف غیرعادی: فاکتور لغوشده/پیش‌نویس پرچم نمی‌گیرد', (ab?.rows ?? []).map((r) => r.receiptNo), [])

console.log('— ادعای S102: ۶۰۰ کارمند (بیش از دسته‌ی ۵۰۰تایی) همه با نام')
const db2 = db
for (let k = 0; k < 600; k++) {
  const u = seed.user('ک' + k)
  seed.insert('SaleReturn', { invoiceId: 1, userId: u, shiftId: S, total: 1000, kind: 'RETURN', returnedAt: now - 1000, returnedAtJalali: today })
}
const perf2 = await staffReportService.performance(f)
const rows2 = (Array.isArray(perf2) ? perf2 : perf2?.rows ?? []).filter((r) => r.returnCount > 0)
eq('۶۰۰ ردیف برگشت کارمند', rows2.length, 600)
eq('همه با نام واقعی (نه «کاربر N»)', rows2.every((r) => !String(r.userName).startsWith('کاربر ')), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
