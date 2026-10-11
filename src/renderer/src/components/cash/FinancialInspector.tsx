import { useEffect, useMemo, useRef, useState } from 'react'
import { faDigits, money } from '@shared/jalali'
import type { NetToDrawerAlarm, SplitDrawerPosResult } from '@shared/cashExplainer'
import type {
  FinancialDocumentDetail,
  FinancialDocumentResponse,
  FinancialInspectorKey,
  FinancialSourceKey,
  FinancialSourceResponse,
  FinancialSourceResult,
  FinancialSourceSort,
  ManagerStoreCreditCodeReveal,
  SaleAccountingStatements,
  SaleReportFilter,
  SaleReportTotals
} from '@shared/types'
import { call, CH } from '../../lib/api'
import { useManagerSession } from '../../hooks/useManagerSession'

type FocusArea = 'overview' | 'drawer' | 'pos' | 'other' | 'manager' | 'nonCash'
type Pane =
  | { type: 'overview' }
  | { type: 'formula'; focus: FocusArea }
  | { type: 'sources'; key: FinancialInspectorKey }
  | { type: 'document'; detail: FinancialDocumentDetail }

export interface FinancialInspectorProps {
  open: boolean
  onClose: () => void
  scope: SaleReportFilter
  totals: Partial<SaleReportTotals>
  statements: SaleAccountingStatements | null | undefined
  referenceRealCash: number
  split: SplitDrawerPosResult
  bridgeAlarm: NetToDrawerAlarm
  initialFocus?: FocusArea
  /** ورود مستقیم از کارت گردش اعتبار به همان فهرست امنِ منابع. */
  initialSourceKey?: FinancialInspectorKey
  onOpenBridgeDiag?: () => void
}

const BUTTON =
  'appearance-none border-0 cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const SORTS: Array<{ value: FinancialSourceSort; label: string }> = [
  { value: 'DATE_DESC', label: 'تاریخ: جدیدتر' },
  { value: 'DATE_ASC', label: 'تاریخ: قدیمی‌تر' },
  { value: 'AMOUNT_DESC', label: 'مبلغ: بیش‌تر' },
  { value: 'AMOUNT_ASC', label: 'مبلغ: کم‌تر' },
  { value: 'DOCUMENT_ASC', label: 'سند: الف تا ی' },
  { value: 'DOCUMENT_DESC', label: 'سند: ی تا الف' }
]

function cloneScope(scope: SaleReportFilter): SaleReportFilter {
  return {
    ...scope,
    channels: scope.channels ? [...scope.channels] : scope.channels,
    invoiceIds: scope.invoiceIds ? [...scope.invoiceIds] : scope.invoiceIds
  }
}

function focusTitle(focus: FocusArea): string {
  return {
    overview: 'جمع‌بندی اعداد',
    drawer: 'جزئیات کشوی نقدی',
    pos: 'جزئیات کارت‌خوان',
    other: 'جزئیات سایر / اعتباری / نامشخص',
    manager: 'دریافتی حساب مدیر',
    nonCash: 'تسویه‌های غیرنقدی'
  }[focus]
}

function inspectorKeyLabel(key: FinancialInspectorKey): string {
  const labels: Partial<Record<FinancialInspectorKey, string>> = {
    drawerCashReceived: 'دریافت‌های نقدی ثبت‌شده',
    posCardReceived: 'دریافت‌های کارت‌خوان فروشگاه',
    otherMethodReceived: 'پرداخت با سایر روش‌ها',
    storeCreditIssuedAll: 'کل اعتبار خرید صادرشده',
    storeCreditIssuedReturn: 'اعتبار صادرشده بابت برگشت',
    storeCreditIssuedExchange: 'اعتبار صادرشده بابت تعویض',
    storeCreditIssuedManual: 'اعتبار دستی/مدیریتی صادرشده',
    storeCreditIssuedOverpay: 'اعتبار صادرشده از اضافه‌دریافت',
    storeCreditIssuedRemainder: 'اعتبار باقی‌ماندهٔ مصرف جزئی',
    storeCreditIssuedOther: 'اعتبار با خاستگاه ثبت‌نشده',
    storeCreditExpired: 'ماندهٔ اعتبارهای منقضی تا پایان بازه',
    storeCreditExpiredInRange: 'ماندهٔ اعتبارهای منقضی‌شده در بازه',
    storeCreditCanceled: 'اعتبارهای لغوشده'
  }
  return labels[key] ?? key
}

function pageLabel(skip: number, total: number, count: number): string {
  if (!total) return 'بدون سند'
  return `نمایش ${faDigits(skip + 1)} تا ${faDigits(skip + count)} از ${faDigits(total)} سند`
}

export default function FinancialInspector({
  open,
  onClose,
  scope,
  totals,
  statements,
  referenceRealCash,
  split,
  bridgeAlarm,
  initialFocus = 'overview',
  initialSourceKey,
  onOpenBridgeDiag
}: FinancialInspectorProps) {
  const { isManager } = useManagerSession()
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const wasOpenRef = useRef(false)
  const requestSeq = useRef(0)
  const [scopeSnapshot, setScopeSnapshot] = useState<SaleReportFilter>(() => cloneScope(scope))
  const [totalsSnapshot, setTotalsSnapshot] = useState(totals)
  const [statementsSnapshot, setStatementsSnapshot] = useState(statements ?? null)
  const [referenceSnapshot, setReferenceSnapshot] = useState(referenceRealCash)
  const [splitSnapshot, setSplitSnapshot] = useState(split)
  const [alarmSnapshot, setAlarmSnapshot] = useState<NetToDrawerAlarm>(bridgeAlarm)
  const [stack, setStack] = useState<Pane[]>([{ type: 'overview' }])
  const stackRef = useRef<Pane[]>(stack)
  const [sourceResult, setSourceResult] = useState<FinancialSourceResult | null>(null)
  const [sourcesBusy, setSourcesBusy] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchApplied, setSearchApplied] = useState('')
  const [sort, setSort] = useState<FinancialSourceSort>('DATE_DESC')
  const [documentBusy, setDocumentBusy] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  /** فقط بعد از درخواست صریح مدیر، و فقط تا وقتی نشست او باز است. */
  const [revealedCreditCode, setRevealedCreditCode] = useState<string | null>(null)
  const [revealBusy, setRevealBusy] = useState(false)
  const [revealError, setRevealError] = useState<string | null>(null)

  useEffect(() => {
    stackRef.current = stack
  }, [stack])

  const pane = stack[stack.length - 1]
  const bridgeRows = statementsSnapshot?.bridge.rows ?? []
  const sourceKey = pane.type === 'sources' ? pane.key : null

  /** یک snapshot از گزارشِ اجراشده؛ تغییر فیلتر فرم، مودال باز را جابه‌جا نمی‌کند. */
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setScopeSnapshot(cloneScope(scope))
      setTotalsSnapshot(totals)
      setStatementsSnapshot(statements ?? null)
      setReferenceSnapshot(referenceRealCash)
      setSplitSnapshot(split)
      setAlarmSnapshot(bridgeAlarm)
      // ورود از یک کاشی، بخش جزئیات را نشان می‌دهد اما ریشهٔ ریزبین همچنان
      // جمع‌بندی است؛ پس Esc اول به همان ریشه برمی‌گردد و فقط Esc بعدی می‌بندد.
      setStack(initialSourceKey
        ? [{ type: 'overview' }, { type: 'sources', key: initialSourceKey }]
        : initialFocus === 'overview'
          ? [{ type: 'overview' }]
          : [{ type: 'overview' }, { type: 'formula', focus: initialFocus }])
      setSourceResult(null)
      setSourcesError(null)
      setSearchDraft('')
      setSearchApplied('')
      setSort('DATE_DESC')
      setDocumentError(null)
      setRevealedCreditCode(null)
      setRevealError(null)
      setRevealBusy(false)
    }
    wasOpenRef.current = open
  }, [open, scope, totals, statements, referenceRealCash, split, bridgeAlarm, initialFocus, initialSourceKey])

  /** خروج مدیر یا انقضای نشست نباید کد revealشده را روی صفحه نگه دارد. */
  useEffect(() => {
    if (!isManager) {
      setRevealedCreditCode(null)
      setRevealError(null)
    }
  }, [isManager])

  /** focus trap و بازگردانی focus؛ یک مودال داخلی با navigation stack است، نه مودال‌های روی هم. */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // Esc behaves like a manager's back button inside the inspector; only
        // the root page closes the dialog.
        if (stackRef.current.length > 1) setStack((current) => current.slice(0, -1))
        else onClose()
        return
      }
      if (event.key !== 'Tab') return
      const elements = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!elements?.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onKeyDown)
      if (opener && dialogRef.current?.contains(document.activeElement)) opener.focus()
    }
  }, [open, onClose])

  const go = (next: Pane) => setStack((current) => [...current, next])
  const back = () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current))

  const sourceRow = useMemo(() => bridgeRows.find((row) => row.key === sourceKey) ?? null, [bridgeRows, sourceKey])
  const sourceLabel = sourceResult?.label ?? sourceRow?.label ?? (sourceKey ? inspectorKeyLabel(sourceKey) : '')

  useEffect(() => {
    if (!open || !sourceKey) return
    const seq = ++requestSeq.current
    setSourcesBusy(true)
    setSourcesError(null)
    setSourceResult(null)
    void call<FinancialSourceResponse>(CH.saleReportFinancialSources, {
      scope: scopeSnapshot,
      key: sourceKey,
      skip: 0,
      take: 50,
      search: searchApplied,
      sort
    })
      .then((response) => {
        if (seq !== requestSeq.current) return
        if (!response?.ok || !response.result) throw new Error(response?.message || 'منابع این عدد خوانده نشد.')
        setSourceResult(response.result)
      })
      .catch((error: any) => {
        if (seq === requestSeq.current) setSourcesError(error?.message || 'منابع این عدد خوانده نشد.')
      })
      .finally(() => {
        if (seq === requestSeq.current) setSourcesBusy(false)
      })
  }, [open, sourceKey, scopeSnapshot, searchApplied, sort])

  const loadSourcePage = (skip: number) => {
    if (!sourceKey) return
    const seq = ++requestSeq.current
    setSourcesBusy(true)
    setSourcesError(null)
    void call<FinancialSourceResponse>(CH.saleReportFinancialSources, {
      scope: scopeSnapshot,
      key: sourceKey,
      skip,
      take: 50,
      search: searchApplied,
      sort
    })
      .then((response) => {
        if (seq !== requestSeq.current) return
        if (!response?.ok || !response.result) throw new Error(response?.message || 'منابع این عدد خوانده نشد.')
        setSourceResult(response.result)
      })
      .catch((error: any) => {
        if (seq === requestSeq.current) setSourcesError(error?.message || 'منابع این عدد خوانده نشد.')
      })
      .finally(() => {
        if (seq === requestSeq.current) setSourcesBusy(false)
      })
  }

  const openDocument = (ref: { kind: string; id: number }) => {
    if (!sourceKey) return
    setDocumentBusy(true)
    setDocumentError(null)
    setRevealedCreditCode(null)
    setRevealError(null)
    void call<FinancialDocumentResponse>(CH.saleReportFinancialDocument, { scope: scopeSnapshot, key: sourceKey, ref })
      .then((response) => {
        if (!response?.ok || !response.detail) throw new Error(response?.message || 'شناسنامهٔ سند خوانده نشد.')
        go({ type: 'document', detail: response.detail })
      })
      .catch((error: any) => setDocumentError(error?.message || 'شناسنامهٔ سند خوانده نشد.'))
      .finally(() => setDocumentBusy(false))
  }

  /**
   * کد هرگز همراه DTO ریزبین نمی‌آید. فقط مدیرِ حاضر می‌تواند با این عملِ صریح
   * IPC جدا را صدا بزند؛ main نیز مستقل از این شرط UI نشست MANAGER را کنترل می‌کند.
   */
  const revealCreditCode = () => {
    if (pane.type !== 'document' || pane.detail.ref.kind !== 'STORE_CREDIT' || !pane.detail.ref.subKind) return
    if (!isManager) {
      setRevealError('نمایش کد فقط برای مدیرِ واردشده مجاز است.')
      return
    }
    setRevealBusy(true)
    setRevealError(null)
    void call<ManagerStoreCreditCodeReveal>(CH.creditManagerCodeReveal, {
      sourceId: pane.detail.ref.id,
      sourceSubKind: pane.detail.ref.subKind
    })
      .then((result) => {
        if (!result?.code) throw new Error('کد اعتبار برای نمایش برنگشت.')
        setRevealedCreditCode(result.code)
      })
      .catch((error: any) => {
        setRevealedCreditCode(null)
        setRevealError(error?.message || 'کد اعتبار نمایش داده نشد.')
      })
      .finally(() => setRevealBusy(false))
  }

  if (!open) return null

  const cash = statementsSnapshot?.cash
  const bridgeRealCash = bridgeRows.find((row) => row.key === 'realCash')
  const amountCard = (label: string, value: number, note: string, onClick?: () => void, tone = 'slate') => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`${BUTTON} text-right border p-3 shadow-sm transition-colors ${
        tone === 'sky' ? 'bg-sky-50 border-sky-300 hover:bg-sky-100' :
        tone === 'emerald' ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' :
        tone === 'amber' ? 'bg-amber-50 border-amber-300 hover:bg-amber-100' :
        'bg-white border-slate-200 hover:bg-slate-50'
      } ${onClick ? '' : 'cursor-default'}`}
    >
      <span className="block text-xs font-bold text-slate-700">{label}</span>
      <b className="block mt-1 text-lg text-slate-950" dir="ltr">{money(value)} <span className="text-xs font-normal">ریال</span></b>
      <span className="block mt-1 text-[11px] leading-5 text-slate-600">{note}</span>
    </button>
  )

  /** هر سطر یک مبلغ آمادهٔ گزارش را نشان می‌دهد؛ جمع/تفریق تازه‌ای در Renderer ندارد. */
  const detailAmount = (label: string, value: number, note: string, key?: FinancialInspectorKey, tone = 'slate') => {
    const content = <>
      <span className="min-w-0"><span className="block font-bold text-slate-800">{label}</span><span className="mt-0.5 block text-xs leading-5 text-slate-600">{note}</span></span>
      <b className="shrink-0 text-base text-slate-950" dir="ltr">{money(value)} <span className="text-xs font-normal">ریال</span></b>
    </>
    const toneClass = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : tone === 'blue' ? 'border-blue-200 bg-blue-50 hover:bg-blue-100' : tone === 'amber' ? 'border-amber-200 bg-amber-50 hover:bg-amber-100' : 'border-slate-200 bg-white hover:bg-slate-50'
    return key ? (
      <button type="button" className={`${BUTTON} w-full border p-3 text-right flex items-center justify-between gap-3 ${toneClass}`} onClick={() => go({ type: 'sources', key })}>
        {content}<span className="sr-only">نمایش اسناد ثبت‌شده</span>
      </button>
    ) : <div className={`w-full border p-3 text-right flex items-center justify-between gap-3 rounded ${toneClass}`}>{content}</div>
  }

  const breadcrumb = pane.type === 'overview'
    ? ['ریزبین مالی']
    : pane.type === 'formula'
      ? ['ریزبین مالی', focusTitle(pane.focus)]
      : pane.type === 'sources'
        ? ['ریزبین مالی', sourceLabel, 'اسناد ثبت‌شده']
        : ['ریزبین مالی', 'اسناد سازنده', pane.detail.title]

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-xs p-3 sm:p-5 print:hidden flex items-start justify-center overflow-auto"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        ref={dialogRef}
        dir="rtl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="financial-inspector-title"
        className="w-full max-w-6xl my-2 bg-white rounded-xl shadow-2xl border border-slate-300 overflow-hidden"
      >
        <header className="bg-slate-950 text-white px-4 sm:px-5 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 id="financial-inspector-title" className="font-black text-base sm:text-lg">ریزبین مالی گزارش فروش</h2>
            <p className="text-xs text-slate-300 mt-0.5">فقط‌خواندنی · از مبلغ گزارش تا رویدادها و شناسنامهٔ سند</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className={`${BUTTON} p-1.5 text-slate-300 hover:text-white hover:bg-slate-800`} aria-label="بستن ریزبین مالی" title="بستن (Esc)">✕</button>
        </header>

        <div className="px-4 sm:px-5 py-2 border-b bg-slate-50 flex items-center gap-1 flex-wrap text-xs" aria-label="مسیر فعلی">
          {breadcrumb.map((item, index) => (
            <span key={`${item}-${index}`} className="flex items-center gap-1">
              {index > 0 && <span className="text-slate-400" aria-hidden="true">‹</span>}
              <span className={index === breadcrumb.length - 1 ? 'font-bold text-slate-800' : 'text-slate-500'}>{item}</span>
            </span>
          ))}
          {stack.length > 1 && <button type="button" className={`${BUTTON} mr-auto px-2 py-1 text-sky-800 hover:bg-sky-100`} onClick={back}>بازگشت به مرحلهٔ قبل</button>}
        </div>

        <main className="p-4 sm:p-5 max-h-[72vh] overflow-y-auto">
          {pane.type === 'overview' && (
            <div className="space-y-5">
              <div className="rounded border border-sky-200 bg-sky-50 p-3 text-xs leading-6 text-sky-950">
                این پنجره هیچ عددی را بازحساب نمی‌کند. اعداد رسمی از گزارش اجراشده گرفته شده‌اند و با snapshot فیلتر همان گزارش باز می‌شوند.
                «شمارش فیزیکی کشو» یا «رسید پایان‌روز پوز» جایگزین این گزارش نیست.
              </div>

              <section>
                <h3 className="font-bold text-slate-900 mb-2">لایهٔ ۰ — اعداد مرجع و دامنهٔ هر کدام</h3>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {amountCard('عدد مرجع فعلی گزارش', referenceSnapshot, 'receivedTotal − بازپرداخت نقد/کارت؛ منشأ ترکیبی دارد و لزوماً شمارش فیزیکی نیست.', () => go({ type: 'formula', focus: 'overview' }), 'sky')}
                  {amountCard('جمع کاشی‌های تفکیکی', splitSnapshot.sum, 'کشو + پوز + سایر؛ مسیرهای غیرنقدی/نامشخص جدا هستند.', () => go({ type: 'formula', focus: 'overview' }), 'emerald')}
                  {amountCard('وجه واقعی در پل تطبیق', bridgeRealCash?.amount ?? 0, bridgeRealCash?.hint || 'منشأ: ردیف رسمی پل تطبیق.', () => go({ type: 'sources', key: 'realCash' }), 'amber')}
                  {amountCard('خالص گردش نقدی صورت‌حساب', cash?.netCashMovement ?? 0, 'شامل بازپرداخت و برداشت/واریز ثبت‌شده؛ با عدد سربرگ یکی نیست.', () => go({ type: 'formula', focus: 'overview' }))}
                </div>
              </section>

              <section className="grid gap-3 lg:grid-cols-2">
                <div className="rounded border border-slate-200 p-3">
                  <h3 className="font-bold text-slate-900">تفکیک قابل کنترل</h3>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <button type="button" className={`${BUTTON} bg-emerald-50 border border-emerald-200 text-right p-2 hover:bg-emerald-100`} onClick={() => go({ type: 'formula', focus: 'drawer' })}>کشو: <b dir="ltr">{money(splitSnapshot.drawer)}</b></button>
                    <button type="button" className={`${BUTTON} bg-blue-50 border border-blue-200 text-right p-2 hover:bg-blue-100`} onClick={() => go({ type: 'formula', focus: 'pos' })}>پوز: <b dir="ltr">{money(splitSnapshot.pos)}</b></button>
                    <button type="button" className={`${BUTTON} bg-slate-50 border border-slate-200 text-right p-2 hover:bg-slate-100`} onClick={() => go({ type: 'formula', focus: 'other' })}>سایر/اعتباری/نامشخص: <b dir="ltr">{money(splitSnapshot.other)}</b></button>
                    <button type="button" className={`${BUTTON} bg-purple-50 border border-purple-200 text-right p-2 hover:bg-purple-100`} onClick={() => go({ type: 'formula', focus: 'manager' })}>حساب مدیر: <b dir="ltr">{money(splitSnapshot.managerOutside)}</b></button>
                  </div>
                </div>
                <div className={`rounded border p-3 text-sm ${bridgeAlarm === 'BRIDGE_UNBALANCED' ? 'border-rose-300 bg-rose-50 text-rose-950' : bridgeAlarm === 'COMPOSITION_DRIFT' ? 'border-amber-300 bg-amber-50 text-amber-950' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>
                  <h3 className="font-bold">وضعیت تطبیق</h3>
                  {bridgeAlarm === 'BRIDGE_UNBALANCED' ? (
                    <>
                      <p className="mt-1">پل حسابداری بسته نیست: {money(Math.abs(statementsSnapshot?.bridge.unexplained ?? 0))} ریال بدون توضیح باقی مانده است.</p>
                      {onOpenBridgeDiag && <button type="button" className={`${BUTTON} mt-2 bg-rose-700 px-3 py-1.5 text-white hover:bg-rose-800`} onClick={() => { onClose(); onOpenBridgeDiag() }}>باز کردن نمای تشخیص پل (رمز تازه لازم است)</button>}
                    </>
                  ) : bridgeAlarm === 'COMPOSITION_DRIFT' ? (
                    <p className="mt-1">پل حسابداری تراز است؛ فقط ترکیب اعداد نمایشی با عدد مرجع تفاوت دارد. این وضعیت به‌تنهایی مغایرت حسابداری نیست.</p>
                  ) : (
                    <p className="mt-1">پل حسابداری برای snapshot فعلی تراز است.</p>
                  )}
                </div>
              </section>

              <section>
                <h3 className="font-bold text-slate-900 mb-2">لایهٔ ۱ — ردیف‌های رسمی پل تطبیق</h3>
                <p className="text-xs text-slate-600 mb-2">روی هر ردیف کلیک کنید تا اسناد سازندهٔ همان عدد، با سرچ و صفحه‌بندی سمت سرور، باز شوند.</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {bridgeRows.map((row) => (
                    <button key={row.key} type="button" className={`${BUTTON} border border-slate-200 bg-white hover:bg-sky-50 hover:border-sky-300 text-right p-2.5 flex items-center justify-between gap-3`} onClick={() => go({ type: 'sources', key: row.key as FinancialSourceKey })}>
                      <span className="min-w-0"><span className="block font-bold text-slate-800">{row.label}</span><span className="block text-[11px] text-slate-500 truncate">{row.hint || 'مشاهده اسناد سازنده'}</span></span>
                      <b dir="ltr" className={row.sign === -1 ? 'text-rose-800 shrink-0' : 'text-emerald-800 shrink-0'}>{row.sign === -1 ? '− ' : '+ '}{money(row.amount)}</b>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}

          {pane.type === 'formula' && (
            <div className="space-y-4">
              <div className="rounded border border-sky-200 bg-sky-50 p-3">
                <h3 className="font-bold text-sky-950">جزئیات مبلغ — {focusTitle(pane.focus)}</h3>
                <p className="text-xs leading-6 mt-1 text-sky-900">برای دیدن رویدادهای ثبت‌شده، روی هر ردیفِ دارای کادر کلیک کنید. این صفحه مبلغی را محاسبه یا تغییر نمی‌دهد.</p>
              </div>

              {(pane.focus === 'overview' || pane.focus === 'drawer') && (
                <section className="rounded border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900">کشوی نقدی</h4><b dir="ltr" className="text-lg text-emerald-800">{money(splitSnapshot.drawer)} ریال</b></div>
                  <p className="text-xs leading-6 text-slate-600">انتظار ثبت‌شدهٔ کشو پس از بازپرداخت‌های نقدی است؛ شمارش فیزیکی کشو، تنخواه و برداشت/واریز ثبت‌شده مسیر جدا دارند.</p>
                  {detailAmount('دریافت‌های نقدی ثبت‌شده', cash?.cashReceived ?? totalsSnapshot.cashTotal ?? 0, 'پرداخت‌های نقدی غیرچکی در این بازه.', 'drawerCashReceived', 'emerald')}
                  {detailAmount('بازپرداخت نقدی', totalsSnapshot.refundCashTotal ?? 0, 'مبلغی که بابت برگشت یا مابه‌التفاوت تعویض از کشو پرداخت شده است.', 'cashRefunds', 'amber')}
                </section>
              )}

              {(pane.focus === 'overview' || pane.focus === 'pos') && (
                <section className="rounded border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900">کارت‌خوان فروشگاه</h4><b dir="ltr" className="text-lg text-blue-800">{money(splitSnapshot.pos)} ریال</b></div>
                  <p className="text-xs leading-6 text-slate-600">انتظار ثبت‌شدهٔ پوز پس از بازپرداخت کارتی است. کارت‌به‌کارت و دریافتی حساب مدیر در این مبلغ نیستند.</p>
                  {detailAmount('دریافت‌های کارت‌خوان ثبت‌شده', totalsSnapshot.cardTotal ?? cash?.cardReceived ?? 0, 'پرداخت‌های کارتی غیرچکی در همین بازه.', 'posCardReceived', 'blue')}
                  {detailAmount('بازپرداخت از کارت‌خوان', totalsSnapshot.refundCardTotal ?? 0, 'مبلغی که بابت برگشت یا مابه‌التفاوت تعویض از پوز بازپرداخت شده است.', 'cardRefunds', 'amber')}
                </section>
              )}

              {(pane.focus === 'overview' || pane.focus === 'other' || pane.focus === 'nonCash') && (
                <section className="rounded border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900">سایر، اعتباری و مقصد نامشخص</h4><b dir="ltr" className="text-lg text-slate-800">{money(splitSnapshot.other)} ریال</b></div>
                  <p className="text-xs leading-6 text-slate-600">این سبد، پول فیزیکی کشو یا پوز نیست. هر مسیر برای بررسی جدا نمایش داده می‌شود.</p>
                  {detailAmount('پرداخت با سایر روش‌ها', cash?.otherReceived ?? totalsSnapshot.otherTotal ?? 0, 'پرداخت‌های ثبت‌شده با روشی غیر از نقد، کارت‌خوان، اعتبار و حساب مدیر.', 'otherMethodReceived')}
                  {detailAmount('تسویه‌های اعتباری', totalsSnapshot.creditTotal ?? 0, 'این مبلغ فقط بر پایهٔ فاکتورهای نمایش‌داده‌شده در صفحهٔ فعلی گزارش است؛ برای آن تیک هم‌خوانی کل‌بازه یا تاریخچهٔ کامل صادر نمی‌شود.')}
                  {detailAmount('دریافتی با مقصد نامشخص', totalsSnapshot.destinationUnknownTotal ?? 0, 'مقصد واقعی هنوز نیازمند بررسی مدیر است.', 'destinationUnknownReceived', 'amber')}
                </section>
              )}

              {(pane.focus === 'overview' || pane.focus === 'manager') && (
                <section className="rounded border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-slate-900">دریافتی حساب مدیر</h4><b dir="ltr" className="text-lg text-purple-800">{money(splitSnapshot.managerOutside)} ریال</b></div>
                  <p className="text-xs leading-6 text-slate-600">بدهی مشتری ممکن است کم شده باشد، اما این مبلغ به کشو یا کارت‌خوان فروشگاه نرسیده است.</p>
                  {detailAmount('رویدادهای واریز به حساب مدیر', splitSnapshot.managerOutside, 'فقط برای بررسی؛ این مبلغ در کنترل فیزیکی فروشگاه وارد نمی‌شود.', 'managerAccountReceived')}
                </section>
              )}

              {pane.focus === 'overview' && (
                <section className="rounded border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between gap-3"><h4 className="font-bold text-amber-950">عدد مرجع سربرگ گزارش</h4><b dir="ltr" className="text-lg text-amber-950">{money(referenceSnapshot)} ریال</b></div>
                  <p className="mt-1 text-xs leading-6 text-amber-900">این عدد، تعریف سربرگ گزارش است و با گردش نقدی صورت‌حساب یا «وجه واقعی» پل لزوماً یکسان نیست. هر کدام عمداً معنای جدا دارند.</p>
                </section>
              )}
            </div>
          )}

          {pane.type === 'sources' && (
            <div className="space-y-3">
              <div className="rounded border border-sky-200 bg-sky-50 p-3">
                <h3 className="font-bold text-sky-950">اسناد ثبت‌شدهٔ «{sourceLabel}»</h3>
                <p className="text-xs text-sky-900 mt-1 leading-6">مبلغ رسمی از گزارش اجراشده می‌آید. جست‌وجو فقط فهرست سندها را محدود می‌کند و هرگز جای مبلغ رسمی را نمی‌گیرد.</p>
              </div>
              <form className="flex gap-2 flex-wrap items-end" onSubmit={(event) => { event.preventDefault(); setSearchApplied(searchDraft) }}>
                <label className="text-xs font-bold text-slate-700">جست‌وجوی سند<input className="inp mt-1 block min-w-56" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="شماره فیش، شناسه یا متن سند" /></label>
                <label className="text-xs font-bold text-slate-700">مرتب‌سازی<select className="inp mt-1 block" value={sort} onChange={(event) => setSort(event.target.value as FinancialSourceSort)}>{SORTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                <button type="submit" className={`${BUTTON} bg-sky-700 text-white hover:bg-sky-800 px-3 py-2 text-sm`}>اعمال</button>
                {searchApplied && <button type="button" className={`${BUTTON} border border-slate-300 bg-white hover:bg-slate-50 px-3 py-2 text-sm`} onClick={() => { setSearchDraft(''); setSearchApplied('') }}>پاک‌کردن</button>}
              </form>
              {sourcesBusy && <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">در حال خواندن منابع فقط‌خواندنی…</div>}
              {sourcesError && <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900" role="alert">{sourcesError}</div>}
              {sourceResult && (
                <>
                  <div className={`rounded border p-3 text-sm ${sourceResult.reconciles ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
                    <div className="flex gap-3 flex-wrap justify-between"><span>مبلغ رسمی گزارش: <b dir="ltr">{money(sourceResult.totalAmount)}</b> ریال</span><span>جمع {sourceResult.search ? 'نتیجهٔ جست‌وجو' : 'همهٔ رویدادهای ثبت‌شده'}: <b dir="ltr">{money(sourceResult.sourceAmount)}</b> ریال</span></div>
                    <div className="mt-1 text-xs leading-6">
                      {sourceResult.reconciles
                        ? '✓ همهٔ رویدادهای این بخش با مبلغ رسمی گزارش هم‌خوان هستند.'
                        : sourceResult.search
                          ? `برای نتایج فیلترشده تیک هم‌خوانی صادر نمی‌شود؛ اختلاف با مبلغ رسمی: ${faDigits(money(Math.abs(sourceResult.difference)))} ریال.`
                          : sourceResult.difference > 0
                            ? `نیازمند بررسی: مبلغ رسمی گزارش ${faDigits(money(sourceResult.difference))} ریال بیش‌تر از جمع رویدادهای این فهرست است.`
                            : `نیازمند بررسی: جمع رویدادهای این فهرست ${faDigits(money(Math.abs(sourceResult.difference)))} ریال بیش‌تر از مبلغ رسمی گزارش است.`}
                    </div>
                    {!sourceResult.reconciles && !sourceResult.search && (sourceKey === 'cashRefunds' || sourceKey === 'cardRefunds' || sourceKey === 'exchangeCashRefunds' || sourceKey === 'exchangeCardRefunds') && onOpenBridgeDiag && (
                      <button type="button" className={`${BUTTON} mt-2 border border-amber-400 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-950 hover:bg-amber-100`} onClick={() => { onClose(); onOpenBridgeDiag() }}>
                        باز کردن بررسی فقط‌خواندنیِ اختلاف بازپرداخت
                      </button>
                    )}
                  </div>
                  <div className="overflow-x-auto border rounded"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-100 text-slate-700"><tr><th className="p-2 text-right">سند</th><th className="p-2 text-right">تاریخ</th><th className="p-2 text-right">فیش</th><th className="p-2 text-right">مسیر</th><th className="p-2 text-left">سهم</th><th className="p-2" /></tr></thead><tbody>{sourceResult.sources.map((source) => <tr key={`${source.ref.kind}-${source.ref.id}`} className="border-t"><td className="p-2 max-w-[330px]">{source.documentLabel}</td><td className="p-2">{faDigits(source.dateJalali ?? '—')}</td><td className="p-2">{source.receiptNo == null ? '—' : faDigits(source.receiptNo)}</td><td className="p-2">{source.effect === 'IN' ? 'ورود/وصول' : source.effect === 'OUT' ? 'خروج/بازپرداخت' : source.effect === 'NON_CASH' ? 'غیرنقدی' : 'مانده'}</td><td className="p-2 text-left font-bold" dir="ltr">{money(source.amount)}</td><td className="p-2 text-left"><button type="button" className={`${BUTTON} border border-sky-300 bg-white text-sky-800 hover:bg-sky-50 px-2 py-1 text-xs`} disabled={documentBusy} onClick={() => openDocument(source.ref)}>شناسنامه</button></td></tr>)}</tbody></table></div>
                  {!sourceResult.sources.length && !sourcesBusy && <div className="rounded border border-slate-200 p-4 text-sm text-slate-600">سندی با این جست‌وجو پیدا نشد.</div>}
                  {documentError && <div className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900" role="alert">{documentError}</div>}
                  <div className="flex items-center justify-between gap-2 flex-wrap text-xs"><span>{pageLabel(sourceResult.page.skip, sourceResult.page.totalCount, sourceResult.sources.length)}</span><div className="flex gap-2"><button type="button" className={`${BUTTON} border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5`} disabled={sourceResult.page.skip === 0 || sourcesBusy} onClick={() => loadSourcePage(Math.max(0, sourceResult.page.skip - sourceResult.page.take))}>قبلی</button><button type="button" className={`${BUTTON} border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5`} disabled={!sourceResult.page.truncated || sourcesBusy} onClick={() => loadSourcePage(sourceResult.page.skip + sourceResult.page.take)}>بعدی</button></div></div>
                </>
              )}
            </div>
          )}

          {pane.type === 'document' && (
            <div className="space-y-4">
              <div className="rounded border border-sky-200 bg-sky-50 p-3"><h3 className="font-bold text-sky-950">لایهٔ ۳ — {pane.detail.title}</h3><p className="text-xs text-sky-900 mt-1">سند فقط‌خواندنی است و عضویت آن در عدد مالی بازشده، پیش از ارسال جزئیات در Main Process تأیید شده است.</p></div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                <div className="border rounded p-3"><span className="text-xs text-slate-500">سهم در این عدد مالی</span><b className="block mt-1" dir="ltr">{money(pane.detail.sourceAmount)} ریال</b></div>
                <div className="border rounded p-3"><span className="text-xs text-slate-500">مبلغ خود سند</span><b className="block mt-1" dir="ltr">{money(pane.detail.documentAmount)} ریال</b></div>
                <div className="border rounded p-3"><span className="text-xs text-slate-500">تاریخ / ساعت</span><b className="block mt-1">{faDigits(pane.detail.occurredAt.dateJalali ?? '—')} · {faDigits(pane.detail.occurredAt.time ?? '—')}</b></div>
                <div className="border rounded p-3"><span className="text-xs text-slate-500">فاکتور مرجع</span><b className="block mt-1">{pane.detail.invoice ? `فیش ${faDigits(pane.detail.invoice.receiptNo)}` : '—'}</b></div>
                <div className="border rounded p-3"><span className="text-xs text-slate-500">مشتری</span><b className="block mt-1">{pane.detail.customer.name}</b></div>
                <div className="border rounded p-3"><span className="text-xs text-slate-500">کاربر / شیفت</span><b className="block mt-1">{pane.detail.actor.name}{pane.detail.shift.name ? ` · ${pane.detail.shift.name}` : ''}</b></div>
                <div className="border rounded p-3 sm:col-span-2"><span className="text-xs text-slate-500">روش / مرجع</span><b className="block mt-1">{pane.detail.settlement.methodLabel}{pane.detail.settlement.reference ? ` · ${pane.detail.settlement.reference}` : ''}{!pane.detail.creditValidity && pane.detail.settlement.status ? ` · ${pane.detail.settlement.status}` : ''}</b></div>
                {pane.detail.creditValidity ? (
                  <>
                    <div className="border rounded p-3"><span className="text-xs text-slate-500">وضعیت اعتبار</span><b className={`block mt-1 ${pane.detail.creditValidity.status === 'EXPIRED' || pane.detail.creditValidity.status === 'CANCELED' ? 'text-rose-700' : pane.detail.creditValidity.status === 'SUSPENDED' ? 'text-amber-700' : 'text-emerald-700'}`}>{pane.detail.creditValidity.statusLabel}</b></div>
                    <div className="border rounded p-3"><span className="text-xs text-slate-500">مهلت اعتبار</span><b className="block mt-1">{pane.detail.creditValidity.expiresAtJalali ? `تا ${faDigits(pane.detail.creditValidity.expiresAtJalali)}` : 'بدون انقضا'}</b>{pane.detail.creditValidity.issuedDays != null && <span className="mt-1 block text-xs text-slate-500">قاعدهٔ صدور: {faDigits(pane.detail.creditValidity.issuedDays)} روز</span>}</div>
                    <div className="border rounded p-3"><span className="text-xs text-slate-500">ماندهٔ اعتبار</span><b className="block mt-1" dir="ltr">{money(pane.detail.creditValidity.remaining)} ریال</b></div>
                    <div className="border rounded p-3"><span className="text-xs text-slate-500">وضعیت سند در منبع</span><b className={`block mt-1 ${pane.detail.voided ? 'text-rose-700' : 'text-emerald-700'}`}>{pane.detail.voided ? 'باطل/برگشت‌خورده' : 'ثبت و فعال'}</b></div>
                  </>
                ) : (
                  <div className="border rounded p-3"><span className="text-xs text-slate-500">وضعیت سند</span><b className={`block mt-1 ${pane.detail.voided ? 'text-rose-700' : 'text-emerald-700'}`}>{pane.detail.voided ? 'باطل/برگشت‌خورده' : 'فعال در منبع'}</b></div>
                )}
              </div>
              {pane.detail.ref.kind === 'STORE_CREDIT' && pane.detail.ref.subKind && (
                <section className="rounded border border-violet-300 bg-violet-50 p-3 text-sm" aria-live="polite">
                  <b className="block text-violet-950">کد قابل‌مصرف اعتبار</b>
                  {isManager ? (
                    <div className="mt-2 flex gap-2 flex-wrap items-center">
                      {revealedCreditCode ? (
                        <code dir="ltr" className="rounded border border-violet-400 bg-white px-2 py-1 font-bold tracking-wider text-violet-950">{revealedCreditCode}</code>
                      ) : (
                        <button
                          type="button"
                          className={`${BUTTON} border border-violet-500 bg-white px-2.5 py-1.5 text-xs font-bold text-violet-950 hover:bg-violet-100`}
                          onClick={revealCreditCode}
                          disabled={revealBusy}
                        >
                          {revealBusy ? 'در حال دریافت امن…' : 'نمایش کد (فقط مدیر)'}
                        </button>
                      )}
                      <span className="text-xs leading-5 text-violet-900">این کد جزو اطلاعات عادی گزارش نیست و با چاپ یا خروجی گزارش منتقل نمی‌شود.</span>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs leading-6 text-violet-900">کد قابل‌مصرف در گزارش نمایش داده نمی‌شود؛ فقط مدیرِ واردشده می‌تواند آن را با درخواست جداگانه ببیند.</p>
                  )}
                  {revealError && <p className="mt-2 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-900" role="alert">{revealError}</p>}
                </section>
              )}
              <div className="border rounded overflow-hidden"><div className="bg-slate-100 px-3 py-2 font-bold text-sm">اقلام سند</div>{pane.detail.items.length ? <table className="w-full text-sm"><thead><tr className="border-b text-slate-600"><th className="p-2 text-right">کالا</th><th className="p-2 text-right">کد</th><th className="p-2 text-left">تعداد</th><th className="p-2 text-left">جمع</th></tr></thead><tbody>{pane.detail.items.map((item, index) => <tr key={`${item.code}-${index}`} className="border-b last:border-0"><td className="p-2">{item.name}</td><td className="p-2">{item.code}</td><td className="p-2 text-left" dir="ltr">{item.qty}</td><td className="p-2 text-left" dir="ltr">{money(item.lineTotal)}</td></tr>)}</tbody></table> : <p className="p-3 text-sm text-slate-600">برای این نوع سند، قلم کالایی ثبت نشده یا سند مستقیماً یک رویداد مالی است.</p>}</div>
              {pane.detail.note && <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm"><span className="font-bold">یادداشت:</span> {pane.detail.note}</div>}
            </div>
          )}
        </main>

        <footer className="px-4 sm:px-5 py-3 border-t bg-slate-50 flex justify-between gap-2 flex-wrap">
          <span className="text-[11px] text-slate-500">snapshot فیلتر: {scopeSnapshot.fromJalali || scopeSnapshot.from || 'بازهٔ گزارش'} تا {scopeSnapshot.toJalali || scopeSnapshot.to || '—'}</span>
          <button type="button" onClick={onClose} className={`${BUTTON} bg-slate-800 hover:bg-slate-900 text-white px-4 py-1.5 text-sm`}>بستن ریزبین</button>
        </footer>
      </section>
    </div>
  )
}
