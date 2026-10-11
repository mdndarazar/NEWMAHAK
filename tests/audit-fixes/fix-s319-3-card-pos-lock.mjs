/*
 * نشست ۳۱۹ · فاز ۳ — قفل کارت‌خوان در برگشت و تعویض کالا
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s319-3-card-pos-lock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s319-3-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = process.env.HARNESS_BIGINT ?? '1'

let pass = 0
let fail = 0
const check = (label, actual) => {
  if (actual) { pass++; console.log(`  ✓ ${label}`) } else { fail++; console.log(`  ✗ ${label}`) }
}
const eq = (label, got, want) => check(label, JSON.stringify(got) === JSON.stringify(want))
const errOf = async (fn) => {
  try { await fn(); return null } catch (e) { return String(e?.message ?? e) }
}

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')

const db = harnessClient()
const seed = makeSeeder(db)

const userId = seed.user('صندوق‌دار ۳')
const p1 = seed.product('کاپشن تست ۳')
const v1 = seed.insert('ProductVariant', { productId: p1, code: 'V03', barcode: 'B03', salePrice: 1_000_000, size: 'L', stock: 50, isActive: 1 })
const custId = seed.customer('مشتری ۳')
const methCashId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1 })

await shiftService.openSession({ staffId: userId, name: 'شیفت ۳' })

const invoice = await salesService.create({
  userId,
  customerId: custId,
  orderType: 'INTERNAL',
  lines: [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: methCashId, amount: 1_000_000, destination: 'CASH' }]
})

// ---------------------------------------------------------------------------
// ۱) برگشت با روش CARD بدون cardPosOverride ⇒ خطا
// ---------------------------------------------------------------------------
const errNoOverride = await errOf(() =>
  salesService.createReturn({
    invoiceId: invoice.id,
    full: true,
    refundMethod: 'CARD',
    userId
  })
)
check('برگشت CARD بدون override رد می‌شود', /قفل است/.test(errNoOverride ?? ''))

// ---------------------------------------------------------------------------
// ۲) برگشت با روش CARD با رمز اشتباه ⇒ خطا
// ---------------------------------------------------------------------------
const errWrongPw = await errOf(() =>
  salesService.createReturn({
    invoiceId: invoice.id,
    full: true,
    refundMethod: 'CARD',
    cardPosOverride: {
      managerPassword: 'wrong-password',
      reason: 'تست بازپرداخت پوز',
      acknowledgedNoReverse: true
    },
    userId
  })
)
check('برگشت CARD با رمز اشتباه رد می‌شود', errWrongPw != null && !/قفل است/.test(errWrongPw))

// ---------------------------------------------------------------------------
// ۳) برگشت با روش CARD با override معتبر ⇒ موفق
// ---------------------------------------------------------------------------
const resValid = await salesService.createReturn({
  invoiceId: invoice.id,
  full: true,
  refundMethod: 'CARD',
  cardPosOverride: {
    managerPassword: DEFAULT_MANAGER_PASSWORD,
    reason: 'تایید بازپرداخت پوز توسط مدیر',
    acknowledgedNoReverse: true
  },
  userId
})
check('برگشت CARD با override معتبر ثبت شد', resValid?.receiptNo === invoice.receiptNo)

console.log(`\nنتیجه: ${pass} قبول، ${fail} رد`)
if (fail > 0) process.exit(1)
