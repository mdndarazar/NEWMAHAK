/**
 * سود گزارش مدیریت — دو نگاه کنار هم برای تورم ایران.
 * درآمد هر قلم از allocateLineNet (همان ارزش برگشت) است.
 * فروش خالص تعهدی از reportRows فقط کنارش نمایش داده می‌شود، دوباره حساب نمی‌شود.
 */
import { prisma } from '../../db/client'
import { saleWhere, salesService, channelOrderTypeFilter, REPORT_EXCLUDED_SALE_STATUSES } from '../SalesService'
import { costEngine } from './CostEngine'
import { lastPurchaseUnit } from './replacement'
import { toNumberRial } from '@shared/money'
import { jalaliToday, jalaliStartOfDay, jalaliEndOfDay } from '@shared/jalali'
import { normalizeJalaliYmd } from '@shared/jalaliBuckets'
import { categoryWithDescendants } from './categoryTree'
import {
  shopReturnRatio,
  restockedReturnShares,
  createRestockTaker,
  storeReturnAttributions
} from './returnShare'
import { findByIds } from './inChunk'
import type { SaleReportFilter } from '@shared/types'

const db = prisma as any

/**
 * B6 (بازبینی هشتم) — «ي/ی»، «ك/ک»، نیم‌فاصله و فاصلهٔ دوبل در نام تامین‌کننده.
 * طبق توافق به `PartyService` دست نمی‌زنیم و هیچ رکوردی را ادغام نمی‌کنیم؛ این‌جا
 * فقط *گروه‌بندی نمایشی* سود نرمال می‌شود تا سود یک تامین‌کننده بین دو ردیف
 * نپرد، و تعداد رکوردهای ادغام‌شده روی همان ردیف نوشته می‌شود تا مغایرت فهرست
 * پنهان نماند (ادغامِ داده کارِ خودِ فهرست تامین‌کننده‌هاست، نه گزارش).
 */
function normPartyName(raw: string): string {
  return String(raw || '')
    .replace(/\u200c/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
}

function n(v: unknown): number {
  return toNumberRial((v as any) ?? 0)
}

export const profitService = {
  async profit(
    filter: {
      fromJalali?: string
      toJalali?: string
      userId?: number | null
      channels?: string[] | null
      categoryId?: number | null
    } = {}
  ) {
    const ran = await costEngine.run()
    const from = normalizeJalaliYmd(filter.fromJalali) || jalaliToday()
    const to = normalizeJalaliYmd(filter.toJalali) || jalaliToday()
    if ((ran as any)?.busy) {
      return {
        fromJalali: from,
        toJalali: to,
        busy: true,
        revenue: 0,
        fifoCost: 0,
        replacementCost: 0,
        realProfit: 0,
        replacementProfit: 0,
        inflationOnSold: 0,
        realMargin: 0,
        replacementMargin: 0,
        qty: 0,
        belowReplacement: 0,
        belowLines: [],
        exactPct: 1,
        exactCount: 0,
        approxCount: 0,
        excludedFromPct: 0,
        health: { ok: true, mismatches: [], mismatchCount: 0 },
        missingCostRows: 0,
        returnCostKept: 0,
        nonRestockedReturns: 0,
        totalReturnedQty: 0,
        ambiguousReturns: 0,
        ambiguousReturnQty: 0,
        losses: null,
        missingPurchaseRows: [],
        returnRevenue: 0,
        byCategory: [],
        bySupplier: [],
        months: [],
        stock: { qty: 0, fifoValue: 0, replacementValue: 0, paperWealth: 0 },
        netAccrualSales: 0,
        engine: ran,
        lines: [],
        notes: ['دفتر هزینه مشغول است. چند ثانیه بعد دوباره باز کنید — عدد سود الان ناقص نیست، هنوز آماده نیست.'],
        warnings: []
      }
    }
    const catId = filter.categoryId != null && Number(filter.categoryId) > 0 ? Number(filter.categoryId) : null
    const catIds = catId ? await categoryWithDescendants(catId) : null
    const f: SaleReportFilter = { fromJalali: from, toJalali: to, take: 1, withDrillDown: false }
    if (filter.userId) f.userId = filter.userId
    if (filter.channels !== undefined) f.channels = filter.channels

    const where = saleWhere(f)
    const invoices = await prisma.saleInvoice.findMany({
      where,
      select: {
        id: true,
        issuedAtJalali: true,
        items: {
          select: {
            id: true,
            variant: { select: { product: { select: { categoryId: true, category: { select: { id: true, name: true } } } } } }
          }
        }
      }
    })
    const itemIds = invoices.flatMap((inv) =>
      inv.items
        .filter((it) => !catIds || catIds.includes(it.variant?.product?.categoryId ?? -1))
        .map((it) => it.id)
    )
    const invoiceMonth = new Map(invoices.map((inv) => [inv.id, String(inv.issuedAtJalali || '').slice(0, 7)]))
    const itemCat = new Map<number, { key: string; name: string }>()
    for (const inv of invoices) {
      for (const it of inv.items) {
        const id = it.variant?.product?.category?.id
        const name = it.variant?.product?.category?.name || 'بدون دسته'
        itemCat.set(it.id, { key: id != null ? `id:${id}` : `name:${name}`, name })
      }
    }

    // B5 (بازبینی دوازدهم) — تکه‌تکه؛ قبلاً روی پنجرهٔ پرفروشِ یک شعبه خودِ پرس‌وجو خطا می‌داد.
    const costsRaw = await findByIds(db, 'saleItemCost', 'saleItemId', itemIds)
    const outsideCount = costsRaw.filter((c: any) => c.costStatus === 'OUTSIDE').length
    const zeroCostCount = costsRaw.filter((c: any) => c.costStatus === 'UNKNOWN').length
    const costs = costsRaw.filter((c: any) => c.costStatus !== 'OUTSIDE' && c.costStatus !== 'UNKNOWN')
    const allocRows = itemIds.length
      ? await findByIds(db, 'saleItemStockAllocation', 'saleItemId', itemIds, {
          select: { saleItemId: true, sourceKind: true, qty: true }
        }).catch(() => [])
      : []
    const warehouseShareCount = new Set(
      allocRows.filter((a: any) => String(a.sourceKind) === 'WAREHOUSE' && Number(a.qty) > 0).map((a: any) => a.saleItemId)
    ).size
    const costByItem = new Map(costs.map((c: any) => [c.saleItemId, c]))

    /**
     * B8 (بازبینی هشتم) — `costByItem` فقط قلم‌های دارای فیِ معتبر را دارد، پس
     * قلم‌های OUTSIDE/UNKNOWN که **ردیف هزینه‌شان هست** «هنوز فی قفل نشده» شمرده
     * می‌شدند و پیامی می‌دادند که هیچ‌وقت درست نمی‌شود. شمارش از ردیف‌های خام است.
     */
    const anyCostItem = new Set(costsRaw.map((c: any) => Number(c.saleItemId)))
    const missing = itemIds.filter((id) => !anyCostItem.has(id)).length

    const byMonth = new Map<
      string,
      { month: string; revenue: number; fifoCost: number; replacementCost: number; qty: number; exact: number; approx: number }
    >()
    const bump = (month: string, row: { revenue: number; fifo: number; repl: number; qty: number; status: string }) => {
      const cur = byMonth.get(month) ?? {
        month,
        revenue: 0,
        fifoCost: 0,
        replacementCost: 0,
        qty: 0,
        exact: 0,
        approx: 0
      }
      cur.revenue += row.revenue
      cur.fifoCost += row.fifo
      cur.replacementCost += row.repl
      cur.qty += row.qty
      if (row.status === 'EXACT') cur.exact += 1
      else cur.approx += 1
      byMonth.set(month, cur)
    }

    const byCat = new Map<string, { name: string; revenue: number; fifoCost: number; replacementCost: number }>()
    const bumpCat = (key: string, name: string, rev: number, fifo: number, repl: number) => {
      const cur = byCat.get(key) ?? { name, revenue: 0, fifoCost: 0, replacementCost: 0 }
      cur.revenue += rev
      cur.fifoCost += fifo
      cur.replacementCost += repl
      byCat.set(key, cur)
    }

    let revenue = 0
    let fifoCost = 0
    let replacementCost = 0
    let qty = 0
    let belowReplacement = 0
    let revExact = 0
    const lines: any[] = []
    for (const c of costs) {
      const rev = n(c.revenue)
      if (c.costStatus === 'EXACT') revExact += rev
      const fifo = n(c.fifoCost)
      const repl = n(c.replacementCost)
      revenue += rev
      fifoCost += fifo
      replacementCost += repl
      qty += Number(c.qty)
      if (rev < repl) belowReplacement += 1
      const month = invoiceMonth.get(c.invoiceId) || '—'
      bump(month, { revenue: rev, fifo, repl, qty: Number(c.qty), status: String(c.costStatus) })
      const cat = itemCat.get(c.saleItemId) || { key: 'name:بدون دسته', name: 'بدون دسته' }
      bumpCat(cat.key, cat.name, rev, fifo, repl)
      lines.push({
        saleItemId: c.saleItemId,
        invoiceId: c.invoiceId,
        variantId: c.variantId,
        qty: Number(c.qty),
        revenue: rev,
        fifoCost: fifo,
        replacementCost: repl,
        realProfit: rev - fifo,
        replacementProfit: rev - repl,
        inflationGap: repl - fifo,
        costStatus: c.costStatus,
        belowReplacement: rev < repl
      })
    }

    const channelOt = channelOrderTypeFilter(filter.channels)
    const returns = await prisma.saleReturnItem.findMany({
      where: {
        return: { voidedAt: null, returnedAtJalali: { gte: from, lte: to } },
        saleItem: {
          invoice: {
            /**
             * B10 (بازبینی یازدهم) — اگر کلِ فاکتور فروش بی‌اعتبار شده باشد، فروش از
             * درآمد رفته ولی برگشتش هنوز این‌جا می‌آمد و «سود» را یک بار دیگر کم می‌کرد
             * (تب دسته‌بندی این گارد را داشت؛ این‌جا نداشت).
             */
            voidedAt: null,
            // همان تعریفِ «فروشِ شمرده‌شده» از همان‌جا — لغوشده/پیش‌نویس هم مثل بی‌اعتبار.
            status: { notIn: REPORT_EXCLUDED_SALE_STATUSES },
            ...(filter.userId ? { userId: Number(filter.userId) } : {}),
            ...(channelOt ? { orderType: channelOt } : {})
          },
          ...(catIds ? { variant: { product: { categoryId: { in: catIds } } } } : {})
        }
      },
      orderBy: { id: 'asc' },
      select: {
        qty: true,
        restockedQty: true,
        saleItemId: true,
        returnId: true,
        variantId: true,
        return: { select: { returnedAtJalali: true } }
      }
    })
    const missingCat = [...new Set(returns.map((r) => r.saleItemId).filter((id) => !itemCat.has(id)))]
    if (missingCat.length) {
      const extra = await findByIds(prisma as any, 'saleInvoiceItem', 'id', missingCat, {
        select: {
          id: true,
          variant: { select: { product: { select: { category: { select: { id: true, name: true } } } } } }
        }
      })
      for (const it of extra) {
        const id = it.variant?.product?.category?.id
        const name = it.variant?.product?.category?.name || 'بدون دسته'
        itemCat.set(it.id, { key: id != null ? `id:${id}` : `name:${name}`, name })
      }
    }
    let returnRevenue = 0
    let returnFifo = 0
    let returnRepl = 0
    /**
     * B2 — برگشتِ STOREِ اثبات‌شده درآمد فروشگاه را کم می‌کند؛ هزینه فقط به اندازهٔ
     * چیزی کم می‌شود که دفتر FIFO واقعاً به لات برگردانده است. برگشتِ WAREHOUSE بیرونِ
     * سود فروشگاه می‌ماند. در خطِ مختلط، حرکتِ برگشت سهمِ restock‌شدهٔ STORE را ثابت
     * می‌کند؛ بخشِ غیر-restock‌شده که منشأش معلوم نیست نه حدس زده می‌شود و نه به P&L
     * تخصیص می‌یابد، بلکه در یادداشت گزارش می‌شود. برای دادهٔ قدیمیِ بی‌دفتر، قرارداد
     * همان قبلی است: نبودِ allocation یعنی خط از STORE بوده است.
     */
    const returnItemIds: number[] = [...new Set(returns.map((r: any) => Number(r.saleItemId)))]
    const lineQtyRows = returnItemIds.length
      ? await findByIds(prisma as any, 'saleInvoiceItem', 'id', returnItemIds, { select: { id: true, qty: true } })
      : []
    const lineQtyOf = new Map(lineQtyRows.map((x) => [x.id, Number(x.qty)]))
    // نشانهٔ بازگشت جنس به لات از دفتر هزینه — در `returnShare` تا ABC/خرید‌وفروش هم
    // همان قاعده را بخوانند (B5 — بازبینی نهم).
    const restockShares = await restockedReturnShares(db, returnItemIds)
    const returnSources = await storeReturnAttributions(
      db,
      returns.map((r: any) => ({
        saleItemId: Number(r.saleItemId),
        returnId: Number(r.returnId),
        variantId: Number(r.variantId),
        qty: Number(r.qty),
        restockedQty: Number(r.restockedQty)
      }))
    )
    let returnCostKept = 0
    let returnQty = 0
    let ambiguousReturns = 0
    let ambiguousReturnQty = 0
    const totalReturnedQty = returns.reduce((sum: number, r: any) => sum + Math.max(0, Number(r.qty) || 0), 0)
    let nonRestockedReturns = 0
    // B1 (بازبینی دهم) — استخرِ «برگشته به لات» مصرف‌شدنی است و به‌ازای **هر برگشت** جدا
    // خوانده می‌شود؛ دو برگشتِ یک قلم نمی‌توانند هر دو از یک عددِ برگشته سهم بگیرند (ضرر
    // جنسِ ایرادی بی‌صدا از سود پاک می‌شد). هر حلقه استخرِ خودش را دارد تا یک عدد دو بار
    // کم نشود، وگرنه سهمِ تامین‌کننده با عددِ سرجمع نمی‌خواند.
    const costBackQty = createRestockTaker(restockShares)
    /**
     * B1 (بازبینی دوازدهم) — `shopReturnRatio` هر برگشت را **جدا** تا ۱ سقف می‌کند، پس دو
     * برگشتِ ۲عددی روی ردیفِ ۳عددی ۲/۳ + ۲/۳ = ۱٫۳۳ از درآمد کم می‌کنند: ردیفِ سود منفی
     * می‌شود، تعداد صفر، و چون سمتِ هزینه استخرِ مصرف‌شدنی دارد و کم‌تر می‌آورد، «برگشت
     * ایرادی» هم دروغ اعلام می‌شد — همان کالای درست‌فروش در «کالای پربازگشتِ ایرادی» می‌نشست
     * که سرِ خریدش تصمیم گرفته می‌شود. سمتِ درآمد هم حالا استخرِ واحدهای همان قلم را می‌خواند:
     * هر برگشت فقط واحدهایی را می‌خورد که تا الان برگشت نخورده‌اند. جمعِ سقف‌خورده دقیقاً همان
     * «مجموعِ برگشت ÷ ردیف با سقف ۱» است که تب ABC می‌سازد ⇒ دو تب یک عدد می‌دهند، و برای
     * تک‌برگشتِ معمولی (تقریباً کل دادهٔ واقعی) هیچ عددی تکان نمی‌خورد.
     */
    const revTaken = new Map<number, number>()
    const revUnits = (pool: Map<number, number>, saleItemId: number, rowQty: number, qty: number): number => {
      const row = Math.max(0, Math.round(Number(rowQty) || 0))
      const left = Math.max(0, row - (pool.get(saleItemId) ?? 0))
      const take = Math.max(0, Math.min(Math.round(Number(qty) || 0), left))
      pool.set(saleItemId, (pool.get(saleItemId) ?? 0) + take)
      return take
    }
    /** B10 — درآمد و فیِ جایگزینیِ همان قلم **پس از** برگشت (برای هشدار «زیرِ فیِ جایگزینی»). */
    const netLeft = new Map<number, { rev: number; repl: number }>()

    for (const r of returns) {
      const orig = costByItem.get(r.saleItemId) || (await db.saleItemCost.findUnique({ where: { saleItemId: r.saleItemId } }))
      if (!orig || !Number(orig.qty) || orig.costStatus === 'OUTSIDE' || orig.costStatus === 'UNKNOWN') continue
      /**
       * B7 (بازبینی یازدهم) — `orig` فقط سهمِ **فروشگاه** از خط است (مثلاً ۳ عدد از
       * خطِ ۵ عددها؛ ۲ تای دیگر از انبار مرکزی رفته) ولی نسبتِ برگشت بر «کل خط»
       * تقسیم می‌شد: برگشتِ ۲ عدد ⇒ ۴۰٪ کسر از ردیفی که فقط ۳ عدد دارد، درحالی‌که
       * آن ۲ عدد دو سومِ همان ردیف‌اند. نتیجه: درآمد و هزینه کمتر از واقع کم می‌شد و
       * واحدهای برگشتی دوباره شمرده می‌ماندند. مخرج باید تعدادِ خودِ ردیف باشد؛ در
       * خطِ تک‌منبعی که ردیف = کل خط است، پس برای دادهٔ معمولی هیچ عددی تکان نمی‌خورد.
       */
      const lineQty: number = Number(orig.qty) || Number(lineQtyOf.get(r.saleItemId)) || 0
      const source = returnSources.get(`${Number(r.saleItemId)}:${Number(r.returnId)}`) ?? {
        storeQty: Number(r.qty),
        ambiguousQty: 0
      }
      if (source.ambiguousQty > 0) {
        ambiguousReturns += 1
        ambiguousReturnQty += source.ambiguousQty
      }
      const revTake = revUnits(revTaken, r.saleItemId, lineQty, source.storeQty)
      const ratio = shopReturnRatio(revTake, lineQty)
      // هزینه فقط برای واحدی کم می‌شود که هم منشأ فروشگاهی‌اش معلوم است و هم
      // دفتر FIFO بازگشت همان برگشت را ثبت کرده؛ سهم مرکزی/مبهم وارد این کسر نمی‌شود.
      const costWant = Math.min(source.storeQty, Math.max(0, Number(r.qty) || 0))
      const costRatio = shopReturnRatio(costBackQty(r.saleItemId, r.returnId, costWant), lineQty)
      const rr = Math.round(n(orig.revenue) * ratio)
      const rf = Math.round(n(orig.fifoCost) * costRatio)
      const rp = Math.round(n(orig.replacementCost) * costRatio)
      const leftBefore = netLeft.get(r.saleItemId) ?? { rev: n(orig.revenue), repl: n(orig.replacementCost) }
      netLeft.set(r.saleItemId, { rev: leftBefore.rev - rr, repl: leftBefore.repl - rp })
      if (costRatio < ratio) {
        nonRestockedReturns += 1
        returnCostKept += Math.round(n(orig.fifoCost) * ratio) - rf
      }
      returnRevenue += rr
      returnFifo += rf
      returnRepl += rp
      // تعدادِ خالصِ این گزارش فقط واحدهای STOREِ اثبات‌شده را کم می‌کند؛ تعدادِ
      // برگشتِ STORE عمداً خام می‌ماند (حتی اگر از تعداد ردیف بیشتر باشد)، چون فقط پول
      // سقف تجمعی دارد. تعداد خامِ کل سندها در `totalReturnedQty` و ابهامِ خطِ مختلط
      // جداگانه در `ambiguousReturnQty` می‌ماند؛ این سه را بی‌صدا یکی نمی‌کنیم.
      returnQty += source.storeQty
      const month = String(r.return?.returnedAtJalali || '').slice(0, 7) || '—'
      bump(month, { revenue: -rr, fifo: -rf, repl: -rp, qty: -source.storeQty, status: String(orig.costStatus) })
      const cat = itemCat.get(r.saleItemId) || { key: 'name:بدون دسته', name: 'بدون دسته' }
      bumpCat(cat.key, cat.name, -rr, -rf, -rp)
    }
    returnRevenue = Math.round(returnRevenue)
    returnFifo = Math.round(returnFifo)
    returnRepl = Math.round(returnRepl)

    const unnamed = 'فاقد نام تامین‌کننده'
    const bySup = new Map<
      string,
      {
        name: string
        code: string | null
        codes: Set<string>
        revenue: number
        fifoCost: number
        replacementCost: number
        ids: Set<number>
      }
    >()
    const bumpSup = (
      key: string,
      name: string,
      code: string | null,
      rev: number,
      fifo: number,
      repl: number,
      partyId?: number | null
    ) => {
      const cur =
        bySup.get(key) ??
        { name, code, codes: new Set<string>(), revenue: 0, fifoCost: 0, replacementCost: 0, ids: new Set<number>() }
      cur.revenue += rev
      cur.fifoCost += fifo
      cur.replacementCost += repl
      if (code) cur.codes.add(String(code))
      if (partyId != null) cur.ids.add(Number(partyId))
      bySup.set(key, cur)
    }
    const allCostIds = [
      ...itemIds,
      ...returns.map((r) => r.saleItemId)
    ]
    const uniqIds = [...new Set(allCostIds)]
    const cons =
      uniqIds.length
        ? await findByIds(db, 'costConsumption', 'saleItemId', uniqIds, { where: { kind: 'SALE' } })
        : []
    const lotIds = [...new Set(cons.map((c: any) => c.lotId))]
    const lotRows = await findByIds(db, 'purchaseLot', 'id', lotIds)
    const lotById = new Map(lotRows.map((l: any) => [l.id, l]))
    const purchIds = [...new Set(lotRows.map((l: any) => l.purchaseInvoiceId).filter((id: any) => id != null))]
    const purch =
      purchIds.length
        ? await findByIds(prisma as any, 'purchaseInvoice', 'id', purchIds, {
            select: { id: true, supplierId: true, supplier: { select: { name: true, code: true } } }
          })
        : []
    const purchById = new Map(purch.map((p) => [p.id, p]))
    /**
     * B6 — گروه‌بندی یک‌باره‌ی مصرف‌ها به‌ازای قلم. قبلاً `sharesOf` برای هر قلم کل
     * آرایه‌ی مصرف را فیلتر می‌کرد (n×m) و همین باعث می‌شد تب سود روی دیتابیس
     * پرفروش چند ثانیه پروسه‌ی main را قفل کند. خروجی (ترتیب ردیف‌ها و سهم‌ها)
     * همان است؛ فقط یک‌بار خوانده می‌شود.
     */
    const consByItem = new Map<number, any[]>()
    for (const c of cons as any[]) {
      const key = Number(c.saleItemId)
      if (!key) continue
      const list = consByItem.get(key)
      if (list) list.push(c)
      else consByItem.set(key, [c])
    }
    const sharesOf = (saleItemId: number) => {
      const rows = consByItem.get(Number(saleItemId)) ?? []
      const total = rows.reduce((s: number, c: any) => s + Number(c.qty), 0)
      if (!total) return [{ key: 'no-invoice', name: 'بدون فاکتور خرید', code: null as string | null, share: 1 }]
      return rows.map((c: any) => {
        const lot = lotById.get(c.lotId)
        const inv = lot?.purchaseInvoiceId ? purchById.get(lot.purchaseInvoiceId) : null
        if (!lot?.purchaseInvoiceId) {
          return { key: 'no-invoice', name: 'بدون فاکتور خرید', code: null as string | null, share: Number(c.qty) / total }
        }
        const rawName = inv?.supplier?.name?.trim() || ''
        const name = rawName || unnamed
        const code = inv?.supplier?.code ?? null
        /**
         * B4 (بازبینی دهم) — کلیدِ «اول کد» عملاً هیچ‌وقت به نام نمی‌رسید: `Supplier.code`
         * در اسکیما اجباری و یکتا است، پس «علي رضايي» و «علی رضایی» دو ردیف می‌ماندند و
         * `partyCount` همیشه ۱ (هشدار «(۲ رکورد)» هرگز نمی‌آمد). حالا گروه‌بندیِ
         * **نمایشیِ همین گزارش** با نامِ نرمال‌شده است (نیم‌فاصله، ي/ی، ک/ك، فاصلهٔ دوبل)
         * و کدها در ستونِ کد فهرست می‌شوند. ادغامِ رکورد در `PartyService` انجام نشد —
         * همان‌جا تصمیمِ مالک است؛ این‌جا فقط سودِ یک نفر دو تکه نمی‌شود و اگر دو
         * تامین‌کنندهٔ واقعاً متفاوت یک نام داشته باشند، ردیف «(n رکورد)» همان را فریاد
         * می‌زند، پس چیزی پنهان نمی‌شود.
         */
        const key = rawName ? `name:${normPartyName(rawName)}` : 'none'
        return { key, name, code, share: Number(c.qty) / total, partyId: inv?.supplierId ?? null }
      })
    }
    for (const c of costs) {
      const rev = n(c.revenue)
      const fifo = n(c.fifoCost)
      const repl = n(c.replacementCost)
      for (const sh of sharesOf(c.saleItemId)) {
        bumpSup(
          sh.key,
          sh.name,
          sh.code,
          rev * sh.share,
          fifo * sh.share,
          repl * sh.share,
          sh.partyId
        )
      }
    }
    const costBackQtySup = createRestockTaker(restockShares)
    // B1 — استخرِ دوم برای همین حلقه (مثل `costBackQtySup`): وگرنه واحد دو بار کم می‌شد.
    const revTakenSup = new Map<number, number>()
    for (const r of returns) {
      const orig =
        costByItem.get(r.saleItemId) || (await db.saleItemCost.findUnique({ where: { saleItemId: r.saleItemId } }))
      if (!orig || !Number(orig.qty) || orig.costStatus === 'OUTSIDE' || orig.costStatus === 'UNKNOWN') continue
      // B7 — مخرجِ نسبتِ برگشت، تعدادِ خودِ ردیف است (سهمِ فروشگاه) نه کل خط.
      const lineQty: number = Number(orig.qty) || Number(lineQtyOf.get(r.saleItemId)) || 0
      const source = returnSources.get(`${Number(r.saleItemId)}:${Number(r.returnId)}`) ?? {
        storeQty: Number(r.qty),
        ambiguousQty: 0
      }
      const ratio = shopReturnRatio(revUnits(revTakenSup, r.saleItemId, lineQty, source.storeQty), lineQty)
      const costWant = Math.min(source.storeQty, Math.max(0, Number(r.qty) || 0))
      const costRatio = shopReturnRatio(costBackQtySup(r.saleItemId, r.returnId, costWant), lineQty)
      const rr = Math.round(n(orig.revenue) * ratio)
      const rf = Math.round(n(orig.fifoCost) * costRatio)
      const rp = Math.round(n(orig.replacementCost) * costRatio)
      for (const sh of sharesOf(r.saleItemId)) {
        // «خطای پراکندگیِ ته‌گرد» (یادداشتِ بازبینی دوازدهم) — سهمِ برگشت هم مثلِ سهمِ فروش به‌صورت
        // اعشاری جمع می‌شود و ته‌گرد فقط یک‌بار در خروجیِ سرجمعِ هر تامین‌کننده می‌خورد.
        bumpSup(sh.key, sh.name, sh.code, -rr * sh.share, -rf * sh.share, -rp * sh.share, sh.partyId)
      }
    }

    const netRevenue = revenue - returnRevenue
    const netFifo = fifoCost - returnFifo
    const netRepl = replacementCost - returnRepl
    const realProfit = netRevenue - netFifo
    const replacementProfit = netRevenue - netRepl
    const inflationOnSold = netRepl - netFifo

    const lots = await db.purchaseLot.findMany({ where: { qtyLeft: { gt: 0 } } })
    let stockFifo = 0
    let stockQty = 0
    const byVar = new Map<number, number>()
    for (const lot of lots) {
      stockQty += Number(lot.qtyLeft)
      stockFifo += n(lot.unitCost) * Number(lot.qtyLeft)
      byVar.set(lot.variantId, (byVar.get(lot.variantId) ?? 0) + Number(lot.qtyLeft))
    }
    let stockReplacement = 0
    for (const [variantId, q] of byVar) {
      const { unit } = await lastPurchaseUnit(variantId)
      stockReplacement += n(unit) * q
    }
    const paperWealth = stockReplacement - stockFifo
    const exactN = costs.filter((c: any) => c.costStatus === 'EXACT').length
    const approxN = costs.length - exactN
    const exactPct = costs.length ? exactN / costs.length : 1
    /**
     * نقطهٔ ضعف #2 (بازبینی یازدهم) — «۹۰٪ قلم‌ها دقیق» با «۹۰٪ پول دقیق» یکی نیست:
     * یک قلمِ بی‌فیِ گران‌قیمت می‌تواند درصدِ قلم‌ها را تکان ندهد ولی نصفِ سود را
     * نامطمئن کند. عددِ قدیمی دست‌نخورده ماند (تاریخچه‌اش در صفحه‌های دیگر هست) و این
     * نسخهٔ ریالی کنارش می‌آید تا صفحه بتواند صادق‌ترینشان را نشان دهد.
     */
    const exactPctRial = revenue > 0 ? revExact / revenue : exactPct
    /**
     * B11 — مخرج `exactPct` فقط قلم‌های دارای فی است؛ قلم‌های `UNKNOWN` (فی صفر) و
     * قلم‌هایی که از انبار فروشگاه کسر نشده (`OUTSIDE`) شمارش نمی‌شوند، پس درصد
     * خوش‌بینانه است. عدد درصد عمداً عوض نشده (تاریخچهٔ همین عدد در صفحه‌های دیگر)،
     * ولی تعداد کنارش نوشته می‌شود تا «۱۰۰٪» گمراه‌کننده نباشد.
     */
    const excludedFromPct = outsideCount + zeroCostCount
    const health = await costEngine.health()
    /**
     * B10 (بازبینی دوازدهم) — «فروشِ زیرِ فیِ جایگزینی» روی ردیفِ **ناخالص** شمرده می‌شد:
     * قلمی که کل فروشش برگشته و هیچ پولی ردّو‌بدل نشده، به‌عنوان «زیر فی» هشدار می‌داد و
     * لیستِ ۵۰تاییِ ردیف‌ها را هم پر می‌کرد. حالا همان ردیف با درآمد و فیِ **پس از برگشت**
     * سنجیده می‌شود؛ ردیفی که برگشتش کامل است از شمارش بیرون می‌ماند و ردیفِ نیمه‌برگشت با
     * نسبتِ خودش می‌ماند (هزینه‌ای که جنسش به قفسه برنگشته سرِ جایش است — مثلِ خودِ سود).
     */
    for (const l of lines) {
      const left = netLeft.get(l.saleItemId)
      if (!left) continue
      const nowBelow = left.rev < left.repl
      if (nowBelow !== !!l.belowReplacement) {
        l.belowReplacement = nowBelow
        belowReplacement += nowBelow ? 1 : -1
      }
    }

    const belowLines = lines.filter((l) => l.belowReplacement).slice(0, 50)
    if (belowLines.length) {
      const ids = belowLines.map((l) => l.saleItemId)
      const named = await prisma.saleInvoiceItem.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          invoice: { select: { receiptNo: true } },
          variant: { select: { size: true, code: true, product: { select: { name: true } } } }
        }
      })
      const nm = new Map(named.map((x) => [x.id, x]))
      for (const l of belowLines) {
        const x = nm.get(l.saleItemId)
        l.productName = x?.variant?.product?.name ?? 'کالا'
        l.size = x?.variant?.size ?? '—'
        l.code = x?.variant?.code ?? ''
        l.receiptNo = x?.invoice?.receiptNo ?? null
      }
    }

    const approxLots = await db.purchaseLot.findMany({
      where: { OR: [{ source: 'NO_INVOICE' }, { approx: true }], qtyLeft: { gt: 0 } },
      select: { variantId: true, qtyLeft: true }
    })
    const missingPurchaseIds = [...new Set(approxLots.map((l: any) => l.variantId))]
    const missingPurchase = missingPurchaseIds.length
      ? await findByIds(prisma as any, 'productVariant', 'id', missingPurchaseIds, {
          select: { id: true, size: true, code: true, product: { select: { name: true } } }
        })
      : []
    const missingPurchaseRows = missingPurchase.map((v) => ({
      variantId: v.id,
      productName: v.product?.name ?? 'کالا',
      size: v.size || '—',
      code: v.code
    }))

    /**
     * #11 (بازبینی هشتم) — «کسری و ضایعات» کنار سود، نه داخل آن.
     * خروج‌های انبار که فروش نیستند از خودِ دفتر هزینه خوانده می‌شوند (مصرف لاتِ
     * همان حرکت)؛ هیچ فی تازه‌ای ساخته نمی‌شود. `CENTRAL_WITHDRAW` عمداً جدا شمرده
     * می‌شود: انتقال جنس به انبار مرکزی دزدی یا ضایعات نیست و نباید در یک کارت با
     * «کسری» قاطی شود — وگرنه عددِ ترسناکِ بی‌دلیل می‌سازیم.
     */
    const losses = await (async () => {
      /**
       * B6 (بازبینی نهم) — کارت قبلاً ناخالص بود: «۱۰ عدد را اشتباه + کردی و بعد ۱۰−
       * کردی تا درست شود» به‌صورت «۱۰ عدد کسری با بهای X» دیده می‌شد و آدم به دزدی
       * شک می‌کند. پس اصلاح‌های **مثبتِ همان بازه** هم خوانده می‌شود و کنار کسری
       * می‌نشیند (خالص = کسری − اصلاح). عمداً برای سمتِ مثبت فی/بها ساخته نمی‌شود:
       * ورودِ مثبت مصرفِ لات ندارد که بتوان بهای واقعی‌اش را از دفتر خواند، و عددِ
       * ساختگی روی کارت ضرر، ضرر را کم‌تر نشان می‌داد. بهای کسری هم دست‌نخورده می‌ماند.
       */
      const gains = await prisma.stockMovement.findMany({
        where: {
          delta: { gt: 0 },
          state: 'FINAL',
          createdAt: { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) },
          reason: { in: ['ADJUSTMENT', 'STOCKTAKE'] }
        },
        select: { id: true, reason: true, delta: true },
        // B6 — یک تا بیشتر می‌خوانیم تا «بریده شدن» دیده شود؛ قبلاً ۵۰۰۰تا سقفِ بی‌صدا بود.
        take: 5001
      })
      const gainsTruncated = gains.length > 5000
      if (gainsTruncated) gains.length = 5000
      const gainByReason = new Map<string, { moves: Set<number>; qty: number }>()
      for (const g of gains) {
        const key = String(g.reason || '')
        const cur = gainByReason.get(key) ?? { moves: new Set<number>(), qty: 0 }
        cur.moves.add(Number(g.id))
        cur.qty += Number(g.delta || 0)
        gainByReason.set(key, cur)
      }
      const gainMoves = [...gainByReason.values()].reduce((s, v) => s + v.moves.size, 0)
      const gainQty = [...gainByReason.values()].reduce((s, v) => s + v.qty, 0)
      const moves = await prisma.stockMovement.findMany({
        where: {
          delta: { lt: 0 },
          state: 'FINAL',
          createdAt: { gte: jalaliStartOfDay(from), lte: jalaliEndOfDay(to) },
          reason: { notIn: ['SALE', 'SALE_EDIT', 'SALE_RETURN', 'PURCHASE', 'PURCHASE_EDIT', 'WOO_SYNC_OUT', 'WOO_SYNC_IN', 'WOO_SYNC_ADJUST'] }
        },
        select: { id: true, reason: true, delta: true },
        take: 5001
      })
      const movesTruncated = moves.length > 5000
      if (movesTruncated) moves.length = 5000
      const truncated = movesTruncated || gainsTruncated
      if (!moves.length) {
        return {
          moves: 0,
          qty: 0,
          cost: 0,
          netQty: 0,
          gainMoves,
          gainQty,
          truncated,
          rows: [] as any[]
        }
      }
      const byMove = new Map<number, string>()
      const qtyByMove = new Map<number, number>()
      for (const m of moves) {
        byMove.set(Number(m.id), String(m.reason || ''))
        qtyByMove.set(Number(m.id), Math.abs(Number(m.delta)))
      }
      const ids = [...byMove.keys()]
      const per = new Map<string, { moves: Set<number>; qty: number; cost: number }>()
      const CHUNK = 400
      for (let i = 0; i < ids.length; i += CHUNK) {
        const cons = await db.costConsumption.findMany({
          where: { movementId: { in: ids.slice(i, i + CHUNK) } },
          select: { movementId: true, qty: true, unitCost: true }
        })
        for (const c of cons as any[]) {
          const reason = byMove.get(Number(c.movementId)) ?? ''
          const cur = per.get(reason) ?? { moves: new Set<number>(), qty: 0, cost: 0 }
          cur.moves.add(Number(c.movementId))
          cur.qty += Number(c.qty || 0)
          cur.cost += n(c.unitCost) * Number(c.qty || 0)
          per.set(reason, cur)
        }
      }
      const LABEL: Record<string, string> = {
        ADJUSTMENT: 'اصلاح دستی موجودی',
        STOCKTAKE: 'کسری انبارگردانی',
        SHRINK: 'ضایعات/کسری ثبت‌شده',
        INITIAL: 'موجودی اولیه'
      }
      let qty = 0
      let cost = 0
      let count = 0
      const rows: {
        reason: string
        label: string
        moves: number
        qty: number
        cost: number
        gain: number
        net: number
      }[] = []
      for (const [reason, v] of per) {
        const gain = gainByReason.get(reason)?.qty ?? 0
        qty += v.qty
        cost += v.cost
        count += v.moves.size
        rows.push({
          reason,
          label: LABEL[reason] || 'خروج بدون فروش',
          moves: v.moves.size,
          qty: v.qty,
          cost: v.cost,
          gain,
          net: v.qty - gain
        })
      }
      rows.sort((a, b) => b.cost - a.cost)
      return {
        moves: count,
        qty,
        cost,
        netQty: qty - gainQty,
        gainMoves,
        gainQty,
        truncated,
        rows: rows.slice(0, 8),
        note:
          'بهای تمام‌شدهٔ این خروج‌ها از لات FIFO همان حرکت برداشته می‌شود؛ داخل سود نیست و به‌عنوان ضرر هم از سود کم نشده — کنار سود دیده می‌شود. ' +
          '«اصلاح مثبت» یعنی در همان بازه موجودی بالاتر هم رفته (تایپ اشتباه یا جبران)، پس «خالص» ستون آخر عددی است که واقعاً از قفسه رفته. ' +
          '«انتقال از انبار مرکزی» جهتِ ورود است و در این کارت جایی ندارد؛ خروجِ جدا به انبار مرکزی در این برنامه حرکتِ انبار نمی‌نویسد.'
      }
    })()

    const report = await salesService.reportRows(f)
    const netAccrual = n(report.accounting?.invoice?.netAccrualSales)
    const engine = await costEngine.status()

    return {
      fromJalali: from,
      toJalali: to,
      revenue: netRevenue,
      fifoCost: netFifo,
      replacementCost: netRepl,
      realProfit,
      replacementProfit,
      inflationOnSold,
      realMargin: netRevenue > 0 ? realProfit / netRevenue : 0,
      replacementMargin: netRevenue > 0 ? replacementProfit / netRevenue : 0,
      /** `qty` خالصِ سهم فروشگاه؛ منشأهای مرکزی بیرون‌اند و ابهام جداگانه گزارش می‌شود. */
      qty: Math.max(0, qty - returnQty),
      soldQty: qty,
      returnedQty: returnQty,
      totalReturnedQty,
      ambiguousReturns,
      ambiguousReturnQty,
      belowReplacement,
      belowLines,
      exactPct,
      exactPctRial,
      // B2 — خودِ شمارنده هم بیرون می‌آید تا صفحه (و تست) بتواند بگوید «چند قلم
      // بی‌فی از سود بیرون ماند»، نه فقط یک جملهٔ متنی.
      zeroCostCount,
      exactCount: exactN,
      approxCount: approxN,
      excludedFromPct,
      health,
      missingCostRows: missing,
      missingPurchaseRows,
      returnRevenue,
      returnCostKept,
      nonRestockedReturns,
      losses,
      byCategory: [...byCat.values()]
        .map((c) => ({
          ...c,
          realProfit: c.revenue - c.fifoCost,
          replacementProfit: c.revenue - c.replacementCost
        }))
        .sort((a, b) => b.realProfit - a.realProfit),
      bySupplier: [...bySup.values()]
        .map((s) => ({
          ...s,
          // «خطای پراکندگیِ ته‌گرد» (یادداشتِ بازبینی دوازدهم) — سهم‌ها اعشاری جمع می‌شوند و
          // ته‌گرد یک‌بار همین‌جا می‌خورد؛ چون `realProfit` از فیلدهای ته‌گردشده ساخته می‌شود،
          // «سود = درآمد − فی» روی صفحه هیچ‌وقت یک ریال نمی‌لنگد.
          revenue: Math.round(s.revenue),
          fifoCost: Math.round(s.fifoCost),
          replacementCost: Math.round(s.replacementCost),
          codes: [...s.codes],
          partyCount: s.ids.size,
          realProfit: Math.round(s.revenue) - Math.round(s.fifoCost),
          replacementProfit: Math.round(s.revenue) - Math.round(s.replacementCost)
        }))
        .sort((a, b) => b.realProfit - a.realProfit),
      months: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
        ...m,
        realProfit: m.revenue - m.fifoCost,
        replacementProfit: m.revenue - m.replacementCost,
        inflationOnSold: m.replacementCost - m.fifoCost
      })),
      stock: {
        qty: stockQty,
        fifoValue: stockFifo,
        replacementValue: stockReplacement,
        paperWealth
      },
      unnamedSupplierShare: netRevenue > 0 ? (bySup.get('none')?.revenue ?? 0) / netRevenue : 0,
      unnamedSupplierRevenue: bySup.get('none')?.revenue ?? 0,
      netAccrualSales: netAccrual,
      engine,
      lines: lines.slice(0, 200),
      notes: [
        'سود واقعی خرید: هزینه از لات FIFO (همان پولی که از جیب رفته). مالیات و حق سرویس درآمد سود نیستند.',
        'سود جایگزینی از فی لحظهٔ قفل است (آخرین فاکتور خرید همان موقع، به تاریخِ خودِ فاکتور خرید — نه به زمانی که فاکتور در برنامه تایپ شده)، نه فی همین لحظهٔ باز کردن صفحه.',
        'اختلاف دو سود = سود تورمی کالای ارزان‌خریده. عوض کردن فی روی کارت کالا، سود فاکتورهای قفل‌شده را عوض نمی‌کند.',
        'فروش خالص تعهدی پایین از گزارشات فروش است و فیلتر فروشنده و خرد/عمده رویش اعمال می‌شود؛ فقط فیلتر دسته رویش اثر ندارد (دسته روی اقلام و سود اعمال می‌شود) — سود از روی اقلام و لات است، نه بازنویسی آن عدد.',
        'قفل فی وقتی زده می‌شود که دفتر هزینه حرکت فروش را ببیند (باز کردن تب سود). تا آن لحظه عوض کردن فی کارت روی فروش قفل‌نشده اثر دارد — جنس را با فاکتور خرید وارد کنید.',
        'برگشت از سود فروشندهٔ فاکتور اصلی کم می‌شود، نه از کسی که برگشت را ثبت کرده.',
        'مانده و ثروت کاغذی زیر برای کل مغازه است؛ فیلتر فروشنده روی آن اثر ندارد.',
        ...(outsideCount
          ? [`${outsideCount} قلم از انبار فروشگاه کسر نشده (بدون کسر یا انبار مرکزی) و از سود فروشگاه بیرون است.`]
          : []),
        ...(zeroCostCount
          ? [
              `${zeroCostCount} قلم فی صفر داشت و از سود کنار گذاشته شد تا حاشیهٔ ۱۰۰٪ قاطی نشود — ` +
                `درآمدشان در گزارش فروش هست و پول گم نشده؛ فقط «سودِ» بی‌منبع حساب نمی‌شود. ` +
                `با فاکتور خریدِ همان کالا (یا اصلاح فی‌اش) خودش برمی‌گردد.`
            ]
          : []),
        ...(warehouseShareCount
          ? [`${warehouseShareCount} قلم بخشی از انبار مرکزی آمده و از سود فروشگاه بیرون است.`]
          : []),
        ...(nonRestockedReturns
          ? [
              `${nonRestockedReturns} برگشت جنسش به انبار برنگشته (منشأ فروشگاهی اثبات‌شده؛ ایرادی یا در انتظار تأیید)؛ ` +
                `بهای ${(returnCostKept || 0).toLocaleString('fa-IR')} ریال آن از هزینه کم نشد و در سود به‌عنوان زیان همان جنس مانده است.`
            ]
          : []),
        ...(ambiguousReturns
          ? [
              `${ambiguousReturns} برگشت (${ambiguousReturnQty} عدد) منشأ STORE/انبار مرکزی در دادهٔ موجود قابل اثبات نیست؛ ` +
                `به سود فروشگاه تخصیص داده نشد تا سهم مالی حدس زده نشود. سند/دفتر موجود تفکیک این واحدها را ثبت نکرده است.`
            ]
          : []),
        ...(missing ? [`${missing} قلم فروش هنوز فی قفل ندارد؛ بعد از پردازش دفتر هزینه عدد کامل می‌شود.`] : []),
        ...(engine.behind > 0 ? [`دفتر هزینه ${engine.behind} حرکت انبار عقب است.`] : []),
        ...((Number(engine.repriceQueued) || 0) > 0
          ? [`${Number(engine.repriceQueued)} اصلاح فی فاکتور خرید در صف دفتر هزینه است؛ با اجرای بعدی اعمال می‌شود.`]
          : []),
        ...((Number(engine.lastReprice?.replacementStale) || 0) > 0
          ? [
              `آخرین اصلاح فی فاکتور خرید ${Number(engine.lastReprice?.saleItems) || 0} قلم فروش قفل‌شده را لمس کرد؛ ` +
                `${Number(engine.lastReprice?.replacementFixed) || 0} قلمِ دارای منبعِ همین فاکتور هم‌راستا شد و ` +
                `${Number(engine.lastReprice?.replacementStale) || 0} قلم به‌دلیل نامشخص/ناقص بودنِ منبع، ` +
                `بدون حدسِ مبتنی بر مبلغ دست‌نخورده ماند. فاکتورهای منبع دیگر، کارت کالا و لاتِ بی‌فاکتور عمداً تغییر نمی‌کنند.`
            ]
          : []),
        ...(engine.failCount > 0
          ? [`${engine.failCount} حرکت انبار خطا دارد و تکرار می‌شود تا درست شود، یا «بازسازی دفتر» بزنید.`]
          : [])
      ],
      warnings: report.warnings ?? []
    }
  }
}
