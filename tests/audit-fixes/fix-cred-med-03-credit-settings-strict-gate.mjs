/**
 * CRED-MED-03 — تنظیمات اعتبار (طول کد/قواعد مصرف/انقضا) خودِ ارزش اعتبارهای
 * آینده را کنترل می‌کنند؛ خاموش‌کردن قفل ظاهری پنل نباید ذخیره‌ی بی‌رمز را ممکن
 * کند. این مسیر باید گیت strict (مدیر یا رمز دوم/سوم) داشته باشد.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-cred-med-03-credit-settings-strict-gate.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-cred-med-03-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { settingsService } = await import('../../src/main/services/SettingsService.ts')
const { DEFAULT_MANAGER_PASSWORD, SETTING_KEYS } = await import('@shared/receipt')
const { PANEL_KEYS } = await import('@shared/panels')
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

// سناریوی سوءاستفاده‌ی گزارش: مدیر قفل نمایشی creditSettings را خاموش کرده است.
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.creditSettings]: false })
const before = await settingsService.creditSettings()
const next = { ...before, codeLength: before.codeLength === 9 ? 10 : 9 }
const storedBefore = await db.setting.findUnique({ where: { key: SETTING_KEYS.creditSettings } })
const auditBefore = await db.auditLog.count()

let error = null
try {
  await settingsService.saveCreditSettings({ settings: next })
} catch (e) {
  error = String(e?.message ?? e)
}
check('قفل ظاهریِ خاموش، ذخیره‌ی بی‌رمز را مجاز نکرد', /همیشه رمز/.test(error ?? ''))
check(
  'رد بی‌رمز هیچ تنظیم یا Audit تازه‌ای نساخت',
  (await db.setting.findUnique({ where: { key: SETTING_KEYS.creditSettings } }))?.value === storedBefore?.value &&
    (await db.auditLog.count()) === auditBefore
)

const saved = await settingsService.saveCreditSettings({ settings: next, panelPassword: DEFAULT_MANAGER_PASSWORD })
const storedAfter = await db.setting.findUnique({ where: { key: SETTING_KEYS.creditSettings } })
check('رمز مدیر با قفل ظاهریِ خاموش نیز مسیر مجاز را باز می‌کند', saved.codeLength === next.codeLength && storedAfter?.value?.includes(`\"codeLength\":${next.codeLength}`))
check('ذخیره‌ی مجاز دقیقاً یک Audit ثبت کرد', (await db.auditLog.count()) === auditBefore + 1)

console.log(`\nنتیجه CRED-MED-03: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
