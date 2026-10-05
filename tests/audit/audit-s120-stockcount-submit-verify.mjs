/**
 * ممیزی نشست ۱۲۰ — تأیید رفتاری S120-2 در مسیر ثبت (submit). fix-s120 فقط discrepancy را با ۵۰۱ کالا
 * می‌سنجید؛ اینجا submit با ۱٬۰۰۱ کالا زیر هارنسی که IN بالای ۵۰۰ را رد می‌کند، و systemQty snapshot هر کالا.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s120sc-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')
const db = harnessClient(); const seed = makeSeeder(db)
let maxIn = 0
const wrap = (model) => {
  const orig = model.findMany
  model.findMany = async (args = {}) => {
    const ids = args?.where?.id?.in
    if (Array.isArray(ids)) { maxIn = Math.max(maxIn, ids.length); if (ids.length > 500) throw new Error('HARNESS: سقف IN برابر ۵۰۰ است') }
    return orig.call(model, args)
  }
}
wrap(db.productVariant)
const P = seed.product('جین')
const vids = []
db.$harness.db.exec('BEGIN')
for (let i = 0; i < 1001; i++) vids.push(seed.variant(P, String(i)))
db.$harness.db.exec('COMMIT')
db.$harness.db.prepare('UPDATE ProductVariant SET stock = 3').run()
await db.stockCountSession.count()
let res = null, err = null
try { res = await stockCountService.submit({ items: vids.map((v, i) => ({ variantId: v, countedQty: i === 1000 ? 1 : 3 })) }) } catch (e) { err = e.message }
eq('ثبت ۱٬۰۰۱ کالا crash نمی‌کند', err, null)
eq('بزرگ‌ترین IN واریانت ≤ ۵۰۰ (و خوانش واقعاً دسته‌ای بود)', maxIn > 0 && maxIn <= 500, true)
eq('۱٬۰۰۱ ردیف شمارش ثبت شد', seed.count('StockCountItem'), 1001)
eq('systemQty کالای آخر (بعد از دسته‌ی دوم) از موجودی واقعی = ۳', seed.one('SELECT systemQty FROM StockCountItem WHERE variantId = ?', vids[1000])?.systemQty, 3)
eq('diff کالای آخر = −۲ (نه «کالای حذف‌شده» با systemQty صفر)', seed.one('SELECT diffQty, name FROM StockCountItem WHERE variantId = ?', vids[1000])?.diffQty, -2)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
