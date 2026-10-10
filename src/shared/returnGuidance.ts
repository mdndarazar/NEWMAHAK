/**
 * ===========================================================================
 * نشست ۳۱۹ — ماتریس تصمیم هوشمند و هدایت فرآیند برگشت و تعویض کالا (shared خالص).
 *
 * انضباط فایل:
 *   • این فایل هیچ محاسبه‌ی پولی یا سقف جدیدی حساب نمی‌کند؛
 *   • تمام سقف‌ها و ارقام از InvoiceSettlementProfile (سرور) خوانده می‌شوند.
 *   • فقط مقایسه‌های منطقی (===, >, <) و برچسب‌های راهنما.
 * ===========================================================================
 */

import type { InvoiceSettlementProfile } from './types'

export type RefundMethodValue = 'CASH' | 'CARD' | 'STORE_CREDIT' | 'CARD_TO_CARD' | 'NONE'

export type MethodAvailability =
  | { state: 'RECOMMENDED'; reason?: string }
  | { state: 'ALLOWED'; reason?: string }
  | { state: 'MANAGER_ONLY'; reasonCode: 'POS_NO_REVERSE' | 'CASH_ON_CREDIT'; reason: string }
  | { state: 'BLOCKED'; reasonCode: 'NO_CASHLIKE' | 'DEBT_REMAINS'; reason: string }

export interface GuidanceNotice {
  code:
    | 'CREDIT_INVOICE_DEBT_ONLY'
    | 'CREDIT_REACTIVATES_FULL'
    | 'CREDIT_NOT_REACTIVATED_PARTIAL'
    | 'CASH_CAP'
    | 'SPLIT_TO_NEW_CREDIT'
    | 'POS_CANNOT_REVERSE'
    | 'EXCHANGE_POSITIVE'
    | 'EXCHANGE_NEGATIVE'
    | 'EXCHANGE_ZERO'
  tone: 'info' | 'warn' | 'danger'
  text: string
  amountRef?: 'cashLikeRefundableNow' | 'remainingDebt' | 'redemptionsTotal'
}

export interface ReturnGuidance {
  recommended: RefundMethodValue
  methods: Record<RefundMethodValue, MethodAvailability>
  notices: GuidanceNotice[]
  suggestedAmountRef: 'cashLikeRefundableNow' | null
}

export function guideReturn(input: {
  profile?: InvoiceSettlementProfile | null
  isFullReturn: boolean
}): ReturnGuidance {
  const p = input.profile
  const isFull = input.isFullReturn

  if (!p || p.kind === 'CREDIT_ONLY') {
    return {
      recommended: 'NONE',
      methods: {
        NONE: { state: 'RECOMMENDED', reason: 'کاهش بدهی نسیه و برگشت کالا به انبار بدون خروج پول از دخل.' },
        CASH: {
          state: 'MANAGER_ONLY',
          reasonCode: 'CASH_ON_CREDIT',
          reason: 'فاکتور نسیه بوده و پولی دریافت نشده؛ خروج نقد نیازمند تأیید مدیر است.'
        },
        CARD: {
          state: 'MANAGER_ONLY',
          reasonCode: 'POS_NO_REVERSE',
          reason: 'پوزهای بانکی امکان بازپرداخت مستقیم ندارند؛ نیازمند تأیید مدیر است.'
        },
        CARD_TO_CARD: {
          state: 'BLOCKED',
          reasonCode: 'NO_CASHLIKE',
          reason: 'پولی برای این فاکتور پرداخت نشده است.'
        },
        STORE_CREDIT: {
          state: 'BLOCKED',
          reasonCode: 'DEBT_REMAINS',
          reason: 'فاکتور دارای بدهی نسیه است؛ صدور اعتبار برای فاکتور بدهکار مجاز نیست.'
        }
      },
      notices: [
        {
          code: 'CREDIT_INVOICE_DEBT_ONLY',
          tone: 'info',
          text: 'این فاکتور کاملاً نسیه بوده و دریافتی نقدی ندارد. با انتخاب «بدون بازپرداخت»، بدهی مشتری کسر و کالا به انبار بازمی‌گردد.'
        }
      ],
      suggestedAmountRef: null
    }
  }

  if (p.kind === 'STORE_CREDIT_FUNDED') {
    const notices: GuidanceNotice[] = []
    if (isFull) {
      notices.push({
        code: 'CREDIT_REACTIVATES_FULL',
        tone: 'info',
        text: 'با ثبت این برگشت کامل، کد اعتبار خرید قبلی مشتری به صورت خودکار مجدداً فعال می‌شود.'
      })
    } else {
      notices.push({
        code: 'CREDIT_NOT_REACTIVATED_PARTIAL',
        tone: 'info',
        text: 'در برگشت جزئی، کد اعتبار قبلی دست‌نخورده می‌ماند و سهم بازپرداخت از بخش نقدی انجام می‌شود.'
      })
    }
    notices.push({
      code: 'SPLIT_TO_NEW_CREDIT',
      tone: 'info',
      text: 'در صورت تمایل مشتری برای دریافت اعتبار به جای پول، یک کد اعتباری جدید برای سهم نقدی صادر می‌شود.'
    })

    return {
      recommended: 'CARD_TO_CARD',
      methods: {
        NONE: { state: 'ALLOWED', reason: 'ثبت برگشت بدون خروج وجه نقدی.' },
        CASH: { state: 'ALLOWED', reason: 'بازپرداخت نقدی سهم پرداختی از کشوی دخل.' },
        CARD: {
          state: 'MANAGER_ONLY',
          reasonCode: 'POS_NO_REVERSE',
          reason: 'پوزهای بانکی امکان برگشت وجه ندارند؛ نیازمند تأیید مدیر است.'
        },
        CARD_TO_CARD: {
          state: 'RECOMMENDED',
          reason: 'ثبت درخواست کارت‌به‌کارت سهم نقدی برای تأیید مدیر (پیشنهاد استاندارد).'
        },
        STORE_CREDIT: {
          state: 'ALLOWED',
          reason: 'صدور بارکد اعتبار جدید برای سهم پرداختی نقدی.'
        }
      },
      notices,
      suggestedAmountRef: 'cashLikeRefundableNow'
    }
  }

  if (p.kind === 'MIXED') {
    return {
      recommended: p.remainingDebt > 0 ? 'NONE' : 'CARD_TO_CARD',
      methods: {
        NONE: {
          state: p.remainingDebt > 0 ? 'RECOMMENDED' : 'ALLOWED',
          reason: 'کسر از بدهی باقیمانده مشتری.'
        },
        CASH: {
          state: 'ALLOWED',
          reason: 'بازپرداخت نقدی تا سقف مبالغ واقعاً پرداخت‌شده.'
        },
        CARD: {
          state: 'MANAGER_ONLY',
          reasonCode: 'POS_NO_REVERSE',
          reason: 'پوزهای بانکی امکان بازپرداخت ندارند؛ نیازمند تأیید مدیر است.'
        },
        CARD_TO_CARD: {
          state: 'ALLOWED',
          reason: 'ثبت درخواست کارت‌به‌کارت توسط مدیر.'
        },
        STORE_CREDIT:
          p.remainingDebt > 0
            ? {
                state: 'BLOCKED',
                reasonCode: 'DEBT_REMAINS',
                reason: 'تا زمان تسویه کامل بدهی، صدور اعتبار مجاز نیست.'
              }
            : {
                state: 'ALLOWED',
                reason: 'صدور بارکد اعتبار خرید.'
              }
      },
      notices: [
        {
          code: 'CASH_CAP',
          tone: 'warn',
          text: 'این فاکتور ترکیبی از نقد و نسیه است؛ بازپرداخت نقدی فقط تا سقف دریافتی واقعی مجاز است.'
        }
      ],
      suggestedAmountRef: 'cashLikeRefundableNow'
    }
  }

  // PAID_CASHLIKE & EXCHANGE_DOC
  return {
    recommended: 'CARD_TO_CARD',
    methods: {
      NONE: { state: 'ALLOWED', reason: 'بدون خروج پول از دخل.' },
      CASH: { state: 'ALLOWED', reason: 'پرداخت نقدی از کشوی دخل.' },
      CARD: {
        state: 'MANAGER_ONLY',
        reasonCode: 'POS_NO_REVERSE',
        reason: 'پوزهای بانکی امکان بازپرداخت مستقیم ندارند؛ نیازمند تأیید مدیر است.'
      },
      CARD_TO_CARD: {
        state: 'RECOMMENDED',
        reason: 'ثبت درخواست کارت‌به‌کارت توسط مدیر (پیشنهاد استاندارد تسویه غیرنقدی).'
      },
      STORE_CREDIT: {
        state: 'ALLOWED',
        reason: 'صدور بارکد اعتبار خرید بعدی برای مشتری.'
      }
    },
    notices: [
      {
        code: 'POS_CANNOT_REVERSE',
        tone: 'warn',
        text: 'برای بازپرداخت به حساب بانکی مشتری، از «کارت‌به‌کارت توسط مدیر» استفاده کنید؛ دستگاه‌های کارت‌خوان بانکی پوز امکان برگشت وجه ندارند.'
      }
    ],
    suggestedAmountRef: 'cashLikeRefundableNow'
  }
}

export type ExchangeStep =
  | { step: 'DIFF_ZERO'; text: string }
  | { step: 'CUSTOMER_PAYS'; text: string }
  | {
      step: 'WE_OWE'
      options: Record<'DEBT_CUT' | 'CASH' | 'CARD' | 'CARD_TO_CARD' | 'STORE_CREDIT', MethodAvailability>
      recommended: 'DEBT_CUT' | 'CASH' | 'CARD' | 'CARD_TO_CARD' | 'STORE_CREDIT'
      text: string
    }

export function guideExchange(input: {
  profile?: InvoiceSettlementProfile | null
  diff: number
}): ExchangeStep {
  const { profile: p, diff } = input

  if (diff === 0) {
    return {
      step: 'DIFF_ZERO',
      text: 'ارزش کالای جایگزین با کالای مرجوعی برابر است؛ نیازی به تبادل مالی نیست.'
    }
  }

  if (diff > 0) {
    return {
      step: 'CUSTOMER_PAYS',
      text: 'مشتری باید مابه‌التفاوت را پرداخت کند (نقدی، کارتی، یا نسیه).'
    }
  }

  // diff < 0 (ما بدهکاریم)
  const isCredit = p?.kind === 'CREDIT_ONLY'
  if (isCredit) {
    return {
      step: 'WE_OWE',
      recommended: 'DEBT_CUT',
      options: {
        DEBT_CUT: { state: 'RECOMMENDED', reason: 'کاهش بدهی فاکتور اصلی مشتری (بدون خروج پول).' },
        CASH: { state: 'BLOCKED', reasonCode: 'NO_CASHLIKE', reason: 'فاکتور اصلی نسیه بوده و خروج نقد مجاز نیست.' },
        CARD: { state: 'BLOCKED', reasonCode: 'NO_CASHLIKE', reason: 'فاکتور اصلی نسیه بوده است.' },
        CARD_TO_CARD: { state: 'BLOCKED', reasonCode: 'NO_CASHLIKE', reason: 'فاکتور اصلی نسیه بوده است.' },
        STORE_CREDIT: { state: 'BLOCKED', reasonCode: 'DEBT_REMAINS', reason: 'فاکتور اصلی دارای بدهی نسیه است.' }
      },
      text: 'فاکتور مرجع نسیه بوده است؛ مابه‌التفاوت منفی صرفاً بدهی مشتری را کاهش می‌دهد.'
    }
  }

  return {
    step: 'WE_OWE',
    recommended: 'CARD_TO_CARD',
    options: {
      DEBT_CUT: { state: 'ALLOWED', reason: 'کاهش بدهی در صورت وجود.' },
      CASH: { state: 'ALLOWED', reason: 'پرداخت نقد از کشوی دخل.' },
      CARD: {
        state: 'MANAGER_ONLY',
        reasonCode: 'POS_NO_REVERSE',
        reason: 'پوزهای بانکی امکان برگشت وجه ندارند؛ نیازمند تأیید مدیر است.'
      },
      CARD_TO_CARD: {
        state: 'RECOMMENDED',
        reason: 'ثبت درخواست کارت‌به‌کارت توسط مدیر (پیشنهاد استاندارد).'
      },
      STORE_CREDIT: {
        state: 'ALLOWED',
        reason: 'صدور بارکد اعتبار خرید بعدی.'
      }
    },
    text: 'فروشگاه بدهکار است؛ روش تسویه مابه‌التفاوت منفی را انتخاب کنید.'
  }
}
