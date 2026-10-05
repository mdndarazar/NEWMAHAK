/**
 * نشست ۷۰ — خوشه A / A1: رویدادهای دفتر فروش نباید با تاریخ صدور فاکتور
 * ناپدید شوند.
 *
 * بازتولید:
 * فاکتور در ۱۴۰۵/۰۱/۳۱ صادر شده، اما برگشت در ۱۴۰۵/۰۲/۰۱ ثبت شده است.
 * گزارش روز برگشت باید خودِ برگشت را نشان دهد.
 *
 * اجرای baseline ساختاری:
 *   SALES_LEDGER_SOURCE=/path/to/SalesLedger.ts node tests/audit-fixes/fix-s70-event-scope.mjs
 *
 * اجرای کامل:
 *   node --import ./test/harness/register.mjs tests/audit-fixes/fix-s70-event-scope.mjs
 */
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const sourcePath = process.env.SALES_LEDGER_SOURCE
  ? resolve(process.env.SALES_LEDGER_SOURCE)
  : resolve('src/main/services/SalesLedger.ts')
const source = readFileSync(sourcePath, 'utf8')
const serviceSource = readFileSync(resolve('src/main/services/SalesService.ts'), 'utf8')
const uiSource = readFileSync(resolve('src/renderer/src/pages/SalesReports.tsx'), 'utf8')
const tableSource = readFileSync(resolve('src/renderer/src/components/ReportExtraTables.tsx'), 'utf8')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

// These are the exact regression guards for the A1 event-scope bug.
eq('فیلتر مستقل رویداد در دفتر تعریف شده است', /eventSaleWhere|eventInvoiceWhere|eventInvoiceContext/.test(source), true)
eq('کوئری برگشت تاریخ فاکتور را به‌عنوان scope تحمیل نمی‌کند', !/where:\s*\{\s*invoice:\s*where\b/.test(source), true)
eq('کوئری وصول نسیه فیلتر مستقل رویداد را مصرف می‌کند', /invoice:\s*\{\s*\.\.\.(eventInvoiceWhere|eventInvoiceContext),\s*issuedAt:\s*\{\s*lt:\s*period\.from\s*\}/.test(source), true)
eq('کوئری پاس‌شدن چک فیلتر مستقل رویداد را مصرف می‌کند', /invoice:\s*(eventInvoiceWhere|eventInvoiceContext)/.test(source), true)
eq('فهرست چک تاریخچه‌ی append-only را می‌خواند', /chequeStatusHistory:\s*\{\s*orderBy:\s*\{\s*id:\s*'asc'\s*\}/.test(serviceSource), true)
eq('ردیف چک متن تاریخچه را به UI و خروجی می‌دهد', /chequeHistoryText/.test(serviceSource + tableSource + uiSource), true)
eq('تب چک آرایه‌ی خام endpoint را هم نمایش می‌دهد', /if\s*\(Array\.isArray\(src\)\)\s*return src/.test(tableSource), true)

// Baseline mode is intentionally structural only, so it can run without the
// harness. The full mode below proves the data path against SQLite.
if (!process.env.SALES_LEDGER_SOURCE) {
  process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s70-'))
  process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

  const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
  const { makeSeeder } = await import('../../test/harness/seed.mjs')
  const { salesService } = await import('../../src/main/services/SalesService.ts')
  const { salesLedger } = await import('../../src/main/services/SalesLedger.ts')
  const { jalaliStartOfDay } = await import('../../src/shared/jalali.ts')

  const prisma = harnessClient()
  const seed = makeSeeder(prisma)
  const at = (jalali, hour) => new Date(jalaliStartOfDay(jalali).getTime() + hour * 3_600_000)

  const inv = seed.invoice({ grandTotal: 500_000 })
  prisma.$harness.db
    .prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?')
    .run(at('1405/01/31', 10).getTime(), '1405/01/31', inv.id)
  seed.insert('SaleReturn', {
    invoiceId: inv.id,
    total: 200_000,
    refundMethod: 'CASH',
    refundAmount: 200_000,
    returnedAt: at('1405/02/01', 12),
    returnedAtJalali: '1405/02/01',
    returnedAtTime: '12:00:00',
    kind: 'RETURN'
  })

  const report = await salesLedger.ledger({ fromJalali: '1405/02/01', toJalali: '1405/02/01' })
  const returned = report.rows.find((row) => row.eventType === 'RETURN')
  eq('برگشتِ فاکتور ماه قبل در دفتر روز برگشت دیده می‌شود', returned?.amount ?? 0, 200_000)
  eq('تاریخ ردیف برگشت تاریخ خود رویداد است', returned?.dateJalali ?? null, '1405/02/01')

  const chequeMethod = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM' })
  const paymentId = seed.insert('Payment', {
    invoiceId: inv.id,
    methodId: chequeMethod,
    amount: 200_000,
    kind: 'CHEQUE',
    chequeNo: 'S70',
    chequeStatus: 'CLEARED',
    paidAt: at('1405/01/31', 10),
    paidAtJalali: '1405/01/31',
    clearedAt: at('1405/02/01', 13),
    clearedAtJalali: '1405/02/01'
  })
  seed.insert('PaymentChequeStatusHistory', {
    paymentId,
    status: 'PENDING',
    changedAt: at('1405/01/31', 10),
    changedAtJalali: '1405/01/31'
  })
  seed.insert('PaymentChequeStatusHistory', {
    paymentId,
    status: 'CLEARED',
    clearedAt: at('1405/02/01', 13),
    clearedAtJalali: '1405/02/01',
    changedAt: at('1405/02/01', 13),
    changedAtJalali: '1405/02/01'
  })
  const chequeRows = await salesService.chequeList({
    fromJalali: '1405/02/01',
    toJalali: '1405/02/01',
    dateMode: 'cleared'
  })
  eq('تب چک تاریخچه را از دفتر append-only می‌گیرد', chequeRows[0]?.chequeHistoryText ?? '', 'در جریان (پاس نشده) در 1405/01/31 ← پاس شد در 1405/02/01')
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
