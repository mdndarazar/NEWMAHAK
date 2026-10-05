/**
 * ممیزی نشست ۱۰۱ — صفحه‌بندی فهرست اعتبار (تب «مدیریت اعتبار» گزارشات + صفحه‌ی «مدیریت اعتبار خرید»)
 * A101-01 (P2): (۱) تغییر بازه‌ی نوار (prop) skip را صفر نمی‌کرد ⇒ از صفحه‌ی ۳ (skip=۲۰۰۰) به بازه‌ی ۳۰۰تایی
 *   جدول خالی و «نمایش ۲۰۰۱ تا ۳۰۰ از ۳۰۰»؛ (۲) صفحه‌ی مدیریت اعتبار page سرویس را نمی‌خواند ⇒ برش بی‌صدای
 *   ۱٬۰۰۰ ردیف (بند ۴-۴۶): ۱٬۲۰۰ اعتبار ⇒ ۱٬۰۰۰ دیده می‌شد بدون هیچ هشدار و بدون صفحه‌ی بعد.
 * رفتار با helper خالص creditEffectiveSkip / creditListPager (src/shared/creditUi.ts) و list واقعی سرویس سنجیده می‌شود.
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10101-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
let ui = {}
try { ui = await import('../../src/shared/creditUi.ts') } catch (e) { console.log('  ⚠ creditUi import:', e.message) }
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now(); const today = toJalaliDate(new Date())
for (let k = 0; k < 1200; k++) seed.insert('StoreCredit', { code: 'P' + k, amount: 1000, usedAmount: 0, status: 'ACTIVE', source: 'MANUAL', issuedAt: now - k * 1000, createdAt: now - k * 1000, issuedAtJalali: today })
const f = { fromJalali: today, toJalali: today }

console.log('— سرویس: صفحه‌ی اول ۱۰۰۰ از ۱۲۰۰ با page')
const p0 = await storeCreditService.list({ ...ui.creditViewRequest?.('list', f)?.payload ?? f })
eq('صفحه‌ی اول ۱۰۰۰ ردیف', p0.length, 1000)
eq('page.totalCount=۱۲۰۰، truncated', [p0.page?.totalCount, p0.page?.truncated], [1200, true])

console.log('— creditListPager: نوار + هشدار صریح برش')
const pg = typeof ui.creditListPager === 'function' ? ui.creditListPager(p0.page, p0.length) : null
eq('نوار دیده می‌شود و صفحه‌ی بعد skip=۱۰۰۰', [pg?.visible, pg?.nextSkip, pg?.prevSkip], [true, 1000, null])
eq('هشدار برش صریح (۱ تا ۱۰۰۰ از ۱۲۰۰)', typeof pg?.warning === 'string' && pg.warning.includes('1200') && pg.warning.includes('1000'), true)
const req2 = ui.creditViewRequest?.('list', { ...f, skip: pg?.nextSkip ?? 0 })?.payload ?? f
const p1 = await storeCreditService.list(req2)
eq('صفحه‌ی دوم ۲۰۰ ردیف، truncated=false', [p1.length, p1.page?.truncated], [200, false])
const pg2 = typeof ui.creditListPager === 'function' ? ui.creditListPager(p1.page, p1.length) : null
eq('صفحه‌ی دوم: قبل=۰، بعد=ندارد، ۱۰۰۱ تا ۱۲۰۰', [pg2?.prevSkip, pg2?.nextSkip, pg2?.from, pg2?.to], [0, null, 1001, 1200])
const pgAll = typeof ui.creditListPager === 'function' ? ui.creditListPager({ skip: 0, take: 1000, totalCount: 300, truncated: false }, 300) : null
eq('بدون برش: نوار و هشدار ندارد', [pgAll?.visible, pgAll?.warning], [false, null])

console.log('— creditEffectiveSkip: عوض شدن بازه صفحه را اول می‌کند')
const sig = (x) => ui.creditSelectionResetSignature?.(x) ?? JSON.stringify(x)
const st = { signature: sig({ ...f }), skip: 2000 }
eq('همان فیلتر ⇒ skip حفظ', ui.creditEffectiveSkip?.(st, sig({ ...f })), 2000)
eq('بازه‌ی دیگر ⇒ skip=۰ (قبلاً ۲۰۰۰ می‌ماند ⇒ صفحه‌ی خالی)', ui.creditEffectiveSkip?.(st, sig({ fromJalali: '1400/01/01', toJalali: '1400/01/01' })), 0)
eq('تیک «فقط دارای باقی‌مانده» ⇒ skip=۰', ui.creditEffectiveSkip?.(st, sig({ ...f, onlyWithRemaining: true })), 0)

console.log('— سیم‌کشی UI (ساختاری، مکمل)')
const cm = readFileSync(new URL('../../src/renderer/src/pages/CreditManagement.tsx', import.meta.url), 'utf8')
const sr = readFileSync(new URL('../../src/renderer/src/pages/SalesReports.tsx', import.meta.url), 'utf8')
eq('مدیریت اعتبار: page فهرست خوانده و skip فهرست فرستاده می‌شود', /setListPage\(/.test(cm) && /view === 'list' \? listSkip/.test(cm) && /creditListPager\(listPage/.test(cm), true)
eq('تب گزارشات: skip از creditEffectiveSkip با امضای شامل بازه', /creditEffectiveSkip\(creditSkipState, creditSignature\)/.test(sr) && /creditSelectionResetSignature\(\{ fromJalali, toJalali/.test(sr), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
