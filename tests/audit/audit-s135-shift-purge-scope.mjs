/**
 * ممیزی نشست ۱۳۵ (S135-1) — شیفت‌های قدیمی در «آرشیو و پاک‌سازی» (fix-s135 فقط regex بود).
 * AUDIT-S135-01: پیش‌نمایش همه‌ی شیفت‌های قدیمی را می‌شمرد ولی DELETE فقط بی‌سندها را حذف می‌کرد ⇒
 *   پیش‌نمایش ≠ عملیات (D53/D59)، نتیجه و Audit «N شیفت پاک شد» دروغ، و با گارد S135 آرشیو کامل (بکاپ/VACUUM)
 *   روی دیتابیسی اجرا می‌شد که هیچ چیزی از آن پاک نمی‌شد. همچنین شیفتی که هنوز مالک سند مالیِ باقی‌مانده بود
 *   (گردش صندوق، درخواست کارت‌به‌کارت در انتظار، مصرف اعتبار، پرداخت فاکتور تازه) حذف و مالکش یتیم می‌شد.
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
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s135a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { maintenanceService } = await import(join(root, 'src/main/services/MaintenanceService.ts'))
const { toJalaliDate, jalaliToday, jalaliAddDays } = await import(join(root, 'src/shared/jalali.ts'))
const { DEFAULT_MANAGER_PASSWORD: PW } = await import(join(root, 'src/shared/receipt.ts'))
const db = harnessClient(); const seed = makeSeeder(db)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 300) } } }
const DAY = 86400000
const today = jalaliToday()
const cut = jalaliAddDays(today, -730)
const oldT = Date.now() - 1100 * DAY; const oldJ = toJalaliDate(new Date(oldT))
const userId = seed.user('مدیر ۱۳۵')
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const shift = (name) => seed.insert('Shift', { name, number: 1, dayJalali: oldJ, openedAt: oldT, userId })
const exists = (id) => seed.count('Shift', 'id = ?', id) === 1

console.log('\n— ۱) فقط شیفت‌های قدیمیِ متصل به سند باقی‌مانده ⇒ چیزی برای پاک‌سازی نیست')
const sNight = shift('شب — عبور از مرز') // فاکتور تازه‌تر از مرز (شیفت شب که از نیمه‌شب گذشت)
const newInv = seed.insert('SaleInvoice', { receiptNo: 5001, status: 'FINAL', grandTotal: 700000, paidTotal: 700000, goodsTotal: 700000, issuedAt: Date.now(), issuedAtJalali: today, shiftId: sNight })
const sCashMove = shift('برداشت صندوق')
seed.insert('CashMovement', { shiftId: sCashMove, amount: -200000, type: 'WITHDRAW', occurredAt: oldT, createdAt: oldT })
const sCard = shift('کارت‌به‌کارت در انتظار')
seed.insert('CardTransferRequest', { shiftId: sCard, returnId: 1, amount: 300000, status: 'PENDING', createdAt: oldT })
const sRedeem = shift('مصرف اعتبار')
seed.insert('StoreCreditRedemption', { shiftId: sRedeem, creditId: 1, code: 'SC1', amount: 100000, at: oldT, atJalali: oldJ })
const sPay = shift('پرداخت فاکتور تازه')
seed.insert('Payment', { invoiceId: newInv, methodId: cash, amount: 700000, paidAt: Date.now(), paidAtJalali: today, createdShiftId: sPay })
const linked = [sNight, sCashMove, sCard, sRedeem, sPay]
{
  const pv = await safe(() => maintenanceService.preview({ beforeJalali: cut }))
  eq('پیش‌نمایش: ۰ شیفت قابل پاک‌سازی (همه مالک سند باقی‌مانده‌اند)', pv?.shifts, 0)
  const r = await safe(() => maintenanceService.archivePurge({ beforeJalali: cut, managerPassword: PW, backup: false, vacuum: false, userId }))
  eq('آرشیو: «داده‌ای برای پاک‌سازی وجود ندارد» (نه اجرای بی‌اثر با ادعای حذف)', /داده‌ای برای پاک‌سازی وجود ندارد/.test(r?.__error ?? ''), true)
  eq('هیچ شیفت متصل حذف نشد', linked.map(exists), [true, true, true, true, true])
  eq('هیچ Audit آرشیو ثبت نشد', seed.count('AuditLog', `action = 'DATA_ARCHIVE_PURGE'`), 0)
}

console.log('\n— ۲) شیفت قدیمیِ واقعاً بی‌سند ⇒ پیش‌نمایش = عملیات')
const sFree1 = shift('بی‌سند ۱'); const sFree2 = shift('بی‌سند ۲')
// شیفتی که فقط مالک فاکتور قدیمی و پرداخت/چکِ همان فاکتور است ⇒ با خود فاکتور پاک می‌شود
const sOld = shift('فاکتور قدیمی')
const oldInv = seed.insert('SaleInvoice', { receiptNo: 11, status: 'FINAL', grandTotal: 400000, paidTotal: 400000, goodsTotal: 400000, issuedAt: oldT, issuedAtJalali: oldJ, shiftId: sOld })
const oldPay = seed.insert('Payment', { invoiceId: oldInv, methodId: cash, amount: 400000, paidAt: oldT, paidAtJalali: oldJ, createdShiftId: sOld, clearedShiftId: sOld })
seed.insert('PaymentChequeStatusHistory', { paymentId: oldPay, status: 'CLEARED', clearedShiftId: sOld, changedAt: oldT })
// شیفت قدیمی که پاس چکِ فاکتور تازه را ثبت کرده ⇒ باید بماند
const sClear = shift('پاس چک فاکتور تازه')
const chq = seed.insert('Payment', { invoiceId: newInv, methodId: cash, amount: 1000, paidAt: Date.now(), paidAtJalali: today, kind: 'CHEQUE' })
seed.insert('PaymentChequeStatusHistory', { paymentId: chq, status: 'CLEARED', clearedShiftId: sClear, changedAt: oldT })
linked.push(sClear)
const sFresh = seed.insert('Shift', { name: 'امروز', number: 1, dayJalali: today, openedAt: Date.now(), userId })
{
  const pv = await safe(() => maintenanceService.preview({ beforeJalali: cut }))
  eq('پیش‌نمایش: دقیقاً ۳ شیفت (دو بی‌سند + مالک فقط فاکتور قدیمی)', pv?.shifts, 3)
  const r = await safe(() => maintenanceService.archivePurge({ beforeJalali: cut, managerPassword: PW, backup: false, vacuum: false, userId }))
  eq('آرشیو بی‌خطا', r?.__error ?? null, null)
  eq('نتیجه‌ی آرشیو: ۳ شیفت (همان پیش‌نمایش)', r?.shifts, 3)
  eq('سه شیفت قابل پاک‌سازی حذف شدند', [exists(sFree1), exists(sFree2), exists(sOld)], [false, false, false])
  eq('شیفت‌های مالک سند باقی (شامل پاس چک فاکتور تازه)', linked.map(exists), [true, true, true, true, true, true])
  eq('شیفت امروز دست‌نخورده', exists(sFresh), true)
  const after = await safe(() => maintenanceService.preview({ beforeJalali: cut }))
  eq('پیش‌نمایش بعدی: ۰ شیفت', after?.shifts, 0)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
