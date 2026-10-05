import { prisma } from '../db/client'
import { toJalaliDate, toClock, jalaliStartOfDay, jalaliEndOfDay, jalaliToday, faDigits } from '@shared/jalali'
import { reportDayInput } from './reportDate'
import {
  AuditAction,
  CARD_TRANSFER_METHOD,
  CardTransferKind,
  CardTransferStatus
} from '@shared/enums'
import { calculateCardTransferTotals } from '@shared/accounting'
import { PANEL_KEYS } from '@shared/panels'
import { releasedStockNote } from '@shared/pendingRestock'
import { assertPanelPassword } from './AuthService'
import { pendingRestockService } from './PendingRestockService'
import { toNumberRial } from '@shared/money'

/**
 * ===========================================================================
 * جلسه ۱۷ · بند ۱ — «کارت‌به‌کارت توسط مدیر»، با گردش تأیید.
 *
 * ⚠️⚠️ جلسه ۴۰ · کار ب — از این نسخه `pay` **موجودی انبار را هم عوض می‌کند**:
 * کالای برگشتیِ معلق (که در لحظه‌ی ثبت فروشنده عمداً به موجودی قابل‌فروش اضافه
 * نشد) دقیقاً در همان تراکنش به انبار برمی‌گردد. پس:
 *   • `pay` و `cancel` هر دو **سمت سرور** تأیید مدیر می‌گیرند
 *     (`assertPanelPassword(PANEL_KEYS.cardTransfers, …)`) و نه فقط در رندرر.
 *   • آزادسازی کالا فقط و فقط از `pendingRestockService.releaseReturnStock`
 *     انجام می‌شود و idempotent است.
 *
 * چرا یک مدل و سرویس مستقل و نه گسترش `Payment`؟
 * چون این جریان **پرداخت فوری نیست**: در لحظه‌ی ثبت برگشت/تعویض هیچ پولی جابه‌جا
 * نمی‌شود و هیچ اثری روی کشوی صندوق، کارت‌خوان فروشگاه یا فروش ندارد. اگر یک
 * `Payment` می‌ساختیم، همان لحظه در «بستن صندوق»، «سرجمع فروش» و صورت‌حساب‌های
 * `accounting.ts` وارد می‌شد — یعنی دقیقاً همان چیزی که نباید بشود.
 *
 * دو قاعده‌ی سختِ این سرویس:
 *   ۱) بدون یک عملیات برگشت/تعویض *ثبت‌شده و مرجع*، درخواست ساخته نمی‌شود.
 *   ۲) رکورد پرداخت‌شده هیچ‌وقت ویرایش یا حذف نمی‌شود؛ اصلاح = یک ردیف جدید با
 *      `kind = ADJUSTMENT` که به ردیف قبلی اشاره می‌کند (سابقه از بین نمی‌رود).
 * ===========================================================================
 */

const dayStart = (jalali?: string | null): Date | null => {
  if (!jalali) return null
  try {
    return jalaliStartOfDay(jalali)
  } catch {
    return null
  }
}
const dayEnd = (jalali?: string | null): Date | null => {
  if (!jalali) return null
  try {
    return jalaliEndOfDay(jalali)
  } catch {
    return null
  }
}

/** بازه‌ی تاریخ شمسی ⇒ فیلتر Prisma روی یک ستون تاریخ. */
export function jalaliRange(fromJalali?: string | null, toJalali?: string | null) {
  const gte = dayStart(fromJalali)
  const lte = dayEnd(toJalali)
  if (!gte && !lte) return undefined
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
}

async function writeAudit(
  client: any,
  data: { action: string; entityId: number; userId?: number | null; after?: unknown; note: string }
): Promise<void> {
  await client.auditLog.create({
    data: {
      action: data.action,
      entity: 'CardTransferRequest',
      entityId: data.entityId,
      userId: data.userId ?? null,
      after: data.after == null ? null : JSON.stringify(data.after),
      note: data.note
    }
  })
}

export interface CreateCardTransferInput {
  returnId: number
  operationKind: 'RETURN' | 'EXCHANGE'
  amount: number
  sourceInvoiceId?: number | null
  sourceReceiptNo?: number | null
  exchangeInvoiceId?: number | null
  exchangeReceiptNo?: number | null
  invoiceTotal?: number
  returnTotal?: number
  items?: { name: string; qty: number; unitPrice?: number }[]
  stockNote?: string | null
  userId?: number | null
  userName?: string | null
  shiftId?: number | null
  shiftName?: string | null
  note?: string | null
  at?: Date
}

/**
 * نشست ۱۴۳ · بند ۴-۲۸(د) — مبلغ و شناسه‌ی کارت‌به‌کارت بی‌صدا گرد نمی‌شوند.
 * قبلاً ۴۰۰٬۰۰۰٫۵ به ۴۰۰٬۰۰۱ گرد و «پرداخت شد» ثبت می‌شد؛ عددی که روی سند
 * می‌نشست با عددی که مدیر وارد کرده بود نمی‌خواند.
 */
function assertCtInteger(value: unknown, label: string, opts: { min?: number; allowNegative?: boolean } = {}): number {
  const min = opts.min ?? 1
  const valid =
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    (opts.allowNegative ? value !== 0 : value >= min)
  if (!valid) {
    const want = opts.allowNegative ? 'عدد صحیح غیرصفر (مثبت یا منفی) به ریال' : `عدد صحیح بزرگ‌تر از صفر${label.includes('شناسه') ? '' : ' به ریال'}`
    throw new Error(
      `${label} باید ${want} باشد؛ مقدار «${String(value)}» پذیرفته نیست ` +
        '(اعشار، متن، NaN یا عدد خارج از سقف امن گرد یا اصلاح نمی‌شود) و هیچ تغییری ثبت نشد.'
    )
  }
  return value as number
}

/** شناسه‌ی خالی پیام قدیمی خودش را نگه می‌دارد؛ شناسه‌ی اعشاری/منفی «عدد صحیح» می‌گوید. */
function ctId(raw: unknown, emptyMessage: string | null): number {
  if (raw == null || raw === '' || raw === 0) {
    if (emptyMessage) throw new Error(emptyMessage)
    return 0
  }
  return assertCtInteger(raw, 'شناسه‌ی درخواست کارت‌به‌کارت')
}

/**
 * ساخت درخواست، *داخل همان تراکنشِ* برگشت/تعویض (قاعده‌ی ۶ README: هر متد یک
 * `client` اختیاری می‌گیرد و وقتی تراکنش باز است همان `tx` پاس می‌شود).
 */
export async function createCardTransferRequest(client: any, input: CreateCardTransferInput) {
  const returnId = Number(input.returnId ?? 0)
  if (!returnId)
    throw new Error(
      'درخواست کارت‌به‌کارت بدون یک عملیات برگشت یا تعویضِ ثبت‌شده ساخته نمی‌شود. ' +
        'اول برگشت/تعویض را ثبت کنید؛ درخواست پرداخت خودکار به همان سند وصل می‌شود.'
    )
  const amount = assertCtInteger(input.amount, 'مبلغ کارت‌به‌کارت')

  const now = input.at ?? new Date()
  return client.cardTransferRequest.create({
    data: {
      kind: CardTransferKind.REQUEST,
      status: CardTransferStatus.PENDING,
      operationKind: input.operationKind ?? 'RETURN',
      returnId,
      sourceInvoiceId: input.sourceInvoiceId ?? null,
      sourceReceiptNo: input.sourceReceiptNo ?? null,
      exchangeInvoiceId: input.exchangeInvoiceId ?? null,
      exchangeReceiptNo: input.exchangeReceiptNo ?? null,
      // نشست ۱۸۱: این دو مقدار می‌توانند مستقیم از ردیف فاکتور (BigInt) بیایند.
      invoiceTotal: Math.max(0, toNumberRial(input.invoiceTotal ?? 0)),
      returnTotal: Math.max(0, toNumberRial(input.returnTotal ?? 0)),
      amount,
      itemsJson: input.items?.length ? JSON.stringify(input.items) : null,
      stockNote: input.stockNote ?? null,
      userId: input.userId ?? null,
      userName: input.userName ?? null,
      shiftId: input.shiftId ?? null,
      shiftName: input.shiftName ?? null,
      createdAt: now,
      createdAtJalali: toJalaliDate(now),
      createdAtTime: toClock(now),
      note: input.note ?? null
    }
  })
}

const shapeRow = (r: any) => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  operationKind: r.operationKind,
  returnId: r.returnId,
  sourceInvoiceId: r.sourceInvoiceId,
  sourceReceiptNo: r.sourceReceiptNo,
  exchangeInvoiceId: r.exchangeInvoiceId,
  exchangeReceiptNo: r.exchangeReceiptNo,
  invoiceTotal: r.invoiceTotal,
  returnTotal: r.returnTotal,
  amount: r.amount,
  items: (() => {
    try {
      return r.itemsJson ? JSON.parse(r.itemsJson) : []
    } catch {
      return []
    }
  })(),
  stockNote: r.stockNote,
  userId: r.userId,
  userName: r.userName,
  shiftId: r.shiftId,
  shiftName: r.shiftName,
  createdAtJalali: r.createdAtJalali,
  createdAtTime: r.createdAtTime,
  paidAmount: r.paidAmount,
  paidAtJalali: r.paidAtJalali,
  paidAtTime: r.paidAtTime,
  paidMethod: r.paidMethod,
  trackingNo: r.trackingNo,
  paidByUserId: r.paidByUserId,
  paidByUserName: r.paidByUserName,
  paidShiftId: r.paidShiftId,
  paidShiftName: r.paidShiftName,
  adjustsRequestId: r.adjustsRequestId,
  adjustReason: r.adjustReason,
  /** ---- جلسه ۴۰ · کار ب — رد/لغو و ردِ آزادسازی کالای معلق ---- */
  canceledAt: r.canceledAt ? new Date(r.canceledAt).toISOString() : null,
  cancelReason: r.cancelReason ?? null,
  stockReleasedAt: r.stockReleasedAt ? new Date(r.stockReleasedAt).toISOString() : null,
  stockReleasedQty: r.stockReleasedQty ?? null,
  note: r.note
})

/**
 * نشست ۱۱۴ · بند ۴-۴۶ و ۴-۵۴ — جمع‌های کارت‌به‌کارت مدیر قبلاً از همان
 * ردیف‌های بریده‌شده (سقف ۵۰۰ فهرست و ۵۰۰۰ «خارج از فروش») حساب می‌شد و
 * بازپرداخت‌های قدیمی‌تر بی‌صدا از جمع حذف می‌شدند. حالا جمع روی کل بازه با
 * خواندن صفحه‌ای ستون‌های لازم حساب می‌شود و فقط فهرست نمایشی صفحه‌بندی دارد.
 */
const CTC_TOTALS_PAGE = 2000

/**
 * نشست ۱۱۵ · خوشه E (S115-4) — هر رویداد با *تاریخ خودش* در بازه می‌نشیند:
 * پرداخت و اصلاح ← `paidAt`، در انتظار ← `createdAt` (همان قاعده‌ی
 * `calculateCardTransferTotals`). پس فهرست باید هم «ثبت‌شده در بازه» و هم
 * «پرداخت‌شده در بازه» را بیاورد و جمع با همان period مهر بخورد؛ تا درخواستِ ماه
 * قبل که امروز پرداخت شده در «خارج از فروش» امروز بیاید و در دیروز نیاید.
 */
function eventRangeWhere(fromJalali?: string, toJalali?: string) {
  /**
   * ممیزی A114-01 (AUDIT-D45) — قبلاً '' ⇒ بدون قید تاریخ ⇒ کل تاریخچه با برچسب/جمع «امروز»، و تاریخ نامعتبر
   * در try/catch جلالی بلعیده می‌شد ⇒ باز هم کل تاریخچه. حالا: هر دو خالی ⇒ امروز (۴-۲۳)، نامعتبر ⇒ خطای فارسی.
   */
  const f = reportDayInput(fromJalali, 'از تاریخ', 'کارت‌به‌کارت')
  const t = reportDayInput(toJalali, 'تا تاریخ', 'کارت‌به‌کارت')
  const r = f || t ? jalaliRange(f, t) : jalaliRange(jalaliToday(), jalaliToday())
  return r ? { where: { OR: [{ createdAt: r }, { paidAt: r }] }, period: { from: r.gte ?? null, to: r.lte ?? null } } : { where: {}, period: undefined }
}

async function cardTransferTotalsOf(where: any, period?: { from: Date | null; to: Date | null }) {
  const events: any[] = []
  for (let skip = 0; ; skip += CTC_TOTALS_PAGE) {
    const page = await prisma.cardTransferRequest.findMany({
      where,
      orderBy: { id: 'asc' },
      skip,
      take: CTC_TOTALS_PAGE,
      select: { id: true, kind: true, status: true, amount: true, paidAmount: true, paidAt: true, createdAt: true }
    })
    events.push(...page)
    if (page.length < CTC_TOTALS_PAGE) break
  }
  return { totals: calculateCardTransferTotals(events as any, period), totalCount: events.length }
}

function ctcPage(rawTake: unknown, rawSkip: unknown, def: number, max: number) {
  const t = Math.round(Number(rawTake ?? def))
  const k = Math.round(Number(rawSkip ?? 0))
  return {
    take: Math.min(Math.max(Number.isFinite(t) ? t : def, 1), max),
    skip: Math.max(Number.isFinite(k) ? k : 0, 0)
  }
}

function ctcWarnings(shown: number, totalCount: number, skip: number): string[] {
  return totalCount > shown
    ? [
        `نمایش ${faDigits(shown)} از ${faDigits(totalCount)} درخواست کارت‌به‌کارت (از ردیف ${faDigits(skip + 1)})؛ ` +
          'جمع در انتظار، پرداخت‌شده، اصلاحی و خالص روی کل بازه حساب شده‌اند، نه فقط این صفحه.'
      ]
    : []
}

export const cardTransferService = {
  /** فهرست درخواست‌ها با فیلتر بازه/وضعیت (سقف نمایش، مثل بقیه‌ی گزارش‌ها). */
  async list(filter: { fromJalali?: string; toJalali?: string; status?: string | null; take?: number; skip?: number } = {}) {
    const range = eventRangeWhere(filter.fromJalali, filter.toJalali)
    const where = {
      ...range.where,
      ...(filter.status ? { status: String(filter.status) } : {})
    }
    const { take, skip } = ctcPage(filter.take, filter.skip, 500, 5000)
    const rows = await prisma.cardTransferRequest.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take
    })
    const { totals, totalCount } = await cardTransferTotalsOf(where, range.period)
    const page = { skip, take, totalCount, truncated: totalCount > skip + rows.length }
    return { rows: rows.map(shapeRow), totals, page, warnings: ctcWarnings(rows.length, totalCount, skip) }
  },

  /** یک درخواست + زنجیره‌ی رویدادهای اصلاحی‌اش (سابقه‌ی کامل، بی‌حذف). */
  async get(payload: { id: number }) {
    const id = Number(payload?.id ?? 0)
    const row = await prisma.cardTransferRequest.findUnique({ where: { id } })
    if (!row) throw new Error('این درخواست کارت‌به‌کارت پیدا نشد.')
    const adjustments = await prisma.cardTransferRequest.findMany({
      where: { adjustsRequestId: id },
      orderBy: { id: 'asc' }
    })
    return { request: shapeRow(row), adjustments: adjustments.map(shapeRow) }
  },

  /**
   * -------------------------------------------------------------------------
   * ثبت «پرداخت شد» توسط مدیر.
   * ⚠️ فقط یک بار: ردیف `PAID` دوباره پرداخت نمی‌شود (برای اصلاح، `adjust`).
   *
   * ============ جلسه ۴۰ · کار ب — دو چیز تازه و هر دو مهم ============
   *
   * ۱) **تأیید مدیر سمت سرور.** این متد دیگر فقط یک رکورد مالی را علامت
   *    نمی‌زند؛ کالای معلق را به موجودی قابل‌فروش برمی‌گرداند. پس قبل از باز
   *    شدن تراکنش، `assertPanelPassword` روی همان کلید موجودِ
   *    `PANEL_KEYS.cardTransfers` صدا زده می‌شود — همان مکانیزم پروژه (رمز
   *    مدیر / رمز دوم پنل / رمز سوم شیفت + قفل موقت)، بدون هیچ مکانیزم جدید.
   *    عمداً *بیرون* تراکنش است: نوشتن روی `AuthLockout` وسط تراکنشِ باز روی
   *    SQLite تک‌نویسنده همان بن‌بست آشنای پروژه است.
   *
   * ۲) **ورود کالای معلق به انبار، در همین تراکنش.** تنها نقطه‌ی آزادسازی،
   *    `pendingRestockService.releaseReturnStock` است و idempotent است (فقط
   *    اقلامی که `restockedQty < qty`). پس دو بار زدن دکمه هیچ‌وقت کالا را دو
   *    بار اضافه نمی‌کند — و ضمناً خودِ `status !== PENDING` هم دومین بار را
   *    از قبل رد می‌کند.
   *
   * ============ تصمیم: پرداخت کمتر/بیشتر از `amount` ============
   * `pay` اجازه می‌دهد مدیر مبلغی غیر از `amount` بزند. تصمیم: **کالا در هر
   * حالت کامل برمی‌گردد.** دلیل: تکلیف کالا یک واقعیت *فیزیکی* است، نه یک
   * نسبت مالی. مشتری جنس را پس داده و جنس در فروشگاه است؛ نگه‌داشتنِ نیمی از
   * یک شلوار بیرون از موجودی هیچ معنای انباری ندارد و فقط انبارگردانی را
   * خراب می‌کند. اختلاف مبلغ همان جایی حل می‌شود که برایش ساخته شده: یک ردیف
   * `ADJUSTMENT` (مثبت = پرداخت بیشتر، منفی = برگشت مبلغ) که سابقه را هم حفظ
   * می‌کند. برای اینکه این تصمیم *دیده* شود، مبلغ کمتر/بیشتر در `note` و در
   * AuditLog صریح ثبت می‌شود.
   * -------------------------------------------------------------------------
   */
  async pay(payload: {
    id: number
    paidAmount?: number | null
    trackingNo?: string | null
    note?: string | null
    userId?: number | null
    userName?: string | null
    shiftId?: number | null
    shiftName?: string | null
    /** جلسه ۴۰ · کار ب — رمز مدیر یا رمز دوم پنل «پرداخت‌های مدیر» */
    managerPassword?: string | null
  }) {
    const id = ctId(payload?.id, 'درخواست کارت‌به‌کارتی برای پرداخت مشخص نشده است.')
    // نشست ۱۴۳ — مبلغ پرداختی پیش از رمز/تراکنش سنجیده می‌شود، بدون گرد بی‌صدا.
    if (payload?.paidAmount != null) assertCtInteger(payload.paidAmount, 'مبلغ پرداخت‌شده')
    /**
     * تأیید مدیر، *قبل* از تراکنش. اگر رد شود، هیچ رکوردی نوشته نمی‌شود و هیچ
     * کالایی به انبار برنمی‌گردد.
     */
    const scope = await assertPanelPassword(
      PANEL_KEYS.cardTransfers,
      payload?.managerPassword ?? null,
      'ثبت «پرداخت شد» کارت‌به‌کارت و بازگرداندن کالای برگشتی به موجودی قابل‌فروش'
    )
    return prisma.$transaction(async (tx) => {
      const row = await tx.cardTransferRequest.findUnique({ where: { id } })
      if (!row) throw new Error('این درخواست کارت‌به‌کارت پیدا نشد.')
      if (row.kind !== CardTransferKind.REQUEST)
        throw new Error('رویداد اصلاحی خودش قابل پرداخت نیست؛ روی درخواست اصلی اقدام کنید.')
      if (row.status !== CardTransferStatus.PENDING)
        throw new Error(
          'این درخواست قبلاً پرداخت شده است. رکورد پرداخت‌شده ویرایش نمی‌شود؛ ' +
            'اگر اصلاحی لازم است از «ثبت رویداد اصلاحی» استفاده کنید تا سابقه از بین نرود.'
        )
      const ref = await tx.saleReturn.findUnique({ where: { id: row.returnId }, select: { id: true, voidedAt: true } })
      if (!ref) throw new Error('عملیات برگشت/تعویض مرجع این درخواست پیدا نشد، پس پرداخت ثبت نمی‌شود.')
      // نشست ۶۴ · بند ۴-۲۲ — به سند باطل‌شده پولی پرداخت نمی‌شود
      if (ref.voidedAt != null)
        throw new Error('سند برگشت مرجع این درخواست باطل شده است، پس بازپرداختی به مشتری تعلق ندارد و پرداخت ثبت نمی‌شود.')

      const now = new Date()
      // نشست ۱۸۱: `row.amount` از دیتابیس BigInt است و `payload.paidAmount` از
      // رابط کاربری number؛ یک نمایش واحد لازم است وگرنه مقایسه و تفریق پایین‌تر
      // با «Cannot mix BigInt» می‌ترکد.
      const paid = toNumberRial(payload.paidAmount == null ? row.amount : (payload.paidAmount as number))
      if (paid <= 0) throw new Error('مبلغ پرداخت‌شده باید بزرگ‌تر از صفر باشد.')
      const requested = toNumberRial(row.amount)
      if (paid > requested)
        throw new Error(
          `مبلغ پرداخت‌شده (${faDigits(paid)} ریال) بیشتر از مبلغ درخواست (${faDigits(requested)} ریال) است و ثبت نمی‌شود. ` +
            'اگر اصلاح لازم است از «ثبت رویداد اصلاحی» استفاده کنید تا سابقه از بین نرود.'
        )

      /**
       * جلسه ۴۰ · کار ب — کالای معلق، *در همین تراکنش*. اول انبار و بعد
       * برچسب پرداخت، تا اگر آزادسازی به هر دلیلی بشکند، رکورد «پرداخت‌شده»ی
       * بدون کالا جا نماند (تراکنش کامل rollback می‌شود).
       */
      const released = await pendingRestockService.releaseReturnStock(tx, {
        returnId: row.returnId,
        userId: payload.userId ?? null,
        requestId: id,
        reason: `پرداخت کارت‌به‌کارت درخواست ${faDigits(id)} توسط مدیر`,
        at: now
      })

      /** تفاوت مبلغ پرداخت‌شده با مبلغ درخواست — عمداً دیده می‌شود، نه بی‌صدا. */
      // نشست ۱۸۱: `row.amount` حالا BigInt است و `Math.round` روی BigInt استثنا
      // می‌دهد. `toNumberRial` تبدیل می‌کند و اگر از محدوده‌ی امن بیرون بزند
      // بلند خطا می‌دهد به‌جای اینکه بی‌صدا عدد غلط بسازد.
      const delta = paid - toNumberRial(row.amount)
      const deltaNote =
        delta === 0
          ? ''
          : delta > 0
            ? ` · ${faDigits(delta)} ریال بیشتر از مبلغ درخواست پرداخت شد`
            : ` · ${faDigits(-delta)} ریال کمتر از مبلغ درخواست پرداخت شد`
      const stockLine = released.releasedQty > 0
        ? releasedStockNote(released.releasedQty, faDigits)
        : row.stockNote ?? null

      const updated = await tx.cardTransferRequest.update({
        where: { id },
        data: {
          status: CardTransferStatus.PAID,
          paidAmount: paid,
          paidAt: now,
          paidAtJalali: toJalaliDate(now),
          paidAtTime: toClock(now),
          paidMethod: CARD_TRANSFER_METHOD,
          trackingNo: (payload.trackingNo ?? '').trim() || null,
          paidByUserId: payload.userId ?? null,
          paidByUserName: payload.userName ?? null,
          paidShiftId: payload.shiftId ?? null,
          paidShiftName: payload.shiftName ?? null,
          /**
           * `stockNote` باید *وضعیت واقعی* را بگوید، پس بعد از پرداخت به‌روز
           * می‌شود. ⚠️ برای `kind = ADJUSTMENT` دست نمی‌خورد (این مسیر فقط روی
           * `REQUEST` اجرا می‌شود؛ بالاتر رد شده است).
           */
          ...(released.releasedQty > 0
            ? { stockNote: stockLine, stockReleasedAt: now, stockReleasedQty: released.releasedQty }
            : {}),
          note: payload.note?.trim() ? `${row.note ? row.note + ' · ' : ''}${payload.note.trim()}` : row.note
        }
      })
      await writeAudit(tx, {
        action: AuditAction.CARD_TRANSFER_PAID,
        entityId: id,
        userId: payload.userId ?? null,
        after: {
          paidAmount: paid,
          requestedAmount: toNumberRial(row.amount),
          amountDelta: delta,
          trackingNo: updated.trackingNo,
          returnId: row.returnId,
          sourceReceiptNo: row.sourceReceiptNo,
          shiftId: payload.shiftId ?? null,
          approvedWith: scope,
          releasedQty: released.releasedQty,
          releasedVariants: released.variants
        },
        note:
          `ثبت پرداخت کارت‌به‌کارت درخواست ${faDigits(id)} · مبلغ ${faDigits(paid)} ریال` +
          (updated.trackingNo ? ` · پیگیری ${updated.trackingNo}` : '') +
          deltaNote +
          ' · خارج از جریان فروش (در سرجمع فروش نمی‌آید)' +
          (released.releasedQty > 0
            ? ` · ${releasedStockNote(released.releasedQty, faDigits)}`
            : ' · این درخواست کالای معلقی نداشت، موجودی انبار تغییر نکرد')
      })
      return { ...shapeRow(updated), releasedQty: released.releasedQty, releasedVariants: released.variants }
    })
  },

  /**
   * -------------------------------------------------------------------------
   * جلسه ۴۰ · کار ب — «رد/لغو» یک درخواست کارت‌به‌کارت.
   *
   * چرا لازم شد: از این نسخه کالای برگشتی تا پرداخت مدیر معلق می‌ماند. اگر مدیر
   * پرداخت را رد کند و هیچ مسیری برای بستن پرونده نباشد، آن کالا برای همیشه
   * «معلق» می‌ماند و در انبارگردانی هر ماه به‌عنوان مغایرت باز دیده می‌شود.
   *
   * سه قاعده:
   *   ۱) رکورد **حذف یا بازنویسی نمی‌شود** (قاعده‌ی ۲ بالای همین فایل): فقط
   *      `status = CANCELED` + `cancelReason` می‌گیرد و در سابقه می‌ماند.
   *   ۲) دلیل **اجباری** است. سابقه باید خودگویا باشد.
   *   ۳) لغو، به‌خودیِ‌خود کالا را به موجودی قابل‌فروش برنمی‌گرداند. تکلیف کالا
   *      یک تصمیم *صریح* است: `releaseStock: true` یعنی «مدیر تأیید می‌کند که
   *      کالا بی‌پرداخت به موجودی قابل‌فروش برگردد» (مثلاً برگشت اشتباه ثبت
   *      شده و مشتری پولی طلب ندارد). `false` یعنی کالا معلق می‌ماند تا
   *      فروشنده خودِ سند برگشت را ویرایش یا حذف کند. هر دو حالت در پنل با
   *      متن روشن دیده می‌شوند و در AuditLog می‌نشینند.
   *
   * همان گیت سمت سرور `pay` را دارد، چون مسیر `releaseStock` هم موجودی را
   * عوض می‌کند.
   * -------------------------------------------------------------------------
   */
  async cancel(payload: {
    id: number
    reason: string
    releaseStock?: boolean
    userId?: number | null
    userName?: string | null
    managerPassword?: string | null
  }) {
    const id = ctId(payload?.id, 'درخواست کارت‌به‌کارتی برای رد/لغو مشخص نشده است.')
    const reason = String(payload?.reason ?? '').trim()
    if (!reason) throw new Error('برای رد/لغو درخواست، نوشتن دلیل اجباری است (سابقه باید خودگویا باشد).')
    const release = payload?.releaseStock === true

    const scope = await assertPanelPassword(
      PANEL_KEYS.cardTransfers,
      payload?.managerPassword ?? null,
      release
        ? 'رد/لغو درخواست کارت‌به‌کارت و بازگرداندن کالای معلق به موجودی قابل‌فروش'
        : 'رد/لغو درخواست کارت‌به‌کارت'
    )

    return prisma.$transaction(async (tx) => {
      const row = await tx.cardTransferRequest.findUnique({ where: { id } })
      if (!row) throw new Error('این درخواست کارت‌به‌کارت پیدا نشد.')
      if (row.kind !== CardTransferKind.REQUEST)
        throw new Error('رویداد اصلاحی خودش لغو نمی‌شود؛ روی درخواست اصلی اقدام کنید.')
      /**
       * ممیزی A115-01 (AUDIT-D47) — هر ردیفی که `paidAt` دارد (PAID یا ADJUSTED پرداخت‌شده) پولش واقعاً رفته است؛
       * لغوش پرداخت واقعی را از «پرداخت‌شده» و خروج خالص حذف می‌کرد و releaseStock را هم باز می‌کرد.
       */
      if (row.status === CardTransferStatus.PAID || row.paidAt != null)
        throw new Error(
          'این درخواست پرداخت شده است و لغو نمی‌شود. رکورد پرداخت‌شده ویرایش نمی‌شود؛ ' +
            'برای برگشت مبلغ از «ثبت رویداد اصلاحی» با مبلغ منفی استفاده کنید.'
        )
      if (row.status === CardTransferStatus.CANCELED && !release)
        throw new Error('این درخواست قبلاً رد/لغو شده است.')

      const now = new Date()
      const released = release
        ? await pendingRestockService.releaseReturnStock(tx, {
            returnId: row.returnId,
            userId: payload.userId ?? null,
            requestId: id,
            reason: `آزادسازی صریح مدیر بدون پرداخت · دلیل: ${reason}`,
            at: now
          })
        : { releasedQty: 0, variants: [] as { variantId: number; qty: number }[], alreadyDone: true }

      const ret = await tx.saleReturn.findUnique({
        where: { id: row.returnId },
        select: { restockPending: true }
      })
      const stillPending = ret?.restockPending === true

      const updated = await tx.cardTransferRequest.update({
        where: { id },
        data: {
          status: CardTransferStatus.CANCELED,
          canceledAt: now,
          cancelReason: reason,
          stockNote: released.releasedQty > 0
            ? releasedStockNote(released.releasedQty, faDigits) + ' (بدون پرداخت، با تأیید صریح مدیر)'
            : stillPending
              ? 'کالای برگشتی هنوز در انتظار تکلیف است و در موجودی قابل‌فروش نیست؛ ' +
                'برای بستن پرونده، سند برگشت را ویرایش/حذف کنید یا کالا را با تأیید مدیر آزاد کنید'
              : row.stockNote,
          ...(released.releasedQty > 0
            ? { stockReleasedAt: now, stockReleasedQty: released.releasedQty }
            : {})
        }
      })

      await writeAudit(tx, {
        action: AuditAction.CARD_TRANSFER_CANCEL,
        entityId: id,
        userId: payload.userId ?? null,
        after: {
          returnId: row.returnId,
          amount: row.amount,
          reason,
          releaseStock: release,
          releasedQty: released.releasedQty,
          stillPending: !release && stillPending,
          approvedWith: scope
        },
        note:
          `رد/لغو درخواست کارت‌به‌کارت ${faDigits(id)} · مبلغ ${faDigits(row.amount ?? 0)} ریال · دلیل: ${reason}` +
          (released.releasedQty > 0
            ? ` · ${releasedStockNote(released.releasedQty, faDigits)} (بدون پرداخت)`
            : stillPending
              ? ' · کالای برگشتی همچنان معلق است و به موجودی قابل‌فروش اضافه نشد'
              : ' · این درخواست کالای معلقی نداشت')
      })

      return { ...shapeRow(updated), releasedQty: released.releasedQty, stillPending: !release && stillPending }
    })
  },

  /**
   * رویداد اصلاحی. **هیچ ردیفی ویرایش یا حذف نمی‌شود**: یک ردیف جدید با
   * `kind = ADJUSTMENT` ساخته می‌شود و ردیف قبلی فقط برچسب `ADJUSTED` می‌گیرد،
   * پس هم عدد اولیه و هم اصلاح، هر دو در سابقه می‌مانند.
   */
  async adjust(payload: {
    id: number
    amount: number
    reason: string
    trackingNo?: string | null
    userId?: number | null
    userName?: string | null
    shiftId?: number | null
    shiftName?: string | null
    /** نشست ۱۴۴ · بند ۴-۳۹ — رمز مدیر یا رمز دوم پنل «پرداخت‌های مدیر» (مثل pay/cancel) */
    managerPassword?: string | null
  }) {
    const id = ctId(payload?.id, null)
    const reason = String(payload?.reason ?? '').trim()
    if (!reason) throw new Error('برای ثبت رویداد اصلاحی، نوشتن دلیل اجباری است (سابقه باید خودگویا باشد).')
    // نشست ۱۴۳ — صفر پیام قدیمی را نگه می‌دارد؛ اعشار/متن/خارج از سقف بدون گرد رد می‌شود.
    if (payload?.amount === 0) throw new Error('مبلغ اصلاحی نمی‌تواند صفر باشد (مثبت = پرداخت بیشتر، منفی = برگشت مبلغ).')
    const amount = assertCtInteger(payload?.amount, 'مبلغ اصلاحی', { allowNegative: true })
    /**
     * نشست ۱۴۴ · بند ۴-۳۹/۴-۳۰ — رویداد اصلاحی یک ردیف PAID با مبلغ مثبت/منفی
     * می‌سازد و روی «جریان‌های مالی خارج از فروش» اثر مستقیم دارد؛ پس همان گیت
     * سمت سرور pay/cancel را می‌گیرد. تأیید *قبل* از تراکنش: اگر رد شود هیچ
     * ردیفی ساخته نمی‌شود و وضعیت درخواست مرجع دست نمی‌خورد.
     */
    const scope = await assertPanelPassword(
      PANEL_KEYS.cardTransfers,
      payload?.managerPassword ?? null,
      'ثبت رویداد اصلاحی کارت‌به‌کارت'
    )

    return prisma.$transaction(async (tx) => {
      const base = await tx.cardTransferRequest.findUnique({ where: { id } })
      if (!base) throw new Error('درخواست مرجع این اصلاح پیدا نشد.')
      if (base.kind !== CardTransferKind.REQUEST)
        throw new Error('رویداد اصلاحی فقط روی یک «درخواست پرداخت» ثبت می‌شود، نه روی یک اصلاح دیگر.')
      /**
       * ممیزی A115-01 (AUDIT-D47) — اصلاح فقط روی درخواستِ واقعاً پرداخت‌شده: PAID، یا ADJUSTED دارای `paidAt`.
       * قبلاً روی PENDING/CANCELED هم مجاز بود: درخواست ۱٬۰۰۰٬۰۰۰ در انتظار + اصلاح +۲۰۰٬۰۰۰ ⇒ ADJUSTED بی‌paidAt ⇒
       * ۱٬۰۰۰٬۰۰۰ از «در انتظار» ناپدید، pay دیگر ممکن نبود و ۲۰۰٬۰۰۰ «پرداخت‌شده» شمرده می‌شد.
       */
      const basePaid =
        base.status === CardTransferStatus.PAID ||
        (base.status === CardTransferStatus.ADJUSTED && base.paidAt != null)
      if (!basePaid)
        throw new Error(
          'رویداد اصلاحی فقط روی درخواستِ پرداخت‌شده ثبت می‌شود. ' +
            (base.status === CardTransferStatus.CANCELED
              ? 'این درخواست رد/لغو شده است و پرداختی ندارد.'
              : 'این درخواست هنوز پرداخت نشده است؛ اول «پرداخت شد» را با مبلغ واقعی ثبت کنید.')
        )

      /**
       * AUDIT-S144-01 (AUDIT-D75) — کران مالی رویداد اصلاحی (قاعده‌ی کلی بند ۵ و بند ۴-۲۲).
       *   (الف) خالص پرداخت‌شده‌ی این درخواست (پرداخت اصلی + همه‌ی اصلاح‌های قبلی) بعد از این اصلاح منفی نشود؛
       *         قبلاً پرداخت ۵۰۰٬۰۰۰ با اصلاح −۶۰۰٬۰۰۰ پذیرفته و خالص −۱۰۰٬۰۰۰ ثبت می‌شد.
       *   (ب) پرداخت بیشتر (اصلاح مثبت) روی سند برگشتِ باطل‌شده رد شود، هم‌قاعده با pay (نشست ۶۴)؛
       *       پس‌گرفتن پول (اصلاح منفی) روی سند باطل مجاز می‌ماند.
       */
      const priorAdjustments = await tx.cardTransferRequest.findMany({
        where: { adjustsRequestId: base.id, kind: CardTransferKind.ADJUSTMENT },
        select: { amount: true, paidAmount: true }
      })
      const netPaid =
        Math.round(Number(base.paidAmount ?? base.amount ?? 0)) +
        priorAdjustments.reduce((sum, a) => sum + Math.round(Number(a.paidAmount ?? a.amount ?? 0)), 0)
      if (netPaid + amount < 0)
        throw new Error(
          `خالص پرداخت‌شده‌ی این درخواست کارت‌به‌کارت تا الان ${faDigits(netPaid)} ریال است؛ ` +
            `اصلاح ${faDigits(Math.abs(amount))}- ریالی آن را به ${faDigits(Math.abs(netPaid + amount))}- ریال (منفی) می‌رساند. ` +
            `بیشترین مبلغ قابل پس‌گرفتن ${faDigits(netPaid)} ریال است؛ هیچ ردیفی ثبت نشد.`
        )
      /**
       * نشست ۲۱۳ · MED-1 — اصلاح مثبت از سقف مبلغ درخواست بالاتر نرود.
       * pay() همین سقف را دارد؛ بدون آن ۶۰۰ پرداخت + اصلاح ۵۰۰ = ۱٬۱۰۰ از حق ۱٬۰۰۰.
       */
      const requested = Math.round(Number(base.amount ?? 0))
      if (amount > 0 && netPaid + amount > requested)
        throw new Error(
          `خالص پرداخت‌شده‌ی این درخواست تا الان ${faDigits(netPaid)} ریال است؛ ` +
            `اصلاح +${faDigits(amount)} ریالی آن را به ${faDigits(netPaid + amount)} ریال می‌رساند که از مبلغ درخواست (${faDigits(requested)} ریال) بیشتر است. ` +
            `بیشترین مبلغ قابل افزودن ${faDigits(Math.max(0, requested - netPaid))} ریال است؛ هیچ ردیفی ثبت نشد.`
        )
      if (amount > 0) {
        const ref = await tx.saleReturn.findUnique({ where: { id: base.returnId }, select: { id: true, voidedAt: true } })
        if (!ref || ref.voidedAt != null)
          throw new Error(
            `سند برگشت مرجع این درخواست ${ref ? 'باطل شده است' : 'پیدا نشد'}، پس پرداخت بیشتر (${faDigits(amount)} ریال) به مشتری تعلق ندارد و ثبت نشد. ` +
              'اگر مشتری پول را پس داده، اصلاح منفی ثبت کنید.'
          )
      }

      const now = new Date()
      const created = await tx.cardTransferRequest.create({
        data: {
          kind: CardTransferKind.ADJUSTMENT,
          status: CardTransferStatus.PAID,
          operationKind: base.operationKind,
          returnId: base.returnId,
          sourceInvoiceId: base.sourceInvoiceId,
          sourceReceiptNo: base.sourceReceiptNo,
          exchangeInvoiceId: base.exchangeInvoiceId,
          exchangeReceiptNo: base.exchangeReceiptNo,
          invoiceTotal: base.invoiceTotal,
          returnTotal: base.returnTotal,
          amount,
          itemsJson: base.itemsJson,
          stockNote: base.stockNote,
          userId: payload.userId ?? null,
          userName: payload.userName ?? null,
          shiftId: payload.shiftId ?? null,
          shiftName: payload.shiftName ?? null,
          createdAt: now,
          createdAtJalali: toJalaliDate(now),
          createdAtTime: toClock(now),
          paidAmount: amount,
          paidAt: now,
          paidAtJalali: toJalaliDate(now),
          paidAtTime: toClock(now),
          paidMethod: CARD_TRANSFER_METHOD,
          trackingNo: (payload.trackingNo ?? '').trim() || null,
          paidByUserId: payload.userId ?? null,
          paidByUserName: payload.userName ?? null,
          paidShiftId: payload.shiftId ?? null,
          paidShiftName: payload.shiftName ?? null,
          adjustsRequestId: base.id,
          adjustReason: reason
        }
      })
      // ردیف قبلی *پاک یا بازنویسی نمی‌شود*؛ فقط نشان می‌دهد اصلاحی دارد.
      await tx.cardTransferRequest.update({
        where: { id: base.id },
        data: { status: CardTransferStatus.ADJUSTED }
      })
      await writeAudit(tx, {
        action: AuditAction.CARD_TRANSFER_ADJUST,
        entityId: created.id,
        userId: payload.userId ?? null,
        after: { adjustsRequestId: base.id, amount, reason, approvedWith: scope },
        note: `رویداد اصلاحی روی درخواست ${faDigits(base.id)} · مبلغ ${faDigits(amount)} ریال · دلیل: ${reason}`
      })
      return shapeRow(created)
    })
  },

  /**
   * بلوک «جریان‌های مالی خارج از فروش».
   * عمداً جدا از `buildStatements` است: این مبلغ در سرجمع فروش و فروش ناخالص
   * هیچ سهمی ندارد و نباید داشته باشد.
   */
  async outOfSales(filter: { fromJalali?: string; toJalali?: string; take?: number; skip?: number } = {}) {
    const range = eventRangeWhere(filter.fromJalali, filter.toJalali)
    const where = range.where
    const { take, skip } = ctcPage(filter.take, filter.skip, 5000, 5000)
    const rows = await prisma.cardTransferRequest.findMany({
      where,
      orderBy: { id: 'desc' },
      skip,
      take
    })
    const { totals, totalCount } = await cardTransferTotalsOf(where, range.period)
    return {
      totals,
      rows: rows.map(shapeRow),
      page: { skip, take, totalCount, truncated: totalCount > skip + rows.length },
      warnings: ctcWarnings(rows.length, totalCount, skip),
      note:
        'این مبالغ «کارت‌به‌کارت توسط مدیر» هستند و عمداً در سرجمع فروش، فروش ناخالص و ' +
        'موجودی انتظاری صندوق وارد نمی‌شوند: نه فروش‌اند و نه از کشوی صندوق خارج شده‌اند.'
    }
  }
}
