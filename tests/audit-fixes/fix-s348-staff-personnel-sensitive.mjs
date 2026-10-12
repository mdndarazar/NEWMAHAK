/**
 * پروندهٔ پرسنلی حساس:
 * - فقط نشست اصلی مدیر می‌تواند دادهٔ خام هویتی/بانکی را بخواند یا بنویسد؛
 * - list عمومی و audit هیچ مقدار خام حساسی حمل نمی‌کنند؛
 * - اعتبارسنجی هویت/شبا و وضعیت استخدام fail-closed است.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s348-staff-personnel-sensitive.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-personnel-s348-'))
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
const rejects = async (label, work, code) => {
  try { await work(); eq(label, true, false) }
  catch (error) { eq(label, code ? error?.code : !!error, code ?? true) }
}

function validNationalId(prefix = '008457594') {
  const weighted = prefix.split('').reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0)
  const rem = weighted % 11
  return `${prefix}${rem < 2 ? rem : 11 - rem}`
}
function validIranIban(bban = '0540102680020817909002') {
  let rem = 0
  for (const char of `${bban}182700`) rem = (rem * 10 + Number(char)) % 97
  return `IR${String(98 - rem).padStart(2, '0')}${bban}`
}

const employee = seed.user('کارمند پرونده', { role: 'CASHIER' })
const nationalId = validNationalId()
const iban = validIranIban()
const owner = 34801

await rejects('خواندن پروندهٔ حساس بدون نشست مدیر رد می‌شود', () => staffService.personnel({ userId: employee }))
await rejects('ثبت پروندهٔ حساس بدون نشست مدیر رد می‌شود', () => staffService.savePersonnel({ userId: employee }))

await runWithPanelSessionOwner(owner, async () => {
  notePanelUnlocked('settings', 'MANAGER')
  const saved = await staffService.savePersonnel({
    userId: employee,
    jobTitle: 'صندوقدار ارشد',
    phone: '09121234567',
    nationalId,
    employmentStartJalali: '1405/07/01',
    employmentStatus: 'ACTIVE',
    bankName: 'بانک ملی',
    bankAccountNo: '1234-5678-9012',
    bankIban: iban.toLowerCase(),
    bankAccountHolder: 'کارمند پرونده'
  })
  eq('مدیر مقدار خام پرونده را می‌بیند', saved.profile.nationalId, nationalId)
  eq('شبا با فرمت استاندارد نگهداری می‌شود', saved.profile.bankIban, iban)
  eq('شماره حساب جداکننده‌زدایی می‌شود', saved.profile.bankAccountNo, '123456789012')
})

const directory = await staffService.list()
const publicRow = directory.rows.find((row) => row.id === employee)
eq('فهرست عمومی کارمند کد ملی ندارد', Object.prototype.hasOwnProperty.call(publicRow, 'nationalId'), false)
eq('فهرست عمومی کارمند شبا ندارد', Object.prototype.hasOwnProperty.call(publicRow, 'bankIban'), false)
eq('مقدار حساس در فهرست عمومی نیست', JSON.stringify(directory).includes(nationalId) || JSON.stringify(directory).includes(iban), false)
const audits = seed.rows('SELECT action, before, after, note FROM "AuditLog" WHERE entity = ?', 'StaffProfile')
const auditText = JSON.stringify(audits)
eq('audit تغییر پرونده مقدار خام کد ملی ندارد', auditText.includes(nationalId), false)
eq('audit تغییر پرونده مقدار خام شبا ندارد', auditText.includes(iban), false)
eq('audit پروندهٔ حساس ثبت شده است', audits.at(-1)?.action, 'STAFF_PERSONNEL_SENSITIVE_UPDATE')

await runWithPanelSessionOwner(owner, async () => {
  const incomplete = await staffService.savePersonnel({ userId: employee, jobTitle: '', phone: '', nationalId: '', employmentStartJalali: '', bankName: '', bankAccountNo: '', bankIban: '', bankAccountHolder: '' })
  eq('پروندهٔ ناقص ذخیره می‌شود و ویرایش پایه را قفل نمی‌کند', incomplete.profile.jobTitle, null)
  eq('وضعیت تکمیل پروندهٔ ناقص صریح است', incomplete.profile.completion?.isComplete, false)
  await rejects('کد ملی نامعتبر رد می‌شود', () => staffService.savePersonnel({ userId: employee, nationalId: '1111111111' }))
  await rejects('شبای نامعتبر رد می‌شود', () => staffService.savePersonnel({ userId: employee, bankIban: 'IR000000000000000000000000' }))
  await rejects('وضعیت استخدام نامعتبر رد می‌شود', () => staffService.savePersonnel({ userId: employee, employmentStatus: 'UNKNOWN' }))
})
clearPanelSessions(owner)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
