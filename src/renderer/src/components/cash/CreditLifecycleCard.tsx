import { money } from '@shared/jalali'
import type { FinancialSourceKey, SaleStoreCreditBlock } from '@shared/types'

/**
 * کارت فقط‌خواندنیِ گردش اعتبار خرید.
 *
 * هیچ مبلغی در renderer جمع یا طبقه‌بندی نمی‌شود: مقدارها همان snapshot رسمی
 * `accounting.storeCredits` هستند و هر دکمه فقط کلیدِ predicate سمت main را به
 * Financial Inspector می‌فرستد. بنابراین با گزارش/export/امنیت کد اعتبار واگرا
 * نمی‌شود.
 */
export interface CreditLifecycleCardProps {
  credit: SaleStoreCreditBlock | null | undefined
  onInspect: (key: FinancialSourceKey) => void
}

type LifecycleRow = {
  key: FinancialSourceKey
  label: string
  hint: string
  value: number | undefined
  tone: 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'
}

const TONE: Record<LifecycleRow['tone'], string> = {
  emerald: 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100',
  sky: 'border-sky-200 bg-sky-50 hover:bg-sky-100',
  amber: 'border-amber-200 bg-amber-50 hover:bg-amber-100',
  rose: 'border-rose-200 bg-rose-50 hover:bg-rose-100',
  slate: 'border-slate-200 bg-slate-50 hover:bg-slate-100'
}

export default function CreditLifecycleCard({ credit, onInspect }: CreditLifecycleCardProps) {
  if (!credit) return null

  const issueRows: LifecycleRow[] = [
    {
      key: 'storeCreditIssuedReturn',
      label: 'صادرشده از برگشت',
      hint: 'صدورهایی که خاستگاهشان برگشت فروش است.',
      value: credit.issuedLifecycleReturn,
      tone: 'emerald'
    },
    {
      key: 'storeCreditIssuedExchange',
      label: 'صادرشده از تعویض',
      hint: 'صدورهایی که به سند تعویض متصل‌اند.',
      value: credit.issuedLifecycleExchange,
      tone: 'emerald'
    },
    {
      key: 'storeCreditIssuedManual',
      label: 'دستی / مدیریتی',
      hint: 'صدور دستیِ ثبت‌شده با کاربر مجاز.',
      value: credit.issuedLifecycleManual,
      tone: 'sky'
    },
    {
      key: 'storeCreditIssuedOverpay',
      label: 'از اضافه‌دریافت',
      hint: 'اعتبارهای تازهٔ ناشی از اضافه‌دریافت؛ باقی‌مانده جداست.',
      value: credit.issuedLifecycleOverpay,
      tone: 'sky'
    },
    {
      key: 'storeCreditIssuedRemainder',
      label: 'باقی‌ماندهٔ مصرف جزئی',
      hint: 'اعتبار تازه برای ماندهٔ اعتبار قبلی.',
      value: credit.issuedLifecycleRemainder,
      tone: 'amber'
    },
    {
      key: 'storeCreditIssuedOther',
      label: 'خاستگاه نامشخص',
      hint: 'دادهٔ تاریخی که خاستگاهش در یکی از سبدهای دیگر ثبت نشده است.',
      value: credit.issuedLifecycleOther,
      tone: 'slate'
    }
  ]

  const stateRows: LifecycleRow[] = [
    {
      key: 'storeCreditUsed',
      label: 'مصرف‌شده',
      hint: 'دفتر مصرف اعتبار در بازه؛ هر ردیف یک مصرف واقعی است.',
      value: credit.used,
      tone: 'sky'
    },
    {
      key: 'storeCreditExpiredInRange',
      label: 'منقضی‌شده در بازه',
      hint: 'ماندهٔ استفاده‌نشدهٔ اعتبارهایی که تاریخ انقضایشان داخل بازهٔ انتخاب‌شده است (دو سر بازه هم شامل‌اند).',
      value: credit.expiredInRange ?? credit.expired,
      tone: 'amber'
    },
    {
      key: 'storeCreditCanceled',
      label: 'لغوشده',
      hint: 'مبلغ اولیهٔ اعتبارهای لغوشده تا پایان بازه.',
      value: credit.canceled,
      tone: 'rose'
    }
  ]

  const row = (item: LifecycleRow) => (
    <button
      key={item.key}
      type="button"
      className={`rounded border p-2 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${TONE[item.tone]}`}
      onClick={() => onInspect(item.key)}
      title={`${item.hint} برای دیدن سابقه و سندهای سازنده کلیک کنید.`}
    >
      <span className="block text-xs font-bold text-slate-800">{item.label}</span>
      <b className="mt-1 block text-base text-slate-950" dir="ltr">
        {money(item.value ?? 0)} <span className="text-[11px] font-normal">ریال</span>
      </b>
      <span className="mt-1 block text-[11px] leading-4 text-slate-600">نمایش سابقه و منشأ</span>
    </button>
  )

  return (
    <section className="mt-3 overflow-hidden rounded border-2 border-violet-300 bg-violet-50/50" aria-label="گردش اعتبار خرید">
      <div className="flex flex-wrap items-center gap-2 border-b border-violet-200 bg-violet-100/80 p-2">
        <div className="flex-1">
          <h3 className="font-bold text-violet-950">گردش اعتبار خرید</h3>
          <p className="text-xs leading-5 text-violet-950/80">هر مبلغ قابل بازرسی است؛ فهرست و شناسنامهٔ سند، کد اعتبار را نمایش نمی‌دهند.</p>
        </div>
        <button
          type="button"
          className="rounded border border-violet-400 bg-white px-3 py-1.5 text-right shadow-sm transition-colors hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          onClick={() => onInspect('storeCreditIssuedAll')}
          title="نمایش همهٔ اعتبارهای صادرشده در بازه و سندهای سازنده"
        >
          <span className="block text-xs font-bold text-violet-950">کل صادرشده</span>
          <b className="block text-base text-slate-950" dir="ltr">{money(credit.issued)} <span className="text-[11px] font-normal">ریال</span></b>
        </button>
      </div>

      <div className="p-2">
        <h4 className="mb-1 text-xs font-bold text-slate-700">خاستگاه صدور — سبدهای متقابلاً مجزا</h4>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{issueRows.map(row)}</div>
      </div>
      <div className="border-t border-violet-200 p-2">
        <h4 className="mb-1 text-xs font-bold text-slate-700">وضعیت و تسویه</h4>
        <div className="grid gap-2 sm:grid-cols-3">{stateRows.map(row)}</div>
      </div>
    </section>
  )
}
