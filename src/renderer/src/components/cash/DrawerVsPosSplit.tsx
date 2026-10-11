import React, { useCallback, useEffect, useRef, useState } from 'react'
import { faDigits, money } from '@shared/jalali'
import type { NetToDrawerAlarm } from '@shared/cashExplainer'

export interface DrawerVsPosSplitProps {
  drawer: number
  pos: number
  other: number
  managerOutside?: number
  /** عدد مرجعِ فعلی گزارش؛ لزوماً معادل شمارش اسکناس کشو نیست. */
  realCash: number
  cashTotal: number
  cardTotal: number
  refundCashTotal: number
  refundCardTotal: number
  otherTotal?: number
  creditTotal?: number
  destinationUnknownTotal?: number
  hasDiscrepancy?: boolean
  discrepancy?: number
  /** تفاوتِ کاشی‌ها با عدد مرجع گزارش یا فقط با زنجیرهٔ نمایشی است. */
  discrepancyKind?: 'OFFICIAL_REFERENCE' | 'CHAIN_COMPOSITION' | null
  /** وضعیت واقعی پل تطبیق؛ با تفاوت صرفاً نمایشی یکی نیست. */
  bridgeAlarm?: NetToDrawerAlarm
  onOpenExplainer: () => void
  /** وقتی ریزبین واحد موجود است، کاشی‌ها مودال مستقل باز نمی‌کنند. */
  onOpenFinancialInspector?: (focus: 'drawer' | 'pos' | 'other' | 'manager') => void
  onOpenBridgeDiag?: () => void
  nonCash?: number
  nonCashOpen?: boolean
  onToggleNonCash?: () => void
}

type DetailKey = 'drawer' | 'pos' | 'other' | 'manager'

/**
 * این کنترل‌ها عمداً از `.btn` مشترک استفاده نمی‌کنند: `.btn` در stylesheet
 * زمینهٔ سفید اعمال می‌کند و می‌تواند رنگ دکمه‌های هشدار/عملیات مالی را بپوشاند.
 */
const ACTION_BUTTON =
  'appearance-none border-0 bg-transparent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60'
const TILE_BUTTON =
  'w-full text-right appearance-none cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 focus-visible:ring-offset-2'

const detailMeta: Record<DetailKey, { icon: string; title: string }> = {
  drawer: { icon: '💵', title: 'جزئیات ثبت‌شدهٔ کشوی نقدی' },
  pos: { icon: '💳', title: 'جزئیات ثبت‌شدهٔ دستگاه کارت‌خوان' },
  other: { icon: '🏷️', title: 'جزئیات دریافتی‌های غیرنقدی، متفرقه و نامشخص' },
  manager: { icon: '🏦', title: 'جزئیات دریافتی‌های مستقیم به حساب مدیر' }
}

export const DrawerVsPosSplit: React.FC<DrawerVsPosSplitProps> = ({
  drawer,
  pos,
  other,
  managerOutside = 0,
  realCash,
  cashTotal,
  cardTotal,
  refundCashTotal,
  refundCardTotal,
  otherTotal = 0,
  creditTotal = 0,
  destinationUnknownTotal = 0,
  hasDiscrepancy = false,
  discrepancy = 0,
  discrepancyKind = null,
  bridgeAlarm = null,
  onOpenExplainer,
  onOpenFinancialInspector,
  onOpenBridgeDiag,
  nonCash = 0,
  nonCashOpen = false,
  onToggleNonCash
}) => {
  const [activeDetail, setActiveDetail] = useState<DetailKey | null>(null)
  const openerRef = useRef<HTMLButtonElement | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const openDetail = useCallback((detail: DetailKey, opener: HTMLButtonElement) => {
    if (onOpenFinancialInspector) {
      onOpenFinancialInspector(detail)
      return
    }
    openerRef.current = opener
    setActiveDetail(detail)
  }, [onOpenFinancialInspector])

  const closeDetail = useCallback(() => {
    setActiveDetail(null)
    // پس از unmount شدن دیالوگ، focus به همان کاشی‌ای برگردد که آن را باز کرده است.
    window.setTimeout(() => openerRef.current?.focus(), 0)
  }, [])

  /**
   * تا زمانی که مودال‌های قدیمی کاشی‌ها به ریزبین واحد مهاجرت می‌کنند، همین مودال
   * نیز باید modal واقعی باشد: Esc، focus اولیه، trap با Tab و focus restoration.
   */
  useEffect(() => {
    if (!activeDetail) return

    const focusDialogClose = window.requestAnimationFrame(() => closeButtonRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeDetail()
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
      window.cancelAnimationFrame(focusDialogClose)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeDetail, closeDetail])

  const discrepancyText =
    discrepancyKind === 'CHAIN_COMPOSITION'
      ? 'جمع کاشی‌ها با زنجیرهٔ توضیحی تفاوت دارد؛ این مورد به‌تنهایی به معنی بازبودن پل حسابداری نیست.'
      : 'جمع کاشی‌ها با عدد مرجع فعلی گزارش هم‌خوان نیست.'
  const shouldOfferBridgeDiagnostics = bridgeAlarm === 'BRIDGE_UNBALANCED' && typeof onOpenBridgeDiag === 'function'

  return (
    <section className="bg-sky-50 border border-sky-200 rounded-lg p-3 my-2 shadow-sm text-slate-800" aria-label="کنترل کارت‌خوان و صندوق">
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-sky-200">
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="font-bold text-base text-sky-950">کنترل کارت‌خوان و صندوق</h3>
          <span className="text-xs text-sky-800 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-300">
            کنترل گزارش، نه شمارش فیزیکی کشو
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenExplainer}
          className={`${ACTION_BUTTON} shrink-0 bg-white hover:bg-sky-100 text-sky-800 border border-sky-300 font-bold px-3 py-1 flex items-center gap-1.5 shadow-sm text-xs rounded transition-colors`}
          title="مشاهده زنجیرهٔ توضیحی از خالص فروش تا اعداد کنترل گزارش"
        >
          <span className="text-sky-600 font-black" aria-hidden="true">؟</span>
          <span>چطور به این اعداد رسیدیم؟</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-3">
        <button
          type="button"
          onClick={(event) => openDetail('drawer', event.currentTarget)}
          className={`${TILE_BUTTON} bg-white border-2 ${
            drawer < 0 ? 'border-amber-400 bg-amber-50/30' : 'border-emerald-300'
          } rounded-lg p-3 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-emerald-500 transition-all group`}
          aria-haspopup="dialog"
          title="مشاهده جزئیات ثبت‌شدهٔ کشوی نقدی"
        >
          <span className="flex items-center justify-between text-emerald-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-emerald-700">
              <span aria-hidden="true">💵</span>
              <span>کشو (اسکناس فیزیکی)</span>
            </span>
            <span
              className={`text-xs ${
                drawer < 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'
              } px-1.5 py-0.5 rounded font-medium`}
            >
              انتظار ثبت‌شده
            </span>
          </span>
          <span
            className={`block text-2xl font-black ${
              drawer < 0 ? 'text-amber-900' : 'text-emerald-900'
            } tracking-tight my-1`}
            dir="ltr"
          >
            {money(drawer)} <span className="text-xs font-normal text-slate-500">ریال</span>
          </span>
          {drawer < 0 && (
            <span className="block text-xs text-amber-800 font-normal leading-5 my-1 bg-amber-100/60 p-1.5 rounded">
              بازپرداخت نقدی ثبت‌شده از دریافت نقدی ثبت‌شده بیش‌تر است؛ برای بررسی، جزئیات رویدادها را باز کنید.
            </span>
          )}
          <span className="text-sm text-slate-600 border-t border-slate-100 pt-1.5 mt-1 flex justify-between gap-2 items-center">
            <span>دریافت نقدی: <b dir="ltr">{money(cashTotal)}</b></span>
            <span>بازپرداخت: <b dir="ltr">{money(refundCashTotal)}</b></span>
          </span>
          <span className="block text-xs text-emerald-700/80 font-medium text-center pt-1 group-hover:underline">
            مشاهدهٔ جزئیات ثبت‌شده
          </span>
        </button>

        <button
          type="button"
          onClick={(event) => openDetail('pos', event.currentTarget)}
          className={`${TILE_BUTTON} bg-white border-2 ${pos < 0 ? 'border-amber-400 bg-amber-50/30 hover:border-amber-500' : 'border-blue-300 hover:border-blue-500'} rounded-lg p-3 shadow-xs flex flex-col justify-between hover:shadow-md transition-all group`}
          aria-haspopup="dialog"
          title="مشاهده جزئیات ثبت‌شدهٔ کارت‌خوان"
        >
          <span className="flex items-center justify-between text-blue-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-blue-700">
              <span aria-hidden="true">💳</span>
              <span>کارت‌خوان (دستگاه پوز)</span>
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${pos < 0 ? 'bg-amber-100 text-amber-900' : 'bg-blue-50 text-blue-800'}`}>انتظار ثبت‌شده</span>
          </span>
          <span className={`block text-2xl font-black tracking-tight my-1 ${pos < 0 ? 'text-amber-900' : 'text-blue-900'}`} dir="ltr">
            {money(pos)} <span className="text-xs font-normal text-slate-500">ریال</span>
          </span>
          {pos < 0 && (
            <span className="block text-xs text-amber-800 font-normal leading-5 my-1 bg-amber-100/60 p-1.5 rounded">
              بازپرداخت کارتی ثبت‌شده از دریافت کارت‌خوان ثبت‌شده بیش‌تر است؛ برای بررسی، جزئیات رویدادها را باز کنید.
            </span>
          )}
          <span className="text-sm text-slate-600 border-t border-slate-100 pt-1.5 mt-1 flex justify-between gap-2 items-center">
            <span>دریافت کارتی: <b dir="ltr">{money(cardTotal)}</b></span>
            <span>بازپرداخت: <b dir="ltr">{money(refundCardTotal)}</b></span>
          </span>
          <span className="block text-xs text-blue-700/80 font-medium text-center pt-1 group-hover:underline">مشاهدهٔ جزئیات ثبت‌شده</span>
        </button>

        {other !== 0 && (
          <button
            type="button"
            onClick={(event) => openDetail('other', event.currentTarget)}
            className={`${TILE_BUTTON} bg-white border border-slate-300 rounded-lg p-3 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-slate-500 transition-all group`}
            aria-haspopup="dialog"
            title="مشاهده ریز دریافتی‌های غیرنقدی، متفرقه و نامشخص"
          >
            <span className="flex items-center justify-between text-slate-800 mb-1">
              <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-slate-950">
                <span aria-hidden="true">🏷️</span>
                <span>سایر / اعتباری / نامشخص</span>
              </span>
              <span className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">خارج از کشو و پوز</span>
            </span>
            <span className="block text-xl font-bold text-slate-800 tracking-tight my-1" dir="ltr">
              {money(other)} <span className="text-xs font-normal text-slate-500">ریال</span>
            </span>
            <span className="block text-xs text-slate-500 border-t border-slate-100 pt-1 mt-1">
              واریزی متفرقه، اعتبار و مسیرهای نامشخص
            </span>
            <span className="block text-xs text-slate-600 font-medium text-center pt-1 group-hover:underline">مشاهدهٔ جزئیات ثبت‌شده</span>
          </button>
        )}

        {managerOutside > 0 && (
          <button
            type="button"
            onClick={(event) => openDetail('manager', event.currentTarget)}
            className={`${TILE_BUTTON} bg-purple-50/70 border border-purple-200 rounded-lg p-3 shadow-xs flex flex-col justify-between hover:shadow-md hover:border-purple-400 transition-all group`}
            aria-haspopup="dialog"
            title="مشاهده ریز مبالغ حساب مدیر"
          >
            <span className="flex items-center justify-between text-purple-950 mb-1">
              <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-purple-800">
                <span aria-hidden="true">🏦</span>
                <span>واریز به حساب مدیر</span>
              </span>
              <span className="text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-medium">خارج از دخل</span>
            </span>
            <span className="block text-xl font-bold text-purple-900 tracking-tight my-1" dir="ltr">
              {money(managerOutside)} <span className="text-xs font-normal text-slate-500">ریال</span>
            </span>
            <span className="block text-xs text-purple-700/80 border-t border-purple-100 pt-1 mt-1">دریافتی مستقیم به حساب یا کارت مدیر</span>
            <span className="block text-xs text-purple-800 font-medium text-center pt-1 group-hover:underline">مشاهدهٔ جزئیات ثبت‌شده</span>
          </button>
        )}
      </div>

      <div className="bg-white/80 border border-sky-300 rounded-lg p-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-bold text-slate-900">عدد مرجع فعلی گزارش برای کنترل صندوق و کارت‌خوان:</span>
          <b className="text-lg font-black text-sky-950" dir="ltr">{money(realCash)}</b>
          <span className="text-sm font-normal text-slate-600">ریال</span>
        </div>

        {onToggleNonCash && nonCash > 0 && (
          <button
            type="button"
            onClick={onToggleNonCash}
            aria-expanded={nonCashOpen}
            className={`${ACTION_BUTTON} bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 shadow-xs`}
          >
            <span>{nonCashOpen ? '− بستن ریز تسویه‌های غیرنقدی' : '+ مشاهده ریز تسویه‌های غیرنقدی'}</span>
            <span className="bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded text-[11px]" dir="ltr">{money(nonCash)} ریال</span>
          </button>
        )}
      </div>

      {hasDiscrepancy && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-300 rounded text-rose-800 text-xs font-bold flex items-center justify-between gap-2 flex-wrap" role="status">
          <div className="flex items-center gap-1.5">
            <span aria-hidden="true">⚠️</span>
            <span>
              {discrepancyText} اختلاف: {faDigits(money(Math.abs(discrepancy)))} ریال.
            </span>
          </div>
          {shouldOfferBridgeDiagnostics && (
            <button
              type="button"
              onClick={onOpenBridgeDiag}
              className={`${ACTION_BUTTON} bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1 rounded shadow-xs`}
            >
              تشخیص پل تطبیق
            </button>
          )}
        </div>
      )}

      {activeDetail && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 print:hidden animate-in fade-in duration-100"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetail()
          }}
        >
          <div
            ref={dialogRef}
            className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-tile-detail-title"
            dir="rtl"
          >
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">{detailMeta[activeDetail].icon}</span>
                <h4 id="cash-tile-detail-title" className="font-bold text-sm">{detailMeta[activeDetail].title}</h4>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDetail}
                className={`${ACTION_BUTTON} text-slate-300 hover:text-white text-base font-bold p-1 rounded hover:bg-slate-800`}
                aria-label="بستن جزئیات ثبت‌شده"
                title="بستن (Esc)"
              >
                ✕
              </button>
            </div>

            <div className="p-4 space-y-3 text-sm">
              {activeDetail === 'drawer' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-slate-700">دریافت‌های نقدی ثبت‌شده:</span>
                    <b className="text-emerald-700" dir="ltr">{money(cashTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-rose-50/60 border border-rose-200">
                    <span className="text-slate-700">بازپرداخت نقدی ثبت‌شده:</span>
                    <b className="text-rose-700" dir="ltr">{money(refundCashTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded bg-emerald-100 border-2 border-emerald-300 font-bold">
                    <span className="text-emerald-950">انتظار ثبت‌شده برای کشو:</span>
                    <b className="text-emerald-950 text-base" dir="ltr">{money(drawer)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    این یک انتظار مبتنی بر رویدادهای ثبت‌شده است؛ برای بستن صندوق، شمارش فیزیکی و گردش‌های خارج از فروش هم باید جداگانه بررسی شوند.
                  </div>
                </div>
              )}

              {activeDetail === 'pos' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-slate-700">دریافت‌های کارتی ثبت‌شده:</span>
                    <b className="text-blue-700" dir="ltr">{money(cardTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-rose-50/60 border border-rose-200">
                    <span className="text-slate-700">بازپرداخت‌های کارتی ثبت‌شده:</span>
                    <b className="text-rose-700" dir="ltr">{money(refundCardTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded bg-blue-100 border-2 border-blue-300 font-bold">
                    <span className="text-blue-950">انتظار ثبت‌شده برای کارت‌خوان:</span>
                    <b className="text-blue-950 text-base" dir="ltr">{money(pos)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    این عدد را با گزارش پایان‌روز دستگاه مقایسه کنید؛ تراکنش‌های کارت‌به‌کارت و حساب مدیر در این کاشی نیستند.
                  </div>
                </div>
              )}

              {activeDetail === 'other' && (
                <div className="space-y-2">
                  {otherTotal !== 0 && (
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-700">واریزی‌ها و دریافتی‌های متفرقه:</span>
                      <b dir="ltr">{money(otherTotal)} ریال</b>
                    </div>
                  )}
                  {creditTotal !== 0 && (
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-700">تسویه‌های اعتباری:</span>
                      <b dir="ltr">{money(creditTotal)} ریال</b>
                    </div>
                  )}
                  {destinationUnknownTotal !== 0 && (
                    <div className="flex justify-between items-center p-2 rounded bg-amber-50 border border-amber-200">
                      <span className="text-amber-900">دریافتی با مقصد نامشخص:</span>
                      <b className="text-amber-900" dir="ltr">{money(destinationUnknownTotal)} ریال</b>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-2.5 rounded bg-slate-100 border-2 border-slate-300 font-bold">
                    <span>جمع این سبد:</span>
                    <b className="text-base" dir="ltr">{money(other)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    این سبد نباید معادل پول فیزیکی کشو یا کارت‌خوان تلقی شود؛ هر مسیر در ریزبین مالی به‌طور جداگانه مستند می‌شود.
                  </div>
                </div>
              )}

              {activeDetail === 'manager' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2.5 rounded bg-purple-100 border-2 border-purple-300 font-bold">
                    <span className="text-purple-950">دریافتی مستقیم به حساب مدیر:</span>
                    <b className="text-purple-950 text-base" dir="ltr">{money(managerOutside)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    بدهی مشتری می‌تواند کم شده باشد، اما این مبلغ به کشو یا کارت‌خوان فروشگاه نرسیده است؛ بنابراین بیرون از کنترل فیزیکی دخل نشان داده می‌شود.
                  </div>
                </div>
              )}
            </div>

            <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={closeDetail}
                className={`${ACTION_BUTTON} bg-slate-700 hover:bg-slate-800 text-white px-4 py-1 text-xs rounded`}
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
