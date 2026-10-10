import React, { useState } from 'react'
import { faDigits, money } from '@shared/jalali'

export interface DrawerVsPosSplitProps {
  drawer: number
  pos: number
  other: number
  managerOutside?: number
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
  onOpenExplainer: () => void
  onOpenBridgeDiag?: () => void
  nonCash?: number
  nonCashOpen?: boolean
  onToggleNonCash?: () => void
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
  onOpenExplainer,
  onOpenBridgeDiag,
  nonCash = 0,
  nonCashOpen = false,
  onToggleNonCash
}) => {
  const [activeDetail, setActiveDetail] = useState<'drawer' | 'pos' | 'other' | 'manager' | null>(null)

  return (
    <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 my-2 shadow-sm text-slate-800">
      {/* هدر کنترل */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-sky-200">
        <div className="flex items-center gap-2">
          <span className="font-bold text-base text-sky-950">کنترل کارت‌خوان و صندوق</span>
          <span className="text-xs text-sky-700 bg-sky-100 px-2 py-0.5 rounded-full border border-sky-300">
            موجودی فیزیکی واقعی
          </span>
        </div>
        <button
          type="button"
          onClick={onOpenExplainer}
          className="btn btn-sm bg-white hover:bg-sky-100 text-sky-800 border border-sky-300 font-bold px-3 py-1 flex items-center gap-1.5 shadow-sm text-xs rounded transition-colors"
          title="مشاهده جمع و تفریق عددی زنجیره‌ای از خالص فروش تا موجودی واقعی دخل"
        >
          <span className="text-sky-600 font-black">؟</span>
          <span>چطور از خالص به این عدد رسیدیم؟</span>
        </button>
      </div>

      {/* کاشی‌های درشت تفکیک کشو و کارت‌خوان */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 mb-3">
        {/* کاشی ۱: کشوی پول فیزیکی (اسکناس) */}
        <div
          onClick={() => setActiveDetail('drawer')}
          className={`bg-white border-2 ${
            drawer < 0 ? 'border-amber-400 bg-amber-50/30' : 'border-emerald-300'
          } rounded-lg p-3 shadow-xs flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-emerald-500 transition-all group`}
          title="برای مشاهده ریز محاسبات کشوی نقدی کلیک کنید"
        >
          <div className="flex items-center justify-between text-emerald-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-emerald-700">
              <span>💵</span>
              <span>کشو (اسکناس فیزیکی)</span>
            </span>
            <span
              className={`text-xs ${
                drawer < 0 ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'
              } px-1.5 py-0.5 rounded font-mono`}
            >
              باید در کشو باشد
            </span>
          </div>
          <div
            className={`text-2xl font-black ${
              drawer < 0 ? 'text-amber-900' : 'text-emerald-900'
            } tracking-tight my-1`}
            dir="ltr"
          >
            {money(drawer)} <span className="text-xs font-normal text-slate-500">ریال</span>
          </div>
          {drawer < 0 && (
            <div className="text-[11px] text-amber-800 font-normal leading-tight my-1 bg-amber-100/60 p-1.5 rounded">
              خروج نقد بیش از ورود بوده (پرداخت مرجوعی از نقدینگی اول وقت/تنخواه)
            </div>
          )}
          <div className="text-xs text-slate-600 border-t border-slate-100 pt-1 mt-1 flex justify-between items-center" dir="ltr">
            <span>{money(cashTotal)} دریافت</span>
            <span>−</span>
            <span>{money(refundCashTotal)} پس‌داده</span>
          </div>
          <div className="text-[10px] text-emerald-700/80 font-medium text-center pt-1 group-hover:underline">
            🔍 کلیک برای مشاهده ریز محاسبات
          </div>
        </div>

        {/* کاشی ۲: دستگاه کارت‌خوان (پوز) */}
        <div
          onClick={() => setActiveDetail('pos')}
          className="bg-white border-2 border-blue-300 rounded-lg p-3 shadow-xs flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-blue-500 transition-all group"
          title="برای مشاهده ریز محاسبات کارت‌خوان کلیک کنید"
        >
          <div className="flex items-center justify-between text-blue-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-blue-700">
              <span>💳</span>
              <span>کارت‌خوان (دستگاه پوز)</span>
            </span>
            <span className="text-xs bg-blue-50 text-blue-800 px-1.5 py-0.5 rounded font-mono">
              جمع پایان‌روز دستگاه
            </span>
          </div>
          <div className="text-2xl font-black text-blue-900 tracking-tight my-1" dir="ltr">
            {money(pos)} <span className="text-xs font-normal text-slate-500">ریال</span>
          </div>
          <div className="text-xs text-slate-600 border-t border-slate-100 pt-1 mt-1 flex justify-between items-center" dir="ltr">
            <span>{money(cardTotal)} کارت</span>
            <span>−</span>
            <span>{money(refundCardTotal)} پس‌داده</span>
          </div>
          <div className="text-[10px] text-blue-700/80 font-medium text-center pt-1 group-hover:underline">
            🔍 کلیک برای مشاهده ریز محاسبات
          </div>
        </div>

        {/* کاشی ۳: اعتباری / سایر / نامشخص (در صورت وجود) */}
        {other !== 0 && (
          <div
            onClick={() => setActiveDetail('other')}
            className="bg-white border border-slate-300 rounded-lg p-3 shadow-xs flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-slate-500 transition-all group"
            title="برای مشاهده ریز محاسبات سایر دریافتی‌ها کلیک کنید"
          >
            <div className="flex items-center justify-between text-slate-800 mb-1">
              <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-slate-950">
                <span>🏷️</span>
                <span>اعتباری / سایر دریافتی‌ها</span>
              </span>
              <span className="text-xs bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded">خارج از کارت‌خوان</span>
            </div>
            <div className="text-xl font-bold text-slate-800 tracking-tight my-1" dir="ltr">
              {money(other)} <span className="text-xs font-normal text-slate-500">ریال</span>
            </div>
            <div className="text-xs text-slate-500 border-t border-slate-100 pt-1 mt-1">
              واریزی‌های متفرقه / چک‌های پاس‌شده
            </div>
            <div className="text-[10px] text-slate-600 font-medium text-center pt-1 group-hover:underline">
              🔍 کلیک برای مشاهده ریز محاسبات
            </div>
          </div>
        )}

        {/* کاشی ۴: حساب مدیر (در صورت وجود) */}
        {managerOutside > 0 && (
          <div
            onClick={() => setActiveDetail('manager')}
            className="bg-purple-50/70 border border-purple-200 rounded-lg p-3 shadow-xs flex flex-col justify-between cursor-pointer hover:shadow-md hover:border-purple-400 transition-all group"
            title="برای مشاهده ریز مبالغ حساب مدیر کلیک کنید"
          >
            <div className="flex items-center justify-between text-purple-950 mb-1">
              <span className="font-bold text-sm flex items-center gap-1.5 group-hover:text-purple-800">
                <span>🏦</span>
                <span>واریز به حساب مدیر</span>
              </span>
              <span className="text-xs bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded font-mono">
                خارج از دخل فیزیکی
              </span>
            </div>
            <div className="text-xl font-bold text-purple-900 tracking-tight my-1" dir="ltr">
              {money(managerOutside)} <span className="text-xs font-normal text-slate-500">ریال</span>
            </div>
            <div className="text-xs text-purple-700/80 border-t border-purple-100 pt-1 mt-1">
              واریز مستقیم به حساب/کارت شخصی مدیر
            </div>
            <div className="text-[10px] text-purple-800 font-medium text-center pt-1 group-hover:underline">
              🔍 کلیک برای مشاهده ریز محاسبات
            </div>
          </div>
        )}
      </div>

      {/* سطر جمع کل پولی که باید باشد */}
      <div className="bg-white/80 border border-sky-300 rounded-lg p-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900">جمع کل پولی که باید در صندوق و کارت‌خوان باشد:</span>
          <b className="text-lg font-black text-sky-950" dir="ltr">
            {money(realCash)}
          </b>
          <span className="text-sm font-normal text-slate-600">ریال</span>
        </div>

        {onToggleNonCash && nonCash > 0 && (
          <button
            type="button"
            onClick={onToggleNonCash}
            className="btn btn-sm bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1 shadow-xs"
          >
            <span>{nonCashOpen ? '− بستن ریز تسویه‌های غیرنقدی' : '+ مشاهده ریز تسویه‌های غیرنقدی'}</span>
            <span className="bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded text-[11px]" dir="ltr">
              {money(nonCash)} ریال
            </span>
          </button>
        )}
      </div>

      {/* هشدار مغایرت بین جمع کاشی‌ها و رقم رسمی (در صورت بروز) */}
      {hasDiscrepancy && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-300 rounded text-rose-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>
              مغایرت محاسباتی در تفکیک اجزا: {faDigits(money(Math.abs(discrepancy)))} ریال با جمع کل هم‌خوان نیست.
            </span>
          </div>
          {onOpenBridgeDiag && (
            <button
              type="button"
              onClick={onOpenBridgeDiag}
              className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white text-xs px-2.5 py-1 rounded shadow-xs"
            >
              تشخیص پل تطبیق
            </button>
          )}
        </div>
      )}

      {/* مودال ریز جزییات هر کاشی */}
      {activeDetail && (
        <div
          className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 print:hidden animate-in fade-in duration-100"
          onClick={() => setActiveDetail(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl border border-slate-300 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
            dir="rtl"
          >
            {/* هدر مودال جزییات */}
            <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">
                  {activeDetail === 'drawer'
                    ? '💵'
                    : activeDetail === 'pos'
                      ? '💳'
                      : activeDetail === 'other'
                        ? '🏷️'
                        : '🏦'}
                </span>
                <h4 className="font-bold text-sm">
                  {activeDetail === 'drawer'
                    ? 'ریز محاسبات کشوی نقدی (اسکناس فیزیکی)'
                    : activeDetail === 'pos'
                      ? 'ریز محاسبات دستگاه کارت‌خوان (پوز)'
                      : activeDetail === 'other'
                        ? 'ریز دریافتی‌های اعتباری و متفرقه'
                        : 'ریز دریافتی‌های مستقیم به حساب مدیر'}
                </h4>
              </div>
              <button
                type="button"
                onClick={() => setActiveDetail(null)}
                className="text-slate-400 hover:text-white text-base font-bold p-1 rounded hover:bg-slate-800"
              >
                ✕
              </button>
            </div>

            {/* بدنه محاسبات جزییات */}
            <div className="p-4 space-y-3 text-sm">
              {activeDetail === 'drawer' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-slate-700">۱. جمع کل دریافت‌های نقدی از فاکتورها:</span>
                    <b className="text-emerald-700" dir="ltr">+ {money(cashTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-rose-50/60 border border-rose-200">
                    <span className="text-slate-700">۲. بازپرداخت نقدی مرجوعی‌ها (خروج از کشو):</span>
                    <b className="text-rose-700" dir="ltr">− {money(refundCashTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded bg-emerald-100 border-2 border-emerald-300 font-bold">
                    <span className="text-emerald-950">موجودی نقد فیزیکی که باید در کشو باشد:</span>
                    <b className="text-emerald-950 text-base" dir="ltr">= {money(drawer)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    💡 <b>راهنما:</b> این عدد دقیقا برابر با مبلغ اسکناس‌هایی است که باید در پایان بازه داخل کشوی دخل فروشگاه شمرده شود.
                  </div>
                </div>
              )}

              {activeDetail === 'pos' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                    <span className="text-slate-700">۱. جمع کل تراکنش‌های کارت‌خوان:</span>
                    <b className="text-blue-700" dir="ltr">+ {money(cardTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded bg-rose-50/60 border border-rose-200">
                    <span className="text-slate-700">۲. بازپرداخت‌های کارتی مرجوعی‌ها:</span>
                    <b className="text-rose-700" dir="ltr">− {money(refundCardTotal)} ریال</b>
                  </div>
                  <div className="flex justify-between items-center p-2.5 rounded bg-blue-100 border-2 border-blue-300 font-bold">
                    <span className="text-blue-950">جمع کل خالص پایان‌روز دستگاه کارت‌خوان:</span>
                    <b className="text-blue-950 text-base" dir="ltr">= {money(pos)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    💡 <b>راهنما:</b> این عدد را با رسید کاغذی «گزارش پایان‌روز / جمع کل» چاپ‌شده از خودِ دستگاه کارت‌خوان مقایسه کنید.
                  </div>
                </div>
              )}

              {activeDetail === 'other' && (
                <div className="space-y-2">
                  {otherTotal !== 0 && (
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-700">واریزی‌های متفرقه:</span>
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
                    <div className="flex justify-between items-center p-2 rounded bg-slate-50 border border-slate-200">
                      <span className="text-slate-700">دریافتی با مقصد نامشخص:</span>
                      <b dir="ltr">{money(destinationUnknownTotal)} ریال</b>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-2.5 rounded bg-slate-100 border-2 border-slate-300 font-bold">
                    <span>جمع کل سایر دریافتی‌ها:</span>
                    <b className="text-base" dir="ltr">= {money(other)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    💡 <b>راهنما:</b> این مبالغ خارج از دستگاه کارت‌خوان و کشوی نقد دریافت شده‌اند (نظیر چک، واریز بانکی یا اعتباری).
                  </div>
                </div>
              )}

              {activeDetail === 'manager' && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2.5 rounded bg-purple-100 border-2 border-purple-300 font-bold">
                    <span className="text-purple-950">واریز مستقیم به حساب شخصی مدیر:</span>
                    <b className="text-purple-950 text-base" dir="ltr">{money(managerOutside)} ریال</b>
                  </div>
                  <div className="text-xs text-slate-500 bg-slate-50 p-2 rounded border border-slate-200 leading-5">
                    💡 <b>راهنما:</b> این وجوه به حساب یا کارت بانکی مدیر منتقل شده و در صندوق فیزیکی فروشگاه قرار ندارد.
                  </div>
                </div>
              )}
            </div>

            {/* فوتر مودال جزییات */}
            <div className="bg-slate-50 px-4 py-2.5 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setActiveDetail(null)}
                className="btn btn-sm bg-slate-700 hover:bg-slate-800 text-white px-4 py-1 text-xs rounded"
              >
                بستن
              </button>
            </div>
          </div>
        </div>
      )}

      {/* سطر جمع کل پولی که باید باشد */}
      <div className="bg-white/80 border border-sky-300 rounded-lg p-2.5 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="font-bold text-slate-900">جمع کل پولی که باید در صندوق و کارت‌خوان باشد:</span>
          <b className="text-lg font-black text-sky-950" dir="ltr">
            {money(realCash)}
          </b>
          <span className="text-sm font-normal text-slate-600">ریال</span>
        </div>

        {onToggleNonCash && nonCash > 0 && (
          <button
            type="button"
            onClick={onToggleNonCash}
            className="btn btn-sm bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold px-2.5 py-1 text-xs rounded transition-colors flex items-center gap-1"
          >
            <span>{nonCashOpen ? '− بستن ریز تسویه‌های غیرنقدی' : '+ مشاهده ریز تسویه‌های غیرنقدی'}</span>
            <span className="bg-amber-200 text-amber-900 px-1.5 py-0.2 rounded text-[11px]" dir="ltr">
              {money(nonCash)} ریال
            </span>
          </button>
        )}
      </div>

      {/* هشدار مغایرت بین جمع کاشی‌ها و رقم رسمی (در صورت بروز) */}
      {hasDiscrepancy && (
        <div className="mt-2 p-2 bg-rose-50 border border-rose-300 rounded text-rose-800 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span>⚠️</span>
            <span>
              مغایرت محاسباتی در تفکیک اجزا: {faDigits(money(Math.abs(discrepancy)))} ریال با جمع کل هم‌خوان نیست.
            </span>
          </div>
          {onOpenBridgeDiag && (
            <button
              type="button"
              onClick={onOpenBridgeDiag}
              className="btn btn-sm bg-rose-600 hover:bg-rose-700 text-white text-xs px-2 py-0.5 rounded"
            >
              تشخیص پل تطبیق
            </button>
          )}
        </div>
      )}
    </div>
  )
}
