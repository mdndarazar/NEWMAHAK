// @ts-check
/**
 * ستون «تسویه با اعتبار خرید» گزارش فروش و قرارداد جزئیات امن فاکتور.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s334-credit-settlement-column.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s334-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const secret = 'S334-REDEEMABLE-SECRET'
const invoice = seed.invoice({ grandTotal: 800_000, status: 'FINAL' })
const creditMethodId = seed.insert('PaymentMethod', {
  key: 'S334-CREDIT', label: 'روش داخلی اعتبار', kind: 'STORE_CREDIT', isActive: 1, sortOrder: 1
})
const creditId = seed.insert('StoreCredit', {
  code: secret, amount: 800_000, usedAmount: 800_000, status: 'USED', source: 'MANUAL', issuedAt: Date.now(), issuedAtJalali: '1405/07/18'
})
seed.insert('Payment', {
  invoiceId: invoice.id,
  methodId: creditMethodId,
  storeCreditId: creditId,
  amount: 800_000,
  kind: 'CASH',
  /** دادهٔ قدیمی/بد؛ نباید به DTO عادی پرداختی نشت کند. */
  reference: secret,
  note: `تسویه با کد ${secret}`,
  paidAt: Date.now(),
  paidAtJalali: '1405/07/18',
  paidAtTime: '10:00:00'
})

console.log('--- ۱. جزئیات فاکتور، تسویهٔ اعتبار را نشان می‌دهد اما credential را رد می‌کند ---')
const view = await salesService.payments({ invoiceId: invoice.id })
assert.equal(view.storeCreditTotal, 800_000, 'عدد تسویهٔ اعتبار از سرور رسمی می‌آید')
assert.equal(view.payments.length, 1)
assert.equal(view.payments[0].isStoreCredit, true, 'ردیف پرداخت به‌عنوان مصرف اعتبار برچسب می‌خورد')
assert.equal(view.payments[0].methodLabel, 'تسویه با اعتبار خرید', 'برچسب امن و غیرقابل‌استفاده برمی‌گردد')
assert.equal(view.payments[0].reference, null, 'reference احتمالاً حاوی کد است و باید redacted باشد')
assert.equal(view.payments[0].note, null, 'note احتمالاً حاوی کد است و باید redacted باشد')
assert.doesNotMatch(JSON.stringify(view), new RegExp(secret), 'کد قابل‌مصرف نباید در IPC معمول پرداختی‌ها باشد')
console.log('  ✓ مبلغ/نوع امن دیده شد و کد از DTO استاندارد حذف ماند')

console.log('--- ۲. ستون گزارش و خروجی‌ها از عدد server-side استفاده می‌کنند ---')
const reports = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const settlementModal = readFileSync('src/renderer/src/components/CreditSettlementModal.tsx', 'utf8')
assert.match(reports, /'تسویه با اعتبار خرید'/, 'سرستون باید صریح باشد')
assert.match(reports, /r\.storeCreditTotal/, 'سلول ردیف باید مقدار آمادهٔ server را بخواند')
assert.match(reports, /t\.storeCreditUsedTotal/, 'جمع ستون باید مقدار رسمی accounting باشد')
assert.match(reports, /onOpenCreditSettlement=\{\(invoiceId\) => setCreditSettlementFor\(invoiceId\)\}/,
  'کلیک ستون باید به نمای فقط‌خواندنیِ تسویهٔ همان فاکتور برود')
assert.match(settlementModal, /CH\.saleCreditSettlementLineage/,
  'نمای اختصاصی زنجیرهٔ فقط‌خواندنی و باریک تسویه را از endpoint خودش می‌گیرد')
assert.match(settlementModal, /view\.rows\.map/,
  'نمای اختصاصی فقط ردیف‌های lineage اعتبار را نشان می‌دهد')
assert.match(settlementModal, /row\.credit\.publicReference/,
  'نمای اختصاصی به‌جای credential، مرجع امن اعتبار را نشان می‌دهد')
assert.doesNotMatch(settlementModal, /(?:row|view)\.(?:code|legacyCode|storeCreditCode)\b|row\.credit\.(?:code|legacyCode)\b|salePayment(Add|Update|Delete)|PaymentForm/,
  'کلیک ستون نباید credential یا mutationهای پنجرهٔ عمومی پرداخت را باز کند')
assert.doesNotMatch(reports, /storeCreditCode/, 'گزارش فروش نباید کد اعتبار را برای ستون جدید بخواند')
console.log('  ✓ جدول، چاپ/خروجی و جزئیات فاکتور به عدد امن متصل‌اند')

console.log('\nنتیجه: ستون تسویه با اعتبار و جزئیات امن فاکتور برقرار است.')
