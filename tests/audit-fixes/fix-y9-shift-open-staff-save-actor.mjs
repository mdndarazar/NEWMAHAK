/**
 * Actor integrity after retirement of the old staff:save channel.
 * Shift creation remains bound to Main session; structural staff registration
 * is no longer actor-attributable from renderer at all and uses the complete
 * manager-session route (covered behaviourally in S349/S350).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const src = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
const channels = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')

assert.match(src, /handle\(IPC\.shiftOpen, async \(p\) => shiftService\.open\(await withOptionalSessionActor\(/)
assert.doesNotMatch(src, /handle\(IPC\.staffSave/)
assert.doesNotMatch(channels, /staffSave:\s*'staff:save'/)
assert.match(src, /handle\(IPC\.staffPersonnelSaveComplete,[\s\S]{0,220}assertManagerSession/)
assert.match(src, /const \{ managerSession: _ignored, panelPassword: _panelPassword, userId: _userId, \.\.\.safe \} = p \?\? \{\}/)
assert.doesNotMatch(src, /await withUser\(/)

console.log('✓ actor شیفت همچنان Main-first است و payload actor جعلی برای ثبت ساختاری کارکنان راهی ندارد.')
