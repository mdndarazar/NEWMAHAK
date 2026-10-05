/**
 * ممیزی نشست ۱۱۵ — A115-01 (P1): گیت وضعیت در CardTransferService.adjust/cancel.
 *   • adjust روی PENDING/CANCELED مجاز بود: درخواست ۱٬۰۰۰٬۰۰۰ در انتظار + اصلاح +۲۰۰٬۰۰۰ ⇒ ADJUSTED بدون paidAt ⇒
 *     ۱٬۰۰۰٬۰۰۰ از «در انتظار» حذف، pay دیگر ممکن نیست (فقط PENDING)، و ۲۰۰٬۰۰۰ «پرداخت‌شده» شمرده می‌شد.
 *   • cancel روی ADJUSTED پرداخت‌شده مجاز بود ⇒ پرداخت واقعی ۱٬۰۰۰٬۰۰۰ از پرداخت‌شده/خروج خالص حذف و releaseStock ممکن.
 *   قاعده (AUDIT-D47): adjust فقط روی PAID یا ADJUSTED دارای paidAt؛ cancel هر ردیف دارای paidAt را رد می‌کند.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const errOf = async (fn) => { try { await fn(); return null } catch (e) { return String(e?.message ?? e) } }
const hasMsg = (e, needle) => !!e && !e.startsWith('HARNESS:') && e.includes(needle)
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11501-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cardTransferService, createCardTransferRequest } = await import('../../src/main/services/CardTransferService.ts')
const { DEFAULT_MANAGER_PASSWORD: PW } = await import('@shared/receipt')
const { toJalaliDate, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday()
const userId = seed.user('مدیر A115')
const mkReq = async (amount) => {
  const inv = seed.invoice({ grandTotal: 2000000 }); const invId = typeof inv === 'object' ? inv.id : inv
  const retId = seed.insert('SaleReturn', { invoiceId: invId, total: amount, returnedAt: Date.now(), returnedAtJalali: toJalaliDate(new Date()), kind: 'RETURN' })
  return createCardTransferRequest(db, { returnId: retId, amount, userId })
}
const st = (id) => seed.one('SELECT status, paidAt FROM "CardTransferRequest" WHERE id = ?', id)
const totals = async () => (await cardTransferService.outOfSales({ fromJalali: today, toJalali: today })).totals
const ADJ_MSG = 'فقط روی درخواستِ پرداخت‌شده'
const CANCEL_MSG = 'پرداخت شده است و لغو نمی‌شود'

console.log('— ۱) adjust روی PENDING ⇒ رد؛ درخواست در انتظار و قابل پرداخت می‌ماند')
const r1 = await mkReq(1000000)
const e1 = await errOf(() => cardTransferService.adjust({ id: r1.id, amount: 200000, reason: 'تست', userId, managerPassword: PW }))
eq('adjust روی PENDING با پیام هدف رد شد', hasMsg(e1, ADJ_MSG), true)
eq('وضعیت همچنان PENDING', st(r1.id)?.status, 'PENDING')
eq('صفر ردیف اصلاحی', seed.count('CardTransferRequest', `kind = 'ADJUSTMENT'`), 0)
let t = await totals()
eq('در انتظار ۱٬۰۰۰٬۰۰۰ · پرداخت‌شده ۰ · خالص ۰', [t.pendingAmount, t.paidAmount, t.netOutOfSalesFlow], [1000000, 0, 0])
const e1b = await errOf(() => cardTransferService.pay({ id: r1.id, userId, managerPassword: PW }))
eq('pay بعد از تلاش adjust هنوز ممکن است', e1b, null)

console.log('— ۲) adjust روی CANCELED ⇒ رد')
const r2 = await mkReq(300000)
await cardTransferService.cancel({ id: r2.id, reason: 'اشتباه', userId, managerPassword: PW })
const e2 = await errOf(() => cardTransferService.adjust({ id: r2.id, amount: 50000, reason: 'تست', userId, managerPassword: PW }))
eq('adjust روی CANCELED با پیام هدف رد شد', hasMsg(e2, ADJ_MSG), true)
eq('وضعیت همچنان CANCELED', st(r2.id)?.status, 'CANCELED')

console.log('— ۳) adjust روی PAID و دوباره روی ADJUSTED پرداخت‌شده ⇒ مجاز')
const e3 = await errOf(() => cardTransferService.adjust({ id: r1.id, amount: -100000, reason: 'اصلاح ۱', userId, managerPassword: PW }))
eq('adjust روی PAID موفق', e3, null)
eq('وضعیت ADJUSTED با paidAt', [st(r1.id)?.status, st(r1.id)?.paidAt != null], ['ADJUSTED', true])
const e3b = await errOf(() => cardTransferService.adjust({ id: r1.id, amount: 20000, reason: 'اصلاح ۲', userId, managerPassword: PW }))
eq('adjust دوم روی ADJUSTED پرداخت‌شده موفق', e3b, null)
t = await totals()
eq('پرداخت‌شده ۱٬۰۰۰٬۰۰۰ · اصلاحی ‎-۸۰٬۰۰۰ · خالص ۹۲۰٬۰۰۰', [t.paidAmount, t.adjustmentAmount, t.netOutOfSalesFlow], [1000000, -80000, 920000])

console.log('— ۴) cancel روی ADJUSTED پرداخت‌شده ⇒ رد؛ جمع دست‌نخورده')
const e4 = await errOf(() => cardTransferService.cancel({ id: r1.id, reason: 'تست', userId, managerPassword: PW }))
eq('cancel روی ADJUSTED پرداخت‌شده با پیام هدف رد شد', hasMsg(e4, CANCEL_MSG), true)
const e4b = await errOf(() => cardTransferService.cancel({ id: r1.id, reason: 'تست', releaseStock: true, userId, managerPassword: PW }))
eq('cancel+releaseStock روی ADJUSTED پرداخت‌شده هم رد شد', hasMsg(e4b, CANCEL_MSG), true)
eq('وضعیت همچنان ADJUSTED', st(r1.id)?.status, 'ADJUSTED')
t = await totals()
eq('خالص همچنان ۹۲۰٬۰۰۰', [t.paidAmount, t.netOutOfSalesFlow], [1000000, 920000])

console.log('— ۵) کنترل: cancel روی PAID رد، روی PENDING مجاز')
const r5 = await mkReq(400000)
await cardTransferService.pay({ id: r5.id, userId, managerPassword: PW })
eq('cancel روی PAID رد شد', hasMsg(await errOf(() => cardTransferService.cancel({ id: r5.id, reason: 'x', userId, managerPassword: PW })), CANCEL_MSG), true)
const r6 = await mkReq(100000)
eq('cancel روی PENDING مجاز', await errOf(() => cardTransferService.cancel({ id: r6.id, reason: 'x', userId, managerPassword: PW })), null)

console.log('— ۶) helper خالص UI (src/shared/cardTransferUi.ts) با خروجی واقعی detail هم‌راستاست')
let ui = null
try { ui = await import('../../src/shared/cardTransferUi.ts') } catch (e) { console.log('  (helper موجود نیست)') }
const d1 = await cardTransferService.get({ id: r1.id }).catch(() => null)
const d6 = await cardTransferService.get({ id: r6.id }).catch(() => null)
const r7 = await mkReq(50000)
const d7 = await cardTransferService.get({ id: r7.id }).catch(() => null)
eq('ADJUSTED پرداخت‌شده ⇒ دکمه‌ی اصلاح فعال', !!ui?.canAdjustCardTransfer(d1?.request), true)
eq('PENDING ⇒ دکمه‌ی اصلاح غیرفعال', ui ? ui.canAdjustCardTransfer(d7?.request) : true, false)
eq('CANCELED ⇒ دکمه‌ی اصلاح غیرفعال', ui ? ui.canAdjustCardTransfer(d6?.request) : true, false)
eq('ADJUSTED پرداخت‌شده ⇒ لغو غیرفعال', ui ? ui.canCancelCardTransfer(d1?.request) : true, false)
eq('PENDING ⇒ لغو فعال', !!ui?.canCancelCardTransfer(d7?.request), true)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
