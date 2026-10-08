/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۰ طرح چاپ — «اندازه‌ی کاغذ، اندازه‌گیری ارتفاع و آزمایش‌گر چاپ».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) `pageSizeMicrons` / `mmFromCssPx` / بازه‌ی مجاز — توابع خالص اندازه.
 *   ۲) `printHtml` بدون `pageSize` **مو‌به‌مو** رفتار قبلی است (هیچ اندازه‌گیری و
 *      هیچ pageSize ای به Electron نمی‌رود) — یعنی فاز ۰ هیچ فراخوانی موجودی را
 *      عوض نکرده.
 *   ۳) `printHtml` با `pageSize` ⇒ میکرونِ عدد صحیح به `webContents.print`.
 *   ۴) ارتفاع `'AUTO'` ⇒ اندازه‌گیری واقعی محتوا + حاشیه‌ی ایمنی؛ شکست/مهلت
 *      اندازه‌گیری ⇒ BusinessError فارسی و **هیچ چاپی** (نتیجه قطعی، نه نامعلوم).
 *   ۵) آزمایش‌گر: برگه‌ی درست ساخته می‌شود، حالت‌های الف/ب اندازه‌ی درست می‌فرستند
 *      و حالت «د» هیچ چاپی نمی‌کند (فقط شمارش صفحه).
 *   ۶) ساختاری: ترتیب توابع printer.ts دست‌نخورده و کانال/فایل‌های فاز ۰ سرجایشان.
 *
 * 🔁 بازبینی مستقل فاز ۰ (باگ‌های ۱ تا ۷ + بندهای سبک): این فایل حالا باگ‌ها را
 * **می‌سنجد**، نه فقط شکل رشته‌ها را:
 *   • ۴.۵ — خودِ `MEASURE_SCRIPT` روی DOM جعلی اجرا می‌شود (بدون باگ ۱ کف viewport).
 *   • ۶ — خط‌کش عمودی (`top`)، حالت «ج» بدون ارتفاع ثابت، برچسب واقعی مستطیل مرجع،
 *     و `inset:0`/بی‌کادر بودن حالت چندستونه.
 *   • ۷ — `countPdfPages` روی بایت واقعی PDF و PDF ساختگی چندصفحه‌ای (باگ ۶ و ۷).
 * هر بررسی تازه یک‌بار روی کد باگ‌دار قرمز شده است (جدول اثبات در
 * `_تحویل/گزارش-نشست۲۲۲-رفع-بازبینی-فاز۰-چاپ.md`).
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-diagnose-page-size.mjs
 * این تست روی ماک کنترل‌پذیر Electron اجرا می‌شود و جای چاپ واقعی روی دستگاه را
 * نمی‌گیرد (تأیید نهایی اندازه = آزمون‌های سخت‌افزاری مالک، docs/print-diagnosis.md).
 * ===========================================================================
 */
import { register } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

register('./support/s129-hooks.mjs', import.meta.url)

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const mock = await import('./support/s129-electron-mock.mjs')
const spec = await import(new URL('../../src/shared/printSpec.ts', import.meta.url).href)
const printer = await import(new URL('../../src/main/print/printer.ts', import.meta.url).href)
const diagnose = await import(new URL('../../src/main/print/diagnose.ts', import.meta.url).href)
const pageSize = await import(new URL('../../src/main/print/pageSize.ts', import.meta.url).href)
const { toUserMessage } = await import(new URL('../../src/main/errors.ts', import.meta.url).href)

let ok = 0
let bad = 0
const check = (label, actual, expected = true) => {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  if (same) {
    ok++
    console.log(`  ✓ ${label}`)
  } else {
    bad++
    console.log(`  ✗ ${label} · دریافت ${JSON.stringify(actual)} · انتظار ${JSON.stringify(expected)}`)
  }
}
const near = (label, actual, expected, tol = 0.011) => check(label, Math.abs(Number(actual) - expected) <= tol, true)
const safe = async (fn) => {
  try {
    return { value: await fn() }
  } catch (err) {
    return { error: toUserMessage(err) }
  }
}
const optionsOf = (i = 0) => mock.state.printCalls[i]?.options ?? {}
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')

console.log('\n— ۱) توابع خالص اندازه‌ی کاغذ')
{
  check('pageSizeMicrons(80,140) = {80000,140000}', spec.pageSizeMicrons(80, 140), { width: 80000, height: 140000 })
  check(
    'pageSizeMicrons گرد و همیشه عدد صحیح است',
    [
      spec.pageSizeMicrons(72.4, 30.9999).width,
      spec.pageSizeMicrons(72.4, 30.9999).height,
      Number.isInteger(spec.pageSizeMicrons(80.5, 140.5).width),
      Number.isInteger(spec.pageSizeMicrons(80.5, 140.5).height)
    ],
    [72400, 31000, true, true]
  )
  near('mmFromCssPx(113.39) ≈ 30 میلی‌متر', spec.mmFromCssPx(113.39), 30)
  check(
    'بازه‌ی مجاز: لیبل‌های خودِ طرح (۳۰×۲۰ و ۵۰×۲۵) هم پذیرفته می‌شوند',
    [
      spec.pageSizeWithinLimits(50, 30),
      spec.pageSizeWithinLimits(102, 30),
      spec.pageSizeWithinLimits(40, 20),
      spec.pageSizeWithinLimits(50, 25),
      spec.PAGE_SIZE_LIMITS.minHeightMm
    ],
    [true, true, true, true, 10]
  )
  check(
    'بازه‌ی مجاز: مقادیر خراب رد می‌شوند',
    [
      spec.pageSizeWithinLimits(80, 9),
      spec.pageSizeWithinLimits(0, 140),
      spec.pageSizeWithinLimits(Number.NaN, 140),
      spec.pageSizeWithinLimits(601, 140),
      spec.pageSizeWithinLimits(80, 2001)
    ],
    [false, false, false, false, false]
  )
  check(
    'پیام فارسی بازه با خودِ ثابت‌ها هم‌خوان است',
    spec.PAGE_SIZE_LIMIT_MESSAGE.includes('۱۰') && spec.PAGE_SIZE_LIMIT_MESSAGE.includes('۶۰۰') && /[\u0600-\u06FF]/.test(spec.PAGE_SIZE_LIMIT_MESSAGE),
    true
  )
}

console.log('\n— ۲) printHtml بدون pageSize = رفتار قبلی (سازگاری فاز ۰)')
{
  mock.reset()
  const r = await safe(() => printer.printHtml('<p>x</p>', { silent: true }))
  /**
   * بازبینی مستقل (باگ ۶) — قبلاً `r.value === undefined` چک می‌شد که در خطا هم
   * برقرار است و چک بی‌اثر بود. حالا هم خطا دیده می‌شود و هم اینکه کار واقعاً
   * یک بار به چاپگر رفته باشد.
   */
  check('چاپ موفق بدون خطا و یک بار رفتن به چاپگر', [r.error ?? null, mock.state.printCalls.length], [null, 1])
  check('خروجی: اندازه‌ی اعلام‌نشده ⇒ null', r.value?.pageSize ?? null, null)
  check('هیچ pageSize ای به webContents.print نرفت', 'pageSize' in optionsOf(), false)
  check('هیچ اندازه‌گیری ای اجرا نشد', mock.state.executeJavaScriptCalls.length, 0)
  check('پنجره‌ی مخفی بسته شد', mock.state.windows.every((w) => w.isDestroyed()), true)
}

console.log('\n— ۳) printHtml با pageSize ثابت (میکرون)')
{
  mock.reset()
  const r = await safe(() =>
    printer.printHtml('<p>x</p>', { silent: true, deviceName: 'P1', pageSize: { widthMm: 80, heightMm: 140 } })
  )
  check('بدون خطا و یک بار رفتن به چاپگر', [r.error ?? null, mock.state.printCalls.length], [null, 1])
  check('pageSize دقیق میکرونی رسید', optionsOf().pageSize, { width: 80000, height: 140000 })
  check('نام چاپگر دست‌نخورده رسید', optionsOf().deviceName, 'P1')
  check('در ارتفاع ثابت اندازه‌گیری لازم نیست', mock.state.executeJavaScriptCalls.length, 0)
  check('خروجی، اندازه‌ی واقعاً ارسالی را برمی‌گرداند', r.value?.pageSize, { width: 80000, height: 140000 })
}

console.log('\n— ۴) printHtml با ارتفاع AUTO (اندازه‌گیری محتوا)')
{
  mock.reset()
  const px = 500 // ≈ ۱۳۲٫۳ میلی‌متر ارتفاع محتوا
  mock.state.executeJavaScriptOutcome = px
  const expectedHeightMm = Math.ceil(spec.mmFromCssPx(px) * 10) / 10 + 3
  const r = await safe(() => printer.printHtml('<p>x</p>', { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO' } }))
  check('بدون خطا و یک بار رفتن به چاپگر', [r.error ?? null, mock.state.printCalls.length], [null, 1])
  check('اسکریپت اندازه‌گیری واقعاً اجرا شد', mock.state.executeJavaScriptCalls.length, 1)
  check(
    'کد اندازه‌گیری ارتفاع محتوا را می‌خواند',
    /scrollHeight/.test(mock.state.executeJavaScriptCalls[0]?.code ?? ''),
    true
  )
  check('ارتفاع = محتوای اندازه‌گیری‌شده + حاشیه‌ی ایمنی ۳ میلی‌متر', optionsOf().pageSize, {
    width: 80000,
    height: Math.round(expectedHeightMm * 1000)
  })
  check('هیچ‌وقت مقدار AUTO خام به چاپگر نمی‌رود', typeof optionsOf().pageSize?.height, 'number')
  check('خروجی، همان ارتفاع محاسبه‌شده را برمی‌گرداند', r.value?.pageSize, {
    width: 80000,
    height: Math.round(expectedHeightMm * 1000)
  })
}
{
  mock.reset()
  mock.state.executeJavaScriptOutcome = 1200
  const r = await safe(() =>
    printer.printHtml('<p>x</p>', { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO', heightSafetyMm: 0 } })
  )
  check(
    'حاشیه‌ی ایمنی صفر هم پشتیبانی می‌شود (بدون خطا)',
    [r.error ?? null, mock.state.printCalls.length, optionsOf().pageSize.height],
    [null, 1, 317500]
  )
}

console.log('\n— ۴.۵) اسکریپت اندازه‌گیری: کف ارتفاع viewport (بازبینی مستقل، باگ ۱ بحرانی)')
{
  /**
   * اسکریپت واقعی (همان رشته‌ای که main اجرا می‌کند) روی DOM جعلی اجرا می‌شود؛
   * بدون این تست، باگ «سند کوتاه = ارتفاع پنجره» فقط با چشم دیده می‌شد.
   */
  const runMeasure = async (doc) => await new Function('document', `return ${pageSize.MEASURE_SCRIPT}`)(doc)
  const dom = (de, b) => ({ documentElement: de, body: b, images: [], fonts: { ready: Promise.resolve() } })

  const short = await runMeasure(
    dom(
      { scrollHeight: 600, clientHeight: 600 }, // پنجره‌ی مخفی ۸۰۰×۶۰۰
      { scrollHeight: 76, offsetHeight: 76, getBoundingClientRect: () => ({ height: 76 }) }
    )
  )
  check('سند ۲۰mm ⇒ ۷۶ پیکسل (نه ارتفاع ۶۰۰ پیکسلی پنجره)', short, 76)

  const tall = await runMeasure(
    dom(
      { scrollHeight: 1512, clientHeight: 600 },
      { scrollHeight: 1512, offsetHeight: 1512, getBoundingClientRect: () => ({ height: 1512 }) }
    )
  )
  check('سند بلندتر از viewport ⇒ همان ارتفاع محتوا', tall, 1512)

  const floorOnly =
    typeof pageSize.MEASURE_SCRIPT === 'string' && /de\.scrollHeight > de\.clientHeight/.test(pageSize.MEASURE_SCRIPT)
  check('scrollHeight ریشه فقط وقتی سرریز کرده باشد به حساب می‌آید', floorOnly, true)
}

console.log('\n— ۵) شکست اندازه‌گیری/بازه‌ی نامعتبر ⇒ پیام فارسی و هیچ چاپی')
{
  mock.reset()
  mock.state.executeJavaScriptOutcome = 'reject'
  const r = await safe(() => printer.printHtml('<p>x</p>', { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO' } }))
  check('پیام «اندازه‌گیری انجام نشد»', /اندازه‌گیری طول فاکتور انجام نشد/.test(r.error ?? ''), true)
  check('هیچ کاری به چاپگر نرفت', mock.state.printCalls.length, 0)
  check('پنجره بسته شد', mock.state.windows.every((w) => w.isDestroyed()), true)
}
{
  mock.reset()
  mock.state.executeJavaScriptOutcome = 'hang' // درایور/رندرِ گیرکرده
  const r = await safe(() =>
    printer.printHtml('<p>x</p>', { silent: true, timeoutMs: 40, pageSize: { widthMm: 80, heightMm: 'AUTO' } })
  )
  check('مهلت اندازه‌گیری ⇒ پیام فارسی (بدون معلق‌ماندن)', /اندازه‌گیری طول فاکتور انجام نشد/.test(r.error ?? ''), true)
  check('مهلت ⇒ هیچ چاپی', mock.state.printCalls.length, 0)
}
{
  mock.reset()
  const bad = await safe(() => printer.printHtml('<p>x</p>', { silent: true, pageSize: { widthMm: 80, heightMm: 5000 } }))
  check('ارتفاع خارج از بازه ⇒ پیام «اندازه‌ی کاغذ نامعتبر»', /اندازه‌ی کاغذ تنظیم‌شده نامعتبر/.test(bad.error ?? ''), true)
  check('ارتفاع خارج از بازه ⇒ هیچ چاپی', mock.state.printCalls.length, 0)
  const bad2 = await safe(() => printer.printHtml('<p>x</p>', { silent: true, pageSize: { widthMm: 5, heightMm: 140 } }))
  check('عرض خارج از بازه ⇒ همان پیام', /اندازه‌ی کاغذ تنظیم‌شده نامعتبر/.test(bad2.error ?? ''), true)
  check('عرض خارج از بازه ⇒ هیچ چاپی', mock.state.printCalls.length, 0)
}

console.log('\n— ۶) برگه‌ی آزمایش‌گر چاپ (HTML)')
{
  const sheet = diagnose.buildDiagnosticSheetHtml({
    mode: 'B',
    widthMm: 80,
    heightMm: 140,
    cssPageSize: true,
    printerName: 'Axiom',
    pageSizeLabel: '۸۰×۱۴۰ میلی‌متر',
    barcodeDataUrl: 'data:image/png;base64,AAAA'
  })
  check('اندازه‌ی صفحه در CSS نوشته شد', /size: 80mm 140mm/.test(sheet), true)
  check('مستطیل مرجع ۵۰×۲۰ روی برگه هست', /مستطیل مرجع /.test(sheet) && /width:50mm/.test(sheet), true)
  check('خط‌کش با شماره‌ی ۱۰ میلی‌متری هست', /class="rh"/.test(sheet) && /class="rv"/.test(sheet), true)
  /**
   * بازبینی مستقل (باگ ۳) — خط‌کش عمودی وجود داشت ولی همه‌ی تیک‌ها `left`
   * می‌گرفتند، یعنی یک خط افقیِ تکراری؛ حالا باید `top` داشته باشند.
   */
  check('خط‌کش عمودی تیک‌هایش با top چیده شده', /class="rv"><i style="top:/.test(sheet), true)
  check('مشخصات آزمایش روی خود برگه چاپ می‌شود', sheet.includes('Axiom') && sheet.includes('۸۰×۱۴۰ میلی‌متر'), true)
  check('نشانه‌ی ساختاری برای تست', /data-diagnose-sheet="1"/.test(sheet), true)

  const noCss = diagnose.buildDiagnosticSheetHtml({ mode: 'A', widthMm: 80, heightMm: 140, cssPageSize: false })
  check('حالت الف هیچ اندازه‌ای در CSS ندارد (رفتار فعلی)', /size:\s*80mm/.test(noCss), false)

  /**
   * بازبینی مستقل (باگ ۲) — در حالت «ج» ارتفاع ثابت وجود ندارد؛ اگر `height`
   * روی `.page` یا `size` در `@page` بیاید، اندازه‌گیری همان ارتفاع قالب را
   * برمی‌گرداند و آزمایش بی‌معنا می‌شود.
   */
  const auto = diagnose.buildDiagnosticSheetHtml({ mode: 'C', widthMm: 80, heightMm: 140, cssPageSize: true })
  check('حالت ج: روی صفحه هیچ ارتفاع ثابتی نیست', /\.page \{[^}]*\bheight:/.test(auto), false)
  check('حالت ج: هیچ size ثابتی در @page نیست', /@page \{[^}]*size:/.test(auto), false)
  check('حالت ج: برچسب روی برگه «AUTO» است', /data-page-size="80xAUTO"/.test(auto), true)
  check('حالت ج: محتوا در جریان عادی است (نه absolute)', /\.content \{[^}]*position:relative/.test(auto), true)
  check('حالت ج: محتوا بعد از خط‌کش‌ها با margin می‌آید', /margin:7mm 0 0 7mm/.test(auto), true)

  const row = diagnose.buildDiagnosticSheetHtml({ mode: 'E', widthMm: 102, heightMm: 30, columns: 2, gapXMm: 2, cssPageSize: true })
  check(
    'حالت ه: دو خانه‌ی ۵۰ میلی‌متری با شماره‌ی ستون',
    /repeat\(2, 50mm\)/.test(row) && row.includes('ستون ۱') && row.includes('ستون ۲') && /size: 102mm 30mm/.test(row),
    true
  )
  /**
   * بازبینی مستقل (باگ ۵) — در حالت چندستونه، برگه باید بدون کادر و بدون
   * padding بیرونی باشد (`inset:0`) تا خانه‌ها روی خود لیبل‌ها بیفتند؛
   * `left:4mm` یعنی همان تورفتگی قدیمی.
   */
  check('حالت ه: محتوا کل صفحه را می‌گیرد (inset:0)', /\.content \{[^}]*inset:0/.test(row), true)
  check('حالت ه: تورفتگی افقی قدیمی حذف شد', /left:4mm/.test(row), false)
  check('حالت ه: کادر صفحه حذف شد تا خانه‌ها روی لیبل بیفتند', /\.page \{[^}]*border:0/.test(row), true)
  check('حالت ه: خانه‌ها کادر خودشان را دارند', /\.cell \{[^}]*border:0\.3mm solid/.test(row), true)
  /**
   * بازبینی مستقل (باگ ۴) — برچسب مستطیل مرجع باید عدد واقعی همان اندازه
   * باشد، نه «۵۰×۲۰» ثابت. خانه‌ی ۵۰ میلی‌متری ⇒ ۴۴×۱۴ و حالت «ب» ۸۰×۱۴۰
   * ⇒ ۵۰×۲۰ (بررسی پایین‌تر روی `sheet`).
   */
  check('برچسب مستطیل مرجع در حالت ه = ۴۴×۱۴ (عدد واقعی خانه)', row.includes('مستطیل مرجع ۴۴×۱۴'), true)
  check('برچسب ثابت قدیمی «۵۰×۲۰» در حالت ه نیست', row.includes('۵۰×۲۰'), false)
  check('خط‌کش افقی حالت ه به عرض همان صفحه است', /class="rh"><i style="left:0mm"/.test(row), true)

  const single = diagnose.buildDiagnosticSheetHtml({ mode: 'E', widthMm: 50, heightMm: 30, columns: 1, cssPageSize: true })
  check('تک‌ستونه سرصفحه‌ی شماره‌ی ستون ندارد', /· ستون/.test(single), false)
  check('تک‌ستونه هم همان اندازه‌ی خودش را می‌گیرد', /size: 50mm 30mm/.test(single), true)
  check('تک‌ستونه: محتوا بعد از خط‌کش ۴ میلی‌متری می‌آید', /\.content \{[^}]*left:4mm/.test(single), true)
}

console.log('\n— ۷) اجرای آزمایش‌ها (runPrintDiagnose)')
/**
 * بازبینی — حالت‌های الف/ب/ج/ه نام چاپگر را با `resolvePrintTargetName` در
 * main تأیید می‌کنند و mock پیش‌فرض هیچ چاپگری ندارد، پس `pickPrinter` با
 * «هیچ چاپگری نصب نیست» کرش می‌کرد. بعد از هر reset یک چاپگرِ پیش‌فرض به
 * نام Axiom می‌گذاریم: حالت ب همین نام را صریحاً می‌خواهد و حالت‌های
 * الف/ج/ه از پیش‌فرض ویندوز استفاده می‌کنند.
 */
const DIAG_PRINTER = { name: 'Axiom', displayName: 'Axiom', isDefault: true, status: 0 }
const resetWithDiagPrinter = () => { mock.reset(); mock.state.printers.push({ ...DIAG_PRINTER }) }
{
  mock.reset()
  const res = await diagnose.runPrintDiagnose({ mode: 'D', widthMm: 80, heightMm: 140 })
  check('حالت د: هیچ چاپی نرفت', mock.state.printCalls.length, 0)
  check('حالت د: PDF تولید شد', mock.state.pdfCalls.length, 1)
  check('حالت د: printed=false و شمارش برگشت', [res.printed, typeof res.pages, res.expectedPages], [false, 'number', 1])
  /**
   * بازبینی مستقل (باگ ۷) — عدد شمارش باید واقعاً از PDF بیاید. اگر PDF دو
   * صفحه داشته باشد و تابع «۱» برگرداند، یعنی شمارش بی‌اثر است.
   */
  mock.reset()
  mock.state.pdfPages = 2
  const two = await diagnose.runPrintDiagnose({ mode: 'D', widthMm: 50, heightMm: 30 })
  check('حالت د: PDF دو‌صفحه‌ای ⇒ ۲ (شمارش واقعی، نه ثابت)', [two.pages, two.expectedPages], [2, 1])
  mock.reset()
  mock.state.pdfPages = 1
  const one = await diagnose.runPrintDiagnose({ mode: 'D', widthMm: 50, heightMm: 30 })
  check('حالت د: PDF یک‌صفحه‌ای ⇒ ۱', one.pages, 1)
}
{
  /** شمارش صفحه روی بایت‌های واقعی PDF (بدون Electron). */
  const pdf = (body) => Buffer.from(body, 'latin1')
  check(
    'countPdfPages فقط /Type /Page را می‌شمارد (نه /Pages)',
    diagnose.countPdfPages(pdf('<< /Type /Pages /Count 2 >> << /Type /Page >> << /Type/Page >>')),
    2
  )
  check('countPdfPages روی PDF بی‌صفحه ⇒ صفر', diagnose.countPdfPages(pdf('%PDF-1.4\n%%EOF')), 0)
}
{
  resetWithDiagPrinter()
  await diagnose.runPrintDiagnose({ mode: 'A', silent: true })
  check('حالت الف: بدون pageSize به چاپگر', 'pageSize' in optionsOf(), false)
  check('حالت الف: اندازه‌گیری هم لازم نیست', mock.state.executeJavaScriptCalls.length, 0)
}
{
  resetWithDiagPrinter()
  mock.state.executeJavaScriptOutcome = 400
  await diagnose.runPrintDiagnose({ mode: 'B', widthMm: 80, heightMm: 140, silent: true, deviceName: 'Axiom' })
  check('حالت ب: pageSize دقیق', optionsOf().pageSize, { width: 80000, height: 140000 })
  check('حالت ب: روی همان چاپگر انتخاب‌شده', optionsOf().deviceName, 'Axiom')

  resetWithDiagPrinter()
  mock.state.executeJavaScriptOutcome = 400
  const c = await diagnose.runPrintDiagnose({ mode: 'C', widthMm: 80, heightMm: 140, silent: true })
  const expectedC = Math.round((Math.ceil(spec.mmFromCssPx(400) * 10) / 10 + 3) * 1000)
  check('حالت ج: ارتفاع اندازه‌گیری‌شده (نه ۱۴۰ ثابت)', optionsOf().pageSize, {
    width: 80000,
    height: expectedC
  })
  check('حالت ج: عدد واقعی اندازه‌گیری‌شده در نتیجه برمی‌گردد', c.measuredHeightMm, Math.round((expectedC / 1000) * 10) / 10)
  check('حالت ج: برچسب نتیجه همان عدد واقعی را نشان می‌دهد', `${c.measuredHeightMm ?? ''}`.length > 0 && c.pageSizeLabel.includes('ارتفاع اندازه‌گیری‌شده'), true)

  resetWithDiagPrinter()
  await diagnose.runPrintDiagnose({ mode: 'E', widthMm: 102, heightMm: 30, columns: 2, silent: true })
  check('حالت ه: عرض ردیف دوستونه', optionsOf().pageSize, { width: 102000, height: 30000 })
}
{
  const bad = await safe(() => diagnose.runPrintDiagnose({ mode: 'Z' }))
  // ⚠️ در متن پیام‌ها نیم‌فاصله (ZWNJ) هست؛ به‌جای تطبیق کاراکتربه‌کاراکتر،
  // فقط «پیام فارسی روشن و درست» بررسی می‌شود.
  check(
    'حالت نامعتبر ⇒ پیام فارسی روشن',
    /چاپ نامعتبر است/.test(bad.error ?? '') && /[\u0600-\u06FF]/.test(bad.error ?? ''),
    true
  )
}

console.log('\n— ۸) بررسی ساختاری (نگهبان قراردادها)')
{
  const printerSrc = readSrc('src/main/print/printer.ts')
  const iPrint = printerSrc.indexOf('export async function printHtml')
  const iList = printerSrc.indexOf('export async function listPrinters')
  const iPdf = printerSrc.indexOf('export async function pdfFromHtml')
  check('ترتیب printHtml → listPrinters → pdfFromHtml حفظ شد', iPrint > -1 && iPrint < iList && iList < iPdf, true)
  const countExports = (part) => (part.match(/export async function/g) || []).length
  check(
    'هیچ تابع export تازه‌ای بین سه تابع چاپ نیامد (فقط خودِ همان تابع)',
    [countExports(printerSrc.slice(iPrint, iList)), countExports(printerSrc.slice(iList, iPdf))],
    [1, 1]
  )
  check(
    'حلقه‌ی try/finally پنجره‌ی مخفی دست‌نخورده است',
    /const win = new BrowserWindow[\s\S]*?try \{/.test(printerSrc.slice(iPrint, iList)) &&
      /finally \{\s*if \(!win\.isDestroyed\(\)\) win\.destroy\(\)/.test(printerSrc.slice(iPrint, iList)),
    true
  )
  check('کانال print:diagnose تعریف شد', /printDiagnose:\s*'print:diagnose'/.test(readSrc('src/shared/ipc.ts')), true)
  check('هندلر printDiagnose در main ثبت شد', /handle\(IPC\.printDiagnose/.test(readSrc('src/main/ipc/index.ts')), true)
  check('برگه‌ی خط پایه‌ی دستگاه ساخته شد', existsSync(resolve(root, 'docs/print-diagnosis.md')), true)
  check(
    /**
     * نشست ۲۲۲ · فاز ۵ — چهار مسیر رسید در `PrintService` از یک نقطه‌ی مشترک
     * (`printMaybeRaw`) رد می‌شوند که در حالت پیش‌فرض **همان** `printHtml` را با
     * همان `pageSize` صدا می‌زند. پس شمارش ۶ به ۲ رسید (دو مسیر باقی‌مانده‌ی فاز ۶:
     * چاپ اعتبار و دسته‌ای) و شمارش ipc همان ۴ ماند. برای اینکه گارد ضعیف نشود،
     * تعداد فراخوانی‌های `printMaybeRaw` هم بررسی می‌شود.
     */
    'فراخوانی‌های موجود printHtml دست‌نخورده‌اند (۴ در ipc + ۲ در PrintService + ۴ مسیر از router)',
    [
      (readSrc('src/main/ipc/index.ts').match(/await printHtml\(/g) || []).length,
      (readSrc('src/main/services/PrintService.ts').match(/await printHtml\(/g) || []).length,
      (readSrc('src/main/services/PrintService.ts').match(/await printMaybeRaw\(/g) || []).length
    ],
    [4, 2, 4]
  )
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
