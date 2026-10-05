import { useNavigate } from 'react-router-dom'
import StocktakeReminderBanner from '../components/StocktakeReminderBadge'

const TILES = [
  { title: 'پنل فروش', key: 'F2', to: '/pos', color: 'bg-sky-400' },
  { title: 'گزارشات فروش', key: 'F9', to: '/sales-reports', color: 'bg-emerald-400' },
  { title: 'گزارش مدیریت', key: '', to: '/management-reports', color: 'bg-teal-500' },
  { title: 'کالاها', key: 'F8', to: '/products', color: 'bg-amber-500' },
  { title: 'فاکتور خرید', key: 'F3', to: '/purchase', color: 'bg-orange-500' },
  { title: 'فاکتور فروش', key: '', to: '/sales-invoice', color: 'bg-indigo-400' },
  { title: 'بستن صندوق', key: 'F10', to: '/cash-close', color: 'bg-slate-500' },
  { title: 'تجمیع و انتقال', key: 'F11', to: '/consolidation', color: 'bg-lime-500' },
  { title: 'برگشت از فروش', key: '', to: '/sales-return', color: 'bg-rose-400' },
  /** جلسه ۱۸ · بندهای ۴ و ۵ — انبارگردانی (شمارش فیزیکی و مغایرت‌ها) */
  { title: 'انبارگردانی', key: '', to: '/stocktake', color: 'bg-cyan-600' },
  /** ماژول مستقل «پنل پیامکی» (صف ارسال، قالب‌ها، سرویس‌دهنده) */
  { title: 'پنل پیامکی', key: '', to: '/sms-panel', color: 'bg-violet-500' },
  { title: 'تنظیمات', key: '', to: '/settings', color: 'bg-teal-600' }
]

export default function Dashboard() {
  const nav = useNavigate()
  return (
    <div className="space-y-3">
      {/* جلسه ۱۸ · بند ۵ — یادآوری انبارگردانی، همان لحظه‌ی ورود به برنامه */}
      <StocktakeReminderBanner />
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
        {TILES.map((t) => (
          <button
            key={t.to}
            onClick={() => nav(t.to)}
            className={`${t.color} text-white h-28 rounded-lg shadow relative flex items-end p-3 hover:brightness-105`}
          >
            {t.key && <span className="absolute top-2 right-2 text-[10px] bg-black/25 px-1.5 py-0.5 rounded">{t.key}</span>}
            <span className="font-bold">{t.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
