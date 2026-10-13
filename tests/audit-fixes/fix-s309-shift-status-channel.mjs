// نشست ۳۰۹: تست قبل/بعد بایگانی مرحله‌ی ۱ «ریکوری نشست + پیام‌های وضعیت‌محور».
/**
 * ===========================================================================
 * نشست ۳۰۹ · مسیر ریکوری نشست · بند ۳/۵/۷ (کانال shift:status + چیپ قرمز)
 *
 * قبل از رفع: UI فقط shift:current را داشت که در حالت «نشست جامانده» خطا
 * می‌داد و چیپ با catch داخلی ساکت می‌ماند («نشست: —»)؛ هیچ راهی برای دانستن
 * دلیل سکوت وجود نداشت و هر فراخوانِ نشستِ-ناموجود (لیس‌تاپ‌های چرخه‌ی عمر)
 * هم یک نشست AUTO چاپ می‌کرد.
 *
 * انتظار بعد از رفع:
 *   الرنتایم: shiftService.status() برای هر چهار حالت درست پاسخ می‌دهد
 *     (NONE / STAFF_PENDING / STALE / OK) و *هیچ‌چیزی نمی‌سازد* (بدون AUTO).
 *   ساختاری: کانال IPC رجیستر شده، نوع blockReason در فرم نشست است، و چیپ
 *     برای حالت جامانده برچسب قرمز + رویدادهای سراسری ریکاوری را دارد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s309-shift-status-channel.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s309-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { jalaliToday, jalaliAddDays } = await import('@shared/jalali')

let ok = 0
let bad = 0
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const eq = (label, got, want) => (got === want ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`)))

/* ----------------------------- قفل‌های ساختاری --------------------------- */
{
  const ipcShared = readFileSync(resolve('src/shared/ipc.ts'), 'utf8')
  truthy("ساختاری: کانال shift:status در رجیستری مشترک است", /shiftStatus: 'shift:status'/.test(ipcShared))

  const ipcMain = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
  truthy('ساختاری: handler کانال رجیستر شده است', /handle\(IPC\.shiftStatus, \(\) => shiftService\.status\(\)\)/.test(ipcMain))
  truthy('ساختاری: handle کدهای BusinessError را عبور می‌دهد', /err\?\.isBusinessError === true && typeof err\?\.code === 'string'/.test(ipcMain))

  const types = readFileSync(resolve('src/shared/types.ts'), 'utf8')
  truthy('ساختاری: فرم نشست blockReason دارد (از جمله OVERTIME_ELIGIBLE برای فاز بعد)', /blockReason: 'NONE' \| 'STAFF_PENDING' \| 'STALE_OPEN' \| 'OVERTIME_ELIGIBLE'/.test(types))
  truthy('ساختاری: نوع ShiftStatusInfo با چهار حالت', /'OK' \| 'STAFF_PENDING' \| 'STALE' \| 'NONE'/.test(types))

  const chip = readFileSync(resolve('src/renderer/src/components/ShiftSessionModal.tsx'), 'utf8')
  truthy('ساختاری: چیپ از useShiftGate استفاده می‌کند', /useShiftGate\(30_000\)/.test(chip))
  truthy('ساختاری: حالت جامانده برچسب قرمز چیپ دارد', /bg-red-600/.test(chip) && /نشست جامانده/.test(chip))
  truthy("ساختاری: چیپ به 'mahak:open-shift-modal' گوش می‌دهد", /addEventListener\('mahak:open-shift-modal'/.test(chip))
  truthy("ساختاری: چیپ بعد از موفق 'mahak:shift-changed' می‌فرستد", /dispatchEvent\(new Event\('mahak:shift-changed'\)\)/.test(chip))
  truthy('ساختاری: useCurrentShift دست‌نخورده باقی است (مصرف‌کننده‌های دیگر)', /CH\.shiftCurrent/.test(chip))
}

/* ----------------------------- runtime: چهار حالت ------------------------- */
const today = jalaliToday()
const yesterday = jalaliAddDays(today, -1)

// الف) هیچ نشستی: NONE — و مهم: هیچ ردیفی ساخته نمی‌شود (برخلاف shift:current)
{
  const before = seed.count('Shift')
  const st = await shiftService.status()
  eq('الف) بدون نشست ⇒ NONE', st.state, 'NONE')
  truthy('الف) status هیچ شیفتی نمی‌سازد (بدون AUTO)', seed.count('Shift') === before)
  const form = await shiftService.sessionForm()
  eq('الف) blockReason فرم: NONE', form.blockReason, 'NONE')
}

// ب) نشست امروز بدون کارمند: STAFF_PENDING
{
  const id = seed.insert('Shift', { name: 'صبح', sessionSeq: 1, dayJalali: today, userId: null, closedAt: null })
  const st = await shiftService.status()
  eq('ب) نشست بدون کارمند ⇒ STAFF_PENDING', st.state, 'STAFF_PENDING')
  truthy('ب) شیفت برگشتی هم userId خالی دارد', st.shift != null && st.shift.userId == null)
  const form = await shiftService.sessionForm()
  eq('ب) blockReason فرم: STAFF_PENDING', form.blockReason, 'STAFF_PENDING')
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), id)
}

// ج) نشست دیروزِ باز: STALE با جزئیات، و فرم همان blockReason را می‌گوید
{
  const su = seed.user('کارمند دیروز')
  const id = seed.insert('Shift', { name: 'عصر', sessionSeq: 2, dayJalali: yesterday, userId: su, closedAt: null })
  const st = await shiftService.status()
  eq('ج) نشست جامانده ⇒ STALE', st.state, 'STALE')
  eq('ج) تاریخ جامانده = دیروز', st.stale?.dayJalali, yesterday)
  truthy('ج) برچسب نشست جامانده حاضر است', typeof st.stale?.sessionLabel === 'string' && st.stale.sessionLabel.length > 0)
  eq('ج) نام کارمند جامانده برمی‌گردد', st.stale?.userName, 'کارمند دیروز')
  const form = await shiftService.sessionForm()
  eq('ج) blockReason فرم: STALE_OPEN', form.blockReason, 'STALE_OPEN')
  truthy('ج) staleOpen فرم همان خلاصه‌ی status است', form.staleOpen?.id === id)
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now(), id)
}

// د) نشست امروز با کارمند: OK
{
  const su = seed.user('کارمند امروز')
  const id = seed.insert('Shift', { name: 'صبح', sessionSeq: 1, dayJalali: today, userId: su, closedAt: null })
  const st = await shiftService.status()
  eq('د) نشست فعال با کارمند ⇒ OK', st.state, 'OK')
  eq('د) شیفت برگشتی همان نشست است', st.shift?.id, id)
  const form = await shiftService.sessionForm()
  eq('د) blockReason فرم: NONE', form.blockReason, 'NONE')
}

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
