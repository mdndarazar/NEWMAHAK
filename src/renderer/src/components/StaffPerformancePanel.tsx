import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import ManagerGate from './ManagerGate'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, isValidJalaliDate, money } from '@shared/jalali'
import { staffSectionNotice } from '@shared/staffTransactionsPaging'
import { EXCHANGE_SETTLEMENT_LABELS, refundMethodLabel, RETURN_KIND_LABELS, STAFF_ROLE_LABELS } from '@shared/enums'

/**
 * ===========================================================================
 * جلسه ۱۸ · بند ۲ و ۳ (لایه‌ی UI) — «عملکرد کارمندان» و «تخفیف‌های غیرعادی».
 *
 * سرورش از جلسه ۱۷ آماده بود (`StaffReportService` + `calculateStaffPerformance`
 * + `invoiceDiscountPercent`) ولی هیچ صفحه‌ای نداشت.
 *
 * ⚠️ قاعده‌ی سختِ بند ۲: «هیچ فرمول مالی جدیدی اختراع نکن». این فایل حتی یک
 * جمع هم خودش نمی‌زند — همه‌ی ستون‌ها عیناً همان عددهایی هستند که سرور از
 * `accounting.ts` برگردانده است. تنها جمعی که اینجا محاسبه می‌شود، «جمع ستون‌های
 * همان جدول» برای ردیف آخر است (جمع نمایشی، نه فرمول مالی).
 *
 * آستانه‌ی «تخفیف غیرعادی» هم اینجا تعریف نمی‌شود: از `accounting.policy`
 * تنظیمات می‌آید (تنظیمات → سیاست حسابداری) و این صفحه فقط نشانش می‌دهد و
 * اجازه می‌دهد برای *همین یک گزارش* موقتاً عدد دیگری امتحان شود.
 *
 * IPC: staff:list · staff:performance:rows · staff:performance:transactions ·
 *      staff:abnormalDiscounts
 * ===========================================================================
 */

interface StaffOption {
  id: number
  name: string
  role: string
  isActive: boolean
}

interface PerformanceRow {
  userId: number | null
  userName: string
  salesTotal: number
  invoiceCount: number
  discountTotal: number
  discountPercent: number
  grossGoods: number
  returnCount: number
  returnTotal: number
  exchangeCount: number
  exchangeTotal: number
  storeCreditCount: number
  storeCreditTotal: number
  storeCreditUsedCount: number
  storeCreditUsedTotal: number
  cardToCardTotal: number
}

interface TransactionsResult {
  invoices: {
    id: number
    receiptNo: number | null
    dateJalali: string
    grandTotal: number
    discountTotal: number
    discountPercent: number
    orderType: string | null
    status: string | null
    shiftName: string | null
    userName: string | null
  }[]
  returns: {
    id: number
    kind: string
    receiptNo: number | null
    total: number
    dateJalali: string
    time: string
    refundMethod: string | null
    refundAmount: number | null
    exchangeTotal: number | null
    exchangeDiff: number | null
    exchangeSettlement: string | null
    storeCreditReference: string | null
    shiftName: string | null
  }[]
  cardTransfers: {
    id: number
    kind: string
    status: string
    amount: number
    paidAmount: number | null
    sourceReceiptNo: number | null
    dateJalali: string
    time: string
  }[]
  creditRedemptions: {
    id: number
    storeCreditReference: string
    amount: number
    invoiceId: number | null
    receiptNo: number | null
    atJalali: string
    atTime: string
  }[]
  pages: {
    invoices: { skip: number; take: number; totalCount: number; truncated: boolean }
    returns: { skip: number; take: number; totalCount: number; truncated: boolean }
    cardTransfers: { skip: number; take: number; totalCount: number; truncated: boolean }
    creditRedemptions: { skip: number; take: number; totalCount: number; truncated: boolean }
  }
  warnings: string[]
}

interface AbnormalResult {
  threshold: number
  disabled: boolean
  rows: {
    id: number
    receiptNo: number | null
    dateJalali: string
    userId: number | null
    userName: string
    shiftName: string | null
    goodsTotal: number
    discountTotal: number
    grandTotal: number
    discountPercent: number
  }[]
}

const PERF_HEADERS = [
  'کارمند',
  'جمع فروش',
  'تعداد فاکتور',
  'جمع تخفیف داده‌شده',
  'میانگین درصد تخفیف',
  'تعداد برگشتی',
  'جمع مبلغ برگشتی',
  'تعداد تعویض',
  'جمع مبلغ تعویض',
  'تعداد اعتبار خرید',
  'جمع مبلغ اعتبار خرید',
  'تعداد مصرف اعتبار',
  'جمع مصرف اعتبار',
  'تعهد کارت‌به‌کارت'
]

const ABNORMAL_HEADERS = ['شماره فیش', 'تاریخ', 'کارمند', 'شیفت', 'جمع کالا', 'تخفیف', 'درصد تخفیف', 'جمع کل فاکتور']

const pct = (n: number): string => `${faDigits(Number(n ?? 0).toFixed(1))}٪`

function Body({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  const [staff, setStaff] = useState<StaffOption[]>([])
  /** '' = همه‌ی کارمندان */
  const [userId, setUserId] = useState<number | ''>('')
  const [rows, setRows] = useState<PerformanceRow[]>([])
  const [meta, setMeta] = useState<{ invoiceCount: number; returnCount: number } | null>(null)
  const [abnormal, setAbnormal] = useState<AbnormalResult | null>(null)
  /** آستانه‌ی موقتِ همین گزارش (خالی = همان آستانه‌ی تنظیمات) */
  const [thresholdDraft, setThresholdDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  /** کارمندی که ریز تراکنش‌هایش باز شده است */
  const [drill, setDrill] = useState<{ row: PerformanceRow; data: TransactionsResult } | null>(null)
  const [drillBusy, setDrillBusy] = useState(false)
  const [drillSkip, setDrillSkip] = useState(0)
  /** ممیزی A103-01 — بخش خالیِ صفحه‌ی ۲ به بعد «ردیفی نیست» دروغ نمی‌گوید (skip مشترک چهار بخش) */
  const sectionEmpty = (label: string, key: keyof TransactionsResult['pages'], fallback: string): string =>
    (drill && staffSectionNotice(label, drill.data.pages?.[key], (drill.data[key] as unknown[]).length, (v) => v.toLocaleString('fa-IR')).emptyText) ||
    fallback

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 6000)
  }

  useEffect(() => {
    call<StaffOption[]>(CH.staffList)
      .then((list) => setStaff(Array.isArray(list) ? list : []))
      .catch(() => setStaff([]))
  }, [])

  /**
   * ممیزی A88-01 — هر درخواست شماره می‌گیرد و فقط پاسخ آخرین درخواست روی جدول می‌نشیند؛
   * روی تاریخ خالی/نیمه‌تایپ‌شده اصلاً درخواست نمی‌رود (جدول و Excel عدد بازه‌ی دیگری را
   * با عنوان بازه‌ی فعلی نشان نمی‌دهند).
   */
  const reqSeq = useRef(0)
  const datesOk = isValidJalaliDate(fromJalali) && isValidJalaliDate(toJalali)
  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setDrill(null)
    if (!isValidJalaliDate(fromJalali) || !isValidJalaliDate(toJalali)) {
      setRows([])
      setMeta(null)
      setAbnormal(null)
      setBusy(false)
      setErr('تاریخ «از» و «تا» را کامل و معتبر وارد کنید (مثل ۱۴۰۵/۰۷/۰۱)؛ تا آن موقع گزارشی نمایش داده نمی‌شود.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const uid = userId === '' ? null : Number(userId)
      const threshold = thresholdDraft.trim() === '' ? null : Number(thresholdDraft.trim())
      const [perf, abn] = await Promise.all([
        call<{ rows: PerformanceRow[]; invoiceCount: number; returnCount: number }>(CH.staffPerformance, {
          fromJalali,
          toJalali,
          userId: uid
        }),
        call<AbnormalResult>(CH.staffAbnormalDiscounts, { fromJalali, toJalali, userId: uid, threshold })
      ])
      if (seq !== reqSeq.current) return
      setRows(perf?.rows ?? [])
      setMeta({ invoiceCount: perf?.invoiceCount ?? 0, returnCount: perf?.returnCount ?? 0 })
      setAbnormal(abn ?? null)
    } catch (e: any) {
      if (seq !== reqSeq.current) return
      setErr(e.message)
    } finally {
      if (seq === reqSeq.current) setBusy(false)
    }
  }, [fromJalali, toJalali, userId, thresholdDraft])

  useEffect(() => {
    void load()
    // آستانه‌ی موقت عمداً در وابستگی‌ها نیست: با دکمه‌ی «اعمال آستانه» اعمال می‌شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromJalali, toJalali, userId])

  const openDrill = async (row: PerformanceRow, skip = 0) => {
    if (!datesOk) return
    const seq = reqSeq.current
    setDrillBusy(true)
    setErr(null)
    try {
      const data = await call<TransactionsResult>(CH.staffTransactions, {
        fromJalali,
        toJalali,
        userId: row.userId,
        skip,
        take: 500
      })
      // ممیزی A88-01 — اگر در این فاصله تاریخ/کارمند عوض شد، ریز کهنه نمایش داده نمی‌شود
      if (seq !== reqSeq.current) return
      setDrill({ row, data })
      setDrillSkip(skip)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setDrillBusy(false)
    }
  }

  /** جمع ستون‌های همین جدول (جمع نمایشی؛ هیچ فرمول مالی تازه‌ای نیست) */
  const columnTotals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          salesTotal: a.salesTotal + r.salesTotal,
          invoiceCount: a.invoiceCount + r.invoiceCount,
          discountTotal: a.discountTotal + r.discountTotal,
          returnCount: a.returnCount + r.returnCount,
          returnTotal: a.returnTotal + r.returnTotal,
          exchangeCount: a.exchangeCount + r.exchangeCount,
          exchangeTotal: a.exchangeTotal + r.exchangeTotal,
          storeCreditCount: a.storeCreditCount + r.storeCreditCount,
          storeCreditTotal: a.storeCreditTotal + r.storeCreditTotal,
          storeCreditUsedCount: a.storeCreditUsedCount + r.storeCreditUsedCount,
          storeCreditUsedTotal: a.storeCreditUsedTotal + r.storeCreditUsedTotal,
          cardToCardTotal: a.cardToCardTotal + r.cardToCardTotal
        }),
        {
          salesTotal: 0,
          invoiceCount: 0,
          discountTotal: 0,
          returnCount: 0,
          returnTotal: 0,
          exchangeCount: 0,
          exchangeTotal: 0,
          storeCreditCount: 0,
          storeCreditTotal: 0,
          storeCreditUsedCount: 0,
          storeCreditUsedTotal: 0,
          cardToCardTotal: 0
        }
      ),
    [rows]
  )

  const exportPerf = async () => {
    // ممیزی A88-01 — عنوان فایل بازه‌ی فعلی است؛ حین بارگذاری/تاریخ نامعتبر، ردیف‌ها مال بازه‌ی دیگری‌اند
    if (!datesOk || busy) return
    try {
      const res = await exportTable({
        fileName: `عملکرد کارمندان ${fromJalali} تا ${toJalali}`,
        title: `عملکرد کارمندان · ${fromJalali} تا ${toJalali}`,
        headers: PERF_HEADERS,
        rows: rows.map((r) => [
          r.userName,
          r.salesTotal,
          r.invoiceCount,
          r.discountTotal,
          r.discountPercent,
          r.returnCount,
          r.returnTotal,
          r.exchangeCount,
          r.exchangeTotal,
          r.storeCreditCount,
          r.storeCreditTotal,
          r.storeCreditUsedCount,
          r.storeCreditUsedTotal,
          r.cardToCardTotal
        ])
      })
      if (!res.canceled) flash(`خروجی اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  const exportAbnormal = async () => {
    // ممیزی A88-01 — عنوان فایل بازه‌ی فعلی است؛ حین بارگذاری/تاریخ نامعتبر، ردیف‌ها مال بازه‌ی دیگری‌اند
    if (!datesOk || busy) return
    if (!abnormal) return
    try {
      const res = await exportTable({
        fileName: `تخفیف‌های غیرعادی ${fromJalali} تا ${toJalali}`,
        title: `فاکتورهای با تخفیف بالاتر از ${abnormal.threshold}٪ · ${fromJalali} تا ${toJalali}`,
        headers: ABNORMAL_HEADERS,
        rows: abnormal.rows.map((r) => [
          r.receiptNo ?? '',
          r.dateJalali,
          r.userName,
          r.shiftName ?? '',
          r.goodsTotal,
          r.discountTotal,
          r.discountPercent,
          r.grandTotal
        ])
      })
      if (!res.canceled) flash(`خروجی اکسل ساخته شد: ${res.path}`)
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-2">
      {/* ------------------- فیلتر کارمند ------------------- */}
      <div className="bg-white rounded shadow p-2 flex flex-wrap items-end gap-3">
        <label>
          <div className="mb-1 font-bold">انتخاب کارمند</div>
          <select
            className="inp min-w-[240px]"
            value={userId}
            onChange={(e) => setUserId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            <option value="">همه‌ی کارمندان</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {STAFF_ROLE_LABELS[s.role] ?? s.role}
                {s.isActive ? '' : ' (غیرفعال)'}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال خواندن…' : 'بازخوانی'}
        </button>
        <button className="btn" onClick={() => void exportPerf()} disabled={!rows.length}>
          خروجی اکسل
        </button>
        {meta && (
          <span className="kbd leading-6">
            بازه‌ی این گزارش از نوار فیلتر بالای صفحه می‌آید · {faDigits(meta.invoiceCount)} فاکتور و{' '}
            {faDigits(meta.returnCount)} برگشت/تعویض بررسی شد.
          </span>
        )}
      </div>

      {!staff.length && (
        <div className="rounded px-3 py-2 border-2 bg-amber-50 border-amber-400 leading-7">
          <b>هنوز هیچ کارمندی ثبت نشده است.</b> تا وقتی کارمندی تعریف و به‌عنوان «کارمند فعالِ پشت سیستم» انتخاب نشود،
          فاکتورها بدون نام کارمند ثبت می‌شوند و این گزارش فقط یک ردیف «نامشخص» می‌دهد. کارمندها را در{' '}
          <b>تنظیمات → کارمندان</b> تعریف کنید.
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

      {/* ------------------- کارت‌های خلاصه‌ی هر کارمند ------------------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {rows.map((r) => (
          <button
            key={String(r.userId ?? 'none')}
            className={`text-right bg-white rounded shadow p-3 border-2 hover:border-brand ${
              drill?.row.userId === r.userId ? 'border-brand' : 'border-transparent'
            }`}
            onClick={() => void openDrill(r)}
            title="برای دیدن ریز تراکنش‌های همین کارمند کلیک کنید"
          >
            <div className="font-bold mb-1">{r.userName}</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <span className="text-slate-500">جمع فروش</span>
              <span className="tabular-nums font-bold">{money(r.salesTotal)}</span>
              <span className="text-slate-500">تعداد فاکتور</span>
              <span className="tabular-nums">{faDigits(r.invoiceCount)}</span>
              <span className="text-slate-500">جمع تخفیف</span>
              <span className="tabular-nums">{money(r.discountTotal)}</span>
              <span className="text-slate-500">میانگین درصد تخفیف</span>
              <span className="tabular-nums">{pct(r.discountPercent)}</span>
              <span className="text-slate-500">برگشتی</span>
              <span className="tabular-nums">
                {faDigits(r.returnCount)} فقره · {money(r.returnTotal)}
              </span>
              <span className="text-slate-500">تعویض (کالای جایگزین)</span>
              <span className="tabular-nums">
                {faDigits(r.exchangeCount)} فقره · {money(r.exchangeTotal)}
              </span>
              <span className="text-slate-500">اعتبار خرید صادرشده</span>
              <span className="tabular-nums">
                {faDigits(r.storeCreditCount)} فقره · {money(r.storeCreditTotal)}
              </span>
              <span className="text-slate-500">مصرف اعتبار خرید</span>
              <span className="tabular-nums">
                {faDigits(r.storeCreditUsedCount)} فقره · {money(r.storeCreditUsedTotal)}
              </span>
              <span className="text-slate-500">تعهد کارت‌به‌کارت</span>
              <span className="tabular-nums">{money(r.cardToCardTotal)}</span>
            </div>
          </button>
        ))}
      </div>

      {/* ------------------- همان ردیف‌ها به شکل جدول + جمع ستون‌ها ------------------- */}
      <div className="tbl-card">
        <table className="tbl text-sm">
          <thead className="sticky top-0">
            <tr>
              {PERF_HEADERS.map((h) => (
                <th key={h} className="whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th>ریز تراکنش‌ها</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.userId ?? 'none')}>
                <td className="whitespace-nowrap font-bold">{r.userName}</td>
                <td className="tabular-nums">{money(r.salesTotal)}</td>
                <td className="tabular-nums">{faDigits(r.invoiceCount)}</td>
                <td className="tabular-nums">{money(r.discountTotal)}</td>
                <td className="tabular-nums">{pct(r.discountPercent)}</td>
                <td className="tabular-nums">{faDigits(r.returnCount)}</td>
                <td className="tabular-nums">{money(r.returnTotal)}</td>
                <td className="tabular-nums">{faDigits(r.exchangeCount)}</td>
                <td className="tabular-nums">{money(r.exchangeTotal)}</td>
                <td className="tabular-nums">{faDigits(r.storeCreditCount)}</td>
                <td className="tabular-nums">{money(r.storeCreditTotal)}</td>
                <td className="tabular-nums">{faDigits(r.storeCreditUsedCount)}</td>
                <td className="tabular-nums">{money(r.storeCreditUsedTotal)}</td>
                <td className="tabular-nums">{money(r.cardToCardTotal)}</td>
                <td>
                  <button className="btn" onClick={() => void openDrill(r)} disabled={drillBusy}>
                    نمایش
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={PERF_HEADERS.length + 1} className="text-center py-6 text-slate-500">
                  در این بازه هیچ فاکتور یا برگشتی ثبت نشده است.
                </td>
              </tr>
            )}
          </tbody>
          {!!rows.length && (
            <tfoot>
              <tr className="font-bold bg-slate-50">
                <td>جمع همه‌ی کارمندان</td>
                <td className="tabular-nums">{money(columnTotals.salesTotal)}</td>
                <td className="tabular-nums">{faDigits(columnTotals.invoiceCount)}</td>
                <td className="tabular-nums">{money(columnTotals.discountTotal)}</td>
                <td>—</td>
                <td className="tabular-nums">{faDigits(columnTotals.returnCount)}</td>
                <td className="tabular-nums">{money(columnTotals.returnTotal)}</td>
                <td className="tabular-nums">{faDigits(columnTotals.exchangeCount)}</td>
                <td className="tabular-nums">{money(columnTotals.exchangeTotal)}</td>
                <td className="tabular-nums">{faDigits(columnTotals.storeCreditCount)}</td>
                <td className="tabular-nums">{money(columnTotals.storeCreditTotal)}</td>
                <td className="tabular-nums">{faDigits(columnTotals.storeCreditUsedCount)}</td>
                <td className="tabular-nums">{money(columnTotals.storeCreditUsedTotal)}</td>
                <td className="tabular-nums">{money(columnTotals.cardToCardTotal)}</td>
                <td>—</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ------------------- ریز تراکنش‌های یک کارمند ------------------- */}
      {drill && (
        <div className="bg-white rounded shadow p-3 space-y-3 border-2 border-brand">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="font-bold">ریز تراکنش‌های «{drill.row.userName}»</div>
            <div className="flex items-center gap-2 flex-wrap">
              {drill.data.warnings?.map((warning) => (
                <span key={warning} className="text-xs text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1">
                  {warning}
                </span>
              ))}
              <button
                className="btn"
                disabled={drillBusy || drillSkip === 0}
                onClick={() => void openDrill(drill.row, Math.max(0, drillSkip - 500))}
              >
                صفحه‌ی قبل
              </button>
              <button
                className="btn"
                disabled={
                  drillBusy ||
                  !Object.values(drill.data.pages ?? {}).some((page) => page?.truncated)
                }
                onClick={() => void openDrill(drill.row, drillSkip + 500)}
              >
                صفحه‌ی بعد
              </button>
              <button className="btn" onClick={() => setDrill(null)}>
                بستن
              </button>
            </div>
          </div>

          <div>
            <div className="font-bold mb-1">فاکتورهای فروش ({faDigits(drill.data.invoices.length)} ردیف)</div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  <th>شماره فیش</th>
                  <th>تاریخ</th>
                  <th>شیفت</th>
                  <th>جمع کل</th>
                  <th>تخفیف</th>
                  <th>درصد تخفیف</th>
                  <th>وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {drill.data.invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="tabular-nums">{i.receiptNo ? faDigits(i.receiptNo) : '—'}</td>
                    <td className="tabular-nums">{faDigits(i.dateJalali)}</td>
                    <td>{i.shiftName ?? '—'}</td>
                    <td className="tabular-nums">{money(i.grandTotal)}</td>
                    <td className="tabular-nums">{money(i.discountTotal)}</td>
                    <td className="tabular-nums">{pct(i.discountPercent)}</td>
                    <td>{i.status ?? '—'}</td>
                  </tr>
                ))}
                {!drill.data.invoices.length && (
                  <tr>
                    <td colSpan={7} className="text-center py-3 text-slate-500">
                      {sectionEmpty('فاکتورهای فروش', 'invoices', 'فاکتوری در این بازه برای این کارمند نیست.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-bold mb-1">
              برگشت‌ها و تعویض‌ها ({faDigits(drill.data.returns.length)} ردیف)
            </div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  <th>نوع</th>
                  <th>شماره فیش فاکتور</th>
                  <th>تاریخ</th>
                  <th>ساعت</th>
                  <th>شیفت</th>
                  <th>مبلغ</th>
                  <th>روش تسویه</th>
                  <th>مابه‌التفاوت تعویض</th>
                  <th>شناسهٔ امن اعتبار</th>
                </tr>
              </thead>
              <tbody>
                {drill.data.returns.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{RETURN_KIND_LABELS[r.kind] ?? r.kind}</td>
                    <td className="tabular-nums">{r.receiptNo ? faDigits(r.receiptNo) : '—'}</td>
                    <td className="tabular-nums">{faDigits(r.dateJalali)}</td>
                    <td className="tabular-nums">{faDigits(r.time ?? '')}</td>
                    <td>{r.shiftName ?? '—'}</td>
                    <td className="tabular-nums">{money(r.total)}</td>
                    <td className="whitespace-nowrap">
                      {r.kind === 'EXCHANGE'
                        ? r.exchangeSettlement
                          ? EXCHANGE_SETTLEMENT_LABELS[r.exchangeSettlement] ?? r.exchangeSettlement
                          : '—'
                        : refundMethodLabel(r.refundMethod)}
                    </td>
                    <td className="tabular-nums">{r.exchangeDiff == null ? '—' : money(r.exchangeDiff)}</td>
                    <td dir="ltr">{r.storeCreditReference ?? '—'}</td>
                  </tr>
                ))}
                {!drill.data.returns.length && (
                  <tr>
                    <td colSpan={9} className="text-center py-3 text-slate-500">
                      {sectionEmpty('برگشت‌ها و تعویض‌ها', 'returns', 'برگشت یا تعویضی در این بازه برای این کارمند نیست.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-bold mb-1">
              مصرف اعتبار خرید ({faDigits(drill.data.creditRedemptions.length)} ردیف)
            </div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  <th>شناسهٔ امن مصرف اعتبار</th>
                  <th>شماره فیش</th>
                  <th>مبلغ مصرف‌شده</th>
                  <th>تاریخ</th>
                  <th>ساعت</th>
                </tr>
              </thead>
              <tbody>
                {drill.data.creditRedemptions.map((c) => (
                  <tr key={c.id}>
                    <td dir="ltr">{c.storeCreditReference || '—'}</td>
                    <td className="tabular-nums">{c.receiptNo ? faDigits(c.receiptNo) : '—'}</td>
                    <td className="tabular-nums">{money(c.amount)}</td>
                    <td className="tabular-nums">{faDigits(c.atJalali ?? '')}</td>
                    <td className="tabular-nums">{faDigits(c.atTime ?? '')}</td>
                  </tr>
                ))}
                {!drill.data.creditRedemptions.length && (
                  <tr>
                    <td colSpan={5} className="text-center py-3 text-slate-500">
                      {sectionEmpty('مصرف اعتبار خرید', 'creditRedemptions', 'مصرف اعتباری در این بازه برای این کارمند نیست.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div>
            <div className="font-bold mb-1">
              درخواست‌های کارت‌به‌کارت ({faDigits(drill.data.cardTransfers.length)} ردیف)
            </div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  <th>شماره درخواست</th>
                  <th>نوع ردیف</th>
                  <th>وضعیت</th>
                  <th>شماره فاکتور اصلی</th>
                  <th>مبلغ</th>
                  <th>مبلغ پرداخت‌شده</th>
                  <th>تاریخ</th>
                  <th>ساعت</th>
                </tr>
              </thead>
              <tbody>
                {drill.data.cardTransfers.map((t) => (
                  <tr key={t.id}>
                    <td className="tabular-nums">{faDigits(t.id)}</td>
                    <td>{t.kind === 'ADJUSTMENT' ? 'رویداد اصلاحی' : 'درخواست پرداخت'}</td>
                    <td>{t.status === 'PAID' ? 'پرداخت شد' : t.status === 'PENDING' ? 'در انتظار پرداخت' : 'اصلاح‌شده'}</td>
                    <td className="tabular-nums">{t.sourceReceiptNo ? faDigits(t.sourceReceiptNo) : '—'}</td>
                    <td className="tabular-nums">{money(t.amount)}</td>
                    <td className="tabular-nums">{t.paidAmount == null ? '—' : money(t.paidAmount)}</td>
                    <td className="tabular-nums">{faDigits(t.dateJalali ?? '')}</td>
                    <td className="tabular-nums">{faDigits(t.time ?? '')}</td>
                  </tr>
                ))}
                {!drill.data.cardTransfers.length && (
                  <tr>
                    <td colSpan={8} className="text-center py-3 text-slate-500">
                      {sectionEmpty('درخواست‌های کارت‌به‌کارت', 'cardTransfers', 'درخواست کارت‌به‌کارتی در این بازه برای این کارمند نیست.')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =====================================================================
          بند ۳ — «تخفیف‌های غیرعادی»
          آستانه از تنظیمات (accounting.policy) می‌آید. این کادر هیچ چیزی را
          مسدود نمی‌کند: فقط نشان می‌دهد کدام فاکتور، توسط کدام کارمند و در چه
          تاریخی تخفیف بالاتر از آستانه خورده است.
         ===================================================================== */}
      <div className="bg-white rounded shadow p-3 border-2 border-amber-400 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="font-bold text-amber-900">تخفیف‌های غیرعادی</div>
          <div className="flex items-end gap-2 flex-wrap">
            <label>
              <div className="kbd">آستانه‌ی درصد تخفیف (خالی = آستانه‌ی تنظیمات)</div>
              <input
                dir="ltr"
                className="inp w-28 text-center tabular-nums"
                value={thresholdDraft}
                onChange={(e) => setThresholdDraft(e.target.value.replace(/[^\d]/g, ''))}
                placeholder={abnormal ? String(abnormal.threshold) : '30'}
              />
            </label>
            <button className="btn" onClick={() => void load()} disabled={busy}>
              اعمال آستانه
            </button>
            <button className="btn" onClick={() => void exportAbnormal()} disabled={!abnormal?.rows.length}>
              خروجی اکسل
            </button>
          </div>
        </div>

        {abnormal?.disabled && (
          <div className="rounded px-3 py-2 border bg-slate-50 border-slate-300 leading-7">
            آستانه‌ی تخفیف غیرعادی روی <b>صفر</b> است، یعنی این هشدار خاموش است. عمداً «همه‌ی فاکتورها غیرعادی» نشان داده
            نمی‌شود. برای روشن کردنش، یک درصد در <b>تنظیمات → سیاست حسابداری</b> بگذارید.
          </div>
        )}

        {abnormal && !abnormal.disabled && (
          <>
            <div className="kbd leading-6">
              آستانه‌ی فعلی: <b>{pct(abnormal.threshold)}</b> · {faDigits(abnormal.rows.length)} فاکتور بالاتر از آستانه
              {userId !== '' ? ' (فقط کارمند انتخاب‌شده)' : ''}. درصد تخفیف هر فاکتور با همان فرمول
              `accounting.ts` حساب می‌شود، نه با یک فرمول جدا.
            </div>
            <table className="tbl text-sm">
              <thead>
                <tr>
                  {ABNORMAL_HEADERS.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {abnormal.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tabular-nums">{r.receiptNo ? faDigits(r.receiptNo) : '—'}</td>
                    <td className="tabular-nums">{faDigits(r.dateJalali)}</td>
                    <td className="font-bold">{r.userName}</td>
                    <td>{r.shiftName ?? '—'}</td>
                    <td className="tabular-nums">{money(r.goodsTotal)}</td>
                    <td className="tabular-nums">{money(r.discountTotal)}</td>
                    <td className="tabular-nums font-bold text-amber-900">{pct(r.discountPercent)}</td>
                    <td className="tabular-nums">{money(r.grandTotal)}</td>
                  </tr>
                ))}
                {!abnormal.rows.length && (
                  <tr>
                    <td colSpan={ABNORMAL_HEADERS.length} className="text-center py-4 text-slate-500">
                      هیچ فاکتوری با تخفیف بالاتر از {pct(abnormal.threshold)} در این بازه نیست.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}

/** تب «عملکرد کارمندان» — قفل مستقل خودش را دارد (`PANEL_KEYS.staffPerformance`). */
export default function StaffPerformancePanel({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  return (
    <ManagerGate
      panel={PANEL_KEYS.staffPerformance}
      title="عملکرد کارمندان"
      reason="این بخش فروش، تخفیف، برگشت و اعتبار خرید هر کارمند را کنار هم نشان می‌دهد، پس با رمز مدیر (یا رمز دوم اختصاصی همین بخش) باز می‌شود."
      inline
    >
      <Body fromJalali={fromJalali} toJalali={toJalali} />
    </ManagerGate>
  )
}
