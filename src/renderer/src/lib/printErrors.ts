/**
 * Helperهای مشترک پیام/کد خطای چاپ در renderer.
 *
 * main کم‌کم کدهای صریح (مثل PRINT_CANCELLED) را از IPC عبور می‌دهد، اما بعضی
 * مسیرهای قدیمی هنوز فقط متن فارسی دارند. این توابع هر دو شکل را می‌پذیرند تا
 * صفحه‌ها برای timeout/unknown/cancel پیام متناقض یا retry خطرناک نسازند.
 */
export function printErrorMessage(e: unknown): string {
  return String((e as any)?.message ?? e ?? '')
}

export function isUnknownPrintMessage(e: unknown): boolean {
  return /معلوم نیست|نامعلوم|ممکن است|پاسخی نداد|نتیجه نداد/.test(printErrorMessage(e))
}

export function isPrintCancelledError(e: unknown): boolean {
  const err = e as any
  if (err?.printCancelled === true || err?.code === 'PRINT_CANCELLED') return true
  return /چاپ لغو شد|لغو شد و هیچ برگه‌ای|cancel/i.test(printErrorMessage(e))
}
