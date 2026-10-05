import { useCallback, useEffect, useState } from 'react'
import { call, CH } from '../lib/api'

interface DebtReminderDue {
  show: boolean
  dismissed: boolean
  message: string
}

/**
 * هشدار قرمز بالای صفحه: نسیه یا چک سررسیدشدهٔ پرداخت‌نشده.
 * قفل نمی‌کند. دکمهٔ بستن فقط همین شیفت را می‌خواباند.
 */
export function DebtReminderBanner() {
  const [due, setDue] = useState<DebtReminderDue | null>(null)

  const reload = useCallback(() => {
    call<DebtReminderDue>(CH.debtReminderDue)
      .then(setDue)
      .catch(() => setDue(null))
  }, [])

  useEffect(() => {
    reload()
    const t = setInterval(reload, 60_000)
    return () => clearInterval(t)
  }, [reload])

  const close = async () => {
    try {
      const next = await call<DebtReminderDue>(CH.debtReminderDismiss, {})
      setDue(next)
    } catch {
      setDue((d) => (d ? { ...d, show: false, dismissed: true } : d))
    }
  }

  if (!due?.show || !due.message) return null
  return (
    <div className="bg-rose-700 text-white px-3 py-2 flex items-center gap-3 text-sm font-bold shadow">
      <span className="flex-1 leading-6">{due.message}</span>
      <button
        type="button"
        className="shrink-0 px-3 py-1 rounded bg-white text-rose-800 hover:bg-rose-100"
        onClick={() => void close()}
      >
        بستن
      </button>
    </div>
  )
}
