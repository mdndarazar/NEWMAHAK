/**
 * ورودی نقدی و فهرست عملیاتی حضانت:
 * - رشتهٔ خالی/null نباید بی‌صدا به شمارش صفر تبدیل شود؛
 * - صفرِ صریح معتبر است؛
 * - فهرست روزانهٔ حضانت نباید راه افشای تلفن یا جزئیات پرونده باشد.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s358-custody-input-redaction.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-input-s358-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')

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

const manager = seed.user('مدیر حضانت', { role: 'MANAGER' })
const cashier = seed.user('صندوقدار با تلفن', { role: 'CASHIER' })
seed.insert('StaffProfile', {
  userId: cashier,
  kind: 'STAFF',
  jobTitle: 'صندوقدار ارشد',
  phone: '09121234567',
  employmentStatus: 'ACTIVE'
})

await custodyService.setPin({ userId: manager, newPassword: 'مدیر123!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'مدیر123!' })
await custodyService.setPin({ userId: cashier, newPassword: 'Cash123!', managerUserId: manager, managerPassword: 'مدیر123!', reason: 'تعریف اولیه' })
await custodyService.setPin({ userId: cashier, currentPassword: 'Cash123!', newPassword: 'Cash1234!' })

await rejects('شمارش نقدی خالی هنگام افتتاح به صفر تبدیل نمی‌شود', () =>
  custodyService.open({ userId: cashier, password: 'Cash1234!', countedCash: '   ' })
)
eq('شمارش خالی نشست جدید نمی‌سازد', seed.count('Shift'), 0)
const opened = await custodyService.open({ userId: cashier, password: 'Cash1234!', countedCash: 0 })
eq('صفر صریح برای افتتاح معتبر است', opened.countStatus, 'COUNTED')
await rejects('شمارش نهایی null به صفر تبدیل نمی‌شود', () =>
  custodyService.finalClose({ password: 'Cash1234!', countedCash: null })
)
eq('شمارش نهایی نامعتبر نشست را نمی‌بندد', seed.one('SELECT closedAt FROM "Shift" WHERE id = ?', opened.shiftId)?.closedAt, null)

const row = (await custodyService.staffList()).find((x) => x.id === cashier)
const publicJson = JSON.stringify(row)
eq('فهرست روزانه حضانت شماره تلفن خام ندارد', publicJson.includes('09121234567'), false)
eq('فهرست روزانه حضانت عنوان شغلی ندارد', Object.prototype.hasOwnProperty.call(row, 'jobTitle'), false)
eq('فهرست روزانه حضانت حتی شماره تلفن mask‌شده برنمی‌گرداند', Object.prototype.hasOwnProperty.call(row, 'phoneMasked'), false)
eq('فهرست روزانه هنوز وضعیت credential لازم را دارد', row?.hasCustodyPin, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
