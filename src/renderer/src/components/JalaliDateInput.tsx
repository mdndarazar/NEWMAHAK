import { faDigits, isValidJalaliDate, toLatinDigits } from '@shared/jalali'

/**
 * ورودی تاریخ شمسی به‌صورت yyyy/MM/dd.
 * ارقام فارسی هم پذیرفته می‌شود و پیش از ذخیره به لاتین تبدیل می‌گردد
 * (پارس و ذخیره در main با jalaliToDateTime/toJalaliDate انجام می‌شود).
 */
export default function JalaliDateInput({
  value,
  onChange,
  className = 'inp w-36',
  autoFocus
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  autoFocus?: boolean
}) {
  const ok = isValidJalaliDate(value)
  return (
    <div>
      <input
        dir="ltr"
        autoFocus={autoFocus}
        className={`${className} text-center ${ok ? '' : 'border-red-400 bg-red-50'}`}
        placeholder="1405/06/25"
        value={value}
        onChange={(e) => onChange(toLatinDigits(e.target.value))}
      />
      {!ok && <div className="kbd text-red-600">تاریخ نامعتبر</div>}
      {ok && <div className="kbd">{faDigits(value)}</div>}
    </div>
  )
}
