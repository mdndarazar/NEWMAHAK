/**
 * ممیزی A94-01 / A94-02 — خروجی Excel نشست ۹۴ (و چاپ/صفحه‌ی هم‌خانواده) تب‌های legacy
 * «اعتبار خرید» و «ضدتقلب».
 *  A94-01 (P2): ستون/جمع «مانده» در چاپ و Excel = amount − usedAmount همه‌ی ردیف‌ها، حتی لغوشده و
 *    منقضی ⇒ بدهی زنده‌ی فروشگاه بیش از واقع (۲٬۴۰۰٬۰۰۰ به‌جای ۹۰۰٬۰۰۰)؛ صفحه هم «مانده‌ی بدهی ما» را
 *    فقط از ACTIVE و با مبلغ اولیه جمع می‌زد (۳۰۰٬۰۰۰؛ اعتبار مصرف بخشی با ۶۰۰٬۰۰۰ مانده غایب).
 *    مرجع: liabilityTotal داشبورد (ACTIVE+PARTIALLY_USED، منقضی‌نشده) = ۹۰۰٬۰۰۰.
 *  A94-02 (P1): خروجی ضدتقلب label سند (تنها شرح) را نمی‌خواند و پرچم HIGH «چک برگشتی» که
 *    سند منبع ندارد (sources: []) کلاً از چاپ/Excel حذف می‌شد (۵٬۰۰۰٬۰۰۰ چک برگشتی ناپیدا).
 * بخش رفتاری: خروجی واقعی سرویس‌ها روی هارنس + helper مشترک. بخش UI: فقط متن کد.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9401-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { toJalaliDate } = await import('@shared/jalali')
let helper = null
try { helper = await import('../../src/shared/reportExtraOutput.ts') } catch (e) { console.log(`  ⚠ helper مشترک خروجی وجود ندارد (${String(e?.code ?? e?.message).slice(0, 60)})`) }
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now()
const today = toJalaliDate(new Date())
const credit = (code, amount, usedAmount, status, expiresAt = null) =>
  seed.insert('StoreCredit', { code, amount, usedAmount, usedCount: usedAmount ? 1 : 0, maxUses: 5, multiUse: true, source: 'MANUAL', status, issuedAt: now - 60_000, issuedAtJalali: today, expiresAt })
const SCA = credit('SCA', 300_000, 0, 'ACTIVE')
const SCP = credit('SCP', 1_000_000, 400_000, 'PARTIALLY_USED')
const SCC = credit('SCC', 1_000_000, 0, 'CANCELED')
const SCE = credit('SCE', 500_000, 0, 'ACTIVE', now - 1000) // منقضی
const list = await storeCreditService.list({ fromJalali: today, toJalali: today, mode: 'issued', take: 500 })
const rows = Array.isArray(list) ? list : (list?.rows ?? [])
eq('هارنس: چهار اعتبار در فهرست سرویس', rows.length, 4)
const dash = await storeCreditService.dashboard({ fromJalali: today, toJalali: today })
eq('مرجع: تعهد زنده‌ی داشبورد = ۹۰۰٬۰۰۰', dash?.liability, 900_000)
const oldExcelRemaining = rows.reduce((s, r) => s + Number(r.remainingAmount ?? r.remaining ?? 0), 0)
console.log(`  · منطق قدیم Excel/چاپ: جمع «مانده» = ${oldExcelRemaining}`)
const outSum = helper ? rows.reduce((s, r) => s + helper.creditOutstandingOf(r), 0) : null
eq('A94-01: جمع «مانده‌ی قابل مصرف» خروجی = تعهد داشبورد', outSum, dash?.liability)
// گزارش، کد مصرف‌پذیر اعتبار را عمداً برنمی‌گرداند؛ برای این آزمون شناسهٔ امن
// و پایدار ردیف به جای credential استفاده می‌شود.
eq('A94-01: فهرست گزارش credential اعتبار را افشا نمی‌کند', rows.every((row) => !('code' in row) && !('legacyCode' in row)), true)
const byId = new Map(rows.map((r) => [r.id, r]))
eq('A94-01: اعتبار لغوشده مانده‌ی قابل مصرف صفر', helper ? helper.creditOutstandingOf(byId.get(SCC)) : null, 0)
eq('A94-01: اعتبار منقضی مانده‌ی قابل مصرف صفر', helper ? helper.creditOutstandingOf(byId.get(SCE)) : null, 0)
const active = helper ? helper.outstandingCreditRows(rows) : []
eq('A94-01: جدول «مانده‌ی بدهی ما» صفحه شامل مصرف بخشی است', active.map((r) => r.publicReference).sort(), [`اعتبار #${SCA}`, `اعتبار #${SCP}`].sort())

// ---------- ضدتقلب ----------

const inv = seed.invoice({ grandTotal: 5_000_000 })
seed.insert('Payment', { invoiceId: inv.id, amount: 5_000_000, kind: 'CHEQUE', chequeNo: 'CH-94', chequeStatus: 'BOUNCED', paidAt: now - 60_000, paidAtJalali: today })
const review = await fraudService.review({ fromJalali: today, toJalali: today, allSources: true })
const bouncedFlag = (review?.flags ?? []).find((f) => f.key === 'bouncedCheques')
eq('هارنس: سرویس پرچم «چک برگشتی» ۵٬۰۰۰٬۰۰۰ را بدون سند منبع می‌دهد', bouncedFlag ? [bouncedFlag.amount, bouncedFlag.sources.length] : null, [5_000_000, 0])
const oldBounced = (review?.flags ?? []).filter((g) => g.key === 'bouncedCheques').flatMap((g) => (Array.isArray(g?.rows) ? g.rows : Array.isArray(g?.items) ? g.items : Array.isArray(g?.sources) ? g.sources : []))
console.log(`  · منطق قدیم چاپ/Excel: ردیف‌های پرچم چک برگشتی = ${oldBounced.length}`)
const outRows = helper ? helper.fraudOutputRows(review.flags, (g) => g.title) : []
const bouncedOut = outRows.filter((r) => r.group === 'چک برگشتی')
eq('A94-02: پرچم بدون سند منبع یک ردیف خلاصه با مبلغ خودش دارد', bouncedOut.map((r) => r.amount), [5_000_000])
eq('A94-02: شدت فارسی است', bouncedOut[0]?.severity, 'نیاز به بررسی فوری')
const withSources = (helper ? helper.fraudOutputRows([{ title: 'کسری', severity: 'HIGH', count: 1, amount: 70_000, sources: [{ kind: 'CASH_SESSION', id: 1, label: 'شب · انتظاری ۱۰۰ / شمرده‌شده ۳۰', amount: 70_000, dateJalali: today }] }], (g) => g.title) : [])
eq('A94-02: شرح سند (label) در ستون توضیح می‌آید', withSources[0]?.note, 'شب · انتظاری ۱۰۰ / شمرده‌شده ۳۰')

// ---------- UI (فقط متن کد) ----------
const page = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const extra = readFileSync('src/renderer/src/components/ReportExtraTables.tsx', 'utf8')
eq('UI: چاپ و Excel ضدتقلب هر دو از fraudOutputRows', (page.match(/fraudOutputRows\(output\.fraudGroups/g) ?? []).length, 2)
eq('UI: چاپ/Excel/جمع اعتبار از creditOutstandingOf', (page.match(/creditOutstandingOf\(r\)/g) ?? []).length, 3)
eq('UI: صفحه جدول بدهی زنده را از outstandingCreditRows می‌سازد', /const active = outstandingCreditRows\(rows\)/.test(extra), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
