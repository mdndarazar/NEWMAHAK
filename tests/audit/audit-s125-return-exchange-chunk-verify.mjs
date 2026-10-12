/**
 * ممیزی نشست ۱۲۵ (S125-1) — تأیید رفتاری اثر مالی chunk واریانت در مسیرهای برگشت/تعویض
 * (fix-s125 فقط findByReturnCode را رفتاری می‌سنجید و بقیه را با regex):
 *   • createExchange با ۵۰۱ کالای جایگزین (قلم ۵۰۱ قیمت ۷٬۷۷۷): exchangeTotal/diff دقیق، ۵۰۱ قلم سند، کسر موجودی قلم ۵۰۱
 *   • شناسه‌ی ناموجود وسط ۵۰۱ جایگزین همچنان با پیام هدف رد می‌شود و هیچ اثری نمی‌ماند
 *   • createReturn کامل روی فاکتور ۵۰۱ قلمی: جمع برگشت دقیق، ۵۰۱ ردیف برگشت، موجودی قلم ۵۰۱ برمی‌گردد
 *   • returnUpdate از ۱ قلم به ۵۰۱ قلم و سپس فقط قلم ۵۰۱: جمع و موجودی دقیق
 *   • هیچ `in` بیش از ۵۰۰ در هیچ findMany/deleteMany/updateMany/count
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s125-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const RETURN_UPDATE_GATE = {
  managerPassword: PW,
  overrideReason: 'اصلاح کنترل‌شدهٔ حجم برگشتی برای آزمون chunk'
}
const { toJalaliDate } = await import(join(root, 'src/shared/jalali.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db

let maxIn = 0; const overs = []
const scan = (o, model, op) => {
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o)) { for (const x of o) scan(x, model, op); return }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'in' && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) { overs.push(`${model}.${op}:${v.length}`); throw new Error(`HARNESS: IN > 500 در ${model}.${op}`) } }
    else scan(v, model, op)
  }
}
for (const model of Object.keys(db)) {
  const m = db[model]
  if (!m || typeof m !== 'object' || model.startsWith('$')) continue
  for (const op of ['findMany', 'deleteMany', 'updateMany', 'count', 'aggregate', 'groupBy', 'findFirst']) {
    if (typeof m[op] !== 'function') continue
    const orig = m[op].bind(m)
    m[op] = async (args = {}) => { scan(args?.where, model, op); return orig(args) }
  }
}
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }

const userId = seed.user('مدیر تست ۱۲۵')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const product = seed.product('تی‌شرت', seed.category('پوشاک'))
const mkVariants = (n, prefix, priceOf) => {
  const ids = []
  sql.exec('BEGIN')
  for (let i = 0; i < n; i++) {
    const id = seed.variant(product, `${prefix}${i + 1}`)
    sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = ? WHERE id = ?').run(priceOf(i), id)
    ids.push(id)
  }
  sql.exec('COMMIT')
  return ids
}
const stockOf = (id) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id).stock)
const priceOf = (i) => (i === 500 ? 7777 : 1000)
const SUM501 = 500 * 1000 + 7777

console.log('\n— ۱) createExchange با ۵۰۱ کالای جایگزین')
{
  const [orig] = mkVariants(1, 'O', () => 100000)
  const sale = await salesService.create({ userId, shiftId, lines: [{ variantId: orig, qty: 1, unitPrice: 100000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 100000, destination: 'CASH' }] })
  const reps = mkVariants(501, 'R', priceOf)
  const itemId = seed.one('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ?', sale.id).id
  // شناسه‌ی ناموجود وسط ۵۰۱ جایگزین ⇒ رد با پیام هدف، بی‌اثر
  const bogus = await safe(() => salesService.createExchange({ invoiceId: sale.id, lines: [{ saleItemId: itemId, qty: 1 }], replacements: [...reps.slice(0, 500).map((variantId) => ({ variantId, qty: 1 })), { variantId: 99999999, qty: 1 }], userId, shiftId }))
  eq('شناسه‌ی ناموجود: رد با پیام «کالاهای جایگزین» پیدا نشد', /کالاهای جایگزین» در انبار پیدا نشد/.test(bogus?.__error ?? ''), true)
  eq('شناسه‌ی ناموجود: هیچ سند برگشتی نماند', seed.count('SaleReturn', 'invoiceId = ?', sale.id), 0)
  eq('شناسه‌ی ناموجود: موجودی قلم ۱ دست‌نخورده', stockOf(reps[0]), 10)
  const r = await safe(() => salesService.createExchange({ invoiceId: sale.id, lines: [{ saleItemId: itemId, qty: 1 }], replacements: reps.map((variantId) => ({ variantId, qty: 1 })), userId, shiftId }))
  eq('تعویض بدون خطا', r?.__error ?? null, null)
  eq('returnTotal = ۱۰۰٬۰۰۰', r?.returnTotal, 100000)
  eq('exchangeTotal = ۵۰۷٬۷۷۷ (قیمت قلم ۵۰۱ لحاظ شده)', r?.exchangeTotal, SUM501)
  eq('diff = ۴۰۷٬۷۷۷', r?.diff, SUM501 - 100000)
  const exId = r?.exchangeInvoiceId
  eq('سند تعویض ۵۰۱ قلم دارد', exId ? seed.count('SaleInvoiceItem', 'invoiceId = ?', exId) : null, 501)
  eq('جمع lineTotal سند تعویض = ۵۰۷٬۷۷۷', exId ? Number(seed.one('SELECT SUM(lineTotal) s FROM "SaleInvoiceItem" WHERE invoiceId = ?', exId).s) : null, SUM501)
  eq('قلم ۵۰۱ سند تعویض lineTotal ۷٬۷۷۷', exId ? Number(seed.one('SELECT lineTotal FROM "SaleInvoiceItem" WHERE invoiceId = ? AND variantId = ?', exId, reps[500])?.lineTotal) : null, 7777)
  eq('grandTotal سند تعویض = ۵۰۷٬۷۷۷', exId ? Number(seed.one('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?', exId).grandTotal) : null, SUM501)
  eq('موجودی قلم ۵۰۱ جایگزین ۱۰ ⇒ ۹', stockOf(reps[500]), 9)
  eq('موجودی قلم ۱ جایگزین ۱۰ ⇒ ۹', stockOf(reps[0]), 9)
}

console.log('\n— ۲) createReturn کامل روی فاکتور ۵۰۱ قلمی (نسیه)')
let sale2, vids2
{
  vids2 = mkVariants(501, 'S', priceOf)
  sale2 = await salesService.create({ userId, shiftId, lines: vids2.map((variantId, i) => ({ variantId, qty: 1, unitPrice: priceOf(i), discount: 0, tax: 0 })), payments: [] })
  eq('فاکتور ۵۰۱ قلمی ساخته شد', seed.count('SaleInvoiceItem', 'invoiceId = ?', sale2.id), 501)
  eq('موجودی قلم ۵۰۱ بعد از فروش ۹', stockOf(vids2[500]), 9)
  const r = await safe(() => salesService.createReturn({ invoiceId: sale2.id, full: true, lines: [], refundMethod: 'NONE', userId }))
  eq('برگشت کامل بدون خطا', r?.__error ?? null, null)
  const ret = seed.one('SELECT id, total FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', sale2.id)
  eq('جمع برگشت = ۵۰۷٬۷۷۷', Number(ret?.total), SUM501)
  eq('۵۰۱ ردیف برگشت', ret ? seed.count('SaleReturnItem', 'returnId = ?', ret.id) : null, 501)
  eq('ردیف برگشت قلم ۵۰۱ = ۷٬۷۷۷', ret ? Number(seed.one('SELECT lineTotal FROM "SaleReturnItem" WHERE returnId = ? AND variantId = ?', ret.id, vids2[500])?.lineTotal) : null, 7777)
  eq('موجودی قلم ۵۰۱ به ۱۰ برگشت', stockOf(vids2[500]), 10)
}

console.log('\n— ۳) returnUpdate از ۱ قلم به ۵۰۱ قلم و سپس فقط قلم ۵۰۱')
{
  const vids = mkVariants(501, 'U', priceOf)
  const sale = await salesService.create({ userId, shiftId, lines: vids.map((variantId, i) => ({ variantId, qty: 1, unitPrice: priceOf(i), discount: 0, tax: 0 })), payments: [] })
  const items = seed.rows('SELECT id, variantId FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', sale.id)
  const byVar = new Map(items.map((it) => [it.variantId, it.id]))
  const r0 = await safe(() => salesService.createReturn({ invoiceId: sale.id, full: false, lines: [{ saleItemId: byVar.get(vids[0]), qty: 1 }], refundMethod: 'NONE', userId }))
  eq('برگشت یک‌قلمی بدون خطا', r0?.__error ?? null, null)
  const ret = seed.one('SELECT id, total FROM "SaleReturn" WHERE invoiceId = ?', sale.id)
  eq('جمع برگشت یک‌قلمی = ۱٬۰۰۰', Number(ret?.total), 1000)
  const u1 = await safe(() => salesService.returnUpdate({
    id: ret.id,
    lines: items.map((it) => ({ saleItemId: it.id, qty: 1 })),
    userId,
    ...RETURN_UPDATE_GATE
  }))
  eq('ویرایش به ۵۰۱ قلم بدون خطا', u1?.__error ?? null, null)
  eq('جمع برگشت بعد از ویرایش = ۵۰۷٬۷۷۷', Number(seed.one('SELECT total FROM "SaleReturn" WHERE id = ?', ret.id).total), SUM501)
  eq('۵۰۱ ردیف برگشت بعد از ویرایش', seed.count('SaleReturnItem', 'returnId = ?', ret.id), 501)
  eq('موجودی قلم ۵۰۱ بعد از ویرایش ۹ ⇒ ۱۰', stockOf(vids[500]), 10)
  const u2 = await safe(() => salesService.returnUpdate({
    id: ret.id,
    lines: items.map((it) => ({ saleItemId: it.id, qty: it.variantId === vids[500] ? 1 : 0 })),
    userId,
    ...RETURN_UPDATE_GATE
  }))
  eq('ویرایش به فقط قلم ۵۰۱ بدون خطا', u2?.__error ?? null, null)
  eq('جمع برگشت = ۷٬۷۷۷', Number(seed.one('SELECT total FROM "SaleReturn" WHERE id = ?', ret.id).total), 7777)
  eq('فقط یک ردیف برگشت (قلم ۵۰۱) با تعداد مثبت', seed.count('SaleReturnItem', 'returnId = ? AND qty > 0', ret.id), 1)
  eq('موجودی قلم ۱ دوباره کسر شد ۱۰ ⇒ ۹', stockOf(vids[0]), 9)
  eq('موجودی قلم ۵۰۱ همچنان ۱۰', stockOf(vids[500]), 10)
}
eq('هیچ IN بیش از ۵۰۰', overs, [])
console.log(`  (بیشترین IN دیده‌شده: ${maxIn})`)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
