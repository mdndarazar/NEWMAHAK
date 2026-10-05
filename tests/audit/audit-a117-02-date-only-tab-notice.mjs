/**
 * ممیزی نشست ۱۱۷ — S117-1 (StaffReportService.performance) و تب‌های «فقط تاریخ» گزارشات فروش.
 * A117-02 (P3، UI): تب‌های «عملکرد کارمندان»، «کارت‌به‌کارت»، «خارج از شیفت»، «نشست‌های override» و
 *   «مدیریت اعتبار» فقط از/تا نوار را می‌گیرند (امضای performance: from/to/userId)، ولی نوار فیلتر روی همین
 *   تب‌ها هم شیفت/وضعیت/نوع سفارش/فیش/مشتری/کالا/کانال را نشان می‌دهد ⇒ مدیری که «شیفت شب» را انتخاب کرده عدد
 *   تعهد کارت‌به‌کارت ۱٬۵۰۰٬۰۰۰ کل روزِ فروشنده را به‌عنوان عدد شیفت شب می‌خواند (۱٬۰۰۰٬۰۰۰ مال شیفت صبح است).
 * رفع: helper خالص src/shared/reportTabScope.ts (dateOnlyTabNotice) و هشدار صریح بالای این تب‌ها.
 * بخش رفتاری سرویس: تعهد کارت‌به‌کارت واقعاً کل روز است (دلیل هشدار) و CANCELED/ADJUSTED بی‌paidAt طبق AUDIT-D50.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11702-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
let helper = null
try { helper = await import('../../src/shared/reportTabScope.ts') } catch (e) { console.log('  (helper موجود نیست: ' + String(e?.message ?? e).slice(0, 80) + ')') }
const notice = (tab, f) => { try { return helper.dateOnlyTabNotice(tab, f) } catch { return '__missing__' } }
const all = { fromJalali: '1405/07/01', toJalali: '1405/07/01', shiftId: '', orderType: '', status: '', receiptNo: '', customerSearch: '', productSearch: '', channels: ['RETAIL', 'WHOLESALE'] }
eq('بدون فیلتر غیرتاریخی ⇒ هیچ هشداری', notice('staff', all), null)
const nShift = notice('staff', { ...all, shiftId: 7 })
eq('شیفت انتخاب‌شده روی تب کارمندان ⇒ هشدار صریح «شیفت» و «کل بازه‌ی تاریخ»', typeof nShift === 'string' && /شیفت/.test(nShift) && /عملکرد کارمندان/.test(nShift) && /کل بازه/.test(nShift), true)
const nMany = notice('cardTransfers', { ...all, status: 'SETTLED', customerSearch: 'علی', channels: ['RETAIL'] })
eq('وضعیت + مشتری + کانال ⇒ هر سه نام برده می‌شوند', typeof nMany === 'string' && /وضعیت/.test(nMany) && /مشتری/.test(nMany) && /کانال/.test(nMany), true)
eq('فاصله‌ی خالی در جستجو فیلتر نیست', notice('staff', { ...all, receiptNo: '  ', productSearch: ' ' }), null)
eq('تب عادی (سرجمع) ⇒ هیچ هشداری (فیلترها اعمال می‌شوند)', notice('summary', { ...all, shiftId: 7 }), null)
eq('فهرست تب‌های «فقط تاریخ» پنج تب', [...(helper?.DATE_ONLY_REPORT_TABS ?? [])].sort(), ['cardTransfers', 'creditManagement', 'outOfShift', 'overrideSessions', 'staff'])

// سیم‌کشی UI
const ui = readFileSync(new URL('../../src/renderer/src/pages/SalesReports.tsx', import.meta.url), 'utf8')
eq('SalesReports هشدار dateOnlyTabNotice را با فیلترهای نوار رندر می‌کند', /dateOnlyTabNotice\(tab,\s*filters\)/.test(ui), true)

// رفتار سرویس: تعهد کل روز، بدون شیفت (دلیل هشدار)؛ CANCELED بیرون، ADJUSTED بی‌paidAt درون (AUDIT-D50)
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { staffReportService } = await import('../../src/main/services/StaffReportService.ts')
const { jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const now = Date.now()
const A = seed.user('فروشنده الف')
const sM = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 7200_000, closedAt: now - 3600_000, userId: A })
const sN = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: now - 3600_000, userId: A })
const req = (shiftId, amount, status, extra = {}) => seed.insert('CardTransferRequest', { kind: 'REQUEST', status, operationKind: 'RETURN', returnId: 1, amount, userId: A, shiftId, createdAt: now - 1800_000, ...extra })
req(sM, 1_000_000, 'PAID', { paidAt: now - 1700_000 })
req(sN, 500_000, 'PENDING')
req(sN, 300_000, 'CANCELED')
req(sN, 200_000, 'ADJUSTED')
const perf = await staffReportService.performance({ fromJalali: today, toJalali: today })
const rowA = (perf?.rows ?? []).find((r) => r.userId === A)
eq('تعهد کارت‌به‌کارت الف = کل روز (۱٬۰۰۰٬۰۰۰ صبح + ۵۰۰٬۰۰۰ + ۲۰۰٬۰۰۰ ADJUSTED بی‌paidAt؛ لغوشده بیرون)', rowA?.cardToCardTotal, 1_700_000)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
