/**
 * جایگزین گیت قدیمی staff:save:
 * کارمند بدون پروندهٔ کامل دیگر IPC عمومی ندارد. تنها مسیر Renderer، عملیات
 * اتمی manager-session است؛ تست end-to-end آن در S349/S350 نگه‌داری می‌شود.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file) => readFileSync(resolve(file), 'utf8')
const ipc = read('src/main/ipc/index.ts')
const channels = read('src/shared/ipc.ts')
const settings = read('src/renderer/src/pages/Settings.tsx')

assert.doesNotMatch(channels, /staffSave:\s*'staff:save'/)
assert.doesNotMatch(ipc, /handle\(IPC\.staffSave/)
assert.match(channels, /staffPersonnelSaveComplete:\s*'staff:personnel:saveComplete'/)
assert.match(ipc, /handle\(IPC\.staffPersonnelSaveComplete,[\s\S]{0,220}assertManagerSession/)
assert.match(settings, /CH\.staffPersonnelSaveComplete/)
assert.doesNotMatch(settings, /CH\.staffSave/)

console.log('✓ مسیر عمومی staff:save حذف و ثبت کامل کارکنان به نشست مدیر + تراکنش اتمی محدود شد.')
