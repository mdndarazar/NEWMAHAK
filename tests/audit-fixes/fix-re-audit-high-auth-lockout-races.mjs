/**
 * RE-AUDIT-HIGH-01/02 — قفل موقت باید در برابر burst هم‌زمان مقاوم باشد و
 * همه‌ی تاییدهای مدیر باید دقیقاً از همان گیت __manager__ استفاده کنند.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-re-audit-high-auth-lockout-races.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-re-audit-auth-race-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { authService, assertManagerPassword } = await import('../../src/main/services/AuthService.ts')
const { guardCreditCode } = await import('../../src/main/services/StoreCreditService.ts')
const { DEFAULT_MANAGER_PASSWORD, SETTING_KEYS } = await import('@shared/receipt')
const { MANAGER_GATE, CREDIT_CODE_GATE, PANEL_KEYS } = await import('@shared/panels')
const db = harnessClient()
const seed = makeSeeder(db)

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
const rejected = async (work) => {
  try {
    await work()
    return null
  } catch (e) {
    return String(e?.message ?? e)
  }
}

seed.setting(SETTING_KEYS.securityConfig, { lockoutEnabled: true, maxAttempts: 3, lockMinutes: 10 })

console.log('\n۱) RE-AUDIT-HIGH-01: burst هم‌زمان رمز مدیر')
const managerBurst = await Promise.allSettled(
  Array.from({ length: 40 }, (_, i) => authService.verify({ password: `wrong-manager-${i}` }))
)
const managerLock = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
check('۴۰ درخواست هم‌زمان همگی رد شدند', managerBurst.every((r) => r.status === 'rejected'))
check('گیت مدیر پس از burst واقعاً قفل شد', managerLock?.failCount === 0 && !!managerLock?.lockedUntil && managerLock.lockCount === 1)
check('رمز صحیح پس از burst نیز تا پایان قفل رد می‌شود', /امکان ورود رمز وجود ندارد|حتی رمز درست/.test((await rejected(() => authService.verify({ password: DEFAULT_MANAGER_PASSWORD }))) ?? ''))

console.log('\n۲) RE-AUDIT-HIGH-01: burst هم‌زمان کد اعتبار')
const creditBurst = await Promise.allSettled(
  Array.from({ length: 50 }, (_, i) => guardCreditCode(`INVALID-CREDIT-${i}`))
)
const creditLock = await db.authLockout.findUnique({ where: { gate: CREDIT_CODE_GATE } })
check('۵۰ کد نامعتبر هم‌زمان همگی رد شدند', creditBurst.every((r) => r.status === 'rejected'))
check('گیت کد اعتبار پس از burst واقعاً قفل شد', creditLock?.failCount === 0 && !!creditLock?.lockedUntil && creditLock.lockCount === 1)

console.log('\n۳) RE-AUDIT-HIGH-02: همه‌ی تاییدهای مدیر از __manager__ مشترک استفاده می‌کنند')
await db.authLockout.delete({ where: { gate: MANAGER_GATE } })
// یک ورود موفق ابتدا رکورد رمز پیش‌فرض را می‌سازد.
await authService.verify({ password: DEFAULT_MANAGER_PASSWORD })
for (let i = 0; i < 3; i++) await rejected(() => authService.verify({ password: `wrong-lock-${i}` }))
const locked = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
check('verify گیت __manager__ را قفل کرد', !!locked?.lockedUntil)
check('assertManagerPassword نمی‌تواند قفل __manager__ را دور بزند', /امکان ورود رمز وجود ندارد|حتی رمز درست/.test((await rejected(() => assertManagerPassword(DEFAULT_MANAGER_PASSWORD, 'آزمون مسیر مدیریتی'))) ?? ''))
const locksBefore = await authService.panelLocks()
check(
  'عملیات واقعی setPanelLocks با رمز درست نیز در قفل مشترک رد شد',
  /امکان ورود رمز وجود ندارد|حتی رمز درست/.test(
    (await rejected(() => authService.setPanelLocks({ managerPassword: DEFAULT_MANAGER_PASSWORD, locks: { [PANEL_KEYS.salesReports]: false } }))) ?? ''
  )
)
check('هیچ قفل پنلی در bypass تغییر نکرد', (await authService.panelLocks()).locks[PANEL_KEYS.salesReports] === locksBefore.locks[PANEL_KEYS.salesReports])

console.log(`\nنتیجه RE-AUDIT-HIGH-01/02: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
