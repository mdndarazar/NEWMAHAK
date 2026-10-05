import { call, CH } from './api'

export interface ExportTableResult {
  /** کاربر پنجره‌ی «ذخیره به‌عنوان» را بست ⇒ هیچ فایلی ساخته نشد */
  canceled: boolean
  path: string | null
  rows: number
  format: 'xlsx' | 'csv'
}

/**
 * «خروجی اکسل» هر جدول گزارش.
 *
 * ساخت فایل در main انجام می‌شود (renderer به فایل‌سیستم دسترسی ندارد): اول
 * پنجره‌ی «ذخیره به‌عنوان» ویندوز باز می‌شود تا خودِ کاربر مسیر و نام فایل را
 * انتخاب کند، بعد یک فایل xlsx استاندارد (با ستون‌بندی درست، سرستون ثابت و
 * مبالغ به‌صورت عدد) ساخته و در پوشه‌اش نشان داده می‌شود.
 */
export async function exportTable(input: {
  fileName: string
  headers: string[]
  rows: (string | number | null)[][]
  totals?: (string | number | null)[]
  /** نام برگه‌ی اکسل (پیش‌فرض: نام فایل) */
  sheetName?: string
  /** یک خط عنوان بالای جدول، مثلاً بازه‌ی تاریخ گزارش */
  title?: string
}): Promise<ExportTableResult> {
  return call<ExportTableResult>(CH.exportExcel, input)
}
