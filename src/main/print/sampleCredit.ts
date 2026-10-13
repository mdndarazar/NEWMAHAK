/**
 * ===========================================================================
 * نشست ۳۱۷ · طرح کلاد (برنده)، فاز ۵ — «سند اعتبارِ نمونه» برای پیش‌نمایش و
 * چاپ آزمایشی. همان `creditDocHtml` واقعی با بدترین داده (قوانین بلند،
 * چهار سطر جزئیات صدور، دارنده، بارکد) رندر می‌شود تا مرزها واقعی دیده شوند.
 *
 * قواعد سخت (گارد ایستا در سوت s317):
 *   • هرگز وارد creditCopyPlan / markPrinted / StoreCreditService / DB-write
 *     نمی‌شود ⇒ شمارنده‌ی چاپ و AuditLog اعتبار جلو نمی‌رود.
 *   • چاپ آزمایشی فقط تنظیمات «ذخیره‌شده» را از DB می‌خواند (مثل testPage
 *     فاکتور) — پیش‌نمایش می‌تواند پیش‌نویسِ فرم را بگیرد چون فقط HTML برمی‌گردد.
 *   • کد نمونه «SMPL-» با خط‌تیره است: خارج از الفبای تولید ⇒ با هیچ اعتبار
 *     واقعی تصادف نمی‌کند؛ روی برگه هم نوار «نمونه» می‌نشیند.
 * ===========================================================================
 */
import { barcodePng } from '../services/BarcodeService'
import { settingsService } from '../services/SettingsService'
import { readCreditSettings } from '../services/StoreCreditService'
import { printHtml } from './printer'
import { resolvePrintTargetName } from './target'
import { creditDocHtml, type CreditDocData } from './templates'
import { creditRenderSpec } from './creditSpec'
import { parseCreditSettings, type CreditSettings } from '@shared/credit'
import { faDigits, jalaliToday, jalaliAddDays, money, toClock } from '@shared/jalali'

/** پیش‌نویس تنظیمات از فرم «چاپ سند اعتبار» — فقط برای پیش‌نمایش (نه چاپ آزمایشی). */
export interface CreditSampleDraft {
  paper?: unknown
  customWidthMm?: unknown
  customHeightMm?: unknown
  printFontPx?: unknown
  printMarginXMm?: unknown
  printMarginYMm?: unknown
}

const SAMPLE_CODE = 'SMPL-1404'

async function sampleDocData(settings: CreditSettings, tpl: Awaited<ReturnType<typeof settingsService.receiptTemplate>>): Promise<CreditDocData> {
  let barcodeDataUrl: string | null = null
  try {
    barcodeDataUrl = await barcodePng(SAMPLE_CODE, {
      scale: 2,
      height: Math.round(settings.barcodeHeightMm),
      includetext: settings.barcodeIncludeText
    })
  } catch {
    barcodeDataUrl = null
  }
  const today = jalaliToday()
  return {
    code: SAMPLE_CODE,
    amount: 598000,
    usedAmount: 0,
    remaining: 598000,
    sourceLabel: 'اضافه‌دریافت',
    statusLabel: 'فعال',
    issuedJalali: today,
    issuedTime: toClock(new Date(), false),
    expiresJalali: jalaliAddDays(today, 30),
    usesLabel: 'یک‌بارمصرف',
    maxUses: 1,
    usedCount: 0,
    restrictLabel: null,
    minPurchase: 0,
    maxPerTransaction: 0,
    holderName: 'مشتری نمونه',
    holderCompany: null,
    holderPhone: '091200000000',
    holderAgent: null,
    holderAddress: null,
    holderNationalId: null,
    barcodeDataUrl,
    shopName: tpl.shopName,
    rulesText: settings.rulesText,
    showRules: settings.showRules,
    showHolder: settings.showHolder,
    showRemaining: settings.showRemaining,
    reprint: false,
    voided: false,
    sample: true,
    printCount: 1,
    linkedReceiptNo: 345,
    issueLines: [
      `بابت برگشت از فروش فاکتور ${faDigits(345)} (سند برگشت ${faDigits(12)})`,
      'اقلام برگشتی: شلوار مردانه ×۱، پیراهن آستین‌بلند ×۲',
      `مبلغ کل برگشت: ${money(1598000)} ریال`,
      `باقیمانده‌ی ${money(598000)} ریال به‌صورت اعتبار خرید (همین سند) صادر شد`
    ],
    note: null,
    footer: null
  }
}

/**
 * HTML سند نمونه. `draft` (در صورت وجود) فقط برای پیش‌نمایش است و در همین‌جا
 * با parse به محدوده‌ی امن برگردانده می‌شود؛ چاپ آزمایشی هرگز draft نمی‌گیرد.
 */
export async function creditSampleHtml(input: { draft?: CreditSampleDraft } = {}): Promise<string> {
  const tpl = await settingsService.receiptTemplate()
  const saved = await readCreditSettings()
  const settings = input?.draft ? parseCreditSettings({ ...saved, ...input.draft }) : saved
  const spec = creditRenderSpec(settings)
  return creditDocHtml(await sampleDocData(settings, tpl), tpl, spec)
}

/** چاپ آزمایشی — فقط تنظیمات ذخیره‌شده؛ مثل قرارداد testPage فاکتور. */
export async function runCreditSamplePrint(input: { deviceName?: string; silent?: boolean } = {}): Promise<{ ok: boolean; msg: string }> {
  try {
    const tpl = await settingsService.receiptTemplate()
    const settings = await readCreditSettings()
    const spec = creditRenderSpec(settings)
    const html = creditDocHtml(await sampleDocData(settings, tpl), tpl, spec)
    const { deviceName } = await resolvePrintTargetName({ requestedDeviceName: input?.deviceName, savedName: '' })
    await printHtml(html, { silent: input?.silent ?? false, deviceName })
    return { ok: true, msg: `چاپ آزمایشی سند اعتبار روی «${deviceName ?? 'چاپگر پیش‌فرض'}» انجام شد.` }
  } catch (e: any) {
    return { ok: false, msg: e?.message ?? 'چاپ آزمایشی انجام نشد.' }
  }
}
