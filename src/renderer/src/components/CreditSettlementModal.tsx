import { useEffect, useState } from 'react'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'
import type { InvoicePaymentsView } from '@shared/types'

/**
 * نمای فقط‌خواندنیِ کلیک «تسویه با اعتبار خرید» در گزارش فروش.
 * عمداً از DTO استاندارد و redacted پرداخت استفاده می‌کند: هیچ فرم mutation،
 * code، reference خام یا مسیر reveal اینجا وجود ندارد.
 */
export default function CreditSettlementModal({ open, invoiceId, onClose }: { open: boolean; invoiceId: number | null; onClose: () => void }) {
  const [view, setView] = useState<InvoicePaymentsView | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !invoiceId) {
      setView(null)
      setErr(null)
      return
    }
    let alive = true
    setErr(null)
    void call<InvoicePaymentsView>(CH.salePayments, { invoiceId })
      .then((next) => alive && setView(next))
      .catch((error) => alive && setErr(String(error?.message ?? error)))
    return () => { alive = false }
  }, [open, invoiceId])

  const credits = (view?.payments ?? []).filter((payment) => payment.isStoreCredit)
  const creditTotal = credits.reduce((sum, payment) => sum + payment.amount, 0)
  return (
    <Modal open={open} title={`جزئیات تسویه با اعتبار خرید${view ? ` — فیش ${faDigits(view.receiptNo)}` : ''}`} onClose={onClose} width="max-w-4xl">
      {err ? <div className="rounded border border-rose-300 bg-rose-50 p-3">{err}</div> : !view ? <div className="kbd py-8 text-center">در حال دریافت…</div> : (
        <div className="space-y-3">
          <div className="rounded border border-violet-300 bg-violet-50 p-3 text-sm leading-7">
            <b>نمای فقط‌خواندنی تسویه با اعتبار خرید</b>
            <div>فاکتور {faDigits(view.receiptNo)} · {view.customerName} · تاریخ {faDigits(view.dateJalali)}</div>
            <div>جمع فاکتور: {money(view.grandTotal)} · نقد/کارت ثبت‌شده: {money(Math.max(0, view.paidTotal - creditTotal))} · اعتبار خرید: {money(creditTotal)} · باقی‌مانده: {money(view.remaining)} ریال</div>
          </div>
          <table className="tbl">
            <thead><tr><th>#</th><th>مبلغ اعتبار</th><th>تاریخ</th><th>ساعت</th><th>منشأ امن</th><th>وضعیت</th></tr></thead>
            <tbody>
              {credits.map((payment) => <tr key={payment.id}><td>{faDigits(payment.seq)}</td><td>{money(payment.amount)}</td><td>{faDigits(payment.dateJalali)}</td><td>{faDigits(payment.time)}</td><td>اعتبار خرید مصرف‌شده</td><td>تسویه شد</td></tr>)}
              {!credits.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">رکورد اعتبار خریدی برای این فاکتور پیدا نشد.</td></tr>}
            </tbody>
          </table>
          <div className="kbd">کد قابل‌مصرف اعتبار در گزارش و این پنجره نمایش داده نمی‌شود. برای مشاهدهٔ کد، فقط مسیر مستقل و مجاز مدیر وجود دارد.</div>
        </div>
      )}
    </Modal>
  )
}
