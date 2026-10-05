// نشست ۱۸۶: دسته‌ی «۲) بالا» و «۳) متوسط» بازبینی سوم — بندهای خوشه E، ۴-۳۹، ۴-۴۸، ۴-۲۳، ۴-۱۴/۴-۵۳.
/**
 * ===========================================================================
 * نشست ۱۸۶ — شش مورد بعدی از بازبینی مستقل سوم
 *
 * ترتیب، همان اولویتی است که خودم پیشنهاد داده بودم: اول مواردی که «راه
 * دزدی» باز می‌کنند، بعد عددهای گزارش که غلط نشان می‌دهند.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s186-review-high2.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s186-'))
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
const SHIFT = readFileSync('src/main/services/ShiftService.ts', 'utf-8')
const SALES = readFileSync('src/main/services/SalesService.ts', 'utf-8')
const SHAPE = readFileSync('src/main/services/reportShape.ts', 'utf-8')
const ACCR = readFileSync('src/main/services/accountingReport.ts', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۲-۴) خوشه E: بستن نشست دیگری هیچ‌وقت بی‌رمز نیست —')
/**
 * ریشه: `assertPanelPassword` با قفلِ خاموشِ پنل «بستن صندوق» مقدار `OPEN`
 * برمی‌گرداند. یعنی نشست همکار فقط با یک دلیل سه‌حرفی بسته می‌شد و صندوقش
 * به نام شخص دیگری باز می‌شد — همان کلاس باگی که در مورد ۱-۲ هم بود.
 */
ok('نسخه‌ی معمولی دیگر در این فایل نیست', !/await assertPanelPassword\(/.test(SHIFT))
ok('تعویض اجباری کارمند، «همیشه رمز» است',
  /assertPanelPasswordStrict\(PANEL_KEYS\.cashClose, input\.managerPassword, 'تعویض اجباری کارمند نشست'\)/.test(SHIFT))
ok('نشست جامانده‌ی دیشب هم', /assertPanelPasswordStrict\(\s*\n\s*PANEL_KEYS\.cashClose,[\s\S]{0,140}بستن نشست جامانده/.test(SHIFT))
ok('و import به نسخه‌ی سخت‌گیر عوض شده', /import \{ assertManagerPassword, assertPanelPasswordStrict \}/.test(SHIFT))
{
  const { assertPanelPasswordStrict } = await import('../../src/main/services/AuthService.ts')
  let msg = null
  try { await assertPanelPasswordStrict('cash-close', '', 'تعویض اجباری') } catch (e) { msg = e.message }
  ok(`بدون رمز رد می‌شود حتی اگر قفل خاموش باشد (${String(msg).slice(0, 38)}…)`, msg && /همیشه رمز می‌خواهد/.test(msg))
}

// ---------------------------------------------------------------------------
console.log('\n— ۲-۵) بند ۴-۳۹: نوشتن روی انبار مرکزی گیت سرور دارد —')
/**
 * `upsert` مستقیم `qty` را عوض می‌کند. تا امروز فقط `toStore` گیت داشت، پس
 * یک فراخوانی مستقیم IPC موجودی انبار مرکزی را جابه‌جا می‌کرد. Audit ثبت
 * می‌شد ولی جلوگیری نمی‌شد — و بند ۴-۳۹ جلوگیری می‌خواهد.
 */
for (const [ch, what] of [
  ['secondaryStockUpsert', 'ثبت یا ویرایش ردیف انبار مرکزی'],
  ['secondaryStockDelete', 'حذف ردیف انبار مرکزی'],
  ['secondaryStockTransfer', 'انتقال بین انبارهای مرکزی'],
  ['secondaryWarehouseUpsert', 'ثبت یا ویرایش انبار مرکزی'],
  ['secondaryWarehouseDelete', 'حذف انبار مرکزی']
]) {
  const re = new RegExp(`handle\\(IPC\\.${ch},[\\s\\S]{0,260}?assertPanelUnlocked\\(PANEL_KEYS\\.secondaryStock, '${what}'\\)`)
  ok(`${ch} گیت دارد`, re.test(IPC))
}
ok('خواندن‌ها عمداً آزاد ماندند (list و history)',
  /handle\(IPC\.secondaryStockList, \(p\) =>/.test(IPC) && /handle\(IPC\.secondaryStockHistory, \(p\) =>/.test(IPC))

// ---------------------------------------------------------------------------
console.log('\n— ۳-۷) بند ۴-۳۹: واریز دستی هم گیت گرفت —')
/**
 * در نشست ۱۸۲ استدلال کردم واریز بی‌خطر است چون کسری را بزرگ‌تر نشان می‌دهد.
 * آن استدلال ناقص بود: واریزِ جعلی می‌تواند **اضافه**ی کشو را بپوشاند — اگر
 * کسی پول اضافه گذاشته تا بعداً بردارد، یک «واریز» ساختگی موجهش می‌کند.
 */
{
  const block = IPC.slice(IPC.indexOf('handle(IPC.cashboxMovementAdd'), IPC.indexOf('handle(IPC.cashboxMovementList'))
  ok('گیت بدون شرط نوع اجرا می‌شود', /await assertPanelUnlocked\(\s*\n\s*PANEL_KEYS\.cashClose,/.test(block))
  ok('و دیگر فقط برای برداشت نیست', !/if \(t === 'WITHDRAWAL' \|\| t === 'CASH_OUT' \|\| t === 'OPENING_FLOAT'\)/.test(block))
  ok('پیام واریز مخصوص خودش است', /ثبت واریز دستی به صندوق/.test(block))
  ok('و پیام برداشت هم جدا مانده', /ثبت برداشت نقدی از کشو/.test(block))
  ok('دلیلِ عوض شدن تصمیم نوشته شده', block.includes('کشو را بپوشاند'))
}

// ---------------------------------------------------------------------------
console.log('\n— ۲-۷) بند ۴-۴۸: اعتبار منقضی دیگر «فعال» شمرده نمی‌شود —')
/**
 * ریشه: هیچ مسیری وضعیت `EXPIRED` را در دیتابیس نمی‌نویسد (انقضا فقط هنگام
 * مصرف محاسبه می‌شود)، ولی گزارش روی `status` خام فیلتر می‌کرد. نتیجه:
 * ستون «منقضی» همیشه صفر و «تعهد فعال» بیشتر از واقع.
 */
ok('«فعال» شرط تاریخ دارد', /const notExpired = \{ OR: \[\{ expiresAt: null \}, \{ expiresAt: \{ gt: asOf \} \}\] \}/.test(ACCR))
ok('«منقضی» از تاریخ حساب می‌شود، نه ستون وضعیت', /const expiredSum = async \(\) =>/.test(ACCR))
ok('و وضعیت ذخیره‌شده‌ی قدیمی هم پوشش داده شده', /\{ status: StoreCreditStatus\.EXPIRED \}/.test(ACCR))
ok('مبنای «الان» بازه‌ی گزارش است، نه امروز', /const asOf = \(range && scope\.to\) \|\| new Date\(\)/.test(ACCR))
ok('گزارش از تابع تازه استفاده می‌کند', /expired: await expiredSum\(\)/.test(ACCR))
ok('و «منقضی» باقی‌مانده است نه مبلغ کل (بخش خرج‌شده نسوخته)',
  /const expiredSum[\s\S]{0,700}agg\.sum\.amount - agg\.sum\.usedAmount/.test(ACCR))

// ---------------------------------------------------------------------------
console.log('\n— ۲-۲) بند ۴-۲۳: «امروز» در خودِ کوئری هم هست —')
/**
 * در نشست ۱۸۴ `resolveReportPeriod` را درست کردم ولی `saleWhere` — که ردیف‌ها
 * و `totalCount` را می‌سازد — هیچ قید `issuedAt` نمی‌گذاشت. متای گزارش
 * «امروز» می‌گفت و ردیف‌ها کل تاریخچه بودند.
 */
ok('نبودِ تاریخ ⇒ امروز، در خودِ where', /const todayJalali = noExplicitDate && !wantsFullRange && !scopedByShift \? jalaliToday\(\) : null/.test(SALES))
ok('fullRange استثناست', /wantsFullRange/.test(SALES))
ok('فیلتر شیفت هم استثناست (بازه‌اش را از شیفت می‌گیرد)', /scopedByShift/.test(SALES))
{
  const { saleWhere } = await import('../../src/main/services/SalesService.ts')
  const { jalaliToday, jalaliStartOfDay, jalaliEndOfDay } = await import('../../src/shared/jalali.ts')
  const today = jalaliToday()

  const wNoDate = saleWhere({})
  ok('بدون تاریخ، قید issuedAt گذاشته می‌شود', !!wNoDate.issuedAt)
  eq('و شروعش اول امروز است', wNoDate.issuedAt?.gte?.getTime(), jalaliStartOfDay(today).getTime())
  eq('و پایانش آخر امروز', wNoDate.issuedAt?.lte?.getTime(), jalaliEndOfDay(today).getTime())

  const wFull = saleWhere({ fullRange: true })
  eq('با fullRange هیچ قیدی نیست', wFull.issuedAt, undefined)

  const wShift = saleWhere({ shiftId: 7 })
  eq('با فیلتر شیفت هم قید تاریخ تحمیل نمی‌شود', wShift.issuedAt, undefined)

  const wExplicit = saleWhere({ fromJalali: '۱۴۰۴/۰۱/۰۱', toJalali: '۱۴۰۴/۰۱/۳۱' })
  ok('تاریخ صریح مثل همیشه محترم است', !!wExplicit.issuedAt?.gte && !!wExplicit.issuedAt?.lte)
  ok('و با امروز فرق دارد', wExplicit.issuedAt?.gte?.getTime() !== jalaliStartOfDay(today).getTime())
}

// ---------------------------------------------------------------------------
console.log('\n— ۲-۱) بند ۴-۱۴/۴-۵۳: نشستِ فقط-وصول ردیف می‌گیرد —')
/**
 * گروه‌ها فقط از فاکتورهای بازه ساخته می‌شدند. نشستی که هیچ فروشی نداشت ولی
 * ۷۰۰٬۰۰۰ وصول نسیه داشت، اصلاً ردیف نداشت — در حالی که عددهای کل شاملش
 * بودند. جمع ردیف‌ها با جمع کل نمی‌خواند.
 */
ok('گروه‌بندی پارامتر نشست‌های فعال گرفت', /activeSessions: \{[\s\S]*?shiftId: number[\s\S]*?dayJalali: string[\s\S]*?shiftName: string/.test(SHAPE))
ok('و گزارش آن را پاس می‌دهد', /groupByDayShift\(rows, shiftMeta, activeSessions\)/.test(SALES))
ok('مبنا createdShiftId است (نشستِ ثبت پرداخت)', /createdShiftId: \{ not: null \}/.test(SALES))
ok('نشستی که فروش دارد دوباره ساخته نمی‌شود', /const missing = ids\.filter\(\(id\) => !rows\.some\(\(r\) => r\.shiftId === id\)\)/.test(SALES))
ok('خطای این بخش کل گزارش را نمی‌خواباند', /گروه‌بندی یک «کمک» است/.test(SALES))
{
  const { groupByDayShift } = await import('../../src/main/services/reportShape.ts')
  const meta = new Map([[2, { openedAt: new Date('2026-01-10T08:00:00Z'), closedAt: null }]])
  const groups = groupByDayShift([], meta, [
    { shiftId: 2, dayJalali: '۱۴۰۴/۰۷/۰۵', shiftName: 'شیفت عصر', sessionSeq: 1 }
  ])
  eq('یک گروه برای نشستِ بدون فروش ساخته شد', groups.length, 1)
  eq('نامش درست است', groups[0]?.shiftName, 'شیفت عصر')
  eq('جمع فروشش صفر است (چون فروشی نداشته)', groups[0]?.totals?.grandTotal ?? 0, 0)
  eq('و یک نشست زیرش دارد', groups[0]?.sessions?.length, 1)

  /** و نباید برای نشستی که فروش دارد، گروه تکراری بسازد. */
  const withRow = groupByDayShift(
    [
      {
        dateJalali: '۱۴۰۴/۰۷/۰۵', time: '10:00', receiptNo: 1, shiftId: 2, shiftName: 'شیفت عصر',
        shiftNumber: null, goodsTotal: 0, taxTotal: 0, serviceCharge: 0, discountTotal: 0,
        deliveryFee: 0, grandTotal: 1000, paidTotal: 1000
      }
    ],
    meta,
    [{ shiftId: 2, dayJalali: '۱۴۰۴/۰۷/۰۵', shiftName: 'شیفت عصر', sessionSeq: 1 }]
  )
  eq('گروه تکراری ساخته نمی‌شود', withRow.length, 1)
  eq('و ردیف فروشش سر جایش است', withRow[0]?.rows?.length, 1)
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
