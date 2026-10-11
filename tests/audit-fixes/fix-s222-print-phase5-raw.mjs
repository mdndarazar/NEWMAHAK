/**
 * ===========================================================================
 * نشست ۲۲۲ · فاز ۵ طرح چاپ — «مسیر خام (RAW): رستری، TSPL، ESC/POS، ارسال».
 *
 * چه چیزی را ثابت می‌کند؟
 *   ۱) `packMono`/`luminanceAt`: سطرِ بایت‌محور (مضرب ۸)، ترتیب MSB-first، آستانه
 *      و قطبیت — بدون حدس‌زدن.
 *   ۲) TSPL: ترتیب دقیق دستورها، `SIZE`/`GAP`/`BLINE`/`DIRECTION`/`DENSITY`/
 *      `SPEED`/`REFERENCE`/`CLS`/`BITMAP`/`PRINT`، و اینکه داده‌ی بیت‌مپ **باینری**
 *      بلافاصله بعد از خط `BITMAP` می‌آید (نه Base64).
 *   ۳) ESC/POS: `ESC @`، `GS v 0` با عرض/ارتفاع little-endian، تغذیه و برش.
 *   ۴) `sendRaw`: آرگومان‌های PowerShell (بدون shell، نام چاپگر فقط یک آرگومان)،
 *      نوشتن فایل موقت، **پاک‌سازی در هر حالت**، و ترجمه‌ی کدهای خروج به پیام
 *      فارسی؛ مهلت تمام‌شده ⇒ «نتیجه‌ی نامعلوم» (بدون retry).
 *   ۵) دروازه‌ی RAW: تغییر روش به RAW بدون «چاپ آزمایشی موفق» در همین اجرا مجاز
 *      نیست؛ آزمایش موفق بازش می‌کند و مقدار قبلیِ RAW گیر نمی‌کند.
 *   ۶) مسیر واقعی: `printTestPage` با روش RAW روی ماک Electron ⇒ تصویر رستری
 *      گرفته می‌شود، بایت TSPL/ESC/POS ساخته می‌شود، هیچ چاپ Chromium انجام
 *      نمی‌شود، و دروازه باز می‌شود؛ و `printMaybeRaw` روی CHROMIUM مو‌به‌مو
 *      همان `printHtml` امروز را صدا می‌زند.
 *
 * اجرا: node --import ./test/harness/register.mjs tests/audit-fixes/fix-s222-print-phase5-raw.mjs
 * ===========================================================================
 */
import { register } from 'node:module'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const DIR = mkdtempSync(join(tmpdir(), 'mahak-s222-p5-'))
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
const raster = await import(new URL('../../src/main/print/raw/raster.ts', import.meta.url).href)
const tspl = await import(new URL('../../src/main/print/raw/tspl.ts', import.meta.url).href)
const escpos = await import(new URL('../../src/main/print/raw/escpos.ts', import.meta.url).href)
const sendRawMod = await import(new URL('../../src/main/print/raw/sendRaw.ts', import.meta.url).href)
const gate = await import(new URL('../../src/main/print/raw/gate.ts', import.meta.url).href)
const raw = await import(new URL('../../src/main/print/raw/index.ts', import.meta.url).href)
const route = await import(new URL('../../src/main/print/raw/route.ts', import.meta.url).href)
await import(new URL('../../src/main/ipc/index.ts', import.meta.url).href)

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
const lastHtml = () => {
  const loads = mock.state.loads
  return loads[loads.length - 1]?.html ?? ''
}

/** سازنده‌ی بافر BGRA یکدست برای همان اندازه‌ی `capturePage`. */
const solidFor = (color) => (rect) => solid(Math.max(1, Math.round(rect?.width ?? 1)), Math.max(1, Math.round(rect?.height ?? 1)), color)

/** بافر BGRA یکدست با رنگ داده‌شده. */
const solid = (w, h, [r, g, b]) => {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = b
    buf[i + 1] = g
    buf[i + 2] = r
    buf[i + 3] = 255
  }
  return buf
}

/**
 * ماک PowerShell: فایلِ کار را می‌خواند (تا بشود بایت‌ها را دید) و کد خروج
 * می‌دهد. مسیر فایل و مهلت پاک‌سازی هم همین‌جا ثبت می‌شود.
 */
function fakePowershell({ exitCode = 0, hang = false, fail = false, stderr = '' } = {}) {
  const calls = []
  const impl = (file, args) => {
    const recorder = { file, args, bytes: null, dir: null }
    calls.push(recorder)
    const child = new EventEmitter()
    child.stderr = new EventEmitter()
    const jobPath = args[args.lastIndexOf('-File') + 1]
    recorder.dir = dirname(jobPath)
    try {
      recorder.bytes = readFileSync(jobPath)
    } catch (err) {
      recorder.readError = String(err?.message ?? err)
    }
    if (hang) return child
    setImmediate(() => {
      if (fail) return child.emit('error', new Error('spawn ENOENT'))
      if (stderr) child.stderr.emit('data', Buffer.from(stderr, 'utf8'))
      child.emit('close', exitCode)
    })
    return child
  }
  impl.calls = calls
  return impl
}

console.log('\n— ۱) raster (بخش ۸.۳ · بیت‌مپ ۱-بیتی)')
{
  const black = [0, 0, 0]
  const white = [255, 255, 255]
  const img = (w, h, at) => {
    const buf = solid(w, h, white)
    for (const [x, y, color] of at ?? []) {
      const i = (y * w + x) * 4
      buf[i] = color[2]
      buf[i + 1] = color[1]
      buf[i + 2] = color[0]
    }
    return { data: buf, width: w, height: h }
  }

  check('عرض ۱۲ پیکسل ⇒ دو بایت در هر سطر (مضرب ۸)', (() => {
    const b = raster.packMono(img(12, 1, []))
    return [b.widthPx, b.widthBytes, b.data.length]
  })(), [16, 2, 2])
  check('بیت‌ها MSB-first و از چپ', (() => {
    const b = raster.packMono(img(8, 1, [[0, 0, black], [7, 0, black]]))
    return b.data[0]
  })(), 0b10000001)
  check('پیکسل هشتم به بایت دوم می‌رود', (() => {
    const b = raster.packMono(img(16, 1, [[8, 0, black]]))
    return [b.data[0], b.data[1]]
  })(), [0, 0b10000000])
  check('دو سطر پشت‌سرهم (heightPx سطرها)', (() => {
    const b = raster.packMono(img(8, 2, [[0, 0, black], [0, 1, black]]))
    return [b.heightPx, b.data[0], b.data[1]]
  })(), [2, 0b10000000, 0b10000000])
  check('سفید ⇒ بیت صفر', raster.packMono(img(8, 1, [])).data[0], 0)
  check('آستانه: روشنایی ۱۲۸ دیگر سیاه نیست (کمتر از ۱۲۸ سیاه است)', (() => {
    const g128 = [128, 128, 128]
    const g127 = [127, 127, 127]
    return [raster.packMono(img(8, 1, [[0, 0, g128]])).data[0], raster.packMono(img(8, 1, [[0, 0, g127]])).data[0]]
  })(), [0, 0b10000000])
  check('قطبیت: invert بیت سیاه را صفر می‌کند (حدس زده نمی‌شود، پارامتر است)', (() => {
    const on = raster.packMono(img(8, 1, [[0, 0, black]])).data[0]
    const inv = raster.packMono(img(8, 1, [[0, 0, black]]), { invert: true }).data[0]
    return [on, inv]
  })(), [0b10000000, 0b01111111])
  check('luminanceAt ترتیب کانال را می‌فهمد (bgra در برابر rgba)', (() => {
    // همان بایت‌ها: در bgra آبی=۲۵۵ (روشنایی ۲۹) و در rgba قرمز=۲۵۵ (روشنایی ۷۶)
    const same = { data: Buffer.from([255, 0, 0, 255]), width: 1, height: 1 }
    const rgba = { ...same, order: 'rgba' }
    return [
      raster.luminanceAt(same, 0, 0, 50),
      raster.luminanceAt(rgba, 0, 0, 50),
      raster.luminanceAt(rgba, 0, 0, 77)
    ]
  })(), [true, false, true])
  check('mm↔px در ۲۰۳dpi', [
    raster.mmToPx(72, 203),
    raster.mmToPx(50, 203),
    raster.mmToPx(30, 203),
    raster.pxToMm(576, 203)
  ], [575, 400, 240, 72.07])
  check('dpi نامعتبر ⇒ پیش‌فرض ۲۰۳', raster.mmToPx(50, 0), 400)
}

console.log('\n— ۲) TSPL (TSC)')
{
  const bitmap = { widthPx: 8, heightPx: 2, widthBytes: 1, data: Buffer.from([0b10000000, 0b00000000]) }
  check('ترتیب و متن دقیق دستورها (پیش‌فرض‌ها حدس زده نمی‌شوند)', tspl.tsplCommandLines(bitmap, {
    widthMm: 102,
    heightMm: 30,
    gapMm: 2
  }), [
    'SIZE 102 mm,30 mm',
    'GAP 2 mm,0 mm',
    'DIRECTION 0',
    'DENSITY 8',
    'SPEED 4',
    'REFERENCE 0,0',
    'CLS',
    'BITMAP 0,0,1,2,0,',
    'PRINT 1,1'
  ])
  check('سنسور BLACKMARK ⇒ BLINE', tspl.tsplCommandLines(bitmap, {
    widthMm: 50,
    heightMm: 30,
    gapMm: 3,
    sensorType: 'BLACKMARK'
  })[1], 'BLINE 3 mm,0 mm')
  check('رول پیوسته ⇒ GAP 0,0', tspl.tsplCommandLines(bitmap, {
    widthMm: 50,
    heightMm: 30,
    sensorType: 'CONTINUOUS'
  })[1], 'GAP 0 mm,0 mm')
  check('clamp مقادیر بیرون بازه (جهت/چگالی/سرعت/فاصله/نسخه)', (() => {
    const lines = tspl.tsplCommandLines(bitmap, {
      widthMm: 50,
      heightMm: 30,
      direction: 9,
      density: 99,
      speed: 99,
      gapMm: 999,
      copies: 0
    })
    return [lines[1], lines[2], lines[3], lines[4], lines[8]]
  })(), ['GAP 20 mm,0 mm', 'DIRECTION 3', 'DENSITY 15', 'SPEED 6', 'PRINT 1,1'])
  check('بایت‌ها: دستورها ASCII + داده‌ی باینری بلافاصله بعد از BITMAP', (() => {
    const bytes = tspl.buildTspl(bitmap, { widthMm: 50, heightMm: 30, gapMm: 2 })
    const text = bytes.toString('latin1')
    const at = text.indexOf('BITMAP 0,0,1,2,0,\r\n')
    const after = bytes.subarray(at + 'BITMAP 0,0,1,2,0,\r\n'.length, at + 'BITMAP 0,0,1,2,0,\r\n'.length + 2)
    return [
      bytes.subarray(0, 20).toString('latin1'),
      text.includes('BASE64'),
      text.includes('PRINT 1,1'),
      [...after]
    ]
  })(), ['SIZE 50 mm,30 mm\r\nGA', false, true, [0b10000000, 0]])
  check('invertBits فقط داده‌ی بیت‌مپ را معکوس می‌کند (متن دستور عوض نمی‌شود)', (() => {
    const line = 'BITMAP 0,0,1,2,0,\r\n'
    const a = tspl.buildTspl(bitmap, { widthMm: 50, heightMm: 30 })
    const b = tspl.buildTspl(bitmap, { widthMm: 50, heightMm: 30, invertBits: true })
    const at = (buf) => buf.toString('latin1').indexOf(line) + line.length
    return [
      a.length === b.length,
      [...a.subarray(at(a), at(a) + 2)],
      [...b.subarray(at(b), at(b) + 2)]
    ]
  })(), [true, [0b10000000, 0], [0b01111111, 0xff]])
  check('خلاصه‌ی فارسی TSPL', /TSPL · ۱۰۲ ?× ?۳۰/.test(tspl.tsplSummary({
    widthMm: 102,
    heightMm: 30,
    widthBytes: 51,
    heightPx: 240
  })), true)
}

console.log('\n— ۳) ESC/POS (Axiom)')
{
  const bitmap = { widthPx: 16, heightPx: 2, widthBytes: 2, data: Buffer.from([0b10000001, 0b00000000, 0, 0]) }
  check('مقدمه‌ی GS v 0 با عرض/ارتفاع little-endian', [
    [...escpos.escPosRasterHeader(72, 300)],
    [...escpos.escPosRasterHeader(300, 1000)]
  ], [
    [0x1d, 0x76, 0x30, 0x00, 72, 0, 0x2c, 0x01],
    [0x1d, 0x76, 0x30, 0x00, 0x2c, 0x01, 0xe8, 0x03]
  ])
  check('نام دستورها به ترتیب (پیش‌فرض: init → raster → feed → برش کامل)', escpos.escPosCommandNames(), [
    'ESC @ (init)',
    'GS v 0 (raster)',
    'ESC d n (feed)',
    'GS V 0 (full cut)'
  ])
  check('برش جزئی و بدون برش و بدون تغذیه', [
    escpos.escPosCommandNames({ cutMode: 'PARTIAL' })[3],
    escpos.escPosCommandNames({ cutMode: 'NONE' }).length,
    escpos.escPosCommandNames({ feedLines: 0 }).length
  ], ['GS V 66 (partial cut)', 3, 3])
  check('ترتیب بایت‌های کار: ESC @ + GS v 0 + داده + ESC d + GS V', (() => {
    const bytes = escpos.buildEscPos(bitmap)
    return [
      [bytes[0], bytes[1]],
      [bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7], bytes[8], bytes[9]],
      [...bytes.subarray(10, 14)],
      [...bytes.subarray(14, 17)],
      [...bytes.subarray(17, 20)],
      bytes.length
    ]
  })(), [
    [0x1b, 0x40],
    [0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0],
    [0b10000001, 0, 0, 0],
    [0x1b, 0x64, 4],
    [0x1d, 0x56, 0x00],
    20
  ])
  check('cutMode NONE ⇒ هیچ بایت برشی', (() => {
    const bytes = escpos.buildEscPos(bitmap, { cutMode: 'NONE' })
    return [bytes.length, bytes.includes(0x56)]
  })(), [17, false])
  check('invertBits در ESC/POS هم پارامتر است', [...escpos.buildEscPos(bitmap, { invertBits: true }).subarray(10, 12)], [0b01111110, 0xff])
}

console.log('\n— ۴) sendRaw (ارسال خام در ویندوز)')
{
  check('آرگومان‌های PowerShell: بدون shell و نام چاپگر یک آرگومان جدا', sendRawMod.powershellArgs(
    'C:\\app\\resources\\print\\raw-print.ps1',
    'POS "Axiom" 80',
    'C:\\Temp\\job.bin'
  ), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'C:\\app\\resources\\print\\raw-print.ps1',
    '-Printer',
    'POS "Axiom" 80',
    '-File',
    'C:\\Temp\\job.bin'
  ])
  check('مسیر اسکریپت: dev کنار سورس، نصبی زیر resources', [
    sendRawMod.rawScriptPathFor({ isPackaged: false, appPath: '/proj', resourcesPath: '/res' }),
    sendRawMod.rawScriptPathFor({ isPackaged: true, appPath: '/proj', resourcesPath: '/res' })
  ], ['/proj/resources/print/raw-print.ps1', '/res/print/raw-print.ps1'])
  check('ترجمه‌ی کدهای خروج به پیام فارسی', [
    /پیدا نشد/.test(sendRawMod.rawExitMessage(2)),
    /رد شد/.test(sendRawMod.rawExitMessage(3, 'Access is denied.\nSpooler error')),
    /مسدود/.test(sendRawMod.rawExitMessage(5)),
    /ساخته\/خوانده نشد/.test(sendRawMod.rawExitMessage(4)),
    /Spooler error/.test(sendRawMod.rawExitMessage(3, 'Access is denied.\nSpooler error'))
  ], [true, true, true, true, true])

  const bytes = Buffer.from([1, 2, 3, 4, 5])
  check('ارسال موفق: همان بایت‌ها در فایل موقت + پاک‌سازی پوشه', await (async () => {
    const spawn = fakePowershell({ exitCode: 0 })
    const r = await safe(() => sendRawMod.sendRaw('Axiom 80', bytes, { spawnImpl: spawn }))
    const dir = spawn.calls[0]?.dir
    return [r.value, [...(spawn.calls[0]?.bytes ?? [])], existsSync(dir), r.error ?? null]
  })(), [5, [1, 2, 3, 4, 5], false, null])
  check('کد خروج ۳ ⇒ خطای فارسی «رد شد» و پوشه‌ی موقت هم پاک می‌شود', await (async () => {
    const spawn = fakePowershell({ exitCode: 3, stderr: 'Access is denied.' })
    const r = await safe(() => sendRawMod.sendRaw('Axiom 80', bytes, { spawnImpl: spawn }))
    return [/رد شد/.test(r.error ?? ''), existsSync(spawn.calls[0]?.dir)]
  })(), [true, false])
  check('مهلت تمام‌شده ⇒ «نتیجه‌ی نامعلوم» (بدون retry) و پوشه پاک می‌شود', await (async () => {
    const spawn = fakePowershell({ hang: true })
    const r = await safe(() => sendRawMod.sendRaw('Axiom 80', bytes, { spawnImpl: spawn, timeoutMs: 25 }))
    return [/ممکن است برگه چاپ شده باشد/.test(r.error ?? ''), mock.state.printCalls.length, existsSync(spawn.calls[0]?.dir)]
  })(), [true, 0, false])
  check('خطای اجرای PowerShell ⇒ BusinessError فارسی', await (async () => {
    const spawn = fakePowershell({ fail: true })
    const r = await safe(() => sendRawMod.sendRaw('Axiom 80', bytes, { spawnImpl: spawn }))
    return [/اجرای اسکریپت چاپ خام ممکن نشد/.test(r.error ?? ''), existsSync(spawn.calls[0]?.dir)]
  })(), [true, false])
  check('نام چاپگر خالی یا کار خالی ⇒ هیچ اجرایی', await (async () => {
    const spawn = fakePowershell({ exitCode: 0 })
    const a = await safe(() => sendRawMod.sendRaw('  ', bytes, { spawnImpl: spawn }))
    const b = await safe(() => sendRawMod.sendRaw('Axiom 80', Buffer.alloc(0), { spawnImpl: spawn }))
    return [spawn.calls.length, /نام چاپگر/.test(a.error ?? ''), /خالی/.test(b.error ?? '')]
  })(), [0, true, true])
}

console.log('\n— ۵) دروازه‌ی RAW (بخش ۷.۱)')
{
  gate.resetRawTrial()
  check('RAW بدون آزمایش موفق ⇒ خطای فارسی روشن', await (async () => {
    const r = await safe(() => gate.assertRawMethodAllowed('LABEL', 'RAW', 'CHROMIUM'))
    return [gate.isRawTrialOk('LABEL'), /چاپ آزمایشی/.test(r.error ?? '')]
  })(), [false, true])
  check('CHROMIUM (پیش‌فرض کاربران فعلی) هیچ گیتی ندارد', await (async () => {
    const r = await safe(() => gate.assertRawMethodAllowed('LABEL', 'CHROMIUM', 'RAW'))
    return r.error ?? null
  })(), null)
  check('مقدار قبلی RAW ⇒ ذخیره‌ی دوباره گیر نمی‌کند (قفل کاذب نداریم)', await (async () => {
    const r = await safe(() => gate.assertRawMethodAllowed('INVOICE', 'RAW', 'RAW'))
    return r.error ?? null
  })(), null)
  check('بعد از آزمایش موفق ⇒ باز می‌شود', await (async () => {
    gate.markRawTrialOk('LABEL')
    const r = await safe(() => gate.assertRawMethodAllowed('LABEL', 'RAW', 'CHROMIUM'))
    return [gate.isRawTrialOk('LABEL'), r.error ?? null]
  })(), [true, null])
  check('آزمایش لیبل، پروفایل‌های رسید را باز نمی‌کند (و برعکس)', [
    (() => { gate.resetRawTrial(); gate.markRawTrialOk('LABEL'); return [gate.isRawTrialOk('INVOICE'), gate.isRawTrialOk('WHOLESALE')] })()
  ], [[false, false]])
  check('reset (فقط تست‌ها) همه را می‌بندد', (() => {
    gate.resetRawTrial()
    return [gate.isRawTrialOk('LABEL'), gate.isRawTrialOk('INVOICE'), gate.isRawTrialOk('WHOLESALE')]
  })(), [false, false, false])
}

console.log('\n— ۶) ساختار و پیش‌فرض‌های دست‌نخورده')
{
  check('فایل‌های تازه‌ی مسیر خام سرجایشان‌اند', [
    existsSync(resolve(root, 'src/main/print/raw/raster.ts')),
    existsSync(resolve(root, 'src/main/print/raw/tspl.ts')),
    existsSync(resolve(root, 'src/main/print/raw/escpos.ts')),
    existsSync(resolve(root, 'src/main/print/raw/sendRaw.ts')),
    existsSync(resolve(root, 'src/main/print/raw/gate.ts')),
    existsSync(resolve(root, 'resources/print/raw-print.ps1'))
  ], [true, true, true, true, true, true])
  const pkg = JSON.parse(readSrc('package.json'))
  check('extraResources اسکریپت خام را در بسته‌بندی می‌برد', JSON.stringify(pkg.build.extraResources), JSON.stringify([
    { from: 'prisma', to: 'prisma' },
    { from: 'resources/print', to: 'print' }
  ]))
  const ps1 = readSrc('resources/print/raw-print.ps1')
  check('اسکریپت همان توابع spooler را صدا می‌زند (datatype = RAW)', [
    /OpenPrinter/.test(ps1),
    /StartDocPrinter/.test(ps1),
    /WritePrinter/.test(ps1),
    /EndDocPrinter/.test(ps1),
    /ClosePrinter/.test(ps1),
    /'RAW'/.test(ps1),
    /exit 2/.test(ps1) && /exit 3/.test(ps1) && /exit 5/.test(ps1)
  ], [true, true, true, true, true, true, true])
  const sr = readSrc('src/main/print/raw/sendRaw.ts')
  check('ارسال بدون shell و نام چاپگر فقط آرگومان است', [
    /spawnFn\('powershell\.exe'/.test(sr),
    /shell\s*:/.test(sr),
    /shell:\s*true/.test(sr),
    /-Printer/.test(sr)
  ], [true, false, false, true])
  const receipt = readSrc('src/shared/receipt.ts')
  check('پیش‌فرض قالب‌ها همان CHROMIUM مانده (کاربران فعلی هیچ تغییری نمی‌بینند)', [
    (receipt.match(/printMethod: 'CHROMIUM'/g) || []).length >= 2,
    /printMethod: 'RAW'/.test(receipt)
  ], [true, false])
  const svc = readSrc('src/main/services/SettingsService.ts')
  check('گیت در ذخیره‌ی تنظیمات (رسید + لیبل) نشسته است', (svc.match(/assertRawMethodAllowed\(/g) || []).length, 2)
  const ipc = readSrc('src/main/ipc/index.ts')
  check('مسیر مستقیم settings:set هم گیت دارد', /assertRawMethodAllowed\(/.test(ipc), true)
  const routeSrc = readSrc('src/main/print/raw/route.ts')
  check('router فقط با RAW خام می‌رود و روی CHROMIUM همان printHtml را صدا می‌زند', [
    /method !== 'RAW'/.test(routeSrc) || /isRawMethod\(input\.method\)/.test(routeSrc),
    /await printHtml\(input\.html/.test(routeSrc)
  ], [true, true])
  const ps = readSrc('src/main/services/PrintService.ts')
  check('چهار مسیر رسید از router رد می‌شوند و دو مسیر فاز ۶ دست‌نخورده‌اند', [
    (ps.match(/await printMaybeRaw\(/g) || []).length,
    (ps.match(/await printHtml\(/g) || []).length
  ], [4, 2])
}

console.log('\n— ۷) مسیر واقعی با ماک Electron')
{
  mock.reset()
  mock.state.printers = [
    { name: 'Axiom Thermal 80', displayName: 'Axiom Thermal 80', isDefault: true, status: 0 },
    { name: 'TSC TE200', displayName: 'TSC TE200', isDefault: false, status: 0 }
  ]
  const testPage = await import(new URL('../../src/main/print/testPage.ts', import.meta.url).href)
  const { registerIpcHandlers } = await import(new URL('../../src/main/ipc/index.ts', import.meta.url).href)
  registerIpcHandlers()
  const { settingsService } = await import(new URL('../../src/main/services/SettingsService.ts', import.meta.url).href)

  // ۷.۱ — آزمایش RAW روی رسید: هیچ چاپ Chromium، فقط ESC/POS خام
  gate.resetRawTrial()
  const spawnReceipt = fakePowershell({ exitCode: 0 })
  sendRawMod.setRawSpawnForTest(spawnReceipt)
  mock.state.captureBitmap = solidFor([255, 255, 255])
  const handler = handlers.get(IPC.printTestPage)
  mock.state.executeJavaScriptOutcome = 108
  const r1 = await safe(() => handler(null, { profile: 'INVOICE', deviceName: 'Axiom Thermal 80', method: 'RAW' }))
  check('آزمایش RAW رسید بدون خطا', r1.error ?? null, null)
  check('آزمایش RAW رسید: موفق + روش RAW + دروازه باز', [
    r1.value?.ok,
    r1.value?.data?.method,
    r1.value?.data?.rawTrialOpened,
    gate.isRawTrialOk('INVOICE'),
    mock.state.printCalls.length,
    [...(spawnReceipt.calls[0]?.bytes ?? Buffer.alloc(0)).subarray(0, 2)]
  ], [true, 'RAW', true, true, 0, [0x1b, 0x40]])
  check('دروازه‌ی رسید باز شد (تکی و عمده با هم، چون یک کلید مشترک‌اند) و لیبل هنوز بسته است', [
    gate.isRawTrialOk('INVOICE'),
    gate.isRawTrialOk('WHOLESALE'),
    gate.isRawTrialOk('LABEL')
  ], [true, true, false])
  check('تصویر با zoom = dpi/96 و اندازه‌ی میکرونی کاغذ گرفته شد', [
    mock.state.zoomCalls.length > 0,
    Math.round((mock.state.zoomCalls[0]?.factor ?? 0) * 100) / 100,
    Math.round(mock.state.captureCalls[0]?.rect?.width ?? 0)
  ], [true, 2.11, 639])
  check('پوشه‌ی موقت پس از ارسال پاک شده', existsSync(spawnReceipt.calls[0]?.dir), false)

  // ۷.۱.ب — ذخیره‌ی RAW **بدون** آزمایش موفق باید رد شود و چیزی ذخیره نشود
  gate.resetRawTrial()
  await writeSetting(SETTING_KEYS.labelTemplate, { printerName: 'TSC TE200', printMethod: 'CHROMIUM' })
  const blocked = await safe(() =>
    handlers.get(IPC.settingsSaveBundle)(null, {
      label: { printerName: 'TSC TE200', printMethod: 'RAW' }
    })
  )
  check('ذخیره‌ی RAW بدون آزمایش موفق رد می‌شود و مقدار قبلی دست‌نخورده می‌ماند', [
    blocked.value?.ok,
    /چاپ آزمایشی/.test(blocked.value?.error ?? ''),
    (await settingsService.labelTemplate()).printMethod
  ], [false, true, 'CHROMIUM'])

  // ۷.۲ — آزمایش RAW روی لیبل: هر ردیف یک کار TSPL
  await writeSetting(SETTING_KEYS.labelTemplate, {
    widthMm: 50,
    heightMm: 30,
    columns: 2,
    gapXMm: 2,
    gapYMm: 2,
    sensorType: 'GAP',
    rawDpi: 203,
    density: 8,
    speed: 4,
    direction: 0,
    printerName: 'TSC TE200',
    printMethod: 'CHROMIUM'
  })
  const spawnLabel = fakePowershell({ exitCode: 0 })
  sendRawMod.setRawSpawnForTest(spawnLabel)
  mock.state.captureBitmap = solidFor([255, 255, 255])
  const r2 = await safe(() => handler(null, { profile: 'LABEL', deviceName: 'TSC TE200', method: 'RAW' }))
  check('آزمایش RAW لیبل بدون خطا', r2.error ?? null, null)
  const labelJob = spawnLabel.calls[0]?.bytes ?? Buffer.alloc(0)
  const labelText = labelJob.toString('latin1')
  check('آزمایش RAW لیبل: کار TSPL با SIZE عرض ردیف (۱۰۲mm دوستونه)', [
    r2.value?.data?.method,
    gate.isRawTrialOk('LABEL'),
    labelText.startsWith('SIZE 102 mm,30 mm\r\nGAP 2 mm,0 mm\r\n'),
    labelText.includes('BITMAP 0,0,102,240,0,'),
    labelText.includes('PRINT 1,1'),
    mock.state.printCalls.length
  ], ['RAW', true, true, true, true, 0])

  // ۷.۳ — پس از آزمایش، ذخیره‌ی روش RAW مجاز است (دروازه در سرویس)
  const saved = await safe(() =>
    handlers.get(IPC.settingsSaveBundle)(null, {
      label: {
        widthMm: 50,
        heightMm: 30,
        columns: 2,
        gapXMm: 2,
        gapYMm: 2,
        sensorType: 'GAP',
        rawDpi: 203,
        density: 8,
        speed: 4,
        direction: 0,
        printerName: 'TSC TE200',
        printMethod: 'RAW'
      }
    })
  )
  check('ذخیره‌ی RAW بعد از آزمایش موفق انجام می‌شود و در دیتابیس می‌نشیند', [
    saved.value?.ok,
    saved.value?.error ?? null,
    (await settingsService.labelTemplate()).printMethod
  ], [true, null, 'RAW'])

  // ۷.۴ — printMaybeRaw روی CHROMIUM: مو‌به‌مو همان printHtml امروز
  mock.reset()
  mock.state.printers = [{ name: 'Axiom Thermal 80', displayName: 'Axiom Thermal 80', isDefault: true, status: 0 }]
  const r3 = await safe(() =>
    route.printMaybeRaw({
      method: 'CHROMIUM',
      html: '<html><body>سند</body></html>',
      deviceName: 'Axiom Thermal 80',
      silent: true,
      pageSize: { widthMm: 80, heightMm: 140, heightSafetyMm: 3 }
    })
  )
  check('CHROMIUM: همان printHtml با همان pageSize/نام/silent', [
    r3.value?.engine,
    mock.state.printCalls.length,
    mock.state.printCalls[0]?.options?.deviceName,
    mock.state.printCalls[0]?.options?.silent,
    mock.state.printCalls[0]?.options?.pageSize?.width,
    mock.state.printCalls[0]?.options?.pageSize?.height,
    /سند/.test(lastHtml())
  ], ['CHROMIUM', 1, 'Axiom Thermal 80', true, 80000, 140000, true])
  check('روی CHROMIUM هیچ اندازه‌گیری/رستری/ارسال خامی انجام نمی‌شود', [
    mock.state.executeJavaScriptCalls.length,
    mock.state.captureCalls.length,
    mock.state.zoomCalls.length
  ], [0, 0, 0])

  // ۷.۵ — RAW با دیالوگ ویندوز معنی ندارد: نه dialog می‌آورد، نه باید بی‌صدا روی پیش‌فرض چاپ کند.
  mock.reset()
  const rawDialog = await safe(() =>
    route.printMaybeRaw({
      method: 'RAW',
      html: '<html><body>سند خام</body></html>',
      deviceName: 'Axiom Thermal 80',
      silent: false,
      pageSize: { widthMm: 80, heightMm: 'AUTO', heightSafetyMm: 3 }
    })
  )
  check('RAW + دیالوگ ویندوز رد می‌شود و هیچ کار چاپی ساخته نمی‌شود', [
    /چاپ خام.*دیالوگ ویندوز/.test(rawDialog.error ?? ''),
    mock.state.printCalls.length,
    mock.state.captureCalls.length
  ], [true, 0, 0])

  // ۷.۶ — مسیرهای RAW لیبل و برگه‌ی آزمایشی هم نباید silent:false را بی‌صدا نادیده بگیرند.
  mock.reset()
  mock.state.printers = [{ name: 'TSC TE200', displayName: 'TSC TE200', isDefault: true, status: 0 }]
  await writeSetting(SETTING_KEYS.labelTemplate, {
    widthMm: 50,
    heightMm: 30,
    columns: 2,
    gapXMm: 2,
    gapYMm: 2,
    sensorType: 'GAP',
    rawDpi: 203,
    density: 8,
    speed: 4,
    direction: 0,
    printerName: 'TSC TE200',
    printMethod: 'RAW',
    useSystemDialog: true
  })
  const labelRawDialog = await safe(() =>
    handlers.get(IPC.printLabels)(null, {
      labels: [{ name: 'کالا', code: '123', price: 1000, barcodeDataUrl: '' }],
      deviceName: 'TSC TE200',
      silent: false
    })
  )
  const testRawDialog = await safe(() => handler(null, { profile: 'LABEL', deviceName: 'TSC TE200', method: 'RAW' }))
  check('printLabels RAW + دیالوگ ویندوز قبل از TSPL رد می‌شود', [
    labelRawDialog.value?.ok,
    /چاپ خام.*دیالوگ ویندوز/.test(labelRawDialog.value?.error ?? ''),
    mock.state.printCalls.length,
    mock.state.captureCalls.length
  ], [false, true, 0, 0])
  check('printTestPage RAW + useSystemDialog قبل از چاپ خام رد می‌شود', [
    testRawDialog.value?.ok,
    /چاپ خام.*دیالوگ ویندوز/.test(testRawDialog.value?.error ?? ''),
    mock.state.printCalls.length,
    mock.state.captureCalls.length
  ], [false, true, 0, 0])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق\n`)
process.exit(bad ? 1 : 0)
