/**
 * ممیزی نشست ۱۳۲ — تأیید رفتاری exportTableFile (fix-s132 فقط دو مسیر بی‌پسوند را می‌سنجید):
 *   • نام بی‌پسوند با preferred=csv ⇒ ‎.csv و محتوای متنی CSV؛ preferred=xlsx ⇒ ‎.xlsx و امضای PK.
 *   • پسوند صریح با حروف بزرگ (‎.CSV/‎.XLSX) بر preferred غلبه می‌کند و محتوا با پسوند می‌خواند.
 *   • پسوند دیگر (‎.txt) ⇒ ‎.txt.xlsx / ‎.txt.csv (هرگز فایل ‎.txt با محتوای xlsx).
 *   • ask:false (پوشه‌ی exports)، لغو دیالوگ، ترتیب فیلترها و defaultPath.
 * مشاهده‌ی P3 ثبت‌شده: Electron فیلتر انتخاب‌شده را برنمی‌گرداند ⇒ برای نام بی‌پسوند قالب = preferred.
 */
import { register } from 'node:module'
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, basename, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
let ok = 0, bad = 0
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { ok++; console.log(`  ✓ ${label}`) }
  else { bad++; console.log(`  ✗ ${label} · دریافت ${JSON.stringify(got)?.slice(0, 300)} · انتظار ${JSON.stringify(want)}`) }
}
const root = process.env.MAHAK_ROOT ? resolve(process.env.MAHAK_ROOT) : resolve('.')
register(pathToFileURL(join(root, 'tests/audit-fixes/support/s129-hooks.mjs')).href)
const mock = await import(pathToFileURL(join(root, 'tests/audit-fixes/support/s129-electron-mock.mjs')).href)
const { exportTableFile } = await import(pathToFileURL(join(root, 'src/main/services/ExportService.ts')).href)
const { toUserMessage } = await import(pathToFileURL(join(root, 'src/main/errors.ts')).href)
const safe = async (fn) => { try { return await fn() } catch (e) { return { __error: toUserMessage(e) } } }

const dir = mkdtempSync(join(tmpdir(), 's132a-'))
const base = { headers: ['عنوان', 'مبلغ'], rows: [['فروش', 125000], ['=HYPERLINK("x")', -5000]], reveal: false }
const isZip = (p) => readFileSync(p).subarray(0, 2).toString('latin1') === 'PK'
const isCsvText = (p) => { const t = readFileSync(p, 'utf8'); return !isZip(p) && t.includes('عنوان,مبلغ') && t.includes('125000') }
const run = async (name, format, extra = {}) => {
  mock.reset()
  mock.state.dialogResult = { canceled: false, filePath: join(dir, name) }
  return safe(() => exportTableFile({ ...base, fileName: 'گزارش', format, ...extra }))
}

console.log('\n— ۱) نام بی‌پسوند')
{
  const c = await run('بی‌پسوند-۱', 'csv')
  eq('csv ⇒ مسیر ‎.csv', basename(c.path ?? ''), 'بی‌پسوند-۱.csv')
  eq('csv ⇒ format=csv', c.format, 'csv')
  eq('csv ⇒ محتوای متنی CSV (نه ZIP)', isCsvText(c.path), true)
  eq('csv ⇒ فایل بی‌پسوند خام ساخته نشد', existsSync(join(dir, 'بی‌پسوند-۱')), false)
  const x = await run('بی‌پسوند-۲', 'xlsx')
  eq('xlsx ⇒ مسیر ‎.xlsx', basename(x.path ?? ''), 'بی‌پسوند-۲.xlsx')
  eq('xlsx ⇒ format=xlsx و امضای PK', [x.format, isZip(x.path)], ['xlsx', true])
  const d = await run('بی‌پسوند-۳', undefined)
  eq('format نامشخص ⇒ پیش‌فرض xlsx', [basename(d.path ?? ''), d.format, isZip(d.path)], ['بی‌پسوند-۳.xlsx', 'xlsx', true])
  eq('تعداد ردیف گزارش‌شده = ۲', c.rows, 2)
}

console.log('\n— ۲) پسوند صریح با حروف بزرگ بر preferred غلبه می‌کند')
{
  const a = await run('بزرگ.CSV', 'xlsx')
  eq('‎.CSV با preferred=xlsx ⇒ همان مسیر، بی‌پسوند اضافه', basename(a.path ?? ''), 'بزرگ.CSV')
  eq('‎.CSV ⇒ format=csv و محتوای متنی', [a.format, isCsvText(a.path)], ['csv', true])
  const b = await run('بزرگ.XLSX', 'csv')
  eq('‎.XLSX با preferred=csv ⇒ همان مسیر', basename(b.path ?? ''), 'بزرگ.XLSX')
  eq('‎.XLSX ⇒ format=xlsx و امضای PK', [b.format, isZip(b.path)], ['xlsx', true])
  const m = await run('مخلوط.CsV', 'xlsx')
  eq('‎.CsV ⇒ csv', [basename(m.path ?? ''), m.format, isCsvText(m.path)], ['مخلوط.CsV', 'csv', true])
}

console.log('\n— ۳) پسوند دیگر')
{
  const t = await run('یادداشت.txt', 'xlsx')
  eq('‎.txt با xlsx ⇒ ‎.txt.xlsx', basename(t.path ?? ''), 'یادداشت.txt.xlsx')
  eq('‎.txt.xlsx ⇒ امضای PK', isZip(t.path), true)
  eq('هیچ فایل ‎.txt با محتوای xlsx ساخته نشد', existsSync(join(dir, 'یادداشت.txt')), false)
  const t2 = await run('یادداشت۲.txt', 'csv')
  eq('‎.txt با csv ⇒ ‎.txt.csv و متن', [basename(t2.path ?? ''), isCsvText(t2.path)], ['یادداشت۲.txt.csv', true])
  const t3 = await run('گزارش.csv.bak', 'xlsx')
  eq('‎.csv.bak ⇒ پسوند csv میانی نادیده، ‎.csv.bak.xlsx', basename(t3.path ?? ''), 'گزارش.csv.bak.xlsx')
  eq('هیچ ‎.tmp باقی نماند', readdirSync(dir).filter((f) => f.endsWith('.tmp')), [])
}

console.log('\n— ۴) دیالوگ: فیلترها، defaultPath، لغو')
{
  mock.reset()
  mock.state.dialogResult = { canceled: true, filePath: undefined }
  const c = await safe(() => exportTableFile({ ...base, fileName: 'لغو', format: 'csv' }))
  eq('لغو ⇒ canceled=true، path=null، format=preferred', [c.canceled, c.path, c.format], [true, null, 'csv'])
  const call = mock.state.dialogCalls.at(-1)
  const opts = call?.options ?? call?.[1] ?? call?.[0] ?? call
  eq('preferred=csv ⇒ فیلتر اول csv', opts?.filters?.[0]?.extensions, ['csv'])
  eq('defaultPath با ‎.csv', /\.csv$/.test(opts?.defaultPath ?? ''), true)
  mock.reset()
  mock.state.dialogResult = { canceled: false, filePath: '' }
  const e = await safe(() => exportTableFile({ ...base, fileName: 'خالی', format: 'xlsx' }))
  eq('مسیر خالی ⇒ canceled (هیچ فایلی)', [e.canceled, e.path], [true, null])
  const none = await safe(() => exportTableFile({ headers: [], rows: [], fileName: 'x' }))
  eq('بدون ستون ⇒ پیام هدف', /ستونی برای خروجی گرفتن مشخص نشده است/.test(none?.__error ?? ''), true)
}

console.log('\n— ۵) ask:false (پوشه‌ی exports)')
{
  mock.reset()
  const a = await safe(() => exportTableFile({ ...base, fileName: 'خودکار', format: 'csv', ask: false }))
  eq('ask:false csv ⇒ ‎.csv در userData/exports، متن', [/\.csv$/.test(a.path ?? ''), basename(dirname(a.path ?? '')), isCsvText(a.path)], [true, 'exports', true])
  const b = await safe(() => exportTableFile({ ...base, fileName: 'خودکار', format: 'xlsx', ask: false }))
  eq('ask:false xlsx ⇒ ‎.xlsx و PK', [/\.xlsx$/.test(b.path ?? ''), isZip(b.path)], [true, true])
  eq('ask:false دیالوگ باز نکرد', mock.state.dialogCalls.length, 0)
}

console.log(`\n${bad ? '✗' : '✓'} ${ok} موفق · ${bad} ناموفق`)
if (bad) process.exitCode = 1
