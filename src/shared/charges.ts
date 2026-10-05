/**
 * ---------------------------------------------------------------------------
 * «عوارض و مالیات» و «حق سرویس» بر اساس دسته‌بندی کالا — منبع واحد و رسمی.
 *
 * چرا اینجا (shared)؟ هم renderer (پنل‌های تنظیم مقدار، پنل فروش تکی و فاکتور
 * فروش عمده) و هم main (چاپ و محاسبه‌ی سمت سرور) به یک محاسبه‌ی *یکسان* نیاز
 * دارند. اگر هر کدام خودش حساب می‌کرد، عدد روی فاکتور و عدد روی رسید چاپی از
 * هم واگرا می‌شد.
 *
 * ⚠️ تغییر مهم این نسخه — دو «اسکوپ» کاملاً مستقل:
 * قبلاً دو سیستم موازی وجود داشت: این فایل (بر اساس دسته‌بندی، ولی بلااستفاده)
 * و یک درصد سراسری در `settings.sale.taxPercent` که فقط در پنل فروش کار می‌کرد
 * (و در فاکتور عمده مالیات هاردکد صفر بود). حالا فقط همین فایل معتبر است و
 * تنظیماتش برای هر پنل جداگانه ذخیره می‌شود:
 *
 *   charges.tax.pos       · charges.service.pos       → پنل فروش خرد (Pos)
 *   charges.tax.wholesale · charges.service.wholesale → فاکتور فروش عمده
 *
 * یعنی تغییر مقدار در یکی، هیچ اثری روی آن یکی ندارد.
 *
 * قاعده‌ی ارث‌بری: مقدار روی «مردانه» به‌طور خودکار برای زیردسته‌ی «شلوار
 * نیم‌بگ مردانه» هم اعمال می‌شود، مگر این‌که خودِ زیردسته مقدار جدا داشته باشد
 * (نزدیک‌ترین دسته‌ی دارای مقدار برنده است).
 *
 * نشست ۱۵۶ (S151-c2، بند ۴-۴۵): «۰» دقیقاً صفر است و از والد/پیش‌فرض ارث نمی‌برد.
 *   - «تنظیم‌نشده» = هیچ قانونی برای آن دسته در `rules` نیست ⇒ ارث از والد، بعد `fallback`.
 *   - «عمداً صفر» = قانونی با value=0 ⇒ همان‌جا توقف، مبلغ صفر.
 * قبلاً قانون صفر هنگام ذخیره حذف و در جست‌وجو نادیده گرفته می‌شد ⇒ «۰٪» زیردسته
 * بی‌صدا ۱۰٪ والد را می‌گرفت.
 *
 * `fallback` (مقدار پیش‌فرض همه‌ی کالاها): برای کالایی که نه خودش و نه هیچ‌کدام
 * از دسته‌های بالاسرش مقدار ندارند (یا اصلاً دسته‌بندی ندارد) استفاده می‌شود.
 * همین فیلد، مسیر مهاجرت تنظیم قدیمیِ «درصد سراسری» است.
 * ---------------------------------------------------------------------------
 */

/** مبلغ ثابت ریالی (برای هر عدد کالا) یا درصدی از قیمت کالا. */
export type ChargeMode = 'FIXED' | 'PERCENT'

export const CHARGE_MODE_LABELS: Record<ChargeMode, string> = {
  FIXED: 'مبلغ ثابت (ریال)',
  PERCENT: 'درصد از قیمت کالا'
}

/** یک مقدار تعریف‌شده برای یک دسته/زیردسته‌ی کالا. */
export interface CategoryChargeRule {
  categoryId: number
  mode: ChargeMode
  /** FIXED = ریال برای هر عدد · PERCENT = درصد (۰..۱۰۰) */
  value: number
}

/** مقدار پیش‌فرض برای کالاهایی که هیچ دسته‌ی دارای مقداری بالای سرشان نیست. */
export interface ChargeFallback {
  mode: ChargeMode
  value: number
}

export interface CategoryChargeConfig {
  /** خاموش کردن یک‌جای کل پنل، بدون پاک کردن مقدارها */
  enabled: boolean
  rules: CategoryChargeRule[]
  /** null = بدون مقدار پیش‌فرض */
  fallback: ChargeFallback | null
}

export const DEFAULT_CATEGORY_CHARGE: CategoryChargeConfig = { enabled: true, rules: [], fallback: null }

/** نوع پنل (چه چیزی محاسبه می‌شود). */
export const CHARGE_KIND_LABELS = {
  tax: 'عوارض و مالیات',
  service: 'حق سرویس'
} as const
export type ChargeKind = keyof typeof CHARGE_KIND_LABELS

/** کدام پنل فروش؟ تنظیمات این دو کاملاً از هم مستقل‌اند. */
export const CHARGE_SCOPE_LABELS = {
  pos: 'پنل فروش (خرده)',
  wholesale: 'فاکتور فروش عمده'
} as const
export type ChargeScope = keyof typeof CHARGE_SCOPE_LABELS

export const CHARGE_SCOPES: ChargeScope[] = ['pos', 'wholesale']
export const CHARGE_KINDS: ChargeKind[] = ['tax', 'service']

/** عنوان کامل یک زیرپنل، مثلاً «عوارض و مالیات · فاکتور فروش عمده». */
export function chargeTitle(kind: ChargeKind, scope: ChargeScope): string {
  return CHARGE_KIND_LABELS[kind] + ' · ' + CHARGE_SCOPE_LABELS[scope]
}

/** کلید جدول Setting برای هر ترکیب پنل/اسکوپ. */
export function chargeSettingKey(kind: ChargeKind, scope: ChargeScope): string {
  return 'charges.' + kind + '.' + scope
}

/** کلیدهای نسخه‌ی قبلی (بدون اسکوپ) — فقط برای مهاجرت یک‌باره. */
export const LEGACY_CHARGE_KEYS: Record<ChargeKind, string> = {
  tax: 'charges.tax',
  service: 'charges.service'
}

const clampValue = (mode: ChargeMode, value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return mode === 'PERCENT' ? Math.min(100, Math.round(n * 100) / 100) : Math.round(n)
}

const parseFallback = (raw: unknown): ChargeFallback | null => {
  if (!raw || typeof raw !== 'object') return null
  const mode: ChargeMode = (raw as any).mode === 'PERCENT' ? 'PERCENT' : 'FIXED'
  const value = clampValue(mode, (raw as any).value)
  return value > 0 ? { mode, value } : null
}

/** خواندن ایمن مقدار ذخیره‌شده (مقدار خراب یا ناقص = پیش‌فرض، بدون کرش). */
export function parseCategoryCharge(raw: unknown): CategoryChargeConfig {
  let obj: any = raw
  if (obj == null) return { enabled: true, rules: [], fallback: null }
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return { enabled: true, rules: [], fallback: null }
    }
  }
  if (!obj || typeof obj !== 'object') return { enabled: true, rules: [], fallback: null }

  const seen = new Set<number>()
  const rules: CategoryChargeRule[] = []
  for (const r of Array.isArray(obj.rules) ? obj.rules : []) {
    const categoryId = Number(r?.categoryId)
    if (!Number.isInteger(categoryId) || categoryId <= 0 || seen.has(categoryId)) continue
    const mode: ChargeMode = r?.mode === 'PERCENT' ? 'PERCENT' : 'FIXED'
    seen.add(categoryId)
    rules.push({ categoryId, mode, value: clampValue(mode, r?.value) })
  }
  return {
    enabled: obj.enabled === undefined ? true : Boolean(obj.enabled),
    rules,
    fallback: parseFallback(obj.fallback)
  }
}

/** حداقل چیزی که برای بالا رفتن در درخت دسته‌ها لازم است. */
export interface CategoryRef {
  id: number
  parentId: number | null
}

/**
 * نزدیک‌ترین مقدار تعریف‌شده برای یک دسته: خودش، بعد والدش، بعد والد والدش…
 * و اگر هیچ‌کدام مقدار نداشت، `fallback` (اگر تعریف شده باشد).
 * حلقه‌ی احتمالی parentId با `seen` بی‌اثر می‌شود.
 */
export function resolveChargeRule(
  cfg: CategoryChargeConfig | null | undefined,
  categoryId: number | null | undefined,
  categories: CategoryRef[]
): CategoryChargeRule | null {
  if (!cfg?.enabled) return null
  if (cfg.rules?.length && categoryId) {
    const byId = new Map(categories.map((c) => [c.id, c]))
    const ruleOf = new Map(cfg.rules.map((r) => [r.categoryId, r]))
    const seen = new Set<number>()
    let current: number | null | undefined = categoryId
    while (current && !seen.has(current)) {
      seen.add(current)
      const rule = ruleOf.get(current)
      // نشست ۱۵۶ (بند ۴-۴۵): قانون صفر = «عمداً صفر» ⇒ توقف، نه ادامه به والد/پیش‌فرض
      if (rule) return rule
      current = byId.get(current)?.parentId ?? null
    }
  }
  // مقدار پیش‌فرض: کالای بی‌دسته یا دسته‌ای که هیچ مقداری بالای سرش نیست
  if (cfg.fallback && cfg.fallback.value > 0)
    return { categoryId: 0, mode: cfg.fallback.mode, value: cfg.fallback.value }
  return null
}

/**
 * مبلغ عوارض/حق سرویس یک ردیف فاکتور.
 *   FIXED   → مبلغ ثابت هر عدد × تعداد
 *   PERCENT → درصد از مبلغ خالص همان ردیف (بعد از تخفیف ردیف)
 * خروجی همیشه عدد صحیح ریال است.
 */
export function chargeForLine(
  cfg: CategoryChargeConfig | null | undefined,
  categoryId: number | null | undefined,
  categories: CategoryRef[],
  lineNet: number,
  qty: number
): number {
  const rule = resolveChargeRule(cfg, categoryId, categories)
  if (!rule) return 0
  if (rule.mode === 'FIXED') return Math.round(rule.value * Math.max(0, Math.round(qty)))
  return Math.round((Math.max(0, lineNet) * rule.value) / 100)
}

/** یک ردیف فاکتور از نگاه محاسبه‌ی عوارض (هر دو پنل همین شکل را می‌فرستند). */
export interface ChargeLineInput {
  /** دسته‌بندی کالای همان ردیف (null = بدون دسته ⇒ فقط مقدار پیش‌فرض) */
  categoryId?: number | null
  /** مبلغ خالص ردیف بعد از تخفیف ردیف/درصد سراسری */
  lineNet: number
  qty: number
}

export interface ChargeBreakdown {
  /** عوارض و مالیات هر ردیف، به همان ترتیب ورودی */
  taxPerLine: number[]
  /** حق سرویس هر ردیف، به همان ترتیب ورودی */
  servicePerLine: number[]
  taxTotal: number
  serviceTotal: number
}

/**
 * محاسبه‌ی یک‌جای عوارض و حق سرویس همه‌ی ردیف‌های یک فاکتور.
 * پنل فروش و فاکتور عمده هر دو از همین تابع رد می‌شوند (با اسکوپ خودشان)، پس
 * عدد فاکتور، عدد رسید چاپی و عدد گزارش‌ها هیچ‌وقت از هم واگرا نمی‌شود.
 */
export function computeCharges(
  tax: CategoryChargeConfig | null | undefined,
  service: CategoryChargeConfig | null | undefined,
  categories: CategoryRef[],
  lines: ChargeLineInput[]
): ChargeBreakdown {
  const taxPerLine: number[] = []
  const servicePerLine: number[] = []
  for (const l of lines) {
    taxPerLine.push(chargeForLine(tax, l.categoryId ?? null, categories, l.lineNet, l.qty))
    servicePerLine.push(chargeForLine(service, l.categoryId ?? null, categories, l.lineNet, l.qty))
  }
  return {
    taxPerLine,
    servicePerLine,
    taxTotal: taxPerLine.reduce((s, n) => s + n, 0),
    serviceTotal: servicePerLine.reduce((s, n) => s + n, 0)
  }
}

/** متن خوانا برای نمایش یک مقدار (پنل‌ها و ستون‌های راهنما). */
export function describeChargeRule(rule: CategoryChargeRule | null): string {
  if (!rule) return '—'
  if (rule.value <= 0) return 'عمداً صفر (از دسته‌ی بالاتر ارث نمی‌برد)'
  return rule.mode === 'PERCENT' ? rule.value + '٪' : rule.value + ' ریال (هر عدد)'
}
