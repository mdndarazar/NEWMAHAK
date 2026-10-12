import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { digitsOnly, groupThousands } from '../lib/moneyInput'
// نشست ۲۲۲ · فاز ۳ — نقطه‌ی مشترک چاپ (پرسش/بی‌پرس + چاپگر)
import { printWith } from '../lib/printFlow'
import { isPrintCancelledError } from '../lib/printErrors'
import { exportTable } from '../lib/exportCsv'
import { pageOfOutput, readAllReportPages, type ReadAllPagedResult } from '../lib/reportOutput'
import ReportFilterBar, { channelsLabel, makeFilters, toServiceFilter, type ReportFilters } from '../components/ReportFilterBar'
import ManagerGate from '../components/ManagerGate'
import AccountingBlocks, { type DrillTarget } from '../components/AccountingBlocks'
import BridgeDiagnosticsModal from '../components/BridgeDiagnosticsModal'
import ReportExtraTables from '../components/ReportExtraTables'
/**
 * جلسه ۱۸ — بدنه‌ی سه تب تازه. هر سه، کامپوننت‌های *مستقل*اند تا این فایل
 * (که از قبل بلند است) پیچیده‌تر نشود و هیچ‌کدام از تب‌های سالم فعلی دست نخورند.
 */
import CardTransferPanel, { PendingStockBadge } from '../components/CardTransferPanel'
/**
 * جلسه ۴۳ · کار ب (فقط خواندنی) — «کالای برگشتیِ در انتظار تأیید مدیر» در تب
 * برگشت/تعویض و در بلوک خلاصه. این صفحه در قفل `salesReports` خودش می‌ماند و
 * **هیچ دکمه‌ی تأیید یا بازگشت به انبار نمی‌سازد**؛ تنها جای آن کار، پنل قفل‌دار
 * «پرداخت‌های مدیر — کارت‌به‌کارت» (`PANEL_KEYS.cardTransfers`) است.
 */
import { usePendingRestock, pendingToneBox, type PendingRestockView } from '../hooks/usePendingRestock'
import { PENDING_RESTOCK_COLUMN, PENDING_RESTOCK_EXPLAINER } from '@shared/pendingRestock'
/**
 * جلسه ۵۰ · مرحله ۱-ب — ستون «مبدأ برداشت» تب تعویض. متن را سرور در
 * `SaleReturn.note` نوشته است و اینجا فقط *خوانده* می‌شود؛ هیچ محاسبه‌ای در
 * این صفحه انجام نمی‌گیرد (همان قاعده‌ی بقیه‌ی ستون‌ها).
 */
import { STOCK_PICK_TEXT, centralWithdrawShortLine, parseCentralWithdrawNote } from '@shared/stockSource'
// جلسه ۵۳ · مرحله ۴ — ستون «مبدأ کسر» تب سرجمع فروش (فقط خواندنی)
import { useSaleStockSources } from '../hooks/useSaleStockSources'
import StaffPerformancePanel from '../components/StaffPerformancePanel'
import { dateOnlyTabNotice } from '@shared/reportTabScope'
import OutOfShiftPanel from '../components/OutOfShiftPanel'
import OverrideSessionsPanel from '../components/OverrideSessionsPanel'
import InvoicePaymentsModal from '../components/InvoicePaymentsModal'
import CreditSettlementModal from '../components/CreditSettlementModal'
import ReturnCorrectionLedger from '../components/ReturnCorrectionLedger'
import { useSettings } from '../hooks/useSettings'
import ConfirmDialog from '../components/ConfirmDialog'
import { MANAGER_ACCOUNT_ROW_LABEL, MANAGER_ACCOUNT_ROW_NOTE } from '@shared/enums'
import {
  cardOnlyOf,
  managerAccountOf,
  otherOrUnknownOf,
  destinationCells,
  DESTINATION_HEADERS
} from '../lib/destinationCells'
import { usePanelLock, usePanelOpen } from '../hooks/usePanelLocks'
import { useManagerSession } from '../hooks/useManagerSession'
import { PANEL_KEYS } from '@shared/panels'
import {
  ColGroup,
  ResizableHeaderCells,
  useResizableColumns,
  type ResizableColumns
} from '../components/ResizableColumns'
import { faDigits, money, isValidJalaliDate } from '@shared/jalali'
import { physicalMoneyInDrawerAndCard, returnCreditAmountOf } from '@shared/accounting'
import { buildNetToDrawer, splitDrawerPos } from '@shared/cashExplainer'
import { DrawerVsPosSplit } from '../components/cash/DrawerVsPosSplit'
import FinancialInspector from '../components/cash/FinancialInspector'
import CreditLifecycleCard from '../components/cash/CreditLifecycleCard'
import { NonCashDrawer } from '../components/cash/NonCashDrawer'
import {
  creditOutstandingOf,
  fraudOutputRows,
  outputLastPageNotes,
  outputPageRangeNote,
  shownInvoiceUnits
} from '@shared/reportExtraOutput'
/**
 * جلسه ۲۴ — لایه‌ی نمایشِ خالص ماژول اعتبار. سرستون‌ها، شکل ردیف اکسل و کارت‌های
 * داشبورد یک بار در `@shared/creditUi` تعریف شده‌اند؛ اینجا فقط مصرف می‌شوند تا
 * این تب و صفحه‌ی `CreditManagement.tsx` هیچ‌وقت دو خروجی متفاوت ندهند.
 */
import {
  CREDIT_LIST_ONLY_HINT,
  CREDIT_LIST_SCREEN_COLUMNS,
  CREDIT_LIST_SCREEN_HEADERS,
  CREDIT_RANGE_EXPORTS,
  CREDIT_SOURCE_OPTIONS,
  CREDIT_STATUS_OPTIONS,
  TONE_CLASS,
  creditExport,
  creditListCellFormat,
  creditListRow,
  creditListScreenRow,
  creditListScreenTotals,
  creditListTotalsLabel,
  creditCellText,
  creditRangeExportDisabled,
  creditRangeExportOrigin,
  creditRangeExportRequest,
  creditRangeExportRows,
  creditReportRequests,
  creditEffectiveSkip,
  creditListPager,
  creditSelectionResetSignature,
  dashboardCards,
  type CreditExportKind
} from '@shared/creditUi'
import type { CreditDashboard, StoreCreditSafeRow } from '@shared/types'
import type {
  CreditInvoiceRow,
  CreditReportResult,
  CreditSettlementRow,
  ExchangeReportResult,
  ExchangeReportRow,
  PagedRows,
  SaleReportResult,
  SaleReportPage,
  SaleReportRow,
  SaleItemReportRow,
  SaleReportTotals,
  SaleAccountingStatements,
  SaleBridgeBlock,
  SaleBridgeRow,
  SaleBridgeSource,
  FinancialSourceKey
} from '@shared/types'

/**
 * ===================== گزارشات فروش =====================
 * سه تب، با همان چیدمان و ستون‌های آشنا:
 *
 *   • سرجمع فروش — یک ردیف برای هر فاکتور: شماره فیش، تاریخ، ساعت، نام خریدار،
 *     وضعیت، نوع ارسال، جمع مبلغ کالا، عوارض و مالیات، حق سرویس، تخفیف، هزینه
 *     پیک، جمع کل فروش، نقدی، کارت. **هر فاکتوری که در پنل فروش تکی زده شود
 *     خودکار همین‌جا می‌آید** (هیچ ثبت دستی لازم نیست).
 *   • جزئیات فروش — سطر به سطر کالاهای فروخته‌شده.
 *   • برگشت از فروش — فهرست برگشت‌های ثبت‌شده.
 *
 * بازه‌ی تاریخ شمسی آزاد است، پس گزارش روزانه، ماهانه یا سالانه با همین پنل
 * گرفته می‌شود.
 *
 * «جداسازی بر اساس شیفت»: با روشن کردن این چک‌باکس، همان ردیف‌ها به تفکیک
 * روز → شیفت گروه می‌شوند و هر گروه جمع خودش را دارد. یعنی شیفت دوم، هم گزارش
 * شیفت اول را می‌بیند و هم — جدا و مشخص — فروش خودش را.
 *
 * عرض ستون‌ها: مرز دو سرستون را با ماوس بکشید تا ستون — مثل اکسل — بزرگ یا
 * کوچک شود. چیدمان هر جدول جدا ذخیره می‌شود و بعد از باز و بسته کردن برنامه سر
 * جایش می‌ماند. دوبار کلیک روی مرز = همان ستون به عرض خودکار · دکمه‌ی «بازنشانی
 * عرض ستون‌ها» = کل جدول به حالت اول.
 *
 * IPC: sale:report:rows · sale:report:items · sale:return:list · print:a4 ·
 *      print:thermalSummary · print:invoice · system:exportCsv
 * ========================================================
 */

type Tab =
  | 'summary'
  | 'items'
  | 'returns'
  | 'exchanges'
  | 'credit'
  /** جلسه ۱۵ · بند ۱۴ — تب چک‌ها */
  | 'cheques'
  /** جلسه ۱۵ · بند ۱۴ — تب اعتبار خرید */
  | 'storeCredits'
  /** جلسه ۱۵ · بخش ۵ — دفتر رویداد (هر رویداد با تاریخ خودش) */
  | 'ledger'
  /** جلسه ۱۵ · بخش ۶ — بازبینی ضدتقلب */
  | 'fraud'
  /** بند ۴-۱۶ — شماره‌های جاافتاده/باطل‌شده‌ی فیش */
  | 'receiptGaps'
  /** جلسه ۱۸ · بند ۱ — درخواست‌های کارت‌به‌کارت توسط مدیر (فقط مدیر) */
  | 'cardTransfers'
  /** جلسه ۱۸ · بند ۲ و ۳ — عملکرد کارمندان + تخفیف‌های غیرعادی */
  | 'staff'
  /** جلسه ۱۸ · بند ۶ — تراکنش‌های خارج از بازه‌ی شیفت رسمی */
  | 'outOfShift'
  /** جلسه ۱۹ · بند ۲ — نشست‌هایی که نامشان دستی override شده است */
  | 'overrideSessions'
  /**
   * جلسه ۲۴ — تب تازه‌ی ماژول «مدیریت اعتبار خرید».
   * ⚠️ این تب هیچ ربطی به تب قدیمیِ `storeCredits` ندارد: آن یکی مسیر legacy
   * تعویض کالا را از `CH.storeCreditList` می‌خواند و دست‌نخورده می‌ماند. این یکی
   * از `CH.creditDashboard` / `CH.creditList` می‌خواند — همان کانال‌هایی که
   * `CreditManagement.tsx` مصرف می‌کند — و قفلش `PANEL_KEYS.creditManagement` است.
   */
  | 'creditManagement'

/** عملیات حساس تعویض که نباید پیش از بازشدن قفل، فرم‌شان دیده شود. */
type ExchangeCorrectionAction = 'VOID' | 'RECONCILE'
type PendingExchangeCorrectionAction = {
  action: ExchangeCorrectionAction
  row: ExchangeReportResult['rows'][number]
}

/**
 * کلید داده‌ی قابل چاپ/خروجی. فرم فیلتر می‌تواند بعد از آخرین اجرای موفق
 * تغییر کند؛ بنابراین عنوان و بدنه‌ی سند فقط وقتی معتبرند که این کلید با
 * snapshot آخرین بارگذاری یکی باشد.
 */
function reportDataKey(
  tab: Tab,
  f: ReportFilters,
  options: {
    includeExchanges: boolean
    includeSettled: boolean
    chequeDateMode: string
    creditOpen: boolean
  }
): string {
  const service = toServiceFilter(f)
  return JSON.stringify({
    tab,
    filter: {
      ...service,
      channels: [...(service.channels ?? [])].sort()
    },
    ...options
  })
}

/**
 * ممیزی A93-01 — ستون «کانال» چاپ/Excel اعتبار خرید همیشه خالی بود (ردیف StoreCreditRow
 * هیچ فیلد کانالی ندارد) و عبارت اجباری «غیرقابل نقد شدن» (بند ۴-۳۲) روی گزارش نبود.
 * ستون مرده با «منبع» (تعویض/صدور دستی — ردیابی صدور بی‌فاکتور، بند ۴-۲۹) جایگزین شد.
 */
const STORE_CREDIT_NOT_CASHABLE_TITLE = 'غیرقابل نقد شدن'
const STORE_CREDIT_OUTPUT_HEADERS = ['شناسهٔ امن اعتبار', 'شماره فیش مبدأ', 'تاریخ صدور', 'تاریخ انقضا', 'وضعیت', 'مبلغ', 'مصرف‌شده', 'مانده‌ی قابل مصرف', 'تاریخ مصرف', 'منبع']

const SUMMARY_HEADERS = [
  'شماره فیش',
  'تاریخ',
  'ساعت',
  'شیفت',
  'نام خریدار',
  'وضعیت',
  'نوع ارسال',
  'جمع مبلغ کالا',
  'عوارض و مالیات',
  'حق سرویس',
  'تخفیف',
  'هزینه پیک',
  'جمع کل فروش',
  'نقدی',
  /**
   * مبلغی که همین فاکتور با اعتبار خرید تسویه شده است؛ پول نقد/کارت نیست.
   * عدد از ردیف آمادهٔ server می‌آید و با کلیک، جزئیات امن همان فاکتور باز می‌شود.
   */
  'تسویه با اعتبار خرید',
  // کار الف: جای ستون تکیِ «کارت» (که «سایر» را بی‌صدا در خود داشت)
  ...DESTINATION_HEADERS,
  'کد فاکتور',
  /**
   * جلسه ۵۳ · مرحله ۴ — «مبدأ کسر» فاکتور. عمداً *آخرین* ستون داده است (کنار
   * «کد فاکتور»، قبل از ستون دکمه‌ها): هیچ عدد مالی‌ای را جابه‌جا نمی‌کند و
   * فاکتورهای بی‌دفتر همان «—» قبلی را می‌گیرند. الگو عیناً ستون «مبدأ برداشت»
   * تب تعویض (جلسه ۵۰) است.
   */
  STOCK_PICK_TEXT.columnTitle
]

const ITEM_HEADERS = [
  'شماره فیش',
  'تاریخ',
  'ساعت',
  'شیفت',
  'کد',
  'بارکد',
  'نام کالا',
  'تعداد',
  'قیمت واحد',
  'تخفیف',
  'عوارض و مالیات',
  'جمع',
  'برگشتی',
  'مبلغ برگشتی',
  'خالص',
  'خریدار'
]

const RETURN_HEADERS = [
  'شماره فیش',
  'کد فاکتور',
  'تاریخ فاکتور',
  'تاریخ برگشت',
  'ساعت',
  'مشتری',
  'نوع سند',
  'کامل/جزئی',
  'تعداد',
  'ارزش کالای برگشتی',
  // ---- بند ۱۰ و ۱۱ (جلسه ۱۶): ستون‌هایی که تفکیک کسری واقعی را ممکن می‌کنند ----
  'نحوه‌ی تسویه',
  'پول واقعاً خارج‌شده از کشو',
  'شناسهٔ امن اعتبار',
  'مبلغ اعتبار',
  'برگشت به انبار',
  /**
   * جلسه ۴۳ · کار ب — ستون خواندنیِ «معلق برگشتی». عمداً *کنار* «برگشت به انبار»
   * نشسته: آن عدد می‌گوید چقدر واقعاً به موجودی قابل‌فروش رفته و این یکی می‌گوید
   * چقدر هنوز نرفته و منتظر پرداخت مدیر است. جمع این دو = تعداد برگشتی.
   */
  PENDING_RESTOCK_COLUMN,
  'فروشنده‌ی فاکتور اصلی',
  'کاربر ثبت‌کننده‌ی برگشت',
  'اقلام'
]

/**
 * تب «تعویض کالا» (بخش ۶). ستون‌ها دقیقاً همان چیزی است که مدیر برای کنترل یک
 * تعویض لازم دارد: لحظه‌ی دقیق ثبت (تاریخ + ساعت با ثانیه)، کالای برگشتی،
 * کالای جایگزین، مابه‌التفاوت، و این‌که مابه‌التفاوت *چطور* تسویه شد.
 */
/** عنوان ستون «مبدأ برداشت» (جلسه ۵۰ · مرحله ۱-ب) — یک‌جا، تا چاپ/اکسل/جدول یکی بمانند. */
const EXCHANGE_SOURCE_COLUMN = 'مبدأ برداشت'
const EXCHANGE_SOURCE_EXPLAINER =
  'کمبود موجودی «کالای جایگزین» از این انبار(ها) برداشته و به انبار فروشگاه منتقل شد. ' +
  'خالی بودنش یعنی کالای جایگزین کاملاً از انبار فروشگاه کم شده است (رفتار پیش‌فرض).'

/** خلاصه‌ی «مبدأ برداشت» یک ردیف تعویض، از روی تگ ثابتِ داخل `note`. */
const exchangeSourceOf = (note: string | null | undefined): string => {
  const info = parseCentralWithdrawNote(note)
  return info ? centralWithdrawShortLine(info.warehouses, faDigits) : ''
}

const EXCHANGE_HEADERS = [
  'شماره فیش فاکتور اصلی',
  'سند تعویض',
  'تاریخ تعویض',
  'ساعت (دقیق)',
  'شیفت',
  'مشتری',
  'کالای برگشتی',
  'جمع برگشتی',
  /**
   * جلسه ۴۴ · کار ب — ستون «معلق برگشتی» عمداً چسبیده به بلوکِ *برگشتی* است، نه
   * کنار «کالای جایگزین»: جایگزین همان لحظه از انبار کم می‌شود و هیچ‌وقت معلق
   * نیست؛ فقط کالای برگشتی می‌تواند در انتظار پرداخت مدیر بماند.
   */
  PENDING_RESTOCK_COLUMN,
  'کالای جایگزین',
  'جمع جایگزین',
  /**
   * جلسه ۵۰ · مرحله ۱-ب — «مبدأ برداشت» کالای جایگزین. عمداً چسبیده به بلوک
   * *جایگزین* است، چون فقط کالای جایگزین است که ممکن است از انبار مرکزی
   * برداشته شده باشد. خالی («—») = کاملاً از انبار فروشگاه کم شد، که معنای
   * همه‌ی تعویض‌های قبل از جلسه ۵۰ هم هست.
   */
  EXCHANGE_SOURCE_COLUMN,
  'مابه‌التفاوت',
  'نحوه‌ی تسویه',
  'دریافت نقدی',
  'دریافت کارتی',
  'شناسهٔ امن اعتبار',
  'مبلغ اعتبار',
  'وضعیت اعتبار'
]

/**
 * ---------------------------------------------------------------------------
 * تب «نسیه» (بخش ۷) — دو جدول در یک تب:
 *
 *   ۱) «بدهکاران این بازه»: هر فاکتور تسویه‌نشده یا نیمه‌تسویه با جمع کل،
 *      پرداختی، باقی‌ماندهٔ بدهی، سن بدهی و چک در جریانش.
 *   ۲) «تسویه‌ی نسیه‌ی بازه‌های قبل»: پولی که *در همین بازه* بابت فاکتورهای
 *      قدیمی‌تر گرفته شده (همان برچسب «تسویه‌ی نسیه‌ی ۱۴۰۵/۰۴» سرویس).
 *
 * ⚠️ این تب کلید قفل *مستقل* خودش را دارد (`PANEL_KEYS.salesCredit`) و با
 * `<ManagerGate … inline>` پوشیده شده است — نه کل پنل گزارشات. پس حسابدارِ
 * گزارشات فروش، لازم نیست فهرست بدهکاران را هم ببیند.
 * ---------------------------------------------------------------------------
 */
const CREDIT_HEADERS = [
  'شماره فیش',
  'تاریخ فاکتور',
  'ساعت',
  'نوع فروش',
  'مشتری',
  'تلفن',
  'جمع کل فاکتور',
  'پرداختی (دریافت‌شده)',
  'باقی‌ماندهٔ بدهی',
  'وضعیت تسویه',
  'چک در جریان',
  'تعداد پرداختی',
  'آخرین پرداختی',
  'سن بدهی (روز)',
  'اضافه دریافتی',
  'تاریخ تسویه',
  'شیفت',
  'کاربر ثبت‌کننده'
]

/** جدول دوم تب نسیه: پرداختی‌های همین بازه بابت فاکتورهای بازه‌های قبل. */
const SETTLEMENT_HEADERS = [
  'شماره فیش فاکتور',
  'مشتری',
  'تاریخ پرداختی',
  'ساعت',
  'مبلغ دریافتی',
  'روش پرداخت',
  'نوع',
  'تاریخ فاکتور',
  'بابت',
  'فاکتور تسویه شد؟',
  'اضافه دریافتی'
]

const emptyCredit = (): CreditReportResult => ({
  rows: [],
  priorSettlements: [],
  totals: {
    count: 0,
    grandTotal: 0,
    paidTotal: 0,
    remainingTotal: 0,
    unpaidCount: 0,
    partialCount: 0,
    settledCount: 0,
    pendingChequeTotal: 0,
    overpayTotal: 0,
    priorSettlementTotal: 0
  }
})

const emptyExchange = (): ExchangeReportResult => ({
  rows: [],
  totals: {
    count: 0,
    returnTotal: 0,
    exchangeTotal: 0,
    diffTotal: 0,
    cashReceivedTotal: 0,
    cardReceivedTotal: 0,
    creditIssuedTotal: 0,
    creditUsedTotal: 0
  }
})

type OutputScope = 'all' | 'page'

type ReportOutputSnapshot = {
  meta: string
  summaryRows: SaleReportRow[]
  itemRows: SaleItemReportRow[]
  returnRows: any[]
  exchangeRows: ExchangeReportResult['rows']
  exchangeTotals: ExchangeReportResult['totals']
  creditRows: CreditReportResult['rows']
  priorSettlements: CreditReportResult['priorSettlements']
  creditTotals: CreditReportResult['totals']
  chequeRows: any[]
  storeCreditRows: any[]
  ledgerRows: any[]
  fraudGroups: any[]
  stockSourceShort: (invoiceId: number | null | undefined) => string
}

function rowsFromListResponse<T>(value: any, key = 'rows'): T[] {
  if (Array.isArray(value)) return value as T[]
  return Array.isArray(value?.[key]) ? value[key] : []
}

const exchangeTotalsFromRows = (rows: ExchangeReportResult['rows']): ExchangeReportResult['totals'] => ({
  count: rows.length,
  returnTotal: rows.reduce((sum, row) => sum + Number(row.returnTotal ?? 0), 0),
  exchangeTotal: rows.reduce((sum, row) => sum + Number(row.exchangeTotal ?? 0), 0),
  diffTotal: rows.reduce((sum, row) => sum + Number(row.diff ?? 0), 0),
  cashReceivedTotal: rows.reduce((sum, row) => sum + Number(row.cashReceived ?? 0), 0),
  cardReceivedTotal: rows.reduce((sum, row) => sum + Number(row.cardReceived ?? 0), 0),
  creditIssuedTotal: rows.reduce((sum, row) => sum + Number(row.storeCreditAmount ?? 0), 0),
  creditUsedTotal: rows.reduce(
    (sum, row) => sum + (row.storeCreditStatus === 'USED' ? Number(row.storeCreditAmount ?? 0) : 0),
    0
  )
})

const creditTotalsFromRows = (
  rows: CreditReportResult['rows'],
  priorSettlements: CreditReportResult['priorSettlements']
): CreditReportResult['totals'] => ({
  count: rows.length,
  grandTotal: rows.reduce((sum, row) => sum + Number(row.grandTotal ?? 0), 0),
  paidTotal: rows.reduce((sum, row) => sum + Number(row.paidTotal ?? 0), 0),
  remainingTotal: rows.reduce((sum, row) => sum + Number(row.remaining ?? 0), 0),
  unpaidCount: rows.filter((row) => row.settlementState === 'UNPAID').length,
  partialCount: rows.filter((row) => row.settlementState === 'PARTIAL').length,
  settledCount: rows.filter((row) => row.settled).length,
  pendingChequeTotal: rows.reduce((sum, row) => sum + Number(row.pendingChequeTotal ?? 0), 0),
  overpayTotal: rows.reduce((sum, row) => sum + Number(row.overpayTotal ?? 0), 0),
  priorSettlementTotal: priorSettlements.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
  priorSettlementCount: priorSettlements.length
})

const itemsLabel = (list: { name: string; qty: number }[]) =>
  list.map((i) => `${i.name} (${faDigits(i.qty)})`).join(' · ')

const fraudGroupLabel = (group: any, fallback = '—') => {
  const base = group.title ?? group.label ?? group.key ?? fallback
  const truncation = group.sourcesTruncated
    ? ` · نمایش ${faDigits(group.sources?.length ?? 0)} از ${faDigits(group.sourcesTotal ?? 0)} سند`
    : ''
  return `${base}${truncation}`
}

/**
 * کار الف — ستون «کارت» دیگر `+ otherTotal` نیست. سه تابع مشترک
 * (`lib/destinationCells.ts`) تنها جای تبدیل عدد سرور به ستون جدول‌اند، پس این
 * صفحه، بستن صندوق و پنجره‌ی شیفت نمی‌توانند سه عدد متفاوت نشان دهند.
 */
const cardOf = (r: SaleReportRow) => cardOnlyOf(r)

/**
 * جلسه ۵۳ — `source` را *صدازننده* می‌دهد (از هوک مشترک `useSaleStockSources`)،
 * چون `SaleReportRow` این فیلد را از سرور نمی‌گیرد و این فایل نباید متنش را خودش
 * بسازد. پیش‌فرض خالی ⇒ هر صدازننده‌ی قدیمی همان ستون خالی را می‌بیند، نه خطا.
 */
const summaryRowValues = (r: SaleReportRow, source = '') => [
  r.receiptNo,
  r.dateJalali,
  r.time,
  r.shiftName,
  r.customerName,
  r.statusLabel,
  r.orderTypeLabel,
  r.goodsTotal,
  r.taxTotal,
  r.serviceCharge,
  r.discountTotal,
  r.deliveryFee,
  r.grandTotal,
  r.cashTotal,
  r.storeCreditTotal,
  ...destinationCells(r),
  r.returnCode ?? '',
  // جلسه ۵۳ · مرحله ۴ — همان ستون «مبدأ کسر» جدول، در چاپ A4 و اکسل
  source
]

/**
 * ===========================================================================
 * بند ۷ — بلوک «خلاصه‌ی فروش بازه» با فیلتر پویا.
 *
 * چه چیزی را حل می‌کند؟ مدیر می‌خواهد در *یک نگاه* بفهمد پول واقعیِ این بازه
 * چقدر بوده، و بتواند سناریو بسازد: «اگر نسیه نمی‌دادم چقدر پول داشتم؟»،
 * «جمع کارت‌خوان با سیستم می‌خورد؟».
 *
 * سه قاعده‌ی قطعی:
 *   ۱) **همیشه همه‌ی ردیف‌ها نمایش داده می‌شوند، حتی اگر صفر باشند.** یک عوارضِ
 *      صفر، خودش یک اطلاع است (یعنی در این بازه عوارض نگرفته‌ایم) و نباید با
 *      «نبودن ردیف» قابل‌اشتباه باشد.
 *   ۲) برداشتن تیک یک ردیف، آن را هم از *نمایش* و هم از *محاسبه‌ی خالص* بیرون
 *      می‌برد (نه فقط پنهان کردن). این تفاوت، تمام ارزش این بلوک است.
 *   ۳) علامت هر ردیف (+ / −) ثابت و از پیش تعیین‌شده است، و «خالص» فقط جمع
 *      جبری ردیف‌های *فعال* است. هیچ عدد جداگانه‌ای محاسبه نمی‌شود که بتواند با
 *      ردیف‌ها واگرا شود.
 *
 * مبنای ریاضی (همان `saleTotals` سمت سرور، تا دو جا دو فرمول نداشته باشیم):
 *     grandTotal = goodsTotal − discountTotal + taxTotal + serviceCharge + deliveryFee
 * پس «فروش کل» این بلوک عمداً `goodsTotal` است (مبلغ کالا *پیش از* تخفیف) و
 * تخفیف یک ردیف منفیِ جداگانه دارد — دقیقاً همان چیدمانی که مالک نرم‌افزار
 * خواسته است: «فروش کل +۱۰,۰۰۰,۰۰۰ … تخفیف −۵۰۰,۰۰۰ … خالص ۸,۵۳۰,۰۰۰».
 * ===========================================================================
 */
type SummaryPartKey = 'goods' | 'service' | 'tax' | 'delivery' | 'discount' | 'returned' | 'credit' | 'priorCredit'

interface SummaryPart {
  key: SummaryPartKey
  label: string
  /** ۱+ به خالص اضافه می‌شود · ۱− کم می‌شود */
  sign: 1 | -1
  value: number
  hint: string
}

const ALL_SUMMARY_PARTS: readonly SummaryPartKey[] = [
  'goods',
  'service',
  'tax',
  'delivery',
  'discount',
  'returned',
  'credit',
  'priorCredit'
]

/** جمع‌های گزارش ⇒ ردیف‌های بلوک خلاصه (به همان ترتیب نمایش). */
function summaryParts(t: SaleReportTotals): SummaryPart[] {
  return [
    {
      key: 'goods',
      label: 'فروش کل (مبلغ کالا، پیش از تخفیف)',
      sign: 1,
      value: t.goodsTotal,
      hint: 'جمع «قیمت واحد × تعداد» همه‌ی اقلام فروخته‌شده در این بازه، پیش از کسر تخفیف.'
    },
    {
      key: 'service',
      label: 'حق سرویس',
      sign: 1,
      value: t.serviceTotal,
      hint: 'حق سرویسی که طبق تنظیمات ماژول «حق سرویس» روی فاکتورها نشسته است.'
    },
    {
      key: 'tax',
      label: 'عوارض و مالیات',
      sign: 1,
      value: t.taxTotal,
      hint: 'عوارض و مالیات ردیف‌ها و سطح فاکتور، طبق تنظیمات ماژول «عوارض و مالیات».'
    },
    {
      key: 'delivery',
      label: 'هزینه پیک',
      sign: 1,
      value: t.deliveryTotal,
      hint: 'هزینه‌ی ارسال/پیک که روی فاکتورهای بیرون‌بر گرفته شده است.'
    },
    {
      key: 'discount',
      label: 'تخفیف',
      sign: -1,
      value: t.discountTotal,
      hint: 'جمع تخفیف روی کالا و تخفیف کل فاکتور. اگر این عدد بی‌دلیل بزرگ است، سیاست تخفیف را در تنظیمات محدود کنید.'
    },
    {
      key: 'returned',
      label: 'برگشت از فروش',
      sign: -1,
      value: t.returnedTotal,
      hint: 'ارزش کالای برگشتی این بازه (فروش تعهدی را کم می‌کند). لزوماً خروج نقد از کشو نیست: اگر بارکد اعتبار صادر شده باشد پول در صندوق مانده و بدهی ما در ردیف اعتبار دیده می‌شود.'
    },
    {
      key: 'credit',
      label: 'نسیه (وصول‌نشده‌ی همین بازه)',
      sign: -1,
      value: t.creditRemainingTotal,
      hint: 'باقی‌ماندهٔ بدهی فاکتورهای همین بازه. تیکش را بردارید تا ببینید «اگر نسیه نمی‌دادم چقدر پول داشتم».'
    },
    {
      key: 'priorCredit',
      label: 'پرداخت نسیه‌ی بازه‌های قبل',
      sign: 1,
      value: t.priorSettlementTotal,
      hint: 'پولی که در این بازه بابت فاکتورهای نسیه‌ی قدیمی‌تر گرفته شده است: پول واقعیِ این بازه، ولی فروش این بازه نیست. چکِ پاس‌نشده در این عدد شمرده نمی‌شود.'
    }
  ]
}

export default function SalesReports() {
  const nav = useNavigate()
  /**
   * باز بودن گزارشات فروش، مجوز تغییر سند برگشت/تعویض نیست. این قفل عملیاتی
   * مستقل، همان سیاست صفحه‌ی برگشت را برای دکمه‌های «ابطال/اصلاح» گزارش اعمال
   * می‌کند و تا خواندن policy نیز fail-closed است.
   */
  const correctionOpen = usePanelOpen(PANEL_KEYS.salesReturnCorrection)
  const { loaded: correctionLockLoaded } = usePanelLock(PANEL_KEYS.salesReturnCorrection)
  const { unlockPanel } = useManagerSession()
  const [exCorrectionUnlockRequest, setExCorrectionUnlockRequest] = useState<PendingExchangeCorrectionAction | null>(null)
  const [exCorrectionUnlockPassword, setExCorrectionUnlockPassword] = useState('')
  const [exCorrectionUnlockBusy, setExCorrectionUnlockBusy] = useState(false)
  const [exCorrectionUnlockError, setExCorrectionUnlockError] = useState<string | null>(null)
  const { settings } = useSettings()
  const [tab, setTab] = useState<Tab>('summary')
  // ---------------- جلسه ۱۵: داده‌ی چهار تب تازه ----------------
  const [cheques, setCheques] = useState<any>(null)
  const [chequeDateMode, setChequeDateMode] = useState<'due' | 'paid' | 'cleared'>('due')
  const [storeCredits, setStoreCredits] = useState<any>(null)
  const [ledger, setLedger] = useState<any>(null)
  const [fraud, setFraud] = useState<any>(null)
  const [receiptGaps, setReceiptGaps] = useState<null | {
    seq: number
    maxReceiptNo: number
    liveCount: number
    voidedCount: number
    missingCount: number
    ranges: { from: number; to: number; count: number; reason: 'voided' | 'missing'; label: string }[]
  }>(null)
  const [filters, setFilters] = useState<ReportFilters>(makeFilters())
  const [appliedFilters, setAppliedFilters] = useState<ReportFilters>(() => ({
    ...filters,
    channels: [...filters.channels]
  }))
  const [loadedReportKey, setLoadedReportKey] = useState<string | null>(null)
  const [byShift, setByShift] = useState(false)
  const [busy, setBusy] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const printBusyRef = useRef(false)
  /** خروجی پیش‌فرض کل فیلتر اجراشده است؛ صفحه‌ی جاری فقط با تیک صریح صادر می‌شود. */
  const [outputScope, setOutputScope] = useState<OutputScope>('all')
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // عرض ستون‌ها: هر تب چیدمان مستقل خودش را دارد (و جدا ذخیره می‌شود)
  const summaryCols = useResizableColumns('sales-summary', SUMMARY_HEADERS.length + 1)
  const itemCols = useResizableColumns('sales-items', ITEM_HEADERS.length)
  const returnCols = useResizableColumns('sales-returns', RETURN_HEADERS.length)
  const exchangeCols = useResizableColumns('sales-exchanges', EXCHANGE_HEADERS.length + 1)
  const creditCols = useResizableColumns('sales-credit', CREDIT_HEADERS.length + 1)
  const settlementCols = useResizableColumns('sales-credit-settlements', SETTLEMENT_HEADERS.length)
  const cols =
    tab === 'summary'
      ? summaryCols
      : tab === 'items'
        ? itemCols
        : tab === 'returns'
          ? returnCols
          : tab === 'credit'
            ? creditCols
            : exchangeCols

  const [report, setReport] = useState<SaleReportResult>({ rows: [], totals: emptyTotals(), groups: [] })
  const [items, setItems] = useState<SaleItemReportRow[]>([])
  const [returns, setReturns] = useState<any[]>([])
  /**
   * جلسه ۴۳ · کار ب — «معلق برگشتی»، فقط در سه تبی که واقعاً نشانش می‌دهند.
   * بازه‌ی تاریخِ گزارش را **نمی‌گیرد** (همان تصمیم پنل مدیر در جلسه ۴۲): کالای
   * معلقِ سه ماه پیش هم امروز روی قفسه است و پنهان کردنش همان مشکل اصلی است.
   * هیچ عددِ مالی این صفحه به آن وابسته نیست؛ فقط ستون و هشدار.
   */
  const pending = usePendingRestock(tab === 'returns' || tab === 'exchanges' || tab === 'summary')
  /**
   * بند ۱۰ — تیکِ «تعویض‌ها را هم نشان بده»، عمداً **خاموش به پیش‌فرض**. تب برگشت
   * فقط `kind=RETURN` می‌گیرد؛ هیچ تعویضی نباید در گزارش برگشت ساده دیده شود.
   */
  const [includeExchanges, setIncludeExchanges] = useState(false)
  /** بند ۵ — تعداد کل هر جدول در برابر سقف نمایشش (کانال sale:report:limits) */
  const [limits, setLimits] = useState<any | null>(null)
  /** تب «تعویض کالا» — از IPC.saleExchangeList (ExchangeReportResult) */
  const [exchanges, setExchanges] = useState<ExchangeReportResult>(emptyExchange())
  /** تب «نسیه» (بخش ۷) — از IPC.saleCreditList (CreditReportResult) */
  const [credit, setCredit] = useState<CreditReportResult>(emptyCredit())
  /** فاکتورهای تسویه‌شده‌ی همین بازه هم در فهرست بدهکاران بیایند؟ (پیش‌فرض: نه) */
  const [includeSettled, setIncludeSettled] = useState(false)
  /**
   * بند ۷ — ردیف‌های *فعال* بلوک خلاصه. پیش‌فرض: همه روشن (گزارش کامل و صادق).
   * برداشتن هر تیک، همان ردیف را از نمایش و از محاسبه‌ی خالص بیرون می‌برد.
   */
  const [summaryOn, setSummaryOn] = useState<SummaryPartKey[]>([...ALL_SUMMARY_PARTS])
  /** پنجره‌ی «پرداختی‌ها / اقساط» برای ثبت پرداختی نسیه‌ی یک فاکتور */
  const [paymentsFor, setPaymentsFor] = useState<number | null>(null)
  /** کلیک ستون اعتبار، مسیر mutation پرداختی‌ها نیست؛ فقط تاریخچهٔ امن را می‌بیند. */
  const [creditSettlementFor, setCreditSettlementFor] = useState<number | null>(null)
  /** نشست ۳۱۸ — نمای تشخیص پل تطبیق؛ باز-بسته شدن آن هیچ‌وقت گزارش را بازنمی‌خواند. */
  const [bridgeDiagOpen, setBridgeDiagOpen] = useState(false)
  const openBridgeDiag = useCallback(() => setBridgeDiagOpen(true), [])
  const [methods, setMethods] = useState<{ id: number; label: string; kind?: string | null }[]>([])
  /**
   * قفل مستقل تب نسیه: تا باز نشده، حتی *خوانده* هم نمی‌شود (نه فقط پنهان
   * نمایش داده شود) — فهرست بدهکاران داده‌ی حساسی است.
   */
  /** قفل خاموش هم باید دادهٔ نسیه را بخواند؛ تا خواندن policy همچنان fail-closed است. */
  const creditOpen = usePanelOpen(PANEL_KEYS.salesCredit)
  const currentReportKey = useMemo(
    () => reportDataKey(tab, filters, { includeExchanges, includeSettled, chequeDateMode, creditOpen }),
    [tab, filters, includeExchanges, includeSettled, chequeDateMode, creditOpen]
  )
  const outputDirty = loadedReportKey !== currentReportKey || (tab === 'credit' && !creditOpen)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 6000)
  }

  const load = useCallback(async (overrides: Record<string, unknown> = {}) => {
    if (!isValidJalaliDate(filters.fromJalali) || !isValidJalaliDate(filters.toJalali))
      return setErr('بازه‌ی تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
    setBusy(true)
    setErr(null)
    setLoadedReportKey(null)
    try {
      const f = { ...toServiceFilter(filters), ...overrides }
      const requestedReportKey = reportDataKey(tab, filters, {
        includeExchanges,
        includeSettled,
        chequeDateMode,
        creditOpen
      })
      /**
       * بند ۵ — «هیچ گزارشی بی‌صدا ناقص نمی‌شود». فقط `count()` می‌زند و هیچ
       * داده‌ای را عوض نمی‌کند؛ نتیجه‌اش نوار قرمز «نمایش N از M ردیف» است.
       */
      // ممیزی A99-04 — شمارنده‌ی چک همان مبنای تاریخ جدول چک را می‌گیرد
      // ممیزی A105-01 — شمارنده‌ی نسیه همان تیک «تسویه‌شده‌ها»ی جدول را می‌گیرد
      call<any>(CH.saleReportLimits, { ...f, includeExchanges, includeSettled, dateMode: chequeDateMode })
        .then(setLimits)
        .catch(() => setLimits(null))
      /**
       * جلسه ۱۸ — سه تب تازه داده‌ی خودشان را *درون خودشان* می‌خوانند (هر کدام
       * فیلتر و قفل مستقل خودش را دارد)، پس این تابع برایشان هیچ درخواستی
       * نمی‌فرستد و هیچ‌کدام از حالت‌های تب‌های قبلی را هم دست نمی‌زند.
       */
      if (tab === 'cardTransfers' || tab === 'staff' || tab === 'outOfShift' || tab === 'overrideSessions') return
      // جلسه ۲۴ — تب «مدیریت اعتبار» هم داده‌اش را درون خودش می‌خواند (قفل و فیلتر مستقل)
      if (tab === 'creditManagement') return
      if (tab === 'receiptGaps') return
      // ---------------- جلسه ۱۵: چهار تب تازه ----------------
      if (tab === 'cheques') setCheques(await call<any>(CH.saleChequeList, { ...f, dateMode: chequeDateMode }))
      else if (tab === 'storeCredits') setStoreCredits(await call<any>(CH.storeCreditList, f))
      else if (tab === 'ledger') setLedger(await call<any>(CH.saleReportLedger, f))
      else if (tab === 'fraud') setFraud(await call<any>(CH.saleFraudReview, f))
      else if (tab === 'summary') setReport(await call<SaleReportResult>(CH.saleReportRows, f))
      else if (tab === 'items') {
        /**
         * بند ۷ — بلوک خلاصه باید در تب «جزئیات فروش» هم باشد، ولی ردیف‌های قلمی
         * عوارض/حق سرویس/نسیه‌ی *سطح فاکتور* را ندارند. پس همان جمع‌های سرجمع هم
         * با **همان فیلتر** خوانده می‌شود تا دو تب هیچ‌وقت دو عدد متفاوت ندهند.
         */
        const [rows, summary] = await Promise.all([
          call<SaleItemReportRow[]>(CH.saleReportItems, f),
          call<SaleReportResult>(CH.saleReportRows, f)
        ])
        setItems(rows)
        setReport(summary)
      } else if (tab === 'returns')
        setReturns(
          await call<any[]>(CH.saleReturnList, {
            ...f,
            // بند ۱۰ — پیش‌فرض: فقط برگشت ساده (تعویض‌ها با تیک صریح می‌آیند)
            includeExchanges
          })
        )
      else if (tab === 'credit') {
        // تا قفل تب نسیه باز نشده، هیچ درخواستی فرستاده نمی‌شود
        if (!creditOpen) setCredit(emptyCredit())
        else
          setCredit(
            await call<CreditReportResult>(CH.saleCreditList, {
              ...f,
              includeSettled,
            })
          )
      } else
        setExchanges(
          await call<ExchangeReportResult>(CH.saleExchangeList, {
            ...f
          })
        )
      setAppliedFilters({ ...filters, channels: [...filters.channels] })
      setLoadedReportKey(requestedReportKey)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [filters, tab, creditOpen, includeSettled, includeExchanges, chequeDateMode])

  /**
   * بند ۶ و ۷ — «فیلتر پویا»: عوض شدن تب، قفل نسیه، چک‌باکس تسویه‌شده‌ها و
   * چک‌باکس‌های تکی/عمده، گزارش را *همان لحظه* دوباره می‌گیرند. بقیه‌ی فیلترها
   * (تاریخ، مشتری، …) مثل قبل با دکمه‌ی «تهیه گزارش» اعمال می‌شوند تا تایپ کردن
   * در فیلد جستجو صد بار کوئری نزند.
   */
  const channelsKey = (filters.channels ?? []).slice().sort().join(',')
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, creditOpen, includeSettled, includeExchanges, channelsKey, chequeDateMode])

  // روش‌های پرداخت، برای پنجره‌ی «ثبت پرداختی نسیه»
  useEffect(() => {
    call<{ id: number; label: string; kind?: string | null }[]>(CH.paymentMethods)
      // کار الف: `kind` هم لازم است تا کادر «مقصد پول» گزینه‌های ناسازگار را نشان ندهد
      .then((list) => setMethods((list ?? []).map((m) => ({ id: m.id, label: m.label, kind: m.kind ?? null }))))
      .catch(() => setMethods([]))
  }, [])

  useEffect(() => {
    if (tab !== 'receiptGaps') return
    let cancelled = false
    setBusy(true)
    setErr(null)
    call<NonNullable<typeof receiptGaps>>(CH.saleReceiptGaps)
      .then((r) => {
        if (!cancelled) setReceiptGaps(r)
      })
      .catch((e: any) => {
        if (!cancelled) setErr(e?.message ?? String(e))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab])

  const t = report.totals

  /**
   * مورد ۲ — دو عدد پایین جدول گزارش، تا نیازی به حساب دستی نباشد:
   *   • «جمع کل تخفیف‌ها» = جمع ستون تخفیفِ همان ردیف‌هایی که نمایش داده شده‌اند.
   *   • «جمع پس از تخفیف» = جمع فروشِ پیش از تخفیف، منهای همان جمع تخفیف‌ها؛
   *     یعنی مبلغی که تخفیف از قبل در آن کسر شده است.
   * (تب سرجمع: مبنای «جمع فروش» ستون «جمع مبلغ کالا» است · تب جزئیات: قیمت
   *  واحد × تعداد هر ردیف.)
   */
  /**
   * بند ۷ — ردیف‌های بلوک خلاصه و «خالص». هر دو از یک منبع می‌آیند، پس عددِ
   * خالص هیچ‌وقت با ردیف‌های بالایش نمی‌خواند نباشد.
   */
  const summary = useMemo(() => {
    const parts = summaryParts(t)
    const active = parts.filter((p) => summaryOn.includes(p.key))
    const net = active.reduce((s, p) => s + p.sign * p.value, 0)
    /**
     * «پولی که باید همین حالا در صندوق و کارت‌خوان باشد»: فقط پول *واقعاً
     * دریافت‌شده*. عمداً از ردیف‌های بالا مستقل است و با تیک‌ها عوض نمی‌شود، چون
     * یک واقعیت فیزیکی است نه یک سناریو.
     */
    const cardTotal = cardOnlyOf(t)
    /** کار الف — دو عددی که هرگز نباید داخل «کارت» پنهان شوند */
    const managerTotal = managerAccountOf(t)
    const unknownTotal = otherOrUnknownOf(t)
    /**
     * نشست ۱۸۷ — قبلاً `returnedTotal` (ارزش کالا) کم می‌شد. اگر بابت برگشت اعتبار
     * صادر شده باشد نقد از کشو نرفته؛ کم کردن ارزش کالا کسری دروغ می‌ساخت و
     * دزدی نقد را با گزارش هم‌خوان می‌کرد. فقط بازپرداخت نقد/کارت واقعی کم می‌شود.
     */
    const realCash = physicalMoneyInDrawerAndCard({
      receivedTotal: t.receivedTotal,
      priorSettlementTotal: t.priorSettlementTotal,
      refundCashTotal: t.refundCashTotal,
      refundCardTotal: t.refundCardTotal
    })
    /** بخش‌هایی از «تسویه‌شده»ها که پول نقد نیستند و نباید در کارت‌خوان جست */
    const nonCash = t.exchangeCreditTotal + t.storeCreditUsedTotal
    const creditRefundTotal = t.storeCreditRefundTotal ?? 0
    const creditUsedTotal = t.storeCreditUsedTotal ?? 0
    return { parts, active, net, cardTotal, managerTotal, unknownTotal, realCash, nonCash, creditRefundTotal, creditUsedTotal }
  }, [t, summaryOn])

  const discountSummary = useMemo(() => {
    const grossItems = items.reduce((s, i) => s + i.unitPrice * i.qty, 0)
    const discItems = items.reduce((s, i) => s + i.discount, 0)
    return {
      summaryDiscount: t.discountTotal,
      summaryAfterDiscount: Math.max(0, t.goodsTotal - t.discountTotal),
      itemsGross: grossItems,
      itemsDiscount: discItems,
      itemsAfterDiscount: Math.max(0, grossItems - discItems)
    }
  }, [t.discountTotal, t.goodsTotal, items])

  /**
   * سرصفحه‌ی چاپ و اکسل: بازه + *وضعیت فیلتر تکی/عمده*. بدون این، یک گزارش
   * چاپ‌شده‌ی «فقط عمده» از یک گزارش کامل قابل تشخیص نبود — و همین یک خط، جلوی
   * اشتباه‌های حسابداری را می‌گیرد.
   */
  /**
   * جلسه ۵۳ · مرحله ۴ — «مبدأ کسر» فاکتورهای *همین بازه*. فقط خواندنی و فقط در
   * تب سرجمع. تفکیک شیفت هم از همین نقشه می‌خواند، پس جدول، چاپ A4 و اکسل یک
   * متن دارند.
   */
  const stockSources = useSaleStockSources(
    report.rows.map((r) => r.id),
    tab === 'summary'
  )

  const rangeText = `از ${appliedFilters.fromJalali} تا ${appliedFilters.toJalali}`
  const metaText = `${rangeText} · نوع فروش: ${channelsLabel(appliedFilters.channels)}`

  /**
   * نشست ۱۲۱ · خروجی صفحه‌بندی‌شده نباید بی‌علامت صادر شود.
   * چاپ و Excel فعلاً همان صفحه‌ی دیده‌شده را می‌برند؛ بنابراین metadata
   * endpoint باید روی خودِ کاغذ/فایل هم بیاید، نه فقط روی جدول صفحه.
   */
  const outputMetaText = (() => {
    const pageOf = (value: any) => (value && typeof value === 'object' ? value.page : undefined)
    const rowsOf = (value: any) => (Array.isArray(value) ? value.length : Array.isArray(value?.rows) ? value.rows.length : 0)
    const page =
      tab === 'summary'
        ? report.page
        : tab === 'items'
          ? pageOf(items)
          : tab === 'returns'
            ? pageOf(returns)
            : tab === 'exchanges'
              ? exchanges.page
              : tab === 'credit'
                ? credit.page
                : tab === 'cheques'
                  ? pageOf(cheques)
                  : tab === 'storeCredits'
                    ? pageOf(storeCredits)
                    : undefined
    const rowsShown =
      tab === 'summary'
        ? report.rows.length
        : tab === 'items'
          ? shownInvoiceUnits(items)
          : tab === 'returns'
            ? returns.length
            : tab === 'exchanges'
              ? exchanges.rows.length
              : tab === 'credit'
                ? credit.rows.length
                : tab === 'cheques'
                  ? rowsOf(cheques)
                  : tab === 'storeCredits'
                    ? rowsOf(storeCredits)
                    : 0
    const notes: string[] = []
    const noun = tab === 'items' ? 'فاکتور' : 'ردیف'
    if (page?.truncated) {
      notes.push(
        `هشدار خروجی: این چاپ/فایل فقط صفحه‌ی جاری است؛ نمایش ${faDigits(rowsShown)} از ${faDigits(page.totalCount)} ${noun}.`
      )
      notes.push('جمع مبلغ ردیف‌های فایل فقط همین صفحه است؛ جمع کل بازه را فقط از جمع مستقل endpoint بخوانید.')
    } else if (page && page.skip > 0) {
      // ممیزی A121-01 — صفحه‌ی آخر هم باید روی کاغذ/فایل بگوید کل گزارش نیست.
      notes.push(...outputLastPageNotes(page, rowsShown, noun))
    }
    const rangeNote = outputPageRangeNote(page, rowsShown, noun)
    if (rangeNote) notes.push(rangeNote)
    if (tab === 'ledger' && Array.isArray(ledger?.warnings)) notes.push(...ledger.warnings)
    if (tab === 'ledger' && ledger?.sections) {
      for (const section of Object.values(ledger.sections) as any[]) {
        if (section?.truncated && section.totalCount != null)
          notes.push(`دفتر رویداد: این خروجی از ${faDigits(section.totalCount)} سند، فقط صفحه‌ی جاری را دارد.`)
      }
    }
    if (tab === 'fraud') {
      const truncated = (fraud?.flags ?? []).filter((f: any) => f?.sourcesTruncated)
      for (const flag of truncated)
        notes.push(
          `ضدتقلب: از ${faDigits(flag.sourcesTotal ?? 0)} سند منبعِ «${fraudGroupLabel(flag)}»، ` +
            `فقط ${faDigits(flag.sources?.length ?? 0)} سند در چاپ/فایل آمده است؛ مبلغ هشدار بر اساس کل اسناد است.`
        )
    }
    const unique = [...new Set(notes.filter(Boolean))]
    return unique.length ? `${metaText} · ${unique.join(' · ')}` : metaText
  })()

  const fraudGroupsOf = (value: any): any[] =>
    Array.isArray(value?.flags)
      ? value.flags
      : Array.isArray(value?.groups)
        ? value.groups
        : Array.isArray(value?.sections)
          ? value.sections
          : Array.isArray(value?.rows)
            ? [{ title: 'موارد قابل بازبینی', rows: value.rows }]
            : []

  const loadStockSourcesForInvoices = async (invoiceRows: SaleReportRow[]) => {
    const ids = [...new Set(invoiceRows.map((row) => row.id).filter((id): id is number => Number.isFinite(id) && id > 0))]
    const sourceMap: Record<string, { lines: string[]; short: string }> = {}
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500)
      const part = await call<Record<string, { lines: string[]; short: string }>>(CH.saleStockSourcesMany, {
        invoiceIds: chunk
      })
      Object.assign(sourceMap, part ?? {})
    }
    return sourceMap
  }

  const outputMetaFor = (scope: OutputScope, rowCount: number, warnings: string[]) => {
    if (scope === 'page') return outputMetaText
    const notes = [
      metaText,
      `خروجی کامل فیلترشده: ${faDigits(rowCount)} ردیف`,
      ...warnings.filter(Boolean)
    ]
    return [...new Set(notes)].join(' · ')
  }

  /**
   * خروجی کامل را هنگام کلیک می‌خوانیم، نه هنگام نمایش جدول. این کار هم جدول
   * را سبک نگه می‌دارد و هم تضمین می‌کند فیلترِ snapshot‌شده‌ی آخرین اجرای موفق
   * مبنای تمام صفحه‌های چاپ/Excel باشد.
   */
  const prepareOutputSnapshot = async (): Promise<ReportOutputSnapshot> => {
    const pageSnapshot: ReportOutputSnapshot = {
      meta: outputMetaText,
      summaryRows: report.rows,
      itemRows: items,
      returnRows: returns,
      exchangeRows: exchanges.rows,
      exchangeTotals: exchanges.totals,
      creditRows: credit.rows,
      priorSettlements: credit.priorSettlements,
      creditTotals: credit.totals,
      chequeRows: rowsFromListResponse<any>(cheques),
      storeCreditRows: rowsFromListResponse<any>(storeCredits),
      ledgerRows: Array.isArray(ledger?.rows) ? ledger.rows : [],
      fraudGroups: fraudGroupsOf(fraud),
      stockSourceShort: stockSources.shortOf
    }
    if (outputScope === 'page') return pageSnapshot

    const serviceFilter = toServiceFilter(appliedFilters)
    const warnings: string[] = []
    let summaryRows = pageSnapshot.summaryRows
    let itemRows = pageSnapshot.itemRows
    let returnRows = pageSnapshot.returnRows
    let exchangeRows = pageSnapshot.exchangeRows
    let exchangeTotals = pageSnapshot.exchangeTotals
    let creditRows = pageSnapshot.creditRows
    let priorSettlements = pageSnapshot.priorSettlements
    let creditTotals = pageSnapshot.creditTotals
    let chequeRows = pageSnapshot.chequeRows
    let storeCreditRows = pageSnapshot.storeCreditRows
    let ledgerRows = pageSnapshot.ledgerRows
    let fraudGroups = pageSnapshot.fraudGroups
    let stockSourceShort = pageSnapshot.stockSourceShort

    if (tab === 'summary') {
      const all: ReadAllPagedResult<SaleReportRow> = await readAllReportPages(
        (skip, take) => call<SaleReportResult>(CH.saleReportRows, { ...serviceFilter, skip, take }),
        (response) => response?.rows ?? [],
        (response) => pageOfOutput(response)
      )
      summaryRows = all.rows
      warnings.push(...all.warnings)
      try {
        const sourceMap = await loadStockSourcesForInvoices(summaryRows)
        stockSourceShort = (invoiceId) => (invoiceId == null ? '' : sourceMap[String(invoiceId)]?.short ?? '')
      } catch (e: any) {
        warnings.push(`مبدأ کسر انبار برای خروجی کامل خوانده نشد: ${e?.message ?? 'خطای نامشخص'}`)
        stockSourceShort = () => ''
      }
    } else if (tab === 'items') {
      const all: ReadAllPagedResult<SaleItemReportRow> = await readAllReportPages(
        (skip, take) => call<SaleItemReportRow[]>(CH.saleReportItems, { ...serviceFilter, skip, take }),
        (response) => rowsFromListResponse<SaleItemReportRow>(response),
        (response) => pageOfOutput(response)
      )
      itemRows = all.rows
      warnings.push(...all.warnings)
    } else if (tab === 'returns') {
      const all: ReadAllPagedResult<any> = await readAllReportPages(
        (skip, take) =>
          call<any[]>(CH.saleReturnList, { ...serviceFilter, skip, take, includeExchanges }),
        (response) => rowsFromListResponse<any>(response),
        (response) => pageOfOutput(response)
      )
      returnRows = all.rows
      warnings.push(...all.warnings)
    } else if (tab === 'exchanges') {
      const all: ReadAllPagedResult<ExchangeReportResult['rows'][number]> = await readAllReportPages(
        (skip, take) => call<ExchangeReportResult>(CH.saleExchangeList, { ...serviceFilter, skip, take }),
        (response) => response?.rows ?? [],
        (response) => pageOfOutput(response)
      )
      exchangeRows = all.rows
      exchangeTotals = exchangeTotalsFromRows(exchangeRows)
      warnings.push(...all.warnings)
    } else if (tab === 'credit') {
      const all: ReadAllPagedResult<CreditReportResult['rows'][number]> = await readAllReportPages(
        (skip, take) =>
          call<CreditReportResult>(CH.saleCreditList, {
            ...serviceFilter,
            skip,
            take,
            includeSettled,
            priorSkip: 0,
            priorTake: 1
          }),
        (response) => response?.rows ?? [],
        (response) => pageOfOutput(response)
      )
      const allPrior: ReadAllPagedResult<CreditReportResult['priorSettlements'][number]> = await readAllReportPages(
        (skip, take) =>
          call<CreditReportResult>(CH.saleCreditList, {
            ...serviceFilter,
            skip: 0,
            take: 1,
            includeSettled,
            priorSkip: skip,
            priorTake: take
          }),
        (response) => response?.priorSettlements ?? [],
        (response) => pageOfOutput(response, 'priorPage')
      )
      creditRows = all.rows
      priorSettlements = allPrior.rows
      creditTotals = creditTotalsFromRows(creditRows, priorSettlements)
      warnings.push(...all.warnings, ...allPrior.warnings)
    } else if (tab === 'cheques') {
      const all: ReadAllPagedResult<any> = await readAllReportPages(
        (skip, take) =>
          call<any>(CH.saleChequeList, { ...serviceFilter, skip, take, dateMode: chequeDateMode }),
        (response) => rowsFromListResponse<any>(response),
        (response) => pageOfOutput(response)
      )
      chequeRows = all.rows
      warnings.push(...all.warnings)
    } else if (tab === 'storeCredits') {
      const all: ReadAllPagedResult<any> = await readAllReportPages(
        (skip, take) => call<any>(CH.storeCreditList, { ...serviceFilter, skip, take }),
        (response) => rowsFromListResponse<any>(response),
        (response) => pageOfOutput(response)
      )
      storeCreditRows = all.rows
      warnings.push(...all.warnings)
    } else if (tab === 'ledger') {
      const full = await call<any>(CH.saleReportLedger, { ...serviceFilter, fullRange: true })
      ledgerRows = Array.isArray(full?.rows) ? full.rows : []
      warnings.push(...(Array.isArray(full?.warnings) ? full.warnings : []))
    } else if (tab === 'fraud') {
      const full = await call<any>(CH.saleFraudReview, { ...serviceFilter, allSources: true })
      fraudGroups = fraudGroupsOf(full)
      warnings.push(...(Array.isArray(full?.notes) ? full.notes : []), ...(Array.isArray(full?.warnings) ? full.warnings : []))
    }

    const rowCount =
      tab === 'summary'
        ? summaryRows.length
        : tab === 'items'
          ? itemRows.length
          : tab === 'returns'
            ? returnRows.length
            : tab === 'exchanges'
              ? exchangeRows.length
              : tab === 'credit'
                ? creditRows.length + priorSettlements.length
                : tab === 'cheques'
                  ? chequeRows.length
                  : tab === 'storeCredits'
                    ? storeCreditRows.length
                    : tab === 'ledger'
                      ? ledgerRows.length
                      : fraudGroups.reduce(
                          (sum, group) =>
                            sum +
                            (Array.isArray(group?.rows)
                              ? group.rows.length
                              : Array.isArray(group?.items)
                                ? group.items.length
                                : Array.isArray(group?.sources)
                                  ? group.sources.length
                                  : 0),
                          0
                        )

    return {
      meta: outputMetaFor('all', rowCount, warnings),
      summaryRows,
      itemRows,
      returnRows,
      exchangeRows,
      exchangeTotals,
      creditRows,
      priorSettlements,
      creditTotals,
      chequeRows,
      storeCreditRows,
      ledgerRows,
      fraudGroups,
      stockSourceShort
    }
  }

  /**
   * بند ۷ — ردیف‌های *فعال* بلوک خلاصه، به شکل «برچسب / مقدار» برای چاپ A4 و
   * چاپ حرارتی. ردیف‌های کنارگذاشته‌شده عمداً چاپ نمی‌شوند تا کاغذ عیناً همان
   * چیزی باشد که روی صفحه دیده شده است.
   */
  const summaryPrintLines = () => [
    ...summary.active.map((p) => ({
      label: p.label,
      value: `${p.sign < 0 ? '−' : '+'}${money(p.value)}`
    })),
    { label: 'خالص', value: money(summary.net), bold: true },
    {
      label:
        `کنترل کارت‌خوان و صندوق — نقدی ${money(t.cashTotal)} · کارت ${money(summary.cardTotal)} · ` +
        `اعتباری ${money(t.creditTotal)} ⇒ ${money(summary.realCash)} ریال باید در صندوق و کارت‌خوان باشد.` +
        // کار الف: این دو عدد عمداً بیرون از «باید در صندوق و کارت‌خوان باشد» گزارش می‌شوند
        (summary.managerTotal > 0
          ? ` · ${MANAGER_ACCOUNT_ROW_LABEL} ${money(summary.managerTotal)} ریال — ${MANAGER_ACCOUNT_ROW_NOTE}.`
          : '') +
        (summary.unknownTotal > 0
          ? ` · دریافتی با مقصد نامشخص/سایر ${money(summary.unknownTotal)} ریال — برای این مبلغ هیچ حدسی زده نشده است.`
          : '') +
        (summary.creditRefundTotal > 0
          ? ` · ${money(summary.creditRefundTotal)} ریال بارکد اعتبار بابت برگشت/تعویض صادر شده (از صندوق بیرون نرفته).`
          : '') +
        (summary.creditUsedTotal > 0
          ? ` · ${money(summary.creditUsedTotal)} ریال فروش با بارکد اعتبار تسویه شده (نقد وارد صندوق نشده؛ کسری نیست` +
            ((report.accounting?.storeCredits?.usedStories ?? []).length
              ? `؛ ${faDigits((report.accounting?.storeCredits?.usedStories ?? []).length)} مصرف اعتبار — روی صفحه با + باز می‌شود`
              : '') +
            ').'
          : '') +
        (summary.nonCash > 0 ? ` (${money(summary.nonCash)} ریال از تسویه‌ها پول نقد نبوده است)` : ''),
      value: '',
      note: true
    }
  ]

  const printA4 = async () => {
    if (printBusyRef.current) return
    printBusyRef.current = true
    setPrintBusy(true)
    try {
      const output = await prepareOutputSnapshot()
      if (tab === 'summary') {
        await call(CH.printA4, {
          title: 'گزارش سرجمع فروش',
          meta: output.meta,
          headers: SUMMARY_HEADERS,
          rows: output.summaryRows.map((r) =>
            summaryRowValues(r, output.stockSourceShort(r.id)).map((v) => (typeof v === 'number' ? money(v) : v))
          ),
          totals: [
            'جمع',
            '',
            '',
            '',
            `${faDigits(t.count)} فاکتور`,
            '',
            '',
            money(t.goodsTotal),
            money(t.taxTotal),
            money(t.serviceTotal),
            money(t.discountTotal),
            money(t.deliveryTotal),
            money(t.grandTotal),
            money(t.cashTotal),
            money(t.storeCreditUsedTotal),
            ...destinationCells(t).map((v) => money(v)),
            '',
            // جلسه ۵۳ — ستون «مبدأ کسر» جمع ندارد (متن است، نه عدد)
            ''
          ],
          // بند ۷ — بلوک خلاصه، زیر جدول چاپ‌شده
          summary: summaryPrintLines()
        })
      } else if (tab === 'items') {
        await call(CH.printA4, {
          title: 'گزارش جزئیات فروش',
          meta: output.meta,
          summary: summaryPrintLines(),
          headers: ['شماره فیش', 'تاریخ', 'ساعت', 'شیفت', 'کد', 'نام کالا', 'تعداد', 'قیمت واحد', 'تخفیف', 'جمع', 'برگشتی', 'مبلغ برگشتی', 'خالص'],
          rows: output.itemRows.map((i) => [
            faDigits(i.receiptNo),
            faDigits(i.dateJalali),
            faDigits(i.time),
            i.shiftName,
            faDigits(i.code),
            i.name,
            faDigits(i.qty),
            money(i.unitPrice),
            money(i.discount),
            money(i.lineTotal),
            faDigits(i.returnedQty),
            money(i.returnedAmount ?? 0),
            money(i.netAmount ?? Math.max(0, i.lineTotal - (i.returnedAmount ?? 0)))
          ])
        })
      } else if (tab === 'credit') {
        await call(CH.printA4, {
          title: 'گزارش نسیه (فهرست بدهکاران)',
          meta: output.meta,
          headers: CREDIT_HEADERS,
          rows: output.creditRows.map((r) => creditRowValues(r).map((v) => (typeof v === 'number' ? money(v) : v))),
          totals: [
            'جمع',
            `${faDigits(output.creditTotals.count)} فاکتور`,
            '',
            '',
            '',
            '',
            money(output.creditTotals.grandTotal),
            money(output.creditTotals.paidTotal),
            money(output.creditTotals.remainingTotal),
            '',
            money(output.creditTotals.pendingChequeTotal),
            '',
            '',
            '',
            money(output.creditTotals.overpayTotal),
            '',
            '',
            ''
          ]
        })
      } else if (tab === 'exchanges') {
        await call(CH.printA4, {
          title: 'گزارش تعویض کالا',
          meta: output.meta,
          headers: EXCHANGE_HEADERS,
          rows: output.exchangeRows.map((r) =>
            exchangeRowValues(r, pending.qtyOfReturn(r.returnId)).map((v) => (typeof v === 'number' ? money(v) : v))
          ),
          totals: [
            'جمع',
            `${faDigits(output.exchangeTotals.count)} تعویض`,
            '',
            '',
            '',
            '',
            '',
            money(output.exchangeTotals.returnTotal),
            // کار ب — جمع ستون «معلق برگشتی» (تعداد کالا، نه ریال)
            faDigits(output.exchangeRows.reduce((sum, r) => sum + pending.qtyOfReturn(r.returnId), 0)),
            '',
            money(output.exchangeTotals.exchangeTotal),
            '',
            money(output.exchangeTotals.diffTotal),
            '',
            money(output.exchangeTotals.cashReceivedTotal),
            money(output.exchangeTotals.cardReceivedTotal),
            '',
            money(output.exchangeTotals.creditIssuedTotal),
            ''
          ]
        })
      } else if (tab === 'cheques') {
        await call(CH.printA4, {
          title: 'گزارش چک‌ها',
          meta: output.meta,
          headers: ['شماره فیش', 'شماره چک', 'تاریخ ثبت', 'سررسید', 'تاریخ پاس‌شدن', 'وضعیت', 'مبلغ', 'تاریخچه وضعیت چک'],
          rows: output.chequeRows.map((r: any) => [
            faDigits(r.receiptNo ?? '—'),
            faDigits(r.chequeNo ?? '—'),
            faDigits(r.dateJalali ?? '—'),
            faDigits(r.dueDateJalali ?? '—'),
            faDigits(r.clearedAtJalali ?? '—'),
            (r.chequeStatusLabel ?? r.chequeStatus ?? '—') + (r.chequeNeedsReview ? ' · ⚠️ نیاز به بازبینی' : ''),
            money(Number(r.amount ?? 0)),
            r.chequeHistoryText ?? '—'
          ])
        })
      } else if (tab === 'ledger') {
        await call(CH.printA4, {
          title: 'دفتر رویداد فروش',
          meta: output.meta,
          headers: ['تاریخ', 'ساعت', 'رویداد', 'شماره فیش', 'مبلغ', 'اثر نقدی', 'اثر انبار', 'توضیح'],
          rows: output.ledgerRows.map((r: any) => [
            faDigits(r.dateJalali ?? '—'),
            faDigits(r.time ?? '—'),
            r.eventLabel ?? r.eventType ?? '—',
            faDigits(r.receiptNo ?? '—'),
            money(Number(r.amount ?? 0)),
            money(Number(r.cashEffect ?? 0)),
            faDigits(r.stockEffect ?? 0),
            r.cashNote ?? r.note ?? '—'
          ])
        })
      } else if (tab === 'storeCredits') {
        await call(CH.printA4, {
          title: `گزارش اعتبار خرید — ${STORE_CREDIT_NOT_CASHABLE_TITLE}`,
          meta: output.meta,
          headers: STORE_CREDIT_OUTPUT_HEADERS,
          rows: output.storeCreditRows.map((r: any) => [
            r.publicReference ?? `اعتبار #${r.id ?? '—'}`,
            faDigits(r.sourceReceiptNo ?? r.receiptNo ?? '—'),
            faDigits(r.issuedAtJalali ?? r.dateJalali ?? '—'),
            faDigits(r.expiresAtJalali ?? '—'),
            r.statusLabel ?? r.status ?? '—',
            money(Number(r.amount ?? r.total ?? 0)),
            money(Number(r.usedAmount ?? r.redeemedAmount ?? 0)),
            money(creditOutstandingOf(r)),
            faDigits(r.usedAtJalali ?? '—'),
            r.sourceLabel ?? r.source ?? '—'
          ])
        })
      } else if (tab === 'fraud') {
        // ممیزی A94-02 — شرح سند (label) و پرچم‌های بدون سند منبع (مثل «چک برگشتی») دیگر حذف نمی‌شوند
        const fraudRows = fraudOutputRows(output.fraudGroups, (g) => fraudGroupLabel(g)).map((r) => [
          r.group,
          r.severity || '—',
          faDigits(r.dateJalali ?? '—'),
          faDigits(r.time ?? '—'),
          faDigits(r.receiptNo ?? '—'),
          r.userName ?? '—',
          money(r.amount),
          r.note ?? '—'
        ])
        await call(CH.printA4, {
          title: 'گزارش بازبینی ضدتقلب',
          meta: output.meta,
          headers: ['گروه', 'شدت', 'تاریخ', 'ساعت', 'شماره فیش', 'کاربر', 'مبلغ', 'توضیح'],
          rows: fraudRows
        })
      } else if (tab === 'returns') {
        await call(CH.printA4, {
          title: 'گزارش برگشت از فروش',
          meta: output.meta,
          headers: RETURN_HEADERS,
          rows: output.returnRows.map((r) => [
            faDigits(r.receiptNo ?? '—'),
            r.returnCode ?? '—',
            faDigits(r.invoiceDateJalali),
            faDigits(r.returnedAtJalali),
            faDigits(r.time),
            r.customerName,
            r.isExchange ? 'تعویض کالا' : 'برگشت ساده',
            r.isFull ? 'کامل' : 'جزئی',
            faDigits(r.qty),
            money(r.total),
            r.refundMethodLabel ?? '—',
            money(r.cashRefundAmount ?? 0),
            r.storeCreditReference ?? '—',
            money(returnCreditAmountOf(r)),
            faDigits(r.restockedQty),
            faDigits(r.pendingRestockQty ?? 0),
            r.invoiceUserName ?? '—',
            r.returnUserName ?? '—',
            r.items.map((i: any) => `${i.name} (${faDigits(i.qty)})`).join(' · ')
          ])
        })
      } else {
        /**
         * نشست ۲۰۹ — قبلاً هر تب بدون شاخه (کارمند / خارج از شیفت / کارت‌به‌کارت /
         * نشست override / شماره‌های جاافتاده) بی‌صدا گزارش برگشت چاپ می‌کرد.
         */
        flash('برای این تب چاپ A4 از نوار پایین تعریف نشده است.')
        return
      }
      flash('گزارش برای چاپ A4 فرستاده شد')
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printBusyRef.current = false
      setPrintBusy(false)
    }
  }

  const printThermal = async () => {
    if (printBusyRef.current) return
    printBusyRef.current = true
    setPrintBusy(true)
    try {
      await call(CH.printThermalSummary, {
        title: 'سرجمع فروش',
        // ممیزی A121-02 — خطوط حرارتی همه از report.totals (جمع کل بازه) هستند و ردیفی ندارند؛
        // هشدار «فقط صفحه‌ی جاری/جمع همین صفحه» روی این کاغذ دروغ بود.
        meta: `${metaText} · خلاصه و جمع‌ها بر اساس کل فیلترشده`,
        lines: [
          { label: 'تعداد فاکتور', value: faDigits(t.count) },
          { label: 'جمع مبلغ کالا', value: money(t.goodsTotal) },
          { label: 'عوارض و مالیات', value: money(t.taxTotal) },
          { label: 'حق سرویس', value: money(t.serviceTotal) },
          { label: 'تخفیف', value: money(t.discountTotal) },
          { label: 'هزینه پیک', value: money(t.deliveryTotal) },
          { label: 'نقدی', value: money(t.cashTotal) },
          { label: 'تسویه با اعتبار خرید (غیرنقدی)', value: money(t.storeCreditUsedTotal) },
          { label: 'کارت (کارتخوان فروشگاه)', value: money(cardOnlyOf(t)) },
          // کار الف: دو ردیف جدا و صریح، حتی وقتی صفرند
          { label: MANAGER_ACCOUNT_ROW_LABEL, value: money(managerAccountOf(t)) },
          { label: 'سایر / مقصد نامشخص', value: money(otherOrUnknownOf(t)) },
          { label: 'اعتباری', value: money(t.creditTotal) },
          { label: 'برگشت از فروش', value: money(t.returnedTotal) },
          { label: 'اعتبار صادرشده بابت برگشت/تعویض', value: money(t.storeCreditRefundTotal ?? 0) },
          { label: 'اعتبار مصرف‌شده روی فروش', value: money(t.storeCreditUsedTotal ?? 0) },
          // مورد ۲: همان دو عدد پایین جدول، روی چاپ حرارتی هم می‌آید
          { label: 'جمع کل تخفیف‌ها', value: money(discountSummary.summaryDiscount) },
          { label: 'جمع پس از تخفیف', value: money(discountSummary.summaryAfterDiscount) },
          { label: 'جمع کل فروش', value: money(t.grandTotal), bold: true },
          // بند ۷ — همان بلوک خلاصه‌ی روی صفحه، روی کاغذ حرارتی هم می‌آید
          ...summaryPrintLines()
        ]
      })
      flash('گزارش حرارتی چاپ شد')
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printBusyRef.current = false
      setPrintBusy(false)
    }
  }

  const exportCsvNow = async () => {
    try {
      const output = await prepareOutputSnapshot()
      const meta = output.meta
      let res: { canceled: boolean; path: string | null }
      if (tab === 'summary')
        res = await exportTable({
          fileName: 'گزارش-سرجمع-فروش',
          sheetName: 'سرجمع فروش',
          title: `گزارش سرجمع فروش — ${meta}`,
          headers: SUMMARY_HEADERS,
          rows: output.summaryRows.map((r) => summaryRowValues(r, output.stockSourceShort(r.id))),
          totals: [
            'جمع',
            '',
            '',
            '',
            t.count,
            '',
            '',
            t.goodsTotal,
            t.taxTotal,
            t.serviceTotal,
            t.discountTotal,
            t.deliveryTotal,
            t.grandTotal,
            t.cashTotal,
            t.storeCreditUsedTotal,
            ...destinationCells(t),
            '',
            // جلسه ۵۳ — ستون «مبدأ کسر» جمع ندارد (متن است، نه عدد)
            ''
          ]
        })
      else if (tab === 'items')
        res = await exportTable({
          fileName: 'گزارش-جزئیات-فروش',
          sheetName: 'جزئیات فروش',
          title: `گزارش جزئیات فروش — ${meta}`,
          headers: ['شماره فیش', 'تاریخ', 'ساعت', 'شیفت', 'کد', 'بارکد', 'نام کالا', 'تعداد', 'قیمت واحد', 'تخفیف', 'مالیات', 'جمع', 'برگشتی', 'مبلغ برگشتی', 'خالص', 'مشتری'],
          rows: output.itemRows.map((i) => [
            i.receiptNo,
            i.dateJalali,
            i.time,
            i.shiftName,
            i.code,
            i.barcode,
            i.name,
            i.qty,
            i.unitPrice,
            i.discount,
            i.tax,
            i.lineTotal,
            i.returnedQty,
            i.returnedAmount ?? 0,
            i.netAmount ?? Math.max(0, i.lineTotal - (i.returnedAmount ?? 0)),
            i.customerName
          ])
        })
      else if (tab === 'credit')
        res = await exportTable({
          fileName: 'گزارش-نسیه-بدهکاران',
          sheetName: 'نسیه',
          title: `گزارش نسیه (فهرست بدهکاران) — ${meta}`,
          headers: CREDIT_HEADERS,
          rows: output.creditRows.map((r) => creditRowValues(r)),
          totals: [
            'جمع',
            output.creditTotals.count,
            '',
            '',
            '',
            '',
            output.creditTotals.grandTotal,
            output.creditTotals.paidTotal,
            output.creditTotals.remainingTotal,
            '',
            output.creditTotals.pendingChequeTotal,
            '',
            '',
            '',
            output.creditTotals.overpayTotal,
            '',
            '',
            ''
          ]
        })
      else if (tab === 'exchanges')
        res = await exportTable({
          fileName: 'گزارش-تعویض-کالا',
          sheetName: 'تعویض کالا',
          title: `گزارش تعویض کالا — ${meta}`,
          headers: EXCHANGE_HEADERS,
          rows: output.exchangeRows.map((r) => exchangeRowValues(r, pending.qtyOfReturn(r.returnId))),
          totals: [
            'جمع',
            output.exchangeTotals.count,
            '',
            '',
            '',
            '',
            '',
            output.exchangeTotals.returnTotal,
            output.exchangeRows.reduce((sum, r) => sum + pending.qtyOfReturn(r.returnId), 0),
            '',
            output.exchangeTotals.exchangeTotal,
            '',
            output.exchangeTotals.diffTotal,
            '',
            output.exchangeTotals.cashReceivedTotal,
            output.exchangeTotals.cardReceivedTotal,
            '',
            output.exchangeTotals.creditIssuedTotal,
            ''
          ]
        })
      else if (tab === 'cheques')
        res = await exportTable({
          fileName: 'گزارش-چک‌ها',
          sheetName: 'چک‌ها',
          title: `گزارش چک‌ها — ${meta}`,
          headers: ['شماره فیش', 'شماره چک', 'تاریخ ثبت', 'سررسید', 'تاریخ پاس‌شدن', 'وضعیت', 'مبلغ', 'تاریخچه وضعیت چک'],
          rows: output.chequeRows.map((r: any) => [
            r.receiptNo ?? '',
            r.chequeNo ?? '',
            r.dateJalali ?? '',
            r.dueDateJalali ?? '',
            r.clearedAtJalali ?? '',
            (r.chequeStatusLabel ?? r.chequeStatus ?? '') + (r.chequeNeedsReview ? ' · ⚠️ نیاز به بازبینی' : ''),
            Number(r.amount ?? 0),
            r.chequeHistoryText ?? ''
          ])
        })
      else if (tab === 'ledger')
        res = await exportTable({
          fileName: 'دفتر-رویداد-فروش',
          sheetName: 'دفتر رویداد',
          title: `دفتر رویداد فروش — ${meta}`,
          headers: ['تاریخ', 'ساعت', 'رویداد', 'شماره فیش', 'مبلغ', 'اثر نقدی', 'اثر انبار', 'توضیح'],
          rows: output.ledgerRows.map((r: any) => [
            r.dateJalali ?? '',
            r.time ?? '',
            r.eventLabel ?? r.eventType ?? '',
            r.receiptNo ?? '',
            Number(r.amount ?? 0),
            Number(r.cashEffect ?? 0),
            r.stockEffect ?? 0,
            r.cashNote ?? r.note ?? ''
          ])
        })
      else if (tab === 'storeCredits') {
        res = await exportTable({
          fileName: 'گزارش-اعتبار-خرید',
          sheetName: 'اعتبار خرید',
          title: `گزارش اعتبار خرید (${STORE_CREDIT_NOT_CASHABLE_TITLE}) — ${meta}`,
          headers: STORE_CREDIT_OUTPUT_HEADERS,
          rows: output.storeCreditRows.map((r: any) => [
            r.publicReference ?? `اعتبار #${r.id ?? ''}`,
            r.sourceReceiptNo ?? r.receiptNo ?? '',
            r.issuedAtJalali ?? r.dateJalali ?? '',
            r.expiresAtJalali ?? '',
            r.statusLabel ?? r.status ?? '',
            Number(r.amount ?? r.total ?? 0),
            Number(r.usedAmount ?? r.redeemedAmount ?? 0),
            creditOutstandingOf(r),
            r.usedAtJalali ?? '',
            r.sourceLabel ?? r.source ?? ''
          ]),
          totals: [
            'جمع',
            `${output.storeCreditRows.length} اعتبار`,
            '',
            '',
            '',
            output.storeCreditRows.reduce((s, r) => s + Number(r.amount ?? r.total ?? 0), 0),
            output.storeCreditRows.reduce((s, r) => s + Number(r.usedAmount ?? r.redeemedAmount ?? 0), 0),
            output.storeCreditRows.reduce((s, r) => s + creditOutstandingOf(r), 0),
            '',
            ''
          ]
        })
      } else if (tab === 'fraud') {
        // ممیزی A94-02 — همان ردیف‌های چاپ؛ شرح سند و پرچم بدون سند منبع حفظ می‌شوند
        const fraudRows = fraudOutputRows(output.fraudGroups, (g) => fraudGroupLabel(g, '')).map((r) => [
          r.group,
          r.severity,
          r.dateJalali ?? '',
          r.time ?? '',
          r.receiptNo ?? '',
          r.userName ?? '',
          r.amount,
          r.note ?? ''
        ])
        res = await exportTable({
          fileName: 'گزارش-بازبینی-ضدتقلب',
          sheetName: 'بازبینی ضدتقلب',
          title: `گزارش بازبینی ضدتقلب — ${meta}`,
          headers: ['گروه', 'شدت', 'تاریخ', 'ساعت', 'شماره فیش', 'کاربر', 'مبلغ', 'توضیح'],
          rows: fraudRows
        })
      }
      else if (tab === 'returns')
        res = await exportTable({
          fileName: 'گزارش-برگشت-از-فروش',
          sheetName: 'برگشت از فروش',
          title: `گزارش برگشت از فروش — ${meta}`,
          headers: RETURN_HEADERS,
          rows: output.returnRows.map((r) => [
            r.receiptNo ?? '',
            r.returnCode ?? '',
            r.invoiceDateJalali,
            r.returnedAtJalali,
            r.time,
            r.customerName,
            r.isExchange ? 'تعویض کالا' : 'برگشت ساده',
            r.isFull ? 'کامل' : 'جزئی',
            r.qty,
            r.total,
            r.refundMethodLabel ?? '',
            r.cashRefundAmount ?? 0,
            r.storeCreditReference ?? '',
            returnCreditAmountOf(r),
            r.restockedQty,
            r.pendingRestockQty ?? 0,
            r.invoiceUserName ?? '',
            r.returnUserName ?? '',
            r.items.map((i: any) => `${i.name} (${faDigits(i.qty)})`).join(' · ')
          ]),
          totals: [
            'جمع',
            '',
            '',
            '',
            '',
            '',
            '',
            `${output.returnRows.length} برگشت`,
            output.returnRows.reduce((s, r) => s + r.qty, 0),
            output.returnRows.reduce((s, r) => s + r.total, 0),
            '',
            output.returnRows.reduce((s, r) => s + (r.cashRefundAmount ?? 0), 0),
            '',
            output.returnRows.reduce((s, r) => s + returnCreditAmountOf(r), 0),
            output.returnRows.reduce((s, r) => s + r.restockedQty, 0),
            output.returnRows.reduce((s, r) => s + (r.pendingRestockQty ?? 0), 0),
            '',
            '',
            ''
          ]
        })
      else {
        /** نشست ۲۰۹ — تب‌های بدون شاخه دیگر گزارش برگشت صادر نمی‌کنند. */
        flash('برای این تب خروجی اکسل از نوار پایین تعریف نشده است.')
        return
      }
      flash(res.canceled ? 'ساخت فایل خروجی لغو شد.' : `فایل اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /** خروجی اکسل جدول دوم تب نسیه (تسویه‌ی نسیه‌ی بازه‌های قبل). */
  const exportSettlements = async () => {
    try {
      const output = await prepareOutputSnapshot()
      const res = await exportTable({
        fileName: 'گزارش-تسویه-نسیه-بازه-های-قبل',
        sheetName: 'تسویه نسیه',
        title: `تسویه‌ی نسیه‌ی بازه‌های قبل — ${output.meta}`,
        headers: SETTLEMENT_HEADERS,
        rows: output.priorSettlements.map((r) => settlementRowValues(r)),
        totals: [
          'جمع',
          `${faDigits(output.creditTotals.priorSettlementCount ?? output.priorSettlements.length)} پرداختی`,
          '',
          '',
          output.creditTotals.priorSettlementTotal,
          '',
          '',
          '',
          '',
          '',
          ''
        ]
      })
      flash(res.canceled ? 'ساخت فایل خروجی لغو شد.' : `فایل اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  /**
   * نشست ۶۵ · بند ۴-۲۲ — ابطال اتمیک کل گراف تعویض. main در یک تراکنش سند برگشت و
   * سند تعویض را با مهر «باطل» نگه می‌دارد و انبار/اعتبار/کارت‌به‌کارتِ در انتظار/
   * کاهش بدهی را برمی‌گرداند؛ اگر پول واقعاً جابه‌جا شده باشد رد می‌کند و برای
   * مدیر «رسیدگی» ثبت می‌شود.
   */
  const [exVoidTarget, setExVoidTarget] = useState<ExchangeReportResult['rows'][number] | null>(null)
  const [exVoidReason, setExVoidReason] = useState('')
  /** رمز قفل پیش‌فرض ابطال/اصلاح؛ برای دوره‌ی بسته باید رمز مدیر باشد. */
  const [exVoidAuthPassword, setExVoidAuthPassword] = useState('')
  const [exVoidApproverUserId, setExVoidApproverUserId] = useState<number | null>(null)
  const [exVoidApproverPassword, setExVoidApproverPassword] = useState('')
  const [exVoidManagers, setExVoidManagers] = useState<
    { id: number; name: string; role: string; isActive: boolean; hasCorrectionApprovalPassword?: boolean }[]
  >([])
  const [exVoidErr, setExVoidErr] = useState<string | null>(null)
  const [exVoidBusy, setExVoidBusy] = useState(false)
  /** دفتر جبرانیِ تعویض؛ سندهای مبدأ و جایگزین سر جای خود می‌مانند. */
  const [exCorrectionTarget, setExCorrectionTarget] = useState<ExchangeReportResult['rows'][number] | null>(null)
  const [exCorrectionReason, setExCorrectionReason] = useState('')
  const [exCorrectionAuthPassword, setExCorrectionAuthPassword] = useState('')
  const [exCorrectionApproverUserId, setExCorrectionApproverUserId] = useState<number | null>(null)
  const [exCorrectionApproverPassword, setExCorrectionApproverPassword] = useState('')
  const [exCorrectionCashRecovered, setExCorrectionCashRecovered] = useState('')
  const [exCorrectionCardRecovered, setExCorrectionCardRecovered] = useState('')
  const [exCorrectionCashPaidOut, setExCorrectionCashPaidOut] = useState('')
  const [exCorrectionCardPaidOut, setExCorrectionCardPaidOut] = useState('')
  const [exCorrectionCardReference, setExCorrectionCardReference] = useState('')
  const [exCorrectionPayoutReference, setExCorrectionPayoutReference] = useState('')
  const [exCorrectionCreditOutcome, setExCorrectionCreditOutcome] = useState('NONE')
  const [exCorrectionNote, setExCorrectionNote] = useState('')
  const [exCorrectionErr, setExCorrectionErr] = useState<string | null>(null)
  const [exCorrectionBusy, setExCorrectionBusy] = useState(false)

  const loadExchangeCorrectionManagers = () => {
    void call<{ rows?: { id: number; name: string; role: string; isActive: boolean; hasCorrectionApprovalPassword?: boolean }[] }>(
      CH.staffDirectory,
      { includeInactive: false }
    )
      .then((res) => setExVoidManagers((res?.rows ?? []).filter((u) => u.role === 'MANAGER' && u.isActive)))
      .catch(() => setExVoidManagers([]))
  }

  /** فقط پس از گیت، فرم ابطال یا اصلاح جبرانی واقعاً باز می‌شود. */
  const launchExchangeCorrectionAction = ({ action, row }: PendingExchangeCorrectionAction) => {
    if (action === 'VOID') {
      setExVoidReason('')
      setExVoidAuthPassword('')
      setExVoidApproverUserId(null)
      setExVoidApproverPassword('')
      setExVoidErr(null)
      setExVoidTarget(row)
      loadExchangeCorrectionManagers()
      return
    }
    setExCorrectionReason('')
    setExCorrectionAuthPassword('')
    setExCorrectionApproverUserId(null)
    setExCorrectionApproverPassword('')
    setExCorrectionCashRecovered('')
    setExCorrectionCardRecovered('')
    setExCorrectionCashPaidOut('')
    setExCorrectionCardPaidOut('')
    setExCorrectionCardReference('')
    setExCorrectionPayoutReference('')
    setExCorrectionCreditOutcome(row.storeCreditReference ? 'REMAINS_ACTIVE' : 'NONE')
    setExCorrectionNote('')
    setExCorrectionErr(null)
    setExCorrectionTarget(row)
    loadExchangeCorrectionManagers()
  }

  /**
   * درخواست کاربر: با قفل روشن، پنجرهٔ اصلاح/ابطال حتی برای یک لحظه هم باز
   * نمی‌شود. ابتدا هشدار فارسی و همان احراز هویت استاندارد پنل نشان داده می‌شود.
   */
  const requestExchangeCorrectionAction = (action: ExchangeCorrectionAction, row: ExchangeReportResult['rows'][number]) => {
    if (!correctionLockLoaded) {
      setMsg(null)
      setErr('وضعیت قفل اصلاح و ابطال هنوز در حال بررسی است. چند لحظه صبر کنید؛ تا آن زمان هیچ فرم اصلاح یا ابطال باز نمی‌شود.')
      return
    }
    const request = { action, row }
    if (correctionOpen) {
      launchExchangeCorrectionAction(request)
      return
    }
    setExCorrectionUnlockError(null)
    setExCorrectionUnlockPassword('')
    setExCorrectionUnlockRequest(request)
  }

  /** رمز مدیر، رمز دوم اختصاصی یا رمز سوم شیفت فقط همین اختیار را باز می‌کند. */
  const unlockExchangeCorrectionAction = async () => {
    const request = exCorrectionUnlockRequest
    const password = exCorrectionUnlockPassword.trim()
    if (!request) return
    if (!password) {
      setExCorrectionUnlockError('برای باز کردن قفل این عملیات، رمز مدیر یا رمز دوم/سوم همین بخش را وارد کنید.')
      return
    }
    setExCorrectionUnlockBusy(true)
    setExCorrectionUnlockError(null)
    try {
      await unlockPanel(PANEL_KEYS.salesReturnCorrection, password)
      setExCorrectionUnlockRequest(null)
      setExCorrectionUnlockPassword('')
      launchExchangeCorrectionAction(request)
    } catch (e: any) {
      setExCorrectionUnlockError(String(e?.message ?? 'رمز پذیرفته نشد.'))
      setExCorrectionUnlockPassword('')
    } finally {
      setExCorrectionUnlockBusy(false)
    }
  }

  const doExchangeVoid = async () => {
    const target = exVoidTarget
    if (!target) return
    const reason = exVoidReason.trim()
    if (reason.length < 3) {
      setExVoidErr('دلیل ابطال را بنویسید (حداقل ۳ حرف)؛ بدون دلیل، تعویض باطل نمی‌شود.')
      return
    }
    setExVoidBusy(true)
    try {
      const res = await call<any>(CH.saleReturnDelete, {
        id: target.returnId,
        reason,
        panelPassword: exVoidAuthPassword || undefined,
        managerPassword: exVoidAuthPassword || undefined,
        overrideReason: reason,
        approverUserId: exVoidApproverUserId ?? undefined,
        approverPassword: exVoidApproverPassword || undefined
      })
      setExVoidTarget(null)
      setExVoidAuthPassword('')
      setExVoidApproverUserId(null)
      setExVoidApproverPassword('')
      flash(
        (res?.exchangeVoided
          ? `تعویض باطل شد: سند برگشت و سند تعویض ${faDigits(res.exchangeReceiptNo ?? target.exchangeReceiptNo ?? 0)} با مهر «باطل» ماندند`
          : 'سند باطل شد') +
          (res?.exchangeReversedQty ? ` · ${faDigits(res.exchangeReversedQty)} عدد کالای جایگزین به موجودی برگشت` : '') +
          (res?.reversedQty ? ` · ${faDigits(res.reversedQty)} عدد کالای برگشتی از موجودی خارج شد` : '') +
          (res?.canceledCreditRefs?.length ? ` · ${res.canceledCreditRefs.join('، ')} باطل شد` : '') +
          (res?.debtRestored ? ` · ${money(res.debtRestored)} ریال بدهی فاکتور اصلی برگشت` : '')
      )
      void load()
    } catch (e: any) {
      /** برای واردکردن رمز لازم یا اصلاح دلیل، مودال باز می‌ماند. */
      setExVoidErr(String(e?.message ?? 'ابطال تعویض انجام نشد.'))
    } finally {
      setExVoidBusy(false)
    }
  }

  const doExchangeCorrection = async () => {
    const target = exCorrectionTarget
    if (!target) return
    const reason = exCorrectionReason.trim()
    if (reason.length < 3) {
      setExCorrectionErr('دلیل اصلاح جبرانی را بنویسید (حداقل ۳ حرف).')
      return
    }
    const amount = (raw: string) => Number(digitsOnly(raw) || '0')
    const cashRecovered = amount(exCorrectionCashRecovered)
    const cardRecovered = amount(exCorrectionCardRecovered)
    const cashPaidOut = amount(exCorrectionCashPaidOut)
    const cardPaidOut = amount(exCorrectionCardPaidOut)
    if (![cashRecovered, cardRecovered, cashPaidOut, cardPaidOut].every(Number.isSafeInteger)) {
      setExCorrectionErr('یکی از مبالغ واردشده معتبر نیست.')
      return
    }
    setExCorrectionBusy(true)
    try {
      const res = await call<any>(CH.saleReturnCorrection, {
        id: target.returnId,
        reason,
        panelPassword: exCorrectionAuthPassword || undefined,
        approverUserId: exCorrectionApproverUserId ?? undefined,
        approverPassword: exCorrectionApproverPassword || undefined,
        cashRecovered,
        cardRecovered,
        cashPaidOut,
        cardPaidOut,
        cardReference: exCorrectionCardReference.trim() || undefined,
        cardPayoutReference: exCorrectionPayoutReference.trim() || undefined,
        creditOutcome: exCorrectionCreditOutcome,
        note: exCorrectionNote.trim() || undefined
      })
      setExCorrectionTarget(null)
      flash(
        `اصلاح جبرانی تعویض شماره ${faDigits(res.id)} ثبت شد` +
          (res.cashRecovered || res.cardRecovered ? ` · بازیافتی: ${money((res.cashRecovered ?? 0) + (res.cardRecovered ?? 0))} ریال` : '') +
          (res.cashPaidOut || res.cardPaidOut ? ` · پرداخت جبرانی: ${money((res.cashPaidOut ?? 0) + (res.cardPaidOut ?? 0))} ریال` : '')
      )
      void load()
    } catch (e: any) {
      setExCorrectionErr(String(e?.message ?? 'اصلاح جبرانی تعویض انجام نشد.'))
    } finally {
      setExCorrectionBusy(false)
    }
  }

  /** چاپ «سند تعویض» یک ردیف تب تعویض کالا (کانال print:exchange). */
  const printExchangeDoc = async (returnId: number) => {
    if (printBusyRef.current) return
    printBusyRef.current = true
    setPrintBusy(true)
    try {
      /** فاز ۳ — چاپ سند تعویض از مسیر مشترک (پروفایل رسید/فاکتور). */
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printExchange, { returnId, deviceName, silent: opts?.silent })
      )
      if (res === 'CANCELLED') return
      flash('سند تعویض برای چاپ فرستاده شد')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      printBusyRef.current = false
      setPrintBusy(false)
    }
  }

  const reprint = async (invoiceId: number) => {
    if (printBusyRef.current) return
    printBusyRef.current = true
    setPrintBusy(true)
    try {
      /** فاز ۳ — از مسیر مشترک چاپ؛ انصراف ⇒ لغو قطعی و بی‌صدا. */
      const res = await printWith('INVOICE', (deviceName, opts) =>
        call(CH.printInvoice, { invoiceId, deviceName, silent: opts?.silent })
      )
      if (res === 'CANCELLED') return
      flash('رسید فاکتور دوباره چاپ شد')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      printBusyRef.current = false
      setPrintBusy(false)
    }
  }

  return (
    /* بند ۵ — `page` به‌جای `h-full`: جدول‌ها کامل باز می‌شوند و صفحه اسکرول می‌کند */
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">گزارشات فروش</h1>
        <div className="flex gap-1 flex-wrap">
          <button className={`btn ${tab === 'summary' ? 'btn-primary' : ''}`} onClick={() => setTab('summary')}>
            سرجمع فروش
          </button>
          <button className={`btn ${tab === 'items' ? 'btn-primary' : ''}`} onClick={() => setTab('items')}>
            جزئیات فروش
          </button>
          <button className={`btn ${tab === 'returns' ? 'btn-primary' : ''}`} onClick={() => setTab('returns')}>
            برگشت از فروش
          </button>
          <button className={`btn ${tab === 'exchanges' ? 'btn-primary' : ''}`} onClick={() => setTab('exchanges')}>
            تعویض کالا
          </button>
          {/* بخش ۷: تب «نسیه» — قفل مستقل خودش را دارد (PANEL_KEYS.salesCredit) */}
          <button className={`btn ${tab === 'credit' ? 'btn-primary' : ''}`} onClick={() => setTab('credit')}>
            نسیه 🔒
          </button>
          {/* ---------------- جلسه ۱۵ · بند ۱۴ و بخش ۵ و ۶ ---------------- */}
          <button className={`btn ${tab === 'cheques' ? 'btn-primary' : ''}`} onClick={() => setTab('cheques')}>
            چک‌ها
          </button>
          <button className={`btn ${tab === 'storeCredits' ? 'btn-primary' : ''}`} onClick={() => setTab('storeCredits')}>
            اعتبار خرید
          </button>
          <button className={`btn ${tab === 'ledger' ? 'btn-primary' : ''}`} onClick={() => setTab('ledger')}>
            دفتر رویداد
          </button>
          <button className={`btn ${tab === 'fraud' ? 'btn-primary' : ''}`} onClick={() => setTab('fraud')}>
            بازبینی ضدتقلب
          </button>
          <button
            className={`btn ${tab === 'receiptGaps' ? 'btn-primary' : ''}`}
            onClick={() => setTab('receiptGaps')}
            title="شماره‌های فیش که باطل شده‌اند یا در جدول فاکتور نیستند"
          >
            شماره‌های جاافتاده
          </button>
          {/* ---------------- جلسه ۱۸ · بندهای ۱، ۲، ۳ و ۶ ---------------- */}
          <button
            className={`btn ${tab === 'cardTransfers' ? 'btn-primary' : ''}`}
            onClick={() => setTab('cardTransfers')}
            title="بازپرداخت‌های «کارت‌به‌کارت توسط مدیر» و ثبت «پرداخت شد» — فقط مدیر"
          >
            درخواست‌های کارت‌به‌کارت 🔒
          </button>
          <button
            className={`btn ${tab === 'staff' ? 'btn-primary' : ''}`}
            onClick={() => setTab('staff')}
            title="فروش، تخفیف، برگشت و اعتبار خرید هر کارمند + تخفیف‌های غیرعادی"
          >
            عملکرد کارمندان 🔒
          </button>
          <button
            className={`btn ${tab === 'outOfShift' ? 'btn-primary' : ''}`}
            onClick={() => setTab('outOfShift')}
            title="تراکنش‌هایی که ساعت ثبتشان در هیچ بازه‌ی ساعتی شیفت‌ها نیفتاده است"
          >
            خارج از بازه‌ی شیفت
          </button>
          {/* ---------------- جلسه ۱۹ · بند ۲ ---------------- */}
          <button
            className={`btn ${tab === 'overrideSessions' ? 'btn-primary' : ''}`}
            onClick={() => setTab('overrideSessions')}
            title="نشست‌هایی که نام شیفتشان دستی و خلاف پیشنهاد ساعت ثبت شده است (با دلیل و کارمند)"
          >
            نشست‌های override‌شده
          </button>
          {/* ---------------- جلسه ۲۴ — ماژول مدیریت اعتبار خرید ---------------- */}
          <button
            className={`btn ${tab === 'creditManagement' ? 'btn-primary' : ''}`}
            onClick={() => setTab('creditManagement')}
            title="داشبورد و فهرست ماژول «مدیریت اعتبار خرید» (جدا از تب legacy اعتبار تعویض)"
          >
            مدیریت اعتبار خرید 🔒
          </button>
        </div>
        <div className="ms-auto flex gap-1 flex-wrap">
          <button className="btn" onClick={() => nav('/sales-return')}>
            پنل برگشت از فروش
          </button>
          <button className="btn" onClick={() => nav('/cash-close')}>
            بستن صندوق <span className="keycap">F10</span>
          </button>
          <button className="btn" onClick={() => nav('/consolidation')}>
            تجمیع و انتقال <span className="keycap">F11</span>
          </button>
        </div>
      </div>

      {/**
        * بند ۶ — سه چک‌باکس «همه / فروش داخلی-تکی / فروش عمده» روی *هر پنج* بخش
        * گزارش (جزئیات فروش، سرجمع فروش، برگشت از فروش، تعویض کالا و نسیه) اثر
        * می‌گذارند و تغییرشان گزارش را در لحظه تازه می‌کند.
        */}
      <ReportFilterBar value={filters} onChange={setFilters} onSubmit={() => void load()} busy={busy} showChannels>
        {/*
          ---------------------- بند ۵: نوار برشِ نامرئی ----------------------
          «نمایش N از M ردیف» با تعداد کل واقعی. تا امروز فقط تب سرجمع این هشدار را
          داشت و پنج جدول دیگر در سکوت به سقف می‌خوردند — دقیقاً همان‌جا که کسری
          واقعی می‌تواند گم شود.
        */}
        {!!limits?.rows?.filter((r: any) => r.truncated).length && (
          <div className="bg-rose-50 border-2 border-rose-500 rounded p-3 space-y-1">
            <b className="text-rose-800">این گزارش به سقف نمایش خورده است</b>
            {limits.rows
              .filter((r: any) => r.truncated)
              .map((r: any) => (
                <div key={r.key} className="whitespace-pre-line">
                  • <b>{r.label}</b>: {r.note}
                </div>
              ))}
          </div>
        )}

        {tab === 'returns' && (
          <div className="bg-white rounded shadow p-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 font-bold">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={includeExchanges}
                onChange={(e) => setIncludeExchanges(e.target.checked)}
              />
              تعویض‌ها را هم نشان بده
            </label>
            {/* هشدار خواندنیِ «در انتظار تأیید مدیر» — هیچ دکمه‌ای ندارد */}
            {pending.headline && (
              <div className={`w-full rounded border-2 p-2 leading-7 ${pendingToneBox(pending.tone)}`}>
                <b>{pending.headline}</b>
              </div>
            )}
            <span className="kbd leading-6">
              پیش‌فرض خاموش است: این تب فقط «برگشت ساده» را نشان می‌دهد تا ارزش کالای برگشتیِ داخل تعویض با برگشت نقدی
              ساده قاطی نشود. با روشن‌کردن تیک، تعویض‌ها نیز به همین جدول افزوده می‌شوند و گزارش خودکار تازه می‌شود.
            </span>
          </div>
        )}

        {tab === 'summary' && (
          <label className="flex items-center gap-2 pb-2 font-bold">
            <input type="checkbox" className="w-4 h-4" checked={byShift} onChange={(e) => setByShift(e.target.checked)} />
            جداسازی بر اساس شیفت
          </label>
        )}
        {tab === 'credit' && creditOpen && (
          <label
            className="flex items-center gap-2 pb-2 font-bold"
            title="پیش‌فرض فقط فاکتورهای تسویه‌نشده و نیمه‌تسویه نشان داده می‌شوند"
          >
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={includeSettled}
              onChange={(e) => setIncludeSettled(e.target.checked)}
            />
            فاکتورهای تسویه‌شده‌ی این بازه هم نمایش داده شوند
          </label>
        )}
        {cols.customized && (
          <button
            type="button"
            className="btn btn-sm bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-bold px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1"
            onClick={cols.reset}
            title="بازگشت عرض ستون‌های همین جدول به حالت خودکار"
          >
            <span>⟲</span>
            <span>بازنشانی عرض ستون‌ها</span>
          </button>
        )}
      </ReportFilterBar>

      {/* نشست ۱۱۷ (S117-2) — تب نسیه: هشدار برش + صفحه‌بندی واقعی؛ جمع‌ها روی کل بازه‌اند */}
      {tab === 'credit' && creditOpen && !!(credit.warnings?.length || credit.page?.truncated) && (
        <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 flex flex-wrap items-center gap-2">
          {(credit.warnings ?? []).map((w) => (
            <div key={w} className="w-full">{w}</div>
          ))}
          {credit.page && (
            <>
              <button
                className="btn"
                disabled={busy || credit.page.skip <= 0}
                onClick={() => void load({ skip: Math.max(0, credit.page!.skip - credit.page!.take), take: credit.page!.take })}
              >
                صفحه‌ی قبل
              </button>
              <button
                className="btn"
                disabled={busy || credit.page.skip + credit.page.take >= credit.page.totalCount}
                onClick={() => void load({ skip: credit.page!.skip + credit.page!.take, take: credit.page!.take })}
              >
                صفحه‌ی بعد
              </button>
            </>
          )}
        </div>
      )}

      {(msg || err) && (
        <div
          className={`rounded px-3 py-2 border whitespace-pre-line ${
            err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          {err ?? msg}
        </div>
      )}

      {/**
        * بند ۵ — کادر جدول بدون overflow: جدول کامل، اسکرول با چرخ ماوس روی صفحه.
        *
        * ⚠️ جلسه ۱۸: این کادر یک زنجیره‌ی `? :` است که *آخرین* شاخه‌اش جدول
        * «تعویض کالا» است. سه تب تازه بدنه‌ی مستقل خودشان را دارند، پس اگر این
        * کادر برایشان هم رندر می‌شد، زیرِ هر سه‌شان یک جدول تعویضِ بی‌ربط می‌نشست.
        */}
      {tab !== 'cardTransfers' && tab !== 'staff' && tab !== 'outOfShift' && tab !== 'overrideSessions' && tab !== 'creditManagement' && (
      <div className="tbl-card">
        {tab === 'summary' ? (
          byShift ? (
            <ShiftGroups
              groups={report.groups}
              onReprint={reprint}
              onOpenCreditSettlement={(invoiceId) => setCreditSettlementFor(invoiceId)}
              cols={summaryCols}
              sourceOf={stockSources.shortOf}
            />
          ) : (
            <table className={summaryCols.tableClass} ref={summaryCols.tableRef}>
              <ColGroup widths={summaryCols.widths} />
              <thead className="sticky top-0">
                <tr>
                  <ResizableHeaderCells headers={SUMMARY_HEADERS} cols={summaryCols} extraColumns={1} />
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <SummaryRow
                    key={r.id}
                    r={r}
                    onReprint={reprint}
                    onOpenCreditSettlement={(invoiceId) => setCreditSettlementFor(invoiceId)}
                    source={stockSources.shortOf(r.id)}
                  />
                ))}
                {!report.rows.length && (
                  <tr>
                    <td colSpan={SUMMARY_HEADERS.length + 1} className="text-center py-10 text-slate-400">
                      در این بازه فروشی ثبت نشده است
                    </td>
                  </tr>
                )}
              </tbody>
              {!!report.rows.length && (
                <tfoot className="sticky bottom-0">
                  <tr className="bg-slate-100 font-bold">
                    <td>جمع</td>
                    <td colSpan={3}>{faDigits(t.count)} فاکتور</td>
                    <td colSpan={3}></td>
                    <td>{money(t.goodsTotal)}</td>
                    <td>{money(t.taxTotal)}</td>
                    <td>{money(t.serviceTotal)}</td>
                    <td>{money(t.discountTotal)}</td>
                    <td>{money(t.deliveryTotal)}</td>
                    <td>{money(t.grandTotal)}</td>
                    <td>{money(t.cashTotal)}</td>
                    <td className={t.storeCreditUsedTotal > 0 ? 'bg-violet-50 text-violet-950' : ''}>{money(t.storeCreditUsedTotal)}</td>
                    <td>{money(cardOnlyOf(t))}</td>
                    <td className={managerAccountOf(t) > 0 ? 'text-amber-800' : ''}>{money(managerAccountOf(t))}</td>
                    <td>{money(otherOrUnknownOf(t))}</td>
                    {/* جلسه ۵۳ — «کد فاکتور» + «مبدأ کسر» + ستون دکمه‌ها */}
                    <td colSpan={3}></td>
                  </tr>
                  {/* مورد ۲: جمع کل تخفیف‌ها + جمع پس از تخفیف */}
                  <tr className="bg-amber-50 font-bold">
                    <td colSpan={SUMMARY_HEADERS.length + 1}>
                      جمع کل تخفیف‌ها: {money(discountSummary.summaryDiscount)} ریال · جمع پس از تخفیف (جمع مبلغ کالا
                      منهای تخفیف): {money(discountSummary.summaryAfterDiscount)} ریال · جمع کل فروش با عوارض و حق
                      سرویس: {money(t.grandTotal)} ریال
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          )
        ) : tab === 'items' ? (
          <table className={itemCols.tableClass} ref={itemCols.tableRef}>
            <ColGroup widths={itemCols.widths} />
            <thead className="sticky top-0">
              <tr>
                <ResizableHeaderCells headers={ITEM_HEADERS} cols={itemCols} />
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <Fragment key={`${i.invoiceId}-${idx}`}>
                  <tr>
                    <td className="font-bold">{faDigits(i.receiptNo)}</td>
                    <td>{faDigits(i.dateJalali)}</td>
                    <td>{faDigits(i.time)}</td>
                    <td>{i.shiftName}</td>
                    <td>{faDigits(i.code)}</td>
                    <td>{faDigits(i.barcode)}</td>
                    <td>{i.name}</td>
                    <td className="text-center">{faDigits(i.qty)}</td>
                    <td>{money(i.unitPrice)}</td>
                    <td>{money(i.discount)}</td>
                    <td>{money(i.tax)}</td>
                    <td className="font-bold">{money(i.lineTotal)}</td>
                    <td className={`text-center ${i.returnedQty ? 'text-rose-600 font-bold' : ''}`}>
                      {faDigits(i.returnedQty)}
                    </td>
                    <td className={i.returnedAmount ? 'text-rose-700' : ''}>{money(i.returnedAmount ?? 0)}</td>
                    <td className="font-bold">{money(i.netAmount ?? Math.max(0, i.lineTotal - (i.returnedAmount ?? 0)))}</td>
                    <td>{i.customerName}</td>
                  </tr>
                  {!!i.laterReturnNote && (
                    <tr className="bg-orange-50 text-orange-900">
                      <td colSpan={ITEM_HEADERS.length}>{i.laterReturnNote}</td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={ITEM_HEADERS.length} className="text-center py-10 text-slate-400">
                    در این بازه قلمی فروخته نشده است
                  </td>
                </tr>
              )}
            </tbody>
            {!!items.length && (
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={7}>جمع {faDigits(items.length)} ردیف</td>
                  <td className="text-center">{faDigits(items.reduce((s, i) => s + i.qty, 0))}</td>
                  <td></td>
                  {/* مورد ۲: جمع ستون تخفیف، سر جای خودِ ستون تخفیف */}
                  <td>{money(discountSummary.itemsDiscount)}</td>
                  <td>{money(items.reduce((s, i) => s + i.tax, 0))}</td>
                  <td>{money(items.reduce((s, i) => s + i.lineTotal, 0))}</td>
                  <td className="text-center">{faDigits(items.reduce((s, i) => s + i.returnedQty, 0))}</td>
                  <td>{money(items.reduce((s, i) => s + (i.returnedAmount ?? 0), 0))}</td>
                  <td>{money(items.reduce((s, i) => s + (i.netAmount ?? Math.max(0, i.lineTotal - (i.returnedAmount ?? 0))), 0))}</td>
                  <td></td>
                </tr>
                {/* مورد ۲: جمع کل تخفیف‌ها + جمع پس از تخفیف */}
                <tr className="bg-amber-50 font-bold">
                  <td colSpan={ITEM_HEADERS.length}>
                    جمع فروش پیش از تخفیف: {money(discountSummary.itemsGross)} ریال · جمع کل تخفیف‌ها:{' '}
                    {money(discountSummary.itemsDiscount)} ریال · جمع پس از تخفیف:{' '}
                    {money(discountSummary.itemsAfterDiscount)} ریال
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        ) : tab === 'returns' ? (
          <>
          <table className={returnCols.tableClass} ref={returnCols.tableRef}>
            <ColGroup widths={returnCols.widths} />
            <thead className="sticky top-0">
              <tr>
                <ResizableHeaderCells headers={RETURN_HEADERS} cols={returnCols} />
              </tr>
            </thead>
            <tbody>
              {returns.map((r) => (
                <tr key={r.id} className={r.storeCreditReference || r.hasRemovedItems ? 'bg-amber-50' : ''}>
                  <td className="font-bold">{faDigits(r.receiptNo ?? '—')}</td>
                  <td dir="ltr">{r.returnCode ?? '—'}</td>
                  <td>{faDigits(r.invoiceDateJalali)}</td>
                  <td>{faDigits(r.returnedAtJalali)}</td>
                  <td>{faDigits(r.time)}</td>
                  <td>{r.customerName}</td>
                  <td className={r.isExchange ? 'font-bold text-sky-800' : 'font-bold'}>{r.isExchange ? 'تعویض کالا' : 'برگشت ساده'}</td>
                  <td>{r.isFull ? 'کامل' : 'جزئی'}</td>
                  <td className="text-center">{faDigits(r.qty)}</td>
                  <td className="font-bold">{money(r.total)}</td>
                  <td className="whitespace-normal">
                    {r.refundMethodLabel ?? '—'}
                    {r.legacyAssumed && <div className="kbd text-amber-800 font-bold">فرض‌شده از داده‌ی قدیمی</div>}
                    {r.isExchange && <div className="kbd text-sky-800 font-bold">سند تعویض</div>}
                  </td>
                  <td className={r.cashRefundAmount ? 'text-rose-700 font-bold' : ''}>{money(r.cashRefundAmount ?? 0)}</td>
                  <td dir="ltr" className={r.storeCreditReference ? 'font-bold text-amber-900' : ''}>
                    {r.storeCreditReference ?? '—'}
                  </td>
                  <td className={returnCreditAmountOf(r) ? 'font-bold text-amber-900' : ''}>
                    {money(returnCreditAmountOf(r))}
                  </td>
                  <td className="text-center">{faDigits(r.restockedQty)}</td>
                  {/*
                    معلق برگشتی — خواندنی. عدد از خودِ ردیف سرور می‌آید
                    (`pendingRestockQty`) و اگر ردیف قدیمی این فیلد را نداشت، از
                    خلاصه‌ی مشترک خوانده می‌شود؛ پس هیچ‌وقت دو عدد ساخته نمی‌شود.
                  */}
                  <td className="whitespace-nowrap" title={r.restockPending ? PENDING_RESTOCK_EXPLAINER : undefined}>
                    {(r.pendingRestockQty ?? pending.qtyOfReturn(r.id)) > 0 ? (
                      <PendingStockBadge qty={r.pendingRestockQty ?? pending.qtyOfReturn(r.id)} tone={pending.tone} />
                    ) : (
                      <span className="kbd">—</span>
                    )}
                  </td>
                  <td>{r.invoiceUserName ?? '—'}</td>
                  <td>{r.returnUserName ?? '—'}</td>
                  <td className="max-w-[320px] whitespace-normal">
                    {r.items.map((i: any) => `${i.name} (${faDigits(i.qty)})`).join(' · ')}
                    {r.hasRemovedItems && (
                      <div className="text-amber-700 font-bold">شامل کالای حذف‌شده از انبار</div>
                    )}
                  </td>
                </tr>
              ))}
              {!returns.length && (
                <tr>
                  <td colSpan={RETURN_HEADERS.length} className="text-center py-10 text-slate-400">
                    در این بازه برگشت ساده‌ای ثبت نشده است. اگر انتظار تعویض دارید، تیک «تعویض‌ها را هم نشان بده» را روشن کنید یا تب «تعویض کالا» را ببینید.
                  </td>
                </tr>
              )}
            </tbody>
            {!!returns.length && (
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={8}>جمع {faDigits(returns.length)} برگشت</td>
                  <td className="text-center">{faDigits(returns.reduce((s, r) => s + r.qty, 0))}</td>
                  <td>{money(returns.reduce((s, r) => s + r.total, 0))}</td>
                  <td></td>
                  <td className="text-rose-700">{money(returns.reduce((s, r) => s + (r.cashRefundAmount ?? 0), 0))}</td>
                  <td></td>
                  <td className="text-amber-900">
                    {money(returns.reduce((s, r) => s + returnCreditAmountOf(r), 0))}
                  </td>
                  <td className="text-center">{faDigits(returns.reduce((s, r) => s + r.restockedQty, 0))}</td>
                  {/* جلسه ۴۳ · کار ب — جمع معلق‌های همین جدول (هیچ عدد مالی‌ای را عوض نمی‌کند) */}
                  <td className="text-center text-amber-900">
                    {faDigits(returns.reduce((s, r) => s + (r.pendingRestockQty ?? 0), 0))}
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
          <ReturnCorrectionLedger fromJalali={filters.fromJalali} toJalali={filters.toJalali} />
          </>
        ) : tab === 'credit' ? (
          /**
           * بخش ۷ + گیت هشتم: تب «نسیه» با کلید قفل مستقل خودش. عمداً فقط *همین
           * تب* داخل ManagerGate است، نه کل پنل گزارشات فروش.
           */
          <ManagerGate
            panel={PANEL_KEYS.salesCredit}
            title="نسیه (فهرست بدهکاران)"
            reason="فهرست بدهکاران و ثبت پرداختی نسیه، اطلاعات مالی حساسی است و قفل جدا از خودِ گزارشات فروش دارد؛ رمز دومش را می‌توانید فقط به حسابدار بدهید."
            inline
          >
            <CreditTables
              data={credit}
              cols={creditCols}
              settlementCols={settlementCols}
              onPayments={setPaymentsFor}
              onReprint={reprint}
            />
          </ManagerGate>
        ) : (
          <ExchangeTable
            data={exchanges}
            cols={exchangeCols}
            onPrint={printExchangeDoc}
            onVoid={(r) => requestExchangeCorrectionAction('VOID', r)}
            onCorrection={(r) => requestExchangeCorrectionAction('RECONCILE', r)}
            pending={pending}
          />
        )}
      </div>
      )}

      {/*
        قفل عملیاتی تعویض در گزارش: این دیالوگ عمداً پیش از دو فرم حساس است.
        تا credential معتبر ثبت نشود، نه مودال ابطال و نه مودال اصلاح جبرانی باز
        نمی‌شود؛ پس «قفل» فقط خطای دیرهنگام سمت سرور نیست.
      */}
      <ConfirmDialog
        open={!!exCorrectionUnlockRequest}
        title="قفل عملیات اصلاح و ابطال"
        confirmLabel="تأیید و باز کردن قفل"
        busy={exCorrectionUnlockBusy}
        message={
          <div className="space-y-3">
            <p className="font-bold text-amber-900">
              این صفحه/عملیات قفل است؛ شما نمی‌توانید فرم ابطال یا اصلاح جبرانی تعویض را باز کنید.
            </p>
            <p className="kbd leading-6">
              برای ادامه، رمز مدیر، رمز دوم اختصاصی «اصلاح و ابطال برگشت / تعویض»، یا رمز سومِ تعریف‌شده برای شیفت جاری را وارد کنید.
              این رمز فقط همین اختیار را باز می‌کند و کنترل‌های مالی سمت سرور همچنان برقرارند.
            </p>
            <label className="block">
              <span className="font-bold">رمز مجوز عملیات</span>
              <input
                type="password"
                dir="ltr"
                className="inp w-full mt-1"
                value={exCorrectionUnlockPassword}
                onChange={(e) => {
                  setExCorrectionUnlockPassword(e.target.value)
                  setExCorrectionUnlockError(null)
                }}
                autoComplete="off"
                autoFocus
                placeholder="رمز مدیر یا رمز دوم/سوم این عملیات"
              />
            </label>
            {exCorrectionUnlockError && <p className="text-red-600 whitespace-pre-line">{exCorrectionUnlockError}</p>}
            <p className="kbd leading-6">پس از باز شدن قفل، فقط فرمِ عملیاتی که انتخاب کرده‌اید باز می‌شود.</p>
          </div>
        }
        onConfirm={() => void unlockExchangeCorrectionAction()}
        onCancel={() => {
          if (exCorrectionUnlockBusy) return
          setExCorrectionUnlockRequest(null)
          setExCorrectionUnlockPassword('')
          setExCorrectionUnlockError(null)
        }}
      />

      {/* نشست ۶۵ — تاییدیه‌ی ابطال کل گراف تعویض (دلیل اجباری) */}
      <ConfirmDialog
        open={!!exVoidTarget}
        title="ابطال تعویض کالا"
        busy={exVoidBusy}
        confirmLabel="بله، کل تعویض باطل شود"
        message={
          <div className="space-y-2">
            <p>
              تعویض فاکتور <b>{faDigits(exVoidTarget?.receiptNo ?? '—')}</b> (سند تعویض{' '}
              <b>{faDigits(exVoidTarget?.exchangeReceiptNo ?? '—')}</b>) با همه‌ی اثرهایش باطل می‌شود: سند برگشت و سند
              تعویض پاک نمی‌شوند و با مهر «باطل»، نام شما، زمان و دلیل برای همیشه می‌مانند؛ کالای جایگزین به موجودی
              برمی‌گردد، کالای برگشتی از موجودی خارج می‌شود، اعتبار خرید دست‌نخورده باطل و کاهش بدهی فاکتور اصلی لغو
              می‌شود.
            </p>
            <label className="block">
              <span className="font-bold">دلیل ابطال (اجباری)</span>
              <input
                className="inp w-full"
                value={exVoidReason}
                autoFocus
                onChange={(e) => {
                  setExVoidReason(e.target.value)
                  setExVoidErr(null)
                }}
              />
            </label>
            <label className="block">
              <span className="font-bold">رمز تأیید ابطال (اجباری مگر مدیر قفل را خاموش کرده باشد)</span>
              <input
                type="password"
                dir="ltr"
                className="inp w-full"
                value={exVoidAuthPassword}
                onChange={(e) => {
                  setExVoidAuthPassword(e.target.value)
                  setExVoidErr(null)
                }}
                placeholder="رمز مدیر یا رمز اختصاصی اصلاح/ابطال"
              />
              <span className="kbd block mt-1">قفل عملیات روز جاری در نصب تازه روشن است و رمز مدیر یا رمز دوم همین عمل را می‌پذیرد. برای روزهای بعد یا دوره‌ی بسته، هویت شخصی مدیر در فیلدهای پایین لازم است.</span>
            </label>
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
              <p className="text-sm font-bold text-amber-900">تأیید شخصی مدیر — فقط اصلاح دیرهنگام یا دوره‌ی بسته</p>
              <label className="block">
                <span>مدیر تأییدکننده</span>
                <select
                  className="inp w-full"
                  value={exVoidApproverUserId ?? ''}
                  onChange={(e) => {
                    setExVoidApproverUserId(e.target.value ? Number(e.target.value) : null)
                    setExVoidErr(null)
                  }}
                >
                  <option value="">انتخاب کنید…</option>
                  {exVoidManagers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name}{manager.hasCorrectionApprovalPassword ? '' : ' — رمز شخصی تعریف نشده'}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span>رمز شخصی مدیر انتخاب‌شده</span>
                <input
                  type="password"
                  dir="ltr"
                  className="inp w-full"
                  value={exVoidApproverPassword}
                  onChange={(e) => {
                    setExVoidApproverPassword(e.target.value)
                    setExVoidErr(null)
                  }}
                  placeholder="برای روزهای بعد یا دوره‌ی بسته اجباری است"
                />
              </label>
              <p className="kbd">هویت مدیر تأییدکننده در سابقه‌ی غیرقابل‌تغییر ثبت می‌شود؛ رمز سراسری جای آن را نمی‌گیرد.</p>
            </div>
            {exVoidErr && <p className="text-red-600 whitespace-pre-line">{exVoidErr}</p>}
            <p className="text-amber-700">
              اگر مابه‌التفاوت از مشتری دریافت شده، بازپرداخت نقد/کارت انجام شده، اعتبار این تعویض خرج شده یا روی سند
              تعویض برگشت ثبت شده باشد، ابطال انجام نمی‌شود (پول یا کالا واقعاً جابه‌جا شده) و موضوع برای رسیدگی مدیر
              ثبت می‌شود.
            </p>
          </div>
        }
        onConfirm={() => void doExchangeVoid()}
        onCancel={() => {
          setExVoidTarget(null)
          setExVoidAuthPassword('')
          setExVoidApproverUserId(null)
          setExVoidApproverPassword('')
          setExVoidErr(null)
        }}
      />

      <ConfirmDialog
        open={!!exCorrectionTarget}
        title="اصلاح جبرانی تعویض کالا"
        busy={exCorrectionBusy}
        confirmLabel="ثبت اثرهای جبرانی تعویض"
        message={
          <div className="space-y-2">
            <p className="text-amber-800">
              این مسیر سند برگشت و سند تعویض اصلی را حذف یا باطل نمی‌کند. خروج کالای برگشتی، بازگشت کالای جایگزین، پول کشو و کارت/بانک همگی در شیفت فعلی به‌عنوان اثر جبرانی مستقل ثبت می‌شوند.
            </p>
            <p>
              فاکتور مبدأ <b>{faDigits(exCorrectionTarget?.receiptNo ?? '—')}</b> · سند تعویض <b>{faDigits(exCorrectionTarget?.exchangeReceiptNo ?? '—')}</b> · مابه‌التفاوت اولیه <b>{money(exCorrectionTarget?.diff ?? 0)}</b> ریال
            </p>
            <label className="block"><span className="font-bold">دلیل اصلاح جبرانی (اجباری)</span><input className="inp w-full" autoFocus value={exCorrectionReason} onChange={(e) => { setExCorrectionReason(e.target.value); setExCorrectionErr(null) }} /></label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <label><span>نقد بازیافتی از مشتری</span><input dir="ltr" inputMode="numeric" className="inp w-full" value={groupThousands(exCorrectionCashRecovered)} onChange={(e) => { setExCorrectionCashRecovered(digitsOnly(e.target.value)); setExCorrectionErr(null) }} placeholder="۰" /></label>
              <label><span>کارت/بانک بازیافتی از مشتری</span><input dir="ltr" inputMode="numeric" className="inp w-full" value={groupThousands(exCorrectionCardRecovered)} onChange={(e) => { setExCorrectionCardRecovered(digitsOnly(e.target.value)); setExCorrectionErr(null) }} placeholder="۰" /></label>
              <label><span>نقدی که امروز به مشتری پرداخت شد</span><input dir="ltr" inputMode="numeric" className="inp w-full" value={groupThousands(exCorrectionCashPaidOut)} onChange={(e) => { setExCorrectionCashPaidOut(digitsOnly(e.target.value)); setExCorrectionErr(null) }} placeholder="۰" /></label>
              <label><span>کارت/بانکی که امروز به مشتری پرداخت شد</span><input dir="ltr" inputMode="numeric" className="inp w-full" value={groupThousands(exCorrectionCardPaidOut)} onChange={(e) => { setExCorrectionCardPaidOut(digitsOnly(e.target.value)); setExCorrectionErr(null) }} placeholder="۰" /></label>
            </div>
            <label className="block"><span>پیگیری بازیافت کارت/بانک (اگر مبلغ دارد)</span><input className="inp w-full" value={exCorrectionCardReference} onChange={(e) => setExCorrectionCardReference(e.target.value)} /></label>
            <label className="block"><span>پیگیری پرداخت کارت/بانک (اگر مبلغ دارد)</span><input className="inp w-full" value={exCorrectionPayoutReference} onChange={(e) => setExCorrectionPayoutReference(e.target.value)} /></label>
            <label className="block"><span className="font-bold">وضعیت اعتبار صادرشده از همین تعویض</span><select className="inp w-full" value={exCorrectionCreditOutcome} onChange={(e) => setExCorrectionCreditOutcome(e.target.value)}><option value="NONE">اعتباری صادر نشده است</option><option value="CANCELED_UNUSED">اعتبار مصرف‌نشده لغو شد</option><option value="REMAINS_ACTIVE">اعتبار هنوز باقی است</option><option value="CONSUMED">اعتبار کامل مصرف شده است</option></select></label>
            <label className="block"><span>یادداشت تسویه/مغایرت</span><input className="inp w-full" value={exCorrectionNote} onChange={(e) => setExCorrectionNote(e.target.value)} /></label>
            <label className="block"><span>رمز اصلاح جبرانی (در نصب تازه اجباری)</span><input type="password" dir="ltr" className="inp w-full" value={exCorrectionAuthPassword} onChange={(e) => { setExCorrectionAuthPassword(e.target.value); setExCorrectionErr(null) }} placeholder="رمز مدیر یا رمز اختصاصی اصلاح/ابطال" /></label>
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
              <p className="font-bold">تأیید شخصی مدیر — فقط روز بعد یا دوره‌ی بسته</p>
              <select className="inp w-full" value={exCorrectionApproverUserId ?? ''} onChange={(e) => { setExCorrectionApproverUserId(e.target.value ? Number(e.target.value) : null); setExCorrectionErr(null) }}><option value="">انتخاب مدیر تأییدکننده…</option>{exVoidManagers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}{manager.hasCorrectionApprovalPassword ? '' : ' — رمز شخصی تعریف نشده'}</option>)}</select>
              <input type="password" dir="ltr" className="inp w-full" value={exCorrectionApproverPassword} onChange={(e) => { setExCorrectionApproverPassword(e.target.value); setExCorrectionErr(null) }} placeholder="رمز شخصی مدیر انتخاب‌شده" />
            </div>
            {exCorrectionErr && <p className="text-red-600 whitespace-pre-line">{exCorrectionErr}</p>}
            <p className="kbd">برای تعویضِ مثبت فقط پرداختی جبرانی تا سقف مابه‌التفاوت اصلی مجاز است؛ برای تعویضِ منفی فقط مبلغ واقعاً بازیافتی ثبت می‌شود. مقادیر خارج از سقف رد می‌شوند.</p>
          </div>
        }
        onConfirm={() => void doExchangeCorrection()}
        onCancel={() => { setExCorrectionTarget(null); setExCorrectionErr(null) }}
      />

      {/* ===================== جلسه ۱۸ — سه تب تازه ===================== */}
      {/**
        * بند ۱ — «درخواست‌های کارت‌به‌کارت»: جدول ردیف‌ها، پنجره‌ی جزئیات، دکمه‌ی
        * «پرداخت شد»، فرم «رویداد اصلاحی» و بلوک «جریان‌های مالی خارج از فروش».
        * قفلش داخل خودِ کامپوننت است (`PANEL_KEYS.cardTransfers`).
        */}
      {/* ممیزی A117-02 (AUDIT-D50) — این تب‌ها فقط از/تا نوار را می‌گیرند؛ فیلترهای دیگرِ فعال صریحاً اعلام می‌شوند */}
      {dateOnlyTabNotice(tab, filters) && (
        <div className="card p-3 mb-3 border border-amber-300 bg-amber-50 text-amber-900 text-sm">{dateOnlyTabNotice(tab, filters)}</div>
      )}
      {tab === 'cardTransfers' && <CardTransferPanel fromJalali={filters.fromJalali} toJalali={filters.toJalali} />}
      {/* بند ۲ و ۳ — عملکرد کارمندان + فهرست تخفیف‌های غیرعادی */}
      {tab === 'staff' && <StaffPerformancePanel fromJalali={filters.fromJalali} toJalali={filters.toJalali} />}
      {/* بند ۶ — تراکنش‌های خارج از بازه‌ی شیفت (فقط در حالت شیفت ساعتی) */}
      {tab === 'outOfShift' && <OutOfShiftPanel fromJalali={filters.fromJalali} toJalali={filters.toJalali} />}

      {/* جلسه ۱۹ · بند ۲ — گزارش مستقل «نشست‌های با نام override‌شده» */}
      {tab === 'overrideSessions' && (
        <OverrideSessionsPanel fromJalali={filters.fromJalali} toJalali={filters.toJalali} />
      )}

      {/* جلسه ۲۴ — تب تازه‌ی «مدیریت اعتبار خرید» (تب legacy `storeCredits` دست‌نخورده است) */}
      {tab === 'creditManagement' && (
        <CreditManagementReport fromJalali={filters.fromJalali} toJalali={filters.toJalali} />
      )}

      {/**
        * بند ۷ — بلوک خلاصه، در انتهای گزارش «سرجمع فروش» و «جزئیات فروش».
        * جای ثابتش عمداً پایینِ جدول است (همان‌جایی که مدیر بعد از مرور ردیف‌ها
        * نگاه می‌کند) و تیک‌هایش در همان لحظه گزارش را بازمحاسبه می‌کنند.
        */}
      {/* ===================== جلسه ۱۵ · بخش ۵ — هفت بلوک صورت‌حساب ===================== */}
      {tab === 'summary' && (
        <Fragment>
          {!!(report.warnings ?? []).length && (
            <div className="mt-3 rounded border border-red-500 bg-red-50 p-2 text-xs leading-6 text-red-700">
              {(report.warnings ?? []).map((w, i) => (
                <div key={i}>⚠ {w}</div>
              ))}
            </div>
          )}
          {!!report.page?.truncated && (
            <div className="mt-2 rounded border border-red-500 bg-red-50 p-2 text-xs text-red-700">
              ⚠ نمایش {faDigits(report.rows.length)} از {faDigits(report.page!.totalCount)} ردیف — جمع‌های پایین صفحه روی
              کل {faDigits(report.page!.totalCount)} ردیف حساب شده‌اند، نه روی همین صفحه.
            </div>
          )}
          {/** نشست ۳۱۸ — تک‌دکمه‌ی ورود «نمای تشخیص پل»: فقط روی وضعیت
               report.accounting.bridge.balanced === false (نه متن‌خوانی از هشدارها). */}
          {report.accounting?.bridge && report.accounting.bridge.balanced === false && (
            <div className="mt-2 flex items-center gap-2 rounded border-2 border-rose-400 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              <span>پل تطبیق بسته نیست — {money(Math.abs(report.accounting.bridge.unexplained))} ریال بدون توضیح مانده است.</span>
              <button
                className="btn border-rose-500 text-rose-800 hover:bg-rose-100"
                onClick={openBridgeDiag}
                title="نمایش راهنمای ردیف‌به‌ردیف (فقط خواندنی؛ باز کردنش رمز می‌خواهد)"
              >
                نمای تشخیص پل…
              </button>
            </div>
          )}
          <AccountingBlocks
            statements={report.accounting ?? null}
            warnings={report.warnings ?? []}
            range={
              report.accounting?.period?.fromJalali
                ? `از ${faDigits(report.accounting.period.fromJalali)} تا ${faDigits(report.accounting.period.toJalali ?? '')}`
                : 'بازه‌ی کامل'
            }
            channelsText={channelsLabel(filters.channels)}
            onOpenInvoice={(id) => setPaymentsFor(id)}
            onBridgePage={(key, skip) => {
              void load({
                withDrillDown: true,
                bridgeSourceKey: key,
                bridgeSourceSkip: skip,
                bridgeSourceTake: 200
              })
            }}
            onDrill={(t: DrillTarget) => {
              const map: Record<DrillTarget, Tab> = {
                summary: 'summary',
                items: 'items',
                ledger: 'ledger',
                returns: 'returns',
                exchanges: 'exchanges',
                credit: 'credit',
                cheques: 'cheques',
                storeCredits: 'storeCredits'
              }
              setTab(map[t])
            }}
          />
        </Fragment>
      )}

      {/* ===================== جلسه ۱۵ — چهار تب تازه ===================== */}
      {tab === 'receiptGaps' && (
        <div className="bg-white rounded shadow p-3 space-y-3">
          <h2 className="font-bold">شماره‌های جاافتاده / باطل‌شده‌ی فیش</h2>
          <p className="kbd leading-6">
            شمارنده عقب نمی‌رود؛ این صفحه فقط می‌گوید کدام شماره‌ها فروش زنده‌ نیستند. بازه‌ی تاریخ گزارش روی این فهرست
            اثر ندارد (کل شماره‌ها از ۱ تا آخرین شمارنده).
          </p>
          {receiptGaps && (
            <div className="flex flex-wrap gap-3 text-sm">
              <span>شمارنده: {faDigits(receiptGaps.seq)}</span>
              <span>فروش زنده: {faDigits(receiptGaps.liveCount)}</span>
              <span>باطل‌شده: {faDigits(receiptGaps.voidedCount)}</span>
              <span>بدون ردیف: {faDigits(receiptGaps.missingCount)}</span>
            </div>
          )}
          {receiptGaps && receiptGaps.ranges.length === 0 && (
            <div className="text-emerald-700">هیچ شماره‌ی جاافتاده‌ای تا {faDigits(receiptGaps.seq)} نیست.</div>
          )}
          {receiptGaps && receiptGaps.ranges.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-100">
                  <th className="p-2 text-right">از</th>
                  <th className="p-2 text-right">تا</th>
                  <th className="p-2 text-right">تعداد</th>
                  <th className="p-2 text-right">علت</th>
                </tr>
              </thead>
              <tbody>
                {receiptGaps.ranges.map((r) => (
                  <tr key={`${r.reason}-${r.from}`} className="border-t">
                    <td className="p-2">{faDigits(r.from)}</td>
                    <td className="p-2">{faDigits(r.to)}</td>
                    <td className="p-2">{faDigits(r.count)}</td>
                    <td className="p-2">{r.reason === 'voided' ? 'ابطال' : 'بدون ردیف'} — {r.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {(tab === 'cheques' || tab === 'storeCredits' || tab === 'ledger' || tab === 'fraud') && (
        <ReportExtraTables
          tab={tab}
          cheques={cheques}
          chequeDateMode={chequeDateMode}
          onChequeDateMode={setChequeDateMode}
          storeCredits={storeCredits}
          ledger={ledger}
          fraud={fraud}
          onOpenInvoice={(id) => setPaymentsFor(id)}
        />
      )}

      {(tab === 'summary' || tab === 'items') && (
        <SaleSummaryBlock
          parts={summary.parts}
          active={summaryOn}
          onToggle={(key) =>
            setSummaryOn((on) => (on.includes(key) ? on.filter((k) => k !== key) : [...on, key]))
          }
          onAll={(all) => setSummaryOn(all ? [...ALL_SUMMARY_PARTS] : [])}
          net={summary.net}
          totals={t}
          cashTotal={t.cashTotal}
          cardTotal={summary.cardTotal}
          creditCardTotal={t.creditTotal}
          otherTotal={t.otherTotal}
          managerAccountTotal={t.managerAccountTotal}
          destinationUnknownTotal={t.destinationUnknownTotal}
          realCash={summary.realCash}
          nonCash={summary.nonCash}
          creditRefundTotal={summary.creditRefundTotal}
          creditUsedTotal={summary.creditUsedTotal}
          creditUsedStories={report.accounting?.storeCredits?.usedStories ?? []}
          creditUsedStoryHidden={Math.max(
            0,
            (report.accounting?.storeCredits?.usageCount ?? 0) - (report.accounting?.storeCredits?.usedStories?.length ?? 0)
          )}
          priorCreditStories={report.accounting?.credit?.settledPriorStories ?? []}
          priorCreditStoryHidden={report.accounting?.credit?.settledPriorStoryHidden ?? 0}
          invoiceCount={t.count}
          range={`از ${appliedFilters.fromJalali} تا ${appliedFilters.toJalali}`}
          channels={appliedFilters.channels}
          bridge={report.accounting?.bridge}
          statements={report.accounting ?? null}
          appliedFiltersPayload={toServiceFilter(appliedFilters)}
          onOpenInvoice={(id) => setPaymentsFor(id)}
          onOpenBridgeDiag={openBridgeDiag}
          refundCashTotal={t.refundCashTotal}
          refundCardTotal={t.refundCardTotal}
        />
      )}

      {/* ---------- ثبت پرداختی نسیه (همان پنجره‌ی پرداختی‌ها / اقساط) ---------- */}
      {/* نشست ۳۱۸ — نمای تشخیص پل تطبیق؛ scope همان فیلتر فعلی صفحه است. */}
      <BridgeDiagnosticsModal
        open={bridgeDiagOpen}
        onClosed={() => setBridgeDiagOpen(false)}
        scope={toServiceFilter(filters)}
        pageUnexplained={report?.accounting?.bridge ? report.accounting.bridge.unexplained : null}
      />
      <CreditSettlementModal open={creditSettlementFor != null} invoiceId={creditSettlementFor} onClose={() => setCreditSettlementFor(null)} />
      <InvoicePaymentsModal
        open={paymentsFor != null}
        invoiceId={paymentsFor}
        methods={methods}
        debtReceiptPrint={settings.sale.debtPaymentReceiptPrint === true}
        onClose={() => setPaymentsFor(null)}
        onChanged={(m) => {
          flash(m)
          void load()
        }}
      />

      {/**
        * نوار پایین (تهیه گزارش · چاپ · خروجی اکسل · جمع‌های بازه) مخصوص تب‌های
        * کلاسیک است و به `report`/`exchanges` تکیه دارد. سه تب جلسه ۱۸ دکمه‌ی
        * بازخوانی و خروجی *خودشان* را دارند، پس این نوار برایشان پنهان می‌شود تا
        * دو دکمه‌ی «خروجی اکسل» با دو معنی متفاوت کنار هم ننشینند.
        */}
      {tab !== 'cardTransfers' && tab !== 'staff' && tab !== 'outOfShift' && tab !== 'creditManagement' && tab !== 'overrideSessions' && tab !== 'receiptGaps' && (
      <div className="flex gap-2 flex-wrap items-center">
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال تهیه…' : 'تهیه گزارش'}
        </button>
        {tab === 'credit' && creditOpen && (
          <div className="kbd">
            {faDigits(credit.totals.count)} فاکتور ({faDigits(credit.totals.unpaidCount)} بدون پرداختی ·{' '}
            {faDigits(credit.totals.partialCount)} نیمه‌تسویه · {faDigits(credit.totals.settledCount)} تسویه‌شده) · جمع
            فاکتورها {money(credit.totals.grandTotal)} · دریافت‌شده {money(credit.totals.paidTotal)} ·{' '}
            <b>باقی‌ماندهٔ بدهی {money(credit.totals.remainingTotal)} ریال</b> · چک در جریان{' '}
            {money(credit.totals.pendingChequeTotal)} · تسویه‌ی نسیه‌ی بازه‌های قبل در همین بازه{' '}
            {money(credit.totals.priorSettlementTotal)} ریال
          </div>
        )}
        {tab === 'exchanges' && (
          <div className="kbd">
            {faDigits(exchanges.totals.count)} تعویض · جمع برگشتی {money(exchanges.totals.returnTotal)} · جمع جایگزین{' '}
            {money(exchanges.totals.exchangeTotal)} · مابه‌التفاوت {money(exchanges.totals.diffTotal)} · دریافت نقد{' '}
            نقد {money(exchanges.totals.cashReceivedTotal)} · کارت {money(exchanges.totals.cardReceivedTotal)} · اعتبار صادرشده {money(exchanges.totals.creditIssuedTotal)} ریال
          </div>
        )}
        {outputDirty && (
          <div className="w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            فیلتر گزارش تغییر کرده؛ ابتدا «تهیه گزارش» را بزنید تا چاپ و خروجی با داده‌ی تازه هماهنگ شوند.
          </div>
        )}
        <label
          className="flex items-center gap-2 rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs"
          title="پیش‌فرض، همه‌ی ردیف‌های فیلتر اجراشده را دوباره می‌خواند؛ این گزینه فقط صفحه‌ی جاری را صادر می‌کند."
        >
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={outputScope === 'page'}
            onChange={(event) => setOutputScope(event.target.checked ? 'page' : 'all')}
            disabled={busy}
          />
          فقط صفحه‌ی جاری را چاپ/خروجی بگیر
        </label>
        <span className="text-xs text-slate-500">
          {outputScope === 'all' ? 'پیش‌فرض: کل خروجی فیلترشده' : 'خروجی محدود به صفحه‌ی جاری است'}
        </span>
        <button className="btn" onClick={() => void printThermal()} disabled={busy || printBusy || outputDirty || tab !== 'summary' || !report.rows.length}>
          {printBusy ? 'در حال چاپ…' : 'چاپ حرارتی'}
        </button>
        <button className="btn" onClick={() => void printA4()} disabled={busy || printBusy || outputDirty}>
          {printBusy ? 'در حال چاپ…' : 'چاپ A4'}
        </button>
        <button className="btn" onClick={() => void exportCsvNow()} disabled={busy || outputDirty}>
          خروجی اکسل
        </button>
        {tab === 'credit' && creditOpen && !!credit.priorSettlements.length && (
          <button
            className="btn"
            onClick={() => void exportSettlements()}
            disabled={busy || outputDirty}
            title="پولی که در این بازه بابت نسیه‌ی بازه‌های قبل گرفته شده است"
          >
            خروجی اکسل تسویه‌های بازه‌های قبل
          </button>
        )}
        {cols.customized && (
          <button className="btn" onClick={cols.reset} title="بازگشت عرض ستون‌های همین جدول به حالت خودکار">
            بازنشانی عرض ستون‌ها
          </button>
        )}
        <div className="kbd">
          جمع کل تخفیف‌ها: {money(discountSummary.summaryDiscount)} · جمع پس از تخفیف:{' '}
          {money(discountSummary.summaryAfterDiscount)} · جمع کل فروش بازه: {money(t.grandTotal)} ریال · نقدی{' '}
          {money(t.cashTotal)} · تسویه با اعتبار خرید (غیرنقدی) {money(t.storeCreditUsedTotal)} · کارت{' '}
          {money(cardOnlyOf(t))} · {MANAGER_ACCOUNT_ROW_LABEL} {money(managerAccountOf(t))} · سایر/نامشخص{' '}
          {money(otherOrUnknownOf(t))} · برگشت {money(t.returnedTotal)} · عرض هر ستون را با کشیدن مرز سرستون تغییر
          دهید (دوبار کلیک = عرض خودکار)
        </div>
      </div>
      )}
    </div>
  )
}

/**
 * ===========================================================================
 * بند ۷ — بلوک «خلاصه‌ی فروش بازه» (نمایش + فیلتر پویا + کنترل کارت‌خوان).
 *
 * چیدمانش عمداً «دفتری» است: هر ردیف یک تیک، یک برچسب، یک علامت و یک عدد؛ و
 * زیرشان یک خط «خالص». هیچ محاسبه‌ای اینجا انجام نمی‌شود جز همان جمع جبری
 * ردیف‌های فعال، و همان یک خط هم در صفحه‌ی مصرف‌کننده (`summary.net`) حساب
 * می‌شود — پس عدد بلوک و عدد پایین صفحه یک عدد است.
 * ===========================================================================
 */
function SaleSummaryBlock({
  parts,
  active,
  onToggle,
  onAll,
  net,
  totals,
  cashTotal,
  cardTotal,
  creditCardTotal,
  otherTotal = 0,
  managerAccountTotal = 0,
  destinationUnknownTotal = 0,
  realCash,
  nonCash,
  creditRefundTotal,
  creditUsedTotal,
  creditUsedStories = [],
  creditUsedStoryHidden = 0,
  priorCreditStories = [],
  priorCreditStoryHidden = 0,
  invoiceCount,
  range,
  channels,
  bridge,
  statements,
  appliedFiltersPayload,
  onOpenInvoice,
  onOpenBridgeDiag,
  refundCashTotal = 0,
  refundCardTotal = 0
}: {
  parts: SummaryPart[]
  active: SummaryPartKey[]
  onToggle: (key: SummaryPartKey) => void
  onAll: (all: boolean) => void
  net: number
  totals?: Partial<SaleReportTotals>
  cashTotal: number
  cardTotal: number
  creditCardTotal: number
  otherTotal?: number
  managerAccountTotal?: number
  destinationUnknownTotal?: number
  realCash: number
  nonCash: number
  creditRefundTotal: number
  creditUsedTotal: number
  /** داستان‌های امن مصرف اعتبار؛ کد قابل مصرف از گزارش فروش عبور نمی‌کند. */
  creditUsedStories?: { amount: number; safeText: string }[]
  creditUsedStoryHidden?: number
  priorCreditStories?: { paymentId: number; receiptNo: number; amount: number; text: string }[]
  priorCreditStoryHidden?: number
  invoiceCount: number
  range: string
  channels: string[]
  bridge?: SaleBridgeBlock | null
  statements?: SaleAccountingStatements | null
  appliedFiltersPayload?: any
  onOpenInvoice?: (id: number) => void
  onOpenBridgeDiag?: () => void
  refundCashTotal?: number
  refundCardTotal?: number
}) {
  const [creditStoriesOpen, setCreditStoriesOpen] = useState(false)
  const [priorCreditStoriesOpen, setPriorCreditStoriesOpen] = useState(false)
  /** یک ریزبین واحد؛ focus تعیین می‌کند کاربر از کدام کاشی وارد شده است. */
  const [financialInspectorOpen, setFinancialInspectorOpen] = useState(false)
  const [financialInspectorFocus, setFinancialInspectorFocus] = useState<'overview' | 'drawer' | 'pos' | 'other' | 'manager' | 'nonCash'>('overview')
  /** ورود کارت گردش اعتبار مستقیماً به history امن همان سبد می‌رود. */
  const [financialInspectorInitialSource, setFinancialInspectorInitialSource] = useState<FinancialSourceKey | undefined>()
  const [nonCashOpen, setNonCashOpen] = useState(false)
  const [nonCashLoading, setNonCashLoading] = useState(false)
  const [exchangeRows, setExchangeRows] = useState<ExchangeReportRow[]>([])
  const [creditSources, setCreditSources] = useState<SaleBridgeSource[]>([])
  const [loadedPayloadKey, setLoadedPayloadKey] = useState<string | null>(null)

  const priorCreditTotal = parts.find((p) => p.key === 'priorCredit')?.value ?? 0
  const allOn = active.length === parts.length
  const hidden = parts.filter((p) => !active.includes(p.key))

  // ساخت زنجیره تراز ریاضی خالص به دخل
  const netToDrawer = useMemo(() => {
    return buildNetToDrawer(bridge, realCash)
  }, [bridge, realCash])

  // تفکیک درشت کشو و کارت‌خوان
  const split = useMemo(() => {
    const rawTotals = totals ?? {
      cashTotal,
      refundCashTotal,
      refundCardTotal,
      otherTotal,
      creditTotal: creditCardTotal,
      destinationUnknownTotal,
      managerAccountTotal
    }
    return splitDrawerPos(rawTotals, cardTotal, realCash, netToDrawer.end)
  }, [totals, cashTotal, refundCashTotal, refundCardTotal, otherTotal, creditCardTotal, destinationUnknownTotal, managerAccountTotal, cardTotal, realCash, netToDrawer.end])

  // بارگذاری داده‌های ریز اقلام غیرنقدی (Lazy loading بر مبنای appliedFilters)
  const currentPayloadKey = JSON.stringify(appliedFiltersPayload ?? {})
  useEffect(() => {
    if (!nonCashOpen) return
    if (loadedPayloadKey === currentPayloadKey) return

    let cancelled = false
    setNonCashLoading(true)

    Promise.all([
      call<ExchangeReportResult>(CH.saleExchangeList, appliedFiltersPayload ?? {}).catch(() => ({ rows: [] } as any)),
      call<SaleReportResult>(CH.saleReportRows, {
        ...(appliedFiltersPayload ?? {}),
        withDrillDown: true,
        bridgeSourceKey: 'storeCreditUsed',
        bridgeSourceSkip: 0,
        bridgeSourceTake: 200
      }).catch(() => ({ accounting: { bridge: { rows: [] } } } as any))
    ])
      .then(([exRes, reportRes]) => {
        if (cancelled) return
        setExchangeRows(exRes?.rows ?? [])
        const bridgeRow = reportRes?.accounting?.bridge?.rows?.find((r: SaleBridgeRow) => r.key === 'storeCreditUsed')
        setCreditSources(bridgeRow?.sources ?? [])
        setLoadedPayloadKey(currentPayloadKey)
      })
      .finally(() => {
        if (!cancelled) setNonCashLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [nonCashOpen, currentPayloadKey, loadedPayloadKey, appliedFiltersPayload])

  return (
    <div className="bg-white rounded shadow border-2 border-brand/40">
      <div className="p-2 border-b bg-brand/10 font-bold flex items-center gap-2 flex-wrap">
        <span>خلاصه‌ی فروش بازه — {faDigits(range)}</span>
        <span className="kbd">
          {faDigits(invoiceCount)} فاکتور · نوع فروش: {channelsLabel(channels)}
        </span>
        <label className="ms-auto flex items-center gap-1 text-[12px]" title="روشن/خاموش کردن همه‌ی ردیف‌ها با یک کلیک">
          <input type="checkbox" className="w-4 h-4" checked={allOn} onChange={() => onAll(!allOn)} />
          همه‌ی ردیف‌ها
        </label>
      </div>

      <div className="p-2 grid gap-1 md:grid-cols-2">
        {parts.map((p) => {
          const on = active.includes(p.key)
          return (
            <label
              key={p.key}
              title={p.hint}
              className={`flex items-center gap-2 rounded px-2 py-1 border cursor-pointer ${
                on ? (p.sign < 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200') : 'bg-slate-50 border-slate-200 opacity-60'
              }`}
            >
              <input type="checkbox" className="w-4 h-4" checked={on} onChange={() => onToggle(p.key)} />
              <span className="flex-1">{p.label}</span>
              {/* ردیف غیرفعال، عددش هم نمایش داده نمی‌شود: از گزارش بیرون است، نه «پنهان» */}
              {on ? (
                <b dir="ltr" className={p.sign < 0 ? 'text-rose-700' : 'text-emerald-800'}>
                  {p.sign < 0 ? '−' : '+'}
                  {money(p.value)}
                </b>
              ) : (
                <span className="kbd">از گزارش و از خالص کنار گذاشته شد</span>
              )}
            </label>
          )
        })}
      </div>

      <div className="p-2 border-t bg-slate-100 flex items-baseline gap-2 flex-wrap">
        <span className="font-bold text-base">خالص:</span>
        <b dir="ltr" className={`text-lg ${net < 0 ? 'text-rose-700' : 'text-emerald-900'}`}>
          {money(net)}
        </b>
        <span>ریال</span>
        {!!hidden.length && (
          <span className="kbd text-amber-800">
            ⚠️ این خالص، {faDigits(hidden.length)} ردیف کنارگذاشته‌شده را در خود ندارد:{' '}
            {hidden.map((h) => h.label).join(' · ')}
          </span>
        )}
        {!active.length && <span className="kbd text-amber-800">هیچ ردیفی فعال نیست، پس خالص صفر است.</span>}
        {creditRefundTotal > 0 && (
          <div className="basis-full kbd text-amber-900 font-bold">
            خالص فروش کالا است، موجودی صندوق نیست. {money(creditRefundTotal)} ریال کالا برگشت خورده ولی نقد از کشو
            نرفته چون بارکد اعتبار صادر شده — همان مبلغ را در خط پایین («باید در صندوق باشد») ببین.
          </div>
        )}
        {creditUsedTotal > 0 && (
          <div className="basis-full kbd text-amber-900 font-bold">
            {money(creditUsedTotal)} ریال از فروش این بازه با بارکد اعتبار خرید تسویه شده و نقد وارد صندوق نشده.
            این را با خالص مقایسه نکن؛ کسری صندوق نیست.
          </div>
        )}
      </div>

      {/**
        * ---------- کنترل کارت‌خوان (هدف اصلی بند ۷ + لایه شفاف‌ساز جدید) ----------
        */}
      <div className="p-2 border-t">
        <DrawerVsPosSplit
          drawer={split.drawer}
          pos={split.pos}
          other={split.other}
          managerOutside={split.managerOutside}
          realCash={realCash}
          cashTotal={cashTotal}
          cardTotal={cardTotal}
          refundCashTotal={refundCashTotal}
          refundCardTotal={refundCardTotal}
          otherTotal={totals?.otherTotal ?? otherTotal}
          creditTotal={totals?.creditTotal ?? creditCardTotal}
          destinationUnknownTotal={totals?.destinationUnknownTotal ?? destinationUnknownTotal}
          hasDiscrepancy={split.hasDiscrepancy}
          discrepancy={split.discrepancy}
          discrepancyKind={
            split.discrepancyKind === 'OFFICIAL_REFERENCE'
              ? 'OFFICIAL_REFERENCE'
              : split.discrepancyKind === 'CHAIN_COMPOSITION'
                ? 'CHAIN_COMPOSITION'
                : null
          }
          bridgeAlarm={netToDrawer.alarm}
          onOpenExplainer={() => {
            setFinancialInspectorInitialSource(undefined)
            setFinancialInspectorFocus('overview')
            setFinancialInspectorOpen(true)
          }}
          onOpenFinancialInspector={(focus) => {
            setFinancialInspectorInitialSource(undefined)
            setFinancialInspectorFocus(focus)
            setFinancialInspectorOpen(true)
          }}
          onOpenBridgeDiag={onOpenBridgeDiag}
          nonCash={nonCash}
          nonCashOpen={nonCashOpen}
          onToggleNonCash={() => setNonCashOpen((prev) => !prev)}
        />

        <CreditLifecycleCard
          credit={statements?.storeCredits}
          onInspect={(key) => {
            setFinancialInspectorInitialSource(key)
            setFinancialInspectorFocus('overview')
            setFinancialInspectorOpen(true)
          }}
        />

        {/* ریزبین واحد: هیچ مودال مالی دیگری روی آن باز نمی‌شود. */}
        <FinancialInspector
          open={financialInspectorOpen}
          onClose={() => {
            setFinancialInspectorOpen(false)
            setFinancialInspectorInitialSource(undefined)
          }}
          scope={appliedFiltersPayload ?? {}}
          totals={totals ?? {
            cashTotal,
            cardTotal,
            creditTotal: creditCardTotal,
            otherTotal,
            managerAccountTotal,
            destinationUnknownTotal,
            refundCashTotal,
            refundCardTotal
          }}
          statements={statements}
          referenceRealCash={realCash}
          split={split}
          bridgeAlarm={netToDrawer.alarm}
          initialFocus={financialInspectorFocus}
          initialSourceKey={financialInspectorInitialSource}
          onOpenBridgeDiag={onOpenBridgeDiag}
        />

        {/* آکاردئون legacy ریز تسویه‌های غیرنقدی؛ اعداد و منابع آن دست‌نخورده‌اند. */}
        <NonCashDrawer
          open={nonCashOpen}
          onToggle={() => setNonCashOpen((prev) => !prev)}
          expectedNonCash={nonCash}
          exchangeRows={exchangeRows}
          creditSources={creditSources}
          loading={nonCashLoading}
          onOpenInvoice={(id) => onOpenInvoice && onOpenInvoice(id)}
          creditUsedStories={creditUsedStories}
        />

        {creditRefundTotal > 0 && (
          <div className="kbd text-amber-900 font-bold mt-2">
            {money(creditRefundTotal)} ریال بابت برگشت/تعویض بارکد اعتبار خرید صادر شده — این مبلغ از صندوق بیرون
            نرفته و بدهی فروشگاه به مشتری است. اگر فروشنده نقد هم داده، کشو باید به همین اندازه کسری نشان بدهد.
          </div>
        )}
        {creditUsedTotal > 0 && (
          <div className="kbd text-amber-900 font-bold mt-1">
            {money(creditUsedTotal)} ریال فروش این بازه با بارکد اعتبار خرید تسویه شده — پولی وارد صندوق نشده.
            بستن صندوق نباید کسری نشان بدهد؛ کالا رفته و بدهی قبلی ما به مشتری تسویه شده است.
            {creditUsedStories.length > 0 && (
              <div className="mt-1">
                <button
                  type="button"
                  className="btn btn-xs"
                  onClick={() => setCreditStoriesOpen((open) => !open)}
                  title={creditStoriesOpen ? 'جمع شدن فهرست مصرف اعتبارها' : 'باز شدن سابقهٔ امن اعتبارهای مصرف‌شده'}
                >
                  {creditStoriesOpen
                    ? `− جمع شدن ${faDigits(creditUsedStories.length)} سابقهٔ اعتبار`
                    : `+ نمایش ${faDigits(creditUsedStories.length)} سابقهٔ اعتبار`}
                </button>
                {creditStoriesOpen && (
                  <div className="mt-1 leading-7 font-normal">
                    {creditUsedStories.map((s, index) => (
                      <div key={`${s.safeText}-${s.amount}-${index}`}>{s.safeText}</div>
                    ))}
                    {creditUsedStoryHidden > 0 && (
                      <div className="font-bold">
                        و {faDigits(creditUsedStoryHidden)} بارکد دیگر در تب «اعتبار خرید» (بازه‌ی خیلی بزرگ؛ روی صفحه
                        پنج‌هزار مورد اول آمده است).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {priorCreditStories.length > 0 && (
          <div className="kbd text-amber-900 font-bold mt-1">
            {money(priorCreditTotal)} ریال وصول نسیهٔ فاکتورهای بازه‌های قبل در این بازه آمده — فروش این بازه نیست.
            <div className="mt-1">
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setPriorCreditStoriesOpen((open) => !open)}
                title={priorCreditStoriesOpen ? 'جمع شدن فهرست وصول نسیه' : 'باز شدن همهٔ وصول‌های نسیه'}
              >
                {priorCreditStoriesOpen
                  ? `− جمع شدن ${faDigits(priorCreditStories.length)} وصول نسیه`
                  : `+ نمایش ${faDigits(priorCreditStories.length)} وصول نسیه`}
              </button>
              {priorCreditStoriesOpen && (
                <div className="mt-1 leading-7 font-normal">
                  {priorCreditStories.map((s) => (
                    <div key={s.paymentId}>{s.text}</div>
                  ))}
                  {priorCreditStoryHidden > 0 && (
                    <div className="font-bold">
                      و {faDigits(priorCreditStoryHidden)} وصول دیگر در تب «نسیه» (بازه‌ی خیلی بزرگ؛ روی صفحه
                      پنج‌هزار مورد اول آمده است).
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        {nonCash > 0 && (
          <div className="kbd text-amber-800 mt-1">
            {money(nonCash)} ریال از فاکتورهای «تسویه‌شده»ی این بازه پول نقد نبوده است (ارزش کالای برگشتی در تعویض +
            بارکد اعتبار خرید مصرف‌شده)، پس دنبالش در کارت‌خوان نگردید.
          </div>
        )}
        <div className="kbd mt-1">
          اگر «کارت» این گزارش با جمع پایان‌روز دستگاه کارت‌خوان نخواند، تب «نسیه» و ستون «اضافه دریافتی» را هم ببینید:
          بیشترِ اختلاف‌ها یا نسیه‌ای است که نقدی ثبت شده، یا تخفیفی که بعد از پرداخت خورده است.
        </div>
      </div>
    </div>
  )
}

function SummaryRow({
  r,
  onReprint,
  onOpenCreditSettlement,
  source = ''
}: {
  r: SaleReportRow
  onReprint: (id: number) => void
  /**
   * جزئیات همان فاکتور، از endpoint امن پرداختی‌ها. این callback فقط برای مبلغ
   * اعتبار مصرف‌شده است و هیچ کد اعتبار یا lookup کد به renderer نمی‌فرستد.
   */
  onOpenCreditSettlement?: (invoiceId: number) => void
  /** جلسه ۵۳ — خط کوتاه «مبدأ کسر» همین فاکتور؛ خالی ⇒ «—» (فاکتور بی‌دفتر) */
  source?: string
}) {
  return (
    <tr className={r.returnedTotal ? 'bg-rose-50' : ''}>
      <td className="font-bold">{faDigits(r.receiptNo)}</td>
      <td>{faDigits(r.dateJalali)}</td>
      <td>{faDigits(r.time)}</td>
      <td>{r.shiftName}</td>
      <td>{r.customerName}</td>
      <td className={r.consolidated ? 'text-emerald-700' : ''}>{r.statusLabel}</td>
      <td>{r.orderTypeLabel}</td>
      <td>{money(r.goodsTotal)}</td>
      <td>{money(r.taxTotal)}</td>
      <td>{money(r.serviceCharge)}</td>
      <td>{money(r.discountTotal)}</td>
      <td>{money(r.deliveryFee)}</td>
      <td className="font-bold">{money(r.grandTotal)}</td>
      <td>{money(r.cashTotal)}</td>
      <td className={r.storeCreditTotal > 0 ? 'bg-violet-50 font-bold text-violet-950' : ''}>
        {r.storeCreditTotal > 0 && onOpenCreditSettlement ? (
          <button
            type="button"
            className="text-right text-violet-800 underline decoration-dotted underline-offset-2 hover:text-violet-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            onClick={() => onOpenCreditSettlement(r.id)}
            title="نمایش جزئیات امن تسویهٔ این فاکتور با اعتبار خرید؛ کد اعتبار نمایش داده نمی‌شود"
          >
            {money(r.storeCreditTotal)}
          </button>
        ) : (
          money(r.storeCreditTotal)
        )}
      </td>
      <td>{money(cardOf(r))}</td>
      {/* کار الف — «حساب مدیر»: پول به فروشگاه نرسیده، پس ستون خودش را دارد */}
      <td
        className={managerAccountOf(r) > 0 ? 'text-amber-800 font-bold' : ''}
        title={managerAccountOf(r) > 0 ? MANAGER_ACCOUNT_ROW_NOTE : ''}
      >
        {money(managerAccountOf(r))}
      </td>
      <td className={otherOrUnknownOf(r) > 0 ? 'text-slate-600' : ''}>{money(otherOrUnknownOf(r))}</td>
      <td dir="ltr">{r.returnCode ?? '—'}</td>
      {/**
        * جلسه ۵۳ · مرحله ۴ — «مبدأ کسر» (خواندنی). خالی ⇒ «—»، یعنی این فاکتور
        * دفتر مبدأ ندارد و مثل قبل کاملاً از انبار فروشگاه کم شده است.
        */}
      <td className="whitespace-nowrap" title={STOCK_PICK_TEXT.columnExplainer}>
        {source ? (
          <span className="font-bold text-sky-800">{source}</span>
        ) : (
          <span className="kbd">{STOCK_PICK_TEXT.emptyCell}</span>
        )}
      </td>
      <td>
        <button className="text-brand" onClick={() => onReprint(r.id)} title="چاپ دوباره‌ی رسید این فاکتور">
          چاپ فیش
        </button>
      </td>
    </tr>
  )
}

/** نمایش تفکیک‌شده‌ی روز → شیفت (چک‌باکس «جداسازی بر اساس شیفت»). */
function ShiftGroups({
  groups,
  onReprint,
  onOpenCreditSettlement,
  cols,
  sourceOf
}: {
  groups: SaleReportResult['groups']
  onReprint: (id: number) => void
  onOpenCreditSettlement?: (invoiceId: number) => void
  /** همان چیدمان عرض ستون‌های تب «سرجمع فروش» (مشترک با جدول بدون تفکیک) */
  cols: ResizableColumns
  /** جلسه ۵۳ — «مبدأ کسر» هر فاکتور، از همان هوک مشترک صفحه (پیش‌فرض: خالی) */
  sourceOf?: (invoiceId: number) => string
}) {
  if (!groups.length)
    return <div className="text-center py-10 text-slate-400">در این بازه فروشی ثبت نشده است</div>
  return (
    <table className={cols.tableClass} ref={cols.tableRef}>
      <ColGroup widths={cols.widths} />
      <thead className="sticky top-0">
        <tr>
          <ResizableHeaderCells headers={SUMMARY_HEADERS} cols={cols} extraColumns={1} />
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => (
          <Fragment key={g.key}>
            <tr className="bg-brand/15 font-bold">
              <td colSpan={SUMMARY_HEADERS.length + 1}>
                {faDigits(g.dayJalali)} · {g.shiftName}
                {g.openedAt ? ` · شروع ${faDigits(g.openedAt)}` : ''}
                {g.closedAt ? ` · پایان ${faDigits(g.closedAt)}` : g.shiftId ? ' · (شیفت باز است)' : ''}
                {` · ${faDigits(g.totals.count)} فاکتور · جمع ${money(g.totals.grandTotal)} ریال`}
              </td>
            </tr>
            {/**
              * جلسه ۱۹ · بند ۱ — ریز هر «نشست» جدا، ولی سرجمع همان نام‌شیفت
              * تجمیع همه‌ی نشست‌های آن روز است (ردیف «جمع» پایین‌تر).
              */}
            {(g.sessions ?? []).length > 1
              ? (g.sessions ?? []).map((sg) => (
                  <Fragment key={sg.key}>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={SUMMARY_HEADERS.length + 1}>
                        ↳ {sg.sessionLabel}
                        {sg.openedAt ? ` · شروع ${faDigits(sg.openedAt)}` : ''}
                        {sg.closedAt ? ` · پایان ${faDigits(sg.closedAt)}` : ' · (باز)'}
                        {` · ${faDigits(sg.totals.count)} فاکتور · جمع ${money(sg.totals.grandTotal)} ریال`}
                      </td>
                    </tr>
                    {sg.rows.map((r) => (
                      <SummaryRow
                        key={r.id}
                        r={r}
                        onReprint={onReprint}
                        onOpenCreditSettlement={onOpenCreditSettlement}
                        source={sourceOf?.(r.id) ?? ''}
                      />
                    ))}
                  </Fragment>
                ))
              : g.rows.map((r) => (
                  <SummaryRow
                        key={r.id}
                        r={r}
                        onReprint={onReprint}
                        onOpenCreditSettlement={onOpenCreditSettlement}
                        source={sourceOf?.(r.id) ?? ''}
                      />
                ))}
            <tr className="bg-slate-100 font-bold">
              <td colSpan={7}>جمع {g.shiftName} (همه‌ی نشست‌ها)</td>
              <td>{money(g.totals.goodsTotal)}</td>
              <td>{money(g.totals.taxTotal)}</td>
              <td>{money(g.totals.serviceTotal)}</td>
              <td>{money(g.totals.discountTotal)}</td>
              <td>{money(g.totals.deliveryTotal)}</td>
              <td>{money(g.totals.grandTotal)}</td>
              <td>{money(g.totals.cashTotal)}</td>
              <td className={g.totals.storeCreditUsedTotal > 0 ? 'bg-violet-50 text-violet-950' : ''}>{money(g.totals.storeCreditUsedTotal)}</td>
              <td>{money(cardOnlyOf(g.totals))}</td>
              <td className={managerAccountOf(g.totals) > 0 ? 'text-amber-800' : ''}>
                {money(managerAccountOf(g.totals))}
              </td>
              <td>{money(otherOrUnknownOf(g.totals))}</td>
              {/* جلسه ۵۳ — «کد فاکتور» + «مبدأ کسر» + ستون دکمه‌ها */}
              <td colSpan={3}></td>
            </tr>
            {/* مورد ۲: همان دو عدد، برای هر شیفت جدا */}
            <tr className="bg-amber-50 font-bold">
              <td colSpan={SUMMARY_HEADERS.length + 1}>
                جمع کل تخفیف‌های {g.shiftName}: {money(g.totals.discountTotal)} ریال · جمع پس از تخفیف:{' '}
                {money(Math.max(0, g.totals.goodsTotal - g.totals.discountTotal))} ریال
              </td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  )
}

function emptyTotals(): SaleReportTotals {
  return {
    count: 0,
    goodsTotal: 0,
    taxTotal: 0,
    serviceTotal: 0,
    discountTotal: 0,
    deliveryTotal: 0,
    grandTotal: 0,
    cashTotal: 0,
    cardTotal: 0,
    creditTotal: 0,
    otherTotal: 0,
  /** کار الف (جلسه ۳۶) — همیشه پر می‌شوند، حتی صفر */
  managerAccountTotal: 0,
  destinationUnknownTotal: 0,
    receivedTotal: 0,
    returnedTotal: 0,
    // بخش ۶ و ۸ — همان فیلدهایی که در reportShape.emptyTotals هم هستند
    exchangeCreditTotal: 0,
    storeCreditUsedTotal: 0,
    storeCreditIssuedTotal: 0,
    exchangeCount: 0,
    exchangeDiffTotal: 0,
    overpayTotal: 0,
    creditRemainingTotal: 0,
    priorSettlementTotal: 0,
    // جلسه ۲۴ — پنج عضوِ افزوده‌ی جلسه ۱۴ اینجا جا افتاده بود و build را می‌شکست
    exchangeReturnedTotal: 0,
    refundCashTotal: 0,
    refundCardTotal: 0,
    refundDebtOnlyTotal: 0,
    storeCreditRefundTotal: 0,
    legacyRefundCount: 0,
    netReceivedTotal: 0
  }
}

/**
 * یک ردیف تب «تعویض کالا» به شکل آرایه (برای چاپ A4 و خروجی اکسل).
 *
 * `pendingQty` را *صدازننده* می‌دهد (از هوک مشترک `usePendingRestock`)، چون
 * `ExchangeReportRow` این فیلد را از سرور نمی‌گیرد و این فایل نباید عددش را خودش
 * حساب کند. پیش‌فرض صفر ⇒ هر صدازننده‌ی قدیمی همان ستون خالی را می‌بیند، نه خطا.
 */
function exchangeRowValues(
  r: ExchangeReportResult['rows'][number],
  pendingQty = 0
): (string | number)[] {
  return [
    r.receiptNo,
    r.exchangeReceiptNo ?? '',
    r.dateJalali,
    r.time,
    r.shiftName,
    r.customerName,
    itemsLabel(r.returnedItems),
    r.returnTotal,
    Math.max(0, Math.round(pendingQty)),
    itemsLabel(r.replacementItems),
    r.exchangeTotal,
    // جلسه ۵۰ · مرحله ۱-ب — همان ستون «مبدأ برداشت» جدول، در چاپ A4 و اکسل
    exchangeSourceOf(r.note),
    r.diff,
    r.settlementLabel,
    r.cashReceived,
    r.cardReceived,
    r.storeCreditReference ?? '',
    r.storeCreditAmount,
    r.storeCreditStatusLabel ?? ''
  ]
}

/**
 * جدول تب «تعویض کالا» (بخش ۶).
 * منبعش `IPC.saleExchangeList` است و هیچ محاسبه‌ای اینجا انجام نمی‌شود؛ حتی
 * «نقد واقعی دریافتی» همان عددی است که سرویس — با کنار گذاشتن ردیف‌های
 * غیرنقدی EXCHANGE_CREDIT / STORE_CREDIT — حساب کرده است.
 */
function ExchangeTable({
  data,
  cols,
  onPrint,
  onVoid,
  onCorrection,
  pending
}: {
  data: ExchangeReportResult
  cols: ResizableColumns
  onPrint: (returnId: number) => void
  /** نشست ۶۵ · بند ۴-۲۲ — ابطال اتمیک کل گراف تعویض (با دلیل اجباری) */
  onVoid?: (row: ExchangeReportResult['rows'][number]) => void
  /** دفتر جبرانی، برای وقتی که پول/اعتبار/کالا واقعاً جابه‌جا شده و void ساده امن نیست. */
  onCorrection?: (row: ExchangeReportResult['rows'][number]) => void
  /** خلاصه‌ی معلقِ مشترک — همان شیئی که تب برگشت و سه صفحه‌ی دیگر مصرف می‌کنند */
  pending: PendingRestockView
}) {
  const t = data.totals
  return (
    <table className={cols.tableClass} ref={cols.tableRef}>
      <ColGroup widths={cols.widths} />
      <thead className="sticky top-0">
        <tr>
          <ResizableHeaderCells headers={EXCHANGE_HEADERS} cols={cols} extraColumns={1} />
        </tr>
      </thead>
      <tbody>
        {data.rows.map((r) => (
          <tr key={r.returnId} className={r.storeCreditReference ? 'bg-amber-50' : ''}>
            <td className="font-bold">{faDigits(r.receiptNo)}</td>
            <td className="font-bold">{r.exchangeReceiptNo ? faDigits(r.exchangeReceiptNo) : '—'}</td>
            <td>{faDigits(r.dateJalali)}</td>
            <td>{faDigits(r.time)}</td>
            <td>{r.shiftName}</td>
            <td>{r.customerName}</td>
            <td className="max-w-[240px] whitespace-normal">{itemsLabel(r.returnedItems) || '—'}</td>
            <td>{money(r.returnTotal)}</td>
            {/* معلق برگشتی — خواندنی، از هوک مشترک، بدون هیچ دکمه‌ای */}
            <td
              className="whitespace-nowrap"
              title={pending.qtyOfReturn(r.returnId) ? PENDING_RESTOCK_EXPLAINER : undefined}
            >
              {pending.qtyOfReturn(r.returnId) ? (
                <PendingStockBadge qty={pending.qtyOfReturn(r.returnId)} tone={pending.tone} />
              ) : (
                <span className="kbd">—</span>
              )}
            </td>
            <td className="max-w-[240px] whitespace-normal">{itemsLabel(r.replacementItems) || '—'}</td>
            <td>{money(r.exchangeTotal)}</td>
            {/* جلسه ۵۰ · مرحله ۱-ب — «مبدأ برداشت» کالای جایگزین (خواندنی) */}
            <td className="whitespace-nowrap" title={exchangeSourceOf(r.note) ? EXCHANGE_SOURCE_EXPLAINER : undefined}>
              {exchangeSourceOf(r.note) ? (
                <span className="font-bold text-sky-800">{exchangeSourceOf(r.note)}</span>
              ) : (
                <span className="kbd">—</span>
              )}
            </td>
            <td className={`font-bold ${r.diff < 0 ? 'text-amber-700' : r.diff > 0 ? 'text-emerald-700' : ''}`}>
              {money(r.diff)}
            </td>
            <td>{r.settlementLabel}</td>
            <td>{money(r.cashReceived)}</td>
            <td>{money(r.cardReceived)}</td>
            <td dir="ltr" className="font-bold">
              {r.storeCreditReference ?? '—'}
            </td>
            <td>{r.storeCreditAmount ? money(r.storeCreditAmount) : '—'}</td>
            <td>{r.storeCreditStatusLabel ?? '—'}</td>
            <td>
              <button className="text-brand" onClick={() => onPrint(r.returnId)} title="چاپ دوباره‌ی سند تعویض">
                چاپ سند
              </button>
              {onVoid && (
                <button
                  className="text-red-600 mr-2"
                  onClick={() => onVoid(r)}
                  title="ابطال کل تعویض (سند برگشت، سند تعویض، اعتبار و اثر انبار با هم؛ سندها با مهر «باطل» و دلیل می‌مانند)"
                >
                  ابطال
                </button>
              )}
              {onCorrection && (
                <button
                  className="text-amber-700 mr-2"
                  onClick={() => onCorrection(r)}
                  title="ثبت اثرهای جبرانی تعویض بدون حذف یا تغییر اسناد مبدأ"
                >
                  اصلاح جبرانی
                </button>
              )}
            </td>
          </tr>
        ))}
        {!data.rows.length && (
          <tr>
            <td colSpan={EXCHANGE_HEADERS.length + 1} className="text-center py-10 text-slate-400">
              در این بازه تعویض کالایی ثبت نشده است
            </td>
          </tr>
        )}
      </tbody>
      {!!data.rows.length && (
        <tfoot className="sticky bottom-0">
          <tr className="bg-slate-100 font-bold">
            <td colSpan={6}>جمع {faDigits(t.count)} تعویض</td>
            <td></td>
            <td>{money(t.returnTotal)}</td>
            <td className="tabular-nums" title={PENDING_RESTOCK_EXPLAINER}>
              {faDigits(data.rows.reduce((s, r) => s + pending.qtyOfReturn(r.returnId), 0))}
            </td>
            <td></td>
            <td>{money(t.exchangeTotal)}</td>
            <td></td>
            <td>{money(t.diffTotal)}</td>
            <td></td>
            <td>{money(t.cashReceivedTotal)}</td>
            <td>{money(t.cardReceivedTotal)}</td>
            <td></td>
            <td>{money(t.creditIssuedTotal)}</td>
            <td colSpan={2}></td>
          </tr>
          <tr className="bg-amber-50 font-bold">
            <td colSpan={EXCHANGE_HEADERS.length + 1}>
              اعتبار صادرشده‌ی این بازه: {money(t.creditIssuedTotal)} ریال (بدهی ما به مشتری) · از این مبلغ{' '}
              {money(t.creditUsedTotal)} ریال مصرف شده است · دریافت نقدی و کارتی عمداً فقط پول واقعی هستند و ارزش کالای
              برگشتی در آن‌ها شمرده نمی‌شود.
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  )
}

/** یک ردیف «بدهکاران» تب نسیه به شکل آرایه (چاپ A4 و خروجی اکسل). */
function creditRowValues(r: CreditInvoiceRow): (string | number)[] {
  return [
    r.receiptNo,
    r.dateJalali,
    r.time,
    r.orderTypeLabel,
    r.customerName,
    r.customerPhone ?? '',
    r.grandTotal,
    r.paidTotal,
    r.remaining,
    r.settlementLabel,
    r.pendingChequeTotal,
    r.paymentCount,
    r.lastPaymentJalali
      ? `${r.lastPaymentJalali} ${r.lastPaymentTime ?? ''}${r.lastPaymentBackdated ? ' · ثبت با تاریخ قبل' : ''}`.trim()
      : '',
    r.ageDays,
    r.overpayTotal,
    r.settledAtJalali ?? '',
    r.shiftName,
    r.userName
  ]
}

/** یک ردیف «تسویه‌ی نسیه‌ی بازه‌های قبل» به شکل آرایه. */
function settlementRowValues(r: CreditSettlementRow): (string | number)[] {
  return [
    r.receiptNo,
    r.customerName,
    r.paidAtJalali,
    r.paidAtTime,
    r.amount,
    r.methodLabel,
    r.kind === 'CHEQUE' ? 'چک' : 'نقدی/کارتی',
    r.invoiceDateJalali,
    r.label,
    r.settledInvoice ? 'بله' : 'نه',
    r.overpayAmount
  ]
}

/**
 * ===================== جدول‌های تب «نسیه» (بخش ۷) =====================
 * هیچ محاسبه‌ای اینجا انجام نمی‌شود: همه‌ی عددها — باقی‌ماندهٔ بدهی، سن بدهی،
 * چک در جریان، برچسب «تسویه‌ی نسیه‌ی ۱۴۰۵/۰۴» — همان چیزی است که
 * `salesService.creditList` برگردانده، پس گزارش و پنجره‌ی پرداختی‌ها هیچ‌وقت دو
 * عدد متفاوت نشان نمی‌دهند.
 *
 * ثبت پرداختی جدید عمداً *همان* پنجره‌ی «پرداختی‌ها / اقساط» فاکتور است (نه یک
 * فرم دوم و موازی): تاریخ و ساعتش پیش‌فرض «همین لحظه» است و دستی هم قابل تغییر،
 * چک و اضافه‌پرداخت و حذف پرداختی اشتباه هم همان‌جا هست.
 * =====================================================================
 */
function CreditTables({
  data,
  cols,
  settlementCols,
  onPayments,
  onReprint
}: {
  data: CreditReportResult
  cols: ResizableColumns
  settlementCols: ResizableColumns
  onPayments: (invoiceId: number) => void
  onReprint: (invoiceId: number) => void
}) {
  const t = data.totals
  return (
    <div className="flex flex-col">
      <div className="p-2 font-bold border-b bg-slate-50 sticky top-0 z-20">
        بدهکاران این بازه (فاکتورهای تسویه‌نشده و نیمه‌تسویه)
      </div>
      <table className={cols.tableClass} ref={cols.tableRef}>
        <ColGroup widths={cols.widths} />
        <thead className="sticky top-9">
          <tr>
            <ResizableHeaderCells headers={CREDIT_HEADERS} cols={cols} extraColumns={1} />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.id} className={r.settled ? 'bg-emerald-50' : r.remaining > 0 ? 'bg-amber-50' : ''}>
              <td className="font-bold">{faDigits(r.receiptNo)}</td>
              <td>{faDigits(r.dateJalali)}</td>
              <td>{faDigits(r.time)}</td>
              <td>{r.orderTypeLabel}</td>
              <td>{r.customerName}</td>
              <td dir="ltr">{r.customerPhone ? faDigits(r.customerPhone) : '—'}</td>
              <td className="font-bold">{money(r.grandTotal)}</td>
              <td>{money(r.paidTotal)}</td>
              <td className={`font-bold ${r.remaining > 0 ? 'text-amber-800' : 'text-emerald-800'}`}>
                {money(r.remaining)}
              </td>
              <td className={r.settled ? 'text-emerald-700' : 'text-amber-700 font-bold'}>{r.settlementLabel}</td>
              <td className={r.pendingChequeTotal > 0 ? 'text-amber-700 font-bold' : ''}>
                {r.pendingChequeTotal > 0 ? money(r.pendingChequeTotal) : '—'}
              </td>
              <td className="text-center">{faDigits(r.paymentCount)}</td>
              <td>
                {r.lastPaymentJalali ? (
                  <>
                    {faDigits(r.lastPaymentJalali)} <span className="kbd">{faDigits(r.lastPaymentTime ?? '')}</span>
                    {r.lastPaymentBackdated ? (
                      <span className="kbd ms-1" title="تاریخ کسب‌وکار این پرداختی قبل از روز ثبت است">
                        ثبت با تاریخ قبل
                      </span>
                    ) : null}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className={`text-center ${r.ageDays > 30 && r.remaining > 0 ? 'text-rose-700 font-bold' : ''}`}>
                {faDigits(r.ageDays)}
              </td>
              <td className={r.overpayTotal > 0 ? 'text-amber-700 font-bold' : ''}>
                {r.overpayTotal > 0 ? money(r.overpayTotal) : '—'}
              </td>
              <td>{r.settledAtJalali ? faDigits(r.settledAtJalali) : '—'}</td>
              <td>{r.shiftName}</td>
              <td>{r.userName}</td>
              <td className="whitespace-nowrap">
                <button
                  className="text-brand font-bold"
                  onClick={() => onPayments(r.id)}
                  title="ثبت پرداختی جدید (تاریخ و ساعت پیش‌فرض «همین حالا» و قابل تغییر دستی)، ثبت چک، و تاریخچه‌ی پرداختی‌ها"
                >
                  ثبت پرداختی
                </button>
                <span className="opacity-40 px-1">|</span>
                <button className="text-brand" onClick={() => onReprint(r.id)} title="چاپ دوباره‌ی رسید این فاکتور">
                  چاپ فیش
                </button>
              </td>
            </tr>
          ))}
          {!data.rows.length && (
            <tr>
              <td colSpan={CREDIT_HEADERS.length + 1} className="text-center py-10 text-slate-400">
                در این بازه فاکتور نسیه‌ای (تسویه‌نشده) ثبت نشده است
              </td>
            </tr>
          )}
        </tbody>
        {!!data.rows.length && (
          <tfoot className="sticky bottom-0">
            <tr className="bg-slate-100 font-bold">
              <td colSpan={6}>
                جمع {faDigits(t.count)} فاکتور · {faDigits(t.unpaidCount)} بدون پرداختی · {faDigits(t.partialCount)}{' '}
                نیمه‌تسویه · {faDigits(t.settledCount)} تسویه‌شده
              </td>
              <td>{money(t.grandTotal)}</td>
              <td>{money(t.paidTotal)}</td>
              <td className="text-amber-800">{money(t.remainingTotal)}</td>
              <td></td>
              <td>{money(t.pendingChequeTotal)}</td>
              <td colSpan={3}></td>
              <td>{money(t.overpayTotal)}</td>
              <td colSpan={4}></td>
            </tr>
            <tr className="bg-amber-50 font-bold">
              <td colSpan={CREDIT_HEADERS.length + 1}>
                جمع بدهی وصول‌نشده‌ی این بازه: {money(t.remainingTotal)} ریال
                {t.pendingChequeTotal > 0
                  ? ` · از این مبلغ ${money(t.pendingChequeTotal)} ریال چک در جریان است (با پاس شدن، بدهی ${money(
                      Math.max(0, t.remainingTotal - t.pendingChequeTotal)
                    )} ریال می‌شود).`
                  : ''}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {/* ---------- جدول دوم: تسویه‌ی نسیه‌ی بازه‌های قبل ---------- */}
      <div className="p-2 font-bold border-y bg-slate-50 mt-2">
        تسویه‌ی نسیه‌ی بازه‌های قبل — پولی که در این بازه بابت فاکتورهای قدیمی‌تر گرفته شده است
      </div>
      <table className={settlementCols.tableClass} ref={settlementCols.tableRef}>
        <ColGroup widths={settlementCols.widths} />
        <thead>
          <tr>
            <ResizableHeaderCells headers={SETTLEMENT_HEADERS} cols={settlementCols} />
          </tr>
        </thead>
        <tbody>
          {data.priorSettlements.map((r) => (
            <tr key={r.paymentId} className={r.kind === 'CHEQUE' ? 'bg-amber-50' : ''}>
              <td className="font-bold">{faDigits(r.receiptNo)}</td>
              <td>{r.customerName}</td>
              <td>{faDigits(r.paidAtJalali)}</td>
              <td>{faDigits(r.paidAtTime)}</td>
              <td className="font-bold">{money(r.amount)}</td>
              <td>{r.methodLabel}</td>
              <td>{r.kind === 'CHEQUE' ? 'چک' : 'نقدی/کارتی'}</td>
              <td>{faDigits(r.invoiceDateJalali)}</td>
              <td>{r.label}</td>
              <td className={r.settledInvoice ? 'text-emerald-700 font-bold' : ''}>
                {r.settledInvoice ? 'بله ✔' : '—'}
              </td>
              <td className={r.overpayAmount > 0 ? 'text-amber-700 font-bold' : ''}>
                {r.overpayAmount > 0 ? money(r.overpayAmount) : '—'}
              </td>
            </tr>
          ))}
          {!data.priorSettlements.length && (
            <tr>
              <td colSpan={SETTLEMENT_HEADERS.length} className="text-center py-8 text-slate-400">
                در این بازه پرداختی‌ای بابت نسیه‌ی بازه‌های قبل ثبت نشده است
              </td>
            </tr>
          )}
        </tbody>
        {!!data.priorSettlements.length && (
          <tfoot>
            <tr className="bg-slate-100 font-bold">
              <td colSpan={4}>جمع {faDigits(data.priorSettlements.length)} پرداختی</td>
              <td>{money(t.priorSettlementTotal)}</td>
              <td colSpan={6}></td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}


/**
 * ===========================================================================
 * جلسه ۲۴ — تب «مدیریت اعتبار خرید»
 *
 * چرا کامپوننت مستقل؟ عیناً دلیل جلسه ۱۸: این فایل از قبل بلند است و تب‌های
 * سالم فعلی نباید دست بخورند. قفل، فیلتر و درخواست‌های این تب کاملاً داخل
 * خودش است، پس `load()` صفحه‌ی میزبان هیچ درخواستی برایش نمی‌فرستد.
 *
 * ⚠️ تب legacy `storeCredits` (کانال `storeCreditList`) دست‌نخورده باقی مانده و
 * این تب هیچ حالتی را با آن مشترک ندارد.
 *
 * نکته‌ی فیلتر (قطعیِ جلسه ۲۲): `creditList` بدون `search`/`batchId` پیش‌فرض
 * `fromJalali` را «امروز» می‌گذارد، پس بازه همیشه **صریح** فرستاده می‌شود.
 * ===========================================================================
 */
/**
 * جلسه ۳۴ — قالب‌گرهای نمایشیِ تزریق‌شده به `creditCellText`.
 * تا دیروز *چاپِ* یک سلول دو کپیِ جدا داشت (همین‌جا و `CreditManagement.tsx`)؛
 * حالا یک تابع مشترک است و این شیء فقط `money`/`faDigits` واقعی را می‌دهد.
 */
const CREDIT_CELL_FMT = { money, fa: faDigits }

function CreditManagementReport({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  /** با خاموش شدن قفل، خود ManagerGate و loader این تب باید یک تصمیم بگیرند. */
  const open = usePanelOpen(PANEL_KEYS.creditManagement)
  const [dashboard, setDashboard] = useState<CreditDashboard | null>(null)
  const [rows, setRows] = useState<StoreCreditSafeRow[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [onlyWithRemaining, setOnlyWithRemaining] = useState(false)
  /**
   * ممیزی A101-01 (AUDIT-D32) — skip به امضای فیلتر گره خورده؛ با عوض شدن بازه‌ی نوار
   * (prop) یا فیلترهای همین تب، صفحه خودکار اول می‌شود (قبلاً بازه skip را صفر نمی‌کرد ⇒ صفحه‌ی خالی).
   */
  const creditSignature = creditSelectionResetSignature({ fromJalali, toJalali, search, source, status, onlyWithRemaining })
  const [creditSkipState, setCreditSkipState] = useState<{ signature: string; skip: number }>({ signature: '', skip: 0 })
  const creditSkip = creditEffectiveSkip(creditSkipState, creditSignature)
  const setCreditSkip = (skip: number) => setCreditSkipState({ signature: creditSignature, skip })
  const [creditPage, setCreditPage] = useState<SaleReportPage | null>(null)
  const [busy, setBusy] = useState(false)
  /** کدام دکمه‌ی خروجی همین حالا مشغول است (سه خروجیِ `lazy` داده‌شان را با کلیک می‌گیرند). */
  const [exporting, setExporting] = useState<CreditExportKind | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    // تا قفل باز نشده، هیچ درخواستی فرستاده نمی‌شود (همان قاعده‌ی تب نسیه)
    if (!open) {
      setDashboard(null)
      setRows([])
      setCreditPage(null)
      return
    }
    setBusy(true)
    setErr(null)
    try {
      /**
       * جلسه ۳۳ — بار داده‌ی هر دو کانال از بخش ۱۳ `creditUi.ts` می‌آید.
       * دو چیزی که تا دیروز اینجا پنهان بود: `take` دست‌ساز (این تب ۱۰۰۰
       * می‌فرستاد و صفحه‌ی مدیریت اعتبار ۵۰۰) و — مهم‌تر —
       * `onlyWithRemaining` که **فقط `creditList` به آن اثر می‌دهد**؛ همان شیء
       * فیلتر به داشبورد هم می‌رفت، پس کاربر تیک را می‌زد، جدول کم می‌شد و
       * کارت‌های بالا دست‌نخورده می‌ماندند بدون هیچ توضیحی.
       */
      const req = creditReportRequests({
        fromJalali,
        toJalali,
        status,
        source,
        search,
        onlyWithRemaining,
        skip: creditSkip
      })
      const [d, list] = await Promise.all([
        call<CreditDashboard>(CH.creditDashboard, req.dashboard.payload),
        call<PagedRows<StoreCreditSafeRow>>(CH.creditList, req.list.payload)
      ])
      setDashboard(d)
      setRows(list ?? [])
      setCreditPage(list?.page ?? null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [open, fromJalali, toJalali, status, source, search, onlyWithRemaining, creditSkip])

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fromJalali, toJalali, status, source, onlyWithRemaining, creditSkip])

  const cards = dashboardCards(dashboard)

  /**
   * جلسه ۳۲ — ردیف «جمع» این تب هم از `creditListTotals` می‌آید.
   * نسخه‌ی قبلی سه جمع را خودش می‌گرفت و با `Array(CREDIT_LIST_HEADERS.length - 6)`
   * دستی pad می‌کرد؛ یعنی اضافه شدن یک ستون *وسط* `CREDIT_LIST_HEADERS` بی‌صدا
   * جمع را زیر ستون اشتباه می‌برد و هیچ تستی نمی‌فهمید. حالا طول ردیف و
   * ستون‌های جمع‌دار از خودِ لایه‌ی مشترک می‌آیند و جدولِ روی صفحه و فایل اکسل
   * از یک ردیف واحد ساخته می‌شوند.
   */
  const listRows = useMemo(() => rows.map((r) => creditListRow(r)), [rows])
  const listTotals = useMemo(() => creditListScreenTotals(listRows), [listRows])

  /**
   * جلسه ۳۲ · §۱۵ — خروجی اکسل *هر* گزارش بازه‌ای، عیناً الگوی
   * `CreditManagement.tsx` (`doExport`): جفت‌شدن سرستون با ردیف‌ساز و ردیف جمع
   * تصمیمِ تست‌شده‌ی `creditExport` است، و «داده‌ی هر دکمه از کجا می‌آید»
   * تصمیمِ `creditRangeExportOrigin`/`creditRangeExportRequest`. سه گزارشِ
   * `lazy` (دسته‌ها، نامزدهای یادآوری، لاگ یادآوری) در بار اول تب خوانده
   * نمی‌شوند و داده‌شان فقط با همین کلیک گرفته می‌شود تا تب سبک بماند.
   */
  const doExport = async (kind: CreditExportKind) => {
    const origin = creditRangeExportOrigin(kind)
    if (origin === 'none') return
    setErr(null)
    setExporting(kind)
    try {
      let data: any = null
      if (origin === 'rows') data = rows
      else if (origin === 'dashboard') data = dashboard
      else {
        const req = creditRangeExportRequest(kind, { fromJalali, toJalali, source: source || undefined })
        data = creditRangeExportRows(req, req ? await call<any>(CH[req.channel], req.payload) : null)
      }
      const sheet = creditExport(kind, data)
      if (!sheet) {
        setMsg('این گزارش در این بازه خالی است، پس فایلی ساخته نشد.')
        return
      }
      const res = await exportTable({
        fileName: sheet.fileName,
        sheetName: sheet.sheetName,
        title: `${sheet.sheetName} — از ${faDigits(fromJalali)} تا ${faDigits(toJalali)}`,
        headers: sheet.headers,
        rows: sheet.rows,
        totals: sheet.totals
      })
      setMsg(res.canceled ? 'خروجی اکسل لغو شد.' : `فایل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setExporting(null)
    }
  }

  return (
    <ManagerGate
      panel={PANEL_KEYS.creditManagement}
      title="مدیریت اعتبار خرید"
      reason="این گزارش بدهی اعتباری فروشگاه را نشان می‌دهد و قفل مستقل خودش را دارد؛ رمز دومش را می‌توانید فقط به حسابدار بدهید."
      inline
    >
      <div className="space-y-2">
        {/* ---------------- خلاصه‌ی داشبورد ---------------- */}
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
          {cards.map((c) => (
            <div key={c.key} className={`rounded border p-2 ${TONE_CLASS[c.tone] ?? TONE_CLASS.plain}`}>
              <div className="text-xs font-bold">{c.title}</div>
              <div className="text-lg">{c.kind === 'money' ? money(c.value) : faDigits(c.value)}</div>
              {!!c.hint && <div className="kbd">{c.hint}</div>}
            </div>
          ))}
          {!cards.length && !busy && (
            <div className="col-span-full text-slate-400 text-center py-4">
              در این بازه هیچ اعتباری ثبت نشده است
            </div>
          )}
        </div>

        {/* ---------------- فیلترهای مستقل این تب ---------------- */}
        <div className="bg-white rounded shadow p-2 flex gap-2 flex-wrap items-end">
          <label className="flex-1 min-w-48">
            جست‌وجو
            <input
              className="inp"
              value={search}
              placeholder="جست‌وجوی عادی در این گزارش غیرفعال است؛ کد اعتبار فقط در مسیر مصرف بررسی می‌شود"
              disabled
              onChange={(e) => {
                setCreditSkip(0)
                setSearch(e.target.value)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void load()
              }}
            />
          </label>
          <label>
            وضعیت
            <select
              className="inp"
              value={status}
              onChange={(e) => {
                setCreditSkip(0)
                setStatus(e.target.value)
              }}
            >
              <option value="">همه</option>
              {CREDIT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            نوع
            <select
              className="inp"
              value={source}
              onChange={(e) => {
                setCreditSkip(0)
                setSource(e.target.value)
              }}
            >
              <option value="">همه</option>
              {CREDIT_SOURCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1" title={CREDIT_LIST_ONLY_HINT}>
            <input
              type="checkbox"
              checked={onlyWithRemaining}
              onChange={(e) => {
                setCreditSkip(0)
                setOnlyWithRemaining(e.target.checked)
              }}
            />
            فقط اعتبارهای دارای باقی‌مانده
            <span className="kbd">{CREDIT_LIST_ONLY_HINT}</span>
          </label>
          <button className="btn" onClick={() => void load()} disabled={busy}>
            {busy ? 'در حال خواندن…' : 'تهیه گزارش'}
          </button>
        </div>

        {/* ---------------- خروجی اکسل هر گزارش بازه‌ای (§۱۵) ---------------- */}
        <div className="bg-white rounded shadow p-2 flex gap-2 flex-wrap items-center">
          <span className="font-bold text-sm">خروجی اکسل:</span>
          {CREDIT_RANGE_EXPORTS.map((e) => {
            /* جلسه ۳۴ — «این دکمه همین حالا داده دارد؟» تصمیمِ
               `creditRangeExportDisabled` است (خروجی‌های `lazy` هیچ‌وقت به این
               دلیل غیرفعال نمی‌شوند، چون داده‌شان با کلیک می‌آید). */
            const emptyOnPage = creditRangeExportDisabled(e.kind, { rows, dashboard })
            return (
              <button
                key={e.kind}
                className="btn py-1"
                onClick={() => void doExport(e.kind)}
                disabled={busy || exporting !== null || emptyOnPage}
                title={e.lazy ? 'داده‌ی این خروجی فقط با همین کلیک خوانده می‌شود' : undefined}
              >
                {exporting === e.kind ? `${e.label} …` : e.label}
                {e.lazy ? ' ⤓' : ''}
              </button>
            )
          })}
          <span className="kbd">
            سوابق مصرف و تاریخچه‌ی یک اعتبار، خروجیِ صفحه‌ی «مدیریت اعتبار خرید» است (گزارش بازه‌ای نیست).
          </span>
        </div>

        {err && <div className="rounded border border-rose-300 bg-rose-50 p-2 text-rose-800">{err}</div>}
        {msg && <div className="rounded border border-emerald-300 bg-emerald-50 p-2 text-emerald-800">{msg}</div>}

        {/* ---------------- فهرست ---------------- */}
        <div className="tbl-card overflow-auto">
          <table className="tbl">
            <thead className="sticky top-14 bg-white z-10">
              <tr>
                {CREDIT_LIST_SCREEN_HEADERS.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* جلسه ۳۳ — ردیف روی صفحه هم از همان ردیف‌سازِ فایل اکسل می‌آید
                  (`creditListScreenRow`) و قالب هر ستون از `creditListCellFormat`.
                  چهارده `<td>` دست‌نویس رفت: ستونِ «نوع» در همین تب برای
                  ردیف‌های قدیمی خالی می‌ماند چون `sourceLabel` را بی‌fallback
                  می‌خواند، و اضافه‌شدن یک ستون وسط سرستون‌ها بی‌صدا داده را
                  زیر سرستون اشتباه می‌برد. */}
              {rows.map((r) => (
                <tr key={r.id}>
                  {creditListScreenRow(r).map((cell, i) => (
                    <td key={i} className="whitespace-nowrap">
                      {creditCellText(cell, creditListCellFormat(i), CREDIT_CELL_FMT)}
                    </td>
                  ))}
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={CREDIT_LIST_SCREEN_COLUMNS} className="text-center py-8 text-slate-400">
                    ردیفی برای این فیلترها پیدا نشد
                  </td>
                </tr>
              )}
            </tbody>
            {!!rows.length && (
              <tfoot>
                {/* هم‌ترازی با سرستون از `creditListTotals` می‌آید، نه از colSpan دستی */}
                <tr className="bg-slate-100 font-bold">
                  {listTotals.map((cell, i) => (
                    <td key={i}>
                      {i === 0 ? faDigits(creditListTotalsLabel(rows.length)) : creditCellText(cell, creditListCellFormat(i), CREDIT_CELL_FMT)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
        {(() => {
          const pager = creditListPager(creditPage, rows.length, faDigits)
          if (!pager.visible) return null
          return (
            <div className="flex flex-col items-center gap-1">
              {pager.warning && (
                <div className="rounded border-2 border-red-500 bg-red-50 p-2 text-xs leading-6 text-red-700">⚠ {pager.warning}</div>
              )}
              <div className="flex items-center justify-center gap-2">
                <button className="btn" disabled={busy || pager.prevSkip == null} onClick={() => setCreditSkip(pager.prevSkip ?? 0)}>
                  صفحه‌ی قبل
                </button>
                <span className="kbd">
                  نمایش {faDigits(pager.from)} تا {faDigits(pager.to)} از {faDigits(pager.total)}
                </span>
                <button className="btn" disabled={busy || pager.nextSkip == null} onClick={() => setCreditSkip(pager.nextSkip ?? 0)}>
                  صفحه‌ی بعد
                </button>
              </div>
            </div>
          )
        })()}
        <div className="kbd">
          این تب از همان کانال‌های ماژول «مدیریت اعتبار خرید» می‌خواند؛ برای صدور، عملیات مدیریتی و چاپ سند به
          صفحه‌ی «مدیریت اعتبار خرید» بروید. تب «اعتبار خرید» کنار همین تب، گزارش قدیمیِ اعتبارهای تعویض کالا است.
        </div>
      </div>
    </ManagerGate>
  )
}
