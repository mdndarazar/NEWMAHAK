/**
 * Helperهای مشترک پیام/کد خطای چاپ در renderer.
 *
 * main برای cancel و unknown کد صریح IPC می‌فرستد. regex فقط fallback سازگاری با
 * پیام‌های قدیمی است و عمداً print-specific نوشته شده تا timeout ساخت PDF
 * («هیچ فایلی ذخیره نشد») با نتیجه‌ی نامعلوم چاپ اشتباه نشود.
 */
export function printErrorMessage(e: unknown): string {
  return String((e as any)?.message ?? e ?? '')
}

export function isUnknownPrintMessage(e: unknown): boolean {
  const err = e as any
  if (err?.printOutcomeUnknown === true || err?.code === 'PRINT_OUTCOME_UNKNOWN') return true
  const msg = printErrorMessage(e)
  return (
    /نتیجه(?:‌| )?ی? چاپ نامعلوم/.test(msg) ||
    /معلوم نیست[^\n]*(برگه|فیش|رسید|سند|کد اعتبار)?[^\n]*چاپ شده باشد/.test(msg) ||
    /چاپگر[^\n]*نتیجه نداد[^\n]*برگه چاپ شده باشد/.test(msg) ||
    /ممکن است برگه چاپ شده باشد/.test(msg)
  )
}

export function isPrintCancelledError(e: unknown): boolean {
  const err = e as any
  if (err?.printCancelled === true || err?.code === 'PRINT_CANCELLED') return true
  return /چاپ لغو شد|لغو شد و هیچ برگه‌ای|cancel/i.test(printErrorMessage(e))
}
