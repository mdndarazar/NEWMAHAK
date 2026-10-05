/**
 * نشست ۶۹ / ۱۸۹ · ۱-۵ — تجمیع idempotent در retry/double-click.
 *
 * اجرای دوم همان سند اول را برمی‌گرداند (سند خالی تازه و Audit جدا نیست)،
 * چون فاکتور و حرکت انبار قبلاً به تجمیع اول وصل شده‌اند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s69-consolidation-'))
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

const user = seed.user('کارمند retry تجمیع')
const product = seed.product('کالای retry تجمیع', seed.category('پوشاک'))
const variantId = seed.variant(product, 'سایز تست')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now(), userId: user })

await salesService.create({
  userId: user,
  shiftId,
  lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: []
})

const first = await cashboxService.finalize({ fromJalali: today, toJalali: today, dayJalali: today, userId: user })
const second = await cashboxService.finalize({ fromJalali: today, toJalali: today, dayJalali: today, userId: user })

eq('تجمیع اول حرکت انبار را قطعی کرده است', first.finalizedMovements, 1)
eq('اجرای دوم سند خالی تازه نساخته است', sql.prepare('SELECT COUNT(*) AS n FROM "Consolidation"').get().n, 1)
eq('اجرای دوم همان سند اول را برگرداند', second.consolidation.id, first.consolidation.id)
eq('تجمیع دوم فاکتور تازه‌ای دوباره نگرفته است', second.invoiceCount, 0)
eq('تجمیع دوم حرکت انبار را دوباره قطعی نکرده است', second.finalizedMovements, 0)
eq('فقط یک حرکت انبار نهایی وجود دارد', sql.prepare('SELECT COUNT(*) AS n FROM "StockMovement" WHERE state = ?').get('FINAL').n, 1)
eq('Audit تجمیع فقط برای سند واقعی است', sql.prepare('SELECT COUNT(*) AS n FROM "AuditLog" WHERE action = ?').get('CONSOLIDATE').n, 1)

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
