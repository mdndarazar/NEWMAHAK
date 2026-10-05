import {
  MANAGER_ACCOUNT_ROW_LABEL,
  MANAGER_ACCOUNT_ROW_NOTE,
  DESTINATION_UNKNOWN_ROW_LABEL,
  DESTINATION_UNKNOWN_ROW_NOTE
} from '@shared/enums'

/**
 * ===========================================================================
 * کار الف — تفکیک ستون‌های «دریافتی» در جدول‌های گزارش (یک منبع حقیقت برای UI)
 *
 * تا جلسه ۳۶، هر جدولی خودش `cardTotal + otherTotal` را جمع می‌زد. یعنی چکِ
 * پاس‌شده و هر روش بانکیِ CUSTOM بی‌صدا داخل ستون «کارت» می‌نشست و هنگام مقایسه
 * با دستگاه کارتخوان اضافه‌ی بی‌دلیل می‌ساخت. حالا سرور چهار عدد مستقل می‌دهد و
 * این سه تابع — که *همه‌ی* جدول‌ها از آن‌ها استفاده می‌کنند — تنها جای تبدیل
 * «عدد سرور ⇒ ستون جدول» هستند:
 *
 *   کارت          = فقط پولی که با کارتخوان فروشگاه آمده
 *   حساب مدیر     = پولی که به حساب مدیر رفته (در انتظار صندوق/کارتخوان نیست)
 *   سایر/نامشخص   = روش‌های بانکیِ قدیمیِ بی‌مقصد + چکِ پاس‌شده‌ی قدیمیِ بی‌مقصد
 *
 * `?? 0` روی دو عدد تازه عمدی است: رکوردهای *سابقه‌ی* بستن صندوق که پیش از این
 * migration ثبت شده‌اند `null` دارند و هیچ عدد ساختگی نباید جایشان بنشیند.
 * ===========================================================================
 */
export interface DestinationTotalsLike {
  cardTotal: number
  otherTotal?: number | null
  managerAccountTotal?: number | null
  destinationUnknownTotal?: number | null
}

/** ستون «کارت»: فقط کارتخوان فروشگاه (دیگر «سایر» را در خود ندارد). */
export const cardOnlyOf = (r: DestinationTotalsLike): number => Math.round(r.cardTotal ?? 0)

/** ستون «حساب مدیر»: پولی که به فروشگاه نرسیده. */
export const managerAccountOf = (r: DestinationTotalsLike): number => Math.round(r.managerAccountTotal ?? 0)

/** ستون «سایر / نامشخص»: داده‌ی قدیمیِ بی‌مقصد و روش‌های غیرنقدی/غیرکارتی. */
export const otherOrUnknownOf = (r: DestinationTotalsLike): number =>
  Math.round(r.otherTotal ?? 0) + Math.round(r.destinationUnknownTotal ?? 0)

/** سه سرستونی که همه‌جا جای سرستون تکیِ «کارت» می‌نشینند (به همین ترتیب). */
export const DESTINATION_HEADERS: readonly string[] = ['کارت', MANAGER_ACCOUNT_ROW_LABEL, 'سایر / نامشخص']

/** همان سه سرستون، برای جدول‌های تنگ‌تر (پنجره‌ی شیفت و پنل حذف واریانت). */
export const DESTINATION_HEADERS_SHORT: readonly string[] = ['کارت', 'حساب مدیر', 'سایر / نامشخص']

export const DESTINATION_COLUMNS_NOTE =
  `ستون «کارت» فقط دریافتی کارتخوان فروشگاه است. «${MANAGER_ACCOUNT_ROW_LABEL}» ${MANAGER_ACCOUNT_ROW_NOTE}. ` +
  `«سایر / نامشخص» = ${DESTINATION_UNKNOWN_ROW_LABEL} (${DESTINATION_UNKNOWN_ROW_NOTE}) به‌اضافه‌ی روش‌های ` +
  'بانکیِ غیرنقدی/غیرکارتی.'

/** سه عدد ستون‌های مقصد، به ترتیب سرستون‌ها (برای چاپ و اکسل). */
export const destinationCells = (r: DestinationTotalsLike): number[] => [
  cardOnlyOf(r),
  managerAccountOf(r),
  otherOrUnknownOf(r)
]
