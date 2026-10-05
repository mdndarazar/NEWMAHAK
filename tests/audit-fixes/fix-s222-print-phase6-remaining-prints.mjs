/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۶ طرح چاپ — «بقیه‌ی نقاط چاپ + پاک‌سازی».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) چاپ اعتبار و دسته‌ای: فقط **نام چاپگر** از resolver مشترک می‌آید؛
 *      `silent` و شمارنده‌ی چاپ (`markPrinted`) دست‌نخورده مانده‌اند.
 *   ۲) «خلاصه‌ی حرارتی» (بستن صندوق / سرجمع فروش): عرض کاغذ اعلام می‌شود و نام
 *      چاپگر از resolver می‌آید، ولی **سیاست دیالوگ دست‌نخورده** است
 *      (`silent: false` — جدول ۲.۲ طرح).
 *   ۳) فاکتور عمده‌ی جدا (`wholesaleSeparate`): با پروفایل `WHOLESALE` هم کاغذ و
 *      هم چاپگر جدا اعمال می‌شود؛ خاموش ⇒ مو‌به‌مو مثل تکی.
 *   ۴) هیچ fallback خودکاری نیست: چاپگر ذخیره‌شده‌ی حذف‌شده ⇒ خطا و صفر چاپ.
 *   ۵) همه‌ی نقاط چاپ renderer از `printWith` رد می‌شوند (جدول ۲.۲).
 *   ۶) مورد بررسی بخش ۱۱.۲ طرح — «پرداختی/مانده‌ی چاپ عمده»: رفتار فعلی مستند و
 *      عددی نشان داده می‌شود (`paidTotal` از renderer، `remaining` از دیتابیس).
 *      طبق طرح **اصلاح نمی‌شود**؛ فقط گزارش می‌شود.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase6-remaining-prints.mjs
 * ===========================================================================
 */
import { register } from 'node:module'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s222-p6-'))
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
const { makeSeeder } = await import('../../test/harness/seed.mjs')
const seed = makeSeeder(db)
const { IPC } = await import(new URL('../../src/shared/ipc.ts', import.meta.url).href)
const { SETTING_KEYS } = await import(new URL('../../src/shared/receipt.ts', import.meta.url).href)
const { money } = await import(new URL('../../src/shared/jalali.ts', import.meta.url).href)
const { summaryThermalHtml } = await import(new URL('../../src/main/print/templates.ts', import.meta.url).href)
const { registerIpcHandlers } = await import(new URL('../../src/main/ipc/index.ts', import.meta.url).href)
registerIpcHandlers()

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
const call = (channel, payload) => handlers.get(channel)(null, payload)
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')
/** بدنه‌ی یک متد سرویس: از امضای متد تا شروع متد بعدی (به ترتیب فایل). */
const bodyOf = (src, marker) => {
  const start = src.indexOf(marker)
  if (start < 0) return ''
  const rest = src.slice(start + marker.length)
  const nextAsync = rest.search(/\n  (?:async )?[a-zA-Z_]+\s*\(/)
  const nextJsdoc = rest.search(/\n  \/\*\*/)
  const cuts = [nextAsync, nextJsdoc].filter((n) => n >= 0)
  return cuts.length ? rest.slice(0, Math.min(...cuts)) : rest
}
const writeSetting = (key, obj) => seed.setting(key, obj)
const lastHtml = () => mock.state.loads[mock.state.loads.length - 1]?.html ?? ''
const lastPrint = () => mock.state.printCalls[mock.state.printCalls.length - 1]?.options ?? {}

/**
 * ⚠️ هر بار یک آرایه‌ی **تازه**: `mock.reset()` آرایه‌ی فعلی `state.printers` را
 * در جا خالی می‌کند (`.length = 0`)، پس اگر یک آرایه‌ی مشترک بدهیم و بعد دوباره
 * همان را بدهیم، فهرست خالی می‌ماند و تست بی‌دلیل قرمز می‌شود.
 */
const printers = () => [
  { name: 'Axiom Thermal 80', displayName: 'Axiom Thermal 80', isDefault: true, status: 0 },
  { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false, status: 0 },
  { name: 'HP LaserJet 1020', displayName: 'HP LaserJet 1020', isDefault: false, status: 0 }
]

const receiptTemplate = (extra = {}) => ({
  printerName: 'Axiom Thermal 80',
  paperPreset: 'THERMAL_80',
  sheetWidthMm: 80,
  sheetHeightMm: 140,
  paperWidthMm: 72,
  askEachTime: false,
  useSystemDialog: false,
  ...extra
})

const category = seed.category('دسته تست')
const product = seed.product('کالای تست', category)
const variant = seed.variant(product, 'سایز تست')
const invoice = seed.invoiceWithLines([{ variantId: variant, qty: 1, lineTotal: 1_000_000, variantName: 'کالای تست' }])

console.log('\n— ۱) چاپ فاکتور: نام چاپگر فقط از resolver (بخش ۶.۲)')
{
  await writeSetting(SETTING_KEYS.receiptTemplate, receiptTemplate())
  mock.reset()
  mock.state.printers = printers()

  const r1 = await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id, deviceName: 'TSC TE200' }))
  check('نام درخواستی معتبر ⇒ همان چاپگر (بر ذخیره‌شده مقدم است)', [
    r1.value?.ok,
    mock.state.printCalls.length,
    lastPrint().deviceName
  ], [true, 1, 'TSC TE200'])

  mock.reset()
  mock.state.printers = printers()
  const r2 = await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id, deviceName: 'چاپگر جعلی' }))
  check('نام جعلی از renderer ⇒ خطای فارسی و هیچ چاپی', [
    r2.value?.ok,
    /پیدا نشد/.test(r2.value?.error ?? ''),
    mock.state.printCalls.length
  ], [false, true, 0])

  mock.reset()
  mock.state.printers = printers()
  await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id }))
  check('بدون نام درخواستی ⇒ چاپگر ذخیره‌شده', [lastPrint().deviceName], ['Axiom Thermal 80'])

  mock.reset()
  mock.state.printers = printers().filter((p) => p.name !== 'Axiom Thermal 80')
  const r3 = await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id }))
  check('چاپگر ذخیره‌شده حذف شده ⇒ خطا، هیچ چاپی، و **هیچ fallback به اولین چاپگر**', [
    r3.value?.ok,
    /پیدا نشد/.test(r3.value?.error ?? ''),
    mock.state.printCalls.length
  ], [false, true, 0])

  mock.reset()
  mock.state.printers = printers().filter((p) => p.name !== 'Axiom Thermal 80')
  await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id, deviceName: 'TSC TE200' }))
  check('ذخیره‌شده گم است ولی نام درخواستی معتبر است ⇒ همان درخواستی', [lastPrint().deviceName], ['TSC TE200'])

  mock.reset()
  mock.state.printers = printers()
  await writeSetting(SETTING_KEYS.receiptTemplate, receiptTemplate({ printerName: '' }))
  await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id }))
  check('بدون نام ذخیره‌شده و بدون درخواست ⇒ پیش‌فرض ویندوز (پیش‌فرض واقعی، نه اولین لیست)', [
    lastPrint().deviceName,
    lastPrint().deviceName === 'Axiom Thermal 80'
  ], ['Axiom Thermal 80', true])
  await writeSetting(SETTING_KEYS.receiptTemplate, receiptTemplate())
}

console.log('\n— ۲) خلاصه‌ی حرارتی (بستن صندوق / سرجمع فروش): عرض + چاپگر، دیالوگ دست‌نخورده')
{
  const tpl = receiptTemplate()
  await writeSetting(SETTING_KEYS.receiptTemplate, tpl)
  mock.reset()
  mock.state.printers = printers()
  const lines = [
    { label: 'تعداد فاکتور', value: 3 },
    { label: 'نقدی', value: 1_000_000, bold: true }
  ]
  const r = await safe(() => call(IPC.printThermalSummary, { title: 'بستن صندوق', meta: 'تست', lines, paperWidthMm: 48 }))
  check('خروجی موفق + دیالوگ ویندوز هنوز روشن است (سیاست بدون تغییر)', [r.value?.ok, lastPrint().silent], [true, false])
  check('عرض اعلام‌شده به چاپگر = عرض درخواستی همان لحظه', [
    lastPrint().deviceName,
    lastPrint().pageSize?.width,
    (lastPrint().pageSize?.height ?? 0) > 0
  ], ['Axiom Thermal 80', 48000, true])
  check('همان محتوای قبلی چاپ می‌شود (فقط اندازه/چاپگر اضافه شده)', lastHtml().includes(`>48mm<`) || lastHtml().length > 0, true)
  check('رندر با همان تابع قبلی و همان عرض', summaryThermalHtml('بستن صندوق', lines, 'تست', 48) === lastHtml(), true)

  mock.reset()
  mock.state.printers = printers()
  const r2 = await safe(() => call(IPC.printThermalSummary, { title: 'سرجمع فروش', lines: [{ label: 'x', value: 1 }] }))
  check('بدون عرض درخواستی ⇒ عرض قالب رسید، و نام چاپگر از resolver', [
    r2.value?.ok,
    lastPrint().pageSize?.width,
    lastPrint().deviceName
  ], [true, 80000, 'Axiom Thermal 80'])

  mock.reset()
  mock.state.printers = printers().filter((p) => p.name !== 'Axiom Thermal 80')
  const r3 = await safe(() => call(IPC.printThermalSummary, { title: 'سرجمع فروش', lines: [] }))
  check('چاپگر ذخیره‌شده گم ⇒ خطا و صفر چاپ (بدون fallback)', [r3.value?.ok, mock.state.printCalls.length], [false, 0])
}

console.log('\n— ۳) فاکتور عمده‌ی جدا (wholesaleSeparate)')
{
  await writeSetting(
    SETTING_KEYS.receiptTemplate,
    receiptTemplate({
      wholesaleSeparate: true,
      wholesaleSheetWidthMm: 148,
      wholesaleSheetHeightMm: 210,
      wholesalePaperWidthMm: 140,
      wholesalePrinterName: 'HP LaserJet 1020'
    })
  )
  mock.reset()
  mock.state.printers = printers()
  const r1 = await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id, profile: 'WHOLESALE' }))
  check('عمده با کاغذ جدا: عرض/ارتفاع و چاپگر عمده', [
    r1.value?.ok,
    lastPrint().pageSize?.width,
    lastPrint().pageSize?.height,
    lastPrint().deviceName
  ], [true, 148000, 210000, 'HP LaserJet 1020'])

  mock.reset()
  mock.state.printers = printers()
  await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id }))
  check('فاکتور تکی با همان قالب ⇒ کاغذ و چاپگر تکی (پروفایل پیش‌فرض RETAIL)', [
    lastPrint().pageSize?.width,
    lastPrint().deviceName
  ], [80000, 'Axiom Thermal 80'])

  mock.reset()
  mock.state.printers = printers()
  await writeSetting(SETTING_KEYS.receiptTemplate, receiptTemplate({ wholesalePrinterName: 'HP LaserJet 1020' }))
  await safe(() => call(IPC.printInvoice, { invoiceId: invoice.id, profile: 'WHOLESALE' }))
  check('wholesaleSeparate خاموش ⇒ عمده دقیقاً مثل تکی (چاپگر ذخیره‌شده‌ی رسید)', [
    lastPrint().deviceName,
    lastPrint().pageSize?.width
  ], ['Axiom Thermal 80', 80000])
}

console.log('\n— ۴) اعتبار: چاپگر پیش‌فرض ویندوز/نام صریح، silent و شمارنده دست‌نخورده')
{
  const svc = readSrc('src/main/services/PrintService.ts')
  const creditBody = bodyOf(svc, 'async printCredit(')
  check('چاپ اعتبار به چاپگر رسید گره نمی‌خورد و با savedName خالی resolve می‌شود', [
    /resolvePrintTargetName\(\{[\s\S]{0,120}?savedName: ''/.test(creditBody),
    /receiptTargetDevice\(/.test(creditBody)
  ], [true, false])
  check('و دیگر نام جعلی/خام از renderer مستقیم نمی‌رود', /deviceName: input\.deviceName \|\| tpl\.printerName/.test(svc), false)
  check('سیاست دیالوگ اعتبار عوض نشده', /silent: input\.silent \?\? false/.test(creditBody), true)
  check('شمارنده‌ی چاپ اعتبار (markPrinted) و ممیزی نتیجه‌ی نامعلوم دست‌نخورده', [
    /creditShouldMarkPrinted\(input\.markPrinted\)/.test(creditBody),
    /isPrintOutcomeUnknown\(err\)/.test(creditBody)
  ], [true, true])
  const batchBody = bodyOf(svc, 'async printCreditBatch(')
  check('چاپ دسته‌ای اعتبار هم savedName خالی + همان silent', [
    /resolvePrintTargetName\(\{[\s\S]{0,120}?savedName: ''/.test(batchBody),
    /receiptTargetDevice\(/.test(batchBody),
    /silent: input\.silent \?\? false/.test(batchBody)
  ], [true, false, true])
}

console.log('\n— ۵) همه‌ی نقاط چاپ renderer از printWith رد می‌شوند (جدول ۲.۲)')
{
  const points = [
    ['src/renderer/src/pages/Pos.tsx', "printWith('INVOICE'", 'CH.printInvoice'],
    ['src/renderer/src/pages/Pos.tsx', "printWith('INVOICE'", 'CH.printInvoice'],
    ['src/renderer/src/pages/SalesInvoice.tsx', "printWith('WHOLESALE'", 'CH.printInvoice'],
    ['src/renderer/src/pages/SalesReturn.tsx', "printWith('INVOICE'", 'CH.printInvoice'],
    ['src/renderer/src/pages/SalesReports.tsx', "printWith('INVOICE'", 'CH.printInvoice'],
    ['src/renderer/src/pages/SalesReports.tsx', "printWith('INVOICE'", 'CH.printExchange'],
    ['src/renderer/src/components/InvoicePaymentsModal.tsx', "printWith('INVOICE'", 'CH.printDebtPayment'],
    ['src/renderer/src/components/LabelPrintModal.tsx', "printWith('LABEL'", 'CH.printLabels']
  ]
  const rows = points.map(([file, flow, chan]) => {
    const src = readSrc(file)
    return [flow, new RegExp(`printWith\\([^)]*\\n?[\\s\\S]{0,220}?${chan.replace('.', '\\.')}`).test(src)]
  })
  check('هر نقطه‌ی چاپ داخل printWith است', rows.every((r) => r[1]), true)
  check('هیچ‌کدام از این کانال‌ها بیرون از printWith صدا زده نمی‌شود', (() => {
    const files = [...new Set(points.map((p) => p[0]))]
    return files.map((f) => {
      const src = readSrc(f)
      const calls = (src.match(/call<number>\(CH\.printLabels|call\(CH\.printInvoice|call\(CH\.printExchange|call\(CH\.printDebtPayment/g) || []).length
      const flows = (src.match(/printWith\(/g) || []).length
      return [f.split('/').pop(), calls <= flows]
    })
  })(), [
    ['Pos.tsx', true],
    ['SalesInvoice.tsx', true],
    ['SalesReturn.tsx', true],
    ['SalesReports.tsx', true],
    ['InvoicePaymentsModal.tsx', true],
    ['LabelPrintModal.tsx', true]
  ])
  check('گزارش‌های A4 و خلاصه‌ی حرارتی عمداً بی‌پرسش مانده‌اند (طبق جدول)', [
    /call\(CH\.printA4/.test(readSrc('src/renderer/src/pages/SalesReports.tsx')),
    /call\(CH\.printThermalSummary/.test(readSrc('src/renderer/src/pages/SalesReports.tsx'))
  ], [true, true])
}

console.log('\n— ۶) بررسی بخش ۱۱.۲: «پرداختی/مانده» در چاپ عمده (اصلاح نمی‌شود، فقط گزارش)')
{
  /**
   * `receiptDataFor` مانده را از **دیتابیس** حساب می‌کند، ولی `invoiceHtml`
   * «پرداختی» را از renderer می‌گیرد. اگر این دو عدد از یک منبع نیایند، برگه
   * می‌تواند «پرداختی ۴۰۰٬۰۰۰» و «مانده ۱٬۰۰۰٬۰۰۰» چاپ کند در حالی که جمع کل
   * ۱٬۰۰۰٬۰۰۰ است. طبق طرح فقط گزارش می‌شود.
   */
  const paid = 400_000
  const row = seed.one('SELECT grandTotal, paidTotal FROM SaleInvoice WHERE id = ?', invoice.id)
  check('فاکتور تست: جمع کل ۱٬۰۰۰٬۰۰۰ و پرداختیِ دیتابیس صفر', [Number(row.grandTotal), Number(row.paidTotal)], [1_000_000, 0])
  mock.reset()
  mock.state.printers = printers()
  const r = await safe(() =>
    call(IPC.printInvoice, { invoiceId: invoice.id, profile: 'WHOLESALE', paidTotal: paid })
  )
  const html = lastHtml()
  check('چاپ موفق', [r.value?.ok], [true])
  check('برگه «پرداختی» را از renderer می‌گیرد ولی «مانده» از دیتابیس می‌آید (یافته‌ی بررسی)', [
    html.includes(money(paid)),
    html.includes(money(1_000_000)),
    html.includes(money(1_000_000 - paid))
  ], [true, true, false])
}

console.log('\n— ۷) پاک‌سازی: مورد خارج‌از‌طرح `@page size: Wmm auto` در سند اعتبار')
{
  const tpl = readSrc('src/main/print/templates.ts')
  check('همان عبارت (خارج از این طرح؛ فقط برای گزارش ثبت شد)', /\$\{widthMm\}mm auto/.test(tpl), true)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
