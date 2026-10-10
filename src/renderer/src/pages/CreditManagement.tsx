import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { isPrintCancelledError } from '../lib/printErrors'
import ManagerGate from '../components/ManagerGate'
import Modal from '../components/Modal'
import ConfirmDialog from '../components/ConfirmDialog'
import JalaliDateInput from '../components/JalaliDateInput'
import type { Party } from '../components/PartyPicker'
import { IssueForm, OpForm, SettingsForm } from '../components/CreditForms'
import CreditDetailView from '../components/CreditDetailView'
import { exportTable } from '../lib/exportCsv'
import { PANEL_KEYS } from '@shared/panels'
import { usePanelLock } from '../hooks/usePanelLocks'
import { useManagerSession } from '../hooks/useManagerSession'
import { faDigits, money, toLatinDigits } from '@shared/jalali'
import {
  CREDIT_BATCH_HEADERS,
  CREDIT_BREAKDOWN_HEADERS,
  CREDIT_LIST_SCREEN_HEADERS,
  CREDIT_REMINDER_HEADERS,
  CREDIT_REMINDER_LOG_HEADERS,
  CREDIT_OP_CHANNEL,
  CREDIT_OP_TITLES,
  CREDIT_VIEW_TABS,
  CreditOp,
  EMPTY_BULK_DRAFT,
  EMPTY_ISSUE_DRAFT,
  TONE_CLASS,
  breakdownRow,
  buildBulkPayload,
  buildIssuePayload,
  buildOpPayload,
  creditAllSelected,
  creditBreakdownCellFormat,
  creditCellText,
  creditExport,
  creditListCellFormat,
  creditListScreenRow,
  creditPrintFlash,
  creditPrintOpRequest,
  creditSelectionResetSignature,
  creditEffectiveSkip,
  creditListPager,
  creditToggleAll,
  creditToggleRow,
  creditViewRequest,
  dashboardCards,
  prefillOpDraft,
  reminderCandidateRow,
  reminderFilter,
  reminderLogRow,
  type BulkDraft,
  type CreditExportKind,
  type CreditPrintOutcome,
  type CreditPrintTarget,
  type CreditView,
  type IssueDraft,
  type OpDraft
} from '@shared/creditUi'
import { pageRangeLabel } from '@shared/stocktakePaging'
import {
  CREDIT_STATUS_LABELS,
  CREDIT_SOURCE_LABELS,
  DEFAULT_CREDIT_SETTINGS,
  parseCreditSettings,
  type CreditSettings
} from '@shared/credit'
import type {
  CreditBatchRow,
  CreditDashboard,
  CreditDetail,
  CreditReminderCandidateRow,
  CreditReminderLogRow,
  SaleReportPage,
  StoreCreditSafeRow
} from '@shared/types'

/**
 * ===========================================================================
 * «مدیریت اعتبار خرید» — صفحه‌ی مرکزی (جلسه ۲۳، بازنویسی ساختاری در جلسه ۲۸).
 *
 * جلسه ۲۸ چه چیزی را عوض کرد و چرا:
 *   • فرم‌ها به `components/CreditForms.tsx` و انتخابگرها به
 *     `components/CreditPickers.tsx` رفتند و جزئیات به
 *     `components/CreditDetailView.tsx`. دلیلش سلیقه نیست: تا وقتی این صفحه
 *     ۲۲۵ خط JSXِ یک‌خطی بود، سه جلسه‌ی پیاپی فیلدهای موجودِ Backend «اضافه
 *     نشدند» چون جای نوشتن و بازبینی نبود.
 *   • گیت‌های `creditBulkIssue` و `creditVoid` که از جلسه ۲۱ تعریف و ثبت شده
 *     بودند و **هیچ‌جا استفاده نمی‌شدند**، حالا واقعاً روی مودال تولید گروهی و
 *     مودال عملیات مدیریتی نشسته‌اند (§۲۰).
 *   • خروجی اکسل برای *هر* گزارش، از همان ردیف‌سازهای `creditUi` (§۱۵).
 *   • فیلتر «فقط واجد شرایط» یادآوری + نمای لاگ یادآوری (§۱۴) — کانال
 *     `creditReminderLogs` تا دیروز ثبت شده بود و هیچ‌وقت صدا زده نمی‌شد.
 * ===========================================================================
 */

const emptySettings = parseCreditSettings(DEFAULT_CREDIT_SETTINGS)

function Cell({ children }: { children: any }) {
  return <td className="whitespace-nowrap">{children ?? '—'}</td>
}

/**
 * جلسه ۳۴ — قالب‌گرهای نمایشی که به لایه‌ی مشترک تزریق می‌شوند.
 *
 * تا دیروز *چاپِ* یک سلول دو کپیِ جدا داشت (`cellText` همین‌جا و `creditCell` در
 * `SalesReports.tsx`) — امروز بایت‌به‌بایت یکی بودند و فردا یکی‌شان `null` را
 * `—` می‌کرد و دیگری `۰`. حالا تنها نسخه‌اش `creditCellText` است و این شیء فقط
 * `money`/`faDigits` واقعی را به آن می‌دهد (لایه‌ی مشترک عمداً به `jalali.ts`
 * وابسته نیست).
 */
const CELL_FMT = { money, fa: faDigits }

function Gate({ children, panel = PANEL_KEYS.creditManagement, title = 'مدیریت اعتبار خرید', inline = false }: any) {
  return (
    <ManagerGate
      panel={panel}
      title={title}
      inline={inline}
      reason="این بخش روی بدهی اعتباری فروشگاه اثر دارد؛ با رمز مدیر یا رمز دوم پنل باز می‌شود."
    >
      {children}
    </ManagerGate>
  )
}

export default function CreditManagement() {
  const nav = useNavigate()
  const { isManager } = useManagerSession()
  const [view, setView] = useState<CreditView>('dashboard')
  const [dashboard, setDashboard] = useState<CreditDashboard | null>(null)
  const [rows, setRows] = useState<StoreCreditSafeRow[]>([])
  const [detail, setDetail] = useState<CreditDetail | null>(null)
  /** فقط نتیجهٔ reveal جداگانهٔ مدیر؛ هرگز در list/detail/export ذخیره نمی‌شود. */
  const [revealedCode, setRevealedCode] = useState<string | null>(null)
  const [reminders, setReminders] = useState<{ enabled: boolean; rows: CreditReminderCandidateRow[] }>({ enabled: true, rows: [] })
  const [reminderLogs, setReminderLogs] = useState<CreditReminderLogRow[]>([])
  const [onlyEligible, setOnlyEligible] = useState(true)
  const [batches, setBatches] = useState<CreditBatchRow[]>([])
  const [batchPage, setBatchPage] = useState<SaleReportPage | null>(null)
  const [batchWarnings, setBatchWarnings] = useState<string[]>([])
  /** ممیزی A119-01 (AUDIT-D55) — skip دسته‌ها به امضای بازه گره خورده (مثل listSkipState، D32)؛ با تغییر «از/تا» همان رندر صفر. */
  const [batchSkipState, setBatchSkipState] = useState<{ signature: string; skip: number }>({ signature: '', skip: 0 })
  /** ممیزی A101-01 (AUDIT-D32) — صفحه‌بندی فهرست اعتبار؛ skip به امضای فیلتر گره خورده. */
  const [listSkipState, setListSkipState] = useState<{ signature: string; skip: number }>({ signature: '', skip: 0 })
  const [listPage, setListPage] = useState<SaleReportPage | null>(null)
  const [settings, setSettings] = useState<CreditSettings>(emptySettings)
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [printing, setPrinting] = useState(false)
  const printingRef = useRef(false)
  /**
   * نشست ۱۵۴ (S151-b) — گیت main ذخیره‌ی تنظیمات اعتبار: رمز همراه همان درخواست
   * فرستاده می‌شود و سرور می‌سنجد. تا وضعیت قفل خوانده نشده، رمز لازم فرض می‌شود (fail-closed).
   */
  const { lockEnabled: creditSettingsLock, loaded: creditSettingsLockLoaded } = usePanelLock(PANEL_KEYS.creditSettings)
  const needCreditSettingsPw = !creditSettingsLockLoaded || creditSettingsLock
  const [creditSettingsPw, setCreditSettingsPw] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [issueOpen, setIssueOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  /** نشست ۱۴۳ · بند ۴-۲۹ — رمز مدیر صدور دستی/گروهی؛ main خودش می‌سنجد. */
  const [issueManagerPw, setIssueManagerPw] = useState('')
  const [opDraft, setOpDraft] = useState<OpDraft | null>(null)
  const opDraftRef = useRef<OpDraft | null>(null)
  opDraftRef.current = opDraft
  const detailRef = useRef<CreditDetail | null>(null)
  detailRef.current = detail
  const [opBusy, setOpBusy] = useState(false)
  const opBusyRef = useRef(false)
  const [issue, setIssue] = useState<IssueDraft>(EMPTY_ISSUE_DRAFT)
  const [bulk, setBulk] = useState<BulkDraft>(EMPTY_BULK_DRAFT)
  const [party, setParty] = useState<Party | null>(null)
  const [opParty, setOpParty] = useState<Party | null>(null)
  const [confirm, setConfirm] = useState<(() => void) | null>(null)
  /* ---------------- جلسه ۲۴ · چاپ/PDF ----------------
     انتخاب چندتایی فهرست + پیش‌نمایش HTML سند. هیچ منطقی اینجا ساخته نمی‌شود؛
     چهار کانال آماده‌ی جلسه ۲۱ فقط مصرف می‌شوند. */
  const [selected, setSelected] = useState<number[]>([])
  const [previewId, setPreviewId] = useState<number | null>(null)
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)

  const flash = (text: string) => {
    setMsg(text)
    setErr(null)
    window.setTimeout(() => setMsg(null), 6000)
  }

  /**
   * جلسه ۳۳ — «کدام نما از کدام کانال و با چه بار داده‌ای» تصمیمِ بخش ۱۳
   * `creditUi.ts` است (`creditViewRequest`)، نه پنج بلوک `if` داخل JSX.
   * سه چیزی که با این کار تست‌پذیر شد: بازه‌ی خالی هیچ کلیدی نمی‌سازد (وگرنه
   * پیش‌فرض «امروز»ِ `creditList` خراب می‌شود)، `take` یک عدد مشترک است (این
   * صفحه ۵۰۰ می‌فرستاد و تب گزارشات ۱۰۰۰)، و §۱۴ (`onlyDue`) یک کلید صریح است.
   */
  const listSignature = creditSelectionResetSignature({ fromJalali: from, toJalali: to, search, source, status })
  const listSkip = creditEffectiveSkip(listSkipState, listSignature)
  const batchSignature = creditSelectionResetSignature({ fromJalali: from, toJalali: to })
  const batchSkip = creditEffectiveSkip(batchSkipState, batchSignature)
  const loadReq = useRef(0)
  const load = useCallback(async () => {
    const req = creditViewRequest(view, {
      fromJalali: from,
      toJalali: to,
      search,
      source,
      status,
      onlyDue: onlyEligible,
      skip: view === 'batches' ? batchSkip : view === 'list' ? listSkip : undefined
    })
    if (!req) return
    const seq = ++loadReq.current
    setBusy(true)
    try {
      const data = await call<any>(CH[req.channel as keyof typeof CH], req.payload ?? undefined)
      if (seq !== loadReq.current) return
      if (view === 'dashboard') setDashboard((data as CreditDashboard) ?? null)
      else if (view === 'list' || view === 'detail') {
        setRows((data as StoreCreditSafeRow[]) ?? [])
        if (view === 'list') setListPage((data as any)?.page ?? null)
      }
      /* §۱۴ — پاکت `{ enabled, rows }` عمداً باز نمی‌شود: خودِ `enabled` هم دیده می‌شود. */
      else if (view === 'reminders') setReminders(data ?? { enabled: true, rows: [] })
      /* §۱۴ — این کانال از جلسه ۲۱ ثبت شده بود و تا جلسه ۲۸ صدا زده نمی‌شد. */
      else if (view === 'reminderLogs') setReminderLogs((data as CreditReminderLogRow[]) ?? [])
      else if (view === 'batches') {
        const batchRows = (data as CreditBatchRow[]) ?? []
        setBatches(batchRows)
        setBatchPage((data as any)?.page ?? null)
        setBatchWarnings((data as any)?.warnings ?? [])
      }
      else if (view === 'settings') setSettings((data as CreditSettings) ?? emptySettings)
      setErr(null)
    } catch (e: any) {
      if (seq === loadReq.current) setErr(e.message)
    } finally {
      if (seq === loadReq.current) setBusy(false)
    }
  }, [view, from, to, search, source, status, onlyEligible, batchSkip, listSkip])

  useEffect(() => {
    void load()
  }, [load])
  /**
   * جلسه ۳۴ — انتخاب با هر تغییرِ فیلتر پاک می‌شود، ولی *فهرست* آن فیلترها
   * دیگر یک آرایه‌ی دستی در همین خط نیست: `CREDIT_SELECTION_RESET_KEYS` در بخش
   * ۱۴ `creditUi.ts` است و سوییت می‌سنجد که هیچ کلیدِ بار داده‌ی `creditList` از
   * آن جا نمانده باشد. چرا مهم است: با فیلترِ عوض‌شده و انتخابِ قبلی، کاربر
   * کاغذِ اعتبارهای دیگری را چاپ می‌کند — با شمارنده و AuditLog واقعی.
   */
  const selectionKey = creditSelectionResetSignature({
    fromJalali: from,
    toJalali: to,
    search,
    source,
    status
  })
  useEffect(() => {
    setSelected([])
  }, [selectionKey])

  const openDetail = async (id: number) => {
    try {
      setRevealedCode(null)
      setDetail(await call<CreditDetail>(CH.creditDetail, { id }))
      setView('detail')
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const openDetailPage = async (kind: 'timeline' | 'reminders', skip: number) => {
    if (!detail) return
    const timelineSkip = kind === 'timeline' ? skip : detail.timelinePage?.skip ?? 0
    const reminderSkip = kind === 'reminders' ? skip : detail.remindersPage?.skip ?? 0
    try {
      setDetail(await call<CreditDetail>(CH.creditDetail, { id: detail.credit.id, timelineSkip, reminderSkip }))
    } catch (e: any) {
      setErr(e.message)
    }
  }

  useEffect(() => {
    if (!isManager) setRevealedCode(null)
  }, [isManager])

  const revealDetailCode = async () => {
    if (!detail || !isManager) return
    try {
      const reveal = await call<{ creditId: number; code: string }>(CH.creditManagerCodeReveal, {
        sourceId: detail.credit.id,
        sourceSubKind: 'STORE_CREDIT'
      })
      setRevealedCode(reveal.code)
      setErr(null)
    } catch (e: any) {
      setRevealedCode(null)
      setErr(e.message)
    }
  }

  const submitIssue = async (isBulk = false) => {
    const result = isBulk ? buildBulkPayload(bulk, settings) : buildIssuePayload(issue, settings)
    if (!result.ok || !result.payload) return setErr(result.error ?? 'فرم کامل نیست.')
    if (result.warnings.length) flash(result.warnings.join('\n'))
    try {
      const res = await call<any>(isBulk ? CH.creditBulkIssue : CH.creditIssue, {
        ...result.payload,
        managerPassword: toLatinDigits(issueManagerPw).trim()
      })
      setIssueManagerPw('')
      setIssueOpen(false)
      setBulkOpen(false)
      /* §۵/§۶ — «تعداد واقعیِ ساخته‌شده» و رشد طول کد باید دیده شوند، نه عدد خوش‌بینانه. */
      flash(
        isBulk
          ? `تولید گروهی: ${faDigits(res?.created ?? 0)} اعتبار از ${faDigits(res?.requested ?? 0)} درخواستی ساخته شد` +
              (res?.lengthGrown ? ` · طول کد به ${faDigits(res?.codeLength ?? 0)} افزایش یافت` : '') +
              (res?.warnings?.length ? `\n${res.warnings.join('\n')}` : '')
          : 'اعتبار جدید صادر شد؛ کد فقط از مسیر نمایش جداگانهٔ مدیر قابل مشاهده است.'
      )
      if (isBulk) {
        setBulk(EMPTY_BULK_DRAFT)
        setView('batches')
      } else {
        setIssue(EMPTY_ISSUE_DRAFT)
        setView('list')
      }
      setParty(null)
      void load()
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const submitOp = async () => {
    if (opBusyRef.current) return
    const draft = opDraftRef.current
    const currentDetail = detailRef.current
    if (!draft || !currentDetail) return
    const result = buildOpPayload(draft, currentDetail.credit)
    if (!result.ok || !result.payload) return setErr(result.error ?? 'فرم کامل نیست.')
    opBusyRef.current = true
    setOpBusy(true)
    try {
      const res = await call<any>(CH[CREDIT_OP_CHANNEL[draft.op] as keyof typeof CH], result.payload)
      setOpDraft(null)
      setOpParty(null)
      setConfirm(null)
      /* هشدارهای سرویس تا جلسه ۲۷ دیده نمی‌شدند. */
      flash('عملیات انجام شد و در تاریخچه ثبت شد.' + (res?.warnings?.length ? `\n${res.warnings.join('\n')}` : ''))
      await openDetail(currentDetail.credit.id)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      opBusyRef.current = false
      setOpBusy(false)
    }
  }

  const saveSettings = async () => {
    try {
      await call(CH.creditSettingsSet, { settings, panelPassword: creditSettingsPw })
      flash('تنظیمات اعتبار ذخیره شد.')
      void load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setCreditSettingsPw('') // بند ۴-۴۰ — رمز هر عملیات حساس دوباره پرسیده شود
    }
  }

  /* --------------------------------------------------------------------------
   * چاپ و PDF (اولویت ۲ جلسه ۲۴)
   * `markPrinted` عمداً true می‌ماند: شمارنده‌ی چاپ بالا می‌رود و از نسخه‌ی دوم
   * به بعد خودِ قالب بک‌اند برچسب «نسخه‌ی مجدد» می‌زند (تست ۲۳ جلسه ۲۱).
   * ------------------------------------------------------------------------ */
  /**
   * جلسه ۳۴ — بار داده‌ی هر سه عملیات از `creditPrintOpRequest` (بخش ۱۴) می‌آید و
   * متن نتیجه از `creditPrintFlash`. تا دیروز کلیدِ روشن‌بودنِ شمارنده‌ی چاپ
   * (قاعده‌ی ضدتقلبِ §۲۴)، `ask`/`reveal`، و متنِ سقف‌خوردگی در پنج نقطه‌ی JSX
   * دستی نوشته می‌شدند و بندهای ۱۷/۲۲/۲۳ هارنس ۲۵ فقط رشته‌هایشان را می‌دیدند.
   */
  const printOne = async (id: number, copies = 1) => {
    if (!isManager) return setErr('چاپ کد اعتبار فقط با نشست فعال مدیر مجاز است.')
    if (printingRef.current) return
    const req = creditPrintOpRequest('print', { id, copies })
    if (!req) return
    printingRef.current = true
    setPrinting(true)
    try {
      const res = await call<CreditPrintOutcome>(CH[req.channel as keyof typeof CH], req.payload)
      flash(creditPrintFlash('print', { ...(res ?? {}), copies: res?.copies ?? copies }, faDigits))
      if (detail?.credit.id === id) await openDetail(id)
      else void load()
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
  }

  const printBatch = async (target: CreditPrintTarget) => {
    if (!isManager) return setErr('چاپ کد اعتبار فقط با نشست فعال مدیر مجاز است.')
    if (printingRef.current) return
    const req = creditPrintOpRequest('batch', target)
    if (!req) return
    printingRef.current = true
    setPrinting(true)
    try {
      const res = await call<CreditPrintOutcome>(CH[req.channel as keyof typeof CH], req.payload)
      flash(creditPrintFlash('batch', res, faDigits))
      void load()
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
  }

  const savePdf = async (target: CreditPrintTarget) => {
    if (!isManager) return setErr('PDF حاوی کد اعتبار فقط با نشست فعال مدیر مجاز است.')
    if (printingRef.current) return
    const req = creditPrintOpRequest('pdf', target)
    if (!req) return
    printingRef.current = true
    setPrinting(true)
    try {
      const res = await call<CreditPrintOutcome>(CH[req.channel as keyof typeof CH], req.payload)
      flash(creditPrintFlash('pdf', res, faDigits))
      const id = Math.round(Number(target.id) || 0)
      if (id && detail?.credit.id === id) await openDetail(id)
      else void load()
    } catch (e: any) {
      if (!isPrintCancelledError(e)) setErr(e.message)
    } finally {
      printingRef.current = false
      setPrinting(false)
    }
  }

  const openPreview = async (id: number) => {
    if (!isManager) return setErr('پیش‌نمایش حاوی کد اعتبار فقط با نشست فعال مدیر مجاز است.')
    try {
      const html = await call<string>(CH.creditPreviewHtml, { id })
      setPreviewId(id)
      setPreviewHtml(html || '')
    } catch (e: any) {
      setErr(e.message)
    }
  }
  const closePreview = () => {
    setPreviewId(null)
    setPreviewHtml(null)
  }
  /* جلسه ۳۴ — تصمیمِ انتخاب (تیک ردیف · تیک سرستون) در بخش ۱۴ `creditUi.ts` است. */
  const toggleRow = (id: number) => setSelected((s) => creditToggleRow(s, id))
  const allSelected = creditAllSelected(selected, rows)
  const toggleAll = () => setSelected(creditToggleAll(selected, rows))

  /**
   * §۱۵ و پرسش Q3 ممیزی — «خروجی اکسل هر گزارش».
   * انتخاب سرستون/ردیف‌ساز هر گزارش تصمیمِ `creditExport` است (تست‌شده)، پس
   * اینجا هیچ‌وقت سرستون یک گزارش با ردیف گزارش دیگر جفت نمی‌شود.
   */
  const doExport = async (kind: CreditExportKind, data: any) => {
    const sheet = creditExport(kind, data)
    if (!sheet) return flash('این گزارش خالی است، پس فایلی ساخته نشد.')
    try {
      const res = await exportTable({
        fileName: sheet.fileName,
        sheetName: sheet.sheetName,
        headers: sheet.headers,
        rows: sheet.rows,
        totals: sheet.totals,
        title: from || to ? `بازه: ${faDigits(from || '—')} تا ${faDigits(to || '—')}` : undefined
      })
      flash(res.canceled ? 'خروجی لغو شد.' : `فایل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const cards = dashboardCards(dashboard)
  const reminderView = useMemo(() => reminderFilter(reminders.rows, onlyEligible), [reminders.rows, onlyEligible])

  return (
    <Gate>
      <div className="page">
        <div className="bg-white rounded shadow p-2 flex items-center gap-1 flex-wrap">
          <h1 className="text-lg font-bold ml-2">مدیریت اعتبار خرید</h1>
          {CREDIT_VIEW_TABS.map((t) => (
            <button key={t.view} className={`btn ${view === t.view ? 'btn-primary' : ''}`} onClick={() => setView(t.view)}>
              {t.label}
            </button>
          ))}
          <button className="btn btn-primary mr-auto" onClick={() => setIssueOpen(true)}>
            + صدور اعتبار
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>

        <div className="flex gap-2 flex-wrap items-end bg-white rounded shadow p-2">
          <label className="flex-1 min-w-48">
            جست‌وجو
            <input
              className="inp"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="جست‌وجوی کد در فهرست غیرفعال است؛ کد فقط در مسیر مصرف بررسی می‌شود"
              disabled
            />
          </label>
          <label>
            از تاریخ
            <JalaliDateInput value={from} onChange={setFrom} />
          </label>
          <label>
            تا تاریخ
            <JalaliDateInput value={to} onChange={setTo} />
          </label>
          <label>
            نوع
            <select className="inp" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">همه</option>
              {Object.entries(CREDIT_SOURCE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            وضعیت
            <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">همه</option>
              {Object.entries(CREDIT_STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" onClick={() => void load()} disabled={busy}>
            {busy ? 'در حال خواندن…' : 'به‌روزرسانی'}
          </button>
        </div>

        {msg && <div className="bg-emerald-50 border border-emerald-300 rounded p-2 whitespace-pre-line">{msg}</div>}
        {err && <div className="bg-rose-50 border border-rose-300 rounded p-2 whitespace-pre-line">{err}</div>}

        {/* ---------------- داشبورد + گزارش مالی تفکیکی (§۱۵) ---------------- */}
        {view === 'dashboard' && (
          <div className="space-y-2">
            <div className="bg-white rounded shadow p-2 flex gap-2 flex-wrap items-center">
              <b>گزارش مالی</b>
              <button className="btn py-1" onClick={() => void doExport('dashboard', dashboard)}>
                خروجی اکسل داشبورد
              </button>
              <button className="btn py-1" onClick={() => void doExport('byStatus', dashboard)}>
                خروجی تفکیک وضعیت
              </button>
              <button className="btn py-1" onClick={() => void doExport('bySource', dashboard)}>
                خروجی تفکیک نوع
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {cards.map((c) => (
                /* جلسه ۳۴ — کلاسِ رنگ از `TONE_CLASS` می‌آید (تب گزارشات از دیروز همین را
                   می‌زد و این صفحه یک زنجیره‌ی سه‌تایی `?:` دستی داشت). */
                <div key={c.key} className={`rounded border p-3 ${TONE_CLASS[c.tone] ?? TONE_CLASS.plain}`}>
                  <div className="font-bold">{c.title}</div>
                  <div className="text-xl">{creditCellText(c.value, c.kind === 'money' ? 'money' : 'count', CELL_FMT)}</div>
                  <div className="kbd">{c.hint}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {([
                { key: 'byStatus', title: 'تفکیک بر اساس وضعیت', rows: dashboard?.byStatus ?? [] },
                { key: 'bySource', title: 'تفکیک بر اساس نوع اعتبار', rows: dashboard?.bySource ?? [] }
              ] as const).map((b) => (
                <div key={b.key} className="tbl-card overflow-auto">
                  <h3 className="font-bold p-2 border-b">{b.title}</h3>
                  <table className="tbl">
                    <thead>
                      <tr>
                        {CREDIT_BREAKDOWN_HEADERS.map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {b.rows.map((r: any, i: number) => (
                        <tr key={i}>
                          {breakdownRow(r).map((cell, j) => (
                            <td key={j}>{creditCellText(cell, creditBreakdownCellFormat(j), CELL_FMT)}</td>
                          ))}
                        </tr>
                      ))}
                      {!b.rows.length && (
                        <tr>
                          <Cell>در این بازه رکوردی نیست.</Cell>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ---------------- فهرست اعتبارها (§۱۶) ---------------- */}
        {view === 'list' && (
          <div className="tbl-card overflow-auto">
            <div className="p-2 flex gap-2 border-b items-center flex-wrap">
              <button className="btn" onClick={() => void doExport('list', rows)}>
                خروجی اکسل
              </button>
              <button className="btn" disabled={!selected.length || printing || !isManager} title={isManager ? undefined : 'فقط مدیر'} onClick={() => void printBatch({ ids: selected })}>
                {printing ? 'در حال چاپ…' : 'چاپ گروهی انتخاب‌شده‌ها'}
              </button>
              <button className="btn" disabled={!selected.length || printing || !isManager} title={isManager ? undefined : 'فقط مدیر'} onClick={() => void savePdf({ ids: selected })}>
                {printing ? 'در حال آماده‌سازی…' : 'PDF انتخاب‌شده‌ها'}
              </button>
              {!!selected.length && (
                <button className="btn" onClick={() => setSelected([])}>
                  پاک‌کردن انتخاب
                </button>
              )}
              <span className="kbd">
                {faDigits(rows.length)} ردیف{selected.length ? ` · ${faDigits(selected.length)} انتخاب‌شده` : ''}
              </span>
            </div>
            {(() => {
              const pager = creditListPager(listPage, rows.length, faDigits)
              if (!pager.visible) return null
              return (
                <div className="p-2 flex gap-2 items-center flex-wrap border-b">
                  {pager.warning && <span className="kbd bg-red-50 border border-red-400 text-red-700">⚠ {pager.warning}</span>}
                  <button className="btn py-1" disabled={busy || pager.prevSkip == null} onClick={() => setListSkipState({ signature: listSignature, skip: pager.prevSkip ?? 0 })}>
                    صفحه‌ی قبل
                  </button>
                  <span className="kbd">
                    {faDigits(pager.from)} تا {faDigits(pager.to)} از {faDigits(pager.total)}
                  </span>
                  <button className="btn py-1" disabled={busy || pager.nextSkip == null} onClick={() => setListSkipState({ signature: listSignature, skip: pager.nextSkip ?? 0 })}>
                    صفحه‌ی بعد
                  </button>
                </div>
              )
            })()}
            <table className="tbl">
              <thead className="sticky top-14 bg-white z-10">
                <tr>
                  <th className="w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} title="انتخاب همه" />
                  </th>
                  {CREDIT_LIST_SCREEN_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={selected.includes(r.id) ? 'bg-sky-50' : ''} onDoubleClick={() => void openDetail(r.id)}>
                    <Cell>
                      <input
                        type="checkbox"
                        checked={selected.includes(r.id)}
                        onChange={() => toggleRow(r.id)}
                        onDoubleClick={(e) => e.stopPropagation()}
                      />
                    </Cell>
                    {creditListScreenRow(r).map((cell, i) => (
                      <Cell key={i}>{creditCellText(cell, creditListCellFormat(i), CELL_FMT)}</Cell>
                    ))}
                    <Cell>
                      <div className="flex gap-2">
                        <button className="text-brand font-bold" onClick={() => void openDetail(r.id)}>
                          جزئیات
                        </button>
                        <button className="text-brand" title={isManager ? 'چاپ سند' : 'چاپ کد فقط برای مدیر'} onClick={() => void printOne(r.id)} disabled={printing || !isManager}>
                          {printing ? 'در حال چاپ…' : 'چاپ'}
                        </button>
                        <button className="text-brand" title={isManager ? 'پیش‌نمایش و PDF' : 'پیش‌نمایش کد فقط برای مدیر'} onClick={() => void openPreview(r.id)} disabled={!isManager}>
                          پیش‌نمایش
                        </button>
                      </div>
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---------------- جزئیات (§۱۶ · §۱۲ · §۱۸ · §۱۹) ---------------- */}
        {view === 'detail' && detail && (
          <CreditDetailView
            detail={detail}
            onOp={(op: CreditOp) => {
              /* پیش‌پُرکردن از مقدار فعلی، تا عملیات «جایگزین‌کننده» چیزی را پاک نکند. */
              setOpDraft(prefillOpDraft(op, detail.credit))
              setOpParty(
                detail.credit.customerId
                  ? { id: detail.credit.customerId, code: '', name: detail.credit.customerName ?? '', phone: detail.credit.holderPhone ?? '' }
                  : null
              )
            }}
            onBack={() => {
              setRevealedCode(null)
              setView('list')
            }}
            onPrint={(copies: number) => void printOne(detail.credit.id, copies)}
            printing={printing}
            onPreview={() => void openPreview(detail.credit.id)}
            onPdf={() => void savePdf({ id: detail.credit.id })}
            onPage={(kind, skip) => void openDetailPage(kind, skip)}
            canRevealCode={isManager}
            managerCode={revealedCode}
            onRevealCode={() => void revealDetailCode()}
            onExport={(kind: CreditExportKind) =>
              void doExport(
                kind,
                kind === 'redemptions' ? detail.redemptions : kind === 'timeline' ? detail.timeline : detail.reminders
              )
            }
          />
        )}

        {/* ---------------- یادآوری (§۱۴) ---------------- */}
        {view === 'reminders' && (
          <div className="tbl-card overflow-auto">
            <div className="p-2 flex gap-2 border-b items-center flex-wrap">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" checked={onlyEligible} onChange={(e) => setOnlyEligible(e.target.checked)} />
                <span>فقط واجد شرایط یادآوری</span>
              </label>
              <button className="btn py-1" onClick={() => void doExport('reminders', reminderView.rows)}>
                خروجی اکسل
              </button>
              <span className="kbd">
                {faDigits(reminderView.rows.length)} ردیف نمایش‌داده‌شده · {faDigits(reminderView.eligible)} واجد شرایط از{' '}
                {faDigits(reminderView.total)}
              </span>
              {!reminders.enabled && (
                <span className="kbd bg-amber-100 border border-amber-300 px-2 inline-flex items-center gap-2">
                  یادآوری در تنظیمات خاموش است، پس هیچ ردیفی واجد شرایط نمی‌شود.
                  {/* یک تنظیم مشترک است؛ کلیدش در پنل پیامک است. اینجا فقط راهش را نشان می‌دهیم. */}
                  <button className="btn py-0.5" onClick={() => nav('/sms-panel')}>
                    تنظیمات پیامک
                  </button>
                </span>
              )}
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  {CREDIT_REMINDER_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {reminderView.rows.map((c: any) => (
                  <tr key={c.credit.id} className={c.should ? '' : 'opacity-70'}>
                    {reminderCandidateRow(c).map((cell, j) => (
                      <td key={j}>{typeof cell === 'number' ? faDigits(cell) : cell === '' ? '—' : cell}</td>
                    ))}
                    <Cell>
                      <div className="flex gap-2">
                        <button className="text-brand font-bold" onClick={() => void openDetail(c.credit.id)}>
                          جزئیات
                        </button>
                        <button
                          className="btn py-0.5"
                          disabled={!c.should}
                          title={c.should ? 'متن پیام ساخته و در لاگ ثبت می‌شود' : c.reason}
                          onClick={async () => {
                            try {
                              await call(CH.creditReminderQueue, { id: c.credit.id })
                              flash('یادآوری آماده و در لاگ ثبت شد. متنش را در نمای «لاگ یادآوری» ببینید.')
                              void load()
                            } catch (e: any) {
                              setErr(e.message)
                            }
                          }}
                        >
                          آماده‌سازی
                        </button>
                      </div>
                    </Cell>
                  </tr>
                ))}
                {!reminderView.rows.length && (
                  <tr>
                    <Cell>هیچ اعتباری در این فیلتر نیست.</Cell>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ---------------- لاگ یادآوری (§۱۴) ---------------- */}
        {view === 'reminderLogs' && (
          <div className="tbl-card overflow-auto">
            <div className="p-2 flex gap-2 border-b items-center flex-wrap">
              <button className="btn py-1" onClick={() => void doExport('reminderLogs', reminderLogs)}>
                خروجی اکسل
              </button>
              <span className="kbd">{faDigits(reminderLogs.length)} ردیف · هیچ‌کدام «ارسال واقعی» نیست؛ متن آماده و ثبت‌شده است.</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  {CREDIT_REMINDER_LOG_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reminderLogs.map((r) => (
                  <tr key={r.id}>
                    {reminderLogRow(r).map((cell, j) => (
                      <td key={j} className="whitespace-pre-wrap">
                        {cell === '' || cell == null ? '—' : typeof cell === 'number' ? faDigits(cell) : cell}
                      </td>
                    ))}
                  </tr>
                ))}
                {!reminderLogs.length && (
                  <tr>
                    <Cell>در این بازه یادآوری‌ای آماده نشده است.</Cell>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ---------------- دسته‌های تولید گروهی (§۵) ---------------- */}
        {view === 'batches' && (
          <div className="tbl-card overflow-auto">
            <div className="p-2 flex gap-2 items-center flex-wrap border-b">
              <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>
                + تولید گروهی
              </button>
              <button className="btn" onClick={() => void doExport('batches', batches)}>
                خروجی اکسل
              </button>
              <span className="kbd">
                {pageRangeLabel(batchPage, batches.length, 'دسته')}
              </span>
              {batchWarnings.map((warning) => (
                <span key={warning} className="kbd bg-amber-100 border border-amber-300">
                  {warning}
                </span>
              ))}
              <div className="flex gap-1 mr-auto">
                <button
                  className="btn py-1"
                  disabled={!batchPage?.skip}
                  onClick={() => setBatchSkipState({ signature: batchSignature, skip: Math.max(0, (batchPage?.skip ?? batchSkip) - (batchPage?.take ?? 200)) })}
                >
                  صفحه‌ی قبل
                </button>
                <button
                  className="btn py-1"
                  disabled={!batchPage?.truncated}
                  onClick={() => setBatchSkipState({ signature: batchSignature, skip: (batchPage?.skip ?? batchSkip) + (batchPage?.take ?? 200) })}
                >
                  صفحه‌ی بعد
                </button>
              </div>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  {CREDIT_BATCH_HEADERS.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                  <th>چاپ</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <Cell>{faDigits(b.id)}</Cell>
                    <Cell>{b.title}</Cell>
                    <Cell>{faDigits(b.count)}</Cell>
                    <Cell>{money(b.amountEach)}</Cell>
                    <Cell>{money(b.totalAmount)}</Cell>
                    <Cell>{faDigits(b.createdAtJalali)}</Cell>
                    <Cell>{faDigits(b.createdAtTime)}</Cell>
                    <Cell>{CREDIT_SOURCE_LABELS[b.source] || b.source}</Cell>
                    <Cell>{b.lengthGrown ? 'بله' : 'خیر'}</Cell>
                    <Cell>{b.note}</Cell>
                    <Cell>
                      <div className="flex gap-2">
                        <button
                          className="text-brand font-bold"
                          title="یک سند PDF/چاپی چندصفحه‌ای برای کل دسته"
                          onClick={() => void printBatch({ batchId: b.id })}
                          disabled={printing || !isManager}
                        >
                          {printing ? 'در حال چاپ…' : 'چاپ دسته‌ای'}
                        </button>
                        <button className="text-brand" onClick={() => void savePdf({ batchId: b.id })} disabled={printing || !isManager} title={isManager ? undefined : 'فقط مدیر'}>
                          {printing ? 'در حال آماده‌سازی…' : 'PDF دسته'}
                        </button>
                      </div>
                    </Cell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {view === 'settings' && (
          <Gate panel={PANEL_KEYS.creditSettings} title="تنظیمات اعتبار خرید">
            <SettingsForm
              settings={settings}
              setSettings={setSettings}
              onSave={saveSettings}
              busy={busy}
              password={needCreditSettingsPw ? creditSettingsPw : undefined}
              setPassword={setCreditSettingsPw}
            />
          </Gate>
        )}

        <Modal
          open={issueOpen}
          onClose={() => {
            setIssueOpen(false)
            setIssueManagerPw('')
          }}
          title="صدور اعتبار مدیریتی"
        >
          <label className="flex items-center gap-2 mb-2 text-sm">
            رمز مدیر (صدور اعتبار بدون فاکتور همیشه رمز مدیر می‌خواهد):
            <input
              type="password"
              className="inp w-40"
              dir="ltr"
              value={issueManagerPw}
              onChange={(e) => setIssueManagerPw(e.target.value)}
            />
          </label>
          <IssueForm
            value={issue}
            setValue={setIssue as any}
            party={party}
            setParty={setParty}
            settings={settings}
            onSubmit={() => void submitIssue(false)}
          />
        </Modal>

        {/* §۲۰ — تولید گروهی گیت رمز *اختصاصی خودش* را دارد، نه گیت صفحه. */}
        <Modal
          open={bulkOpen}
          onClose={() => {
            setBulkOpen(false)
            setIssueManagerPw('')
          }}
          title="تولید گروهی اعتبار"
        >
          <Gate panel={PANEL_KEYS.creditBulkIssue} title="تولید گروهی اعتبار" inline>
            <label className="flex items-center gap-2 mb-2 text-sm">
              رمز مدیر (صدور اعتبار بدون فاکتور همیشه رمز مدیر می‌خواهد):
              <input
                type="password"
                className="inp w-40"
                dir="ltr"
                value={issueManagerPw}
                onChange={(e) => setIssueManagerPw(e.target.value)}
              />
            </label>
            <IssueForm
              value={bulk as any}
              setValue={setBulk as any}
              party={party}
              setParty={setParty}
              settings={settings}
              bulk
              onSubmit={() => void submitIssue(true)}
            />
          </Gate>
        </Modal>

        {/* §۲۰ — عملیات مدیریتی (ابطال/تعلیق/حذف/تغییرها) گیت رمز اختصاصی خودش را دارد. */}
        <Modal
          open={!!opDraft}
          onClose={() => {
            if (!opBusy) setOpDraft(null)
          }}
          title={opDraft ? CREDIT_OP_TITLES[opDraft.op] : 'عملیات'}
          footer={
            <>
              <button className="btn" onClick={() => setOpDraft(null)} disabled={opBusy}>
                انصراف
              </button>
              <button className="btn btn-primary" onClick={() => setConfirm(() => () => void submitOp())} disabled={opBusy}>
                {opBusy ? 'در حال ثبت…' : 'ثبت عملیات'}
              </button>
            </>
          }
        >
          <Gate panel={PANEL_KEYS.creditVoid} title="عملیات مدیریتی اعتبار" inline>
            <OpForm value={opDraft} setValue={setOpDraft as any} credit={detail?.credit} party={opParty} setParty={setOpParty} />
          </Gate>
        </Modal>

        {/* جلسه ۲۴ — پیش‌نمایش سند اعتبار (HTML واقعیِ بک‌اند در iframe) */}
        <Modal
          open={previewHtml != null}
          onClose={closePreview}
          title="پیش‌نمایش سند اعتبار"
          width="max-w-3xl"
          footer={
            <>
              <button className="btn" onClick={closePreview}>
                بستن
              </button>
              <button className="btn" onClick={() => previewId && void printOne(previewId)} disabled={printing || !isManager}>
                {printing ? 'در حال چاپ…' : 'چاپ سند'}
              </button>
              <button className="btn btn-primary" onClick={() => previewId && void savePdf({ id: previewId })} disabled={printing || !isManager}>
                {printing ? 'در حال آماده‌سازی…' : 'ذخیره‌ی PDF'}
              </button>
            </>
          }
        >
          <div className="bg-slate-50 rounded p-2 max-h-[65vh] overflow-auto">
            <iframe title="credit-preview" className="w-full min-h-[420px] bg-white" srcDoc={previewHtml ?? ''} />
          </div>
          <div className="kbd">
            اندازه‌ی کاغذ از تنظیمات اعتبار خوانده می‌شود. اگر این سند قبلاً چاپ شده باشد، نسخه‌ی بعدی برچسب «نسخه‌ی مجدد» می‌گیرد.
          </div>
        </Modal>

        <ConfirmDialog
          open={!!confirm}
          message="این تغییر در سوابق اعتبار و Audit Log ثبت می‌شود. ادامه می‌دهید؟"
          busy={opBusy}
          onCancel={() => {
            if (!opBusy) setConfirm(null)
          }}
          onConfirm={() => {
            const fn = confirm
            setConfirm(null)
            fn?.()
          }}
        />
      </div>
    </Gate>
  )
}
