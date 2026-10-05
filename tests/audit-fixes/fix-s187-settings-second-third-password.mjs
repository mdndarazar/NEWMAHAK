// نشست ۱۸۷: پنل تنظیمات مثل بقیه‌ی ماژول‌ها رمز دوم و رمز سوم شیفت می‌گیرد.
/**
 * ===========================================================================
 * نشست ۱۸۷ — خواسته‌ی صریح مالک
 *
 * «ماژول تنظیمات فقط قفل مدیر را می‌گرفت؛ حالا باید مثل بقیه‌ی ماژول‌ها رمز
 * دوم و رمز سومِ شیفت هم بگیرد، چون هیچ ضرری ندارد و تصمیم با خود مدیر است
 * که قفل بگذارد یا نگذارد.»
 *
 * آنچه عوض شد: فهرست `MANAGER_ONLY_PANELS` خالی شد تا `verifyPanel` رمز دوم
 * و سوم تنظیمات را بپذیرد.
 *
 * آنچه عمداً عوض نشد:
 *   • `ALWAYS_LOCKED_PANELS` — ورود به صفحه همیشه یک رمز می‌خواهد.
 *   • تعریف/حذف رمز دوم و سوم، و تغییر قفل ماژول‌ها، همچنان رمز مدیر می‌خواهد.
 *   • `settings:set` / افست ساعت / آرشیو همچنان فقط رمز مدیر.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s187-settings-second-third-password.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s187-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { authService } = await import('../../src/main/services/AuthService.ts')
const { DEFAULT_MANAGER_PASSWORD } = await import('../../src/shared/receipt.ts')
const { PANEL_KEYS, MANAGER_ONLY_PANELS, ALWAYS_LOCKED_PANELS, isManagerOnlyPanel, isAlwaysLocked } =
  await import('../../src/shared/panels.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const PW = DEFAULT_MANAGER_PASSWORD

let pass = 0
let fail = 0
const show = (v) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v))
const eq = (label, got, want) => {
  if (show(got) === show(want)) {
    pass++
    console.log(`  ✓ ${label}`)
  } else {
    fail++
    console.log(`  ✗ ${label} · دریافت ${show(got)} · انتظار ${show(want)}`)
  }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    fail++
    console.log(`  ✗ ${label} — پذیرفته شد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) {
      pass++
      console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0]})`)
    } else {
      fail++
      console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0]}`)
    }
  }
}

console.log('\n— ۱) قرارداد: تنظیمات دیگر فقط-مدیر نیست، ولی قفلش خاموش نمی‌شود —')
ok('فهرست MANAGER_ONLY خالی است', MANAGER_ONLY_PANELS.length === 0)
ok('تنظیمات در آن نیست', !MANAGER_ONLY_PANELS.includes(PANEL_KEYS.settings))
ok('helper هم false می‌دهد', !isManagerOnlyPanel(PANEL_KEYS.settings))
ok('قفل ورود به تنظیمات همچنان همیشه روشن است', ALWAYS_LOCKED_PANELS.includes(PANEL_KEYS.settings) && isAlwaysLocked(PANEL_KEYS.settings))

console.log('\n— ۲) تعریف رمز دوم تنظیمات رمز مدیر می‌خواهد —')
await rejects('بدون رمز مدیر', () => authService.setPanelPassword({ panel: PANEL_KEYS.settings, password: 'set-2222' }), 'رمز مدیر')
await rejects('با رمز مدیر غلط', () => authService.setPanelPassword({ panel: PANEL_KEYS.settings, managerPassword: 'غلط', password: 'set-2222' }), 'رمز مدیر')
const saved = await authService.setPanelPassword({
  panel: PANEL_KEYS.settings,
  managerPassword: PW,
  password: 'set-2222'
})
eq('ثبت رمز دوم تنظیمات', saved.enabled, true)

console.log('\n— ۳) ورود به تنظیمات با رمز دوم —')
{
  const res = await authService.verifyPanel({ panel: PANEL_KEYS.settings, password: 'set-2222' })
  eq('scope رمز دوم = PANEL', res.scope, 'PANEL')
  eq('پنل همان تنظیمات است', res.panel, PANEL_KEYS.settings)
}
{
  const res = await authService.verifyPanel({ panel: PANEL_KEYS.settings, password: PW })
  eq('رمز مدیر همچنان MANAGER است', res.scope, 'MANAGER')
}
await rejects(
  'رمز غلط تنظیمات',
  () => authService.verifyPanel({ panel: PANEL_KEYS.settings, password: 'xxxx' }),
  null
)

console.log('\n— ۴) رمز دوم یک پنل دیگر تنظیمات را باز نمی‌کند —')
await authService.setPanelPassword({ panel: PANEL_KEYS.products, managerPassword: PW, password: 'prod-3333' })
{
  const res = await authService.verifyPanel({ panel: PANEL_KEYS.products, password: 'prod-3333' })
  eq('رمز کالاها کالاها را باز می‌کند', res.scope, 'PANEL')
}
await rejects(
  'رمز کالاها تنظیمات را باز نمی‌کند',
  () => authService.verifyPanel({ panel: PANEL_KEYS.settings, password: 'prod-3333' }),
  null
)

console.log('\n— ۵) رمز سوم شیفت برای تنظیمات —')
seed.setting('shift.config', {
  byTime: true,
  templates: [{ name: 'صبح', startTime: '00:00', endTime: '00:00' }]
})
await rejects(
  'تعریف رمز سوم بدون رمز مدیر',
  () => authService.setPanelShiftPassword({ panel: PANEL_KEYS.settings, shift: 1, password: 'shift-4444' }),
  'رمز مدیر'
)
const third = await authService.setPanelShiftPassword({
  panel: PANEL_KEYS.settings,
  shift: 1,
  managerPassword: PW,
  password: 'shift-4444'
})
eq('ثبت رمز سوم شیفت ۱', third.enabled, true)
{
  const res = await authService.verifyPanel({ panel: PANEL_KEYS.settings, password: 'shift-4444' })
  eq('رمز سوم تنظیمات را باز می‌کند', res.scope, 'PANEL')
}

console.log('\n— ۶) دارنده‌ی رمز دوم نمی‌تواند قفل ماژول‌ها را بردارد —')
await rejects(
  'setPanelLocks با رمز دوم تنظیمات',
  () => authService.setPanelLocks({ managerPassword: 'set-2222', locks: { [PANEL_KEYS.products]: false } }),
  'رمز مدیر'
)
await rejects(
  'خاموش کردن قفل خودِ تنظیمات حتی با رمز مدیر',
  () => authService.setPanelLocks({ managerPassword: PW, locks: { [PANEL_KEYS.settings]: false } }),
  'قابل برداشتن نیست'
)

console.log('\n— ۷) عملیات سیاست‌ساز همچنان فقط رمز مدیر —')
{
  const ipc = readFileSync('src/main/ipc/index.ts', 'utf-8')
  const i = ipc.indexOf('تغییر تنظیم حساس')
  ok('settings:set هنوز assertManagerPassword دارد', i > 0 && ipc.slice(Math.max(0, i - 220), i).includes('assertManagerPassword'))
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
