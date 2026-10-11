import { useEffect, useMemo, useRef, useState } from 'react'
import { createLatestGate } from '@shared/latestRequest'
import Modal from './Modal'
import { call, CH } from '../lib/api'
import { faDigits, toJalaliDateTime } from '@shared/jalali'

const REASON_FA: Record<string, string> = {
  SALE: 'فروش',
  SALE_RETURN: 'برگشت از فروش',
  PURCHASE: 'خرید',
  ADJUSTMENT: 'اصلاح دستی',
  INITIAL: 'موجودی اولیه',
  STOCKTAKE: 'انبارگردانی',
  SALE_EDIT: 'اصلاح فاکتور فروش',
  PURCHASE_EDIT: 'اصلاح فاکتور خرید',
  CENTRAL_WITHDRAW: 'انتقال از انبار مرکزی',
  WOO_SYNC_OUT: 'همگام‌سازی سایت: خروج موجودی',
  WOO_SYNC_IN: 'همگام‌سازی سایت: ورود موجودی',
  WOO_SYNC_ADJUST: 'همگام‌سازی سایت: هم‌ترازی موجودی'
}

const REF_FA: Record<string, string> = {
  SaleInvoice: 'فیش فروش',
  PurchaseInvoice: 'فاکتور خرید',
  SaleReturn: 'برگشت از فروش',
  SecondaryStockItem: 'انبار مرکزی',
  Manual: 'دستی'
}

/**
 * «بازبینی» (F6) / «نمایش گردش کالا»: دفتر حرکات انبار یک واریانت.
 * IPC: stock:movements  ← ProductService.movements (دفتر صفحه‌بندی‌شده، نزولی)
 *
 * ستون state همان منطق دو‌مرحله‌ای پروژه را نشان می‌دهد:
 *   PENDING = کسر موقت لحظه‌ی فروش (هنوز تجمیع نشده)
 *   FINAL   = قطعی‌شده با «تجمیع و انتقال» (فقط با برگشت از فروش جبران می‌شود)
 * اینجا فقط نمایش است؛ هیچ نوشتنی روی موجودی انجام نمی‌شود.
 */
export default function MovementsModal({
  open,
  variant,
  onClose
}: {
  open: boolean
  variant: any | null
  onClose: () => void
}) {
  const [rows, setRows] = useState<any[]>([])
  const [meta, setMeta] = useState<{ page?: any; warnings?: string[]; totals?: any; newerDeltaSum?: number }>({})
  const [skip, setSkip] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open && variant) setSkip(0)
  }, [open, variant?.id])

  /**
   * نشست ۱۷۴ · مشاهده‌ی P3 ممیزی ۱۱۶ (الگوی A88-01) — تعویض کالا یا صفحه دو درخواست هم‌زمان
   * می‌ساخت و پاسخ دیرتر برنده بود: حرکت‌های کالای قبلی با موجودی کالای فعلی (ستون «موجودی بعد»
   * غلط) نمایش داده می‌شد. حالا فقط پاسخ آخرین درخواست می‌نشیند؛ تعویض کالا ردیف‌های قبلی را
   * فوراً پاک می‌کند و بستن مودال درخواست‌های در جریان را کهنه می‌کند.
   */
  const gate = useRef(createLatestGate()).current
  const loadedVariant = useRef<number | null>(null)
  useEffect(() => {
    if (!open || !variant) {
      gate.invalidate()
      loadedVariant.current = null
      return
    }
    const seq = gate.next()
    if (loadedVariant.current !== variant.id) {
      setRows([])
      setMeta({})
    }
    setLoading(true)
    setErr(null)
    call<any[] & { page?: any; warnings?: string[]; totals?: any; newerDeltaSum?: number }>(CH.stockMovements, {
      variantId: variant.id,
      skip
    })
      .then((result) => {
        if (!gate.isLatest(seq)) return
        loadedVariant.current = variant.id
        setRows(result)
        setMeta({
          page: result.page,
          warnings: result.warnings ?? [],
          totals: result.totals,
          newerDeltaSum: result.newerDeltaSum ?? 0
        })
      })
      .catch((e: any) => {
        if (gate.isLatest(seq)) setErr(e.message)
      })
      .finally(() => {
        if (gate.isLatest(seq)) setLoading(false)
      })
  }, [open, variant?.id, skip])

  /** موجودی پس از هر حرکت، از موجودی فعلی به عقب (لیست نزولی است). */
  const withBalance = useMemo(() => {
    let after = (variant?.stock ?? 0) - (meta.newerDeltaSum ?? 0)
    return rows.map((r) => {
      const row = { ...r, balanceAfter: after }
      after = after - r.delta
      return row
    })
  }, [rows, variant, meta.newerDeltaSum])

  const totals = meta.totals ?? { inTotal: 0, outTotal: 0, pendingCount: 0, count: 0 }
  const pending = totals.pendingCount ?? 0
  const sumIn = totals.inTotal ?? 0
  const sumOut = totals.outTotal ?? 0
  const page = meta.page

  return (
    <Modal
      open={open}
      title={`گردش انبار — ${variant ? `${variant.product?.name ?? ''}${variant.size ? ' سایز ' + variant.size : ''}` : ''}`}
      onClose={onClose}
      width="max-w-5xl"
      footer={
        <button className="btn" onClick={onClose}>
          بستن <span className="keycap">Esc</span>
        </button>
      }
    >
      {variant && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-slate-50 border rounded p-2">
            <div className="kbd">کد / بارکد</div>
            <div className="font-bold">
              {faDigits(variant.code)} / {faDigits(variant.barcode)}
            </div>
          </div>
          <div className="bg-slate-50 border rounded p-2">
            <div className="kbd">موجودی فعلی</div>
            <div className={`font-bold ${variant.stock <= 0 ? 'text-red-500' : ''}`}>{faDigits(variant.stock)}</div>
          </div>
          <div className="bg-slate-50 border rounded p-2">
            <div className="kbd">جمع ورود / خروج</div>
            <div className="font-bold">
              {faDigits(sumIn)} / {faDigits(Math.abs(sumOut))}
            </div>
          </div>
          <div className={`border rounded p-2 ${pending ? 'bg-amber-50 border-amber-300' : 'bg-slate-50'}`}>
            <div className="kbd">حرکات تجمیع‌نشده (PENDING)</div>
            <div className="font-bold">{faDigits(pending)}</div>
          </div>
        </div>
      )}

      {!!meta.warnings?.length && (
        <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2 leading-6">
          {meta.warnings.map((warning, i) => (
            <div key={i}>⚠️ {warning}</div>
          ))}
        </div>
      )}

      {page && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn"
            onClick={() => setSkip(Math.max(0, page.skip - page.take))}
            disabled={loading || page.skip <= 0}
          >
            صفحه‌ی قبل
          </button>
          <span className="kbd">
            ردیف‌های {faDigits(page.skip + 1)} تا {faDigits(page.skip + rows.length)} از {faDigits(page.totalCount)}
          </span>
          <button
            className="btn"
            onClick={() => setSkip(page.skip + page.take)}
            disabled={loading || page.skip + rows.length >= page.totalCount}
          >
            صفحه‌ی بعد
          </button>
        </div>
      )}

      <div className="overflow-auto max-h-[55vh] border border-slate-200 rounded">
        <table className="tbl">
          <thead>
            <tr>
              <th>تاریخ و ساعت</th>
              <th>علت</th>
              <th>مقدار</th>
              <th>موجودی پس از حرکت</th>
              <th>وضعیت</th>
              <th>سند مرجع</th>
              <th>تجمیع</th>
              <th>توضیح</th>
            </tr>
          </thead>
          <tbody>
            {withBalance.map((r) => (
              <tr key={r.id}>
                <td>{toJalaliDateTime(new Date(r.createdAt))}</td>
                <td>{REASON_FA[r.reason] ?? r.reason}</td>
                <td className={r.delta < 0 ? 'text-red-500 font-bold' : 'text-emerald-600 font-bold'}>
                  {r.delta < 0 ? '−' : '+'}
                  {faDigits(Math.abs(r.delta))}
                </td>
                <td>{faDigits(r.balanceAfter)}</td>
                <td>
                  {r.state === 'PENDING' ? (
                    <span className="text-amber-600">موقت</span>
                  ) : (
                    <span className="text-slate-500">قطعی</span>
                  )}
                </td>
                <td>
                  {r.refType ? `${REF_FA[r.refType] ?? r.refType} ${r.refId ? faDigits(r.refId) : ''}` : '—'}
                </td>
                <td>{r.consolidationId ? faDigits(r.consolidationId) : '—'}</td>
                <td className="whitespace-normal">{r.note ?? '—'}</td>
              </tr>
            ))}
            {!withBalance.length && (
              <tr>
                <td colSpan={8} className="text-center py-10 text-slate-400">
                  {loading ? 'در حال بارگذاری…' : 'حرکتی برای این کالا ثبت نشده است'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {err && <div className="bg-amber-100 border border-amber-300 rounded px-3 py-2">{err}</div>}
    </Modal>
  )
}
