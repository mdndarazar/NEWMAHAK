// @ts-check
/**
 * قرارداد کارت گردش اعتبار خرید:
 * - دسته‌های صدور مانعةالجمع‌اند و سرور (نه Renderer) آن‌ها را می‌سازد.
 * - هر مبلغ به یک Financial Inspector source امن می‌رسد.
 * - کارت/ریزبین هرگز کد قابل‌مصرف را در DTO یا متن نمایش نمی‌دهند.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const accounting = read('src/main/services/accountingReport.ts')
const types = read('src/shared/types.ts')
const inspectorService = read('src/main/services/financialInspectorService.ts')
const inspectorUi = read('src/renderer/src/components/cash/FinancialInspector.tsx')
const lifecycleCard = read('src/renderer/src/components/cash/CreditLifecycleCard.tsx')
const reports = read('src/renderer/src/pages/SalesReports.tsx')

console.log('--- ۱. قرارداد سرورِ دسته‌بندی صدور ---')
for (const field of [
  'issuedLifecycleReturn',
  'issuedLifecycleExchange',
  'issuedLifecycleManual',
  'issuedLifecycleOverpay',
  'issuedLifecycleRemainder',
  'issuedLifecycleOther'
]) {
  assert.match(types, new RegExp(`${field}\\?: number`), `${field} باید در قرارداد گزارش باشد`)
  assert.match(accounting, new RegExp(`${field}: split\\.lifecycle\\.`), `${field} باید از صورت رسمی main پر شود`)
}
assert.match(accounting, /const lifecycleKey = remainderIds\.has\(r\.id\)/,
  'باقی‌مانده باید پیش از خاستگاه‌های دیگر دسته‌بندی شود')
assert.match(accounting, /r\.source === CreditSource\.OVERPAY[\s\S]{0,180}?r\.exchangeInvoiceId != null[\s\S]{0,180}?r\.returnId != null/,
  'ترتیب اضافه‌دریافت، تعویض و برگشت باید قطعی و مانعةالجمع باشد')
assert.match(accounting, /sum شش‌تایی = issued|جمع شش‌تایی = issued/,
  'رابطهٔ reconcile دسته‌ها با کل صادرشده باید مستند باشد')
console.log('  ✓ صدور از یک مجموعهٔ server-side و با اولویت صریح دسته‌بندی می‌شود')

console.log('--- ۲. تاریخچه و مبلغ رسمی ریزبین ---')
for (const key of [
  'storeCreditIssuedAll',
  'storeCreditIssuedReturn',
  'storeCreditIssuedExchange',
  'storeCreditIssuedManual',
  'storeCreditIssuedOverpay',
  'storeCreditIssuedRemainder',
  'storeCreditIssuedOther',
  'storeCreditExpired',
  'storeCreditCanceled'
]) {
  assert.match(types, new RegExp(`'${key}'`), `${key} باید allowlist source باشد`)
  assert.match(inspectorService, new RegExp(key), `${key} باید مبلغ/منبع سمت main داشته باشد`)
}
assert.match(inspectorService, /issuedLifecycleReturn/)
assert.match(accounting, /storeCreditScopes\(scope, \[\]\)/,
  'فهرست چرخه باید همان scope حسابداری را به کار بگیرد')
assert.match(inspectorService, /originReturn/, 'شناسنامهٔ صدور باید provenance برگشت را حل کند')
assert.doesNotMatch(lifecycleCard, /\.code\b|barcode|بارکد\s*[:=]/i,
  'کارت گردش نباید کد/بارکد اعتبار را حمل یا نمایش دهد')
console.log('  ✓ هر سبد source مجاز و مبلغ رسمی سرور دارد؛ منشأ سند در شناسنامه امن است')

console.log('--- ۳. ورود مستقیم از کارت، بدون مودال یا فرمول تازه ---')
assert.match(inspectorUi, /initialSourceKey\?: FinancialInspectorKey/)
assert.match(inspectorUi, /\{ type: 'overview' \}, \{ type: 'sources', key: initialSourceKey \}/,
  'ورود مستقیم باید stack ایمن و قابل بازگشت داشته باشد')
assert.match(reports, /<CreditLifecycleCard\b/)
assert.match(reports, /setFinancialInspectorInitialSource\(key\)/)
assert.match(reports, /initialSourceKey=\{financialInspectorInitialSource\}/)
assert.doesNotMatch(lifecycleCard, /reduce\(|issuedLifecycleReturn\s*\+|issuedLifecycleExchange\s*\+/,
  'Renderer نباید ارقام چرخه را بازجمع یا بازطبقه‌بندی کند')
console.log('  ✓ کارت به همان Financial Inspector واحد می‌رود و renderer فرمول تازه ندارد')

console.log('\nنتیجه: گردش اعتبار امن، قابل ردیابی و هم‌راستا با صورت رسمی گزارش است.')
