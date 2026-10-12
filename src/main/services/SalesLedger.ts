import type { Prisma } from '@prisma/client'
import { exchangeRefundPartOf } from '@shared/settlement'
import { receiptBucketOf } from '@shared/accounting'
import { prisma } from '../db/client'
import { storeCreditScopes, liteRowsByIdChunks, rowsForIdsInOrder } from './accountingReport'
import {
  saleWhere,
  eventInvoiceContextWhere,
  paymentEventOwnerWhere,
  resolveReportEventShiftIds,
  returnEventOwnerWhere,
  resolveReportPeriod,
  financialStatementInvoiceWhere,
  excludedStatusStatementWarning
} from './SalesService'
import {
  ChequeStatus,
  ExchangeSettlement,
  PaymentDestination,
  PaymentEntryKind,
  OrderType,
  PaymentKind,
  RefundMethod,
  ReturnKind,
  refundMethodLabel
} from '@shared/enums'
import { toJalaliDate, toClock, money, faDigits } from '@shared/jalali'
import type { SaleLedgerResult, SaleLedgerRow, SaleReportFilter } from '@shared/types'
import { toNumberRial } from '@shared/money'

/**
 * ===========================================================================
 * جلسه ۱۵ · «دفتر رویداد» تب جزئیات فروش (بخش ۵ سند مرجع).
 *
 * ================== چه چیزی را حل می‌کند؟ ==================
 * تب جزئیات فروش تا امروز فقط «سطر کالا به کالا»ی فاکتورها بود: برگشت، تعویض،
 * مصرف اعتبار، وصول نسیه و پاس‌شدن چک هیچ‌کدام در آن دیده نمی‌شدند. یعنی مدیر
 * می‌دید چه فروخته شده، ولی نمی‌دید **پول** و **کالا** در آن بازه واقعاً به چه
 * سمتی حرکت کرده‌اند.
 *
 * هر ردیف این دفتر یک رویداد است، با سه ستون تصمیم‌ساز:
 *   • «نوع رویداد»        — فروش / برگشت / تعویض‌برگشتی / تعویض‌جایگزین /
 *                            مصرف‌اعتبار / وصول‌نسیه / پاس‌چک
 *   • «اثر روی نقد»       — + پول آمد · − پول رفت · ۰ هیچ پولی جابه‌جا نشد
 *   • «اثر روی موجودی انبار» — + کالا برگشت · − کالا خارج شد
 * و لینک به سند مبدأ (`invoiceId` / `sourceId`).
 *
 * ================== قاعده‌ی تاریخ ==================
 * هر رویداد با **تاریخ خودش** در دفتر می‌نشیند، نه تاریخ فاکتور مادر:
 * فروش با `issuedAt`، برگشت با `returnedAt`، پرداخت نسیه با `paidAt`، پاس‌شدن
 * چک با `clearedAt` و مصرف اعتبار با `usedAt`. این همان قاعده‌ی بند ۲-۱ و ۲-۲
 * سند مرجع است و دقیقاً همان مبنایی که `accounting.ts` جمع می‌زند — پس جمعِ
 * ستون «اثر روی نقد» این دفتر با «خالص وجه واقعی» بلوک ۶ هم‌خوان است.
 *
 * ⚠️ اینجا **هیچ فرمول مالی تازه‌ای نوشته نشده**: ردیف‌ها همان رکوردهای خام
 * دیتابیس‌اند و جمع‌های گزارش همان‌طور که بود از `accounting.ts` می‌آیند. این
 * دفتر یک *نمایش ردیف‌به‌ردیف* است، یک منبع دوم محاسبه نیست.
 * ===========================================================================
 */

/** سقف امنِ هر بخش دفتر؛ عبور از آن هشدار صریح می‌دهد، سکوت نمی‌کند. */
const SECTION_CAP = 4000
/**
 * ممیزی AUDIT-S133-02 — هر خوانش `id in` دفتر رویداد (نام کاربر/شیفت، سند تعویض) در دسته‌های
 * ۵۰۰تایی؛ با سقف بخش ۴٬۰۰۰ و خروجی کامل fullRange (S133) فهرست شناسه‌ها از ۵۰۰ می‌گذرد.
 * هیچ شناسه‌ای حذف یا حدس زده نمی‌شود.
 */
const chunked = async <T,>(ids: number[], read: (part: number[]) => Promise<T[]>): Promise<T[]> => {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 500) out.push(...(await read(ids.slice(i, i + 500))))
  return out
}

/**
 * ⚠️ نشست ۱۸۱ — شاخه‌ی `bigint` عمداً اضافه شد و عمداً از `toNumberRial` می‌گذرد.
 *
 * مسیر قدیمی (`Number(v)`) روی `bigint` هم *کار می‌کرد*، ولی هر مبلغ بالاتر از
 * `Number.MAX_SAFE_INTEGER` را **بی‌صدا** گرد می‌کرد — یعنی همان رفتاری که کل
 * مهاجرت به BigInt برای حذفش انجام شد، از پنجره برمی‌گشت. `toNumberRial` در آن
 * حالت خطا می‌دهد تا عدد غلط روی گزارش ننشیند.
 */
const n = (v: unknown): number =>
  typeof v === 'bigint' ? toNumberRial(v) : Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0

const EVENT_LABELS: Record<string, string> = {
  SALE: 'فروش',
  RETURN: 'برگشت از فروش',
  EXCHANGE_RETURNED: 'تعویض — کالای برگشتی',
  EXCHANGE_REPLACEMENT: 'تعویض — کالای جایگزین',
  STORE_CREDIT_USED: 'مصرف اعتبار خرید',
  CREDIT_SETTLEMENT: 'وصول نسیه‌ی بازه‌های قبل',
  CHEQUE_CLEARED: 'پاس‌شدن چک'
}

/**
 * `cashEffect` فقط اثر روی کشوی فیزیکی است، نه هر تسویه‌ی حسابداری.
 * کارت‌خوان، کارت‌به‌کارت، حساب مدیر و مقصد نامشخص نباید به صندوق نسبت داده
 * شوند؛ این نگاشت را متمرکز می‌کنیم تا ردیف‌های برگشت و چک واگرا نشوند.
 */
function cashRefundEffect(method: string | null | undefined, amount: unknown): number {
  return method === RefundMethod.CASH ? -n(amount) : 0
}

/**
 * 🔴 نشست ۱۸۴ · بند ۴-۴۹ — برای مابه‌التفاوت مثبت، `drawerCashOfExchange` حرف
 * آخر را می‌زند، نه `settlement`.
 *
 * `ExchangeSettlement.CASH` یعنی «مشتری مابه‌التفاوت را پرداخت کرد» و عمداً
 * بین نقد و کارت فرق نمی‌گذارد. پس نمی‌تواند مبنای «اثر کشو» باشد.
 *
 * `drawerCashOfExchange` جمعِ همان پرداخت‌هایی است که محمول مشترک `drawerCash`
 * «نقد کشو» می‌شناسد — یعنی همان چیزی که صورت حساب و بستن صندوق می‌بینند.
 * وقتی سند تعویضی در دست نیست (`null`)، به رفتار قبلی برمی‌گردیم تا داده‌ی
 * قدیمی بی‌صدا صفر نشود.
 */
function exchangeCashEffect(
  diff: number,
  settlement: string | null | undefined,
  refundPart: number,
  drawerCashOfExchange: number | null
): number {
  if (diff > 0) {
    if (drawerCashOfExchange != null) return Math.min(diff, Math.max(0, drawerCashOfExchange))
    return settlement === ExchangeSettlement.CASH ? diff : 0
  }
  if (diff < 0 && settlement === ExchangeSettlement.CASH_REFUND) return -refundPart
  return 0
}

function range(from: Date | null, to: Date | null): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) }
}

/**
 * آیا این پرداخت، پولِ واقعیِ ردیف «فروش» است؟
 *
 * چک عمداً این‌جا false است، حتی اگر پاس شده باشد. پاس‌شدن چک یک رویداد
 * مستقل با تاریخ `clearedAt` دارد و در ردیف `CHEQUE_CLEARED` می‌نشیند؛ اگر
 * آن را در ردیف فروش هم حساب کنیم، اثر نقدی همان چک دوبار دیده می‌شود.
 */
// نشست ۱۸۱: `amount` از دیتابیس BigInt می‌آید؛ محمول فقط علامت آن را می‌بیند،
// پس هر دو شکل پذیرفته می‌شود و هیچ محاسبه‌ای اینجا انجام نمی‌گیرد.
function receivedCash(p: { amount?: number | bigint | null; kind?: string | null; chequeStatus?: string | null; method?: { kind?: string | null } | null }): boolean {
  /**
   * نشست ۵۹ · خوشه B — `Payment` منفیِ قدیمی (بازپرداخت تعویض) دریافتی نیست؛ اثر
   * نقدی آن در ردیف EXCHANGE_REPLACEMENT همین دفتر آمده. قبلاً دو بار از نقد کم می‌شد.
   */
  if (Number(p.amount ?? 0) < 0) return false
  if (p.kind === PaymentEntryKind.CHEQUE) return false
  const k = p.method?.kind ?? null
  return k !== PaymentKind.STORE_CREDIT && k !== PaymentKind.EXCHANGE_CREDIT
}

/**
 * ممیزی A112-01 (بند ۴-۴۹، AUDIT-D44) — «در کشو» فقط سبد نقد receiptBucketOf است. receivedCash فقط
 * «پول واقعی فروش» را از اعتبار/چک/منفی جدا می‌کند؛ کارت‌خوان، کارت‌به‌کارت/حساب مدیر و مقصد نامشخص هم
 * پول‌اند ولی کشو نیستند و نباید در cashEffect بنشینند.
 */
function drawerCash(p: {
  amount?: number | bigint | null
  kind?: string | null
  chequeStatus?: string | null
  destination?: string | null
  method?: { kind?: string | null } | null
}): boolean {
  if (!receivedCash(p)) return false
  return receiptBucketOf({ isCheque: false, destination: p.destination ?? null, methodKind: p.method?.kind ?? null }) === 'cash'
}

export const salesLedger = {
  /**
   * دفتر رویداد یک بازه. همان فیلترهای گزارش (کانال تکی/عمده، شیفت، فروشنده،
   * مشتری، وضعیت) روی *همه‌ی* بخش‌ها اعمال می‌شوند؛ جایی که یک رویداد ذاتاً به
   * فاکتور گره نمی‌خورد (مصرف اعتبار) صریح در `notes` نوشته می‌شود.
   */
  async ledger(filter: SaleReportFilter = {}): Promise<SaleLedgerResult> {
    const sectionCap = (filter as any).fullRange === true ? 2_000_000_000 : SECTION_CAP
    /** نشست ۱۷۱ · S171-D2 — وضعیت صریح لغو شده/پیش‌نویس رویداد مالی نیست (هم‌معنای پل و تب‌ها) */
    const listWhere = saleWhere(filter)
    const where = financialStatementInvoiceWhere(listWhere, filter)
    const eventShiftIds = await resolveReportEventShiftIds(filter)
    const eventInvoiceContext = eventInvoiceContextWhere(filter)
    const createdPaymentOwner = paymentEventOwnerWhere(filter, 'created', eventShiftIds)
    const clearedPaymentOwner = paymentEventOwnerWhere(filter, 'cleared', eventShiftIds)
    const returnOwner = returnEventOwnerWhere(filter, eventShiftIds)
    const period = await resolveReportPeriod(filter, where)
    const window = range(period.from, period.to)
    const rows: SaleLedgerRow[] = []
    const warnings: string[] = []
    const notes: string[] = []
    const excludedWarning = await excludedStatusStatementWarning(listWhere, filter)
    if (excludedWarning) warnings.push(excludedWarning)

    // ------------------------------- ۱) فروش -------------------------------
    /**
     * نشست ۲۰۴ · بند ۴-۴۹ — سند تعویض (`orderType = EXCHANGE`) ردیف SALE نمی‌گیرد.
     * اثر نقد و انبارش در `EXCHANGE_REPLACEMENT` است. قبلاً مابه‌التفاوت مثبت
     * هم روی SALE سند تعویض و هم روی ردیف تعویض شمرده می‌شد (۱٫۴M کالا + ۴۰۰k
     * نقد ⇒ جمع نقد دفتر ۱٫۸M به‌جای ۱٫۴M).
     */
    const saleInvoiceWhere: Prisma.SaleInvoiceWhereInput = {
      AND: [where, { NOT: { orderType: OrderType.EXCHANGE } }]
    }
    const invoiceQuery = {
      where: saleInvoiceWhere,
      select: {
        id: true, receiptNo: true, issuedAt: true, issuedAtJalali: true,
        grandTotal: true, deductInventory: true, note: true, orderType: true,
        customer: { select: { name: true } },
        user: { select: { displayName: true } },
        shift: { select: { name: true } },
        items: { select: { qty: true } },
        payments: {
          where: { voidedAt: null, ...createdPaymentOwner, ...(window ? { paidAt: window } : {}) },
          select: { amount: true, kind: true, chequeStatus: true, destination: true, method: { select: { kind: true, label: true } } }
        }
      },
      orderBy: [{ issuedAt: 'asc' }, { receiptNo: 'asc' }],
      take: sectionCap + 1
      /**
       * نشست ۱۸۰ (S180-D2، گام ۰ خوشه M): `as const` روی `orderBy` یک تاپل
       * readonly می‌ساخت که به آرگومان `findMany` اسایْن نمی‌شد (TS2345)؛ در
       * نتیجه TypeScript کل نتیجه را به تایپ پیش‌فرض (بدون `select`) برمی‌گرداند
       * و ۲۴ خطای آبشاری «payments/items/customer/user/shift وجود ندارد»
       * می‌ساخت. `satisfies` هم literalهای 'asc' را نگه می‌دارد و هم شکل
       * آرگومان را همان‌جا اعتبارسنجی می‌کند، بدون هیچ تغییر زمان‌اجرا.
       */
    } satisfies Prisma.SaleInvoiceFindManyArgs
    const [invoices, invoiceTotal] = await Promise.all([
      prisma.saleInvoice.findMany(invoiceQuery),
      prisma.saleInvoice.count({ where: saleInvoiceWhere })
    ])
    const invoicePage = {
      skip: 0,
      take: sectionCap,
      totalCount: invoiceTotal,
      truncated: invoiceTotal > sectionCap
    }
    if (invoicePage.truncated)
      warnings.push(`دفتر رویداد: ${faDigits(invoiceTotal)} فاکتور در این بازه است؛ فقط ${faDigits(sectionCap)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`)
    for (const inv of invoices.slice(0, sectionCap)) {
      if (inv.orderType === OrderType.EXCHANGE) continue
      const cash = inv.payments.filter(drawerCash).reduce((s, p) => s + n(p.amount), 0)
      // ممیزی A112-01 — پول واقعیِ غیرکشویی (کارت‌خوان/حساب مدیر/نامشخص): دریافت شده ولی اثر کشو صفر
      const receivedOther = inv.payments.filter((p) => receivedCash(p) && !drawerCash(p)).reduce((s, p) => s + n(p.amount), 0)
      const nonCash = inv.payments.filter((p) => !receivedCash(p) && n(p.amount) > 0).reduce((s, p) => s + n(p.amount), 0)
      const qty = inv.items.reduce((s, i) => s + n(i.qty), 0)
      rows.push({
        key: `SALE-${inv.id}`,
        eventType: 'SALE',
        eventLabel: EVENT_LABELS.SALE,
        dateJalali: inv.issuedAtJalali || toJalaliDate(inv.issuedAt),
        time: toClock(inv.issuedAt),
        receiptNo: inv.receiptNo,
        documentLabel: `فاکتور فروش ${faDigits(inv.receiptNo)}`,
        customerName: inv.customer?.name ?? 'مشتری عمومی',
        userName: inv.user?.displayName ?? '—',
        shiftName: inv.shift?.name ?? '—',
        amount: n(inv.grandTotal),
        cashEffect: cash,
        cashNote:
          cash > 0 || receivedOther > 0
            ? [
                cash > 0 ? `${money(cash)} ریال نقد در کشو دریافت شد` : '',
                receivedOther > 0
                  ? `${money(receivedOther)} ریال با کارت‌خوان/حساب مدیر/مقصد نامشخص دریافت شد (اثر نقدی کشو صفر)`
                  : ''
              ].filter(Boolean).join(' · ')
            : 'در این بازه پولی بابت این فاکتور دریافت نشده (نسیه یا چک در جریان)',
        stockEffect: inv.deductInventory ? -qty : 0,
        invoiceId: inv.id,
        sourceId: inv.id,
        sourceKind: 'INVOICE',
        note:
          (nonCash > 0 ? `${money(nonCash)} ریال تسویه‌ی غیرنقدی (اعتبار خرید / ارزش کالای تعویض) — وجه نقد نیست. ` : '') +
          (inv.note ?? '')
      })
    }

    // -------------------- ۲) برگشت ساده و ۳) تعویض --------------------
    const returnWhere = { invoice: eventInvoiceContext, ...returnOwner, voidedAt: null, ...(window ? { returnedAt: window } : {}) }
    const returnsQuery = {
      where: returnWhere,
      select: {
        id: true, kind: true, total: true, returnedAt: true, returnedAtJalali: true, returnedAtTime: true,
        refundMethod: true, refundAmount: true, refundReference: true, note: true,
        exchangeTotal: true, exchangeDiff: true, exchangeSettlement: true, exchangeInvoiceId: true, debtReduction: true,
        exchangeReceiptNo: true, storeCreditId: true, userId: true, shiftId: true,
        invoiceId: true,
        invoice: { select: { receiptNo: true, customer: { select: { name: true } } } },
        items: { select: { qty: true, restockedQty: true } }
      },
      orderBy: [{ returnedAt: 'asc' }, { id: 'asc' }],
      take: sectionCap + 1
      /** نشست ۱۸۰ (S180-D2) — همان دلیل بالا: حفظ literal و اعتبارسنجی آرگومان. */
    } satisfies Prisma.SaleReturnFindManyArgs
    const [returns, returnTotal] = await Promise.all([
      prisma.saleReturn.findMany(returnsQuery),
      prisma.saleReturn.count({ where: returnWhere })
    ])
    const returnPage = {
      skip: 0,
      take: sectionCap,
      totalCount: returnTotal,
      truncated: returnTotal > sectionCap
    }
    if (returnPage.truncated)
      warnings.push(`دفتر رویداد: ${faDigits(returnTotal)} برگشت/تعویض در این بازه است؛ فقط ${faDigits(sectionCap)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`)

    /**
     * `SaleReturn.userId` / `shiftId` / `exchangeInvoiceId` عمداً scalar هستند
     * (بدون relation، تا مدل‌های User/Shift دست‌نخورده بمانند)، پس نام کاربر،
     * نام شیفت و تعداد اقلام سند تعویض با رفت‌وبرگشت‌های جدا خوانده می‌شوند —
     * همان کاری که `returnList` هم می‌کند.
     */
    const retUserIds = [...new Set(returns.map((r) => r.userId).filter((x): x is number => !!x))]
    const retShiftIds = [...new Set(returns.map((r) => r.shiftId).filter((x): x is number => !!x))]
    const exIds = [...new Set(returns.map((r) => r.exchangeInvoiceId).filter((x): x is number => !!x))]
    const [retUsers, retShifts, exInvoices] = await Promise.all([
      chunked(retUserIds, (part) => prisma.user.findMany({ where: { id: { in: part } }, select: { id: true, displayName: true } })),
      chunked(retShiftIds, (part) => prisma.shift.findMany({ where: { id: { in: part } }, select: { id: true, name: true } })),
      chunked(exIds, (part) =>
        prisma.saleInvoice.findMany({
          where: { id: { in: part } },
          select: {
            id: true,
            receiptNo: true,
            items: { select: { qty: true } },
            /**
             * 🔴 نشست ۱۸۴ · بند ۴-۴۹ — اثر نقدیِ مابه‌التفاوت *مثبت* باید از
             * همان جایی خوانده شود که صورت حساب می‌خواند: مقصد واقعی پرداخت.
             *
             * قبلاً از `exchangeSettlement` خوانده می‌شد که برای هر پرداختی
             * (نقد یا کارت) مقدارش `CASH` است — چون آن فیلد معنایش «مشتری
             * مابه‌التفاوت را پرداخت کرد» است، نه «با چه چیزی». نتیجه: تعویض
             * ۴۰۰٬۰۰۰ با کارت‌خوان در صورت حساب «کارت» می‌نشست ولی در دفتر
             * رویداد `cashEffect = +۴۰۰٬۰۰۰` می‌گرفت و کشو کسری دروغ نشان
             * می‌داد.
             */
            payments: {
              where: { voidedAt: null },
              select: { amount: true, kind: true, chequeStatus: true, destination: true, method: { select: { kind: true } } }
            }
          }
        })
      )
    ])
    const retUserName = new Map(retUsers.map((u) => [u.id, u.displayName]))
    const retShiftName = new Map(retShifts.map((s) => [s.id, s.name]))
    const exQty = new Map(exInvoices.map((i) => [i.id, i.items.reduce((s, x) => s + n(x.qty), 0)]))
    const exReceipt = new Map(exInvoices.map((i) => [i.id, i.receiptNo]))
    /**
     * نشست ۱۸۴ — دقیقاً همان `drawerCash` که بقیه‌ی این فایل و صورت حساب
     * استفاده می‌کنند. یک قاعده، یک جواب.
     */
    const exDrawerCash = new Map(
      exInvoices.map((i) => [i.id, (i.payments ?? []).filter(drawerCash).reduce((s, p) => s + n(p.amount), 0)])
    )
    for (const r of returns.slice(0, sectionCap)) {
      const restocked = r.items.reduce((s, i) => s + n(i.restockedQty), 0)
      const customerName = r.invoice?.customer?.name ?? 'مشتری عمومی'
      const base = {
        dateJalali: r.returnedAtJalali || toJalaliDate(r.returnedAt),
        time: r.returnedAtTime || toClock(r.returnedAt),
        receiptNo: r.invoice?.receiptNo ?? null,
        customerName,
        userName: (r.userId != null ? retUserName.get(r.userId) : null) ?? 'مدیر',
        shiftName: (r.shiftId != null ? retShiftName.get(r.shiftId) : null) ?? '—',
        invoiceId: r.invoiceId,
        sourceId: r.id,
        sourceKind: 'RETURN'
      }
      if (r.kind === ReturnKind.EXCHANGE) {
        const diff = n(r.exchangeDiff)
        const settle = r.exchangeSettlement ?? null
        rows.push({
          ...base,
          key: `EXR-${r.id}`,
          eventType: 'EXCHANGE_RETURNED',
          eventLabel: EVENT_LABELS.EXCHANGE_RETURNED,
          documentLabel: `سند تعویض ${faDigits(r.exchangeReceiptNo ?? (r.exchangeInvoiceId != null ? exReceipt.get(r.exchangeInvoiceId) ?? r.id : r.id))} · کالای برگشتی`,
          amount: n(r.total),
          cashEffect: 0,
          cashNote: 'ارزش کالای برگشتیِ تعویض هیچ‌وقت وجه نقد نیست؛ فقط با کالای جایگزین تسویه می‌شود.',
          stockEffect: restocked,
          note: r.note ?? ''
        })
        const replacementQty = r.exchangeInvoiceId != null ? exQty.get(r.exchangeInvoiceId) ?? 0 : 0
        /** نشست ۶۰ (بند ۴-۵/۴-۴۹) — فقط بخش بازپرداخت‌شده؛ کاهش بدهی فاکتور اصلی پول نیست */
        const refundPart = exchangeRefundPartOf({ exchangeDiff: diff, debtReduction: (r as any).debtReduction })
        const debtCut = Math.max(0, -diff - refundPart)
        const exDrawer = r.exchangeInvoiceId != null ? exDrawerCash.get(r.exchangeInvoiceId) ?? null : null
        const cashEffect = exchangeCashEffect(diff, settle, refundPart, exDrawer)
        rows.push({
          ...base,
          key: `EXP-${r.id}`,
          eventType: 'EXCHANGE_REPLACEMENT',
          eventLabel: EVENT_LABELS.EXCHANGE_REPLACEMENT,
          documentLabel: `سند تعویض ${faDigits(r.exchangeReceiptNo ?? (r.exchangeInvoiceId != null ? exReceipt.get(r.exchangeInvoiceId) ?? r.id : r.id))} · کالای جایگزین`,
          amount: n(r.exchangeTotal),
          cashEffect,
          cashNote:
            diff > 0
              ? `${money(diff)} ریال مابه‌التفاوت از مشتری دریافت شد` +
                (cashEffect > 0 ? ' (اثر نقدی فقط همین ردیف است؛ در فروش سند تعویض تکرار نمی‌شود)' : '')
              : diff < 0
                ? (debtCut > 0 ? `${money(debtCut)} ریال از بدهی فاکتور اصلی کم شد (اثر نقدی صفر)` : '') +
                  (debtCut > 0 && refundPart > 0 ? ' · ' : '') +
                  (refundPart <= 0
                    ? ''
                    : cashEffect < 0
                      ? `${money(refundPart)} ریال مابه‌التفاوت نقدی به مشتری برگشت`
                      : settle === ExchangeSettlement.CARD_REFUND
                        ? `${money(refundPart)} ریال به کارت مشتری برگشت (اثر نقدی کشو صفر)`
                        : settle === ExchangeSettlement.CARD_TO_CARD
                          ? `${money(refundPart)} ریال در درخواست کارت‌به‌کارت مدیر ثبت شد (اثر نقدی صفر)`
                          : `${money(refundPart)} ریال اعتبار خرید صادر شد (اثر نقدی صفر، بدهی ما)`)
                : 'مابه‌التفاوت صفر',
          stockEffect: -replacementQty,
          invoiceId: r.exchangeInvoiceId ?? r.invoiceId,
          note:
            (r.storeCreditId ? `اعتبار صادرشده: اعتبار #${r.storeCreditId}. ` : '') + (r.note ?? '')
        })
        continue
      }
      const refundAmount = n(r.refundAmount)
      rows.push({
        ...base,
        key: `RET-${r.id}`,
        eventType: 'RETURN',
        eventLabel: EVENT_LABELS.RETURN,
        documentLabel: `سند برگشت ${faDigits(r.id)}`,
        amount: n(r.total),
        cashEffect: cashRefundEffect(r.refundMethod, refundAmount),
        cashNote:
          r.refundMethod == null
            ? 'برگشت قدیمی بدون روش بازپرداخت — با فرض «فقط بدهی مشتری کم شد» خوانده شده (فرض‌شده از داده‌ی قدیمی)'
            : r.refundMethod === RefundMethod.CASH
              ? `${money(refundAmount)} ریال نقد از کشو بیرون رفت`
              : r.refundMethod === RefundMethod.CARD
                ? `${money(refundAmount)} ریال به کارت مشتری برگشت`
                : r.refundMethod === RefundMethod.STORE_CREDIT
                  ? `${money(refundAmount)} ریال اعتبار خرید صادر شد (اثر نقدی صفر)`
                  : 'بدون بازپرداخت؛ فقط بدهی مشتری کم شد (هیچ نقدی جابه‌جا نشد)',
        stockEffect: restocked,
        note:
          `روش بازپرداخت: ${refundMethodLabel(r.refundMethod)}` +
          (r.refundReference ? ` · مرجع ${r.refundReference}` : '') +
          (r.note ? ` · ${r.note}` : '')
      })
    }

    // ------------------ ۴) وصول نسیه‌ی بازه‌های قبل ------------------
    let priorSettlementPage = { skip: 0, take: sectionCap, totalCount: 0, truncated: false }
    if (period.from) {
      /**
       * نشست ۱۷۳ · S173-D4 (مشاهده‌ی باز ۱۰۶/۱۰۷) — مصرف اعتبار خرید/تعویض «وصول نسیه» نیست و قبلاً
       * فقط بعد از take در JS کنار گذاشته می‌شد ⇒ count و هشدار سقف دروغ، و بدتر: مصرف‌های زودتر
       * جای take را پر می‌کردند و وصول نقدی واقعی دوره‌ی قبل از دفتر غیب می‌شد. حالا همان شرط
       * پیش از take/count در where است (methodId غیرتهی است؛ فهرست روش‌ها کوچک است).
       */
      const creditMethodIds = (
        await prisma.paymentMethod.findMany({
          where: { kind: { in: [PaymentKind.STORE_CREDIT, PaymentKind.EXCHANGE_CREDIT] } },
          select: { id: true }
        })
      ).map((m) => m.id)
      const priorPaymentWhere = {
          invoice: { ...eventInvoiceContext, issuedAt: { lt: period.from } },
          // ممیزی A88-03 — پرداخت باطل‌شده در دفتر رویداد نمی‌آید (مثل ردیف‌های اصلی پرداخت)
          voidedAt: null,
          ...createdPaymentOwner,
          kind: PaymentEntryKind.CASH,
          ...(creditMethodIds.length ? { methodId: { notIn: creditMethodIds } } : {}),
          ...(window ? { paidAt: window } : {})
        }
      const [priorPayments, priorTotal] = await Promise.all([
        prisma.payment.findMany({
          where: priorPaymentWhere,
        select: {
          id: true, amount: true, paidAt: true, paidAtJalali: true, paidAtTime: true, invoiceId: true,
          createdByUserId: true, createdShiftId: true, destination: true,
          method: { select: { label: true, kind: true } },
          invoice: { select: { receiptNo: true, issuedAtJalali: true, customer: { select: { name: true } }, shift: { select: { name: true } } } }
        },
        orderBy: [{ paidAt: 'asc' }, { id: 'asc' }],
        take: sectionCap
        }),
        prisma.payment.count({ where: priorPaymentWhere })
      ])
      priorSettlementPage = { skip: 0, take: sectionCap, totalCount: priorTotal, truncated: priorTotal > sectionCap }
      if (priorSettlementPage.truncated)
        warnings.push(`دفتر رویداد: ${faDigits(priorTotal)} وصول نسیه‌ی بازه‌های قبل پیدا شد؛ فقط ${faDigits(sectionCap)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`)
      const priorShiftIds = [...new Set(priorPayments.map((p) => p.createdShiftId).filter((x): x is number => x != null))]
      const priorUserIds = [...new Set(priorPayments.map((p) => p.createdByUserId).filter((x): x is number => x != null))]
      const [priorShifts, priorUsers] = await Promise.all([
        chunked(priorShiftIds, (part) => prisma.shift.findMany({ where: { id: { in: part } }, select: { id: true, name: true } })),
        chunked(priorUserIds, (part) => prisma.user.findMany({ where: { id: { in: part } }, select: { id: true, displayName: true } }))
      ])
      const priorShiftName = new Map(priorShifts.map((s) => [s.id, s.name]))
      const priorUserName = new Map(priorUsers.map((u) => [u.id, u.displayName]))
      for (const p of priorPayments) {
        if (p.method?.kind === PaymentKind.STORE_CREDIT || p.method?.kind === PaymentKind.EXCHANGE_CREDIT) continue
        rows.push({
          key: `PAY-${p.id}`,
          eventType: 'CREDIT_SETTLEMENT',
          eventLabel: EVENT_LABELS.CREDIT_SETTLEMENT,
          dateJalali: p.paidAtJalali || toJalaliDate(p.paidAt),
          time: p.paidAtTime || toClock(p.paidAt),
          receiptNo: p.invoice?.receiptNo ?? null,
          documentLabel: `پرداختی نسیه‌ی فاکتور ${faDigits(p.invoice?.receiptNo ?? 0)}`,
          customerName: p.invoice?.customer?.name ?? 'مشتری عمومی',
          userName: p.createdByUserId != null ? priorUserName.get(p.createdByUserId) ?? '—' : '—',
          shiftName: p.createdShiftId != null ? priorShiftName.get(p.createdShiftId) ?? '—' : '—',
          amount: n(p.amount),
          // ممیزی A112-01 — وصول با کارت‌خوان/حساب مدیر/مقصد نامشخص پول است ولی کشو نیست
          cashEffect: drawerCash(p) ? n(p.amount) : 0,
          cashNote: `${drawerCash(p) ? 'نقد کشو' : 'پول غیرکشویی (کارت‌خوان/حساب مدیر/مقصد نامشخص؛ اثر نقدی کشو صفر)'} این بازه، ولی فروشِ این بازه نیست (فاکتور ${faDigits(p.invoice?.issuedAtJalali ?? '—')})`,
          stockEffect: 0,
          invoiceId: p.invoiceId,
          sourceId: p.id,
          sourceKind: 'PAYMENT',
          note: `روش: ${p.method?.label ?? 'پرداخت'}`
        })
      }
    } else {
      notes.push('بازه‌ی گزارش مشخص نیست، پس «وصول نسیه‌ی بازه‌های قبل» در دفتر رویداد قابل تفکیک نیست.')
    }

    // ---------------------- ۵) پاس‌شدن چک ----------------------
    const clearedWhere = {
        invoice: eventInvoiceContext,
        // ممیزی A88-03 — چکِ باطل‌شده «پاس‌شده» شمرده نمی‌شود
        voidedAt: null,
        ...clearedPaymentOwner,
        kind: PaymentEntryKind.CHEQUE,
        chequeStatus: ChequeStatus.CLEARED,
        ...(window ? { clearedAt: window } : {})
      }
    const [cleared, clearedTotal] = await Promise.all([
      prisma.payment.findMany({
        where: clearedWhere,
      select: {
        id: true, amount: true, chequeNo: true, clearedAt: true, clearedShiftId: true,
        createdByUserId: true, clearedByUserId: true, invoiceId: true, destination: true, dueDate: true,
        chequeStatusHistory: {
          where: { status: ChequeStatus.CLEARED },
          orderBy: { id: 'desc' },
          take: 1,
          select: { userId: true }
        },
        invoice: { select: { receiptNo: true, issuedAtJalali: true, customer: { select: { name: true } }, shift: { select: { name: true } } } }
      },
      orderBy: [{ clearedAt: 'asc' }, { id: 'asc' }],
      take: sectionCap
      }),
      prisma.payment.count({ where: clearedWhere })
    ])
    const clearedChequePage = { skip: 0, take: sectionCap, totalCount: clearedTotal, truncated: clearedTotal > sectionCap }
    if (clearedChequePage.truncated)
      warnings.push(`دفتر رویداد: ${faDigits(clearedTotal)} چک پاس‌شده در این بازه است؛ فقط ${faDigits(sectionCap)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`)
    const clearedShiftIds = [...new Set(cleared.map((c) => c.clearedShiftId).filter((x): x is number => x != null))]
    const clearedUserIds = [
      ...new Set(
        cleared
          .map((c) => (c as any).clearedByUserId ?? c.chequeStatusHistory[0]?.userId ?? c.createdByUserId)
          .filter((x): x is number => x != null)
      )
    ]
    const [clearedShifts, clearedUsers] = await Promise.all([
      chunked(clearedShiftIds, (part) => prisma.shift.findMany({ where: { id: { in: part } }, select: { id: true, name: true } })),
      chunked(clearedUserIds, (part) => prisma.user.findMany({ where: { id: { in: part } }, select: { id: true, displayName: true } }))
    ])
    const clearedShiftName = new Map(clearedShifts.map((s) => [s.id, s.name]))
    const clearedUserName = new Map(clearedUsers.map((u) => [u.id, u.displayName]))
    for (const c of cleared) {
      const clearedUserId = (c as any).clearedByUserId ?? c.chequeStatusHistory[0]?.userId ?? c.createdByUserId
      rows.push({
        key: `CHQ-${c.id}`,
        eventType: 'CHEQUE_CLEARED',
        eventLabel: EVENT_LABELS.CHEQUE_CLEARED,
        dateJalali: c.clearedAt ? toJalaliDate(c.clearedAt) : '—',
        time: c.clearedAt ? toClock(c.clearedAt) : '—',
        receiptNo: c.invoice?.receiptNo ?? null,
        documentLabel: `چک ${c.chequeNo ? faDigits(c.chequeNo) : faDigits(c.id)} · فاکتور ${faDigits(c.invoice?.receiptNo ?? 0)}`,
        customerName: c.invoice?.customer?.name ?? 'مشتری عمومی',
        userName: clearedUserId != null ? clearedUserName.get(clearedUserId) ?? '—' : '—',
        shiftName: c.clearedShiftId != null ? clearedShiftName.get(c.clearedShiftId) ?? '—' : '—',
        amount: n(c.amount),
        cashEffect:
          receiptBucketOf({ isCheque: true, destination: c.destination, methodKind: PaymentKind.CUSTOM }) === 'cash'
            ? n(c.amount)
            : 0,
        cashNote:
          c.destination === PaymentDestination.MANAGER
            ? 'چک فقط به حساب مدیر/بانک می‌رود؛ اثر نقدی کشو صفر است'
            : 'مقصد چک نامعتبر یا ثبت‌نشده است؛ اثر نقدی کشو عمداً صفر و در سبد «نامشخص» است',
        stockEffect: 0,
        invoiceId: c.invoiceId,
        sourceId: c.id,
        sourceKind: 'PAYMENT',
        note: c.dueDate ? `سررسید ${faDigits(toJalaliDate(c.dueDate))}` : ''
      })
    }

    // ---------------------- ۶) مصرف اعتبار خرید ----------------------
    /**
     * ممیزی A119-04 (AUDIT-D56) — هر مصرف یک رویداد از دفتر مصرف (StoreCreditRedemption، D1) است، با
     * *همان* redemptionWhere ردیف «مصرف اعتبار خرید» پل و drill آن (A108-02): reversedAt:null، مبلغ و
     * تاریخ خود مصرف، و invoiceId فیلترشده با فیلترهای فاکتوری نوار (شیفت/کارمند/کانال/مشتری/…).
     * قبلاً از StoreCredit.usedAt با مبلغ *اولیه*‌ی اعتبار می‌خواند: مصرف ۳۰۰٬۰۰۰ از اعتبار
     * ۱٬۰۰۰٬۰۰۰ ⇒ ۱٬۰۰۰٬۰۰۰، مصرف‌های قبلی اعتبار چندبارمصرف غایب، مصرف برگشت‌خورده حاضر، و هیچ
     * فیلتری نداشت ⇒ دفتر با پل نمی‌خواند.
     */
    const creditNotes: string[] = []
    const { redemptionWhere, redemptionIds } = await storeCreditScopes(
      {
        where,
        from: period.from,
        to: period.to,
        filter,
        eventShiftIds,
        period: {
          fromJalali: period.from ? toJalaliDate(period.from) : null,
          toJalali: period.to ? toJalaliDate(period.to) : null,
          source: period.source
        }
      },
      creditNotes
    )
    const usedSelect = {
      id: true, creditId: true, code: true, amount: true, seq: true, remainderAfter: true,
      at: true, atJalali: true, atTime: true, invoiceId: true, receiptNo: true, userId: true, shiftId: true
    } as const
    let usedCredits: any[]
    let usedCreditTotal: number
    if (redemptionIds) {
      /**
       * نشست ۱۷۴ · S173-D3 — با فیلتر فاکتوری، مصرف‌های منطبق از قبل دسته‌ای (۵۰۰تایی) به شناسه
       * حل شده‌اند (redemptionIds)؛ به‌جای `invoiceId in` بلند، ردیف‌های سبک (id/at) دسته‌ای خوانده،
       * به همان ترتیب قبلی (at صعودی، سپس id) چیده، sectionCap اول برش و فقط همان‌ها کامل خوانده
       * می‌شوند. شمارش = طول آرایه (همان count قبلی).
       */
      const lite = await liteRowsByIdChunks<{ id: number; at: any }>(
        'storeCreditRedemption', redemptionWhere, redemptionIds, { at: true },
        (a, b) => {
          const ta = new Date(a.at as any).getTime()
          const tb = new Date(b.at as any).getTime()
          return ta !== tb ? ta - tb : Number(a.id) - Number(b.id)
        }
      )
      usedCreditTotal = lite.length
      usedCredits = await rowsForIdsInOrder('storeCreditRedemption', lite.slice(0, sectionCap).map((r) => Number(r.id)), usedSelect)
    } else {
      ;[usedCredits, usedCreditTotal] = await Promise.all([
        prisma.storeCreditRedemption.findMany({
          where: redemptionWhere,
          select: usedSelect,
          orderBy: [{ at: 'asc' }, { id: 'asc' }],
          take: sectionCap
        }),
        prisma.storeCreditRedemption.count({ where: redemptionWhere })
      ])
    }
    const storeCreditsUsedPage = { skip: 0, take: sectionCap, totalCount: usedCreditTotal, truncated: usedCreditTotal > sectionCap }
    if (storeCreditsUsedPage.truncated)
      warnings.push(`دفتر رویداد: ${faDigits(usedCreditTotal)} مصرف اعتبار در این بازه است؛ فقط ${faDigits(sectionCap)} ردیف اول نمایش داده شد. بازه را کوچک‌تر کنید.`)
    const scCreditIds = [...new Set(usedCredits.map((c) => c.creditId))]
    const scUserIds = [...new Set(usedCredits.map((c) => c.userId).filter((x): x is number => x != null))]
    const scShiftIds = [...new Set(usedCredits.map((c) => c.shiftId).filter((x): x is number => x != null))]
    const [scCredits, scUsers, scShifts] = await Promise.all([
      chunked(scCreditIds, (part) =>
        prisma.storeCredit.findMany({
          where: { id: { in: part } },
          select: { id: true, amount: true, customerName: true, issuedAtJalali: true, exchangeInvoiceId: true, returnId: true }
        })
      ),
      chunked(scUserIds, (part) => prisma.user.findMany({ where: { id: { in: part } }, select: { id: true, displayName: true } })),
      chunked(scShiftIds, (part) => prisma.shift.findMany({ where: { id: { in: part } }, select: { id: true, name: true } }))
    ])
    const scCredit = new Map(scCredits.map((c: any) => [c.id, c]))
    const scUserName = new Map(scUsers.map((u: any) => [u.id, u.displayName]))
    const scShiftName = new Map(scShifts.map((s: any) => [s.id, s.name]))
    for (const r of usedCredits) {
      const c: any = scCredit.get(r.creditId) ?? {}
      rows.push({
        key: `SCR-${r.id}`,
        eventType: 'STORE_CREDIT_USED',
        eventLabel: EVENT_LABELS.STORE_CREDIT_USED,
        dateJalali: r.atJalali || toJalaliDate(r.at),
        time: r.atTime || toClock(r.at),
        receiptNo: r.receiptNo ?? null,
        // `code` یک credential قابل‌مصرف است، نه شناسه‌ی نمایشی گزارش؛ reveal آن
        // فقط مسیر manager-only خودِ اعتبار را دارد. دفتر مالی فقط شماره مصرف را نشان می‌دهد.
        documentLabel: `مصرف اعتبار خرید · نوبت ${faDigits(r.seq)}`,
        customerName: c.customerName ?? 'مشتری عمومی',
        userName: r.userId != null ? scUserName.get(r.userId) ?? '—' : '—',
        shiftName: r.shiftId != null ? scShiftName.get(r.shiftId) ?? '—' : '—',
        amount: n(r.amount),
        cashEffect: 0,
        cashNote:
          'کالا از انبار خارج شد ولی وجه نقد جدیدی دریافت نشد؛ بابت اعتبار صادرشده در تاریخ ' +
          `${faDigits(c.issuedAtJalali || '—')}` +
          (c.exchangeInvoiceId ? ` از سند تعویض ${faDigits(c.exchangeInvoiceId)}` : '') +
          (c.returnId ? ` (سند برگشت ${faDigits(c.returnId)})` : ''),
        stockEffect: 0,
        invoiceId: r.invoiceId ?? null,
        sourceId: r.id,
        sourceKind: 'STORE_CREDIT',
        note:
          (c.amount != null ? `مبلغ اولیه‌ی اعتبار ${money(n(c.amount))} ریال · باقی‌مانده بعد از این مصرف ${money(n(r.remainderAfter))} ریال. ` : '') +
          'خروج کالا در ردیف «فروش» فاکتور مقصد شمرده شده است؛ اینجا دوباره شمرده نمی‌شود.'
      })
    }
    notes.push(...creditNotes)
    if (usedCredits.length)
      notes.push('مصرف اعتبار خرید با تاریخ خود هر مصرف (نه تاریخ صدور اعتبار) و با فیلترهای فاکتوری نوار روی فاکتور مقصد فیلتر می‌شود؛ مصرف برگشت‌خورده شمرده نمی‌شود.')

    rows.sort((a, b) => (a.dateJalali + a.time > b.dateJalali + b.time ? 1 : -1))

    const totals = {
      count: rows.length,
      amount: rows.reduce((s, r) => s + r.amount, 0),
      cashIn: rows.filter((r) => r.cashEffect > 0).reduce((s, r) => s + r.cashEffect, 0),
      cashOut: rows.filter((r) => r.cashEffect < 0).reduce((s, r) => s + Math.abs(r.cashEffect), 0),
      netCash: rows.reduce((s, r) => s + r.cashEffect, 0),
      stockIn: rows.filter((r) => r.stockEffect > 0).reduce((s, r) => s + r.stockEffect, 0),
      stockOut: rows.filter((r) => r.stockEffect < 0).reduce((s, r) => s + Math.abs(r.stockEffect), 0)
    }

    return {
      period: {
        fromJalali: period.from ? toJalaliDate(period.from) : null,
        toJalali: period.to ? toJalaliDate(period.to) : null,
        source: period.source
      },
      rows,
      sections: {
        invoices: invoicePage,
        returns: returnPage,
        priorSettlements: priorSettlementPage,
        clearedCheques: clearedChequePage,
        storeCreditsUsed: storeCreditsUsedPage
      },
      totals,
      warnings,
      notes
    }
  }
}
