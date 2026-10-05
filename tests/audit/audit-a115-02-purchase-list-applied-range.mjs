/**
 * ممیزی نشست ۱۱۵ — A115-02 (P3، UI): صفحه‌ی قبل/بعد فهرست خرید در PurchaseInvoice.tsx از from/to فعلی state می‌خواند،
 * نه از بازه‌ی اعمال‌شده. مثال: بازه‌ی فروردین (۶٬۰۰۰ فاکتور) نمایش ⇒ صفحه‌ی ۱؛ کاربر «از» را به اردیبهشت عوض می‌کند و
 * بدون «نمایش» «صفحه‌ی بعد» می‌زند ⇒ skip=۵٬۰۰۰ روی اردیبهشت (۳۰۰ فاکتور) ⇒ صفحه‌ی خالی و ۳۰۰ فاکتور دیده نمی‌شوند.
 * رفع: بازه‌ی اعمال‌شده در listMeta.range، helper خالص purchasePageRequest (src/shared/purchaseListPaging.ts).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
let h = null
try { h = await import('../../src/shared/purchaseListPaging.ts') } catch { console.log('  (helper موجود نیست)') }
const P = (...a) => (h ? h.purchasePageRequest(...a) : 'NO-HELPER')
const applied = { from: '1405/01/01', to: '1405/01/31' }
const page1 = { skip: 0, take: 5000, totalCount: 6000 }
eq('صفحه‌ی بعد روی بازه‌ی اعمال‌شده', P(applied, page1, 5000, 'next'), { from: '1405/01/01', to: '1405/01/31', skip: 5000 })
eq('صفحه‌ی اول: قبل ممکن نیست', P(applied, page1, 5000, 'prev'), null)
const page2 = { skip: 5000, take: 5000, totalCount: 6000 }
eq('صفحه‌ی آخر: بعد ممکن نیست', P(applied, page2, 1000, 'next'), null)
eq('صفحه‌ی آخر: قبل ⇒ skip ۰ روی همان بازه', P(applied, page2, 1000, 'prev'), { from: '1405/01/01', to: '1405/01/31', skip: 0 })
eq('بدون بازه‌ی اعمال‌شده ⇒ null', P(null, page1, 5000, 'next'), null)
eq('skip/take خراب ⇒ امن (take≥۱)', P(applied, { skip: -3, take: 0, totalCount: 2 }, 1, 'next'), { from: '1405/01/01', to: '1405/01/31', skip: 1 })
eq('dirty وقتی state با بازه‌ی نمایش فرق دارد', h ? h.purchaseRangeDirty(applied, '1405/02/01', '1405/01/31') : null, true)
eq('dirty=false وقتی یکی است', h ? h.purchaseRangeDirty(applied, '1405/01/01', '1405/01/31') : null, false)
const ui = readFileSync(resolve('src/renderer/src/pages/PurchaseInvoice.tsx'), 'utf8')
eq('UI دیگر skip صفحه را با from/to فعلی state نمی‌سازد', /loadList\(listMeta\.page!\.skip/.test(ui), false)
eq('UI صفحه‌بندی را از helper و listMeta.range می‌گیرد', /purchasePageRequest\(listMeta\.range/.test(ui), true)
eq('loadList بازه‌ی اعمال‌شده را در listMeta ثبت می‌کند', /range: \{ from: rf, to: rt \}/.test(ui), true)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
