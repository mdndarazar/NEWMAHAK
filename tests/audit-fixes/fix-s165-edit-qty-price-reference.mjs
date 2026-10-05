/**
 * ===========================================================================
 * نشست ۱۶۵ · S153-D6 · S165-D2 — مرجع قیمت ویرایش فاکتور فقط برای همان تعداد فاکتور اصلی.
 *
 * قبل از رفع: preverifySalePolicy مرجع ویرایش را «کمترین قیمت همان کالا در فاکتور اصلی» می‌گرفت، بدون تعداد.
 * پس قیمتی که مدیر برای ۱ عدد تأیید کرده بود (۳۰۰٬۰۰۰ برای کالای ۱٬۰۰۰٬۰۰۰) در ویرایش برای ۱۰ عدد بی‌رمز و
 * بدون هیچ Audit قیمت دستی پذیرفته می‌شد ⇒ ۶٬۳۰۰٬۰۰۰ ریال کم‌ثبتی پنهان (بند ۴-۲۶ / ۴-۳۹، هدف ضدسرقت).
 * بعد از رفع: عددهای اضافه بر فاکتور اصلی با قیمت فعلی کالا (CATALOG) سنجیده می‌شوند.
 *
 *     node --import ./test/harness/register.mjs tests/pending/fix-s165-edit-qty-price-reference.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s165-edit-'))
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
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون تأیید پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 120)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 160)}`); return null }
}

const actor = seed.user('فروشنده ۱۶۵')
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const pid = seed.product('شلوار ۱۶۵', seed.category('پوشاک ۱۶۵'))
const v1 = seed.insert('ProductVariant', { productId: pid, code: 'P165-1', barcode: 'B165-1', salePrice: 1_000_000, stock: 100 })
const v2 = seed.insert('ProductVariant', { productId: pid, code: 'P165-2', barcode: 'B165-2', salePrice: 1_000_000, stock: 100 })
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 100, maxAmount: 0 })
const setAccounting = async (patch) => seed.setting(SETTING_KEYS.accountingPolicy, { ...(await settingsService.accountingPolicy()), ...patch })
const overrideAudits = () => seed.count('AuditLog', 'action = ?', 'SALE_PRICE_OVERRIDE')
const lastOverride = () => seed.one('SELECT entityId, before, after, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', 'SALE_PRICE_OVERRIDE')
const line = (o = {}) => ({ variantId: v1, code: 'P165-1', barcode: 'B165-1', name: 'شلوار ۱۶۵', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0, ...o })
const sale = (o = {}) => ({ userId: actor, shiftId, deductInventory: false, lines: [line()], payments: [], ...o })
const itemsOf = (id) => seed.rows('SELECT variantId, qty, unitPrice FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id).map((r) => [Number(r.variantId), Number(r.qty), Number(r.unitPrice)])

console.log('\n۱) قیمت تأییدشده برای ۱ عدد، در ویرایش برای ۱۰ عدد')
const inv = await safe('فروش ۱ عدد ۳۰۰٬۰۰۰ با رمز مدیر', () => salesService.create(sale({ lines: [line({ unitPrice: 300_000 })], managerPassword: PW })))
const upd = (o = {}) => ({ ...sale(o), id: Number(inv?.id), keepPayments: true })
let a0 = overrideAudits()
await rejects('ویرایش به ۱۰ عدد ۳۰۰٬۰۰۰ بی‌رمز ⇒ رد', () => salesService.update(upd({ lines: [line({ qty: 10, unitPrice: 300_000 })] })), 'رمز مدیر')
eq('فاکتور دست‌نخورده ماند', itemsOf(inv?.id), [[v1, 1, 300_000]])
eq('Audit قیمت دستی تازه‌ای ثبت نشد', overrideAudits(), a0)
await rejects('همان ویرایش با دو ردیف ۵+۵ بی‌رمز ⇒ رد (مصرف مشترک سهم فاکتور اصلی)', () => salesService.update(upd({ lines: [line({ qty: 5, unitPrice: 300_000 }), line({ qty: 5, unitPrice: 300_000 })] })), 'رمز مدیر')
await safe('ویرایش به ۱۰ عدد ۳۰۰٬۰۰۰ با رمز مدیر ⇒ پذیرفته', () => salesService.update(upd({ lines: [line({ qty: 10, unitPrice: 300_000 })], managerPassword: PW })))
eq('Audit SALE_PRICE_OVERRIDE ویرایش ثبت شد', overrideAudits(), a0 + 1)
const ov = lastOverride()
eq('Audit: ۹ عدد مازاد با مرجع قیمت فعلی کالا', /"qty":9,"price":1000000,"source":"CATALOG"/.test(String(ov?.before)), true)
eq('Audit: عدد تحت پوشش فاکتور اصلی (همان ۳۰۰٬۰۰۰) قیمت دستی نیست', /"source":"INVOICE"/.test(String(ov?.before)), false)
await safe('ویرایش دوباره با همان ۱۰ عدد بی‌رمز ⇒ پذیرفته (مدیر ۱۰ عدد را تأیید کرده)', () => salesService.update(upd({ lines: [line({ qty: 10, unitPrice: 300_000 })] })))
await safe('کاهش به ۳ عدد بی‌رمز ⇒ پذیرفته', () => salesService.update(upd({ lines: [line({ qty: 3, unitPrice: 300_000 })] })))
await rejects('برگشت دوباره به ۴ عدد بی‌رمز ⇒ رد', () => salesService.update(upd({ lines: [line({ qty: 4, unitPrice: 300_000 })] })), 'رمز مدیر')

console.log('\n۲) قیمت اصلی پس از گران‌شدن کالا (سازگار با S153-D5)')
const inv2 = await safe('فروش ۱ عدد کالای دوم با قیمت فروش ۱٬۰۰۰٬۰۰۰', () => salesService.create(sale({ lines: [line({ variantId: v2, code: 'P165-2', barcode: 'B165-2' })] })))
seed.rows('UPDATE "ProductVariant" SET salePrice = 1200000 WHERE id = ? RETURNING id', v2)
const upd2 = (o = {}) => ({ ...sale(o), id: Number(inv2?.id), keepPayments: true })
const l2 = (o = {}) => line({ variantId: v2, code: 'P165-2', barcode: 'B165-2', ...o })
await safe('همان ۱ عدد با قیمت اصلی ⇒ بی‌رمز پذیرفته', () => salesService.update(upd2({ lines: [l2()] })))
await rejects('۲ عدد با قیمت اصلی (عدد دوم زیر قیمت فعلی) بی‌رمز ⇒ رد', () => salesService.update(upd2({ lines: [l2({ qty: 2 })] })), 'رمز مدیر')
await safe('۲ عدد با قیمت فعلی ۱٬۲۰۰٬۰۰۰ برای عدد دوم ⇒ بی‌رمز پذیرفته', () => salesService.update(upd2({ lines: [l2(), l2({ unitPrice: 1_200_000 })] })))

console.log('\n۳) گیت قیمت دستی خاموش: بی‌رمز ولی با Audit')
await setAccounting({ requireManagerForPriceOverride: false })
a0 = overrideAudits()
await safe('ویرایش به ۶ عدد ۳۰۰٬۰۰۰ با گیت خاموش ⇒ پذیرفته', () => salesService.update(upd({ lines: [line({ qty: 6, unitPrice: 300_000 })] })))
eq('Audit ثبت شد با مرجع CATALOG برای ۳ عدد مازاد', /"qty":3,"price":1000000,"source":"CATALOG"/.test(String(lastOverride()?.before)) && overrideAudits() === a0 + 1, true)
await setAccounting({ requireManagerForPriceOverride: true })

console.log('\n۴) بازه‌ی تخفیف: کاهش قیمتِ عددهای مازاد هم تخفیف حساب می‌شود')
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 20, maxAmount: 0 })
await rejects('ویرایش به ۸ عدد ۳۰۰٬۰۰۰ حتی با رمز ⇒ رد با پیام بازه‌ی تخفیف', () => salesService.update(upd({ lines: [line({ qty: 8, unitPrice: 300_000 })], managerPassword: PW })), 'تخفیف')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
