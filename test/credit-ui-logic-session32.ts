/**
 * سوییت منطق خالص جلسه ۳۲ — بخش ۱۱ `src/shared/creditUi.ts`:
 * «داده‌ی هر خروجیِ بازه‌ای از کجا می‌آید» + ردیف جمع مشترک در تب گزارشات.
 *
 * الگوی نشست‌های ۳۰ و ۳۱ عیناً ادامه یافته است:
 *   • هر تصمیم تازه **واقعاً اجرا** می‌شود (نه گزاره روی متن)،
 *   • payload هر کانال با **امضای واقعی سرویس** و نام کانال با **کلیدهای واقعی
 *     `shared/ipc.ts`** سنجیده می‌شود (چون JSX حالا `CH[req.channel]` می‌زند و
 *     هارنس متنی نمی‌تواند این را ببیند)،
 *   • بخش آخر می‌سنجد که `SalesReports.tsx` واقعاً همین‌ها را *مصرف* می‌کند —
 *     «کد هرگز اجرانشده» کلاس باگ همین پروژه بوده است.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** همان ترفند جلسه ۳۰/۳۱: سورس واقعی، فقط با یک specifier قابل‌اجرا برای ESM خالص. */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-s32-'))
fs.copyFileSync('src/shared/credit.ts', path.join(tmp, 'credit.ts'))
const creditUiSrc = fs.readFileSync('src/shared/creditUi.ts', 'utf8')
fs.writeFileSync(path.join(tmp, 'creditUi.ts'), creditUiSrc.replace(/from '\.\/credit'/g, "from './credit.ts'"))
const ui: any = await import(pathToFileURL(path.join(tmp, 'creditUi.ts')).href)

const CREDIT_LIST_HEADERS: string[] = ui.CREDIT_LIST_HEADERS
const CREDIT_RANGE_EXPORTS: any[] = ui.CREDIT_RANGE_EXPORTS
const CREDIT_RANGE_EXPORT_KINDS: string[] = ui.CREDIT_RANGE_EXPORT_KINDS
const CREDIT_DETAIL_EXPORT_KINDS: string[] = ui.CREDIT_DETAIL_EXPORT_KINDS
const CREDIT_RANGE_EXPORT_CHANNELS: Record<string, string> = ui.CREDIT_RANGE_EXPORT_CHANNELS
const creditExport = ui.creditExport
const creditListRow = ui.creditListRow
const creditListTotals = ui.creditListTotals
const creditRangeExportOrigin = ui.creditRangeExportOrigin
const creditRangeExportRequest = ui.creditRangeExportRequest
const creditRangeExportRows = ui.creditRangeExportRows

const reports = fs.readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const page = fs.readFileSync('src/renderer/src/pages/CreditManagement.tsx', 'utf8')
const ipcShared = fs.readFileSync('src/shared/ipc.ts', 'utf8')
const ipcMain = fs.readFileSync('src/main/ipc/index.ts', 'utf8')
const svc = fs.readFileSync('src/main/services/StoreCreditService.ts', 'utf8')

let pass = 0
let fail = 0
const out: string[] = []
function check(title: string, fn: () => boolean): void {
  let ok = false
  let err = ''
  try {
    ok = fn() === true
  } catch (e: any) {
    err = ` (${e?.message ?? e})`
  }
  if (ok) pass++
  else fail++
  out.push(`${ok ? 'PASS' : 'FAIL'}  ${title}${err}`)
}

const LIST_ROWS = [
  { code: 'A1', amount: 1000, usedAmount: 400, remaining: 600 },
  { code: 'A2', amount: 500, usedAmount: 0, remaining: 500 }
]

// ---------------------------------------------------------------------------
// ۱) منبع داده‌ی هر خروجی — `creditRangeExportOrigin`
// ---------------------------------------------------------------------------
check('۱. فهرست اعتبارها از ردیف‌های همان صفحه می‌آید (`rows`)', () => creditRangeExportOrigin('list') === 'rows')
check('۲. داشبورد و دو تفکیکش از خودِ داشبورد می‌آیند (`dashboard`)', () =>
  ['dashboard', 'byStatus', 'bySource'].every((k) => creditRangeExportOrigin(k) === 'dashboard'))
check('۳. سه گزارش سنگین فقط با کلیک خوانده می‌شوند (`fetch`)', () =>
  ['batches', 'reminders', 'reminderLogs'].every((k) => creditRangeExportOrigin(k) === 'fetch'))
check('۴. گزارش‌های تک‌اعتباری در تب بازه‌ای منبعی ندارند (`none`) ⇒ دکمه‌ی خالی ساخته نمی‌شود', () =>
  CREDIT_DETAIL_EXPORT_KINDS.every((k) => creditRangeExportOrigin(k) === 'none'))
check('۵. نوع ناشناس هم `none` است، نه `dashboard` (پیش‌فرضِ خطرناک)', () =>
  creditRangeExportOrigin('somethingElse' as any) === 'none' && creditRangeExportOrigin(undefined as any) === 'none')
check('۶. `lazy` در جدول دکمه‌ها دقیقاً همان `fetch` است (دو جا واگرا نمی‌شوند)', () =>
  CREDIT_RANGE_EXPORTS.every((e) => (e.lazy === true) === (creditRangeExportOrigin(e.kind) === 'fetch')))
check('۷. هر ۹ نوع خروجی یا بازه‌ای‌اند یا تک‌اعتباری (هیچ نوعی جا نمی‌ماند)', () => {
  const block = creditUiSrc.slice(creditUiSrc.indexOf('export type CreditExportKind ='))
  const kinds = [...block.slice(0, block.indexOf('export interface CreditExportSheet')).matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1])
  if (kinds.length !== 9) throw new Error('تعداد نوع‌ها عوض شده: ' + kinds.join(','))
  const covered = [...CREDIT_RANGE_EXPORT_KINDS, ...CREDIT_DETAIL_EXPORT_KINDS]
  const missing = kinds.filter((k) => !covered.includes(k))
  if (missing.length) throw new Error('نوع بی‌صاحب: ' + missing.join(','))
  return new Set(covered).size === kinds.length
})

// ---------------------------------------------------------------------------
// ۲) درخواست داده — `creditRangeExportRequest`
// ---------------------------------------------------------------------------
check('۸. خروجی‌هایی که داده‌شان روی صفحه است هیچ کانالی نمی‌زنند (`null`)', () =>
  ['list', 'dashboard', 'byStatus', 'bySource', 'redemptions', 'timeline'].every(
    (k) => creditRangeExportRequest(k, { fromJalali: '۱۴۰۴/۰۱/۰۱' }) === null
  ))
check('۹. دسته‌های گروهی: کانال `creditBatchList` با بازه‌ی صریح و پاسخ آرایه‌ای', () => {
  const r = creditRangeExportRequest('batches', { fromJalali: '1404/01/01', toJalali: '1404/01/31' })
  return (
    r.channel === 'creditBatchList' &&
    r.envelope === 'array' &&
    r.payload.fromJalali === '1404/01/01' &&
    r.payload.toJalali === '1404/01/31' &&
    r.payload.take === 500
  )
})
check('۱۰. لاگ یادآوری: کانال `creditReminderLogs` با همان بازه', () => {
  const r = creditRangeExportRequest('reminderLogs', { fromJalali: '1404/02/01', toJalali: '1404/02/02' })
  return r.channel === 'creditReminderLogs' && r.payload.fromJalali === '1404/02/01' && r.payload.toJalali === '1404/02/02'
})
check('۱۱. نامزدهای یادآوری بازه نمی‌گیرند (سرویس چنین فیلدی ندارد) و پاکت `rows` دارند', () => {
  const r = creditRangeExportRequest('reminders', { fromJalali: '1404/01/01', toJalali: '1404/01/31' })
  return (
    r.channel === 'creditReminderCandidates' &&
    r.envelope === 'rows' &&
    r.payload.onlyDue === false &&
    !('fromJalali' in r.payload) &&
    !('toJalali' in r.payload)
  )
})
check('۱۲. صافیِ «نوع» به نامزدها می‌رسد و خالی بودنش کلید اضافه نمی‌سازد', () => {
  const withSource = creditRangeExportRequest('reminders', { source: 'GIFT' })
  const without = creditRangeExportRequest('reminders', { source: '   ' })
  return withSource.payload.source === 'GIFT' && !('source' in without.payload)
})
check('۱۳. بازه‌ی خالی اصلاً فرستاده نمی‌شود (وگرنه پیش‌فرض سرویس خراب می‌شود)', () => {
  const r = creditRangeExportRequest('batches', { fromJalali: '', toJalali: '  ' })
  return Object.keys(r.payload).join(',') === 'take'
})
check('۱۴. سقف/کف `take`: خرابی ⇒ ۵۰۰ · بزرگ ⇒ ۲۰۰۰ · معتبر ⇒ خودش', () => {
  const a = creditRangeExportRequest('batches', { take: 0 }).payload.take
  const b = creditRangeExportRequest('batches', { take: 99999 }).payload.take
  const c = creditRangeExportRequest('batches', { take: 120 }).payload.take
  const d = creditRangeExportRequest('batches', { take: 'x' as any }).payload.take
  return a === 500 && b === 2000 && c === 120 && d === 500
})
check('۱۵. فیلتر بدون هیچ آرگومان هم کار می‌کند (دکمه‌ی بدون بازه سقوط نمی‌کند)', () => {
  const r = creditRangeExportRequest('reminderLogs')
  return r.channel === 'creditReminderLogs' && r.payload.take === 500
})

// ---------------------------------------------------------------------------
// ۳) قرارداد با بک‌اند — کانال و payload واقعی‌اند
// ---------------------------------------------------------------------------
check('۱۶. هر سه نام کانال، کلید واقعی `shared/ipc.ts` است (JSX حالا `CH[req.channel]` می‌زند)', () => {
  const keys = [...ipcShared.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'/gm)].map((m) => m[1])
  const missing = Object.values(CREDIT_RANGE_EXPORT_CHANNELS).filter((c) => !keys.includes(c))
  if (missing.length) throw new Error('کانال ناموجود: ' + missing.join(','))
  return Object.values(CREDIT_RANGE_EXPORT_CHANNELS).length === 3
})
check('۱۷. هر کانال در `main/ipc` ثبت شده و به یک متد `StoreCreditService` می‌رسد', () =>
  Object.values(CREDIT_RANGE_EXPORT_CHANNELS).every((c) =>
    new RegExp(`handle\\(IPC\\.${c},[^\\n]*storeCreditService\\.[A-Za-z]+\\(`).test(ipcMain)
  ))
check('۱۸. هر کلید payload در امضای واقعی همان متد سرویس وجود دارد (فیلدِ نخوانده = خروجی اشتباه)', () => {
  for (const [kind, channel] of Object.entries(CREDIT_RANGE_EXPORT_CHANNELS)) {
    const m = new RegExp(`handle\\(IPC\\.${channel},[^\\n]*storeCreditService\\.([A-Za-z]+)\\(`).exec(ipcMain)
    if (!m) throw new Error('هندلر پیدا نشد: ' + channel)
    const sig = new RegExp(`async ${m[1]}\\(\\s*filter: \\{([^}]*)\\}`).exec(svc)
    if (!sig) throw new Error('امضای سرویس پیدا نشد: ' + m[1])
    const accepted = [...sig[1].matchAll(/([A-Za-z][A-Za-z0-9]*)\?:/g)].map((x) => x[1])
    const req = creditRangeExportRequest(kind, { fromJalali: '1404/01/01', toJalali: '1404/01/31', source: 'GIFT', take: 300 })
    const extra = Object.keys(req.payload).filter((k) => !accepted.includes(k))
    if (extra.length) throw new Error(`${m[1]} این فیلدها را نمی‌خواند: ${extra.join(',')}`)
  }
  return true
})

// ---------------------------------------------------------------------------
// ۴) باز کردن پاسخ — `creditRangeExportRows`
// ---------------------------------------------------------------------------
check('۱۹. پاکت `{ enabled, rows }` باز می‌شود', () => {
  const r = creditRangeExportRequest('reminders', {})
  return creditRangeExportRows(r, { enabled: true, rows: [{ id: 1 }, { id: 2 }] }).length === 2
})
check('۲۰. پاسخ آرایه‌ای به پاکت‌بَر داده شود ⇒ آرایه‌ی خالی، نه crash', () => {
  const r = creditRangeExportRequest('reminders', {})
  return creditRangeExportRows(r, [{ id: 1 }]).length === 0
})
check('۲۱. کانال آرایه‌ای: آرایه عیناً رد می‌شود و غیرآرایه ⇒ خالی', () => {
  const r = creditRangeExportRequest('batches', {})
  return creditRangeExportRows(r, [{ id: 7 }])[0].id === 7 && creditRangeExportRows(r, null).length === 0
})
check('۲۲. `null` به‌جای درخواست (خروجی غیر-lazy) هم آرایه‌ی سالم می‌دهد', () =>
  creditRangeExportRows(null, [1, 2, 3]).length === 3 && creditRangeExportRows(null, undefined).length === 0)

// ---------------------------------------------------------------------------
// ۵) مسیر کامل: درخواست ⇒ باز کردن ⇒ برگه‌ی اکسل
// ---------------------------------------------------------------------------
check('۲۳. نامزدهای یادآوری: مسیر کامل یک برگه‌ی واقعی می‌دهد', () => {
  const r = creditRangeExportRequest('reminders', {})
  const raw = { enabled: true, rows: [{ code: 'C1', amount: 100, remaining: 100, holderPhone: '0912' }] }
  const sheet = creditExport('reminders', creditRangeExportRows(r, raw))
  return !!sheet && sheet.headers === ui.CREDIT_REMINDER_HEADERS && sheet.rows.length === 1
})
check('۲۴. تله‌ی واقعی: دادنِ *پاکت* به `creditExport` خروجی را بی‌صدا خالی می‌کرد', () => {
  const raw = { enabled: true, rows: [{ code: 'C1' }] }
  return creditExport('reminders', raw) === null && creditExport('reminders', creditRangeExportRows(creditRangeExportRequest('reminders', {}), raw)) !== null
})
check('۲۵. دسته‌ها: مسیر کامل + ردیف جمع در ستون‌های درست', () => {
  const r = creditRangeExportRequest('batches', {})
  const raw = [
    { id: 1, title: 'د۱', count: 2, amountEach: 50, totalAmount: 100 },
    { id: 2, title: 'د۲', count: 3, amountEach: 50, totalAmount: 150 }
  ]
  const sheet = creditExport('batches', creditRangeExportRows(r, raw))
  return sheet.totals[0] === 'جمع' && sheet.totals[2] === 5 && sheet.totals[4] === 250
})
check('۲۶. گزارش خالی ⇒ برگه‌ای ساخته نمی‌شود (فایل خالی روی دیسک نمی‌نشیند)', () =>
  creditExport('list', []) === null && creditExport('batches', []) === null && creditExport('dashboard', null) === null)

// ---------------------------------------------------------------------------
// ۶) ردیف جمع مشترک (بند ۲۷ هارنس، این بار در مسیر تب گزارشات)
// ---------------------------------------------------------------------------
check('۲۷. ردیف جمع همیشه هم‌طول سرستون است و فقط ستون‌های مالی پر می‌شوند', () => {
  const t = creditListTotals(LIST_ROWS.map(creditListRow))
  const filled = t.map((c: any, i: number) => (c === '' ? null : i)).filter((i: any) => i !== null)
  return t.length === CREDIT_LIST_HEADERS.length && filled.join(',') === '0,3,4,5'
})
check('۲۸. جدول روی صفحه و فایل اکسل از یک ردیف جمع واحد می‌آیند', () => {
  const body = LIST_ROWS.map(creditListRow)
  return JSON.stringify(creditExport('list', LIST_ROWS).totals) === JSON.stringify(creditListTotals(body))
})
check('۲۹. جمع ستون‌ها واقعاً حساب می‌شود (۱۰۰۰+۵۰۰، ۴۰۰+۰، ۶۰۰+۵۰۰)', () => {
  const t = creditListTotals(LIST_ROWS.map(creditListRow))
  return t[3] === 1500 && t[4] === 400 && t[5] === 1100
})

// ---------------------------------------------------------------------------
// ۷) مصرف واقعی در `SalesReports.tsx` — بدون این بخش، همه‌ی بالا «کد اجرانشده» است
// ---------------------------------------------------------------------------
check('۳۰. دکمه‌های خروجی از `CREDIT_RANGE_EXPORTS` ساخته می‌شوند، نه دست‌نویس', () =>
  /CREDIT_RANGE_EXPORTS\.map\(/.test(reports) &&
  CREDIT_RANGE_EXPORTS.every((e) => !reports.includes(`>${e.label}<`)))
check('۳۱. هر سه تصمیم تازه واقعاً در تب مصرف می‌شوند', () =>
  /creditRangeExportOrigin\(/.test(reports) && /creditRangeExportRequest\(/.test(reports) && /creditRangeExportRows\(/.test(reports))
check('۳۲. داده‌ی lazy با `CH[req.channel]` گرفته می‌شود و هیچ کانال اعتباری دستی در تب نمانده', () =>
  /call<any>\(CH\[req\.channel\], req\.payload\)/.test(reports) &&
  !/CH\.creditBatchList|CH\.creditReminderCandidates|CH\.creditReminderLogs/.test(reports))
check('۳۳. بار اول تب فقط داشبورد و فهرست را می‌خواند (سه گزارش سنگین نه)', () => {
  const load = reports.slice(reports.indexOf('const load = useCallback(async () => {'))
  const body = load.slice(0, load.indexOf('}, [open, fromJalali'))
  return /CH\.creditDashboard/.test(body) && /CH\.creditList/.test(body) && !/creditBatchList|creditReminder/.test(body)
})
check('۳۴. خروجی اکسل تب از `creditExport` می‌آید و جفت‌کردن دستی سرستون رفته', () =>
  /const sheet = creditExport\(kind, data\)/.test(reports) &&
  !/headers: CREDIT_LIST_HEADERS/.test(reports) &&
  !/fileName: 'گزارش-مدیریت-اعتبار-خرید'/.test(reports))
/**
 * جلسه ۳۳ — همان گزاره، با نامِ تازه‌ی مصرف‌کننده: بریدنِ ستون‌های دیده‌شده هم
 * از JSX بیرون رفت (`creditListScreenTotals` در بخش ۱۲) و عددِ ۱۴ دیگر در
 * هیچ‌کدام از دو صفحه نیست. معنای گزاره عوض نشده: ردیف جمعِ روی صفحه همان
 * ردیف جمعِ فایل است، نه یک pad دستی.
 */
check('۳۵. ردیف جمعِ روی صفحه از `creditListTotals` می‌آید (نه colSpan و pad دستی)', () =>
  /creditListScreenTotals\(listRows\)/.test(reports) &&
  /listTotals\.map\(/.test(reports) &&
  !/\.slice\(0, 14\)/.test(reports) &&
  !/Array\(CREDIT_LIST_HEADERS\.length - 6\)\.fill/.test(reports))
check('۳۶. کلیک دوباره روی دکمه‌ها وسط خواندن قفل است (یک درخواست در هر لحظه)', () =>
  /setExporting\(kind\)/.test(reports) && /setExporting\(null\)/.test(reports) && /exporting !== null/.test(reports))
check('۳۷. گزارش‌های تک‌اعتباری هنوز فقط از صفحه‌ی جزئیات و با داده‌ی همان اعتبار می‌آیند', () =>
  /onExport=\{\(kind: CreditExportKind\)/.test(page) &&
  /kind === 'redemptions' \? detail\.redemptions/.test(page) &&
  /kind === 'timeline' \? detail\.timeline/.test(page))
check('۳۸. تب گزارشات هیچ نوع تک‌اعتباری‌ای را صدا نمی‌زند', () =>
  CREDIT_DETAIL_EXPORT_KINDS.every((k) => !new RegExp(`'${k}'`).test(reports)))
check('۳۹. قاعده‌ی محل تصمیم‌ها: منبع/کانال/پاکت هیچ‌کدام در JSX تعریف نشده‌اند', () =>
  !/envelope:/.test(reports) && !/onlyDue:/.test(reports) && /from '@shared\/creditUi'/.test(reports))

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 32): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
