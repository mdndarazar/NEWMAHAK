import { endOfJalaliToday, jalaliEndOfDay, jalaliToday } from '../../src/shared/jalali.ts'

const today = jalaliToday()
const expected = jalaliEndOfDay(today).getTime()
const actual = endOfJalaliToday().getTime()
if (actual !== expected || new Date(actual).getMilliseconds() !== 999) {
  console.error(`✗ مرز پایان روز نادرست است: ${actual} در برابر ${expected}`)
  process.exitCode = 1
} else {
  console.log('✓ endOfJalaliToday با jalaliEndOfDay و میلی‌ثانیه‌ی ۹۹۹ یکسان است')
}
