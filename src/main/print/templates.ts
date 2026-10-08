import { money, toJalaliDate, toClock, faDigits, jalaliToday } from '@shared/jalali'
import type { DebtPaymentReceiptData } from '@shared/debtReceipt'
import {
  DEFAULT_LABEL_TEMPLATE,
  DEFAULT_RECEIPT_TEMPLATE,
  type LabelTemplate,
  type ReceiptTemplate
} from '@shared/receipt'
// بند ۷ (جلسه ۳۱) — تصمیم نمایشی لوگوی سند اعتبار (بخش ۱۰)
import { creditDocLogo } from '@shared/creditUi'
// نشست ۳۱۷ — طرح چاپ اعتبار: اگر layout غیرتاریخی باشد CSS با آن ساخته می‌شود
import type { CreditPrintLayout } from '@shared/creditPrint'
// نشست ۲۲۲ · فاز ۱ طرح چاپ — اندازه‌ی کاغذ فاکتور (میکرون/میلی‌متر) و پروفایل چاپ
import { receiptPageSpec, type PageSpec, type ReceiptProfile } from '@shared/printSpec'
// نشست ۲۲۲ · فاز ۲ طرح چاپ — چیدمان «ردیفی» لیبل روی رول (بخش ۸.۲)
import {
  LABEL_ROLL_LIMITS,
  labelColumns,
  labelRowCssHeightMm,
  labelRowDims,
  labelRows
} from '@shared/printSpec'

/** عدد میلی‌متری/pt در CSS: بدون صفر اضافه و بدون خطای اعشار ممیز شناور. */
const mm = (n: number): string => String(Math.round(Number(n) * 100) / 100)

/**
 * ===========================================================================
 * پوسته‌ی مشترک سند چاپی.
 *
 * دو مسیر دارد و این دو عمداً جدا مانده‌اند:
 *
 *   ۱) `base(body, '210mm', '11px')` — مسیر قدیمی (گزارش A4 و خلاصه‌ی حرارتی،
 *      که فاز ۱ طرح به آن‌ها دست نمی‌زند). خروجی این مسیر **مو‌به‌مو** همان
 *      رشته‌ی قبلی است تا هیچ چاپی بی‌دلیل عوض نشود.
 *
 *   ۲) `base(body, spec)` — مسیر تازه‌ی فاکتور (نشست ۲۲۲ · فاز ۱، بخش ۸.۱ طرح):
 *      عرض `html` و `body` هر دو عرض کاغذ فیزیکی است، `box-sizing:border-box` و
 *      `padding` حاشیه‌ی تنظیمات، فونت بر حسب pt (متناسب با عرض)، جدول
 *      `table-layout:fixed` تا عرض قابل‌چاپ کامل پر شود، و `@page {size}` فقط
 *      وقتی ارتفاع ثابت است — برای رول پیوسته اندازه‌ی صفحه از سمت main
 *      (`pageSize` میکرونی) می‌آید و `Wmm auto` نوشته نمی‌شود (کرومیوم آن را
 *      معتبر نمی‌داند؛ `creditDocHtml` قدیمی همین عبارت را دارد و خارج از این
 *      فاز است).
 *
 * ⚠️ عمداً هیچ ارتفاع ثابت/`100vh` در قالب نیست: حالت «ارتفاع خودکار» بر پایه‌ی
 * اندازه‌گیری واقعی محتوا کار می‌کند، پس هر ارتفاع تحمیلی اندازه‌گیری را خراب
 * می‌کند.
 * ===========================================================================
 */
const base = (body: string, specOrWidth: PageSpec | string, font = '12px'): string => {
  if (typeof specOrWidth === 'string') {
    return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  @page { margin: 0; }
  body { box-sizing:border-box; font-family: Vazirmatn, Tahoma, sans-serif; width:${specOrWidth}; margin:0; padding:6mm 4mm; font-size:${font}; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:2px 3px; }
  .c { text-align:center } .l { text-align:left }
  .line { border-top:1px dashed #000; margin:4px 0 }
  .tot td { font-weight:700 }
  h1 { font-size:14px; text-align:center; margin:0 0 4px }
</style></head><body>${body}</body></html>`
  }

  const s = specOrWidth
  const page =
    s.heightMm === 'AUTO'
      ? '@page { margin: 0; }'
      : `@page { size: ${mm(s.widthMm)}mm ${mm(Number(s.heightMm))}mm; margin: 0; }`
  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  ${page}
  html, body { margin:0; padding:0; }
  html { width:${mm(s.widthMm)}mm; }
  body { box-sizing:border-box; font-family: Vazirmatn, Tahoma, sans-serif; width:${mm(s.widthMm)}mm;
         padding:${mm(s.marginYMm)}mm ${mm(s.marginXMm)}mm; font-size:${mm(s.fontPt)}pt; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  th, td { padding:2px 3px; }
  td.nm { overflow-wrap:anywhere; }
  .c { text-align:center } .l { text-align:left }
  .line { border-top:1px dashed #000; margin:4px 0 }
  .tot td { font-weight:700 }
  h1 { font-size:1.1667em; text-align:center; margin:0 0 4px }
</style></head><body>${body}</body></html>`
}

/** متن کاربر هیچ‌وقت خام داخل HTML چاپ نمی‌رود (نام کالا می‌تواند & یا < داشته باشد). */
function escapeHtml(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface ReceiptItem {
  name: string
  qty: number
  unitPrice: number
  lineTotal: number
}

/**
 * داده‌ی رسید فروش. همه‌ی فیلدها اختیاری‌اند جز اقلام و شماره، چون نمایش هر
 * فیلد با تنظیمات (ReceiptTemplate) روشن/خاموش می‌شود.
 */
export interface ReceiptData {
  receiptNo: number
  date?: Date | string
  dateJalali?: string
  time?: string
  shopName?: string
  orderTypeLabel?: string
  tableNo?: string | null
  customerName?: string
  customerCode?: string | null
  cashierName?: string
  shiftName?: string | null
  items: ReceiptItem[]
  goodsTotal: number
  serviceCharge?: number
  discountTotal?: number
  taxTotal?: number
  deliveryFee?: number
  grandTotal: number
  /** مبلغ پرداختی مشتری (فاکتور فروش عمده می‌تواند جزئی پرداخت شده باشد) */
  paidTotal?: number | null
  /** مانده بدهی با فرمول واحد (`remainingOf`)؛ اگر نباشد از grandTotal − paid ساخته می‌شود. */
  remaining?: number | null
  payments?: { label: string; amount: number }[]
  returnCode?: string | null
  returnCodeExpiresJalali?: string | null
  /** تصویر بارکد Code128 کد فاکتور (dataURL) — در ipc ساخته می‌شود */
  returnBarcodeDataUrl?: string | null
  /**
   * نشست ۳۱۶ — فیلد «مبدأ کسر» (جلسه ۵۳) حذف شد: اطلاعات انبار روی رسید
   * مشتری چاپ نمی‌شود؛ فقط در ستون فهرست/گزارش داخلی می‌ماند.
   */
  footer?: string
}

/**
 * ===========================================================================
 * فیش/فاکتور حرارتی فروش تکی.
 *
 * چیدمان عیناً مطابق رسید فعلی فروشگاه است:
 *   ساعت + تاریخ · نام فروشگاه · شماره فیش / نوع سفارش / میز · اشتراک و نام
 *   مشتری · جدول (ردیف، نام، تعداد، قیمت کل) · جمع کل، حق سرویس، تخفیف،
 *   مالیات و عوارض · قابل پرداخت · نحوه پرداخت · پیام‌های پایانی · تلفن/سایت.
 *
 * تنظیمات (پنل تنظیمات → قالب فاکتور) فقط «نمایش/عدم نمایش» و «متن» را عوض
 * می‌کند؛ ساختار و ترتیب ثابت می‌ماند تا رسید همیشه همان شکل آشنا را داشته
 * باشد. کد فاکتور (برگشت از فروش) هم به‌صورت متن و بارکد در پایین چاپ می‌شود.
 * ===========================================================================
 */
export function receiptHtml(d: ReceiptData, template?: Partial<ReceiptTemplate>, profile: ReceiptProfile = 'RETAIL'): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  /**
   * نشست ۲۲۲ · فاز ۱ — اندازه‌ی کاغذ/حاشیه/فونت از همین‌جا ساخته می‌شود (بخش ۸.۱
   * طرح). برای ۷۲mm و `autoFont` روشن، `fontPt` دقیقاً ۹pt = همان ۱۲px قبلی است،
   * پس ظاهر رسید فعلی فروشگاه عوض نمی‌شود؛ فقط عرض کاغذ ۸۰mm و ارتفاع درست به
   * چاپگر اعلام می‌شود.
   */
  const spec = receiptPageSpec(t, profile)
  const when = d.date ? (d.date instanceof Date ? d.date : new Date(d.date)) : new Date()
  const dateJalali = d.dateJalali ?? toJalaliDate(when)
  const time = d.time ?? toClock(when)

  const head: string[] = []
  if (t.showDateTime)
    head.push(
      `<div class="row"><span>${faDigits(time)}</span><span>${faDigits(dateJalali)}</span></div>`
    )
  head.push(`<h1>${escapeHtml(d.shopName ?? t.shopName)}</h1>`)

  const idParts: string[] = []
  if (t.showReceiptNo) idParts.push(`<span>${escapeHtml(t.receiptNoLabel)} ${faDigits(d.receiptNo)}</span>`)
  if (t.showOrderType && d.orderTypeLabel) idParts.push(`<span>${escapeHtml(d.orderTypeLabel)}</span>`)
  if (t.showTable) idParts.push(`<span>${escapeHtml(t.tableLabel)} : ${escapeHtml(d.tableNo ?? '')}</span>`)
  if (idParts.length) head.push(`<div class="row">${idParts.join('')}</div>`)

  if (t.showCustomer)
    head.push(
      `<div class="row"><span>${escapeHtml(t.customerLabel)} ${faDigits(d.customerCode ?? '')}</span>` +
        `<span>${escapeHtml(d.customerName ?? 'مشتری عمومی')}</span></div>`
    )
  if (t.showCashier && d.cashierName)
    head.push(
      `<div class="row"><span>فروشنده: ${escapeHtml(d.cashierName)}</span>` +
        `<span>${escapeHtml(d.shiftName ?? '')}</span></div>`
    )

  const rows = d.items
    .map((i, idx) => {
      const cells: string[] = []
      if (t.showRowNumber) cells.push(`<td class="c">${faDigits(idx + 1)}</td>`)
      cells.push(`<td class="nm">${escapeHtml(i.name)}</td>`)
      cells.push(`<td class="c">${faDigits(i.qty)}</td>`)
      if (t.showUnitPrice) cells.push(`<td class="c">${money(i.unitPrice)}</td>`)
      cells.push(`<td class="l">${money(i.lineTotal)}</td>`)
      return `<tr>${cells.join('')}</tr>`
    })
    .join('')

  /**
   * عرض ستون‌های جدول (بخش ۸.۱ طرح): ردیف ۸٪ · نام انعطاف‌پذیر · تعداد ۱۴٪ ·
   * ستون‌های مبلغ ۲۲٪. با `table-layout:fixed` ستون «نام» بقیه‌ی عرض را می‌گیرد و
   * با `td.nm` حداکثر در دو خط می‌شکند.
   */
  const colWidths: string[] = []
  if (t.showRowNumber) colWidths.push('8%')
  colWidths.push('') // نام — انعطاف‌پذیر
  colWidths.push('14%')
  if (t.showUnitPrice) colWidths.push('22%')
  colWidths.push('22%')
  const colgroup = `<colgroup>${colWidths
    .map((w) => (w ? `<col style="width:${w}">` : '<col>'))
    .join('')}</colgroup>`

  const th: string[] = []
  if (t.showRowNumber) th.push('<th class="c">ردیف</th>')
  th.push('<th>نام</th>')
  th.push('<th class="c">تعداد</th>')
  if (t.showUnitPrice) th.push('<th class="c">قیمت</th>')
  th.push('<th class="l">قیمت کل</th>')

  const sums: string[] = []
  const sumRow = (label: string, value: number, bold = false) =>
    `<div class="row${bold ? ' big' : ''}"><span>${escapeHtml(label)}</span><span>${money(value)}</span></div>`
  if (t.showGoodsTotal) sums.push(sumRow(t.goodsTotalLabel, d.goodsTotal))
  if (t.showServiceCharge) sums.push(sumRow(t.serviceChargeLabel, d.serviceCharge ?? 0))
  if (t.showDiscount) sums.push(sumRow(t.discountLabel, d.discountTotal ?? 0))
  if (t.showTax) sums.push(sumRow(t.taxLabel, d.taxTotal ?? 0))
  if ((d.deliveryFee ?? 0) > 0) sums.push(sumRow('هزینه پیک', d.deliveryFee ?? 0))
  if (t.showPayable) sums.push(sumRow(t.payableLabel, d.grandTotal, true))

  // «مبلغ پرداختی» و «مانده حساب»: فقط وقتی فاکتور کامل پرداخت نشده است
  // (مثلاً فاکتور عمده‌ی ۲۰ میلیونی که مشتری ۱۰ میلیون داده). در فروش تکی که
  // همیشه تسویه‌ی کامل است، رسید مثل قبل و بدون این دو خط چاپ می‌شود.
  const paid = d.paidTotal
  const remaining =
    d.remaining != null
      ? Math.round(d.remaining)
      : paid == null
        ? 0
        : Math.round(d.grandTotal - paid)
  if (paid != null && remaining !== 0) {
    if (t.showPaid) sums.push(sumRow(t.paidLabel, Math.round(paid)))
    if (t.showRemaining) sums.push(sumRow(t.remainingLabel, remaining, true))
  }

  const pays =
    t.showPaymentMethod && d.payments?.length
      ? `<div class="pay">${escapeHtml(t.paymentLabel)} : ${d.payments
          .map((p) => `${escapeHtml(p.label)} : ${money(p.amount)} ریال`)
          .join(' · ')}</div>`
      : ''

  /**
   * نشست ۳۱۶ · خواسته‌ی مالک — بلوک «مبدأ کسر» (جلسه ۵۳) از رسید مشتری حذف شد:
   * «مشتری نیازی ندارد ببیند کالا از کدام انبار کسر شد یا موجودی منفی شده است.»
   * داده‌ی مبدأ فقط برای فهرست/گزارش داخلی باقی می‌ماند؛ این بلوک عمداً خالی
   * است تا حتی فاکتور دارای دفتر هم رسیدی بدون اطلاعات انبار بگیرد.
   */

  const codeBlock =
    t.showReturnDeadline && t.showReturnCode && d.returnCode
      ? `<div class="line"></div>
         <div class="c code">${escapeHtml(t.returnCodeLabel)}: <b>${escapeHtml(d.returnCode)}</b></div>
         ${
           t.showReturnBarcode && d.returnBarcodeDataUrl
             ? `<div class="c"><img class="bc" src="${d.returnBarcodeDataUrl}" alt="${escapeHtml(d.returnCode)}" /></div>`
             : ''
         }
         ${
           d.returnCodeExpiresJalali
             ? `<div class="c kbd">اعتبار برگشت از فروش تا ${faDigits(d.returnCodeExpiresJalali)}</div>`
             : ''
         }`
      : ''

  const footers: string[] = []
  for (const line of [t.footerLine1, t.footerLine2, t.footerLine3]) {
    if (line && line.trim()) footers.push(`<div class="msg">${escapeHtml(line)}</div>`)
  }
  if (d.footer) footers.push(`<div class="msg">${escapeHtml(d.footer)}</div>`)
  if (t.showPhone && t.phone) footers.push(`<div class="c">تلفن ${faDigits(t.phone)}</div>`)
  if (t.showWebsite && t.website) footers.push(`<div class="c">${escapeHtml(t.website)}</div>`)

  /**
   * همه‌ی اندازه‌های نسبی با `em` است تا با `fontPt` (که خودش متناسب با عرض
   * کاغذ است) مقیاس بخورد. برای قالب فعلی (۷۲mm، ۱۲px) مقادیر عیناً همان قبلی
   * می‌شود: `1.15em × 9pt = 10.35pt ≈ 13.8px ≈ round(12×1.15)px`.
   */
  const style = `<style>
    .row { display:flex; justify-content:space-between; gap:4px; margin:1px 0; }
    .row.big { font-weight:700; font-size:1.15em; margin-top:3px; }
    .pay { margin-top:3px; text-align:center; }
    .msg { border:1px solid #000; text-align:center; padding:2px; margin:3px 0; }
    .code { margin:2px 0; letter-spacing:1px; }
    .bc { max-width:${mm(Math.max(30, spec.contentWidthMm - 14))}mm; height:12mm; }
    .kbd { font-size:max(6pt, 0.75em); }
    table th { border-bottom:1px solid #000; }
    table td { border-bottom:1px dotted #999; }
  </style>`

  return base(
    style +
      head.join('') +
      '<div class="line"></div>' +
      `<table>${colgroup}<thead><tr>${th.join('')}</tr></thead><tbody>${rows}</tbody></table>` +
      '<div class="line"></div>' +
      sums.join('') +
      pays +
      codeBlock +
      '<div class="line"></div>' +
      footers.join(''),
    spec
  )
}

/** گزارش A4 عمومی (گزارشات فروش، تجمیع، لیست کالا) */
export function reportHtml(
  title: string,
  headers: string[],
  rows: (string | number)[][],
  totals?: (string | number)[],
  meta?: string,
  /**
   * بند ۷ — بلوک «خلاصه‌ی فروش» زیر جدول (فروش کل، حق سرویس، عوارض، نسیه،
   * پرداخت نسیه‌ی قبل، تخفیف، خالص). اختیاری است، پس همه‌ی چاپ‌های قبلی
   * مو‌به‌مو مثل قبل می‌مانند و فقط گزارش فروش این بلوک را می‌فرستد.
   *
   * ردیف‌هایی که کاربر از فیلتر برداشته است عمداً *فرستاده نمی‌شوند*، تا کاغذ
   * چاپ‌شده هم عیناً همان چیزی باشد که روی صفحه دیده شده است.
   */
  summary?: { label: string; value: string | number; bold?: boolean; note?: boolean }[]
): string {
  const th = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const tr = rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')
  const tf = totals ? `<tr class="tot">${totals.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>` : ''
  const sum =
    summary?.length
      ? `<table border="1" style="margin-top:8px;width:60%;margin-inline-start:auto">
           <tbody>${summary
             .map(
               (s) =>
                 `<tr${s.bold ? ' class="tot"' : ''}>` +
                 `<td${s.note ? ' colspan="2"' : ''} style="text-align:start">${escapeHtml(s.label)}</td>` +
                 (s.note ? '' : `<td style="text-align:end;direction:ltr">${escapeHtml(s.value)}</td>`) +
                 '</tr>'
             )
             .join('')}</tbody>
         </table>`
      : ''
  return base(
    `<h1 style="font-size:16px">${escapeHtml(title)}</h1>
     ${meta ? `<div style="text-align:center;margin-bottom:4px">${escapeHtml(meta)}</div>` : ''}
     <table border="1"><thead><tr>${th}</tr></thead><tbody>${tr}${tf}</tbody></table>
     ${sum}`,
    '210mm',
    '11px'
  )
}

/**
 * گزارش حرارتی (دکمه‌ی «چاپ حرارتی» در گزارش فروش و بستن صندوق).
 * برای شیفت‌ها ساخته شده: تیتر، بازه، و لیست «برچسب: مقدار» با یک جمع پررنگ.
 */
export function summaryThermalHtml(
  title: string,
  lines: { label: string; value: string | number; bold?: boolean }[],
  meta?: string,
  paperWidthMm = 72
): string {
  const style = `<style>
    .row { display:flex; justify-content:space-between; gap:6px; margin:2px 0; }
    .row.b { font-weight:700; font-size:14px; border-top:1px solid #000; padding-top:3px; }
  </style>`
  const body = lines
    .map(
      (l) =>
        `<div class="row${l.bold ? ' b' : ''}"><span>${escapeHtml(l.label)}</span><span>${escapeHtml(l.value)}</span></div>`
    )
    .join('')
  return base(
    style +
      `<h1>${escapeHtml(title)}</h1>` +
      (meta ? `<div class="c">${escapeHtml(meta)}</div>` : '') +
      '<div class="line"></div>' +
      body,
    `${paperWidthMm}mm`
  )
}

/**
 * ===========================================================================
 * لیبل چسبان بارکد (مورد ۵ و ۸).
 *
 * ابعاد، چاپگر و اجزای روی لیبل از تنظیمات *مستقل* «چاپ لیبل» می‌آیند
 * (`LabelTemplate`)، نه از قالب فاکتور. پیش‌فرض همان لیبل رایج ۵×۳ سانتی‌متر
 * است، دقیقاً مطابق نمونه‌ی چسبان فروشگاه: نام کالا، بارکد، قیمت.
 *
 * قالب‌های آماده (کلاسیک · برند بالای لیبل · لوگو و برند · بدون اسم · قیمت
 * درشت · کامل) فقط همین فیلدها را جابه‌جا می‌کنند؛ ساختِ HTML یکی است:
 *
 *   [لوگو] [نام برند] [نام کالا] [کد] [بارکد] [قیمت] [نام برند (اگر پایین باشد)]
 *
 * هر بخش با یک سوییچ در تنظیمات روشن/خاموش می‌شود، پس «قالب» چیزی جز یک
 * مجموعه‌ی آماده از همین سوییچ‌ها نیست و کاربر می‌تواند هر کدام را عوض کند.
 *
 * چیدمان: هر لیبل یک صفحه‌ی جدا به اندازه‌ی خودِ لیبل (`@page size`) است، پس
 * دستگاه برچسب‌زن هر لیبل را روی یک برچسب چاپ می‌کند و لیبل‌ها روی یک برگه‌ی
 * A4 کنار هم نمی‌افتند. «اسم کالا» با خاموش کردن `showName` کاملاً حذف می‌شود
 * (لیبل بدون اسم = فقط قیمت و بارکد).
 *
 * ورودی از قبل «باز شده» است: اگر برای یک کالا ۳ نسخه خواسته شده باشد، همان
 * کالا سه بار در آرایه آمده است.
 * ===========================================================================
 */
export function labelHtml(
  items: { name: string; code: string; price: number; barcodeDataUrl: string }[],
  template?: Partial<LabelTemplate>,
  opts?: { startColumn?: number }
): string {
  const t: LabelTemplate = { ...DEFAULT_LABEL_TEMPLATE, ...(template ?? {}) }
  const w = Math.max(10, Math.round(t.widthMm) || DEFAULT_LABEL_TEMPLATE.widthMm)
  const h = Math.max(10, Math.round(t.heightMm) || DEFAULT_LABEL_TEMPLATE.heightMm)
  /**
   * ⚠️ نشست ۲۲۲ · فاز ۲ (بخش ۸.۲ طرح) — واحد چاپ **یک ردیف** است، نه یک لیبل:
   * روی رول دوستونه، «یک لیبل» یعنی یک ردیف با یک خانه‌ی خالی، وگرنه چاپگر
   * لیبل بعدی را یک خانه جلو می‌برد. خانه‌ی خالی `visibility:hidden` است، پس
   * لیبل اضافه مصرف نمی‌کند.
   */
  const { rowWidthMm, rowHeightMm } = labelRowDims(t)
  const rowCssHeight = labelRowCssHeightMm(rowHeightMm)
  const columns = labelColumns(t.columns)
  const gapX = Math.min(
    LABEL_ROLL_LIMITS.maxGapMm,
    Math.max(LABEL_ROLL_LIMITS.minGapMm, Math.round(Number(t.gapXMm) || 0))
  )
  const offsetX = Math.min(LABEL_ROLL_LIMITS.maxOffsetMm, Math.max(LABEL_ROLL_LIMITS.minOffsetMm, Math.round(Number(t.offsetXMm) || 0)))
  const offsetY = Math.min(LABEL_ROLL_LIMITS.maxOffsetMm, Math.max(LABEL_ROLL_LIMITS.minOffsetMm, Math.round(Number(t.offsetYMm) || 0)))
  const bcH = Math.min(Math.max(4, h - 4), Math.max(4, Math.round(t.barcodeHeightMm) || 13))
  const logoH = Math.min(Math.max(2, h - 4), Math.max(2, Math.round(t.logoHeightMm) || 7))

  const brand = String(t.brandName ?? '').trim()
  const showBrand = t.showBrand && !!brand
  const showLogo = t.showLogo && !!String(t.logoDataUrl ?? '').trim()
  const brandBlock = showBrand ? `<div class="lbl-br">${escapeHtml(brand)}</div>` : ''
  const logoBlock = showLogo ? `<img class="lbl-lg" src="${t.logoDataUrl}" alt="" />` : ''

  /** محتوای یک لیبل (بدون پوسته‌ی خانه) — برای خانه‌ی خالی صدا زده نمی‌شود. */
  const labelParts = (i: { name: string; code: string; price: number; barcodeDataUrl: string }): string => {
    const parts: string[] = []
    // لوگو و برند بالای لیبل (مطابق نمونه‌ی چسبان فروشگاه)
    if (logoBlock) parts.push(logoBlock)
    if (t.brandPosition !== 'BOTTOM') parts.push(brandBlock)
    if (t.showName && i.name && i.name.trim()) parts.push(`<div class="lbl-nm">${escapeHtml(i.name)}</div>`)
    if (t.showCode && i.code) parts.push(`<div class="lbl-cd">${faDigits(i.code)}</div>`)
    parts.push(
      i.barcodeDataUrl
        ? `<img class="lbl-bc" src="${i.barcodeDataUrl}" alt="${escapeHtml(i.code)}" />`
        : `<div class="lbl-nm">${escapeHtml(i.code)}</div>`
    )
    if (t.showPrice) parts.push(`<div class="lbl-pr">${money(i.price)} ریال</div>`)
    if (t.brandPosition === 'BOTTOM') parts.push(brandBlock)
    return parts.filter(Boolean).join('')
  }

  const rows = labelRows(items, columns, opts?.startColumn ?? 1)
  const rowsHtml = rows
    .map(
      (row) =>
        `<div class="row">${row
          .map((i) => (i === null ? '<div class="lbl empty"></div>' : `<div class="lbl">${labelParts(i)}</div>`))
          .join('')}</div>`
    )
    .join('')

  const align = t.align === 'RIGHT' ? 'right' : 'center'
  const items_align = t.align === 'RIGHT' ? 'flex-end' : 'center'

  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8">
<style>
  @page { size: ${mm(rowWidthMm)}mm ${mm(rowHeightMm)}mm; margin: 0; }
  html, body { margin:0; padding:0; height:auto; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; }
  /* ردیف = واحد چاپ. ستون ۱ چپ فیزیکی است (direction:ltr) و متن هر لیبل RTL. */
  .row { display:grid; grid-template-columns:repeat(${columns}, ${mm(w)}mm); column-gap:${mm(gapX)}mm;
         width:${mm(rowWidthMm)}mm; height:${mm(rowCssHeight)}mm; direction:ltr; overflow:hidden;
         position:relative; left:${mm(offsetX)}mm; top:${mm(offsetY)}mm;
         break-after:page; break-inside:avoid; }
  .row:last-child { break-after:auto; }
  .lbl { direction:rtl; width:100%; height:100%; box-sizing:border-box; padding:1mm;
         display:flex; flex-direction:column; align-items:${items_align}; justify-content:space-between;
         overflow:hidden; text-align:${align}; }
  /* خانه‌ی خالی چاپ نمی‌شود و لیبل اضافه مصرف نمی‌کند. */
  .lbl.empty { visibility:hidden; }
  .lbl-br { font-size:${t.brandFontPx}px; font-weight:700; line-height:1.2; width:100%; text-align:${align}; }
  .lbl-lg { max-width:${Math.max(8, w - 4)}mm; height:${logoH}mm; object-fit:contain; }
  .lbl-nm { font-size:${t.nameFontPx}px; line-height:1.25; max-height:${Math.max(3, Math.round(h / 3))}mm;
            overflow:hidden; text-align:${align}; width:100%; }
  .lbl-cd { font-size:${Math.max(6, t.nameFontPx - 1)}px; direction:ltr; }
  .lbl img.lbl-bc { max-width:${Math.max(10, w - 4)}mm; height:${bcH}mm; }
  .lbl-pr { font-size:${t.priceFontPx}px; font-weight:700; }
</style></head><body>${rowsHtml}</body></html>`
}
/**
 * ===========================================================================
 * «سند تعویض کالا» (بخش ۶) — قالب چاپ حرارتی.
 *
 * چرا یک قالب جدا و نه همان `receiptHtml`؟ چون سند تعویض *دو* جدول دارد
 * (کالای برگشتی و کالای جایگزین) و عدد اصلی‌اش «مابه‌التفاوت» است، نه «قابل
 * پرداخت». با زور چپاندنش در قالب رسید فروش، هر دو قالب خوانایی‌شان را از دست
 * می‌دادند.
 *
 * ولی *ظاهر* و تنظیمات از همان `ReceiptTemplate` می‌آید (عرض کاغذ، اندازه‌ی
 * فونت، نام فروشگاه، تلفن/سایت، پیام‌های پایانی)، پس سند تعویض با رسید فروش
 * فروشگاه یک‌شکل چاپ می‌شود و هیچ تنظیم جدیدی لازم نیست.
 *
 * بارکد اعتبار خرید بعدی (اگر صادر شده باشد) با همان روش رسید فروش چاپ می‌شود:
 * تصویرش در `printService.printExchange` با `barcodePng` ساخته و در
 * `storeCreditBarcodeDataUrl` پاس داده می‌شود — دقیقاً مثل `withBarcode`.
 * ===========================================================================
 */
export interface ExchangeReceiptData {
  /** شماره فیش «سند تعویض» (فاکتور جدیدِ اقلام جایگزین) */
  exchangeReceiptNo: number | null
  /** شماره فیش فاکتور اصلی مشتری */
  sourceReceiptNo: number
  dateJalali: string
  time: string
  shopName?: string
  customerName?: string
  cashierName?: string
  shiftName?: string | null
  /** کد فاکتورِ خودِ سند تعویض (برای برگشت خوردنِ همین سند) */
  exchangeReturnCode?: string | null
  returnedItems: ReceiptItem[]
  returnTotal: number
  replacementItems: ReceiptItem[]
  exchangeTotal: number
  /** مثبت = مشتری پرداخت کرد · منفی = ما بدهکار شدیم */
  diff: number
  settlementLabel: string
  /** مابه‌التفاوتی که نقد/کارت دریافت شد */
  cashReceived: number
  storeCreditCode?: string | null
  storeCreditAmount?: number
  storeCreditStatusLabel?: string | null
  storeCreditExpiresJalali?: string | null
  storeCreditBarcodeDataUrl?: string | null
  note?: string
  footer?: string
}

export function exchangeReceiptHtml(d: ExchangeReceiptData, template?: Partial<ReceiptTemplate>): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  /** نشست ۲۲۲ · فاز ۱ — سند تعویض با همان کاغذ/فونت فاکتور چاپ می‌شود (بخش ۸.۱). */
  const spec = receiptPageSpec(t, 'RETAIL')

  const head: string[] = []
  if (t.showDateTime)
    head.push(`<div class="row"><span>${faDigits(d.time)}</span><span>${faDigits(d.dateJalali)}</span></div>`)
  head.push(`<h1>${escapeHtml(d.shopName ?? t.shopName)}</h1>`)
  head.push('<div class="c big">سند تعویض کالا</div>')

  const idParts: string[] = []
  if (d.exchangeReceiptNo != null)
    idParts.push(`<span>${escapeHtml(t.receiptNoLabel)} ${faDigits(d.exchangeReceiptNo)}</span>`)
  idParts.push(`<span>فاکتور اصلی: ${faDigits(d.sourceReceiptNo)}</span>`)
  head.push(`<div class="row">${idParts.join('')}</div>`)

  if (t.showCustomer)
    head.push(
      `<div class="row"><span>${escapeHtml(t.customerLabel)}</span><span>${escapeHtml(
        d.customerName ?? 'مشتری عمومی'
      )}</span></div>`
    )
  if (t.showCashier && d.cashierName)
    head.push(
      `<div class="row"><span>فروشنده: ${escapeHtml(d.cashierName)}</span><span>${escapeHtml(
        d.shiftName ?? ''
      )}</span></div>`
    )

  /** یک جدول ساده‌ی «نام / تعداد / قیمت / جمع» (همان ستون‌های رسید فروش). */
  const itemsTable = (title: string, items: ReceiptItem[], sumLabel: string, sum: number) => {
    /** عرض ستون‌ها مثل جدول رسید فروش (بخش ۸.۱): تعداد ۱۴٪ و ستون‌های مبلغ ۲۲٪ */
    const th =
      '<tr><th>نام</th><th class="c" style="width:14%">تعداد</th>' +
      (t.showUnitPrice ? '<th class="c" style="width:22%">قیمت</th>' : '') +
      '<th class="l" style="width:22%">جمع</th></tr>'
    const rows = items
      .map(
        (i) =>
          `<tr><td class="nm">${escapeHtml(i.name)}</td><td class="c">${faDigits(i.qty)}</td>` +
          (t.showUnitPrice ? `<td class="c">${money(i.unitPrice)}</td>` : '') +
          `<td class="l">${money(i.lineTotal)}</td></tr>`
      )
      .join('')
    const empty = `<tr><td colspan="${t.showUnitPrice ? 4 : 3}" class="c">—</td></tr>`
    return (
      `<div class="sec">${escapeHtml(title)}</div>` +
      `<table><thead>${th}</thead><tbody>${rows || empty}</tbody></table>` +
      `<div class="row"><span>${escapeHtml(sumLabel)}</span><span>${money(sum)}</span></div>`
    )
  }

  const sums: string[] = []
  const sumRow = (label: string, value: number, bold = false) =>
    `<div class="row${bold ? ' big' : ''}"><span>${escapeHtml(label)}</span><span>${money(value)}</span></div>`

  sums.push(sumRow('مابه‌التفاوت', Math.abs(d.diff), true))
  sums.push(
    `<div class="row"><span>نحوه‌ی تسویه</span><span>${escapeHtml(
      d.diff > 0 ? 'دریافت از مشتری' : d.diff < 0 ? 'صدور بارکد اعتبار' : 'مابه‌التفاوت صفر'
    )}</span></div>`
  )
  if (d.cashReceived > 0) sums.push(sumRow('دریافت نقد/کارت', d.cashReceived))
  sums.push(`<div class="c kbd">${escapeHtml(d.settlementLabel)}</div>`)

  const creditBlock =
    d.storeCreditCode && (d.storeCreditAmount ?? 0) > 0
      ? `<div class="line"></div>
         <div class="c sec">بارکد اعتبار خرید بعدی</div>
         <div class="c code"><b>${escapeHtml(d.storeCreditCode)}</b></div>
         ${
           d.storeCreditBarcodeDataUrl
             ? `<div class="c"><img class="bc" src="${d.storeCreditBarcodeDataUrl}" alt="${escapeHtml(
                 d.storeCreditCode
               )}" /></div>`
             : ''
         }
         <div class="row"><span>مبلغ اعتبار</span><span>${money(d.storeCreditAmount ?? 0)}</span></div>
         ${
           d.storeCreditExpiresJalali
             ? `<div class="c kbd">اعتبار تا ${faDigits(d.storeCreditExpiresJalali)}</div>`
             : ''
         }
         ${d.storeCreditStatusLabel ? `<div class="c kbd">${escapeHtml(d.storeCreditStatusLabel)}</div>` : ''}
         <div class="c kbd">این بارکد یک‌بارمصرف است؛ در خرید بعدی آن را به فروشنده نشان دهید.</div>`
      : ''

  const codeBlock =
    t.showReturnCode && d.exchangeReturnCode
      ? `<div class="c code">${escapeHtml(t.returnCodeLabel)}: <b>${escapeHtml(d.exchangeReturnCode)}</b></div>`
      : ''

  const footers: string[] = []
  if (d.note) footers.push(`<div class="c kbd">${escapeHtml(d.note)}</div>`)
  for (const line of [t.footerLine1, t.footerLine2, t.footerLine3]) {
    if (line && line.trim()) footers.push(`<div class="msg">${escapeHtml(line)}</div>`)
  }
  if (d.footer) footers.push(`<div class="msg">${escapeHtml(d.footer)}</div>`)
  if (t.showPhone && t.phone) footers.push(`<div class="c">تلفن ${faDigits(t.phone)}</div>`)
  if (t.showWebsite && t.website) footers.push(`<div class="c">${escapeHtml(t.website)}</div>`)

  const style = `<style>
    .row { display:flex; justify-content:space-between; gap:4px; margin:1px 0; }
    .row.big { font-weight:700; font-size:1.15em; margin-top:3px; }
    .c.big { font-weight:700; font-size:1.1em; }
    .sec { font-weight:700; margin:4px 0 2px; }
    .msg { border:1px solid #000; text-align:center; padding:2px; margin:3px 0; }
    .code { margin:2px 0; letter-spacing:1px; }
    .bc { max-width:${mm(Math.max(30, spec.contentWidthMm - 14))}mm; height:12mm; }
    .kbd { font-size:max(6pt, 0.75em); }
    table th { border-bottom:1px solid #000; }
    table td { border-bottom:1px dotted #999; }
  </style>`

  return base(
    style +
      head.join('') +
      '<div class="line"></div>' +
      itemsTable('کالای برگشتی', d.returnedItems, 'جمع کالای برگشتی', d.returnTotal) +
      '<div class="line"></div>' +
      itemsTable('کالای جایگزین', d.replacementItems, 'جمع کالای جایگزین', d.exchangeTotal) +
      '<div class="line"></div>' +
      sums.join('') +
      codeBlock +
      creditBlock +
      '<div class="line"></div>' +
      footers.join(''),
    spec
  )
}


/**
 * ===========================================================================
 * جلسه ۱۴ · بند ۱۳ — رسید چاپیِ «برگشت از فروش».
 *
 * تا امروز `print:exchange` بود ولی `print:return` نبود: برگشت ساده هیچ سند
 * چاپی مستقلی نداشت، پس مشتری هیچ مدرکی از بازپرداختش نمی‌گرفت و فروشگاه هم
 * هیچ برگه‌ی قابل‌تطبیقی با کشوی صندوق نداشت.
 *
 * هم‌خانواده‌ی `receiptHtml` / `exchangeReceiptHtml` است و از همان
 * `DEFAULT_RECEIPT_TEMPLATE` تبعیت می‌کند (کاغذ، فونت، نام فروشگاه، تلفن/سایت،
 * پیام‌های پایانی)، پس هیچ تنظیم جدیدی لازم نیست.
 *
 * ⚠️ «روش بازپرداخت» عمداً **برجسته** چاپ می‌شود، نه در پانویس: این تنها خطی
 * است که می‌گوید پول از کشو بیرون رفت یا فقط طلب مشتری کم شد.
 * ===========================================================================
 */
export interface ReturnReceiptData {
  /** شماره‌ی سند برگشت */
  returnId: number
  /** شماره فیش فاکتور اصلی */
  sourceReceiptNo: number
  dateJalali: string
  time: string
  shopName?: string
  customerName?: string
  cashierName?: string
  shiftName?: string | null
  items: ReceiptItem[]
  total: number
  /** CASH | CARD | STORE_CREDIT | NONE · null = داده‌ی قدیمی */
  refundMethod: string | null
  refundMethodLabel: string
  refundAmount: number
  refundReference?: string | null
  /** سندی که باطل شده فقط برای سابقه چاپ می‌شود و باید روی برگه واضح باشد. */
  voidedAt?: string | Date | null
  voidReason?: string | null
  /** کالا به انبار برگشت یا فقط سند مالی ثبت شد؟ */
  restocked: boolean
  restockedQty: number
  hasRemovedItems?: boolean
  /**
   * نشست ۳۱۶ · خواسته‌ی مالک — رسید برگشت «سند حسابداری شیفت» است و نباید
   * *اصلاً* بارکد/کد اعتبار داخلش باشد. پس دیگر فیلدهای code/barcode نیست؛
   * فقط فهرست مبلغیِ اعتبارهای صادرشده از این برگشت می‌آید تا بگوید «چقدر به‌صورت
   * اعتبار مانده». سند اعتبارِ خودمشتری (با کد/بارکد) از کانال خودش چاپ می‌شود.
   */
  storeCredits?: { label: string; amount: number; expiresJalali?: string | null; status?: string | null }[]
  note?: string
  footer?: string
}

export function returnReceiptHtml(d: ReturnReceiptData, template?: Partial<ReceiptTemplate>): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  /** نشست ۲۲۲ · فاز ۱ — رسید برگشت با همان کاغذ/فونت فاکتور چاپ می‌شود (بخش ۸.۱). */
  const spec = receiptPageSpec(t, 'RETAIL')

  const head: string[] = []
  if (t.showDateTime)
    head.push(`<div class="row"><span>${faDigits(d.time)}</span><span>${faDigits(d.dateJalali)}</span></div>`)
  head.push(`<h1>${escapeHtml(d.shopName ?? t.shopName)}</h1>`)
  head.push('<div class="c big">رسید برگشت از فروش</div>')
  if (d.voidedAt)
    head.push(`<div class="msg"><b>باطل</b>${d.voidReason ? ` · دلیل: ${escapeHtml(d.voidReason)}` : ''}</div>`)
  head.push(
    `<div class="row"><span>سند برگشت: ${faDigits(d.returnId)}</span>` +
      `<span>فاکتور اصلی: ${faDigits(d.sourceReceiptNo)}</span></div>`
  )
  if (t.showCustomer)
    head.push(
      `<div class="row"><span>${escapeHtml(t.customerLabel)}</span><span>${escapeHtml(
        d.customerName ?? 'مشتری عمومی'
      )}</span></div>`
    )
  if (t.showCashier && d.cashierName)
    head.push(
      `<div class="row"><span>ثبت‌کننده: ${escapeHtml(d.cashierName)}</span><span>${escapeHtml(
        d.shiftName ?? ''
      )}</span></div>`
    )

  /** عرض ستون‌ها مثل جدول رسید فروش (بخش ۸.۱): تعداد ۱۴٪ و ستون‌های مبلغ ۲۲٪ */
  const th =
    '<tr><th>نام</th><th class="c" style="width:14%">تعداد</th>' +
    (t.showUnitPrice ? '<th class="c" style="width:22%">قیمت</th>' : '') +
    '<th class="l" style="width:22%">جمع</th></tr>'
  const itemRows = d.items
    .map(
      (i) =>
        `<tr><td class="nm">${escapeHtml(i.name)}</td><td class="c">${faDigits(i.qty)}</td>` +
        (t.showUnitPrice ? `<td class="c">${money(i.unitPrice)}</td>` : '') +
        `<td class="l">${money(i.lineTotal)}</td></tr>`
    )
    .join('')
  const emptyRow = `<tr><td colspan="${t.showUnitPrice ? 4 : 3}" class="c">—</td></tr>`
  const itemsTable =
    '<div class="sec">کالای برگشتی</div>' +
    `<table><thead>${th}</thead><tbody>${itemRows || emptyRow}</tbody></table>`

  const sums: string[] = []
  sums.push(
    `<table><thead><tr><th>ارزش کالای برگشتی</th><th>نحوه‌ی تسویه</th><th>پول واقعاً خارج‌شده از کشو</th></tr></thead>` +
      `<tbody><tr><td>${money(d.total)}</td><td>${escapeHtml(d.refundMethodLabel)}</td><td>${money(
        d.refundMethod === 'CASH' ? d.refundAmount : 0
      )}</td></tr></tbody></table>`
  )
  sums.push(`<div class="row big"><span>جمع کالای برگشتی</span><span>${money(d.total)}</span></div>`)
  if (d.refundAmount > 0)
    sums.push(`<div class="row"><span>مبلغ بازپرداخت‌شده</span><span>${money(d.refundAmount)}</span></div>`)
  if (d.refundMethod === 'NONE')
    sums.push('<div class="c kbd">هیچ پولی پرداخت نشد؛ فقط بدهی مشتری کم شد.</div>')
  if (!d.refundMethod)
    sums.push('<div class="c kbd">این سند قدیمی است و روش بازپرداختش ثبت نشده بود (فرض‌شده از داده‌ی قدیمی).</div>')
  if (d.refundReference)
    sums.push(`<div class="row"><span>شماره پیگیری</span><span>${escapeHtml(d.refundReference)}</span></div>`)

  // وضعیت موجودی: «سند مالی» و «برگشت کالا به انبار» دو چیز متفاوت‌اند
  sums.push(
    `<div class="row"><span>وضعیت موجودی</span><span>${
      d.restocked ? `به انبار برگشت (${faDigits(d.restockedQty)} عدد)` : 'فقط سند مالی؛ انبار تغییر نکرد'
    }</span></div>`
  )
  if (d.hasRemovedItems)
    sums.push('<div class="c kbd">بعضی اقلام این برگشت، کالای حذف‌شده از انبار بودند.</div>')

  /**
   * نشست ۳۱۶ — جای بلوک کد/بارکد اعتبار: فقط سطرهای مبلغیِ اعتبار + تذکر
   * «کد/بارکد روی این رسید چاپ نمی‌شود» (سند اعتبار جداگانه صادر و چاپ می‌گردد).
   * وضعیت باطل‌شده هم دیده می‌شود تا سند باطل پولِ زنده به نظر نرسد.
   */
  const creditList = (d.storeCredits ?? []).filter((c) => (c.amount ?? 0) > 0)
  const creditBlock =
    creditList.length > 0
      ? '<div class="line"></div>' +
        '<div class="c sec">اعتبارهای صادرشده از این برگشت (بدون کد/بارکد)</div>' +
        creditList
          .map(
            (c) =>
              `<div class="row"><span>${escapeHtml(c.label)}` +
              (c.status === 'CANCELED' ? ' (باطل‌شده)' : '') +
              `</span><span>${money(c.amount)}</span></div>` +
              (c.expiresJalali ? `<div class="c kbd">اعتبار تا ${faDigits(c.expiresJalali)}</div>` : '')
          )
          .join('') +
        '<div class="c kbd">کد/بارکد اعتبار روی این رسید چاپ نمی‌شود؛ سند اعتبار جداگانه صادر و چاپ می‌گردد.</div>'
      : ''

  const footers: string[] = []
  if (d.note) footers.push(`<div class="c kbd">${escapeHtml(d.note)}</div>`)
  for (const line of [t.footerLine1, t.footerLine2, t.footerLine3]) {
    if (line && line.trim()) footers.push(`<div class="msg">${escapeHtml(line)}</div>`)
  }
  if (d.footer) footers.push(`<div class="msg">${escapeHtml(d.footer)}</div>`)
  if (t.showPhone && t.phone) footers.push(`<div class="c">تلفن ${faDigits(t.phone)}</div>`)
  if (t.showWebsite && t.website) footers.push(`<div class="c">${escapeHtml(t.website)}</div>`)

  const style = `<style>
    .row { display:flex; justify-content:space-between; gap:4px; margin:1px 0; }
    .row.big { font-weight:700; font-size:1.15em; margin-top:3px; }
    .c.big { font-weight:700; font-size:1.1em; }
    .sec { font-weight:700; margin:4px 0 2px; }
    .msg { border:1px solid #000; text-align:center; padding:2px; margin:3px 0; }
    .code { margin:2px 0; letter-spacing:1px; }
    .bc { max-width:${mm(Math.max(30, spec.contentWidthMm - 14))}mm; height:12mm; }
    .kbd { font-size:max(6pt, 0.75em); }
    table th { border-bottom:1px solid #000; }
    table td { border-bottom:1px dotted #999; }
  </style>`

  return base(
    style +
      head.join('') +
      '<div class="line"></div>' +
      itemsTable +
      '<div class="line"></div>' +
      sums.join('') +
      creditBlock +
      '<div class="line"></div>' +
      footers.join(''),
    spec
  )
}

/** فیش مدرک وصول نسیه — همان عرض حرارتی رسید فروش؛ مقصد پول روی فیش مشتری نیست. */
export function debtPaymentReceiptHtml(d: DebtPaymentReceiptData, template?: Partial<ReceiptTemplate>): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  /** نشست ۲۲۲ · فاز ۱ — فیش بدهی هم با همان کاغذ/فونت فاکتور چاپ می‌شود. */
  const spec = receiptPageSpec(t, 'RETAIL')
  const rows: string[] = []
  rows.push(`<h1>${escapeHtml(d.shopName || t.shopName)}</h1>`)
  rows.push('<div class="c big">فیش پرداخت نسیه</div>')
  if (d.reprint) rows.push('<div class="msg">چاپ مجدد</div>')
  if (d.laterChange === 'VOIDED')
    rows.push('<div class="msg">این پرداخت بعداً باطل شده؛ اعداد مربوط به لحظه‌ی ثبت است</div>')
  else if (d.laterChange === 'EDITED')
    rows.push('<div class="msg">این پرداخت بعداً ویرایش شده؛ اعداد مربوط به لحظه‌ی ثبت است</div>')
  rows.push(
    `<div class="row"><span>فاکتور ${faDigits(d.receiptNo)}</span><span>پرداختی ${faDigits(d.seq)}</span></div>`
  )
  if (t.showDateTime)
    rows.push(`<div class="row"><span>${faDigits(d.time)}</span><span>${faDigits(d.dateJalali)}</span></div>`)
  const name = String(d.customerName ?? '').trim()
  if (name) rows.push(`<div class="row"><span>مشتری</span><span>${escapeHtml(name)}</span></div>`)
  rows.push(`<div class="row big"><span>مبلغ این پرداخت</span><span>${money(d.amount)}</span></div>`)
  rows.push(`<div class="row"><span>روش پرداخت</span><span>${escapeHtml(d.methodLabel)}</span></div>`)
  if (d.kind === 'CHEQUE') {
    if (d.chequeNo) rows.push(`<div class="row"><span>شماره چک</span><span>${faDigits(d.chequeNo)}</span></div>`)
    if (d.bankName) rows.push(`<div class="row"><span>بانک</span><span>${escapeHtml(d.bankName)}</span></div>`)
    if (d.dueDateJalali)
      rows.push(`<div class="row"><span>سررسید</span><span>${faDigits(d.dueDateJalali)}</span></div>`)
    rows.push('<div class="msg">چک دریافت شد (در جریان)؛ تا پاس شدن از باقی‌مانده کم نمی‌شود</div>')
  } else if (d.settled) {
    rows.push('<div class="msg"><b>تسویه شد</b></div>')
  } else {
    rows.push(`<div class="row big"><span>باقی‌مانده</span><span>${money(d.remainingAfter)}</span></div>`)
  }
  if (d.remainingSource === 'LIVE_AT_PRINT') {
    rows.push(`<div class="c kbd">باقی‌مانده در تاریخ چاپ ${faDigits(jalaliToday())}</div>`)
  }
  const footers: string[] = []
  if (t.footerLine1) footers.push(`<div class="c kbd">${escapeHtml(t.footerLine1)}</div>`)
  if (t.footerLine2) footers.push(`<div class="c kbd">${escapeHtml(t.footerLine2)}</div>`)
  const style = `<style>
    .row { display:flex; justify-content:space-between; gap:4px; margin:1px 0; }
    .row.big { font-weight:700; font-size:1.15em; margin-top:3px; }
    .c.big { font-weight:700; font-size:1.1em; }
    .msg { border:1px solid #000; text-align:center; padding:2px; margin:3px 0; }
    .kbd { font-size:max(6pt, 0.75em); }
  </style>`
  return base(style + rows.join('') + footers.join(''), spec)
}

/**
 * ===========================================================================
 * جلسه ۲۱ · §۱۳ — «سند اعتبار خرید» (چاپ / PDF / چاپ مجدد).
 *
 * سه تصمیم عمدی:
 *   ۱) **هویت چاپ از همان `ReceiptTemplate`** می‌آید (نام فروشگاه، لوگو، پاورقی،
 *      نمایش تاریخ). سیستم تنظیمات چاپ دومی ساخته نشد (§۱۳).
 *   ۲) **اندازه‌ی کاغذ از تنظیمات اعتبار** (`creditPaperSize`) — A4/A5/A6/۸۰mm/
 *      ۵۸mm/سفارشی. رسید حرارتی ارتفاع آزاد دارد، پس `@page` فقط عرض می‌گیرد.
 *   ۳) **مبلغ هرگز داخل بارکد نیست** (§۷): بارکد فقط *کد* را حمل می‌کند و مبلغ
 *      واقعی همیشه از دیتابیس خوانده می‌شود. پس یک بارکد جعلی هیچ پولی نمی‌سازد.
 * ===========================================================================
 */
export interface CreditDocData {
  code: string
  amount: number
  usedAmount: number
  remaining: number
  sourceLabel: string
  statusLabel: string
  issuedJalali: string
  issuedTime: string
  expiresJalali: string | null
  usesLabel: string
  maxUses: number
  usedCount: number
  restrictLabel: string | null
  minPurchase: number
  maxPerTransaction: number
  holderName: string | null
  holderCompany: string | null
  holderPhone: string | null
  holderAgent: string | null
  holderAddress: string | null
  holderNationalId: string | null
  barcodeDataUrl: string | null
  shopName?: string
  rulesText: string
  showRules: boolean
  showHolder: boolean
  showRemaining: boolean
  /** نسخه‌ی دوم به بعد ⇒ برچسب «نسخه‌ی مجدد» (§۱۳) */
  reprint: boolean
  /** نشست ۱۷۳ · S173-D5 — اعتبار باطل‌شده ⇒ نوار صریح «باطل شده — غیرقابل استفاده» بالای برگه */
  voided?: boolean
  /** نشست ۳۱۷ — چاپ آزمایشی/پیش‌نمایش ⇒ نوار «نمونه» تا با سند واقعی اشتباه نشود */
  sample?: boolean
  printCount: number
  linkedReceiptNo?: number | null
  /**
   * نشست ۳۱۶ · خواسته‌ی مالک — این برگه «تنها مدرک مشتری برای خرید بعدی» است؛
   * پس داستانِ کاملِ صدورش را خودش می‌گوید: بابت برگشتِ کدام فاکتور، کدام
   * اقلام برگشتند، چقدر نقد/کارت تسویه شد و این اعتبار دقیقاً از کجا آمد؛ یا
   * برای تعویض: مبلغ کالای برگشتی/جایگزین و مابه‌التفاوت و نحوه‌ی تسویه‌اش.
   * سطرها از main آماده می‌آیند (متن فارسیِ آماده با ارقام فارسی).
   */
  issueLines?: string[]
  note?: string | null
  footer?: string | null
}

/**
 * نشست ۳۱۷ · طرح کلاد (برنده) — دو شاخه:
 *   ۱) layout ندارد/تاریخی است ⇒ رشته‌ی تاریخی **بایت‌به‌بایت** (صفر رگرسیون
 *      برای همه‌ی فروشگاه‌های بدون تغییر تنظیمات — golden در سوت s317).
 *   ۲) layout غیرتاریخی ⇒ همان کلاس‌ها ولی از layout حساب می‌شود؛ padding
 *      جایگزین حاشیه‌ی تاریخی است (نه علاوه‌ بر آن) و `box-sizing: border-box`
 *      جلوی بیرون‌زدگی box-content تاریخی از عرض کاغذ را می‌گیرد.
 */
export const creditCss = (widthMm: number, heightMm: number | null, layout?: CreditPrintLayout): string => {
  /** نشست ۳۱۷ — layout غیرتاریخی ⇒ CSS حساب‌شده؛ تاریخی/غایب ⇒ لیتوال تاریخی. */
  if (layout && !layout.isLegacy) return creditCssFromLayout(widthMm, heightMm, layout)
  return `
  @page { size: ${heightMm ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`}; margin: 0; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; width:${widthMm}mm; margin:0; padding:5mm 4mm; font-size:11px; }
  .doc { border:1px solid #111; border-radius:3mm; padding:3mm; page-break-inside:avoid; }
  .doc + .doc { margin-top:4mm; }
  h1 { font-size:14px; text-align:center; margin:0 0 1mm }
  .kind { text-align:center; font-size:12px; font-weight:700; margin-bottom:2mm }
  .row { display:flex; justify-content:space-between; gap:3mm; margin:0.6mm 0 }
  .amount { text-align:center; font-size:17px; font-weight:800; margin:2mm 0 1mm }
  .code { text-align:center; font-size:15px; font-weight:800; letter-spacing:1.5px; direction:ltr }
  .bc { text-align:center; margin:1.5mm 0 }
  .bc img { max-width:100%; }
  .rules { font-size:9px; border-top:1px dashed #666; margin-top:2mm; padding-top:1.5mm; line-height:1.5 }
  .reprint { text-align:center; font-size:10px; font-weight:800; border:1px dashed #111; padding:0.8mm; margin-bottom:1.5mm }
  .logo { text-align:center; margin:0 0 1mm }
  .logo img { max-width:100%; object-fit:contain }
  .muted { color:#444 }
`
}

/**
 * نشست ۳۱۷ — شاخه‌ی تازه: همان کلاس‌ها، ولی مقادیر از layout می‌آیند. padding
 * جایگزین حاشیه‌ی تاریخی است (نه علاوه بر آن) و `box-sizing: border-box` جلوی
 * بیرون‌زدگی content-box تاریخی از عرض کاغذ را می‌گیرد.
 */
function creditCssFromLayout(widthMm: number, heightMm: number | null, l: CreditPrintLayout): string {
  return `
  @page { size: ${heightMm ? `${widthMm}mm ${heightMm}mm` : `${widthMm}mm auto`}; margin: 0; }
  body { font-family: Vazirmatn, Tahoma, sans-serif; width:${widthMm}mm; margin:0; padding:${l.marginYMm}mm ${l.marginXMm}mm; font-size:${l.fontPx}px; box-sizing:border-box; }
  .doc { border:1px solid #111; border-radius:3mm; padding:3mm; page-break-inside:avoid; }
  .doc + .doc { margin-top:4mm; }
  h1 { font-size:${l.px.h1}px; text-align:center; margin:0 0 1mm }
  .kind { text-align:center; font-size:${l.px.kind}px; font-weight:700; margin-bottom:2mm }
  .row { display:flex; justify-content:space-between; gap:3mm; margin:0.6mm 0 }
  .amount { text-align:center; font-size:${l.px.amount}px; font-weight:800; margin:2mm 0 1mm }
  .code { text-align:center; font-size:${l.px.code}px; font-weight:800; letter-spacing:${l.letterSpacingPx}px; direction:ltr }
  .bc { text-align:center; margin:1.5mm 0 }
  .bc img { max-width:100%; }
  .rules { font-size:${l.px.rules}px; border-top:1px dashed #666; margin-top:2mm; padding-top:1.5mm; line-height:1.5 }
  .reprint { text-align:center; font-size:${l.px.reprint}px; font-weight:800; border:1px dashed #111; padding:0.8mm; margin-bottom:1.5mm }
  .logo { text-align:center; margin:0 0 1mm }
  .logo img { max-width:100%; object-fit:contain }
  .muted { color:#444 }
`
}

/** بدنه‌ی یک سند اعتبار (بدون <html>) — تا چاپ گروهی بتواند N تا را کنار هم بچیند. */
function creditDocBody(d: CreditDocData, t: ReceiptTemplate): string {
  const parts: string[] = []
  /**
   * نشست ۱۷۳ · S173-D5 (مشاهده‌ی ۱۰۶/۱۰۷) — چاپ دسته‌ای اعتبار باطل‌شده‌ی دسته را هم چاپ می‌کند
   * (سابقه‌ی چاپ عمداً حذف نمی‌شود)، ولی برگه‌ی باطل نباید شبیه سند معتبر باشد: مبلغ درشت و
   * بارکد بدون نشان صریح ابزار فریب مشتری است. بازخرید در main همچنان رد می‌شود.
   */
  if (d.voided)
    parts.push('<div class="reprint">باطل شده — غیرقابل استفاده · این برگه هیچ ارزش خریدی ندارد</div>')
  /** نشست ۳۱۷ — نوار «نمونه» (مثل نوار باطل؛ عمداً بالای همه‌ی محتوا) */
  if (d.sample) parts.push('<div class="reprint">نمونه — این برگه هیچ ارزش خریدی ندارد</div>')
  if (d.reprint)
    parts.push(`<div class="reprint">نسخه‌ی مجدد (چاپ ${faDigits(d.printCount)})</div>`)
  /**
   * بند ۷ (جلسه ۳۱) — §۱۳: لوگوی سند، *بالای* نام فروشگاه.
   *
   * تصمیمش (خاموش/روشن، منبع تصویر، ارتفاع مجاز) در `creditDocLogo`
   * (`@shared/creditUi` بخش ۱۰) است، نه اینجا: یک dataURL ناقص روی کاغذ آیکن
   * شکسته می‌دهد و ارتفاع بی‌حد، سند را بی‌ریخت می‌کند. `logoDataUrl` قالب رسید
   * خودش از لوگوی لیبل ارث برده است (`SettingsService.receiptTemplate()`).
   */
  const logo = creditDocLogo(t)
  if (logo.show)
    parts.push(`<div class="logo"><img src="${logo.src}" style="height:${logo.heightMm}mm" alt=""></div>`)
  parts.push(`<h1>${escapeHtml(d.shopName ?? t.shopName)}</h1>`)
  parts.push(`<div class="kind">سند اعتبار خرید · ${escapeHtml(d.sourceLabel)}</div>`)
  parts.push(`<div class="amount">${money(d.amount)} ریال</div>`)
  parts.push(`<div class="code">${escapeHtml(d.code)}</div>`)
  if (d.barcodeDataUrl) parts.push(`<div class="bc"><img src="${d.barcodeDataUrl}" alt="${escapeHtml(d.code)}"></div>`)

  const rows: string[] = []
  const row = (k: string, v: string): string => `<div class="row"><span class="muted">${escapeHtml(k)}</span><span>${v}</span></div>`
  rows.push(row('تاریخ صدور', `${faDigits(d.issuedJalali)} ${faDigits(d.issuedTime)}`))
  rows.push(row('تاریخ انقضا', d.expiresJalali ? faDigits(d.expiresJalali) : 'بدون انقضا'))
  rows.push(row('وضعیت', escapeHtml(d.statusLabel)))
  rows.push(row('دفعات مجاز', `${escapeHtml(d.usesLabel)} · استفاده‌شده ${faDigits(d.usedCount)}`))
  if (d.showRemaining) rows.push(row('باقی‌مانده', `${money(d.remaining)} ریال`))
  if (d.restrictLabel) rows.push(row('محدودیت استفاده', escapeHtml(d.restrictLabel)))
  if (d.minPurchase > 0) rows.push(row('حداقل مبلغ خرید', `${money(d.minPurchase)} ریال`))
  if (d.maxPerTransaction > 0) rows.push(row('سقف هر تراکنش', `${money(d.maxPerTransaction)} ریال`))
  if (d.linkedReceiptNo != null) rows.push(row('فاکتور مرجع', faDigits(d.linkedReceiptNo)))
  if (d.showHolder) {
    if (d.holderName) rows.push(row('دارنده', escapeHtml(d.holderName)))
    if (d.holderCompany) rows.push(row('شرکت/سازمان', escapeHtml(d.holderCompany)))
    if (d.holderAgent) rows.push(row('نماینده', escapeHtml(d.holderAgent)))
    if (d.holderPhone) rows.push(row('تماس', faDigits(d.holderPhone)))
    if (d.holderNationalId) rows.push(row('شناسه ملی', faDigits(d.holderNationalId)))
    if (d.holderAddress) rows.push(row('آدرس', escapeHtml(d.holderAddress)))
  }
  if (d.note) rows.push(row('توضیح', escapeHtml(d.note)))
  parts.push(rows.join(''))

  /** نشست ۳۱۶ — جعبه‌ی «جزئیات صدور»؛ تنها مدرک مشتری است، پس کامل می‌گوید چرا پیدا شده. */
  if (d.issueLines && d.issueLines.length)
    parts.push(
      `<div class="rules"><b>جزئیات صدور:</b><br>${d.issueLines.map((l) => escapeHtml(l)).join('<br>')}</div>`
    )

  if (d.showRules && d.rulesText) parts.push(`<div class="rules">${escapeHtml(d.rulesText)}</div>`)

  /**
   * نشست ۶۲ · بند ۴-۳۲ — «اعتبار خرید هرگز نقدشدنی نیست؛ روی رسید و گزارش
   * عبارت "غیرقابل نقد شدن" درج شود». تا امروز فقط اگر توضیح سند آن را داشت
   * (اعتبار اضافه‌دریافت) چاپ می‌شد؛ حالا روی *هر* سند اعتبار، مستقل از
   * تنظیم «نمایش قوانین»، چون یک قاعده‌ی ضدسرقت است نه یک متن سلیقه‌ای.
   */
  parts.push('<div class="rules c"><b>غیرقابل نقد شدن</b> · فقط برای خرید کالا</div>')

  /**
   * پاورقی و راه‌های تماس از همان `ReceiptTemplate` می‌آیند (§۱۳: سیستم تنظیمات
   * چاپ جدا ساخته نشد). لوگو هم از جلسه ۳۱ همان‌جاست (`showLogo`/`logoHeightMm`/
   * `logoDataUrl`) و بالای نام فروشگاه رندر می‌شود؛ پیش‌فرضش خاموش است، پس رسید
   * فعلی فروشگاه مو‌به‌مو مثل قبل چاپ می‌شود.
   */
  const contact: string[] = []
  if (t.showPhone && t.phone) contact.push(faDigits(t.phone))
  if (t.showWebsite && t.website) contact.push(escapeHtml(t.website))
  if (contact.length) parts.push(`<div class="rules c">${contact.join(' · ')}</div>`)
  const footer = d.footer ?? [t.footerLine1, t.footerLine2, t.footerLine3].filter((x) => !!x).join(' · ')
  if (footer) parts.push(`<div class="rules c">${escapeHtml(footer)}</div>`)
  return `<div class="doc">${parts.join('')}</div>`
}

/** یک سند اعتبار، آماده‌ی چاپ یا PDF. */
export function creditDocHtml(
  d: CreditDocData,
  template?: Partial<ReceiptTemplate>,
  /** نشست ۳۱۷ — layout اختیاری: غایب/تاریخی ⇒ خروجی بایت‌به‌بایت قدیمی */
  paper: { widthMm: number; heightMm: number | null; layout?: CreditPrintLayout } = { widthMm: 105, heightMm: 148 }
): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>${creditCss(paper.widthMm, paper.heightMm, paper.layout)}</style></head>
<body>${creditDocBody(d, t)}</body></html>`
}

/**
 * چاپ دسته‌ای (§۵): **یک** سند چندصفحه‌ای برای هزاران اعتبار، نه هزاران Job جدا.
 *
 * `perPage` تعیین می‌کند در هر صفحه چند سند بنشیند (A4 جا برای چندتا دارد، رسید
 * حرارتی فقط یکی). بین صفحه‌ها `page-break-after` می‌خورد و هیچ سندی از وسط
 * دو نیم نمی‌شود (`page-break-inside: avoid`).
 */
export function creditBatchHtml(
  docs: CreditDocData[],
  template?: Partial<ReceiptTemplate>,
  paper: { widthMm: number; heightMm: number | null; layout?: CreditPrintLayout } = { widthMm: 210, heightMm: 297 },
  perPage = 4
): string {
  const t: ReceiptTemplate = { ...DEFAULT_RECEIPT_TEMPLATE, ...(template ?? {}) }
  const per = Math.max(1, Math.round(perPage) || 1)
  const pages: string[] = []
  for (let i = 0; i < docs.length; i += per) {
    const slice = docs.slice(i, i + per)
    const last = i + per >= docs.length
    pages.push(
      `<section style="${last ? '' : 'page-break-after:always;'}">${slice.map((d) => creditDocBody(d, t)).join('')}</section>`
    )
  }
  const empty = '<div class="doc"><div class="kind">هیچ اعتباری برای چاپ در این دسته نبود.</div></div>'
  return `<!doctype html>
<html dir="rtl" lang="fa"><head><meta charset="utf-8"><style>${creditCss(paper.widthMm, paper.heightMm, paper.layout)}</style></head>
<body>${pages.join('') || empty}</body></html>`
}
