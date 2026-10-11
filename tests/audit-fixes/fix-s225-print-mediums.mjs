/**
 * بازبینی بعد از f9efee2 — سه Medium چاپ.
 * اجرا: node tests/audit-fixes/fix-s225-print-mediums.mjs
 *
 * این تست ساختاری، قراردادهای کم‌ریسک اصلاحات را قفل می‌کند:
 *   1) RAW+دیالوگ ویندوز در label/test page رد می‌شود.
 *   2) modal اعتبار اضافه‌دریافت هنگام چاپ بسته نمی‌شود و fallback صفحه دارد.
 *   3) خطای markPrinted خطای اصلی outcome نامعلوم را نمی‌پوشاند و success چاپ را failed نمی‌کند.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')

let ok = 0
let bad = 0
function check(label, actual, expected = true) {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}

const route = read('src/main/print/raw/route.ts')
const ipc = read('src/main/ipc/index.ts')
const testPage = read('src/main/print/testPage.ts')
const overpay = read('src/renderer/src/components/OverpayFlowDialogs.tsx')
const invoicePayments = read('src/renderer/src/components/InvoicePaymentsModal.tsx')
const salesInvoice = read('src/renderer/src/pages/SalesInvoice.tsx')
const salesReturn = read('src/renderer/src/pages/SalesReturn.tsx')
const printService = read('src/main/services/PrintService.ts')
const creditUi = read('src/shared/creditUi.ts')

console.log('\n— M1) RAW + Windows dialog')
check('guard مشترک RAW+silent:false export شده و خود route هم از آن استفاده می‌کند', [
  /export function assertRawNotDialog\(silent: unknown\)/.test(route),
  /if \(silent === false\)/.test(route),
  /assertRawNotDialog\(input\.silent\)/.test(route)
], [true, true, true])

const labelStart = ipc.indexOf('handle(IPC.printLabels')
const labelEnd = ipc.indexOf('handle(IPC.printDiagnose')
const labelBlock = ipc.slice(labelStart, labelEnd)
check('printLabels در شاخه RAW قبل از TSPL guard دیالوگ دارد', [
  /assertRawNotDialog\(p\?\.silent\)/.test(labelBlock),
  labelBlock.indexOf('assertRawNotDialog(p?.silent)') >= 0 && labelBlock.indexOf('assertRawNotDialog(p?.silent)') < labelBlock.indexOf('await printTsplRows')
], [true, true])

const testRawBlock = testPage.slice(testPage.indexOf("if (method === 'RAW')"), testPage.indexOf("await printHtml", testPage.indexOf("if (method === 'RAW')")))
check('printTestPage در شاخه RAW از silent محاسبه‌شده guard می‌گیرد', [
  /const silent = input\.silent == null \? !useSystemDialog : input\.silent !== false/.test(testPage),
  /assertRawNotDialog\(silent\)/.test(testRawBlock),
  testRawBlock.indexOf('assertRawNotDialog(silent)') >= 0 && testRawBlock.indexOf('assertRawNotDialog(silent)') < testRawBlock.indexOf("if (profile === 'LABEL')")
], [true, true, true])

console.log('\n— M2) lifecycle پیام چاپ اعتبار اضافه‌دریافت')
check('خود modal هنگام creditPrinting با Esc/backdrop/X بسته نمی‌شود و دکمه بستن disabled است', [
  /onClose=\{\(\) => \{\s*if \(!creditPrinting\) onCloseIssued\(\)\s*\}\}/.test(overpay),
  /disabled=\{creditPrinting\}/.test(overpay),
  /creditPrintProblem\.kind === 'unknown' \|\| creditPrintProblem\.kind === 'warning'/.test(overpay)
], [true, true, true])
check('هشدار markFailed چاپ انجام‌شده را به چاپ کور دوباره تبدیل نمی‌کند', [
  /disabled=\{busy \|\| creditPrinting \|\| creditPrintProblem\?\.kind === 'warning'\}/.test(overpay),
  /چاپ انجام شده؛ دوباره چاپ نکنید/.test(overpay)
], [true, true])
check('printOverpayCredit هشدار mark را به modal برمی‌گرداند نه اینکه گم کند', [
  /Promise<OverpayCreditPrintProblem>/.test(overpay),
  /res\.warnings/.test(overpay),
  /kind: 'warning'/.test(overpay)
], [true, true, true])
check('میزبان‌ها اگر نتیجه بعد از بسته‌شدن برسد fallback صفحه دارند', [
  /issuedCreditOpenRef\.current/.test(invoicePayments) && /setErr\(problem\.msg\)/.test(invoicePayments) && /onChanged\?\.\(problem\.msg\)/.test(invoicePayments),
  /issuedCreditOpenRef\.current/.test(salesInvoice) && /else setErr\(problem\.msg\)/.test(salesInvoice),
  /issuedOverpayCreditOpenRef\.current/.test(salesReturn) && /else setErr\(problem\.msg\)/.test(salesReturn)
], [true, true, true])

console.log('\n— M3) markPrinted چاپ اعتبار')
const printCreditStart = printService.indexOf('async printCredit(input:')
const printCreditEnd = printService.indexOf('/**\n   * -------------------------------------------------------------------------', printCreditStart)
const printCredit = printService.slice(printCreditStart, printCreditEnd)
const printBatchStart = printService.indexOf('async printCreditBatch(input:')
const printBatchEnd = printService.indexOf('/**\n   * خروجی PDF', printBatchStart)
const printBatch = printService.slice(printBatchStart, printBatchEnd)
check('printCredit در unknown خطای markPrinted را می‌بلعد و err اصلی را rethrow می‌کند', [
  /isPrintOutcomeUnknown\(err\)/.test(printCredit),
  /catch \(markErr\) \{\s*logCreditMarkFailure\('single unknown'/.test(printCredit),
  /throw err/.test(printCredit)
], [true, true, true])
check('printCredit در success خطای ثبت شمارنده را warning می‌کند نه throw چاپ', [
  /let markFailed = false/.test(printCredit),
  /catch \(markErr\) \{\s*markFailed = true/.test(printCredit),
  /warnings\.push\(printMarkWarning\('اعتبار'\)\)/.test(printCredit),
  /return \{ copies: plan\.length, id, markFailed: warnings\.length > 0, warnings \}/.test(printCredit)
], [true, true, true, true])
check('printCreditBatch هم unknown و success را با try/catch جدا محافظت می‌کند', [
  /catch \(markErr\) \{\s*logCreditMarkFailure\('batch unknown'/.test(printBatch),
  /let marked = \{ \.\.\.CREDIT_MARK_PRINTED_NONE \}/.test(printBatch),
  /catch \(markErr\) \{\s*logCreditMarkFailure\('batch success'/.test(printBatch),
  /return \{ \.\.\.creditPrintBatchResult\(\{ ids, total, capped, marked \}\), markFailed: warnings\.length > 0, warnings \}/.test(printBatch)
], [true, true, true, true])
check('UI نتیجه موفق چاپ اعتبار warnings را نمایش می‌دهد', [
  /warnings\?: string\[\]/.test(creditUi),
  /const warningNote = Array\.isArray\(r\.warnings\)/.test(creditUi),
  /\$\{warningNote\}/.test(creditUi)
], [true, true, true])

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
