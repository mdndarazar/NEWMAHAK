/**
 * ===========================================================================
 * نشست ۱۷۷ · خوشه D · S176-D3 — حذف نرم/بازگردانی کالا، حذف همیشگی (پیش‌نمایش + purge) و حذف ردیف‌های
 * انبار مرکزی با ۵۰۱+ شناسه و سقف IN ۵۰۰ (قاعده‌ی S99-2).
 *
 * قبل از رفع: ProductService.remove/restore، VariantPurgeService.preview/purge (بیرون و داخل تراکنش:
 * خواندن دوباره، شمارش دفتر گردش، deleteMany) و SecondaryStockService.remove همه‌ی شناسه‌ها را بی‌سقف
 * در id in / variantId in می‌گذاشتند. UI امروز سقف دارد (۲۰۰/۳۰۰/بدون «انتخاب همه»)، ولی main نباید
 * به UI تکیه کند (مسیر IPC مستقیم). انتظار: هیچ in بالای ۵۰۰؛ نتایج دقیقاً همان رفتار قبلی
 * (با S177_NO_CAP=1 روی کد قبلی همین اعداد PASS می‌شوند، فقط چک‌های سقف FAIL).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s177-product-remove-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s177a-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { productService } = await import('../../src/main/services/ProductService.ts')
const { variantPurgeService } = await import('../../src/main/services/VariantPurgeService.ts')
const { secondaryStockService } = await import('../../src/main/services/SecondaryStockService.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)?.slice(0, 240)}`) }
}
const run = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطا: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}

let maxIn = 0
const walk = (w) => {
  if (!w || typeof w !== 'object') return
  for (const [k, v] of Object.entries(w)) {
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500 && !process.env.S177_NO_CAP) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['productVariant', 'stockMovement', 'secondaryStockItem', 'saleInvoiceItem', 'purchaseInvoiceItem', 'saleReturnItem']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']) {
    if (typeof prisma[model]?.[m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const N = 620
const cat = seed.category('جین ۱۷۷')
const pid = seed.product('شلوار جین ۱۷۷', cat)
const ids = []
for (let i = 0; i < N; i++) ids.push(seed.insert('ProductVariant', { productId: pid, code: `S177-${i}`, barcode: `B177-${i}`, salePrice: 1000, purchasePrice: 500, stock: 0 }))
// کنترل: کالای دیگری که نباید دست بخورد
const pid2 = seed.product('کالای کنترل ۱۷۷', cat)
const ctl = seed.insert('ProductVariant', { productId: pid2, code: 'S177-CTL', barcode: 'B177-CTL', salePrice: 1000, purchasePrice: 500, stock: 0 })
const inactive = () => Number(seed.rows(`SELECT COUNT(*) c FROM "ProductVariant" WHERE code LIKE 'S177-%' AND code <> 'S177-CTL' AND isActive = 0 AND deletedAt IS NOT NULL`)[0].c)
const ctlActive = () => Number(seed.rows('SELECT isActive a FROM "ProductVariant" WHERE id = ?', ctl)[0]?.a ?? -1)

console.log('\n۱) حذف نرم ۶۲۰ کالا (+ شناسه‌ی تکراری) به سطل آشغال')
maxIn = 0
const rm = await run('remove', () => productService.remove([...ids, ids[0], ids[600]], null))
eq('تعداد حذف‌شده', rm, N)
eq('۶۲۰ کالا غیرفعال با تاریخ حذف', inactive(), N)
eq('کالای کنترل دست‌نخورده', ctlActive(), 1)
const aRm = seed.rows(`SELECT note, before FROM "AuditLog" WHERE entity = 'ProductVariant' AND action = 'DELETE' ORDER BY id DESC LIMIT 1`)[0] ?? {}
eq('Audit حذف: وضعیت قبلی هر ۶۲۰ کالا', (() => { try { return JSON.parse(aRm.before).length } catch { return null } })(), N)
eq('هیچ in بالای ۵۰۰ نبود (remove)', maxIn <= 500, true)

console.log('\n۲) بازگردانی ۶۲۰ کالا از سطل آشغال')
maxIn = 0
const rs = await run('restore', () => productService.restore(ids, null))
eq('تعداد بازگردانی‌شده', rs, N)
eq('هیچ کالای غیرفعالی نماند', inactive(), 0)
const aRs = seed.rows(`SELECT note, before FROM "AuditLog" WHERE entity = 'ProductVariant' AND action = 'PRODUCT_RESTORE' ORDER BY id DESC LIMIT 1`)[0] ?? {}
eq('Audit بازگردانی: یادداشت با شمار ۶۲۰', String(aRs.note ?? '').includes(`${N} کالا`), true)
eq('Audit بازگردانی: ۶۲۰ ردیف قبلی', (() => { try { return JSON.parse(aRs.before).length } catch { return null } })(), N)
eq('هیچ in بالای ۵۰۰ نبود (restore)', maxIn <= 500, true)

console.log('\n۳) حذف همیشگی: پیش‌نمایش ۶۲۰ کالای قدیمی سطل آشغال')
await run('remove again', () => productService.remove(ids, null))
sql.prepare(`UPDATE "ProductVariant" SET deletedAt = ? WHERE code LIKE 'S177-%' AND code <> 'S177-CTL'`).run(Date.now() - 800 * 86400_000)
maxIn = 0
const pv = await run('preview', () => variantPurgeService.preview({ variantIds: ids }))
eq('پیش‌نمایش: ۶۲۰ ردیف', pv?.lines?.length ?? null, N)
eq('پیش‌نمایش: بدون سابقه/حرکت', pv ? [pv.historyRows, pv.movements] : null, [0, 0])
eq('هیچ in بالای ۵۰۰ نبود (preview)', maxIn <= 500, true)

console.log('\n۴) حذف همیشگی رد می‌شود اگر یکی از کالاهای دسته‌ی دوم حرکت انبار داشته باشد (همه یا هیچ)')
const mv = seed.insert('StockMovement', { variantId: ids[610], delta: 1, reason: 'ADJUSTMENT', refType: 'Manual' })
maxIn = 0
let rejMsg = ''
try { await variantPurgeService.purge({ variantIds: ids, managerPassword: PW }); rejMsg = 'پذیرفته شد' } catch (e) { rejMsg = String(e?.message ?? e) }
eq('رد با پیام حرکت انبار', /حرکت در دفتر گردش انبار/.test(rejMsg) && !rejMsg.startsWith('HARNESS'), true)
eq('هیچ کالایی پاک نشد', Number(seed.rows(`SELECT COUNT(*) c FROM "ProductVariant" WHERE code LIKE 'S177-%'`)[0].c), N + 1)
eq('هیچ in بالای ۵۰۰ نبود (purge رد)', maxIn <= 500, true)
sql.prepare('DELETE FROM "StockMovement" WHERE id = ?').run(mv)

console.log('\n۵) حذف همیشگی ۶۲۰ کالا')
maxIn = 0
const pg = await run('purge', () => variantPurgeService.purge({ variantIds: ids, managerPassword: PW }))
eq('deleted', pg?.deleted ?? null, N)
eq('کالاهای ۶۲۰تایی پاک شدند؛ کنترل ماند', Number(seed.rows(`SELECT COUNT(*) c FROM "ProductVariant" WHERE code LIKE 'S177-%'`)[0].c), 1)
eq('محصول پایه‌ی بی‌واریانت هم رفت، محصول کنترل ماند', [Number(seed.rows('SELECT COUNT(*) c FROM "Product" WHERE id = ?', pid)[0].c), Number(seed.rows('SELECT COUNT(*) c FROM "Product" WHERE id = ?', pid2)[0].c)], [0, 1])
eq('هیچ in بالای ۵۰۰ نبود (purge)', maxIn <= 500, true)

console.log('\n۶) حذف ۶۲۰ ردیف انبار مرکزی')
const sids = []
for (let i = 0; i < N; i++) sids.push(seed.insert('SecondaryStockItem', { name: `ردیف مرکزی ۱۷۷ شماره ${i}`, code: `C177-${i}`, qty: 2, minQty: 0 }))
const keep = seed.insert('SecondaryStockItem', { name: 'ردیف کنترل ۱۷۷', code: 'C177-CTL', qty: 5, minQty: 0 })
maxIn = 0
const sr = await run('secondary remove', () => secondaryStockService.remove({ ids: [...sids, sids[3]] }))
eq('تعداد حذف‌شده', sr, N)
eq('فقط ردیف کنترل ماند', seed.rows(`SELECT code FROM "SecondaryStockItem" WHERE code LIKE 'C177-%'`).map((r) => r.code), ['C177-CTL'])
const aSs = seed.rows(`SELECT note, before FROM "AuditLog" WHERE action = 'SECONDARY_STOCK_DELETE' ORDER BY id DESC LIMIT 1`)[0] ?? {}
eq('Audit انبار مرکزی: ۶۲۰ ردیف قبلی', (() => { try { return JSON.parse(aSs.before).length } catch { return null } })(), N)
eq('دفتر انبار مرکزی: ۶۲۰ ردیف حذف', Number(seed.rows(`SELECT COUNT(*) c FROM "SecondaryStockLog" WHERE action = 'DELETE'`)[0]?.c ?? -1), N)
eq('هیچ in بالای ۵۰۰ نبود (secondary remove)', maxIn <= 500, true)
void keep

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
