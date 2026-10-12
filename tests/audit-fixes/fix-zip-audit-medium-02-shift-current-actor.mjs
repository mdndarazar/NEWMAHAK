/**
 * ZIP-AUDIT-MEDIUM-02
 *
 * `shift:current` may create an AUTO shift. Its userId payload was not the
 * shift owner, but it was copied into the SHIFT_OPEN audit actor, allowing a
 * renderer caller to forge who opened the session.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-zip-audit-medium-02-shift-current-actor.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'mahak-zip-medium-02-'))
process.env.HARNESS_DIR = dir
process.env.HARNESS_DB = join(dir, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (channel, handler) => handlers.set(channel, handler)
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 92002, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { AuditAction } = await import('@shared/enums')

const db = harnessClient()
const seed = makeSeeder(db)
const forgedUserId = seed.user('کارمند جعل‌شده')
registerIpcHandlers()

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — دریافت ${JSON.stringify(got)}، انتظار ${JSON.stringify(want)}`) }
}

console.log('۱) userId ارسالی در shift:current actor نیست')
const response = await handlers.get(IPC.shiftCurrent)({ sender }, { userId: forgedUserId })
const audit = await db.auditLog.findFirst({ where: { action: AuditAction.SHIFT_OPEN }, orderBy: { id: 'desc' } })
eq('IPC نشست جاری را پاسخ می‌دهد', response?.ok, true)
eq('AUTO shift به کاربر جعل‌شده نسبت داده نمی‌شود', response?.data?.userId, null)
eq('Audit actor از payload جعل‌شده نیست', audit?.userId, null)
eq('ردیف audit واقعاً برای باز شدن AUTO نوشته شده است', audit?.entity, 'Shift')

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
