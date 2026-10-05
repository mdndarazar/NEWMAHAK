/**
 * نشست ۱۳۷ · خوشه E
 *
 * یک نشستِ باز که از نیمه‌شب عبور کرده نباید بی‌صدا مثل نشست یک‌روزه نمایش
 * داده شود. هشدار باید از main بیاید تا UI نتواند آن را حدس اشتباه بزند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s137-multi-day-session-warning.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const serviceSource = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
const typeSource = readFileSync(resolve('src/shared/types.ts'), 'utf8')
const uiSource = readFileSync(resolve('src/renderer/src/components/ShiftSessionModal.tsx'), 'utf8')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq('قرارداد داده هشدار نشست چندروزه را دارد', /multiDayWarning\?: string \| null/.test(typeSource), true)
eq('main هشدار را از تاریخ واقعی باز و بسته/اکنون محاسبه می‌کند', /coveredFromJalali\s*=\s*toJalaliDate\(shift\.openedAt\)[\s\S]{0,500}const multiDayWarning/.test(serviceSource), true)
eq('UI هشدار main را واقعاً نمایش می‌دهد', /multiDayWarning/.test(uiSource), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s137-multi-day-session-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate, faDigits } = await import('../../src/shared/jalali.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const user = seed.user('کارمند نشست چندروزه')
const now = Date.now()
const openedLongAgo = now - 36 * 60 * 60 * 1000
const longShift = seed.insert('Shift', {
  name: 'شب',
  number: 1,
  dayJalali: toJalaliDate(new Date(openedLongAgo)),
  openedAt: openedLongAgo,
  userId: user,
  staffConfirmed: 1
})
const sameDayShift = seed.insert('Shift', {
  name: 'صبح',
  number: 2,
  dayJalali: toJalaliDate(new Date(now)),
  openedAt: now,
  userId: user,
  staffConfirmed: 1
})

const longInfo = await shiftService.info(longShift)
const sameDayInfo = await shiftService.info(sameDayShift)
const fromDay = toJalaliDate(new Date(openedLongAgo))
const toDay = toJalaliDate(new Date(now))

eq('نشستِ عبورکرده از نیمه‌شب هشدار متنی دارد', typeof longInfo?.multiDayWarning, 'string')
eq(
  'هشدار نشست چندروزه هر دو روز شمسی را نام می‌برد',
  !!longInfo?.multiDayWarning?.includes(faDigits(fromDay)) && !!longInfo?.multiDayWarning?.includes(faDigits(toDay)),
  true
)
eq('نشستِ همان روز هشدار چندروزه ندارد', sameDayInfo?.multiDayWarning ?? null, null)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
