/**
 * ZIP-AUDIT-HIGH-08
 *
 * A merge is not allowed to silently discard cash movements: these are the
 * append-only evidence for opening float, deposits, withdrawals and cash
 * refunds, and directly feed drawer reconciliation.  The test builds a real
 * separate SQLite source database, then exercises MergeService against it.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-08-merge-financial-ledgers.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-08-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'target.db')

const { harnessClient, PrismaClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { buildDatabase } = await import('../../test/harness/schema.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { mergeBackup } = await import('../../src/main/services/MergeService.ts')
const { applyMigrations } = await import('../../src/main/db/migrator.ts')

const target = harnessClient()
const targetSeed = makeSeeder(target)
const targetUserId = targetSeed.user('فروشنده مقصد')
const targetShiftId = targetSeed.insert('Shift', {
  name: 'شیفت مقصد',
  number: 1,
  dayJalali: '1405/07/19',
  openedAt: new Date('2026-10-11T08:00:00.000Z'),
  userId: targetUserId
})
targetSeed.insert('CashMovement', {
  amount: 10_000,
  type: 'DEPOSIT',
  occurredAt: new Date('2026-10-11T08:30:00.000Z'),
  shiftId: targetShiftId,
  userId: targetUserId,
  description: 'گردش موجود مقصد'
})
// رکوردهای مالی مقصد باعث می‌شوند آزمون واقعاً نگاشت ID مبدأ→مقصد را بسنجد،
// نه این‌که هر دو دیتابیسِ خالی تصادفاً با id=1 شروع شوند.
const targetMethodId = targetSeed.insert('PaymentMethod', { key: 'TARGET_CASH', label: 'نقد مقصد', kind: 'CASH' })
const targetInvoiceId = targetSeed.insert('SaleInvoice', {
  receiptNo: 101,
  status: 'SETTLED',
  grandTotal: 1,
  paidTotal: 1,
  issuedAtJalali: '1405/07/19',
  userId: targetUserId,
  shiftId: targetShiftId
})
targetSeed.insert('Payment', { invoiceId: targetInvoiceId, methodId: targetMethodId, amount: 1, seq: 1 })
targetSeed.insert('SaleReturn', { invoiceId: targetInvoiceId, returnedAtJalali: '1405/07/19' })
const sourceFile = join(dir, 'source-financial.db')
buildDatabase(sourceFile)
const source = new PrismaClient({ datasources: { db: { url: `file:${sourceFile}?connection_limit=1` } } })
// buildDatabase برای fixture ساختار نهایی را می‌سازد اما ledger migration ندارد.
// آن را پیش از درج داده اجرا می‌کنیم تا MergeService همان مسیر واقعیِ backup
// دارای migration ledger را ببیند، بدون این‌که migration بازتعریف جدول داده را لمس کند.
await applyMigrations(source, sourceFile, { touchFile: false })
const sourceSeed = makeSeeder(source)
const sourceUserId = sourceSeed.user('فروشنده بایگانی')
const sourceShiftId = sourceSeed.insert('Shift', {
  name: 'شیفت بایگانی',
  number: 4,
  dayJalali: '1405/07/20',
  openedAt: new Date('2026-10-12T08:00:00.000Z'),
  userId: sourceUserId
})
const movementId = sourceSeed.insert('CashMovement', {
  amount: 725_000,
  type: 'WITHDRAWAL',
  occurredAt: new Date('2026-10-12T09:30:00.000Z'),
  occurredAtJalali: '1405/07/20',
  occurredAtTime: '09:30:00',
  shiftId: sourceShiftId,
  userId: sourceUserId,
  description: 'برداشت بایگانی برای آزمون ادغام',
  refType: 'Manual',
  refId: null
})
sourceSeed.insert('CashSession', {
  shiftId: sourceShiftId,
  fromDate: new Date('2026-10-12T08:00:00.000Z'),
  toDate: new Date('2026-10-12T10:00:00.000Z'),
  dayJalali: '1405/07/20',
  expectedCash: 1_180_000,
  withdrawals: 725_000,
  openingFloat: 500_000,
  accountingSnapshotJson: '{"fixture":"financial-ledger"}'
})
const sourceMethodId = sourceSeed.insert('PaymentMethod', { key: 'MERGE_CHEQUE', label: 'چک بایگانی', kind: 'CHEQUE' })
const sourceInvoiceId = sourceSeed.insert('SaleInvoice', {
  receiptNo: 808,
  status: 'SETTLED',
  goodsTotal: 500_000,
  grandTotal: 500_000,
  paidTotal: 500_000,
  issuedAt: new Date('2026-10-12T08:30:00.000Z'),
  issuedAtJalali: '1405/07/20',
  userId: sourceUserId,
  shiftId: sourceShiftId
})
const sourcePaymentId = sourceSeed.insert('Payment', {
  invoiceId: sourceInvoiceId,
  methodId: sourceMethodId,
  amount: 500_000,
  kind: 'CHEQUE',
  seq: 1,
  paidAt: new Date('2026-10-12T08:35:00.000Z'),
  chequeStatus: 'CLEARED',
  clearedShiftId: sourceShiftId,
  clearedByUserId: sourceUserId
})
sourceSeed.insert('PaymentChequeStatusHistory', {
  paymentId: sourcePaymentId,
  status: 'CLEARED',
  destination: 'CASH',
  clearedShiftId: sourceShiftId,
  userId: sourceUserId,
  changedAt: new Date('2026-10-12T08:36:00.000Z'),
  changedAtJalali: '1405/07/20'
})
const sourceReturnId = sourceSeed.insert('SaleReturn', {
  invoiceId: sourceInvoiceId,
  total: 300_000,
  returnedAt: new Date('2026-10-12T09:00:00.000Z'),
  returnedAtJalali: '1405/07/20',
  userId: sourceUserId,
  shiftId: sourceShiftId
})
sourceSeed.insert('CardTransferRequest', {
  kind: 'REQUEST',
  status: 'PAID',
  operationKind: 'RETURN',
  returnId: sourceReturnId,
  sourceInvoiceId: sourceInvoiceId,
  sourceReceiptNo: 808,
  invoiceTotal: 500_000,
  returnTotal: 300_000,
  amount: 300_000,
  userId: sourceUserId,
  userName: 'فروشنده بایگانی',
  shiftId: sourceShiftId,
  shiftName: 'شیفت بایگانی',
  createdAt: new Date('2026-10-12T09:05:00.000Z'),
  createdAtJalali: '1405/07/20',
  createdAtTime: '09:05:00',
  paidAmount: 300_000,
  paidAt: new Date('2026-10-12T09:10:00.000Z'),
  paidMethod: 'CARD_TRANSFER',
  trackingNo: 'MERGE-CARD-REF-08',
  paidByUserId: sourceUserId,
  paidShiftId: sourceShiftId
})
await source.$disconnect()

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

console.log('۱) ادغام منبع مستقل، گردش نقدی را حذف نمی‌کند')
const report = await mergeBackup({ file: sourceFile, fileName: 'source-financial.db', userId: null })
const merged = await target.cashMovement.findMany({ where: { amount: 725_000 }, orderBy: { id: 'asc' } })
eq('یک گردش نقدی منبع وارد شده است', merged.length, 1)
eq('مبلغ گردش بدون تغییر است', Number(merged[0]?.amount), 725_000)
eq('نوع گردش بدون تغییر است', merged[0]?.type, 'WITHDRAWAL')
eq('تاریخ شمسی گردش حفظ شده است', merged[0]?.occurredAtJalali, '1405/07/20')
eq('شیفت قدیمی به شیفت ادغام‌شده نگاشت شده است', merged[0]?.shiftId != null && merged[0]?.shiftId !== sourceShiftId, true)
eq('گزارش merge تعداد گردش‌های مالی را صریح دارد', report.inserted?.cashMovement, 1)
eq('شناسه‌ی منبع واقعاً با مقصد یکی نشده است', movementId !== merged[0]?.id, true)

console.log('۲) snapshot صندوق، دفتر چک و کارت‌به‌کارت هم کامل می‌مانند')
const session = await target.cashSession.findFirst({ where: { accountingSnapshotJson: '{"fixture":"financial-ledger"}' } })
const chequeHistory = await target.paymentChequeStatusHistory.findFirst({ where: { status: 'CLEARED' } })
const transfer = await target.cardTransferRequest.findFirst({ where: { trackingNo: 'MERGE-CARD-REF-08' } })
eq('expectedCash snapshot بستن صندوق حفظ شده است', Number(session?.expectedCash), 1_180_000)
eq('withdrawal snapshot بستن صندوق حفظ شده است', Number(session?.withdrawals), 725_000)
eq('دفتر append-only وضعیت چک وارد شده است', !!chequeHistory, true)
eq('تاریخچه چک به پرداخت بازشماره‌گذاری‌شده وصل است', chequeHistory?.paymentId !== sourcePaymentId, true)
eq('درخواست کارت‌به‌کارت وارد شده است', !!transfer, true)
eq('مبلغ کارت‌به‌کارت حفظ شده است', Number(transfer?.amount), 300_000)
eq('کارت‌به‌کارت به برگشت بازشماره‌گذاری‌شده وصل است', transfer?.returnId !== sourceReturnId, true)
eq('گزارش merge همه ledgerهای افزوده را می‌شمارد', report.inserted?.paymentChequeStatusHistory === 1 && report.inserted?.CardTransferRequest === 1, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
