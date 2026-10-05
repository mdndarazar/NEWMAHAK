/**
 * نشست ۲۱۴ · C2 — رقم رمز اولیه روی گیت صندوق‌دار نماند؛
 * changePassword دوباره ۱۱۱۱ را نمی‌پذیرد. قفل سراسری عملیات تا isDefault نزده.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s214-default-password.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s214-c2-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { authService } = await import('../../src/main/services/AuthService.ts')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)
const rejects = async (label, fn, needle) => {
  try {
    await fn()
    bad++
    console.log(`  ✗ ${label} — هیچ خطایی پرتاب نشد`)
  } catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) {
      bad++
      console.log(`  ✗ ${label} — پیام «${m.split('\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}

const gate = readFileSync(resolve(root, 'src/renderer/src/components/ManagerGate.tsx'), 'utf8')
const auth = readFileSync(resolve(root, 'src/main/services/AuthService.ts'), 'utf8')
const changeStart = auth.indexOf('async changePassword')
const changeBody = changeStart >= 0 ? auth.slice(changeStart, changeStart + 1800) : ''

console.log('\n۰) سیم‌کشی')
truthy('گیت رمز رقم ۱۱۱۱ ندارد', !gate.includes('۱۱۱۱') && !gate.includes('1111'))
truthy('گیت می‌گوید رمز هنوز عوض نشده', gate.includes('رمز مدیر هنوز عوض نشده'))
truthy('changePassword رمز اولیه را رد می‌کند', changeBody.includes('رمز اولیه دیگر قابل استفاده نیست'))
truthy('بعد از تغییر، isDefault همیشه false است', changeBody.includes('await save(build(next, false))'))
truthy('قفل سراسری isDefault روی فروش نیست', !/isDefault/.test(readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')))

const userId = seed.user('فروشنده رمز ۲۱۴')
const product = seed.product('کالا', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = 1000 WHERE id = ?').run(v)

console.log('\nC2) رمز اولیه و فروش با isDefault')
const info0 = await authService.info()
eq('اول کار isDefault است', info0.isDefault, true)
const sale = await salesService.create({
  userId, shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
})
eq('فروش با رمز اولیه قفل نشده', typeof sale?.id, 'number')

await rejects(
  'برگشت به رمز اولیه بعد از تغییر رد می‌شود — اول باید عوض شود',
  () => authService.changePassword({ current: PW, next: PW }),
  'یکی است'
)

await authService.changePassword({ current: PW, next: '2468' })
const info1 = await authService.info()
eq('بعد از تغییر isDefault خاموش است', info1.isDefault, false)

await rejects(
  'گذاشتن دوبارهٔ ۱۱۱۱ رد می‌شود',
  () => authService.changePassword({ current: '2468', next: PW }),
  'رمز اولیه'
)
const info2 = await authService.info()
eq('رد ۱۱۱۱ رمز را برنگرداند', info2.isDefault, false)
const vfy = await authService.verify({ password: '2468' })
eq('رمز تازه هنوز کار می‌کند', vfy.ok, true)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
