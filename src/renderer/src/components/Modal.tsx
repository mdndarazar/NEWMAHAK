import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Stack سراسری modalها: چون همه‌ی modalها روی window و در capture به کلیدها گوش
 * می‌دهند، صرفاً stopPropagation کافی نیست. فقط آخرین دیالوگ بازشده حق واکنش به
 * Esc/Enter را دارد تا picker یا ConfirmDialog، modal زیرین را اشتباهی نبندد.
 */
const modalStack: symbol[] = []

/** آیا هر نوع modal/confirm روی صفحه باز است؟ برای قفل میان‌برهای سراسری Shell. */
export function isAnyModalOpen(): boolean {
  return modalStack.length > 0
}

/** ثبت یک پنجره در stack مشترک و اجرای handler فقط برای topmost. */
export function useTopmostModalKey(open: boolean, handler: (e: KeyboardEvent) => void): void {
  const modalId = useRef(Symbol('modal'))
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!open) return
    const id = modalId.current
    modalStack.push(id)
    const removeFromStack = () => {
      const idx = modalStack.lastIndexOf(id)
      if (idx >= 0) modalStack.splice(idx, 1)
    }
    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return
      handlerRef.current(e)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      removeFromStack()
    }
  }, [open])
}

/**
 * modal پایه‌ی پروژه. RTL، بستن با Esc یا کلیک روی بک‌دراپ.
 * سبک ظاهری عیناً از Pos.tsx/Products.tsx گرفته شده (bg-white rounded shadow + رنگ brand).
 * توجه: تا وقتی modal باز است، صفحه‌ی میزبان باید hotkeyهای خودش را با
 * enabled=false غیرفعال کند تا F4..F7 دوباره اجرا نشوند.
 */
export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 'max-w-4xl',
  zIndexClass = 'z-50'
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
  /** بعضی modalهای سراسری (مثل انتخاب چاپگر) باید روی modalهای صفحه بنشینند. */
  zIndexClass?: string
}) {
  useTopmostModalKey(open, (e) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    e.stopImmediatePropagation()
    onClose()
  })

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} bg-black/40 overflow-auto p-4 flex items-start justify-center`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div dir="rtl" className={`w-full ${width} bg-white rounded shadow-lg my-4`}>
        <div className="flex items-center justify-between px-4 h-11 bg-brand text-white rounded-t">
          <div className="font-bold">{title}</div>
          <button className="text-white/90 hover:text-white text-lg leading-none" onClick={onClose} title="بستن (Esc)">
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3">{children}</div>
        {footer && <div className="px-4 py-3 border-t bg-slate-50 rounded-b flex gap-2 justify-end">{footer}</div>}
      </div>
    </div>
  )
}
