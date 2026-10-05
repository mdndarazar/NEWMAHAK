/**
 * ممیزی نشست ۹۹ — صفحه‌بندی و دامنه‌ی چهار endpoint (reportItems/returnList/exchangeList/chequeList)
 * A99-01 (P2): exchangeList مقدار page.truncated را از reportPage (totalCount > skip) می‌گرفت ⇒ هر صفحه‌ی
 *   غیرخالی «بریده» ⇒ هشدار کاذب «فقط صفحه‌ی جاری؛ نمایش ۲ از ۲» روی چاپ/Excel صفحه؛ و totals (تعداد/جمع‌ها)
 *   فقط جمع صفحه بود ولی روی صفحه به‌عنوان جمع بازه نمایش داده می‌شد.
 * A99-02 (P2): reportItems صفحه را بر حسب فاکتور می‌برد ولی truncated را با تعداد *قلم* حساب می‌کرد ⇒
 *   ۳ فاکتور ×۲ قلم با take=۲ ⇒ truncated=false (برش بی‌صدا) و متن «نمایش ۴ از ۳».
 * A99-03 (P1): returnList/exchangeList/شمارنده‌ی سقف با shiftId تاریخ صریح را کنار می‌گذاشتند (پل هر دو قید)،
 *   shiftNumber را نادیده می‌گرفتند و «وضعیت» نوار (وضعیت فاکتور) را اعمال نمی‌کردند؛ پل وضعیت CANCELED را هم می‌شمرد.
 * A99-04 (P1): شمارنده‌ی سقف چک هنوز مالک را روی فاکتور مادر و تاریخ را روی سررسید می‌زد (A96-01 فقط جدول را
 *   اصلاح کرده بود)؛ تب چک هم «وضعیت» نوار را بی‌صدا نادیده می‌گرفت.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const safe = async (fn) => { try { return await fn() } catch (e) { return 'ERR:' + String(e?.message ?? e).slice(0, 80) } }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9901-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { reportLimitsService } = await import('../../src/main/services/reportLimits.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const yesterday = toJalaliDate(new Date(T0 - 12 * 3600_000))
const J = (t) => toJalaliDate(new Date(t))
const A = seed.user('فروشنده صبح'), B = seed.user('فروشنده شب')
// نشست‌ها پشت‌سرهم: صبح دیروز ۰۸..۲۰، شب ۲۰ دیروز تا الان (عبور از نیمه‌شب)
const sM = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: yesterday, openedAt: T0 - 16 * 3600_000, closedAt: T0 - 4 * 3600_000, userId: A })
const sN = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: yesterday, openedAt: T0 - 4 * 3600_000, userId: B })
const inv = seed.insert('SaleInvoice', { receiptNo: 9901, userId: A, shiftId: sM, status: 'SETTLED', grandTotal: 3_000_000, paidTotal: 3_000_000, issuedAt: T0 - 15 * 3600_000, issuedAtJalali: yesterday, orderType: 'IN_STORE' })
const invCx = seed.insert('SaleInvoice', { receiptNo: 9902, userId: A, shiftId: sM, status: 'CANCELED', grandTotal: 500_000, paidTotal: 0, issuedAt: T0 - 14 * 3600_000, issuedAtJalali: yesterday, orderType: 'IN_STORE' })
const R = (o) => seed.insert('SaleReturn', { invoiceId: inv, kind: 'RETURN', ...o, returnedAtJalali: J(o.returnedAt) })
const r1 = R({ userId: B, shiftId: sN, total: 200_000, returnedAt: T0 - 3600_000 })    // ۲۳:۰۰ دیروز، شیفت شب
const r2 = R({ userId: B, shiftId: sN, total: 300_000, returnedAt: T0 + 3600_000 })    // ۰۱:۰۰ امروز، شیفت شب
const r3 = R({ userId: A, shiftId: sM, total: 100_000, returnedAt: T0 - 14 * 3600_000 }) // دیروز، شیفت صبح
const rCx = R({ invoiceId: invCx, userId: B, shiftId: sN, total: 50_000, returnedAt: T0 + 2 * 3600_000 }) // داده‌ی قدیمی روی فاکتور لغوشده
const e1 = R({ kind: 'EXCHANGE', userId: B, shiftId: sN, total: 400_000, exchangeTotal: 500_000, exchangeDiff: 100_000, returnedAt: T0 - 1800_000 })
const e2 = R({ kind: 'EXCHANGE', userId: B, shiftId: sN, total: 600_000, exchangeTotal: 600_000, exchangeDiff: 0, returnedAt: T0 + 1800_000 })
const ids = (r) => (Array.isArray(r) ? r : r?.rows ?? []).map((x) => x.returnId ?? x.id).sort((a, b) => a - b)
const acc = async (f) => (await salesService.reportRows(f)).accounting.returns
const lim = async (f, key) => (await reportLimitsService.limits(f))?.rows?.find((r) => r.key === key)?.total

console.log('— A99-01: صفحه‌بندی و جمع تب تعویض')
const span = { fromJalali: yesterday, toJalali: today }
const exAll = await salesService.exchangeList(span)
eq('تعویض بدون برش (۲ از ۲): page.truncated=false', exAll?.page?.truncated, false)
eq('تعویض بدون برش: هیچ هشدار صفحه‌ای', exAll?.warnings ?? [], [])
const exP = await salesService.exchangeList({ ...span, take: 1 })
eq('تعویض take=۱ از ۲: truncated=true', exP?.page?.truncated, true)
eq('تعویض take=۱: totals.count = کل بازه (۲)، نه طول صفحه', exP?.totals?.count, 2)
eq('تعویض take=۱: جمع برگشتی = ۱٬۰۰۰٬۰۰۰ کل بازه (نه ۶۰۰٬۰۰۰ صفحه)', exP?.totals?.returnTotal, 1_000_000)
eq('تعویض take=۱: جمع جایگزین کل بازه ۱٬۱۰۰٬۰۰۰', exP?.totals?.exchangeTotal, 1_100_000)
const exLast = await salesService.exchangeList({ ...span, take: 1, skip: 1 })
eq('صفحه‌ی آخر تعویض (skip=۱): truncated=false', exLast?.page?.truncated, false)

console.log('— A99-02: برش جزئیات فروش بر حسب فاکتور')
for (let k = 0; k < 3; k++) {
  const iv = seed.insert('SaleInvoice', { receiptNo: 9950 + k, userId: A, shiftId: sM, status: 'SETTLED', grandTotal: 200, paidTotal: 200, issuedAt: T0 - 13 * 3600_000 + k * 1000, issuedAtJalali: yesterday, orderType: 'IN_STORE' })
  for (let q = 0; q < 2; q++) seed.insert('SaleInvoiceItem', { invoiceId: iv, variantId: 900000 + q, qty: 1, unitPrice: 100, discount: 0, tax: 0, lineTotal: 100, variantName: 'قلم ' + q })
}
const itemsF = { fromJalali: yesterday, toJalali: yesterday, receiptNo: null, customerSearch: null }
const itAll = await salesService.reportItems(itemsF)
const invTotal = itAll?.page?.totalCount
const itCut = await salesService.reportItems({ ...itemsF, take: invTotal - 1 })
eq(`جزئیات فروش take=${invTotal - 1} از ${invTotal} فاکتور: truncated=true (قبلاً با شمار قلم false)`, itCut?.page?.truncated, true)
eq('هشدار برش جزئیات فروش بر حسب «فاکتور» و با شمار فاکتور', (itCut?.warnings ?? []).some((w) => w.includes('فاکتور')), true)
eq('جزئیات فروش کامل: truncated=false', itAll?.page?.truncated, false)

console.log('— A99-03: دامنه‌ی تب برگشت/تعویض = شمارنده = پل')
const night = { fromJalali: today, toJalali: today, shiftId: sN }
eq('برگشت شیفت شب + تاریخ صریح امروز: فقط برگشت ۰۱:۰۰ (هر دو قید، مثل پل)', ids(await salesService.returnList(night)), [r2])
eq('پل تطبیق برای همان فیلتر: ۱ برگشت', (await acc(night)).returnCount, 1)
eq('شمارنده‌ی سقف برگشت برای همان فیلتر: ۱', await lim(night, 'returns'), 1)
eq('تعویض شیفت شب + امروز: فقط تعویض بعد از نیمه‌شب', ids(await salesService.exchangeList(night)), [e2])
eq('پل: ۱ تعویض', (await acc(night)).exchangeCount, 1)
eq('شمارنده‌ی سقف تعویض: ۱', await lim(night, 'exchanges'), 1)
eq('برگشت با shiftId بدون تاریخ: کل نشست شب (عبور از نیمه‌شب)', ids(await salesService.returnList({ shiftId: sN })), [r1, r2])
const byNo = { ...span, shiftNumber: 1 }
eq('shiftNumber=۱ در تب برگشت اعمال می‌شود', ids(await safe(() => salesService.returnList(byNo))), [r3])
eq('shiftNumber=۲ در تب تعویض اعمال می‌شود', ids(await safe(() => salesService.exchangeList({ ...span, shiftNumber: 2 }))), [e1, e2])
eq('پل با shiftNumber=۱: ۱ برگشت', (await acc(byNo)).returnCount, 1)
eq('شمارنده با shiftNumber=۱: ۱', await safe(() => lim(byNo, 'returns')), 1)
const stP = { ...span, status: 'PARTIALLY_RETURNED' }
eq('«وضعیت» نوار = وضعیت فاکتور: «برگشت جزئی» ⇒ برگشت فاکتور تسویه‌شده نمی‌آید', ids(await salesService.returnList(stP)), [])
eq('پل با همان وضعیت: ۰', (await acc(stP)).returnCount, 0)
eq('شمارنده با همان وضعیت: ۰', await lim(stP, 'returns'), 0)
const stC = { ...span, status: 'CANCELED' }
eq('وضعیت «لغو شده»: تب برگشت خالی (دروازه‌ی CANCELED)', ids(await salesService.returnList(stC)), [])
eq('پل با وضعیت «لغو شده»: برگشت فاکتور لغوشده شمرده نمی‌شود', (await acc(stC)).returnCount, 0)
const stS = { ...span, status: 'SETTLED' }
eq('وضعیت «تسویه شده»: سه برگشت فاکتور تسویه‌شده', ids(await salesService.returnList(stS)), [r1, r2, r3])
eq('پل با «تسویه شده»: ۳', (await acc(stS)).returnCount, 3)

console.log('— A99-04: شمارنده‌ی چک = جدول چک')
seed.insert('Payment', { invoiceId: inv, amount: 700_000, kind: 'CHEQUE', chequeNo: 'CH-99', chequeStatus: 'PENDING', destination: 'MANAGER_ACCOUNT',
  paidAt: T0 + 1200_000, paidAtJalali: today, dueDate: T0 + 3000_000, createdByUserId: B, createdShiftId: sN })
const chF = { fromJalali: today, toJalali: today, shiftId: sN }
const chN = async (f) => ids(await salesService.chequeList(f)).length
eq('تب چک شیفت شب (ثبت‌کننده): ۱', await chN(chF), 1)
eq('شمارنده‌ی سقف چک با همان فیلتر: ۱ (قبلاً فاکتور مادر ⇒ ۰)', await lim(chF, 'cheques'), 1)
eq('شمارنده‌ی چک با شیفت صبح (فقط فاکتور مادر): ۰', await lim({ ...chF, shiftId: sM }, 'cheques'), 0)
eq('تب چک با «وضعیت» نوار «برگشت جزئی»: ۰ (وضعیت فاکتور اعمال می‌شود)', await chN({ ...chF, status: 'PARTIALLY_RETURNED' }), 0)
eq('شمارنده‌ی چک با همان وضعیت: ۰', await lim({ ...chF, status: 'PARTIALLY_RETURNED' }, 'cheques'), 0)
eq('تب چک: وضعیت چک صریح (PENDING) همچنان کار می‌کند', await chN({ ...chF, status: 'PENDING' }), 1)
eq('شمارنده‌ی چک با dateMode=paid همان جدول', await lim({ ...chF, dateMode: 'paid' }, 'cheques'), await chN({ ...chF, dateMode: 'paid' }))
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
