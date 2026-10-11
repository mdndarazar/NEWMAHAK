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

/**
 * ===========================================================================
 * نشست ۳۱۷ · طرح کلاد (برنده‌ی داوری) — «مشخصات طرح چاپ سند اعتبار»
 *
 * تنظیمات تازه (printFontPx ۶..۲۲، حاشیه ۰..۲۰، پیش‌فرض‌ها ۱۱/۴/۵) به‌جای
 * دست‌زدن به `creditCss` تاریخی، این‌جا به یک layout حساب‌شده تبدیل می‌شوند:
 *   • نقش‌های تایپو = مقدار تاریخی × (پایه ÷ ۱۱) — ۱۴/۱۲/۱۷/۱۵/۹/۱۰
 *   • ضریب برای پایه‌ی ۱۱ دقیقاً ۱ است ⇒ اعداد تاریخی عیناً برمی‌گردند
 *   • حاشیه در دو مرحله clamp می‌شود: تنظیمات (۰..۲۰) و بعد «حداکثر نصفِ
 *     (بُعد کاغذ − ۳۰mm)» تا روی کاغذ کوچک هم عرض محتوا کمتر از ۳۰mm نشود
 *   • `isLegacy` (هر سه = پیش‌فرض) یعنی قالب باید رشته‌ی CSS تاریخی را
 *     بایت‌به‌بایت برگرداند — صفر رگرسیون برای مشتریانِ بدون اکشن
 *
 * این فایل خالص می‌ماند: نه Electron، نه Prisma، نه import از credit.ts
 * (الفبای تنظیمات را فراخوان خودش کلمپ می‌کند؛ دو بار کلمپ = یک نتیجه).
 * ===========================================================================
 */

export const CREDIT_PRINT_LEGACY_FONT_PX = 11

export interface CreditPrintLayout {
  /** اندازه‌ی فونت پایه (px) */
  fontPx: number
  /** ضریب نسبت به CSS تاریخی = fontPx / ۱۱ (برای ۱۱ دقیقاً ۱) */
  scale: number
  /** حاشیه‌های نهاییِ قابل‌چاپ بعد از هر دو clamp (mm) */
  marginXMm: number
  marginYMm: number
  /** اندازه‌ی نهایی هر نقش تایپوگرافی (گرد به ۰٫۱px) */
  px: { h1: number; kind: number; amount: number; code: number; rules: number; reprint: number }
  letterSpacingPx: number
  /** همه‌ی سه تنظیم بر روی پیش‌فرض‌اند ⇒ مسیر بایت‌به‌بایت قدیمی */
  isLegacy: boolean
}

const creditPxLegacyRoles = { h1: 14, kind: 12, amount: 17, code: 15, rules: 9, reprint: 10 } as const
const creditPxLegacyLetterSpacing = 1.5

const clampInt = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const round1px = (n: number): number => Math.round(n * 10) / 10

export function creditLayout(
  settings: { printFontPx?: unknown; printMarginXMm?: unknown; printMarginYMm?: unknown },
  paper: CreditPaper
): CreditPrintLayout {
  const fontPx = clampInt(settings?.printFontPx, CREDIT_PRINT_LEGACY_FONT_PX, 6, 22)
  const marginXSet = clampInt(settings?.printMarginXMm, 4, 0, 20)
  const marginYSet = clampInt(settings?.printMarginYMm, 5, 0, 20)
  const isLegacy = fontPx === CREDIT_PRINT_LEGACY_FONT_PX && marginXSet === 4 && marginYSet === 5
  const scale = fontPx / CREDIT_PRINT_LEGACY_FONT_PX
  // clamp دوم: عرض محتوا (کاغذ − دو حاشیه) هرگز زیر ۳۰mm نرود؛ رول حرارتی فقط عرض clamp دارد
  const marginXMm = Math.min(marginXSet, Math.max(0, round1px((paper.widthMm - 30) / 2)))
  const marginYMm =
    paper.heightMm != null ? Math.min(marginYSet, Math.max(0, round1px((paper.heightMm - 30) / 2))) : marginYSet
  const px = {
    h1: round1px(creditPxLegacyRoles.h1 * scale),
    kind: round1px(creditPxLegacyRoles.kind * scale),
    amount: round1px(creditPxLegacyRoles.amount * scale),
    code: round1px(creditPxLegacyRoles.code * scale),
    rules: round1px(creditPxLegacyRoles.rules * scale),
    reprint: round1px(creditPxLegacyRoles.reprint * scale)
  }
  return {
    fontPx,
    scale,
    marginXMm,
    marginYMm,
    px,
    letterSpacingPx: round1px(creditPxLegacyLetterSpacing * scale),
    isLegacy
  }
}

/**
 * سند بزرگ‌تر ⇒ در هر صفحه‌ی batch کمتر جا می‌شود (بدون آن، صفحه‌ها می‌شکنند).
 * با فونت کوچک‌تر هرگز تعداد بیشتر نمی‌شود: گارد ضدتله «افزایش بی‌صدا» (همان
 * قانعت‌های جلسه ۲۱). سقف/کف‌ها همان CREDIT_PER_PAGE_MAX و ۱.
 */
export function creditEffectivePerPage(perPage: number, layout: CreditPrintLayout): number {
  const n = Math.round(Number(perPage))
  const base = Number.isFinite(n) && n > 0 ? Math.min(CREDIT_PER_PAGE_MAX, n) : 1
  if (layout.scale <= 1) return base
  return Math.max(1, Math.floor(base / layout.scale))
}
