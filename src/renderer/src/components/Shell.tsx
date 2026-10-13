import { Outlet, useNavigate } from 'react-router-dom'
import { useHotkeys } from '../hooks/useHotkeys'
import { ROUTE_BY_SHORTCUT } from '../lib/shortcuts'
import { toJalaliDateTime } from '@shared/jalali'
import { useManagerSession } from '../hooks/useManagerSession'
import { useEffect, useMemo, useState } from 'react'
import { StocktakeReminderChip } from './StocktakeReminderBadge'
import { ShiftSessionChip } from './ShiftSessionModal'
import { CustodyChip } from './CustodyChip'
import { DebtReminderBanner } from './DebtReminderBanner'
import PrinterPickerHost from './PrinterPickerModal'
import { isAnyModalOpen } from './Modal'

/** پنل‌های پرکاربرد در نوار بالا (همان ترتیب کار روزانه‌ی فروشگاه). */
const NAV = [
  { title: 'پنل فروش', to: '/pos', key: 'F2' },
  { title: 'فاکتور خرید', to: '/purchase', key: 'F3' },
  { title: 'فاکتور فروش عمده', to: '/sales-invoice', key: '' },
  { title: 'کالاها', to: '/products', key: 'F8' },
  { title: 'گزارشات فروش', to: '/sales-reports', key: 'F9' },
  { title: 'گزارش مدیریت', to: '/management-reports', key: '' },
  { title: 'برگشت از فروش', to: '/sales-return', key: '' },
  { title: 'بستن صندوق', to: '/cash-close', key: 'F10' },
  { title: 'تجمیع و انتقال', to: '/consolidation', key: 'F11' },
  { title: 'انبار مرکزی', to: '/secondary-stock', key: '' },
  { title: 'انبارگردانی', to: '/stocktake', key: '' },
  { title: 'تغییر قیمت گروهی', to: '/price-adjust', key: '' },
  { title: 'مدیریت اعتبار', to: '/credit-management', key: '' },
  { title: 'موجودی سایت', to: '/woo-sync', key: '' },
  { title: 'پنل پیامکی', to: '/sms-panel', key: '' },
  { title: 'عوارض و مالیات', to: '/charges/tax/pos', key: '' },
  { title: 'حق سرویس', to: '/charges/service/pos', key: '' },
  { title: 'تنظیمات', to: '/settings', key: '' }
]

export default function Shell() {
  const nav = useNavigate()
  const { isManager, panels, ready, securityError, isLoggingOut, logout } = useManagerSession()
  const [now, setNow] = useState(new Date())
  const [exitError, setExitError] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const exitCurrentAccess = async () => {
    if (isLoggingOut) return
    setExitError(null)
    try {
      await logout()
      nav('/')
    } catch (error: any) {
      setExitError(error?.message || 'خروج مدیر قابل تأیید نیست؛ دوباره تلاش کنید.')
    }
  }

  // میان‌برهای سراسری محک: F2..F11
  const map = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(ROUTE_BY_SHORTCUT).map(([key, route]) => [
          key,
          () => {
            if (isAnyModalOpen()) return
            nav(route)
          }
        ])
      ),
    [nav]
  )
  useHotkeys(map)

  const accessStatus = securityError ? (
    <span className="text-[11px] px-2 py-1 rounded bg-amber-500 text-slate-950 font-bold whitespace-nowrap" title={securityError}>
      بررسی وضعیت دسترسی
    </span>
  ) : !ready ? (
    <span className="text-[11px] px-2 py-1 rounded bg-black/20 whitespace-nowrap">در حال بررسی دسترسی…</span>
  ) : isManager ? (
    <>
      <span className="text-xs px-2 py-1 rounded bg-white/15 font-bold whitespace-nowrap">مدیر پشت سیستم است</span>
      <button
        className="text-xs px-2 py-1 rounded bg-white/30 hover:bg-white/45 font-bold whitespace-nowrap disabled:opacity-60"
        onClick={() => void exitCurrentAccess()}
        disabled={isLoggingOut}
        title="با خروج مدیر، تمام پنل‌های مدیریتی و دسترسی‌های محدود همین پنجره قفل می‌شوند؛ صندوق و فروش جاری دست‌نخورده می‌مانند."
      >
        {isLoggingOut ? 'در حال خروج…' : 'خروج مدیر'}
      </button>
    </>
  ) : panels.length ? (
    <>
      <span className="text-xs px-2 py-1 rounded bg-white/15 whitespace-nowrap" title={panels.join('، ')}>
        دسترسی محدود ({panels.length} پنل)
      </span>
      <button
        className="text-xs px-2 py-1 rounded bg-white/25 hover:bg-white/35 whitespace-nowrap disabled:opacity-60"
        onClick={() => void exitCurrentAccess()}
        disabled={isLoggingOut}
        title="خروج از همه دسترسی‌های محدود همین پنجره"
      >
        {isLoggingOut ? 'در حال خروج…' : 'خروج'}
      </button>
    </>
  ) : (
    <span
      className="text-xs px-2 py-1 rounded bg-black/20 whitespace-nowrap"
      title="پنل‌های حساس قفل‌اند و با رمز مدیر یا رمز دوم اختصاصی همان پنل باز می‌شوند"
    >
      کارمند پشت سیستم است
    </span>
  )

  return (
    <div className="h-full flex flex-col">
      <header className="h-11 min-h-11 bg-brand text-white flex items-center gap-2 px-3 shadow overflow-hidden" dir="rtl">
        {/* عملیات پایه هرگز فشرده یا پنهان نمی‌شود. */}
        <button className="font-bold shrink-0 whitespace-nowrap" onClick={() => nav('/')}>صفحه اصلی</button>

        {/* فقط این بخش اجازه اسکرول افقی دارد؛ گروه وضعیت و خروج همیشه ثابت می‌ماند. */}
        <div className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden flex items-center gap-2 [scrollbar-width:thin]">
          <nav className="flex items-center gap-1 text-xs whitespace-nowrap shrink-0">
            {NAV.map((item) => (
              <button
                key={item.to}
                className="px-2 py-1 rounded hover:bg-white/20 whitespace-nowrap"
                onClick={() => nav(item.to)}
                title={item.key ? `میان‌بر ${item.key}` : undefined}
              >
                {item.title}
                {item.key ? <span className="opacity-70"> ({item.key})</span> : null}
              </button>
            ))}
          </nav>
          <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
            <StocktakeReminderChip />
            <ShiftSessionChip />
            <CustodyChip showSetup={false} />
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1 border-s border-white/20 ps-2" aria-live="polite">
          {accessStatus}
          <span className="text-[11px] opacity-90 whitespace-nowrap hidden 2xl:inline">{toJalaliDateTime(now)}</span>
        </div>
      </header>
      {exitError ? <div className="bg-amber-100 text-amber-950 border-b border-amber-300 px-3 py-1 text-xs">{exitError}</div> : null}
      <DebtReminderBanner />
      <PrinterPickerHost />
      <main className="flex-1 overflow-auto p-3">
        <Outlet />
      </main>
      <footer className="h-7 bg-slate-800 text-slate-200 text-[11px] flex items-center gap-4 px-3">
        <span>{isManager ? 'کاربر: مدیر' : panels.length ? 'کاربر: دسترسی محدود' : 'کاربر: کارمند'}</span>
        <span className="kbd">F2 فروش · F3 خرید · F8 کالاها · F9 گزارشات · F10 صندوق · F11 تجمیع</span>
        <span className="kbd">
          {securityError
            ? 'وضعیت: دسترسی حساس تا بررسی Main قفل است'
            : isManager
              ? 'وضعیت: مدیر (همه‌ی پنل‌های قفل‌دار باز است)'
              : panels.length
                ? `وضعیت: دسترسی محدود (${panels.length} پنل با رمز اختصاصی باز است)`
                : 'وضعیت: کارمند (پنل‌های حساس قفل است)'}
        </span>
        <span className="kbd ms-auto">
          ارتفاع ردیف‌های هر جدول را با کشیدن مرز پایین ردیف عوض کنید (با Shift: همه‌ی ردیف‌ها · دوبار کلیک: خودکار)
        </span>
      </footer>
    </div>
  )
}
