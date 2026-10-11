import { prisma } from '../db/client'
import { barcodePng } from './BarcodeService'
import { PANEL_KEYS } from '@shared/panels'
import { settingsService } from './SettingsService'
import { salesService } from './SalesService'
import { printHtml, listPrinters, pdfFromHtml, isPrintOutcomeUnknown } from '../print/printer'
/**
 * نشست ۲۲۲ · فاز ۱ طرح چاپ — اندازه‌ی کاغذ فاکتور از همین توابع خالص می‌آید تا
 * `pageSize` میکرونی و تبدیل‌های واحد یک‌جا باشد (بخش ۵.۵ و ۸.۱ طرح).
 */
import { receiptPageSpec, type ReceiptProfile } from '@shared/printSpec'
// نشست ۲۲۲ · فاز ۳ — resolver مشترک چاپگر (نام فقط در main اعتبارسنجی می‌شود)
import { resolvePrintTargetName } from '../print/target'
// نشست ۳۱۷ — مشخصات چاپ اعتبار (کاغذ + layout) از یک نقطه‌ی واحد (گارد ایستا در سوت s317)
import { creditRenderSpec, creditPerPageWith } from '../print/creditSpec'
// نشست ۲۲۲ · فاز ۵ — انتخاب موتور چاپ (Chromium یا خام/RAW) در یک نقطه
import { printMaybeRaw } from '../print/raw/route'
import {
  receiptHtml,
  labelHtml,
  exchangeReceiptHtml,
  returnReceiptHtml,
  debtPaymentReceiptHtml,
  creditDocHtml,
  creditBatchHtml,
  type CreditDocData,
  type ExchangeReceiptData,
  type ReturnReceiptData,
  type ReceiptData
} from '../print/templates'
import { readCreditSettings, storeCreditService } from './StoreCreditService'
/**
 * نشست ۳۱۶ · خواسته‌ی مالک — «مبدأ کسر» (جلسه ۵۳) از رسید مشتری حذف شد؛ پس
 * `summaryOf` این‌جا دیگر صدا زده نمی‌شود. داده‌ی مبدأ فقط برای فهرست/گزارش
 * داخلی باقی است (StockAllocationService همچنان جریان فروش را تغذیه می‌کند).
 */
import {
  CREDIT_MARK_PRINTED_NONE,
  CREDIT_SCOPE_LABELS,
  CreditRestrictScope,
  CreditSource,
  CreditStatus,
  creditCopyPlan,
  creditPdfAuditOnly,
  creditPdfMarkPlan,
  creditPdfRenderPlan,
  creditPdfSaveOutcome,
  creditPrintBatchResult,
  creditShouldMarkPrinted,
  isCreditReprint,
  normalizeRestrictScope
} from '@shared/credit'
import {
  applyCreditPrintCap,
  CREDIT_PRINT_MAX_DOCS,
  cleanCreditIds,
  creditPrintPlan
} from '@shared/creditPrint'
import { audit } from './AuditService'
/** کار الف — برچسب «به حساب مدیر» روی ردیف پرداختی رسید */
import { PaymentDestination, normalizePaymentDestination } from '@shared/enums'
import { app, dialog, shell } from 'electron'
import { join } from 'node:path'
import { BusinessError } from '../errors'
/** نشست ۱۲۹ · خوشه J — ذخیره‌ی «همه یا هیچ» و والد زنده‌ی دیالوگ، مشترک با خروجی اکسل */
import { dialogParentWindow, writeFileAtomic } from './ExportService'
import {
  AuditAction,
  ChequeStatus,
  EXCHANGE_SETTLEMENT_LABELS,
  ORDER_TYPE_LABELS,
  PaymentEntryKind,
  refundMethodLabel
} from '@shared/enums'
import { toJalaliDate, toClock, jalaliToday, faDigits, money } from '@shared/jalali'
import { resolveLabelBrand, type LabelTemplate, type ReceiptTemplate } from '@shared/receipt'
import { toNumberRial } from '@shared/money'
import { remainingOf, debtAdjustmentsOf } from '@shared/settlement'
import { saleLineTitle } from '@shared/saleItemSnapshot'
import { invoiceRemaining } from './invoiceDebt'
import {
  debtReceiptSettled,
  readPaymentAddSnapshot,
  type DebtPaymentReceiptData
} from '@shared/debtReceipt'

/** چاپ رسید هم باید روی فاکتورهای پرقلم از سقف پارامتر SQLite عبور نکند. */
const PRINT_VARIANT_IN_CHUNK = 500

async function loadPrintVariantsByIds(ids: readonly number[]) {
  const unique = [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
  const rows: any[] = []
  for (let i = 0; i < unique.length; i += PRINT_VARIANT_IN_CHUNK) {
    rows.push(
      ...(await prisma.productVariant.findMany({
        where: { id: { in: unique.slice(i, i + PRINT_VARIANT_IN_CHUNK) } },
        select: { id: true, size: true, color: true, product: { select: { name: true } } }
      }))
    )
  }
  return rows
}

/**
 * نشست ۳۱۶ · خواسته‌ی مالک — سطرهای «جزئیات صدور» سند اعتبار (تنها مدرک مشتری
 * برای خرید بعدی): داستان کاملِ اینکه این اعتبار از کجا آمده — برگشتِ کدام
 * فاکتور چه اقلامی، چقدر نقد/کارت تسویه شد، یا در تعویض مبلغ کالای برگشتی/
 * جایگزین و مابه‌التفاوت و تسویه‌اش. هر خطایی فقط ثبت می‌شود و چاپ سند هرگز
 * به‌خاطر جزئیات متوقف نمی‌ماند (سیاست همان «چاپ هرگز قربانی داده‌ی فرعی نمی‌شود»).
 */
async function creditIssueLinesForDoc(c: any): Promise<string[]> {
  const lines: string[] = []
  const joinNames = (names: string[]): string =>
    names.slice(0, 6).join('، ') + (names.length > 6 ? ` و ${faDigits(names.length - 6)} قلم دیگر` : '')
  const namesOfItems = async (items: { variantId: number; qty: number; variantName?: string | null; name?: string | null }[]) => {
    const variants = await loadPrintVariantsByIds(items.map((i) => i.variantId))
    const vmap = new Map(variants.map((v) => [v.id, v]))
    return items.map((i) => `${saleLineTitle(i as any, vmap.get(i.variantId))} ×${faDigits(i.qty)}`)
  }
  try {
    const returnId = Number(c.returnId ?? 0)
    if (returnId > 0) {
      const ret = await prisma.saleReturn.findUnique({
        where: { id: returnId },
        include: { items: true, invoice: { select: { receiptNo: true } } }
      })
      if (!ret) return lines
      const isExchange = ret.kind === 'EXCHANGE'
      const receiptNo = ret.invoice?.receiptNo ?? 0
      const itemNames = await namesOfItems(ret.items)
      if (!isExchange) {
        lines.push(`بابت برگشت از فروش فاکتور ${faDigits(receiptNo)} (سند برگشت ${faDigits(ret.id)})`)
        if (itemNames.length) lines.push(`اقلام برگشتی: ${joinNames(itemNames)}`)
        lines.push(`مبلغ کل برگشت: ${money(toNumberRial(ret.total))} ریال`)
        const refunded = toNumberRial(ret.refundAmount)
        if (refunded > 0 && ret.refundMethod !== 'STORE_CREDIT')
          lines.push(`تسویه در همان لحظه: ${money(refunded)} ریال (${refundMethodLabel(ret.refundMethod)})`)
        lines.push(
          c.source === CreditSource.OVERPAY
            ? `باقیمانده‌ی ${money(c.amount)} ریال به‌صورت اعتبار خرید (همین سند) صادر شد`
            : `مبلغ ${money(c.amount)} ریال به‌صورت اعتبار خرید (همین سند) صادر شد`
        )
      } else {
        lines.push(`بابت تعویض کالای فاکتور ${faDigits(receiptNo)} (سند تعویض ${faDigits(ret.id)})`)
        if (itemNames.length) lines.push(`اقلام برگشتی: ${joinNames(itemNames)}`)
        lines.push(`مبلغ کالاهای برگشتی: ${money(toNumberRial(ret.total))} ریال`)
        if (ret.exchangeReceiptNo) lines.push(`فاکتور کالای جایگزین: ${faDigits(ret.exchangeReceiptNo)}`)
        if (ret.exchangeInvoiceId) {
          const exInv = await prisma.saleInvoice.findUnique({
            where: { id: ret.exchangeInvoiceId },
            include: { items: true }
          })
          if (exInv?.items?.length) {
            const replacementNames = await namesOfItems(exInv.items)
            lines.push(`کالای جایگزین: ${joinNames(replacementNames)}`)
          }
        }
        lines.push(`مبلغ کالای جایگزین: ${money(toNumberRial(ret.exchangeTotal))} ریال`)
        const diff = toNumberRial(ret.exchangeDiff)
        if (diff !== 0 || ret.exchangeSettlement)
          lines.push(
            `مابه‌التفاوت: ${money(Math.abs(diff))} ریال — ${EXCHANGE_SETTLEMENT_LABELS[String(ret.exchangeSettlement)] ?? 'تسویه شد'}`
          )
        lines.push(`مبلغ ${money(c.amount)} ریال به‌صورت اعتبار خرید (همین سند) صادر شد`)
      }
    } else if (c.source === CreditSource.OVERPAY && c.sourceReceiptNo) {
      lines.push(`بابت باقیمانده‌ی پرداخت بیش از مبلغ فاکتور ${faDigits(c.sourceReceiptNo)} (اضافه‌دریافت)`)
    } else if (c.source === CreditSource.EXCHANGE && c.exchangeReceiptNo) {
      lines.push(`بابت مابه‌التفاوت تعویض · فاکتور تعویض ${faDigits(c.exchangeReceiptNo)}`)
    }
  } catch (e) {
    console.error('[print] credit issue lines failed', e)
  }
  return lines
}

/**
 * ===========================================================================
 * چاپ رسید فروش.
 *
 * چرا داده‌ی رسید در main ساخته می‌شود و نه در renderer؟ چون آن‌وقت رسید چاپی
 * دقیقاً همان چیزی است که در دیتابیس ثبت شده (شماره فیش، کد فاکتور، مبالغ،
 * روش پرداخت) — نه یک کپی از state صفحه که ممکن است با فاکتور ثبت‌شده تفاوت
 * داشته باشد. renderer فقط شناسه‌ی فاکتور را می‌فرستد.
 * ===========================================================================
 */
/**
 * نشست ۲۲۲ · فاز ۳ (بخش ۶.۲ طرح) — resolve نام چاپگرِ یک کار چاپ رسید/سند.
 *
 * قواعد: نام درخواستی renderer (اگر آمده) ⇒ باید در فهرست زنده باشد؛ وگرنه نام
 * ذخیره‌شده‌ی همان پروفایل (عمده: `wholesalePrinterName` وقتی `wholesaleSeparate`
 * روشن است)؛ نام خالی ⇒ چاپگر پیش‌فرض ویندوز. **هیچ fallback خودکاری نیست** و
 * خروجی همیشه نام صریح است.
 */
async function receiptTargetDevice(input: {
  requestedDeviceName?: unknown
  tpl: ReceiptTemplate
  profile: ReceiptProfile
}): Promise<string> {
  const wholesale = input.profile === 'WHOLESALE' && input.tpl.wholesaleSeparate === true
  const { deviceName } = await resolvePrintTargetName({
    requestedDeviceName: input.requestedDeviceName,
    savedName: wholesale ? input.tpl.wholesalePrinterName : input.tpl.printerName
  })
  return deviceName
}

function printMarkWarning(scope: string): string {
  return `چاپ انجام شد، اما ثبت شمارنده/سابقه‌ی چاپ ${scope} کامل نشد؛ برای بررسی Audit Log و جلوگیری از نسخه‌ی تکراری با مدیر هماهنگ کنید.`
}

function logCreditMarkFailure(scope: string, err: unknown): void {
  console.error(`[print-credit] ${scope} markPrinted failed`, err)
}

export const printService = {
  /** داده‌ی رسید یک فاکتور ثبت‌شده، مستقیم از دیتابیس. */
  async receiptDataFor(invoiceId: number): Promise<ReceiptData> {
    const inv = await prisma.saleInvoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        customer: true,
        user: true,
        shift: true,
        payments: { where: { voidedAt: null }, include: { method: true } },
        returns: { where: { voidedAt: null }, select: { kind: true, total: true, refundMethod: true, refundAmount: true } }
      }
    })
    if (!inv) throw new BusinessError('این فاکتور پیدا نشد؛ ممکن است حذف شده باشد.')

    // واریانت‌ها جدا خوانده می‌شوند تا کالای حذف‌شده مانع چاپ رسید نشود.
    const variantIds = [...new Set(inv.items.map((i) => i.variantId))]
    const variants = await loadPrintVariantsByIds(variantIds)
    const vmap = new Map(variants.map((v) => [v.id, v]))
    const sale = await settingsService.saleDefaults()

    /**
     * نشست ۳۱۶ · خواسته‌ی مالک — «مشتری لازم نیست مبدأ کسر انبار و منفی شدن
     * موجودی را روی فاکتور ببیند.» خواندنِ `summaryOf` (جلسه ۵۳) همین‌جا حذف
     * شد؛ قالب هم دیگر بلوک مبدأ را رندر نمی‌کند. ستون فهرست/گزارش داخلی با
     * همان سرویس تغذیه می‌شود و دست‌نخورده است.
     */

    const issuedAt = inv.issuedAt instanceof Date ? inv.issuedAt : new Date(inv.issuedAt)
    return {
      receiptNo: inv.receiptNo,
      date: issuedAt,
      dateJalali: inv.issuedAtJalali || toJalaliDate(issuedAt),
      time: toClock(issuedAt),
      orderTypeLabel: ORDER_TYPE_LABELS[inv.orderType] ?? inv.orderType,
      tableNo: inv.tableNo,
      customerName: inv.customer?.name ?? 'مشتری عمومی',
      customerCode: inv.customer?.code ?? null,
      cashierName: inv.user?.displayName ?? sale.cashierName,
      shiftName: inv.shift?.name ?? null,
      items: inv.items.map((it) => {
        const v = vmap.get(it.variantId)
        return {
          // فیش همیشه snapshot روز فروش است؛ تیک reportLiveName فقط گزارش را عوض می‌کند
          name: saleLineTitle(it, v),
          qty: it.qty,
          // نشست ۱۸۱: ستون‌های مالی BigInt شده‌اند؛ قالب چاپ (`ReceiptItem`) با
          // `number` کار می‌کند، پس تبدیل صریح در همین مرز.
          unitPrice: toNumberRial(it.unitPrice),
          lineTotal: toNumberRial(it.lineTotal)
        }
      }),
      goodsTotal: toNumberRial(inv.goodsTotal),
      serviceCharge: toNumberRial(inv.serviceCharge),
      discountTotal: toNumberRial(inv.discountTotal),
      taxTotal: toNumberRial(inv.taxTotal),
      deliveryFee: toNumberRial(inv.deliveryFee),
      grandTotal: toNumberRial(inv.grandTotal),
      paidTotal: toNumberRial(inv.paidTotal),
      remaining: remainingOf({
        grandTotal: toNumberRial(inv.grandTotal),
        received: toNumberRial(inv.paidTotal),
        ...debtAdjustmentsOf(inv.returns ?? [])
      }).remaining,
      /**
       * ---- کار الف: پرداختیِ «به حساب مدیر» روی رسید مشخص می‌شود ----
       * فقط یک برچسب متنی است و هیچ عددی را عوض نمی‌کند (جمع رسید همان جمع
       * قبلی است). دلیلش این است که مشتری و فروشنده هر دو روی همان کاغذ ببینند
       * این مبلغ به کشوی فروشگاه نیامده — وگرنه هنگام بستن صندوق دنبال پولی
       * می‌گردند که هرگز آن‌جا نبوده. `CARD`/`CASH` و داده‌ی قدیمیِ بی‌مقصد
       * مو‌به‌مو مثل قبل چاپ می‌شوند (هیچ حدسی زده نمی‌شود).
       */
      payments: inv.payments.filter((p) => p.voidedAt == null).map((p) => ({
        label:
          (p.method?.label ?? 'پرداخت') +
          (normalizePaymentDestination(p.destination) === PaymentDestination.MANAGER ? ' — به حساب مدیر' : ''),
        amount: toNumberRial(p.amount)
      })),
      returnCode: inv.returnCode,
      returnCodeExpiresJalali: inv.returnCodeExpiresAt ? toJalaliDate(inv.returnCodeExpiresAt) : null
    }
  },

  /** بارکد کد فاکتور را (اگر تنظیمات می‌خواهد) به داده‌ی رسید اضافه می‌کند. */
  async withBarcode(data: ReceiptData, tpl: ReceiptTemplate): Promise<ReceiptData> {
    if (!tpl.showReturnDeadline || !tpl.showReturnBarcode || !tpl.showReturnCode || !data.returnCode) return data
    try {
      const dataUrl = await barcodePng(data.returnCode, { scale: 2, height: 10 })
      return { ...data, returnBarcodeDataUrl: dataUrl }
    } catch (e) {
      // نبودن بارکد نباید جلوی چاپ رسید را بگیرد
      console.error('[print] barcode failed', e)
      return data
    }
  },

  /**
   * HTML رسید یک فاکتور ثبت‌شده (برای چاپ یا پیش‌نمایش).
   *
   * `paidTotal` اختیاری است و فقط روی *همین برگه‌ی چاپی* اثر می‌گذارد: اگر
   * مشتری فاکتور عمده را جزئی پرداخت کرده باشد، مبلغ پرداختی و مانده‌حساب با
   * همان عدد چاپ می‌شود، بدون این‌که سند ثبت‌شده در دیتابیس عوض شود.
   */
  async invoiceHtml(
    invoiceId: number,
    override?: Partial<ReceiptTemplate>,
    paidTotal?: number | null,
    /**
     * نشست ۲۲۲ · فاز ۱ — پروفایل چاپ. غایب ⇒ `RETAIL` (سازگار با همه‌ی
     * فراخوانی‌های قبلی). عمده فقط وقتی کاغذ جدا می‌گیرد که مدیر
     * `wholesaleSeparate` را روشن کرده باشد.
     */
    profile: ReceiptProfile = 'RETAIL'
  ): Promise<string> {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(override ?? {}) }
    let data = await this.receiptDataFor(invoiceId)
    if (paidTotal != null && Number.isFinite(Number(paidTotal)))
      data = { ...data, paidTotal: Math.max(0, Math.round(Number(paidTotal))) }
    data = await this.withBarcode(data, tpl)
    return receiptHtml(data, tpl, profile)
  },

  /** چاپ رسید یک فاکتور ثبت‌شده. تعداد نسخه از تنظیمات می‌آید. */
  async printInvoice(input: {
    invoiceId: number
    copies?: number
    silent?: boolean
    deviceName?: string
    /** مبلغ پرداختی مشتری برای چاپ (مانده‌حساب از همین حساب می‌شود) */
    paidTotal?: number | null
    /**
     * نشست ۲۲۲ · فاز ۱ — پروفایل چاپ (بخش ۶.۳ طرح): صفحه‌ی فروش عمده
     * (`SalesInvoice.tsx`) `WHOLESALE` می‌فرستد و بقیه غایب ⇒ `RETAIL`؛ پس هیچ
     * فراخوانی قدیمی عوض نمی‌شود.
     */
    profile?: 'RETAIL' | 'WHOLESALE'
  }) {
    const profile: ReceiptProfile = input.profile === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL'
    const tpl = await settingsService.receiptTemplate()
    const html = await this.invoiceHtml(input.invoiceId, undefined, input.paidTotal ?? null, profile)
    /**
     * نشست ۲۲۲ · فاز ۱ — اندازه‌ی کاغذ به چاپگر اعلام می‌شود (بخش ۸.۱ طرح):
     * عرض فیزیکی + ارتفاع ثابت یا اندازه‌گیری‌شده. برای هر نسخه دوباره فرستاده
     * می‌شود تا حلقه‌ی فعلی `copies` (هر نسخه یک Job جدا) دست‌نخورده بماند.
     */
    const spec = receiptPageSpec(tpl, profile)
    const pageSize = { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm }
    /** فاز ۳ — نام چاپگر از resolver (بدون fallback)؛ صفحه‌ی عمده نام خودش را دارد. */
    const deviceName = await receiptTargetDevice({ requestedDeviceName: input.deviceName, tpl, profile })
    const copies = Math.min(Math.max(Math.round(input.copies ?? tpl.copies ?? 1), 1), 5)
    const singleDialogJob = input.silent === false && tpl.printMethod !== 'RAW' && copies > 1
    const jobs = singleDialogJob ? 1 : copies
    for (let i = 0; i < jobs; i++) {
      await printMaybeRaw({
        method: tpl.printMethod,
        html,
        deviceName,
        silent: input.silent ?? true,
        copies: singleDialogJob ? copies : 1,
        pageSize,
        rawDpi: tpl.rawDpi,
        rawInvert: tpl.rawInvert,
        cutMode: tpl.cutMode
      })
    }
    return { copies }
  },

  /**
   * =========================================================================
   * «سند تعویض کالا» (بخش ۶) — داده‌ی چاپ، مستقیم از دیتابیس.
   *
   * همه‌ی اعداد از `salesService.exchangeGet` می‌آیند (همان سرویسی که تب
   * «تعویض کالا»ی گزارشات می‌خواند)، پس برگه‌ی چاپی و گزارش هیچ‌وقت دو عدد
   * متفاوت نشان نمی‌دهند. بارکد اعتبار — اگر صادر شده باشد — با همان
   * `barcodePng` رسید فروش ساخته می‌شود.
   * =========================================================================
   */
  async exchangeDataFor(returnId: number, tpl: ReceiptTemplate): Promise<ExchangeReceiptData> {
    const row = await salesService.exchangeGet({ id: returnId })
    const sale = await settingsService.saleDefaults()

    // گزارش ExchangeReportRow عمداً کد ندارد؛ چاپ از رکورد اصلی در main می‌خواند.
    const credit = await prisma.storeCredit.findFirst({ where: { returnId }, orderBy: { id: 'desc' } })

    let storeCreditBarcodeDataUrl: string | null = null
    if (credit?.code && tpl.showReturnBarcode) {
      try {
        storeCreditBarcodeDataUrl = await barcodePng(credit.code, { scale: 2, height: 10 })
      } catch (e) {
        // نبودن تصویر بارکد نباید جلوی چاپ سند را بگیرد (کد به‌صورت متن چاپ است)
        console.error('[print] store credit barcode failed', e)
      }
    }

    const exchangeInvoice = row.exchangeInvoiceId
      ? await prisma.saleInvoice.findUnique({
          where: { id: row.exchangeInvoiceId },
          select: { returnCode: true }
        })
      : null

    return {
      exchangeReceiptNo: row.exchangeReceiptNo ?? null,
      sourceReceiptNo: row.receiptNo,
      dateJalali: row.dateJalali,
      time: row.time,
      shopName: tpl.shopName,
      customerName: row.customerName,
      cashierName: row.userName || sale.cashierName,
      shiftName: row.shiftName,
      exchangeReturnCode: exchangeInvoice?.returnCode ?? null,
      returnedItems: row.returnedItems.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal
      })),
      returnTotal: row.returnTotal,
      replacementItems: row.replacementItems.map((i) => ({
        name: i.name,
        qty: i.qty,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal
      })),
      exchangeTotal: row.exchangeTotal,
      diff: row.diff,
      settlementLabel: row.settlementLabel,
      cashReceived: row.cashReceived,
      storeCreditCode: credit?.code ?? null,
      storeCreditAmount: row.storeCreditAmount,
      storeCreditStatusLabel: row.storeCreditStatusLabel,
      storeCreditExpiresJalali: credit?.expiresAtJalali ?? null,
      storeCreditBarcodeDataUrl,
      note: row.note
    }
  },

  /** HTML سند تعویض (برای چاپ یا پیش‌نمایش). */
  async exchangeHtml(returnId: number, override?: Partial<ReceiptTemplate>): Promise<string> {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(override ?? {}) }
    const data = await this.exchangeDataFor(returnId, tpl)
    return exchangeReceiptHtml(data, tpl)
  },

  /**
   * چاپ «سند تعویض کالا» (کانال print:exchange).
   * `returnId` = شناسه‌ی همان سند برگشت/تعویض (همان چیزی که UI برگشت از فروش و
   * تب «تعویض کالا»ی گزارشات در دست دارند). `id` هم به‌عنوان نام جایگزین
   * پذیرفته می‌شود تا صدا زدنش از هر دو پنل ساده باشد.
   */
  async printExchange(input: {
    returnId?: number
    id?: number
    copies?: number
    silent?: boolean
    deviceName?: string
  }) {
    const returnId = Number(input?.returnId ?? input?.id ?? 0)
    if (!returnId) throw new BusinessError('سند تعویضی برای چاپ مشخص نشده است.')
    const tpl = await settingsService.receiptTemplate()
    const html = await this.exchangeHtml(returnId)
    /** نشست ۲۲۲ · فاز ۱ — همان اندازه‌ی کاغذ فاکتور (سند تعویض هم رسید حرارتی است). */
    const spec = receiptPageSpec(tpl, 'RETAIL')
    /** فاز ۳ — نام چاپگر از resolver (بدون fallback خودکار). */
    const deviceName = await receiptTargetDevice({ requestedDeviceName: input.deviceName, tpl, profile: 'RETAIL' })
    const copies = Math.min(Math.max(Math.round(input.copies ?? tpl.copies ?? 1), 1), 5)
    const singleDialogJob = input.silent === false && tpl.printMethod !== 'RAW' && copies > 1
    const jobs = singleDialogJob ? 1 : copies
    for (let i = 0; i < jobs; i++) {
      await printMaybeRaw({
        method: tpl.printMethod,
        html,
        deviceName,
        silent: input.silent ?? true,
        copies: singleDialogJob ? copies : 1,
        pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm },
        rawDpi: tpl.rawDpi,
        rawInvert: tpl.rawInvert,
        cutMode: tpl.cutMode
      })
    }
    return { copies, returnId }
  },

  /**
   * =========================================================================
   * جلسه ۱۴ · بند ۱۳ — داده‌ی رسید «برگشت از فروش»، مستقیم از دیتابیس.
   *
   * مثل بقیه‌ی رسیدها در main ساخته می‌شود، نه در renderer: رسید چاپی باید
   * دقیقاً همان چیزی باشد که ثبت شده — به‌خصوص «روش بازپرداخت»، که تنها مدرکِ
   * خروج وجه از کشو است و نباید از state صفحه بیاید.
   * =========================================================================
   */
  async returnDataFor(returnId: number, tpl: ReceiptTemplate): Promise<ReturnReceiptData> {
    const ret = await prisma.saleReturn.findUnique({
      where: { id: returnId },
      include: {
        items: true,
        invoice: {
          select: {
            receiptNo: true,
            deductInventory: true,
            customer: { select: { name: true } },
            user: { select: { displayName: true } },
            shift: { select: { name: true } }
          }
        }
      }
    })
    if (!ret) throw new BusinessError('این سند برگشت پیدا نشد (شاید حذف شده است).')
    const sale = await settingsService.saleDefaults()

    const variantIds = [...new Set(ret.items.map((i) => i.variantId))]
    const variants = await loadPrintVariantsByIds(variantIds)
    const vmap = new Map(variants.map((v) => [v.id, v]))

    /**
     * نشست ۳۱۶ · خواسته‌ی مالک — «رسید برگشت سند حسابداری شیفت است و نباید
     * *اصلاً* بارکد/کد اعتبار داخلش باشد.»
     *
     * پس دیگر بارکد ساخته نمی‌شود و کد اعتبار هم در payload نمی‌رود؛ فقط
     * فهرستِ «مبلغ + نوع + تاریخ اعتبارِ» اعتبارهایِ لینک‌شده به این برگشت
     * (هم اعتبار تسویه‌ی روش بازپرداختِ STORE_CREDIT — `ret.storeCreditId` —
     * و هم اعتبار باقیمانده‌ی اضافه‌دریافت — `returnId` که نشست ۳۱۶ هنگام
     * صدور سوار شد) برای سطرهای مبلغیِ رسید ساخته می‌شود. سند اعتبارِ خودمشتری
     * (با کد/بارکد) از کانال خودش جدا چاپ می‌شود.
     *
     * اسناد قدیمی‌تر که returnId ندارند کمترین‌حالت را می‌بینند: اعتبارِ روش
     * بازپرداخت از `storeCreditId` — بدون کد.
     */
    const credits = await prisma.storeCredit.findMany({
      where: {
        OR: [
          { returnId: ret.id },
          ...(ret.storeCreditId != null ? [{ id: ret.storeCreditId }] : [])
        ]
      },
      select: { id: true, amount: true, source: true, expiresAtJalali: true, status: true },
      orderBy: { id: 'asc' }
    })
    const storeCredits = credits.map((c) => ({
      label:
        c.source === CreditSource.OVERPAY
          ? 'اعتبار باقیمانده (اضافه‌دریافت)'
          : 'اعتبار تسویه‌ی برگشت',
      amount: toNumberRial(c.amount),
      expiresJalali: c.expiresAtJalali ?? null,
      status: c.status ?? null
    }))

    return {
      returnId: ret.id,
      sourceReceiptNo: ret.invoice?.receiptNo ?? 0,
      dateJalali: ret.returnedAtJalali || toJalaliDate(ret.returnedAt),
      time: ret.returnedAtTime || toClock(ret.returnedAt),
      shopName: tpl.shopName,
      customerName: ret.invoice?.customer?.name ?? 'مشتری عمومی',
      cashierName: ret.invoice?.user?.displayName || sale.cashierName,
      shiftName: ret.invoice?.shift?.name ?? null,
      items: ret.items.map((i) => {
        const v = vmap.get(i.variantId)
        return {
          name: saleLineTitle(i, v),
          qty: i.qty,
          unitPrice: toNumberRial(i.unitPrice),
          lineTotal: toNumberRial(i.lineTotal)
        }
      }),
      total: toNumberRial(ret.total),
      refundMethod: ret.refundMethod ?? null,
      refundMethodLabel: refundMethodLabel(ret.refundMethod),
      refundAmount: toNumberRial(ret.refundAmount),
      refundReference: ret.refundReference ?? null,
      voidedAt: ret.voidedAt ?? null,
      voidReason: ret.voidReason ?? null,
      restocked: ret.items.some((i) => i.restockedQty > 0),
      restockedQty: ret.items.reduce((s, i) => s + i.restockedQty, 0),
      hasRemovedItems: ret.hasRemovedItems,
      storeCredits,
      note: ret.note ?? undefined
    }
  },

  /** HTML رسید برگشت (برای چاپ یا پیش‌نمایش). */
  async returnHtml(returnId: number, override?: Partial<ReceiptTemplate>): Promise<string> {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(override ?? {}) }
    return returnReceiptHtml(await this.returnDataFor(returnId, tpl), tpl)
  },

  /** چاپ رسید «برگشت از فروش» (کانال print:return). */
  async printReturn(input: { returnId?: number; id?: number; copies?: number; silent?: boolean; deviceName?: string }) {
    const returnId = Number(input?.returnId ?? input?.id ?? 0)
    if (!returnId) throw new BusinessError('سند برگشتی برای چاپ مشخص نشده است.')
    const tpl = await settingsService.receiptTemplate()
    const html = await this.returnHtml(returnId)
    /** نشست ۲۲۲ · فاز ۱ — همان اندازه‌ی کاغذ فاکتور (رسید برگشت هم رول حرارتی است). */
    const spec = receiptPageSpec(tpl, 'RETAIL')
    /** فاز ۳ — نام چاپگر از resolver (بدون fallback خودکار). */
    const deviceName = await receiptTargetDevice({ requestedDeviceName: input.deviceName, tpl, profile: 'RETAIL' })
    const copies = Math.min(Math.max(Math.round(input.copies ?? tpl.copies ?? 1), 1), 5)
    const singleDialogJob = input.silent === false && tpl.printMethod !== 'RAW' && copies > 1
    const jobs = singleDialogJob ? 1 : copies
    for (let i = 0; i < jobs; i++) {
      await printMaybeRaw({
        method: tpl.printMethod,
        html,
        deviceName,
        silent: input.silent ?? true,
        copies: singleDialogJob ? copies : 1,
        pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm },
        rawDpi: tpl.rawDpi,
        rawInvert: tpl.rawInvert,
        cutMode: tpl.cutMode
      })
    }
    return { copies, returnId }
  },

  /**
   * فیش وصول نسیه — فقط خواندنی. باقی‌مانده از snapshotِ Audit همان پرداخت
   * (SALE_PAYMENT_ADD.remaining). چاپ داخل ثبت پول نیست.
   */
  async debtPaymentDataFor(paymentId: number, tpl: ReceiptTemplate): Promise<DebtPaymentReceiptData> {
    const id = Number(paymentId)
    if (!Number.isSafeInteger(id) || id < 1) throw new BusinessError('پرداختی برای چاپ فیش مشخص نشده است.')
    const pay = await prisma.payment.findUnique({
      where: { id },
      include: {
        method: true,
        invoice: { select: { id: true, receiptNo: true, grandTotal: true, customer: { select: { name: true } } } }
      }
    })
    if (!pay?.invoice) throw new BusinessError('این پرداختی پیدا نشد؛ ممکن است حذف شده باشد.')
    const kind: 'CASH' | 'CHEQUE' = pay.kind === PaymentEntryKind.CHEQUE ? 'CHEQUE' : 'CASH'
    const addAudit = await prisma.auditLog.findFirst({
      where: { action: AuditAction.SALE_PAYMENT_ADD, entity: 'Payment', entityId: id },
      orderBy: { id: 'asc' },
      select: { after: true }
    })
    const snap = readPaymentAddSnapshot(addAudit?.after ?? null)
    let remainingAfter: number
    let remainingSource: DebtPaymentReceiptData['remainingSource']
    if (snap) {
      remainingAfter = snap.remaining
      remainingSource = 'SNAPSHOT'
    } else {
      const rows = await prisma.payment.findMany({
        where: { invoiceId: pay.invoice.id, voidedAt: null },
        select: { amount: true, kind: true, chequeStatus: true }
      })
      const received = rows.reduce((s, r) => {
        const cheque = (r.kind ?? PaymentEntryKind.CASH) === PaymentEntryKind.CHEQUE
        if (cheque && r.chequeStatus !== ChequeStatus.CLEARED) return s
        return s + toNumberRial(r.amount)
      }, 0)
      const live = await invoiceRemaining(prisma, pay.invoice.id, toNumberRial(pay.invoice.grandTotal), received)
      remainingAfter = live.remaining
      remainingSource = 'LIVE_AT_PRINT'
    }
    const laterUpdate = await prisma.auditLog.findFirst({
      where: { action: AuditAction.SALE_PAYMENT_UPDATE, entity: 'Payment', entityId: id },
      select: { id: true }
    })
    const customerName = String(pay.invoice.customer?.name ?? '').trim() || null
    const paidAt = pay.paidAt instanceof Date ? pay.paidAt : new Date(pay.paidAt)
    return {
      paymentId: pay.id,
      invoiceId: pay.invoice.id,
      receiptNo: pay.invoice.receiptNo,
      seq: pay.seq ?? snap?.seq ?? 0,
      shopName: tpl.shopName,
      customerName,
      dateJalali: pay.paidAtJalali || toJalaliDate(paidAt),
      time: pay.paidAtTime || toClock(paidAt),
      amount: snap?.amount ?? toNumberRial(pay.amount),
      methodLabel: pay.method?.label ?? (kind === 'CHEQUE' ? 'چک' : 'پرداخت'),
      kind,
      chequeNo: pay.chequeNo ?? null,
      bankName: pay.bankName ?? null,
      dueDateJalali: pay.dueDateJalali ?? null,
      remainingAfter,
      remainingSource,
      settled: debtReceiptSettled(kind, remainingAfter),
      laterChange: pay.voidedAt ? 'VOIDED' : laterUpdate ? 'EDITED' : null,
      reprint: false
    }
  },

  async debtPaymentHtml(paymentId: number, opts?: { reprint?: boolean }): Promise<string> {
    const tpl = await settingsService.receiptTemplate()
    const data = await this.debtPaymentDataFor(paymentId, tpl)
    return debtPaymentReceiptHtml({ ...data, reprint: opts?.reprint === true }, tpl)
  },

  async printDebtPayment(input: { paymentId?: number; reprint?: boolean; silent?: boolean; deviceName?: string }) {
    const paymentId = Number(input?.paymentId ?? 0)
    if (!paymentId) throw new BusinessError('پرداختی برای چاپ فیش مشخص نشده است.')
    const tpl = await settingsService.receiptTemplate()
    const html = await this.debtPaymentHtml(paymentId, { reprint: input?.reprint === true })
    /** نشست ۲۲۲ · فاز ۱ — فیش پرداخت نسیه هم روی همان کاغذ فاکتور. */
    const spec = receiptPageSpec(tpl, 'RETAIL')
    /** فاز ۳ — نام چاپگر از resolver (بدون fallback خودکار). */
    const deviceName = await receiptTargetDevice({ requestedDeviceName: input?.deviceName, tpl, profile: 'RETAIL' })
    await printMaybeRaw({
      method: tpl.printMethod,
      html,
      deviceName,
      silent: input.silent ?? true,
      pageSize: { widthMm: spec.widthMm, heightMm: spec.heightMm, heightSafetyMm: tpl.heightSafetyMm },
      rawDpi: tpl.rawDpi,
      rawInvert: tpl.rawInvert,
      cutMode: tpl.cutMode
    })
    return { paymentId }
  },

  /**
   * نمونه‌ی رسید برای پیش‌نمایش زنده‌ی پنل تنظیمات (بدون نیاز به فاکتور واقعی).
   * پروفایل `WHOLESALE` همان نمونه است به‌اضافه‌ی پرداخت جزئی، تا سطرهای «مبلغ
   * پرداختی» و «مانده حساب» فاکتور عمده هم دیده/چاپ شوند. غایب ⇒ همان نمونه‌ی قبلی.
   */
  sampleData(tpl: ReceiptTemplate, profile: ReceiptProfile = 'RETAIL'): ReceiptData {
    const base: ReceiptData = {
      receiptNo: 1024,
      dateJalali: jalaliToday(),
      time: toClock(new Date()),
      shopName: tpl.shopName,
      orderTypeLabel: 'داخلی',
      tableNo: '2',
      customerName: 'مشتری عمومی',
      customerCode: '10001',
      cashierName: 'مدیر',
      shiftName: 'شیفت اول',
      items: [
        { name: 'شلوار نیم بگ سایز ۳۶ - ذغالی', qty: 1, unitPrice: 9980000, lineTotal: 9980000 },
        { name: 'لینین تک جیب', qty: 2, unitPrice: 4500000, lineTotal: 9000000 }
      ],
      goodsTotal: 18980000,
      serviceCharge: 0,
      discountTotal: 0,
      taxTotal: 0,
      deliveryFee: 0,
      grandTotal: 18980000,
      payments: [{ label: 'کارتخوان سپه', amount: 18980000 }],
      returnCode: 'K7M4QP',
      returnCodeExpiresJalali: jalaliToday()
    }
    if (profile !== 'WHOLESALE') return base
    return {
      ...base,
      customerName: 'مشتری عمده‌ی نمونه',
      payments: [{ label: 'نقدی', amount: 10000000 }],
      paidTotal: 10000000
    }
  },

  /**
   * HTML پیش‌نمایش: اگر invoiceId داده شود رسید همان فاکتور، وگرنه یک نمونه.
   * قالب پاس‌داده‌شده (هنوز ذخیره‌نشده) هم پشتیبانی می‌شود تا کاربر تغییرات را
   * قبل از ذخیره ببیند.
   */
  async previewHtml(
    input: {
      template?: Partial<ReceiptTemplate>
      invoiceId?: number | null
      paidTotal?: number | null
      /** پروفایل نمونه (کارت «فاکتور عمده»)؛ غایب ⇒ `RETAIL` مثل قبل. */
      profile?: 'RETAIL' | 'WHOLESALE'
    } = {}
  ) {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(input.template ?? {}) }
    if (input.invoiceId) return this.invoiceHtml(input.invoiceId, input.template, input.paidTotal ?? null)
    const profile: ReceiptProfile = input.profile === 'WHOLESALE' ? 'WHOLESALE' : 'RETAIL'
    const data = await this.withBarcode(this.sampleData(tpl, profile), tpl)
    return receiptHtml(data, tpl, profile)
  },

  /**
   * -------------------------------------------------------------------------
   * تنظیمات *مؤثر* چاپ لیبل.
   *
   * تنها کاری که اضافه می‌کند این است: اگر «نام برند» لیبل خالی باشد، همان «نام
   * فروشگاه» قالب رسید جایش می‌نشیند — تا کاربر مجبور نباشد اسم فروشگاهش را دو
   * جا بنویسد. `override` برای همان یک چاپ است (مثلاً «بدون اسم») یا برای
   * پیش‌نمایش تنظیمات ذخیره‌نشده.
   * -------------------------------------------------------------------------
   */
  /**
   * =========================================================================
   * جلسه ۲۱ · §۱۳ — «سند اعتبار خرید»: چاپ، PDF، و چاپ گروهی.
   *
   * مثل بقیه‌ی رسیدها داده در main ساخته می‌شود، نه در renderer: مبلغ، باقی‌مانده
   * و دفعات مجاز باید همان چیزی باشند که در دیتابیس است — §۷ می‌گوید «مبلغ واقعی
   * همیشه از دیتابیس خوانده می‌شود»، پس ساختن این داده از state صفحه ممنوع است.
   * =========================================================================
   */
  async creditDocDataFor(id: number, tpl: ReceiptTemplate): Promise<CreditDocData> {
    const settings = await readCreditSettings()
    const detail = await storeCreditService.detail({ id })
    const c = detail.credit
    // DTO جزئیات عمداً credential ندارد؛ فقط ساخت سند در main رکورد اصلی را می‌خواند.
    const credit = await prisma.storeCredit.findUnique({ where: { id }, select: { code: true } })
    const code = credit?.code ?? ''
    const scope = normalizeRestrictScope(c.restrictScope)
    let barcodeDataUrl: string | null = null
    try {
      // §۷ — بارکد فقط *کد* را حمل می‌کند؛ هیچ مبلغی داخلش نیست، پس قابل جعل نیست.
      barcodeDataUrl = await barcodePng(code, {
        scale: 2,
        height: Math.round(settings.barcodeHeightMm),
        includetext: settings.barcodeIncludeText
      })
    } catch {
      barcodeDataUrl = null
    }
    return {
      code,
      amount: c.amount,
      usedAmount: c.usedAmount,
      remaining: c.remaining,
      sourceLabel: c.sourceLabel,
      statusLabel: c.statusLabel,
      issuedJalali: c.issuedAtJalali,
      issuedTime: c.issuedAtTime,
      expiresJalali: c.expiresAtJalali,
      usesLabel: c.usesLabel,
      maxUses: c.maxUses,
      usedCount: c.usedCount,
      restrictLabel:
        scope === CreditRestrictScope.ALL
          ? null
          : `${CREDIT_SCOPE_LABELS[scope] ?? scope}` +
            (scope === CreditRestrictScope.CATEGORY
              ? ` (${c.restrictCategoryIds.length} دسته)`
              : ` (${c.restrictVariantIds.length} کالا)`),
      minPurchase: c.minPurchase,
      maxPerTransaction: c.maxPerTransaction,
      holderName: c.customerName,
      holderCompany: c.holderCompany,
      holderPhone: c.holderPhone,
      holderAgent: c.holderAgent,
      holderAddress: c.holderAddress,
      holderNationalId: c.holderNationalId,
      barcodeDataUrl,
      shopName: tpl.shopName,
      rulesText: settings.rulesText,
      showRules: settings.showRules,
      showHolder: settings.showHolder,
      showRemaining: settings.showRemaining,
      // چاپ مجدد اعتبار جدید نمی‌سازد؛ فقط برچسب می‌خورد (§۱۳).
      // آستانه‌اش تصمیمِ مشترک بخش ۹.۲ است، نه یک مقایسه‌ی محلی.
      reprint: isCreditReprint(c.printCount),
      // نشست ۱۷۳ · S173-D5 — سند باطل‌شده روی کاغذ صریحاً «باطل شده — غیرقابل استفاده»
      voided: c.status === CreditStatus.CANCELED,
      printCount: c.printCount + 1,
      linkedReceiptNo: c.exchangeReceiptNo ?? c.sourceReceiptNo ?? null,
      // نشست ۳۱۶ — داستان کامل صدور، روی تنها مدرکی که مشتری نگه می‌دارد
      issueLines: await creditIssueLinesForDoc(c),
      note: c.note
    }
  },

  /** HTML یک سند اعتبار، با اندازه‌ی کاغذِ تنظیمات اعتبار (§۱۳). */
  async creditHtml(id: number, override?: Partial<ReceiptTemplate>): Promise<string> {
    const tpl = { ...(await settingsService.receiptTemplate()), ...(override ?? {}) }
    const settings = await readCreditSettings()
    const data = await this.creditDocDataFor(id, tpl)
    return creditDocHtml(data, tpl, creditRenderSpec(settings))
  },

  /**
   * چاپ سند اعتبار. `markPrinted` پیش‌فرض روشن است تا شمارنده‌ی چاپ و AuditLog
   * (§۱۰) بدانند این کاغذ چند بار بیرون آمده — همان چیزی که برچسب «نسخه‌ی مجدد»
   * رویش بنا شده است.
   */
  async printCredit(input: {
    id?: number
    copies?: number
    silent?: boolean
    deviceName?: string
    markPrinted?: boolean
    userId?: number | null
    /** نشست ۳۱۶ — چاپ دوباره: درخواستِ صریحِ renderer برای چاپِ غیرنخست است */
    reprint?: boolean
    /** نشست ۳۱۶ — رمز مدیر/رمز دوم/رمز سومِ ماژول اعتبار برای آزاد کردن چاپ دوباره */
    password?: string | null
  }) {
    const id = Math.round(Number(input?.id ?? 0))
    if (!id) throw new BusinessError('اعتباری برای چاپ مشخص نشده است.')
    /**
     * نشست ۳۱۶ · خواسته‌ی مالک — «چاپ دوباره‌ی کد اعتبار یعنی پول چاپ کردن:
     * باید زیر نظر مدیر باشد.» پس هر چاپی که renderer صریحاً «دوباره» اعلام
     * کند، قبل از هر رندر با strict تأیید می‌شود (رمز مدیر یا رمز دوم/سومِ
     * همین ماژول؛ حتی اگر قفلِ نمایشیِ ماژول خاموش باشد). چاپِ نخستِ لحظه‌ی
     * صدور — که مشتری همان‌جا برگه‌اش را می‌گیرد — مثل قبل بدون رمز است و
     * اگر چاپِ اول خراب شود، فروشنده بدون رمز چاپ دوباره ندارد: به مدیر خبر
     * می‌دهد تا خودش از «مدیریت اعتبار خرید» کد صادر/چاپ کند.
     */
    if (input?.reprint === true) {
      /**
       * import تنبل: AuthService را وارد گرافِ ایستای این ماژول نکنیم — وارد
       * شدنِ ایستا آن رفتارِ سوت‌های ممیزی چاپ (audit-s129، شمارش markPrinted)
       * را تغییر می‌داد. رفتارِ اجرایی یکسان است: هر چاپ «دوباره» همین‌جا قبل
       * از رندر سنجیده می‌شود.
       */
      const { assertPanelPasswordStrict } = await import('./AuthService')
      await assertPanelPasswordStrict(PANEL_KEYS.creditManagement, input?.password, 'چاپ دوباره‌ی سند اعتبار خرید')
    }
    const tpl = await settingsService.receiptTemplate()
    const settings = await readCreditSettings()
    const paper = creditRenderSpec(settings)
    const data = await this.creditDocDataFor(id, tpl)
    /**
     * بند ۷ (جلسه ۳۱) — §۱۳: هر کاغذ *دوباره* رندر می‌شود.
     *
     * باگ: قبلاً یک HTML ساخته و N بار به چاپگر داده می‌شد و `markPrinted` هم
     * یک بار صدا می‌خورد ⇒ چاپ سه‌نسخه‌ای سه کاغذِ «اصل» بیرون می‌داد و
     * `printCount` فقط یک واحد بالا می‌رفت. تصمیمِ «کاغذ چندم چه شماره و چه
     * برچسبی دارد» در `creditCopyPlan` (بخش ۹ `@shared/credit`) است و همان
     * منبع، سقف نسخه (۵) را هم اعمال می‌کند.
     *
     * `prev = data.printCount - 1` چون `creditDocDataFor` عمداً شماره‌ی
     * *همین چاپ* را می‌گذارد (`printCount + 1`)، پس یکی عقب‌تر شمارنده‌ی
     * ذخیره‌شده‌ی دیتابیس است.
     */
    const plan = creditCopyPlan(data.printCount - 1, input.copies)
    /**
     * چاپ اعتبار کاغذ A6/A5/A4 خودش را دارد و نباید به چاپگر حرارتی رسید گره
     * بخورد. نام صریح renderer همچنان اعتبارسنجی می‌شود؛ اگر نامی نیامده باشد
     * رفتار امن/قدیمی یعنی چاپگر پیش‌فرض ویندوز انتخاب می‌شود (بدون fallback به
     * چاپگر اول).
     */
    const { deviceName } = await resolvePrintTargetName({
      requestedDeviceName: input.deviceName,
      savedName: ''
    })
    const warnings: string[] = []
    let markFailed = false
    /**
     * نشست ۲۲۲ · فاز ۶ (بخش ۱۰) — هر کاغذ یک job جدا: ممیزی AUDIT-S129-01 قراردادِ
     * «crash روی نسخه‌ی ۱ از ۳ ⇒ فقط همان یک نسخه شمرده شد و بقیه چاپ نشدند» را با
     * job تک‌نسخه‌ای حذف قفل کرده بود؛ ادغامِ چند نسخه در یک job (نسخه‌ی میانیِ این
     * نشست) آن قرارداد را می‌شکست و سوت audit-s129 را قرمز می‌کرد. پس حلقه‌ی
     * per-copy برگشت؛ افزوده‌های نشست ۲۲۵ (تحملِ خطای markPrinted + warnings)
     * حفظ شده‌اند.
     */
    for (const copy of plan) {
      const html = creditDocHtml({ ...data, printCount: copy.printCount, reprint: copy.reprint }, tpl, paper)
      try {
        await printHtml(html, {
          silent: input.silent ?? false,
          deviceName
        })
      } catch (err) {
        /**
         * ممیزی AUDIT-S129-01 — نتیجه‌ی نامعلوم (پنجره بسته/crash یا مهلت) یعنی شاید کاغذ
         * بیرون آمده باشد. احتیاطاً شمرده می‌شود تا کاغذ بعدی «نسخه‌ی مجدد» بخورد، نه
         * «اصل» دوم؛ Audit صریحاً «نتیجه‌ی نامعلوم» را می‌گوید. لغو/رد قطعی شمرده نمی‌شود.
         *
         * نشست ۲۲۵ · M3 — اگر خودِ ثبت شمارنده خطا بدهد نباید خطای اصلیِ outcome
         * نامعلوم را بپوشاند؛ renderer باید همچنان `PRINT_OUTCOME_UNKNOWN` را ببیند.
         */
        if (isPrintOutcomeUnknown(err) && creditShouldMarkPrinted(input.markPrinted)) {
          try {
            await storeCreditService.markPrinted({ id, userId: input.userId ?? null, uncertain: true })
          } catch (markErr) {
            logCreditMarkFailure('single unknown', markErr)
          }
        }
        throw err
      }
      // بعدِ *هر* کاغذ، تا شمارنده و AuditLog تعداد واقعی کاغذها را بدانند.
      // «پیش‌فرض روشن» یک قاعده است (بخش ۹.۳ · §۲۴)، نه یک `!== false`ِ محلی.
      // نشست ۲۲۵ · M3 — خطای ثبت شمارنده، چاپِ انجام‌شده را throw نمی‌کند؛ warning می‌شود.
      if (creditShouldMarkPrinted(input.markPrinted)) {
        try {
          await storeCreditService.markPrinted({ id, userId: input.userId ?? null })
        } catch (markErr) {
          markFailed = true
          logCreditMarkFailure('single success', markErr)
        }
      }
    }
    if (markFailed) warnings.push(printMarkWarning('اعتبار'))
    return { copies: plan.length, id, markFailed: warnings.length > 0, warnings }
  },

  /**
   * -------------------------------------------------------------------------
   * سند چندصفحه‌ای یک دسته‌ی تولید گروهی (§۵).
   *
   * ورودی یا `batchId` است یا فهرست `ids`. سقف عمدی ۲۰۰۰ سند در هر فایل است:
   * بیشتر از آن، خودِ رندر مرورگر و پرینتر را زمین می‌زند؛ پس بهتر است کاربر
   * دسته را در چند فایل بگیرد تا یک فایل نیمه‌کاره‌ی خراب.
   *
   * جلسه ۲۵: تصمیم‌ها (تکی/دسته‌ای، سقف، perPage، نام فایل) رفتند به
   * `@shared/creditPrint` تا تست‌پذیر شوند، و idهای واقعیِ عملیات از همین‌جا
   * برمی‌گردند تا شمارنده‌ی چاپ (§۱۳) هم برای مسیر گروهی کار کند.
   * -------------------------------------------------------------------------
   */
  async creditBatchIds(input: { batchId?: number; ids?: unknown }): Promise<{ ids: number[]; requested: number; capped: boolean }> {
    const explicit = cleanCreditIds(input?.ids)
    if (explicit.length) {
      const planned = applyCreditPrintCap(explicit)
      if (!planned.ids.length) throw new BusinessError('هیچ اعتباری برای چاپ گروهی پیدا نشد.')
      return planned
    }

    /**
     * نشست ۱۰۷ — تعداد «درخواستی» نباید سقف صفحه‌ی فهرست اعتبار باشد.
     * نسخه‌ی قبلی با `take: 5000` برای دسته‌های بزرگ عدد ۵۰۰۰ را به‌جای
     * تعداد واقعی دسته برمی‌گرداند؛ در نتیجه هشدار چاپ می‌توانست دروغ بگوید.
     * خود فهرست `count()` واقعی دارد، و فقط یک صفحه‌ی کوچک برای گرفتن idهای
     * قابل‌رندر لازم است.
     */
    /**
     * ممیزی A107-01 (AUDIT-D39) — گیت main: بدون ids و بدون شناسه‌ی دسته‌ی معتبر، list({batchId:null})
     * به پیش‌فرض «امروز» می‌افتاد ⇒ payload خالی همه‌ی اعتبارهای امروز (هر منبع) را چاپ و «چاپ‌شده» می‌کرد.
     */
    const batchId = Math.round(Number(input?.batchId ?? 0)) || 0
    if (batchId <= 0)
      throw new BusinessError('برای چاپ گروهی، دسته‌ی اعتبار یا فهرست اعتبارها را انتخاب کنید؛ بدون دسته هیچ اعتباری چاپ نشد.')
    const listed = await storeCreditService.list({
      batchId,
      take: CREDIT_PRINT_MAX_DOCS + 1,
      skip: 0
    })
    const planned = applyCreditPrintCap(listed.map((c) => c.id))
    const requested = listed.page.totalCount
    const exact = {
      ids: planned.ids,
      requested,
      capped: requested > CREDIT_PRINT_MAX_DOCS
    }
    if (!exact.ids.length) throw new BusinessError('هیچ اعتباری برای چاپ گروهی پیدا نشد.')
    return exact
  },

  async creditBatchDocs(input: { batchId?: number; ids?: unknown }): Promise<{ docs: CreditDocData[]; ids: number[]; total: number; capped: boolean }> {
    const tpl = await settingsService.receiptTemplate()
    const { ids, requested, capped } = await this.creditBatchIds(input)
    const docs: CreditDocData[] = []
    for (const id of ids) docs.push(await this.creditDocDataFor(id, tpl))
    return { docs, ids, total: requested, capped }
  },

  /**
   * یک بار رندر، برای هر سه مصرف‌کننده (چاپ، PDF، شمارش).
   * جلسه ۲۴ برای PDF دسته‌ای دو بار کل دسته را می‌خواند و می‌ساخت (یک بار برای
   * HTML و یک بار فقط برای شمردن) — روی ۲۰۰۰ سند یعنی دو برابر کار بی‌دلیل.
   */
  async creditBatchRender(input: { batchId?: number; ids?: unknown; perPage?: unknown }): Promise<{
    html: string
    ids: number[]
    total: number
    capped: boolean
    perPage: number
  }> {
    const tpl = await settingsService.receiptTemplate()
    const settings = await readCreditSettings()
    const paper = creditRenderSpec(settings)
    const { docs, ids, total, capped } = await this.creditBatchDocs(input)
    // رسید حرارتی (ارتفاع آزاد) در هر صفحه فقط یک سند می‌گیرد — §۲۱: ورودی کلمپ می‌شود
    // نشست ۳۱۷ — با فونت درشت‌تر، creditEffectivePerPage تعداد صفحه‌جا را کم می‌کند
    const perPage = creditPerPageWith(paper, input?.perPage)
    return { html: creditBatchHtml(docs, tpl, paper, perPage), ids, total, capped, perPage }
  },

  /** امضای قبلی، دست‌نخورده برای هر مصرف‌کننده‌ی دیگری. */
  async creditBatchHtmlFor(input: { batchId?: number; ids?: unknown; perPage?: unknown }): Promise<string> {
    return (await this.creditBatchRender(input)).html
  },

  /**
   * چاپ گروهی: **یک** Job چندصفحه‌ای، نه هزاران Job جدا (§۵).
   *
   * جلسه ۲۵ — `markPrinted` اینجا هم مثل چاپ تکی پیش‌فرض روشن است: بدون آن،
   * چاپ دوباره‌ی یک دسته هیچ‌وقت برچسب «نسخه‌ی مجدد» نمی‌گرفت و در Audit Log هم
   * اثری نداشت (§۱۳ و §۱۰).
   */
  async printCreditBatch(input: {
    batchId?: number
    ids?: unknown
    silent?: boolean
    deviceName?: string
    perPage?: unknown
    markPrinted?: boolean
    userId?: number | null
  }) {
    const tpl = await settingsService.receiptTemplate()
    const { html, ids, total, capped } = await this.creditBatchRender(input)
    /**
     * چاپ گروهی اعتبار هم مثل چاپ تکی اعتبار به چاپگر رسید وابسته نیست؛ نام صریح
     * renderer معتبر می‌شود و در نبود آن چاپگر پیش‌فرض ویندوز استفاده می‌شود.
     */
    const { deviceName } = await resolvePrintTargetName({
      requestedDeviceName: input.deviceName,
      savedName: ''
    })
    const warnings: string[] = []
    try {
      await printHtml(html, { silent: input.silent ?? false, deviceName })
    } catch (err) {
      // ممیزی AUDIT-S129-01 — همان قاعده‌ی چاپ تکی: نتیجه‌ی نامعلوم احتیاطاً شمرده می‌شود
      if (isPrintOutcomeUnknown(err) && creditShouldMarkPrinted(input.markPrinted)) {
        try {
          await storeCreditService.markPrintedMany({
            ids,
            userId: input.userId ?? null,
            batchId: input.batchId ?? null,
            channel: 'PRINT',
            uncertain: true
          })
        } catch (markErr) {
          logCreditMarkFailure('batch unknown', markErr)
        }
      }
      throw err
    }
    let marked = { ...CREDIT_MARK_PRINTED_NONE }
    if (creditShouldMarkPrinted(input.markPrinted)) {
      try {
        marked = await storeCreditService.markPrintedMany({
          ids,
          userId: input.userId ?? null,
          batchId: input.batchId ?? null,
          channel: 'PRINT'
        })
      } catch (markErr) {
        logCreditMarkFailure('batch success', markErr)
        warnings.push(printMarkWarning('اعتبارهای گروهی'))
      }
    }
    /** بخش ۹.۳ — شکلِ خروجی (و رسیدنِ `capped` تا خودِ UI) یک تصمیم مشترک است. */
    return { ...creditPrintBatchResult({ ids, total, capped, marked }), markFailed: warnings.length > 0, warnings }
  },

  /**
   * خروجی PDF (تکی یا گروهی) — §۱۳ و §۵.
   * پنجره‌ی «ذخیره به‌عنوان» باز می‌شود (همان الگوی `exportTableFile`): Cancel
   * یعنی هیچ فایلی ساخته نمی‌شود و هیچ شمارنده‌ای هم بالا نمی‌رود.
   *
   * جلسه ۲۵ — دو اصلاح:
   *   ۱) اکشن لاگِ مسیر دسته‌ای `CREDIT_BULK_GENERATE` بود، یعنی گرفتن یک PDF در
   *      Audit Log شبیه «تولید گروهی اعتبار جدید» دیده می‌شد. حالا `CREDIT_PRINT`.
   *   ۲) PDF هم یک نسخه‌ی قابل‌چاپِ واقعی است، پس مثل چاپ کاغذی شمارنده را بالا
   *      می‌برد (§۱۳ + ذهنیت ضدتقلب §۲۴: وگرنه هر تعداد «اصل» از یک اعتبار
   *      درمی‌آمد). با `markPrinted: false` می‌توان خاموشش کرد.
   */
  async creditPdf(input: {
    id?: number
    batchId?: number
    ids?: unknown
    ask?: boolean
    reveal?: boolean
    markPrinted?: boolean
    userId?: number | null
  }): Promise<{ saved: boolean; file: string | null; count: number; total: number; capped: boolean }> {
    const settings = await readCreditSettings()
    const paper = creditRenderSpec(settings)
    const plan = creditPrintPlan(input, paper)
    const single = plan.mode === 'single'
    /**
     * بخش ۹.۳ — «چند بار باید رندر شود» یک عدد از لایه‌ی مشترک است. جلسه ۲۴
     * برای PDF دسته‌ای دو بار کل دسته را می‌ساخت (یک بار فقط برای شمردن).
     */
    const render = creditPdfRenderPlan(single)
    const rendered = render.batchRenders === 1 ? await this.creditBatchRender(input) : null
    const html = single ? await this.creditHtml(Number(plan.id)) : (rendered as { html: string }).html
    const ids = single ? [Number(plan.id)] : (rendered as { ids: number[] }).ids
    const count = ids.length
    const total = single ? 1 : (rendered as { total: number }).total
    const capped = single ? false : (rendered as { capped: boolean }).capped
    const pdf = await pdfFromHtml(html, { widthMm: paper.widthMm, heightMm: paper.heightMm })

    const fallbackPath = join(app.getPath('documents'), plan.fileName)
    let dialogRes: Awaited<ReturnType<typeof dialog.showSaveDialog>> | null = null
    if (input?.ask !== false) {
      const win = dialogParentWindow()
      const options = {
        title: 'ذخیره‌ی PDF سند اعتبار',
        defaultPath: fallbackPath,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      }
      dialogRes = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    }
    /** بخش ۹.۳ — لغو = هیچ فایلی، هیچ شمارشی، هیچ لاگی. */
    const outcome = creditPdfSaveOutcome(dialogRes, fallbackPath)
    if (!outcome.saved || !outcome.file) return { saved: false, file: null, count, total, capped }
    const file = outcome.file
    /**
     * نشست ۱۲۹ — فایل یا کامل ذخیره می‌شود یا اصلاً نه (پیام فارسی با علت)، و
     * شمارنده فقط بعد از ذخیره‌ی کامل بالا می‌رود. نشان‌دادن پوشه هم نباید بعد
     * از ذخیره‌ی موفق، ثبت شمارنده‌ی این نسخه‌ی قابل‌چاپ را قطع کند.
     */
    await writeFileAtomic(file, pdf)
    if (input?.reveal !== false) {
      try {
        shell.showItemInFolder(file)
      } catch (e) {
        console.error('[print] reveal credit pdf failed', e)
      }
    }
    /** بخش ۹.۳ — کدام مسیرِ شمارش (و اینکه اصلاً شمرده شود یا فقط لاگ بخورد). */
    const markPlan = creditPdfMarkPlan({ single, markPrinted: input?.markPrinted })
    if (markPlan.kind === 'auditOnly') {
      // شمارنده دست نمی‌خورد، ولی خودِ فایل باید در لاگ بماند (§۱۰)
      const log = creditPdfAuditOnly(
        { single, id: Number(plan.id), batchId: plan.batchId ?? null, count, file },
        faDigits
      )
      await audit(prisma, {
        action: AuditAction[log.action],
        entity: log.entity,
        entityId: log.entityId,
        userId: input?.userId ?? null,
        after: log.after,
        note: log.note
      })
    } else if (markPlan.kind === 'single') {
      await storeCreditService.markPrinted({ id: Number(plan.id), userId: input?.userId ?? null, channel: markPlan.channel, file })
    } else {
      await storeCreditService.markPrintedMany({
        ids,
        userId: input?.userId ?? null,
        batchId: plan.batchId,
        channel: markPlan.channel,
        file
      })
    }
    return { saved: true, file, count, total, capped }
  },

  async labelTemplateFor(override?: Partial<LabelTemplate>): Promise<LabelTemplate> {
    const [saved, receipt] = await Promise.all([
      settingsService.labelTemplate(),
      settingsService.receiptTemplate()
    ])
    const merged: LabelTemplate = { ...saved, ...(override ?? {}) }
    return { ...merged, brandName: resolveLabelBrand(merged, receipt.shopName) }
  },

  /**
   * -------------------------------------------------------------------------
   * «پیش‌نمایش زنده‌ی لیبل» پنل تنظیمات — همان کاری که previewHtml برای رسید
   * می‌کند: یک لیبل نمونه با تنظیمات *ذخیره‌نشده‌ی* فعلی ساخته می‌شود، پس هر
   * تغییری (ابعاد، فونت، نمایش اسم/قیمت/بارکد/برند/لوگو) همان لحظه دیده می‌شود.
   * -------------------------------------------------------------------------
   */
  async labelPreviewHtml(input: { template?: Partial<LabelTemplate>; sample?: { name?: string; code?: string; price?: number } } = {}) {
    const tpl = await this.labelTemplateFor(input.template)
    const code = String(input.sample?.code ?? '1024')
    let barcodeDataUrl = ''
    try {
      barcodeDataUrl = await barcodePng(String(input.sample?.code ?? '1024000000017'), {
        scale: 2,
        height: 10,
        includetext: tpl.showBarcodeText
      })
    } catch (e) {
      // نبودن تصویر بارکد نباید پیش‌نمایش را زمین بزند
      console.error('[print] label preview barcode failed', e)
    }
    return labelHtml(
      [
        {
          name: String(input.sample?.name ?? 'شلوار نیم بگ سایز ۳۶ - ذغالی'),
          code,
          price: Math.max(0, Math.round(Number(input.sample?.price ?? 9800000))),
          barcodeDataUrl
        }
      ],
      tpl
    )
  },

  printers: () => listPrinters()
}
