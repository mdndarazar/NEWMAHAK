/**
 * ===========================================================================
 * جلسه ۲۵ — «تصمیم‌های چاپ سند اعتبار» به‌صورت منطق خالص و قابل‌تست
 *
 * چرا این فایل ساخته شد؟ چون کل مسیر چاپ/PDF ماژول اعتبار (جلسه ۲۱ در بک‌اند،
 * جلسه ۲۴ در UI) هیچ‌وقت روی برنامه‌ی اجراشده تست نشده و در محیط بدون
 * `npm`/Electron هم قابل اجرا نیست: `PrintService` به `electron` و `@prisma/client`
 * وابسته است، پس هیچ تستی نمی‌تواند آن را import کند.
 *
 * پس عیناً همان قاعده‌ی `creditUi.ts` (جلسه ۲۲) اینجا هم اجرا شد: هر چیزی که
 * «تصمیم» است (تکی یا دسته‌ای؟ چند سند در هر صفحه؟ کدام idها؟ نام فایل؟) از
 * `PrintService` بیرون کشیده شد و اینجا نشست تا `test/credit-print-logic-session25.ts`
 * بتواند **واقعاً** اجرایش کند. رفتار عوض نشده؛ فقط جایش عوض شده — با دو استثنای
 * عمدی که پایین مستند شده‌اند.
 *
 * ⚠️ §۲۱ (اعتبارسنجی Backend): `perPage` و `ids` از renderer می‌آیند، یعنی
 * غیرقابل‌اعتمادند. قبلاً `perPage` مستقیم داخل CSS قالب می‌رفت؛ یک `perPage: 0`
 * یا `perPage: 1e9` از DevTools رندر را نابود می‌کرد. اینجا کلمپ می‌شود.
 * ===========================================================================
 */

/** سقف عمدی سند در هر فایل/Job — بیشتر از این، رندر مرورگر و پرینتر زمین می‌خورند (§۵). */
export const CREDIT_PRINT_MAX_DOCS = 2000

/** سقف منطقی «چند سند در هر صفحه» (§۲۱ — ورودی UI قابل‌اعتماد نیست). */
export const CREDIT_PER_PAGE_MAX = 12

export interface CreditPrintTarget {
  id?: number | null
  batchId?: number | null
  ids?: unknown
  perPage?: unknown
}

export interface CreditPaper {
  widthMm: number
  heightMm: number | null
}

export interface CreditPrintPlan {
  /** «تکی» فقط وقتی id داده شده و نه batchId و نه ids (عیناً قاعده‌ی جلسه ۲۱). */
  mode: 'single' | 'batch'
  id: number | null
  batchId: number | null
  /** فهرست صریح idها (اگر کاربر ردیف‌ها را انتخاب کرده باشد) — پاک و یکتا و مرتب. */
  ids: number[]
  /** تعداد درخواست‌شده قبل از اعمال سقف. */
  requested: number
  /** آیا سقف `CREDIT_PRINT_MAX_DOCS` خورده است (باید به کاربر گفته شود). */
  capped: boolean
  perPage: number
  fileName: string
}

/** idهای ورودی: عدد صحیح مثبت، بدون تکرار، مرتب. (دوقلوی `cleanIds` در creditUi) */
export function cleanCreditIds(list: unknown): number[] {
  if (!Array.isArray(list)) return []
  const out: number[] = []
  for (const x of list) {
    const n = Math.round(Number(x))
    if (Number.isFinite(n) && n > 0 && !out.includes(n)) out.push(n)
  }
  return out.sort((a, b) => a - b)
}

/**
 * چند سند در هر صفحه.
 * رسید حرارتی ارتفاع آزاد دارد ⇒ هر صفحه یک سند. A4 ⇒ ۴، A5 ⇒ ۲، A6 ⇒ ۱.
 * (عیناً عددهای جلسه ۲۱؛ فقط حالا ورودی دستی کلمپ می‌شود — §۲۱.)
 */
export function creditBatchPerPage(paper: CreditPaper, override?: unknown): number {
  const n = Math.round(Number(override))
  if (Number.isFinite(n) && n > 0) return Math.min(CREDIT_PER_PAGE_MAX, n)
  if (paper.heightMm == null) return 1
  if (paper.heightMm >= 290) return 4
  if (paper.heightMm >= 200) return 2
  return 1
}

/** نام پیش‌فرض فایل PDF. */
export function creditPdfFileName(plan: Pick<CreditPrintPlan, 'mode' | 'id' | 'batchId'>): string {
  return plan.mode === 'single'
    ? `credit-${plan.id ?? 0}.pdf`
    : `credit-batch-${plan.batchId ?? 'list'}.pdf`
}

/**
 * نقشه‌ی یک عملیات چاپ/PDF. هیچ دسترسی به DB یا Electron ندارد ⇒ قابل تست.
 * `resolvedIds` را فراخوان (PrintService) بعد از خواندن دسته از دیتابیس می‌دهد؛
 * `applyIds` سقف را روی همان فهرست هم اعمال می‌کند تا هر دو مسیر یک قاعده داشته باشند.
 */
export function creditPrintPlan(input: CreditPrintTarget, paper: CreditPaper): CreditPrintPlan {
  const id = Math.round(Number(input?.id ?? 0)) || 0
  const batchId = Math.round(Number(input?.batchId ?? 0)) || 0
  const ids = cleanCreditIds(input?.ids)
  const single = !!id && !batchId && !ids.length
  const capped = ids.length > CREDIT_PRINT_MAX_DOCS
  const plan: CreditPrintPlan = {
    mode: single ? 'single' : 'batch',
    id: id || null,
    batchId: batchId || null,
    ids: capped ? ids.slice(0, CREDIT_PRINT_MAX_DOCS) : ids,
    requested: single ? 1 : ids.length,
    capped,
    perPage: creditBatchPerPage(paper, input?.perPage),
    fileName: ''
  }
  plan.fileName = creditPdfFileName(plan)
  return plan
}

/** سقف سند را روی فهرستی که از دیتابیس درآمده اعمال می‌کند (مسیر `batchId`). */
export function applyCreditPrintCap(ids: number[]): { ids: number[]; requested: number; capped: boolean } {
  const clean = cleanCreditIds(ids)
  return {
    ids: clean.slice(0, CREDIT_PRINT_MAX_DOCS),
    requested: clean.length,
    capped: clean.length > CREDIT_PRINT_MAX_DOCS
  }
}
