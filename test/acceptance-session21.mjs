// Session 21 acceptance harness — «مدیریت اعتبار خرید» (فاز ۲).
// Runs WITHOUT npm/node_modules, exactly like acceptance-session14.mjs:
//   • REAL       = really executed here (pure logic suite on src/shared/credit.ts + parse of every changed file)
//   • STRUCTURAL = wiring assertion on the real source (needs a live Prisma/SQLite DB or Electron to run for real)
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

const svc = read('src/main/services/StoreCreditService.ts')
const notify = read('src/main/services/NotificationSender.ts')
const sales = read('src/main/services/SalesService.ts')
const settings = read('src/main/services/SettingsService.ts')
const printSvc = read('src/main/services/PrintService.ts')
const templates = read('src/main/print/templates.ts')
const printer = read('src/main/print/printer.ts')
const ipcShared = read('src/shared/ipc.ts')
const ipcMain = read('src/main/ipc/index.ts')
const types = read('src/shared/types.ts')
const credit = read('src/shared/credit.ts')
const schema = read('prisma/schema.prisma')

check(1, 'code uniqueness comes from the DB unique index, not findFirst', 'STRUCTURAL', () =>
  /code\s+String\s+@unique/.test(schema) && !/findFirst\(\{[\s\S]{0,120}?status:\s*StoreCreditStatus\.ACTIVE/.test(svc) && /isP2002/.test(svc))
check(2, 'issueStoreCredit retries on P2002 with a fresh code (no half-written credit)', 'STRUCTURAL', () =>
  /for \(let attempt = 0; attempt < 8 && !created/.test(svc) && /if \(!isP2002\(e\)\) throw e/.test(svc))
check(3, 'redeem asks decideRedeem for the amount (no UI-supplied number is trusted)', 'STRUCTURAL', () =>
  /decideRedeem\(credit, \{/.test(svc) && /const applied = decision\.applied/.test(svc))
check(4, 'optimistic concurrency: updateMany guards status + usedAmount + usedCount', 'STRUCTURAL', () =>
  /updateMany\(\{[\s\S]{0,400}?usedAmount: usedAmountBefore,[\s\S]{0,80}?usedCount: usedCountBefore/.test(svc) && /marked\.count !== 1/.test(svc))
check(5, 'idempotency: replay of the same key returns the prior row without deducting again', 'STRUCTURAL', () =>
  /findUnique\(\{ where: \{ idempotencyKey: key \} \}\)/.test(svc) && /replayed: true/.test(svc) && /@@unique\(\[idempotencyKey\]\)/.test(schema))
check(6, 'redemption ledger row is written for every redeem (seq + remainderAfter)', 'STRUCTURAL', () =>
  /storeCreditRedemption\.create\(\{/.test(svc) && /remainderAfter,/.test(svc) && /seq: usedCountBefore \+ 1/.test(svc))
// نشست ۱۸۴ · بند ۴-۶ — دیگر بارکد جانشین ساخته نمی‌شود؛ باقی‌مانده روی همان سند می‌ماند.
check(7, 'leftover stays on the SAME credit record; no successor barcode is ever created (rule 4-6)', 'STRUCTURAL', () =>
  !/remainder = await issueStoreCredit\(/.test(svc) && /هیچ بارکد جانشینی/.test(svc))
check(8, 'cart lines for the category/product restriction are read from the DB, not the request', 'STRUCTURAL', () =>
  /export async function linesForInvoice/.test(svc) && /const dbLines = await linesForInvoice\(client, input\.invoiceId\)/.test(svc))
check(9, 'credit is refused on a canceled invoice', 'STRUCTURAL', () =>
  /invoice\.status === SaleStatus\.CANCELED/.test(svc))
check(10, 'rate-limit gate is called OUTSIDE any transaction (SQLite deadlock rule)', 'STRUCTURAL', () =>
  /export async function guardCreditCode/.test(svc) &&
  /assertCreditCodeGateOpen\(\)/.test(svc) && /noteCreditCodeFailure/.test(svc) &&
  /await guardCreditCode\(String\(input\.storeCreditCode\)/.test(sales) &&
  sales.indexOf('await guardCreditCode') < sales.indexOf('return prisma.$transaction', sales.indexOf('async create(')))
// نشست ۱۸۳ — «رمز مدیر» حالا «رمز مدیر یا رمز دوم/سوم همان پنل» است (خواسته‌ی مالک:
// دسترسی فرد مورد اعتماد در نبود مدیر). گیت، دلیل اجباری و ردیف Audit دست‌نخورده‌اند.
check(11, 'every manager operation demands a password gate + a mandatory reason + before/after audit', 'STRUCTURAL', () =>
  /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid, input\.managerPassword, input\.actionTitle\)/.test(svc) &&
  /function requireReason/.test(svc) && /before: JSON\.stringify\(built\.before\)/.test(svc))
check(12, 'amount change is forbidden (not merely limited) on a redeemed credit', 'STRUCTURAL', () =>
  /changeCreditAmount/.test(svc) && /تغییر مبلغش مجاز نیست/.test(svc))
// نشست ۱۶۰ · Y7 · بند ۴-۲۲ (S160-D1): «حذف واقعی اعتبار بی‌مصرف» قاعده‌ی قدیمی بود؛ حالا هر دو حالت soft-delete‌اند
check(13, 'delete = soft delete (void/archive) both when unused and when redeemed; never a physical delete (rule 4-22)', 'STRUCTURAL', () =>
  /const hasUse = redemptions > 0/.test(svc) && /deletedAt: new Date\(\)/.test(svc) && !/storeCredit\.delete\(\{ where: \{ id: row\.id \} \}\)/.test(svc))
check(14, 'status is never set without canCreditTransition', 'STRUCTURAL', () =>
  /canCreditTransition\(String\(credit\.status\), nextStatus\)/.test(svc) && /canCreditTransition\(String\(row\.status\), input\.toStatus\)/.test(svc))
check(15, 'bulk issue assesses code space BEFORE creating anything', 'STRUCTURAL', () =>
  /const space = await assertCodeSpace\(prisma, \{/.test(svc) && svc.indexOf('assertCodeSpace(prisma') < svc.indexOf('storeCreditBatch.create'))
check(16, 'bulk insert is batched (createMany with per-row fallback), not one round-trip per record', 'STRUCTURAL', () =>
  /storeCredit\.createMany\(\{ data: rows \}\)/.test(svc) && /i \+= CHUNK/.test(svc))
check(17, 'bulk reports the REAL created count (batch row is updated after insert)', 'STRUCTURAL', () =>
  /data: \{ count: created, totalAmount: created \* amountEach \}/.test(svc))
check(18, 'audit actions of session 20 are all used by the service', 'STRUCTURAL', () =>
  ['CREDIT_ISSUE_MANUAL','CREDIT_BULK_GENERATE','CREDIT_VOID','CREDIT_SUSPEND','CREDIT_REACTIVATE','CREDIT_EXPIRY_CHANGE',
   'CREDIT_AMOUNT_CHANGE','CREDIT_USES_CHANGE','CREDIT_HOLDER_CHANGE','CREDIT_RESTRICTION_CHANGE','CREDIT_DELETE',
   'CREDIT_ARCHIVE','CREDIT_PRINT','CREDIT_REPRINT','CREDIT_REMINDER_QUEUE','CREDIT_REDEEM_BLOCKED','CREDIT_CODE_SPACE_BLOCKED']
    .every((a) => svc.includes(`AuditAction.${a}`) || printSvc.includes(`AuditAction.${a}`) || settings.includes(`AuditAction.${a}`)))
check(19, 'audit(tx, …) always takes the client first, and TX_OPTIONS is on every interactive transaction', 'STRUCTURAL', () =>
  !/audit\(\{/.test(svc) &&
  (svc.match(/\$transaction\(/g) || []).length === (svc.match(/TX_OPTIONS/g) || []).length - 1)
check(20, 'NotificationSender never touches the network and is swappable', 'STRUCTURAL', () =>
  !/fetch\(|http|axios/.test(notify) && /setNotificationSender/.test(notify) && /live: false/.test(notify))
check(21, 'reminder decision logic is used for real, and nothing is actually sent', 'STRUCTURAL', () =>
  /reminderDecision\(/.test(svc) && /notificationSender\(\)\.send\(/.test(svc) && /هیچ پیامکی ارسال نشد/.test(svc))
check(22, 'credit document prints from DB data, barcode carries the code only (no amount)', 'STRUCTURAL', () =>
  /creditDocDataFor/.test(printSvc) && /barcodePng\(c\.code/.test(printSvc) && !/barcodePng\([^)]*amount/.test(printSvc))
// جلسه ۳۳ — آستانه‌ی «نسخه‌ی مجدد» دیگر در `PrintService` دستی نوشته نمی‌شود؛
// تصمیمش `isCreditReprint` (بخش ۹.۲ `shared/credit.ts`) است و همان‌جا اجرا و تست می‌شود.
check(23, 'reprint stamps «نسخه‌ی مجدد» and never issues a new credit', 'STRUCTURAL', () =>
  /reprint: isCreditReprint\(c\.printCount\)/.test(printSvc) && /نسخه‌ی مجدد/.test(templates) && /markPrinted/.test(svc))
check(24, 'bulk print = ONE multi-page document + a real PDF path', 'STRUCTURAL', () =>
  /creditBatchHtml/.test(templates) && /page-break-after:always/.test(templates) && /printToPDF/.test(printer))
check(25, 'paper size comes from credit settings, print identity from ReceiptTemplate', 'STRUCTURAL', () =>
  /creditPaperSize\(settings\.paper/.test(printSvc) && /settingsService\.receiptTemplate\(\)/.test(printSvc))
check(26, 'every new IPC channel has a handler and vice versa', 'STRUCTURAL', () => {
  const keys = [...ipcShared.matchAll(/^\s{2}(credit[A-Za-z]*|printCredit[A-Za-z]*|storeCredit[A-Za-z]*):\s*'/gm)].map((m) => m[1])
  return keys.length >= 24 && keys.every((k) => ipcMain.includes(`IPC.${k},`))
})
check(27, 'write channels go through withUser (audit user is never empty)', 'STRUCTURAL', () =>
  ['creditIssue','creditBulkIssue','creditVoid','creditSuspend','creditReactivate','creditExpiryChange','creditAmountChange',
   'creditUsesChange','creditHolderChange','creditRestrictionChange','creditDelete','creditMarkPrinted','creditReminderQueue',
   'creditSettingsSet','printCredit','printCreditBatch']
    .every((k) => new RegExp(`IPC\\.${k}, async \\(p\\)`).test(ipcMain)))
check(28, 'settings live on one key with a conservative parser + audit', 'STRUCTURAL', () =>
  /creditSettings\(\): Promise<CreditSettings>/.test(settings) && /saveCreditSettings/.test(settings) && /CREDIT_SETTINGS_UPDATE/.test(settings))
check(29, 'legacy signatures kept: SalesService still compiles against the same exports', 'STRUCTURAL', () =>
  ['issueStoreCredit','redeemStoreCredit','nonCashMethodId','shapeStoreCredit','storeCreditService','generateStoreCreditCode','findRedeemable']
    .every((n) => new RegExp(`export (async function|function|const) ${n}\\b`).test(svc)))
check(30, 'combined payment + idempotency key are passed from the sale path', 'STRUCTURAL', () =>
  /requested: input\.storeCreditAmount == null/.test(sales) && /idempotencyKey:/.test(sales) && /storeCreditAmount\?: number \| null/.test(types))
check(31, 'StoreCreditRow keeps every pre-session-21 field (POS/invoice pages do not break)', 'STRUCTURAL', () =>
  ['id','code','amount','status','statusLabel','issuedAtJalali','expiresAtJalali','expired','daysLeft','customerName',
   'usedInvoiceId','usedReceiptNo','note'].every((f) => new RegExp(`\\n  ${f}[?]?:`).test(types)))
check(32, 'liability (§۱۵) is Σ(amount − usedAmount) on live credits only', 'STRUCTURAL', () =>
  /function liabilityTotal/.test(svc) && /status: \{ in: \[StoreCreditStatus\.ACTIVE, StoreCreditStatus\.PARTIALLY_USED\] \}/.test(svc))
check(33, 'every changed TS file parses', 'REAL', () => {
  for (const f of ['src/main/services/StoreCreditService.ts','src/main/services/NotificationSender.ts','src/main/services/SettingsService.ts',
    'src/main/services/PrintService.ts','src/main/services/SalesService.ts','src/main/print/templates.ts','src/main/print/printer.ts',
    'src/shared/credit.ts','src/shared/types.ts','src/shared/ipc.ts','src/main/ipc/index.ts'])
    execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--check', f], { stdio: 'pipe' })
  return true
})
check(34, 'pure-logic suite of §۲۳ passes (44 real assertions on the rules engine)', 'REAL', () => {
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/credit-logic-session21.ts'], { encoding: 'utf8' })
  return / 0 FAIL/.test(out)
})

console.log(results.join('\n'))
console.log(`\nSession 21: ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
