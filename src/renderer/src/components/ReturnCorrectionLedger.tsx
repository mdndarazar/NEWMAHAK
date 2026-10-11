import { useEffect, useState } from 'react'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'

type CorrectionRow = {
  id: number
  returnId: number
  invoiceId: number | null
  originalDayJalali: string
  operationalDayJalali: string
  createdAtJalali: string
  createdAtTime: string
  reason: string
  cashRecovered: number
  cardRecovered: number
  cashPaidOut: number
  cardPaidOut: number
  unrecoveredAmount: number
  creditOutcome: string
  originalUser: string
  correctingUser: string
  approvingManager: string | null
  originalShiftId: number | null
  correctingShiftId: number | null
  effects: { type: string; amount: number; qty: number; variantId: number | null }[]
}

const effectLabel = (type: string) =>
  ({
    INVENTORY_OUT: 'خروج جبرانی از موجودی',
    CASH_RECOVERED: 'نقد بازیافتیِ کشو',
    CARD_RECOVERED: 'کارت/بانک بازیافتی',
    CASH_PAID_OUT: 'پرداخت نقدی جبرانی',
    CARD_PAID_OUT: 'پرداخت کارت/بانک جبرانی',
    CARD_TO_CARD_CANCELED: 'لغو درخواست کارت‌به‌کارتِ معلق',
    EXCHANGE_REPLACEMENT_IN: 'بازگشت کالای جایگزین به موجودی',
    UNRECOVERED_REFUND: 'مغایرت بازیافت‌نشده',
    UNPAID_EXCHANGE_PAYOUT: 'مابه‌التفاوتِ پرداخت‌نشده به مشتری',
    CREDIT_CANCELED_UNUSED: 'اعتبار مصرف‌نشده لغو شد',
    CREDIT_REMAINS_ACTIVE: 'اعتبار همچنان باقی است',
    CREDIT_CONSUMED: 'اعتبار مصرف شده است'
  } as Record<string, string>)[type] ?? type

/**
 * دفتر فقط‌خواندنیِ اثرهای جبرانی؛ این جدول عمداً کنار گزارش برگشت می‌آید تا
 * گزارش روز ثبت اولیه و روز جبران، هر دو قابل دیدن و قابل تطبیق باشند.
 */
export default function ReturnCorrectionLedger({ fromJalali, toJalali }: { fromJalali: string; toJalali: string }) {
  const [rows, setRows] = useState<CorrectionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setBusy(true)
    setError(null)
    void call<{ rows?: CorrectionRow[] }>(CH.saleReturnCorrectionList, { fromJalali, toJalali })
      .then((data) => alive && setRows(data?.rows ?? []))
      .catch((e: any) => alive && setError(String(e?.message ?? 'دفتر اصلاحات خوانده نشد.')))
      .finally(() => alive && setBusy(false))
    return () => { alive = false }
  }, [fromJalali, toJalali])

  return (
    <section className="card p-3 mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <h3 className="font-bold">دفتر اصلاحات جبرانی برگشت</h3>
          <p className="kbd mt-1">
            سند و اثر اولیه در روز/شیفت مبدأ باقی می‌ماند؛ اینجا فقط اثر جبرانی با کاربر و شیفتِ لحظه‌ی اصلاح دیده می‌شود.
          </p>
        </div>
        {busy && <span className="text-sm text-slate-500">در حال بارگذاری…</span>}
      </div>
      {error && <p className="text-red-600 whitespace-pre-line">{error}</p>}
      {!error && (
        <div className="overflow-auto">
          <table className="tbl text-sm min-w-[1100px]">
            <thead>
              <tr>
                <th>اصلاح</th>
                <th>سند مبدأ</th>
                <th>سمت مبدأ</th>
                <th>سمت جبرانی</th>
                <th>تأیید مدیر</th>
                <th>نقد بازیافتی</th>
                <th>کارت/بانک بازیافتی</th>
                <th>پرداخت جبرانی</th>
                <th>مغایرت</th>
                <th>اعتبار</th>
                <th>اثرها / دلیل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>#{faDigits(row.id)}<br /><span className="kbd">{faDigits(row.createdAtJalali)} {faDigits(row.createdAtTime)}</span></td>
                  <td>برگشت #{faDigits(row.returnId)}<br /><span className="kbd">روز {faDigits(row.originalDayJalali)}</span></td>
                  <td>{row.originalUser}<br /><span className="kbd">شیفت {row.originalShiftId == null ? '—' : faDigits(row.originalShiftId)}</span></td>
                  <td>{row.correctingUser}<br /><span className="kbd">روز {faDigits(row.operationalDayJalali)} · شیفت {row.correctingShiftId == null ? '—' : faDigits(row.correctingShiftId)}</span></td>
                  <td>{row.approvingManager ?? 'همان روز عملیاتی'}</td>
                  <td>{money(row.cashRecovered)}</td>
                  <td>{money(row.cardRecovered)}</td>
                  <td className={row.cashPaidOut || row.cardPaidOut ? 'text-rose-700 font-bold' : ''}>{money(row.cashPaidOut + row.cardPaidOut)}</td>
                  <td className={row.unrecoveredAmount ? 'text-red-700 font-bold' : ''}>{money(row.unrecoveredAmount)}</td>
                  <td>{row.creditOutcome}</td>
                  <td>
                    <div>{row.effects.map((effect) => `${effectLabel(effect.type)}${effect.qty ? ` (${faDigits(effect.qty)} عدد)` : effect.amount ? ` (${money(effect.amount)})` : ''}`).join(' · ') || 'بدون اثر'}</div>
                    <div className="kbd mt-1">{row.reason}</div>
                  </td>
                </tr>
              ))}
              {!busy && !rows.length && (
                <tr><td colSpan={11} className="text-center py-4 text-slate-500">در این بازه اصلاح جبرانی ثبت نشده است.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
