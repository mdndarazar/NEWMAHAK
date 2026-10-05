// نشست ۱۵۰: تست قبل/بعد S150-b (PartyService.manualPurchaseTotal + عملیات مدیریتی اعتبار خرید: گرد/clamp بی‌صدا).
/**
 * ===========================================================================
 * نشست ۱۵۰ · خوشه E/K · بند ۴-۲۸(د) و بند ۵ («هرگز مقدار منفی یا بیش از مانده را قبول نکن»)
 *
 * قبل از رفع:
 *   ۱) createCustomer/updateCustomer: manualPurchaseTotal با Math.max(0, Math.round(Number||0))
 *      ⇒ ۱۵۰۰٫۵ ⇒ ۱۵۰۱، ‎-۵ ⇒ ۰، «7» ⇒ ۷، ۳e9 بی‌سقف؛ UI هم هر غیررقم را حذف می‌کرد («۱۲٫۵» ⇒ ۱۲۵).
 *   ۲) changeCreditAmount: ۱۵۰۰٫۵ ⇒ ۱۵۰۱، بی‌سقف. changeCreditUses: maxUses ۵۰۰۰ ⇒ بی‌صدا ۱۰۰۰،
 *      ‎-۳ ⇒ ۱، maxPerTransaction ‎-۵ ⇒ ۰. reactivateCredit: extendDays ۹۹۹۹۹ ⇒ ۳۶۵۰، ‎-۵ ⇒ ۰.
 *      changeCreditRestrictions: minPurchase/maxPerTransaction clamp. loadCredit: id ۱٫۵ ⇒ اعتبار #۲ (!).
 *   ۳) validation بعد از رمز مدیر اجرا می‌شد (پیام رمز به‌جای پیام عدد).
 * انتظار بعد: رد فارسی بدون گرد/clamp، پیش از رمز؛ سقف ۲٬۱۴۷٬۴۸۳٬۶۴۷ برای ستون‌های Int؛ صفر تغییر.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s150b-party-credit-integer-validation.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s150b-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

await import('electron')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { partyService } = await import('../../src/main/services/PartyService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { jalaliToday } = await import('@shared/jalali')

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
const customers = () => seed.count('Customer')
const mpt = (id) => Number(seed.one('SELECT manualPurchaseTotal FROM "Customer" WHERE id = ?', id)?.manualPurchaseTotal)
const credit = (id) => seed.one('SELECT amount, maxUses, multiUse, maxPerTransaction, minPurchase, status, expiresAt FROM "StoreCredit" WHERE id = ?', id)

console.log('\n۱) createCustomer: مجموع مبلغ خرید دستی سخت')
const c0 = customers()
await rejects('۱۵۰۰٫۵ (قبلاً ۱۵۰۱)', () => partyService.createCustomer({ name: 'مشتری الف ۱۵۰', manualPurchaseTotal: 1500.5 }), 'مبلغ خرید دستی')
await rejects('«7» متنی', () => partyService.createCustomer({ name: 'مشتری ب ۱۵۰', manualPurchaseTotal: '7' }), 'مبلغ خرید دستی')
await rejects('‎-۵ (قبلاً ۰)', () => partyService.createCustomer({ name: 'مشتری ج ۱۵۰', manualPurchaseTotal: -5 }), 'مبلغ خرید دستی')
await rejects('NaN', () => partyService.createCustomer({ name: 'مشتری د ۱۵۰', manualPurchaseTotal: Number.NaN }), 'مبلغ خرید دستی')
await rejects('۳e9 بیش از سقف', () => partyService.createCustomer({ name: 'مشتری هـ ۱۵۰', manualPurchaseTotal: 3e9 }), 'سقف')
eq('هیچ مشتری تازه‌ای ساخته نشد', customers(), c0)
const cu1 = await safe('بدون فیلد ⇒ ۰', () => partyService.createCustomer({ name: 'مشتری و ۱۵۰' }))
eq('manualPurchaseTotal پیش‌فرض', mpt(cu1?.id), 0)
const cu2 = await safe('null ⇒ ۰', () => partyService.createCustomer({ name: 'مشتری ز ۱۵۰', manualPurchaseTotal: null }))
eq('manualPurchaseTotal null', mpt(cu2?.id), 0)
const cu3 = await safe('۱٬۵۰۰٬۰۰۰ معتبر', () => partyService.createCustomer({ name: 'مشتری ح ۱۵۰', manualPurchaseTotal: 1_500_000 }))
eq('ذخیره‌ی دقیق', mpt(cu3?.id), 1_500_000)

console.log('\n۲) updateCustomer: همان قاعده، بدون تغییر رکورد در رد')
await rejects('۲٫۵', () => partyService.updateCustomer({ id: cu3?.id, manualPurchaseTotal: 2.5 }), 'مبلغ خرید دستی')
await rejects('‎-۱', () => partyService.updateCustomer({ id: cu3?.id, manualPurchaseTotal: -1 }), 'مبلغ خرید دستی')
await rejects('۳e9', () => partyService.updateCustomer({ id: cu3?.id, name: 'نام تازه', manualPurchaseTotal: 3e9 }), 'سقف')
eq('مبلغ دست‌نخورده', mpt(cu3?.id), 1_500_000)
eq('نام هم دست‌نخورده (رد کامل)', String(seed.one('SELECT name FROM "Customer" WHERE id = ?', cu3?.id)?.name), 'مشتری ح ۱۵۰')
await safe('۲٬۰۰۰٬۰۰۰ معتبر', () => partyService.updateCustomer({ id: cu3?.id, manualPurchaseTotal: 2_000_000 }))
eq('ذخیره‌ی دقیق پس از ویرایش', mpt(cu3?.id), 2_000_000)
await safe('ویرایش بدون فیلد مبلغ', () => partyService.updateCustomer({ id: cu3?.id, name: 'مشتری ح ۱۵۰' }))
eq('مبلغ حفظ شد', mpt(cu3?.id), 2_000_000)

console.log('\n۳) changeCreditAmount')
const today = jalaliToday()
const idA = seed.insert('StoreCredit', { code: 'S150A0001', amount: 1_000_000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now(), issuedAtJalali: today })
const idB = seed.insert('StoreCredit', { code: 'S150B0002', amount: 700_000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now(), issuedAtJalali: today })
eq('شناسه‌ها پشت‌سرهم (برای تست id اعشاری)', idB, idA + 1)
const R = { reason: 'اصلاح تست ۱۵۰', managerPassword: PW }
await rejects('۱۵۰۰٫۵ (قبلاً ۱۵۰۱)', () => storeCreditService.changeAmount({ id: idA, amount: 1500.5, ...R }), 'مبلغ')
await rejects('«7» متنی', () => storeCreditService.changeAmount({ id: idA, amount: '7', ...R }), 'مبلغ')
await rejects('NaN', () => storeCreditService.changeAmount({ id: idA, amount: Number.NaN, ...R }), 'مبلغ')
await rejects('صفر', () => storeCreditService.changeAmount({ id: idA, amount: 0, ...R }), 'بزرگ‌تر از صفر')
await rejects('۳e9 بیش از سقف', () => storeCreditService.changeAmount({ id: idA, amount: 3e9, ...R }), 'سقف')
await rejects('validation پیش از رمز (۱۵۰۰٫۵ بی‌رمز ⇒ پیام مبلغ)', () => storeCreditService.changeAmount({ id: idA, amount: 1500.5, reason: 'x x x' }), 'عدد صحیح')
eq('مبلغ A دست‌نخورده', Number(credit(idA)?.amount), 1_000_000)
await rejects('id اعشاری ۱٫۵ (قبلاً اعتبار بعدی را تغییر می‌داد)', () => storeCreditService.changeAmount({ id: idA + 0.5, amount: 5_000, ...R }), 'شناسه')
await rejects('id متنی', () => storeCreditService.changeAmount({ id: String(idA), amount: 5_000, ...R }), 'شناسه')
eq('مبلغ B دست‌نخورده', Number(credit(idB)?.amount), 700_000)
await safe('۲٬۰۰۰٬۰۰۰ معتبر', () => storeCreditService.changeAmount({ id: idA, amount: 2_000_000, ...R }))
eq('مبلغ A دقیق', Number(credit(idA)?.amount), 2_000_000)

console.log('\n۴) changeCreditUses')
await rejects('maxUses ۲٫۵', () => storeCreditService.changeUses({ id: idA, maxUses: 2.5, multiUse: true, ...R }), 'عدد صحیح')
await rejects('maxUses ۵۰۰۰ (قبلاً بی‌صدا ۱۰۰۰)', () => storeCreditService.changeUses({ id: idA, maxUses: 5000, multiUse: true, ...R }), 'عدد صحیح')
await rejects('maxUses ‎-۳ (قبلاً ۱)', () => storeCreditService.changeUses({ id: idA, maxUses: -3, ...R }), 'عدد صحیح')
await rejects('maxUses صفر', () => storeCreditService.changeUses({ id: idA, maxUses: 0, ...R }), 'عدد صحیح')
await rejects('maxPerTransaction ۲٫۵', () => storeCreditService.changeUses({ id: idA, maxPerTransaction: 2.5, ...R }), 'سقف هر تراکنش')
await rejects('maxPerTransaction ‎-۵ (قبلاً ۰)', () => storeCreditService.changeUses({ id: idA, maxPerTransaction: -5, ...R }), 'سقف هر تراکنش')
await rejects('maxPerTransaction ۳e9', () => storeCreditService.changeUses({ id: idA, maxPerTransaction: 3e9, ...R }), 'سقف مجاز')
await rejects('validation پیش از رمز (maxUses ۲٫۵ بی‌رمز)', () => storeCreditService.changeUses({ id: idA, maxUses: 2.5, reason: 'x x x' }), 'عدد صحیح')
await rejects('پیام قدیمی «یک بار» + چندباره حفظ شد', () => storeCreditService.changeUses({ id: idA, maxUses: 1, multiUse: true, ...R }), 'چندباره')
let cr = credit(idA)
eq('maxUses دست‌نخورده', Number(cr?.maxUses), 1)
eq('maxPerTransaction دست‌نخورده', Number(cr?.maxPerTransaction), 0)
await safe('maxUses ۳ چندباره + سقف تراکنش ۵۰۰٬۰۰۰', () => storeCreditService.changeUses({ id: idA, maxUses: 3, multiUse: true, maxPerTransaction: 500_000, ...R }))
cr = credit(idA)
eq('maxUses = ۳', Number(cr?.maxUses), 3)
eq('maxPerTransaction = ۵۰۰٬۰۰۰', Number(cr?.maxPerTransaction), 500_000)

console.log('\n۵) changeCreditRestrictions')
await rejects('minPurchase ۲٫۵', () => storeCreditService.changeRestrictions({ id: idA, minPurchase: 2.5, ...R }), 'حداقل خرید')
await rejects('minPurchase ‎-۱', () => storeCreditService.changeRestrictions({ id: idA, minPurchase: -1, ...R }), 'حداقل خرید')
await rejects('maxPerTransaction ۳e9', () => storeCreditService.changeRestrictions({ id: idA, maxPerTransaction: 3e9, ...R }), 'سقف مجاز')
eq('minPurchase دست‌نخورده', Number(credit(idA)?.minPurchase), 0)
await safe('minPurchase ۱۰۰٬۰۰۰ معتبر', () => storeCreditService.changeRestrictions({ id: idA, minPurchase: 100_000, ...R }))
eq('minPurchase دقیق', Number(credit(idA)?.minPurchase), 100_000)

console.log('\n۶) reactivateCredit: روزهای تمدید سخت')
await safe('تعلیق B', () => storeCreditService.suspend({ id: idB, ...R }))
await rejects('extendDays ۲٫۵', () => storeCreditService.reactivate({ id: idB, extendDays: 2.5, ...R }), 'روز')
await rejects('extendDays ‎-۵ (قبلاً ۰)', () => storeCreditService.reactivate({ id: idB, extendDays: -5, ...R }), 'روز')
await rejects('extendDays ۹۹۹۹۹ (قبلاً بی‌صدا ۳۶۵۰)', () => storeCreditService.reactivate({ id: idB, extendDays: 99999, ...R }), '۳٬۶۵۰')
await rejects('extendDays «30» متنی', () => storeCreditService.reactivate({ id: idB, extendDays: '30', ...R }), 'روز')
await rejects('validation پیش از رمز', () => storeCreditService.reactivate({ id: idB, extendDays: 2.5, reason: 'x x x' }), 'عدد صحیح')
eq('B هنوز معلق', String(credit(idB)?.status), 'SUSPENDED')
await safe('extendDays ۳۰ معتبر', () => storeCreditService.reactivate({ id: idB, extendDays: 30, ...R }))
cr = credit(idB)
eq('B فعال شد', String(cr?.status), 'ACTIVE')
const days = (Number(cr?.expiresAt) - Date.now()) / 86_400_000
truthy(`انقضا حدود ۳۰ روز بعد (${days.toFixed(2)})`, days > 29.9 && days <= 30.01)

console.log('\n۷) سیم‌کشی UI (ساختاری)')
const settings = readFileSync(resolve('src/renderer/src/pages/Settings.tsx'), 'utf8')
truthy('Settings دیگر غیررقم را از مبلغ خرید دستی حذف نمی‌کند', !/manualPurchaseTotal\)\.replace\(\/\[\^0-9\]\/g/.test(settings) && !settings.includes("Number(toLatinDigits(raw).replace(/[^0-9]/g, '')) || 0"))
truthy('Settings از parseGroupedInteger برای مبلغ خرید دستی استفاده می‌کند', (settings.match(/parseGroupedInteger\(/g) ?? []).length >= 2)
truthy('پیام فارسی برای مبلغ خرید دستی نامعتبر در UI', settings.includes('مجموع مبلغ خرید دستی باید عدد صحیح'))
const pickers = readFileSync(resolve('src/renderer/src/components/CreditPickers.tsx'), 'utf8')
truthy('NumberField اعتبار دیگر گرد نمی‌کند', !pickers.includes('onChange(Math.round(+e.target.value || 0))'))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
