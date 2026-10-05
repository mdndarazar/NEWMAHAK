import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { call, CH } from '../lib/api'
import { faDigits } from '@shared/jalali'
import type { StocktakeSchedule } from '@shared/receipt'
import PasswordField from './PasswordField'

/**
 * ===========================================================================
 * جلسه ۱۸ · بند ۵ (لایه‌ی UI) — «یادآوری انبارگردانی فیزیکی».
 *
 * `StocktakeReminderService` و کانال `stocktake:due` از جلسه ۱۷ آماده بودند و
 * هیچ‌جا دیده نمی‌شدند. این کامپوننت همان نشان دیدنی است و در دو جا می‌نشیند:
 *   • نوار بالای برنامه (`Shell`) — «هنگام ورود به برنامه»
 *   • صفحه‌ی اصلی (`Dashboard`) و بالای ماژول انبارگردانی — کادر کامل
 *
 * سه قاعده‌ی عمدی:
 *   ۱) **مزاحم نیست و چیزی را قفل نمی‌کند.** فقط یک نشان است؛ هیچ پنجره‌ی
 *      اجباری‌ای باز نمی‌شود و هیچ عملیاتی مسدود نمی‌گردد.
 *   ۲) مستقیم به فرم ثبت شمارش فیزیکی (بند ۴-الف) لینک می‌شود، پس مدیر همان
 *      لحظه می‌تواند شمارش را وارد کند.
 *   ۳) «امروز دیدم» فقط یادآوری *همین امروز* را می‌خواباند و تنظیمات را عوض
 *      نمی‌کند (`stocktake:dismiss`).
 * ===========================================================================
 */

export interface StocktakeDue {
  enabled: boolean
  today: string
  schedule: StocktakeSchedule
  lastCountJalali: string | null
  lastCountId: number | null
  due: boolean
  reasons: string[]
  dismissed: boolean
}

/** خواندن وضعیت «امروز موعد انبارگردانی است؟» — خطا بی‌صدا نادیده می‌شود. */
export function useStocktakeDue(): {
  due: StocktakeDue | null
  reload: () => void
  dismiss: (panelPassword: string) => Promise<void>
} {
  const [due, setDue] = useState<StocktakeDue | null>(null)

  const reload = useCallback(() => {
    call<StocktakeDue>(CH.stocktakeDue)
      .then(setDue)
      .catch(() => setDue(null))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // نشست ۱۶۶ (S166-D1/D3) — «امروز دیدم» رمز پنل انبارگردانی می‌خواهد (گیت اصلی در main)؛
  // خطای فارسی سرور به صدازننده برمی‌گردد تا زیر کادر رمز نشان داده شود.
  const dismiss = useCallback(
    async (panelPassword: string) => {
      try {
        await call(CH.stocktakeDismiss, { panelPassword })
      } finally {
        reload()
      }
    },
    [reload]
  )

  return { due, reload, dismiss }
}

/** نشان کوچک نوار بالا (فقط وقتی موعد رسیده و «امروز دیدم» نخورده باشد). */
export function StocktakeReminderChip() {
  const nav = useNavigate()
  const { due } = useStocktakeDue()
  if (!due?.due || due.dismissed) return null
  return (
    <button
      className="text-xs px-2 py-1 rounded bg-amber-300 text-amber-950 font-bold whitespace-nowrap hover:bg-amber-200"
      onClick={() => nav('/stocktake')}
      title={due.reasons.join(' · ')}
    >
      ⚠ وقت انبارگردانی فیزیکی رسیده است
    </button>
  )
}

/**
 * کادر کامل یادآوری. `compact` برای صفحه‌ی اصلی، و حالت کامل برای بالای خودِ
 * ماژول انبارگردانی (که آن‌جا دکمه‌ی «رفتن به فرم» لازم نیست چون همان صفحه است).
 */
export default function StocktakeReminderBanner({
  showGoToForm = true,
  onGoToForm
}: {
  showGoToForm?: boolean
  onGoToForm?: () => void
}) {
  const nav = useNavigate()
  const { due, dismiss } = useStocktakeDue()
  const [askPw, setAskPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!due?.due || due.dismissed) return null

  const confirmDismiss = async () => {
    setBusy(true)
    setPwErr('')
    try {
      await dismiss(pw)
      setAskPw(false)
    } catch (e: any) {
      setPwErr(String(e?.message ?? e ?? 'خواباندن یادآوری انجام نشد.'))
    } finally {
      setPw('')
      setBusy(false)
    }
  }

  return (
    <div className="rounded border-2 border-amber-500 bg-amber-50 p-3 space-y-2">
      <div className="font-bold text-amber-900">وقت انبارگردانی فیزیکی رسیده است</div>
      <ul className="leading-7">
        {due.reasons.map((r, i) => (
          <li key={i}>• {faDigits(r)}</li>
        ))}
      </ul>
      <div className="kbd leading-6">
        آخرین شمارش ثبت‌شده:{' '}
        {due.lastCountJalali ? <b>{faDigits(due.lastCountJalali)}</b> : <b>هیچ شمارشی ثبت نشده است</b>} · این یادآوری
        هیچ چیزی را قفل نمی‌کند و فقط یک تذکر است.
      </div>
      <div className="flex gap-2 flex-wrap">
        {showGoToForm && (
          <button
            className="btn btn-primary"
            onClick={() => (onGoToForm ? onGoToForm() : nav('/stocktake'))}
          >
            ثبت شمارش فیزیکی
          </button>
        )}
        {!askPw && (
          <button className="btn" onClick={() => setAskPw(true)} title="فقط یادآوری امروز خوابانده می‌شود (رمز مدیر یا رمز انبارگردانی)">
            امروز دیدم
          </button>
        )}
      </div>
      {askPw && (
        <div className="flex gap-2 flex-wrap items-center">
          <PasswordField
            placeholder="رمز مدیر / رمز انبارگردانی"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !busy && void confirmDismiss()}
            autoFocus
          />
          <button className="btn" disabled={busy} onClick={() => void confirmDismiss()}>
            تأیید «امروز دیدم»
          </button>
          <button className="btn" disabled={busy} onClick={() => { setAskPw(false); setPw(''); setPwErr('') }}>
            انصراف
          </button>
          {pwErr && <div className="text-red-700 w-full">{pwErr}</div>}
        </div>
      )}
    </div>
  )
}
