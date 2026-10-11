// @ts-check
/**
 * فاز ۹ — قرارداد lock-off در renderer و main:
 * همان سیاستی که ManagerGate را باز می‌کند باید loader داده را هم باز کند؛
 * خواندن policy تا تکمیل‌شدن آن fail-closed می‌ماند و reveal credential هرگز
 * بخشی از این قرارداد نیست.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-s342-lockoff-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { assertPanelUnlocked, clearPanelSessions } = await import('../../src/main/services/panelSession.ts')
const { PANEL_KEYS } = await import('../../src/shared/panels.ts')
const { SETTING_KEYS } = await import('../../src/shared/receipt.ts')

const read = (path) => readFileSync(path, 'utf8')
const managerGate = read('src/renderer/src/components/ManagerGate.tsx')
const panelLocks = read('src/renderer/src/hooks/usePanelLocks.ts')
const reports = read('src/renderer/src/pages/SalesReports.tsx')
const wholesale = read('src/renderer/src/pages/SalesInvoice.tsx')
const db = harnessClient()
const seed = makeSeeder(db)

console.log('--- ۱. یک helper واحد lock-off را با fail-closed نگه می‌دارد ---')
assert.match(managerGate, /const open = canOpen\(panel\) \|\| lockOff/)
assert.match(panelLocks, /return canOpen\(panel\) \|\| \(loaded && !lockEnabled\)/)
console.log('  ✓ ManagerGate و usePanelOpen یک سیاست دارند')

console.log('--- ۲. سه loader از همان helper استفاده می‌کنند ---')
assert.match(reports, /const creditOpen = usePanelOpen\(PANEL_KEYS\.salesCredit\)/)
assert.match(reports, /const open = usePanelOpen\(PANEL_KEYS\.creditManagement\)/)
assert.match(wholesale, /const listUnlocked = usePanelOpen\(PANEL_KEYS\.wholesaleInvoices\)/)
assert.doesNotMatch(reports, /canOpen\(PANEL_KEYS\.(salesCredit|creditManagement)\)/)
assert.doesNotMatch(wholesale, /canOpen\(PANEL_KEYS\.wholesaleInvoices\)/)
console.log('  ✓ پنل باز و loader داده دیگر واگرا نیستند')

console.log('--- ۳. main نیز lock-off را می‌پذیرد ولی lock-on بی‌نشست را رد می‌کند ---')
clearPanelSessions()
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesCredit]: false })
await assert.doesNotReject(() => assertPanelUnlocked(PANEL_KEYS.salesCredit, 'خواندن تستی نسیه'))
seed.setting(SETTING_KEYS.panelLocks, { [PANEL_KEYS.salesCredit]: true })
await assert.rejects(() => assertPanelUnlocked(PANEL_KEYS.salesCredit, 'خواندن تستی نسیه'), /قفل همین بخش را باز کنید/)
console.log('  ✓ policy سمت main با renderer هم‌معناست')

console.log('\nنتیجه: lock-off برای خواندن مجاز داده کار می‌کند؛ عملیات strict و reveal دست‌نخورده‌اند.')
