import React, { useEffect } from 'react'
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

export const NetToDrawerCard: React.FC<NetToDrawerCardProps> = ({
  open,
  onClose,
  result,
  summaryNet,
  isBalanced = true,
  onOpenBridgeDiag
}) => {
  // بستن با کلید Esc
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const { start, lines, unexplained, end, official, gap, omittedZeroCount } = result
  const isPerfectMatch = gap === 0 && unexplained === 0 && isBalanced

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 print:hidden"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
        dir="rtl"
      >
        {/* هدر پنجره */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🧮</span>
            <div>
              <h3 className="font-black text-base">چطور از خالص فروش به موجودی دخل رسیدیم؟</h3>
              <p className="text-xs text-slate-300 font-light mt-0.5">
                حساب‌کتاب ریاضی و گام‌به‌گام از ارزش کالاهای رفته تا پول فیزیکی داخل صندوق
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white text-lg font-bold p-1 rounded hover:bg-slate-800 transition-colors"
            title="بستن (Esc)"
          >
            ✕
          </button>
        </div>

        {/* محتوای زنجیره ریاضی */}
        <div className="p-5 max-h-[75vh] overflow-y-auto space-y-3">
          <div className="text-xs text-slate-500 font-medium pb-1 border-b border-slate-100">
            گزارش زیر نشان می‌دهد چه رویدادهایی پول را در دخل نگه داشته یا بدون ورود نقد کالا را خارج کرده‌اند:
          </div>

          <div className="space-y-1.5 font-mono text-sm">
            {/* گام اول: خالص فروش کالا */}
            <div className="flex items-center justify-between p-2.5 bg-slate-100 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 font-sans font-bold text-slate-800">
                <span className="w-5 text-center text-slate-400 text-xs">۱</span>
                <span>خالص ارزش کالاهای فروخته‌شده (خالص تعهدی)</span>
              </div>
              <div className="font-bold text-slate-900 text-base" dir="ltr">
                + {money(start)} <span className="text-xs font-normal text-slate-500 font-sans">ریال</span>
              </div>
            </div>

            {/* سطرهای میانی جمع و تفریق */}
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

            {/* خط تراز و نتیجه نهایی */}
            <div className="pt-2 border-t-2 border-slate-400">
              <div className="flex items-center justify-between p-3 bg-sky-100 rounded-lg border-2 border-sky-300">
                <div className="flex items-center gap-2 font-sans font-black text-sky-950">
                  <span className="text-base">🟰</span>
                  <span className="text-sm md:text-base">کل پولی که واقعاً باید در صندوق و کارت‌خوان باشد</span>
                </div>
                <div className="font-black text-sky-950 text-lg md:text-xl" dir="ltr">
                  = {money(end)} <span className="text-xs font-normal text-slate-600 font-sans">ریال</span>
                </div>
              </div>
            </div>
          </div>

          {/* وضعیت تراز یا هشدار مغایرت */}
          {isPerfectMatch ? (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg flex items-center justify-between text-emerald-900 text-xs font-bold">
              <div className="flex items-center gap-2">
                <span className="text-base text-emerald-600">✓</span>
                <span>تراز دقیق و کامل: تمام اجزای فروش با موجودی فیزیکی دخل تطبیق دارد.</span>
              </div>
              <span className="bg-emerald-200 text-emerald-900 px-2 py-0.5 rounded font-mono">اختلاف: ۰</span>
            </div>
          ) : (
            <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-900 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-bold">
                  <span className="text-base text-rose-600">⚠️</span>
                  <span>
                    مغایرت در پل تطبیق: مبلغ {faDigits(money(Math.abs(gap !== 0 ? gap : unexplained)))} ریال نیاز به
                    بررسی دارد.
                  </span>
                </div>
                {onOpenBridgeDiag && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      onOpenBridgeDiag()
                    }}
                    className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white px-2.5 py-1 text-xs rounded font-bold shadow-xs"
                  >
                    نمای تشخیص پل ۱-کلیکی
                  </button>
                )}
              </div>
              <p className="text-rose-700 text-[11px] font-sans">
                علت مغایرت می‌تواند ثبت پرداخت با تاریخ خارج از دوره یا مابه‌التفاوت‌های ثبت‌نشده باشد.
              </p>
            </div>
          )}

          {/* پانوشت‌ها و یادداشت‌های کمکی */}
          <div className="pt-2 text-[11px] text-slate-500 space-y-1 font-sans border-t border-slate-100">
            {omittedZeroCount > 0 && (
              <div>• تعداد {faDigits(omittedZeroCount)} سطر محاسباتی با مقدار صفر برای سادگی نمایش حذف شدند.</div>
            )}
            {summaryNet !== undefined && summaryNet !== start && (
              <div>
                • خالص بالای صفحه ({money(summaryNet)} ریال) به علت تیک‌های انتخابی با خالص تعهدی اولیه ({money(start)}{' '}
                ریال) تفاوت دارد.
              </div>
            )}
          </div>
        </div>

        {/* فوتر */}
        <div className="bg-slate-50 px-5 py-3 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="btn btn-sm bg-slate-700 hover:bg-slate-800 text-white font-bold px-4 py-1.5 rounded text-xs"
          >
            بستن پنجره
          </button>
        </div>
      </div>
    </div>
  )
}
