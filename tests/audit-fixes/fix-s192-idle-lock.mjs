/**
 * نشست ۱۹۲ — بند ۴-۴۰: قفل خودکار بعد از بی‌کاری.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s192-idle-lock.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s192-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const { parseSecurityConfig, DEFAULT_SECURITY_CONFIG } = await import('../../src/shared/receipt.ts')
const {
  notePanelUnlocked,
  isPanelUnlocked,
  clearPanelSessions,
  applyPanelSessionTtlMs,
  applyPanelSessionTtlMinutes,
  panelSessionTtlMs,
  PANEL_SESSION_TTL_MS
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

console.log('\n۴-۴۰) پیش‌فرض و پارس تنظیم')
eq('پیش‌فرض ۵ دقیقه', DEFAULT_SECURITY_CONFIG.idleLockMinutes, 5)
eq('JSON قدیمی بدون فیلد ⇒ ۵', parseSecurityConfig({ lockoutEnabled: true, maxAttempts: 3, lockMinutes: 10 }).idleLockMinutes, 5)
eq('۶۰ دقیقه پذیرفته می‌شود', parseSecurityConfig({ idleLockMinutes: 60 }).idleLockMinutes, 60)
eq('۰ به حداقل ۱ دقیقه می‌رسد', parseSecurityConfig({ idleLockMinutes: 0 }).idleLockMinutes, 1)
eq('۱۴۴۱ به ۱۴۴۰ محدود می‌شود', parseSecurityConfig({ idleLockMinutes: 1441 }).idleLockMinutes, 1440)

console.log('\n۴-۴۰) TTL سرور از تنظیمات')
applyPanelSessionTtlMinutes(5)
eq('۵ دقیقه = پیش‌فرض ثابت', panelSessionTtlMs(), PANEL_SESSION_TTL_MS)
applyPanelSessionTtlMinutes(10)
eq('۱۰ دقیقه', panelSessionTtlMs(), 10 * 60 * 1000)

console.log('\n۴-۴۰) انقضای نشست پنل')
clearPanelSessions()
applyPanelSessionTtlMs(40)
notePanelUnlocked('credit', 'MANAGER')
eq('بلافاصله باز است', isPanelUnlocked('credit'), true)
await new Promise((r) => setTimeout(r, 80))
eq('بعد از TTL بسته است', isPanelUnlocked('credit'), false)

console.log('\n۴-۴۰) خروج همه را پاک می‌کند')
applyPanelSessionTtlMinutes(5)
notePanelUnlocked('credit', 'MANAGER')
eq('قبل از خروج باز است', isPanelUnlocked('credit'), true)
clearPanelSessions()
eq('بعد از خروج بسته است', isPanelUnlocked('credit'), false)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
