/**
 * نشست ۱۹۴ · M-10 / M-11 — تب اقلام: مبلغ برگشتی + خالص، و ردیف نارنجی برگشت بعدی.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s194-item-return-columns.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s194-items-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
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
const truthy = (label, v) => { if (v) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label}`) } }
const safe = async (label, fn) => {
  try { return await fn() } catch (e) {
    bad++; console.log(`  ✗ ${label} — ${String(e?.message ?? e).split('\n')[0]}`)
    return null
  }
}

const userId = seed.user('مدیر تست ۱۹۴ اقلام')
const cat = seed.category('پوشاک ۱۹۴ اقلام')
const product = seed.product('کت ۱۹۴', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = (price) => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = ? WHERE id = ?').run(price, id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)

console.log('\n۱) برگشت همین بازه: تعداد + مبلغ برگشتی + خالص')
{
  const a = variant(500_000)
  const b = variant(500_000)
  const inv = await safe('فروش دو قلم', () => salesService.create({
    userId, shiftId,
    lines: [
      { variantId: a, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 },
      { variantId: b, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }
    ],
    payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
  }))
  if (inv) {
    await safe('برگشت یک قلم', () => salesService.createReturn({
      invoiceId: inv.id, full: false,
      lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
      refundMethod: RefundMethod.CASH, refundAmount: 500_000, userId, shiftId
    }))
    const page = await salesService.reportItems({ fromJalali: today, toJalali: today })
    const rows = page.rows ?? page
    const ofInv = rows.filter((r) => r.invoiceId === inv.id)
    eq('دو ردیف قلم', ofInv.length, 2)
    const ret = ofInv.find((r) => r.returnedQty === 1)
    const keep = ofInv.find((r) => r.returnedQty === 0)
    eq('مبلغ برگشتی قلم برگشتی', ret?.returnedAmount, 500_000)
    eq('خالص قلم برگشتی', ret?.netAmount, 0)
    eq('قلم نمانده: مبلغ برگشتی ۰', keep?.returnedAmount, 0)
    eq('قلم نمانده: خالص = جمع', keep?.netAmount, 500_000)
    truthy('بدون یادآوری نارنجی در همین بازه', !ret?.laterReturnNote && !keep?.laterReturnNote)
  }
}

console.log('\n۲) فروش دیروز، برگشت امروز: گزارش دیروز عدد برگشتی ندارد، یادآوری نارنجی دارد')
{
  const a = variant(300_000)
  const inv = await safe('فروش دیروز', () => salesService.create({
    userId, shiftId,
    lines: [{ variantId: a, qty: 1, unitPrice: 300_000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 300_000, destination: 'CASH' }]
  }))
  if (inv) {
    const y = Date.now() - 30 * 3_600_000
    const yday = toJalaliDate(new Date(y))
    sql.prepare('UPDATE "SaleInvoice" SET issuedAt = ?, issuedAtJalali = ? WHERE id = ?').run(y, yday, inv.id)
    sql.prepare('UPDATE "Payment" SET paidAt = ?, paidAtJalali = ? WHERE invoiceId = ?').run(y, yday, inv.id)
    await safe('برگشت امروز', () => salesService.createReturn({
      invoiceId: inv.id, full: false,
      lines: [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }],
      refundMethod: RefundMethod.CASH, refundAmount: 300_000, userId, shiftId
    }))
    const yPage = await salesService.reportItems({ fromJalali: yday, toJalali: yday })
    const yRows = (yPage.rows ?? yPage).filter((r) => r.invoiceId === inv.id)
    eq('دیروز: تعداد برگشتی ۰ (عدد این بازه عوض نشد)', yRows[0]?.returnedQty, 0)
    eq('دیروز: مبلغ برگشتی ۰', yRows[0]?.returnedAmount, 0)
    eq('دیروز: خالص همان جمع فروش', yRows[0]?.netAmount, 300_000)
    truthy('دیروز: یادآوری نارنجی ماه امروز را می‌گوید', String(yRows[0]?.laterReturnNote ?? '').includes(today.slice(0, 7).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]) ) || String(yRows[0]?.laterReturnNote ?? '').includes('برگشت خورده'))
    const tPage = await salesService.reportItems({ fromJalali: today, toJalali: today })
    const tRows = (tPage.rows ?? tPage).filter((r) => r.invoiceId === inv.id)
    eq('امروز: فاکتور دیروز در اقلام امروز نیست', tRows.length, 0)
  }
}

console.log('\n۳) UI: سرستون و چاپ/اکسل ستون ریالی دارند')
{
  const ui = readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf-8')
  truthy('سرستون مبلغ برگشتی', ui.includes("'مبلغ برگشتی'"))
  truthy('سرستون خالص', ui.includes("'خالص'"))
  truthy('ردیف نارنجی laterReturnNote', ui.includes('laterReturnNote') && ui.includes('bg-orange-50'))
  truthy('چاپ A4 مبلغ برگشتی', ui.includes("headers: ['شماره فیش', 'تاریخ', 'ساعت', 'شیفت', 'کد', 'نام کالا', 'تعداد', 'قیمت واحد', 'تخفیف', 'جمع', 'برگشتی', 'مبلغ برگشتی', 'خالص']"))
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
