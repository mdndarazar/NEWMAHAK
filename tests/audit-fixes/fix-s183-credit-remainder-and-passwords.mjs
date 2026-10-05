// نشست ۱۸۳: دو خواسته‌ی مالک — تنظیمِ تکلیف باقی‌مانده‌ی اعتبار، و رمز دوم/سوم برای همه‌ی بخش‌ها.
/**
 * ===========================================================================
 * نشست ۱۸۳ — دو خواسته‌ی صریح مالک
 *
 * ۱) «در ماژول اعتبار خرید بتوانم تنظیم کنم که اعتبارِ برگشت/تعویض و اعتبارِ
 *    دستی، یک‌بارمصرف باشند یا باقی‌مانده‌شان قابل استفاده بماند.»
 *
 *    قبل: فقط دو حالت وجود داشت و هر دو سخت‌کدشده بودند —
 *      • `multiUse = false` ⇒ یک‌بارمصرف، ولی باقی‌مانده **همیشه** بارکد جدید
 *        می‌گرفت. یعنی «کوپن واقعاً یک‌بارمصرف» اصلاً ممکن نبود.
 *      • `multiUse = true`  ⇒ چندباره تا ته پول.
 *
 * ۲) «همه‌ی ماژول‌هایی که رمز مدیر می‌خواهند باید رمز دوم و سوم هم بگیرند.»
 *    (نشست ۱۸۳ تنظیمات را مستثنا کرده بود؛ نشست ۱۸۷ به‌دستور مالک آن استثنا
 *    را برداشت — تنظیمات هم رمز دوم/سوم می‌گیرد. این تست همان خواسته‌ی ۱۸۳
 *    را برای بقیه‌ی بخش‌ها قفل می‌کند؛ استثنای تنظیمات در fix-s187 سنجیده می‌شود.)
 *
 *    قبل: ۱۷ نقطه `assertManagerPassword` بود که **فقط** رمز مدیر می‌پذیرفت.
 *    یعنی وقتی مدیر در فروشگاه نبود، یا باید رمز اصلی‌اش را می‌داد یا کار
 *    زمین می‌ماند. و برعکس: پنل «تنظیمات» می‌توانست رمز دوم داشته باشد، در
 *    حالی که از همان‌جا می‌شود قفل بقیه را برداشت.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s183-credit-remainder-and-passwords.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s183-'))
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

// ===========================================================================
console.log('\n══ خواسته ۱: تکلیف باقی‌مانده‌ی اعتبار، تنظیماتی شد ══')

console.log('\n— ۱) تنظیمات: به‌ازای هر نوع اعتبار، جداگانه —')
{
  const { DEFAULT_CREDIT_TYPE_RULES, DEFAULT_CREDIT_SETTINGS, parseCreditSettings } =
    await import('../../src/shared/credit.ts')

  ok('نوع «برگشت/تعویض» قاعده‌ی مستقل دارد', !!DEFAULT_CREDIT_TYPE_RULES.EXCHANGE)
  ok('نوع «دستی» هم قاعده‌ی مستقل دارد', !!DEFAULT_CREDIT_TYPE_RULES.MANUAL)
  eq('پیش‌فرض برگشت/تعویض: باقی‌مانده نمی‌سوزد', DEFAULT_CREDIT_TYPE_RULES.EXCHANGE.carryRemainder, true)
  eq('پیش‌فرض دستی: باقی‌مانده نمی‌سوزد', DEFAULT_CREDIT_TYPE_RULES.MANUAL.carryRemainder, true)
  ok('و هر دو پیش‌فرض یک‌بارمصرف‌اند', !DEFAULT_CREDIT_TYPE_RULES.EXCHANGE.multiUse && !DEFAULT_CREDIT_TYPE_RULES.MANUAL.multiUse)

  /**
   * بدون رگرسیون: تنظیماتِ ذخیره‌شده‌ی قدیمی این کلید را ندارند. باید به
   * `true` بیفتند (رفتار تاریخی)، نه `false` — وگرنه با یک به‌روزرسانی، پول
   * مشتری‌های فعلی می‌سوخت.
   */
  const legacy = parseCreditSettings(
    JSON.stringify({ types: { EXCHANGE: { days: 7, maxUses: 1, multiUse: false } } })
  )
  eq('تنظیماتِ قدیمیِ بدون این کلید ⇒ باقی‌مانده حفظ می‌شود', legacy.types.EXCHANGE.carryRemainder, true)
  eq('و بقیه‌ی قواعد همان می‌مانند', legacy.types.EXCHANGE.days, 7)
}

console.log('\n— ۲) مدیر می‌تواند هر سه حالت را انتخاب کند —')
{
  const { DEFAULT_CREDIT_SETTINGS } = await import('../../src/shared/credit.ts')
  const { setTypeRule } = await import('../../src/shared/creditUi.ts')

  // حالت ۱: یک‌بارمصرف + باقی‌مانده به بارکد جدید (پیش‌فرض)
  const m1 = setTypeRule(DEFAULT_CREDIT_SETTINGS, 'EXCHANGE', { multiUse: false, carryRemainder: true })
  ok('حالت ۱ — یک‌بارمصرف، باقی‌مانده برمی‌گردد',
    m1.types.EXCHANGE.multiUse === false && m1.types.EXCHANGE.carryRemainder === true)

  // حالت ۲: چندباره تا ته پول
  const m2 = setTypeRule(DEFAULT_CREDIT_SETTINGS, 'EXCHANGE', { multiUse: true })
  eq('حالت ۲ — چندباره‌مصرف', m2.types.EXCHANGE.multiUse, true)

  // حالت ۳: کوپن واقعاً یک‌بارمصرف (تازه)
  const m3 = setTypeRule(DEFAULT_CREDIT_SETTINGS, 'EXCHANGE', { multiUse: false, carryRemainder: false })
  ok('حالت ۳ — کوپن یک‌بارمصرف، باقی‌مانده می‌سوزد',
    m3.types.EXCHANGE.multiUse === false && m3.types.EXCHANGE.carryRemainder === false)

  // تغییر یک نوع نباید نوع دیگر را لمس کند
  eq('تغییر «تعویض» روی «دستی» اثر ندارد', m3.types.MANUAL.carryRemainder, true)
}

console.log('\n— ۳) تصمیم روی خودِ بارکد اسنپ‌شات می‌شود —')
/**
 * مشتری بارکد را در جیبش دارد. اگر قاعده از تنظیماتِ *لحظه‌ی مصرف* خوانده
 * می‌شد، مدیر می‌توانست فردا تنظیم را عوض کند و پولِ کارتی که دیروز صادر شده
 * بسوزد. پس مثل `multiUse` و `maxUses`، در لحظه‌ی صدور قفل می‌شود.
 */
{
  const schema = readFileSync('prisma/schema.prisma', 'utf-8')
  ok('ستون روی مدل StoreCredit هست', /carryRemainder\s+Boolean\s+@default\(true\)/.test(schema))

  const svc = readFileSync('src/main/services/StoreCreditService.ts', 'utf-8')
  ok('در لحظه‌ی صدور ذخیره می‌شود', /carryRemainder: rules\.carryRemainder/.test(svc))
  /**
   * 🔴 به‌روزرسانی نشست ۱۸۴ — رفتاری که این تست قبلاً قفل کرده بود، خودش
   * خلاف پرامپت بود و بازبینی مستقل گرفتش.
   *
   * تا نشست ۱۸۳ باقی‌مانده با یک **بارکد جدید** به مشتری داده می‌شد. پول
   * نمی‌سوخت (خواسته‌ی مالک) ولی یک رکورد جانشین ساخته می‌شد که پرامپت
   * صریحاً منعش کرده. حالا باقی‌مانده روی همان بارکد می‌ماند: هم پول حفظ
   * می‌شود، هم رکورد جانشینی در کار نیست.
   */
  ok('دیگر هیچ بارکد جانشینی ساخته نمی‌شود', !/remainder = await issueStoreCredit\(/.test(svc))
  ok('و دلیلش در کد نوشته شده', /هیچ بارکد جانشینی/.test(svc))

  const core = readFileSync('src/shared/credit.ts', 'utf-8')
  ok('وضعیت بعد از مصرف، باقی‌مانده را باز نگه می‌دارد',
    /if \(usedAfter >= amount\) return CreditStatus\.USED\s*\n\s*return CreditStatus\.PARTIALLY_USED/.test(core))
  ok('و «کوپن یک‌بارمصرف» همچنان فوراً بسته می‌شود',
    /carryRemainder === false\) return CreditStatus\.USED/.test(core))

  const mig = readFileSync(
    'prisma/migrations/20271005100000_credit_carry_remainder/migration.sql',
    'utf-8'
  )
  ok('migration ستون را با پیش‌فرض امن اضافه می‌کند',
    /ADD COLUMN "carryRemainder" BOOLEAN NOT NULL DEFAULT true/.test(mig))
}

console.log('\n— ۴) رابط کاربری واقعاً این گزینه را می‌دهد —')
{
  const ui = readFileSync('src/renderer/src/components/CreditForms.tsx', 'utf-8')
  ok('گزینه در فرم تنظیمات هست', /carryRemainder: v/.test(ui))
  ok('و به‌ازای هر نوع رندر می‌شود (داخل map روی types)',
    ui.indexOf('Object.keys(settings.types).map') < ui.indexOf('carryRemainder: v'))
  ok('وقتی «چندباره» روشن است پنهان می‌شود (چون معنا ندارد)',
    /\{!settings\.types\[k\]\.multiUse && \(/.test(ui))
  ok('راهنمای فارسی با مثال عددی دارد', /۵۰۰٬۰۰۰/.test(ui))
}

console.log('\n— ۵) رفتار: باقی‌مانده وقتی باید بماند، می‌ماند —')
{
  /**
   * بازتولید همان مثالی که مالک گفت: اعتبار ۱٬۰۰۰٬۰۰۰، خرید ۵۰۰٬۰۰۰.
   * منطق تصمیم این‌جا بازتولید می‌شود (تابع داخلی است و export نمی‌شود)، و
   * قرارداد متنی‌اش بالا سنجیده شد.
   */
  /**
   * منطق تازه (نشست ۱۸۴): «باقی‌مانده کجا می‌رود» جایش را به «بارکد باز
   * می‌ماند یا بسته می‌شود» داده. هیچ رکورد تازه‌ای ساخته نمی‌شود.
   */
  const { statusAfterRedeem, CreditStatus, remainingOf } = await import('../../src/shared/credit.ts')

  const oneTimeCarry = { amount: 1_000_000, usedAmount: 0, multiUse: false, carryRemainder: true, maxUses: 1 }
  eq('یک‌بارمصرف + حفظ باقی‌مانده ⇒ بارکد باز می‌ماند',
    statusAfterRedeem(oneTimeCarry, 500_000), CreditStatus.PARTIALLY_USED)
  eq('و مانده‌اش ۵۰۰٬۰۰۰ است (روی همان رکورد)',
    remainingOf({ amount: 1_000_000, usedAmount: 500_000, status: CreditStatus.PARTIALLY_USED }), 500_000)
  eq('مصرف کامل ⇒ بسته می‌شود', statusAfterRedeem(oneTimeCarry, 1_000_000), CreditStatus.USED)

  const oneTimeBurn = { amount: 1_000_000, usedAmount: 0, multiUse: false, carryRemainder: false, maxUses: 1 }
  eq('کوپن یک‌بارمصرف ⇒ با یک مصرف جزئی هم بسته می‌شود',
    statusAfterRedeem(oneTimeBurn, 500_000), CreditStatus.USED)

  const legacy = { amount: 1_000_000, usedAmount: 0, multiUse: false, maxUses: 1 }
  eq('رکورد قدیمی بدون ستون ⇒ باقی‌مانده حفظ می‌شود',
    statusAfterRedeem(legacy, 500_000), CreditStatus.PARTIALLY_USED)

  const multi = { amount: 1_000_000, usedAmount: 0, multiUse: true, maxUses: 99 }
  eq('چندباره هم مثل قبل', statusAfterRedeem(multi, 500_000), CreditStatus.PARTIALLY_USED)
}

// ===========================================================================
console.log('\n══ خواسته ۲: رمز دوم و سوم برای همه‌ی بخش‌ها، جز تنظیمات ══')

console.log('\n— ۶) هر سه رمز از قبل در موتور وجود دارند —')
{
  const auth = readFileSync('src/main/services/AuthService.ts', 'utf-8')
  ok('۱) رمز مدیر', /\/\/ ۱\) رمز مدیر/.test(auth))
  ok('۲) رمز دوم اختصاصی پنل', /\/\/ ۲\) رمز دوم اختصاصی همین پنل/.test(auth))
  ok('۳) رمز سوم پنل × شیفت', /«رمز سوم» مخصوص همین پنل \*و همین شیفت\*/.test(auth))
  ok('و اولویتشان مستند است', /رمز مدیر \(همه‌ی پنل‌ها، همه‌ی شیفت‌ها\)/.test(auth))
}

console.log('\n— ۷) بخش‌های حساس حالا هر سه را می‌پذیرند —')
{
  const files = {
    'ابطال/تعلیق/تغییر اعتبار': ['src/main/services/StoreCreditService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid, input\.managerPassword, input\.actionTitle\)/],
    'حذف اعتبار': ['src/main/services/StoreCreditService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid, input\.managerPassword, 'حذف اعتبار خرید'\)/],
    'تولید گروهی اعتبار': ['src/main/services/StoreCreditService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.creditBulkIssue/],
    'صدور دستی اعتبار': ['src/main/services/StoreCreditService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.creditManagement/],
    // نشست ۱۸۶ — همچنان رمز دوم/سوم می‌پذیرد، ولی مسیر «بی‌رمز با قفل خاموش» بسته شد.
    'تعویض اجباری کارمند نشست': ['src/main/services/ShiftService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.cashClose/],
    'بازپرداخت کامل بدون کسر تخفیف': ['src/main/services/SalesService.ts', /assertPanelPasswordStrict\(PANEL_KEYS\.salesReturn, input\.managerPassword, 'بازپرداخت/]
  }
  for (const [label, [file, re]] of Object.entries(files))
    ok(`«${label}» رمز دوم/سوم می‌پذیرد`, re.test(readFileSync(file, 'utf-8')))

  /**
   * کلیدها دلبخواه نیستند: کامنت `src/shared/panels.ts` از جلسه ۲۰ دقیقاً
   * همین نگاشت را توصیه کرده بود. قرارداد از قبل نوشته شده بود، فقط کد
   * دنبالش نرفته بود.
   */
  const panels = readFileSync('src/shared/panels.ts', 'utf-8')
  ok('نگاشت کلیدها همان توصیه‌ی خودِ پروژه است', /ابطال\/تعلیق\/تغییر مبلغ\s+⇒ creditVoid/.test(panels))
}

console.log('\n— ۸) «تنظیمات» دیگر فقط-مدیر نیست (نشست ۱۸۷) —')
{
  const { MANAGER_ONLY_PANELS, isManagerOnlyPanel, PANEL_KEYS, ALWAYS_LOCKED_PANELS } =
    await import('../../src/shared/panels.ts')

  ok('فهرست «فقط مدیر» خالی است', MANAGER_ONLY_PANELS.length === 0)
  ok('تنظیمات در آن فهرست نیست', !MANAGER_ONLY_PANELS.includes(PANEL_KEYS.settings))
  ok('و helper هم تنظیمات را فقط-مدیر نمی‌داند', !isManagerOnlyPanel(PANEL_KEYS.settings))
  ok('بقیه‌ی پنل‌ها هم آزادند', !isManagerOnlyPanel(PANEL_KEYS.creditVoid) && !isManagerOnlyPanel(PANEL_KEYS.cashClose))
  /** قفلِ ورود به صفحه همچنان خاموش نمی‌شود؛ فقط *نوع* رمز بازکننده عوض شد. */
  ok('ولی قفل ورود به تنظیمات همچنان قابل خاموش کردن نیست', ALWAYS_LOCKED_PANELS.includes(PANEL_KEYS.settings))
}

console.log('\n— ۹) چه چیزی عمداً فقط رمز مدیر ماند —')
{
  /**
   * این‌ها یا خودِ «تنظیمات»‌اند یا از جنس تغییرِ تنظیمات: اگر رمز دوم
   * بپذیرند، دارنده‌ی آن رمز می‌تواند سیاست‌های کل سیستم را عوض کند.
   */
  const stillManagerOnly = [
    ['src/main/ipc/index.ts', 'تغییر تنظیم حساس'],
    ['src/main/services/SettingsService.ts', 'تغییر افست ساعت رسمی'],
    ['src/main/services/MaintenanceService.ts', 'آرشیو و پاک‌سازی داده‌های قدیمی']
  ]
  for (const [file, needle] of stillManagerOnly) {
    const src = readFileSync(file, 'utf-8')
    const i = src.indexOf(needle)
    ok(`«${needle}» هنوز فقط رمز مدیر می‌خواهد`, i > 0 && src.slice(Math.max(0, i - 220), i).includes('assertManagerPassword'))
  }
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
