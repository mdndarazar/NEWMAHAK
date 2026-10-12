/**
 * ===========================================================================
 * بند ۳ و بند ۴ — «تخفیف» و «افزایش/کاهش گروهی قیمت» — منبع واحد و رسمی.
 *
 * چرا shared؟ چون سه مصرف‌کننده دارد و هر سه باید *یک* عدد بدهند:
 *   • ماژول «تخفیف و افزایش/کاهش قیمت» (پیش‌نمایش سمت renderer)،
 *   • `PriceAdjustService` سمت main (اعمال واقعی روی قیمت کالاها)،
 *   • پنل فروش (سیاست تخفیف: آزاد / ثابت / غیرفعال).
 * اگر هرکدام خودش حساب می‌کرد، عددِ پیش‌نمایش با عددی که روی کالا می‌نشیند
 * واگرا می‌شد — همان کلاس باگی که در عوارض و مالیات یک بار تجربه شد.
 *
 * هیچ چیزی در این فایل به prisma یا به DOM دست نمی‌زند (توابع خالص).
 * ===========================================================================
 */

/** درصدی از قیمت فعلی، یا مبلغ ثابت ریالی. */
export type PriceAdjustMode = 'PERCENT' | 'AMOUNT'

export const PRICE_ADJUST_MODE_LABELS: Record<PriceAdjustMode, string> = {
  PERCENT: 'درصد (٪)',
  AMOUNT: 'مبلغ ثابت (ریال)'
}

/**
 * سه کار این ماژول.
 *   DISCOUNT = تخفیف روی قیمت فروش (قیمت کم می‌شود، ولی «قیمت قبل از تخفیف» در
 *              سابقه‌ی همان دسته تغییر می‌ماند و با «بازگردانی» برمی‌گردد).
 *   INCREASE = افزایش قیمت (گران‌کردن یک‌کلیکی).
 *   DECREASE = کاهش قیمت. رفتارش *دقیقاً برعکس* افزایش است.
 *
 * ⚠️ تفاوت DISCOUNT و DECREASE عمدی و معنایی است، نه محاسباتی: هر دو قیمت را کم
 * می‌کنند و فرمولشان یکی است، ولی در سابقه‌ی تغییرات با دو برچسب جدا ثبت
 * می‌شوند تا مدیر بعداً بفهمد «این ۱۰٪ یک حراج بود یا یک اصلاح قیمت».
 */
export type PriceAdjustKind = 'DISCOUNT' | 'INCREASE' | 'DECREASE'

export const PRICE_ADJUST_KIND_LABELS: Record<PriceAdjustKind, string> = {
  DISCOUNT: 'تخفیف',
  INCREASE: 'افزایش قیمت',
  DECREASE: 'کاهش قیمت'
}

/** جهت اثر هر کار روی قیمت: تخفیف و کاهش منفی، افزایش مثبت. */
export function priceAdjustSign(kind: PriceAdjustKind): 1 | -1 {
  return kind === 'INCREASE' ? 1 : -1
}

/** کالاها چطور انتخاب می‌شوند (بند ۴، «ساده و منعطف»). */
export type PriceAdjustScope = 'ALL' | 'CATEGORY' | 'VARIANTS'

export const PRICE_ADJUST_SCOPE_LABELS: Record<PriceAdjustScope, string> = {
  ALL: 'همه‌ی کالاها',
  CATEGORY: 'یک دسته / زیردسته',
  VARIANTS: 'کالاهای خاص انتخاب‌شده'
}

/** کدام قیمت عوض شود: قیمت فروش (پیش‌فرض) یا قیمت خرید. */
export type PriceAdjustTarget = 'SALE' | 'PURCHASE'

export const PRICE_ADJUST_TARGET_LABELS: Record<PriceAdjustTarget, string> = {
  SALE: 'قیمت فروش',
  PURCHASE: 'قیمت خرید'
}

/**
 * رُند کردن قیمت نهایی. «۱۰٪ روی ۱۲۳٬۴۵۶» عدد زشتی می‌دهد که روی لیبل و فاکتور
 * بد دیده می‌شود، پس مدیر می‌تواند بگوید به نزدیک‌ترین ۱۰۰۰ یا ۵۰۰۰ ریال رُند
 * شود. `1` = بدون رُند (همان عدد دقیق).
 */
export const PRICE_ROUND_STEPS = [1, 100, 500, 1000, 5000, 10000] as const
export type PriceRoundStep = (typeof PRICE_ROUND_STEPS)[number]

export const PRICE_ROUND_LABELS: Record<number, string> = {
  1: 'بدون رُند (عدد دقیق)',
  100: 'نزدیک‌ترین ۱۰۰ ریال',
  500: 'نزدیک‌ترین ۵۰۰ ریال',
  1000: 'نزدیک‌ترین ۱۰۰۰ ریال',
  5000: 'نزدیک‌ترین ۵۰۰۰ ریال',
  10000: 'نزدیک‌ترین ۱۰۰۰۰ ریال'
}

/**
 * ===========================================================================
 * نشست دهم — مورد ۱: «زمان‌بندی خودکار» یک دسته‌ی تغییر قیمت.
 *
 * چهار وضعیت، و هر دسته همیشه دقیقاً در یکی از آن‌هاست:
 *
 *   SCHEDULED = مدیر «تاریخ/ساعت شروع» آینده داده است. **هیچ قیمتی عوض نشده**؛
 *               فقط یک قرار گذاشته شده. زمان‌بندِ برنامه سر همان لحظه اعمالش
 *               می‌کند.
 *   APPLIED   = قیمت‌ها عوض شده‌اند و در جریان است (همان تنها حالتِ نسخه‌های
 *               قبلی برنامه؛ پس دسته‌های قدیمی همین وضعیت را می‌گیرند).
 *   ENDED     = «تاریخ/ساعت پایان» رسید و زمان‌بند، خودکار، قیمت‌ها را به مقدار
 *               قبل برگرداند. بازگردانیِ دوباره معنا ندارد.
 *   REVERTED  = مدیر خودش دکمه‌ی «بازگردانی» را زده است.
 *
 * ⚠️ وضعیتِ خالی/ناشناس (دسته‌های ثبت‌شده‌ی قبل از این نسخه) = `APPLIED`، مگر
 * اینکه `revertedAt` داشته باشند. جهت این پیش‌فرض عمدی است: هیچ دسته‌ی قدیمی
 * نباید ناگهان «زمان‌بندی‌شده» تفسیر شود و دوباره روی قیمت‌ها بنشیند.
 * ===========================================================================
 */
export type PriceAdjustState = 'SCHEDULED' | 'APPLIED' | 'ENDED' | 'REVERTED'

export const PRICE_ADJUST_STATE_LABELS: Record<PriceAdjustState, string> = {
  SCHEDULED: 'زمان‌بندی‌شده — هنوز اعمال نشده',
  APPLIED: 'اعمال‌شده',
  ENDED: 'پایان خودکار طبق زمان‌بندی',
  REVERTED: 'بازگردانی شده'
}

/** ورودی ناشناس ⇒ یک وضعیت معتبر (پیش‌فرض ایمن: اعمال‌شده). */
export function normalizeAdjustState(raw: unknown, revertedAt?: unknown): PriceAdjustState {
  const v = String(raw ?? '').trim().toUpperCase()
  if (v === 'SCHEDULED' || v === 'APPLIED' || v === 'ENDED' || v === 'REVERTED') return v
  return revertedAt ? 'REVERTED' : 'APPLIED'
}

/** این وضعیت یعنی «قیمت‌ها همین حالا با این دسته عوض شده‌اند»؟ */
export function isAdjustInEffect(state: PriceAdjustState): boolean {
  return state === 'APPLIED'
}

/** یک جفت «تاریخ/ساعت» زمان‌بندی (خالی = بی‌زمان‌بندی، رفتار همیشگی). */
export interface PriceAdjustSchedule {
  /** yyyy/MM/dd شمسی؛ خالی = بدون زمان‌بندیِ شروع (همین حالا) */
  startDate?: string | null
  /** HH:mm؛ خالی = ۰۰:۰۰ */
  startTime?: string | null
  /** yyyy/MM/dd شمسی؛ خالی = بی‌پایان (تا بازگردانی دستی) */
  endDate?: string | null
  endTime?: string | null
}

export interface PriceAdjustRule {
  kind: PriceAdjustKind
  mode: PriceAdjustMode
  /** PERCENT ⇒ ۰..۱۰۰ · AMOUNT ⇒ ریال */
  value: number
  /** رُند کردن قیمت نهایی (۱ = بدون رُند) */
  round?: number
  /** کدام قیمت (پیش‌فرض: قیمت فروش) */
  target?: PriceAdjustTarget
  /**
   * کف قیمت. قیمت هیچ‌وقت منفی نمی‌شود (سخت‌گیرانه صفر)، ولی مدیر می‌تواند یک
   * کف واقعی هم بگذارد تا «۹۰٪ تخفیف» قیمت‌ها را عملاً صفر نکند.
   */
  minPrice?: number
}

const clampPercent = (v: number): number => Math.min(100, Math.max(0, v))

/** رُند به نزدیک‌ترین پله (پله‌ی ۱ یا نامعتبر = بدون تغییر). */
export function roundToStep(value: number, step?: number): number {
  const s = Math.round(Number(step) || 1)
  if (!Number.isFinite(s) || s <= 1) return Math.round(value)
  return Math.round(value / s) * s
}

/**
 * قیمت جدید یک کالا با یک قاعده.
 *
 * قواعد ثابت:
 *   • PERCENT همیشه روی *قیمت فعلی همان کالا* حساب می‌شود، نه روی میانگین. پس
 *     «۱۰٪ به همه اضافه کن» برای کالای ۱۰٬۰۰۰ ریالی ۱٬۰۰۰ و برای ۱۰۰٬۰۰۰ ریالی
 *     ۱۰٬۰۰۰ اضافه می‌کند — همان چیزی که کاربر انتظار دارد.
 *   • AMOUNT همان مبلغ ثابت را به هر کالا اضافه/کم می‌کند (مثال خود کاربر:
 *     «۵۰ هزار تومان به قیمت همه کالاها اضافه کن»).
 *   • قیمت هرگز منفی نمی‌شود: کف مطلق صفر است، و اگر `minPrice` داده شده باشد،
 *     کف همان است. کالایی که قیمتش از قبل زیر کف است لمس نمی‌شود.
 *   • خروجی همیشه عدد صحیح ریال است (ستون قیمت در دیتابیس Int است).
 */
export function nextPrice(current: number, rule: PriceAdjustRule): number {
  const now = Math.max(0, Math.round(Number(current) || 0))
  const floor = Math.max(0, Math.round(Number(rule.minPrice) || 0))
  const raw = Math.max(0, Number(rule.value) || 0)
  if (raw <= 0) return now

  const sign = priceAdjustSign(rule.kind)
  const delta = rule.mode === 'PERCENT' ? (now * clampPercent(raw)) / 100 : raw
  const target = roundToStep(now + sign * delta, rule.round)

  // کالایی که از قبل زیر کف است، با یک «کاهش» نباید *گران* شود
  if (sign < 0 && now <= floor) return now
  return Math.max(floor, Math.max(0, target))
}

/** متن خوانا برای یک قاعده («۱۰٪ افزایش قیمت»، «۵۰٬۰۰۰ ریال تخفیف»). */
export function describeRule(rule: PriceAdjustRule): string {
  const kind = PRICE_ADJUST_KIND_LABELS[rule.kind] ?? rule.kind
  const value = Math.max(0, Math.round(Number(rule.value) || 0))
  return rule.mode === 'PERCENT' ? `${value}٪ ${kind}` : `${value} ریال ${kind}`
}

/**
 * ===========================================================================
 * بند ۳ — «سیاست تخفیف پنل فروش».
 *
 * مسئله‌ی کاربر: فروشنده نباید خودسرانه تخفیف بزند. دو ابزار، با هم:
 *   ۱) قفل رمز دوم روی خودِ کادر تخفیف (`PANEL_KEYS.posDiscount`) — حتی اگر
 *      سیاست «آزاد» باشد، تا رمز وارد نشود هیچ عددی قابل تایپ نیست.
 *   ۲) همین سیاست، که *سقف اختیار* را تعیین می‌کند:
 *
 *      FREE  = بعد از باز شدن قفل، فروشنده هر تخفیفی (تا `maxPercent`) می‌زند.
 *              ⇐ پیش‌فرض، چون رفتار نسخه‌های قبلِ برنامه همین بود و تغییرش
 *                بی‌خبر، فروش فروشگاه را به‌هم می‌ریزد.
 *      FIXED = فقط *همان یک تخفیف ثابتِ* مدیر اعمال می‌شود؛ عدد قابل تایپ نیست
 *              و فروشنده فقط می‌تواند همان را روشن/خاموش کند.
 *      OFF   = تخفیف کاملاً غیرفعال: نه ردیفی، نه فاکتوری، نه ثابت. کادر تخفیف
 *              هم نمایش داده نمی‌شود.
 *
 * `allowLine` / `allowInvoice` دو سوییچ مستقل‌اند، چون در پوشاک معمول است که
 * «تخفیف کل فاکتور» آزاد باشد ولی دست‌کاری قیمت تک‌تک کالاها ممنوع.
 * ===========================================================================
 */
export type DiscountPolicyMode = 'FREE' | 'FIXED' | 'OFF'

export const DISCOUNT_POLICY_LABELS: Record<DiscountPolicyMode, string> = {
  FREE: 'آزاد (با رمز باز می‌شود، بعد هر مقداری قابل ثبت است)',
  FIXED: 'فقط تخفیف ثابتِ تعیین‌شده‌ی مدیر',
  OFF: 'غیرفعال — هیچ تخفیفی قابل ثبت نیست'
}

export interface DiscountPolicy {
  mode: DiscountPolicyMode
  /** تخفیف ثابت مدیر: درصدی یا مبلغی (فقط در حالت FIXED معنا دارد) */
  fixedMode: PriceAdjustMode
  fixedValue: number
  /** تخفیف روی خودِ کالا (ستون تخفیف جدول فروش) مجاز است؟ */
  allowLine: boolean
  /** تخفیف روی کل فاکتور مجاز است؟ */
  allowInvoice: boolean
  /** سقف درصد تخفیف در حالت FREE (۱۰۰ = بی‌سقف) */
  maxPercent: number
  /** سقف مبلغ تخفیف هر فاکتور در حالت FREE (۰ = بی‌سقف) */
  maxAmount: number
  /**
   * 🔴 نشست ۱۸۵ · بند ۴-۲۶ — سقف تخفیف **فاکتور عمده**، جدا از پنل خرده‌فروشی.
   *
   * چرا جدا: قیمت عمده ذاتاً پایین‌تر است و تخفیف ۲۰–۳۰٪ روی آن کار روزمره
   * است؛ تحمیل سقف خرده‌فروشی ماژول عمده را از کار می‌اندازد (تصمیم S151-D4).
   * ولی تا نشست ۱۸۴ هیچ سقفی هم نداشت و تخفیف ۹۰٪ بی‌هیچ مانعی ثبت می‌شد.
   *
   * ⚠️ در نشست ۱۸۴ این را به‌صورت «گیت رمز» پیاده کردم که **دو ایراد داشت**:
   *   • رمز اصلاً به تابع نمی‌رسید (`preverifySalePolicy` فقط `orderType`
   *     می‌گرفت)، پس با قفل روشن هر تخفیفی رد می‌شد؛
   *   • با قفل خاموش `assertPanelPassword` مقدار `OPEN` می‌داد، پس اصلاً
   *     گیتی نبود.
   * و مهم‌تر از هر دو: بند ۴-۲۶ می‌گوید عبور از بازه یعنی **رد کامل**، نه
   * چیزی که با رمز دور زده شود. پس حالا مثل خرده‌فروشی یک سقف است، نه گیت.
   *
   * ۱۰۰ = بی‌سقف (رفتار قبل از این نشست، تا به‌روزرسانی چیزی را نشکند).
   */
  wholesaleMaxPercent: number
  /** سقف مبلغی تخفیف فاکتور عمده (۰ = بی‌سقف) */
  wholesaleMaxAmount: number
}

export const DEFAULT_DISCOUNT_POLICY: DiscountPolicy = {
  // پیش‌فرض = رفتار نسخه‌های قبلِ برنامه، ولی این بار پشت قفل رمز دوم
  mode: 'FREE',
  fixedMode: 'PERCENT',
  fixedValue: 0,
  allowLine: true,
  allowInvoice: true,
  maxPercent: 100,
  // نشست ۱۸۵: پیش‌فرض بی‌سقف = رفتار قبلی؛ مالک خودش در تنظیمات محدودش می‌کند.
  wholesaleMaxPercent: 100,
  wholesaleMaxAmount: 0,
  maxAmount: 0
}

/** خواندن ایمن سیاست تخفیف (مقدار خراب ⇒ پیش‌فرض، بدون کرش). */
export function parseDiscountPolicy(raw: unknown): DiscountPolicy {
  let obj: any = raw
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj)
    } catch {
      return { ...DEFAULT_DISCOUNT_POLICY }
    }
  }
  if (!obj || typeof obj !== 'object') return { ...DEFAULT_DISCOUNT_POLICY }

  const mode: DiscountPolicyMode = obj.mode === 'FIXED' ? 'FIXED' : obj.mode === 'OFF' ? 'OFF' : 'FREE'
  const fixedMode: PriceAdjustMode = obj.fixedMode === 'AMOUNT' ? 'AMOUNT' : 'PERCENT'
  const num = (v: unknown, fallback = 0): number => {
    const n = Math.round(Number(v))
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  const fixedValue = fixedMode === 'PERCENT' ? clampPercent(num(obj.fixedValue)) : num(obj.fixedValue)
  return {
    mode,
    fixedMode,
    fixedValue,
    allowLine: obj.allowLine !== false,
    allowInvoice: obj.allowInvoice !== false,
    // صفر یک سقف صریح و سخت‌گیرانه است، نه مقدارِ غایب. استفاده از `|| 100`
    // این تصمیم مدیر را به بی‌سقف تبدیل می‌کرد.
    maxPercent: clampPercent(num(obj.maxPercent, 100)),
    maxAmount: num(obj.maxAmount),
    // نشست ۱۸۵: نبودِ کلید در تنظیمات قدیمی ⇒ بی‌سقف؛ صفرِ صریح ⇒ بدون تخفیف.
    wholesaleMaxPercent: clampPercent(num(obj.wholesaleMaxPercent, 100)),
    wholesaleMaxAmount: num(obj.wholesaleMaxAmount)
  }
}

/**
 * مبلغ تخفیف ثابتِ مدیر روی یک مبلغ پایه (جمع کل فاکتور).
 * حالت غیر‌FIXED ⇒ صفر. مبلغ ثابت هیچ‌وقت از خودِ مبلغ پایه بیشتر نمی‌شود.
 */
export function fixedDiscountFor(policy: DiscountPolicy | null | undefined, base: number): number {
  if (!policy || policy.mode !== 'FIXED') return 0
  const b = Math.max(0, Math.round(base || 0))
  if (b <= 0 || policy.fixedValue <= 0) return 0
  const amount =
    policy.fixedMode === 'PERCENT' ? Math.round((b * clampPercent(policy.fixedValue)) / 100) : policy.fixedValue
  return Math.min(b, Math.max(0, Math.round(amount)))
}

/** سقف مجاز تخفیف یک فاکتور در حالت FREE (۰ و بی‌سقف = خودِ مبلغ پایه). */
/**
 * 🔴 نشست ۱۸۵ · بند ۴-۲۶ — سقف تخفیف فاکتور عمده.
 *
 * عمداً از `mode` سیاست خرده‌فروشی پیروی نمی‌کند (حالت FIXED و OFF آن‌جا
 * معنا دارد، این‌جا نه): فقط یک بازه‌ی درصدی/مبلغی است که مدیر تعیین می‌کند.
 */
export function wholesaleDiscountCeilingFor(policy: DiscountPolicy | null | undefined, base: number): number {
  const b = Math.max(0, Math.round(base || 0))
  const pct = clampPercent(policy?.wholesaleMaxPercent ?? 100)
  const byPercent = Math.round((b * pct) / 100)
  const cap = policy?.wholesaleMaxAmount ?? 0
  const byAmount = cap > 0 ? cap : b
  return Math.max(0, Math.min(b, byPercent, byAmount))
}

export function discountCeilingFor(policy: DiscountPolicy | null | undefined, base: number): number {
  const b = Math.max(0, Math.round(base || 0))
  if (!policy || policy.mode === 'OFF') return 0
  if (policy.mode === 'FIXED') return fixedDiscountFor(policy, b)
  // `0` یک سقف معتبر است؛ فقط نبود سیاست در ابتدای تابع به حالت پیش‌فرض می‌رود.
  const byPercent = Math.round((b * clampPercent(policy.maxPercent)) / 100)
  const byAmount = policy.maxAmount > 0 ? policy.maxAmount : b
  return Math.max(0, Math.min(b, byPercent, byAmount))
}

/**
 * نشست ۱۶۷ · Y11 (S167-D2) — کوتاه‌کردن تخفیف ردیف‌ها تا سقف سیاست، بدون عبور حتی یک ریال.
 *
 * تا نشست ۱۶۶ هر ردیف جدا با Math.round(d × سقف/جمع) گرد می‌شد و جمع گردشده‌ها می‌توانست چند ریال از سقف
 * بیشتر شود (۳۳۳/۳۳۳/۳۳۴ با سقف ۵۰۰ ⇒ ۵۰۱) ⇒ سرور (درست، بند ۴-۲۶) فروش را رد می‌کرد. اینجا هر سهم اول کف
 * گرفته می‌شود و ریال‌های باقی‌مانده یکی‌یکی به ردیف‌های با بزرگ‌ترین باقی‌مانده‌ی کسری (تساوی ⇒ ردیف اول)
 * داده می‌شود. نتیجه: جمع دقیقاً min(سقف، جمع خواسته)، هیچ ردیفی بیش از خواسته‌ی خودش، انحراف هر ردیف < ۱ ریال.
 * اگر جمع خواسته ≤ سقف باشد همان ورودی (صحیح‌شده) برمی‌گردد.
 */
export function scaleLineDiscounts(discounts: number[], ceiling: number): number[] {
  const d = discounts.map((x) => Math.max(0, Math.round(Number(x) || 0)))
  const total = d.reduce((a, b) => a + b, 0)
  const target = Math.max(0, Math.round(Number(ceiling) || 0))
  if (total <= target) return d
  if (target === 0) return d.map(() => 0)
  const out = d.map((x) => Math.floor((x * target) / total))
  let left = target - out.reduce((a, b) => a + b, 0)
  const order = d
    .map((x, i) => ({ i, frac: (x * target) % total }))
    .filter((r) => d[r.i] > out[r.i])
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const r of order) {
    if (left <= 0) break
    out[r.i] += 1
    left -= 1
  }
  return out
}

/** خلاصه‌ی یک‌خطی سیاست، برای نمایش در پنل فروش و در ماژول تنظیم سیاست. */
export function describeDiscountPolicy(policy: DiscountPolicy): string {
  if (policy.mode === 'OFF') return 'تخفیف در پنل فروش غیرفعال است؛ هیچ تخفیفی قابل ثبت نیست.'
  if (policy.mode === 'FIXED')
    return policy.fixedValue > 0
      ? `فقط تخفیف ثابت مدیر: ${policy.fixedMode === 'PERCENT' ? policy.fixedValue + '٪' : policy.fixedValue + ' ریال'}` +
          ' — فروشنده نمی‌تواند عدد دیگری بزند.'
      : 'حالت «تخفیف ثابت» انتخاب شده ولی مقدارش صفر است، پس عملاً تخفیفی اعمال نمی‌شود.'
  const caps: string[] = []
  if (policy.maxPercent < 100) caps.push(`حداکثر ${policy.maxPercent}٪`)
  if (policy.maxAmount > 0) caps.push(`حداکثر ${policy.maxAmount} ریال`)
  if (!policy.allowLine) caps.push('تخفیف روی خودِ کالا بسته است')
  if (!policy.allowInvoice) caps.push('تخفیف کل فاکتور بسته است')
  return 'تخفیف آزاد است (بعد از باز کردن قفل رمز)' + (caps.length ? ' · ' + caps.join(' · ') : '') + '.'
}
