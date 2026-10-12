/**
 * Regression: enabling custody must remove every legacy name-only session path.
 * A stale/contradictory feature flag must also fail closed when durable custody
 * state proves that a drawer is still governed.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s374-custody-legacy-fail-closed.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-custody-fail-closed-s374-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { custodyService } = await import('../../src/main/services/CustodyService.ts')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const legacyChipSource = readFileSync(new URL('../../src/renderer/src/components/ShiftSessionModal.tsx', import.meta.url), 'utf8')
const custodyChipSource = readFileSync(new URL('../../src/renderer/src/components/CustodyChip.tsx', import.meta.url), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${String(got)}، انتظار ${String(want)}`) }
}
const rejects = async (label, code, work) => {
  try { await work(); eq(label, true, false) }
  catch (error) { eq(label, error?.code, code) }
}

const manager = seed.user('مدیر S374')
const cashier = seed.user('صندوقدار S374')
await custodyService.setPin({ userId: manager, newPassword: 'Manager374!', currentPassword: '1111' })
await custodyService.setConfig({ config: { enabled: true }, managerUserId: manager, managerPassword: 'Manager374!' })
await custodyService.setPin({ userId: cashier, newPassword: 'Cashier374!', managerUserId: manager, managerPassword: 'Manager374!', reason: 'راه‌اندازی آزمون' })
await custodyService.setPin({ userId: cashier, currentPassword: 'Cashier374!', newPassword: 'Cashier3744!' })

const activeStatus = await custodyService.status()
eq('حضانت فعال، وضعیت governed را صریح برمی‌گرداند', activeStatus.governed, true)
eq('چیپ legacy تا verdict صریح main پنهان می‌ماند', legacyChipSource.includes('if (custodyGoverned !== false) return null'), true)
eq('چیپ custody مسیر بازیابیِ governed را حتی با config ناسازگار نشان می‌دهد', custodyChipSource.includes('const governed = status.governed === true || status.enabled === true') && custodyChipSource.includes('if (!governed)'), true)
await rejects('فرم قدیمی نشست در حضانت فعال حتی برای IPC مستقیم بسته است', 'CUSTODY_LEGACY_PATH', () => shiftService.sessionForm())
await rejects('بازکردن نشست قدیمی در حضانت فعال بسته است', 'CUSTODY_LEGACY_PATH', () => shiftService.openSession({ name: 'شیفت آزمون', staffId: cashier }))

const opened = await custodyService.open({ userId: cashier, password: 'Cashier3744!', countedCash: 1000 })
const before = Number(db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n)
// Simulate a stale/manual Settings row. Durable state must still prevent the
// old flow from creating a second drawer or a name-only assignment.
seed.setting('custody.config', { enabled: false, mode: 'SINGLE_SHIFT' })
const contradictoryStatus = await custodyService.status()
eq('state پایدار حتی با flag خراب، governed باقی می‌ماند', contradictoryStatus.governed, true)
await rejects('فرم قدیمی با state حضانت باز هم fail-closed است', 'CUSTODY_LEGACY_PATH', () => shiftService.sessionForm())
const current = await shiftService.current()
eq('shift:current در حالت متناقض نشست AUTO قدیمی نمی‌سازد', current?.id, opened.shiftId)
eq('هیچ نشست دوم legacy ساخته نشد', Number(db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n), before)

// The normal configuration route must not create this contradiction. Restore
// the feature row, create a real unresolved case, then prove that Settings
// refuses to hide its recovery path.
seed.setting('custody.config', { enabled: true, mode: 'SINGLE_SHIFT' })
db.$harness.db.prepare('UPDATE "CustodyShiftMeta" SET rolloverAt=? WHERE shiftId=?').run(Date.now() - 1_000, opened.shiftId)
const rollover = await custodyService.ensureRolledOver()
eq('rollover پرونده بازیابی باز ایجاد می‌کند', !!rollover?.resolutionId, true)
const shiftsAtRecovery = Number(db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n)
eq('پرونده بازیابی باز هم status را governed نگه می‌دارد', (await custodyService.status()).governed, true)
eq('shift:current با پرونده بازیابی، AUTO legacy نمی‌سازد', await shiftService.current(), null)
eq('پرونده بازیابی شمار Shift را تغییر نمی‌دهد', Number(db.$harness.db.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n), shiftsAtRecovery)
await rejects('تنظیمات نمی‌تواند حضانت را با پرونده بازیابی باز خاموش کند', 'CUSTODY_RECOVERY_OPEN', () => custodyService.setConfig({ config: { enabled: false }, managerUserId: manager, managerPassword: 'Manager374!' }))

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
