/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۳ طرح چاپ — «resolver چاپگر، ذخیره‌ی پیش‌فرض و جریان پرسش».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) `pickPrinter` (تابع خالص resolver): نام درخواستی ⇒ نام ذخیره‌شده ⇒
 *      چاپگر پیش‌فرض ویندوز، و **هیچ fallback خودکاری** (نام ناموجود = خطا).
 *   ۲) `listPrintersDetailed` روی ماک Electron: نقشه‌ی درست + بستن پنجره‌ی مخفی.
 *   ۳) `mergeFreshPrinter`: فقط نام چاپگر از نسخه‌ی تازه می‌آید (ضد ذخیره‌ی کهنه).
 *   ۴) `printWith` (جریان پرسش): بی‌پرس ⇒ بدون پرسش؛ با پرسش ⇒ پنجره؛ انصراف ⇒
 *      `CANCELLED` **بدون هیچ چاپی و بدون تغییر تنظیمات**؛ «ذخیره به‌عنوان
 *      پیش‌فرض» فقط بعد از چاپ موفق؛ حالت دیالوگ ویندوز ⇒ `silent:false`.
 *   ۵) ساختاری: مسیرهای چاپ main از resolver عبور می‌کنند، `printSetDefault`
 *      نام را با فهرست زنده اعتبارسنجی می‌کند، و همه‌ی نقاط چاپ renderer از
 *      `printWith` می‌گذرند (هیچ نقطه‌ای جا نمانده باشد).
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase3-printer-resolver.mjs
 * ===========================================================================
 */
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

register('./support/s129-hooks.mjs', import.meta.url)

const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
const mock = await import('./support/s129-electron-mock.mjs')
const target = await import(new URL('../../src/main/print/target.ts', import.meta.url).href)
const shared = await import(new URL('../../src/shared/receipt.ts', import.meta.url).href)
const { IPC } = await import(new URL('../../src/shared/ipc.ts', import.meta.url).href)

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

const P = (name, isDefault = false) => ({ name, displayName: name, isDefault, kindGuess: 'UNKNOWN' })
const printers = [P('Axiom', true), P('TSC TE200')]

console.log('\n— ۱) pickPrinter: قواعد بخش ۶.۲ (بدون Electron)')
{
  check('نام درخواستی موجود ⇒ همان چاپگر', target.pickPrinter(printers, 'TSC TE200'), {
    deviceName: 'TSC TE200',
    viaWindowsDefault: false
  })
  check('نام ذخیره‌شده وقتی درخواستی نیست', target.pickPrinter(printers, '', 'TSC TE200'), {
    deviceName: 'TSC TE200',
    viaWindowsDefault: false
  })
  check('درخواستی بر ذخیره‌شده مقدم است', target.pickPrinter(printers, 'TSC TE200', 'Axiom'), {
    deviceName: 'TSC TE200',
    viaWindowsDefault: false
  })
  check('نام خالی ⇒ پیش‌فرض ویندوز (صریح)', target.pickPrinter(printers, '', ''), {
    deviceName: 'Axiom',
    viaWindowsDefault: true
  })
  check('فاصله‌های اضافه‌ی نام نادیده گرفته می‌شود', target.pickPrinter(printers, '  TSC TE200  '), {
    deviceName: 'TSC TE200',
    viaWindowsDefault: false
  })

  const ghost = await safe(() => target.pickPrinter(printers, 'چاپگر جعلی'))
  check(
    'نام ناموجود ⇒ خطای فارسی با نام خودش (هیچ fallback ای نیست)',
    [typeof ghost.error, ghost.error?.includes('چاپگر جعلی'), ghost.error?.includes('پیدا نشد'), ghost.value ?? null],
    ['string', true, true, null]
  )
  const ghostSaved = await safe(() => target.pickPrinter(printers, '', 'چاپگر حذف‌شده'))
  check('نام ذخیره‌شده‌ی حذف‌شده هم خطا می‌دهد (نه رفتن روی اولین چاپگر)', [
    ghostSaved.error?.includes('چاپگر حذف‌شده'),
    ghostSaved.value ?? null
  ], [true, null])
  const noDefault = await safe(() => target.pickPrinter([P('A'), P('B')], ''))
  check('بدون چاپگر پیش‌فرض ⇒ همان پیام ثابت', noDefault.error, target.NO_DEFAULT_PRINTER_MESSAGE)
  const none = await safe(() => target.pickPrinter([], ''))
  check('بدون هیچ چاپگری ⇒ پیام «نصب نیست»', none.error, target.NO_PRINTER_MESSAGE)
  check(
    'پیام‌ها فارسی و با نام چاپگر هستند',
    /[\u0600-\u06FF]/.test(target.NO_DEFAULT_PRINTER_MESSAGE) &&
      /[\u0600-\u06FF]/.test(target.NO_PRINTER_MESSAGE) &&
      target.printerNotFoundMessage('X').includes('X'),
    true
  )
}

console.log('\n— ۲) listPrintersDetailed + resolvePrintTargetName (با ماک Electron)')
{
  mock.reset()
  mock.state.printers = [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false }
  ]
  const list = await target.listPrintersDetailed()
  /**
   * نوع حدسی از فاز ۴ روی نام/توضیح چاپگر پر می‌شود (`guessPrinterKind`)، پس این
   * انتظار با آن فاز به‌روز شده است؛ بقیه‌ی نقشه (نام/نمایشی/پیش‌فرض) بی‌تغییر است.
   */
  check('نقشه‌ی کامل فهرست (نام نمایشی + پیش‌فرض + نوع حدسی)', list, [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true, kindGuess: 'RECEIPT' },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false, kindGuess: 'LABEL' }
  ])
  check('پنجره‌ی مخفی بسته شد (قرارداد پاک‌سازی)', mock.state.windows.every((w) => w.isDestroyed()), true)

  const r1 = await safe(() => target.resolvePrintTargetName({ requestedDeviceName: 'TSC TE200' }))
  check('resolve: نام درخواستی معتبر ⇒ همان', r1.value, { deviceName: 'TSC TE200', viaWindowsDefault: false })
  const r2 = await safe(() => target.resolvePrintTargetName({ savedName: 'TSC TE200' }))
  check('resolve: نام ذخیره‌شده ⇒ همان', r2.value, { deviceName: 'TSC TE200', viaWindowsDefault: false })
  const r3 = await safe(() => target.resolvePrintTargetName({}))
  check('resolve: هیچ نامی ⇒ پیش‌فرض ویندوز', r3.value, { deviceName: 'Axiom', viaWindowsDefault: true })
  const r4 = await safe(() => target.resolvePrintTargetName({ requestedDeviceName: 'جعلی' }))
  check('resolve: نام ساختگی از renderer رد می‌شود', [typeof r4.error, r4.value ?? null], ['string', null])
}

console.log('\n— ۳) mergeFreshPrinter: ضد «ذخیره‌ی کهنه» (بخش ۶.۴)')
{
  check(
    'فقط نام چاپگر از نسخه‌ی تازه می‌آید',
    shared.mergeFreshPrinter({ printerName: 'کهنه', widthMm: 50 }, { printerName: 'تازه', widthMm: 80 }),
    { printerName: 'تازه', widthMm: 50 }
  )
  check('نام خالی تازه هم معتبر است (برگشت به پیش‌فرض ویندوز)', shared.mergeFreshPrinter({ printerName: 'کهنه' }, { printerName: '' }), {
    printerName: ''
  })
}

console.log('\n— ۴) printWith: جریان پرسش/بی‌پرس (بخش ۶.۵)')
{
  /**
   * printFlow کد renderer است و از `window.api` استفاده می‌کند؛ پس اول یک
   * پل جعلی می‌سازیم و بعد ماژول را import می‌کنیم (همان قرارداد preload).
   */
  let settings = {
    receipt: { askEachTime: false, useSystemDialog: false, printerName: 'Axiom', wholesaleSeparate: false, wholesalePrinterName: '' },
    label: { askEachTime: false, useSystemDialog: false, printerName: 'TSC TE200' }
  }
  const calls = []
  globalThis.window = {
    api: {
      channels: IPC,
      invoke: async (channel, payload) => {
        calls.push({ channel, payload })
        if (channel === IPC.settingsBundle) return { ok: true, data: settings }
        return { ok: true, data: null }
      }
    }
  }
  const flow = await import(new URL('../../src/renderer/src/lib/printFlow.ts', import.meta.url).href)

  const reset = () => {
    calls.length = 0
  }
  const printed = []
  const doPrint = async (deviceName, opts) => {
    printed.push({ deviceName, opts })
    return 1
  }

  // ۱) بی‌پرس
  reset()
  printed.length = 0
  settings = { ...settings, receipt: { ...settings.receipt, askEachTime: false } }
  const r1 = await flow.printWith('INVOICE', doPrint)
  check('بی‌پرس ⇒ DONE و چاپ با نام resolve‌شده‌ی main', [r1, printed], ['DONE', [{ deviceName: undefined, opts: undefined }]])
  check('بی‌پرس ⇒ هیچ پرسشی و هیچ ذخیره‌ی چاپگری', calls.filter((c) => c.channel === IPC.printSetDefault).length, 0)

  // ۲) با پرسش + انتخاب + ذخیره به‌عنوان پیش‌فرض
  reset()
  printed.length = 0
  settings = { ...settings, receipt: { ...settings.receipt, askEachTime: true } }
  flow.setPrinterPickerOpener(async () => ({ deviceName: 'TSC TE200', saveAsDefault: true }))
  const r2 = await flow.printWith('INVOICE', doPrint)
  check('با پرسش ⇒ چاپ روی چاپگر انتخاب‌شده', [r2, printed], ['DONE', [{ deviceName: 'TSC TE200', opts: undefined }]])
  check('ذخیره‌ی پیش‌فرض بعد از موفقیت با همان پروفایل', calls.filter((c) => c.channel === IPC.printSetDefault).map((c) => c.payload), [
    { profile: 'INVOICE', printerName: 'TSC TE200' }
  ])

  // ۳) انصراف
  reset()
  printed.length = 0
  flow.setPrinterPickerOpener(async () => null)
  const r3 = await flow.printWith('INVOICE', doPrint)
  check('انصراف ⇒ CANCELLED بدون هیچ چاپی', [r3, printed], ['CANCELLED', []])
  check('انصراف ⇒ هیچ چاپگری ذخیره نمی‌شود', calls.filter((c) => c.channel === IPC.printSetDefault).length, 0)

  // ۳.۵) نام خالی از پنجره ⇒ انصراف (نه چاپ روی پیش‌فرض ذخیره‌شده)
  reset()
  printed.length = 0
  flow.setPrinterPickerOpener(async () => ({ deviceName: '', saveAsDefault: true }))
  const r3b = await flow.printWith('INVOICE', doPrint)
  check('نام خالی ⇒ CANCELLED بدون هیچ چاپی و بدون ذخیره', [
    r3b,
    printed,
    calls.filter((c) => c.channel === IPC.printSetDefault).length
  ], ['CANCELLED', [], 0])

  // ۴) خطای چاپ ⇒ پیش‌فرض ذخیره نمی‌شود
  reset()
  flow.setPrinterPickerOpener(async () => ({ deviceName: 'TSC TE200', saveAsDefault: true }))
  const boom = await safe(() =>
    flow.printWith('INVOICE', async () => {
      throw new Error('چاپگر پاسخی نداد')
    })
  )
  check('خطای چاپ ⇒ خطا بالا می‌آید و پیش‌فرض ذخیره نمی‌شود', [
    boom.error?.includes('پاسخی نداد'),
    calls.filter((c) => c.channel === IPC.printSetDefault).length
  ], [true, 0])

  // ۵) دیالوگ ویندوز
  reset()
  printed.length = 0
  settings = { ...settings, receipt: { ...settings.receipt, askEachTime: true, useSystemDialog: true } }
  flow.setPrinterPickerOpener(async () => {
    throw new Error('نباید در حالت دیالوگ ویندوز پرسیده شود')
  })
  const r5 = await safe(() => flow.printWith('INVOICE', doPrint))
  check('دیالوگ ویندوز ⇒ بدون پرسش خودمان و با silent:false', [r5.error ?? null, printed], [
    null,
    [{ deviceName: undefined, opts: { silent: false } }]
  ])

  reset()
  printed.length = 0
  const r5c = await flow.printWith('INVOICE', async () => {
    const e = new Error('چاپ لغو شد و هیچ برگه‌ای چاپ نشد.')
    e.printCancelled = true
    throw e
  })
  check('لغو دیالوگ ویندوز ⇒ CANCELLED و بدون خطای UI', r5c, 'CANCELLED')

  // ۶) پروفایل لیبل و عمده (نام ذخیره‌شده‌ی درست)
  const flagsLabel = await flow.printProfileFlags('LABEL')
  check('پرچم‌های لیبل از تنظیمات لیبل می‌آید', flagsLabel.savedName, 'TSC TE200')
  settings = {
    ...settings,
    receipt: { ...settings.receipt, wholesaleSeparate: true, wholesalePrinterName: 'Axiom-W', printerName: 'Axiom' }
  }
  const flagsW = await flow.printProfileFlags('WHOLESALE')
  check('عمده (با کاغذ جدا) ⇒ چاپگر عمده و ذخیره در پروفایل عمده', [flagsW.savedName, flagsW.defaultProfile], ['Axiom-W', 'WHOLESALE'])
  settings = { ...settings, receipt: { ...settings.receipt, wholesaleSeparate: false } }
  const flagsW2 = await flow.printProfileFlags('WHOLESALE')
  check('عمده بدون کاغذ جدا ⇒ همان چاپگر فروش تکی و ذخیره در پروفایل INVOICE', [flagsW2.savedName, flagsW2.defaultProfile], ['Axiom', 'INVOICE'])

  const printErrors = await import(new URL('../../src/renderer/src/lib/printErrors.ts', import.meta.url).href)
  check('unknown/cancel کد صریح را می‌شناسند و timeout PDF را unknown چاپ حساب نمی‌کنند', [
    printErrors.isUnknownPrintMessage({ code: 'PRINT_OUTCOME_UNKNOWN', message: 'x' }),
    printErrors.isPrintCancelledError({ code: 'PRINT_CANCELLED', message: 'x' }),
    printErrors.isUnknownPrintMessage('ساخت PDF طی 30 ثانیه نتیجه نداد؛ هیچ فایلی ذخیره نشد. ممکن است برنامه گیر کرده باشد؛ دوباره تلاش کنید.')
  ], [true, true, false])

  flow.setPrinterPickerOpener(null)
  delete globalThis.window
}

console.log('\n— ۵) ساختاری: سیم‌کشی main و renderer')
{
  const ipc = readSrc('src/main/ipc/index.ts')
  const labelsHandler = ipc.slice(ipc.indexOf('handle(IPC.printLabels'), ipc.indexOf('handle(IPC.printDiagnose'))
  check('printLabels نام را از resolver می‌گیرد', /resolvePrintTargetName\(\{[\s\S]{0,120}?savedName: tpl\.printerName/.test(labelsHandler), true)
  const receiptHandler = ipc.slice(ipc.indexOf('handle(IPC.printReceipt'), ipc.indexOf('handle(IPC.printA4'))
  check('printReceipt نام را از resolver می‌گیرد', /resolvePrintTargetName\(\{/.test(receiptHandler), true)
  check('چاپ آزمایشی (diagnose) عمداً از resolver رد نمی‌شود', /handle\(IPC\.printDiagnose/.test(ipc), true)
  const setDefault = ipc.slice(
    ipc.indexOf('handle(IPC.printSetDefault'),
    ipc.indexOf('handle(IPC.cardTransferGet')
  )
  check('printSetDefault نام را با فهرست زنده اعتبارسنجی می‌کند', /listPrintersDetailed\(\)[\s\S]{0,200}?printers\.some/.test(setDefault), true)
  check('نام ناموجود ⇒ پیام «پیدا نشد» و هیچ نوشتنی', /throw new BusinessError\(printerNotFoundMessage\(printerName\)\)/.test(setDefault), true)
  check('پروفایل نامعتبر رد می‌شود', /پروفایل چاپ نامعتبر است/.test(setDefault), true)
  check('ذخیره در SettingsService با مقدار خام انجام می‌شود', /settingsService\.setPrinterDefault\(/.test(setDefault), true)
  check('کانال‌های تازه در shared/ipc تعریف شده‌اند', [
    /printersDetailed: 'print:printersDetailed'/.test(readSrc('src/shared/ipc.ts')),
    /printSetDefault: 'print:setDefaultPrinter'/.test(readSrc('src/shared/ipc.ts'))
  ], [true, true])

  const svc = readSrc('src/main/services/PrintService.ts')
  /**
   * اعتبار خرید عمداً به چاپگر رسید گره نمی‌خورد: اگر renderer نامی نفرستد،
   * `resolvePrintTargetName({ savedName: '' })` چاپگر پیش‌فرض واقعی ویندوز را
   * استفاده می‌کند؛ پس `receiptTargetDevice` فقط برای مسیرهای رسید/سند بدهی است:
   * ۱ تعریف + ۴ استفاده: فاکتور، تعویض، برگشت، بدهی.
   */
  check('چهار مسیر رسید/سند بدهی از receiptTargetDevice استفاده می‌کنند', (svc.match(/receiptTargetDevice\(/g) || []).length, 5)
  check(
    'دیگر هیچ مسیری نام چاپگر را خام از renderer نمی‌گیرد (فاز ۶ جایگزینی را کامل کرد)',
    (svc.match(/deviceName: input\.deviceName \|\| tpl\.printerName \|\| undefined/g) || []).length,
    0
  )
  const targetSrc = readSrc('src/main/print/target.ts')
  check('هیچ fallback ای به اولین چاپگر در resolver نیست', /printers\[0\]/.test(targetSrc), false)
  check('printer.ts دست‌نخورده مانده (بدون listPrintersDetailed)', /listPrintersDetailed/.test(readSrc('src/main/print/printer.ts')), false)

  const shell = readSrc('src/renderer/src/components/Shell.tsx')
  check('میزبان پنجره‌ی انتخاب چاپگر در ریشه mount شده', /<PrinterPickerHost \/>/.test(shell), true)
  const picker = readSrc('src/renderer/src/components/PrinterPickerModal.tsx')
  check(
    'انصراف پنجره ⇒ null (لغو بی‌صدا) — دکمه و Esc/پس‌زمینه/ضربدر',
    [/onClick=\{\(\) => close\(null\)\}/.test(picker), /onClose=\{\(\) => close\(null\)\}/.test(picker)],
    [true, true]
  )

  const flow = readSrc('src/renderer/src/lib/printFlow.ts')
  check('ذخیره‌ی پیش‌فرض داخل printWith بعد از چاپ موفق است', /const printed = await runPrint\(choice\.deviceName\)[\s\S]{0,500}?printSetDefault/.test(flow), true)
  const modal = readSrc('src/renderer/src/components/Modal.tsx')
  const confirmDialog = readSrc('src/renderer/src/components/ConfirmDialog.tsx')
  check('ConfirmDialog هم از stack مشترک استفاده می‌کند و Enter روی انصراف را به بله تبدیل نمی‌کند', [
    /export function useTopmostModalKey/.test(modal),
    /useTopmostModalKey\(open/.test(confirmDialog),
    /active instanceof HTMLButtonElement && active !== confirmButtonRef\.current/.test(confirmDialog),
    /autoFocus/.test(confirmDialog)
  ], [true, true, true, true])
  check('انصراف پیش از هر چاپی برمی‌گردد (نام خالی هم انصراف است)', /if \(!choice \|\| !choice\.deviceName\) return 'CANCELLED'/.test(flow), true)

  const callSites = {
    'src/renderer/src/pages/Pos.tsx': 2,
    'src/renderer/src/pages/SalesInvoice.tsx': 1,
    'src/renderer/src/pages/SalesReports.tsx': 2,
    'src/renderer/src/pages/SalesReturn.tsx': 3,
    'src/renderer/src/components/InvoicePaymentsModal.tsx': 1,
    'src/renderer/src/components/LabelPrintModal.tsx': 1
  }
  const counts = Object.fromEntries(
    Object.entries(callSites).map(([f, n]) => [f.split('/').pop(), (readSrc(f).match(/printWith\(/g) || []).length === n])
  )
  check('همه‌ی نقاط چاپ renderer از printWith می‌گذرند (جدول ۲.۲)', counts, {
    'Pos.tsx': true,
    'SalesInvoice.tsx': true,
    'SalesReports.tsx': true,
    'SalesReturn.tsx': true,
    'InvoicePaymentsModal.tsx': true,
    'LabelPrintModal.tsx': true
  })
  const leftover = Object.keys(callSites).filter(
    (f) => /call(CH\.(printInvoice|printExchange|printReturn|printDebtPayment|printLabels))/.test(readSrc(f))
  )
  check('هیچ فراخوانی مستقیم چاپی در renderer جا نمانده', leftover, [])

  const settings = readSrc('src/renderer/src/pages/Settings.tsx')
  check('تنظیمات: کارت‌ها و بخش پیشرفته وصل شده‌اند', [
    /<PrinterCards/.test(settings),
    /<PrintAdvanced/.test(settings),
    /mergeFreshPrinter\(receipt/.test(settings),
    /mergeFreshPrinter\(label/.test(settings),
    /CH\.printSetDefault/.test(settings)
  ], [true, true, true, true, true])
  const cards = readSrc('src/renderer/src/components/PrintSettingsCards.tsx')
  check('«بدون پرسش» فقط askEachTime را عوض می‌کند (نه autoPrint رسید)', /setR\(\{ askEachTime: ask \}\)/.test(cards), true)
  check('برای لیبل autoPrint از askEachTime مشتق می‌شود', /setL\(\{ askEachTime: ask, autoPrint: !ask \}\)/.test(cards), true)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
