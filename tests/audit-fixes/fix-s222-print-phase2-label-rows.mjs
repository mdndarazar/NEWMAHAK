/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۲ طرح چاپ — «لیبل: واحد چاپ یک ردیف است، نه یک لیبل».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) توابع خالص رول: `labelRowDims` (عرض ردیف = columns×w + (columns−1)×gapX)،
 *      `labelRowCssHeightMm` (h − ۰٫۰۵)، `labelColumns` و `labelRows`
 *      (شروع از ستون + پر شدن ردیف آخر با خانه‌ی خالی).
 *   ۲) مهاجرت `LabelTemplate`: `askEachTime` ⇄ `autoPrint` (داده‌ی قدیمی
 *      `askEachTime` ندارد ⇒ `!autoPrint`)، clamp همه‌ی فیلدهای رول، enumهای
 *      خراب ⇒ پیش‌فرض، و `parse(parse(x)) === parse(x)`.
 *   ۳) HTML ردیف‌محور: `@page size: 102mm 30mm`، هر ردیف دقیقاً columns خانه،
 *      ردیف آخر `break-after:auto`، خانه‌ی خالی `visibility:hidden`، ارتفاع
 *      ردیف ۲۹٫۹۵mm، نبود `page-break-after:always`/`100vh`، و برچسب‌های فارسی
 *      داخل لیبل RTL می‌مانند.
 *   ۴) مسیر چاپ با mock: همان `pageSize` ردیف (میکرون) به `webContents.print`
 *      می‌رسد، `silent` از `askEachTime` می‌آید، و پنجره بسته می‌شود.
 *   ۵) ساختاری: `printLabels` در main از `labelRowDims`/`startColumn` استفاده
 *      می‌کند و مودال لیبل `startColumn` را می‌فرستد.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase2-label-rows.mjs
 * تأیید نهایی روی TSC = آزمون سخت‌افزاری مالک (docs/print-diagnosis.md، حالت «ه»).
 * ===========================================================================
 */
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

register('./support/s129-hooks.mjs', import.meta.url)

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const mock = await import('./support/s129-electron-mock.mjs')
const spec = await import(new URL('../../src/shared/printSpec.ts', import.meta.url).href)
const shared = await import(new URL('../../src/shared/receipt.ts', import.meta.url).href)
const templates = await import(new URL('../../src/main/print/templates.ts', import.meta.url).href)
const printer = await import(new URL('../../src/main/print/printer.ts', import.meta.url).href)

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
const safe = async (fn) => {
  try {
    return { value: await fn() }
  } catch (err) {
    return { error: String(err?.message ?? err) }
  }
}
const optionsOf = (i = 0) => mock.state.printCalls[i]?.options ?? {}
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')

const tpl2 = shared.parseLabelTemplate({ columns: 2, gapXMm: 2, widthMm: 50, heightMm: 30 })
const items = (n) =>
  Array.from({ length: n }, (_v, i) => ({
    name: `کالای ${i + 1}`,
    code: `100${i + 1}`,
    price: 1_000_000,
    barcodeDataUrl: ''
  }))

console.log('\n— ۱) توابع خالص «ردیف لیبل»')
{
  check('labelRowDims: ۲ ستونه ۵۰×۳۰ با فاصله‌ی ۲ ⇒ ردیف ۱۰۲×۳۰', spec.labelRowDims({ widthMm: 50, heightMm: 30, columns: 2, gapXMm: 2, offsetXMm: 0, offsetYMm: 0 }), {
    rowWidthMm: 102,
    rowHeightMm: 30
  })
  check(
    'labelRowDims: تک‌ستونه ⇒ عرض ردیف = عرض لیبل',
    spec.labelRowDims({ widthMm: 50, heightMm: 30, columns: 1, gapXMm: 2, offsetXMm: 0, offsetYMm: 0 }).rowWidthMm,
    50
  )
  check(
    'labelRowDims: ۳ ستونه ۴۰mm با فاصله‌ی ۲ ⇒ ۱۲۴',
    spec.labelRowDims({ widthMm: 40, heightMm: 20, columns: 3, gapXMm: 2, offsetXMm: 0, offsetYMm: 0 }).rowWidthMm,
    124
  )
  check(
    'labelRowDims: ستون خراب (۹) ⇒ ۳ و ۰ ⇒ ۱',
    [
      spec.labelRowDims({ widthMm: 50, heightMm: 30, columns: 9, gapXMm: 2, offsetXMm: 0, offsetYMm: 0 }).rowWidthMm,
      spec.labelRowDims({ widthMm: 50, heightMm: 30, columns: 0, gapXMm: 2, offsetXMm: 0, offsetYMm: 0 }).rowWidthMm
    ],
    [154, 50]
  )
  check('labelRowCssHeightMm(30) = 29.95 (فرضیه‌ی L3)', spec.labelRowCssHeightMm(30), 29.95)
  check('labelRowCssHeightMm(20) = 19.95', spec.labelRowCssHeightMm(20), 19.95)
  check('labelColumns روی NaN ⇒ ۱', spec.labelColumns(Number.NaN), 1)
  check('pageSizeWithinLimits(102,30) معتبر است', spec.pageSizeWithinLimits(102, 30), true)
  check('pageSizeWithinLimits(102,29.95) هم معتبر است', spec.pageSizeWithinLimits(102, 29.95), true)
}

console.log('\n— ۲) labelRows: ستون شروع و ردیف آخر (مثال‌های بخش ۸.۲ طرح)')
{
  const shapes = (n, start) =>
    spec.labelRows(items(n), 2, start).map((row) => row.map((i) => (i === null ? 'خالی' : i.code)))
  check('۱ لیبل ⇒ ۱ ردیف (ستون ۲ خالی)', shapes(1, 1), [['1001', 'خالی']])
  check('۲ لیبل ⇒ ۱ ردیف', shapes(2, 1), [['1001', '1002']])
  check('۳ لیبل ⇒ ۲ ردیف (دومی نیمه‌پر)', shapes(3, 1), [
    ['1001', '1002'],
    ['1003', 'خالی']
  ])
  check('۴ لیبل ⇒ ۲ ردیف', shapes(4, 1), [
    ['1001', '1002'],
    ['1003', '1004']
  ])
  check('۵ لیبل ⇒ ۳ ردیف', shapes(5, 1), [
    ['1001', '1002'],
    ['1003', '1004'],
    ['1005', 'خالی']
  ])
  check('startColumn=2 با ۳ لیبل ⇒ ردیف اول خالی+۱', shapes(3, 2), [
    ['خالی', '1001'],
    ['1002', '1003']
  ])
  check('startColumn=2 با ۱ لیبل ⇒ فقط ستون دوم', shapes(1, 2), [['خالی', '1001']])
  check('startColumn خارج از بازه (۵) ⇒ مثل ۲', shapes(1, 5), [['خالی', '1001']])
  check('بدون لیبل ⇒ هیچ ردیفی (نه یک ردیف خالی)', spec.labelRows([], 2, 2), [])
  check('تک‌ستونه: هیچ خانه‌ی خالی‌ای ساخته نمی‌شود', spec.labelRows(items(3), 1, 1).length, 3)
  check(
    'همه‌ی ردیف‌ها دقیقاً columns خانه دارند',
    spec.labelRows(items(7), 3, 1).every((r) => r.length === 3),
    true
  )
}

console.log('\n— ۳) مهاجرت LabelTemplate (جدول ۵.۳ طرح)')
{
  const legacyOff = shared.parseLabelTemplate({ autoPrint: false, printerName: 'TSC' })
  check('قدیمی autoPrint:false ⇒ askEachTime=true (همان رفتار قبلی)', [legacyOff.askEachTime, legacyOff.autoPrint], [true, false])
  const legacyOn = shared.parseLabelTemplate({ autoPrint: true, printerName: 'TSC' })
  check('قدیمی autoPrint:true ⇒ askEachTime=false', [legacyOn.askEachTime, legacyOn.autoPrint], [false, true])
  check('نام چاپگر در مهاجرت حفظ می‌شود', legacyOn.printerName, 'TSC')
  check('ذخیره‌ی مجدد همیشه autoPrint = !askEachTime', shared.parseLabelTemplate({ askEachTime: true }).autoPrint, false)
  check('default: تک‌ستونه می‌ماند (رفتار فعلی فروشگاه)', shared.DEFAULT_LABEL_TEMPLATE.columns, 1)
  check(
    'default ها: فاصله ۲/۲، offset صفر، GAP، CHROMIUM، ۲۰۳dpi، density ۸، speed ۴، direction ۰',
    [
      shared.DEFAULT_LABEL_TEMPLATE.gapXMm,
      shared.DEFAULT_LABEL_TEMPLATE.gapYMm,
      shared.DEFAULT_LABEL_TEMPLATE.offsetXMm,
      shared.DEFAULT_LABEL_TEMPLATE.offsetYMm,
      shared.DEFAULT_LABEL_TEMPLATE.sensorType,
      shared.DEFAULT_LABEL_TEMPLATE.printMethod,
      shared.DEFAULT_LABEL_TEMPLATE.rawDpi,
      shared.DEFAULT_LABEL_TEMPLATE.density,
      shared.DEFAULT_LABEL_TEMPLATE.speed,
      shared.DEFAULT_LABEL_TEMPLATE.direction,
      shared.DEFAULT_LABEL_TEMPLATE.useSystemDialog
    ],
    [2, 2, 0, 0, 'GAP', 'CHROMIUM', 203, 8, 4, 0, false]
  )
  const wild = shared.parseLabelTemplate({
    columns: 9,
    gapXMm: 99,
    gapYMm: -5,
    offsetXMm: -99,
    offsetYMm: 99,
    sensorType: 'BLACKMARK',
    printMethod: 'RAW',
    rawDpi: 300,
    density: 99,
    speed: 0,
    direction: 1,
    useSystemDialog: 1
  })
  check(
    'clamp فیلدهای رول (جدول ۵.۳)',
    [wild.columns, wild.gapXMm, wild.gapYMm, wild.offsetXMm, wild.offsetYMm],
    [3, 20, 0, -10, 10]
  )
  check(
    'enum/dpi/عددهای RAW درست خوانده می‌شوند',
    [wild.sensorType, wild.printMethod, wild.rawDpi, wild.density, wild.speed, wild.direction, wild.useSystemDialog],
    ['BLACKMARK', 'RAW', 300, 15, 1, 1, true]
  )
  const junk = shared.parseLabelTemplate({ sensorType: 'XYZ', printMethod: 'PDF', rawDpi: 600, direction: 7, columns: 'x' })
  check(
    'enumهای خراب ⇒ پیش‌فرض (GAP/CHROMIUM/203/0/1)',
    [junk.sensorType, junk.printMethod, junk.rawDpi, junk.direction, junk.columns],
    ['GAP', 'CHROMIUM', 203, 0, 1]
  )
  check('parse ایدمپوتنت است', JSON.stringify(shared.parseLabelTemplate(JSON.parse(JSON.stringify(wild)))), JSON.stringify(wild))
  check(
    'همه‌ی فیلدهای تازه در return حاضرند (گارد «فراموش‌شدن فیلد»)',
    [
      'askEachTime',
      'columns',
      'gapXMm',
      'gapYMm',
      'offsetXMm',
      'offsetYMm',
      'sensorType',
      'printMethod',
      'rawDpi',
      'density',
      'speed',
      'direction',
      'useSystemDialog'
    ].every((k) => k in legacyOff),
    true
  )
  check(
    'LABEL_SIZE_PRESETS شامل ۵۰×۳۰ و ۱۰۰×۵۰ است و ۸ مورد دارد',
    [
      shared.LABEL_SIZE_PRESETS.length,
      shared.LABEL_SIZE_PRESETS.some((p) => p.widthMm === 50 && p.heightMm === 30),
      shared.LABEL_SIZE_PRESETS.some((p) => p.widthMm === 100 && p.heightMm === 50)
    ],
    [8, true, true]
  )
  check('labelSizePresetKey(50,30) = 50x30', shared.labelSizePresetKey(50, 30), '50x30')
  check('labelSizePresetKey(45,33) = CUSTOM', shared.labelSizePresetKey(45, 33), 'CUSTOM')
  check('isLabelSensorType/isLabelPrintMethod درست کار می‌کنند', [
    spec.isLabelSensorType('GAP'),
    spec.isLabelSensorType('BLINE'),
    spec.isLabelPrintMethod('RAW'),
    spec.isLabelPrintMethod('CHROMIUM')
  ], [true, false, true, true])
}

console.log('\n— ۴) HTML ردیف‌محور لیبل (بخش ۸.۲)')
{
  const html = templates.labelHtml(items(3), tpl2)
  check('@page اندازه‌ی ردیف را دارد (۱۰۲×۳۰)', /@page \{ size: 102mm 30mm; margin: 0; \}/.test(html), true)
  check('ارتفاع ردیف عمداً ۲۹٫۹۵mm است (صفحه‌ی خالی نسازد)', /height:29\.95mm/.test(html), true)
  check('شبکه‌ی دوستونه با فاصله‌ی ۲mm', /grid-template-columns:repeat\(2, 50mm\); column-gap:2mm/.test(html), true)
  check('ردیف‌ها LTR هستند (ستون ۱ = چپ فیزیکی)', /\.row \{[^}]*direction:ltr/.test(html), true)
  check('متن هر لیبل RTL است', /\.lbl \{[^}]*direction:rtl/.test(html), true)
  check('خانه‌ی خالی visibility:hidden است', /\.lbl\.empty \{ visibility:hidden; \}/.test(html), true)
  check('هر ردیف دقیقاً ۲ خانه دارد', (html.match(/<div class="row">/g) || []).length === 2 && (html.match(/<div class="lbl( empty)?">/g) || []).length === 4, true)
  check('ردیف آخر break-after:auto (نه page)', /\.row:last-child \{ break-after:auto; \}/.test(html), true)
  check('page-break-after قدیمی حذف شد', /page-break-after:always/.test(html), false)
  check('no 100vh', /100vh/.test(html), false)
  check('html/body بدون ارتفاع ثابت (height:auto)', /html, body \{ margin:0; padding:0; height:auto; \}/.test(html), true)
  check('جاوااسکریپت ندارد (فقط HTML/CSS)', /<script/i.test(html), false)
  check('نام کالا escape می‌شود', templates.labelHtml([{ name: '<b>x</b>', code: '1', price: 1, barcodeDataUrl: '' }], tpl2).includes('&lt;b&gt;x&lt;/b&gt;'), true)
}

console.log('\n— ۵) استارت از ستون در HTML (رول نیمه‌مصرف)')
{
  const html = templates.labelHtml(items(3), tpl2, { startColumn: 2 })
  check('ردیف اول با خانه‌ی خالی شروع می‌شود', /<div class="row"><div class="lbl empty"><\/div><div class="lbl">/.test(html), true)
  check('همان ۲ ردیف و ۴ خانه (یکی خالی)', [(html.match(/<div class="row">/g) || []).length, (html.match(/class="lbl empty"/g) || []).length], [2, 1])
  const single = templates.labelHtml(items(2), shared.parseLabelTemplate({ columns: 1, widthMm: 50, heightMm: 30 }))
  check('تک‌ستونه: هر ردیف یک خانه و هیچ خانه‌ی خالی‌ای نیست', [
    /grid-template-columns:repeat\(1, 50mm\)/.test(single),
    (single.match(/class="lbl empty"/g) || []).length
  ], [true, 0])
  const off = templates.labelHtml(items(1), shared.parseLabelTemplate({ columns: 2, widthMm: 50, heightMm: 30, offsetXMm: 1, offsetYMm: -1 }))
  check('offset در CSS می‌آید (left/top)', /left:1mm; top:-1mm/.test(off), true)
}

console.log('\n— ۶) مسیر چاپ: همان pageSize ردیف به Electron می‌رسد')
{
  mock.reset()
  const tpl = shared.parseLabelTemplate({ columns: 2, gapXMm: 2, widthMm: 50, heightMm: 30, askEachTime: false })
  const dims = spec.labelRowDims(tpl)
  const r = await safe(() =>
    printer.printHtml(templates.labelHtml(items(3), tpl, { startColumn: 1 }), {
      silent: tpl.askEachTime !== true,
      deviceName: tpl.printerName || undefined,
      pageSize: { widthMm: dims.rowWidthMm, heightMm: dims.rowHeightMm }
    })
  )
  check('بدون خطا و یک بار رفتن به چاپگر', [r.error ?? null, mock.state.printCalls.length], [null, 1])
  check('pageSize میکرونی ردیف = ۱۰۲۰۰۰×۳۰۰۰۰', optionsOf().pageSize, { width: 102000, height: 30000 })
  check('askEachTime=false ⇒ silent=true (بدون پنجره)', optionsOf().silent, true)
  check('در رول ارتفاع ثابت است ⇒ هیچ اندازه‌گیری‌ای اجرا نمی‌شود', mock.state.executeJavaScriptCalls.length, 0)
  check('پنجره‌ی مخفی بسته شد', mock.state.windows.every((w) => w.isDestroyed()), true)

  mock.reset()
  const ask = shared.parseLabelTemplate({ columns: 2, widthMm: 50, heightMm: 30, askEachTime: true })
  const askDims = spec.labelRowDims(ask)
  await safe(() =>
    printer.printHtml(templates.labelHtml(items(1), ask), {
      silent: ask.askEachTime !== true,
      pageSize: { widthMm: askDims.rowWidthMm, heightMm: askDims.rowHeightMm }
    })
  )
  check('askEachTime=true ⇒ silent=false (پنجره‌ی ویندوز)', optionsOf().silent, false)
  check('یک لیبل روی رول دوستونه ⇒ همان صفحه‌ی ردیف', optionsOf().pageSize, { width: 102000, height: 30000 })
}

console.log('\n— ۷) ساختاری: سیم‌کشی main و رندرر')
{
  const ipc = readSrc('src/main/ipc/index.ts')
  const handler = ipc.slice(ipc.indexOf('handle(IPC.printLabels'), ipc.indexOf('handle(IPC.printDiagnose'))
  check('printLabels از labelRowDims اندازه می‌سازد', /labelRowDims\(tpl\)/.test(handler), true)
  check('printLabels همان pageSize ردیف را می‌فرستد', /pageSize: \{ widthMm: rowWidthMm, heightMm: rowHeightMm \}/.test(handler), true)
  check('printLabels ستون شروع را پاس می‌دهد', /startColumn: Number\(p\?\.startColumn \?\? 1\)/.test(handler), true)
  check('silent از payload رندرر می‌آید؛ پیش‌فرض بی‌صداست (نه autoPrint)', /silent: p\?\.silent \?\? true/.test(handler), true)
  check('printLabels هنوز لیبل خالی را رد می‌کند', /لیبلی برای چاپ انتخاب نشده/.test(handler), true)
  const templatesSrc = readSrc('src/main/print/templates.ts')
  check('امضای labelHtml گزینه‌ی startColumn دارد', /export function labelHtml\([\s\S]{0,220}opts\?: \{ startColumn\?: number \}/.test(templatesSrc), true)
  check('labelHtml از labelRows استفاده می‌کند', /labelRows\(items, columns, opts\?\.startColumn \?\? 1\)/.test(templatesSrc), true)
  const modal = readSrc('src/renderer/src/components/LabelPrintModal.tsx')
  check('مودال state شروع از ستون دارد', /const \[startColumn, setStartColumn\] = useState\(1\)/.test(modal), true)
  check('مودال startColumn را در payload می‌فرستد', /template: \{ showName: mode !== 'NONE' \},\s*startColumn/.test(modal), true)
  check('مودال فقط روی رول چندستونه انتخاب ستون می‌دهد', /\{label\.columns > 1 && \(/.test(modal), true)
  check('تعداد فراخوانی printHtml در ipc دست‌نخورده (۴)', (ipc.match(/await printHtml\(/g) || []).length, 4)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
