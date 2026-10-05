import assert from 'node:assert/strict'
import {
  calculateInvoiceTotals, calculateReturnTotals, calculateCashClose,
  calculateAccrualStatement, calculateReconciliationBridge
} from '../src/shared/accounting.ts'

const base = calculateInvoiceTotals({
  lines: [{ qty: 1, unitPrice: 10_000_000, discount: 500_000, tax: 700_000 }],
  serviceCharge: 200_000, deliveryFee: 105_000
})
assert.equal(base.grandTotal, 10_505_000)
assert.equal(base.grandTotal - 4_000_000, 6_505_000)

const positiveExchange = calculateReturnTotals([{
  kind: 'EXCHANGE', total: 1_000_000, exchangeTotal: 3_000_000, exchangeDiff: 2_000_000
}])
assert.equal(positiveExchange.exchangeReturned, 1_000_000)
assert.equal(positiveExchange.exchangeDiffReceived, 2_000_000)

const cashExchange = calculateReturnTotals([{
  kind: 'EXCHANGE', total: 3_000_000, exchangeTotal: 1_000_000, exchangeDiff: -2_000_000,
  exchangeSettlement: 'CASH'
}])
assert.equal(cashExchange.exchangeCashRefunds, 2_000_000)
assert.equal(cashExchange.exchangeStoreCreditIssued, 0)

const creditExchange = calculateReturnTotals([{
  kind: 'EXCHANGE', total: 3_000_000, exchangeTotal: 1_000_000, exchangeDiff: -2_000_000,
  exchangeSettlement: 'CREDIT'
}])
assert.equal(creditExchange.exchangeStoreCreditIssued, 2_000_000)

const close = calculateCashClose({
  openingFloat: 1_000_000, cashReceived: 5_000_000, cashReturnRefunds: 500_000,
  withdrawals: 1_000_000, deposits: 200_000, countedCash: 4_700_000
})
assert.equal(close.expectedCash, 4_700_000)
assert.equal(close.cashDifference, 0)

const accrual = calculateAccrualStatement({
  invoices: [{ goodsTotal: 40_000_000 }],
  exchangeReturned: 2_000_000
})
assert.equal(accrual.netAccrualSales, 38_000_000)

const bridge = calculateReconciliationBridge({
  realCash: 40_000_000, storeCreditIssued: 2_000_000, netAccrualSales: 38_000_000
})
assert.equal(bridge.unexplained, 0)
assert.equal(bridge.balanced, true)

console.log('session 13 accounting acceptance tests: PASS')
