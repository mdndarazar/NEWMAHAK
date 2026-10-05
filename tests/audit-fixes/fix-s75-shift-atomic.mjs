/**
 * نشست ۷۵ · خوشه A
 *
 * بستن نشست قبلی و ساخت نشست تازه باید یک تراکنش باشند. اگر ساخت نشست تازه
 * fail شود، نشست قبلی نباید بسته بماند و صندوق نباید بدون نشست باز رها شود.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s75-shift-atomic.mjs
 */
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`)
  }
}

eq('بازکردن/بستن نشست در تراکنش انجام می‌شود', /prisma\.\$transaction\(async \(tx\) =>/.test(source), true)
eq('بستن نشست قبلی با updateMany شرطی است', /where: \{ id: open\.id, closedAt: null \}/.test(source), true)
// نشست ۱۸۳ — گیت حالا رمز دوم/سوم پنل «بستن صندوق» را هم می‌پذیرد؛ خودِ گیت سر جایش است.
eq(
  'تعویض نشست کارمند دیگر گیت رمز دارد',
  /assertPanelPasswordStrict\(PANEL_KEYS\.cashClose, input\.managerPassword, 'تعویض اجباری کارمند نشست'\)/.test(source),
  true
)
eq('تعویض اجباری برچسب مستقل دارد', /HANDOVER_FORCED/.test(source), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s75-shift-atomic-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const firstUser = seed.user('کارمند نشست قبلی')
const nextUser = seed.user('کارمند نشست بعدی')
const firstShift = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now(),
  userId: firstUser,
  staffConfirmed: 1
})

db.$harness.breakNext('Shift', 'create')
try {
  await shiftService.openSession({
    staffId: nextUser,
    userId: nextUser,
    name: 'صبح',
    handover: true,
    managerPassword: '1111',
    overrideReason: 'تست اتمیک تعویض نشست'
  })
  bad++
  console.log('  ✗ خطای ساخت نشست تازه باید تراکنش را rollback می‌کرد')
} catch (error) {
  eq('خطای ساخت نشست تازه به caller رسید', String(error?.message ?? error).includes('عمداً شکست'), true)
}

const previous = sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(firstShift)
eq('نشست قبلی بعد از شکست هنوز باز است', previous?.closedAt, null)
eq('نشست تازه‌ی نیمه‌کاره ساخته نشده است', sql.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n, 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
