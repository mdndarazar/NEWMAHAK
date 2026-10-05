/**
 * ===========================================================================
 * نشست ۳ زنجیره رفع (نشست ۵۸) — خوشه C / C2 + C3
 * «یک تعریف واحد از بدهی» و «یک تعریف واحد از اضافه‌دریافت»
 *
 * باگ: در یک فایل دو تعریف متناقض از بدهی بود:
 *   • recalcSettlement: max(0, grandTotal − paid − returned(RETURN))
 *   • addPayment / creditList / payments(): max(0, grandTotal − paid)
 * پس گیت اضافه‌دریافت کور بود: فاکتور ۱٬۰۰۰، پرداخت ۳۰۰، برگشت ۶۰۰ ⇒ بدهی واقعی
 * ۱۰۰ ولی سیستم ۷۰۰ را بی‌هشدار می‌پذیرفت. و هیچ‌کدام از دو تعریف «بازپرداخت از
 * پول دریافتی» را حساب نمی‌کرد: فاکتور ۱٬۰۰۰، پرداخت ۵۰۰، برگشت ۶۰۰ با بازپرداخت
 * نقدی ۵۰۰ ⇒ مشتری کالای ۴۰۰ را دارد و خالص صفر پرداخته، ولی فاکتور «تسویه‌شده»
 * می‌شد (۴۰۰ بدهی پنهان).
 *
 * فرمول واحد (تنها فرمول کل برنامه):
 *   returnedValue          = Σ total برگشت‌های ساده (kind = RETURN یا تهیِ قدیمی)
 *   refundFromReceived     = Σ min(total, refundAmount) همان برگشت‌ها، فقط وقتی
 *                            روش بازپرداخت CASH / CARD / STORE_CREDIT / CARD_TO_CARD
 *                            (لغونشده) است ⇒ بخشی از پول دریافتی که پس داده شد
 *   debtReduction          = returnedValue − refundFromReceived
 *   payable                = max(0, grandTotal − returnedValue)
 *   netReceived            = received − refundFromReceived
 *   remaining              = max(0, payable − netReceived)
 *   overpaid               = max(0, netReceived − payable)
 *
 * تعویض (kind = EXCHANGE): ارزش کالای برگشتی تعویض به‌صورت پرداخت «ارزش کالای
 * برگشتی» روی سند تعویض می‌نشیند و بدهی فاکتور اصلی را کم نمی‌کند (S58-2) —
 * **به‌جز** بخشی از مابه‌التفاوت منفی که از نشست ۶۰ (بند ۴-۵، DECISIONS S60-1)
 * به‌جای پرداخت پول، صریحاً از بدهی فاکتور اصلی کم می‌شود و روی خودِ سند با
 * ستون `SaleReturn.debtReduction` ثبت است:
 *   returnedValue += debtReduction   (بازپرداختی در کار نیست ⇒ refundFromReceived += ۰)
 * بخش بازپرداخت‌شده‌ی مابه‌التفاوت = exchangeRefundPartOf (پایین)؛ همه‌ی گزارش‌ها از
 * همین تابع می‌خوانند تا هیچ ریالی دو بار (یک بار کاهش بدهی، یک بار بازپرداخت) شمرده نشود.
 *
 * این فایل خالص است (بدون دیتابیس).
 * ===========================================================================
 */

import { toNumberRial } from './money'

export type SettlementStateCode = 'UNPAID' | 'PARTIAL' | 'SETTLED'

export interface DebtReturnInput {
  kind?: string | null
  total?: number | null
  refundMethod?: string | null
  refundAmount?: number | null
  /** درخواست کارت‌به‌کارت همین برگشت لغو شده؟ (پولی به مشتری نرسید و نمی‌رسد) */
  refundCanceled?: boolean | null
  /** نشست ۶۰ — فقط تعویض: بخشی از مابه‌التفاوت منفی که از بدهی فاکتور اصلی کم شد */
  debtReduction?: number | null
}

const REFUNDING_METHODS = ['CASH', 'CARD', 'STORE_CREDIT', 'CARD_TO_CARD']

const r0 = (x: unknown): number => {
  if (x == null || x === '') return 0
  return toNumberRial(x as number | bigint | string)
}

/** برگشت ساده است؟ (رکورد قدیمی بدون kind هم برگشت ساده حساب می‌شود) */
export function isSimpleReturn(r: { kind?: string | null }): boolean {
  return (r?.kind ?? 'RETURN') === 'RETURN'
}

/** سهم «پس‌داده‌شده از پول دریافتی» یک برگشت ساده. */
export function refundFromReceivedOf(r: DebtReturnInput): number {
  if (!isSimpleReturn(r)) return 0
  const method = String(r.refundMethod ?? '').toUpperCase()
  if (!REFUNDING_METHODS.includes(method)) return 0
  if (method === 'CARD_TO_CARD' && r.refundCanceled) return 0
  return Math.min(Math.max(0, r0(r.total)), Math.max(0, r0(r.refundAmount)))
}

/**
 * نشست ۶۰ · بند ۴-۵ — سهم کاهش بدهی یک تعویض (برای برگشت ساده همیشه ۰).
 * هرگز بیشتر از مابه‌التفاوت منفی نیست (داده‌ی خراب بی‌صدا عدد نمی‌سازد).
 */
export function exchangeDebtReductionOf(r: { kind?: string | null; exchangeDiff?: number | null; debtReduction?: number | null }): number {
  if (isSimpleReturn(r)) return 0
  const owed = Math.max(0, -r0(r.exchangeDiff))
  const cut = Math.max(0, r0(r.debtReduction))
  return r.exchangeDiff == null ? cut : Math.min(owed, cut)
}

/**
 * نشست ۶۰ · بند ۴-۵/۴-۹ — `exchangeRefundPartOf` در `./accounting` تعریف شده (آن فایل باید
 * بدون import بماند تا تست‌های Node خام بارش کنند) و اینجا فقط دوباره export می‌شود.
 */
export { exchangeRefundPartOf } from './accounting'

export interface DebtAdjustments {
  returnedValue: number
  refundFromReceived: number
}

/** جمع اثر برگشت‌های ساده‌ی یک فاکتور روی بدهی. */
export function debtAdjustmentsOf(returns: DebtReturnInput[] = []): DebtAdjustments {
  let returnedValue = 0
  let refundFromReceived = 0
  for (const r of returns) {
    if (!isSimpleReturn(r)) {
      // نشست ۶۰ (S60-1) — کاهش بدهی صریحِ تعویض؛ بازپرداختی نیست
      returnedValue += exchangeDebtReductionOf(r as any)
      continue
    }
    returnedValue += Math.max(0, r0(r.total))
    refundFromReceived += refundFromReceivedOf(r)
  }
  return { returnedValue, refundFromReceived }
}

export interface RemainingInput {
  grandTotal?: number | null
  /** جمع پرداختی‌های *دریافت‌شده* (چکِ پاس‌نشده بیرون) — همان paidTotal فاکتور */
  received?: number | null
  returnedValue?: number | null
  refundFromReceived?: number | null
}

export interface RemainingResult {
  grandTotal: number
  received: number
  returnedValue: number
  refundFromReceived: number
  debtReduction: number
  payable: number
  netReceived: number
  remaining: number
  overpaid: number
  state: SettlementStateCode
  settled: boolean
}

/** تنها تابع «بدهی» کل برنامه. */
export function remainingOf(input: RemainingInput): RemainingResult {
  const grandTotal = r0(input.grandTotal)
  const received = r0(input.received)
  const returnedValue = Math.max(0, r0(input.returnedValue))
  const refundFromReceived = Math.max(0, r0(input.refundFromReceived))
  const payable = Math.max(0, grandTotal - returnedValue)
  const netReceived = received - refundFromReceived
  const remaining = Math.max(0, payable - netReceived)
  const overpaid = Math.max(0, netReceived - payable)
  const state: SettlementStateCode =
    remaining <= 0 ? 'SETTLED' : netReceived <= 0 ? 'UNPAID' : 'PARTIAL'
  return {
    grandTotal,
    received,
    returnedValue,
    refundFromReceived,
    debtReduction: Math.max(0, returnedValue - refundFromReceived),
    payable,
    netReceived,
    remaining,
    overpaid,
    state,
    settled: state === 'SETTLED'
  }
}

export interface OverpayPaymentInput {
  id: number
  amount: number
  /** پول دریافت‌شده است؟ (چکِ پاس‌نشده/برگشتی = نه) */
  received: boolean
}

/**
 * C3 — تخصیص اضافه‌دریافت به ردیف‌های پرداخت (به ترتیب ثبت).
 *
 * سقف «پولی که مشتری باید می‌داد» = payable + refundFromReceived (پرداخت منفیِ
 * قدیمی از نشست ۵۹ نادیده گرفته می‌شود). پرداخت‌ها به ترتیب seq جمع می‌شوند؛ هر ریالی که از سقف بگذرد،
 * اضافه‌دریافتِ همان ردیفی است که از سقف رد شده. پس همیشه:
 *     Σ overpayAmount = overpaid فاکتور   (هیچ ریالی دو بار یا صفر بار شمرده نمی‌شود)
 */
export function allocateOverpay(
  payments: OverpayPaymentInput[],
  info: { payable: number; refundFromReceived: number }
): Map<number, number> {
  const out = new Map<number, number>()
  /**
   * نشست ۵۹ — `Payment` منفیِ قدیمی دیگر در paidTotal نیست (receivedTotalOf آن را
   * کنار می‌گذارد)، پس اینجا هم نه سقف را بالا می‌برد نه چیزی از آن کم می‌شود.
   */
  const cap = Math.max(0, r0(info.payable)) + Math.max(0, r0(info.refundFromReceived))
  let cum = 0
  for (const p of payments) {
    const amt = r0(p.amount)
    if (!p.received || amt <= 0) { out.set(p.id, 0); continue }
    const before = cum
    cum += amt
    out.set(p.id, Math.max(0, Math.min(amt, cum - Math.max(cap, before))))
  }
  return out
}
