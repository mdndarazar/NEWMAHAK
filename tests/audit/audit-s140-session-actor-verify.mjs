/**
 * ممیزی نشست ۱۴۰ (S140) — actor چرخه‌ی نشست از مسیر IPC واقعی (fix-s140 فقط regex بود).
 *   • اولین نشست بی‌نشست قبلی مجاز؛ actor جعلی renderer در Audit نمی‌نشیند.
 *   • تعویض اجباری کارمند بدون رمز مدیر رد؛ با رمز ⇒ actor Audit بستن = کارمند نشست باز، نه userId جعلی.
 *   • AUDIT-S140-01: confirmStaff (کانال shiftSessionStaff) هر نشستی را می‌پذیرفت: نشستِ تأییدشده‌ی کارمند
 *     دیگر بی‌رمز به کارمند تازه منتقل می‌شد (دور زدن گیت «تعویض اجباری کارمند نشست» A78) و نشست بسته‌ی
 *     دیروز هم با shiftId صریح به کارمند دیگری نسبت داده می‌شد (مسئول کسری صندوق عوض می‌شد).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s140a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db)
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)
const today = jalaliToday()
const H = 3600_000
const A = seed.user('کارمند الف ۱۴۰')
const B = seed.user('کارمند ب ۱۴۰')
const forged = seed.user('کارمند جعلی ۱۴۰')
const lastAudit = (action) => seed.one(`SELECT userId, note FROM "AuditLog" WHERE action = ? ORDER BY id DESC LIMIT 1`, action)
const shiftRow = (id) => seed.one('SELECT id, userId, staffConfirmed, closedAt FROM "Shift" WHERE id = ?', id)
const openRow = () => seed.one('SELECT id, userId, staffConfirmed FROM "Shift" WHERE closedAt IS NULL ORDER BY id DESC LIMIT 1')

console.log('\n— ۱) اولین نشست')
{
  const r = await ipc(IPC.shiftSessionOpen, { staffId: A, userId: forged, idempotencyKey: 'k140-1' })
  eq('اولین نشست بی‌نشست قبلی باز شد', r?.ok ? true : r?.error, true)
  eq('نشست باز = کارمند الف، تأییدشده', [Number(openRow()?.userId), Number(openRow()?.staffConfirmed)], [A, 1])
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'Shift' ORDER BY id DESC LIMIT 1`)
  eq('actor Audit ≠ userId جعلی', Number(a?.userId) !== forged, true)
}
const shiftA = Number(openRow()?.id)

console.log('\n— ۲) AUDIT-S140-01: confirmStaff نشست تأییدشده‌ی کارمند دیگر')
{
  const r = await ipc(IPC.shiftSessionStaff, { shiftId: shiftA, staffId: B, userId: forged })
  eq('انتقال بی‌رمز نشست تأییدشده‌ی الف به ب رد می‌شود', r?.ok === false && /تعویض کارمند|رمز مدیر/.test(String(r?.error)), true)
  eq('کارمند نشست همچنان الف', Number(shiftRow(shiftA)?.userId), A)
  const r2 = await ipc(IPC.shiftSessionStaff, { staffId: B })
  eq('بدون shiftId (نشست باز) هم رد می‌شود', r2?.ok === false, true)
  eq('کارمند نشست همچنان الف (۲)', Number(shiftRow(shiftA)?.userId), A)
  const r3 = await ipc(IPC.shiftSessionStaff, { shiftId: shiftA, staffId: A })
  eq('تأیید دوباره‌ی همان کارمند مجاز است', r3?.ok ? true : r3?.error, true)
}

console.log('\n— ۳) تعویض اجباری از مسیر shiftSessionOpen')
{
  const r = await ipc(IPC.shiftSessionOpen, { staffId: B, handover: true, userId: B, idempotencyKey: 'k140-2' })
  eq('تعویض اجباری بی‌رمز رد', r?.ok === false && /دلیل|رمز/.test(String(r?.error)), true)
  eq('نشست الف هنوز باز', shiftRow(shiftA)?.closedAt == null, true)
  const r2 = await ipc(IPC.shiftSessionOpen, { staffId: B, handover: true, userId: forged, managerPassword: PW, overrideReason: 'الف بیمار شد', idempotencyKey: 'k140-3' })
  eq('با رمز مدیر و دلیل: تعویض انجام شد', r2?.ok ? true : r2?.error, true)
  eq('نشست الف بسته شد', shiftRow(shiftA)?.closedAt != null, true)
  const c = lastAudit('SHIFT_CLOSE')
  eq('actor Audit بستن = کارمند نشست باز (الف)، نه userId جعلی', Number(c?.userId), A)
}

console.log('\n— ۴) AUDIT-S140-01: confirmStaff نشست بسته')
{
  const r = await ipc(IPC.shiftSessionStaff, { shiftId: shiftA, staffId: B })
  eq('نسبت‌دادن نشست بسته‌ی الف به ب رد می‌شود', r?.ok === false && /بسته/.test(String(r?.error)), true)
  eq('کارمند نشست بسته همچنان الف', Number(shiftRow(shiftA)?.userId), A)
}

console.log('\n— ۵) نشست خودکار بی‌کارمند (مسیر درست confirmStaff)')
{
  // نشست ب را می‌بندیم و یک نشست خودکار تأییدنشده جایش می‌گذاریم
  const shiftB = Number(openRow()?.id)
  seed.rows('SELECT 1') // no-op
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now() - 1000, shiftB)
  const auto = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: today, openedAt: Date.now() - 500, staffConfirmed: 0, openedVia: 'AUTO' })
  const inv = seed.insert('SaleInvoice', { receiptNo: 14001, status: 'FINAL', grandTotal: 1000, paidTotal: 1000, goodsTotal: 1000, issuedAt: Date.now(), issuedAtJalali: today, shiftId: auto })
  const r = await ipc(IPC.shiftSessionStaff, { staffId: B, userId: forged })
  eq('تأیید کارمند نشست خودکار انجام شد', r?.ok ? true : r?.error, true)
  eq('نشست خودکار = کارمند ب، تأییدشده', [Number(shiftRow(auto)?.userId), Number(shiftRow(auto)?.staffConfirmed)], [B, 1])
  eq('فاکتور بی‌کارمند همان نشست برچسب ب گرفت', Number(seed.one('SELECT userId FROM "SaleInvoice" WHERE id = ?', inv)?.userId), B)
  const a = lastAudit('SHIFT_OPEN')
  eq('actor Audit تأیید ≠ userId جعلی', Number(a?.userId) !== forged, true)
}
console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
