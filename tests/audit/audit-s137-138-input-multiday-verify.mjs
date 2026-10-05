/**
 * ممیزی نشست ۱۳۷ و ۱۳۸ — هشدار نشست چندروزه و validation ورودی مالی (تأیید رفتاری، ایرادی دیده نشد).
 * لبه‌هایی که تست‌های fix-s137/fix-s138 نمی‌سنجیدند: مرز دقیق نیمه‌شب، نشست بسته‌ی دوروزه، تخفیف بیش از
 * جمع قلم، عدد خارج از سقف امن، مبلغ متنی، qty صفر، درصد عمده‌ی ۱۰۱، و اینکه ورودی نامعتبر در update
 * فاکتور موجود را دست نمی‌زند؛ همچنین فروش معتبر با اعتبار null/تخفیف مجاز همچنان ثبت می‌شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s138a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { shiftService } = await import(join(root, 'src/main/services/ShiftService.ts'))
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 400) } } }
const H = 3600_000
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime()
const userId = seed.user('فروشنده ۱۳۸')

console.log('\n— ۱) هشدار نشست چندروزه در مرز نیمه‌شب (S137)')
{
  const across = seed.insert('Shift', { name: 'شب', number: 1, dayJalali: toJalaliDate(new Date(T0 - 1000)), openedAt: T0 - 1000, closedAt: T0 + 1000, userId, staffConfirmed: 1 })
  const sameDayClosed = seed.insert('Shift', { name: 'صبح', number: 2, dayJalali: today, openedAt: T0 + 1000, closedAt: T0 + 2000, userId, staffConfirmed: 1 })
  const a = await safe(() => shiftService.info(across))
  eq('نشست بسته‌ی ۲۳:۵۹:۵۹ تا ۰۰:۰۰:۰۱ هشدار چندروزه دارد', typeof a?.multiDayWarning, 'string')
  eq('هشدار هر دو روز را نام می‌برد', /از .* تا /.test(a?.multiDayWarning ?? ''), true)
  const b = await safe(() => shiftService.info(sameDayClosed))
  eq('نشست بسته‌ی همان روز (بعد از نیمه‌شب) هشدار ندارد', b?.multiDayWarning ?? null, null)
}

console.log('\n— ۲) validation ورودی مالی (S138)')
const productId = seed.product('جین ۱۳۸', seed.category('پوشاک'))
const variantId = seed.variant(productId, 'سایز ۱۳۸')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000000 WHERE id = ?').run(variantId)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'عصر', number: 3, dayJalali: today, openedAt: Date.now() - H, userId, staffConfirmed: 1 })
const line = (o = {}) => ({ variantId, qty: 1, unitPrice: 1000000, discount: 0, tax: 0, ...o })
const input = (o = {}) => ({ userId, shiftId, deductInventory: false, lines: [line()], payments: [], ...o })
const counts = () => [seed.count('SaleInvoice', '1 = 1'), seed.count('Payment', '1 = 1')]
const rejects = async (label, fn, needle) => {
  const before = counts()
  const r = await safe(fn)
  eq(`${label} ⇒ پیام «${needle}»`, (r?.__error ?? '').includes(needle), true)
  eq(`${label} ⇒ هیچ فاکتور/پرداختی ساخته نشد`, counts(), before)
}
await rejects('تخفیف قلم ۱٬۰۰۰٬۰۰۱ روی قلم ۱٬۰۰۰٬۰۰۰', () => salesService.create(input({ lines: [line({ discount: 1000001 })] })), 'مبلغ نهایی هر قلم')
await rejects('قیمت خارج از سقف امن', () => salesService.create(input({ lines: [line({ unitPrice: 2 ** 53 })] })), 'قیمت واحد')
await rejects('qty صفر', () => salesService.create(input({ lines: [line({ qty: 0 })] })), 'تعداد هر قلم')
await rejects('مبلغ پرداخت متنی «۵۰۰»', () => salesService.create(input({ payments: [{ methodId: cash, amount: '500', destination: 'CASH' }] })), 'مبلغ پرداختی')
await rejects('درصد تخفیف عمده ۱۰۱', () => salesService.create(input({ wholesaleDiscountPercent: 101 })), 'درصد تخفیف عمده')
await rejects('شناسه کالای جاافتاده', () => salesService.create(input({ lines: [{ qty: 1, unitPrice: 1000, discount: 0, tax: 0 }] })), 'شناسه کالا')
const valid = await safe(() => salesService.create(input({ lines: [line({ discount: 100000 })], storeCreditAmount: null, payments: [{ methodId: cash, amount: 900000, destination: 'CASH' }] })))
eq('فروش معتبر با تخفیف مجاز و اعتبار null ثبت می‌شود', valid?.__error ?? 'ok', 'ok')
const inv = seed.one('SELECT grandTotal, paidTotal FROM "SaleInvoice" WHERE id = ?', valid?.id ?? -1)
eq('جمع کل ۹۰۰٬۰۰۰ و پرداخت ۹۰۰٬۰۰۰', [Number(inv?.grandTotal), Number(inv?.paidTotal)], [900000, 900000])
{
  const before = seed.one('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?', valid?.id ?? -1)
  const r = await safe(() => salesService.update({ ...input(), id: valid?.id, keepPayments: true, payments: undefined, lines: [line({ discount: 1000001 })] }))
  eq('update با تخفیف بیش از جمع قلم رد می‌شود', (r?.__error ?? '').includes('مبلغ نهایی هر قلم'), true)
  eq('فاکتور موجود دست‌نخورده ماند', seed.one('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?', valid?.id ?? -1)?.grandTotal, before?.grandTotal)
  const p = await safe(() => salesService.addPayment({ invoiceId: valid?.id, userId, methodId: cash, amount: Number.POSITIVE_INFINITY, destination: 'CASH' }))
  eq('addPayment با بی‌نهایت رد می‌شود', (p?.__error ?? '').includes('مبلغ پرداختی'), true)
}
console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
