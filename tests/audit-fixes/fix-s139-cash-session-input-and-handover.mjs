/**
 * نشست ۱۳۹ · خوشه E
 *
 * ورودی‌های عددی صندوق و نشست نباید با Math.round/Math.abs به عدد دیگری
 * تبدیل شوند؛ این مسیرها مستقیماً expectedCash و سابقه‌ی تحویل صندوق را عوض
 * می‌کنند. همچنین اختلاف شمارشِ نشست قبلی و موجودی اول نشست بعدی باید هشدار
 * قابل‌ردیابی بسازد، نه این‌که بی‌صدا گم شود.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s139-cash-session-input-and-handover.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const shiftSource = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
const cashboxSource = readFileSync(resolve('src/main/services/CashboxService.ts'), 'utf8')
const movementSource = readFileSync(resolve('src/main/services/CashMovementService.ts'), 'utf8')
const ipcSource = readFileSync(resolve('src/main/ipc/index.ts'), 'utf8')
const uiSource = readFileSync(resolve('src/renderer/src/pages/CashClose.tsx'), 'utf8')
 
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
const rejectsWith = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} · ورودی نامعتبر پذیرفته شد`)
  } catch (error) {
    const message = String(error?.message ?? error)
    eq(label, message.includes(needle), true)
  }
}

eq('باز کردن نشست شناسه اعشاری را گرد نمی‌کند', !/Math\.round\(Number\(input\.staffId/.test(shiftSource), true)
eq('بستن صندوق validator عدد صحیح غیرمنفی دارد', /assertNonNegativeSafeInteger/.test(cashboxSource), true)
eq('گردش نقدی مبلغ منفی را با abs مثبت نمی‌کند', !/Math\.abs\(Math\.round\(Number\(input\.amount\)/.test(movementSource), true)
// هندلر بستن صندوق از نشست ۱۸۲ چندخطی شده تا مسیر قدیمیِ custody را نیز
// ببندد؛ actor همچنان فقط با withSessionActor ساخته می‌شود.
const cashCloseBlock = ipcSource.slice(
  ipcSource.indexOf('handle(IPC.cashClose'),
  ipcSource.indexOf('handle(IPC.cashSessions')
)
eq('بستن صندوق actor را از نشست می‌گیرد', /cashboxService\.close\(await withSessionActor\(p \?\? \{\}, 'بستن صندوق'\)\)/.test(cashCloseBlock), true)
eq('بستن صندوق مسیر قدیمی custody را دور نمی‌زند', /custodyService\.guardLegacyPath\(\)/.test(cashCloseBlock), true)
/**
 * به‌روزرسانی نشست ۱۸۲ — مقصود همان است، فقط شکل هندلر عوض شده.
 *
 * از نشست ۱۸۲ این کانال قبل از صدا زدن سرویس، گیت قفل صفحه‌ی بستن صندوق را
 * می‌سنجد (بند ۴-۴۱)، پس دیگر یک‌خطی نیست. قرارداد اصلی — «actor از نشستِ
 * باز می‌آید، نه از payload» — دست‌نخورده است و این بررسی حالا **سخت‌گیرتر**
 * شده: هم وجود `withSessionActor` را می‌خواهد و هم اطمینان می‌دهد که
 * `userId` ارسالیِ بیرون مستقیم به سرویس نمی‌رسد.
 */
{
  const block = ipcSource.slice(
    ipcSource.indexOf('handle(IPC.cashboxMovementAdd'),
    ipcSource.indexOf('handle(IPC.cashboxMovementList')
  )
  eq('واریز/برداشت actor را از نشست می‌گیرد', /cashMovementService\.add\(await withSessionActor\(/.test(block), true)
  eq('و userId ارسالی بیرون مستقیم پاس داده نمی‌شود', !/userId: p\??\.userId/.test(block), true)
  eq('برداشت قبل از ثبت، قفل بستن صندوق را می‌سنجد (بند ۴-۴۱)', /assertPanelUnlocked\(/.test(block), true)
}
eq('هشدار تحویل در UI نمایش داده می‌شود', /expected\?\.warnings|handoverWarning|اختلاف شمارش نقد/.test(uiSource), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s139-cash-session-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
const { CashMovementType } = await import('@shared/enums')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const staffA = seed.user('کارمند اعتبارسنجی صندوق')
const staffB = seed.user('کارمند دوم اعتبارسنجی صندوق')
const today = toJalaliDate(new Date())

const beforeInvalidOpen = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n)
await rejectsWith(
  'شناسه اعشاری کارمند در openSession رد می‌شود',
  () =>
    shiftService.openSession({
      staffId: Number(staffB) - 0.5,
      userId: staffA,
      name: 'صبح',
      idempotencyKey: 's139-invalid-staff'
    }),
  'عدد صحیح'
)
eq('openSession نامعتبر نشست تازه نساخت', beforeInvalidOpen(), 0)
 
const shiftId = seed.insert('Shift', {
  name: 'صبح',
  number: 1,
  dayJalali: today,
  openedAt: Date.now(),
  userId: staffA,
  staffConfirmed: 1
})

const beforeMovements = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "CashMovement"').get().n)
await rejectsWith(
  'واریز اعشاری در مسیر main رد می‌شود',
  () =>
    cashMovementService.add({
      shiftId,
      userId: staffA,
      type: CashMovementType.DEPOSIT,
      amount: 1.5
    }),
  'عدد صحیح'
)
await rejectsWith(
  'برداشت منفی در مسیر main رد می‌شود',
  () =>
    cashMovementService.add({
      shiftId,
      userId: staffA,
      type: CashMovementType.WITHDRAWAL,
      amount: -100
    }),
  'بزرگ‌تر از صفر'
)
await rejectsWith(
  'واریز NaN در مسیر main رد می‌شود',
  () =>
    cashMovementService.add({
      shiftId,
      userId: staffA,
      type: CashMovementType.DEPOSIT,
      amount: Number.NaN
    }),
  'عدد صحیح'
)
eq('ورودی‌های گردش نقدی نامعتبر هیچ ردیف مالی نساختند', beforeMovements(), 0)

const beforeCashSessions = () => Number(sql.prepare('SELECT COUNT(*) AS n FROM "CashSession"').get().n)
await rejectsWith(
  'شمارش اعشاری صندوق در close رد می‌شود',
  () =>
    cashboxService.close({
      shiftId,
      explicitShift: true,
      userId: staffA,
      countedCash: 1.5,
      note: 'تست اعتبارسنجی',
      closeShift: false
    }),
  'عدد صحیح'
)
await rejectsWith(
  'موجودی اول منفی در close رد می‌شود',
  () =>
    cashboxService.close({
      shiftId,
      explicitShift: true,
      userId: staffA,
      openingFloat: -500,
      note: 'تست اعتبارسنجی',
      closeShift: false
    }),
  'غیرمنفی'
)
eq('close نامعتبر snapshot صندوق نساخت', beforeCashSessions(), 0)
await rejectsWith(
  'شمارش اعشاری در expected هم رد می‌شود',
  () => cashboxService.expected({ shiftId, countedCash: 2.25 }),
  'عدد صحیح'
)
 
const previousShift = seed.insert('Shift', {
  name: 'شب',
  number: 1,
  dayJalali: today,
  openedAt: Date.now() - 3_600_000,
  closedAt: Date.now() - 1_800_000,
  userId: staffA,
  staffConfirmed: 1
})
sql.prepare(`
  INSERT INTO "CashSession"
    (shiftId, fromDate, toDate, dayJalali, countedTotal, expectedCash, cashDifference, reportVersion, closedAt)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  previousShift,
  // ممیزی S139 (AUDIT-D69): قرارداد ذخیره‌ی تاریخ هارنس میلی‌ثانیه است (مثل seed.insert)، نه متن ISO
  Date.now() - 3_600_000,
  Date.now() - 1_800_000,
  today,
  1000,
  1000,
  0,
  'session14',
  Date.now() - 1_800_000
)

const handover = await cashboxService.expected({ shiftId, openingFloat: 700 })
eq(
  'اختلاف شمارش نشست قبلی و موجودی اول هشدار می‌دهد',
  (handover.warnings ?? []).some((w) => String(w).includes('اختلاف شمارش نقد')),
  true
)
eq(
  'هشدار تحویل هر دو مبلغ را نگه می‌دارد',
  (handover.warnings ?? []).some((w) => String(w).includes('۱٬۰۰۰') && String(w).includes('۷۰۰')),
  true
)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
