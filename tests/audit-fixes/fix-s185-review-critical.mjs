// نشست ۱۸۵: موارد بحرانی بازبینی سوم — بند ۴-۲۶ (سقف تخفیف عمده)، بند ۴-۲۴ (مقصد نامشخص)، و مورد ۰ (لاگ typecheck).
/**
 * ===========================================================================
 * نشست ۱۸۵ — پاسخ به بازبینی مستقل سوم
 *
 * ۰) لاگ رگرسیون هیچ اثری از typecheck نداشت، پس ادعای «سبز است» از روی همان
 *    فایل قابل راستی‌آزمایی نبود. به‌علاوه بخش esbuild همان لاگ کرش می‌کرد.
 *
 * ۱-۲) گیت تخفیف عمده **عملاً خراب بود**: رمز هرگز به تابع نمی‌رسید، پس با
 *    قفل روشن هر تخفیفِ بالای آستانه رد می‌شد و با قفل خاموش هیچ گیتی نبود.
 *
 * ۱-۳) مقصد خالی از روی روش حدس زده می‌شد (نقض لفظی بند ۴-۲۴).
 *    تصمیم مالک: عدد در سبد «نامشخص» بیاید، با ستون کمکی «احتمالاً نقد» تا
 *    کسری دروغ هم ساخته نشود.
 *
 * (مورد ۱-۱ به دستور صریح مالک نادیده گرفته شد: صدور اعتبار عمداً رمز
 *  دوم/سوم را هم می‌پذیرد، چون مدیر هر وقت بخواهد آن رمزها را برمی‌دارد.)
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s185-review-critical.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s185-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

let pass = 0
let fail = 0
const show = (v) => (typeof v === 'bigint' ? `${v}n` : JSON.stringify(v))
const eq = (label, got, want) => {
  if (show(got) === show(want)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label} · دریافت ${show(got)} · انتظار ${show(want)}`) }
}
const ok = (label, cond) => eq(label, Boolean(cond), true)

const SALES = readFileSync('src/main/services/SalesService.ts', 'utf-8')
const ACC = readFileSync('src/shared/accounting.ts', 'utf-8')
const REG = readFileSync('tools/run-regression.sh', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۰) لاگ رگرسیون، خودش typecheck را ثابت می‌کند —')
/**
 * بازبینی درست گفت: ادعای «TYPECHECK_OK در لاگ است» غلط بود. حالا اسکریپت
 * خودش tsc را اجرا می‌کند و نتیجه — یا دلیل اجرا نشدن — بالای همان فایل
 * می‌نشیند. یعنی خواننده‌ی لاگ دیگر لازم نیست به حرف کسی اعتماد کند.
 */
ok('اسکریپت رگرسیون typecheck را اجرا می‌کند', /tsc --noEmit -p tsconfig\.json/.test(REG))
ok('نتیجه در همان فایل خروجی می‌نشیند', /echo "## typecheck"/.test(REG))
ok('و اگر tsc نبود، صریح «رد شد» می‌نویسد (نه سکوت)', /TYPECHECK_SKIPPED/.test(REG))
ok('حالت شکست هم چند خط خطا را نشان می‌دهد', /TYPECHECK_FAILED/.test(REG))
ok('نگهبان‌ها هم در همان لاگ‌اند', /## guards/.test(REG))
{
  /** esbuild که در لاگ قبلی کرش می‌کرد: مسیرش دیگر سخت‌کد نیست. */
  const eb = readFileSync('tools/esbuild-bundle-check.mjs', 'utf-8')
  const eb2 = readFileSync('tools/esbuild-check.mjs', 'utf-8')
  ok('esbuild دیگر به /opt/sd-artifact سخت‌کد نیست', /async function loadEsbuild/.test(eb) && /async function loadEsbuild/.test(eb2))
  ok('اول esbuild خودِ پروژه امتحان می‌شود', /\.\.\/node_modules\/esbuild\/lib\/main\.js/.test(eb))
  ok('و نبودش «رد شد» است نه کرش', /SKIPPED: esbuild در دسترس نیست/.test(eb))
}

// ---------------------------------------------------------------------------
console.log('\n— ۱-۲) بند ۴-۲۶: سقف تخفیف عمده، واقعی و غیرقابل دور زدن —')
/**
 * دو ایراد پیاده‌سازی نشست ۱۸۴ که بازبینی گرفت:
 *   • `preverifySalePolicy` فقط `{ orderType }` می‌گرفت، پس `managerPassword`
 *     همیشه `null` بود ⇒ با قفل روشن، هر تخفیفِ بالای آستانه رد می‌شد.
 *   • با قفل خاموش `assertPanelPassword` مقدار `OPEN` می‌داد ⇒ اصلاً گیتی نبود
 *     و تخفیف ۹۰٪ بی‌رمز ثبت می‌شد.
 * و مستقل از هر دو: بند ۴-۲۶ می‌گوید عبور از بازه یعنی **رد**، نه گیت رمز.
 */
ok('دیگر گیت رمز نیست', !/assertPanelPassword\(\s*\n?\s*PANEL_KEYS\.wholesaleInvoiceModule/.test(SALES))
ok('آستانه‌ی هاردکد ۵۰ حذف شد', !/WHOLESALE_APPROVAL_PERCENT/.test(SALES))
ok('سقف از سیاست تنظیمات می‌آید', /wholesaleDiscountCeilingFor\(wPolicy, wholesaleBase\)/.test(SALES))
ok('و عبور از آن رد کامل است', /throw new BusinessError\(\s*\n\s*`جمع تخفیف این فاکتور عمده/.test(SALES))
ok('پیام صریح می‌گوید با رمز مدیر دور زده نمی‌شود', /این سقف با رمز مدیر هم دور زده نمی‌شود/.test(SALES))
{
  const { wholesaleDiscountCeilingFor, DEFAULT_DISCOUNT_POLICY, parseDiscountPolicy } =
    await import('../../src/shared/priceAdjust.ts')

  /** پیش‌فرض بی‌سقف است تا به‌روزرسانی هیچ فروشگاهی را نشکند. */
  eq('پیش‌فرض: بی‌سقف', wholesaleDiscountCeilingFor(DEFAULT_DISCOUNT_POLICY, 1_000_000), 1_000_000)
  eq('و مقدار پیش‌فرض درصد ۱۰۰ است', DEFAULT_DISCOUNT_POLICY.wholesaleMaxPercent, 100)

  const p40 = { ...DEFAULT_DISCOUNT_POLICY, wholesaleMaxPercent: 40 }
  eq('سقف ۴۰٪ روی ۱٬۰۰۰٬۰۰۰', wholesaleDiscountCeilingFor(p40, 1_000_000), 400_000)
  /** سناریوی گزارش: تخفیف ۹۰٪ باید رد شود. */
  ok('تخفیف ۹۰۰٬۰۰۰ از سقف رد می‌شود', 900_000 > wholesaleDiscountCeilingFor(p40, 1_000_000))
  /** و تخفیف روزمره‌ی عمده نباید بشکند. */
  ok('تخفیف ۳۰٪ زیر سقف می‌ماند', 300_000 <= wholesaleDiscountCeilingFor(p40, 1_000_000))

  const pAmt = { ...DEFAULT_DISCOUNT_POLICY, wholesaleMaxPercent: 100, wholesaleMaxAmount: 150_000 }
  eq('سقف مبلغی هم اعمال می‌شود', wholesaleDiscountCeilingFor(pAmt, 1_000_000), 150_000)
  const pBoth = { ...DEFAULT_DISCOUNT_POLICY, wholesaleMaxPercent: 40, wholesaleMaxAmount: 150_000 }
  eq('سخت‌گیرانه‌ترین برنده است', wholesaleDiscountCeilingFor(pBoth, 1_000_000), 150_000)

  /** تنظیمات ذخیره‌شده‌ی قدیمی این کلیدها را ندارند ⇒ بی‌سقف (بدون رگرسیون). */
  const legacy = parseDiscountPolicy(JSON.stringify({ mode: 'FREE', maxPercent: 20 }))
  eq('سیاست قدیمی ⇒ عمده بی‌سقف می‌ماند', legacy.wholesaleMaxPercent, 100)
  eq('و سقف خرده‌فروشی‌اش دست‌نخورده', legacy.maxPercent, 20)
}
{
  const ui = readFileSync('src/renderer/src/pages/Settings.tsx', 'utf-8')
  ok('مدیر می‌تواند درصدش را تنظیم کند', /wholesaleMaxPercent: Math\.min\(100/.test(ui))
  ok('و سقف مبلغی‌اش را', /wholesaleMaxAmount: Math\.max\(0/.test(ui))
  ok('با توضیح اینکه رد می‌شود نه کوتاه', /رد<\/b>\s*\n?\s*می‌شود \(نه کوتاه‌کردن و نه گیت رمز\)/.test(ui))
}

// ---------------------------------------------------------------------------
console.log('\n— ۱-۳) بند ۴-۲۴: نامشخص + ستون کمکی «احتمالاً نقد» (تصمیم مالک) —')
{
  const { receiptBucketOf, unknownLikelyBucketOf } = await import('../../src/shared/accounting.ts')

  /** بخش اول خواسته: دیگر حدس زده نمی‌شود — سبد رسمی «نامشخص» است. */
  eq('نقدِ قدیمیِ بی‌مقصد ⇒ سبد نامشخص', receiptBucketOf({ isCheque: false, destination: null, methodKind: 'CASH' }), 'unknown')
  eq('کارتِ قدیمیِ بی‌مقصد ⇒ سبد نامشخص', receiptBucketOf({ isCheque: false, destination: null, methodKind: 'CARD' }), 'unknown')
  eq('ولی مقصد صریح مثل همیشه', receiptBucketOf({ isCheque: false, destination: 'CASH', methodKind: 'CASH' }), 'cash')
  eq('و کارت', receiptBucketOf({ isCheque: false, destination: 'CARD', methodKind: 'CARD' }), 'card')
  eq('چکِ بی‌مقصد هم مثل قبل نامشخص', receiptBucketOf({ isCheque: true, destination: null, methodKind: 'CASH' }), 'unknown')
  eq('اعتبار خرید دست‌نخورده', receiptBucketOf({ isCheque: false, destination: null, methodKind: 'STORE_CREDIT' }), 'storeCredit')

  /** بخش دوم خواسته: ستون کمکی، تا کسری دروغ ساخته نشود. */
  eq('«احتمالاً نقد» برای روش نقدِ بی‌مقصد', unknownLikelyBucketOf({ isCheque: false, destination: null, methodKind: 'CASH' }), 'cash')
  eq('«احتمالاً کارت» برای روش کارتِ بی‌مقصد', unknownLikelyBucketOf({ isCheque: false, destination: null, methodKind: 'CARD' }), 'card')
  eq('چک حدس نمی‌خورد (واقعاً مبهم بود)', unknownLikelyBucketOf({ isCheque: true, destination: null, methodKind: 'CASH' }), null)
  eq('وقتی مقصد هست، حدسی لازم نیست', unknownLikelyBucketOf({ isCheque: false, destination: 'CARD', methodKind: 'CASH' }), null)
}
ok('ستون کمکی در جمع پرداخت‌ها شمرده می‌شود', /out\.unknownLikelyCash = n\(out\.unknownLikelyCash\) \+ amount/.test(ACC))
ok('و زیرمجموعه است، نه ردیف جدا (با نامشخص جمع نمی‌شود)', /با `destinationUnknown` جمع \*\*نمی‌شود\*\*/.test(ACC))

console.log('\n— ۱-۳ ب) کسری دروغ ساخته نمی‌شود —')
{
  const { calculateCashClose } = await import('../../src/shared/accounting.ts')

  /**
   * سناریوی واقعی: تنها دریافتی شیفت، یک پرداخت نقدیِ قدیمیِ بی‌مقصد
   * ۲٬۰۰۰٬۰۰۰ است. کشو هم ۲٬۰۰۰٬۰۰۰ شمرده شده.
   *
   * اگر این مبلغ از `expectedCash` بیرون بیفتد، «کسری ۲٬۰۰۰٬۰۰۰» نشان داده
   * می‌شود — دقیقاً همان چیزی که مالک گفت نباید بسازیم.
   */
  const r = calculateCashClose({
    openingFloat: 0,
    cashReceived: 0,
    unknownLikelyCash: 2_000_000,
    countedCash: 2_000_000
  })
  eq('نقد مورد انتظار شامل «احتمالاً نقد» است', r.expectedCash, 2_000_000)
  eq('پس هیچ کسری دروغی ساخته نمی‌شود', r.cashDifference, 0)
  eq('و مبلغ در ستون جدای خودش هم دیده می‌شود', r.unknownLikelyCashInExpected, 2_000_000)

  /** آن‌طرفِ سکه: بدون این ستون، کسری دروغ برمی‌گشت. */
  const bad = calculateCashClose({ openingFloat: 0, cashReceived: 0, countedCash: 2_000_000 })
  eq('بدون ستون کمکی، «اضافه»ی دروغ می‌شد', bad.cashDifference, 2_000_000)

  /** چکِ بی‌مقصد همچنان بیرون از نقد مورد انتظار می‌ماند (رفع نشست ۱۶۱). */
  const chq = calculateCashClose({
    openingFloat: 0,
    cashReceived: 0,
    clearedUnknownChequeAmount: 500_000,
    countedCash: 0
  })
  eq('چکِ نامشخص وارد نقد مورد انتظار نمی‌شود', chq.expectedCash, 0)
  eq('و در ستون بیرونی خودش می‌ماند', chq.unknownDestinationOutside, 500_000)
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
