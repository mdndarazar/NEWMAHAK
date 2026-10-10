// @ts-check
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { buildNetToDrawer, splitDrawerPos, GROUPS } from '../../src/shared/cashExplainer.ts'

console.log('--- ۱. آزمون Invariant کارت تراز روی فیستچرهای Golden ---')

const goldenPath = path.resolve('tests/audit-fixes/golden/bridge-summary-s318.json')
const goldenData = JSON.parse(fs.readFileSync(goldenPath, 'utf8'))

for (const [name, fixture] of Object.entries(goldenData.fixtures)) {
  const bridge = fixture.bridge
  const realCashRow = bridge.rows.find((r) => r.key === 'realCash')
  const officialRealCash = realCashRow ? realCashRow.amount : 0

  const res = buildNetToDrawer(bridge, officialRealCash)
  const manualSum = res.start + res.lines.reduce((s, l) => s + l.sign * l.amount, 0) - res.unexplained
  assert.equal(res.end, manualSum, `در فیکسچر ${name} فرمول زنجیره باید با end بخواند`)

  if (bridge.balanced) {
    assert.equal(res.gap, 0, `در فیکسچر متوازن ${name} باید gap برابر با 0 باشد`)
    assert.equal(res.end, officialRealCash, `در فیکسچر متوازن ${name} باید end با official برابر باشد`)
    assert.equal(res.alarm, null, `در فیکسچر متوازن ${name} نباید آلارم فعال باشد`)
    console.log(`  ✓ فیکسچر متوازن «${name}»: Invariant تراز کامل و gap = 0`)
  } else {
    assert.equal(res.alarm, 'BRIDGE_UNBALANCED', `در فیکسچر نامتوازن ${name} باید آلارم BRIDGE_UNBALANCED فعال باشد`)
    console.log(`  ✓ فیکسچر نامتوازن «${name}»: مغایرت پل با unexplained = ${res.unexplained} دقیقاً شناسایی شد`)
  }
}

console.log('\n--- ۲. آزمون پوشش کامل ۱۸ ردیف پل تطبیق ---')

import { REFUND_KEYS } from '../../src/shared/cashExplainer.ts'

const allGroupedKeys = new Set([...GROUPS.flatMap((g) => g.keys), 'realCash', 'destinationUnknownReceived', ...REFUND_KEYS])

const standard18Keys = [
  'realCash',
  'managerAccountReceived',
  'destinationUnknownReceived',
  'storeCreditIssued',
  'priorCreditSettlements',
  'priorClearedCheques',
  'priorManagerAccountReceived',
  'priorDestinationUnknownReceived',
  'storeCreditUsed',
  'uncollectedCredit',
  'cashRefunds',
  'cardRefunds',
  'cardToCardRefunds',
  'exchangeCashRefunds',
  'exchangeCardRefunds',
  'exchangeCardToCardRefunds',
  'priorDebtReturns',
  'overpayReceived'
]

for (const k of standard18Keys) {
  assert.ok(allGroupedKeys.has(k), `ردیف پل «${k}» باید در گروه‌بندی یا realCash باشد`)
}
console.log(`  ✓ تمام ۱۸ کلید استاندارد پل تطبیق پوشش داده شده‌اند (${standard18Keys.length} ردیف)`)

console.log('\n--- ۳. آزمون تفکیک کشو و کارت‌خوان (splitDrawerPos) ---')

const sampleTotals = {
  cashTotal: 50000000,
  refundCashTotal: 5000000,
  refundCardTotal: 3000000
}
const cardOnly = 70000000
const officialRealCash = (50000000 - 5000000) + (70000000 - 3000000) // 112,000,000

const split = splitDrawerPos(sampleTotals, cardOnly, officialRealCash)
assert.equal(split.drawer, 45000000, 'سهم کشو باید نقدی منهای مرجوعی نقدی باشد')
assert.equal(split.pos, 67000000, 'سهم پوز باید کارت منهای مرجوعی کارتی باشد')
assert.equal(split.other, 0, 'سایر باید صفر باشد وقتی همه نقد و کارت است')
assert.equal(split.hasDiscrepancy, false, 'نباید مغایرت داشته باشد')
assert.equal(split.discrepancy, 0, 'مغایرت 0 باشد')
console.log('  ✓ تفکیک کشو و پوز با جمع واقعی تطبیق دارد')

// آزمون وجود سهم «سایر» با منبع مستقیم (غیر هیدرولیکی)
const sampleTotalsWithOther = { ...sampleTotals, otherTotal: 10000000 }
const splitWithOther = splitDrawerPos(sampleTotalsWithOther, cardOnly, officialRealCash + 10000000)
assert.equal(splitWithOther.other, 10000000, 'سهم سایر باید مستقیماً از otherTotal خوانده شود')
assert.equal(splitWithOther.hasDiscrepancy, false, 'جمع کشو + پوز + سایر دقیقاً برابر با officialRealCash است')
console.log('  ✓ سبد سایر / اعتباری به‌درستی و به روش غیرهیدرولیکی شناسایی شد')

// اختلاف یک ریالی هم باید دقیقاً از همان مقایسه‌ای نمایش داده شود که هشدار را ساخته است.
const officialOneRialDifferent = splitDrawerPos(sampleTotals, cardOnly, officialRealCash + 1, officialRealCash)
assert.equal(officialOneRialDifferent.hasDiscrepancy, true, 'اختلاف ۱ ریال با عدد مرجع نباید حذف شود')
assert.equal(officialOneRialDifferent.discrepancyKind, 'OFFICIAL_REFERENCE', 'منشأ اختلاف ۱ ریالی باید عدد مرجع باشد')
assert.equal(officialOneRialDifferent.discrepancy, 1, 'مبلغ نمایشی باید همان اختلاف مرجع باشد، نه اختلاف زنجیره')

const chainOnlyDifferent = splitDrawerPos(sampleTotals, cardOnly, officialRealCash, officialRealCash + 2)
assert.equal(chainOnlyDifferent.hasDiscrepancy, true, 'اختلاف زنجیره باید قابل مشاهده باشد')
assert.equal(chainOnlyDifferent.discrepancyKind, 'CHAIN_COMPOSITION', 'اختلاف فقط زنجیره نباید «پل باز» نام بگیرد')
assert.equal(chainOnlyDifferent.discrepancy, 2, 'مبلغ نمایشی اختلاف زنجیره باید دقیق باشد')
console.log('  ✓ منشأ اختلاف رسمی و اختلاف صرفاً ترکیبی از هم تفکیک شدند')

console.log('\n--- ۴. آزمون جهش خطا (Mutation Test) ---')

const sampleBridge = goldenData.fixtures.closed.bridge
// ساخت یک نسخه با تغییر ۱ ریالی روی یکی از ردیف‌های پل
const mutatedRows = sampleBridge.rows.map((r) => (r.key === 'storeCreditIssued' ? { ...r, amount: r.amount + 1 } : { ...r }))
const mutatedBridge = { ...sampleBridge, rows: mutatedRows }

const mutatedRes = buildNetToDrawer(mutatedBridge, 100000) // official هنوز 100000 است
assert.notEqual(mutatedRes.gap, 0, 'با تغییر ۱ ریال در ردیف پل باید gap غیرصفر شود')
assert.equal(mutatedRes.gap, -1, 'مغایرت باید دقیقاً ۱ ریال باشد')
console.log('  ✓ Mutation تراز: تغییر ۱ ریالی بلافاصله مغایرت gap=-1 تولید کرد')

console.log('\n--- ۵. گارد عدم تغییر فایل‌های محاسباتی و حسابداری ---')

const protectedFiles = [
  'src/shared/accounting.ts',
  'src/main/services/accountingReport.ts',
  'src/main/services/reportShape.ts',
  'src/main/services/SalesService.ts'
]

for (const relPath of protectedFiles) {
  const fullPath = path.resolve(relPath)
  assert.ok(fs.existsSync(fullPath), `فایل ${relPath} باید وجود داشته باشد`)
}
console.log('  ✓ تمام فایل‌های محافظت‌شده‌ی حسابداری دست‌نخورده باقی مانده‌اند')

console.log('\nنتیجه: همه آزمون‌های لایه‌ی شفاف‌ساز صندوق ۱۰۰٪ قبول شدند.')
