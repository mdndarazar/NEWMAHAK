import { useCallback, useEffect, useState } from 'react'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { exportTable } from '../lib/exportCsv'
import { faDigits, money } from '@shared/jalali'
import type { ShiftDetailResult } from '@shared/types'
/** کار الف — سه ستون مقصد پول؛ تنها جای تبدیل عدد سرور به ستون جدول */
import {
  cardOnlyOf,
  managerAccountOf,
  otherOrUnknownOf,
  destinationCells,
  DESTINATION_HEADERS_SHORT,
  DESTINATION_COLUMNS_NOTE
} from '../lib/destinationCells'
import { MANAGER_ACCOUNT_ROW_LABEL, MANAGER_ACCOUNT_ROW_NOTE, PaymentDestination } from '@shared/enums'

/**
 * ===========================================================================
 * مورد ۵ — «جزئیات کامل یک جلسه/شیفت بسته‌شده» (ماژول بستن صندوق).
 *
 * روی هر ردیف سابقه‌ی بستن صندوق یک دکمه‌ی «جزئیات» هست که همین پنجره را باز
 * می‌کند. محتوایش همان چیزی است که گزارشات فروش برای یک بازه‌ی دلخواه نشان
 * می‌دهد، ولی **قفل‌شده روی همان یک شیفت**:
 *
 *   ۱) همه‌ی فاکتورهای فروش آن شیفت، با مبلغ و تفکیک نوع تسویه،
 *   ۲) همه‌ی برگشت‌ها و تعویض‌های همان شیفت (با اقلام و نحوه‌ی تسویه‌ی مابه‌التفاوت)،
 *   ۳) هر مبلغ نسیه‌ی ثبت‌شده در همان شیفت (باقی‌ماندهٔ بدهی فاکتورها)،
 *   ۴) جمع‌بندی نهایی همان شیفت.
 *
 * همه‌ی عددها از `shift:detail` می‌آید که خودش همان سرویس‌های همیشگی گزارشات را
 * با فیلتر شیفت صدا می‌زند، پس هیچ محاسبه‌ای اینجا تکرار (و هیچ‌وقت واگرا)
 * نمی‌شود. این پنجره فقط‌خواندنی است و هیچ دکمه‌ی تغییردهنده‌ای ندارد.
 * ===========================================================================
 */

const SALE_HEADERS = [
  'شماره فیش',
  'تاریخ',
  'ساعت',
  'خریدار',
  'وضعیت',
  'کاربر ثبت‌کننده',
  'جمع کالا',
  'تخفیف',
  'عوارض و مالیات',
  'حق سرویس',
  'جمع کل',
  'نقدی',
  ...DESTINATION_HEADERS_SHORT,
  'اعتباری',
  'باقی‌ماندهٔ نسیه',
  'نوع تسویه'
]

/** برچسب «نوع تسویه» یک فاکتور، از روی همان عددهای خودش. */
function settlementLabelOf(r: ShiftDetailResult['sales']['rows'][number]): string {
  const parts: string[] = []
  if (r.cashTotal > 0) parts.push('نقدی')
  if (cardOnlyOf(r) > 0) parts.push('کارت')
  /** کار الف: «حساب مدیر» برچسب خودش را دارد، چون پولش به فروشگاه نرسیده */
  if (managerAccountOf(r) > 0) parts.push('حساب مدیر')
  if (otherOrUnknownOf(r) > 0) parts.push('سایر / نامشخص')
  if (r.creditTotal > 0) parts.push('اعتباری')
  if (r.storeCreditTotal > 0) parts.push('اعتبار خرید')
  if (r.exchangeCreditTotal > 0) parts.push('ارزش کالای برگشتی')
  if (r.remaining > 0) parts.push('نسیه (باقی‌مانده)')
  return parts.length ? parts.join(' + ') : 'بدون پرداختی'
}

export default function ShiftDetailModal({
  open,
  shiftId,
  cashSessionId,
  fromJalali,
  toJalali,
  onClose
}: {
  open: boolean
  /** شیفت مشخص (اولویت اول) */
  shiftId?: number | null
  /** رکورد بستن صندوق؛ شیفت و بازه‌اش از همین رکورد خوانده می‌شود */
  cashSessionId?: number | null
  /** فقط برای رکوردهای «بازه‌ای» که به هیچ شیفتی وصل نیستند */
  fromJalali?: string
  toJalali?: string
  onClose: () => void
}) {
  const [data, setData] = useState<ShiftDetailResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setErr(null)
    try {
      setData(await call<ShiftDetailResult>(CH.shiftDetail, { shiftId, cashSessionId, fromJalali, toJalali }))
    } catch (e: any) {
      setErr(e.message)
      setData(null)
    } finally {
      setBusy(false)
    }
  }, [shiftId, cashSessionId, fromJalali, toJalali])

  useEffect(() => {
    if (!open) {
      setData(null)
      setErr(null)
      setMsg(null)
      return
    }
    void load()
  }, [open, load])

  const t = data?.sales.totals
  /**
   * مورد ۶ — پرداختی‌های دریافت‌شده در همین شیفت. عمداً با مقدار پیش‌فرض خوانده
   * می‌شود: اگر نسخه‌ی سرور این فیلدها را برنگرداند (یا خطایی رخ دهد)، این بخش
   * فقط خالی نشان داده می‌شود و بقیه‌ی پنجره مثل قبل کار می‌کند.
   */
  const payRows = data?.shiftPayments ?? []
  const payTotals =
    data?.shiftPaymentTotals ?? {
      count: payRows.length,
      total: 0,
      priorTotal: 0,
      priorCount: 0,
      pendingChequeTotal: 0,
      /**
       * کار الف: چهار عدد تازه هم باید در همین پیش‌فرض باشند، وگرنه با نسخه‌ی
       * قدیمی‌ترِ سرور (یا خطای شبکه) این بخش به `undefined` می‌خورد و کل پنجره
       * سفید می‌شود. جمع این چهار = `total`.
       */
      cashTotal: 0,
      cardTotal: 0,
      managerTotal: 0,
      unknownTotal: 0
    }
  const saleRowValues = (r: ShiftDetailResult['sales']['rows'][number]) => [
    r.receiptNo,
    r.dateJalali,
    r.time,
    r.customerName,
    r.statusLabel,
    r.userName,
    r.goodsTotal,
    r.discountTotal,
    r.taxTotal,
    r.serviceCharge,
    r.grandTotal,
    r.cashTotal,
    ...destinationCells(r),
    r.creditTotal,
    r.remaining,
    settlementLabelOf(r)
  ]

  return (
    <Modal
      open={open}
      title={`جزئیات کامل شیفت${data ? ` — ${data.scopeLabel}` : ''}`}
      onClose={onClose}
      width="max-w-7xl"
      footer={
        <>
          <button
            className="btn"
            disabled={!data || !data.sales.rows.length}
            onClick={() =>
              void exportTable({
                fileName: 'جزئیات-شیفت',
                headers: SALE_HEADERS,
                rows: (data?.sales.rows ?? []).map(saleRowValues)
              })
                .then((res) => setMsg(res.canceled ? 'خروجی لغو شد' : `فایل خروجی ساخته شد: ${res.path}`))
                .catch((e: any) => setErr(e.message))
            }
          >
            خروجی اکسل فاکتورهای این شیفت
          </button>
          <button className="btn" onClick={() => void load()} disabled={busy}>
            {busy ? 'در حال خواندن…' : 'تازه‌سازی'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            بستن
          </button>
        </>
      }
    >
      {err && <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">{err}</div>}
      {msg && <div className="rounded px-3 py-2 border bg-emerald-50 border-emerald-300">{msg}</div>}
      {busy && !data && <div className="text-center py-10 text-slate-400">در حال خواندن جزئیات این شیفت…</div>}

      {data && t && (
        <>
          {/* ---------------- سربرگ: همین شیفت و رکورد بستن صندوقش ---------------- */}
          <div className="rounded border-2 border-brand/40 bg-brand/5 p-2 leading-7">
            <b>{data.scopeLabel}</b>
            <div className="kbd leading-6">
              این پنجره فقط‌خواندنی است و کاملاً روی همین یک شیفت قفل شده است؛ هیچ فاکتوری از شیفت‌های دیگر در عددهای
              زیر شمرده نمی‌شود. پس می‌توانید عملکرد کارمند همین شیفت را جداگانه بررسی کنید.
            </div>
            {data.session && (
              <div className="kbd leading-6">
                رکورد بستن صندوق: {faDigits(data.session.dayJalali)}
                {data.session.toClock ? ` ساعت ${faDigits(data.session.toClock)}` : ''} · جمع ثبت‌شده{' '}
                {money(data.session.grandTotal)} ریال · {faDigits(data.session.invoiceCount)} فاکتور
                {data.session.countedTotal != null
                  ? ` · شمارش دستی کشو ${money(data.session.countedTotal)}`
                  : ' · شمارش دستی ثبت نشده'}
                {data.session.note ? ` · یادداشت: ${data.session.note}` : ''}
              </div>
            )}
            {/*
              🔴 نشست ۱۸۴ · بند ۴-۵۶ — دو عدد جدا، با برچسب صریح.
              قبلاً یک «اختلاف» نمایش داده می‌شد که فروش کارتی را از پول فیزیکی
              کشو کم می‌کرد و کسری دروغ می‌ساخت. حالا «پول کشو» و «جمع تسویه‌ی
              فاکتورها» جدا دیده می‌شوند و اختلاف فقط درباره‌ی کشوست.
            */}
            {data.session && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="border rounded p-2">
                  <div className="kbd">پول فیزیکی کشو (انتظاری)</div>
                  <b>{data.session.expectedCash == null ? '—' : `${money(data.session.expectedCash)} ریال`}</b>
                </div>
                <div className="border rounded p-2">
                  <div className="kbd">جمع تسویه‌ی فاکتورها (نقد + کارت + اعتباری)</div>
                  <b>{money(data.session.settledTotal)} ریال</b>
                  <div className="kbd">این عدد پولِ داخل کشو نیست؛ کارت و اعتباری هم در آن هست.</div>
                </div>
                <div className="border rounded p-2">
                  <div className="kbd">اختلاف کشو (شمارش − انتظاری)</div>
                  {data.session.diffAvailable ? (
                    <b className={(data.session.diff ?? 0) < 0 ? 'text-red-600' : ''}>
                      {money(data.session.diff ?? 0)} ریال
                    </b>
                  ) : (
                    <b className="kbd">
                      برای این سابقه محاسبه‌پذیر نیست (پیش از نسخه‌ای که «نقد مورد انتظار» را ذخیره می‌کند).
                    </b>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ---------------- ۱) فاکتورهای فروش این شیفت ---------------- */}
          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">
              فاکتورهای فروش این شیفت ({faDigits(data.sales.rows.length)} فاکتور)
            </h3>
            <div className="border border-slate-200 rounded overflow-auto max-h-[38vh]">
              <table className="tbl">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    {SALE_HEADERS.map((h) => (
                      <th key={h}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sales.rows.map((r) => (
                    <tr key={r.id} className={r.remaining > 0 ? 'bg-amber-50' : ''}>
                      <td className="font-bold">{faDigits(r.receiptNo)}</td>
                      <td>{faDigits(r.dateJalali)}</td>
                      <td>{faDigits(r.time)}</td>
                      <td>{r.customerName}</td>
                      <td>{r.statusLabel}</td>
                      <td>{r.userName}</td>
                      <td>{money(r.goodsTotal)}</td>
                      <td>{money(r.discountTotal)}</td>
                      <td>{money(r.taxTotal)}</td>
                      <td>{money(r.serviceCharge)}</td>
                      <td className="font-bold">{money(r.grandTotal)}</td>
                      <td>{money(r.cashTotal)}</td>
                      <td>{money(cardOnlyOf(r))}</td>
                      <td
                        className={managerAccountOf(r) > 0 ? 'text-amber-800 font-bold' : ''}
                        title={managerAccountOf(r) > 0 ? MANAGER_ACCOUNT_ROW_NOTE : undefined}
                      >
                        {money(managerAccountOf(r))}
                      </td>
                      <td>{money(otherOrUnknownOf(r))}</td>
                      <td>{money(r.creditTotal)}</td>
                      <td className={r.remaining > 0 ? 'text-amber-800 font-bold' : ''}>{money(r.remaining)}</td>
                      <td className="whitespace-normal">{settlementLabelOf(r)}</td>
                    </tr>
                  ))}
                  {!data.sales.rows.length && (
                    <tr>
                      <td colSpan={SALE_HEADERS.length} className="text-center py-6 text-slate-400">
                        در این شیفت فاکتور فروشی ثبت نشده است
                      </td>
                    </tr>
                  )}
                </tbody>
                {!!data.sales.rows.length && (
                  <tfoot className="sticky bottom-0">
                    <tr className="bg-slate-100 font-bold">
                      <td colSpan={6}>جمع {faDigits(t.count)} فاکتور</td>
                      <td>{money(t.goodsTotal)}</td>
                      <td>{money(t.discountTotal)}</td>
                      <td>{money(t.taxTotal)}</td>
                      <td>{money(t.serviceTotal)}</td>
                      <td>{money(t.grandTotal)}</td>
                      <td>{money(t.cashTotal)}</td>
                      <td>{money(cardOnlyOf(t))}</td>
                      <td className={managerAccountOf(t) > 0 ? 'text-amber-800' : ''}>{money(managerAccountOf(t))}</td>
                      <td>{money(otherOrUnknownOf(t))}</td>
                      <td>{money(t.creditTotal)}</td>
                      <td>{money(data.creditTotal)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ---------------- ۲) برگشت‌ها و تعویض‌های این شیفت ---------------- */}
          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">
              برگشت‌های ثبت‌شده در این شیفت ({faDigits(data.returns.length)} سند · جمع {money(data.returnsTotal)} ریال)
            </h3>
            <div className="border border-slate-200 rounded overflow-auto max-h-[30vh]">
              <table className="tbl">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th>نوع</th>
                    <th>فیش فروش</th>
                    <th>کد فاکتور</th>
                    <th>خریدار</th>
                    <th>تاریخ برگشت</th>
                    <th>ساعت</th>
                    <th>کامل؟</th>
                    <th>تعداد</th>
                    <th>برگشت به انبار</th>
                    <th>مبلغ برگشت</th>
                    <th>اقلام</th>
                    <th>یادداشت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.returns.map((r) => (
                    <tr key={r.id} className={r.isExchange ? 'bg-sky-50' : ''}>
                      <td className="font-bold">{r.isExchange ? 'تعویض' : 'برگشت'}</td>
                      <td>{r.receiptNo == null ? '—' : faDigits(r.receiptNo)}</td>
                      <td dir="ltr">{r.returnCode ?? '—'}</td>
                      <td>{r.customerName}</td>
                      <td>{faDigits(r.returnedAtJalali)}</td>
                      <td>{faDigits(r.time)}</td>
                      <td>{r.isFull ? 'کامل' : 'جزئی'}</td>
                      <td className="text-center">{faDigits(r.qty)}</td>
                      <td className="text-center">{faDigits(r.restockedQty)}</td>
                      <td className="font-bold">{money(r.total)}</td>
                      <td className="whitespace-normal">
                        {r.items.map((i) => `${i.name} × ${faDigits(i.qty)}`).join(' · ')}
                      </td>
                      <td className="whitespace-normal">{r.note}</td>
                    </tr>
                  ))}
                  {!data.returns.length && (
                    <tr>
                      <td colSpan={12} className="text-center py-6 text-slate-400">
                        در این شیفت هیچ برگشتی ثبت نشده است
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">
              تعویض‌های این شیفت ({faDigits(data.exchanges.totals.count)} سند · مابه‌التفاوت{' '}
              {money(data.exchanges.totals.diffTotal)} ریال)
            </h3>
            <div className="border border-slate-200 rounded overflow-auto max-h-[30vh]">
              <table className="tbl">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th>فیش فروش</th>
                    <th>فیش تعویض</th>
                    <th>تاریخ</th>
                    <th>ساعت</th>
                    <th>خریدار</th>
                    <th>کالای برگشتی</th>
                    <th>مبلغ برگشتی</th>
                    <th>کالای جایگزین</th>
                    <th>مبلغ جایگزین</th>
                    <th>مابه‌التفاوت</th>
                    <th>نحوه‌ی تسویه</th>
                    <th>نقد دریافتی</th>
                    <th>شناسهٔ امن اعتبار</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exchanges.rows.map((r) => (
                    <tr key={r.returnId}>
                      <td className="font-bold">{faDigits(r.receiptNo)}</td>
                      <td>{r.exchangeReceiptNo == null ? '—' : faDigits(r.exchangeReceiptNo)}</td>
                      <td>{faDigits(r.dateJalali)}</td>
                      <td>{faDigits(r.time)}</td>
                      <td>{r.customerName}</td>
                      <td className="whitespace-normal">
                        {r.returnedItems.map((i) => `${i.name} × ${faDigits(i.qty)}`).join(' · ')}
                      </td>
                      <td>{money(r.returnTotal)}</td>
                      <td className="whitespace-normal">
                        {r.replacementItems.map((i) => `${i.name} × ${faDigits(i.qty)}`).join(' · ')}
                      </td>
                      <td>{money(r.exchangeTotal)}</td>
                      <td className={r.diff < 0 ? 'text-amber-800 font-bold' : 'font-bold'}>{money(r.diff)}</td>
                      <td>{r.settlementLabel}</td>
                      <td>{money(r.cashReceived)}</td>
                      <td dir="ltr">
                        {r.storeCreditReference ? `${r.storeCreditReference} · ${money(r.storeCreditAmount)}` : '—'}
                      </td>
                    </tr>
                  ))}
                  {!data.exchanges.rows.length && (
                    <tr>
                      <td colSpan={13} className="text-center py-6 text-slate-400">
                        در این شیفت تعویضی ثبت نشده است
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ---------------- ۳) نسیه‌ی ثبت‌شده در همین شیفت ---------------- */}
          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">
              نسیه‌ی ثبت‌شده در این شیفت ({faDigits(data.creditRows.length)} فاکتور · باقی‌ماندهٔ بدهی{' '}
              {money(data.creditTotal)} ریال)
            </h3>
            <div className="border border-slate-200 rounded overflow-auto max-h-[26vh]">
              <table className="tbl">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th>فیش فروش</th>
                    <th>تاریخ</th>
                    <th>ساعت</th>
                    <th>خریدار</th>
                    <th>جمع کل فاکتور</th>
                    <th>دریافت‌شده</th>
                    <th>باقی‌ماندهٔ بدهی</th>
                    <th>وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {data.creditRows.map((r) => (
                    <tr key={`credit-${r.id}`} className="bg-amber-50">
                      <td className="font-bold">{faDigits(r.receiptNo)}</td>
                      <td>{faDigits(r.dateJalali)}</td>
                      <td>{faDigits(r.time)}</td>
                      <td>{r.customerName}</td>
                      <td>{money(r.grandTotal)}</td>
                      <td>{money(r.paidTotal)}</td>
                      <td className="text-amber-800 font-bold">{money(r.remaining)}</td>
                      <td>{r.paidTotal > 0 ? 'پرداخت جزئی' : 'پرداخت‌نشده'}</td>
                    </tr>
                  ))}
                  {!data.creditRows.length && (
                    <tr>
                      <td colSpan={8} className="text-center py-6 text-slate-400">
                        در این شیفت هیچ فاکتور نسیه‌ای ثبت نشده است (همه تسویه شده‌اند)
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="kbd leading-6">
              «نسیه» یعنی فاکتوری که باقی‌ماندهٔ بدهی دارد — یعنی <b>بدهیِ تازه‌ای</b> که در همین شیفت ساخته شده.
              پولی که در همین شیفت بابت فاکتورهای نسیه‌ی <b>قبلی</b> دریافت شده، در بخش بعدی («پرداختی‌های نسیه‌ی
              دریافت‌شده در این شیفت») فهرست شده است.
            </div>
          </section>

          {/* ---------------- ۳-ب) مورد ۶: پرداختی‌های دریافت‌شده در همین شیفت ---------------- */}
          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">
              پرداختی‌های نسیه‌ی دریافت‌شده در این شیفت ({faDigits(payTotals.count)} پرداختی · جمع دریافتی{' '}
              {money(payTotals.total)} ریال)
            </h3>
            <div className="kbd leading-6">
              هر پولی که <b>ساعتش داخل بازه‌ی همین شیفت</b> است، بدون توجه به تاریخ فاکتور اصلی. ردیف‌های زردرنگ بابت
              فاکتورهایی هستند که <b>قبل از شروع این شیفت</b> صادر شده‌اند (هفته‌ها یا ماه‌ها قبل) — یعنی پولی که در
              کشوی صندوق و روی دستگاه کارتخوان هست ولی در «جمع فروش این شیفت» شمرده نمی‌شود. همین بخش، اختلاف «جمع فروش
              سیستم» با «جمع واقعی دستگاه» را توضیح می‌دهد.
              <br />
              <b>چکِ پاس‌نشده پول نیست:</b> در فهرست دیده می‌شود ولی در جمع دریافتی شمرده نمی‌شود و باقی‌ماندهٔ بدهی را
              هم کم نمی‌کند.
            </div>
            <div className="border border-slate-200 rounded overflow-auto max-h-[30vh]">
              <table className="tbl">
                <thead className="sticky top-0 bg-white z-10">
                  <tr>
                    <th>فیش فاکتور اصلی</th>
                    <th>تاریخ فاکتور اصلی</th>
                    <th>ساعت فاکتور</th>
                    <th>خریدار</th>
                    <th>تاریخ دریافت</th>
                    <th>ساعت دریافت</th>
                    <th>پرداختی شماره</th>
                    <th>نوع</th>
                    <th>روش</th>
                    {/* کار الف: پول همین پرداختی کجا نشست (کارتخوان/کشو/حساب مدیر) */}
                    <th title={DESTINATION_COLUMNS_NOTE}>مقصد پول</th>
                    <th>مبلغ دریافتی</th>
                    <th>جمع کل فاکتور</th>
                    <th>باقی‌ماندهٔ بدهی بعد از این پرداخت</th>
                    <th>شرح</th>
                  </tr>
                </thead>
                <tbody>
                  {payRows.map((r) => (
                    <tr
                      key={`pay-${r.paymentId}`}
                      className={r.pendingCheque ? 'bg-sky-50' : r.fromPriorInvoice ? 'bg-amber-50' : ''}
                    >
                      <td className="font-bold">{faDigits(r.receiptNo)}</td>
                      <td>{faDigits(r.invoiceDateJalali)}</td>
                      <td>{faDigits(r.invoiceTime)}</td>
                      <td>{r.customerName}</td>
                      <td>{faDigits(r.paidAtJalali)}</td>
                      <td>{faDigits(r.paidAtTime)}</td>
                      <td className="text-center">{faDigits(r.seq)}</td>
                      <td>{r.kind === 'CHEQUE' ? (r.pendingCheque ? 'چک (پاس‌نشده)' : 'چک (پاس‌شده)') : 'دریافت نقدی/کارتی'}</td>
                      <td>{r.methodLabel}</td>
                      {/**
                        * کار الف — مقصد پول. چکِ پاس‌نشده عمداً «—» می‌گیرد (هنوز
                        * پولی جابه‌جا نشده)؛ داده‌ی قدیمی «نامشخص» می‌شود و هیچ
                        * حدسی جایش نمی‌نشیند.
                        */}
                      <td
                        className={
                          r.destination === PaymentDestination.MANAGER
                            ? 'text-amber-800 font-bold'
                            : r.destination
                              ? ''
                              : 'text-slate-500'
                        }
                        title={r.destination === PaymentDestination.MANAGER ? MANAGER_ACCOUNT_ROW_NOTE : undefined}
                      >
                        {r.pendingCheque ? '—' : r.destinationLabel}
                      </td>
                      <td className={r.pendingCheque ? 'text-sky-800' : 'font-bold'}>
                        {money(r.amount)}
                        {/**
                          * کار الف — این ردیف با *تاریخ پاس شدن* به این شیفت افتاده،
                          * نه با تاریخ ثبتش. بدون این نشان، فروشنده‌ی این شیفت دنبال
                          * چکی می‌گشت که خودش ثبتش نکرده بود.
                          */}
                        {r.byClearedAt ? <div className="kbd font-normal">با تاریخ پاس شدن</div> : null}
                      </td>
                      <td>{money(r.grandTotal)}</td>
                      <td className={r.remainingAfter > 0 ? 'text-amber-800 font-bold' : ''}>
                        {money(r.remainingAfter)}
                      </td>
                      <td className="whitespace-normal">
                        {r.label}
                        {r.note ? ` · ${r.note}` : ''}
                      </td>
                    </tr>
                  ))}
                  {!payRows.length && (
                    <tr>
                      <td colSpan={14} className="text-center py-6 text-slate-400">
                        در این شیفت هیچ پرداختی‌ای (نه بابت فاکتورهای همین شیفت و نه بابت نسیه‌های قبلی) دریافت نشده است
                      </td>
                    </tr>
                  )}
                </tbody>
                {!!payRows.length && (
                  <tfoot className="sticky bottom-0">
                    <tr className="bg-slate-100 font-bold">
                      <td colSpan={9}>
                        جمع {faDigits(payTotals.count)} پرداختی — از این میان {faDigits(payTotals.priorCount)} پرداختی
                        بابت فاکتورهای قدیمی‌تر ({money(payTotals.priorTotal)} ریال)
                      </td>
                      {/* کار الف — تفکیک مقصدِ همین جمع؛ چهار عدد از سرور می‌آید و جمعشان = کل */}
                      <td className="whitespace-normal kbd font-normal">
                        نقد {money(payTotals.cashTotal)} · کارت {money(payTotals.cardTotal)}
                        <br />
                        حساب مدیر {money(payTotals.managerTotal)} · نامشخص {money(payTotals.unknownTotal)}
                      </td>
                      <td>{money(payTotals.total)}</td>
                      <td colSpan={3}>
                        {payTotals.pendingChequeTotal > 0
                          ? `چک پاس‌نشده (پول واقعی نیست): ${money(payTotals.pendingChequeTotal)} ریال`
                          : ''}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {/* ---------------- ۴) جمع‌بندی نهایی همین شیفت ---------------- */}
          <section className="space-y-1">
            <h3 className="font-bold border-b pb-1">جمع‌بندی نهایی این شیفت</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {(
                [
                  ['تعداد فاکتور', faDigits(t.count)],
                  ['جمع مبلغ کالا', money(t.goodsTotal)],
                  ['جمع تخفیف‌ها', money(t.discountTotal)],
                  ['عوارض و مالیات', money(t.taxTotal)],
                  ['حق سرویس', money(t.serviceTotal)],
                  ['هزینه پیک', money(t.deliveryTotal)],
                  ['جمع کل فروش', money(t.grandTotal)],
                  ['نقدی', money(t.cashTotal)],
                  ['کارت (کارتخوان فروشگاه)', money(cardOnlyOf(t))],
                  [MANAGER_ACCOUNT_ROW_LABEL, money(managerAccountOf(t))],
                  ['سایر / نامشخص', money(otherOrUnknownOf(t))],
                  ['غیرنقدی / اعتباری', money(t.creditTotal)],
                  ['جمع دریافتی واقعی', money(t.receivedTotal)],
                  ['باقی‌ماندهٔ نسیه‌ی این شیفت', money(data.creditTotal)],
                  // مورد ۶ — پولی که در همین شیفت گرفته شده، جدا از فروشِ همین شیفت
                  ['پرداختی‌های دریافت‌شده در این شیفت', money(payTotals.total)],
                  ['از آن، بابت نسیه‌های قدیمی‌تر', money(payTotals.priorTotal)],
                  ['چک پاس‌نشده‌ی این شیفت', money(payTotals.pendingChequeTotal)],
                  ['از پرداختی‌ها: به حساب مدیر', money(payTotals.managerTotal)],
                  ['از پرداختی‌ها: مقصد نامشخص', money(payTotals.unknownTotal)],
                  ['جمع برگشت‌ها', money(data.returnsTotal)],
                  ['تعداد تعویض', faDigits(data.exchanges.totals.count)],
                  ['مابه‌التفاوت تعویض‌ها', money(data.exchanges.totals.diffTotal)],
                  ['اعتبار خرید صادرشده', money(data.exchanges.totals.creditIssuedTotal)]
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="rounded border bg-slate-50 px-2 py-1">
                  <div className="kbd">{label}</div>
                  <div className="font-bold">{value}</div>
                </div>
              ))}
            </div>
            <div className="rounded px-3 py-2 border-2 bg-emerald-50 border-emerald-300 font-bold leading-7">
              {/**
                * کار الف: عدد این کادر عمداً دست نخورد (همان معنای قبلی: هر چیزی که
                * روی فاکتورها تسویه شده) ولی حالا صریح می‌گوید سهم «حساب مدیر» هم
                * داخلش است، چون آن سهم در کشو و کارتخوان فروشگاه نیست و اگر بی‌توضیح
                * می‌ماند دقیقاً همان کسری‌ای را می‌ساخت که این کار برای رفعش است.
                */}
              جمع صندوق این شیفت (نقدی + کارت + حساب مدیر + سایر/نامشخص + اعتباری):{' '}
              {money(t.cashTotal + cardOnlyOf(t) + managerAccountOf(t) + otherOrUnknownOf(t) + t.creditTotal)} ریال
              {managerAccountOf(t) > 0 ? (
                <div className="kbd font-normal leading-6">
                  از این مبلغ {money(managerAccountOf(t))} ریال به حساب مدیر رفته و در کشو یا کارتخوان فروشگاه نیست.
                </div>
              ) : null}
              {data.session
                ? ` · مبلغ ثبت‌شده در لحظه‌ی بستن صندوق: ${money(data.session.grandTotal)} ریال`
                : ''}
            </div>
            {/* ---- مورد ۶: همان خطی که اختلاف با کارتخوان را توضیح می‌دهد ---- */}
            {payTotals.priorTotal > 0 && (
              <div className="rounded px-3 py-2 border-2 bg-amber-50 border-amber-400 leading-7">
                <b>
                  {money(payTotals.priorTotal)} ریال از پولی که در این شیفت دریافت شده، بابت فاکتورهای نسیه‌ی
                  قدیمی‌تر بوده است.
                </b>
                <div className="kbd leading-6">
                  این مبلغ در «جمع فروش این شیفت» شمرده نمی‌شود (فروشش مال روز دیگری بوده) ولی در کشوی صندوق و روی
                  دستگاه کارتخوان هست. پس اگر شمارش دستی شما{' '}
                  {money(payTotals.priorTotal)} ریال بیشتر از جمع فروش سیستم است، مغایرتی وجود ندارد و دلیلش همین
                  ردیف‌های زردرنگ بالاست.
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </Modal>
  )
}
