/**
 * ===========================================================================
 * نشست ۲ زنجیره رفع — خوشه C (بخش اول): ارزش برگشت، ردیف تکراری، وضعیت فاکتور
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s57-returns.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s57-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { RefundMethod } = await import('@shared/enums')
const { DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${want}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${want}، دریافت ${got}`) }
}
const throwsWith = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}

const userId = seed.user('مدیر تست نشست ۵۷')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار جین', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: toJalaliDate(new Date()), openedAt: Date.now() - 3600_000, userId })
let vseq = 0
const variant = () => {
  const id = seed.variant(product, `سایز ${++vseq}`)
  sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000000 WHERE id = ?').run(id)
  return id
}
const itemsOf = (invoiceId) => seed.rows('SELECT id, qty, lineTotal FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invoiceId)
const retTotal = (id) => Number(seed.one('SELECT total FROM "SaleReturn" WHERE id = ?', id).total)
/**
 * نشست ۱۵۴ (S151-b) — فقط setup: از این نشست قیمت کمتر از salePrice کالا رمز مدیر
 * می‌خواهد (گیت قیمت دستی سمت سرور). موضوع این تست برگشت است نه قیمت دستی، پس
 * قیمت فروش کالا پیش از ثبت برابر unitPrice همان ردیف گذاشته می‌شود.
 */
const sale = (lines, extra = {}) => {
  for (const l of lines) seed.rows('UPDATE "ProductVariant" SET salePrice = ? WHERE id = ? RETURNING id', l.unitPrice, l.variantId)
  return salesService.create({ userId, shiftId, lines, ...extra })
}
const ret = (invoiceId, lines) =>
  salesService.createReturn({ invoiceId, full: false, lines, refundMethod: RefundMethod.NONE, confirmOverpay: true, userId })

console.log('\n— C1/الف — تخفیف کل فاکتور: دو کالای ۱٬۰۰۰٬۰۰۰ با ۱۰٪ تخفیف کل ⇒ برگشت یکی = ۹۰۰٬۰۰۰')
{
  const v1 = variant(); const v2 = variant()
  const inv = await sale(
    [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }, { variantId: v2, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    { invoiceDiscount: 200_000, payments: [{ methodId: cash, amount: 1_800_000 }] }
  )
  const it = itemsOf(inv.id)
  const r = await ret(inv.id, [{ saleItemId: it[0].id, qty: 1 }])
  eq('مبلغ سند برگشت', retTotal(r.id), 900_000)
  const r2 = await ret(inv.id, [{ saleItemId: it[1].id, qty: 1 }])
  eq('جمع دو برگشت = دقیقاً پرداختی مشتری', retTotal(r.id) + retTotal(r2.id), 1_800_000)
}

console.log('\n— C1/ب — تخفیف قلم (بند ۴-۱۷): ۱٬۰۰۰ منهای تخفیف ۱۰۰ ⇒ برگشت ۹۰۰')
{
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 1, unitPrice: 1_000, discount: 100, tax: 0 }], { payments: [{ methodId: cash, amount: 900 }] })
  const r = await ret(inv.id, [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }])
  eq('مبلغ سند برگشت', retTotal(r.id), 900)
}

console.log('\n— C1/ج — برگشت‌های جزئی پشت‌سرهم روی یک قلم ریالی گم/اضافه نمی‌کنند')
{
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 3, unitPrice: 1_000, discount: 0, tax: 0 }], { invoiceDiscount: 1, payments: [{ methodId: cash, amount: 2_999 }] })
  const id = itemsOf(inv.id)[0].id
  let sum = 0
  for (let i = 0; i < 3; i++) sum += retTotal((await ret(inv.id, [{ saleItemId: id, qty: 1 }])).id)
  eq('جمع سه برگشت یک‌عددی', sum, 2_999)
}

console.log('\n— C1/د — هزینه‌ی ارسال جزو ارزش کالای برگشتی نیست')
{
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }], { deliveryFee: 50_000, payments: [{ methodId: cash, amount: 550_000 }] })
  const r = await ret(inv.id, [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }])
  eq('مبلغ سند برگشت', retTotal(r.id), 500_000)
}

console.log('\n— C1/ه — ویرایش برگشت هم از snapshot حساب می‌کند (نه unitPrice×qty)')
{
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 2, unitPrice: 1_000_000, discount: 0, tax: 0 }], { invoiceDiscount: 200_000, payments: [{ methodId: cash, amount: 1_800_000 }] })
  const id = itemsOf(inv.id)[0].id
  const r = await ret(inv.id, [{ saleItemId: id, qty: 1 }])
  await salesService.returnUpdate({
    id: r.id,
    lines: [{ saleItemId: id, qty: 2 }],
    userId,
    overrideReason: 'تست نشست ۵۷',
    managerPassword: DEFAULT_MANAGER_PASSWORD
  })
  eq('مبلغ سند بعد از ویرایش به ۲ عدد', retTotal(r.id), 1_800_000)
}

console.log('\n— C5 — دو ردیف با یک saleItemId نباید سقف برگشت را دور بزنند')
{
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }], { payments: [{ methodId: cash, amount: 1_000 }] })
  const id = itemsOf(inv.id)[0].id
  await throwsWith('ثبت برگشت با ردیف تکراری', () => ret(inv.id, [{ saleItemId: id, qty: 1 }, { saleItemId: id, qty: 1 }]), 'قابل برگشت')
  const n = Number(seed.one('SELECT COALESCE(SUM(ri.qty),0) AS q FROM "SaleReturnItem" ri WHERE ri.saleItemId = ?', id).q)
  eq('تعداد برگشت‌خورده‌ی ثبت‌شده', n, 0)
  const v2 = variant()
  const inv2 = await sale([{ variantId: v2, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }], { payments: [{ methodId: cash, amount: 1_000 }] })
  const id2 = itemsOf(inv2.id)[0].id
  const r2 = await ret(inv2.id, [{ saleItemId: id2, qty: 1 }])
  await throwsWith(
    'ویرایش برگشت با ردیف تکراری',
    () => salesService.returnUpdate({
      id: r2.id,
      lines: [{ saleItemId: id2, qty: 1 }, { saleItemId: id2, qty: 1 }],
      userId,
      overrideReason: 'تست نشست ۵۷',
      managerPassword: DEFAULT_MANAGER_PASSWORD
    }),
    'قابل برگشت'
  )
}

console.log('\n— C7 — برگشت روی فاکتور لغوشده یا پیش‌نویس کاملاً ممنوع (بند ۴-۲۰)')
for (const status of ['CANCELED', 'DRAFT']) {
  const v = variant()
  const inv = await sale([{ variantId: v, qty: 1, unitPrice: 1_000, discount: 0, tax: 0 }], { payments: [{ methodId: cash, amount: 1_000 }] })
  sql.prepare('UPDATE "SaleInvoice" SET status = ? WHERE id = ?').run(status, inv.id)
  await throwsWith(`برگشت روی فاکتور ${status}`, () => ret(inv.id, [{ saleItemId: itemsOf(inv.id)[0].id, qty: 1 }]), 'برگشت')
  const n = Number(seed.one('SELECT COUNT(*) AS c FROM "SaleReturn" WHERE invoiceId = ?', inv.id).c)
  eq(`سند برگشت ساخته‌شده روی ${status}`, n, 0)
}

console.log('\n— C1/و — صفحه‌ی برگشت همان عددی را نشان می‌دهد که ثبت می‌شود')
{
  const v1 = variant(); const v2 = variant()
  const inv = await sale(
    [{ variantId: v1, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }, { variantId: v2, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    { invoiceDiscount: 200_000, payments: [{ methodId: cash, amount: 1_800_000 }] }
  )
  const look = await salesService.findByReturnCode(String(inv.receiptNo))
  const item = look.items[0]
  eq('ارزش خالص قلم در lookup', item.netLineValue, 900_000)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
