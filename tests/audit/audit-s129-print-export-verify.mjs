/**
 * ممیزی نشست ۱۲۹ (+ نشت S131-2) — تأیید رفتاری مسیر چاپ/خروجی (fix-s129 روی ماک و بخشی ساختاری بود):
 *   • writeFileAtomic با fs واقعی: جایگزینی فایل موجود؛ مقصدِ پوشه یا مسیر ناموجود ⇒ پیام فارسی هدف، مقصد
 *     دست‌نخورده، هیچ ‎.tmp باقی نمی‌ماند.
 *   • htmlDataUrlOrNull دقیقاً در مرز ۱٬۹۰۰٬۰۰۰ نویسه و با نیم‌جفت UTF-16 (مسیر فایل موقت و پاک‌شدنش).
 *   • printFailureMessage / printWindowLostMessage.
 *   • AUDIT-S129-01: نتیجه‌ی «نامعلوم» چاپ (پنجره بسته/crash یا timeout) اعتبار را «چاپ‌شده» می‌شمارد تا نسخه‌ی
 *     بعدی «اصل» دوم نشود؛ لغو قطعی نمی‌شمارد؛ چاپ با دیالوگ (silent:false) مهلت ۳۰ ثانیه‌ای ندارد.
 */
import { register } from 'node:module'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
process.env.HARNESS_DIR = mkdtempSync(join(tmpdir(), 'mahak-s129a-'))
process.env.HARNESS_DB = join(process.env.HARNESS_DIR, 'shop.db')
register(pathToFileURL(join(root, 'tests/audit-fixes/support/s129-hooks.mjs')).href)
const mock = await import(pathToFileURL(join(root, 'tests/audit-fixes/support/s129-electron-mock.mjs')).href)
const { harnessClient } = await import(join(root, 'test/harness/stubs/prismaClient.mjs'))
const { makeSeeder } = await import(join(root, 'test/harness/seed.mjs'))
const printer = await import(join(root, 'src/main/print/printer.ts'))
const { writeFileAtomic } = await import(join(root, 'src/main/services/ExportService.ts'))
const { printService } = await import(join(root, 'src/main/services/PrintService.ts'))
const { toUserMessage } = await import(join(root, 'src/main/errors.ts'))
const db = harnessClient(); const seed = makeSeeder(db)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: toUserMessage(e) } } }
const tmpLeft = (dir) => readdirSync(dir).filter((f) => f.endsWith('.tmp'))

console.log('\n— ۱) writeFileAtomic با fs واقعی')
{
  const dir = mkdtempSync(join(tmpdir(), 's129a-out-'))
  const target = join(dir, 'گزارش.csv')
  writeFileSync(target, 'قدیمی')
  const r = await safe(() => writeFileAtomic(target, Buffer.from('جدید-کامل', 'utf8')))
  eq('جایگزینی فایل موجود بدون خطا', r?.__error ?? null, null)
  eq('محتوای مقصد = داده‌ی تازه‌ی کامل', readFileSync(target, 'utf8'), 'جدید-کامل')
  eq('هیچ ‎.tmp باقی نماند (جایگزینی)', tmpLeft(dir), [])
  const asDir = join(dir, 'پوشه.csv'); mkdirSync(asDir); writeFileSync(join(asDir, 'x.txt'), 'دست‌نخورده')
  const r2 = await safe(() => writeFileAtomic(asDir, Buffer.from('x')))
  eq('مقصدِ پوشه ⇒ پیام فارسی هدف (نام فایل + «ذخیره نشد» + «دست‌نخورده»)', /«پوشه\.csv» ذخیره نشد/.test(r2?.__error ?? '') && /دست‌نخورده ماند/.test(r2?.__error ?? ''), true)
  eq('مقصدِ پوشه دست‌نخورده ماند', statSync(asDir).isDirectory() && readFileSync(join(asDir, 'x.txt'), 'utf8') === 'دست‌نخورده', true)
  eq('هیچ ‎.tmp باقی نماند (پوشه)', tmpLeft(dir), [])
  const missing = join(dir, 'نیست', 'a.csv')
  const r3 = await safe(() => writeFileAtomic(missing, Buffer.from('x')))
  eq('مسیر ناموجود ⇒ پیام «پوشه‌ی انتخاب‌شده پیدا نشد»', /«a\.csv» ذخیره نشد: پوشه‌ی انتخاب‌شده پیدا نشد/.test(r3?.__error ?? ''), true)
  eq('مسیر ناموجود ساخته نشد', existsSync(join(dir, 'نیست')), false)
  eq('هیچ ‎.tmp در پوشه‌ی والد', tmpLeft(dir), [])
}

console.log('\n— ۲) htmlDataUrlOrNull در مرز و با نیم‌جفت')
{
  const P = 'data:text/html;charset=utf-8,'.length
  const atLimit = 'a'.repeat(printer.PRINT_DATA_URL_MAX_CHARS - P)
  eq('طول دقیقاً ۱٬۹۰۰٬۰۰۰ ⇒ data URL', printer.htmlDataUrlOrNull(atLimit)?.length, 1_900_000)
  eq('۱٬۹۰۰٬۰۰۱ ⇒ null (فایل موقت)', printer.htmlDataUrlOrNull(atLimit + 'a'), null)
  eq('فارسی: هر حرف ۱۸ نویسه‌ی کدشده؛ مرز با کدگذاری سنجیده می‌شود', printer.htmlDataUrlOrNull('ب'.repeat(Math.floor((1_900_000 - P) / 6))) !== null && printer.htmlDataUrlOrNull('ب'.repeat(Math.floor((1_900_000 - P) / 6) + 1)) === null, true)
  eq('نیم‌جفت UTF-16 ⇒ null (نه crash)', printer.htmlDataUrlOrNull('<p>\uD83D</p>'), null)
  mock.reset()
  const before = readdirSync(mock.state.tempRoot).length
  const r = await safe(() => printer.printHtml('<p>کالا \uD83D</p>', { silent: true }))
  eq('چاپ سند با نیم‌جفت از مسیر فایل موقت موفق شد', r?.__error ?? null, null)
  eq('بارگذاری از فایل بود', mock.state.loads.map((l) => l.via), ['file'])
  eq('فایل موقت چاپ پاک شد', readdirSync(mock.state.tempRoot).length, before)
}

console.log('\n— ۳) پیام‌های فارسی چاپ')
{
  eq('لغو', printer.printFailureMessage('canceled'), 'چاپ لغو شد و هیچ برگه‌ای چاپ نشد.')
  eq('چاپگر نامعتبر شامل نام چاپگر', /چاپگر «XP-80» روی این سیستم پیدا نشد/.test(printer.printFailureMessage('Invalid deviceName provided', 'XP-80')), true)
  eq('بدون چاپگر', /هیچ چاپگری روی این سیستم در دسترس نیست/.test(printer.printFailureMessage('No printers available')), true)
  eq('پاسخ ناشناخته عیناً نقل می‌شود', /پاسخ سیستم چاپ: «failed»/.test(printer.printFailureMessage('failed')), true)
  eq('پنجره‌ی ازدست‌رفته (چاپ) ⇒ «معلوم نیست» + علت فارسی', /از کار افتادن/.test(printer.printWindowLostMessage('crashed')) && /معلوم نیست برگه چاپ شده باشد/.test(printer.printWindowLostMessage('crashed')), true)
  eq('پنجره‌ی ازدست‌رفته (PDF) ⇒ «هیچ فایلی ذخیره نشد»', /هیچ فایلی ذخیره نشد/.test(printer.printWindowLostMessage(null, 'pdf')), true)
  eq('علت ناشناخته عیناً', /علت: weird/.test(printer.printWindowLostMessage('weird')), true)
}

console.log('\n— ۴) AUDIT-S129-01: شمارنده‌ی چاپ اعتبار در نتیجه‌ی نامعلوم/لغو/timeout')
{
  const today = seed.one('SELECT 1 AS x') && null
  let n = 0
  const credit = () => seed.insert('StoreCredit', { code: `S129A-${++n}`, amount: 500_000, status: 'ACTIVE', source: 'MANUAL', issuedAt: Date.now() })
  const pc = (id) => Number(seed.one('SELECT printCount FROM "StoreCredit" WHERE id = ?', id).printCount)
  /**
   * ⚠️ نشست ۲۲۲ · فاز ۶ — از این فاز، `printCredit`/`printCreditBatch` هم «نام چاپگر»
   * را از resolver مشترک (با فهرست زنده) می‌گیرند. پس این بخش باید یک چاپگر واقعی در
   * ماک داشته باشد؛ وگرنه پیش از رسیدن به منطقِ «لغو / نتیجه‌ی نامعلوم» با پیام
   * «هیچ چاپگری نصب نیست» متوقف می‌شود. تغییر فقط در فیکسچر است و هیچ ادعایی
   * ضعیف/حذف نشده.
   */
  const installPrinter = () => {
    mock.state.printers = [{ name: 'S129A-Test', displayName: 'S129A-Test', isDefault: true, status: 0 }]
  }
  const run = async (outcome, input) => { mock.reset(); installPrinter(); mock.state.printOutcome = outcome; return safe(() => printService.printCredit(input)) }

  const idCancel = credit()
  const rc = await run('canceled', { id: idCancel, silent: false })
  eq('لغو ⇒ پیام «چاپ لغو شد»', rc?.__error, 'چاپ لغو شد و هیچ برگه‌ای چاپ نشد.')
  eq('لغو ⇒ printCount = ۰ (شمرده نشد)', pc(idCancel), 0)

  const idOk = credit()
  const ro = await run('success', { id: idOk, silent: true })
  eq('موفق ⇒ printCount = ۱', [ro?.__error ?? null, pc(idOk)], [null, 1])

  const idClose = credit()
  const rcl = await run('close', { id: idClose, silent: true })
  eq('پنجره بسته شد ⇒ پیام «معلوم نیست برگه چاپ شده باشد»', /معلوم نیست برگه چاپ شده باشد/.test(rcl?.__error ?? ''), true)
  eq('پنجره بسته شد ⇒ احتیاطاً شمرده شد (printCount = ۱) تا نسخه‌ی بعدی «اصل» دوم نشود', pc(idClose), 1)
  const note = seed.one('SELECT note FROM "AuditLog" WHERE entityId = ? AND action IN (\'CREDIT_PRINT\',\'CREDIT_REPRINT\') ORDER BY id DESC LIMIT 1', idClose)?.note ?? ''
  eq('Audit همان چاپ «نتیجه‌ی نامعلوم» را صریح می‌گوید', /نتیجه‌ی چاپ نامعلوم/.test(note), true)

  const idCrash = credit()
  const rcr = await run('crash', { id: idCrash, silent: false, copies: 3 })
  eq('crash ⇒ پیام علت «از کار افتادن»', /از کار افتادن/.test(rcr?.__error ?? ''), true)
  eq('crash روی نسخه‌ی ۱ از ۳ ⇒ فقط همان یک نسخه شمرده شد و بقیه چاپ نشدند', [pc(idCrash), mock.state.printCalls.length], [1, 1])

  // timeout: setTimeout های ≥ ۳۰ ثانیه را ثبت و کوتاه می‌کنیم تا مسیر timeout واقعاً اجرا شود
  const realST = globalThis.setTimeout
  const delays = []
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 10_000) { delays.push(ms); return realST(fn, 5, ...a) } return realST(fn, ms, ...a) }
  try {
    const idHang = credit()
    const rh = await run('hang', { id: idHang, silent: true })
    eq('چاپ بی‌صدا + درایور بی‌پاسخ ⇒ timeout ۳۰ ثانیه با پیام «معلوم نیست»', [delays.at(-1), /معلوم نیست برگه چاپ شده باشد/.test(rh?.__error ?? '')], [30_000, true])
    eq('timeout ⇒ احتیاطاً شمرده شد (printCount = ۱)', pc(idHang), 1)
    delays.length = 0
    const idDlg = credit()
    await run('hang', { id: idDlg, silent: false })
    eq('چاپ با دیالوگ (silent:false) مهلت ۳۰ ثانیه‌ای ندارد (≥ ۱۰ دقیقه، کاربر هنوز در دیالوگ است)', (delays.at(-1) ?? 0) >= 600_000, true)
  } finally { globalThis.setTimeout = realST }

  // چاپ گروهی: نتیجه‌ی نامعلوم ⇒ همه‌ی اسناد همان Job احتیاطاً شمرده شوند؛ لغو ⇒ هیچ‌کدام
  const g1 = credit(), g2 = credit()
  mock.reset(); installPrinter(); mock.state.printOutcome = 'close'
  const rg = await safe(() => printService.printCreditBatch({ ids: [g1, g2] }))
  eq('گروهی + پنجره بسته ⇒ پیام «معلوم نیست»', /معلوم نیست برگه چاپ شده باشد/.test(rg?.__error ?? ''), true)
  eq('گروهی + پنجره بسته ⇒ هر دو سند شمرده شدند', [pc(g1), pc(g2)], [1, 1])
  const g3 = credit(), g4 = credit()
  mock.reset(); installPrinter(); mock.state.printOutcome = 'canceled'
  await safe(() => printService.printCreditBatch({ ids: [g3, g4] }))
  eq('گروهی + لغو ⇒ هیچ‌کدام شمرده نشد', [pc(g3), pc(g4)], [0, 0])
}

console.log('\n— ۵) نشست ۹۰: هیچ مسیر خطایی پنجره‌ی مخفی را نشت نمی‌دهد و علت واقعی پوشانده نمی‌شود')
{
  const W = mock.BrowserWindow.prototype
  const origLoad = W.loadURL, origPrinters = mock.state && W.constructor
  mock.reset()
  W.loadURL = async function () { throw Object.assign(new Error('ERR_FAILED'), { code: 'ERR_FAILED' }) }
  const r1 = await safe(() => printer.printHtml('<p>x</p>', { silent: true }))
  W.loadURL = origLoad
  eq('خطای loadURL ⇒ پیام فارسی با کد خطا و «چیزی به چاپگر فرستاده نشد»', /سند چاپی آماده نشد و چیزی به چاپگر فرستاده نشد \(کد خطا: ERR_FAILED\)/.test(r1?.__error ?? ''), true)
  eq('خطای loadURL ⇒ پنجره بسته شد، هیچ چاپی فرستاده نشد', [mock.state.windows.every((w) => w.isDestroyed()), mock.state.printCalls.length], [true, 0])
  mock.reset(); mock.state.printOutcome = 'failed'
  const r2 = await safe(() => printer.printHtml('<p>x</p>', { silent: true }))
  eq('خطای چاپ ⇒ پیام هدف و پنجره بسته', [/پاسخ سیستم چاپ: «failed»/.test(r2?.__error ?? ''), mock.state.windows.every((w) => w.isDestroyed())], [true, true])
  mock.reset(); mock.state.printOutcome = 'close'
  const r3 = await safe(() => printer.printHtml('<p>x</p>', { silent: true }))
  eq('پنجره‌ای که خودش بسته شد ⇒ finally خطای «Object has been destroyed» نمی‌سازد، علت واقعی می‌ماند', /معلوم نیست برگه چاپ شده باشد/.test(r3?.__error ?? '') && !/destroyed/.test(r3?.__error ?? ''), true)
  mock.reset()
  const WC = Object.getPrototypeOf(new mock.BrowserWindow({ show: false }).webContents)
  mock.reset()
  const origGP = WC.getPrintersAsync
  WC.getPrintersAsync = async () => { throw new Error('enum failed') }
  const r4 = await safe(() => printer.listPrinters())
  WC.getPrintersAsync = origGP
  eq('خطای فهرست چاپگر ⇒ پنجره بسته شد', [!!r4?.__error, mock.state.windows.length > 0 && mock.state.windows.every((w) => w.isDestroyed())], [true, true])
  mock.reset()
  const big = '<p>' + 'ج'.repeat(400_000) + '</p>'
  const r5 = await safe(() => printer.printHtml(big, { silent: true }))
  eq('سند بزرگ (> مرز data URL) از فایل موقت چاپ و فایل موقت پاک شد', [r5?.__error ?? null, mock.state.loads[0]?.via, readdirSync(mock.state.tempRoot).length], [null, 'file', 0])
  mock.reset(); mock.state.printOutcome = 'crash'
  const r6 = await safe(() => printer.printHtml(big, { silent: true }))
  eq('سند بزرگ + crash ⇒ فایل موقت باز هم پاک شد', [/از کار افتادن/.test(r6?.__error ?? ''), readdirSync(mock.state.tempRoot).length], [true, 0])
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} بررسی موفق · ${bad} ناموفق`)
process.exit(bad ? 1 : 0)
