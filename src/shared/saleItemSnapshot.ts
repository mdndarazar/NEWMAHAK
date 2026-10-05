/**
 * نام و کد قلم فروش در لحظه‌ی ثبت.
 *
 * ستون‌های `variantName` / `variantCode` همان snapshot هستند. فیش چاپی *همیشه*
 * snapshot را نشان می‌دهد. گزارش فروش هم پیش‌فرض همان را نشان می‌دهد؛ فقط اگر
 * تیک `Product.reportLiveName` روشن باشد (`preferLive` / `reportLineTitle`)
 * نام زنده‌ی کالا جای snapshot می‌نشیند. وقتی snapshot خالی است (فاکتور قدیمی)،
 * به نام زنده‌ی واریانت برمی‌گردیم.
 */
export type SaleLineLive = {
  product?: { name?: string | null; reportLiveName?: boolean | number | null } | null
  size?: string | null
  color?: string | null
} | null

function liveProductTitle(live?: SaleLineLive): string {
  if (!live) return ''
  return `${live.product?.name ?? ''}${live.size ? ' سایز ' + live.size : ''}${live.color ? ' - ' + live.color : ''}`.trim()
}

export function saleLineTitle(
  it: { variantName?: string | null } | null | undefined,
  live?: SaleLineLive,
  missing = 'کالای حذف‌شده',
  opts?: { preferLive?: boolean }
): string {
  if (opts?.preferLive === true) {
    const liveName = liveProductTitle(live)
    if (liveName) return liveName
  }
  const snap = String(it?.variantName ?? '').trim()
  if (snap) return snap
  if (!live) return missing
  return liveProductTitle(live) || 'کالا'
}

/** عنوان قلم در گزارش فروش: نام زنده فقط وقتی تیک کالا روشن باشد. */
export function reportLineTitle(
  it: { variantName?: string | null } | null | undefined,
  live?: SaleLineLive,
  missing = 'کالای حذف‌شده'
): string {
  return saleLineTitle(it, live, missing, { preferLive: !!live?.product?.reportLiveName })
}

export function saleLineCode(
  it: { variantCode?: string | null } | null | undefined,
  live?: { code?: string | null } | null
): string {
  return String(it?.variantCode ?? '').trim() || live?.code || '—'
}
