/**
 * ممیزی A117-02 (AUDIT-D50) — تب‌های «فقط تاریخ» گزارشات فروش.
 * این تب‌ها (عملکرد کارمندان، کارت‌به‌کارت، خارج از شیفت، نشست‌های override، مدیریت اعتبار) فقط از/تا نوار را
 * به سرویس می‌فرستند؛ شیفت، وضعیت، نوع سفارش، فیش، مشتری، کالا و کانال نوار روی آن‌ها اعمال نمی‌شود. بدون هشدار،
 * مدیری که «شیفت شب» را انتخاب کرده عدد کل روز را عدد شیفت شب می‌خواند (مغایرت پنهان). این helper خالص فقط
 * می‌گوید کدام فیلترِ فعال نادیده می‌ماند؛ هیچ عددی را عوض نمی‌کند.
 */
export const DATE_ONLY_REPORT_TABS = ['cardTransfers', 'staff', 'outOfShift', 'overrideSessions', 'creditManagement'] as const
export type DateOnlyReportTab = (typeof DATE_ONLY_REPORT_TABS)[number]

const TAB_LABELS: Record<DateOnlyReportTab, string> = {
  cardTransfers: 'کارت‌به‌کارت',
  staff: 'عملکرد کارمندان',
  outOfShift: 'خارج از شیفت',
  overrideSessions: 'نشست‌های با نام تغییر‌یافته',
  creditManagement: 'مدیریت اعتبار خرید'
}

export interface BarFilterLike {
  shiftId?: number | string | null
  orderType?: string | null
  status?: string | null
  receiptNo?: string | number | null
  customerSearch?: string | null
  productSearch?: string | null
  channels?: readonly string[] | null
}

const filled = (v: unknown): boolean => v != null && String(v).trim() !== ''

/** نام فارسی فیلترهای فعال نوار که تب‌های «فقط تاریخ» اعمالشان نمی‌کنند. */
export function ignoredBarFilters(f: BarFilterLike | null | undefined): string[] {
  if (!f) return []
  const out: string[] = []
  if (filled(f.shiftId)) out.push('شیفت')
  if (filled(f.status)) out.push('وضعیت')
  if (filled(f.orderType)) out.push('نوع سفارش')
  if (filled(f.receiptNo)) out.push('شماره فیش')
  if (filled(f.customerSearch)) out.push('مشتری')
  if (filled(f.productSearch)) out.push('کالا')
  const ch = Array.isArray(f.channels) ? f.channels : null
  if (ch && !(ch.includes('RETAIL') && ch.includes('WHOLESALE'))) out.push('کانال فروش')
  return out
}

/** متن هشدار برای تب «فقط تاریخ»؛ null یعنی تب عادی است یا فیلتر غیرتاریخی فعالی نیست. */
export function dateOnlyTabNotice(tab: string, f: BarFilterLike | null | undefined): string | null {
  if (!(DATE_ONLY_REPORT_TABS as readonly string[]).includes(tab)) return null
  const ignored = ignoredBarFilters(f)
  if (!ignored.length) return null
  const label = TAB_LABELS[tab as DateOnlyReportTab]
  return (
    `تب «${label}» فقط بازه‌ی تاریخ نوار را اعمال می‌کند؛ فیلتر ${ignored.map((x) => `«${x}»`).join('، ')} ` +
    'روی این تب اعمال نمی‌شود و عددها برای کل بازه‌ی تاریخ و همه‌ی شیفت‌ها هستند. ' +
    'برای عدد یک شیفت از تب‌های سرجمع، برگشت، چک یا نسیه استفاده کنید.'
  )
}
