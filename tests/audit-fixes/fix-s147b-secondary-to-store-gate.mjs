// نشست ۱۴۹: تست قبل/بعد S147-b. قبل (src zip ۱۴۸) ⇒ TESTLOG-s149b-before.txt؛ بعد ⇒ TESTLOG-s149-after.txt.
/**
 * ===========================================================================
 * نشست ۱۴۹ · خوشه E/K · S147-b · بند ۴-۳۹ («اصلاح موجودی/انتقال انبار مرکزی»)
 * و بند ۵ («هر گیت در main»، «audit شامل actor واقعی»)
 *
 * قبل از رفع:
 *   ۱) secondaryStockService.toStore (و IPC.secondaryStockToStore) هیچ گیت سمت سرور
 *      نداشت؛ فقط ManagerGate رندرر می‌بست، در حالی که همین مسیر موجودی واقعی فروشگاه
 *      را زیاد می‌کند (می‌تواند کسری انبارگردانی را بپوشاند).
 *   ۲) همه‌ی IPCهای تغییردهنده‌ی انبار مرکزی payload خام رندرر را می‌دادند ⇒ userId
 *      قابل‌جعل در AuditLog و SecondaryStockLog.
 * انتظار بعد از رفع: قفل روشن + بی‌رمز/رمز غلط ⇒ رد فارسی و صفر تغییر؛ با رمز ⇒ انجام
 * با actor نشست و scope در note؛ قفل خاموش ⇒ OPEN (رفتار «قفل ماژول‌ها»)؛ validation
 * عددی S147-a همچنان پیش از رمز.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s147b-secondary-to-store-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s147b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { secondaryStockService } = await import('../../src/main/services/SecondaryStockService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()

/**
 * ⚠️ به‌روزرسانی نشست ۱۸۶ · بند ۴-۳۹ — این سه خط رفتار سنجیده‌شده را عوض نمی‌کنند.
 *
 * از نشست ۱۸۶، نوشتن روی انبار مرکزی (`upsert`/`remove`/`transfer` و
 * انبارها) در سمت *سرور* هم گیت دارد: تا امروز فقط `toStore` گیت داشت و یک
 * فراخوانی مستقیم IPC می‌توانست موجودی انبار مرکزی را جابه‌جا کند.
 *
 * موضوع این تست، «actor از نشست می‌آید نه از payload» است، نه قفل. پس همان
 * کاری را می‌کند که کاربر واقعی می‌کند: اول قفل پنل انبار مرکزی را باز
 * می‌کند. (تست اختصاصی خودِ گیت: `fix-s186-review-high2.mjs`)
 */
const { notePanelUnlocked: __unlock186 } = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS: __PK186 } = await import('../../src/shared/panels.ts')
__unlock186(__PK186.secondaryStock, 'MANAGER')
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

const setLocks = (obj) => seed.setting(SETTING_KEYS.panelLocks, obj)
const moves = () => seed.count('StockMovement')
const stockOf = (vid) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', vid)?.stock)
const rowQty = (id) => Number(seed.one('SELECT qty FROM "SecondaryStockItem" WHERE id = ?', id)?.qty)
const auditCount = (action) => seed.count('AuditLog', 'action = ?', action)
const lastAudit = (action) => seed.one('SELECT userId, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', action)
const lastLog = () => seed.one('SELECT userId, action FROM "SecondaryStockLog" ORDER BY id DESC LIMIT 1')

const actor = seed.user('انباردار نشست باز ۱۴۹')
const forged = seed.user('کارمند جعلی ۱۴۹')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor })

const pid = seed.product('شلوار جین فروشگاه ۱۴۹')
const vid = seed.insert('ProductVariant', { productId: pid, code: 'S149-1', barcode: 'B149-1', salePrice: 1_000_000, stock: 0 })
const rowId = seed.insert('SecondaryStockItem', { name: 'شلوار جین مرکزی ۱۴۹', code: 'S149-1', qty: 10 })

console.log('\n۱) قفل «انتقال به انبار فروشگاه» روشن: سرویس بی‌رمز/رمز غلط ⇒ رد، صفر تغییر')
setLocks({ [PANEL_KEYS.secondaryToStore]: true })
const m1 = moves()
const a1 = auditCount('SECONDARY_TO_STORE')
await rejects('toStore بی‌رمز', () => secondaryStockService.toStore({ itemId: rowId, variantId: vid, qty: 2, userId: actor }), 'تأیید مدیر')
await rejects('toStore رمز خالی', () => secondaryStockService.toStore({ itemId: rowId, variantId: vid, qty: 2, toStorePassword: '   ' }), 'تأیید مدیر')
await rejects('toStore رمز غلط', () => secondaryStockService.toStore({ itemId: rowId, variantId: vid, qty: 2, toStorePassword: 'wrong-0000' }), 'رمز')
await rejects('validation عددی S147-a همچنان پیش از رمز (۲٫۵ بی‌رمز ⇒ پیام تعداد)', () => secondaryStockService.toStore({ itemId: rowId, variantId: vid, qty: 2.5 }), 'تعداد انتقال')
eq('موجودی فروشگاه دست‌نخورده', stockOf(vid), 0)
eq('ردیف مرکزی دست‌نخورده', rowQty(rowId), 10)
eq('حرکت انبار تازه‌ای ثبت نشد', moves(), m1)
eq('Audit انتقال به فروشگاه تازه‌ای ثبت نشد', auditCount('SECONDARY_TO_STORE'), a1)

console.log('\n۲) IPC: بی‌رمز ⇒ رد؛ با رمز مدیر و userId جعلی ⇒ انجام با actor نشست و scope در note')
await ipcRejects('IPC.secondaryStockToStore بی‌رمز', IPC.secondaryStockToStore, { itemId: rowId, variantId: vid, qty: 2, userId: forged }, 'تأیید مدیر')
eq('موجودی فروشگاه پس از IPC بی‌رمز', stockOf(vid), 0)
await ipcOk('IPC.secondaryStockToStore با رمز مدیر', IPC.secondaryStockToStore, { itemId: rowId, variantId: vid, qty: 2, userId: forged, toStorePassword: PW })
eq('موجودی فروشگاه ۰ ⇒ ۲', stockOf(vid), 2)
eq('ردیف مرکزی ۱۰ ⇒ ۸', rowQty(rowId), 8)
let a = lastAudit('SECONDARY_TO_STORE')
eq('actor در Audit SECONDARY_TO_STORE = کارمند نشست (نه userId جعلی)', Number(a?.userId), actor)
truthy('scope تأیید قفل در note Audit', /تأیید قفل انتقال به انبار فروشگاه: MANAGER/.test(String(a?.note ?? '')))
eq('actor در سابقه‌ی انبار مرکزی = کارمند نشست', Number(lastLog()?.userId), actor)

console.log('\n۳) قفل خاموش ⇒ بی‌رمز باز (OPEN)، مثل سیاست «قفل ماژول‌ها»')
setLocks({ [PANEL_KEYS.secondaryToStore]: false })
await safe('toStore بی‌رمز با قفل خاموش', () => secondaryStockService.toStore({ itemId: rowId, variantId: vid, qty: 1, userId: actor }))
eq('موجودی فروشگاه ۲ ⇒ ۳', stockOf(vid), 3)
truthy('scope OPEN در note Audit', /تأیید قفل انتقال به انبار فروشگاه: OPEN/.test(String(lastAudit('SECONDARY_TO_STORE')?.note ?? '')))

console.log('\n۴) بقیه‌ی IPCهای تغییردهنده‌ی انبار مرکزی ⇒ actor از نشست main (userId رندرر نادیده)')
const created = await ipcOk('IPC.secondaryStockUpsert (ثبت) با userId جعلی', IPC.secondaryStockUpsert, { name: 'کاپشن مرکزی ۱۴۹', qty: 4, userId: forged })
eq('actor در Audit SECONDARY_STOCK_CREATE', Number(lastAudit('SECONDARY_STOCK_CREATE')?.userId), actor)
eq('actor در سابقه‌ی ثبت', Number(lastLog()?.userId), actor)
await ipcOk('IPC.secondaryStockUpsert (ویرایش) با userId جعلی', IPC.secondaryStockUpsert, { id: Number(created?.id), name: 'کاپشن مرکزی ۱۴۹', qty: 5, userId: forged })
eq('actor در Audit SECONDARY_STOCK_UPDATE', Number(lastAudit('SECONDARY_STOCK_UPDATE')?.userId), actor)
const house = await ipcOk('IPC.secondaryWarehouseUpsert با userId جعلی', IPC.secondaryWarehouseUpsert, { name: 'انبار شعبه ۱۴۹', userId: forged })
eq('actor در Audit SECONDARY_WAREHOUSE_CREATE', Number(lastAudit('SECONDARY_WAREHOUSE_CREATE')?.userId), actor)
await ipcOk('IPC.secondaryStockTransfer با userId جعلی', IPC.secondaryStockTransfer, { itemId: Number(created?.id), toWarehouseId: Number(house?.id), qty: 1, userId: forged })
eq('actor در Audit SECONDARY_STOCK_TRANSFER', Number(lastAudit('SECONDARY_STOCK_TRANSFER')?.userId), actor)
await ipcOk('IPC.secondaryStockDelete با userId جعلی', IPC.secondaryStockDelete, { ids: [Number(created?.id)], userId: forged })
eq('actor در Audit SECONDARY_STOCK_DELETE', Number(lastAudit('SECONDARY_STOCK_DELETE')?.userId), actor)
await ipcOk('IPC.secondaryWarehouseDelete با userId جعلی', IPC.secondaryWarehouseDelete, { id: Number(house?.id), userId: forged })
eq('actor در Audit SECONDARY_WAREHOUSE_DELETE', Number(lastAudit('SECONDARY_WAREHOUSE_DELETE')?.userId), actor)
setLocks({ [PANEL_KEYS.secondaryToStore]: false, [PANEL_KEYS.secondaryToStoreNewProduct]: false })
await ipcOk('IPC.secondaryStockToStoreNew با userId جعلی (قفل‌ها خاموش)', IPC.secondaryStockToStoreNew, { itemId: rowId, qty: 1, name: 'کالای تازه ۱۴۹', salePrice: 900_000, userId: forged })
eq('actor در Audit SECONDARY_TO_STORE_NEW_PRODUCT', Number(lastAudit('SECONDARY_TO_STORE_NEW_PRODUCT')?.userId), actor)

console.log('\n۵) سیم‌کشی UI (ساختاری؛ رندر واقعی Electron اجرا نمی‌شود)')
const page = readFileSync(resolve('src/renderer/src/pages/SecondaryStock.tsx'), 'utf8')
truthy('صفحه قفل را با usePanelLock(PANEL_KEYS.secondaryToStore) می‌خواند (fail-closed)', /usePanelLock\(PANEL_KEYS\.secondaryToStore\)/.test(page) && /!toStoreLockLoaded \|\| toStoreLock/.test(page))
truthy('صفحه PasswordField دارد', page.includes("import PasswordField from '../components/PasswordField'") && page.includes('<PasswordField value={toStorePw}'))
truthy('صفحه toStorePassword را همراه انتقال به فروشگاه می‌فرستد', /toStorePassword: toStorePw\.trim\(\) \|\| null/.test(page))
const types = readFileSync(resolve('src/shared/types.ts'), 'utf8')
const toStoreType = types.slice(types.indexOf('export interface SecondaryToStoreInput'), types.indexOf('export interface SecondaryToStoreResult'))
truthy('نوع SecondaryToStoreInput فیلد toStorePassword دارد', toStoreType.includes('toStorePassword?: string | null'))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
