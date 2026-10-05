/**
 * گزارش مدیریت · فاز ۲ — مانده، کم‌فروش، ABC، منحنی سایز، خرید در برابر فروش.
 * موجودی از `ProductVariant.stock` خوانده می‌شود، نه از جمع مجدد حرکت انبار.
 * هیچ نوشتنی روی موجودی نیست.
 */
import { prisma } from '../../db/client'
import { saleWhere, salesService, REPORT_EXCLUDED_SALE_STATUSES } from '../SalesService'
import { lastPurchaseUnit } from './replacement'
import { costEngine } from './CostEngine'
import { pendingRestockService } from '../PendingRestockService'
import { toNumberRial } from '@shared/money'
import { allocateLineNet } from '@shared/returnValue'
import { jalaliToday, toJalaliDate, jalaliEndOfDay, jalaliStartOfDay } from '@shared/jalali'
import {
  shopReturnRatio,
  restockedReturnShares,
  createRestockTaker,
  storeReturnAttributions
} from './returnShare'
import { findByIds } from './inChunk'
import { addJalaliDays, normalizeJalaliYmd } from '@shared/jalaliBuckets'
import { categoryWithDescendants } from './categoryTree'
import { BusinessError } from '../../errors'
import type { SaleReportFilter } from '@shared/types'

export type CostReveal = { withCost?: boolean }

export type StockFilter = {
  fromJalali?: string
  toJalali?: string
  categoryId?: number | null
  minStock?: number
  idleSinceJalali?: string | null
  onlyActive?: boolean
}

function n(v: unknown): number {
  return toNumberRial((v as number) ?? 0)
}

function daysBetween(from: Date | null, to: Date): number | null {
  if (!from) return null
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86400000))
}

async function soldQtyByVariant(fromJalali: string, toJalali: string): Promise<Map<number, number>> {
  const where = saleWhere({ fromJalali, toJalali } as SaleReportFilter)
  const groups = await prisma.saleInvoiceItem.groupBy({
    by: ['variantId'],
    where: { invoice: where },
    _sum: { qty: true }
  })
  const map = new Map<number, number>()
  for (const g of groups) map.set(g.variantId, Number(g._sum.qty ?? 0))
  return map
}

async function returnedQtyByVariant(fromJalali: string, toJalali: string): Promise<Map<number, number>> {
  const start = fromJalali
  const end = toJalali
  const groups = await prisma.saleReturnItem.groupBy({
    by: ['variantId'],
    where: {
      return: {
        voidedAt: null,
        returnedAtJalali: { gte: start, lte: end }
      },
      /**
       * B10 (بازبینی یازدهم) — «فروش» از `saleWhere` می‌آید که فاکتورِ بی‌اعتبار/لغو را
       * بیرون می‌گذارد، ولی برگشتش این‌جا می‌ماند ⇒ یک فروشِ بی‌اعتبارشده دو بار از
       * عدد کم می‌شد (یکی با نبودنش، یکی با برگشتش) و «پوشش/روزیِ لازم» همان کالا
       * کوچک‌تر از واقع می‌شد.
       */
      saleItem: { invoice: { voidedAt: null, status: { notIn: REPORT_EXCLUDED_SALE_STATUSES } } }
    },
    _sum: { qty: true }
  })
  const map = new Map<number, number>()
  for (const g of groups) map.set(g.variantId, Number(g._sum.qty ?? 0))
  return map
}

export const stockInsightService = {
  async stock(filter: StockFilter = {}, reveal: CostReveal = {}) {
    const withCost = reveal.withCost !== false
    const today = jalaliToday()
    const to = normalizeJalaliYmd(filter.toJalali) || today
    const from30 = addJalaliDays(to, -29)
    const from90 = addJalaliDays(to, -89)
    const catId = filter.categoryId != null && Number(filter.categoryId) > 0 ? Number(filter.categoryId) : null
    const catIds = catId ? await categoryWithDescendants(catId) : null
    const minStock = Math.max(0, Math.round(Number(filter.minStock ?? 0) || 0))
    const onlyActive = filter.onlyActive !== false

    const variants = await prisma.productVariant.findMany({
      where: {
        ...(onlyActive ? { isActive: true, deletedAt: null } : {}),
        ...(catIds ? { product: { categoryId: { in: catIds } } } : {})
      },
      select: {
        id: true,
        code: true,
        barcode: true,
        size: true,
        color: true,
        stock: true,
        minStock: true,
        purchasePrice: true,
        isActive: true,
        createdAt: true,
        product: { select: { id: true, name: true, category: { select: { id: true, name: true } } } }
      }
    })

    /**
     * B10 (بازبینی نهم) — «تا تاریخ» اگر گذشته باشد، مبنای زمان‌ها قاطی می‌شد:
     * فروش ۳۰/۹۰ روزه نسبت به همان تاریخ بود ولی «آخرین فروش» نسبت به **امروز**،
     * پس کالایی که بعد از آن تاریخ فروخته شده «خواب ۰» می‌خورد (و `daysBetween` با
     * `Math.max(0,…)` منفی را صفر می‌کرد). حالا آخرین فروش/خرید هم تا همان لحظهٔ
     * «تا» خوانده می‌شود. موجودی ذاتاً «همین حالا» است (مخزن لحظه‌ای) و اگر بازه
     * بسته شده باشد خودِ صفحه یک خط توضیح می‌گذارد، نه عددِ تاریخ‌خوردهٔ ساختگی.
     */
    const asOf = jalaliEndOfDay(to)
    /**
     * B5 (بازبینی یازدهم) — متنِ پایینِ همین صفحه قول می‌داد فاکتورِ لغوشده «خواب» را
     * صفر نکند، ولی «آخرین فروش» از `StockMovement` خوانده می‌شد و مسیرِ بی‌اعتبار
     * کردنِ فاکتور فروش فقط `voidedAt` را پر می‌کند (هیچ حرکتِ برگشتی روی انبار
     * نمی‌نویسد) ⇒ یک فروشِ لغوشده «آخرین فروش = دیروز» می‌ساخت و خوابِ کالای سه‌ساله
     * به صفر می‌رسید. حالا از خودِ فاکتورهای فروشِ شمرده‌شده خوانده می‌شود: همان
     * `saleWhere` که تعریفِ «فروش» در کل برنامه است — بی‌اعتبار/پیش‌نویس/لغوشده
     * خودبه‌خود بیرون‌اند و مبنای تاریخ هم `issuedAt` است، نه لحظهٔ ثبت در برنامه.
     *
     * روی JOIN نمی‌شود گروه‌بندی کرد، پس یک اسکنِ گروهی (همان هزینهٔ کوئریِ حرکات که
     * حذف شد) و بعد تاریخِ فاکتورِ آن قلم در دسته‌های ۵۰۰تایی.
     * نکتهٔ صادقانه: «بزرگ‌ترین id» برای یک واریانت ممکن است فروشِ تاریخ‌گذشتهٔ
     * تازه‌ثبت باشد؛ آن خواب را کمی **بلندتر** از واقع می‌کند — سمتِ محافظه‌کارِ همان
     * هشدار، و هرگز کوتاه‌تر.
     */
    const lastSalePromise = (async () => {
      // B9 (بازبینی دوازدهم) — «از ابتدای تاریخ» قبلاً با رشتهٔ `1300-01-01` نوشته می‌شد که فقط
      // تصادفی درست کار می‌کرد (پارسرِ جلالی آن قالب را نمی‌شناسد و قید حذف می‌شد). قیدِ صریح:
      const whereCounted = saleWhere({ from: new Date(0), toJalali: to } as SaleReportFilter)
      /**
       * سقفِ هزینه: «بزرگ‌ترین idِ هر واریانت» روی کل تاریخچه یک اسکنِ کامل است. first
       * فقط پنجرهٔ ۳۰۰۰ فاکتورِ آخر را گروه می‌کند (با ایندکسِ `invoiceId`)؛ واریانت‌هایی
       * که آن‌جا فروشِ شمرده‌ای ندارند — یعنی همان کالاهای خوابیده، که عددِ خوابشان
       * اهمیت دارد — در مرحلهٔ دوم **دقیقاً** و با ایندکسِ `variantId` خوانده می‌شوند.
       * پس نتیجه هیچ‌وقت «تقریبِ پنجره» نیست؛ فقط مسیرِ خواندن دو تکه شده.
       */
      const head = await prisma.saleInvoice.findFirst({ orderBy: { id: 'desc' }, select: { id: true } })
      const floor = Number(head?.id ?? 0) - 3000
      const groups = await prisma.saleInvoiceItem.groupBy({
        by: ['variantId'],
        where: { invoice: whereCounted, ...(floor > 0 ? { invoiceId: { gt: floor } } : {}) },
        _max: { id: true }
      })
      const best = new Map<number, number>()
      for (const g of groups) {
        const itemId = Number((g._max as any).id ?? 0)
        if (itemId > 0) best.set(Number(g.variantId), itemId)
      }
      const missing = variants.map((v) => Number(v.id)).filter((id) => !best.has(id))
      for (let i = 0; i < missing.length; i += 400) {
        const part = missing.slice(i, i + 400)
        const g2 = await prisma.saleInvoiceItem.groupBy({
          by: ['variantId'],
          where: { variantId: { in: part }, invoice: whereCounted },
          _max: { id: true }
        })
        for (const g of g2) {
          const vid = Number(g.variantId)
          const itemId = Number((g._max as any).id ?? 0)
          if (itemId > 0 && !best.has(vid)) best.set(vid, itemId)
        }
      }
      const wanted = [...best.entries()].map(([variantId, itemId]) => ({ variantId, itemId })).filter((x) => x.itemId > 0)
      const out = new Map<number, Date | null>()
      for (let i = 0; i < wanted.length; i += 500) {
        const part = wanted.slice(i, i + 500)
        const items = await prisma.saleInvoiceItem.findMany({
          where: { id: { in: part.map((x) => x.itemId) } },
          select: { id: true, invoice: { select: { issuedAt: true } } }
        })
        const byId = new Map(items.map((it) => [Number(it.id), (it as any).invoice?.issuedAt ?? null]))
        for (const w of part) {
          /** `issuedAt` ستون DateTime است؛ لایهٔ تست/درایور ممکن است عددِ epoch بدهد. */
          const d = byId.get(w.itemId)
          const date = d instanceof Date ? d : d == null ? null : new Date(typeof d === 'number' ? d : String(d))
          out.set(w.variantId, date && !Number.isNaN(date.getTime()) ? date : null)
        }
      }
      return out
    })()
    const [lastSaleOf, lastPurchase, sold30, sold90, ret30, ret90, pending] = await Promise.all([
      lastSalePromise,
      prisma.stockMovement.groupBy({
        by: ['variantId'],
        where: { reason: 'PURCHASE', createdAt: { lte: asOf } },
        _max: { createdAt: true }
      }),
      soldQtyByVariant(from30, to),
      soldQtyByVariant(from90, to),
      returnedQtyByVariant(from30, to),
      returnedQtyByVariant(from90, to),
      pendingRestockService.summary().catch(() => null)
    ])
    const lastBuyOf = new Map(lastPurchase.map((r) => [r.variantId, r._max.createdAt]))
    const idleSince = normalizeJalaliYmd(filter.idleSinceJalali) || null

    const rows: any[] = []
    for (const v of variants) {
      /**
       * B3 — «حداقل مانده» یک کف است، پس موجودی منفی (بیش‌فروختگی = دادهٔ خراب
       * انبار) قبلاً با پیش‌فرض `minStock = 0` کامل از دید در می‌رفت: ردیف نه در
       * جدول مانده بود، نه در جمع مانده، نه در فهرست سفارش. رنگ قرمز و فلگ
       * `stockNegative` در UI از قبل هست ولی هیچ‌وقت فعال نمی‌شد. منفی همیشه
       * می‌ماند؛ فیلتر فقط ردیف‌های سالمِ زیر کف را کم می‌کند.
       */
      if (v.stock < minStock && Number(v.stock) >= 0) continue
      const net30 = (sold30.get(v.id) ?? 0) - (ret30.get(v.id) ?? 0)
      const net90 = (sold90.get(v.id) ?? 0) - (ret90.get(v.id) ?? 0)
      const lastS = lastSaleOf.get(v.id) ?? null
      const lastB = lastBuyOf.get(v.id) ?? null
      const sleepDays = daysBetween(lastS, asOf)
      const neverSold = !lastS
      const sleepFrom = neverSold ? daysBetween(lastB ?? v.createdAt, asOf) : sleepDays
      if (idleSince && lastS && toJalaliDate(lastS) >= idleSince) continue
      if (idleSince && !lastS) {
        /* never sold — keep */
      }
      const daily = net30 > 0 ? net30 / 30 : 0
      // B3 — برای ماندهٔ منفی «پوشش روز» منفی معنی ندارد؛ صفر یعنی «همین حالا تمام شده».
      const coverDays = daily > 0 ? Math.max(0, Math.round(v.stock / daily)) : null
      /**
       * #3 (بازبینی نهم، ضعفِ سرعت) — «فی جایگزینی» برای هر کالا تا سه کوئری می‌زند.
       * جایی که مانده صفر است عدد ضرب در صفر می‌شود، پس کوئری‌ها را نمی‌زنیم: همان
       * صفر، بدون کار. (برچسب «تقریبی» هم روی صفر بی‌معنی است، پس آن هم نمی‌آید.)
       * batch‌کردنِ کوئری‌های باقی‌مانده انجام نشد: عددِ پولیِ دو تب را دست‌می‌داد و
       * ریسکش به این فایده نمی‌ارزید — با تستِ برابری شدنی است، در دور بعد.
       */
      const onHand = Number(v.stock)
      const lu = withCost && onHand !== 0 ? await lastPurchaseUnit(v.id) : null
      const replacementValue = withCost ? (onHand === 0 ? 0 : lu ? n(lu.unit) * onHand : null) : null
      /**
       * #9/#10 (بازبینی نهم) — «نرخ فروش» (sell-through) با همان دو عددی که این تب
       * دارد ساخته می‌شود: از آنچه در ۹۰ روز در دسترس بوده (رفته + مانده) چند درصد
       * رفته. هیچ عدد تازه‌ای از فروش نمی‌آید و هیچ فرمول موازی‌ای نیست.
       * «پیشنهاد حراج» هم فقط تفسیرِ همان دو عدد + روزهای خواب است، نه قیمت‌گذاری.
       */
      const sold90Pos = Math.max(0, net90)
      const stockPos = Math.max(0, onHand)
      const sellThrough =
        sold90Pos + stockPos > 0 ? Math.round((sold90Pos / (sold90Pos + stockPos)) * 100) : null
      const sleep = Number(sleepFrom ?? 0)
      const clearance =
        stockPos >= 2 && (neverSold ? sleep >= 90 : sleep >= 60) && (sellThrough ?? 100) < 25
          ? neverSold
            ? 'بدون فروش — حراج یا پس‌دادن به انبار مرکزی'
            : 'خوابیده — حراج'
          : null
      rows.push({
        variantId: v.id,
        productId: v.product.id,
        productName: v.product.name,
        categoryName: v.product.category?.name ?? 'بدون دسته',
        code: v.code,
        size: v.size || '—',
        color: v.color || '—',
        stock: v.stock,
        minStock: v.minStock,
        netSold30: net30,
        netSold90: net90,
        sleepDays: sleepFrom,
        neverSold,
        coverDays,
        sellThrough,
        clearance,
        ...(withCost ? { replacementValue, approx: !!lu?.approx, stockNegative: Number(v.stock) < 0 } : {}),
        belowMin: v.minStock > 0 && v.stock <= v.minStock
      })
    }
    rows.sort((a, b) => (b.sleepDays ?? 0) - (a.sleepDays ?? 0) || b.stock - a.stock)
    const totalQty = rows.reduce((s, r) => s + r.stock, 0)
    const totalReplacement = withCost ? rows.reduce((s, r) => s + (r.replacementValue ?? 0), 0) : undefined
    const idleRows = rows.filter((r) => (r.sleepDays ?? 0) >= 90 && r.stock > 0)
    const clearanceRows = rows.filter((r) => r.clearance)
    const idleCapital = withCost ? idleRows.reduce((s, r) => s + (r.replacementValue ?? 0), 0) : undefined
    /**
     * B2 — شرط `stock > 0` کالایی را که **همین حالا تمام شده** (یا بیش‌فروخته شده)
     * از پیشنهاد سفارش بیرون می‌انداخت؛ یعنی فوری‌ترین سفارش از فهرست جا می‌ماند.
     * `coverDays` فقط وقتی عدد است که فروش ۳۰روزه > ۰ باشد، پس «در حال فروش» بودن
     * همین‌جا تضمین شده و صفر/منفی هم باید دیده شود.
     */
    const reorder = rows
      .filter((r) => r.coverDays != null && r.coverDays <= 10)
      .map((r) => ({
        variantId: r.variantId,
        productName: r.productName,
        size: r.size,
        stock: r.stock,
        coverDays: r.coverDays,
        netSold30: r.netSold30
      }))
    return {
      rows,
      totalQty,
      ...(withCost ? { totalReplacement, idleCapital } : {}),
      idleCount: idleRows.length,
      clearanceCount: clearanceRows.length,
      asOfPast: to !== today,
      asOfDate: to,
      reorder,
      pendingRestock: pending,
      valueLabel: withCost
        ? 'مانده به ریال با فی جایگزینی امروز (آخرین فاکتور خریدِ همان کالا؛ اگر فاکتور نبود فی کارت با برچسب تقریبی). ' +
          // B9 (بازبینی یازدهم) — متنِ قبلی می‌گفت «جمع از لات‌های همهٔ واریانت‌هاست» ولی
          // `totalReplacement` جمعِ ردیف‌های همین جدول است؛ برچسب به واقعیت برگشت.
          'جمعِ بالا فقط «ردیف‌های همین جدول» است: با فیلترِ دسته و «فقط فعال‌ها» کوچک و بزرگ می‌شود، کالای غیرفعالِ فیلترشده داخلش نیست، و ردیفِ موجودیِ منفی هم با همان علامت کم می‌شود — پس «جمعِ کل انبار» نیست، «جمعِ چیزِ روی صفحه» است.'
        : undefined,
      note:
        'همه هشدار مدیریتی است؛ فروش را قفل نمی‌کند. موجودی همان عدد پنل کالاست. ' +
        (to !== today
          ? `بازه تا ${to} بسته شده، پس «خواب» و «فروش ۳۰/۹۰ روزه» نسبت به همان تاریخند و فروش‌های بعدش شمرده نمی‌شوند؛ ولی موجودی ذاتاً «همین حالا» است.`
          : '') +
        ' «آخرین فروش» از فاکتورهای فروشِ شمرده‌شده خوانده می‌شود (نه از دفتر حرکات انبار)، پس فاکتورِ بی‌اعتبارشده یا لغوشده خوابِ کالا را صفر نمی‌کند.',
      clearanceLabel:
        clearanceRows.length > 0
          ? `${clearanceRows.length.toLocaleString('fa-IR')} کالا ۶۰ روز (یا بدون فروش ۹۰ روز) روی قفسه مانده و نرخ فروش ۹۰روزش زیر ۲۵٪ است. پیشنهاد فقط یک برچسب است؛ قیمت را ما عوض نمی‌کنیم.`
          : undefined
    }
  },

  async abc(filter: StockFilter = {}, reveal: CostReveal = {}) {
    const withCost = reveal.withCost !== false
    // ABC سود واقعی از دفتر FIFO می‌خواند؛ فقط همان گزارشِ مجاز، اجرای افزایشی را
    // پیش از خواندن دفتر درخواست می‌کند. مسیرهای فروش/POS هیچ hook یا timer ندارند.
    const engineRun = withCost ? await costEngine.run() : null
    const engineBusy = !!(engineRun as any)?.busy
    const today = jalaliToday()
    const to = normalizeJalaliYmd(filter.toJalali) || today
    const from = addJalaliDays(to, -89)
    const catId = filter.categoryId != null && Number(filter.categoryId) > 0 ? Number(filter.categoryId) : null
    const catIds = catId ? await categoryWithDescendants(catId) : null
    const where = saleWhere({ fromJalali: from, toJalali: to })
    const invoices = await prisma.saleInvoice.findMany({
      where,
      select: {
        grandTotal: true,
        deliveryFee: true,
        items: {
          select: {
            id: true,
            qty: true,
            unitPrice: true,
            discount: true,
            tax: true,
            lineTotal: true,
            variant: {
              select: {
                productId: true,
                product: { select: { name: true, categoryId: true } }
              }
            }
          }
        }
      }
    })
    const inCat = (it: any) => !catIds || catIds.includes(it.variant?.product?.categoryId ?? -1)
    const byProduct = new Map<number, { productId: number; name: string; amount: number; qty: number }>()
    const itemNet = new Map<number, number>()
    const itemProduct = new Map<number, { productId: number; name: string; qty: number }>()
    for (const inv of invoices) {
      const net = allocateLineNet(inv as any)
      for (const it of inv.items) {
        if (!inCat(it)) continue
        const pid = it.variant?.productId
        if (!pid) continue
        const amount = net.get(it.id) ?? 0
        itemNet.set(it.id, amount)
        itemProduct.set(it.id, { productId: pid, name: it.variant.product.name, qty: Number(it.qty || 0) })
        const cur = byProduct.get(pid) ?? { productId: pid, name: it.variant.product.name, amount: 0, qty: 0 }
        cur.amount += amount
        cur.qty += Number(it.qty || 0)
        byProduct.set(pid, cur)
      }
    }
    let noteExtra = ''
    /**
     * B7 (بازبینی دوازدهم) — همین کوئری در تب سود گارد داشت و اینجا نداشت: برگشتِ **لغوشده**
     * (`voidedAt` روی خودِ `SaleReturn`) و برگشتی که فاکتورش بی‌اعتبار/پیش‌نویس/لغوِ سفارش است،
     * از درآمدِ ABC کم می‌شد ⇒ رتبهٔ آن کالا بی‌دلیل پایین‌تر. «پس‌گرفتهٔ فروش» هم مثلِ آنجا
     * بیرون می‌ماند (برگشتِ پس‌گرفته دیگر برگشت نیست).
     */
    const retItems = await prisma.saleReturnItem.findMany({
      where: {
        return: { voidedAt: null, returnedAtJalali: { gte: from, lte: to } },
        saleItem: { invoice: { voidedAt: null, status: { notIn: REPORT_EXCLUDED_SALE_STATUSES } } }
      },
      orderBy: { id: 'asc' },
      select: { qty: true, restockedQty: true, saleItemId: true, returnId: true, variantId: true }
    })
    const inWindowItems = new Set(itemProduct.keys())
    const missingAbc = [...new Set(retItems.map((r) => r.saleItemId).filter((id) => !itemProduct.has(id)))]
    if (missingAbc.length) {
      const extra = await findByIds(prisma as any, 'saleInvoiceItem', 'id', missingAbc, {
        select: {
          id: true,
          qty: true,
          invoice: {
            select: {
              grandTotal: true,
              deliveryFee: true,
              items: { select: { id: true, qty: true, unitPrice: true, discount: true, tax: true, lineTotal: true } }
            }
          },
          variant: { select: { productId: true, product: { select: { name: true, categoryId: true } } } }
        }
      })
      for (const it of extra) {
        if (catIds && !catIds.includes(it.variant?.product?.categoryId ?? -1)) continue
        const pid = it.variant?.productId
        if (!pid) continue
        const net = allocateLineNet(it.invoice as any)
        const amount = net.get(it.id) ?? 0
        itemNet.set(it.id, amount)
        itemProduct.set(it.id, { productId: pid, name: it.variant.product.name, qty: Number(it.qty || 0) })
      }
    }
    // B1 (بازبینی دوازدهم) — همان سقفِ تجمعی روی «سمتِ درآمد»یِ ABC: دو برگشتِ یک قلم
    // نباید مجموعاً بیشتر از خودِ ردیف ارزش کم کنند (مخرج این‌جا تعدادِ همان خط است، چون
    // ABC «ارزش خالص خط» را می‌سنجد نه سهمِ فروشگاه — همان چیزی که در یادداشتِ تب نوشته شده).
    const abcRowTaken = new Map<number, number>()
    for (const r of retItems) {
      const meta = itemProduct.get(r.saleItemId)
      const origNet = itemNet.get(r.saleItemId)
      if (!meta || origNet == null || !meta.qty) continue
      const lineUnits = Math.max(0, Math.round(Number(meta.qty) || 0))
      const leftLine = Math.max(0, lineUnits - (abcRowTaken.get(r.saleItemId) ?? 0))
      const takeLine = Math.max(0, Math.min(Math.round(Number(r.qty) || 0), leftLine))
      abcRowTaken.set(r.saleItemId, (abcRowTaken.get(r.saleItemId) ?? 0) + takeLine)
      const ratio = shopReturnRatio(takeLine, lineUnits)
      const cur = byProduct.get(meta.productId)
      if (!cur) continue
      cur.amount -= Math.round(origNet * ratio)
      cur.qty -= Number(r.qty)
    }
    const ranked = [...byProduct.values()].sort((a, b) => b.amount - a.amount)
    const total = ranked.reduce((s, r) => s + r.amount, 0)
    let cum = 0
    const rows = ranked.map((r) => {
      const before = total > 0 ? cum / total : 0
      cum += r.amount
      const share = total > 0 ? r.amount / total : 0
      const cls = before <= 0.8 ? 'A' : before <= 0.95 ? 'B' : 'C'
      return { ...r, share, cumulative: total > 0 ? cum / total : 0, cls }
    })
    let profitRows: any[] | undefined
    if (withCost && !engineBusy) {
      const itemIds = [...itemNet.keys()]
      const costs = await findByIds(prisma as any, 'saleItemCost', 'saleItemId', itemIds)
      const costByItem = new Map(costs.map((c: any) => [c.saleItemId, c]))
      const profitByProduct = new Map<number, { productId: number; name: string; realProfit: number }>()
      for (const [id, meta] of itemProduct) {
        if (!inWindowItems.has(id)) continue
        const c = costByItem.get(id)
        if (!c || c.costStatus === 'OUTSIDE' || c.costStatus === 'UNKNOWN') continue
        const profit = n(c.revenue) - n(c.fifoCost)
        const cur = profitByProduct.get(meta.productId) ?? { productId: meta.productId, name: meta.name, realProfit: 0 }
        cur.realProfit += profit
        profitByProduct.set(meta.productId, cur)
      }
      /**
       * B5/B2 — ABC سود همان قاعدهٔ تب سود را می‌خواند: درآمد فقط به اندازهٔ برگشتِ
       * STOREِ اثبات‌شده کم می‌شود؛ سهمِ WAREHOUSE بیرون می‌ماند و منشأ نامعلومِ خطِ
       * مختلط گزارش می‌شود. هزینه فقط به اندازهٔ چیزی که **واقعاً به لات برگشته** کم
       * می‌شود (ردیف `kind=RETURN` در دفتر). برگشتِ STOREِ معیوب درآمد را کم می‌کند،
       * اما فی‌اش در هزینه می‌ماند. تابع‌های مشترک `returnShare` هر دو قاعده را نگه
       * می‌دارند تا عدد ABC و تب سود از هم جدا نشود.
       */
      const abcBack = await restockedReturnShares(prisma as any, [...itemProduct.keys()])
      const abcBackQty = createRestockTaker(abcBack)
      const abcReturnSources = await storeReturnAttributions(
        prisma as any,
        retItems.map((r: any) => ({
          saleItemId: Number(r.saleItemId),
          returnId: Number(r.returnId),
          variantId: Number(r.variantId),
          qty: Number(r.qty),
          restockedQty: Number(r.restockedQty)
        }))
      )
      let ambiguousProfitReturns = 0
      let ambiguousProfitReturnQty = 0
      // B1 (بازبینی دوازدهم) — دو اختلافِ ABC با تب سود این‌جا بسته می‌شود: (1) مخرجِ نسبتِ برگشت
      // `meta.qty` بود = کلِ خط، درحالی‌که تب سود تعدادِ خودِ **ردیفِ فروشگاه** را مخرج می‌گذارد
      // (بازبینی یازدهم، B7) ⇒ در خطِ مختلطِ انبار مرکزی دو تب دو عدد می‌دادند؛ (2) `shopReturnRatio`
      // هر برگشت را جدا تا ۱ سقف می‌کند، پس دو برگشتِ یک قلم مجموعاً بیشتر از ردیف درآمد کم می‌کرد
      // (سقفِ تجمعیِ واحدها مثلِ تب سود).
      const abcRevTaken = new Map<number, number>()
      for (const r of retItems) {
        const meta = itemProduct.get(r.saleItemId)
        const orig = costByItem.get(r.saleItemId)
        if (!meta || !orig || !Number(orig.qty) || orig.costStatus === 'OUTSIDE' || orig.costStatus === 'UNKNOWN') continue
        const rowQty = Number(orig.qty) || Number(meta.qty) || 0
        const source = abcReturnSources.get(`${Number(r.saleItemId)}:${Number(r.returnId)}`) ?? {
          storeQty: Number(r.qty),
          ambiguousQty: 0
        }
        if (source.ambiguousQty > 0) {
          ambiguousProfitReturns += 1
          ambiguousProfitReturnQty += source.ambiguousQty
        }
        const leftRow = Math.max(0, Math.round(rowQty) - (abcRevTaken.get(r.saleItemId) ?? 0))
        const revTake = Math.max(0, Math.min(Math.round(Number(source.storeQty) || 0), leftRow))
        abcRevTaken.set(r.saleItemId, (abcRevTaken.get(r.saleItemId) ?? 0) + revTake)
        const ratio = shopReturnRatio(revTake, rowQty)
        const costWant = Math.min(source.storeQty, Math.max(0, Number(r.qty) || 0))
        const costRatio = shopReturnRatio(abcBackQty(r.saleItemId, r.returnId, costWant), rowQty)
        const cur = profitByProduct.get(meta.productId)
        if (!cur) continue
        cur.realProfit -= Math.round(n(orig.revenue) * ratio - n(orig.fifoCost) * costRatio)
      }
      const profitRanked = [...profitByProduct.values()].sort((a, b) => b.realProfit - a.realProfit)
      const profitTotal = profitRanked.reduce((s, r) => s + r.realProfit, 0)
      /**
       * «موارد کم‌اثر» بازبینی نهم — با جمع سودِ صفر یا منفی، تقسیم بر آن بی‌معنی است و
       * همه ردیف‌ها در طبقهٔ «A» می‌افتادند (رتبه‌بندیِ بی‌معنی ولی بدون علامت). خودِ
       * عددِ سود هر ردیف درست است؛ فقط طبقه‌بندی اعلام می‌شود که بی‌اعتبار است.
       */
      if (profitTotal <= 0) {
        noteExtra =
          'جمع سود واقعی این بازه صفر یا منفی است؛ درصدِ سهم از سود و طبقهٔ A/B/C معنایشان را از دست می‌دهند (همه در یک طبقه می‌افتند). ردیف‌های سود همان‌جا درست‌اند، فقط رتبه‌بندی را جدی نگیر.'
      }
      if (ambiguousProfitReturns > 0) {
        const ambiguousNote =
          `${ambiguousProfitReturns} برگشت (${ambiguousProfitReturnQty} عدد) منشأ STORE/انبار مرکزی در دادهٔ موجود قابل اثبات نیست؛ ` +
          'به سود فروشگاه تخصیص داده نشد تا سهم مالی حدس زده نشود.'
        noteExtra = noteExtra ? `${noteExtra} ${ambiguousNote}` : ambiguousNote
      }
      let pCum = 0
      profitRows = profitRanked.map((r) => {
        const before = profitTotal > 0 ? pCum / profitTotal : 0
        pCum += r.realProfit
        const cls = before <= 0.8 ? 'A' : before <= 0.95 ? 'B' : 'C'
        return { ...r, share: profitTotal > 0 ? r.realProfit / profitTotal : 0, cls }
      })
    }
    return {
      rows,
      ...(withCost && !engineBusy ? { profitRows } : {}),
      ...(engineBusy ? { profitBusy: true } : {}),
      total,
      fromJalali: from,
      toJalali: to,
      note:
        (engineBusy
          ? 'دفتر هزینه مشغول است؛ ABC سود واقعی فعلاً آماده نیست و عددِ قدیمی نمایش داده نمی‌شود. چند ثانیه بعد دوباره گزارش را باز کنید. ABC فروش همچنان آماده است.'
          : withCost
            ? 'ABC فروش روی ارزش خالص اقلام ۹۰ روز منهای برگشت. ABC سود واقعی از لات FIFO همان بازه است و همان قاعدهٔ تب سود را دارد: برگشتی که جنسش به قفسه برنگشته، هزینه‌اش سرِ جایش می‌ماند.'
            : 'ABC فروش روی ارزش خالص اقلام ۹۰ روز منهای برگشت. سود واقعی پشت قفل سود است.') +
        (noteExtra ? ' ' + noteExtra : '')
    }
  },

  async sizeCurve(filter: StockFilter = {}) {
    // «موارد کم‌اثر» بازبینی هشتم — منحنی سایز هیچ عدد فی نمی‌خواهد؛ قبلاً `stock()`
    // با پیش‌فرض `withCost` روشن صدا زده می‌شد (fail-open روی فیِ پشت قفل + کندی).
    const stock = await this.stock(filter, { withCost: false })
    const byProduct = new Map<
      number,
      { productId: number; name: string; sizes: Record<string, { stock: number; sold90: number }> }
    >()
    for (const r of stock.rows) {
      const cur = byProduct.get(r.productId) ?? { productId: r.productId, name: r.productName, sizes: {} }
      const s = cur.sizes[r.size] ?? { stock: 0, sold90: 0 }
      s.stock += r.stock
      s.sold90 += r.netSold90
      cur.sizes[r.size] = s
      byProduct.set(r.productId, cur)
    }
    /**
     * #12 (بازبینی هشتم) — «راهنمای سفارش سایز»: همان دو عددی که این تب دارد
     * (سهم فروش ۹۰روز و سهم مانده) کنار هم تفسیر می‌شوند. عدد تازه‌ای ساخته نمی‌شود؛
     * فقط فاصلهٔ دو سهم. آستانه‌ها عمداً ساده‌اند تا روی دادهٔ کم‌نمونه advice الکی
     * ندهد: سایزی که کمتر از ۲ عدد در ۹۰ روز فروخته قضاوت نمی‌شود.
     */
    const products = [...byProduct.values()].map((p) => {
      const entries = Object.entries(p.sizes)
      const totSold = entries.reduce((s2: number, [, v]: any) => s2 + Number(v.sold90 || 0), 0)
      const totStock = entries.reduce((s2: number, [, v]: any) => s2 + Number(v.stock || 0), 0)
      const sizes: Record<string, any> = {}
      for (const [sz, v] of entries as any[]) {
        const soldShare = totSold > 0 ? Number(v.sold90) / totSold : 0
        const stockShare = totStock > 0 ? Number(v.stock) / totStock : 0
        const gap = soldShare - stockShare
        let advice = ''
        if (Number(v.sold90) >= 2 && gap >= 0.12) advice = 'بیشتر بخر'
        else if (totSold >= 4 && Number(v.sold90) === 0 && Number(v.stock) > 0) advice = 'در ۹۰ روز فروش نرفت'
        else if (Number(v.stock) > 0 && gap <= -0.12) advice = 'کمتر بخر'
        sizes[sz] = {
          stock: Number(v.stock),
          sold90: Number(v.sold90),
          soldShare: Math.round(soldShare * 1000) / 10,
          stockShare: Math.round(stockShare * 1000) / 10,
          advice
        }
      }
      return { ...p, sizes, totalSold: totSold, totalStock: totStock }
    })
    return {
      products,
      note:
        'سهم هر سایز از مانده در مقابل فروش ۹۰ روز — برای سفارش بعدی. «بیشتر بخر» یعنی فروش این سایز از سهمش در قفسه جلوتر است (حداقل ۲ عدد در ۹۰ روز).'
    }
  },

  async purchaseVsSale(filter: { fromJalali?: string; toJalali?: string } = {}, reveal: CostReveal = {}) {
    const from = normalizeJalaliYmd(filter.fromJalali) || jalaliToday()
    const to = normalizeJalaliYmd(filter.toJalali) || jalaliToday()
    const withCost = reveal.withCost !== false
    const ran = withCost ? await costEngine.run() : null
    const engineBusy = !!(ran as any)?.busy
    const db = prisma as any
    const [purch, sale] = await Promise.all([
      prisma.purchaseInvoice.aggregate({
        where: { status: 'CONFIRMED', issuedAtJalali: { gte: from, lte: to } },
        _sum: { grandTotal: true },
        _count: { _all: true }
      }),
      salesService.reportRows({ fromJalali: from, toJalali: to, take: 1, withDrillDown: false })
    ])
    const purchaseTotal = n(purch._sum.grandTotal)
    const netSales = n(sale.accounting?.invoice?.netAccrualSales)
    let fifoSoldNet: number | undefined
    if (withCost && !engineBusy) {
      const invoices = await prisma.saleInvoice.findMany({
        where: saleWhere({ fromJalali: from, toJalali: to } as SaleReportFilter),
        select: { id: true }
      })
      const ids = invoices.map((inv) => inv.id)
      const costs = await findByIds(db, 'saleItemCost', 'invoiceId', ids)
      const costByItem = new Map(costs.map((c: any) => [c.saleItemId, c]))
      let fifoSold = 0
      for (const c of costs) {
        if (c.costStatus === 'OUTSIDE' || c.costStatus === 'UNKNOWN') continue
        fifoSold += n(c.fifoCost)
      }
      const returns = await prisma.saleReturnItem.findMany({
        // B10 — `costByItem` فقط فاکتورهای شمرده‌شده را دارد ولی fallbackِ زیر مستقیم
        // می‌خواند؛ برگشتِ فاکتورِ بی‌اعتبار بدون این گارد هزینهٔ فروشِ نا‌شمرده را کم می‌کرد.
        where: {
          return: { voidedAt: null, returnedAtJalali: { gte: from, lte: to } },
          saleItem: { invoice: { voidedAt: null, status: { notIn: REPORT_EXCLUDED_SALE_STATUSES } } }
        },
        select: { qty: true, saleItemId: true, returnId: true }
      })
      const retLineIds: number[] = [...new Set(returns.map((r: any) => Number(r.saleItemId)))]
      const retLines = retLineIds.length
        ? await findByIds(prisma as any, 'saleInvoiceItem', 'id', retLineIds, { select: { id: true, qty: true } })
        : []
      const retLineQty = new Map(retLines.map((x) => [x.id, Number(x.qty)]))
      // B2 (بازبینی هشتم) — مثل تب سود: فقط جنسی از هزینه کم می‌شود که واقعاً به
      // لات برگشته باشد (مصرف kind=RETURN در همان دفتر هزینه).
      const backShares = await restockedReturnShares(db, retLineIds)
      const backQty = createRestockTaker(backShares)
      let fifoReturned = 0
      for (const r of returns) {
        const orig = costByItem.get(r.saleItemId) || (await db.saleItemCost.findUnique({ where: { saleItemId: r.saleItemId } }))
        if (!orig || !Number(orig.qty) || orig.costStatus === 'OUTSIDE' || orig.costStatus === 'UNKNOWN') continue
        // B7 (بازبینی یازدهم) — `orig.fifoCost` سهمِ **فروشگاه** از خط است؛ تقسیم بر
        // «کل خط» یعنی یک‌سومِ ردیفِ سه‌عددی کم شود درحالی‌که دو‌سومِ واحدهایش برگشته.
        const rowQty: number = Number(orig.qty) || Number(retLineQty.get(r.saleItemId)) || 0
        const back = backQty(r.saleItemId, r.returnId, Number(r.qty))
        fifoReturned += Math.round(n(orig.fifoCost) * shopReturnRatio(back, rowQty))
      }
      fifoSoldNet = fifoSold - fifoReturned
    }
    /**
     * B11 (بازبینی نهم) — در نشست ۲۱۷ برای همین تب «centralOut» با `CENTRAL_WITHDRAW`
     * و `delta < 0` نوشتم؛ ادعای گزارش درست است که آن شاخه کد مرده است: در این برنامه
     * «انتقال از انبار مرکزی» فقط **ورود** به فروشگاه است (`SecondaryStockService` تنها
     * `inventoryService.increase` را صدا می‌زند و هیچ‌جا `decrease` با این دلیل نداریم)،
     * پس خروجِ ثبت‌شده به انبار مرکزی وجود ندارد که شمرده شود. عدد را حذف نمی‌کنم،
     * جهت را درست می‌کنم: همان حرکتِ مثبت، ورودِ **بدون فاکتور خرید** است و دقیقاً همین
     * چیزی است که «انباشت سرمایه = خرید منهای بهای فروخته‌شده» را کج می‌کند (جنس به
     * قفسه آمده ولی فاکتور خریدی در کار نبوده). عمداً فقط تعداد و حرکت گزارش می‌شود،
     * نه بها: ردیفِ مصرفی برای این ورودی‌ها نیست (ورود که مصرف نیست) و بهای لات‌های
     * `NO_INVOICE` قلم‌هایِ بی‌موجودی را هم با خودش مخلوط می‌کند — عددِ پولیِ ساختگی
     * روی کارت، بدتر از نبودِ عدد است.
     */
    const centralIn = await (async () => {
      const mv = await prisma.stockMovement.groupBy({
        by: ['variantId'],
        where: {
          delta: { gt: 0 },
          state: 'FINAL',
          reason: 'CENTRAL_WITHDRAW',
          createdAt: { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) }
        },
        _sum: { delta: true },
        _count: { _all: true }
      })
      const qty = mv.reduce((s: number, r: any) => s + Number(r._sum?.delta ?? 0), 0)
      const moves = mv.reduce((s: number, r: any) => s + Number(r._count?._all ?? 0), 0)
      return { moves, qty, variants: mv.length }
    })()
    return {
      fromJalali: from,
      toJalali: to,
      purchaseTotal,
      purchaseCount: purch._count._all,
      netAccrualSales: netSales,
      grossSales: n(sale.accounting?.invoice?.grossSales),
      ...(withCost
        ? {
            ...(engineBusy ? {} : { fifoSoldCost: fifoSoldNet, accumulation: purchaseTotal - (fifoSoldNet ?? 0) }),
            centralIn
          }
        : {}),
      label: withCost
        ? engineBusy
          ? 'دفتر هزینه مشغول است؛ بهای FIFO قدیمی نمایش داده نمی‌شود. چند ثانیه بعد گزارش را دوباره باز کنید. خرید و فروش خالص همچنان آماده‌اند.'
          : 'انباشت سرمایه در کالا = خرید تأییدشده منهای بهای تمام‌شدهٔ FIFO فروخته‌شده (خالصِ برگشتِ واقعاً بازگشته به قفسه). ' +
            (centralIn.moves
              ? `در همین بازه ${centralIn.moves.toLocaleString('fa-IR')} حرکت «انتقال از انبار مرکزی» داشته‌ایم (${centralIn.qty.toLocaleString('fa-IR')} عدد روی ${centralIn.variants.toLocaleString('fa-IR')} کالا) که فاکتور خرید ندارند؛ پس «انباشت» می‌تواند کمتر از واقعیت (یا منفی) باشد، چون این جنس‌ها بدون فاکتور به قفسه آمده‌اند. `
              : '') +
            'فروش خالص تعهدی از گزارش فروش جدا کنارش است؛ این عدد سود نیست.'
        : 'خرید تأییدشده در برابر فروش خالص تعهدی (از گزارش فروش). بهای تمام‌شده پشت قفل سود است.',
      warnings: [
        ...(sale.warnings ?? []),
        ...(engineBusy ? ['دفتر هزینه مشغول بود؛ بهای تمام‌شده ممکن است ناقص باشد.'] : [])
      ]
    }
  }
}
