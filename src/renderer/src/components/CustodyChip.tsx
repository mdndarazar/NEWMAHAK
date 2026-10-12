import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { call, CH } from '../lib/api'
import { money } from '@shared/jalali'
import { useTopmostModalKey } from './Modal'
import { useManagerSession } from '../hooks/useManagerSession'

type Staff = { id: number; name: string; role: string; isActive: boolean; hasCustodyPin: boolean; mustChangePin: boolean }
type Status = {
  enabled: boolean
  /** Durable main-process verdict; a recovery case can govern even if a stale
   * config row says the feature is disabled. */
  governed?: boolean
  state: 'NO_SESSION' | 'ACTIVE' | 'HANDOVER_PENDING' | string
  epoch: number
  custodian: { id: number; name: string | null } | null
  shift: { id: number; name: string; openedAt: string } | null
  pendingHandover: { id: number; fromUserId: number; selectedRecipientUserId: number; startedAt: string; status?: string; resolutionKind?: string | null; countedAtStart?: number; resolutionReason?: string | null } | null
  schedule: { planId: number; title: string; scheduledEndAt: string } | null
  reminder: { due: boolean; bucket: number | null; repeatMinutes: number; scheduledEndAt: string | null }
  unresolvedCount: number
  unresolved: Array<{ id: number; shiftId: number; openedAt: string; nightExpectedCash: number | null }>
}

type View = 'main' | 'open' | 'handover' | 'accept' | 'emergency' | 'masterOverride' | 'close' | 'recover' | 'resolve' | 'changePin'

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
  // An OPEN recovery record is still a custody operation even if a stale or
  // manually altered config row says disabled. Keep the PIN/count recovery UI
  // available; hiding it would strand the drawer after legacy paths close.
  const governed = status.governed === true || status.enabled === true
  if (!governed) return isManager && showSetup ? <CustodySetup onReady={reload} /> : null
  if (!showOperations) return null
  const eligible = staff.filter((row) => row.isActive && row.hasCustodyPin && !row.mustChangePin && (row.role === 'CASHIER' || row.role === 'MANAGER'))
  const managers = eligible.filter((row) => row.role === 'MANAGER')
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
  const resumeEmergency = () => {
    const pending = status.pendingHandover
    reset('emergency')
    if (pending?.status === 'EMERGENCY_RECOUNT') {
      setSelectedUserId(pending.selectedRecipientUserId)
      setCountedCash(pending.countedAtStart == null ? '' : String(pending.countedAtStart))
      setNote(pending.resolutionReason ?? '')
    }
  }
  const resumeMasterOverride = () => {
    const pending = status.pendingHandover
    reset('masterOverride')
    if (pending?.status === 'MASTER_OVERRIDE_RECOUNT') {
      setManagerId(pending.selectedRecipientUserId)
      setCountedCash(pending.countedAtStart == null ? '' : String(pending.countedAtStart))
      setNote(pending.resolutionReason ?? '')
    }
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
  const emergencyInProgress = status.state === 'HANDOVER_RECOUNT' && status.pendingHandover?.status === 'EMERGENCY_RECOUNT'
  const masterOverrideInProgress = status.state === 'HANDOVER_RECOUNT' && status.pendingHandover?.status === 'MASTER_OVERRIDE_RECOUNT'
  const title =
    masterOverrideInProgress
      ? `شمارش Master Override مدیر ${nameOf(status.pendingHandover?.selectedRecipientUserId)} در حال ثبت است`
      : emergencyInProgress
      ? `شمارش پوشش اضطراریِ ${nameOf(status.pendingHandover?.selectedRecipientUserId)} در حال ثبت است`
      : status.state === 'HANDOVER_PENDING'
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
        {masterOverrideInProgress ? '⚠ Master Override در حال ثبت' : emergencyInProgress ? '⚠ پوشش اضطراری در حال ثبت' : status.state === 'HANDOVER_PENDING' ? '⚠ تحویل صندوق در انتظار تأیید' : status.state === 'ACTIVE' ? `صندوق · ${status.custodian?.name ?? 'فعال'}` : 'صندوق · نیازمند ورود'}
      </button>
      {visible ? createPortal(
        <div className="fixed inset-0 z-[80] bg-black/55 flex justify-center items-start overflow-auto p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setVisible(false) }}>
          <section className="w-full max-w-xl bg-white rounded-lg shadow-xl p-5 mt-8 text-slate-800" dir="rtl">
            <div className="flex items-start gap-3 border-b pb-3 mb-4">
              <div className="flex-1"><h2 className="font-bold text-lg">حضانت صندوق</h2><p className="text-xs text-slate-500 mt-1">{title} · تغییر مسئول با PIN شخصی و شمارش مستقل انجام می‌شود؛ Master Override فقط استثنای مدیر با رمز مشترک است.</p></div>
              <button className="text-slate-500 hover:text-slate-900 px-2" onClick={() => !busy && setVisible(false)} aria-label="بستن">×</button>
            </div>
            {showReminder ? <div className="mb-3 p-3 rounded border border-amber-300 bg-amber-50 text-sm"><b>یادآوری پایان برنامهٔ شیفت</b><br />برنامهٔ «{status.schedule?.title ?? 'شیفت'}» به پایان رسیده است. فروش متوقف نمی‌شود و همچنان به مسئول فعلی منتسب است؛ در زمان مناسب تحویل یا بستن نهایی را ثبت کنید.<button className="block mt-2 underline" onClick={() => setDismissedReminderBucket(status.reminder.bucket)}>فعلاً بستن این یادآوری</button></div> : null}
            {error ? <div className="mb-3 p-2 rounded bg-red-50 text-red-700 text-sm">{error}</div> : null}
            {view === 'main' ? <>
              {status.unresolvedCount ? <div className="mb-3 p-3 bg-amber-50 border border-amber-300 text-sm rounded">{status.unresolvedCount} شیفتِ رهاشده/منقضی دارید. هر کارمند فعال با رمز شخصی و شمارش فیزیکی صبح می‌تواند آن را بازیابی کند؛ نه PIN مسئول قبلی و نه PIN مدیر لازم نیست. <button className="underline font-bold" onClick={() => reset('recover')}>ثبت شمارش شاهد صبح</button>{isManager ? <> <span className="text-slate-500">·</span> <button className="underline" onClick={() => reset('resolve')}>تعیین تکلیف مدیر</button></> : null}</div> : null}
              {status.state === 'NO_SESSION' ? <button className="w-full btn-primary py-3" onClick={() => reset('open')}>ورود مسئول و باز کردن صندوق</button> : null}
              {status.state === 'ACTIVE' ? <div className={`grid gap-3 ${isManager ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'}`}><button className="btn-secondary py-3" onClick={() => reset('handover')}>تحویل عادی</button><button className="btn-secondary py-3" onClick={() => reset('emergency')}>پوشش اضطراری</button>{isManager ? <button className="btn-secondary py-3 border-amber-400 text-amber-900" onClick={() => reset('masterOverride')}>Master Override</button> : null}<button className="btn-primary py-3" onClick={() => reset('close')}>بستن نهایی</button></div> : null}
              {status.state === 'HANDOVER_PENDING' ? <div className="grid grid-cols-2 gap-3"><button className="btn-primary py-3" onClick={() => reset('accept')}>تأیید تحویل‌گیرنده</button><button className="btn-secondary py-3" onClick={() => reset('handover')}>لغو با رمز تحویل‌دهنده</button></div> : null}
              {emergencyInProgress ? <div className="p-3 rounded bg-amber-50 text-sm leading-6">شمارش پوشش اضطراری برای <b>{nameOf(status.pendingHandover?.selectedRecipientUserId)}</b> موقتاً صندوق را freeze کرده است. همان کارمند باید با همان PIN، شمارش و دلیل، ثبت را ادامه دهد.<button className="block mt-2 underline font-bold" onClick={resumeEmergency}>ادامهٔ پوشش اضطراری</button></div> : null}
              {masterOverrideInProgress ? <div className="p-3 rounded bg-amber-50 text-sm leading-6">Master Override برای مدیر <b>{nameOf(status.pendingHandover?.selectedRecipientUserId)}</b> موقتاً صندوق را freeze کرده است. همان مدیر با همان رمز مشترک مدیر، شمارش و دلیل باید ثبت را ادامه دهد.<button className="block mt-2 underline font-bold" onClick={resumeMasterOverride}>ادامهٔ Master Override</button></div> : null}
              {staff.some((row) => row.isActive && row.hasCustodyPin && row.mustChangePin) ? <button className="mt-3 text-sm underline text-slate-700" onClick={() => reset('changePin')}>تغییر رمز موقت کارکنان</button> : null}
            </> : null}
            {view === 'open' ? <CredentialForm staff={eligible} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} label="موجودی فیزیکی اول صندوق" submit="باز کردن صندوق" busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('مسئول صندوق را انتخاب کنید.'); await call(CH.custodyOpen, { userId: selectedUserId, password, countedCash: amount() }) })} /> : null}
            {view === 'changePin' ? <ChangeTemporaryPinForm staff={staff.filter((row) => row.isActive && row.hasCustodyPin && row.mustChangePin)} selected={selectedUserId} setSelected={setSelectedUserId} temporaryPassword={password} setTemporaryPassword={setPassword} newPassword={newPassword} setNewPassword={setNewPassword} repeatNewPassword={repeatNewPassword} setRepeatNewPassword={setRepeatNewPassword} busy={busy} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('کارمند دارای رمز موقت را انتخاب کنید.'); if (newPassword !== repeatNewPassword) throw new Error('تکرار رمز جدید یکسان نیست.'); await call(CH.custodyPinSet, { userId: selectedUserId, currentPassword: password, newPassword }) })} /> : null}
            {view === 'handover' ? status.state === 'HANDOVER_PENDING' ? <PasswordOnly label="برای لغو تحویل، مسئول قبلی رمز خودش را وارد می‌کند" password={password} setPassword={setPassword} busy={busy} onBack={() => reset()} submit="لغو تحویل" onSubmit={() => run(() => call(CH.custodyHandoverCancel, { handoverId: status.pendingHandover?.id, password }))} /> : <CredentialForm staff={eligible.filter((row) => row.id !== status.custodian?.id)} selected={recipientId} setSelected={setRecipientId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} label="شمارش کور پیش از تحویل" submit="شروع تحویل" busy={busy} onBack={() => reset()} selectLabel="تحویل‌گیرنده" onSubmit={() => run(async () => { if (!recipientId) throw new Error('تحویل‌گیرنده را انتخاب کنید.'); await call(CH.custodyHandoverStart, { toUserId: recipientId, password, countedCash: amount(), note: note.trim() || undefined }) })} /> : null}
            {view === 'accept' ? <PasswordOnly label={`فقط ${nameOf(status.pendingHandover?.selectedRecipientUserId)} با رمز شخصی خود و شمارش مستقل نقد می‌تواند این تحویل را بپذیرد. اگر شمارش با نقد انتظاری اختلاف دارد، دلیل روشن را بنویسید تا اختلاف به نشست مسئول قبلی ثبت شود و شما با شمارش واقعی خودتان شروع کنید.`} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} noteLabel="دلیل مغایرت (فقط اگر شمارش با انتظار اختلاف دارد؛ حداقل ۱۰ حرف)" busy={busy} onBack={() => reset()} submit="شمارش و پذیرش تحویل" onSubmit={() => run(() => call(CH.custodyHandoverAccept, { handoverId: status.pendingHandover?.id, password, countedCash: amount(), differenceReason: note.trim() || undefined }))} /> : null}
            {view === 'emergency' ? <EmergencyCoverForm staff={eligible.filter((row) => row.id !== status.custodian?.id)} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} reason={note} setReason={setNote} busy={busy} inProgress={emergencyInProgress} onBack={() => reset()} onSubmit={() => run(async () => { if (!selectedUserId) throw new Error('کارمند پوشش‌دهنده را انتخاب کنید.'); await call(CH.custodyEmergencyCover, { userId: selectedUserId, password, countedCash: amount(), reason: note.trim() }) })} /> : null}
            {view === 'masterOverride' ? <MasterOverrideForm managers={managers.filter((row) => row.id !== status.custodian?.id)} managerId={managerId} setManagerId={setManagerId} managerPassword={managerPassword} setManagerPassword={setManagerPassword} amount={countedCash} setAmount={setCountedCash} reason={note} setReason={setNote} busy={busy} inProgress={masterOverrideInProgress} onBack={() => reset()} onSubmit={() => run(async () => { if (!managerId) throw new Error('مدیر مسئول Master Override را انتخاب کنید.'); await call(CH.custodyMasterOverride, { managerUserId: managerId, managerPassword, countedCash: amount(), reason: note.trim() }) })} /> : null}
            {view === 'close' ? <PasswordOnly label="شمارش نقدی و رمز مسئول فعلی لازم است. پول می‌تواند در کشو بماند؛ در این نسخه ثبت تحویل به مدیر/بانک از تنظیمات تکمیلی انجام می‌شود." password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} busy={busy} onBack={() => reset()} submit="ثبت بستن نهایی" onSubmit={() => run(() => call(CH.custodyFinalClose, { password, countedCash: amount(), note: note.trim() || undefined, dispositions: [{ kind: 'KEEP_IN_DRAWER', amount: amount() }] }))} /> : null}
            {view === 'recover' ? <MorningRecoveryForm resolutions={status.unresolved} staff={eligible} selected={selectedUserId} setSelected={setSelectedUserId} password={password} setPassword={setPassword} amount={countedCash} setAmount={setCountedCash} note={note} setNote={setNote} busy={busy} onBack={() => reset()} onSubmit={(resolutionId) => run(async () => { if (!selectedUserId) throw new Error('شاهد صبح را انتخاب کنید.'); await call(CH.custodyUnattendedRecover, { resolutionId, userId: selectedUserId, password, countedCash: amount(), note: note.trim() || undefined }) })} /> : null}
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

function CredentialForm({ staff, selected, setSelected, password, setPassword, amount, setAmount, label, submit, busy, onBack, onSubmit, selectLabel = 'مسئول صندوق' }: any) {
  return <div className="space-y-3"><label className="block text-sm">{selectLabel}<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name} ({row.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}</select></label><label className="block text-sm">رمز شخصی<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">{label}<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : submit}</button></div></div>
}
function EmergencyCoverForm({ staff, selected, setSelected, password, setPassword, amount, setAmount, reason, setReason, busy, inProgress, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-rose-50 border border-rose-200 p-3 rounded"><b>پوشش اضطراری</b> فقط وقتی استفاده می‌شود که مسئول فعلی حاضر نیست. شخص پوشش‌دهنده با PIN خودش و شمارش فیزیکی مسئولیت segment تازه را می‌گیرد؛ دلیل و اختلاف روی segment مسئول قبلی می‌ماند.</p>{inProgress ? <p className="text-xs leading-5 text-amber-800">برای ادامه، دقیقاً همان کارمند، شمارش و دلیل ثبت‌شده را وارد کنید.</p> : null}<label className="block text-sm">کارمند پوشش‌دهنده<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name} ({row.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}</select></label><label className="block text-sm">PIN شخصی کارمند پوشش‌دهنده<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">شمارش فیزیکی صندوق<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label><label className="block text-sm">دلیل اضطراری (حداقل ۱۰ حرف)<textarea className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" disabled={busy} onClick={onSubmit}>{busy ? 'در حال ثبت…' : inProgress ? 'ادامه و تکمیل پوشش' : 'ثبت پوشش اضطراری'}</button></div></div>
}
function MasterOverrideForm({ managers, managerId, setManagerId, managerPassword, setManagerPassword, amount, setAmount, reason, setReason, busy, inProgress, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-rose-50 border border-rose-200 p-3 rounded"><b>Master Override</b> مسیر استثناییِ مدیر است، نه تحویل عادی: مدیر فعالِ انتخاب‌شده با <b>رمز مشترک مدیر</b> و شمارش فیزیکی، مسئولیت بخش جدید را می‌پذیرد. اختلاف و دلیل روی بخش مسئول قبلی ثبت می‌شود؛ رمز شخصی مدیر در این فرم وارد نمی‌شود.</p>{inProgress ? <p className="text-xs leading-5 text-amber-800">برای ادامه، دقیقاً همان مدیر، شمارش و دلیل ثبت‌شده را با رمز مشترک مدیر وارد کنید.</p> : null}<label className="block text-sm">مدیر مسئول Master Override<select className="input mt-1 w-full" value={managerId} onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{managers.map((row: Staff) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-sm">رمز مشترک مدیر<input className="input mt-1 w-full" type="password" value={managerPassword} onChange={(e) => setManagerPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">شمارش فیزیکی صندوق<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label><label className="block text-sm">دلیل Master Override (حداقل ۱۰ حرف)<textarea className="input mt-1 w-full" value={reason} onChange={(e) => setReason(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" disabled={busy} onClick={onSubmit}>{busy ? 'در حال ثبت…' : inProgress ? 'ادامه و تکمیل Override' : 'ثبت Master Override'}</button></div></div>
}
function PasswordOnly({ label, password, setPassword, amount, setAmount, note, setNote, noteLabel = 'یادداشت (برای بستن خالی ضروری است)', submit, busy, onBack, onSubmit }: any) {
  return <div className="space-y-3"><p className="text-sm leading-6 bg-slate-50 p-3 rounded">{label}</p><label className="block text-sm">رمز شخصی<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>{setAmount ? <label className="block text-sm">شمارش نقدی<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label> : null}{setNote ? <label className="block text-sm">{noteLabel}<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label> : null}<div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" onClick={onSubmit} disabled={busy}>{busy ? 'در حال ثبت…' : submit}</button></div></div>
}
function MorningRecoveryForm({ resolutions, staff, selected, setSelected, password, setPassword, amount, setAmount, note, setNote, busy, onBack, onSubmit }: any) {
  const [resolutionId, setResolutionId] = useState<number | ''>(resolutions[0]?.id ?? '')
  return <div className="space-y-3"><p className="text-sm leading-6 bg-amber-50 p-3 rounded">این شمارش، سند شبِ رهاشده را با مبلغ واقعی صبح می‌بندد؛ مسئولیت صندوق جدید ایجاد نمی‌کند. پس از آن، مسئول صبح باید جداگانه با PIN و شمارش خودش صندوق را باز کند.</p><label className="block text-sm">پروندهٔ شیفت رهاشده<select className="input mt-1 w-full" value={resolutionId} onChange={(e) => setResolutionId(Number(e.target.value))}>{resolutions.map((row: any) => <option key={row.id} value={row.id}>نشست {row.shiftId}{row.nightExpectedCash != null ? ` · نقد مورد انتظار ${money(row.nightExpectedCash)}` : ''}</option>)}</select></label><label className="block text-sm">شاهد صبح<select className="input mt-1 w-full" value={selected} onChange={(e) => setSelected(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{staff.map((row: Staff) => <option key={row.id} value={row.id}>{row.name} ({row.role === 'MANAGER' ? 'مدیر' : 'صندوقدار'})</option>)}</select></label><label className="block text-sm">رمز شخصی شاهد<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label><label className="block text-sm">شمارش واقعی صبح<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} placeholder="۰" /></label><label className="block text-sm">یادداشت شاهد (در صورت مغایرت طبق سیاست صندوق لازم است)<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" disabled={busy || !resolutionId} onClick={() => onSubmit(resolutionId)}>{busy ? 'در حال ثبت…' : 'ثبت شمارش صبح'}</button></div></div>
}
function ResolveForm({ resolutions, managers, managerId, setManagerId, password, setPassword, amount, setAmount, note, setNote, busy, onBack, onSubmit }: any) {
  const [resolutionId, setResolutionId] = useState<number | ''>(resolutions[0]?.id ?? '')
  return <div className="space-y-3"><p className="text-sm bg-amber-50 p-3 rounded">این تصمیم صرفاً شب گذشته را می‌بندد و مسئولیت صندوق فعال صبح را تغییر نمی‌دهد.</p><label className="block text-sm">پرونده شب<select className="input mt-1 w-full" value={resolutionId} onChange={(e) => setResolutionId(Number(e.target.value))}>{resolutions.map((row: any) => <option key={row.id} value={row.id}>نشست {row.shiftId}{row.nightExpectedCash != null ? ` · انتظار ${money(row.nightExpectedCash)}` : ''}</option>)}</select></label><label className="block text-sm">مدیر تصمیم‌گیرنده<select className="input mt-1 w-full" value={managerId} onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : '')}><option value="">انتخاب کنید…</option>{managers.map((row: Staff) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label><label className="block text-sm">رمز مدیر<input className="input mt-1 w-full" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><label className="block text-sm">شمارش نقدی شب<input className="input mt-1 w-full" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} /></label><label className="block text-sm">دلیل تصمیم (حداقل ۱۰ حرف)<textarea className="input mt-1 w-full" value={note} onChange={(e) => setNote(e.target.value)} /></label><div className="flex gap-2"><button className="btn-secondary flex-1" onClick={onBack} disabled={busy}>بازگشت</button><button className="btn-primary flex-1" disabled={busy || !resolutionId} onClick={() => onSubmit(resolutionId)}>{busy ? 'در حال ثبت…' : 'ثبت تصمیم مدیر'}</button></div></div>
}
