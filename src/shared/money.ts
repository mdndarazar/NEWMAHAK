/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف — لایه‌ی حساب پول با BigInt
 * ---------------------------------------------------------------------------
 * چرا این فایل لازم است (و چرا *قبل* از migration ساخته می‌شود):
 *
 * وقتی ۷۹ فیلد مالی از `Int` به `BigInt` تبدیل شوند، Prisma به‌جای `number`
 * مقدار `bigint` برمی‌گرداند. جاوااسکریپت اجازه‌ی مخلوط کردن این دو را نمی‌دهد:
 *
 *     1n + 1            ⇒ TypeError: Cannot mix BigInt and other types
 *     1n > 0            ⇒ درست کار می‌کند (مقایسه مجاز است)
 *     [3n,1n].sort()    ⇒ درست، ولی (a,b)=>a-b مقدار bigint می‌دهد نه number
 *     Math.max(1n, 2n)  ⇒ TypeError
 *
 * یعنی در ~۱۱٬۵۰۰ خط محاسبات، *هر* `+`، `reduce`، `Math.max` و مقایسه‌گر sort
 * یک نقطه‌ی شکست بالقوه است. دو راه وجود داشت:
 *
 *   الف) هر نقطه را دستی به bigint ترجمه کنیم ⇒ ۱۱٬۵۰۰ خط ویرایش دستی، و هر
 *        موردی که از قلم بیفتد در *زمان اجرا* می‌ترکد، نه در typecheck.
 *   ب) یک لایه‌ی باریک بسازیم که هر ورودی (number | bigint | string | null) را
 *        به یک نمایش واحد می‌آورد، و محاسبات از آن عبور کنند.
 *
 * راه (ب) انتخاب شد. نکته‌ی مهم: این فایل عمداً **هیچ رفتاری را همین الان عوض
 * نمی‌کند** — تا وقتی schema هنوز `Int` است، همه‌ی ورودی‌ها `number`اند و
 * خروجی‌ها دقیقاً همان مقدار قبلی‌اند. این فایل فقط زمین را برای مرحله‌ی ۳ و ۴
 * آماده می‌کند تا آن مرحله «تبدیل تدریجی» باشد نه «یک انفجار بزرگ».
 *
 * ---------------------------------------------------------------------------
 * قاعده‌ی سخت: هیچ‌وقت بی‌صدا دقت از دست نمی‌رود.
 *
 * مبالغ ریالی از `Number.MAX_SAFE_INTEGER` (۹٬۰۰۷ تریلیارد) رد می‌شوند — یک
 * گردش سالانه‌ی چند همتی به‌راحتی از آن عبور می‌کند. اگر `Number(bigint)` بزنیم
 * عدد **بی‌صدا** گرد می‌شود و گزارش مالی غلط می‌دهد؛ دقیقاً همان «پنهان شدن
 * مغایرت پول» که معیار ردِ پروژه است. پس `toNumberRial` وقتی عدد از محدوده‌ی
 * امن بیرون بزند **throw می‌کند**، نه اینکه گرد کند.
 * ===========================================================================
 */

/** هر شکلی که یک مبلغ ریالی ممکن است در مرز ورودی داشته باشد. */
export type RialLike = number | bigint | string | null | undefined

/**
 * تبدیل هر ورودی به `bigint` ریال.
 *
 * قواعد:
 *   • `null` / `undefined` / رشته‌ی خالی ⇒ `0n` (همان رفتار `?? 0` موجود در کد).
 *   • `bigint` ⇒ بدون تغییر.
 *   • `number` صحیح ⇒ تبدیل مستقیم.
 *   • `number` اعشاری ⇒ **throw**. ریال واحد صحیح است؛ اگر جایی اعشار رسید،
 *     یعنی یک تقسیم (مثلاً سهم تخفیف) گرد نشده و باید در همان‌جا تصمیم گرفته
 *     شود، نه اینکه اینجا بی‌صدا بریده شود.
 *   • `NaN` / `Infinity` ⇒ throw.
 *   • رشته ⇒ فقط اگر یک عدد صحیح ده‌دهی باشد (خروجی `BigInt.prototype.toJSON`
 *     ما همین است، پس رفت‌وبرگشت JSON بسته می‌شود).
 */
export function toRial(value: RialLike): bigint {
  if (value === null || value === undefined) return 0n
  if (typeof value === 'bigint') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`مبلغ نامعتبر است: ${value}`)
    if (!Number.isInteger(value)) throw new TypeError(`مبلغ ریالی نمی‌تواند اعشاری باشد: ${value}`)
    return BigInt(value)
  }
  const s = value.trim()
  if (s === '') return 0n
  if (!/^[+-]?\d+$/.test(s)) throw new TypeError(`مبلغ ریالی نامعتبر است: ${JSON.stringify(value)}`)
  return BigInt(s)
}

/**
 * برگرداندن به `number` برای مصرف‌کننده‌هایی که هنوز عدد می‌خواهند
 * (نمودارها، `toLocaleString`، قالب‌های چاپ).
 *
 * اگر مقدار از محدوده‌ی امن بیرون باشد throw می‌کند — بهتر است برنامه با یک
 * خطای صریح بایستد تا اینکه یک عدد غلط را با اطمینان چاپ کند.
 */
export function toNumberRial(value: RialLike): number {
  const v = toRial(value)
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`مبلغ ${v.toString()} از محدوده‌ی امن عدد جاوااسکریپت بیرون است`)
  }
  return Number(v)
}

/** جمع امن؛ جایگزین `a + b` و `reduce((s, x) => s + x, 0)`. */
export function sumRial(...values: RialLike[]): bigint {
  let total = 0n
  for (const v of values) total += toRial(v)
  return total
}

/** جمع روی آرایه با انتخاب‌گر — جایگزین مستقیم الگوی `reduce` در گزارش‌ها. */
export function sumBy<T>(rows: readonly T[], pick: (row: T) => RialLike): bigint {
  let total = 0n
  for (const row of rows) total += toRial(pick(row))
  return total
}

/** مقایسه‌گر مرتب‌سازی: منفی/صفر/مثبت به‌صورت `number` (چون `Array.sort` عدد می‌خواهد). */
export function cmpRial(a: RialLike, b: RialLike): number {
  const x = toRial(a)
  const y = toRial(b)
  return x < y ? -1 : x > y ? 1 : 0
}

/** جایگزین `Math.max` که روی bigint می‌ترکد. آرایه‌ی خالی ⇒ `0n`. */
export function maxRial(...values: RialLike[]): bigint {
  let best: bigint | null = null
  for (const v of values) {
    const x = toRial(v)
    if (best === null || x > best) best = x
  }
  return best ?? 0n
}

/** جایگزین `Math.min`. آرایه‌ی خالی ⇒ `0n`. */
export function minRial(...values: RialLike[]): bigint {
  let best: bigint | null = null
  for (const v of values) {
    const x = toRial(v)
    if (best === null || x < best) best = x
  }
  return best ?? 0n
}

/** جایگزین `Math.abs`. */
export function absRial(value: RialLike): bigint {
  const v = toRial(value)
  return v < 0n ? -v : v
}

/**
 * ضرب مبلغ در یک تعداد صحیح (مثلاً قیمت واحد × تعداد).
 * تعداد عمداً `number` صحیح است چون تعداد کالا هیچ‌وقت از محدوده‌ی امن رد نمی‌شود.
 */
export function mulRial(value: RialLike, count: number): bigint {
  if (!Number.isInteger(count)) throw new TypeError(`تعداد باید صحیح باشد: ${count}`)
  return toRial(value) * BigInt(count)
}

/**
 * سهم درصدی یک مبلغ، با گرد کردن *نیم به بالا* روی قدرمطلق.
 *
 * چرا این تابع لازم است: `BigInt` تقسیم را به سمت صفر می‌برد (`7n / 2n === 3n`)،
 * که با رفتار فعلی کد (`Math.round`) فرق دارد. اگر بدون این تابع مهاجرت کنیم،
 * هر تخفیف/مالیات درصدی یک ریال با گذشته اختلاف پیدا می‌کند و کل تطبیق حساب‌ها
 * به هم می‌ریزد. این تابع همان `Math.round` را روی اعداد بزرگ بازتولید می‌کند.
 */
export function percentOfRial(value: RialLike, percent: number): bigint {
  if (!Number.isFinite(percent)) throw new TypeError(`درصد نامعتبر است: ${percent}`)
  const v = toRial(value)
  const negative = v < 0n
  const magnitude = negative ? -v : v
  // درصد ممکن است اعشاری باشد (مثلاً ۹٪ مالیات یا ۲٫۵٪)؛ با مخرج ۱٬۰۰۰٬۰۰۰ کار
  // می‌کنیم تا شش رقم اعشارِ درصد بدون خطای ممیز شناور حفظ شود.
  const scaled = BigInt(Math.round(percent * 1_000_000))
  const numerator = magnitude * scaled
  const denominator = 100_000_000n
  const quotient = numerator / denominator
  const remainder = numerator % denominator
  // نیم به بالا: اگر باقی‌مانده ≥ نصف مخرج باشد، یک واحد اضافه کن.
  // «نیم» دقیقاً مثل `Math.round` به سمت +∞ می‌رود، نه «دور از صفر»:
  //   Math.round(2.5) === 3   ولی   Math.round(-2.5) === -2
  // این تفاوت ریز باید مو‌به‌مو حفظ شود، وگرنه هر سهم منفیِ نیم‌ریالی یک ریال با
  // گذشته اختلاف پیدا می‌کند و تطبیق حساب‌ها را به هم می‌ریزد.
  const half = remainder * 2n
  const roundUp = negative ? half > denominator : half >= denominator
  const rounded = roundUp ? quotient + 1n : quotient
  return negative ? -rounded : rounded
}

/**
 * ===========================================================================
 * نشست ۱۸۲ · مرز IPC — «هیچ BigInt ای به رابط کاربری نمی‌رسد»
 * ---------------------------------------------------------------------------
 * سریال‌سازی IPC الکترون (structured clone) مقدار `bigint` را **دست‌نخورده**
 * به renderer می‌دهد. این خوب به‌نظر می‌رسد ولی فاجعه است: کد رابط کاربری با
 * `number` نوشته شده و اولین `s + r.grandTotal` یا `Math.round(inv.taxTotal)`
 * با `TypeError: Cannot mix BigInt and other types` کل صفحه را می‌اندازد.
 *
 * تا امروز هر سرویسی که ردیف خام Prisma را برمی‌گرداند (مثل
 * `PurchaseService.get` و `SalesService.get`) این مسیر را باز می‌گذاشت —
 * یعنی رفعِ نقطه‌به‌نقطه در سرویس‌ها هیچ‌وقت کامل نمی‌شد و هر کوئری جدیدی
 * دوباره سوراخ می‌کرد.
 *
 * پس تبدیل در **تنها گلوگاه مشترک** انجام می‌شود: wrapper `handle()` در
 * `src/main/ipc/index.ts`. یک نقطه، پوشش کامل، و هر کانال آینده هم خودکار
 * محافظت می‌شود.
 *
 * ⚠️ خارج از محدوده‌ی امن **throw** می‌کند، نه گرد کردن. یک صفحه که با خطای
 * روشن می‌ایستد قابل تشخیص است؛ صفحه‌ای که عدد غلط نشان می‌دهد نیست.
 * ===========================================================================
 */
export function stripBigInts<T>(value: T, path = 'خروجی'): T {
  return walk(value, path, new WeakMap()) as T
}

function walk(value: unknown, path: string, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'bigint') {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
      throw new RangeError(
        `مقدار «${path}» برابر ${value.toString()} است و از محدوده‌ی امن عدد جاوااسکریپت بیرون می‌زند؛ ` +
          'بازه یا فیلتر را کوچک‌تر کنید تا عددِ درست نمایش داده شود.'
      )
    return Number(value)
  }
  if (value === null || typeof value !== 'object') return value

  // مقادیری که ساختار داخلی‌شان نباید پیمایش شود
  if (value instanceof Date || value instanceof RegExp) return value
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value

  // حلقه‌ی ارجاعی: همان مرجع قبلی برگردانده می‌شود (بدون بی‌نهایت بازگشت)
  const cached = seen.get(value as object)
  if (cached !== undefined) return cached

  if (Array.isArray(value)) {
    let changed = false
    const out: unknown[] = new Array(value.length)
    seen.set(value as object, out)
    for (let i = 0; i < value.length; i++) {
      const next = walk(value[i], `${path}[${i}]`, seen)
      out[i] = next
      if (next !== value[i]) changed = true
    }
    /**
     * ⚠️ این پروژه الگوی `Object.assign(rows, { page, warnings })` را زیاد
     * به کار می‌برد (`PagedRows`): یک آرایه که پراپرتی‌های اضافه هم دارد.
     * اگر فقط اندیس‌ها کپی شوند، `page` و `warnings` بی‌صدا ناپدید می‌شوند و
     * صفحه‌بندی و هشدار «نتیجه بریده شد» از کار می‌افتد — دقیقاً همان
     * «سقف بی‌صدا»یی که خوشه G برای رفعش ساخته شد.
     */
    for (const k of Object.keys(value as object)) {
      if (/^\d+$/.test(k)) continue
      const v = (value as unknown as Record<string, unknown>)[k]
      const next = walk(v, `${path}.${k}`, seen)
      ;(out as unknown as Record<string, unknown>)[k] = next
      if (next !== v) changed = true
    }
    if (!changed) {
      seen.set(value as object, value)
      return value
    }
    return out
  }

  if (value instanceof Map) {
    const out = new Map()
    seen.set(value as object, out)
    for (const [k, v] of value) out.set(walk(k, `${path}.key`, seen), walk(v, `${path}.${String(k)}`, seen))
    return out
  }
  if (value instanceof Set) {
    const out = new Set()
    seen.set(value as object, out)
    for (const v of value) out.add(walk(v, `${path}[]`, seen))
    return out
  }

  // آبجکت ساده
  let changed = false
  const out: Record<string, unknown> = {}
  seen.set(value as object, out)
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const next = walk(v, `${path}.${k}`, seen)
    out[k] = next
    if (next !== v) changed = true
  }
  if (!changed) {
    seen.set(value as object, value)
    return value
  }
  /**
   * ⚠️ پروتوتایپ حفظ می‌شود. بعضی خروجی‌ها آبجکت ساده نیستند (مثلاً آرایه‌ای که
   * با `Object.assign(rows, { page })` پراپرتی گرفته) — گرچه آن مورد از شاخه‌ی
   * آرایه رد می‌شود، این‌جا هم محتاط می‌مانیم.
   */
  Object.setPrototypeOf(out, Object.getPrototypeOf(value as object))
  return out
}
