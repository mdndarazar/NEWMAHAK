/**
 * ===========================================================================
 * جلسه ۵۲ — سوییت «فروش تکی با قفل» + رد `stockPlan` برای فاکتور قدیمی در update.
 * ممیزی ایستای کد (بی دیتابیس، بی node_modules): `node test/stock-source-pos-session52.mjs`
 * ---------------------------------------------------------------------------
 * چرا ایستا و نه اجرای واقعی: چهار موردی که مالک خواست (قفل بسته ⇒ بی سؤال ·
 * رد سرور بی رمز · قفل باز + رمز درست ⇒ پذیرفته · رمز اشتباه ⇒ رد) همه در
 * `SalesService.create/update` و `Pos.tsx` تصمیم گرفته می‌شوند و اجرای واقعی‌شان
 * دیتابیس + Prisma لازم دارد (طبق «قواعد صرفه‌جویی» ممنوع). پس این سوییت ثابت
 * می‌کند **همان شرط‌ها در کد هستند** و هیچ‌کدام جا نیفتاده‌اند.
 * ===========================================================================
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const SVC = read('src/main/services/SalesService.ts')
const POS = read('src/renderer/src/pages/Pos.tsx')
const MOD = read('src/renderer/src/components/StockSourceModal.tsx')
const TYP = read('src/shared/types.ts')
const INV = read('src/renderer/src/pages/SalesInvoice.tsx')
const PNL = read('src/shared/panels.ts')

const has = (n, src, needle) => ok(n, src.includes(needle), `پیدا نشد: ${needle.slice(0, 70)}`)
const hasnt = (n, src, needle) => ok(n, !src.includes(needle), `نباید باشد: ${needle.slice(0, 70)}`)

// ---------------------------------------------------------------------------
section('بند ۰ — `update` برنامه را برای فاکتور بی‌دفتر (قدیمی) رد می‌کند')
has('شرط رد در کد هست', SVC, 'if (editPlan && !hadAllocations)')
ok('رد *قبل* از محاسبه‌ی allocationPath است (وگرنه بی‌اثر بود)',
  SVC.indexOf('if (editPlan && !hadAllocations)') < SVC.indexOf('const allocationPath = hadAllocations || !!editPlan'))
ok('رد *قبل* از برگشت مبدأها و dropAllocations است (هیچ نوشتنی قبل از خطا)',
  SVC.indexOf('if (editPlan && !hadAllocations)') < SVC.indexOf('reverseWholeInvoice'))
has('خطا از نوع BusinessError با پیام فارسی روشن', SVC, 'انتخاب انبار مبدأ برای این فاکتور پذیرفته نمی‌شود')
ok('همان مسیر تاریخی delta دست‌نخورده مانده',
  SVC.includes('const increase = allocationPath ? (reverted?.storeLines ?? []) : delta.increase'))

// ---------------------------------------------------------------------------
section('مرحله ۳ · قفل سمت سرور — `assertPanelPassword` روی همان کلید موجود')
// نشست ۱۸۴ — فهرست import گسترده شد (`assertPanelPasswordStrict` برای عملیات پول‌ساز).
// آنچه این بررسی می‌خواهد همان است: خودِ `assertPanelPassword` در دسترس باشد.
has('assertPanelPassword وارد شده', SVC, 'assertPanelPassword')
has('PANEL_KEYS وارد شده', SVC, "import { PANEL_KEYS } from '@shared/panels'")
has('کلید همان posCentralWithdrawToggle است (یک قفل واحد)', SVC, 'PANEL_KEYS.posCentralWithdrawToggle')
hasnt('کلید قفل تازه‌ای ساخته نشده', PNL, 'posStockSourcePick')
has('فقط برای فروش تکی (INTERNAL) لازم می‌شود', SVC, 'orderType === OrderType.INTERNAL')
ok('تأیید *بیرونِ* تراکنش است (الگوی جلسه ۴۰ · SQLite تک‌نویسنده)',
  SVC.indexOf('await assertPanelPassword(\n        PANEL_KEYS.posCentralWithdrawToggle') < SVC.indexOf('return prisma.$transaction(async (tx) => {'))
has('گیت داخل تراکنش بدون تأیید رد می‌کند', SVC,
  'if (stockPlan && !(orderType === OrderType.WHOLESALE || (orderType === OrderType.INTERNAL && posPlanRequested)))')
has('تعویض/بیرون‌بر/تلفنی همچنان رد می‌شوند (پیام صریح)', SVC, 'تعویض کالا و سفارش بیرون‌بر/تلفنی مثل قبل')
has('`panelPassword` در قرارداد ورودی هست', TYP, 'panelPassword?: string | null')

// ---------------------------------------------------------------------------
section('مرحله ۳ · فروش تکی — قفل بسته ⇒ فروشنده هیچ سؤالی نمی‌بیند')
has('قفل بسته ⇒ هیچ برنامه‌ای ساخته نمی‌شود', POS, 'if (!stockPickUnlocked) return undefined')
has('تیک روشن ⇒ مسیر خودکار قبلی (بی سؤال)', POS, 'if (!path.planPath) return undefined')
has('موجودی کافی ⇒ هیچ پنجره‌ای و هیچ برنامه‌ای', POS, 'if (!probe.shortages.length) return undefined')
ok('همان بولین ManagerGate، بی منطق موازی', POS.includes('const stockPickUnlocked = autoCentralBox.unlocked'))
has('تصمیم مسیر از همان تابع خالص جلسه ۵۱', POS, 'stockPathFor({')
hasnt('منوی انتخاب انبار مبدأ ساخته نشده (سرعت صندوق)', POS, 'stockPickOptions')
has('مبدأ همیشه انبار فروشگاه است', POS, 'primaryKey={STORE_PICK_KEY}')

section('مرحله ۳ · فروش تکی — قفل باز ⇒ پنجره + رمز همراه همان ثبت')
has('رمز از پنجره به payload می‌رود', POS, 'panelPassword: picked.password')
has('برنامه همراه autoCentralWithdraw: false می‌رود', POS, 'autoCentralWithdraw: false,')
has('لغو ⇒ هیچ فیشی ثبت نمی‌شود', POS, 'return setErr(STOCK_PICK_TEXT.cancelled)')
has('STOCK_PLAN_STALE ⇒ اجرای دوباره با سقف تلاش', POS, 'isStalePlanMessage(e) && attempt < MAX_STALE_RETRY')
has('کادر رمز فقط با قفلِ *روشن* ساخته می‌شود', POS, 'passwordRequired={stockPickLockOn}')
has('پنجره تا باز است، F3/F8 دوباره ثبت نمی‌زنند', POS, '!modalOpen && stockChain == null')
has('خلاصه‌ی مبدأ کسر بعد از ثبت', POS, 'STOCK_PICK_TEXT.summaryTitle')

section('پنجره — افزودنی محض، فاکتور عمده دست‌نخورده')
has('کادر رمز پیش‌فرض خاموش است', MOD, 'passwordRequired = false')
has('بی رمز، دکمه‌ی تأیید غیرفعال است', MOD, 'passwordRequired && !password.trim()')
has('رمز با بستن پنجره پاک می‌شود (ذخیره نمی‌شود)', MOD, "if (!open) setPassword('')")
has('فاکتور عمده رمز نمی‌فرستد (امضای دو-پارامتری، سازگار)', INV, 'onConfirm={(plan) => stockChain?.decide(plan)}')
hasnt('فاکتور عمده passwordRequired نمی‌دهد', INV, 'passwordRequired')

console.log(`\n${'='.repeat(64)}\n${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { console.log('\nناموفق:'); failures.forEach((f) => console.log(` • ${f}`)); process.exit(1) }
