// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const reports = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const modal = readFileSync('src/renderer/src/components/CreditSettlementModal.tsx', 'utf8')
assert.match(reports, /setCreditSettlementFor\(invoiceId\)/)
assert.match(reports, /<CreditSettlementModal open=\{creditSettlementFor != null\}/)
assert.match(modal, /CH\.salePayments/)
assert.match(modal, /filter\(\(payment\) => payment\.isStoreCredit\)/)
assert.doesNotMatch(modal, /salePayment(Add|Update|Delete)|PaymentForm|creditManagerCodeReveal/)
assert.match(modal, /کد قابل‌مصرف اعتبار در گزارش و این پنجره نمایش داده نمی‌شود/)
console.log('✓ کلیک اعتبار به نمای فقط‌خواندنی و redacted می‌رود؛ فرم پرداخت عمومی دست‌نخورده است.')
