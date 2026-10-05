/**
 * ممیزی A115-02 — صفحه‌ی قبل/بعد فهرست خرید باید روی *بازه‌ی اعمال‌شده* (همانی که ردیف‌ها و page از آن آمده‌اند)
 * حرکت کند، نه روی from/to فعلی state. وگرنه: تغییر تاریخ بدون «نمایش» + «صفحه‌ی بعد» ⇒ skip صفحه‌ی قدیمی روی
 * بازه‌ی تازه ⇒ صفحه‌ی اول بازه‌ی تازه دیده نمی‌شود و جمع/هشدار با ردیف‌ها نمی‌خواند.
 */
export interface PurchaseAppliedRange {
  from: string
  to: string
}

export interface PurchaseListPage {
  skip?: number
  take?: number
  totalCount?: number
}

export interface PurchasePageRequest {
  from: string
  to: string
  skip: number
}

const int0 = (v: unknown) => Math.max(0, Math.round(Number(v ?? 0) || 0))

/** درخواست صفحه‌ی قبل/بعد؛ null یعنی آن جهت ممکن نیست (یا هنوز بازه‌ای اعمال نشده). */
export function purchasePageRequest(
  applied: PurchaseAppliedRange | null | undefined,
  page: PurchaseListPage | null | undefined,
  shown: number,
  dir: 'prev' | 'next'
): PurchasePageRequest | null {
  if (!applied || !applied.from || !applied.to || !page) return null
  const skip = int0(page.skip)
  const take = Math.max(1, int0(page.take) || 1)
  const total = int0(page.totalCount)
  if (dir === 'prev') return skip > 0 ? { from: applied.from, to: applied.to, skip: Math.max(0, skip - take) } : null
  return skip + int0(shown) < total ? { from: applied.from, to: applied.to, skip: skip + take } : null
}

/** آیا state فعلی تاریخ با بازه‌ی نمایش‌داده‌شده فرق دارد (برای هشدار «برای اعمال، نمایش را بزنید»)؟ */
export function purchaseRangeDirty(applied: PurchaseAppliedRange | null | undefined, from: string, to: string): boolean {
  return !!applied && (applied.from !== from || applied.to !== to)
}
