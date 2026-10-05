import { prisma } from '../db/client'
import { toJalaliDate, toClock, jalaliToDateTime, faDigits, isValidJalaliDate, toLatinDigits, jalaliToday } from '@shared/jalali'
import { AuditAction } from '@shared/enums'
import { calculateStockDiscrepancies } from '@shared/accounting'
import { expectedPhysicalQty } from '@shared/pendingRestock'
import { jalaliRange } from './CardTransferService'
import { pendingRestockService } from './PendingRestockService'
import { reportDayInput } from './reportDate'
import { BusinessError } from '../errors'
import type { PagedRows, SaleReportPage } from '@shared/types'

/**
 * ===========================================================================
 * جلسه ۱۷ · بند ۴ — «شمارش فیزیکی دوره‌ای انبار» و گزارش «مغایرت نیازمند بررسی».
 *
 * چرا دو زیربخش با هم؟ چون گزارش مغایرت بدون یک عدد *واقعیِ شمارش‌شده* هیچ
 * معنایی ندارد: تا امروز برنامه فقط موجودی سیستمی را می‌دانست و هیچ عددی برای
 * مقایسه وجود نداشت.
 *
 * ⚠️ این ماژول **موجودی را تغییر نمی‌دهد**. یک شمارش، یک *سند مشاهده* است نه یک
 * اصلاح انبار؛ اگر خودش موجودی را هم درست می‌کرد، همان مغایرتی که باید دیده شود
 * بی‌صدا پاک می‌شد. اصلاح موجودی همان مسیر همیشگی خودش را دارد (پنل کالاها).
 * ===========================================================================
 */
/**
 * جلسه ۴۱ · کار ب — «این ردیف اختلاف دارد؟»، یک جا و برای هر سه مصرف‌کننده
 * (`submit`، `list`، `get`).
 *
 * شمارش را با **موجودی فیزیکیِ مورد انتظار** می‌سنجد، نه با موجودی سیستمی:
 * کالای معلقِ برگشتی فیزیکی روی قفسه هست ولی در موجودی قابل‌فروش نیست، پس
 * شمردنش نباید یک «اضافه»ی کاذب بسازد. برای هر ردیفِ بی‌معلق (`pending = 0`،
 * یعنی تمام داده‌ی قبلِ جلسه ۴۰) عیناً همان شرط قدیمی `diffQty !== 0` است.
 */
function countMismatches(row: { countedQty?: number | null; systemQty?: number | null; pendingRestockQty?: number | null }): boolean {
  const counted = Math.round(Number(row.countedQty) || 0)
  const expected = expectedPhysicalQty(
    Math.round(Number(row.systemQty) || 0),
    Math.max(0, Math.round(Number(row.pendingRestockQty) || 0))
  )
  return counted !== expected
}

const STOCK_COUNT_PAGE_MAX = 5000
const STOCK_COUNT_IN_CHUNK = 500

function chunksOf<T>(values: T[], size = STOCK_COUNT_IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size))
  return out
}

async function productVariantsByIds(client: any, ids: number[]) {
  const rows: any[] = []
  for (const chunk of chunksOf(ids)) {
    rows.push(
      ...(await client.productVariant.findMany({
        where: { id: { in: chunk } },
        select: { id: true, code: true, stock: true, size: true, color: true, product: { select: { name: true } } }
      }))
    )
  }
  return rows
}

function stockCountPage(rawTake: unknown, rawSkip: unknown, totalCount: number, fallbackTake: number): SaleReportPage {
  const parsedTake = Math.round(Number(rawTake ?? fallbackTake))
  const parsedSkip = Math.round(Number(rawSkip ?? 0))
  return {
    skip: Math.max(Number.isFinite(parsedSkip) ? parsedSkip : 0, 0),
    take: Math.min(Math.max(Number.isFinite(parsedTake) ? parsedTake : fallbackTake, 1), STOCK_COUNT_PAGE_MAX),
    totalCount,
    truncated: false
  }
}

function attachStockCountPage<T>(rows: T[], page: SaleReportPage, noun: string): PagedRows<T> {
  page.truncated = page.totalCount > page.skip + rows.length
  const warnings = page.truncated
    ? [`نمایش ${faDigits(rows.length)} از ${faDigits(page.totalCount)} ${noun}؛ برای دیدن همه‌ی ${noun} صفحه‌ی بعد را بگیرید.`]
    : []
  return Object.assign(rows, { page, warnings }) as PagedRows<T>
}

export const stockCountService = {
  /** کالاهای فعال + موجودی سیستمیِ همین لحظه، برای پر کردن فرم شمارش. */
  async variants(params: { search?: string | null; take?: number; skip?: number } = {}) {
    const search = (params.search ?? '').trim()
    const where = {
        isActive: true,
        ...(search
          ? {
              OR: [
                { barcode: { contains: search } },
                { code: { contains: search } },
                { product: { name: { contains: search } } }
              ]
            }
          : {})
      }
    const totalCount = await prisma.productVariant.count({ where })
    const page = stockCountPage(params.take, params.skip, totalCount, 300)
    const rows = await prisma.productVariant.findMany({
      where,
      select: {
        id: true,
        code: true,
        barcode: true,
        stock: true,
        size: true,
        color: true,
        product: { select: { name: true, unit: true } }
      },
      orderBy: { id: 'desc' },
      skip: page.skip,
      take: page.take
    })
    const shaped = rows.map((v) => ({
      variantId: v.id,
      code: v.code ?? '',
      barcode: v.barcode ?? '',
      name: `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`,
      unit: v.product?.unit ?? 'عدد',
      systemQty: Math.round(v.stock ?? 0)
    }))
    return attachStockCountPage(shaped, page, 'کالا')
  },

  /**
   * ثبت یک جلسه‌ی شمارش. موجودی سیستمیِ همان لحظه برای هر کالا از دیتابیس
   * خوانده و snapshot می‌شود (نه از عددی که renderer فرستاده)، پس هیچ‌کس نمی‌تواند
   * با دست‌کاری سمت کلاینت مغایرت را صفر نشان دهد.
   */
  async submit(input: {
    dateJalali?: string | null
    note?: string | null
    userId?: number | null
    userName?: string | null
    items: { variantId: number; countedQty: number; note?: string | null }[]
  }) {
    const items = (input?.items ?? []).filter((i) => Number(i?.variantId) > 0)
    if (!items.length) throw new Error('برای ثبت شمارش، حداقل یک کالا با تعداد شمارش‌شده وارد کنید.')
    /**
     * نشست ۱۴۳ · بند ۳ و ۴-۴۲ — تعداد شمارش‌شده هرگز بی‌صدا به صفر/عدد گرد تبدیل
     * نمی‌شود. قبلاً «۵» با رقم فارسی (NaN) یا خانه‌ی خالی به ۰ تبدیل می‌شد و
     * «کسری کاذب» کامل همان کالا در انبارگردانی ثبت می‌شد؛ ۲٫۶ هم ۳ می‌شد.
     */
    for (const i of items) {
      const vid = (i as any).variantId
      if (typeof vid !== 'number' || !Number.isSafeInteger(vid))
        throw new Error(`شناسه‌ی کالای «${String(vid)}» در شمارش معتبر نیست؛ آن ردیف را دوباره انتخاب کنید. هیچ شمارشی ثبت نشد.`)
      const q = (i as any).countedQty
      if (typeof q !== 'number' || !Number.isSafeInteger(q) || q < 0)
        throw new Error(
          `تعداد شمارش‌شده‌ی کالای ${faDigits(vid)} باید عدد صحیح صفر یا بیشتر (عدد) باشد؛ مقدار «${String(q)}» پذیرفته نیست ` +
            '(خالی، اعشار، منفی یا متن به صفر/عدد دیگر تبدیل نمی‌شود تا کسری کاذب ساخته نشود). هیچ شمارشی ثبت نشد.'
        )
    }

    let countedAt = new Date()
    if (input.dateJalali) {
      /**
       * ممیزی A120-01 (AUDIT-D57) — تاریخ شمارش در main سنجیده می‌شود: jalaliToDateTime «۱۴۰۵/۱۳/۰۱»
       * را بی‌صدا ۱۴۰۶/۰۱/۰۲ می‌گرفت و تاریخ آینده پذیرفته می‌شد. چون مغایرت «آخرین شمارش» را با
       * بیشترین countedAt برمی‌دارد (D52)، شمارش آینده‌دار همه‌ی شمارش‌های واقعی را تا آن روز پنهان
       * می‌کرد. گذشته‌نگر مجاز است (انبارگردانی دیرثبت‌شده)، آینده نه.
       */
      const raw = toLatinDigits(String(input.dateJalali)).trim()
      if (!isValidJalaliDate(raw))
        throw new Error(`تاریخ شمارش معتبر نیست («${String(input.dateJalali)}»؛ قالب صحیح: ۱۴۰۵/۰۶/۲۵). هیچ شمارشی ثبت نشد.`)
      const clean = raw.split('/').map((x, i) => (i === 0 ? String(Number(x)) : String(Number(x)).padStart(2, '0'))).join('/')
      const todayJalali = jalaliToday()
      if (clean > todayJalali)
        throw new Error(
          `تاریخ شمارش (${faDigits(clean)}) نمی‌تواند بعد از امروز (${faDigits(todayJalali)}) باشد؛ شمارش آینده‌دار ` +
            'شمارش‌های واقعی بعدی را در گزارش مغایرت پنهان می‌کند. هیچ شمارشی ثبت نشد.'
        )
      try {
        countedAt = jalaliToDateTime(clean)
      } catch {
        throw new Error('تاریخ شمارش معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵).')
      }
    }
    const now = new Date()

    return prisma.$transaction(async (tx) => {
      const variantIds = [...new Set(items.map((i) => Number(i.variantId)))]
      const variants = await productVariantsByIds(tx, variantIds)
      const vmap = new Map(variants.map((v) => [v.id, v]))

      /**
       * جلسه ۴۱ · کار ب — «معلق برگشتی» در همین لحظه، **snapshot** می‌شود.
       *
       * چرا snapshot و نه محاسبه در لحظه‌ی نمایش؟ چون معلق‌ها فردا با پرداخت
       * مدیر آزاد می‌شوند و عددِ بازمحاسبه‌شده دیگر آن چیزی نیست که آن روز روی
       * قفسه بود — همان دلیلی که `systemQty` هم snapshot است. بدون این، گزارش
       * مغایرتِ دیروز فردا خودش را عوض می‌کرد.
       *
       * ⚠️ `diffQty` عمداً دست‌نخورده می‌ماند (`countedQty − systemQty`): همان
       * عددِ خامِ تاریخیِ ستون است و هیچ گزارش قدیمی نباید تکان بخورد. مغایرتِ
       * *واقعی* (با احتساب معلق) در `calculateStockDiscrepancies` و روی
       * `diffAtCountWithPending` حساب می‌شود، نه اینجا.
       */
      const pendingMap = await pendingRestockService.byVariant(tx)

      const rows = items.map((i) => {
        const v = vmap.get(Number(i.variantId))
        const systemQty = Math.round(v?.stock ?? 0)
        const countedQty = i.countedQty
        const name = v
          ? `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
          : 'کالای حذف‌شده از سیستم'
        return {
          variantId: Number(i.variantId),
          name,
          code: v?.code ?? null,
          countedQty,
          systemQty,
          diffQty: countedQty - systemQty,
          pendingRestockQty: Math.max(0, Math.round(pendingMap[Number(i.variantId)] ?? 0)),
          note: i.note?.trim() || null
        }
      })

      const session = await tx.stockCountSession.create({
        data: {
          countedAt,
          countedAtJalali: toJalaliDate(countedAt),
          countedAtTime: toClock(now),
          userId: input.userId ?? null,
          userName: input.userName ?? null,
          note: input.note?.trim() || null,
          items: { create: rows }
        },
        include: { items: true }
      })

      /**
       * «مورد اختلاف» = شمارش ≠ موجودی فیزیکیِ *مورد انتظار* (قابل‌فروش + معلق).
       * برای هر ردیفی که معلق ندارد (یعنی همه‌ی داده‌ی قبلی) عیناً همان شرط
       * قبلی است، پس هیچ عددی در سابقه عوض نمی‌شود.
       */
      const mismatched = rows.filter((r) => countMismatches(r))
      const pendingTotal = rows.reduce((s, r) => s + r.pendingRestockQty, 0)
      await tx.auditLog.create({
        data: {
          action: AuditAction.STOCK_COUNT_SUBMIT,
          entity: 'StockCountSession',
          entityId: session.id,
          userId: input.userId ?? null,
          after: JSON.stringify({
            countedAtJalali: session.countedAtJalali,
            itemCount: rows.length,
            mismatchedCount: mismatched.length,
            pendingRestockQty: pendingTotal
          }),
          note:
            `ثبت شمارش فیزیکی انبار · ${faDigits(rows.length)} کالا · ` +
            `${faDigits(mismatched.length)} مورد اختلاف با موجودی فیزیکیِ مورد انتظار · موجودی انبار تغییر نکرد` +
            (pendingTotal > 0
              ? ` · ${faDigits(pendingTotal)} قلم کالای برگشتیِ در انتظار پرداخت مدیر در همین شمارش ثبت (snapshot) شد`
              : '')
        }
      })

      return {
        id: session.id,
        countedAtJalali: session.countedAtJalali,
        countedAtTime: session.countedAtTime,
        itemCount: rows.length,
        mismatchedCount: mismatched.length,
        /** جمع «معلق برگشتی» همین شمارش — برای پیام موفقیت صفحه‌ی انبارگردانی */
        pendingRestockQty: pendingTotal,
        items: session.items
      }
    })
  },

  /** فهرست جلسه‌های شمارش (جدیدترین اول). */
  async list(filter: { fromJalali?: string; toJalali?: string; take?: number; skip?: number } = {}) {
    /**
     * ممیزی A119-03 (AUDIT-D52/D55) — هم‌قاعده‌ی discrepancy: خالی ⇒ بدون قید (سابقه‌ی کامل)، نامعتبر ⇒ خطای فارسی
     * (قبلاً jalaliRange «۱۴۰۵/۱۳/۰۱» را بی‌صدا سال بعد و '' را بدون قید می‌گرفت)، بازه‌ی معکوس ⇒ خطای فارسی (نه فهرست خالی).
     */
    const scope = 'سابقه‌ی جلسه‌های شمارش'
    const fromJalali = reportDayInput(filter.fromJalali, 'از تاریخ', scope)
    const toJalali = reportDayInput(filter.toJalali, 'تا تاریخ', scope)
    const countedAt = jalaliRange(fromJalali, toJalali)
    if (countedAt?.gte && countedAt?.lte && countedAt.gte.getTime() > countedAt.lte.getTime())
      throw new BusinessError(`بازه‌ی ${scope} معکوس است: «از تاریخ» (${fromJalali}) بعد از «تا تاریخ» (${toJalali}) است.`)
    const totalCount = await prisma.stockCountSession.count({ where: countedAt ? { countedAt } : {} })
    const page = stockCountPage(filter.take, filter.skip, totalCount, 200)
    const rows = await prisma.stockCountSession.findMany({
      where: countedAt ? { countedAt } : {},
      orderBy: [{ countedAt: 'desc' }, { id: 'desc' }],
      skip: page.skip,
      take: page.take,
      include: {
        items: { select: { id: true, diffQty: true, countedQty: true, systemQty: true, pendingRestockQty: true } }
      }
    })
    const shaped = rows.map((s) => ({
      id: s.id,
      countedAtJalali: s.countedAtJalali,
      countedAtTime: s.countedAtTime,
      userName: s.userName,
      note: s.note,
      itemCount: s.items.length,
      /** همان قاعده‌ی `submit` (با احتساب معلق) تا دو صفحه دو عدد ندهند. */
      mismatchedCount: s.items.filter((i) => countMismatches(i)).length,
      /** جمع «معلق برگشتیِ» ثبت‌شده در همان شمارش (snapshot) */
      pendingRestockQty: s.items.reduce((sum, i) => sum + Math.max(0, Math.round(i.pendingRestockQty ?? 0)), 0)
    }))
    return attachStockCountPage(shaped, page, 'جلسه‌ی شمارش')
  },

  async get(payload: { id: number }) {
    const id = Number(payload?.id ?? 0)
    const s = await prisma.stockCountSession.findUnique({ where: { id }, include: { items: true } })
    if (!s) throw new Error('این جلسه‌ی شمارش پیدا نشد.')
    return {
      id: s.id,
      countedAtJalali: s.countedAtJalali,
      countedAtTime: s.countedAtTime,
      userName: s.userName,
      note: s.note,
      items: s.items
    }
  },

  /**
   * گزارش «مغایرت نیازمند بررسی» (بند ۴-ب).
   *
   * برای هر کالا سه عدد کنار هم می‌نشیند:
   *   • موجودی سیستمی امروز
   *   • افزایش موجودی ناشی از برگشت/تعویض‌های *ثبت‌شده در همین بازه*
   *   • آخرین عدد شمارش فیزیکی + موجودی سیستمیِ همان لحظه (snapshot)
   *
   * سیستم هیچ‌کس را متهم نمی‌کند و هیچ نتیجه‌ای نمی‌گیرد: فقط شواهد و تفاضل را
   * شفاف نشان می‌دهد. کالایی که هیچ شمارشی ندارد، «بدون شمارش» علامت می‌خورد نه
   * «مغایرت صفر» (وگرنه یک عدد ساختگی به مدیر تحویل داده می‌شد).
   */
  async discrepancy(filter: { fromJalali?: string; toJalali?: string; onlyMismatched?: boolean } = {}) {
    /**
     * ممیزی A117-05 (AUDIT-D52) — تاریخ نامعتبر قبلاً در jalaliRange بی‌صدا حذف می‌شد (بازه‌ی یک‌طرفه/کل تاریخچه) و بازه‌ی
     * معکوس جدول خالی «بدون شمارش» می‌داد. خالی/undefined همان رفتار قبلی (بدون قید در آن طرف = آخرین شمارش کل تاریخچه)،
     * چون «امروز» شمارش ماه قبل را پنهان می‌کرد (ضدسرقت بدتر).
     */
    const scope = 'گزارش مغایرت انبارگردانی'
    const fromJalali = reportDayInput(filter.fromJalali, 'از تاریخ', scope)
    const toJalali = reportDayInput(filter.toJalali, 'تا تاریخ', scope)
    const range = jalaliRange(fromJalali, toJalali)
    if (range?.gte && range?.lte && range.gte.getTime() > range.lte.getTime())
      throw new BusinessError(`بازه‌ی ${scope} معکوس است: «از تاریخ» (${fromJalali}) بعد از «تا تاریخ» (${toJalali}) است.`)

    // افزایش موجودی ناشی از برگشت/تعویض ثبت‌شده در بازه (StockMovement مثبت)
    const movements = await prisma.stockMovement.groupBy({
      by: ['variantId'],
      // نشست ۱۱۷ (S117-5) — StockMovement ستون «at» ندارد؛ نام درست createdAt است (وگرنه خطای validation و کور شدن تب مغایرت با هر بازه)
      where: { reason: 'SALE_RETURN', ...(range ? { createdAt: range } : {}) },
      _sum: { delta: true }
    })
    const returnedBy = new Map(movements.map((m) => [m.variantId, Math.round(m._sum.delta ?? 0)]))

    // آخرین شمارش فیزیکیِ *هر کالا* (تا پایان بازه)
    // نشست ۱۱۷ (S117-5) — قبلاً `take: 20_000` بی‌صدا؛ کالای شمرده‌شده در شمارش‌های قدیمی‌تر حذف می‌شد
    const counts: any[] = []
    for (let skip = 0; ; skip += 5000) {
      const batch = await prisma.stockCountItem.findMany({
        where: range ? { session: { countedAt: range } } : {},
        orderBy: { id: 'desc' },
        include: { session: { select: { countedAt: true, countedAtJalali: true } } },
        skip,
        take: 5000
      })
      counts.push(...batch)
      if (batch.length < 5000) break
    }
    /**
     * ممیزی A117-04 (AUDIT-D52) — «آخرین شمارش» = جدیدترین تاریخ شمارش (countedAt)، سپس جلسه‌ی بعدی، سپس ردیف بعدی؛
     * هم‌قاعده با فهرست جلسه‌ها (countedAt نزولی، id نزولی). قبلاً فقط id ردیف ⇒ شمارش گذشته‌نگرِ دیر ثبت‌شده
     * (submit با dateJalali) کسری جدیدترین شمارش را پنهان می‌کرد.
     */
    const countKey = (c: any) => [new Date(c.session?.countedAt ?? 0).getTime() || 0, Number(c.sessionId) || 0, Number(c.id) || 0]
    const newer = (a: any, b: any) => {
      const ka = countKey(a), kb = countKey(b)
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i]
      return false
    }
    const lastCount = new Map<number, any>()
    for (const c of counts) {
      const cur = lastCount.get(c.variantId)
      if (!cur || newer(c, cur)) lastCount.set(c.variantId, c)
    }

    /**
     * جلسه ۴۱ · کار ب — معلق‌های *همین حالا*.
     *
     * دو مصرف متفاوت و عمداً جدا:
     *   • کالایی که شمارش دارد ⇒ معلقش از **snapshot همان شمارش** خوانده می‌شود
     *     (`c.pendingRestockQty`)، چون مغایرت آن روز باید ثابت بماند.
     *   • کالایی که هیچ شمارشی ندارد ولی الان معلق دارد ⇒ ردیفش **ساخته
     *     می‌شود** (با معلقِ زنده) تا مدیر بداند این کالا فیزیکی روی قفسه هست و
     *     در موجودی قابل‌فروش نیست. `hasCount = false` می‌ماند، پس هیچ عدد
     *     مغایرتی برایش ساخته نمی‌شود — فقط دیده می‌شود.
     */
    const livePending = await pendingRestockService.byVariant()

    const variantIds = [
      ...new Set([
        ...returnedBy.keys(),
        ...lastCount.keys(),
        ...Object.keys(livePending)
          .map((k) => Number(k))
          .filter((id) => id > 0 && (livePending[id] ?? 0) > 0)
      ])
    ]
    if (!variantIds.length) return { rows: [], hasAnyCount: false, pendingRestockQty: 0 }

    const variants = await productVariantsByIds(prisma, variantIds)
    const vmap = new Map(variants.map((v) => [v.id, v]))

    const input = variantIds.map((id) => {
      const v = vmap.get(id)
      const c = lastCount.get(id)
      return {
        variantId: id,
        name: v
          ? `${v.product?.name ?? 'کالا'}${v.size ? ' سایز ' + v.size : ''}${v.color ? ' - ' + v.color : ''}`
          : 'کالای حذف‌شده از سیستم',
        code: v?.code ?? null,
        systemQty: Math.round(v?.stock ?? 0),
        countedQty: c ? c.countedQty : null,
        systemQtyAtCount: c ? c.systemQty : null,
        returnedQty: returnedBy.get(id) ?? 0,
        /** snapshot برای ردیف‌های شمارش‌شده، عدد زنده برای ردیف‌های بی‌شمارش */
        pendingRestockQty: c
          ? Math.max(0, Math.round(c.pendingRestockQty ?? 0))
          : Math.max(0, Math.round(livePending[id] ?? 0)),
        countedAtJalali: c?.session?.countedAtJalali ?? null
      }
    })

    let rows = calculateStockDiscrepancies(input)
    /**
     * ⚠️ ردیف‌های «فقط معلق» (بی‌شمارش) حتی با `onlyMismatched` هم حذف نمی‌شوند:
     * خودِ معلق بودن یک چیزِ نیازمند دیدن است، نه یک مغایرتِ صفر.
     */
    if (filter.onlyMismatched) rows = rows.filter((r) => r.needsReview || r.hasPending)
    rows.sort(
      (a, b) =>
        Math.abs(b.diffAtCountWithPending) - Math.abs(a.diffAtCountWithPending) ||
        b.pendingRestockQty - a.pendingRestockQty ||
        Math.abs(b.diffAtCount) - Math.abs(a.diffAtCount)
    )
    return {
      rows,
      hasAnyCount: lastCount.size > 0,
      /** جمع معلقِ زنده — برای نوار هشدار بالای جدول مغایرت */
      pendingRestockQty: Object.values(livePending).reduce((s, q) => s + Math.max(0, Math.round(q ?? 0)), 0)
    }
  }
}
