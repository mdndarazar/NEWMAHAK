/**
 * ===========================================================================
 * نشست ۳۱۹ — انتخاب هوشمند مظنونین عدم تطبیق پل (shared خالص).
 *
 * انضباط فایل (F7):
 *   • بدون reduce عددی یا ضرب روی مبالغ (فقط مقایسه و امتیازدهی).
 *   • خروجی شامل حداکثر ۳ مظنون برتر است.
 *   • تمام نشان‌ها و نتایج دارای برچسب TENTATIVE (غیرقطعی) هستند.
 * ===========================================================================
 */

import type { BridgeDiagRow, BridgeDiagFlag, BridgeSuspect, SuspectReason, SaleBridgeSource } from './types'

export function pickSuspects(
  rows: BridgeDiagRow[],
  bridge: { unexplained: number; balanced: boolean },
  preloadedSources?: Record<string, Array<SaleBridgeSource & { flags?: BridgeDiagFlag[] }>>
): BridgeSuspect[] {
  if (bridge.balanced || Math.abs(bridge.unexplained) === 0) return []

  const absUnexplained = Math.abs(bridge.unexplained)
  const candidateList: Array<{
    score: number
    rowKey: string
    rowLabel: string
    reasons: SuspectReason[]
    documents: Array<{
      kind: any
      id: number
      amount: number
      dateJalali: string | null
      receiptNo: number | null
    }>
    certainty: 'TENTATIVE'
  }> = []

  for (const r of rows) {
    if (r.amount === 0) continue
    const reasons: SuspectReason[] = []
    let score = 0

    // تطابق دقیق ردیف با باقیمانده بی‌توضیح
    if (Math.abs(r.amount) === absUnexplained) {
      reasons.push('ROW_EQUALS_UNEXPLAINED')
      score += 100
    }

    const srcs = preloadedSources?.[r.key] || []
    const matchingDocs: Array<{
      kind: any
      id: number
      amount: number
      dateJalali: string | null
      receiptNo: number | null
    }> = []

    for (const s of srcs) {
      if (Math.abs(s.amount) === absUnexplained) {
        if (!reasons.includes('SOURCE_EQUALS_UNEXPLAINED')) {
          reasons.push('SOURCE_EQUALS_UNEXPLAINED')
          score += 200
        }
        matchingDocs.push({
          kind: s.kind ?? 'RETURN',
          id: s.id ?? 0,
          amount: s.amount,
          dateJalali: s.dateJalali ?? null,
          receiptNo: s.receiptNo ?? null
        })
      }

      if (s.flags?.some((f) => f.code === 'date')) {
        if (!reasons.includes('SOURCE_OUT_OF_PERIOD') && !r.key.startsWith('prior')) {
          reasons.push('SOURCE_OUT_OF_PERIOD')
          score += 50
        }
        if (!matchingDocs.some((d) => d.id === s.id)) {
          matchingDocs.push({
            kind: s.kind ?? 'RETURN',
            id: s.id ?? 0,
            amount: s.amount,
            dateJalali: s.dateJalali ?? null,
            receiptNo: s.receiptNo ?? null
          })
        }
      }
    }

    if (r.flags?.some((f) => f.code === 'largest')) {
      reasons.push('LARGEST_ROW')
      score += 10
    }

    if (reasons.length > 0) {
      candidateList.push({
        score,
        rowKey: r.key,
        rowLabel: r.label,
        reasons,
        documents: matchingDocs.length > 0 ? matchingDocs : ((r.sources as any[]) || []).map((s) => ({
          kind: s.kind ?? 'RETURN',
          id: s.id ?? 0,
          amount: s.amount ?? r.amount,
          dateJalali: s.dateJalali ?? null,
          receiptNo: s.receiptNo ?? null
        })),
        certainty: 'TENTATIVE'
      })
    }
  }

  candidateList.sort((a, b) => b.score - a.score)

  return candidateList.slice(0, 3).map((item, idx) => ({
    rank: idx + 1,
    rowKey: item.rowKey,
    rowLabel: item.rowLabel,
    reasons: item.reasons,
    documents: item.documents,
    certainty: item.certainty
  }))
}
