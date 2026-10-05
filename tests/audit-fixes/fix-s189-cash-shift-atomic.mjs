/**
 * نشست ۱۸۹ · اولویت ۱-۵ — بستن صندوق و بستن شیفت یک تراکنش‌اند؛
 * تجمیع عدد همان مجموعه فاکتور داخل تراکنش را می‌نویسد و retry خالی سند تازه نمی‌سازد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s189-cash-shift-atomic.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s189-cash-shift-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate, jalaliAddDays, jalaliStartOfDay } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const attempt = async (fn) => {
  try { return { value: await fn() } }
  catch (e) { return { error: String(e?.message ?? e) } }
}

const user = seed.user('کارمند ۱-۵')
const product = seed.product('کالای ۱-۵', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })

const sell = async (shiftId, amount = 1000) => {
  await salesService.create({
    userId: user,
    shiftId,
    lines: [{ variantId, qty: 1, unitPrice: amount, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount, destination: 'CASH' }]
  })
}

console.log('\n۱) بستن صندوق با closeShift شیفت را هم می‌بندد')
{
  const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now(), userId: user })
  await sell(shiftId, 1000)
  const closed = await cashboxService.close({
    shiftId,
    explicitShift: true,
    userId: user,
    openingFloat: 0,
    countedCash: 1000,
    closeShift: true
  })
  eq('سند صندوق ثبت شد', closed.session.id > 0, true)
  eq('shiftClosed = true', closed.shiftClosed, true)
  eq('شیفت closedAt دارد', sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(shiftId).closedAt != null, true)
  eq('Audit بستن صندوق', Number(sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ? AND entityId = ?').get('CASH_CLOSE', closed.session.id).n), 1)
  eq('Audit بستن شیفت', Number(sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ? AND entityId = ?').get('SHIFT_CLOSE', shiftId).n), 1)
}

console.log('\n۲) شکست Audit بستن شیفت، سند صندوق را هم برمی‌گرداند')
{
  const shiftId = seed.insert('Shift', { name: 'ظهر', number: 2, dayJalali: today, openedAt: Date.now(), userId: user })
  await sell(shiftId, 1000)
  const sessionsBefore = sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n
  sql.exec(`CREATE TRIGGER audit_fail_shift_close BEFORE INSERT ON "AuditLog" WHEN NEW.action = 'SHIFT_CLOSE' BEGIN SELECT RAISE(ABORT, 'audit down'); END`)
  const r = await attempt(() => cashboxService.close({
    shiftId,
    explicitShift: true,
    userId: user,
    openingFloat: 0,
    countedCash: 1000,
    closeShift: true
  }))
  sql.exec('DROP TRIGGER audit_fail_shift_close')
  eq('بستن خطا داد', !!r.error, true)
  eq('سند صندوق ساخته نشد', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, sessionsBefore)
  eq('شیفت باز ماند', sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(shiftId).closedAt, null)
}

console.log('\n۳) closeShift: false شیفت را باز می‌گذارد')
{
  const shiftId = seed.insert('Shift', { name: 'عصر', number: 3, dayJalali: today, openedAt: Date.now(), userId: user })
  await sell(shiftId, 1000)
  const closed = await cashboxService.close({
    shiftId,
    explicitShift: true,
    userId: user,
    openingFloat: 0,
    countedCash: 1000,
    closeShift: false
  })
  eq('صندوق بسته شد', closed.session.id > 0, true)
  eq('shiftClosed = false', closed.shiftClosed, false)
  eq('شیفت باز ماند', sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(shiftId).closedAt, null)
}

console.log('\n۴) تجمیع: عدد همان فاکتورها؛ retry سند خالی نمی‌سازد')
{
  const day = jalaliAddDays(today, -2)
  const open = sql.prepare('SELECT id FROM "Shift" WHERE closedAt IS NULL ORDER BY id DESC LIMIT 1').get()
  await sell(open.id, 2500)
  const inv = sql.prepare('SELECT id FROM "SaleInvoice" ORDER BY id DESC LIMIT 1').get()
  sql.prepare('UPDATE "SaleInvoice" SET issuedAtJalali = ?, issuedAt = ? WHERE id = ?').run(day, jalaliStartOfDay(day).getTime(), inv.id)
  const first = await cashboxService.finalize({ fromJalali: day, toJalali: day, dayJalali: day, userId: user })
  const row = sql.prepare('SELECT id, goodsTotal, grandTotal, invoiceCount FROM "Consolidation" WHERE id = ?').get(first.consolidation.id)
  eq('invoiceCount = ۱', first.invoiceCount, 1)
  eq('goodsTotal فاکتور زنده', Number(row.goodsTotal), 2500)
  eq('grandTotal فاکتور زنده', Number(row.grandTotal), 2500)
  const second = await cashboxService.finalize({ fromJalali: day, toJalali: day, dayJalali: day, userId: user })
  eq('retry همان id', second.consolidation.id, first.consolidation.id)
  eq('retryNoOp', second.retryNoOp, true)
  eq('یک سند تجمیع', Number(sql.prepare('SELECT COUNT(*) AS n FROM "Consolidation"').get().n), 1)
  eq('یک Audit تجمیع', Number(sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ?').get('CONSOLIDATE').n), 1)
}

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
