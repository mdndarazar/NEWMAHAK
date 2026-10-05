/**
 * نشست ۸۰ · خوشه A
 *
 * تکرار همان درخواست بازکردن نشست بعد از timeout نباید صندوق را دوباره
 * ببندد و نشست دوم بسازد. کلید idempotency باید همان نشستِ ساخته‌شده را
 * برگرداند؛ استفاده‌ی همان کلید با ورودی متفاوت هم باید رد شود.
 *
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-s80-open-session-idempotency.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const source = readFileSync(resolve('src/main/services/ShiftService.ts'), 'utf8')
const uiSource = readFileSync(resolve('src/renderer/src/components/ShiftSessionModal.tsx'), 'utf8')
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

eq('قرارداد openSession کلید idempotency را می‌پذیرد', /idempotencyKey/.test(source), true)
eq('کلید در مدل نشست ذخیره و یکتا می‌شود', /openIdempotencyKey/.test(readFileSync(resolve('prisma/schema.prisma'), 'utf8')), true)
eq('فرم بازکردن نشست کلید retry را به main می‌فرستد', /idempotencyKey:\s*openRequestKey\.current/.test(uiSource), true)

process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s80-open-session-idempotency-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { shiftService } = await import('../../src/main/services/ShiftService.ts')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const staff = seed.user('کارمند idempotency')
const otherStaff = seed.user('کارمند دیگر idempotency')
const input = {
  staffId: staff,
  userId: staff,
  name: 'صبح',
  idempotencyKey: 's80-open-0001',
  note: 'درخواست تست قابل تکرار'
}

const first = await shiftService.openSession(input)
const second = await shiftService.openSession(input)
eq('اولین درخواست نشست می‌سازد', Number.isInteger(first?.id), true)
eq('تکرار همان کلید همان نشست را برمی‌گرداند', second?.id, first?.id)
eq('تکرار همان کلید نشست تازه نمی‌سازد', sql.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n, 1)
eq('نشست idempotent با کلید ثبت شده است', sql.prepare('SELECT openIdempotencyKey FROM "Shift" WHERE id = ?').get(first?.id)?.openIdempotencyKey, input.idempotencyKey)

let mismatchRejected = false
try {
  await shiftService.openSession({ ...input, staffId: otherStaff, idempotencyKey: input.idempotencyKey })
} catch (error) {
  mismatchRejected = /کلید|درخواست|متفاوت/.test(String(error?.message ?? error))
}
eq('استفاده‌ی همان کلید با ورودی متفاوت رد می‌شود', mismatchRejected, true)
eq('رد ورودی متفاوت نشست تازه نمی‌سازد', sql.prepare('SELECT COUNT(*) AS n FROM "Shift"').get().n, 1)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
