/**
 * نشست ۲۰۵ — پرداخت باطل‌شده نباید اضافه‌دریافت تازهٔ ویرایش را پنهان کند (بند ۴-۳۵).
 *
 * فاکتور ۱٬۰۰۰ با پرداخت ۱٬۳۰۰ (اضافه ۳۰۰) → ابطال آن پرداخت → ویرایش به ۵۰۰
 * با پرداخت ۶۰۰. اضافه‌ی واقعی ۱۰۰ است؛ بدون confirmOverpay باید رد شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s205-voided-payment-hides-overpay.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s205-void-overpay-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const throwsWith = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) {
      bad++
      console.log(`  ✗ ${label} — پیام «${m.split('\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}

console.log('\n۰) سیم‌کشی')
const src = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const upd = src.slice(src.indexOf('async update('), src.indexOf('async update(') + 80_000)
truthy('prevOverpay پرداخت باطل را کنار می‌گذارد', /prevOverpay[\s\S]{0,250}voidedAt == null/.test(upd))

const userId = seed.user('فروشنده ویرایش ۲۰۵')
const cat = seed.category('پوشاک')
const product = seed.product('کت', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const variantId = seed.variant(product, 'سایز')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 500 WHERE id = ?').run(variantId)
const line = (qty) => ({ variantId, qty, unitPrice: 500, discount: 0, tax: 0 })

console.log('\n۱) فاکتور ۱۰۰۰ با پرداخت ۱۳۰۰، بعد ابطال پرداخت')
const inv = await salesService.create({
  userId,
  shiftId,
  lines: [line(2)],
  payments: [{ methodId: cash, amount: 1300, destination: 'CASH' }],
  confirmOverpay: true
})
const pay = sql.prepare('SELECT id, overpayAmount, voidedAt FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL').get(inv.id)
eq('پرداخت زنده با اضافه‌دریافت ۳۰۰', Number(pay?.overpayAmount ?? -1), 300)
await salesService.deletePayment({ id: pay.id, userId, reason: 'ثبت اشتباه', managerPassword: PW, overrideReason: 'ثبت اشتباه' })
eq('پرداخت باطل شد', sql.prepare('SELECT voidedAt FROM "Payment" WHERE id = ?').get(pay.id)?.voidedAt != null, true)

console.log('\n۲) ویرایش به ۵۰۰ با پرداخت ۶۰۰ — اضافه‌ی تازه ۱۰۰')
await throwsWith(
  'بدون تأیید، اضافه‌دریافت ۱۰۰ بی‌صدا ثبت نمی‌شود',
  () => salesService.update({
    id: inv.id, userId, shiftId, lines: [line(1)],
    payments: [{ methodId: cash, amount: 600, destination: 'CASH' }]
  }),
  'اضافه‌دریافت'
)
eq(
  'فاکتور بعد از رد هنوز ۱۰۰۰ است',
  Number(sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(inv.id)?.grandTotal),
  1000
)

const okEdit = await salesService.update({
  id: inv.id, userId, shiftId, lines: [line(1)],
  payments: [{ methodId: cash, amount: 600, destination: 'CASH' }],
  confirmOverpay: true
})
eq('با تأیید ویرایش شد', !!okEdit, true)
eq(
  'جمع فاکتور ۵۰۰ شد',
  Number(sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(inv.id)?.grandTotal),
  500
)
const live = sql.prepare(
  'SELECT amount, overpayAmount FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL ORDER BY id DESC'
).get(inv.id)
eq('پرداخت زنده ۶۰۰ است', Number(live?.amount), 600)
eq('اضافه‌دریافت زنده ۱۰۰ است نه ۳۰۰', Number(live?.overpayAmount), 100)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
