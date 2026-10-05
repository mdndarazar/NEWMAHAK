/**
 * نشست ۷۷ · خوشه A · بند ۴-۴۷
 *
 * اجرای دوم بستن صندوق باید اول هشدار بدهد. فقط با allowRepeatClose=true
 * snapshot مستقل مجاز است؛ موجودی اول و اثر خالص نقد/انبار نباید دوباره ثبت شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-fix-s77-cash-close-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

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

const user = seed.user('کارمند تکرار بستن صندوق')
const product = seed.product('کالای تست تکرار بستن', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now(),
  userId: user
})

await salesService.create({
  userId: user,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})

const first = await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, closeShift: false })
let rejected = false
try {
  await cashboxService.close({ shiftId, explicitShift: true, userId: user, openingFloat: 500, closeShift: false })
} catch (error) {
  rejected = String(error?.message ?? error).includes('قبلاً') && String(error?.message ?? error).includes('اثر خالص نقد')
}

eq('اجرای دوم بدون تأیید صریح رد می‌شود', rejected, true)
eq('هشدار، snapshot دومِ بدون تأیید نساخت', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 1)

const second = await cashboxService.close({
  shiftId,
  explicitShift: true,
  userId: user,
  openingFloat: 500,
  allowRepeatClose: true,
  closeShift: false
})

eq('بستن دوباره با تأیید snapshot مستقل می‌سازد', sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n, 2)
eq('موجودی اول فقط یک‌بار وارد دفتر نقد شده است', sql.prepare('SELECT COUNT(*) AS n FROM "CashMovement" WHERE type = ?').get('OPENING_FLOAT').n, 1)
eq('اثر خالص نقد در هر دو snapshot یکسان است', first.session.expectedCash, second.session.expectedCash)
eq('Audit هر دو snapshot را نگه داشته است', sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ?').get('CASH_CLOSE').n, 2)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
