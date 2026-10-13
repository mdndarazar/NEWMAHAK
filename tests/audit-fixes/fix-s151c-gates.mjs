// نشست ۱۵۵: تست قبل/بعد S151-c1. قبل روی کپی دست‌نخورده‌ی zip ورودی ⇒ TESTLOG-s155c1-before.txt، بعد ⇒ TESTLOG-s155c1-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۵ · خوشه E/K · S151-c1 · گیت‌های main (بند ۴-۲۹، ۴-۳۹، ۴-۲۲ و بند ۵ «هر گیت در main»)
 *
 * قبل از رفع:
 *   ۱) IPC.settingsSaveBundle بخش‌های security/sale/shift/time/charges را بی‌رمز می‌نوشت
 *      (همان کلیدهایی که settings:set خام فقط با رمز مدیر می‌پذیرد) ⇒ یافته‌ی Y10.
 *   ۲) IPC.chargesSave (نرخ عوارض/حق سرویس) هیچ گیت سمت سرور نداشت.
 *   ۳) IPC.purchaseCreate/Update نه گیت پنل خرید داشتند نه actor نشست (userId رندرر پذیرفته).
 *   ۴) IPC.customerDelete مشتری دارای فاکتور را با force بی‌رمز و غیراتمیک حذف و
 *      customerId فاکتورهای *بدهکار* را null می‌کرد (پیوند بدهی نسیه گم) ⇒ Y5.
 * انتظار بعد از رفع: S155-D1 تا S155-D5 در DECISIONS.md.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s151c-gates.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s151c-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// IPC اکنون فقط درخواستِ پنجرهٔ معتبر را وارد گیت‌های مالی می‌کند. sender
// ساختگیِ زنده، آزمون را به سیاست‌های واقعی رمز/actor می‌رساند.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15104, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
const { chargeSettingKey } = await import('@shared/charges')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 110)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون تأیید پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
  return r
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 160)}`) }
  return r?.data
}
const settingRaw = (key) => seed.one('SELECT value FROM "Setting" WHERE key = ?', key)?.value ?? null
const lastAudit = (action, entity) =>
  seed.one(`SELECT id, userId, note, before, after FROM "AuditLog" WHERE action = ?${entity ? ' AND entity = ?' : ''} ORDER BY id DESC LIMIT 1`, ...(entity ? [action, entity] : [action]))
const auditCount = () => seed.count('AuditLog')

const actor = seed.user('مدیر نشست باز ۱۵۵')
const forged = seed.user('کارمند جعلی ۱۵۵')
seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })

console.log('\n۱) settingsSaveBundle: بخش‌های حساس تغییرکرده بی‌رمز مدیر ⇒ رد، پیش از هر نوشتن')
const b0 = await settingsService.bundle()
const secChanged = { ...b0.security, maxAttempts: b0.security.maxAttempts === 7 ? 8 : 7 }
const shiftChanged = { ...b0.shift, byTime: !b0.shift.byTime }
const timeChanged = { ...b0.time, offsetHours: (b0.time.offsetHours ?? 0) === 1 ? 2 : 1 }
const saleTax = { ...b0.sale, returnCodeDays: b0.sale.returnCodeDays === 9 ? 10 : 9 }
const receiptChanged = { ...b0.receipt, footer: 'پانویس تازه ۱۵۵' }

let secBefore = settingRaw(SETTING_KEYS.securityConfig)
await ipcRejects('security تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { security: secChanged }, 'رمز مدیر')
eq('securityConfig دست‌نخورده', settingRaw(SETTING_KEYS.securityConfig), secBefore)
const rcBefore = settingRaw(SETTING_KEYS.receiptTemplate)
await ipcRejects('receipt + security تغییرکرده بی‌رمز (کل درخواست رد)', IPC.settingsSaveBundle, { receipt: receiptChanged, security: secChanged }, 'رمز مدیر')
eq('receiptTemplate هم نوشته نشد (گیت پیش از هر نوشتن)', settingRaw(SETTING_KEYS.receiptTemplate), rcBefore)
await ipcRejects('security تغییرکرده با رمز غلط', IPC.settingsSaveBundle, { security: secChanged, managerPassword: 'wrong-155' }, 'رمز')
await ipcOk('security بدون تغییر بی‌رمز ⇒ پذیرفته', IPC.settingsSaveBundle, { security: b0.security })
const a0 = auditCount()
await ipcOk('security تغییرکرده با رمز مدیر و userId جعلی ⇒ پذیرفته', IPC.settingsSaveBundle, { security: secChanged, managerPassword: PW, userId: forged })
eq('maxAttempts ذخیره شد', (await settingsService.securityConfig()).maxAttempts, secChanged.maxAttempts)
truthy('Audit نوشته شد', auditCount() > a0)
eq('actor Audit ذخیره‌ی کلی = کارمند نشست', Number(lastAudit('SETTINGS_UPDATE', 'Setting')?.userId), actor)

let shBefore = settingRaw(SETTING_KEYS.shiftConfig)
await ipcRejects('shift تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { shift: shiftChanged }, 'رمز مدیر')
eq('shiftConfig دست‌نخورده', settingRaw(SETTING_KEYS.shiftConfig), shBefore)
await ipcOk('shift تغییرکرده با رمز مدیر ⇒ پذیرفته', IPC.settingsSaveBundle, { shift: shiftChanged, managerPassword: PW })

let tBefore = settingRaw(SETTING_KEYS.officialTime)
await ipcRejects('time تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { time: timeChanged }, 'رمز مدیر')
eq('officialTime دست‌نخورده', settingRaw(SETTING_KEYS.officialTime), tBefore)
await ipcOk('time تغییرکرده با رمز مدیر ⇒ پذیرفته', IPC.settingsSaveBundle, { time: timeChanged, managerPassword: PW })

let sBefore = settingRaw(SETTING_KEYS.saleDefaults)
await ipcRejects('sale (مهلت کد برگشت) تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { sale: saleTax }, 'رمز مدیر')
eq('saleDefaults دست‌نخورده', settingRaw(SETTING_KEYS.saleDefaults), sBefore)
await ipcRejects('sale (درصد عوارض قدیمی) تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { sale: { ...b0.sale, taxPercent: 9 } }, 'رمز مدیر')
await ipcOk('sale تغییرکرده با رمز مدیر ⇒ پذیرفته', IPC.settingsSaveBundle, { sale: saleTax, managerPassword: PW })
eq('returnCodeDays ذخیره شد', (await settingsService.saleDefaults()).returnCodeDays, saleTax.returnCodeDays)

console.log('\n۲) مسیرهای رسمی POS که فقط sale می‌فرستند (Pos.tsx ~۳۰۳، useAutoCentralWithdraw ~۸۶)')
let cur = await settingsService.saleDefaults()
// نشست ۱۶۶ (S166-D4/D5) — S155-D2 بازنگری شد: printEnabled حالا رمز پنل posPrintToggle می‌خواهد (قبلاً بی‌رمز =
// همان حفره‌ی «posPrintToggle فقط UI»). قصد این بند (مسیر رسمی Pos.tsx فقط sale با یک فیلد عوض‌شده می‌فرستد و فقط گیت
// همان فیلد را می‌خورد) حفظ شد؛ فقط panelPassword به setup اضافه شد. تست کامل: fix-s166-print-toggle-gate.mjs.
await ipcOk('فقط printEnabled عوض شد با رمز پنل چاپ ⇒ پذیرفته (S166-D4)', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: !cur.printEnabled }, panelPassword: PW })
eq('printEnabled ذخیره شد', (await settingsService.saleDefaults()).printEnabled, !cur.printEnabled)
cur = await settingsService.saleDefaults()
await ipcRejects('printEnabled + returnCodeDays بی‌رمز ⇒ رد (میان‌بر نیست)', IPC.settingsSaveBundle, { sale: { ...cur, printEnabled: !cur.printEnabled, returnCodeDays: 30 } }, 'رمز')
cur = await settingsService.saleDefaults()
await ipcRejects('autoCentralWithdraw بی‌رمز با قفل روشن ⇒ رد', IPC.settingsSaveBundle, { sale: { ...cur, autoCentralWithdraw: !cur.autoCentralWithdraw } }, 'رمز')
eq('autoCentralWithdraw دست‌نخورده', (await settingsService.saleDefaults()).autoCentralWithdraw, cur.autoCentralWithdraw)
await ipcOk('autoCentralWithdraw با رمز (panelPassword) ⇒ پذیرفته', IPC.settingsSaveBundle, { sale: { ...cur, autoCentralWithdraw: !cur.autoCentralWithdraw }, panelPassword: PW })
eq('autoCentralWithdraw ذخیره شد', (await settingsService.saleDefaults()).autoCentralWithdraw, !cur.autoCentralWithdraw)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.posCentralWithdrawToggle]: false })
cur = await settingsService.saleDefaults()
await ipcOk('autoCentralWithdraw بی‌رمز با قفل خاموش ⇒ پذیرفته', IPC.settingsSaveBundle, { sale: { ...cur, autoCentralWithdraw: !cur.autoCentralWithdraw } })
seed.setting(SETTING_KEYS.panelLocks, {})
await ipcOk('sale بدون تغییر بی‌رمز ⇒ پذیرفته', IPC.settingsSaveBundle, { sale: await settingsService.saleDefaults() })
await ipcOk('فقط receipt و label (غیرحساس) بی‌رمز ⇒ پذیرفته', IPC.settingsSaveBundle, { receipt: receiptChanged, label: b0.label })

console.log('\n۳) charges از ذخیره‌ی کلی: رمز پنل همان kind/scope')
const newCharge = { enabled: true, rules: [], fallback: { mode: 'PERCENT', value: 9 } }
const taxPosKey = chargeSettingKey('tax', 'pos')
let cBefore = settingRaw(taxPosKey)
await ipcRejects('charges.pos.tax تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { charges: { pos: { tax: newCharge } } }, 'رمز')
eq('کلید عوارض دست‌نخورده', settingRaw(taxPosKey), cBefore)
await ipcOk('charges بدون تغییر بی‌رمز ⇒ پذیرفته', IPC.settingsSaveBundle, { charges: await settingsService.charges() })
await ipcOk('charges.pos.tax تغییرکرده با panelPassword ⇒ پذیرفته', IPC.settingsSaveBundle, { charges: { pos: { tax: newCharge } }, panelPassword: PW })

console.log('\n۴) chargesSave: گیت سرور با کلید kind/scope و actor نشست')
const svcWKey = chargeSettingKey('service', 'wholesale')
cBefore = settingRaw(svcWKey)
await ipcRejects('chargesSave (حق سرویس عمده) بی‌رمز با قفل روشن', IPC.chargesSave, { kind: 'service', scope: 'wholesale', config: newCharge }, 'رمز')
eq('کلید حق سرویس عمده دست‌نخورده', settingRaw(svcWKey), cBefore)
await ipcRejects('chargesSave با رمز غلط', IPC.chargesSave, { kind: 'service', scope: 'wholesale', config: newCharge, panelPassword: 'wrong-155' }, 'رمز')
await ipcOk('chargesSave با رمز مدیر و userId جعلی ⇒ پذیرفته', IPC.chargesSave, { kind: 'service', scope: 'wholesale', config: newCharge, panelPassword: PW, userId: forged })
eq('actor Audit chargesSave = کارمند نشست', Number(lastAudit('SETTINGS_UPDATE', 'Setting')?.userId), actor)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.chargesTaxWholesale]: false })
await ipcOk('chargesSave عوارض عمده بی‌رمز با قفل همان پنل خاموش ⇒ پذیرفته', IPC.chargesSave, { kind: 'tax', scope: 'wholesale', config: newCharge })
await ipcRejects('قفل پنل دیگر خاموش ⇒ حق سرویس خرده همچنان رمز می‌خواهد', IPC.chargesSave, { kind: 'service', scope: 'pos', config: newCharge }, 'رمز')
seed.setting(SETTING_KEYS.panelLocks, {})

console.log('\n۵) purchaseCreate/Update: گیت پنل خرید و actor نشست')
const pid = seed.product('شلوار خرید ۱۵۵', seed.category('پوشاک ۱۵۵'))
const v1 = seed.insert('ProductVariant', { productId: pid, code: 'P155-1', barcode: 'B155-1', salePrice: 1_000_000, stock: 0 })
const purchase = (o = {}) => ({ settlementType: 'CASH', paidTotal: 0, lines: [{ variantId: v1, qty: 2, unitPrice: 600_000 }], ...o })
let pn = seed.count('PurchaseInvoice')
await ipcRejects('purchaseCreate بی‌رمز با قفل خرید روشن', IPC.purchaseCreate, purchase(), 'رمز')
eq('فاکتور خریدی ثبت نشد', seed.count('PurchaseInvoice'), pn)
eq('موجودی دست‌نخورده', Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', v1)?.stock), 0)
const pinv = await ipcOk('purchaseCreate با رمز و userId جعلی ⇒ پذیرفته', IPC.purchaseCreate, purchase({ panelPassword: PW, userId: forged }))
eq('actor PURCHASE_CREATE = کارمند نشست', Number(lastAudit('PURCHASE_CREATE', 'PurchaseInvoice')?.userId), actor)
await ipcRejects('purchaseUpdate بی‌رمز', IPC.purchaseUpdate, { ...purchase(), id: Number(pinv?.id), lines: [{ variantId: v1, qty: 5, unitPrice: 600_000 }] }, 'رمز')
eq('اقلام خرید دست‌نخورده', Number(seed.one('SELECT SUM(qty) q FROM "PurchaseInvoiceItem" WHERE invoiceId = ?', Number(pinv?.id))?.q), 2)
await ipcOk('purchaseUpdate با رمز ⇒ پذیرفته', IPC.purchaseUpdate, { ...purchase({ panelPassword: PW, userId: forged }), id: Number(pinv?.id), lines: [{ variantId: v1, qty: 3, unitPrice: 600_000 }] })
eq('actor PURCHASE_UPDATE = کارمند نشست', Number(lastAudit('PURCHASE_UPDATE', 'PurchaseInvoice')?.userId), actor)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.purchase]: false })
await ipcOk('purchaseCreate بی‌رمز با قفل خرید خاموش ⇒ پذیرفته', IPC.purchaseCreate, purchase())
seed.setting(SETTING_KEYS.panelLocks, {})

console.log('\n۶) customerDelete: دارای فاکتور + force ⇒ رمز؛ بدهکار ⇒ رد کامل؛ پیوند بدهی null نشود')
const cSettled = seed.customer('مشتری تسویه ۱۵۵', '09125550001')
const invS = seed.insert('SaleInvoice', { receiptNo: 915501, grandTotal: 1_000_000, paidTotal: 1_000_000, status: 'SETTLED', customerId: cSettled, settledAt: Date.now(), settledAtJalali: jalaliToday() })
const cDebt = seed.customer('مشتری بدهکار ۱۵۵', '09125550002')
const invD = seed.insert('SaleInvoice', { receiptNo: 915502, grandTotal: 1_000_000, paidTotal: 300_000, status: 'SETTLED', customerId: cDebt, settledAt: null })
const cFree = seed.customer('مشتری بی‌فاکتور ۱۵۵', '09125550003')

const warn = await ipcOk('بدون force ⇒ فقط هشدار (مثل قبل)', IPC.customerDelete, { id: cSettled })
eq('هشدار بدون حذف', warn?.deleted, false)
await ipcRejects('دارای فاکتور + force بی‌رمز ⇒ رد', IPC.customerDelete, { id: cSettled, force: true }, 'رمز')
eq('مشتری باقی ماند', seed.count('Customer', 'id = ?', cSettled), 1)
eq('customerId فاکتور تسویه دست‌نخورده', Number(seed.one('SELECT customerId FROM "SaleInvoice" WHERE id = ?', invS)?.customerId), cSettled)
await ipcRejects('بدهکار + force + رمز مدیر ⇒ رد کامل', IPC.customerDelete, { id: cDebt, force: true, panelPassword: PW }, 'بدهی')
eq('مشتری بدهکار باقی ماند', seed.count('Customer', 'id = ?', cDebt), 1)
eq('پیوند بدهی فاکتور نسیه null نشد', Number(seed.one('SELECT customerId FROM "SaleInvoice" WHERE id = ?', invD)?.customerId), cDebt)
const del = await ipcOk('تسویه‌شده + force + رمز و userId جعلی ⇒ حذف', IPC.customerDelete, { id: cSettled, force: true, panelPassword: PW, userId: forged })
eq('حذف شد', del?.deleted, true)
const da = lastAudit('DELETE', 'Customer')
eq('actor Audit حذف = کارمند نشست', Number(da?.userId), actor)
truthy('شناسه‌ی فاکتورهای جداشده در Audit ثبت شد (مدرک قابل بازسازی)', String(da?.before ?? '').includes(String(invS)) || String(da?.after ?? '').includes(String(invS)))
await ipcOk('مشتری بی‌فاکتور بی‌رمز ⇒ حذف (رفتار قبل)', IPC.customerDelete, { id: cFree })
eq('مشتری بی‌فاکتور حذف شد', seed.count('Customer', 'id = ?', cFree), 0)

console.log('\n۷) ساختاری: اتمیک بودن و سیم‌کشی UI')
const read = (p) => readFileSync(resolve(p), 'utf8')
const party = read('src/main/services/PartyService.ts')
const delBody = party.slice(party.indexOf('async deleteCustomer'), party.indexOf('suppliers(params'))
truthy('deleteCustomer داخل $transaction (updateMany + delete + audit)', /\$transaction/.test(delBody) && /tx\.saleInvoice\.updateMany/.test(delBody) && /tx\.customer\.delete/.test(delBody))
const ipcSrc = read('src/main/ipc/index.ts')
const lineOf = (n) => ipcSrc.split('\n').find((l) => l.includes(`handle(IPC.${n},`)) ?? ''
truthy('IPC.chargesSave ⇒ withOptionalSessionActor', /withOptionalSessionActor\(p \?\? \{/.test(lineOf('chargesSave')))
for (const n of ['purchaseCreate', 'purchaseUpdate'])
  truthy(`IPC.${n} ⇒ actor نشست + fence حضانت`, /withCustodyFenceOrOptionalActor\(p \?\? \{/.test(lineOf(n)))
const settingsPage = read('src/renderer/src/pages/Settings.tsx')
truthy('Settings: ذخیره‌ی کلی managerPassword می‌فرستد', /CH\.settingsSaveBundle, \{[^}]*managerPassword/.test(settingsPage))
truthy('Settings: saveSecurity managerPassword می‌فرستد', /CH\.settingsSaveBundle, \{ security: next, managerPassword/.test(settingsPage))
truthy('Settings: حذف مشتری panelPassword می‌فرستد', /CH\.customerDelete, \{[^}]*panelPassword/.test(settingsPage))
truthy('CategoryCharges: chargesSave با panelPassword', /CH\.chargesSave, \{[^}]*panelPassword/.test(read('src/renderer/src/pages/CategoryCharges.tsx')))
truthy('PurchaseInvoice: ثبت/ویرایش خرید با panelPassword', /panelPassword/.test(read('src/renderer/src/pages/PurchaseInvoice.tsx')))
truthy('useAutoCentralWithdraw: panelPassword می‌فرستد', /CH\.settingsSaveBundle, \{ sale: nextSale, panelPassword/.test(read('src/renderer/src/hooks/useAutoCentralWithdraw.ts')))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
