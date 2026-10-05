/**
 * ممیزی A80-01 — idempotency بازکردن نشست (S80).
 * (۱) مسیر تصادم یکتا (P2002) که S80 فقط «در کد پیاده» کرده بود واقعاً اجرا می‌شود:
 *     دو caller که هر دو pre-check را رد کرده‌اند ⇒ caller دوم همان نشست را می‌گیرد،
 *     نشست caller اول بسته نمی‌شود و Shift سوم ساخته نمی‌شود.
 * (۲) کلید UI با هر بار باز شدن پنجره تازه می‌شود؛ قبلاً کلید بعد از خطا تا
 *     unmount زنده می‌ماند و درخواست تازه با ورودی متفاوت برای همیشه با «کلید
 *     برای درخواست متفاوت» رد می‌شد (پنجره‌ی اجباری قفل).
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const ui = readFileSync(resolve('src/renderer/src/components/ShiftSessionModal.tsx'), 'utf8')
eq('UI: کلید retry با باز شدن دوباره‌ی پنجره تازه می‌شود', /const load = useCallback\(async \(\) => \{[\s\S]{0,200}openRequestKey\.current = null/.test(ui), true)
eq('UI: رد «کلید برای درخواست متفاوت» کلید را پاک می‌کند', /catch \(e: any\) \{[\s\S]{0,300}درخواست متفاوت[\s\S]{0,120}openRequestKey\.current = null/.test(ui), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a80-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const staff = seed.user('کارمند')
sql.exec('UPDATE "Shift" SET closedAt = CURRENT_TIMESTAMP WHERE closedAt IS NULL')
const req = { name: 'صبح', staffId: staff, userId: staff, idempotencyKey: 'k-race-1' }
const first = await shiftService.openSession(req)
// شبیه‌سازی caller دوم که pre-check را قبل از commit اول انجام داده بود
const orig = db.shift.findUnique.bind(db.shift)
let skip = 1
db.shift.findUnique = async (args) => (skip-- > 0 && args?.where?.openIdempotencyKey ? null : orig(args))
let second = null, err = ''
try { second = await shiftService.openSession(req) } catch (e) { err = String(e.message) }
db.shift.findUnique = orig
eq('caller دوم خطا نگرفت', err, '')
eq('caller دوم همان نشست را گرفت', second?.id, first?.id)
const rows = sql.prepare('SELECT id, closedAt FROM "Shift" WHERE id >= ? ORDER BY id').all(first.id)
eq('Shift تازه‌ای ساخته نشد', rows.length, 1)
eq('نشست caller اول باز ماند (rollback کامل)', rows[0]?.closedAt ?? null, null)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
