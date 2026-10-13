/**
 * نشست ۲۰۱ — رمز ویرایش برگشتِ اثر‌دار بیرون از تراکنش سنجیده می‌شود.
 * شمارنده‌ی رمز اشتباه با rollback پاک نمی‌شود (ضد brute-force).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s201-return-update-password-outside-tx.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s201-return-pw-'))
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
const rejects = async (label, fn, needle) => {
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
const failCount = () =>
  Number(sql.prepare(`SELECT failCount FROM "AuthLockout" WHERE gate LIKE '%sales-return%'`).get()?.failCount ?? 0)

console.log('\n۰) سیم‌کشی منبع')
const svc = readFileSync(new URL('../../src/main/services/SalesService.ts', import.meta.url), 'utf8')
const start = svc.indexOf('async returnUpdate(input: UpdateReturnInput)')
const txAt = svc.indexOf('prisma.$transaction', start)
const body = start >= 0 && txAt > start ? svc.slice(start, txAt) : ''
const afterTx = txAt > 0 ? svc.slice(txAt, svc.indexOf('async returnDelete', txAt)) : ''
truthy('گیت پنل برگشت قبل از تراکنش است', /assertPanelPassword\(\s*PANEL_KEYS\.salesReturn/.test(body))
truthy('داخل تراکنش assertPanelPassword نیست', !/assertPanelPassword\(/.test(afterTx))
const modal = readFileSync(new URL('../../src/renderer/src/components/ReturnEditModal.tsx', import.meta.url), 'utf8')
truthy('مودال ویرایش رمز را می‌فرستد', /managerPassword: editPw/.test(modal))
truthy('مودال ویرایش دلیل را می‌فرستد', /overrideReason: editReason/.test(modal))

const userId = seed.user('فروشنده برگشت ۲۰۱')
const product = seed.product('کالای برگشت ۲۰۱', seed.category('پوشاک'))
const v1 = seed.variant(product, 'الف')
const v2 = seed.variant(product, 'ب')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 600 WHERE id = ?').run(v1)
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 400 WHERE id = ?').run(v2)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })

const sale = await salesService.create({
  userId,
  shiftId,
  lines: [
    { variantId: v1, qty: 1, unitPrice: 600, discount: 0, tax: 0 },
    { variantId: v2, qty: 1, unitPrice: 400, discount: 0, tax: 0 }
  ],
  payments: []
})
const items = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', sale.id)
const ret = await salesService.createReturn({
  invoiceId: sale.id,
  full: false,
  lines: [{ saleItemId: items[0].id, qty: 1 }],
  refundMethod: 'NONE',
  userId
})
const retId = ret.id ?? ret.returnId
const qtyOf = () =>
  Number(sql.prepare('SELECT COALESCE(SUM(qty),0) AS q FROM "SaleReturnItem" WHERE returnId = ?').get(retId)?.q ?? -1)

console.log('\n۱) بدون دلیل / بدون رمز / رمز غلط')
eq('تعداد برگشتی اول ۱ است', qtyOf(), 1)
await rejects(
  'بدون دلیل رد می‌شود',
  () => salesService.returnUpdate({
    id: retId,
    lines: [{ saleItemId: items[0].id, qty: 1 }, { saleItemId: items[1].id, qty: 1 }],
    userId,
    /** قفل پیش‌فرض اصلاح را می‌گذراند تا خودِ قاعده‌ی دلیلِ اثر مالی سنجیده شود. */
    panelPassword: PW
  }),
  'دلیل'
)
eq('بدون دلیل اقلام عوض نشد', qtyOf(), 1)

const fails0 = failCount()
await rejects(
  'با دلیل و بدون رمز رد می‌شود',
  () => salesService.returnUpdate({
    id: retId,
    lines: [{ saleItemId: items[0].id, qty: 1 }, { saleItemId: items[1].id, qty: 1 }],
    userId,
    overrideReason: 'اصلاح تست ۲۰۱'
  }),
  'رمز'
)
eq('بدون رمز اقلام عوض نشد', qtyOf(), 1)

await rejects(
  'رمز غلط رد می‌شود',
  () => salesService.returnUpdate({
    id: retId,
    lines: [{ saleItemId: items[0].id, qty: 1 }, { saleItemId: items[1].id, qty: 1 }],
    userId,
    managerPassword: '0000',
    overrideReason: 'اصلاح تست ۲۰۱'
  }),
  'رمز'
)
eq('شمارنده‌ی رمز اشتباه با rollback پاک نشد', failCount(), fails0 + 1)
eq('با رمز غلط اقلام عوض نشد', qtyOf(), 1)

console.log('\n۲) با رمز مدیر')
await salesService.returnUpdate({
  id: retId,
  lines: [{ saleItemId: items[0].id, qty: 1 }, { saleItemId: items[1].id, qty: 1 }],
  userId,
  managerPassword: PW,
  overrideReason: 'اصلاح تست ۲۰۱'
})
eq('با رمز، هر دو قلم برگشت شد', qtyOf(), 2)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
