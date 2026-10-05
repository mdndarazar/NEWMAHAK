import { useCallback, useEffect, useRef, useState } from 'react'
import { createLatestGate } from '@shared/latestRequest'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import { faDigits } from '@shared/jalali'

/**
 * ===========================================================================
 * جلسه ۱۹ · بند ۲ — گزارش مستقل «نشست‌های با نام override‌شده».
 *
 * هر نشستی که نام نهایی‌اش با نام پیشنهادی سیستم (بر اساس ساعت) فرق داشته،
 * همراه با نام پیشنهادی، نام نهایی، دلیلِ ثبت‌شده، کارمند و زمان. یک سیگنال
 * کنترل داخلی برای مدیر است: هیچ‌کس را متهم نمی‌کند و هیچ چیزی را مسدود نمی‌کند.
 *
 * ⚠️ override کردن نام نشست، هشدار «تراکنش‌های خارج از بازه‌ی شیفت» را خاموش
 * نمی‌کند؛ آن گزارش مستقل و سر جای خودش است.
 *
 * IPC: shift:overrides
 * ===========================================================================
 */

const HEADERS = [
  'تاریخ',
  'نشست',
  'نام نهایی',
  'بازه‌ی نام نهایی',
  'نام پیشنهادی سیستم',
  'بازه‌ی پیشنهادی',
  'کارمند',
  'ساعت شروع',
  'ساعت پایان',
  'دلیل ثبت‌شده'
]

export default function OverrideSessionsPanel({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  const [data, setData] = useState<any | null>(null)
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
      const res = await call<any>(CH.shiftOverrides, { fromJalali, toJalali })
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

  const rows: any[] = data?.rows ?? []

  return (
    <div className="space-y-2">
      <div className="bg-white rounded shadow p-2 flex flex-wrap items-center gap-3">
        <h2 className="font-bold">نشست‌های با نام override‌شده</h2>
        <button className="btn btn-primary" onClick={() => void load()} disabled={busy}>
          {busy ? 'در حال خواندن…' : 'بازخوانی'}
        </button>
        <button
          className="btn"
          disabled={busy || !rows.length}
          onClick={() =>
            void exportTable({
              fileName: `نشست‌های override‌شده ${fromJalali} تا ${toJalali}`,
              title: `نشست‌های با نام override‌شده · ${fromJalali} تا ${toJalali}`,
              headers: HEADERS,
              rows: rows.map((r) => [
                r.dayJalali,
                r.sessionLabel,
                r.finalName,
                r.finalWindow ?? '',
                r.suggestedName,
                r.suggestedWindow ?? '',
                r.staffName,
                r.openedAtTime,
                r.closedAtTime ?? '',
                r.reason
              ])
            })
              .then((res) => {
                if (!res.canceled) {
                  setMsg(`خروجی اکسل ساخته شد: ${res.path}`)
                  window.setTimeout(() => setMsg(null), 6000)
                }
              })
              .catch((e: any) => setErr(e.message))
          }
        >
          خروجی اکسل
        </button>
        <span className="kbd">{faDigits(rows.length)} نشست</span>
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

      {data && (
        <div className="bg-white rounded shadow p-3 kbd leading-7 whitespace-pre-line">
          {data.note}
          {!data.byTime &&
            '\nتوجه: «تعیین شیفت بر اساس ساعت» خاموش است، پس نامی برای override شدن وجود ندارد و این فهرست خالی می‌ماند.'}
        </div>
      )}

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
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="tabular-nums">{faDigits(r.dayJalali)}</td>
                <td className="font-bold whitespace-nowrap">{r.sessionLabel}</td>
                <td className="font-bold text-amber-800">{r.finalName}</td>
                <td dir="ltr" className="tabular-nums">
                  {r.finalWindow ? faDigits(r.finalWindow) : '—'}
                </td>
                <td>{r.suggestedName}</td>
                <td dir="ltr" className="tabular-nums">
                  {r.suggestedWindow ? faDigits(r.suggestedWindow) : '—'}
                </td>
                <td>{r.staffName}</td>
                <td dir="ltr" className="tabular-nums">
                  {faDigits(r.openedAtTime ?? '')}
                </td>
                <td dir="ltr" className="tabular-nums">
                  {r.closedAtTime ? faDigits(r.closedAtTime) : '(باز)'}
                </td>
                <td className="whitespace-normal">{r.reason || '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={HEADERS.length} className="text-center py-6 text-emerald-800">
                  در این بازه هیچ نشستی با نام override‌شده ثبت نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
