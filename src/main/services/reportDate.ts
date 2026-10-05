import { BusinessError } from '../errors'
import { isValidJalaliDate, toLatinDigits } from '@shared/jalali'

/**
 * ممیزی A114-01 (AUDIT-D45) — تاریخ ورودی فهرست‌های گزارشی صندوق/کارت‌به‌کارت.
 * خالی ⇒ undefined (فراخواننده پیش‌فرض «امروز»ِ بند ۴-۲۳ یا «کل نشست» A92-01 را اعمال می‌کند)،
 * نامعتبر ⇒ خطای فارسی (نه Invalid Date و فهرست خالی بی‌صدا، نه کل تاریخچه‌ی بی‌قید).
 * هم‌الگوی shiftListDate / fraudReportDate / consolidationDayOf. فقط برای فهرست‌های خواندنی؛
 * عملیات مخرب پیش‌فرض بی‌صدا ندارند (D39، D42).
 */
export function reportDayInput(raw: unknown, label: string, scope: string): string | undefined {
  const clean = toLatinDigits(String(raw ?? '')).trim()
  if (!clean) return undefined
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» ${scope} معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.`
    )
  return clean
}

/**
 * ممیزی A114-02 (AUDIT-D46) — تاریخ عملیات مخرب صندوق (بستن صندوق، پیش‌نمایشش، تجمیع/کسر انبار قطعی).
 * undefined/null ⇒ undefined (رفتار قبلی: امروز)؛ '' یا نامعتبر ⇒ خطای فارسی (پیش‌فرض بی‌صدا ممنوع، D39/D42)؛
 * قبلاً resolveRange رشته‌ی '' را با `??` نگه می‌داشت ⇒ jalaliStartOfDay('') = سال −۱۰۰۱۰۰ ⇒ کل تاریخچه.
 */
export function destructiveDayInput(raw: unknown, label: string, scope: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  const clean = toLatinDigits(String(raw)).trim()
  if (!clean)
    throw new BusinessError(`«${label}» ${scope} خالی است. تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.`)
  if (!isValidJalaliDate(clean))
    throw new BusinessError(
      `«${label}» ${scope} معتبر نیست («${String(raw)}»). تاریخ را کامل و به شکل ۱۴۰۵/۰۷/۰۱ وارد کنید.`
    )
  return clean
}

/** بازه‌ی عملیات مخرب: هر دو تاریخ با destructiveDayInput و «از» بعد از «تا» ⇒ خطای فارسی. */
export function destructiveRangeInput<T extends { fromJalali?: string | null; toJalali?: string | null }>(input: T, scope: string): T {
  const fromJalali = destructiveDayInput(input.fromJalali, 'از تاریخ', scope)
  const toJalali = destructiveDayInput(input.toJalali, 'تا تاریخ', scope)
  const f = fromJalali ?? toJalali
  const t = toJalali ?? fromJalali
  if (f && t && f > t)
    throw new BusinessError(`بازه‌ی ${scope} معکوس است: «از تاریخ» (${f}) بعد از «تا تاریخ» (${t}) است.`)
  return { ...input, fromJalali, toJalali }
}
