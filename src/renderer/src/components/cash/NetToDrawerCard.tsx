import React, { useEffect, useRef } from 'react'
import { faDigits, money } from '@shared/jalali'
import type { NetToDrawerResult } from '@shared/cashExplainer'

export interface NetToDrawerCardProps {
  open: boolean
  onClose: () => void
  result: NetToDrawerResult
  summaryNet?: number
  isBalanced?: boolean
  onOpenBridgeDiag?: () => void
}

/** کنترل محلی؛ عمداً `.btn` نیست تا رنگ سفید پایهٔ `.btn` رنگ هشدار را نپوشاند. */
const DIALOG_BUTTON =
  'appearance-none border-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900'

export const NetToDrawerCard: React.FC<NetToDrawerCardProps> = ({
  open,
  onClose,
  result,
  summaryNet,
  isBalanced = true,
  onOpenBridgeDiag
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  /** مودال قبلی فقط Esc داشت. اکنون focus اولیه، Tab trap و بازگرداندن focus هم دارد. */
  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const animationFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus())

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable?.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      window.removeEventListener('keydown', onKeyDown)
      if (opener && dialogRef.current?.contains(document.activeElement)) opener.focus()
    }
  }, [open, onClose])

  if (!open) return null

  const { start, lines, unexplained, end, official, gap, omittedZeroCount, alarm, alarmMessage } = result
  const isPerfectMatch = alarm === null && gap === 0 && unexplained === 0 && isBalanced
  const bridgeIsUnbalanced = alarm === 'BRIDGE_UNBALANCED'
  const compositionDrift = alarm === 'COMPOSITION_DRIFT'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
        aria-labelledby="net-to-drawer-title"
        dir="rtl"
      >
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl" aria-hidden="true">🧮</span>
            <div>
              <h3 id="net-to-drawer-title" className="font-black text-base">زنجیرهٔ توضیحی از خالص فروش تا کنترل گزارش</h3>
              <p className="text-xs text-slate-300 font-light mt-0.5">
                این زنجیره توضیح حسابداری است؛ با شمارش فیزیکی کشو یا گزارش پایان‌روز دستگاه جایگزین نمی‌شود.
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className={`${DIALOG_BUTTON} text-slate-300 hover:text-white text-lg font-bold p-1 rounded hover:bg-slate-800 transition-colors`}
            title="بستن (Esc)"
            aria-label="بستن زنجیرهٔ توضیحی"
          >
            ✕
          </button>
        </div>

        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-3">
          <div className="text-xs text-slate-500 font-medium pb-1 border-b border-slate-100">
            گزارش زیر نشان می‌دهد چه رویدادهایی پول را در دخل نگه داشته یا بدون ورود نقد کالا را خارج کرده‌اند.
          </div>

          <div className="space-y-1.5 font-mono text-sm">
            <div className="flex items-center justify-between p-2.5 bg-slate-100 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 font-sans font-bold text-slate-800">
                <span className="w-5 text-center text-slate-400 text-xs">۱</span>
                <span>خالص ارزش کالاهای فروخته‌شده (خالص تعهدی)</span>
              </div>
              <div className="font-bold text-slate-900 text-base" dir="ltr">
                + {money(start)} <span className="text-xs font-normal text-slate-500 font-sans">ریال</span>
              </div>
            </div>

            {lines.map((line, idx) => {
              const isPlus = line.sign === 1
              return (
                <div
                  key={line.key}
                  className={`flex items-center justify-between p-2.5 rounded-lg border transition-colors ${
                    isPlus ? 'bg-emerald-50/70 border-emerald-200/80 text-emerald-950' : 'bg-rose-50/70 border-rose-200/80 text-rose-950'
                  }`}
                >
                  <div className="flex items-center gap-2 font-sans">
                    <span className="w-5 text-center text-slate-400 text-xs font-mono">{idx + 2}</span>
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-black ${
                        isPlus ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                      }`}
                    >
                      {isPlus ? '+' : '−'}
                    </span>
                    <span className="font-medium text-slate-800 text-xs md:text-sm">{line.label}</span>
                  </div>
                  <div className={`font-bold text-sm md:text-base ${isPlus ? 'text-emerald-900' : 'text-rose-900'}`} dir="ltr">
                    {isPlus ? '+' : '−'} {money(line.amount)}{' '}
                    <span className="text-xs font-normal text-slate-500 font-sans">ریال</span>
                  </div>
                </div>
              )
            })}

            <div className="pt-2 border-t-2 border-slate-400">
              <div className="flex items-center justify-between p-3 bg-sky-100 rounded-lg border-2 border-sky-300">
                <div className="flex items-center gap-2 font-sans font-black text-sky-950">
                  <span className="text-base" aria-hidden="true">🟰</span>
                  <span className="text-sm md:text-base">نتیجهٔ زنجیرهٔ توضیحی</span>
                </div>
                <div className="font-black text-sky-950 text-lg md:text-xl" dir="ltr">
                  = {money(end)} <span className="text-xs font-normal text-slate-600 font-sans">ریال</span>
                </div>
              </div>
            </div>
          </div>

          {isPerfectMatch && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-center justify-between text-emerald-900 text-xs font-bold">
              <div className="flex items-center gap-2">
                <span className="text-base text-emerald-600" aria-hidden="true">✓</span>
                <span>پل حسابداری تراز است و زنجیرهٔ توضیحی با عدد مرجع فعلی گزارش هم‌خوان است.</span>
              </div>
              <span className="bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded font-mono">اختلاف: ۰</span>
            </div>
          )}

          {bridgeIsUnbalanced && (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-900 text-xs space-y-2" role="alert">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-base text-rose-600" aria-hidden="true">⚠️</span>
                  <span>{alarmMessage ?? `پل تطبیق بسته نیست: ${faDigits(money(Math.abs(unexplained)))} ریال نیاز به بررسی دارد.`}</span>
                </div>
                {onOpenBridgeDiag && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenBridgeDiag()
                    }}
                    className={`${DIALOG_BUTTON} bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 text-xs rounded font-bold shadow-xs focus-visible:ring-rose-700 focus-visible:ring-offset-white`}
                  >
                    نمای تشخیص پل
                  </button>
                )}
              </div>
              <p className="text-rose-700 text-[11px] font-sans">
                این هشدار دربارهٔ خودِ پل حسابداری است، نه صرفاً تفاوت چینش کاشی‌های صفحه.
              </p>
            </div>
          )}

          {compositionDrift && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-amber-950 text-xs space-y-1" role="status">
              <div className="flex items-center gap-2 font-bold">
                <span className="text-base text-amber-700" aria-hidden="true">ℹ</span>
                <span>{alarmMessage ?? `در ترکیب اقلام نمایشی ${faDigits(money(Math.abs(gap)))} ریال تفاوت وجود دارد.`}</span>
              </div>
              <p className="text-amber-800 text-[11px] font-sans">
                پل حسابداری تراز است؛ این پیام به‌تنهایی دلیلِ مغایرت حسابداری یا درخواست «تشخیص پل» نیست.
              </p>
            </div>
          )}

          <div className="pt-2 text-[11px] text-slate-500 space-y-1 font-sans border-t border-slate-100">
            {omittedZeroCount > 0 && <div>• تعداد {faDigits(omittedZeroCount)} سطر با مقدار صفر برای سادگی نمایش حذف شده‌اند.</div>}
            {summaryNet !== undefined && summaryNet !== start && (
              <div>
                • خالص بالای صفحه ({money(summaryNet)} ریال) به علت تیک‌های انتخابی با خالص تعهدی اولیه ({money(start)} ریال) تفاوت دارد.
              </div>
            )}
            {official !== end && (
              <div>• عدد مرجع فعلی گزارش: {money(official)} ریال؛ نتیجهٔ زنجیره: {money(end)} ریال.</div>
            )}
          </div>
        </div>

        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className={`${DIALOG_BUTTON} bg-slate-700 hover:bg-slate-800 text-white font-bold px-4 py-1.5 rounded text-xs focus-visible:ring-slate-700 focus-visible:ring-offset-white`}
          >
            بستن پنجره
          </button>
        </div>
      </div>
    </div>
  )
}
