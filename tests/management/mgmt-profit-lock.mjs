/**
 * قفل جدا تب سود، همان‌طور که روی مغازه واقعی کار می‌کند:
 *   حسابدار با رمز گزارش مدیریت روند را می‌بیند؛ سود نمی‌بیند.
 *   صاحب مغازه با رمز مدیر همه‌چیز را می‌بیند.
 *   اگر قفل سود در تنظیمات خاموش باشد، رمز نمی‌خواهد.
 *
 *     node --import ./test/harness/register.mjs tests/management/mgmt-profit-lock.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-profit-lock-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { PANEL_KEYS, LOCKED_PANELS, allLockedConfig, isPanelLockEnabled, parsePanelLocks } =
  await import('../../src/shared/panels.ts')
const { assertPanelUnlocked, notePanelUnlocked, clearPanelSessions, isPanelUnlocked } =
  await import('../../src/main/services/panelSession.ts')
const { authService } = await import('../../src/main/services/AuthService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')

const db = harnessClient()
makeSeeder(db)
const PW = DEFAULT_MANAGER_PASSWORD

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — ${JSON.stringify(want)} ≠ ${JSON.stringify(got)}`.slice(0, 280))
  }
}
const msgOf = async (fn) => {
  try {
    await fn()
    return null
  } catch (e) {
    return String(e?.message ?? e)
  }
}

console.log('\nسیم‌کشی')
eq('کلید سود جدا از گزارش مدیریت است', PANEL_KEYS.managementProfit !== PANEL_KEYS.managementReports, true)
eq('کلید سود در LOCKED_PANELS است (تنظیمات رمز آن را نشان می‌دهد)', LOCKED_PANELS.some((p) => p.key === PANEL_KEYS.managementProfit), true)
eq('پیش‌فرض نصب تازه: قفل سود روشن است', allLockedConfig()[PANEL_KEYS.managementProfit], true)
eq('پیش‌فرض نصب تازه: قفل گزارش مدیریت روشن است', allLockedConfig()[PANEL_KEYS.managementReports], true)
eq(
  'کلید ناشناس قفل را خاموش نمی‌کند',
  isPanelLockEnabled(parsePanelLocks({ 'management-profit': false, nope: false }), 'nope'),
  true
)

const ipc = readFileSync(join(root, 'src/main/ipc/index.ts'), 'utf8')
eq('کانال سود هر دو قفل را می‌خواهد', /handle\(IPC\.mgmtProfit[\s\S]{0,400}PANEL_KEYS\.managementProfit/.test(ipc), true)
eq('کانال روند فقط قفل گزارش مدیریت است', /handle\(IPC\.mgmtTrend[\s\S]{0,250}assertMgmt/.test(ipc) && !/handle\(IPC\.mgmtTrend[\s\S]{0,400}managementProfit/.test(ipc), true)

eq('مانده و ABC و خرید فی را بدون قفل سود نمی‌دهند', /withCost: await canSeeMgmtProfit\(\)/.test(ipc), true)

const ui = readFileSync(join(root, 'src/renderer/src/pages/ManagementReports.tsx'), 'utf8')
eq('تب سود داخل ManagerGate است', /tab === 'profit'[\s\S]{0,250}PANEL_KEYS\.managementProfit/.test(ui), true)

console.log('\nمغازه واقعی — نشست پنل')
clearPanelSessions()
eq('شروع روز: سود بسته است', isPanelUnlocked(PANEL_KEYS.managementProfit), false)

eq(
  'بدون رمز، کانال سود رد می‌شود',
  /قفل همین بخش/.test(await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود'))),
  true
)

notePanelUnlocked(PANEL_KEYS.managementReports, 'PANEL')
eq('حسابدار گزارش مدیریت را باز کرد', isPanelUnlocked(PANEL_KEYS.managementReports), true)
eq('همان حسابدار سود را نمی‌بیند', isPanelUnlocked(PANEL_KEYS.managementProfit), false)
eq(
  'IPC سود با رمز گزارش مدیریت باز نمی‌شود',
  /قفل همین بخش/.test(await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود'))),
  true
)

notePanelUnlocked(PANEL_KEYS.managementProfit, 'PANEL')
eq('رمز دوم سود، فقط سود را باز کرد', isPanelUnlocked(PANEL_KEYS.managementProfit), true)
eq('و IPC سود اجازه می‌دهد', await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود')), null)

clearPanelSessions()
notePanelUnlocked(PANEL_KEYS.managementReports, 'MANAGER')
eq('رمز مدیر صاحب مغازه سود را هم باز می‌کند', isPanelUnlocked(PANEL_KEYS.managementProfit), true)
eq('IPC سود با نشست مدیر باز است', await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود')), null)

console.log('\nمغازه واقعی — رمز دوم و خاموش کردن قفل')
await authService.setPanelPassword({
  panel: PANEL_KEYS.managementProfit,
  managerPassword: PW,
  password: 'sod-4444'
})
await authService.setPanelPassword({
  panel: PANEL_KEYS.managementReports,
  managerPassword: PW,
  password: 'gozaresh-5555'
})

const asAccountant = await authService.verifyPanel({ panel: PANEL_KEYS.managementReports, password: 'gozaresh-5555' })
eq('رمز دوم گزارش مدیریت scope پنل است نه مدیر', asAccountant.scope, 'PANEL')
eq('رمز گزارش مدیریت سود را باز نمی‌کند', asAccountant.panel, PANEL_KEYS.managementReports)

const profitWithMgmtPass = await msgOf(() =>
  authService.verifyPanel({ panel: PANEL_KEYS.managementProfit, password: 'gozaresh-5555' })
)
eq('رمز گزارش مدیریت روی گیت سود رد می‌شود', /رمز/.test(String(profitWithMgmtPass)), true)

const asOwnerProfit = await authService.verifyPanel({ panel: PANEL_KEYS.managementProfit, password: 'sod-4444' })
eq('رمز دوم سود قبول می‌شود', asOwnerProfit.scope, 'PANEL')
eq('و پنل همان سود است', asOwnerProfit.panel, PANEL_KEYS.managementProfit)

const asManager = await authService.verifyPanel({ panel: PANEL_KEYS.managementProfit, password: PW })
eq('رمز مدیر روی گیت سود هم کار می‌کند', asManager.scope, 'MANAGER')

await authService.setPanelLocks({ managerPassword: PW, locks: { [PANEL_KEYS.managementProfit]: false } })
clearPanelSessions()
eq(
  'قفل سود خاموش: بدون رمز IPC باز است',
  await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementProfit, 'دیدن سود')),
  null
)
eq(
  'قفل گزارش مدیریت هنوز روشن است',
  /قفل همین بخش/.test(await msgOf(() => assertPanelUnlocked(PANEL_KEYS.managementReports, 'دیدن روند'))),
  true
)

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
