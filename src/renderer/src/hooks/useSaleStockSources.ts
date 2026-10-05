import { useCallback, useEffect, useState } from 'react'
import { call, CH } from '../lib/api'

/**
 * ===========================================================================
 * جلسه ۵۳ · مرحله ۴ — تنها نقطه‌ی *خواندنِ* «مبدأ کسر» در رندرر.
 *
 * دو مصرف‌کننده دارد (فهرست فاکتورهای عمده و جدول گزارش فروش) و عمداً یک هوک
 * است، نه دو `call` جدا: وگرنه اولین اصلاح دو متن متفاوت می‌ساخت. متنِ هر خانه
 * را **سرور** با همان `summarizePlan` می‌سازد (`short`/`lines`)، پس رسید چاپی،
 * ستون جدول، چاپ A4 و اکسل هیچ‌وقت سه چیز متفاوت نمی‌گویند.
 *
 * سه قاعده:
 *   ۱) **فقط خواندنی.** تنها کانالش `sale:stockSourcesMany` است که در سرویس فقط
 *      `findMany` می‌زند. با این هوک هیچ موجودی و هیچ عددی عوض نمی‌شود.
 *   ۲) **فاکتور بی‌دفتر = خانه‌ی خالی، نه خطا.** سرور برای فاکتورهای قبل از
 *      جلسه ۴۷ و فروش تکیِ بی‌برنامه هیچ کلیدی برنمی‌گرداند ⇒ `shortOf` رشته‌ی
 *      خالی می‌دهد ⇒ جدول همان «—» قبلی را نشان می‌دهد.
 *   ۳) **هیچ‌وقت صفحه را نمی‌شکند.** خطای کانال فقط `error` را پر می‌کند؛ ستون
 *      خالی می‌ماند و هیچ عدد مالیِ گزارش به این هوک وابسته نیست.
 * ===========================================================================
 */
export interface SaleStockSourceSummary {
  /** خط‌های کامل «انبار: کالا تعداد (بعد از کسر …)» — برای tooltip */
  lines: string[]
  /** خط کوتاه «فروشگاه ۳ · انبار شعبه ۲ ⚠» — برای خانه‌ی جدول */
  short: string
}

export interface SaleStockSourceView {
  /** خط کوتاه یک فاکتور؛ بی‌دفتر ⇒ `''` */
  shortOf: (invoiceId: number | null | undefined) => string
  /** خط‌های کامل یک فاکتور؛ بی‌دفتر ⇒ `[]` */
  linesOf: (invoiceId: number | null | undefined) => string[]
  /** آیا در این بازه اصلاً فاکتور دفتردار هست؟ (برای پیام راهنما) */
  hasAny: boolean
  ready: boolean
  error: string | null
  reload: () => Promise<void>
}

/** سقف ایمنی — یک بازه‌ی خیلی بزرگ نباید یک کوئری غیرمنتظره بسازد. */
const MAX_IDS = 500

/**
 * @param invoiceIds شناسه‌ی فاکتورهای *دیده‌شده* روی صفحه (نه کل دیتابیس).
 * @param enabled `false` ⇒ هیچ درخواستی فرستاده نمی‌شود (تب بسته، قفل نشده).
 */
export function useSaleStockSources(
  invoiceIds: (number | null | undefined)[],
  enabled = true
): SaleStockSourceView {
  const [map, setMap] = useState<Record<number, SaleStockSourceSummary>>({})
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * کلید متنی (نه آرایه) تا وابستگی هوک پایدار بماند: آرایه‌ی تازه در هر رندر،
   * `useEffect` را بی‌پایان صدا می‌زد.
   */
  const key = [
    ...new Set((invoiceIds ?? []).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0))
  ]
    .slice(0, MAX_IDS)
    .sort((a, b) => a - b)
    .join(',')

  const reload = useCallback(async () => {
    const ids = key ? key.split(',').map(Number) : []
    if (!enabled || !ids.length) {
      setMap({})
      setError(null)
      setReady(true)
      return
    }
    try {
      const res = await call<Record<string, SaleStockSourceSummary>>(CH.saleStockSourcesMany, { invoiceIds: ids })
      const out: Record<number, SaleStockSourceSummary> = {}
      for (const [k, v] of Object.entries(res ?? {}))
        out[Number(k)] = { lines: v?.lines ?? [], short: v?.short ?? '' }
      setMap(out)
      setError(null)
    } catch (e: any) {
      // ستون خالی می‌شود، گزارش سالم می‌ماند.
      setMap({})
      setError(e?.message ?? 'خواندن «مبدأ کسر» ناموفق بود')
    } finally {
      setReady(true)
    }
  }, [key, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  const shortOf = useCallback(
    (invoiceId: number | null | undefined): string => (invoiceId == null ? '' : map[invoiceId]?.short ?? ''),
    [map]
  )
  const linesOf = useCallback(
    (invoiceId: number | null | undefined): string[] => (invoiceId == null ? [] : map[invoiceId]?.lines ?? []),
    [map]
  )

  return { shortOf, linesOf, hasAny: Object.keys(map).length > 0, ready, error, reload }
}
