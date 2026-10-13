import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { call, CH } from '../lib/api'
import { money } from '@shared/jalali'
import { useManagerSession } from '../hooks/useManagerSession'

/** This small Settings-only workspace deliberately owns no staff profile fields
 * and has no schedule/ShiftPlan writer. Shift Settings is the canonical place
 * for names, days, times, assigned people and handover policy. */
type Staff = { id: number; name: string; role: string; isActive: boolean; hasCustodyPin: boolean; mustChangePin: boolean }
type LegacyPlan = { id: number; title: string; startMinute: number; durationMinutes: number; daysMask: number; isActive: boolean; reminderRepeatMin: number; staffIds: number[] }
type Report = { summary: { handovers: number; unresolvedOpen: number; dispositionPending: number; totalCountDifference: number }; counts: Array<{ id: number; at: string; shiftId: number; kind: string; countedCash: number; expectedCash: number | null; differenceCash: number | null; countedByName?: string | null }> }

type Tab = 'credentials' | 'legacy' | 'report'
const asTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Entry point is rendered only in Settings > Custody. It is intentionally not
 * a top-bar management control; day-to-day operations remain in CustodyChip. */
export function CustodyAdminChip() {
  const { isManager } = useManagerSession()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const reload = useCallback(async () => {
    try { setEnabled((await call<{ enabled: boolean }>(CH.custodyStatus, {})).enabled) } catch { setEnabled(false) }
  }, [])
  useEffect(() => { void reload(); const timer = window.setInterval(() => void reload(), 60_000); return () => window.clearInterval(timer) }, [reload])
  if (!isManager || !enabled) return null
  return <>
    <button className="text-xs px-2 py-1 rounded whitespace-nowrap font-bold bg-indigo-700 hover:bg-indigo-800" onClick={() => setOpen(true)}>اعتبارنامه و سوابق حضانت</button>
    {open ? <CustodyAdminModal onClose={() => { setOpen(false); void reload() }} /> : null}
  </>
}

function CustodyAdminModal({ onClose }: { onClose: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [legacyPlans, setLegacyPlans] = useState<LegacyPlan[]>([])
  const [selectedStaffId, setSelectedStaffId] = useState<number | ''>('')
  const [temporaryPin, setTemporaryPin] = useState('')
  const [pinReason, setPinReason] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<Tab>('credentials')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [people, planRows] = await Promise.all([
        call<Staff[]>(CH.custodyStaffList, {}),
        call<LegacyPlan[]>(CH.custodyPlanList, {})
      ])
      setStaff(people)
      setLegacyPlans(planRows)
    } catch (reason: any) { setError(reason?.message ?? 'داده‌های حضانت خوانده نشد.') }
  }, [])
  useEffect(() => { void load() }, [load])
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await work(); await load() }
    catch (reason: any) { setError(reason?.message ?? 'عملیات انجام نشد.') }
    finally { setBusy(false) }
  }
  const summary = useMemo(() => report?.summary ?? null, [report])
  const operationalStaff = staff.filter((person) => person.isActive && (person.role === 'MANAGER' || person.role === 'CASHIER'))

  return createPortal(
    <div className="fixed inset-0 z-[90] bg-black/55 overflow-auto p-4" dir="rtl">
      <section className="max-w-5xl mx-auto my-6 bg-white text-slate-800 rounded-lg shadow-xl p-5">
        <div className="flex items-start gap-3 border-b pb-3">
          <div className="flex-1">
            <h2 className="font-bold text-lg">حضانت صندوق: اعتبارنامه و بازبینی سابقه</h2>
            <p className="text-xs text-slate-500 mt-1">پیکربندی شیفت‌های جدید فقط در تب «شیفت‌ها»ی Settings انجام می‌شود.</p>
          </div>
          <button className="btn-secondary" onClick={onClose}>بستن</button>
        </div>
        {error ? <div className="my-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div> : null}
        <div className="my-4 p-3 rounded border border-indigo-100 bg-indigo-50 text-sm text-indigo-950">
          این بخش با نشست اصلی و فعال مدیر در همین پنجره محافظت می‌شود. رمز دوم پنل یا دادهٔ Renderer برای اختیار مدیریتی معتبر نیست.
        </div>
        <div className="flex gap-2 border-b mb-4">
          <button className={`px-3 py-2 ${tab === 'credentials' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('credentials')}>رمز موقت</button>
          <button className={`px-3 py-2 ${tab === 'legacy' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('legacy')}>برنامه‌های قدیمی (فقط بازبینی)</button>
          <button className={`px-3 py-2 ${tab === 'report' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('report')}>گزارش کنترل</button>
        </div>

        {tab === 'credentials' ? <div className="max-w-xl space-y-3">
          <div>
            <h3 className="font-bold mb-2">صدور یا بازنشانی رمز موقت حضانت</h3>
            <p className="text-sm leading-6 text-slate-600">پرونده، نام و نقش کارمند در تب «کارمندان» Settings ثبت می‌شود. رمز خام قبلی هرگز نمایش داده نمی‌شود؛ کارمند باید رمز موقت خود را در نخستین ورود تغییر دهد.</p>
          </div>
          <label className="text-sm block">کارمند
            <select className="input mt-1 w-full" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value ? Number(event.target.value) : '')}>
              <option value="">انتخاب کنید…</option>
              {operationalStaff.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.role} · {person.hasCustodyPin ? (person.mustChangePin ? 'رمز موقت' : 'رمز فعال') : 'بدون رمز'}</option>)}
            </select>
          </label>
          <label className="text-sm block">رمز موقت تازه (حداقل ۶ کاراکتر)<input className="input mt-1 w-full" type="password" value={temporaryPin} onChange={(event) => setTemporaryPin(event.target.value)} /></label>
          <label className="text-sm block">دلیل تغییر رمز<input className="input mt-1 w-full" value={pinReason} onChange={(event) => setPinReason(event.target.value)} /></label>
          <button className="btn-primary" disabled={busy || !selectedStaffId} onClick={() => void run(async () => {
            if (temporaryPin.length < 6 || pinReason.trim().length < 3) throw new Error('رمز حداقل ۶ کاراکتر و دلیل حداقل ۳ حرف لازم است.')
            await call(CH.custodyPinSet, { userId: selectedStaffId, newPassword: temporaryPin, reason: pinReason.trim() })
            setTemporaryPin(''); setPinReason('')
          })}>صدور رمز موقت</button>
        </div> : null}

        {tab === 'legacy' ? <div className="space-y-3">
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
            این‌ها داده‌های سازگار با نسخه‌های قبل‌اند. حذف یا تبدیل خودکار نشده‌اند تا سابقهٔ گذشته سالم بماند؛ ایجاد، ویرایش و حذف برنامهٔ قدیمی از این صفحه عمداً ممکن نیست. برای برنامهٔ عملیاتی تازه از «تنظیمات › شیفت‌ها» استفاده کنید.
          </div>
          {legacyPlans.length ? <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>عنوان</th><th>شروع</th><th>مدت</th><th>یادآوری</th><th>کارکنان قدیمی</th><th>وضعیت</th></tr></thead><tbody>
            {legacyPlans.map((plan) => <tr key={plan.id}><td>{plan.title}</td><td>{asTime(plan.startMinute)}</td><td>{plan.durationMinutes} دقیقه</td><td>هر {plan.reminderRepeatMin} دقیقه</td><td>{plan.staffIds.length}</td><td>{plan.isActive ? 'فعال در دادهٔ قدیمی' : 'غیرفعال'}</td></tr>)}
          </tbody></table></div> : <p className="text-sm text-slate-500">برنامهٔ قدیمی ثبت نشده است.</p>}
        </div> : null}

        {tab === 'report' ? <div>
          <button className="btn-primary" disabled={busy} onClick={() => void run(async () => { setReport(await call<Report>(CH.custodyReport, {})) })}>تهیه گزارش ۹۰ روز اخیر</button>
          {summary ? <>
            <div className="grid md:grid-cols-4 gap-3 my-4 text-sm"><Info label="تحویل‌ها" value={summary.handovers} /><Info label="شب‌های باز" value={summary.unresolvedOpen} /><Info label="تعیین تکلیف تأییدنشده" value={summary.dispositionPending} /><Info label="جمع اختلاف شمارش" value={money(summary.totalCountDifference)} /></div>
            <h3 className="font-bold mt-4">آخرین شمارش‌ها</h3>
            <div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>زمان</th><th>شیفت</th><th>نوع</th><th>شمارش</th><th>انتظار</th><th>اختلاف</th><th>ثبت‌کننده</th></tr></thead><tbody>
              {report?.counts.slice(0, 20).map((row) => <tr key={row.id}><td>{new Date(row.at).toLocaleString('fa-IR')}</td><td>{row.shiftId}</td><td>{row.kind}</td><td>{money(row.countedCash)}</td><td>{row.expectedCash == null ? '—' : money(row.expectedCash)}</td><td>{row.differenceCash == null ? '—' : money(row.differenceCash)}</td><td>{row.countedByName ?? '—'}</td></tr>)}
            </tbody></table></div>
          </> : <p className="mt-3 text-sm text-slate-500">گزارش فقط در نشست فعال مدیر خوانده می‌شود.</p>}
        </div> : null}
      </section>
    </div>,
    document.body
  )
}

function Info({ label, value }: { label: string; value: unknown }) {
  return <div className="rounded border bg-slate-50 p-3"><div className="text-slate-500">{label}</div><b>{String(value)}</b></div>
}
