/**
 * ===========================================================================
 * نشست ۲ زنجیره رفع — خوشه C / C1 · «ارزش برگشت = سهم واقعی مشتری از پرداخت»
 *
 * تصمیم مالک بند ۴-۱۱ و ۴-۱۷: مبلغ برگشت از snapshot فاکتور حساب می‌شود، نه از
 * `unitPrice × qty` خام:
 *   قیمت قلم − تخفیف قلم (+ مالیات قلم)   ← همان `lineTotal` ذخیره‌شده
 *   − سهم نسبی تخفیف کل فاکتور
 *   + سهم نسبی مالیات/حق سرویس سطح فاکتور
 * هزینه‌ی ارسال (deliveryFee) خدمتی است که مصرف شده و در ارزش کالا نمی‌آید
 * (DECISIONS.md، تصمیم S57-1).
 *
 * ترتیب محاسبه طبق بند ۵: تخصیص دقیق ریالی ← یک رُند ← reconcile با جمع کل
 * (روش بزرگ‌ترین باقی‌مانده) تا جمع سهم‌ها دقیقاً برابر «پرداختنی کالا» شود.
 * برای برگشت جزئی، سهم تجمعی حساب می‌شود تا جمع چند برگشت جزئی روی یک قلم
 * دقیقاً برابر سهم کل آن قلم شود (هیچ ریالی گم یا اضافه نمی‌شود).
 *
 * این فایل خالص است (بدون دیتابیس) و هم main و هم صفحه‌ی برگشت از آن استفاده
 * می‌کنند تا عددی که فروشنده می‌بیند همان عددی باشد که ثبت می‌شود.
 * ===========================================================================
 */

/** رُند ریاضی معمولی (بند ۴-۴۳): زیر ۰٫۵ پایین، ۰٫۵ و بالاتر بالا. */
export function roundRial(x: number): number {
  if (!Number.isFinite(x)) return 0
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5)
}

/**
 * نشست ۱۸۱ — ورودی محاسبه است، نه خروجی نمایش: ردیف Prisma (که حالا `bigint`
 * می‌دهد) باید بدون تبدیل دستی در هر صدازننده پذیرفته شود. همه‌ی مقادیر داخل
 * این فایل از `Number(...)`/`Math.round(...)` عبور می‌کنند و خروجی `number` است.
 */
type RialIn = number | bigint

export interface InvoiceForReturnValue {
  grandTotal?: RialIn | null
  deliveryFee?: RialIn | null
  items: { id: number; qty: number; unitPrice: RialIn; lineTotal?: RialIn | null; discount?: RialIn | null; tax?: RialIn | null }[]
}

/** «پرداختنی کالا» = جمع کل فاکتور منهای هزینه‌ی ارسال (هرگز منفی نیست). */
export function goodsPayableOf(inv: InvoiceForReturnValue): number {
  return Math.max(0, Math.round(Number(inv.grandTotal ?? 0)) - Math.max(0, Math.round(Number(inv.deliveryFee ?? 0))))
}

/** snapshot خالص قلم؛ اگر ردیف قدیمی lineTotal نداشت از اجزایش ساخته می‌شود. */
function lineBaseOf(it: InvoiceForReturnValue['items'][number]): number {
  const raw =
    it.lineTotal != null && Number.isFinite(Number(it.lineTotal))
      ? Number(it.lineTotal)
      : Number(it.unitPrice) * Number(it.qty) - Number(it.discount ?? 0) + Number(it.tax ?? 0)
  return Math.max(0, Math.round(raw))
}

/**
 * سهم هر قلم فاکتور از «پرداختنی کالا» (کل قلم، همه‌ی تعدادها).
 * جمع مقادیر برگشتی دقیقاً برابر `goodsPayableOf(inv)` است.
 */
export function allocateLineNet(inv: InvoiceForReturnValue): Map<number, number> {
  const out = new Map<number, number>()
  const bases = inv.items.map((it) => ({ id: it.id, base: lineBaseOf(it) }))
  const sumBase = bases.reduce((s, b) => s + b.base, 0)
  const target = goodsPayableOf(inv)
  if (sumBase <= 0 || target <= 0) {
    for (const b of bases) out.set(b.id, 0)
    return out
  }
  // تخصیص دقیق، سپس floor، سپس بزرگ‌ترین باقی‌مانده تا جمع = target
  const parts = bases.map((b) => {
    const exact = (target * b.base) / sumBase
    const fl = Math.floor(exact)
    return { id: b.id, fl, rem: exact - fl }
  })
  let left = target - parts.reduce((s, p) => s + p.fl, 0)
  const order = [...parts].sort((a, b) => b.rem - a.rem || a.id - b.id)
  for (const p of order) {
    if (left <= 0) break
    p.fl += 1
    left -= 1
  }
  for (const p of parts) out.set(p.id, p.fl)
  return out
}

/**
 * ارزش برگشت `qty` عدد از یک قلم، وقتی `prevReturnedQty` عدد از قبل برگشت خورده.
 * سهم تجمعی ⇒ جمع برگشت‌های جزئی = سهم کل قلم.
 */
export function returnValueOf(lineNet: number, soldQty: number, prevReturnedQty: number, qty: number): number {
  const sold = Math.max(0, Math.round(soldQty))
  if (sold <= 0 || qty <= 0) return 0
  const prev = Math.min(sold, Math.max(0, Math.round(prevReturnedQty)))
  const upto = Math.min(sold, prev + Math.round(qty))
  return roundRial((lineNet * upto) / sold) - roundRial((lineNet * prev) / sold)
}

/**
 * مبلغ «کامل، بدون کسر تخفیف» برای override مدیر.
 *
 * unitPrice و tax هر دو snapshot قلم‌اند؛ مالیات/عوارض قلم حفظ می‌شود، اما
 * تخفیف قلم و سهم تخفیف کل فاکتور عمداً وارد این عدد نمی‌شوند. تخصیص تعداد
 * جزئی با همان قاعده‌ی رند واحد انجام می‌شود تا چند برگشت ریالی روی هم دقیقاً
 * به قیمت کامل همان قلم برسند.
 */
export function returnListPriceOf(unitPrice: number, tax: number, soldQty: number, qty: number): number {
  const sold = Math.max(0, Math.round(soldQty))
  const take = Math.min(sold, Math.max(0, Math.round(qty)))
  if (sold <= 0 || take <= 0) return 0
  return roundRial(Number(unitPrice || 0) * take + (Number(tax || 0) * take) / sold)
}

/**
 * C5 — تجمیع ردیف‌های تکراری یک `saleItemId` *قبل* از اعتبارسنجی. بدون این،
 * دو ردیف qty=۱ روی قلمی که فقط ۱ عدد فروخته شده جدا جدا از سقف رد می‌شدند و
 * ۲ عدد برگشت می‌خورد.
 */
export function mergeReturnTargets<T extends { saleItemId: number; qty: number }>(targets: T[]): { saleItemId: number; qty: number }[] {
  const m = new Map<number, number>()
  for (const t of targets) {
    const id = Number(t.saleItemId)
    const q = Number(t.qty)
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(q) || q <= 0) continue
    m.set(id, (m.get(id) ?? 0) + q)
  }
  return [...m.entries()].map(([saleItemId, qty]) => ({ saleItemId, qty }))
}

/** C7 — وضعیت‌هایی که برگشت رویشان کاملاً ممنوع است (بند ۴-۲۰). */
export const NON_RETURNABLE_STATUSES = ['DRAFT', 'CANCELED'] as const
export function isReturnableStatus(status: string | null | undefined): boolean {
  return !NON_RETURNABLE_STATUSES.includes(String(status ?? '') as any)
}
