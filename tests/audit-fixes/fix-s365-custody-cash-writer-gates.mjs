/**
 * Regression guard for the audited cash-writer boundary. Renderer payloads never
 * pick a custody actor/fence, pending sales retain the outgoing actor, and the
 * legacy cash-close route cannot bypass CustodyService.finalClose.
 *
 * node tests/audit-fixes/fix-s365-custody-cash-writer-gates.mjs
 */
import { readFileSync } from 'node:fs'
const ipc = readFileSync(new URL('../../src/main/ipc/index.ts', import.meta.url), 'utf8')
const custody = readFileSync(new URL('../../src/main/services/CustodyService.ts', import.meta.url), 'utf8')
const cashClose = readFileSync(new URL('../../src/renderer/src/pages/CashClose.tsx', import.meta.url), 'utf8')
const checks = [
  ['actor فروش از custody state/fence سرور گرفته می‌شود', ipc.includes('const fence = await custodyService.actorForFinancialOperation()') && ipc.includes('custodyFence: fence')],
  ['گردش دستی نقد نیز از همان actor gate می‌گذرد', ipc.includes("cashMovementService.add(await withSessionActor(p ?? {}, 'ثبت گردش نقدی'))")],
  ['IPC بستن قدیمی هنگام حضانت fail-closed است', ipc.includes("await custodyService.guardLegacyPath()") && ipc.includes("handle(IPC.cashClose, async (p) => {")],
  ['pending فروش را نگه می‌دارد و actor خروجی را fence می‌کند', custody.includes("state.state !== 'ACTIVE' && state.state !== 'HANDOVER_PENDING'") && custody.includes("state: { in: ['ACTIVE', 'HANDOVER_PENDING'] }")],
  ['Cash Close تا پاسخ صریح main، مسیر legacy را fail-closed نگه می‌دارد', cashClose.includes('custodyGoverned === false') && cashClose.includes('disabled={custodyGoverned !== false || busy || (needsNote && !note.trim())}')]
]
let failed = 0
for (const [label, pass] of checks) { console.log(`${pass ? '✓' : '✗'} ${label}`); if (!pass) failed++ }
console.log(`\n${failed ? '✗' : '✓'} ${checks.length - failed} بررسی موفق · ${failed} ناموفق`)
process.exitCode = failed ? 1 : 0
