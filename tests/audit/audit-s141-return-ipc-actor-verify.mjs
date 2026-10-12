/**
 * ممیزی نشست ۱۴۱ (S141) — actor کانال‌های برگشت/تعویض از مسیر IPC واقعی.
 *   • AUDIT-S141-02: saleReturn، saleReturnUpdate، saleReturnDelete و saleExchangeCreate با withUser
 *     userId ارسالی renderer را می‌پذیرفتند ⇒ فروشنده برگشت/تعویض/ابطال را به نام همکار ثبت می‌کرد
 *     (نرخ برگشت کارمند و Audit جعل می‌شد؛ بند ۴-۳۰ و D68). حالا actor = کارمند نشست باز؛ بی‌نشست رد.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s141b-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// Main-first IPC فقط event.sender معتبر را می‌پذیرد؛ این mock، آزمون actor
// را از مرز مستقلِ مالکیت پنجره عبور می‌دهد.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 14101, isDestroyed: () => false, once: () => {} }
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const db = harnessClient(); const seed = makeSeeder(db)
const { registerIpcHandlers } = await import(join(root, 'src/main/ipc/index.ts'))
const { IPC } = await import(join(root, 'src/shared/ipc.ts'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { jalaliToday } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)({ sender }, payload)
const today = jalaliToday()
const A = seed.user('فروشنده الف ۱۴۱')
const forged = seed.user('همکار جعلی ۱۴۱')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const product = seed.product('پیراهن', seed.category('پوشاک'))
const mkVariant = (size, price) => { const id = seed.variant(product, size); db.$harness.db.prepare('UPDATE "ProductVariant" SET stock = 10, salePrice = ? WHERE id = ?').run(price, id); return id }
const v1 = mkVariant('M', 500_000), v2 = mkVariant('L', 500_000), vr = mkVariant('XL', 500_000)
const itemsOf = (invId) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', invId).map((r) => Number(r.id))

console.log('\n— ۰) بی‌نشست: برگشت رد')
let saleNoShift
{
  const shift0 = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 7200_000, userId: A, staffConfirmed: 1 })
  saleNoShift = await salesService.create({ userId: A, shiftId: shift0, lines: [{ variantId: v1, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }] })
  db.$harness.db.prepare('UPDATE "Shift" SET closedAt = ? WHERE id = ?').run(Date.now() - 3600_000, shift0)
  const [i1] = itemsOf(saleNoShift.id)
  const r = await ipc(IPC.saleReturn, { invoiceId: saleNoShift.id, full: false, lines: [{ saleItemId: i1, qty: 1 }], refundMethod: 'NONE', userId: forged })
  eq('بی‌نشست باز: برگشت رد با پیام «نشست باز»', r?.ok === false && /نشست بازِ کارمند/.test(String(r?.error)), true)
  eq('هیچ سند برگشتی ساخته نشد', seed.count('SaleReturn', 'invoiceId = ?', saleNoShift.id), 0)
}

const shiftA = seed.insert('Shift', { name: 'عصر', number: 2, dayJalali: today, openedAt: Date.now() - 1800_000, userId: A, staffConfirmed: 1 })

console.log('\n— ۱) saleReturn با userId جعلی')
let retId, sale
{
  sale = await salesService.create({ userId: A, shiftId: shiftA, lines: [{ variantId: v1, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }, { variantId: v2, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 1_000_000, destination: 'CASH' }] })
  const [i1] = itemsOf(sale.id)
  const r = await ipc(IPC.saleReturn, {
    invoiceId: sale.id,
    full: false,
    lines: [{ saleItemId: i1, qty: 1 }],
    refundMethod: 'NONE',
    confirmOverpay: true,
    userId: forged
  })
  eq('برگشت ثبت شد', r?.ok ? true : r?.error, true)
  const row = seed.one('SELECT id, userId FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', sale.id)
  retId = Number(row?.id)
  eq('SaleReturn.userId = کارمند نشست باز، نه همکار جعلی', Number(row?.userId), A)
}

console.log('\n— ۲) saleReturnUpdate با userId جعلی')
{
  const [i1, i2] = itemsOf(sale.id)
  const r = await ipc(IPC.saleReturnUpdate, {
    id: retId,
    lines: [{ saleItemId: i1, qty: 0 }, { saleItemId: i2, qty: 1 }],
    panelPassword: PW,
    overrideReason: 'جابجایی امن قلم برگشتی',
    userId: forged
  })
  eq('ویرایش ثبت شد', r?.ok ? true : r?.error, true)
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? ORDER BY id DESC LIMIT 1`, retId)
  eq('actor Audit ویرایش = کارمند نشست باز', Number(a?.userId), A)
}

console.log('\n— ۳) saleExchangeCreate با userId جعلی')
{
  const s2 = await salesService.create({ userId: A, shiftId: shiftA, lines: [{ variantId: v1, qty: 1, unitPrice: 500_000, discount: 0, tax: 0 }], payments: [{ methodId: cash, amount: 500_000, destination: 'CASH' }] })
  const [i1] = itemsOf(s2.id)
  const r = await ipc(IPC.saleExchangeCreate, { invoiceId: s2.id, lines: [{ saleItemId: i1, qty: 1 }], replacements: [{ variantId: vr, qty: 1 }], userId: forged })
  eq('تعویض ثبت شد', r?.ok ? true : r?.error, true)
  const row = seed.one('SELECT userId, exchangeInvoiceId FROM "SaleReturn" WHERE invoiceId = ? ORDER BY id DESC', s2.id)
  eq('برگشتِ تعویض: userId = کارمند نشست باز', Number(row?.userId), A)
  const ex = row?.exchangeInvoiceId ? seed.one('SELECT userId FROM "SaleInvoice" WHERE id = ?', row.exchangeInvoiceId) : null
  eq('سند تعویض: userId = کارمند نشست باز', Number(ex?.userId), A)
}

console.log('\n— ۴) saleReturnDelete با userId جعلی')
{
  const r = await ipc(IPC.saleReturnDelete, {
    id: retId,
    reason: 'ثبت اشتباه مشتری',
    panelPassword: PW,
    userId: forged
  })
  eq('ابطال ثبت شد', r?.ok ? true : r?.error, true)
  const row = seed.one('SELECT voidedAt, voidedByUserId FROM "SaleReturn" WHERE id = ?', retId)
  eq('برگشت باطل شد', row?.voidedAt != null, true)
  const a = seed.one(`SELECT userId FROM "AuditLog" WHERE entity = 'SaleReturn' AND entityId = ? ORDER BY id DESC LIMIT 1`, retId)
  eq('actor ابطال (ستون یا Audit) = کارمند نشست باز', Number(row?.voidedByUserId ?? a?.userId), A)
}

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
