/**
 * ممیزی A121-01 (P3، UI) — خروجی «فقط صفحه‌ی جاری» گزارش فروش.
 * قبل: outputMetaText فقط با page.truncated هشدار می‌ساخت ⇒ صفحه‌ی آخر (skip>0، truncated=false)
 *   بی‌هیچ نشانی مثل گزارش کامل چاپ/Excel می‌شد؛ صفحه‌ی میانی هم «X تا Y» نداشت. در تب «جزئیات فروش»
 *   عدد «نمایش» شمار *قلم* بود ولی totalCount شمار *فاکتور* ⇒ «نمایش ۶ از ۴ فاکتور».
 * بعد: helper خالص outputPageRangeNote / outputLastPageNotes / shownInvoiceUnits در reportExtraOutput.ts
 *   و سیم‌کشی آن در SalesReports.tsx. regexهای fix-s121/s133 دست‌نخورده.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
let H = {}
try { H = await import(pathToFileURL(resolve(root, 'src/shared/reportExtraOutput.ts')).href) } catch (e) { console.log('  ⚠ helper بارگذاری نشد', String(e?.message).slice(0, 80)) }
const call = (name, ...args) => { try { return typeof H[name] === 'function' ? H[name](...args) : `MISSING:${name}` } catch (e) { return `THROW:${e?.message}` } }

// صفحه‌ی اول از ۱۲۵ ردیف، take=۵۰
const first = { skip: 0, take: 50, totalCount: 125, truncated: true }
const middle = { skip: 50, take: 50, totalCount: 125, truncated: true }
const last = { skip: 100, take: 50, totalCount: 125, truncated: false }
const single = { skip: 0, take: 50, totalCount: 30, truncated: false }

eq('صفحه‌ی اول: نشان «۱ تا ۵۰ از ۱۲۵»', call('outputPageRangeNote', first, 50, 'ردیف'), 'بازه‌ی ردیف‌های این خروجی: نمایش ۱ تا ۵۰ از ۱۲۵ ردیف')
eq('صفحه‌ی میانی: نشان «۵۱ تا ۱۰۰ از ۱۲۵»', call('outputPageRangeNote', middle, 50, 'ردیف'), 'بازه‌ی ردیف‌های این خروجی: نمایش ۵۱ تا ۱۰۰ از ۱۲۵ ردیف')
eq('صفحه‌ی آخر: نشان «۱۰۱ تا ۱۲۵ از ۱۲۵»', call('outputPageRangeNote', last, 25, 'ردیف'), 'بازه‌ی ردیف‌های این خروجی: نمایش ۱۰۱ تا ۱۲۵ از ۱۲۵ ردیف')
eq('بدون صفحه‌بندی (کل در یک صفحه): بدون نشان', call('outputPageRangeNote', single, 30, 'ردیف'), null)
eq('بدون page: بدون نشان', call('outputPageRangeNote', undefined, 10, 'ردیف'), null)
eq('page null: بدون نشان', call('outputPageRangeNote', null, 10, 'ردیف'), null)
eq('صفحه‌ی خالی بعد از آخر: «۰ ردیف از ۱۲۵»', call('outputPageRangeNote', { skip: 150, take: 50, totalCount: 125, truncated: false }, 0, 'ردیف'), 'بازه‌ی ردیف‌های این خروجی: ۰ ردیف از ۱۲۵')

const lastNotes = call('outputLastPageNotes', last, 25, 'ردیف')
eq('صفحه‌ی آخر: هشدار صریح «صفحه‌ی آخر» + جمع فقط همین صفحه', lastNotes, [
  'هشدار خروجی: این چاپ/فایل فقط صفحه‌ی آخر است، نه کل گزارش؛ ردیف‌های صفحه‌های قبل در آن نیست.',
  'جمع مبلغ ردیف‌های این فایل فقط همین صفحه است؛ جمع کل بازه را فقط از جمع مستقل endpoint بخوانید.'
])
eq('صفحه‌ی اول/میانی (truncated): outputLastPageNotes خالی (شاخه‌ی truncated جدا هشدار می‌دهد)', call('outputLastPageNotes', middle, 50, 'ردیف'), [])
eq('بدون صفحه‌بندی: outputLastPageNotes خالی', call('outputLastPageNotes', single, 30, 'ردیف'), [])
eq('بدون page: outputLastPageNotes خالی', call('outputLastPageNotes', undefined, 30, 'ردیف'), [])

// تب جزئیات فروش: واحد صفحه فاکتور است، ردیف‌ها قلم.
const itemRows = [{ invoiceId: 7 }, { invoiceId: 7 }, { invoiceId: 8 }, { invoiceId: 9 }, { invoiceId: 9 }, { invoiceId: 9 }]
eq('جزئیات فروش: ۶ قلم از ۳ فاکتور ⇒ واحد نمایش ۳ فاکتور', call('shownInvoiceUnits', itemRows), 3)
eq('جزئیات فروش: آرایه‌ی خالی ⇒ ۰', call('shownInvoiceUnits', []), 0)
eq('جزئیات فروش: ورودی نامعتبر ⇒ ۰', call('shownInvoiceUnits', null), 0)
eq('جزئیات فروش صفحه‌ی آخر: «۴ تا ۶ از ۶ فاکتور» (نه ۶ قلم)', call('outputPageRangeNote', { skip: 3, take: 3, totalCount: 6, truncated: false }, call('shownInvoiceUnits', itemRows), 'فاکتور'), 'بازه‌ی ردیف‌های این خروجی: نمایش ۴ تا ۶ از ۶ فاکتور')

// سیم‌کشی UI (ساختاری؛ رفتار در helper سنجیده شد)
const page = readFileSync(resolve(root, 'src/renderer/src/pages/SalesReports.tsx'), 'utf8')
const metaBlock = page.slice(page.indexOf('const outputMetaText = (() => {'), page.indexOf('const fraudGroupsOf'))
eq('UI: شاخه‌ی صفحه‌ی آخر outputLastPageNotes را صدا می‌زند', /else if \(page && page\.skip > 0\)[\s\S]{0,200}outputLastPageNotes\(page, rowsShown, noun\)/.test(metaBlock), true)
eq('UI: نشان X تا Y از N برای هر صفحه‌ی جزئی', /outputPageRangeNote\(page, rowsShown, noun\)/.test(metaBlock), true)
eq('UI: تب جزئیات فروش واحد فاکتور را می‌شمارد', /tab === 'items'\s*\?\s*shownInvoiceUnits\(items\)/.test(metaBlock), true)
eq('UI: regex fix-s121 truncated برقرار', /if \(page\?\.truncated\)/.test(page) && /نمایش \$\{faDigits\(rowsShown\)\} از \$\{faDigits\(page\.totalCount\)\}/.test(page), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
