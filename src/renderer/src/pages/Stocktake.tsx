import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import JalaliDateInput from '../components/JalaliDateInput'
import Modal from '../components/Modal'
import StocktakeReminderBanner from '../components/StocktakeReminderBadge'
import { itemsLabel, PendingStockBadge, type CardTransferRow } from '../components/CardTransferPanel'
import { usePendingRestock, pendingToneBox } from '../hooks/usePendingRestock'
import PasswordField from '../components/PasswordField'
import { PANEL_KEYS } from '@shared/panels'
import { usePanelLock } from '../hooks/usePanelLocks'
import { faDigits, isValidJalaliDate, jalaliToday, jalaliMonthStart, money, toLatinDigits } from '@shared/jalali'
import { CARD_TRANSFER_OPERATION_LABELS, CARD_TRANSFER_STATUS_LABELS } from '@shared/enums'
import {
  PENDING_RESTOCK_COLUMN,
  PENDING_RESTOCK_EXPLAINER,
  PENDING_RESTOCK_STOCKTAKE_NOTE,
  expectedPhysicalQty
} from '@shared/pendingRestock'
import { DEFAULT_STOCKTAKE_SCHEDULE, type StocktakeSchedule } from '@shared/receipt'
import type { SaleReportPage } from '@shared/types'
import { pageRangeLabel, stocktakePageQuery, stocktakeReloadQuery, type StocktakeQuery } from '@shared/stocktakePaging'

/**
 * ===========================================================================
 * جلسه ۱۸ · بندهای ۴ و ۵ (لایه‌ی UI) — ماژول «انبارگردانی».
 *
 * چهار بخش، همه روی سرویس‌های آماده‌ی جلسه ۱۷:
 *
 *   الف) «ثبت شمارش فیزیکی» (بند ۴-الف) — برای هر کالا، تعداد شمرده‌شده‌ی روی
 *        قفسه در یک تاریخ مشخص. موجودی سیستمیِ همان لحظه را **سرور** snapshot
 *        می‌کند (نه این صفحه)، پس دست‌کاری سمت کلاینت نمی‌تواند مغایرت را صفر
 *        نشان دهد.
 *   ب)  «جلسه‌های شمارش» — سابقه‌ی شمارش‌های ثبت‌شده + جزئیات هر جلسه.
 *   ج)  «مغایرت نیازمند بررسی» (بند ۴-ب) — موجودی سیستمی (شامل افزایش‌های ناشی
 *        از برگشت/تعویض‌های همان بازه) کنار آخرین شمارش فیزیکی. به‌علاوه‌ی فیلتر
 *        «درخواست‌های کارت‌به‌کارت» تا مدیر یک نگاه کلی به «موارد نیازمند توجه»
 *        داشته باشد.
 *   د)  «یادآوری انبارگردانی» (بند ۵) — تاریخ‌های مشخص + بازه‌ی تکرارشونده.
 *
 * ⚠️ دو قاعده‌ی ثابت:
 *   • ثبت شمارش، **موجودی انبار را تغییر نمی‌دهد**. یک شمارش، سند مشاهده است نه
 *     اصلاح انبار؛ اگر خودش موجودی را درست می‌کرد، همان مغایرتی که باید دیده
 *     شود بی‌صدا پاک می‌شد. اصلاح موجودی همان مسیر همیشگی خودش را دارد (پنل
 *     کالاها).
 *   • سیستم هیچ‌کس را متهم نمی‌کند: فقط شواهد و تفاضل را شفاف نشان می‌دهد.
 *
 * IPC: stockCount:variants|submit|list|get|discrepancy ·
 *      stocktake:schedule:get|set|due|dismiss · cardTransfer:list
 * ===========================================================================
 */

type Tab = 'count' | 'sessions' | 'discrepancy' | 'reminder'

interface VariantRow {
  variantId: number
  code: string
  barcode: string
  name: string
  unit: string
  systemQty: number
}

interface SessionListRow {
  id: number
  countedAtJalali: string
  countedAtTime: string
  userName: string | null
  note: string | null
  itemCount: number
  mismatchedCount: number
}

interface SessionDetail {
  id: number
  countedAtJalali: string
  countedAtTime: string
  userName: string | null
  note: string | null
  items: {
    id: number
    variantId: number
    name: string
    code: string | null
    countedQty: number
    systemQty: number
    diffQty: number
    note: string | null
  }[]
}

interface DiscrepancyRow {
  variantId: number
  name?: string
  code?: string | null
  systemQty: number
  countedQty: number | null
  systemQtyAtCount: number | null
  returnedQty: number
  countedAtJalali?: string | null
  diffAtCount: number
  diffNow: number
  hasCount: boolean
  needsReview: boolean
  /**
   * جلسه ۴۴ · کار ب — سه عددی که سرور از جلسه ۴۲ می‌دهد (`calculateStockDiscrepancies`).
   * `?` عمدی است: اگر نسخه‌ی main قدیمی‌تر بود صفحه نباید بشکند، فقط ستون خالی می‌ماند.
   */
  pendingRestockQty?: number
  expectedPhysicalQty?: number
  diffAtCountWithPending?: number
  hasPending?: boolean
}

/**
 * جلسه ۴۴ · کار ب — «مغایرت نیازمند بررسی» از این پس ستونِ `diffAtCountWithPending`
 * است (شمارش منهای موجودی فیزیکیِ مورد انتظار = قابل‌فروش + معلق). ستون خام
 * `diffAtCount` حذف نشد و کنارش ماند، چون همان عددی است که تا دیروز دیده می‌شد و
 * مدیر باید بتواند بفهمد تفاضل از کجا آمده. برای همه‌ی داده‌ی قدیمی (معلق صفر) این
 * دو ستون عیناً یک عددند ⇒ هیچ گزارش قدیمی عوض نمی‌شود.
 */
const DISC_HEADERS = [
  'کد کالا',
  'نام کالا',
  'موجودی سیستمی امروز',
  'افزایش از برگشت/تعویض بازه',
  'آخرین شمارش فیزیکی',
  'تاریخ شمارش',
  'موجودی سیستمی لحظه‌ی شمارش',
  PENDING_RESTOCK_COLUMN,
  'موجودی فیزیکیِ مورد انتظار (قابل‌فروش + معلق)',
  'مغایرت نیازمند بررسی (با احتساب معلق)',
  'اختلاف خام با لحظه‌ی شمارش (بی‌معلق)',
  'اختلاف با موجودی امروز'
]

const CT_HEADERS = [
  'شماره درخواست',
  'وضعیت',
  'شماره فاکتور اصلی',
  'نوع عملیات',
  'کالاهای مربوطه',
  'مبلغ کارت‌به‌کارت',
  'تاریخ',
  'شیفت',
  'وضعیت موجودی کالا'
]

const signed = (n: number): string => (n > 0 ? `+${faDigits(n)}` : faDigits(n))

export default function Stocktake() {
  const nav = useNavigate()
  const [tab, setTab] = useState<Tab>('count')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  // ---------------- الف) فرم ثبت شمارش ----------------
  const [search, setSearch] = useState('')
  const [variants, setVariants] = useState<VariantRow[]>([])
  const [variantPage, setVariantPage] = useState<SaleReportPage | null>(null)
  const [variantWarnings, setVariantWarnings] = useState<string[]>([])
  /** ممیزی ۱۱۹ · A119-02 (AUDIT-D55) — درخواست اعمال‌شده‌ی فهرست کالا (جستجو + skip)؛ پاسخ کهنه با variantReq دور ریخته می‌شود. */
  const [variantQuery, setVariantQuery] = useState<StocktakeQuery | null>(null)
  const variantReq = useRef(0)
  /** فقط کالاهایی که عدد خورده‌اند ثبت می‌شوند (کلید = variantId) */
  const [counted, setCounted] = useState<Record<number, string>>({})
  const [itemNotes, setItemNotes] = useState<Record<number, string>>({})
  const [countDate, setCountDate] = useState(jalaliToday())
  const [countNote, setCountNote] = useState('')
  const [onlyFilled, setOnlyFilled] = useState(false)

  // ---------------- ب) جلسه‌های شمارش ----------------
  const [sessions, setSessions] = useState<SessionListRow[]>([])
  const [sessionPage, setSessionPage] = useState<SaleReportPage | null>(null)
  const [sessionWarnings, setSessionWarnings] = useState<string[]>([])
  const sessionReq = useRef(0)
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null)

  // ---------------- ج) گزارش مغایرت ----------------
  const [fromJalali, setFromJalali] = useState(jalaliMonthStart())
  const [toJalali, setToJalali] = useState(jalaliToday())
  const [onlyMismatched, setOnlyMismatched] = useState(true)
  const [disc, setDisc] = useState<{
    rows: DiscrepancyRow[]
    hasAnyCount: boolean
    pendingRestockQty?: number
  } | null>(null)
  /** فیلتر «درخواست‌های کارت‌به‌کارت» کنار مغایرت‌ها (بند ۴، خط آخر) */
  const [showCardTransfers, setShowCardTransfers] = useState(true)
  const [cardRows, setCardRows] = useState<CardTransferRow[]>([])
  /**
   * «معلق برگشتی» — فقط خواندنی و فقط از هوک مشترک، مثل `Products` و `SalesReports`.
   * این صفحه هیچ دکمه‌ی بازگرداندن به انبار نمی‌سازد؛ آن کار فقط در پنل قفل‌دار
   * «پرداخت‌های مدیر» انجام می‌شود. صفحه در قفل `stocktake` خودش می‌ماند و این هوک
   * هیچ کانال تازه‌ای بیرون از قفل باز نمی‌کند (کانال مشترکِ خواندنی).
   */
  const pending = usePendingRestock(tab === 'discrepancy')

  // ---------------- د) یادآوری ----------------
  const [schedule, setSchedule] = useState<StocktakeSchedule>(DEFAULT_STOCKTAKE_SCHEDULE)
  const [newDate, setNewDate] = useState(jalaliToday())
  const [reminderDirty, setReminderDirty] = useState(false)
  // نشست ۱۵۷ (Y13، S157-D2) — قفل پنل انبارگردانی روشن (یا هنوز بارگذاری‌نشده) ⇒ کادر رمز، fail-closed
  const { lockEnabled: stocktakeLock, loaded: stocktakeLockLoaded } = usePanelLock(PANEL_KEYS.stocktake)
  const scheduleNeedPw = !stocktakeLockLoaded || stocktakeLock
  const [schedulePw, setSchedulePw] = useState('')

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 8000)
  }

  // ======================= بارگذاری‌ها =======================
  const loadVariants = useCallback(async (q: StocktakeQuery) => {
    const seq = ++variantReq.current
    setBusy(true)
    setErr(null)
    try {
      const rows = await call<VariantRow[]>(CH.stockCountVariants, { search: q.search || null, take: 400, skip: q.skip })
      if (seq !== variantReq.current) return
      setVariantQuery(q)
      setVariants(rows)
      setVariantPage((rows as any).page ?? null)
      setVariantWarnings((rows as any).warnings ?? [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      if (seq === variantReq.current) setBusy(false)
    }
  }, [])
  const reloadVariants = () => void loadVariants(stocktakeReloadQuery(variantQuery, search))

  const loadSessions = useCallback(async (skip = 0) => {
    const seq = ++sessionReq.current
    setBusy(true)
    try {
      const rows = await call<SessionListRow[]>(CH.stockCountList, { take: 200, skip })
      if (seq !== sessionReq.current) return
      setSessions(rows)
      setSessionPage((rows as any).page ?? null)
      setSessionWarnings((rows as any).warnings ?? [])
      setErr(null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      if (seq === sessionReq.current) setBusy(false)
    }
  }, [])

  const loadDiscrepancy = useCallback(async () => {
    if (!isValidJalaliDate(fromJalali) || !isValidJalaliDate(toJalali))
      return setErr('بازه‌ی تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
    setBusy(true)
    setErr(null)
    try {
      const [d, ct] = await Promise.all([
        call<{ rows: DiscrepancyRow[]; hasAnyCount: boolean; pendingRestockQty?: number }>(CH.stockCountDiscrepancy, {
          fromJalali,
          toJalali,
          onlyMismatched
        }),
        showCardTransfers
          ? call<{ rows: CardTransferRow[] }>(CH.cardTransferList, { fromJalali, toJalali })
          : Promise.resolve({ rows: [] as CardTransferRow[] })
      ])
      setDisc(d)
      setCardRows(ct?.rows ?? [])
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [fromJalali, toJalali, onlyMismatched, showCardTransfers])

  const loadSchedule = useCallback(async () => {
    try {
      setSchedule(await call<StocktakeSchedule>(CH.stocktakeScheduleGet))
      setReminderDirty(false)
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  useEffect(() => {
    if (tab === 'count') reloadVariants()
    if (tab === 'sessions') void loadSessions(sessionPage?.skip ?? 0)
    if (tab === 'discrepancy') void loadDiscrepancy()
    if (tab === 'reminder') void loadSchedule()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab])

  // ======================= الف) ثبت شمارش =======================
  const filledCount = useMemo(() => Object.values(counted).filter((v) => String(v).trim() !== '').length, [counted])

  const visibleVariants = useMemo(
    () => (onlyFilled ? variants.filter((v) => String(counted[v.variantId] ?? '').trim() !== '') : variants),
    [variants, onlyFilled, counted]
  )

  const submitCount = async () => {
    const items = Object.entries(counted)
      .filter(([, v]) => String(v).trim() !== '')
      .map(([id, v]) => ({
        variantId: Number(id),
        // نشست ۱۴۳ — رقم فارسی «۵» قبلاً NaN و در main صفر می‌شد (کسری کاذب).
        countedQty: Number(toLatinDigits(String(v)).trim()),
        note: itemNotes[Number(id)]?.trim() || null
      }))
    if (!items.length) return setErr('برای ثبت شمارش، حداقل برای یک کالا تعداد شمرده‌شده را وارد کنید.')
    if (!isValidJalaliDate(countDate)) return setErr('تاریخ شمارش معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
    setBusy(true)
    setErr(null)
    try {
      const res = await call<{ id: number; itemCount: number; mismatchedCount: number }>(CH.stockCountSubmit, {
        dateJalali: countDate,
        note: countNote.trim() || null,
        items
      })
      flash(
        `شمارش فیزیکی شماره ${faDigits(res.id)} ثبت شد · ${faDigits(res.itemCount)} کالا · ` +
          `${faDigits(res.mismatchedCount)} مورد اختلاف با موجودی سیستمی. ` +
          'موجودی انبار عمداً تغییر نکرد: این یک سند مشاهده است، نه اصلاح انبار.'
      )
      setCounted({})
      setItemNotes({})
      setCountNote('')
      await loadSessions(0)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  // ======================= د) یادآوری =======================
  const saveSchedule = async () => {
    setBusy(true)
    setErr(null)
    try {
      // نشست ۱۵۷ (Y13، S157-D2) — تغییر برنامه‌ی یادآوری رمز پنل انبارگردانی می‌خواهد (گیت در main)
      const saved = await call<StocktakeSchedule>(CH.stocktakeScheduleSet, { schedule, panelPassword: schedulePw })
      setSchedule(saved)
      setReminderDirty(false)
      flash(
        saved.enabled
          ? `تنظیمات یادآوری ذخیره شد · ${faDigits(saved.dates.length)} تاریخ مشخص` +
              (saved.everyDays ? ` · تکرار هر ${faDigits(saved.everyDays)} روز` : '')
          : 'یادآوری انبارگردانی خاموش شد.'
      )
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSchedulePw('')
      setBusy(false)
    }
  }

  const addDate = () => {
    if (!isValidJalaliDate(newDate)) return setErr('تاریخ معتبر نیست (قالب صحیح: ۱۴۰۵/۰۶/۲۵)')
    if (schedule.dates.includes(newDate)) return setErr('این تاریخ از قبل در فهرست است.')
    setSchedule({ ...schedule, dates: [...schedule.dates, newDate].sort() })
    setReminderDirty(true)
    setErr(null)
  }

  // ================= معلق برگشتی: سه عددِ هر ردیف =================
  /**
   * یک منبع، بدون عدد موازی: اول عددِ خودِ ردیفِ سرور (برای ردیف‌های شمارش‌شده این
   * همان **snapshot لحظه‌ی شمارش** است و باید ثابت بماند، پس عمداً با عددِ زنده
   * جایگزین نمی‌شود)، و فقط اگر نسخه‌ی main این فیلد را نداشت، از خلاصه‌ی مشترک.
   */
  const rowPendingQty = useCallback(
    (r: DiscrepancyRow): number =>
      Math.max(0, Math.round(r.pendingRestockQty ?? pending.qtyOfVariant(r.variantId))),
    [pending]
  )
  const rowExpectedPhysical = useCallback(
    (r: DiscrepancyRow): number =>
      r.expectedPhysicalQty ?? expectedPhysicalQty(r.systemQtyAtCount ?? r.systemQty, rowPendingQty(r)),
    [rowPendingQty]
  )
  /** مغایرت *واقعی*: شمارش منهای موجودی فیزیکیِ مورد انتظار. */
  const rowDiffWithPending = useCallback(
    (r: DiscrepancyRow): number =>
      r.diffAtCountWithPending ?? (r.hasCount ? (r.countedQty ?? 0) - rowExpectedPhysical(r) : 0),
    [rowExpectedPhysical]
  )

  // ======================= خروجی اکسل =======================
  const exportDisc = async () => {
    if (!disc) return
    try {
      const res = await exportTable({
        fileName: `مغایرت نیازمند بررسی ${fromJalali} تا ${toJalali}`,
        title:
          `مغایرت موجودی نیازمند بررسی · ${fromJalali} تا ${toJalali}` +
          ` — ${PENDING_RESTOCK_STOCKTAKE_NOTE}`,
        headers: DISC_HEADERS,
        rows: disc.rows.map((r) => [
          r.code ?? '',
          r.name ?? '',
          r.systemQty,
          r.returnedQty,
          r.hasCount ? (r.countedQty ?? 0) : 'بدون شمارش',
          r.countedAtJalali ?? '',
          r.systemQtyAtCount ?? '',
          rowPendingQty(r),
          rowExpectedPhysical(r),
          r.hasCount ? rowDiffWithPending(r) : 'بدون شمارش',
          r.hasCount ? r.diffAtCount : 'بدون شمارش',
          r.hasCount ? r.diffNow : 'بدون شمارش'
        ])
      })
      if (!res.canceled) flash(`خروجی اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const needsReviewCount = disc?.rows.filter((r) => r.needsReview).length ?? 0
  const pendingCards = cardRows.filter((r) => r.status === 'PENDING').length
  /**
   * جمعِ معلقِ *زنده* برای کارت خلاصه. اگر گزارش گرفته شده باشد، عددِ همان گزارش
   * (سرور با همان سرویس حسابش کرده) وگرنه عددِ هوک. هیچ‌وقت دو عدد کنار هم.
   */
  const pendingLiveQty = disc ? Math.max(0, Math.round(disc.pendingRestockQty ?? pending.totalQty)) : pending.totalQty
  const pendingRowCount = disc?.rows.filter((r) => rowPendingQty(r) > 0).length ?? 0

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">انبارگردانی</h1>
        <div className="flex gap-1 flex-wrap">
          <button className={`btn ${tab === 'count' ? 'btn-primary' : ''}`} onClick={() => setTab('count')}>
            ثبت شمارش فیزیکی
          </button>
          <button className={`btn ${tab === 'sessions' ? 'btn-primary' : ''}`} onClick={() => setTab('sessions')}>
            جلسه‌های شمارش
          </button>
          <button className={`btn ${tab === 'discrepancy' ? 'btn-primary' : ''}`} onClick={() => setTab('discrepancy')}>
            مغایرت نیازمند بررسی
          </button>
          <button className={`btn ${tab === 'reminder' ? 'btn-primary' : ''}`} onClick={() => setTab('reminder')}>
            یادآوری انبارگردانی
          </button>
        </div>
        <div className="ms-auto flex gap-1 flex-wrap">
          <button className="btn" onClick={() => nav('/products')}>
            پنل کالاها
          </button>
          <button className="btn" onClick={() => nav('/sales-reports')}>
            گزارشات فروش <span className="keycap">F9</span>
          </button>
          <button className="btn" onClick={() => nav('/')}>
            صفحه اصلی
          </button>
        </div>
      </div>

      {/* بند ۵ — یادآوری، بالای خودِ ماژول انبار هم دیده می‌شود */}
      <StocktakeReminderBanner showGoToForm={tab !== 'count'} onGoToForm={() => setTab('count')} />

      {(msg || err) && (
        <div
          className={`rounded px-3 py-2 border whitespace-pre-line ${
            err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          {err ?? msg}
        </div>
      )}

      {/* ==================== الف) فرم ثبت شمارش فیزیکی ==================== */}
      {tab === 'count' && (
        <>
          <div className="bg-white rounded shadow p-3 flex flex-wrap items-end gap-3">
            <div>
              <div className="mb-1 font-bold">تاریخ شمارش</div>
              <JalaliDateInput value={countDate} onChange={setCountDate} />
            </div>
            <label className="flex-1 min-w-[220px]">
              <div className="mb-1">توضیح جلسه‌ی شمارش (اختیاری)</div>
              <input
                className="inp"
                value={countNote}
                onChange={(e) => setCountNote(e.target.value)}
                placeholder="مثلاً: انبارگردانی پایان شهریور، قفسه‌های ۱ تا ۴"
              />
            </label>
            <label className="min-w-[220px]">
              <div className="mb-1">جستجوی کالا (نام / کد / بارکد)</div>
              <input
                className="inp"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    reloadVariants()
                  }
                }}
              />
            </label>
            <button className="btn" onClick={reloadVariants} disabled={busy}>
              {busy ? 'در حال خواندن…' : 'بازخوانی کالاها'}
            </button>
            {variantWarnings.map((warning) => (
              <span key={warning} className="kbd bg-amber-100 border border-amber-300">{warning}</span>
            ))}
            <span className="kbd">{pageRangeLabel(variantPage, variants.length, 'کالا')}</span>
            <button className="btn py-1" disabled={!stocktakePageQuery(variantQuery, variantPage, 'prev')} onClick={() => { const q = stocktakePageQuery(variantQuery, variantPage, 'prev'); if (q) void loadVariants(q) }}>
              صفحه‌ی قبل
            </button>
            <button className="btn py-1" disabled={!stocktakePageQuery(variantQuery, variantPage, 'next')} onClick={() => { const q = stocktakePageQuery(variantQuery, variantPage, 'next'); if (q) void loadVariants(q) }}>
              صفحه‌ی بعد
            </button>
            <label className="flex items-center gap-2 font-bold">
              <input type="checkbox" className="w-4 h-4" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />
              فقط کالاهای عددخورده
            </label>
            <button className="btn btn-primary" onClick={() => void submitCount()} disabled={busy || !filledCount}>
              ثبت شمارش ({faDigits(filledCount)} کالا)
            </button>
          </div>

          <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7">
            <b>این فرم موجودی انبار را تغییر نمی‌دهد.</b> فقط عددی که روی قفسه شمرده‌اید ثبت می‌شود و سیستم، موجودی
            سیستمیِ <b>همان لحظه</b> را کنارش نگه می‌دارد تا اختلاف مشخص شود. اصلاح موجودی مثل همیشه از پنل کالاها انجام
            می‌گیرد — وگرنه همان مغایرتی که باید دیده شود بی‌صدا پاک می‌شد.
          </div>

          <div className="tbl-card">
            <table className="tbl text-sm">
              <thead className="sticky top-0">
                <tr>
                  <th>کد</th>
                  <th>بارکد</th>
                  <th>نام کالا</th>
                  <th>واحد</th>
                  <th>موجودی سیستمی</th>
                  <th>تعداد شمرده‌شده روی قفسه</th>
                  <th>اختلاف</th>
                  <th>توضیح ردیف</th>
                </tr>
              </thead>
              <tbody>
                {visibleVariants.map((v) => {
                  const raw = String(counted[v.variantId] ?? '')
                  const has = raw.trim() !== ''
                  const diff = has ? Number(raw) - v.systemQty : 0
                  return (
                    <tr key={v.variantId} className={has && diff !== 0 ? 'bg-amber-50' : ''}>
                      <td className="tabular-nums">{faDigits(v.code || '—')}</td>
                      <td dir="ltr" className="tabular-nums">
                        {v.barcode || '—'}
                      </td>
                      <td>{v.name}</td>
                      <td>{v.unit}</td>
                      <td className="tabular-nums">{faDigits(v.systemQty)}</td>
                      <td>
                        <input
                          dir="ltr"
                          className="inp w-28 text-center tabular-nums"
                          value={raw}
                          onChange={(e) =>
                            setCounted((c) => ({ ...c, [v.variantId]: e.target.value.replace(/[^\d]/g, '') }))
                          }
                        />
                      </td>
                      <td className={`tabular-nums font-bold ${!has ? 'text-slate-400' : diff === 0 ? 'text-emerald-700' : 'text-amber-800'}`}>
                        {has ? signed(diff) : '—'}
                      </td>
                      <td>
                        <input
                          className="inp"
                          value={itemNotes[v.variantId] ?? ''}
                          onChange={(e) => setItemNotes((n) => ({ ...n, [v.variantId]: e.target.value }))}
                        />
                      </td>
                    </tr>
                  )
                })}
                {!visibleVariants.length && (
                  <tr>
                    <td colSpan={8} className="text-center py-6 text-slate-500">
                      {onlyFilled
                        ? 'هنوز برای هیچ کالایی عدد شمارش وارد نشده است.'
                        : 'کالایی پیدا نشد. عبارت جستجو را عوض کنید و «بازخوانی کالاها» را بزنید.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ==================== ب) جلسه‌های شمارش ==================== */}
      {tab === 'sessions' && (
        <div className="tbl-card">
          <div className="p-2 flex gap-2 items-center flex-wrap border-b">
            {sessionWarnings.map((warning) => (
              <span key={warning} className="kbd bg-amber-100 border border-amber-300">{warning}</span>
            ))}
            <span className="kbd">{pageRangeLabel(sessionPage, sessions.length, 'جلسه')}</span>
            <button className="btn py-1 mr-auto" disabled={!stocktakePageQuery(null, sessionPage, 'prev')} onClick={() => { const q = stocktakePageQuery(null, sessionPage, 'prev'); if (q) void loadSessions(q.skip) }}>
              صفحه‌ی قبل
            </button>
            <button className="btn py-1" disabled={!stocktakePageQuery(null, sessionPage, 'next')} onClick={() => { const q = stocktakePageQuery(null, sessionPage, 'next'); if (q) void loadSessions(q.skip) }}>
              صفحه‌ی بعد
            </button>
          </div>
          <table className="tbl text-sm">
            <thead className="sticky top-0">
              <tr>
                <th>شماره جلسه</th>
                <th>تاریخ شمارش</th>
                <th>ساعت ثبت</th>
                <th>ثبت‌کننده</th>
                <th>تعداد کالای شمرده‌شده</th>
                <th>موارد دارای اختلاف</th>
                <th>توضیح</th>
                <th>جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className={s.mismatchedCount ? 'bg-amber-50' : ''}>
                  <td className="tabular-nums">{faDigits(s.id)}</td>
                  <td className="tabular-nums">{faDigits(s.countedAtJalali)}</td>
                  <td className="tabular-nums">{faDigits(s.countedAtTime)}</td>
                  <td>{s.userName ?? 'نامشخص'}</td>
                  <td className="tabular-nums">{faDigits(s.itemCount)}</td>
                  <td className={`tabular-nums font-bold ${s.mismatchedCount ? 'text-amber-800' : 'text-emerald-700'}`}>
                    {faDigits(s.mismatchedCount)}
                  </td>
                  <td>{s.note ?? '—'}</td>
                  <td>
                    <button
                      className="btn"
                      onClick={() =>
                        void call<SessionDetail>(CH.stockCountGet, { id: s.id })
                          .then(setSessionDetail)
                          .catch((e) => setErr(e.message))
                      }
                    >
                      نمایش
                    </button>
                  </td>
                </tr>
              ))}
              {!sessions.length && (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-slate-500">
                    هنوز هیچ جلسه‌ی شمارش فیزیکی‌ای ثبت نشده است. تا وقتی یک شمارش واقعی ثبت نشود، گزارش «مغایرت نیازمند
                    بررسی» هیچ عددی برای مقایسه ندارد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== ج) گزارش مغایرت نیازمند بررسی ==================== */}
      {tab === 'discrepancy' && (
        <>
          <div className="bg-white rounded shadow p-3 flex flex-wrap items-end gap-3">
            <div>
              <div className="mb-1">از تاریخ</div>
              <JalaliDateInput value={fromJalali} onChange={setFromJalali} />
            </div>
            <div>
              <div className="mb-1">تا تاریخ</div>
              <JalaliDateInput value={toJalali} onChange={setToJalali} />
            </div>
            <label className="flex items-center gap-2 font-bold">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={onlyMismatched}
                onChange={(e) => setOnlyMismatched(e.target.checked)}
              />
              فقط موارد دارای مغایرت
            </label>
            <label className="flex items-center gap-2 font-bold">
              <input
                type="checkbox"
                className="w-4 h-4"
                checked={showCardTransfers}
                onChange={(e) => setShowCardTransfers(e.target.checked)}
              />
              درخواست‌های کارت‌به‌کارت را هم نشان بده
            </label>
            <button
              className="btn btn-primary"
              onClick={() => {
                void loadDiscrepancy()
                void pending.reload() // عددِ معلقِ کارت خلاصه هم با همین دکمه تازه شود
              }}
              disabled={busy}
            >
              {busy ? 'در حال خواندن…' : 'تهیه گزارش'}
            </button>
            <button className="btn" onClick={() => void exportDisc()} disabled={!disc?.rows.length}>
              خروجی اکسل
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="rounded border-2 border-amber-400 bg-amber-50 p-3">
              <div className="kbd">مغایرت نیازمند بررسی</div>
              <div className="font-bold text-lg tabular-nums">{faDigits(needsReviewCount)} کالا</div>
            </div>
            {/* کارت خلاصه‌ی معلق برگشتی — خواندنی، بدون هیچ دکمه‌ای */}
            <div className={`rounded border-2 p-3 ${pendingToneBox(pending.tone)}`} title={PENDING_RESTOCK_EXPLAINER}>
              <div className="kbd">{PENDING_RESTOCK_COLUMN}</div>
              <div className="font-bold text-lg tabular-nums">
                {faDigits(pendingLiveQty)} عدد
                {pendingRowCount ? <span className="kbd"> · در {faDigits(pendingRowCount)} کالا</span> : null}
              </div>
              <div className="kbd leading-6">فیزیکی در فروشگاه، بیرون از موجودی قابل‌فروش</div>
            </div>
            <div className="rounded border-2 border-sky-400 bg-sky-50 p-3">
              <div className="kbd">درخواست کارت‌به‌کارت در انتظار پرداخت</div>
              <div className="font-bold text-lg tabular-nums">{faDigits(pendingCards)} مورد</div>
            </div>
            <div className="rounded border-2 border-slate-300 p-3">
              <div className="kbd">وضعیت شمارش فیزیکی</div>
              <div className="font-bold">
                {disc?.hasAnyCount ? 'شمارش ثبت‌شده موجود است' : 'در این بازه هیچ شمارشی ثبت نشده'}
              </div>
            </div>
          </div>

          {disc && !disc.hasAnyCount && (
            <div className="rounded border-2 border-amber-500 bg-amber-50 p-3 leading-7">
              <b>در این بازه هیچ شمارش فیزیکی‌ای ثبت نشده است.</b> این گزارش فقط زمانی معنی‌دار است که یک عدد «شمارش
              فیزیکی واقعی» برای مقایسه با عدد سیستم وجود داشته باشد. اول از تب «ثبت شمارش فیزیکی» یک شمارش وارد کنید.
            </div>
          )}

          {/* ---- هشدار خواندنیِ «در انتظار تأیید مدیر» (بند ۴ خواسته‌ی مالک) ---- */}
          {pending.headline && (
            <div className={`rounded border-2 p-3 leading-7 ${pendingToneBox(pending.tone)}`}>
              <b>{pending.headline}</b>
              <div className="kbd leading-6 mt-1">
                {PENDING_RESTOCK_STOCKTAKE_NOTE} برگرداندن این کالا به موجودی قابل‌فروش فقط در پنل قفل‌دار
                «پرداخت‌های مدیر — کارت‌به‌کارت» (گزارشات فروش) انجام می‌شود و این صفحه هیچ دکمه‌ای برایش ندارد.
              </div>
            </div>
          )}

          <div className="rounded border-2 border-slate-300 bg-slate-50 p-3 leading-7">
            سیستم هیچ‌کس را متهم نمی‌کند و هیچ نتیجه‌ای نمی‌گیرد: فقط موجودی سیستمی (شامل افزایش‌های ناشی از
            برگشت/تعویض‌های ثبت‌شده در همین بازه) را کنار آخرین شمارش فیزیکی می‌گذارد و تفاضل را نشان می‌دهد. کالایی که
            هیچ شمارشی ندارد «بدون شمارش» علامت می‌خورد، نه «مغایرت صفر».
            <div className="mt-1">
              ستون «مغایرت نیازمند بررسی (با احتساب معلق)» = شمارش فیزیکی منهای <b>موجودی فیزیکیِ مورد انتظار</b>{' '}
              (قابل‌فروش + معلق برگشتی)، و ستون «اختلاف خام» همان عددِ قبلی بی‌معلق است. برای کالای بی‌معلق این دو
              عدد یکی‌اند؛ پس هیچ گزارش قدیمی‌ای عوض نشده. کالای معلقِ ردیف‌های شمارش‌شده، عددِ <b>همان روزِ شمارش</b>{' '}
              است (snapshot) نه عددِ امروز، تا مغایرتِ ثبت‌شده در گذشته ثابت بماند.
            </div>
          </div>

          <div className="tbl-card">
            <table className="tbl text-sm">
              <thead className="sticky top-0">
                <tr>
                  {DISC_HEADERS.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(disc?.rows ?? []).map((r) => (
                  <tr
                    key={r.variantId}
                    className={r.needsReview ? 'bg-amber-50' : rowPendingQty(r) ? 'bg-sky-50/60' : ''}
                  >
                    <td className="tabular-nums">{faDigits(r.code ?? '—')}</td>
                    <td>{r.name ?? '—'}</td>
                    <td className="tabular-nums">{faDigits(r.systemQty)}</td>
                    <td className="tabular-nums">{r.returnedQty ? signed(r.returnedQty) : faDigits(0)}</td>
                    <td className="tabular-nums">{r.hasCount ? faDigits(r.countedQty ?? 0) : 'بدون شمارش'}</td>
                    <td className="tabular-nums">{r.countedAtJalali ? faDigits(r.countedAtJalali) : '—'}</td>
                    <td className="tabular-nums">{r.systemQtyAtCount == null ? '—' : faDigits(r.systemQtyAtCount)}</td>
                    {/* معلق برگشتی: خواندنی، جدا از موجودی، با متن انبارگردانی */}
                    <td className="whitespace-nowrap" title={rowPendingQty(r) ? PENDING_RESTOCK_EXPLAINER : undefined}>
                      {rowPendingQty(r) ? (
                        <PendingStockBadge qty={rowPendingQty(r)} tone={pending.tone} />
                      ) : (
                        <span className="kbd">—</span>
                      )}
                    </td>
                    <td className="tabular-nums" title={rowPendingQty(r) ? PENDING_RESTOCK_STOCKTAKE_NOTE : undefined}>
                      {faDigits(rowExpectedPhysical(r))}
                    </td>
                    <td
                      className={`tabular-nums font-bold ${
                        !r.hasCount
                          ? 'text-slate-400'
                          : rowDiffWithPending(r) === 0
                            ? 'text-emerald-700'
                            : 'text-amber-900'
                      }`}
                      title={
                        rowPendingQty(r)
                          ? `شمارش ${faDigits(r.countedQty ?? 0)} منهای موجودی فیزیکیِ مورد انتظار ` +
                            `${faDigits(rowExpectedPhysical(r))} · ${PENDING_RESTOCK_STOCKTAKE_NOTE}`
                          : undefined
                      }
                    >
                      {r.hasCount ? signed(rowDiffWithPending(r)) : 'بدون شمارش'}
                    </td>
                    <td className={`tabular-nums ${!r.hasCount ? 'text-slate-400' : 'text-slate-600'}`}>
                      {r.hasCount ? signed(r.diffAtCount) : 'بدون شمارش'}
                    </td>
                    <td className="tabular-nums">{r.hasCount ? signed(r.diffNow) : '—'}</td>
                  </tr>
                ))}
                {!disc?.rows.length && (
                  <tr>
                    <td colSpan={DISC_HEADERS.length} className="text-center py-6 text-slate-500">
                      ردیفی برای نمایش نیست. تیک «فقط موارد دارای مغایرت» را بردارید تا همه‌ی کالاهای درگیر دیده شوند.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* «موارد نیازمند توجه»: درخواست‌های کارت‌به‌کارت کنار مغایرت‌های موجودی */}
          {showCardTransfers && (
            <div className="bg-white rounded shadow p-3 border-2 border-sky-400 space-y-2">
              <div className="font-bold text-sky-900">درخواست‌های کارت‌به‌کارت همین بازه (موارد نیازمند توجه)</div>
              <div className="kbd leading-6">
                این فهرست فقط برای «یک نگاه کلی» کنار مغایرت‌های موجودی آمده است. بررسی و ثبت «پرداخت شد» در تب
                «درخواست‌های کارت‌به‌کارت» گزارشات فروش انجام می‌شود.
              </div>
              <table className="tbl text-sm">
                <thead>
                  <tr>
                    {CT_HEADERS.map((h) => (
                      <th key={h} className="whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cardRows.map((r) => (
                    <tr key={r.id} className={r.status === 'PENDING' ? 'bg-amber-50' : ''}>
                      <td className="tabular-nums">{faDigits(r.id)}</td>
                      <td className="whitespace-nowrap">{CARD_TRANSFER_STATUS_LABELS[r.status] ?? r.status}</td>
                      <td className="tabular-nums">{r.sourceReceiptNo ? faDigits(r.sourceReceiptNo) : '—'}</td>
                      <td className="whitespace-nowrap">
                        {CARD_TRANSFER_OPERATION_LABELS[r.operationKind] ?? r.operationKind}
                      </td>
                      <td className="max-w-[280px]">{itemsLabel(r.items)}</td>
                      <td className="tabular-nums">{money(r.amount)}</td>
                      <td className="tabular-nums">{faDigits(r.createdAtJalali)}</td>
                      <td>{r.shiftName ?? '—'}</td>
                      <td className="max-w-[200px]">{r.stockNote ?? '—'}</td>
                    </tr>
                  ))}
                  {!cardRows.length && (
                    <tr>
                      <td colSpan={CT_HEADERS.length} className="text-center py-4 text-slate-500">
                        درخواست کارت‌به‌کارتی در این بازه ثبت نشده است.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* ==================== د) یادآوری انبارگردانی ==================== */}
      {tab === 'reminder' && (
        <div className="bg-white rounded shadow p-3 space-y-3 max-w-3xl">
          <label className="flex items-center gap-2 font-bold">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={schedule.enabled}
              onChange={(e) => {
                setSchedule({ ...schedule, enabled: e.target.checked })
                setReminderDirty(true)
              }}
            />
            یادآوری انبارگردانی فیزیکی روشن باشد
          </label>

          <div className="rounded border p-3 space-y-2">
            <div className="font-bold">تاریخ‌های مشخص</div>
            <div className="flex flex-wrap items-end gap-2">
              <JalaliDateInput value={newDate} onChange={setNewDate} />
              <button className="btn" onClick={addDate}>
                افزودن تاریخ
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {schedule.dates.map((d) => (
                <span key={d} className="rounded border border-slate-300 bg-slate-50 px-2 py-1 flex items-center gap-2">
                  <span className="tabular-nums">{faDigits(d)}</span>
                  <button
                    className="text-rose-700 font-bold"
                    title="حذف این تاریخ"
                    onClick={() => {
                      setSchedule({ ...schedule, dates: schedule.dates.filter((x) => x !== d) })
                      setReminderDirty(true)
                    }}
                  >
                    ✕
                  </button>
                </span>
              ))}
              {!schedule.dates.length && <span className="kbd">هیچ تاریخ مشخصی تعیین نشده است.</span>}
            </div>
            <div className="kbd leading-6">
              هر تاریخی که برسد یا بگذرد و بعدش شمارشی ثبت نشده باشد، یادآوری می‌دهد — پس یک روز مرخصی، یادآوری را
              بی‌صدا رد نمی‌کند.
            </div>
          </div>

          <div className="rounded border p-3 space-y-2">
            <div className="font-bold">بازه‌ی تکرارشونده</div>
            <div className="flex flex-wrap items-end gap-3">
              <label>
                <div className="mb-1">هر چند روز یک‌بار؟ (۰ = بدون تکرار)</div>
                <input
                  dir="ltr"
                  className="inp w-28 text-center tabular-nums"
                  value={String(schedule.everyDays)}
                  onChange={(e) => {
                    setSchedule({ ...schedule, everyDays: Number(e.target.value.replace(/[^\d]/g, '') || 0) })
                    setReminderDirty(true)
                  }}
                />
              </label>
              <div>
                <div className="mb-1">تاریخ مبنای شمارش (خالی = آخرین شمارش ثبت‌شده)</div>
                <JalaliDateInput
                  value={schedule.startJalali}
                  onChange={(v) => {
                    setSchedule({ ...schedule, startJalali: v })
                    setReminderDirty(true)
                  }}
                />
              </div>
            </div>
            <div className="kbd leading-6">
              مثال: «هر ۳۰ روز یک‌بار». دو سازوکار (تاریخ‌های مشخص و بازه‌ی تکرارشونده) مستقل‌اند و «یا» بین آن‌هاست؛ هر
              کدام برسد، یادآوری می‌آید.
            </div>
          </div>

          <div className="flex gap-2 items-center flex-wrap">
            {scheduleNeedPw && (
              <label className="flex items-center gap-2">
                <span className="kbd">رمز مدیر یا رمز پنل انبارگردانی:</span>
                <PasswordField value={schedulePw} onChange={(e) => setSchedulePw(e.target.value)} />
              </label>
            )}
            <button
              className="btn btn-primary"
              onClick={() => void saveSchedule()}
              disabled={busy || (scheduleNeedPw && !schedulePw.trim())}
            >
              {busy ? 'در حال ذخیره…' : 'ذخیره‌ی تنظیمات یادآوری'}
            </button>
            <button className="btn" onClick={() => void loadSchedule()} disabled={busy}>
              بازگردانی از دیتابیس
            </button>
            {reminderDirty && <span className="kbd text-amber-700 font-bold">تغییرات ذخیره نشده</span>}
          </div>

          <div className="kbd leading-6">
            این یادآوری <b>هیچ چیزی را قفل نمی‌کند</b>: فقط یک نشان برجسته در نوار بالای برنامه، صفحه‌ی اصلی و بالای همین
            ماژول نشان داده می‌شود که مستقیم به فرم ثبت شمارش فیزیکی لینک است.
          </div>
        </div>
      )}

      {/* ---------------- پنجره‌ی جزئیات یک جلسه‌ی شمارش ---------------- */}
      <Modal
        open={!!sessionDetail}
        title={sessionDetail ? `جلسه‌ی شمارش شماره ${faDigits(sessionDetail.id)}` : 'جلسه‌ی شمارش'}
        onClose={() => setSessionDetail(null)}
        width="max-w-4xl"
      >
        {sessionDetail && (
          <div className="space-y-2">
            <div className="kbd leading-6">
              تاریخ شمارش: <b>{faDigits(sessionDetail.countedAtJalali)}</b> · ساعت ثبت:{' '}
              <b>{faDigits(sessionDetail.countedAtTime)}</b> · ثبت‌کننده: <b>{sessionDetail.userName ?? 'نامشخص'}</b>
              {sessionDetail.note ? ` · توضیح: ${sessionDetail.note}` : ''}
            </div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  <th>کد</th>
                  <th>نام کالا</th>
                  <th>شمرده‌شده</th>
                  <th>موجودی سیستمی همان لحظه</th>
                  <th>اختلاف</th>
                  <th>توضیح</th>
                </tr>
              </thead>
              <tbody>
                {sessionDetail.items.map((i) => (
                  <tr key={i.id} className={i.diffQty !== 0 ? 'bg-amber-50' : ''}>
                    <td className="tabular-nums">{faDigits(i.code ?? '—')}</td>
                    <td>{i.name}</td>
                    <td className="tabular-nums">{faDigits(i.countedQty)}</td>
                    <td className="tabular-nums">{faDigits(i.systemQty)}</td>
                    <td className={`tabular-nums font-bold ${i.diffQty === 0 ? 'text-emerald-700' : 'text-amber-900'}`}>
                      {signed(i.diffQty)}
                    </td>
                    <td>{i.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  )
}
