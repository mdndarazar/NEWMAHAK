/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۴ طرح چاپ — «چاپ آزمایشی، پیش‌نمایش، حدس نوع چاپگر».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) `guessPrinterKind` طبق فهرست بخش ۷.۳ و فقط به‌عنوان «پیشنهاد».
 *   ۲) `printerKindSuggestion` (نوار پیشنهاد) — متن فارسی و کلید preset، و
 *      خالی‌بودنش برای نامعلوم.
 *   ۳) `buildTestPageHtml`: کادر ۱ میلی‌متری لبه، خط‌کش افقی/عمودی با محور درست،
 *      مستطیل مرجع ۵۰×۲۰، ارقام فارسی و لاتین، بارکد اختیاری، سطر پارامترها،
 *      رول چندستونه با شماره‌ی هر ستون، و اینکه در ارتفاع «خودکار» هیچ اندازه‌ی
 *      ثابتی در `@page` و در قالب نمی‌نشیند (درس فاز ۰).
 *   ۴) مسیر واقعی: هندلر `printTestPage` با ماک Electron + دیتابیس هارنس ⇒
 *      همان resolver (بدون fallback)، همان `printHtml`، و `pageSize` دقیق
 *      میکرونی برای رسید (ارتفاع اندازه‌گیری‌شده) و لیبل دوستونه (عرض ردیف).
 *      چاپگر حذف‌شده یا نام جعلی ⇒ خطای فارسی و **هیچ** چاپی.
 *   ۵) ساختاری: کانال و هندلر سرجایشان هستند و بازه‌ی
 *      `printLabels`…`printDiagnose` دست‌نخورده مانده (قرارداد تست فاز ۲).
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase4-testpage.mjs
 * ===========================================================================
 */
import { register } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s222-p4-'))
process.env.HARNESS_DIR = DIR
process.env.HARNESS_DB = join(DIR, 'shop.db')

register('./support/s129-hooks.mjs', import.meta.url)

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const mock = await import('./support/s129-electron-mock.mjs')
const electron = await import('electron')
const handlers = new Map()
electron.ipcMain.handle = (ch, fn) => handlers.set(ch, fn)

const { harnessClient } = await import('../../test/harness/stubs/prismaClient.mjs')
const db = harnessClient()
const { IPC } = await import(new URL('../../src/shared/ipc.ts', import.meta.url).href)
const { SETTING_KEYS } = await import(new URL('../../src/shared/receipt.ts', import.meta.url).href)
const spec = await import(new URL('../../src/shared/printSpec.ts', import.meta.url).href)
const testPage = await import(new URL('../../src/main/print/testPage.ts', import.meta.url).href)
const target = await import(new URL('../../src/main/print/target.ts', import.meta.url).href)

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
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')
const writeSetting = (key, obj) =>
  db.setting.upsert({
    where: { key },
    update: { value: JSON.stringify(obj) },
    create: { key, value: JSON.stringify(obj) }
  })
const lastPrint = () => mock.state.printCalls[mock.state.printCalls.length - 1]?.options ?? {}
const lastHtml = () => {
  const loads = mock.state.loads
  return loads[loads.length - 1]?.html ?? ''
}

console.log('\n— ۱) guessPrinterKind (بخش ۷.۳)')
{
  check('TSC ⇒ لیبل', spec.guessPrinterKind('TSC TE200'), 'LABEL')
  check('Zebra/ZDesigner ⇒ لیبل', spec.guessPrinterKind('ZDesigner ZD230-203dpi ZPL'), 'LABEL')
  check('Godex/TDP ⇒ لیبل', [spec.guessPrinterKind('Godex G500'), spec.guessPrinterKind('TDP-225')], ['LABEL', 'LABEL'])
  check('فارسی «لیبل» ⇒ لیبل', spec.guessPrinterKind('لیبل‌زن انبار'), 'LABEL')
  check('Axiom ⇒ رسید', spec.guessPrinterKind('Axiom Thermal 80'), 'RECEIPT')
  check('POS/XP-/80mm/58mm ⇒ رسید', [
    spec.guessPrinterKind('POS-80C'),
    spec.guessPrinterKind('XP-58IIH'),
    spec.guessPrinterKind('Thermal Printer 80mm')
  ], ['RECEIPT', 'RECEIPT', 'RECEIPT'])
  check('PDF/OneNote/Fax/XPS ⇒ کاغذی/مجازی', [
    spec.guessPrinterKind('Microsoft Print to PDF'),
    spec.guessPrinterKind('Send To OneNote 2016'),
    spec.guessPrinterKind('Fax'),
    spec.guessPrinterKind('Microsoft XPS Document Writer')
  ], ['PAGE', 'PAGE', 'PAGE', 'PAGE'])
  check('ناشناس و خالی ⇒ نامعلوم', [
    spec.guessPrinterKind('HP LaserJet 1020'),
    spec.guessPrinterKind(''),
    spec.guessPrinterKind(undefined)
  ], ['UNKNOWN', 'UNKNOWN', 'UNKNOWN'])
  check('حروف بزرگ/کوچک فرقی ندارد', [spec.guessPrinterKind('tsc'), spec.guessPrinterKind('AXIOM')], ['LABEL', 'RECEIPT'])
}

console.log('\n— ۲) نوار پیشنهاد (printerKindSuggestion)')
{
  const r = spec.printerKindSuggestion('RECEIPT')
  check('رسید ⇒ پیشنهاد ۸۰ میلی‌متری با متن فارسی', [r?.presetKey, /[\u0600-\u06FF]/.test(r?.text ?? ''), /۸۰/.test(r?.text ?? '')], [
    'THERMAL_80',
    true,
    true
  ])
  const l = spec.printerKindSuggestion('LABEL')
  check('لیبل ⇒ پیشنهاد بدون preset رسید', [l?.presetKey, /پیشرفته/.test(l?.text ?? '')], [null, true])
  check('کاغذی/مجازی ⇒ هشدار مناسب‌نبودن', /مناسب نیست/.test(spec.printerKindSuggestion('PAGE')?.text ?? ''), true)
  check('نامعلوم ⇒ هیچ پیشنهادی', [
    spec.printerKindSuggestion('UNKNOWN'),
    spec.printerKindSuggestion(undefined)
  ], [null, null])
}

console.log('\n— ۳) buildTestPageHtml — رسید ۸۰ میلی‌متری با ارتفاع ثابت')
{
  const html = testPage.buildTestPageHtml('INVOICE', {
    deviceName: 'Axiom Thermal 80',
    widthMm: 80,
    heightMm: 140,
    contentWidthMm: 72,
    columns: 1,
    gapXMm: 0,
    presetLabel: 'فاکتور ۸۰ میلی‌متری',
    barcodeHtml: 'data:image/png;base64,AAA'
  })
  check('کادر ۱ میلی‌متری روی لبه', /border:1mm solid #000/.test(html), true)
  check('اندازه‌ی ارسالی در @page و در قالب', [
    /@page \{ size: 80mm 140mm; margin: 0; \}/.test(html),
    /data-page-size="80x140"/.test(html),
    /width:80mm;/.test(html)
  ], [true, true, true])
  check('خط‌کش افقی با شماره‌ی هر ۱۰ میلی‌متر', [
    /class="rh"/.test(html),
    html.includes('>0</i>') || html.includes('>۰</i>'),
    html.includes('>10</i>') || html.includes('>۱۰</i>'),
    html.includes('>80</i>') || html.includes('>۸۰</i>')
  ], [true, true, true, true])
  check('خط‌کش عمودی محورش top است (درس فاز ۰)', /class="rv">.*style="top:/s.test(html), true)
  check('مستطیل مرجع ۵۰×۲۰ با ابعاد نوشته‌شده', [
    /width:50mm;height:20mm/.test(html),
    /مستطیل مرجع ۵۰×۲۰ میلی‌متر/.test(html)
  ], [true, true])
  check('جمله‌ی فارسی، ارقام فارسی و لاتین', [
    /این برگه برای سنجش اندازه با خط‌کش است/.test(html),
    /ارقام فارسی: ۰۱۲۳۴۵۶۷۸۹/.test(html),
    /ارقام لاتین: 0123456789/.test(html)
  ], [true, true, true])
  check('بارکد و سطر پارامترها (چاپگر، کاغذ، اندازه، موتور)', [
    /<img class="bc"/.test(html),
    /چاپگر: Axiom Thermal 80/.test(html),
    /کاغذ: فاکتور ۸۰ میلی‌متری/.test(html),
    /اندازه‌ی ارسالی: ۸۰×۱۴۰ میلی‌متر/.test(html),
    /موتور: Chromium/.test(html)
  ], [true, true, true, true, true])
  check('بدون ۱۰۰vh (قرارداد اندازه‌گیری)', /100vh/.test(html), false)
  check('بدون بارکد هم برگه ساخته می‌شود', /<img class="bc"/.test(testPage.buildTestPageHtml('INVOICE', {
    deviceName: 'X',
    widthMm: 80,
    heightMm: 140,
    contentWidthMm: 72,
    columns: 1,
    gapXMm: 0,
    presetLabel: '—'
  })), false)
}

console.log('\n— ۴) buildTestPageHtml — ارتفاع خودکار و رول دوستونه')
{
  const auto = testPage.buildTestPageHtml('INVOICE', {
    deviceName: 'Axiom',
    widthMm: 80,
    heightMm: 'AUTO',
    contentWidthMm: 72,
    columns: 1,
    gapXMm: 0,
    presetLabel: 'فاکتور ۸۰ میلی‌متری'
  })
  check('در حالت خودکار هیچ اندازه‌ی ثابتی در @page نیست', [
    /@page \{  margin: 0; \}/.test(auto),
    /@page \{[^}]*auto/.test(auto),
    /data-page-size="80xAUTO"/.test(auto),
    /height:140mm/.test(auto)
  ], [true, false, true, false])
  check('محتوا در حالت خودکار نسبت به خط‌کش جابه‌جا می‌شود (margin)', /position:relative; margin:7mm 0 0 7mm;/.test(auto), true)

  const label = testPage.buildTestPageHtml('LABEL', {
    deviceName: 'TSC TE200',
    widthMm: 102,
    heightMm: 30,
    contentWidthMm: 102,
    columns: 2,
    gapXMm: 2,
    presetLabel: 'لیبل ۵۰×۳۰ میلی‌متر'
  })
  check('عرض ردیف دوستونه و ارتفاع لیبل', [
    /@page \{ size: 102mm 30mm; margin: 0; \}/.test(label),
    /data-page-size="102x30"/.test(label),
    /data-columns="2"/.test(label),
    /grid-template-columns:repeat\(2, 50mm\); column-gap:2mm;/.test(label)
  ], [true, true, true, true])
  check('هر خانه شماره‌ی ستون خودش را دارد', [
    /ستون ۱/.test(label),
    /ستون ۲/.test(label)
  ], [true, true])
  check('لیبل کوتاه ⇒ حالت فشرده (بدون متن توضیحی) و کادر ۱mm لبه‌ی صفحه', [
    /این برگه برای سنجش اندازه/.test(label),
    /border:1mm solid #000/.test(label)
  ], [false, true])
  check('کادر هر خانه‌ی لیبل ۰٫۳ میلی‌متر است', /border:0.3mm solid #000/.test(label), true)

  const single = testPage.buildTestPageHtml('LABEL', {
    deviceName: 'TSC',
    widthMm: 50,
    heightMm: 30,
    contentWidthMm: 50,
    columns: 1,
    gapXMm: 0,
    presetLabel: 'لیبل'
  })
  check('تک‌ستونه ⇒ یک خانه و بدون grid', [
    /data-columns="1"/.test(single),
    /grid-template-columns/.test(single),
    /ستون /.test(single)
  ], [true, false, false])
}

console.log('\n— ۵) محافظ‌های عددی برگه')
{
  const weird = testPage.buildTestPageHtml('INVOICE', {
    deviceName: 'X',
    widthMm: 5,
    heightMm: 5000,
    contentWidthMm: 999,
    columns: 9,
    gapXMm: 999,
    presetLabel: '—'
  })
  check('عرض/ارتفاع/ستون/فاصله به بازه‌ی مجاز clamp می‌شوند', [
    /data-page-size="10x2000"/.test(weird),
    /data-columns="1"/.test(weird)
  ], [true, true])
  const nan = testPage.buildTestPageHtml('LABEL', {
    deviceName: 'X',
    widthMm: Number.NaN,
    heightMm: Number.NaN,
    contentWidthMm: Number.NaN,
    columns: Number.NaN,
    gapXMm: Number.NaN,
    presetLabel: '—'
  })
  check('عدد خراب ⇒ پیش‌فرض‌های امن (۸۰×۱۴۰ و یک ستون)', [
    /data-page-size="80x140"/.test(nan),
    /data-columns="1"/.test(nan)
  ], [true, true])
}

console.log('\n— ۶) مسیر واقعی: هندلر printTestPage با ماک Electron')
{
  const { registerIpcHandlers } = await import(new URL('../../src/main/ipc/index.ts', import.meta.url).href)
  registerIpcHandlers()
  const handler = handlers.get(IPC.printTestPage)
  check('هندلر چاپ آزمایشی ثبت شده است', typeof handler, 'function')
  /**
   * قرارداد واقعی هندلرها: `handler(event, payload)` و خروجی `{ok,data}` یا
   * `{ok:false,error}` — دقیقاً همان چیزی که preload به renderer می‌دهد.
   */
  const call = (payload) => handler(null, payload)

  await writeSetting(SETTING_KEYS.receiptTemplate, {
    printerName: 'Axiom',
    paperPreset: 'THERMAL_80',
    sheetWidthMm: 80,
    sheetHeightMm: 0,
    paperWidthMm: 72,
    askEachTime: false,
    useSystemDialog: false
  })
  await writeSetting(SETTING_KEYS.labelTemplate, {
    printerName: 'TSC TE200',
    widthMm: 50,
    heightMm: 30,
    paperWidthMm: 50,
    columns: 2,
    gapXMm: 2,
    askEachTime: false,
    useSystemDialog: false,
    printMethod: 'CHROMIUM'
  })

  // ---- رسید: ارتفاع خودکار ⇒ اندازه‌گیری محتوا + پاس‌دادن اندازه‌ی دقیق
  mock.reset()
  mock.state.printers = [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false }
  ]
  mock.state.executeJavaScriptOutcome = 500 // ۵۰۰px ≈ ۱۳۲٫۳mm + حاشیه‌ی ایمنی ۳mm
  const r1 = await call({ profile: 'INVOICE' })
  check('چاپ آزمایشی رسید ⇒ موفق و بدون خطا', [r1?.ok, r1?.error ?? null], [true, null])
  check('چاپگر ذخیره‌شده صریح resolve شد', r1?.data?.deviceName, 'Axiom')
  check('pageSize میکرونی: عرض ۸۰mm و ارتفاع اندازه‌گیری‌شده', [
    lastPrint().pageSize?.width,
    Math.round((lastPrint().pageSize?.height ?? 0) / 100) / 10
  ], [80000, 135.3])
  check('حالت بی‌صدا و چاپ پس‌زمینه مثل مسیر واقعی', [lastPrint().silent, lastPrint().printBackground], [true, true])
  check('HTML برگه‌ی آزمایشی با اندازه‌ی همان پروفایل به چاپگر رفت', [
    /data-test-sheet="1"/.test(lastHtml()),
    /data-page-size="80xAUTO"/.test(lastHtml()),
    /چاپگر: Axiom/.test(lastHtml())
  ], [true, true, true])
  check('خروجی کانال برای پیام UI کافی است', [
    r1?.data?.printed,
    r1?.data?.viaWindowsDefault,
    /۸۰/.test(r1?.data?.pageSizeLabel ?? '')
  ], [true, false, true])

  // ---- لیبل: رول دوستونه ⇒ عرض ردیف، ارتفاع لیبل، و شماره‌ی ستون‌ها
  mock.reset()
  mock.state.printers = [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false }
  ]
  const r2 = await call({ profile: 'LABEL' })
  check('چاپ آزمایشی لیبل ⇒ موفق', [r2?.ok, r2?.error ?? null], [true, null])
  check('pageSize = ردیف دوستونه ۱۰۲mm × ارتفاع لیبل ۳۰mm', lastPrint().pageSize, { width: 102000, height: 30000 })
  check('برگه‌ی لیبل دو خانه با شماره‌ی ستون دارد', [
    /data-columns="2"/.test(lastHtml()),
    /ستون ۱/.test(lastHtml()),
    /ستون ۲/.test(lastHtml())
  ], [true, true, true])
  check('چاپگر لیبل ذخیره‌شده به کار رفت', r2?.data?.deviceName, 'TSC TE200')

  // ---- چاپگر انتخابی همین لحظه‌ی فرم (نام از renderer) با اعتبارسنجی main
  mock.reset()
  mock.state.printers = [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false }
  ]
  mock.state.executeJavaScriptOutcome = 400
  const r3 = await call({ profile: 'INVOICE', deviceName: 'TSC TE200' })
  check('نام انتخابی فرم پذیرفته می‌شود', [r3?.ok, lastPrint().deviceName], [true, 'TSC TE200'])

  // ---- چاپگر حذف‌شده ⇒ توقف امن، هیچ چاپی
  mock.reset()
  mock.state.printers = [{ name: 'چاپگر دیگر', displayName: 'Other', isDefault: true }]
  mock.state.executeJavaScriptOutcome = 500
  const r4 = await call({ profile: 'INVOICE' })
  check('چاپگر ذخیره‌شده‌ی حذف‌شده ⇒ خطای فارسی و صفر چاپ', [
    r4?.ok,
    r4?.error?.includes('Axiom'),
    r4?.error?.includes('پیدا نشد'),
    mock.state.printCalls.length
  ], [false, true, true, 0])

  // ---- نام جعلی از renderer ⇒ رد، هیچ چاپی
  mock.reset()
  mock.state.printers = [{ name: 'Axiom', displayName: 'Axiom', isDefault: true }]
  const r5 = await call({ profile: 'LABEL', deviceName: 'چاپگر جعلی' })
  check('نام جعلی ⇒ خطای فارسی و صفر چاپ', [
    r5?.ok,
    r5?.error?.includes('چاپگر جعلی'),
    mock.state.printCalls.length
  ], [false, true, 0])

  // ---- پروفایل نامعتبر ⇒ پیش‌فرض امن INVOICE (نه خطا)، هنوز بدون fallback
  mock.reset()
  mock.state.printers = [{ name: 'Axiom', displayName: 'Axiom', isDefault: true }]
  mock.state.executeJavaScriptOutcome = 400
  const r6 = await call({ profile: 'چیزی‌else' })
  check('پروفایل ناشناس ⇒ INVOICE (رفتار امن)', [r6?.ok, r6?.data?.deviceName], [true, 'Axiom'])

  // ---- دیالوگ ویندوز برای همین پروفایل ⇒ چاپ بی‌صدا نمی‌ماند
  await writeSetting(SETTING_KEYS.receiptTemplate, {
    printerName: 'Axiom',
    useSystemDialog: true,
    askEachTime: false
  })
  mock.reset()
  mock.state.printers = [{ name: 'Axiom', displayName: 'Axiom', isDefault: true }]
  mock.state.executeJavaScriptOutcome = 400
  await call({ profile: 'INVOICE' })
  check('useSystemDialog ⇒ silent:false (دیالوگ ویندوز)', lastPrint().silent, false)
  await writeSetting(SETTING_KEYS.receiptTemplate, { printerName: 'Axiom', useSystemDialog: false })
}

console.log('\n— ۷) ساختاری: کانال، هندلر و سیم‌کشی UI')
{
  check('کانال در shared/ipc تعریف شده', /printTestPage: 'print:testPage'/.test(readSrc('src/shared/ipc.ts')), true)
  const ipc = readSrc('src/main/ipc/index.ts')
  check('هندلر به runPrintTestPage وصل است', /handle\(IPC\.printTestPage, \(p\) => runPrintTestPage\(p \?\? \{\}\)\)/.test(ipc), true)
  check(
    'بازه‌ی printLabels…printDiagnose دست‌نخورده مانده (قرارداد فاز ۲)',
    ipc.indexOf('handle(IPC.printLabels') < ipc.indexOf('handle(IPC.printDiagnose') &&
      !ipc.slice(ipc.indexOf('handle(IPC.printLabels'), ipc.indexOf('handle(IPC.printDiagnose')).includes('printTestPage'),
    true
  )
  const tp = readSrc('src/main/print/testPage.ts')
  check('مسیر آزمایشی از resolver و printHtml عبور می‌کند', [
    /resolvePrintTargetName\(/.test(tp),
    /printHtml\(html, \{/.test(tp),
    /pageSize: \{ widthMm: spec\.widthMm, heightMm: spec\.heightMm, heightSafetyMm: 3 \}/.test(tp)
  ], [true, true, true])
  check('هیچ fallback ای به اولین چاپگر در فایل آزمایشی نیست', /printers\[0\]/.test(tp), false)
  const tg = readSrc('src/main/print/target.ts')
  check('فهرست چاپگرها نوع حدسی را پر می‌کند', /kindGuess: guessPrinterKind\(/.test(tg), true)
  const cards = readSrc('src/renderer/src/components/PrintSettingsCards.tsx')
  check('دکمه‌های «چاپ آزمایشی» و «پیش‌نمایش» در هر کارت', [
    /**
     * نشست ۲۲۲ · فاز ۵ — امضای دکمه‌ی آزمایش یک آرگومان «روش آزمایش» گرفت
     * (Chromium / دقیق RAW)، پس الگو به همان شکل تازه به‌روز شد. سه کارت با
     * `onTest={runTest}` شمرده می‌شوند تا «هر کارت» واقعاً بررسی شود.
     */
    /onClick=\{\(\) => onTest\(profile, value, testMethod \?\? savedMethod \?\? 'CHROMIUM'\)\}/.test(cards),
    /onClick=\{\(\) => onPreview\(profile\)\}/.test(cards),
    /call<\{[^>]*pageSizeLabel: string[^>]*\}>\s*\(\s*CH\.printTestPage/.test(cards),
    (cards.match(/onTest=\{runTest\}/g) || []).length
  ], [true, true, true, 3])
  check('پیش‌نمایش نسبی: خط‌کش داخلی و هشدار DPI', [
    /PX_PER_MM = 96 \/ 25\.4/.test(cards),
    /data-preview-sheet="1"/.test(cards),
    /اندازه‌ی فیزیکی را تضمین نمی‌کند/.test(cards)
  ], [true, true, true])
  check('نوار پیشنهاد فقط پیشنهاد است (اعمال با دکمه)', [
    /printerKindSuggestion\(/.test(cards),
    /onClick=\{suggestion\.apply\}/.test(cards)
  ], [true, true])
  check('«اعمال» پیشنهاد، ابعاد preset را هم ست می‌کند (نه فقط کلید)', /presetToSpec\(key\)/.test(cards), true)
  check('پیش‌نمایش از کانال‌های موجود می‌آید (بدون کانال تازه)', [
    /CH\.printPreviewHtml/.test(cards),
    /CH\.printLabelPreviewHtml/.test(cards)
  ], [true, true])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
