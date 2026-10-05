/**
 * سوییت منطق خالص «مدیریت اعتبار خرید» (§۲۳).
 *
 * چرا یک فایل TS جدا و نه داخل harness؟ چون `src/shared/credit.ts` هیچ وابستگی
 * بیرونی ندارد (نه Prisma، نه Electron، نه node_modules)، پس *واقعاً* قابل اجرا
 * است — با `node --experimental-strip-types`. یعنی این بخش از تست‌ها STRUCTURAL
 * نیست، واقعاً اجرا می‌شود و قواعد را می‌سنجد.
 */
import {
  CreditStatus,
  CreditRestrictScope,
  DEFAULT_CREDIT_SETTINGS,
  assessCodeSpace,
  canCreditTransition,
  codeCapacity,
  creditAlphabet,
  decideRedeem,
  describeCreditSettings,
  effectiveStatus,
  evaluateEligibility,
  fillPlaceholders,
  normalizeCreditCode,
  normalizeCreditPrefix,
  normalizeCreditSource,
  parseCreditSettings,
  parseIdList,
  reminderDecision,
  remainingOf,
  statusAfterRedeem,
  usesLeftOf
} from '../src/shared/credit.ts'

let pass = 0
let fail = 0
const lines: string[] = []
function t(id: string, title: string, fn: () => boolean): void {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e) {
    ok = false
    err = String((e as Error)?.message ?? e)
  }
  if (ok) pass++
  else fail++
  lines.push(`${ok ? 'PASS' : 'FAIL'}  [REAL] ${id}. ${title}${err ? ' -> ' + err : ''}`)
}

const DAY = 86400000
const now = new Date('2027-09-22T10:00:00Z').getTime()
const base = {
  id: 1,
  code: 'CR12ABCD',
  amount: 1_000_000,
  usedAmount: 0,
  usedCount: 0,
  maxUses: 1,
  multiUse: false,
  status: CreditStatus.ACTIVE,
  expiresAt: new Date(now + 10 * DAY)
}

// ---------------- ۱) وضعیت‌ها و Status Machine ----------------
t('L1', 'اعتبارِ تاریخ‌گذشته، حتی با ستون ACTIVE، «منقضی» است', () =>
  effectiveStatus({ ...base, expiresAt: new Date(now - DAY) }, now) === CreditStatus.EXPIRED)
t('L2', 'باطل وضعیت پایانی است (هیچ Transition خروجی ندارد)', () =>
  !canCreditTransition(CreditStatus.CANCELED, CreditStatus.ACTIVE) &&
  !canCreditTransition(CreditStatus.CANCELED, CreditStatus.USED))
t('L3', 'مصرف‌شده فقط با ابطال از وضعیتش خارج می‌شود', () =>
  canCreditTransition(CreditStatus.USED, CreditStatus.CANCELED) &&
  !canCreditTransition(CreditStatus.USED, CreditStatus.ACTIVE))

// ---------------- ۲) یک‌بارمصرف در برابر چندباره (§۴) ----------------
/**
 * 🔴 به‌روزرسانی نشست ۱۸۴ · بند ۴-۶ — این قاعده عوض شد، عمداً.
 *
 * قبلاً مصرف جزئیِ یک اعتبار یک‌بارمصرف سند را می‌بست و باقی‌مانده با یک
 * **بارکد جدید** به مشتری داده می‌شد. پرامپت ساخت آن رکورد جانشین را منع
 * کرده و مالک هم گفته پول مشتری نباید بسوزد. اشتراکشان: باقی‌مانده روی همان
 * بارکد بماند.
 *
 * حالت «کوپن واقعاً یک‌بارمصرف» هم از دست نرفت: با `carryRemainder: false`
 * همان رفتار قبلی برمی‌گردد (L4-الف).
 */
t('L4', 'یک‌بارمصرف: مصرف جزئی بارکد را باز نگه می‌دارد (باقی‌مانده روی همان سند)', () =>
  statusAfterRedeem(base, 300_000) === CreditStatus.PARTIALLY_USED)
t('L4-الف', 'کوپن یک‌بارمصرف (carryRemainder=false): مصرف جزئی هم می‌بندد', () =>
  statusAfterRedeem({ ...base, carryRemainder: false }, 300_000) === CreditStatus.USED)
t('L4-ب', 'یک‌بارمصرف: مصرف کامل می‌بندد', () =>
  statusAfterRedeem(base, base.amount) === CreditStatus.USED)
t('L5', 'چندباره: مصرف جزئی ⇒ PARTIALLY_USED', () =>
  statusAfterRedeem({ ...base, multiUse: true, maxUses: 3 }, 300_000) === CreditStatus.PARTIALLY_USED)
t('L6', 'چندباره: تمام شدن مبلغ ⇒ بسته', () =>
  statusAfterRedeem({ ...base, multiUse: true, maxUses: 3 }, 1_000_000) === CreditStatus.USED)
t('L7', 'چندباره: تمام شدن دفعات ⇒ بسته (حتی با مبلغ باقی‌مانده)', () =>
  statusAfterRedeem({ ...base, multiUse: true, maxUses: 2, usedCount: 1, usedAmount: 100 }, 100) === CreditStatus.USED)
t('L8', 'باقی‌مانده و دفعات باقی‌مانده هیچ‌وقت منفی نمی‌شوند', () =>
  remainingOf({ ...base, usedAmount: 5_000_000 }) === 0 && usesLeftOf({ ...base, usedCount: 9 }) === 0)

// ---------------- ۳) decideRedeem: همه‌ی شرط‌ها با هم (§۴) ----------------
t('L9', 'منقضی ⇒ رد با پیام فارسی', () => {
  const d = decideRedeem({ ...base, expiresAt: new Date(now - DAY) }, { applicable: 500_000, now })
  return !d.ok && /مهلت/.test(String(d.error))
})
t('L10', 'باطل ⇒ رد', () => !decideRedeem({ ...base, status: CreditStatus.CANCELED }, { applicable: 1, now }).ok)
t('L11', 'معلق ⇒ رد', () => !decideRedeem({ ...base, status: CreditStatus.SUSPENDED }, { applicable: 1, now }).ok)
t('L12', 'دفعات تمام‌شده ⇒ رد (حتی با باقی‌ماندهٔ مبلغ)', () => {
  const d = decideRedeem({ ...base, multiUse: true, maxUses: 2, usedCount: 2, usedAmount: 10 }, { applicable: 900_000, now })
  return !d.ok && /دفعات/.test(String(d.error))
})
t('L13', 'مصرف بیشتر از باقی‌مانده ممکن نیست (سقف = باقی‌مانده)', () => {
  const d = decideRedeem({ ...base, multiUse: true, maxUses: 3, usedAmount: 700_000 }, { applicable: 999_999_999, now })
  return d.ok && d.applied === 300_000
})
t('L14', 'سقف هر تراکنش رعایت می‌شود', () => {
  const d = decideRedeem({ ...base, maxPerTransaction: 200_000 }, { applicable: 900_000, now })
  return d.ok && d.applied === 200_000 && d.notes.length > 0
})
t('L15', 'حداقل مبلغ خرید ⇒ رد با عدد صریح', () => {
  const d = decideRedeem({ ...base, minPurchase: 500_000 }, { applicable: 100_000, invoiceTotal: 100_000, now })
  return !d.ok && /حداقل مبلغ خرید/.test(String(d.error))
})
t('L16', 'قفل مشتری ⇒ فقط همان مشتری', () => {
  const c = { ...base, customerLocked: true, customerId: 7 }
  return !decideRedeem(c, { applicable: 100, customerId: 9, now }).ok && decideRedeem(c, { applicable: 100, customerId: 7, now }).ok
})
t('L17', 'مبلغ درخواستی بیشتر از سقف ⇒ رد (UI نمی‌تواند عدد بزرگ‌تر بفرستد)', () => {
  const d = decideRedeem(base, { applicable: 400_000, requested: 900_000, now })
  return !d.ok && /درخواستی/.test(String(d.error))
})
t('L18', 'مبلغ درخواستی معتبر ⇒ همان عدد (پرداخت ترکیبی)', () => {
  const d = decideRedeem(base, { applicable: 900_000, requested: 250_000, now })
  return d.ok && d.applied === 250_000
})
t('L19', 'فاکتور بدون باقی‌مانده ⇒ اعتبار دست‌نخورده می‌ماند', () => !decideRedeem(base, { applicable: 0, now }).ok)

// ---------------- ۴) محدودیت کالا/دسته (§۱۸) ----------------
const lines3 = [
  { variantId: 11, categoryId: 5, categoryPath: [5, 2], lineTotal: 300_000 },
  { variantId: 12, categoryId: 6, categoryPath: [6, 3], lineTotal: 400_000 },
  { variantId: 13, categoryId: 7, categoryPath: [7, 2], lineTotal: 100_000 }
]
t('L20', 'محدود به دسته: دسته‌ی *والد* زیرشاخه‌ها را هم می‌پوشاند', () => {
  const e = evaluateEligibility(
    { ...base, restrictScope: CreditRestrictScope.CATEGORY, restrictCategoryIdsJson: '[2]' },
    lines3
  )
  return e.restricted && e.eligibleTotal === 400_000 && e.eligibleVariantIds.join(',') === '11,13'
})
t('L21', 'محدود به کالا: فقط همان واریانت‌ها', () => {
  const e = evaluateEligibility(
    { ...base, restrictScope: CreditRestrictScope.VARIANTS, restrictVariantIdsJson: '[12]' },
    lines3
  )
  return e.eligibleTotal === 400_000 && e.excludedVariantIds.length === 2
})
t('L22', 'هیچ قلمی نمی‌خواند ⇒ رد کامل، نه مصرف صفر', () => {
  const d = decideRedeem(
    { ...base, restrictScope: CreditRestrictScope.VARIANTS, restrictVariantIdsJson: '[999]' },
    { applicable: 800_000, lines: lines3, now }
  )
  return !d.ok && /محدودیت/.test(String(d.error))
})
t('L23', 'سقف جذب = جمع اقلام واجد شرایط، نه کل فاکتور', () => {
  const d = decideRedeem(
    { ...base, restrictScope: CreditRestrictScope.CATEGORY, restrictCategoryIdsJson: '[2]' },
    { applicable: 800_000, lines: lines3, now }
  )
  return d.ok && d.applied === 400_000
})
t('L24', 'JSON خراب محدودیت ⇒ آرایه‌ی خالی (نه کرش)', () => parseIdList('{[bad')?.length === 0)

// ---------------- ۵) فضای کد (§۶) ----------------
t('L25', 'فضای ناکافی و رشد خاموش ⇒ ok=false با تعداد کدهای ممکن در پیام', () => {
  const a = assessCodeSpace({ count: 60_000, length: 6, alphabetSize: 10, existing: 0, autoGrow: false, ratio: 20 })
  return !a.ok && /کافی نیست/.test(String(a.message)) && /\d/.test(String(a.message))
})
t('L26', 'فضای ناکافی و رشد روشن ⇒ طول بزرگ‌تر و grown=true (قابل مشاهده)', () => {
  const a = assessCodeSpace({ count: 60_000, length: 6, alphabetSize: 10, existing: 0, autoGrow: true, ratio: 20 })
  return a.ok && a.grown && a.length > 6 && !!a.message
})
t('L27', 'پیشوند ثابت، فضای تصادفی را کم می‌کند', () => {
  const withPrefix = assessCodeSpace({ count: 10, length: 6, prefixLength: 4, alphabetSize: 10, existing: 0, autoGrow: false })
  return !withPrefix.ok
})
t('L28', 'ظرفیت با طول بزرگ از MAX_SAFE_INTEGER رد نمی‌شود', () => codeCapacity(40, 36) === Number.MAX_SAFE_INTEGER)
t('L29', 'حذف کاراکترهای مشابه، O/0/I/1/S/5 را از الفبای تولید برمی‌دارد', () => {
  const a = creditAlphabet('ALNUM', true)
  return !/[O0I1S5]/.test(a) && a.length === 30
})

// ---------------- ۶) کد و پیشوند ----------------
t('L30', 'نرمال‌سازی کد: ارقام فارسی/عربی و کاراکتر اضافه‌ی اسکنر', () =>
  normalizeCreditCode(' cr-12ab۳۴\n') === 'CR12AB34')
t('L31', 'پیشوند فقط حرف/عدد و حداکثر ۴ کاراکتر', () => normalizeCreditPrefix('cr-#خط12345') === 'CR12')
t('L32', 'نوع ناشناس ⇒ EXCHANGE (سازگاری رکوردهای قدیمی)', () => normalizeCreditSource('???') === 'EXCHANGE')

// ---------------- ۷) تنظیمات (§۲۲) ----------------
t('L33', 'JSON خراب تنظیمات ⇒ پیش‌فرض‌های محافظه‌کارانه', () => {
  const s = parseCreditSettings('{{{')
  return s.codeLength === DEFAULT_CREDIT_SETTINGS.codeLength && s.types.MANUAL.days === 30 && s.types.EXCHANGE.days === 7
})
t('L34', 'مقادیر بی‌معنا clamp می‌شوند (نه قبول، نه کرش)', () => {
  const s = parseCreditSettings({ codeLength: 999, bulkMaxCount: -5, reminder: { maxCount: 10_000 } })
  return s.codeLength === 20 && s.bulkMaxCount === 1 && s.reminder.maxCount === 100
})
t('L35', 'نوع تازه‌ی آینده حذف نمی‌شود', () => {
  const s = parseCreditSettings({ types: { PROMO: { days: 5, maxUses: 2, multiUse: true } } })
  return !!s.types.PROMO && s.types.PROMO.maxUses === 2 && !!s.types.MANUAL
})
t('L36', 'خلاصه‌ی فارسی تنظیمات برای AuditLog ساخته می‌شود', () => {
  const d = describeCreditSettings(DEFAULT_CREDIT_SETTINGS)
  return d.includes('طول کد') && d.includes('یادآوری')
})

// ---------------- ۸) یادآوری (§۱۴) ----------------
const rem = { ...DEFAULT_CREDIT_SETTINGS.reminder }
const cand = {
  status: CreditStatus.ACTIVE,
  amount: 1_000_000,
  usedAmount: 0,
  issuedAt: new Date(now - 20 * DAY),
  expiresAt: new Date(now + 40 * DAY),
  phone: '09120000000',
  reminderCount: 0
}
t('L37', 'شرط «N روز از صدور و مصرف‌نشده» ⇒ باید', () => {
  const d = reminderDecision(cand, rem, now)
  return d.should && d.kind === 'UNUSED'
})
t('L38', 'Opt-out ⇒ هرگز', () => !reminderDecision({ ...cand, reminderOptOut: true }, rem, now).should)
t('L39', 'بدون شماره تماس ⇒ نه (با دلیل فارسی)', () => {
  const d = reminderDecision({ ...cand, phone: null }, rem, now)
  return !d.should && /شماره/.test(d.reason)
})
t('L40', 'سقف تعداد یادآوری ⇒ نه', () => !reminderDecision({ ...cand, reminderCount: 3 }, rem, now).should)
t('L41', 'فاصله‌ی مجاز بین دو پیام ⇒ نه', () =>
  !reminderDecision({ ...cand, reminderCount: 1, lastReminderAt: new Date(now - 2 * DAY) }, rem, now).should)
t('L42', 'نزدیک انقضا ⇒ نوع NEAR_EXPIRY (حتی اگر تازه صادر شده باشد)', () => {
  const d = reminderDecision({ ...cand, issuedAt: new Date(now - DAY), expiresAt: new Date(now + 2 * DAY) }, rem, now)
  return d.should && d.kind === 'NEAR_EXPIRY'
})
t('L43', 'اعتبار مصرف‌شده/باطل ⇒ هیچ یادآوری', () =>
  !reminderDecision({ ...cand, status: CreditStatus.USED }, rem, now).should &&
  !reminderDecision({ ...cand, status: CreditStatus.CANCELED }, rem, now).should)
t('L44', 'Placeholder ها پر می‌شوند و کلید ناشناس دست‌نخورده می‌ماند', () => {
  const out = fillPlaceholders('{store_name}/{credit_code}/{unknown_key}', { store_name: 'مهک', credit_code: 'CR1' })
  return out === 'مهک/CR1/{unknown_key}'
})

console.log(lines.join('\n'))
console.log(`\nنتیجه‌ی سوییت منطق خالص: ${pass} PASS · ${fail} FAIL`)
if (fail > 0) process.exitCode = 1
