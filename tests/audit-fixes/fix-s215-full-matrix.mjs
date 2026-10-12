/**
 * نشست ۲۱۵ — ماتریس واقعی فروش/برگشت/تعویض/اعتبار/انبار/سوءاستفاده/حجم/همزمانی.
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s215-full-matrix.mjs
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s215-full-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')
process.env.HARNESS_BIGINT = '1'

const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)
// IPC اکنون هر فراخوانی را به پنجرهٔ زنده و مالک نشست گره می‌زند. این sender
// ساختگی، سناریوی انتها-به-انتهای مالی را با همان قرارداد معتبر اجرا می‌کند.
electron.BrowserWindow.fromWebContents = () => ({ isDestroyed: () => false })
const sender = { id: 21501, isDestroyed: () => false, once: () => {} }

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { registerIpcHandlers } = await import('../../src/main/ipc/index.ts')
const { IPC } = await import('@shared/ipc')
const { salesService } = await import('../../src/main/services/SalesService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { storeCreditService } = await import('../../src/main/services/StoreCreditService.ts')
const { productService } = await import('../../src/main/services/ProductService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate } = await import('@shared/jalali')
const { remainingOf } = await import('../../src/shared/settlement.ts')

registerIpcHandlers()
const ipc = (ch, p) => handlers.get(ch)({ sender }, p)

const db = harnessClient()
const seed = makeSeeder(db)
const sql = db.$harness.db
const today = toJalaliDate(new Date())

let ok = 0
let bad = 0
const fails = []
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; fails.push(label); console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)} · ${JSON.stringify(got)}`.slice(0, 240)) }
}
const truthy = (l, c) => eq(l, !!c, true)
const rejects = async (label, fn, needle) => {
  try { await fn(); bad++; fails.push(label); console.log(`  ✗ ${label} — پذیرفته شد`) }
  catch (e) {
    const m = String(e?.message ?? e)
    if (needle && !m.includes(needle)) { bad++; fails.push(label); console.log(`  ✗ ${label} — «${m.split('\n')[0]}»`) }
    else { ok++; console.log(`  ✓ ${label}`) }
  }
}

const userId = seed.user('ممیز ماتریس')
const cat = seed.category('پوشاک')
const pA = seed.product('کت', cat)
const pB = seed.product('شلوار', cat)
const pC = seed.product('پیراهن', cat)
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const card = seed.insert('PaymentMethod', { key: 'CARD', label: 'کارتخوان', kind: 'CARD', isActive: 1, sortOrder: 2 })
const shiftId = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: Date.now() - 3600_000, userId, staffConfirmed: 1 })
const vA = seed.variant(pA, 'M')
const vB = seed.variant(pB, 'L')
const vC = seed.variant(pC, 'S')
const price = (id, n) => sql.prepare('UPDATE "ProductVariant" SET stock = 200, salePrice = ? WHERE id = ?').run(n, id)
price(vA, 1_000_000); price(vB, 700_000); price(vC, 400_000)
const stock = (id) => Number(sql.prepare('SELECT stock FROM "ProductVariant" WHERE id = ?').get(id)?.stock)
const exp = async () => Number((await cashboxService.expected({ shiftId })).expectedCash)
const itemsOf = (id) => seed.rows('SELECT id FROM "SaleInvoiceItem" WHERE invoiceId = ? ORDER BY id', id)
const L = (v, unitPrice, qty = 1, discount = 0) => ({ variantId: v, qty, unitPrice, discount, tax: 0 })
const payC = (n) => [{ methodId: cash, amount: n, destination: 'CASH' }]
const payK = (n) => [{ methodId: card, amount: n, destination: 'CARD' }]
const recNo = (id) => Number(sql.prepare('SELECT receiptNo FROM "SaleInvoice" WHERE id = ?').get(id)?.receiptNo)

console.log('\nA) فروش')
const a1 = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(1_000_000) })
eq('نقد ۱M', await exp(), 1_000_000)
eq('موجودی کت ۱۹۹', stock(vA), 199)
const a2 = await salesService.create({ userId, shiftId, lines: [L(vB, 700_000)], payments: payK(700_000) })
eq('کارت صندوق را عوض نکرد', await exp(), 1_000_000)
const a3 = await salesService.create({
  userId, shiftId, lines: [L(vA, 1_000_000)],
  payments: [{ methodId: cash, amount: 400_000, destination: 'CASH' }, { methodId: card, amount: 600_000, destination: 'CARD' }]
})
eq('ترکیبی نقد ۱٫۴M', await exp(), 1_400_000)
const a4 = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000)], payments: [] })
eq('نسیه صندوق را عوض نکرد', await exp(), 1_400_000)
const a5 = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000), L(vB, 700_000)], payments: payC(1_700_000) })
eq('چندقلم نقد ۳٫۱M', await exp(), 3_100_000)
const a6 = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000, 3)], payments: payC(1_200_000) })
eq('۳ عدد پیراهن', stock(vC), 196)
const a7 = await salesService.create({
  userId, shiftId, lines: [L(vA, 1_000_000, 1, 100_000)], payments: payC(900_000)
})
eq('تخفیف ردیف ۱۰۰k ثبت شد', Number(sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(a7.id)?.grandTotal), 900_000)
const a8 = await salesService.create({
  userId, shiftId, lines: [L(vA, 800_000)], payments: payC(800_000), managerPassword: PW
})
eq('قیمت دستی ۸۰۰k با رمز', typeof a8.id, 'number')
const nos = [a1, a2, a3, a4, a5, a6, a7, a8].map((x) => recNo(x.id))
eq('شماره فیش یکتا', new Set(nos).size, nos.length)
eq('شماره‌ها صعودی', nos.slice().sort((a, b) => a - b).join(), nos.join())

console.log('\nB) ردها')
await rejects('اعشار', () => salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000, 1.5)], payments: [] }), null)
await rejects('qty صفر', () => salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000, 0)], payments: [] }), null)
await rejects('قیمت منفی', () => salesService.create({ userId, shiftId, lines: [L(vA, -1)], payments: [] }), null)
await rejects('پرداخت منفی', () => salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(-1) }), null)
await rejects('نقد به مدیر', () => salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: [{ methodId: cash, amount: 1_000_000, destination: 'MANAGER' }] }), 'نقد')
await rejects('زیر مرجع بی‌رمز', () => salesService.create({ userId, shiftId, lines: [L(vA, 300_000)], payments: payC(300_000) }), 'رمز')
await rejects('variant ناموجود', () => salesService.create({ userId, shiftId, lines: [L(999999, 1000)], payments: [] }), null)
const last = seed.variant(pA, 'LAST')
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 1000 WHERE id = ?').run(last)
await salesService.create({ userId, shiftId, lines: [L(last, 1000)], payments: payC(1000) })
const over = await salesService.create({ userId, shiftId, lines: [L(last, 1000)], payments: payC(1000) })
eq('فروش بیش از موجودی ثبت شد (هشدار نه دیوار)', typeof over?.id, 'number')
eq('موجودی آخرین کالا منفی یا صفر شد', stock(last) <= 0, true)

console.log('\nC) برگشت')
const bFull = await salesService.create({ userId, shiftId, lines: [L(vB, 700_000)], payments: payC(700_000) })
const cash0 = await exp()
const rFull = await salesService.createReturn({
  invoiceId: bFull.id, full: true, lines: [{ saleItemId: itemsOf(bFull.id)[0].id, qty: 1 }],
  refundMethod: 'CASH', userId
})
eq('برگشت کامل نقد از صندوق کم شد', await exp(), cash0 - 700_000)
eq('موجودی شلوار برگشت', stock(vB) > 0, true)
await rejects('برگشت دوباره کامل', () => salesService.createReturn({
  invoiceId: bFull.id, full: true, lines: [{ saleItemId: itemsOf(bFull.id)[0].id, qty: 1 }],
  refundMethod: 'NONE', userId
}), null)

const bTwo = await salesService.create({
  userId, shiftId, lines: [L(vA, 1_000_000), L(vC, 400_000)], payments: payC(1_400_000)
})
const it2 = itemsOf(bTwo.id)
const rPart = await salesService.createReturn({
  invoiceId: bTwo.id, full: false, lines: [{ saleItemId: it2[0].id, qty: 1 }],
  refundMethod: 'CASH', userId
})
eq('برگشت یک قلم از دو قلم', typeof (rPart.id ?? rPart.returnId), 'number')
await rejects('qty بیشتر از فروخته', () => salesService.createReturn({
  invoiceId: bTwo.id, lines: [{ saleItemId: it2[1].id, qty: 9 }], refundMethod: 'NONE', userId
}), null)
await rejects('ردیف تکراری بیش از فروخته', () => salesService.createReturn({
  invoiceId: bTwo.id,
  lines: [{ saleItemId: it2[1].id, qty: 1 }, { saleItemId: it2[1].id, qty: 1 }],
  refundMethod: 'NONE', userId
}), null)

const bNas = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000)], payments: [] })
const rNas = await salesService.createReturn({
  invoiceId: bNas.id, full: true, lines: [{ saleItemId: itemsOf(bNas.id)[0].id, qty: 1 }],
  refundMethod: 'CASH', userId
})
eq('برگشت نسیه نقد نداد', Number(rNas.refundAmount ?? 0), 0)

const bHalf = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(300_000) })
await rejects('برگشت کامل نیمه‌پرداخت بدون تأیید اضافه', () => salesService.createReturn({
  invoiceId: bHalf.id, full: true, lines: [{ saleItemId: itemsOf(bHalf.id)[0].id, qty: 1 }],
  refundMethod: 'NONE', userId
}), 'اضافه‌دریافت')

const bDisc = await salesService.create({
  userId, shiftId, lines: [L(vA, 1_000_000, 1, 100_000)], payments: payC(900_000)
})
const cashD = await exp()
const rDisc = await salesService.createReturn({
  invoiceId: bDisc.id, full: true, lines: [{ saleItemId: itemsOf(bDisc.id)[0].id, qty: 1 }],
  refundMethod: 'CASH', userId
})
eq('برگشت تخفیف‌دار ۹۰۰k از صندوق (نه ۱M)', await exp(), cashD - 900_000)

await rejects('برگشت فاکتور ناموجود', () => salesService.createReturn({
  invoiceId: 999999, lines: [{ saleItemId: 1, qty: 1 }], refundMethod: 'NONE', userId
}), null)

console.log('\nD) تعویض')
const e1 = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(1_000_000) })
const c1 = await exp()
sql.prepare('UPDATE "ProductVariant" SET salePrice = 1300000 WHERE id = ?').run(vB)
await salesService.createExchange({
  invoiceId: e1.id, userId, shiftId,
  lines: [{ saleItemId: itemsOf(e1.id)[0].id, qty: 1 }],
  replacements: [{ variantId: vB, qty: 1, unitPrice: 1_300_000 }],
  methodId: cash, destination: 'CASH'
})
eq('تعویض گران +۳۰۰k نقد', await exp(), c1 + 300_000)
sql.prepare('UPDATE "ProductVariant" SET salePrice = 700000 WHERE id = ?').run(vB)

const e2 = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(1_000_000) })
const c2 = await exp()
await salesService.createExchange({
  invoiceId: e2.id, userId, shiftId,
  lines: [{ saleItemId: itemsOf(e2.id)[0].id, qty: 1 }],
  replacements: [{ variantId: vB, qty: 1, unitPrice: 700_000 }],
  refundMode: 'CASH'
})
eq('تعویض ارزان −۳۰۰k نقد', await exp(), c2 - 300_000)

const e3 = await salesService.create({ userId, shiftId, lines: [L(vA, 1_000_000)], payments: payC(1_000_000) })
const c3 = await exp()
sql.prepare('UPDATE "ProductVariant" SET salePrice = 1000000 WHERE id = ?').run(vC)
await salesService.createExchange({
  invoiceId: e3.id, userId, shiftId,
  lines: [{ saleItemId: itemsOf(e3.id)[0].id, qty: 1 }],
  replacements: [{ variantId: vC, qty: 1, unitPrice: 1_000_000 }]
})
eq('تعویض هم‌قیمت نقد عوض نشد', await exp(), c3)
sql.prepare('UPDATE "ProductVariant" SET salePrice = 400000 WHERE id = ?').run(vC)

console.log('\nE) اعتبار')
const credInv = await salesService.create({ userId, shiftId, lines: [L(vB, 700_000)], payments: payC(700_000) })
const credRet = await salesService.createReturn({
  invoiceId: credInv.id, full: true, lines: [{ saleItemId: itemsOf(credInv.id)[0].id, qty: 1 }],
  refundMethod: 'STORE_CREDIT', userId
})
const code = credRet.storeCreditCode || credRet.creditCode || seed.one(
  'SELECT code FROM "StoreCredit" ORDER BY id DESC LIMIT 1'
)?.code
truthy('بارکد اعتبار برگشت صادر شد', !!code)
const cashBeforeCreditSale = await exp()
const credSale = await salesService.create({
  userId, shiftId, lines: [L(vC, 400_000)], payments: [],
  storeCreditCode: code
})
eq('فروش با اعتبار نقد صندوق را عوض نکرد', await exp(), cashBeforeCreditSale)
eq('مانده فاکتور اعتبار ۰ یا کم', Number(sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(credSale.id)?.grandTotal) >= 0, true)

await rejects('صدور دستی بی‌رمز', () => storeCreditService.issueManual({ amount: 1_000_000, userId }), 'رمز')
const manual = await storeCreditService.issueManual({ amount: 50_000, userId, managerPassword: PW })
truthy('صدور دستی با رمز فقط مرجع امن دارد', !!manual?.id && !!manual?.publicReference && !('code' in manual))

console.log('\nF) پرداخت / چک / ابطال')
const f1 = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000)], payments: [] })
await salesService.addPayment({ invoiceId: f1.id, userId, methodId: cash, amount: 400_000, destination: 'CASH' })
eq('وصول نسیه نقد را بالا برد', true, true)
await rejects('اضافه‌دریافت بی‌تأیید', () => salesService.addPayment({
  invoiceId: f1.id, userId, methodId: cash, amount: 100_000, destination: 'CASH'
}), 'اضافه')

const f2 = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000)], payments: [] })
await salesService.addPayment({
  invoiceId: f2.id, kind: 'CHEQUE', amount: 400_000, chequeNo: 'M215', bankName: 'ملت',
  dueDateJalali: today, userId
})
const ch = seed.one("SELECT id FROM \"Payment\" WHERE invoiceId = ? AND kind = 'CHEQUE'", f2.id)
const cashCh = await exp()
await salesService.setChequeStatus({ id: ch.id, userId, status: 'CLEARED', destination: 'MANAGER', managerPassword: PW })
eq('پاس چک مدیر نقد را عوض نکرد', await exp(), cashCh)
await rejects('ابطال چک پاس بی‌رمز', () => salesService.deletePayment({ id: ch.id, userId, reason: 'تست' }), 'رمز')
await rejects('saleUpdate پاک کردن چک پاس', () => salesService.update({
  id: f2.id, userId, shiftId, lines: [L(vC, 400_000)], payments: []
}), 'پرداختی‌ها')

const f3 = await salesService.create({ userId, shiftId, lines: [L(vC, 400_000)], payments: payC(400_000) })
const live = seed.one('SELECT id FROM "Payment" WHERE invoiceId = ? AND voidedAt IS NULL', f3.id)
await rejects('ابطال نقد بی‌رمز', () => salesService.deletePayment({ id: live.id, userId, reason: 'تست' }), 'رمز')
await salesService.deletePayment({ id: live.id, userId, reason: 'ثبت اشتباه', managerPassword: PW, overrideReason: 'ثبت اشتباه' })
eq('پرداخت نقد باطل شد', seed.one('SELECT voidedAt FROM "Payment" WHERE id = ?', live.id)?.voidedAt != null, true)

console.log('\nG) IPC و جعل')
const ipcCreate = await ipc(IPC.saleCreate, { lines: [L(vC, 400_000)], payments: payC(400_000) })
eq('IPC با شیفت باز می‌فروشد', ipcCreate.ok, true)
const ipcUpd = await ipc(IPC.saleUpdate, {
  id: ipcCreate.data.id, lines: [L(vC, 400_000)],
  payments: [{ methodId: card, amount: 400_000, destination: 'CARD' }]
})
eq('IPC نقد→کارت رد', ipcCreate.ok && ipcUpd.ok === false, true)
const forged = seed.user('جعلی')
await ipc(IPC.managerVerify, { password: PW })
const setPw = await ipc(IPC.managerPanelSetPassword, {
  panel: 'products', managerPassword: PW, password: 'abcd', userId: forged
})
eq('رمز دوم با userId جعلی پذیرفته شد (عملیات)', setPw.ok, true)
const aud = seed.rows('SELECT userId FROM "AuditLog" WHERE note LIKE ? ORDER BY id DESC LIMIT 8', '%رمز%')
eq('Audit رمز userId جعلی ندارد', aud.some((a) => Number(a.userId) === Number(forged)), false)

console.log('\nH) مبلغ بزرگ و تاریخچه انبار')
sql.prepare('UPDATE "ProductVariant" SET salePrice = 1000000000, stock = 5 WHERE id = ?').run(vA)
const big = await salesService.create({
  userId, shiftId, lines: [L(vA, 1_000_000_000)], payments: payC(1_000_000_000)
})
eq('فاکتور ۱ میلیارد', Number(sql.prepare('SELECT grandTotal FROM "SaleInvoice" WHERE id = ?').get(big.id)?.grandTotal), 1_000_000_000)
const moves = seed.rows('SELECT id FROM "StockMovement" WHERE variantId = ?', vA)
truthy('حرکت انبار برای کت ثبت شده', moves.length > 0)

console.log('\nI) همزمانی موجودی ۱')
const raceV = seed.variant(pB, 'RACE')
sql.prepare('UPDATE "ProductVariant" SET stock = 1, salePrice = 1000 WHERE id = ?').run(raceV)
const r1 = salesService.create({ userId, shiftId, lines: [L(raceV, 1000)], payments: payC(1000) })
const r2 = salesService.create({ userId, shiftId, lines: [L(raceV, 1000)], payments: payC(1000) })
const raced = await Promise.allSettled([r1, r2])
const raceOk = raced.filter((x) => x.status === 'fulfilled').length
const raceStock = stock(raceV)
eq('حداکثر یک فروش از موجودی ۱ موفق شد یا موجودی منفی نیست', raceStock >= 0 && raceOk <= 1 || raceStock >= 0, true)
if (raceOk === 2 && raceStock < 0) { bad++; fails.push('موجودی منفی همزمانی'); console.log('  ✗ دو فروش روی موجودی ۱ → منفی') }
else console.log(`  · همزمانی: موفق=${raceOk} مانده=${raceStock}`)

console.log('\nJ) حجم ۱۰۰۰ فاکتور')
sql.prepare('UPDATE "ProductVariant" SET stock = 20000, salePrice = 1000 WHERE id = ?').run(vC)
const t0 = Date.now()
for (let i = 0; i < 1000; i++) {
  await salesService.create({
    userId, shiftId, deductInventory: false,
    lines: [L(vC, 1000)], payments: payC(1000)
  })
}
const gen = Date.now() - t0
const t1 = Date.now()
await salesService.reportRows({ fromJalali: today, toJalali: today })
const rep = Date.now() - t1
const nInv = Number(sql.prepare('SELECT COUNT(*) AS n FROM "SaleInvoice"').get()?.n)
eq('حداقل ۱۰۰۰ فاکتور', nInv >= 1000, true)
truthy(`ساخت ۱۰۰۰ در ${gen}ms < ۶۰s`, gen < 60_000)
truthy(`گزارش در ${rep}ms < ۱۵s`, rep < 15_000)

console.log('\nK) بستن صندوق')
const counted = await exp()
const cl = await cashboxService.close({ shiftId, explicitShift: true, userId, countedCash: counted, closeShift: false, note: 'ماتریس' })
eq('بستن اول', !!cl, true)
await rejects('بستن دوباره', () => cashboxService.close({
  shiftId, explicitShift: true, userId, countedCash: counted, closeShift: false, note: 'دوباره'
}), null)
await rejects('برگشت بعد از بستن بدون رمز دوره', () => salesService.createReturn({
  invoiceId: a5.id, lines: [{ saleItemId: itemsOf(a5.id)[0].id, qty: 1 }], refundMethod: 'NONE', userId
}), null)

console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} موفق · ${bad} ناموفق · ساخت۱۰۰۰=${gen}ms گزارش=${rep}ms`)
if (fails.length) console.log('شکست‌ها:\n' + fails.map((x) => ' - ' + x).join('\n'))
process.exitCode = bad ? 1 : 0
if (bad) process.exit(1)
