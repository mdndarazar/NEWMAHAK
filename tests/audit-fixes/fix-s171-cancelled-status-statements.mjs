/**
 * نشست ۱۷۱ · مشاهده‌ی باز AUDIT-PROGRESS ردیف ۱۲۲ (P3) · S171-D2 — مسیر صریح «وضعیت = لغو شده/پیش‌نویس»
 * روی داده‌ی قدیمی (CANCELED/DRAFT بی‌voidedAt). قبلاً با status=CANCELED پل وجه واقعی ۲۰۰٬۰۰۰، نسیه
 * ۳٬۳۰۰٬۰۰۰، چک ۵۰۰٬۰۰۰ و ۱٬۵۰۰٬۰۰۰ مانده‌ی بی‌توضیح می‌داد و دفتر ردیف فروش/برگشت فاکتور لغوشده را داشت،
 * در حالی که تب‌های نسیه/چک/برگشت ۰ بودند (D28). انتظار: صورت‌های مالی (پل، بلوک چک، دفتر) این فاکتورها را
 * رویداد مالی نمی‌شمارند (هم‌معنای تب‌ها و مسیر پیش‌فرض S122-1)، پل بسته، و مبلغ ثبت‌شده‌ی آن‌ها در هشدار
 * صریح نوشته می‌شود (پنهان نمی‌شود). فهرست فاکتورها (reportRows.rows) همچنان فاکتور لغوشده را نشان می‌دهد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s171-cancelled-status-statements.mjs
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


for (const [status, id, no, paid] of [['CANCELED', X, 1222, 700_000], ['DRAFT', D, 1223, 900_000]]) {
  console.log(`\n— وضعیت صریح ${status}`)
  const f = { ...base, status }
  const r = await safe(() => salesService.reportRows(f))
  eq(`${status}: فهرست فاکتورها همچنان همان فاکتور`, arr(r).map((x) => x.id), [id])
  const acc = r?.accounting
  const rows = acc?.bridge?.rows ?? []
  const v = (k) => Number(rows.find((x) => x.key === k)?.amount ?? 0)
  eq(`${status}: پل بسته (بی‌توضیح ۰)`, acc?.bridge?.unexplained, 0)
  eq(`${status}: وجه واقعی پل ۰ (هم‌معنای دفتر و تب‌ها)`, v('realCash'), 0)
  eq(`${status}: نسیه‌ی وصول‌نشده‌ی پل ۰ (تب نسیه ۰)`, v('uncollectedCredit'), 0)
  eq(`${status}: بلوک چک ثبت‌شده ۰ (تب چک ۰)`, Number(acc?.cheques?.registered ?? 0), 0)
  eq(`${status}: برگشت پل/تب ۰`, arr(await safe(() => salesService.returnList(f))).length, 0)
  const lg = await safe(() => salesLedger.ledger(f))
  const lr = lg?.rows ?? []
  eq(`${status}: دفتر رویداد هیچ ردیفی از فاکتور ${no} ندارد`, lr.filter((x) => x.receiptNo === no).length, 0)
  eq(`${status}: جمع اثر نقدی دفتر ۰ = وجه واقعی پل`, lr.reduce((s, x) => s + Number(x.cashEffect ?? 0), 0), v('realCash'))
  const warn = [...(r?.warnings ?? []), ...(acc?.notes ?? [])].join(' | ')
  eq(`${status}: مبلغ ثبت‌شده‌ی فاکتور بیرون از صورت‌ها در هشدار گزارش نوشته شده (${paid})`, warn.includes(String(paid)) && warn.includes('صورت'), true)
  const lwarn = [...(lg?.warnings ?? []), ...(lg?.notes ?? [])].join(' | ')
  eq(`${status}: دفتر هم هشدار صریح دارد`, lwarn.includes(String(paid)), true)
}

console.log('\n— مسیر پیش‌فرض (بدون وضعیت) دست‌نخورده')
const r0 = await safe(() => salesService.reportRows(base))
const rows0 = r0?.accounting?.bridge?.rows ?? []
eq('پیش‌فرض: وجه واقعی ۹۰۰٬۰۰۰', rows0.find((x) => x.key === 'realCash')?.amount, 900_000)
eq('پیش‌فرض: نسیه‌ی وصول‌نشده ۶۰۰٬۰۰۰', rows0.find((x) => x.key === 'uncollectedCredit')?.amount, 600_000)
eq('پیش‌فرض: هشدار «بیرون از صورت‌ها» نیست', [...(r0?.warnings ?? [])].some((w) => String(w).includes('لغوشده/پیش‌نویس')), false)

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exit(1)
