import type { InvoiceSettlementProfile } from '@shared/types'
import { money } from '@shared/jalali'

export default function InvoiceFinanceBadge({ profile }: { profile?: InvoiceSettlementProfile | null }) {
  if (!profile) return null

  switch (profile.kind) {
    case 'CREDIT_ONLY':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-100 text-rose-800 text-xs font-bold border border-rose-300">
          <span>نسیه کامل (دریافتی نقد: ۰ ریال)</span>
        </span>
      )
    case 'STORE_CREDIT_FUNDED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-purple-100 text-purple-800 text-xs font-bold border border-purple-300">
          <span>پرداخت با اعتبار خرید ({profile.creditRedemptions.length} کوپن) · سهم نقدی: {money(profile.cashLikeReceived)} ریال</span>
        </span>
      )
    case 'MIXED':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-amber-100 text-amber-800 text-xs font-bold border border-amber-300">
          <span>ترکیبی نقد و نسیه (پرداخت‌شده: {money(profile.cashLikeReceived)} ریال · مانده بدهی: {money(profile.remainingDebt)} ریال)</span>
        </span>
      )
    case 'EXCHANGE_DOC':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-blue-100 text-blue-800 text-xs font-bold border border-blue-300">
          <span>سند تعویض کالا {profile.sourceReceiptNo ? `(مربوط به فاکتور #${profile.sourceReceiptNo})` : ''}</span>
        </span>
      )
    case 'PAID_CASHLIKE':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-100 text-emerald-800 text-xs font-bold border border-emerald-300">
          <span>تسویه نقدی/کارتی کامل ({money(profile.cashLikeReceived)} ریال)</span>
        </span>
      )
  }
}
