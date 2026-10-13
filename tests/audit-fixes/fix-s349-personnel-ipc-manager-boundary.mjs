/**
 * مرز end-to-end IPC برای پروندهٔ حساس کارکنان:
 * renderer/payload هیچ owner یا مجوزی تعیین نمی‌کند؛ handler آن را از sender
 * می‌گیرد و فقط نشست اصلی مدیرِ همان window می‌تواند دادهٔ خام را بخواند/بنویسد.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s349-personnel-ipc-manager-boundary.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-personnel-ipc-s349-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
const owner = 34901
const sender = { id: owner, isDestroyed: () => false, once: () => {} }
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { clearPanelSessions, notePanelUnlocked, runWithPanelSessionOwner } = await import('../../src/main/services/panelSession.ts')

const db = harnessClient()
const seed = makeSeeder(db)
registerIpcHandlers()
const invoke = (channel, payload) => handlers.get(channel)({ sender }, payload)
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

function validNationalId(prefix = '008457594') {
  const sum = prefix.split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0)
  const rem = sum % 11
  return `${prefix}${rem < 2 ? rem : 11 - rem}`
}
function validIranIban(bban = '0540102680020817909002') {
  let rem = 0
  for (const digit of `${bban}182700`) rem = (rem * 10 + Number(digit)) % 97
  return `IR${String(98 - rem).padStart(2, '0')}${bban}`
}

const employee = seed.user('کارمند IPC', { role: 'CASHIER' })
const payload = {
  userId: employee,
  jobTitle: 'صندوقدار',
  phone: '09121234567',
  nationalId: validNationalId(),
  employmentStartJalali: '1405/07/01',
  employmentStatus: 'ACTIVE',
  bankName: 'ملی',
  bankAccountNo: '123456789012',
  bankIban: validIranIban(),
  bankAccountHolder: 'کارمند IPC'
}

const noSession = await invoke(IPC.staffPersonnelSave, payload)
eq('IPC بدون نشست مدیر پروندهٔ حساس را رد می‌کند', noSession.ok, false)
eq('بدون نشست هیچ پرونده‌ای نوشته نمی‌شود', seed.count('StaffProfile'), 0)

runWithPanelSessionOwner(owner, () => notePanelUnlocked('settings', 'PANEL'))
const panelOnly = await invoke(IPC.staffPersonnelSave, payload)
eq('رمز دوم Settings پروندهٔ حساس را رد می‌کند', panelOnly.ok, false)
eq('رمز دوم Settings هیچ داده‌ای نمی‌نویسد', seed.count('StaffProfile'), 0)

runWithPanelSessionOwner(owner, () => notePanelUnlocked('settings', 'MANAGER'))
const saved = await invoke(IPC.staffPersonnelSave, payload)
eq('نشست اصلی مدیر پروندهٔ حساس را ثبت می‌کند', saved.ok, true)
eq('مسیر IPC مقدار مدیر را به renderer برمی‌گرداند', saved.data?.profile?.nationalId, payload.nationalId)
const stored = seed.one('SELECT nationalId, bankIban FROM "StaffProfile" WHERE userId = ?', employee)
eq('دادهٔ کامل به DB می‌رسد', stored?.bankIban, payload.bankIban)

clearPanelSessions(owner)
const afterLogout = await invoke(IPC.staffPersonnelGet, { userId: employee })
eq('بعد از logout مدیر، خواندن دادهٔ حساس فوراً قفل می‌شود', afterLogout.ok, false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
