import React from 'react'
import { faDigits, money } from '@shared/jalali'

export interface DrawerVsPosSplitProps {
  drawer: number
  pos: number
  other: number
  realCash: number
  cashTotal: number
  cardTotal: number
  refundCashTotal: number
  refundCardTotal: number
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
  realCash,
  cashTotal,
  cardTotal,
  refundCashTotal,
  refundCardTotal,
  hasDiscrepancy = false,
  discrepancy = 0,
  onOpenExplainer,
  onOpenBridgeDiag,
  nonCash = 0,
  nonCashOpen = false,
  onToggleNonCash
}) => {
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
        {/* کاشی ۱: کشوی پول فیزیکی (اسکناس) */}
        <div className="bg-white border-2 border-emerald-300 rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-emerald-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5">
              <span>💵</span>
              <span>کشو (اسکناس فیزیکی)</span>
            </span>
            <span className="text-xs bg-emerald-50 text-emerald-800 px-1.5 py-0.5 rounded font-mono">
              باید در کشو باشد
            </span>
          </div>
          <div className="text-2xl font-black text-emerald-900 tracking-tight my-1" dir="ltr">
            {money(drawer)} <span className="text-xs font-normal text-slate-500">ریال</span>
          </div>
          <div className="text-xs text-slate-600 border-t border-slate-100 pt-1 mt-1 flex justify-between" dir="ltr">
            <span>{money(cashTotal)} دریافت</span>
            <span>−</span>
            <span>{money(refundCashTotal)} پس‌داده</span>
          </div>
        </div>

        {/* کاشی ۲: دستگاه کارت‌خوان (پوز) */}
        <div className="bg-white border-2 border-blue-300 rounded-lg p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between text-blue-950 mb-1">
            <span className="font-bold text-sm flex items-center gap-1.5">
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
          <div className="text-xs text-slate-600 border-t border-slate-100 pt-1 mt-1 flex justify-between" dir="ltr">
            <span>{money(cardTotal)} کارت</span>
            <span>−</span>
            <span>{money(refundCardTotal)} پس‌داده</span>
          </div>
        </div>

        {/* کاشی ۳: اعتباری / سایر / نامشخص (در صورت وجود) */}
        {other !== 0 && (
          <div className="bg-white border border-slate-300 rounded-lg p-3 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-800 mb-1">
              <span className="font-bold text-sm flex items-center gap-1.5">
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
