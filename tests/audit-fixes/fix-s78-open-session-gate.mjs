/**
 * نشست ۷۸ · خوشه A
 *
 * بستن نشستِ کارمند دیگر باید رمز مدیر + دلیل داشته باشد و با openedVia
 * مستقل ثبت شود. تست هم مسیر ردشده را بررسی می‌کند و هم مسیر تأییدشده را.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s78-open-session-gate.mjs
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
const truthy = (label, value) => eq(label, !!value, true)

// به‌روزرسانی نشست ۱۸۳ — این گیت‌ها حالا علاوه بر رمز مدیر، رمز دوم و رمز سومِ
// همان پنل را هم می‌پذیرند (خواسته‌ی مالک: دسترسی فرد مورد اعتماد در نبود مدیر).
// نامِ تابع از `assertManagerPassword` به `assertPanelPassword` عوض شد؛ *ترتیب* و
// *رفتار* دقیقاً همان است، پس فقط قرارداد متنی به‌روز می‌شود.
/**
 * نشست ۱۸۴ — بین تشخیص و گیت، بلوک «نشست جامانده‌ی دیشب» اضافه شده (خوشه E).
 * آنچه سنجیده می‌شود همان است: گیت وجود دارد و **قبل از تراکنش** اجرا می‌شود.
 */
truthy(
  'گیت قبل از تراکنش اجرا می‌شود',
  // نشست ۱۸۶ — گیت به نسخه‌ی «همیشه رمز» ارتقا یافت (قفل خاموش دورش نمی‌زند).
  source.includes('assertPanelPasswordStrict(PANEL_KEYS.cashClose, input.managerPassword') &&
    source.indexOf('assertPanelPasswordStrict(PANEL_KEYS.cashClose') < source.indexOf('prisma.$transaction(async (tx)')
)
truthy('دلیل کوتاه قبل از تعویض رد می‌شود', /requestedReason\.length < 3/.test(source))
truthy('تعویض اجباری برچسب مستقل دارد', /HANDOVER_FORCED/.test(source))

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s78-open-session-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const oldUser = seed.user('کارمند قبلی')
const newUser = seed.user('کارمند جدید')
const oldShift = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now(),
  userId: oldUser,
  staffConfirmed: 1
})

let rejected = false
try {
  await shiftService.openSession({
    staffId: newUser,
    userId: newUser,
    name: 'صبح',
    handover: true,
    overrideReason: 'تعویض آزمایشی'
  })
} catch (error) {
  rejected = String(error?.message ?? error).includes('رمز مدیر')
}
eq('تعویض کارمند دیگر بدون رمز مدیر رد می‌شود', rejected, true)
eq('نشست قبلی بعد از رد گیت هنوز باز است', sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(oldShift)?.closedAt, null)

const forced = await shiftService.openSession({
  staffId: newUser,
  userId: newUser,
  name: 'صبح',
  handover: true,
  managerPassword: '1111',
  overrideReason: 'تعویض اجباری با تحویل صندوق'
})
eq('تعویض تأییدشده نشست تازه می‌سازد', forced?.userId, newUser)
eq('تعویض تأییدشده برچسب مستقل دارد', sql.prepare('SELECT openedVia FROM "Shift" WHERE id = ?').get(forced.id)?.openedVia, 'HANDOVER_FORCED')
truthy('نشست قبلی پس از تعویض تأییدشده بسته است', sql.prepare('SELECT closedAt FROM "Shift" WHERE id = ?').get(oldShift)?.closedAt)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
