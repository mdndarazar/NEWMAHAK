import { useRef, type ReactNode } from 'react'
import { useTopmostModalKey } from './Modal'

/**
 * دیالوگ «هشدار + تایید» عمومی پروژه.
 *
 * اصل طراحی این نرم‌افزار (تک‌کاربره و شخصی):
 * هیچ عملیاتی بی‌صدا رد نمی‌شود و هیچ دکمه‌ای بی‌دلیل قفل نمی‌ماند. جای
 * throw کردن یا disable کردن، پیام فارسیِ روشن نشان می‌دهیم که «چرا معمولاً
 * توصیه نمی‌شود و چه پیامدی دارد»، و اگر کاربر تایید کرد، عملیات تحت هر
 * شرایطی انجام می‌شود.
 *
 * فقط محدودیت‌های ساختاری (اتمیک بودن تراکنش، ثبت StockMovement برای ردیابی)
 * باقی می‌مانند، چون به سلامت داده کمک می‌کنند نه محدود کردن کاربر.
 */
export default function ConfirmDialog({
  open,
  title = 'تایید عملیات',
  message,
  confirmLabel = 'بله، انجام بده',
  cancelLabel = 'انصراف',
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean
  title?: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)

  useTopmostModalKey(open, (e) => {
    if (e.key !== 'Escape' && e.key !== 'Enter') return
    if (e.key === 'Enter') {
      const active = document.activeElement
      // اگر کاربر با Tab روی «انصراف» یا هر دکمه‌ی دیگری است، Enter باید همان
      // دکمه را بزند؛ handler سراسری نباید آن را به «بله» تبدیل کند.
      if (active instanceof HTMLButtonElement && active !== confirmButtonRef.current) return
      if (active instanceof HTMLTextAreaElement) return
    }
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    if (e.key === 'Escape') onCancel()
    /**
     * 🔴 `!busy` حیاتی است: دیالوگ تا پایان کار باز می‌ماند و نگه‌داشتن Enter
     * (یا چند بار زدنش) چند بار `onConfirm` را صدا می‌زد — باگ اول بازبینی سوم:
     * دو کمپین یکسان ⇒ هر مشتری دو تبلیغ.
     */
    if (e.key === 'Enter' && !busy) onConfirm()
  })

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 overflow-auto p-4 flex items-start justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div dir="rtl" className="w-full max-w-md bg-white rounded shadow-lg my-10">
        <div className="flex items-center justify-between px-4 h-11 bg-amber-500 text-white rounded-t">
          <div className="font-bold">{title}</div>
          <button className="text-white/90 hover:text-white text-lg leading-none" onClick={onCancel} title="انصراف (Esc)">
            ✕
          </button>
        </div>
        <div className="p-4 space-y-2 leading-7">{message}</div>
        <div className="px-4 py-3 border-t bg-slate-50 rounded-b flex gap-2 justify-end">
          <button className="btn" onClick={onCancel} disabled={busy}>
            {cancelLabel} <span className="keycap">Esc</span>
          </button>
          <button ref={confirmButtonRef} autoFocus className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'در حال انجام…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
