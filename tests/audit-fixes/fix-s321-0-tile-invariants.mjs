// @ts-check
import assert from 'node:assert/strict'
import { calculateReconciliationBridge, physicalMoneyInDrawerAndCard } from '../../src/shared/accounting.ts'
import { buildNetToDrawer, splitDrawerPos, GROUPS_V2 } from '../../src/shared/cashExplainer.ts'

console.log('--- آزمون جامع و Fuzzing تراز ریاضی و تفکیک کاشی‌ها (۵۰۰۰ سناریو) ---')

let seed = 42
const rnd = (m) => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31
  return Math.floor((seed / 2 ** 31) * m) * 1000
}

const N = 5000
let passedCount = 0

for (let i = 0; i < N; i++) {
  const p = {
    cash: rnd(5000),
    card: rnd(5000),
    other: rnd(300),
    unknown: rnd(800),
    mgr: rnd(800),
    cqCash: 0,
    cqCard: 0
  }
  const priorUnknown = Math.min(p.unknown, rnd(300))
  const priorMgr = Math.min(p.mgr, rnd(300))
  const ref = {
    cashRefunds: rnd(400),
    cardRefunds: rnd(400),
    cardToCardRefunds: rnd(200),
    exchangeCashRefunds: rnd(200),
    exchangeCardRefunds: rnd(200),
    exchangeCardToCardRefunds: rnd(100)
  }
  const misc = {
    storeCreditIssued: rnd(300),
    storeCreditUsed: rnd(300),
    uncollectedCredit: rnd(900),
    priorCreditSettlements: rnd(300),
    overpayReceived: rnd(100)
  }

  const inp = {
    realCash: p.cash + p.card + p.other + p.cqCash + p.cqCard,
    managerAccountReceived: p.mgr,
    destinationUnknownReceived: p.unknown,
    priorDestinationUnknownReceived: priorUnknown,
    priorManagerAccountReceived: priorMgr,
    ...ref,
    ...misc
  }

  const b0 = calculateReconciliationBridge(inp)
  const isBroken = i % 10 === 0
  const brokenAmount = isBroken ? rnd(50) + 1000 : 0
  const b = calculateReconciliationBridge({
    ...inp,
    netAccrualSales: b0.explainedTotal + brokenAmount
  })
  const bridge = { ...b, rows: b.rows.map((r) => ({ ...r, hint: '', sources: [] })) }

  const T = {
    cashTotal: p.cash,
    cardTotal: p.card,
    otherTotal: p.other,
    creditTotal: 0,
    destinationUnknownTotal: p.unknown,
    managerAccountTotal: p.mgr,
    refundCashTotal: ref.cashRefunds + ref.exchangeCashRefunds,
    refundCardTotal: ref.cardRefunds + ref.exchangeCardRefunds
  }

  const official = physicalMoneyInDrawerAndCard({
    receivedTotal: p.cash + p.card + p.other + p.unknown,
    refundCashTotal: T.refundCashTotal,
    refundCardTotal: T.refundCardTotal
  })

  const v2 = buildNetToDrawer(bridge, official)

  if (b.balanced) {
    assert.equal(v2.gap, 0, `در پل تراز باید gap صفر باشد (i=${i})`)
    assert.equal(v2.alarm, null, `در پل تراز نباید آژیر روشن شود (i=${i})`)
  } else {
    assert.equal(v2.alarm, 'BRIDGE_UNBALANCED', `در پل نامتوازن باید آژیر BRIDGE_UNBALANCED باشد`)
  }

  const manualSum = v2.start + v2.lines.reduce((s, l) => s + l.sign * l.amount, 0) - v2.unexplained
  assert.equal(v2.end, manualSum, `زنجیره ریاضی باید دقیقا با end بخواند`)

  const s2 = splitDrawerPos(T, p.card, official, v2.end)
  if (b.balanced) {
    assert.equal(s2.hasDiscrepancy, false, `کاشی‌های غیرهیدرولیکی در پل تراز نباید مغایرت بدهند`)
  }

  // تست Mutation: جهش ۱ ریال در سبد سایر ⇒ باید مغایرت کاشی‌ها قرمز شود!
  const s2m = splitDrawerPos({ ...T, otherTotal: T.otherTotal - 1 }, p.card, official, v2.end)
  assert.equal(s2m.hasDiscrepancy, true, `کاهش ۱ ریال باید مغایرت واقعی تولید کند`)

  passedCount++
}

console.log(`  ✓ تمام ${passedCount} سناریوی Fuzzing با ۱۰۰٪ موفقیت و تراز کامل پاس شدند.`)
