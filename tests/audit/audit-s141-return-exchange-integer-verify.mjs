/**
 * ممیزی نشست ۱۴۱ (S141) — تأیید رفتاری رد اعشار در برگشت/تعویض (fix-s141 عمدتاً قراردادی بود).
 *   • qty/قیمت/تخفیف اعشاری در createReturn، returnUpdate و createExchange با پیام هدف رد و بی‌اثر.
 *   • برگشت کامل بدون lines، برگشت جزئی با سهم تخفیف کل (بند ۴-۱۱: ۹۰۰٬۰۰۰)، returnUpdate با ردیف صفر.
 *   • mergeReturnTargets: اعشار حذف، تکراری‌ها جمع.
 *   • AUDIT-S141-01: validateExchangeMutation تخفیف ≥۰ را بی‌سقف می‌پذیرفت؛ تخفیف قلم جایگزین بیش از مبلغ
 *     همان قلم (یا تخفیف کل بیش از جمع سند) سند تعویض با جمع منفی و مابه‌التفاوت منفیِ بزرگ‌تر از ارزش
 *     کالای برگشتی می‌ساخت ⇒ بازپرداخت نقد یا اعتبار بیش از ارزش برگشتی (فروش با validateSaleInput رد می‌کرد).
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s141a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { mergeReturnTargets } = await import(join(root, 'src/shared/returnValue.ts'))
const { toJalaliDate } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 400) } } }

const userId = seed.user('فروشنده ۱۴۱')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const today = toJalaliDate(new Date())
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const product = seed.product('شلوار جین', seed.category('پوشاک'))
const mkVariant = (size, price) => { const id = seed.variant(product, size); db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = ? WHERE id = ?').run(price, id); return id }
const stockOf = (id) => Number(seed.one('SELECT stock FROM "ProductVariant" WHERE id = ?', id).stock)
const itemsOf = (invId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invId).map((r) => Number(r.id))
const counts = () => [seed.count('SaleReturn', '1=1'), seed.count('SaleInvoice', '1=1'), seed.count('StoreCredit', '1=1'), seed.count('StockMovement', '1=1')]
const cashSale = (lines, invoiceDiscount = 0) => {
  const total = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0) - invoiceDiscount
  return salesService.create({ userId, shiftId, invoiceDiscount, lines: lines.map((l) => ({ discount: 0, tax: 0, ...l })), payments: [{ methodId: cash, amount: total, destination: 'CASH' }] })
}

console.log('\n— ۱) mergeReturnTargets')
eq('اعشار حذف، تکراری‌ها جمع', mergeReturnTargets([{ saleItemId: 1, qty: 1 }, { saleItemId: 1, qty: 2 }, { saleItemId: 2, qty: 1.5 }, { saleItemId: 3, qty: 0 }]), [{ saleItemId: 1, qty: 3 }])

const v1 = mkVariant('30', 1_000_000), v2 = mkVariant('32', 1_000_000), vRep = mkVariant('34', 1_000_000)

console.log('\n— ۲) createReturn: اعشار رد، جزئی درست، کامل بدون lines')
{
  const sale = await cashSale([{ variantId: v1, qty: 1, unitPrice: 1_000_000 }, { variantId: v2, qty: 1, unitPrice: 1_000_000 }], 200_000)
  const [i1, i2] = itemsOf(sale.id)
  const before = counts()
  const r = await safe(() => salesService.createReturn({ invoiceId: sale.id, full: false, lines: [{ saleItemId: i1, qty: 0.6 }], refundMethod: 'NONE', userId }))
  eq('qty=0.6 رد با پیام «تعداد برگشتی»', /تعداد برگشتی باید عدد صحیح/.test(r?.__error ?? ''), true)
  eq('qty=0.6 هیچ اثری نگذاشت', counts(), before)
  const r2 = await safe(() => salesService.createReturn({ invoiceId: sale.id, full: false, lines: [{ saleItemId: i1, qty: 1 }], refundMethod: 'CASH', refundAmount: 100.5, userId }))
  eq('refundAmount=100.5 رد با پیام «مبلغ بازپرداخت»', /مبلغ بازپرداخت باید عدد صحیح/.test(r2?.__error ?? ''), true)
  eq('refundAmount اعشاری هیچ اثری نگذاشت', counts(), before)
  // با پرداخت کامل و برگشت بدون خروج پول، اضافه‌دریافت واقعی ساخته می‌شود؛
  // فلو فعلی تأیید آگاهانه می‌خواهد تا ردیف اضافه بی‌صدا ثبت نشود.
  const ok1 = await safe(() => salesService.createReturn({ invoiceId: sale.id, full: false, lines: [{ saleItemId: i1, qty: 1 }], refundMethod: 'NONE', confirmOverpay: true, userId }))
  eq('برگشت جزئی یک کالا بی‌خطا', ok1?.__error ?? null, null)
  eq('بند ۴-۱۱: برگشت یک کالا از دو کالای ۱٬۰۰۰٬۰۰۰ با ۱۰٪ تخفیف کل = ۹۰۰٬۰۰۰', Number(seed.one('SELECT total FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', sale.id)?.total), 900_000)
  eq('موجودی کالای ۱ برگشت (۹ ⇒ ۱۰)', stockOf(v1), 10)
  const full = await safe(() => salesService.createReturn({ invoiceId: sale.id, full: true, refundMethod: 'NONE', confirmOverpay: true, userId }))
  eq('برگشت کامل بدون lines پذیرفته شد', full?.__error ?? null, null)
  eq('برگشت کامل باقی‌مانده = ۹۰۰٬۰۰۰', Number(seed.one('SELECT total FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', sale.id)?.total), 900_000)
  eq('موجودی کالای ۲ برگشت', stockOf(v2), 10)
}

console.log('\n— ۳) returnUpdate: اعشار رد، ردیف صفر مجاز')
{
  const sale = await cashSale([{ variantId: v1, qty: 2, unitPrice: 1_000_000 }, { variantId: v2, qty: 1, unitPrice: 1_000_000 }])
  const [i1, i2] = itemsOf(sale.id)
  const ret = await salesService.createReturn({
    invoiceId: sale.id,
    full: false,
    lines: [{ saleItemId: i1, qty: 1 }],
    refundMethod: 'NONE',
    confirmOverpay: true,
    userId
  })
  const retId = Number(ret?.id ?? ret?.returnId ?? seed.one('SELECT id FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', sale.id).id)
  const r = await safe(() => salesService.returnUpdate({ id: retId, lines: [{ saleItemId: i1, qty: 1.5 }], userId }))
  eq('qty=1.5 رد با پیام «تعداد برگشتی»', /تعداد برگشتی باید عدد صحیح/.test(r?.__error ?? ''), true)
  eq('برگشت دست‌نخورده (۱٬۰۰۰٬۰۰۰)', Number(seed.one('SELECT total FROM "SaleReturn" WHERE id = ?', retId).total), 1_000_000)
  const u = await safe(() => salesService.returnUpdate({
    id: retId,
    lines: [{ saleItemId: i1, qty: 0 }, { saleItemId: i2, qty: 1 }],
    userId,
    panelPassword: DEFAULT_MANAGER_PASSWORD,
    overrideReason: 'جابجایی امن قلم برگشتی'
  }))
  eq('ردیف صفر + ردیف دیگر پذیرفته شد', u?.__error ?? null, null)
  eq('جمع برگشت بعد از ویرایش = ۱٬۰۰۰٬۰۰۰ (فقط کالای ۲)', Number(seed.one('SELECT total FROM "SaleReturn" WHERE id = ?', retId).total), 1_000_000)
  eq('قلم ۱ از برگشت خارج شد', seed.count('SaleReturnItem', 'returnId = ? AND saleItemId = ?', retId, i1), 0)
}

console.log('\n— ۴) createExchange: اعشار رد')
{
  const sale = await cashSale([{ variantId: v1, qty: 1, unitPrice: 1_000_000 }])
  const [i1] = itemsOf(sale.id)
  const before = counts(); const repStock = stockOf(vRep)
  for (const [label, rep, re] of [
    ['qty جایگزین 1.5', { variantId: vRep, qty: 1.5 }, /تعداد کالای جایگزین باید عدد صحیح/],
    ['تخفیف جایگزین 0.5', { variantId: vRep, qty: 1, discount: 0.5 }, /تخفیف کالای جایگزین باید عدد صحیح/],
    ['مالیات جایگزین منفی', { variantId: vRep, qty: 1, tax: -1 }, /مالیات کالای جایگزین باید عدد صحیح/]
  ]) {
    const r = await safe(() => salesService.createExchange({ invoiceId: sale.id, lines: [{ saleItemId: i1, qty: 1 }], replacements: [rep], userId, shiftId }))
    eq(`${label}: رد با پیام هدف`, re.test(r?.__error ?? ''), true)
  }
  const r = await safe(() => salesService.createExchange({ invoiceId: sale.id, lines: [{ saleItemId: i1, qty: 0.5 }], replacements: [{ variantId: vRep, qty: 1 }], userId, shiftId }))
  eq('qty برگشتی 0.5: رد با پیام «تعداد برگشتی»', /تعداد برگشتی باید عدد صحیح/.test(r?.__error ?? ''), true)
  const rf = await safe(() => salesService.createExchange({ invoiceId: sale.id, full: true, replacements: [{ variantId: vRep, qty: 1 }], userId, shiftId }))
  eq('تعویض full بدون lines (UI نمی‌فرستد) با پیام فارسی رد', /اقلام برگشتی|بزرگ‌تر از صفر/.test(rf?.__error ?? ''), true)
  eq('هیچ اثری نماند', counts(), before)
  eq('موجودی جایگزین دست‌نخورده', stockOf(vRep), repStock)
}

console.log('\n— ۵) AUDIT-S141-01: تخفیف جایگزین/کل بیش از مبلغ سند تعویض')
{
  // فاکتور دوقلمی ۲٬۰۰۰٬۰۰۰ نقد؛ فقط یک کالای ۱٬۰۰۰٬۰۰۰ برمی‌گردد، پس سقف «پول دریافتی» (۲٬۰۰۰٬۰۰۰) جلوی بازپرداخت اضافه را نمی‌گیرد
  const sale = await cashSale([{ variantId: v1, qty: 1, unitPrice: 1_000_000 }, { variantId: v2, qty: 1, unitPrice: 1_000_000 }])
  const [i1] = itemsOf(sale.id)
  const before = counts(); const repStock = stockOf(vRep)
  const r = await safe(() => salesService.createExchange({ invoiceId: sale.id, lines: [{ saleItemId: i1, qty: 1 }], replacements: [{ variantId: vRep, qty: 1, discount: 2_000_000 }], refundMode: 'CASH', userId, shiftId }))
  eq('تخفیف ۲٬۰۰۰٬۰۰۰ روی قلم جایگزین ۱٬۰۰۰٬۰۰۰: رد با پیام «از مبلغ همان قلم بیشتر است»', /از مبلغ همان قلم.*بیشتر است/.test(r?.__error ?? ''), true)
  eq('بازپرداخت نقد ۲٬۰۰۰٬۰۰۰ برای برگشت ۱٬۰۰۰٬۰۰۰ ساخته نشد', r?.diff ?? null, null)
  eq('هیچ سند/اعتباری ساخته نشد', counts(), before)
  eq('موجودی جایگزین دست‌نخورده', stockOf(vRep), repStock)
  const sale2 = await cashSale([{ variantId: v1, qty: 1, unitPrice: 1_000_000 }, { variantId: v2, qty: 1, unitPrice: 1_000_000 }])
  const [k1] = itemsOf(sale2.id)
  const before2 = counts()
  const r2 = await safe(() => salesService.createExchange({ invoiceId: sale2.id, lines: [{ saleItemId: k1, qty: 1 }], replacements: [{ variantId: vRep, qty: 1 }], invoiceDiscount: 1_800_000, refundMode: 'STORE_CREDIT', userId, shiftId }))
  eq('تخفیف کل ۱٬۸۰۰٬۰۰۰ روی سند ۱٬۰۰۰٬۰۰۰: رد با پیام «جمع سند تعویض»', /جمع سند تعویض/.test(r2?.__error ?? ''), true)
  eq('اعتبار ۱٬۸۰۰٬۰۰۰ برای برگشت ۱٬۰۰۰٬۰۰۰ ساخته نشد', r2?.diff ?? null, null)
  eq('هیچ سند/اعتباری ساخته نشد (۲)', counts(), before2)
  const sale3 = await cashSale([{ variantId: v1, qty: 1, unitPrice: 1_000_000 }, { variantId: v2, qty: 1, unitPrice: 1_000_000 }])
  const [j1] = itemsOf(sale3.id)
  const okx = await safe(() => salesService.createExchange({ invoiceId: sale3.id, lines: [{ saleItemId: j1, qty: 1 }], replacements: [{ variantId: vRep, qty: 1, discount: 1_000_000 }], refundMode: 'STORE_CREDIT', userId, shiftId }))
  eq('تخفیف دقیقاً برابر مبلغ قلم (مرز) همچنان پذیرفته است', okx?.__error ?? null, null)
  eq('مرز: مابه‌التفاوت = −۱٬۰۰۰٬۰۰۰ (نه بیشتر)', okx?.diff, -1_000_000)
  eq('مرز: هیچ قلم منفی در سند تعویض', okx?.exchangeInvoiceId ? seed.count('SaleInvoiceItem', 'invoiceId = ? AND lineTotal < 0', okx.exchangeInvoiceId) : null, 0)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
