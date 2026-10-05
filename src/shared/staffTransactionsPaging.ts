/**
 * ممیزی A103-01 — اعلان صفحه‌بندی هر بخش ریزتراکنش کارمند (فاکتور/برگشت/کارت‌به‌کارت/مصرف اعتبار).
 * چهار بخش یک skip مشترک دارند ولی اندازه‌شان فرق می‌کند؛ پس هشدار باید *بعد از* خواندن ردیف‌ها و با
 * تعداد واقعی ردیف همین صفحه ساخته شود: صفحه‌ی میانی/آخر هم بازه‌ی «X تا Y از N» را اعلام می‌کند و
 * بخشی که در صفحه‌های قبل تمام شده، به‌جای «در این بازه چیزی نیست» توضیح صریح می‌گیرد.
 */
export interface StaffSectionPage {
  skip?: number
  take?: number
  totalCount?: number
  truncated?: boolean
}

export interface StaffSectionNotice {
  /** هشدار نوار بالا؛ null یعنی همه‌ی ردیف‌های این بخش روی همین صفحه‌اند */
  warning: string | null
  /** متن جایگزین «ردیفی نیست» وقتی این صفحه خالی است ولی بخش ردیف دارد */
  emptyText: string | null
}

export function staffSectionNotice(
  label: string,
  page: StaffSectionPage | null | undefined,
  shown: number,
  fa: (v: number) => string = (v) => String(v)
): StaffSectionNotice {
  const n = Math.max(0, Math.round(Number(shown) || 0))
  const total = Math.max(0, Math.round(Number(page?.totalCount ?? n) || 0))
  const skip = Math.max(0, Math.round(Number(page?.skip ?? 0) || 0))
  const hasNext = skip + n < total
  if (n === 0) {
    if (total === 0) return { warning: null, emptyText: null }
    const text = `«${label}»: این صفحه ردیفی ندارد ولی ${fa(total)} ردیف با این فیلتر هست (در صفحه‌های قبل)؛ به صفحه‌ی اول برگردید.`
    return { warning: text, emptyText: text }
  }
  if (skip === 0 && !hasNext) return { warning: null, emptyText: null }
  const range = `«${label}»: نمایش ردیف‌های ${fa(skip + 1)} تا ${fa(skip + n)} از ${fa(total)}`
  return {
    warning: hasNext
      ? `${range}؛ صفحه‌ی بعد را باز کنید تا گزارش ناقص نماند.`
      : `${range}؛ ردیف‌های قبلی در صفحه‌های قبل‌اند.`,
    emptyText: null
  }
}
