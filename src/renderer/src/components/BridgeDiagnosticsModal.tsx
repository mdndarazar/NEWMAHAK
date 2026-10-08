import { useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'
import type {
  BridgeDiagView,
  BridgeDiagRow,
  BridgeDiagRowSources,
  BridgeDiagFlag,
  BridgeDiagOpenResponse,
  BridgeDiagSourcesResponse,
  BridgeDiagNotesResponse,
  BridgeDiagNoteAddResponse
} from '@shared/types'

/**
 * ===========================================================================
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۳ — «نمای تشخیص پل تطبیق» (فقط بخوانی).
 *
 * قوانین سختِ این فایل (از طرح + قرارداد اجرا):
 *   ۱) **هیچ محاسبه‌ی عددی** این‌جا رخ نمی‌دهد: جدول، جمع‌ها و علامت unexplained
 *      دقیقاً همان هستند که سرویس (`sale:report:bridgeDiag:open`) فرستاده —
 *      خودِ نما هم دقیقاً همان‌ها را از reportRows می‌گیرد (بدون کش).
 *   ۲) **باز کردن همیشه رمز تازه می‌خواهد** (strict)؛ این رمز فقط به سرویس
 *      می‌رود و هیچ‌جا نگه داشته نمی‌شود (state پاک می‌شود به‌محض موفقیت/بستن).
 *   ۳) یادداشت‌ها **متن خالص**‌اند (بدون dangerouslySetInnerHTML).
 *   ۴) «متن‌خوانی» نیست: تک‌دکمه‌ی ورودِ صفحه فقط وقتی نمایان است که
 *      `report.accounting.bridge.balanced === false` باشد (پیکسل پشت هشدار).
 *   ۵) بنر staleness: اگر عدد unexplained این نما با عدد صفحه فرق داشت،
 *      صریح بگو «صفحه را بازخوانی کن» — نما هرگز بی‌صدا خودش را تازه نمی‌کند.
 *   ۶) همه‌ی نشان‌ها «TENTATIVE»‌اند و با واژه‌ی «احتمال» چاپ می‌شوند؛
 *      این نما هیچ عیار قطعی به هیچ ردیفی نمی‌زند.
 *   ۷) باز شدن این مودال هیچ‌وقت `load()` صفحه را صدا نمی‌زند یعنی جدول
 *      گزارش (هوک رندر هشدار) تا وقتی مودال باز است عوض نمی‌شود؛ اختلاف
 *      احتمالی را بنر staleness گزارش می‌دهد نه رفرش پنهانی.
 * ===========================================================================
 */

const flagLabel = (f: BridgeDiagFlag): string => {
  switch (f.code) {
    case 'sign': return 'جهت'
    case 'largest': return 'از بزرگ‌هاست'
    case 'equals-unexplained': return 'هم‌مبلغ باقی‌مانده'
    case 'date': return 'تاریخ'
    default: return 'نشان'
  }
}

function FlagChip({ flag }: { flag: BridgeDiagFlag }) {
  return (
    <span
      className="inline-block rounded bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[11px] leading-5"
      title={`${flag.text} (قطعی نیست — فقط راهنماست)`}
    >
      {flagLabel(flag)} · {flag.text}
    </span>
  )
}

export default function BridgeDiagnosticsModal({
  open,
  onClosed,
  scope,
  pageUnexplained
}: {
  open: boolean
  onClosed: () => void
  scope: Record<string, unknown>
  /** عدد «باقیمانده‌ی بی‌توضیح» که صفحه الان در بلوک حسابداری نشان می‌دهد. */
  pageUnexplained: number | null
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [view, setView] = useState<BridgeDiagView | null>(null)
  const [expandedRow, setExpandedRow] = useState<string | null>(null)
  const [rowSources, setRowSources] = useState<Record<string, BridgeDiagRowSources>>({})
  const [srcBusy, setSrcBusy] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)

  // رمز هیچ‌وقت بین دو باز شدن نمی‌ماند (هر باز کردن = رمز تازه).
  useEffect(() => {
    if (open) {
      setPassword('')
      setErr(null)
      setView(null)
      setExpandedRow(null)
      setRowSources({})
      setNoteDraft('')
    }
  }, [open])

  const openView = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await call<BridgeDiagOpenResponse>(CH.saleReportBridgeDiagOpen, { scope, password })
      if (!res?.ok || !res.view) throw new Error(res?.message ?? 'پاسخ نامعتبر از سرور.')
      setView(res.view)
      setPassword('') // رمز سریع پاک می‌شود؛ فقط به همان یک فراخوانی رفت.
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setBusy(false)
    }
  }

  const toggleSources = async (row: BridgeDiagRow) => {
    const key = row.key
    if (expandedRow === key) {
      setExpandedRow(null)
      return
    }
    setExpandedRow(key)
    if (rowSources[key]) return
    setSrcBusy(key)
    try {
      const res = await call<BridgeDiagSourcesResponse>(CH.saleReportBridgeDiagSources, { scope, rowKey: key })
      if (res?.ok && res.result) setRowSources((m) => ({ ...m, [key]: res.result! }))
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setSrcBusy(null)
    }
  }

  const addNote = async () => {
    if (noteBusy) return
    const text = noteDraft.trim()
    if (!text) return
    setNoteBusy(true)
    setErr(null)
    try {
      const res = await call<BridgeDiagNoteAddResponse>(CH.saleReportBridgeDiagNoteAdd, { scope, text })
      if (!res?.ok) throw new Error(res?.message ?? 'ثبت یادداشت ناموفق بود.')
      const notes = await call<BridgeDiagNotesResponse>(CH.saleReportBridgeDiagNotes, { scope })
      setView((v) => (v ? { ...v, notes: notes?.notes ?? v.notes } : v))
      setNoteDraft('')
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setNoteBusy(false)
    }
  }

  const stale = useMemo(
    () => view != null && pageUnexplained != null && view.bridge.unexplained !== pageUnexplained,
    [view, pageUnexplained]
  )

  const unexplainedText = (v: number) => (v === 0 ? '۰' : `${v > 0 ? '+' : '−'}${money(Math.abs(v))}`)

  return (
    <Modal open={open} title="نمای تشخیص پل تطبیق" onClose={onClosed} width="max-w-5xl">
      {!view && (
        <div className="space-y-3">
          <p className="text-sm leading-6 text-slate-700">
            این نما فقط <b>می‌خواند</b>: همان ۱۸ ردیف پل تطبیقِ گزارش را با نشان‌های راهنما (هم‌مبلغ، بزرگ‌ترین‌ها،
            تاریخِ بیرون‌بازه) نشان می‌دهد و هیچ عددی را عوض نمی‌کند. باز کردنش همیشه رمز می‌خواهد — رمز مدیر یا
            رمز دوم همین بخش.
          </p>
          {!!err && <div className="rounded border border-rose-400 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}
          <div className="flex items-center gap-2">
            <div className="w-64">
              <PasswordField
                autoFocus
                placeholder="رمز مدیر / رمز دوم این بخش"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void openView()
                }}
              />
            </div>
            <button className="btn" disabled={busy || !password} onClick={() => void openView()}>
              {busy ? 'در حال باز کردن…' : 'باز کردن نما'}
            </button>
          </div>
          <div className="text-xs kbd text-slate-500">رمز ذخیره نمی‌شود و هر بار باید دوباره وارد شود.</div>
        </div>
      )}

      {!!view && (
        <div className="space-y-3">
          {stale && (
            <div className="rounded border-2 border-rose-500 bg-rose-50 p-2 text-sm leading-6 text-rose-800">
              ⚠ عدد این نما ({unexplainedText(view.bridge.unexplained)} ریال) با عددِ بلوک حسابداری صفحه (
              {pageUnexplained != null ? unexplainedText(pageUnexplained) : '—'}) فرق دارد؛ یعنی از زمان آخرین «گرفتن
              گزارش» داده عوض شده است. مودال را ببندید و در صفحه «گرفتن گزارش» را بزنید.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 rounded border p-2 bg-slate-50 text-sm">
            <span>
              هدف (خالص فروش): <b className="kbd">{money(view.bridge.target)}</b>
            </span>
            <span>
              توضیح‌شده: <b className="kbd">{money(view.bridge.explainedTotal)}</b>
            </span>
            <span>
              باقیمانده‌ی بی‌توضیح:{' '}
              <b className={`kbd ${view.bridge.balanced ? 'text-emerald-700' : 'text-rose-700'}`}>{unexplainedText(view.bridge.unexplained)}</b>
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${view.bridge.balanced ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
              {view.bridge.balanced ? 'پل بسته است' : 'پل بسته نیست'}
            </span>
            <span className="mr-auto text-xs kbd text-slate-500">
              محاسبه‌شده: {faDigits(new Date(view.computedAtIso).toLocaleString('fa-IR'))}
            </span>
          </div>

          {!!view.guide.length && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-1">
              {view.guide.map((g, i) => (
                <div key={i} className="text-sm leading-6 text-amber-900">
                  • {g.text} <span className="text-xs text-amber-700">(قطعی نیست — فقط راهنماست)</span>
                </div>
              ))}
            </div>
          )}

          {!!err && <div className="rounded border border-rose-400 bg-rose-50 p-2 text-sm text-rose-800">{err}</div>}

          <div className="rounded border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-100 text-right">
                  <th className="p-2">ردیف</th>
                  <th className="p-2 w-28 text-left">مبلغ (ریال)</th>
                  <th className="p-2 w-10">اثر</th>
                  <th className="p-2">نشان‌های راهنما</th>
                  <th className="p-2 w-24">منابع</th>
                </tr>
              </thead>
              <tbody>
                {view.rows.map((r) => (
                  <FragmentRow
                    key={r.key}
                    row={r}
                    expanded={expandedRow === r.key}
                    sources={rowSources[r.key] ?? null}
                    loading={srcBusy === r.key}
                    onToggle={() => void toggleSources(r)}
                  />
                ))}
                <tr className="border-t bg-slate-50 font-bold">
                  <td className="p-2">جمع توضیح‌شده / هدف / باقی‌مانده</td>
                  <td className="p-2 text-left" style={{ direction: 'ltr' }}>
                    {money(view.bridge.explainedTotal)} / {money(view.bridge.target)}
                  </td>
                  <td className="p-2"></td>
                  <td className="p-2"></td>
                  <td className="p-2 text-rose-700 text-left" style={{ direction: 'ltr' }}>
                    {unexplainedText(view.bridge.unexplained)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="rounded border p-3 space-y-2">
            <b className="text-sm">یادداشت‌های مدیر درباره‌ی این دوره</b>
            {!view.notes.length && <div className="text-sm text-slate-500">یادداشتی برای همین دوره ثبت نشده است.</div>}
            {!!view.notes.length && (
              <div className="space-y-1">
                {view.notes.map((n) => (
                  <div key={n.id} className="text-sm leading-6 border-r-2 border-slate-300 pr-2">
                    <span className="text-xs text-slate-500 kbd">
                      {faDigits(new Date(n.createdAtIso).toLocaleString('fa-IR'))} · {n.actorLabel}
                    </span>
                    <div className="whitespace-pre-wrap">{n.text /* متن خالص — بدون dangerouslySetInnerHTML */}</div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-start gap-2 pt-1">
              <textarea
                className="inp flex-1 h-16"
                maxLength={300}
                placeholder="یادداشت کوتاه (حداکثر ۳۰۰ کاراکتر، متن خالص)…"
                value={noteDraft}
                disabled={noteBusy}
                onChange={(e) => setNoteDraft(e.target.value)}
              />
              <div className="flex flex-col items-end gap-1">
                <button className="btn" disabled={noteBusy || !noteDraft.trim()} onClick={() => void addNote()}>
                  {noteBusy ? 'در حال ثبت…' : 'ثبت یادداشت'}
                </button>
                <span className="text-xs kbd text-slate-500">{faDigits(noteDraft.length)}/۳۰۰</span>
              </div>
            </div>
            <div className="text-xs kbd text-slate-500">یادداشت‌ها حذف و ویرایش نمی‌شوند و در سابقه (AuditLog) می‌نشینند.</div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function FragmentRow({
  row,
  expanded,
  sources,
  loading,
  onToggle
}: {
  row: BridgeDiagRow
  expanded: boolean
  sources: BridgeDiagRowSources | null
  loading: boolean
  onToggle: () => void
}) {
  return (
    <>
      <tr className={`border-t ${row.flags.length ? 'bg-amber-50/60' : ''}`}>
        <td className="p-2">{row.label}</td>
        <td className="p-2 text-left kbd" style={{ direction: 'ltr' }}>{money(row.amount)}</td>
        <td className={`p-2 text-center font-bold ${row.sign === 1 ? 'text-emerald-700' : 'text-rose-700'}`}>{row.sign === 1 ? '+' : '−'}</td>
        <td className="p-2 space-x-1 space-y-1">
          {row.flags.map((f, i) => <FlagChip key={i} flag={f} />)}
          {!row.flags.length && <span className="text-xs text-slate-400">—</span>}
        </td>
        <td className="p-2">
          <button className="btn text-xs" disabled={loading} onClick={onToggle}>
            {loading ? '…' : expanded ? 'بستن' : `منابع${row.sources?.length ? ` (${faDigits(row.sources.length)})` : ''}`}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-slate-50">
          <td colSpan={5} className="p-2">
            {!sources && <div className="text-sm kbd text-slate-500">در حال خواندن منابع این ردیف…</div>}
            {!!sources && !sources.sources.length && <div className="text-sm text-slate-500">سندی برای این ردیف در همین بازه نیست.</div>}
            {!!sources && !!sources.sources.length && (
              <div className="space-y-1">
                {sources.sources.map((s, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="kbd text-xs text-slate-600">{s.kind}</span>
                    <span>{s.label}</span>
                    <span className="kbd">{money(s.amount)}</span>
                    {s.dateJalali && <span className="kbd text-xs">{faDigits(s.dateJalali)}</span>}
                    {s.flags.map((f, j) => <FlagChip key={j} flag={f} />)}
                  </div>
                ))}
                {typeof sources.totalCount === 'number' && sources.totalCount > sources.sources.length && (
                  <div className="text-xs kbd text-slate-500">
                    نمایش {faDigits(sources.sources.length)} از {faDigits(sources.totalCount)} سند — برای دیدن بقیه، صفحه‌ی اسناد همان ردیف در بلوک حسابداری را باز کنید.
                  </div>
                )}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
