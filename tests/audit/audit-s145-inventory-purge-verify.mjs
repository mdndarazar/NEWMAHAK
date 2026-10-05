/**
 * ممیزی نشست ۱۴۵ (ادامه) — InventoryService (assertStockInteger، MovementContext.auditNote) و خوانش کامل رفع S146.
 *   AUDIT-S144-02 (P3): increase/decrease پیش از assertStockInteger مقدار را با Math.abs تبدیل می‌کردند؛ پس
 *     متن «۳»/"3" ⇒ ۳ پذیرفته، null/""/[] ⇒ ۰ و بی‌صدا رد (بی‌هیچ حرکتی)، true ⇒ ۱، و تعداد منفی در increase
 *     علامتش بی‌صدا برمی‌گشت. ادعای S144-b («متن رد می‌شود») برای این دو متد درست نبود.
 *   AUDIT-S146-01 (P3): purge وضعیت «داخل سطل آشغال» و مهلت ۷۳۰ روز را فقط بیرون از تراکنش می‌سنجید؛ کالایی که
 *     بین گیت رمز و تراکنش بازگردانی (فعال) شده بود برای همیشه حذف می‌شد.
 * اجرا: node --import ./test/harness/register.mjs tests/audit/audit-s145-inventory-purge-verify.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const DIR = mkdtempSync(join(tmpdir(), 'mahak-a145-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { inventoryService, assertStockInteger } = await import('../../src/main/services/InventoryService.ts')
const { productService } = await import('../../src/main/services/ProductService.ts')
const { variantPurgeService } = await import('../../src/main/services/VariantPurgeService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const db = harnessClient(); const seed = makeSeeder(db)
let ok = 0, bad = 0
const eq = (label, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) } }
const attempt = async (fn) => { try { return { ok: true, v: await fn() } } catch (e) { return { ok: false, m: String(e?.message ?? e) } } }
const fa = (m) => /[\u0600-\u06FF]/.test(m ?? '') && !String(m).startsWith('HARNESS')
const stockOf = (vid) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', vid)?.stock)
const movs = (vid) => seed.count('StockMovement', 'variantId = ?', vid)
const pid = seed.product('شلوار جین ممیزی ۱۴۵')
const vid = seed.insert('ProductVariant', { productId: pid, code: 'A145-1', barcode: 'BA145-1', salePrice: 1_000_000, purchasePrice: 600_000, stock: 0 })
const ctx = { reason: 'PURCHASE', refType: 'Test', note: 'ممیزی ۱۴۵' }

console.log('\n۱) کنترل: increase/decrease عدد صحیح مثبت و صفر')
eq('increase ۵ پذیرفته', (await attempt(() => inventoryService.increase([{ variantId: vid, qty: 5 }], ctx))).ok, true)
eq('decrease ۲ پذیرفته', (await attempt(() => inventoryService.decrease([{ variantId: vid, qty: 2 }], { ...ctx, reason: 'SALE' }))).ok, true)
eq('increase ۰ بی‌اثر و بی‌خطا', (await attempt(() => inventoryService.increase([{ variantId: vid, qty: 0 }], ctx))).ok, true)
eq('موجودی ۳ و دو حرکت', [stockOf(vid), movs(vid)], [3, 2])

console.log('\n۲) ورودی خراب increase/decrease باید با پیام فارسی رد شود، نه تبدیل بی‌صدا')
for (const [label, qty, fn] of [
  ['increase متن "3"', '3', 'increase'],
  ['decrease متن "3"', '3', 'decrease'],
  ['increase null', null, 'increase'],
  ['decrease رشته‌ی خالی', '', 'decrease'],
  ['increase true', true, 'increase'],
  ['increase منفی −۴ (علامت بی‌صدا برنمی‌گردد)', -4, 'increase'],
  ['decrease منفی −۴', -4, 'decrease'],
  ['increase ۲٫۵', 2.5, 'increase']
]) {
  const r = await attempt(() => inventoryService[fn]([{ variantId: vid, qty }], ctx))
  eq(`${label} رد شد`, r.ok, false)
  eq(`${label}: پیام فارسی`, fa(r.m), true)
}
eq('موجودی همچنان ۳ و دو حرکت', [stockOf(vid), movs(vid)], [3, 2])
{
  const r = await attempt(() => inventoryService.increase([{ variantId: vid, qty: 4 }, { variantId: vid, qty: '1' }], ctx))
  eq('دسته‌ی مختلط (۴ و "1") کامل رد، بدون نوشتن ردیف اول', [r.ok, stockOf(vid), movs(vid)], [false, 3, 2])
}

console.log('\n۳) auditNote فقط در AuditLog، دفتر گردش همان توضیح کاربر')
await productService.adjustStock({ variantId: vid, newQty: 10, note: 'شمارش دستی', managerPassword: PW })
const lastMov = seed.one('SELECT note, delta FROM "StockMovement" WHERE variantId = ? ORDER BY id DESC LIMIT 1', vid)
const lastAud = seed.one(`SELECT note FROM "AuditLog" WHERE action = 'STOCK_ADJUST' ORDER BY id DESC LIMIT 1`)
eq('حرکت +۷ با یادداشت کاربر', [lastMov?.delta, lastMov?.note], [7, 'شمارش دستی'])
eq('Audit: یادداشت + scope', lastAud?.note, 'شمارش دستی · تأیید: رمز مدیر')
eq('assertStockInteger(۰, positive) رد', (() => { try { assertStockInteger(0, 'x', { positive: true }); return true } catch { return false } })(), false)

console.log('\n۴) purge: کالایی که بین گیت و تراکنش بازگردانی شد نباید حذف شود')
{
  const p2 = seed.product('کالای قدیمی ممیزی ۱۴۵')
  const old = seed.insert('ProductVariant', { productId: p2, code: 'A145-OLD', barcode: 'BA145-OLD', salePrice: 100_000, isActive: 0, deletedAt: Date.now() - 800 * 86_400_000 })
  const orig = db.$transaction.bind(db)
  db.$transaction = async (...args) => {
    db.$transaction = orig
    // هم‌زمان: کاربر دیگری همین کالا را از سطل آشغال بازگردانی کرد
    db.$harness.db.prepare('UPDATE "ProductVariant" SET isActive = 1, deletedAt = NULL WHERE id = ?').run(old)
    return orig(...args)
  }
  const r = await attempt(() => variantPurgeService.purge({ variantIds: [old], managerPassword: PW }))
  db.$transaction = orig
  eq('purge رد شد', r.ok, false)
  eq('پیام فارسی', fa(r.m), true)
  eq('کالای فعال‌شده هنوز هست', seed.count('ProductVariant', 'id = ?', old), 1)
  eq('محصول پایه هنوز هست', seed.count('Product', 'id = ?', p2), 1)
  eq('Audit PRODUCT_PURGE ثبت نشد', seed.count('AuditLog', `action = 'PRODUCT_PURGE'`), 0)
}
{
  const p3 = seed.product('کالای قدیمی کنترل ۱۴۵')
  const old2 = seed.insert('ProductVariant', { productId: p3, code: 'A145-OLD2', barcode: 'BA145-OLD2', salePrice: 100_000, isActive: 0, deletedAt: Date.now() - 800 * 86_400_000 })
  const r = await attempt(() => variantPurgeService.purge({ variantIds: [old2], managerPassword: PW }))
  eq('کنترل: purge عادی پذیرفته', [r.ok, seed.count('ProductVariant', 'id = ?', old2)], [true, 0])
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
