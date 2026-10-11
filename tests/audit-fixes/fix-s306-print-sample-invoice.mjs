/**
 * ===========================================================================
 * «چاپ فاکتور نمونه» کارت‌های تکی/عمده (به‌جای برگه‌ی کالیبراسیون).
 *
 *   ۱) رفتاری (ماک Electron): کانال تازه فاکتور واقعی چاپ می‌کند — نه برگه‌ی
 *      کالیبراسیون — با چاپگر/کاغذ همان پروفایل، بدون fallback.
 *   ۲) عمده: پرداختی/مانده + کاغذ و چاپگر جدا وقتی wholesaleSeparate روشن است.
 *   ۳) RAW: از همان router فاکتور واقعی؛ RAW + دیالوگ ⇒ خطای فارسی و صفر چاپ.
 *   ۴) ساختاری: کارت‌های تکی/عمده به کانال تازه وصل‌اند، لیبل نه؛ printTestPage
 *      و buildTestPageHtml دست‌نخورده.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s306-print-sample-invoice.mjs
 * ===========================================================================
 */
import { register } from 'node:module'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s306-'))
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
const readSrc = (rel) => readFileSync(resolve(root, rel), 'utf8')
const writeSetting = (key, obj) =>
  db.setting.upsert({ where: { key }, update: { value: JSON.stringify(obj) }, create: { key, value: JSON.stringify(obj) } })
const lastPrint = () => mock.state.printCalls[mock.state.printCalls.length - 1]?.options ?? {}
const lastHtml = () => mock.state.loads[mock.state.loads.length - 1]?.html ?? ''
const printers = () => {
  mock.state.printers = [
    { name: 'Axiom', displayName: 'Axiom Thermal 80', isDefault: true },
    { name: 'HP A5', displayName: 'HP LaserJet', isDefault: false }
  ]
}

const { registerIpcHandlers } = await import(new URL('../../src/main/ipc/index.ts', import.meta.url).href)
registerIpcHandlers()
const sample = handlers.get(IPC.printSampleInvoice)
const call = (payload) => sample(null, payload)

console.log('\n— ۱) کارت تکی: فاکتور واقعی نمونه، نه برگه‌ی کالیبراسیون')
{
  check('کانال تازه ثبت شده و از printTestPage جداست', [typeof sample, IPC.printSampleInvoice !== IPC.printTestPage], ['function', true])
  await writeSetting(SETTING_KEYS.receiptTemplate, {
    printerName: 'Axiom', paperPreset: 'THERMAL_80', sheetWidthMm: 80, sheetHeightMm: 0, paperWidthMm: 72,
    askEachTime: false, useSystemDialog: false, printMethod: 'CHROMIUM'
  })
  mock.reset(); printers(); mock.state.executeJavaScriptOutcome = 500
  const r = await call({ profile: 'INVOICE' })
  check('موفق، روی چاپگر ذخیره‌شده، موتور Chromium', [r?.ok, r?.data?.deviceName, r?.data?.engine, r?.data?.profile], [true, 'Axiom', 'CHROMIUM', 'RETAIL'])
  check('HTML = رسید نمونه (اقلام نمونه)، نه برگه‌ی کالیبراسیون', [
    /لینین تک جیب/.test(lastHtml()),
    /data-test-sheet="1"/.test(lastHtml())
  ], [true, false])
  check('رسید تکی سطر مانده ندارد (تسویه‌ی کامل)', /مانده/.test(lastHtml()), false)
  check('عرض ۸۰mm به چاپگر و بی‌صدا', [lastPrint().pageSize?.width, lastPrint().silent], [80000, true])

  mock.reset(); printers(); mock.state.executeJavaScriptOutcome = 400
  const r2 = await call({ profile: 'INVOICE', deviceName: 'HP A5' })
  check('نام انتخابی کارت (معتبر) به کار می‌رود', [r2?.ok, lastPrint().deviceName], [true, 'HP A5'])

  mock.reset(); printers()
  const r3 = await call({ profile: 'INVOICE', deviceName: 'چاپگر جعلی' })
  check('نام جعلی ⇒ خطای فارسی و صفر چاپ', [r3?.ok, r3?.error?.includes('چاپگر جعلی'), mock.state.printCalls.length], [false, true, 0])

  mock.reset(); mock.state.printers = [{ name: 'Other', displayName: 'Other', isDefault: true }]
  const r4 = await call({ profile: 'INVOICE' })
  check('چاپگر ذخیره‌شده‌ی حذف‌شده ⇒ بدون fallback و صفر چاپ', [r4?.ok, r4?.error?.includes('Axiom'), mock.state.printCalls.length], [false, true, 0])
}

console.log('\n— ۲) کارت عمده: پرداختی/مانده و کاغذ/چاپگر جدا')
{
  await writeSetting(SETTING_KEYS.receiptTemplate, {
    printerName: 'Axiom', wholesalePrinterName: 'HP A5', wholesaleSeparate: true,
    wholesaleSheetWidthMm: 148, wholesaleSheetHeightMm: 210, wholesalePaperWidthMm: 138,
    paperPreset: 'THERMAL_80', sheetWidthMm: 80, sheetHeightMm: 0, paperWidthMm: 72,
    useSystemDialog: false, printMethod: 'CHROMIUM', showPaid: true, showRemaining: true
  })
  mock.reset(); printers()
  const r = await call({ profile: 'WHOLESALE' })
  check('چاپگر عمده (wholesaleSeparate) و پروفایل WHOLESALE', [r?.ok, r?.data?.deviceName, r?.data?.profile], [true, 'HP A5', 'WHOLESALE'])
  check('کاغذ عمده ۱۴۸×۲۱۰ به چاپگر رفت', lastPrint().pageSize, { width: 148000, height: 210000 })
  check('HTML عمده: مشتری عمده + مبلغ پرداختی و مانده (۸٬۹۸۰٬۰۰۰)', [
    /مشتری عمده‌ی نمونه/.test(lastHtml()),
    /مانده/.test(lastHtml()),
    /۸[,٬]۹۸۰[,٬]۰۰۰|8,980,000/.test(lastHtml()),
    /data-test-sheet="1"/.test(lastHtml())
  ], [true, true, true, false])

  await writeSetting(SETTING_KEYS.receiptTemplate, {
    printerName: 'Axiom', wholesalePrinterName: 'HP A5', wholesaleSeparate: false,
    sheetWidthMm: 80, sheetHeightMm: 0, paperWidthMm: 72, useSystemDialog: false, printMethod: 'CHROMIUM'
  })
  mock.reset(); printers(); mock.state.executeJavaScriptOutcome = 400
  const r2 = await call({ profile: 'WHOLESALE' })
  check('wholesaleSeparate خاموش ⇒ چاپگر و کاغذ تکی (منطق دست‌نخورده)', [r2?.data?.deviceName, lastPrint().pageSize?.width], ['Axiom', 80000])
}

console.log('\n— ۳) روش ذخیره‌شده RAW از همان router')
{
  await writeSetting(SETTING_KEYS.receiptTemplate, { printerName: 'Axiom', useSystemDialog: true, printMethod: 'RAW' })
  mock.reset(); printers()
  const r = await call({ profile: 'INVOICE' })
  check('RAW + دیالوگ ویندوز ⇒ خطای فارسی و صفر چاپ Chromium', [r?.ok, /[\u0600-\u06FF]/.test(r?.error ?? ''), mock.state.printCalls.length], [false, true, 0])
  await writeSetting(SETTING_KEYS.receiptTemplate, { printerName: 'Axiom', useSystemDialog: false, printMethod: 'CHROMIUM' })
}

console.log('\n— ۴) پیش‌نمایش عمده همان سازنده است')
{
  const prev = handlers.get(IPC.printPreviewHtml)
  const w = await prev(null, { profile: 'WHOLESALE' })
  const t = await prev(null, {})
  check('previewHtml عمده پرداختی/مانده دارد و تکی ندارد', [/مانده/.test(w?.data ?? ''), /مانده/.test(t?.data ?? '')], [true, false])
}

console.log('\n— ۵) ساختاری: سیم‌کشی کارت‌ها و دست‌نخوردن مسیر کالیبراسیون')
{
  const cards = readSrc('src/renderer/src/components/PrintSettingsCards.tsx')
  check('فقط دو کارت (تکی/عمده) onSample دارند', (cards.match(/onSample=\{runSample\}/g) || []).length, 2)
  check('runSample به کانال تازه می‌رود، نه printTestPage', /call<[^>]*>\(\s*CH\.printSampleInvoice/.test(cards), true)
  const sampleBody = cards.slice(cards.indexOf('const runSample'), cards.indexOf('const openPreview'))
  check('بدنه‌ی runSample هیچ printTestPage ای ندارد و لیبل را رد می‌کند', [
    /printTestPage/.test(sampleBody), /if \(profile === 'LABEL'\) return/.test(sampleBody)
  ], [false, true])
  const labelCard = cards.slice(cards.indexOf('title="لیبل (برچسب کالا)"'), cards.indexOf('<PrintPreviewModal'))
  check('کارت لیبل onSample ندارد و onTest={runTest} دارد', [/onSample/.test(labelCard), /onTest=\{runTest\}/.test(labelCard)], [false, true])
  check('برچسب کالیبراسیون فقط کنار onSample، لیبل همان «چاپ آزمایشی»', /\{onSample \? 'برگه‌ی کالیبراسیون \(فنی\)' : 'چاپ آزمایشی'\}/.test(cards), true)
  check('انتخابگر روش همچنان به دکمه‌ی کالیبراسیون (onTest) وصل است', [
    /onTestMethodChange\?\.\(e\.target\.value === 'RAW' \? 'RAW' : 'CHROMIUM'\)/.test(cards),
    /onClick=\{\(\) => onTest\(profile, value, testMethod \?\? savedMethod \?\? 'CHROMIUM'\)\}/.test(cards)
  ], [true, true])
  const ipc = readSrc('src/main/ipc/index.ts')
  check('هندلر printTestPage دست‌نخورده و هندلر تازه جدا', [
    /handle\(IPC\.printTestPage, \(p\) => runPrintTestPage\(p \?\? \{\}\)\)/.test(ipc),
    /handle\(IPC\.printSampleInvoice, \(p\) => runPrintSampleInvoice\(p \?\? \{\}\)\)/.test(ipc)
  ], [true, true])
  const si = readSrc('src/main/print/sampleInvoice.ts')
  check('نمونه از سازنده‌ی پیش‌نمایش و router واقعی؛ بدون HTML تازه/دروازه‌ی RAW', [
    /printService\.previewHtml\(\{ profile \}\)/.test(si),
    /await printMaybeRaw\(/.test(si),
    /markRawTrialOk|buildTestPageHtml|<html|printers\[0\]/.test(si)
  ], [true, true, false])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
