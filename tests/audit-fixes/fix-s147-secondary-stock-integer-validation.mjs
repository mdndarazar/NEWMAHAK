// نشست ۱۴۸: تست «قبل» S147-a روی zip ۱۴۷ ⇒ ✗ 26 موفق · 72 ناموفق (TESTLOG-s148-before.txt). نشست ۱۴۹: بعد از رفع ⇒ ✓ 108 موفق · 0 ناموفق (TESTLOG-s149-after.txt).
/**
 * ===========================================================================
 * نشست ۱۴۸ · خوشه E/K · S147-a · بند ۳، ۴-۴۲ و ۴-۲۸(د) — تبدیل بی‌صدای اعداد
 * در «انبار مرکزی» (SecondaryStockService + صفحه‌ی انبار مرکزی + فرم کالای جدید)
 *
 * قبل از رفع (کد نشست ۱۴۶/۱۴۷):
 *   ۱) upsert: qty = Math.round(Number(qty ?? 0)) || 0 ⇒ ۲٫۶ بی‌صدا ۳، متن «7» ⇒ ۷،
 *      NaN ⇒ ۰، 3e9 بی‌سقف؛ minQty منفی ⇒ ۰؛ ویرایش بدون qty ⇒ موجودی ردیف صفر؛
 *      warehouseId نامعتبر (۲٫۵، متن) ⇒ بی‌صدا «انبار پیش‌فرض».
 *   ۲) transfer: Math.round ⇒ ۱٫۵ بی‌صدا ۲ عدد منتقل؛ 1e20 با force از validation رد
 *      نمی‌شد؛ toWarehouseId نامعتبر ⇒ انتقال بی‌صدا به انبار پیش‌فرض.
 *   ۳) toStore: Math.trunc ⇒ ۲٫۹ بی‌صدا ۲ عدد به موجودی واقعی فروشگاه؛ متن «2» پذیرفته.
 *   ۴) toStoreNewVariant: salePrice با Math.round (۱٬۲۰۰٬۰۰۰٫۵ ⇒ ۱٬۲۰۰٬۰۰۱ ریال) و
 *      قیمت خرید فقط بعد از مصرف رمز (داخل تراکنش) سنجیده می‌شد.
 *   ۵) coverShortage: Math.abs(Math.round(qty)) ⇒ ۱٫۵ ⇒ ۲ و ‎-۲ ⇒ ۲ برداشت از انبار مرکزی.
 *   ۶) UI: صفحه پیش از ارسال Math.round می‌کرد و فرم کالای جدید با replace(/[^\d]/g,'')
 *      نقطه را حذف می‌کرد (۱۲۰۰۰۰۰٫۵ ⇒ ۱۲٬۰۰۰٬۰۰۵ یعنی ده‌برابر) و ارقام فارسی را پاک.
 * انتظار بعد از رفع: هر ورودی نامعتبر ⇒ رد فارسی و صفر تغییر در SecondaryStockItem/
 * SecondaryStockLog/StockMovement/ProductVariant؛ مسیرهای معتبر (qty منفی در upsert،
 * انتقال ۲، toStore ۲، کالای جدید با رمز، برداشت ۲) ⇒ موفق.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s147-secondary-stock-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s147a-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { secondaryStockService } = await import('../../src/main/services/SecondaryStockService.ts')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const jalali = await import('@shared/jalali')

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
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 110)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r }
  catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); return null }
}

// قفل‌های انتقال به فروشگاه روشن (سیاست پیش‌فرض)؛ rate-limit خاموش تا بندها هم را قفل نکنند
seed.setting(SETTING_KEYS.securityConfig, { lockoutEnabled: false })
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.secondaryToStore]: true, [PANEL_KEYS.secondaryToStoreNewProduct]: true })

const userId = seed.user('انباردار تست ۱۴۷')
const rowQty = (id) => seed.one('SELECT qty FROM "SecondaryStockItem" WHERE id = ?', id)?.qty
const rowMin = (id) => seed.one('SELECT minQty FROM "SecondaryStockItem" WHERE id = ?', id)?.minQty
const rowHouse = (id) => seed.one('SELECT warehouseId FROM "SecondaryStockItem" WHERE id = ?', id)?.warehouseId ?? null
const logs = () => seed.count('SecondaryStockLog')
const moves = () => seed.count('StockMovement')
const variants = () => seed.count('ProductVariant')
const products = () => seed.count('Product')
const stockOf = (vid) => seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', vid)?.stock
const audits = (action) => seed.count('AuditLog', 'action = ?', action)
const snapshot = () => JSON.stringify(seed.rows('SELECT id, name, qty, minQty, warehouseId FROM "SecondaryStockItem" ORDER BY id'))

console.log('\n۱) upsert: تعداد/حد هشدار/انبار/شناسه‌ی نامعتبر ⇒ رد فارسی، هیچ ردیف یا سابقه‌ای ساخته نمی‌شود')
const baseRow = await safe('ثبت ردیف پایه با تعداد ۱۰ و حد هشدار ۲', () =>
  secondaryStockService.upsert({ name: 'شلوار جین مرکزی ۱۴۷', code: 'C147', qty: 10, minQty: 2, userId }))
const rowId = Number(baseRow?.id)
const snap1 = snapshot()
const logs1 = logs()
await rejects('تعداد ۲٫۶', () => secondaryStockService.upsert({ name: 'ردیف اعشاری', qty: 2.6 }), 'عدد صحیح')
await rejects('تعداد NaN', () => secondaryStockService.upsert({ name: 'ردیف NaN', qty: NaN }), 'عدد صحیح')
await rejects('تعداد متنی «7»', () => secondaryStockService.upsert({ name: 'ردیف متنی', qty: '7' }), 'عدد صحیح')
await rejects('تعداد 1e20', () => secondaryStockService.upsert({ name: 'ردیف خیلی بزرگ', qty: 1e20 }), 'عدد صحیح')
await rejects('تعداد 3e9 (بیش از سقف Int ۳۲ بیتی)', () => secondaryStockService.upsert({ name: 'ردیف سه میلیارد', qty: 3e9 }), 'عدد صحیح')
await rejects('تعداد ‎-3e9', () => secondaryStockService.upsert({ name: 'ردیف منفی سه میلیارد', qty: -3e9 }), 'عدد صحیح')
await rejects('حد هشدار ‎-۱', () => secondaryStockService.upsert({ name: 'ردیف حد منفی', qty: 1, minQty: -1 }), 'حد هشدار')
await rejects('حد هشدار ۲٫۵', () => secondaryStockService.upsert({ name: 'ردیف حد اعشاری', qty: 1, minQty: 2.5 }), 'حد هشدار')
await rejects('انبار ۲٫۵', () => secondaryStockService.upsert({ name: 'ردیف انبار اعشاری', qty: 1, warehouseId: 2.5 }), 'انبار')
await rejects('انبار متنی', () => secondaryStockService.upsert({ name: 'ردیف انبار متنی', qty: 1, warehouseId: 'abc' }), 'انبار')
await rejects('انبار ‎-۱', () => secondaryStockService.upsert({ name: 'ردیف انبار منفی', qty: 1, warehouseId: -1 }), 'انبار')
await rejects('ویرایش با تعداد ۲٫۶', () => secondaryStockService.upsert({ id: rowId, name: 'شلوار جین مرکزی ۱۴۷', code: 'C147', qty: 2.6 }), 'عدد صحیح')
await rejects('ویرایش با شناسه‌ی ۱٫۵', () => secondaryStockService.upsert({ id: 1.5, name: 'شلوار جین مرکزی ۱۴۷', qty: 4 }), 'عدد صحیح')
await rejects('ویرایش ردیف ناموجود', () => secondaryStockService.upsert({ id: 999_999, name: 'ردیف ناموجود', qty: 4 }), 'پیدا نشد')
eq('ردیف‌ها و موجودی‌ها دست‌نخورده', snapshot(), snap1)
eq('سابقه‌ی تازه‌ای ثبت نشد', logs(), logs1)

console.log('\n۲) ویرایش بدون فیلد تعداد/حد هشدار/انبار ⇒ مقدار قبلی حفظ می‌شود (نه صفر بی‌صدا)')
await safe('ویرایش نام/توضیح بدون qty و minQty و warehouseId', () =>
  secondaryStockService.upsert({ id: rowId, name: 'شلوار جین مرکزی ۱۴۷', code: 'C147', note: 'قفسه‌ی ۳', userId }))
eq('موجودی ردیف پس از ویرایش بی‌تعداد', rowQty(rowId), 10)
eq('حد هشدار ردیف پس از ویرایش بی‌حد', rowMin(rowId), 2)
eq('انبار ردیف (پیش‌فرض) دست‌نخورده', rowHouse(rowId), null)
const lastLog = seed.one('SELECT qtyBefore, qtyAfter FROM "SecondaryStockLog" WHERE itemId = ? ORDER BY id DESC LIMIT 1', rowId)
eq('سابقه‌ی ویرایش: قبل', lastLog?.qtyBefore, 10)
eq('سابقه‌ی ویرایش: بعد (نه صفر)', lastLog?.qtyAfter, 10)

console.log('\n۳) مسیرهای معتبر upsert حفظ می‌شوند (تعداد منفی طبق طراحی ماژول مجاز است)')
const negRow = await safe('ثبت ردیف با تعداد ‎-۳', () => secondaryStockService.upsert({ name: 'ردیف منفی ۱۴۷', qty: -3, userId }))
eq('تعداد ردیف منفی', rowQty(Number(negRow?.id)), -3)
const zeroRow = await safe('ثبت ردیف تازه بدون qty ⇒ ۰', () => secondaryStockService.upsert({ name: 'ردیف بی‌تعداد ۱۴۷', userId }))
eq('تعداد ردیف تازه‌ی بی‌تعداد', rowQty(Number(zeroRow?.id)), 0)
const capRow = await safe('ثبت ردیف با تعداد دقیقاً سقف ۲۱۴۷۴۸۳۶۴۷', () => secondaryStockService.upsert({ name: 'ردیف سقف ۱۴۷', qty: 2_147_483_647, userId }))
eq('تعداد ردیف سقف', rowQty(Number(capRow?.id)), 2_147_483_647)

console.log('\n۴) انتقال بین انبارها: تعداد/شناسه‌ی نامعتبر ⇒ رد فارسی، هیچ موجودی‌ای جابه‌جا نمی‌شود')
const house = await safe('ساخت انبار شعبه', () => secondaryStockService.warehouseUpsert({ name: 'انبار شعبه ۱۴۷', userId }))
const houseId = Number(house?.id)
const snap4 = snapshot()
const logs4 = logs()
const tr4 = audits('SECONDARY_STOCK_TRANSFER')
const trBase = { itemId: rowId, toWarehouseId: houseId, userId }
await rejects('تعداد ۱٫۵', () => secondaryStockService.transfer({ ...trBase, qty: 1.5 }), 'تعداد انتقال')
await rejects('تعداد ۲٫۶', () => secondaryStockService.transfer({ ...trBase, qty: 2.6 }), 'تعداد انتقال')
await rejects('تعداد متنی «3»', () => secondaryStockService.transfer({ ...trBase, qty: '3' }), 'تعداد انتقال')
await rejects('تعداد 1e20 با force', () => secondaryStockService.transfer({ ...trBase, qty: 1e20, force: true }), 'تعداد انتقال')
await rejects('ردیف مبدأ ۱٫۵', () => secondaryStockService.transfer({ ...trBase, itemId: 1.5, qty: 2 }), 'عدد صحیح')
await rejects('انبار مقصد ۲٫۵', () => secondaryStockService.transfer({ ...trBase, toWarehouseId: 2.5, qty: 2 }), 'عدد صحیح')
await rejects('موجودی حاصل مبدأ خارج از سقف (force)', () => secondaryStockService.transfer({ itemId: Number(negRow?.id), toWarehouseId: houseId, qty: 2_147_483_647, force: true }), 'سقف')
eq('ردیف‌ها و موجودی‌ها دست‌نخورده', snapshot(), snap4)
eq('سابقه‌ی تازه‌ای ثبت نشد', logs(), logs4)
eq('Audit انتقال تازه‌ای ثبت نشد', audits('SECONDARY_STOCK_TRANSFER'), tr4)
await safe('انتقال معتبر ۲ عدد به شعبه', () => secondaryStockService.transfer({ ...trBase, qty: 2 }))
eq('مبدأ ۱۰ ⇒ ۸', rowQty(rowId), 8)
const branchRow = seed.one('SELECT id, qty FROM "SecondaryStockItem" WHERE warehouseId = ? AND name = ?', houseId, 'شلوار جین مرکزی ۱۴۷')
eq('مقصد (شعبه) ۲', branchRow?.qty, 2)
const snap4b = snapshot()
await rejects('از شعبه با انبار مقصد ۲٫۵ (قبلاً بی‌صدا به انبار پیش‌فرض می‌رفت)', () =>
  secondaryStockService.transfer({ itemId: Number(branchRow?.id), toWarehouseId: 2.5, qty: 1, userId }), 'عدد صحیح')
await rejects('از شعبه با انبار مقصد متنی', () =>
  secondaryStockService.transfer({ itemId: Number(branchRow?.id), toWarehouseId: 'x', qty: 1, userId }), 'عدد صحیح')
eq('موجودی شعبه و پیش‌فرض دست‌نخورده', snapshot(), snap4b)

console.log('\n۵) انتقال به انبار فروشگاه: تعداد/شناسه‌ی نامعتبر ⇒ رد فارسی، صفر حرکت انبار فروشگاه')
const pid = seed.product('شلوار جین فروشگاه ۱۴۷')
const vid = seed.insert('ProductVariant', { productId: pid, code: 'S147-1', barcode: 'B147-1', salePrice: 1_000_000, stock: 0 })
const snap5 = snapshot()
const mv5 = moves()
const logs5 = logs()
const ts5 = audits('SECONDARY_TO_STORE')
const tsBase = { itemId: rowId, variantId: vid, toStorePassword: PW, userId }
await rejects('تعداد ۲٫۹', () => secondaryStockService.toStore({ ...tsBase, qty: 2.9 }), 'تعداد انتقال')
await rejects('تعداد متنی «2»', () => secondaryStockService.toStore({ ...tsBase, qty: '2' }), 'تعداد انتقال')
await rejects('تعداد 1e20 با force', () => secondaryStockService.toStore({ ...tsBase, qty: 1e20, force: true }), 'تعداد انتقال')
await rejects('کالای مقصد ۱٫۵', () => secondaryStockService.toStore({ ...tsBase, variantId: 1.5, qty: 2 }), 'عدد صحیح')
await rejects('ردیف مبدأ ۲٫۵', () => secondaryStockService.toStore({ ...tsBase, itemId: 2.5, qty: 2 }), 'عدد صحیح')
eq('موجودی فروشگاه دست‌نخورده', stockOf(vid), 0)
eq('حرکت انبار تازه‌ای ثبت نشد', moves(), mv5)
eq('ردیف‌های انبار مرکزی دست‌نخورده', snapshot(), snap5)
eq('سابقه‌ی تازه‌ای ثبت نشد', logs(), logs5)
eq('Audit انتقال به فروشگاه تازه‌ای ثبت نشد', audits('SECONDARY_TO_STORE'), ts5)
await safe('انتقال معتبر ۲ عدد به فروشگاه (با رمز)', () => secondaryStockService.toStore({ ...tsBase, qty: 2 }))
eq('موجودی فروشگاه ۰ ⇒ ۲', stockOf(vid), 2)
eq('ردیف مرکزی ۸ ⇒ ۶', rowQty(rowId), 6)

console.log('\n۶) کالای جدید هنگام انتقال: تعداد/قیمت نامعتبر ⇒ رد فارسی پیش از رمز، هیچ کالایی ساخته نمی‌شود')
const v6 = variants()
const p6 = products()
const snap6 = snapshot()
const nvBase = { itemId: rowId, name: 'کاپشن تازه ۱۴۷', salePrice: 1_200_000, purchasePrice: 600_000, toStorePassword: PW, userId }
await rejects('تعداد ۲٫۹', () => secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 2.9 }), 'تعداد انتقال')
await rejects('تعداد متنی «1»', () => secondaryStockService.toStoreNewVariant({ ...nvBase, qty: '1' }), 'تعداد انتقال')
await rejects('قیمت فروش ۱٬۲۰۰٬۰۰۰٫۵', () => secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, salePrice: 1_200_000.5 }), 'قیمت فروش')
await rejects('قیمت فروش متنی', () => secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, salePrice: '1200000' }), 'قیمت فروش')
await rejects('قیمت خرید ۶۰۰٬۰۰۰٫۵', () => secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, purchasePrice: 600_000.5 }), 'قیمت خرید')
await rejects('قیمت فروش اعشاری بدون رمز ⇒ پیام قیمت (سنجش پیش از رمز)', () =>
  secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, salePrice: 1_200_000.5, toStorePassword: null }), 'قیمت فروش')
await rejects('قیمت خرید اعشاری بدون رمز ⇒ پیام قیمت خرید (سنجش پیش از رمز)', () =>
  secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, purchasePrice: 600_000.5, toStorePassword: null }), 'قیمت خرید')
eq('واریانت تازه‌ای ساخته نشد', variants(), v6)
eq('کالای تازه‌ای ساخته نشد', products(), p6)
eq('ردیف مرکزی دست‌نخورده', snapshot(), snap6)
const nv = await safe('کالای جدید معتبر با رمز و قیمت خرید خالی', () =>
  secondaryStockService.toStoreNewVariant({ ...nvBase, qty: 1, purchasePrice: null }))
const nvId = Number(nv?.created?.variantId)
eq('قیمت فروش همان عدد فرم (نه گرد‌شده)', Number(seed.one('SELECT salePrice FROM "ProductVariant" WHERE id = ?', nvId)?.salePrice), 1_200_000)
eq('قیمت خرید خالی ⇒ ۰', Number(seed.one('SELECT purchasePrice FROM "ProductVariant" WHERE id = ?', nvId)?.purchasePrice), 0)
eq('موجودی کالای تازه', stockOf(nvId), 1)
eq('ردیف مرکزی ۶ ⇒ ۵', rowQty(rowId), 5)

console.log('\n۷) برداشت خودکار هنگام کمبود: تعداد منفی/اعشاری/شناسه‌ی نامعتبر ⇒ رد فارسی و rollback کل سند')
const pid7 = seed.product('تی‌شرت برداشت خودکار ۱۴۷')
const vid7 = seed.insert('ProductVariant', { productId: pid7, code: 'S147-CS', barcode: 'B147-CS', salePrice: 500_000, stock: 0 })
const row7 = seed.insert('SecondaryStockItem', { name: 'تی‌شرت مرکزی', code: 'S147-CS', qty: 5 })
const mv7 = moves()
const cw7 = audits('CENTRAL_WITHDRAW')
/** همان الگوی SalesService: نوشتن «سند فروش» و برداشت در یک تراکنش؛ رد برداشت ⇒ کل سند برمی‌گردد. */
const inSaleTx = (lines) =>
  db.$transaction(async (tx) => {
    await tx.secondaryStockItem.update({ where: { id: row7 }, data: { note: 'نوشته‌ی سند فروش' } })
    return secondaryStockService.coverShortage(tx, lines, { userId })
  })
await rejects('تعداد ۱٫۵', () => inSaleTx([{ variantId: vid7, qty: 1.5 }]), 'عدد صحیح')
await rejects('تعداد ‎-۲', () => inSaleTx([{ variantId: vid7, qty: -2 }]), 'عدد صحیح')
await rejects('تعداد متنی «2»', () => inSaleTx([{ variantId: vid7, qty: '2' }]), 'عدد صحیح')
await rejects('شناسه‌ی کالای ۱٫۵', () => inSaleTx([{ variantId: 1.5, qty: 2 }]), 'عدد صحیح')
await rejects('یک قلم معتبر + یک قلم ۰٫۵ ⇒ کل سند رد', () => inSaleTx([{ variantId: vid7, qty: 2 }, { variantId: vid7, qty: 0.5 }]), 'عدد صحیح')
eq('ردیف مرکزی دست‌نخورده', rowQty(row7), 5)
eq('نوشته‌ی سند فروش هم برگشت (rollback کامل)', seed.one('SELECT note FROM "SecondaryStockItem" WHERE id = ?', row7)?.note ?? null, null)
eq('موجودی فروشگاه دست‌نخورده', stockOf(vid7), 0)
eq('حرکت انبار تازه‌ای ثبت نشد', moves(), mv7)
eq('Audit برداشت خودکار ثبت نشد', audits('CENTRAL_WITHDRAW'), cw7)
const zero = await safe('قلم با تعداد ۰ ⇒ نادیده (بدون خطا، مثل قبل)', () =>
  db.$transaction((tx) => secondaryStockService.coverShortage(tx, [{ variantId: vid7, qty: 0 }], { userId })))
eq('برداشت قلم صفر', zero?.totalTaken, 0)
const got = await safe('برداشت معتبر ۲ عدد', () =>
  db.$transaction((tx) => secondaryStockService.coverShortage(tx, [{ variantId: vid7, qty: 2 }], { userId })))
eq('برداشت‌شده', got?.totalTaken, 2)
eq('موجودی فروشگاه ۰ ⇒ ۲', stockOf(vid7), 2)
eq('ردیف مرکزی ۵ ⇒ ۳', rowQty(row7), 3)

console.log('\n۸) پارس قیمت فرم کالای جدید (تابع مشترک parseGroupedInteger)')
const parse = jalali.parseGroupedInteger
truthy('تابع parseGroupedInteger در @shared/jalali هست', typeof parse === 'function')
if (typeof parse === 'function') {
  eq('«1200000»', parse('1200000'), 1_200_000)
  eq('«۱٬۲۰۰٬۰۰۰» (ارقام فارسی + جداکننده‌ی هزارگان)', parse('۱٬۲۰۰٬۰۰۰'), 1_200_000)
  eq('«1,200,000»', parse('1,200,000'), 1_200_000)
  eq('«1 200 000»', parse('1 200 000'), 1_200_000)
  eq('خالی ⇒ ۰', parse(''), 0)
  eq('«1200000.5» ⇒ نامعتبر (نه ده‌برابر)', parse('1200000.5'), null)
  eq('«۱۲۰۰۰۰۰٫۵» ⇒ نامعتبر', parse('۱۲۰۰۰۰۰٫۵'), null)
  eq('«-5» ⇒ نامعتبر', parse('-5'), null)
  eq('«12a» ⇒ نامعتبر', parse('12a'), null)
  eq('«99999999999999999999» ⇒ نامعتبر (خارج از بازه‌ی امن)', parse('99999999999999999999'), null)
}

console.log('\n۹) سیم‌کشی UI (ساختاری؛ رندر واقعی Electron اجرا نمی‌شود)')
const page = readFileSync(resolve('src/renderer/src/pages/SecondaryStock.tsx'), 'utf8')
truthy('صفحه‌ی انبار مرکزی تعداد را پیش از ارسال گرد نمی‌کند', !/qty:\s*Math\.(round|trunc)\(/.test(page))
truthy('صفحه‌ی انبار مرکزی حد هشدار را بی‌صدا صفر/گرد نمی‌کند', !/minQty:\s*Math\.max\(0,/.test(page))
const modal = readFileSync(resolve('src/renderer/src/components/NewStoreProductModal.tsx'), 'utf8')
truthy('فرم کالای جدید قیمت را با حذف همه‌ی غیررقم‌ها پارس نمی‌کند', !modal.includes("replace(/[^\\d]/g, '')"))
truthy('فرم کالای جدید از parseGroupedInteger (ارقام فارسی + هزارگان) استفاده می‌کند', /parseGroupedInteger\(salePrice\)/.test(modal) && /parseGroupedInteger\(purchasePrice\)/.test(modal))
truthy('فرم کالای جدید برای قیمت نامعتبر پیام فارسی دارد', modal.includes('قیمت فروش باید عدد صحیح به ریال باشد') && modal.includes('قیمت خرید باید عدد صحیح به ریال باشد'))
truthy('فرم کالای جدید تعداد را پیش از ارسال گرد نمی‌کند', !/qty:\s*Math\.round\(/.test(modal) && !/transferQty = Math\.round\(/.test(modal))
truthy('فرم کالای جدید تعداد غیرصحیح را problem می‌کند', /Number\.isSafeInteger\(transferQty\)/.test(modal))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
