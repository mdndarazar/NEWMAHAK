/**
 * پروندهٔ پرسنلی تدریجی:
 * اطلاعات پایهٔ کارمند نباید به‌دلیل خالی‌بودن اطلاعات بانکی/هویتی قفل شود.
 * مقدارهای اختیاری، اگر وارد شوند، همچنان server-side معتبرسنجی می‌شوند.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s356-staff-progressive-profile.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-staff-progressive-s356-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { staffService } = await import('../../src/main/services/StaffService.ts')
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

const owner = 35601
const legacy = seed.user('کارمند قدیمیِ بی‌پرونده', { role: 'CASHIER' })
await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')

  const edited = await staffService.saveComplete({ id: legacy, name: 'کارمند قدیمی ویرایش‌شده', role: 'CASHIER', isActive: true })
  eq('کارمند قدیمی بدون پرونده با ویرایش پایه ذخیره می‌شود', edited.staff.name, 'کارمند قدیمی ویرایش‌شده')
  eq('ویرایش پایه برای کارمند قدیمی StaffProfile سبک می‌سازد', seed.count('StaffProfile'), 1)

  const created = await staffService.saveComplete({ name: 'کارمند تازهٔ پایه', role: 'CASHIER', isActive: true })
  eq('کارمند تازه با اطلاعات پایه ثبت می‌شود', created.staff.name, 'کارمند تازهٔ پایه')
  eq('ثبت پایه User و Profile را اتمیک می‌سازد', seed.count('StaffProfile'), 2)
  eq('پاسخ ثبت پایه وضعیت پروندهٔ ناقص را بدون دادهٔ حساس می‌دهد', created.profile.completion?.isComplete, false)
  eq('پاسخ ثبت پایه تعداد بخش‌های تکمیل‌شده را می‌دهد', created.profile.completion?.completedFields, 0)

  await rejects('کد ملی نامعتبر، اگر وارد شود، رد می‌شود', () =>
    staffService.saveComplete({ name: 'کد ملی نامعتبر', role: 'CASHIER', nationalId: '1111111111' })
  )
  await rejects('شبای نامعتبر، اگر وارد شود، رد می‌شود', () =>
    staffService.saveComplete({ name: 'شبای نامعتبر', role: 'CASHIER', bankIban: 'IR000000000000000000000000' })
  )
})
clearPanelSessions(owner)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
