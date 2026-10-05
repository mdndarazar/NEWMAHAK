/**
 * ===========================================================================
 * «پنل پیامکی» — صفحه‌ی مستقل.
 *
 * ⚠️ قرارداد این صفحه با بقیه‌ی برنامه:
 *   • هیچ چیزی از فروش/برگشت/تعویض/اعتبار را **نمی‌خواند و نمی‌نویسد**.
 *   • همه‌ی کارها از کانال‌های `sms:*` رد می‌شوند؛ هیچ محاسبه‌ی مالی‌ای
 *     اینجا انجام نمی‌شود و هیچ عددی از این صفحه در گزارش‌ها نمی‌رود.
 *   • خطای شبکه‌ای یا سرویس‌دهنده **هرگز** این صفحه را نمی‌ترکاند؛ پیام در صف
 *     می‌ماند و همان‌جا با پیام فارسی نشان داده می‌شود.
 * ===========================================================================
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, CH } from '../lib/api'
import ManagerGate from '../components/ManagerGate'
import ConfirmDialog from '../components/ConfirmDialog'
import JalaliDateInput from '../components/JalaliDateInput'
import PasswordField from '../components/PasswordField'
import Modal from '../components/Modal'
import { usePanelOpen } from '../hooks/usePanelLocks'
import { PANEL_KEYS } from '@shared/panels'
import { faDigits, jalaliToday, jalaliAtClock, toLatinDigits, toJalaliDate } from '@shared/jalali'
import { exportTable } from '../lib/exportCsv'
import {
  SMS_STATUS_LABELS,
  SMS_AUTO_SCHEDULE_HOURS,
  DEFAULT_SMS_OPT_OUT_NOTE,
  SMS_PROVIDER_KEYS,
  renderSmsTemplate,
  smsSegments,
  SMS_PLACEHOLDER_LABELS,
  SMS_AUDIENCE_LABELS,
  SMS_LINE_PURPOSE_LABELS,
  type SmsAutoSettings
} from '@shared/sms'

type Tab = 'dashboard' | 'campaign' | 'queue' | 'scheduled' | 'history' | 'templates' | 'provider' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'داشبورد' },
  { id: 'campaign', label: 'ارسال انبوه' },
  { id: 'queue', label: 'صف ارسال' },
  { id: 'scheduled', label: 'زمان‌بندی‌شده' },
  { id: 'history', label: 'سابقه' },
  { id: 'templates', label: 'قالب‌ها' },
  { id: 'provider', label: 'سرویس‌دهنده' },
  { id: 'settings', label: 'تنظیمات' }
]

const STATUS_OPTIONS = Object.entries(SMS_STATUS_LABELS).map(([value, label]) => ({ value, label }))

function tone(status: string): string {
  if (status === 'SENT') return 'text-emerald-700 font-bold'
  if (status === 'FAILED_FINAL' || status === 'UNKNOWN') return 'text-red-700 font-bold'
  if (status === 'FAILED_RETRYABLE') return 'text-amber-700 font-bold'
  if (status === 'CANCELED' || status === 'SKIPPED') return 'text-slate-500'
  return 'text-sky-700 font-bold'
}

export default function SmsPanel() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [err, setErr] = useState('')
  const [flash, setFlash] = useState('')
  const [busy, setBusy] = useState(false)

  const [dash, setDash] = useState<any>(null)
  const [rows, setRows] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [settings, setSettings] = useState<any>(null)
  const [templates, setTemplates] = useState<any[]>([])
  const [providers, setProviders] = useState<any>(null)

  const say = useCallback((m: string) => {
    setFlash(m)
    setTimeout(() => setFlash(''), 6000)
  }, [])

  const loadDash = useCallback(async () => {
    try {
      setDash(await call(CH.smsDashboard))
      setErr('')
    } catch (e: any) {
      setErr(e.message)
    }
  }, [])

  const loadList = useCallback(
    async (which: Tab) => {
      try {
        const filter: Record<string, unknown> = {}
        if (which === 'queue') filter.onlyScheduled = false
        if (which === 'scheduled') filter.onlyScheduled = true
        if (status && (which === 'queue' || which === 'history')) filter.status = status
        if (search.trim()) filter.search = search.trim()
        const res = await call<{ rows: any[]; total: number }>(CH.smsList, filter)
        let list = res.rows ?? []
        if (which === 'queue') list = list.filter((r) => ['PENDING', 'PROCESSING', 'FAILED_RETRYABLE'].includes(r.status))
        if (which === 'history') list = list.filter((r) => !['PENDING', 'PROCESSING', 'FAILED_RETRYABLE'].includes(r.status))
        setRows(list)
        setTotal(res.total ?? 0)
        setErr('')
      } catch (e: any) {
        setErr(e.message)
      }
    },
    [status, search]
  )

  const loadAll = useCallback(
    async (which: Tab) => {
      await loadDash()
      if (which === 'templates') {
        try {
          setTemplates(await call(CH.smsTemplates))
        } catch (e: any) {
          setErr(e.message)
        }
      } else if (which === 'provider') {
        try {
          setProviders(await call(CH.smsProviders))
        } catch (e: any) {
          setErr(e.message)
        }
      } else if (which === 'settings') {
        try {
          setSettings(await call(CH.smsSettingsGet))
        } catch (e: any) {
          setErr(e.message)
        }
      } else {
        await loadList(which)
      }
    },
    [loadDash, loadList]
  )

  useEffect(() => {
    void loadAll(tab)
  }, [tab, loadAll])

  /**
   * 🔒 گارد «کار هم‌زمان»: دکمه‌ها با `busy` غیرفعال می‌شوند، ولی دو کلیک در
   * یک تیک (یا Enter نگه‌داشته‌شده) می‌توانست پیش از رندر بعدی دو بار به اینجا
   * برسد و مثلاً دو کمپین یکسان بسازد (باگ اول بازبینی سوم). این ref همان لحظه
   * جلویش را می‌گیرد، نه بعد از رندر.
   */
  const actBusyRef = useRef(false)
  const act = useCallback(
    async (fn: () => Promise<any>, message?: string) => {
      if (actBusyRef.current) return null
      actBusyRef.current = true
      setBusy(true)
      try {
        const res = await fn()
        if (message) say(message)
        await loadAll(tab)
        setErr('')
        return res
      } catch (e: any) {
        setErr(e.message)
        return null
      } finally {
        actBusyRef.current = false
        setBusy(false)
      }
    },
    [loadAll, tab, say]
  )

  return (
    <div className="page">
      <div className="flex items-center gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`btn ${tab === t.id ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.id)}
            disabled={busy}
          >
            {t.label}
          </button>
        ))}
        <span className="grow" />
        <button
          className="btn"
          disabled={busy}
          title="یک دور کامل صف را همین حالا اجرا می‌کند (بدون انتظار برای زمان‌بند)"
          onClick={() => void act(() => call(CH.smsRunNow), 'صف بررسی شد.')}
        >
          الان بفرست
        </button>
      </div>

      {err && <div className="bg-red-50 border border-red-300 text-red-800 rounded p-2 text-sm">{err}</div>}
      {flash && <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded p-2 text-sm">{flash}</div>}

      {dash && !dash.thankYou && (
        /**
         * «تشکر از خرید» عمداً پیش‌فرض خاموش است (هر پیامک برای صاحب فروشگاه
         * پول خرج می‌کند). ولی خاموش گذاشتنِ بی‌خبر، بدترین حالت است؛ پس این
         * نوار زرد با یک کلیک روشنش می‌کند — دقیقاً همان «کلید سراسری» که
         * خواسته شده بود.
         */
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-sm flex items-center gap-3 flex-wrap">
          <span>
            «تشکر از خرید» خاموش است. با روشن‌کردنش، بعد از هر فاکتوری که شماره تلفن داشته باشد یک پیامک تشکر
            (تکی و عمده) در صف می‌نشیند.
          </span>
          <span className="grow" />
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void act(() => call(CH.smsSettingsSet, { thankYou: true }), 'پیام تشکر از خرید روشن شد.')}
          >
            روشنش کن
          </button>
        </div>
      )}

      {dash?.provider === null && tab !== 'provider' && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-sm">
          هیچ سرویس‌دهنده‌ی پیامکی فعال نشده است. پیام‌ها در صف می‌مانند و ارسال نمی‌شوند — تا وقتی در تب
          «سرویس‌دهنده» یکی را فعال کنید.
        </div>
      )}

      {dash?.provider != null && (!dash?.providerService || !dash?.providerAds) && tab !== 'provider' && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-sm">
          {!dash?.providerService && (
            <div>خط خدماتی فعال ندارید: «تشکر از خرید» و «یادآوری اعتبار» در صف می‌مانند.</div>
          )}
          {!dash?.providerAds && <div>خط تبلیغاتی فعال ندارید: پیام‌های انبوه در صف می‌مانند.</div>}
          <div className="kbd">
            در تب «سرویس‌دهنده» می‌توانید دو خط جدا (یکی خدماتی، یکی تبلیغاتی) را هم‌زمان فعال کنید.
          </div>
        </div>
      )}

      {tab === 'dashboard' && <DashboardTab dash={dash} settings={settings} onChanged={() => void loadAll(tab)} />}
      {tab === 'campaign' && <CampaignTab act={act} busy={busy} />}
      {(tab === 'queue' || tab === 'scheduled' || tab === 'history') && (
        <ListTab
          which={tab}
          rows={rows}
          total={total}
          status={status}
          setStatus={setStatus}
          search={search}
          setSearch={setSearch}
          busy={busy}
          act={act}
        />
      )}
      {tab === 'templates' && <TemplatesTab templates={templates} act={act} busy={busy} />}
      {tab === 'provider' && <ProviderTab data={providers} act={act} busy={busy} />}
      {tab === 'settings' && <SettingsTab settings={settings} act={act} busy={busy} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// داشبورد
// ---------------------------------------------------------------------------

function Card({ title, value, hint, tone: t }: { title: string; value: string | number; hint?: string; tone?: string }) {
  return (
    <div className="bg-white rounded shadow p-3">
      <div className="kbd">{title}</div>
      <div className={`text-2xl font-bold ${t ?? ''}`}>{typeof value === 'number' ? faDigits(value) : value}</div>
      {hint && <div className="kbd">{hint}</div>}
    </div>
  )
}

function DashboardTab({ dash, onChanged }: { dash: any; settings: any; onChanged: () => void }) {
  const [phone, setPhone] = useState('')
  const [body, setBody] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [est, setEst] = useState<any>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [localErr, setLocalErr] = useState('')
  const [localBusy, setLocalBusy] = useState(false)
  /**
   * تیک «تبلیغاتی»: مقررات به *محتوا* کار دارد، نه به دکمه‌ای که زده شده.
   * اگر مدیر می‌خواهد متن تبلیغی برای مشتری بفرستد، باید از خط تبلیغاتی برود،
   * «لغو ۱۱» بگیرد و شماره‌های لغوکرده کنار گذاشته شوند — همه‌ی این‌ها را همین
   * یک تیک روشن می‌کند (eventType می‌شود CAMPAIGN).
   */
  const [advertising, setAdvertising] = useState(false)

  const segments = useMemo(() => smsSegments(body), [body])

  useEffect(() => {
    const t = setTimeout(() => {
      void call(CH.smsEstimate, { body, recipients: 1 })
        .then(setEst)
        .catch(() => setEst(null))
    }, 350)
    return () => clearTimeout(t)
  }, [body])

  /**
   * تبدیل «تاریخ شمسی + ساعت» به لحظه‌ی میلادی با همان تابع مشترک برنامه.
   * اگر تاریخ ناقص/نامعتبر باشد `null` می‌ماند ⇒ پیام «در اولین فرصت» می‌رود،
   * نه در یک زمان حدسی.
   */
  const scheduledAt = useMemo(() => {
    if (!scheduledDate.trim() || !scheduledTime.trim()) return null
    try {
      return jalaliAtClock(scheduledDate, scheduledTime).toISOString()
    } catch {
      return null
    }
  }, [scheduledDate, scheduledTime])

  const submit = async () => {
    setLocalBusy(true)
    setLocalErr('')
    try {
      const res = await call(CH.smsSendManual, {
        phone,
        body,
        customerName: customerName || null,
        scheduledAt,
        advertising
      })
      setPhone('')
      setBody('')
      setCustomerName('')
      setAdvertising(false)
      setScheduledDate('')
      setScheduledTime('')
      onChanged()
      setLocalErr('')
      alert(res?.scheduledAtJalali ? 'پیام برای زمان تعیین‌شده ثبت شد.' : 'پیام در صف ثبت شد.')
    } catch (e: any) {
      setLocalErr(e.message)
    } finally {
      setLocalBusy(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Card title="در صف" value={dash?.pending ?? 0} tone="text-sky-700" />
        <Card title="ارسال‌شده امروز" value={dash?.todaySent ?? 0} tone="text-emerald-700" />
        <Card title="زمان‌بندی‌شده" value={dash?.scheduled ?? 0} tone="text-indigo-700" />
        <Card title="ناموفق قطعی" value={dash?.failedFinal ?? 0} tone="text-red-700" />
        <Card title="نتیجه‌ی نامعلوم" value={dash?.unknown ?? 0} tone="text-amber-700" />
        <Card title="کل ارسال‌شده" value={dash?.sent ?? 0} />
      </div>

      <div className="bg-white rounded shadow p-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <div>
          <div className="kbd">خط‌های فعال</div>
          {dash?.provider ? (
            <>
              <div className="font-bold">
                {dash.providerService ? `خدماتی: ${dash.providerService.name}` : 'خدماتی: —'}
              </div>
              <div className="font-bold">
                {dash.providerAds ? `تبلیغاتی: ${dash.providerAds.name}` : 'تبلیغاتی: —'}
              </div>
              <div className="kbd">
                همان خط می‌تواند هر دو کاره باشد؛ خطی که فعال نباشد، پیام‌هایش در صف می‌مانند.
              </div>
            </>
          ) : (
            <>
              <div className="font-bold">— تنظیم نشده —</div>
              <div className="kbd">تا فعال‌نشدن، هیچ پیامی ارسال نمی‌شود</div>
            </>
          )}
        </div>
        <div>
          <div className="kbd">تشکر از خرید</div>
          <div className={dash?.thankYou ? 'font-bold text-emerald-700' : 'font-bold text-slate-500'}>
            {dash?.thankYou ? 'روشن · بعد از هر فاکتور با شماره' : 'خاموش'}
          </div>
        </div>
        <div className="space-y-1">
          <div className="kbd">ارسال خودکار یادآوری اعتبار</div>
          <div className="font-bold">
            {dash?.auto?.enabled
              ? `روشن · ساعت ${faDigits(String(dash.auto.hour).padStart(2, '0'))}:${faDigits(String(dash.auto.minute).padStart(2, '0'))}`
              : 'خاموش'}
          </div>
          <div className="kbd">خاموش‌بودنش فقط ارسال خودکار را می‌خواباند؛ دکمه‌ها همیشه کار می‌کنند.</div>
        </div>
        <div>
          <div className="kbd">آخرین ارسال موفق</div>
          <div className="font-bold">
            {dash?.lastSentAtJalali ? `${faDigits(dash.lastSentAtJalali)} · ${faDigits(dash.lastSentAtTime ?? '')}` : '—'}
          </div>
        </div>
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">ارسال دستی</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="block">
            <span className="kbd">شماره موبایل</span>
            <input
              dir="ltr"
              className="inp text-center"
              placeholder="09121234567"
              value={phone}
              onChange={(e) => setPhone(toLatinDigits(e.target.value))}
            />
          </label>
          <label className="block">
            <span className="kbd">نام مشتری (اختیاری)</span>
            <input className="inp" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </label>
          <label className="block md:col-span-2">
            <span className="kbd">زمان ارسال (خالی = در اولین فرصت)</span>
            <div className="flex gap-1 items-center">
              <JalaliDateInput value={scheduledDate} onChange={setScheduledDate} />
              <input
                dir="ltr"
                className="inp w-24 text-center"
                placeholder="10:30"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(toLatinDigits(e.target.value))}
              />
              {(scheduledDate || scheduledTime) && (
                <button
                  className="btn py-1"
                  onClick={() => {
                    setScheduledDate('')
                    setScheduledTime('')
                  }}
                >
                  پاک
                </button>
              )}
            </div>
          </label>
        </div>
        <label className="block">
          <span className="kbd">متن پیام</span>
          <textarea className="inp h-24" value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <div className="flex items-center gap-3 flex-wrap kbd">
          <span>
            طول: {faDigits(body.length)} نویسه · {faDigits(segments)} بخش
          </span>
          {est && (
            <span>
              برآورد: {faDigits(est.messages)} پیامک
              {est.filled ? ` ≈ ${faDigits(est.toman)} تومان` : ' (قیمت هر پیامک در تنظیمات تعیین نشده)'}
            </span>
          )}
        </div>
        <label className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded p-2">
          <input
            type="checkbox"
            className="mt-1"
            checked={advertising}
            onChange={(e) => setAdvertising(e.target.checked)}
          />
          <span className="text-sm">
            <b>این پیام تبلیغاتی است</b>
            <span className="kbd block leading-6">
              با تیک‌خوردن: جمله‌ی «لغو ۱۱» خودکار به انتهای متن اضافه می‌شود، پیام از <b>خط تبلیغاتی</b> می‌رود
              (نه خط خدماتی) و شماره‌هایی که قبلاً لغو کرده‌اند پیام نمی‌گیرند. برای پیام‌های معمول (یادآوری،
              اطلاع‌رسانی به خودِ مشتری) این تیک را نزنید.
            </span>
          </span>
        </label>
        {!body.trim() && (
          <div className="kbd">
            می‌توانید یکی از قالب‌های آماده را در تب «قالب‌ها» ببینید و متنش را همین‌جا بچسبانید.
          </div>
        )}
        {localErr && <div className="bg-red-50 border border-red-300 text-red-800 rounded p-2 text-sm">{localErr}</div>}
        <div className="flex gap-2">
          <button
            className="btn btn-primary"
            disabled={localBusy || !phone.trim() || !body.trim()}
            onClick={() => setConfirmOpen(true)}
          >
            {localBusy ? '…' : scheduledAt ? 'ثبت برای زمان تعیین‌شده' : 'ثبت در صف'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="تأیید ثبت پیام"
        message={
          <div className="space-y-1 text-sm">
            <div>
              گیرنده: <span dir="ltr">{phone}</span>
            </div>
            <div>
              بخش‌ها: {faDigits(segments)}
              {est?.filled ? ` · برآورد ${faDigits(est.toman)} تومان` : ''}
            </div>
            <div>{scheduledAt ? 'در زمان تعیین‌شده ارسال می‌شود.' : 'در اولین فرصت ارسال می‌شود.'}</div>
            <div className={advertising ? 'text-amber-800 font-bold' : 'kbd'}>
              {advertising
                ? 'تبلیغاتی: از خط تبلیغاتی می‌رود و «لغو ۱۱» به متن اضافه می‌شود.'
                : 'خدماتی/معمولی: از خط خدماتی می‌رود و جمله‌ی لغو نمی‌گیرد.'}
            </div>
          </div>
        }
        confirmLabel="بله، ثبت کن"
        busy={localBusy}
        onConfirm={() => void submit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// صف / زمان‌بندی‌شده / سابقه
// ---------------------------------------------------------------------------

function ListTab({
  which,
  rows,
  total,
  status,
  setStatus,
  search,
  setSearch,
  busy,
  act
}: {
  which: Tab
  rows: any[]
  total: number
  status: string
  setStatus: (v: string) => void
  search: string
  setSearch: (v: string) => void
  busy: boolean
  act: (fn: () => Promise<any>, message?: string) => Promise<any>
}) {
  const [cancelTarget, setCancelTarget] = useState<any>(null)
  const [reason, setReason] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [retryTarget, setRetryTarget] = useState<any>(null)
  /**
   * برگرداندن ردیفِ **کمپین** به صف، پشت قفل حساس می‌رود: «لغو گروهی» برای
   * خواباندن یک کمپین تبلیغاتی است؛ اگر همان ردیف‌ها یکی‌یکی و بی‌قفل برگردند،
   * آن محافظت دور خورده است. برگرداندن پیام‌های غیرکمپین مثل قبل روزمره است.
   */
  const [requeueTarget, setRequeueTarget] = useState<any>(null)
  /**
   * سابقه‌ی یک پیام. چرا لازم است: «هرگز گم نشود» فقط با صف حل نمی‌شود —
   * کاربر باید بتواند ببیند *کجا* گیر کرده. متن پیام و نتیجه‌ی هر تلاش از
   * `sms:detail` خوانده می‌شود و هیچ عددی از آن به گزارش‌ها نمی‌رود.
   */
  const [detail, setDetail] = useState<any>(null)
  /** قفل «عملیات حساس» همین حالا باز است؟ (همان تصمیمی که `ManagerGate` می‌گیرد) */
  const dangerOpen = usePanelOpen(PANEL_KEYS.smsDanger)

  const headers =
    which === 'scheduled'
      ? ['#', 'وضعیت', 'گیرنده', 'نام', 'نوع', 'زمان ارسال', 'بخش', 'عملیات']
      : ['#', 'وضعیت', 'گیرنده', 'نام', 'نوع', 'ایجاد', 'تلاش', 'آخرین خطا', 'عملیات']

  const body = (r: any): (string | number)[] => {
    if (which === 'scheduled')
      return [
        r.id,
        r.statusLabel,
        r.phone,
        r.customerName ?? '—',
        r.eventLabel,
        `${faDigits(r.scheduledAtJalali ?? '')} ${faDigits(r.scheduledAtTime ?? '')}`,
        r.segments,
        ''
      ]
    return [
      r.id,
      r.statusLabel,
      r.phone,
      r.customerName ?? '—',
      r.eventLabel,
      `${faDigits(r.createdAtJalali ?? '')} ${faDigits(r.createdAtTime ?? '')}`,
      `${r.attemptCount}/${r.maxAttempts}`,
      r.lastErrorMessage ?? r.cancelReason ?? '—',
      ''
    ]
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2 flex-wrap">
        {(which === 'queue' || which === 'history') && (
          <label className="block">
            <span className="kbd">وضعیت</span>
            <select className="inp" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">همه</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="kbd">جست‌وجوی شماره</span>
          <input
            dir="ltr"
            className="inp text-center"
            value={search}
            onChange={(e) => setSearch(toLatinDigits(e.target.value))}
          />
        </label>
        <span className="grow" />
        <span className="kbd">{faDigits(rows.length)} ردیف نمایش‌داده‌شده از {faDigits(total)}</span>
        <button
          className="btn"
          disabled={busy || !rows.length}
          onClick={() =>
            void exportTable({
              fileName: `sms-${which}-${jalaliToday().replace(/\//g, '-')}.xlsx`,
              headers,
              rows: rows.map((r) => body(r))
            })
          }
        >
          خروجی اکسل
        </button>
        {which !== 'history' && (
          <button className="btn btn-danger" disabled={busy || !rows.length} onClick={() => setBulkOpen(true)}>
            لغو گروهی
          </button>
        )}
      </div>

      <div className="tbl-wrap max-h-[60vh] overflow-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>وضعیت</th>
              <th>گیرنده</th>
              <th>نام</th>
              <th>نوع</th>
              <th>{which === 'scheduled' ? 'زمان ارسال' : 'ایجاد'}</th>
              <th>{which === 'scheduled' ? 'بخش' : 'تلاش'}</th>
              {which !== 'scheduled' && <th>آخرین خطا</th>}
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} title={r.body}>
                <td>{faDigits(r.id)}</td>
                <td className={tone(r.status)}>
                  {r.statusLabel}
                  {/**
                   * ⚠️ ردیفِ «نتیجه نامعلوم» تنها وضعیتی است که خودش توضیح لازم
                   * دارد: ارسال شروع شد ولی جوابِ سرویس‌دهنده ثبت نشد. اپراتور
                   * بدون این توضیح یا بی‌خیال رد می‌شود یا بی‌احتیاط «تلاش
                   * مجدد» می‌زند و مشتری دو پیامک می‌گیرد.
                   */}
                  {r.status === 'UNKNOWN' && (
                    <div
                      className="text-[11px] font-normal text-red-600"
                      title="پیام به سرویس‌دهنده سپرده شد ولی نتیجه‌اش ثبت نشد؛ ممکن است رسیده باشد. هیچ تلاش خودکاری انجام نمی‌شود — تصمیم با شماست."
                    >
                      ممکن است رسیده باشد — با احتیاط
                    </div>
                  )}
                </td>
                <td dir="ltr">{r.phone}</td>
                <td>{r.customerName ?? '—'}</td>
                <td>{r.eventLabel}</td>
                <td>
                  {which === 'scheduled'
                    ? `${faDigits(r.scheduledAtJalali ?? '')} ${faDigits(r.scheduledAtTime ?? '')}`
                    : `${faDigits(r.createdAtJalali ?? '')} ${faDigits(r.createdAtTime ?? '')}`}
                </td>
                <td>{which === 'scheduled' ? faDigits(r.segments) : `${faDigits(r.attemptCount)}/${faDigits(r.maxAttempts)}`}</td>
                {which !== 'scheduled' && <td className="max-w-[280px] truncate">{r.lastErrorMessage ?? r.cancelReason ?? '—'}</td>}
                <td>
                  <div className="flex gap-2">
                    <button
                      className="text-brand font-bold"
                      disabled={busy}
                      title="متن پیام و سابقه‌ی تلاش‌ها"
                      onClick={() =>
                        void act(async () => {
                          const res = await call(CH.smsDetail, { id: r.id })
                          setDetail(res)
                          return res
                        })
                      }
                    >
                      جزئیات
                    </button>
                    {r.canCancel && (
                      <button
                        className="text-brand font-bold"
                        disabled={busy}
                        onClick={() => {
                          setReason('')
                          setCancelTarget(r)
                        }}
                      >
                        لغو
                      </button>
                    )}
                    {r.canRequeue && (
                      <button
                        className="text-brand font-bold"
                        disabled={busy}
                        title={
                          r.eventType === 'CAMPAIGN'
                            ? 'برگرداندن پیام کمپین به صف (با رمز مدیر)'
                            : 'برگرداندن این پیام به صف'
                        }
                        onClick={() => {
                          if (r.eventType === 'CAMPAIGN') {
                            setRequeueTarget(r)
                            return
                          }
                          void act(() => call(CH.smsRequeue, { id: r.id }), 'پیام به صف برگشت.')
                        }}
                      >
                        برگرداندن به صف
                      </button>
                    )}
                    {r.status !== 'SENT' && r.status !== 'PROCESSING' && !r.canRequeue && !r.reminderNeedsCreditPanel && (
                      <button
                        className="text-brand font-bold"
                        disabled={busy}
                        title="ارسال فوری، بدون انتظار برای زمان‌بند"
                        onClick={() => setRetryTarget(r)}
                      >
                        تلاش مجدد
                      </button>
                    )}
                    {/**
                     * یادآوری اعتبارِ لغو/ناموفق را از اینجا برنگردان: سهمیه‌اش
                     * آزاد شده و برگرداندن دستی، فردا یادآوری تکراری می‌سازد.
                     * به‌جای دکمه، راه درست را نشان می‌دهیم (کاربر باید بداند چرا).
                     */}
                    {r.reminderNeedsCreditPanel && (
                      <span
                        className="text-[11px] text-amber-700"
                        title="این یادآوری لغو/ناموفق شده و سهمیه‌اش آزاد شده است. برای فرستادن دوباره، دکمه‌ی «یادآوری» همان کد در پنل اعتبار خرید را بزنید — آن مسیر سهمیه را درست مصرف می‌کند و از ارسال تکراری جلوگیری می‌شود."
                      >
                        از پنل اعتبار بفرستید
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={headers.length} className="text-center kbd py-6">
                  چیزی برای نمایش نیست.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!cancelTarget}
        title="لغو ارسال"
        message={
          <div className="space-y-2 text-sm">
            <div>
              پیام #{faDigits(cancelTarget?.id ?? 0)} به <span dir="ltr">{cancelTarget?.phone}</span> ارسال نمی‌شود.
            </div>
            <div className="kbd">
              لغو یعنی «حذف» نه؛ رکورد می‌ماند و بعداً می‌شود به صف برگرداند.
            </div>
            <input
              className="inp"
              placeholder="دلیل لغو (اختیاری)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        }
        confirmLabel="بله، لغو کن"
        busy={busy}
        onConfirm={() =>
          void act(async () => {
            await call(CH.smsCancel, { id: cancelTarget?.id, reason })
            setCancelTarget(null)
          }, 'پیام لغو شد.')
        }
        onCancel={() => setCancelTarget(null)}
      />

      {/*
        قفل «عملیات حساس» — چرا این‌جا و به این شکل:
        دکمه‌ها همیشه کلیک‌پذیرند و اگر قفل بسته باشد **همان لحظه** یک کادر رمز
        روی صفحه می‌آید؛ بعد از باز شدن، دیالوگ تایید خودش ظاهر می‌شود. اگر
        دیالوگ را داخل `<ManagerGate>` می‌گذاشتیم، کلیک کاربر هیچ واکنش
        دیدنی‌ای نداشت (کادر رمز بیرون از دیالوگ و در جریان فهرست رندر می‌شد)
        و می‌شد «چرا این دکمه کار نمی‌کند؟».
      */}
      {!dangerOpen && (bulkOpen || !!retryTarget || !!requeueTarget) && (
        <div className="fixed inset-0 z-[60] bg-black/40 overflow-auto p-4 flex items-start justify-center">
          <div className="w-full max-w-md my-10">
            <ManagerGate
              panel={PANEL_KEYS.smsDanger}
              title="عملیات حساس صف پیامک"
              reason="لغو گروهی، تلاش مجدد و برگرداندن پیام‌های کمپین روی پیام‌های واقعی مشتری اثر می‌گذارد، پس با رمز باز می‌شود."
              inline
            >
              <div className="bg-white rounded shadow p-4 font-bold">قفل باز شد — دیالوگ تایید همین حالا باز می‌شود…</div>
            </ManagerGate>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!retryTarget && dangerOpen}
          title="تلاش مجدد"
          message={
            <div className="text-sm space-y-1">
              <div>
                پیام #{faDigits(retryTarget?.id ?? 0)} به <span dir="ltr">{retryTarget?.phone}</span> همین حالا دوباره
                فرستاده می‌شود.
              </div>
              <div
                className={
                  retryTarget?.status === 'UNKNOWN' ? 'text-red-700 font-bold' : 'kbd'
                }
              >
                {retryTarget?.status === 'UNKNOWN'
                  ? 'نتیجه‌ی همین پیام نامعلوم است: ممکن است رسیده باشد. تلاش مجدد می‌تواند پیام دوم به مشتری بدهد — فقط وقتی بزن که مطمئنی اولی نرسیده.'
                  : 'اگر آخرین خطا «نتیجه‌ی نامعلوم» بوده، این کار ممکن است پیام دوم به مشتری بدهد — فقط وقتی مطمئنید پیام اول نرسیده.'}
              </div>
            </div>
          }
          confirmLabel="بله، تلاش کن"
          busy={busy}
          onConfirm={() =>
            void act(async () => {
              const res = await call(CH.smsRetryNow, { id: retryTarget?.id })
              setRetryTarget(null)
              return res
            }, 'پیام برای تلاش مجدد آماده شد.')
          }
          onCancel={() => setRetryTarget(null)}
      />

      <ConfirmDialog
        open={!!requeueTarget && dangerOpen}
        title="برگرداندن پیام کمپین به صف"
        message={
          <div className="text-sm space-y-1">
            <div>
              پیام #{faDigits(requeueTarget?.id ?? 0)} از کمپین «{requeueTarget?.campaignId ? `#${faDigits(requeueTarget.campaignId)}` : 'بدون شناسه'}» به
              صف برمی‌گردد و در اولین فرصت برای <span dir="ltr">{requeueTarget?.phone}</span> فرستاده می‌شود.
            </div>
            <div className="kbd">
              اگر این ردیف بخشی از یک لغو گروهی بوده، برگرداندنش یعنی آن شماره دوباره پیام تبلیغاتی می‌گیرد.
            </div>
          </div>
        }
        confirmLabel="بله، برگردان"
        busy={busy}
        onConfirm={() =>
          void act(async () => {
            const res = await call(CH.smsRequeue, { id: requeueTarget?.id })
            setRequeueTarget(null)
            return res
          }, 'پیام به صف برگشت.')
        }
        onCancel={() => setRequeueTarget(null)}
      />

      <ConfirmDialog
        open={bulkOpen && dangerOpen}
          title="لغو گروهی"
          message={
            <div className="space-y-2 text-sm">
              <div>
                همه‌ی {faDigits(rows.length)} پیام ارسال‌نشده‌ی همین فهرست لغو می‌شوند. پیام‌های ارسال‌شده دست‌نخورده
                می‌مانند.
              </div>
              <input
                className="inp"
                placeholder="دلیل لغو گروهی (اختیاری)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          }
          confirmLabel="بله، همه را لغو کن"
          busy={busy}
          onConfirm={() =>
            void act(async () => {
              const res = await call(CH.smsCancelBulk, { ids: rows.map((r) => r.id), reason })
              setBulkOpen(false)
              return res
            }, 'لغو گروهی انجام شد.')
          }
          onCancel={() => setBulkOpen(false)}
      />

      <Modal
        open={!!detail}
        title={`جزئیات پیام #${faDigits(detail?.message?.id ?? 0)}`}
        onClose={() => setDetail(null)}
        width="max-w-2xl"
      >
        {detail?.message && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="kbd">وضعیت</span>
                <div className={tone(detail.message.status)}>{detail.message.statusLabel}</div>
                {detail.message.status === 'UNKNOWN' && (
                  <div className="text-[11px] text-red-600 mt-1 leading-5">
                    ارسال به سرویس‌دهنده شروع شد ولی نتیجه‌اش ثبت نشد؛ ممکن است رسیده باشد.
                    <br />
                    • هیچ تلاش خودکاری انجام نمی‌شود — وگرنه ممکن است مشتری دو پیام بگیرد.
                    <br />
                    • اگر شک داری، در پنل سرویس‌دهنده (sms.ir / کاوه‌نگار) وضعیت همین پیام را ببین.
                    <br />• اگر مطمئنی نرسیده، «تلاش مجدد» بزن؛ اگر شک داری، دست نزن.
                  </div>
                )}
              </div>
              <div>
                <span className="kbd">نوع</span>
                <div>{detail.message.eventLabel}</div>
              </div>
              <div>
                <span className="kbd">گیرنده</span>
                <div dir="ltr">{detail.message.phone}</div>
              </div>
              <div>
                <span className="kbd">نام</span>
                <div>{detail.message.customerName ?? '—'}</div>
              </div>
              <div>
                <span className="kbd">تلاش</span>
                <div>
                  {faDigits(detail.message.attemptCount)} از {faDigits(detail.message.maxAttempts)}
                </div>
              </div>
              <div>
                <span className="kbd">بخش‌ها</span>
                <div>{faDigits(detail.message.segments)}</div>
              </div>
            </div>

            <div>
              <span className="kbd">متن پیام</span>
              <div className="bg-slate-50 border rounded p-2 whitespace-pre-wrap">{detail.message.body}</div>
            </div>

            {detail.message.lastErrorMessage && (
              <div className="bg-red-50 border border-red-300 text-red-800 rounded p-2">
                آخرین خطا: {detail.message.lastErrorMessage}
              </div>
            )}

            <div>
              <span className="kbd">سابقه‌ی تلاش‌ها</span>
              <div className="tbl-wrap max-h-[35vh] overflow-auto mt-1">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>زمان</th>
                      <th>نتیجه</th>
                      <th>کد خطا</th>
                      <th>پیام سرویس‌دهنده</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.attempts ?? []).map((a: any) => (
                      <tr key={a.id}>
                        <td>{faDigits(a.attemptNo)}</td>
                        <td>{`${faDigits(a.startedAtJalali ?? '')} ${faDigits(a.startedAtTime ?? '')}`}</td>
                        <td>{a.result}</td>
                        <td dir="ltr">{a.errorCode ?? '—'}</td>
                        <td className="max-w-[280px] truncate">{a.errorMessage ?? '—'}</td>
                      </tr>
                    ))}
                    {!(detail.attempts ?? []).length && (
                      <tr>
                        <td colSpan={5} className="text-center kbd py-4">
                          هنوز تلاشی انجام نشده است.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ---------------------------------------------------------------------------
// قالب‌ها
// ---------------------------------------------------------------------------

function TemplatesTab({
  templates,
  act,
  busy
}: {
  templates: any[]
  act: (fn: () => Promise<any>, message?: string) => Promise<any>
  busy: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<Record<string, boolean>>({})

  const draftOf = (t: any) => drafts[t.code] ?? t.body

  const sampleVars: Record<string, string> = {
    customer_name: 'آقای محمدی',
    customer_phone: '09121234567',
    store_name: 'فروشگاه ارکاجین',
    store_phone: '02112345678',
    invoice_no: '1024',
    invoice_date: '1405/07/15',
    invoice_total: '4,500,000',
    paid_amount: '4,500,000',
    remaining_amount: '0',
    credit_code: 'AR7K2M9Q',
    credit_amount: '5,000,000',
    credit_remaining: '3,200,000',
    credit_expiry: '1405/08/15',
    campaign_text: 'این هفته ۲۰٪ تخفیف روی پوشاک زمستانه',
    opt_out_note: DEFAULT_SMS_OPT_OUT_NOTE
  }

  return (
    <div className="space-y-3">
      <div className="kbd">
        متغیرهای مجاز: {Object.entries(SMS_PLACEHOLDER_LABELS).map(([k, v]) => `{${k}} = ${v}`).join(' · ')}
      </div>
      {templates.map((t) => {
        const text = draftOf(t)
        const rendered = renderSmsTemplate(text, sampleVars)
        return (
          <div key={t.code} className="bg-white rounded shadow p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold">{t.title}</span>
              <span className="kbd">{t.code}</span>
              {t.isSystem && <span className="kbd">قالب سیستمی</span>}
              <span className="kbd">نسخه {faDigits(t.version)}</span>
              <span className="grow" />
              <span className="kbd">{faDigits(smsSegments(text))} بخش</span>
              <button className="btn py-1" onClick={() => setPreview((p) => ({ ...p, [t.code]: !p[t.code] }))}>
                پیش‌نمایش
              </button>
              {t.isSystem && (
                <button
                  className="btn py-1"
                  disabled={busy}
                  onClick={() => void act(() => call(CH.smsTemplateReset, { code: t.code }), 'قالب به متن پیش‌فرض برگشت.')}
                >
                  بازگرداندن به پیش‌فرض
                </button>
              )}
              <button
                className="btn btn-primary py-1"
                disabled={busy || text === t.body}
                onClick={() =>
                  void act(
                    () => call(CH.smsTemplateSave, { code: t.code, body: text }),
                    'قالب ذخیره شد. پیام‌های قبلی دست‌نخورده ماندند.'
                  )
                }
              >
                ذخیره
              </button>
            </div>
            <textarea
              className="inp h-24"
              value={text}
              onChange={(e) => setDrafts((d) => ({ ...d, [t.code]: e.target.value }))}
            />
            {rendered.unknown.length > 0 && (
              <div className="bg-red-50 border border-red-300 text-red-800 rounded p-2 text-sm">
                متغیر ناشناخته: {rendered.unknown.map((k) => `{${k}}`).join(' ')} — تا اصلاح نشود ذخیره نمی‌شود.
              </div>
            )}
            {preview[t.code] && (
              <div className="bg-slate-50 border border-slate-200 rounded p-2">
                <div className="kbd">پیش‌نمایش با داده‌ی نمونه</div>
                <div className="whitespace-pre-wrap">{rendered.text}</div>
                {rendered.missing.length > 0 && (
                  <div className="kbd text-amber-700">
                    بدون مقدار: {rendered.missing.map((k) => `{${k}}`).join(' ')}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      {!templates.length && <div className="kbd">قالبی ثبت نشده است.</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// سرویس‌دهنده
// ---------------------------------------------------------------------------

function ProviderTab({
  data,
  act,
  busy
}: {
  data: any
  act: (fn: () => Promise<any>, message?: string) => Promise<any>
  busy: boolean
}) {
  const [form, setForm] = useState<any>({
    providerKey: 'LOG_ONLY',
    name: '',
    senderNumber: '',
    patternId: '',
    patternForService: true,
    purpose: 'BOTH',
    apiKey: ''
  })
  const [pw, setPw] = useState('')
  const [editingId, setEditingId] = useState<number | null>(null)

  const rows: any[] = data?.rows ?? []

  const startEdit = (r: any) => {
    setEditingId(r.id)
    setForm({
      providerKey: r.providerKey,
      name: r.name,
      senderNumber: r.senderNumber ?? '',
      patternId: r.patternId ?? '',
      patternForService: r.patternForService !== false,
      purpose: r.purpose ?? 'BOTH',
      apiKey: ''
    })
    setPw('')
  }

  const save = () =>
    act(
      async () => {
        const res = await call(CH.smsProviderSave, {
          id: editingId,
          providerKey: form.providerKey,
          name: form.name,
          senderNumber: form.senderNumber,
          patternId: form.patternId,
          patternForService: form.patternForService,
          purpose: form.purpose,
          secrets: form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : undefined,
          managerPassword: pw || undefined
        })
        setEditingId(null)
        setForm({ providerKey: 'LOG_ONLY', name: '', senderNumber: '', patternId: '', patternForService: true, purpose: 'BOTH', apiKey: '' })
        setPw('')
        return res
      },
      'سرویس‌دهنده ذخیره شد.'
    )

  return (
    /**
     * ⚠️ قفلِ اختصاصی «اتصال سرویس‌دهنده»:
     * هدف این است که بشود به یک کارمند فقط «ارسال پیام» داد. اگر این تب پشت
     * همان قفلِ پنل بود، هر کسی که رمز دوم پنل را داشت می‌توانست سرشماره و
     * کلید API فروشگاه را ببیند یا عوض کند. (سمت سرور هم همین قفل جدا چک
     * می‌شود؛ این پوشش فقط لایه‌ی نمایش است.)
     */
    <ManagerGate
      panel={PANEL_KEYS.smsProvider}
      title="اتصال سرویس‌دهنده‌ی پیامک"
      reason="این تب سرشماره، شناسه‌ی پترن و کلید API سرویس پیامک را نشان می‌دهد، پس قفل جداگانه دارد."
    >
    <div className="space-y-3">
      {data && !data.vaultReady && (
        <div className="bg-amber-50 border border-amber-300 text-amber-900 rounded p-2 text-sm">
          گاوصندوق رمزهای این دستگاه آماده نیست. کلید API ذخیره نمی‌شود تا امن بماند؛ اگر این دیتابیس را از
          بکاپ روی دستگاه دیگری بازگردانده‌اید، باید روی همان دستگاه یک بار سرویس‌دهنده را دوباره تنظیم کنید.
        </div>
      )}

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>نام</th>
              <th>سرویس‌دهنده</th>
              <th>سرشماره</th>
              <th>کاربرد خط</th>
              <th>پترن</th>
              <th>کلید API</th>
              <th>وضعیت</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{faDigits(r.id)}</td>
                <td>{r.name}</td>
                <td>{r.providerLabel}</td>
                <td dir="ltr">{r.senderNumber ?? '—'}</td>
                <td>
                  <span className="kbd">{r.purposeLabel ?? 'هر دو کاره (یک خط)'}</span>
                  {r.isActive && r.purpose === 'SERVICE' && (
                    <div className="kbd text-emerald-700">خدماتی/یادآوری از این خط می‌رود</div>
                  )}
                  {r.isActive && r.purpose === 'ADS' && (
                    <div className="kbd text-emerald-700">تبلیغاتی/انبوه از این خط می‌رود</div>
                  )}
                </td>
                <td dir="ltr">
                  {r.patternId ?? '—'}
                  {r.patternId && r.patternForService === false && (
                    <div className="kbd text-amber-700">متن کامل (بی‌الگو)</div>
                  )}
                </td>
                <td>{r.hasCredentials ? 'ثبت شده ✓' : 'ثبت نشده'}</td>
                <td>
                  {r.isActive ? <span className="text-emerald-700 font-bold">فعال</span> : <span className="kbd">غیرفعال</span>}
                  {r.missing.length > 0 && <div className="kbd text-amber-700">جاافتاده: {r.missing.join(' · ')}</div>}
                  {r.lastHealthNote && <div className="kbd">{r.lastHealthNote}</div>}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button className="text-brand font-bold" disabled={busy} onClick={() => startEdit(r)}>
                      ویرایش
                    </button>
                    {!r.isActive && (
                      <button
                        className="text-brand font-bold"
                        disabled={busy}
                        onClick={() => void act(() => call(CH.smsProviderActivate, { id: r.id }), 'سرویس‌دهنده فعال شد.')}
                      >
                        فعال‌کردن
                      </button>
                    )}
                    <button
                      className="text-brand font-bold"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const res = await call(CH.smsProviderTest, { id: r.id })
                          alert(res.detail)
                          return res
                        })
                      }
                    >
                      تست اتصال
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="text-center kbd py-6">
                  هنوز سرویس‌دهنده‌ای تعریف نشده است.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">{editingId ? `ویرایش سرویس‌دهنده #${faDigits(editingId)}` : 'افزودن سرویس‌دهنده'}</div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <label className="block">
            <span className="kbd">سرویس‌دهنده</span>
            <select
              className="inp"
              value={form.providerKey}
              onChange={(e) => setForm({ ...form, providerKey: e.target.value })}
            >
              {(data?.options ?? []).map((o: any) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="kbd">نام نمایشی</span>
            <input className="inp" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="block">
            <span className="kbd">سرشماره</span>
            <input
              dir="ltr"
              className="inp text-center"
              value={form.senderNumber}
              onChange={(e) => setForm({ ...form, senderNumber: toLatinDigits(e.target.value) })}
            />
          </label>
          <label className="block">
            <span className="kbd">کاربرد این خط</span>
            <select
              className="inp"
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            >
              <option value="BOTH">{SMS_LINE_PURPOSE_LABELS.BOTH}</option>
              <option value="SERVICE">{SMS_LINE_PURPOSE_LABELS.SERVICE}</option>
              <option value="ADS">{SMS_LINE_PURPOSE_LABELS.ADS}</option>
            </select>
          </label>
          <label className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded p-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.patternForService !== false}
              onChange={(e) => setForm({ ...form, patternForService: e.target.checked })}
            />
            <span className="text-sm">
              <b>پیام‌های خدماتی با «الگوی تأییدشده» بروند</b>
              <span className="kbd block leading-6">
                اگر تیک را بردارید، پیامِ تشکر/یادآوری با <b>متن کامل و ویرایش‌شده‌ی خودتان</b> می‌رود، نه با
                الگو. (بعضی خطوط برای متن آزاد محدودیت دارند — اگر مطمئن نیستید، تیک را نگه دارید.)
              </span>
            </span>
          </label>
          <label className="block">
            <span className="kbd">شناسه‌ی پترن</span>
            <input
              dir="ltr"
              className="inp text-center"
              value={form.patternId}
              onChange={(e) => setForm({ ...form, patternId: toLatinDigits(e.target.value) })}
            />
          </label>
          <label className="block md:col-span-2">
            <span className="kbd">کلید API (خالی = دست‌نزدن به کلید فعلی)</span>
            <PasswordField value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} />
          </label>
          <label className="block md:col-span-2">
            <span className="kbd">رمز مدیر (برای تغییر کلید API لازم است)</span>
            <PasswordField value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
        </div>
        <div className="kbd">
          🔐 کلید API با گاوصندوق همین دستگاه مهر می‌شود و هرگز به‌صورت خام ذخیره یا نمایش داده نمی‌شود. اگر
          خالی بگذارید، کلید فعلی دست‌نخورده می‌ماند.
        </div>
        <div className="kbd leading-6">
          📌 «کاربرد این خط» را جدی بگیرید: پیام تبلیغاتی (انبوه) باید از خط تبلیغاتی برود و پیام خدماتی (تشکر از
          خرید، یادآوری اعتبار) از خط خدماتی — با یک خط می‌توانید «هر دو کاره» را انتخاب کنید. اگر خطِ یک کاربرد
          فعال نباشد، آن پیام‌ها <b>در صف می‌مانند</b> و از خط اشتباه نمی‌روند.
        </div>
        <div className="kbd leading-6">
          📌 «سرشماره» همان خطی است که پیام از آن می‌رود (مثلاً ۳۰۰۰۵... در sms.ir یا ۱۰۰۰۴... در کاوه‌نگار). «شناسه‌ی
          پترن» را فقط اگر می‌خواهید پیام‌های خدماتی/یادآوری با <b>الگوی تأییدشده</b> بروند پر کنید؛ در آن حالت
          نام جای‌گذارهای قالب باید دقیقاً با نام پارامترهای همان الگو یکی باشد (مثل نام مشتری و مبلغ). برای
          پیامک تبلیغاتی، شناسه‌ی پترن را خالی بگذارید تا متن آزاد روی خط تبلیغاتی برود.
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            ذخیره
          </button>
          {editingId && (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                setEditingId(null)
                setForm({ providerKey: 'LOG_ONLY', name: '', senderNumber: '', patternId: '', patternForService: true, purpose: 'BOTH', apiKey: '' })
                setPw('')
              }}
            >
              انصراف
            </button>
          )}
        </div>
      </div>
    </div>
    </ManagerGate>
  )
}

// ---------------------------------------------------------------------------
// تنظیمات
// ---------------------------------------------------------------------------

function SettingsTab({
  settings,
  act,
  busy
}: {
  settings: any
  act: (fn: () => Promise<any>, message?: string) => Promise<any>
  busy: boolean
}) {
  const [auto, setAuto] = useState<SmsAutoSettings | null>(null)
  const [thankYou, setThankYou] = useState(false)
  const [price, setPrice] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!settings) return
    setAuto(settings.auto)
    setThankYou(settings.thankYou === true)
    setPrice(settings.pricePerSegment ? String(settings.pricePerSegment) : '')
    setNote(settings.optOutNote ?? '')
  }, [settings])

  if (!auto) return <div className="kbd">…</div>

  const saveAuto = (next: SmsAutoSettings) => {
    setAuto(next)
    void act(() => call(CH.smsSettingsSet, { auto: next }), 'تنظیم ارسال خودکار ذخیره شد.')
  }

  return (
    <div className="space-y-3">
      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">تشکر از خرید</div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={thankYou}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.checked
              setThankYou(next)
              void act(() => call(CH.smsSettingsSet, { thankYou: next }), next ? 'پیام تشکر روشن شد.' : 'پیام تشکر خاموش شد.')
            }}
          />
          <span>
            بعد از هر فاکتور فروش که شماره تلفن داشته باشد، پیام تشکر بفرست (تکی و عمده — یک کلید برای هر دو).
          </span>
        </label>
        <div className="kbd">
          خاموش‌کردن این کلید فقط پیام خودکارِ تشکر را می‌خواباند؛ ارسال دستی از تب داشبورد همیشه کار می‌کند. متن هر
          دو پیام در تب «قالب‌ها» قابل ویرایش است، و اگر قالب یکی از دو نوع را خاموش کنی، فقط همان نوع پیام نمی‌رود.
        </div>
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">ارسال خودکار یادآوری اعتبار</div>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={auto.enabled}
            disabled={busy}
            onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })}
          />
          <span>روشن باشد: هر روز سر ساعت تعیین‌شده، خودش برای اعتبارهای مصرف‌نشده پیام می‌فرستد.</span>
        </label>
        <div className="flex items-end gap-2 flex-wrap">
          <label className="block">
            <span className="kbd">ساعت</span>
            <select
              className="inp"
              value={auto.hour}
              disabled={busy || !auto.enabled}
              onChange={(e) => saveAuto({ ...auto, hour: Number(e.target.value) })}
            >
              {SMS_AUTO_SCHEDULE_HOURS.map((h) => (
                <option key={h} value={h}>
                  {faDigits(String(h).padStart(2, '0'))}:۰۰
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="kbd">دقیقه</span>
            <select
              className="inp"
              value={auto.minute}
              disabled={busy || !auto.enabled}
              onChange={(e) => saveAuto({ ...auto, minute: Number(e.target.value) })}
            >
              {[0, 15, 30, 45].map((m) => (
                <option key={m} value={m}>
                  {faDigits(String(m).padStart(2, '0'))}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="kbd">
          ⚠️ خاموش‌بودن این کلید فقط ارسال «خودکار» را می‌خواباند؛ ارسال دستی همیشه کار می‌کند. اگر اینترنت
          قطع باشد، پیام‌ها در صف می‌مانند و بعداً می‌روند (گم نمی‌شوند).
        </div>
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">هزینه و متن‌های عمومی</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="block">
            <span className="kbd">قیمت هر بخش پیامک (تومان) — فقط برای برآورد</span>
            <input
              dir="ltr"
              className="inp text-center"
              value={price}
              onChange={(e) => setPrice(toLatinDigits(e.target.value).replace(/[^0-9]/g, ''))}
            />
          </label>
          <label className="block">
            <span className="kbd">جمله‌ی انتهای پیامک‌های تبلیغاتی</span>
            <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="kbd">
          این عدد **هیچ محاسبه‌ی مالی‌ای در برنامه انجام نمی‌دهد**؛ فقط برای این است که قبل از ارسال انبوه،
          برآورد هزینه را ببینید. جمله‌ی لغو عمداً تنظیم‌شدنی است تا اگر مقررات عوض شد، نیازی به تغییر برنامه نباشد.
        </div>
        <button
          className="btn btn-primary"
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                call(CH.smsSettingsSet, {
                  pricePerSegment: price ? Number(price) : 0,
                  optOutNote: note
                }),
              'تنظیمات ذخیره شد.'
            )
          }
        >
          ذخیره
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// فاز ۴ — ارسال انبوه (کمپین تبلیغاتی)
// ---------------------------------------------------------------------------

/** تاریخ شمسی کوتاه — هرگز صفحه را نمی‌ترکاند (فیلد تزئینی است). */
function jShort(value: unknown): string {
  try {
    const d = new Date(String(value ?? ''))
    if (Number.isNaN(d.getTime())) return '—'
    return toJalaliDate(d)
  } catch {
    return '—'
  }
}

/**
 * «ارسال انبوه» — مخاطب از دو جا: دفترچه‌ی برنامه یا فهرست چسبانده‌شده.
 *
 * ⚠️ سه چیز عمدی:
 *   ۱) هیچ ارسالی «همین‌جا» انجام نمی‌شود؛ فقط صف می‌شود. پس ثبت کمپین با
 *      اینترنت قطع هم کار می‌کند و پیام‌ها گم نمی‌شوند.
 *   ۲) پیش‌نمایش (تعداد + بخش + هزینه) **اجباری** است؛ دکمه‌ی ثبت تا وقتی
 *      پیش‌نمایش گرفته نشده یا ورودی عوض شده، غیرفعال است.
 *   ۳) جمله‌ی «لغو ۱۱» از تنظیمات می‌آید؛ اگر عوضش کنید، همین‌جا هم عوض
 *      می‌شود. متن پیش‌نمایش، متنِ نهاییِ واقعی است (با همان جمله).
 */
function CampaignTab({
  act,
  busy
}: {
  act: (fn: () => Promise<any>, message?: string) => Promise<any>
  busy: boolean
}) {
  const dangerOpen = usePanelOpen(PANEL_KEYS.smsDanger)
  /**
   * ⚠️ جمله‌ی لغو **از سرور** خوانده می‌شود، نه از حالت تب «تنظیمات»: آن حالت
   * فقط وقتی آن تب باز باشد تازه می‌شود، پس ممکن بود اینجا «لغو ۱۱» نشان داده
   * شود در حالی که کاربر جمله‌اش را عوض کرده و پیام با جمله‌ی تازه می‌رفت.
   */
  const [note, setNote] = useState(DEFAULT_SMS_OPT_OUT_NOTE)
  const [bank, setBank] = useState<any>(null)
  const [rows, setRows] = useState<any[]>([])
  const [optOuts, setOptOuts] = useState<any[]>([])
  const [form, setForm] = useState({ name: '', body: '', phones: '', includeBank: true })
  const [pv, setPv] = useState<any>(null)
  const [pvKey, setPvKey] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [cancelTarget, setCancelTarget] = useState<any>(null)
  const [detail, setDetail] = useState<any>(null)
  const [newOptOut, setNewOptOut] = useState('')

  const currentKey = JSON.stringify(form)

  const load = useCallback(async () => {
    try {
      const [b, l, o, st] = await Promise.all([
        call(CH.smsCampaignBank),
        call<{ rows: any[]; total: number }>(CH.smsCampaignList, { take: 50 }),
        call<{ rows: any[]; total: number }>(CH.smsOptOutList, { take: 50 }),
        call<{ optOutNote?: string }>(CH.smsSettingsGet)
      ])
      setBank(b)
      setRows(l.rows ?? [])
      setOptOuts(o.rows ?? [])
      setNote(String(st?.optOutNote ?? '').trim() || DEFAULT_SMS_OPT_OUT_NOTE)
    } catch {
      /* خطای بارگذاری، پیام‌ها را از بین نمی‌برد؛ فقط فهرست خالی می‌ماند */
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const preview = () =>
    act(async () => {
      const res = await call(CH.smsCampaignPreview, {
        body: form.body,
        phones: form.phones,
        includeBank: form.includeBank
      })
      setPv(res)
      setPvKey(currentKey)
      return res
    }, 'پیش‌نمایش آماده شد.')

  const create = () =>
    act(async () => {
      const res = await call(CH.smsCampaignCreate, {
        name: form.name,
        body: form.body,
        phones: form.phones,
        includeBank: form.includeBank
      })
      setPv(null)
      setPvKey('')
      setForm({ ...form, name: '', body: '', phones: '' })
      setConfirmOpen(false)
      return res
    }, 'کمپین ثبت شد و پیام‌ها در صف نشستند.')

  const cancelCampaign = (reason: string) =>
    act(async () => {
      const res = await call(CH.smsCampaignCancel, { id: cancelTarget?.id, reason })
      setCancelTarget(null)
      return res
    }, 'کمپین لغو شد.')

  const addOptOut = () =>
    act(async () => {
      const res = await call(CH.smsOptOutAdd, { phone: newOptOut, source: 'PANEL' })
      setNewOptOut('')
      return res
    }, 'شماره در فهرست «لغو ۱۱» ثبت شد.')

  const freshPreview = pv != null && pvKey === currentKey

  return (
    <div className="space-y-3">
      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="font-bold">کمپین تبلیغاتی تازه</div>
          <div className="kbd">
            دفترچه‌ی برنامه: {faDigits(bank?.available ?? 0)} شماره‌ی در دسترس
            {bank?.optOut ? ` · ${faDigits(bank.optOut)} شماره لغو کرده` : ''}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <label className="block">
            <span className="kbd">نام کمپین (برای سابقه)</span>
            <input
              className="inp"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              className="w-4 h-4"
              checked={form.includeBank}
              onChange={(e) => setForm({ ...form, includeBank: e.target.checked })}
            />
            <span>مشتریان دارای شماره در دفترچه‌ی برنامه هم پیام بگیرند</span>
          </label>
        </div>

        <label className="block">
          <span className="kbd">متن پیام</span>
          <textarea
            className="inp h-24"
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="مثلاً: جشنواره‌ی پاییزه‌ی ارکاجین، ۲۰٪ تخفیف روی همه‌ی کالاها تا پایان هفته."
          />
        </label>

        <label className="block">
          <span className="kbd">فهرست شماره‌ها (اختیاری — با کاما، خط تازه یا فاصله جدا کنید)</span>
          <textarea
            dir="ltr"
            className="inp h-20 text-center"
            value={form.phones}
            onChange={(e) => setForm({ ...form, phones: toLatinDigits(e.target.value) })}
            placeholder="09121234567, 09121234568"
          />
        </label>

        <div className="kbd bg-slate-50 border rounded p-2">
          جمله‌ی پایان پیام‌های تبلیغاتی همین حالا: <b>{note}</b> — به‌صورت خودکار به متن اضافه می‌شود و اگر
          خودتان نوشته باشید، دوباره اضافه نمی‌شود. عوض‌کردنش در تب «تنظیمات» است، پس اگر مقررات عوض شد فقط
          همان‌جا را تغییر دهید.
        </div>

        <div className="flex gap-2 flex-wrap">
          <button className="btn" disabled={busy || !form.body.trim()} onClick={() => void preview()}>
            پیش‌نمایش (تعداد و هزینه)
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !freshPreview || !(pv?.sendable > 0)}
            onClick={() => setConfirmOpen(true)}
          >
            ثبت و صف‌کردن کمپین
          </button>
          {!freshPreview && form.body.trim() && (
            <span className="kbd text-amber-700 self-center">اول پیش‌نمایش بگیرید (یا ورودی عوض شده).</span>
          )}
        </div>

        {pv && (
          <div className="bg-slate-50 border rounded p-2 text-sm space-y-1">
            <div>
              مخاطبِ قابل ارسال: <b>{faDigits(pv.sendable)}</b> شماره · منبع: {SMS_AUDIENCE_LABELS[pv.source] ?? pv.source}
            </div>
            <div className="kbd">
              نامعتبر: {faDigits(pv.invalidCount)} · تکراری: {faDigits(pv.duplicateCount)} · «لغو ۱۱»:{' '}
              {faDigits(pv.optOutSkipped)} · بخش هر پیام: {faDigits(pv.segments)} · برآورد:{' '}
              {faDigits(pv.costEstimate)} تومان
            </div>
            {pv.invalidSample?.length > 0 && (
              <div className="kbd" dir="ltr">
                نمونه‌ی نامعتبر: {pv.invalidSample.join(', ')}
              </div>
            )}
            <div className="kbd whitespace-pre-wrap border-t pt-1">{pv.finalBody}</div>
          </div>
        )}
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">کمپین‌های ثبت‌شده</div>
        <div className="overflow-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>نام</th>
                <th>تاریخ</th>
                <th>مخاطب</th>
                <th>وضعیت صف</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center kbd">
                    هنوز کمپینی ثبت نشده است.
                  </td>
                </tr>
              )}
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{faDigits(c.id)}</td>
                  <td>{c.name}</td>
                  <td className="kbd">{jShort(c.createdAt)}</td>
                  <td>{faDigits(c.audienceCount)}</td>
                  <td className="kbd">
                    ارسال‌شده {faDigits(c.sentCount)} · در صف {faDigits(c.pendingCount)} · ناموفق{' '}
                    {faDigits(c.failedCount)} · لغو {faDigits(c.canceledCount)}
                  </td>
                  <td className={c.status === 'CANCELED' ? 'text-slate-500' : 'text-sky-700 font-bold'}>
                    {c.status === 'CANCELED' ? 'لغوشده' : 'در جریان'}
                  </td>
                  <td className="whitespace-nowrap">
                    <button
                      className="btn py-1 ml-1"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const res = await call(CH.smsCampaignDetail, { id: c.id })
                          setDetail(res)
                          return res
                        })
                      }
                    >
                      جزئیات
                    </button>
                    {c.status !== 'CANCELED' && (
                      <button className="btn py-1" disabled={busy} onClick={() => setCancelTarget(c)}>
                        لغو گروهی
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="kbd">
          «لغو گروهی» فقط پیام‌های **ارسال‌نشده** را لغو می‌کند؛ آنچه رفته، در سابقه می‌ماند. لغو ≠ حذف.
        </div>
      </div>

      <div className="bg-white rounded shadow p-3 space-y-2">
        <div className="font-bold">فهرست «لغو ۱۱» — شماره‌هایی که تبلیغ نمی‌خواهند</div>
        <div className="flex gap-2 flex-wrap items-end">
          <label className="block">
            <span className="kbd">افزودن شماره به فهرست لغو</span>
            <input
              dir="ltr"
              className="inp text-center"
              value={newOptOut}
              onChange={(e) => setNewOptOut(toLatinDigits(e.target.value))}
              placeholder="09121234567"
            />
          </label>
          <button className="btn" disabled={busy || !newOptOut.trim()} onClick={() => void addOptOut()}>
            ثبت لغو
          </button>
        </div>
        <div className="overflow-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>شماره</th>
                <th>تاریخ</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {optOuts.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center kbd">
                    هیچ شماره‌ای لغو نکرده است.
                  </td>
                </tr>
              )}
              {optOuts.map((o) => (
                <tr key={o.id}>
                  <td>{faDigits(o.id)}</td>
                  <td dir="ltr">{o.phone}</td>
                  <td className="kbd">{jShort(o.createdAt)}</td>
                  <td>
                    <button
                      className="btn py-1"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const res = await call(CH.smsOptOutRemove, { id: o.id })
                          return res
                        }, 'از فهرست لغو حذف شد.')
                      }
                    >
                      حذف (اشتباه بود)
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* قفل عملیات حساس: ثبت کمپین و لغو گروهی */}
      {!dangerOpen && (confirmOpen || !!cancelTarget) && (
        <div className="fixed inset-0 z-[60] bg-black/40 overflow-auto p-4 flex items-start justify-center">
          <div className="w-full max-w-md my-10">
            <ManagerGate
              panel={PANEL_KEYS.smsDanger}
              title="عملیات حساس کمپین"
              reason="ثبت کمپین برای صدها شماره و لغو گروهی، مستقیم روی هزینه و پیام‌های واقعی اثر می‌گذارد، پس با رمز باز می‌شود."
              inline
            >
              <div className="bg-white rounded shadow p-4 font-bold">قفل باز شد — دیالوگ تایید همین حالا باز می‌شود…</div>
            </ManagerGate>
          </div>
        </div>
      )}

      <Modal open={!!detail} title={`جزئیات کمپین «${detail?.campaign?.name ?? ''}»`} onClose={() => setDetail(null)}>
        <div className="space-y-2">
          <div className="kbd">
            مخاطب: {faDigits(detail?.campaign?.audienceCount ?? 0)} · جمله‌ی لغو:{' '}
            {detail?.campaign?.optOutNote || '—'} · برآورد: {faDigits(detail?.campaign?.costEstimate ?? 0)} تومان
          </div>
          <div className="max-h-96 overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>شماره</th>
                  <th>وضعیت</th>
                  <th>آخرین خطا</th>
                </tr>
              </thead>
              <tbody>
                {(detail?.rows ?? []).map((r: any) => (
                  <tr key={r.id}>
                    <td>{faDigits(r.id)}</td>
                    <td dir="ltr">{r.phoneSnapshot}</td>
                    <td>{SMS_STATUS_LABELS[r.status] ?? r.status}</td>
                    <td className="kbd">{r.lastErrorMessage || r.providerStatus || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmOpen && dangerOpen}
        title="ثبت کمپین تبلیغاتی"
        message={
          <div className="text-sm space-y-1">
            <div>
              برای <b>{faDigits(pv?.sendable ?? 0)}</b> شماره، پیام در صف ثبت می‌شود (هر پیام{' '}
              {faDigits(pv?.segments ?? 1)} بخش).
            </div>
            <div>برآورد هزینه: {faDigits(pv?.costEstimate ?? 0)} تومان — بر اساس قیمت تنظیم‌شده، نه فاکتور واقعی.</div>
            <div className="kbd">
              همین حالا چیزی ارسال نمی‌شود؛ کارگر صف کم‌کم می‌فرستد و هر لحظه می‌توانید لغو گروهی بزنید.
            </div>
          </div>
        }
        confirmLabel="بله، صف کن"
        busy={busy}
        onConfirm={() => void create()}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={!!cancelTarget && dangerOpen}
        title="لغو گروهی کمپین"
        message={
          <div className="text-sm space-y-1">
            <div>
              همه‌ی پیام‌های <b>ارسال‌نشده‌ی</b> کمپین «{cancelTarget?.name}» لغو می‌شوند (
              {faDigits(cancelTarget?.pendingCount ?? 0)} پیام در صف).
            </div>
            <div className="kbd">پیام‌هایی که رفته‌اند دست‌نخورده در سابقه می‌مانند. لغو ≠ حذف.</div>
          </div>
        }
        confirmLabel="بله، لغو کن"
        busy={busy}
        onConfirm={() => void cancelCampaign('لغو گروهی از پنل')}
        onCancel={() => setCancelTarget(null)}
      />
    </div>
  )
}
