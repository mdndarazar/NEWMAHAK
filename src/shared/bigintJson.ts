/**
 * ===========================================================================
 * نشست ۱۸۱ (S181-D1) · خوشه M، مرحله ۲ — سریال‌سازی امن BigInt
 * ===========================================================================
 *
 * چرا این فایل قبل از هر تغییر schema لازم است؟
 *
 * `JSON.stringify` روی BigInt **استثنا پرتاب می‌کند**:
 *     TypeError: Do not know how to serialize a BigInt
 *
 * در `src/main` حدود ۱۸۷ فراخوان `JSON.stringify` هست که ۱۵۶ تای آن دقیقاً
 * `before:` / `after:` داخل `audit()` است. یعنی لحظه‌ای که بند ۴-۲۸(الف) اجرا
 * شود و `grandTotal`/`amount`/... به BigInt تبدیل شوند، هر ۱۵۶ مسیر ثبت Audit
 * در زمان اجرا crash می‌کنند.
 *
 * و چون `audit()` عمداً fail-open است (try/catch و فقط console.error)، این
 * crashها **بی‌صدا** خواهند بود: عملیات مالی انجام می‌شود ولی هیچ ردی از
 * actor/زمان/قبل-بعد نمی‌ماند. این دقیقاً ضدِ هدف مالک است («فهمیدن دزدی
 * فروشنده»)؛ یعنی مهاجرت BigInt بدون این فایل، مدرک ضدسرقت را نابود می‌کند.
 *
 * ---------------------------------------------------------------------------
 * تصمیم: BigInt به **رشته** سریال شود، نه عدد.
 *
 * گزینه‌ها بودند: (الف) `Number(v)` · (ب) `v.toString()`.
 * انتخاب (ب)، به این دلیل: مبالغ ریالی می‌توانند از `Number.MAX_SAFE_INTEGER`
 * رد شوند (همان دلیلی که اصلاً سراغ BigInt رفتیم). `Number(v)` در آن نقطه
 * بی‌صدا دقت را از دست می‌دهد و یک عدد *غلط* در سابقه‌ی ممیزی می‌نشاند — یعنی
 * همان «پنهان‌شدن مغایرت پول» که معیار رد پرامپت است. رشته lossless است.
 *
 * `"1000"` در مقابل `1000` برای ستون‌های `before`/`after` (که متن خام JSON
 * هستند و فقط برای نمایش/مقایسه‌ی انسانی خوانده می‌شوند) تفاوت معنایی ندارد.
 * ---------------------------------------------------------------------------
 *
 * دو سازوکار عمداً با هم ارائه می‌شوند:
 *
 *   ۱) `installBigIntJson()` — یک‌بار `BigInt.prototype.toJSON` را نصب می‌کند.
 *      این تنها راهی است که **همه‌ی ۱۸۷ نقطه‌ی موجود و هر نقطه‌ی آینده** را
 *      بدون دست‌زدن به ۱۸۷ فایل پوشش می‌دهد. فایل با import شدن خودش این کار
 *      را می‌کند (side-effect) تا هیچ مسیری جا نیفتد.
 *
 *   ۲) `jsonSafe()` — نسخه‌ی صریح با replacer، مستقل از پچ prototype. برای
 *      جاهایی که می‌خواهیم قرارداد در خود کد دیده شود، و به‌عنوان تور ایمنی
 *      اگر کسی روزی پچ را بردارد.
 *
 * هیچ‌کدام رفتار فعلی را عوض نمی‌کنند: تا وقتی هیچ BigInt ای در داده نیست،
 * خروجی `JSON.stringify` بایت‌به‌بایت همان قبلی است (تست S181 این را assert
 * می‌کند).
 */

/** آیا پچ قبلاً نصب شده؟ (نصب دوباره بی‌ضرر ولی بی‌فایده است) */
let installed = false

/**
 * `BigInt.prototype.toJSON` را نصب می‌کند تا `JSON.stringify` به‌جای پرتاب
 * استثنا، مقدار را به رشته‌ی ده‌دهی تبدیل کند.
 *
 * idempotent است: اگر قبلاً (توسط این تابع یا هر کد دیگری) نصب شده باشد،
 * دوباره چیزی را بازنویسی نمی‌کند.
 */
export function installBigIntJson(): void {
  if (installed) return
  const proto = BigInt.prototype as unknown as { toJSON?: () => string }
  if (typeof proto.toJSON === 'function') {
    installed = true
    return
  }
  Object.defineProperty(BigInt.prototype, 'toJSON', {
    value: function toJSON(this: bigint): string {
      return this.toString()
    },
    writable: true,
    configurable: true,
    enumerable: false
  })
  installed = true
}

/**
 * replacer قابل استفاده‌ی مستقیم در `JSON.stringify(value, bigIntReplacer)`.
 * مقدار BigInt را به رشته‌ی ده‌دهی تبدیل می‌کند و بقیه را دست‌نخورده می‌گذارد.
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? value.toString() : value
}

/**
 * جایگزین امن `JSON.stringify` برای مسیرهای مالی/ممیزی.
 *
 * رفتارش با `JSON.stringify` یکسان است، با یک تفاوت: BigInt به‌جای استثنا،
 * رشته می‌شود. آرگومان `space` هم مثل اصل پشتیبانی می‌شود.
 */
export function jsonSafe(value: unknown, space?: number | string): string {
  return JSON.stringify(value, bigIntReplacer, space)
}

// نصب خودکار با اولین import — تا هیچ مسیری (حتی مسیرهایی که این ماژول را
// صریح صدا نمی‌زنند ولی فایلی را import می‌کنند که صدا زده) جا نیفتد.
installBigIntJson()
