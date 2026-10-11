// @ts-check
/**
 * قرارداد امنیتی گزارش فروش: کدِ قابل‌مصرف اعتبار خرید نباید از مسیرهای
 * گزارش/ریزبین عبور کند. نمای محرمانهٔ مدیر در فاز جدا و مجوزدار ساخته می‌شود.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const types = read('src/shared/types.ts')
const accounting = read('src/main/services/accountingReport.ts')
const inspector = read('src/main/services/financialInspectorService.ts')
const reports = read('src/renderer/src/pages/SalesReports.tsx')
const nonCash = read('src/renderer/src/components/cash/NonCashDrawer.tsx')
const storyContract = types.slice(
  types.indexOf('export interface StoreCreditUsageStory'),
  types.indexOf('export interface SaleStoreCreditBlock')
)

console.log('--- قرارداد redaction اعتبار خرید در گزارش ---')
assert.match(storyContract, /safeText: string/, 'داستان مصرف گزارش باید متن امن داشته باشد')
assert.doesNotMatch(storyContract, /\bcode\s*:/,
  'قرارداد داستان عمومی نباید کد اعتبار داشته باشد')
assert.match(types, /subKind\?: 'STORE_CREDIT_ISSUANCE' \| 'STORE_CREDIT_REDEMPTION'/,
  'نوع source اعتبار باید صریح باشد، نه وابسته به label')

assert.match(accounting, /subKind: 'STORE_CREDIT_ISSUANCE'/)
assert.match(accounting, /subKind: 'STORE_CREDIT_REDEMPTION'/)
assert.doesNotMatch(accounting, /label:\s*`اعتبار «\$\{r\.code\}/,
  'برچسب صدور اعتبار نباید کد را حمل کند')
assert.doesNotMatch(accounting, /label:\s*`مصرف اعتبار «\$\{r\.code\}/,
  'برچسب مصرف اعتبار نباید کد را حمل کند')
assert.doesNotMatch(accounting, /بارکد \$\{code\}/,
  'داستان مصرف نباید کد را در متن عمومی جاسازی کند')

assert.match(inspector, /source\.subKind === 'STORE_CREDIT_REDEMPTION'/,
  'ریزبین باید نوع اعتبار را از metadata بخواند')
assert.doesNotMatch(inspector, /source\.label\.startsWith\('مصرف اعتبار'/,
  'ریزبین نباید برای تشخیص سند به متن redacted شده تکیه کند')
assert.doesNotMatch(inspector, /redemption\.code|credit\.code/,
  'شناسنامهٔ عمومی ریزبین نباید reference کد اعتبار را برگرداند')

assert.match(reports, /safeText: string/)
assert.doesNotMatch(reports, /creditUsedStories\?: \{ code:/,
  'گزارش فروش نباید type دارای code از داستان اعتبار بگیرد')
assert.match(nonCash, /عنوان امن/)
assert.match(nonCash, /story\.safeText/)
assert.doesNotMatch(nonCash, /عنوان \/ بارکد|story\.text|creditUsedStories\?: \{ code:/,
  'پنل غیرنقدی نباید کد یا متن خام اعتبار را نمایش دهد')
console.log('  ✓ گزارش عمومی و ریزبین، کد اعتبار را حمل یا از label حدس نمی‌زنند')
