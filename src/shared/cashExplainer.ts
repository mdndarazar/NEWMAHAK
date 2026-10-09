import type { SaleReportTotals, SaleBridgeBlock } from './types'

export type ExplainerLine = {
  key: string
  label: string // زبان بازاری و خودمانی: «پول مرجوعی‌هایی که در دخل ماند (کوپن صادر شد)»
  amount: number // همیشه مثبت؛ علامت در sign
  sign: 1 | -1
  bridgeKeys: string[] // کدام ردیف‌های پل داخل این خط‌اند
  hint: string
}

export interface NetToDrawerResult {
  start: number
  lines: ExplainerLine[]
  unexplained: number
  end: number
  official: number
  gap: number
  omittedZeroCount: number
}

/** گروه‌بندی ردیف‌های پل به چند خط ساده و قابل‌فهم. هر ردیف پل دقیقاً در یک گروه. */
export const GROUPS: { key: string; label: string; keys: string[] }[] = [
  { key: 'creditKept', label: 'پول مرجوعی‌هایی که در دخل ماند (کوپن صادر شد)', keys: ['storeCreditIssued'] },
  { key: 'noMoneyIn', label: 'فروش‌هایی که پولی نیاورد (کوپن مصرف‌شده)', keys: ['storeCreditUsed'] },
  { key: 'notYet', label: 'نسیه‌ی این بازه که هنوز نیامده', keys: ['uncollectedCredit'] },
  {
    key: 'otherIn',
    label: 'سایر دریافتی‌ها (وصول نسیه/چک قبلی، پول اضافه)',
    keys: ['priorCreditSettlements', 'priorClearedCheques', 'overpayReceived', 'priorDebtReturns']
  },
  {
    key: 'notInDrawer',
    label: 'پولی که به کشو/کارت‌خوان نرسید (حساب مدیر، نامشخص)',
    keys: [
      'managerAccountReceived',
      'destinationUnknownReceived',
      'priorManagerAccountReceived',
      'priorDestinationUnknownReceived'
    ]
  },
  {
    key: 'paidBack',
    label: 'پولی که پس دادیم (نقد/کارت)',
    keys: [
      'cashRefunds',
      'cardRefunds',
      'cardToCardRefunds',
      'exchangeCashRefunds',
      'exchangeCardRefunds',
      'exchangeCardToCardRefunds'
    ]
  }
]

/**
 * تبدیل ردیف‌های پل تطبیق به کارت تراز قابل‌فهم «از خالص فروش تا موجودی واقعی دخل».
 * بدون اختراع عدد جدید؛ صرفاً بازآرایی و گروه‌بندی ردیف‌های موجود پل.
 */
export function buildNetToDrawer(bridge: SaleBridgeBlock | undefined | null, officialRealCash: number): NetToDrawerResult {
  if (!bridge || !Array.isArray(bridge.rows)) {
    return {
      start: 0,
      lines: [],
      unexplained: 0,
      end: 0,
      official: officialRealCash,
      gap: officialRealCash,
      omittedZeroCount: 0
    }
  }

  // جهت حرکت: از خالص (target) به سمت پول واقعی دخل ⇒ هر ردیف پل با «−sign» اعمال می‌شود
  const byKey = new Map(bridge.rows.map((r) => [r.key, r]))
  const used = new Set<string>(['realCash'])
  const lines: ExplainerLine[] = []
  let zeroGroupCount = 0

  for (const g of GROUPS) {
    const signed = g.keys.reduce((s, k) => {
      const r = byKey.get(k)
      if (!r) return s
      used.add(k)
      return s - (r.sign ?? 1) * (r.amount ?? 0)
    }, 0)

    if (signed !== 0) {
      lines.push({
        key: g.key,
        label: g.label,
        amount: Math.abs(signed),
        sign: signed < 0 ? -1 : 1,
        bridgeKeys: g.keys,
        hint: ''
      })
    } else {
      zeroGroupCount++
    }
  }

  // ردیف پلی که در هیچ گروهی تعریف نشده ⇒ خط جدای «سایر» (هرگز بی‌صدا حذف نمی‌شود)
  const leftovers = bridge.rows.filter((r) => !used.has(r.key) && (r.amount ?? 0) !== 0)
  for (const r of leftovers) {
    lines.push({
      key: r.key,
      label: r.label,
      amount: Math.abs(r.amount ?? 0),
      sign: (r.sign ?? 1) === 1 ? -1 : 1,
      bridgeKeys: [r.key],
      hint: r.hint ?? ''
    })
  }

  const start = Number(bridge.target ?? 0)
  const netFromLines = lines.reduce((s, l) => s + l.sign * l.amount, 0)
  const unexplained = Number(bridge.unexplained ?? 0)
  const end = start + netFromLines - unexplained
  const gap = officialRealCash - end

  return {
    start,
    lines,
    unexplained,
    end,
    official: officialRealCash,
    gap,
    omittedZeroCount: zeroGroupCount
  }
}

/**
 * تفکیک درشت کشوی پول فیزیکی و دستگاه کارت‌خوان.
 * فقط برش و دسته‌بندی مقادیر موجود، بدون تغییر حسابی.
 */
export function splitDrawerPos(
  t: Partial<SaleReportTotals> | undefined | null,
  cardOnly: number,
  officialRealCash: number
): { drawer: number; pos: number; other: number; hasDiscrepancy: boolean; discrepancy: number } {
  const cashTotal = Number(t?.cashTotal ?? 0)
  const refundCashTotal = Number(t?.refundCashTotal ?? 0)
  const refundCardTotal = Number(t?.refundCardTotal ?? 0)

  const drawer = cashTotal - refundCashTotal
  const pos = cardOnly - refundCardTotal
  const other = officialRealCash - drawer - pos
  const sum = drawer + pos + other
  const discrepancy = officialRealCash - sum

  return {
    drawer,
    pos,
    other,
    hasDiscrepancy: discrepancy !== 0,
    discrepancy
  }
}
