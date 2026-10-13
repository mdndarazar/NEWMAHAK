import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'
import type { ShiftInfo, ShiftSessionForm, ShiftStatusInfo } from '@shared/types'
import { useTopmostModalKey } from './Modal'

/**
 * ===========================================================================
 * جلسه ۱۹ — فرم «نشست صندوق» (باز کردن نشست · تعویض کارمند · تأیید کارمند)
 *
 * چرا این فرم وجود دارد؟ چون «کدام شیفت» و «کدام کارمند» دو چیز جدا هستند و
 * هیچ‌کدام را نمی‌توان از ساعت دیواری حدس زد:
 *   • بند ۲ — نام شیفت را سیستم بر اساس ساعت **پیشنهاد** می‌دهد و پیش‌فرض
 *     انتخاب‌شده نشان می‌دهد؛ کاربر می‌تواند عوضش کند، ولی هر نامِ غیرپیشنهادی
 *     یک **دلیل اجباری** می‌خواهد که روی خود نشست ذخیره می‌شود (و در گزارش
 *     «نشست‌های با نام override‌شده» دیده می‌شود).
 *   • بند ۳ — انتخاب کارمند **اجباری** است. آخرین کارمند نشست قبلی فقط
 *     پیش‌فرضِ highlight‌شده است و هیچ‌وقت خودکار و بی‌صدا تأیید نمی‌شود؛ کاربر
 *     همیشه باید صریح کلیک کند.
 *   • بند ۴ — راهنمای کوتاه، همیشه و بدون کلیک، بالای همین فرم دیده می‌شود.
 *
 * ⚠️ هیچ قفل تازه‌ای اینجا ساخته نمی‌شود: پنجره‌ی «کارمند این نشست کیست؟» یک
 * هشدار غیرقابل‌نادیده‌گرفتن است، ولی فروش را زمین نمی‌زند (بستنش آزاد است و
 * دوباره هم برمی‌گردد تا تعیین تکلیف شود).
 *
 * IPC: shift:session:form · shift:session:open · shift:session:staff · shift:current
 * ===========================================================================
 */

export type SessionMode =
  /** باز کردن نشست تازه (شروع کار، یا بعد از بستن صندوق) */
  | 'open'
  /** تعویض کارمند وسط کار: نشست قبلی با کارمند خودش بسته و نشست تازه ساخته می‌شود */
  | 'handover'
  /** فقط تعیین کارمندِ همین نشستِ باز (وقتی نشست خودکار ساخته شده است) */
  | 'staff'

/** خواندن نشست جاری با تازه‌سازی دوره‌ای (پنل‌ها تمام روز باز می‌مانند). */
export function useCurrentShift(everyMs = 30_000): { shift: ShiftInfo | null; reload: () => Promise<ShiftInfo | null> } {
  const [shift, setShift] = useState<ShiftInfo | null>(null)

  const reload = useCallback(async () => {
    try {
      const s = await call<ShiftInfo | null>(CH.shiftCurrent, {})
      setShift(s)
      return s
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void reload()
    if (!everyMs) return
    const t = window.setInterval(() => void reload(), everyMs)
    return () => window.clearInterval(t)
  }, [reload, everyMs])

  return { shift, reload }
}

/**
 * وضعیت زنده‌ی نشست (کانال shift:status) — خواندنیِ خالص: برخلاف shift:current
 * نه خطا پرتاب می‌کند نه نشست AUTO می‌سازد؛ در حالت «نشست جامانده» که
 * useCurrentShift ساکت می‌ماند، این هوک دقیقاً دلیل همین سکوت را برمی‌گرداند.
 */
export function useShiftGate(everyMs = 30_000): { gate: ShiftStatusInfo | null; reload: () => Promise<void> } {
  const [gate, setGate] = useState<ShiftStatusInfo | null>(null)

  const reload = useCallback(async () => {
    try {
      setGate(await call<ShiftStatusInfo>(CH.shiftStatus, {}))
    } catch {
      /* خرابی موقت IPC نباید چیپ را بخواباند؛ آخرین وضعیت شناخته‌شده می‌ماند */
    }
  }, [])

  useEffect(() => {
    void reload()
    if (!everyMs) return
    const t = window.setInterval(() => void reload(), everyMs)
    return () => window.clearInterval(t)
  }, [reload, everyMs])

  return { gate, reload }
}

export default function ShiftSessionModal({
  open,
  mode,
  mandatory = false,
  onClose,
  onDone
}: {
  open: boolean
  mode: SessionMode
  /** پنجره‌ی اجباری: بدون ✕ و بدون بستن با کلیک روی پس‌زمینه */
  mandatory?: boolean
  onClose: () => void
  onDone?: (shift: ShiftInfo | null) => void
}) {
  const nav = useNavigate()
  const openRequestKey = useRef<string | null>(null)
  const [form, setForm] = useState<ShiftSessionForm | null>(null)
  const [name, setName] = useState('')
  const [reason, setReason] = useState('')
  /** نشست ۳۱۰ · فاز ۲ — دلیل کارت «اعلام اضافه‌کاری» (با قانون ≥۳ حرفِ سرور) */
  const [overtimeReason, setOvertimeReason] = useState('')
  const [staffId, setStaffId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [managerPassword, setManagerPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    // ممیزی A80-01: باز شدن دوباره‌ی پنجره = درخواست تازه؛ کلید retry قبلی نباید زنده بماند.
    openRequestKey.current = null
    try {
      const f = await call<ShiftSessionForm>(CH.shiftSessionForm, {})
      setForm(f)
      // بند ۲: نام پیشنهادی سیستم، پیش‌فرض انتخاب‌شده
      setName(mode === 'staff' ? f.current?.name ?? f.suggestion.name : f.suggestion.name)
      setReason('')
      setManagerPassword('')
      /**
       * بند ۳: کارمند پیش‌فرض = کارمند همین نشست (اگر دارد) وگرنه آخرین کارمند
       * نشست قبلی. فقط highlight است؛ تا کاربر «تأیید» را نزند هیچ چیزی ثبت
       * نمی‌شود.
       */
      setStaffId(f.current?.userId ?? f.defaultStaffId ?? null)
    } catch (e: any) {
      setErr(e.message)
    }
  }, [mode])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  /**
   * ثبت در پشته‌ی مودالها (useTopmostModalKey): قبلاً این مودال ثبت نمی‌شد و
   * هات‌کی‌های F2–F11 شل (isAnyModalOpen) پشتش فعال بودند. با ثبت‌شدن، فقط
   * topmost به Esc جواب می‌دهد. Esc در حالت عادی مثل ✕ می‌بندد و در حالت
   * اجباری فقط بلعیده می‌شود — همان قرارداد کلیک پس‌زمینه و ✕.
   */
  useTopmostModalKey(open, (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    if (!mandatory) onClose()
  })

  const suggestion = form?.suggestion
  const overridden = !!suggestion && mode !== 'staff' && name.trim() !== suggestion.name
  const needsReason = overridden && !reason.trim()
  const noStaff = !!form && !form.staff.length
  /**
   * نشست جامانده‌ی روزِ دیگر: از دید openShift (یعنی current) پنهان است ولی
   * openSession بستنش را با دلیل ≥۳ حرف + رمز مدیر می‌خواهد (staleOvernight).
   * مقدار از سرور می‌آید تا شرط UI مو‌به‌مو با قاعده‌ی سرور یکی باشد.
   */
  const staleOpen = mode !== 'staff' ? (form?.staleOpen ?? null) : null
  /**
   * نشست ۳۱۰ · فاز ۲ — کارت «اعلام اضافه‌کاری»: سرور همه‌ی گیت‌ها را در
   * blockReason/overtimePreview پوشیده ساخته؛ این کارت فقط دلیل می‌گیرد و
   * خودِ declareOvertime باز هم همه‌ی گیت‌ها را سروری بازبینی می‌کند.
   */
  const overtimePreview = mode !== 'staff' && form?.blockReason === 'OVERTIME_ELIGIBLE' ? (form.overtimePreview ?? null) : null
  const otherStaffOpen =
    mode !== 'staff' && !!form?.current?.userId && !!staffId && form.current.userId !== staffId
  const requiresManagerHandover = mode !== 'staff' && !!staffId && (otherStaffOpen || !!staleOpen)
  const windowOf = (n: string): string | null =>
    suggestion?.templates.find((t) => t.name === n)?.windowLabel ?? null

  const title = useMemo(
    () =>
      mode === 'staff'
        ? 'کارمند این نشست کیست؟'
        : mode === 'handover'
          ? 'تعویض کارمند / ثبت نشست جدید'
          : 'باز کردن نشست صندوق',
    [mode]
  )

  const submit = async () => {
    if (!staffId) return setErr('انتخاب کارمند اجباری است؛ کارمند مربوط به همین نشست را انتخاب و تأیید کنید.')
    if (needsReason)
      return setErr(
        `چون «${name.trim()}» با نام پیشنهادی سیستم («${suggestion?.name}») فرق دارد، نوشتن دلیل اجباری است.`
      )
    if (requiresManagerHandover && reason.trim().length < 3)
      return setErr('برای بستن نشستِ کارمند دیگر، نوشتن دلیل اجباری است.')
    if (requiresManagerHandover && !managerPassword.trim())
      return setErr('برای بستن نشستِ کارمند دیگر، رمز مدیر اجباری است.')
    setBusy(true)
    setErr(null)
    try {
      if (mode !== 'staff' && !openRequestKey.current)
        openRequestKey.current = `shift-open-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const res =
        mode === 'staff'
          ? await call<ShiftInfo | null>(CH.shiftSessionStaff, { shiftId: form?.current?.id ?? null, staffId })
          : await call<ShiftInfo | null>(CH.shiftSessionOpen, {
              name: name.trim(),
              reason: reason.trim() || undefined,
              staffId,
              note: note.trim() || undefined,
              handover: mode === 'handover',
              managerPassword: requiresManagerHandover ? managerPassword.trim() : undefined,
              overrideReason: requiresManagerHandover ? reason.trim() : undefined,
              idempotencyKey: openRequestKey.current ?? undefined
            })
      onDone?.(res)
      openRequestKey.current = null
      onClose()
    } catch (e: any) {
      // ممیزی A80-01: کلیدِ ردشده برای «درخواست متفاوت» دیگر قابل retry نیست؛ تلاش بعدی کلید تازه می‌سازد.
      if (/درخواست متفاوت/.test(String(e?.message ?? ''))) openRequestKey.current = null
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  /**
   * نشست ۳۱۰ · فاز ۲ — اعلام اضافه‌کاری از خودِ مودال (بدون رمز مدیر، با دلیل
   * اجباری): بعد از موفق، جریان عادی به‌روزرسانی همان مسیر قبلی است (چیپ
   * reload می‌کند و رویداد mahak:shift-changed بنر POS را جمع می‌کند).
   */
  const submitOvertime = async () => {
    if (overtimeReason.trim().length < 3)
      return setErr('برای اعلام اضافه‌کاری، دلیل کوتاه و روشن بنویسید (حداقل ۳ حرف)؛ این اعلام در حسابرسی می‌ماند.')
    setBusy(true)
    setErr(null)
    try {
      await call(CH.shiftOvertimeDeclare, { reason: overtimeReason.trim() })
      onDone?.(null)
      onClose()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const modalUi = (
    <div
      className="fixed inset-0 z-[60] bg-black/50 overflow-auto p-4 flex items-start justify-center"
      onMouseDown={(e) => {
        // پنجره‌ی اجباری با کلیک روی پس‌زمینه بسته نمی‌شود
        if (!mandatory && e.target === e.currentTarget) onClose()
      }}
    >
      <div dir="rtl" className="w-full max-w-3xl bg-white text-slate-800 rounded shadow-lg my-4">
        <div className="flex items-center justify-between px-4 h-11 bg-brand text-white rounded-t">
          <div className="font-bold">{title}</div>
          {!mandatory && (
            <button className="text-white/90 hover:text-white text-lg leading-none" onClick={onClose} title="بستن">
              ✕
            </button>
          )}
        </div>

        <div className="p-4 space-y-3">
          {/* ---------- بند ۴: راهنمای همیشه‌قابل‌مشاهده ---------- */}
          <div className="rounded border-2 border-sky-300 bg-sky-50 p-3 leading-7">
            {form?.guide ??
              'هر بار که صندوق دست‌به‌دست می‌شود (حتی موقت)، حتماً همین‌جا یک نشست جدید ثبت کنید؛ در غیر این صورت سیستم نمی‌تواند تشخیص دهد چه کسی واقعاً پشت صندوق بوده است.'}
          </div>

          {err && <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">{err}</div>}

          {/* ---------- نشست جاری ---------- */}
          {form?.current && (
            <div className="rounded border p-2 flex flex-wrap items-center gap-2 bg-slate-50">
              <b>نشست جاری:</b>
              <span className="px-2 py-0.5 rounded bg-emerald-100 font-bold">
                {faDigits(form.current.dayJalali)} · {form.current.sessionLabel ?? form.current.name}
              </span>
              <span className="kbd">
                کارمند: {form.current.userName ?? 'تعیین نشده'} · {faDigits(form.current.invoiceCount)} فاکتور ·{' '}
                {money(form.current.grandTotal)} ریال · شروع {faDigits(form.current.openedAtTime ?? '—')}
              </span>
              {form.current.multiDayWarning && (
                <span className="kbd text-amber-900 bg-amber-100 border border-amber-400 whitespace-pre-line">
                  {form.current.multiDayWarning}
                </span>
              )}
              {mode === 'handover' && (
                <span className="kbd text-rose-800">
                  با ثبت این فرم، همین نشست <b>با کارمند خودش بسته می‌ماند</b> و یک نشست تازه ساخته می‌شود؛ هیچ‌کدام
                  رونویسی یا حذف نمی‌شوند.
                </span>
              )}
            </div>
          )}

          {/* ---------- بند ۲: نام شیفت پیشنهادی + override با دلیل ---------- */}
          {mode !== 'staff' && (
            <div className="rounded border p-3 space-y-2">
              <div className="font-bold">نام شیفت این نشست</div>
              <div className="kbd leading-6">
                {suggestion?.byTime ? (
                  <>
                    سیستم بر اساس ساعت {faDigits(suggestion.clockNow)} نام <b>«{suggestion.name}»</b>
                    {suggestion.windowLabel ? ` (بازه ${faDigits(suggestion.windowLabel)})` : ''} را پیشنهاد می‌دهد
                    {suggestion.outside ? ' — ساعت جاری خارج از بازه‌های تعریف‌شده است، نزدیک‌ترین شیفت پیشنهاد شد' : ''}.
                    اگر واقعیت چیز دیگری است (مثلاً تحویل زودهنگام صندوق)، نام درست را انتخاب کنید و دلیلش را بنویسید.
                  </>
                ) : (
                  <>
                    «تعیین شیفت بر اساس ساعت» خاموش است، پس شماره‌گذاری پشت‌سرهم همیشگی برقرار است و نام پیشنهادی{' '}
                    <b>«{suggestion?.name}»</b> است.
                  </>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {(suggestion?.templates ?? []).map((t) => (
                  <button
                    key={`${t.number}-${t.name}`}
                    className={`btn ${name === t.name ? 'btn-primary' : ''}`}
                    onClick={() => setName(t.name)}
                    title={`بازه ${t.windowLabel}`}
                  >
                    {t.name}
                    {t.name === suggestion?.name ? ' ✓ پیشنهاد سیستم' : ''}
                    <span className="kbd ms-1" dir="ltr">
                      {faDigits(t.windowLabel)}
                    </span>
                  </button>
                ))}
                {!suggestion?.templates.length && (
                  <span className="kbd">
                    هیچ شیفتی در تنظیمات تعریف نشده است؛ همین یک نام پیش‌فرض استفاده می‌شود.
                  </span>
                )}
              </div>
              <label className="block">
                <div className="kbd">نام نهایی نشست (قابل تایپ)</div>
                <input className="inp max-w-sm" value={name} onChange={(e) => setName(e.target.value)} />
              </label>

              {overridden && (
                <label className="block">
                  <div className="kbd">
                    <b className="text-rose-700">دلیل اجباری:</b> چرا این نشست به‌عنوان «{name.trim()}»
                    {windowOf(name.trim()) ? ` (بازه ${faDigits(windowOf(name.trim()) as string)})` : ''} ثبت می‌شود در
                    حالی که ساعت الان داخل بازه‌ی «{suggestion?.name}» است؟
                  </div>
                  <input
                    className={`inp ${needsReason ? 'bg-rose-50 border-rose-500' : ''}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثلاً: شیفت شب زودتر صندوق را تحویل گرفت"
                  />
                  <div className="kbd leading-6">
                    این دلیل همراه نام پیشنهادی و نام نهایی روی خود نشست ذخیره می‌شود و در گزارش «نشست‌های با نام
                    override‌شده» دیده می‌شود. توجه: override کردن نام، هشدار «تراکنش‌های خارج از بازه‌ی شیفت» را خاموش
                    نمی‌کند.
                  </div>
                </label>
              )}
            </div>
          )}

          {/* ---------- بند ۳: کارمند اجباری ---------- */}
          <div className="rounded border-2 border-emerald-400 bg-emerald-50 p-3 space-y-2">
            <div className="font-bold">کارمند این نشست (اجباری)</div>
            {noStaff ? (
              <div className="leading-7">
                هنوز هیچ کارمندی ثبت نشده است. اول از <b>تنظیمات ← کارمندان</b> کارمندان فروشگاه را ثبت کنید.
                <button className="btn ms-2" onClick={() => nav('/settings')}>
                  رفتن به تنظیمات ← کارمندان
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-1">
                  {(form?.staff ?? []).map((u) => {
                    const isDefault = u.id === (form?.current?.userId ?? form?.defaultStaffId)
                    return (
                      <button
                        key={u.id}
                        className={`btn ${staffId === u.id ? 'btn-primary' : ''} ${
                          isDefault && staffId !== u.id ? 'border-emerald-500' : ''
                        }`}
                        onClick={() => setStaffId(u.id)}
                      >
                        {u.name}
                        {isDefault ? ' ★ نشست قبلی' : ''}
                      </button>
                    )
                  })}
                </div>
                <div className="kbd leading-6">
                  کارمند نشست قبلی با ★ پیش‌فرض نشان داده شده است، ولی <b>هیچ‌وقت خودکار تأیید نمی‌شود</b>: تا وقتی
                  روی نام کارمند و بعد دکمه‌ی تأیید کلیک نکنید، هیچ چیزی ثبت نمی‌شود.
                </div>
              </>
            )}
          </div>

          {mode !== 'staff' && (
            <label className="block">
              <div className="kbd">یادداشت این نشست (اختیاری)</div>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          )}

          {overtimePreview && (
            <div className="rounded border-2 border-emerald-500 bg-emerald-50 p-3 space-y-2">
              <div className="font-bold text-emerald-800">⏱ اضافه‌کاری شیفت شب</div>
              <div className="leading-6">
                نشست «{staleOpen?.sessionLabel}» از {faDigits(staleOpen?.dayJalali ?? '')} هنوز باز است و از پایان
                بازه‌اش گذشته‌اید. اگر هنوز مشغولید، <b>کارمند همان نشست</b> می‌تواند تا ساعت{' '}
                <b>{overtimePreview.untilLabel}</b> اضافه‌کاری اعلام کند و فروش ادامه یابد (سقف:{' '}
                {faDigits(overtimePreview.capMinutes)} دقیقه). این اعلام <b>فقط یک‌بار</b> ممکن است و با دلیلِ شما
                برای همیشه در حسابرسی می‌ماند. اگر کارِ این نشست تمام شده، همان «تعویض اجباری» پایین همین فرم آن را
                با دلیل و رمز مدیر می‌بندد.
              </div>
              <label className="block">
                <div className="kbd">
                  <b className="text-emerald-800">دلیل اجباری اضافه‌کاری:</b>
                </div>
                <input
                  className={`inp ${overtimeReason.trim().length < 3 ? 'bg-rose-50 border-rose-500' : ''}`}
                  value={overtimeReason}
                  onChange={(e) => setOvertimeReason(e.target.value)}
                  placeholder="مثلاً: مشتری آخر شب دیر رسید؛ حسابش باید از پول امروز جدا بماند"
                />
              </label>
              <button
                className="btn btn-primary !bg-emerald-700 !border-emerald-800"
                onClick={() => void submitOvertime()}
                disabled={busy || overtimeReason.trim().length < 3}
              >
                {busy ? 'در حال اعلام…' : `اعلام اضافه‌کاری تا ${overtimePreview.untilLabel}`}
              </button>
            </div>
          )}

          {requiresManagerHandover && (
            <div className="rounded border-2 border-rose-400 bg-rose-50 p-3 space-y-2">
              <div className="font-bold text-rose-800">تعویض اجباری نشست</div>
              {otherStaffOpen && (
                <div className="leading-6">
                  نشست فعلی متعلق به کارمند دیگری است. بستن آن فقط با <b>رمز مدیر</b> و دلیل ثبت‌شده مجاز است؛ این
                  عملیات با برچسب «HANDOVER_FORCED» در حسابرسی می‌ماند.
                </div>
              )}
              {staleOpen && (
                <div className="leading-6">
                  نشست «{staleOpen.sessionLabel}» از {faDigits(staleOpen.dayJalali)} (
                  {staleOpen.userName ? `کارمند: ${staleOpen.userName}` : 'کارمند: تعیین نشده'}) هنوز باز است و بسته
                  نشده. برای شروع نشست تازه باید دلیل بنویسید و رمز مدیر وارد کنید تا معلوم شود پول آن نشست چه
                  شد؛ آن نشست با کارمند خودش بسته می‌ماند.
                </div>
              )}
              {/**
                * فیلد دلیل با فیلد دلیلِ override نام مشترک است: سرور
                * overrideReason ?? reason می‌خواند و overrideReason را فقط وقتی نام
                * عوض شده ذخیره می‌کند؛ پس بدون override، همان دلیل را اینجا می‌گیریم.
                */}
              {overridden ? (
                <div className="kbd leading-6">همان «دلیل اجباری»‌ی بالا برای این تعویض هم ثبت می‌شود.</div>
              ) : (
                <label className="block">
                  <div className="kbd">
                    <b className="text-rose-700">دلیل اجباری:</b>
                  </div>
                  <input
                    className={`inp ${reason.trim().length < 3 ? 'bg-rose-50 border-rose-500' : ''}`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="مثلاً: نشست دیروز بسته نشده بود؛ پولش شمرده و تحویل شد"
                  />
                </label>
              )}
              <label className="block">
                <div className="kbd">رمز مدیر</div>
                <input
                  className="inp"
                  type="password"
                  value={managerPassword}
                  onChange={(e) => setManagerPassword(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t bg-slate-50 rounded-b flex gap-2 justify-end flex-wrap">
          {!mandatory && (
            <button className="btn" onClick={onClose} disabled={busy}>
              انصراف
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !staffId || needsReason}>
            {busy
              ? 'در حال ثبت…'
              : mode === 'staff'
                ? 'تأیید کارمند این نشست'
                : mode === 'handover'
                  ? 'بستن نشست فعلی و ثبت نشست جدید'
                  : 'ثبت نشست'}
          </button>
        </div>
      </div>
    </div>
  )

  /**
   * الگوی PrinterPickerModal — بدون portal این مودال فرزندِ headerِ text-white
   * (Shell) می‌ماند و رنگ متن سفید را به ارث می‌برد؛ یعنی همه‌ی متن‌ها (دکمه‌های
   * کارمند، راهنما، باکس خطا) سفید-روی-سفید می‌شدند. با portal، ارث‌بری از body
   * می‌آید و text-slate-800 روی باکس سفید دفاع دولایه است.
   */
  return typeof document === 'undefined' ? modalUi : createPortal(modalUi, document.body)
}

/**
 * ---------------------------------------------------------------------------
 * نشان نوار بالای برنامه: «نشست جاری + کارمندش» و یک کلیک برای تعویض کارمند.
 *
 * بند ۳ — اگر کارمند نشست تأیید نشده باشد، همین‌جا یک پنجره‌ی اجباری بالا
 * می‌آید: هشدارِ واضح و غیرقابل‌نادیده‌گرفتن، بدون این‌که چیزی قفل شود.
 * بند ۶ — با یک شیفت/یک کارمند، این پنجره فقط یک‌بار در روز (لحظه‌ی باز شدن
 * نشست) دیده می‌شود و بقیه‌ی روز بی‌مزاحمت است.
 * ---------------------------------------------------------------------------
 */
export function ShiftSessionChip() {
  const { shift, reload } = useCurrentShift(30_000)
  /** `null` deliberately means unknown. The legacy name-only modal must stay
   * hidden until main has explicitly said the drawer is not custody-governed. */
  const [custodyGoverned, setCustodyGoverned] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    void call<{ enabled: boolean; governed?: boolean }>(CH.custodyStatus, {})
      .then((row) => { if (live) setCustodyGoverned(row.governed === true || row.enabled === true) })
      .catch(() => { if (live) setCustodyGoverned(null) })
    return () => { live = false }
  }, [])
  /**
   * وضعیت بدون‌خطای نشست — «نشست جامانده» در shift:current خطا می‌شود و
   * useCurrentShift آن را قورت می‌دهد (چیپ ساکت می‌ماند)؛ shift:status همان
   * دلیل سکوت را برمی‌گرداند تا چیپ با برچسب واضح قرمز شود.
   */
  const { gate, reload: reloadGate } = useShiftGate(30_000)
  const stale = gate?.state === 'STALE' ? gate.stale ?? null : null
  const [form, setForm] = useState<{ open: boolean; mode: SessionMode }>({ open: false, mode: 'handover' })
  /** «فعلاً ببند» فقط تا تازه‌سازی بعدی؛ هشدار خودش برمی‌گردد تا تعیین تکلیف شود. */
  const [snoozed, setSnoozed] = useState(false)

  const pending = !!shift?.staffPending
  const multiDay = !!shift?.multiDayWarning
  useEffect(() => {
    if (pending) setSnoozed(false)
  }, [shift?.id, pending])

  /**
   * هشدار «کارمند نشست تعیین نشده» عمداً *برنمی‌گردد به سکوت*: اگر کاربر ببندش،
   * حداکثر یک دقیقه بعد دوباره می‌آید تا تعیین تکلیف شود. این یک قفل نیست (فروش
   * آزاد است)، ولی نادیده‌گرفتنش هم عملاً ممکن نیست — همان چیزی که بند ۳ خواسته.
   */
  useEffect(() => {
    if (!snoozed) return
    const t = window.setTimeout(() => setSnoozed(false), 60_000)
    return () => window.clearTimeout(t)
  }, [snoozed])

  /**
   * رویداد سراسری «باز کردن مودال نشست» — بنر SESSION_REQUIRED در صفحه‌های
   * فروش (POS/فاکتور عمده) ریکاوری را بدون خروج از صفحه و از دست رفتن سبد
   * همین‌جا شروع می‌کند؛ حالت از روی وضعیت فعلی نشست خودش تعیین می‌شود.
   */
  useEffect(() => {
    const onOpen = () =>
      setForm((f) =>
        f.open ? f : { open: true, mode: pending || gate?.state === 'STAFF_PENDING' ? 'staff' : 'handover' }
      )
    window.addEventListener('mahak:open-shift-modal', onOpen)
    return () => window.removeEventListener('mahak:open-shift-modal', onOpen)
  }, [pending, gate?.state])

  // Legacy session controls must not offer a second way to change custody.
  // A failed status read is not permission to reopen the unsafe old flow.
  if (custodyGoverned !== false) return null

  return (
    <>
      <button
        className={`text-xs px-2 py-1 rounded whitespace-nowrap font-bold ${
          stale
            ? 'bg-red-600 hover:bg-red-700'
            : pending
              ? 'bg-rose-500 hover:bg-rose-600'
              : multiDay
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-white/20 hover:bg-white/30'
        }`}
        onClick={() => setForm({ open: true, mode: pending ? 'staff' : 'handover' })}
        title={
          stale
            ? 'نشست روز قبل هنوز باز و پولش شمرده نشده است — برای بستن آن و شروع نشست امروز کلیک کنید'
            : 'نشست جاری صندوق · تعویض کارمند یا ثبت نشست جدید'
        }
      >
        {stale
          ? `⚠ نشست جامانده — ${faDigits(stale.dayJalali)} · ${stale.sessionLabel}`
          : shift
            ? pending
              ? `⚠ کارمند نشست تعیین نشده — ${shift.sessionLabel ?? shift.name}`
              : multiDay
                ? `⚠ نشست چندروزه — ${shift.sessionLabel ?? shift.name}`
              : `${shift.sessionLabel ?? shift.name} · ${shift.userName ?? 'بدون کارمند'}`
            : 'نشست صندوق'}
      </button>

      {/* پنجره‌ی اجباری «کارمند این نشست کیست؟» */}
      <ShiftSessionModal
        open={(pending && !snoozed) || form.open}
        mode={pending && !snoozed && !form.open ? 'staff' : form.mode}
        mandatory={false}
        onClose={() => {
          setForm({ open: false, mode: 'handover' })
          if (pending) setSnoozed(true)
        }}
        onDone={() => {
          setSnoozed(false)
          void reload()
          void reloadGate()
          /** صفحه‌های فروش با بنر SESSION_REQUIRED، با این رویداد بنر را جمع و پیام «دوباره ثبت کنید» را می‌آورند */
          window.dispatchEvent(new Event('mahak:shift-changed'))
        }}
      />
    </>
  )
}
