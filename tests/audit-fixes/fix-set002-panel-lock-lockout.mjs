/**
 * SET-002 — تغییر قفل پنل باید درست مانند دیگر تاییدهای مدیر، ورود غلط را در
 * AuthLockout ثبت کند، ورود صحیح شمارنده را پاک کند و پس از سقف تلاش‌ها حتی
 * رمز صحیح را تا پایان قفل نپذیرد.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-set002-panel-lock-lockout.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-set002-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { authService } = await import('../../src/main/services/AuthService.ts')
const { DEFAULT_MANAGER_PASSWORD, SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS, MANAGER_GATE } = await import('@shared/panels')
const db = harnessClient()

let ok = 0
let bad = 0
const check = (label, value, detail = '') => {
  if (value) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}
const rejects = async (input) => {
  try {
    await authService.setPanelLocks(input)
    return null
  } catch (e) {
    return String(e?.message ?? e)
  }
}

await db.setting.upsert({
  where: { key: SETTING_KEYS.securityConfig },
  update: { value: JSON.stringify({ lockoutEnabled: true, maxAttempts: 2, lockMinutes: 10 }) },
  create: { key: SETTING_KEYS.securityConfig, value: JSON.stringify({ lockoutEnabled: true, maxAttempts: 2, lockMinutes: 10 }) }
})

const target = PANEL_KEYS.salesReports
let error = await rejects({ managerPassword: 'wrong-set002', locks: { [target]: false } })
check('اولین رمز نادرست رد شد', /رمز مدیر درست نیست/.test(error ?? ''))
let lock = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
check('اولین خطا در AuthLockout ثبت شد', lock?.failCount === 1 && !lock?.lockedUntil)

await authService.setPanelLocks({ managerPassword: DEFAULT_MANAGER_PASSWORD, locks: { [target]: false } })
lock = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
check('رمز صحیح شمارنده‌ی تلاش قبلی را پاک کرد', lock?.failCount === 0 && !lock?.lockedUntil)
check('فقط درخواست تاییدشده قفل پنل را تغییر داد', (await authService.panelLocks()).locks[target] === false)

error = await rejects({ managerPassword: 'wrong-set002-a', locks: { [target]: true } })
check('رمز نادرست دوم (پس از reset) رد شد', /۱ تلاش دیگر|1 تلاش دیگر/.test(error ?? ''))
error = await rejects({ managerPassword: 'wrong-set002-b', locks: { [target]: true } })
lock = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
check('رسیدن به سقف، قفل موقت مدیر را فعال کرد', /قفل/.test(error ?? '') && lock?.failCount === 0 && !!lock?.lockedUntil && lock.lockCount === 1)

error = await rejects({ managerPassword: DEFAULT_MANAGER_PASSWORD, locks: { [target]: true } })
check('رمز صحیح در دوره‌ی قفل موقت نیز رد شد', /امکان ورود رمز وجود ندارد|حتی رمز درست/.test(error ?? ''))
check('درخواست‌های ردشده هرگز قفل پنل را تغییر ندادند', (await authService.panelLocks()).locks[target] === false)

console.log(`\nنتیجه SET-002: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
