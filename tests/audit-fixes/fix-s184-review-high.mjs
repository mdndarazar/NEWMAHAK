// نشست ۱۸۴: موارد «اولویت بالا»ی بازبینی مستقل — بندهای ۴-۲۹، ۴-۴۹، ۴-۵۶، ۴-۲۱، ۴-۳۷، ۴-۲۳، ۴-۲۴، ۴-۲۶، ۴-۲۷، خوشه E.
/**
 * ===========================================================================
 * نشست ۱۸۴ — رفع ایرادهای «الف» گزارش بازبینی مستقل
 *
 * هر بخش این تست، یک مورد شماره‌دار گزارش را می‌سنجد و *ریشه*اش را توضیح
 * می‌دهد، نه فقط نتیجه را.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s184-review-high.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s184-'))
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

const IPC = readFileSync('src/main/ipc/index.ts', 'utf-8')
const SALES = readFileSync('src/main/services/SalesService.ts', 'utf-8')
const LEDGER = readFileSync('src/main/services/SalesLedger.ts', 'utf-8')
const CASHBOX = readFileSync('src/main/services/CashboxService.ts', 'utf-8')
const AUTH = readFileSync('src/main/services/AuthService.ts', 'utf-8')
const SHIFT = readFileSync('src/main/services/ShiftService.ts', 'utf-8')
const CREDIT = readFileSync('src/main/services/StoreCreditService.ts', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۱) بند ۴-۲۹: صدور اعتبار هیچ‌وقت بی‌رمز نیست —')
/**
 * ریشه: `assertPanelPassword` اگر قفل ماژول در تنظیمات خاموش باشد **بدون هیچ
 * رمزی** مقدار `'OPEN'` برمی‌گرداند. برای باز کردن یک صفحه منطقی است؛ برای
 * صدور اعتبار یعنی فروشنده می‌تواند برای خودش پول بسازد.
 */
ok('تابع «همیشه رمز» وجود دارد', /export async function assertPanelPasswordStrict/.test(AUTH))
ok('و مسیر OPEN را می‌بندد', /if \(res\.scope === 'OPEN'\)/.test(AUTH))
ok('verifyPanel پرچم force را می‌فهمد', /input\.force !== true && !isPanelLockEnabled/.test(AUTH))
for (const [label, re] of [
  ['صدور دستی اعتبار', /assertPanelPasswordStrict\(PANEL_KEYS\.creditManagement/],
  ['تولید گروهی اعتبار', /assertPanelPasswordStrict\(PANEL_KEYS\.creditBulkIssue/],
  ['ابطال/تغییر اعتبار', /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid, input\.managerPassword, input\.actionTitle\)/],
  ['حذف اعتبار', /assertPanelPasswordStrict\(PANEL_KEYS\.creditVoid, input\.managerPassword, 'حذف اعتبار خرید'\)/]
]) ok(`«${label}» از مسیر سخت‌گیرانه می‌رود`, re.test(CREDIT))
ok('بازپرداخت کامل هم همین‌طور', /assertPanelPasswordStrict\(PANEL_KEYS\.salesReturn/.test(SALES))
{
  const { assertPanelPasswordStrict } = await import('../../src/main/services/AuthService.ts')
  let msg = null
  try { await assertPanelPasswordStrict('credit-management', '', 'صدور اعتبار') } catch (e) { msg = e.message }
  ok(`بدون رمز رد می‌شود (${String(msg).slice(0, 44)}…)`, msg && /همیشه رمز می‌خواهد/.test(msg))
}

// ---------------------------------------------------------------------------
console.log('\n— ۲) settings:get دیگر هر کلیدی را خام نمی‌دهد —')
/** با `{key:'manager.auth'}` نمک و هش scrypt رمز مدیر برمی‌گشت. */
ok('allowlist خواندن وجود دارد', /RAW_SETTING_READABLE_KEYS/.test(IPC))
ok('و fail-closed است', /if \(!RAW_SETTING_READABLE_KEYS\.has\(key\)\)/.test(IPC))
{
  const block = IPC.slice(IPC.indexOf('const RAW_SETTING_READABLE_KEYS'), IPC.indexOf('async function setRawSetting'))
  ok('هش رمز مدیر در فهرست مجاز نیست', !/managerAuth/.test(block))
  ok('رمزهای دوم/سوم هم نه', !/panelAuth/.test(block))
}

// ---------------------------------------------------------------------------
console.log('\n— ۳) بند ۴-۴۹: مابه‌التفاوت کارتی، نقد کشو نیست —')
/**
 * ریشه: `exchangeSettlement` برای هر پرداختی (نقد یا کارت) مقدارش `CASH` است،
 * چون معنایش «مشتری پرداخت کرد» است نه «با چه چیزی». دفتر رویداد از همان
 * می‌خواند ⇒ تعویض کارتی +۴۰۰٬۰۰۰ نقد کشو می‌گرفت، در حالی که صورت حساب
 * همان را کارت می‌شمرد.
 */
ok('دفتر رویداد پرداخت‌های سند تعویض را می‌خواند', /payments: \{\s*\n\s*where: \{ voidedAt: null \}/.test(LEDGER))
ok('و با همان محمول مشترک drawerCash', /exDrawerCash[\s\S]{0,200}filter\(drawerCash\)/.test(LEDGER))
ok('exchangeCashEffect آرگومان مقصد واقعی می‌گیرد', /drawerCashOfExchange: number \| null/.test(LEDGER))
ok('و برای diff>0 اولویت با آن است', /if \(drawerCashOfExchange != null\) return Math\.min\(diff/.test(LEDGER))
ok('داده‌ی قدیمیِ بدون سند تعویض، رفتار قبلی را دارد',
  /return settlement === ExchangeSettlement\.CASH \? diff : 0/.test(LEDGER))

// ---------------------------------------------------------------------------
console.log('\n— ۴) بند ۴-۵۶: «اختلاف» جزئیات شیفت، کسری دروغ نمی‌سازد —')
/**
 * ریشه: `countedTotal − (نقد + کارت + اعتباری)` فروش کارتی را از پول فیزیکی
 * کشو کم می‌کرد. نقد ۱٬۰۰۰٬۰۰۰ + کارت ۲٬۰۰۰٬۰۰۰ با شمارش درستِ ۱٬۰۰۰٬۰۰۰ ⇒
 * «کسری ۲٬۰۰۰٬۰۰۰». همین فرمول در لیست سابقه اصلاح شده بود ولی این‌جا جا مانده بود.
 */
ok('فرمول غلط حذف شد',
  !/toRial\(session\.countedTotal\) -\s*\n?\s*\(toRial\(session\.cashTotal\)/.test(CASHBOX))
ok('از cashDifference ذخیره‌شده می‌آید', /diff:\s*\n\s*session\.reportVersion === 'session14'[\s\S]{0,120}session\.cashDifference/.test(CASHBOX))
ok('و سابقه‌های قدیمی صریحاً «محاسبه‌ناپذیر» علامت می‌خورند', /diffAvailable:/.test(CASHBOX))
ok('دو عدد جدای بند ۴-۵۶ در DTO هست', /expectedCash:/.test(CASHBOX) && /settledTotal:/.test(CASHBOX))
{
  const t = readFileSync('src/shared/types.ts', 'utf-8')
  ok('و در قرارداد تایپ', /expectedCash: number \| null/.test(t) && /settledTotal: number/.test(t))
  const ui = readFileSync('src/renderer/src/components/ShiftDetailModal.tsx', 'utf-8')
  ok('و به مدیر نمایش داده می‌شوند', /جمع تسویه‌ی فاکتورها/.test(ui) && /اختلاف کشو/.test(ui))
  ok('با برچسبی که پول کشو را از جمع فروش جدا می‌کند', /این عدد پولِ داخل کشو نیست/.test(ui))
}

// ---------------------------------------------------------------------------
console.log('\n— ۱۱) گیت‌هایی که فقط در UI بودند —')
ok('storeCredit:list حالا گیت دارد (خروجی‌اش کدِ اعتبار است)',
  /handle\(IPC\.storeCreditList,[\s\S]{0,220}assertPanelUnlocked\(CREDIT_READ_PANEL/.test(IPC))
ok('تجمیع گیت دارد', /handle\(IPC\.consolidationFinalize,[\s\S]{0,220}assertPanelUnlocked\(PANEL_KEYS\.consolidation/.test(IPC))
ok('و actor تجمیع از نشست main می‌آید', /cashboxService\.finalize\(await withSessionActor/.test(IPC))
ok('تجمیع چندروزه هم', /finalizeDays\(await withSessionActor/.test(IPC))
ok('actor بکاپ هم از نشست main', /backupService\.apply\(await withOptionalSessionActor/.test(IPC))

// ---------------------------------------------------------------------------
console.log('\n— ۹) خوشه E: نشست فراموش‌شده‌ی دیشب —')
/**
 * ریشه: `openShift()` بازه‌ی ساعتی را لحاظ می‌کند، پس نشست دیشبِ بسته‌نشده
 * `null` برمی‌گشت و `openSession` فکر می‌کرد هیچ نشستی باز نیست ⇒ بدون رمز،
 * بدون دلیل و بدون شمارش نقد، نشست تازه می‌ساخت و پول کشوی شب گم می‌شد.
 */
ok('کاشف مستقل از بازه‌ی ساعتی اضافه شد', /async anyOpenShift\(client: Client = prisma\)/.test(SHIFT))
ok('مسیر تحویل از آن استفاده می‌کند', /const initialOpen = await this\.anyOpenShift\(prisma\)/.test(SHIFT))
ok('داخل تراکنش هم همان', /const open = await this\.anyOpenShift\(tx\)/.test(SHIFT))
ok('نشست جامانده‌ی روز دیگر، دلیل اجباری می‌خواهد', /const staleOvernight =/.test(SHIFT))
ok('و رمز پنل بستن صندوق', /بستن نشست جامانده‌ی/.test(SHIFT))
ok('openShift اصلی دست‌نخورده ماند (کار روزمره نشکند)', /async openShift\(client: Client = prisma, day\?: string\)/.test(SHIFT))

// ---------------------------------------------------------------------------
console.log('\n— ۶) بند ۴-۳۷: فاکتور بدهکار اعتبار نمی‌گیرد —')
/**
 * ریشه: فقط سقف «پول دریافتی» چک می‌شد. فاکتور ۱٬۰۰۰٬۰۰۰ با پرداخت ۳۰۰٬۰۰۰ و
 * برگشت ۲۰۰٬۰۰۰ ⇒ `creditCap = ۳۰۰٬۰۰۰` پس رد نمی‌شد و کد اعتبار ۲۰۰٬۰۰۰ صادر
 * می‌شد، در حالی که مشتری ۷۰۰٬۰۰۰ بدهکار بود.
 */
ok('ورودی بدهی باقی‌مانده اضافه شد', /remainingDebt\?: number/.test(SALES))
ok('و اعتبار روی فاکتور بدهکار رد می‌شود', /method === RefundMethod\.STORE_CREDIT && remainingDebt > 0/.test(SALES))
ok('پیام، کاربر را به «بدون بازپرداخت» هدایت می‌کند', /روش «بدون بازپرداخت» را انتخاب کنید تا همین برگشت از بدهی/.test(SALES))
ok('و صدازننده بدهیِ بعد از برگشت را می‌فرستد', /remainingDebt: afterNone\.remaining/.test(SALES))

// ---------------------------------------------------------------------------
console.log('\n— ۷) بند ۴-۲۳: بازه‌ی پیش‌فرض «امروز» است —')
ok('main نبودِ تاریخ را امروز می‌فهمد', /return \{ from: jalaliStartOfDay\(today\), to: jalaliEndOfDay\(today\), source: 'today' \}/.test(SALES))
ok('و fullRange عمداً استثناست', /\(filter as \{ fullRange\?: boolean \}\)\.fullRange === true/.test(SALES))
{
  const bar = readFileSync('src/renderer/src/components/ReportFilterBar.tsx', 'utf-8')
  ok('UI هم پیش‌فرض امروز', /makeFilters = \(from = jalaliToday\(\), to = jalaliToday\(\)\)/.test(bar))
}

// ---------------------------------------------------------------------------
console.log('\n— ۸) بند ۴-۲۴: تصمیم نهایی مالک (نشست ۱۸۵) —')
/**
 * این مورد دو بار عوض شد و تاریخچه‌اش ارزش نوشتن دارد:
 *
 *   • نشست ۱۸۴ — پیشنهاد بازبینی («همیشه نامشخص») را پیاده کردم، ولی چون کل
 *     مبلغ از `expectedCash` بیرون می‌افتاد شیفت‌های قدیمی کسری دروغ نشان
 *     می‌دادند. برگرداندمش و دلیلش را نوشتم.
 *   • نشست ۱۸۵ — مالک راه سومی داد که هر دو نگرانی را حل می‌کند: عدد در سبد
 *     «نامشخص» بیاید (صداقت بند ۴-۲۴) و یک ستون کمکی «احتمالاً نقد» همان
 *     مبلغ را در نقد مورد انتظار نگه دارد (بدون کسری دروغ).
 *
 * جزئیات کامل در `fix-s185-review-critical.mjs`؛ این‌جا فقط قفل می‌شود که به
 * رفتار حدسیِ قدیمی برنگردیم.
 */
{
  const { receiptBucketOf, unknownLikelyBucketOf } = await import('../../src/shared/accounting.ts')
  eq('مقصد خالی دیگر حدس زده نمی‌شود', receiptBucketOf({ isCheque: false, destination: null, methodKind: 'CASH' }), 'unknown')
  eq('ولی ستون کمکی می‌گوید احتمالاً نقد بوده',
    unknownLikelyBucketOf({ isCheque: false, destination: null, methodKind: 'CASH' }), 'cash')
  eq('و مقصد صریح مثل همیشه', receiptBucketOf({ isCheque: false, destination: 'CARD', methodKind: 'CASH' }), 'card')
}

// ---------------------------------------------------------------------------
console.log('\n— ۱۰) بند ۴-۲۶: تخفیف عمده گیت سرور دارد —')
/** DECISIONS.md (S151-D4) خودش این را «ریسک باقی‌مانده» ثبت کرده بود. */
ok('گیت روی مسیر عمده هست', /if \(ctx\.orderType === OrderType\.WHOLESALE\) \{/.test(SALES))
/**
 * 🔴 به‌روزرسانی نشست ۱۸۵ — پیاده‌سازی نشست ۱۸۴ **خراب بود** و بازبینی گرفتش:
 * رمز اصلاً به `preverifySalePolicy` نمی‌رسید، و با قفل خاموش `OPEN` می‌شد.
 * حالا به‌جای «گیت رمز»، یک **سقف واقعی و تنظیم‌پذیر** است که عبور از آن
 * رد کامل می‌شود (بند ۴-۲۶). جزئیات در `fix-s185-review-critical.mjs`.
 */
ok('دیگر گیت رمز نیست', !/PANEL_KEYS\.wholesaleInvoiceModule/.test(SALES))
ok('آستانه‌ی هاردکد حذف شد', !/WHOLESALE_APPROVAL_PERCENT/.test(SALES))
ok('سقف از تنظیمات می‌آید', /wholesaleDiscountCeilingFor\(wPolicy, wholesaleBase\)/.test(SALES))
ok('و کاهش قیمت زیر مرجع را هم می‌شمارد', /o\.enteredPrice < o\.refPrice/.test(SALES))

// ---------------------------------------------------------------------------
console.log('\n— ۱۳) بند ۴-۲۷: ستون «برگشتی» به بازه محدود است —')
/** فروش فروردین با برگشت اردیبهشت، در گزارش فروردین هم «برگشتی ۱» نشان می‌داد. */
ok('بازه‌ی رویداد برگشت محاسبه می‌شود', /const returnedAtRange =/.test(SALES))
ok('و در شرط groupBy اعمال می‌شود', /returnedAt: returnedAtRange/.test(SALES))
ok('از همان resolveReportPeriod گزارش', /const itemPeriod = await resolveReportPeriod\(filter, where\)/.test(SALES))

// ---------------------------------------------------------------------------
console.log('\n— ۵) بند ۴-۶: باقی‌مانده روی همان بارکد، بدون رکورد جانشین —')
/**
 * تعارض ظاهری: مالک گفت «۵۰۰ نسوزد»، پرامپت گفت «رکورد جدا ساخته نشود».
 * اشتراکشان: باقی‌مانده روی همان بارکد بماند.
 */
ok('هیچ بارکد جانشینی ساخته نمی‌شود', !/remainder = await issueStoreCredit\(/.test(CREDIT))
{
  const { statusAfterRedeem, CreditStatus, remainingOf } = await import('../../src/shared/credit.ts')
  const base = { amount: 1_000_000, usedAmount: 0, multiUse: false, maxUses: 1 }
  eq('مصرف جزئی ⇒ بارکد باز می‌ماند', statusAfterRedeem({ ...base, carryRemainder: true }, 500_000), CreditStatus.PARTIALLY_USED)
  eq('مانده روی همان رکورد', remainingOf({ amount: 1_000_000, usedAmount: 500_000, status: CreditStatus.PARTIALLY_USED }), 500_000)
  eq('مصرف کامل ⇒ بسته', statusAfterRedeem({ ...base, carryRemainder: true }, 1_000_000), CreditStatus.USED)
  eq('کوپن یک‌بارمصرف ⇒ فوراً بسته', statusAfterRedeem({ ...base, carryRemainder: false }, 500_000), CreditStatus.USED)
  eq('رکورد قدیمی بدون ستون ⇒ پول حفظ می‌شود', statusAfterRedeem(base, 500_000), CreditStatus.PARTIALLY_USED)
}
ok('و رکوردهای جانشینِ گذشته عمداً دست‌نخورده می‌مانند', /دست‌نخورده\s*\n?\s*\* می‌مانند و معتبرند/.test(CREDIT))

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
