/**
 * نشست ۲۱۴ · C1 / M2 — ویرایش فاکتور گیت رمز پرداخت را دور نمی‌زند؛
 * کانال‌های رمز actor را از نشست می‌گیرند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s214-invoice-edit-payment-bypass.mjs
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s214-c1-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
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

const src = readFileSync(resolve(root, 'src/main/services/SalesService.ts'), 'utf8')
const cashbox = readFileSync(resolve(root, 'src/main/services/CashboxService.ts'), 'utf8')
const ipc = readFileSync(resolve(root, 'src/main/ipc/index.ts'), 'utf8')
const updStart = src.indexOf('async update(')
const updTx = src.indexOf('prisma.$transaction', updStart)
const preTx = updStart >= 0 && updTx > updStart ? src.slice(updStart, updTx) : ''
const lineOf = (n) => {
  const i = ipc.indexOf(`handle(IPC.${n}`)
  return i >= 0 ? ipc.slice(i, i + 220) : ''
}

console.log('\n۰) سیم‌کشی C1 / M2')
truthy('گیت بازنویسی پرداخت قبل از تراکنش است', preTx.includes('از پنجرهٔ «پرداختی‌ها» استفاده کنید'))
truthy('parser بستن صندوق آرایه را جمع می‌کند', cashbox.includes('amountOf') && cashbox.includes('Array.isArray(v)'))
for (const n of [
  'managerChangePassword',
  'managerPanelSetPassword',
  'managerPanelShiftSetPassword',
  'managerPanelReveal',
  'managerPanelLocksSet'
]) {
  truthy(`IPC.${n} ⇒ withOptionalSessionActor`, lineOf(n).includes('withOptionalSessionActor'))
}

const userId = seed.user('فروشنده ۲۱۴')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const cheque = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 3 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId })
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 1000000 WHERE id = ?').run(v)
const line = () => ({ variantId: v, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 })
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)
const liveAmt = (invoiceId) =>
  Number(sql.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL').get(invoiceId)?.s ?? 0)

console.log('\nC1) تبدیل نقد→کارت و خالی کردن پرداخت از ویرایش اقلام')
const inv = await salesService.create({
  userId, shiftId, lines: [line()],
  payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }]
})
eq('نقد بعد از فروش ۱٬۰۰۰٬۰۰۰', await exp(), 1_000_000)
await rejects(
  'saleUpdate نقد→کارت بدون رمز رد می‌شود',
  () => salesService.update({
    id: inv.id, userId, shiftId, lines: [line()],
    payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }]
  }),
  'پرداختی‌ها'
)
eq('نقد بعد از تلاش تبدیل همان ۱٬۰۰۰٬۰۰۰ است', await exp(), 1_000_000)
eq('پرداخت نقد زنده ماند', liveAmt(inv.id), 1_000_000)
await rejects(
  'saleUpdate با payments خالی رد می‌شود',
  () => salesService.update({ id: inv.id, userId, shiftId, lines: [line()], payments: [] }),
  'پرداختی‌ها'
)
eq('نقد بعد از تلاش خالی کردن همان ۱٬۰۰۰٬۰۰۰ است', await exp(), 1_000_000)

console.log('\nC1-keep) ویرایش اقلام با keepPayments پرداخت را لمس نمی‌کند')
await salesService.update({
  id: inv.id, userId, shiftId, lines: [line()], keepPayments: true, note: 'فقط توضیح ۲۱۴'
})
eq('بعد از keepPayments نقد همان است', await exp(), 1_000_000)
eq('پرداخت زنده دست‌نخورده', liveAmt(inv.id), 1_000_000)

console.log('\nC1-چک) چک پاس‌شده از ویرایش اقلام باطل نمی‌شود')
const inv2 = await salesService.create({
  userId, shiftId, lines: [line()],
  payments: [{ methodId: cash, amount: 100_000, destination: 'CASH' }]
})
const chq = await salesService.addPayment({
  invoiceId: inv2.id, userId, methodId: cheque, kind: 'CHEQUE', amount: 900_000,
  chequeNo: 'P214', bankName: 'تست', dueDateJalali: today
})
await salesService.setChequeStatus({
  id: chq.payment.id, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW
})
await rejects(
  'ابطال چک پاس‌شده از saleUpdate رد می‌شود',
  () => salesService.update({ id: inv2.id, userId, shiftId, lines: [line()], payments: [] }),
  'پرداختی‌ها'
)
eq('چک پاس‌شده باطل نشد', sql.prepare('SELECT voidedAt FROM "Payment" WHERE id = ?').get(chq.payment.id)?.voidedAt ?? null, null)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
