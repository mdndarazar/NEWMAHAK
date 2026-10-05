/**
 * ===========================================================================
 * نشست ۱۴۳ · بند ۳ و ۴-۴۲ — تعداد شمارش انبارگردانی بی‌صدا صفر/گرد نمی‌شود
 *
 * قبل از رفع، StockCountService.submit: countedQty = Math.max(0, Math.round(Number(x) || 0))
 *   • رقم فارسی «۵» (NaN در Number) یا متن ⇒ ۰ ⇒ کسری کاذب کل موجودی؛
 *   • ۲٫۶ ⇒ ۳؛ ‎-۲ ⇒ ۰ بی‌صدا.
 * Stocktake.tsx هم Number(v) خام می‌فرستاد (بدون toLatinDigits).
 * انتظار: رد با پیام فارسی و صفر StockCountSession؛ مسیر معتبر حفظ؛ UI ارقام را لاتین می‌کند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s143-stock-count-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s143d-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { stockCountService } = await import('../../src/main/services/StockCountService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => (cond ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — ورودی نامعتبر پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 90)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`) }
  }
}
const safe = async (label, fn) => {
  try { return await fn() } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0]}`); return null }
}
const sessions = () => seed.count('StockCountSession', '1 = 1')
const userId = seed.user('انباردار تست نشست ۱۴۳')
const cat = seed.category('پوشاک')
const product = seed.product('شلوار جین', cat)
const vid = seed.variant(product, 'سایز ۳۲')
sql.prepare('UPDATE "ProductVariant" SET stock = 5 WHERE id = ?').run(vid)
const submit = (countedQty) => stockCountService.submit({ userId, items: [{ variantId: vid, countedQty }] })

console.log('\n۱) تعداد نامعتبر ⇒ رد و صفر نشست شمارش (نه کسری کاذب)')
await rejects('NaN (رقم فارسی خام)', () => submit(Number('۵')), 'شمارش')
await rejects('متن «5»', () => submit('5'), 'شمارش')
await rejects('اعشاری ۲٫۶', () => submit(2.6), 'شمارش')
await rejects('منفی ‎-۲', () => submit(-2), 'شمارش')
await rejects('null', () => submit(null), 'شمارش')
await rejects('شناسه‌ی کالای اعشاری', () => stockCountService.submit({ userId, items: [{ variantId: vid + 0.5, countedQty: 5 }] }), 'شناسه')
eq('StockCountSession پس از ورودی‌های نامعتبر', sessions(), 0)
eq('ردیف کسری کاذب', seed.count('StockCountItem', 'countedQty = 0'), 0)

console.log('\n۲) مسیر معتبر حفظ می‌شود (صفر واقعی هم مجاز است)')
const r = await safe('شمارش معتبر ۵', () => submit(5))
eq('نشست ساخته شد', sessions(), 1)
eq('اختلاف', Number(seed.one('SELECT diffQty FROM "StockCountItem" ORDER BY id DESC LIMIT 1')?.diffQty), 0)
await safe('شمارش صفر واقعی', () => submit(0))
eq('نشست دوم (صفر عمدی)', sessions(), 2)

console.log('\n۳) UI ارقام فارسی را پیش از ارسال لاتین می‌کند')
const ui = readFileSync(resolve('src/renderer/src/pages/Stocktake.tsx'), 'utf8')
truthy('Stocktake: countedQty با toLatinDigits', /countedQty: Number\(toLatinDigits\(String\(v\)\)\.trim\(\)\)/.test(ui))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
