import { forwardRef, useState, type InputHTMLAttributes } from 'react'

/**
 * ===========================================================================
 * مورد ۲ — «نمایش/مخفی‌کردن رمز با آیکون چشم».
 *
 * یک اینپوت رمز + یک دکمه‌ی چشم 👁 کنارش. با هر کلیک، نوع اینپوت بین
 * `password` و `text` سوییچ می‌شود تا کاربر ببیند چه رمزی تایپ کرده (مثلاً
 * وقتی رمز جدید و تکرارش با هم نمی‌خوانند و معلوم نیست کدام غلط تایپ شده).
 *
 * چرا یک کامپوننت مشترک؟ چون همین اینپوت در ۷ جای برنامه هست (رمز فعلی، رمز
 * جدید، تکرار رمز جدید، رمز مدیر برای تایید قفل ماژول‌ها، رمز مدیر برای تایید
 * رمزهای دوم، رمز دوم هر پنل، و صفحه‌ی ورود رمز `ManagerGate`). با یک
 * کامپوننت، منطق چشم یک بار نوشته می‌شود و همه‌جا یکسان رفتار می‌کند.
 *
 * ⚠️ هیچ چیزی از رفتار قبلی عوض نشده: پیش‌فرض همیشه `password` است (رمز مخفی)،
 * خود اینپوت همان کلاس‌ها/`dir`/`value`/`onChange`/`onKeyDown` قبلی را می‌گیرد
 * و نمایش رمز فقط تا وقتی است که کاربر خودش چشم را باز نگه دارد — هیچ‌جا ذخیره
 * یا به خاطر سپرده نمی‌شود.
 * ===========================================================================
 */
export type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { className = 'inp text-center', dir = 'ltr', disabled, ...rest },
  ref
) {
  const [shown, setShown] = useState(false)
  return (
    <div className="flex items-stretch gap-1">
      <input ref={ref} type={shown ? 'text' : 'password'} dir={dir} className={`${className} flex-1`} disabled={disabled} {...rest} />
      <button
        type="button"
        className="btn px-2 shrink-0"
        // با tabIndex={-1} فشردن Tab از اینپوت رمز مستقیم به کنترل بعدی می‌رود
        // (مثل قبل) و روی دکمه‌ی چشم گیر نمی‌کند.
        tabIndex={-1}
        aria-label={shown ? 'مخفی کردن رمز' : 'نمایش رمز'}
        title={shown ? 'مخفی کردن رمز' : 'نمایش رمز وارد‌شده'}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? '🙈' : '👁'}
      </button>
    </div>
  )
})

export default PasswordField
