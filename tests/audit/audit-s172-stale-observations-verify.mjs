/**
 * نشست ۱۷۲ — تأیید رفتاری سه «مشاهده‌ی باز» کهنه‌ی AUDIT-PROGRESS (بدون تغییر src).
 *   ۱) نشست ۱۴۰: saleReturn/saleReturnUpdate/saleReturnDelete/saleExchangeCreate در IPC با withUser
 *      userId renderer را می‌پذیرفتند ⇒ در S141-02 (AUDIT-D72) با withSessionActor بسته شد.
 *   ۲) نشست ۱۴۱: سیاست تخفیف (preverifySalePolicy، بند ۴-۲۶) روی اقلام جایگزین تعویض اعمال نمی‌شد
 *      ⇒ Y14 (نشست ۱۵۸، S157-D5..D9) بسته شد.
 *   ۳) نشست ۱۴۲: allowedDestinationsFor(CASH) مقصد MANAGER را مجاز می‌دانست (خلاف بند ۴-۱۳)
 *      ⇒ Y15 (نشست ۱۵۸، S158-D5) بسته شد.
 * هر سه از مسیر IPC واقعی (نه فقط سرویس) آزموده می‌شوند.
 *     node --import ./test/harness/register.mjs tests/audit/audit-s172-stale-observations-verify.mjs
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s172-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// IPC production مسیر هر عملیات مالی را به پنجرهٔ زنده گره می‌زند. sender معتبر
// ساختگی فقط از مرز پنجره عبور می‌کند تا خودِ سیاست‌های actor/return آزموده شوند.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 17201, isDestroyed: () => false, once: () => {} }
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db)
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { allowedDestinationsFor } = await import(join(root, 'src/shared/enums.ts'))
const { SETTING_KEYS, DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)
const today = jalaliToday()
const A = seed.user('فروشنده ۱۷۲')
const forged = seed.user('همکار جعلی ۱۷۲')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const product = seed.product('شلوار ۱۷۲', seed.category('پوشاک ۱۷۲'))
const mkV = (code, price) => seed.insert('ProductVariant', { productId: product, code, barcode: 'B' + code, salePrice: price, stock: 50 })
const v1 = mkV('S172A', 1_000_000), vr = mkV('S172R', 1_000_000)
const line = () => ({ variantId: v1, code: 'S172A', barcode: 'BS172A', name: 'شلوار ۱۷۲', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 })
const itemsOf = (id) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id).map((r) => Number(r.id))
const counts = () => JSON.stringify([seed.count('SaleReturn'), seed.count('SaleInvoice'), seed.count('StoreCredit'), seed.count('Payment')])
seed.setting(SETTING_KEYS.discountPolicy, { mode: 'FREE', fixedMode: 'PERCENT', fixedValue: 0, allowLine: true, allowInvoice: true, maxPercent: 10, maxAmount: 0 })

console.log('\n— ۱) نشست ۱۴۰: actor برگشت از نشست باز، نه userId renderer')
{
  const r0 = await ipc(IPC.saleReturn, { invoiceId: 1, full: true, refundMethod: 'NONE', userId: forged })
  eq('بی‌نشست باز: برگشت IPC با پیام فارسی «نشست باز» رد', r0?.ok === false && /نشست بازِ کارمند/.test(String(r0?.error)), true)
}
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId: A, staffConfirmed: 1 })
{
  const s = await salesService.create({ userId: A, shiftId, lines: [line()], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
  // برگشتِ فاکتور کاملاً پرداخت‌شده، اضافه‌دریافت ایجاد می‌کند؛ این تأیید
  // آگاهانه، آزمون را از گیت مالی می‌گذراند تا مالکیت actor سنجیده شود.
  const r = await ipc(IPC.saleReturn, {
    invoiceId: s.id,
    full: false,
    lines: [{ saleItemId: itemsOf(s.id)[0], qty: 1 }],
    refundMethod: 'NONE',
    confirmOverpay: true,
    userId: forged
  })
  eq('برگشت ثبت شد', r?.ok ? true : r?.error, true)
  const row = seed.one('SELECT id, userId FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', s.id)
  eq('SaleReturn.userId = کارمند نشست باز', Number(row?.userId), A)
  const d = await ipc(IPC.saleReturnDelete, {
    id: Number(row?.id),
    reason: 'ثبت اشتباه',
    managerPassword: PW,
    overrideReason: 'ابطال کنترل‌شدهٔ برگشت برای ممیزی actor',
    userId: forged
  })
  eq('ابطال برگشت ثبت شد', d?.ok ? true : d?.error, true)
  const v = seed.one('SELECT voidedByUserId FROM "SaleReturn" WHERE id = ?', Number(row?.id))
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? ORDER BY id DESC LIMIT 1`, Number(row?.id))
  eq('actor ابطال = کارمند نشست باز، نه همکار جعلی', Number(v?.voidedByUserId ?? a?.userId), A)
}

console.log('\n— ۲) نشست ۱۴۱: سقف تخفیف روی کالای جایگزین تعویض (از IPC)')
{
  const s = await salesService.create({ userId: A, shiftId, lines: [line()], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
  const it = itemsOf(s.id)[0]
  const c0 = counts()
  const r1 = await ipc(IPC.saleExchangeCreate, { invoiceId: s.id, lines: [{ saleItemId: it, qty: 1 }], replacements: [{ variantId: vr, qty: 1, unitPrice: 1_000_000, discount: 300_000 }], refundMode: 'STORE_CREDIT', userId: forged })
  eq('تخفیف ۳۰٪ روی جایگزین با سقف ۱۰٪ ⇒ رد با «سقف مجاز»', r1?.ok === false && /سقف مجاز/.test(String(r1?.error)), true)
  const r2 = await ipc(IPC.saleExchangeCreate, { invoiceId: s.id, lines: [{ saleItemId: it, qty: 1 }], replacements: [{ variantId: vr, qty: 1, unitPrice: 1_000_000, discount: 300_000 }], refundMode: 'STORE_CREDIT', managerPassword: PW, userId: forged })
  eq('با رمز مدیر هم رد (بند ۴-۲۶)', r2?.ok === false && /سقف مجاز/.test(String(r2?.error)), true)
  eq('هیچ سند/اعتبار/پرداختی ساخته نشد', counts(), c0)
  const r3 = await ipc(IPC.saleExchangeCreate, { invoiceId: s.id, lines: [{ saleItemId: it, qty: 1 }], replacements: [{ variantId: vr, qty: 1, unitPrice: 1_000_000, discount: 100_000 }], refundMode: 'STORE_CREDIT', userId: forged })
  eq('کنترل: تخفیف دقیقاً ۱۰٪ پذیرفته', r3?.ok ? true : r3?.error, true)
}

console.log('\n— ۳) نشست ۱۴۲: نقد هرگز مستقیم «حساب مدیر» نیست')
{
  eq('allowedDestinationsFor(CASH) = فقط نقد در صندوق', [...allowedDestinationsFor('CASH')], ['CASH'])
  const inv = await salesService.create({ userId: A, shiftId, lines: [line()], payments: [] })
  const p0 = seed.count('Payment', 'invoiceId = ?', inv.id)
  const r = await ipc(IPC.salePaymentAdd, { invoiceId: inv.id, amount: 200_000, methodId: cash, destination: 'MANAGER', userId: forged })
  eq('addPayment نقدی ⇐ حساب مدیر از IPC ⇒ رد با ارجاع به «برداشت از صندوق»', r?.ok === false && /برداشت از صندوق/.test(String(r?.error)), true)
  eq('هیچ ردیف پرداختی ساخته نشد', seed.count('Payment', 'invoiceId = ?', inv.id), p0)
  const k = await ipc(IPC.salePaymentAdd, { invoiceId: inv.id, amount: 200_000, methodId: cash, destination: 'CASH', userId: forged })
  eq('کنترل: نقدی ⇐ صندوق پذیرفته', k?.ok ? true : k?.error, true)
  const pr = seed.one('SELECT createdByUserId FROM "Payment" WHERE invoiceId = ? ORDER BY id DESC', inv.id)
  eq('ثبت‌کننده‌ی پرداخت = کارمند نشست باز', Number(pr?.createdByUserId), A)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
