// نشست ۱۸۱: تست قبل/بعد خوشه M بند ۴-۲۸ الف — لایه‌ی حساب پول با BigInt.
/**
 * ===========================================================================
 * نشست ۱۸۱ · خوشه M · بند ۴-۲۸ الف
 *
 * قبل از رفع: هیچ لایه‌ی مشترکی برای جمع/مقایسه‌ی مبالغ وجود نداشت. هر یک از
 * ~۱۱٬۵۰۰ خط محاسبات مستقیم `+`، `reduce`، `Math.max/min/abs/round` می‌زد. به
 * محض تبدیل ۷۹ فیلد مالی به `BigInt`، همه‌ی این نقطه‌ها در **زمان اجرا** با
 * «Cannot mix BigInt and other types» می‌ترکند — نه در typecheck.
 *
 * انتظار بعد: `src/shared/money.ts` هر شکل ورودی را می‌پذیرد، هیچ‌وقت بی‌صدا
 * دقت از دست نمی‌دهد، و `percentOfRial` مو‌به‌مو همان چیزی را می‌دهد که
 * `Math.round(value * percent / 100)` امروز می‌دهد (تا مهاجرت هیچ ریالی را
 * جابه‌جا نکند).
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s181-money-helpers.mjs
 * ===========================================================================
 */
let pass = 0
let fail = 0
const eq = (label, got, want) => {
  const g = typeof got === 'bigint' ? `${got}n` : JSON.stringify(got)
  const w = typeof want === 'bigint' ? `${want}n` : JSON.stringify(want)
  if (g === w) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${g} · انتظار ${w}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)
/** یک فراخوانی که انتظار داریم throw کند؛ نوع خطا هم سنجیده می‌شود. */
const throws = (label, fn, ctor) => {
  try { fn(); fail++; console.log(`  ✗ ${label} · هیچ استثنایی پرتاب نشد`) }
  catch (e) {
    if (ctor && !(e instanceof ctor)) { fail++; console.log(`  ✗ ${label} · نوع خطا ${e?.constructor?.name} به‌جای ${ctor.name}`) }
    else { pass++; console.log(`  ✓ ${label}`) }
  }
}

const M = await import('../../src/shared/money.ts')

// ---------------------------------------------------------------------------
console.log('\n— ۱) مسئله‌ی اصلی: مخلوط کردن bigint و number در خود جاوااسکریپت —')
throws('جمع bigint با number استثنا می‌دهد (دلیل وجود این فایل)', () => 1n + 1, TypeError)
throws('Math.max روی bigint استثنا می‌دهد', () => Math.max(1n, 2n), TypeError)
ok('اما مقایسه‌ی bigint با number مجاز است', 2n > 1 && 1n <= 1)

// ---------------------------------------------------------------------------
console.log('\n— ۲) toRial: پذیرش هر شکل ورودی، بدون از دست رفتن دقت —')
eq('null ⇒ صفر', M.toRial(null), 0n)
eq('undefined ⇒ صفر', M.toRial(undefined), 0n)
eq('رشته‌ی خالی ⇒ صفر', M.toRial(''), 0n)
eq('number صحیح', M.toRial(1500000), 1500000n)
eq('number منفی', M.toRial(-250), -250n)
eq('bigint دست‌نخورده', M.toRial(9007199254740993n), 9007199254740993n)
eq('رشته‌ی ده‌دهی (رفت‌وبرگشت JSON بسته می‌شود)', M.toRial('9007199254740993'), 9007199254740993n)
eq('رشته با فاصله‌ی اضافه', M.toRial('  42  '), 42n)
eq('رشته‌ی علامت‌دار', M.toRial('-42'), -42n)
throws('عدد اعشاری throw می‌کند (بی‌صدا بریده نمی‌شود)', () => M.toRial(10.5), TypeError)
throws('NaN throw می‌کند', () => M.toRial(NaN), TypeError)
throws('Infinity throw می‌کند', () => M.toRial(Infinity), TypeError)
throws('رشته‌ی بی‌معنی throw می‌کند', () => M.toRial('۱۲۳ تومان'), TypeError)
throws('رشته‌ی اعشاری throw می‌کند', () => M.toRial('1.5'), TypeError)

// ---------------------------------------------------------------------------
console.log('\n— ۳) toNumberRial: به‌جای گرد کردن بی‌صدا، می‌ایستد —')
eq('مقدار امن برمی‌گردد', M.toNumberRial(1500000n), 1500000)
eq('دقیقاً روی مرز امن', M.toNumberRial(BigInt(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER)
throws('یک واحد بالاتر از مرز امن throw می‌کند', () => M.toNumberRial(BigInt(Number.MAX_SAFE_INTEGER) + 1n), RangeError)
throws('منفیِ خارج از مرز هم throw می‌کند', () => M.toNumberRial(-BigInt(Number.MAX_SAFE_INTEGER) - 1n), RangeError)
{
  // اثبات اینکه اگر throw نمی‌کرد، عدد *غلط* برمی‌گشت.
  // نکته: MAX_SAFE+1 (یعنی ۲^۵۳) هنوز دقیقاً قابل نمایش است؛ اولین عددی که
  // double نمی‌تواند نگه دارد MAX_SAFE+2 است. تست باید همان را بگیرد.
  const big = BigInt(Number.MAX_SAFE_INTEGER) + 2n
  eq('اگر با Number گرد می‌شد، مقدار غلط می‌شد', BigInt(Number(big)).toString(), '9007199254740992')
  ok('و مقدار درست چیز دیگری است', big.toString() === '9007199254740993')
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) جمع و تجمیع —')
eq('sumRial ساده', M.sumRial(100, 200n, '300'), 600n)
eq('sumRial با null در میان', M.sumRial(100, null, undefined, 50), 150n)
eq('sumRial بدون آرگومان ⇒ صفر', M.sumRial(), 0n)
eq('sumBy روی ردیف‌های گزارش', M.sumBy([{ t: 10 }, { t: 20n }, { t: null }], (r) => r.t), 30n)
eq('sumBy روی آرایه‌ی خالی ⇒ صفر', M.sumBy([], (r) => r.t), 0n)
// جهش M7 نشست ۱۸۱: `BigInt(x ?? 0)` خام هم از سه بررسی بالا رد می‌شد. sumBy باید
// دقیقاً از همان مسیر toRial برود، با همان سخت‌گیری‌ها.
eq('sumBy رشته‌ی ده‌دهی را هم می‌پذیرد', M.sumBy([{ t: '300' }, { t: ' 40 ' }], (r) => r.t), 340n)
throws('sumBy روی مقدار اعشاری throw می‌کند (نه بریدن بی‌صدا)',
  () => M.sumBy([{ t: 10.5 }], (r) => r.t), TypeError)
throws('sumBy روی رشته‌ی بی‌معنی throw می‌کند',
  () => M.sumBy([{ t: 'نامشخص' }], (r) => r.t), TypeError)
throws('sumRial روی مقدار اعشاری throw می‌کند', () => M.sumRial(1, 2.5), TypeError)
{
  // همان چیزی که یک گزارش سالانه می‌سازد: جمعی که از محدوده‌ی امن رد می‌شود.
  const rows = Array.from({ length: 10 }, () => ({ t: 1_000_000_000_000_000n }))
  eq('جمع بالای MAX_SAFE_INTEGER دقیق می‌ماند', M.sumBy(rows, (r) => r.t), 10_000_000_000_000_000n)
  ok('همین جمع با number دقت را از دست می‌داد',
    !Number.isSafeInteger(10_000_000_000_000_000))
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) مقایسه، بیشینه، کمینه، قدرمطلق —')
eq('cmpRial کوچکتر', M.cmpRial(1, 2n), -1)
eq('cmpRial بزرگتر', M.cmpRial('5', 2), 1)
eq('cmpRial برابر', M.cmpRial(2n, 2), 0)
eq('cmpRial خروجی number است (چون Array.sort عدد می‌خواهد)', typeof M.cmpRial(1, 2), 'number')
eq('مرتب‌سازی واقعی با cmpRial', [30n, 10n, 20n].sort(M.cmpRial).join(','), '10,20,30')
eq('maxRial', M.maxRial(10, 30n, '20'), 30n)
eq('maxRial خالی ⇒ صفر', M.maxRial(), 0n)
eq('maxRial با مقادیر منفی (نه صفرِ اشتباهی)', M.maxRial(-10, -30), -10n)
eq('minRial', M.minRial(10, 30n, '20'), 10n)
eq('minRial خالی ⇒ صفر', M.minRial(), 0n)
eq('minRial با مقادیر مثبت (نه صفرِ اشتباهی)', M.minRial(10, 30), 10n)
eq('absRial منفی', M.absRial(-42), 42n)
eq('absRial مثبت', M.absRial(42n), 42n)

// ---------------------------------------------------------------------------
console.log('\n— ۶) mulRial —')
eq('قیمت واحد × تعداد', M.mulRial(1500, 3), 4500n)
eq('ضرب در صفر', M.mulRial(1500, 0), 0n)
eq('ضرب مبلغ بزرگ بدون افت دقت', M.mulRial(9007199254740993n, 3), 27021597764222979n)
throws('تعداد اعشاری throw می‌کند', () => M.mulRial(100, 1.5), TypeError)

// ---------------------------------------------------------------------------
console.log('\n— ۷) percentOfRial مو‌به‌مو همان Math.round امروز است —')
/**
 * این مهم‌ترین بخش است: `BigInt` تقسیم را به سمت صفر می‌برد، ولی کد امروز
 * `Math.round` می‌زند. اگر این دو یکی نباشند، مهاجرت مرحله‌ی ۳ روی هر تخفیف
 * درصدی یک ریال اختلاف می‌سازد.
 */
eq('۹ درصد مالیات', M.percentOfRial(1000, 9), 90n)
eq('نصف دقیق به بالا گرد می‌شود (مثل Math.round(2.5)===3)', M.percentOfRial(5, 50), 3n)
eq('نصف دقیقِ منفی به سمت +∞ (مثل Math.round(-2.5)===-2)', M.percentOfRial(-5, 50), -2n)
eq('درصد اعشاری', M.percentOfRial(1000, 2.5), 25n)
eq('درصد صفر', M.percentOfRial(123456, 0), 0n)
eq('صد درصد', M.percentOfRial(123456, 100), 123456n)
throws('درصد NaN throw می‌کند', () => M.percentOfRial(100, NaN), TypeError)
{
  // مقایسه‌ی جامع با رفتار امروزی روی همه‌ی ترکیب‌های محدوده‌ی امن.
  let mismatches = 0
  let firstBad = null
  const percents = [0, 1, 2.5, 3, 5, 9, 10, 15, 33.33, 50, 66.67, 99, 100]
  for (let v = -400; v <= 400; v++) {
    for (const p of percents) {
      const legacy = Math.round((v * p) / 100)
      const next = Number(M.percentOfRial(v, p))
      if (legacy !== next && Object.is(legacy, -0) === false) {
        if (mismatches === 0) firstBad = `v=${v} p=${p} قدیم=${legacy} جدید=${next}`
        mismatches++
      }
    }
  }
  eq(`۱۰٬۴۱۳ ترکیب با Math.round یکی است${firstBad ? ` (اولین اختلاف: ${firstBad})` : ''}`, mismatches, 0)
}
{
  // و روی مبالغی که `number` اصلاً نمی‌تواند نگه دارد.
  eq('۹ درصدِ یک مبلغ بالای MAX_SAFE_INTEGER',
    M.percentOfRial(100_000_000_000_000_000n, 9), 9_000_000_000_000_000n)
}

// ---------------------------------------------------------------------------
console.log('\n— ۸) بدون رگرسیون: امروز که schema هنوز Int است، هیچ عددی عوض نمی‌شود —')
{
  const rows = [{ total: 12000 }, { total: 7500 }, { total: 0 }]
  const legacySum = rows.reduce((s, r) => s + r.total, 0)
  eq('جمع جدید با جمع قدیمی یکی است', M.toNumberRial(M.sumBy(rows, (r) => r.total)), legacySum)
  eq('maxRial با Math.max یکی است', M.toNumberRial(M.maxRial(...rows.map((r) => r.total))), Math.max(...rows.map((r) => r.total)))
  eq('absRial با Math.abs یکی است', M.toNumberRial(M.absRial(-12000)), Math.abs(-12000))
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
