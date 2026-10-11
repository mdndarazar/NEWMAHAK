/**
 * ===========================================================================
 * نشست ۳۱۹ — کاتالوگ قواعد ریشه‌یابی و تحلیل آموزشی مغایرت پل (shared خالص).
 *
 * انضباط فایل (F7):
 *   • بدون reduce عددی یا تغییر مبالغ.
 *   • تمام توضیحات دارای لحن TENTATIVE و جنبه آموزشی هستند.
 * ===========================================================================
 */

import type { BridgeDocDetail, BridgeRootCause, SuspectReason } from './types'
import { money, faDigits } from './jalali'

export function explainRootCause(
  detail: BridgeDocDetail,
  ctx: {
    rowKey: string
    reasons: SuspectReason[]
    period: { fromJalali: string; toJalali: string }
  }
): BridgeRootCause {
  const { rowKey, reasons, period } = ctx
  const method = detail.settlement?.method

  // قاعده ۱: خروج نقد روی فاکتور نسیه
  if (
    (rowKey === 'cashRefunds' || rowKey === 'exchangeCashRefunds') &&
    detail.parent?.settlementKind === 'CREDIT_ONLY'
  ) {
    return {
      ruleId: 'R-CASH-ON-CREDIT',
      narrative: `ثبت بازپرداخت نقدی به مبلغ ${money(detail.settlement.amount)} ریال روی فاکتور #${faDigits(detail.parent.receiptNo)} که نسیه کامل بوده است.`,
      accountingRoot: 'پولی که بابت این فاکتور هرگز دریافت نشده بود، به عنوان خروج نقدی ثبت شده است؛ این خروج از دخل کسر شده در حالی که ورودی متناظری در دریافتی‌های این دوره وجود ندارد.',
      lesson: 'در برگشت فاکتورهای نسیه، همیشه گزینه «بدون پرداخت / فقط کاهش بدهی» را انتخاب کنید تا از دخل پولی کسر نشود.',
      lessonMethod: 'NONE'
    }
  }

  // قاعده ۲: بازپرداخت کارتی (پوز)
  if (method === 'CARD' || rowKey === 'cardRefunds' || rowKey === 'exchangeCardRefunds') {
    return {
      ruleId: 'R-POS-CARD-REFUND',
      narrative: `ثبت بازپرداخت کارتی (کارت‌خوان) به مبلغ ${money(detail.settlement.amount)} ریال برای ${detail.docType === 'EXCHANGE' ? 'سند تعویض' : 'سند برگشت'} #${faDigits(detail.docNo)}.`,
      accountingRoot: 'دستگاه‌های کارت‌خوان بانکی معمولی امکان واریز برگشت وجه به کارت مشتری را ندارند. ثبت این روش باعث ایجاد کسری غیرواقعی در دخل کارت‌خوان می‌شود.',
      lesson: 'برای بازپرداخت غیرنقدی به حساب مشتری، همیشه گزینه «کارت‌به‌کارت توسط مدیر» را انتخاب کنید.',
      lessonMethod: 'CARD_TO_CARD'
    }
  }

  // قاعده ۳: رویداد دوره‌های قبل
  if (
    reasons.includes('SOURCE_OUT_OF_PERIOD') ||
    (detail.parent?.dateJalali && detail.parent.dateJalali < period.fromJalali)
  ) {
    return {
      ruleId: 'R-PRIOR-PERIOD-RETURN',
      narrative: `برگشت کالای فاکتور #${faDigits(detail.parent?.receiptNo ?? 0)} مربوط به تاریخ گذشته (${faDigits(detail.parent?.dateJalali ?? '—')}) در دوره جاری.`,
      accountingRoot: 'فروش این کالا در دوره گذشته ثبت و درآمدش شناسایی شده بود، اما بازپرداخت وجه آن در این دوره ثبت شده است.',
      lesson: 'این رویداد طبیعی است؛ در صورتی که فاکتور نسیه بوده گزینه «کاهش بدهی» و در غیر این صورت گزارش جامع شامل فاکتور مرجع را بررسی فرمایید.',
      lessonMethod: 'NONE'
    }
  }

  // قاعده ۴: اضافه‌دریافت بدون پیگیری
  if (rowKey === 'overpayReceived') {
    return {
      ruleId: 'R-OVERPAY-UNTRACKED',
      narrative: `دریافت وجه اضافه به مبلغ ${money(detail.settlement.amount)} ریال بیش از مبلغ بدهی فاکتور.`,
      accountingRoot: 'پولی وارد صندوق شده که متناظر با فروش کالا نبوده و اضافه‌دریافت شناخته شده است.',
      lesson: 'برای اضافه‌دریافت‌ها کد اعتبار خرید صادر کنید تا در سیستم به عنوان اعتبار مشتری نگهداری شود.',
      lessonMethod: 'STORE_CREDIT'
    }
  }

  // قاعده عمومی / پیش‌فرض
  return {
    ruleId: 'R-FALLBACK',
    narrative: `سند ${detail.docType === 'EXCHANGE' ? 'تعویض' : 'برگشت'} #${faDigits(detail.docNo)} با مبلغ ${money(detail.settlement.amount)} ریال ثبت شده است.`,
    accountingRoot: 'این سند به عنوان یکی از اسناد مؤثر بر عدم تراز پل تطبیق شناسایی شده است.',
    lesson: 'مشخصات سند و روش تسویه انتخاب‌شده را با واقعیت فیزیکی رویداد مقایسه فرمایید.'
  }
}
