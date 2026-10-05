/**
 * ===========================================================================
 * نشست ۱۷۵ · خوشه D · S175-D4 — تب اعتبار خرید: صفحه‌ی «فقط دارای باقی‌مانده» و شماره فیش مرجع با سقف IN ۵۰۰
 *
 * storeCreditService.list با تیک «فقط دارای باقی‌مانده» شناسه‌های *کل صفحه* (take پیش‌فرض ۱٬۰۰۰، تا
 * ۵٬۰۰۰) را یکجا در `id in` می‌گذاشت؛ receiptNoMap هم شناسه‌ی همه‌ی فاکتورهای مرجع صفحه (تا ۳ برابر
 * ردیف‌ها) را یکجا در `saleInvoice id in`. قاعده‌ی پروژه (S99-2) سقف ۵۰۰ است ⇒ با ۵۰۱+ اعتبار در صفحه،
 * تب اعتبار با خطا می‌افتاد.
 * انتظار: هیچ in بالای ۵۰۰ روی storeCredit/saleInvoice؛ ۶۰۰ ردیف دارای باقی‌مانده، یکتا، با همان ترتیب
 * CREDIT_ORDER_BY.list؛ شماره فیش مرجع هر ردیف درست؛ اعتبار بی‌باقی‌مانده نیاید؛ صفحه‌بندی کامل.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s175-credit-list-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s175l-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)?.slice(0, 240)}، دریافت ${JSON.stringify(got)?.slice(0, 240)}`) }
}

let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500 && !process.env.S175_NO_CAP) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['storeCredit', 'saleInvoice']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy']) {
    if (typeof prisma[model]?.[m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const user = seed.user('مدیر اعتبار ۱۷۵')
const product = seed.product('کت ۱۷۵', seed.category('پوشاک'))
const variantId = seed.variant(product, 'XL')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: user })
const inv = await salesService.create({ userId: user, shiftId, lines: [{ variantId, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
const baseInv = seed.rows('SELECT * FROM "SaleInvoice" WHERE id = ?', inv.id)[0]
const invCols = Object.keys(baseInv).filter((c) => c !== 'id' && c !== 'receiptNo')
const insInv = sql.prepare(`INSERT INTO "SaleInvoice" (receiptNo, ${invCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${invCols.map((c) => `"${c}"`).join(',')} FROM "SaleInvoice" WHERE id = ?`)
const maxReceipt = Number(seed.rows('SELECT MAX(receiptNo) AS m FROM "SaleInvoice"')[0].m)

const now = Date.now()
const insCredit = sql.prepare('INSERT INTO "StoreCredit" (code, amount, usedAmount, usedCount, status, source, sourceInvoiceId, userId, issuedAt, issuedAtJalali, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
const NR = 600
const receiptOf = new Map()
for (let i = 0; i < NR; i++) {
  const rn = maxReceipt + 1 + i
  const invId = Number(insInv.run(rn, inv.id).lastInsertRowid)
  const cid = Number(insCredit.run(`S175L${String(i).padStart(4, '0')}`, 1000, 100, 1, 'PARTIALLY_USED', 'MANUAL', invId, user, now - 60_000 + i, today, now - 60_000 + i, now).lastInsertRowid)
  receiptOf.set(cid, rn)
}
// ۵۰ اعتبار کاملاً مصرف‌شده (بدون باقی‌مانده) لابه‌لای همان بازه
for (let i = 0; i < 50; i++) insCredit.run(`S175U${i}`, 1000, 1000, 1, 'USED', 'MANUAL', null, user, now - 60_000 + i * 7, today, now - 60_000 + i * 7, now)

console.log('\n۱) «فقط دارای باقی‌مانده» با take پیش‌فرض (۱٬۰۰۰)')
maxIn = 0
let page
try { page = await storeCreditService.list({ fromJalali: today, toJalali: today, onlyWithRemaining: true }) } catch (e) { page = { error: String(e?.message ?? e) } }
const rows = Array.isArray(page) ? page : page?.rows ?? page
eq('بی‌خطا', page?.error ?? null, null)
eq('تعداد ردیف = ۶۰۰', Array.isArray(rows) ? rows.length : null, NR)
eq('totalCount = ۶۰۰', page?.page?.totalCount ?? null, NR)
const ids = Array.isArray(rows) ? rows.map((r) => r.id) : []
eq('یکتا', new Set(ids).size, ids.length)
eq('هیچ اعتبار بی‌باقی‌مانده نیامد', Array.isArray(rows) && rows.some((r) => String(r.code).startsWith('S175U')), false)
eq('شماره فیش مرجع همه‌ی ردیف‌ها درست', Array.isArray(rows) && rows.every((r) => r.sourceReceiptNo === receiptOf.get(r.id)), true)
// ترتیب مرجع: همان CREDIT_ORDER_BY.list از SQLite خام (بدون سرویس)
const { CREDIT_ORDER_BY } = await import('@shared/credit')
const ref = (await (async () => {
  const all = await db.storeCredit.findMany({ where: { issuedAtJalali: today }, orderBy: CREDIT_ORDER_BY.list, select: { id: true, amount: true, usedAmount: true } })
  return all.filter((r) => Number(r.amount) > Number(r.usedAmount)).map((r) => r.id)
})())
eq('ترتیب = CREDIT_ORDER_BY.list', ids, ref)
eq('هیچ in بالای ۵۰۰ نبود (صفحه‌ی باقی‌مانده‌دار)', maxIn <= 500, true)

console.log('\n۲) فهرست عادی با take=۵۰۰۰ (۶۵۰ ردیف ⇒ ۶۰۰ فاکتور مرجع)')
maxIn = 0
let p2
try { p2 = await storeCreditService.list({ fromJalali: today, toJalali: today, take: 5000 }) } catch (e) { p2 = { error: String(e?.message ?? e) } }
const rows2 = Array.isArray(p2) ? p2 : p2?.rows ?? p2
eq('بی‌خطا', p2?.error ?? null, null)
eq('تعداد ردیف = ۶۵۰', Array.isArray(rows2) ? rows2.length : null, NR + 50)
eq('شماره فیش مرجع ۶۰۰ ردیف درست', Array.isArray(rows2) && rows2.filter((r) => receiptOf.has(r.id)).every((r) => r.sourceReceiptNo === receiptOf.get(r.id)), true)
eq('هیچ in بالای ۵۰۰ نبود (فهرست عادی)', maxIn <= 500, true)

console.log('\n۳) صفحه‌بندی «فقط دارای باقی‌مانده» (take=۲۵۰)')
maxIn = 0
const seen = []
for (let skip = 0; skip < NR; skip += 250) {
  let p
  try { p = await storeCreditService.list({ fromJalali: today, toJalali: today, onlyWithRemaining: true, take: 250, skip }) } catch (e) { p = { error: String(e?.message ?? e) } }
  const rr = Array.isArray(p) ? p : p?.rows ?? []
  seen.push(...(Array.isArray(rr) ? rr.map((r) => r.id) : []))
}
eq('صفحه‌ها کامل و به همان ترتیب', seen, ref)
eq('هیچ in بالای ۵۰۰ نبود (صفحه‌بندی)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
