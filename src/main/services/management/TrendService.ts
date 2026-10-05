/**
 * گزارش مدیریت · فاز ۱ — روند، ترکیب پول، دسته، فروشنده، مقایسه.
 * اعداد فروش فقط از `salesService.reportRows().accounting` می‌آیند.
 * هیچ فرمول موازی برای فروش خالص یا نقد کشو اینجا نیست.
 */
import { salesService, saleWhere, channelOrderTypeFilter, REPORT_EXCLUDED_SALE_STATUSES } from '../SalesService'
import { staffReportService } from '../StaffReportService'
import { prisma } from '../../db/client'
import { allocateLineNet, goodsPayableOf } from '@shared/returnValue'
import { toNumberRial } from '@shared/money'
import { BusinessError } from '../../errors'
import { jalaliToday } from '@shared/jalali'
import {
  enumerateBuckets,
  previousEqualLength,
  sameMonthLastYear,
  normalizeJalaliYmd,
  type MgmtGrain
} from '@shared/jalaliBuckets'
import { categoryWithDescendants } from './categoryTree'
import { findByIds } from './inChunk'
import type { SaleReportFilter } from '@shared/types'

export type MgmtFilter = {
  fromJalali?: string
  toJalali?: string
  userId?: number | null
  channels?: string[] | null
  grain?: MgmtGrain
  categoryId?: number | null
}

function n(v: unknown): number {
  return toNumberRial((v as number) ?? 0)
}

function baseFilter(f: MgmtFilter): SaleReportFilter {
  const from = normalizeJalaliYmd(String(f.fromJalali || jalaliToday())) || ''
  const to = normalizeJalaliYmd(String(f.toJalali || jalaliToday())) || ''
  if (!from || !to) throw new BusinessError('بازهٔ شمسی نامعتبر است.')
  const out: SaleReportFilter = { fromJalali: from, toJalali: to, take: 1, skip: 0, withDrillDown: false }
  if (f.userId != null && Number(f.userId) > 0) out.userId = Number(f.userId)
  if (f.channels !== undefined) out.channels = f.channels
  return out
}

function slimAccounting(acc: any) {
  if (!acc) return null
  return {
    invoice: {
      grossSales: n(acc.invoice?.grossSales),
      discounts: n(acc.invoice?.discounts),
      taxes: n(acc.invoice?.taxes),
      serviceCharges: n(acc.invoice?.serviceCharges),
      deliveryFees: n(acc.invoice?.deliveryFees),
      simpleReturns: n(acc.invoice?.simpleReturns),
      exchangeReturned: n(acc.invoice?.exchangeReturned),
      netAccrualSales: n(acc.invoice?.netAccrualSales),
      invoiceCount: Number(acc.invoice?.invoiceCount ?? 0)
    },
    cash: {
      cashReceived: n(acc.cash?.cashReceived),
      cardReceived: n(acc.cash?.cardReceived),
      otherReceived: n(acc.cash?.otherReceived),
      managerAccountReceived: n(acc.cash?.managerAccountReceived),
      destinationUnknownReceived: n(acc.cash?.destinationUnknownReceived),
      unknownLikelyCash: n(acc.cash?.unknownLikelyCash),
      netCashMovement: n(acc.cash?.netCashMovement)
    },
    credit: {
      remaining: n(acc.credit?.remaining),
      created: n(acc.credit?.created),
      settledCurrent: n(acc.credit?.settledCurrent),
      settledPrior: n(acc.credit?.settledPrior)
    },
    notes: Array.isArray(acc.notes) ? acc.notes.map(String) : []
  }
}

async function accountingOf(filter: SaleReportFilter) {
  const res = await salesService.reportRows(filter)
  return {
    accounting: slimAccounting(res.accounting),
    warnings: Array.isArray(res.warnings) ? res.warnings.map(String) : [],
    invoiceCount: Number(res.accounting?.invoice?.invoiceCount ?? res.page?.totalCount ?? 0)
  }
}

export const trendService = {
  async snapshot(filter: MgmtFilter = {}) {
    const f = baseFilter(filter)
    return accountingOf(f)
  },

  async trend(filter: MgmtFilter = {}) {
    const f = baseFilter(filter)
    const grain: MgmtGrain = filter.grain === 'week' || filter.grain === 'month' ? filter.grain : 'day'
    const buckets = enumerateBuckets(f.fromJalali!, f.toJalali!, grain)
    const points = []
    for (const b of buckets) {
      const one = await accountingOf({ ...f, fromJalali: b.fromJalali, toJalali: b.toJalali, take: 1 })
      const acc = one.accounting
      points.push({
        fromJalali: b.fromJalali,
        toJalali: b.toJalali,
        label: b.label,
        netAccrualSales: acc?.invoice.netAccrualSales ?? 0,
        invoiceCount: acc?.invoice.invoiceCount ?? 0,
        cashReceived: acc?.cash.cashReceived ?? 0,
        cardReceived: acc?.cash.cardReceived ?? 0,
        creditRemaining: acc?.credit.remaining ?? 0,
        managerAccountReceived: acc?.cash.managerAccountReceived ?? 0,
        destinationUnknownReceived: acc?.cash.destinationUnknownReceived ?? 0,
        unknownLikelyCash: acc?.cash.unknownLikelyCash ?? 0,
        notes: acc?.notes ?? [],
        warnings: one.warnings
      })
    }
    if (grain === 'month') {
      for (const p of points) {
        const prior = sameMonthLastYear(p.fromJalali, p.toJalali)
        const one = await accountingOf({ ...f, fromJalali: prior.fromJalali, toJalali: prior.toJalali, take: 1 })
        ;(p as any).lastYearNetAccrualSales = one.accounting?.invoice.netAccrualSales ?? 0
        ;(p as any).lastYearLabel = prior.label
      }
    }
    const whole = await accountingOf(f)
    const empty = points.every((p) => p.invoiceCount === 0 && p.netAccrualSales === 0)
    return { grain, points, empty, whole, warnings: whole.warnings }
  },

  async compare(
    filter: MgmtFilter & { mode?: 'previous' | 'lastYear' | 'custom'; otherFromJalali?: string; otherToJalali?: string } = {}
  ) {
    const f = baseFilter(filter)
    const aSpan = { fromJalali: f.fromJalali!, toJalali: f.toJalali! }
    const bSpan =
      filter.mode === 'lastYear'
        ? sameMonthLastYear(aSpan.fromJalali, aSpan.toJalali)
        : filter.mode === 'custom'
          ? (() => {
              const of = normalizeJalaliYmd(String(filter.otherFromJalali || ''))
              const ot = normalizeJalaliYmd(String(filter.otherToJalali || ''))
              if (!of || !ot) throw new BusinessError('بازهٔ مقایسه نامعتبر است.')
              return { fromJalali: of, toJalali: ot, label: `${of} تا ${ot}` }
            })()
          : previousEqualLength(aSpan.fromJalali, aSpan.toJalali)
    const [a, b] = await Promise.all([
      accountingOf({ ...f, fromJalali: aSpan.fromJalali, toJalali: aSpan.toJalali }),
      accountingOf({ ...f, fromJalali: bSpan.fromJalali, toJalali: bSpan.toJalali })
    ])
    return {
      a: { ...aSpan, label: `${aSpan.fromJalali} تا ${aSpan.toJalali}`, ...a },
      b: { ...bSpan, ...b }
    }
  },

  async staff(filter: MgmtFilter = {}) {
    const f = baseFilter(filter)
    const perf = await staffReportService.performance({
      fromJalali: f.fromJalali,
      toJalali: f.toJalali,
      userId: f.userId ?? null
    })
    const rows = Array.isArray(perf) ? perf : perf.rows ?? []
    return {
      rows,
      note:
        'فروش هر فروشنده جمع مبلغ فاکتورهای صادرشده توسط اوست (مثل تب کارمند گزارشات فروش) ' +
        'و با «فروش خالص تعهدی» سرجمع یکی نیست. نرخ برگشت در این صفحه نشان داده نمی‌شود، ' +
        'چون برگشت در تب کارمند به ثبت‌کنندهٔ برگشت نسبت داده می‌شود نه به فروشندهٔ فاکتور.'
    }
  },

  async staffOptions() {
    return staffReportService.staff()
  },

  async category(filter: MgmtFilter = {}) {
    const f = baseFilter(filter)
    const catId = filter.categoryId != null && Number(filter.categoryId) > 0 ? Number(filter.categoryId) : null
    const catIds = catId ? await categoryWithDescendants(catId) : null
    const where = saleWhere(f)
    const invoices = await prisma.saleInvoice.findMany({
      where,
      select: {
        id: true,
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
            variant: { select: { product: { select: { categoryId: true, category: { select: { id: true, name: true, parentId: true } } } } } }
          }
        }
      }
    })
    const byCat = new Map<string, { categoryId: number | null; name: string; amount: number; qty: number }>()
    let lineSum = 0
    for (const inv of invoices) {
      const net = allocateLineNet(inv as any)
      for (const it of inv.items) {
        const amount = net.get(it.id) ?? 0
        lineSum += amount
        const cat = it.variant?.product?.category
        const name = cat?.name || 'بدون دسته'
        const categoryId = cat?.id ?? it.variant?.product?.categoryId ?? null
        if (catIds && (categoryId == null || !catIds.includes(categoryId))) continue
        const key = categoryId != null ? `id:${categoryId}` : `name:${name}`
        const cur = byCat.get(key) ?? { categoryId, name, amount: 0, qty: 0 }
        cur.amount += amount
        cur.qty += Number(it.qty || 0)
        byCat.set(key, cur)
      }
    }
    const invById = new Map(invoices.map((inv) => [inv.id, inv]))
    const ot = channelOrderTypeFilter(f.channels)
    const retItems = await prisma.saleReturnItem.findMany({
      where: {
        return: { voidedAt: null, returnedAtJalali: { gte: f.fromJalali, lte: f.toJalali } },
        saleItem: {
          invoice: {
            voidedAt: null,
            // B7 (بازبینی دوازدهم) — فاکتورِ پیش‌نویس/لغوشده در فروش شمرده نمی‌شود؛ برگشتِ همان
            // فاکتور هم نباید از دسته کم شود (تب سود و ABC همین گارد را دارند).
            status: { notIn: REPORT_EXCLUDED_SALE_STATUSES },
            ...(f.userId != null && Number(f.userId) > 0 ? { userId: Number(f.userId) } : {}),
            ...(ot ? { orderType: ot } : {})
          }
        }
      },
      select: {
        qty: true,
        saleItemId: true,
        saleItem: {
          select: {
            invoiceId: true,
            qty: true,
            variant: { select: { product: { select: { categoryId: true, category: { select: { id: true, name: true } } } } } }
          }
        }
      }
    })
    const missingInvIds = [...new Set(retItems.map((r) => Number(r.saleItem.invoiceId)).filter((id) => !invById.has(id)))]
    if (missingInvIds.length) {
      const extra = await findByIds(prisma as any, 'saleInvoice', 'id', missingInvIds, {
        select: {
          id: true,
          grandTotal: true,
          deliveryFee: true,
          items: {
            select: { id: true, qty: true, unitPrice: true, discount: true, tax: true, lineTotal: true }
          }
        }
      })
      for (const inv of extra) invById.set(inv.id, inv as any)
    }
    // سقفِ برگشت روی کلِ بازه برای هر قلم فروش اعمال می‌شود، نه جداگانه روی هر سند برگشت.
    // ته‌گرد هم تفاضلی است تا جمعِ چند برگشت دقیقاً به سهمِ همان تعداد برسد و از درآمد خط رد نشود.
    const returnedRevenueQty = new Map<number, number>()
    for (const r of retItems) {
      const inv = invById.get(r.saleItem.invoiceId)
      if (!inv) continue
      const cat = r.saleItem.variant?.product?.category
      const name = cat?.name || 'بدون دسته'
      const categoryId = cat?.id ?? r.saleItem.variant?.product?.categoryId ?? null
      if (catIds && (categoryId == null || !catIds.includes(categoryId))) continue
      const net = allocateLineNet(inv as any)
      const lineRev = net.get(r.saleItemId) ?? 0
      const lineQty = Math.max(0, Math.round(Number(r.saleItem.qty) || 0))
      const requestedQty = Math.max(0, Math.round(Number(r.qty) || 0))
      const alreadyReturned = returnedRevenueQty.get(Number(r.saleItemId)) ?? 0
      const acceptedQty = Math.min(requestedQty, Math.max(0, lineQty - alreadyReturned))
      const returnedAfter = alreadyReturned + acceptedQty
      returnedRevenueQty.set(Number(r.saleItemId), returnedAfter)
      const amount =
        lineQty > 0
          ? Math.round((lineRev * returnedAfter) / lineQty) - Math.round((lineRev * alreadyReturned) / lineQty)
          : 0
      const key = categoryId != null ? `id:${categoryId}` : `name:${name}`
      const cur = byCat.get(key) ?? { categoryId, name, amount: 0, qty: 0 }
      cur.amount -= amount
      // تعداد عمداً خام می‌ماند تا برگشتِ بیش‌ازفروش از داده پنهان نشود.
      cur.qty -= Number(r.qty || 0)
      byCat.set(key, cur)
    }
    const rows = [...byCat.values()].sort((a, b) => b.amount - a.amount)
    const payable = invoices.reduce((s, inv) => s + goodsPayableOf(inv as any), 0)
    /**
     * B8 (بازبینی نهم) — «جمع ارزش اقلام» کنار جدول، جمعِ **همهٔ** اقلام پیش از
     * برگشت‌ها و پیش از فیلتر دسته بود، در حالی که ردیف‌های جدول بعد از هر دو ساخته
     * می‌شوند؛ پس جمعِ ستون با عدد بالای جدول نمی‌خواند. `lineSum` برای همان
     * «خواندن با پرداخت فاکتور» لازم است (باید پیش از فیلتر باشد، وگرنه با `payable`
     * نمی‌خواند)، پس دست‌نخورده می‌ماند و یک عدد دوم اضافه می‌شود: جمعِ ردیف‌های
     * دیده‌شده. یکی‌شان «کنترلِ سند» است، دیگری «جمعِ همین جدول» — برچسب‌ها این را
     * می‌گویند، نه اینکه یکی را حذف کنیم.
     */
    const shownSum = rows.reduce((s, r) => s + r.amount, 0)
    const shownQty = rows.reduce((s, r) => s + r.qty, 0)
    const whole = await accountingOf(f)
    return {
      rows,
      lineSum,
      shownSum,
      shownQty,
      categoryFiltered: !!catIds,
      payable,
      netAccrualSales: whole.accounting?.invoice.netAccrualSales ?? 0,
      invoiceCount: whole.accounting?.invoice.invoiceCount ?? 0,
      reconcilable: lineSum === payable,
      note:
        'ستون دسته، ارزش اقلام بعد از کم کردن برگشت همان بازه است. ' +
        (catIds ? 'فیلتر دسته روی همین ستون‌ها اعمال شده (پس «جمع همین جدول» با کل مغازه فرق می‌کند). ' : '') +
        'فروش خالص تعهدی کنارش از همان موتور گزارش فروش و برای همین بازه است؛ ' +
        'فیلتر فروشنده و خرد/عمده رویش اعمال می‌شود، فقط فیلتر دسته روی آن نیست (پرداخت به قلم وصل نیست). ' +
        'ترکیب نقد/کارت به تفکیک دسته قابل محاسبه نیست — پرداخت به قلم تخصیص داده نمی‌شود.',
      warnings: whole.warnings
    }
  },

  async heatmap(filter: MgmtFilter = {}) {
    const f = baseFilter(filter)
    const where = saleWhere(f)
    const invoices = await prisma.saleInvoice.findMany({
      where,
      select: { issuedAt: true }
    })
    const cells: { dow: number; hour: number; count: number }[] = []
    const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
    for (const inv of invoices) {
      const d = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
      const dow = (d.getDay() + 1) % 7
      const hour = d.getHours()
      grid[dow][hour] += 1
    }
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        if (grid[dow][hour]) cells.push({ dow, hour, count: grid[dow][hour] })
      }
    }
    return {
      cells,
      total: invoices.length,
      weekdays: ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'],
      note: 'کل مغازه: تعداد فاکتور بر اساس ساعت صدور. فروشنده و خرد/عمده روی این تب اعمال نمی‌شود.'
    }
  }
}
