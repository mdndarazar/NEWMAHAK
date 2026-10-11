import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import ConfirmDialog from './ConfirmDialog'
import PasswordField from './PasswordField'
import { call, CH } from '../lib/api'
import { faDigits, money } from '@shared/jalali'
import type { ReturnEditView } from '@shared/types'

/**
 * ============== ویرایش یک برگشت از فروش ثبت‌شده ==============
 * این مودال فقط «فرم» است؛ همه‌ی منطق (سقف تعداد، اختلاف موجودی انبار، وضعیت
 * فاکتور و ثبت در AuditLog) از قبل در سرویس فروش نوشته شده و اینجا صرفاً صدا
 * زده می‌شود:
 *
 *   sale:return:get     → همه‌ی اقلام فاکتور + تعداد فعلی همین برگشت
 *   sale:return:update  → حالت *نهایی* برگشت؛ اختلاف روی انبار اعمال می‌شود
 *
 * تعداد صفر یعنی آن قلم از برگشت خارج می‌شود. اگر همه‌ی اقلام صفر شوند، یعنی
 * کاربر می‌خواهد کل برگشت باطل شود، که کارِ دکمه‌ی «حذف» است (همان‌جا موجودی
 * هم کامل reverse می‌شود).
 * ============================================================
 */

interface ReturnUpdateResult {
  id: number
  invoiceId: number
  receiptNo: number
  total: number
  qty: number
  restocked: boolean
  increasedQty: number
  decreasedQty: number
  status: string | null
}

export default function ReturnEditModal({
  returnId,
  onClose,
  onSaved
}: {
  /** null = مودال بسته است */
  returnId: number | null
  onClose: () => void
  /** بعد از ذخیره‌ی موفق، پیام نتیجه به صفحه‌ی میزبان داده می‌شود */
  onSaved: (message: string) => void
}) {
  const [view, setView] = useState<ReturnEditView | null>(null)
  const [qty, setQty] = useState<Record<number, number>>({})
  const [note, setNote] = useState('')
  const [allowRemoved, setAllowRemoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmForce, setConfirmForce] = useState<string | null>(null)
  /** نشست ۲۰۱ — رمز/دلیل اثر مالی و دوره‌ی بسته؛ همان فیلدهایی که سرور می‌خواهد. */
  const [editPw, setEditPw] = useState('')
  const [editReason, setEditReason] = useState('')

  // ---- خواندن برگشت و پر کردن فرم ----
  useEffect(() => {
    if (returnId == null) {
      setView(null)
      setErr(null)
      setConfirmForce(null)
      return
    }
    let alive = true
    setBusy(true)
    setErr(null)
    setConfirmForce(null)
    setAllowRemoved(false)
    setEditPw('')
    setEditReason('')
    call<ReturnEditView>(CH.saleReturnGet, { id: returnId })
      .then((v) => {
        if (!alive) return
        setView(v)
        const next: Record<number, number> = {}
        for (const i of v.items) next[i.saleItemId] = i.qty
        setQty(next)
        setNote(v.note ?? '')
      })
      .catch((e: any) => {
        if (!alive) return
        setView(null)
        setErr(e.message)
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [returnId])

  const items = view?.items ?? []

  const totals = useMemo(() => {
    let count = 0
    let q = 0
    let amount = 0
    for (const i of items) {
      const v = qty[i.saleItemId] ?? 0
      if (v > 0) {
        count += 1
        q += v
        amount += v * i.unitPrice
      }
    }
    return { count, qty: q, amount }
  }, [items, qty])

  const removedSelected = items.filter((i) => i.stockState === 'REMOVED' && (qty[i.saleItemId] ?? 0) > 0)
  const missingSelected = items.filter((i) => i.stockState === 'MISSING' && (qty[i.saleItemId] ?? 0) > 0)

  const setQtyFor = (saleItemId: number, max: number, value: number) =>
    setQty((p) => ({ ...p, [saleItemId]: Math.max(0, Math.min(Math.round(value || 0), Math.max(max, 0))) }))

  const submit = useCallback(
    async (force: boolean) => {
      if (!view) return
      setConfirmForce(null)
      const lines = view.items
        .map((i) => ({ saleItemId: i.saleItemId, qty: Math.max(0, Math.round(qty[i.saleItemId] ?? 0)) }))
        .filter((l) => l.qty > 0)
      if (!lines.length)
        return setErr(
          'برای این برگشت هیچ قلمی با تعداد بزرگ‌تر از صفر نمانده است. اگر می‌خواهید کل این برگشت باطل شود، ' +
            'مودال را ببندید و از دکمه‌ی «حذف» همان ردیف استفاده کنید تا موجودی انبار هم درست برگردد.'
        )
      setBusy(true)
      setErr(null)
      try {
        const res = await call<ReturnUpdateResult>(CH.saleReturnUpdate, {
          id: view.id,
          lines,
          note: note.trim(),
          allowRemoved: allowRemoved || undefined,
          force: force || undefined,
          /** قفل مستقلِ اصلاح/ابطال؛ همان رمز مدیر یا رمز دوم اختصاصی این عمل. */
          panelPassword: editPw.trim() || undefined,
          /** دوره‌ی بسته همچنان فقط رمز مدیر را می‌پذیرد. */
          managerPassword: editPw.trim() || undefined,
          overrideReason: editReason.trim() || undefined
        })
        onSaved(
          `برگشت از فروش فاکتور شماره ${faDigits(res.receiptNo)} ویرایش شد · ` +
            `${faDigits(res.qty)} عدد · ${money(res.total)} ریال · ` +
            (res.restocked
              ? res.increasedQty || res.decreasedQty
                ? `اصلاح موجودی انبار: ${faDigits(res.increasedQty)} عدد ورود، ${faDigits(res.decreasedQty)} عدد خروج`
                : 'موجودی انبار تغییری نداشت'
              : 'این فاکتور بدون کسر از موجودی بود، پس موجودی انبار تغییر نکرد')
        )
        onClose()
      } catch (e: any) {
        const message = String(e.message ?? '')
        // «بیشتر از تعداد قابل برگشت» یک هشدار قابل‌تایید است، نه دیوار
        if (message.includes('تایید کنید تا انجام شود')) setConfirmForce(message)
        else setErr(message)
      } finally {
        setBusy(false)
      }
    },
    [view, qty, note, allowRemoved, editPw, editReason, onSaved, onClose]
  )

  return (
    <Modal
      open={returnId != null}
      title={
        view
          ? `ویرایش برگشت از فروش · فاکتور شماره ${faDigits(view.receiptNo)} · ${faDigits(view.returnedAtJalali)}`
          : 'ویرایش برگشت از فروش'
      }
      // تا وقتی دیالوگ تایید باز است، Esc نباید کل فرم را ببندد
      onClose={() => {
        if (!confirmForce) onClose()
      }}
      width="max-w-6xl"
      footer={
        <>
          <div className="me-auto kbd">
            {view?.restocks
              ? 'با ذخیره، فقط *اختلاف* تعدادها روی موجودی انبار اعمال می‌شود (بیشتر شدن = ورود کالا، کمتر شدن = خروج).'
              : 'این فاکتور بدون کسر از موجودی انبار ثبت شده بود، پس ویرایش برگشتش موجودی را تغییر نمی‌دهد.'}
          </div>
          <button className="btn" onClick={onClose} disabled={busy}>
            انصراف
          </button>
          <button className="btn btn-primary" onClick={() => void submit(false)} disabled={busy || !view}>
            {busy ? 'در حال ذخیره…' : 'ذخیره‌ی ویرایش'}
          </button>
        </>
      }
    >
      {err && <div className="rounded px-3 py-2 border bg-amber-100 border-amber-300 whitespace-pre-line">{err}</div>}

      {!view ? (
        <div className="text-center py-10 text-slate-400">{busy ? 'در حال خواندن برگشت…' : 'برگشتی برای نمایش نیست'}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Info label="شماره فیش" value={faDigits(view.receiptNo)} strong />
            <Info label="کد فاکتور" value={view.returnCode ?? '—'} ltr />
            <Info label="تاریخ فاکتور" value={faDigits(view.invoiceDateJalali)} />
            <Info label="خریدار" value={view.customerName} />
            <Info label="تاریخ برگشت" value={`${faDigits(view.returnedAtJalali)} · ${faDigits(view.time)}`} />
            <Info label="نوع برگشت" value={view.isFull ? 'کامل' : 'جزئی'} />
            <Info label="مبلغ فعلی برگشت" value={money(view.total)} strong />
            <Info label="اثر روی انبار" value={view.restocks ? 'دارد' : 'ندارد (فاکتور بدون کسر موجودی)'} />
          </div>

          <div className="max-h-[45vh] overflow-auto border rounded">
            <table className="tbl">
              <thead className="sticky top-0">
                <tr>
                  <th>#</th>
                  <th>کد</th>
                  <th>نام کالا</th>
                  <th>تعداد فروش</th>
                  <th>در برگشت‌های دیگر</th>
                  <th>سقف این برگشت</th>
                  <th>قیمت واحد</th>
                  <th>تعداد برگشتی</th>
                  <th>مبلغ برگشت</th>
                  <th>وضعیت کالا در انبار</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => {
                  const q = qty[i.saleItemId] ?? 0
                  const missing = i.stockState === 'MISSING'
                  const removed = i.stockState === 'REMOVED'
                  return (
                    <tr key={i.saleItemId} className={missing ? 'bg-rose-50' : removed ? 'bg-amber-50' : ''}>
                      <td>{faDigits(idx + 1)}</td>
                      <td>{faDigits(i.code)}</td>
                      <td>{i.name}</td>
                      <td className="text-center">
                        {faDigits(i.soldQty)} {i.unit}
                      </td>
                      <td className="text-center">{faDigits(i.otherReturnedQty)}</td>
                      <td className="text-center font-bold">{faDigits(i.maxQty)}</td>
                      <td>{money(i.unitPrice)}</td>
                      <td className="w-28">
                        <input
                          type="number"
                          min={0}
                          max={i.maxQty}
                          className="inp py-0.5"
                          value={q}
                          onChange={(e) => setQtyFor(i.saleItemId, i.maxQty, +e.target.value)}
                        />
                      </td>
                      <td className="font-bold">{money(q * i.unitPrice)}</td>
                      <td className={missing ? 'text-rose-700 font-bold' : removed ? 'text-amber-700 font-bold' : ''}>
                        {missing ? (
                          <>
                            رکوردی از این کالا در سیستم نمانده
                            <div className="kbd">تعدادش را صفر بگذارید و موجودی را دستی از پنل کالاها اصلاح کنید.</div>
                          </>
                        ) : removed ? (
                          <>
                            این کالا از موجودی انبار حذف شده است
                            <div className="kbd">برای اصلاح خودکار موجودی، تیک «رسیدگی دستی» را بزنید.</div>
                          </>
                        ) : (
                          <>
                            موجود · {faDigits(i.stock)} {i.unit}
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={7}>جمع این برگشت پس از ویرایش</td>
                  <td className="text-center">{faDigits(totals.qty)}</td>
                  <td>{money(totals.amount)}</td>
                  <td>{totals.count ? `${faDigits(totals.count)} قلم` : 'هیچ قلمی نمانده'}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-2">
            <div className="text-[11px] text-amber-900 leading-6">
              اصلاح برگشت و اثر احتمالی آن روی موجودی، بدهی و پول عملیات حساسی است: در نصب تازه همیشه رمز مدیر یا
              رمز دوم اختصاصی «اصلاح و ابطال برگشت/تعویض» لازم است. برای بازپرداخت، اعتبار، کاهش بدهی یا دوره‌ی بسته،
              نوشتن دلیل هم اجباری است؛ دوره‌ی بسته فقط رمز مدیر را می‌پذیرد.
            </div>
            <div className="flex flex-wrap gap-2 items-end">
              <label>
                <div className="kbd">رمز مجوز اصلاح</div>
                <PasswordField
                  className="inp w-40"
                  placeholder="رمز مدیر یا رمز اصلاح"
                  value={editPw}
                  onChange={(e) => setEditPw(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="flex-1 min-w-[240px]">
                <div className="kbd">دلیل ویرایش (برای اثر مالی/دوره بسته اجباری)</div>
                <input className="inp" value={editReason} onChange={(e) => setEditReason(e.target.value)} />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 items-end">
            <label className="flex-1 min-w-[240px]">
              <div className="mb-1">یادداشت برگشت (اختیاری)</div>
              <input className="inp" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {!!removedSelected.length && (
              <label className="flex items-center gap-2 pb-2 text-amber-800 font-bold">
                <input
                  type="checkbox"
                  className="w-4 h-4"
                  checked={allowRemoved}
                  onChange={(e) => setAllowRemoved(e.target.checked)}
                />
                رسیدگی دستی: کالای حذف‌شده از انبار هم اصلاح شود
              </label>
            )}
          </div>

          {!!missingSelected.length && (
            <div className="bg-rose-50 border border-rose-300 rounded px-3 py-2">
              تعداد این قلم(ها) باید صفر شود، چون رکوردشان در سیستم نیست و اصلاح خودکار موجودی‌شان ممکن نیست:{' '}
              {missingSelected.map((i) => i.name).join(' · ')}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!confirmForce}
        title="تعداد برگشتی بیشتر از تعداد قابل برگشت است"
        message={<div className="whitespace-pre-line">{confirmForce}</div>}
        confirmLabel="بله، همین را ثبت کن"
        busy={busy}
        onConfirm={() => void submit(true)}
        onCancel={() => setConfirmForce(null)}
      />
    </Modal>
  )
}

function Info({ label, value, strong, ltr }: { label: string; value: string; strong?: boolean; ltr?: boolean }) {
  return (
    <div>
      <div className="kbd">{label}</div>
      <div dir={ltr ? 'ltr' : undefined} className={`inp bg-slate-50 truncate ${strong ? 'font-bold' : ''}`} title={value}>
        {value}
      </div>
    </div>
  )
}
