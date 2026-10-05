/**
 * ===========================================================================
 * نشست ۱۷۵ · خوشه D · S175-D3 — تجمیع صندوق (cashboxService.finalize) با ۵۰۱+ فاکتور و سقف IN ۵۰۰
 *
 * تراکنش تجمیع شناسه‌ی همه‌ی فاکتورهای تجمیع‌نشده‌ی بازه را بی‌سقف در
 * saleInvoice.updateMany (id in) و InventoryService.finalizePendingForInvoices (refId in)
 * می‌گذاشت؛ پیش‌نمایش pendingSummaryForInvoices هم همین‌طور. قاعده‌ی پروژه (S99-2) سقف ۵۰۰ است.
 * انتظار: هیچ in بالای ۵۰۰؛ همه‌ی ۵۲۱ فاکتور به همان سند تجمیع وصل، همه‌ی ۵۲۱ حرکت انبار FINAL،
 * شمارش‌های سند تجمیع درست؛ اجرای دوم (retry، S69) هیچ فاکتور/حرکتی را دوباره نگیرد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s175-consolidate-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s175c-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 240)}`) }
}

let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500 && !process.env.S175_NO_CAP) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['saleInvoice', 'payment', 'stockMovement', 'saleReturn']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy', 'updateMany']) {
    if (typeof prisma[model]?.[m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const user = seed.user('کارمند تجمیع ۱۷۵')
const product = seed.product('جین تجمیع ۱۷۵', seed.category('پوشاک'))
const variantId = seed.variant(product, '32')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: user })

const inv = await salesService.create({ userId: user, shiftId, lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const copyRow = (table, where, ...args) => seed.rows(`SELECT * FROM "${table}" WHERE ${where}`, ...args)[0]
const baseInv = copyRow('SaleInvoice', 'id = ?', inv.id)
const invCols = Object.keys(baseInv).filter((c) => c !== 'id' && c !== 'receiptNo')
const insInv = sql.prepare(`INSERT INTO "SaleInvoice" (receiptNo, ${invCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${invCols.map((c) => `"${c}"`).join(',')} FROM "SaleInvoice" WHERE id = ?`)
const basePay = copyRow('Payment', 'invoiceId = ?', inv.id)
const payCols = Object.keys(basePay).filter((c) => c !== 'id' && c !== 'invoiceId' && c !== 'idempotencyKey')
const insPay = sql.prepare(`INSERT INTO "Payment" (invoiceId, ${payCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${payCols.map((c) => `"${c}"`).join(',')} FROM "Payment" WHERE id = ?`)
const baseMov = copyRow('StockMovement', `refType = 'SaleInvoice' AND refId = ?`, inv.id)
if (!baseMov || baseMov.state !== 'PENDING') throw new Error('انتظار حرکت انبار PENDING برای فاکتور پایه')
const movCols = Object.keys(baseMov).filter((c) => c !== 'id' && c !== 'refId')
const insMov = sql.prepare(`INSERT INTO "StockMovement" (refId, ${movCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${movCols.map((c) => `"${c}"`).join(',')} FROM "StockMovement" WHERE id = ?`)
const maxReceipt = Number(seed.rows('SELECT MAX(receiptNo) AS m FROM "SaleInvoice"')[0].m)
const N = 521
for (let i = 0; i < N - 1; i++) {
  const id = Number(insInv.run(maxReceipt + 1 + i, inv.id).lastInsertRowid)
  insPay.run(id, basePay.id)
  insMov.run(id, baseMov.id)
}

console.log('\n۱) تجمیع امروز با ۵۲۱ فاکتور و ۵۲۱ حرکت انبار PENDING')
maxIn = 0
let first
try { first = await cashboxService.finalize({ fromJalali: today, toJalali: today, dayJalali: today, userId: user }) } catch (e) { first = { error: String(e?.message ?? e) } }
eq('تجمیع بی‌خطا', first?.error ?? null, null)
eq('invoiceCount = ۵۲۱', first?.invoiceCount ?? null, N)
eq('finalizedMovements = ۵۲۱', first?.finalizedMovements ?? null, N)
const cons = seed.rows('SELECT id, invoiceCount, movementCount FROM "Consolidation" ORDER BY id DESC LIMIT 1')[0]
eq('سند تجمیع: invoiceCount/movementCount', cons ? [cons.invoiceCount, cons.movementCount] : null, [N, N])
eq('همه‌ی فاکتورها به همین سند وصل‌اند', Number(seed.rows('SELECT COUNT(*) c FROM "SaleInvoice" WHERE consolidationId = ?', cons?.id ?? -1)[0].c), N)
eq('همه‌ی حرکت‌ها FINAL و به همین سند وصل', Number(seed.rows(`SELECT COUNT(*) c FROM "StockMovement" WHERE state = 'FINAL' AND consolidationId = ?`, cons?.id ?? -1)[0].c), N)
eq('هیچ in بالای ۵۰۰ نبود (تجمیع)', maxIn <= 500, true)

console.log('\n۲) اجرای دوم (retry) هیچ چیز را دوباره نمی‌گیرد')
maxIn = 0
let second
try { second = await cashboxService.finalize({ fromJalali: today, toJalali: today, dayJalali: today, userId: user }) } catch (e) { second = { error: String(e?.message ?? e) } }
eq('اجرای دوم بی‌خطا', second?.error ?? null, null)
eq('اجرای دوم: invoiceCount = ۰', second?.invoiceCount ?? null, 0)
eq('اجرای دوم: finalizedMovements = ۰', second?.finalizedMovements ?? null, 0)
eq('هیچ in بالای ۵۰۰ نبود (retry)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
