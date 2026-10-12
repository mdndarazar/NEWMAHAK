/**
 * ممیزی A97-01 — نشست ۹۷/۹۸ فیلتر کارمند/شیفت تب legacy اعتبار را روی *فاکتور* صدور
 * (sourceInvoiceId/exchangeInvoiceId/فاکتورِ برگشت) زد، shiftNumber را نادیده گرفت،
 * دروازه‌ی DRAFT/CANCELED فاکتور را نداشت و «وضعیت» نوار گزارش (وضعیت فاکتور) را
 * به‌عنوان وضعیت اعتبار می‌خواند. پل تطبیق (storeCreditStatement) هم «صادرشده» را از
 * مسیر فاکتور (حتی usedInvoiceId) می‌شمرد.
 *
 * سناریو: فاکتور ۱٬۰۰۰٬۰۰۰ شیفت صبح (فروشنده الف). کارمند ب در شیفت شب:
 *   C1 = اعتبار برگشت ۴۰۰٬۰۰۰ (returnId + sourceInvoiceId)
 *   C2 = اعتبار تعویض ۳۰۰٬۰۰۰ (returnId + exchangeInvoiceId + sourceInvoiceId)
 *   C3 = اعتبار اضافه‌دریافت ۱۰۰٬۰۰۰ (sourceInvoiceId، ثبت در شیفت شب)
 * C4 = اعتبار اضافه‌دریافت ۲۰۰٬۰۰۰ روی فاکتور CANCELED شیفت صبح.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9701-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now()
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده صبح'), B = seed.user('کارمند شب')
const S1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, closedAt: now - 5 * 3600_000, userId: A })
const S2 = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 5 * 3600_000, userId: B })
const inv = seed.insert('SaleInvoice', { grandTotal: 1_000_000, paidTotal: 1_000_000, status: 'SETTLED', orderType: 'INTERNAL', receiptNo: 9701, shiftId: S1, userId: A, issuedAt: now - 7 * 3600_000, issuedAtJalali: today })
const exInv = seed.insert('SaleInvoice', { grandTotal: 0, paidTotal: 0, status: 'SETTLED', orderType: 'EXCHANGE', receiptNo: 9702, shiftId: S2, userId: B, issuedAt: now - 3 * 3600_000, issuedAtJalali: today })
const canceled = seed.insert('SaleInvoice', { grandTotal: 500_000, paidTotal: 700_000, status: 'CANCELED', orderType: 'INTERNAL', receiptNo: 9703, shiftId: S1, userId: A, issuedAt: now - 6 * 3600_000, issuedAtJalali: today })
const R1 = seed.insert('SaleReturn', { invoiceId: inv, userId: B, shiftId: S2, total: 400_000, returnedAt: now - 4 * 3600_000, returnedAtJalali: today, kind: 'RETURN', refundMethod: 'STORE_CREDIT', refundAmount: 400_000 })
const R2 = seed.insert('SaleReturn', { invoiceId: inv, userId: B, shiftId: S2, total: 300_000, returnedAt: now - 3 * 3600_000, returnedAtJalali: today, kind: 'EXCHANGE', exchangeInvoiceId: exInv, exchangeDiff: -300_000, exchangeSettlement: 'CREDIT' })
const credit = (code, amount, extra, at) =>
  seed.insert('StoreCredit', { code, amount, status: 'ACTIVE', issuedAt: at, createdAt: at, issuedAtJalali: today, ...extra })
const C1 = credit('A97-C1', 400_000, { source: 'EXCHANGE', returnId: R1, sourceInvoiceId: inv, userId: B }, now - 4 * 3600_000)
const C2 = credit('A97-C2', 300_000, { source: 'EXCHANGE', returnId: R2, exchangeInvoiceId: exInv, sourceInvoiceId: inv, userId: B }, now - 3 * 3600_000)
const C3 = credit('A97-C3', 100_000, { source: 'OVERPAY', sourceInvoiceId: inv, userId: B }, now - 2 * 3600_000)
const C4 = credit('A97-C4', 200_000, { source: 'OVERPAY', sourceInvoiceId: canceled, userId: A }, now - 6 * 3600_000)

// تب legacy از کانال storeCreditList می‌آید؛ بعد از رفع = reportList (وضعیت نوار ⇒ وضعیت فاکتور).
// فهرست عمومی عمداً credential قابل‌مصرف را برنمی‌گرداند؛ تنها شناسهٔ امنِ نمایش
// (`publicReference`) برای سنجش همان ردیف‌ها استفاده می‌شود.
const tabList = typeof storeCreditService.reportList === 'function' ? storeCreditService.reportList.bind(storeCreditService) : storeCreditService.list.bind(storeCreditService)
const base = { fromJalali: today, toJalali: today, channels: ['RETAIL', 'WHOLESALE'] }
const refs = (...ids) => ids.map((id) => `اعتبار #${id}`).sort()
const publicRefs = async (f) => {
  try {
    const r = await tabList({ ...base, ...f })
    return (Array.isArray(r) ? r : r?.rows ?? []).map((x) => x.publicReference).sort()
  } catch (e) { return `ERR ${String(e?.message).slice(0, 60)}` }
}
const unfiltered = await tabList(base)
const unfilteredRows = Array.isArray(unfiltered) ? unfiltered : unfiltered?.rows ?? []
eq('فهرست عمومی credential قابل‌مصرف اعتبار را افشا نمی‌کند', unfilteredRows.every((row) => !('code' in row) && !('legacyCode' in row)), true)
eq('بدون فیلتر ⇒ هر چهار اعتبار (رفتار قبلی حفظ)', await publicRefs({}), refs(C1, C2, C3, C4))
eq('شیفت شب (ثبت برگشت/تعویض/اضافه‌دریافت) ⇒ C1,C2,C3', await publicRefs({ shiftId: S2 }), refs(C1, C2, C3))
eq('شیفت صبح (فقط فاکتور مرجع) ⇒ هیچ', await publicRefs({ shiftId: S1 }), [])
eq('کارمند ب ⇒ C1,C2,C3', await publicRefs({ userId: B }), refs(C1, C2, C3))
eq('کارمند الف (فروشنده فاکتور؛ C4 روی فاکتور لغوشده) ⇒ هیچ', await publicRefs({ userId: A }), [])
eq('شماره‌ی نشست ۱ ⇒ هیچ (قبلاً نادیده گرفته می‌شد)', await publicRefs({ shiftNumber: 1 }), [])
eq('شماره‌ی نشست ۲ ⇒ C1,C2,C3', await publicRefs({ shiftNumber: 2 }), refs(C1, C2, C3))
eq('شماره فیش لغوشده ۹۷۰۳ ⇒ هیچ (دروازه‌ی CANCELED)', await publicRefs({ receiptNo: 9703 }), [])
eq('شماره فیش ۹۷۰۱ ⇒ C1,C2,C3 (هویت روی فاکتور)', await publicRefs({ receiptNo: 9701 }), refs(C1, C2, C3))
eq('وضعیت نوار «تسویه شده» (فاکتور) ⇒ C1,C2,C3؛ نه تب خالی', await publicRefs({ status: 'SETTLED' }), refs(C1, C2, C3))
eq('وضعیت نوار «لغو شده» ⇒ فقط اعتبار فاکتور لغوشده (C4)', await publicRefs({ status: 'CANCELED' }), refs(C4))

// هم‌سنجی با پل تطبیق: «اعتبار صادرشده» برای همان فیلتر
const sumOf = async (f) => {
  const r = await tabList({ ...base, ...f })
  return (Array.isArray(r) ? r : r.rows).reduce((s, x) => s + Number(x.amount ?? 0), 0)
}
for (const [label, f] of [['شیفت شب', { shiftId: S2 }], ['شیفت صبح', { shiftId: S1 }], ['کارمند ب', { userId: B }]]) {
  let issued = null
  try { const rep = await salesService.reportRows({ fromJalali: today, toJalali: today, ...f }); issued = rep?.accounting?.storeCredits?.issued ?? null } catch (e) { issued = `ERR ${String(e?.message).slice(0, 60)}` }
  if (issued === null) console.log(`  ⚠ پل در هارنس برنگشت (${label})`)
  else eq(`هم‌سنجی ${label}: جمع تب اعتبار = «اعتبار صادرشده» پل`, await sumOf(f), issued)
}
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
