/**
 * نشست ۶۹ — خوشه A / تاریخچه‌ی append-only وضعیت چک.
 *
 * این تست عمداً سه گذار CLEARED → BOUNCED → CLEARED را ثبت می‌کند و
 * ثابت می‌کند که پاس‌شدن اول، مقصد و زمانش با وضعیت بعدی overwrite نمی‌شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s69-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
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

const user = seed.user('کارمند تاریخچه چک')
const product = seed.product('کالای تاریخچه چک', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now(), userId: user })

const sale = await salesService.create({
  userId: user,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 100, destination: 'CASH' }]
})
const payment = await salesService.addPayment({
  invoiceId: sale.id,
  userId: user,
  methodId: cheque,
  kind: 'CHEQUE',
  amount: 900,
  chequeNo: 'S69',
  bankName: 'تست',
  dueDateJalali: today
})

const firstClear = new Date(Date.now() - 86_400_000)
await salesService.setChequeStatus({
  id: payment.payment.id,
  userId: user,
  status: 'CLEARED',
  clearedAtJalali: toJalaliDate(firstClear),
  destination: 'MANAGER',
  managerPassword: PW
})
await salesService.setChequeStatus({
  id: payment.payment.id,
  userId: user,
  status: 'BOUNCED',
  managerPassword: PW
})
await salesService.setChequeStatus({
  id: payment.payment.id,
  userId: user,
  status: 'CLEARED',
  destination: 'MANAGER',
  managerPassword: PW
})

const columns = sql.prepare('PRAGMA table_info("PaymentChequeStatusHistory")').all().map((x) => x.name)
eq('جدول تاریخچه‌ی چک ساخته شده است', columns.includes('status'), true)
const history = sql
  .prepare(
    'SELECT status, destination, clearedAtJalali, clearedShiftId FROM "PaymentChequeStatusHistory" WHERE paymentId = ? ORDER BY id'
  )
  .all(payment.payment.id)
eq('هر سه گذار append-only ثبت شده‌اند', history.length, 3)
eq('ردیف اول پاس‌شدن حفظ شده است', history[0]?.status, 'CLEARED')
eq('مقصد پاس‌شدن اول حفظ شده است', history[0]?.destination, 'MANAGER')
eq('تاریخ پاس‌شدن اول حفظ شده است', history[0]?.clearedAtJalali, toJalaliDate(firstClear))
eq('گذار برگشت‌خوردن حفظ شده است', history[1]?.status, 'BOUNCED')
eq('ردیف نهایی وضعیت تازه را دارد', history[2]?.status, 'CLEARED')
eq('مقصد پاس‌شدن دوم جدا ثبت شده است', history[2]?.destination, 'MANAGER')
eq(
  'مقصد فعلی Payment با آخرین گذار منطبق است',
  sql.prepare('SELECT destination FROM "Payment" WHERE id = ?').get(payment.payment.id)?.destination,
  'MANAGER'
)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
