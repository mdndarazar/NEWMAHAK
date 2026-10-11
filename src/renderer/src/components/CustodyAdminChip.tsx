import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { call, CH } from '../lib/api'
import { money } from '@shared/jalali'
import { useManagerSession } from '../hooks/useManagerSession'

type Staff = { id: number; name: string; role: string; isActive: boolean; hasCustodyPin: boolean; mustChangePin: boolean; jobTitle?: string | null; phoneMasked?: string | null }
type Plan = { id: number; title: string; startMinute: number; durationMinutes: number; daysMask: number; isActive: boolean; sortOrder: number; reminderRepeatMin: number; staffIds: number[] }
type Config = { enabled: boolean; mode: 'SINGLE_SHIFT' | 'MULTI_SHIFT'; reminderEnabled: boolean; overrunGraceMinutes: number; dayCutoverMinute: number }
type Report = { summary: { handovers: number; unresolvedOpen: number; dispositionPending: number; totalCountDifference: number }; counts: any[]; handovers: any[]; resolutions: any[]; dispositions: any[] }

const dayNames = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش']
const asTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const timeToMinute = (value: string) => { const [h, m] = value.split(':').map(Number); return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h < 24 && m >= 0 && m < 60 ? h * 60 + m : NaN }

/** Manager-only structural custody workspace. Main owns the global-manager
 * session; no renderer-supplied manager password or identity is an authority. */
export function CustodyAdminChip() {
  const { isManager } = useManagerSession()
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const reload = useCallback(async () => {
    try { setEnabled((await call<{ enabled: boolean }>(CH.custodyStatus, {})).enabled) } catch { setEnabled(false) }
  }, [])
  useEffect(() => { void reload(); const t = window.setInterval(() => void reload(), 60_000); return () => window.clearInterval(t) }, [reload])
  if (!isManager || !enabled) return null
  return <><button className="text-xs px-2 py-1 rounded whitespace-nowrap font-bold bg-indigo-700 hover:bg-indigo-800" onClick={() => setOpen(true)}>مدیریت حضانت</button>{open ? <CustodyAdminModal onClose={() => { setOpen(false); void reload() }} /> : null}</>
}

function CustodyAdminModal({ onClose }: { onClose: () => void }) {
  const [staff, setStaff] = useState<Staff[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [config, setConfig] = useState<Config | null>(null)
  const [selectedStaffId, setSelectedStaffId] = useState<number | ''>('')
  const [temporaryPin, setTemporaryPin] = useState('')
  const [pinReason, setPinReason] = useState('')
  const [planId, setPlanId] = useState<number | null>(null)
  const [planTitle, setPlanTitle] = useState('')
  const [planStart, setPlanStart] = useState('09:00')
  const [planDuration, setPlanDuration] = useState('480')
  const [planDays, setPlanDays] = useState(127)
  const [planStaff, setPlanStaff] = useState<number[]>([])
  const [planReminder, setPlanReminder] = useState('15')
  const [report, setReport] = useState<Report | null>(null)
  const [tab, setTab] = useState<'staff' | 'plans' | 'report'>('staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const eligibleStaff = staff.filter((x) => x.isActive && (x.role === 'MANAGER' || x.role === 'CASHIER'))

  const load = useCallback(async () => {
    try {
      const [state, people, planRows] = await Promise.all([call<any>(CH.custodyStatus, {}), call<Staff[]>(CH.custodyStaffList, {}), call<Plan[]>(CH.custodyPlanList, {})])
      setConfig(state.config); setStaff(people); setPlans(planRows)
    } catch (e: any) { setError(e?.message ?? 'داده‌های حضانت خوانده نشد.') }
  }, [])
  useEffect(() => { void load() }, [load])
  /** Main binds all structural calls to the globally authenticated window.
   * Keep call sites explicit but never manufacture a credential in Renderer. */
  const authorize = () => ({})
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work(); await load() } catch (e: any) { setError(e?.message ?? 'عملیات انجام نشد.') } finally { setBusy(false) } }
  const blankPlan = () => { setPlanId(null); setPlanTitle(''); setPlanStart('09:00'); setPlanDuration('480'); setPlanDays(127); setPlanStaff([]); setPlanReminder('15') }
  const editPlan = (row: Plan) => { setPlanId(row.id); setPlanTitle(row.title); setPlanStart(asTime(row.startMinute)); setPlanDuration(String(row.durationMinutes)); setPlanDays(row.daysMask); setPlanStaff(row.staffIds); setPlanReminder(String(row.reminderRepeatMin)); setTab('plans') }
  const savePlan = () => run(async () => {
    const startMinute = timeToMinute(planStart), durationMinutes = Number(planDuration), reminderRepeatMin = Number(planReminder)
    if (!planTitle.trim() || !Number.isSafeInteger(startMinute) || !Number.isSafeInteger(durationMinutes)) throw new Error('عنوان، ساعت شروع و مدت برنامه را درست وارد کنید.')
    await call(CH.custodyPlanSave, { id: planId ?? undefined, title: planTitle.trim(), startMinute, durationMinutes, daysMask: planDays, reminderRepeatMin, staffIds: planStaff, ...authorize() })
    blankPlan()
  })
  const summary = useMemo(() => report?.summary ?? null, [report])
  return createPortal(<div className="fixed inset-0 z-[90] bg-black/55 overflow-auto p-4" dir="rtl"><section className="max-w-5xl mx-auto my-6 bg-white text-slate-800 rounded-lg shadow-xl p-5"><div className="flex items-start gap-3 border-b pb-3"><div className="flex-1"><h2 className="font-bold text-lg">مدیریت کارکنان، برنامه و گزارش حضانت</h2><p className="text-xs text-slate-500 mt-1">برنامه فقط یادآور است؛ پایان برنامه یا غیبت کارمند فروش را متوقف نمی‌کند.</p></div><button className="btn-secondary" onClick={onClose}>بستن</button></div>{error ? <div className="my-3 p-2 bg-red-50 text-red-700 rounded text-sm">{error}</div> : null}<div className="my-4 p-3 rounded border border-indigo-100 bg-indigo-50 text-sm text-indigo-950">این بخش با نشست فعال مدیر در همین پنجره محافظت می‌شود. رمز دوم پنل و اطلاعات ارسالی از مرورگر/Renderer برای این عملیات معتبر نیست.</div><div className="flex gap-2 border-b mb-4"><button className={`px-3 py-2 ${tab === 'staff' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('staff')}>کارکنان</button><button className={`px-3 py-2 ${tab === 'plans' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('plans')}>برنامه‌های کاری</button><button className={`px-3 py-2 ${tab === 'report' ? 'border-b-2 border-brand font-bold' : ''}`} onClick={() => setTab('report')}>گزارش کنترل</button></div>{tab === 'staff' ? <div className="grid lg:grid-cols-2 gap-5"><div><h3 className="font-bold mb-2">رمز موقت حضانت کارکنان</h3><p className="text-sm leading-6 text-slate-600 mb-3">نام، نقش، اطلاعات استخدامی و داده‌های بانکی فقط در تب «کارمندان» تنظیمات ثبت می‌شوند. اینجا فقط credential شخصی حضانت و برنامهٔ کاری مدیریت می‌شود.</p><label className="text-sm block">کارمند<select className="input mt-1 w-full" value={selectedStaffId} onChange={(e) => setSelectedStaffId(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.filter((x) => x.isActive).map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role} · {x.hasCustodyPin ? (x.mustChangePin ? 'رمز موقت' : 'رمز فعال') : 'بدون رمز'}</option>)}</select></label><div className="border-t mt-4 pt-4"><label className="text-sm block">رمز موقت تازه (حداقل ۶ کاراکتر)<input className="input mt-1 w-full" type="password" value={temporaryPin} onChange={(e) => setTemporaryPin(e.target.value)} /></label><label className="text-sm block mt-2">دلیل تغییر رمز<input className="input mt-1 w-full" value={pinReason} onChange={(e) => setPinReason(e.target.value)} /></label><button className="btn-secondary mt-3" disabled={busy || !selectedStaffId} onClick={() => void run(async () => { if (temporaryPin.length < 6 || pinReason.trim().length < 3) throw new Error('رمز حداقل ۶ کاراکتر و دلیل حداقل ۳ حرف لازم است.'); await call(CH.custodyPinSet, { userId: selectedStaffId, newPassword: temporaryPin, reason: pinReason.trim(), ...authorize() }); setTemporaryPin(''); setPinReason('') })}>صدور رمز موقت</button></div></div><div className="bg-slate-50 rounded p-4"><h3 className="font-bold">پیکربندی حالت کار</h3><label className="text-sm flex items-center gap-2 mt-3"><input type="checkbox" checked={config?.mode === 'MULTI_SHIFT'} onChange={(e) => setConfig((c) => c ? { ...c, mode: e.target.checked ? 'MULTI_SHIFT' : 'SINGLE_SHIFT' } : c)} /> حالت چندشیفت و یادآوری پایان (پس از ثبت برنامهٔ دارای کارمند)</label><label className="text-sm flex items-center gap-2 mt-2"><input type="checkbox" checked={config?.reminderEnabled !== false} onChange={(e) => setConfig((c) => c ? { ...c, reminderEnabled: e.target.checked } : c)} /> یادآوری پایان برنامه روشن باشد</label><label className="text-sm block mt-3">مهلت پس از پایان برنامه (دقیقه)<input className="input mt-1 w-full" inputMode="numeric" value={String(config?.overrunGraceMinutes ?? 60)} onChange={(e) => setConfig((c) => c ? { ...c, overrunGraceMinutes: Number(e.target.value.replace(/\D/g, '')) } : c)} /></label><button className="btn-primary mt-3" disabled={busy || !config} onClick={() => void run(async () => { await call(CH.custodyConfigSet, { config, ...authorize() }) })}>ذخیره پیکربندی</button></div></div> : null}{tab === 'plans' ? <div className="grid lg:grid-cols-[1fr_1.2fr] gap-5"><div><h3 className="font-bold mb-2">برنامه‌های ثبت‌شده</h3><div className="space-y-2">{plans.map((p) => <div key={p.id} className="border rounded p-3 text-sm"><b>{p.title}</b> · {asTime(p.startMinute)} · {p.durationMinutes} دقیقه · هر {p.reminderRepeatMin} دقیقه<button className="btn-secondary text-xs mr-2" onClick={() => editPlan(p)}>ویرایش</button><button className="text-red-700 underline text-xs mr-2" onClick={() => void run(async () => { await call(CH.custodyPlanDelete, { id: p.id, ...authorize() }); if (planId === p.id) blankPlan() })}>حذف</button></div>)}{!plans.length ? <p className="text-sm text-slate-500">برنامه‌ای تعریف نشده است؛ حالت تک‌شیفت کاملاً معتبر و بدون اجبار می‌ماند.</p> : null}</div></div><div className="bg-slate-50 rounded p-4"><h3 className="font-bold">{planId ? 'ویرایش برنامه' : 'برنامه تازه'}</h3><label className="text-sm block mt-2">عنوان<input className="input mt-1 w-full" value={planTitle} onChange={(e) => setPlanTitle(e.target.value)} /></label><div className="grid grid-cols-2 gap-2 mt-2"><label className="text-sm">شروع<input className="input mt-1 w-full" type="time" value={planStart} onChange={(e) => setPlanStart(e.target.value)} /></label><label className="text-sm">مدت (دقیقه)<input className="input mt-1 w-full" inputMode="numeric" value={planDuration} onChange={(e) => setPlanDuration(e.target.value.replace(/\D/g, ''))} /></label></div><div className="mt-3 text-sm">روزها<div className="flex gap-1 mt-1">{dayNames.map((name, index) => <button key={name} className={`w-8 h-8 rounded ${planDays & (1 << index) ? 'bg-brand text-white' : 'bg-slate-200'}`} onClick={() => setPlanDays((m) => m ^ (1 << index))}>{name}</button>)}</div></div><label className="text-sm block mt-3">تکرار یادآوری (دقیقه)<input className="input mt-1 w-full" inputMode="numeric" value={planReminder} onChange={(e) => setPlanReminder(e.target.value.replace(/\D/g, ''))} /></label><div className="mt-3 text-sm">کارکنان برنامه<div className="grid grid-cols-2 mt-1 gap-1">{eligibleStaff.map((x) => <label key={x.id} className="flex gap-1 items-center"><input type="checkbox" checked={planStaff.includes(x.id)} onChange={() => setPlanStaff((ids) => ids.includes(x.id) ? ids.filter((id) => id !== x.id) : [...ids, x.id])} />{x.name}</label>)}</div></div><div className="flex gap-2 mt-4"><button className="btn-secondary" onClick={blankPlan}>تازه</button><button className="btn-primary" disabled={busy} onClick={() => void savePlan()}>{planId ? 'ذخیره تغییرات' : 'افزودن برنامه'}</button></div></div></div> : null}{tab === 'report' ? <div><button className="btn-primary" disabled={busy} onClick={() => void run(async () => { setReport(await call<Report>(CH.custodyReport, authorize())) })}>تهیه گزارش ۹۰ روز اخیر</button>{summary ? <><div className="grid md:grid-cols-4 gap-3 my-4 text-sm"><Info label="تحویل‌ها" value={summary.handovers} /><Info label="شب‌های باز" value={summary.unresolvedOpen} /><Info label="تعیین تکلیف تأییدنشده" value={summary.dispositionPending} /><Info label="جمع اختلاف شمارش" value={money(summary.totalCountDifference)} /></div><h3 className="font-bold mt-4">آخرین شمارش‌ها</h3><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>زمان</th><th>شیفت</th><th>نوع</th><th>شمارش</th><th>انتظار</th><th>اختلاف</th><th>ثبت‌کننده</th></tr></thead><tbody>{report?.counts.slice(0, 20).map((x) => <tr key={x.id}><td>{new Date(x.at).toLocaleString('fa-IR')}</td><td>{x.shiftId}</td><td>{x.kind}</td><td>{money(x.countedCash)}</td><td>{x.expectedCash == null ? '—' : money(x.expectedCash)}</td><td>{x.differenceCash == null ? '—' : money(x.differenceCash)}</td><td>{x.countedByName ?? '—'}</td></tr>)}</tbody></table></div></> : <p className="mt-3 text-sm text-slate-500">گزارش فقط در نشست فعال مدیر خوانده می‌شود.</p>}</div> : null}</section></div>, document.body)
}
function Info({ label, value }: { label: string; value: string | number }) { return <div className="bg-slate-50 border rounded p-3"><div className="text-xs text-slate-500">{label}</div><b>{value}</b></div> }
