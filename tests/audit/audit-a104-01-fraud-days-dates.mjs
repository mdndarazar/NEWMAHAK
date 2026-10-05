/**
 * ممیزی نشست ۱۰۴ — FraudService.review (readAll/chunk)، CashboxService.shiftPaymentsOf، PendingRestockService، jalaliDaysBetween
 * ادعای S104 (حذف سقف‌های بی‌صدا) رفتاری سنجیده شد: ۲٬۰۰۱ برگشت و ۲٬۰۰۱ فاکتور (بیش از یک صفحه‌ی readAll) در نرخ برگشت،
 *   ۷۳۱ روز در jalaliDaysBetween.
 * A104-01 (P2): review و days() تاریخ را نمی‌سنجیدند (همان الگوی A88-01):
 *   review({fromJalali:''}) ⇒ Invalid Date ⇒ هیچ پرچمی (کسری ۵۰۰٬۰۰۰ امروز پنهان) به‌جای «امروز» (۴-۲۳)؛
 *   «۱۴۰۵/۱۳/۰۱» بی‌صدا سال بعد؛ days({fromJalali:''}) خطای انگلیسی «Invalid Jalaali year».
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const persianErr = async (label, fn) => {
  try { await fn(); bad++; console.log(`  ✗ ${label} · خطایی داده نشد`) }
  catch (e) { const m = String(e?.message ?? e); if (/[\u0600-\u06FF]/.test(m) && !/Invalid/.test(m)) { ok++; console.log(`  ✓ ${label}`) } else { bad++; console.log(`  ✗ ${label} · پیام: ${m}`) } }
}
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-a10401-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const { fraudService } = await import('../../src/main/services/FraudService.ts')
const { cashboxService } = await import('../../src/main/services/CashboxService.ts')
const { toJalaliDate, jalaliDaysBetween, jalaliAddDays } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const now = Date.now(); const today = toJalaliDate(new Date())
seed.insert('CashSession', { dayJalali: today, reportVersion: 'session14', closedAt: new Date(now - 60_000), countedTotal: 0, cashDifference: -500_000, expectedCash: 500_000 })

const shortOf = (r) => r.flags.find((x) => x.key === 'cashShortage')?.amount ?? 0
eq('کنترل: بازه‌ی امروز صریح ⇒ کسری ۵۰۰٬۰۰۰', shortOf(await fraudService.review({ fromJalali: today, toJalali: today })), 500_000)
let blank = null
try { blank = await fraudService.review({ fromJalali: '', toJalali: '' }) } catch (e) { blank = { flags: [], err: e.message } }
eq('تاریخ خالی (نوار بدون تاریخ) ⇒ «امروز»: کسری ۵۰۰٬۰۰۰ پنهان نمی‌ماند', shortOf(blank), 500_000)
eq('تاریخ خالی ⇒ period برچسب امروز', blank?.period, { fromJalali: today, toJalali: today })
await persianErr('ضدتقلب: «۱۴۰۵/۱۳/۰۱» ⇒ خطای فارسی (نه سال بعد بی‌صدا)', () => fraudService.review({ fromJalali: '1405/13/01', toJalali: '1405/13/01' }))
await persianErr('ضدتقلب: «۱۴۰۵/۰۷/۰» نیمه‌تایپ ⇒ خطای فارسی', () => fraudService.review({ fromJalali: '1405/07/0', toJalali: today }))
let d = null
try { d = await cashboxService.days({ fromJalali: '', toJalali: '' }) } catch (e) { d = { err: e.message } }
eq('تجمیع با تأخیر: تاریخ خالی ⇒ فقط امروز', (d?.days ?? []).map((x) => x.dayJalali), [today])
await persianErr('تجمیع با تأخیر: «۱۴۰۵/۱۳/۰۱» ⇒ خطای فارسی', () => cashboxService.days({ fromJalali: '1405/13/01', toJalali: '1405/13/02' }))

console.log('— ادعای S104 (بدون سقف بی‌صدا)')
eq('jalaliDaysBetween ۱٬۱۰۰ روز (سقف قدیمی ۷۳۰)', jalaliDaysBetween('1402/01/01', jalaliAddDays('1402/01/01', 1099)).length, 1100)
const A = seed.user('فروشنده الف')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: now - 8 * 3600_000, userId: A })
const inv = (o) => seed.insert('SaleInvoice', { userId: A, shiftId: S, orderType: 'IN_STORE', status: 'SETTLED', issuedAt: now - 3600_000, issuedAtJalali: today, discountTotal: 0, ...o, goodsTotal: o.grandTotal, paidTotal: o.grandTotal })
let I = null
for (let k = 0; k < 2000; k++) { const id = inv({ receiptNo: 10 + k, grandTotal: 1000 }); I ??= id }
inv({ receiptNo: 9, grandTotal: 2_001_000 })
for (let k = 0; k < 2001; k++) seed.insert('SaleReturn', { invoiceId: I, userId: A, shiftId: S, total: 1000, kind: 'RETURN', returnedAt: now - 1000, returnedAtJalali: today })
const r = await fraudService.review({ fromJalali: today, toJalali: today })
const src = r.flags.find((x) => x.key === 'returnRateByUser')?.sources?.find((s) => s.id === A)
eq('نرخ برگشت: جمع برگشت از همه‌ی ۲٬۰۰۱ ردیف', src?.amount, 2_001_000)
eq('نرخ برگشت: مخرج از همه‌ی ۲٬۰۰۱ فاکتور (۲٬۰۰۱٬۰۰۰ ÷ ۴٬۰۰۱٬۰۰۰ ≈ ۵۰٪)', /۲۰۰۱ برگشت · نسبت ۵۰٪/.test(src?.label ?? ''), true)
console.log(`\n${bad === 0 ? '✓' : '✗'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exitCode = bad ? 1 : 0
