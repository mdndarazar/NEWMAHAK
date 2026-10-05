/**
 * ممیزی A75-01 / A78-01 — بستن نشست و تعویض (عادی/اجباری) با Audit اتمیک؛ actor
 * واقعی و دلیل تعویض اجباری در سابقه. شکست Audit با trigger SQLite شبیه‌سازی می‌شود.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a75-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const a = seed.user('کارمند الف'), b = seed.user('کارمند ب'), mgr = seed.user('مدیر')
const attempt = async (fn) => { try { return { value: await fn() } } catch (e) { return { error: String(e?.message ?? e) } } }
const s1 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now(), userId: a, staffConfirmed: 1 })

// ۱) بستن ساده با شکست Audit
sql.exec(`CREATE TRIGGER audit_fail BEFORE INSERT ON "AuditLog" WHEN NEW.action = 'SHIFT_CLOSE' BEGIN SELECT RAISE(ABORT, 'audit down'); END`)
const c1 = await attempt(() => shiftService.close({ shiftId: s1, userId: a }))
eq('A75-01: بستن نشست با شکست Audit خطا داد', !!c1.error, true)
eq('A75-01: نشست باز ماند (rollback)', sql.prepare('SELECT closedAt FROM "Shift" WHERE id=?').get(s1).closedAt, null)
// ۲) تعویض اجباری با شکست Audit
const h1 = await attempt(() => shiftService.openSession({ staffId: b, userId: mgr, name: 'صبح', handover: true, managerPassword: '1111', overrideReason: 'کارمند الف بیمار شد' }))
eq('A75-01: تعویض اجباری با شکست Audit رد شد', !!h1.error, true)
eq('A75-01: نشست الف باز ماند', sql.prepare('SELECT closedAt FROM "Shift" WHERE id=?').get(s1).closedAt, null)
eq('A75-01: نشست تازه ساخته نشد', sql.prepare('SELECT COUNT(*) n FROM "Shift"').get().n, 1)
sql.exec('DROP TRIGGER audit_fail')
// ۳) تعویض اجباری موفق: actor و دلیل
const h2 = await attempt(() => shiftService.openSession({ staffId: b, userId: mgr, name: 'صبح', handover: true, managerPassword: '1111', overrideReason: 'کارمند الف بیمار شد' }))
eq('تعویض اجباری موفق', h2.value?.userId, b)
const row = sql.prepare(`SELECT userId, note, after FROM "AuditLog" WHERE action='SHIFT_CLOSE' AND entityId=? ORDER BY id DESC`).get(s1)
eq('A78-01: actor بستن = کاربر جلسه (نه صاحب نشست بسته‌شده)', row?.userId, mgr)
eq('A78-01: دلیل تعویض اجباری در سابقه نشست', /کارمند الف بیمار شد/.test(String(row?.note ?? '')) && /کارمند الف بیمار شد/.test(String(row?.after ?? '')), true)
// ۴) نشست خودکار با Audit خراب مسدود نمی‌شود (fail-open عمدی)
sql.exec(`CREATE TRIGGER audit_fail2 BEFORE INSERT ON "AuditLog" WHEN NEW.action = 'SHIFT_OPEN' BEGIN SELECT RAISE(ABORT, 'audit down'); END`)
sql.exec(`UPDATE "Shift" SET closedAt=${Date.now()}`)
const auto = await attempt(() => shiftService.ensureCurrent())
eq('نشست خودکار با Audit خراب هنوز باز می‌شود (فروش متوقف نمی‌شود)', !auto.error, true)
sql.exec('DROP TRIGGER audit_fail2')
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
