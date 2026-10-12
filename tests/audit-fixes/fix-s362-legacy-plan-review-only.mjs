/**
 * The custody Settings workspace may review ShiftPlan compatibility records,
 * but it must not expose a legacy plan writer after Shift Settings became
 * canonical.  This source-level guard intentionally checks the renderer path.
 *
 * node tests/audit-fixes/fix-s362-legacy-plan-review-only.mjs
 */
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../../src/renderer/src/components/CustodyAdminChip.tsx', import.meta.url), 'utf8')
const settings = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
const checks = [
  ['بازبینی legacy هنوز داده‌ها را می‌خواند', source.includes('CH.custodyPlanList')],
  ['هیچ مسیر ذخیرهٔ ShiftPlan در workspace نیست', !source.includes('CH.custodyPlanSave')],
  ['هیچ مسیر حذف ShiftPlan در workspace نیست', !source.includes('CH.custodyPlanDelete')],
  ['تب shift به‌عنوان منبع canonical معرفی شده', source.includes('پیکربندی شیفت‌های جدید فقط در تب «شیفت‌ها»')],
  ['تنظیمات حضانت کاربر را به تب شیفت‌ها راهنمایی می‌کند', settings.includes('فقط در تب «شیفت‌ها» تعریف می‌شوند')]
]
let failed = 0
for (const [label, pass] of checks) {
  console.log(`${pass ? '✓' : '✗'} ${label}`)
  if (!pass) failed++
}
console.log(`\n${failed ? '✗' : '✓'} ${checks.length - failed} بررسی موفق · ${failed} ناموفق`)
process.exitCode = failed ? 1 : 0
