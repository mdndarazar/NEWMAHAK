import { prisma } from '../db/client'
import {
  saleWhere,
  resolveReportPeriod,
  returnReportScopeWhere,
  chequeReportWhere,
  salesService
} from './SalesService'
import { storeCreditService } from './StoreCreditService'
import { ReturnKind } from '@shared/enums'
import { jalaliToday, toJalaliDate, faDigits } from '@shared/jalali'
import type { SaleReportFilter, SaleReportLimits, SaleReportLimitRow } from '@shared/types'

/**
 * ===========================================================================
 * بند ۵ سند مرجع — «هیچ گزارش بزرگی بی‌صدا ناقص نشود».
 *
 * ================== مسئله‌ای که این فایل حل می‌کند ==================
 * تب سرجمع از جلسه ۱۴ صفحه‌بندی واقعی دارد (`skip`/`take` + `totalCount` +
 * هشدار برش). ولی پنج مجموعه‌ی دیگر — جزئیات فروش، برگشت، تعویض، چک و اعتبار
 * خرید — هرکدام یک **آرایه‌ی ساده** برمی‌گردانند و سقف خواندنشان (۳۰۰۰ / ۵۰۰ /
 * ۱۰۰۰ / ۵۰۰ / ۱۰۰۰) در سکوت اعمال می‌شود. برای یک فروشگاه شلوغ در گزارش
 * ماهانه، یعنی جدولی که *کامل به نظر می‌رسد* ولی نیست — و کسری واقعی می‌تواند
 * دقیقاً لای همان برشِ نامرئی گم شود.
 *
 * ================== چرا یک کانال جدا، نه تغییر شکل آن پنج کانال ==================
 * تغییر شکل خروجی آن پنج کانال، هم‌زمان پنل «برگشت از فروش» و پنجره‌ی «جزئیات
 * شیفت» را می‌شکست. این فایل فقط `count()` می‌زند: صفر تغییر در مسیر داده‌ی
 * موجود، و نوار قرمز «نمایش N از M ردیف» روی همه‌ی تب‌ها.
 *
 * ⚠️ فیلترها عیناً از همان توابع خودِ گزارش می‌آیند (`saleWhere` و
 * `channelOrderTypeFilter`)؛ اگر اینجا دوباره نوشته می‌شدند، «تعداد کل» با
 * ردیف‌های جدول واگرا می‌شد و خودِ هشدار دروغ می‌گفت.
 * ===========================================================================
 */

/** سقف‌های واقعیِ سرویس‌ها. هر عدد اینجا باید با سقف همان متد یکی باشد. */
export const REPORT_CAPS = {
  invoices: 500,
  items: 3000,
  /** نشست ۱۱۷ — همان CREDIT_PAGE_MAX سرویس نسیه */
  credit: 5000,
  returns: 500,
  exchanges: 1000,
  cheques: 500,
  storeCredits: 1000
} as const

const row = (
  key: string,
  label: string,
  total: number,
  cap: number,
  what: string
): SaleReportLimitRow => {
  const truncated = total > cap
  return {
    key,
    label,
    total,
    cap,
    truncated,
    note: truncated
      ? `نمایش ${faDigits(cap)} از ${faDigits(total)} ${what} — این جدول به سقف نمایش خورده است. ` +
        'بازه را کوچک‌تر کنید (مثلاً هفته‌به‌هفته) تا هیچ ردیفی جا نماند؛ ' +
        'جمع‌های صورت‌های حسابداری بالای صفحه روی کل بازه حساب شده‌اند و ناقص نیستند.'
      : `${faDigits(total)} ${what} در این بازه (سقف نمایش ${faDigits(cap)}) — کامل نمایش داده می‌شود.`
  }
}

export const reportLimitsService = {
  /**
   * شمارش کل هر مجموعه در برابر سقفش. فقط `count()` — هیچ ردیفی خوانده و هیچ
   * داده‌ای تغییر نمی‌کند.
   */
  async limits(filter: SaleReportFilter & { includeExchanges?: boolean; includeSettled?: boolean } = {}): Promise<SaleReportLimits> {
    const where = saleWhere(filter)
    const period = await resolveReportPeriod(filter, where)
    const fromJalali = filter.fromJalali ?? (period.from ? toJalaliDate(period.from) : null)
    const toJalali = filter.toJalali ?? (period.to ? toJalaliDate(period.to) : null)

    // برگشت/تعویض/چک/اعتبار با همان قاعده‌ی خودِ لیست‌ها فیلتر می‌شوند
    const from = fromJalali ?? jalaliToday()
    const to = toJalali ?? from
    /**
     * ممیزی A99-03/A99-04 (AUDIT-D28/D29) — برگشت/تعویض/چک همان where خودِ جدول‌ها را می‌شمارند
     * (returnReportScopeWhere / chequeReportWhere)، نه بازسازی موازی. قبلاً با shiftId بازه‌ی صریح
     * کنار گذاشته می‌شد، shiftNumber و «وضعیت» نوار نادیده بود، و چک مالک را روی فاکتور مادر و
     * تاریخ را همیشه روی سررسید می‌زد ⇒ جدول ۱ چک، شمارنده ۰. شمارنده بازه‌ی خام کاربر را می‌گیرد
     * (نه بازه‌ی resolve‌شده)، چون جدول‌ها هم همان را می‌گیرند.
     */
    const returnScope = await returnReportScopeWhere(filter)
    const chequeWhere = await chequeReportWhere(filter as any)

    const [invoices, returns, exchanges, cheques, creditList, creditInvoices] = await Promise.all([
      prisma.saleInvoice.count({ where }),
      prisma.saleReturn.count({
        where: {
          ...returnScope,
          // kind در schema اجباری است؛ شمارنده باید دقیقاً همان «برگشت ساده»ی جدول را بشمارد.
          ...(filter.includeExchanges === true ? {} : { kind: ReturnKind.RETURN })
        }
      }),
      prisma.saleReturn.count({ where: { ...returnScope, kind: ReturnKind.EXCHANGE } }),
      prisma.payment.count({ where: chequeWhere }),
      /**
       * تب legacy اعتبار تنها روی StoreCredit scalar referenceها فیلتر می‌کند
       * و منطقش در StoreCreditService است. یک ردیف می‌خوانیم، اما totalCount
       * واقعیِ همان where را از metadata می‌گیریم تا فیش/مشتری/کالا/کانال/
       * کارمند/شیفت از شمارش حذف نشوند.
       */
      /**
       * ممیزی A100-01 (AUDIT-D31) — همان کانال تب (reportList): «وضعیت» نوار = وضعیت *فاکتور*.
       * قبلاً list خام صدا زده می‌شد ⇒ «تسویه شده» به‌عنوان وضعیت اعتبار ⇒ شمارنده ۰ و جدول ۶.
       */
      storeCreditService
        .reportList({
          ...(filter as any),
          fromJalali: from,
          toJalali: to,
          mode: 'issued',
          take: 1,
          skip: 0
        } as any)
        .then((result) => result.page.totalCount),
      /**
       * ممیزی A105-01 (AUDIT-D36) — ردیف «نسیه» همان کانال جدول تب (creditList) را می‌شمارد.
       * قبلاً count همه‌ی فاکتورهای saleWhere (حتی تسویه‌شده) بود ⇒ ۶٬۰۰۰ فاکتور نقدی بی‌نسیه ⇒ نوار
       * قرمز کاذب «نمایش ۵٬۰۰۰ از ۶٬۰۰۰»؛ با فقط shiftId یا «وضعیت» نوار هم جدول ۱ و شمارنده ۴.
       * دروازه‌ی DRAFT/CANCELED (REPORT_EXCLUDED_SALE_STATUSES) داخل خود creditList برقرار است.
       */
      salesService
        .creditList({
          ...(filter as any),
          includeSettled: filter.includeSettled === true,
          take: 1,
          skip: 0,
          priorTake: 1,
          priorSkip: 0
        })
        /**
         * نشست ۱۸۰ (S180-D13، گام ۰ خوشه M): در `CreditReportResult` فیلد
         * `page` اختیاری است (TS18048)، هرچند پیاده‌سازی فعلی `creditList`
         * همیشه آن را ست می‌کند. fallback عمداً `rows.length` است نه صفر:
         * صفر یعنی «هیچ ردیفی نیست» و می‌توانست یک برش واقعی را پنهان کند،
         * که دقیقاً خلاف معیار مالک است.
         */
        .then((result) => result.page?.totalCount ?? result.rows.length)
    ])

    const rows: SaleReportLimitRow[] = [
      row('invoices', 'سرجمع فروش', invoices, REPORT_CAPS.invoices, 'فاکتور'),
      row('items', 'جزئیات فروش (بر مبنای فاکتور)', invoices, REPORT_CAPS.items, 'فاکتور'),
      row('credit', 'نسیه', creditInvoices, REPORT_CAPS.credit, 'فاکتور'),
      row('returns', 'برگشت از فروش', returns, REPORT_CAPS.returns, 'سند برگشت'),
      row('exchanges', 'تعویض کالا', exchanges, REPORT_CAPS.exchanges, 'سند تعویض'),
      row('cheques', 'چک‌ها', cheques, REPORT_CAPS.cheques, 'چک'),
      row('storeCredits', 'اعتبار خرید', creditList, REPORT_CAPS.storeCredits, 'اعتبار')
    ]

    const warnings = rows.filter((r) => r.truncated).map((r) => `«${r.label}»: ${r.note}`)
    return { fromJalali, toJalali, periodSource: period.source, rows, warnings }
  }
}
