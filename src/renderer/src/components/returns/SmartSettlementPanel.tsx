import type { RefundMethodValue, ReturnGuidance } from '@shared/returnGuidance'
import GuidanceNotices from './GuidanceNotices'

export interface RefundChoiceDef {
  value: RefundMethodValue
  title: string
  hint: string
}

export const ALL_REFUND_CHOICES: RefundChoiceDef[] = [
  {
    value: 'NONE',
    title: 'بدون بازپرداخت (کاهش بدهی)',
    hint: 'هیچ نقدی خارج نمی‌شود؛ بدهی مشتری کسر و کالا به انبار بازمی‌گردد.'
  },
  {
    value: 'CARD_TO_CARD',
    title: 'کارت‌به‌کارت توسط مدیر',
    hint: 'پرداخت فوری انجام نمی‌شود؛ یک درخواست پرداخت برای تایید مدیر ثبت می‌شود.'
  },
  {
    value: 'CASH',
    title: 'بازپرداخت نقدی',
    hint: 'پول نقد از کشوی دخل خارج می‌شود و از موجودی انتظاری صندوق کم می‌گردد.'
  },
  {
    value: 'STORE_CREDIT',
    title: 'صدور اعتبار خرید بعدی',
    hint: 'بارکد اعتبار یک‌بارمصرف صادر می‌شود؛ اثر نقدی در دخل صفر است.'
  },
  {
    value: 'CARD',
    title: 'بازپرداخت کارتی (کارت‌خوان)',
    hint: 'به کارت مشتری برگشت؛ نیازمند تایید مدیر است (پوز امکان برگشت ندارد).'
  }
]

export default function SmartSettlementPanel({
  guidance,
  selectedMethod,
  onSelectMethod,
  onCardPosLocked
}: {
  guidance: ReturnGuidance | null
  selectedMethod: RefundMethodValue | null
  onSelectMethod: (method: RefundMethodValue) => void
  onCardPosLocked: () => void
}) {
  const methods = guidance?.methods

  return (
    <div className="space-y-2">
      {guidance?.notices && <GuidanceNotices notices={guidance.notices} />}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
        {ALL_REFUND_CHOICES.map((c) => {
          const avail = methods ? methods[c.value] : { state: 'ALLOWED' }
          const isSelected = selectedMethod === c.value
          const isRecommended = avail?.state === 'RECOMMENDED'
          const isBlocked = avail?.state === 'BLOCKED'
          const isManagerOnly = avail?.state === 'MANAGER_ONLY'

          let containerClass = 'border-slate-200 bg-white hover:border-slate-300'
          if (isBlocked) {
            containerClass = 'border-slate-200 bg-slate-100 opacity-60 cursor-not-allowed'
          } else if (isSelected) {
            containerClass = 'border-emerald-500 bg-emerald-50 shadow-sm'
          } else if (isRecommended) {
            containerClass = 'border-emerald-300 bg-emerald-50/40 hover:border-emerald-400'
          } else if (isManagerOnly) {
            containerClass = 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
          }

          const handleClick = () => {
            if (isBlocked) return
            if (c.value === 'CARD' && isManagerOnly) {
              onCardPosLocked()
              return
            }
            onSelectMethod(c.value)
          }

          return (
            <div
              key={c.value}
              onClick={handleClick}
              className={`relative flex flex-col justify-between p-2.5 rounded border-2 transition-all cursor-pointer ${containerClass}`}
            >
              <div>
                <div className="flex items-center justify-between gap-1 mb-1">
                  <div className="flex items-center gap-1.5 font-bold text-xs text-slate-800">
                    <input
                      type="radio"
                      className="w-3.5 h-3.5"
                      checked={isSelected}
                      disabled={isBlocked}
                      onChange={() => {}}
                    />
                    <span>{c.title}</span>
                  </div>
                  {isRecommended && (
                    <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-extrabold border border-emerald-300">
                      ★ پیشنهاد سیستم
                    </span>
                  )}
                  {isManagerOnly && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300">
                      🔒 با تایید مدیر
                    </span>
                  )}
                  {isBlocked && (
                    <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 text-[10px] font-bold">
                      ⛔ غیرمجاز
                    </span>
                  )}
                </div>

                <div className="text-[11px] leading-4 text-slate-600">
                  {c.hint}
                </div>
              </div>

              {avail && 'reason' in avail && avail.reason && isBlocked && (
                <div className="mt-2 text-[10px] leading-4 text-rose-700 font-medium border-t pt-1">
                  {avail.reason}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
