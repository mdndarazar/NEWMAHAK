/**
 * ===========================================================================
 * نشست ۱۷۵ · خوشه D · S175-D2 — ابطال گزارش فروش (salesService.purge) با ۵۰۱+ فاکتور و سقف IN ۵۰۰
 *
 * پیش‌سنجش قفل دوره در purge دسته‌ای (۵۰۰تایی) بود، ولی خود تراکنش ابطال همه‌ی شناسه‌های بازه را
 * بی‌سقف در `in` می‌گذاشت: saleReturn.findMany (invoiceId in)، دفتر مصرف اعتبار (invoiceId in)،
 * اعتبارهای مرتبط (returnId/sourceInvoiceId/exchangeInvoiceId in)، و updateMany های اعتبار/برگشت/
 * پرداخت/فاکتور؛ در ابطال انتخابی هم `id in picked` و purgeStockPlan (id in invoiceIds). قاعده‌ی
 * پروژه (S99-2) سقف ۵۰۰ است. ابطال گزارش یک ماه شلوغ (۵۰۱+ فاکتور) همان مسیری است که انبوه
 * «اعتبار برگشت باطل‌شده» (S174-D5) می‌سازد.
 * انتظار: هیچ in/notIn بالای ۵۰۰؛ همه‌ی فاکتورها/پرداخت‌ها/برگشت‌ها باطل، اعتبارهای برگشت CANCELED،
 * همه‌ی مصرف‌های اعتبار برگشت‌خورده و usedAmount اعتبار مصرف‌شده به صفر برگشته؛ شمارش Audit درست.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s175-purge-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s175p-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
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
for (const model of ['saleInvoice', 'saleReturn', 'payment', 'storeCredit', 'storeCreditRedemption']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy', 'updateMany']) {
    if (typeof prisma[model][m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const user = seed.user('مدیر ۱۷۵')
const product = seed.product('پیراهن ۱۷۵', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: user })
const variant = seed.variant(product, 'M')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000 WHERE id = ?').run(variant)

const now = Date.now()
const insRet = sql.prepare('INSERT INTO "SaleReturn" (invoiceId, total, returnedAt, returnedAtJalali, userId, shiftId) VALUES (?,?,?,?,?,?)')
const insCredit = sql.prepare('INSERT INTO "StoreCredit" (code, amount, usedAmount, usedCount, maxUses, multiUse, status, source, sourceInvoiceId, returnId, userId, issuedAt, issuedAtJalali, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
const insRed = sql.prepare('INSERT INTO "StoreCreditRedemption" (creditId, code, amount, remainderAfter, seq, invoiceId, at, atJalali, atTime, userId, shiftId) VALUES (?,?,?,?,?,?,?,?,?,?,?)')

/** یک فاکتور واقعی + N کپی (همراه پرداخت) ⇒ N+1 فاکتور زنده‌ی امروز */
const makeBatch = async (N, tag) => {
  const inv = await salesService.create({ userId: user, shiftId, lines: [{ variantId: variant, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }] })
  const baseInv = seed.rows('SELECT * FROM "SaleInvoice" WHERE id = ?', inv.id)[0]
  const invCols = Object.keys(baseInv).filter((c) => c !== 'id' && c !== 'receiptNo')
  const insInv = sql.prepare(`INSERT INTO "SaleInvoice" (receiptNo, ${invCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${invCols.map((c) => `"${c}"`).join(',')} FROM "SaleInvoice" WHERE id = ?`)
  const basePay = seed.rows('SELECT * FROM "Payment" WHERE invoiceId = ?', inv.id)[0]
  const payCols = Object.keys(basePay).filter((c) => c !== 'id' && c !== 'invoiceId' && c !== 'idempotencyKey')
  const insPay = sql.prepare(`INSERT INTO "Payment" (invoiceId, ${payCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${payCols.map((c) => `"${c}"`).join(',')} FROM "Payment" WHERE id = ?`)
  const baseItem = seed.rows('SELECT * FROM "SaleInvoiceItem" WHERE invoiceId = ?', inv.id)[0]
  const itemCols = Object.keys(baseItem).filter((c) => c !== 'id' && c !== 'invoiceId')
  const insItem = sql.prepare(`INSERT INTO "SaleInvoiceItem" (invoiceId, ${itemCols.map((c) => `"${c}"`).join(',')}) SELECT ?, ${itemCols.map((c) => `"${c}"`).join(',')} FROM "SaleInvoiceItem" WHERE id = ?`)
  const maxReceipt = Number(seed.rows('SELECT MAX(receiptNo) AS m FROM "SaleInvoice"')[0].m)
  const ids = [inv.id]
  for (let i = 0; i < N; i++) {
    const id = Number(insInv.run(maxReceipt + 1 + i, inv.id).lastInsertRowid)
    insPay.run(id, basePay.id)
    insItem.run(id, baseItem.id)
    ids.push(id)
  }
  return ids
}

// ---------------------------------------------------------------------------
console.log('\n۱) ابطال بازه‌ی امروز با ۵۲۱ فاکتور، ۵۱۰ برگشت دارای اعتبار، ۵۱۰ مصرف اعتبار')
const ids1 = await makeBatch(520, 'R')
const NR = 510
for (let i = 0; i < NR; i++) {
  const rid = Number(insRet.run(ids1[i + 1], 1000, now - 30_000, today, user, shiftId).lastInsertRowid)
  // عمداً بدون sourceInvoiceId: تنها پیوند، returnId است (مسیر returnId in دسته‌ای باید خودش کامل باشد)
  insCredit.run(`S175P-R${i}`, 1000, 0, 0, 1, 0, 'ACTIVE', 'RETURN', null, rid, user, now - 30_000, today, now - 30_000, now)
}
// یک اعتبار چندبارمصرف بی‌پیوند (از دوره‌ی قبل) که روی ۵۱۰ فاکتور هر بار ۱۰۰ مصرف شده
const bigCredit = Number(insCredit.run('S175P-BIG', 1_000_000, NR * 100, NR, 1000, 1, 'PARTIALLY_USED', 'MANUAL', null, null, user, now - 86_400_000 * 40, today, now - 86_400_000 * 40, now).lastInsertRowid)
for (let i = 0; i < NR; i++) insRed.run(bigCredit, 'S175P-BIG', 100, 1_000_000 - (i + 1) * 100, i + 1, ids1[i + 1], now - 20_000, today, '10:00', user, shiftId)

maxIn = 0
let r1
try { r1 = await salesService.purge({ fromJalali: today, toJalali: today, restoreStock: false, userId: user }) } catch (e) { r1 = { error: String(e?.message ?? e) } }
eq('ابطال بی‌خطا', r1?.error ?? null, null)
const cnt = (q, ...a) => Number(seed.rows(q, ...a)[0].c)
eq('فاکتورهای باطل‌شده = ۵۲۱', cnt(`SELECT COUNT(*) c FROM "SaleInvoice" WHERE voidedAt IS NOT NULL AND status = 'CANCELED'`), ids1.length)
eq('پرداخت‌های باطل‌شده = ۵۲۱', cnt('SELECT COUNT(*) c FROM "Payment" WHERE voidedAt IS NOT NULL'), ids1.length)
eq('برگشت‌های باطل‌شده = ۵۱۰', cnt('SELECT COUNT(*) c FROM "SaleReturn" WHERE voidedAt IS NOT NULL'), NR)
eq('اعتبارهای برگشت CANCELED = ۵۱۰', cnt(`SELECT COUNT(*) c FROM "StoreCredit" WHERE code LIKE 'S175P-R%' AND status = 'CANCELED' AND voidedAt IS NOT NULL`), NR)
eq('مصرف‌های اعتبار برگشت‌خورده = ۵۱۰', cnt('SELECT COUNT(*) c FROM "StoreCreditRedemption" WHERE reversedAt IS NOT NULL'), NR)
eq('usedAmount اعتبار چندبارمصرف به ۰ برگشت', seed.rows('SELECT usedAmount u FROM "StoreCredit" WHERE id = ?', bigCredit)[0].u, 0)
eq('اعتبار چندبارمصرف خودش باطل نشد', seed.rows('SELECT voidedAt v FROM "StoreCredit" WHERE id = ?', bigCredit)[0].v, null)
const aud = seed.rows(`SELECT before FROM "AuditLog" WHERE action = 'VOID' AND entity = 'SaleInvoice' ORDER BY id DESC LIMIT 1`)[0]
const audBefore = aud ? JSON.parse(aud.before) : {}
eq('Audit: invoiceCount = ۵۲۱', audBefore.invoiceCount ?? null, ids1.length)
eq('Audit: returnCount = ۵۱۰', audBefore.returnCount ?? null, NR)
eq('هیچ in/notIn بالای ۵۰۰ نبود (بازه)', maxIn <= 500, true)

// ---------------------------------------------------------------------------
console.log('\n۲) ابطال انتخابی ۵۲۱ فاکتور (id in picked) با بازگشت موجودی')
const ids2 = await makeBatch(520, 'S')
const stockBefore = Number(seed.rows('SELECT stock s FROM "ProductVariant" WHERE id = ?', variant)[0].s)
maxIn = 0
let r2
try { r2 = await salesService.purge({ invoiceIds: ids2, restoreStock: true, userId: user }) } catch (e) { r2 = { error: String(e?.message ?? e) } }
eq('ابطال انتخابی بی‌خطا', r2?.error ?? null, null)
eq('فاکتورهای انتخابی باطل‌شده = ۵۲۱', cnt(`SELECT COUNT(*) c FROM "SaleInvoice" WHERE voidedAt IS NOT NULL AND id >= ?`, ids2[0]), ids2.length)
eq('پرداخت‌های انتخابی باطل‌شده = ۵۲۱', cnt('SELECT COUNT(*) c FROM "Payment" WHERE voidedAt IS NOT NULL AND invoiceId >= ?', ids2[0]), ids2.length)
eq('موجودی به اندازه‌ی ۵۲۱ قلم برگشت', Number(seed.rows('SELECT stock s FROM "ProductVariant" WHERE id = ?', variant)[0].s) - stockBefore, ids2.length)
eq('هیچ in/notIn بالای ۵۰۰ نبود (انتخابی)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
