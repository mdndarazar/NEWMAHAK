import { useEffect, useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import { call, CH } from '../lib/api'
import { isPrintCancelledError, isUnknownPrintMessage } from '../lib/printErrors'
import { faDigits, money } from '@shared/jalali'
import { creditPrintOpRequest } from '@shared/creditUi'
import {
  overpayFlowNext,
  overpayFlowPassword,
  OVERPAY_NOT_CASHABLE,
  type OverpayFlowState,
  type OverpayRequest,
  type OverpayCreditLike
} from '@shared/overpayFlow'

/**
 * ===========================================================================
 * نشست ۶۲ · بند ۴-۳۵ / ۴-۵۵ — دیالوگ‌های فلوی چهارمرحله‌ای «اضافه‌دریافت».
 *
 * یک جزء مشترک برای دو صفحه (پنجره‌ی «پرداختی‌ها / اقساط» و «فاکتور فروش
 * عمده») تا فلو یکسان بماند. تصمیم «کدام سؤال، به چه ترتیب، با چه درخواستی»
 * در `@shared/overpayFlow` است؛ این جزء فقط نمایش می‌دهد و درخواست آماده را
 * به صفحه‌ی میزبان پس می‌دهد (`onSubmit`).
 *
 *   مرحله ۱ ⇒ ConfirmDialog «بله، ثبت کن / انصراف» (متن هشدار از سرور)
 *   مرحله ۲ ⇒ «کد اعتبار خرید برای مبلغ اضافه صادر بشود؟» سه دکمه:
 *             بله (صدور + چاپ) · نه (فقط ردیف دریافت پول اضافه) · انصراف
 *             بستن پنجره/Esc = انصراف کامل، نه «ثبت بدون کد».
 *   رمز   ⇒ فقط وقتی سرور برای سقف اعتبار رمز مدیر خواست.
 *   مرحله ۳ ⇒ نمایش کد + «غیرقابل نقد شدن» + چاپ دوباره.
 * ===========================================================================
 */

export type OverpayCreditPrintProblem = { kind: 'unknown' | 'failed' | 'warning'; msg: string } | null

let overpayCreditPrintInFlight = false

/** چاپ کد اعتبار از همان کانال چاپ اسناد اعتبار؛ خطا/هشدار ⇒ پیام فارسی (سند صادرشده دست نمی‌خورد). */
export async function printOverpayCredit(credit: { id?: number | null } | null | undefined): Promise<OverpayCreditPrintProblem> {
  const req = creditPrintOpRequest('print', { id: credit?.id ?? 0, copies: 1 })
  if (!req) return { kind: 'failed', msg: 'شناسه‌ی اعتبار برای چاپ در دسترس نیست؛ از «مدیریت اعتبار خرید» چاپ کنید.' }
  if (overpayCreditPrintInFlight)
    return { kind: 'failed', msg: 'چاپ کد اعتبار در حال انجام است؛ تا پایان دیالوگ چاپ صبر کنید.' }
  overpayCreditPrintInFlight = true
  try {
    const res = (await call(CH[req.channel as keyof typeof CH], req.payload)) as { warnings?: string[] } | null | undefined
    const warnings = Array.isArray(res?.warnings) ? res.warnings.filter(Boolean) : []
    if (warnings.length) return { kind: 'warning', msg: warnings.join('\n') }
    return null
  } catch (e: any) {
    if (isPrintCancelledError(e)) return null
    if (isUnknownPrintMessage(e))
      return { kind: 'unknown', msg: `کد اعتبار صادر شد، اما معلوم نیست چاپ شده باشد: ${e.message} قبل از چاپ دوباره خروجی چاپگر را ببینید.` }
    return { kind: 'failed', msg: `کد اعتبار صادر شده ولی چاپ نشد: ${e.message} · از «چاپ دوباره‌ی کد» استفاده کنید.` }
  } finally {
    overpayCreditPrintInFlight = false
  }
}

export default function OverpayFlowDialogs({
  flow,
  busy,
  onFlow,
  onSubmit,
  onPassword,
  issuedCredit,
  onCloseIssued,
  onReprint,
  creditPrinting = false,
  creditPrintProblem = null
}: {
  flow: OverpayFlowState | null
  busy: boolean
  onFlow: (next: OverpayFlowState | null) => void
  /** درخواست آماده‌ی مرحله‌ی submit (confirmOverpay / overpayAsCredit / managerPassword) */
  onSubmit: (req: OverpayRequest) => void
  /** اختیاری: مسیر رمز غیر از «تکرار همان درخواست» (مثلاً دکمه‌ی صدور از اضافه‌دریافت موجود) */
  onPassword?: (password: string) => void
  issuedCredit: (OverpayCreditLike & { id?: number }) | null
  onCloseIssued: () => void
  onReprint: () => void
  /** چاپ خودکار/دوباره‌ی همین کد در جریان است؛ برای جلوگیری از چند دیالوگ پشت‌سرهم. */
  creditPrinting?: boolean
  /** پیام چاپ همین کد داخل همین modal، تا پشت overlay پنهان نشود. */
  creditPrintProblem?: OverpayCreditPrintProblem
}) {
  const [pw, setPw] = useState('')
  useEffect(() => {
    if (flow?.step !== 'password') setPw('')
  }, [flow?.step])

  const answer = (a: 'yes' | 'no' | 'cancel') => {
    if (!flow) return
    const next = overpayFlowNext(flow, a)
    onFlow(next.step === 'idle' ? null : next)
    if (next.step === 'submit' && next.request) onSubmit(next.request)
  }

  return (
    <>
      <ConfirmDialog
        open={flow?.step === 'confirm'}
        title="مبلغ بیشتر از بدهی / جمع فاکتور است"
        message={
          <div className="space-y-2">
            <div className="whitespace-pre-line">{flow?.message}</div>
            <p className="kbd">
              با تایید، <b>کل مبلغ واردشده</b> ثبت می‌شود و مقدار اضافه هرگز بی‌صدا نمی‌ماند: یا کد اعتبار خرید می‌شود،
              یا ردیف جدای «دریافت پول اضافه» در گزارش.
            </p>
          </div>
        }
        confirmLabel="بله، ثبت کن"
        cancelLabel="انصراف"
        busy={busy}
        onConfirm={() => answer('yes')}
        onCancel={() => answer('cancel')}
      />

      <Modal
        open={flow?.step === 'askCredit'}
        title="کد اعتبار خرید برای مبلغ اضافه صادر بشود؟"
        width="max-w-md"
        onClose={() => answer('cancel')}
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => answer('cancel')}>
              انصراف (هیچ چیز ثبت نشود)
            </button>
            <button className="btn" disabled={busy} onClick={() => answer('no')}>
              نه، فقط پول اضافه ثبت شود
            </button>
            <button className="btn btn-primary" disabled={busy} onClick={() => answer('yes')}>
              بله، کد اعتبار صادر و چاپ شود
            </button>
          </>
        }
      >
        <div className="leading-7 space-y-2">
          <p>
            <b>بله</b>: کل پول ثبت می‌شود و به اندازه‌ی مبلغ اضافه یک کد اعتبار خرید صادر و چاپ می‌شود (
            {OVERPAY_NOT_CASHABLE}، فقط برای خرید کالا).
          </p>
          <p>
            <b>نه</b>: چیزی چاپ نمی‌شود و مبلغ اضافه در گزارشات فروش یک ردیف جدا «دریافت پول اضافه» می‌گیرد.
          </p>
        </div>
      </Modal>

      <Modal
        open={flow?.step === 'password'}
        title="تایید مدیر برای صدور اعتبار بالاتر از سقف"
        width="max-w-md"
        onClose={() => onFlow(null)}
        footer={
          <>
            <button className="btn" disabled={busy} onClick={() => onFlow(null)}>
              انصراف
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !pw}
              onClick={() => {
                if (!flow) return
                if (onPassword) return onPassword(pw)
                const next = overpayFlowPassword(flow, pw)
                onFlow(next)
                if (next.request) onSubmit(next.request)
              }}
            >
              تایید و ادامه
            </button>
          </>
        }
      >
        <div className="leading-7 space-y-2">
          <div className="whitespace-pre-line">{flow?.message}</div>
          <input
            type="password"
            className="inp"
            autoFocus
            value={pw}
            placeholder="رمز مدیر"
            onChange={(e) => setPw(e.target.value)}
          />
        </div>
      </Modal>

      <Modal
        open={!!issuedCredit}
        title="کد اعتبار خرید صادر شد"
        width="max-w-md"
        onClose={() => {
          if (!creditPrinting) onCloseIssued()
        }}
        footer={
          <>
            <button className="btn" onClick={onReprint} disabled={busy || creditPrinting || creditPrintProblem?.kind === 'warning'}>
              {creditPrinting
                ? 'در حال چاپ…'
                : creditPrintProblem?.kind === 'warning'
                  ? 'چاپ انجام شده؛ دوباره چاپ نکنید'
                  : creditPrintProblem?.kind === 'unknown'
                    ? 'فقط اگر برگه‌ای بیرون نیامده: چاپ دوباره'
                    : 'چاپ دوباره‌ی کد'}
            </button>
            <button className="btn btn-primary" onClick={onCloseIssued} disabled={creditPrinting}>
              {creditPrinting ? 'تا پایان چاپ صبر کنید…' : 'بستن'}
            </button>
          </>
        }
      >
        <div className="leading-8 text-center space-y-1">
          <div className="text-2xl font-bold tracking-widest" dir="ltr">
            {issuedCredit?.code}
          </div>
          <div className="font-bold">{money(issuedCredit?.amount ?? 0)} ریال</div>
          <div className="kbd">
            {issuedCredit?.expiresAtJalali ? `مهلت تا ${faDigits(issuedCredit.expiresAtJalali)}` : 'بدون انقضا'}
          </div>
          <div className="font-bold text-rose-700">{OVERPAY_NOT_CASHABLE}</div>
          {creditPrintProblem && (
            <div
              className={`mt-3 rounded border px-3 py-2 text-sm leading-7 ${
                creditPrintProblem.kind === 'unknown' || creditPrintProblem.kind === 'warning'
                  ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : 'border-rose-300 bg-rose-50 text-rose-800'
              }`}
            >
              {creditPrintProblem.msg}
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
