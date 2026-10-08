/**
 * ---------------------------------------------------------------------------
 * تبدیل هر خطای فنی به یک پیام فارسیِ قابل‌فهم.
 *
 * قاعده‌ی این نرم‌افزار: کاربر هیچ‌وقت نباید خطای فنی ببیند (کرش، پیام خام
 * Prisma، undefined و ...). تنها خطایی که مجاز است، خطای «منطق کسب‌وکار» است:
 * جمله‌ای فارسی که می‌گوید چه چیزی و چرا انجام نشد — مثلاً کمبود موجودی انبار.
 *
 * تشخیص «پیام کاربرپسند» ساده و بی‌استثناست: اگر متن خطا حرف فارسی داشته باشد،
 * یعنی خودمان آن را نوشته‌ایم و همان‌طور به کاربر می‌رسد. هر چیز دیگری (که
 * انگلیسی است و از Prisma/Node/SQLite می‌آید) به یک پیام فارسی ترجمه می‌شود و
 * متن اصلی فقط در کنسول برای عیب‌یابی لاگ می‌گردد.
 * ---------------------------------------------------------------------------
 */

/** خطای منطق کسب‌وکار: عیناً به کاربر نشان داده می‌شود. */
export class BusinessError extends Error {
  readonly isBusinessError = true
  /**
   * کد ساختاریافته‌ی اختیاری (مثل SESSION_REQUIRED) تا renderer به‌جای حدس از
   * روی متن فارسی، رفتار UI را روی کد سوار کند؛ handle آن را عبور می‌دهد.
   */
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'BusinessError'
    this.code = code
  }
}

const PERSIAN = /[\u0600-\u06FF]/

function raw(err: unknown): string {
  if (err instanceof Error) return err.message ?? ''
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** نام ستون/فیلد داخل پیام Prisma را برای پیام بهتر بیرون می‌کشد. */
function targetOf(err: any): string | null {
  const t = err?.meta?.target
  if (Array.isArray(t)) return t.join('، ')
  if (typeof t === 'string') return t
  const m = /column[s]?[: ]+`?([A-Za-z0-9_.]+)`?/i.exec(raw(err))
  return m ? m[1] : null
}

const FIELD_LABELS: Record<string, string> = {
  code: 'کد کالا',
  barcode: 'بارکد',
  receiptNo: 'شماره فیش',
  invoiceNo: 'شماره فاکتور',
  username: 'نام کاربری',
  name: 'نام',
  key: 'کلید'
}

function label(target: string | null): string {
  if (!target) return 'یکی از مقادیر'
  const last = target.split('.').pop() as string
  return FIELD_LABELS[last] ?? `«${last}»`
}

/**
 * پیام نهایی برای نمایش در UI.
 * خطاهای کسب‌وکار دست‌نخورده رد می‌شوند؛ بقیه ترجمه می‌شوند.
 */
export function toUserMessage(err: unknown): string {
  const message = raw(err)
  if (err instanceof BusinessError) return err.message
  if ((err as any)?.isBusinessError) return message
  if (PERSIAN.test(message)) return message

  const code = (err as any)?.code as string | undefined
  const lower = message.toLowerCase()

  // --- ناهم‌خوانی ساختار دیتابیس با برنامه (همان باگ deductInventory) ---
  if (
    code === 'P2021' ||
    code === 'P2022' ||
    lower.includes('does not exist in the current database') ||
    lower.includes('no such column') ||
    lower.includes('no such table')
  ) {
    return (
      'ساختار دیتابیس با نسخه‌ی فعلی برنامه هم‌خوان نیست. ' +
      'برنامه را یک‌بار کامل ببندید و باز کنید تا به‌روزرسانی ساختار به‌طور خودکار انجام شود. ' +
      'اگر پیام تکرار شد، از فایل دیتابیس نسخه‌ی پشتیبان بگیرید و اطلاع دهید.'
    )
  }

  // --- تکراری بودن مقدار یکتا ---
  if (code === 'P2002' || lower.includes('unique constraint')) {
    return `${label(targetOf(err))} تکراری است؛ یک مقدار دیگر وارد کنید.`
  }

  // --- ارجاع به رکورد ناموجود ---
  if (code === 'P2003' || lower.includes('foreign key constraint')) {
    return 'یکی از موارد انتخاب‌شده (کالا، طرف حساب یا روش پرداخت) دیگر در سیستم وجود ندارد؛ صفحه را تازه کنید و دوباره انتخاب کنید.'
  }

  if (code === 'P2025' || lower.includes('no record was found') || lower.includes('not found')) {
    return 'رکورد مورد نظر پیدا نشد؛ ممکن است حذف یا جابه‌جا شده باشد. لیست را تازه کنید.'
  }

  // --- تراکنش: قفل یا timeout ---
  if (lower.includes('transaction already closed') || lower.includes('transaction api error')) {
    return 'انجام عملیات طول کشید و ناتمام ماند، پس هیچ تغییری ذخیره نشد. یک بار دیگر تلاش کنید.'
  }
  if (lower.includes('database is locked') || lower.includes('sqlite_busy')) {
    return 'دیتابیس در همان لحظه در حال استفاده بود و عملیات انجام نشد. چند لحظه بعد دوباره تلاش کنید.'
  }
  if (lower.includes('constraint failed') || lower.includes('sqlite_constraint')) {
    return 'مقدار وارد‌شده با قواعد دیتابیس سازگار نیست؛ اطلاعات فرم را بررسی کنید.'
  }

  // --- چاپ ---
  if (lower.includes('print') && (lower.includes('fail') || lower.includes('cancel'))) {
    return 'چاپ انجام نشد؛ اتصال و انتخاب چاپگر را بررسی کنید.'
  }

  // --- خطای کلی، ولی هرگز بدون پیام ---
  return 'انجام این عملیات ممکن نشد و چیزی ذخیره نشد. یک بار دیگر تلاش کنید؛ اگر تکرار شد، برنامه را ببندید و باز کنید.'
}
