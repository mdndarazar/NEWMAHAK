import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLatestGate } from '@shared/latestRequest'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import Modal from './Modal'
import ManagerGate from './ManagerGate'
import PasswordField from './PasswordField'
import { PANEL_KEYS } from '@shared/panels'
import { canAdjustCardTransfer } from '@shared/cardTransferUi'
import { faDigits, money } from '@shared/jalali'
import {
  CARD_TRANSFER_KIND_LABELS,
  CARD_TRANSFER_METHOD_LABELS,
  CARD_TRANSFER_OPERATION_LABELS,
  CARD_TRANSFER_STATUS_LABELS,
  CardTransferStatus
} from '@shared/enums'
import {
  EMPTY_PENDING_RESTOCK,
  PENDING_RESTOCK_COLUMN,
  PENDING_RESTOCK_EXPLAINER,
  PENDING_RESTOCK_LABEL,
  pendingRestockHeadline,
  pendingRestockTone,
  type PendingRestockSummary
} from '@shared/pendingRestock'

/**
 * ===========================================================================
 * جلسه ۱۸ · بند ۱ (لایه‌ی UI) — «درخواست‌های کارت‌به‌کارت توسط مدیر».
 *
 * کل منطق سرور از جلسه ۱۷ آماده بود (`CardTransferService` + پنج کانال IPC +
 * `calculateCardTransferTotals`) ولی **هیچ صفحه‌ای نداشت**، پس درخواست‌هایی که
 * پنل برگشت/تعویض می‌ساخت هیچ‌جا دیده نمی‌شدند و مدیر نمی‌توانست «پرداخت شد»
 * بزند. این فایل فقط همان لایه‌ی دیدنی است و **هیچ محاسبه‌ای انجام نمی‌دهد**:
 * تمام عددها — از جمله جمع‌های «جریان‌های مالی خارج از فروش» — عیناً همان‌هایی
 * هستند که سرور از `accounting.ts` برمی‌گرداند.
 *
 * چهار قاعده‌ی بند ۱ که این UI رعایتشان می‌کند:
 *   ۱) فقط مدیر می‌بیند و مدیریت می‌کند ⇒ کل تب داخل
 *      `<ManagerGate panel={PANEL_KEYS.cardTransfers} inline>` است (قانون
 *      همیشگی «هر ماژول جدید، یک رمز دوم اختصاصی»).
 *   ۲) رکورد پرداخت‌شده **ویرایش و حذف نمی‌شود**: هیچ دکمه‌ی ویرایش/حذفی وجود
 *      ندارد؛ تنها راه اصلاح، «ثبت رویداد اصلاحی» است که یک ردیف *جدید* می‌سازد.
 *   ۳) ساختن درخواست از این صفحه ممکن نیست (نه دکمه‌ای، نه فرمی): درخواست فقط
 *      به‌صورت خودکار و پشت یک برگشت/تعویض ثبت‌شده زاییده می‌شود.
 *   ۴) این مبالغ در سرجمع فروش نمی‌آیند؛ بلوک جداگانه‌ی «جریان‌های مالی خارج از
 *      فروش» همین را صریح می‌گوید.
 *
 * IPC: cardTransfer:list · cardTransfer:get · cardTransfer:pay ·
 *      cardTransfer:adjust · cardTransfer:outOfSales
 * ===========================================================================
 */

export interface CardTransferRow {
  id: number
  kind: string
  status: string
  operationKind: string
  returnId: number
  sourceInvoiceId: number | null
  sourceReceiptNo: number | null
  exchangeInvoiceId: number | null
  exchangeReceiptNo: number | null
  invoiceTotal: number
  returnTotal: number
  amount: number
  items: { name: string; qty: number; unitPrice?: number }[]
  stockNote: string | null
  userId: number | null
  userName: string | null
  shiftId: number | null
  shiftName: string | null
  createdAtJalali: string
  createdAtTime: string
  paidAmount: number | null
  paidAtJalali: string | null
  paidAtTime: string | null
  paidMethod: string | null
  trackingNo: string | null
  paidByUserId: number | null
  paidByUserName: string | null
  paidShiftId: number | null
  paidShiftName: string | null
  adjustsRequestId: number | null
  adjustReason: string | null
  /** ---- جلسه ۴۱ · کار ب — رد/لغو و ردِ آزادسازی کالای معلق ---- */
  canceledAt?: string | null
  cancelReason?: string | null
  stockReleasedAt?: string | null
  stockReleasedQty?: number | null
  note: string | null
}

export interface CardTransferTotalsView {
  pendingAmount: number
  pendingCount: number
  paidAmount: number
  paidCount: number
  adjustmentAmount: number
  adjustmentCount: number
  netOutOfSalesFlow: number
}

const HEADERS = [
  'شماره درخواست',
  'نوع ردیف',
  'وضعیت',
  'شماره فاکتور اصلی',
  'نوع عملیات',
  'کالاهای مربوطه',
  'مبلغ اصلی فاکتور',
  'مبلغ برگشت',
  'مبلغ کارت‌به‌کارت',
  'تاریخ عملیات',
  'ساعت',
  'شیفت',
  'کارمند ثبت‌کننده',
  'وضعیت موجودی کالا',
  PENDING_RESTOCK_COLUMN,
  'مبلغ پرداخت‌شده',
  'تاریخ تأیید پرداخت',
  'شماره پیگیری'
]

const statusLabel = (s: string): string => CARD_TRANSFER_STATUS_LABELS[s] ?? s
const kindLabel = (k: string): string => CARD_TRANSFER_KIND_LABELS[k] ?? k
const opLabel = (k: string): string => CARD_TRANSFER_OPERATION_LABELS[k] ?? k

/** اقلام یک درخواست به یک خط خوانا («کفش سایز ۴۲ × ۲»). */
export function itemsLabel(items: { name: string; qty: number }[] | null | undefined): string {
  const list = Array.isArray(items) ? items : []
  if (!list.length) return '—'
  return list.map((i) => `${i.name} × ${faDigits(i.qty)}`).join(' · ')
}

const statusTone = (s: string): string =>
  s === CardTransferStatus.PENDING
    ? 'bg-amber-100 text-amber-900 border-amber-400'
    : s === CardTransferStatus.PAID
      ? 'bg-emerald-50 text-emerald-900 border-emerald-400'
      : s === CardTransferStatus.CANCELED
        ? 'bg-rose-50 text-rose-900 border-rose-400'
        : 'bg-slate-100 text-slate-700 border-slate-300'

/**
 * جلسه ۴۱ · کار ب — نشان «در انتظار تأیید مدیر» روی کالای معلق.
 * فقط یک برچسبِ خواندنی است؛ هیچ دکمه‌ای نیست و از همان متن مشترک
 * `@shared/pendingRestock` می‌آید تا پنج صفحه یک جمله بگویند.
 */
export function PendingStockBadge({ qty, tone = 'info' }: { qty: number; tone?: string }) {
  if (!qty) return null
  const cls =
    tone === 'alert'
      ? 'bg-rose-100 text-rose-900 border-rose-500'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-900 border-amber-500'
        : 'bg-sky-50 text-sky-900 border-sky-400'
  return (
    <span className={`inline-block rounded border px-2 py-px whitespace-nowrap ${cls}`} title={PENDING_RESTOCK_EXPLAINER}>
      {faDigits(qty)} عدد · {PENDING_RESTOCK_LABEL}
    </span>
  )
}

function StatusChip({ status }: { status: string }) {
  return <span className={`inline-block rounded border px-2 py-px whitespace-nowrap ${statusTone(status)}`}>{statusLabel(status)}</span>
}

/** یک خط «برچسب: مقدار» برای پنجره‌ی جزئیات. */
function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start gap-2 border-b border-slate-100 py-1">
      <span className="min-w-[170px] text-slate-500">{label}</span>
      <span className={`flex-1 ${strong ? 'font-bold' : ''}`}>{value}</span>
    </div>
  )
}

function Body({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  const [rows, setRows] = useState<CardTransferRow[]>([])
  const [totals, setTotals] = useState<CardTransferTotalsView | null>(null)
  /** نشست ۱۱۴ — هشدار برش فهرست (جمع‌ها روی کل بازه‌اند) */
  const [listWarnings, setListWarnings] = useState<string[]>([])
  const [outOfSales, setOutOfSales] = useState<{ totals: CardTransferTotalsView; note: string } | null>(null)
  const [statusFilter, setStatusFilter] = useState<'' | 'PENDING' | 'PAID' | 'ADJUSTED' | 'CANCELED'>('')
  /**
   * جلسه ۴۱ · کار ب — «معلق برگشتی». عمداً از کانال مشترک
   * `pendingRestock:summary` خوانده می‌شود و *همین‌جا محاسبه نمی‌شود*، تا این
   * پنل و چهار صفحه‌ی دیگر هیچ‌وقت دو عدد متفاوت نشان ندهند.
   */
  const [pending, setPending] = useState<PendingRestockSummary>(EMPTY_PENDING_RESTOCK)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  /** درخواست باز در پنجره‌ی جزئیات (با زنجیره‌ی رویدادهای اصلاحی‌اش) */
  const [detail, setDetail] = useState<{ request: CardTransferRow; adjustments: CardTransferRow[] } | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  // فرم «پرداخت شد»
  const [payAmount, setPayAmount] = useState('')
  const [payTracking, setPayTracking] = useState('')
  const [payNote, setPayNote] = useState('')
  /**
   * جلسه ۴۱ · کار ب — رمز مدیر برای *عملیات*.
   * `cardTransfer:pay` و `cardTransfer:cancel` حالا موجودی انبار را عوض می‌کنند،
   * پس سرور خودش `assertPanelPassword(PANEL_KEYS.cardTransfers, …)` را صدا
   * می‌زند و قفل رندرر تنها خط دفاع نیست. این فیلد همان رمز را می‌رساند.
   */
  const [payPassword, setPayPassword] = useState('')
  // فرم «رد/لغو درخواست»
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelRelease, setCancelRelease] = useState(false)
  const [cancelPassword, setCancelPassword] = useState('')
  // فرم «رویداد اصلاحی»
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjAmount, setAdjAmount] = useState('')
  const [adjReason, setAdjReason] = useState('')
  const [adjTracking, setAdjTracking] = useState('')
  /** نشست ۱۴۴ · بند ۴-۳۹ — رویداد اصلاحی هم مثل pay/cancel گیت سمت سرور دارد. */
  const [adjPassword, setAdjPassword] = useState('')

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 6000)
  }

  /**
   * نشست ۱۷۴ · مشاهده‌ی P3 ممیزی ۸۸ (الگوی A88-01) — فقط پاسخ آخرین درخواست روی جدول/جمع‌ها
   * می‌نشیند؛ با عوض‌شدن بازه/فیلتر وضعیت، ردیف‌ها و جمع‌های قبلی فوراً پاک می‌شوند و Excel حین
   * بارگذاری بسته است (بازخوانی بعد از پرداخت/لغو همان بازه را پاک نمی‌کند).
   */
  const gate = useRef(createLatestGate()).current
  const loadedKey = useRef<string | null>(null)
  const load = useCallback(async () => {
    const seq = gate.next()
    const key = `${fromJalali}|${toJalali}|${statusFilter}`
    if (loadedKey.current !== key) {
      setRows([])
      setTotals(null)
      setListWarnings([])
      setOutOfSales(null)
    }
    setBusy(true)
    setErr(null)
    try {
      const [list, out, pend] = await Promise.all([
        call<{ rows: CardTransferRow[]; totals: CardTransferTotalsView; warnings?: string[] }>(CH.cardTransferList, {
          fromJalali,
          toJalali,
          status: statusFilter || null
        }),
        call<{ totals: CardTransferTotalsView; rows: CardTransferRow[]; note: string; warnings?: string[] }>(CH.cardTransferOutOfSales, {
          fromJalali,
          toJalali
        }),
        /**
         * ⚠️ «معلق برگشتی» عمداً بازه‌ی تاریخ نمی‌گیرد: کالایی که سه ماه پیش
         * معلق شده و هنوز پرداخت نشده، امروز هم روی قفسه است. فیلتر تاریخ
         * پنهانش می‌کرد و همان مشکلی می‌شد که این کار برای رفعش نوشته شده.
         */
        call<PendingRestockSummary>(CH.pendingRestockSummary, {})
      ])
      if (!gate.isLatest(seq)) return
      loadedKey.current = key
      setRows(list?.rows ?? [])
      setTotals(list?.totals ?? null)
      setListWarnings([...(list?.warnings ?? []), ...(out?.warnings ?? [])])
      setOutOfSales(out ? { totals: out.totals, note: out.note } : null)
      setPending(pend ?? EMPTY_PENDING_RESTOCK)
    } catch (e: any) {
      if (gate.isLatest(seq)) setErr(e.message)
    } finally {
      if (gate.isLatest(seq)) setBusy(false)
    }
  }, [fromJalali, toJalali, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const openDetail = async (id: number) => {
    setDetailBusy(true)
    setErr(null)
    try {
      const d = await call<{ request: CardTransferRow; adjustments: CardTransferRow[] }>(CH.cardTransferGet, { id })
      setDetail(d)
      setPayAmount(String(d.request.amount ?? ''))
      setPayTracking('')
      setPayNote('')
      setPayPassword('')
      setCancelOpen(false)
      setCancelReason('')
      setCancelRelease(false)
      setCancelPassword('')
      setAdjustOpen(false)
      setAdjAmount('')
      setAdjReason('')
      setAdjTracking('')
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDetailBusy(false)
    }
  }

  const pay = async () => {
    if (!detail) return
    setDetailBusy(true)
    try {
      const amount = payAmount.trim() === '' ? null : Number(payAmount.trim())
      const res = await call<{ releasedQty?: number }>(CH.cardTransferPay, {
        id: detail.request.id,
        paidAmount: amount,
        trackingNo: payTracking.trim() || null,
        note: payNote.trim() || null,
        /** رمز مدیر ⇒ گیت سمت سرور (نه فقط قفل رندرر) */
        managerPassword: payPassword.trim() || undefined
      })
      flash(
        `پرداخت کارت‌به‌کارت درخواست ${faDigits(detail.request.id)} ثبت شد. ` +
          'این مبلغ در «جریان‌های مالی خارج از فروش» می‌نشیند و در سرجمع فروش نمی‌آید.' +
          (res?.releasedQty
            ? `\n${faDigits(res.releasedQty)} عدد کالای برگشتیِ معلق، همین حالا به موجودی قابل‌فروش اضافه شد.`
            : '\nاین درخواست کالای معلقی نداشت، پس موجودی انبار تغییر نکرد.')
      )
      setPayPassword('')
      await openDetail(detail.request.id)
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDetailBusy(false)
    }
  }

  /**
   * جلسه ۴۱ · کار ب — «رد/لغو» درخواست.
   * دلیل اجباری است و تکلیف کالای معلق یک تصمیم *صریح* (`releaseStock`) — بدون
   * این مسیر، کالای یک درخواستِ ردشده تا ابد معلق می‌ماند و هر ماه در
   * انبارگردانی یک مغایرت باز می‌ساخت.
   */
  const cancelRequest = async () => {
    if (!detail) return
    setDetailBusy(true)
    try {
      const res = await call<{ releasedQty?: number; stillPending?: boolean }>(CH.cardTransferCancel, {
        id: detail.request.id,
        reason: cancelReason.trim(),
        releaseStock: cancelRelease,
        managerPassword: cancelPassword.trim() || undefined
      })
      flash(
        `درخواست ${faDigits(detail.request.id)} رد/لغو شد (رکورد حذف نشد و در سابقه ماند).` +
          (res?.releasedQty
            ? `\n${faDigits(res.releasedQty)} عدد کالای معلق با تأیید صریح شما و بدون پرداخت، به موجودی قابل‌فروش برگشت.`
            : res?.stillPending
              ? '\nکالای برگشتی همچنان معلق است و به موجودی قابل‌فروش اضافه نشد؛ برای بستن پرونده، سند برگشت را در پنل «برگشت از فروش» ویرایش یا حذف کنید.'
              : '\nاین درخواست کالای معلقی نداشت.')
      )
      setCancelOpen(false)
      setCancelReason('')
      setCancelRelease(false)
      setCancelPassword('')
      await openDetail(detail.request.id)
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDetailBusy(false)
    }
  }

  const adjust = async () => {
    if (!detail) return
    setDetailBusy(true)
    try {
      await call(CH.cardTransferAdjust, {
        id: detail.request.id,
        amount: Number(adjAmount.trim()),
        reason: adjReason.trim(),
        trackingNo: adjTracking.trim() || null,
        /** رمز مدیر ⇒ گیت سمت سرور (نه فقط قفل رندرر) */
        managerPassword: adjPassword.trim() || undefined
      })
      flash('رویداد اصلاحی ثبت شد. رکورد قبلی دست‌نخورده در سابقه ماند (هیچ چیزی بازنویسی نشد).')
      setAdjustOpen(false)
      setAdjAmount('')
      setAdjReason('')
      setAdjTracking('')
      setAdjPassword('')
      await openDetail(detail.request.id)
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDetailBusy(false)
    }
  }

  /**
   * «این درخواست چند عدد کالای معلق دارد؟» — روی `returnId` گروه می‌شود، چون
   * معلق بودن یک خاصیتِ *سند برگشت* است نه خودِ درخواست (ردیف `ADJUSTMENT` هم
   * همان `returnId` را دارد و نباید عدد را دو بار نشان دهد).
   */
  const pendingByReturn = useMemo(() => {
    const m = new Map<number, number>()
    for (const it of pending.items) m.set(it.returnId, (m.get(it.returnId) ?? 0) + it.qty)
    return m
  }, [pending])
  const pendingTone = pendingRestockTone(pending.oldestAgeDays, pending.totalQty)
  const pendingHead = pendingRestockHeadline(pending, faDigits, money)

  const pendingOf = (r: CardTransferRow): number =>
    r.kind === 'ADJUSTMENT' ? 0 : pendingByReturn.get(r.returnId) ?? 0

  const tableRows = useMemo(
    () =>
      rows.map((r) => [
        r.id,
        kindLabel(r.kind),
        statusLabel(r.status),
        r.sourceReceiptNo ?? '—',
        opLabel(r.operationKind),
        itemsLabel(r.items),
        r.invoiceTotal,
        r.returnTotal,
        r.amount,
        r.createdAtJalali,
        r.createdAtTime,
        r.shiftName ?? '—',
        r.userName ?? 'نامشخص',
        r.stockNote ?? '—',
        pendingOf(r) ? `${faDigits(pendingOf(r))} عدد · ${PENDING_RESTOCK_LABEL}` : '—',
        r.paidAmount ?? '',
        r.paidAtJalali ? `${r.paidAtJalali} ${r.paidAtTime ?? ''}`.trim() : '—',
        r.trackingNo ?? '—'
      ]),
    [rows, pendingByReturn]
  )

  const exportRows = async () => {
    if (busy) return
    try {
      const res = await exportTable({
        fileName: `درخواست‌های کارت‌به‌کارت ${fromJalali} تا ${toJalali}`,
        title: `درخواست‌های کارت‌به‌کارت توسط مدیر · ${fromJalali} تا ${toJalali}`,
        headers: HEADERS,
        rows: tableRows as (string | number | null)[][]
      })
      if (!res.canceled) flash(`خروجی اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const req = detail?.request ?? null
  const canPay = !!req && req.kind === 'REQUEST' && req.status === CardTransferStatus.PENDING
  /** جمع «پرداخت‌شده + اصلاح‌ها» برای همین یک درخواست (فقط نمایش، از عددهای سرور) */
  const chainNet = detail
    ? (detail.request.paidAmount ?? 0) + detail.adjustments.reduce((s, a) => s + (a.paidAmount ?? a.amount ?? 0), 0)
    : 0

  return (
    <div className="space-y-2">
      {/* ------------------- نوار فیلتر و جمع‌ها ------------------- */}
      <div className="bg-white rounded shadow p-2 flex flex-wrap items-end gap-3">
        <label>
          <div className="mb-1 font-bold">وضعیت</div>
          <select className="inp min-w-[190px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
            <option value="">همه‌ی ردیف‌ها</option>
            <option value="PENDING">در انتظار پرداخت</option>
            <option value="PAID">پرداخت‌شده</option>
            <option value="ADJUSTED">اصلاح‌شده</option>
            <option value="CANCELED">رد/لغو‌شده</option>
          </select>
        </label>
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال خواندن…' : 'بازخوانی'}
        </button>
        <button className="btn" onClick={() => void exportRows()} disabled={busy || !rows.length}>
          خروجی اکسل
        </button>
        <span className="kbd leading-6 flex-1 min-w-[280px]">
          بازه‌ی تاریخ از همان نوار فیلتر بالای گزارشات فروش خوانده می‌شود. درخواست‌ها فقط و فقط پشت یک برگشت یا تعویضِ
          ثبت‌شده ساخته می‌شوند، پس این صفحه دکمه‌ی «درخواست جدید» ندارد و نباید داشته باشد.
        </span>
      </div>

      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="bg-amber-50 border-2 border-amber-400 rounded p-3">
            <div className="kbd">در انتظار پرداخت مدیر</div>
            <div className="font-bold text-lg tabular-nums">{money(totals.pendingAmount)}</div>
            <div className="kbd">{faDigits(totals.pendingCount)} درخواست</div>
          </div>
          <div className="bg-emerald-50 border-2 border-emerald-400 rounded p-3">
            <div className="kbd">پرداخت‌شده توسط مدیر</div>
            <div className="font-bold text-lg tabular-nums">{money(totals.paidAmount)}</div>
            <div className="kbd">{faDigits(totals.paidCount)} درخواست</div>
          </div>
          <div className="bg-slate-50 border-2 border-slate-300 rounded p-3">
            <div className="kbd">رویدادهای اصلاحی</div>
            <div className="font-bold text-lg tabular-nums">{money(totals.adjustmentAmount)}</div>
            <div className="kbd">{faDigits(totals.adjustmentCount)} رویداد</div>
          </div>
          <div className="bg-sky-50 border-2 border-sky-400 rounded p-3">
            <div className="kbd">خروج وجه واقعی (پرداخت + اصلاح)</div>
            <div className="font-bold text-lg tabular-nums">{money(totals.netOutOfSalesFlow)}</div>
            <div className="kbd">خارج از سرجمع فروش</div>
          </div>
        </div>
      )}

      {/* ---------- جلسه ۴۱ · کار ب — نوار «کالای در انتظار تأیید مدیر» ---------- */}
      {pendingHead && (
        <div
          className={`rounded p-3 border-2 whitespace-pre-line leading-7 ${
            pendingTone === 'alert'
              ? 'bg-rose-50 border-rose-500'
              : pendingTone === 'warn'
                ? 'bg-amber-50 border-amber-500'
                : 'bg-sky-50 border-sky-400'
          }`}
        >
          <div className="font-bold mb-1">
            {PENDING_RESTOCK_LABEL} — {faDigits(pending.totalQty)} عدد کالای برگشتی
          </div>
          {pendingHead}
          {pending.needsAttentionQty > 0 && (
            <div className="mt-1 font-bold text-rose-800">
              ⚠️ {faDigits(pending.needsAttentionQty)} عدد از این کالاها درخواستشان رد/لغو شده ولی هنوز معلق‌اند و تکلیفشان
              روشن نیست: یا با «رد/لغو» و تیکِ آزادسازی به موجودی برشان گردانید، یا سند برگشت را در پنل «برگشت از فروش»
              ویرایش/حذف کنید.
            </div>
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

      {/* ------------------- جدول درخواست‌ها ------------------- */}
      <div className="tbl-card">
        {listWarnings.length > 0 && (
          <div className="p-2 bg-rose-50 text-rose-800 font-bold border-b">⚠ {listWarnings.join(' ')}</div>
        )}
        <table className="tbl text-sm">
          <thead className="sticky top-0">
            <tr>
              {HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th className="whitespace-nowrap">بررسی</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.kind === 'ADJUSTMENT' ? 'bg-slate-50' : ''}>
                <td className="tabular-nums">{faDigits(r.id)}</td>
                <td className="whitespace-nowrap">
                  {kindLabel(r.kind)}
                  {r.adjustsRequestId ? <span className="kbd"> (روی درخواست {faDigits(r.adjustsRequestId)})</span> : null}
                </td>
                <td>
                  <StatusChip status={r.status} />
                </td>
                <td className="tabular-nums">{r.sourceReceiptNo ? faDigits(r.sourceReceiptNo) : '—'}</td>
                <td className="whitespace-nowrap">
                  {opLabel(r.operationKind)}
                  {r.exchangeReceiptNo ? <span className="kbd"> · سند تعویض {faDigits(r.exchangeReceiptNo)}</span> : null}
                </td>
                <td className="max-w-[320px]">{itemsLabel(r.items)}</td>
                <td className="tabular-nums">{money(r.invoiceTotal)}</td>
                <td className="tabular-nums">{money(r.returnTotal)}</td>
                <td className="tabular-nums font-bold">{money(r.amount)}</td>
                <td className="tabular-nums whitespace-nowrap">{faDigits(r.createdAtJalali)}</td>
                <td className="tabular-nums whitespace-nowrap">{faDigits(r.createdAtTime)}</td>
                <td className="whitespace-nowrap">{r.shiftName ?? '—'}</td>
                <td className="whitespace-nowrap">{r.userName ?? 'نامشخص'}</td>
                <td className="max-w-[200px]">{r.stockNote ?? '—'}</td>
                <td className="whitespace-nowrap">
                  {pendingOf(r) ? <PendingStockBadge qty={pendingOf(r)} tone={pendingTone} /> : <span className="kbd">—</span>}
                </td>
                <td className="tabular-nums">{r.paidAmount == null ? '—' : money(r.paidAmount)}</td>
                <td className="tabular-nums whitespace-nowrap">
                  {r.paidAtJalali ? faDigits(`${r.paidAtJalali} ${r.paidAtTime ?? ''}`.trim()) : '—'}
                </td>
                <td dir="ltr" className="whitespace-nowrap">
                  {r.trackingNo ?? '—'}
                </td>
                <td>
                  <button className="btn" onClick={() => void openDetail(r.id)}>
                    {r.kind === 'REQUEST' && r.status === CardTransferStatus.PENDING ? 'بررسی و پرداخت' : 'جزئیات'}
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={HEADERS.length + 1} className="text-center py-6 text-slate-500">
                  در این بازه هیچ درخواست کارت‌به‌کارتی ثبت نشده است. این ردیف‌ها خودکار و فقط پشت یک «برگشت از فروش» یا
                  «تعویض کالا»یی ساخته می‌شوند که روش تسویه‌اش «کارت‌به‌کارت توسط مدیر» انتخاب شده باشد.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------- بلوک «جریان‌های مالی خارج از فروش» ------------------- */}
      <div className="bg-white rounded shadow p-3 border-2 border-sky-400 space-y-2">
        <div className="font-bold text-sky-900">جریان‌های مالی خارج از فروش</div>
        {outOfSales ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <div className="rounded border p-2">
                <div className="kbd">کارت‌به‌کارت پرداخت‌شده توسط مدیر</div>
                <div className="font-bold tabular-nums">{money(outOfSales.totals.paidAmount)}</div>
              </div>
              <div className="rounded border p-2">
                <div className="kbd">رویدادهای اصلاحی</div>
                <div className="font-bold tabular-nums">{money(outOfSales.totals.adjustmentAmount)}</div>
              </div>
              <div className="rounded border-2 border-sky-400 p-2 bg-sky-50">
                <div className="kbd">جمع جریان خارج از فروش</div>
                <div className="font-bold tabular-nums">{money(outOfSales.totals.netOutOfSalesFlow)}</div>
              </div>
            </div>
            <div className="kbd leading-6 whitespace-pre-line">{outOfSales.note}</div>
          </>
        ) : (
          <div className="kbd">در حال خواندن…</div>
        )}
      </div>

      {/* ------------------- پنجره‌ی جزئیات / پرداخت / اصلاح ------------------- */}
      <Modal
        open={!!detail}
        title={req ? `درخواست کارت‌به‌کارت شماره ${faDigits(req.id)}` : 'درخواست کارت‌به‌کارت'}
        onClose={() => setDetail(null)}
        width="max-w-3xl"
      >
        {req && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <StatusChip status={req.status} />
              <span className="kbd">{kindLabel(req.kind)}</span>
              {req.adjustsRequestId ? <span className="kbd">رویداد اصلاحی روی درخواست {faDigits(req.adjustsRequestId)}</span> : null}
            </div>

            <div className="rounded border p-3">
              <Row label="شماره فاکتور اصلی" value={req.sourceReceiptNo ? faDigits(req.sourceReceiptNo) : '—'} />
              <Row label="نوع عملیات مرجع" value={opLabel(req.operationKind)} />
              <Row label="سند برگشت/تعویض مرجع" value={faDigits(req.returnId)} />
              {req.exchangeReceiptNo ? <Row label="سند تعویض" value={faDigits(req.exchangeReceiptNo)} /> : null}
              <Row label="کالاهای مربوطه" value={itemsLabel(req.items)} />
              <Row label="وضعیت موجودی کالا" value={req.stockNote ?? '—'} />
              <Row
                label={PENDING_RESTOCK_COLUMN}
                value={
                  pendingOf(req)
                    ? `${faDigits(pendingOf(req))} عدد — ${PENDING_RESTOCK_EXPLAINER}`
                    : req.stockReleasedQty
                      ? `آزاد شده: ${faDigits(req.stockReleasedQty)} عدد به موجودی قابل‌فروش برگشت`
                      : 'کالای معلقی ندارد'
                }
                strong={pendingOf(req) > 0}
              />
              {req.cancelReason ? <Row label="دلیل رد/لغو" value={req.cancelReason} /> : null}
              <Row label="مبلغ اصلی فاکتور" value={money(req.invoiceTotal)} />
              <Row label="مبلغ برگشت" value={money(req.returnTotal)} />
              <Row label="مبلغ کارت‌به‌کارت" value={money(req.amount)} strong />
              <Row
                label="تاریخ و ساعت عملیات"
                value={faDigits(`${req.createdAtJalali} ${req.createdAtTime}`.trim()) || '—'}
              />
              <Row label="شیفت عملیات" value={req.shiftName ?? '—'} />
              <Row label="کارمند ثبت‌کننده" value={req.userName ?? 'نامشخص'} />
              {req.note ? <Row label="توضیح" value={req.note} /> : null}
            </div>

            {req.status === CardTransferStatus.PAID || req.paidAmount != null ? (
              <div className="rounded border-2 border-emerald-400 bg-emerald-50 p-3">
                <div className="font-bold mb-1">پرداخت ثبت‌شده</div>
                <Row label="مبلغ پرداخت‌شده" value={money(req.paidAmount ?? 0)} strong />
                <Row
                  label="زمان تأیید"
                  value={faDigits(`${req.paidAtJalali ?? ''} ${req.paidAtTime ?? ''}`.trim()) || '—'}
                />
                <Row
                  label="روش پرداخت"
                  value={(req.paidMethod ? CARD_TRANSFER_METHOD_LABELS[req.paidMethod] ?? req.paidMethod : '—') as string}
                />
                <Row label="شیفت تأیید پرداخت" value={req.paidShiftName ?? '—'} />
                <Row label="تأییدکننده" value={req.paidByUserName ?? 'نامشخص'} />
                <Row label="شماره پیگیری تراکنش" value={req.trackingNo ?? 'ثبت نشده'} />
              </div>
            ) : null}

            {/* ---- دکمه‌ی «پرداخت شد» (فقط روی درخواست در انتظار پرداخت) ---- */}
            {canPay && (
              <div className="rounded border-2 border-amber-400 bg-amber-50 p-3 space-y-2">
                <div className="font-bold">ثبت «پرداخت شد»</div>
                <div className="flex flex-wrap gap-2 items-end">
                  <label>
                    <div className="mb-1">مبلغ پرداخت‌شده (ریال)</div>
                    <input
                      dir="ltr"
                      className="inp w-48 text-center tabular-nums"
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value.replace(/[^\d]/g, ''))}
                    />
                  </label>
                  <label>
                    <div className="mb-1">شماره پیگیری تراکنش (اختیاری)</div>
                    <input dir="ltr" className="inp w-56" value={payTracking} onChange={(e) => setPayTracking(e.target.value)} />
                  </label>
                  <label className="flex-1 min-w-[200px]">
                    <div className="mb-1">توضیح (اختیاری)</div>
                    <input className="inp" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-2 items-end">
                  <label className="min-w-[240px]">
                    <div className="mb-1">
                      رمز مدیر یا رمز دوم همین پنل <span className="text-rose-700 font-bold">(تأیید سمت سرور)</span>
                    </div>
                    <PasswordField
                      className="inp text-center"
                      value={payPassword}
                      onChange={(e: any) => setPayPassword(e.target.value)}
                      placeholder="اگر قفل این ماژول خاموش باشد، خالی بگذارید"
                    />
                  </label>
                </div>
                {pendingOf(req) > 0 && (
                  <div className="rounded border-2 border-sky-400 bg-sky-50 p-2 leading-7">
                    <b>
                      با زدن «پرداخت شد»، {faDigits(pendingOf(req))} عدد کالای برگشتیِ این سند در همان لحظه به موجودی
                      قابل‌فروش اضافه می‌شود.
                    </b>{' '}
                    {PENDING_RESTOCK_EXPLAINER}
                  </div>
                )}
                <div className="kbd leading-6">
                  با زدن این دکمه، مبلغ پرداخت‌شده، زمان تأیید، وضعیت، فاکتور و عملیات مرجع، روش پرداخت، شیفت و شماره
                  پیگیری (اگر وارد شده باشد) ثبت می‌شوند. بعد از آن، این رکورد <b>دیگر قابل ویرایش یا حذف نیست</b>؛ هر
                  اصلاحی باید به‌صورت یک «رویداد اصلاحی» جدید ثبت شود تا سابقه از بین نرود.
                  <br />
                  ⚠️ چون این دکمه <b>موجودی انبار را هم عوض می‌کند</b>، تأیید مدیر این بار در خودِ سرور بررسی می‌شود؛ باز
                  بودن قفل این صفحه به‌تنهایی کافی نیست.
                </div>
                <button className="btn btn-primary" onClick={() => void pay()} disabled={detailBusy}>
                  {detailBusy ? 'در حال ثبت…' : 'پرداخت شد'}
                </button>
              </div>
            )}

            {/* ---- جلسه ۴۱ · کار ب — رد/لغو درخواست و تکلیف کالای معلق ---- */}
            {canPay &&
              (cancelOpen ? (
                <div className="rounded border-2 border-rose-400 bg-rose-50 p-3 space-y-2">
                  <div className="font-bold">رد یا لغو این درخواست</div>
                  <label className="block">
                    <div className="mb-1">
                      دلیل <span className="text-rose-700 font-bold">(اجباری)</span>
                    </div>
                    <input className="inp" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
                  </label>
                  <label className="flex items-start gap-2 leading-7">
                    <input
                      type="checkbox"
                      className="mt-2"
                      checked={cancelRelease}
                      onChange={(e) => setCancelRelease(e.target.checked)}
                    />
                    <span>
                      <b>کالا را بدون پرداخت به موجودی قابل‌فروش برگردان.</b> فقط وقتی این را بزنید که مطمئنید مشتری پولی
                      طلب ندارد (مثلاً برگشت اشتباه ثبت شده). اگر خاموش بماند، کالا معلق می‌ماند تا فروشنده خودِ سند برگشت
                      را در پنل «برگشت از فروش» ویرایش یا حذف کند.
                    </span>
                  </label>
                  <label className="block max-w-[320px]">
                    <div className="mb-1">رمز مدیر یا رمز دوم همین پنل</div>
                    <PasswordField
                      className="inp text-center"
                      value={cancelPassword}
                      onChange={(e: any) => setCancelPassword(e.target.value)}
                    />
                  </label>
                  <div className="kbd leading-6">
                    رکورد <b>حذف یا بازنویسی نمی‌شود</b>: فقط وضعیتش «رد/لغو‌شده» می‌شود و دلیل شما در سابقه و AuditLog
                    می‌نشیند. درخواستِ پرداخت‌شده هیچ‌وقت لغو نمی‌شود (برای برگشت مبلغ از «رویداد اصلاحی» با مبلغ منفی
                    استفاده کنید).
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="btn bg-rose-600 text-white"
                      onClick={() => void cancelRequest()}
                      disabled={detailBusy || !cancelReason.trim()}
                    >
                      {detailBusy ? 'در حال ثبت…' : 'ثبت رد/لغو'}
                    </button>
                    <button className="btn" onClick={() => setCancelOpen(false)} disabled={detailBusy}>
                      انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <button className="btn" onClick={() => setCancelOpen(true)}>
                  رد یا لغو این درخواست
                </button>
              ))}

            {/* ---- زنجیره‌ی رویدادهای اصلاحی ---- */}
            <div className="rounded border p-3 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-bold">رویدادهای اصلاحی</div>
                <div className="kbd tabular-nums">جمع پرداخت + اصلاح‌های این درخواست: {money(chainNet)}</div>
              </div>
              {detail!.adjustments.length ? (
                <table className="tbl text-sm">
                  <thead>
                    <tr>
                      <th>شماره</th>
                      <th>مبلغ اصلاحی</th>
                      <th>دلیل</th>
                      <th>تاریخ</th>
                      <th>ساعت</th>
                      <th>شماره پیگیری</th>
                      <th>ثبت‌کننده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail!.adjustments.map((a) => (
                      <tr key={a.id}>
                        <td className="tabular-nums">{faDigits(a.id)}</td>
                        <td className={`tabular-nums font-bold ${a.amount < 0 ? 'text-rose-700' : ''}`}>{money(a.amount)}</td>
                        <td>{a.adjustReason ?? '—'}</td>
                        <td className="tabular-nums">{faDigits(a.paidAtJalali ?? a.createdAtJalali)}</td>
                        <td className="tabular-nums">{faDigits(a.paidAtTime ?? a.createdAtTime)}</td>
                        <td dir="ltr">{a.trackingNo ?? '—'}</td>
                        <td>{a.paidByUserName ?? a.userName ?? 'نامشخص'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="kbd">هیچ رویداد اصلاحی‌ای روی این درخواست ثبت نشده است.</div>
              )}

              {/* ممیزی A115-01 (AUDIT-D47) — فقط روی درخواست پرداخت‌شده؛ main هم مستقل رد می‌کند. */}
              {canAdjustCardTransfer(req) &&
                (adjustOpen ? (
                  <div className="rounded border-2 border-slate-300 p-3 space-y-2 bg-slate-50">
                    <div className="font-bold">ثبت رویداد اصلاحی جدید</div>
                    <div className="flex flex-wrap gap-2 items-end">
                      <label>
                        <div className="mb-1">مبلغ اصلاحی (ریال)</div>
                        <input
                          dir="ltr"
                          className="inp w-48 text-center tabular-nums"
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value.replace(/[^\d-]/g, ''))}
                          placeholder="مثبت = پرداخت بیشتر · منفی = برگشت مبلغ"
                        />
                      </label>
                      <label>
                        <div className="mb-1">شماره پیگیری (اختیاری)</div>
                        <input dir="ltr" className="inp w-56" value={adjTracking} onChange={(e) => setAdjTracking(e.target.value)} />
                      </label>
                      <label className="flex-1 min-w-[220px]">
                        <div className="mb-1">
                          دلیل اصلاح <span className="text-rose-700 font-bold">(اجباری)</span>
                        </div>
                        <input className="inp" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
                      </label>
                      <label className="min-w-[240px]">
                        <div className="mb-1">
                          رمز مدیر یا رمز دوم همین پنل <span className="text-rose-700 font-bold">(تأیید سمت سرور)</span>
                        </div>
                        <PasswordField
                          className="inp text-center"
                          value={adjPassword}
                          onChange={(e: any) => setAdjPassword(e.target.value)}
                          placeholder="اگر قفل این ماژول خاموش باشد، خالی بگذارید"
                        />
                      </label>
                    </div>
                    <div className="kbd leading-6">
                      رکورد قبلی <b>بازنویسی یا حذف نمی‌شود</b>: یک ردیف جدید ساخته می‌شود که به همین درخواست اشاره
                      می‌کند، پس هم عدد اولیه و هم اصلاح، هر دو در سابقه می‌مانند.
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn btn-primary"
                        onClick={() => void adjust()}
                        disabled={detailBusy || !adjReason.trim() || !adjAmount.trim()}
                      >
                        {detailBusy ? 'در حال ثبت…' : 'ثبت رویداد اصلاحی'}
                      </button>
                      <button className="btn" onClick={() => setAdjustOpen(false)} disabled={detailBusy}>
                        انصراف
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="btn" onClick={() => setAdjustOpen(true)}>
                    ثبت رویداد اصلاحی
                  </button>
                ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

/**
 * تب «درخواست‌های کارت‌به‌کارت» — فقط مدیر (یا رمز دوم اختصاصی همین تب).
 * گیت *داخل* تب است، نه دور کل پنل گزارشات، پس بقیه‌ی گزارش‌ها مثل قبل باز
 * می‌مانند. تا قفل باز نشود، هیچ درخواستی هم به سرور فرستاده نمی‌شود.
 */
export default function CardTransferPanel({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  return (
    <ManagerGate
      panel={PANEL_KEYS.cardTransfers}
      title="درخواست‌های کارت‌به‌کارت"
      reason="این بخش بازپرداخت‌های «کارت‌به‌کارت توسط مدیر» و ثبت «پرداخت شد» را نشان می‌دهد، پس فقط برای مدیر (یا با رمز دوم اختصاصی همین بخش) باز می‌شود."
      inline
    >
      <Body fromJalali={fromJalali} toJalali={toJalali} />
    </ManagerGate>
  )
}
