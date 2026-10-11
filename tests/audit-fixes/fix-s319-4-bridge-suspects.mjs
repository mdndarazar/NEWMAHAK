/*
 * نشست ۳۱۹ · فاز ۴ — تشخیص پل ۱-کلیکی، شناسنامه سند و تحلیل آموزشی
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s319-4-bridge-suspects.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s319-4-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want))

// ---------------------------------------------------------------------------
// الف) گاردهای ایستا (انضباط F7)
// ---------------------------------------------------------------------------
const suspSrc = readFileSync('src/shared/bridgeSuspects.ts', 'utf8')
check('bridgeSuspects: بدون reduce حسابی', !/\.reduce\s*\(/.test(suspSrc))
check('bridgeSuspects: بدون ضرب روی مبلغ', !/[a-zA-Z0-9_]+\s*\*\s*[a-zA-Z0-9_]+/.test(suspSrc))
check('bridgeSuspects: بدون import از DB', !/prisma|db|sqlite/i.test(suspSrc))

const rootSrc = readFileSync('src/shared/bridgeRootCause.ts', 'utf8')
check('bridgeRootCause: بدون reduce حسابی', !/\.reduce\s*\(/.test(rootSrc))
check('bridgeRootCause: بدون import از DB', !/prisma|db|sqlite/i.test(rootSrc))

// ---------------------------------------------------------------------------
// ب) تست توابع خالص
// ---------------------------------------------------------------------------
const { pickSuspects } = await import('../../src/shared/bridgeSuspects.ts')
const { explainRootCause } = await import('../../src/shared/bridgeRootCause.ts')

const suspectsEmpty = pickSuspects([], { unexplained: 0, balanced: true })
eq('پل بسته: suspects خالی است', suspectsEmpty.length, 0)

const suspectsFound = pickSuspects(
  [
    { key: 'realCash', label: 'وجه واقعی', amount: 20_000_000, sign: 1, flags: [{ code: 'largest', text: '', certainty: 'TENTATIVE' }] },
    { key: 'cardRefunds', label: 'بازپرداخت کارتی', amount: 10_000_000, sign: -1, flags: [{ code: 'equals-unexplained', text: '', certainty: 'TENTATIVE' }] }
  ],
  { unexplained: 10_000_000, balanced: false }
)
check('مظنون هم‌مبلغ پیدا شد', suspectsFound.length > 0)
eq('مظنون رتبه ۱: cardRefunds', suspectsFound[0].rowKey, 'cardRefunds')
check('دلیل هم‌مبلغ ثبت شد', suspectsFound[0].reasons.includes('ROW_EQUALS_UNEXPLAINED'))

const causeCard = explainRootCause(
  {
    ref: { kind: 'RETURN', id: 1 },
    docType: 'SIMPLE_RETURN',
    docNo: '1',
    parent: { invoiceId: 10, receiptNo: 10, dateJalali: '1405/07/16', settlementKind: 'PAID_CASHLIKE' },
    at: { dateJalali: '1405/07/16', time: '10:00:00' },
    actor: { userId: 1, name: 'صندوق‌دار' },
    shift: { id: 1, name: 'صبح' },
    customer: { id: 1, name: 'مشتری' },
    items: [],
    settlement: { method: 'CARD', methodLabel: 'بازپرداخت کارتی', amount: 10_000_000, reference: null },
    voided: false
  },
  {
    rowKey: 'cardRefunds',
    reasons: ['ROW_EQUALS_UNEXPLAINED'],
    period: { fromJalali: '1405/07/16', toJalali: '1405/07/16' }
  }
)
eq('قاعده پوز: R-POS-CARD-REFUND', causeCard.ruleId, 'R-POS-CARD-REFUND')
check('درس پوز: کارت‌به‌کارت', /کارت‌به‌کارت/.test(causeCard.lesson))

// ---------------------------------------------------------------------------
// ج) تست یکپارچگی سرویس و documentDetail
// ---------------------------------------------------------------------------
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { bridgeDiagnosticsService } = await import('../../src/main/services/bridgeDiagnosticsService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')

const db = harnessClient()
const seed = makeSeeder(db)

const userId = seed.user('صندوق‌دار ۴')
const p1 = seed.product('کاپشن تست ۴')
const v1 = seed.insert('ProductVariant', { productId: p1, code: 'V04', barcode: 'B04', salePrice: 1_000_000, size: 'L', stock: 50, isActive: 1 })
const custId = seed.customer('مشتری ۴')
const methCashId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1 })

await shiftService.openSession({ staffId: userId, name: 'شیفت ۴' })

const inv = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: methCashId, amount: 1_000_000, destination: 'CASH' }]
})

const ret = await salesService.createReturn({
  invoiceId: inv.id,
  full: true,
  refundMethod: 'CASH',
  userId
})

const scope = { fromJalali: '1405/01/01', toJalali: '1405/12/29' }
const opened = await bridgeDiagnosticsService.open(scope, DEFAULT_MANAGER_PASSWORD)
check('open سرویس موفق است', opened?.ok === true)

const docRes = await bridgeDiagnosticsService.documentDetail(scope, { kind: 'RETURN', id: ret.id }, 'cashRefunds')
check('documentDetail موفق است', docRes?.ok === true)
eq('docNo برابر id برگشت است', docRes?.detail?.docNo, String(ret.id))
eq('مبلغ سند برابر ۱,۰۰۰,۰۰۰ است', docRes?.detail?.settlement?.amount, 1_000_000)
check('rootCause دارد', docRes?.rootCause != null)

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
