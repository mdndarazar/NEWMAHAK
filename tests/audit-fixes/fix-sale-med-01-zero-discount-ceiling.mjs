/**
 * SALE-MED-01 — صفر در maxPercent تصمیم صریح مدیر برای منع کامل تخفیف است؛
 * نباید با `|| 100` یا parse به سقف ۱۰۰٪ تبدیل شود.
 *
 * اجرا:
 * node --import ./test/harness/register.mjs tests/audit-fixes/fix-sale-med-01-zero-discount-ceiling.mjs
 */
const {
  DEFAULT_DISCOUNT_POLICY,
  parseDiscountPolicy,
  discountCeilingFor,
  wholesaleDiscountCeilingFor
} = await import('../../src/shared/priceAdjust.ts')

let ok = 0
let bad = 0
const eq = (label, got, want) => {
  if (got === want) {
    ok++
    console.log(`  ✓ ${label} = ${want}`)
  } else {
    bad++
    console.log(`  ✗ ${label} — دریافت ${got}، انتظار ${want}`)
  }
}

const retailZero = parseDiscountPolicy({ mode: 'FREE', maxPercent: 0, maxAmount: 0 })
eq('parse: سقف درصد خرده‌فروشی صفر حفظ می‌شود', retailZero.maxPercent, 0)
eq('سقف صفر خرده‌فروشی، تخفیف ۱۰۰٪ را هم رد می‌کند', discountCeilingFor(retailZero, 1_000_000), 0)
eq(
  'تابع سقف با سیاستِ مستقیمِ maxPercent=0 هم صفر می‌ماند',
  discountCeilingFor({ ...DEFAULT_DISCOUNT_POLICY, maxPercent: 0 }, 1_000_000),
  0
)

const wholesaleZero = parseDiscountPolicy({ mode: 'FREE', maxPercent: 100, wholesaleMaxPercent: 0, wholesaleMaxAmount: 0 })
eq('parse: سقف درصد عمده‌ی صفر نیز حفظ می‌شود', wholesaleZero.wholesaleMaxPercent, 0)
eq('سقف صفر عمده، تخفیف را کاملاً می‌بندد', wholesaleDiscountCeilingFor(wholesaleZero, 1_000_000), 0)

const legacy = parseDiscountPolicy({ mode: 'FREE' })
eq('تنظیمات قدیمیِ فاقد سقف همچنان ۱۰۰٪ (بی‌سقف) هستند', legacy.maxPercent, 100)
eq('تنظیمات قدیمیِ فاقد سقف عمده نیز ۱۰۰٪ هستند', legacy.wholesaleMaxPercent, 100)

console.log(`\nنتیجه SALE-MED-01: ${ok} موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
