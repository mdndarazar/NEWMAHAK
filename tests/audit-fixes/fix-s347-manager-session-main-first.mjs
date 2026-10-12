/**
 * Manager-session hardening characterization:
 * - Main sessions are isolated by webContents owner;
 * - global manager logout clears every panel scope for that owner only;
 * - a status read never revives an expired entry;
 * - a dedicated touch extends only an already-valid Main manager session;
 * - the phase-one source keeps logout Main-first and provides a status sync IPC.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s347-manager-session-main-first.mjs
 */
import { readFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-manager-session-s347-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const {
  clearPanelSessions,
  isManagerSessionUnlocked,
  isPanelUnlocked,
  notePanelUnlocked,
  panelSessionStatus,
  touchManagerSession,
  runWithPanelSessionOwner,
  applyPanelSessionTtlMs
} = await import('../../src/main/services/panelSession.ts')

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

const ownerA = 47001
const ownerB = 47002
clearPanelSessions(ownerA)
clearPanelSessions(ownerB)
applyPanelSessionTtlMs(5_000)

runWithPanelSessionOwner(ownerA, () => {
  notePanelUnlocked('products', 'MANAGER')
  notePanelUnlocked('settings', 'PANEL')
})
runWithPanelSessionOwner(ownerB, () => notePanelUnlocked('purchase', 'PANEL'))

eq(
  'مدیر پنجره اول همان پنجره را باز می‌کند',
  runWithPanelSessionOwner(ownerA, () => isManagerSessionUnlocked()),
  true
)
eq(
  'مدیر پنجره اول به پنجره دوم نشت نمی‌کند',
  runWithPanelSessionOwner(ownerB, () => isManagerSessionUnlocked()),
  false
)
eq(
  'scope محدود پنجره دوم مستقل است',
  runWithPanelSessionOwner(ownerB, () => isPanelUnlocked('purchase')),
  true
)
eq(
  'status پنجره اول مدیر و پنل محدود را جدا گزارش می‌کند',
  runWithPanelSessionOwner(ownerA, () => {
    const s = panelSessionStatus()
    return s.manager === true && s.panels.includes('settings') && !s.panels.includes('__manager__')
  }),
  true
)

runWithPanelSessionOwner(ownerA, () => clearPanelSessions())
eq(
  'خروج مدیر همه scopeهای همان پنجره را پاک می‌کند',
  runWithPanelSessionOwner(ownerA, () => {
    const s = panelSessionStatus()
    return s.manager || s.panels.length > 0
  }),
  false
)
eq(
  'خروج مدیر پنجره اول scope پنجره دوم را پاک نمی‌کند',
  runWithPanelSessionOwner(ownerB, () => isPanelUnlocked('purchase')),
  true
)

eq(
  'touch نشست محدود پنجره را به مدیر ارتقا نمی‌دهد',
  runWithPanelSessionOwner(ownerB, () => touchManagerSession().manager),
  false
)

applyPanelSessionTtlMs(90)
runWithPanelSessionOwner(ownerA, () => notePanelUnlocked('products', 'MANAGER'))
await new Promise((resolve) => setTimeout(resolve, 55))
eq(
  'touch فقط مدیر موجود همان پنجره را در Main تمدید می‌کند',
  runWithPanelSessionOwner(ownerA, () => touchManagerSession().manager),
  true
)
await new Promise((resolve) => setTimeout(resolve, 55))
eq(
  'نشست پس از عبور از TTL اولیه، به‌خاطر touch معتبر است',
  runWithPanelSessionOwner(ownerA, () => isManagerSessionUnlocked()),
  true
)
await new Promise((resolve) => setTimeout(resolve, 110))
eq(
  'status نشست منقضی را زنده نمی‌کند',
  runWithPanelSessionOwner(ownerA, () => panelSessionStatus().manager),
  false
)
applyPanelSessionTtlMs(5 * 60 * 1000)
clearPanelSessions(ownerA)
clearPanelSessions(ownerB)

const [hook, shell, ipc, channels, preload, settings, custodyChip, custodyAdmin, staffService] = await Promise.all([
  readFile('src/renderer/src/hooks/useManagerSession.tsx', 'utf8'),
  readFile('src/renderer/src/components/Shell.tsx', 'utf8'),
  readFile('src/main/ipc/index.ts', 'utf8'),
  readFile('src/shared/ipc.ts', 'utf8'),
  readFile('src/preload/index.ts', 'utf8'),
  readFile('src/renderer/src/pages/Settings.tsx', 'utf8'),
  readFile('src/renderer/src/components/CustodyChip.tsx', 'utf8'),
  readFile('src/renderer/src/components/CustodyAdminChip.tsx', 'utf8'),
  readFile('src/main/services/StaffService.ts', 'utf8')
])
eq('renderer startup وضعیت Main را می‌خواند', /void syncFromMain\(\)/.test(hook) && /CH\.managerSessionStatus/.test(hook), true)
eq('logout renderer پیش از پاسخ Main state را پاک نمی‌کند', /await call\(CH\.managerLogout\)/.test(hook), true)
eq('Main logout همه scopeهای owner جاری را clear می‌کند', /handle\(IPC\.managerLogout[\s\S]{0,500}clearPanelSessions\(\)/.test(ipc), true)
eq('IPC وضعیت session برای sync تعریف شده است', /managerSessionStatus:\s*'manager:session:status'/.test(channels), true)
eq('IPC touch جداگانه و Main-owned است', /managerSessionTouch:\s*'manager:session:touch'/.test(channels) && /handle\(IPC\.managerSessionTouch[\s\S]{0,180}touchManagerSession\(\)/.test(ipc), true)
eq('touch مدیر renderer فقط پس از فعالیت و با throttle صدا می‌خورد', /const touchManagerSession = useCallback/.test(hook) && /CH\.managerSessionTouch/.test(hook) && /now - lastManagerTouch\.current < 15_000/.test(hook) && /touchManagerSession\(\)/.test(hook), true)
eq('عملیات مدیریتی حضانت پشت نشست اصلی مدیر در Main هستند', /IPC\.custodyConfigSet[\s\S]{0,180}assertManagerSession/.test(ipc) && /IPC\.custodyPlanSave[\s\S]{0,180}assertManagerSession/.test(ipc) && /IPC\.custodyReport[\s\S]{0,180}assertManagerSession/.test(ipc), true)
eq('Header گروه وضعیت ثابت دارد', /shrink-0 flex items-center gap-1 border-s/.test(shell), true)
eq('Header nav مستقل و اسکرولی دارد', /min-w-0 flex-1 overflow-x-auto/.test(shell), true)
eq('Preload کانال ناشناس را قبل از IPC رد می‌کند', /allowedChannels\.has\(channel\)/.test(preload) && /IPC_CHANNEL_NOT_ALLOWED/.test(preload), true)
eq('Header فقط عملیات روزانه حضانت دارد، نه مدیریت ساختاری', !/CustodyAdminChip/.test(shell) && /<CustodyChip showSetup=\{false\}/.test(shell), true)
eq('تنظیمات محل راه‌اندازی و مدیریت ساختاری حضانت است', /tab === 'custody'/.test(settings) && /<CustodyAdminChip/.test(settings) && /showOperations=\{false\}/.test(settings), true)
eq('رمز دوم Settings به تب کارکنان و حضانت دسترسی نمی‌دهد', /!isManager && \(tab === 'staff' \|\| tab === 'custody'\)/.test(settings) && /\{isManager \? \(/.test(settings), true)
eq('chip روزانه در حالت setup-hidden دکمه راه‌اندازی نشان نمی‌دهد', /showSetup = true, showOperations = true/.test(custodyChip) && /isManager && showSetup/.test(custodyChip), true)
eq('راه‌اندازی مدیر با تک‌شیفت شروع می‌شود و UI ساختاری رمز مدیر نمی‌خواهد', /config: \{ enabled: true, mode: 'SINGLE_SHIFT' \}/.test(custodyChip) && !/managerPassword/.test(custodyAdmin), true)
eq('پروندهٔ حساس و ثبت ساختاری کارکنان فقط نشست مدیر Main می‌خواهند', /IPC\.staffPersonnelGet[\s\S]{0,150}assertManagerSession/.test(ipc) && /IPC\.staffPersonnelSave[\s\S]{0,150}assertManagerSession/.test(ipc) && /IPC\.staffPersonnelSaveComplete[\s\S]{0,150}assertManagerSession/.test(ipc) && !/handle\(IPC\.staffSave/.test(ipc) && /async personnel[\s\S]{0,100}assertManagerSession/.test(staffService), true)
eq('UI پروندهٔ پرسنلی از کانال محرمانه جدا استفاده می‌کند', /CH\.staffPersonnelGet/.test(settings) && /CH\.staffPersonnelSave/.test(settings) && !/panelPassword: staffPw/.test(settings), true)
eq('خروج مدیر دادهٔ حساس فرم پرسنل را از حافظهٔ UI پاک می‌کند', /if \(!isManager\) \{[\s\S]{0,220}setStaffDraft\(blankStaffDraft\(\)\)/.test(settings), true)
eq('حضانت فقط credential و برنامه را مدیریت می‌کند، نه پروندهٔ پرسنلی', !/custodyStaffProfileSave/.test(custodyAdmin) && !/عنوان شغلی/.test(custodyAdmin) && !/custodyStaffProfileSave/.test(ipc) && !/custodyStaffProfileSave/.test(channels), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
