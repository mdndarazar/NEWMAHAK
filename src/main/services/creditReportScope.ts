/**
 * ===========================================================================
 * ممیزی A97-01 — «مالک رویدادِ صدور اعتبار» و «هویت فاکتور» برای فیلترهای گزارش.
 *
 * نشست ۹۷/۹۸ فیلترهای نوار گزارش را به تب legacy اعتبار رساند، ولی کارمند/شیفت
 * را روی *فاکتور* صدور (sourceInvoiceId / exchangeInvoiceId / فاکتورِ برگشت) زد،
 * shiftNumber را نادیده گرفت و دروازه‌ی DRAFT/CANCELED را نداشت. پیامد: اعتبارِ
 * برگشتی که کارمند شیفت شب روی فاکتور شیفت صبح صادر کرد در تب شیفت صبح می‌آمد
 * (و اعتبار تعویض در هر دو شیفت: یک‌بار از مسیر فاکتور اصلی، یک‌بار از سند تعویض)،
 * در حالی که بلوک برگشت سرجمع همان اعتبار را برای شیفت شب می‌شمرد.
 *
 * قاعده (AUDIT-D27، هم‌خانواده‌ی D19/D24):
 *   • مالک اعتبارِ دارای returnId = خودِ سند برگشت/تعویض (SaleReturn.userId/shiftId).
 *   • مالک اعتبار بدون سند برگشت (اضافه‌دریافت، دستی) = صادرکننده (StoreCredit.userId)
 *     و نشستی که در لحظه‌ی *ثبت واقعی* (createdAt، غیرقابل جعل) باز بود. ستون
 *     shiftId روی StoreCredit نیست؛ چون هیچ عملیات مالی بدون نشست باز مجاز نیست
 *     (بند ۴-۱) و نشست‌ها پشت‌سرهم‌اند، نشستِ بازِ آن لحظه یکتاست.
 *   • شماره فیش/مشتری/کالا/کانال/نوع سفارش/وضعیت روی فاکتورهای مرتبط (هر کدام
 *     منطبق بود کافی است)؛ دروازه‌ی voidedAt/DRAFT/CANCELED همیشه روی آن‌ها.
 *   • اعتبار بی‌فاکتور (دستی) با فیلتر هویتی فاکتور نمی‌آید، با فیلتر مالک می‌آید.
 *
 * این ماژول عمداً فقط به prisma و shared وابسته است تا هم StoreCreditService (تب)
 * و هم accountingReport (پل تطبیق) یک منطق مصرف کنند: «یک فیلتر، یک عدد».
 * ===========================================================================
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '../db/client'
import { BusinessError } from '../errors'
import { orderTypesForChannels, SaleStatus } from '@shared/enums'
import { withAndClause } from '@shared/credit'

export interface CreditReportScopeFilter {
  orderType?: string | null
  channels?: readonly string[] | null
  receiptNo?: number | null
  customerSearch?: string | null
  customerId?: number | null
  productSearch?: string | null
  /** وضعیت *فاکتور* (نوار گزارش)، نه وضعیت اعتبار */
  invoiceStatus?: string | null
  userId?: number | null
  shiftId?: number | null
  shiftNumber?: number | string | null
}

const IN_CHUNK = 500
/** سقف امن شناسه در `IN` نهایی؛ زیر سقف ۳۲٬۷۶۶ متغیر SQLite. */
export const CREDIT_SCOPE_MAX_IDS = 30000
const EXCLUDED_INVOICE_STATUSES = [SaleStatus.DRAFT, SaleStatus.CANCELED] as string[]

function chunks(ids: Iterable<number>): number[][] {
  const uniq = [...new Set([...ids].filter((x) => Number.isFinite(x) && x > 0))]
  const out: number[][] = []
  for (let i = 0; i < uniq.length; i += IN_CHUNK) out.push(uniq.slice(i, i + IN_CHUNK))
  return out
}

/** همان اعتبارسنجی reportShiftNumber (A72-01): فقط عدد صحیح مثبت. */
export function creditScopeShiftNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n <= 0) throw new BusinessError('شماره‌ی نشست گزارش نامعتبر است؛ یک عدد صحیح مثبت وارد کنید.')
  return n
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : null
}

/** شرط هویتی فاکتور؛ null یعنی هیچ فیلتر هویتی فعال نیست. */
export function creditIdentityInvoiceWhere(f: CreditReportScopeFilter): Prisma.SaleInvoiceWhereInput | null {
  const channels = orderTypesForChannels(f.channels ?? null)
  const pickedOrderType = String(f.orderType ?? '').trim()
  const productSearch = String(f.productSearch ?? '').trim()
  const customerSearch = String(f.customerSearch ?? '').trim()
  const invoiceStatus = String(f.invoiceStatus ?? '').trim()
  const receiptNo = intOrNull(f.receiptNo)
  const customerId = intOrNull(f.customerId)
  const has =
    channels !== null || !!pickedOrderType || receiptNo != null || customerId != null || !!productSearch || !!customerSearch || !!invoiceStatus
  if (!has) return null
  const where: Prisma.SaleInvoiceWhereInput = {
    ...(receiptNo != null ? { receiptNo } : {}),
    ...(customerId != null ? { customerId } : {}),
    ...(customerSearch ? { customer: { name: { contains: customerSearch } } } : {}),
    ...(invoiceStatus ? { status: invoiceStatus } : {}),
    ...(productSearch
      ? {
          items: {
            some: {
              OR: [
                { variant: { barcode: { contains: productSearch } } },
                { variant: { code: { contains: productSearch } } },
                { variant: { product: { name: { contains: productSearch } } } },
                { variantName: { contains: productSearch } },
                { variantCode: { contains: productSearch } }
              ]
            }
          }
        }
      : {})
  }
  if (channels !== null) {
    where.orderType = pickedOrderType ? (channels.includes(pickedOrderType) ? pickedOrderType : { in: [] }) : { in: channels }
  } else if (pickedOrderType) {
    where.orderType = pickedOrderType
  }
  return where
}

export function hasCreditReportScope(f: CreditReportScopeFilter): boolean {
  return (
    creditIdentityInvoiceWhere(f) !== null ||
    intOrNull(f.userId) != null ||
    intOrNull(f.shiftId) != null ||
    creditScopeShiftNumber(f.shiftNumber) != null
  )
}

/**
 * شناسه‌ی اعتبارهای منطبق با فیلتر گزارش؛ null = هیچ فیلتری فعال نیست (رفتار
 * بدون فیلتر دست‌نخورده). `baseWhere` قیدهای خود اعتبار (بازه/وضعیت/...) است.
 * `opts.cap` = سقف شناسه؛ عبور ⇒ خطای فارسی (مگر `opts.overCap = 'return'`).
 */
export async function creditIdsForReportScope(
  f: CreditReportScopeFilter,
  baseWhere: any,
  opts: { overCap?: 'throw' | 'return' } = {}
): Promise<number[] | null> {
  const identity = creditIdentityInvoiceWhere(f)
  const userId = intOrNull(f.userId)
  const shiftId = intOrNull(f.shiftId)
  const shiftNumber = creditScopeShiftNumber(f.shiftNumber)
  const hasOwner = userId != null || shiftId != null || shiftNumber != null
  if (!identity && !hasOwner) return null

  /** نشست‌های مجاز فیلتر (shiftId ∩ shiftNumber، مثل A72-01)؛ null = بی‌قید شیفت. */
  let allowedShifts: Set<number> | null = null
  if (shiftNumber != null) {
    const rows = await prisma.shift.findMany({
      where: { number: shiftNumber, ...(shiftId != null ? { id: shiftId } : {}) },
      select: { id: true }
    })
    allowedShifts = new Set(rows.map((r) => Number(r.id)))
  } else if (shiftId != null) {
    allowedShifts = new Set([shiftId])
  }

  const candidates = await prisma.storeCredit.findMany({
    where: identity
      ? withAndClause(baseWhere ?? {}, {
          OR: [{ sourceInvoiceId: { not: null } }, { exchangeInvoiceId: { not: null } }, { returnId: { not: null } }]
        })
      : baseWhere ?? {},
    select: { id: true, sourceInvoiceId: true, exchangeInvoiceId: true, returnId: true, userId: true, createdAt: true }
  })
  if (!candidates.length) return []

  // سند برگشت/تعویض زنده (مالک رویداد + فاکتور مرجع)
  const returns = new Map<number, { invoiceId: number; userId: number | null; shiftId: number | null }>()
  for (const chunk of chunks(candidates.map((c) => Number(c.returnId)))) {
    const rets = await prisma.saleReturn.findMany({
      where: { id: { in: chunk }, voidedAt: null },
      select: { id: true, invoiceId: true, userId: true, shiftId: true }
    })
    for (const r of rets)
      returns.set(Number(r.id), {
        invoiceId: Number(r.invoiceId),
        userId: r.userId == null ? null : Number(r.userId),
        shiftId: r.shiftId == null ? null : Number(r.shiftId)
      })
  }

  const linkedInvoices = (c: any): number[] => {
    const out: number[] = []
    if (c.sourceInvoiceId != null) out.push(Number(c.sourceInvoiceId))
    if (c.exchangeInvoiceId != null) out.push(Number(c.exchangeInvoiceId))
    const ret = c.returnId != null ? returns.get(Number(c.returnId)) : undefined
    if (ret) out.push(ret.invoiceId)
    return out
  }

  // دروازه‌ی فاکتور: زنده و نه DRAFT/CANCELED (+ هویت اگر فعال است)
  const gateWhere: Prisma.SaleInvoiceWhereInput = {
    voidedAt: null,
    ...(String(f.invoiceStatus ?? '').trim() ? {} : { status: { notIn: EXCLUDED_INVOICE_STATUSES } }),
    ...(identity ?? {})
  }
  const passing = new Set<number>()
  for (const chunk of chunks(candidates.flatMap(linkedInvoices))) {
    const rows = await prisma.saleInvoice.findMany({ where: { AND: [gateWhere, { id: { in: chunk } }] }, select: { id: true } })
    for (const r of rows) passing.add(Number(r.id))
  }

  // نشست باز در لحظه‌ی ثبت اعتبارِ بدون سند برگشت (فقط اگر فیلتر شیفت فعال است)
  const sessionAt = new Map<number, number | null>()
  if (allowedShifts) {
    const loose = candidates.filter((c) => c.returnId == null)
    if (loose.length) {
      const times = loose.map((c) => new Date(c.createdAt as any).getTime()).filter(Number.isFinite)
      const minT = Math.min(...times)
      const maxT = Math.max(...times)
      const shifts = await prisma.shift.findMany({
        where: { openedAt: { lte: new Date(maxT) }, OR: [{ closedAt: null }, { closedAt: { gte: new Date(minT) } }] },
        select: { id: true, openedAt: true, closedAt: true },
        orderBy: { openedAt: 'desc' }
      })
      for (const c of loose) {
        const t = new Date(c.createdAt as any).getTime()
        const hit = shifts.find((s) => {
          const o = new Date(s.openedAt as any).getTime()
          const cl = s.closedAt == null ? Infinity : new Date(s.closedAt as any).getTime()
          return o <= t && t <= cl
        })
        sessionAt.set(Number(c.id), hit ? Number(hit.id) : null)
      }
    }
  }

  const ids: number[] = []
  for (const c of candidates) {
    const links = linkedInvoices(c)
    const hadLink = c.sourceInvoiceId != null || c.exchangeInvoiceId != null || c.returnId != null
    if (hadLink) {
      // سند برگشتِ باطل ⇒ اعتبار از هیچ فیلتری نمی‌آید (همان رفتار نشست ۹۸)
      if (c.returnId != null && !returns.has(Number(c.returnId))) continue
      if (!links.some((id) => passing.has(id))) continue
    } else if (identity) {
      continue
    }
    const ret = c.returnId != null ? returns.get(Number(c.returnId)) : undefined
    const ownerUser = ret ? ret.userId : c.userId == null ? null : Number(c.userId)
    const ownerShift = ret ? ret.shiftId : sessionAt.get(Number(c.id)) ?? null
    if (userId != null && ownerUser !== userId) continue
    if (allowedShifts && (ownerShift == null || !allowedShifts.has(ownerShift))) continue
    ids.push(Number(c.id))
  }

  if (ids.length > CREDIT_SCOPE_MAX_IDS && opts.overCap !== 'return') {
    throw new BusinessError(
      `تعداد اعتبارهای منطبق با این فیلتر (${ids.length.toLocaleString('fa-IR')} مورد) بیش از ظرفیت یک گزارش (${CREDIT_SCOPE_MAX_IDS.toLocaleString('fa-IR')} مورد) است؛ بازه‌ی تاریخ یا فیلتر را محدودتر کنید تا هیچ ردیفی بی‌صدا حذف نشود.`
    )
  }
  return ids
}
