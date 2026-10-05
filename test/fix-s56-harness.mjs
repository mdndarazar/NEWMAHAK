/**
 * ===========================================================================
 * نشست ۱ زنجیره رفع · گام ۰ — تست کنترلیِ خودِ هارنس.
 *
 * چرا این تست اول همه است: تا وقتی مترجم Prisma → SQL غلط باشد، هر تست دیگری
 * «سبزِ دروغ» است. باگ: در `resolveRelation` شرط کلید خارجی با `...opts`
 * بازنویسی می‌شد، پس `include: { payments: { where: ... } }` رابطه را به کل
 * جدول ترجمه می‌کرد و پرداخت ۱۰۰ به فاکتور دیگری هم می‌چسبید.
 *
 *     node --import ./test/harness/register.mjs test/fix-s56-harness.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-harness-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')

const prisma = harnessClient()
const seed = makeSeeder(prisma)

let ok = 0
let bad = 0
const check = (label, cond, extra = '') => {
  if (cond) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label}${extra ? ' — ' + extra : ''}`) }
}
const eq = (label, got, want) => check(`${label} = ${want}`, got === want, `دریافت: ${got}`)

console.log('\n— کنترل هارنس — کلید خارجی رابطه هرگز با where فراخوان بازنویسی نشود')

const methodId = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH' })
const a = seed.invoice({ grandTotal: 1_000_000 })
const b = seed.invoice({ grandTotal: 1_000_000 })
seed.insert('Payment', { invoiceId: a.id, methodId, amount: 100, kind: 'CASH', destination: 'CASH' })
seed.insert('Payment', { invoiceId: b.id, methodId, amount: 999, kind: 'CASH', destination: 'CASH' })

const withFilter = await prisma.saleInvoice.findUnique({
  where: { id: a.id },
  include: { payments: { where: { kind: 'CASH' } } }
})
eq('تعداد پرداخت فاکتور الف با فیلتر kind', withFilter.payments.length, 1)
eq('مبلغ همان پرداخت', withFilter.payments[0].amount, 100)

const plain = await prisma.saleInvoice.findUnique({ where: { id: a.id }, include: { payments: true } })
eq('بدون فیلتر هم فقط پرداخت خودش', plain.payments.length, 1)

const other = await prisma.saleInvoice.findUnique({
  where: { id: b.id },
  include: { payments: { where: { amount: { gt: 0 } } } }
})
eq('فاکتور ب هم فقط پرداخت خودش', other.payments.length, 1)
eq('و مبلغش', other.payments[0].amount, 999)

// شرط فراخوان باید *رویِ* کلید خارجی بنشیند، نه جایش
const none = await prisma.saleInvoice.findUnique({
  where: { id: a.id },
  include: { payments: { where: { amount: 999 } } }
})
eq('فیلتری که به پرداخت خودش نمی‌خورد ⇒ خالی', none.payments.length, 0)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad === 0 ? 0 : 1)
