/*
 * نشست ۳۱۹ · فاز ۲ — ماتریس تصمیم هوشمند و هدایت تسویه (shared خالص)
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s319-2-guidance-matrix.mjs
 */
import { readFileSync } from 'node:fs'
import { guideReturn, guideExchange } from '../../src/shared/returnGuidance.ts'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want))

// ---------------------------------------------------------------------------
// الف) گارد ایستا (انضباط F7): بدون reduce عددی یا ضرب روی مبالغ
// ---------------------------------------------------------------------------
const src = readFileSync('src/shared/returnGuidance.ts', 'utf8')
check('بدون reduce حسابی', !/\.reduce\s*\(/.test(src))
check('بدون ضرب روی مبلغ', !/[a-zA-Z0-9_]+\s*\*\s*[a-zA-Z0-9_]+/.test(src))
check('بدون import از دیتابیس یا پریزما', !/prisma|db|sqlite/i.test(src))

// ---------------------------------------------------------------------------
// ب) سناریوی CREDIT_ONLY: نسیه کامل
// ---------------------------------------------------------------------------
const gCredit = guideReturn({
  profile: {
    kind: 'CREDIT_ONLY',
    cashLikeReceived: 0,
    cashLikeRefundableNow: 0,
    remainingDebt: 1_000_000,
    creditRedemptions: [],
    isExchangeDoc: false,
    sourceReceiptNo: null
  },
  isFullReturn: true
})
eq('CREDIT_ONLY: پیشنهاد NONE است', gCredit.recommended, 'NONE')
eq('CREDIT_ONLY: گزینه NONE دارای state RECOMMENDED است', gCredit.methods.NONE.state, 'RECOMMENDED')
eq('CREDIT_ONLY: گزینه CASH دارای state MANAGER_ONLY است', gCredit.methods.CASH.state, 'MANAGER_ONLY')
eq('CREDIT_ONLY: گزینه CARD دارای state MANAGER_ONLY است', gCredit.methods.CARD.state, 'MANAGER_ONLY')
eq('CREDIT_ONLY: گزینه STORE_CREDIT دارای state BLOCKED است', gCredit.methods.STORE_CREDIT.state, 'BLOCKED')
eq('CREDIT_ONLY: گزینه CARD_TO_CARD دارای state BLOCKED است', gCredit.methods.CARD_TO_CARD.state, 'BLOCKED')
check('CREDIT_ONLY: اعلان CREDIT_INVOICE_DEBT_ONLY دارد', gCredit.notices.some((n) => n.code === 'CREDIT_INVOICE_DEBT_ONLY'))

// ---------------------------------------------------------------------------
// ج) سناریوی PAID_CASHLIKE: نقدی کامل
// ---------------------------------------------------------------------------
const gCash = guideReturn({
  profile: {
    kind: 'PAID_CASHLIKE',
    cashLikeReceived: 1_000_000,
    cashLikeRefundableNow: 1_000_000,
    remainingDebt: 0,
    creditRedemptions: [],
    isExchangeDoc: false,
    sourceReceiptNo: null
  },
  isFullReturn: true
})
eq('PAID_CASHLIKE: پیشنهاد CARD_TO_CARD است', gCash.recommended, 'CARD_TO_CARD')
eq('PAID_CASHLIKE: گزینه CARD_TO_CARD دارای state RECOMMENDED است', gCash.methods.CARD_TO_CARD.state, 'RECOMMENDED')
eq('PAID_CASHLIKE: گزینه CASH دارای state ALLOWED است', gCash.methods.CASH.state, 'ALLOWED')
eq('PAID_CASHLIKE: گزینه CARD دارای state MANAGER_ONLY است', gCash.methods.CARD.state, 'MANAGER_ONLY')
eq('PAID_CASHLIKE: گزینه STORE_CREDIT دارای state ALLOWED است', gCash.methods.STORE_CREDIT.state, 'ALLOWED')
check('PAID_CASHLIKE: اعلان POS_CANNOT_REVERSE دارد', gCash.notices.some((n) => n.code === 'POS_CANNOT_REVERSE'))

// ---------------------------------------------------------------------------
// د) سناریوی STORE_CREDIT_FUNDED: برگشت کامل در برابر جزئی
// ---------------------------------------------------------------------------
const gCreditFull = guideReturn({
  profile: {
    kind: 'STORE_CREDIT_FUNDED',
    cashLikeReceived: 500_000,
    cashLikeRefundableNow: 500_000,
    remainingDebt: 0,
    creditRedemptions: [{ creditId: 1, code: '****-1234', amount: 500_000, creditStatus: 'USED' }],
    isExchangeDoc: false,
    sourceReceiptNo: null
  },
  isFullReturn: true
})
check('STORE_CREDIT برگشت کامل: اعلان CREDIT_REACTIVATES_FULL دارد', gCreditFull.notices.some((n) => n.code === 'CREDIT_REACTIVATES_FULL'))

const gCreditPartial = guideReturn({
  profile: {
    kind: 'STORE_CREDIT_FUNDED',
    cashLikeReceived: 500_000,
    cashLikeRefundableNow: 500_000,
    remainingDebt: 0,
    creditRedemptions: [{ creditId: 1, code: '****-1234', amount: 500_000, creditStatus: 'USED' }],
    isExchangeDoc: false,
    sourceReceiptNo: null
  },
  isFullReturn: false
})
check('STORE_CREDIT برگشت جزئی: اعلان CREDIT_NOT_REACTIVATED_PARTIAL دارد', gCreditPartial.notices.some((n) => n.code === 'CREDIT_NOT_REACTIVATED_PARTIAL'))

// ---------------------------------------------------------------------------
// ه) تعویض کالا (guideExchange)
// ---------------------------------------------------------------------------
const exZero = guideExchange({ diff: 0 })
eq('تعویض صفر: step = DIFF_ZERO', exZero.step, 'DIFF_ZERO')

const exPos = guideExchange({ diff: 200_000 })
eq('تعویض مثبت: step = CUSTOMER_PAYS', exPos.step, 'CUSTOMER_PAYS')

const exNegCash = guideExchange({
  profile: { kind: 'PAID_CASHLIKE', cashLikeReceived: 1_000_000, cashLikeRefundableNow: 1_000_000, remainingDebt: 0, creditRedemptions: [], isExchangeDoc: false, sourceReceiptNo: null },
  diff: -200_000
})
eq('تعویض منفی نقدی: step = WE_OWE', exNegCash.step, 'WE_OWE')
if (exNegCash.step === 'WE_OWE') {
  eq('تعویض منفی نقدی: پیشنهاد CARD_TO_CARD است', exNegCash.recommended, 'CARD_TO_CARD')
  eq('تعویض منفی نقدی: CARD دارای MANAGER_ONLY است', exNegCash.options.CARD.state, 'MANAGER_ONLY')
}

const exNegCredit = guideExchange({
  profile: { kind: 'CREDIT_ONLY', cashLikeReceived: 0, cashLikeRefundableNow: 0, remainingDebt: 1_000_000, creditRedemptions: [], isExchangeDoc: false, sourceReceiptNo: null },
  diff: -200_000
})
if (exNegCredit.step === 'WE_OWE') {
  eq('تعویض منفی نسیه: پیشنهاد DEBT_CUT است', exNegCredit.recommended, 'DEBT_CUT')
  eq('تعویض منفی نسیه: CASH دارای BLOCKED است', exNegCredit.options.CASH.state, 'BLOCKED')
}

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
