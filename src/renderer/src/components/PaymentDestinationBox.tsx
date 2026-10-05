import {
  PaymentDestination,
  PAYMENT_DESTINATION_LABELS,
  PAYMENT_DESTINATION_HINTS,
  allowedDestinationsFor,
  normalizePaymentDestination
} from '@shared/enums'

/**
 * ===========================================================================
 * کار الف — «کادر مقصد پول» (یک کامپوننت، همه‌جا همین یکی)
 *
 * چرا یک کامپوننت مشترک؟ چون این کادر در چهار جای مختلف لازم است (پاس شدن چک،
 * ثبت پرداختی نسیه در پنجره‌ی اقساط، پرداخت جزئی پنل فروش، و هر فرم بعدی) و
 * اگر هر کدام کادر خودش را می‌ساخت، یکی‌شان دیر یا زود «پیش‌فرض» پیدا می‌کرد و
 * همان چیزی می‌شد که این کار برای رفعش است.
 *
 * سه قاعده‌ی غیرقابل‌مذاکره:
 *   ۱) **پیش‌فرض ندارد.** تا کاربر یکی از گزینه‌ها را نزند، `value = null` است.
 *      اگر پیش‌فرض داشت، سهل‌انگاری فروشنده هنگام بستن صندوق تبدیل به کسری یا
 *      اضافه‌ی بی‌دلیل می‌شد.
 *   ۲) گزینه‌ها از `allowedDestinationsFor(methodKind)` می‌آیند — همان تابعی که
 *      سرور (`assertDestination`) با آن اعتبارسنجی می‌کند. پس هیچ‌وقت گزینه‌ای
 *      نشان داده نمی‌شود که سرور ردش کند.
 *   ۳) متن توضیح هر گزینه از `PAYMENT_DESTINATION_HINTS` است، نه متن محلی؛ تا
 *      توضیحِ «حساب مدیر» در دو صفحه دو چیز نگوید.
 * ===========================================================================
 */
export default function PaymentDestinationBox({
  value,
  onChange,
  methodKind,
  context,
  disabled = false,
  /** پیام خطای محلی (مثلاً «انتخاب نشده») — بالای کادر و با رنگ هشدار دیده می‌شود */
  warning = null,
  title = 'مقصد پول (اجباری)'
}: {
  value: string | null
  onChange: (value: PaymentDestination) => void
  /** `kind` روش پرداخت انتخاب‌شده؛ null/undefined ⇒ هر سه گزینه (چک و روش‌های بانکی) */
  methodKind?: string | null
  context: 'CHEQUE_CLEAR' | 'PAYMENT'
  disabled?: boolean
  warning?: string | null
  title?: string
}) {
  const allowed = allowedDestinationsFor(methodKind)
  const current = normalizePaymentDestination(value)
  return (
    <div className="rounded border-2 border-sky-300 bg-sky-50 p-2 space-y-2">
      <div className="font-bold flex flex-wrap items-baseline gap-2">
        <span>{title}</span>
        <span className="kbd font-normal">
          {context === 'CHEQUE_CLEAR'
            ? 'پول این چک کجا نشسته است؟ بدون این پاسخ، «پاس شد» ثبت نمی‌شود.'
            : 'این پول کجا نشسته است؟ بدون این پاسخ، پرداختی ثبت نمی‌شود.'}
        </span>
      </div>
      <div className="grid gap-1 md:grid-cols-3">
        {allowed.map((d) => {
          const on = current === d
          return (
            <button
              key={d}
              type="button"
              disabled={disabled}
              onClick={() => onChange(d)}
              className={`text-start rounded border-2 px-2 py-1 leading-6 ${
                on
                  ? d === PaymentDestination.MANAGER
                    ? 'bg-amber-100 border-amber-500'
                    : 'bg-emerald-100 border-emerald-500'
                  : 'bg-white border-slate-300'
              }`}
            >
              <div className="font-bold">
                {on ? '● ' : '○ '}
                {PAYMENT_DESTINATION_LABELS[d]}
              </div>
              <div className="kbd font-normal whitespace-normal">{PAYMENT_DESTINATION_HINTS[d]}</div>
            </button>
          )
        })}
      </div>
      {warning ? (
        <div className="rounded px-2 py-1 bg-amber-100 border border-amber-400 whitespace-pre-line">{warning}</div>
      ) : !current ? (
        <div className="kbd">
          هنوز چیزی انتخاب نشده است — این کادر عمداً پیش‌فرض ندارد، چون انتخاب اشتباهش هنگام بستن صندوق کسری یا
          اضافه‌ی بی‌دلیل می‌سازد.
        </div>
      ) : current === PaymentDestination.MANAGER ? (
        <div className="kbd text-amber-800">
          این مبلغ بدهی مشتری را کم و فاکتور را تسویه می‌کند، ولی در «دریافتی فروشگاه»، «نقد/کارت مورد انتظار صندوق» و
          مقایسه با کارتخوان نمی‌آید و در گزارش‌ها ردیف جدای خودش را دارد.
        </div>
      ) : null}
    </div>
  )
}
