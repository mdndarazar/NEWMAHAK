/**
 * ===========================================================================
 * نشست ۱۵۸ (تست) / ۱۵۹ (رفع) · خوشه E/K · Y15 · مقصد پول نقد فقط «نقد در صندوق» (بند ۴-۱۳)
 *
 * قبل از رفع: allowedDestinationsFor(CASH) = [CASH, MANAGER] ⇒ روش «نقدی» با مقصد «حساب مدیر»
 * در فروش (پرداخت اولیه)، addPayment و updatePayment پذیرفته می‌شد؛ پول نقد بی‌آنکه از کشو رد شود
 * از «نقد مورد انتظار» بیرون می‌ماند (مسیر پنهان‌کردن کسری کشو).
 * بعد از رفع: نقد فقط CASH؛ پیام فارسی راه درست را می‌گوید (ثبت در صندوق + «برداشت از صندوق» با رمز مدیر و دلیل).
 * کارت و روش‌های بانکی/سفارشی و چک دست نخورده‌اند؛ ردیف قدیمی نقد⇐مدیر با ویرایش بی‌ربط مجبور به تغییر نمی‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y15-cash-destination.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y15-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست مقصد' }
const { allowedDestinationsFor } = await import('@shared/enums')
const { jalaliToday } = await import('@shared/jalali')

let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون رد پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 160)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 200)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); return null }
}

const today = jalaliToday()
const A = seed.user('فروشنده ۱۵۸')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const bank = seed.insert('PaymentMethod', { key: 'C2C', label: 'کارت‌به‌کارت', kind: 'CUSTOM', isActive: 1, sortOrder: 3 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A, staffConfirmed: 1 })
const product = seed.product('شلوار ۱۵۸', seed.category('پوشاک ۱۵۸'))
const v1 = seed.insert('ProductVariant', { productId: product, code: 'Y15', barcode: 'BY15', salePrice: 500_000, stock: 50 })
const line = () => ({ variantId: v1, code: 'Y15', barcode: 'BY15', name: 'شلوار ۱۵۸', qty: 1, unitPrice: 500_000, discount: 0, tax: 0 })
const payCount = (id) => seed.count('Payment', 'invoiceId = ?', id)
const paid = (id) => Number(seed.one('SELECT paidTotal FROM "SaleInvoice" WHERE id = ?', id).paidTotal)
const HINT = 'برداشت از صندوق'

console.log('\n۱) قاعده‌ی مشترک UI و main')
eq('allowedDestinationsFor(CASH) فقط نقد در صندوق', [...allowedDestinationsFor('CASH')], ['CASH'])
eq('کارت: کارتخوان یا حساب مدیر (بدون تغییر)', [...allowedDestinationsFor('CARD')], ['CARD', 'MANAGER'])
eq('روش سفارشی/بانکی: هر سه (بدون تغییر)', [...allowedDestinationsFor('CUSTOM')].sort(), ['CARD', 'CASH', 'MANAGER'])

console.log('\n۲) پرداخت اولیه‌ی فروش: نقدی ⇐ حساب مدیر')
let before = seed.count('SaleInvoice')
await rejects('فروش با پرداخت نقدی به مقصد حساب مدیر ⇒ رد', () => salesService.create({ userId: A, shiftId, lines: [line()], payments: [{ methodId: cash, amount: 500_000, destination: 'MANAGER' }] }), HINT)
eq('هیچ فاکتوری ساخته نشد', seed.count('SaleInvoice'), before)
const s1 = await safe('کنترل: نقدی ⇐ نقد در صندوق پذیرفته', () => salesService.create({ userId: A, shiftId, lines: [line()], payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }] }))
await safe('کنترل: کارت‌به‌کارت ⇐ حساب مدیر پذیرفته', () => salesService.create({ userId: A, shiftId, lines: [line()], payments: [{ methodId: bank, amount: 500_000, destination: 'MANAGER' }] }))

console.log('\n۳) addPayment (مسیر عمومی دریافت)')
const inv = await salesService.create({ userId: A, shiftId, lines: [line()], payments: [] })
await rejects('addPayment نقدی ⇐ حساب مدیر ⇒ رد', () => salesService.addPayment({ invoiceId: inv.id, amount: 200_000, methodId: cash, destination: 'MANAGER', userId: A }), HINT)
eq('هیچ ردیف پرداختی ساخته نشد', payCount(inv.id), 0)
eq('بدهی دست‌نخورده', paid(inv.id), 0)
await safe('کنترل: addPayment نقدی ⇐ صندوق پذیرفته', () => salesService.addPayment({ invoiceId: inv.id, amount: 200_000, methodId: cash, destination: 'CASH', userId: A }))
await safe('کنترل: addPayment کارتخوان ⇐ حساب مدیر پذیرفته (بدون تغییر)', () => salesService.addPayment({ invoiceId: inv.id, amount: 100_000, methodId: card, destination: 'MANAGER', userId: A }))
eq('paidTotal = ۳۰۰٬۰۰۰', paid(inv.id), 300_000)

console.log('\n۴) updatePayment')
const p1 = Number(seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', s1.id).id)
await rejects('ویرایش مقصد پرداخت نقدی به حساب مدیر ⇒ رد', () => salesService.updatePayment({ id: p1, destination: 'MANAGER', userId: A, ...GATE }), HINT)
eq('مقصد همان نقد ماند', seed.one('SELECT destination FROM "Payment" WHERE id = ?', p1).destination, 'CASH')
const pc = Number(seed.one('SELECT id FROM "Payment" WHERE invoiceId = ? AND methodId = ?', inv.id, card).id)
await rejects('تغییر روش کارتخوان⇐مدیر به «نقدی» با همان مقصد مدیر ⇒ رد', () => salesService.updatePayment({ id: pc, methodId: cash, userId: A, ...GATE }), HINT)
// ردیف قدیمی نقد ⇐ مدیر (پیش از رفع) با ویرایش بی‌ربط مجبور به تغییر نمی‌شود
const legacy = seed.insert('Payment', { invoiceId: inv.id, methodId: cash, amount: 50_000, kind: 'CASH', destination: 'MANAGER', seq: 9, paidAt: Date.now() - 60_000, paidAtJalali: today, createdAt: Date.now() - 60_000, createdShiftId: shiftId, createdByUserId: A })
await safe('ردیف قدیمی نقد⇐مدیر: ویرایش توضیح بی‌رمز و بی‌تغییر مقصد پذیرفته', () => salesService.updatePayment({ id: legacy, note: 'اصلاح توضیح', userId: A }))
eq('مقصد ردیف قدیمی بی‌صدا عوض نشد', seed.one('SELECT destination FROM "Payment" WHERE id = ?', legacy).destination, 'MANAGER')

console.log('\n۵) ساختاری: UI همان تابع مشترک را می‌خواند')
const read = (p) => readFileSync(resolve(p), 'utf8')
eq('PaymentDestinationBox از allowedDestinationsFor', /allowedDestinationsFor\(methodKind\)/.test(read('src/renderer/src/components/PaymentDestinationBox.tsx')), true)
// `method` پس از guard خالی‌نبودن با non-null assertion مصرف می‌شود؛ همچنان
// همان تابع مشترک UI/server است، نه یک قاعدهٔ محلی جدا.
eq('Pos.tsx از allowedDestinationsFor', /allowedDestinationsFor\(method!?\.kind\)/.test(read('src/renderer/src/pages/Pos.tsx')), true)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
