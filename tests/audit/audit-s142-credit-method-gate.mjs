/**
 * ممیزی نشست ۱۴۲ (S142) — روش پرداخت سیستمی اعتبار (STORE_CREDIT / EXCHANGE_CREDIT) فقط از مسیر دفتر اعتبار.
 *   • AUDIT-S142-01: assertPaymentMethodExists فقط وجود روش را می‌سنجید ⇒ addPayment با روش STORE_CREDIT
 *     بی‌کد اعتبار نسیه‌ی ۵۰۰٬۰۰۰ را تسویه می‌کرد (هیچ اعتبار مصرف نشد، هیچ نقد انتظار نرفت)؛ updatePayment
 *     پرداخت نقدی را به STORE_CREDIT/EXCHANGE_CREDIT می‌برد (نقد از انتظار کشو محو)، و ردیف EXCHANGE_CREDIT
 *     سند تعویض (بی storeCreditId، بیرون از گیت A88-02) با ویرایش مبلغ/روش به «نقد در کشو» تبدیل می‌شد.
 *   • AUDIT-S142-02: همان حفره در پرداخت اولیه‌ی فروش (initialPaymentRows): payments با روش STORE_CREDIT بی‌کد.
 * مسیر واقعی اعتبار (storeCreditCode) و پرداخت نقدی عادی باید سالم بمانند.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s142-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// مرز IPC فعلی فقط webContents واقعی را می‌پذیرد؛ sender ساختگیِ معتبر،
// آزمون قرارداد روش پرداخت را از گیت مالکیت پنجره عبور می‌دهد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 14201, isDestroyed: () => false, once: () => {} }
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db)
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const GATE = { managerPassword: PW, overrideReason: 'اصلاح تست ۱۴۲ روش' }
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e) } } }
// متن سیاست ممکن است راهنمای نسیه/تعویض هم داشته باشد؛ قرارداد امنیتی این است
// که اعتبار خرید فقط از مسیر کد اعتبار پنل فروش مصرف می‌شود.
const TARGET = /اعتبار خرید.*فقط با کد اعتبار.*پنل فروش/s
const EDIT_TARGET = /(مصرف اعتبار خرید|ارزش کالای برگشتی)[^]*قابل ویرایش نیست/
const errOf = (r) => (r && r.__error) || (r && r.ok === false ? String(r.error) : null)
const today = jalaliToday()
const A = seed.user('فروشنده ۱۴۲')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const sc = seed.insert('PaymentMethod', { key: 'STORE_CREDIT', label: 'اعتبار خرید', kind: 'STORE_CREDIT', isActive: 0, sortOrder: 8 })
const ex = seed.insert('PaymentMethod', { key: 'EXCHANGE_CREDIT', label: 'ارزش کالای برگشتی', kind: 'EXCHANGE_CREDIT', isActive: 0, sortOrder: 9 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A, staffConfirmed: 1 })
const product = seed.product('شلوار جین', seed.category('پوشاک'))
const mkVariant = (size, price) => { const id = seed.variant(product, size); db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 20, salePrice = ? WHERE id = ?').run(price, id); return id }
const v1 = mkVariant('30', 500_000), v2 = mkVariant('32', 500_000), vr = mkVariant('34', 500_000)
const line = (v) => ({ variantId: v, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 })
const invRow = (id) => seed.one('SELECT paidTotal, grandTotal FROM "SaleInvoice" WHERE id = ?', id)
const payCount = (id) => seed.count('Payment', 'invoiceId = ?', id)

console.log('\n— ۱) addPayment با روش STORE_CREDIT بی‌کد اعتبار (IPC)')
{
  const inv = await salesService.create({ userId: A, shiftId, lines: [line(v1)], payments: [] })
  const r = await safe(() => ipc(IPC.salePaymentAdd, { invoiceId: inv.id, amount: 500_000, methodId: sc, destination: 'MANAGER' }))
  eq('رد با پیام هدف', TARGET.test(errOf(r) ?? ''), true)
  eq('هیچ ردیف پرداختی ساخته نشد', payCount(inv.id), 0)
  eq('نسیه دست‌نخورده (paidTotal ۰)', Number(invRow(inv.id).paidTotal), 0)
  const r2 = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 500_000, methodId: sc, destination: 'CASH', userId: A }))
  eq('با مقصد CASH هم رد با پیام هدف', TARGET.test(errOf(r2) ?? ''), true)
  const r3 = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 300_000, methodId: ex, destination: 'MANAGER', userId: A }))
  eq('EXCHANGE_CREDIT هم رد با پیام هدف', TARGET.test(errOf(r3) ?? ''), true)
  eq('هنوز هیچ ردیف پرداختی', payCount(inv.id), 0)
  const okr = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 200_000, methodId: cash, destination: 'CASH', userId: A }))
  eq('کنترل: پرداخت نقدی ۲۰۰٬۰۰۰ پذیرفته', errOf(okr), null)
  eq('کنترل: paidTotal ۲۰۰٬۰۰۰', Number(invRow(inv.id).paidTotal), 200_000)
  const miss = await safe(() => salesService.addPayment({ invoiceId: inv.id, amount: 1, methodId: 99999, destination: 'CASH', userId: A }))
  eq('روش ناموجود همچنان «پیدا نشد»', /پیدا نشد/.test(errOf(miss) ?? ''), true)
}

console.log('\n— ۲) updatePayment نقدی ⇒ STORE_CREDIT / EXCHANGE_CREDIT')
{
  const inv = await salesService.create({ userId: A, shiftId, lines: [line(v1)], payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }] })
  const pay = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ?', inv.id).id
  const r = await safe(() => ipc(IPC.salePaymentUpdate, { id: pay, methodId: sc, destination: 'MANAGER', ...GATE }))
  eq('نقدی ⇒ STORE_CREDIT رد با پیام هدف', TARGET.test(errOf(r) ?? ''), true)
  const r2 = await safe(() => salesService.updatePayment({ id: pay, methodId: ex, userId: A, ...GATE }))
  eq('نقدی ⇒ EXCHANGE_CREDIT رد با پیام هدف', TARGET.test(errOf(r2) ?? ''), true)
  const row = seed.one('SELECT methodId, destination, amount FROM "Payment" WHERE id = ?', pay)
  eq('ردیف دست‌نخورده (روش نقدی، مقصد CASH، ۵۰۰٬۰۰۰)', [Number(row.methodId), row.destination, Number(row.amount)], [cash, 'CASH', 500_000])
  const okr = await safe(() => salesService.updatePayment({ id: pay, methodId: card, destination: 'CARD', userId: A, ...GATE }))
  eq('کنترل: نقدی ⇒ کارتخوان پذیرفته', errOf(okr), null)
}

console.log('\n— ۳) ردیف EXCHANGE_CREDIT سند تعویض (بی storeCreditId)')
{
  const src = await salesService.create({ userId: A, shiftId, lines: [line(v1), line(v2)], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
  const items = seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', src.id).map((r) => Number(r.id))
  const exr = await safe(() => salesService.createExchange({ invoiceId: src.id, lines: [{ saleItemId: items[0], qty: 1 }], replacements: [{ variantId: vr, qty: 1 }], userId: A, shiftId }))
  eq('تعویض هم‌ارزش ثبت شد', errOf(exr), null)
  const exInvId = Number(seed.one('SELECT exchangeInvoiceId FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', src.id)?.exchangeInvoiceId)
  const exPay = seed.one('SELECT p.id, p.amount, p.methodId, p.destination FROM "Payment" p WHERE p.invoiceId = ? AND p.methodId = ?', exInvId, ex)
  eq('ردیف ارزش کالای برگشتی ۵۰۰٬۰۰۰ روی سند تعویض', Number(exPay?.amount), 500_000)
  const r1 = await safe(() => ipc(IPC.salePaymentUpdate, { id: exPay.id, methodId: cash, destination: 'CASH', ...GATE }))
  eq('EXCHANGE_CREDIT ⇒ نقد در کشو رد', EDIT_TARGET.test(errOf(r1) ?? ''), true)
  const r2 = await safe(() => salesService.updatePayment({ id: exPay.id, amount: 900_000, userId: A, ...GATE }))
  eq('تغییر مبلغ EXCHANGE_CREDIT رد', EDIT_TARGET.test(errOf(r2) ?? ''), true)
  const r3 = await safe(() => salesService.updatePayment({ id: exPay.id, destination: 'CASH', userId: A, ...GATE }))
  eq('تغییر مقصد EXCHANGE_CREDIT به CASH رد', EDIT_TARGET.test(errOf(r3) ?? ''), true)
  const after = seed.one('SELECT amount, methodId, destination FROM "Payment" WHERE id = ?', exPay.id)
  eq('ردیف تعویض دست‌نخورده', [Number(after.amount), Number(after.methodId), after.destination ?? null], [500_000, ex, exPay.destination ?? null])
  const note = await safe(() => salesService.updatePayment({ id: exPay.id, note: 'یادداشت', userId: A }))
  eq('کنترل: فقط یادداشت مجاز', errOf(note), null)

  console.log('\n— ۳ب) ابطال جدای ردیف EXCHANGE_CREDIT (AUDIT-S142-03)')
  const d = await safe(() => ipc(IPC.salePaymentDelete, { id: exPay.id, reason: 'تست', ...GATE }))
  eq('ابطال جدا رد با پیام «سند تعویض را ابطال کنید»', /ارزش کالای برگشتی سند تعویض است و جدا باطل نمی‌شود/.test(errOf(d) ?? ''), true)
  eq('ردیف باطل نشد', seed.one('SELECT voidedAt FROM "Payment" WHERE id = ?', exPay.id).voidedAt ?? null, null)
  eq('سند تعویض بدهکار نشد (paidTotal ۵۰۰٬۰۰۰)', Number(invRow(exInvId).paidTotal), 500_000)
  const retId = Number(seed.one('SELECT id FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', src.id).id)
  const rd = await safe(() => salesService.returnDelete({
    id: retId,
    userId: A,
    reason: 'اشتباه در تعویض',
    panelPassword: PW
  }))
  eq('مسیر درست: ابطال سند تعویض پذیرفته', errOf(rd), null)
  eq('سند تعویض با ابطال گراف لغو شد (CANCELED + voidedAt)', (() => { const r = seed.one('SELECT status, voidedAt FROM "SaleInvoice" WHERE id = ?', exInvId); return [r.status, r.voidedAt != null] })(), ['CANCELED', true])
  const cashPay = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ? AND methodId = ?', src.id, cash).id
  const del2 = await safe(() => salesService.deletePayment({ id: cashPay, userId: A, reason: 'کنترل', ...GATE }))
  eq('کنترل: ابطال پرداخت نقدی عادی مجاز', errOf(del2), null)
}

console.log('\n— ۴) پرداخت اولیه‌ی فروش با روش STORE_CREDIT بی‌کد (AUDIT-S142-02)')
{
  const before = seed.count('SaleInvoice', '1 = 1')
  const r = await safe(() => ipc(IPC.saleCreate, { shiftId, lines: [line(v1)], payments: [{ methodId: sc, amount: 500_000, destination: 'MANAGER' }] }))
  eq('فروش با روش STORE_CREDIT بی‌کد رد با پیام هدف', TARGET.test(errOf(r) ?? ''), true)
  const r2 = await safe(() => salesService.create({ userId: A, shiftId, lines: [line(v1)], payments: [{ methodId: ex, amount: 500_000 }] }))
  eq('فروش با روش EXCHANGE_CREDIT رد با پیام هدف', TARGET.test(errOf(r2) ?? ''), true)
  eq('هیچ فاکتوری ساخته نشد', seed.count('SaleInvoice', '1 = 1'), before)
}

console.log('\n— ۵) مسیر واقعی اعتبار خرید سالم')
{
  seed.insert('StoreCredit', { code: 'SC142', amount: 300_000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now() - 60_000 })
  const r = await safe(() => salesService.create({ userId: A, shiftId, lines: [line(v2)], payments: [{ methodId: cash, amount: 200_000, destination: 'CASH' }], storeCreditCode: 'SC142' }))
  eq('فروش با کد اعتبار ثبت شد', errOf(r), null)
  const invId = r?.id ?? r?.invoice?.id
  const scRow = seed.one('SELECT amount, storeCreditId FROM "Payment" WHERE invoiceId = ? AND methodId = ?', invId, sc)
  eq('ردیف مصرف اعتبار ۳۰۰٬۰۰۰ با storeCreditId', [Number(scRow?.amount), scRow?.storeCreditId != null], [300_000, true])
  eq('paidTotal = ۵۰۰٬۰۰۰', Number(invRow(invId)?.paidTotal), 500_000)
}

console.log('\n— ۶) صدور اعتبار اضافه‌دریافت: سقف available و «خالی = کل»')
{
  const inv = await salesService.create({ userId: A, shiftId, lines: [line(v1)], payments: [] })
  await salesService.addPayment({ invoiceId: inv.id, amount: 700_000, methodId: cash, destination: 'CASH', userId: A, confirmOverpay: true })
  const over = await safe(() => ipc(IPC.saleOverpayCredit, { invoiceId: inv.id, amount: 200_001 }))
  eq('۲۰۰٬۰۰۱ بیش از آزاد ۲۰۰٬۰۰۰ رد با پیام سقف', /اضافه‌دریافتِ آزاد فاکتور .* ۲۰۰٬۰۰۰ ریال است/.test(errOf(over) ?? ''), true)
  eq('هیچ اعتباری صادر نشد', seed.count('StoreCredit', 'sourceInvoiceId = ?', inv.id), 0)
  const part = await safe(() => salesService.overpayCreditIssue({ invoiceId: inv.id, amount: 50_000, userId: A }))
  eq('۵۰٬۰۰۰ صادر و آزاد باقی ۱۵۰٬۰۰۰', [errOf(part), part?.available], [null, 150_000])
  const full = await safe(() => salesService.overpayCreditIssue({ invoiceId: inv.id, amount: '  ', userId: A }))
  eq('مبلغ خالی = کل آزاد ۱۵۰٬۰۰۰', [errOf(full), full?.amount, full?.available], [null, 150_000, 0])
  const again = await safe(() => salesService.overpayCreditIssue({ invoiceId: inv.id, amount: '', userId: A }))
  eq('بعد از صدور کامل، خالی رد «آزاد ندارد»', /مبلغ اضافه‌ی دریافتیِ آزاد ندارد/.test(errOf(again) ?? ''), true)
  eq('جمع اعتبار صادرشده = ۲۰۰٬۰۰۰', Number(seed.one('SELECT SUM(amount) s FROM "StoreCredit" WHERE sourceInvoiceId = ?', inv.id).s), 200_000)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
