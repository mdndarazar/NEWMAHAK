import { Outlet, useNavigate } from 'react-router-dom'
import { useHotkeys } from '../hooks/useHotkeys'
import { ROUTE_BY_SHORTCUT } from '../lib/shortcuts'
import { toJalaliDateTime } from '@shared/jalali'
import { useManagerSession } from '../hooks/useManagerSession'
import { useEffect, useMemo, useState } from 'react'
import { StocktakeReminderChip } from './StocktakeReminderBadge'
import { ShiftSessionChip } from './ShiftSessionModal'
import { DebtReminderBanner } from './DebtReminderBanner'
// نشست ۲۲۲ · فاز ۳ — میزبان پنجره‌ی «با کدام چاپگر چاپ شود؟» (یک بار در ریشه mount می‌شود)
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
  /** جلسه ۱۸ · بندهای ۴ و ۵ — شمارش فیزیکی، مغایرت‌ها و یادآوری انبارگردانی */
  { title: 'انبارگردانی', to: '/stocktake', key: '' },
  { title: 'تغییر قیمت گروهی', to: '/price-adjust', key: '' },
  { title: 'مدیریت اعتبار', to: '/credit-management', key: '' },
  { title: 'موجودی سایت', to: '/woo-sync', key: '' },
  /** ماژول مستقل «پنل پیامکی» — جدا از گزارش‌ها و صندوق */
  { title: 'پنل پیامکی', to: '/sms-panel', key: '' },
  { title: 'عوارض و مالیات', to: '/charges/tax/pos', key: '' },
  { title: 'حق سرویس', to: '/charges/service/pos', key: '' },
  { title: 'تنظیمات', to: '/settings', key: '' }
]

export default function Shell() {
  const nav = useNavigate()
  const { isManager, panels, logout } = useManagerSession()
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // میان‌برهای سراسری محک: F2..F11
  const map = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(ROUTE_BY_SHORTCUT).map(([k, r]) => [
          k,
          () => {
            /**
             * وقتی modal باز است (به‌خصوص دیالوگ چاپ اعتبار با Windows dialog)،
             * جابه‌جایی صفحه با F2/F3/F8/F9/F10/F11 نتیجه‌ی چاپ را روی کامپوننت
             * unmount‌شده گم می‌کند. وضعیت stack لحظه‌ی keydown خوانده می‌شود،
             * نه فقط زمان render Shell، چون باز/بسته‌شدن modal لزوماً Shell را
             * دوباره render نمی‌کند.
             */
            if (isAnyModalOpen()) return
            nav(r)
          }
        ])
      ),
    [nav]
  )
  useHotkeys(map)

  return (
    <div className="h-full flex flex-col">
      <header className="h-11 bg-brand text-white flex items-center gap-2 px-4 shadow">
        <button className="font-bold" onClick={() => nav('/')}>صفحه اصلی</button>
        {/* دسترسی سریع به پنل‌های پرکاربرد (میان‌برهای F هم فعال‌اند) */}
        <nav className="flex items-center gap-1 text-xs">
          {NAV.map((n) => (
            <button
              key={n.to}
              className="px-2 py-1 rounded hover:bg-white/20"
              onClick={() => nav(n.to)}
              title={n.key ? `میان‌بر ${n.key}` : undefined}
            >
              {n.title}
              {n.key ? <span className="opacity-70"> ({n.key})</span> : null}
            </button>
          ))}
        </nav>
        {/**
          * جلسه ۱۸ · بند ۵ — نشان «وقت انبارگردانی فیزیکی رسیده است».
          * هنگام ورود به برنامه دیده می‌شود، چیزی را قفل نمی‌کند و با یک کلیک به
          * فرم ثبت شمارش فیزیکی می‌رود.
          */}
        <StocktakeReminderChip />
        {/**
          * جلسه ۱۹ · بندهای ۳ و ۴ — نشان «نشست جاری صندوق + کارمندش».
          * یک کلیک = فرم تعویض کارمند / ثبت نشست جدید. اگر کارمند نشست تأیید
          * نشده باشد، قرمز می‌شود و پنجره‌ی تعیین کارمند را بالا می‌آورد (هشدار
          * غیرقابل‌نادیده‌گرفتن، بدون قفل کردن هیچ چیزی).
          */}
        <ShiftSessionChip />
        {/* وضعیت «مدیر پشت سیستم است» / «کارمند» + خروج مدیر با یک کلیک */}
        {isManager ? (
          <button
            className="ms-auto text-xs px-2 py-1 rounded bg-white/25 hover:bg-white/40 font-bold whitespace-nowrap"
            onClick={() => {
              logout()
              nav('/')
            }}
            title="با خروج مدیر، پنل کالاها، فاکتور خرید و تنظیمات همان لحظه قفل می‌شوند"
          >
            مدیر پشت سیستم است ✕ خروج مدیر
          </button>
        ) : panels.length ? (
          /* دسترسی محدود: پنل‌هایی که با «رمز دوم اختصاصی» خودشان باز شده‌اند */
          <button
            className="ms-auto text-xs px-2 py-1 rounded bg-white/20 hover:bg-white/30 whitespace-nowrap"
            onClick={() => {
              logout()
              nav('/')
            }}
            title="دسترسی محدود با رمز اختصاصی پنل؛ با خروج، همان لحظه قفل می‌شود"
          >
            دسترسی محدود ({panels.length} پنل) ✕ خروج
          </button>
        ) : (
          <span
            className="ms-auto text-xs px-2 py-1 rounded bg-black/20 whitespace-nowrap"
            title="پنل‌های حساس قفل‌اند و با رمز مدیر (یا رمز دوم اختصاصی همان پنل) باز می‌شوند"
          >
            کارمند پشت سیستم است
          </span>
        )}
        <div className="text-xs opacity-90">{toJalaliDateTime(now)}</div>
      </header>
      <DebtReminderBanner />
      {/* نشست ۲۲۲ · فاز ۳ — همه‌ی نقاط چاپ از یک مسیر مشترک (printFlow) عبور می‌کنند */}
      <PrinterPickerHost />
      <main className="flex-1 overflow-auto p-3">
        <Outlet />
      </main>
      <footer className="h-7 bg-slate-800 text-slate-200 text-[11px] flex items-center gap-4 px-3">
        <span>کاربر: مدیر</span>
        <span className="kbd">F2 فروش · F3 خرید · F8 کالاها · F9 گزارشات · F10 صندوق · F11 تجمیع</span>
        <span className="kbd">
          {isManager
            ? 'وضعیت: مدیر (همه‌ی پنل‌های قفل‌دار باز است)'
            : panels.length
              ? `وضعیت: دسترسی محدود (${panels.length} پنل با رمز اختصاصی باز است)`
              : 'وضعیت: کارمند (پنل‌های موجودی قفل است)'}
        </span>
        <span className="kbd ms-auto">
          ارتفاع ردیف‌های هر جدول را با کشیدن مرز پایین ردیف عوض کنید (با Shift: همه‌ی ردیف‌ها · دوبار کلیک: خودکار)
        </span>
      </footer>
    </div>
  )
}
