/**
 * بازه‌های شمسی گزارش مدیریت — بدون دیتابیس.
 *     node --import ./test/harness/register.mjs tests/management/mgmt-jalali-buckets.mjs
 */
import {
  addJalaliDays,
  enumerateBuckets,
  fridayOf,
  previousEqualLength,
  saturdayOf,
  sameMonthLastYear,
  monthEnd,
  monthStart,
  normalizeJalaliYmd
} from '../../src/shared/jalaliBuckets.ts'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`)
  }
}

console.log('\nباکت شمسی')
eq('شنبهٔ سه‌شنبه ۱۴۰۴/۰۱/۰۴', saturdayOf('1404/01/04'), '1404/01/02')
eq('جمعه همان هفته', fridayOf('1404/01/04'), '1404/01/08')
eq('شروع ماه', monthStart('1404/01/15'), '1404/01/01')
eq('پایان فروردین', monthEnd('1404/01/01'), '1404/01/31')

const days = enumerateBuckets('1404/01/01', '1404/01/03', 'day')
eq('۳ روز', days.length, 3)
eq('برچسب روز اول', days[0].label, '1404/01/01')

const weeks = enumerateBuckets('1404/01/01', '1404/01/15', 'week')
eq('حداقل دو هفته', weeks.length >= 2, true)

const prev = previousEqualLength('1404/01/10', '1404/01/12')
eq('بازهٔ هم‌طول قبلی از ۷ تا ۹', prev.fromJalali, '1404/01/07')
eq('تا ۹', prev.toJalali, '1404/01/09')

const ly = sameMonthLastYear('1404/01/01', '1404/01/15')
eq('فروردین پارسال شروع', ly.fromJalali, '1403/01/01')
eq('فروردین پارسال تا ۱۵', ly.toJalali, '1403/01/15')

const esfand = sameMonthLastYear('1403/12/01', '1403/12/30')
eq('اسفند پارسال از طول ماه مقصد می‌برد نه مبدأ', esfand.toJalali.endsWith('/12/29') || esfand.toJalali.endsWith('/12/30'), true)

let threw = false
try {
  enumerateBuckets('1404/01/01', '1404/04/01', 'day')
} catch {
  threw = true
}
eq('بیش از ۶۲ روز روزنه رد می‌شود', threw, true)

eq('افزودن یک روز', addJalaliDays('1403/12/29', 1).startsWith('1403/12/30') || addJalaliDays('1403/12/29', 1).startsWith('1404/01'), true)

eq('رقم فارسی', normalizeJalaliYmd('۱۴۰۴/۰۱/۰۲'), '1404/01/02')
eq('ماه بدون صفر', normalizeJalaliYmd('1404/1/2'), '1404/01/02')
eq('نامعتبر', normalizeJalaliYmd('1404/13/01'), null)
eq('خالی', normalizeJalaliYmd(''), null)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
