/**
 * نشست ۱۸۰ (S180-D1، گام ۰ خوشه M) — اعلان تایپ برای کتابخانه‌های بدون تایپ.
 *
 * `jalaali-js` هیچ فایل تعریف تایپی ندارد و زیر `strict` باعث خطای TS7016 روی
 * `src/shared/jalali.ts` می‌شد. امضاها عیناً از README و کاربرد واقعی پروژه
 * (`toJalaali`، `toGregorian`، `isValidJalaaliDate`) گرفته شده‌اند.
 *
 * هیچ رفتار زمان‌اجرایی تغییر نمی‌کند؛ این فایل فقط برای typecheck است.
 */
declare module 'jalaali-js' {
  export interface JalaaliDate {
    jy: number
    jm: number
    jd: number
  }

  export interface GregorianDate {
    gy: number
    gm: number
    gd: number
  }

  export function toJalaali(date: Date): JalaaliDate
  export function toJalaali(gy: number, gm: number, gd: number): JalaaliDate

  export function toGregorian(jy: number, jm: number, jd: number): GregorianDate

  export function isValidJalaaliDate(jy: number, jm: number, jd: number): boolean

  export function isLeapJalaaliYear(jy: number): boolean
  export function jalaaliMonthLength(jy: number, jm: number): number
  export function j2d(jy: number, jm: number, jd: number): number
  export function d2j(jdn: number): JalaaliDate
  export function g2d(gy: number, gm: number, gd: number): number
  export function d2g(jdn: number): GregorianDate

  const jalaali: {
    toJalaali: typeof toJalaali
    toGregorian: typeof toGregorian
    isValidJalaaliDate: typeof isValidJalaaliDate
    isLeapJalaaliYear: typeof isLeapJalaaliYear
    jalaaliMonthLength: typeof jalaaliMonthLength
    j2d: typeof j2d
    d2j: typeof d2j
    g2d: typeof g2d
    d2g: typeof d2g
  }

  export default jalaali
}
