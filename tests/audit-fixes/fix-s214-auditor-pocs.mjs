/**
 * نشست ۲۱۴ — همان PoCهای ممیز از مسیر IPC (C1) و جعل actor (M2).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s214-auditor-pocs.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s214-poc-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// مسیر IPC جدید، مالکیت پنجره را پیش از هر PoC بررسی می‌کند؛ sender معتبرِ
// ساختگی، آزمون قراردادهای مالی را از این مرز مستقل عبور می‌دهد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 21401, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate } = await import('@shared/jalali')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')

registerIpcHandlers()
const ipc = (ch, p) => handlers.get(ch)({ sender }, p)

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, cond) => eq(label, !!cond, true)

const userId = seed.user('فروشنده')
const product = seed.product('شلوار', seed.category('پوشاک'))
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', {
  name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1
})
const v = seed.variant(product, 'L')
sql.prepare('UPDATE "ProductVariant" SET stock = 100, salePrice = 1000000 WHERE id = ?').run(v)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)
const line = { variantId: v, qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }

console.log('\nC1 · IPC) نقد→کارت و خالی کردن پرداخت از saleUpdate')
const r1 = await ipc(IPC.saleCreate, { lines: [line], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
eq('ثبت فروش نقد از IPC', r1.ok, true)
const inv = r1.data
eq('نقد بعد از فروش ۱٬۰۰۰٬۰۰۰', await exp(), 1_000_000)

const r2 = await ipc(IPC.saleUpdate, {
  id: inv.id, lines: [line], payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }]
})
eq('IPC نقد→کارت بدون رمز رد شد', r2.ok, false)
truthy('پیام به پنجرهٔ پرداختی‌ها اشاره دارد', String(r2.error ?? '').includes('پرداختی‌ها'))
eq('نقد بعد از تلاش تبدیل همان است', await exp(), 1_000_000)

const r3 = await ipc(IPC.saleCreate, { lines: [line], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
const r4 = await ipc(IPC.saleUpdate, { id: r3.data.id, lines: [line], payments: [] })
eq('IPC خالی کردن پرداخت رد شد', r4.ok, false)
truthy('خالی کردن هم به پرداختی‌ها اشاره دارد', String(r4.error ?? '').includes('پرداختی‌ها'))
eq('نقد بعد از تلاش نسیه همان ۲٬۰۰۰٬۰۰۰ است', await exp(), 2_000_000)

console.log('\nC1-چک · IPC) ابطال چک پاس‌شده از ویرایش فاکتور')
const r5 = await ipc(IPC.saleCreate, { lines: [line], payments: [] })
eq('فاکتور نسیه برای چک', r5.ok, true)
const ip = await ipc(IPC.salePaymentAdd, {
  invoiceId: r5.data.id, kind: 'CHEQUE', amount: 1_000_000, chequeNo: 'C1', bankName: 'ملی', dueDateJalali: today
})
eq('ثبت چک', ip.ok, true)
const chq = seed.one(`SELECT id FROM "Payment" WHERE invoiceId = ? AND kind = 'CHEQUE'`, r5.data.id)
const cl = await ipc(IPC.saleChequeStatus, { id: chq.id, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW })
eq('پاس چک با رمز', cl.ok, true)
const del = await ipc(IPC.salePaymentDelete, { id: chq.id, reason: 'تست' })
eq('ابطال مستقیم چک پاس‌شده بدون رمز رد شد', del.ok, false)
const r6 = await ipc(IPC.saleUpdate, { id: r5.data.id, lines: [line], payments: [] })
eq('ویرایش فاکتور چک پاس‌شده را پاک نکرد', r6.ok, false)
eq('چک پاس‌شده باطل نشد', seed.one('SELECT voidedAt FROM "Payment" WHERE id = ?', chq.id)?.voidedAt ?? null, null)

console.log('\nC1-بستن) بعد از بستن صندوق هم بازنویسی پرداخت رد است')
const r7 = await ipc(IPC.saleCreate, { lines: [line], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
const counted = await exp()
const cc = await ipc(IPC.cashClose, { shiftId, explicitShift: true, countedCash: counted, closeShift: false, note: 'بستن' })
eq('بستن صندوق', cc.ok, true)
const r8 = await ipc(IPC.saleUpdate, {
  id: r7.data.id, lines: [line], payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }]
})
eq('ویرایش بعد از بستن صندوق بدون رمز رد شد', r8.ok, false)
truthy(
  'بدون رمز، قفل دوره یا گیت پرداخت جلو را می‌گیرد',
  String(r8.error ?? '').includes('دوره') || String(r8.error ?? '').includes('پرداختی‌ها')
)
const r8b = await ipc(IPC.saleUpdate, {
  id: r7.data.id, lines: [line],
  payments: [{ methodId: card, amount: 1_000_000, destination: 'CARD' }],
  managerPassword: PW, overrideReason: 'اصلاح بعد از بستن صندوق'
})
eq('با رمز دوره هم بازنویسی پرداخت رد است', r8b.ok, false)
truthy('با رمز دوره پیام پرداختی‌هاست', String(r8b.error ?? '').includes('پرداختی‌ها'))

console.log('\nM2 · IPC) userId جعلی روی رمز دوم پنل')
const forged = seed.user('جعلی')
const vfy = await ipc(IPC.managerVerify, { password: PW })
eq('ورود مدیر', vfy.ok, true)
const setPw = await ipc(IPC.managerPanelSetPassword, {
  panel: 'products', managerPassword: PW, password: 'abcd', userId: forged
})
eq('تعریف رمز دوم پذیرفته شد', setPw.ok, true)
const aud = seed.rows('SELECT action, userId, note FROM "AuditLog" WHERE note LIKE ? ORDER BY id DESC LIMIT 5', '%رمز%')
const forgedOnPwd = aud.some((a) => Number(a.userId) === Number(forged))
eq('Audit رمز دوم userId جعلی ندارد', forgedOnPwd, false)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
