// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const reports = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const modal = readFileSync('src/renderer/src/components/CreditSettlementModal.tsx', 'utf8')
assert.match(reports, /setCreditSettlementFor\(invoiceId\)/)
assert.match(reports, /<CreditSettlementModal open=\{creditSettlementFor != null\}/)
assert.match(modal, /CH\.saleCreditSettlementLineage/)
assert.match(modal, /CreditSettlementLineageView/)
assert.match(modal, /view\.rows\.map/)
assert.doesNotMatch(modal, /(?:row|view)\.(?:code|legacyCode|storeCreditCode)\b|row\.credit\.(?:code|legacyCode)\b|salePayment(Add|Update|Delete)|PaymentForm|creditManagerCodeReveal/)
assert.match(modal, /کد قابل‌مصرف، کد تاریخی، اطلاعات دارنده و یادداشت‌های خصوصی/)
console.log('✓ کلیک اعتبار به زنجیرهٔ فقط‌خواندنی و redacted می‌رود؛ فرم پرداخت عمومی دست‌نخورده است.')
