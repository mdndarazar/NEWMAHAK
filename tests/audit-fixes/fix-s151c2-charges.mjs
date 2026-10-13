// نشست ۱۵۶: تست قبل/بعد S151-c2. قبل روی کپی دست‌نخورده‌ی zip ورودی ⇒ TESTLOG-s156c2-before.txt، بعد ⇒ TESTLOG-s156c2-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۶ · خوشه E/K · S151-c2 · عوارض صفر (بند ۴-۴۵) + بازمحاسبه‌ی عوارض/حق سرویس در main (Y8)
 *
 * قبل از رفع:
 *   ۱) cleanCharge صفرها را حذف می‌کرد و resolveChargeRule از قانون value=0 رد می‌شد ⇒ «۰٪» زیردسته
 *      از والد ارث می‌برد؛ «تنظیم‌نشده» و «عمداً صفر» قابل تفکیک نبودند.
 *   ۲) SalesService.create/update مالیات ردیف، invoiceTax و serviceCharge را همان‌طور که رندرر فرستاده
 *      بود ثبت می‌کرد (مسیر دوم کم‌ثبتی: عوارض ۰ برای کالایی که ۱۰٪ دارد، یا categoryId جعلی).
 * انتظار بعد از رفع: S156-D1 تا S156-D6 در DECISIONS.md.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s151c2-charges.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s151c2-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// آزمون IPC عوارض باید از همان مرز پنجرهٔ معتبر عبور کند تا اعتبارسنجی مبلغ
// سمت main (نه sender خالی هارنس) سنجیده شود.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 15103, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const charges = await import('@shared/charges')
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
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 130)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 180)}`); return null }
}

const actor = seed.user('فروشنده ۱۵۶')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const catMen = seed.category('مردانه ۱۵۶')
const catJean = seed.category('شلوار جین مردانه ۱۵۶', catMen) // عمداً صفر
const catShirt = seed.category('پیراهن مردانه ۱۵۶', catMen)   // تنظیم‌نشده ⇒ ارث ۱۰٪
const pShirt = seed.product('پیراهن ۱۵۶', catShirt)
const pJean = seed.product('جین ۱۵۶', catJean)
const vShirt = seed.insert('ProductVariant', { productId: pShirt, code: 'S156', barcode: 'BS156', salePrice: 1_000_000, stock: 100 })
const vJean = seed.insert('ProductVariant', { productId: pJean, code: 'J156', barcode: 'BJ156', salePrice: 1_000_000, stock: 100 })
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 100, maxAmount: 0 })

const cats = [{ id: catMen, parentId: null }, { id: catJean, parentId: catMen }, { id: catShirt, parentId: catMen }]
const cfg10 = { enabled: true, fallback: null, rules: [{ categoryId: catMen, mode: 'PERCENT', value: 10 }, { categoryId: catJean, mode: 'PERCENT', value: 0 }] }

console.log('\n۱) بند ۴-۴۵: «۰٪» زیردسته دقیقاً صفر است و از والد ارث نمی‌برد (shared/charges)')
const parsed = charges.parseCategoryCharge(cfg10)
eq('parse قانون صفر را نگه می‌دارد', parsed.rules.length, 2)
const rJean = charges.resolveChargeRule(parsed, catJean, cats)
eq('قانون مؤثر جین = قانون خودش (نه والد)', rJean?.categoryId, catJean)
eq('مقدار مؤثر جین = ۰', rJean?.value, 0)
eq('عوارض ردیف جین ۱٬۰۰۰٬۰۰۰ = ۰', charges.chargeForLine(parsed, catJean, cats, 1_000_000, 1), 0)
eq('پیراهن (تنظیم‌نشده) از مردانه ارث می‌برد ⇒ ۱۰۰٬۰۰۰', charges.chargeForLine(parsed, catShirt, cats, 1_000_000, 1), 100_000)
const withFallback = charges.parseCategoryCharge({ ...cfg10, fallback: { mode: 'PERCENT', value: 9 } })
eq('صفر عمدی بر مقدار پیش‌فرض هم غلبه می‌کند', charges.chargeForLine(withFallback, catJean, cats, 1_000_000, 1), 0)
truthy('describeChargeRule برای صفر عمدی «صفر» می‌نویسد', /صفر/.test(charges.describeChargeRule(rJean)))

console.log('\n۲) ذخیره در main: قانون صفر پاک نمی‌شود')
const saved = await safe('saveCharge با قانون صفر (قفل پیش‌فرض ⇒ رمز مدیر)', () => settingsService.saveCharge({ kind: 'tax', scope: 'pos', config: cfg10, panelPassword: PW }))
const stored = await settingsService.charge('tax', 'pos')
eq('قانون صفر جین ذخیره شد', stored.rules.some((r) => r.categoryId === catJean && r.value === 0), true)
eq('قانون ۱۰٪ مردانه ذخیره شد', stored.rules.some((r) => r.categoryId === catMen && r.value === 10), true)
eq('پاسخ saveCharge هم قانون صفر را دارد', !!saved?.rules?.some((r) => r.categoryId === catJean), true)
// حق سرویس pos: مبلغ ثابت ۲۰٬۰۰۰ برای هر عدد (پیش‌فرض همه‌ی کالاها)
await settingsService.saveCharge({ kind: 'service', scope: 'pos', config: { enabled: true, rules: [], fallback: { mode: 'FIXED', value: 20_000 } }, panelPassword: PW })

const invoices = () => seed.count('SaleInvoice')
const line = (o = {}) => ({ variantId: vShirt, code: 'S156', barcode: 'BS156', name: 'پیراهن ۱۵۶', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 100_000, ...o })
const sale = (o = {}) => ({ userId: actor, shiftId, deductInventory: false, lines: [line()], serviceCharge: 20_000, invoiceTax: 0, payments: [], ...o })

console.log('\n۳) Y8 · فروش خرده: عوارض/حق سرویس با تنظیمات main سنجیده می‌شود')
let n0 = invoices()
await rejects('عوارض ۰ برای پیراهن ۱۰٪ (کم‌ثبتی) ⇒ رد', () => salesService.create(sale({ lines: [line({ tax: 0 })] })), 'عوارض')
await rejects('categoryId جعلی (دسته‌ی صفر) از رندرر ⇒ رد', () => salesService.create(sale({ lines: [line({ tax: 0, categoryId: catJean })] })), 'عوارض')
await rejects('حق سرویس ۰ به‌جای ۲۰٬۰۰۰ ⇒ رد', () => salesService.create(sale({ serviceCharge: 0 })), 'حق سرویس')
await rejects('عوارض سطح فاکتور در پنل خرده ⇒ رد', () => salesService.create(sale({ lines: [line({ tax: 0 })], invoiceTax: 100_000 })), 'عوارض')
await rejects('عوارض ۵۰٬۰۰۰ برای جین «عمداً صفر» ⇒ رد', () => salesService.create(sale({ lines: [line({ variantId: vJean, code: 'J156', tax: 50_000 })] })), 'عوارض')
await rejects('کم‌ثبتی با رمز مدیر هم در پنل خرده باز نمی‌شود', () => salesService.create(sale({ lines: [line({ tax: 0 })], managerPassword: PW })), 'عوارض')
eq('هیچ فاکتوری ثبت نشد', invoices(), n0)
const okInv = await safe('عوارض ۱۰۰٬۰۰۰ + حق سرویس ۲۰٬۰۰۰ ⇒ پذیرفته', () => salesService.create(sale()))
eq('taxTotal ذخیره‌شده', Number(seed.one('SELECT taxTotal FROM "SaleInvoice" WHERE id = ?', Number(okInv?.id))?.taxTotal), 100_000)
const zeroTaxInv = await safe('جین «عمداً صفر» با عوارض ۰ ⇒ پذیرفته', () => salesService.create(sale({ lines: [line({ variantId: vJean, code: 'J156', tax: 0 })] })))
await safe('ویرایش واقعاً بی‌تغییرِ جین صفر، نرخ تاریخی را نگه می‌دارد', () =>
  salesService.update({ ...sale({ lines: [line({ variantId: vJean, code: 'J156', tax: 0 })] }), id: Number(zeroTaxInv?.id), keepPayments: true, payments: undefined })
)
await rejects('تغییر جین صفر به پیراهن ۱۰٪ با عوارض صفر ⇒ رد (میان‌بر تاریخی دور زده نمی‌شود)', () =>
  salesService.update({ ...sale({ lines: [line({ tax: 0 })] }), id: Number(zeroTaxInv?.id), keepPayments: true, payments: undefined }),
  'عوارض'
)
eq('عوارض سند جین پس از تلاش تغییر کالا همان صفر ماند', Number(seed.one('SELECT taxTotal FROM "SaleInvoice" WHERE id = ?', Number(zeroTaxInv?.id))?.taxTotal), 0)
await safe('گرد ۱ ریالی (۹۹٬۹۹۹) در تحمل گرد ⇒ پذیرفته', () => salesService.create(sale({ lines: [line({ tax: 99_999 })] })))
await safe('تخفیف فاکتور ۱۰۰٬۰۰۰ ⇒ مبنای خالص ۹۰۰٬۰۰۰ ⇒ عوارض ۹۰٬۰۰۰ پذیرفته', () => salesService.create(sale({ lines: [line({ tax: 90_000 })], invoiceDiscount: 100_000 })))
await rejects('همان فاکتور با عوارض ۸۰٬۰۰۰ ⇒ رد', () => salesService.create(sale({ lines: [line({ tax: 80_000 })], invoiceDiscount: 100_000 })), 'عوارض')
await safe('دو عدد با حق سرویس ثابت ⇒ ۴۰٬۰۰۰ پذیرفته', () => salesService.create(sale({ lines: [line({ qty: 2, tax: 200_000 })], serviceCharge: 40_000 })))
await settingsService.saveCharge({ kind: 'tax', scope: 'pos', config: { ...cfg10, enabled: false }, panelPassword: PW })
await rejects('پنل عوارض خاموش ⇒ عوارض ۱۰۰٬۰۰۰ (بیش‌ثبتی) رد', () => salesService.create(sale()), 'عوارض')
await safe('پنل عوارض خاموش ⇒ عوارض ۰ پذیرفته', () => salesService.create(sale({ lines: [line({ tax: 0 })] })))
await settingsService.saveCharge({ kind: 'tax', scope: 'pos', config: cfg10, panelPassword: PW })
const ipcBad = await ipc(IPC.saleCreate, sale({ lines: [line({ tax: 0 })] }))
truthy('IPC.saleCreate با عوارض ۰ ⇒ رد با پیام فارسی', ipcBad?.ok === false && /عوارض/.test(String(ipcBad?.error)))
truthy('پیام رد مبلغ مورد انتظار و واحد ریال را دارد', /۱۰۰٬۰۰۰|100,000|100000/.test(String(ipcBad?.error)) && /ریال/.test(String(ipcBad?.error)))

console.log('\n۴) Y8 · فاکتور عمده: عوارض دستی کمتر از خودکار فقط با رمز مدیر و Audit')
await settingsService.saveCharge({ kind: 'tax', scope: 'wholesale', config: { enabled: true, rules: [], fallback: { mode: 'PERCENT', value: 5 } }, panelPassword: PW })
const wsale = (o = {}) => sale({ orderType: 'WHOLESALE', lines: [line({ tax: 0 })], invoiceTax: 50_000, serviceCharge: 0, ...o })
const chargeAudits = () => seed.count('AuditLog', 'action = ?', 'SALE_CHARGE_OVERRIDE')
let a0 = chargeAudits()
const w1 = await safe('عمده با عوارض خودکار ۵۰٬۰۰۰ ⇒ پذیرفته', () => salesService.create(wsale()))
eq('بدون Audit عوارض دستی', chargeAudits(), a0)
n0 = invoices()
await rejects('عمده با عوارض ۰ بی‌رمز ⇒ رد', () => salesService.create(wsale({ invoiceTax: 0 })), 'رمز مدیر')
await rejects('عمده با عوارض ۰ و رمز غلط ⇒ رد', () => salesService.create(wsale({ invoiceTax: 0, managerPassword: 'wrong-156' })), 'رمز')
eq('فاکتوری ثبت نشد', invoices(), n0)
await safe('عمده با عوارض ۰ و رمز مدیر ⇒ پذیرفته', () => salesService.create(wsale({ invoiceTax: 0, managerPassword: PW })))
eq('Audit SALE_CHARGE_OVERRIDE ثبت شد', chargeAudits(), a0 + 1)
const lastA = seed.one('SELECT before, after, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'SALE_CHARGE_OVERRIDE')
truthy('Audit خودکار ۵۰۰۰۰ و واردشده ۰ را دارد', /50000/.test(String(lastA?.before)) && /"tax":0/.test(String(lastA?.after)))
await safe('عمده با عوارض ۶۰٬۰۰۰ (بیشتر از خودکار) بی‌رمز ⇒ پذیرفته', () => salesService.create(wsale({ invoiceTax: 60_000 })))
eq('افزایش هم Audit می‌شود', chargeAudits(), a0 + 2)
await rejects('عمده با عوارض روی ردیف (نه سطح فاکتور) ⇒ رد', () => salesService.create(wsale({ lines: [line({ tax: 50_000 })], invoiceTax: 0 })), 'عوارض')

console.log('\n۵) Y8 · ویرایش فاکتور عمده')
await settingsService.saveCharge({ kind: 'tax', scope: 'wholesale', config: { enabled: true, rules: [], fallback: { mode: 'PERCENT', value: 10 } }, panelPassword: PW })
const upd = (o = {}) => ({ ...wsale(), id: Number(w1?.id), keepPayments: true, payments: undefined, ...o })
await safe('ویرایش با همان عوارض قبلی (۵۰٬۰۰۰، نرخ امروز ۱۰٪) ⇒ پذیرفته بی‌رمز', () => salesService.update(upd()))
await rejects('ویرایش با عوارض ۴۰٬۰۰۰ بی‌رمز ⇒ رد', () => salesService.update(upd({ invoiceTax: 40_000 })), 'رمز مدیر')
await safe('ویرایش با عوارض خودکار امروز ۱۰۰٬۰۰۰ ⇒ پذیرفته', () => salesService.update(upd({ invoiceTax: 100_000 })))
eq('taxTotal پس از ویرایش', Number(seed.one('SELECT taxTotal FROM "SaleInvoice" WHERE id = ?', Number(w1?.id))?.taxTotal), 100_000)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
