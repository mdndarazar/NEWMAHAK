/**
 * نشست ۲۱۲ — دو P0 پول:
 *   ۱) addPayment روی فاکتور لغو/باطل‌شده رد می‌شود و نقد صندوق زیاد نمی‌شود.
 *   ۲) کلید idempotency اعتبار روی فاکتور دیگر replay نمی‌شود.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s212-canceled-pay-and-credit-replay.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s212-p0-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
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
      console.log(`  ✗ ${label} — پیام «${m.split('\\n')[0]}» شامل «${needle}» نبود`)
    } else { ok++; console.log(`  ✓ ${label}`) }
  }
}

const addSrc = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const addStart = addSrc.indexOf('async addPayment(')
const addTx = addSrc.indexOf('prisma.$transaction', addStart)
const addBody = addSrc.slice(addStart, addTx + 1800)
const creditSrc = readFileSync(resolve(root, 'src/main/services/StoreCreditService.ts'), 'utf8')

console.log('\\n۰) سیم‌کشی')
truthy('addPayment وضعیت و voidedAt را می‌خواند', /status: true, voidedAt: true/.test(addBody))
truthy('addPayment فاکتور لغو را رد می‌کند', /پرداختی ثبت نمی‌شود/.test(addBody))
truthy('replay اعتبار فاکتور دیگر را رد می‌کند', /قبلاً برای فاکتور دیگری استفاده شده/.test(creditSrc))

const userId = seed.user('فروشنده ۲۱۲')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 50, salePrice = 1000 WHERE id = ?').run(v)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)

console.log('\\n۱) پرداخت روی فاکتور لغوشده')
const inv = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: []
})
eq('بدون پرداخت، نقد صندوق ۰ است', await exp(), 0)
sql.prepare(`UPDATE "SaleInvoice" SET status = 'CANCELED', voidedAt = ?, voidReason = 'x' WHERE id = ?`).run(Date.now(), inv.id)
await rejects(
  'addPayment روی فاکتور لغوشده رد می‌شود',
  () => salesService.addPayment({ invoiceId: inv.id, methodId: cash, amount: 1000, destination: 'CASH', userId }),
  'لغو'
)
eq('نقد صندوق بعد از تلاش همان ۰ است', await exp(), 0)
eq('هیچ پرداختی ثبت نشد', Number(sql.prepare('SELECT COUNT(*) AS n FROM "Payment" WHERE invoiceId = ?').get(inv.id)?.n ?? 0), 0)
await rejects(
  'saleUpdate روی فاکتور لغوشده پرداخت تازه نمی‌سازد',
  () => salesService.update({
    id: inv.id,
    userId,
    shiftId,
    keepPayments: false,
    lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
    payments: [{ methodId: cash, amount: 1000, destination: 'CASH' }]
  }),
  'لغوشده'
)
eq('saleUpdate هم هیچ پرداختی روی فاکتور لغوشده نساخت', Number(sql.prepare('SELECT COUNT(*) AS n FROM "Payment" WHERE invoiceId = ?').get(inv.id)?.n ?? 0), 0)
eq('نقد صندوق پس از saleUpdate لغوشده همان ۰ است', await exp(), 0)

console.log('\\n۲) کلید idempotency اعتبار بین دو فاکتور')
const issued = await storeCreditService.issueManual({ amount: 2000, userId, managerPassword: PW })
// پاسخ صدور عمومی امن است؛ credential فقط در fixture مستقیم خوانده می‌شود.
const code = issued?.id == null ? null : sql.prepare('SELECT code FROM "StoreCredit" WHERE id = ?').get(issued.id)?.code ?? null
truthy('اعتبار ۲۰۰۰ با DTO امن صادر شد', !!issued?.id && !('code' in issued) && !!code)
const KEY = 'replay-key-212'
const a = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [],
  storeCreditCode: code,
  storeCreditIdempotencyKey: KEY
})
const usedAfterA = Number(sql.prepare('SELECT usedAmount FROM "StoreCredit" WHERE code = ?').get(code)?.usedAmount ?? -1)
eq('فاکتور اول ۱۰۰۰ از اعتبار کم کرد', usedAfterA, 1000)
eq('فاکتور اول پرداخت اعتبار دارد', Number(sql.prepare('SELECT COUNT(*) AS n FROM "Payment" WHERE invoiceId = ? AND storeCreditId IS NOT NULL').get(a.id)?.n ?? 0), 1)

await rejects(
  'فاکتور دوم با همان کلید رد می‌شود',
  () => salesService.create({
    userId,
    shiftId,
    lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
    payments: [],
    storeCreditCode: code,
    storeCreditIdempotencyKey: KEY
  }),
  'فاکتور دیگری'
)
eq('اعتبار بعد از تلاش دوم همان ۱۰۰۰ مانده', Number(sql.prepare('SELECT usedAmount FROM "StoreCredit" WHERE code = ?').get(code)?.usedAmount ?? -1), 1000)
const sameKeyReplay = await salesService.create({
  userId,
  shiftId,
  lines: [{ variantId: v, qty: 1, unitPrice: 1000, discount: 0, tax: 0 }],
  payments: [],
  storeCreditCode: code,
  storeCreditIdempotencyKey: KEY,
  note: 'should-not-reach'
}).catch((e) => e)
truthy('فاکتور دوم ساخته نشد', !sameKeyReplay?.id)

console.log(`\\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
