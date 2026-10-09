import { useMemo } from 'react'
import type { ReturnLookup, ReturnLookupItem } from '@shared/types'
import { guideReturn, type ReturnGuidance } from '@shared/returnGuidance'

export function useReturnGuidance(
  lookup: ReturnLookup | null,
  qty: Record<number, number>
): ReturnGuidance | null {
  return useMemo(() => {
    if (!lookup) return null
    const items = lookup.items || []
    const isFull = items.length > 0 && items.every((i: ReturnLookupItem) => (qty[i.saleItemId] ?? 0) === i.remainingQty)
    return guideReturn({
      profile: lookup.settlementProfile,
      isFullReturn: isFull
    })
  }, [lookup, qty])
}
