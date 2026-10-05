/**
 * نشست ۶۸ — خوشه A / provenance واقعی Payment.
 *
 * این تست روی migrationهای واقعی و سرویس‌های واقعی اجرا می‌شود و سه چیز را
 * قفل می‌کند: زمان ثبت جدا از paidAt، actor/نشست ثبت روی خود Payment، و
 * نشست پاس‌شدن چک در clearedShiftId.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s68-'))
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
const truthy = (label, value) => eq(label, !!value, true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · بدون خطا پذیرفته شد`)
  } catch (e) {
    const text = String(e?.message ?? e)
    eq(label, text.includes(needle), true)
  }
}

const userA = seed.user('کارمند نشست اول')
const userB = seed.user('کارمند نشست دوم')
const product = seed.product('کالای provenance', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
const openedAt = Date.now() - 3_600_000
const shiftA = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt, userId: userA })

const oldPaidAt = new Date(Date.now() - 3 * 86_400_000)
const sale = await salesService.create({
  userId: userA,
  shiftId: shiftA,
  issuedAtJalali: toJalaliDate(oldPaidAt),
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 500, destination: 'CASH' }]
})
const first = seed.one('SELECT * FROM "Payment" WHERE invoiceId = ? ORDER BY id LIMIT 1', sale.id)
const paymentColumns = sql.prepare('PRAGMA table_info("Payment")').all().map((x) => x.name)
truthy('migration چهار ستون provenance را ساخته است', ['createdAt', 'createdByUserId', 'createdShiftId', 'clearedShiftId'].every((c) => paymentColumns.includes(c)))
eq('actor پرداخت اولیه روی خود Payment است', Number(first.createdByUserId), userA)
eq('نشست پرداخت اولیه روی خود Payment است', Number(first.createdShiftId), shiftA)
eq('تاریخ کسب‌وکاری پرداخت با issuedAt قدیمی مانده است', first.paidAtJalali, toJalaliDate(oldPaidAt))
truthy('زمان واقعی ثبت جدا و پر شده است', first.createdAt != null)
truthy('createdAt از paidAt جدیدتر است', Number(first.createdAt) > Number(first.paidAt))

const shiftB = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: Date.now() - 1_800_000, userId: userB })
const added = await salesService.addPayment({
  invoiceId: sale.id,
  userId: userB,
  methodId: cash,
  amount: 100,
  destination: 'CASH'
})
const second = seed.one('SELECT * FROM "Payment" WHERE id = ?', added.payment.id)
eq('پرداخت مرحله‌ای actor نشست باز را ثبت می‌کند', Number(second.createdByUserId), userB)
eq('پرداخت مرحله‌ای نشست باز را ثبت می‌کند', Number(second.createdShiftId), shiftB)

const chequePayment = await salesService.addPayment({
  invoiceId: sale.id,
  userId: userB,
  methodId: cheque,
  kind: 'CHEQUE',
  amount: 200,
  chequeNo: 'S68',
  bankName: 'تست',
  dueDateJalali: today
})
await salesService.setChequeStatus({
  id: chequePayment.payment.id,
  userId: userB,
  status: 'CLEARED',
  destination: 'MANAGER',
  managerPassword: PW
})
const cleared = seed.one('SELECT * FROM "Payment" WHERE id = ?', chequePayment.payment.id)
eq('چک actor ثبت‌کننده را نگه می‌دارد', Number(cleared.createdByUserId), userB)
eq('چک نشست ثبت را نگه می‌دارد', Number(cleared.createdShiftId), shiftB)
eq('چک نشست پاس‌شدن را جدا ثبت می‌کند', Number(cleared.clearedShiftId), shiftB)

sql.prepare('UPDATE "Shift" SET closedAt = ? WHERE id IN (?, ?)').run(Date.now(), shiftA, shiftB)
await rejects(
  'بدون نشست باز، ثبت قسط متوقف می‌شود',
  () => salesService.addPayment({ invoiceId: sale.id, userId: userB, methodId: cash, amount: 50, destination: 'CASH' }),
  'نشست باز'
)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
