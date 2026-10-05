/**
 * ===========================================================================
 * نشست ۱۶۰ · خوشه E/K · Y9 (باقی‌مانده) · actor کانال‌های shiftOpen و staffSave (بند ۴-۳۰، بند ۵)
 *
 * قبل از رفع: IPC.shiftOpen و IPC.staffSave با withUser پیچیده بودند ⇒ userId فرستاده‌شده از
 * رندرر دست‌نخورده در AuditLog می‌نشست (جعل actor: «چه کسی نشست را باز کرد / کارمند را
 * ساخت یا غیرفعال کرد»).
 * بعد از رفع (S160-D2/D3): هر دو withOptionalSessionActor ⇒ actor همیشه از نشست باز main؛
 * shiftOpen بدون نشست باز ⇒ actor همان کارمندِ صریحاً انتخاب‌شده‌ی نشست (staffId)، مثل
 * کانال رسمی shiftSessionOpen؛ هرگز userId رندرر.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y9-shift-open-staff-save-actor.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y9-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
// نشست ۱۶۵ (S165-D5): staffSave رمز پنل تنظیمات می‌خواهد (S165-D4)؛ فقط setup — قصد تست (actor نشست) دست نخورد
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 200)}`) }
  return r?.data
}
const lastAudit = (action) => seed.one('SELECT id, userId FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1', action)
const uid = (row) => (row == null ? 'بدون ردیف' : row.userId == null ? null : Number(row.userId))

const staff = seed.user('صندوق‌دار Y9')
const forged = seed.user('کارمند جعلی Y9')

console.log('\n۱) shiftOpen بدون نشست باز، با userId جعلی ⇒ actor = کارمند انتخاب‌شده (staffId)')
const opened = await ipcOk('shiftOpen', IPC.shiftOpen, { staffId: staff, name: 'صبح', userId: forged })
truthy('نشست باز شد', opened?.id > 0 || opened?.shiftId > 0 || !!opened)
eq('actor Audit SHIFT_OPEN', uid(lastAudit('SHIFT_OPEN')), staff)

console.log('\n۲) staffSave با نشست باز و userId جعلی ⇒ actor نشست')
const created = await ipcOk('staffSave (ثبت تازه)', IPC.staffSave, { name: 'کارمند تازه Y9', role: 'CASHIER', userId: forged, panelPassword: PW })
eq('actor Audit STAFF_CREATE', uid(lastAudit('STAFF_CREATE')), staff)
await ipcOk('staffSave (غیرفعال‌سازی)', IPC.staffSave, { id: created?.id, name: 'کارمند تازه Y9', role: 'CASHIER', isActive: false, userId: forged, panelPassword: PW })
eq('actor Audit STAFF_UPDATE', uid(lastAudit('STAFF_UPDATE')), staff)

console.log('\n۳) ساختار: هیچ کانالی در ipc/index.ts دیگر withUser نمی‌گیرد')
const src = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
truthy('shiftOpen ⇒ withOptionalSessionActor', /handle\(IPC\.shiftOpen, async \(p\) => shiftService\.open\(await withOptionalSessionActor\(/.test(src))
truthy('staffSave ⇒ withOptionalSessionActor', /handle\(IPC\.staffSave, async \(p\) => staffService\.save\(await withOptionalSessionActor\(/.test(src))
truthy('هیچ فراخوانی await withUser( نمانده', !/await withUser\(/.test(src))

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
