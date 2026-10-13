import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { isPrintCancelledError } from '../lib/printErrors'
import { exportTable } from '../lib/exportCsv'
import ReportFilterBar, { todayFilters, toServiceFilter, type ReportFilters } from '../components/ReportFilterBar'
import ConfirmDialog from '../components/ConfirmDialog'
import ShiftDetailModal from '../components/ShiftDetailModal'
import ShiftSessionModal, { type SessionMode } from '../components/ShiftSessionModal'
import { faDigits, money, isValidJalaliDate, jalaliStartOfDay, jalaliEndOfDay } from '@shared/jalali'
import type { SaleReportResult, SaleReportRow, ShiftInfo } from '@shared/types'
/**
 * کار الف — سه ستون مقصد پول. هیچ عددی در این صفحه جمع نمی‌شود؛ تنها جای تبدیل
 * «عدد سرور ⇒ ستون جدول» همان `lib/destinationCells.ts` است تا این صفحه و
 * گزارشات فروش و پنجره‌ی شیفت نتوانند سه عدد مختلف بدهند.
 */
import {
  cardOnlyOf,
  managerAccountOf,
  otherOrUnknownOf,
  destinationCells,
  DESTINATION_HEADERS,
  DESTINATION_COLUMNS_NOTE
} from '../lib/destinationCells'
import {
  MANAGER_ACCOUNT_ROW_LABEL,
  MANAGER_ACCOUNT_ROW_NOTE,
  DESTINATION_UNKNOWN_ROW_LABEL,
  DESTINATION_UNKNOWN_ROW_NOTE
} from '@shared/enums'
/**
 * کار ب — «کالای برگشتیِ در انتظار پرداخت مدیر». فقط *هشدار*: هیچ عددی از این
 * هوک در `expectedCash`، شمارش کشو، کسری/اضافی یا حتی ستون مبلغِ جدول فرمول
 * نمی‌نشیند. این کالا است نه پول؛ و پولش هم هنوز از کشو بیرون نرفته.
 * ⚠️ این را با «حساب مدیر»ِ کار الف قاطی نکنید: آن پولی است که *از مشتری*
 * گرفته‌ایم و به حساب مدیر رفته؛ این کالایی است که قرار است پولش *به مشتری*
 * کارت‌به‌کارت شود. دو چیز مستقل، دو ردیف مستقل.
 */
import { usePendingRestock, pendingToneBox } from '../hooks/usePendingRestock'
import { PENDING_RESTOCK_EXPLAINER, PENDING_RESTOCK_LABEL } from '@shared/pendingRestock'
import { useManagerSession } from '../hooks/useManagerSession'

/**
 * ===================== بستن صندوق (پایان شیفت) =====================
 * کاری که فروشنده‌ی هر شیفت آخر کار می‌کند:
 *   ۱) گزارش فروش شیفتش را همین‌جا می‌گیرد («تهیه گزارش»).
 *   ۲) دریافتی‌ها را می‌بیند: نقدی، کارت، غیرنقدی/اعتباری و جمع صندوق.
 *   ۳) «بستن صندوق» را می‌زند ⇒ یک رکورد CashSession ثبت می‌شود و همان شیفت
 *      بسته می‌شود (پایان شیفت). شیفت بعدی با اولین فروش خودکار باز می‌شود.
 *
 * ============================ جلسه ۱۹ · مدل «نشست» ============================
 * هر بار که صندوق واقعاً دست‌به‌دست شود، یک «نشست» تازه ثبت می‌شود:
 *   • «ثبت نشست جدید» = نشست فعلی با کارمند خودش بسته می‌شود و نشست تازه با
 *     کارمند تازه ساخته می‌شود (هیچ رکوردی رونویسی یا حذف نمی‌شود).
 *   • نام شیفت را سیستم بر اساس ساعت *پیشنهاد* می‌دهد؛ هر نام دیگری دلیل
 *     اجباری می‌خواهد که در گزارش «نشست‌های با نام override‌شده» دیده می‌شود.
 *   • انتخاب کارمند هر نشست اجباری است (بند ۳).
 *
 * دو حالت شیفت (تنظیمات ← شیفت‌ها):
 *   • پیش‌فرض (چک‌باکس «تعیین شیفت بر اساس ساعت» خاموش): شماره‌گذاری خودکار و
 *     پشت‌سرهم با هر بار بستن صندوق — دست‌نخورده.
 *   • روشن: نام شیفتِ *پیشنهادی* از ساعت همین لحظه پیدا می‌شود. نشستِ باز با
 *     گذر ساعت خودکار عوض نمی‌شود؛ نشست بعدی با بستن صندوق یا تعویض کارمند
 *     ساخته می‌شود.
 *
 * ⚠️ بستن صندوق هیچ چیزی از انبار کم نمی‌کند. کسر نهایی انبار روز، یک‌جا در
 * پنل «تجمیع و انتقال» (F11) انجام می‌شود — همان‌طور که شیفت آخر روز می‌زند.
 *
 * IPC: sale:report:rows · shift:current · shift:open · cash:close · cash:sessions
 * ===================================================================
 */

const HEADERS = [
  'شماره فیش فروش',
  'نام خریدار',
  'تاریخ',
  'ساعت',
  'شیفت',
  'نوع ارسال',
  'وضعیت',
  'کاربر ثبت کننده',
  'جمع مبلغ کالا',
  'عوارض و مالیات',
  'حق سرویس',
  'تخفیف',
  'هزینه پیک',
  'جمع کل فروش',
  'نقدی',
  ...DESTINATION_HEADERS
]

type PayFilter = 'ALL' | 'CASH' | 'CARD' | 'CREDIT'

type CustodyTimeline = {
  from: string
  to: string
  coverage?: {
    skip: number
    take: number
    truncated: Record<string, boolean>
    truncatedAny: boolean
    hasMore: Record<string, boolean>
    hasMoreAny: boolean
  }
  segments: Array<{
    shiftId: number
    startedAt: string
    endedAt: string | null
    custodianName: string | null
    templateId: string | null
    scheduleTitleSnapshot: string | null
    scheduledEndAt: string | null
    scheduleKind: 'CANONICAL' | 'LEGACY' | 'UNSCHEDULED'
    endKind: string | null
  }>
  handovers: Array<{
    id: number
    status: string
    startedAt: string
    finishedAt: string | null
    fromShiftId: number
    toShiftId: number | null
    fromUser: string | null
    selectedRecipient: string | null
    finalCustodian: string | null
    expectedAtStart: number | bigint
    countedAtStart: number | bigint
    differenceCash: number | bigint
    resolutionKind: string | null
  }>
  saleOperators: Array<{
    id: number
    at: string
    invoiceId: number
    receiptNo: number | null
    custodyShiftId: number
    custodianName: string | null
    operatorKind: string
    operatorUserId: number | null
    operatorName: string | null
    authMethod: string
  }>
  counts: Array<{
    id: number
    at: string
    shiftId: number
    kind: string
    countedCash: number | bigint
    expectedCash: number | bigint | null
    differenceCash: number | bigint | null
    countedByName: string | null
    authMethod: string | null
    note: string | null
  }>
  resolutions: Array<{
    id: number
    shiftId: number
    status: string
    evidence: string
    openedAt: string
    resolvedAt: string | null
    nightExpectedCash: number | bigint | null
    provisionalDifference: number | bigint | null
    differenceAttribution: string
    attributedToName: string | null
    decisionByName: string | null
    decisionReason: string | null
  }>
  dispositions: Array<{
    id: number
    at: string
    shiftId: number
    cashSessionId: number
    kind: string
    amount: number | bigint
    confirmStatus: string
    recipientName: string | null
    confirmedByName: string | null
    trackingNo: string | null
    destinationLabel: string | null
  }>
}

function custodyOperatorLabel(row: CustodyTimeline['saleOperators'][number]) {
  if (row.operatorKind === 'CUSTODIAN_SESSION') return `مسئول کشو · ${row.operatorName ?? row.custodianName ?? '—'}`
  if (row.operatorKind === 'OPERATOR_PIN') return `اپراتور PINدار · ${row.operatorName ?? '—'}`
  /** Shared manager authentication is a capability, never a claim that a
   * particular named manager operated POS. */
  if (row.operatorKind === 'MANAGER_SESSION') return 'نشست مدیر · بدون انتساب شخصی'
  return 'هویت عملیاتی ثبت‌شده'
}

function custodyCountKindLabel(kind: string) {
  return ({
    OPENING: 'شمارش آغاز',
    CLOSING: 'شمارش نهایی',
    HANDOVER_OUT: 'شمارش تحویل‌دهنده',
    HANDOVER_RECOUNT_DIFFERENCE_PENDING: 'بازشمارشِ اختلافِ فریز‌شده',
    HANDOVER_CANCELED: 'شاهد لغو تحویل',
    EMERGENCY_COVER_COUNT: 'شمارش پوشش اضطراری',
    MASTER_OVERRIDE_COUNT: 'شمارش Master Override',
    MORNING_WITNESS: 'شمارش شاهد صبح',
    ARCHIVED_CUSTODIAN_WITNESS: 'شمارش شاهدِ مسئول آرشیوشده'
  } as Record<string, string>)[kind] ?? `شمارش ثبت‌شده (${kind})`
}

function custodyResolutionEvidenceLabel(evidence: string) {
  return ({
    NONE: 'پروندهٔ بازیابی',
    MORNING_WITNESS: 'شاهد صبح',
    CUSTODIAN_ARCHIVED: 'آرشیو مسئول فعال',
    CUSTODIAN_ARCHIVED_RECOVERED: 'بازیابی مسئول آرشیوشده'
  } as Record<string, string>)[evidence] ?? `شاهد تعیین‌تکلیف (${evidence})`
}

function custodyDispositionKindLabel(kind: string) {
  return ({
    KEEP_IN_DRAWER: 'باقی‌ماندن در کشو',
    TO_MANAGER: 'تحویل به مدیر',
    BANK_OR_SAFE: 'بانک یا گاوصندوق'
  } as Record<string, string>)[kind] ?? kind
}

function custodyResolutionStatusLabel(status: string) {
  return ({ OPEN: 'باز', RESOLVED: 'تعیین‌تکلیف‌شده', ARCHIVE_FREEZE: 'فریز آرشیو', ARCHIVE_ABORTED: 'آرشیو لغوشده' } as Record<string, string>)[status] ?? status
}

function custodyAttributionLabel(attribution: string) {
  return ({ PENDING_DECISION: 'در انتظار تصمیم', UNASSIGNED: 'بدون انتساب فردی', CUSTODIAN_ACK: 'پذیرش مسئول', MANAGER_DECISION: 'تصمیم مدیر', DIFFERENCE_UNKNOWN: 'نامشخص' } as Record<string, string>)[attribution] ?? attribution
}

function custodyDispositionStatusLabel(status: string) {
  return ({ PENDING: 'در انتظار تأیید', CLAIMED: 'اعلام تحویل', CONFIRMED: 'تأییدشده', REVERSED: 'برگشت‌داده‌شده' } as Record<string, string>)[status] ?? status
}

function custodyAuthMethodLabel(method: string | null) {
  return ({ CUSTODY_PIN: 'PIN شخصی', MANAGER_CUSTODY_PIN: 'PIN شخصی مدیر', MANAGER_SHARED_PASSWORD: 'رمز مشترک مدیر', MANAGER_SESSION: 'نشست مدیر' } as Record<string, string>)[method ?? ''] ?? 'روش ثبت‌شده'
}

/** ممیزی A77-01 — رد «بستن تکراری» از main (هر دو مسیر: بیرون و داخل تراکنش) */
function isRepeatCloseRejection(message: string): boolean {
  return /بستن دوباره را تأیید کنید/.test(message)
}

export default function CashClose() {
  const nav = useNavigate()
  const { isManager } = useManagerSession()
  const [filters, setFilters] = useState<ReportFilters>(todayFilters())
  const [report, setReport] = useState<SaleReportResult | null>(null)
  const [shift, setShift] = useState<ShiftInfo | null>(null)
  const [sessions, setSessions] = useState<any[]>([])
  /** Manager-only, read-only custody evidence. This never controls sale/close
   * actions; if the main manager session ends, the timeline fails closed. */
  const [custodyTimeline, setCustodyTimeline] = useState<CustodyTimeline | null>(null)
  /** The manager explicitly selects a bounded read window; this affects only
   * report data, never live custody status or any financial operation. */
  const [custodyReportDays, setCustodyReportDays] = useState<1 | 7 | 30 | 90 | 180>(90)
  /** A manager may explicitly reuse the Jalali range already selected in the
   * page filter; relative windows remain the default daily-monitoring mode. */
  const [custodyUseSelectedDateRange, setCustodyUseSelectedDateRange] = useState(false)
  const [custodyReportSkip, setCustodyReportSkip] = useState(0)
  const [custodyExportBusy, setCustodyExportBusy] = useState(false)
  /** The first report page anchors an exact server query interval. Paging to
   * older evidence must reuse it, otherwise new records could shift offsets. */
  const custodyReportRangeRef = useRef<{ from: string; to: string } | null>(null)
  /** Reject late responses from an older page/range selection, so a stale Main
   * read can never overwrite the manager's newer bounded report view. */
  const custodyReportRequestRef = useRef(0)
  /** `null` is intentionally fail-closed while main confirms whether this
   * drawer is governed by custody. The legacy session picker has no PIN. */
  const [custodyGoverned, setCustodyGoverned] = useState<boolean | null>(null)
  const [payFilter, setPayFilter] = useState<PayFilter>('ALL')
  const [onlyCurrentShift, setOnlyCurrentShift] = useState(true)
  const [counted, setCounted] = useState<string>('')
  const [note, setNote] = useState('')
  /**
   * ===================== بند ۱۶ — گردش نقدی صندوق (جلسه ۱۶) =====================
   * `expected` خروجی کانال `cashbox:expected` است: فرمول `expectedCash` با همه‌ی
   * اجزایش، فهرست گردش‌های نقدی شیفت، و مغایرت.
   *
   * ⚠️ هیچ‌کدام از این اعداد اینجا محاسبه نمی‌شوند. تنها منبع محاسبه
   * `src/shared/accounting.ts` است (قاعده‌ی ۳ سند مرجع). حتی «اختلاف» هم از سرور
   * می‌آید، چون اگر همین یک تفریق را هم اینجا می‌نوشتیم، می‌شد «فرمول دومِ
   * renderer» که صریحاً ممنوع است.
   */
  const [expected, setExpected] = useState<any | null>(null)
  /** موجودی اول صندوق (اگر کاربر بخواهد همین‌جا واردش کند) */
  const [openingFloat, setOpeningFloat] = useState<string>('')
  // ---- فرم ثبت برداشت / واریز / موجودی اول ----
  const [mvType, setMvType] = useState<string>('WITHDRAWAL')
  const [mvAmount, setMvAmount] = useState('')
  const [mvDesc, setMvDesc] = useState('')
  const [mvBusy, setMvBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const printBusyRef = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  /**
   * ممیزی A77-01 — main منبع حقیقت «بستن تکراری» است (هم‌پوشانی روز/بازه، نشست
   * خارج از فهرست بارگذاری‌شده، یا race دو پنجره). قبلاً UI فقط تطابق دقیق
   * بازه/نشست را در فهرست همین صفحه می‌دید و وقتی main رد می‌کرد، هیچ راه تأییدی
   * نمی‌داد ⇒ بستن صندوق آن بازه عملاً ناممکن می‌شد.
   */
  const [repeatRequired, setRepeatRequired] = useState(false)
  /** جلسه ۱۹ — فرم «نشست»: باز کردن نشست تازه یا تعویض کارمند وسط کار */
  const [session, setSession] = useState<{ open: boolean; mode: SessionMode }>({ open: false, mode: 'open' })
  /**
   * مورد ۵ — ردیفی از سابقه‌ی بستن صندوق که «جزئیات»ش باز است.
   * `null` = پنجره بسته است. فقط‌خواندنی؛ هیچ داده‌ای را تغییر نمی‌دهد.
   */
  const [detail, setDetail] = useState<{
    cashSessionId: number
    shiftId: number | null
    fromJalali: string
    toJalali: string
  } | null>(null)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 10000)
  }

  const loadShift = useCallback(async () => {
    try {
      const s = await call<ShiftInfo | null>(CH.shiftCurrent, {})
      setShift(s)
      return s
    } catch (e: any) {
      setErr(e.message)
      return null
    }
  }, [])

  /**
   * مورد ۴ — شیفتِ نمایش‌داده‌شده با گذر ساعت تازه می‌شود.
   * پنل فروش معمولاً تمام روز باز است؛ اگر این پنل ساعت ۱۳ باز شده باشد و
   * کارمند ساعت ۱۶ صندوق را ببندد، دیگر نام شیفت قدیمی (مثلاً «شیفت صبح») روی
   * صفحه نمی‌ماند: هر دقیقه شیفت جاری دوباره از سرور خوانده می‌شود و در حالت
   * «تعیین شیفت بر اساس ساعت» همان شیفتی می‌آید که ساعت جاری داخل بازه‌اش است.
   */
  useEffect(() => {
    const t = window.setInterval(() => void loadShift(), 60_000)
    return () => window.clearInterval(t)
  }, [loadShift])

  /**
   * شیفت مؤثر همین صفحه — همان قاعده‌ای که `load()` و `doClose()` استفاده می‌کنند،
   * تا «انتظاری»، «گردش نقدی» و «گزارش» هیچ‌وقت سه دامنه‌ی متفاوت را نشان ندهند.
   */
  const effectiveShiftId = useMemo(
    () => (onlyCurrentShift && shift && filters.shiftId === '' ? shift.id : filters.shiftId === '' ? null : Number(filters.shiftId)),
    [onlyCurrentShift, shift, filters.shiftId]
  )
  const priorCloseForTarget = useMemo(
    () =>
      sessions.some((c) =>
        effectiveShiftId != null
          ? Number(c.shiftId) === effectiveShiftId
          : c.fromJalali === filters.fromJalali && c.toJalali === filters.toJalali
      ),
    [sessions, effectiveShiftId, filters.fromJalali, filters.toJalali]
  )

  /**
   * نشست ۱۱۴ · بند ۴-۴۶ — سابقه دیگر بی‌صدا روی ۲۰۰ ردیف بریده نمی‌شود: سرور تا
   * ۵٬۰۰۰ ردیف یک‌جا می‌دهد و بیش از آن را با page/warnings صفحه‌بندی می‌کند.
   */
  const loadSessions = useCallback(async (skip = 0) => {
    try {
      setSessions(await call<any[]>(CH.cashSessions, { fromJalali: filters.fromJalali, toJalali: filters.toJalali, skip }))
    } catch {
      setSessions([])
    }
  }, [filters.fromJalali, filters.toJalali])
  const sessionsPage = (sessions as any).page as { skip: number; take: number; totalCount: number; truncated: boolean } | undefined
  const sessionsWarnings = ((sessions as any).warnings as string[] | undefined) ?? []

  const loadCustodyTimeline = useCallback(async (skip = 0, refreshRange = false) => {
    const requestId = ++custodyReportRequestRef.current
    if (!isManager) {
      custodyReportRangeRef.current = null
      setCustodyTimeline(null)
      setCustodyReportSkip(0)
      return
    }
    let range = custodyReportRangeRef.current
    if (refreshRange || !range) {
      if (custodyUseSelectedDateRange) {
        if (!isValidJalaliDate(filters.fromJalali) || !isValidJalaliDate(filters.toJalali)) {
          custodyReportRangeRef.current = null
          setCustodyTimeline(null)
          setCustodyReportSkip(0)
          setErr('بازهٔ شمسیِ انتخاب‌شده برای گزارش حضانت معتبر نیست.')
          return
        }
        const from = jalaliStartOfDay(filters.fromJalali)
        const to = jalaliEndOfDay(filters.toJalali)
        if (to.getTime() < from.getTime()) {
          custodyReportRangeRef.current = null
          setCustodyTimeline(null)
          setCustodyReportSkip(0)
          setErr('پایان بازهٔ شمسی نمی‌تواند پیش از آغاز آن باشد.')
          return
        }
        range = { from: from.toISOString(), to: to.toISOString() }
      } else {
        const to = new Date()
        const from = new Date(to.getTime() - custodyReportDays * 24 * 60 * 60_000)
        range = { from: from.toISOString(), to: to.toISOString() }
      }
      custodyReportRangeRef.current = range
    }
    try {
      const result = await call<CustodyTimeline>(CH.custodyReport, {
        ...range,
        skip,
        take: custodyReportDays > 90 ? 500 : 150
      })
      if (requestId !== custodyReportRequestRef.current) return
      setCustodyTimeline(result)
      setCustodyReportSkip(result.coverage?.skip ?? skip)
    } catch {
      if (requestId !== custodyReportRequestRef.current) return
      /** A failed/expired manager session must not leave readable prior report
       * data on screen. */
      custodyReportRangeRef.current = null
      setCustodyTimeline(null)
      setCustodyReportSkip(0)
    }
  }, [isManager, custodyReportDays, custodyUseSelectedDateRange, filters.fromJalali, filters.toJalali])
  useEffect(() => { void loadCustodyTimeline(0, true) }, [loadCustodyTimeline])
  const exportCustodyTimeline = async () => {
    /** Main re-reads and serializes this exact bounded scope. Renderer supplies
     * no evidence rows, totals, names, notes or export title. */
    if (!isManager || !custodyTimeline || custodyExportBusy) return
    const coverage = custodyTimeline.coverage
    if (!coverage) { setErr('پوشش صفحهٔ گزارش حضانت مشخص نیست؛ ابتدا گزارش را تازه‌سازی کنید.'); return }
    setCustodyExportBusy(true)
    try {
      const result = await call<{ canceled: boolean; path: string | null }>(CH.custodyReportExport, {
        from: custodyTimeline.from,
        to: custodyTimeline.to,
        skip: coverage.skip,
        take: coverage.take
      })
      if (result.canceled) flash('ذخیرهٔ خروجی گزارش حضانت لغو شد.')
      else flash(`خروجی صفحهٔ گزارش حضانت ساخته شد: ${result.path ?? 'مسیر نامشخص'}`)
    } catch (error: any) {
      setErr(error?.message ?? 'ساخت خروجی گزارش حضانت ممکن نشد.')
    } finally {
      setCustodyExportBusy(false)
    }
  }
  useEffect(() => {
    let live = true
    void call<{ enabled: boolean; governed?: boolean }>(CH.custodyStatus, {})
      .then((status) => { if (live) setCustodyGoverned(status.governed === true || status.enabled === true) })
      // Unknown is deliberately not interpreted as legacy permission. A
      // failed IPC call must never resurrect the old name-only handover form.
      .catch(() => { if (live) setCustodyGoverned(null) })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (custodyGoverned !== false) setSession({ open: false, mode: 'open' })
  }, [custodyGoverned])

  /**
   * پیش‌نمایش شفافِ `expectedCash` *قبل* از زدن دکمه‌ی نهایی. فقط می‌خواند و
   * هیچ چیزی ثبت نمی‌کند، پس با هر تغییر «شمارش دستی» بی‌خطر تازه می‌شود.
   */
  const loadExpected = useCallback(
    async (countedValue: number | null, openingValue: number | null) => {
      try {
        setExpected(
          await call<any>(CH.cashboxExpected, {
            shiftId: effectiveShiftId,
            fromJalali: filters.fromJalali,
            toJalali: filters.toJalali,
            countedCash: countedValue,
            openingFloat: openingValue
          })
        )
      } catch (e: any) {
        setExpected(null)
        setErr(e.message)
      }
    },
    [effectiveShiftId, filters.fromJalali, filters.toJalali]
  )

  const load = useCallback(async () => {
    if (!isValidJalaliDate(filters.fromJalali) || !isValidJalaliDate(filters.toJalali))
      return setErr('بازه‌ی تاریخ معتبر نیست')
    setBusy(true)
    setErr(null)
    try {
      const f = toServiceFilter(filters)
      // «فقط شیفت جاری»: گزارش دقیقاً همان چیزی می‌شود که این شیفت فروخته است
      if (onlyCurrentShift && shift && filters.shiftId === '') f.shiftId = shift.id
      setReport(await call<SaleReportResult>(CH.saleReportRows, f))
      await loadSessions()
      await loadExpected(countedNum, openingFloatNum)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, onlyCurrentShift, shift, loadSessions, loadExpected])

  useEffect(() => {
    void loadShift()
  }, [loadShift])

  useEffect(() => {
    if (shift !== null) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift?.id])

  const rows = useMemo(() => {
    const all = report?.rows ?? []
    if (payFilter === 'ALL') return all
    if (payFilter === 'CASH') return all.filter((r) => r.cashTotal > 0)
    /**
     * کار الف: این فیلتر عمداً هر سه سبدِ غیرنقد را نگه می‌دارد. پیش از تفکیکِ
     * مقصد، «کارت» خودش شاملِ سایر و حساب مدیر بود؛ اگر حالا فقط `cardOnlyOf` را
     * می‌گرفتیم، فاکتورهایی که پولشان به حساب مدیر یا با روش بانکیِ دیگری آمده
     * بی‌صدا از این فیلتر بیرون می‌افتادند. تفکیک در *ستون‌ها* دیده می‌شود، نه با
     * ناپدید کردن ردیف.
     */
    if (payFilter === 'CARD')
      return all.filter((r) => cardOnlyOf(r) + managerAccountOf(r) + otherOrUnknownOf(r) > 0)
    return all.filter((r) => r.creditTotal > 0)
  }, [report, payFilter])

  const t = report?.totals
  /**
   * جلسه ۱۵ — اصلاح باگ حسابداری: «پول نقد داخل کشو» فقط نقد است.
   * فرمول قبلی نقد + کارت + سایر + اعتباری را جمع می‌زد و با پول شمرده‌شده مقایسه می‌کرد؛
   * کارت، چک، نسیه، اعتبار خرید و ارزش کالای تعویض هرگز داخل کشو نیستند.
   * مرجع دقیق‌تر (با موجودی اول صندوق و برداشت/واریز) کانال `cashbox:expected` است
   * که از `src/shared/accounting.ts` می‌خواند؛ این عدد فقط نمایش سریع همان مبناست.
   * فرمول قبلی برای ردیابی: (t?.cashTotal ?? 0) + (t?.cardTotal ?? 0) + (t?.otherTotal ?? 0) + (t?.creditTotal ?? 0)
   */
  const boxTotal = t?.cashTotal ?? 0
  const countedNum = counted.trim() === '' ? null : Math.round(Number(counted.replace(/[^0-9-]/g, '')) || 0)
  const openingFloatNum = openingFloat.trim() === '' ? null : Math.round(Number(openingFloat.replace(/[^0-9]/g, '')) || 0)
  /**
   * ---- بند ۱۶ — «انتظاری» و «مغایرت»، هر دو از `accounting.ts` ----
   *   expectedCash = موجودی اول + نقد دریافتی + چک پاس‌شده + وصول نسیه‌ی قبل
   *                  + واریز − بازپرداخت نقدی برگشت − بازپرداخت نقدی تعویض − برداشت
   *   cashDifference = شمرده‌شده − انتظاری
   * کارت، چک در جریان، نسیه، اعتبار خرید و ارزش کالای تعویض هیچ‌وقت داخل کشو
   * نیستند، پس هیچ‌کدام در این عدد نمی‌آیند.
   */
  const expectedCash: number | null = expected ? Math.round(expected.expectedCash ?? 0) : null
  const diff: number | null = countedNum == null || !expected ? null : Math.round(expected.cashDifference ?? 0)
  const diffState: 'SHORTAGE' | 'OVERAGE' | 'MATCHED' | null = countedNum == null || !expected ? null : expected.state
  const threshold = Math.round(expected?.threshold ?? 100000)
  const needsNote = !!expected?.requiresNote && countedNum != null
  const components = expected?.components ?? null
  const paymentMutations: any[] = Array.isArray(expected?.paymentMutations) ? expected.paymentMutations : []
  const movements: any[] = expected?.movements ?? []
  const expectedWarnings: string[] = Array.isArray(expected?.warnings) ? expected.warnings : []

  /**
   * کار ب — هشدار «کالای برگشتیِ در انتظار پرداخت مدیر».
   * بدون بازه‌ی تاریخ (همان قاعده‌ی هوک): کالایی که سه هفته پیش معلق شده و مدیر
   * پرداختش نکرده، امشب هم روی قفسه است و بستن صندوق باید یادش بیندازد.
   * هیچ‌کدام از عددهای بالا (`expectedCash`, `diff`, `diffState`) به این وابسته
   * نیستند و اگر این کانال خطا بدهد، فقط همین هشدار دیده نمی‌شود.
   */
  const pending = usePendingRestock()
  const custodySegments = useMemo(() => {
    const all = custodyTimeline?.segments ?? []
    return shift ? all.filter((segment) => segment.shiftId === shift.id) : all.slice(0, 8)
  }, [custodyTimeline, shift])
  const custodyHandovers = useMemo(() => {
    const all = custodyTimeline?.handovers ?? []
    return shift ? all.filter((handover) => handover.fromShiftId === shift.id || handover.toShiftId === shift.id) : all.slice(0, 8)
  }, [custodyTimeline, shift])
  const custodySaleOperators = useMemo(() => {
    const all = custodyTimeline?.saleOperators ?? []
    return shift ? all.filter((row) => row.custodyShiftId === shift.id) : all.slice(0, 12)
  }, [custodyTimeline, shift])
  /** Terminal reconciliation evidence is read-only. It deliberately uses the
   * stored count/resolution/disposition rows, never renderer recomputation. */
  const custodyTerminalCounts = useMemo(() => {
    /** A newly-opened morning segment must not hide the prior night's terminal
     * record. Opening count is intentionally omitted here; the report shows
     * recent terminal/reconciliation evidence across segments. */
    const all = (custodyTimeline?.counts ?? []).filter((row) => row.kind !== 'OPENING')
    return all.slice(0, 12)
  }, [custodyTimeline])
  const custodyResolutions = useMemo(() => (custodyTimeline?.resolutions ?? []).slice(0, 8), [custodyTimeline])
  const custodyDispositions = useMemo(() => (custodyTimeline?.dispositions ?? []).slice(0, 12), [custodyTimeline])

  /**
   * «شمارش دستی» و «موجودی اول» با تأخیر کوتاه به سرور می‌روند تا مغایرت زنده
   * باشد، ولی با هر کلید یک درخواست ساخته نشود. چرا سرور؟ چون فرمول فقط یک جا
   * زندگی می‌کند (قاعده‌ی ۳).
   */
  useEffect(() => {
    const timer = window.setTimeout(() => void loadExpected(countedNum, openingFloatNum), 400)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countedNum, openingFloatNum, effectiveShiftId, filters.fromJalali, filters.toJalali])

  /** ثبت یک گردش نقدی دستی (موجودی اول / واریز / برداشت). */
  const addMovement = async () => {
    const amount = Math.round(Number(mvAmount.replace(/[^0-9]/g, '')) || 0)
    if (amount <= 0) return setErr('مبلغ گردش نقدی را وارد کنید (بزرگ‌تر از صفر).')
    setMvBusy(true)
    setErr(null)
    try {
      const row = await call<any>(CH.cashboxMovementAdd, {
        type: mvType,
        amount,
        description: mvDesc.trim() || undefined,
        shiftId: effectiveShiftId
      })
      setMvAmount('')
      setMvDesc('')
      flash(`${row.typeLabel} به مبلغ ${money(row.amount)} ریال ثبت شد · ${row.direction === 'OUT' ? 'از کشو خارج شد' : 'به کشو آمد'}`)
      await loadExpected(countedNum, openingFloatNum)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setMvBusy(false)
    }
  }

  const doClose = async (allowRepeatClose = false) => {
    setConfirmClose(false)
    setBusy(true)
    try {
      /**
       * مورد ۴: با «فقط شیفت جاری»، شیفت *همین لحظه* دوباره از سرور خوانده
       * می‌شود (نه شناسه‌ی کهنه‌ی لحظه‌ی باز شدن صفحه) و `explicitShift` هم
       * false می‌رود تا سمت main، در حالت «تعیین شیفت بر اساس ساعت»، شیفت را از
       * ساعت بستن صندوق تعیین کند. پس بستن صندوق ساعت ۱۶ هیچ‌وقت به نام «شیفت
       * صبح» ثبت نمی‌شود. اگر کاربر خودش شیفتی را از فیلتر بالا انتخاب کرده
       * باشد، همان انتخاب محترم است.
       */
      const explicitShift = !(onlyCurrentShift && shift) && filters.shiftId !== ''
      const currentShift = onlyCurrentShift && shift ? ((await loadShift()) ?? shift) : null
      const res = await call<any>(CH.cashClose, {
        shiftId: currentShift ? currentShift.id : filters.shiftId === '' ? null : Number(filters.shiftId),
        explicitShift,
        fromJalali: filters.fromJalali,
        toJalali: filters.toJalali,
        /**
         * ---- بند ۱۶ — فیلد درست: `countedCash` (فقط نقد فیزیکیِ کشو) ----
         * `countedTotal` قدیمی هم فرستاده می‌شود تا سابقه‌ی ستون قدیمی خالی نماند،
         * ولی معنایش در پنل قبلی «جمع همه‌چیز» بود؛ سرور `countedCash` را برنده
         * می‌داند و مغایرت را با `expectedCash` حساب می‌کند، نه با جمع کارت و نسیه.
         */
        countedCash: countedNum ?? undefined,
        countedTotal: countedNum ?? undefined,
        openingFloat: openingFloatNum ?? undefined,
        note: note.trim() || undefined,
        allowRepeatClose,
        closeShift: true
      })
      flash(
        `صندوق بسته شد · ${faDigits(res.summary.count)} فاکتور · جمع کل ${money(res.summary.grandTotal)} ریال · ` +
          `نقدی ${money(res.summary.cashTotal)} · کارت ${money(res.summary.cardTotal)} · اعتباری ${money(res.summary.creditTotal)}` +
          (res.cashClose
            ? `\nموجودی اول ${money(res.cashClose.openingFloat)} · نقد انتظاری ${money(res.cashClose.expectedCash)}` +
              (res.cashClose.countedProvided
                ? ` · شمرده‌شده ${money(res.cashClose.countedCash)} · ` +
                  `${res.cashClose.state === 'SHORTAGE' ? 'کسری صندوق' : res.cashClose.state === 'OVERAGE' ? 'اضافه‌ی صندوق' : 'تطبیق کامل'} ` +
                  `${money(Math.abs(res.cashClose.cashDifference))} ریال`
                : ' · پول نقد شمرده نشد')
            : '') +
          (res.shift?.name ? ` · شیفت ثبت‌شده: ${res.shift.name}` : '') +
          (res.shiftClosed ? ' · شیفت بسته شد (پایان شیفت)' : '') +
          '\nیادآوری: کسر نهایی انبار با «تجمیع و انتقال» انجام می‌شود؛ اگر شیفت آخر روز هستید آن را هم بزنید.'
      )
      setCounted('')
      setNote('')
      setOpeningFloat('')
      await loadShift()
      await load()
      await loadCustodyTimeline()
      setRepeatRequired(false)
    } catch (e: any) {
      const msg = String(e?.message ?? e)
      if (!allowRepeatClose && isRepeatCloseRejection(msg)) {
        setRepeatRequired(true)
        setConfirmClose(true)
      }
      setErr(msg)
    } finally {
      setBusy(false)
    }
  }

  /**
   * جلسه ۱۹ — نتیجه‌ی فرم نشست: نشست تازه ثبت شد (یا کارمندش تأیید شد).
   * فروش‌های بعدی خودکار به همین نشست گره می‌خورند.
   */
  const onSessionDone = async (s: ShiftInfo | null) => {
    if (s) {
      setShift(s)
      flash(
        `«${s.sessionLabel ?? s.name}» ثبت شد · کارمند: ${s.userName ?? 'تعیین نشده'}` +
          (s.windowLabel ? ` · بازه ${faDigits(s.windowLabel)}` : '') +
          (s.nameOverridden ? `\nنام این نشست override شد (پیشنهاد سیستم: «${s.suggestedName ?? '—'}») · دلیل ثبت شد.` : '') +
          '\nفروش‌های بعدی به همین نشست ثبت می‌شوند.'
      )
    }
    await loadShift()
    await load()
    await loadCustodyTimeline()
  }

  const rowValues = (r: SaleReportRow) => [
    r.receiptNo,
    r.customerName,
    r.dateJalali,
    r.time,
    r.shiftName,
    r.orderTypeLabel,
    r.statusLabel,
    r.userName,
    r.goodsTotal,
    r.taxTotal,
    r.serviceCharge,
    r.discountTotal,
    r.deliveryFee,
    r.grandTotal,
    r.cashTotal,
    ...destinationCells(r)
  ]

  /**
   * بخش ۳ — «ساعت» روی برگه‌های چاپی بستن صندوق. `ShiftService.info` از قبل
   * `openedAtTime` / `closedAtTime` می‌دهد و فقط مصرف‌کننده لازم بود.
   */
  const shiftClockMeta = shift
    ? ` · شروع شیفت ${faDigits(shift.openedAtTime ?? '—')}` +
      (shift.closedAtTime ? ` · پایان شیفت ${faDigits(shift.closedAtTime)}` : ' · (شیفت باز است)')
    : ''

  const printA4 = async () => {
    if (printBusyRef.current) return
    printBusyRef.current = true
    setPrintBusy(true)
    try {
      await call(CH.printA4, {
        title: 'گزارش بستن صندوق',
        // بخش ۳: ساعت شروع/پایان شیفت هم روی برگه‌ی چاپی می‌آید
        meta:
          `از ${filters.fromJalali} تا ${filters.toJalali}${shift && onlyCurrentShift ? ' · ' + shift.name : ''}` +
          shiftClockMeta,
        headers: HEADERS,
        rows: rows.map((r) => rowValues(r).map((v) => (typeof v === 'number' ? money(v) : v))),
        totals: [
          'جمع صندوق',
          `${faDigits(rows.length)} فاکتور`,
          '',
          '',
          '',
          '',
          '',
          '',
          money(t?.goodsTotal ?? 0),
          money(t?.taxTotal ?? 0),
          money(t?.serviceTotal ?? 0),
          money(t?.discountTotal ?? 0),
          money(t?.deliveryTotal ?? 0),
          money(t?.grandTotal ?? 0),
          money(t?.cashTotal ?? 0),
          ...(t ? destinationCells(t) : [0, 0, 0]).map((v) => money(v))
        ]
      })
      flash('گزارش صندوق برای چاپ A4 فرستاده شد')
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
        title: 'بستن صندوق',
        meta: `${shift ? shift.name + ' · ' : ''}${filters.fromJalali} تا ${filters.toJalali}${shiftClockMeta}`,
        lines: [
          { label: 'تعداد فاکتور', value: faDigits(t?.count ?? 0) },
          { label: 'جمع مبلغ کالا', value: money(t?.goodsTotal ?? 0) },
          { label: 'تخفیف', value: money(t?.discountTotal ?? 0) },
          { label: 'عوارض و مالیات', value: money(t?.taxTotal ?? 0) },
          { label: 'حق سرویس', value: money(t?.serviceTotal ?? 0) },
          { label: 'نقدی', value: money(t?.cashTotal ?? 0) },
          { label: 'کارت (کارتخوان فروشگاه)', value: money(cardOnlyOf(t ?? { cardTotal: 0 })) },
          { label: MANAGER_ACCOUNT_ROW_LABEL, value: money(managerAccountOf(t ?? { cardTotal: 0 })) },
          { label: 'سایر / نامشخص', value: money(otherOrUnknownOf(t ?? { cardTotal: 0 })) },
          { label: 'غیرنقدی / اعتباری', value: money(t?.creditTotal ?? 0) },
          { label: 'برگشت از فروش', value: money(t?.returnedTotal ?? 0) },
          // ---- بند ۱۶: برگه‌ی چاپی هم همان فرمول را می‌گوید، نه «جمع همه‌چیز» ----
          ...(components
            ? [
                { label: 'موجودی اول صندوق', value: money(components.openingFloat) },
                { label: 'نقد دریافتی', value: money(components.cashReceived) },
                /**
                 * ⛑ باگ: کلید `components.clearedCheques` در جلسه ۳۶ به
                 * `clearedCashCheques` تغییر نام داد و این خط `undefined` می‌خواند
                 * ⇒ «چک پاس‌شده» روی برگه‌ی چاپی صفر چاپ می‌شد. حالا همان چهار
                 * سهمِ واقعی چاپ می‌شود و فقط دو سهمِ اول در نقد انتظاری هستند.
                 */
                { label: 'چک پاس‌شده (نقد به صندوق)', value: money(components.clearedCashCheques) },
                { label: 'از نقد دریافتی: وصول نسیه‌ی دوره‌ی قبل (جدا جمع نمی‌شود)', value: money(components.priorCreditSettlements) },
                { label: 'واریز به صندوق', value: money(components.deposits) },
                { label: 'بازپرداخت نقدی برگشت', value: `− ${money(components.cashReturnRefunds)}` },
                { label: 'بازپرداخت نقدی تعویض', value: `− ${money(components.cashExchangeRefunds)}` },
                { label: 'برداشت از صندوق', value: `− ${money(components.withdrawals)}` },
                /** ---- فقط نمایشی: هیچ‌کدام در نقد انتظاری کشو نیستند ---- */
                /** نشست ۱۶۱ · Y18 · بند ۴-۲۴ — چک نامشخص بیرون از نقد مورد انتظار (unknownDestinationOutside) */
                ...(components.clearedUnknownCheques > 0
                  ? [{ label: 'چک پاس‌شده‌ی بی‌مقصد (نامشخص) — خارج از نقد مورد انتظار', value: money(components.clearedUnknownCheques) }]
                  : []),
                { label: 'انتظار کارتخوان (فقط نمایشی)', value: money(components.cardExpected) },
                { label: 'چک پاس‌شده با کارتخوان (فقط نمایشی)', value: money(components.clearedCardCheques) },
                { label: 'چک پاس‌شده به حساب مدیر (فقط نمایشی)', value: money(components.clearedManagerCheques) },
                { label: `${MANAGER_ACCOUNT_ROW_LABEL} (فقط نمایشی)`, value: money(components.managerAccountReceived) },
                {
                  label: 'دریافتی با مقصد نامشخص (فقط نمایشی)',
                  value: money(components.destinationUnknownReceived)
                },
                ...(paymentMutations.length
                  ? [
                      {
                        label: `پرداخت ویرایش/ابطال‌شده (${faDigits(paymentMutations.length)} ردیف، فقط نمایشی)`,
                        value: money(
                          paymentMutations.reduce(
                            (s, m) => s + Math.abs(Number(m.amountBefore ?? 0) - Number(m.amountAfter ?? 0)),
                            0
                          )
                        )
                      }
                    ]
                  : [])
              ]
            : []),
          /**
           * کار ب — یک خط هشدار روی برگه‌ی حرارتی، فقط وقتی معلقی هست. *بالای*
           * «نقد انتظاری» نمی‌رود و جزو فرمول نیست: تعداد کالا را می‌گوید و مبلغ
           * کارت‌به‌کارت را در پرانتز، تا فروشنده‌ی شیفت بعد بداند این شلوارهای
           * روی قفسه چرا در موجودی قابل‌فروش نیستند.
           */
          ...(pending.totalQty > 0
            ? [
                {
                  label: `کالای برگشتی ${PENDING_RESTOCK_LABEL} (فقط هشدار)`,
                  value: `${faDigits(pending.totalQty)} عدد · ${money(pending.summary.pendingAmount)} ریال`
                }
              ]
            : []),
          { label: 'نقد انتظاری داخل کشو', value: money(expectedCash ?? boxTotal), bold: true },
          ...(countedNum != null
            ? [
                { label: 'شمارش نقدی کشو', value: money(countedNum) },
                {
                  label:
                    diffState === 'SHORTAGE' ? 'کسری صندوق' : diffState === 'OVERAGE' ? 'اضافه‌ی صندوق' : 'مغایرت',
                  value: money(diff ?? 0),
                  bold: true
                }
              ]
            : [])
        ]
      })
      flash('گزارش حرارتی صندوق چاپ شد')
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printBusyRef.current = false
      setPrintBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">بستن صندوق</h1>
        {shift ? (
          <>
            <span className={`px-2 py-1 rounded font-bold ${shift.closed ? 'bg-slate-200' : 'bg-emerald-100'}`}>
              {faDigits(shift.dayJalali)} · {shift.sessionLabel ?? shift.name} · {shift.closed ? 'بسته' : 'باز'} ·{' '}
              {faDigits(shift.invoiceCount)} فاکتور · {money(shift.grandTotal)} ریال
            </span>
            {/* جلسه ۱۹ · بند ۳ — کارمند همین نشست (و هشدار اگر تأیید نشده) */}
            <span
              className={`px-2 py-1 rounded text-xs font-bold ${
                shift.staffPending ? 'bg-rose-100 border border-rose-500 text-rose-800' : 'bg-slate-100'
              }`}
              title="کارمند این نشست — مبنای گزارش «عملکرد کارمندان» و «کارت‌به‌کارت مدیر»"
            >
              کارمند: {shift.userName ?? 'تعیین نشده'}
              {shift.staffPending ? ' ⚠ تأیید نشده' : ''}
            </span>
            {/* نام override‌شده: پیشنهاد سیستم و دلیلش، شفاف و بی‌قضاوت */}
            {shift.nameOverridden && (
              <span
                className="px-2 py-1 rounded text-xs font-bold bg-amber-100 border border-amber-400"
                title={shift.overrideReason ?? ''}
              >
                نام دستی انتخاب شد (پیشنهاد سیستم: {shift.suggestedName ?? '—'})
              </span>
            )}
            {/* حالت «تعیین شیفت بر اساس ساعت»: بازه‌ی همین شیفت و وضعیت تشخیص */}
            {shift.byTime && (
              <span
                className={`px-2 py-1 rounded text-xs font-bold ${
                  shift.outsideWindow ? 'bg-amber-100 border border-amber-400' : 'bg-sky-100'
                }`}
                title="شیفت بر اساس ساعت تعیین می‌شود (تنظیمات ← شیفت‌ها)؛ شماره‌ی شیفت با بستن صندوق زیاد نمی‌شود."
              >
                شیفت بر اساس ساعت
                {shift.windowLabel ? ` · ${faDigits(shift.windowLabel)}` : ''}
                {shift.outsideWindow ? ' · ساعت جاری داخل بازه‌ی نام این نشست نیست' : ''}
              </span>
            )}
          </>
        ) : (
          <span className="kbd">شیفتی باز نیست</span>
        )}
        <div className="ms-auto flex gap-1 flex-wrap">
          {custodyGoverned === false ? <>
            <button
              className={`btn ${shift?.staffPending ? 'btn-danger' : ''}`}
              onClick={() => setSession({ open: true, mode: shift?.staffPending ? 'staff' : 'open' })}
              disabled={busy}
              title="نام شیفت پیشنهادی + انتخاب اجباری کارمند همین نشست"
            >
              {shift?.staffPending ? 'تعیین کارمند این نشست ⚠' : 'ثبت نشست جدید'}
            </button>
            <button
              className="btn"
              onClick={() => setSession({ open: true, mode: 'handover' })}
              disabled={busy}
              title="کارمند وسط کار عوض شد: نشست فعلی با کارمند خودش بسته می‌ماند و نشست تازه ساخته می‌شود"
            >
              تعویض کارمند
            </button>
          </> : <span className="kbd self-center">{custodyGoverned ? 'تحویل و بستن فقط از کنترل «صندوق» با PIN انجام می‌شود.' : 'در حال بررسی وضعیت حضانت…'}</span>}
          <button className="btn" onClick={() => nav('/sales-reports')}>
            گزارشات فروش <span className="keycap">F9</span>
          </button>
          <button className="btn" onClick={() => nav('/consolidation')}>
            تجمیع و انتقال <span className="keycap">F11</span>
          </button>
        </div>
      </div>

      <ReportFilterBar value={filters} onChange={setFilters} onSubmit={() => void load()} busy={busy} showProduct={false}>
        <label className="flex items-center gap-2 pb-2 font-bold">
          <input
            type="checkbox"
            className="w-4 h-4"
            checked={onlyCurrentShift}
            onChange={(e) => setOnlyCurrentShift(e.target.checked)}
          />
          فقط شیفت جاری
        </label>
      </ReportFilterBar>

      {custodyGoverned === true && <div className="rounded border border-sky-300 bg-sky-50 p-3 text-sm leading-6" dir="rtl"><b>حضانت صندوق فعال است.</b> این صفحه تاریخچه و تطبیق را فقط‌خواندنی نشان می‌دهد؛ بستن یا تحویلِ نشست فعال باید از کنترل «صندوق» در نوار بالای برنامه و با رمز شخصی مسئول انجام شود.</div>}

      {isManager && custodyTimeline && (
        <section className="rounded border border-indigo-200 bg-indigo-50/50 p-3 space-y-3" dir="rtl">
          <div className="flex flex-wrap gap-2 items-center">
            <h2 className="font-bold text-indigo-950">خط زمانی حضانت صندوق</h2>
            <span className="text-xs text-indigo-800">فقط‌خواندنی · نام و الگوی شیفت از snapshot زمان بازشدن نشست خوانده می‌شود.</span>
            <label className="text-xs flex items-center gap-1">بازهٔ گزارش<select className="input py-0 text-xs" value={custodyReportDays} onChange={(e) => setCustodyReportDays(Number(e.target.value) as 1 | 7 | 30 | 90 | 180)} disabled={busy || custodyUseSelectedDateRange}><option value={1}>۲۴ ساعت اخیر</option><option value={7}>۷ روز</option><option value={30}>۳۰ روز</option><option value={90}>۹۰ روز</option><option value={180}>۱۸۰ روز</option></select></label>
            <label className="text-xs flex items-center gap-1" title="از و تا تاریخِ فیلتر بالای همین صفحه استفاده می‌شود"><input type="checkbox" checked={custodyUseSelectedDateRange} disabled={busy || !isValidJalaliDate(filters.fromJalali) || !isValidJalaliDate(filters.toJalali) || jalaliEndOfDay(filters.toJalali).getTime() < jalaliStartOfDay(filters.fromJalali).getTime()} onChange={(e) => setCustodyUseSelectedDateRange(e.target.checked)} />بازهٔ شمسیِ فیلتر</label>
            <button className="btn py-0.5" disabled={busy} onClick={() => void loadCustodyTimeline(0, true)}>تازه‌سازی</button>
            <button className="btn py-0.5 mr-auto" disabled={busy || custodyExportBusy} onClick={() => void exportCustodyTimeline()}>{custodyExportBusy ? 'در حال ساخت خروجی…' : 'خروجی اکسل همین صفحه'}</button>
          </div>
          {custodyTimeline.coverage ? <div className="flex flex-wrap items-center gap-2 text-xs"><span>{custodyUseSelectedDateRange ? `بازهٔ شمسی ${faDigits(filters.fromJalali)} تا ${faDigits(filters.toJalali)}` : 'بازهٔ ثابت گزارش'} · شروع از ردیف {faDigits(custodyReportSkip + 1)}</span><button className="btn py-0.5" disabled={busy || custodyReportSkip <= 0} onClick={() => void loadCustodyTimeline(Math.max(0, custodyReportSkip - custodyTimeline.coverage.take))}>جدیدتر</button><button className="btn py-0.5" disabled={busy || !custodyTimeline.coverage.hasMoreAny} onClick={() => void loadCustodyTimeline(custodyReportSkip + custodyTimeline.coverage.take)}>قدیمی‌تر</button></div> : null}
          {custodyTimeline.coverage?.hasMoreAny ? <div className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-950">در یک یا چند بخش، evidence قدیمی‌تر از این صفحه باقی مانده است. برای همان بازهٔ ثابت، «قدیمی‌تر» را بزنید؛ این صفحه به‌تنهایی تاریخچهٔ کامل نیست.</div> : null}
          {custodySegments.length ? <div className="grid lg:grid-cols-2 gap-2">
            {custodySegments.map((segment) => <div key={segment.shiftId} className="rounded border border-indigo-200 bg-white p-2 text-sm leading-6">
              <div className="font-bold">مسئول: {segment.custodianName ?? '—'} <span className="font-normal text-slate-500">· نشست {faDigits(segment.shiftId)}</span></div>
              <div>شیفتِ snapshot: <b>{segment.scheduleTitleSnapshot ?? 'بدون برنامه'}</b>{segment.scheduleKind === 'CANONICAL' ? ' · canonical' : segment.scheduleKind === 'LEGACY' ? ' · Legacy' : ''}</div>
              <div className="text-slate-600">شروع {faDigits(new Date(segment.startedAt).toLocaleString('fa-IR'))}{segment.endedAt ? ` · پایان ${faDigits(new Date(segment.endedAt).toLocaleString('fa-IR'))}` : ' · باز'}</div>
              {segment.scheduledEndAt ? <div className="text-slate-600">پایان برنامهٔ snapshot: {faDigits(new Date(segment.scheduledEndAt).toLocaleString('fa-IR'))}</div> : null}
            </div>)}
          </div> : <p className="text-sm text-slate-600">{shift ? 'برای این نشست، segment حضانت ثبت نشده است.' : 'در بازهٔ اخیر segment حضانتی ثبت نشده است.'}</p>}
          {custodyHandovers.length ? <div className="border-t border-indigo-200 pt-3"><h3 className="font-bold text-sm mb-2">تحویل‌ها</h3><div className="space-y-1 text-sm">
            {custodyHandovers.map((handover) => <div key={handover.id} className="rounded bg-white border border-indigo-100 px-2 py-1">تحویل‌دهنده: <b>{handover.fromUser ?? '—'}</b> · گیرندهٔ انتخابی: {handover.selectedRecipient ?? '—'} · دریافت‌کنندهٔ نهایی: <b>{handover.finalCustodian ?? '—'}</b> · {handover.status}</div>)}
          </div></div> : null}
          {custodySaleOperators.length ? <div className="border-t border-indigo-200 pt-3"><h3 className="font-bold text-sm mb-1">عملیات POS همان مسئولیت کشو نیست</h3><p className="text-xs text-indigo-800 mb-2">هویت عملیاتی هر فروش جداگانه ثبت می‌شود؛ مسئول مالی/فیزیکی کشو همچنان مسئول همان segment است.</p><div className="space-y-1 text-sm">
            {custodySaleOperators.map((row) => <div key={row.id} className="rounded bg-white border border-indigo-100 px-2 py-1"><b>{row.receiptNo == null ? `فاکتور ${faDigits(row.invoiceId)}` : `فیش ${faDigits(row.receiptNo)}`}</b> · {custodyOperatorLabel(row)} · مسئول کشو/مالی: <b>{row.custodianName ?? '—'}</b></div>)}
          </div></div> : null}
          {(custodyTerminalCounts.length || custodyResolutions.length || custodyDispositions.length) ? <div className="border-t border-indigo-200 pt-3 space-y-3"><div><h3 className="font-bold text-sm">شواهد نهایی و تطبیق</h3><p className="text-xs text-indigo-800">آخرین اسناد پایان/recovery در همهٔ segmentها نمایش داده می‌شود؛ این داده‌ها append-only سرورند، مبلغ موردانتظار هرگز در Renderer محاسبه نمی‌شود و این بخش هیچ عملیات مالی انجام نمی‌دهد.</p></div>
            {custodyTerminalCounts.length ? <div><h4 className="font-semibold text-sm mb-1">شمارش‌ها</h4><div className="space-y-1 text-sm">{custodyTerminalCounts.map((row) => <div key={row.id} className="rounded bg-white border border-indigo-100 px-2 py-1"><b>{custodyCountKindLabel(row.kind)}</b> · شمارش‌کننده: {row.countedByName ?? '—'} · احراز: {custodyAuthMethodLabel(row.authMethod)} · فیزیکی: <b>{money(row.countedCash)}</b>{row.expectedCash != null ? ` · موردانتظار: ${money(row.expectedCash)}` : ''}{row.differenceCash != null ? ` · اختلاف: ${money(row.differenceCash)}` : ''}{row.note ? <div className="text-slate-600">یادداشت ثبت‌شده: {row.note}</div> : null}</div>)}</div></div> : null}
            {custodyResolutions.length ? <div><h4 className="font-semibold text-sm mb-1">پرونده‌های بازیابی و تعیین‌تکلیف</h4><div className="space-y-1 text-sm">{custodyResolutions.map((row) => <div key={row.id} className="rounded bg-white border border-indigo-100 px-2 py-1"><b>{custodyResolutionEvidenceLabel(row.evidence)}</b> · وضعیت: {custodyResolutionStatusLabel(row.status)}{row.nightExpectedCash != null ? ` · انتظار شب: ${money(row.nightExpectedCash)}` : ''}{row.provisionalDifference != null ? ` · اختلاف: ${money(row.provisionalDifference)}` : ''}<div className="text-slate-600">انتساب اختلاف: {custodyAttributionLabel(row.differenceAttribution)}{row.attributedToName ? ` · شخص منتسب: ${row.attributedToName}` : ''}{row.decisionByName ? ` · تصمیم‌گیرنده: ${row.decisionByName}` : ''}</div>{row.decisionReason ? <div className="text-slate-600">دلیل ثبت‌شده: {row.decisionReason}</div> : null}</div>)}</div></div> : null}
            {custodyDispositions.length ? <div><h4 className="font-semibold text-sm mb-1">تعیین‌تکلیف وجه</h4><div className="space-y-1 text-sm">{custodyDispositions.map((row) => <div key={row.id} className="rounded bg-white border border-indigo-100 px-2 py-1"><b>{custodyDispositionKindLabel(row.kind)}</b> · مبلغ: <b>{money(row.amount)}</b> · وضعیت: {custodyDispositionStatusLabel(row.confirmStatus)}{row.recipientName ? ` · گیرنده: ${row.recipientName}` : ''}{row.confirmedByName ? ` · تأییدکننده: ${row.confirmedByName}` : ''}{row.destinationLabel ? ` · مقصد: ${row.destinationLabel}` : ''}{row.trackingNo ? ` · پیگیری: ${row.trackingNo}` : ''}</div>)}</div></div> : null}
          </div> : null}
        </section>
      )}

      {expectedWarnings.length > 0 && (
        <div className="rounded border-2 border-amber-500 bg-amber-50 px-3 py-2 text-amber-900 whitespace-pre-line">
          {expectedWarnings.map((warning, index) => (
            <div key={`${index}-${warning}`}>⚠ {warning}</div>
          ))}
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

      <div className="flex gap-1 flex-wrap">
        {(
          [
            ['ALL', 'همه‌ی فاکتورها'],
            ['CASH', 'تسویه نقدی'],
            ['CARD', 'تسویه با کارت'],
            ['CREDIT', 'تسویه غیرنقدی / اعتباری']
          ] as [PayFilter, string][]
        ).map(([k, label]) => (
          <button key={k} className={`btn ${payFilter === k ? 'btn-primary' : ''}`} onClick={() => setPayFilter(k)}>
            {label}
          </button>
        ))}
        <span className="kbd self-center">این دکمه‌ها جدول را بر اساس نوع تسویه فیلتر می‌کنند</span>
      </div>

      <div className="tbl-card">
        <table className="tbl">
          <thead className="sticky top-0">
            <tr>
              {HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="font-bold">{faDigits(r.receiptNo)}</td>
                <td>{r.customerName}</td>
                <td>{faDigits(r.dateJalali)}</td>
                <td>{faDigits(r.time)}</td>
                <td>{r.shiftSessionLabel ?? r.shiftName}</td>
                <td>{r.orderTypeLabel}</td>
                <td>{r.statusLabel}</td>
                <td>{r.userName}</td>
                <td>{money(r.goodsTotal)}</td>
                <td>{money(r.taxTotal)}</td>
                <td>{money(r.serviceCharge)}</td>
                <td>{money(r.discountTotal)}</td>
                <td>{money(r.deliveryFee)}</td>
                <td className="font-bold">{money(r.grandTotal)}</td>
                <td>{money(r.cashTotal)}</td>
                <td>{money(cardOnlyOf(r))}</td>
                <td
                  className={managerAccountOf(r) > 0 ? 'text-amber-800 font-bold' : ''}
                  title={managerAccountOf(r) > 0 ? MANAGER_ACCOUNT_ROW_NOTE : undefined}
                >
                  {money(managerAccountOf(r))}
                </td>
                <td className={otherOrUnknownOf(r) > 0 ? 'text-slate-600' : ''}>{money(otherOrUnknownOf(r))}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={HEADERS.length} className="text-center py-10 text-slate-400">
                  فاکتوری برای نمایش نیست
                </td>
              </tr>
            )}
          </tbody>
          {!!rows.length && t && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-100 font-bold">
                <td colSpan={8}>جمع {faDigits(rows.length)} فاکتور</td>
                <td>{money(t.goodsTotal)}</td>
                <td>{money(t.taxTotal)}</td>
                <td>{money(t.serviceTotal)}</td>
                <td>{money(t.discountTotal)}</td>
                <td>{money(t.deliveryTotal)}</td>
                <td>{money(t.grandTotal)}</td>
                <td>{money(t.cashTotal)}</td>
                <td>{money(cardOnlyOf(t))}</td>
                <td className={managerAccountOf(t) > 0 ? 'text-amber-800' : ''}>{money(managerAccountOf(t))}</td>
                <td>{money(otherOrUnknownOf(t))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/*
        =====================================================================
        بند ۱۶ — «موجودی اول صندوق» و «برداشت / واریز وسط شیفت».
        مهم‌ترین حفره‌ی ساختاری کل کار: بدون این دو، تشخیص کسری واقعی از نظر
        حسابداری ممکن نیست، چون نمی‌دانیم صندوق با چند شروع شده و در طول روز
        غیر از فروش چه پولی وارد/خارج شده است.
        =====================================================================
      */}
      <div className="bg-white rounded shadow">
        <div className="px-3 py-2 border-b font-bold flex flex-wrap items-center gap-2">
          گردش نقدی صندوق (موجودی اول · برداشت · واریز)
          <span className="kbd font-normal">
            بازپرداخت برگشت و تعویض دستی ثبت نمی‌شود؛ خودکار و از دلِ همان سند می‌آید تا خروج نقدیِ بی‌سند ممکن نباشد.
          </span>
        </div>
        <div className="p-3 flex flex-wrap gap-2 items-end">
          <label>
            <div className="kbd">نوع</div>
            <select className="inp w-48" value={mvType} onChange={(e) => setMvType(e.target.value)}>
              <option value="OPENING_FLOAT">موجودی اول صندوق (یک‌بار در هر شیفت)</option>
              <option value="DEPOSIT">واریز وسط شیفت</option>
              <option value="WITHDRAWAL">برداشت وسط شیفت</option>
              <option value="CASH_IN">واریز به صندوق</option>
              <option value="CASH_OUT">برداشت از صندوق</option>
            </select>
          </label>
          <label>
            <div className="kbd">مبلغ (ریال)</div>
            <input className="inp w-40" dir="ltr" value={mvAmount} onChange={(e) => setMvAmount(e.target.value)} />
          </label>
          <label className="flex-1 min-w-[220px]">
            <div className="kbd">توضیح (چه کسی، بابت چه چیزی)</div>
            <input className="inp" value={mvDesc} onChange={(e) => setMvDesc(e.target.value)} />
          </label>
          <button className="btn btn-primary" onClick={() => void addMovement()} disabled={mvBusy}>
            {mvBusy ? 'در حال ثبت…' : 'ثبت گردش نقدی'}
          </button>
          <div className="kbd leading-6">
            هر ردیف با تاریخ شمسی، ساعت، شیفت و کاربر در سابقه‌ی تغییرات ثبت می‌شود و مستقیماً در فرمول «نقد انتظاری»
            پایین صفحه اثر می‌گذارد.
          </div>
        </div>
        {/* نشست ۱۱۴ — فهرست گردش صندوق دیگر بی‌صدا بریده نمی‌شود؛ جمع‌های نقد انتظاری روی کل بازه‌اند */}
        {!!expected?.movementsPage?.truncated && (
          <div className="p-2 bg-rose-50 text-rose-800 font-bold border-b">
            ⚠ نمایش {faDigits(movements.length)} از {faDigits(expected.movementsPage.totalCount)} گردش صندوق؛ جمع موجودی اول،
            واریز، برداشت و بازپرداخت در «نقد انتظاری» روی کل بازه حساب شده‌اند. برای دیدن همه‌ی ردیف‌ها بازه را کوچک‌تر کنید.
          </div>
        )}
        <table className="tbl">
          <thead>
            <tr>
              <th>تاریخ</th>
              <th>ساعت</th>
              <th>نوع</th>
              <th>جهت</th>
              <th>مبلغ</th>
              <th>توضیح</th>
              <th>مرجع</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.id} className={m.direction === 'OUT' ? 'bg-rose-50' : ''}>
                <td>{faDigits(m.dateJalali)}</td>
                <td>{faDigits(m.time)}</td>
                <td>{m.typeLabel}</td>
                <td className={m.direction === 'OUT' ? 'text-rose-700 font-bold' : 'text-emerald-700 font-bold'}>
                  {m.direction === 'OUT' ? 'خروج از کشو' : 'ورود به کشو'}
                </td>
                <td className="font-bold">{money(m.amount)}</td>
                <td className="whitespace-normal">{m.description}</td>
                <td>{m.refType ? `${m.refType} ${faDigits(m.refId ?? 0)}` : '—'}</td>
              </tr>
            ))}
            {!movements.length && (
              <tr>
                <td colSpan={7} className="text-center py-6 text-slate-400">
                  در این شیفت هیچ گردش نقدی‌ای ثبت نشده است (نه موجودی اول، نه برداشت، نه واریز)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/*
        =====================================================================
        فرمول «نقد انتظاری» — شفاف، ردیف‌به‌ردیف، حتی وقتی صفر است.
        هیچ عددی اینجا محاسبه نمی‌شود؛ همه از کانال `cashbox:expected` می‌آیند که
        از `src/shared/accounting.ts` می‌خواند.
        =====================================================================
      */}
      <div className="bg-white rounded shadow">
        <div className="px-3 py-2 border-b font-bold flex flex-wrap items-center gap-2">
          نقد داخل کشو — فرمول کامل
          <span className="kbd font-normal">
            کارت، چک در جریان، نسیه، اعتبار خرید و ارزش کالای تعویض هرگز داخل کشو نیستند و در این عدد نمی‌آیند.
          </span>
        </div>
        <table className="tbl">
          <tbody>
            {[
              ['موجودی اول صندوق', components?.openingFloat ?? 0, 1, 'اگر ثبت نشده باشد صفر است — و همان صفر، خودش یک هشدار است.'],
              ['نقد دریافتی این بازه', components?.cashReceived ?? 0, 1, ''],
              /**
               * ⛑ اولین کار جلسه ۳۹: این ردیف `components.clearedCheques` را
               * می‌خواند که در جلسه ۳۶ به `clearedCashCheques` تغییر نام داده بود
               * ⇒ `undefined` ⇒ «چک پاس‌شده» همیشه صفر دیده می‌شد، در حالی که
               * `expectedCash` سرور همان مبلغ را داشت. یعنی جدولِ «شفافِ» فرمول با
               * عددِ نهاییِ خودش جمع نمی‌شد. حالا چهار سهم چک از هم جدا شده و فقط
               * دو سهمی که واقعاً در `expectedCash` هستند علامت + دارند.
               */
              [
                'چک پاس‌شده — پولش نقد به صندوق آمد',
                components?.clearedCashCheques ?? 0,
                1,
                'بر اساس تاریخ پاس‌شدن، نه تاریخ فاکتور.'
              ],
              /**
               * نشست ۱۶۴ · Y21 (S163-D2) — ردیف «وصول نسیه‌ی بازه‌های قبل — سهم نقد» از این فرمول بیرون رفت:
               * آن مبلغ داخل «نقد دریافتی این بازه» است و جمع‌زدن دوباره‌اش کسری کاذب می‌ساخت. حالا در
               * ردیف‌های فقط نمایشی پایین با برچسب «داخل نقد دریافتی» آمده است.
               */
              ['واریز به صندوق', components?.deposits ?? 0, 1, ''],
              ['بازپرداخت نقدی برگشت', components?.cashReturnRefunds ?? 0, -1, 'از کشو بیرون رفته است.'],
              ['بازپرداخت نقدی تعویض', components?.cashExchangeRefunds ?? 0, -1, ''],
              ['برداشت از صندوق', components?.withdrawals ?? 0, -1, '']
            ].map(([label, value, sign, hint]) => (
              <tr key={String(label)}>
                <td className="whitespace-normal">
                  {label}
                  {hint ? <div className="kbd font-normal leading-5">{hint}</div> : null}
                </td>
                <td className="text-center w-8">{sign === -1 ? '−' : '+'}</td>
                <td className="text-left tabular-nums" dir="ltr">
                  {money(Number(value))}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-100 font-bold">
              <td>نقد انتظاری داخل کشو</td>
              <td></td>
              <td className="text-left tabular-nums" dir="ltr">
                {expectedCash == null ? '—' : money(expectedCash)}
              </td>
            </tr>
            {/*
              نشست ۱۶۱ · Y18 · بند ۴-۲۴ (S160-D4) — چکِ پاس‌شده‌ی قدیمیِ بی‌مقصد دیگر داخل نقد
              انتظاری نیست؛ ردیف جدای «خارج از نقد مورد انتظار» با مبلغ سرور (unknownDestinationOutside).
            */}
            {Number(expected?.unknownDestinationOutside ?? components?.clearedUnknownCheques ?? 0) > 0 ? (
              <tr className="bg-amber-50 text-amber-900">
                <td className="whitespace-normal">
                  چک پاس‌شده‌ی قدیمیِ بی‌مقصد (نامشخص) — خارج از نقد مورد انتظار
                  <div className="kbd font-normal leading-5">
                    {DESTINATION_UNKNOWN_ROW_NOTE}. اگر وجهش واقعاً در کشو است، اضافه‌ی صندوق به همین اندازه
                    طبیعی است و باید در یادداشت توضیح داده شود.
                  </div>
                </td>
                <td></td>
                <td className="text-left tabular-nums" dir="ltr">
                  {money(Number(expected?.unknownDestinationOutside ?? components?.clearedUnknownCheques ?? 0))}
                </td>
              </tr>
            ) : null}
            {/*
              =================================================================
              کار الف — ردیف‌های «فقط نمایشی».
              این‌ها عمداً *بعد از* جمع نهایی آمده‌اند و علامت + / − ندارند، چون
              هیچ‌کدام در `expectedCash` نیستند: پولی که به حساب مدیر رفته هرگز
              داخل کشو نبوده، و چکی که با کارتخوان وصول شده در انتظار کارتخوان
              است نه کشو. نشان دادنشان لازم است (وگرنه فروشنده فکر می‌کند پول گم
              شده) ولی جمع کردنشان همان باگی است که این کار برای رفعش است.
              =================================================================
            */}
            <tr className="bg-slate-50">
              <td colSpan={3} className="whitespace-normal font-bold">
                ردیف‌های فقط نمایشی — هیچ‌کدام در «نقد انتظاری داخل کشو» بالا نمی‌آیند
                <div className="kbd font-normal leading-5">{DESTINATION_COLUMNS_NOTE}</div>
              </td>
            </tr>
            {[
              [
                'انتظار کارتخوان این بازه',
                components?.cardExpected ?? 0,
                'دریافتی کارت (شامل سهم کارتِ وصول نسیه‌ی بازه‌های قبل) + چکی که با کارتخوان وصول شد. همین عدد را با رسید دستگاه کارتخوان مقایسه کنید، نه با ستون قدیمیِ «کارت».'
              ],
              [
                'چک پاس‌شده — با کارتخوان وصول شد',
                components?.clearedCardCheques ?? 0,
                'داخل «انتظار کارتخوان» بالا هست، داخل کشو نیست.'
              ],
              [
                'چک پاس‌شده — به حساب مدیر رفت',
                components?.clearedManagerCheques ?? 0,
                'نه در کشو، نه در کارتخوان.'
              ],
              [MANAGER_ACCOUNT_ROW_LABEL, components?.managerAccountReceived ?? 0, MANAGER_ACCOUNT_ROW_NOTE],
              [
                DESTINATION_UNKNOWN_ROW_LABEL,
                components?.destinationUnknownReceived ?? 0,
                DESTINATION_UNKNOWN_ROW_NOTE
              ],
              [
                'وصول نسیه‌ی دوره‌ی قبل — سهم نقد (داخل «نقد دریافتی این بازه»)',
                components?.priorCreditSettlements ?? 0,
                'بر اساس تاریخ دریافت واقعی. این پول امروز واقعاً وارد کشو شده ولی بابت فروش روزهای قبل است؛ از «نقد دریافتی» بالا همین مقدار مال وصول نسیه‌ی قدیمی است و جدا جمع زده نمی‌شود.'
              ],
              [
                'وصول نسیه‌ی بازه‌های قبل — سهم کارت',
                components?.priorCreditSettlementsCard ?? 0,
                'داخل «انتظار کارتخوان» بالا هست (از طریق دریافتی کارت)، جدا جمع زده نمی‌شود.'
              ],
              [
                'وصول نسیه‌ی بازه‌های قبل — سهم سایر',
                components?.priorCreditSettlementsOther ?? 0,
                ''
              ],
              [
                'کل چک پاس‌شده‌ی این بازه',
                components?.clearedChequesAll ?? 0,
                'جمع چهار سهم چک (نقد + نامشخص + کارتخوان + حساب مدیر) — برای تطبیق دستی با دفتر چک.'
              ]
            ].map(([label, value, hint]) => (
              <tr key={`info-${String(label)}`} className="text-slate-700">
                <td className="whitespace-normal">
                  {label}
                  {hint ? <div className="kbd font-normal leading-5">{hint}</div> : null}
                </td>
                <td className="text-center w-8 kbd">فقط نمایشی</td>
                <td className="text-left tabular-nums" dir="ltr">
                  {money(Number(value))}
                </td>
              </tr>
            ))}
            {/*
              =================================================================
              کار ب — «کالای برگشتیِ در انتظار پرداخت مدیر».
              عمداً *آخرین* ردیف و عمداً بدون عدد در ستون مبلغ: این ردیف کالا را
              می‌شمارد نه ریال را، و اگر مبلغش در همان ستونِ ریالیِ بالا می‌نشست،
              اولین کسی که جدول را جمع می‌زد یک عددِ بی‌ربط به کشو پیدا می‌کرد —
              دقیقاً همان قاطی‌شدنی که کار الف برای رفعش نوشته شد. مبلغِ
              کارت‌به‌کارت در متن توضیحی گفته می‌شود، نه در ستون.
              =================================================================
            */}
            {pending.totalQty > 0 && (
              <tr className={pendingToneBox(pending.tone)}>
                <td colSpan={3} className="whitespace-normal font-bold leading-7">
                  {faDigits(pending.totalQty)} قلم کالای برگشتی · {PENDING_RESTOCK_LABEL}
                  <div className="kbd font-normal leading-6">{pending.shiftWarning}</div>
                  <div className="kbd font-normal leading-6">
                    مبلغی که مدیر باید کارت‌به‌کارت کند: <b>{money(pending.summary.pendingAmount)}</b> ریال — این پول{' '}
                    <b>از کشو بیرون نرفته</b>، پس در «نقد انتظاری داخل کشو» و در کسری/اضافی بالا هیچ اثری ندارد. (این
                    ردیف هیچ ربطی به «{MANAGER_ACCOUNT_ROW_LABEL}» ندارد: آن پولی است که از مشتری گرفته‌ایم، این پولی
                    است که باید به مشتری برگردد.)
                  </div>
                  <div className="kbd font-normal leading-6">
                    {PENDING_RESTOCK_EXPLAINER} برگرداندن کالا به موجودی قابل‌فروش فقط در پنل قفل‌دار «پرداخت‌های مدیر
                    — کارت‌به‌کارت» (گزارشات فروش) انجام می‌شود؛ این صفحه فقط خبر می‌دهد.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paymentMutations.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded shadow">
          <div className="px-3 py-2 border-b font-bold text-amber-950">
            پرداخت‌های ویرایش/ابطال‌شدهٔ همین نشست
            <div className="kbd font-normal leading-6">
              فقط نمایشی است و در «نقد انتظاری داخل کشو» جمع نمی‌شود. اگر نقد کم شده، اول این ردیف‌ها را ببینید.
            </div>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>زمان</th>
                <th>عمل</th>
                <th>مبلغ قبل</th>
                <th>مبلغ بعد</th>
                <th>توضیح</th>
              </tr>
            </thead>
            <tbody>
              {paymentMutations.map((m) => (
                <tr key={m.id}>
                  <td>
                    {faDigits(m.atJalali ?? '—')} <span className="kbd">{faDigits(m.time ?? '')}</span>
                  </td>
                  <td>{m.action === 'SALE_PAYMENT_DELETE' ? 'ابطال' : 'ویرایش'}</td>
                  <td className="font-bold">{money(m.amountBefore ?? 0)}</td>
                  <td className="font-bold">{money(m.amountAfter ?? 0)}</td>
                  <td className="whitespace-normal">{m.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-white rounded shadow p-3 flex flex-wrap gap-3 items-end">
        <div>
          <div className="kbd">جمع نقد فروش (سیستم)</div>
          <div className="inp bg-emerald-50 border-emerald-300 font-bold text-emerald-800">{money(boxTotal)}</div>
        </div>
        <label>
          <div className="kbd">موجودی اول صندوق (اگر ثبت نشده)</div>
          <input className="inp w-40" dir="ltr" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
        </label>
        <div>
          <div className="kbd">نقد انتظاری (فرمول بالا)</div>
          <div className="inp bg-sky-50 border-sky-300 font-bold">{expectedCash == null ? '—' : money(expectedCash)}</div>
        </div>
        <label>
          <div className="kbd">شمارش نقدی کشو</div>
          <input className="inp w-40" dir="ltr" value={counted} onChange={(e) => setCounted(e.target.value)} />
        </label>
        {diff != null && (
          <div>
            <div className="kbd">
              {diffState === 'SHORTAGE' ? 'کسری صندوق' : diffState === 'OVERAGE' ? 'اضافه‌ی صندوق' : 'تطبیق کامل'}
            </div>
            <div
              className={`inp font-bold ${
                diffState === 'SHORTAGE'
                  ? 'bg-rose-50 border-rose-500 text-rose-800'
                  : diffState === 'OVERAGE'
                    ? 'bg-amber-50 border-amber-500 text-amber-800'
                    : 'bg-emerald-50 border-emerald-500 text-emerald-800'
              }`}
            >
              {money(diff)}
            </div>
          </div>
        )}
        <label className="flex-1 min-w-[200px]">
          <div className="kbd">
            یادداشت
            {needsNote && (
              <b className="text-rose-700">
                {' '}
                — مغایرت از آستانه‌ی {money(threshold)} ریال گذشته است؛ نوشتن دلیل اجباری است
              </b>
            )}
          </div>
          <input
            className={`inp ${needsNote && !note.trim() ? 'bg-rose-50 border-rose-500' : ''}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button className="btn" onClick={() => void printThermal()} disabled={!report || printBusy}>
          {printBusy ? 'در حال چاپ…' : 'چاپ حرارتی'}
        </button>
        <button className="btn" onClick={() => void printA4()} disabled={!report || printBusy}>
          {printBusy ? 'در حال چاپ…' : 'چاپ A4'}
        </button>
        <button
          className="btn"
          onClick={() =>
            void exportTable({
              fileName: 'بستن-صندوق',
              headers: HEADERS,
              rows: rows.map(rowValues)
            })
              .then((p) => flash(`فایل خروجی ساخته شد: ${p}`))
              .catch((e: any) => setErr(e.message))
          }
        >
          خروجی اکسل
        </button>
        <button
          className="btn btn-primary"
          onClick={() => setConfirmClose(true)}
          disabled={custodyGoverned !== false || busy || (needsNote && !note.trim())}
          title={custodyGoverned !== false ? custodyGoverned ? 'در حالت حضانت، بستن نهایی فقط با رمز مسئول در کنترل «صندوق» نوار بالا انجام می‌شود.' : 'تا مشخص شدن وضعیت حضانت، بستن قدیمی صندوق برای ایمنی غیرفعال است.' : needsNote && !note.trim() ? 'اول دلیل مغایرت را در یادداشت بنویسید' : undefined}
        >
          بستن صندوق
        </button>
      </div>

      {/*
        بخش ۴ — رفع تنگی UI: همان الگوی SalesInvoice.tsx (کف ارتفاع + سقف نسبت به
        ارتفاع پنجره + سرستون چسبان)، تا این جدول روی نمایشگرهای کوچک آب نرود و
        سرستون‌ها با اسکرول گم نشوند.
      */}
      <div className="tbl-card">
        <div className="p-2 font-bold border-b sticky top-0 bg-white z-20">
          سابقه‌ی بستن صندوق در این بازه
          <span className="kbd font-normal ms-2">
            دکمه‌ی «جزئیات» هر ردیف، همه‌ی فروش‌ها، برگشت‌ها و تعویض‌ها، نسیه و جمع‌بندی همان شیفت را نشان می‌دهد
          </span>
        </div>
        {sessionsWarnings.length > 0 && sessionsPage && (
          <div className="p-2 bg-rose-50 text-rose-800 font-bold border-b flex flex-wrap items-center gap-2">
            <span>⚠ {sessionsWarnings.join(' ')}</span>
            <button
              className="btn py-0.5"
              disabled={sessionsPage.skip <= 0}
              onClick={() => void loadSessions(Math.max(sessionsPage.skip - sessionsPage.take, 0))}
            >
              صفحه‌ی قبل
            </button>
            <button
              className="btn py-0.5"
              disabled={!sessionsPage.truncated}
              onClick={() => void loadSessions(sessionsPage.skip + sessionsPage.take)}
            >
              صفحه‌ی بعد
            </button>
          </div>
        )}
        <table className="tbl">
          <thead className="sticky top-9 bg-white z-10">
            <tr>
              <th>تاریخ</th>
              {/* بخش ۳: ساعت دقیق بستن صندوق (از CashboxService.sessions → toClock) */}
              <th>ساعت بستن</th>
              <th>شیفت</th>
              <th>تعداد فاکتور</th>
              <th>نقدی</th>
              <th>کارت</th>
              {/* کار الف: دو ستون تازه‌ی سابقه (رکورد قدیمی «—» می‌گیرد، نه عدد ساختگی) */}
              <th title={MANAGER_ACCOUNT_ROW_NOTE}>{MANAGER_ACCOUNT_ROW_LABEL}</th>
              <th>سایر / نامشخص</th>
              <th>اعتباری</th>
              <th>جمع کل فروش</th>
              {/* ---- بند ۱۵ و ۱۶: ستون‌های snapshot تازه‌ی CashSession ---- */}
              <th>موجودی اول</th>
              <th>واریز</th>
              <th>برداشت</th>
              <th>نقد انتظاری</th>
              <th>شمارش نقدی</th>
              <th>مغایرت</th>
              <th>یادداشت</th>
              {/* مورد ۵ — دکمه‌ی «جزئیات همان شیفت» */}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((c) => (
              <tr key={c.id}>
                <td>{faDigits(c.dayJalali)}</td>
                <td className="font-bold">{c.toClock ? faDigits(c.toClock) : '—'}</td>
                <td>{c.shiftName}</td>
                <td className="text-center">{faDigits(c.invoiceCount)}</td>
                <td>{money(c.cashTotal)}</td>
                <td>{money(c.cardTotal)}</td>
                <td className={(c.managerAccountReceived ?? 0) > 0 ? 'text-amber-800 font-bold' : ''}>
                  {c.managerAccountReceived == null ? '—' : money(c.managerAccountReceived)}
                </td>
                <td>
                  {c.otherTotal == null && c.destinationUnknownReceived == null
                    ? '—'
                    : money((c.otherTotal ?? 0) + (c.destinationUnknownReceived ?? 0))}
                </td>
                <td>{money(c.creditTotal)}</td>
                <td className="font-bold">{money(c.grandTotal)}</td>
                {/**
                  * رکوردهای قدیمی این ستون‌ها را ندارند: «—» نشان داده می‌شود، نه یک
                  * عدد ساختگی. جعل تاریخ ممنوع است (همان قاعده‌ی سرور).
                  */}
                <td>{c.openingFloat == null ? '—' : money(c.openingFloat)}</td>
                <td>{c.deposits == null ? '—' : money(c.deposits)}</td>
                <td>{c.withdrawals == null ? '—' : money(c.withdrawals)}</td>
                <td>{c.expectedCash == null ? '—' : money(c.expectedCash)}</td>
                <td>{c.countedTotal == null ? '—' : money(c.countedTotal)}</td>
                <td
                  className={
                    c.diff == null ? '' : c.diff < 0 ? 'text-rose-700 font-bold' : c.diff > 0 ? 'text-amber-700 font-bold' : 'text-emerald-700 font-bold'
                  }
                >
                  {c.diff == null ? '—' : money(c.diff)}
                  {c.legacyRecord && <div className="kbd">رکورد قدیمی — مغایرت نقدی قابل بازمحاسبه نیست</div>}
                </td>
                <td className="whitespace-normal">{c.note}</td>
                {/**
                  * مورد ۵ — «جزئیات کامل همین شیفت»: فاکتورهای فروش، برگشت‌ها و
                  * تعویض‌ها، نسیه و جمع‌بندی — قفل‌شده روی همین یک شیفت، برای
                  * بررسی جداگانه‌ی عملکرد کارمند هر شیفت.
                  */}
                <td className="whitespace-nowrap">
                  <button
                    className="btn py-0.5"
                    onClick={() =>
                      setDetail({
                        cashSessionId: c.id,
                        shiftId: c.shiftId ?? null,
                        fromJalali: c.fromJalali,
                        toJalali: c.toJalali
                      })
                    }
                    title="همه‌ی فاکتورهای فروش، برگشت‌ها و تعویض‌ها، نسیه و جمع‌بندی همین شیفت"
                  >
                    جزئیات
                  </button>
                </td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={18} className="text-center py-6 text-slate-400">
                  در این بازه صندوقی بسته نشده است
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* The legacy form cannot be mounted while custody governs (or while its
          status is unknown): it has a name picker but no PIN/count evidence. */}
      {custodyGoverned === false ? <ShiftSessionModal
        open={session.open}
        mode={session.mode}
        onClose={() => setSession({ open: false, mode: 'open' })}
        onDone={(s) => void onSessionDone(s)}
      /> : null}

      {/* مورد ۵ — پنجره‌ی جزئیات همان شیفت (فقط‌خواندنی) */}
      <ShiftDetailModal
        open={!!detail}
        cashSessionId={detail?.cashSessionId ?? null}
        shiftId={detail?.shiftId ?? null}
        fromJalali={detail?.fromJalali}
        toJalali={detail?.toJalali}
        onClose={() => setDetail(null)}
      />

      <ConfirmDialog
        open={confirmClose}
        title="بستن صندوق و پایان شیفت"
        message={
          <div className="space-y-2">
            <p>
              نقد انتظاری داخل کشو <b>{expectedCash == null ? '—' : money(expectedCash)}</b> ریال (
              {faDigits(t?.count ?? 0)} فاکتور) به‌عنوان یک «بستن صندوق» ثبت می‌شود
              {shift && !shift.closed ? ` و «${shift.sessionLabel ?? shift.name}» بسته می‌شود (پایان نشست).` : '.'}
            </p>
            {(priorCloseForTarget || repeatRequired) && (
              <p className="rounded border-2 border-amber-500 bg-amber-50 p-2 text-amber-900">
                این نشست/بازه قبلاً بسته شده است. بستن دوباره فقط یک snapshot و سابقه‌ی مستقل می‌سازد؛
                اثر خالص نقد و انبار دوباره اعمال نمی‌شود.
              </p>
            )}
            {countedNum != null && (
              <p className={diffState === 'MATCHED' ? 'text-emerald-800' : 'text-rose-800'}>
                شمارش نقدی شما <b>{money(countedNum)}</b> ریال است ⇒{' '}
                <b>
                  {diffState === 'SHORTAGE' ? 'کسری صندوق' : diffState === 'OVERAGE' ? 'اضافه‌ی صندوق' : 'تطبیق کامل'}{' '}
                  {money(Math.abs(diff ?? 0))} ریال
                </b>
                .
              </p>
            )}
            {countedNum == null && (
              <p className="kbd">
                پول نقد کشو را نشمرده‌اید؛ رکورد بدون مغایرت ثبت می‌شود. برای کشف کسری، شمارش نقدی را وارد کنید.
              </p>
            )}
            <p className="kbd">
              موجودی انبار با این کار تغییر نمی‌کند؛ کسر نهایی انبار روز با «تجمیع و انتقال» انجام می‌شود.
            </p>
            {/* کار ب — یادآوری پیش از بستن؛ بستن صندوق را *متوقف نمی‌کند* */}
            {pending.totalQty > 0 && (
              <p className={`rounded border-2 p-2 leading-7 ${pendingToneBox(pending.tone)}`}>
                <b>{pending.shiftWarning}</b> بستن صندوق با همین وضعیت درست است و این هشدار جلویش را نمی‌گیرد؛ فقط
                برای این است که کالای روی قفسه بی‌توضیح نماند.
              </p>
            )}
            <p className="kbd">
              بعد از بستن صندوق، اولین فعالیت بعدی یک <b>نشست تازه</b> باز می‌کند و سیستم همان‌جا نام شیفت را پیشنهاد
              می‌دهد و کارمند نشست را می‌پرسد. نشست‌های بسته‌شده هیچ‌وقت رونویسی نمی‌شوند، پس سهم فروش هر کارمند
              دست‌نخورده می‌ماند.
            </p>
          </div>
        }
        confirmLabel={priorCloseForTarget || repeatRequired ? 'بله، بستن دوباره را ثبت کن' : 'بله، صندوق را ببند'}
        busy={busy}
        onConfirm={() => void doClose(priorCloseForTarget || repeatRequired)}
        onCancel={() => {
          setConfirmClose(false)
          setRepeatRequired(false)
        }}
      />
    </div>
  )
}
