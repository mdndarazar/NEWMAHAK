import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useManagerSession } from '../hooks/useManagerSession'
import { usePanelLock } from '../hooks/usePanelLocks'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
import { faDigits, toLatinDigits } from '@shared/jalali'
import { panelTitle, type PanelKey } from '@shared/panels'
import type { PanelAuthState, PanelGateStatus } from '@shared/types'

/** ثانیه ⇒ «۲:۳۵» (یا «۱:۰۵:۰۰» برای قفل‌های بلند). */
function countdownLabel(total: number): string {
  const s = Math.max(0, Math.round(total))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  return faDigits(h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`)
}

/**
 * قفل رمزی پنل‌های مدیریتی (تنظیمات · کالاها · فاکتور خرید · انبار مرکزی ·
 * فاکتورهای فروش عمده · عوارض و حق سرویس).
 *
 * دو رمز، یک قفل:
 *   • «رمز مدیر» همیشه و بی‌استثنا هر پنلی را باز می‌کند و نشست مدیر را شروع
 *     می‌کند، پس بقیه‌ی پنل‌ها هم تا «خروج مدیر» باز می‌مانند (رفتار همیشگی).
 *   • «رمز دوم اختصاصی» همین پنل (اگر مدیر تعریفش کرده باشد) *فقط همین یک پنل*
 *     را باز می‌کند و به بقیه‌ی برنامه دسترسی نمی‌دهد — مناسب دادن به حسابدار
 *     یا کارمند همان بخش.
 *
 * `inline`: به‌جای صفحه‌ی کامل، یک کادر جمع‌وجور نشان می‌دهد (برای قفل کردن یک
 * تبِ داخل یک پنل، مثل تب «فاکتورهای عمده»).
 */
export default function ManagerGate({
  panel,
  title,
  reason,
  inline = false,
  children
}: {
  /** کلید پنل (src/shared/panels.ts) — مبنای رمز دوم اختصاصی همین پنل */
  panel: PanelKey
  title: string
  reason: string
  inline?: boolean
  children: ReactNode
}) {
  const nav = useNavigate()
  const { canOpen, unlockPanel } = useManagerSession()
  /**
   * بند ۱ — «قفل ماژول‌ها»: اگر مدیر آگاهانه قفل همین ماژول را خاموش کرده باشد،
   * این گیت بدون پرسیدن هیچ رمزی بچه‌هایش را رندر می‌کند.
   *
   * ⚠️ fail-closed: تا وقتی سیاست قفل از دیتابیس خوانده نشده (`loaded` هنوز
   * false است) قفل **روشن** فرض می‌شود، پس یک لحظه‌ی بارگذاری یا یک خطای
   * خواندن هیچ‌وقت پنلی را لو نمی‌دهد. خودِ پنل «تنظیمات» هم در
   * `ALWAYS_LOCKED_PANELS` است و `isPanelLockEnabled` هیچ‌وقت بازش نمی‌کند.
   */
  const { lockEnabled, loaded: locksLoaded } = usePanelLock(panel)
  const lockOff = locksLoaded && !lockEnabled
  const open = canOpen(panel) || lockOff
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [isDefaultPassword, setIsDefaultPassword] = useState(false)
  /** برای این پنل رمز دوم تعریف شده است؟ (فقط برای نمایش راهنما) */
  const [hasSecond, setHasSecond] = useState(false)
  /**
   * ---------------- بخش ۲ — «قفل موقت» و شمارش معکوس ----------------
   * وضعیت گیت از کانال آماده‌ی `manager:gate:status` خوانده می‌شود (قفل است؟ چند
   * ثانیه مانده؟ چند تلاش ناموفق تا قفل شدن؟) و هر ثانیه یک بار تازه می‌شود.
   * ثانیه‌ها *سمت renderer* هم شمرده می‌شوند تا شمارش نرم و بی‌پرش باشد، ولی
   * حقیقت همیشه همان عددی است که سرور می‌دهد (قفل روی دیتابیس است، پس بستن و
   * باز کردن برنامه دورش نمی‌زند).
   */
  const [gate, setGate] = useState<PanelGateStatus | null>(null)
  /** همین حالا قفل باز شد؟ (برای پیام «حالا می‌توانید دوباره تلاش کنید») */
  const [justUnlocked, setJustUnlocked] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) return
    inputRef.current?.focus()
    call<{ isDefault: boolean }>(CH.managerInfo)
      .then((i) => setIsDefaultPassword(!!i?.isDefault))
      .catch(() => setIsDefaultPassword(false))
    call<PanelAuthState[]>(CH.managerPanelInfo)
      .then((list) => setHasSecond(!!(list ?? []).find((p) => p.key === panel)?.enabled))
      .catch(() => setHasSecond(false))
  }, [open, panel])

  /**
   * شمارش معکوس: هر ثانیه یک بار وضعیت گیت خوانده می‌شود. وقتی گیت قفل نیست،
   * خواندن ادامه پیدا می‌کند (سبک است و فقط یک رکورد می‌خواند) تا اگر همین حالا
   * قفل شد، دکمه فوراً غیرفعال شود.
   */
  const refreshGate = useCallback(async () => {
    try {
      const st = await call<PanelGateStatus>(CH.managerGateStatus, { panel })
      setGate((prev) => {
        // لحظه‌ی باز شدن قفل: یک بار پیام «حالا می‌توانید دوباره تلاش کنید»
        if (prev?.locked && st && !st.locked) setJustUnlocked(true)
        return st ?? null
      })
    } catch {
      // خواندن وضعیت یک «سهولت» است؛ نشدنش نباید مانع ورود رمز شود
      setGate(null)
    }
  }, [panel])

  useEffect(() => {
    if (open) return
    void refreshGate()
    const id = window.setInterval(() => {
      // شمارش نرم سمت renderer + تازه‌سازی از سرور در همان تیک
      setGate((g) => (g && g.locked ? { ...g, remainingSeconds: Math.max(0, g.remainingSeconds - 1) } : g))
      void refreshGate()
    }, 1000)
    return () => window.clearInterval(id)
  }, [open, refreshGate])

  if (open) return <>{children}</>

  const locked = !!gate?.locked && gate.remainingSeconds > 0
  /** چند تلاش ناموفق دیگر تا قفل شدن (فقط وقتی قفل موقت روشن است) */
  const attemptsLeft = gate && gate.enabled ? Math.max(0, gate.maxAttempts - gate.failCount) : null

  const submit = async () => {
    // بخش ۲: تا پایان قفل، درخواستی هم فرستاده نمی‌شود
    if (locked) return setErr(`این نقطه‌ی ورود قفل است؛ ${countdownLabel(gate!.remainingSeconds)} دیگر تلاش کنید.`)
    const value = toLatinDigits(password).trim()
    if (!value) return setErr('رمز را وارد کنید.')
    setBusy(true)
    setErr(null)
    setJustUnlocked(false)
    try {
      await unlockPanel(panel, value)
      setPassword('')
    } catch (e: any) {
      setErr(e.message)
      setPassword('')
      inputRef.current?.focus()
      // رمز اشتباه ⇒ شمارنده و وضعیت قفل همان لحظه تازه می‌شود
      void refreshGate()
    } finally {
      setBusy(false)
    }
  }

  const box = (
    <div className={`w-full ${inline ? '' : 'max-w-md'} bg-white rounded shadow`}>
      <div className="h-11 px-4 flex items-center bg-brand text-white rounded-t font-bold">
        {title} — ورود با رمز
      </div>
      <div className="p-4 space-y-3">
        <p className="leading-7">{reason}</p>
        <label className="block">
          <div className="mb-1 font-bold">رمز مدیر{hasSecond ? ` یا رمز اختصاصی «${panelTitle(panel)}»` : ''}</div>
          {/* مورد ۲ — همین اینپوت با آیکون چشم: کاربر می‌تواند رمز تایپ‌شده را ببیند */}
          <PasswordField
            ref={inputRef}
            className="inp text-center text-lg tracking-widest"
            value={password}
            disabled={locked}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void submit()
              }
            }}
          />
        </label>

        {err && <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">{err}</div>}

        {/* ---------- بخش ۲: شمارش معکوس قفل موقت ---------- */}
        {locked && (
          <div className="rounded px-3 py-2 border-2 bg-rose-50 border-rose-400 leading-7">
            <b>
              این نقطه‌ی ورود قفل است — {countdownLabel(gate!.remainingSeconds)} تا باز شدن
            </b>
            <div className="kbd leading-6">
              بعد از {faDigits(gate!.maxAttempts)} رمز اشتباه پشت‌سرهم، همین گیت {faDigits(gate!.lockMinutes)} دقیقه قفل
              می‌شود و تا پایان این مدت حتی رمز درست هم پذیرفته نمی‌شود. قفل روی دیتابیس است، پس بستن و باز کردن برنامه
              آن را دور نمی‌زند.
            </div>
          </div>
        )}
        {!locked && justUnlocked && (
          <div className="rounded px-3 py-2 border-2 bg-emerald-50 border-emerald-400 font-bold">
            قفل باز شد — حالا می‌توانید دوباره تلاش کنید.
          </div>
        )}
        {!locked && !justUnlocked && attemptsLeft != null && gate!.failCount > 0 && (
          <div className="rounded px-3 py-2 border bg-amber-50 border-amber-300 kbd leading-6">
            {faDigits(gate!.failCount)} رمز اشتباه تا این لحظه ثبت شده است ·{' '}
            <b>{faDigits(attemptsLeft)} تلاش دیگر</b> تا قفل شدن {faDigits(gate!.lockMinutes)} دقیقه‌ای این گیت.
          </div>
        )}

        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || locked}>
            {busy ? 'در حال بررسی…' : locked ? `${countdownLabel(gate!.remainingSeconds)} قفل شده` : 'ورود'}
          </button>
          {!inline && (
            <button className="btn" onClick={() => nav('/')} disabled={busy}>
              بازگشت به صفحه اصلی
            </button>
          )}
        </div>

        <div className="kbd leading-6">
          پیش‌فرض برنامه این است که «کارمند پشت سیستم است»، پس پنل‌های حساس قفل‌اند. با <b>رمز مدیر</b> همه‌ی این پنل‌ها
          تا زدن دکمه‌ی «خروج مدیر» باز می‌مانند.
          {hasSecond
            ? ' برای همین پنل یک «رمز دوم اختصاصی» هم تعریف شده که فقط همین پنل را باز می‌کند و به بقیه‌ی برنامه دسترسی نمی‌دهد.'
            : ' مدیر می‌تواند از «تنظیمات → تنظیمات رمز» برای همین پنل یک رمز دوم اختصاصی تعریف کند و آن را به کارمند همان بخش بدهد.'}
          {isDefaultPassword ? ' رمز مدیر هنوز عوض نشده؛ از پنل تنظیمات یک رمز تازه بگذارید.' : ''}
        </div>
      </div>
    </div>
  )

  if (inline) return <div className="flex items-start justify-center pt-2">{box}</div>
  return <div className="flex items-start justify-center pt-10">{box}</div>
}
