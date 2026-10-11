import { useEffect, useState } from 'react'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'
import type { CreditSettlementLineageView } from '@shared/types'

/**
 * نمای فقط‌خواندنیِ کلیک «تسویه با اعتبار خرید» در گزارش فروش.
 *
 * قرارداد endpoint عمداً کوچک و مالی است: مبلغ/تاریخ مصرف، مرجع امن اعتبار و
 * رویداد صدور را می‌گیرد؛ نه کد قابل‌مصرف، نه legacyCode و نه تلفن/نشانی/شناسه
 * دارنده یا یادداشت آزاد. reveal کد فقط مسیر manager-authorized جداگانه دارد.
 */
export default function CreditSettlementModal({ open, invoiceId, onClose }: { open: boolean; invoiceId: number | null; onClose: () => void }) {
  const [view, setView] = useState<CreditSettlementLineageView | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !invoiceId) {
      setView(null)
      setErr(null)
      return
    }
    let alive = true
    setErr(null)
    void call<CreditSettlementLineageView>(CH.saleCreditSettlementLineage, { invoiceId })
      .then((next) => alive && setView(next))
      .catch((error) => alive && setErr(String(error?.message ?? error)))
    return () => { alive = false }
  }, [open, invoiceId])

  return (
    <Modal open={open} title={`زنجیرهٔ تسویه با اعتبار خرید${view ? ` — فیش ${faDigits(view.receiptNo)}` : ''}`} onClose={onClose} width="max-w-5xl">
      {err ? <div className="rounded border border-rose-300 bg-rose-50 p-3">{err}</div> : !view ? <div className="kbd py-8 text-center">در حال دریافت…</div> : (
        <div className="space-y-3">
          <div className="rounded border border-violet-300 bg-violet-50 p-3 text-sm leading-7">
            <b>نمای فقط‌خواندنیِ زنجیرهٔ مالی اعتبار</b>
            <div>فیش مقصد: {faDigits(view.receiptNo)} · جمع تسویه با اعتبار: {money(view.totalAmount)} ریال</div>
            <div className="text-slate-700">هر ردیف مسیر صدورِ یک اعتبار تا مصرفش روی همین فیش را نشان می‌دهد؛ این مبلغ وجه نقد یا کارت‌خوان نیست.</div>
          </div>
          <table className="tbl">
            <thead><tr><th>اعتبار</th><th>مبلغ مصرف</th><th>تاریخ/ساعت مصرف</th><th>منشأ و تاریخ صدور</th><th>انقضا</th><th>وضعیت و ماندهٔ فعلی</th></tr></thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={`${row.redemptionId ?? 'legacy'}-${row.paymentId ?? row.credit.id}`}>
                  <td dir="ltr" className="font-bold">{row.credit.publicReference}</td>
                  <td>{money(row.amount)}</td>
                  <td>{faDigits(row.redeemedAtJalali)} · {faDigits(row.redeemedAtTime)}</td>
                  <td>{row.credit.sourceLabel} · {faDigits(row.credit.issuedAtJalali)}</td>
                  <td>{row.credit.expiresAtJalali ? faDigits(row.credit.expiresAtJalali) : 'بدون انقضا'}</td>
                  <td>{row.credit.statusLabel} · مانده {money(row.credit.remaining)}</td>
                </tr>
              ))}
              {!view.rows.length && <tr><td colSpan={6} className="py-8 text-center text-slate-400">رکورد تسویهٔ اعتبارِ قابل‌ردیابی برای این فاکتور پیدا نشد.</td></tr>}
            </tbody>
          </table>
          <div className="kbd">کد قابل‌مصرف، کد تاریخی، اطلاعات دارنده و یادداشت‌های خصوصی در این نمای گزارش نمایش داده نمی‌شوند.</div>
        </div>
      )}
    </Modal>
  )
}
