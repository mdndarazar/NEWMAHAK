/**
 * ممیزی نشست ۱۱۷ — تست تأیید رفتاری exchangeGet (S117-3) و SalesService.list (S117-4).
 * exchangeGet: سند باطل، سند برگشت ساده (غیرتعویض)، و تعویض روی روز شلوغ با پیام هدف؛ ردیف = ردیف فهرست.
 * list: جمع و تعداد از کل بازه (نه صفحه)، فاکتور CANCELED/DRAFT بیرون از جمع پیش‌فرض، فاکتور بیرون از بازه بیرون، orderType.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s117-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliToday, jalaliStartOfDay, jalaliEndOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const now = Math.max(T0 + 1000, Date.now() - 60_000)
const yMs = T0 - 6 * 3600_000; const yJ = toJalaliDate(new Date(yMs))
let no = 50_000
const inv = (extra = {}) => seed.insert('SaleInvoice', { receiptNo: ++no, status: 'FINAL', orderType: 'IN_STORE', grandTotal: 1_000_000, goodsTotal: 1_000_000, issuedAt: now, issuedAtJalali: today, ...extra })
const ret = (invoiceId, extra = {}) => seed.insert('SaleReturn', { invoiceId, kind: 'EXCHANGE', total: 1_000_000, exchangeTotal: 1_300_000, exchangeDiff: 300_000, returnedAt: now, returnedAtJalali: today, ...extra })
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return String(e.message) } }

// exchangeGet
const exOk = ret(inv())
const exVoid = ret(inv(), { voidedAt: now })
const plain = ret(inv(), { kind: 'RETURN', exchangeTotal: 0, exchangeDiff: 0 })
const exY = ret(inv({ issuedAt: yMs, issuedAtJalali: yJ }), { returnedAt: yMs, returnedAtJalali: yJ, exchangeTotal: 1_700_000, exchangeDiff: 700_000 })
const g = await salesService.exchangeGet({ id: exOk })
eq('تعویض زنده: همان سند با مبلغ جایگزین ۱٬۳۰۰٬۰۰۰', [g?.returnId, g?.exchangeTotal], [exOk, 1_300_000])
const gy = await salesService.exchangeGet({ id: exY })
eq('تعویض روز قبل (بیرون از «امروز»): پیدا می‌شود', [gy?.returnId, gy?.exchangeTotal], [exY, 1_700_000])
eq('سند باطل ⇒ پیام هدف', /این سند، تعویض کالا نیست یا حذف شده است/.test((await errOf(() => salesService.exchangeGet({ id: exVoid }))) ?? ''), true)
eq('برگشت ساده ⇒ پیام هدف', /این سند، تعویض کالا نیست یا حذف شده است/.test((await errOf(() => salesService.exchangeGet({ id: plain }))) ?? ''), true)
eq('بی‌شناسه ⇒ پیام هدف', /سند تعویضی مشخص نشده است/.test((await errOf(() => salesService.exchangeGet({}))) ?? ''), true)
const l = await salesService.exchangeList({ fromJalali: today, toJalali: today })
eq('ردیف exchangeGet = ردیف فهرست', JSON.stringify(l.rows.find((r) => r.returnId === exOk)), JSON.stringify(g))
eq('سند باطل در فهرست تعویض نیست', l.rows.some((r) => r.returnId === exVoid), false)

// SalesService.list (فهرست فاکتورهای عمده)
const W = (total, extra = {}) => inv({ orderType: 'WHOLESALE', grandTotal: total, goodsTotal: total, ...extra })
for (let i = 0; i < 7; i++) W(100_000)
W(5_000_000, { status: 'CANCELED' })
W(3_000_000, { status: 'DRAFT' })
W(9_000_000, { issuedAt: T0 - 3 * 86400_000, issuedAtJalali: toJalaliDate(new Date(T0 - 3 * 86400_000)) })
const q = { from: jalaliStartOfDay(today).toISOString(), to: jalaliEndOfDay(today).toISOString(), orderType: 'WHOLESALE' }
const p1 = await salesService.list({ ...q, take: 3 })
const rowsOf = (r) => (Array.isArray(r) ? r : r.rows)
eq('صفحه‌ی اول ۳ ردیف', rowsOf(p1).length, 3)
eq('جمع کل بازه = ۷ فاکتور ۷۰۰٬۰۰۰ (نه جمع صفحه، بدون لغو/پیش‌نویس/روز دیگر)', p1.totals, { count: 7, grandTotal: 700_000 })
eq('totalCount صفحه‌بندی = ۷ و truncated', [p1.page?.totalCount, p1.page?.truncated], [7, true])
eq('هشدار برش فارسی', (p1.warnings ?? []).length > 0, true)
const p3 = await salesService.list({ ...q, take: 3, skip: 6 })
eq('صفحه‌ی آخر: ۱ ردیف، جمع همچنان کل بازه', [rowsOf(p3).length, p3.totals?.grandTotal], [1, 700_000])
eq('فاکتور لغوشده در هیچ صفحه‌ای نیست', [...rowsOf(p1), ...rowsOf(await salesService.list({ ...q, take: 50 }))].some((r) => r.status === 'CANCELED'), false)
eq('فاکتور تکی (IN_STORE) در فهرست عمده نیست', rowsOf(await salesService.list({ ...q, take: 50 })).every((r) => r.orderType === 'WHOLESALE'), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
