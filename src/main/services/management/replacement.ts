/**
 * فی جایگزینی یک معنی دارد: آخرین فاکتور خرید.
 * اگر فاکتور خرید نبود، فی کارت کالا با برچسب تقریبی.
 */
import { prisma } from '../../db/client'
import { toRial } from '@shared/money'
import { toJalaliDate } from '@shared/jalali'

const db = prisma as any

/**
 * «آخرین فاکتور خرید» یعنی آخرین فاکتور **به تاریخ خودِ فاکتور**، نه به زمانی که
 * در برنامه ثبت شده (B5 — بازبینی هشتم). فاکتور هفتهٔ پیش که امروز تایپ می‌شود
 * نباید جای فی امروزِ مغازه را بگیرد؛ و برعکس.
 *
 * عمداً `lotDate` (و همان‌طور ترتیب مصرف FIFO) دست نخورده می‌ماند: آن «زمان رسیدن
 * جنس به قفسه» است و تاریخچهٔ هزینهٔ فروش‌ها را جابه‌جا می‌کرد — یعنی رفع یک ادعا
 * با ساختن یک عددِ تاریخ‌ساز جدید. این‌جا فقط قاعدهٔ نمایش فی جایگزینی درست شد.
 * اگر لاتِ همان فاکتور نبود (مثلاً خرید فقط روی کاغذ و نه در انبارِ این فروشگاه)،
 * رفتار قبلی حفظ می‌شود.
 *
 * **B1 (بازبینی یازدهم) — `asOf`:** فی جایگزینیِ یک قلمِ **فروخته‌شده** تا امروز
 * «آخرین خریدِ تا لحظهٔ پردازشِ دفتر» بود. یعنی همان فروش، بسته به اینکه دفتر کِی
 * به آن قلم برسد فیِ جایگزینیِ دیگری می‌گرفت — فروشِ تاریخ‌خورده/دیرپردازش‌شده و هر
 * قلمی که با ویرایشِ خطِ قدیمی از نو قفل می‌شود، فیِ «امروز» را می‌خورد و «سود تورمی»
 * یک ماهِ بسته جابه‌جا می‌شد. حالا هر جا عدد برای **گذشته** ساخته می‌شود، `asOf`
 * (تاریخ همان فروش/همان حرکت) رد می‌شود و فاکتورِ تازه‌تر از آن تاریخ شمرده نمی‌شود؛
 * برای فروشِ هم‌روزِ خودش هیچ چیز عوض نمی‌شود، و چون بازپخشِ دفتر هم به همان تاریخ
 * برمی‌گردد، «بازسازی دفتر» دقیقاً همان عددِ اجرای عادی را می‌دهد (idempotent). ارزش *ماندهٔ* قفسه همچنان با
 * فیِ «امروز» خوانده می‌شود (بدون `asOf`) — همان تفکیکی که مالک گذاشت: «فی لحظهٔ
 * قفل» برای کالای رفته، «امروز» برای کالای مانده.
 */
export type ReplacementPriceSource = 'PURCHASE_INVOICE' | 'PRODUCT_CARD' | 'NO_INVOICE'

export async function lastPurchaseUnit(
  variantId: number,
  asOf?: Date | string | number | null
): Promise<{
  unit: bigint
  approx: boolean
  source: ReplacementPriceSource
  purchaseInvoiceId: number | null
}> {
  /** `asOf` فقط «تا آن روز» را می‌گیرد — همان `issuedAtJalali`ِ خودِ فاکتور. */
  const capJalali = asOf ? toJalaliDate(asOf instanceof Date ? asOf : new Date(asOf)) : null
  const capDate = asOf ? (asOf instanceof Date ? asOf : new Date(asOf)) : null
  const lastByInvoiceDate = await db.purchaseInvoice.findFirst({
    where: {
      status: 'CONFIRMED',
      items: { some: { variantId } },
      ...(capJalali ? { issuedAtJalali: { lte: capJalali } } : {})
    },
    orderBy: [{ issuedAtJalali: 'desc' }, { id: 'desc' }],
    select: { id: true }
  })
  if (lastByInvoiceDate?.id) {
    /**
     * «موارد کم‌اثر» — اگر یک فاکتور خرید چند خط از یک کالا داشته باشد، لات‌هایش
     * فی‌های مختلفی دارند؛ برداشتنِ «اولین لات» عدد را به ترتیبِ ثبتِ خطوط گره می‌زد.
     * همان‌جا که `unitCostFromPurchase` میانگینِ وزن‌دار می‌گیرد، این هم میانگین
     * می‌گیرد (تا فیِ «امروز» و فیِ لاتِ همان فاکتور دو چیزِ متفاوت نباشند).
     */
    const lots = await db.purchaseLot.findMany({
      /**
       * عمداً روی خودِ لات‌ها `lotDate` سقف نمی‌شود: «تا آن تاریخ» یعنی تا تاریخِ
       * **همان فاکتور** (که بالا با `issuedAtJalali` چسبیده)، و `lotDate` لحظهٔ ثبتِ
       * حرکت است — فاکتوری که سه‌روزِ پیش صادر شده و دیروز تایپ شده، لاتش «بعد از»
       * فروش است ولی فی‌اش مالِ قبل از فروش. سقف‌کردنش یعنی انداختنِ بی‌دلیلِ کل فاکتور
       * و افتادن به قیمتِ کارتِ کالا.
       */
      where: { purchaseInvoiceId: Number(lastByInvoiceDate.id), variantId, source: 'PURCHASE' },
      select: { unitCost: true, qtyIn: true, approx: true }
    })
    if (lots.length) {
      let qty = 0
      let cost = 0n
      let approx = false
      for (const l of lots) {
        const q = Math.max(0, Number(l.qtyIn) || 0)
        if (q <= 0) continue
        qty += q
        cost += toRial(l.unitCost) * BigInt(q)
        if (l.approx) approx = true
      }
      if (qty > 0)
        return {
          unit: cost / BigInt(qty),
          approx,
          source: 'PURCHASE_INVOICE',
          purchaseInvoiceId: Number(lastByInvoiceDate.id)
        }
      const first = lots[0]
      return {
        unit: toRial(first.unitCost),
        approx: !!first.approx,
        source: 'PURCHASE_INVOICE',
        purchaseInvoiceId: Number(lastByInvoiceDate.id)
      }
    }
  }
  const last = await db.purchaseLot.findFirst({
    where: { variantId, source: 'PURCHASE', ...(capDate ? { lotDate: { lte: capDate } } : {}) },
    orderBy: [{ lotDate: 'desc' }, { id: 'desc' }]
  })
  if (last) {
    const purchaseInvoiceId = last.purchaseInvoiceId == null ? null : Number(last.purchaseInvoiceId)
    return {
      unit: toRial(last.unitCost),
      approx: !!last.approx,
      source: purchaseInvoiceId == null ? 'NO_INVOICE' : 'PURCHASE_INVOICE',
      purchaseInvoiceId
    }
  }
  const v = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: { purchasePrice: true }
  })
  return { unit: toRial(v?.purchasePrice ?? 0), approx: true, source: 'PRODUCT_CARD', purchaseInvoiceId: null }
}
