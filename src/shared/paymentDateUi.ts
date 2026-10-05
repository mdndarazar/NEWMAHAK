/**
 * ممیزی AUDIT-S136-03 (AUDIT-D67) — تاریخ/ساعت پرداخت در پنجره‌ی پرداخت‌ها.
 *
 * پیش‌فرض تاریخ و ساعت هنگام باز شدن پنجره ثابت می‌شود. اگر پنجره از نیمه‌شب بگذرد
 * و کاربر به تاریخ دست نزده باشد، فرستادن همان پیش‌فرض یعنی پرداختِ «همین حالا»
 * روی ساعت ۱۲ دیروز می‌نشست (داخل صندوق بسته‌ی شیفت صبح، نه نشست شبِ باز).
 * قاعده: فقط تاریخ/ساعتی فرستاده می‌شود که کاربر آگاهانه عوض کرده است؛ در غیر این
 * صورت سرور لحظه‌ی واقعی ثبت را می‌گذارد.
 */
export type PaymentMomentState = {
  paidAtJalali: string
  paidAtTime: string
  dateTouched: boolean
  timeTouched: boolean
}

export function paymentMomentFields(state: PaymentMomentState): { paidAtJalali?: string; paidAtTime?: string | null } {
  if (!state.dateTouched && !state.timeTouched) return {}
  return {
    paidAtJalali: state.paidAtJalali,
    paidAtTime: state.timeTouched ? state.paidAtTime.trim() || null : null
  }
}
