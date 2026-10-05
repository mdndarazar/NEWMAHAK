/**
 * ممیزی نشست ۱۱۰ — خروجی flags/sources ضدتقلب (ReportExtraTables / SalesReports / fraudOutputRows).
 * A110-01 (P2): منابع FraudService.review فیلد receiptNo/userName/invoiceId نداشتند؛ ستون «شماره فیش» و
 * «کاربر» چاپ/Excel ضدتقلب (fraudOutputRows) همیشه خالی بود و ردیف‌های تب با وجود متن «قابل کلیک‌اند»
 * فاکتوری باز نمی‌کردند (Table فقط با r.invoiceId کلیک می‌خورد). مدیر برای پیگیری برگشت با تاریخ دستکاری‌شده
 * باید شماره فاکتور را از داخل متن «شرح» بیرون بکشد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11001-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { fraudOutputRows } = await import('../../src/shared/reportExtraOutput.ts')
const { jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const A = seed.user('فروشنده الف')
const B = seed.user('فروشنده ب')
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 60_000, userId: A })
// فاکتور ۷۷۷ ساعت ۱۰؛ برگشت ساعت ۹ (قبل از فاکتور) ⇒ backdatedReturn؛ مشتری ندارد ⇒ returnWithoutCustomer
const inv = seed.insert('SaleInvoice', { receiptNo: 777, userId: A, shiftId: s1, status: 'SETTLED', grandTotal: 1_000_000, paidTotal: 1_000_000, issuedAt: T0 + 10 * 3600_000, issuedAtJalali: today })
const ret = seed.insert('SaleReturn', { invoiceId: inv, userId: B, shiftId: s1, total: 400_000, returnedAt: T0 + 9 * 3600_000, returnedAtJalali: today, kind: 'RETURN' })
// اعتبار ۹۵۰٬۰۰۰ از فاکتور ۷۷۷ (۹۵٪) برای مشتری عمومی ⇒ creditRatio و creditForAnonymous
const cr = seed.insert('StoreCredit', { code: 'AB12CD', amount: 950_000, sourceInvoiceId: inv, userId: B, status: 'ACTIVE', issuedAt: T0 + 11 * 3600_000, issuedAtJalali: today })
const r = await fraudService.review({ fromJalali: today, toJalali: today })
const flag = (k) => r.flags.find((f) => f.key === k)
const bd = flag('backdatedReturn')?.sources?.[0] ?? {}
eq('backdatedReturn: سند برگشت پیدا شد', [flag('backdatedReturn')?.count, bd.id], [1, ret])
eq('backdatedReturn: منبع شماره فیش ۷۷۷ دارد', bd.receiptNo ?? null, 777)
eq('backdatedReturn: منبع invoiceId دارد (ردیف تب قابل کلیک)', bd.invoiceId ?? null, inv)
eq('backdatedReturn: منبع کاربر ثبت برگشت (ب) را دارد', bd.userName ?? null, 'فروشنده ب')
const anon = flag('returnWithoutCustomer')?.sources?.[0] ?? {}
eq('returnWithoutCustomer: شماره فیش ۷۷۷', anon.receiptNo ?? null, 777)
const ratio = flag('creditRatio')?.sources?.[0] ?? {}
eq('creditRatio: شماره فیش فاکتور مبدأ و invoiceId', [ratio.id, ratio.receiptNo ?? null, ratio.invoiceId ?? null], [cr, 777, inv])
eq('creditRatio: کاربر صادرکننده (ب)', ratio.userName ?? null, 'فروشنده ب')
const anonC = flag('creditForAnonymous')?.sources?.[0] ?? {}
eq('creditForAnonymous: شماره فیش فاکتور مبدأ', anonC.receiptNo ?? null, 777)
eq('برچسب «شرح» دست‌نخورده (سازگاری تست‌های قبلی)', bd.label, `سند ${ret} · فاکتور 777`)
// خروجی چاپ/Excel: ستون «شماره فیش» و «کاربر» پر شوند
const out = fraudOutputRows(r.flags, (g) => g.title)
const row = out.find((x) => x.group === flag('backdatedReturn')?.title)
eq('fraudOutputRows: ستون شماره فیش ردیف برگشت گذشته‌نگر = ۷۷۷', row?.receiptNo ?? null, 777)
eq('fraudOutputRows: ستون کاربر = فروشنده ب', row?.userName ?? null, 'فروشنده ب')
// منبعی که فاکتور ندارد (کسری صندوق/کاربر) نباید شماره‌ی جعلی بگیرد
const userSrc = (flag('returnRateByUser')?.sources ?? [])[0]
eq('منبع غیرفاکتوری شماره فیش جعلی نمی‌گیرد', userSrc ? (userSrc.receiptNo ?? null) : null, null)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
