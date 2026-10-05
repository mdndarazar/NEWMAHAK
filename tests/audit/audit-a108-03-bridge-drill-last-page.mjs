/**
 * ممیزی نشست ۱۰۸ — A108-03 (P3): صفحه‌ی آخر drill-down پل تطبیق.
 * سرویس sourcesWarning و UI نوار صفحه را فقط با truncated=true نشان می‌دادند. در صفحه‌ی آخر (skip>0 و
 * truncated=false) نه هشدار بود نه «صفحه قبل»: ۱ سند از ۳ با پانویس «جمع ۱ سند نمایش‌داده‌شده» و مبلغی ≠ عدد
 * ردیف، بی‌هیچ قیدی که این فقط صفحه‌ی ۳ از ۳ است، و راه برگشت به صفحه‌های قبل بسته بود.
 * رفع: helper خالص bridgeDrillPager (src/shared/reportExtraOutput.ts) برای سرویس و UI.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10803-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
let bridgeDrillPager = null
try { ({ bridgeDrillPager } = await import('../../src/shared/reportExtraOutput.ts')) } catch {}
const db = harnessClient(); const seed = makeSeeder(db)
const today = toJalaliDate(new Date())
const T0 = jalaliStartOfDay(jalaliToday()).getTime()
const A = seed.user('الف')
const mCash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 60_000, userId: A })
for (let i = 0; i < 3; i++) {
  const at = T0 + 100_000 + i * 1000
  const inv = seed.insert('SaleInvoice', { receiptNo: 1 + i, status: 'SETTLED', orderType: 'INTERNAL', grandTotal: 100_000, paidTotal: 100_000, goodsTotal: 100_000, discountTotal: 0, taxTotal: 0, issuedAt: at, issuedAtJalali: today, userId: A, shiftId: S, deductInventory: 0, settledAt: at })
  seed.insert('Payment', { invoiceId: inv, methodId: mCash, amount: 100_000, kind: 'CASH', destination: 'CASH', paidAt: at, paidAtJalali: today, createdByUserId: A, createdShiftId: S })
}
const get = async (skip) => (await salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceKey: 'realCash', bridgeSourceSkip: skip, bridgeSourceTake: 1 })).accounting.bridge.rows.find((r) => r.key === 'realCash')
const last = await get(2)
eq('پیش‌شرط: صفحه‌ی آخر ۱ سند، truncated=false، totalCount=۳', [last.sources.length, last.sourcesPage.truncated, last.sourcesPage.totalCount], [1, false, 3])
eq('سرویس: صفحه‌ی آخر هم هشدار «بخشی از اسناد» دارد', typeof last.sourcesWarning === 'string' && last.sourcesWarning.includes('۳'), true)
const first = await get(0)
eq('سرویس: صفحه‌ی اول هشدار دارد', typeof first.sourcesWarning === 'string', true)
const all = (await salesService.reportRows({ fromJalali: today, toJalali: today, withDrillDown: true, bridgeSourceKey: 'realCash' })).accounting.bridge.rows.find((r) => r.key === 'realCash')
eq('سرویس: همه‌ی اسناد در یک صفحه ⇒ بی‌هشدار', all.sourcesWarning ?? null, null)
eq('helper خالص bridgeDrillPager وجود دارد', typeof bridgeDrillPager, 'function')
if (typeof bridgeDrillPager === 'function') {
  const p = bridgeDrillPager({ skip: 2, take: 1, totalCount: 3, truncated: false }, 1)
  eq('صفحه‌ی آخر: نوار نمایش، صفحه ۳ از ۳، قبل فعال، بعد غیرفعال', [p.show, p.pageNo, p.pageCount, p.canPrev, p.canNext], [true, 3, 3, true, false])
  eq('صفحه‌ی آخر: متن «۳ تا ۳ از ۳»', /۳ تا ۳ از ۳/.test(p.warning ?? ''), true)
  const f = bridgeDrillPager({ skip: 0, take: 200, totalCount: 5, truncated: false }, 5)
  eq('کامل: بدون نوار و هشدار', [f.show, f.warning], [false, null])
  const z = bridgeDrillPager(undefined, 0)
  eq('بدون page: بدون نوار', z.show, false)
}
const ui = readFileSync(new URL('../../src/renderer/src/components/AccountingBlocks.tsx', import.meta.url), 'utf8')
eq('UI نوار صفحه را از bridgeDrillPager می‌سازد', /bridgeDrillPager\(/.test(ui) && /pager\.show/.test(ui), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
