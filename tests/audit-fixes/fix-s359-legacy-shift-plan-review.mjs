/**
 * انتقال ShiftPlan قدیمی:
 * - inventory فقط با نشست Main مدیر خوانده می‌شود؛
 * - هیچ رکورد یا assignment به‌صورت خودکار تبدیل/حذف/ویرایش نمی‌شود؛
 * - هر ردیف صریحاً نیازمند تصمیم مدیر باقی می‌ماند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s359-legacy-shift-plan-review.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-legacy-plan-review-s359-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyPlanService } = await import('../../src/main/services/CustodyPlanService.ts')
const { clearPanelSessions, notePanelUnlocked, runWithPanelSessionOwner } = await import('../../src/main/services/panelSession.ts')

const db = harnessClient()
const seed = makeSeeder(db)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}
const rejects = async (label, work) => {
  try { await work(); eq(label, true, false) }
  catch { eq(label, true, true) }
}

const workerA = seed.user('کارمند برنامهٔ قدیمی A', { role: 'CASHIER' })
const workerB = seed.user('کارمند برنامهٔ قدیمی B', { role: 'CASHIER' })
const legacyId = seed.insert('ShiftPlan', { title: 'برنامهٔ شب قدیمی', startMinute: 1200, durationMinutes: 480, crossesMidnight: 1, daysMask: 127, isActive: 1, sortOrder: 9, reminderRepeatMin: 20 })
seed.insert('ShiftPlanStaff', { planId: legacyId, userId: workerA })
seed.insert('ShiftPlanStaff', { planId: legacyId, userId: workerB })
const beforePlans = seed.count('ShiftPlan')
const beforeLinks = seed.count('ShiftPlanStaff')

await rejects('بازبینی legacy بدون نشست سراسری مدیر رد می‌شود', () => custodyPlanService.reviewLegacy())
const owner = 35901
await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  const review = await custodyPlanService.reviewLegacy()
  eq('وجود دادهٔ قدیمی صریحاً نیازمند بازبینی است', review.state, 'REVIEW_REQUIRED')
  eq('تعداد دادهٔ قدیمی کامل برمی‌گردد', review.total, 1)
  const row = review.plans[0]
  eq('شناسهٔ legacy حفظ می‌شود', row.id, legacyId)
  eq('کارکنان legacy بدون تبدیل پنهان دیده می‌شوند', JSON.stringify(row.staffIds), JSON.stringify([workerA, workerB]))
  eq('هر ردیف migration state صریح دارد', row.migrationState, 'REVIEW_REQUIRED')
  eq('پیام هیچ تبدیل خودکاری را وعده نمی‌دهد', /دست‌نخورده/.test(row.migrationNote), true)
})
eq('بازبینی ShiftPlan چیزی را حذف/ایجاد نمی‌کند', seed.count('ShiftPlan'), beforePlans)
eq('بازبینی assignment کارکنان را دست نمی‌زند', seed.count('ShiftPlanStaff'), beforeLinks)
clearPanelSessions(owner)

const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const channels = readFileSync(new URL('../../src/shared/ipc.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/renderer/src/pages/Settings.tsx', import.meta.url), 'utf8')
eq('IPC review مجزا و بدون writer legacy ثبت شده است', /custodyPlanLegacyReview:\s*'custody:plan:legacy-review'/.test(channels) && /handle\(IPC\.custodyPlanLegacyReview[\s\S]{0,120}reviewLegacy\(\)/.test(ipc), true)
eq('Shift Settings انتقال را فقط‌خواندنی و بدون تبدیل خودکار نشان می‌دهد', /بررسی فقط‌خواندنی برنامه‌های قدیمی/.test(ui) && /به‌صورت خودکار تبدیل یا حذف نمی‌شود/.test(ui), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
