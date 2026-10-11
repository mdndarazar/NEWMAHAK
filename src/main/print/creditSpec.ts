/**
 * ===========================================================================
 * نشست ۳۱۷ · طرح کلاد (برنده) — «مشخصات نهایی چاپ سند اعتبار» در یک نقطه.
 *
 * تا امروز `creditPaperSize(settings.paper, …)` در چهار سایت جدا صدا زده
 * می‌شد (تکی، گروهی، PDF و HTML) و هر تغییر باید چهار بار تکرار می‌شد. حالا
 * ابعاد کاغذ + layout (فونت/حاشیه/ضریبها) همین‌جا یک‌بار ساخته می‌شود و
 * PrintService و چاپ آزمایشی از همین استفاده می‌کنند تا هر سه مسیر (تکی،
 * گروهی، آزمایشی) همیشه یکسان ببینند.
 *
 * خالص و بدون Electron/Prisma — قابل import از هر سرویس main بدون چرخه.
 * ===========================================================================
 */
import { creditPaperSize, type CreditSettings } from '@shared/credit'
import {
  creditBatchPerPage,
  creditEffectivePerPage,
  creditLayout,
  type CreditPrintLayout
} from '@shared/creditPrint'

export interface CreditRenderSpec {
  widthMm: number
  heightMm: number | null
  layout: CreditPrintLayout
}

/** کاغذ + layout در یک آبجکت — با تنظیمات پیش‌فرض، layout تاریخی است ⇒ CSS بایت‌به‌بایت قدیمی. */
export function creditRenderSpec(settings: CreditSettings): CreditRenderSpec {
  const paper = creditPaperSize(settings.paper, settings.customWidthMm, settings.customHeightMm)
  return { ...paper, layout: creditLayout(settings, paper) }
}

/**
 * «چند سند در هر صفحه» بعد از هوشمندسازی: با فونت درشت‌تر سندها بلندترند،
 * پس creditEffectivePerPage تعداد را کم می‌کند (هرگز بیشتر نمی‌کند).
 */
export function creditPerPageWith(spec: CreditRenderSpec, override?: unknown): number {
  return creditEffectivePerPage(creditBatchPerPage(spec, override), spec.layout)
}
