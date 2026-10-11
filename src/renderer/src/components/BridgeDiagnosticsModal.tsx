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
  BridgeDiagNoteAddResponse,
  BridgeSuspect,
  BridgeDocDetailResponse,
  BridgeDocDetail,
  BridgeRootCause
} from '@shared/types'

/**
 * ===========================================================================
 * نشست ۳۱۸ · طرح برنده (کامیلا) — فاز ۳ — «نمای تشخیص پل تطبیق» (فقط بخوانی).
 * نشست ۳۱۹ — کارت هوشمند مظنونین اصلی، شناسنامه جامع سند و تحلیل آموزشی ۱-کلیکی.
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

  // نشست ۳۱۹ — اسناد مظنون و کش جزئیات آنها
  const [docDetails, setDocDetails] = useState<Record<string, { detail: BridgeDocDetail; rootCause?: BridgeRootCause }>>({})
  const [activeDocKey, setActiveDocKey] = useState<string | null>(null)
  const [docBusy, setDocBusy] = useState<string | null>(null)

  // رمز هیچ‌وقت بین دو باز شدن نمی‌ماند (هر باز کردن = رمز تازه).
  useEffect(() => {
    if (open) {
      setPassword('')
      setErr(null)
      setView(null)
      setExpandedRow(null)
      setRowSources({})
      setNoteDraft('')
      setDocDetails({})
      setActiveDocKey(null)
    }
  }, [open])

  const loadDocDetail = async (ref: { kind: string; id: number }, rowKey?: string) => {
    const key = `${ref.kind}_${ref.id}`
    setActiveDocKey(key)
    if (docDetails[key]) return
    setDocBusy(key)
    try {
      const res = await call<BridgeDocDetailResponse>(CH.saleReportBridgeDiagDoc, { scope, ref, rowKey })
      if (res?.ok && res.detail) {
        setDocDetails((prev) => ({
          ...prev,
          [key]: { detail: res.detail!, rootCause: res.rootCause }
        }))
      }
    } catch (e: any) {
      setErr(String(e?.message ?? e))
    } finally {
      setDocBusy(null)
    }
  }

  const openView = async () => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const res = await call<BridgeDiagOpenResponse>(CH.saleReportBridgeDiagOpen, { scope, password })
      if (!res?.ok || !res.view) throw new Error(res?.message ?? 'پاسخ نامعتبر از سرور.')
      setView(res.view)
      setPassword('') // رمز سریع پاک می‌شود؛ فقط به همان یک فراخوانی رفت.

      // اگر مظنون اول سند دارد، خودکار بازش کن تا ۱-کلیکی باشد
      const top = res.view.suspects?.[0]
      if (top?.documents?.[0]) {
        void loadDocDetail(top.documents[0], top.rowKey)
      }
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

          {/* ===================================================================
              نشست ۳۱۹ — بخش مظنونین اصلی و کارت ریشه‌یابی ۱-کلیکی (Hero Card)
             =================================================================== */}
          {!!view.suspects?.length && !view.bridge.balanced && (
            <div className="rounded-lg border-2 border-amber-400 bg-amber-50/70 p-3 space-y-3 shadow-sm">
              <div className="flex items-center justify-between border-b border-amber-200 pb-2">
                <div className="flex items-center gap-2">
                  <span className="text-base font-extrabold text-amber-950">🔍 مظنونین اصلی عدم تطبیق (شناسایی هوشمند ۱-کلیکی)</span>
                  <span className="text-xs text-amber-800 bg-amber-200 px-2 py-0.5 rounded-full font-bold">
                    {faDigits(view.suspects.length)} مورد
                  </span>
                </div>
                <span className="text-xs text-amber-800">(قطعی نیست — فقط راهنماست)</span>
              </div>

              <div className="space-y-2">
                {view.suspects.map((suspect: BridgeSuspect) => (
                  <div key={suspect.rank} className="rounded border border-amber-300 bg-white p-2.5 space-y-2 shadow-xs">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center">
                          {faDigits(suspect.rank)}
                        </span>
                        <span className="font-bold text-sm text-slate-800">{suspect.rowLabel}</span>
                        {suspect.reasons.map((r, i) => (
                          <span key={i} className="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 font-medium">
                            {r === 'ROW_EQUALS_UNEXPLAINED' || r === 'SOURCE_EQUALS_UNEXPLAINED'
                              ? 'هم‌مبلغ باقیمانده'
                              : r === 'SOURCE_OUT_OF_PERIOD'
                                ? 'خارج از بازه'
                                : r === 'CASH_OUT_ON_CREDIT'
                                  ? 'نقد روی نسیه'
                                  : 'از بزرگ‌ترین‌ها'}
                          </span>
                        ))}
                      </div>

                      {!!suspect.documents?.length && (
                        <div className="flex items-center gap-1.5">
                          {suspect.documents.map((doc, dIdx) => {
                            const dKey = `${doc.kind}_${doc.id}`
                            const isDocActive = activeDocKey === dKey
                            return (
                              <button
                                key={dIdx}
                                className={`btn text-xs px-2 py-1 ${isDocActive ? 'btn-primary' : 'bg-slate-100 text-slate-800'}`}
                                onClick={() => void loadDocDetail(doc, suspect.rowKey)}
                              >
                                {docBusy === dKey ? 'در حال خواندن…' : `شناسنامه سند #${faDigits(doc.receiptNo || doc.id)} (${money(doc.amount)})`}
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>

                    {/* شناسنامه کامل سند مظنون و جعبه ریشه‌یابی آموزشی */}
                    {activeDocKey && docDetails[activeDocKey] && (
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-3">
                        <DocDetailView data={docDetails[activeDocKey].detail} />
                        {docDetails[activeDocKey].rootCause && (
                          <RootCauseBox cause={docDetails[activeDocKey].rootCause!} />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

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

function DocDetailView({ data }: { data: BridgeDocDetail }) {
  return (
    <div className="bg-slate-50 rounded border p-2.5 space-y-2 text-xs">
      <div className="flex items-center justify-between flex-wrap gap-2 border-b pb-1.5 font-bold">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 border border-blue-300">
            {data.docType === 'EXCHANGE' ? 'سند تعویض' : data.docType === 'SIMPLE_RETURN' ? 'سند برگشت' : 'فاکتور'} #{faDigits(data.docNo)}
          </span>
          {data.parent && (
            <span className="text-slate-700">
              مربوط به فاکتور اصلی #{faDigits(data.parent.receiptNo)} ({faDigits(data.parent.dateJalali)})
            </span>
          )}
        </div>
        <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
          روش تسویه: {data.settlement.methodLabel} ({money(data.settlement.amount)} ریال)
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-slate-700">
        <div>تاریخ و زمان: <b className="text-slate-900">{faDigits(data.at.dateJalali)} {faDigits(data.at.time)}</b></div>
        <div>ثبت‌کننده: <b className="text-slate-900">{data.actor.name}</b></div>
        <div>شیفت: <b className="text-slate-900">{data.shift.name ?? '—'}</b></div>
        <div>مشتری: <b className="text-slate-900">{data.customer.name}</b></div>
      </div>

      {!!data.items.length && (
        <div className="mt-1">
          <div className="font-bold text-slate-800 mb-1">اقلام سند:</div>
          <div className="rounded border bg-white overflow-hidden">
            <table className="w-full text-right text-[11px]">
              <thead className="bg-slate-100">
                <tr>
                  <th className="p-1">نام کالا</th>
                  <th className="p-1 w-16 text-center">تعداد</th>
                  <th className="p-1 w-24 text-left">مبلغ واحد</th>
                  <th className="p-1 w-24 text-left">جمع</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((it, idx) => (
                  <tr key={idx} className="border-t">
                    <td className="p-1">{it.name}</td>
                    <td className="p-1 text-center font-bold">{faDigits(it.qty)}</td>
                    <td className="p-1 text-left kbd">{money(it.unitPrice)}</td>
                    <td className="p-1 text-left kbd font-bold">{money(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function RootCauseBox({ cause }: { cause: BridgeRootCause }) {
  return (
    <div className="rounded border border-indigo-200 bg-indigo-50/60 p-2.5 space-y-2 text-xs text-indigo-950">
      <div className="font-bold flex items-center gap-1.5 text-indigo-900 border-b border-indigo-200 pb-1">
        <span>💡 تحلیل ریشه و راهنمای آموزشی مغایرت:</span>
      </div>

      <div className="space-y-1 leading-5">
        <div>
          <b className="text-indigo-900">📝 روایت رویداد:</b> {cause.narrative}
        </div>
        <div>
          <b className="text-indigo-900">🧮 علت حسابداری مغایرت:</b> {cause.accountingRoot}
        </div>
        <div className="bg-white/80 rounded p-1.5 border border-indigo-200 mt-1">
          <b className="text-indigo-900">🎓 راهنمای دفعات بعد برای پرسنل:</b> {cause.lesson}
        </div>
      </div>
    </div>
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
