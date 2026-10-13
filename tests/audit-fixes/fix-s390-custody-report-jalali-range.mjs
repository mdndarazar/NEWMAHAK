/**
 * Phase 9 — a manager may anchor the custody audit page to the valid Jalali
 * range already selected in Cash Close. Renderer converts only calendar
 * boundaries; Main remains the range-validation authority and pagination
 * reuses the resulting ISO anchor.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s390-custody-report-jalali-range.mjs
 */
import { readFileSync } from 'node:fs'

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

const { jalaliStartOfDay, jalaliEndOfDay, isValidJalaliDate } = await import('@shared/jalali')
const cashClose = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
const service = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const known = '1405/01/15'
const start = jalaliStartOfDay(known)
const end = jalaliEndOfDay(known)

eq('روز شمسی معتبر است', isValidJalaliDate(known), true)
eq('ابتدای روز پیش از انتهای همان روز است', start.getTime() < end.getTime(), true)
eq('بازهٔ تقویمی شامل کل روز است', end.getTime() - start.getTime() >= 23 * 60 * 60_000, true)
eq('رشتهٔ نامعتبر برای checkbox معتبر شمرده نمی‌شود', isValidJalaliDate('1405/99/99'), false)
eq('UI حالت صریح بازهٔ شمسی دارد', cashClose.includes('custodyUseSelectedDateRange') && cashClose.includes('بازهٔ شمسیِ فیلتر'), true)
eq('UI از helper مشترک ابتدا/انتهای روز استفاده می‌کند', cashClose.includes('jalaliStartOfDay(filters.fromJalali)') && cashClose.includes('jalaliEndOfDay(filters.toJalali)'), true)
eq('UI ISO bounded را در همان report anchor نگه می‌دارد', cashClose.includes("range = { from: from.toISOString(), to: to.toISOString() }") && cashClose.includes('custodyReportRangeRef.current = range'), true)
eq('بازهٔ شمسی معکوس پیش از خواندن گزارش fail-closed می‌شود', cashClose.includes('پایان بازهٔ شمسی نمی‌تواند پیش از آغاز آن باشد') && cashClose.includes('setCustodyTimeline(null)'), true)
eq('checkbox برای تاریخ نامعتبر یا بازهٔ معکوس فعال نمی‌شود', cashClose.includes("!isValidJalaliDate(filters.fromJalali)") && cashClose.includes('jalaliEndOfDay(filters.toJalali).getTime() < jalaliStartOfDay(filters.fromJalali).getTime()'), true)
eq('Main همچنان از ISO نامعتبر fail-closed محافظت می‌کند', service.includes("'CUSTODY_REPORT_RANGE_INVALID'") && service.includes('بازهٔ گزارش حضانت معتبر نیست'), true)
eq('pagination/export همان timeline anchored را مصرف می‌کنند', cashClose.includes('...range,') && cashClose.includes('custodyTimeline.from') && cashClose.includes('custodyTimeline.to'), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
