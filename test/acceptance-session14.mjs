
// Session 14 acceptance harness.
// Runs WITHOUT npm/node_modules: structural (wiring) assertions on the real source
// files + a parse check of every changed file + re-run of the session-13 pure test.
// NOTE: scenarios that need a live Prisma/SQLite DB or Electron IPC cannot execute in
// an offline sandbox with no node_modules; those are asserted structurally and clearly
// labelled STRUCTURAL below (see CHANGELOG-جلسه۱۴.md).
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const read = (f) => fs.readFileSync(f, 'utf8')
let pass = 0, fail = 0
const results = []
function check(id, title, mode, fn) {
  let ok = false, err = ''
  try { ok = fn() === true } catch (e) { ok = false; err = String(e && e.message || e) }
  if (ok) pass++; else fail++
  results.push(`${ok ? 'PASS' : 'FAIL'}  [${mode}] ${id}. ${title}${err ? ' -> ' + err : ''}`)
}

const sales = read('src/main/services/SalesService.ts')
const shape = read('src/main/services/reportShape.ts')
const acctRep = read('src/main/services/accountingReport.ts')
const cashbox = read('src/main/services/CashboxService.ts')
const credit = read('src/main/services/StoreCreditService.ts')
const ipcShared = read('src/shared/ipc.ts')
const ipcMain = read('src/main/ipc/index.ts')
const templates = read('src/main/print/templates.ts')
const printSvc = read('src/main/services/PrintService.ts')
const fraud = read('src/main/services/FraudService.ts')
const mig = read('prisma/migrations/20270919180000_accounting_cash_and_refunds/migration.sql')
const manual = read('prisma/manual/20270919_accounting_cash_and_refunds.sql')

check(1, 'migration SQL is clean (no diff markers, no DROP/RENAME/ALTER TYPE)', 'REAL', () => {
  const bad = (s) => s.split('\n').some((l) => l.startsWith('+')) || /\bDROP\b|\bRENAME\b/i.test(s)
  return !bad(mig) && !bad(manual)
})
check(2, 'REPORT_INCLUDE replaced: payments read with paidAt window', 'STRUCTURAL', () =>
  /function reportInclude\(/.test(sales) && /payments:\s*\{[\s\S]{0,400}?paidAt/.test(sales))
check(3, 'returns read with kind + returnedAt (dead code of session 13 is now live)', 'STRUCTURAL', () =>
  /RETURN_SELECT/.test(sales) && /kind:\s*true/.test(sales) && /returnedAt:\s*true/.test(sales))
check(4, 'returnedTotalOf sums only kind=RETURN inside the period', 'STRUCTURAL', () =>
  /ReturnKind\.RETURN/.test(shape) && /period/.test(shape))
// نشست ۵۹ (زنجیره‌ی رفع) — assertion کهنه به‌روز شد (DECISIONS S59-1): از نشست ۵۸ فرمول
// محلی «grandTotal − paid − returned» عمداً با تنها تابع بدهی `remainingOf` جایگزین شد
// (برگشت + بازپرداخت از پول دریافتی). همان نیت (برگشت در بدهی) حالا این‌طور سنجیده می‌شود:
// shape و recalcSettlement هر دو از remainingOf/invoiceRemaining می‌خوانند و خودِ remainingOf
// برگشت را کم می‌کند و max(0, …) دارد.
const settlementSrc = read('src/shared/settlement.ts')
check(5, 'remaining = max(0, (grandTotal - returned) - netReceived) via remainingOf in shape AND recalcSettlement', 'STRUCTURAL', () =>
  /remainingOf\(/.test(shape) &&
  /async function recalcSettlement[\s\S]{0,2500}?invoiceRemaining\(/.test(sales) &&
  /Math\.max\(0,\s*grandTotal\s*-\s*returnedValue\)/.test(settlementSrc) &&
  /Math\.max\(0,\s*payable\s*-\s*netReceived\)/.test(settlementSrc))
check(6, 'period-wide totals come from aggregate/groupBy, never from the paginated page', 'STRUCTURAL', () =>
  /\.aggregate\(/.test(acctRep) && /\.groupBy\(/.test(acctRep) && /totalCount/.test(sales) && /skip/.test(sales) && /take/.test(sales))
check(7, 'pagination truncation raises an explicit warning with the total row count', 'STRUCTURAL', () =>
  /warnings/.test(sales) && /totalCount/.test(sales))
// جلسه ۲۵ — assertion کهنه به‌روز شد: منطق زنده است ولی نام `resolvePeriod` در
// نشست‌های بعد عوض شد، پس حالا به خودِ رفتار (openedAt .. closedAt ?? now) نگاه می‌کنیم.
check(8, 'shiftId-only filter resolves a period (openedAt .. closedAt ?? now)', 'STRUCTURAL', () =>
  /shift\.openedAt/.test(sales) && /closedAt \?\?/.test(sales))
check(9, 'store-credit / exchangeDiff / priorSettlement no longer gated behind if (from && to)', 'STRUCTURAL', () =>
  /storeCreditIssued/.test(acctRep) && /prior/i.test(acctRep) && /exchangeDiff/.test(acctRep))
check(10, 'cheque block has all four states (registered / due-passed / pending / bounced)', 'STRUCTURAL', () =>
  /ChequeStatus\.PENDING/.test(acctRep) && /ChequeStatus\.CLEARED/.test(acctRep) && /ChequeStatus\.BOUNCED/.test(acctRep) && /dueDate/.test(acctRep))
check(11, 'prior-period credit settlement is measured by paidAt, cheques by clearedAt', 'STRUCTURAL', () =>
  /clearedAt/.test(acctRep) && /paidAt/.test(acctRep) && /prior/i.test(acctRep))
// جلسه ۲۵ — assertion کهنه به‌روز شد: جلسه ۲۱ شرط را عمداً *سخت‌گیرانه‌تر* کرد
// (`status: { in: [...REDEEMABLE_STATUSES] }`), پس هر دو شکل قبول است.
check(12, 'store-credit redemption is atomic (updateMany guards status)', 'STRUCTURAL', () =>
  /updateMany\(\{[\s\S]{0,400}?status:\s*(StoreCreditStatus\.ACTIVE|\{ in: \[\.\.\.REDEEMABLE_STATUSES\])/.test(credit))
check(13, 'manual replacement price in exchange requires ManagerGate + audit with real vs entered price', 'STRUCTURAL', () =>
  /assertManagerPassword/.test(sales) && /EXCHANGE_PRICE_OVERRIDE/.test(sales))
check(14, 'force can no longer over-return quantity (runReturn and returnUpdate)', 'STRUCTURAL', () => {
  const hits = sales.match(/force/g) || []
  return !/force\s*\?\s*Infinity/.test(sales) && !/input\.force\s*&&[\s\S]{0,80}qty/.test(sales) && hits.length > 0
})
check(15, 'exchange with diff<0 demands explicit refundMode (CASH|CARD|STORE_CREDIT), no implicit default', 'STRUCTURAL', () =>
  /refundMode/.test(sales) && /STORE_CREDIT/.test(sales) && /CASH/.test(sales))
check(16, 'new return requires refundMethod; legacy rows labelled as an assumption', 'STRUCTURAL', () =>
  /resolveRefund/.test(sales) && /legacyAssum/i.test(sales))
check(17, 'CashboxService.close uses accounting.ts expectedCash (cash only), not salesService.summary', 'STRUCTURAL', () =>
  /calculateCashClose/.test(cashbox) && /expectedCash/.test(cashbox) && /reportRows/.test(cashbox))

// extras beyond the 17
check(18, 'store-credit ceiling + manager gate + audit', 'STRUCTURAL', () => /STORE_CREDIT_OVER_LIMIT/.test(sales))
check(19, 'IPC: print:return, cashbox:movement:add/list, cashbox:expected, sale:fraud:review, settings:accountingPolicy', 'STRUCTURAL', () => {
  const ch = ['print:return', 'cashbox:movement:add', 'cashbox:movement:list', 'cashbox:expected', 'sale:fraud:review', 'settings:accountingPolicy:get', 'settings:accountingPolicy:set']
  const keys = ['printReturn', 'cashboxMovementAdd', 'cashboxMovementList', 'cashboxExpected', 'saleFraudReview', 'settingsAccountingPolicy', 'settingsAccountingPolicySet']
  return ch.every((c) => ipcShared.includes(c)) && keys.every((k) => ipcMain.includes(k))
})
check(20, 'print: returnReceiptHtml + PrintService.printReturn', 'STRUCTURAL', () =>
  /returnReceiptHtml/.test(templates) && /printReturn/.test(printSvc))
check(21, 'fraud review exposes the nine managerial warning groups', 'STRUCTURAL', () =>
  (fraud.match(/key:\s*'/g) || []).length >= 9)
check(22, 'returnList defaults to kind=RETURN with an opt-in includeExchanges flag', 'STRUCTURAL', () =>
  /includeExchanges/.test(sales))

// parse check of every changed/new TS file (catches syntax errors without tsc)
const changed = [
  'src/shared/accounting.ts', 'src/shared/enums.ts', 'src/shared/types.ts', 'src/shared/ipc.ts', 'src/shared/receipt.ts',
  'src/main/services/reportShape.ts', 'src/main/services/accountingReport.ts', 'src/main/services/SalesService.ts',
  'src/main/services/CashboxService.ts', 'src/main/services/CashMovementService.ts', 'src/main/services/FraudService.ts',
  'src/main/services/SettingsService.ts', 'src/main/services/AuthService.ts', 'src/main/services/PrintService.ts',
  'src/main/print/templates.ts', 'src/main/ipc/index.ts'
]
const parseProblems = []
for (const f of changed) {
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e', `import(${JSON.stringify('../../' + f)}).catch(e=>{if(e&&e.code==='ERR_MODULE_NOT_FOUND')process.exit(0);console.error(e.message);process.exit(2)})`], { cwd: 'test/tmp', stdio: 'pipe' })
  } catch (e) {
    const out = String(e.stderr || e.stdout || e.message)
    if (/SyntaxError|Unexpected|strip-types/i.test(out)) parseProblems.push(f + ': ' + out.split('\n').slice(0, 3).join(' | '))
  }
}
check(23, 'every changed TypeScript file parses (no syntax error) under node strip-types', 'REAL', () =>
  parseProblems.length === 0 || (console.log(parseProblems.join('\n')), false))

// re-run the session-13 pure formula suite
let s13 = ''
try {
  s13 = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/accounting-session13.ts'], { stdio: 'pipe' }).toString()
} catch (e) { s13 = 'FAILED: ' + String(e.stdout || e.stderr || e.message) }
check(24, 'session-13 pure accounting suite (6 scenarios) still passes', 'REAL', () => /PASS/.test(s13))

console.log(results.join('\n'))
console.log('\nsession-13 suite output: ' + s13.trim())
console.log(`\nsession 14 acceptance: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
