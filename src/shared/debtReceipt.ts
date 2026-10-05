/**
 * فیش وصول نسیه — فقط توابع خالص.
 * باقی‌مانده‌ی لحظه‌ی پرداخت از JSON همان Auditِ SALE_PAYMENT_ADD خوانده می‌شود،
 * نه از محاسبه‌ی موازی. اگر snapshot نباشد، چاپ با برچسب «در تاریخ چاپ» است.
 */

export type DebtReceiptRemainingSource = 'SNAPSHOT' | 'LIVE_AT_PRINT'
export type DebtReceiptLaterChange = 'EDITED' | 'VOIDED' | null

export interface DebtPaymentReceiptData {
  paymentId: number
  invoiceId: number
  receiptNo: number
  seq: number
  shopName: string
  customerName: string | null
  dateJalali: string
  time: string
  amount: number
  methodLabel: string
  kind: 'CASH' | 'CHEQUE'
  chequeNo: string | null
  bankName: string | null
  dueDateJalali: string | null
  remainingAfter: number
  remainingSource: DebtReceiptRemainingSource
  settled: boolean
  laterChange: DebtReceiptLaterChange
  reprint: boolean
}

export function readPaymentAddSnapshot(
  afterJson: string | null | undefined
): { amount: number; remaining: number; seq: number } | null {
  if (afterJson == null || String(afterJson).trim() === '') return null
  try {
    const o = typeof afterJson === 'string' ? JSON.parse(afterJson) : afterJson
    const remaining = Number(o?.remaining)
    const amount = Number(o?.amount)
    const seq = Number(o?.seq)
    if (!Number.isFinite(remaining) || remaining < 0) return null
    if (!Number.isFinite(amount) || amount < 0) return null
    return { amount, remaining, seq: Number.isFinite(seq) ? seq : 0 }
  } catch {
    return null
  }
}

export function debtReceiptSettled(kind: 'CASH' | 'CHEQUE', remainingAfter: number): boolean {
  return kind !== 'CHEQUE' && remainingAfter === 0
}
