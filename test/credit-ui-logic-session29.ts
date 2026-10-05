/**
 * سوییت منطق خالص جلسه ۲۹ — «بخش ۹» تازه‌ی `src/shared/credit.ts`.
 *
 * چرا این فایل؟ چون هر چیزی که این نشست به‌عنوان «تصمیم» اضافه کرد (فیلتر وضعیت
 * مؤثر، جابه‌جایی سطل منقضی، Transition مخصوص برگشت، تغییرناپذیری نوع، مدت
 * اعتبار تعویض، نسخه‌ی مجدد در چاپ چندنسخه‌ای، سابقه‌ی محافظت‌شده، و دامنه‌ی
 * جست‌وجو) باید *واقعاً اجرا* شود، نه فقط خوانده. در محیطی بدون npm تنها همین
 * فایل‌های `.ts` قابل اجرا هستند (`node --experimental-strip-types`).
 */
import {
  CREDIT_SEARCH_FIELDS,
  CreditStatus,
  EXPIRABLE_STATUSES,
  canReverseTransition,
  canCreditTransition,
  creditCopyPlan,
  creditSearchPlan,
  creditStatusWhere,
  exchangeCreditDays,
  isProtectedAuditRow,
  planRedemptionReversal,
  rollExpiredBuckets,
  sourceChangeError
} from '../src/shared/credit.ts'

let pass = 0
let fail = 0
const out: string[] = []
function check(title: string, fn: () => boolean): void {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e: any) {
    err = String(e?.message ?? e)
  }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err ? ' -> ' + err : ''}`)
}

const NOW = new Date('2027-10-01T00:00:00Z')

/* ---------------- §۲/§۱۱/§۱۵ — فیلتر وضعیت مؤثر ---------------- */
check('۱. فیلتر خالی هیچ شرطی نمی‌سازد (یعنی «همه»)', () => creditStatusWhere('', NOW) === null && creditStatusWhere(null, NOW) === null)
check('۲. فیلتر «منقضی» ردیف ACTIVEِ تاریخ‌گذشته را هم می‌گیرد، نه فقط ستون EXPIRED', () => {
  const w: any = creditStatusWhere(CreditStatus.EXPIRED, NOW)
  return (
    Array.isArray(w.OR) &&
    w.OR.length === 2 &&
    w.OR[0].status === CreditStatus.EXPIRED &&
    w.OR[1].expiresAt.lte === NOW &&
    EXPIRABLE_STATUSES.every((s) => w.OR[1].status.in.includes(s))
  )
})
check('۳. فیلتر «مصرف‌نشده» ردیف تاریخ‌گذشته را *بیرون* می‌گذارد', () => {
  const w: any = creditStatusWhere(CreditStatus.ACTIVE, NOW)
  return w.status === CreditStatus.ACTIVE && w.OR[0].expiresAt === null && w.OR[1].expiresAt.gt === NOW
})
check('۴. وضعیت‌های پایانی (باطل/مصرف‌شده) هیچ شرط تاریخی نمی‌گیرند', () => {
  const a: any = creditStatusWhere(CreditStatus.CANCELED, NOW)
  const b: any = creditStatusWhere(CreditStatus.USED, NOW)
  return a.status === CreditStatus.CANCELED && !a.OR && b.status === CreditStatus.USED && !b.OR
})
check('۵. حروف کوچک/فاصله هم پذیرفته می‌شود', () => (creditStatusWhere(' active ', NOW) as any).status === CreditStatus.ACTIVE)

/* ---------------- §۲/§۱۵ — جابه‌جایی سطل منقضی در داشبورد ---------------- */
const ALL = [
  { status: CreditStatus.ACTIVE, count: 10, amount: 1000, usedAmount: 100 },
  { status: CreditStatus.PARTIALLY_USED, count: 4, amount: 400, usedAmount: 200 },
  { status: CreditStatus.USED, count: 3, amount: 300, usedAmount: 300 }
]
const EXPIRING = [
  { status: CreditStatus.ACTIVE, count: 3, amount: 300, usedAmount: 30 },
  { status: CreditStatus.PARTIALLY_USED, count: 1, amount: 100, usedAmount: 50 }
]
check('۶. تعداد ACTIVE بعد از جابه‌جایی کم می‌شود و سطل EXPIRED ساخته می‌شود', () => {
  const r = rollExpiredBuckets(ALL, EXPIRING)
  const active = r.find((b) => b.status === CreditStatus.ACTIVE)!
  const expired = r.find((b) => b.status === CreditStatus.EXPIRED)!
  return active.count === 7 && expired.count === 4 && expired.amount === 400 && expired.usedAmount === 80
})
check('۷. جمع کل تعداد و مبلغ عوض نمی‌شود (فقط جای سطل)', () => {
  const before = ALL.reduce((s, b) => s + b.count, 0)
  const afterRows = rollExpiredBuckets(ALL, EXPIRING)
  const after = afterRows.reduce((s, b) => s + b.count, 0)
  const amtBefore = ALL.reduce((s, b) => s + b.amount, 0)
  const amtAfter = afterRows.reduce((s, b) => s + b.amount, 0)
  return before === after && amtBefore === amtAfter
})
check('۸. وضعیت‌های غیرقابل‌انقضا (مصرف‌شده) هرگز جابه‌جا نمی‌شوند', () => {
  const r = rollExpiredBuckets(ALL, [{ status: CreditStatus.USED, count: 3, amount: 300, usedAmount: 300 }])
  return r.find((b) => b.status === CreditStatus.USED)!.count === 3 && !r.find((b) => b.status === CreditStatus.EXPIRED)
})
check('۹. بدون ردیف منقضی، خروجی همان ورودی است', () => {
  const r = rollExpiredBuckets(ALL, [])
  return r.length === 3 && r[0].status === CreditStatus.ACTIVE
})

/* ---------------- §۱۱ — Transition مخصوص «برگشت مصرف» ---------------- */
check('۱۰. «مصرف‌شده ⇒ فعال» در جدول عادی ممنوع است ولی در برگشت مجاز', () =>
  canCreditTransition(CreditStatus.USED, CreditStatus.ACTIVE) === false &&
  canReverseTransition(CreditStatus.USED, CreditStatus.ACTIVE) === true)
check('۱۱. «باطل» پایانی است؛ برگشت فاکتور هم زنده‌اش نمی‌کند', () =>
  canReverseTransition(CreditStatus.CANCELED, CreditStatus.ACTIVE) === false)
check('۱۲. برگشت یک مصرف روی اعتبار یک‌بارمصرف: مبلغ و دفعات و وضعیت هر سه برمی‌گردند', () => {
  const p = planRedemptionReversal(
    { amount: 500_000, usedAmount: 500_000, usedCount: 1, status: CreditStatus.USED, expiresAt: null },
    500_000,
    NOW
  )
  return p.usedAmount === 0 && p.usedCount === 0 && p.status === CreditStatus.ACTIVE && p.blocked === null
})
check('۱۳. برگشت یکی از دو مصرف ⇒ «مصرف بخشی» می‌ماند', () => {
  const p = planRedemptionReversal(
    { amount: 500_000, usedAmount: 300_000, usedCount: 2, status: CreditStatus.USED, multiUse: true, expiresAt: null },
    100_000,
    NOW
  )
  return p.usedAmount === 200_000 && p.usedCount === 1 && p.status === CreditStatus.PARTIALLY_USED
})
check('۱۴. اعتبار تاریخ‌گذشته بعد از برگشت «منقضی» می‌شود، نه «فعال»', () => {
  const p = planRedemptionReversal(
    { amount: 100, usedAmount: 100, usedCount: 1, status: CreditStatus.USED, expiresAt: new Date('2027-09-01T00:00:00Z') },
    100,
    NOW
  )
  return p.status === CreditStatus.EXPIRED && p.blocked === null
})
check('۱۵. اعتبار باطل‌شده: مبلغ برمی‌گردد ولی وضعیت دست‌نخورده می‌ماند و دلیلش ثبت می‌شود', () => {
  const p = planRedemptionReversal(
    { amount: 100, usedAmount: 100, usedCount: 1, status: CreditStatus.CANCELED, expiresAt: null },
    100,
    NOW
  )
  return p.usedAmount === 0 && p.status === CreditStatus.CANCELED && !!p.blocked && p.proposed === CreditStatus.ACTIVE
})
check('۱۶. اعتبار معلق با برگشت فاکتور از تعلیق در نمی‌آید', () => {
  const p = planRedemptionReversal(
    { amount: 100, usedAmount: 100, usedCount: 1, status: CreditStatus.SUSPENDED, expiresAt: null },
    100,
    NOW
  )
  return p.status === CreditStatus.SUSPENDED && !!p.blocked
})
check('۱۷. مبلغ و دفعات هیچ‌وقت منفی نمی‌شوند', () => {
  const p = planRedemptionReversal({ amount: 100, usedAmount: 50, usedCount: 0, status: CreditStatus.ACTIVE }, 999, NOW)
  return p.usedAmount === 0 && p.usedCount === 0
})

/* ---------------- §۱۹ — تغییرناپذیری نوع اعتبار ---------------- */
check('۱۸. نوع یکسان یا خالی خطا نمی‌دهد', () =>
  sourceChangeError('MANUAL', 'MANUAL') === null && sourceChangeError('MANUAL', undefined) === null && sourceChangeError('MANUAL', '') === null)
check('۱۹. تغییر MANUAL ⇒ EXCHANGE با پیام فارسی رد می‌شود', () => {
  const m = sourceChangeError('MANUAL', 'EXCHANGE')
  return typeof m === 'string' && m.includes('قابل تغییر نیست')
})
check('۲۰. تغییر EXCHANGE ⇒ MANUAL هم رد می‌شود (تقارن کامل)', () => sourceChangeError('EXCHANGE', 'MANUAL') !== null)

/* ---------------- §۳ — مدت اعتبار مسیر تعویض/برگشت ---------------- */
check('۲۱. مقدار صریح تراکنش بر همه‌چیز مقدم است', () =>
  exchangeCreditDays({ explicit: 45, exchangeDays: 7, returnCodeDays: 3 }) === 45)
check('۲۲. «بدون انقضا»ی صریح (null) حفظ می‌شود', () =>
  exchangeCreditDays({ explicit: null, exchangeDays: 7, returnCodeDays: 3 }) === null)
check('۲۳. بدون مقدار صریح، تنظیمات EXCHANGE مرجع است (⇒ undefined تا resolveRules بخواند)', () =>
  exchangeCreditDays({ exchangeDays: 7, returnCodeDays: 3 }) === undefined)
check('۲۴. EXCHANGE.days = 0 («بدون انقضا» در تنظیمات) هم به returnCodeDays برنمی‌گردد', () =>
  exchangeCreditDays({ exchangeDays: 0, returnCodeDays: 3 }) === undefined)
check('۲۵. فقط اگر تنظیمات خوانده نشد، عدد قدیمی کد برگشت جایگزین می‌شود', () =>
  exchangeCreditDays({ exchangeDays: null as any, returnCodeDays: 3 }) === 3)

/* ---------------- §۱۳ — نسخه‌ی مجدد در چاپ چندنسخه‌ای ---------------- */
check('۲۶. چاپ اول یک اعتبار چاپ‌نشده: «اصل»', () => {
  const p = creditCopyPlan(0, 1)
  return p.length === 1 && p[0].printCount === 1 && p[0].reprint === false
})
check('۲۷. سه نسخه‌ی یک اعتبار چاپ‌نشده: کاغذ اول اصل، دوم و سوم «نسخه‌ی مجدد»', () => {
  const p = creditCopyPlan(0, 3)
  return p.length === 3 && p.map((x) => x.reprint).join(',') === 'false,true,true' && p[2].printCount === 3
})
check('۲۸. اعتباری که قبلاً چاپ شده، از همان اولین کاغذ «نسخه‌ی مجدد» است', () => {
  const p = creditCopyPlan(2, 2)
  return p[0].reprint === true && p[0].printCount === 3 && p[1].printCount === 4
})
check('۲۹. تعداد نسخه کلمپ می‌شود (۰ ⇒ ۱، ۹۹ ⇒ سقف)', () =>
  creditCopyPlan(0, 0).length === 1 && creditCopyPlan(0, 99).length === 5)

/* ---------------- §۱۰ — سابقه‌ی محافظت‌شده در پاک‌سازی ---------------- */
check('۳۰. ردیف‌های AuditLog اعتبار خرید محافظت‌شده‌اند', () =>
  isProtectedAuditRow('StoreCredit', 'ANY') === true &&
  isProtectedAuditRow('StoreCreditBatch', 'ANY') === true &&
  isProtectedAuditRow('StoreCreditRedemption', 'ANY') === true)
check('۳۱. action های اعتبار هم مستقل از entity محافظت می‌شوند', () =>
  isProtectedAuditRow('SaleInvoice', 'CREDIT_REDEEM_BLOCKED') === true &&
  isProtectedAuditRow('SaleReturn', 'STORE_CREDIT_ISSUE') === true)
check('۳۲. بقیه‌ی سابقه‌ها همان‌طور قابل پاک‌سازی می‌مانند (سبک‌سازی نمی‌شکند)', () =>
  isProtectedAuditRow('SaleInvoice', 'DELETE') === false && isProtectedAuditRow('Database', 'DATA_ARCHIVE_PURGE') === false)

/* ---------------- §۱۶ — دامنه‌ی جست‌وجو ---------------- */
check('۳۳. عبارت عددی، شناسه‌ی اعتبار و شماره مشتری و شماره فاکتور/فیش را فعال می‌کند', () => {
  const p = creditSearchPlan('1024')
  return p.numeric === 1024 && ['id', 'customerId', 'receiptNo'].every((f) => p.fields.includes(f))
})
check('۳۴. ارقام فارسی هم عدد فهمیده می‌شوند', () => creditSearchPlan('۱۰۲۴').numeric === 1024)
check('۳۵. عبارت حرفی عدد نمی‌سازد ولی کد و متن آزاد را فعال می‌کند', () => {
  const p = creditSearchPlan('AB12CD')
  return p.numeric === null && p.code === 'AB12CD' && p.fields.includes('customerName') && !p.fields.includes('id')
})
check('۳۶. نام فارسی مشتری: بدون کد عددی، فقط فیلدهای متنی', () => {
  const p = creditSearchPlan('رضا محمدی')
  return p.numeric === null && p.fields.includes('holderCompany') && p.fields.includes('note')
})
check('۳۷. عبارت خالی هیچ فیلدی را فعال نمی‌کند', () => creditSearchPlan('   ').fields.length === 0)
check('۳۸. فهرست رسمی فیلدهای جست‌وجو همان چیزی است که placeholder وعده می‌دهد', () =>
  ['code', 'id', 'customerId', 'receiptNo', 'holderNationalId'].every((f) => CREDIT_SEARCH_FIELDS.includes(f)))

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 29): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
