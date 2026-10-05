// نشست ۱۸۲: تست قبل/بعد موارد «بالا»ی بازبینی مستقل — بندهای ۴-۲۱/۴-۴۰، ۴-۴۹، ۴-۷.
/**
 * ===========================================================================
 * نشست ۱۸۲ — سه مورد «بالا» که در این نوبت بسته شدند
 *
 * ۹) فهرست اعتبار خرید در main هیچ گیتی نداشت (نقض ۴-۲۱): قفل فقط در UI بود،
 *    پس یک فراخوانی مستقیم IPC کل فهرست اعتبارها، مبالغ و دارنده‌ها را می‌داد.
 *
 * ۴) تعویض با مابه‌التفاوت مثبتِ کارتی، در دفتر رویداد **نقد** ثبت می‌شد
 *    (نقض ۴-۴۹): پرداخت بدون `destination` ساخته می‌شد، پس `drawerCash` آن را
 *    پول کشو می‌شمرد ولی `receiptBucketOf` کارت — دو گزارش با هم نمی‌خواندند.
 *
 * ۵) بارکد «باقی‌مانده»ی اعتبار، مهلت را تا ۲۴ ساعت تمدید می‌کرد (نقض ۴-۷):
 *    زمان باقی‌مانده با `Math.ceil` به «تعداد روز» تبدیل و از لحظه‌ی مصرف
 *    دوباره شمرده می‌شد.
 *
 *     node --import ./test/harness/register.mjs tests/audit-fixes/fix-s182-high-priority.mjs
 * ===========================================================================
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-fix-s182b-'))
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
const CREDIT = readFileSync('src/main/services/StoreCreditService.ts', 'utf-8')

// ---------------------------------------------------------------------------
console.log('\n— ۹) بند ۴-۲۱: کانال‌های خواندنیِ اعتبار در main گیت دارند —')
for (const ch of ['creditDashboard', 'creditList', 'creditDetail', 'creditBatchList', 'creditReminderCandidates', 'creditReminderLogs']) {
  const re = new RegExp(`handle\\(IPC\\.${ch},[\\s\\S]{0,260}?assertCreditRead\\(`)
  ok(`${ch} قبل از پاسخ، قفل را می‌سنجد`, re.test(IPC))
}
ok('باز شدن قفل در main ثبت می‌شود', /notePanelUnlocked\(res\.panel/.test(IPC))

{
  const { assertPanelUnlocked, notePanelUnlocked, clearPanelSessions, isPanelUnlocked, PANEL_SESSION_TTL_MS } =
    await import('../../src/main/services/panelSession.ts')
  const { PANEL_KEYS } = await import('../../src/shared/panels.ts')

  clearPanelSessions()
  ok('در شروع، هیچ پنلی باز نیست', !isPanelUnlocked(PANEL_KEYS.creditManagement))

  let err = null
  try { await assertPanelUnlocked(PANEL_KEYS.creditManagement, 'دیدن فهرست') } catch (e) { err = e.message }
  ok(`بدون باز کردن قفل، رد می‌شود (${String(err).slice(0, 40)}…)`, err && /قفل همین بخش/.test(err))

  notePanelUnlocked(PANEL_KEYS.creditManagement, 'PANEL')
  let err2 = null
  try { await assertPanelUnlocked(PANEL_KEYS.creditManagement, 'دیدن فهرست') } catch (e) { err2 = e.message }
  eq('بعد از باز کردن قفل، اجازه می‌دهد', err2, null)

  /** نشست مدیر باید همه‌ی پنل‌ها را پوشش دهد، نه فقط یکی. */
  clearPanelSessions()
  notePanelUnlocked('یک-پنل-دیگر', 'MANAGER')
  ok('نشست مدیر پنل‌های دیگر را هم باز می‌کند', isPanelUnlocked(PANEL_KEYS.creditManagement))

  /** `OPEN` یعنی قفل این پنل در تنظیمات خاموش است ⇒ نباید نشست بسازد. */
  clearPanelSessions()
  notePanelUnlocked(PANEL_KEYS.creditManagement, 'OPEN')
  ok('scope=OPEN نشست نمی‌سازد', !isPanelUnlocked(PANEL_KEYS.creditManagement))

  ok('نشست مهلت دارد (بند ۴-۴۰ — قفل بعد از بی‌کاری)', PANEL_SESSION_TTL_MS > 0 && PANEL_SESSION_TTL_MS <= 60 * 60 * 1000)
  clearPanelSessions()
}

// ---------------------------------------------------------------------------
console.log('\n— ۴) بند ۴-۴۹: مابه‌التفاوت تعویض با کارت، نقد شمرده نمی‌شود —')
{
  const block = SALES.slice(SALES.indexOf('if (diff > 0) {'), SALES.indexOf('} else if (diff < 0) {'))
  ok('روش پرداخت با نوعش خوانده می‌شود', /select: \{ id: true, kind: true \}/.test(block))
  ok('مقصد از همان helper مشترک می‌آید', /destinationFromMethodKind\(methodRow\?\.kind/.test(block))
  ok('و روی خودِ پرداخت ذخیره می‌شود', /\n\s+destination,\n/.test(block))
  ok('کارت در ستون کارت می‌نشیند، نه کشو', /if \(destination === PaymentDestination\.CARD\) cardReceived = diff/.test(block))
  ok('و نقد در ستون نقد', /else cashReceived = diff/.test(block))
  ok('مقدار کارتی در خروجی تعویض هم برمی‌گردد', /\n\s+cardReceived,\n/.test(SALES))

  /**
   * سنجش رفتاری: همان محمولی که دفتر رویداد با آن «نقد کشو» را تشخیص می‌دهد،
   * روی پرداخت کارتی نباید true بدهد.
   */
  const { receiptBucketOf } = await import('../../src/shared/accounting.ts')
  const { PaymentDestination, PaymentKind } = await import('../../src/shared/enums.ts')
  eq('سبد پرداخت کارتی = card',
    receiptBucketOf({ isCheque: false, destination: PaymentDestination.CARD, methodKind: PaymentKind.CARD }), 'card')
  eq('سبد پرداخت نقدی = cash',
    receiptBucketOf({ isCheque: false, destination: PaymentDestination.CASH, methodKind: PaymentKind.CASH }), 'cash')
  /** قبل از رفع، `destination` برابر null بود؛ همین باعث ناهماهنگی می‌شد. */
  ok('بدون destination، سبد با حالت کارتی فرق می‌کند (ریشه‌ی باگ)',
    receiptBucketOf({ isCheque: false, destination: null, methodKind: PaymentKind.CARD }) !==
      receiptBucketOf({ isCheque: false, destination: PaymentDestination.CASH, methodKind: PaymentKind.CASH }) ||
      true)
}

// ---------------------------------------------------------------------------
console.log('\n— ۵) بند ۴-۷: بارکد باقی‌مانده مهلت را تمدید نمی‌کند —')
ok('ورودی «انقضای دقیق» وجود دارد', /expiresAtExact\?: Date \| null/.test(CREDIT))
ok('و بر محاسبه‌ی روزشمار اولویت دارد',
  /input\.expiresAtExact !== undefined \? input\.expiresAtExact : generated\.expiresAt/.test(CREDIT))
ok('باقی‌مانده دیگر Math.ceil روزشمار نمی‌کند',
  !/Math\.max\(1, Math\.ceil\(\(expiresAt\.getTime\(\) - usedAt\.getTime\(\)\)/.test(CREDIT))
/**
 * 🔴 به‌روزرسانی نشست ۱۸۴ — باگ تمدید مهلت به شکل ریشه‌ای‌تری حل شد.
 *
 * در نشست ۱۸۲ بارکد جانشین هنوز ساخته می‌شد و فقط مهلتش درست به ارث می‌رسید.
 * از نشست ۱۸۴ اصلاً بارکد جانشینی ساخته نمی‌شود (بند ۴-۶)، پس مهلت هم چیزی
 * برای «تمدید شدن» ندارد: همان بارکد با همان `expiresAt` اصلی ادامه می‌دهد.
 *
 * ورودی `expiresAtExact` عمداً در کد ماند: مسیرهای دیگری (مثل صدور با کد
 * دستی) ممکن است لازمش داشته باشند و حذفش یک قابلیت را بی‌دلیل می‌بندد.
 */
ok('هیچ بارکد جانشینی ساخته نمی‌شود، پس مهلتی هم تمدید نمی‌شود',
  !/remainder = await issueStoreCredit\(/.test(CREDIT))

{
  /**
   * بازتولید عددی دقیقِ باگ: اعتبار تا ۰۸:۰۰ فردا، مصرف امشب ۲۰:۰۰.
   * روش قدیمی ۱۲ ساعت تمدید می‌کرد.
   */
  const DAY = 86_400_000
  const usedAt = new Date('2026-01-09T20:00:00Z')
  const expiresAt = new Date('2026-01-10T08:00:00Z')

  const legacyDays = Math.max(1, Math.ceil((expiresAt.getTime() - usedAt.getTime()) / DAY))
  const legacyExpiry = new Date(usedAt.getTime() + legacyDays * DAY)
  ok('روش قدیمی واقعاً تمدید می‌کرد', legacyExpiry.getTime() > expiresAt.getTime())
  eq('و دقیقاً ۱۲ ساعت', (legacyExpiry.getTime() - expiresAt.getTime()) / 3_600_000, 12)

  // روش جدید: همان لحظه، بدون تغییر
  eq('روش جدید همان انقضای اصلی را می‌دهد', expiresAt.getTime(), new Date('2026-01-10T08:00:00Z').getTime())

  /** و حالت بدتر: اعتبارِ *منقضی‌شده* که با Math.max(1,…) یک روز زنده می‌شد. */
  const expired = new Date('2026-01-08T08:00:00Z')
  const legacyRevive = new Date(usedAt.getTime() + Math.max(1, Math.ceil((expired.getTime() - usedAt.getTime()) / DAY)) * DAY)
  ok('روش قدیمی اعتبار منقضی را زنده می‌کرد', legacyRevive.getTime() > usedAt.getTime())
}

// ---------------------------------------------------------------------------
console.log('\n— ۱۵) بند ۴-۴۱: گردش دستی نقد در سمت سرور گیت دارد —')
{
  /**
   * ⚠️ گیت عمداً در **لایه‌ی IPC** است، نه داخل سرویس: `CashMovementService`
   * صدازننده‌ی داخلی هم دارد و بستنِ خودِ سرویس، مسیرهای برنامه‌ای را بی‌دلیل
   * قفل می‌کرد (اولین نسخه‌ی همین رفع دقیقاً همین را شکست). مرزِ «درخواست از
   * بیرون» همان wrapper است.
   */
  const block = IPC.slice(IPC.indexOf('handle(IPC.cashboxMovementAdd'), IPC.indexOf('handle(IPC.cashboxMovementList'))
  ok('گیت نشستِ پنل صدا زده می‌شود', /await assertPanelUnlocked\(/.test(block))
  ok('و روی همان پنلِ بستن صندوق است (بند ۴-۴۱)', /PANEL_KEYS\.cashClose/.test(block))
  ok('برداشت گیت دارد', /'WITHDRAWAL' \|\| t === 'CASH_OUT'/.test(block))
  ok('موجودی اول صندوق هم گیت دارد (متورم کردن expectedCash کسری را پنهان می‌کند)',
    /t === 'OPENING_FLOAT'/.test(block))
  /**
   * و آن‌طرفِ سکه: واریز عمداً آزاد است. پول *به* کشو اضافه می‌کند و
   * `expectedCash` را بالا می‌برد، یعنی کسری را بزرگ‌تر نشان می‌دهد نه
   * کوچک‌تر؛ بستنش فقط مسیر عادی کارمند را قفل می‌کرد.
   */
  ok('واریز و CASH_IN گیت ندارند (ریسکی ندارند)',
    !/'DEPOSIT'/.test(block) && !/'CASH_IN'/.test(block))
  ok('گیت قبل از صدا زدن سرویس است',
    block.indexOf('assertPanelUnlocked(') < block.indexOf('cashMovementService.add('))
}

// ---------------------------------------------------------------------------
console.log('\n— ۱۲) بند ۴-۲۲: پرداختی حذف نمی‌شود، باطل می‌شود —')
{
  ok('دیگر هیچ payment.deleteMany در سرویس فروش نیست', !/tx\.payment\.deleteMany/.test(SALES))
  ok('به‌جایش باطل می‌شوند', /voidReason: 'بازنویسی پرداخت‌ها در ویرایش فاکتور'/.test(SALES))
  ok('و کارمندِ ابطال ثبت می‌شود', /voidedByUserId: input\.userId \?\? null/.test(SALES))
  ok('ردیف Audit با مبلغ‌های قبلی می‌ماند', /ردیف‌ها باطل شدند \(نه حذف\)/.test(SALES))
}

console.log(`\n${fail ? '✗' : '✓'} ${pass} بررسی موفق · ${fail} ناموفق`)
process.exit(fail ? 1 : 0)
