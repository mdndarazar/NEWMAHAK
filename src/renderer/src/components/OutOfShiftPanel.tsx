import { useCallback, useEffect, useRef, useState } from 'react'
import { createLatestGate } from '@shared/latestRequest'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import { faDigits, money } from '@shared/jalali'

/**
 * ===========================================================================
 * جلسه ۱۸ · بند ۶ (لایه‌ی UI) — «تراکنش‌های خارج از بازه‌ی شیفت».
 *
 * `StaffReportService.outOfShift` از جلسه ۱۷ آماده بود و هیچ صفحه‌ای نداشت.
 *
 * دو نکته‌ی عمدی:
 *   ۱) این فهرست فقط وقتی معنی دارد که چک‌باکس «تعیین شیفت بر اساس ساعت» روشن
 *      باشد. در حالت شماره‌گذاری خودکار، «بازه‌ی ساعتی» وجود ندارد که چیزی
 *      بیرونش بیفتد؛ خودِ سرور هم در آن حالت عمداً هیچ ردیفی نمی‌دهد و دلیلش را
 *      می‌گوید. این صفحه همان دلیل را عیناً نشان می‌دهد و هیچ هشدار الکی‌ای
 *      نمی‌سازد.
 *   ۲) هیچ قضاوتی نمی‌شود: فقط ساعت ثبت و بازه‌های تعریف‌شده کنار هم گذاشته
 *      می‌شوند.
 *
 * IPC: staff:outOfShift
 * ===========================================================================
 */

interface OutOfShiftRow {
  kind: string
  kindLabel: string
  id: number
  receiptNo: number | null
  amount: number
  dateJalali: string
  time: string
  shiftName: string | null
  /** جلسه ۱۹ — «شیفت شب — نشست ۲» */
  sessionLabel?: string | null
  nameOverridden?: boolean
  /** NO_WINDOW = ساعت در هیچ بازه‌ای نیست · SESSION_MISMATCH = با بازه‌ی نام نشست نمی‌خواند */
  reason?: string
  reasonLabel?: string
  sessionWindow?: string | null
  userName: string
}

interface OutOfShiftResult {
  byTime: boolean
  windows: { name: string; label: string; startTime: string; endTime: string }[]
  rows: OutOfShiftRow[]
  note: string
}

const HEADERS = [
  'نوع تراکنش',
  'شماره سند',
  'شماره فیش فاکتور',
  'تاریخ',
  'ساعت ثبت',
  'نشست ثبت‌شده',
  'بازه‌ی نام نشست',
  'دلیل هشدار',
  'کارمند',
  'مبلغ'
]

export default function OutOfShiftPanel({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  const [data, setData] = useState<OutOfShiftResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  /**
   * نشست ۱۷۴ · مشاهده‌ی P3 ممیزی ۸۸ (الگوی A88-01) — فقط پاسخ آخرین درخواست روی جدول می‌نشیند؛
   * با عوض‌شدن بازه، ردیف‌های بازه‌ی قبلی فوراً پاک می‌شوند و Excel حین بارگذاری بسته است، تا عدد
   * بازه‌ی دیگر زیر عنوان بازه‌ی فعلی نه دیده شود نه خروجی گرفته شود.
   */
  const gate = useRef(createLatestGate()).current
  const loadedRange = useRef<string | null>(null)
  const load = useCallback(async () => {
    const seq = gate.next()
    const rangeKey = `${fromJalali}|${toJalali}`
    if (loadedRange.current !== rangeKey) setData(null)
    setBusy(true)
    setErr(null)
    try {
      const res = await call<OutOfShiftResult>(CH.staffOutOfShift, { fromJalali, toJalali })
      if (!gate.isLatest(seq)) return
      loadedRange.current = rangeKey
      setData(res)
    } catch (e: any) {
      if (gate.isLatest(seq)) setErr(e.message)
    } finally {
      if (gate.isLatest(seq)) setBusy(false)
    }
  }, [fromJalali, toJalali])

  useEffect(() => {
    void load()
  }, [load])

  const exportRows = async () => {
    if (!data || busy) return
    try {
      const res = await exportTable({
        fileName: `تراکنش‌های خارج از بازه‌ی شیفت ${fromJalali} تا ${toJalali}`,
        title: `تراکنش‌های خارج از بازه‌ی شیفت رسمی · ${fromJalali} تا ${toJalali}`,
        headers: HEADERS,
        rows: data.rows.map((r) => [
          r.kindLabel,
          r.id,
          r.receiptNo ?? '',
          r.dateJalali,
          r.time,
          r.sessionLabel ?? r.shiftName ?? '',
          r.sessionWindow ?? '',
          r.reasonLabel ?? '',
          r.userName,
          r.amount
        ])
      })
      if (!res.canceled) {
        setMsg(`خروجی اکسل ساخته شد: ${res.path}`)
        window.setTimeout(() => setMsg(null), 6000)
      }
    } catch (e: any) {
      setErr(e.message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="bg-white rounded shadow p-2 flex flex-wrap items-center gap-3">
        <h2 className="font-bold">تراکنش‌های خارج از بازه‌ی شیفت</h2>
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال خواندن…' : 'بازخوانی'}
        </button>
        <button className="btn" onClick={() => void exportRows()} disabled={busy || !data?.rows.length}>
          خروجی اکسل
        </button>
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

      {data && !data.byTime && (
        <div className="rounded px-3 py-2 border-2 bg-slate-50 border-slate-300 leading-7 whitespace-pre-line">
          <b>این هشدار همین حالا لازم نیست.</b>
          {'\n'}
          {data.note}
        </div>
      )}

      {data?.byTime && (
        <>
          <div className="bg-white rounded shadow p-3 space-y-1">
            <div className="font-bold">بازه‌های ساعتی تعریف‌شده‌ی شیفت‌ها</div>
            <div className="flex flex-wrap gap-2">
              {data.windows.map((w, i) => (
                <span key={`${w.name}-${i}`} className="rounded border border-slate-300 bg-slate-50 px-2 py-1">
                  {w.name}: <span dir="ltr" className="tabular-nums">{faDigits(w.label)}</span>
                </span>
              ))}
              {!data.windows.length && (
                <span className="kbd">هیچ بازه‌ی ساعتی‌ای تعریف نشده است (تنظیمات → شیفت‌ها).</span>
              )}
            </div>
            <div className="kbd leading-6 whitespace-pre-line">{data.note}</div>
          </div>

          <div className="tbl-card">
            <table className="tbl text-sm">
              <thead className="sticky top-0">
                <tr>
                  {HEADERS.map((h) => (
                    <th key={h} className="whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`}>
                    <td className="whitespace-nowrap font-bold">{r.kindLabel}</td>
                    <td className="tabular-nums">{faDigits(r.id)}</td>
                    <td className="tabular-nums">{r.receiptNo ? faDigits(r.receiptNo) : '—'}</td>
                    <td className="tabular-nums">{faDigits(r.dateJalali ?? '')}</td>
                    <td dir="ltr" className="tabular-nums text-rose-800 font-bold">
                      {faDigits(r.time ?? '')}
                    </td>
                    <td className="whitespace-nowrap">
                      {r.sessionLabel ?? r.shiftName ?? '—'}
                      {r.nameOverridden && <div className="kbd">نام این نشست دستی override شده بود</div>}
                    </td>
                    <td dir="ltr" className="tabular-nums">
                      {r.sessionWindow ? faDigits(r.sessionWindow) : '—'}
                    </td>
                    <td className="whitespace-normal">{r.reasonLabel ?? '—'}</td>
                    <td>{r.userName}</td>
                    <td className="tabular-nums">{money(r.amount)}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td colSpan={HEADERS.length} className="text-center py-6 text-emerald-800">
                      هیچ تراکنشی خارج از بازه‌های ساعتی تعریف‌شده ثبت نشده است.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
