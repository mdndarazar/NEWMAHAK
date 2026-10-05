/**
 * ===========================================================================
 * نشست ۱۴۴ · خوشه E · بند ۳، ۴-۴۲ و ۴-۲۸(د) — validation عددی موجودی و قیمت کالا
 *
 * قبل از رفع:
 *   ۱) InventoryService.setStock: Math.round(newQty) ⇒ ۷٫۶ بی‌صدا ۸ می‌شد؛ NaN/متن
 *      ⇒ delta = NaN و یک StockMovement با delta نامعتبر (کش موجودی خراب).
 *   ۲) InventoryService.apply (increase/decrease): مقدار اعشاری مستقیم در دفتر
 *      انبار (append-only!) می‌نشست.
 *   ۳) ProductService.upsert: موجودی فرم Math.round می‌شد و قیمت فروش/خرید
 *      بدون هیچ سنجشی (اعشار/متن/1e20) مستقیم ذخیره می‌شد.
 *   ۴) createVariantInTx: قیمت اعشاری بی‌صدا گرد می‌شد.
 * انتظار: رد با پیام فارسی (عدد/ریال)، بدون هیچ StockMovement یا تغییر کالا.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s144-inventory-product-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s144b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { inventoryService } = await import('../../src/main/services/InventoryService.ts')
const { productService, createVariantInTx } = await import('../../src/main/services/ProductService.ts')
// نشست ۱۴۶ — adjustStock امضای شیئی دارد و تغییر قیمت/موجودی واریانت موجود رمز پنل کالاها می‌خواهد (بند ۴-۳۹)
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
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
const moves = (vid) => seed.count('StockMovement', `variantId = ${vid}`)
const stockOf = (vid) => seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', vid)?.stock
const priceOf = (vid) => seed.one('SELECT salePrice, purchasePrice FROM "ProductVariant" WHERE id = ?', vid)

const pid = seed.product('شلوار جین تست ۱۴۴')
const vid = seed.variant(pid, '۳۲')

console.log('\n۱) setStock (اصلاح دستی موجودی): مقدار نامعتبر ⇒ رد، صفر حرکت انبار')
await rejects('موجودی ۷٫۶', () => productService.adjustStock({ variantId: vid, newQty: 7.6, note: 'تست', managerPassword: PW }), 'عدد صحیح')
await rejects('موجودی NaN', () => productService.adjustStock({ variantId: vid, newQty: NaN, note: 'تست', managerPassword: PW }), 'عدد صحیح')
await rejects('موجودی متنی', () => productService.adjustStock({ variantId: vid, newQty: '7', note: 'تست', managerPassword: PW }), 'عدد صحیح')
await rejects('موجودی 1e20', () => productService.adjustStock({ variantId: vid, newQty: 1e20, note: 'تست', managerPassword: PW }), 'عدد صحیح')
eq('حرکت انبار پس از ورودی نامعتبر', moves(vid), 0)
eq('کش موجودی', stockOf(vid), 0)

console.log('\n۲) increase/decrease: مقدار اعشاری/NaN هرگز وارد دفتر append-only نمی‌شود')
await rejects('increase ۲٫۵', () => inventoryService.increase([{ variantId: vid, qty: 2.5 }], { reason: 'PURCHASE', refType: 'Test' }), 'عدد صحیح')
await rejects('decrease NaN', () => inventoryService.decrease([{ variantId: vid, qty: NaN }], { reason: 'SALE', refType: 'Test' }), 'عدد صحیح')
eq('حرکت انبار', moves(vid), 0)

console.log('\n۳) upsert فرم کالا: موجودی/قیمت نامعتبر ⇒ رد کامل، کالا دست‌نخورده')
const base = { id: pid, name: 'شلوار جین تست ۱۴۴', variants: [{ id: vid, salePrice: 1000000, purchasePrice: 600000, stock: 0 }] }
await rejects('موجودی فرم ۲٫۶', () => productService.upsert({ ...base, variants: [{ ...base.variants[0], stock: 2.6 }] }), 'عدد صحیح')
await rejects('قیمت فروش ۱۰۰۰۰۰۰٫۵', () => productService.upsert({ ...base, variants: [{ ...base.variants[0], salePrice: 1000000.5 }] }), 'ریال')
await rejects('قیمت فروش متنی', () => productService.upsert({ ...base, variants: [{ ...base.variants[0], salePrice: '900000' }] }), 'ریال')
await rejects('قیمت خرید منفی', () => productService.upsert({ ...base, variants: [{ ...base.variants[0], purchasePrice: -5 }] }), 'ریال')
await rejects('قیمت خرید 1e20', () => productService.upsert({ ...base, variants: [{ ...base.variants[0], purchasePrice: 1e20 }] }), 'ریال')
eq('قیمت فروش پس از ورودی نامعتبر', Number(priceOf(vid)?.salePrice), 1000000)
eq('حرکت انبار', moves(vid), 0)
await rejects('کالای جدید با موجودی اولیه ۱٫۵', () => productService.upsert({ name: 'کالای نو ۱۴۴', variants: [{ salePrice: 500000, purchasePrice: 0, stock: 1.5 }] }), 'عدد صحیح')
eq('کالای نو ساخته نشد', seed.count('Product', `name = 'کالای نو ۱۴۴'`), 0)

console.log('\n۴) createVariantInTx: قیمت اعشاری بی‌صدا گرد نمی‌شود')
await rejects('قیمت فروش ۷۰۰۰۰۰٫۴', () => db.$transaction((tx) => createVariantInTx(tx, { name: 'کالای انتقالی ۱۴۴', salePrice: 700000.4, purchasePrice: 0 })), 'ریال')
await rejects('قیمت خرید ۱۰٫۵', () => db.$transaction((tx) => createVariantInTx(tx, { name: 'کالای انتقالی ۱۴۴', salePrice: 700000, purchasePrice: 10.5 })), 'ریال')
eq('کالای انتقالی ساخته نشد', seed.count('Product', `name = 'کالای انتقالی ۱۴۴'`), 0)

console.log('\n۵) مسیرهای معتبر حفظ می‌شوند (صفر عمدی و موجودی منفی مجاز)')
await safe('اصلاح موجودی به ۵', () => productService.adjustStock({ variantId: vid, newQty: 5, note: 'انبارگردانی', managerPassword: PW }))
eq('کش موجودی', stockOf(vid), 5)
await safe('اصلاح موجودی به ‎-۲ (منفی مجاز)', () => productService.adjustStock({ variantId: vid, newQty: -2, note: 'تست منفی', managerPassword: PW }))
eq('کش موجودی', stockOf(vid), -2)
await safe('upsert معتبر با قیمت تازه', () => productService.upsert({ ...base, managerPassword: PW, variants: [{ id: vid, salePrice: 1100000, purchasePrice: 600000, stock: 0 }] }))
eq('قیمت فروش تازه', Number(priceOf(vid)?.salePrice), 1100000)
eq('موجودی به ۰ (صفر عمدی)', stockOf(vid), 0)
const nv = await safe('createVariantInTx معتبر', () => db.$transaction((tx) => createVariantInTx(tx, { name: 'کالای انتقالی معتبر ۱۴۴', salePrice: 700000, purchasePrice: 0 })))
truthy('واریانت معتبر ساخته شد', Number(nv?.variantId) > 0)

console.log('\n۶) رندرر عدد را پیش از ارسال بی‌صدا گرد نمی‌کند (ساختاری)')
const form = readFileSync(resolve('src/renderer/src/components/ProductFormModal.tsx'), 'utf8')
truthy('ProductFormModal قیمت/موجودی را Math.round نمی‌کند', !/salePrice: Math\.round\(|purchasePrice: Math\.round\(|stock: Math\.round\(/.test(form))
const modal = readFileSync(resolve('src/renderer/src/components/StockAdjustModal.tsx'), 'utf8')
truthy('StockAdjustModal newQty را Math.round نمی‌کند', !/newQty: Math\.round\(/.test(modal))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
