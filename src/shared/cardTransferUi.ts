/**
 * ممیزی A115-01 (AUDIT-D47) — گیت وضعیت کارت‌به‌کارت، خالص و مشترک بین UI و تست.
 * main همین قاعده را مستقل در CardTransferService.adjust/cancel اعمال می‌کند؛ این فقط دکمه را هم‌راستا می‌کند.
 */
export interface CardTransferGateRow {
  kind?: string | null
  status?: string | null
  paidAt?: string | number | Date | null
  /** shapeRow سرویس paidAt خام نمی‌فرستد؛ paidAtJalali همان نشانه است. */
  paidAtJalali?: string | null
}

const hasPaidStamp = (r: CardTransferGateRow) => r.paidAt != null || (r.paidAtJalali != null && r.paidAtJalali !== '')

/** پول این درخواست واقعاً رفته است: PAID، یا ADJUSTED دارای paidAt. */
export function cardTransferIsPaid(r: CardTransferGateRow | null | undefined): boolean {
  if (!r) return false
  return r.status === 'PAID' || (r.status === 'ADJUSTED' && hasPaidStamp(r))
}

/** رویداد اصلاحی فقط روی «درخواست» پرداخت‌شده. */
export function canAdjustCardTransfer(r: CardTransferGateRow | null | undefined): boolean {
  return !!r && r.kind === 'REQUEST' && cardTransferIsPaid(r)
}

/** رد/لغو فقط روی درخواستی که هیچ پرداختی (paidAt) ندارد. */
export function canCancelCardTransfer(r: CardTransferGateRow | null | undefined): boolean {
  return !!r && r.kind === 'REQUEST' && r.status !== 'PAID' && !hasPaidStamp(r)
}
