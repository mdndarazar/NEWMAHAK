/**
 * ===========================================================================
 * نشست ۱۶۵ · S165-D4 — گیت سمت main برای staff:save (ریسک باز «staffSave بی‌رمز»، S160-D3).
 *
 * قبل از رفع: فهرست کارمندان فقط در UI پشت پنل همیشه‌قفل «تنظیمات» بود؛ IPC.staffSave بی‌هیچ رمزی
 * نام/نقش/فعال‌بودن هر کارمند را عوض می‌کرد یا کارمند تازه می‌ساخت. نام کارمند در همه‌ی گزارش‌های گذشته
 * زنده خوانده می‌شود ⇒ فروشنده می‌توانست نام خودش و همکارش را جابه‌جا کند و مسئولیت فروش/برگشت/مغایرت‌های
 * گذشته را در گزارش به گردن دیگری بیندازد (هدف ضدسرقت؛ بند ۴-۲۹ مورد ۱، بند ۵ «هر گیت در main»).
 *
 *     node --import ./test/harness/register.mjs tests/pending/fix-s165-staff-save-gate.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s165-staff-'))
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
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const ipcOk = async (label, ch, payload) => {
  const r = await ipc(ch, payload)
  if (r?.ok) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} — ${String(r?.error).slice(0, 200)}`) }
  return r?.data
}
const ipcRejects = async (label, ch, payload, needle) => {
  const r = await ipc(ch, payload)
  if (r?.ok === false && /[\u0600-\u06FF]/.test(String(r.error)) && (!needle || String(r.error).includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${String(r.error).slice(0, 110)})`) }
  else { bad++; console.log(`  ✗ ${label} — ${r?.ok ? 'بدون رمز پذیرفته شد' : 'پیام نامنتظره: ' + String(r?.error).slice(0, 160)}`) }
}
const userRow = (id) => seed.one('SELECT displayName, role, isActive FROM "User" WHERE id = ?', id)
const shape = (r) => [r?.displayName, r?.role, Number(r?.isActive)]
const audits = () => seed.count('AuditLog', "action IN ('STAFF_CREATE','STAFF_UPDATE')")
const users = () => seed.count('User')

const ali = seed.user('علی')
const reza = seed.user('رضا')
seed.rows('UPDATE "User" SET role = \'CASHIER\', isActive = 1 WHERE id IN (?, ?) RETURNING id', ali, reza)

console.log('\n۱) بدون رمز / رمز غلط ⇒ رد، هیچ تغییری نه در کارمند نه در Audit')
const a0 = audits(); const u0 = users()
await ipcRejects('تغییر نام «رضا» به «علی» بی‌رمز', IPC.staffSave, { id: reza, name: 'علی', role: 'CASHIER' }, 'رمز')
await ipcRejects('غیرفعال‌کردن «علی» بی‌رمز', IPC.staffSave, { id: ali, name: 'علی', role: 'CASHIER', isActive: false }, 'رمز')
await ipcRejects('ارتقای نقش به مدیر بی‌رمز', IPC.staffSave, { id: ali, name: 'علی', role: 'MANAGER' }, 'رمز')
await ipcRejects('کارمند ساختگی بی‌رمز', IPC.staffSave, { name: 'کارمند ساختگی', role: 'CASHIER' }, 'رمز')
await ipcRejects('تغییر نام با رمز غلط', IPC.staffSave, { id: reza, name: 'علی', role: 'CASHIER', panelPassword: 'wrong-165' }, 'رمز')
eq('«رضا» دست‌نخورده', shape(userRow(reza)), ['رضا', 'CASHIER', 1])
eq('«علی» دست‌نخورده', shape(userRow(ali)), ['علی', 'CASHIER', 1])
eq('کارمند تازه‌ای ساخته نشد', users(), u0)
eq('هیچ Audit کارمندی ثبت نشد', audits(), a0)

console.log('\n۲) با رمز مدیر ⇒ پذیرفته و Audit')
await ipcOk('ویرایش نام با رمز مدیر', IPC.staffSave, { id: reza, name: 'رضا احمدی', role: 'CASHIER', panelPassword: PW })
eq('نام عوض شد', userRow(reza)?.displayName, 'رضا احمدی')
const created = await ipcOk('ثبت کارمند تازه با رمز مدیر', IPC.staffSave, { name: 'سارا', role: 'STOCKKEEPER', panelPassword: PW })
eq('کارمند تازه ساخته شد', users(), u0 + 1)
eq('دو Audit کارمند ثبت شد', audits(), a0 + 2)
await ipcRejects('کارمند ناموجود ⇒ «پیدا نشد» پیش از رمز', IPC.staffSave, { id: 987654, name: 'x', role: 'CASHIER' }, 'پیدا نشد')

console.log('\n۳) UI: کادر رمز در فرم کارمند و ارسال panelPassword')
const ui = readFileSync(resolve('src/renderer/src/pages/Settings.tsx'), 'utf8')
eq('فرم کارمند panelPassword می‌فرستد', /CH\.staffSave, \{[\s\S]{0,200}panelPassword: staffPw/.test(ui), true)
eq('دکمه‌ی ذخیره با رمز خالی غیرفعال', /saveStaff\(\)\} disabled=\{staffBusy \|\| !staffPw\.trim\(\)\}/.test(ui), true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
