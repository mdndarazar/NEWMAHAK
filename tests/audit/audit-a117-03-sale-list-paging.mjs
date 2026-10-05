/**
 * ممیزی نشست ۱۱۷ — A117-03 (P3، UI): صفحه‌ی قبل/بعد فهرست فاکتورهای عمده (SalesInvoice.tsx، تب «فهرست»)
 * با setListSkip ⇒ useEffect ⇒ loadList() از from/to *فعلی* state می‌خواند، نه از بازه‌ی نمایش‌داده‌شده (همان الگوی AUDIT-D48).
 * مثال عددی (رفتاری روی salesService.list، take=۵): بازه‌ی امروز ۶ فاکتور عمده ۱٬۰۰۰ ⇒ صفحه‌ی ۱ (۵ ردیف، جمع ۶٬۰۰۰).
 * کاربر «از/تا» را به دیروز (۳ فاکتور ۲٬۰۰۰) عوض می‌کند و بدون «نمایش» «صفحه‌ی بعد» می‌زند ⇒ skip=۵ روی دیروز ⇒
 * جدول خالی با نوار «۳ فاکتور عمده · جمع ۶٬۰۰۰» و ۳ فاکتور دیروز هرگز در صفحه‌ی اول دیده نمی‌شوند.
 * رفع: loadList(skip, range) + بازه‌ی اعمال‌شده در listMeta.range + purchasePageRequest/purchaseRangeDirty (AUDIT-D51).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11703-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const { purchasePageRequest } = await import('../../src/shared/purchaseListPaging.ts')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const yMs = T0 - 12 * 3600_000; const yJ = toJalaliDate(new Date(yMs))
const tMs = Math.min(Date.now() - 1000, T0 + 60_000); const tJ = toJalaliDate(new Date(tMs))
let no = 7000
for (let i = 0; i < 6; i++) seed.insert('SaleInvoice', { receiptNo: ++no, status: 'FINAL', orderType: 'WHOLESALE', grandTotal: 1_000, goodsTotal: 1_000, issuedAt: tMs, issuedAtJalali: tJ })
for (let i = 0; i < 3; i++) seed.insert('SaleInvoice', { receiptNo: ++no, status: 'FINAL', orderType: 'WHOLESALE', grandTotal: 2_000, goodsTotal: 2_000, issuedAt: yMs, issuedAtJalali: yJ })
const list = (from, to, skip) => salesService.list({ from: jalaliStartOfDay(from).toISOString(), to: jalaliEndOfDay(to).toISOString(), orderType: 'WHOLESALE', skip, take: 5 })

// صفحه‌ی ۱ بازه‌ی اعمال‌شده (امروز)
const p1 = await list(tJ, tJ, 0)
eq('صفحه‌ی ۱ امروز: ۵ ردیف از ۶', [p1.length, p1.page?.totalCount, p1.totals?.grandTotal], [5, 6, 6_000])
// کاربر state را به دیروز عوض می‌کند و «صفحه‌ی بعد» می‌زند
const stateFrom = yJ, stateTo = yJ
const oldWay = await list(stateFrom, stateTo, p1.page.skip + p1.page.take) // رفتار قبل: skip صفحه‌ی قدیم روی بازه‌ی تازه
eq('(شاهد باگ) رفتار قدیم: skip=۵ روی دیروز ⇒ ۰ ردیف در حالی که ۳ فاکتور هست', [oldWay.length, oldWay.totals?.count], [0, 3])
const q = purchasePageRequest({ from: tJ, to: tJ }, p1.page, p1.length, 'next')
const p2 = q ? await list(q.from, q.to, q.skip) : []
eq('درخواست صفحه‌ی بعد روی بازه‌ی اعمال‌شده ⇒ ۱ ردیف باقی‌مانده‌ی امروز', [p2.length, p2.totals?.grandTotal], [1, 6_000])

// UI
const ui = readFileSync(resolve('src/renderer/src/pages/SalesInvoice.tsx'), 'utf8')
eq('loadList بازه و skip را پارامتر می‌گیرد', /const loadList = useCallback\(async \(skip = 0, range\?: \{ from: string; to: string \}\)/.test(ui), true)
eq('loadList بازه‌ی اعمال‌شده را ثبت می‌کند', /range: \{ from: rf, to: rt \}/.test(ui), true)
eq('صفحه‌ی قبل/بعد از helper و بازه‌ی اعمال‌شده', /purchasePageRequest\(listMeta\.range, listPage, rows\.length, 'next'\)/.test(ui) && /purchasePageRequest\(listMeta\.range, listPage, rows\.length, 'prev'\)/.test(ui), true)
eq('دیگر setListSkip (skip بر state فعلی) نیست', /setListSkip\(/.test(ui), false)
eq('هشدار «بازه‌ی تازه، نمایش را بزنید» با purchaseRangeDirty', /purchaseRangeDirty\(listMeta\.range, from, to\)/.test(ui), true)
eq('بارگذاری دوباره بعد از ویرایش/پرداخت روی همان بازه و صفحه', /reloadList\(\)/.test(ui) && /loadList\(listPage\?\.skip \?\? 0, listMeta\.range\)/.test(ui), true)
eq('regex fix-s117-sale-list حفظ شد', /listTotals/.test(ui) && !/money\(rows\.reduce\(\(s, r\) => s \+ r\.grandTotal, 0\)\)/.test(ui), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
