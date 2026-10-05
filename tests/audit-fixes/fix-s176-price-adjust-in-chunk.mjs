/**
 * ===========================================================================
 * نشست ۱۷۶ · خوشه D · S176-D1 — تغییر گروهی قیمت (PriceAdjustService) با ۵۰۱+ کالا و سقف IN ۵۰۰
 *
 * قبل از رفع: بازگردانی (revert)، پایان خودکار زمان‌بندی (endScheduledBatch)، حذف سابقه با
 * «برگرداندن قیمت‌ها» (deleteBatches restore)، ویرایش دامنه (editBatch، کالاهای بیرون‌رفته)،
 * دامنه‌ی «کالاهای انتخابی» (scopeWhere/loadAllProductVariants در preview/apply/editBatch)،
 * نمایش تخفیف فعال پنل فروش (activeDiscounts) و فهرست سابقه (batches، تا ۲٬۰۰۰ دسته) شناسه‌ها را
 * بی‌سقف در id in / batchId in می‌گذاشتند. یک تخفیف «همه‌ی کالاها» روی ۶۲۰ کالا ⇒ بازگردانی و
 * پایان خودکارش از سقف رد و rollback می‌شد (قیمت تخفیف‌خورده بی‌پایان روی کالا می‌ماند).
 * انتظار: هیچ in بالای ۵۰۰؛ همه‌ی اعداد قیمت دقیقاً همان رفتار قبلی.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s176-price-adjust-in-chunk.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s176a-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')
const { prisma } = await import('../../src/main/db/client.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate, faDigits } = await import('@shared/jalali')

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
    if ((k === 'in' || k === 'notIn') && Array.isArray(v)) { maxIn = Math.max(maxIn, v.length); if (v.length > 500 && !process.env.S176_NO_CAP) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    else if (v && typeof v === 'object') walk(v)
  }
}
for (const model of ['productVariant', 'priceChangeItem', 'priceChangeBatch']) {
  for (const m of ['findMany', 'count', 'aggregate', 'groupBy', 'updateMany', 'deleteMany']) {
    if (typeof prisma[model]?.[m] !== 'function') continue
    const orig = prisma[model][m].bind(prisma[model])
    prisma[model][m] = (args) => { walk(args?.where); return orig(args) }
  }
}

const N = 620
const cat = seed.category('جین ۱۷۶')
const pid = seed.product('شلوار جین ۱۷۶', cat)
const ids = []
for (let i = 0; i < N; i++) ids.push(seed.insert('ProductVariant', { productId: pid, code: `S176-${i}`, barcode: `B176-${i}`, salePrice: 1000, purchasePrice: 500, stock: 1 }))
const prices = () => {
  const m = new Map()
  for (const r of seed.rows('SELECT salePrice p, COUNT(*) c FROM "ProductVariant" GROUP BY salePrice ORDER BY salePrice')) m.set(Number(r.p), Number(r.c))
  return Object.fromEntries(m)
}

console.log('\n۱) افزایش ۱۰٪ «همه‌ی کالاها» (۶۲۰ کالا)')
maxIn = 0
const A = await run('apply A', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'PERCENT', value: 10, scope: 'ALL', password: PW }))
eq('changedCount A', A?.changedCount ?? null, N)
eq('قیمت‌ها پس از A', prices(), { 1100: N })

console.log('\n۲) تخفیف ۱۰٪ «همه» + نمایش تخفیف فعال پنل فروش')
const B = await run('apply B', () => priceAdjustService.apply({ kind: 'DISCOUNT', mode: 'PERCENT', value: 10, scope: 'ALL', password: PW }))
eq('قیمت‌ها پس از B', prices(), { 990: N })
maxIn = 0
const act = await run('activeDiscounts', () => priceAdjustService.activeDiscounts({}))
eq('activeDiscounts: ۶۲۰ کالا', act?.length ?? null, N)
eq('activeDiscounts: قیمت پایه/فروش', act?.length ? [act[0].basePrice, act[0].salePrice] : null, [1100, 990])
const actW = await run('activeDiscounts wanted', () => priceAdjustService.activeDiscounts({ variantIds: ids, password: PW }))
eq('activeDiscounts با ۶۲۰ شناسه‌ی درخواستی', actW?.length ?? null, N)
eq('هیچ in بالای ۵۰۰ نبود (activeDiscounts)', maxIn <= 500, true)

console.log('\n۳) پایان خودکار زمان‌بندی B (endScheduledBatch)')
sql.prepare('UPDATE "PriceChangeBatch" SET endAt = ? WHERE id = ?').run(Date.now() - 60_000, B?.batchId ?? -1)
maxIn = 0
const due = await run('runDueSchedules', () => priceAdjustService.runDueSchedules(new Date()))
eq('ended/failed', due ? [due.ended, due.failed] : null, [1, 0])
eq('قیمت‌ها پس از پایان خودکار B', prices(), { 1100: N })
eq('وضعیت B = ENDED', seed.rows('SELECT state FROM "PriceChangeBatch" WHERE id = ?', B?.batchId ?? -1)[0]?.state ?? null, 'ENDED')

console.log('\n۴) تخفیف ۲۰٪ «همه» و بازگردانی دستی')
const C = await run('apply C', () => priceAdjustService.apply({ kind: 'DISCOUNT', mode: 'PERCENT', value: 20, scope: 'ALL', password: PW }))
eq('قیمت‌ها پس از C', prices(), { 880: N })
maxIn = 0
const rv = await run('revert C', () => priceAdjustService.revert({ batchId: C?.batchId, password: PW }))
eq('restoredCount C', rv?.restoredCount ?? null, N)
eq('قیمت‌ها پس از بازگردانی C', prices(), { 1100: N })
eq('هیچ in بالای ۵۰۰ نبود (revert)', maxIn <= 500, true)

console.log('\n۵) دامنه‌ی «کالاهای انتخابی» با ۶۲۰ شناسه (preview + apply)')
maxIn = 0
const pv = await run('preview D', () => priceAdjustService.preview({ kind: 'INCREASE', mode: 'AMOUNT', value: 100, scope: 'VARIANTS', variantIds: ids, password: PW }))
eq('preview count/changedCount', pv ? [pv.count, pv.changedCount, pv.deltaTotal] : null, [N, N, N * 100])
const D = await run('apply D', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'AMOUNT', value: 100, scope: 'VARIANTS', variantIds: ids, password: PW }))
eq('changedCount D', D?.changedCount ?? null, N)
eq('قیمت‌ها پس از D', prices(), { 1200: N })

console.log('\n۶) ویرایش دامنه‌ی D به ۱۰ کالا (۶۱۰ کالای بیرون‌رفته به قیمت قبل)')
maxIn = 0
const ed = await run('editBatch D', () => priceAdjustService.editBatch({ batchId: D?.batchId, scope: 'VARIANTS', variantIds: ids.slice(0, 10), password: PW }))
eq('removedCount/keptCount', ed ? [ed.removedCount, ed.keptCount] : null, [N - 10, 10])
eq('قیمت‌ها پس از ویرایش D', prices(), { 1100: N - 10, 1200: 10 })
eq('اقلام باقی‌مانده‌ی D', Number(seed.rows('SELECT COUNT(*) c FROM "PriceChangeItem" WHERE batchId = ?', D?.batchId ?? -1)[0].c), 10)

console.log('\n۷) حذف سابقه‌ی A و D با برگرداندن قیمت‌ها')
maxIn = 0
const del = await run('deleteBatches restore', () => priceAdjustService.deleteBatches({ batchIds: [A?.batchId, D?.batchId], restorePrices: true, password: PW }))
eq('deletedCount/restoredCount', del ? [del.deletedCount, del.restoredCount] : null, [2, N + 10])
eq('قیمت‌ها پس از حذف با بازگردانی', prices(), { 1000: N })
eq('هیچ in بالای ۵۰۰ نبود (deleteBatches)', maxIn <= 500, true)

console.log('\n۸) ۵۲۰ ردیف سابقه: فهرست (batches) و حذف گروهی بدون بازگردانی')
// نشست ۱۷۷ · M8 — دو دسته‌ی APPLIED هم‌پوشان روی ۳ کالا، *قبل* از ۵۲۰ ردیف سابقه ⇒ در فهرست
// (جدیدترین اول) بعد از ردیف ۵۰۰ می‌افتند؛ اگر batches() اقلام را فقط برای دسته‌ی اول شناسه‌ها
// بخواند، هشدار «دسته‌ی جدیدتری روی همین کالاها» برای X1 گم می‌شود.
const X1 = await run('apply X1', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'AMOUNT', value: 100, scope: 'VARIANTS', variantIds: ids.slice(0, 3), password: PW }))
const X2 = await run('apply X2', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'AMOUNT', value: 100, scope: 'VARIANTS', variantIds: ids.slice(0, 3), password: PW }))
eq('قیمت‌ها پس از X1/X2', prices(), { 1000: N - 3, 1200: 3 })
const junk = []
for (let i = 0; i < 520; i++) junk.push(seed.insert('PriceChangeBatch', { kind: 'DISCOUNT', mode: 'PERCENT', value: 1, target: 'SALE', scope: 'ALL', title: `سابقه‌ی ۱۷۶ شماره ${i}`, state: 'REVERTED', itemCount: 0, deltaTotal: 0, at: new Date(), revertedAt: new Date() }))
maxIn = 0
const list = await run('batches', () => priceAdjustService.batches({ take: 2000 }))
eq('batches: همه‌ی ردیف‌ها', list ? list.length >= 520 : null, true)
const listIdx = (id) => (list ?? []).findIndex((r) => r.id === id)
eq('X1/X2 بعد از ردیف ۵۰۰ فهرست‌اند (دسته‌ی دوم شناسه‌ها)', listIdx(X1?.batchId) >= 500 && listIdx(X2?.batchId) >= 500, true)
const w1 = (list ?? []).find((r) => r.id === X1?.batchId)?.revertWarning ?? null
eq('هشدار هم‌پوشانی X1 روی ۳ کالا', typeof w1 === 'string' && w1.includes(`روی ${faDigits(3)} مورد`), true)
const r2 = (list ?? []).find((r) => r.id === X2?.batchId)
eq('X2 (جدیدتر) هشدار ندارد', r2 ? r2.revertWarning : 'ردیف X2 پیدا نشد', null)
const delX = await run('deleteBatches X restore', () => priceAdjustService.deleteBatches({ batchIds: [X1?.batchId, X2?.batchId], restorePrices: true, password: PW }))
eq('deletedCount X1/X2', delX?.deletedCount ?? null, 2)
const del2 = await run('deleteBatches 520', () => priceAdjustService.deleteBatches({ batchIds: junk, restorePrices: false, password: PW }))
eq('deletedCount ۵۲۰', del2?.deletedCount ?? null, 520)
eq('هیچ ردیف سابقه‌ی ۱۷۶ نماند', Number(seed.rows(`SELECT COUNT(*) c FROM "PriceChangeBatch" WHERE title LIKE 'سابقه‌ی ۱۷۶%'`)[0].c), 0)
eq('قیمت‌ها دست‌نخورده', prices(), { 1000: N })
eq('هیچ in بالای ۵۰۰ نبود (batches/deleteBatches)', maxIn <= 500, true)

console.log('\n۹) زمان‌بندی آینده با دامنه‌ی ۶۲۰ کالای انتخابی (شمارش + شروع خودکار)')
maxIn = 0
const F = await run('apply future', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'AMOUNT', value: 50, scope: 'VARIANTS', variantIds: ids, startDate: toJalaliDate(new Date(Date.now() + 3 * 86400_000)), password: PW }))
const fRow = seed.rows('SELECT state, title FROM "PriceChangeBatch" WHERE id = ?', F?.batchId ?? -1)[0] ?? {}
eq('قرار آینده SCHEDULED', fRow.state ?? null, 'SCHEDULED')
eq('عنوان قرار شمار ۶۲۰ کالا را دارد', String(fRow.title ?? '').includes(faDigits(String(N))) || String(fRow.title ?? '').includes(faDigits(N.toLocaleString('en-US'))), true)
eq('قیمت‌ها هنوز دست‌نخورده', prices(), { 1000: N })
sql.prepare('UPDATE "PriceChangeBatch" SET startAt = ? WHERE id = ?').run(Date.now() - 60_000, F?.batchId ?? -1)
const dueF = await run('runDueSchedules F', () => priceAdjustService.runDueSchedules(new Date()))
eq('started/failed', dueF ? [dueF.started, dueF.failed] : null, [1, 0])
eq('قیمت‌ها پس از شروع خودکار', prices(), { 1050: N })
eq('اقلام دسته‌ی F', Number(seed.rows('SELECT COUNT(*) c FROM "PriceChangeItem" WHERE batchId = ?', F?.batchId ?? -1)[0].c), N)
eq('هیچ in بالای ۵۰۰ نبود (زمان‌بندی)', maxIn <= 500, true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
