import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import JalaliDateInput from '../components/JalaliDateInput'
import ConfirmDialog from '../components/ConfirmDialog'
import { faDigits, money, isValidJalaliDate, jalaliToday, jalaliMonthStart } from '@shared/jalali'
import type { ConsolidationDay, ConsolidationDaysResult, SaleReportResult } from '@shared/types'

/**
 * ===================== تجمیع و انتقال =====================
 * این پنل «کسر نهایی انبار» را انجام می‌دهد.
 *
 * در طول روز هر فروش، موجودی را فوراً کم می‌کند اما حرکت انبارش «موقت»
 * (PENDING) است. با تجمیع، حرکات آن روز «قطعی» (FINAL) می‌شوند، به یک رکورد
 * تجمیع گره می‌خورند و فاکتورهای همان روز علامت می‌خورند تا **دوباره تجمیع
 * نشوند**. یعنی زدن دوباره‌ی این دکمه هیچ‌وقت موجودی را دو بار کم نمی‌کند.
 *
 * تجمیع با تأخیر (خواسته‌ی اصلی):
 *   اگر شیفت آخر یادش برود تجمیع بزند، فردا یا هفته‌ی بعد هم می‌شود. یک بازه
 *   انتخاب کنید (مثلاً از اول ماه تا امروز) و جدول بالا نشان می‌دهد هر روز
 *   «تجمیع شده» است یا «تجمیع نشده». روزهای عقب‌افتاده را یکی‌یکی یا همه را
 *   یک‌جا تجمیع کنید؛ هر روز رکورد تجمیع خودش را می‌گیرد.
 *
 * IPC: consolidation:days · consolidation:finalizeDays · sale:report:rows ·
 *      consolidation:list · system:exportCsv
 * ==========================================================
 */

const DAY_HEADERS = [
  'تاریخ',
  'وضعیت',
  'تعداد فاکتور',
  'فاکتور تجمیع‌نشده',
  'شیفت‌ها',
  'جمع مبلغ کالا',
  'جمع کل فروش',
  'دریافتی',
  'تعداد قابل انتقال',
  'تاریخ تجمیع'
]

const SALE_HEADERS = [
  'شماره فیش فروش',
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
  'جمع دریافتی',
  'جمع مبلغ برگشت'
]

export default function Consolidation() {
  const nav = useNavigate()
  const [from, setFrom] = useState(jalaliMonthStart())
  const [to, setTo] = useState(jalaliToday())
  const [days, setDays] = useState<ConsolidationDaysResult | null>(null)
  const [report, setReport] = useState<SaleReportResult | null>(null)
  const [history, setHistory] = useState<any[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [byShift, setByShift] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string[] | null>(null)

  const flash = (m: string) => {
    setMsg(m)
    setErr(null)
    window.setTimeout(() => setMsg((c) => (c === m ? null : c)), 12000)
  }

  const loadRange = useCallback(async (fromJalali: string, toJalali: string) => {
    if (!isValidJalaliDate(fromJalali) || !isValidJalaliDate(toJalali)) return setErr('بازه‌ی تاریخ معتبر نیست')
    setBusy(true)
    setErr(null)
    try {
      const [d, r, h] = await Promise.all([
        call<ConsolidationDaysResult>(CH.consolidationDays, { fromJalali, toJalali }),
        call<SaleReportResult>(CH.saleReportRows, { fromJalali, toJalali }),
        call<any[]>(CH.consolidationList, { fromJalali, toJalali })
      ])
      setDays(d)
      setReport(r)
      setHistory(h)
      // پیش‌فرض: همه‌ی روزهای تجمیع‌نشده تیک‌خورده‌اند (کار شیفت آخر ساده شود)
      setPicked(new Set(d.pendingDays))
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  /** بررسی همان بازه‌ای که در فیلدهای بالا نوشته شده است. */
  const load = useCallback(() => loadRange(from, to), [loadRange, from, to])

  /** میان‌برهای بازه («امروز» / «از اول ماه تا امروز») هم بی‌درنگ گزارش می‌گیرند. */
  const pickRange = useCallback(
    (fromJalali: string, toJalali: string) => {
      setFrom(fromJalali)
      setTo(toJalali)
      void loadRange(fromJalali, toJalali)
    },
    [loadRange]
  )

  useEffect(() => {
    void loadRange(from, to)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pendingDays = useMemo(() => days?.days.filter((d) => d.pendingInvoiceCount > 0) ?? [], [days])
  const selectedDays = useMemo(() => pendingDays.filter((d) => picked.has(d.dayJalali)), [pendingDays, picked])
  const selectedTotals = useMemo(
    () => ({
      days: selectedDays.length,
      invoices: selectedDays.reduce((s, d) => s + d.pendingInvoiceCount, 0),
      qty: selectedDays.reduce((s, d) => s + d.pendingQty, 0),
      grandTotal: selectedDays.reduce((s, d) => s + d.grandTotal, 0)
    }),
    [selectedDays]
  )

  const toggleDay = (day: string) =>
    setPicked((p) => {
      const next = new Set(p)
      next.has(day) ? next.delete(day) : next.add(day)
      return next
    })

  const runConsolidation = async (dayList: string[]) => {
    setConfirm(null)
    if (!dayList.length) return setErr('روزی برای تجمیع انتخاب نشده است.')
    setBusy(true)
    try {
      const res = await call<any>(CH.consolidationFinalizeDays, { days: dayList })
      flash(
        `تجمیع و انتقال انجام شد · ${faDigits(res.done.length)} روز · ${faDigits(res.invoiceCount)} فاکتور · ` +
          `${faDigits(res.finalizedMovements)} حرکت انبار قطعی شد · جمع ${money(res.grandTotal)} ریال` +
          (res.skipped.length
            ? `\n${faDigits(res.skipped.length)} روز رد شد چون فاکتور تجمیع‌نشده‌ای نداشت: ${res.skipped
                .map((d: string) => faDigits(d))
                .join('، ')}`
            : '')
      )
      await load()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const stateClass = (d: ConsolidationDay) =>
    d.state === 'DONE'
      ? 'text-emerald-700 font-bold'
      : d.state === 'PENDING'
        ? 'text-amber-700 font-bold'
        : d.state === 'PARTIAL'
          ? 'text-orange-700 font-bold'
          : 'text-slate-400'

  /** جمع ستون‌های جدول «وضعیت تجمیع روزهای بازه» (ردیف پایین همان جدول). */
  const dayTotals = useMemo(() => {
    const list = days?.days ?? []
    return {
      days: list.length,
      pending: list.filter((d) => d.pendingInvoiceCount > 0).length,
      invoiceCount: list.reduce((s, d) => s + d.invoiceCount, 0),
      pendingInvoiceCount: list.reduce((s, d) => s + d.pendingInvoiceCount, 0),
      shiftCount: list.reduce((s, d) => s + d.shiftCount, 0),
      goodsTotal: list.reduce((s, d) => s + d.goodsTotal, 0),
      grandTotal: list.reduce((s, d) => s + d.grandTotal, 0),
      receivedTotal: list.reduce((s, d) => s + d.receivedTotal, 0),
      pendingQty: list.reduce((s, d) => s + d.pendingQty, 0)
    }
  }, [days])

  const t = report?.totals

  return (
    <div className="page">
      <div className="bg-white rounded shadow p-2 flex items-center gap-2 flex-wrap">
        <h1 className="text-lg font-bold">تجمیع و انتقال</h1>
        <span className="kbd">کسر نهایی موجودی انبار برای فروش‌های هر روز · هر روز فقط یک بار</span>
        <div className="ms-auto flex gap-1 flex-wrap">
          <button className="btn" onClick={() => nav('/cash-close')}>
            بستن صندوق <span className="keycap">F10</span>
          </button>
          <button className="btn" onClick={() => nav('/sales-reports')}>
            گزارشات فروش <span className="keycap">F9</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded shadow p-2 flex flex-wrap gap-3 items-end">
        <div>
          <div className="mb-1">از تاریخ</div>
          <JalaliDateInput value={from} onChange={setFrom} />
        </div>
        <div>
          <div className="mb-1">تا تاریخ</div>
          <JalaliDateInput value={to} onChange={setTo} />
        </div>
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال بررسی…' : 'بررسی روزهای بازه'}
        </button>
        <div className="flex gap-1">
          <button
            className="btn"
            onClick={() => pickRange(jalaliToday(), jalaliToday())}
          >
            امروز
          </button>
          <button
            className="btn"
            onClick={() => pickRange(jalaliMonthStart(), jalaliToday())}
          >
            از اول ماه تا امروز
          </button>
        </div>
        <label className="flex items-center gap-2 pb-2 font-bold">
          <input type="checkbox" className="w-4 h-4" checked={byShift} onChange={(e) => setByShift(e.target.checked)} />
          جدا سازی بر اساس شیفت
        </label>
        {days && (
          <div className="kbd">
            {faDigits(days.totals.days)} روز بررسی شد · {faDigits(days.totals.done)} روز تجمیع‌شده ·{' '}
            <b className={days.totals.pending ? 'text-amber-700' : ''}>{faDigits(days.totals.pending)} روز تجمیع‌نشده</b>
          </div>
        )}
      </div>

      {(msg || err) && (
        <div
          className={`rounded px-3 py-2 border whitespace-pre-line ${
            err ? 'bg-amber-100 border-amber-300' : 'bg-emerald-50 border-emerald-300'
          }`}
        >
          {err ?? msg}
        </div>
      )}

      {/* ---------------- وضعیت روزهای بازه ---------------- */}
      <div className="tbl-card">
        <div className="p-2 font-bold border-b flex items-center gap-2 flex-wrap">
          وضعیت تجمیع روزهای بازه
          <span className="kbd">روزهای «تجمیع نشده» را تیک بزنید و «تجمیع فاکتورها» را بزنید</span>
          <div className="ms-auto flex gap-1">
            <button className="btn" onClick={() => setPicked(new Set(pendingDays.map((d) => d.dayJalali)))}>
              انتخاب همه‌ی روزهای تجمیع‌نشده
            </button>
            <button className="btn" onClick={() => setPicked(new Set())}>
              پاک کردن انتخاب
            </button>
          </div>
        </div>
        <table className="tbl">
          <thead className="sticky top-0">
            <tr>
              <th className="w-8"></th>
              {DAY_HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(days?.days ?? []).map((d) => (
              <tr
                key={d.dayJalali}
                className={d.state === 'PENDING' ? 'bg-amber-50' : d.state === 'PARTIAL' ? 'bg-orange-50' : ''}
              >
                <td className="text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4"
                    disabled={!d.pendingInvoiceCount}
                    checked={picked.has(d.dayJalali)}
                    onChange={() => toggleDay(d.dayJalali)}
                  />
                </td>
                <td className="font-bold">{faDigits(d.dayJalali)}</td>
                <td className={stateClass(d)}>{d.stateLabel}</td>
                <td className="text-center">{faDigits(d.invoiceCount)}</td>
                <td className="text-center">{faDigits(d.pendingInvoiceCount)}</td>
                <td className="text-center">{faDigits(d.shiftCount)}</td>
                <td>{money(d.goodsTotal)}</td>
                <td className="font-bold">{money(d.grandTotal)}</td>
                <td>{money(d.receivedTotal)}</td>
                <td className="text-center">{faDigits(d.pendingQty)}</td>
                <td>
                  {d.finalizedAtJalali ? faDigits(d.finalizedAtJalali) : '—'}
                  {/* بخش ۳: ساعت دقیق قطعی‌شدن، کنار تاریخ شمسی */}
                  {d.finalizedAtTime ? <b className="ms-1">{faDigits(d.finalizedAtTime)}</b> : ''}
                </td>
                <td>
                  {d.pendingInvoiceCount ? (
                    <button className="text-brand font-bold" onClick={() => setConfirm([d.dayJalali])} disabled={busy}>
                      تجمیع همین روز
                    </button>
                  ) : (
                    <span className="kbd">—</span>
                  )}
                </td>
              </tr>
            ))}
            {!days?.days.length && (
              <tr>
                <td colSpan={DAY_HEADERS.length + 2} className="text-center py-8 text-slate-400">
                  بازه‌ای انتخاب کنید و «بررسی روزهای بازه» را بزنید
                </td>
              </tr>
            )}
          </tbody>
          {/* جمع ستون‌های همین جدول. قبلاً این ردیف زیر لبه‌ی جدول می‌افتاد و
              نیمه‌پنهان می‌ماند؛ حالا چسبیده به پایین جدول و کامل دیده می‌شود. */}
          {!!days?.days.length && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-100 font-bold">
                <td></td>
                <td>جمع {faDigits(dayTotals.days)} روز</td>
                <td>{faDigits(dayTotals.pending)} روز تجمیع‌نشده</td>
                <td className="text-center">{faDigits(dayTotals.invoiceCount)}</td>
                <td className="text-center">{faDigits(dayTotals.pendingInvoiceCount)}</td>
                <td className="text-center">{faDigits(dayTotals.shiftCount)}</td>
                <td>{money(dayTotals.goodsTotal)}</td>
                <td>{money(dayTotals.grandTotal)}</td>
                <td>{money(dayTotals.receivedTotal)}</td>
                <td className="text-center">{faDigits(dayTotals.pendingQty)}</td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* ---------------- فاکتورهای بازه ---------------- */}
      <div className="tbl-card">
        <table className="tbl">
          <thead className="sticky top-0">
            <tr>
              {SALE_HEADERS.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byShift
              ? (report?.groups ?? []).map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-brand/15 font-bold">
                      <td colSpan={SALE_HEADERS.length}>
                        {faDigits(g.dayJalali)} · {g.shiftName} · {faDigits(g.totals.count)} فاکتور · جمع{' '}
                        {money(g.totals.grandTotal)} ریال
                      </td>
                    </tr>
                    {g.rows.map((r) => (
                      <SaleRow key={r.id} r={r} />
                    ))}
                  </Fragment>
                ))
              : (report?.rows ?? []).map((r) => <SaleRow key={r.id} r={r} />)}
            {!report?.rows.length && (
              <tr>
                <td colSpan={SALE_HEADERS.length} className="text-center py-10 text-slate-400">
                  در این بازه فاکتوری ثبت نشده است
                </td>
              </tr>
            )}
          </tbody>
          {!!report?.rows.length && t && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-slate-100 font-bold">
                <td colSpan={7}>جمع {faDigits(t.count)} فاکتور</td>
                <td>{money(t.goodsTotal)}</td>
                <td>{money(t.taxTotal)}</td>
                <td>{money(t.serviceTotal)}</td>
                <td>{money(t.discountTotal)}</td>
                <td>{money(t.deliveryTotal)}</td>
                <td>{money(t.grandTotal)}</td>
                <td>{money(t.receivedTotal)}</td>
                <td>{money(t.returnedTotal)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="flex gap-2 flex-wrap items-center">
        <button
          className="btn btn-primary"
          onClick={() => setConfirm(selectedDays.map((d) => d.dayJalali))}
          disabled={busy || !selectedDays.length}
        >
          تجمیع فاکتورها
          {selectedDays.length ? ` (${faDigits(selectedDays.length)} روز)` : ''}
        </button>
        <button
          className="btn"
          onClick={() => setConfirm(pendingDays.map((d) => d.dayJalali))}
          disabled={busy || !pendingDays.length}
        >
          تجمیع همه‌ی روزهای عقب‌افتاده ({faDigits(pendingDays.length)})
        </button>
        <button
          className="btn"
          onClick={() =>
            void exportTable({
              fileName: 'تجمیع-و-انتقال',
              sheetName: 'تجمیع و انتقال',
              title: `تجمیع و انتقال — از ${from} تا ${to}`,
              headers: DAY_HEADERS,
              rows: (days?.days ?? []).map((d) => [
                d.dayJalali,
                d.stateLabel,
                d.invoiceCount,
                d.pendingInvoiceCount,
                d.shiftCount,
                d.goodsTotal,
                d.grandTotal,
                d.receivedTotal,
                d.pendingQty,
                d.finalizedAtJalali ?? ''
              ])
            })
              .then((r) => flash(r.canceled ? 'ساخت فایل خروجی لغو شد.' : `فایل اکسل ساخته شد: ${r.path}`))
              .catch((e: any) => setErr(e.message))
          }
          disabled={!days?.days.length}
        >
          خروجی اکسل
        </button>
        <div className="kbd">
          انتخاب فعلی: {faDigits(selectedTotals.days)} روز · {faDigits(selectedTotals.invoices)} فاکتور ·{' '}
          {faDigits(selectedTotals.qty)} عدد کالا برای کسر قطعی از انبار · جمع {money(selectedTotals.grandTotal)} ریال
        </div>
      </div>

      {/* ---------------- سابقه‌ی تجمیع ---------------- */}
      <div className="tbl-card">
        <div className="p-2 font-bold border-b sticky top-0 bg-white z-20">سابقه‌ی تجمیع‌های این بازه</div>
        {/* نشست ۱۱۴ · بند ۴-۴۶ — هشدار صریح برش سابقه (قبلاً بی‌صدا روی ۲۰۰ ردیف بریده می‌شد) */}
        {(((history as any).warnings as string[] | undefined) ?? []).length > 0 && (
          <div className="p-2 bg-rose-50 text-rose-800 font-bold border-b">
            ⚠ {((history as any).warnings as string[]).join(' ')}
          </div>
        )}
        <table className="tbl">
          <thead className="sticky top-9 bg-white z-10">
            <tr>
              <th>شماره تجمیع</th>
              <th>روز</th>
              <th>تعداد فاکتور</th>
              <th>حرکات قطعی‌شده</th>
              <th>جمع مبلغ کالا</th>
              <th>جمع کل فروش</th>
              <th>دریافتی</th>
              <th>تاریخ تجمیع</th>
              {/* بخش ۳: ساعت قطعی‌شدن تجمیع (از CashboxService.list → finalizedAtTime) */}
              <th>ساعت</th>
            </tr>
          </thead>
          <tbody>
            {history.map((c) => (
              <tr key={c.id}>
                <td className="font-bold">{faDigits(c.id)}</td>
                <td>{faDigits(c.dayJalali)}</td>
                <td className="text-center">{faDigits(c.invoiceCount)}</td>
                <td className="text-center">{faDigits(c.movementCount)}</td>
                <td>{money(c.goodsTotal)}</td>
                <td className="font-bold">{money(c.grandTotal)}</td>
                <td>{money(c.receivedTotal)}</td>
                <td>{c.finalizedAtJalali ? faDigits(c.finalizedAtJalali) : '—'}</td>
                <td className="font-bold">{c.finalizedAtTime ? faDigits(c.finalizedAtTime) : '—'}</td>
              </tr>
            ))}
            {!history.length && (
              <tr>
                <td colSpan={9} className="text-center py-6 text-slate-400">
                  در این بازه تجمیعی ثبت نشده است
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!confirm}
        title="تجمیع و انتقال (کسر قطعی انبار)"
        message={
          <div className="space-y-2">
            <p>
              فروش‌های <b>{faDigits(confirm?.length ?? 0)}</b> روز
              {confirm?.length === 1 ? ` (${faDigits(confirm[0])})` : ''} تجمیع می‌شود و کسر موجودی انبار برای آن
              روز(ها) <b>قطعی</b> می‌گردد.
            </p>
            <p className="kbd">
              فاکتورهای همان روزها به این تجمیع گره می‌خورند، پس دوباره تجمیع نمی‌شوند و موجودی دو بار کم نخواهد شد.
              بعد از این نقطه، تنها راه بازگشت موجودی «برگشت از فروش» است.
            </p>
            {confirm && confirm.length > 1 && (
              <p className="kbd">روزها: {confirm.map((d) => faDigits(d)).join('، ')}</p>
            )}
          </div>
        }
        confirmLabel="بله، تجمیع کن"
        busy={busy}
        onConfirm={() => void runConsolidation(confirm ?? [])}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}

function SaleRow({ r }: { r: SaleReportResult['rows'][number] }) {
  return (
    <tr className={r.consolidated ? '' : 'bg-amber-50/60'}>
      <td className="font-bold">{faDigits(r.receiptNo)}</td>
      <td>{faDigits(r.dateJalali)}</td>
      <td>{faDigits(r.time)}</td>
      <td>{r.shiftName}</td>
      <td>{r.customerName}</td>
      <td className={r.consolidated ? 'text-emerald-700' : 'text-amber-700'}>{r.statusLabel}</td>
      <td>{r.orderTypeLabel}</td>
      <td>{money(r.goodsTotal)}</td>
      <td>{money(r.taxTotal)}</td>
      <td>{money(r.serviceCharge)}</td>
      <td>{money(r.discountTotal)}</td>
      <td>{money(r.deliveryFee)}</td>
      <td className="font-bold">{money(r.grandTotal)}</td>
      <td>{money(r.receivedTotal)}</td>
      <td className={r.returnedTotal ? 'text-rose-700 font-bold' : ''}>{money(r.returnedTotal)}</td>
    </tr>
  )
}
