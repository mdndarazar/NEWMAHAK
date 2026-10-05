/**
 * ممیزی A92-01 — نشست ۹۲ قید تاریخ را کنار shiftId هم‌زمان کرد؛ ولی پیش‌نمایش بستن صندوق
 * (CashboxService.expected) و فهرست گردش (CashMovementService.list) وقتی فقط shiftId دارند
 * بازه‌ی پیش‌فرض «امروز» را می‌سازند ⇒ برای شیفت شب عبوری از نیمه‌شب (بند ۴-۱۴) موجودی اول
 * (ثبت‌شده در openedAt دیروز) و برداشت ساعت ۲۳ دیروز از پیش‌نمایش حذف می‌شد، در حالی که
 * close() با openedAt..closedAt حساب می‌کند ⇒ عدد پیش‌نمایش ≠ عدد ثبت نهایی.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a9201-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { cashMovementService } = await import('../../src/main/services/CashMovementService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const todayStart = jalaliStartOfDay(jalaliToday()).getTime()
const opened = todayStart - 4 * 3600_000       // ۲۰:۰۰ دیروز
const A = seed.user('فروشنده شب')
const shift = seed.insert('Shift', { name: 'شب', number: 2, dayJalali: toJalaliDate(new Date(opened)), openedAt: opened, userId: A })
const mv = (type, amount, at) => seed.insert('CashMovement', { type, amount, occurredAt: at, occurredAtJalali: toJalaliDate(new Date(at)), shiftId: shift, userId: A })
mv('OPENING_FLOAT', 500_000, opened)
mv('WITHDRAWAL', 200_000, todayStart - 3600_000)   // ۲۳:۰۰ دیروز
mv('DEPOSIT', 50_000, todayStart + 60_000)         // ۰۰:۰۱ امروز
const exp = await cashboxService.expected({ shiftId: shift })
eq('پیش‌نمایش بستن شیفت شب: موجودی اول ۵۰۰٬۰۰۰ (ثبت‌شده ساعت ۲۰ دیروز)', exp?.components?.openingFloat ?? exp?.openingFloat, 500_000)
eq('پیش‌نمایش: برداشت ۲۰۰٬۰۰۰ ساعت ۲۳ دیروز شمرده می‌شود', exp?.components?.withdrawals, 200_000)
eq('پیش‌نمایش: واریز ۵۰٬۰۰۰ بعد از نیمه‌شب', exp?.components?.deposits, 50_000)
eq('فهرست گردش پیش‌نمایش: هر سه ردیف شیفت', (exp?.movements ?? []).length, 3)
const list = await cashMovementService.list({ shiftId: shift })
eq('cashboxMovementList({shiftId}) بدون تاریخ: کل گردش همان نشست (۳ ردیف)', list?.rows?.length, 3)
const listDay = await cashMovementService.list({ shiftId: shift, fromJalali: jalaliToday(), toJalali: jalaliToday() })
eq('با شیفت + تاریخ صریح امروز: هر دو قید (S92) ⇒ فقط واریز بعد از نیمه‌شب', listDay?.rows?.length, 1)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
