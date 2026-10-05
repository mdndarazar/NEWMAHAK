/**
 * ممیزی نشست ۱۲۶ (S126-1/S126-2) — تأیید رفتاری (fix-s126 فقط regex بود):
 *   • creditRemaining (ردیف «نسیه‌ی وصول‌نشده» پل): اسکن صفحه‌ای ۵٬۰۰۰تایی بدون سقف؛ ۵٬۰۰۱ فاکتور تسویه‌نشده
 *     کامل شمرده می‌شوند، فاکتور بیش‌ازحد برگشت‌خورده بدهی منفی تزریق نمی‌کند، هیچ IN بیش از ۵۰۰.
 *   • variantPurgeService.purge: مهلت ۷۳۰ روز (۷۲۹ روز/بدون deletedAt رد)، وجود حرکت انبار رد و بی‌اثر،
 *     ۷۳۱ روز بدون حرکت ⇒ حذف با snapshot نام/کد در ردیف فروش؛ دفتر گردش هرگز حذف نمی‌شود.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s126-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { saleWhere } = await import(join(root, 'src/main/services/SalesService.ts'))
const { buildStatements } = await import(join(root, 'src/main/services/accountingReport.ts'))
const { variantPurgeService } = await import(join(root, 'src/main/services/VariantPurgeService.ts'))
const { toJalaliDate, jalaliStartOfDay, jalaliEndOfDay } = await import(join(root, 'src/shared/jalali.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
let maxIn = 0; const overs = []
const scan = (o, where) => {
  if (!o || typeof o !== 'object') return
  if (Array.isArray(o)) { for (const x of o) scan(x, where); return }
  for (const [k, v] of Object.entries(o)) {
    if (k === 'in' && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500) { overs.push(`${where}:${v.length}`); throw new Error(`HARNESS: IN > 500 در ${where}`) } }
    else scan(v, where)
  }
}
for (const model of Object.keys(db)) {
  const m = db[model]; if (!m || typeof m !== 'object' || model.startsWith('$')) continue
  for (const op of ['findMany', 'deleteMany', 'updateMany', 'count', 'aggregate', 'groupBy', 'findFirst']) {
    if (typeof m[op] !== 'function') continue
    const orig = m[op].bind(m); m[op] = async (args = {}) => { scan(args?.where, `${model}.${op}`); return orig(args) }
  }
}
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }
const today = toJalaliDate(new Date())
const now = Date.now()

console.log('\n— ۱) نسیه‌ی وصول‌نشده‌ی پل با ۵٬۰۰۱ فاکتور تسویه‌نشده')
{
  sql.exec('BEGIN')
  const ins = sql.prepare('INSERT INTO "SaleInvoice" (receiptNo, status, grandTotal, paidTotal, goodsTotal, issuedAt, issuedAtJalali) VALUES (?, ?, ?, 0, ?, ?, ?)')
  for (let i = 0; i < 5001; i++) ins.run(100000 + i, 'FINAL', i === 5000 ? 7777 : 1000, i === 5000 ? 7777 : 1000, now, today)
  sql.exec('COMMIT')
  // فاکتور بیش‌ازحد برگشت‌خورده: ۱٬۰۰۰ با برگشت ۵٬۰۰۰ ⇒ بدهی صفر، نه منفی
  const over = seed.insert('SaleInvoice', { receiptNo: 900001, status: 'FINAL', grandTotal: 1000, paidTotal: 0, goodsTotal: 1000, issuedAt: now, issuedAtJalali: today })
  seed.insert('SaleReturn', { invoiceId: over, kind: 'RETURN', total: 5000, returnedAt: now, returnedAtJalali: today })
  const filter = { fromJalali: today, toJalali: today }
  const res = await safe(() => buildStatements({ where: saleWhere(filter), from: jalaliStartOfDay(today), to: jalaliEndOfDay(today), period: { fromJalali: today, toJalali: today, source: 'explicit' }, filter }))
  eq('بدون خطا', res?.__error ?? null, null)
  const row = res?.statements?.bridge?.rows?.find((r) => r.key === 'uncollectedCredit')
  eq('نسیه‌ی وصول‌نشده = ۵٬۰۰۰×۱٬۰۰۰ + ۷٬۷۷۷ (فاکتور ۵٬۰۰۱ام در صفحه‌ی دوم شمرده شد، فاکتور بیش‌برگشت ۰)', row?.amount, 5000 * 1000 + 7777)
  eq('هیچ هشدار سقف اسکن بدهی', (res?.warnings ?? []).some((w) => /باقی‌ماندهٔ بدهی/.test(w)), false)
}

console.log('\n— ۲) حذف همیشگی کالا: مهلت ۷۳۰ روز و دفتر گردش')
{
  const DAY = 86400000
  seed.setting('panel.locks', { products: false }) // گیت رمز نشست ۱۴۶ جدا در fix-s145 سنجیده می‌شود
  const p = seed.product('جین', seed.category('پوشاک'))
  const mk = (size, deletedAt) => { const id = seed.variant(p, size); sql.prepare('UPDATE "ProductVariant" SET isActive = 0, deletedAt = ? WHERE id = ?').run(deletedAt, id); return id }
  const v729 = mk('۷۲۹', now - 729 * DAY)
  const vNull = mk('بی‌تاریخ', null)
  const vMove = mk('با حرکت', now - 800 * DAY)
  const vOk = mk('قدیمی', now - 731 * DAY)
  seed.insert('StockMovement', { variantId: vMove, delta: -1, reason: 'SALE', createdAt: now - 900 * DAY })
  const inv = seed.invoice({ grandTotal: 500 })
  seed.invoiceItem(inv.id, { variantId: vOk, qty: 1, lineTotal: 500, variantName: null })
  const code = seed.one('SELECT code FROM "ProductVariant" WHERE id = ?', vOk).code
  const r1 = await safe(() => variantPurgeService.purge({ variantIds: [v729] }))
  eq('۷۲۹ روز: رد با پیام مهلت', /روز کامل در سطل آشغال نمانده/.test(r1?.__error ?? ''), true)
  const r2 = await safe(() => variantPurgeService.purge({ variantIds: [vNull] }))
  eq('بدون deletedAt: رد با پیام مهلت', /روز کامل در سطل آشغال نمانده/.test(r2?.__error ?? ''), true)
  const r3 = await safe(() => variantPurgeService.purge({ variantIds: [vOk, v729] }))
  eq('دسته‌ی مخلوط (۷۳۱ + ۷۲۹): کل دسته رد', /روز کامل در سطل آشغال نمانده/.test(r3?.__error ?? ''), true)
  eq('دسته‌ی مخلوط: کالای ۷۳۱ روزه هم نماند حذف‌نشده', seed.count('ProductVariant', 'id = ?', vOk), 1)
  const r4 = await safe(() => variantPurgeService.purge({ variantIds: [vMove] }))
  eq('دارای حرکت انبار: رد با پیام دفتر گردش', /حرکت در دفتر گردش انبار/.test(r4?.__error ?? ''), true)
  eq('دارای حرکت انبار: کالا و حرکت دست‌نخورده', [seed.count('ProductVariant', 'id = ?', vMove), seed.count('StockMovement', 'variantId = ?', vMove)], [1, 1])
  const r5 = await safe(() => variantPurgeService.purge({ variantIds: [vOk] }))
  eq('۷۳۱ روز بدون حرکت: حذف بدون خطا', r5?.__error ?? null, null)
  eq('۷۳۱ روز: deleted=1، movements=0', [r5?.deleted, r5?.movements], [1, 0])
  eq('۷۳۱ روز: رکورد کالا حذف شد', seed.count('ProductVariant', 'id = ?', vOk), 0)
  const snap = seed.one('SELECT variantCode, variantName, lineTotal FROM "SaleInvoiceItem" WHERE invoiceId = ?', inv.id)
  eq('ردیف فروش با snapshot کد و مبلغ دست‌نخورده ماند', [snap?.variantCode, Number(snap?.lineTotal)], [code, 500])
  eq('نام snapshot شامل «جین سایز قدیمی»', /جین سایز قدیمی/.test(snap?.variantName ?? ''), true)
  eq('حرکت انبار کالای دیگر همچنان ۱', seed.count('StockMovement'), 1)
}
eq('هیچ IN بیش از ۵۰۰', overs, [])
console.log(`  (بیشترین IN دیده‌شده: ${maxIn})`)
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
