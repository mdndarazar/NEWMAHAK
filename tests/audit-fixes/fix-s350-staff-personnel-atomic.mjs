/**
 * ثبت اتمی کارمند + پروندهٔ حساس: خطای اعتبارسنجی یا تضاد شناسه نباید User
 * بدون StaffProfile بسازد و ثبت موفق باید هر دو Audit redacted را داشته باشد.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s350-staff-personnel-atomic.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-personnel-atomic-s350-'))
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
function validNationalId(prefix) {
  const sum = prefix.split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0)
  const remainder = sum % 11
  return `${prefix}${remainder < 2 ? remainder : 11 - remainder}`
}
function validIranIban(bban = '0540102680020817909002') {
  let remainder = 0
  for (const digit of `${bban}182700`) remainder = (remainder * 10 + Number(digit)) % 97
  return `IR${String(98 - remainder).padStart(2, '0')}${bban}`
}
const full = (name, nationalId) => ({
  name,
  role: 'CASHIER',
  isActive: true,
  jobTitle: 'صندوقدار',
  phone: '09121234567',
  nationalId,
  employmentStartJalali: '1405/07/01',
  employmentStatus: 'ACTIVE',
  bankName: 'ملی',
  bankAccountNo: '123456789012',
  bankIban: validIranIban(),
  bankAccountHolder: name
})

const owner = 35001
const initialUsers = seed.count('User')
await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  await rejects('اعتبارسنجی ناموفق هیچ کارمند نیمه‌کاره نمی‌سازد', () => staffService.saveComplete({ ...full('ناقص', validNationalId('008457594')), bankIban: 'IR000000000000000000000000' }))
  eq('پس از خطا User تازه نداریم', seed.count('User'), initialUsers)
  eq('پس از خطا StaffProfile نداریم', seed.count('StaffProfile'), 0)

  const created = await staffService.saveComplete(full('کارمند اتمی', validNationalId('008457594')))
  eq('ثبت کامل User و Profile را با هم برمی‌گرداند', created.staff.name, 'کارمند اتمی')
  eq('یک User ثبت شد', seed.count('User'), initialUsers + 1)
  eq('یک Profile ثبت شد', seed.count('StaffProfile'), 1)
  eq('Profile به همان User متصل است', seed.one('SELECT userId FROM "StaffProfile"')?.userId, created.staff.id)

  await rejects('تضاد کد ملی هم User نیمه‌کاره نمی‌سازد', () => staffService.saveComplete(full('کارمند تکراری', validNationalId('008457594'))))
  eq('پس از تضاد، شمار User تغییر نکرد', seed.count('User'), initialUsers + 1)
  eq('پس از تضاد، شمار Profile تغییر نکرد', seed.count('StaffProfile'), 1)

  const manager = await staffService.saveComplete({
    name: 'مدیر اتمی',
    role: 'MANAGER',
    isActive: true,
    correctionApprovalPassword: 'تصحیح-۳۵۰'
  })
  eq('رمز تأیید مدیر همراه ثبت اتمی تنظیم می‌شود', manager.staff.hasCorrectionApprovalPassword, true)
  const managerRow = seed.one('SELECT passwordHash FROM "User" WHERE id = ?', manager.staff.id)
  eq('رمز خام مدیر هرگز در User ذخیره نمی‌شود', String(managerRow?.passwordHash ?? '').includes('تصحیح-۳۵۰'), false)
  await rejects('رمز تأیید برای مدیر غیرفعال پیش از هر نوشتن رد می‌شود', () =>
    staffService.saveComplete({ name: 'مدیر غیرفعال', role: 'MANAGER', isActive: false, correctionApprovalPassword: 'تصحیح-۳۵۰' })
  )
  eq('رد مدیر غیرفعال User تازه نمی‌سازد', seed.count('User'), initialUsers + 2)
})
const audit = seed.rows('SELECT action, before, after, note FROM "AuditLog" ORDER BY id')
const text = JSON.stringify(audit)
eq('Audit User و Profile هر دو ثبت شده‌اند', audit.some((row) => row.action === 'STAFF_CREATE') && audit.some((row) => row.action === 'STAFF_PERSONNEL_SENSITIVE_UPDATE'), true)
eq('Audit ثبت اتمی کد ملی خام ندارد', text.includes(validNationalId('008457594')), false)
eq('Audit ثبت اتمی شبا خام ندارد', text.includes(validIranIban()), false)
eq('Audit رمز تأیید مدیر را فقط به‌شکل وضعیت امن ثبت می‌کند', text.includes('تصحیح-۳۵۰'), false)
eq('Audit تنظیم رمز تأیید مدیر در همان جریان ثبت شده است', audit.some((row) => row.action === 'SETTINGS_UPDATE' && String(row.after).includes('managerCorrectionApprovalConfigured')), true)
clearPanelSessions(owner)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
