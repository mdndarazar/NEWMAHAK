/**
 * ممیزی نشست ۱۰۰ — StoreCreditService.list (صفحه‌بندی، onlyWithRemaining) و شمارنده‌ی سقف اعتبار
 * مشکوک ثبت‌شده‌ی A100-01 («فقط دارای باقی‌مانده» حالا با amount>usedAmount خام) ⇒ رد شد: پیش از ۱۰۰ هم
 *   shapeStoreCredit(...).remaining = remainingOf(core) = amount−used بدون نگاه به وضعیت بود؛ رفتار یکسان است
 *   (بخش ۱ این تست هم‌ارزی را روی اعتبار لغوشده/منقضی/مصرف‌کامل اثبات می‌کند).
 * A100-01 (P2، ایراد واقعی): شمارنده‌ی سقف «اعتبار خرید» (reportLimits) از storeCreditService.list می‌خواند و
 *   «وضعیت» نوار (وضعیت فاکتور) را وضعیت *اعتبار* می‌گرفت، ولی تب از reportList (invoiceStatus) ⇒ با
 *   «تسویه شده» جدول ۲ اعتبار و شمارنده ۰؛ با «لغو شده» جدول ۱ (اعتبار فاکتور لغوشده) و شمارنده ۲ (اعتبارهای لغوشده‌ی فاکتور تسویه‌شده).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10001-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService, shapeStoreCredit } = await import('../../src/main/services/StoreCreditService.ts')
const { reportLimitsService } = await import('../../src/main/services/reportLimits.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now()
const today = toJalaliDate(new Date())
const A = seed.user('فروشنده')
const S1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, userId: A })
const inv = seed.insert('SaleInvoice', { grandTotal: 1_000_000, paidTotal: 1_000_000, status: 'SETTLED', orderType: 'INTERNAL', receiptNo: 10001, shiftId: S1, userId: A, issuedAt: now - 7 * 3600_000, issuedAtJalali: today })
const cx = seed.insert('SaleInvoice', { grandTotal: 500_000, paidTotal: 700_000, status: 'CANCELED', orderType: 'INTERNAL', receiptNo: 10002, shiftId: S1, userId: A, issuedAt: now - 6 * 3600_000, issuedAtJalali: today })
const credit = (code, amount, extra, at) =>
  seed.insert('StoreCredit', { code, amount, usedAmount: 0, status: 'ACTIVE', source: 'OVERPAY', userId: A, issuedAt: at, createdAt: at, issuedAtJalali: today, ...extra })
credit('C-LIVE', 300_000, { sourceInvoiceId: inv }, now - 5 * 3600_000)
credit('C-PART', 400_000, { sourceInvoiceId: inv, usedAmount: 100_000, status: 'PARTIALLY_USED', multiUse: true, maxUses: 3 }, now - 4 * 3600_000)
const C_VOID = credit('C-VOID', 200_000, { sourceInvoiceId: inv, status: 'CANCELED' }, now - 3 * 3600_000)
credit('C-VOID2', 50_000, { sourceInvoiceId: inv, status: 'CANCELED' }, now - 3 * 3600_000)
const C_EXP = credit('C-EXP', 150_000, { sourceInvoiceId: inv, expiresAt: new Date(now - 3600_000) }, now - 3 * 3600_000)
credit('C-USED', 100_000, { sourceInvoiceId: inv, usedAmount: 100_000, status: 'USED' }, now - 2 * 3600_000)
credit('C-CXINV', 250_000, { sourceInvoiceId: cx }, now - 2 * 3600_000)
const rowsOf = (r) => (Array.isArray(r) ? r : r?.rows ?? [])
// فهرست مدیریتی نباید کد قابل‌مصرف را پخش کند؛ شناسهٔ عمومی برای هویت ردیف
// در آزمون کافی است و هم‌زمان نبودِ credential را نیز قابل‌سنجش می‌کند.
const publicRefs = (r) => rowsOf(r).map((x) => x.publicReference).sort()
const base = { fromJalali: today, toJalali: today }

console.log('— بخش ۱: هم‌ارزی onlyWithRemaining با معنای پیش از نشست ۱۰۰ (shape.remaining > 0)')
const all = await storeCreditService.list({ ...base })
const allRows = rowsOf(all)
eq('فهرست مدیریت کد قابل‌مصرف را افشا نمی‌کند', allRows.every((row) => !('code' in row) && !('legacyCode' in row)), true)
const legacy = allRows.filter((r) => r.remaining > 0).map((r) => r.publicReference).sort()
const now100 = publicRefs(await storeCreditService.list({ ...base, onlyWithRemaining: true }))
eq('فقط دارای باقی‌مانده = فیلتر قدیمی shape.remaining>0', now100, legacy)
eq('اعتبار لغوشده/منقضی با مبلغ مصرف‌نشده در هر دو نسخه می‌آید (معنای «مبلغ مانده» نه «تعهد زنده»)', now100.includes(`اعتبار #${C_VOID}`) && now100.includes(`اعتبار #${C_EXP}`), true)
const p1 = await storeCreditService.list({ ...base, onlyWithRemaining: true, take: 2 })
eq('onlyWithRemaining take=۲: totalCount بعد از فیلتر', p1.page?.totalCount, legacy.length)
eq('onlyWithRemaining take=۲: truncated=true', p1.page?.truncated, true)
const p2 = await storeCreditService.list({ ...base, onlyWithRemaining: true, take: 2, skip: legacy.length - 1 })
eq('صفحه‌ی آخر: truncated=false', p2.page?.truncated, false)

console.log('— A100-01: شمارنده‌ی سقف اعتبار = جدول تب (وضعیت نوار = وضعیت فاکتور)')
const lim = async (f) => (await reportLimitsService.limits(f))?.rows?.find((r) => r.key === 'storeCredits')?.total
const tab = async (f) => rowsOf(await storeCreditService.reportList(f)).length
for (const [label, f] of [['بدون وضعیت', {}], ['تسویه شده', { status: 'SETTLED' }], ['لغو شده', { status: 'CANCELED' }]]) {
  const t = await tab({ ...base, ...f })
  eq(`«${label}»: شمارنده (${t} در جدول) = جدول`, await lim({ ...base, ...f }), t)
}
eq('«تسویه شده»: جدول خالی نیست (۶ اعتبار فاکتور تسویه‌شده)', await tab({ ...base, status: 'SETTLED' }), 6)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
