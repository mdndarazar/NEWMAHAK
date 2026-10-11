import type { SaleReportTotals, SaleBridgeBlock, SaleCashBlock } from './types'

export type ExplainerLine = {
  key: string
  label: string // زبان بازاری و خودمانی: «پول مرجوعی‌هایی که در دخل ماند (کوپن صادر شد)»
  amount: number // همیشه مثبت؛ علامت در sign
  sign: 1 | -1
  bridgeKeys: string[] // کدام ردیف‌های پل داخل این خط‌اند
  hint: string
}

export type NetToDrawerAlarm = 'BRIDGE_UNBALANCED' | 'COMPOSITION_DRIFT' | null

export interface NetToDrawerResult {
  start: number
  lines: ExplainerLine[]
  unexplained: number
  end: number
  official: number
  gap: number
  omittedZeroCount: number
  alarm: NetToDrawerAlarm
  alarmMessage?: string
}

export type SplitDiscrepancyKind = 'OFFICIAL_REFERENCE' | 'CHAIN_COMPOSITION' | null

export interface SplitDrawerPosResult {
  drawer: number
  pos: number
  other: number
  managerOutside: number
  sum: number
  /** تفاوتِ جمع کاشی‌ها با عدد مرجعِ فعلی گزارش. */
  vsOfficial: number
  /** تفاوتِ جمع کاشی‌ها با انتهای زنجیرهٔ توضیحی؛ الزاماً پل باز نیست. */
  vsChain: number
  hasOfficialDiscrepancy: boolean
  hasChainDiscrepancy: boolean
  hasDiscrepancy: boolean
  /** منشأ مقدار نمایشی اختلاف؛ برای جلوگیری از برچسب نادرست «پل باز». */
  discrepancyKind: SplitDiscrepancyKind
  discrepancy: number
}

/** گروه‌بندی دقیق و جامع ردیف‌های پل برای تراز شفاف از خالص فروش به سمت دخل فیزیکی */
export const GROUPS_V2: { key: string; label: string; keys: string[] }[] = [
  { key: 'creditKept', label: 'پول مرجوعی‌هایی که در دخل ماند (کوپن صادر شد)', keys: ['storeCreditIssued'] },
  { key: 'noMoneyIn', label: 'فروش‌هایی که پولی نیاورد (کوپن مصرف‌شده)', keys: ['storeCreditUsed'] },
  { key: 'notYet', label: 'نسیه‌ی این بازه که هنوز نیامده', keys: ['uncollectedCredit'] },
  {
    key: 'otherIn',
    label: 'سایر دریافتی‌ها (وصول نسیه/چک قبلی، پول اضافه)',
    keys: [
      'priorCreditSettlements',
      'priorClearedCheques',
      'overpayReceived',
      'priorDebtReturns',
      'priorDestinationUnknownReceived'
    ]
  },
  {
    key: 'notInDrawer',
    label: 'پولی که به حساب مدیر رفته (خارج از صندوق فروشگاه)',
    keys: ['managerAccountReceived', 'priorManagerAccountReceived']
  },
  {
    key: 'c2cRefund',
    label: 'مرجوعی کارت‌به‌کارت (از حساب مدیر پرداخت شد، نه از دخل)',
    keys: ['cardToCardRefunds', 'exchangeCardToCardRefunds']
  }
]

export const PHYSICAL_REFUND_KEYS = [
  'cashRefunds',
  'cardRefunds',
  'exchangeCashRefunds',
  'exchangeCardRefunds'
]

export const GROUPS = GROUPS_V2
export const REFUND_KEYS = PHYSICAL_REFUND_KEYS

/**
 * ساخت تراز زنجیره‌ای ریاضی از خالص فروش تعهدی تا موجودی فیزیکی واقعی صندوق و کارت‌خوان.
 */
export function buildNetToDrawer(
  bridge: SaleBridgeBlock | undefined | null,
  officialRealCash: number,
  cashBlock?: SaleCashBlock | null
): NetToDrawerResult {
  if (!bridge || !Array.isArray(bridge.rows)) {
    return {
      start: 0,
      lines: [],
      unexplained: 0,
      end: 0,
      official: officialRealCash,
      gap: officialRealCash,
      omittedZeroCount: 0,
      alarm: officialRealCash !== 0 ? 'COMPOSITION_DRIFT' : null,
      alarmMessage: 'اطلاعات پل تطبیق در دسترس نیست.'
    }
  }

  const byKey = new Map(bridge.rows.map((r) => [r.key, r]))
  // بازپرداخت‌های فیزیکی کشو/کارت در خالص فروش اولیه کسر شده‌اند و در officialRealCash هم کسر هستند
  // دریافتی با مقصد نامشخص و وجه واقعی نیز مستقیماً داخل officialRealCash هستند
  const used = new Set<string>(['realCash', 'destinationUnknownReceived', ...PHYSICAL_REFUND_KEYS])
  const lines: ExplainerLine[] = []
  let zeroGroupCount = 0

  for (const g of GROUPS_V2) {
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

  const isBalanced = bridge.balanced === true && unexplained === 0
  let alarm: NetToDrawerAlarm = null
  let alarmMessage: string | undefined

  if (!isBalanced) {
    alarm = 'BRIDGE_UNBALANCED'
    alarmMessage = `مغایرت در پل تطبیق: مبلغ ${Math.abs(unexplained).toLocaleString('fa-IR')} ریال نیاز به بررسی در نمای تشخیص پل دارد.`
  } else if (Math.abs(gap) > 1) {
    alarm = 'COMPOSITION_DRIFT'
    alarmMessage = `تفاوت در ترکیب اقلام نمایشی (${Math.abs(gap).toLocaleString('fa-IR')} ریال)؛ اما پل حسابداری کاملاً تراز است.`
  }

  return {
    start,
    lines,
    unexplained,
    end,
    official: officialRealCash,
    gap,
    omittedZeroCount: zeroGroupCount,
    alarm,
    alarmMessage
  }
}

/**
 * تفکیک درشت کشو، کارت‌خوان و سبد سایر به روش غیرهیدرولیکی (مستقیم از منابع واقعی)
 */
export function splitDrawerPos(
  t: Partial<SaleReportTotals> | undefined | null,
  cardOnly: number,
  officialRealCash: number,
  chainEnd?: number
): SplitDrawerPosResult {
  const cashTotal = Number(t?.cashTotal ?? 0)
  const refundCashTotal = Number(t?.refundCashTotal ?? 0)
  const refundCardTotal = Number(t?.refundCardTotal ?? 0)
  const otherTotal = Number(t?.otherTotal ?? 0)
  const creditTotal = Number(t?.creditTotal ?? 0)
  const destinationUnknownTotal = Number(t?.destinationUnknownTotal ?? 0)
  const managerAccountTotal = Number(t?.managerAccountTotal ?? 0)

  // ۱) کشو (اسکناس فیزیکی) = نقد دریافتی منهای مرجوعی نقد
  const drawer = cashTotal - refundCashTotal
  // ۲) کارت‌خوان (پوز) = کارت کشیده‌شده منهای مرجوعی کارت
  const pos = cardOnly - refundCardTotal
  // ۳) سایر = واریزی‌های متفرقه + اعتباری + دریافتی با مقصد نامشخص (مستقیم، نه تفریق هیدرولیکی!)
  const other = otherTotal + creditTotal + destinationUnknownTotal
  // ۴) حساب مدیر = خارج از دخل فیزیکی مغازه
  const managerOutside = managerAccountTotal

  const sum = drawer + pos + other
  const vsOfficial = officialRealCash - sum
  const vsChain = chainEnd !== undefined ? chainEnd - sum : 0

  /**
   * این دو مقایسه معنای یکسان ندارند. تا پیش از این، هشدار با آستانهٔ صفر فعال
   * می‌شد ولی متن آن با آستانهٔ یک ریال از مقایسه‌ای دیگر انتخاب می‌شد؛ نتیجه
   * ممکن بود هشدارِ درست با مبلغ/علت نادرست باشد. هیچ عددی تغییر نمی‌کند؛ فقط
   * منشأ اختلاف برای UI صریح می‌شود.
   */
  const hasOfficialDiscrepancy = Math.abs(vsOfficial) > 0
  const hasChainDiscrepancy = chainEnd !== undefined && Math.abs(vsChain) > 0
  const hasDiscrepancy = hasOfficialDiscrepancy || hasChainDiscrepancy
  const discrepancyKind: SplitDiscrepancyKind = hasOfficialDiscrepancy
    ? 'OFFICIAL_REFERENCE'
    : hasChainDiscrepancy
      ? 'CHAIN_COMPOSITION'
      : null
  const discrepancy = discrepancyKind === 'OFFICIAL_REFERENCE' ? vsOfficial : vsChain

  return {
    drawer,
    pos,
    other,
    managerOutside,
    sum,
    vsOfficial,
    vsChain,
    hasOfficialDiscrepancy,
    hasChainDiscrepancy,
    hasDiscrepancy,
    discrepancyKind,
    discrepancy
  }
}
