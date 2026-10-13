import { prisma } from '../db/client'
import { calculateReturnTotals, calculateStaffPerformance, invoiceDiscountPercent } from '@shared/accounting'
import type { StaffPerformanceRow, StaffReturnEvent } from '@shared/accounting'
import {
  findShiftSlot,
  findShiftTemplate,
  isWithinTemplate,
  applyOfficialOffset,
  sessionLabelOf,
  shiftWindowLabel
} from '@shared/receipt'
import { settingsService } from './SettingsService'
import { jalaliRange } from './CardTransferService'
import { jalaliToday, isValidJalaliDate, toLatinDigits } from '@shared/jalali'
import { BusinessError } from '../errors'
import type { SaleReportPage } from '@shared/types'
import { staffSectionNotice } from '@shared/staffTransactionsPaging'
import { toNumberRial } from '@shared/money'

/**
 * ممیزی A102-01 (AUDIT-D33) — همان دروازه‌ی گزارش فروش (REPORT_EXCLUDED_SALE_STATUSES / saleWhere):
 * فاکتور DRAFT/CANCELED حتی بدون voidedAt (داده‌ی قدیمی) فروش هیچ کارمندی نیست.
 */
const STAFF_INVOICE_STATUS_GATE = { status: { notIn: ['DRAFT', 'CANCELED'] } }

/** سقف امن برای `IN`های ساخته‌شده از شناسه‌های گزارش؛ هیچ ردیفی را حذف نمی‌کند. */
const REPORT_IN_CHUNK = 500
const STAFF_TRANSACTIONS_DEFAULT_TAKE = 500
const STAFF_TRANSACTIONS_MAX_TAKE = 2000

function chunksOf<T>(values: T[], size = REPORT_IN_CHUNK): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < values.length; i += size) chunks.push(values.slice(i, i + size))
  return chunks
}

type StaffTransactionsSection = 'invoices' | 'returns' | 'cardTransfers' | 'creditRedemptions'
type StaffTransactionsPages = Record<StaffTransactionsSection, SaleReportPage>

const staffTransactionsPage = (totalCount: number, skip: number, take: number): SaleReportPage => ({
  skip,
  take,
  totalCount,
  truncated: totalCount > skip + take
})

/**
 * ===========================================================================
 * جلسه ۱۷ · بندهای ۲، ۳ و ۶ — گزارش‌های کارمند-محور.
 *
 * ⚠️ قاعده‌ی سختِ این سرویس: **هیچ فرمول مالی تازه‌ای اینجا نیست.** کارش فقط
 * «جمع کردن داده‌ی خام + پاس دادن به `accounting.ts` + فیلتر کردن» است. اگر
 * فردا فرمول تخفیف یا برگشت عوض شود، همان یک جا عوض می‌شود و این گزارش‌ها
 * خودکار همراهش می‌آیند.
 * ===========================================================================
 */

/** فقط فاکتورهای واقعی فروش (سند تعویض، خودش یک فروشِ جایگزین است و می‌ماند). */
const SALE_SELECT = {
  id: true,
  receiptNo: true,
  userId: true,
  shiftId: true,
  issuedAt: true,
  issuedAtJalali: true,
  goodsTotal: true,
  discountTotal: true,
  taxTotal: true,
  serviceCharge: true,
  deliveryFee: true,
  grandTotal: true,
  orderType: true,
  status: true,
  user: { select: { displayName: true, username: true } },
  shift: { select: { name: true, number: true } }
} as const

const userLabel = (u?: { displayName?: string | null; username?: string | null } | null): string | null =>
  u ? u.displayName || u.username || null : null

/** endpointهای این سرویس هم مثل تب گزارش فروش، بدون فیلتر فقط «امروز» را می‌خوانند. */
const reportRange = (filter: { fromJalali?: string | null; toJalali?: string | null } = {}) => {
  const today = jalaliToday()
  return jalaliRange(staffReportDate(filter.fromJalali, 'از تاریخ', today), staffReportDate(filter.toJalali, 'تا تاریخ', today))
}

/**
 * ممیزی A88-01 — خالی/null/فاصله ⇒ «امروز» (بند ۴-۲۳)؛ متن نیمه‌تایپ‌شده یا نامعتبر
 * (۱۴۰۵/۰۷/۰، ۱۴۰۵/۱۳/۰۱) ⇒ خطای فارسی. قبلاً '' یعنی کل تاریخچه و ماه ۱۳ یعنی سال بعد.
 */
function staffReportDate(raw: string | null | undefined, label: string, today: string): string {
  const clean = toLatinDigits(String(raw ?? '')).trim()
  if (!clean) return today
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» گزارش عملکرد کارمندان معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید؛ گزارشی برای بازه‌ی نامعتبر ساخته نشد.`
    )
  return clean
}

/**
 * SaleReturn فقط userId/shiftId اسکالر دارد و relation پریزمایی ندارد.
 * lookup جدا هم type-safe است و هم تب عملکرد را در Prisma واقعی از crash نجات می‌دهد.
 */
async function returnLookups(returns: Array<{ userId: number | null; shiftId: number | null }>) {
  const userIds = [...new Set(returns.map((r) => r.userId).filter((id): id is number => id != null))]
  const shiftIds = [...new Set(returns.map((r) => r.shiftId).filter((id): id is number => id != null))]
  const [users, shifts] = await Promise.all([
    Promise.all(
      chunksOf(userIds).map((ids) =>
        prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, username: true }
        })
      )
    ).then((parts) => parts.flat()),
    Promise.all(
      chunksOf(shiftIds).map((ids) =>
        prisma.shift.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, number: true, sessionSeq: true, nameOverridden: true }
        })
      )
    ).then((parts) => parts.flat())
  ])
  const userMap = new Map(users.map((u) => [u.id, u]))
  const shiftMap = new Map(shifts.map((s) => [s.id, s]))
  return {
    users: userMap,
    shifts: shiftMap,
    /**
     * نشست ۱۸۰ (S180-D4، گام ۰ خوشه M) — `SaleReturn.userId/shiftId` در schema
     * nullable اند، ولی همه‌ی مصرف‌کننده‌ها `map.get(r.shiftId)` می‌زدند و زیر
     * `strict` خطای TS2345 («number | null به number اسایْن نمی‌شود») می‌دادند.
     * این دو helper همان معنا را با پذیرش null می‌دهند: نبودِ شناسه ⇒ undefined،
     * که دقیقاً همان مسیر fallbackِ «—»/«نامشخص» قبلی است. رفتار عوض نمی‌شود.
     */
    userOf: (id: number | null | undefined) => (id == null ? undefined : userMap.get(id)),
    shiftOf: (id: number | null | undefined) => (id == null ? undefined : shiftMap.get(id))
  }
}

/** ساعت ثبت یک رکورد به شکل HH:MM (از فیلد ساعت، یا از خود تاریخ). */
const clockOf = (time?: string | null, at?: Date | null): string => {
  const t = String(time ?? '').trim()
  if (/^\d{1,2}:\d{2}/.test(t)) return t.slice(0, 5).padStart(5, '0')
  if (!at) return ''
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const staffReportService = {
  /** فهرست کارمندان برای فیلتر «انتخاب کارمند (یا همه‌ی کارمندان)». */
  async staff() {
    const rows = await prisma.user.findMany({
      select: { id: true, displayName: true, username: true, role: true, isActive: true },
      orderBy: { id: 'asc' }
    })
    return rows.map((u) => ({
      id: u.id,
      name: u.displayName || u.username,
      role: u.role,
      isActive: u.isActive
    }))
  },

  /**
   * بند ۲ — «عملکرد کارمندان». یک ردیف خلاصه به‌ازای هر کارمند، ساخته‌شده با
   * `calculateStaffPerformance` (که خودش `calculateInvoiceTotals` و
   * `calculateReturnTotals` را صدا می‌زند).
   */
  async performance(filter: { fromJalali?: string; toJalali?: string; userId?: number | null } = {}) {
    const issuedAt = reportRange(filter)
    const returnedAt = reportRange(filter)
    const userId = filter.userId == null || filter.userId === 0 ? null : Number(filter.userId)

    const invoices = await prisma.saleInvoice.findMany({
      where: { ...(issuedAt ? { issuedAt } : {}), ...(userId ? { userId } : {}), voidedAt: null, ...STAFF_INVOICE_STATUS_GATE },
      select: SALE_SELECT
    })
    const returns = await prisma.saleReturn.findMany({
      where: {
        voidedAt: null,
        ...(returnedAt ? { returnedAt } : {}),
        ...(userId ? { userId } : {}),
        invoice: STAFF_INVOICE_STATUS_GATE
      },
      select: {
        id: true,
        kind: true,
        total: true,
        userId: true,
        returnedAt: true,
        refundMethod: true,
        refundAmount: true,
        exchangeTotal: true,
        exchangeDiff: true,
        exchangeSettlement: true,
        storeCreditId: true,
        shiftId: true
      }
    })
    const returnMaps = await returnLookups(returns)

    // مبلغ اعتبار خریدِ صادرشده‌ی هر برگشت، از خودِ جدول StoreCredit (نه حدس)
    const creditIds = returns.map((r) => r.storeCreditId).filter((x): x is number => !!x)
    const credits = (
      await Promise.all(
        chunksOf(creditIds).map((ids) =>
          prisma.storeCredit.findMany({ where: { id: { in: ids } }, select: { id: true, amount: true } })
        )
      )
    ).flat()
    const creditAmount = new Map(credits.map((c) => [c.id, c.amount]))

    const redemptions = await prisma.storeCreditRedemption.findMany({
      where: { reversedAt: null, at: reportRange(filter), ...(userId ? { userId } : {}) },
      select: { userId: true, amount: true }
    })
    const redemptionUserIds = [...new Set(redemptions.map((r) => r.userId).filter((id): id is number => id != null))]
    const redemptionUsers = (
      await Promise.all(
        chunksOf(redemptionUserIds).map((ids) =>
          prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, displayName: true, username: true }
          })
        )
      )
    ).flat()
    const redemptionNames = new Map(redemptionUsers.map((u) => [u.id, userLabel(u)]))
    const creditUses = redemptions.map((r) => ({
      userId: r.userId,
      userName: redemptionNames.get(r.userId ?? -1) ?? null,
      amount: r.amount
    }))

    const staffReturns: StaffReturnEvent[] = returns.map((r) => ({
      id: r.id,
      kind: r.kind,
      total: r.total,
      userId: r.userId,
      userName: userLabel(returnMaps.userOf(r.userId)),
      refundMethod: r.refundMethod,
      refundAmount: r.refundAmount,
      returnedAt: r.returnedAt,
      exchangeTotal: r.exchangeTotal ?? 0,
      exchangeDiff: r.exchangeDiff ?? 0,
      exchangeSettlement: r.exchangeSettlement,
      storeCreditAmount: r.storeCreditId ? creditAmount.get(r.storeCreditId) ?? 0 : 0
    }))

    const rows = calculateStaffPerformance(
      invoices.map((i) => ({
        id: i.id,
        userId: i.userId,
        userName: userLabel(i.user),
        goodsTotal: i.goodsTotal,
        discountTotal: i.discountTotal,
        taxTotal: i.taxTotal,
        serviceCharge: i.serviceCharge,
        deliveryFee: i.deliveryFee,
        issuedAt: i.issuedAt
      })),
      staffReturns,
      creditUses
    )

    /**
     * تعهدهای کارت‌به‌کارت همین بازه، به تفکیک کارمندِ ثبت‌کننده.
     * نشست ۱۱۷ (S117-1) — درخواست «رد/لغو»شده (CANCELED) پولی از حساب مدیر خارج
     * نمی‌کند و تعهد باز نیست؛ پس در تعهد کارمند شمرده نمی‌شود (در ریز تراکنش با
     * وضعیتش می‌ماند). جدول درخواست منبع قطعی است؛ فقط برای برگشت‌های قدیمیِ بدون
     * هیچ ردیف درخواست (داده‌ی تاریخی) همان مبلغ برگشت‌محور می‌ماند تا تعهدی پنهان
     * نشود. هر تعهد دقیقاً یک‌بار: یا از درخواست، یا از برگشتِ بی‌درخواست.
     */
    const createdAt = reportRange(filter)
    const transfers = await prisma.cardTransferRequest.groupBy({
      by: ['userId'],
      where: {
        kind: 'REQUEST',
        status: { not: 'CANCELED' },
        ...(createdAt ? { createdAt } : {}),
        ...(userId ? { userId } : {})
      },
      _sum: { amount: true },
      _count: { _all: true }
    })
    const requestedReturnIds = new Set(
      (
        await Promise.all(
          chunksOf(returns.map((r) => r.id)).map((ids) =>
            prisma.cardTransferRequest.findMany({
              where: { kind: 'REQUEST', returnId: { in: ids } },
              select: { returnId: true }
            })
          )
        )
      )
        .flat()
        .map((t) => t.returnId)
    )
    const commitmentBy = new Map<string, number>()
    const keyOf = (id: number | null | undefined): string => (id == null ? 'none' : String(id))
    for (const t of transfers)
      // نشست ۱۸۱: `_sum` یک جمع تجمیعی BigInt است؛ `Math.round` رویش استثنا
      // می‌دهد و `Number()` بی‌صدا گرد می‌کند ⇒ `toNumberRial` که بلند خطا می‌دهد.
      commitmentBy.set(keyOf(t.userId), (commitmentBy.get(keyOf(t.userId)) ?? 0) + toNumberRial(t._sum.amount ?? 0))
    for (const r of staffReturns) {
      if (requestedReturnIds.has(Number(r.id))) continue
      const one = calculateReturnTotals([r])
      const legacy = one.cardToCardPending + one.exchangeCardToCardPending
      if (legacy > 0) commitmentBy.set(keyOf(r.userId), (commitmentBy.get(keyOf(r.userId)) ?? 0) + legacy)
    }
    const present = new Set(rows.map((row) => keyOf(row.userId)))
    const missingIds = [...commitmentBy.keys()].filter((k) => !present.has(k) && k !== 'none').map(Number)
    const missingUsers = new Map(
      (
        await Promise.all(
          chunksOf(missingIds).map((ids) =>
            prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true, username: true } })
          )
        )
      )
        .flat()
        .map((u) => [u.id, userLabel(u)])
    )
    for (const key of commitmentBy.keys()) {
      if (present.has(key)) continue
      // تعهدِ کارمندی که در این بازه فروش/برگشتی ندارد هم باید دیده شود، نه اینکه دور ریخته شود.
      const id = key === 'none' ? null : Number(key)
      const blank: StaffPerformanceRow = {
        userId: id,
        userName:
          (id != null ? missingUsers.get(id) : null) ||
          (id == null ? 'نامشخص (بدون کارمند ثبت‌شده)' : `کاربر ${id}`),
        salesTotal: 0, invoiceCount: 0, discountTotal: 0, discountPercent: 0, grossGoods: 0,
        returnCount: 0, returnTotal: 0, exchangeCount: 0, exchangeTotal: 0,
        storeCreditCount: 0, storeCreditTotal: 0,
        storeCreditUsedCount: 0, storeCreditUsedTotal: 0,
        cardToCardTotal: 0
      }
      rows.push(blank)
      present.add(key)
    }
    for (const row of rows) row.cardToCardTotal = commitmentBy.get(keyOf(row.userId)) ?? 0

    return { rows, invoiceCount: invoices.length, returnCount: returns.length }
  },

  /**
   * بند ۲ — ریز تراکنش‌های *یک* کارمند: فاکتورها، برگشت‌ها/تعویض‌ها و
   * درخواست‌های کارت‌به‌کارتش. از همان جدول‌های موجود، فقط فیلترشده.
   */
  async transactions(
    filter: {
      fromJalali?: string
      toJalali?: string
      userId?: number | null
      skip?: number
      take?: number
    } = {}
  ) {
    const userId = filter.userId == null || filter.userId === 0 ? null : Number(filter.userId)
    const issuedAt = reportRange(filter)
    const skip = Math.max(0, Math.round(Number(filter.skip ?? 0) || 0))
    const requestedTake = Math.max(
      1,
      Math.round(Number(filter.take ?? STAFF_TRANSACTIONS_DEFAULT_TAKE) || STAFF_TRANSACTIONS_DEFAULT_TAKE)
    )
    const take = Math.min(requestedTake, STAFF_TRANSACTIONS_MAX_TAKE)

    const invoiceWhere = { ...(issuedAt ? { issuedAt } : {}), ...(userId ? { userId } : {}), voidedAt: null, ...STAFF_INVOICE_STATUS_GATE }
    const returnWhere = {
      voidedAt: null,
      ...(issuedAt ? { returnedAt: issuedAt } : {}),
      ...(userId ? { userId } : {}),
      invoice: STAFF_INVOICE_STATUS_GATE
    }
    const transferWhere = {
      ...(issuedAt ? { createdAt: issuedAt } : {}),
      ...(userId ? { userId } : {})
    }
    const redemptionWhere = {
      reversedAt: null,
      ...(issuedAt ? { at: issuedAt } : {}),
      ...(userId ? { userId } : {})
    }

    const [invoiceCount, returnCount, cardTransferCount, creditRedemptionCount] = await Promise.all([
      prisma.saleInvoice.count({ where: invoiceWhere }),
      prisma.saleReturn.count({ where: returnWhere }),
      prisma.cardTransferRequest.count({ where: transferWhere }),
      prisma.storeCreditRedemption.count({ where: redemptionWhere })
    ])
    const pages: StaffTransactionsPages = {
      invoices: staffTransactionsPage(invoiceCount, skip, take),
      returns: staffTransactionsPage(returnCount, skip, take),
      cardTransfers: staffTransactionsPage(cardTransferCount, skip, take),
      creditRedemptions: staffTransactionsPage(creditRedemptionCount, skip, take)
    }

    const [invoices, returns, transfers, creditRedemptions] = await Promise.all([
      prisma.saleInvoice.findMany({
        where: { ...(issuedAt ? { issuedAt } : {}), ...(userId ? { userId } : {}), voidedAt: null, ...STAFF_INVOICE_STATUS_GATE },
        select: SALE_SELECT,
        orderBy: { id: 'desc' },
        skip,
        take
      }),
      prisma.saleReturn.findMany({
        where: returnWhere,
        select: {
          id: true,
          kind: true,
          total: true,
          returnedAtJalali: true,
          returnedAtTime: true,
          refundMethod: true,
          refundAmount: true,
          exchangeTotal: true,
          exchangeDiff: true,
          exchangeSettlement: true,
          storeCreditId: true,
          invoice: { select: { receiptNo: true } },
          /**
           * نشست ۱۸۰ (S180-D5، ایراد واقعی): `userId` در این یکی از سه
           * `saleReturn.findMany` این فایل انتخاب نمی‌شد (دو تای دیگر می‌کنند)،
           * ولی نتیجه به `returnLookups` داده می‌شد که روی `r.userId` نگاشت
           * می‌زند ⇒ فهرست شناسه‌ها همیشه خالی و lookup کاربر بی‌اثر. قرارداد
           * تابع را برآورده نمی‌کرد و زیر Prisma واقعی TS2345 می‌داد.
           */
          userId: true,
          shiftId: true
        },
        orderBy: { id: 'desc' },
        skip,
        take
      }),
      prisma.cardTransferRequest.findMany({
        where: transferWhere,
        orderBy: { id: 'desc' },
        skip,
        take
      }),
      prisma.storeCreditRedemption.findMany({
        where: redemptionWhere,
        select: { id: true, amount: true, invoiceId: true, receiptNo: true, atJalali: true, atTime: true },
        orderBy: { id: 'desc' },
        skip,
        take
      })
    ])
    const returnMaps = await returnLookups(returns)
    // ممیزی A103-01 — هشدار بعد از خواندن ردیف‌ها و با تعداد واقعی ردیف صفحه (skip مشترک، اندازه‌ی متفاوت)
    const faNum = (v: number) => v.toLocaleString('fa-IR')
    const warnings = [
      staffSectionNotice('فاکتورهای فروش', pages.invoices, invoices.length, faNum).warning,
      staffSectionNotice('برگشت‌ها و تعویض‌ها', pages.returns, returns.length, faNum).warning,
      staffSectionNotice('درخواست‌های کارت‌به‌کارت', pages.cardTransfers, transfers.length, faNum).warning,
      staffSectionNotice('مصرف اعتبار خرید', pages.creditRedemptions, creditRedemptions.length, faNum).warning,
      requestedTake > take
        ? `تعداد درخواستی از ظرفیت هر صفحه بیشتر بود؛ حداکثر ${take.toLocaleString('fa-IR')} ردیف در هر صفحه نمایش داده می‌شود.`
        : null
    ].filter((x): x is string => Boolean(x))

    return {
      invoices: invoices.map((i) => ({
        id: i.id,
        receiptNo: i.receiptNo,
        dateJalali: i.issuedAtJalali,
        grandTotal: i.grandTotal,
        discountTotal: i.discountTotal,
        discountPercent: invoiceDiscountPercent({
          goodsTotal: i.goodsTotal,
          discountTotal: i.discountTotal,
          taxTotal: i.taxTotal,
          serviceCharge: i.serviceCharge,
          deliveryFee: i.deliveryFee
        }),
        orderType: i.orderType,
        status: i.status,
        shiftName: i.shift?.name ?? null,
        userName: userLabel(i.user)
      })),
      returns: returns.map((r) => ({
        id: r.id,
        kind: r.kind,
        receiptNo: r.invoice?.receiptNo ?? null,
        total: r.total,
        dateJalali: r.returnedAtJalali,
        time: r.returnedAtTime,
        refundMethod: r.refundMethod,
        refundAmount: r.refundAmount,
        exchangeTotal: r.exchangeTotal,
        exchangeDiff: r.exchangeDiff,
        exchangeSettlement: r.exchangeSettlement,
        /** گزارش عملکرد هرگز کد قابل‌مصرف ندارد. */
        storeCreditReference: r.storeCreditId ? `اعتبار #${r.storeCreditId}` : null,
        shiftName: returnMaps.shiftOf(r.shiftId)?.name ?? null
      })),
      cardTransfers: transfers.map((t) => ({
        id: t.id,
        kind: t.kind,
        status: t.status,
        amount: t.amount,
        paidAmount: t.paidAmount,
        sourceReceiptNo: t.sourceReceiptNo,
        dateJalali: t.createdAtJalali,
        time: t.createdAtTime
      })),
      creditRedemptions: creditRedemptions.map((c) => ({
        ...c,
        /** شناسهٔ ردیف مصرف برای ردیابی است، نه بارکد اعتبار. */
        storeCreditReference: `مصرف اعتبار #${c.id}`
      })),
      pages,
      warnings
    }
  },

  /**
   * بند ۳ — فاکتورهایی با درصد تخفیف بالاتر از «آستانه‌ی تخفیف غیرعادی».
   * آستانه از همان `accountingPolicy` تنظیمات می‌آید و درصد هر فاکتور با
   * `invoiceDiscountPercent` (یعنی همان `calculateInvoiceTotals`) حساب می‌شود.
   */
  async abnormalDiscounts(
    filter: { fromJalali?: string; toJalali?: string; userId?: number | null; threshold?: number | null } = {}
  ) {
    const policy = await settingsService.accountingPolicy()
    const threshold =
      filter.threshold == null || !Number.isFinite(Number(filter.threshold))
        ? policy.abnormalDiscountPercent
        : Math.max(0, Math.min(100, Math.round(Number(filter.threshold))))

    const issuedAt = reportRange(filter)
    const userId = filter.userId == null || filter.userId === 0 ? null : Number(filter.userId)

    // آستانه‌ی صفر = خاموش؛ عمداً گزارش خالی، نه «همه‌ی فاکتورها غیرعادی»
    if (threshold <= 0) return { threshold, rows: [], disabled: true }

    const invoices = await prisma.saleInvoice.findMany({
      where: { ...(issuedAt ? { issuedAt } : {}), ...(userId ? { userId } : {}), discountTotal: { gt: 0 }, voidedAt: null, ...STAFF_INVOICE_STATUS_GATE },
      select: SALE_SELECT,
      orderBy: { id: 'desc' }
    })

    const rows = invoices
      .map((i) => ({
        id: i.id,
        receiptNo: i.receiptNo,
        dateJalali: i.issuedAtJalali,
        userId: i.userId,
        userName: userLabel(i.user) ?? 'نامشخص',
        shiftName: i.shift?.name ?? null,
        goodsTotal: i.goodsTotal,
        discountTotal: i.discountTotal,
        grandTotal: i.grandTotal,
        discountPercent: invoiceDiscountPercent({
          goodsTotal: i.goodsTotal,
          discountTotal: i.discountTotal,
          taxTotal: i.taxTotal,
          serviceCharge: i.serviceCharge,
          deliveryFee: i.deliveryFee
        })
      }))
      .filter((r) => r.discountPercent > threshold)
      .sort((a, b) => b.discountPercent - a.discountPercent)

    return { threshold, rows, disabled: false }
  },

  /**
   * بند ۶ — «تراکنش‌های خارج از بازه‌ی شیفت».
   *
   * فقط وقتی معنی دارد که چک‌باکس «تعیین شیفت بر اساس ساعت» روشن باشد؛ در حالت
   * شماره‌گذاری خودکار، «بازه‌ی ساعتی» وجود ندارد که چیزی بیرونش بیفتد، پس
   * عمداً هیچ ردیفی برنمی‌گردد و خودِ گزارش می‌گوید چرا خالی است.
   */
  async outOfShift(filter: { fromJalali?: string; toJalali?: string } = {}) {
    const shift = await settingsService.shiftConfig()
    if (!shift.byTime)
      return {
        byTime: false,
        windows: [],
        rows: [],
        note:
          'چک‌باکس «تعیین شیفت بر اساس ساعت» خاموش است، پس بازه‌ی ساعتی‌ای وجود ندارد که ' +
          'تراکنشی بیرونش بیفتد. این هشدار فقط در حالت شیفت ساعتی معنی دارد.'
      }

    const windows = (shift.templates ?? []).map((t) => ({
      name: t.name,
      label: shiftWindowLabel(t),
      startTime: t.startTime,
      endTime: t.endTime
    }))
    const range = reportRange(filter)

    const invoices = await prisma.saleInvoice.findMany({
      where: { ...(range ? { issuedAt: range } : {}), voidedAt: null, ...STAFF_INVOICE_STATUS_GATE },
      select: {
        id: true,
        receiptNo: true,
        issuedAt: true,
        issuedAtJalali: true,
        grandTotal: true,
        orderType: true,
        shift: { select: { name: true, sessionSeq: true, nameOverridden: true } },
        user: { select: { displayName: true, username: true } }
      },
      orderBy: { id: 'desc' }
    })
    const returns = await prisma.saleReturn.findMany({
      where: range
        ? { returnedAt: range, voidedAt: null, invoice: STAFF_INVOICE_STATUS_GATE }
        : { voidedAt: null, invoice: STAFF_INVOICE_STATUS_GATE },
      select: {
        id: true,
        kind: true,
        total: true,
        returnedAt: true,
        returnedAtJalali: true,
        returnedAtTime: true,
        userId: true,
        shiftId: true,
        invoice: { select: { receiptNo: true } },
        // SaleReturn عمداً فقط کلیدهای scalar نگه می‌دارد؛ lookup پایین نام‌ها را می‌آورد.
      },
      orderBy: { id: 'desc' }
    })
    const returnMaps = await returnLookups(returns)

    /**
     * ⚠️ `findShiftSlot` یک **Date** می‌گیرد، نه رشته‌ی «HH:MM». نسخه‌ی قبلی رشته را
     * مستقیم پاس می‌داد، پس هم typecheck می‌شکست و هم — چون `at.getHours()` روی یک
     * رشته وجود ندارد — عملاً هیچ‌وقت درست کار نمی‌کرد. ساعت را روی یک تاریخ ثابت
     * می‌نشانیم؛ فقط ساعت و دقیقه مهم است و خود `findShiftSlot` هم همان دو را
     * می‌خواند.
     */
    const clockToDate = (clock: string): Date | null => {
      const m = /^(\d{1,2}):(\d{2})/.exec(String(clock ?? '').trim())
      if (!m) return null
      const h = Number(m[1])
      const min = Number(m[2])
      if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null
      const d = new Date(2000, 0, 1, h, min, 0, 0)
      return d
    }
    /**
     * بند ۹ — اگر مدیر افست دستی «ساعت رسمی» گذاشته باشد، همان افست روی ساعت
     * مقایسه‌شده هم اعمال می‌شود تا این گزارش با تشخیص شیفت یک زبان داشته باشد.
     * افست صفر (پیش‌فرض) ⇒ رفتار مو‌به‌موی قبل.
     */
    const timeCfg = await settingsService.officialTime()
    const officialClock = (clock: string): Date | null => {
      const at = clockToDate(clock)
      return at ? applyOfficialOffset(at, timeCfg) : null
    }

    /** منطق قبلی، دست‌نخورده: ساعت ثبت در هیچ‌کدام از بازه‌های تعریف‌شده نیست. */
    const outside = (clock: string): boolean => {
      const at = officialClock(clock)
      // ساعت ناخوانا ⇒ «بیرون از بازه» اعلام نمی‌شود (اتهام بی‌دلیل ممنوع)
      if (!at) return false
      return findShiftSlot(shift, at) == null
    }

    /**
     * =================== جلسه ۱۹ · تضمین صریح سند ===================
     * این گزارش «بر اساس نام نهاییِ نشست در مقابل ساعت واقعی رخداد هر تراکنش»
     * کار می‌کند. یعنی **override کردن نام نشست، این هشدار را خاموش نمی‌کند**:
     * اگر ساعت واقعی یک فروش با بازه‌ی ساعتیِ نام نهاییِ نشستش نخواند، همچنان
     * همین‌جا دیده می‌شود — حتی وقتی آن ساعت داخل بازه‌ی یک شیفت *دیگر* است.
     *
     * نامِ نشستی که در تنظیمات فعلی هیچ بازه‌ای ندارد (مثلاً شیفتی که مدیر
     * بعداً حذفش کرده)، بی‌دلیل متهم نمی‌شود.
     */
    const mismatch = (shiftName: string | null | undefined, clock: string): boolean => {
      const at = officialClock(clock)
      if (!at) return false
      const found = findShiftTemplate(shift, shiftName ?? null)
      if (!found) return false
      return !isWithinTemplate(found.template, at)
    }

    const windowOf = (shiftName: string | null | undefined): string | null => {
      const found = findShiftTemplate(shift, shiftName ?? null)
      return found ? shiftWindowLabel(found.template) : null
    }

    const REASONS = {
      NO_WINDOW: 'ساعت ثبت در هیچ بازه‌ی تعریف‌شده‌ای نیست',
      SESSION_MISMATCH: 'ساعت ثبت با بازه‌ی نام نهاییِ نشست نمی‌خواند'
    } as const

    const decorate = <T extends { time: string; shiftName: string | null }>(r: T) => {
      const noWindow = outside(r.time)
      const reason: keyof typeof REASONS | null = noWindow
        ? 'NO_WINDOW'
        : mismatch(r.shiftName, r.time)
          ? 'SESSION_MISMATCH'
          : null
      return reason ? { ...r, reason, reasonLabel: REASONS[reason], sessionWindow: windowOf(r.shiftName) } : null
    }
    const keep = <T>(x: T | null): x is T => x != null

    const rows = [
      ...invoices
        .map((i) => ({
          kind: 'SALE' as const,
          kindLabel: 'فروش',
          id: i.id,
          receiptNo: i.receiptNo,
          amount: i.grandTotal,
          dateJalali: i.issuedAtJalali,
          time: clockOf(null, i.issuedAt),
          shiftName: i.shift?.name ?? null,
          sessionLabel: i.shift?.name ? sessionLabelOf(i.shift.name, i.shift.sessionSeq ?? 1) : null,
          nameOverridden: !!i.shift?.nameOverridden,
          userName: userLabel(i.user) ?? 'نامشخص'
        }))
        .map(decorate)
        .filter(keep),
      ...returns
        .map((r) => ({
          kind: r.kind === 'EXCHANGE' ? ('EXCHANGE' as const) : ('RETURN' as const),
          kindLabel: r.kind === 'EXCHANGE' ? 'تعویض کالا' : 'برگشت از فروش',
          id: r.id,
          receiptNo: r.invoice?.receiptNo ?? null,
          amount: r.total,
          dateJalali: r.returnedAtJalali,
          time: clockOf(r.returnedAtTime, r.returnedAt),
          shiftName: returnMaps.shiftOf(r.shiftId)?.name ?? null,
          sessionLabel: returnMaps.shiftOf(r.shiftId)?.name
            ? sessionLabelOf(returnMaps.shiftOf(r.shiftId)!.name, returnMaps.shiftOf(r.shiftId)!.sessionSeq ?? 1)
            : null,
          nameOverridden: !!returnMaps.shiftOf(r.shiftId)?.nameOverridden,
          userName: userLabel(returnMaps.userOf(r.userId)) ?? 'نامشخص'
        }))
        .map(decorate)
        .filter(keep)
    ].sort((a, b) => (a.dateJalali ?? '').localeCompare(b.dateJalali ?? '') || a.time.localeCompare(b.time))

    return {
      byTime: true,
      windows,
      rows,
      note:
        'این فهرست هیچ قضاوتی نمی‌کند: فقط تراکنش‌هایی را نشان می‌دهد که ساعت ثبتشان در ' +
        'هیچ‌کدام از بازه‌های ساعتی تعریف‌شده‌ی شیفت‌ها نیفتاده است، یا با بازه‌ی ساعتیِ ' +
        '«نام نهاییِ نشستی» که زیرش ثبت شده‌اند نمی‌خواند. ' +
        'توجه: override کردن نام یک نشست، این هشدار را برای تراکنش‌های داخل آن نشست خاموش نمی‌کند.'
    }
  }
}
