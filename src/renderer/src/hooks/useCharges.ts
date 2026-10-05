import { useCallback, useEffect, useMemo, useState } from 'react'
import { call, CH } from '../lib/api'
import {
  computeCharges,
  parseCategoryCharge,
  resolveChargeRule,
  type CategoryChargeConfig,
  type CategoryRef,
  type ChargeBreakdown,
  type ChargeLineInput,
  type ChargeScope
} from '@shared/charges'

interface CategoryNode extends CategoryRef {
  name: string
  depth: number
}

const EMPTY: CategoryChargeConfig = { enabled: true, rules: [], fallback: null }

/**
 * «عوارض و مالیات» و «حق سرویس» یک پنل، آماده‌ی استفاده در همان صفحه.
 *
 * چرا یک هوک جدا؟ چون پنل فروش خرد و فاکتور فروش عمده هر دو به یک چیز نیاز
 * دارند: درخت دسته‌بندی کالا + تنظیمات اسکوپ خودشان + یک تابع محاسبه. با این
 * هوک، هر دو صفحه از همان `computeCharges` مشترک (src/shared/charges.ts) رد
 * می‌شوند، پس عدد فاکتور و عدد رسید چاپی هیچ‌وقت واگرا نمی‌شود.
 *
 * اسکوپ‌ها کاملاً مستقل‌اند: `useCharges('pos')` و `useCharges('wholesale')`
 * دو مجموعه‌ی جدا از تنظیمات را می‌خوانند.
 */
export function useCharges(scope: ChargeScope) {
  const [cats, setCats] = useState<CategoryNode[]>([])
  const [tax, setTax] = useState<CategoryChargeConfig>(EMPTY)
  const [service, setService] = useState<CategoryChargeConfig>(EMPTY)
  const [ready, setReady] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [tree, charges] = await Promise.all([
        call<CategoryNode[]>(CH.categoryTree),
        call<any>(CH.chargesGet)
      ])
      setCats(tree ?? [])
      const bucket = charges?.[scope] ?? {}
      setTax(parseCategoryCharge(bucket.tax))
      setService(parseCategoryCharge(bucket.service))
    } catch {
      // تنظیمات نیامد ⇒ صفر، ولی صفحه سالم می‌ماند
      setTax(EMPTY)
      setService(EMPTY)
    } finally {
      setReady(true)
    }
  }, [scope])

  useEffect(() => {
    void reload()
  }, [reload])

  /** محاسبه‌ی عوارض و حق سرویس همه‌ی ردیف‌های یک فاکتور. */
  const compute = useCallback(
    (lines: ChargeLineInput[]): ChargeBreakdown => computeCharges(tax, service, cats, lines),
    [tax, service, cats]
  )

  /** توضیح مقدار مؤثر یک دسته (برای tooltip ستون عوارض). */
  const explain = useCallback(
    (categoryId: number | null | undefined) => ({
      tax: resolveChargeRule(tax, categoryId, cats),
      service: resolveChargeRule(service, categoryId, cats)
    }),
    [tax, service, cats]
  )

  const active = useMemo(
    () =>
      (tax.enabled && (tax.rules.length > 0 || !!tax.fallback)) ||
      (service.enabled && (service.rules.length > 0 || !!service.fallback)),
    [tax, service]
  )

  return { cats, tax, service, ready, reload, compute, explain, active }
}
