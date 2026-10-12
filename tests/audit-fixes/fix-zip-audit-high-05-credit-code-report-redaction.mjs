/**
 * ZIP-AUDIT-HIGH-05
 *
 * A store-credit code is a bearer credential. SalesLedger and FraudService are
 * report read models, not the manager-only reveal path, so neither may place a
 * real StoreCredit/StoreCreditRedemption code into a label or note returned to
 * the renderer/export pipeline.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-05-credit-code-report-redaction.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-05-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const code = 'SECRET-ZIP-HIGH-05-ONLY'
const today = jalaliToday()
const started = jalaliStartOfDay(today).getTime()
const userId = seed.user('صادرکننده اعتبار')
const shiftId = seed.insert('Shift', { name: 'نشست اعتبار', number: 1, dayJalali: today, openedAt: started, userId })
const methodId = seed.insert('PaymentMethod', { key: 'STORE_CREDIT', label: 'اعتبار', kind: 'STORE_CREDIT', isActive: 1 })
const invoiceId = seed.insert('SaleInvoice', {
  receiptNo: 505,
  status: 'SETTLED',
  grandTotal: 1_000,
  paidTotal: 1_000,
  goodsTotal: 1_000,
  issuedAt: started + 1_000,
  issuedAtJalali: today,
  userId,
  shiftId
})
const creditId = seed.insert('StoreCredit', {
  code,
  amount: 1_000,
  sourceInvoiceId: invoiceId,
  userId,
  status: 'ACTIVE',
  issuedAt: started + 2_000,
  issuedAtJalali: today
})
const paymentId = seed.insert('Payment', {
  invoiceId,
  methodId,
  amount: 1_000,
  kind: 'CASH',
  seq: 1,
  paidAt: started + 3_000,
  paidAtJalali: today
})
seed.insert('StoreCreditRedemption', {
  creditId,
  code,
  amount: 1_000,
  remainderAfter: 0,
  seq: 1,
  invoiceId,
  receiptNo: 505,
  paymentId,
  at: started + 3_000,
  atJalali: today,
  userId,
  shiftId
})

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`)
  }
}
const containsCredential = (value) => JSON.stringify(value).includes(code)

console.log('۱) دفتر رویداد، مصرف را بدون بارکد اعتبار نشان می‌دهد')
const ledger = await salesLedger.ledger({ fromJalali: today, toJalali: today })
const ledgerRow = ledger.rows.find((row) => row.eventType === 'STORE_CREDIT_USED')
eq('ردیف مصرف اعتبار در دفتر وجود دارد', !!ledgerRow, true)
eq('کد اعتبار در هیچ فیلد ردیف دفتر نیست', containsCredential(ledgerRow), false)
eq('دفتر همچنان نوبت مصرف امن را نشان می‌دهد', String(ledgerRow?.documentLabel ?? '').includes('نوبت'), true)

console.log('۲) منابع گزارش ضدتقلب هم credential را بیرون نمی‌دهند')
const fraud = await fraudService.review({ fromJalali: today, toJalali: today })
const ratio = fraud.flags.find((flag) => flag.key === 'creditRatio')
const anonymous = fraud.flags.find((flag) => flag.key === 'creditForAnonymous')
eq('پرچم اعتبار بزرگ وجود دارد', !!ratio, true)
eq('منبع پرچم اعتبار بزرگ کد را ندارد', containsCredential(ratio?.sources ?? []), false)
eq('پرچم اعتبار مشتری عمومی وجود دارد', !!anonymous, true)
eq('منبع پرچم مشتری عمومی کد را ندارد', containsCredential(anonymous?.sources ?? []), false)
eq('شناسه امن اعتبار برای پیگیری باقی مانده است', String(ratio?.sources?.[0]?.label ?? '').includes(`#${creditId}`), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
