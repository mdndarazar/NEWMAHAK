import jalaali from 'jalaali-js'

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹']
export const JALALI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند']
export const WEEKDAYS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه']

const p2 = (n: number) => String(n).padStart(2, '0')

/** yyyy/MM/dd شمسی */
export function toJalaliDate(d: Date): string {
  const j = jalaali.toJalaali(d.getFullYear(), d.getMonth() + 1, d.getDate())
  return `${j.jy}/${p2(j.jm)}/${p2(j.jd)}`
}

export function toJalaliDateTime(d: Date): string {
  return `${toJalaliDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** '1405/06/23' → Date میلادی (شروع روز) */
export function fromJalaliDate(s: string): Date {
  const [jy, jm, jd] = s.split('/').map(Number)
  const g = jalaali.toGregorian(jy, jm, jd)
  return new Date(g.gy, g.gm - 1, g.gd)
}

export function startOfJalaliToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 0, 0, 0)
}
export function endOfJalaliToday(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate(), 23, 59, 59, 999)
}

/** امروز به‌صورت yyyy/MM/dd شمسی */
export function jalaliToday(): string {
  return toJalaliDate(new Date())
}

/** ارقام فارسی/عربی ورودی کاربر → لاتین (برای پارس تاریخ و اعداد) */
export function toLatinDigits(input: string): string {
  const fa = '\u06F0\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'
  const ar = '\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669'
  return String(input)
    .replace(/[\u06F0-\u06F9]/g, (d) => String(fa.indexOf(d)))
    .replace(/[\u0660-\u0669]/g, (d) => String(ar.indexOf(d)))
}

/** اعتبارسنجی رشته‌ی yyyy/MM/dd شمسی (ارقام فارسی هم پذیرفته می‌شود) */
export function isValidJalaliDate(s: string): boolean {
  const parts = toLatinDigits(s).trim().split('/')
  if (parts.length !== 3) return false
  const [jy, jm, jd] = parts.map(Number)
  if (![jy, jm, jd].every((n) => Number.isInteger(n))) return false
  return jalaali.isValidJalaaliDate(jy, jm, jd)
}

/**
 * '1405/06/25' → Date میلادی.
 * اگر تاریخ «امروز» باشد ساعت واقعی حفظ می‌شود (تا فاکتور در بازه‌ی ساعتی
 * گزارش‌ها و بستن صندوق درست بیفتد)؛ در غیر این صورت ظهر آن روز ثبت می‌شود.
 */
export function jalaliToDateTime(s: string): Date {
  const clean = toLatinDigits(s).trim()
  const now = new Date()
  if (clean === toJalaliDate(now)) return now
  const d = fromJalaliDate(clean)
  d.setHours(12, 0, 0, 0)
  return d
}

/** yyyy/MM/dd شمسی → ابتدای آن روز (برای فیلتر بازه) */
export function jalaliStartOfDay(s: string): Date {
  const d = fromJalaliDate(toLatinDigits(s).trim())
  d.setHours(0, 0, 0, 0)
  return d
}

/** yyyy/MM/dd شمسی → انتهای آن روز (برای فیلتر بازه) */
export function jalaliEndOfDay(s: string): Date {
  const d = fromJalaliDate(toLatinDigits(s).trim())
  d.setHours(23, 59, 59, 999)
  return d
}

/** ارقام فارسی برای نمایش (نه برای ذخیره‌سازی) */
export function faDigits(input: string | number | bigint): string {
  return String(input).replace(/\d/g, (d) => FA_DIGITS[Number(d)])
}

/**
 * ۱٬۲۳۴٬۵۶۷
 *
 * ⚠️ نشست ۱۸۱ — ورودی `bigint` هم پذیرفته می‌شود (بند ۴-۲۸ الف).
 *
 * این فقط «راضی کردن کامپایلر» نیست؛ یک بهبود واقعی در دقت است:
 * `Intl.NumberFormat` مقدار `bigint` را **دقیق** قالب‌بندی می‌کند، در حالی که
 * مسیر قبلی (`Math.round(n)`) هر مبلغ بالاتر از `Number.MAX_SAFE_INTEGER` را
 * بی‌صدا گرد می‌کرد. یعنی جمع سالانه‌ی یک فروشگاه پرگردش تا دیروز می‌توانست
 * روی فیش و گزارش، عددِ غلط چاپ کند.
 *
 * `bigint` عمداً از مسیر `Math.round` رد نمی‌شود: مبلغ ریالی همیشه صحیح است و
 * `Math.round` روی `bigint` استثنا می‌دهد.
 */
export function money(n: number | bigint | null | undefined, persian = true): string {
  const value = typeof n === 'bigint' ? n : Math.round(n || 0)
  const s = new Intl.NumberFormat('en-US').format(value).replace(/,/g, '٬')
  return persian ? faDigits(s) : s
}

/** ساعت به‌صورت HH:mm:ss (برای ستون «ساعت» گزارش فروش) */
export function toClock(d: Date, withSeconds = true): string {
  const base = `${p2(d.getHours())}:${p2(d.getMinutes())}`
  return withSeconds ? `${base}:${p2(d.getSeconds())}` : base
}

/**
 * ---------------------------------------------------------------------------
 * «تاریخ شمسی + ساعت» ⇒ یک لحظه‌ی واقعی (Date).
 *
 * لازم شد برای «زمان‌بندی خودکار تغییر قیمت» (نشست دهم، مورد ۱): مدیر یک تاریخ
 * شمسی و یک ساعت می‌دهد و برنامه باید *دقیقاً* سر همان لحظه عمل کند، پس
 * `jalaliToDateTime` (که برای روزهای غیر‌امروز ساعت ۱۲ ظهر می‌گذارد) اینجا به
 * کار نمی‌آید.
 *
 * ساعت به هر شکلی پذیرفته می‌شود («۸:۵»، «8:5»، «0830»، «08:30:00») و ورودی
 * خراب یا خالی = ۰۰:۰۰ همان روز. ثانیه اگر داده شود حفظ می‌شود.
 * ---------------------------------------------------------------------------
 */
export function jalaliAtClock(dateStr: string, timeStr?: string | null): Date {
  const d = fromJalaliDate(toLatinDigits(String(dateStr ?? '')).trim())
  const raw = toLatinDigits(String(timeStr ?? '')).replace(/[^0-9:]/g, '').trim()
  let h = 0
  let m = 0
  let sec = 0
  if (raw.includes(':')) {
    const [a, b, c] = raw.split(':')
    h = Number(a) || 0
    m = Number(b) || 0
    sec = Number(c) || 0
  } else if (raw.length) {
    // «0830» ⇒ ۰۸:۳۰ · «8» ⇒ ۰۸:۰۰
    h = Number(raw.length <= 2 ? raw : raw.slice(0, raw.length - 2)) || 0
    m = raw.length > 2 ? Number(raw.slice(-2)) || 0 : 0
  }
  d.setHours(Math.min(23, Math.max(0, h)), Math.min(59, Math.max(0, m)), Math.min(59, Math.max(0, sec)), 0)
  return d
}

/** n روز به یک تاریخ شمسی اضافه/کم می‌کند و yyyy/MM/dd برمی‌گرداند. */
export function jalaliAddDays(s: string, n: number): string {
  const d = fromJalaliDate(toLatinDigits(s).trim())
  d.setDate(d.getDate() + n)
  return toJalaliDate(d)
}

/** فهرست روزهای شمسی یک بازه (شامل دو سر بازه). هیچ روزی بی‌صدا حذف نمی‌شود. */
export function jalaliDaysBetween(from: string, to: string): string[] {
  const start = fromJalaliDate(toLatinDigits(from).trim())
  const end = fromJalaliDate(toLatinDigits(to).trim())
  if (end < start) return []
  const out: string[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  while (true) {
    out.push(toJalaliDate(cur))
    if (toJalaliDate(cur) === toJalaliDate(end)) break
    cur.setDate(cur.getDate() + 1)
  }
  return out
}

/** اول همان ماه شمسی (برای پیش‌فرض بازه‌ی گزارش‌ها) */
export function jalaliMonthStart(day = jalaliToday()): string {
  return `${toLatinDigits(day).trim().slice(0, 8)}01`
}

/**
 * نشست ۱۴۹ · S147-a · S148-D3 — پارس عدد صحیح گروه‌بندی‌شده از ورودی متنی فرم (مثلاً قیمت به ریال).
 * ارقام فارسی/عربی به لاتین تبدیل و فقط جداکننده‌ی هزارگان (کاما، «٬»، «،» و فاصله) حذف می‌شود.
 * خالی ⇒ ۰. هر چیز دیگر (نقطه/«٫» اعشار، منفی، حرف، عدد خارج از بازه‌ی امن) ⇒ null تا فرم پیام
 * فارسی بدهد؛ قبلاً replace(/[^\d]/g,'') نقطه را حذف می‌کرد و «1200000.5» ده‌برابر (12000005) می‌شد.
 */
export function parseGroupedInteger(raw: unknown): number | null {
  const s = toLatinDigits(String(raw ?? '')).replace(/[,\u060C\u066C\s]/g, '')
  if (s === '') return 0
  if (!/^\d+$/.test(s)) return null
  const n = Number(s)
  return Number.isSafeInteger(n) ? n : null
}
