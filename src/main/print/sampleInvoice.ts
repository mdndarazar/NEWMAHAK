/**
 * ===========================================================================
 * «چاپ فاکتور نمونه» کارت‌های تکی (INVOICE) و عمده (WHOLESALE) تب چاپ.
 *
 * چرا جدا از `testPage.ts`؟ آن ماژول عمداً برگه‌ی *کالیبراسیون* می‌سازد (مستطیل
 * مرجع، خط‌کش، بارکد) و دروازه‌ی RAW را باز می‌کند؛ دست‌نخورده می‌ماند. کاربرِ
 * کارت تکی/عمده اما یک فاکتور واقعی می‌خواهد. این‌جا هیچ HTML تازه‌ای ساخته
 * نمی‌شود:
 *   • HTML = همان `printService.previewHtml` (داده‌ی نمونه + `receiptHtml` با
 *     پروفایل)، یعنی همان چیزی که دکمه‌ی «پیش‌نمایش» نشان می‌دهد.
 *   • قالب = تنظیمات **ذخیره‌شده** (نه فرم)، تا روش RAW بدون دروازه روشن نشود.
 *   • چاپگر = resolver مشترک با فهرست زنده (بدون fallback)؛ عمده فقط وقتی
 *     `wholesalePrinterName` را می‌گیرد که `wholesaleSeparate` روشن باشد.
 *   • موتور = `printMaybeRaw` (همان router فاکتور واقعی: CHROMIUM یا RAW).
 * ===========================================================================
 */
import { faDigits } from '@shared/jalali'
import { receiptPageSpec, type ReceiptProfile } from '@shared/printSpec'
import { printService } from '../services/PrintService'
import { settingsService } from '../services/SettingsService'
import { resolvePrintTargetName } from './target'
import { printMaybeRaw } from './raw/route'

export interface SampleInvoiceInput {
  /** پروفایل کارت: `WHOLESALE` ⇒ فاکتور عمده؛ هر چیز دیگر ⇒ تکی. */
  profile?: unknown
  /** نام انتخاب‌شده‌ی همین لحظه‌ی کارت؛ main با فهرست زنده اعتبارسنجی می‌کند. */
  deviceName?: unknown
}

export interface SampleInvoiceResult {
  printed: true
  profile: ReceiptProfile
  deviceName: string
  viaWindowsDefault: boolean
  engine: 'CHROMIUM' | 'RAW'
  pageSizeLabel: string
}

export async function runPrintSampleInvoice(input: SampleInvoiceInput = {}): Promise<SampleInvoiceResult> {
  const profile: ReceiptProfile = String(input.profile ?? '').toUpperCase() === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL'
  const tpl = await settingsService.receiptTemplate()
  const { deviceName, viaWindowsDefault } = await resolvePrintTargetName({
    requestedDeviceName: input.deviceName,
    savedName: profile === 'WHOLESALE' && tpl.wholesaleSeparate === true ? tpl.wholesalePrinterName : tpl.printerName
  })
  const html = await printService.previewHtml({ profile })
  const spec = receiptPageSpec(tpl, profile)
  const r = await printMaybeRaw({
    method: tpl.printMethod,
    html,
    deviceName,
    // سیاست دیالوگ همان «چاپ آزمایشی» کارت: useSystemDialog همین قالب.
    silent: tpl.useSystemDialog !== true,
    pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm },
    rawDpi: tpl.rawDpi,
    rawInvert: tpl.rawInvert,
    cutMode: tpl.cutMode
  })
  const h = spec.heightMm === 'AUTO' ? 'ارتفاع خودکار' : `${faDigits(Math.round(spec.heightMm))}`
  return {
    printed: true,
    profile,
    deviceName,
    viaWindowsDefault: viaWindowsDefault === true,
    engine: r.engine,
    pageSizeLabel: `${faDigits(Math.round(spec.widthMm))}×${h} میلی‌متر`
  }
}
