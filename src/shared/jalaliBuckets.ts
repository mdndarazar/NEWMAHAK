/**
 * بازه‌های شمسی برای «گزارش مدیریت».
 * عمداً فایل تازه است — `jalali.ts` منبع گزارش فروش دست نمی‌خورد.
 */
import jalaali from 'jalaali-js'
import { fromJalaliDate, isValidJalaliDate, toJalaliDate, toLatinDigits } from './jalali'

const p2 = (n: number) => String(n).padStart(2, '0')

export type MgmtGrain = 'day' | 'week' | 'month'

export interface JalaliSpan {
  fromJalali: string
  toJalali: string
  label: string
}

function norm(s: string): string {
  return toLatinDigits(String(s || '')).trim()
}

/** رقم فارسی و روز/ماه بدون صفر → yyyy/MM/dd لاتین. نامعتبر = null. */
export function normalizeJalaliYmd(s: string | null | undefined): string | null {
  const parts = norm(String(s || '')).split('/')
  if (parts.length !== 3) return null
  const [jy, jm, jd] = parts.map(Number)
  if (![jy, jm, jd].every((n) => Number.isInteger(n))) return null
  if (!jalaali.isValidJalaaliDate(jy, jm, jd)) return null
  return jalaliYmd(jy, jm, jd)
}

function parse(s: string): { jy: number; jm: number; jd: number } {
  const [jy, jm, jd] = norm(s).split('/').map(Number)
  return { jy, jm, jd }
}

export function jalaliYmd(jy: number, jm: number, jd: number): string {
  return `${jy}/${p2(jm)}/${p2(jd)}`
}

export function addJalaliDays(s: string, days: number): string {
  const d = fromJalaliDate(norm(s))
  d.setDate(d.getDate() + days)
  return toJalaliDate(d)
}

export function jalaliCmp(a: string, b: string): number {
  return norm(a).localeCompare(norm(b))
}

/** شنبهٔ همان هفته (هفته از شنبه تا جمعه). */
export function saturdayOf(s: string): string {
  const d = fromJalaliDate(norm(s))
  const sinceSat = (d.getDay() + 1) % 7
  d.setDate(d.getDate() - sinceSat)
  return toJalaliDate(d)
}

export function fridayOf(s: string): string {
  return addJalaliDays(saturdayOf(s), 6)
}

export function monthStart(s: string): string {
  const { jy, jm } = parse(s)
  return jalaliYmd(jy, jm, 1)
}

export function monthEnd(s: string): string {
  const { jy, jm } = parse(s)
  const dim = jalaali.jalaaliMonthLength(jy, jm)
  return jalaliYmd(jy, jm, dim)
}

export function monthLength(jy: number, jm: number): number {
  return jalaali.jalaaliMonthLength(jy, jm)
}

export function shiftJalaliMonth(s: string, delta: number): { jy: number; jm: number } {
  const p = parse(s)
  const idx = p.jy * 12 + (p.jm - 1) + delta
  const jy = Math.floor(idx / 12)
  const jm = (idx % 12) + 1
  return { jy, jm }
}

export const GRAIN_CAPS: Record<MgmtGrain, number> = { day: 62, week: 53, month: 24 }

export function enumerateBuckets(fromJalali: string, toJalali: string, grain: MgmtGrain): JalaliSpan[] {
  const from = norm(fromJalali)
  const to = norm(toJalali)
  if (!isValidJalaliDate(from) || !isValidJalaliDate(to)) {
    throw new Error('بازهٔ شمسی نامعتبر است.')
  }
  if (jalaliCmp(from, to) > 0) throw new Error('تاریخ شروع بعد از پایان است.')
  const out: JalaliSpan[] = []
  if (grain === 'day') {
    let cur = from
    while (jalaliCmp(cur, to) <= 0) {
      out.push({ fromJalali: cur, toJalali: cur, label: cur })
      cur = addJalaliDays(cur, 1)
    }
  } else if (grain === 'week') {
    let sat = saturdayOf(from)
    while (jalaliCmp(sat, to) <= 0) {
      const fri = fridayOf(sat)
      const a = jalaliCmp(sat, from) < 0 ? from : sat
      const b = jalaliCmp(fri, to) > 0 ? to : fri
      out.push({ fromJalali: a, toJalali: b, label: `${a} تا ${b}` })
      sat = addJalaliDays(sat, 7)
    }
  } else {
    let { jy, jm } = parse(from)
    const end = parse(to)
    while (jy < end.jy || (jy === end.jy && jm <= end.jm)) {
      const ms = jalaliYmd(jy, jm, 1)
      const me = monthEnd(ms)
      const a = jalaliCmp(ms, from) < 0 ? from : ms
      const b = jalaliCmp(me, to) > 0 ? to : me
      out.push({ fromJalali: a, toJalali: b, label: `${jy}/${p2(jm)}` })
      const n = shiftJalaliMonth(ms, 1)
      jy = n.jy
      jm = n.jm
    }
  }
  if (out.length > GRAIN_CAPS[grain]) {
    throw new Error(
      grain === 'day'
        ? 'بازهٔ روزانه بیش از ۶۲ روز است. بازه را کوچک‌تر کنید.'
        : grain === 'week'
          ? 'بازهٔ هفتگی بیش از ۵۳ هفته است. بازه را کوچک‌تر کنید.'
          : 'بازهٔ ماهانه بیش از ۲۴ ماه است. بازه را کوچک‌تر کنید.'
    )
  }
  return out
}

/** اگر بازهٔ جاری تا «امروز» ناقص است، بازهٔ قبل را هم‌تعداد روز می‌برد. */
export function previousEqualLength(fromJalali: string, toJalali: string): JalaliSpan {
  const from = norm(fromJalali)
  const to = norm(toJalali)
  const days = Math.round((fromJalaliDate(to).getTime() - fromJalaliDate(from).getTime()) / 86400000) + 1
  const prevTo = addJalaliDays(from, -1)
  const prevFrom = addJalaliDays(prevTo, -(days - 1))
  return { fromJalali: prevFrom, toJalali: prevTo, label: `${prevFrom} تا ${prevTo}` }
}

/** همین ماه شمسی پارسال (روز ۱ تا همان روز N اگر ماه جاری ناقص باشد). */
export function sameMonthLastYear(fromJalali: string, toJalali: string): JalaliSpan {
  const a = parse(fromJalali)
  const b = parse(toJalali)
  const fromLy = a.jy - 1
  const toLy = b.jy - 1
  const fromLen = monthLength(fromLy, a.jm)
  const toLen = monthLength(toLy, b.jm)
  const from = jalaliYmd(fromLy, a.jm, Math.min(a.jd, fromLen))
  const to = jalaliYmd(toLy, b.jm, Math.min(b.jd, toLen))
  const note = toLen !== monthLength(b.jy, b.jm) ? ` (${toLen} روز در مقابل ${monthLength(b.jy, b.jm)} روز)` : ''
  return { fromJalali: from, toJalali: to, label: `${from} تا ${to}${note}` }
}
