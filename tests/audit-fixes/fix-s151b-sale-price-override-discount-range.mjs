// نشست ۱۵۲: تست قبل/بعد S151-b. قبل (src zip ۱۵۱) ⇒ TESTLOG-s152b-before.txt.
// نشست ۱۵۴: بخش ۹ اضافه شد؛ قبل روی zip ۱۵۳ دست‌نخورده ⇒ TESTLOG-s154b-before.txt، بعد ⇒ TESTLOG-s154b-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۲ · خوشه E/K · S151-b · بند ۴-۲۶ (بازه‌ی تخفیف سمت سرور، بی‌دورزدن با رمز)،
 * بند ۴-۲۹ (تغییر سقف مجاز مغایرت صندوق همیشه رمز مدیر) و بند ۵ («هر گیت در main»)
 *
 * قبل از رفع (Y1/Y2/Y3/Y4 نشست ۱۵۱):
 *   ۱) SalesService.create/update هر unitPrice و هر تخفیفی را می‌پذیرفت ⇒ کالای ۱٬۰۰۰٬۰۰۰
 *      ریالی با ۳۰۰٬۰۰۰ ثبت می‌شد، بی‌رمز و بی‌Audit؛ بازه‌ی تخفیف فقط در UI بود.
 *   ۲) settingsAccountingPolicySet، discountPolicySave، creditSettingsSet و بخش discount
 *      در settingsSaveBundle هیچ گیت سمت سرور نداشتند.
 * انتظار بعد از رفع: S151-D3 تا S151-D5 (و S152-D* برای saveBundle).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s151b-sale-price-override-discount-range.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s151b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// قرارداد IPC جدید، sender معتبر می‌خواهد. این sender ساختگی مرز پنجره را
// عبور می‌دهد تا آزمون، گیت‌های قیمت/تخفیف/تنظیمات را از خودِ main بسنجد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15102, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
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
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون تأیید پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 110)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); return null }
}
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 100)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون تأیید پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 160)}`) }
  return r?.data
}

const actor = seed.user('فروشنده نشست باز ۱۵۲')
const forged = seed.user('کارمند جعلی ۱۵۲ب')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const pid = seed.product('شلوار جین ۱۵۲', seed.category('پوشاک ۱۵۲'))
const v1 = seed.insert('ProductVariant', { productId: pid, code: 'P152-1', barcode: 'B152-1', salePrice: 1_000_000, stock: 100 })
const v2 = seed.insert('ProductVariant', { productId: pid, code: 'P152-2', barcode: 'B152-2', salePrice: 500_000, stock: 100 })

const invoices = () => seed.count('SaleInvoice')
const overrideAudits = () => seed.count('AuditLog', 'action = ?', 'SALE_PRICE_OVERRIDE')
const lastOverride = () => seed.one('SELECT entityId, userId, before, after, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'SALE_PRICE_OVERRIDE')
const line = (o = {}) => ({ variantId: v1, code: 'P152-1', barcode: 'B152-1', name: 'شلوار جین ۱۵۲', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0, ...o })
const sale = (o = {}) => ({ userId: actor, shiftId, deductInventory: false, lines: [line()], payments: [], ...o })
const setDiscount = (p) => seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 100, maxAmount: 0, ...p })
const setAccounting = async (patch) => seed.setting(SETTING_KEYS.accountingPolicy, { ...(await settingsService.accountingPolicy()), ...patch })

console.log('\n۱) گیت قیمت دستی در ثبت فروش خرده (requireManagerForPriceOverride پیش‌فرض روشن)')
let n0 = invoices(); let a0 = overrideAudits()
await rejects('۳۰۰٬۰۰۰ برای کالای ۱٬۰۰۰٬۰۰۰ بی‌رمز', () => salesService.create(sale({ lines: [line({ unitPrice: 300_000 })] })), 'رمز مدیر')
await rejects('۳۰۰٬۰۰۰ برای کالای ۱٬۰۰۰٬۰۰۰ با رمز غلط', () => salesService.create(sale({ lines: [line({ unitPrice: 300_000 })], managerPassword: 'wrong-152' })), 'رمز')
eq('فاکتوری ثبت نشد', invoices(), n0)
eq('Audit قیمت دستی تازه‌ای ثبت نشد', overrideAudits(), a0)
const inv1 = await ipcOk('IPC.saleCreate با رمز مدیر و userId جعلی ⇒ پذیرفته', IPC.saleCreate, sale({ userId: forged, lines: [line({ unitPrice: 300_000 })], managerPassword: PW }))
eq('Audit SALE_PRICE_OVERRIDE ثبت شد', overrideAudits(), a0 + 1)
let ov = lastOverride()
eq('Audit روی همان فاکتور', Number(ov?.entityId), Number(inv1?.id))
eq('actor Audit = کارمند نشست (نه userId جعلی)', Number(ov?.userId), actor)
truthy('قیمت مرجع ۱۰۰۰۰۰۰ در before و قیمت واردشده ۳۰۰۰۰۰ در after', /1000000/.test(String(ov?.before)) && /300000/.test(String(ov?.after)))
eq('فروشنده‌ی فاکتور = کارمند نشست', Number(seed.one('SELECT userId FROM "SaleInvoice" WHERE id = ?', Number(inv1?.id))?.userId), actor)
a0 = overrideAudits()
await safe('قیمت برابر قیمت فروش بی‌رمز ⇒ پذیرفته', () => salesService.create(sale()))
eq('بدون Audit قیمت دستی', overrideAudits(), a0)
await safe('افزایش قیمت (۱٬۲۰۰٬۰۰۰) بی‌رمز ⇒ پذیرفته', () => salesService.create(sale({ lines: [line({ unitPrice: 1_200_000 })] })))
eq('افزایش قیمت هم Audit می‌شود', overrideAudits(), a0 + 1)
await setAccounting({ requireManagerForPriceOverride: false })
a0 = overrideAudits()
await safe('گیت قیمت دستی خاموش ⇒ کاهش بی‌رمز پذیرفته', () => salesService.create(sale({ lines: [line({ unitPrice: 900_000 })] })))
eq('با گیت خاموش هم Audit می‌شود', overrideAudits(), a0 + 1)
await setAccounting({ requireManagerForPriceOverride: true })

console.log('\n۲) بازه‌ی تخفیف (FREE maxPercent=۲۰) سمت سرور، بدون دورزدن با رمز مدیر')
setDiscount({ maxPercent: 20 })
n0 = invoices()
await rejects('تخفیف ردیف ۲۵٪ حتی با رمز مدیر', () => salesService.create(sale({ lines: [line({ discount: 250_000 })], managerPassword: PW })), 'تخفیف')
await safe('تخفیف ردیف ۲۰٪ ⇒ پذیرفته', () => salesService.create(sale({ lines: [line({ discount: 200_000 })] })))
await rejects('کاهش قیمت ۱۵٪ + تخفیف فاکتور ۱۰٪ حتی با رمز مدیر', () => salesService.create(sale({ lines: [line({ unitPrice: 850_000 })], invoiceDiscount: 100_000, managerPassword: PW })), 'تخفیف')
await safe('تخفیف فاکتور ۲۰٪ ⇒ پذیرفته', () => salesService.create(sale({ invoiceDiscount: 200_000 })))
await safe('کاهش قیمت ۱۰٪ با رمز + تخفیف فاکتور ۱۰٪ (جمع ۲۰٪) ⇒ پذیرفته', () => salesService.create(sale({ lines: [line({ unitPrice: 900_000 })], invoiceDiscount: 90_000, managerPassword: PW })))
eq('فقط سه فاکتور مجاز ثبت شد', invoices(), n0 + 3)
setDiscount({ maxPercent: 100, allowLine: false })
await rejects('allowLine=false ⇒ تخفیف ردیف رد', () => salesService.create(sale({ lines: [line({ discount: 1_000 })] })), 'تخفیف')
setDiscount({ maxPercent: 100, allowInvoice: false })
await rejects('allowInvoice=false ⇒ تخفیف فاکتور رد', () => salesService.create(sale({ invoiceDiscount: 1_000 })), 'تخفیف')
setDiscount({ maxPercent: 100, maxAmount: 50_000 })
await rejects('maxAmount=۵۰٬۰۰۰ ⇒ تخفیف ۶۰٬۰۰۰ رد', () => salesService.create(sale({ invoiceDiscount: 60_000 })), 'تخفیف')
await safe('maxAmount=۵۰٬۰۰۰ ⇒ تخفیف ۵۰٬۰۰۰ پذیرفته', () => salesService.create(sale({ invoiceDiscount: 50_000 })))
setDiscount({ mode: 'OFF' })
await rejects('OFF ⇒ هر تخفیف رد (۱ ریال)', () => salesService.create(sale({ invoiceDiscount: 1 })), 'تخفیف')
await rejects('OFF ⇒ تخفیف ردیف رد', () => salesService.create(sale({ lines: [line({ discount: 10_000 })] })), 'تخفیف')
await safe('OFF ⇒ بدون تخفیف پذیرفته', () => salesService.create(sale()))
setDiscount({ mode: 'FIXED', fixedMode: 'PERCENT', fixedValue: 10 })
await safe('FIXED ۱۰٪ ⇒ تخفیف فاکتور دقیقاً ۱۰۰٬۰۰۰ پذیرفته', () => salesService.create(sale({ invoiceDiscount: 100_000 })))
await safe('FIXED ۱۰٪ ⇒ بدون تخفیف پذیرفته', () => salesService.create(sale()))
await rejects('FIXED ۱۰٪ ⇒ تخفیف فاکتور ۵۰٬۰۰۰ رد', () => salesService.create(sale({ invoiceDiscount: 50_000 })), 'تخفیف')
await rejects('FIXED ۱۰٪ ⇒ تخفیف ردیف رد', () => salesService.create(sale({ lines: [line({ discount: 100_000 })] })), 'تخفیف')

console.log('\n۳) فروش عمده: بازه‌ی تخفیف اعمال نمی‌شود ولی گیت قیمت دستی می‌ماند')
setDiscount({ maxPercent: 20 })
await safe('WHOLESALE با تخفیف ردیف ۳۰٪ ⇒ پذیرفته', () => salesService.create(sale({ orderType: 'WHOLESALE', lines: [line({ discount: 300_000 })] })))
await rejects('WHOLESALE با unitPrice زیر قیمت فروش بی‌رمز ⇒ رد', () => salesService.create(sale({ orderType: 'WHOLESALE', lines: [line({ unitPrice: 700_000 })] })), 'رمز مدیر')
setDiscount({ maxPercent: 100 })

console.log('\n۴) ویرایش: مرجع = کمترین قیمت همان کالا در فاکتور اصلی')
const base = await safe('فاکتور پایه با قیمت ۱٬۰۰۰٬۰۰۰', () => salesService.create(sale({ lines: [line(), line({ variantId: v2, code: 'P152-2', barcode: 'B152-2', unitPrice: 500_000 })] })))
seed.rows('UPDATE "ProductVariant" SET salePrice = 1200000 WHERE id = ? RETURNING id', v1)
const upd = (o = {}) => ({ ...sale(o), id: Number(base?.id), keepPayments: true })
a0 = overrideAudits()
// نشست ۱۶۵ (S165-D3): qty از ۲ به ۱ — مرجع فاکتور اصلی فقط برای همان تعداد است (S165-D2)؛ عدد دوم زیر قیمت فعلی
// رمز می‌خواهد و در tests/audit-fixes/fix-s165-edit-qty-price-reference.mjs سنجیده می‌شود. قصد این بند (قیمت اصلی مرجع است) دست نخورد.
await safe('ویرایش با قیمت اصلی پس از گران‌شدن کالا ⇒ بی‌رمز پذیرفته', () => salesService.update(upd({ lines: [line({ qty: 1 }), line({ variantId: v2, code: 'P152-2', barcode: 'B152-2', unitPrice: 500_000 })] })))
eq('بدون Audit قیمت دستی (قیمت اصلی فاکتور مرجع است)', overrideAudits(), a0)
await rejects('ویرایش با کاهش زیر قیمت اصلی بی‌رمز ⇒ رد', () => salesService.update(upd({ lines: [line({ unitPrice: 900_000 })] })), 'رمز مدیر')
await safe('ویرایش با کاهش زیر قیمت اصلی با رمز ⇒ پذیرفته', () => salesService.update(upd({ lines: [line({ unitPrice: 900_000 })], managerPassword: PW })))
eq('Audit SALE_PRICE_OVERRIDE ویرایش', overrideAudits(), a0 + 1)
eq('Audit ویرایش روی همان فاکتور', Number(lastOverride()?.entityId), Number(base?.id))
setDiscount({ maxPercent: 5 })
await rejects('ویرایش فروش خرده با تخفیف فاکتور بیش از بازه ⇒ رد', () => salesService.update(upd({ lines: [line({ unitPrice: 1_000_000 })], invoiceDiscount: 100_000 })), 'تخفیف')
setDiscount({ maxPercent: 100 })

console.log('\n۵) سیاست حسابداری: همیشه رمز مدیر (بند ۴-۲۹)، actor از نشست')
const polBefore = await settingsService.accountingPolicy()
await ipcRejects('IPC.settingsAccountingPolicySet بی‌رمز', IPC.settingsAccountingPolicySet, { policy: { ...polBefore, cashDifferenceThreshold: 999_999, requireManagerForPriceOverride: false }, userId: forged }, 'رمز مدیر')
await rejects('settingsService.setAccountingPolicy مستقیم بی‌رمز', () => settingsService.setAccountingPolicy({ policy: { ...polBefore, requireManagerForPriceOverride: false } }), 'رمز مدیر')
eq('گیت قیمت دستی دست‌نخورده ماند', (await settingsService.accountingPolicy()).requireManagerForPriceOverride, true)
eq('سقف مغایرت دست‌نخورده ماند', (await settingsService.accountingPolicy()).cashDifferenceThreshold, polBefore.cashDifferenceThreshold)
await ipcOk('IPC.settingsAccountingPolicySet با رمز مدیر و userId جعلی', IPC.settingsAccountingPolicySet, { policy: { ...polBefore, cashDifferenceThreshold: 12_345 }, managerPassword: PW, userId: forged })
eq('سقف مغایرت ذخیره شد', (await settingsService.accountingPolicy()).cashDifferenceThreshold, 12_345)
const accAudit = seed.one('SELECT userId FROM "AuditLog" WHERE action = ? AND entity = ? AND note LIKE ? ORDER BY id DESC LIMIT 1', 'SETTINGS_UPDATE', 'Setting', 'سیاست حسابداری%')
eq('actor Audit سیاست حسابداری = کارمند نشست', Number(accAudit?.userId), actor)

console.log('\n۶) سیاست تخفیف: رمز پنل تنظیمات (همیشه قفل)، saveBundle هم دورش نمی‌زند')
const disc20 = { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 100, maxAmount: 0 }
await ipcRejects('IPC.discountPolicySave بی‌رمز', IPC.discountPolicySave, { policy: { ...disc20, maxPercent: 100 }, userId: forged }, 'رمز')
await ipcRejects('IPC.settingsSaveBundle با discount تغییرکرده بی‌رمز', IPC.settingsSaveBundle, { discount: { ...disc20, mode: 'OFF' } }, 'رمز')
eq('سیاست تخفیف دست‌نخورده ماند', (await settingsService.discountPolicy()).mode, 'FREE')
await ipcOk('IPC.settingsSaveBundle با discount بدون تغییر بی‌رمز ⇒ پذیرفته', IPC.settingsSaveBundle, { discount: await settingsService.discountPolicy() })
await ipcOk('IPC.discountPolicySave با رمز و userId جعلی', IPC.discountPolicySave, { policy: { ...disc20, maxPercent: 30 }, panelPassword: PW, userId: forged })
eq('سیاست تخفیف ذخیره شد', (await settingsService.discountPolicy()).maxPercent, 30)
const dAudit = seed.one('SELECT userId FROM "AuditLog" WHERE action = ? AND note LIKE ? ORDER BY id DESC LIMIT 1', 'SETTINGS_UPDATE', 'سیاست تخفیف%')
eq('actor Audit سیاست تخفیف = کارمند نشست', Number(dAudit?.userId), actor)

console.log('\n۷) تنظیمات اعتبار خرید: رمز پنل creditSettings')
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.creditSettings]: true })
const cs = await settingsService.creditSettings()
await ipcRejects('IPC.creditSettingsSet بی‌رمز با قفل روشن', IPC.creditSettingsSet, { settings: cs, userId: forged }, 'رمز')
await ipcOk('IPC.creditSettingsSet با رمز و userId جعلی', IPC.creditSettingsSet, { settings: cs, panelPassword: PW, userId: forged })
eq('actor Audit CREDIT_SETTINGS_UPDATE = کارمند نشست', Number(seed.one('SELECT userId FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'CREDIT_SETTINGS_UPDATE')?.userId), actor)
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.creditSettings]: false })
await ipcRejects('IPC.creditSettingsSet بی‌رمز با قفل خاموش هم ⇒ رد سخت‌گیرانه', IPC.creditSettingsSet, { settings: cs }, 'همیشه رمز')
await ipcOk('IPC.creditSettingsSet با رمز و قفل خاموش ⇒ پذیرفته', IPC.creditSettingsSet, { settings: cs, panelPassword: PW })

console.log('\n۸) سیم‌کشی UI (ساختاری؛ رندر واقعی Electron اجرا نمی‌شود)')
const settingsPage = readFileSync(resolve('src/renderer/src/pages/Settings.tsx'), 'utf8')
const creditPage = readFileSync(resolve('src/renderer/src/pages/CreditManagement.tsx'), 'utf8')
const posPage = readFileSync(resolve('src/renderer/src/pages/Pos.tsx'), 'utf8')
truthy('Settings: ذخیره‌ی سیاست حسابداری managerPassword می‌فرستد', /CH\.settingsAccountingPolicySet, \{ policy, managerPassword/.test(settingsPage))
truthy('Settings: ذخیره‌ی سیاست تخفیف panelPassword می‌فرستد', /CH\.discountPolicySave, \{ policy: discount, panelPassword/.test(settingsPage))
truthy('Settings: ذخیره‌ی کلی دیگر discount نمی‌فرستد', !/CH\.settingsSaveBundle, \{[^}]*\bdiscount\b/.test(settingsPage))
truthy('CreditManagement: ذخیره‌ی تنظیمات panelPassword می‌فرستد', /CH\.creditSettingsSet, \{ settings, panelPassword/.test(creditPage))
truthy('Pos: توضیح بازه‌ی تخفیف دیگر ادعای نادرست ندارد و به S151-b ارجاع دارد', /S151-b/.test(posPage))

console.log('\n۹) نشست ۱۵۴ — تکمیلی: ضدتقلب، کالای بی‌مرجع، فاکتور ناموجود (S153-D2/D3)')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const fr = await fraudService.review({ fromJalali: jalaliToday(), toJalali: jalaliToday() })
const ovFlag = fr.flags.find((f) => f.key === 'closedPeriodOverride')
truthy('FraudService: SALE_PRICE_OVERRIDE در بخش «تغییر با تایید مدیر… یا قیمت دستی» دیده می‌شود', (ovFlag?.sources ?? []).some((x) => String(x.label).startsWith('SALE_PRICE_OVERRIDE')))
n0 = invoices()
await rejects('کالای ناموجود (بی‌مرجع) ⇒ رد فارسی', () => salesService.create(sale({ lines: [line({ variantId: 987654, code: 'GHOST-154' })] })), 'قیمت مرجع')
eq('فاکتوری برای کالای بی‌مرجع ثبت نشد', invoices(), n0)
await rejects('ویرایش فاکتور ناموجود ⇒ همان پیام «پیدا نشد» پیش از هر رمز', () => salesService.update({ ...sale({ lines: [line({ unitPrice: 300_000 })] }), id: 987654, keepPayments: true }), 'این فاکتور پیدا نشد')
const auditOv = lastOverride()
truthy('note Audit فارسی با شماره فیش و حالت', /فیش/.test(String(auditOv?.note)) && /(کاهش با تایید رمز مدیر|کاهش، گیت خاموش|افزایش، بدون رمز)/.test(String(auditOv?.note)))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
