// نشست ۱۴۶: رفع S145-a انجام شد و تست از tests/pending منتقل شد. قبل (کد نشست ۱۴۴/۱۴۵) ⇒ ۲۳ موفق · ۴۳ ناموفق؛ بعد ⇒ ۶۶ موفق · ۰ ناموفق.
/**
 * ===========================================================================
 * نشست ۱۴۵ · خوشه E · بند ۴-۳۹، ۴-۳۰ و ۴-۳۳ — گیت سمت سرور و actor غیرقابل‌جعل
 * برای عملیات «کالاها» که فهرست «فقط مدیر» بند ۴-۳۹ است:
 *   • اصلاح دستی موجودی (IPC.stockAdjust ← productService.adjustStock)
 *   • تغییر قیمت فروش/خرید یا موجودی یک واریانت موجود در ویرایش کالا
 *     (IPC.productUpsert ← productService.upsert)
 *   • حذف همیشگی کالا (IPC.productPurge ← variantPurgeService.purge)
 *   • actor حذف نرم/بازگردانی (IPC.productDelete/productRestore)
 *
 * قبل از رفع:
 *   ۱) IPC.stockAdjust فقط (variantId, newQty, note) را می‌داد ⇒ Audit
 *      STOCK_ADJUST با userId = null و هیچ رمزی سمت سرور لازم نبود.
 *   ۲) IPC.productUpsert payload خام renderer را می‌داد ⇒ userId قابل‌جعل در
 *      PRICE_EDIT و تغییر قیمت/موجودی بدون هیچ گیت main.
 *   ۳) IPC.productDelete/productRestore/productPurge userId را از payload
 *      می‌خواندند (جعل actor) و purge هیچ رمزی نمی‌خواست.
 * انتظار بعد از رفع: بدون رمز/رمز غلط ⇒ رد فارسی و صفر StockMovement/
 * PRICE_EDIT/حذف؛ با رمز ⇒ ثبت + Audit با actor نشست و scope تأیید؛ ثبت کالای
 * تازه و ویرایش بدون تغییر قیمت/موجودی رمز نمی‌خواهد؛ قفل خاموش پنل کالاها
 * (سیاست مدیر، بند ۴-۳۹) ⇒ بدون رمز با scope «OPEN» ثبت می‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s145-product-stock-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s145a-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

// IPC واقعی main: ipcMain.handle استاب را جایگزین می‌کنیم تا handlerها را خودمان صدا بزنیم.
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { productService } = await import('../../src/main/services/ProductService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون تأیید پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 90)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); return null }
}
/** IPC ⇒ {ok,data|error}؛ رد باید ok=false با پیام فارسی شامل needle باشد. */
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 90)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون تأیید پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 160)}`) }
  return r?.data
}

const movements = (vid) => seed.count('StockMovement', 'variantId = ?', vid)
const stockOf = (vid) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', vid)?.stock)
const priceOf = (vid) => seed.one('SELECT salePrice, purchasePrice FROM "ProductVariant" WHERE id = ?', vid)
const lastAudit = (action) => seed.one(`SELECT userId, before, after, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1`, action)
const auditCount = (action) => seed.count('AuditLog', 'action = ?', action)

// کارمند نشست باز (actor واقعی) و کارمند دیگری که renderer سعی می‌کند جایش جا بزند
const actor = seed.user('صندوق‌دار نشست باز ۱۴۵')
const forged = seed.user('کارمند جعلی ۱۴۵')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor })

const pid = seed.product('شلوار جین تست ۱۴۵')
const vid = seed.insert('ProductVariant', { productId: pid, code: 'S145-1', barcode: 'B145-1', salePrice: 1_000_000, purchasePrice: 600_000, stock: 0 })
// موجودی اولیه‌ی واقعی از مسیر دفتر (نه نوشتن مستقیم فیلد)
seed.insert('StockMovement', { variantId: vid, delta: 3, reason: 'INITIAL', state: 'FINAL', refType: 'Manual' })
db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 3 WHERE id = ?').run(vid)
const baseProduct = { id: pid, name: 'شلوار جین تست ۱۴۵', categoryId: null, unit: 'عدد', note: null }
const variantRow = (patch = {}) => ({ id: vid, code: 'S145-1', barcode: 'B145-1', size: null, color: null, salePrice: 1_000_000, purchasePrice: 600_000, stock: 3, ...patch })

console.log('\n۱) اصلاح دستی موجودی (سرویس) بدون رمز / رمز غلط ⇒ رد فارسی، صفر حرکت')
const m0 = movements(vid)
await rejects('adjustStock بدون رمز', () => productService.adjustStock({ variantId: vid, newQty: 1, note: 'تست بی‌رمز' }), 'تأیید مدیر')
await rejects('adjustStock رمز خالی', () => productService.adjustStock({ variantId: vid, newQty: 1, note: 'تست', managerPassword: '   ' }), 'تأیید مدیر')
await rejects('adjustStock رمز غلط', () => productService.adjustStock({ variantId: vid, newQty: 1, note: 'تست', managerPassword: 'wrong-0000' }), 'رمز')
eq('حرکت انبار پس از تلاش‌های بی‌مجوز', movements(vid), m0)
eq('موجودی دست‌نخورده', stockOf(vid), 3)
eq('Audit STOCK_ADJUST پس از تلاش‌های بی‌مجوز', auditCount('STOCK_ADJUST'), 0)

console.log('\n۲) validation عددی S144 پیش از رمز هم برقرار است')
await rejects('موجودی ۲٫۵ با رمز درست', () => productService.adjustStock({ variantId: vid, newQty: 2.5, note: 'تست', managerPassword: PW }), 'عدد صحیح')
eq('حرکت انبار', movements(vid), m0)

console.log('\n۳) IPC.stockAdjust: بدون رمز رد؛ با رمز ⇒ حرکت + Audit با actor نشست (نه userId ارسالی)')
await ipcRejects('IPC.stockAdjust بدون رمز', IPC.stockAdjust, { variantId: vid, newQty: 1, note: 'IPC بی‌رمز' }, 'تأیید مدیر')
eq('حرکت انبار پس از IPC بی‌رمز', movements(vid), m0)
await ipcOk('IPC.stockAdjust با رمز مدیر و userId جعلی', IPC.stockAdjust, { variantId: vid, newQty: 2, note: 'انبارگردانی ماهانه', userId: forged, managerPassword: PW })
eq('حرکت انبار تازه', movements(vid), m0 + 1)
eq('موجودی پس از اصلاح', stockOf(vid), 2)
let a = lastAudit('STOCK_ADJUST')
eq('actor در Audit STOCK_ADJUST = کارمند نشست', Number(a?.userId), actor)
truthy('scope تأیید (رمز مدیر) در Audit STOCK_ADJUST', /تأیید: رمز مدیر/.test(String(a?.note ?? '')))
eq('توضیح کاربر در دفتر گردش حفظ شد', seed.one('SELECT note FROM "StockMovement" WHERE variantId = ? ORDER BY id DESC LIMIT 1', vid)?.note, 'انبارگردانی ماهانه')

console.log('\n۴) ویرایش کالا: تغییر قیمت فروش/خرید یا موجودی واریانت موجود بدون رمز ⇒ رد کامل')
const pe0 = auditCount('PRICE_EDIT')
await rejects('upsert قیمت فروش تازه بدون رمز', () => productService.upsert({ ...baseProduct, variants: [variantRow({ salePrice: 700_000, stock: 2 })] }), 'تأیید مدیر')
await rejects('upsert قیمت خرید تازه بدون رمز', () => productService.upsert({ ...baseProduct, variants: [variantRow({ purchasePrice: 100_000, stock: 2 })] }), 'تأیید مدیر')
await rejects('upsert موجودی تازه بدون رمز', () => productService.upsert({ ...baseProduct, variants: [variantRow({ stock: 9 })] }), 'تأیید مدیر')
await rejects('upsert قیمت تازه با رمز غلط', () => productService.upsert({ ...baseProduct, managerPassword: 'wrong-0000', variants: [variantRow({ salePrice: 700_000, stock: 2 })] }), 'رمز')
eq('قیمت فروش دست‌نخورده', Number(priceOf(vid)?.salePrice), 1_000_000)
eq('قیمت خرید دست‌نخورده', Number(priceOf(vid)?.purchasePrice), 600_000)
eq('موجودی دست‌نخورده', stockOf(vid), 2)
eq('PRICE_EDIT تازه', auditCount('PRICE_EDIT'), pe0)
await ipcRejects('IPC.productUpsert قیمت تازه بدون رمز', IPC.productUpsert, { ...baseProduct, variants: [variantRow({ salePrice: 700_000, stock: 2 })] }, 'تأیید مدیر')
eq('قیمت فروش پس از IPC بی‌رمز', Number(priceOf(vid)?.salePrice), 1_000_000)

console.log('\n۵) ویرایش کالا با رمز ⇒ ثبت + PRICE_EDIT/STOCK_ADJUST با actor نشست و scope')
await ipcOk('IPC.productUpsert قیمت فروش/خرید و موجودی تازه با رمز و userId جعلی', IPC.productUpsert, {
  ...baseProduct, userId: forged, managerPassword: PW, variants: [variantRow({ salePrice: 1_100_000, purchasePrice: 650_000, stock: 5 })]
})
eq('قیمت فروش تازه', Number(priceOf(vid)?.salePrice), 1_100_000)
eq('قیمت خرید تازه', Number(priceOf(vid)?.purchasePrice), 650_000)
eq('موجودی تازه', stockOf(vid), 5)
const priceAudits = seed.rows(`SELECT userId, before, after, note FROM "AuditLog" WHERE action = 'PRICE_EDIT' ORDER BY id`)
const saleEdit = priceAudits.find((r) => r.before === '1000000' && r.after === '1100000')
const buyEdit = priceAudits.find((r) => /قیمت خرید/.test(String(r.note ?? '')))
truthy('PRICE_EDIT قیمت فروش با before/after قدیمی ثبت شد', !!saleEdit)
eq('actor در PRICE_EDIT قیمت فروش = کارمند نشست', Number(saleEdit?.userId), actor)
truthy('scope تأیید در PRICE_EDIT قیمت فروش', /تأیید: رمز مدیر/.test(String(saleEdit?.note ?? '')))
truthy('تغییر قیمت خرید هم Audit دارد (قبلاً هیچ ردی نمی‌ماند)', !!buyEdit && /600000/.test(String(buyEdit.before)) && /650000/.test(String(buyEdit.after)))
eq('actor در PRICE_EDIT قیمت خرید = کارمند نشست', Number(buyEdit?.userId), actor)
a = lastAudit('STOCK_ADJUST')
eq('actor در STOCK_ADJUST فرم کالا = کارمند نشست', Number(a?.userId), actor)
truthy('scope تأیید در STOCK_ADJUST فرم کالا', /تأیید: رمز مدیر/.test(String(a?.note ?? '')))

console.log('\n۶) بدون تغییر قیمت/موجودی و ثبت کالای تازه ⇒ رمز لازم نیست (تصمیم DECISIONS.md)')
const pe1 = auditCount('PRICE_EDIT')
const mv1 = movements(vid)
await safe('upsert فقط تغییر نام (قیمت و موجودی همان) بدون رمز', () => productService.upsert({ ...baseProduct, name: 'شلوار جین تست ۱۴۵ (نام تازه)', variants: [variantRow({ salePrice: 1_100_000, purchasePrice: 650_000, stock: 5 })] }))
await safe('upsert بدون فیلد موجودی (stock حذف‌شده = دست نزن) بدون رمز', () => productService.upsert({ ...baseProduct, variants: [variantRow({ salePrice: 1_100_000, purchasePrice: 650_000, stock: undefined })] }))
eq('PRICE_EDIT تازه', auditCount('PRICE_EDIT'), pe1)
eq('حرکت انبار تازه', movements(vid), mv1)
const newId = await safe('ثبت کالای کاملاً تازه با موجودی اولیه ۴ بدون رمز', () => ipc(IPC.productUpsert, { name: 'کالای تازه ۱۴۵', userId: forged, variants: [{ salePrice: 500_000, purchasePrice: 300_000, stock: 4 }] }).then((r) => { if (!r.ok) throw new Error(r.error); return r.data }))
const newVid = newId ? Number(seed.one('SELECT id FROM "ProductVariant" WHERE productId = ?', newId)?.id) : null
eq('موجودی اولیه‌ی کالای تازه', newVid ? stockOf(newVid) : null, 4)
eq('actor در STOCK_INITIAL کالای تازه = کارمند نشست', Number(lastAudit('STOCK_INITIAL')?.userId), actor)
await rejects('افزودن واریانت تازه همراه تغییر قیمت واریانت موجود بدون رمز ⇒ رد کامل', () => productService.upsert({ ...baseProduct, variants: [variantRow({ salePrice: 999_000, stock: 5 }), { salePrice: 400_000, purchasePrice: 0, stock: 1 }] }), 'تأیید مدیر')
eq('واریانت تازه در تلاش ردشده ساخته نشد', seed.count('ProductVariant', 'productId = ?', pid), 1)

console.log('\n۷) قفل پنل کالاها خاموش (سیاست مدیر، بند ۴-۳۹) ⇒ بدون رمز مجاز، scope «OPEN» در Audit')
seed.setting('panel.locks', { products: false })
await safe('adjustStock بدون رمز با قفل خاموش', () => productService.adjustStock({ variantId: vid, newQty: 6, note: 'قفل خاموش', userId: actor }))
eq('موجودی', stockOf(vid), 6)
truthy('scope «بدون قفل» در Audit ثبت شد', /تأیید: قفل پنل کالاها خاموش/.test(String(lastAudit('STOCK_ADJUST')?.note ?? '')))
seed.setting('panel.locks', { products: true })

console.log('\n۸) حذف نرم/بازگردانی: actor از نشست، نه payload')
await ipcOk('IPC.productDelete با userId جعلی', IPC.productDelete, { variantIds: [vid], userId: forged })
eq('actor در Audit DELETE = کارمند نشست', Number(lastAudit('DELETE')?.userId), actor)
await ipcOk('IPC.productRestore با userId جعلی', IPC.productRestore, { variantIds: [vid], userId: forged })
eq('actor در Audit PRODUCT_RESTORE = کارمند نشست', Number(lastAudit('PRODUCT_RESTORE')?.userId), actor)

console.log('\n۹) حذف همیشگی کالا (بند ۴-۳۹ «حذف دائمی کالا»): بدون رمز رد، با رمز ⇒ actor نشست')
const oldPid = seed.product('کالای قدیمی بی‌گردش ۱۴۵')
const oldVid = seed.insert('ProductVariant', { productId: oldPid, code: 'S145-OLD', barcode: 'B145-OLD', salePrice: 100_000, isActive: 0, deletedAt: Date.now() - 800 * 86_400_000 })
await ipcRejects('IPC.productPurge بدون رمز', IPC.productPurge, { variantIds: [oldVid], userId: forged }, 'تأیید مدیر')
eq('کالا پس از purge بی‌رمز هنوز هست', seed.count('ProductVariant', 'id = ?', oldVid), 1)
await ipcRejects('IPC.productPurge رمز غلط', IPC.productPurge, { variantIds: [oldVid], managerPassword: 'wrong-0000' }, 'رمز')
await ipcOk('IPC.productPurge با رمز مدیر و userId جعلی', IPC.productPurge, { variantIds: [oldVid], userId: forged, managerPassword: PW })
eq('کالا پاک شد', seed.count('ProductVariant', 'id = ?', oldVid), 0)
const pa = lastAudit('PRODUCT_PURGE')
eq('actor در Audit PRODUCT_PURGE = کارمند نشست', Number(pa?.userId), actor)
truthy('scope تأیید در Audit PRODUCT_PURGE', /تأیید: رمز مدیر/.test(String(pa?.note ?? '')))

console.log('\n۱۰) سیم‌کشی UI (ساختاری؛ رندر واقعی Electron اجرا نمی‌شود)')
const adj = readFileSync(resolve('src/renderer/src/components/StockAdjustModal.tsx'), 'utf8')
truthy('StockAdjustModal رمز را همراه stock:adjust می‌فرستد', /CH\.stockAdjust,[\s\S]{0,300}managerPassword/.test(adj))
truthy('StockAdjustModal فیلد رمز (PasswordField) دارد و از قفل پنل کالاها پیروی می‌کند', /<PasswordField/.test(adj) && /usePanelLock\(PANEL_KEYS\.products\)/.test(adj))
const form = readFileSync(resolve('src/renderer/src/components/ProductFormModal.tsx'), 'utf8')
truthy('ProductFormModal رمز را همراه product:upsert می‌فرستد', /CH\.productUpsert,[\s\S]{0,400}managerPassword/.test(form))
truthy('ProductFormModal فیلد رمز دارد و از قفل پنل کالاها پیروی می‌کند', /<PasswordField/.test(form) && /usePanelLock\(PANEL_KEYS\.products\)/.test(form))
truthy('ProductFormModal موجودی دست‌نخورده‌ی واریانت موجود را نمی‌فرستد (جلوگیری از اصلاح کاذب)', /stock:\s*v\.id\s*&&[\s\S]{0,160}\?\s*undefined/.test(form))
const page = readFileSync(resolve('src/renderer/src/pages/Products.tsx'), 'utf8')
truthy('Products.tsx رمز را همراه product:purge می‌فرستد', /CH\.productPurge,[\s\S]{0,200}managerPassword/.test(page))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
