/**
 * ممیزی نشست ۱۱۴ (نشت از resolveRange مشترک) — CashboxService.finalize / close / expected با تاریخ خالی/نامعتبر.
 * A114-02 (P3، گیت main، AUDIT-D46): resolveRange رشته‌ی '' را با `??` نگه می‌داشت ⇒ jalaliStartOfDay('') = سال −۱۰۰۱۰۰:
 *   • finalize({از:'' تا: امروز}) (کانال IPC مستقیم) فاکتور تجمیع‌نشده‌ی دیروز را هم در یک تجمیع بازه‌ای قطعی می‌کرد
 *     (کسر انبار قطعیِ روزی که انتخاب نشده بود)؛
 *   • close/expected بی‌شیفت با از='' کل تاریخچه را «بستن صندوق امروز» می‌کرد (فروش دیروز ۵۰۰٬۰۰۰ در جمع)؛
 *   • «۱۴۰۵/۱۳/۰۱» بی‌صدا سال بعد. عملیات مخرب پیش‌فرض بی‌صدا ندارد (D39/D42): '' یا نامعتبر یا بازه‌ی معکوس ⇒
 *     خطای فارسی؛ undefined مثل قبل = امروز؛ با نشست، تاریخ‌ها قید نیستند (بازه‌ی خود نشست).
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
// فقط خطای *تاریخ* پذیرفته است (نه «فاکتوری نیست» تصادفی)
const faErr = (e) => { if (process.env.SHOWERR) console.log('    ·', e); return !!e && /تاریخ/.test(e) && /معتبر|معکوس|خالی/.test(e) && !/Invalid|jalaali/i.test(e) }
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a11402-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate, jalaliStartOfDay, jalaliToday } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db); const sql = db.$harness.db
const today = jalaliToday()
const T0 = jalaliStartOfDay(today).getTime()
const Y = T0 - 12 * 3600_000
const A = seed.user('فروشنده الف')
sql.exec('UPDATE "Shift" SET closedAt = ' + T0)
const inv = (at, n, total) => seed.insert('SaleInvoice', { receiptNo: n, status: 'SETTLED', orderType: 'INTERNAL', grandTotal: total, paidTotal: total, goodsTotal: total, discountTotal: 0, taxTotal: 0, issuedAt: at, issuedAtJalali: toJalaliDate(new Date(at)), userId: A, deductInventory: 0 })
const yInv = inv(Y, 1, 500000)
inv(T0 + 60_000, 2, 300000)
const consolidatedOf = (id) => seed.one('SELECT consolidationId FROM "SaleInvoice" WHERE id = ?', id)?.consolidationId ?? null
const sessions = () => seed.one('SELECT COUNT(*) AS n FROM "CashSession"').n

console.log('— A114-02: close / expected بی‌نشست')
eq("expected بی‌نشست از='' ⇒ خطای فارسی (پیش‌نمایش = ثبت)", faErr(await errOf(() => cashboxService.expected({ shiftId: null, fromJalali: '', toJalali: today }))), true)
eq("close بی‌نشست از='' ⇒ خطای فارسی", faErr(await errOf(() => cashboxService.close({ fromJalali: '', toJalali: today, userId: A, closeShift: false, explicitShift: true, shiftId: null }))), true)
eq('close بی‌نشست «۱۴۰۵/۱۳/۰۱» ⇒ خطای فارسی', faErr(await errOf(() => cashboxService.close({ fromJalali: '1405/13/01', toJalali: '1405/13/01', userId: A, closeShift: false, explicitShift: true, shiftId: null }))), true)
eq('هیچ CashSession بی‌قیدی ساخته نشد', sessions(), 0)

console.log('— A114-02: finalize (تجمیع، کسر انبار قطعی)')
for (const [lbl, r] of [["از=''", { fromJalali: '', toJalali: today }], ['«۱۴۰۵/۱۳/۰۱»', { fromJalali: '1405/13/01', toJalali: '1405/13/01' }], ['بازه‌ی معکوس', { fromJalali: today, toJalali: '1400/01/01' }], ['dayJalali نامعتبر', { fromJalali: today, toJalali: today, dayJalali: '1405/0' }]]) {
  eq(`finalize ${lbl} ⇒ خطای فارسی`, faErr(await errOf(() => cashboxService.finalize(r))), true)
}
eq('فاکتور دیروز تجمیع نشده ماند', consolidatedOf(yInv), null)

console.log('— کنترل: تاریخ صریح و undefined رفتار قبلی را دارند')
const ex = await cashboxService.expected({ shiftId: null, fromJalali: today, toJalali: today })
eq('expected امروز بدون خطا', typeof ex, 'object')
let fin = null
const finErr = await errOf(async () => { fin = await cashboxService.finalize({ fromJalali: today, toJalali: today }) })
eq('finalize امروز ⇒ ۱ فاکتور (نه دیروز)', [finErr, fin?.invoiceCount ?? null, consolidatedOf(yInv)], [null, 1, null])
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
