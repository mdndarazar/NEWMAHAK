/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۱ طرح چاپ — «اندازه‌ی فاکتور».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) توابع خالص فاز ۱: `presetToSpec`، `receiptFontScale`، `receiptPageSpec`
 *      (ضریب فونت برای ۷۲mm دقیقاً ۱ ⇒ ظاهر فعلی فروشگاه عوض نمی‌شود).
 *   ۲) مهاجرت تنبل قالب فاکتور: JSON قدیمی بدون فیلدهای تازه ⇒ کاغذ ۸۰ برای
 *      ۷۲mm و کاغذ ۵۸ برای ۴۸mm (بخش ۱۳ طرح)، clamp بازه‌ها، اعتبارسنجی
 *      enumها، و `parse(parse(x)) === parse(x)`.
 *   ۳) HTML فاکتور: عرض body = عرض کاغذ، فونت pt، `@page size` فقط در ارتفاع
 *      ثابت، نبود `100vh`، جدول `table-layout:fixed` با عرض ستون‌ها، escape شدن
 *      نام کالا، و **دست‌نخورده‌ماندن مسیر قدیمی گزارش A4**.
 *   ۴) `printHtml` با mock: میکرونِ عدد صحیح، ارتفاع `'AUTO'` = اندازه‌گیری +
 *      ایمنی، فراخوانی قدیمی بدون `pageSize` هیچ اندازه‌گیری/اندازه‌ای نمی‌فرستد،
 *      و شکست/مهلت اندازه‌گیری ⇒ خطای فارسی و **هیچ چاپی** (نتیجه‌ی قطعی).
 *   ۵) ساختاری: چهار تابع چاپ فاکتور در `PrintService` اندازه را می‌فرستند،
 *      `printReceipt` هم همین‌طور، صفحه‌ی عمده `profile:'WHOLESALE'` می‌فرستد، و
 *      ترتیب توابع `printer.ts` دست‌نخورده است.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase1-receipt-size.mjs
 * این تست روی ماک کنترل‌پذیر Electron اجرا می‌شود و جای چاپ واقعی روی دستگاه را
 * نمی‌گیرد (تأیید نهایی اندازه = آزمون‌های سخت‌افزاری مالک، docs/print-diagnosis.md).
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
const safe = async (fn) => {
  try {
    return { value: await fn() }
  } catch (err) {
    return { error: toUserMessage(err) }
  }
}
const optionsOf = (i = 0) => mock.state.printCalls[i]?.options ?? {}
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')
const countOf = (src, needle) => src.split(needle).length - 1

console.log('\n— ۱) توابع خالص اندازه‌ی فاکتور')
{
  check('preset THERMAL_80 = کاغذ ۸۰ / ارتفاع خودکار / قابل‌چاپ ۷۲', spec.presetToSpec('THERMAL_80'), {
    sheetWidthMm: 80,
    sheetHeightMm: 0,
    paperWidthMm: 72
  })
  check('preset THERMAL_58 = کاغذ ۵۸ / ۴۸', spec.presetToSpec('THERMAL_58'), {
    sheetWidthMm: 58,
    sheetHeightMm: 0,
    paperWidthMm: 48
  })
  check('preset FIXED_80x140 = ارتفاع ۱۴۰', spec.presetToSpec('FIXED_80x140'), {
    sheetWidthMm: 80,
    sheetHeightMm: 140,
    paperWidthMm: 72
  })
  check('preset A5 = کاغذ ۱۴۸ / ارتفاع ۲۱۰ / قابل‌چاپ ۱۳۶', spec.presetToSpec('A5'), {
    sheetWidthMm: 148,
    sheetHeightMm: 210,
    paperWidthMm: 136
  })
  check('preset A4 = کاغذ ۲۱۰ / ارتفاع ۲۹۷ / قابل‌چاپ ۱۹۴', spec.presetToSpec('A4'), {
    sheetWidthMm: 210,
    sheetHeightMm: 297,
    paperWidthMm: 194
  })
  check('preset CUSTOM مقدار ثابتی ندارد', spec.presetToSpec('CUSTOM'), null)
  check(
    'ضریب فونت: ۷۲mm دقیقاً ۱ · کف ۰٫۸ روی کاغذ ۵۸ · سقف ۱٫۶ · autoFont خاموش = ۱',
    [
      spec.receiptFontScale(72, true),
      spec.receiptFontScale(48, true),
      spec.receiptFontScale(300, true),
      spec.receiptFontScale(72, false)
    ],
    [1, 0.8, 1.6, 1]
  )
  check(
    'ضریب فونت کاغذ ۵۸ (عرض قابل‌چاپ ۴۸ در preset، ولی مقدار دلخواه هم درست مقیاس می‌خورد)',
    Math.abs(spec.receiptFontScale(58, true) - 58 / 72) < 1e-12,
    true
  )

  const D = shared.DEFAULT_RECEIPT_TEMPLATE
  const defaultSpec = spec.receiptPageSpec(D, 'RETAIL')
  check('پیش‌فرض: کاغذ ۸۰، ارتفاع خودکار، عرض قابل‌چاپ ۷۲', [defaultSpec.widthMm, defaultSpec.heightMm, defaultSpec.contentWidthMm], [80, 'AUTO', 72])
  check('پیش‌فرض: فونت ۹pt (همان ۱۲px امروز) و ضریب ۱', [defaultSpec.fontPt, defaultSpec.fontScale], [9, 1])
  check('پیش‌فرض: عرض قابل‌چاپ = کاغذ − ۲×حاشیه (تداوم ظاهر قبلی)', [D.sheetWidthMm - 2 * D.marginXMm, D.paperWidthMm], [72, 72])

  const fixedSpec = spec.receiptPageSpec({ ...D, sheetHeightMm: 140 }, 'RETAIL')
  check('ارتفاع ثابت ۱۴۰ در spec می‌آید', fixedSpec.heightMm, 140)
  const wholeSame = spec.receiptPageSpec({ ...D, wholesaleSeparate: false }, 'WHOLESALE')
  check('عمده بدون «کاغذ جدا» = همان تکی', [wholeSame.widthMm, wholeSame.contentWidthMm], [80, 72])
  const wholeSep = spec.receiptPageSpec({ ...D, wholesaleSeparate: true }, 'WHOLESALE')
  check(
    'عمده با کاغذ جدا: A5 و عرض ۱۹۰ با ضریب فونت سقف‌دار می‌شود',
    [wholeSep.widthMm, wholeSep.heightMm, wholeSep.contentWidthMm, wholeSep.fontScale],
    [210, 'AUTO', 190, 1.6]
  )
  const wide = spec.receiptPageSpec({ ...D, paperWidthMm: 99000 }, 'RETAIL')
  check('spec هم مثل parse سقف‌دار است (مقدار خراب اندازه‌ی عجیب نمی‌سازد)', wide.contentWidthMm <= 290, true)
}

console.log('\n— ۲) مهاجرت تنبل و clamp قالب فاکتور')
{
  const legacy = shared.parseReceiptTemplate(JSON.stringify({ paperWidthMm: 72, printerName: 'X', autoPrint: true }))
  check('JSON قدیمی ۷۲ ⇒ کاغذ ۸۰ و preset مشتق', [legacy.sheetWidthMm, legacy.paperPreset], [80, 'THERMAL_80'])
  check(
    'مقدارهای موجود حفظ می‌شوند و فیلد تازه پیش‌فرض می‌گیرد',
    [legacy.printerName, legacy.autoPrint, legacy.paperWidthMm, legacy.fontSizePx, legacy.askEachTime, legacy.autoFont, legacy.printMethod],
    ['X', true, 72, 12, false, true, 'CHROMIUM']
  )
  const legacy58 = shared.parseReceiptTemplate({ paperWidthMm: 48 })
  check('JSON قدیمی ۴۸ ⇒ کاغذ ۵۸', [legacy58.sheetWidthMm, legacy58.paperPreset], [58, 'THERMAL_58'])
  const legacyBig = shared.parseReceiptTemplate({ paperWidthMm: 190 })
  check('عرض پهن ⇒ «دلخواه» با حفظ عرض کل قبلی (۱۹۰+۲×۴)', [legacyBig.paperPreset, legacyBig.sheetWidthMm], ['CUSTOM', 198])
  check(
    'clamp عرض/ارتفاع کاغذ و عرض قابل‌چاپ',
    [
      shared.parseReceiptTemplate({ sheetWidthMm: 5 }).sheetWidthMm,
      shared.parseReceiptTemplate({ sheetWidthMm: 9999 }).sheetWidthMm,
      shared.parseReceiptTemplate({ sheetHeightMm: 10 }).sheetHeightMm,
      shared.parseReceiptTemplate({ sheetHeightMm: 5000 }).sheetHeightMm,
      shared.parseReceiptTemplate({ sheetHeightMm: 0 }).sheetHeightMm,
      shared.parseReceiptTemplate({ paperWidthMm: 5000 }).paperWidthMm,
      shared.parseReceiptTemplate({ paperWidthMm: 1 }).paperWidthMm
    ],
    [40, 300, 40, 2000, 0, 290, 30]
  )
  check(
    'clamp حاشیه‌ها و حاشیه‌ی ایمنی',
    [
      shared.parseReceiptTemplate({ marginXMm: -5 }).marginXMm,
      shared.parseReceiptTemplate({ marginXMm: 99 }).marginXMm,
      shared.parseReceiptTemplate({ marginYMm: -1 }).marginYMm,
      shared.parseReceiptTemplate({ heightSafetyMm: 50 }).heightSafetyMm
    ],
    [0, 20, 0, 10]
  )
  check(
    'enumهای موتور چاپ اعتبارسنجی می‌شوند (مقدار خراب ⇒ رفتار امروز)',
    [
      shared.parseReceiptTemplate({ printMethod: 'RAW' }).printMethod,
      shared.parseReceiptTemplate({ printMethod: 'X' }).printMethod,
      shared.parseReceiptTemplate({ rawDpi: 300 }).rawDpi,
      shared.parseReceiptTemplate({ rawDpi: 150 }).rawDpi,
      shared.parseReceiptTemplate({ cutMode: 'NONE' }).cutMode,
      shared.parseReceiptTemplate({ cutMode: 'X' }).cutMode
    ],
    ['RAW', 'CHROMIUM', 300, 203, 'NONE', 'FULL']
  )
  const twice = shared.parseReceiptTemplate(shared.parseReceiptTemplate({ paperWidthMm: 48 }))
  check('parse(parse(x)) = parse(x) — ذخیره‌ی دوباره مقدارها را عوض نمی‌کند', twice, legacy58)
  check(
    'همه‌ی فیلدهای تازه پس از parse حاضرند (گارد return/g merges)',
    Object.keys(shared.DEFAULT_RECEIPT_TEMPLATE).filter((k) => !(k in legacy)),
    []
  )
  const explicit = shared.parseReceiptTemplate({ ...shared.DEFAULT_RECEIPT_TEMPLATE, paperPreset: 'CUSTOM', sheetWidthMm: 100 })
  check('مقدار صریح کاربر دست‌نخورده می‌ماند', [explicit.sheetWidthMm, explicit.paperPreset], [100, 'CUSTOM'])
  const presetOnly = shared.parseReceiptTemplate({ paperPreset: 'A5' })
  check('preset صریح بدون اندازه ⇒ اندازه‌های همان preset', [presetOnly.sheetWidthMm, presetOnly.sheetHeightMm], [148, 210])
}

console.log('\n— ۳) HTML فاکتور (اندازه، فونت، جدول، مسیر قدیمی)')
{
  const data = {
    receiptNo: 12,
    dateJalali: '1405/07/12',
    time: '12:30',
    shopName: 'فروشگاه تست',
    orderTypeLabel: 'داخلی',
    tableNo: '۲',
    customerName: 'مشتری عمومی',
    items: [{ name: 'کالای <تست>', qty: 2, unitPrice: 1000, lineTotal: 2000 }],
    goodsTotal: 2000,
    grandTotal: 2000
  }
  const html = templates.receiptHtml(data)
  check('عرض body = عرض کاغذ (۸۰mm) و ارتفاع خودکار', [/body \{[^}]*width:80mm/, /@page \{ margin: 0; \}/].map((r) => r.test(html)), [true, true])
  check('در حالت خودکار هیچ size ای در @page نیست', /@page\s*\{[^}]*size/.test(html), false)
  check('فونت ۹pt = همان ۱۲px قبلی · هیچ ارتفاع ثابتی (100vh) در قالب نیست', [html.includes('font-size:9pt'), /100vh/.test(html)], [true, false])
  check('عرض بارکد از عرض قابل‌چاپ (۷۲−۱۴=۵۸)', html.includes('max-width:58mm'), true)
  check(
    'جدول fixed با عرض ستون‌ها (ردیف ۸٪ · تعداد ۱۴٪ · مبلغ ۲۲٪)',
    [/table-layout:fixed/.test(html), html.includes('<colgroup><col style="width:8%"><col><col style="width:14%"><col style="width:22%">')],
    [true, true]
  )
  check('نام کالا escape می‌شود و در ستون nm است', html.includes('<td class="nm">کالای &lt;تست&gt;</td>'), true)
  check('جمع کل و مبالغ دست‌نخورده چاپ می‌شوند', html.includes('قابل پرداخت'), true)

  const fixed = templates.receiptHtml(data, { sheetHeightMm: 140 })
  check('ارتفاع ثابت ⇒ @page size با همان ابعاد', fixed.includes('@page { size: 80mm 140mm; margin: 0; }'), true)

  const p58 = templates.receiptHtml(data, { paperWidthMm: 48, sheetWidthMm: 58 })
  check('کاغذ ۵۸: عرض و فونت کوچک‌تر', [p58.includes('width:58mm'), p58.includes('font-size:7.2pt')], [true, true])

  const a4 = templates.reportHtml('گزارش تست', ['الف'], [['۱']])
  check(
    'مسیر قدیمی گزارش A4 مو‌به‌مو دست‌نخورده است',
    a4.includes('width:210mm; margin:0; padding:6mm 4mm; font-size:11px;'),
    true
  )
  const thermal = templates.summaryThermalHtml('خلاصه', [{ label: 'فروش', value: '۱' }])
  check('خلاصه‌ی حرارتی هم روی مسیر قدیمی مانده (فاز ۶)', thermal.includes('width:72mm; margin:0; padding:6mm 4mm;'), true)

  const ex = templates.exchangeReceiptHtml({
    exchangeReceiptNo: 1,
    sourceReceiptNo: 2,
    dateJalali: '1405/07/12',
    time: '12:30',
    returnedItems: [],
    returnTotal: 0,
    replacementItems: [],
    exchangeTotal: 0,
    diff: 0,
    settlementLabel: '—',
    cashReceived: 0
  })
  check('سند تعویض هم همان اندازه/فونت فاکتور را می‌گیرد', [ex.includes('width:80mm'), ex.includes('font-size:9pt')], [true, true])
  const ret = templates.returnReceiptHtml({
    returnId: 1,
    sourceReceiptNo: 2,
    dateJalali: '1405/07/12',
    time: '12:30',
    items: [],
    total: 0,
    refundMethod: 'NONE',
    refundMethodLabel: '—',
    refundAmount: 0,
    restocked: false,
    restockedQty: 0
  })
  check('رسید برگشت هم همان اندازه/فونت را می‌گیرد', [ret.includes('width:80mm'), ret.includes('font-size:9pt')], [true, true])
  const debt = templates.debtPaymentReceiptHtml({
    paymentId: 1,
    invoiceId: 1,
    receiptNo: 10,
    seq: 1,
    shopName: 'فروشگاه تست',
    customerName: null,
    dateJalali: '1405/07/12',
    time: '12:30',
    amount: 1000,
    methodLabel: 'نقدی',
    kind: 'CASH',
    chequeNo: null,
    bankName: null,
    dueDateJalali: null,
    remainingAfter: 0,
    remainingSource: 'LIVE_AT_PRINT',
    settled: true,
    laterChange: null,
    reprint: false
  })
  check('فیش پرداخت نسیه هم همان اندازه/فونت را می‌گیرد', [debt.includes('width:80mm'), debt.includes('font-size:9pt')], [true, true])
}

console.log('\n— ۴) printHtml: pageSize میکرونی، اندازه‌گیری و قرارداد خطا')
{
  const html = '<!doctype html><html><body>تست</body></html>'

  mock.reset()
  mock.state.executeJavaScriptOutcome = 1134 // px ⇒ ۳۰۰٫۱mm ⇒ +۳ ایمنی
  await printer.printHtml(html, { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO', heightSafetyMm: 3 } })
  check('AUTO ⇒ ارتفاع اندازه‌گیری‌شده + ایمنی، میکرون عدد صحیح', optionsOf().pageSize, { width: 80000, height: 303100 })
  check('اندازه‌گیری فقط یک بار انجام می‌شود', mock.state.executeJavaScriptCalls.length, 1)

  mock.reset()
  await printer.printHtml(html, { silent: true, pageSize: { widthMm: 80, heightMm: 140 } })
  check('ارتفاع ثابت ⇒ بدون اندازه‌گیری', [optionsOf().pageSize, mock.state.executeJavaScriptCalls.length], [{ width: 80000, height: 140000 }, 0])

  mock.reset()
  await printer.printHtml(html, { silent: true })
  check('فراخوانی قدیمی: نه pageSize نه اندازه‌گیری (سازگاری کامل)', ['pageSize' in optionsOf(), mock.state.executeJavaScriptCalls.length], [false, 0])

  mock.reset()
  mock.state.executeJavaScriptOutcome = 'reject'
  const failed = await safe(() => printer.printHtml(html, { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO' } }))
  check(
    'شکست اندازه‌گیری ⇒ خطای فارسی و هیچ چاپی (نتیجه‌ی قطعی)',
    [!!failed.error, /اندازه‌گیری/.test(failed.error ?? ''), mock.state.printCalls.length],
    [true, true, 0]
  )

  mock.reset()
  mock.state.executeJavaScriptOutcome = 'hang'
  const timedOut = await safe(() =>
    printer.printHtml(html, { silent: true, timeoutMs: 40, pageSize: { widthMm: 80, heightMm: 'AUTO' } })
  )
  check(
    'مهلت اندازه‌گیری ⇒ خطای فارسی و هیچ چاپی',
    [!!timedOut.error, mock.state.printCalls.length],
    [true, 0]
  )

  // ۵px ≈ ۱٫۳mm و با ایمنی ۳mm هم زیر کف مجاز (۱۰mm) می‌ماند ⇒ باید رد شود
  mock.reset()
  mock.state.executeJavaScriptOutcome = 5
  const tooSmall = await safe(() => printer.printHtml(html, { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO' } }))
  check('ارتفاع کمتر از کف مجاز ⇒ خطای فارسی و هیچ چاپی', [!!tooSmall.error, mock.state.printCalls.length], [true, 0])

  // ارتفاع غیرواقعی بزرگ (بالای سقف ۲۰۰۰mm) ⇒ همان BusinessError، نه چاپ با اندازه‌ی حدسی
  mock.reset()
  mock.state.executeJavaScriptOutcome = 10_000_000
  const tooTall = await safe(() => printer.printHtml(html, { silent: true, pageSize: { widthMm: 80, heightMm: 'AUTO' } }))
  check('ارتفاع بیشتر از سقف مجاز ⇒ خطای فارسی و هیچ چاپی', [!!tooTall.error, mock.state.printCalls.length], [true, 0])
}

console.log('\n— ۵) ساختاری: مسیرهای چاپ فاکتور اندازه را می‌فرستند')
{
  const svc = readSrc('src/main/services/PrintService.ts')
  const ipc = readSrc('src/main/ipc/index.ts')
  const salesInvoice = readSrc('src/renderer/src/pages/SalesInvoice.tsx')
  const tpl = readSrc('src/main/print/templates.ts')

  check('چهار تابع چاپ فاکتور در PrintService از receiptPageSpec می‌گیرند', countOf(svc, 'receiptPageSpec(tpl'), 4)
  check('هر چهار فراخوانی pageSize را به printHtml می‌دهند', countOf(svc, 'heightSafetyMm: tpl.heightSafetyMm'), 4)
  /**
   * ⚠️ عدد در فاز ۶ عمداً از ۱ به ۲ رفت: طبق جدول بخش ۲.۲ طرح، «خلاصه‌ی حرارتی»
   * (بستن صندوق/سرجمع فروش) هم باید عرض کاغذ را اعلام کند. عدد ثابت می‌ماند تا
   * اگر روزی جای سومی اضافه شد، این تست بی‌صدا سبز نماند.
   */
  check('چاپ آزمایشی تنظیمات (printReceipt) و خلاصه‌ی حرارتی (فاز ۶) اندازه را می‌فرستند', countOf(ipc, 'receiptPageSpec(tpl'), 2)
  check('صفحه‌ی فاکتور عمده profile=WHOLESALE می‌فرستد', salesInvoice.includes("profile: 'WHOLESALE'"), true)
  check(
    'قالب‌های فاکتور از base(spec) استفاده می‌کنند و base مسیر قدیمی را نگه داشته',
    [countOf(tpl, 'receiptPageSpec(t, '), tpl.includes("typeof specOrWidth === 'string'")],
    [4, true]
  )
  const printerSrc = readSrc('src/main/print/printer.ts')
  check(
    'ترتیب printHtml → listPrinters → pdfFromHtml دست‌نخورده',
    [
      printerSrc.indexOf('export async function printHtml') < printerSrc.indexOf('export async function listPrinters'),
      printerSrc.indexOf('export async function listPrinters') < printerSrc.indexOf('export async function pdfFromHtml')
    ],
    [true, true]
  )
}

console.log(`\n✓ ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
