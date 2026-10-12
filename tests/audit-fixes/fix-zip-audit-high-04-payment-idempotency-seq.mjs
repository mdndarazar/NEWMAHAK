/**
 * ZIP-AUDIT-HIGH-04
 *
 * A retry of the same payment request must return the already committed Payment,
 * not record cash twice. Independently, Payment.invoiceId + seq is a database
 * invariant: even two writers that both observed the same MAX(seq) cannot
 * commit duplicate sequence numbers.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-04-payment-idempotency-seq.mjs
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-high-04-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const userId = seed.user('کارمند پرداخت')
const categoryId = seed.category('دسته پرداخت')
const productId = seed.product('کالای پرداخت', categoryId)
const variantId = seed.variant(productId, 'سایز پرداخت')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cashMethodId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', {
  name: 'نشست پرداخت',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 60_000,
  userId,
  staffConfirmed: 1
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
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — خطا نداد`)
  } catch (error) {
    eq(label, String(error?.message ?? error).includes(needle), true)
  }
}
const paymentRows = (invoiceId) => seed.rows('SELECT id, seq, amount, idempotencyKey FROM "Payment" WHERE invoiceId = ? ORDER BY seq, id', invoiceId)

console.log('۰) migration داده‌ی قدیمیِ دارای seq تکراری را قبل از unique index ترمیم می‌کند')
const migrationRoot = resolve('prisma/migrations')
const migrationName = '20271019180000_payment_add_idempotency'
const legacy = new DatabaseSync(join(dir, 'pre-payment-idempotency.db'))
legacy.exec('PRAGMA foreign_keys = OFF')
for (const name of readdirSync(migrationRoot).sort()) {
  if (name >= migrationName) break
  legacy.exec(readFileSync(join(migrationRoot, name, 'migration.sql'), 'utf8'))
}
// بعضی migrationهای بازتعریف جدول در انتها foreign_keys را روشن می‌کنند.
legacy.exec('PRAGMA foreign_keys = OFF')
legacy.exec('INSERT INTO "Payment" ("invoiceId", "methodId", "amount", "seq") VALUES (77, 1, 10, 4), (77, 1, 20, 4), (77, 1, 30, 4)')
legacy.exec(readFileSync(join(migrationRoot, migrationName, 'migration.sql'), 'utf8'))
const repaired = legacy.prepare('SELECT "seq" FROM "Payment" WHERE "invoiceId" = 77 ORDER BY "id"').all().map((row) => Number(row.seq))
eq('نسخه‌ی اول seq قدیمی را نگه می‌دارد و بقیه یکتا می‌شوند', JSON.stringify(repaired), JSON.stringify([4, 5, 6]))
try {
  legacy.exec('INSERT INTO "Payment" ("invoiceId", "methodId", "amount", "seq") VALUES (77, 1, 40, 5)')
  eq('unique index پس از migration فعال است', false, true)
} catch (error) {
  eq('unique index پس از migration فعال است', /UNIQUE/.test(String(error?.message ?? error)), true)
}
legacy.close()

const invoice = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0, name: 'کالای پرداخت' }],
  payments: []
})
const common = { invoiceId: invoice.id, userId, amount: 200, methodId: cashMethodId, destination: 'CASH' }

console.log('۱) retry با همان کلید، همان پرداخت commit‌شده را برمی‌گرداند')
const first = await salesService.addPayment({ ...common, idempotencyKey: 'zip-h4-payment-retry-1' })
const retry = await salesService.addPayment({ ...common, idempotencyKey: 'zip-h4-payment-retry-1' })
eq('retry همان id پرداخت اول است', retry.payment.id, first.payment.id)
eq('retry به‌عنوان replay مشخص است', retry.replayed, true)
eq('retry هیچ پرداخت دوم نمی‌سازد', paymentRows(invoice.id).length, 1)
eq('پرداخت نخست seq یک دارد', paymentRows(invoice.id)[0]?.seq, 1)

console.log('۲) reuse کلید برای ورودی مالی متفاوت رد می‌شود')
await rejects(
  'همان کلید با مبلغ متفاوت رد می‌شود',
  () => salesService.addPayment({ ...common, amount: 201, idempotencyKey: 'zip-h4-payment-retry-1' }),
  'درخواست متفاوت'
)
eq('reuse نامعتبر کلید ردیف دوم نساخت', paymentRows(invoice.id).length, 1)

console.log('۳) دو پرداخت واقعیِ متفاوت، sequenceهای پیوسته و مستقل دارند')
const second = await salesService.addPayment({ ...common, idempotencyKey: 'zip-h4-payment-new-2' })
eq('پرداخت واقعی دوم seq دو دارد', second.payment.seq, 2)
eq('دو درخواست با دو کلید، دو پرداخت دارند', paymentRows(invoice.id).length, 2)

console.log('۴) invariant دیتابیس duplicate seq را حتی زیر race رد می‌کند')
await rejects(
  'INSERT با invoiceId/seq تکراری رد می‌شود',
  () =>
    db.payment.create({
      data: {
        invoiceId: invoice.id,
        methodId: cashMethodId,
        amount: 1,
        kind: 'CASH',
        seq: 2,
        paidAt: new Date(),
        destination: 'CASH'
      }
    }),
  'UNIQUE'
)
eq('تصادم seq هیچ ردیف مالی تازه نساخت', paymentRows(invoice.id).length, 2)

const schema = readFileSync(resolve('prisma/schema.prisma'), 'utf8')
const modal = readFileSync(resolve('src/renderer/src/components/InvoicePaymentsModal.tsx'), 'utf8')
eq('schema کلید retry یکتا دارد', /idempotencyKey\s+String\?\s+@unique/.test(schema), true)
eq('schema seq را در هر فاکتور یکتا می‌کند', /@@unique\(\[invoiceId, seq\]\)/.test(schema), true)
eq('UI کلید را تا پاسخ قطعی نگه می‌دارد', /addPaymentRequestKey\.current \?\?/.test(modal), true)
eq('UI کلید همان درخواست را به IPC می‌فرستد', /idempotencyKey,\s*\n\s*kind,/.test(modal), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
