/**
 * ابزارهای مشترک خروجی گزارش.
 *
 * جدول گزارش ممکن است فقط یک صفحه را نشان بدهد، اما چاپ/Excel باید با اقدام
 * پیش‌فرض روی کل فیلتر اجراشده کار کند. این فایل فقط منطق پیمایش صفحه‌ها را
 * نگه می‌دارد تا endpointهای مختلف، یک قرارداد واحد داشته باشند.
 */

export interface OutputPage {
  skip: number
  take: number
  totalCount: number
  truncated?: boolean
}

export interface ReadAllPagedResult<T> {
  rows: T[]
  first: any
  last: any
  totalCount: number
  warnings: string[]
}

export function pageOfOutput(value: any, key = 'page'): OutputPage | null {
  const page = value && typeof value === 'object' ? value[key] : null
  if (!page || typeof page !== 'object') return null
  const totalCount = Number(page.totalCount)
  const skip = Number(page.skip)
  const take = Number(page.take)
  if (!Number.isFinite(totalCount) || !Number.isFinite(skip) || !Number.isFinite(take) || take <= 0) return null
  return {
    totalCount: Math.max(0, Math.round(totalCount)),
    skip: Math.max(0, Math.round(skip)),
    take: Math.max(1, Math.round(take)),
    truncated: page.truncated === true
  }
}

/** هشدارهای برش صفحه برای صفحه‌ی جدول است، نه هشدار شکست یا مغایرت. */
export function nonPaginationWarnings(value: any): string[] {
  const warnings = Array.isArray(value?.warnings) ? value.warnings : []
  return warnings.filter((warning: unknown) => {
    const text = String(warning ?? '')
    return !/نمایش .* از .* (ردیف|فاکتور|برگشت|اعتبار|پرداختی)/.test(text) && !/صفحه‌ی بعد/.test(text)
  })
}

/**
 * همه‌ی صفحه‌های یک endpoint را با همان فیلتر می‌خواند.
 *
 * توقف بر اساس `totalCount` است، نه فقط `page.truncated`: بعضی قراردادهای
 * قدیمی روی هر صفحه‌ی دوم `truncated=true` می‌گذارند چون `skip>0` است، حتی
 * وقتی همان صفحه آخرین صفحه باشد. این تفاوت اگر نادیده گرفته شود، خروجی
 * آخرین صفحه را دوباره می‌خواند یا در حلقه می‌ماند.
 */
export async function readAllReportPages<T>(
  loadPage: (skip: number, take: number) => Promise<any>,
  rowsFrom: (response: any) => T[],
  pageFrom: (response: any) => OutputPage | null = (response) => pageOfOutput(response),
  requestedTake = 5000
): Promise<ReadAllPagedResult<T>> {
  const rows: T[] = []
  const warnings: string[] = []
  let skip = 0
  let first: any = null
  let last: any = null
  let finished = false
  let expectedTotal: number | null = null

  for (let guard = 0; guard < 10000; guard++) {
    const response = await loadPage(skip, requestedTake)
    if (first == null) first = response
    last = response
    const pageRows = rowsFrom(response)
    rows.push(...pageRows)
    warnings.push(...nonPaginationWarnings(response))

    const page = pageFrom(response)
    if (!page) {
      finished = true
      break
    }
    /**
     * ممیزی AUDIT-S133-01 (AUDIT-D63) — اگر مجموعه‌ی فیلترشده وسط پیمایش عوض شود
     * (سند تازه/ابطال در فهرستی با ترتیب id نزولی مثل برگشت و تعویض)، مرز صفحه‌ها
     * جابه‌جا می‌شود و فایل ردیف تکراری یا جاافتاده می‌گیرد، با متای «خروجی کامل».
     * fail-closed: هیچ فایل ناسازگاری ساخته نمی‌شود؛ کاربر دوباره خروجی می‌گیرد.
     */
    if (expectedTotal == null) expectedTotal = page.totalCount
    else if (page.totalCount !== expectedTotal)
      throw new Error(
        `داده‌های گزارش حین تهیه‌ی خروجی تغییر کرد (${expectedTotal} ⇐ ${page.totalCount} ردیف)؛ برای جلوگیری از فایل با ردیف تکراری یا جاافتاده، چاپ/خروجی متوقف شد. دوباره خروجی بگیرید.`
      )
    const nextSkip = page.skip + page.take
    if (page.totalCount <= nextSkip || pageRows.length === 0) {
      finished = true
      break
    }
    if (nextSkip <= skip)
      throw new Error('صفحه‌بندی خروجی پیشرفت نکرد؛ برای جلوگیری از فایل ناقص، چاپ/خروجی متوقف شد.')
    skip = nextSkip
  }

  if (!finished)
    throw new Error('خروجی کامل نشد؛ تعداد صفحه‌ها از حد ایمن گذشت. گزارش را دوباره تهیه کنید یا بازه را کوچک‌تر کنید.')

  return {
    rows,
    first,
    last,
    totalCount: pageOfOutput(first)?.totalCount ?? rows.length,
    warnings: [...new Set(warnings.filter(Boolean))]
  }
}
