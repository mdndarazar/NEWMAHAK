// @ts-check
/** گارد قرارداد ریزبین مالی واحد: navigation داخلی، بدون mutation و بدون مودال روی مودال. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p) => readFileSync(resolve(p), 'utf8')
const inspector = read('src/renderer/src/components/cash/FinancialInspector.tsx')
const reports = read('src/renderer/src/pages/SalesReports.tsx')
const drawer = read('src/renderer/src/components/cash/DrawerVsPosSplit.tsx')

console.log('--- ۱. ریزبین واحد و navigation داخلی ---')
assert.match(inspector, /type Pane =/, 'پنل باید navigation state صریح داشته باشد')
assert.match(inspector, /const \[stack, setStack\]/, 'navigation باید با stack داخلی باشد')
assert.match(inspector, /type: 'overview'/)
assert.match(inspector, /type: 'formula'/)
assert.match(inspector, /type: 'sources'/)
assert.match(inspector, /type: 'document'/)
assert.match(inspector, /role="dialog"/)
assert.match(inspector, /aria-modal="true"/)
assert.match(inspector, /event\.key !== 'Tab'/, 'مودال باید focus trap داشته باشد')
assert.match(inspector, /opener && dialogRef\.current\?\.contains\(document\.activeElement\)/, 'focus باید بازگردد')
assert.doesNotMatch(inspector, /dangerouslySetInnerHTML/, 'نمایش اطلاعات مالی نباید HTML خام اجرا کند')
console.log('  ✓ مسیر L0 تا L3 و دسترس‌پذیری مودال برقرار است')

console.log('--- ۲. مرزهای حسابداری و پیام‌های صادقانه ---')
assert.match(inspector, /عدد مرجع فعلی گزارش/)
assert.match(inspector, /خالص گردش نقدی صورت‌حساب/)
assert.match(inspector, /پل حسابداری تراز است؛ فقط ترکیب اعداد نمایشی/, 'COMPOSITION_DRIFT نباید پل باز نامیده شود')
assert.match(inspector, /مبلغ رسمی این خط از پل تطبیق می‌آید/, 'منشأ عدد باید صریح باشد')
assert.match(inspector, /نتایج سرچ‌شده هرگز جای مبلغ رسمی را نمی‌گیرند/)
assert.match(inspector, /PAGE_ROWS/, 'منشأ صفحه‌ای تسویه‌های اعتباری باید صریح باشد')
assert.match(inspector, /reconciles/, 'تیک هم‌خوانی باید از سرور قرارداد بگیرد')
console.log('  ✓ عدد مرجع، پل و گردش نقدی با معنای جدا نمایش می‌گیرند')

console.log('--- ۳. اتصال فقط‌خواندنی و عدم مودال‌های روی هم ---')
assert.match(inspector, /CH\.saleReportFinancialSources/)
assert.match(inspector, /CH\.saleReportFinancialDocument/)
assert.match(reports, /<FinancialInspector\b/, 'صفحه فقط یک ریزبین مالی mount می‌کند')
assert.doesNotMatch(reports, /<NetToDrawerCard\b/, 'مودال زنجیره قدیمی نباید کنار ریزبین mount شود')
assert.match(drawer, /onOpenFinancialInspector/, 'کاشی‌ها باید ریزبین واحد را باز کنند')
assert.match(drawer, /if \(onOpenFinancialInspector\)[\s\S]{0,100}?onOpenFinancialInspector\(detail\)/)
console.log('  ✓ کاشی‌ها و هدر به ریزبین واحد می‌روند؛ مودال قدیمی هم‌زمان mount نیست')

console.log('\nنتیجه: گاردهای ریزبین مالی یکپارچه برقرارند.')
