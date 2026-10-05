/**
 * ===========================================================================
 * جلسه ۵۳ — سوییت «نمایش مبدأ کسر» (مرحله ۴) + اصلاح متن قفل.
 * ممیزی ایستای کد، بی دیتابیس و بی node_modules:
 *   node test/stock-source-display-session53.mjs
 * ---------------------------------------------------------------------------
 * چرا ایستا: این مرحله فقط *نمایش* است و اجرای واقعی‌اش Electron + Prisma +
 * چاپگر لازم دارد (طبق «قواعد صرفه‌جویی» ممنوع بود). پس این سوییت ثابت می‌کند
 * رفتارِ خواسته‌شده **در کد هست** — نه این‌که در زمان اجرا سبز است. تست دستی
 * (چاپ یک رسید با مبدأ غیرفروشگاه) در CHANGELOG آمده است.
 * ===========================================================================
 */
import { readFileSync } from 'node:fs'

let pass = 0
const failures = []
const section = (t) => console.log(`\n— ${t}`)
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ✓ ${n}`); return true } failures.push(`${n}${d ? ` → ${d}` : ''}`); console.log(`  ✗ ${n}${d ? ` → ${d}` : ''}`); return false }
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const PNL = read('src/shared/panels.ts')
const SRC = read('src/shared/stockSource.ts')
const TPL = read('src/main/print/templates.ts')
const PRT = read('src/main/services/PrintService.ts')
const HOOK = read('src/renderer/src/hooks/useSaleStockSources.ts')
const INV = read('src/renderer/src/pages/SalesInvoice.tsx')
const REP = read('src/renderer/src/pages/SalesReports.tsx')
const IPC = read('src/main/ipc/index.ts')
const SVC = read('src/main/services/SalesService.ts')

const has = (n, src, needle) => ok(n, src.includes(needle), `پیدا نشد: ${needle.slice(0, 70)}`)
const hasnt = (n, src, needle) => ok(n, !src.includes(needle), `نباید باشد: ${needle.slice(0, 70)}`)
const count = (src, needle) => src.split(needle).length - 1

// ---------------------------------------------------------------------------
section('۱) اصلاح متن قفل — همان کلید و همان قفل، فقط متن')
has('hint از انتخاب انبار مبدأ کسر می‌گوید', PNL, 'انتخاب انبار مبدأ کسر هنگام کمبود موجودی در پنل فروش تکی')
has('hint صریح می‌گوید همین رمز دوم هر دو را باز می‌کند', PNL, 'همین رمز دوم هر دو را باز می‌کند')
has('تیک «برداشت خودکار» هم در متن مانده', PNL, 'برداشت خودکار از انبار مرکزی')
has('کلید عوض نشده', PNL, "posCentralWithdrawToggle: 'pos-central-withdraw-toggle'")
hasnt('کلید قفل تازه‌ای ساخته نشده', PNL, 'posStockSourcePick')
ok('عنوان ردیف قفل دست‌نخورده مانده', PNL.includes("title: 'چک‌باکس «برداشت خودکار از انبار مرکزی»'"))

// ---------------------------------------------------------------------------
section('متن‌های ستون یک‌جا در shared هستند (جدول = چاپ = اکسل)')
has('عنوان ستون', SRC, "columnTitle: 'مبدأ کسر'")
has('خانه‌ی خالی', SRC, "emptyCell: '—'")
has('تیتر بلوک رسید', SRC, "receiptTitle: 'مبدأ کسر'")
has('خط هشدار منفی‌شدن', SRC, 'receiptNegativeNote')
has('راهنمای ستون می‌گوید خالی = بی‌دفتر، مثل قبل', SRC, 'این فاکتور «دفتر مبدأ» ندارد')
has('کمکی بولین منفی‌شدن', SRC, 'export const summaryHasNegative =')
ok('`summaryShortLine`/`summaryTextLines` دست‌نخورده‌اند (رفتار قبلی)',
  SRC.includes("return `${g.warehouseName}: ${parts.join(' · ')}`") &&
  SRC.includes("`${g.warehouseName} ${fa(g.totalQty)}${g.negativeCount > 0 ? ' ⚠' : ''}`"))

// ---------------------------------------------------------------------------
section('رسید چاپی و چاپ A4 — بلوک «مبدأ کسر»')
has('قرارداد تازه در ReceiptData', TPL, 'stockSource?: ReceiptStockSource | null')
has('شکل بلوک سه فیلد دارد', TPL, 'export interface ReceiptStockSource')
has('بلوک ساخته می‌شود', TPL, "  let stockBlock = ''\n  if (srcLines.length) {")
has('بلوک در بدنه‌ی رسید تزریق شده', TPL, '      stockBlock +')
has('تیتر از shared می‌آید، نه هاردکد تازه', TPL, 'STOCK_PICK_TEXT.receiptTitle')
has('علامت روشن منفی‌شدن', TPL, 'd.stockSource?.hasNegative')
has('نام کالا هم مثل بقیه‌ی رسید escape می‌شود', TPL, 'escapeHtml(faDigits(l))')
ok('بی‌دفتر ⇒ رشته‌ی خالی ⇒ هیچ خط/خط‌چین اضافه‌ای (رسید مو‌به‌مو مثل قبل)',
  TPL.includes("const srcLines = d.stockSource?.lines?.filter((l) => l && l.trim()) ?? []") &&
  TPL.includes("  let stockBlock = ''") &&
  TPL.includes("  if (srcLines.length) {"))
ok('بلوک استایل خودش را inline دارد (قالب رسید و بقیه‌ی قالب‌ها دست‌نخورده)',
  // اصلاح جلسه ۵۵ · کار ۳ — الگو یک backslash اضافه داشت (`src\\"` ⇒ در رشته‌ی
  // جاوااسکریپت می‌شد `src\"`) ولی `templates.ts` خط ۲۰۵ عیناً `src" style="…`
  // است. پس این assertion همیشه شکست می‌خورد، بی آن‌که کد مشکلی داشته باشد.
  // فقط الگوی تست درست شد؛ `templates.ts` یک کاراکتر هم عوض نشده.
  count(TPL, 'src" style="margin:2px 0;line-height:1.5') === 1 && !TPL.includes('.src { margin'))
hasnt('سند تعویض دست نخورد (بلوک مبدأ ندارد)', TPL.split('export function exchangeReceiptHtml')[1] ?? '', 'stockBlock')

section('PrintService — خواندنی محض، و چاپ هیچ‌وقت نمی‌شکند')
has('از همان `summaryOf` سرور می‌خواند', PRT, 'await stockAllocationService.summaryOf(invoiceId)')
has('بی‌دفتر ⇒ null', PRT, 'if (sum.groups.length && sum.lines.length)')
has('پیش‌فرض null است', PRT, 'let stockSource: ReceiptStockSource | null = null')
has('خطای خواندن جلوی چاپ رسید را نمی‌گیرد', PRT, "console.error('[print] stock source summary failed', e)")
has('فیلد در خروجی رسید هست', PRT, '      stockSource\n    }')
hasnt('هیچ کانال نویسنده‌ای در مسیر چاپ صدا نمی‌شود', PRT, 'stockAllocationService.apply')
/**
 * به‌روزرسانی نشست ۱۸۱ — مقصود این بررسی عوض نشده، فقط متنش.
 *
 * قرارداد این است که «عدد مالی رسید **مستقیم از همان فاکتور** می‌آید و در مسیر
 * چاپ بازمحاسبه نمی‌شود». بعد از مهاجرت ۸۳ ستون مالی به BigInt (بند ۴-۲۸ الف)،
 * این مقادیر از دیتابیس `bigint`اند و قالب رسید با `number` کار می‌کند، پس یک
 * تبدیل نوعِ محض اضافه شده: `toNumberRial(inv.grandTotal)`.
 *
 * تبدیل نوع، بازمحاسبه نیست — هیچ جمع، تخفیف یا گردکردنی اضافه نشده. برای اینکه
 * این تمایز حفظ شود، بررسی همچنان سخت‌گیر است: باید دقیقاً همان فیلدِ همان
 * فاکتور باشد و هیچ عملگر حسابی‌ای در میان نباشد.
 */
ok(
  'هیچ عدد مالی رسید عوض نشد (فقط تبدیل نوع BigInt ⇒ number، بدون بازمحاسبه)',
  PRT.includes('grandTotal: toNumberRial(inv.grandTotal)') &&
    PRT.includes('paidTotal: toNumberRial(inv.paidTotal)') &&
    // هیچ عملگر حسابی‌ای وارد این دو خط نشده باشد
    !/grandTotal: [^\n]*inv\.grandTotal[^\n]*[+\-*/]/.test(PRT) &&
    !/paidTotal: [^\n]*inv\.paidTotal[^\n]*[+\-*/]/.test(PRT)
)

// ---------------------------------------------------------------------------
section('کانال خواندن — همان کانال‌های موجود، بی افزودنِ تازه')
has('کانال تک‌فاکتوری از قبل بود', IPC, 'handle(IPC.saleStockSources,')
has('کانال چندفاکتوری از قبل بود', IPC, 'handle(IPC.saleStockSourcesMany,')
ok('هوک فقط کانال چندفاکتوری را صدا می‌زند', HOOK.includes('CH.saleStockSourcesMany') && !HOOK.includes('CH.saleCreate'))
has('سقف ایمنی روی تعداد شناسه', HOOK, 'const MAX_IDS = 500')
has('خطای کانال ⇒ ستون خالی، نه شکستن صفحه', HOOK, "setError(e?.message ?? 'خواندن «مبدأ کسر» ناموفق بود')")
has('بی‌دفتر ⇒ رشته‌ی خالی', HOOK, "map[invoiceId]?.short ?? ''")
has('کلید متنی، تا useEffect بی‌پایان نشود', HOOK, 'const reload = useCallback(async () => {')

// ---------------------------------------------------------------------------
section('فهرست فاکتورهای عمده — ستون کوچک + colSpan به‌روز')
has('هوک مشترک استفاده شده', INV, "import { useSaleStockSources } from '../hooks/useSaleStockSources'")
has('فقط وقتی تب فهرست باز است', INV, "    tab === 'list'\n  )")
has('هدر ستون از shared', INV, '<th title={STOCK_PICK_TEXT.columnExplainer}>{STOCK_PICK_TEXT.columnTitle}</th>')
has('خانه‌ی خالی برای فاکتور بی‌دفتر', INV, '<span className="kbd">{STOCK_PICK_TEXT.emptyCell}</span>')
has('colSpan به ۱۳ رسید', INV, 'colSpan={13}')
hasnt('colSpan قدیمی ۱۲ نمانده', INV, 'colSpan={12}')
ok('تعداد `<th>` جدول فهرست ۱۳ شد',
  (() => {
    const head = INV.split('<th>شماره</th>')[1]?.split('</thead>')[0] ?? ''
    return count(head, '<th') + 1 === 13
  })(), 'شمارش هدر با colSpan نمی‌خواند')
ok('ستون‌های مالی فهرست دست‌نخورده‌اند',
  INV.includes('<td className="font-bold">{money(r.grandTotal)}</td>') && INV.includes('<td>{money(r.paidTotal)}</td>'))

// ---------------------------------------------------------------------------
section('گزارش فروش — جدول + چاپ A4 + اکسل، همان الگوی تب تعویض')
has('عنوان ستون به هدرها اضافه شد', REP, 'STOCK_PICK_TEXT.columnTitle\n]')
has('ردیف آرایه‌ای پارامتر source گرفت', REP, 'const summaryRowValues = (r: SaleReportRow, source = \'\') => [')
// نشست ۱۵۹ (S159-D4): از نشست ۱۲۸ (قفل فیلتر خروجی) چاپ و اکسل از snapshot «output» می‌خوانند که
// stockSourceShort آن همان stockSources.shortOf صفحه (یا نقشه‌ی کامل بازه) است؛ قاعده همان: هر دو یک متن.
ok('چاپ A4 و اکسل هر دو همان متن را می‌فرستند', count(REP, 'summaryRowValues(r, output.stockSourceShort(r.id))') === 2 && REP.includes('stockSourceShort: stockSources.shortOf'))
has('جدول روی صفحه همان متن را می‌دهد', REP, 'source={stockSources.shortOf(r.id)}')
has('تفکیک شیفت هم از همان نقشه می‌خواند', REP, 'sourceOf={stockSources.shortOf}')
ok('هر دو ردیفِ تفکیک شیفت source می‌گیرند', count(REP, "source={sourceOf?.(r.id) ?? ''}") === 2)
ok('ردیف جمع هر دو جدول یک خانه عریض‌تر شد (کد فاکتور + مبدأ + دکمه)',
  count(REP, '<td colSpan={3}></td>') === 4 &&
  count(REP, 'جلسه ۵۳ — «کد فاکتور» + «مبدأ کسر» + ستون دکمه‌ها') === 2)
has('ستون «مبدأ کسر» در totals جمع ندارد (متن است)', REP, 'جلسه ۵۳ — ستون «مبدأ کسر» جمع ندارد')
has('خانه‌ی خالی برای فاکتور بی‌دفتر', REP, '<span className="kbd">{STOCK_PICK_TEXT.emptyCell}</span>')
has('فقط در تب سرجمع درخواست می‌رود', REP, "    tab === 'summary'\n  )")
ok('ستون «مبدأ برداشت» تب تعویض دست‌نخورده ماند (جلسه ۵۰)',
  REP.includes("const EXCHANGE_SOURCE_COLUMN = 'مبدأ برداشت'") && REP.includes('exchangeSourceOf(r.note)'))
ok('هیچ عدد مالی گزارش عوض نشد',
  REP.includes('money(t.grandTotal)') && REP.includes('t.goodsTotal,\n            t.taxTotal,'))

// ---------------------------------------------------------------------------
section('مرزها — هیچ چیز دیگری دست نخورد')
hasnt('هیچ migration/schema ای در مسیر نمایش نیست', PRT, 'prisma.$executeRaw')
ok('لایه‌ی سرورِ ثبت/ویرایش دست‌نخورده (بند ۰ جلسه ۵۲ سر جایش)',
  SVC.includes('if (editPlan && !hadAllocations)') && SVC.includes('PANEL_KEYS.posCentralWithdrawToggle'))
ok('`summaryOf` و `summaryForInvoices` فقط findMany می‌زنند',
  (() => {
    const s = read('src/main/services/StockAllocationService.ts')
    const tail = s.split('async summaryOf(')[1] ?? ''
    return !/prisma\.\w+\.(update|create|delete|upsert)/.test(tail)
  })(), 'در مسیر خواندن، نوشتن پیدا شد')

console.log(`\n${'='.repeat(64)}\n${pass} PASS · ${failures.length} FAIL`)
if (failures.length) { console.log('\nناموفق:'); failures.forEach((f) => console.log(` • ${f}`)); process.exit(1) }
