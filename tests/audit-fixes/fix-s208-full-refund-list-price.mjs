/**
 * نشست ۲۰۸ — بند ۴-۱۱: با رمز مدیر یک کالا از دو کالای ۱٬۰۰۰٬۰۰۰ با ۱۰٪ تخفیف
 * کل باید ۱٬۰۰۰٬۰۰۰ نقد برگردد، نه بی‌صدا ۹۰۰٬۰۰۰.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s208-full-refund-list-price.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s208-full-ref-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
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

const userId = seed.user('مدیر بازپرداخت ۲۰۸')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v1 = seed.variant(product, '۳۰')
const v2 = seed.variant(product, '۳۲')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000000').run()
const itemIds = (invoiceId) =>
  sql.prepare('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id').all(invoiceId).map((r) => Number(r.id))

console.log('\n۱) برگشت عادی یک کالا = ۹۰۰٬۰۰۰')
const invA = await salesService.create({
  userId, shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }
  ],
  invoiceDiscount: 200_000, discountTotal: 200_000, orderDiscount: 200_000,
  payments: [{ methodId: cash, amount: 1_800_000, destination: 'CASH' }]
})
const [a1] = itemIds(invA.id)
const plain = await salesService.createReturn({
  invoiceId: invA.id, full: false, lines: [{ saleItemId: a1, qty: 1 }],
  refundMethod: RefundMethod.CASH, userId
})
eq('بدون override همان سهم تخفیف‌خورده است', Number(plain.refundAmount), 900_000)

console.log('\n۲) با رمز مدیر = ۱٬۰۰۰٬۰۰۰')
const invB = await salesService.create({
  userId, shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }
  ],
  invoiceDiscount: 200_000, discountTotal: 200_000, orderDiscount: 200_000,
  payments: [{ methodId: cash, amount: 1_800_000, destination: 'CASH' }]
})
const [b1, b2] = itemIds(invB.id)
const pw = { managerFullRefund: true, managerPassword: PW, overrideReason: 'رضایت مشتری', userId }
const full = await salesService.createReturn({
  invoiceId: invB.id, full: false, lines: [{ saleItemId: b1, qty: 1 }],
  refundMethod: RefundMethod.CASH, ...pw
})
eq('با override نقد ۱٬۰۰۰٬۰۰۰ است نه ۹۰۰٬۰۰۰', Number(full.refundAmount), 1_000_000)
eq('ارزش سند برگشت هم ۱٬۰۰۰٬۰۰۰ است', Number(sql.prepare('SELECT total FROM "SaleReturn" WHERE id = ?').get(full.id)?.total), 1_000_000)
const rem = Number((await salesService.payments({ invoiceId: invB.id }))?.remaining)
eq('بعد از override مشتری بدهکار نمی‌شود', rem, 0)

await throwsWith(
  'کالای دوم بیش از پول مانده رد می‌شود',
  () => salesService.createReturn({
    invoiceId: invB.id, full: false, lines: [{ saleItemId: b2, qty: 1 }],
    refundMethod: RefundMethod.CASH, ...pw
  }),
  'کسر تخفیف'
)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
