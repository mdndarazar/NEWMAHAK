// نشست ۱۵۶: تست قبل/بعد Y12. قبل روی کپی دست‌نخورده ⇒ TESTLOG-s156y12-before.txt، بعد ⇒ TESTLOG-s156y12-after.txt.
/**
 * ===========================================================================
 * نشست ۱۵۶ · خوشه E/K · Y12 (بند ۴-۲) — شیفتِ فاکتور فروش فقط شیفت باز لحظه‌ی ثبت است.
 * قبل از رفع: SalesService.create ⇒ shiftId = input.shiftId ?? currentId(...)؛ یعنی رندرر/IPC می‌توانست
 * فروش امروز را به یک شیفت دیگر (مثلاً شیفت بسته‌ی دیروز یا نشست همکار) نسبت دهد و گزارش شیفت را جابه‌جا کند.
 * بعد از رفع (S156-D7): shiftId ارسالیِ متفاوت با شیفت باز ⇒ رد فارسی؛ نبودِ shiftId ⇒ شیفت باز.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-y12-sale-shift.mjs
 * ===========================================================================
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-y12-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const db = harnessClient()
const seed = makeSeeder(db)
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { jalaliToday } = await import('@shared/jalali')
registerIpcHandlers()
const ipc = (ch, payload) => handlers.get(ch)(null, payload)

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} — بدون تأیید پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (!m.startsWith('HARNESS:') && /[\u0600-\u06FF]/.test(m) && (!needle || m.includes(needle))) { ok++; console.log(`  ✓ ${label} (رد شد: ${m.split('\n')[0].slice(0, 130)})`) }
    else { bad++; console.log(`  ✗ ${label} — پیام نامنتظره: ${m.split('\n')[0].slice(0, 160)}`) }
  }
}
const safe = async (label, fn) => {
  try { const r = await fn(); ok++; console.log(`  ✓ ${label}`); return r } catch (e) { bad++; console.log(`  ✗ ${label} — خطای نامنتظره: ${String(e?.message ?? e).split('\n')[0].slice(0, 180)}`); return null }
}

const actor = seed.user('فروشنده Y12')
const other = seed.user('همکار Y12')
const closedShift = seed.insert('Shift', { name: 'شب', number: 1, dayJalali: jalaliToday(), openedAt: Date.now() - 20 * 3600_000, closedAt: Date.now() - 10 * 3600_000, userId: other, staffConfirmed: 1 })
const openShift = seed.insert('Shift', { name: 'صبح', number: 2, dayJalali: jalaliToday(), openedAt: Date.now() - 3600_000, userId: actor, staffConfirmed: 1 })
const pid = seed.product('شلوار Y12', seed.category('پوشاک Y12'))
const v1 = seed.insert('ProductVariant', { productId: pid, code: 'Y12', barcode: 'BY12', salePrice: 1_000_000, stock: 100 })
const line = { variantId: v1, code: 'Y12', barcode: 'BY12', name: 'شلوار Y12', qty: 1, unitPrice: 1_000_000, discount: 0, tax: 0 }
const sale = (o = {}) => ({ userId: actor, deductInventory: false, lines: [line], payments: [], ...o })
const shiftOf = (id) => Number(seed.one('SELECT shiftId FROM "SaleInvoice" WHERE id = ?', Number(id))?.shiftId)
const invoices = () => seed.count('SaleInvoice')

console.log('\nY12) شیفت فاکتور = شیفت باز لحظه‌ی ثبت')
const n0 = invoices()
await rejects('shiftId شیفت بسته‌ی همکار ⇒ رد', () => salesService.create(sale({ shiftId: closedShift })), 'شیفت')
await rejects('shiftId ناموجود ⇒ رد', () => salesService.create(sale({ shiftId: 999_999 })), 'شیفت')
const r = await ipc(IPC.saleCreate, sale({ shiftId: closedShift }))
truthy('IPC.saleCreate با shiftId شیفت بسته ⇒ رد فارسی', r?.ok === false && /شیفت/.test(String(r?.error)))
eq('هیچ فاکتوری ثبت نشد', invoices(), n0)
const a = await safe('بدون shiftId ⇒ پذیرفته', () => salesService.create(sale()))
eq('shiftId = شیفت باز', shiftOf(a?.id), openShift)
const b = await safe('shiftId همان شیفت باز ⇒ پذیرفته', () => salesService.create(sale({ shiftId: openShift })))
eq('shiftId = شیفت باز', shiftOf(b?.id), openShift)
const c = await safe('فروش عمده بدون shiftId ⇒ همان شیفت باز', () => salesService.create(sale({ orderType: 'WHOLESALE' })))
eq('shiftId عمده = شیفت باز', shiftOf(c?.id), openShift)

console.log(`\nنتیجه: ${ok} موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
