/**
 * ممیزی نشست ۱۴۲ (دور دوم، AUDIT-S142-04) — روش سیستمی «چک» (key=CHEQUE، kind=CUSTOM) از مسیر پرداخت عمومی.
 *   S142 گیت «روش باید وجود داشته باشد» را برای addPayment/updatePayment گذاشت و ممیزی قبلی STORE_CREDIT/
 *   EXCHANGE_CREDIT را هم بست؛ ولی روش سیستمی چک هنوز با kind≠CHEQUE پذیرفته می‌شد. چون kind آن CUSTOM است،
 *   allowedDestinationsFor همه‌ی مقصدها (حتی CASH کشو و CARD) را مجاز می‌داند ⇒ «چک» بی‌سررسید/بی‌چرخه‌ی پاس
 *   با مقصد نقد کشو (خلاف بند ۴-۱۲)، یا پرداخت نقدی ۵۰۰٬۰۰۰ با ویرایش به «چک · حساب مدیر» از نقد مورد انتظار
 *   کشو محو می‌شد و در گزارش مثل چکِ واریزشده به بانک دیده می‌شد. initialPaymentRows همین روش را از قبل رد می‌کرد.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s142b-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// IPCهای Main-first فقط sender واقعی را می‌پذیرند؛ mock معتبر، آزمون گیت چک
// را از کنترل مستقل مالکیت پنجره عبور می‌دهد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 14202, isDestroyed: () => false, once: () => {} }
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db)
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست ۱۴۲ب چک' }
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e) } } }
const errOf = (r) => (r && r.__error) || (r && r.ok === false ? String(r.error) : null)
const TARGET = /چک فقط از فرم «ثبت چک»/
const today = jalaliToday()
const A = seed.user('فروشنده ۱۴۲ب')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const c2c = seed.insert('PaymentMethod', { key: 'C2C', label: 'کارت‌به‌کارت', kind: 'CUSTOM', isActive: 1, sortOrder: 3 })
const chq = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 0, sortOrder: 90 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A, staffConfirmed: 1 })
const product = seed.product('شلوار جین', seed.category('پوشاک'))
const v1 = seed.variant(product, '30')
db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = 500000 WHERE id = ?').run(v1)
const line = { variantId: v1, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }
const invRow = (id) => seed.one('SELECT paidTotal FROM "SaleInvoice" WHERE id = ?', id)
const payCount = (id) => seed.count('Payment', 'invoiceId = ?', id)

console.log('\n— ۱) addPayment غیرچک با روش سیستمی چک')
{
  const inv = await salesService.create({ userId: A, shiftId, lines: [line], payments: [] })
  const r = await safe(() => ipc(IPC.salePaymentAdd, { invoiceId: inv.id, amount: 500_000, methodId: chq, destination: 'CASH' }))
  eq('روش چک با مقصد نقد کشو رد شد', TARGET.test(errOf(r) ?? ''), true)
  const r2 = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 500_000, methodId: chq, destination: 'MANAGER', userId: A }))
  eq('روش چک با مقصد حساب مدیر (بی‌سررسید) رد شد', TARGET.test(errOf(r2) ?? ''), true)
  eq('هیچ ردیف پرداختی ساخته نشد', payCount(inv.id), 0)
  eq('نسیه دست‌نخورده', Number(invRow(inv.id).paidTotal), 0)
  const real = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 300_000, kind: 'CHEQUE', dueDateJalali: today, chequeNo: '1', userId: A }))
  eq('کنترل: چک واقعی از فرم چک پذیرفته', errOf(real), null)
  eq('کنترل: ردیف چک kind=CHEQUE ساخته شد', seed.one('SELECT kind FROM "Payment" WHERE invoiceId = ?', inv.id)?.kind, 'CHEQUE')
  const c = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 100_000, methodId: c2c, destination: 'MANAGER', userId: A }))
  eq('کنترل: کارت‌به‌کارت به حساب مدیر پذیرفته', errOf(c), null)
}

console.log('\n— ۲) updatePayment نقدی ⇒ روش چک')
{
  const inv = await salesService.create({ userId: A, shiftId, lines: [line], payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }] })
  const pay = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', inv.id).id
  const r = await safe(() => ipc(IPC.salePaymentUpdate, { id: pay, methodId: chq, destination: 'MANAGER', ...GATE }))
  eq('نقدی ⇒ «چک · حساب مدیر» رد شد', TARGET.test(errOf(r) ?? ''), true)
  const row = seed.one('SELECT methodId, destination, amount FROM "Payment" WHERE id = ?', pay)
  eq('ردیف دست‌نخورده (نقدی، CASH، ۵۰۰٬۰۰۰)', [Number(row.methodId), row.destination, Number(row.amount)], [cash, 'CASH', 500_000])
  const okr = await safe(() => salesService.updatePayment({ id: pay, note: 'یادداشت', userId: A }))
  eq('کنترل: ویرایش یادداشت مجاز', errOf(okr), null)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
