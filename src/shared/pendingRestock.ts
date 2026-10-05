/**
 * ===========================================================================
 * جلسه ۴۰ · کار ب — «کالای برگشتیِ در انتظار تأیید مدیر»: تنها منبع حقیقتِ
 * *تعریف* و *متن‌ها*.
 *
 * ---------------------------------- مسئله ----------------------------------
 * وقتی بازپرداخت یک برگشت/تعویض «کارت‌به‌کارت توسط مدیر» است، در لحظه‌ی ثبتِ
 * فروشنده هیچ پولی جابه‌جا نمی‌شود، ولی تا دیروز کالا همان لحظه به موجودی
 * قابل‌فروش اضافه می‌شد. نتیجه: کالایی که پولش به مشتری پس داده نشده، «قابل
 * فروش» شمرده می‌شد و انبارگردانی هم یک «اضافه»ی بی‌توضیح می‌دید.
 *
 * ------------------------------ تعریف رسمی ------------------------------
 *   «معلق برگشتی» =  Σ (qty − restockedQty)  روی اقلامِ برگشت‌هایی که
 *                    `restockPending = true` دارند.
 *
 * دو نکته‌ی سختِ این تعریف:
 *   ۱) منبع حقیقتِ *تعداد*، همان `SaleReturnItem.restockedQty` است (هیچ جدول
 *      موجودی جدیدی ساخته نشد). در حالت معلق صفر ثبت می‌شود و در لحظه‌ی
 *      `pay` برابر `qty` می‌گردد و همان‌جا `inventoryService.increase` می‌خورد.
 *   ۲) منبع حقیقتِ *معلق بودن*، ستون `SaleReturn.restockPending` است و نه
 *      «`restockedQty` صفر است». چون `restockedQty = 0` یک معنای دیگر هم دارد:
 *      «فاکتور اصلی بدون کسر از موجودی بود، پس هیچ‌وقت چیزی برنمی‌گردد». اگر
 *      این دو را یکی می‌گرفتیم، برگشتِ فاکتور عمده‌ی بدون کسر موجودی هم «معلق»
 *      شمرده می‌شد و انبارگردانی یک کسری کاذب می‌ساخت.
 *
 * ------------------------------- چرا اینجا -------------------------------
 * پنج صفحه این عدد را نشان می‌دهند (انبار فروشگاه، گزارشات فروش، انبارگردانی،
 * بستن صندوق، پنل کارت‌به‌کارت). اگر هر کدام متن و فرمول خودش را داشت، اولین
 * اصلاح، پنج عدد و پنج جمله‌ی متفاوت می‌ساخت. پس *محاسبه* و *جمله* هر دو
 * همین‌جا نوشته شده‌اند و همه فقط مصرف‌کننده‌اند.
 *
 * ⚠️ این فایل «قاعده» نمی‌سازد و به دیتابیس دست نمی‌زند: تنها نقطه‌ی اعمال،
 * `PendingRestockService` و `CardTransferService.pay` در main است.
 *
 * ⚠️⚠️ `StockState.PENDING` پروژه (کسر موقت تا تجمیع و انتقال) هیچ ربطی به این
 * ماژول ندارد. اینجا «در انتظار پرداخت مدیر» است، آنجا «در انتظار تجمیع».
 * ===========================================================================
 */

/** برچسب کوتاه، همان چیزی که روی ستون و نشان (badge) می‌نشیند. */
export const PENDING_RESTOCK_LABEL = 'در انتظار تأیید مدیر'

/** برچسب ستون «معلق برگشتی» در جدول‌ها. */
export const PENDING_RESTOCK_COLUMN = 'معلق برگشتی (در انتظار تأیید مدیر)'

/** جمله‌ی ثابتِ توضیحی — در هر پنج صفحه عیناً همین متن دیده می‌شود. */
export const PENDING_RESTOCK_EXPLAINER =
  'این کالا فیزیکی در فروشگاه هست ولی هنوز در موجودی قابل‌فروش نیست: بازپرداختش ' +
  '«کارت‌به‌کارت توسط مدیر» است و تا مدیر در پنل «پرداخت‌های مدیر» دکمه‌ی «پرداخت شد» ' +
  'را نزند، به موجودی قابل‌فروش اضافه نمی‌شود.'

/** جمله‌ی انبارگردانی (بند ۴ خواسته‌ی مالک). */
export const PENDING_RESTOCK_STOCKTAKE_NOTE =
  'موجودی فیزیکیِ مورد انتظار = موجودی قابل‌فروش + معلق برگشتی. پس کالای معلق ' +
  'نباید «اضافه»ی کاذب شمرده شود؛ ستون «معلق برگشتی» همان تعداد را جدا نشان می‌دهد.'

/** ردیف یک کالای معلق (خواندنی؛ هیچ صفحه‌ای بیرون از پنل قفل‌دار دکمه ندارد). */
export interface PendingRestockItem {
  variantId: number
  name: string
  code: string | null
  /** تعداد معلق همین کالا در همین سند برگشت = qty − restockedQty */
  qty: number
  returnId: number
  /** شماره فیش فاکتور اصلی مشتری */
  receiptNo: number | null
  returnedAtJalali: string
  /** شناسه‌ی درخواست کارت‌به‌کارتِ در انتظار پرداخت (اگر هست) */
  requestId: number | null
  /** مبلغی که مدیر باید کارت‌به‌کارت کند */
  amount: number
  operationKind: string
  /** چند روز از ثبت درخواست گذشته است (یادآوری بر اساس سن) */
  ageDays: number
  /** درخواست مرجع رد/لغو شده ولی کالا هنوز معلق است (حالت نیازمند رسیدگی) */
  canceled: boolean
}

/** جمعِ همه‌ی معلق‌ها، همان شکلی که پنج صفحه مصرف می‌کنند. */
export interface PendingRestockSummary {
  /** جمع تعداد کالای معلق */
  totalQty: number
  /** تعداد اسناد برگشتِ معلق */
  returnCount: number
  /** تعداد کالاهای متمایز */
  variantCount: number
  /** جمع مبلغی که مدیر باید بپردازد */
  pendingAmount: number
  /** سنِ قدیمی‌ترین درخواست معلق (روز) */
  oldestAgeDays: number
  /** ردیف‌های معلق، مرتب بر اساس قدیمی‌ترین */
  items: PendingRestockItem[]
  /** معلق به تفکیک کالا (variantId ⇒ تعداد) — برای صفحه‌ی انبار و انبارگردانی */
  byVariant: Record<number, number>
  /** ردیف‌هایی که درخواستشان رد/لغو شده ولی کالا هنوز معلق است */
  needsAttentionQty: number
}

export const EMPTY_PENDING_RESTOCK: PendingRestockSummary = {
  totalQty: 0,
  returnCount: 0,
  variantCount: 0,
  pendingAmount: 0,
  oldestAgeDays: 0,
  items: [],
  byVariant: {},
  needsAttentionQty: 0
}

const n = (v: unknown): number => {
  const x = Math.round(Number(v) || 0)
  return Number.isFinite(x) ? x : 0
}

/**
 * تعداد معلقِ یک سند برگشت = Σ(qty − restockedQty).
 * هرگز منفی برنمی‌گردد: اگر `restockedQty` به هر دلیلی از `qty` بیشتر بود،
 * سهم آن قلم صفر است (وگرنه یک قلم می‌توانست معلقِ قلم دیگر را پاک کند).
 */
export function pendingQtyOfItems(items: { qty?: number; restockedQty?: number }[] = []): number {
  let sum = 0
  for (const it of items) sum += Math.max(0, n(it.qty) - n(it.restockedQty))
  return sum
}

/** آیا این قلم هنوز معلق است؟ (شرط idempotent بودن `pay`) */
export function itemNeedsRestock(item: { qty?: number; restockedQty?: number }): boolean {
  return n(item.restockedQty) < n(item.qty)
}

/** سن یک درخواست به روز (بر اساس تاریخ ثبت). */
export function ageInDays(from: Date | string | number | null | undefined, now: Date = new Date()): number {
  if (!from) return 0
  const d = from instanceof Date ? from : new Date(from)
  const t = d.getTime()
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000))
}

/**
 * موجودی فیزیکیِ *مورد انتظار* روی قفسه.
 * هدف انبارگردانی (بند ۴): قابل‌فروش + معلق برگشتی.
 */
export function expectedPhysicalQty(sellableQty: number, pendingQty: number): number {
  return n(sellableQty) + n(pendingQty)
}

/**
 * جمله‌ی هشدارِ آماده، مثل نمونه‌ی خواسته‌ی مالک:
 * «۲ شلوار برگشتی در انتظار پرداخت مدیر؛ هنوز در موجودی قابل‌فروش نیست ولی
 *  فیزیکی در فروشگاه هست».
 *
 * `digits` را صدازننده می‌دهد (در renderer همان `faDigits`) تا این فایل به
 * هیچ ماژول دیگری وابسته نشود و در تست خالص هم قابل اجرا بماند.
 */
export function pendingRestockLine(
  item: { name: string; qty: number; ageDays?: number },
  digits: (v: string | number) => string = String
): string {
  const age = n(item.ageDays)
  return (
    `${digits(item.qty)} ${item.name} برگشتی در انتظار پرداخت مدیر؛ هنوز در موجودی قابل‌فروش نیست ` +
    'ولی فیزیکی در فروشگاه هست' +
    (age > 0 ? ` · ${digits(age)} روز از ثبت درخواست گذشته است` : '')
  )
}

/** جمله‌ی خلاصه‌ی بالای هر صفحه (خالی ⇒ null، پس هیچ کادر بی‌محتوایی ساخته نمی‌شود). */
export function pendingRestockHeadline(
  summary: Pick<PendingRestockSummary, 'totalQty' | 'returnCount' | 'pendingAmount' | 'oldestAgeDays'> | null | undefined,
  digits: (v: string | number) => string = String,
  /** جلسه ۴۹: `money(n: number, persian?: boolean)` پروژه فقط عدد می‌گیرد */
  money: (v: number) => string = String
): string | null {
  if (!summary || n(summary.totalQty) <= 0) return null
  return (
    `${digits(summary.totalQty)} قلم کالای برگشتی در ${digits(summary.returnCount)} سند، ` +
    `در انتظار پرداخت مدیر (${money(summary.pendingAmount)} ریال). ` +
    PENDING_RESTOCK_EXPLAINER +
    (n(summary.oldestAgeDays) > 0
      ? ` قدیمی‌ترین درخواست ${digits(summary.oldestAgeDays)} روز پیش ثبت شده است.`
      : '')
  )
}

/**
 * یادآوری بر اساس *سن* درخواست (خواسته‌ی «چند روز مانده»).
 * سه پله، عمداً ساده و بدون تنظیمات جدید: پروژه برای هر عدد جادویی یک صفحه‌ی
 * تنظیمات می‌خواهد و این یکی ارزشش را ندارد؛ متن خودش عدد روز را می‌گوید.
 */
export const PENDING_RESTOCK_WARN_DAYS = 3
export const PENDING_RESTOCK_ALERT_DAYS = 7

export type PendingRestockTone = 'none' | 'info' | 'warn' | 'alert'

export function pendingRestockTone(oldestAgeDays: number, totalQty = 1): PendingRestockTone {
  if (n(totalQty) <= 0) return 'none'
  const d = n(oldestAgeDays)
  if (d >= PENDING_RESTOCK_ALERT_DAYS) return 'alert'
  if (d >= PENDING_RESTOCK_WARN_DAYS) return 'warn'
  return 'info'
}

/** متن یادآوری بستن صندوق/شیفت (فقط هشدار؛ روی هیچ عددی اثر ندارد). */
export function pendingRestockShiftWarning(
  summary: Pick<PendingRestockSummary, 'totalQty' | 'returnCount' | 'oldestAgeDays'> | null | undefined,
  digits: (v: string | number) => string = String
): string | null {
  if (!summary || n(summary.totalQty) <= 0) return null
  const d = n(summary.oldestAgeDays)
  return (
    `${digits(summary.totalQty)} قلم کالای برگشتی در انتظار پرداخت مدیر باقی مانده است` +
    (d >= PENDING_RESTOCK_ALERT_DAYS
      ? ` و قدیمی‌ترینش ${digits(d)} روز است — رسیدگی‌اش عقب افتاده.`
      : d >= PENDING_RESTOCK_WARN_DAYS
        ? ` (قدیمی‌ترین: ${digits(d)} روز).`
        : '.') +
    ' این مبلغ و این کالا هیچ اثری روی کسری/اضافی صندوق ندارند: نه پولی از کشو ' +
    'بیرون رفته و نه کالا در موجودی قابل‌فروش نشسته.'
  )
}

/** متن `stockNote` درخواست، در دو حالتِ «معلق» و «آزاد شد». */
export function pendingStockNote(qty: number, digits: (v: string | number) => string = String): string {
  return (
    `${digits(qty)} عدد کالای برگشتی **به انبار اضافه نشد** و در انتظار پرداخت مدیر است ` +
    '(فیزیکی در فروشگاه، بیرون از موجودی قابل‌فروش)'
  )
}

export function releasedStockNote(qty: number, digits: (v: string | number) => string = String): string {
  return `${digits(qty)} عدد کالای برگشتی با تأیید پرداخت مدیر به موجودی قابل‌فروش برگشت`
}
