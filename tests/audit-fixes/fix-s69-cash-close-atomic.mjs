/**
 * نشست ۶۹ — بستن صندوق: retry مستقل، بدون دوباره‌ثبت موجودی اول.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s69-cash-close-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')

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

const user = seed.user('کارمند بستن صندوق')
const product = seed.product('کالای بستن صندوق', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now(), userId: user })
await salesService.create({
  userId: user,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})

const first = await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, closeShift: false })
const second = await cashboxService.close({
  shiftId,
  explicitShift: true,
  userId: user,
  openingFloat: 500,
  allowRepeatClose: true,
  closeShift: false
})

eq('بستن اول ثبت شد', first.session.id > 0, true)
eq('retry بستن سند مستقل ساخت', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 2)
eq('موجودی اول فقط یک‌بار ثبت شد', sql.prepare('SELECT COUNT(*) AS n FROM "CashMovement" WHERE type = ?').get('OPENING_FLOAT').n, 1)
eq('Audit هر دو بستن ثبت شد', sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ?').get('CASH_CLOSE').n, 2)
eq('انتظار نقد در هر snapshot یکسان است', first.session.expectedCash, second.session.expectedCash)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
