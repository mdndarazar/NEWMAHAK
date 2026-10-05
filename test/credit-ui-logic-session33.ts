/**
 * سوییت منطق خالص جلسه ۳۳ — بخش ۱۲ و ۱۳ `src/shared/creditUi.ts` (فهرست روی
 * صفحه · کانال و بار داده‌ی هر نما) و بخش ۹.۲ `src/shared/credit.ts` (آستانه‌ی
 * «نسخه‌ی مجدد»)، به‌علاوه‌ی یک قرارداد تازه که هیچ نشستی نداشت:
 *
 *   **هر نامِ ستونی که لایه‌ی مشترک به Prisma می‌دهد، واقعاً در
 *   `prisma/schema.prisma` وجود دارد.** ممیزی می‌گفت §۱۶/§۱۲/§۲ «انجام شد»، ولی
 *   تنها چیزی که پشتشان بود یک regex روی سورس سرویس بود؛ یک نام ستونِ غلط
 *   (`usedReceiptNo` ⇄ `usedInvoiceId`) تا لحظه‌ی اجرای واقعی روی ویندوز پیدا
 *   نمی‌شد — و در این محیط هیچ‌وقت اجرا نمی‌شود.
 *
 * الگوی نشست‌های ۳۰ تا ۳۲ عیناً ادامه یافته: هر تصمیم **اجرا** می‌شود و بخش آخر
 * *مصرف* واقعی‌اش را در JSX می‌سنجد.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'credit-ui-s33-'))
fs.copyFileSync('src/shared/credit.ts', path.join(tmp, 'credit.ts'))
const creditUiSrc = fs.readFileSync('src/shared/creditUi.ts', 'utf8')
fs.writeFileSync(path.join(tmp, 'creditUi.ts'), creditUiSrc.replace(/from '\.\/credit'/g, "from './credit.ts'"))
const ui: any = await import(pathToFileURL(path.join(tmp, 'creditUi.ts')).href)
const rules: any = await import(pathToFileURL(path.join(tmp, 'credit.ts')).href)

const page = fs.readFileSync('src/renderer/src/pages/CreditManagement.tsx', 'utf8')
const reports = fs.readFileSync('src/renderer/src/pages/SalesReports.tsx', 'utf8')
const svc = fs.readFileSync('src/main/services/StoreCreditService.ts', 'utf8')
const printSvc = fs.readFileSync('src/main/services/PrintService.ts', 'utf8')
const ipcShared = fs.readFileSync('src/shared/ipc.ts', 'utf8')
const ipcMain = fs.readFileSync('src/main/ipc/index.ts', 'utf8')
const enums = fs.readFileSync('src/shared/enums.ts', 'utf8')
const schema = fs.readFileSync('prisma/schema.prisma', 'utf8')

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

/** نام ستون‌های یک مدل Prisma (بدون attribute های بلوکی). */
function modelFields(model: string): string[] {
  const at = schema.indexOf(`model ${model} {`)
  if (at < 0) throw new Error('مدل پیدا نشد: ' + model)
  const body = schema.slice(at, schema.indexOf('\n}', at))
  return [...body.matchAll(/^\s{2}(\w+)\s+\S/gm)].map((m) => m[1])
}
const CREDIT_COLUMNS = modelFields('StoreCredit')
const AUDIT_COLUMNS = modelFields('AuditLog')

const PRISMA_OPS = new Set([
  'OR', 'AND', 'NOT', 'in', 'notIn', 'not', 'equals', 'contains', 'startsWith', 'endsWith',
  'mode', 'gt', 'gte', 'lt', 'lte', 'some', 'every', 'none', 'is', 'isNot'
])
/** هر کلیدی که *نام ستون* است (نه عملگر Prisma) از یک شرط `where`. */
function columnsOf(node: any, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(node)) {
    for (const x of node) columnsOf(x, into)
    return into
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (!PRISMA_OPS.has(k)) into.add(k)
      columnsOf(v, into)
    }
  }
  return into
}

const LIST_ROW = {
  code: 'A1',
  sourceLabel: 'دستی',
  statusLabel: 'فعال',
  amount: 1000,
  usedAmount: 400,
  remaining: 600,
  maxUses: 3,
  usedCount: 1,
  customerName: 'کاظمی',
  holderCompany: ''
}

// ---------------------------------------------------------------------------
// ۱) بخش ۱۲ — فهرست اعتبار روی صفحه
// ---------------------------------------------------------------------------
check('۱. ستون‌های دیده‌شده = ۱۴ ستون اولِ سرستون فهرست (یک عدد، یک جا)', () =>
  ui.CREDIT_LIST_SCREEN_COLUMNS === 14 &&
  ui.CREDIT_LIST_SCREEN_HEADERS.length === 14 &&
  ui.CREDIT_LIST_SCREEN_HEADERS.join('|') === ui.CREDIT_LIST_HEADERS.slice(0, 14).join('|'))
check('۲. ردیف روی صفحه همان ردیف فایل است، فقط بریده (یک ردیف‌ساز)', () => {
  const full = ui.creditListRow(LIST_ROW)
  const screen = ui.creditListScreenRow(LIST_ROW)
  return screen.length === 14 && JSON.stringify(screen) === JSON.stringify(full.slice(0, 14))
})
check('۳. ستون «نوع» روی صفحه هم fallback دارد (تب گزارشات بی‌fallback بود)', () =>
  ui.creditListScreenRow({ code: 'B1', source: 'MANUAL' })[1] !== '' &&
  ui.creditListScreenRow({ code: 'B1', status: 'ACTIVE' })[2] !== '')
check('۴. ستون‌های مبلغی و شمارشی با سرستونشان جور‌اند (جابه‌جا شدن ستون لو می‌رود)', () => {
  const H = ui.CREDIT_LIST_HEADERS
  const money = ui.CREDIT_LIST_MONEY_COLUMNS.map((i: number) => H[i]).join('|')
  const count = ui.CREDIT_LIST_COUNT_COLUMNS.map((i: number) => H[i]).join('|')
  if (money !== 'مبلغ|مصرف‌شده|باقی‌مانده|حداقل خرید|سقف هر تراکنش') throw new Error('ستون مبلغی: ' + money)
  if (count !== 'دفعات مجاز|دفعات مصرف|روز باقی‌مانده|فیش مصرف|دسته‌ی گروهی|تعداد چاپ') throw new Error('ستون شمارشی: ' + count)
  return true
})
check('۵. قالب هر سلول از همان جدول می‌آید و ستون ناشناس `text` است (پیش‌فرض امن)', () =>
  ui.creditListCellFormat(3) === 'money' &&
  ui.creditListCellFormat(6) === 'count' &&
  ui.creditListCellFormat(0) === 'text' &&
  ui.creditListCellFormat(999) === 'text' &&
  ui.creditListCellFormat(undefined) === 'text')
check('۶. ستون‌های جمع‌دار همه مبلغی‌اند (جمعِ یک ستون شمارشی بی‌معناست)', () =>
  ui.CREDIT_LIST_TOTAL_COLUMNS.every((c: number) => ui.creditListCellFormat(c) === 'money'))
check('۷. ردیف جمعِ روی صفحه = برشِ همان ردیف جمعِ فایل', () => {
  const body = [ui.creditListRow(LIST_ROW), ui.creditListRow({ code: 'A2', amount: 500, remaining: 500 })]
  const full = ui.creditListTotals(body)
  const screen = ui.creditListScreenTotals(body)
  return screen.length === 14 && JSON.stringify(screen) === JSON.stringify(full.slice(0, 14)) && screen[3] === 1500
})
check('۸. برچسب ردیف جمع رقمِ لاتین می‌دهد (صفحه با `faDigits` فارسی‌اش می‌کند)', () =>
  ui.creditListTotalsLabel(7) === 'جمع 7 اعتبار' && ui.creditListTotalsLabel(-2) === 'جمع 0 اعتبار')
check('۹. جدول تفکیک: ستون ۱ شمارش، ستون ۰ متن، بقیه مبلغ', () =>
  ui.creditBreakdownCellFormat(0) === 'text' &&
  ui.creditBreakdownCellFormat(1) === 'count' &&
  [2, 3, 4].every((i) => ui.creditBreakdownCellFormat(i) === 'money') &&
  ui.CREDIT_BREAKDOWN_HEADERS[1] === 'تعداد')
check('۱۰. تب‌های صفحه = همه‌ی نماها جز `detail` (که از فهرست باز می‌شود)', () => {
  const tabs = ui.CREDIT_VIEW_TABS.map((t: any) => t.view)
  const views = Object.keys(ui.CREDIT_VIEW_CHANNELS)
  if (tabs.includes('detail')) throw new Error('`detail` نباید تب داشته باشد')
  const missing = views.filter((v) => v !== 'detail' && !tabs.includes(v))
  if (missing.length) throw new Error('نمای بی‌تب: ' + missing.join(','))
  return ui.CREDIT_VIEW_TABS.every((t: any) => typeof t.label === 'string' && t.label.length > 0)
})

// ---------------------------------------------------------------------------
// ۲) بخش ۱۳ — کانال و بار داده‌ی هر نما
// ---------------------------------------------------------------------------
check('۱۱. هر نما یک درخواست می‌سازد و نمای ناشناس هیچ کانالی صدا نمی‌زند', () => {
  for (const v of Object.keys(ui.CREDIT_VIEW_CHANNELS)) if (!ui.creditViewRequest(v as any)) throw new Error('بی‌درخواست: ' + v)
  return ui.creditViewRequest('somethingElse' as any) === null
})
check('۱۲. هر کانالِ نما یک کلید واقعی `shared/ipc.ts` است و در main هم handler دارد', () => {
  const keys = [...ipcShared.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):\s*'/gm)].map((m) => m[1])
  for (const ch of Object.values(ui.CREDIT_VIEW_CHANNELS) as string[]) {
    if (!keys.includes(ch)) throw new Error('کانال ناموجود: ' + ch)
    if (!ipcMain.includes(`IPC.${ch},`)) throw new Error('بدون handler: ' + ch)
  }
  return true
})
check('۱۳. هر کلید `payload` در امضای واقعی همان سرویس وجود دارد', () => {
  const views = Object.keys(ui.CREDIT_VIEW_CHANNELS)
  for (const v of views) {
    const req = ui.creditViewRequest(v as any, {
      fromJalali: '۱۴۰۴/۰۱/۰۱',
      toJalali: '۱۴۰۴/۰۱/۳۱',
      search: 'الف',
      source: 'MANUAL',
      status: 'ACTIVE',
      onlyDue: true,
      onlyWithRemaining: true
    })
    for (const k of Object.keys(req.payload ?? {}))
      if (!new RegExp(`\\b${k}\\??:`).test(svc)) throw new Error(`کلید بی‌امضا (${v}): ${k}`)
  }
  return true
})
check('۱۴. بازه‌ی خالی هیچ کلیدی نمی‌سازد (پیش‌فرض «امروز»ِ `creditList` خراب نشود)', () => {
  const p = ui.creditViewRequest('list', { fromJalali: '', toJalali: '   ' }).payload
  return !('fromJalali' in p) && !('toJalali' in p) && !('search' in p) && !('source' in p) && !('status' in p)
})
check('۱۵. `take` یک عدد مشترک است و داخل کلمپ واقعی سرویس می‌ماند', () => {
  const clamp = svc.match(/clampInt\(filter\.take \?\? (\d+), (\d+), (\d+), \d+\)/)
  if (!clamp) throw new Error('کلمپ سرویس پیدا نشد')
  const [, , min, max] = clamp.map(Number) as unknown as number[]
  if (!(ui.CREDIT_LIST_TAKE >= min && ui.CREDIT_LIST_TAKE <= max)) throw new Error('take بیرون از کلمپ سرویس')
  return ui.creditTake(0) === ui.CREDIT_LIST_TAKE && ui.creditTake(1e9) === 5000 && ui.creditTake(25) === 25
})
check('۱۶. نمای یادآوری بازه نمی‌گیرد و `onlyDue` صریح است (§۱۴)', () => {
  const on = ui.creditViewRequest('reminders', { onlyDue: true, fromJalali: '۱۴۰۴/۰۱/۰۱' })
  const off = ui.creditViewRequest('reminders', {})
  return on.payload.onlyDue === true && off.payload.onlyDue === false &&
    !('fromJalali' in on.payload) && on.envelope === 'rows'
})
check('۱۷. `creditSettingsGet` هیچ ورودی نمی‌گیرد (payload = null)', () =>
  ui.creditViewRequest('settings').payload === null && ui.creditViewRequest('settings').envelope === 'object')
check('۱۸. `onlyWithRemaining` فقط به فهرست می‌رود، نه به داشبورد (تله‌ی این نشست)', () => {
  const req = ui.creditReportRequests({ fromJalali: '۱۴۰۴/۰۱/۰۱', toJalali: '۱۴۰۴/۰۱/۳۱', onlyWithRemaining: true })
  for (const k of ui.CREDIT_LIST_ONLY_FILTERS) if (k in req.dashboard.payload) throw new Error('به داشبورد رفت: ' + k)
  return req.list.payload.onlyWithRemaining === true && req.dashboard.payload.fromJalali === '۱۴۰۴/۰۱/۰۱'
})
check('۱۹. سرویس واقعاً این فیلتر را فقط در `list` اعمال می‌کند (ادعای بند ۱۸ درست است)', () => {
  const hits = [...svc.matchAll(/filter\.onlyWithRemaining/g)].length
  const inList = /return filter\.onlyWithRemaining \? shaped\.filter/.test(svc)
  return hits === 1 && inList
})
check('۲۰. `detail` و `list` از یک کانال می‌خوانند (جزئیات از همان فهرست باز می‌شود)', () =>
  ui.CREDIT_VIEW_CHANNELS.detail === ui.CREDIT_VIEW_CHANNELS.list &&
  JSON.stringify(ui.creditViewRequest('detail', { search: 'x' })) === JSON.stringify(ui.creditViewRequest('list', { search: 'x' })))

// ---------------------------------------------------------------------------
// ۳) بخش ۹.۲ — آستانه‌ی «نسخه‌ی مجدد»
// ---------------------------------------------------------------------------
check('۲۱. نسخه‌ی اول «اصل» است و از دومی به بعد «مجدد»', () =>
  rules.isCreditReprint(0) === false && rules.isCreditReprint(1) === true && rules.isCreditReprint('3') === true &&
  rules.isCreditReprint(null) === false && rules.isCreditReprint(-5) === false)
check('۲۲. عملِ AuditLog از همان آستانه می‌آید و هر دو کلید در `enums.ts` واقعی‌اند', () => {
  const a = rules.creditPrintAction(0)
  const b = rules.creditPrintAction(4)
  if (a !== 'CREDIT_PRINT' || b !== 'CREDIT_REPRINT') throw new Error('عمل با آستانه جور نیست')
  for (const k of [a, b]) if (!new RegExp(`\\b${k}\\s*[:=]`).test(enums)) throw new Error('کلید ناموجود در enums: ' + k)
  return true
})
check('۲۳. شمارش نسخه‌های مجددِ چاپ گروهی و نقشه‌ی کاغذها از یک قاعده می‌آیند', () => {
  if (rules.creditReprintCount([0, 0, 1, 9]) !== 2) throw new Error('شمارش گروهی')
  if (rules.creditReprintCount('x' as any) !== 0) throw new Error('ورودی خراب باید صفر بدهد')
  const plan = rules.creditCopyPlan(0, 3)
  return plan.map((c: any) => c.reprint).join(',') === 'false,true,true' &&
    plan.map((c: any) => c.printCount).join(',') === '1,2,3' &&
    rules.creditCopyPlan(2, 1)[0].reprint === true
})
/**
 * جلسه ۳۴ — نامِ مصرف‌کننده به‌روز شد (نه حذف): عملِ AuditLog حالا از
 * `creditPrintAudit` (بخش ۹.۳) می‌آید که خودش روی همین آستانه بنا است، پس
 * گزاره همان چیز را می‌سنجد: هیچ مقایسه‌ی دستی در دو سرویس نمانده باشد.
 */
check('۲۴. هر سه مصرف‌کننده تصمیم مشترک را می‌زنند و هیچ آستانه‌ی دستی نمانده', () =>
  /AuditAction\[log\.action\]/.test(svc) &&
  /creditPrintAudit\(/.test(svc) &&
  /creditReprintCount\(/.test(svc) &&
  /reprint: isCreditReprint\(c\.printCount\)/.test(printSvc) &&
  !/printCount >= 1/.test(svc) && !/printCount >= 1/.test(printSvc) && !/next >= 2/.test(svc))

// ---------------------------------------------------------------------------
// ۴) قرارداد تازه‌ی این نشست — نام ستون‌ها در برابر `schema.prisma` واقعی
// ---------------------------------------------------------------------------
check('۲۵. §۱۶ — هر ستونی که `creditSearchWhere` می‌سازد در مدل `StoreCredit` هست', () => {
  const plan = rules.creditSearchPlan('1234')
  const or = rules.creditSearchWhere(plan, { creditIds: [1, 2], invoiceIds: [3] })
  const cols = [...columnsOf(or)]
  const missing = cols.filter((c) => !CREDIT_COLUMNS.includes(c))
  if (missing.length) throw new Error('ستون ناموجود: ' + missing.join(','))
  return cols.length >= 6
})
check('۲۶. §۱۶ — جست‌وجوی متنی هم همین‌طور (نام مشتری/شرکت/تلفن/شناسه ملی/توضیح)', () => {
  const or = rules.creditSearchWhere(rules.creditSearchPlan('کاظمی'))
  const missing = [...columnsOf(or)].filter((c) => !CREDIT_COLUMNS.includes(c))
  if (missing.length) throw new Error('ستون ناموجود: ' + missing.join(','))
  return or.length > 0
})
check('۲۷. §۱۶ — ستون‌های شماره‌ی فاکتور (مرحله‌ی دوم) هم ستون واقعی‌اند', () =>
  rules.CREDIT_SEARCH_INVOICE_COLUMNS.every((c: string) => CREDIT_COLUMNS.includes(c)))
check('۲۸. §۲/§۱۵ — شرط وضعیت مؤثر روی ستون‌های واقعی نوشته می‌شود', () => {
  for (const st of ['ACTIVE', 'EXPIRED', 'PARTIALLY_USED']) {
    const w = rules.creditStatusWhere(st, Date.now())
    if (!w) continue
    const missing = [...columnsOf(w)].filter((c) => !CREDIT_COLUMNS.includes(c))
    if (missing.length) throw new Error(`ستون ناموجود (${st}): ` + missing.join(','))
  }
  return rules.creditStatusWhere('', Date.now()) === null
})
check('۲۹. §۱۲ — هر فیلدِ snapshot گیرنده یک ستون واقعی است (before کامل باشد)', () => {
  const missing = rules.HOLDER_AUDIT_FIELDS.filter((f: string) => !CREDIT_COLUMNS.includes(f))
  if (missing.length) throw new Error('فیلد ناموجود: ' + missing.join(','))
  const snap = rules.holderSnapshot({ customerId: 5, holderNationalId: '1', nope: true })
  return Object.keys(snap).every((k) => CREDIT_COLUMNS.includes(k)) && !('nope' in snap)
})
check('۳۰. §۱۰ — ستون‌های SQL محافظت لاگ، ستون واقعی `AuditLog`اند', () => {
  const p = rules.auditProtectedSql()
  const cols = [...p.sql.matchAll(/"(\w+)"/g)].map((m) => m[1])
  const missing = cols.filter((c) => !AUDIT_COLUMNS.includes(c))
  if (missing.length) throw new Error('ستون ناموجود: ' + missing.join(','))
  return cols.length >= 2 && rules.auditPurgeableSql().sql.startsWith('NOT ')
})
check('۳۱. §۱۰ — هیچ عملِ AuditLogِ اعتبار از محافظت جا نمی‌ماند', () => {
  const actions = [...enums.matchAll(/\b(CREDIT_[A-Z_]+|STORE_CREDIT_[A-Z_]+)\s*[:=]/g)].map((m) => m[1])
  if (actions.length < 5) throw new Error('عملِ اعتباری پیدا نشد')
  const naked = actions.filter((a) => !rules.isProtectedAuditRow('StoreCredit', a))
  if (naked.length) throw new Error('بی‌محافظت: ' + naked.join(','))
  return rules.isProtectedAuditRow('Product', 'PRODUCT_UPDATE') === false
})

// ---------------------------------------------------------------------------
// ۵) مصرف واقعی در JSX — بدون این بخش، همه‌ی بالا «کد اجرانشده» است
// ---------------------------------------------------------------------------
check('۳۲. صفحه‌ی مدیریت اعتبار: کانال و بار داده از `creditViewRequest` می‌آید', () =>
  /creditViewRequest\(view, \{/.test(page) &&
  /CH\[req\.channel as keyof typeof CH\]/.test(page) &&
  !/take: 500/.test(page) && !/CH\.creditDashboard/.test(page) && !/CH\.creditList/.test(page))
check('۳۳. صفحه: سرستون و سلول‌های فهرست از بخش ۱۲ می‌آیند (نه ۱۴ `<td>` دست‌نویس)', () =>
  /CREDIT_LIST_SCREEN_HEADERS\.map/.test(page) &&
  /creditListScreenRow\(r\)\.map/.test(page) &&
  /creditListCellFormat\(i\)/.test(page) &&
  !/money\(r\.amount\)/.test(page) && !/faDigits\(r\.maxUses\)/.test(page))
check('۳۴. صفحه: نوار تب‌ها از `CREDIT_VIEW_TABS` است و `VIEW_TITLES` دست‌ساز رفت', () =>
  /CREDIT_VIEW_TABS\.map/.test(page) && !/VIEW_TITLES/.test(page) && !/'reminderLogs', 'batches'/.test(page))
check('۳۵. صفحه: جدول تفکیک هم قالبش را از بخش ۱۲ می‌گیرد', () =>
  /creditBreakdownCellFormat\(j\)/.test(page) && !/j === 1 \? faDigits\(cell\) : money\(cell\)/.test(page))
check('۳۶. تب گزارشات: بار داده‌ی هر دو کانال از `creditReportRequests` می‌آید', () =>
  /creditReportRequests\(\{/.test(reports) &&
  /CH\.creditDashboard, req\.dashboard\.payload/.test(reports) &&
  /CH\.creditList, req\.list\.payload/.test(reports) &&
  !/take: 1000/.test(reports))
check('۳۷. تب گزارشات: فهرست و ردیف جمعش هم از بخش ۱۲ می‌آیند (عددِ ۱۴ رفت)', () =>
  /CREDIT_LIST_SCREEN_HEADERS\.map/.test(reports) &&
  /creditListScreenRow\(r\)\.map/.test(reports) &&
  /creditListScreenTotals\(listRows\)/.test(reports) &&
  /colSpan=\{CREDIT_LIST_SCREEN_COLUMNS\}/.test(reports) &&
  !/\.slice\(0, 14\)/.test(reports))
check('۳۸. تب گزارشات: محدودیت تیکِ «دارای باقی‌مانده» به کاربر گفته می‌شود', () =>
  /CREDIT_LIST_ONLY_HINT/.test(reports) && ui.CREDIT_LIST_ONLY_HINT.length > 20)
check('۳۹. قاعده‌ی محل تصمیم‌ها: هیچ‌کدام از تصمیم‌های تازه در JSX تعریف نشده‌اند', () =>
  !/CREDIT_LIST_SCREEN_COLUMNS = /.test(page) && !/CREDIT_LIST_SCREEN_COLUMNS = /.test(reports) &&
  !/onlyWithRemaining: onlyWithRemaining \|\| undefined/.test(reports) &&
  /from '@shared\/creditUi'/.test(page) && /from '@shared\/creditUi'/.test(reports))

console.log(out.join('\n'))
console.log(`\ncredit-ui-logic (session 33): ${pass} PASS · ${fail} FAIL`)
if (fail) process.exitCode = 1
