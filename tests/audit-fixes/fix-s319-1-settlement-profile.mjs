/*
 * نشست ۳۱۹ · فاز ۱ — پروفایل تسویه‌ی فاکتور مرجع (سرور، فقط‌خواندنی)
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s319-1-settlement-profile.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s319-1-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want))

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')

const db = harnessClient()
const seed = makeSeeder(db)

const userId = seed.user('صندوق‌دار ۱')
const p1 = seed.product('کاپشن چرم')
const v1 = seed.insert('ProductVariant', { productId: p1, code: 'V01', barcode: 'B01', salePrice: 1_000_000, size: 'L', stock: 50, isActive: 1 })
const custId = seed.customer('مشتری آزمایشی')
const methCashId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1 })
const methCardId = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارت‌خوان', kind: 'CARD', isActive: 1 })

await shiftService.openSession({ staffId: userId, name: 'شیفت تست' })

// ---------------------------------------------------------------------------
// ۱) فاکتور ۱: نسیه کامل (CREDIT_ONLY)
// ---------------------------------------------------------------------------
const invCredit = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: []
})
const lookCredit = await salesService.findByReturnCode(String(invCredit.receiptNo))
eq('فاکتور نسیه: kind = CREDIT_ONLY', lookCredit.settlementProfile?.kind, 'CREDIT_ONLY')
eq('فاکتور نسیه: cashLikeReceived = 0', lookCredit.settlementProfile?.cashLikeReceived, 0)
eq('فاکتور نسیه: cashLikeRefundableNow = 0', lookCredit.settlementProfile?.cashLikeRefundableNow, 0)
eq('فاکتور نسیه: remainingDebt = 1,000,000', lookCredit.settlementProfile?.remainingDebt, 1_000_000)
eq('فاکتور نسیه: creditRedemptions خالی است', lookCredit.settlementProfile?.creditRedemptions?.length, 0)
eq('فاکتور نسیه: isExchangeDoc = false', lookCredit.settlementProfile?.isExchangeDoc, false)

// ---------------------------------------------------------------------------
// ۲) فاکتور ۲: نقدی کامل (PAID_CASHLIKE)
// ---------------------------------------------------------------------------
const invCash = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: methCashId, amount: 1_000_000, destination: 'CASH' }]
})
const lookCash = await salesService.findByReturnCode(String(invCash.receiptNo))
eq('فاکتور نقدی: kind = PAID_CASHLIKE', lookCash.settlementProfile?.kind, 'PAID_CASHLIKE')
eq('فاکتور نقدی: cashLikeReceived = 1,000,000', lookCash.settlementProfile?.cashLikeReceived, 1_000_000)
eq('فاکتور نقدی: cashLikeRefundableNow = 1,000,000', lookCash.settlementProfile?.cashLikeRefundableNow, 1_000_000)
eq('فاکتور نقدی: remainingDebt = 0', lookCash.settlementProfile?.remainingDebt, 0)

// ---------------------------------------------------------------------------
// ۳) فاکتور ۳: ترکیبی نقد و نسیه (MIXED)
// ---------------------------------------------------------------------------
const invMixed = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: methCashId, amount: 400_000, destination: 'CASH' }]
})
const lookMixed = await salesService.findByReturnCode(String(invMixed.receiptNo))
eq('فاکتور ترکیبی: kind = MIXED', lookMixed.settlementProfile?.kind, 'MIXED')
eq('فاکتور ترکیبی: cashLikeReceived = 400,000', lookMixed.settlementProfile?.cashLikeReceived, 400_000)
eq('فاکتور ترکیبی: cashLikeRefundableNow = 400,000', lookMixed.settlementProfile?.cashLikeRefundableNow, 400_000)
eq('فاکتور ترکیبی: remainingDebt = 600,000', lookMixed.settlementProfile?.remainingDebt, 600_000)

// ---------------------------------------------------------------------------
// ۴) فاکتور ۴: مصرف اعتبار خرید (STORE_CREDIT_FUNDED)
// ---------------------------------------------------------------------------
const creditId = seed.insert('StoreCredit', {
  code: 'CR12345678',
  amount: 500_000,
  status: 'ACTIVE',
  customerId: custId,
  customerName: 'مشتری آزمایشی'
})
const invCreditFunded = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  storeCreditCode: 'CR12345678',
  payments: [{ methodId: methCardId, amount: 500_000, destination: 'CARD' }]
})
const lookCreditFunded = await salesService.findByReturnCode(String(invCreditFunded.receiptNo))
eq('فاکتور با اعتبار: kind = STORE_CREDIT_FUNDED', lookCreditFunded.settlementProfile?.kind, 'STORE_CREDIT_FUNDED')
eq('فاکتور با اعتبار: cashLikeReceived = 500,000 (سهم نقدی/کارتی)', lookCreditFunded.settlementProfile?.cashLikeReceived, 500_000)
eq('فاکتور با اعتبار: cashLikeRefundableNow = 500,000', lookCreditFunded.settlementProfile?.cashLikeRefundableNow, 500_000)
check('فاکتور با اعتبار: creditRedemptions دارد', (lookCreditFunded.settlementProfile?.creditRedemptions?.length ?? 0) >= 1)
check('فاکتور با اعتبار: کد ماسک شده است', /^(\*{4}|\*{4}-)/.test(lookCreditFunded.settlementProfile?.creditRedemptions?.[0]?.code ?? ''))

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
