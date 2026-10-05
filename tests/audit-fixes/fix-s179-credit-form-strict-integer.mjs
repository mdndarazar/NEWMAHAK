// نشست ۱۷۹: تست قبل/بعد مشاهده‌ی P3 ردیف ۱۴۳ AUDIT-PROGRESS (intOf در فرم صدور اعتبار دستی/گروهی).
/**
 * ===========================================================================
 * نشست ۱۷۹ · بند ۴-۲۸(د)، بند ۴-۲۹ (صدور دستی اعتبار) و بند ۵ («هرگز مقدار منفی را قبول نکن»)
 *
 * قبل از رفع: buildIssuePayload/buildBulkPayload همه‌ی عددها را با intOf می‌خواندند:
 *   intOf = Math.round(Number(String(v).replace(/[^\d.-]/g, '')))
 *   ⇒ «5۰۰۰۰۰» (رقم لاتین + فارسی) ⇒ ۵ ریال، بی‌صدا و ok=true؛
 *   ⇒ ۱۰۰٬۰۰۰٫۶ ⇒ ۱۰۰٬۰۰۱ (گرد بی‌صدا؛ رد اعشار سرور — نشست ۱۵۰ — هرگز دیده نمی‌شد)؛
 *   ⇒ حداقل خرید ‎-۵ ⇒ ۰ بی‌صدا؛ «۱۲۰٬۰۰۰» فارسی ⇒ خطای گمراه‌کننده‌ی «مبلغ را وارد کنید».
 * انتظار بعد: ارقام فارسی/عربی و جداکننده‌ی هزارگان درست خوانده شوند؛ اعشار، منفی، متن،
 * NaN و عدد خارج از سقف امن با پیام فارسی (نام فیلد + واحد + مقدار) رد شوند؛ فیلدی که
 * در حالت انتخاب‌شده استفاده نمی‌شود سنجیده نشود؛ intOf نمایشی دست نخورد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s179-credit-form-strict-integer.mjs
 * ===========================================================================
 */
const ui = await import('../../src/shared/creditUi.ts')
const { parseGroupedInteger } = await import('../../src/shared/jalali.ts')
const { DEFAULT_CREDIT_SETTINGS } = await import('../../src/shared/credit.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label} = ${JSON.stringify(want)}`) }
  else { bad++; console.log(`  ✗ ${label} — انتظار ${JSON.stringify(want)}، دریافت ${JSON.stringify(got)}`) }
}
const truthy = (label, v) => (v ? (ok++, console.log(`  ✓ ${label}`)) : (bad++, console.log(`  ✗ ${label}`)))
const S = DEFAULT_CREDIT_SETTINGS ?? ui.DEFAULT_CREDIT_SETTINGS
truthy('تنظیمات پیش‌فرض اعتبار در دسترس است', !!S)

const issue = (patch) => ui.buildIssuePayload({ ...ui.EMPTY_ISSUE_DRAFT, overrideReason: 'آزمایش استثنا', ...patch }, S)
const bulk = (patch) => ui.buildBulkPayload({ ...ui.EMPTY_BULK_DRAFT, overrideReason: 'آزمایش استثنا', ...patch }, S)
const rejected = (label, r, ...needles) => {
  const e = String(r?.error ?? '')
  const good = r && r.ok === false && r.payload === null && /[\u0600-\u06FF]/.test(e) && needles.every((n) => e.includes(n))
  if (good) { ok++; console.log(`  ✓ ${label} (رد: ${e.split('\n')[0].slice(0, 110)})`) }
  else { bad++; console.log(`  ✗ ${label} — ok=${r?.ok} payload=${JSON.stringify(r?.payload?.amount ?? r?.payload?.amountEach ?? null)} error=${e.slice(0, 140)}`) }
}

console.log('۱) صدور تکی — ارقام مخلوط/فارسی درست خوانده شوند (نه ۵ ریال بی‌صدا)')
{
  const r = issue({ amount: '5۰۰۰۰۰' })
  eq('«5۰۰۰۰۰» ⇒ ok', r.ok, true)
  eq('«5۰۰۰۰۰» ⇒ مبلغ ۵۰۰٬۰۰۰ (نه ۵)', r.payload?.amount, 500000)
  const r2 = issue({ amount: '۱۲۰٬۰۰۰' })
  eq('«۱۲۰٬۰۰۰» فارسی با جداکننده ⇒ ok', r2.ok, true)
  eq('«۱۲۰٬۰۰۰» ⇒ ۱۲۰٬۰۰۰', r2.payload?.amount, 120000)
  const r3 = issue({ amount: '1,250,000' })
  eq('«1,250,000» ⇒ ۱٬۲۵۰٬۰۰۰', r3.payload?.amount, 1250000)
}

console.log('۲) صدور تکی — اعشار/منفی/متن/NaN/خارج از سقف ⇒ رد فارسی با نام فیلد، نه گرد بی‌صدا')
rejected('مبلغ ۱۰۰۰۰۰٫۶ ⇒ رد (قبلاً ۱۰۰۰۰۱)', issue({ amount: 100000.6 }), 'مبلغ اعتبار', 'ریال', '100000.6')
rejected('مبلغ «۱۰۰۰۰۰٫۵» فارسی ⇒ رد', issue({ amount: '۱۰۰۰۰۰٫۵' }), 'مبلغ اعتبار')
rejected('مبلغ NaN ⇒ رد', issue({ amount: Number.NaN }), 'مبلغ اعتبار')
rejected('مبلغ ۱e21 ⇒ رد', issue({ amount: 1e21 }), 'مبلغ اعتبار')
rejected('مبلغ ۲^۵۳ (خارج از سقف امن) ⇒ رد', issue({ amount: 2 ** 53 }), 'مبلغ اعتبار')
rejected('مبلغ «۵۰۰هزار» ⇒ رد', issue({ amount: '۵۰۰هزار' }), 'مبلغ اعتبار')
rejected('مبلغ ‎-۵۰۰۰ ⇒ رد', issue({ amount: -5000 }), 'مبلغ اعتبار')
rejected('مبلغ ۰ ⇒ همان پیام «وارد کنید»', issue({ amount: 0 }), 'مبلغ اعتبار را وارد کنید')
rejected('حداقل خرید ‎-۵ ⇒ رد (قبلاً بی‌صدا ۰)', issue({ amount: 500000, minPurchase: -5 }), 'حداقل مبلغ خرید', 'ریال')
rejected('سقف هر تراکنش ۲۵۰۰٫۵ ⇒ رد (قبلاً ۲۵۰۱)', issue({ amount: 500000, maxPerTransaction: 2500.5 }), 'سقف مصرف در هر تراکنش', 'ریال')
rejected('مدت ۷٫۵ روز ⇒ رد (قبلاً ۸)', issue({ amount: 500000, expiryMode: 'days', days: 7.5 }), 'مدت اعتبار', 'روز')
rejected('دفعات ۳٫۲ ⇒ رد (قبلاً ۳)', issue({ amount: 500000, usesMode: 'count', maxUses: 3.2 }), 'تعداد دفعات', 'بار')

console.log('۳) صدور تکی — فیلدهای عددی فارسی درست به payload برسند')
{
  const r = issue({ amount: 500000, expiryMode: 'days', days: '۱۰', usesMode: 'count', maxUses: '۳', minPurchase: '۲٬۰۰۰٬۰۰۰', maxPerTransaction: '۱۰۰٬۰۰۰' })
  eq('ok', r.ok, true)
  eq('days «۱۰» ⇒ ۱۰', r.payload?.days, 10)
  eq('maxUses «۳» ⇒ ۳ (نه ۲)', r.payload?.maxUses, 3)
  eq('minPurchase «۲٬۰۰۰٬۰۰۰» ⇒ ۲٬۰۰۰٬۰۰۰', r.payload?.minPurchase, 2000000)
  eq('maxPerTransaction «۱۰۰٬۰۰۰» ⇒ ۱۰۰٬۰۰۰', r.payload?.maxPerTransaction, 100000)
}

console.log('۴) فیلد بی‌استفاده در حالت انتخاب‌شده سنجیده نشود + مسیر عادی بدون تغییر')
{
  const r = ui.buildIssuePayload({ ...ui.EMPTY_ISSUE_DRAFT, amount: 500000, days: 7.5, maxUses: 1.5 }, S)
  eq('مدت/دفعات خراب ولی حالت «پیش‌فرض/یک‌بار» ⇒ ok', r.ok, true)
  eq('بدون کلید days', 'days' in (r.payload ?? {}), false)
  eq('maxUses = ۱', r.payload?.maxUses, 1)
  eq('مبلغ عادی ۵۰۰٬۰۰۰', r.payload?.amount, 500000)
  eq('minPurchase خالی ⇒ ۰', ui.buildIssuePayload({ ...ui.EMPTY_ISSUE_DRAFT, amount: 500000, minPurchase: '' }, S).payload?.minPurchase, 0)
}

console.log('۵) تولید گروهی — تعداد/طول کد/مبلغ هر اعتبار')
{
  const r = bulk({ amount: '5۰۰۰', count: '۲۰' })
  eq('bulk «5۰۰۰» × «۲۰» ⇒ ok', r.ok, true)
  eq('amountEach ۵٬۰۰۰ (نه ۵)', r.payload?.amountEach, 5000)
  eq('count ۲۰', r.payload?.count, 20)
  rejected('bulk تعداد ۱۰٫۵ ⇒ رد (قبلاً ۱۱)', bulk({ amount: 5000, count: 10.5 }), 'تعداد اعتبار')
  rejected('bulk طول کد ۸٫۵ ⇒ رد', bulk({ amount: 5000, count: 10, codeLength: 8.5 }), 'طول کد')
  rejected('bulk مبلغ ۵۰۰۰٫۴ ⇒ رد', bulk({ amount: 5000.4, count: 10 }), 'مبلغ اعتبار')
  rejected('bulk حداقل خرید ‎-۱ ⇒ رد', bulk({ amount: 5000, count: 10, minPurchase: -1 }), 'حداقل مبلغ خرید')
  const r2 = bulk({ amount: 5000, count: 10, minPurchase: '۹٬۰۰۰', expiryMode: 'days', days: '۱۵' })
  eq('bulk minPurchase فارسی ⇒ ۹٬۰۰۰', r2.payload?.minPurchase, 9000)
  eq('bulk days فارسی ⇒ ۱۵', r2.payload?.days, 15)
}

console.log('۶) intOf نمایشی دست‌نخورده و parser تازه هم‌معنای parseGroupedInteger')
eq('intOf(«100000.6») هنوز ۱۰۰۰۰۱ (فقط نمایش)', ui.intOf('100000.6'), 100001)
truthy('parseFormInteger export شده', typeof ui.parseFormInteger === 'function')
if (typeof ui.parseFormInteger === 'function') {
  for (const v of ['', '0', '12', '۱۲۳', '٤٥٦', '5۰۰', '1,000', '۱٬۰۰۰', '1 000', '1.5', '-3', 'abc', '9007199254740993', null, undefined, 42, 4.2, Number.NaN, 1e21])
    eq(`parseFormInteger(${JSON.stringify(v)}) = parseGroupedInteger`, ui.parseFormInteger(v), parseGroupedInteger(v))
}

console.log(`\nنتیجه: ${ok} موفق، ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
