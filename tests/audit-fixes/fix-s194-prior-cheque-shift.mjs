/**
 * نشست ۱۹۴ · M-2 — چکِ فاکتور دیروز که در شیفت ۱ ثبت و در شیفت ۲ پاس شده،
 * در گزارش فیلترشده روی شیفت ۲ داخل «وصول نسیه‌ی دوره‌ی قبل» می‌ماند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s194-prior-cheque-shift.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s194-cheque-shift-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { ChequeStatus } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}

const userId = seed.user('مدیر تست ۱۹۴ چک')
const cat = seed.category('پوشاک ۱۹۴')
const product = seed.product('شلوار ۱۹۴', cat)
const variant = seed.variant(product, 'آبی')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000000 WHERE id = ?').run(variant)
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 9 })
const today = toJalaliDate(new Date())
const HOUR = 3_600_000
const shift1 = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 4 * HOUR,
  closedAt: Date.now() - 2 * HOUR,
  userId
})
const shift2 = seed.insert('Shift', { name: 'عصر', number: 2, dayJalali: today, openedAt: Date.now() - HOUR, userId })

const inv = await salesService.create({
  userId,
  shiftId: shift2,
  lines: [{ variantId: variant, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
  payments: []
})
const y = Date.now() - 30 * HOUR
sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(y, toJalaliDate(new Date(y)), inv.id)

const now = Date.now()
seed.insert('Payment', {
  invoiceId: inv.id,
  methodId: cheque,
  amount: 1_000_000,
  seq: 1,
  kind: 'CHEQUE',
  chequeStatus: ChequeStatus.CLEARED,
  destination: 'MANAGER',
  paidAt: now,
  paidAtJalali: today,
  createdShiftId: shift1,
  createdByUserId: userId,
  clearedAt: now,
  clearedAtJalali: today,
  clearedShiftId: shift2,
  clearedByUserId: userId
})
sql.prepare('UPDATE "SaleInvoice" SET paidTotal = paidTotal + 1000000 WHERE id = ?').run(inv.id)

const amt = (acc, key) => Number(acc?.bridge?.rows?.find((r) => r.key === key)?.amount ?? 0)

const accAll = (await salesService.reportRows({ fromJalali: today, toJalali: today })).accounting
eq('بدون فیلتر: دریافتی حساب مدیر ۱M', amt(accAll, 'managerAccountReceived'), 1_000_000)
eq('بدون فیلتر: ردیف منفی فاکتور قبل ۱M', amt(accAll, 'priorManagerAccountReceived'), 1_000_000)
eq('بدون فیلتر: پل بسته', accAll?.bridge?.unexplained, 0)

const acc2 = (await salesService.reportRows({ fromJalali: today, toJalali: today, shiftId: shift2 })).accounting
eq('شیفت ۲ (پاس چک): دریافتی حساب مدیر ۱M', amt(acc2, 'managerAccountReceived'), 1_000_000)
eq('شیفت ۲: ردیف منفی فاکتور قبل ۱M (دیگر با created شیفت ۱ حذف نمی‌شود)', amt(acc2, 'priorManagerAccountReceived'), 1_000_000)
eq('شیفت ۲: پل بسته', acc2?.bridge?.unexplained, 0)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
