/*
 * نشست ۳۱۸ · فاز ۳ — گاردهای ایستا روی نمای تشخیص پل در رندرر.
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s318-3-bridge-diag-renderer.mjs
 *
 * قوانین قفل‌شده (طرح برنده «کامیلا» — «متن‌خوانی نباشد، فقط بخواند»):
 *   الف) تک‌دکمه‌ی ورود: report.accounting.bridge.balanced === false
 *      — نه داخل هر دو جای رندر هشدار، نه متن‌خوانی از رشته‌ها.
 *   ج) مودال هیچ‌وقت load() صفحه را صدا نمی‌زند و هیچ عددی حساب نمی‌کند
 *      (guard: بدون .reduce حسییی و بدون جمع دستی amount ها).
 *   د) یادداشت‌ها متن خالص با maxLength=300؛ بدون dangerouslySetInnerHTML.
 *   ه) بنر staleness (تفاوت عدد مودال/صفحه) وجود دارد.
 *   و) رمز هر بار و نه ذخیره — setPassword('') بعد از موفقیت.
 *   ز) AccountingBlocks.tsx به‌جز «نتایج موج/برجسته» دست‌نخورده است.
 */
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (label, cond) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}

const PAGE = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const MODAL = readFileSync('src/renderer/src/components/BridgeDiagnosticsModal.tsx', 'utf8')
const BLOCKS = readFileSync('src/renderer/src/components/AccountingBlocks.tsx', 'utf8')
/** کامنت‌ها حذف می‌شوند تا گاردها روی «کدِ واقعی» اجرا شوند نه توضیحات هدر. */
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1')
const MODAL_CODE = stripComments(MODAL)

console.log('— تک‌دکمه (فقط یک نقطه‌ی ورود، شرط balanced === false) —')
check('فقط یک setBridgeDiagOpen(true)', (PAGE.match(/setBridgeDiagOpen\(true\)/g) ?? []).length === 1)
check('شرط ورود: report.accounting.bridge.balanced === false', /report\.accounting\.bridge\.balanced === false/.test(PAGE))
check('مودال دقیقاً یک‌بار mount شده', (PAGE.match(/<BridgeDiagnosticsModal\b/g) ?? []).length === 1)
check('مودال scope=toServiceFilter(filters) می‌گیرد', /scope=\{toServiceFilter\(filters\)\}/.test(PAGE))
check('pageUnexplained از همان bridge آمده', /pageUnexplained=\{report\?\.accounting\?\.bridge/.test(PAGE))
check('دکمه در «منبع» AccountingBlocks نیست (یک نقطه دیگر در رندر هشدار ثبت نشده)', !/BridgeDiagnosticsModal|bridgeDiagOpen/.test(BLOCKS))

console.log('— مودال: فقط‌خواندنی و بدون محاسبه‌ی عددی —')
check('هیچ import صفحه/هوک گزارش ندارد (load را صدا نمی‌زند)', !/from '\.\.\/pages|\bload\(/.test(MODAL_CODE))
check('بدون reduce حسابی روی مبالغ', !/\.reduce\(/.test(MODAL))
check('بدون جمعِ دستی r.amount در بدنه', !/amount\s*\+/m.test(MODAL.replace(/money\(s\.amount\)/, '').replace(/money\(row\.amount\)/, '')))
check('unexplained فقط از view/page و با Math.abs فرمت می‌شود', /Math\.abs\(view\.bridge\.unexplained\)|Math\.abs\(v\)/.test(MODAL))
check('computedAtIso چاپ می‌شود (بنر/هدر staleness)', /computedAtIso/.test(MODAL))
check('بنر تفاوت عدد مودال/صفحه (stale)', /pageUnexplained/.test(MODAL) && /\+'‌'+|گرفتن گزارش|فرق دارد/.test(MODAL))

console.log('— امنیت شبکه‌ی رندرر —')
check('یادداشت متن خالص (بدون dangerouslySetInnerHTML)', !/dangerouslySetInnerHTML/.test(MODAL_CODE))
check('maxLength={300} روی textarea', /maxLength=\{300\}/.test(MODAL))
check('هر باز شدن رمز تازه (useEffect ریست password)', /if \(open\) \{[\s\S]{0,300}?setPassword\(''\)/.test(MODAL))
check('رمز بعد از موفقیت پاک می‌شود', /setPassword\(''\) \/\/ رمز سریع/.test(MODAL))
check('هر نشان با «قطعی نیست» چاپ می‌شود', (MODAL.match(/قطعی نیست/g) ?? []).length >= 2)
check('رمز فقط به کانال open می‌رود (password در payload open است)', /CH\.saleReportBridgeDiagOpen, \{ scope, password \}/.test(MODAL))
check('sources/notes/noteAdd بدون رمز (نشست سرور)', !/saleReportBridgeDiagSources[^}]*password|saleReportBridgeDiagNotes[^}]*password|saleReportBridgeDiagNoteAdd[^}]*password/.test(MODAL))

console.log('— ثبات بلوک حسابداری (فاز ۳ به آن دست نزد) —')
check('AccountingBlocks.tsx هیچ ارجاعی به نمای جدید ندارد', !/BridgeDiag|bridgeDiagOpen/.test(BLOCKS))
check('رندر هشدار موجود AccountingBlocks دست‌نخورده است', BLOCKS.includes('بدون توضیح'))

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
