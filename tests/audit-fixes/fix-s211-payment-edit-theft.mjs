/**
 * نشست ۲۱۱ — فروشنده بدون رمز نمی‌تواند پرداخت نقد را کم، باطل یا به کارت تبدیل کند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s211-payment-edit-theft.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s211-pay-theft-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) {
      bad++
      console.log(`  ✗ ${label} — پیام «${m.split('\\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}

const svc = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const fraudSrc = readFileSync(resolve(root, 'src/main/services/FraudService.ts'), 'utf8')
const cashSrc = readFileSync(resolve(root, 'src/main/services/CashboxService.ts'), 'utf8')
const modal = readFileSync(resolve(root, 'src/renderer/src/components/InvoicePaymentsModal.tsx'), 'utf8')
const closePage = readFileSync(resolve(root, 'src/renderer/src/pages/CashClose.tsx'), 'utf8')

console.log('\\n۰) سیم‌کشی')
truthy('گیت ویرایش مالی غیرچک قبل از تراکنش است', svc.includes("ویرایش مالی پرداخت"))
truthy('گیت ابطال غیرچک قبل از تراکنش است', svc.includes("ابطال پرداخت"))
truthy('ضدتقلب پرچم ویرایش پرداخت دارد', fraudSrc.includes("paymentEditedAfterSale"))
truthy('بستن صندوق ردیف ویرایش پرداخت دارد', cashSrc.includes('paymentMutationsInWindow'))
truthy('UI ابطال غیرچک رمز می‌خواهد', /isNonCheque/.test(modal))
truthy('صفحهٔ بستن صندوق ردیف نمایشی دارد', closePage.includes('پرداخت‌های ویرایش/ابطال‌شده'))

const userId = seed.user('فروشنده دزدی ۲۱۱')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000000 WHERE id = ?').run(v)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)
const saleOf = () => salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})

console.log('\\n۱) بدون رمز رد می‌شود و نقد صندوق عوض نمی‌شود')
const sale = await saleOf()
eq('نقد بعد از فروش ۱٬۰۰۰٬۰۰۰', await exp(), 1_000_000)
const pay = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', sale.id)
await rejects(
  'تبدیل نقد→کارت بدون رمز رد می‌شود',
  () => salesService.updatePayment({ id: Number(pay.id), methodId: card, destination: 'CARD', userId }),
  'رمز'
)
eq('نقد بعد از تلاش تبدیل همان ۱٬۰۰۰٬۰۰۰ است', await exp(), 1_000_000)

const s2 = await saleOf()
const p2 = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', s2.id)
await rejects(
  'کم‌کردن مبلغ بدون رمز رد می‌شود',
  () => salesService.updatePayment({ id: Number(p2.id), amount: 100_000, userId }),
  'رمز'
)
eq('نقد بعد از تلاش کم‌کردن ۲٬۰۰۰٬۰۰۰ است', await exp(), 2_000_000)

const s3 = await saleOf()
const p3 = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', s3.id)
await rejects(
  'ابطال بدون رمز رد می‌شود',
  () => salesService.deletePayment({ id: Number(p3.id), userId, reason: 'اشتباه' }),
  'رمز'
)
eq('نقد بعد از تلاش ابطال ۳٬۰۰۰٬۰۰۰ است', await exp(), 3_000_000)

console.log('\\n۲) با رمز پذیرفته می‌شود؛ ضدتقلب و بستن صندوق رد می‌گذارند')
await salesService.updatePayment({
  id: Number(pay.id),
  methodId: card,
  destination: 'CARD',
  userId,
  managerPassword: PW,
  overrideReason: 'اصلاح تست ۲۱۱ تبدیل نقد به کارت'
})
eq('بعد از تبدیل با رمز نقد ۲٬۰۰۰٬۰۰۰ است', await exp(), 2_000_000)

await salesService.updatePayment({
  id: Number(p2.id),
  amount: 100_000,
  userId,
  managerPassword: PW,
  overrideReason: 'اصلاح تست ۲۱۱ کم کردن مبلغ'
})
eq('بعد از کم‌کردن با رمز نقد ۱٬۱۰۰٬۰۰۰ است', await exp(), 1_100_000)

await salesService.deletePayment({
  id: Number(p3.id),
  userId,
  reason: 'ثبت اشتباه تست ۲۱۱',
  managerPassword: PW,
  overrideReason: 'ثبت اشتباه تست ۲۱۱'
})
eq('بعد از ابطال با رمز نقد ۱۰۰٬۰۰۰ است', await exp(), 100_000)

const fr = await fraudService.review({ fromJalali: today, toJalali: today })
const flag = (fr?.flags ?? []).find((f) => f.key === 'paymentEditedAfterSale')
truthy('پرچم ضدتقلب ویرایش پرداخت هست', !!flag)
truthy('پرچم حداقل ۳ ردیف دارد', (flag?.count ?? 0) >= 3)

const preview = await cashboxService.expected({ shiftId })
truthy('پیش‌نمایش بستن صندوق ردیف ویرایش دارد', (preview.paymentMutations ?? []).length >= 3)

const closed = await cashboxService.close({ shiftId, countedCash: 100_000, userId })
eq('صندوق با شمارش ۱۰۰٬۰۰۰ بی‌مغایرت است', Number(closed?.cashClose?.cashDifference ?? closed?.difference ?? closed?.diff ?? 0), 0)
truthy('ثبت بستن صندوق هم ردیف ویرایش دارد', (closed?.cashClose?.paymentMutations ?? []).length >= 3)

console.log(`\\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
