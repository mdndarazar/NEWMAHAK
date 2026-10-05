/**
 * ممیزی نشست ۱۲۲ (S122-1) — تأیید رفتاری: فاکتور CANCELED/DRAFT بدون voidedAt (داده‌ی قدیمی) در
 * تب‌های رویدادی، شمارنده‌ها، دفتر رویداد و پل تطبیق. معیار: یک فیلتر، یک عدد (D56/D28).
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s122-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const { salesService } = await import(join(root, 'src/main/services/SalesService.ts'))
const { reportLimitsService } = await import(join(root, 'src/main/services/reportLimits.ts'))
const { salesLedger } = await import(join(root, 'src/main/services/SalesLedger.ts'))
const { jalaliToday, jalaliStartOfDay } = await import('@shared/jalali')
const db = harnessClient(); const seed = makeSeeder(db)
const today = jalaliToday(); const T0 = jalaliStartOfDay(today).getTime(); const now = Date.now()
const d = Math.max(60_000, now - T0); const t = (f) => T0 + Math.floor(d * f)
const A = seed.user('فروشنده')
const S = seed.insert('Shift', { name: 'صبح', number: 1, dayJalali: today, openedAt: T0 + 1000, userId: A })
const cash = seed.insert('PaymentMethod', { key: 'CASH', label: 'نقدی', kind: 'CASH', isActive: 1, sortOrder: 1 })
const chq = seed.insert('PaymentMethod', { key: 'CHEQUE', label: 'چک', kind: 'CUSTOM', isActive: 1, sortOrder: 2 })
let no = 1220
const inv = (status, total, paid, f) => seed.insert('SaleInvoice', { receiptNo: ++no, userId: A, shiftId: S, status, orderType: 'IN_STORE', grandTotal: total, goodsTotal: total, paidTotal: paid, discountTotal: 0, issuedAt: t(f), issuedAtJalali: today, deductInventory: 1 })
const pay = (invoiceId, amount, f, extra = {}) => seed.insert('Payment', { invoiceId, methodId: cash, amount, kind: 'CASH', destination: 'CASH', paidAt: t(f), paidAtJalali: today, createdAt: t(f), createdShiftId: S, createdByUserId: A, ...extra })
const cheque = (invoiceId, amount, f, no) => pay(invoiceId, amount, f, { methodId: chq, kind: 'CHEQUE', chequeNo: no, chequeStatus: 'PENDING', destination: 'MANAGER', dueDate: t(f) })
const ret = (invoiceId, amount, f) => seed.insert('SaleReturn', { invoiceId, kind: 'RETURN', userId: A, shiftId: S, returnedAt: t(f), returnedAtJalali: today, total: amount })

const L = inv('SETTLED', 1_000_000, 400_000, 0.10)        // نسیه‌ی زنده: مانده ۶۰۰٬۰۰۰
pay(L, 100_000, 0.11); cheque(L, 300_000, 0.12, 'L-1')
const X = inv('CANCELED', 5_000_000, 700_000, 0.20)       // لغوشده‌ی قدیمی بی‌voidedAt: مانده‌ی ظاهری ۴٬۳۰۰٬۰۰۰
pay(X, 200_000, 0.21); cheque(X, 500_000, 0.22, 'X-1')
const D = inv('DRAFT', 2_000_000, 0, 0.30)                // پیش‌نویس قدیمی
cheque(D, 900_000, 0.31, 'D-1')
const P = inv('SETTLED', 800_000, 800_000, 0.40); pay(P, 800_000, 0.41)
ret(P, 300_000, 0.5); ret(X, 1_000_000, 0.51); ret(D, 250_000, 0.52)

const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: String(e?.message ?? e).slice(0, 160) } } }
const arr = (r) => (Array.isArray(r) ? r : r?.rows ?? [])
const base = { fromJalali: today, toJalali: today }
const lim = async (f, key) => (await safe(() => reportLimitsService.limits(f)))?.rows?.find((r) => r.key === key)?.total

// ---- نسیه ----
const cr = await safe(() => salesService.creditList(base))
eq('نسیه: فقط فاکتور زنده (نه CANCELED/DRAFT)', arr(cr).map((r) => r.id), [L])
eq('نسیه: مانده‌ی کل ۹۰۰٬۰۰۰ (چک در انتظار دریافت نیست؛ نه با ۴٬۳۰۰٬۰۰۰ فاکتور لغوشده)', cr?.totals?.remainingTotal, 900_000)
eq('نسیه: شمارنده‌ی سقف = جدول (۱)', await lim(base, 'credit'), 1)
const crAll = await safe(() => salesService.creditList({ ...base, includeSettled: true }))
eq('نسیه + تسویه‌شده‌ها: L و P، بدون X/D', arr(crAll).map((r) => r.id).sort((a, b) => a - b), [L, P])
eq('نسیه + تسویه‌شده: شمارنده = ۲', await lim({ ...base, includeSettled: true }, 'credit'), 2)
eq('نسیه با وضعیت «لغو شده» ⇒ ۰ (D28)', arr(await safe(() => salesService.creditList({ ...base, status: 'CANCELED' }))).length, 0)
eq('نسیه با وضعیت «لغو شده»: شمارنده ۰', await lim({ ...base, status: 'CANCELED' }, 'credit'), 0)

// ---- چک ----
for (const mode of ['due', 'paid']) {
  const ch = arr(await safe(() => salesService.chequeList({ ...base, dateMode: mode })))
  eq(`چک (${mode}): فقط L-1`, ch.map((r) => r.chequeNo ?? r.number ?? r.id), ['L-1'])
  eq(`چک (${mode}): شمارنده = جدول`, await lim({ ...base, dateMode: mode }, 'cheques'), ch.length)
}
eq('چک با وضعیت «لغو شده» ⇒ ۰', arr(await safe(() => salesService.chequeList({ ...base, status: 'CANCELED' }))).length, 0)

// ---- فروش و برگشت: شمارنده = جدول ----
const rep = await safe(() => salesService.reportRows(base))
eq('سرجمع: فقط L و P', arr(rep).map((r) => r.id).sort((a, b) => a - b), [L, P])
eq('سرجمع: شمارنده‌ی فاکتور = totalCount جدول', await lim(base, 'invoices'), rep?.page?.totalCount ?? arr(rep).length)
eq('سرجمع: جمع فروش ۱٬۸۰۰٬۰۰۰', rep?.totals?.grandTotal, 1_800_000)
const rl = await safe(() => salesService.returnList(base))
eq('برگشت: فقط برگشت P (۳۰۰٬۰۰۰)', arr(rl).map((r) => r.invoiceId ?? r.id).length, 1)
eq('برگشت: شمارنده = جدول', await lim(base, 'returns'), arr(rl).length)

// ---- وضعیت صریح CANCELED (مسیر مدیریتی) ----
const repX = await safe(() => salesService.reportRows({ ...base, status: 'CANCELED' }))
eq('reportRows با status=CANCELED: همان فاکتور X', arr(repX).map((r) => r.id), [X])
eq('شمارنده‌ی فاکتور با CANCELED = ۱', await lim({ ...base, status: 'CANCELED' }, 'invoices'), 1)
eq('برگشت با وضعیت «لغو شده» ⇒ ۰ (D28)', arr(await safe(() => salesService.returnList({ ...base, status: 'CANCELED' }))).length, 0)

// ---- فهرست عمده (SalesService.list) ----
const sl = await safe(() => salesService.list(base))
eq('فهرست فاکتورها: X و D نیستند', arr(sl).map((r) => r.id).sort((a, b) => a - b), [L, P])

// ---- دفتر رویداد ----
const lg = await safe(() => salesLedger.ledger(base))
const lrows = lg?.rows ?? []
const keysOf = (pfx) => lrows.filter((r) => String(r.key).startsWith(pfx)).map((r) => r.receiptNo).sort()
eq('دفتر: ردیف فروش فقط L و P', keysOf('SALE-'), [1221, 1224])
const recNos = new Set(lrows.map((r) => r.receiptNo))
eq('دفتر: هیچ ردیفی از فاکتور X یا D (فروش/پرداخت/چک/برگشت)', [...recNos].filter((n) => n === 1222 || n === 1223), [])
const ledgerCash = lrows.reduce((s, r) => s + Number(r.cashEffect ?? 0), 0)
eq('دفتر: جمع اثر نقدی = نقد L + P (۱۰۰٬۰۰۰ + ۸۰۰٬۰۰۰)', ledgerCash, 900_000)

// ---- پل تطبیق ----
const acc = rep?.accounting
const bridge = acc?.bridge?.rows ?? []
const bv = (k) => bridge.find((r) => r.key === k)?.amount
eq('پل: وجه واقعی ۹۰۰٬۰۰۰ = اثر نقدی دفتر (بدون نقد ۲۰۰٬۰۰۰ فاکتور لغوشده)', bv('realCash'), ledgerCash)
eq('پل: نسیه‌ی وصول‌نشده ۶۰۰٬۰۰۰ (فاکتور لغوشده/پیش‌نویس بیرون)', bv('uncollectedCredit'), 600_000)
eq('بلوک چک سرجمع: ثبت‌شده ۳۰۰٬۰۰۰ (چک‌های X و D بیرون)', acc?.cheques?.registered, 300_000)
console.log('  (پل)', bridge.map((r) => `${r.key ?? r.label}:${r.amount ?? r.value}`).join(' | '))

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
