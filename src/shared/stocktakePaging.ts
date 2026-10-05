/**
 * ممیزی نشست ۱۱۹ · A119-02 (AUDIT-D55) — صفحه‌بندی فرم شمارش و سابقه‌ی جلسه‌های انبارگردانی.
 * قبل: دکمه‌های صفحه فقط state skip را عوض می‌کردند و هیچ بارگذاری‌ای نمی‌زدند (effect فقط روی tab بود)؛
 * بعد از «صفحه‌ی بعد» جستجوی تازه با همان skip کهنه ⇒ جدول خالی. حالا هر درخواست صریح {search, skip} است:
 * صفحه‌ی قبل/بعد روی جستجوی *اعمال‌شده* حرکت می‌کند و جستجوی تازه همیشه از صفحه‌ی اول شروع می‌شود (هم‌الگوی D48/D51).
 */
export interface StocktakeQuery {
  search: string
  skip: number
}

export interface StocktakePageLike {
  skip: number
  take: number
  totalCount: number
  truncated: boolean
}

const cleanSearch = (s: unknown): string => String(s ?? '').trim()
const cleanSkip = (n: unknown): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) && v > 0 ? v : 0
}

/** «بازخوانی»/Enter: جستجوی همان ⇒ همان صفحه؛ جستجوی تازه ⇒ صفحه‌ی اول. */
export function stocktakeReloadQuery(applied: StocktakeQuery | null | undefined, liveSearch: string): StocktakeQuery {
  const search = cleanSearch(liveSearch)
  if (applied && cleanSearch(applied.search) === search) return { search, skip: cleanSkip(applied.skip) }
  return { search, skip: 0 }
}

/** صفحه‌ی قبل/بعد روی جستجوی اعمال‌شده؛ null یعنی آن طرف صفحه‌ای نیست. */
export function stocktakePageQuery(
  applied: StocktakeQuery | null | undefined,
  page: StocktakePageLike | null | undefined,
  dir: 'next' | 'prev'
): StocktakeQuery | null {
  if (!page) return null
  const search = cleanSearch(applied?.search)
  const skip = cleanSkip(page.skip)
  const take = Math.max(1, cleanSkip(page.take) || 1)
  if (dir === 'next') return page.truncated ? { search, skip: skip + take } : null
  return skip > 0 ? { search, skip: Math.max(0, skip - take) } : null
}

/** نشان صریح «X تا Y از N» حتی در صفحه‌ی آخر (بدون هشدار برش). */
export function pageRangeLabel(page: StocktakePageLike | null | undefined, shown: number, noun: string): string {
  const total = Math.max(0, Math.round(Number(page?.totalCount ?? shown)) || 0)
  const n = Math.max(0, Math.round(Number(shown)) || 0)
  if (!n) return `۰ ${noun} از ${fa(total)}`
  const from = cleanSkip(page?.skip) + 1
  return `نمایش ${fa(from)} تا ${fa(from + n - 1)} از ${fa(total)} ${noun}`
}

const fa = (n: number): string => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])
