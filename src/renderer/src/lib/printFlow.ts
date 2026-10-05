/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۳ طرح چاپ — «جریان بپرس/بی‌پرس» (بخش ۶.۵ طرح).
 *
 * چرا یک نقطه‌ی مشترک؟ چون هر نقطه‌ی چاپ در برنامه باید یک سیاست واحد داشته
 * باشد و همان سیاست هم قابل آزمون باشد:
 *
 *   • `askEachTime = false` ⇒ همان رفتار «چاپ بی‌درنگ»: بدون هیچ پرسشی چاپ
 *     می‌شود و main خودش چاپگر ذخیره‌شده‌ی همان پروفایل را resolve می‌کند.
 *   • `askEachTime = true` و `useSystemDialog = false` ⇒ پنجره‌ی خودِ برنامه
 *     («با کدام چاپگر چاپ شود؟») باز می‌شود؛ چون دیالوگ ویندوز اندازه‌ی کاغذ ما
 *     را با پیش‌فرض درایور بازنویسی می‌کند.
 *   • `askEachTime = true` و `useSystemDialog = true` ⇒ دیالوگ خود ویندوز
 *     (`silent: false`) تا تکنسین بتواند درایور را مستقیم تنظیم کند.
 *
 * ⚠️ قراردادهای دست‌نخورده:
 *   • انصراف = `CANCELLED`، **بی‌صدا و بدون خطا** و بدون تغییر هیچ شمارنده‌ای
 *     (شمارنده‌ی چاپ اعتبار از همین قاعده پیروی می‌کند).
 *   • گیت `printEnabled/posPrintToggle` و رمزش دست‌نخورده در سمت صفحه‌هاست؛
 *     این فایل هیچ تصمیم دسترسی نمی‌گیرد.
 *   • هیچ fallback خودکار به چاپگر دیگری نیست؛ انتخاب فقط با کاربر است.
 * ===========================================================================
 */
import { call, CH } from './api'
import { isPrintCancelledError } from './printErrors'
import type { LabelTemplate, ReceiptTemplate } from '@shared/receipt'

/** پروفایل چاپ در سمت renderer — همان نام‌گذاری main (بخش ۵.۵ طرح). */
export type PrintFlowKind = 'INVOICE' | 'WHOLESALE' | 'LABEL'

export type PrintFlowResult = 'DONE' | 'CANCELLED'

/** خروجی پنجره‌ی انتخاب چاپگر؛ `null` = کاربر انصراف داد. */
export interface PrinterChoice {
  deviceName: string
  saveAsDefault: boolean
}

/**
 * تابعی که پنجره‌ی انتخاب چاپگر را باز می‌کند. `PrinterPickerHost` این را در
 * ریشه‌ی برنامه ثبت می‌کند؛ در تست‌های واحد می‌توان مقدار دیگری گذاشت.
 */
export type PrinterPickerOpener = (input: {
  kind: PrintFlowKind
  savedName: string
  title: string
}) => Promise<PrinterChoice | null>

let opener: PrinterPickerOpener | null = null

/** ثبت‌نام پنجره (فقط `PrinterPickerHost`). */
export function setPrinterPickerOpener(fn: PrinterPickerOpener | null): void {
  opener = fn
}

/** متن پیام‌های بخش ۷.۵ که این جریان لازم دارد. */
export const PRINT_FLOW_CANCEL_MESSAGE = '' // انصراف پیام ندارد (لغو قطعی و بی‌صدا)

export interface PrintProfileFlags {
  askEachTime: boolean
  useSystemDialog: boolean
  savedName: string
  /** پروفایلی که «ذخیره به‌عنوان پیش‌فرض» باید واقعاً در آن نوشته شود. */
  defaultProfile: PrintFlowKind
}

/**
 * خواندن پرچم‌های همین لحظه از تنظیمات (نه state کهنه‌ی صفحه).
 *
 * چرا تازه؟ چون «بدون پرسش» را می‌توان از پنل تنظیمات همان لحظه عوض کرد و
 * صفحه‌ای که باز مانده نباید با سیاست قدیمی چاپ کند.
 */
export async function printProfileFlags(kind: PrintFlowKind): Promise<PrintProfileFlags> {
  const bundle = await call<{ receipt: ReceiptTemplate; label: LabelTemplate }>(CH.settingsBundle)
  if (kind === 'LABEL') {
    const t = bundle.label
    return { askEachTime: t.askEachTime !== false, useSystemDialog: t.useSystemDialog === true, savedName: t.printerName, defaultProfile: 'LABEL' }
  }
  const t = bundle.receipt
  const wholesale = kind === 'WHOLESALE' && t.wholesaleSeparate === true
  return {
    askEachTime: t.askEachTime !== false,
    useSystemDialog: t.useSystemDialog === true,
    savedName: wholesale ? t.wholesalePrinterName : t.printerName,
    defaultProfile: wholesale ? 'WHOLESALE' : 'INVOICE'
  }
}

/**
 * نقطه‌ی مشترک چاپ.
 *
 * `doPrint(deviceName, opts)` کار واقعی چاپ را با نام چاپگر انتخاب‌شده انجام
 * می‌دهد (`deviceName = undefined` یعنی «main خودش ذخیره‌شده/پیش‌فرض را
 * resolve کند»). `opts.silent` فقط برای حالت «دیالوگ ویندوز» مقدار `false`
 * می‌گیرد؛ در بقیه‌ی حالت‌ها دست‌نخورده می‌ماند.
 */
export async function printWith(
  kind: PrintFlowKind,
  doPrint: (deviceName?: string, opts?: { silent?: boolean }) => Promise<unknown>
): Promise<PrintFlowResult> {
  const flags = await printProfileFlags(kind)
  const runPrint = async (deviceName?: string, opts?: { silent?: boolean }): Promise<PrintFlowResult> => {
    try {
      await doPrint(deviceName, opts)
      return 'DONE'
    } catch (e) {
      if (isPrintCancelledError(e)) return 'CANCELLED'
      throw e
    }
  }
  if (!flags.askEachTime) {
    return runPrint(undefined)
  }
  if (flags.useSystemDialog) {
    // دیالوگ خود ویندوز؛ انتخاب چاپگر کار کاربر در همان دیالوگ است.
    return runPrint(undefined, { silent: false })
  }
  if (!opener) {
    // اگر میزبان پنجره mount نشده باشد (مثلاً تست واحد)، به رفتار «بی‌پرس»
    // برنمی‌گردیم؛ پیام روشن می‌دهیم تا هیچ‌وقت بی‌صدا روی چاپگر اشتباه نرود.
    throw new Error('پنجره‌ی انتخاب چاپگر آماده نیست؛ صفحه را یک بار ببندید و باز کنید.')
  }
  const choice = await opener({
    kind,
    savedName: flags.savedName,
    title: kind === 'LABEL' ? 'با کدام چاپگر لیبل چاپ شود؟' : 'با کدام چاپگر چاپ شود؟'
  })
  /**
   * `null` = انصراف. نام خالی هم انصراف است: پنجره هرگز نام خالی برنمی‌گرداند
   * و اگر برگرداند، معنی‌اش «main خودت پیش‌فرض را بردار» می‌بود؛ ولی کاربر
   * چیزی انتخاب نکرده، پس هیچ چاپی نباید انجام شود.
   */
  if (!choice || !choice.deviceName) return 'CANCELLED'
  const printed = await runPrint(choice.deviceName)
  if (printed === 'CANCELLED') return 'CANCELLED'
  /**
   * «ذخیره به‌عنوان پیش‌فرض» فقط **بعد از موفقیت چاپ** ذخیره می‌شود؛ اگر چاپ
   * خطا داد، تنظیمات کاربر بی‌دلیل عوض نمی‌شود.
   */
  if (choice.saveAsDefault) {
    try {
      await call(CH.printSetDefault, { profile: flags.defaultProfile, printerName: choice.deviceName })
    } catch (e) {
      console.warn('چاپ انجام شد، اما ذخیره‌ی چاپگر پیش‌فرض ناموفق بود.', e)
    }
  }
  return 'DONE'
}
