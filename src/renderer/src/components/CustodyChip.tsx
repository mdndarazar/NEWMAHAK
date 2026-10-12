import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { call, CH } from '../lib/api'
import { money } from '@shared/jalali'
import { useTopmostModalKey } from './Modal'
import { useManagerSession } from '../hooks/useManagerSession'

type Staff = { id: number; name: string; role: string; isActive: boolean; hasCustodyPin: boolean; mustChangePin: boolean }
type Status = {
  enabled: boolean
  state: 'NO_SESSION' | 'ACTIVE' | 'HANDOVER_PENDING' | string
  epoch: number
  custodian: { id: number; name: string | null } | null
  shift: { id: number; name: string; openedAt: string } | null
  pendingHandover: { id: number; fromUserId: number; selectedRecipientUserId: number; startedAt: string } | null
  schedule: { planId: number; title: string; scheduledEndAt: string } | null
  reminder: { due: boolean; bucket: number | null; repeatMinutes: number; scheduledEndAt: string | null }
  unresolvedCount: number
  unresolved: Array<{ id: number; shiftId: number; openedAt: string; nightExpectedCash: number | null }>
  autoTimeouts: Array<{ id: number; shiftId: number; effectiveAt: string | null; detectedAt: string | null; expectedCash: number | bigint | null; expectedCard: number | bigint | null }>
  legacyStaleRecoveries: Array<{ id: number; shiftId: number; openedAt: string; detectedAt: string | null; expectedCash: number | bigint | null; expectedCard: number | bigint | null }>
  policyTransitions: Array<{ id: number; shiftId: number; effectiveAt: string | null; expectedCash: number | bigint | null; expectedCard: number | bigint | null }>
  staffDeactivationRecoveries: Array<{ id: number; shiftId: number; effectiveAt: string | null; expectedCash: number | bigint | null; expectedCard: number | bigint | null }>
}

type View = 'main' | 'open' | 'emergencyOpen' | 'managerOpen' | 'managerRecovery' | 'handover' | 'accept' | 'close' | 'resolve' | 'timeoutAccept' | 'changePin'

/**
 * Small, opt-in custody control surface. The old ShiftSessionChip remains the
 * entire UI when the feature is off; therefore an installation can enable this
 * module only after staff credentials have been deliberately configured.
 */
export function CustodyChip({ showSetup = true, showOperations = true }: { showSetup?: boolean; showOperations?: boolean } = {}) {
  const [status, setStatus] = useState<Status | null>(null)
  const [staff, setStaff] = useState<Staff[]>([])
  const [visible, setVisible] = useState(false)
  const [view, setView] = useState<View>('main')
  const [selectedUserId, setSelectedUserId] = useState<number | ''>('')
  const [recipientId, setRecipientId] = useState<number | ''>('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [repeatNewPassword, setRepeatNewPassword] = useState('')
  const [managerId, setManagerId] = useState<number | ''>('')
  const [managerPassword, setManagerPassword] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dismissedReminderBucket, setDismissedReminderBucket] = useState<number | null>(null)
  const { isManager } = useManagerSession()

  const reload = useCallback(async () => {
    try {
      const next = await call<Status>(CH.custodyStatus, {})
      setStatus(next)
      setStaff(await call<Staff[]>(CH.custodyStaffList, {}))
    } catch {
      // The established shift chip remains usable if an old database has not
      // migrated yet. No renderer fallback may silently create a shift here.
    }
  }, [])

  useEffect(() => {
    void reload()
    const timer = window.setInterval(() => void reload(), 30_000)
    return () => window.clearInterval(timer)
  }, [reload])

  useTopmostModalKey(visible, (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    if (!busy) setVisible(false)
  })

  if (!status) return null
  if (!status.enabled) return isManager && showSetup ? <CustodySetup onReady={reload} /> : null
  if (!showOperations) return null
  const eligible = staff.filter((row) => row.isActive && row.hasCustodyPin && !row.mustChangePin && (row.role === 'CASHIER' || row.role === 'MANAGER'))
  const managers = staff.filter((row) => row.isActive && row.role === 'MANAGER')
  const nameOf = (id: number | null | undefined) => staff.find((row) => row.id === id)?.name ?? 'کارمند انتخاب‌شده'
  const reset = (next: View = 'main') => {
    setView(next)
    setPassword('')
    setNewPassword('')
    setRepeatNewPassword('')
    setManagerPassword('')
    setCountedCash('')
    setNote('')
    setError(null)
  }
  const amount = () => {
    const value = Number(countedCash)
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('شمارش نقدی را به‌صورت عدد صحیحِ صفر یا بیشتر وارد کنید.')
    return value
  }
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      reset()
      await reload()
      window.dispatchEvent(new Event('mahak:shift-changed'))
    } catch (e: any) {
      setError(e?.message ?? 'عملیات انجام نشد.')
    } finally {
      setBusy(false)
    }
  }
  const showReminder = !!status.reminder?.due && status.reminder.bucket !== dismissedReminderBucket
  const pendingRecovery = status.autoTimeouts[0] ?? status.legacyStaleRecoveries[0] ?? status.policyTransitions[0] ?? status.staffDeactivationRecoveries[0] ?? null
  const pendingRecoveryIsLegacy = !status.autoTimeouts[0] && !!status.legacyStaleRecoveries[0]
  const pendingRecoveryIsPolicyTransition = !status.autoTimeouts[0] && !status.legacyStaleRecoveries[0] && !!status.policyTransitions[0]
  const pendingRecoveryIsStaffDeactivation = !status.autoTimeouts[0] && !status.legacyStaleRecoveries[0] && !status.policyTransitions[0] && !!status.staffDeactivationRecoveries[0]
  const title =
    status.state === 'HANDOVER_PENDING'
      ? `تحویل در انتظار تأیید ${nameOf(status.pendingHandover?.selectedRecipientUserId)}`
      : status.state === 'ACTIVE'
        ? `صندوق: ${status.custodian?.name ?? 'مسئول نامشخص'}`
        : 'صندوق بدون مسئول فعال'

  return (
    <>
      <button
        className={`text-xs px-2 py-1 rounded whitespace-nowrap font-bold ${status.state === 'HANDOVER_PENDING' ? 'bg-rose-600 hover:bg-rose-700' : status.state === 'ACTIVE' ? 'bg-emerald-700 hover:bg-emerald-800' : 'bg-amber-500 hover:bg-amber-600'}`}
        onClick={() => { setVisible(true); reset() }}
        title="حضانت صندوق: مسئول فعلی، تحویل احرازشده و بستن نهایی"
      >
        {status.state === 'HANDOVER_PENDING' ? '⚠ تحویل صندوق در انتظار تأیید' : status.state === 'ACTIVE' ? `صندوق · ${status.custodian?.name ?? 'فعال'}` : 'صندوق · نیازمند ورود'}
      </button>
      {visible ? createPortal(
        <div className="fixed inset-0 z-[80] bg-black/55 flex justify-center items-start overflow-auto p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setVisible(false) }}>
          <section className="w-full max-w-xl bg-white rounded-lg shadow-xl p-5 mt-8 text-slate-800" dir="rtl">
            <div className="flex items-start gap-3 border-b pb-3 mb-4">
              <div className="flex-1"><h2 className="font-bold text-lg">حضانت صندوق</h2><p className="text-xs text-slate-500 mt-1">{title} · تغییر مسئول فقط با رمز شخصی و شمارش کور انجام می‌شود.</p></div>
              <button className="text-slate-500 hover:text-slate-900 px-2" onClick={() => !busy && setVisible(false)} aria-label="بستن">×</button>
            </div>
            {showReminder ? <div className="mb-3 p-3 rounded border border-amber-300 bg-amber-50 text-sm"><b>یادآوری پایان برنامهٔ شیفت</b><br />برنامهٔ «{status.schedule?.title ?? 'شیفت'}» به پایان رسیده است. فروش متوقف نمی‌شود و همچنان به مسئول فعلی منتسب است؛ در زمان مناسب تحویل یا بستن نهایی را ثبت کنید.<button className="block mt-2 underline" onClick={() => setDismissedReminderBucket(status.reminder.bucket)}>فعلاً بستن این یادآوری</button></div> : null}
            {error ? <div className="mb-3 p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div> : null}
            {view === 'main' ? <>
              {status.autoTimeouts.length ? <div className="mb-3 p-3 bg-amber-50 border border-amber-400 text-sm rounded"><b>شیفت شب در سقف اضافه‌کاری به‌طور خودکار بسته شد.</b><br />ماندهٔ انتظاریِ دفتری: {status.autoTimeouts[0].expectedCash == null ? 'در حال تکمیل…' : money(status.autoTimeouts[0].expectedCash)} · انتظار کارت: {status.autoTimeouts[0].expectedCard == null ? 'در حال تکمیل…' : money(status.autoTimeouts[0].expectedCard)}.<br /><span className="text-slate-600">این اعداد شمارش فیزیکی نیستند. تحویل‌گیرنده باید با رمز خودش و شمارش مستقل، صندوق جدید را باز کند.</span><button className="block mt-2 underline font-bold" onClick={() => reset('timeoutAccept')}>شمارش و تحویل‌گیری شیفت منقضی‌شده</button></div> : null}
              {status.legacyStaleRecoveries.length ? <div className="mb-3 p-3 bg-amber-50 border border-amber-400 text-sm rounded"><b>یک نشست جاماندهٔ پیش از فعال‌سازی حضانت پیدا شد.</b><br />ماندهٔ انتظاریِ دفتری: {status.legacyStaleRecoveries[0].expectedCash == null ? 'در حال تکمیل…' : money(status.legacyStaleRecoveries[0].expectedCash)} · انتظار کارت: {status.legacyStaleRecoveries[0].expectedCard == null ? 'در حال تکمیل…' : money(status.legacyStaleRecoveries[0].expectedCard)}.<br /><span className="text-slate-600">مدیر لازم نیست: تحویل‌گیرنده با PIN خودش و شمارش مستقل، صندوق جدید را باز می‌کند. اختلاف احتمالی برای بررسی بعدی حفظ می‌شود.</span><button className="block mt-2 underline font-bold" onClick={() => reset('timeoutAccept')}>شمارش و بازیابی نشست جامانده</button></div> : null}
              {status.policyTransitions.length ? <div className="mb-3 p-3 bg-sky-50 border border-sky-400 text-sm rounded"><b>حالت برنامهٔ شیفت تغییر کرده است.</b><br />بخش قبلی بدون ادعای شمارش فیزیکی بسته و ماندهٔ دفتری آن حفظ شده است. نفر بعدی با PIN خودش و شمارش مستقل صندوق جدید را شروع می‌کند.<button className="block mt-2 underline font-bold" onClick={() => reset('timeoutAccept')}>شمارش و شروع مسئولیت با سیاست جدید</button></div> : null}
              {status.staffDeactivationRecoveries.length ? <div className="mb-3 p-3 bg-amber-50 border border-amber-400 text-sm rounded"><b>مسئول قبلی غیرفعال شده است.</b><br />مسئولیت گذشته و ماندهٔ دفتری حفظ شده؛ کارمند حاضر با PIN خودش و شمارش مستقل می‌تواند ادامه دهد.<button className="block mt-2 underline font-bold" onClick={() => reset('timeoutAccept')}>شمارش و ادامهٔ کار</button></div> : null}
              {status.unresolvedCount ? <div className="mb-3 p-3 bg-amber-50 border border-amber-300 text-sm rounded">{status.unresolvedCount} بستنِ شبِ بی‌پاسخ دارید. تا زمانی که مدیر آن را تعیین تکلیف کند، اختلافِ شب به مسئول صبح نسبت داده نمی‌شود. <button className="underline font-bold" onClick={() => reset('resolve')}>تعیین تکلیف مدیر</button></div> : null}
              {pendingRecovery ? <button className="mb-3 w-full btn-secondary py-2" onClick={() => reset('managerRecovery')}>تحویل‌گیری همین بازیابی با اختیار اضطراری مدیر</button> : null}
              {status.state === 'NO_SESSION' && !pendingRecovery ? <div className="grid grid-cols-1 gap-2"><button className="w-full btn-primary py-3" onClick={() => reset('open')}>ورود مسئول و باز کردن صندوق</button><button className="btn-secondary py-2" onClick={() => reset('emergencyOpen')}>پوشش اضطراریِ کارمند حاضر</button><button className="btn-secondary py-2" onClick={() => reset('managerOpen')}>اختیار اضطراری مدیر با رمز مدیر</button></div> : null}
              {status.state === 'ACTIVE' ? <div className="grid grid-cols-2 gap-3"><button className="btn-secondary py-3" onClick={() => reset('handover')}>تحویل به کارمند دیگر</button><button className="btn-primary py-3" onClick={() => reset('close')}>بستن نهایی صندوق</button></div> : null}
              {status.state === 'HANDOVER_PENDING' ? <div className="grid grid-cols-2 gap-3"><button className="btn-primary py-3" onClick={() => reset('accept')}>تأیید تحویل‌گیرنده</button><button className="btn-secondary py-3" onClick={() => reset('handover')}>لغو با رمز تحویل‌دهنده</button></div> : null}
              {staff.some((row) => row.isActive && row.hasCustodyPin && row.mustChangePin) ? <button className="mt-3 text-sm underline text-slate-700" onClick={() => reset('changePin')}>تغییر رمز موقت کارکنان</button> : null}
            </> : null}
            {view === 'open' ? <div className="space-y-3">{staff.some((row) => row.isActive && row.hasCustodyPin && row.mustChangePin) ? <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm leading-6">برای کارمندی که رمز موقت دارد، ابتدا باید رمز شخصی ثبت شود. <button className="font-bold underline" onClick={() => reset('changePin')} disabled={busy}>تغییر رمز موقت کارکنان</button></div> : null}<CredentialForm staff={eligible} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} label="موجودی فیزیکی اول صندوق" submit="باز کردن صندوق" busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('مسئول صندوق را انتخاب کنید.'); await call(CH.custodyOpen, { userId: selectedUserId, password, countedCash: amount() })})} /></div> : null}
            {view === 'emergencyOpen' ? <CredentialForm staff={eligible} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} label="شمارش فیزیکی اول صندوق" submit="ثبت پوشش اضطراری" busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('کارمند حاضر را انتخاب کنید.'); if (note.trim().length < 3) throw new Error('دلیل کوتاهِ غیبت کارمند برنامه‌ریزی‌شده را بنویسید.'); await call(CH.custodyOpen, { userId: selectedUserId, password, countedCash: amount(), note: note.trim(), emergencyCoverage: true })})} /> : null}
            {view === 'managerOpen' ? <ManagerOverrideForm managers={managers} selected={managerId} setSelected={setManagerId} password={managerPassword} setPassword={setManagerPassword} amount={countedCash} setAmount={setCountedCash} busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!managerId) throw new Error('مدیر فعال را انتخاب کنید.'); await call(CH.custodyOpen, { userId: managerId, managerPassword, managerOverride: true, countedCash: amount() })})} /> : null}
            {view === 'managerRecovery' && pendingRecovery ? <ManagerOverrideForm actionLabel="شمارش و تحویل‌گیری با اختیار مدیر" managers={managers} selected={managerId} setSelected={setManagerId} password={managerPassword} setPassword={setManagerPassword} amount={countedCash} setAmount={setCountedCash} busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!managerId) throw new Error('مدیر فعال را انتخاب کنید.'); await call(CH.custodyAutoTimeoutAccept, { resolutionId: pendingRecovery.id, userId: managerId, managerPassword, managerOverride: true, countedCash: amount(), note: note.trim() || undefined })})} /> : null}
            {view === 'timeoutAccept' && pendingRecovery ? <AutoTimeoutAcceptForm legacy={pendingRecoveryIsLegacy} policyTransition={pendingRecoveryIsPolicyTransition} staffDeactivation={pendingRecoveryIsStaffDeactivation} staff={eligible} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} expectedCash={pendingRecovery.expectedCash} expectedCard={pendingRecovery.expectedCard} busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('تحویل‌گیرنده را انتخاب کنید.'); await call(CH.custodyAutoTimeoutAccept, { resolutionId: pendingRecovery.id, userId: selectedUserId, password, countedCash: amount(), note: note.trim() || undefined }) })} /> : null}
            {view === 'changePin' ? <ChangeTemporaryPinForm staff={staff.filter((row) => row.isActive && row.hasCustodyPin && row.mustChangePin)} selected={selectedUserId} setSelected={setSelectedUserId} temporaryPassword={password} setTemporaryPassword={setPassword} newPassword={newPassword} setNewPassword={setNewPassword} repeatNewPassword={repeatNewPassword} setRepeatNewPassword={setRepeatNewPassword} busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('کارمند دارای رمز موقت را انتخاب کنید.'); if (newPassword !== repeatNewPassword) throw new Error('تکرار رمز جدید یکسان نیست.'); await call(CH.custodyPinSet, { userId: selectedUserId, currentPassword: password, newPassword }) })} /> : null}
            {view === 'handover' ? status.state === 'HANDOVER_PENDING' ? <PasswordOnly label="برای لغو تحویل، مسئول قبلی رمز خودش را وارد می‌کند" password={password} setPassword={setPassword} busy={busy} onBack={() => reset()} submit="لغو تحویل" onSubmit={() => run(() => call(CH.custodyHandoverCancel, { handoverId: status.pendingHandover?.id, password }))} /> : <CredentialForm staff={eligible.filter((row) => row.id !== status.custodian?.id)} selected={recipientId} setSelected={setRecipientId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} label="شمارش کور پیش از تحویل" submit="شروع تحویل" busy={busy} onBack={() => reset()} selectLabel="تحویل‌گیرنده" onSubmit={() => run(async () => { if (!recipientId) throw new Error('تحویل‌گیرنده را انتخاب کنید.'); await call(CH.custodyHandoverStart, { toUserId: recipientId, password, countedCash: amount(), note: note.trim() || undefined }) })} /> : null}
            {view === 'accept' ? <PasswordOnly label={`فقط ${nameOf(status.pendingHandover?.selectedRecipientUserId)} با رمز شخصی خود و شمارش مستقل نقد می‌تواند این تحویل را بپذیرد. معیار پذیرش، اختلاف دقیقاً صفر است؛ تا آن زمان فروش به مسئول فعلی منتسب می‌ماند.`} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} busy={busy} onBack={() => reset()} submit="شمارش و پذیرش تحویل" onSubmit={() => run(() => call(CH.custodyHandoverAccept, { handoverId: status.pendingHandover?.id, password, countedCash: amount() }))} /> : null}
            {view === 'close' ? <PasswordOnly label="شمارش نقدی و رمز مسئول فعلی لازم است. پول می‌تواند در کشو بماند؛ در این نسخه ثبت تحویل به مدیر/بانک از تنظیمات تکمیلی انجام می‌شود." password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} busy={busy} onBack={() => reset()} submit="ثبت بستن نهایی" onSubmit={() => run(() => call(CH.custodyFinalClose, { password, countedCash: amount(), note: note.trim() || undefined, dispositions: [{ kind: 'KEEP_IN_DRAWER', amount: amount() }] }))} /> : null}
            {view === 'resolve' ? <ResolveForm resolutions={status.unresolved} managers={managers} managerId={managerId} setManagerId={setManagerId} password={managerPassword} setPassword={setManagerPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} busy={busy} onBack={() => reset()} onSubmit={(id) => run(async () => { if (!managerId) throw new Error('مدیر تصمیم‌گیرنده را انتخاب کنید.'); await call(CH.custodyUnresolvedResolve, { resolutionId: id, managerUserId: managerId, managerPassword, countedCash: amount(), reason: note.trim(), attribution: 'UNASSIGNED' }) })} /> : null}
          </section>
        </div>, document.body) : null}
    </>
  )
}

/** Initial activation is visible only inside the established manager session.
 * The main process still verifies the existing manager secret before it creates
 * the first personal manager credential, so this convenience UI is never the
 * security boundary. */
function CustodySetup({ onReady }: { onReady: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activate = async () => {
    setBusy(true); setError(null)
    try {
      /** The IPC handler derives manager authority from Main. A clean install
       * starts with the deliberately simple, unscheduled single-shift mode. */
      await call(CH.custodyConfigSet, { config: { enabled: true, mode: 'SINGLE_SHIFT' } })
      await onReady()
      setOpen(false)
    } catch (e: any) { setError(e?.message ?? 'راه‌اندازی انجام نشد.') } finally { setBusy(false) }
  }
  return <><button className="text-xs px-2 py-1 rounded whitespace-nowrap font-bold bg-amber-500 hover:bg-amber-600" onClick={() => setOpen(true)}>راه‌اندازی حضانت صندوق</button>{open ? createPortal(<div className="fixed inset-0 z-[80] bg-black/55 flex justify-center items-start overflow-auto p-4"><section className="w-full max-w-lg bg-white rounded-lg shadow-xl p-5 mt-8 text-slate-800" dir="rtl"><h2 className="font-bold text-lg border-b pb-3">راه‌اندازی حضانت صندوق</h2><p className="text-sm leading-6 mt-3">حضانت ابتدا در حالت <b>تک‌شیفت</b> فعال می‌شود: تعریف کارمند یا برنامهٔ زمانی اجباری نیست. برای چندکارمندی، ابتدا در «مدیریت حضانت» کارکنان و رمزهای موقت را ثبت کنید، سپس برنامهٔ دارای کارمند بسازید و حالت چندشیفت را آگاهانه فعال کنید.</p><p className="text-xs leading-5 mt-3 text-slate-600">برای باز کردن نخستین صندوق، مدیر می‌تواند از مدیریت حضانت برای خودش رمز موقت صادر کند و از گزینهٔ «تغییر رمز موقت» در کنترل صندوق، آن را شخصی‌سازی کند.</p>{error ? <div className="my-3 p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div> : null}<div className="flex gap-2 mt-5"><button className="btn-secondary flex-1" disabled={busy} onClick={() => setOpen(false)}>انصراف</button><button className="btn-primary flex-1" disabled={busy} onClick={() => void activate()}>{busy ? 'در حال فعال‌سازی…' : 'فعال‌سازی تک‌شیفت'}</button></div></section></div>, document.body) : null}</>
}

function ChangeTemporaryPinForm({ staff, selected, setSelected, temporaryPassword, setTemporaryPassword, newPassword, setNewPassword, repeatNewPassword, setRepeatNewPassword, busy, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-slate-50 p-3 rounded">رمز موقت فقط برای یک‌بار استفاده است. هر کارمند فقط با رمز موقت خودش می‌تواند رمز شخصی خود را تعیین کند؛ مدیر هرگز رمز نهایی را نمی‌بیند.</p><label className="block text-sm">کارمند<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-sm">رمز موقت<input className="input mt-1 w-full" type="password" value={temporaryPassword} onChange={(e) => setTemporaryPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">رمز شخصی جدید<input className="input mt-1 w-full" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" /></label><label className="block text-sm">تکرار رمز شخصی<input className="input mt-1 w-full" type="password" value={repeatNewPassword} onChange={(e) => setRepeatNewPassword(e.target.value)} autoComplete="new-password" /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : 'ثبت رمز شخصی'}</button></div></div>
}

function ManagerOverrideForm({ managers, selected, setSelected, password, setPassword, amount, setAmount, actionLabel = 'باز کردن با اختیار مدیر', busy, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-sky-50 border border-sky-300 p-3 rounded">رمز اصلی مدیر، برنامهٔ شیفت را دور می‌زند؛ اما صندوق واقعاً به نام همان مدیرِ انتخاب‌شده باز می‌شود و در رویداد حسابرسی ثبت خواهد شد.</p><label className="block text-sm">مدیر فعال<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{managers.map((row: Staff) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-sm">رمز اصلی مدیر<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label className="block text-sm">شمارش فیزیکی اول صندوق<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : actionLabel}</button></div></div>
}

function CredentialForm({ staff, selected, setSelected, password, setPassword, amount, setAmount, note, setNote, label, submit, busy, onBack, onSubmit, selectLabel = 'مسئول صندوق' }: any) {
  return <div className="space-y-3"><label className="block text-sm">{selectLabel}<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name} ({row.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}</select></label><label className="block text-sm">رمز شخصی<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">{label}<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label>{setNote ? <label className="block text-sm">دلیل پوشش اضطراری<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label> : null}<div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : submit}</button></div></div>
}
function AutoTimeoutAcceptForm({ legacy = false, policyTransition = false, staffDeactivation = false, staff, selected, setSelected, password, setPassword, amount, setAmount, note, setNote, expectedCash, expectedCard, busy, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-amber-50 border border-amber-300 p-3 rounded"><b>{staffDeactivation ? 'ادامه پس از غیرفعال‌سازی مسئول' : policyTransition ? 'تحویل پس از تغییر حالت شیفت' : legacy ? 'بازیابی نشست جامانده' : 'تحویل شیفت منقضی‌شده'}</b><br />ماندهٔ دفتریِ {legacy ? 'نشست جامانده' : 'شیفت قبل'}: {expectedCash == null ? 'در حال تکمیل…' : money(expectedCash)} · انتظار کارت: {expectedCard == null ? 'در حال تکمیل…' : money(expectedCard)}.<br />این‌ها شمارش فیزیکی نیستند. شمارش شما موجودی اول صندوق جدید می‌شود؛ در صورت اختلاف، مغایرت با {legacy ? 'نشست جامانده' : 'شیفت قبل'} ثبت می‌شود و فروش متوقف نمی‌ماند.</p><label className="block text-sm">تحویل‌گیرنده<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name} ({row.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}</select></label><label className="block text-sm">رمز شخصی تحویل‌گیرنده<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">شمارش مستقلِ نقد کشو<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label><label className="block text-sm">توضیح در صورت مغایرت <span className="text-slate-500">(اگر شمارش با ماندهٔ دفتری فرق دارد، اجباری است)</span><textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy || expectedCash == null || expectedCard == null}>{busy ? 'در حال ثبت…' : 'ثبت شمارش و شروع صندوق جدید'}</button></div></div>
}

function PasswordOnly({ label, password, setPassword, amount, setAmount, note, setNote, submit, busy, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-slate-50 p-3 rounded">{label}</p><label className="block text-sm">رمز شخصی<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>{setAmount ? <label className="block text-sm">شمارش نقدی<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label> : null}{setNote ? <label className="block text-sm">یادداشت (برای بستن خالی ضروری است)<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label> : null}<div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : submit}</button></div></div>
}
function ResolveForm({ resolutions, managers, managerId, setManagerId, password, setPassword, amount, setAmount, note, setNote, busy, onBack, onSubmit }: any) {
  const [resolutionId, setResolutionId] = useState<number | ''>(resolutions[0]?.id ?? '')
  return <div className="space-y-3"><p className="text-sm bg-amber-50 p-3 rounded">این تصمیم صرفاً شب گذشته را می‌بندد و مسئولیت صندوق فعال صبح را تغییر نمی‌دهد.</p><label className="block text-sm">پرونده شب<select className="input mt-1 w-full" value={resolutionId} onChange={(e) => setResolutionId(Number(e.target.value))}>{resolutions.map((row: any) => <option key={row.id} value={row.id}>نشست {row.shiftId}{row.nightExpectedCash != null ? ` · انتظار ${money(row.nightExpectedCash)}` : ''}</option>)}</select></label><label className="block text-sm">مدیر تصمیم‌گیرنده<select className="input mt-1 w-full" value={managerId} onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{managers.map((row: Staff) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-sm">رمز مدیر<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label className="block text-sm">شمارش نقدی شب<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} /></label><label className="block text-sm">دلیل تصمیم (حداقل ۱۰ حرف)<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" disabled={busy || !resolutionId} onClick={() => onSubmit(resolutionId)}>{busy ? 'در حال ثبت…' : 'ثبت تصمیم مدیر'}</button></div></div>
}
