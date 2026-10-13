/**
 * ZIP-AUDIT-HIGH-01 — همه‌ی عملیات مدیریتیِ رمز پنل و تغییر رمز باید از همان
 * AuthLockout گیت __manager__ عبور کنند؛ matches() خام نباید باقی بماند.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-high-01-manager-password-paths.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-zip-audit-h1-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { authService } = await import('../../src/main/services/AuthService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW, SETTING_KEYS } = await import('@shared/receipt')
const { MANAGER_GATE, PANEL_KEYS } = await import('@shared/panels')
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
const rejects = async (work) => {
  try {
    await work()
    return ''
  } catch (e) {
    return String(e?.message ?? e)
  }
}

seed.setting(SETTING_KEYS.securityConfig, { lockoutEnabled: true, maxAttempts: 1, lockMinutes: 10 })
// ایجاد/تأیید اولیه‌ی credential قبل از آزمون‌های lockout.
await authService.verify({ password: PW })

const operations = [
  {
    title: 'تعیین رمز دوم پنل',
    run: (managerPassword) => authService.setPanelPassword({ panel: PANEL_KEYS.settings, managerPassword, password: 'panel-zip-audit' })
  },
  {
    title: 'تعیین رمز سوم شیفت',
    run: (managerPassword) => authService.setPanelShiftPassword({ panel: PANEL_KEYS.settings, shift: 1, managerPassword, password: 'shift-zip-audit' })
  },
  {
    title: 'نمایش رمز پنل',
    run: (managerPassword) => authService.revealPanelPassword({ panel: PANEL_KEYS.settings, managerPassword })
  },
  {
    title: 'تغییر رمز مدیر',
    run: (managerPassword) => authService.changePassword({ current: managerPassword, next: 'new-manager-password' })
  }
]

for (const operation of operations) {
  await db.authLockout.deleteMany({ where: { gate: MANAGER_GATE } })
  const wrong = await rejects(() => operation.run('wrong-zip-audit'))
  const row = await db.authLockout.findUnique({ where: { gate: MANAGER_GATE } })
  check(
    `${operation.title}: رمز نادرست در __manager__ قفل ثبت کرد`,
    /رمز مدیر درست نیست|رمز شخصی|رمز اشتباه بود/.test(wrong) && !!row?.lockedUntil && row.lockCount === 1,
    JSON.stringify({ wrong, row })
  )
  const correct = await rejects(() => operation.run(PW))
  check(`${operation.title}: رمز درست در دوره‌ی قفل رد شد`, /امکان ورود رمز وجود ندارد|حتی رمز درست/.test(correct))
}

console.log(`\nنتیجه ZIP-AUDIT-HIGH-01: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
