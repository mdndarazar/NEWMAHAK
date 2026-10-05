/**
 * ممیزی A94-01 / A94-02 — منطق مشترک خروجی (صفحه، چاپ A4، Excel) تب‌های legacy
 * «اعتبار خرید» و «بازبینی ضدتقلب». قبلاً هر سه مسیر نگاشت را جدا و دست‌نویس داشتند و
 * عددها با هم نمی‌خواندند؛ این فایل خالص است (بدون React/Electron) تا رفتارش با هارنس سنجیده شود.
 */
import { faDigits, money } from './jalali'

/** وضعیت‌هایی که هنوز «بدهی زنده‌ی فروشگاه» هستند — هم‌معنا با liabilityTotal در StoreCreditService. */
export const CREDIT_OUTSTANDING_STATUSES = ['ACTIVE', 'PARTIALLY_USED'] as const

const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0)

/**
 * مانده‌ی قابل مصرف یک اعتبار (بدهی زنده‌ی ما). اعتبار لغوشده/منقضی/معلق/مصرف‌شده حتی اگر
 * amount − usedAmount آن مثبت باشد، دیگر قابل خرج نیست و نباید در «مانده» جمع شود.
 */
export function creditOutstandingOf(row: any): number {
  const status = String(row?.status ?? '').toUpperCase()
  if (!(CREDIT_OUTSTANDING_STATUSES as readonly string[]).includes(status)) return 0
  if (row?.expired === true) return 0
  const remaining = row?.remaining ?? row?.remainingAmount
  if (remaining != null) return Math.max(0, num(remaining))
  return Math.max(0, num(row?.amount ?? row?.total) - num(row?.usedAmount ?? row?.redeemedAmount))
}

/** اعتبارهای «فعال در پایان بازه» = همه‌ی ردیف‌هایی که مانده‌ی زنده دارند (شامل مصرف بخشی). */
export function outstandingCreditRows<T = any>(rows: T[]): T[] {
  return (Array.isArray(rows) ? rows : []).filter((r: any) => {
    const status = String(r?.status ?? '').toUpperCase()
    return (CREDIT_OUTSTANDING_STATUSES as readonly string[]).includes(status) && r?.expired !== true
  })
}

export const FRAUD_SEVERITY_LABELS: Record<string, string> = {
  HIGH: 'نیاز به بررسی فوری',
  MEDIUM: 'الگوی مشکوک',
  INFO: 'فقط اطلاع'
}

export interface FraudOutputRow {
  group: string
  severity: string
  dateJalali: string | null
  time: string | null
  receiptNo: string | number | null
  userName: string | null
  amount: number
  note: string | null
}

const sourceListOf = (g: any): any[] =>
  Array.isArray(g?.rows) ? g.rows : Array.isArray(g?.items) ? g.items : Array.isArray(g?.sources) ? g.sources : []

/**
 * ردیف‌های تخت خروجی ضدتقلب. هر سند منبع یک ردیف با «شرح» خودش (label) می‌گیرد؛ پرچمی که
 * count>0 دارد ولی سند منبع قابل فهرستی ندارد (مثل «چک برگشتی» که فقط aggregate است) یک ردیف
 * خلاصه با مبلغ/تعداد/توضیح خود پرچم می‌گیرد تا از چاپ/Excel حذف نشود.
 */
export function fraudOutputRows(groups: any[], groupLabel: (g: any) => string): FraudOutputRow[] {
  const out: FraudOutputRow[] = []
  for (const g of Array.isArray(groups) ? groups : []) {
    const group = groupLabel(g)
    const severity = FRAUD_SEVERITY_LABELS[String(g?.severity ?? '')] ?? (g?.severity ? String(g.severity) : '')
    const sources = sourceListOf(g)
    if (sources.length) {
      for (const r of sources) {
        const note = [r?.label, r?.note ?? r?.hint].filter((t) => t != null && String(t).trim() !== '').join(' · ')
        out.push({
          group,
          severity,
          dateJalali: r?.dateJalali ?? r?.atJalali ?? null,
          time: r?.time ?? null,
          receiptNo: r?.receiptNo ?? null,
          userName: r?.userName ?? r?.cashierName ?? null,
          amount: num(r?.amount ?? r?.total ?? r?.value ?? 0),
          note: note || null
        })
      }
    } else {
      const count = num(g?.count)
      const detail = String(g?.detail ?? g?.hint ?? '').trim()
      out.push({
        group,
        severity,
        dateJalali: null,
        time: null,
        receiptNo: null,
        userName: null,
        amount: num(g?.amount ?? g?.total ?? 0),
        note: `${detail ? `${detail} · ` : ''}خلاصه‌ی پرچم: ${count} مورد؛ سند منبع قابل فهرست ندارد`
      })
    }
  }
  return out
}

/**
 * ممیزی A106-02 (AUDIT-D38) — عنوان جدول دفتر رویداد روی صفحه. دفتر هر بخش را در سقف نمایشی
 * (۴٬۰۰۰) می‌بُرد (S106-1)؛ جمع اثر نقدی ردیف‌های بریده نباید «جمع دفتر» معرفی شود. با برش هر
 * بخش، عدد صریحاً «جمع ردیف‌های نمایش‌داده‌شده» برچسب می‌خورد و به خروجی کامل ارجاع می‌دهد.
 */
export function ledgerCashTitle(ledger: any): string {
  const rows: any[] = Array.isArray(ledger?.rows) ? ledger.rows : []
  const cashSum = rows.reduce((a, r) => a + num(r?.cashEffect), 0)
  const sections = ledger?.sections && typeof ledger.sections === 'object' ? Object.values(ledger.sections) : []
  const truncated = (sections as any[]).some((sec) => sec?.truncated === true)
  if (!truncated) return `دفتر رویداد — جمع اثر نقدی: ${money(cashSum)}`
  return (
    `دفتر رویداد — جمع اثر نقدی ردیف‌های نمایش‌داده‌شده: ${money(cashSum)} ` +
    '(دفتر بریده شده؛ این عدد جمع کل بازه نیست — برای جمع کامل بازه را کوچک‌تر کنید یا خروجی Excel کامل بگیرید)'
  )
}

/**
 * ممیزی A108-03 — نوار صفحه و هشدار drill-down پل تطبیق (سرویس + UI از یک منطق).
 * قبلاً هر دو فقط با `truncated` روشن می‌شدند؛ در صفحه‌ی آخر (skip>0، truncated=false) نه هشداری بود و
 * نه «صفحه قبل» ⇒ بخشی از اسناد با جمعی ≠ عدد ردیف، بی‌قید، به‌عنوان فهرست کامل دیده می‌شد.
 * قاعده: هر وقت صفحه همه‌ی اسناد را ندارد (skip>0 یا باقی‌مانده دارد) نوار و متن «X تا Y از N» نمایش.
 */
export function bridgeDrillPager(
  page: { skip?: number; take?: number; totalCount?: number; truncated?: boolean } | null | undefined,
  shown: number
): { show: boolean; pageNo: number; pageCount: number; canPrev: boolean; canNext: boolean; prevSkip: number; nextSkip: number; warning: string | null } {
  const skip = Math.max(0, num(page?.skip))
  const take = Math.max(1, num(page?.take) || 1)
  const total = Math.max(0, num(page?.totalCount))
  const count = Math.max(0, num(shown))
  const canNext = !!page && (page.truncated === true || skip + count < total)
  const canPrev = !!page && skip > 0
  const show = canPrev || canNext
  const pageNo = Math.floor(skip / take) + 1
  const pageCount = Math.max(pageNo, Math.ceil(total / take))
  const from = count ? skip + 1 : skip
  const warning = show
    ? `فقط بخشی از اسناد سازنده: نمایش ${faDigits(from)} تا ${faDigits(skip + count)} از ${faDigits(total)} سند` +
      ` (صفحه ${faDigits(pageNo)} از ${faDigits(pageCount)})؛ جمع این صفحه عدد ردیف نیست.`
    : null
  return { show, pageNo, pageCount, canPrev, canNext, prevSkip: Math.max(0, skip - take), nextSkip: skip + take, warning }
}

/**
 * ممیزی A121-01 (AUDIT-D58) — خروجی «فقط صفحه‌ی جاری» گزارش فروش.
 * قبل: فقط page.truncated هشدار می‌ساخت ⇒ صفحه‌ی آخر (skip>0 و truncated=false) بی‌نشان مثل گزارش
 * کامل چاپ/Excel می‌شد و صفحه‌ی میانی «X تا Y» نداشت. این سه تابع خالص‌اند تا با هارنس سنجیده شوند.
 */
export interface OutputPageLike {
  skip?: number
  take?: number
  totalCount?: number
  truncated?: boolean
}

const pageSkipOf = (page: OutputPageLike | null | undefined): number => Math.max(0, num(page?.skip))

/** صفحه فقط بخشی از بازه است؟ (صفحه‌ی اول/میانی برش‌خورده، یا هر صفحه‌ای بعد از اول) */
const isPartialOutputPage = (page: OutputPageLike | null | undefined): boolean =>
  !!page && typeof page === 'object' && (page.truncated === true || pageSkipOf(page) > 0)

/** نشان صریح «نمایش X تا Y از N» برای هر صفحه‌ی جزئی؛ خروجیِ کامل تک‌صفحه‌ای ⇒ null. */
export function outputPageRangeNote(page: OutputPageLike | null | undefined, shown: number, noun: string): string | null {
  if (!isPartialOutputPage(page)) return null
  const total = Math.max(0, num(page?.totalCount))
  const n = Math.max(0, num(shown))
  if (!n) return `بازه‌ی ردیف‌های این خروجی: ۰ ${noun} از ${faDigits(total)}`
  const from = pageSkipOf(page) + 1
  return `بازه‌ی ردیف‌های این خروجی: نمایش ${faDigits(from)} تا ${faDigits(from + n - 1)} از ${faDigits(total)} ${noun}`
}

/** صفحه‌ی آخر (skip>0، بدون برش بعدی): هشدار صریح که فایل کل گزارش نیست و جمعش جمع صفحه است. */
export function outputLastPageNotes(page: OutputPageLike | null | undefined, _shown: number, _noun: string): string[] {
  if (!page || typeof page !== 'object' || page.truncated === true || pageSkipOf(page) <= 0) return []
  return [
    'هشدار خروجی: این چاپ/فایل فقط صفحه‌ی آخر است، نه کل گزارش؛ ردیف‌های صفحه‌های قبل در آن نیست.',
    'جمع مبلغ ردیف‌های این فایل فقط همین صفحه است؛ جمع کل بازه را فقط از جمع مستقل endpoint بخوانید.'
  ]
}

/** «جزئیات فروش» بر حسب فاکتور صفحه‌بندی می‌شود (A99-02) ولی ردیف‌ها قلم‌اند ⇒ واحد نمایش = فاکتورهای یکتا. */
export function shownInvoiceUnits(rows: Array<{ invoiceId?: unknown }> | null | undefined): number {
  if (!Array.isArray(rows)) return 0
  return new Set(rows.map((r) => r?.invoiceId).filter((id) => id != null)).size
}
