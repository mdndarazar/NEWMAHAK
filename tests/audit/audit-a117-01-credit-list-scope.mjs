/**
 * ممیزی نشست ۱۱۷ — SalesService.creditList (تب «نسیه»)، S117-2.
 * A117-01 (P2): تب نسیه قاعده‌های دامنه‌ی مشترک گزارش را نداشت:
 *   (۱) فقط shiftId بدون تاریخ ⇒ فقط «امروز» (نه کل نشست، بند ۴-۱۴ / AUDIT-D22/D28): شیفت شب عبوری از نیمه‌شب
 *       فاکتور نسیه‌ی ۱٬۰۰۰٬۰۰۰ قبل از نیمه‌شب را از تب حذف می‌کرد و وصول ۳۰۰٬۰۰۰ همان فاکتورِ همان نشست را
 *       «وصول نسیه‌ی دوره‌ی قبل» می‌شمرد ⇒ تب ۵۰۰٬۰۰۰، پل تطبیق ۲۰۰٬۰۰۰.
 *   (۲) shiftNumber روی ردیف‌های فاکتور اعمال نمی‌شد (روی وصول قبلی می‌شد).
 *   (۳) «وضعیت» نوار (وضعیت فاکتور) کلاً نادیده بود؛ «لغو شده» همه‌ی نسیه‌های زنده را نشان می‌داد.
 *   (۴) تاریخ '' ⇒ jalaliStartOfDay('') = سال −۱۰۰۱۰۰ ⇒ تب خالی بی‌صدا؛ «۱۴۰۵/۱۳/۰۱» بی‌صدا سال بعد.
 * معیار: یک فیلتر، یک عدد (تب = پل تطبیق settledPrior = شمارنده‌ی سقف).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11701-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { reportLimitsService } = await import('../../src/main/services/reportLimits.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const now = Date.now()
const T0 = jalaliStartOfDay(today).getTime(); const d = Math.max(1000, now - T0)
const at = (t) => ({ ms: t, j: toJalaliDate(new Date(t)) })
const A = seed.user('فروشنده الف'); const B = seed.user('فروشنده ب')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const old = at(T0 - 3 * 86400_000)
const M = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: old.j, openedAt: old.ms - 3600_000, closedAt: old.ms + 3600_000, userId: A })
const nOpen = at(T0 - 2 * 3600_000)
const N = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: nOpen.j, openedAt: nOpen.ms, userId: B })
const S3 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + d * 0.05, closedAt: T0 + d * 0.35, userId: A })
let no = 900
const inv = (shiftId, userId, t, total) => seed.insert('SaleInvoice', { receiptNo: ++no, userId, shiftId, status: 'SETTLED', grandTotal: total, paidTotal: 0, goodsTotal: total, issuedAt: t.ms, issuedAtJalali: t.j, orderType: 'IN_STORE' })
const pay = (invoiceId, shiftId, userId, t, amount) => seed.insert('Payment', { invoiceId, methodId: cash, amount, kind: 'CASH', destination: 'CASH', paidAt: t.ms, paidAtJalali: t.j, createdAt: t.ms, createdShiftId: shiftId, createdByUserId: userId })
const I0 = inv(M, A, old, 800_000)                        // فاکتور قدیمی
const I1 = inv(N, B, at(T0 - 3600_000), 1_000_000)        // شیفت شب، قبل از نیمه‌شب
const I2 = inv(N, B, at(T0 + d * 0.2), 500_000)           // شیفت شب، بعد از نیمه‌شب
const I3 = inv(S3, A, at(T0 + d * 0.3), 400_000)          // نشست دیگری با شماره‌ی ۱ امروز
pay(I1, N, B, at(T0 + d * 0.4), 300_000)                  // وصول همان نشست (نه دوره‌ی قبل)
pay(I0, N, B, at(T0 + d * 0.6), 200_000)                  // وصول نسیه‌ی دوره‌ی قبل در شیفت شب

const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e) } } }
const ids = (r) => (r?.rows ?? []).map((x) => x.id).sort((a, b) => a - b)
const bridgePrior = async (f) => (await safe(() => salesService.reportRows(f)))?.accounting?.credit?.settledPrior
const counter = async (f) => (await safe(() => reportLimitsService.limits(f)))?.rows?.find((r) => r.key === 'credit')?.total

// (۱) فقط shiftId ⇒ کل نشست
const fN = { shiftId: N }
const cN = await safe(() => salesService.creditList(fN))
eq('فقط shiftId شب: هر دو فاکتور نشست (قبل و بعد از نیمه‌شب)', ids(cN), [I1, I2])
eq('فقط shiftId شب: مانده‌ی کل ۱٬۲۰۰٬۰۰۰', cN?.totals?.remainingTotal, 1_200_000)
eq('فقط shiftId شب: وصول دوره‌ی قبل فقط ۲۰۰٬۰۰۰ (وصول فاکتور همان نشست نیست)', cN?.totals?.priorSettlementTotal, 200_000)
eq('فقط shiftId شب: تب = پل تطبیق settledPrior', cN?.totals?.priorSettlementTotal, await bridgePrior(fN))
eq('فقط shiftId شب: شمارنده‌ی سقف = جدول', await counter(fN), cN?.page?.totalCount)
// کنترل: تاریخ صریح + shiftId ⇒ هر دو قید (رفتار قبل)
const fND = { shiftId: N, fromJalali: today, toJalali: today }
const cND = await safe(() => salesService.creditList(fND))
eq('کنترل: امروز + shiftId شب ⇒ فقط فاکتور بعد از نیمه‌شب', ids(cND), [I2])
eq('کنترل: امروز + shiftId شب ⇒ وصول قبل از امروز ۵۰۰٬۰۰۰ = پل', [cND?.totals?.priorSettlementTotal, await bridgePrior(fND)], [500_000, 500_000])

// (۲) shiftNumber روی ردیف‌های فاکتور
const fNum = { fromJalali: today, toJalali: today, shiftNumber: 2 }
const cNum = await safe(() => salesService.creditList(fNum))
eq('امروز + نشست ۲: فقط فاکتور نشست ۲ (نه نشست ۱ امروز)', ids(cNum), [I2])
eq('امروز + نشست ۲: وصول دوره‌ی قبل = پل (۵۰۰٬۰۰۰)', [cNum?.totals?.priorSettlementTotal, await bridgePrior(fNum)], [500_000, 500_000])
eq('امروز + نشست ۲: شمارنده = جدول', await counter(fNum), cNum?.page?.totalCount)

// (۳) «وضعیت» نوار = وضعیت فاکتور، با دروازه‌ی DRAFT/CANCELED (AUDIT-D28)
const cCan = await safe(() => salesService.creditList({ fromJalali: today, toJalali: today, status: 'CANCELED' }))
eq('وضعیت «لغو شده»: هیچ ردیف و هیچ وصولی', [ids(cCan), cCan?.totals?.priorSettlementTotal], [[], 0])
const fRet = { fromJalali: today, toJalali: today, status: 'RETURNED' }
const cRet = await safe(() => salesService.creditList(fRet))
eq('وضعیت «برگشت کامل»: هیچ فاکتور نسیه‌ای با این وضعیت نیست', ids(cRet), [])
eq('وضعیت «برگشت کامل»: وصول دوره‌ی قبل = پل (۰)', [cRet?.totals?.priorSettlementTotal, await bridgePrior(fRet)], [0, 0])
const cSet = await safe(() => salesService.creditList({ fromJalali: today, toJalali: today, status: 'SETTLED' }))
eq('وضعیت «ثبت‌شده/تسویه» (SETTLED): همان دو فاکتور امروز', ids(cSet), [I2, I3])

// (۴) تاریخ خالی ⇒ امروز؛ نامعتبر ⇒ خطای فارسی
const cDef = await safe(() => salesService.creditList({}))
const cEmpty = await safe(() => salesService.creditList({ fromJalali: '', toJalali: ' ' }))
eq('کنترل: بدون تاریخ = امروز', ids(cDef), [I2, I3])
eq("تاریخ '' = امروز (نه تب خالی)", ids(cEmpty), [I2, I3])
const bad1 = await safe(() => salesService.creditList({ fromJalali: '1405/13/01', toJalali: '1405/13/01' }))
eq('تاریخ «۱۴۰۵/۱۳/۰۱» ⇒ خطای فارسی تب نسیه', /تب نسیه/.test(bad1?.__error ?? '') && /معتبر نیست/.test(bad1?.__error ?? ''), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
