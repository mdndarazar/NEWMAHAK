/**
 * ===========================================================================
 * جلسه ۵۴ — سوییت پذیرش «ساخت کالای جدید در فروشگاه هنگام انتقال از انبار مرکزی».
 *
 * روی همان هارنس واقعی جلسه ۳۵: SQLite داخل Node، جدول‌ها از schema واقعی،
 * سرویس‌های واقعی، تراکنش واقعی (پس تست Rollback واقعاً چیزی را برمی‌گرداند).
 * هیچ چیزی mock نشده و هیچ npm ای لازم نیست:
 *
 *     node test/acceptance-db-session54.mjs
 *
 * هفت بندِ خواسته‌ی مالک:
 *   ۱ — انتقال به کالای **موجود** (رفتار قبلی مو‌به‌مو، با جبران موجودی منفی)
 *   ۲ — ساخت کالای جدید + انتقال (کالا با قیمت، موجودی درست، ردیف انبار کم شده)
 *   ۳ — خطا وسط کار ⇒ **هیچ** کالایی ساخته نشود و هیچ عددی جابه‌جا نشود
 *   ۴ — قیمت فروش صفر/خالی ⇒ رد
 *   ۵ — کد تکراری ⇒ خودکار با کد آزاد جایگزین و به کاربر گفته شود
 *   ۶ — قفل: بی رمز و با رمز غلط ⇒ رد (و هیچ کالایی ساخته نشود)
 *   ۷ — افزودن **واریانت** به کالای موجود (و رد واریانت تکراری)
 *
 * جلسه ۵۵ · کار ۱ — کلید قفل دوم از `products` به
 * `secondaryToStoreNewProduct` عوض شد، پس همه‌ی تنظیم‌های قفل این سوییت با کلید
 * تازه به‌روز شدند و بند ۸ تازه اضافه شد:
 *   ۸ — قفل مستقل تازه: بی رمز ⇒ رد؛ رمز دوم خودش ⇒ قبول (و پنل کالاها را باز
 *       **نمی‌کند**)؛ رمز مدیر ⇒ قبول؛ رمز دوم پنل کالاها ⇒ رد؛ قفل خاموش ⇒
 *       OPEN؛ رمز غلط ⇒ هیچ کالایی ساخته نمی‌شود (اتمیک).
 *   ۹ — کار ۲: وجود شرط جلوگیری «تعداد بیشتر از موجودی ردیف» در فرم.
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-session54-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('./harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('./harness/seed.mjs')
const { secondaryStockService } = await import('../src/main/services/SecondaryStockService.ts')
const { authService } = await import('../src/main/services/AuthService.ts')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')

const db = harnessClient()
const seed = makeSeeder(db)

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (name, cond, detail) => {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
    return true
  }
  failures.push(`${name}${detail ? ` → ${detail}` : ''}`)
  console.log(`  ✗ ${name}${detail ? ` → ${detail}` : ''}`)
  return false
}
const eq = (name, actual, expected) => ok(name, actual === expected, `انتظار ${expected} ولی ${actual}`)
const throws = async (name, fn, needle) => {
  try {
    await fn()
    return ok(name, false, 'هیچ خطایی پرتاب نشد')
  } catch (e) {
    const msg = String(e?.message ?? '')
    return ok(name, needle ? msg.includes(needle) : true, `پیام: ${msg.slice(0, 120)}`)
  }
}

/** قفل‌ها روشن/خاموش — همان کلید تنظیماتی که `readPanelLocks` می‌خواند. */
const setLocks = (obj) => seed.setting(SETTING_KEYS.panelLocks, obj)
const counts = () => ({
  products: seed.count('Product'),
  variants: seed.count('ProductVariant')
})
const itemQty = (id) => seed.one('SELECT qty FROM "SecondaryStockItem" WHERE id = ?', id).qty
const stockOf = (id) => seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id).stock

// ---------------------------------------------------------------------------
// داده‌ی پایه
// ---------------------------------------------------------------------------
const userId = seed.user('مدیر تست')
const catId = seed.category('مردانه')
const existingProductId = seed.product('شلوار جین', catId)
const existingVariantId = seed.insert('ProductVariant', {
  productId: existingProductId,
  code: '701',
  barcode: 'BAR-701',
  size: '32',
  salePrice: 900_000,
  stock: 5
})
/**
 * همه‌ی قفل‌ها خاموش ⇒ `assertPanelPassword` بی رمز `OPEN` می‌دهد (سیاست موجود).
 *
 * جلسه ۵۵ — کلید دوم دیگر `products` نیست: مسیر «ساخت کالای جدید هنگام انتقال»
 * قفل مستقل خودش را دارد. `products: false` هم عمداً اینجا **نیامده** تا اگر
 * روزی کسی قفل تازه را برگرداند سراغ پنل کالاها، همین سوییت بشکند.
 */
const NEW_PRODUCT_PANEL = PANEL_KEYS.secondaryToStoreNewProduct
setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: false })

// ===========================================================================
section('بند ۱ — انتقال به کالای *موجود*: رفتار قبلی مو‌به‌مو')
// ===========================================================================
{
  const itemId = seed.insert('SecondaryStockItem', { name: 'شلوار جین', code: '701', qty: 10 })
  const res = await secondaryStockService.toStore({ itemId, variantId: existingVariantId, qty: 4, userId })
  eq('موجودی فروشگاه ۵ ⇒ ۹', stockOf(existingVariantId), 9)
  eq('ردیف انبار مرکزی ۱۰ ⇒ ۶', itemQty(itemId), 6)
  eq('storeBefore درست', res.storeBefore, 5)
  eq('storeAfter درست', res.storeAfter, 9)
  eq('کسری قبلی نداشت', res.shortageCovered, 0)
  eq('سابقه‌ی انبار مرکزی ثبت شد', seed.count('SecondaryStockLog', 'action = ?', 'TRANSFER_STORE'), 1)
  eq('AuditLog همان رویداد قبلی', seed.count('AuditLog', 'action = ?', 'SECONDARY_TO_STORE'), 1)
  eq(
    'حرکت انبار با دلیل CENTRAL_WITHDRAW',
    seed.count('StockMovement', 'reason = ? AND variantId = ?', 'CENTRAL_WITHDRAW', existingVariantId),
    1
  )
  eq('هیچ کالای تازه‌ای ساخته نشد', counts().variants, 1)

  // موجودی منفی: ۳− + ۱۰ ⇒ ۷ و سه عدد «جبران کسری»
  const negVariant = seed.insert('ProductVariant', {
    productId: existingProductId,
    code: '702',
    barcode: 'BAR-702',
    size: '34',
    salePrice: 900_000,
    stock: -3
  })
  const item2 = seed.insert('SecondaryStockItem', { name: 'شلوار جین ۳۴', qty: 20 })
  const neg = await secondaryStockService.toStore({ itemId: item2, variantId: negVariant, qty: 10, userId })
  eq('۳− + ۱۰ ⇒ ۷', stockOf(negVariant), 7)
  eq('shortageCovered = ۳', neg.shortageCovered, 3)

  // اعتبارسنجی‌های قبلی هم سر جایشان‌اند
  await throws('variantId خالی ⇒ رد با همان پیام قبلی', () =>
    secondaryStockService.toStore({ itemId, variantId: 0, qty: 1 }), 'کالای مقصد در انبار فروشگاه را انتخاب کنید')
  await throws('انتقال بیشتر از موجودی بی force ⇒ همان هشدار قبلی', () =>
    secondaryStockService.toStore({ itemId, variantId: existingVariantId, qty: 999 }), 'تیک تأیید')
}

// ===========================================================================
section('بند ۲ — ساخت کالای جدید + انتقال، اتمیک در یک تراکنش')
// ===========================================================================
let createdVariantId = 0
{
  const before = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'پیراهن بی‌همتا', code: 'PX-1', qty: 12 })
  const res = await secondaryStockService.toStoreNewVariant({
    itemId,
    qty: 5,
    userId,
    name: 'پیراهن بی‌همتا',
    categoryId: catId,
    size: 'L',
    color: 'آبی',
    salePrice: 1_450_000,
    purchasePrice: 900_000,
    code: 'PX-1'
  })
  createdVariantId = res.created.variantId
  ok('کالای تازه ساخته شد', res.created.createdProduct)
  eq('یک Product تازه', counts().products, before.products + 1)
  eq('یک ProductVariant تازه', counts().variants, before.variants + 1)
  const v = seed.one('SELECT * FROM "ProductVariant" WHERE id = ?', createdVariantId)
  eq('قیمت فروش همان عدد فرم است (نه صفر!)', v.salePrice, 1_450_000)
  eq('قیمت خرید ثبت شد', v.purchasePrice, 900_000)
  eq('موجودی کالای تازه = تعداد منتقل‌شده', v.stock, 5)
  eq('سایز ثبت شد', v.size, 'L')
  eq('رنگ ثبت شد', v.color, 'آبی')
  ok('بارکد خودکار و ناتهی', String(v.barcode ?? '').length >= 10, `بارکد: ${v.barcode}`)
  eq('کد درخواستی آزاد بود ⇒ همان ثبت شد', v.code, 'PX-1')
  ok('کد جایگزین نشد', res.created.codeReplaced === false)
  eq('واحد کالای جدید «عدد»', seed.one('SELECT unit FROM "Product" WHERE id = ?', res.created.productId).unit, 'عدد')
  eq('دسته‌ی انتخابی ثبت شد', seed.one('SELECT categoryId FROM "Product" WHERE id = ?', res.created.productId).categoryId, catId)
  eq('ردیف انبار مرکزی ۱۲ ⇒ ۷', itemQty(itemId), 7)
  eq('موجودی از صفر شروع شده بود ⇒ storeBefore صفر', res.storeBefore, 0)
  eq('storeAfter = ۵', res.storeAfter, 5)
  eq(
    'موجودی فقط از مسیر CENTRAL_WITHDRAW پر شده (دفتر راستگو)',
    seed.count('StockMovement', 'variantId = ? AND reason = ?', createdVariantId, 'CENTRAL_WITHDRAW'),
    1
  )
  eq(
    'هیچ حرکت INITIAL/ADJUSTMENT اضافه‌ای ثبت نشده',
    seed.count('StockMovement', 'variantId = ? AND reason <> ?', createdVariantId, 'CENTRAL_WITHDRAW'),
    0
  )
  eq('سابقه‌ی انبار مرکزی هم ثبت شد', seed.count('SecondaryStockLog', 'itemId = ?', itemId), 1)
  eq('AuditLog انتقال', seed.count('AuditLog', 'action = ? AND entityId = ?', 'SECONDARY_TO_STORE', itemId), 1)
  eq(
    'AuditLog «کالای تازه» کنارش',
    seed.count('AuditLog', 'action = ? AND entityId = ?', 'SECONDARY_TO_STORE_NEW_PRODUCT', createdVariantId),
    1
  )
}

// ===========================================================================
section('بند ۳ — خطا وسط کار ⇒ هیچ کالایی ساخته نشود، هیچ موجودی‌ای جابه‌جا نشود')
// ===========================================================================
{
  const before = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'کاپشن تک', qty: 2 })
  const movesBefore = seed.count('StockMovement')
  // ساخت کالا *موفق* است و انتقال وسط کار می‌شکند (۹۹ > ۲ بی force) ⇒ Rollback
  await throws(
    'انتقال بیشتر از موجودی ردیف ⇒ خطا',
    () =>
      secondaryStockService.toStoreNewVariant({
        itemId,
        qty: 99,
        userId,
        name: 'کاپشن تک',
        salePrice: 500_000
      }),
    'تیک تأیید'
  )
  eq('هیچ Product تازه‌ای نماند', counts().products, before.products)
  eq('هیچ ProductVariant تازه‌ای نماند', counts().variants, before.variants)
  eq('ردیف انبار مرکزی دست‌نخورده', itemQty(itemId), 2)
  eq('هیچ حرکت انباری ثبت نشد', seed.count('StockMovement'), movesBefore)
  eq('هیچ سابقه‌ای برای این ردیف ثبت نشد', seed.count('SecondaryStockLog', 'itemId = ?', itemId), 0)
}

// ===========================================================================
section('بند ۴ — قیمت فروش صفر یا خالی ⇒ رد')
// ===========================================================================
{
  const before = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'جوراب', qty: 6 })
  await throws(
    'قیمت صفر ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'جوراب', salePrice: 0 }),
    'قیمت فروش'
  )
  await throws(
    'قیمت خالی ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'جوراب', salePrice: undefined }),
    'قیمت فروش'
  )
  await throws(
    'قیمت منفی ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'جوراب', salePrice: -5 }),
    'قیمت فروش'
  )
  await throws(
    'نام خالی ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: '   ', salePrice: 100 }),
    'نام کالای جدید'
  )
  await throws(
    'تعداد صفر ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 0, name: 'جوراب', salePrice: 100 }),
    'تعداد انتقال'
  )
  await throws(
    'دسته‌ی ناموجود ⇒ رد',
    () =>
      secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'جوراب', salePrice: 100, categoryId: 99999 }),
    'دسته'
  )
  eq('هیچ کالایی ساخته نشد', counts().variants, before.variants)
  eq('ردیف انبار مرکزی دست‌نخورده', itemQty(itemId), 6)
}

// ===========================================================================
section('بند ۵ — کد تکراری ⇒ خودکار جایگزین می‌شود و کاربر می‌بیند')
// ===========================================================================
{
  const itemId = seed.insert('SecondaryStockItem', { name: 'کلاه', code: '701', qty: 4 })
  const res = await secondaryStockService.toStoreNewVariant({
    itemId,
    qty: 2,
    userId,
    name: 'کلاه',
    salePrice: 300_000,
    code: '701' // کد کالای موجود
  })
  ok('پرچم «کد جایگزین شد» روشن است', res.created.codeReplaced === true)
  eq('کد درخواستی در نتیجه برمی‌گردد (برای پیام)', res.created.requestedCode, '701')
  ok('کد تازه با کد قبلی یکی نیست', res.created.code !== '701', `کد تازه: ${res.created.code}`)
  eq('کد کالای قبلی دست‌نخورده', seed.one('SELECT code FROM "ProductVariant" WHERE id = ?', existingVariantId).code, '701')
  eq('کد در دیتابیس همان چیزی است که برگشت', seed.one('SELECT code FROM "ProductVariant" WHERE id = ?', res.created.variantId).code, res.created.code)
  eq('انتقال هم انجام شد', stockOf(res.created.variantId), 2)
  eq('ردیف انبار مرکزی ۴ ⇒ ۲', itemQty(itemId), 2)
}

// ===========================================================================
section('بند ۶ — قفل: هر دو کلید سمت سرور سنجیده می‌شوند')
// ===========================================================================
{
  const before = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'شال', qty: 5 })

  // قفل «انتقال به فروشگاه» روشن، قفل «ساخت کالای جدید» خاموش
  setLocks({ 'secondary-to-store': true, [NEW_PRODUCT_PANEL]: false })
  await throws(
    'قفل انتقال روشن + بی رمز ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'شال', salePrice: 100_000 }),
    'تأیید مدیر لازم دارد'
  )
  await throws(
    'قفل انتقال روشن + رمز غلط ⇒ رد',
    () =>
      secondaryStockService.toStoreNewVariant({
        itemId,
        qty: 1,
        name: 'شال',
        salePrice: 100_000,
        toStorePassword: 'غلط-غلط'
      }),
    'درست نیست'
  )

  // قفل «ساخت کالای جدید» روشن، قفل انتقال خاموش ⇒ باز هم باید رد شود (کلید دوم)
  setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: true })
  await throws(
    'قفل «ساخت کالای جدید هنگام انتقال» روشن + بی رمز ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'شال', salePrice: 100_000 }),
    'تأیید مدیر لازم دارد'
  )
  eq('در هیچ‌یک از ردهای قفل، کالایی ساخته نشد', counts().variants, before.variants)
  eq('و موجودی ردیف انبار مرکزی دست‌نخورده', itemQty(itemId), 5)

  // نشست ۱۴۹ · S147-b · S147-D5 — به‌روزرسانی مستند: مسیر «کالای موجود» هم حالا گیت سمت سرور دارد
  // (بند ۴-۳۹ «انتقال انبار مرکزی» + بند ۵ «هر گیت در main»). قفل روشن ⇒ بی‌رمز رد، با رمز ⇒ انجام.
  // قفل «ساخت کالای جدید» روی این مسیر اثری ندارد (فقط قفل secondary-to-store سنجیده می‌شود).
  setLocks({ 'secondary-to-store': true, [NEW_PRODUCT_PANEL]: true })
  const itemId2 = seed.insert('SecondaryStockItem', { name: 'شلوار جین', code: '701', qty: 3 })
  const before2 = stockOf(existingVariantId)
  await throws(
    'قفل انتقال روشن + انتقال به کالای موجود بی رمز ⇒ رد (S147-b)',
    () => secondaryStockService.toStore({ itemId: itemId2, variantId: existingVariantId, qty: 1, userId }),
    'تأیید مدیر لازم دارد'
  )
  eq('و موجودی کالای موجود دست‌نخورده', stockOf(existingVariantId), before2)
  await secondaryStockService.toStore({ itemId: itemId2, variantId: existingVariantId, qty: 1, userId, toStorePassword: DEFAULT_MANAGER_PASSWORD })
  eq('انتقال به کالای موجود با رمز قفل انتقال انجام می‌شود', stockOf(existingVariantId), before2 + 1)

  setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: false })
}

// ===========================================================================
section('بند ۷ — افزودن واریانت به کالای موجود (بی ساختن کالای تکراری)')
// ===========================================================================
{
  const before = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'شلوار جین سایز ۳۶', qty: 8 })
  const res = await secondaryStockService.toStoreNewVariant({
    itemId,
    qty: 3,
    userId,
    productId: existingProductId,
    size: '36',
    salePrice: 950_000
  })
  ok('کالای تازه ساخته *نشد*', res.created.createdProduct === false)
  eq('تعداد Product ها ثابت ماند', counts().products, before.products)
  eq('یک واریانت تازه اضافه شد', counts().variants, before.variants + 1)
  eq('واریانت به همان کالای موجود وصل است', seed.one('SELECT productId FROM "ProductVariant" WHERE id = ?', res.created.variantId).productId, existingProductId)
  eq('موجودی واریانت تازه = تعداد منتقل‌شده', stockOf(res.created.variantId), 3)
  eq('ردیف انبار مرکزی ۸ ⇒ ۵', itemQty(itemId), 5)

  // همان سایز/رنگ دوباره ⇒ رد (وگرنه موجودی یک کالا در دو ردیف پخش می‌شود)
  const guard = counts()
  await throws(
    'واریانت تکراری (همان سایز و رنگ) ⇒ رد',
    () =>
      secondaryStockService.toStoreNewVariant({
        itemId,
        qty: 1,
        productId: existingProductId,
        size: '36',
        salePrice: 950_000
      }),
    'از قبل وجود دارد'
  )
  eq('و هیچ واریانتی ساخته نشد', counts().variants, guard.variants)
  await throws(
    'کالای ناموجود برای افزودن واریانت ⇒ رد',
    () =>
      secondaryStockService.toStoreNewVariant({ itemId, qty: 1, productId: 999999, size: 'XL', salePrice: 1000 }),
    'پیدا نشد'
  )
}

// ===========================================================================
section('بند ۸ — جلسه ۵۵ · کار ۱: قفل مستقل «ساخت کالای جدید هنگام انتقال»')
// ===========================================================================
{
  /**
   * قفل موقت (۳ رمز اشتباه ⇒ ۱۰ دقیقه) در این بند عمداً خاموش است: اینجا موضوع
   * *سیاست قفل* است نه rate limit، و چند رمز غلطِ پشت‌سرهم نباید بندهای بعدی را
   * بی‌ربط قفل کند. منطق خودِ قفل موقت تست مخصوص خودش را دارد.
   */
  seed.setting(SETTING_KEYS.securityConfig, { lockoutEnabled: false })

  const NEW_PW = '5555'   // رمز دوم قفل تازه
  const PRODUCTS_PW = '7777' // رمز دوم پنل کالاها — عمداً *متفاوت*
  await authService.setPanelPassword({
    panel: NEW_PRODUCT_PANEL,
    managerPassword: DEFAULT_MANAGER_PASSWORD,
    password: NEW_PW
  })
  await authService.setPanelPassword({
    panel: PANEL_KEYS.products,
    managerPassword: DEFAULT_MANAGER_PASSWORD,
    password: PRODUCTS_PW
  })

  eq('کلید تازه در فهرست پنل‌های قفل‌دار هست', NEW_PRODUCT_PANEL, 'secondary-to-store-new-product')

  // ---- قفل تازه روشن، قفل انتقال خاموش (تا فقط کلید دوم سنجیده شود) ----
  setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: true, products: true })

  const guard = counts()
  const itemId = seed.insert('SecondaryStockItem', { name: 'دستکش', qty: 9 })

  await throws(
    'قفل تازه روشن و بی رمز ⇒ رد',
    () => secondaryStockService.toStoreNewVariant({ itemId, qty: 1, name: 'دستکش', salePrice: 200_000 }),
    'تأیید مدیر لازم دارد'
  )
  eq('و هیچ کالایی ساخته نشد', counts().variants, guard.variants)

  // رمز دوم *پنل کالاها* ⇒ باید رد شود: این قفل دیگر کاری با پنل کالاها ندارد
  await throws(
    'رمز دوم پنل کالاها (نه قفل تازه) ⇒ رد',
    () =>
      secondaryStockService.toStoreNewVariant({
        itemId,
        qty: 1,
        name: 'دستکش',
        salePrice: 200_000,
        newProductPassword: PRODUCTS_PW
      }),
    'درست نیست'
  )
  eq('اتمیک بودن: رمز غلط ⇒ هیچ کالایی ساخته نشد', counts().variants, guard.variants)
  eq('و ردیف انبار مرکزی دست‌نخورده', itemQty(itemId), 9)

  // رمز دوم *قفل تازه* ⇒ قبول
  const res = await secondaryStockService.toStoreNewVariant({
    itemId,
    qty: 2,
    userId,
    name: 'دستکش',
    salePrice: 200_000,
    newProductPassword: NEW_PW
  })
  ok('رمز دوم قفل تازه ⇒ قبول', res.created.variantId > 0)
  eq('و انتقال هم انجام شد', stockOf(res.created.variantId), 2)
  eq('ردیف انبار مرکزی ۹ ⇒ ۷', itemQty(itemId), 7)

  // و همان رمز، پنل کالاها را باز نمی‌کند (اصل خواسته‌ی کار ۱)
  await throws(
    'همان رمز دوم، پنل «کالاها» را باز نمی‌کند',
    () => authService.verifyPanel({ panel: PANEL_KEYS.products, password: NEW_PW }),
    'درست نیست'
  )
  const okScope = await authService.verifyPanel({ panel: NEW_PRODUCT_PANEL, password: NEW_PW })
  eq('و روی قفل خودش «رمز دوم» است، نه نشست مدیر', okScope.scope, 'PANEL')

  // رمز مدیر ⇒ قبول، با یک فیلد (چون سرور همان رمز اول را برای کلید دوم هم می‌آزماید)
  const item2 = seed.insert('SecondaryStockItem', { name: 'کلاه بافت', qty: 6 })
  setLocks({ 'secondary-to-store': true, [NEW_PRODUCT_PANEL]: true, products: true })
  const res2 = await secondaryStockService.toStoreNewVariant({
    itemId: item2,
    qty: 3,
    userId,
    name: 'کلاه بافت',
    salePrice: 150_000,
    toStorePassword: DEFAULT_MANAGER_PASSWORD
  })
  ok('رمز مدیر با یک فیلد هر دو قفل را باز می‌کند', res2.created.variantId > 0)
  eq('و انتقال انجام شد', stockOf(res2.created.variantId), 3)
  eq('AuditLog می‌گوید با کدام scope تأیید شد', seed.count('AuditLog', 'action = ? AND note LIKE ?', 'SECONDARY_TO_STORE_NEW_PRODUCT', '%تأیید قفل ساخت کالای جدید: MANAGER%') >= 1, true)

  // قفل خاموش ⇒ بی هیچ رمزی OPEN
  setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: false, products: true })
  const item3 = seed.insert('SecondaryStockItem', { name: 'شورت ورزشی', qty: 4 })
  const res3 = await secondaryStockService.toStoreNewVariant({
    itemId: item3,
    qty: 1,
    userId,
    name: 'شورت ورزشی',
    salePrice: 90_000
  })
  ok('قفل خاموش ⇒ بی رمز انجام می‌شود (OPEN)', res3.created.variantId > 0)
  eq('حتی وقتی قفل پنل کالاها روشن است (دیگر بی‌ربط شده)', stockOf(res3.created.variantId), 1)

  setLocks({ 'secondary-to-store': false, [NEW_PRODUCT_PANEL]: false })
}

// ===========================================================================
section('بند ۹ — جلسه ۵۵ · کار ۲: جلوگیری از «تعداد بیشتر از موجودی ردیف» در فرم')
// ===========================================================================
{
  const { readFileSync } = await import('node:fs')
  const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
  const MODAL = read('src/renderer/src/components/NewStoreProductModal.tsx')
  const PAGE = read('src/renderer/src/pages/SecondaryStock.tsx')

  ok('فرم موجودی ردیف را با تعداد انتقال می‌سنجد', MODAL.includes('const overAvailable = !!seed && transferQty > rowAvailable'))
  ok('و پیام روشن فارسی می‌دهد', MODAL.includes('از موجودی همین ردیف انبار مرکزی'))
  ok('شرط داخل فهرست `problems` است، پس دکمه‌ی ثبت غیرفعال می‌شود',
    MODAL.includes('if (overAvailable)\n    problems.push('))
  ok('و `submit` هم جدا جلویش را می‌گیرد (تکیه‌گاه دوم)', MODAL.includes('if (overAvailable) return'))
  ok('فرم `force` نمی‌فرستد (ساده‌ترین حالت: جلوگیری)', !MODAL.includes('force:'))
  ok('صفحه هم قبل از تماس با سرور می‌سنجد', PAGE.includes('Math.round(seedRow.available ?? 0)'))
}

// ===========================================================================
console.log(`\n${failures.length ? '✗' : '✓'} ${pass} بررسی موفق · ${failures.length} ناموفق`)
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`)
  process.exit(1)
}
