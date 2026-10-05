// نشست ۱۵۷ (ساخت) / ۱۵۸ (رفع): تست قبل/بعد Y14 + Y16 + Y17 (قیمت/تخفیف/عوارض کالای جایگزین تعویض). قبل روی کپی دست‌نخورده ⇒ TESTLOG-s157ex-before.txt، بعد ⇒ TESTLOG-s157ex-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۷ · خوشه E/K · Y14 + Y16 + Y17 · کالای جایگزین تعویض
 *
 * تعویض = برگشت + فروش تازه (بند ۴-۱۰)، پس قلم جایگزین باید همان گیت‌های فروش را بگیرد.
 * قبل از رفع:
 *   Y14 (P1): بازه‌ی سیاست تخفیف (بند ۴-۲۶) روی تخفیف قلم جایگزین/تخفیف کل سند تعویض اعمال
 *        نمی‌شد ⇒ تخفیف بیش از سقف مدیر با تعویض صوری (مابه‌التفاوت منفی = نقد/اعتبار).
 *   Y16 (P2): عوارض/حق سرویس قلم جایگزین از ورودی IPC پذیرفته می‌شد و از تنظیمات حساب نمی‌شد ⇒
 *        برگشت کالای عوارض‌دار (ارزش با سهم عوارض، بند ۴-۱۱) + جایگزین بی‌عوارض = بازپرداخت عوارض.
 *   Y17 (P1، یافته‌ی تازه‌ی همین نشست): گیت قیمت دستی به «حضور unitPrice» حساس بود، نه به کاهش
 *        قیمت؛ UI همیشه unitPrice می‌فرستد ⇒ هر تعویض عادی با قیمت واقعی رمز مدیر می‌خواست
 *        (خلاف بند ۴-۳۱) و افزایش قیمت هم رمز می‌خواست (خلاف S151-D3).
 * انتظار بعد از رفع: S157-D5 تا S157-D9 در DECISIONS.md.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y14-y16-exchange-pricing.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y14-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون رد پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 140)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 180)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}

const userId = seed.user('فروشنده ۱۵۷')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1 })
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const cat = seed.category('پوشاک ۱۵۷')
const product = seed.product('شلوار ۱۵۷', cat)
const mkVariant = (code, price) => seed.insert('ProductVariant', { productId: product, code, barcode: 'B' + code, salePrice: price, stock: 100 })
const vOrig = mkVariant('O157', 1_000_000)
const vRep = mkVariant('R157', 1_000_000)
const itemsOf = (invId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invId).map((r) => Number(r.id))
const counts = () => JSON.stringify([seed.count('SaleReturn'), seed.count('SaleInvoice'), seed.count('StoreCredit'), seed.count('Payment')])
const priceAudits = () => seed.count('AuditLog', 'action = ?', 'EXCHANGE_PRICE_OVERRIDE')
const invRow = (id) => seed.one('SELECT goodsTotal, taxTotal, serviceCharge, discountTotal, grandTotal FROM "SaleInvoice" WHERE id = ?', id)
const lineTax = (id) => seed.rows('SELECT tax FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id).map((r) => Number(r.tax))
const freePolicy = (maxPercent) => seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent, maxAmount: 0 })
freePolicy(100)

/** فاکتور نقدی تازه با یک کالای ۱٬۰۰۰٬۰۰۰ (بدون عوارض؛ پیش از تنظیم عوارض ساخته می‌شود) */
const mkSale = async (orderType) => {
  const s = await salesService.create({
    userId, deductInventory: false, orderType,
    lines: [{ variantId: vOrig, code: 'O157', barcode: 'BO157', name: 'شلوار ۱۵۷', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }],
    invoiceTax: 0, serviceCharge: 0, payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
  })
  return { id: Number(s.id), item: itemsOf(Number(s.id))[0] }
}
const pool = []
for (let i = 0; i < 14; i++) pool.push(await mkSale(undefined))
const wpool = []
for (let i = 0; i < 3; i++) wpool.push(await mkSale('WHOLESALE'))
const ex = (src, rep, extra = {}) =>
  salesService.createExchange({ invoiceId: src.id, lines: [{ saleItemId: src.item, qty: 1 }], replacements: [{ variantId: vRep, qty: 1, ...rep }], userId, shiftId, ...extra })

console.log('\n۱) Y17 · قیمت کالای جایگزین: فقط کاهش زیر قیمت واقعی رمز مدیر می‌خواهد (بند ۴-۳۱، S151-D3)')
let c0 = counts()
const r1 = await safe('unitPrice برابر قیمت واقعی (مثل UI) بی‌رمز ⇒ پذیرفته', () => ex(pool[0], { unitPrice: 1_000_000 }))
eq('مابه‌التفاوت صفر', r1?.diff ?? null, 0)
let a0 = priceAudits()
const r2 = await safe('افزایش قیمت (۱٬۲۰۰٬۰۰۰) بی‌رمز ⇒ پذیرفته', () => ex(pool[1], { unitPrice: 1_200_000 }, { methodId: cash }))
eq('افزایش قیمت در Audit EXCHANGE_PRICE_OVERRIDE ثبت شد', priceAudits(), a0 + 1)
const last = seed.one('SELECT note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'EXCHANGE_PRICE_OVERRIDE')
truthy('متن Audit افزایش «بدون رمز» را می‌گوید، نه «با تایید مدیر»', /افزایش/.test(last?.note ?? '') && !/با تایید مدیر:/.test(last?.note ?? ''))
c0 = counts()
await rejects('کاهش قیمت (۸۰۰٬۰۰۰) بی‌رمز ⇒ رد', () => ex(pool[2], { unitPrice: 800_000 }, { refundMode: 'STORE_CREDIT' }), 'رمز مدیر')
eq('هیچ سندی ساخته نشد', counts(), c0)
await safe('کاهش قیمت با رمز مدیر ⇒ پذیرفته', () => ex(pool[2], { unitPrice: 800_000 }, { refundMode: 'STORE_CREDIT', managerPassword: PW }))

console.log('\n۲) Y14 · بازه‌ی سیاست تخفیف روی کالای جایگزین (فاکتور اصلی خرده)')
freePolicy(10)
c0 = counts()
await rejects('تخفیف قلم ۲۰۰٬۰۰۰ (۲۰٪) با سقف ۱۰٪ ⇒ رد', () => ex(pool[3], { unitPrice: 1_000_000, discount: 200_000 }, { refundMode: 'STORE_CREDIT' }), 'سقف مجاز')
await rejects('با رمز مدیر هم رد (بند ۴-۲۶)', () => ex(pool[3], { unitPrice: 1_000_000, discount: 200_000 }, { refundMode: 'STORE_CREDIT', managerPassword: PW }), 'سقف مجاز')
await rejects('تخفیف کل سند تعویض ۲۰۰٬۰۰۰ ⇒ رد', () => ex(pool[3], { unitPrice: 1_000_000 }, { invoiceDiscount: 200_000, refundMode: 'STORE_CREDIT' }), 'سقف مجاز')
await rejects('کاهش قیمت ۲۰٪ با رمز مدیر هم جزو سقف تخفیف است ⇒ رد', () => ex(pool[3], { unitPrice: 800_000 }, { refundMode: 'STORE_CREDIT', managerPassword: PW }), 'سقف مجاز')
eq('هیچ سند/اعتبار/پرداختی ساخته نشد', counts(), c0)
await safe('تخفیف ۱۰۰٬۰۰۰ (دقیقاً ۱۰٪) ⇒ پذیرفته', () => ex(pool[3], { unitPrice: 1_000_000, discount: 100_000 }, { refundMode: 'STORE_CREDIT' }))
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'OFF', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 100, maxAmount: 0 })
await rejects('سیاست «غیرفعال» ⇒ تخفیف ۱ ریال روی جایگزین رد', () => ex(pool[4], { unitPrice: 1_000_000, discount: 1 }, { refundMode: 'STORE_CREDIT' }), 'غیرفعال')
freePolicy(10)
await safe('فاکتور اصلی عمده ⇒ سیاست تخفیف پنل فروش اعمال نمی‌شود (S151-D4) ⇒ تخفیف ۲۰٪ پذیرفته', () => ex(wpool[0], { unitPrice: 1_000_000, discount: 200_000 }, { refundMode: 'STORE_CREDIT' }))
freePolicy(100)

console.log('\n۳) Y16 · عوارض/حق سرویس کالای جایگزین از تنظیمات (خرده: روی ردیف)')
await settingsService.saveCharge({ kind: 'tax', scope: 'pos', config: { enabled: true, rules: [{ categoryId: cat, mode: 'PERCENT', value: 10 }], fallback: null }, panelPassword: PW })
const r3 = await safe('بدون فیلد عوارض (فراخوان قدیمی) ⇒ سرور عوارض ۱۰٪ را خودش می‌گذارد', () => ex(pool[5], { unitPrice: 1_000_000 }, { methodId: cash }))
const x3 = r3?.exchangeInvoiceId ? invRow(r3.exchangeInvoiceId) : null
eq('taxTotal سند تعویض = ۱۰۰٬۰۰۰', Number(x3?.taxTotal ?? -1), 100_000)
eq('عوارض روی ردیف نشست (خرده)', JSON.stringify(r3?.exchangeInvoiceId ? lineTax(r3.exchangeInvoiceId) : null), JSON.stringify([100_000]))
eq('جمع سند تعویض = ۱٬۱۰۰٬۰۰۰', Number(x3?.grandTotal ?? -1), 1_100_000)
eq('مابه‌التفاوت = ۱۰۰٬۰۰۰ (عوارض کالای تازه)', r3?.diff ?? null, 100_000)
c0 = counts()
await rejects('عوارض ۰ صریح برای کالای ۱۰٪ ⇒ رد', () => ex(pool[6], { unitPrice: 1_000_000, tax: 0 }, { methodId: cash }), 'عوارض')
await rejects('عوارض سطح فاکتور در تعویض خرده ⇒ رد', () => ex(pool[6], { unitPrice: 1_000_000, tax: 0 }, { invoiceTax: 100_000, methodId: cash }), 'عوارض')
await rejects('حق سرویس ۵۰٬۰۰۰ دستی (خودکار ۰) ⇒ رد', () => ex(pool[6], { unitPrice: 1_000_000, tax: 100_000 }, { serviceCharge: 50_000, methodId: cash }), 'حق سرویس')
await rejects('عوارض کمتر با رمز مدیر هم باز نمی‌شود', () => ex(pool[6], { unitPrice: 1_000_000, tax: 0 }, { methodId: cash, managerPassword: PW }), 'عوارض')
eq('هیچ سند/پرداختی ساخته نشد', counts(), c0)
const r4 = await safe('عوارض صریح ۱۰۰٬۰۰۰ (مثل UI) ⇒ پذیرفته', () => ex(pool[6], { unitPrice: 1_000_000, tax: 100_000 }, { methodId: cash }))
eq('taxTotal = ۱۰۰٬۰۰۰', Number(r4?.exchangeInvoiceId ? invRow(r4.exchangeInvoiceId).taxTotal : -1), 100_000)
await safe('گرد ۱ ریالی (۹۹٬۹۹۹) در تحمل ⇒ پذیرفته', () => ex(pool[7], { unitPrice: 1_000_000, tax: 99_999 }, { methodId: cash }))
const r5 = await safe('مبنای درصد بعد از تخفیف قلم: تخفیف ۱۰۰٬۰۰۰ ⇒ عوارض ۹۰٬۰۰۰', () => ex(pool[8], { unitPrice: 1_000_000, discount: 100_000 }, { refundMode: 'STORE_CREDIT' }))
eq('عوارض ردیف = ۹۰٬۰۰۰', JSON.stringify(r5?.exchangeInvoiceId ? lineTax(r5.exchangeInvoiceId) : null), JSON.stringify([90_000]))
await settingsService.saveCharge({ kind: 'service', scope: 'pos', config: { enabled: true, rules: [], fallback: { mode: 'FIXED', value: 20_000 } }, panelPassword: PW })
const r6 = await safe('حق سرویس ثابت ۲۰٬۰۰۰ خودکار ⇒ سند تعویض ۱٬۱۲۰٬۰۰۰', () => ex(pool[9], { unitPrice: 1_000_000 }, { methodId: cash }))
eq('serviceCharge سند تعویض = ۲۰٬۰۰۰', Number(r6?.exchangeInvoiceId ? invRow(r6.exchangeInvoiceId).serviceCharge : -1), 20_000)
eq('مابه‌التفاوت = ۱۲۰٬۰۰۰', r6?.diff ?? null, 120_000)
await settingsService.saveCharge({ kind: 'service', scope: 'pos', config: { enabled: false, rules: [], fallback: null }, panelPassword: PW })

console.log('\n۴) Y16 · فاکتور اصلی عمده ⇒ اسکوپ عوارض عمده، در سطح فاکتور')
await settingsService.saveCharge({ kind: 'tax', scope: 'wholesale', config: { enabled: true, rules: [], fallback: { mode: 'PERCENT', value: 5 } }, panelPassword: PW })
const r7 = await safe('تعویض فاکتور عمده بدون فیلد عوارض ⇒ عوارض ۵٪ سطح فاکتور', () => ex(wpool[1], { unitPrice: 1_000_000 }, { methodId: cash }))
eq('taxTotal = ۵۰٬۰۰۰', Number(r7?.exchangeInvoiceId ? invRow(r7.exchangeInvoiceId).taxTotal : -1), 50_000)
eq('عوارض ردیف عمده صفر', JSON.stringify(r7?.exchangeInvoiceId ? lineTax(r7.exchangeInvoiceId) : null), JSON.stringify([0]))
await rejects('عوارض ردیف ۱۰۰٬۰۰۰ روی تعویض عمده ⇒ رد', () => ex(wpool[2], { unitPrice: 1_000_000, tax: 100_000 }, { methodId: cash }), 'عوارض')

console.log('\n۵) ساختاری: UI تعویض عوارض را با همان تابع مشترک حساب و ارسال می‌کند')
const read = (p) => readFileSync(resolve(p), 'utf8')
const page = read('src/renderer/src/pages/SalesReturn.tsx')
truthy('SalesReturn: useCharges برای کالای جایگزین', /useCharges\(/.test(page))
truthy('SalesReturn: ارسال عوارض ردیف و حق سرویس در saleExchangeCreate', /tax: exCharges/.test(page) && /serviceCharge: exCharges/.test(page))
truthy('SalesReturn: عوارض و حق سرویس در جمع سند تعویض دیده می‌شود', /exTotals\.tax/.test(page) && /exTotals\.service/.test(page))
truthy('ReturnLookup کانال فاکتور (orderType) را دارد', /orderType: string/.test(read('src/shared/types.ts')))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
