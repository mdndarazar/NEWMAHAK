import React, { useState } from 'react'
import { faDigits, money } from '@shared/jalali'
import type { ExchangeReportRow, SaleBridgeSource } from '@shared/types'

export interface NonCashDrawerProps {
  open: boolean
  onToggle: () => void
  expectedNonCash: number
  exchangeRows: ExchangeReportRow[]
  creditSources: SaleBridgeSource[]
  loading?: boolean
  onOpenInvoice: (invoiceId: number) => void
  /** داستان‌های امن مصرف اعتبار؛ کد قابل مصرف هرگز به این پنل گزارش نمی‌رسد. */
  creditUsedStories?: { amount: number; safeText: string }[]
}

export const NonCashDrawer: React.FC<NonCashDrawerProps> = ({
  open,
  onToggle,
  expectedNonCash,
  exchangeRows,
  creditSources,
  loading = false,
  onOpenInvoice,
  creditUsedStories = []
}) => {
  const [activeTab, setActiveTab] = useState<'exchanges' | 'credits'>('exchanges')

  if (!open) return null

  // جمع مبالغ اقلام تعویضی
  const exchangeTotal = exchangeRows.reduce((sum, r) => sum + Number(r.returnTotal ?? 0), 0)
  // جمع مبالغ بارکدهای اعتبار مصرف‌شده
  const creditTotal = creditSources.reduce((sum, r) => sum + Number(r.amount ?? 0), 0)
  const totalCalculated = exchangeTotal + creditTotal
  const isExactMatch = totalCalculated === expectedNonCash

  return (
    <div className="bg-amber-50/70 border border-amber-300 rounded-lg p-3.5 my-2 text-slate-800 animate-in fade-in duration-150 print:hidden">
      {/* هدر آکاردئون */}
      <div className="flex items-center justify-between pb-2 mb-3 border-b border-amber-200 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📦</span>
          <div>
            <h4 className="font-bold text-sm text-amber-950">ریز فاکتورهای تسویه‌شده‌ی غیرنقدی</h4>
            <p className="text-xs text-amber-800">
              فاکتورهایی که تسویه شده‌اند اما بدون پول فیزیکی (تعویض کالا با کالا یا با بارکد اعتباری)
            </p>
          </div>
        </div>

        {/* دکمه‌های تب‌بندی داخلی */}
        <div className="flex items-center gap-1 bg-amber-100 p-0.5 rounded-lg border border-amber-300 text-xs">
          <button
            type="button"
            onClick={() => setActiveTab('exchanges')}
            className={`px-3 py-1 rounded font-bold transition-colors ${
              activeTab === 'exchanges' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-800 hover:text-amber-950'
            }`}
          >
            🔄 تعویض‌های کالا ({faDigits(exchangeRows.length)})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('credits')}
            className={`px-3 py-1 rounded font-bold transition-colors ${
              activeTab === 'credits' ? 'bg-white text-amber-950 shadow-xs' : 'text-amber-800 hover:text-amber-950'
            }`}
          >
            🎫 مصرف اعتبار خرید ({faDigits(creditSources.length)})
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-6 text-xs text-amber-900 font-medium">در حال بارگذاری ریز اسناد...</div>
      ) : (
        <div className="space-y-3">
          {/* تب تعویض کالا */}
          {activeTab === 'exchanges' && (
            <div className="overflow-x-auto">
              {exchangeRows.length === 0 ? (
                <div className="text-center py-5 text-xs text-slate-500 bg-white/70 rounded border border-amber-200">
                  در این بازه هیچ سند تعویض کالایی ثبت نشده است.
                </div>
              ) : (
                <table className="w-full text-xs text-right bg-white rounded-lg border border-amber-200 overflow-hidden shadow-xs">
                  <thead className="bg-amber-100 text-amber-950 font-bold border-b border-amber-200">
                    <tr>
                      <th className="p-2">فاکتور</th>
                      <th className="p-2">مشتری</th>
                      <th className="p-2">تاریخ</th>
                      <th className="p-2">کالای مرجوعی (پس‌داده)</th>
                      <th className="p-2">کالای جایگزین (برداشته)</th>
                      <th className="p-2 text-left">ارزش کالای برگشتی</th>
                      <th className="p-2 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {exchangeRows.map((ex) => (
                      <tr key={ex.returnId} className="hover:bg-amber-50/50 transition-colors">
                        <td className="p-2 font-mono font-bold text-slate-800">
                          #{ex.receiptNo || ex.invoiceId}
                        </td>
                        <td className="p-2 text-slate-700">{ex.customerName || 'مشتری عمومی'}</td>
                        <td className="p-2 text-slate-600" dir="ltr">
                          {ex.dateJalali} {ex.time}
                        </td>
                        <td className="p-2 text-slate-700 max-w-[200px] truncate" title={ex.returnedItems?.map((i) => `${i.name} (${i.qty} عدد)`).join('، ')}>
                          {ex.returnedItems?.map((i) => `${i.name} (×${i.qty})`).join('، ') || '—'}
                        </td>
                        <td className="p-2 text-slate-700 max-w-[200px] truncate" title={ex.replacementItems?.map((i) => `${i.name} (${i.qty} عدد)`).join('، ')}>
                          {ex.replacementItems?.map((i) => `${i.name} (×${i.qty})`).join('، ') || '—'}
                        </td>
                        <td className="p-2 text-left font-bold text-amber-950" dir="ltr">
                          {money(ex.returnTotal)} ریال
                        </td>
                        <td className="p-2 text-center">
                          <button
                            type="button"
                            onClick={() => onOpenInvoice(ex.invoiceId)}
                            className="btn btn-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-0.5 rounded"
                            title="مشاهده شناسنامه و پرداختی‌های فاکتور"
                          >
                            مشاهده فاکتور
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-50 font-bold border-t border-amber-200 text-amber-950">
                    <tr>
                      <td colSpan={5} className="p-2 text-right">جمع ارزش کالاهای تعویضی:</td>
                      <td className="p-2 text-left" dir="ltr">{money(exchangeTotal)} ریال</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}

          {/* تب مصرف اعتبار خرید؛ کد قابل مصرف عمداً نمایش داده نمی‌شود. */}
          {activeTab === 'credits' && (
            <div className="overflow-x-auto space-y-2">
              {creditSources.length === 0 ? (
                <div className="text-center py-5 text-xs text-slate-500 bg-white/70 rounded border border-amber-200">
                  در این بازه هیچ اعتباری روی فاکتورها مصرف نشده است.
                </div>
              ) : (
                <table className="w-full text-xs text-right bg-white rounded-lg border border-amber-200 overflow-hidden shadow-xs">
                  <thead className="bg-amber-100 text-amber-950 font-bold border-b border-amber-200">
                    <tr>
                      <th className="p-2">فاکتور</th>
                      <th className="p-2">عنوان امن</th>
                      <th className="p-2">تاریخ</th>
                      <th className="p-2 text-left">مبلغ اعتبار مصرف‌شده</th>
                      <th className="p-2 text-center">عملیات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {creditSources.map((cs, idx) => (
                      <tr key={`${cs.id}-${idx}`} className="hover:bg-amber-50/50 transition-colors">
                        <td className="p-2 font-mono font-bold text-slate-800">
                          {cs.receiptNo ? `#${cs.receiptNo}` : cs.invoiceId ? `#${cs.invoiceId}` : '—'}
                        </td>
                        <td className="p-2 text-slate-700 font-semibold">{cs.label}</td>
                        <td className="p-2 text-slate-600" dir="ltr">
                          {cs.dateJalali || '—'}
                        </td>
                        <td className="p-2 text-left font-bold text-amber-950" dir="ltr">
                          {money(cs.amount)} ریال
                        </td>
                        <td className="p-2 text-center">
                          {cs.invoiceId ? (
                            <button
                              type="button"
                              onClick={() => onOpenInvoice(cs.invoiceId!)}
                              className="btn btn-xs bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 font-bold px-2 py-0.5 rounded"
                              title="مشاهده شناسنامه و پرداختی‌های فاکتور"
                            >
                              مشاهده فاکتور
                            </button>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-amber-50 font-bold border-t border-amber-200 text-amber-950">
                    <tr>
                      <td colSpan={3} className="p-2 text-right">جمع کل اعتبار مصرف‌شده:</td>
                      <td className="p-2 text-left" dir="ltr">{money(creditTotal)} ریال</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              )}

              {/* داستان‌های متنی مصرف اعتبار اگر موجود باشد */}
              {creditUsedStories.length > 0 && (
                <div className="bg-white/80 p-2.5 rounded border border-amber-200 text-[11px] text-amber-900 space-y-1">
                  <span className="font-bold block mb-1">شرح امن مصرف اعتبارها:</span>
                  {creditUsedStories.map((story, i) => (
                    <div key={`${story.safeText}-${i}`} className="text-slate-700">
                      • {story.safeText}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* جمع‌بندی پایین آکاردئون */}
          <div className="bg-amber-100/90 border border-amber-300 rounded p-2 flex items-center justify-between text-xs flex-wrap gap-2">
            <div className="flex items-center gap-1.5 font-bold text-amber-950">
              <span>جمع کل تسویه‌های غیرنقدی (تعویض + کوپن):</span>
              <span className="font-mono text-sm" dir="ltr">
                {money(totalCalculated)} ریال
              </span>
            </div>

            {isExactMatch ? (
              <span className="text-emerald-800 font-bold bg-emerald-100 px-2 py-0.5 rounded flex items-center gap-1 border border-emerald-300">
                <span>✓</span>
                <span>کاملاً منطبق با رقم غیرنقدی اعلام‌شده ({money(expectedNonCash)} ریال)</span>
              </span>
            ) : (
              <span className="text-amber-900 font-bold bg-amber-200 px-2 py-0.5 rounded">
                مبلغ مورد انتظار: {money(expectedNonCash)} ریال
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
