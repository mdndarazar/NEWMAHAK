// نشست ۱۵۰: تست قبل/بعد S150-a (PriceAdjustService.ruleOf + سقف قیمت حاصل + گیت main تغییر گروهی قیمت).
/**
 * ===========================================================================
 * نشست ۱۵۰ · خوشه E/K · بند ۴-۲۸(د)، ۴-۳۹ («تغییر گروهی قیمت»)، ۴-۳۰ و بند ۵
 *
 * قبل از رفع:
 *   ۱) ruleOf ورودی را بی‌صدا تبدیل می‌کرد: ۱۰٫۶٪ ⇒ ۱۱٪، مبلغ ۱۵۰۰٫۵ ⇒ ۱۵۰۱، «10» متنی ⇒ ۱۰،
 *      رُند ۲٫۵ ⇒ ۳ و ‎-۱۰۰۰ ⇒ ۱، کف ‎-۱ ⇒ ۰ و ۲٫۵ ⇒ ۳؛ مبلغ/کف بی‌سقف.
 *   ۲) قیمت حاصل (مثلاً ۲٬۰۰۰٬۰۰۰٬۰۰۰ + ۱۰٪) بی‌سقف در ستون Int نوشته می‌شد.
 *   ۳) apply/revert/editBatch/deleteBatches هیچ گیت main نداشتند (فقط ManagerGate رندرر)
 *      و userId از payload رندرر (قابل جعل) در سابقه و Audit می‌نشست.
 * انتظار بعد: رد فارسی بدون گرد کردن؛ سقف ۲٬۱۴۷٬۴۸۳٬۶۴۷ ریال پیش از هر نوشتن؛ گیت
 * PANEL_KEYS.priceAdjust (رمز مدیر یا رمز دوم همین پنل؛ قفل خاموش ⇒ OPEN) پیش از
 * تراکنش با scope در note Audit؛ actor از نشست main.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s150-price-adjust-rule-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s150-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { priceAdjustService } = await import('../../src/main/services/PriceAdjustService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
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
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون خطا پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 100)})`) }
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
const priceOf = (vid) => Number(seed.one('SELECT salePrice FROM "ProductVariant" WHERE id = ?', vid)?.salePrice)
const batches = () => seed.count('PriceChangeBatch')
const lastAudit = (action = 'PRICE_BULK_ADJUST') => seed.one('SELECT userId, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', action)
const auditN = () => seed.count('AuditLog', 'action = ?', 'PRICE_BULK_ADJUST')

const actor = seed.user('مدیر نشست باز ۱۵۰')
const forged = seed.user('کارمند جعلی ۱۵۰')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor })

const pid = seed.product('شلوار جین ۱۵۰')
const vA = seed.insert('ProductVariant', { productId: pid, code: 'S150-A', barcode: 'B150-A', salePrice: 1_000_000, stock: 1 })
const pidBig = seed.product('کت گران ۱۵۰')
const vBig = seed.insert('ProductVariant', { productId: pidBig, code: 'S150-BIG', barcode: 'B150-BIG', salePrice: 2_000_000_000, stock: 1 })
const one = (extra = {}) => ({ kind: 'INCREASE', mode: 'PERCENT', value: 10, scope: 'VARIANTS', variantIds: [vA], ...extra })

console.log('\n۱) ruleOf سخت: اعشار/متن/سقف با پیام فارسی رد می‌شود، نه گرد بی‌صدا (preview، بی‌رمز)')
await rejects('درصد ۱۰٫۶ (قبلاً بی‌صدا ۱۱٪)', () => priceAdjustService.preview(one({ value: 10.6 })), 'درصد')
await rejects('درصد «10» متنی', () => priceAdjustService.preview(one({ value: '10' })), 'درصد')
await rejects('درصد NaN', () => priceAdjustService.preview(one({ value: Number.NaN })), 'درصد')
await rejects('درصد صفر', () => priceAdjustService.preview(one({ value: 0 })), 'درصد')
await rejects('درصد منفی', () => priceAdjustService.preview(one({ value: -5 })), 'درصد')
await rejects('درصد ۱۰۱', () => priceAdjustService.preview(one({ value: 101 })), '۱۰۰')
await rejects('مبلغ ۱۵۰۰٫۵ (قبلاً بی‌صدا ۱۵۰۱)', () => priceAdjustService.preview(one({ mode: 'AMOUNT', value: 1500.5 })), 'مبلغ')
await rejects('مبلغ ۳٬۰۰۰٬۰۰۰٬۰۰۰ بیش از سقف', () => priceAdjustService.preview(one({ mode: 'AMOUNT', value: 3e9 })), 'سقف')
await rejects('رُند ۲٫۵', () => priceAdjustService.preview(one({ round: 2.5 })), 'رُند')
await rejects('رُند صفر', () => priceAdjustService.preview(one({ round: 0 })), 'رُند')
await rejects('رُند ‎-۱۰۰۰', () => priceAdjustService.preview(one({ round: -1000 })), 'رُند')
await rejects('کف قیمت ۲٫۵', () => priceAdjustService.preview(one({ minPrice: 2.5 })), 'کف')
await rejects('کف قیمت ‎-۱', () => priceAdjustService.preview(one({ minPrice: -1 })), 'کف')
await rejects('کف قیمت ۳e9', () => priceAdjustService.preview(one({ minPrice: 3e9 })), 'سقف')
const p1 = await safe('preview معتبر ۱۰٪ (رُند/کف ارسال‌نشده ⇒ پیش‌فرض ۱ و ۰)', () => priceAdjustService.preview(one()))
eq('پیش‌نمایش ۱٬۰۰۰٬۰۰۰ + ۱۰٪', p1?.lines?.[0]?.newPrice, 1_100_000)
const p2 = await safe('preview معتبر با رُند ۱۰۰۰ و کف ۰ صریح', () => priceAdjustService.preview(one({ round: 1000, minPrice: 0 })))
eq('پیش‌نمایش با رُند ۱۰۰۰', p2?.lines?.[0]?.newPrice, 1_100_000)

console.log('\n۲) سقف قیمت حاصل: ۲٬۰۰۰٬۰۰۰٬۰۰۰ + ۱۰٪ ⇒ رد پیش از هر نوشتن')
setLocks({ [PANEL_KEYS.priceAdjust]: false })
const bigRule = { kind: 'INCREASE', mode: 'PERCENT', value: 10, scope: 'VARIANTS', variantIds: [vA, vBig] }
await rejects('preview حاصل بیش از سقف', () => priceAdjustService.preview(bigRule), 'سقف')
const b0 = batches()
await rejects('apply حاصل بیش از سقف', () => priceAdjustService.apply(bigRule), 'سقف')
eq('قیمت کالای گران دست‌نخورده', priceOf(vBig), 2_000_000_000)
eq('قیمت کالای دیگر همان دسته هم دست‌نخورده (اتمیک)', priceOf(vA), 1_000_000)
eq('هیچ دسته‌ای ثبت نشد', batches(), b0)
await rejects('apply مبلغ ثابت که حاصلش بیش از سقف است', () => priceAdjustService.apply({ kind: 'INCREASE', mode: 'AMOUNT', value: 200_000_000, scope: 'VARIANTS', variantIds: [vBig] }), 'سقف')
eq('قیمت کالای گران پس از مبلغ ثابت دست‌نخورده', priceOf(vBig), 2_000_000_000)

console.log('\n۳) گیت main: قفل «تغییر قیمت گروهی» روشن ⇒ بی‌رمز/رمز غلط رد، صفر تغییر')
setLocks({ [PANEL_KEYS.priceAdjust]: true })
const a0 = auditN()
await rejects('apply بی‌رمز', () => priceAdjustService.apply(one()), 'تأیید مدیر')
await rejects('apply رمز خالی', () => priceAdjustService.apply(one({ password: '   ' })), 'تأیید مدیر')
await rejects('apply رمز غلط', () => priceAdjustService.apply(one({ password: 'wrong-0000' })), 'رمز')
await rejects('validation پیش از رمز (۱۰٫۶٪ بی‌رمز ⇒ پیام درصد)', () => priceAdjustService.apply(one({ value: 10.6 })), 'درصد')
await rejects('زمان‌بندی آینده هم بی‌رمز رد', () => priceAdjustService.apply(one({ startDate: '1499/01/01' })), 'تأیید مدیر')
eq('قیمت دست‌نخورده', priceOf(vA), 1_000_000)
eq('دسته‌ای ثبت نشد', batches(), b0)
eq('Audit تغییر قیمت تازه‌ای ثبت نشد', auditN(), a0)

console.log('\n۴) IPC با رمز مدیر و userId جعلی ⇒ انجام با actor نشست و scope در note')
await ipcRejects('IPC.priceAdjustApply بی‌رمز', IPC.priceAdjustApply, { ...one(), userId: forged }, 'تأیید مدیر')
const r1 = await ipcOk('IPC.priceAdjustApply با رمز مدیر', IPC.priceAdjustApply, { ...one(), userId: forged, password: PW })
eq('قیمت ۱٬۰۰۰٬۰۰۰ ⇒ ۱٬۱۰۰٬۰۰۰', priceOf(vA), 1_100_000)
const batchId = Number(r1?.batchId)
eq('userId دسته = کارمند نشست (نه جعلی)', Number(seed.one('SELECT userId FROM "PriceChangeBatch" WHERE id = ?', batchId)?.userId), actor)
let a = lastAudit()
eq('actor Audit = کارمند نشست', Number(a?.userId), actor)
truthy('scope در note Audit', /تأیید قفل تغییر گروهی قیمت: MANAGER/.test(String(a?.note ?? '')))

console.log('\n۵) ویرایش دامنه / بازگردانی / حذف سابقه هم گیت دارند')
const vC = seed.insert('ProductVariant', { productId: pid, code: 'S150-C', barcode: 'B150-C', salePrice: 500_000, stock: 1 })
await rejects('editBatch بی‌رمز', () => priceAdjustService.editBatch({ batchId, scope: 'VARIANTS', variantIds: [vA, vC] }), 'تأیید مدیر')
eq('کالای C دست‌نخورده', priceOf(vC), 500_000)
await ipcOk('IPC.priceAdjustBatchEdit با رمز', IPC.priceAdjustBatchEdit, { batchId, scope: 'VARIANTS', variantIds: [vA, vC], userId: forged, password: PW })
eq('کالای C ۵۰۰٬۰۰۰ ⇒ ۵۵۰٬۰۰۰', priceOf(vC), 550_000)
eq('actor Audit ویرایش = نشست', Number(lastAudit('PRICE_BATCH_EDIT')?.userId), actor)
truthy('scope ویرایش در note', /تأیید قفل تغییر گروهی قیمت: MANAGER/.test(String(lastAudit('PRICE_BATCH_EDIT')?.note ?? '')))
await rejects('revert بی‌رمز', () => priceAdjustService.revert({ batchId }), 'تأیید مدیر')
eq('قیمت A پس از revert بی‌رمز همان', priceOf(vA), 1_100_000)
await ipcOk('IPC.priceAdjustRevert با رمز', IPC.priceAdjustRevert, { batchId, userId: forged, password: PW })
eq('قیمت A برگشت', priceOf(vA), 1_000_000)
eq('قیمت C برگشت', priceOf(vC), 500_000)
eq('actor Audit بازگردانی = نشست', Number(lastAudit('PRICE_BULK_REVERT')?.userId), actor)
truthy('scope بازگردانی در note', /تأیید قفل تغییر گروهی قیمت: MANAGER/.test(String(lastAudit('PRICE_BULK_REVERT')?.note ?? '')))
const nb = batches()
await rejects('deleteBatches بی‌رمز', () => priceAdjustService.deleteBatches({ batchIds: [batchId], restorePrices: false }), 'تأیید مدیر')
eq('ردیف سابقه باقی ماند', batches(), nb)
await ipcOk('IPC.priceAdjustBatchesDelete با رمز', IPC.priceAdjustBatchesDelete, { batchIds: [batchId], restorePrices: false, userId: forged, password: PW })
eq('actor Audit حذف سابقه = نشست', Number(lastAudit('PRICE_HISTORY_DELETE')?.userId), actor)
truthy('scope حذف سابقه در note', /تأیید قفل تغییر گروهی قیمت: MANAGER/.test(String(lastAudit('PRICE_HISTORY_DELETE')?.note ?? '')))

console.log('\n۶) قفل خاموش ⇒ بی‌رمز باز (OPEN)')
setLocks({ [PANEL_KEYS.priceAdjust]: false })
await safe('apply بی‌رمز با قفل خاموش', () => priceAdjustService.apply(one({ userId: actor })))
eq('قیمت A ⇒ ۱٬۱۰۰٬۰۰۰', priceOf(vA), 1_100_000)
truthy('scope OPEN در note', /تأیید قفل تغییر گروهی قیمت: OPEN/.test(String(lastAudit()?.note ?? '')))

console.log('\n۷) زمان‌بند: قرار ثبت‌شده که لحظه‌ی شروع حاصلش بیش از سقف است ⇒ شکست ثبت‌شده با علت، بدون نوشتن')
const vD = seed.insert('ProductVariant', { productId: pid, code: 'S150-D', barcode: 'B150-D', salePrice: 1_000_000, stock: 1 })
const past = Date.now() - 60_000
const sbId = seed.insert('PriceChangeBatch', { kind: 'INCREASE', mode: 'PERCENT', value: 10, target: 'SALE', scope: 'VARIANTS', roundStep: 1, minPrice: 0, title: 'قرار ۱۵۰', itemCount: 0, deltaTotal: 0, at: past, atJalali: jalaliToday(), atTime: '00:00', state: 'SCHEDULED', startAt: past, variantIdsJson: JSON.stringify([vD]) })
seed.one('UPDATE "ProductVariant" SET salePrice = 2000000000 WHERE id = ?', vD)
const rs = await safe('runDueSchedules بدون پرتاب خطا', () => priceAdjustService.runDueSchedules(new Date()))
eq('یک قرار شکست خورد', rs?.failed, 1)
eq('قیمت کالای D دست‌نخورده', priceOf(vD), 2_000_000_000)
// رفتار موجود markScheduleFailure: قرار شکست‌خورده بی‌صدا نمی‌ماند؛ ENDED + یادداشت علت (S150-D4)
const sb = seed.one('SELECT state, note FROM "PriceChangeBatch" WHERE id = ?', sbId)
eq('قرار شکست‌خورده با وضعیت ENDED کنار گذاشته شد (نه APPLIED)', String(sb?.state), 'ENDED')
truthy('یادداشت قرار علت فارسی «سقف» را دارد', /سقف/.test(String(sb?.note ?? '')))

console.log('\n۸) سیم‌کشی UI و نوع‌ها (ساختاری؛ رندر واقعی Electron اجرا نمی‌شود)')
const page = readFileSync(resolve('src/renderer/src/pages/PriceAdjust.tsx'), 'utf8')
truthy('usePanelLock(PANEL_KEYS.priceAdjust) با fail-closed', /usePanelLock\(PANEL_KEYS\.priceAdjust\)/.test(page) && /!adjustLockLoaded \|\| adjustLock/.test(page))
truthy('PasswordField در صفحه', page.includes("import PasswordField from '../components/PasswordField'") && page.includes('<PasswordField value={adjustPw}'))
truthy('رمز همراه apply/revert/edit/delete فرستاده می‌شود', (page.match(/password: adjustPw\.trim\(\) \|\| null/g) ?? []).length >= 4)
truthy('onChange مقدار دیگر گرد/clamp نمی‌کند', !page.includes('Math.min(100, raw) : Math.round(raw)'))
truthy('onChange کف قیمت دیگر گرد نمی‌کند', !page.includes('setMinPrice(Math.max(0, Math.round(+e.target.value || 0)))'))
truthy('blocker برای درصد/مبلغ اعشاری پیام فارسی دارد', page.includes('باید عدد صحیح باشد'))
const types = readFileSync(resolve('src/shared/types.ts'), 'utf8')
const sl = (a, b) => types.slice(types.indexOf(a), types.indexOf(b, types.indexOf(a)))
truthy('PriceAdjustInput.password', sl('export interface PriceAdjustInput', '}').includes('password?: string | null'))
truthy('PriceAdjustEditInput.password', sl('export interface PriceAdjustEditInput', '}').includes('password?: string | null'))
truthy('PriceAdjustDeleteInput.password', sl('export interface PriceAdjustDeleteInput', '}').includes('password?: string | null'))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
